// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * Benchmark-style fixture with many high-severity vulnerabilities.
 * Each contract demonstrates one or more real-world bug classes.
 *
 * This fixture is used to verify Vault-Kit's HIGH-severity detection
 * coverage against benchmark-grade tools.
 */

interface IERC20 {
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

interface AggregatorV3Interface {
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}

// ============================================================
// BUG 1: Read-only reentrancy (Curve-style)
// View function exposes stale data during external calls.
// ============================================================
contract ReadOnlyReentrancyVault {
    mapping(address => uint256) public balances;
    uint256 public totalBalance;

    function withdraw(uint256 amount) external {
        // External call BEFORE state update
        (bool s,) = msg.sender.call{value: amount}("");
        require(s);
        balances[msg.sender] -= amount;
        totalBalance -= amount;
    }

    // View used by integrators — returns stale totalBalance during reentry
    function getSharePrice() external view returns (uint256) {
        if (totalBalance == 0) return 1e18;
        return address(this).balance * 1e18 / totalBalance;
    }

    receive() external payable {}
}

// ============================================================
// BUG 2: ecrecover zero-address attack + malleability
// ============================================================
contract BadSignatureAuth {
    address public uninitializedOwner; // defaults to 0x0!

    function claim(bytes32 hash, uint8 v, bytes32 r, bytes32 s) external {
        // Attacker can pass bad v/r/s to get address(0), which matches uninitializedOwner
        address signer = ecrecover(hash, v, r, s);
        require(signer == uninitializedOwner, "Not authorized");
        // ... give attacker ownership/funds
    }
}

// ============================================================
// BUG 3: Arbitrary external call (Furucombo-style)
// ============================================================
contract FuruProxy {
    function execute(address target, bytes calldata data) external payable {
        // Attacker-controlled target AND data
        (bool success,) = target.call{value: msg.value}(data);
        require(success);
    }
}

// ============================================================
// BUG 4: Uninitialized proxy implementation (Parity-style)
// Implementation contract's initializer can be called directly
// by an attacker, who then upgrades to a selfdestruct-ing impl.
// ============================================================
contract Initializable {}

contract UUPSImpl is Initializable {
    address public owner;
    bool public initialized;

    // MISSING: constructor that calls _disableInitializers()

    function initialize(address _owner) external {
        require(!initialized, "Already init");
        initialized = true;
        owner = _owner;
    }

    function upgradeTo(address newImpl) external {
        require(msg.sender == owner);
        // ... upgrade logic
    }
}

// ============================================================
// BUG 5: L2 sequencer uptime not checked
// ============================================================
contract ArbitrumPerps {
    AggregatorV3Interface public priceFeed;

    function liquidate(address user) external view returns (bool) {
        (, int256 price,, uint256 updatedAt,) = priceFeed.latestRoundData();
        require(price > 0);
        require(block.timestamp - updatedAt < 3600);
        // ... liquidation logic
        // MISSING: sequencer uptime feed check
        return true;
    }
}

// ============================================================
// BUG 6: Unsafe downcast
// ============================================================
contract StakingRewards {
    mapping(address => uint128) public rewards;
    uint256 public totalRewards;

    function addReward(address user, uint256 amount) external {
        // Silently truncates if amount > type(uint128).max
        rewards[user] = uint128(amount);
        totalRewards += amount;
    }
}

// ============================================================
// BUG 7: Forced ether balance assumption
// ============================================================
contract GameContract {
    uint256 public pot;

    function payout(address winner) external {
        // Strict equality breaks when attacker forces 1 wei in
        require(address(this).balance == pot, "Balance mismatch");
        (bool s,) = winner.call{value: pot}("");
        require(s);
        pot = 0;
    }

    function deposit() external payable {
        pot += msg.value;
    }
}

// ============================================================
// BUG 8: Share inflation (ERC-4626)
// ============================================================
contract InflatableVault {
    IERC20 public asset;
    mapping(address => uint256) public shares;
    uint256 public totalShares;
    uint256 public totalAssets;

    function deposit(uint256 amount) external returns (uint256 sharesOut) {
        if (totalShares == 0) {
            sharesOut = amount;
        } else {
            sharesOut = (amount * totalShares) / totalAssets;
        }
        asset.transferFrom(msg.sender, address(this), amount);
        shares[msg.sender] += sharesOut;
        totalShares += sharesOut;
        totalAssets += amount;
    }

    function withdraw(uint256 shareAmount) external returns (uint256 amount) {
        amount = (shareAmount * totalAssets) / totalShares;
        shares[msg.sender] -= shareAmount;
        totalShares -= shareAmount;
        totalAssets -= amount;
        asset.transfer(msg.sender, amount);
    }
}

// ============================================================
// BUG 9: Signature replay (no nonce, no deadline, no domain)
// ============================================================
contract ReplayableClaim {
    mapping(address => uint256) public claimed;

    function claim(address recipient, uint256 amount, uint8 v, bytes32 r, bytes32 s) external {
        bytes32 hash = keccak256(abi.encode(recipient, amount));
        address signer = ecrecover(hash, v, r, s);
        require(signer != address(0), "Invalid sig");
        // No nonce, no deadline — attacker can replay forever
        claimed[recipient] += amount;
    }
}

// ============================================================
// BUG 10: Missing oracle validation (basic)
// ============================================================
contract NaivePriceFeed {
    AggregatorV3Interface public feed;

    function getPrice() external view returns (uint256) {
        (, int256 price,,,) = feed.latestRoundData();
        // MISSING: price > 0, staleness, round completeness
        return uint256(price);
    }
}
