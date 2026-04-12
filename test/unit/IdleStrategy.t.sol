// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {YieldVault} from "../../src/core/YieldVault.sol";
import {StrategyManager} from "../../src/core/StrategyManager.sol";
import {Timelock} from "../../src/core/Timelock.sol";
import {IdleStrategy} from "../../src/strategies/IdleStrategy.sol";
import {MockERC20} from "../helpers/MockERC20.sol";

/// @notice Full deposit / rebalance / withdraw / emergency lifecycle against IdleStrategy.
///         This is the closest thing to a pure integration test inside the invariant-free
///         unit suite: it wires the real Vault + Manager + Timelock + Harvester + Strategy
///         together and verifies that USDC round-trips cleanly.
contract IdleStrategyTest is Test {
    YieldVault public vault;
    StrategyManager public manager;
    Timelock public timelock;
    IdleStrategy public idle;
    MockERC20 public usdc;

    address public deployer = address(0x1);
    address public guardian = address(0x2);
    address public feeRecipient = address(0x3);
    address public harvesterAddr = address(0x4);
    address public alice = address(0xA);

    function setUp() public {
        vm.startPrank(deployer);
        usdc = new MockERC20("USDC", "USDC", 6);
        timelock = new Timelock(deployer, 24 hours);
        vault = new YieldVault(
            IERC20(address(usdc)), address(timelock), guardian, harvesterAddr, feeRecipient
        );
        manager = vault.strategyManager();
        idle = new IdleStrategy(address(vault), address(manager), address(usdc));
        vm.stopPrank();

        vm.prank(address(timelock));
        vault.addStrategy(address(idle), 10_000);

        usdc.mint(alice, 1_000_000e6);
        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
    }

    function test_lifecycle_depositRebalanceWithdraw() public {
        // Deposit
        vm.prank(alice);
        vault.deposit(100_000e6, alice);
        assertEq(vault.totalAssets(), 100_000e6);
        assertEq(usdc.balanceOf(address(vault)), 100_000e6, "idle on vault pre-rebalance");
        assertEq(idle.totalAssets(), 0, "strategy empty pre-rebalance");

        // Rebalance — idle moves to the strategy
        vm.prank(harvesterAddr);
        vault.rebalance();
        assertEq(idle.totalAssets(), 100_000e6, "strategy holds deposit after rebalance");
        assertEq(usdc.balanceOf(address(vault)), 0, "no idle after rebalance");
        assertEq(vault.totalAssets(), 100_000e6, "totalAssets stable");

        // Withdraw 50k — pulls from strategy
        vm.prank(alice);
        vault.withdraw(50_000e6, alice, alice);
        // Alice receives exactly the requested amount (ERC-4626 withdraw semantics).
        assertEq(usdc.balanceOf(alice), 900_000e6 + 50_000e6);
        // Fee = gross - net where gross = ceil(net * 10000 / 9990).
        // For net = 50_000e6: gross = ceil(500_000_000_000_000 / 9990) = 50_050_050_051,
        // fee = 50_050_051 wei (~50.05 USDC). Allow +/- a few wei for rounding.
        assertApproxEqAbs(usdc.balanceOf(feeRecipient), 50_050_051, 5);
    }

    function test_harvestIsNoOp() public {
        vm.prank(alice);
        vault.deposit(100_000e6, alice);

        vm.prank(harvesterAddr);
        vault.rebalance();

        // IdleStrategy._harvest returns 0 — vault.harvest should succeed with no profit event
        vm.prank(harvesterAddr);
        vault.harvest();

        // State unchanged
        assertEq(idle.totalAssets(), 100_000e6);
        assertEq(vault.totalAssets(), 100_000e6);
    }

    function test_emergencyWithdraw_fullySweeps() public {
        vm.prank(alice);
        vault.deposit(100_000e6, alice);

        vm.prank(harvesterAddr);
        vault.rebalance();

        assertEq(idle.totalAssets(), 100_000e6);

        // Guardian triggers emergency — strategy funds return to vault, vault is paused
        vm.prank(guardian);
        vault.emergencyWithdrawAll();

        assertEq(idle.totalAssets(), 0, "strategy fully drained");
        assertEq(usdc.balanceOf(address(vault)), 100_000e6, "vault holds recovered USDC");
        assertTrue(vault.paused(), "vault paused after emergency");

        // Alice can still withdraw even when paused
        uint256 maxW = vault.maxWithdraw(alice);
        vm.prank(alice);
        vault.withdraw(maxW, alice, alice);
        assertGe(usdc.balanceOf(alice), 900_000e6 + 99_900e6, "alice got ~100k back");
    }

    function test_canDeposit_alwaysTrue() public view {
        assertTrue(idle.canDeposit());
        assertEq(idle.healthFactor(), type(uint256).max);
    }
}
