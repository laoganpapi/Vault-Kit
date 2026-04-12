// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20, IERC20, IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {StrategyManager} from "./StrategyManager.sol";
import {Errors} from "../libraries/Errors.sol";
import {Constants} from "../libraries/Constants.sol";

interface IBaseStrategyRescue {
    function rescueToken(address token) external;
}

/// @title YieldVault
/// @notice ERC-4626 vault that allocates USDC across multiple yield strategies on Arbitrum.
///         Deposits/withdrawals always work. Strategy changes require a 24h timelock.
///         A 5% drawdown circuit breaker pauses new deposits. Guardian can pause for emergencies.
contract YieldVault is ERC4626, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Math for uint256;

    // ─── Constants ───
    uint256 public constant DEPOSIT_CAP = 10_000_000e6; // 10M USDC
    uint256 public constant WITHDRAWAL_FEE_BPS = 10; // 0.1%
    uint256 public constant PERFORMANCE_FEE_BPS = 1_000; // 10% of yield
    uint256 public constant DRAWDOWN_THRESHOLD_BPS = 500; // 5% drawdown trips breaker
    uint256 public constant MIN_DEPOSIT = 1e6; // 1 USDC minimum

    // ─── State ───
    StrategyManager public immutable strategyManager;
    address public timelock;
    address public guardian;
    address public harvester;
    address public feeRecipient;

    uint256 public highWaterMark;
    bool public circuitBreakerTripped;

    // ─── Events ───
    event GuardianUpdated(address indexed oldGuardian, address indexed newGuardian);
    event HarvesterUpdated(address indexed oldHarvester, address indexed newHarvester);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event TimelockUpdated(address indexed oldTimelock, address indexed newTimelock);
    event CircuitBreakerTripped(uint256 totalAssets, uint256 highWaterMark);
    event CircuitBreakerReset(uint256 newHighWaterMark);
    event Harvested(uint256 profit, uint256 fee);
    event EmergencyWithdrawAll(uint256 recovered);
    event Rebalanced(uint256 deployed);

    // ─── Modifiers ───
    modifier onlyTimelock() {
        if (msg.sender != timelock) revert Errors.NotTimelock();
        _;
    }

    modifier onlyGuardianOrOwner() {
        if (msg.sender != guardian && msg.sender != owner()) revert Errors.NotGuardian();
        _;
    }

    modifier onlyHarvester() {
        if (msg.sender != harvester && msg.sender != owner()) revert Errors.NotHarvester();
        _;
    }

    // ─── Constructor ───
    constructor(
        IERC20 usdc_,
        address timelock_,
        address guardian_,
        address harvester_,
        address feeRecipient_
    )
        ERC4626(usdc_)
        ERC20("Yield Vault USDC", "yvUSDC")
        Ownable(msg.sender)
    {
        if (timelock_ == address(0) || guardian_ == address(0) || feeRecipient_ == address(0)) {
            revert Errors.ZeroAddress();
        }

        timelock = timelock_;
        guardian = guardian_;
        harvester = harvester_; // Can be address(0) initially — owner can harvest
        feeRecipient = feeRecipient_;

        strategyManager = new StrategyManager(address(this), address(usdc_));

        // One-time max allowance for StrategyManager to pull USDC
        SafeERC20.forceApprove(IERC20(address(usdc_)), address(strategyManager), type(uint256).max);
    }

    // ─── ERC-4626 Overrides ───

    /// @notice Virtual share offset to prevent inflation attack (first-depositor attack)
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    /// @notice Total vault assets = idle USDC + deployed across strategies
    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) + strategyManager.totalDeployedAssets();
    }

    /// @notice ERC-4626 compliant: returns 0 when paused or circuit-broken so integrators
    ///         don't attempt doomed deposits. Otherwise returns remaining headroom under
    ///         the vault's `DEPOSIT_CAP`.
    function maxDeposit(address) public view override returns (uint256) {
        if (paused() || circuitBreakerTripped || _isDrawdownExceeded()) return 0;
        uint256 current = totalAssets();
        if (current >= DEPOSIT_CAP) return 0;
        return DEPOSIT_CAP - current;
    }

    /// @notice ERC-4626 compliant: shares equivalent of `maxDeposit`.
    function maxMint(address receiver) public view override returns (uint256) {
        uint256 assetsMax = maxDeposit(receiver);
        if (assetsMax == type(uint256).max) return type(uint256).max;
        return previewDeposit(assetsMax);
    }

    /// @notice Deposit USDC, receive vault shares
    function deposit(uint256 assets, address receiver)
        public
        override
        nonReentrant
        whenNotPaused
        returns (uint256 shares)
    {
        if (assets < MIN_DEPOSIT) revert Errors.ZeroAmount();
        if (totalAssets() + assets > DEPOSIT_CAP) revert Errors.DepositCapExceeded();
        if (circuitBreakerTripped || _isDrawdownExceeded()) revert Errors.CircuitBreakerTripped();

        shares = super.deposit(assets, receiver);
        _updateHighWaterMark();
    }

    /// @notice Mint exact shares by depositing USDC
    function mint(uint256 shares, address receiver)
        public
        override
        nonReentrant
        whenNotPaused
        returns (uint256 assets)
    {
        if (circuitBreakerTripped || _isDrawdownExceeded()) revert Errors.CircuitBreakerTripped();

        assets = super.mint(shares, receiver);

        if (assets < MIN_DEPOSIT) revert Errors.ZeroAmount();
        if (totalAssets() > DEPOSIT_CAP) revert Errors.DepositCapExceeded();

        _updateHighWaterMark();
    }

    /// @notice ERC-4626 compliant: returns shares needed so receiver gets exactly `assets`.
    ///         Accounts for withdrawal fee (user burns extra shares to cover the fee).
    function previewWithdraw(uint256 assets) public view override returns (uint256) {
        uint256 grossAssets = assets.mulDiv(
            Constants.MAX_BPS, Constants.MAX_BPS - WITHDRAWAL_FEE_BPS, Math.Rounding.Ceil
        );
        return super.previewWithdraw(grossAssets);
    }

    /// @notice ERC-4626 compliant: returns net assets after fee deduction.
    function previewRedeem(uint256 shares) public view override returns (uint256) {
        uint256 grossAssets = super.previewRedeem(shares);
        uint256 fee = (grossAssets * WITHDRAWAL_FEE_BPS) / Constants.MAX_BPS;
        return grossAssets - fee;
    }

    /// @notice Max withdrawable = gross share value minus fee
    function maxWithdraw(address owner_) public view override returns (uint256) {
        uint256 grossAssets = super.maxWithdraw(owner_);
        uint256 fee = (grossAssets * WITHDRAWAL_FEE_BPS) / Constants.MAX_BPS;
        return grossAssets - fee;
    }

    /// @notice Withdraw USDC by burning shares — always works, even when paused.
    ///         ERC-4626 compliant: receiver gets exactly `assets`. Fee is additional.
    function withdraw(uint256 assets, address receiver, address _owner)
        public
        override
        nonReentrant
        returns (uint256 shares)
    {
        if (assets == 0) revert Errors.ZeroAmount();

        // Gross amount includes the fee so receiver gets exactly `assets`
        uint256 grossAssets = assets.mulDiv(
            Constants.MAX_BPS, Constants.MAX_BPS - WITHDRAWAL_FEE_BPS, Math.Rounding.Ceil
        );
        _ensureIdle(grossAssets);

        shares = previewWithdraw(assets);

        if (msg.sender != _owner) {
            _spendAllowance(_owner, msg.sender, shares);
        }

        _burn(_owner, shares);

        uint256 fee = grossAssets - assets;
        IERC20(asset()).safeTransfer(receiver, assets);
        if (fee > 0) {
            IERC20(asset()).safeTransfer(feeRecipient, fee);
        }

        emit Withdraw(msg.sender, receiver, _owner, assets, shares);
    }

    /// @notice Redeem shares for USDC — always works, even when paused.
    ///         Receiver gets gross value minus fee.
    function redeem(uint256 shares, address receiver, address _owner)
        public
        override
        nonReentrant
        returns (uint256 assets)
    {
        if (shares == 0) revert Errors.ZeroAmount();

        uint256 grossAssets = super.previewRedeem(shares);
        _ensureIdle(grossAssets);

        if (msg.sender != _owner) {
            _spendAllowance(_owner, msg.sender, shares);
        }

        _burn(_owner, shares);

        uint256 fee = (grossAssets * WITHDRAWAL_FEE_BPS) / Constants.MAX_BPS;
        assets = grossAssets - fee;
        IERC20(asset()).safeTransfer(receiver, assets);
        if (fee > 0) {
            IERC20(asset()).safeTransfer(feeRecipient, fee);
        }

        emit Withdraw(msg.sender, receiver, _owner, assets, shares);
    }

    // ─── Strategy Management (Timelock-gated) ───

    function addStrategy(address strategy, uint256 allocationBps) external onlyTimelock {
        strategyManager.addStrategy(strategy, allocationBps);
    }

    function removeStrategy(address strategy) external onlyTimelock {
        strategyManager.removeStrategy(strategy);
    }

    function setAllocation(address strategy, uint256 newBps) external onlyTimelock {
        strategyManager.setAllocation(strategy, newBps);
    }

    // ─── Harvest & Rebalance ───

    /// @notice Harvest yield from all strategies, take performance fee, rebalance.
    /// @dev    Pause-gated: when the vault is paused (e.g. emergency), the automation
    ///         halts. Users can still withdraw via `withdraw`/`redeem` unconditionally.
    function harvest() external onlyHarvester nonReentrant whenNotPaused {
        // Harvest profits from strategies (USDC returns to vault as idle)
        uint256 profit = strategyManager.harvestAll();

        // Performance fee on profit
        if (profit > 0) {
            uint256 fee = (profit * PERFORMANCE_FEE_BPS) / Constants.MAX_BPS;
            if (fee > 0) {
                IERC20(asset()).safeTransfer(feeRecipient, fee);
            }
            emit Harvested(profit, fee);
        }

        // Rebalance idle USDC to strategies
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        if (idle > 0) {
            uint256 deployed = strategyManager.rebalance(totalAssets(), idle);
            emit Rebalanced(deployed);
        }

        _updateHighWaterMark();
        _checkCircuitBreaker();
    }

    /// @notice Rebalance idle USDC to strategies without harvesting.
    /// @dev    Pause-gated for the same reason as `harvest`.
    function rebalance() external onlyHarvester nonReentrant whenNotPaused {
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        if (idle == 0) revert Errors.InsufficientIdle();

        uint256 deployed = strategyManager.rebalance(totalAssets(), idle);
        emit Rebalanced(deployed);
    }

    // ─── Risk Controls ───

    /// @notice Pause the vault (blocks deposits, harvests — withdrawals still work)
    function pause() external onlyGuardianOrOwner {
        _pause();
    }

    /// @notice Unpause the vault (owner only — guardian can pause but not unpause)
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Emergency: pull all funds from all strategies back to vault
    function emergencyWithdrawAll() external onlyGuardianOrOwner {
        uint256 recovered = strategyManager.emergencyWithdrawAll();
        _pause();
        emit EmergencyWithdrawAll(recovered);
    }

    /// @notice Reset circuit breaker after investigation (owner only)
    function resetCircuitBreaker() external onlyOwner {
        circuitBreakerTripped = false;
        highWaterMark = totalAssets();
        emit CircuitBreakerReset(highWaterMark);
    }

    /// @notice Rescue a non-USDC ERC20 (e.g. stranded reward token) from a strategy contract
    ///         back to this vault. Needed because `emergencyWithdraw` only sweeps USDC and
    ///         reward tokens can otherwise be trapped on a strategy after removal.
    ///         USDC is explicitly disallowed and routed through the normal withdraw path.
    function rescueStrategyToken(address strategy, address token) external onlyOwner {
        if (strategy == address(0) || token == address(0)) revert Errors.ZeroAddress();
        if (token == asset()) revert Errors.ZeroAmount();
        IBaseStrategyRescue(strategy).rescueToken(token);
    }

    // ─── Admin (Owner only, not timelock-gated for speed) ───

    function setGuardian(address newGuardian) external onlyOwner {
        if (newGuardian == address(0)) revert Errors.ZeroAddress();
        emit GuardianUpdated(guardian, newGuardian);
        guardian = newGuardian;
    }

    function setHarvester(address newHarvester) external onlyOwner {
        if (newHarvester == address(0)) revert Errors.ZeroAddress();
        emit HarvesterUpdated(harvester, newHarvester);
        harvester = newHarvester;
    }

    function setFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert Errors.ZeroAddress();
        emit FeeRecipientUpdated(feeRecipient, newRecipient);
        feeRecipient = newRecipient;
    }

    function setTimelock(address newTimelock) external onlyTimelock {
        if (newTimelock == address(0)) revert Errors.ZeroAddress();
        emit TimelockUpdated(timelock, newTimelock);
        timelock = newTimelock;
    }

    // ─── Internal ───

    /// @notice Ensure enough idle USDC for a withdrawal. Pull from strategies if needed.
    /// @dev    Partial fills are not a silent loss vector: if the strategies collectively
    ///         cannot produce `amount`, the subsequent `safeTransfer(receiver, assets)` in
    ///         the calling `withdraw`/`redeem` will revert on insufficient balance,
    ///         atomically rolling back the preceding share burn. The user's shares are
    ///         preserved. This is a DoS failure mode (withdrawal blocked until strategies
    ///         can liquidate) but is not a loss-of-funds vector.
    function _ensureIdle(uint256 amount) internal {
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        if (idle >= amount) return;

        uint256 deficit = amount - idle;
        strategyManager.withdrawFromStrategies(deficit);
    }

    /// @notice Update high water mark if totalAssets increased
    function _updateHighWaterMark() internal {
        uint256 current = totalAssets();
        if (current > highWaterMark) {
            highWaterMark = current;
        }
    }

    /// @notice Check if drawdown exceeds threshold (view, no state change)
    function _isDrawdownExceeded() internal view returns (bool) {
        if (highWaterMark == 0) return false;
        uint256 current = totalAssets();
        uint256 drawdown = highWaterMark > current ? highWaterMark - current : 0;
        uint256 drawdownBps = (drawdown * Constants.MAX_BPS) / highWaterMark;
        return drawdownBps >= DRAWDOWN_THRESHOLD_BPS;
    }

    /// @notice Check if drawdown exceeds threshold and trip breaker
    function _checkCircuitBreaker() internal {
        if (_isDrawdownExceeded()) {
            circuitBreakerTripped = true;
            emit CircuitBreakerTripped(totalAssets(), highWaterMark);
        }
    }
}
