// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseStrategy} from "./BaseStrategy.sol";
import {IAavePool, IAaveRewardsController} from "../interfaces/IAavePool.sol";
import {ISwapRouter} from "../interfaces/ISwapRouter.sol";
import {IChainlinkAggregator} from "../interfaces/IChainlinkAggregator.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Constants} from "../libraries/Constants.sol";
import {Errors} from "../libraries/Errors.sol";
import {OracleLib} from "../libraries/OracleLib.sol";

/// @title AaveSupplyStrategy
/// @notice Simplest possible strategy: supply USDC to Aave V3, earn supply APR + ARB rewards.
///         No borrowing, no leverage, no swaps (except ARB reward harvest).
///         Single external call per deposit/withdraw — minimal failure surface.
contract AaveSupplyStrategy is BaseStrategy {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_SLIPPAGE_BPS = 10; // 0.1% for ARB→USDC reward swap

    IAavePool public immutable aavePool;
    IAaveRewardsController public immutable rewardsController;
    ISwapRouter public immutable swapRouter;
    IERC20 public immutable aUsdc;
    IERC20 public immutable arbToken;

    event Supplied(uint256 amount);
    event Withdrawn(uint256 amount);
    event RewardsClaimed(uint256 arbAmount, uint256 usdcReceived);

    constructor(address vault_, address manager_, address usdc_)
        BaseStrategy(vault_, manager_, usdc_)
    {
        aavePool = IAavePool(Constants.AAVE_POOL);
        rewardsController = IAaveRewardsController(Constants.AAVE_REWARDS);
        swapRouter = ISwapRouter(Constants.UNISWAP_ROUTER);
        aUsdc = IERC20(Constants.AAVE_AUSDC);
        arbToken = IERC20(Constants.ARB);

        // Approve Aave pool to pull USDC
        IERC20(usdc_).approve(Constants.AAVE_POOL, type(uint256).max);
        // Approve swap router for ARB → USDC
        IERC20(Constants.ARB).approve(Constants.UNISWAP_ROUTER, type(uint256).max);
    }

    // ─── IStrategy ───

    function name() external pure override returns (string memory) {
        return "Aave USDC Simple Supply";
    }

    /// @notice Total assets = aUSDC balance (always accurate, no pending state)
    function totalAssets() external view override returns (uint256) {
        return aUsdc.balanceOf(address(this));
    }

    function healthFactor() external pure override returns (uint256) {
        // No borrowing = no liquidation risk = infinite health factor
        return type(uint256).max;
    }

    function canDeposit() external pure override returns (bool) {
        return true;
    }

    // ─── Internal Implementation ───

    function _deposit(uint256 amount) internal override returns (uint256 deployed) {
        aavePool.supply(address(usdc), amount, address(this), 0);
        deployed = amount;
        emit Supplied(amount);
    }

    function _withdraw(uint256 amount) internal override returns (uint256 withdrawn) {
        withdrawn = aavePool.withdraw(address(usdc), amount, address(this));
        emit Withdrawn(withdrawn);
    }

    function _harvest() internal override returns (uint256 profit) {
        // Claim ARB rewards from aUSDC
        address[] memory assets = new address[](1);
        assets[0] = address(aUsdc);

        rewardsController.claimAllRewards(assets, address(this));

        // Swap ARB → USDC
        uint256 arbBalance = arbToken.balanceOf(address(this));
        if (arbBalance > 0) {
            uint256 arbPrice = OracleLib.getPrice(IChainlinkAggregator(Constants.CHAINLINK_ARB_USD));
            uint256 usdcPrice = OracleLib.getPrice(IChainlinkAggregator(Constants.CHAINLINK_USDC_USD));

            uint256 expectedUsdc = (arbBalance * arbPrice) / (usdcPrice * 1e12);
            uint256 minOut = (expectedUsdc * (Constants.MAX_BPS - MAX_SLIPPAGE_BPS)) / Constants.MAX_BPS;

            profit = swapRouter.exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn: Constants.ARB,
                    tokenOut: address(usdc),
                    fee: 3000,
                    recipient: address(this),
                    deadline: block.timestamp,
                    amountIn: arbBalance,
                    amountOutMinimum: minOut,
                    sqrtPriceLimitX96: 0
                })
            );

            emit RewardsClaimed(arbBalance, profit);
        }

        // Supply APR accrues automatically via aUSDC rebasing — captured in totalAssets()
    }

    function _emergencyWithdraw() internal override returns (uint256 recovered) {
        uint256 aBalance = aUsdc.balanceOf(address(this));
        if (aBalance > 0) {
            aavePool.withdraw(address(usdc), type(uint256).max, address(this));
        }
        recovered = usdc.balanceOf(address(this));
    }
}
