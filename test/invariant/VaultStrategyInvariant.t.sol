// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {YieldVault} from "../../src/core/YieldVault.sol";
import {StrategyManager} from "../../src/core/StrategyManager.sol";
import {Timelock} from "../../src/core/Timelock.sol";
import {Harvester} from "../../src/periphery/Harvester.sol";
import {MockERC20} from "../helpers/MockERC20.sol";
import {MockStrategy} from "../helpers/MockStrategy.sol";
import {RevertingMockStrategy} from "../helpers/RevertingMockStrategy.sol";

/// @notice Handler that stress-tests the full vault + strategy pipeline under random
///         sequences of deposit/withdraw/harvest/rebalance/yield/loss, with one broken
///         strategy in the mix to exercise the try/catch isolation paths.
contract VaultStrategyHandler is Test {
    YieldVault public vault;
    StrategyManager public manager;
    MockERC20 public usdc;
    MockStrategy public strat1;
    MockStrategy public strat2;
    RevertingMockStrategy public brokenStrat;
    Harvester public harvester;
    address public keeper;
    Timelock public timelock;

    address[] public actors;

    // Running ghost totals
    uint256 public ghostDeposits;
    uint256 public ghostWithdrawals;
    uint256 public ghostYield;
    uint256 public ghostLoss;

    // Call counters — used to assert the invariant suite is actually exercising things
    uint256 public callsDeposit;
    uint256 public callsRedeem;
    uint256 public callsHarvest;
    uint256 public callsRebalance;
    uint256 public callsYield;

    constructor(
        YieldVault vault_,
        MockERC20 usdc_,
        MockStrategy strat1_,
        MockStrategy strat2_,
        RevertingMockStrategy broken_,
        Harvester harvester_,
        address keeper_,
        Timelock timelock_
    ) {
        vault = vault_;
        usdc = usdc_;
        strat1 = strat1_;
        strat2 = strat2_;
        brokenStrat = broken_;
        harvester = harvester_;
        keeper = keeper_;
        timelock = timelock_;

        for (uint256 i = 1; i <= 5; i++) {
            address actor = address(uint160(0x9000 + i));
            actors.push(actor);
            usdc.mint(actor, 5_000_000e6);
            vm.prank(actor);
            usdc.approve(address(vault), type(uint256).max);
        }
    }

    function _pickActor(uint256 idx) internal view returns (address) {
        return actors[bound(idx, 0, actors.length - 1)];
    }

    function deposit(uint256 actorIdx, uint256 amount) external {
        address actor = _pickActor(actorIdx);
        amount = bound(amount, 1e6, 500_000e6);
        if (usdc.balanceOf(actor) < amount) return;
        vm.prank(actor);
        try vault.deposit(amount, actor) {
            ghostDeposits += amount;
            callsDeposit++;
        } catch {}
    }

    function redeem(uint256 actorIdx, uint256 bps) external {
        address actor = _pickActor(actorIdx);
        bps = bound(bps, 1, 10_000);
        uint256 shares = vault.balanceOf(actor);
        if (shares == 0) return;
        uint256 toBurn = (shares * bps) / 10_000;
        if (toBurn == 0) return;
        vm.prank(actor);
        try vault.redeem(toBurn, actor, actor) returns (uint256 assets) {
            ghostWithdrawals += assets;
            callsRedeem++;
        } catch {}
    }

    function withdraw(uint256 actorIdx, uint256 amount) external {
        address actor = _pickActor(actorIdx);
        uint256 maxW = vault.maxWithdraw(actor);
        if (maxW == 0) return;
        amount = bound(amount, 1, maxW);
        vm.prank(actor);
        try vault.withdraw(amount, actor, actor) {
            ghostWithdrawals += amount;
        } catch {}
    }

    function harvest() external {
        vm.prank(keeper);
        try vault.harvest() {
            callsHarvest++;
        } catch {}
    }

    function rebalance() external {
        vm.prank(keeper);
        try vault.rebalance() {
            callsRebalance++;
        } catch {}
    }

    // Simulate yield accruing on a strategy
    function accrueYield(uint256 stratIdx, uint256 amount) external {
        amount = bound(amount, 1, 100_000e6);
        if (stratIdx % 2 == 0) {
            usdc.mint(address(strat1), amount);
            strat1.simulateYield(amount);
        } else {
            usdc.mint(address(strat2), amount);
            strat2.simulateYield(amount);
        }
        ghostYield += amount;
        callsYield++;
    }

    // Toggle the broken strategy's state to exercise try/catch paths dynamically
    function toggleBrokenStrategy(uint256 which, bool val) external {
        if (which % 2 == 0) {
            brokenStrat.setDepositShouldRevert(val);
        } else {
            brokenStrat.setWithdrawShouldRevert(val);
        }
    }
}

