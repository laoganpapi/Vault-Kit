// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BaseStrategy} from "../../src/strategies/BaseStrategy.sol";
import {Errors} from "../../src/libraries/Errors.sol";
import {MockERC20} from "../helpers/MockERC20.sol";

/// @notice Concrete no-op BaseStrategy used to exercise `rescueToken` gating and behavior.
contract NoopBaseStrategy is BaseStrategy {
    constructor(address vault_, address manager_, address usdc_) BaseStrategy(vault_, manager_, usdc_) {}

    function name() external pure override returns (string memory) {
        return "Noop";
    }

    function totalAssets() external pure override returns (uint256) {
        return 0;
    }

    function healthFactor() external pure override returns (uint256) {
        return type(uint256).max;
    }

    function canDeposit() external pure override returns (bool) {
        return true;
    }

    function _deposit(uint256 amount) internal pure override returns (uint256) {
        return amount;
    }

    function _withdraw(uint256 amount) internal pure override returns (uint256) {
        return amount;
    }

    function _harvest() internal pure override returns (uint256) {
        return 0;
    }

    function _emergencyWithdraw() internal pure override returns (uint256) {
        return 0;
    }
}

contract BaseStrategyRescueTest is Test {
    NoopBaseStrategy internal strat;
    MockERC20 internal usdc;
    MockERC20 internal arb;
    address internal vault = address(0xAAAA);
    address internal manager = address(0xBBBB);
    address internal alice = address(0xCCCC);

    function setUp() public {
        usdc = new MockERC20("USDC", "USDC", 6);
        arb = new MockERC20("ARB", "ARB", 18);
        strat = new NoopBaseStrategy(vault, manager, address(usdc));
    }

    function test_rescueToken_sweepsToVault() public {
        arb.mint(address(strat), 77e18);

        vm.prank(vault);
        strat.rescueToken(address(arb));

        assertEq(arb.balanceOf(address(strat)), 0);
        assertEq(arb.balanceOf(vault), 77e18);
    }

    function test_rescueToken_rejectsNonVaultCaller() public {
        arb.mint(address(strat), 10e18);

        vm.prank(alice);
        vm.expectRevert(Errors.NotVault.selector);
        strat.rescueToken(address(arb));

        vm.prank(manager);
        vm.expectRevert(Errors.NotVault.selector);
        strat.rescueToken(address(arb));
    }

    function test_rescueToken_rejectsUsdc() public {
        usdc.mint(address(strat), 100e6);

        vm.prank(vault);
        vm.expectRevert(Errors.ZeroAmount.selector);
        strat.rescueToken(address(usdc));
    }

    function test_rescueToken_zeroBalanceIsNoOp() public {
        // No pre-mint; call should not revert, just transfer nothing
        vm.prank(vault);
        strat.rescueToken(address(arb));
        assertEq(arb.balanceOf(vault), 0);
    }
}
