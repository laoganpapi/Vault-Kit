// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IStrategy} from "../../src/interfaces/IStrategy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Deterministic mock strategy for unit testing.
///         Allows test scripts to set exact return values for each function.
contract MockStrategy is IStrategy {
    using SafeERC20 for IERC20;

    IERC20 public usdc;
    address public vault;
    address public manager;

    uint256 public mockTotalAssets;
    uint256 public mockHealthFactor = type(uint256).max;
    bool public mockCanDeposit = true;

    uint256 public depositCallCount;
    uint256 public withdrawCallCount;
    uint256 public harvestCallCount;
    uint256 public emergencyCallCount;

    // Configurable harvest profit
    uint256 public nextHarvestProfit;

    // Configurable withdrawal loss (in BPS)
    uint256 public withdrawalLossBps;

    constructor(address usdc_, address vault_, address manager_) {
        usdc = IERC20(usdc_);
        vault = vault_;
        manager = manager_;
    }

    function name() external pure override returns (string memory) {
        return "Mock Strategy";
    }

    function deposit(uint256 amount) external override returns (uint256 deployed) {
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        mockTotalAssets += amount;
        depositCallCount++;
        return amount;
    }

    function withdraw(uint256 amount) external override returns (uint256 withdrawn) {
        uint256 loss = (amount * withdrawalLossBps) / 10_000;
        withdrawn = amount - loss;

        uint256 bal = usdc.balanceOf(address(this));
        if (withdrawn > bal) withdrawn = bal;

        mockTotalAssets = mockTotalAssets > amount ? mockTotalAssets - amount : 0;
        usdc.safeTransfer(msg.sender, withdrawn);
        withdrawCallCount++;
    }

    function harvest() external override returns (uint256 profit) {
        profit = nextHarvestProfit;
        if (profit > 0) {
            uint256 bal = usdc.balanceOf(address(this));
            if (profit > bal) profit = bal;
            usdc.safeTransfer(msg.sender, profit);
            nextHarvestProfit = 0;
        }
        harvestCallCount++;
    }

    function emergencyWithdraw() external override returns (uint256 recovered) {
        recovered = usdc.balanceOf(address(this));
        if (recovered > 0) {
            usdc.safeTransfer(msg.sender, recovered);
        }
        mockTotalAssets = 0;
        emergencyCallCount++;
    }

    function totalAssets() external view override returns (uint256) {
        return mockTotalAssets;
    }

    function healthFactor() external view override returns (uint256) {
        return mockHealthFactor;
    }

    function canDeposit() external view override returns (bool) {
        return mockCanDeposit;
    }

    // ─── Test Helpers ───

    function setTotalAssets(uint256 val) external {
        mockTotalAssets = val;
    }

    function setHealthFactor(uint256 val) external {
        mockHealthFactor = val;
    }

    function setCanDeposit(bool val) external {
        mockCanDeposit = val;
    }

    function setNextHarvestProfit(uint256 val) external {
        nextHarvestProfit = val;
    }

    function setWithdrawalLoss(uint256 bps) external {
        withdrawalLossBps = bps;
    }

    // Simulate yield accrual by receiving USDC directly
    function simulateYield(uint256 amount) external {
        mockTotalAssets += amount;
    }
}
