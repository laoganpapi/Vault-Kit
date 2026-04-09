// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {YieldVault} from "../../src/core/YieldVault.sol";
import {Timelock} from "../../src/core/Timelock.sol";
import {StrategyManager} from "../../src/core/StrategyManager.sol";
import {MockERC20} from "../helpers/MockERC20.sol";
import {MockStrategy} from "../helpers/MockStrategy.sol";
import {Errors} from "../../src/libraries/Errors.sol";

contract YieldVaultTest is Test {
    YieldVault public vault;
    Timelock public timelock;
    MockERC20 public usdc;
    MockStrategy public strategy;

    address public deployer = address(0x1);
    address public guardian = address(0x2);
    address public feeRecipient = address(0x3);
    address public harvesterAddr = address(0x4);
    address public alice = address(0xA);
    address public bob = address(0xB);

    function setUp() public {
        vm.startPrank(deployer);

        usdc = new MockERC20("USD Coin", "USDC", 6);
        timelock = new Timelock(deployer, 24 hours);
        vault = new YieldVault(IERC20(address(usdc)), address(timelock), guardian, harvesterAddr, feeRecipient);

        // Deploy mock strategy — manager is the StrategyManager, not the vault
        strategy = new MockStrategy(address(usdc), address(vault), address(vault.strategyManager()));

        vm.stopPrank();

        // Fund users
        usdc.mint(alice, 1_000_000e6);
        usdc.mint(bob, 1_000_000e6);
        usdc.mint(address(strategy), 100_000e6); // For mock harvest profits

        // Approve vault
        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(vault), type(uint256).max);
    }

    // ─── Deposit Tests ───

    function test_deposit_basic() public {
        vm.prank(alice);
        uint256 shares = vault.deposit(1000e6, alice);

        assertGt(shares, 0, "Should receive shares");
        assertEq(vault.totalAssets(), 1000e6, "Total assets should match deposit");
        assertEq(vault.balanceOf(alice), shares, "Alice should hold shares");
    }

    function test_deposit_multipleUsers() public {
        vm.prank(alice);
        uint256 sharesA = vault.deposit(1000e6, alice);

        vm.prank(bob);
        uint256 sharesB = vault.deposit(1000e6, bob);

        assertEq(vault.totalAssets(), 2000e6, "Total assets = both deposits");
        assertEq(sharesA, sharesB, "Equal deposits should get equal shares");
    }

    function test_deposit_revertsBelowMinimum() public {
        vm.prank(alice);
        vm.expectRevert(Errors.ZeroAmount.selector);
        vault.deposit(0.5e6, alice); // 0.5 USDC < 1 USDC minimum
    }

    function test_deposit_revertsAboveCap() public {
        usdc.mint(alice, 11_000_000e6);
        vm.prank(alice);
        vm.expectRevert(Errors.DepositCapExceeded.selector);
        vault.deposit(10_000_001e6, alice);
    }

    function test_deposit_revertsWhenPaused() public {
        vm.prank(guardian);
        vault.pause();

        vm.prank(alice);
        vm.expectRevert();
        vault.deposit(1000e6, alice);
    }

    // ─── Withdraw Tests ───

    function test_withdraw_basic() public {
        vm.prank(alice);
        vault.deposit(1000e6, alice);

        uint256 aliceBefore = usdc.balanceOf(alice);

        vm.prank(alice);
        uint256 shares = vault.withdraw(999e6, alice, alice);

        assertGt(shares, 0, "Should burn shares");
        // ERC-4626 compliant: Alice receives exactly 999e6 USDC
        assertEq(usdc.balanceOf(alice) - aliceBefore, 999e6, "Alice should receive exact requested amount");
        // Fee = grossAssets - 999e6; grossAssets = ceil(999e6 * 10000 / 9990) = 1000e6
        assertGt(usdc.balanceOf(feeRecipient), 0, "Fee recipient should get fee");
    }

    function test_withdraw_worksWhenPaused() public {
        vm.prank(alice);
        vault.deposit(1000e6, alice);

        vm.prank(guardian);
        vault.pause();

        // Withdrawal should still work when paused
        vm.prank(alice);
        vault.withdraw(500e6, alice, alice);
    }

    function test_redeem_basic() public {
        vm.prank(alice);
        uint256 shares = vault.deposit(1000e6, alice);

        vm.prank(alice);
        uint256 assets = vault.redeem(shares, alice, alice);

        assertGt(assets, 0, "Should receive assets");
        assertEq(vault.balanceOf(alice), 0, "Should have 0 shares after full redeem");
    }

    // ─── Circuit Breaker Tests ───

    function test_circuitBreaker_tripsOnDrawdown() public {
        // This tests the internal mechanism — in production, drawdown comes from strategy losses
        vm.prank(alice);
        vault.deposit(10_000e6, alice);

        // Simulate 6% loss by removing USDC from vault
        // (In reality this happens when strategy totalAssets drops)
        vm.prank(address(vault));
        usdc.transfer(address(0xdead), 600e6);

        // Trigger check via harvest
        vm.prank(harvesterAddr);
        vault.harvest();

        assertTrue(vault.circuitBreakerTripped(), "Circuit breaker should trip at 6% drawdown");

        // New deposits should fail
        vm.prank(bob);
        vm.expectRevert(Errors.CircuitBreakerTripped.selector);
        vault.deposit(1000e6, bob);

        // But withdrawals should still work
        uint256 aliceShares = vault.balanceOf(alice);
        vm.prank(alice);
        vault.redeem(aliceShares / 2, alice, alice);
    }

    function test_circuitBreaker_reset() public {
        vm.prank(alice);
        vault.deposit(10_000e6, alice);

        // Trip the breaker
        vm.prank(address(vault));
        usdc.transfer(address(0xdead), 600e6);
        vm.prank(harvesterAddr);
        vault.harvest();
        assertTrue(vault.circuitBreakerTripped());

        // Owner resets (resetCircuitBreaker is onlyOwner)
        vm.prank(deployer);
        vault.resetCircuitBreaker();
        assertFalse(vault.circuitBreakerTripped());
    }

    // ─── Access Control Tests ───

    function test_onlyTimelock_addStrategy() public {
        vm.prank(alice);
        vm.expectRevert(Errors.NotTimelock.selector);
        vault.addStrategy(address(strategy), 5000);
    }

    function test_onlyGuardian_pause() public {
        vm.prank(alice);
        vm.expectRevert(Errors.NotGuardian.selector);
        vault.pause();
    }

    function test_onlyHarvester_harvest() public {
        vm.prank(alice);
        vm.expectRevert(Errors.NotHarvester.selector);
        vault.harvest();
    }

    function test_ownerCanPause() public {
        vm.prank(deployer);
        vault.pause();
        assertTrue(vault.paused());
    }

    // ─── Strategy Integration (via Timelock) ───

    function test_addStrategy_viaTimelock() public {
        vm.startPrank(deployer);

        uint256 eta = block.timestamp + 24 hours + 1;
        bytes memory data = abi.encode(address(strategy), uint256(5000));

        timelock.queueTransaction(address(vault), 0, "addStrategy(address,uint256)", data, eta);

        // Warp past timelock delay
        vm.warp(eta);

        timelock.executeTransaction(address(vault), 0, "addStrategy(address,uint256)", data, eta);

        vm.stopPrank();

        // Verify strategy was added
        StrategyManager sm = vault.strategyManager();
        assertEq(sm.strategyCount(), 1);
        assertTrue(sm.isStrategy(address(strategy)));
    }

    // ─── Fee Tests ───

    function test_performanceFee_onHarvest() public {
        // Add strategy via timelock
        _addStrategyViaTimelock(address(strategy), 10_000); // 100% allocation

        // Alice deposits
        vm.prank(alice);
        vault.deposit(10_000e6, alice);

        // Simulate harvest profit
        strategy.setNextHarvestProfit(1000e6);

        uint256 feeRecipientBefore = usdc.balanceOf(feeRecipient);

        vm.prank(harvesterAddr);
        vault.harvest();

        // 10% performance fee on 1000 USDC = 100 USDC
        uint256 feeCollected = usdc.balanceOf(feeRecipient) - feeRecipientBefore;
        assertEq(feeCollected, 100e6, "Should collect 10% performance fee");
    }

    // ─── Helpers ───

    function _addStrategyViaTimelock(address strat, uint256 allocBps) internal {
        vm.startPrank(deployer);

        uint256 eta = block.timestamp + 24 hours + 1;
        bytes memory data = abi.encode(strat, allocBps);

        timelock.queueTransaction(address(vault), 0, "addStrategy(address,uint256)", data, eta);
        vm.warp(eta);
        timelock.executeTransaction(address(vault), 0, "addStrategy(address,uint256)", data, eta);

        vm.stopPrank();
    }
}
