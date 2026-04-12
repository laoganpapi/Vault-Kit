// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

// ============ Mock ERC-20 ============

contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (allowance[from][msg.sender] != type(uint256).max) {
            allowance[from][msg.sender] -= amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }
}

// ============ Fee-on-Transfer Token (2% fee) ============

contract FoTToken {
    string public constant name = "FoT";
    string public constant symbol = "FOT";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public constant FEE_BPS = 200; // 2%

    event Transfer(address indexed from, address indexed to, uint256 value);

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
    }

    function _move(address from, address to, uint256 amount) internal {
        uint256 fee = (amount * FEE_BPS) / 10000;
        uint256 net = amount - fee;
        balanceOf[from] -= amount;
        balanceOf[to] += net;
        totalSupply -= fee;
        emit Transfer(from, to, net);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (allowance[from][msg.sender] != type(uint256).max) {
            allowance[from][msg.sender] -= amount;
        }
        _move(from, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
}

// ============ Mock Chainlink Aggregator ============

contract MockAggregator {
    int256 private _answer;
    uint256 private _updatedAt;
    uint80 private _roundId;

    constructor(int256 initialAnswer) {
        _answer = initialAnswer;
        _updatedAt = block.timestamp;
        _roundId = 1;
    }

    function setAnswer(int256 answer) external {
        _answer = answer;
        _updatedAt = block.timestamp;
        unchecked { _roundId++; }
    }

    function setStale() external {
        // Don't update _updatedAt — leave it old
        unchecked { _roundId++; }
    }

    function setRoundIncomplete() external {
        // _roundId moves forward but answeredInRound stays
        unchecked { _roundId++; }
        // We model this by NOT advancing answeredInRound (which we tie to _roundId - 1 below)
    }

    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        return (_roundId, _answer, _updatedAt, _updatedAt, _roundId);
    }
}

// ============ Mock Aave-like Lending Pool ============

contract MockLendingPool {
    MockERC20 public immutable underlying;
    MockERC20 public immutable aToken;

    constructor(address _underlying) {
        underlying = MockERC20(_underlying);
        aToken = new MockERC20("Mock aToken", "aMOCK", 18);
    }

    function getATokenAddress(address) external view returns (address) {
        return address(aToken);
    }

    /// @notice Pull `amount` of underlying from msg.sender and mint aToken to `onBehalfOf`.
    function supply(address /*asset*/, uint256 amount, address onBehalfOf, uint16) external {
        underlying.transferFrom(msg.sender, address(this), amount);
        aToken.mint(onBehalfOf, amount);
    }

    /// @notice Burn aToken from msg.sender and send underlying to `to`.
    function withdraw(address /*asset*/, uint256 amount, address to) external returns (uint256) {
        uint256 actualAmount = amount;
        if (amount == type(uint256).max) {
            actualAmount = aToken.balanceOf(msg.sender);
        }
        // burn aTokens by transferring to this contract (this is a mock — real Aave burns)
        aToken.transferFrom(msg.sender, address(this), actualAmount);
        underlying.transfer(to, actualAmount);
        return actualAmount;
    }

    /// @notice TEST-ONLY: simulate yield accrual by minting more aTokens to `holder`.
    function mockYield(address holder, uint256 amount) external {
        aToken.mint(holder, amount);
        underlying.mint(address(this), amount); // back the new aTokens with real underlying
    }
}
