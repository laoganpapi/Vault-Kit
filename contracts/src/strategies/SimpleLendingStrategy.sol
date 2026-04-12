// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title SimpleLendingStrategy
 * @notice Concrete IStrategy implementation that wraps a lending-pool-style
 *         protocol (Aave V3, Compound, etc.). This is a minimal reference
 *         implementation that the ArbitrumVault can integrate with.
 *
 *         For a production deployment you would replace ILendingPool with
 *         the real Aave Pool / Compound Comet / Morpho Blue interface and
 *         set the lendingPool address to the real protocol address.
 *
 * Security model:
 *   - Only the vault address can call deposit/withdraw/harvest
 *   - The strategy holds NO permanent assets — everything is forwarded to
 *     the lending pool immediately
 *   - All transfers use unchecked-call-style returns (real ERC-20 wrapping
 *     should use SafeERC20 — kept simple here for clarity)
 *   - The lending pool address is immutable after construction
 */

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}

/// @notice Minimal lending-pool interface (Aave V3-shaped, simplified).
/// @dev Uses a single getter for the aToken address rather than the full
///      15-field reserveData struct, avoiding stack-too-deep.
interface ILendingPool {
    /// @notice Deposit `amount` of `asset` and receive aTokens minted to `onBehalfOf`.
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;

    /// @notice Withdraw `amount` of `asset` to `to`. Returns the actual amount withdrawn.
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);

    /// @notice The aToken contract address for `asset`. aToken balance grows linearly with yield.
    /// @dev On real Aave V3, use `getReserveData(asset).aTokenAddress`. The mock
    ///      lending pool used in tests exposes this single-field getter directly.
    function getATokenAddress(address asset) external view returns (address);
}

contract SimpleLendingStrategy {
    address public immutable vault;
    IERC20 public immutable token;
    ILendingPool public immutable lendingPool;
    IERC20 public immutable aToken;       // The interest-bearing receipt token
    uint256 public lastHarvest;           // Timestamp of last harvest call
    uint256 public principalDeposited;    // Tracked principal (excluding accrued yield)

    event Deposited(uint256 amount);
    event Withdrawn(uint256 amount);
    event Harvested(uint256 profit);

    error NotVault();
    error ZeroAmount();
    error TransferFailed();

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
        _;
    }

    constructor(address _vault, address _token, address _lendingPool) {
        require(_vault != address(0), "Zero vault");
        require(_token != address(0), "Zero token");
        require(_lendingPool != address(0), "Zero pool");

        vault = _vault;
        token = IERC20(_token);
        lendingPool = ILendingPool(_lendingPool);

        // Resolve the aToken address from the lending pool
        address _aToken = ILendingPool(_lendingPool).getATokenAddress(_token);
        require(_aToken != address(0), "No aToken for asset");
        aToken = IERC20(_aToken);

        lastHarvest = block.timestamp;
    }

    // ============ Vault-facing IStrategy ============

    /// @notice Safely call ERC-20 approve, handling tokens that return nothing.
    function _safeApprove(address spender, uint256 value) internal {
        // Reset to zero first to handle non-standard tokens like USDT.
        (bool ok1, bytes memory data1) = address(token).call(
            abi.encodeWithSelector(token.approve.selector, spender, 0)
        );
        require(ok1 && (data1.length == 0 || abi.decode(data1, (bool))), "approve(0) failed");
        if (value > 0) {
            (bool ok2, bytes memory data2) = address(token).call(
                abi.encodeWithSelector(token.approve.selector, spender, value)
            );
            require(ok2 && (data2.length == 0 || abi.decode(data2, (bool))), "approve failed");
        }
    }

    /// @notice Safely call ERC-20 transferFrom and return the actual delta.
    function _safeTransferFromWithDelta(address from, address to, uint256 amount)
        internal
        returns (uint256 received)
    {
        uint256 balanceBefore = token.balanceOf(to);
        (bool ok, bytes memory data) = address(token).call(
            abi.encodeWithSelector(token.transferFrom.selector, from, to, amount)
        );
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "transferFrom failed");
        received = token.balanceOf(to) - balanceBefore;
    }

    /// @notice Deposit `amount` of underlying into the lending pool.
    /// @dev Uses balance-diff measurement to support fee-on-transfer tokens
    ///      (the actual amount received and supplied may be less than `amount`).
    function deposit(uint256 amount) external onlyVault {
        if (amount == 0) revert ZeroAmount();

        // Pull tokens from vault and measure what we actually received
        uint256 received = _safeTransferFromWithDelta(vault, address(this), amount);
        if (received == 0) revert TransferFailed();

        // Approve and supply to lending pool with the ACTUAL received amount
        _safeApprove(address(lendingPool), received);
        lendingPool.supply(address(token), received, address(this), 0);

        principalDeposited += received;
        emit Deposited(received);
    }

    /// @notice Withdraw `amount` of underlying from the lending pool back to the vault.
    /// @return actualAmount The amount actually withdrawn (may differ slightly from requested).
    function withdraw(uint256 amount) external onlyVault returns (uint256 actualAmount) {
        if (amount == 0) revert ZeroAmount();
        actualAmount = lendingPool.withdraw(address(token), amount, vault);
        // Update tracked principal — saturating subtraction to avoid underflow if
        // the withdrawal exceeds tracked principal (e.g., harvest hasn't run)
        principalDeposited = principalDeposited > actualAmount ? principalDeposited - actualAmount : 0;
        emit Withdrawn(actualAmount);
    }

    /// @notice Total assets currently held by this strategy (aToken balance).
    function balanceOf() external view returns (uint256) {
        return aToken.balanceOf(address(this));
    }

    /// @notice Realize accrued yield by computing aToken.balanceOf() - principalDeposited,
    ///         then withdrawing the profit from the lending pool back to the vault so the
    ///         vault can pay the performance fee.
    /// @return profit The amount of profit realized this harvest, in underlying units.
    function harvest() external onlyVault returns (uint256 profit) {
        uint256 currentBalance = aToken.balanceOf(address(this));
        if (currentBalance > principalDeposited) {
            profit = currentBalance - principalDeposited;
            // Withdraw the profit from the lending pool directly to the vault.
            // The vault is the recipient so harvest fee handling is straightforward.
            uint256 actualWithdrawn = lendingPool.withdraw(address(token), profit, vault);
            // Update tracked principal — what remains in the strategy is the original
            // principal (we've extracted only the profit).
            principalDeposited = currentBalance - actualWithdrawn;
            profit = actualWithdrawn;
        }
        lastHarvest = block.timestamp;
        emit Harvested(profit);
    }

    // ============ Emergency ============

    /// @notice Emergency drain — only the vault can trigger. Withdraws everything
    ///         from the lending pool back to the vault.
    function emergencyWithdraw() external onlyVault returns (uint256) {
        uint256 balance = aToken.balanceOf(address(this));
        if (balance == 0) return 0;
        uint256 actualAmount = lendingPool.withdraw(address(token), type(uint256).max, vault);
        principalDeposited = 0;
        emit Withdrawn(actualAmount);
        return actualAmount;
    }
}
