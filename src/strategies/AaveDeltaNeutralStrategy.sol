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

/// @title AaveDeltaNeutralStrategy
/// @notice Delta-neutral yield: supply wstETH to Aave, borrow ETH, sell ETH for USDC.
///         Earns wstETH staking yield + Aave spread while remaining market-neutral.
///
///         Position flow:
///         1. Swap USDC → wstETH
///         2. Supply wstETH to Aave as collateral
///         3. Borrow WETH against wstETH
///         4. Swap WETH → USDC (completes the hedge — net delta ≈ 0)
///
///         Yield sources:
///         - wstETH staking APR (~3-4%) accrues in wstETH price appreciation
///         - Aave supply incentives (ARB)
///         - Net borrow cost is offset by the staking yield spread
contract AaveDeltaNeutralStrategy is BaseStrategy {
    using SafeERC20 for IERC20;

    // ─── Constants ───
    uint256 public constant TARGET_LTV_BPS = 6_500; // 65% LTV — conservative for cross-asset
    uint256 public constant MIN_HEALTH_FACTOR = 1.8e18;
    uint256 public constant EMERGENCY_HEALTH_FACTOR = 1.5e18;
    uint256 public constant MAX_SLIPPAGE_BPS = 50; // 0.5% for swaps
    uint256 public constant HEDGE_DRIFT_TOLERANCE_BPS = 200; // 2% max drift

    // ─── Immutables ───
    IAavePool public immutable aavePool;
    IAaveRewardsController public immutable rewardsController;
    ISwapRouter public immutable swapRouter;
    IERC20 public immutable wsteth;
    IERC20 public immutable weth;
    IERC20 public immutable arbToken;

    // ─── State ───
    uint256 public deployedUsdc; // Track net USDC deployed for P&L accounting

    // ─── Events ───
    event PositionOpened(uint256 usdcIn, uint256 wstethSupplied, uint256 wethBorrowed, uint256 usdcRecovered);
    event PositionClosed(uint256 wethRepaid, uint256 wstethWithdrawn, uint256 usdcOut);
    event HedgeRebalanced(int256 driftBps);

    constructor(address vault_, address manager_, address usdc_)
        BaseStrategy(vault_, manager_, usdc_)
    {
        aavePool = IAavePool(Constants.AAVE_POOL);
        rewardsController = IAaveRewardsController(Constants.AAVE_REWARDS);
        swapRouter = ISwapRouter(Constants.UNISWAP_ROUTER);
        wsteth = IERC20(Constants.WSTETH);
        weth = IERC20(Constants.WETH);
        arbToken = IERC20(Constants.ARB);

        // Approvals
        IERC20(usdc_).approve(Constants.UNISWAP_ROUTER, type(uint256).max);
        IERC20(Constants.WSTETH).approve(Constants.AAVE_POOL, type(uint256).max);
        IERC20(Constants.WETH).approve(Constants.AAVE_POOL, type(uint256).max);
        IERC20(Constants.WETH).approve(Constants.UNISWAP_ROUTER, type(uint256).max);
        IERC20(Constants.ARB).approve(Constants.UNISWAP_ROUTER, type(uint256).max);
    }

    // ─── IStrategy ───

    function name() external pure override returns (string memory) {
        return "Aave wstETH/ETH Delta-Neutral";
    }

    function totalAssets() external view override returns (uint256) {
        // Net value = wstETH collateral value - WETH debt value, converted to USDC
        uint256 wstethValue = _getWstethCollateralUsdc();
        uint256 wethDebtValue = _getWethDebtUsdc();

        // Add any idle USDC held by this contract
        uint256 idleUsdc = usdc.balanceOf(address(this));

        uint256 grossValue = wstethValue + idleUsdc;
        return grossValue > wethDebtValue ? grossValue - wethDebtValue : 0;
    }

    function healthFactor() public view override returns (uint256) {
        (,,,,, uint256 hf) = aavePool.getUserAccountData(address(this));
        return hf;
    }

    function canDeposit() external view override returns (bool) {
        uint256 hf = healthFactor();
        return hf == type(uint256).max || hf >= MIN_HEALTH_FACTOR;
    }

    // ─── Internal Implementation ───

    function _deposit(uint256 amount) internal override returns (uint256 deployed) {
        // Step 1: Swap USDC → wstETH via Uniswap (USDC → WETH → wstETH)
        uint256 expectedWsteth = _usdcToWstethExpected(amount);
        uint256 minWsteth = (expectedWsteth * (Constants.MAX_BPS - MAX_SLIPPAGE_BPS)) / Constants.MAX_BPS;

        uint256 wstethReceived = swapRouter.exactInput(
            ISwapRouter.ExactInputParams({
                path: abi.encodePacked(
                    address(usdc), uint24(500), Constants.WETH, uint24(100), Constants.WSTETH
                ),
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: amount,
                amountOutMinimum: minWsteth
            })
        );

        // Step 2: Supply wstETH to Aave
        aavePool.supply(Constants.WSTETH, wstethReceived, address(this), 0);

        // Step 3: Borrow WETH against wstETH at target LTV
        (,, uint256 availableBorrowBase,,,) = aavePool.getUserAccountData(address(this));
        uint256 ethPrice = OracleLib.getPrice(IChainlinkAggregator(Constants.CHAINLINK_ETH_USD)); // 8 dec

        // Convert available borrow (base, 8 dec) to WETH (18 dec)
        uint256 maxBorrowWeth = (availableBorrowBase * 1e18) / ethPrice;
        uint256 toBorrowWeth = (maxBorrowWeth * TARGET_LTV_BPS) / Constants.MAX_BPS;

        if (toBorrowWeth > 0) {
            aavePool.borrow(Constants.WETH, toBorrowWeth, 2, 0, address(this));

            // Step 4: Swap borrowed WETH → USDC to complete the hedge
            uint256 expectedUsdc = _wethToUsdcExpected(toBorrowWeth);
            uint256 minUsdc = (expectedUsdc * (Constants.MAX_BPS - MAX_SLIPPAGE_BPS)) / Constants.MAX_BPS;

            swapRouter.exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn: Constants.WETH,
                    tokenOut: address(usdc),
                    fee: 500, // 0.05% pool
                    recipient: address(this),
                    deadline: block.timestamp,
                    amountIn: toBorrowWeth,
                    amountOutMinimum: minUsdc,
                    sqrtPriceLimitX96: 0
                })
            );
        }

        // Verify health factor
        uint256 hf = healthFactor();
        if (hf < MIN_HEALTH_FACTOR) revert Errors.HealthFactorTooLow();

        deployedUsdc += amount;
        deployed = amount;

        emit PositionOpened(amount, wstethReceived, toBorrowWeth, usdc.balanceOf(address(this)));
    }

    function _withdraw(uint256 amount) internal override returns (uint256 withdrawn) {
        // Reverse the position proportionally
        uint256 totalVal = this.totalAssets();
        if (totalVal == 0) return 0;

        // Calculate proportion to unwind
        uint256 fraction = amount > totalVal ? Constants.MAX_BPS : (amount * Constants.MAX_BPS) / totalVal;

        // Step 1: Buy WETH with idle USDC to repay debt
        uint256 wethDebt = _getWethDebt();
        uint256 wethToRepay = (wethDebt * fraction) / Constants.MAX_BPS;

        if (wethToRepay > 0) {
            uint256 ethPrice = OracleLib.getPrice(IChainlinkAggregator(Constants.CHAINLINK_ETH_USD));
            uint256 usdcPrice = OracleLib.getPrice(IChainlinkAggregator(Constants.CHAINLINK_USDC_USD));

            uint256 expectedUsdcCost = _wethToUsdcExpected(wethToRepay);
            uint256 maxUsdcCost = (expectedUsdcCost * (Constants.MAX_BPS + MAX_SLIPPAGE_BPS)) / Constants.MAX_BPS;

            // Swap USDC → WETH
            uint256 idleUsdc = usdc.balanceOf(address(this));
            uint256 usdcToSwap = maxUsdcCost > idleUsdc ? idleUsdc : maxUsdcCost;

            if (usdcToSwap > 0) {
                // Oracle-based slippage protection
                uint256 expectedWeth = (usdcToSwap * 1e12 * usdcPrice) / ethPrice;
                uint256 minWethOut = (expectedWeth * (Constants.MAX_BPS - MAX_SLIPPAGE_BPS)) / Constants.MAX_BPS;

                swapRouter.exactInputSingle(
                    ISwapRouter.ExactInputSingleParams({
                        tokenIn: address(usdc),
                        tokenOut: Constants.WETH,
                        fee: 500,
                        recipient: address(this),
                        deadline: block.timestamp,
                        amountIn: usdcToSwap,
                        amountOutMinimum: minWethOut,
                        sqrtPriceLimitX96: 0
                    })
                );
            }

            // Repay WETH debt
            uint256 wethBal = weth.balanceOf(address(this));
            uint256 toRepay = wethBal > wethToRepay ? wethToRepay : wethBal;
            if (toRepay > 0) {
                aavePool.repay(Constants.WETH, toRepay, 2, address(this));
            }
        }

        // Step 2: Withdraw wstETH from Aave
        uint256 wstethCollateral = _getWstethCollateral();
        uint256 wstethToWithdraw = (wstethCollateral * fraction) / Constants.MAX_BPS;

        if (wstethToWithdraw > 0) {
            aavePool.withdraw(Constants.WSTETH, wstethToWithdraw, address(this));

            // Step 3: Swap wstETH → USDC
            uint256 expectedUsdc = OracleLib.wstethToUsdc(wstethToWithdraw);
            uint256 minUsdc = (expectedUsdc * (Constants.MAX_BPS - MAX_SLIPPAGE_BPS)) / Constants.MAX_BPS;

            swapRouter.exactInput(
                ISwapRouter.ExactInputParams({
                    path: abi.encodePacked(
                        Constants.WSTETH, uint24(100), Constants.WETH, uint24(500), address(usdc)
                    ),
                    recipient: address(this),
                    deadline: block.timestamp,
                    amountIn: wstethToWithdraw,
                    amountOutMinimum: minUsdc
                })
            );
        }

        withdrawn = usdc.balanceOf(address(this));
        if (withdrawn > amount) withdrawn = amount;

        // Update accounting
        uint256 deduction = (deployedUsdc * fraction) / Constants.MAX_BPS;
        deployedUsdc = deployedUsdc > deduction ? deployedUsdc - deduction : 0;

        emit PositionClosed(wethToRepay, wstethToWithdraw, withdrawn);
    }

    function _harvest() internal override returns (uint256 profit) {
        // Claim ARB rewards
        address[] memory assets = new address[](1);
        assets[0] = Constants.WSTETH; // aWstETH

        rewardsController.claimAllRewards(assets, address(this));

        // Swap ARB → USDC if any
        uint256 arbBalance = arbToken.balanceOf(address(this));
        if (arbBalance > 0) {
            uint256 arbPrice = OracleLib.getPrice(IChainlinkAggregator(Constants.CHAINLINK_ARB_USD));
            uint256 usdcPrice = OracleLib.getPrice(IChainlinkAggregator(Constants.CHAINLINK_USDC_USD));
            uint256 expectedUsdc = (arbBalance * arbPrice) / (usdcPrice * 1e12);
            uint256 minOut = (expectedUsdc * (Constants.MAX_BPS - MAX_SLIPPAGE_BPS)) / Constants.MAX_BPS;

            profit += swapRouter.exactInputSingle(
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
        }

        // Rebalance hedge if drift exceeds tolerance
        _checkAndRebalanceHedge();

        // The main yield (wstETH staking) is captured in totalAssets() via wstETH price appreciation
        // We could also realize some of this by unwinding a small portion, but that's gas-inefficient
        // The vault sees it through increasing totalAssets()
    }

    function _emergencyWithdraw() internal override returns (uint256 recovered) {
        // Repay all WETH debt
        uint256 wethDebt = _getWethDebt();
        if (wethDebt > 0) {
            // Swap whatever USDC we have to WETH
            uint256 idleUsdc = usdc.balanceOf(address(this));
            if (idleUsdc > 0) {
                swapRouter.exactInputSingle(
                    ISwapRouter.ExactInputSingleParams({
                        tokenIn: address(usdc),
                        tokenOut: Constants.WETH,
                        fee: 500,
                        recipient: address(this),
                        deadline: block.timestamp,
                        amountIn: idleUsdc,
                        amountOutMinimum: 0, // Emergency — accept any price
                        sqrtPriceLimitX96: 0
                    })
                );
            }

            // Repay what we can
            uint256 wethBal = weth.balanceOf(address(this));
            if (wethBal > 0) {
                uint256 toRepay = wethBal > wethDebt ? wethDebt : wethBal;
                aavePool.repay(Constants.WETH, toRepay, 2, address(this));
            }
        }

        // Withdraw all wstETH
        uint256 wstethBal = _getWstethCollateral();
        if (wstethBal > 0) {
            aavePool.withdraw(Constants.WSTETH, type(uint256).max, address(this));

            // Swap all wstETH → USDC
            uint256 actualWsteth = wsteth.balanceOf(address(this));
            if (actualWsteth > 0) {
                swapRouter.exactInput(
                    ISwapRouter.ExactInputParams({
                        path: abi.encodePacked(
                            Constants.WSTETH, uint24(100), Constants.WETH, uint24(500), address(usdc)
                        ),
                        recipient: address(this),
                        deadline: block.timestamp,
                        amountIn: actualWsteth,
                        amountOutMinimum: 0 // Emergency
                    })
                );
            }
        }

        // Swap any remaining WETH
        uint256 remainingWeth = weth.balanceOf(address(this));
        if (remainingWeth > 0) {
            swapRouter.exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn: Constants.WETH,
                    tokenOut: address(usdc),
                    fee: 500,
                    recipient: address(this),
                    deadline: block.timestamp,
                    amountIn: remainingWeth,
                    amountOutMinimum: 0,
                    sqrtPriceLimitX96: 0
                })
            );
        }

        deployedUsdc = 0;
        recovered = usdc.balanceOf(address(this));
    }

    // ─── Hedge Drift Management ───

    /// @notice Check if hedge has drifted beyond tolerance and rebalance if needed.
    ///         Drift = deviation of actual debt/collateral ratio from TARGET_LTV_BPS.
    ///         Under-hedged (wstETH grew faster): borrow more WETH.
    ///         Over-hedged (debt grew): repay some WETH with idle USDC.
    function _checkAndRebalanceHedge() internal {
        uint256 wstethValueUsdc = _getWstethCollateralUsdc();
        if (wstethValueUsdc == 0) return;

        uint256 wethDebtUsdc = _getWethDebtUsdc();
        uint256 targetDebtUsdc = (wstethValueUsdc * TARGET_LTV_BPS) / Constants.MAX_BPS;

        if (targetDebtUsdc == 0) return;

        int256 driftBps;
        if (wethDebtUsdc > targetDebtUsdc) {
            // Over-hedged: debt value exceeds target
            driftBps = -int256(((wethDebtUsdc - targetDebtUsdc) * Constants.MAX_BPS) / targetDebtUsdc);
        } else {
            // Under-hedged: debt value below target
            driftBps = int256(((targetDebtUsdc - wethDebtUsdc) * Constants.MAX_BPS) / targetDebtUsdc);
        }

        // Check absolute drift against tolerance
        uint256 absDrift = driftBps >= 0 ? uint256(driftBps) : uint256(-driftBps);
        if (absDrift <= HEDGE_DRIFT_TOLERANCE_BPS) return;

        if (driftBps > 0) {
            // Under-hedged: borrow more WETH and swap to USDC
            (,, uint256 availableBorrowBase,,,) = aavePool.getUserAccountData(address(this));
            uint256 ethPrice = OracleLib.getPrice(IChainlinkAggregator(Constants.CHAINLINK_ETH_USD));

            uint256 additionalDebtNeeded = targetDebtUsdc - wethDebtUsdc;
            // Convert USDC (6 dec) to WETH (18 dec): multiply by 1e12, then by usdcPrice/ethPrice
            uint256 usdcPrice = OracleLib.getPrice(IChainlinkAggregator(Constants.CHAINLINK_USDC_USD));
            uint256 additionalWeth = (additionalDebtNeeded * 1e12 * usdcPrice) / ethPrice;

            // Cap at available borrow capacity
            uint256 maxBorrowWeth = (availableBorrowBase * 1e18) / ethPrice;
            if (additionalWeth > maxBorrowWeth) additionalWeth = maxBorrowWeth;

            if (additionalWeth > 0) {
                aavePool.borrow(Constants.WETH, additionalWeth, 2, 0, address(this));

                uint256 expectedUsdc = _wethToUsdcExpected(additionalWeth);
                uint256 minUsdc = (expectedUsdc * (Constants.MAX_BPS - MAX_SLIPPAGE_BPS)) / Constants.MAX_BPS;

                swapRouter.exactInputSingle(
                    ISwapRouter.ExactInputSingleParams({
                        tokenIn: Constants.WETH,
                        tokenOut: address(usdc),
                        fee: 500,
                        recipient: address(this),
                        deadline: block.timestamp,
                        amountIn: additionalWeth,
                        amountOutMinimum: minUsdc,
                        sqrtPriceLimitX96: 0
                    })
                );
            }
        } else {
            // Over-hedged: buy WETH with idle USDC and repay excess debt
            uint256 excessDebtUsdc = wethDebtUsdc - targetDebtUsdc;
            uint256 idleUsdc = usdc.balanceOf(address(this));
            uint256 usdcToSwap = excessDebtUsdc > idleUsdc ? idleUsdc : excessDebtUsdc;

            if (usdcToSwap > 0) {
                uint256 ethPrice = OracleLib.getPrice(IChainlinkAggregator(Constants.CHAINLINK_ETH_USD));
                uint256 usdcPrice = OracleLib.getPrice(IChainlinkAggregator(Constants.CHAINLINK_USDC_USD));
                uint256 expectedWeth = (usdcToSwap * 1e12 * usdcPrice) / ethPrice;
                uint256 minWethOut = (expectedWeth * (Constants.MAX_BPS - MAX_SLIPPAGE_BPS)) / Constants.MAX_BPS;

                swapRouter.exactInputSingle(
                    ISwapRouter.ExactInputSingleParams({
                        tokenIn: address(usdc),
                        tokenOut: Constants.WETH,
                        fee: 500,
                        recipient: address(this),
                        deadline: block.timestamp,
                        amountIn: usdcToSwap,
                        amountOutMinimum: minWethOut,
                        sqrtPriceLimitX96: 0
                    })
                );

                uint256 wethBal = weth.balanceOf(address(this));
                if (wethBal > 0) {
                    aavePool.repay(Constants.WETH, wethBal, 2, address(this));
                }
            }
        }

        emit HedgeRebalanced(driftBps);
    }

    // ─── Internal Helpers ───

    function _getWstethCollateral() internal view returns (uint256) {
        // aWstETH balance
        IAavePool.ReserveData memory data = aavePool.getReserveData(Constants.WSTETH);
        return IERC20(data.aTokenAddress).balanceOf(address(this));
    }

    function _getWstethCollateralUsdc() internal view returns (uint256) {
        uint256 wstethAmount = _getWstethCollateral();
        if (wstethAmount == 0) return 0;
        return OracleLib.wstethToUsdc(wstethAmount);
    }

    function _getWethDebt() internal view returns (uint256) {
        IAavePool.ReserveData memory data = aavePool.getReserveData(Constants.WETH);
        return IERC20(data.variableDebtTokenAddress).balanceOf(address(this));
    }

    function _getWethDebtUsdc() internal view returns (uint256) {
        uint256 wethAmount = _getWethDebt();
        if (wethAmount == 0) return 0;

        uint256 ethPrice = OracleLib.getPrice(IChainlinkAggregator(Constants.CHAINLINK_ETH_USD)); // 8 dec
        uint256 usdcPrice = OracleLib.getPrice(IChainlinkAggregator(Constants.CHAINLINK_USDC_USD)); // 8 dec

        // wethAmount (18 dec) * ethPrice (8 dec) / usdcPrice (8 dec) → 18 dec, then to 6 dec
        return (wethAmount * ethPrice) / (usdcPrice * 1e12);
    }

    function _usdcToWstethExpected(uint256 usdcAmount) internal view returns (uint256) {
        uint256 usdcPrice = OracleLib.getPrice(IChainlinkAggregator(Constants.CHAINLINK_USDC_USD));
        uint256 wstethEthPrice = OracleLib.getPrice(IChainlinkAggregator(Constants.CHAINLINK_WSTETH_ETH));
        uint256 ethPrice = OracleLib.getPrice(IChainlinkAggregator(Constants.CHAINLINK_ETH_USD));

        // usdcAmount (6 dec) * usdcPrice (8 dec) = usd value (14 dec)
        // wsteth price in usd = wstethEthPrice (18 dec) * ethPrice (8 dec) / 1e18 = 8 dec
        uint256 wstethPriceUsd = (wstethEthPrice * ethPrice) / 1e18;

        // result in 18 dec: usdcAmount * usdcPrice * 1e18 / (wstethPriceUsd * 1e6)
        return (usdcAmount * usdcPrice * 1e18) / (wstethPriceUsd * 1e6);
    }

    function _wethToUsdcExpected(uint256 wethAmount) internal view returns (uint256) {
        uint256 ethPrice = OracleLib.getPrice(IChainlinkAggregator(Constants.CHAINLINK_ETH_USD));
        uint256 usdcPrice = OracleLib.getPrice(IChainlinkAggregator(Constants.CHAINLINK_USDC_USD));

        // wethAmount (18 dec) * ethPrice (8 dec) / usdcPrice (8 dec) → 18 dec, scale to 6 dec
        return (wethAmount * ethPrice) / (usdcPrice * 1e12);
    }
}
