// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IStrategy} from "../../src/interfaces/IStrategy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Strategy stub that reverts on deposit but behaves normally otherwise.
///         Used to verify that `StrategyManager.rebalance` continues iterating past a
///         reverting strategy (the fix for EVMBENCH_AUDIT.md finding "Rebalance DOS").
contract RevertingMockStrategy is IStrategy {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    address public immutable vault;

    bool public depositShouldRevert = true;
    string public revertMessage = "RevertingMockStrategy: deposit disabled";

    uint256 public depositAttempts;

    constructor(address usdc_, address vault_) {
        usdc = IERC20(usdc_);
        vault = vault_;
    }

    function name() external pure override returns (string memory) {
        return "Reverting Mock Strategy";
    }

    function deposit(uint256) external override returns (uint256) {
        depositAttempts++;
        if (depositShouldRevert) {
            revert(revertMessage);
        }
        return 0;
    }

    function withdraw(uint256 amount) external override returns (uint256) {
        uint256 bal = usdc.balanceOf(address(this));
        if (amount > bal) amount = bal;
        if (amount > 0) usdc.safeTransfer(vault, amount);
        return amount;
    }

    function harvest() external pure override returns (uint256) {
        return 0;
    }

    function emergencyWithdraw() external override returns (uint256 recovered) {
        recovered = usdc.balanceOf(address(this));
        if (recovered > 0) usdc.safeTransfer(vault, recovered);
    }

    function totalAssets() external view override returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    function healthFactor() external pure override returns (uint256) {
        return type(uint256).max;
    }

    function canDeposit() external pure override returns (bool) {
        return true;
    }

    // ─── Test helpers ───

    function setDepositShouldRevert(bool val) external {
        depositShouldRevert = val;
    }

    function setRevertMessage(string calldata msg_) external {
        revertMessage = msg_;
    }
}
