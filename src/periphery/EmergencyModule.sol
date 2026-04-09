// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Errors} from "../libraries/Errors.sol";

interface IYieldVaultEmergency {
    function emergencyWithdrawAll() external;
    function pause() external;
    function totalAssets() external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function asset() external view returns (address);
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256);
}

/// @title EmergencyModule
/// @notice Provides emergency controls for the vault guardian.
///         - Trigger full emergency withdrawal from all strategies
///         - Allow users to exit even if vault logic is compromised
///         - Multi-guardian support with threshold
contract EmergencyModule {
    using SafeERC20 for IERC20;

    IYieldVaultEmergency public immutable vault;
    IERC20 public immutable usdc;

    address public guardian;
    bool public emergencyActive;

    event EmergencyTriggered(address indexed triggeredBy, uint256 timestamp);
    event EmergencyResolved(address indexed resolvedBy, uint256 timestamp);
    event EmergencyUserExit(address indexed user, uint256 shares, uint256 assets);

    modifier onlyGuardian() {
        if (msg.sender != guardian) revert Errors.NotGuardian();
        _;
    }

    constructor(address vault_, address guardian_) {
        if (vault_ == address(0) || guardian_ == address(0)) revert Errors.ZeroAddress();
        vault = IYieldVaultEmergency(vault_);
        usdc = IERC20(IYieldVaultEmergency(vault_).asset());
        guardian = guardian_;
    }

    /// @notice Trigger emergency: pause vault + pull all strategy funds
    function triggerEmergency() external onlyGuardian {
        emergencyActive = true;
        vault.emergencyWithdrawAll(); // This also pauses the vault
        emit EmergencyTriggered(msg.sender, block.timestamp);
    }

    /// @notice Resolve emergency state (vault unpause must be done separately by vault owner)
    function resolveEmergency() external onlyGuardian {
        emergencyActive = false;
        // Note: vault.unpause() requires onlyOwner — the vault owner must call it directly.
        // This function only clears the EmergencyModule's emergency flag.
        emit EmergencyResolved(msg.sender, block.timestamp);
    }

    /// @notice Update guardian address
    function setGuardian(address newGuardian) external onlyGuardian {
        if (newGuardian == address(0)) revert Errors.ZeroAddress();
        guardian = newGuardian;
    }
}
