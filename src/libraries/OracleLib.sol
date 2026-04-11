// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IChainlinkAggregator} from "../interfaces/IChainlinkAggregator.sol";
import {Errors} from "./Errors.sol";
import {Constants} from "./Constants.sol";

library OracleLib {
    uint256 internal constant STALENESS_THRESHOLD = 3600; // 1 hour
    uint256 internal constant SEQUENCER_GRACE_PERIOD = 3600; // 1 hour

    // Plausibility bounds for a USD-pair Chainlink feed (8 decimals).
    // MIN_PRICE_8DEC: $0.0001 — rejects "zero" and aggregator min-circuit-breaker pins.
    // MAX_PRICE_8DEC: $1_000_000 — rejects aggregator max-circuit-breaker pins for
    // any asset in this vault (USDC, ARB, ETH); adjust per-feed if a new asset is added.
    int256 internal constant MIN_PRICE_8DEC = 1e4;
    int256 internal constant MAX_PRICE_8DEC = 1e14;

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

    /// @notice Get price from Chainlink feed with staleness, sequencer, round-completeness
    ///         and plausibility-bound checks. Reverts on any failure — callers rely on
    ///         this function as the single source of oracle truth.
    /// @param feed Chainlink aggregator address
    /// @return price Price scaled to feed decimals (8 for USD pairs)
    function getPrice(IChainlinkAggregator feed) internal view returns (uint256 price) {
        checkSequencer();

        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) =
            feed.latestRoundData();

        // Reject incomplete or stale rounds — an `answeredInRound` older than `roundId`
        // means the aggregator is carrying forward a prior round's answer.
        if (updatedAt == 0) revert Errors.OracleStaleRound();
        if (answeredInRound < roundId) revert Errors.OracleStaleRound();

        if (answer <= 0) revert Errors.OracleNegativePrice();
        if (answer < MIN_PRICE_8DEC || answer > MAX_PRICE_8DEC) {
            revert Errors.OraclePriceOutOfBounds();
        }

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
