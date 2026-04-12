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
    event StrategyDepositFailed(address indexed strategy, uint256 attemptedAmount, bytes reason);
    event StrategyHarvestFailed(address indexed strategy, bytes reason);
    event StrategyEmergencyWithdrawFailed(address indexed strategy, bytes reason);
    event StrategyWithdrawFailed(address indexed strategy, uint256 attemptedAmount, bytes reason);

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
                    // Pull USDC from vault into the manager, then call the strategy under
                    // try/catch so one broken strategy cannot DOS rebalance for all others.
                    // On revert, refund the pulled USDC back to the vault and emit an event
                    // so keepers/monitoring can surface the failure.
                    usdc.safeTransferFrom(vault, address(this), toDeposit);
                    usdc.safeIncreaseAllowance(config.strategy, toDeposit);
                    try strat.deposit(toDeposit) returns (uint256 deployed) {
                        totalDeployed += deployed;
                        idleUsdc -= toDeposit;
                    } catch (bytes memory reason) {
                        // Reset any unused allowance and return funds to the vault.
                        usdc.forceApprove(config.strategy, 0);
                        usdc.safeTransfer(vault, toDeposit);
                        emit StrategyDepositFailed(config.strategy, toDeposit, reason);
                    }
                }
            }

            unchecked { ++i; }
        }

        emit Rebalanced(totalDeployed);
    }

    /// @notice Withdraw USDC from strategies to meet a withdrawal request.
    /// @dev    Per-strategy failures are isolated with try/catch so one broken strategy
    ///         cannot DOS the user's withdrawal. If the total withdrawn is less than
    ///         requested, the caller (`YieldVault._ensureIdle`) relies on the subsequent
    ///         safeTransfer to revert atomically; the user keeps their shares.
    /// @param  amount    USDC needed
    /// @return withdrawn Total USDC actually withdrawn (may be less than `amount`)
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
                try strat.withdraw(toWithdraw) returns (uint256 got) {
                    withdrawn += got;
                    remaining = got >= remaining ? 0 : remaining - got;
                } catch (bytes memory reason) {
                    emit StrategyWithdrawFailed(config.strategy, toWithdraw, reason);
                    // Move on — another strategy may be able to fulfill the remainder.
                }
            }

            unchecked { ++i; }
        }
    }

    // ─── Harvesting ───

    /// @notice Harvest all active strategies. Individual strategy failures are isolated
    ///         with try/catch so that one broken strategy cannot DOS the entire harvest
    ///         pipeline — an important property because `YieldVault.harvest` also calls
    ///         `rebalance` afterwards, and both should still run if one strategy is stuck.
    /// @return totalProfit Combined USDC profit (only from strategies that harvested successfully)
    function harvestAll() external onlyVault nonReentrant returns (uint256 totalProfit) {
        uint256 len = strategies.length;

        for (uint256 i; i < len;) {
            StrategyConfig storage config = strategies[i];
            if (!config.active) {
                unchecked { ++i; }
                continue;
            }

            try IStrategy(config.strategy).harvest() returns (uint256 profit) {
                if (profit > 0) {
                    totalProfit += profit;
                    emit StrategyHarvested(config.strategy, profit);
                }
                config.lastHarvest = block.timestamp;
            } catch (bytes memory reason) {
                emit StrategyHarvestFailed(config.strategy, reason);
                // Do not advance lastHarvest — the strategy will be retried next cycle.
            }

            unchecked { ++i; }
        }
    }

    /// @notice Emergency withdraw from all strategies. Individual strategy failures are
    ///         isolated with try/catch so that one broken strategy cannot block recovery of
    ///         funds from the rest of the vault — this is the most critical property of
    ///         the entire contract: under adverse conditions the guardian must always be
    ///         able to retrieve as much capital as possible, even if one strategy is stuck.
    ///         Strategies whose emergencyWithdraw fails remain marked inactive (state was
    ///         already cleared pre-call) so they cannot receive more capital; an event is
    ///         emitted so off-chain tooling can surface the stuck position for manual recovery.
    /// @return totalRecovered Total USDC recovered across all strategies
    function emergencyWithdrawAll() external onlyVault nonReentrant returns (uint256 totalRecovered) {
        uint256 len = strategies.length;

        for (uint256 i; i < len;) {
            StrategyConfig storage config = strategies[i];
            if (!config.active) {
                unchecked { ++i; }
                continue;
            }

            // Clear state BEFORE external call (CEI) — even if the call reverts and is
            // caught below, the strategy is permanently retired from the active set.
            address stratAddr = config.strategy;
            totalAllocationBps -= config.allocationBps;
            config.active = false;
            config.allocationBps = 0;
            isStrategy[stratAddr] = false;

            try IStrategy(stratAddr).emergencyWithdraw() returns (uint256 recovered) {
                totalRecovered += recovered;
            } catch (bytes memory reason) {
                emit StrategyEmergencyWithdrawFailed(stratAddr, reason);
                // Continue to the next strategy — the guardian prioritizes recovery breadth
                // over any individual stuck position. Stuck funds can be handled via the
                // vault's `rescueStrategyToken` passthrough after the emergency stabilizes.
            }

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
