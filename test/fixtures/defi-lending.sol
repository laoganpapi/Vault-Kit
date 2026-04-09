// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * DeFi lending pool with multiple vulnerability patterns.
 * Tests: centralization, precision loss, flash loan, oracle, events, assembly.
 */

interface IERC20 {
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

interface AggregatorV3Interface {
    function latestRoundData() external view returns (
        uint80, int256, uint256, uint256, uint80
    );
}

// Locked ether: receives ETH, no withdraw
contract ETHTrap {
    receive() external payable {}
    // No way to get ETH out!
}

// State shadowing
contract Base {
    uint256 public value;
    address public admin;
}

contract Derived is Base {
    uint256 public value;  // shadows Base.value

    function setValues(uint256 v) external {
        value = v;
    }
}

// Missing events + centralization risk
contract LendingPool {
    address public owner;
    uint256 public feeRate;
    uint256 public liquidationThreshold;
    bool public paused;
    IERC20 public token;
    AggregatorV3Interface public oracle;

    mapping(address => uint256) public deposits;
    mapping(address => uint256) public borrows;
    uint256 public totalDeposits;
    uint256 public totalBorrows;

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _token, address _oracle) {
        owner = msg.sender;
        token = IERC20(_token);
        oracle = AggregatorV3Interface(_oracle);
        feeRate = 300; // 3%
    }

    // Centralization: owner can drain funds
    function emergencyWithdraw(address to, uint256 amount) external onlyOwner {
        token.transfer(to, amount);
    }

    // Centralization: owner can pause forever
    function pause() external onlyOwner {
        paused = true;
    }
    function unpause() external onlyOwner {
        paused = false;
    }

    // Missing event: critical parameter change
    function setFeeRate(uint256 newRate) external onlyOwner {
        feeRate = newRate;  // No event, no max bound
    }

    // Missing event: critical parameter change
    function setLiquidationThreshold(uint256 threshold) external onlyOwner {
        liquidationThreshold = threshold;
    }

    // Precision loss: division before multiplication
    function calculateInterest(uint256 principal, uint256 rate, uint256 time) public pure returns (uint256) {
        // BAD: divides before multiplying
        return (principal / 10000) * rate * time;
    }

    // Precision loss: division by large number
    function calculateFee(uint256 amount) public view returns (uint256) {
        return amount * feeRate / 1000000;
    }

    // Oracle: missing staleness + price validation
    function getCollateralValue(uint256 amount) public view returns (uint256) {
        (, int256 price,,,) = oracle.latestRoundData();
        // Missing: price > 0 check, staleness check, round completeness
        return amount * uint256(price) / 1e8;
    }

    // Flash loan: balance-dependent check
    function deposit(uint256 amount) external {
        require(!paused, "Paused");
        require(token.balanceOf(msg.sender) >= amount, "Insufficient");
        token.transferFrom(msg.sender, address(this), amount);
        deposits[msg.sender] += amount;
        totalDeposits += amount;
    }

    function borrow(uint256 amount) external {
        require(!paused, "Paused");
        uint256 collateral = deposits[msg.sender];
        require(collateral * liquidationThreshold / 100 >= borrows[msg.sender] + amount, "Undercollateralized");
        borrows[msg.sender] += amount;
        totalBorrows += amount;
        token.transfer(msg.sender, amount);
    }

    // Uses assembly for gas optimization
    function getSlot(uint256 slot) external view returns (bytes32 result) {
        assembly {
            result := sload(slot)
        }
    }

    // Unsafe assembly: arbitrary sstore
    function setSlot(uint256 slot, bytes32 value) external onlyOwner {
        assembly {
            sstore(slot, value)
        }
    }

    // Division by variable without zero check
    function calculateShare(uint256 amount, uint256 total) public pure returns (uint256) {
        return amount * 1e18 / total;  // total could be 0
    }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
        // Missing event!
    }
}

// ERC-20 with more compliance issues
contract PartialToken {
    string public name = "Partial";
    string public symbol = "PRT";
    uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed, address indexed, uint256);
    // Missing: Approval event

    function transfer(address to, uint256 amount) public returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) public returns (bool) {
        allowance[msg.sender][spender] = amount;
        // Missing Approval event emission
        return true;
    }

    // Missing transferFrom, so ERC-20 incomplete
}
