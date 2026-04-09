// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {EmergencyModule} from "../src/periphery/EmergencyModule.sol";

/// @notice Emergency pause — pulls all funds from strategies.
///   EMERGENCY_MODULE=0x... forge script script/EmergencyPause.s.sol --rpc-url arbitrum --broadcast
contract EmergencyPauseScript is Script {
    function run() external {
        uint256 guardianKey = vm.envUint("GUARDIAN_PRIVATE_KEY");
        address emergencyAddr = vm.envAddress("EMERGENCY_MODULE");

        EmergencyModule emergency = EmergencyModule(emergencyAddr);

        vm.startBroadcast(guardianKey);
        emergency.triggerEmergency();
        vm.stopBroadcast();

        console2.log("EMERGENCY TRIGGERED. Vault paused. All strategy funds withdrawn.");
        console2.log("Users can still withdraw their USDC from the vault.");
    }
}
