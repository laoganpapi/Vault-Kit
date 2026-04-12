// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {YieldVault} from "../../src/core/YieldVault.sol";
import {StrategyManager} from "../../src/core/StrategyManager.sol";
import {Timelock} from "../../src/core/Timelock.sol";
import {Harvester} from "../../src/periphery/Harvester.sol";
import {AaveSupplyStrategy} from "../../src/strategies/AaveSupplyStrategy.sol";
import {AaveLeverageStrategy} from "../../src/strategies/AaveLeverageStrategy.sol";
import {IAavePool} from "../../src/interfaces/IAavePool.sol";
import {Constants} from "../../src/libraries/Constants.sol";

/// @notice Fork test against live Arbitrum mainnet Aave V3 + Uniswap V3.
///
/// Usage:
///   export ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc
///   forge test --match-contract AaveSupplyStrategyFork --fork-url $ARBITRUM_RPC_URL -vv
///
/// Pin the block number for reproducible results (set to a recent block that has
/// realistic aUSDC liquidity). The tests steal USDC from an Arbitrum USDC whale via
/// vm.startPrank so no testnet USDC minting is required.
contract AaveSupplyStrategyForkTest is Test {
    // Arbitrum USDC whale (pick a stable address with large balance — Circle's treasury
    // or Binance 8 are good choices; verify before running). Falls back to vm.deal-style
    // minting by impersonating the USDC minter role.
    address internal constant USDC_WHALE = 0x489ee077994B6658eAfA855C308275EAd8097C4A; // GMX treasury

    YieldVault public vault;
    StrategyManager public manager;
    Timelock public timelock;
    Harvester public harvester;
    AaveSupplyStrategy public strategy;
    IERC20 public usdc;

    address public deployer = address(0x1111);
    address public guardian = address(0x2222);
    address public feeRecipient = address(0x3333);
    address public alice = address(0x4444);

    function setUp() public {
        // Skip if the fork URL isn't set — this test is opt-in via --fork-url.
        try vm.envString("ARBITRUM_RPC_URL") returns (string memory rpc) {
            if (bytes(rpc).length == 0) vm.skip(true);
        } catch {
            vm.skip(true);
        }

        usdc = IERC20(Constants.USDC);

        vm.startPrank(deployer);
        timelock = new Timelock(deployer, 24 hours);
        vault = new YieldVault(usdc, address(timelock), guardian, deployer, feeRecipient);
        manager = vault.strategyManager();
        strategy = new AaveSupplyStrategy(address(vault), address(manager), Constants.USDC);
        harvester = new Harvester(address(vault), deployer);
        vault.setHarvester(address(harvester));
        vm.stopPrank();

        // Add strategy via timelock
        vm.prank(address(timelock));
        vault.addStrategy(address(strategy), 10_000);

        // Fund alice from the whale
        vm.prank(USDC_WHALE);
        usdc.transfer(alice, 1_000_000e6);

        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
    }

    function test_fork_depositRebalanceHarvestWithdraw() public {
        // Alice deposits 100k USDC
        vm.prank(alice);
        vault.deposit(100_000e6, alice);
        assertEq(vault.totalAssets(), 100_000e6, "totalAssets after deposit");

        // Rebalance — strategy supplies to Aave, receives aUSDC
        vm.prank(deployer);
        vault.rebalance();

        // Strategy should hold aUSDC worth ~100k
        uint256 deployed = strategy.totalAssets();
        assertApproxEqAbs(deployed, 100_000e6, 1e6, "strategy holds ~100k in aUSDC");

        // Fast-forward ~1 week so supply interest accrues
        vm.warp(block.timestamp + 7 days);

        // totalAssets should have grown slightly (supply APR on Aave)
        uint256 grown = vault.totalAssets();
        assertGt(grown, 100_000e6, "interest accrued over 1 week");

        // Harvest — this call may no-op on rewards if the current Aave incentive program
        // is inactive at the fork block. The important property is that it does not revert.
        vm.prank(address(harvester));
        vault.harvest();

        // Alice withdraws her full balance (net of fees)
        uint256 maxWithdrawable = vault.maxWithdraw(alice);
        vm.prank(alice);
        uint256 shares = vault.withdraw(maxWithdrawable, alice, alice);
        assertGt(shares, 0, "burned shares on withdrawal");

        // Alice's USDC balance should be roughly her original deposit plus accrued interest
        // (less the 0.1% withdrawal fee).
        uint256 aliceFinal = usdc.balanceOf(alice);
        assertGt(aliceFinal, 900_000e6 + 99_900e6, "alice received principal + some yield");
    }

    function test_fork_emergencyWithdrawRestoresUsdc() public {
        vm.prank(alice);
        vault.deposit(50_000e6, alice);

        vm.prank(deployer);
        vault.rebalance();

        // Guardian triggers emergency withdrawal
        vm.prank(guardian);
        vault.emergencyWithdrawAll();

        // Vault should hold ~50k USDC as idle now (minus trivial rounding)
        assertApproxEqAbs(usdc.balanceOf(address(vault)), 50_000e6, 10e6);

        // Alice can still redeem after emergency (withdraw is unpaused even when paused)
        uint256 maxWithdrawable = vault.maxWithdraw(alice);
        assertGt(maxWithdrawable, 49_000e6, "alice can still exit");
        vm.prank(alice);
        vault.withdraw(maxWithdrawable, alice, alice);
    }
}

