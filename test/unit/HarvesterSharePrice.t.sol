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

/// @notice Regression for EVMBENCH audit follow-up: `Harvester.canHarvest` must track
///         share price (assets/supply), not raw totalAssets. Otherwise a user deposit
///         between harvests triggers a false-positive keeper execution and wastes gas.
contract HarvesterSharePriceTest is Test {
    YieldVault public vault;
    StrategyManager public manager;
    Timelock public timelock;
    Harvester public harvester;
    MockERC20 public usdc;
    MockStrategy public strategy;

    address public deployer = address(0x1);
    address public guardian = address(0x2);
    address public feeRecipient = address(0x3);
    address public alice = address(0xA);
    address public bob = address(0xB);

    function setUp() public {
        vm.startPrank(deployer);
        usdc = new MockERC20("USD Coin", "USDC", 6);
        timelock = new Timelock(deployer, 24 hours);
        vault = new YieldVault(
            IERC20(address(usdc)), address(timelock), guardian, address(0xdead), feeRecipient
        );
        manager = vault.strategyManager();
        strategy = new MockStrategy(address(usdc), address(vault), address(manager));
        harvester = new Harvester(address(vault), deployer);
        vault.setHarvester(address(harvester));
        vm.stopPrank();

        // Add strategy
        vm.prank(address(timelock));
        vault.addStrategy(address(strategy), 10_000);

        // Fund users
        usdc.mint(alice, 10_000_000e6);
        usdc.mint(bob, 10_000_000e6);
        usdc.mint(address(strategy), 1_000_000e6); // For mock harvest profits
        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(vault), type(uint256).max);

        // Seed vault with alice's 1M deposit
        vm.prank(alice);
        vault.deposit(1_000_000e6, alice);

        // Initial harvest to snapshot the baseline share price
        vm.warp(block.timestamp + 6 hours + 1);
        harvester.harvestIfNeeded();
    }

    /// @notice A fresh deposit (no real yield) must NOT trigger canHarvest() = true.
    function test_canHarvest_ignoresDepositGrowth() public {
        // Fast-forward past the min interval
        vm.warp(block.timestamp + 6 hours + 1);

        // Bob deposits a large amount — totalAssets jumps, but share price stays the same.
        vm.prank(bob);
        vault.deposit(1_000_000e6, bob);

        // canHarvest should be FALSE because share price didn't move
        assertFalse(
            harvester.canHarvest(),
            "deposit must not be counted as yield; canHarvest should be false"
        );
    }

    /// @notice Real yield (strategy simulateYield) must trigger canHarvest() = true.
    function test_canHarvest_triggersOnRealYield() public {
        // Fast-forward past the interval
        vm.warp(block.timestamp + 6 hours + 1);

        // Simulate 1% yield on the strategy (10_000e6 on 1M deposit)
        strategy.simulateYield(10_000e6);

        assertTrue(harvester.canHarvest(), "real yield must enable canHarvest");
    }

    /// @notice Combined: deposits plus yield — canHarvest still triggers on real yield
    ///         and share-price tracking is stable across deposit noise.
    function test_canHarvest_stableUnderDepositNoise() public {
        vm.warp(block.timestamp + 6 hours + 1);

        // Deposit adds noise (no yield)
        vm.prank(bob);
        vault.deposit(500_000e6, bob);
        assertFalse(harvester.canHarvest(), "deposit alone doesn't trigger");

        // Now add real yield
        strategy.simulateYield(15_000e6);
        assertTrue(harvester.canHarvest(), "yield triggers even under deposit noise");
    }
}
