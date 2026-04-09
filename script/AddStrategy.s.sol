// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {Timelock} from "../src/core/Timelock.sol";

/// @notice Execute queued strategy additions after the 24h timelock delay.
///
/// Usage:
///   TIMELOCK=0x... VAULT=0x... AAVE_LEV=0x... AAVE_SUPPLY=0x... ETA=...
///   forge script script/AddStrategy.s.sol --rpc-url arbitrum --broadcast
contract AddStrategyScript is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address timelockAddr = vm.envAddress("TIMELOCK");
        address vaultAddr = vm.envAddress("VAULT");
        address aaveLev = vm.envAddress("AAVE_LEV");
        address aaveSupply = vm.envAddress("AAVE_SUPPLY");
        uint256 eta = vm.envUint("ETA"); // The ETA from Deploy.s.sol output

        Timelock timelock = Timelock(payable(timelockAddr));

        vm.startBroadcast(deployerKey);

        // Execute queued strategy additions
        timelock.executeTransaction(
            vaultAddr,
            0,
            "addStrategy(address,uint256)",
            abi.encode(aaveLev, 7500),
            eta
        );
        console2.log("AaveLeverageStrategy activated (75%)");

        timelock.executeTransaction(
            vaultAddr,
            0,
            "addStrategy(address,uint256)",
            abi.encode(aaveSupply, 2500),
            eta
        );
        console2.log("AaveSupplyStrategy activated (25%)");

        vm.stopBroadcast();
        console2.log("All strategies active. Vault is ready for deposits.");
    }
}
