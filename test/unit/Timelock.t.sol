// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Timelock} from "../../src/core/Timelock.sol";
import {Errors} from "../../src/libraries/Errors.sol";

contract TimelockTest is Test {
    Timelock public timelock;
    address public admin = address(0x1);
    address public target = address(0x2);

    function setUp() public {
        vm.prank(admin);
        timelock = new Timelock(admin, 24 hours);
    }

    function test_constructor_setsAdmin() public view {
        assertEq(timelock.admin(), admin);
        assertEq(timelock.delay(), 24 hours);
    }

    function test_constructor_revertsOnShortDelay() public {
        vm.expectRevert(Errors.TimelockDelayOutOfRange.selector);
        new Timelock(admin, 1 hours);
    }

    function test_queueAndExecute() public {
        vm.startPrank(admin);

        uint256 eta = block.timestamp + 24 hours + 1;
        bytes32 txHash = timelock.queueTransaction(target, 0, "", "", eta);

        assertTrue(timelock.queuedTransactions(txHash));

        vm.warp(eta);
        timelock.executeTransaction(target, 0, "", "", eta);

        assertFalse(timelock.queuedTransactions(txHash));
        vm.stopPrank();
    }

    function test_execute_revertsBeforeEta() public {
        vm.startPrank(admin);

        uint256 eta = block.timestamp + 24 hours + 1;
        timelock.queueTransaction(target, 0, "", "", eta);

        vm.expectRevert(Errors.TimelockDelayNotMet.selector);
        timelock.executeTransaction(target, 0, "", "", eta);

        vm.stopPrank();
    }

    function test_execute_revertsAfterGracePeriod() public {
        vm.startPrank(admin);

        uint256 eta = block.timestamp + 24 hours + 1;
        timelock.queueTransaction(target, 0, "", "", eta);

        vm.warp(eta + 14 days + 1); // Past grace period
        vm.expectRevert(Errors.TimelockTxExpired.selector);
        timelock.executeTransaction(target, 0, "", "", eta);

        vm.stopPrank();
    }

    function test_cancel() public {
        vm.startPrank(admin);

        uint256 eta = block.timestamp + 24 hours + 1;
        bytes32 txHash = timelock.queueTransaction(target, 0, "", "", eta);
        assertTrue(timelock.queuedTransactions(txHash));

        timelock.cancelTransaction(target, 0, "", "", eta);
        assertFalse(timelock.queuedTransactions(txHash));

        vm.stopPrank();
    }

    function test_onlyAdmin() public {
        vm.prank(address(0xdead));
        vm.expectRevert("Timelock: !admin");
        timelock.queueTransaction(target, 0, "", "", block.timestamp + 25 hours);
    }
}
