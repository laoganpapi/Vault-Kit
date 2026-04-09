// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Errors} from "../libraries/Errors.sol";

/// @title Timelock
/// @notice Enforces a delay on all admin actions (add/remove strategy, change allocations).
///         Guardian can cancel queued transactions. Only admin can queue and execute.
contract Timelock {
    uint256 public constant MIN_DELAY = 24 hours;
    uint256 public constant MAX_DELAY = 30 days;
    uint256 public constant GRACE_PERIOD = 14 days;

    address public admin;
    address public pendingAdmin;
    uint256 public delay;

    mapping(bytes32 => bool) public queuedTransactions;

    event NewAdmin(address indexed newAdmin);
    event NewDelay(uint256 indexed newDelay);
    event QueueTransaction(
        bytes32 indexed txHash, address indexed target, uint256 value, string signature, bytes data, uint256 eta
    );
    event ExecuteTransaction(
        bytes32 indexed txHash, address indexed target, uint256 value, string signature, bytes data, uint256 eta
    );
    event CancelTransaction(
        bytes32 indexed txHash, address indexed target, uint256 value, string signature, bytes data, uint256 eta
    );

    modifier onlyAdmin() {
        require(msg.sender == admin, "Timelock: !admin");
        _;
    }

    modifier onlyTimelock() {
        require(msg.sender == address(this), "Timelock: !self");
        _;
    }

    constructor(address admin_, uint256 delay_) {
        if (delay_ < MIN_DELAY || delay_ > MAX_DELAY) revert Errors.TimelockDelayOutOfRange();
        if (admin_ == address(0)) revert Errors.ZeroAddress();

        admin = admin_;
        delay = delay_;
    }

    receive() external payable {}

    /// @notice Set new delay (must be called through timelock itself)
    function setDelay(uint256 delay_) external onlyTimelock {
        if (delay_ < MIN_DELAY || delay_ > MAX_DELAY) revert Errors.TimelockDelayOutOfRange();
        delay = delay_;
        emit NewDelay(delay_);
    }

    /// @notice Accept admin role (2-step transfer)
    function acceptAdmin() external {
        require(msg.sender == pendingAdmin, "Timelock: !pendingAdmin");
        admin = msg.sender;
        pendingAdmin = address(0);
        emit NewAdmin(msg.sender);
    }

    /// @notice Set pending admin (must be called through timelock)
    function setPendingAdmin(address pendingAdmin_) external onlyTimelock {
        pendingAdmin = pendingAdmin_;
    }

    /// @notice Queue a transaction for future execution
    function queueTransaction(
        address target,
        uint256 value,
        string calldata signature,
        bytes calldata data,
        uint256 eta
    ) external onlyAdmin returns (bytes32 txHash) {
        if (eta < block.timestamp + delay) revert Errors.TimelockDelayNotMet();

        txHash = keccak256(abi.encode(target, value, signature, data, eta));
        queuedTransactions[txHash] = true;

        emit QueueTransaction(txHash, target, value, signature, data, eta);
    }

    /// @notice Cancel a queued transaction
    function cancelTransaction(
        address target,
        uint256 value,
        string calldata signature,
        bytes calldata data,
        uint256 eta
    ) external onlyAdmin {
        bytes32 txHash = keccak256(abi.encode(target, value, signature, data, eta));
        queuedTransactions[txHash] = false;

        emit CancelTransaction(txHash, target, value, signature, data, eta);
    }

    /// @notice Execute a queued transaction after its ETA
    function executeTransaction(
        address target,
        uint256 value,
        string calldata signature,
        bytes calldata data,
        uint256 eta
    ) external onlyAdmin returns (bytes memory) {
        bytes32 txHash = keccak256(abi.encode(target, value, signature, data, eta));

        if (!queuedTransactions[txHash]) revert Errors.TimelockTxNotQueued();
        if (block.timestamp < eta) revert Errors.TimelockDelayNotMet();
        if (block.timestamp > eta + GRACE_PERIOD) revert Errors.TimelockTxExpired();

        queuedTransactions[txHash] = false;

        bytes memory callData;
        if (bytes(signature).length == 0) {
            callData = data;
        } else {
            callData = abi.encodePacked(bytes4(keccak256(bytes(signature))), data);
        }

        (bool success, bytes memory returnData) = target.call{value: value}(callData);
        require(success, "Timelock: tx reverted");

        emit ExecuteTransaction(txHash, target, value, signature, data, eta);
        return returnData;
    }
}
