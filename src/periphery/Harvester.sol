// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Errors} from "../libraries/Errors.sol";

interface IYieldVault {
    function harvest() external;
    function rebalance() external;
    function totalAssets() external view returns (uint256);
    function totalSupply() external view returns (uint256);
}

/// @title Harvester
/// @notice Keeper contract for automated harvesting and rebalancing.
///         Compatible with Gelato Automate or Chainlink Automation.
///         Enforces minimum intervals between harvests to prevent griefing.
contract Harvester is Ownable2Step {
    IYieldVault public immutable vault;

    // Scale used to track share price (totalAssets * SHARE_PRICE_SCALE / totalSupply).
    // 1e18 gives enough precision for any realistic assets/shares ratio and matches ERC-4626
    // convention for exchange-rate computations.
    uint256 public constant SHARE_PRICE_SCALE = 1e18;

    uint256 public minHarvestInterval = 6 hours;
    uint256 public lastHarvestTime;

    // Last observed share price (assets per share, scaled by SHARE_PRICE_SCALE). This is
    // immune to deposit/withdraw-induced noise because both the numerator (totalAssets)
    // and denominator (totalSupply) scale together on a deposit/withdraw.
    uint256 public lastSharePrice;

    // Minimum share-price growth (in bps) required to trigger harvest. Replaces the prior
    // `minYieldThresholdBps` on raw totalAssets, which was fooled by deposits.
    uint256 public minYieldThresholdBps = 5; // 0.05% minimum share-price gain to harvest

    event HarvestExecuted(uint256 timestamp, uint256 totalAssets, uint256 sharePrice);
    event RebalanceExecuted(uint256 timestamp);
    event MinIntervalUpdated(uint256 oldInterval, uint256 newInterval);
    event MinYieldThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);

    constructor(address vault_, address owner_) Ownable(owner_) {
        if (vault_ == address(0)) revert Errors.ZeroAddress();
        vault = IYieldVault(vault_);
    }

    /// @notice Execute harvest if conditions are met
    function harvestIfNeeded() external {
        require(canHarvest(), "Harvester: conditions not met");
        _executeHarvest();
    }

    /// @notice Force harvest regardless of conditions (owner only)
    function forceHarvest() external onlyOwner {
        _executeHarvest();
    }

    /// @notice Force rebalance (owner only)
    function forceRebalance() external onlyOwner {
        vault.rebalance();
        emit RebalanceExecuted(block.timestamp);
    }

    /// @notice Current share price in `SHARE_PRICE_SCALE`-scaled units
    function currentSharePrice() public view returns (uint256) {
        uint256 supply = vault.totalSupply();
        if (supply == 0) return 0;
        return (vault.totalAssets() * SHARE_PRICE_SCALE) / supply;
    }

    /// @notice Check if harvest conditions are met (for Gelato/Chainlink keeper)
    function canHarvest() public view returns (bool) {
        // Time check
        if (block.timestamp < lastHarvestTime + minHarvestInterval) return false;

        // Yield check — only harvest if the SHARE PRICE has grown meaningfully.
        // Raw totalAssets growth would be fooled by deposits that happened since the
        // last harvest; share-price (assets/shares) ignores deposits/withdrawals by
        // construction and only grows when real yield accrues to the vault.
        uint256 current = currentSharePrice();
        if (lastSharePrice > 0) {
            uint256 growth = current > lastSharePrice ? current - lastSharePrice : 0;
            uint256 growthBps = (growth * 10_000) / lastSharePrice;
            if (growthBps < minYieldThresholdBps) return false;
        }

        return true;
    }

    /// @notice Gelato-compatible checker function
    /// @return canExec Whether to execute
    /// @return execPayload Encoded function call
    function checker() external view returns (bool canExec, bytes memory execPayload) {
        canExec = canHarvest();
        execPayload = abi.encodeCall(this.harvestIfNeeded, ());
    }

    /// @notice Chainlink Automation-compatible checkUpkeep
    function checkUpkeep(bytes calldata) external view returns (bool upkeepNeeded, bytes memory performData) {
        upkeepNeeded = canHarvest();
        performData = "";
    }

    /// @notice Chainlink Automation-compatible performUpkeep
    function performUpkeep(bytes calldata) external {
        require(canHarvest(), "Harvester: conditions not met");
        _executeHarvest();
    }

    // ─── Admin ───

    function setMinHarvestInterval(uint256 newInterval) external onlyOwner {
        require(newInterval >= 1 hours && newInterval <= 7 days, "Harvester: bad interval");
        emit MinIntervalUpdated(minHarvestInterval, newInterval);
        minHarvestInterval = newInterval;
    }

    function setMinYieldThreshold(uint256 newThresholdBps) external onlyOwner {
        require(newThresholdBps <= 100, "Harvester: threshold too high"); // Max 1%
        emit MinYieldThresholdUpdated(minYieldThresholdBps, newThresholdBps);
        minYieldThresholdBps = newThresholdBps;
    }

    // ─── Internal ───

    function _executeHarvest() internal {
        vault.harvest();
        lastHarvestTime = block.timestamp;
        uint256 sharePrice = currentSharePrice();
        lastSharePrice = sharePrice;
        emit HarvestExecuted(block.timestamp, vault.totalAssets(), sharePrice);
    }
}
