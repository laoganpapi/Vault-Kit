// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseStrategy} from "./BaseStrategy.sol";
import {IGmxExchangeRouter, IGmxReader, IGmxDataStore} from "../interfaces/IGmxV2.sol";
import {IChainlinkAggregator} from "../interfaces/IChainlinkAggregator.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Constants} from "../libraries/Constants.sol";
import {Errors} from "../libraries/Errors.sol";
import {OracleLib} from "../libraries/OracleLib.sol";

/// @title GmxGmPoolStrategy
/// @notice Deposits USDC into GMX V2 GM pools to earn perp trading fees.
///         GM tokens auto-compound (fees accrue in token price), so harvesting
///         consists of measuring appreciation and optionally withdrawing profit.
///
///         Uses a stablecoin-heavy GM pool (e.g., ETH/USD market, short side)
///         to minimize directional exposure while earning fee revenue.
contract GmxGmPoolStrategy is BaseStrategy {
    using SafeERC20 for IERC20;

    // ─── Constants ───
    uint256 public constant MAX_DEPOSIT_SLIPPAGE_BPS = 50; // 0.5%
    uint256 public constant MAX_WITHDRAW_SLIPPAGE_BPS = 50; // 0.5%
    uint256 public constant EXECUTION_FEE = 0.001 ether; // GMX execution fee (~$3)

    // ─── Immutables ───
    IGmxExchangeRouter public immutable exchangeRouter;
    IGmxReader public immutable gmxReader;
    IGmxDataStore public immutable dataStore;
    address public immutable gmMarket; // GM market token address

    // ─── State ───
    uint256 public lastDepositedValue; // USDC value at last deposit/harvest for P&L tracking
    uint256 public pendingDeposit; // USDC waiting for GMX keeper execution
    uint256 public pendingWithdrawal; // GM tokens waiting for withdrawal execution

    // ─── Events ───
    event DepositCreated(bytes32 indexed key, uint256 usdcAmount);
    event WithdrawalCreated(bytes32 indexed key, uint256 gmTokens);
    event GmTokensReceived(uint256 amount, uint256 usdcValueAtDeposit);

    constructor(address vault_, address manager_, address usdc_, address gmMarket_)
        BaseStrategy(vault_, manager_, usdc_)
    {
        if (gmMarket_ == address(0)) revert Errors.ZeroAddress();

        exchangeRouter = IGmxExchangeRouter(Constants.GMX_EXCHANGE_ROUTER);
        gmxReader = IGmxReader(Constants.GMX_READER);
        dataStore = IGmxDataStore(Constants.GMX_DATA_STORE);
        gmMarket = gmMarket_;

        // Approve GMX router to pull USDC
        IERC20(usdc_).approve(Constants.GMX_ROUTER, type(uint256).max);
    }

    // ─── IStrategy ───

    function name() external pure override returns (string memory) {
        return "GMX V2 GM Pool";
    }

    function totalAssets() external view override returns (uint256) {
        // GM token balance * GM token price, converted to USDC
        // Note: pendingDeposit is NOT added — it's already tracked as USDC sent to GMX.
        // Once the GMX keeper executes, GM tokens arrive and are valued via _gmToUsdc().
        // Adding pendingDeposit would double-count during the settlement window.
        uint256 gmBalance = IERC20(gmMarket).balanceOf(address(this));
        uint256 idle = usdc.balanceOf(address(this));

        if (gmBalance == 0) return idle + pendingDeposit;

        uint256 gmValueUsdc = _gmToUsdc(gmBalance);

        // If we have both GM tokens AND pendingDeposit, the pending was from a new deposit
        // that hasn't settled yet. Only count it if no GM tokens from that batch arrived.
        // Conservative: don't add pendingDeposit when GM tokens exist (avoids double-count).
        return gmValueUsdc + idle;
    }

    function healthFactor() external pure override returns (uint256) {
        // GM pools have no leverage / health factor concept
        return type(uint256).max;
    }

    function canDeposit() external pure override returns (bool) {
        return true;
    }

    // ─── Internal Implementation ───

    /// @notice Reconcile pending deposits once GMX keeper has executed.
    ///         Called at the start of deposit/withdraw/harvest to prevent double-counting.
    function _reconcilePending() internal {
        // If we have GM tokens and pending deposits, the keeper has executed
        uint256 gmBalance = IERC20(gmMarket).balanceOf(address(this));
        if (gmBalance > 0 && pendingDeposit > 0) {
            pendingDeposit = 0;
        }
        // Similarly for pending withdrawals
        if (pendingWithdrawal > 0) {
            // If we have idle USDC and no pending GM tokens sent, withdrawal settled
            pendingWithdrawal = 0;
        }
    }

    function _deposit(uint256 amount) internal override returns (uint256 deployed) {
        _reconcilePending();
        // GMX V2 deposits are async: we create a deposit request, and a GMX keeper executes it.

        // Send USDC to GMX deposit vault
        exchangeRouter.sendTokens(address(usdc), Constants.GMX_DEPOSIT_VAULT, amount);

        // Send execution fee
        exchangeRouter.sendWnt{value: EXECUTION_FEE}(Constants.GMX_DEPOSIT_VAULT, EXECUTION_FEE);

        // Calculate minimum GM tokens based on oracle price
        uint256 expectedGm = _usdcToGmExpected(amount);
        uint256 minGm = (expectedGm * (Constants.MAX_BPS - MAX_DEPOSIT_SLIPPAGE_BPS)) / Constants.MAX_BPS;

        address[] memory emptyPath = new address[](0);

        bytes32 key = exchangeRouter.createDeposit(
            IGmxExchangeRouter.CreateDepositParams({
                receiver: address(this),
                callbackContract: address(0), // No callback — we check GM balance on next interaction
                uiFeeReceiver: address(0),
                market: gmMarket,
                initialLongToken: address(0), // We're depositing USDC as short token only
                initialShortToken: address(usdc),
                longTokenSwapPath: emptyPath,
                shortTokenSwapPath: emptyPath,
                minMarketTokens: minGm,
                shouldUnwrapNativeToken: false,
                executionFee: EXECUTION_FEE,
                callbackGasLimit: 0
            })
        );

        pendingDeposit += amount;
        lastDepositedValue += amount;
        deployed = amount;

        emit DepositCreated(key, amount);
    }

    function _withdraw(uint256 amount) internal override returns (uint256 withdrawn) {
        _reconcilePending();
        // First use any idle USDC
        uint256 idle = usdc.balanceOf(address(this));
        if (idle >= amount) {
            return amount;
        }

        uint256 remaining = amount - idle;

        // Calculate GM tokens to burn for the remaining USDC needed
        uint256 gmBalance = IERC20(gmMarket).balanceOf(address(this));
        uint256 gmValue = _gmToUsdc(gmBalance);

        uint256 gmToRedeem;
        if (gmValue == 0 || remaining >= gmValue) {
            gmToRedeem = gmBalance; // Withdraw everything (including when oracle returns 0)
        } else {
            gmToRedeem = (gmBalance * remaining) / gmValue;
        }

        if (gmToRedeem > 0) {
            // Send GM tokens to withdrawal vault
            IERC20(gmMarket).safeTransfer(Constants.GMX_WITHDRAWAL_VAULT, gmToRedeem);

            // Send execution fee
            exchangeRouter.sendWnt{value: EXECUTION_FEE}(Constants.GMX_WITHDRAWAL_VAULT, EXECUTION_FEE);

            address[] memory emptyPath = new address[](0);

            uint256 minUsdc = (remaining * (Constants.MAX_BPS - MAX_WITHDRAW_SLIPPAGE_BPS)) / Constants.MAX_BPS;

            bytes32 key = exchangeRouter.createWithdrawal(
                IGmxExchangeRouter.CreateWithdrawalParams({
                    receiver: address(this),
                    callbackContract: address(0),
                    uiFeeReceiver: address(0),
                    market: gmMarket,
                    longTokenSwapPath: emptyPath,
                    shortTokenSwapPath: emptyPath,
                    minLongTokenAmount: 0,
                    minShortTokenAmount: minUsdc,
                    shouldUnwrapNativeToken: false,
                    executionFee: EXECUTION_FEE,
                    callbackGasLimit: 0
                })
            );

            pendingWithdrawal += gmToRedeem;
            emit WithdrawalCreated(key, gmToRedeem);
        }

        // Return whatever USDC we currently have
        // Note: Full withdrawal is async — the vault will get remaining USDC once GMX keeper executes
        withdrawn = usdc.balanceOf(address(this));
        if (withdrawn > amount) withdrawn = amount;

        // Update accounting
        if (lastDepositedValue > 0) {
            uint256 deduction = (lastDepositedValue * gmToRedeem) / (gmBalance > 0 ? gmBalance : 1);
            lastDepositedValue = lastDepositedValue > deduction ? lastDepositedValue - deduction : 0;
        }
    }

    function _harvest() internal override returns (uint256 profit) {
        _reconcilePending();

        // Track idle USDC before operations to only report delta as profit
        uint256 idleBefore = usdc.balanceOf(address(this));

        // GM pools auto-compound — yield accrues in GM token price.
        // "Harvesting" = measuring appreciation and withdrawing the profit portion.

        uint256 gmBalance = IERC20(gmMarket).balanceOf(address(this));
        if (gmBalance > 0) {
            uint256 currentValue = _gmToUsdc(gmBalance);
            if (currentValue > lastDepositedValue) {
                uint256 unrealizedProfit = currentValue - lastDepositedValue;

                // Withdraw profit portion as USDC
                uint256 gmToRedeem = (gmBalance * unrealizedProfit) / currentValue;

                if (gmToRedeem > 0 && unrealizedProfit > 100e6) {
                    // Only harvest if profit > $100 to save gas
                    IERC20(gmMarket).safeTransfer(Constants.GMX_WITHDRAWAL_VAULT, gmToRedeem);
                    exchangeRouter.sendWnt{value: EXECUTION_FEE}(Constants.GMX_WITHDRAWAL_VAULT, EXECUTION_FEE);

                    address[] memory emptyPath = new address[](0);
                    uint256 minUsdc = (unrealizedProfit * (Constants.MAX_BPS - MAX_WITHDRAW_SLIPPAGE_BPS)) / Constants.MAX_BPS;

                    exchangeRouter.createWithdrawal(
                        IGmxExchangeRouter.CreateWithdrawalParams({
                            receiver: address(this),
                            callbackContract: address(0),
                            uiFeeReceiver: address(0),
                            market: gmMarket,
                            longTokenSwapPath: emptyPath,
                            shortTokenSwapPath: emptyPath,
                            minLongTokenAmount: 0,
                            minShortTokenAmount: minUsdc,
                            shouldUnwrapNativeToken: false,
                            executionFee: EXECUTION_FEE,
                            callbackGasLimit: 0
                        })
                    );
                }

                // Update high water mark
                lastDepositedValue = currentValue - unrealizedProfit;
            }
        }

        // Only report newly settled USDC as profit (not pre-existing idle)
        uint256 idleAfter = usdc.balanceOf(address(this));
        profit = idleAfter > idleBefore ? idleAfter - idleBefore : 0;
    }

    function _emergencyWithdraw() internal override returns (uint256 recovered) {
        uint256 gmBalance = IERC20(gmMarket).balanceOf(address(this));

        if (gmBalance > 0) {
            IERC20(gmMarket).safeTransfer(Constants.GMX_WITHDRAWAL_VAULT, gmBalance);
            exchangeRouter.sendWnt{value: EXECUTION_FEE}(Constants.GMX_WITHDRAWAL_VAULT, EXECUTION_FEE);

            address[] memory emptyPath = new address[](0);

            exchangeRouter.createWithdrawal(
                IGmxExchangeRouter.CreateWithdrawalParams({
                    receiver: address(this),
                    callbackContract: address(0),
                    uiFeeReceiver: address(0),
                    market: gmMarket,
                    longTokenSwapPath: emptyPath,
                    shortTokenSwapPath: emptyPath,
                    minLongTokenAmount: 0,
                    minShortTokenAmount: 0, // Emergency — accept any amount
                    shouldUnwrapNativeToken: false,
                    executionFee: EXECUTION_FEE,
                    callbackGasLimit: 0
                })
            );
        }

        pendingDeposit = 0;
        pendingWithdrawal = 0;
        lastDepositedValue = 0;
        recovered = usdc.balanceOf(address(this));
    }

    // ─── Internal Helpers ───

    /// @notice Get USDC value of GM tokens using GMX Reader oracle-based pricing.
    ///         Uses getMarketTokenPrice() which internally uses signed oracle prices,
    ///         NOT spot balanceOf (which would be flash-loan manipulable).
    function _gmToUsdc(uint256 gmAmount) internal view returns (uint256) {
        IGmxReader.MarketProps memory market = gmxReader.getMarket(address(dataStore), gmMarket);

        // Get Chainlink-secured prices (NOT spot DEX prices)
        uint256 indexPrice = OracleLib.getPrice(IChainlinkAggregator(Constants.CHAINLINK_ETH_USD)); // 8 dec
        uint256 usdcPrice = OracleLib.getPrice(IChainlinkAggregator(Constants.CHAINLINK_USDC_USD)); // 8 dec

        // Use GMX Reader to get oracle-secured GM token price
        // pnlFactorType: MAX_PNL_FACTOR_FOR_TRADERS for conservative valuation
        bytes32 pnlFactorType = keccak256(abi.encode("MAX_PNL_FACTOR_FOR_TRADERS"));

        // getMarketTokenPrice returns (int256 price, MarketPoolValueInfoProps)
        // price is in 30 decimals (GMX internal precision)
        // maximize=false for conservative withdrawal valuation
        (int256 gmTokenPrice,) = gmxReader.getMarketTokenPrice(
            address(dataStore),
            market,
            indexPrice,   // index token (ETH) price, 8 dec → GMX scales internally
            indexPrice,   // long token (WETH) price
            usdcPrice,    // short token (USDC) price
            pnlFactorType,
            false         // minimize for conservative valuation
        );

        if (gmTokenPrice <= 0) return 0;

        // GM token price is in 30 decimals. gmAmount is 18 decimals.
        // Result: gmAmount * price / 1e30 gives USD value in 18 decimals
        // Then convert to USDC (6 dec): divide by 1e12
        uint256 usdValue = (gmAmount * uint256(gmTokenPrice)) / 1e30;
        return usdValue / 1e12;
    }

    /// @notice Estimate GM tokens for USDC deposit using oracle pricing
    function _usdcToGmExpected(uint256 usdcAmount) internal view returns (uint256) {
        IGmxReader.MarketProps memory market = gmxReader.getMarket(address(dataStore), gmMarket);

        uint256 indexPrice = OracleLib.getPrice(IChainlinkAggregator(Constants.CHAINLINK_ETH_USD));
        uint256 usdcPrice = OracleLib.getPrice(IChainlinkAggregator(Constants.CHAINLINK_USDC_USD));

        bytes32 pnlFactorType = keccak256(abi.encode("MAX_PNL_FACTOR_FOR_TRADERS"));

        // maximize=true for deposit estimation (more GM tokens expected)
        (int256 gmTokenPrice,) = gmxReader.getMarketTokenPrice(
            address(dataStore),
            market,
            indexPrice,
            indexPrice,
            usdcPrice,
            pnlFactorType,
            true
        );

        if (gmTokenPrice <= 0) return usdcAmount * 1e12; // Fallback

        // usdcAmount (6 dec) → USD value (30 dec): usdcAmount * usdcPrice * 1e16
        // GM tokens = usdValue / gmTokenPrice (both 30 dec) → 18 dec
        uint256 usdValue30 = usdcAmount * usdcPrice * 1e16; // 6+8+16 = 30 dec
        return usdValue30 / uint256(gmTokenPrice); // Result in 18 dec
    }

    /// @notice Fund strategy with ETH for GMX execution fees
    function fundExecutionFees() external payable {}

    /// @notice Allow this contract to receive ETH for execution fees
    receive() external payable {}
}
