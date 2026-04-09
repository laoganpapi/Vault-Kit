// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IChainlinkAggregator} from "../interfaces/IChainlinkAggregator.sol";
import {Errors} from "./Errors.sol";
import {Constants} from "./Constants.sol";

library OracleLib {
    uint256 internal constant STALENESS_THRESHOLD = 3600; // 1 hour
    uint256 internal constant SEQUENCER_GRACE_PERIOD = 3600; // 1 hour

    /// @notice Check Arbitrum sequencer uptime before any oracle read
    function checkSequencer() internal view {
        IChainlinkAggregator sequencer = IChainlinkAggregator(Constants.CHAINLINK_SEQUENCER_UPTIME);
        (, int256 answer, uint256 startedAt,,) = sequencer.latestRoundData();

        // answer == 0 means sequencer is up, 1 means down
        if (answer != 0) revert Errors.SequencerDown();

        // Don't trust prices right after sequencer restart
        if (block.timestamp - startedAt < SEQUENCER_GRACE_PERIOD) {
            revert Errors.GracePeriodNotOver();
        }
    }

    /// @notice Get price from Chainlink feed with staleness + sequencer checks
    /// @param feed Chainlink aggregator address
    /// @return price Price scaled to feed decimals
    function getPrice(IChainlinkAggregator feed) internal view returns (uint256 price) {
        checkSequencer();

        (, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();

        if (answer <= 0) revert Errors.OracleNegativePrice();
        if (block.timestamp - updatedAt > STALENESS_THRESHOLD) revert Errors.OracleStale();

        price = uint256(answer);
    }

    /// @notice Get price normalized to target decimals
    /// @param feed Chainlink aggregator
    /// @param feedDecimals Decimals of the feed (usually 8)
    /// @param targetDecimals Desired output decimals
    function getPriceNormalized(
        IChainlinkAggregator feed,
        uint8 feedDecimals,
        uint8 targetDecimals
    ) internal view returns (uint256) {
        uint256 price = getPrice(feed);

        if (feedDecimals > targetDecimals) {
            return price / (10 ** (feedDecimals - targetDecimals));
        } else if (feedDecimals < targetDecimals) {
            return price * (10 ** (targetDecimals - feedDecimals));
        }
        return price;
    }

    /// @notice Convert USDC amount to USD (18 decimals) using Chainlink
    function usdcToUsd(uint256 usdcAmount) internal view returns (uint256) {
        uint256 usdcPrice = getPrice(IChainlinkAggregator(Constants.CHAINLINK_USDC_USD)); // 8 decimals
        // usdcAmount (6 dec) * usdcPrice (8 dec) = 14 dec; multiply by 1e4 to get 18 dec
        return usdcAmount * usdcPrice * 1e4;
    }

}
