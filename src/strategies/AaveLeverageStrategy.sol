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
/// @notice Loops USDC on Aave V3: supply → borrow → supply (up to 6 loops, HF-bounded).
///         Earns net supply-borrow spread + ARB incentive rewards.
///         Health factor floor: 1.3x (revert on deposit if breached), emergency at 1.15x.
///         Safe for same-asset USDC loops because there is no cross-asset price risk.
contract AaveLeverageStrategy is BaseStrategy {
    using SafeERC20 for IERC20;

    // ─── Constants ───
    // Same-asset USDC loop: no price liquidation risk, so the safety buffer can be
    // tighter than for a cross-asset leverage position. MIN_HF = 1.3 gives a 30%
    // buffer above Aave's 1.0 liquidation threshold. The prior 1.8 floor combined
    // with a fixed 70% LTV-of-available made the 2nd loop unconditionally revert
    // regardless of deposit size (EVMBENCH_AUDIT.md finding 3).
    uint256 public constant MAX_LOOPS = 6;
    uint256 public constant MIN_HEALTH_FACTOR = 1.3e18; // Deposit floor; ~30% buffer
    uint256 public constant EMERGENCY_HEALTH_FACTOR = 1.15e18; // Unwind floor
    uint256 public constant MIN_LOOP_BORROW = 100e6; // Dust threshold: 100 USDC
    // 50 bps = 30 bps pool fee (0.3% tier) + 20 bps buffer; see EVMBENCH_AUDIT.md finding 1.
    uint256 public constant MAX_SLIPPAGE_BPS = 50;

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
        uint256 loopCount;
        uint256 totalBorrowed;

        // First supply
        aavePool.supply(address(usdc), amount, address(this), 0);

        // Loop: borrow up to MIN_HEALTH_FACTOR floor (not a fixed LTV fraction), re-supply.
        //
        // Safe borrow derivation:
        //   HF_after = (collateral + x) * liqThreshold / (debt + x) >= MIN_HEALTH_FACTOR
        //   Solving for x:
        //     x <= (collateral * liqThreshold - MIN_HEALTH_FACTOR * debt) / (MIN_HEALTH_FACTOR - liqThreshold)
        //
        // All values in base currency (USD, 8 decimals) from Aave. liqThreshold is bps (out of 10000).
        for (uint256 i; i < MAX_LOOPS;) {
            (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase,
             uint256 liqThresholdBps,,) = aavePool.getUserAccountData(address(this));

            // Convert MIN_HEALTH_FACTOR (1e18) and liqThresholdBps to a comparable scale.
            // Work in 1e4 units for HF to match liqThresholdBps precision:
            //   hfScaled = MIN_HEALTH_FACTOR / 1e14    (1.3e18 -> 13000 "bps-HF")
            uint256 hfScaled = MIN_HEALTH_FACTOR / 1e14;
            if (hfScaled <= liqThresholdBps) {
                // MIN_HEALTH_FACTOR below liquidation threshold — misconfigured.
                revert Errors.HealthFactorTooLow();
            }

            // Numerator in base-currency-bps units
            uint256 numerator = totalCollateralBase * liqThresholdBps;
            uint256 subtrahend = totalDebtBase * hfScaled;
            if (numerator <= subtrahend) break; // Already at or below HF floor

            uint256 safeBorrowBase = (numerator - subtrahend) / (hfScaled - liqThresholdBps);

            // Also respect Aave's LTV cap (availableBorrowsBase is already net of debt)
            if (safeBorrowBase > availableBorrowsBase) {
                safeBorrowBase = availableBorrowsBase;
            }

            // Convert base (8 dec) to USDC (6 dec)
            uint256 toBorrow = safeBorrowBase / 1e2;

            // Dust threshold — stop looping once the incremental borrow is negligible
            if (toBorrow < MIN_LOOP_BORROW) break;

            aavePool.borrow(address(usdc), toBorrow, 2, 0, address(this)); // 2 = variable rate
            aavePool.supply(address(usdc), toBorrow, address(this), 0);

            totalBorrowed += toBorrow;
            loopCount = i + 1;

            // Defense-in-depth: verify Aave's reported HF still respects the floor.
            // Using Aave's canonical calculation catches any drift between our arithmetic
            // and the pool's internal bookkeeping (rounding, reserve factors, etc.).
            uint256 hf = healthFactor();
            if (hf < MIN_HEALTH_FACTOR) revert Errors.HealthFactorTooLow();

            unchecked { ++i; }
        }

        deployed = amount; // Net capital deployed (leverage is internal)
        emit Looped(loopCount, amount + totalBorrowed, totalBorrowed);
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

        rewardsController.claimAllRewards(assets, address(this));

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
        // Fully unwind all loops. Aave rejects any withdraw that would break HF < 1, so
        // we can only withdraw a bounded slice of collateral per iteration (compute it
        // from `EMERGENCY_HEALTH_FACTOR`), then immediately repay from the freed USDC.
        // The loop converges geometrically and fully unwinds within ~2*MAX_LOOPS iterations.
        //
        // Prior version requested `min(supplied, debt)` in one shot, which Aave rejected
        // with HEALTH_FACTOR_LOWER_THAN_LIQUIDATION_THRESHOLD on any position deeper than
        // a single loop — see EVMBENCH_AUDIT.md finding 4.

        uint256 maxIterations = MAX_LOOPS * 4;
        uint256 zeroFreedCount;

        for (uint256 i; i < maxIterations;) {
            (uint256 totalCollateralBase, uint256 totalDebtBase,, uint256 liqThresholdBps,,) =
                aavePool.getUserAccountData(address(this));

            if (totalDebtBase == 0) break; // Debt cleared — exit and drain collateral below

            // Max safe withdraw keeps HF >= EMERGENCY_HEALTH_FACTOR:
            //   (collateral - x) * liqThreshold / debt >= EMERGENCY_HEALTH_FACTOR
            //   x <= collateral - (EMERGENCY_HEALTH_FACTOR * debt / liqThreshold)
            uint256 hfScaled = EMERGENCY_HEALTH_FACTOR / 1e14; // bps-HF
            uint256 minCollateralBase = (hfScaled * totalDebtBase) / liqThresholdBps;
            uint256 safeWithdrawBase =
                totalCollateralBase > minCollateralBase ? totalCollateralBase - minCollateralBase : 0;

            uint256 toWithdraw = safeWithdrawBase / 1e2; // base (8 dec) → USDC (6 dec)
            if (toWithdraw == 0) break;

            uint256 got = aavePool.withdraw(address(usdc), toWithdraw, address(this));
            if (got == 0) {
                zeroFreedCount++;
                if (zeroFreedCount >= 2) break;
                unchecked { ++i; }
                continue;
            }
            zeroFreedCount = 0;

            // Repay as much debt as possible with the freed USDC
            uint256 debtUsdcBal = debtUsdc.balanceOf(address(this));
            uint256 toRepay = got > debtUsdcBal ? debtUsdcBal : got;
            if (toRepay > 0) {
                aavePool.repay(address(usdc), toRepay, 2, address(this));
            }

            unchecked { ++i; }
        }

        // Withdraw any remaining collateral now that debt is cleared (or as much as possible).
        uint256 remainingSupply = aUsdc.balanceOf(address(this));
        if (remainingSupply > 0) {
            aavePool.withdraw(address(usdc), type(uint256).max, address(this));
        }

        recovered = usdc.balanceOf(address(this));
    }
}
