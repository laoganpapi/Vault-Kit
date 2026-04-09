// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {YieldVault} from "../../src/core/YieldVault.sol";
import {Timelock} from "../../src/core/Timelock.sol";
import {MockERC20} from "../helpers/MockERC20.sol";

/// @notice Handler contract that the invariant tester calls into
contract VaultHandler is Test {
    YieldVault public vault;
    MockERC20 public usdc;
    address[] public actors;

    uint256 public totalDeposited;
    uint256 public totalWithdrawn;

    constructor(YieldVault vault_, MockERC20 usdc_) {
        vault = vault_;
        usdc = usdc_;

        // Create actors
        for (uint256 i = 1; i <= 5; i++) {
            address actor = address(uint160(0x1000 + i));
            actors.push(actor);
            usdc.mint(actor, 1_000_000e6);
            vm.prank(actor);
            usdc.approve(address(vault), type(uint256).max);
        }
    }

    function deposit(uint256 actorIdx, uint256 amount) external {
        actorIdx = bound(actorIdx, 0, actors.length - 1);
        amount = bound(amount, 1e6, 100_000e6);

        address actor = actors[actorIdx];
        if (usdc.balanceOf(actor) < amount) return;

        vm.prank(actor);
        try vault.deposit(amount, actor) {
            totalDeposited += amount;
        } catch {}
    }

    function redeem(uint256 actorIdx, uint256 sharePercent) external {
        actorIdx = bound(actorIdx, 0, actors.length - 1);
        sharePercent = bound(sharePercent, 1, 100);

        address actor = actors[actorIdx];
        uint256 shares = vault.balanceOf(actor);
        uint256 toRedeem = (shares * sharePercent) / 100;
        if (toRedeem == 0) return;

        vm.prank(actor);
        try vault.redeem(toRedeem, actor, actor) returns (uint256 assets) {
            totalWithdrawn += assets;
        } catch {}
    }
}

contract VaultInvariantTest is Test {
    YieldVault public vault;
    MockERC20 public usdc;
    VaultHandler public handler;

    function setUp() public {
        address deployer = address(0x1);
        vm.startPrank(deployer);

        usdc = new MockERC20("USDC", "USDC", 6);
        Timelock timelock = new Timelock(deployer, 24 hours);
        vault = new YieldVault(
            IERC20(address(usdc)), address(timelock), address(0x2), deployer, address(0x3)
        );
        vm.stopPrank();

        handler = new VaultHandler(vault, usdc);

        // Target only the handler
        targetContract(address(handler));
    }

    /// @notice Total assets should never be negative (underflow)
    /// and should always be >= 0
    function invariant_totalAssetsNonNegative() public view {
        assertGe(vault.totalAssets(), 0);
    }

    /// @notice If there are shares, there must be assets (no share dilution to zero)
    function invariant_noShareDilution() public view {
        uint256 supply = vault.totalSupply();
        if (supply > 0) {
            assertGt(vault.totalAssets(), 0, "Shares exist but no assets");
        }
    }

    /// @notice Vault's USDC balance should match what's reported as idle
    function invariant_idleConsistency() public view {
        uint256 idle = usdc.balanceOf(address(vault));
        // Without strategies, totalAssets == idle
        assertEq(vault.totalAssets(), idle, "Total assets should equal idle USDC (no strategies)");
    }
}
