// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ArbitrumVault
 * @notice Yield-bearing vault on Arbitrum that accepts ETH deposits,
 *         deploys capital to yield strategies, and distributes rewards.
 *         Follows ERC-4626-inspired share-based accounting.
 */

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

contract ArbitrumVault {
    // ============ State Variables ============

    string public name;
    string public symbol;
    uint8 public constant decimals = 18;

    address public owner;
    address public guardian;
    address public pendingOwner;

    IERC20 public asset;                    // Underlying token (e.g., WETH)
    IStrategy public strategy;              // Active yield strategy
    AggregatorV3Interface public priceFeed;  // Chainlink price feed

    mapping(address => uint256) public shares;
    uint256 public totalShares;
    uint256 public totalAssets;

    // Fee configuration
    uint256 public performanceFee;    // Basis points (e.g., 1000 = 10%)
    uint256 public withdrawalFee;     // Basis points
    uint256 public managementFee;     // Basis points per year
    address public feeRecipient;
    uint256 public lastFeeCollection;

    // Security
    bool public paused;
    bool public emergencyMode;
    uint256 public depositCap;
    uint256 public minDeposit;
    mapping(address => uint256) public lastDepositTime;
    uint256 public withdrawalDelay;   // seconds

    // Whitelisting
    bool public whitelistEnabled;
    mapping(address => bool) public whitelist;
    address[] public whitelistedAddresses;

    // ============ Events ============

    event Deposit(address indexed user, uint256 assets, uint256 shares);
    event Withdraw(address indexed user, uint256 assets, uint256 shares);
    event StrategyUpdated(address indexed oldStrategy, address indexed newStrategy);
    event Harvested(uint256 profit, uint256 fee);
    event FeesCollected(uint256 amount);
    event Paused(address indexed by);
    event Unpaused(address indexed by);

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

    // ============ Constructor ============

    constructor(
        string memory _name,
        string memory _symbol,
        address _asset,
        address _priceFeed,
        address _feeRecipient
    ) {
        name = _name;
        symbol = _symbol;
        owner = msg.sender;
        guardian = msg.sender;
        asset = IERC20(_asset);
        priceFeed = AggregatorV3Interface(_priceFeed);
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

    function deposit(uint256 amount) external whenNotPaused whenNotEmergency {
        require(amount >= minDeposit, "Below minimum");
        require(totalAssets + amount <= depositCap, "Cap exceeded");

        if (whitelistEnabled) {
            require(whitelist[msg.sender], "Not whitelisted");
        }

        // Calculate shares
        uint256 sharesToMint;
        if (totalShares == 0) {
            sharesToMint = amount;
        } else {
            sharesToMint = (amount * totalShares) / totalAssets;
        }

        // Transfer assets
        asset.transferFrom(msg.sender, address(this), amount);

        // Update state
        shares[msg.sender] += sharesToMint;
        totalShares += sharesToMint;
        totalAssets += amount;
        lastDepositTime[msg.sender] = block.timestamp;

        emit Deposit(msg.sender, amount, sharesToMint);
    }

    function withdraw(uint256 shareAmount) external whenNotPaused {
        require(shares[msg.sender] >= shareAmount, "Insufficient shares");
        require(
            block.timestamp >= lastDepositTime[msg.sender] + withdrawalDelay,
            "Withdrawal delay"
        );

        // Calculate assets
        uint256 assetAmount = (shareAmount * totalAssets) / totalShares;

        // Apply withdrawal fee
        uint256 fee = (assetAmount * withdrawalFee) / 10000;
        uint256 netAmount = assetAmount - fee;

        // Update state
        shares[msg.sender] -= shareAmount;
        totalShares -= shareAmount;
        totalAssets -= assetAmount;

        // Transfer fee
        if (fee > 0) {
            asset.transfer(feeRecipient, fee);
        }

        // Transfer assets to user
        asset.transfer(msg.sender, netAmount);

        emit Withdraw(msg.sender, netAmount, shareAmount);
    }

    // ============ Strategy Management ============

    function setStrategy(address _strategy) external onlyOwner {
        address oldStrategy = address(strategy);

        // Withdraw from old strategy
        if (oldStrategy != address(0)) {
            uint256 balance = strategy.balanceOf();
            if (balance > 0) {
                strategy.withdraw(balance);
            }
        }

        strategy = IStrategy(_strategy);

        // Deposit into new strategy
        uint256 available = asset.balanceOf(address(this));
        if (available > 0) {
            asset.approve(_strategy, available);
            strategy.deposit(available);
        }

        emit StrategyUpdated(oldStrategy, _strategy);
    }

    function deployToStrategy(uint256 amount) external onlyOwner whenNotPaused {
        require(address(strategy) != address(0), "No strategy");
        asset.approve(address(strategy), amount);
        strategy.deposit(amount);
    }

    function withdrawFromStrategy(uint256 amount) external onlyOwner {
        require(address(strategy) != address(0), "No strategy");
        strategy.withdraw(amount);
    }

    // ============ Harvest & Fees ============

    function harvest() external onlyGuardian whenNotPaused {
        require(address(strategy) != address(0), "No strategy");

        uint256 profit = strategy.harvest();

        if (profit > 0) {
            uint256 fee = (profit * performanceFee) / 10000;
            if (fee > 0) {
                asset.transfer(feeRecipient, fee);
            }
            totalAssets += profit - fee;
            emit Harvested(profit, fee);
        }
    }

    function collectManagementFees() external onlyOwner {
        uint256 elapsed = block.timestamp - lastFeeCollection;
        uint256 fee = (totalAssets * managementFee * elapsed) / (10000 * 365 days);

        if (fee > 0 && fee < totalAssets) {
            totalAssets -= fee;
            asset.transfer(feeRecipient, fee);
            lastFeeCollection = block.timestamp;
            emit FeesCollected(fee);
        }
    }

    // ============ Price Feed ============

    function getAssetPrice() public view returns (uint256) {
        (, int256 price,,,) = priceFeed.latestRoundData();
        return uint256(price);
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
    }

    function setPerformanceFee(uint256 _fee) external onlyOwner {
        performanceFee = _fee;
    }

    function setWithdrawalFee(uint256 _fee) external onlyOwner {
        withdrawalFee = _fee;
    }

    function setManagementFee(uint256 _fee) external onlyOwner {
        managementFee = _fee;
    }

    function setDepositCap(uint256 _cap) external onlyOwner {
        depositCap = _cap;
    }

    function setMinDeposit(uint256 _min) external onlyOwner {
        minDeposit = _min;
    }

    function setWithdrawalDelay(uint256 _delay) external onlyOwner {
        withdrawalDelay = _delay;
    }

    function setFeeRecipient(address _recipient) external onlyOwner {
        feeRecipient = _recipient;
    }

    function setGuardian(address _guardian) external onlyOwner {
        guardian = _guardian;
    }

    function transferOwnership(address _newOwner) external onlyOwner {
        pendingOwner = _newOwner;
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "Not pending owner");
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    function setWhitelistEnabled(bool _enabled) external onlyOwner {
        whitelistEnabled = _enabled;
    }

    function addToWhitelist(address[] calldata _addresses) external onlyOwner {
        for (uint256 i = 0; i < _addresses.length; i++) {
            whitelist[_addresses[i]] = true;
            whitelistedAddresses.push(_addresses[i]);
        }
    }

    function removeFromWhitelist(address _address) external onlyOwner {
        whitelist[_address] = false;
    }

    // ============ Emergency ============

    function emergencyWithdraw() external onlyOwner {
        // Pull everything from strategy
        if (address(strategy) != address(0)) {
            uint256 balance = strategy.balanceOf();
            if (balance > 0) {
                strategy.withdraw(balance);
            }
        }

        // Send all assets to owner
        uint256 total = asset.balanceOf(address(this));
        asset.transfer(owner, total);

        emergencyMode = true;
        paused = true;
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
