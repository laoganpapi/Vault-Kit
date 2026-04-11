// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {YieldVault} from "../../src/core/YieldVault.sol";
import {StrategyManager} from "../../src/core/StrategyManager.sol";
import {Timelock} from "../../src/core/Timelock.sol";
import {MockERC20} from "../helpers/MockERC20.sol";
import {MockStrategy} from "../helpers/MockStrategy.sol";
import {RevertingMockStrategy} from "../helpers/RevertingMockStrategy.sol";

/// @notice Regression: one reverting strategy must not block rebalance into healthy
///         strategies. Exercises the try/catch fix in `StrategyManager.rebalance`.
contract StrategyManagerRebalanceTest is Test {
    YieldVault public vault;
    StrategyManager public manager;
    Timelock public timelock;
    MockERC20 public usdc;

    MockStrategy public goodStrat;
    RevertingMockStrategy public badStrat;

    address public deployer = address(0x1);
    address public guardian = address(0x2);
    address public feeRecipient = address(0x3);
    address public harvesterAddr = address(0x4);
    address public alice = address(0xA);

    event StrategyDepositFailed(address indexed strategy, uint256 attemptedAmount, bytes reason);

    function setUp() public {
        vm.startPrank(deployer);

        usdc = new MockERC20("USD Coin", "USDC", 6);
        timelock = new Timelock(deployer, 24 hours);
        vault = new YieldVault(
            IERC20(address(usdc)), address(timelock), guardian, harvesterAddr, feeRecipient
        );
        manager = vault.strategyManager();

        goodStrat = new MockStrategy(address(usdc), address(vault), address(manager));
        badStrat = new RevertingMockStrategy(address(usdc), address(vault));

        vm.stopPrank();

        // Add both strategies via the timelock (50/50 allocation)
        vm.startPrank(address(timelock));
        vault.addStrategy(address(goodStrat), 5_000);
        vault.addStrategy(address(badStrat), 5_000);
        vm.stopPrank();

        usdc.mint(alice, 1_000_000e6);
        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
    }

    /// @notice A reverting strategy must not DOS rebalance — the good strategy must still
    ///         receive its share of the deposit, and the bad strategy's attempted amount
    ///         must be returned to the vault as idle (not stuck on the manager).
    function test_rebalance_doesNotDosOnRevertingStrategy() public {
        vm.prank(alice);
        vault.deposit(10_000e6, alice);

        // Rebalance — the good strategy should absorb its allocation, the bad should revert.
        vm.prank(harvesterAddr);
        vm.expectEmit(true, false, false, false);
        emit StrategyDepositFailed(address(badStrat), 0, "");
        vault.rebalance();

        // Good strategy received its 50% allocation (5_000e6)
        assertEq(goodStrat.totalAssets(), 5_000e6, "good strategy absorbed its allocation");

        // Bad strategy attempted at least once but holds zero USDC (refunded to vault)
        assertGe(badStrat.depositAttempts(), 1, "bad strategy deposit was attempted");
        assertEq(usdc.balanceOf(address(badStrat)), 0, "bad strategy holds no USDC");

        // Manager holds no residual USDC from the failed attempt
        assertEq(usdc.balanceOf(address(manager)), 0, "manager has no residual USDC");

        // Vault's totalAssets is preserved (idle + good strat deployed)
        assertEq(vault.totalAssets(), 10_000e6, "total assets preserved after partial rebalance");
    }

    /// @notice When the bad strategy is switched back on, subsequent rebalances succeed.
    function test_rebalance_recoversAfterStrategyFixed() public {
        vm.prank(alice);
        vault.deposit(10_000e6, alice);

        // First rebalance: bad reverts, good absorbs 5_000
        vm.prank(harvesterAddr);
        vault.rebalance();
        assertEq(goodStrat.totalAssets(), 5_000e6);

        // Fix the bad strategy
        badStrat.setDepositShouldRevert(false);

        // Rebalance again — bad should now succeed
        vm.prank(harvesterAddr);
        vault.rebalance();
        // Total deployed should now reach the full 10_000e6 allocation
        assertEq(
            goodStrat.totalAssets() + usdc.balanceOf(address(badStrat)),
            5_000e6,
            "good strat unchanged since its allocation is filled"
        );
    }
}