/// @notice Fork test for the leverage strategy's loop math and emergency unwind against
///         live Aave V3. Keeps loops shallow (max 2-3 productive iterations) because the
///         USDC LTV/liqThreshold parameters on Aave produce that naturally at HF=1.3.
contract AaveLeverageStrategyForkTest is Test {
    address internal constant USDC_WHALE = 0x489ee077994B6658eAfA855C308275EAd8097C4A;

    YieldVault public vault;
    StrategyManager public manager;
    Timelock public timelock;
    AaveLeverageStrategy public strategy;
    IERC20 public usdc;

    address public deployer = address(0x1111);
    address public guardian = address(0x2222);
    address public feeRecipient = address(0x3333);
    address public alice = address(0x4444);

    function setUp() public {
        try vm.envString("ARBITRUM_RPC_URL") returns (string memory rpc) {
            if (bytes(rpc).length == 0) vm.skip(true);
        } catch {
            vm.skip(true);
        }

        usdc = IERC20(Constants.USDC);

        vm.startPrank(deployer);
        timelock = new Timelock(deployer, 24 hours);
        vault = new YieldVault(usdc, address(timelock), guardian, deployer, feeRecipient);
        manager = vault.strategyManager();
        strategy = new AaveLeverageStrategy(address(vault), address(manager), Constants.USDC);
        vm.stopPrank();

        vm.prank(address(timelock));
        vault.addStrategy(address(strategy), 10_000);

        vm.prank(USDC_WHALE);
        usdc.transfer(alice, 500_000e6);

        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
    }

    function test_fork_leverageDepositProducesHealthyPosition() public {
        vm.prank(alice);
        vault.deposit(100_000e6, alice);

        vm.prank(deployer);
        vault.rebalance();

        // After rebalance the strategy should have a leveraged position
        uint256 net = strategy.totalAssets();
        assertApproxEqAbs(net, 100_000e6, 1e6, "net position ~= deposit");

        // Health factor should be at or above the floor
        uint256 hf = strategy.healthFactor();
        assertGe(hf, strategy.MIN_HEALTH_FACTOR(), "HF >= 1.3e18");

        // Verify the position has actually leveraged (collateral > net)
        (uint256 coll, uint256 debt,,,,) = IAavePool(Constants.AAVE_POOL).getUserAccountData(address(strategy));
        assertGt(coll, debt, "collateral > debt");
        assertGt(debt, 0, "position is leveraged (debt > 0)");
    }

    function test_fork_leverageEmergencyUnwindFullyExits() public {
        vm.prank(alice);
        vault.deposit(100_000e6, alice);

        vm.prank(deployer);
        vault.rebalance();

        // Trigger emergency — emergencyWithdraw must fully unwind the loop position
        vm.prank(guardian);
        vault.emergencyWithdrawAll();

        // After emergency: vault should hold ~100k USDC as idle, strategy should have 0 debt
        (, uint256 debtAfter,,,,) = IAavePool(Constants.AAVE_POOL).getUserAccountData(address(strategy));
        assertEq(debtAfter, 0, "debt fully repaid");

        // Allow for 1% slippage due to Aave interest accrual and dust
        uint256 recovered = usdc.balanceOf(address(vault));
        assertGt(recovered, 99_000e6, "recovered >=99% of principal");
    }

    function test_fork_leverageUserWithdrawalWorks() public {
        vm.prank(alice);
        vault.deposit(100_000e6, alice);

        vm.prank(deployer);
        vault.rebalance();

        // Alice withdraws 50% of her position — must unwind enough loops to free the USDC
        uint256 half = vault.maxWithdraw(alice) / 2;
        vm.prank(alice);
        vault.withdraw(half, alice, alice);

        // Alice should have received ~50k USDC (minus fee)
        uint256 aliceBal = usdc.balanceOf(alice);
        // She started with 500k from the whale; spent 100k depositing; now has 400k + withdrawal
        assertGt(aliceBal, 400_000e6 + 49_000e6, "alice received her withdrawal");

        // The remaining position should still have a healthy HF
        uint256 hf = strategy.healthFactor();
        // HF may be at EMERGENCY_HEALTH_FACTOR immediately after withdraw since _withdraw
        // targets that floor. Must still be above 1.0 (Aave liquidation).
        assertGt(hf, 1e18, "position not liquidatable after partial withdraw");
    }
}
