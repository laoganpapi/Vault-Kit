// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {YieldVault} from "../../src/core/YieldVault.sol";
import {Timelock} from "../../src/core/Timelock.sol";
import {MockERC20} from "../helpers/MockERC20.sol";

contract DepositWithdrawFuzzTest is Test {
    YieldVault public vault;
    MockERC20 public usdc;

    address public deployer = address(0x1);
    address public guardian = address(0x2);
    address public feeRecipient = address(0x3);

    function setUp() public {
        vm.startPrank(deployer);
        usdc = new MockERC20("USDC", "USDC", 6);
        Timelock timelock = new Timelock(deployer, 24 hours);
        vault = new YieldVault(IERC20(address(usdc)), address(timelock), guardian, deployer, feeRecipient);
        vm.stopPrank();
    }

    /// @notice Deposit then full redeem should return at least deposit - maxFee - rounding
    function testFuzz_depositRedeemRoundtrip(uint256 amount) public {
        // Bound to valid range: 1 USDC to 10M USDC
        amount = bound(amount, 1e6, 10_000_000e6);

        address user = address(0xA);
        usdc.mint(user, amount);

        vm.startPrank(user);
        usdc.approve(address(vault), amount);
        uint256 shares = vault.deposit(amount, user);

        uint256 assetsBack = vault.redeem(shares, user, user);
        vm.stopPrank();

        // assetsBack is NET (after 0.1% fee deducted by previewRedeem).
        // Gross = assetsBack * 10_000 / 9_990.
        // User should get back at least ~99.9% of deposit minus rounding.
        uint256 minExpected = amount - (amount * 10 / 10_000) - 2;
        assertGe(assetsBack, minExpected, "Roundtrip should preserve capital minus fee");
    }

    /// @notice Multiple deposits and redeems should maintain share price invariant
    function testFuzz_multipleDepositsSharePrice(uint256 amount1, uint256 amount2) public {
        amount1 = bound(amount1, 1e6, 5_000_000e6);
        amount2 = bound(amount2, 1e6, 5_000_000e6);

        address user1 = address(0xA);
        address user2 = address(0xB);

        usdc.mint(user1, amount1);
        usdc.mint(user2, amount2);

        vm.prank(user1);
        usdc.approve(address(vault), amount1);
        vm.prank(user2);
        usdc.approve(address(vault), amount2);

        vm.prank(user1);
        vault.deposit(amount1, user1);

        vm.prank(user2);
        vault.deposit(amount2, user2);

        // Total assets should equal sum of deposits
        assertEq(vault.totalAssets(), amount1 + amount2, "Total assets = sum of deposits");

        // Share ratio should be preserved
        uint256 shares1 = vault.balanceOf(user1);
        uint256 shares2 = vault.balanceOf(user2);

        // shares1/shares2 ≈ amount1/amount2 (within rounding)
        if (amount1 > 0 && amount2 > 0) {
            uint256 ratio1 = (shares1 * 1e18) / amount1;
            uint256 ratio2 = (shares2 * 1e18) / amount2;
            // Allow 0.01% deviation for rounding
            assertApproxEqRel(ratio1, ratio2, 1e14, "Share ratios should be approximately equal");
        }
    }

    /// @notice Deposit zero should revert
    function testFuzz_depositZeroReverts(address user) public {
        vm.assume(user != address(0));
        vm.prank(user);
        vm.expectRevert();
        vault.deposit(0, user);
    }
}