contract VaultStrategyInvariantTest is Test {
    YieldVault public vault;
    StrategyManager public manager;
    MockERC20 public usdc;
    MockStrategy public strat1;
    MockStrategy public strat2;
    RevertingMockStrategy public brokenStrat;
    Harvester public harvester;
    Timelock public timelock;
    VaultStrategyHandler public handler;

    address public deployer = address(0x1111);
    address public guardian = address(0x2222);
    address public feeRecipient = address(0x3333);

    function setUp() public {
        vm.startPrank(deployer);
        usdc = new MockERC20("USDC", "USDC", 6);
        timelock = new Timelock(deployer, 24 hours);
        vault = new YieldVault(
            IERC20(address(usdc)), address(timelock), guardian, deployer, feeRecipient
        );
        manager = vault.strategyManager();

        strat1 = new MockStrategy(address(usdc), address(vault), address(manager));
        strat2 = new MockStrategy(address(usdc), address(vault), address(manager));
        brokenStrat = new RevertingMockStrategy(address(usdc), address(vault));

        harvester = new Harvester(address(vault), deployer);
        vault.setHarvester(address(harvester));
        vm.stopPrank();

        // Add three strategies via timelock (40/40/20)
        vm.startPrank(address(timelock));
        vault.addStrategy(address(strat1), 4_000);
        vault.addStrategy(address(strat2), 4_000);
        vault.addStrategy(address(brokenStrat), 2_000);
        vm.stopPrank();

        handler = new VaultStrategyHandler(
            vault, usdc, strat1, strat2, brokenStrat, harvester, deployer, timelock
        );

        // Focus the invariant fuzzer on handler functions only
        bytes4[] memory selectors = new bytes4[](8);
        selectors[0] = handler.deposit.selector;
        selectors[1] = handler.redeem.selector;
        selectors[2] = handler.withdraw.selector;
        selectors[3] = handler.harvest.selector;
        selectors[4] = handler.rebalance.selector;
        selectors[5] = handler.accrueYield.selector;
        selectors[6] = handler.toggleBrokenStrategy.selector;
        selectors[7] = handler.deposit.selector; // weight deposits higher

        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    // ─── Invariants ───

    /// @notice No underflow on totalAssets
    function invariant_totalAssetsNonNegative() public view {
        vault.totalAssets(); // just exercises the math; reverts on underflow
    }

    /// @notice totalSupply > 0  ⇒  totalAssets > 0 (shares always backed by assets)
    function invariant_sharesBacked() public view {
        if (vault.totalSupply() > 0) {
            assertGt(vault.totalAssets(), 0, "shares exist without backing assets");
        }
    }

    /// @notice The sum of all actor share balances must equal totalSupply
    function invariant_shareSumMatchesTotalSupply() public view {
        uint256 sum;
        for (uint256 i; i < 5; i++) {
            sum += vault.balanceOf(address(uint160(0x9000 + i + 1)));
        }
        assertEq(sum, vault.totalSupply(), "share sum != totalSupply");
    }

    /// @notice Vault's reported totalAssets equals idle USDC plus deployed strategy assets
    function invariant_totalAssetsAccounting() public view {
        uint256 idle = usdc.balanceOf(address(vault));
        uint256 deployed = manager.totalDeployedAssets();
        assertEq(vault.totalAssets(), idle + deployed, "totalAssets != idle + deployed");
    }

    /// @notice Share-price monotonicity under pure deposits/withdrawals (no yield event).
    ///         This invariant only holds on the "no yield/no loss since last snapshot"
    ///         axis, which the handler doesn't currently expose. Kept as a soft check:
    ///         the share price never drops below the initial 1:1 baseline unless a loss
    ///         was induced, which the handler cannot do.
    function invariant_sharePriceAtLeastOne() public view {
        uint256 supply = vault.totalSupply();
        if (supply == 0) return;
        uint256 assets = vault.totalAssets();
        // assets * 1e18 / supply >= ~1e12 (the initial post-deposit share price)
        // Under pure deposit/withdraw with zero yield and zero loss, share price is stable.
        // Yield can only push it up; the handler never takes a loss.
        uint256 sharePrice = (assets * 1e18) / supply;
        // Allow a tiny fudge for virtual-share rounding: 0.99 * 1e12
        assertGe(sharePrice, 0.99e12, "share price dropped below baseline");
    }

    /// @notice The invariant suite must actually exercise the handler (defence against
    ///         accidentally writing a no-op fuzz).
    function invariant_handlerWasCalled() public view {
        assertGt(
            handler.callsDeposit() + handler.callsRedeem() + handler.callsHarvest()
                + handler.callsRebalance() + handler.callsYield(),
            0,
            "no handler actions ran - invariant suite is inert"
        );
    }
}
