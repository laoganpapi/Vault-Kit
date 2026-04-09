// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {StrategyManager} from "../../src/core/StrategyManager.sol";
import {MockERC20} from "../helpers/MockERC20.sol";
import {MockStrategy} from "../helpers/MockStrategy.sol";
import {Errors} from "../../src/libraries/Errors.sol";

contract StrategyManagerTest is Test {
    StrategyManager public sm;
    MockERC20 public usdc;
    MockStrategy public stratA;
    MockStrategy public stratB;

    address public vaultAddr = address(0x1);

    function setUp() public {
        usdc = new MockERC20("USDC", "USDC", 6);
        sm = new StrategyManager(vaultAddr, address(usdc));

        stratA = new MockStrategy(address(usdc), vaultAddr, address(sm));
        stratB = new MockStrategy(address(usdc), vaultAddr, address(sm));
    }

    function test_addStrategy() public {
        vm.prank(vaultAddr);
        sm.addStrategy(address(stratA), 5000);

        assertEq(sm.strategyCount(), 1);
        assertTrue(sm.isStrategy(address(stratA)));
        assertEq(sm.totalAllocationBps(), 5000);
    }

    function test_addStrategy_revertsDuplicate() public {
        vm.startPrank(vaultAddr);
        sm.addStrategy(address(stratA), 5000);

        vm.expectRevert(Errors.StrategyAlreadyExists.selector);
        sm.addStrategy(address(stratA), 3000);
        vm.stopPrank();
    }

    function test_addStrategy_revertsOverAllocation() public {
        vm.startPrank(vaultAddr);
        sm.addStrategy(address(stratA), 7000);

        vm.expectRevert(Errors.AllocationMismatch.selector);
        sm.addStrategy(address(stratB), 4000); // 7000 + 4000 > 10000
        vm.stopPrank();
    }

    function test_setAllocation() public {
        vm.startPrank(vaultAddr);
        sm.addStrategy(address(stratA), 5000);
        sm.setAllocation(address(stratA), 8000);

        assertEq(sm.totalAllocationBps(), 8000);
        vm.stopPrank();
    }

    function test_removeStrategy() public {
        vm.startPrank(vaultAddr);
        sm.addStrategy(address(stratA), 5000);
        sm.removeStrategy(address(stratA));

        assertFalse(sm.isStrategy(address(stratA)));
        assertEq(sm.totalAllocationBps(), 0);
        vm.stopPrank();
    }

    function test_harvestAll() public {
        vm.startPrank(vaultAddr);
        sm.addStrategy(address(stratA), 5000);
        sm.addStrategy(address(stratB), 5000);
        vm.stopPrank();

        // Set up harvest profits
        usdc.mint(address(stratA), 100e6);
        stratA.setNextHarvestProfit(100e6);
        usdc.mint(address(stratB), 200e6);
        stratB.setNextHarvestProfit(200e6);

        vm.prank(vaultAddr);
        uint256 totalProfit = sm.harvestAll();

        assertEq(totalProfit, 300e6, "Should harvest 300 USDC total");
        assertEq(stratA.harvestCallCount(), 1);
        assertEq(stratB.harvestCallCount(), 1);
    }

    function test_onlyVault() public {
        vm.prank(address(0xdead));
        vm.expectRevert(Errors.NotVault.selector);
        sm.addStrategy(address(stratA), 5000);
    }
}
