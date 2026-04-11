// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IStrategy} from "../interfaces/IStrategy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Errors} from "../libraries/Errors.sol";

/// @title BaseStrategy
/// @notice Abstract base for all vault strategies.
///         The StrategyManager (manager) is authorized to call mutative functions.
///         USDC returns (withdraw/harvest/emergency) are sent directly to the vault.
abstract contract BaseStrategy is IStrategy, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable vault;   // YieldVault — receives USDC returns
    address public immutable manager; // StrategyManager — authorized caller
    IERC20 public immutable usdc;

    modifier onlyManager() {
        if (msg.sender != manager) revert Errors.NotVault();
        _;
    }

    constructor(address vault_, address manager_, address usdc_) {
        if (vault_ == address(0) || manager_ == address(0) || usdc_ == address(0)) {
            revert Errors.ZeroAddress();
        }
        vault = vault_;
        manager = manager_;
        usdc = IERC20(usdc_);
    }

    /// @inheritdoc IStrategy
    function deposit(uint256 amount) external onlyManager nonReentrant returns (uint256 deployed) {
        if (amount == 0) revert Errors.ZeroAmount();
        // Pull USDC from StrategyManager (who pre-approved this contract)
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        deployed = _deposit(amount);
    }

    /// @inheritdoc IStrategy
    function withdraw(uint256 amount) external onlyManager nonReentrant returns (uint256 withdrawn) {
        if (amount == 0) revert Errors.ZeroAmount();
        withdrawn = _withdraw(amount);
        // Send USDC directly to the vault (not the manager)
        usdc.safeTransfer(vault, withdrawn);
    }

    /// @inheritdoc IStrategy
    function harvest() external onlyManager nonReentrant returns (uint256 profit) {
        profit = _harvest();
        if (profit > 0) {
            usdc.safeTransfer(vault, profit);
        }
    }

    /// @inheritdoc IStrategy
    function emergencyWithdraw() external onlyManager nonReentrant returns (uint256 recovered) {
        recovered = _emergencyWithdraw();
        uint256 bal = usdc.balanceOf(address(this));
        if (bal > 0) {
            usdc.safeTransfer(vault, bal);
        }
    }

    /// @notice Sweep a non-USDC ERC20 balance (e.g. stranded reward token) to the vault.
    ///         Vault-gated so governance can recover reward tokens that accrued before
    ///         the harvest path could sweep them, or after the strategy is retired.
    ///         USDC is excluded — it is always handled via withdraw/emergencyWithdraw.
    function rescueToken(address token) external {
        if (msg.sender != vault) revert Errors.NotVault();
        if (token == address(usdc)) revert Errors.ZeroAmount();
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal > 0) {
            IERC20(token).safeTransfer(vault, bal);
        }
    }

    /// @notice Override: deploy USDC into the underlying protocol
    function _deposit(uint256 amount) internal virtual returns (uint256 deployed);

    /// @notice Override: pull USDC out of the underlying protocol
    function _withdraw(uint256 amount) internal virtual returns (uint256 withdrawn);

    /// @notice Override: claim and convert yield to USDC
    function _harvest() internal virtual returns (uint256 profit);

    /// @notice Override: emergency unwind all positions
    function _emergencyWithdraw() internal virtual returns (uint256 recovered);
}
