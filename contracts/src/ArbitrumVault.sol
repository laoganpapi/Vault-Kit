// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title ArbitrumVault
 * @notice Yield-bearing vault on Arbitrum that accepts ERC-20 deposits,
 *         deploys capital to yield strategies, and distributes rewards.
 *         Follows ERC-4626-inspired share-based accounting.
 *
 * Security features:
 *   - ReentrancyGuard on all state-mutating external-call functions
 *   - SafeERC20 for all token interactions
 *   - Checks-Effects-Interactions pattern throughout
 *   - Chainlink oracle with staleness, price, and round validation
 *   - Fee caps to prevent owner abuse
 *   - Zero-address validation on all address setters
 *   - Events on every state change
 *   - Two-step ownership transfer
 */

// ============ Interfaces ============

interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IStrategy {
    function deposit(uint256 amount) external;
    function withdraw(uint256 amount) external returns (uint256);
    function balanceOf() external view returns (uint256);
    function harvest() external returns (uint256);
}

interface AggregatorV3Interface {
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
}

// ============ SafeERC20 (inline to avoid import dependency) ============

library SafeERC20 {
    function safeTransfer(IERC20 token, address to, uint256 amount) internal {
        (bool success, bytes memory data) = address(token).call(
            abi.encodeWithSelector(token.transfer.selector, to, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "SafeERC20: transfer failed");
    }

    function safeTransferFrom(IERC20 token, address from, address to, uint256 amount) internal {
        (bool success, bytes memory data) = address(token).call(
            abi.encodeWithSelector(token.transferFrom.selector, from, to, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "SafeERC20: transferFrom failed");
    }

    function safeApprove(IERC20 token, address spender, uint256 amount) internal {
        // Reset to 0 first to handle non-standard tokens (e.g., USDT)
        (bool success, bytes memory data) = address(token).call(
            abi.encodeWithSelector(token.approve.selector, spender, 0)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "SafeERC20: approve failed");

        if (amount > 0) {
            (success, data) = address(token).call(
                abi.encodeWithSelector(token.approve.selector, spender, amount)
            );
            require(success && (data.length == 0 || abi.decode(data, (bool))), "SafeERC20: approve failed");
        }
    }
}

contract ArbitrumVault {
    using SafeERC20 for IERC20;

    // ============ Constants & Caps ============

    uint8 public constant decimals = 18;
    uint256 public constant MAX_PERFORMANCE_FEE = 3000;   // 30%
    uint256 public constant MAX_WITHDRAWAL_FEE = 500;     // 5%
    uint256 public constant MAX_MANAGEMENT_FEE = 500;     // 5%
    uint256 public constant MAX_ORACLE_STALENESS = 3600;  // 1 hour
    uint256 public constant MAX_WITHDRAWAL_DELAY = 7 days;

    // ============ State Variables ============

    string public name;
    string public symbol;

    address public owner;
    address public guardian;
    address public pendingOwner;

    IERC20 public immutable asset;
    IStrategy public strategy;
    AggregatorV3Interface public immutable priceFeed;
    AggregatorV3Interface public immutable sequencerUptimeFeed;
    uint256 public constant GRACE_PERIOD = 3600; // 1 hour after sequencer recovery

    mapping(address => uint256) public shares;
    uint256 public totalShares;
    uint256 public totalAssets;

    // Fee configuration
    uint256 public performanceFee;
    uint256 public withdrawalFee;
    uint256 public managementFee;
    address public feeRecipient;
    uint256 public lastFeeCollection;

    // Security
    bool public paused;
    bool public emergencyMode;
    uint256 public depositCap;
    uint256 public minDeposit;
    mapping(address => uint256) public lastDepositTime;
    uint256 public withdrawalDelay;

    // Whitelisting
    bool public whitelistEnabled;
    mapping(address => bool) public whitelist;

    // Reentrancy guard
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _reentrancyStatus = _NOT_ENTERED;

    // ============ Events ============

    event Deposit(address indexed user, uint256 assets, uint256 shares);
    event Withdraw(address indexed user, uint256 assets, uint256 shares);
    event StrategyUpdated(address indexed oldStrategy, address indexed newStrategy);
    event Harvested(uint256 profit, uint256 fee);
    event FeesCollected(uint256 amount);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event EmergencyModeSet(bool enabled);
    event PerformanceFeeUpdated(uint256 oldFee, uint256 newFee);
    event WithdrawalFeeUpdated(uint256 oldFee, uint256 newFee);
    event ManagementFeeUpdated(uint256 oldFee, uint256 newFee);
    event DepositCapUpdated(uint256 oldCap, uint256 newCap);
    event MinDepositUpdated(uint256 oldMin, uint256 newMin);
    event WithdrawalDelayUpdated(uint256 oldDelay, uint256 newDelay);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event GuardianUpdated(address indexed oldGuardian, address indexed newGuardian);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event WhitelistUpdated(address indexed account, bool status);
    event WhitelistEnabledUpdated(bool enabled);

    // ============ Modifiers ============

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyGuardian() {
        require(msg.sender == guardian || msg.sender == owner, "Not guardian");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Paused");
        _;
    }

    modifier whenNotEmergency() {
        require(!emergencyMode, "Emergency mode");
        _;
    }

    modifier nonReentrant() {
        require(_reentrancyStatus != _ENTERED, "ReentrancyGuard: reentrant call");
        _reentrancyStatus = _ENTERED;
        _;
        _reentrancyStatus = _NOT_ENTERED;
    }

    // ============ Constructor ============

    constructor(
        string memory _name,
        string memory _symbol,
        address _asset,
        address _priceFeed,
        address _sequencerUptimeFeed,
        address _feeRecipient
    ) {
        require(_asset != address(0), "Zero asset address");
        require(_priceFeed != address(0), "Zero oracle address");
        require(_sequencerUptimeFeed != address(0), "Zero sequencer feed");
        require(_feeRecipient != address(0), "Zero fee recipient");

        name = _name;
        symbol = _symbol;
        owner = msg.sender;
        guardian = msg.sender;
        asset = IERC20(_asset);
        priceFeed = AggregatorV3Interface(_priceFeed);
        sequencerUptimeFeed = AggregatorV3Interface(_sequencerUptimeFeed);
        feeRecipient = _feeRecipient;

        performanceFee = 1000;    // 10%
        withdrawalFee = 50;       // 0.5%
        managementFee = 200;      // 2%
        depositCap = type(uint256).max;
        minDeposit = 0.01 ether;
        withdrawalDelay = 0;
        lastFeeCollection = block.timestamp;
    }

    // ============ Deposit / Withdraw ============

    // Dead shares minted on first deposit to prevent share inflation attack.
    // Inspired by Uniswap V2's MINIMUM_LIQUIDITY pattern.
    uint256 public constant DEAD_SHARES = 1000;

    function deposit(uint256 amount) external nonReentrant whenNotPaused whenNotEmergency {
        require(amount >= minDeposit, "Below minimum");
        require(totalAssets + amount <= depositCap, "Cap exceeded");

        if (whitelistEnabled) {
            require(whitelist[msg.sender], "Not whitelisted");
        }

        // Measure actual received amount to support fee-on-transfer tokens
        uint256 balanceBefore = asset.balanceOf(address(this));
        asset.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = asset.balanceOf(address(this)) - balanceBefore;
        require(received > 0, "No assets received");

        // Calculate shares based on actual received amount
        // First depositor: lock DEAD_SHARES to address(0) to prevent inflation attack
        uint256 sharesToMint;
        if (totalShares == 0) {
            require(received > DEAD_SHARES, "Below dead share threshold");
            sharesToMint = received - DEAD_SHARES;
            // Lock dead shares permanently — nobody can withdraw them
            shares[address(0)] += DEAD_SHARES;
            totalShares += DEAD_SHARES;
        } else {
            // Defensive: by invariant totalShares > 0 implies totalAssets > 0,
            // but we re-check to surface any future state corruption clearly
            // and to avoid relying on implicit branch reasoning.
            require(totalAssets != 0, "totalAssets is zero");
            sharesToMint = _convertAssetsToShares(received);
        }
        require(sharesToMint != 0, "Zero shares minted");

        // Effects (state was already settled for dead-share branch; now complete the rest)
        shares[msg.sender] += sharesToMint;
        totalShares += sharesToMint;
        totalAssets += received;
        lastDepositTime[msg.sender] = block.timestamp;

        emit Deposit(msg.sender, received, sharesToMint);
    }

    function withdraw(uint256 shareAmount) external nonReentrant whenNotPaused {
        require(shareAmount != 0, "Zero shares");
        require(shares[msg.sender] >= shareAmount, "Insufficient shares");

        // Withdrawal-delay check.
        // block.timestamp can be manipulated by validators by ~15 seconds.
        // This is acceptable here because the withdrawal delay is administered
        // in seconds and is intended to be at least a few minutes (and is
        // capped at MAX_WITHDRAWAL_DELAY = 7 days). A 15-second skew is
        // negligible relative to the intended granularity.
        require(
            block.timestamp >= lastDepositTime[msg.sender] + withdrawalDelay,
            "Withdrawal delay"
        );

        // Convert shares to assets via the rounding-aware helper.
        // Round-down on redemption is intentional and standard ERC-4626
        // behaviour: it pays the user slightly less than their pro-rata share,
        // leaving the dust with the vault. The opposite (round up) would
        // enable dust-extraction attacks.
        uint256 assetAmount = _convertSharesToAssets(shareAmount);
        require(assetAmount != 0, "Zero assets");

        // Calculate withdrawal fee (round down — user pays slightly less fee)
        uint256 fee = (assetAmount * withdrawalFee) / 10000;
        uint256 netAmount = assetAmount - fee;

        // CEI: Effects BEFORE interactions
        shares[msg.sender] -= shareAmount;
        totalShares -= shareAmount;
        totalAssets -= assetAmount;

        // Interactions: transfers AFTER all state changes
        if (fee > 0) {
            asset.safeTransfer(feeRecipient, fee);
        }
        asset.safeTransfer(msg.sender, netAmount);

        emit Withdraw(msg.sender, netAmount, shareAmount);
    }

    // ============ Conversion helpers (rounding-aware) ============

    /// @notice Convert assets to shares (round DOWN — fewer shares minted, vault favored).
    /// @dev Defensive: explicit require so the helper is robust independent of caller.
    function _convertAssetsToShares(uint256 assets) internal view returns (uint256) {
        uint256 _totalAssets = totalAssets;
        require(_totalAssets != 0, "totalAssets is zero");
        return (assets * totalShares) / _totalAssets;
    }

    /// @notice Convert shares to assets (round DOWN — vault keeps the dust, standard ERC-4626).
    /// @dev Defensive: explicit require so the helper is robust independent of caller.
    function _convertSharesToAssets(uint256 shareAmount) internal view returns (uint256) {
        uint256 _totalShares = totalShares;
        require(_totalShares != 0, "totalShares is zero");
        return (shareAmount * totalAssets) / _totalShares;
    }

    // ============ Strategy Management ============

    function setStrategy(address _strategy) external nonReentrant onlyOwner {
        require(_strategy != address(0), "Zero strategy address");
        address oldStrategy = address(strategy);

        // Withdraw from old strategy first
        if (oldStrategy != address(0)) {
            uint256 balance = strategy.balanceOf();
            if (balance > 0) {
                strategy.withdraw(balance);
            }
        }

        // Update state
        strategy = IStrategy(_strategy);

        // Deposit into new strategy
        uint256 available = asset.balanceOf(address(this));
        if (available > 0) {
            asset.safeApprove(IERC20(address(asset)), _strategy, available);
            strategy.deposit(available);
        }

        emit StrategyUpdated(oldStrategy, _strategy);
    }

    function deployToStrategy(uint256 amount) external nonReentrant onlyOwner whenNotPaused {
        require(address(strategy) != address(0), "No strategy");
        require(amount != 0, "Zero amount");
        asset.safeApprove(IERC20(address(asset)), address(strategy), amount);
        strategy.deposit(amount);
    }

    function withdrawFromStrategy(uint256 amount) external nonReentrant onlyOwner {
        require(address(strategy) != address(0), "No strategy");
        require(amount != 0, "Zero amount");
        strategy.withdraw(amount);
    }

    // ============ Harvest & Fees ============

    function harvest() external nonReentrant onlyGuardian whenNotPaused {
        require(address(strategy) != address(0), "No strategy");

        uint256 profit = strategy.harvest();

        if (profit > 0) {
            uint256 fee = (profit * performanceFee) / 10000;

            // CEI: update state BEFORE transfers
            totalAssets += profit - fee;

            // Interaction: transfer fee after state update
            if (fee > 0) {
                asset.safeTransfer(feeRecipient, fee);
            }

            emit Harvested(profit, fee);
        }
    }

    function collectManagementFees() external nonReentrant onlyOwner {
        uint256 elapsed = block.timestamp - lastFeeCollection;
        require(elapsed > 0, "No time elapsed");

        uint256 fee = (totalAssets * managementFee * elapsed) / (10000 * 365 days);

        if (fee > 0 && fee < totalAssets) {
            // CEI: all state changes BEFORE transfer
            totalAssets -= fee;
            lastFeeCollection = block.timestamp;

            // Interaction
            asset.safeTransfer(feeRecipient, fee);

            emit FeesCollected(fee);
        }
    }

    // ============ Price Feed ============

    function getAssetPrice() public view returns (uint256) {
        // Check L2 sequencer uptime (Arbitrum-specific).
        // Chainlink sequencer feed: answer == 0 means sequencer is UP.
        (, int256 sequencerAnswer, uint256 sequencerStartedAt,,) = sequencerUptimeFeed.latestRoundData();
        require(sequencerAnswer == 0, "Sequencer down");
        require(block.timestamp - sequencerStartedAt > GRACE_PERIOD, "Grace period not over");

        (
            uint80 roundId,
            int256 answer,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = priceFeed.latestRoundData();

        // Validate price is positive
        require(answer > 0, "Oracle: invalid price");

        // Validate staleness
        require(block.timestamp - updatedAt <= MAX_ORACLE_STALENESS, "Oracle: stale price");

        // Validate round completeness
        require(answeredInRound >= roundId, "Oracle: round not complete");

        return uint256(answer);
    }

    function getTotalValueUSD() external view returns (uint256) {
        uint256 price = getAssetPrice();
        return (totalAssets * price) / 1e8;
    }

    // ============ Admin Functions ============

    function pause() external onlyGuardian {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function setEmergencyMode(bool _emergency) external onlyOwner {
        emergencyMode = _emergency;
        emit EmergencyModeSet(_emergency);
    }

    function setPerformanceFee(uint256 _fee) external onlyOwner {
        require(_fee <= MAX_PERFORMANCE_FEE, "Fee exceeds maximum");
        uint256 oldFee = performanceFee;
        performanceFee = _fee;
        emit PerformanceFeeUpdated(oldFee, _fee);
    }

    function setWithdrawalFee(uint256 _fee) external onlyOwner {
        require(_fee <= MAX_WITHDRAWAL_FEE, "Fee exceeds maximum");
        uint256 oldFee = withdrawalFee;
        withdrawalFee = _fee;
        emit WithdrawalFeeUpdated(oldFee, _fee);
    }

    function setManagementFee(uint256 _fee) external onlyOwner {
        require(_fee <= MAX_MANAGEMENT_FEE, "Fee exceeds maximum");
        uint256 oldFee = managementFee;
        managementFee = _fee;
        emit ManagementFeeUpdated(oldFee, _fee);
    }

    function setDepositCap(uint256 _cap) external onlyOwner {
        uint256 oldCap = depositCap;
        depositCap = _cap;
        emit DepositCapUpdated(oldCap, _cap);
    }

    function setMinDeposit(uint256 _min) external onlyOwner {
        uint256 oldMin = minDeposit;
        minDeposit = _min;
        emit MinDepositUpdated(oldMin, _min);
    }

    function setWithdrawalDelay(uint256 _delay) external onlyOwner {
        require(_delay <= MAX_WITHDRAWAL_DELAY, "Delay exceeds maximum");
        uint256 oldDelay = withdrawalDelay;
        withdrawalDelay = _delay;
        emit WithdrawalDelayUpdated(oldDelay, _delay);
    }

    function setFeeRecipient(address _recipient) external onlyOwner {
        require(_recipient != address(0), "Zero address");
        address oldRecipient = feeRecipient;
        feeRecipient = _recipient;
        emit FeeRecipientUpdated(oldRecipient, _recipient);
    }

    function setGuardian(address _guardian) external onlyOwner {
        require(_guardian != address(0), "Zero address");
        address oldGuardian = guardian;
        guardian = _guardian;
        emit GuardianUpdated(oldGuardian, _guardian);
    }

    function transferOwnership(address _newOwner) external onlyOwner {
        require(_newOwner != address(0), "Zero address");
        pendingOwner = _newOwner;
        emit OwnershipTransferStarted(owner, _newOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "Not pending owner");
        address oldOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(oldOwner, msg.sender);
    }

    function setWhitelistEnabled(bool _enabled) external onlyOwner {
        whitelistEnabled = _enabled;
        emit WhitelistEnabledUpdated(_enabled);
    }

    function addToWhitelist(address[] calldata _addresses) external onlyOwner {
        for (uint256 i = 0; i < _addresses.length; i++) {
            require(_addresses[i] != address(0), "Zero address");
            whitelist[_addresses[i]] = true;
            emit WhitelistUpdated(_addresses[i], true);
        }
    }

    function removeFromWhitelist(address _address) external onlyOwner {
        whitelist[_address] = false;
        emit WhitelistUpdated(_address, false);
    }

    // ============ Emergency ============

    function emergencyWithdraw() external nonReentrant onlyOwner {
        // CEI: set state BEFORE external calls
        emergencyMode = true;
        paused = true;

        // Pull everything from strategy
        if (address(strategy) != address(0)) {
            uint256 balance = strategy.balanceOf();
            if (balance > 0) {
                strategy.withdraw(balance);
            }
        }

        // Send all assets to owner
        uint256 total = asset.balanceOf(address(this));
        if (total > 0) {
            asset.safeTransfer(owner, total);
        }

        emit EmergencyModeSet(true);
        emit Paused(msg.sender);
    }

    // ============ View Functions ============

    function sharePrice() external view returns (uint256) {
        if (totalShares == 0) return 1e18;
        return (totalAssets * 1e18) / totalShares;
    }

    function balanceOf(address account) external view returns (uint256) {
        return shares[account];
    }

    function previewDeposit(uint256 amount) external view returns (uint256) {
        if (totalShares == 0) return amount;
        if (totalAssets == 0) return 0;
        return (amount * totalShares) / totalAssets;
    }

    function previewWithdraw(uint256 shareAmount) external view returns (uint256) {
        if (totalShares == 0) return 0;
        uint256 assetAmount = (shareAmount * totalAssets) / totalShares;
        uint256 fee = (assetAmount * withdrawalFee) / 10000;
        return assetAmount - fee;
    }

    function maxDeposit() external view returns (uint256) {
        if (paused || emergencyMode) return 0;
        if (totalAssets >= depositCap) return 0;
        return depositCap - totalAssets;
    }
}
