// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {YieldVault} from "../../src/core/YieldVault.sol";
import {StrategyManager} from "../../src/core/StrategyManager.sol";
import {Timelock} from "../../src/core/Timelock.sol";
import {MockERC20} from "../helpers/MockERC20.sol";
import {MockStrategy} from "../helpers/MockStrategy.sol";
import {Errors} from "../../src/libraries/Errors.sol";

/// @notice Regression for EVMBENCH_AUDIT.md finding "reward tokens stranded after removeStrategy".
///         The vault's `rescueStrategyToken` passthrough must sweep a non-USDC ERC20 from a
///         strategy back to the vault, reject USDC, reject non-owner callers, and work even
///         after the strategy has been removed from the manager's active list.
contract YieldVaultRescueTest is Test {
    YieldVault public vault;
    StrategyManager public manager;
    Timelock public timelock;
    MockERC20 public usdc;
    MockERC20 public arb;
    MockStrategy public strategy;

    address public deployer = address(0x1);
    address public guardian = address(0x2);
    address public feeRecipient = address(0x3);
    address public harvesterAddr = address(0x4);
    address public alice = address(0xA);

    function setUp() public {
        vm.startPrank(deployer);

        usdc = new MockERC20("USD Coin", "USDC", 6);
        arb = new MockERC20("Arbitrum", "ARB", 18);
        timelock = new Timelock(deployer, 24 hours);
        vault = new YieldVault(
            IERC20(address(usdc)), address(timelock), guardian, harvesterAddr, feeRecipient
        );
        manager = vault.strategyManager();
        strategy = new MockStrategy(address(usdc), address(vault), address(manager));

        vm.stopPrank();
    }

    function test_rescueStrategyToken_sweepsArbToVault() public {
        arb.mint(address(strategy), 100e18);
        assertEq(arb.balanceOf(address(strategy)), 100e18);
        assertEq(arb.balanceOf(address(vault)), 0);

        vm.prank(deployer); // vault owner
        vault.rescueStrategyToken(address(strategy), address(arb));

        assertEq(arb.balanceOf(address(strategy)), 0, "strategy balance cleared");
        assertEq(arb.balanceOf(address(vault)), 100e18, "vault received rescued token");
    }

    function test_rescueStrategyToken_rejectsUsdc() public {
        vm.prank(deployer);
        vm.expectRevert(Errors.ZeroAmount.selector);
        vault.rescueStrategyToken(address(strategy), address(usdc));
    }

    function test_rescueStrategyToken_rejectsZeroAddresses() public {
        vm.startPrank(deployer);
        vm.expectRevert(Errors.ZeroAddress.selector);
        vault.rescueStrategyToken(address(0), address(arb));

        vm.expectRevert(Errors.ZeroAddress.selector);
        vault.rescueStrategyToken(address(strategy), address(0));
        vm.stopPrank();
    }

    function test_rescueStrategyToken_onlyOwner() public {
        arb.mint(address(strategy), 100e18);

        vm.prank(alice);
        vm.expectRevert(); // Ownable unauthorized
        vault.rescueStrategyToken(address(strategy), address(arb));
    }
}
