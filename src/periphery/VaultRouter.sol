// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IWETH} from "../interfaces/IWETH.sol";
import {ISwapRouter} from "../interfaces/ISwapRouter.sol";
import {Constants} from "../libraries/Constants.sol";
import {Errors} from "../libraries/Errors.sol";

/// @title VaultRouter
/// @notice User-facing helper for common vault operations:
///         - Deposit with ERC-2612 permit (gasless approval)
///         - Deposit ETH (auto-wraps and swaps to USDC)
///         - Withdraw to ETH (redeems USDC and swaps to ETH)
contract VaultRouter {
    using SafeERC20 for IERC20;

    IERC4626 public immutable vault;
    IERC20 public immutable usdc;
    IWETH public immutable weth;
    ISwapRouter public immutable swapRouter;

    constructor(address vault_) {
        if (vault_ == address(0)) revert Errors.ZeroAddress();
        vault = IERC4626(vault_);
        usdc = IERC20(IERC4626(vault_).asset());
        weth = IWETH(Constants.WETH);
        swapRouter = ISwapRouter(Constants.UNISWAP_ROUTER);

        // Approve vault to pull USDC
        usdc.approve(vault_, type(uint256).max);
        // Approve swap router for WETH → USDC swaps
        IERC20(Constants.WETH).approve(Constants.UNISWAP_ROUTER, type(uint256).max);
    }

    /// @notice Deposit USDC using ERC-2612 permit (no separate approve tx needed)
    function depositWithPermit(
        uint256 assets,
        address receiver,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (uint256 shares) {
        // Execute permit
        IERC20Permit(address(usdc)).permit(msg.sender, address(this), assets, deadline, v, r, s);

        // Pull USDC from user
        usdc.safeTransferFrom(msg.sender, address(this), assets);

        // Deposit into vault
        shares = vault.deposit(assets, receiver);
    }

    /// @notice Deposit native ETH — wraps to WETH, swaps to USDC, deposits to vault
    function depositETH(address receiver, uint256 minUsdcOut) external payable returns (uint256 shares) {
        if (msg.value == 0) revert Errors.ZeroAmount();

        // Wrap ETH → WETH
        weth.deposit{value: msg.value}();

        // Swap WETH → USDC
        uint256 usdcReceived = swapRouter.exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: Constants.WETH,
                tokenOut: address(usdc),
                fee: 500, // 0.05% pool
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: msg.value,
                amountOutMinimum: minUsdcOut,
                sqrtPriceLimitX96: 0
            })
        );

        // Deposit USDC into vault
        shares = vault.deposit(usdcReceived, receiver);
    }

    /// @notice Redeem vault shares and receive native ETH
    function redeemToETH(uint256 shares, address receiver, uint256 minEthOut) external returns (uint256 ethOut) {
        // Transfer shares from user to this contract
        IERC20(address(vault)).safeTransferFrom(msg.sender, address(this), shares);

        // Redeem shares for USDC
        uint256 usdcReceived = vault.redeem(shares, address(this), address(this));

        // Swap USDC → WETH
        usdc.approve(address(swapRouter), usdcReceived);
        uint256 wethReceived = swapRouter.exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: address(usdc),
                tokenOut: Constants.WETH,
                fee: 500,
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: usdcReceived,
                amountOutMinimum: minEthOut,
                sqrtPriceLimitX96: 0
            })
        );

        // Unwrap WETH → ETH and send to receiver
        weth.withdraw(wethReceived);
        (bool sent,) = receiver.call{value: wethReceived}("");
        require(sent, "VaultRouter: ETH transfer failed");

        ethOut = wethReceived;
    }

    /// @notice Preview how many shares a USDC deposit would yield
    function previewDeposit(uint256 assets) external view returns (uint256) {
        return vault.previewDeposit(assets);
    }

    /// @notice Preview how much USDC redeeming shares would yield
    function previewRedeem(uint256 shares) external view returns (uint256) {
        return vault.previewRedeem(shares);
    }

    receive() external payable {}
}
