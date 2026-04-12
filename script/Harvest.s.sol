// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {Harvester} from "../src/periphery/Harvester.sol";

/// @notice Manual harvest trigger.
///   HARVESTER=0x... forge script script/Harvest.s.sol --rpc-url arbitrum --broadcast
contract HarvestScript is Script {
    function run() external {
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address harvesterAddr = vm.envAddress("HARVESTER");

        Harvester harvester = Harvester(harvesterAddr);

        vm.startBroadcast(key);

        if (harvester.canHarvest()) {
            harvester.harvestIfNeeded();
            console2.log("Harvest executed.");
            console2.log("  Last share price:", harvester.lastSharePrice());
            console2.log("  Current share price:", harvester.currentSharePrice());
        } else {
            console2.log("Harvest not needed yet.");
            console2.log("Last harvest:", harvester.lastHarvestTime());
            console2.log("Min interval:", harvester.minHarvestInterval());
            console2.log("Last share price:", harvester.lastSharePrice());
        }

        vm.stopBroadcast();
    }
}
