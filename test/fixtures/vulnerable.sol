// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * Deliberately vulnerable contract for testing Vault-Kit detectors.
 * DO NOT deploy this contract. It contains every major vulnerability class.
 */

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface AggregatorV3Interface {
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
    function latestAnswer() external view returns (int256);
}

interface IUniswapV2Pair {
    function getReserves() external view returns (uint112, uint112, uint32);
}

contract VulnerableVault {
    address public owner;
    mapping(address => uint256) public balances;
    mapping(address => uint256) public rewards;
    address[] public depositors;
    uint256 public totalDeposited;
    AggregatorV3Interface public priceFeed;
    IERC20 public token;

    // VK-REENTRANCY: No reentrancy guard
    // VK-ACCESS-CONTROL: No access control on critical functions

    constructor() {
        owner = msg.sender;
    }

    // --- REENTRANCY: state change after external call ---
    function withdraw(uint256 amount) public {
        require(balances[msg.sender] >= amount, "Insufficient balance");

        // External call BEFORE state change (CEI violation)
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");

        // State change AFTER external call
        balances[msg.sender] -= amount;
        totalDeposited -= amount;
    }

    // --- UNCHECKED CALL: return value not checked ---
    function unsafeWithdraw(uint256 amount) public {
        require(balances[msg.sender] >= amount);
        balances[msg.sender] -= amount;
        // Return value not checked!
        msg.sender.call{value: amount}("");
    }

    // --- UNCHECKED ERC-20: transfer return not checked ---
    function unsafeTokenTransfer(address to, uint256 amount) public {
        // ERC-20 return value not checked
        token.transfer(to, amount);
    }

    // --- TX.ORIGIN: used for auth ---
    function txOriginWithdraw() public {
        require(tx.origin == owner, "Not owner");
        (bool s,) = tx.origin.call{value: address(this).balance}("");
        require(s);
    }

    // --- ACCESS CONTROL: critical functions unprotected ---
    function setOwner(address newOwner) external {
        owner = newOwner;
    }

    function withdrawAll() external {
        (bool s,) = msg.sender.call{value: address(this).balance}("");
        require(s);
    }

    function mint(address to, uint256 amount) external {
        balances[to] += amount;
        totalDeposited += amount;
    }

    // --- SELFDESTRUCT: accessible without proper auth ---
    function destroy() public {
        selfdestruct(payable(msg.sender));
    }

    // --- TIMESTAMP DEPENDENCE: used for randomness ---
    function pseudoRandom() public view returns (uint256) {
        return uint256(keccak256(abi.encodePacked(block.timestamp, msg.sender))) % 100;
    }

    // --- TIMESTAMP: exact equality ---
    function claimAt(uint256 timestamp) public {
        require(block.timestamp == timestamp, "Wrong time");
        balances[msg.sender] += 1 ether;
    }

    // --- DOS: unbounded loop over growing array ---
    function distributeRewards() public {
        for (uint256 i = 0; i < depositors.length; i++) {
            address depositor = depositors[i];
            uint256 reward = balances[depositor] / 100;
            rewards[depositor] += reward;
        }
    }

    // --- DOS: external call in loop ---
    function sendRewards() public {
        for (uint256 i = 0; i < depositors.length; i++) {
            uint256 reward = rewards[depositors[i]];
            if (reward > 0) {
                rewards[depositors[i]] = 0;
                // Single failure blocks everyone
                payable(depositors[i]).transfer(reward);
            }
        }
    }

    // --- DELEGATECALL: to user-controlled address ---
    function executeDelegateCall(address target, bytes calldata data) public {
        target.delegatecall(data);
    }

    // --- ORACLE: no staleness check, no price validation ---
    function getPrice() public view returns (int256) {
        (, int256 answer,,,) = priceFeed.latestRoundData();
        // Missing: staleness check, answer > 0, round completeness
        return answer;
    }

    // --- ORACLE: deprecated function ---
    function getPriceLegacy() public view returns (int256) {
        return priceFeed.latestAnswer();
    }

    // --- FLASH LOAN: balance-dependent validation ---
    function voteWithBalance(uint256 proposalId) public {
        require(token.balanceOf(msg.sender) > 0, "No tokens");
        // Flash loan can inflate balance temporarily
    }

    // --- FRONT-RUNNING: swap without slippage protection ---
    function swap(address tokenIn, address tokenOut, uint256 amountIn) external {
        // No minAmountOut or deadline parameter
    }

    // --- GAS: storage read in loop, > 0 comparison ---
    function inefficientLoop() public {
        for (uint256 i = 0; i < depositors.length; i++) {
            if (balances[depositors[i]] > 0) {
                totalDeposited += balances[depositors[i]];
            }
        }
    }

    // --- INTEGER: unchecked arithmetic ---
    function uncheckedMath(uint256 a, uint256 b) public pure returns (uint256) {
        unchecked {
            return a * b; // Could overflow
        }
    }

    function deposit() public payable {
        require(msg.value > 0, "Zero deposit");
        balances[msg.sender] += msg.value;
        totalDeposited += msg.value;
        depositors.push(msg.sender);
    }

    receive() external payable {}
}

// --- FLOATING PRAGMA tested via the ^0.8.0 at the top ---

// --- PROXY: upgradeable without gap ---
contract VulnerableUpgradeable {
    uint256 public value;
    address public admin;
    // Missing __gap for future storage slots

    function initialize(uint256 _value) external {
        // Missing initializer guard
        value = _value;
        admin = msg.sender;
    }

    function upgrade(address newImpl) external {
        // No access control
        (bool s,) = newImpl.delegatecall(abi.encodeWithSignature("migrate()"));
        require(s);
    }
}

// --- ERC-20: non-compliant token ---
contract BadToken {
    string public name = "BadToken";
    mapping(address => uint256) public balanceOf;
    uint256 public totalSupply;

    event Transfer(address indexed from, address indexed to, uint256 value);

    // Missing: transfer() return value, transferFrom, allowance, approve, Approval event
    function transfer(address to, uint256 amount) public {
        require(balanceOf[msg.sender] >= amount);
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
    }
}
