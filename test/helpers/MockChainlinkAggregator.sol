// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IChainlinkAggregator} from "../../src/interfaces/IChainlinkAggregator.sol";

/// @notice Test mock for a Chainlink aggregator. Supports setting every field the
///         OracleLib checks so each edge case can be exercised in isolation.
contract MockChainlinkAggregator is IChainlinkAggregator {
    uint8 public override decimals = 8;

    uint80 internal _roundId = 1;
    int256 internal _answer = 1e8; // $1 by default
    uint256 internal _startedAt;
    uint256 internal _updatedAt;
    uint80 internal _answeredInRound = 1;

    constructor() {
        _startedAt = block.timestamp;
        _updatedAt = block.timestamp;
    }

    function latestRoundData()
        external
        view
        override
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (_roundId, _answer, _startedAt, _updatedAt, _answeredInRound);
    }

    // ─── Test setters ───

    function setAnswer(int256 a) external {
        _answer = a;
    }

    function setRound(uint80 roundId_, uint80 answeredIn_) external {
        _roundId = roundId_;
        _answeredInRound = answeredIn_;
    }

    function setTimestamps(uint256 startedAt_, uint256 updatedAt_) external {
        _startedAt = startedAt_;
        _updatedAt = updatedAt_;
    }

    function setFullState(
        uint80 roundId_,
        int256 answer_,
        uint256 startedAt_,
        uint256 updatedAt_,
        uint80 answeredInRound_
    ) external {
        _roundId = roundId_;
        _answer = answer_;
        _startedAt = startedAt_;
        _updatedAt = updatedAt_;
        _answeredInRound = answeredInRound_;
    }

    function setDecimals(uint8 d) external {
        decimals = d;
    }
}
