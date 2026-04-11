// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {OracleLib} from "../../src/libraries/OracleLib.sol";
import {IChainlinkAggregator} from "../../src/interfaces/IChainlinkAggregator.sol";
import {Errors} from "../../src/libraries/Errors.sol";
import {Constants} from "../../src/libraries/Constants.sol";
import {MockChainlinkAggregator} from "../helpers/MockChainlinkAggregator.sol";

/// @notice Exposes OracleLib.getPrice to Forge tests via an external wrapper.
contract OracleLibHarness {
    function getPrice(IChainlinkAggregator feed) external view returns (uint256) {
        return OracleLib.getPrice(feed);
    }

    function checkSequencer() external view {
        OracleLib.checkSequencer();
    }
}

/// @notice Regression tests for the post-audit oracle hardening:
///         - Round-ID completeness (answeredInRound >= roundId)
///         - Plausibility bounds (MIN_PRICE_8DEC .. MAX_PRICE_8DEC)
///         - Staleness / sequencer / negative price behavior preserved
contract OracleLibTest is Test {
    OracleLibHarness internal harness;
    MockChainlinkAggregator internal feed;
    MockChainlinkAggregator internal sequencer;

    function setUp() public {
        harness = new OracleLibHarness();

        // Install a fake sequencer feed at the Constants address that reports "up" and
        // has been up for longer than the grace period.
        sequencer = new MockChainlinkAggregator();
        vm.warp(1_700_000_000); // pick a nonzero "now"
        sequencer.setFullState(1, 0, block.timestamp - 2 hours, block.timestamp - 2 hours, 1);
        vm.etch(Constants.CHAINLINK_SEQUENCER_UPTIME, address(sequencer).code);
        // Because etch copies code but not storage, re-init storage through a fresh mock
        // deployed at the canonical address via etch isn't sufficient. Use vm.mockCall instead.
        vm.mockCall(
            Constants.CHAINLINK_SEQUENCER_UPTIME,
            abi.encodeWithSelector(IChainlinkAggregator.latestRoundData.selector),
            abi.encode(uint80(1), int256(0), block.timestamp - 2 hours, block.timestamp - 2 hours, uint80(1))
        );

        // The feed under test
        feed = new MockChainlinkAggregator();
        // Default: $1 price, fresh round, roundId=answeredInRound
        feed.setFullState(100, 1e8, block.timestamp, block.timestamp, 100);
    }

    function test_getPrice_happyPath() public view {
        uint256 p = harness.getPrice(feed);
        assertEq(p, 1e8, "should return $1");
    }

    function test_getPrice_revertsOnNegativePrice() public {
        feed.setFullState(100, -1, block.timestamp, block.timestamp, 100);
        vm.expectRevert(Errors.OracleNegativePrice.selector);
        harness.getPrice(feed);
    }

    function test_getPrice_revertsOnZero() public {
        feed.setFullState(100, 0, block.timestamp, block.timestamp, 100);
        vm.expectRevert(Errors.OracleNegativePrice.selector);
        harness.getPrice(feed);
    }

    function test_getPrice_revertsOnStaleRound() public {
        // answeredInRound < roundId → stale carry-forward
        feed.setFullState(101, 1e8, block.timestamp, block.timestamp, 100);
        vm.expectRevert(Errors.OracleStaleRound.selector);
        harness.getPrice(feed);
    }

    function test_getPrice_revertsOnIncompleteRound() public {
        // updatedAt = 0 → round never completed
        feed.setFullState(100, 1e8, block.timestamp, 0, 100);
        vm.expectRevert(Errors.OracleStaleRound.selector);
        harness.getPrice(feed);
    }

    function test_getPrice_revertsOnStaleTimestamp() public {
        // updatedAt older than 1h staleness threshold
        feed.setFullState(100, 1e8, block.timestamp - 2 hours, block.timestamp - 2 hours, 100);
        vm.expectRevert(Errors.OracleStale.selector);
        harness.getPrice(feed);
    }

    function test_getPrice_revertsOnBelowMinBound() public {
        // 0.00001 in 8-dec = 1e3, below MIN_PRICE_8DEC=1e4
        feed.setFullState(100, 1e3, block.timestamp, block.timestamp, 100);
        vm.expectRevert(Errors.OraclePriceOutOfBounds.selector);
        harness.getPrice(feed);
    }

    function test_getPrice_revertsOnAboveMaxBound() public {
        // > $1M = 1e14
        feed.setFullState(100, 1e15, block.timestamp, block.timestamp, 100);
        vm.expectRevert(Errors.OraclePriceOutOfBounds.selector);
        harness.getPrice(feed);
    }

    function test_checkSequencer_revertsWhenDown() public {
        // Re-mock the sequencer to report "down"
        vm.mockCall(
            Constants.CHAINLINK_SEQUENCER_UPTIME,
            abi.encodeWithSelector(IChainlinkAggregator.latestRoundData.selector),
            abi.encode(uint80(1), int256(1), block.timestamp - 2 hours, block.timestamp - 2 hours, uint80(1))
        );
        vm.expectRevert(Errors.SequencerDown.selector);
        harness.checkSequencer();
    }

    function test_checkSequencer_revertsDuringGracePeriod() public {
        // Sequencer up but just restarted — less than grace period ago
        vm.mockCall(
            Constants.CHAINLINK_SEQUENCER_UPTIME,
            abi.encodeWithSelector(IChainlinkAggregator.latestRoundData.selector),
            abi.encode(uint80(1), int256(0), block.timestamp - 30 minutes, block.timestamp - 30 minutes, uint80(1))
        );
        vm.expectRevert(Errors.GracePeriodNotOver.selector);
        harness.checkSequencer();
    }
}
