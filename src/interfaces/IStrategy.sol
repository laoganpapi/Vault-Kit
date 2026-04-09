// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IStrategy {
    /// @notice Deploy capital into the strategy
    /// @param amount USDC amount (6 decimals)
    /// @return deployed Actual amount deployed after slippage
    function deposit(uint256 amount) external returns (uint256 deployed);

    /// @notice Withdraw capital from the strategy
    /// @param amount USDC amount requested
    /// @return withdrawn Actual USDC returned
    function withdraw(uint256 amount) external returns (uint256 withdrawn);

    /// @notice Harvest yield and return profit to caller
    /// @return profit USDC profit harvested
    function harvest() external returns (uint256 profit);

    /// @notice Current value of all assets in this strategy, denominated in USDC (6 decimals)
    function totalAssets() external view returns (uint256);

    /// @notice Current health factor (scaled 1e18; type(uint256).max if N/A)
    function healthFactor() external view returns (uint256);

    /// @notice Whether the strategy can accept deposits
    function canDeposit() external view returns (bool);

    /// @notice Emergency exit — pull all funds regardless of slippage
    function emergencyWithdraw() external returns (uint256 recovered);

    /// @notice Strategy name for identification
    function name() external view returns (string memory);
}
