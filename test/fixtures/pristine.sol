// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * A pristine fixture used for the Vault-Kit "clean-path" smoke test.
 *
 * Has zero admin functions, zero privileged operations, zero external calls,
 * and should produce 0 findings at any severity level. If Vault-Kit ever
 * reports anything on this file, a new false positive has been introduced
 * and needs to be fixed before shipping.
 */

/// @notice Simple pure-math library, no state, no privileges, no transfers.
library PureMath {
    function add(uint256 a, uint256 b) internal pure returns (uint256) {
        return a + b;
    }

    function mulDiv(uint256 a, uint256 b, uint256 denominator) internal pure returns (uint256) {
        require(denominator != 0, "denominator is zero");
        return (a * b) / denominator;
    }
}

/// @notice A minimal, deterministic contract with no admin, no calls, no upgrades.
contract Counter {
    uint256 public value;

    event Incremented(uint256 oldValue, uint256 newValue);

    function increment() external {
        uint256 oldValue = value;
        value = oldValue + 1;
        emit Incremented(oldValue, value);
    }

    function get() external view returns (uint256) {
        return value;
    }
}
