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

/// @title AaveLeverageStrategy
/// @notice Loops USDC on Aave V3: supply → borrow → supply (up to 5 loops at 70% LTV).
///         Earns net supply-borrow spread + ARB incentive rewards.
///         Health factor floor: 1.8x (revert on deposit if breached), emergency at 1.5x.
contract AaveLeverageStrategy is BaseStrategy {
    using SafeERC20 for IERC20;

    // ─── Constants ───
    uint256 public constant TARGET_LTV_BPS = 7_000; // 70% LTV target per loop
    uint256 public constant MAX_LOOPS = 5; // Same-asset loop: no price-based liquidation risk
    uint256 public constant MIN_HEALTH_FACTOR = 2.0e18; // Safe buffer for Aave governance changes
    uint256 public constant EMERGENCY_HEALTH_FACTOR = 1.5e18; // Unwind floor
    uint256 public constant MAX_SLIPPAGE_BPS = 10; // 0.1% for reward swaps

    // ─── Immutables ───
    IAavePool public immutable aavePool;
    IAaveRewardsController public immutable rewardsController;
    ISwapRouter public immutable swapRouter;
    IERC20 public immutable aUsdc;
    IERC20 public immutable debtUsdc;
    IERC20 public immutable arbToken;

    // ─── Events ───
    event Looped(uint256 loops, uint256 totalSupplied, uint256 totalBorrowed);
    event Unlooped(uint256 repaid, uint256 withdrawn);
    event RewardsClaimed(uint256 arbAmount, uint256 usdcReceived);

    constructor(address vault_, address manager_, address usdc_)
        BaseStrategy(vault_, manager_, usdc_)
    {
        aavePool = IAavePool(Constants.AAVE_POOL);
        rewardsController = IAaveRewardsController(Constants.AAVE_REWARDS);
        swapRouter = ISwapRouter(Constants.UNISWAP_ROUTER);
        aUsdc = IERC20(Constants.AAVE_AUSDC);
        debtUsdc = IERC20(Constants.AAVE_VARIABLE_DEBT_USDC);
        arbToken = IERC20(Constants.ARB);

        // Approve Aave pool to pull USDC for supply and repay
        IERC20(usdc_).approve(Constants.AAVE_POOL, type(uint256).max);
        // Approve swap router for ARB → USDC swaps
        IERC20(Constants.ARB).approve(Constants.UNISWAP_ROUTER, type(uint256).max);
    }

    // ─── IStrategy ───

    function name() external pure override returns (string memory) {
        return "Aave USDC Leverage Loop";
    }

    function totalAssets() external view override returns (uint256) {
        // Net position = aToken balance - variable debt balance
        uint256 supplied = aUsdc.balanceOf(address(this));
        uint256 borrowed = debtUsdc.balanceOf(address(this));
        return supplied > borrowed ? supplied - borrowed : 0;
    }

    function healthFactor() public view override returns (uint256) {
        (,,,,, uint256 hf) = aavePool.getUserAccountData(address(this));
        return hf;
    }

    function canDeposit() external view override returns (bool) {
        uint256 hf = healthFactor();
        // Can deposit if no position yet (hf = max) or hf is healthy
        return hf == type(uint256).max || hf >= MIN_HEALTH_FACTOR;
    }

    // ─── Internal Implementation ───

    function _deposit(uint256 amount) internal override returns (uint256 deployed) {
        uint256 totalSupplied;
        uint256 totalBorrowed;

        // First supply
        aavePool.supply(address(usdc), amount, address(this), 0);
        totalSupplied = amount;

        // Loop: borrow at target LTV, re-supply
        for (uint256 i; i < MAX_LOOPS;) {
            (,, uint256 availableBorrow,,,) = aavePool.getUserAccountData(address(this));

            // Aave reports available borrows in base currency (USD, 8 decimals)
            // Convert to USDC (6 decimals): availableBorrow / 1e2
            uint256 borrowableUsdc = availableBorrow / 1e2;

            // Only borrow up to TARGET_LTV_BPS of what's available
            uint256 toBorrow = (borrowableUsdc * TARGET_LTV_BPS) / Constants.MAX_BPS;

            // Minimum borrow threshold (100 USDC) to avoid dust
            if (toBorrow < 100e6) break;

            aavePool.borrow(address(usdc), toBorrow, 2, 0, address(this)); // 2 = variable rate
            aavePool.supply(address(usdc), toBorrow, address(this), 0);

            totalSupplied += toBorrow;
            totalBorrowed += toBorrow;

            // Safety check
            uint256 hf = healthFactor();
            if (hf < MIN_HEALTH_FACTOR) revert Errors.HealthFactorTooLow();

            unchecked { ++i; }
        }

        deployed = amount; // Reported as the net capital deployed
        emit Looped(MAX_LOOPS, totalSupplied, totalBorrowed);
    }

    function _withdraw(uint256 amount) internal override returns (uint256 withdrawn) {
        // Unwind loops: withdraw → repay → withdraw → repay
        // Need to free up `amount` of net USDC

        uint256 remaining = amount;
        uint256 maxIterations = MAX_LOOPS * 3; // Safety bound
        uint256 zeroFreedCount;

        for (uint256 i; i < maxIterations && remaining > 0;) {
            uint256 debt = debtUsdc.balanceOf(address(this));

            if (debt == 0) {
                // No debt remaining, just withdraw
                uint256 directGot = aavePool.withdraw(address(usdc), remaining, address(this));
                remaining = remaining > directGot ? remaining - directGot : 0;
                withdrawn += directGot;
                break;
            }

            // Withdraw what we can without breaking health factor
            (uint256 totalCollateral, uint256 totalDebt,, uint256 currentLiquidationThreshold,,) =
                aavePool.getUserAccountData(address(this));

            // Calculate max safe withdrawal (keep hf > EMERGENCY_HEALTH_FACTOR)
            uint256 safeWithdrawBase;
            if (totalDebt > 0) {
                uint256 liqThreshold = currentLiquidationThreshold; // from getUserAccountData, scaled 1e4
                uint256 liqThresholdWad = liqThreshold * 1e14; // scale to 1e18
                uint256 minCollateral = (EMERGENCY_HEALTH_FACTOR * totalDebt) / liqThresholdWad;
                safeWithdrawBase = totalCollateral > minCollateral ? totalCollateral - minCollateral : 0;
            } else {
                safeWithdrawBase = totalCollateral;
            }

            // Convert from base (8 dec) to USDC (6 dec)
            uint256 safeWithdrawUsdc = safeWithdrawBase / 1e2;
            if (safeWithdrawUsdc == 0) break;

            uint256 toWithdraw = safeWithdrawUsdc > remaining ? remaining : safeWithdrawUsdc;
            uint256 got = aavePool.withdraw(address(usdc), toWithdraw, address(this));

            // Repay as much debt as possible with withdrawn amount
            uint256 toRepay = got > debt ? debt : got;
            if (toRepay > 0) {
                aavePool.repay(address(usdc), toRepay, 2, address(this));
            }

            uint256 netFreed = got - toRepay;
            withdrawn += netFreed;
            remaining = remaining > netFreed ? remaining - netFreed : 0;

            // Prevent infinite zero-freed loops: if two consecutive iterations
            // free nothing, the position is stuck at emergency HF — stop trying
            if (netFreed == 0) {
                zeroFreedCount++;
                if (zeroFreedCount >= 2) break;
            } else {
                zeroFreedCount = 0;
            }

            unchecked { ++i; }
        }

        emit Unlooped(amount - remaining, withdrawn);
    }

    function _harvest() internal override returns (uint256 profit) {
        // Claim ARB rewards from Aave
        address[] memory assets = new address[](2);
        assets[0] = address(aUsdc);
        assets[1] = address(debtUsdc);

        (, uint256[] memory claimed) = rewardsController.claimAllRewards(assets, address(this));

        // Swap ARB → USDC
        uint256 arbBalance = arbToken.balanceOf(address(this));
        if (arbBalance > 0) {
            // Get ARB price for slippage calculation
            uint256 arbPrice = OracleLib.getPrice(IChainlinkAggregator(Constants.CHAINLINK_ARB_USD)); // 8 dec
            uint256 usdcPrice = OracleLib.getPrice(IChainlinkAggregator(Constants.CHAINLINK_USDC_USD)); // 8 dec

            // Expected USDC out: arbBalance * arbPrice / usdcPrice, scaled 18→6 dec
            uint256 expectedUsdc = (arbBalance * arbPrice) / (usdcPrice * 1e12);
            uint256 minOut = (expectedUsdc * (Constants.MAX_BPS - MAX_SLIPPAGE_BPS)) / Constants.MAX_BPS;

            uint256 usdcReceived = swapRouter.exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn: Constants.ARB,
                    tokenOut: address(usdc),
                    fee: 3000, // 0.3% pool
                    recipient: address(this),
                    deadline: block.timestamp,
                    amountIn: arbBalance,
                    amountOutMinimum: minOut,
                    sqrtPriceLimitX96: 0
                })
            );

            profit = usdcReceived;
            emit RewardsClaimed(arbBalance, usdcReceived);
        }

        // Net interest profit is captured in totalAssets() growth (aToken rebasing)
        // We only explicitly harvest reward tokens here
    }

    function _emergencyWithdraw() internal override returns (uint256 recovered) {
        // Fully unwind all loops — repay all debt, withdraw all collateral
        uint256 maxIterations = MAX_LOOPS * 3;

        for (uint256 i; i < maxIterations;) {
            uint256 debt = debtUsdc.balanceOf(address(this));
            if (debt == 0) break;

            // Withdraw max possible
            uint256 supplied = aUsdc.balanceOf(address(this));
            if (supplied == 0) break;

            // Withdraw up to debt amount to repay
            uint256 toWithdraw = supplied > debt ? debt : supplied;
            uint256 got = aavePool.withdraw(address(usdc), toWithdraw, address(this));

            // Repay
            aavePool.repay(address(usdc), got, 2, address(this));

            unchecked { ++i; }
        }

        // Withdraw any remaining collateral
        uint256 remainingSupply = aUsdc.balanceOf(address(this));
        if (remainingSupply > 0) {
            aavePool.withdraw(address(usdc), type(uint256).max, address(this));
        }

        recovered = usdc.balanceOf(address(this));
    }
}
