// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IStrategy} from "../interfaces/IStrategy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Errors} from "../libraries/Errors.sol";
import {Constants} from "../libraries/Constants.sol";

/// @title StrategyManager
/// @notice Manages strategy registry, allocation targets, and rebalancing.
///         Owned by the vault — only the vault can call mutative functions.
contract StrategyManager is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_STRATEGIES = 10;

    struct StrategyConfig {
        address strategy;
        uint256 allocationBps; // Target allocation in basis points (out of 10,000)
        bool active;
        uint256 lastHarvest;
    }

    address public immutable vault;
    IERC20 public immutable usdc;

    StrategyConfig[] public strategies;
    mapping(address => uint256) public strategyIndex;
    mapping(address => bool) public isStrategy;

    uint256 public totalAllocationBps;

    event StrategyAdded(address indexed strategy, uint256 allocationBps);
    event StrategyRemoved(address indexed strategy);
    event AllocationUpdated(address indexed strategy, uint256 oldBps, uint256 newBps);
    event Rebalanced(uint256 totalDeployed);
    event StrategyHarvested(address indexed strategy, uint256 profit);

    modifier onlyVault() {
        if (msg.sender != vault) revert Errors.NotVault();
        _;
    }

    constructor(address vault_, address usdc_) {
        if (vault_ == address(0) || usdc_ == address(0)) revert Errors.ZeroAddress();
        vault = vault_;
        usdc = IERC20(usdc_);
    }

    // ─── Strategy Registry ───

    function addStrategy(address strategy, uint256 allocationBps) external onlyVault {
        if (isStrategy[strategy]) revert Errors.StrategyAlreadyExists();
        if (strategies.length >= MAX_STRATEGIES) revert Errors.MaxStrategiesReached();
        if (totalAllocationBps + allocationBps > Constants.MAX_BPS) revert Errors.AllocationMismatch();

        strategyIndex[strategy] = strategies.length;
        strategies.push(
            StrategyConfig({strategy: strategy, allocationBps: allocationBps, active: true, lastHarvest: block.timestamp})
        );
        isStrategy[strategy] = true;
        totalAllocationBps += allocationBps;

        emit StrategyAdded(strategy, allocationBps);
    }

    function removeStrategy(address strategy) external onlyVault nonReentrant {
        if (!isStrategy[strategy]) revert Errors.StrategyNotFound();

        uint256 idx = strategyIndex[strategy];
        StrategyConfig storage config = strategies[idx];

        // CEI: update state BEFORE external call to prevent reentrancy
        uint256 oldAllocation = config.allocationBps;
        totalAllocationBps -= oldAllocation;
        config.active = false;
        config.allocationBps = 0;
        isStrategy[strategy] = false;

        emit StrategyRemoved(strategy);

        // External call AFTER state updates
        uint256 assets = IStrategy(strategy).totalAssets();
        if (assets > 0) {
            IStrategy(strategy).emergencyWithdraw();
        }
    }

    function setAllocation(address strategy, uint256 newBps) external onlyVault {
        if (!isStrategy[strategy]) revert Errors.StrategyNotFound();

        uint256 idx = strategyIndex[strategy];
        StrategyConfig storage config = strategies[idx];
        uint256 oldBps = config.allocationBps;

        totalAllocationBps = totalAllocationBps - oldBps + newBps;
        if (totalAllocationBps > Constants.MAX_BPS) revert Errors.AllocationMismatch();

        config.allocationBps = newBps;

        emit AllocationUpdated(strategy, oldBps, newBps);
    }

    // ─── Rebalancing ───

    /// @notice Deploy idle USDC to strategies according to allocation targets
    /// @param totalVaultAssets Total assets in the vault (idle + deployed)
    /// @param idleUsdc Amount of idle USDC available to deploy
    /// @return totalDeployed Total USDC deployed across all strategies
    function rebalance(uint256 totalVaultAssets, uint256 idleUsdc) external onlyVault nonReentrant returns (uint256 totalDeployed) {
        uint256 len = strategies.length;

        for (uint256 i; i < len;) {
            StrategyConfig storage config = strategies[i];
            if (!config.active) {
                unchecked { ++i; }
                continue;
            }

            IStrategy strat = IStrategy(config.strategy);
            uint256 targetAmount = (totalVaultAssets * config.allocationBps) / Constants.MAX_BPS;
            uint256 currentAmount = strat.totalAssets();

            if (currentAmount < targetAmount && strat.canDeposit()) {
                uint256 deficit = targetAmount - currentAmount;
                uint256 toDeposit = deficit > idleUsdc ? idleUsdc : deficit;

                if (toDeposit > 0) {
                    // Transfer USDC from vault to this contract, then approve strategy
                    usdc.safeTransferFrom(vault, address(this), toDeposit);
                    usdc.safeIncreaseAllowance(config.strategy, toDeposit);
                    uint256 deployed = strat.deposit(toDeposit);
                    totalDeployed += deployed;
                    idleUsdc -= toDeposit;
                }
            }

            unchecked { ++i; }
        }

        emit Rebalanced(totalDeployed);
    }

    /// @notice Withdraw USDC from strategies to meet a withdrawal request
    /// @param amount USDC needed
    /// @return withdrawn Total USDC actually withdrawn
    function withdrawFromStrategies(uint256 amount) external onlyVault nonReentrant returns (uint256 withdrawn) {
        uint256 remaining = amount;
        uint256 len = strategies.length;

        // Withdraw proportionally from each strategy
        for (uint256 i; i < len && remaining > 0;) {
            StrategyConfig storage config = strategies[i];
            if (!config.active) {
                unchecked { ++i; }
                continue;
            }

            IStrategy strat = IStrategy(config.strategy);
            uint256 stratAssets = strat.totalAssets();

            if (stratAssets > 0) {
                // Withdraw proportional share, capped at strategy's total
                uint256 toWithdraw = remaining > stratAssets ? stratAssets : remaining;
                uint256 got = strat.withdraw(toWithdraw);
                withdrawn += got;
                remaining = got >= remaining ? 0 : remaining - got;
            }

            unchecked { ++i; }
        }
    }

    // ─── Harvesting ───

    /// @notice Harvest all active strategies
    /// @return totalProfit Combined USDC profit
    function harvestAll() external onlyVault nonReentrant returns (uint256 totalProfit) {
        uint256 len = strategies.length;

        for (uint256 i; i < len;) {
            StrategyConfig storage config = strategies[i];
            if (!config.active) {
                unchecked { ++i; }
                continue;
            }

            uint256 profit = IStrategy(config.strategy).harvest();
            if (profit > 0) {
                totalProfit += profit;
                emit StrategyHarvested(config.strategy, profit);
            }
            config.lastHarvest = block.timestamp;

            unchecked { ++i; }
        }
    }

    /// @notice Emergency withdraw from all strategies
    /// @return totalRecovered Total USDC recovered
    function emergencyWithdrawAll() external onlyVault nonReentrant returns (uint256 totalRecovered) {
        uint256 len = strategies.length;

        for (uint256 i; i < len;) {
            StrategyConfig storage config = strategies[i];
            if (!config.active) {
                unchecked { ++i; }
                continue;
            }

            // Clear state BEFORE external call (CEI)
            address stratAddr = config.strategy;
            totalAllocationBps -= config.allocationBps;
            config.active = false;
            config.allocationBps = 0;
            isStrategy[stratAddr] = false;

            uint256 recovered = IStrategy(stratAddr).emergencyWithdraw();
            totalRecovered += recovered;

            unchecked { ++i; }
        }
    }

    // ─── View Functions ───

    /// @notice Sum of all strategy totalAssets()
    function totalDeployedAssets() external view returns (uint256 total) {
        uint256 len = strategies.length;
        for (uint256 i; i < len;) {
            if (strategies[i].active) {
                total += IStrategy(strategies[i].strategy).totalAssets();
            }
            unchecked { ++i; }
        }
    }

    /// @notice Get count of strategies
    function strategyCount() external view returns (uint256) {
        return strategies.length;
    }

    /// @notice Get all strategy addresses and their health factors
    function getStrategyHealth() external view returns (address[] memory addrs, uint256[] memory healths) {
        uint256 len = strategies.length;
        addrs = new address[](len);
        healths = new uint256[](len);

        for (uint256 i; i < len;) {
            addrs[i] = strategies[i].strategy;
            if (strategies[i].active) {
                healths[i] = IStrategy(strategies[i].strategy).healthFactor();
            }
            unchecked { ++i; }
        }
    }
}
