// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseStrategy} from "./BaseStrategy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title IdleStrategy
/// @notice Dead-simple cash-reserve strategy: holds USDC idle, no yield, no external
///         protocol dependencies. Useful for:
///         - Sepolia / testnet deployments where Aave / Uniswap / Chainlink may be absent
///         - Mainnet liquidity buffer (e.g. 5% allocation that can always withdraw instantly)
///         - A baseline control strategy for invariant and fork testing
///
/// Zero external calls means zero failure surface: deposit, withdraw, harvest, and
/// emergencyWithdraw all operate on this contract's own USDC balance.
contract IdleStrategy is BaseStrategy {
    using SafeERC20 for IERC20;

    constructor(address vault_, address manager_, address usdc_)
        BaseStrategy(vault_, manager_, usdc_)
    {}

    function name() external pure override returns (string memory) {
        return "Idle USDC Reserve";
    }

    function totalAssets() external view override returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    /// @notice Infinite health factor — no borrow, no liquidation risk.
    function healthFactor() external pure override returns (uint256) {
        return type(uint256).max;
    }

    function canDeposit() external pure override returns (bool) {
        return true;
    }

    // ─── Internal Implementation ───

    /// @dev USDC has already been transferred into the strategy by `BaseStrategy.deposit`
    ///      via `safeTransferFrom`. Nothing else to do.
    function _deposit(uint256 amount) internal pure override returns (uint256) {
        return amount;
    }

    /// @dev BaseStrategy.withdraw() sends the returned amount to the vault. We just need
    ///      to report how much is available to be forwarded.
    function _withdraw(uint256 amount) internal view override returns (uint256) {
        uint256 bal = usdc.balanceOf(address(this));
        return amount > bal ? bal : amount;
    }

    /// @notice No yield, no rewards — harvest is a pure no-op.
    function _harvest() internal pure override returns (uint256) {
        return 0;
    }

    /// @dev BaseStrategy.emergencyWithdraw sweeps the full USDC balance to the vault.
    ///      We report it here for the return value.
    function _emergencyWithdraw() internal view override returns (uint256) {
        return usdc.balanceOf(address(this));
    }
}
