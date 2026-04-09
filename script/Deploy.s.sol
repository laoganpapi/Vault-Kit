// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {YieldVault} from "../src/core/YieldVault.sol";
import {Timelock} from "../src/core/Timelock.sol";
import {AaveLeverageStrategy} from "../src/strategies/AaveLeverageStrategy.sol";
import {AaveSupplyStrategy} from "../src/strategies/AaveSupplyStrategy.sol";
import {Harvester} from "../src/periphery/Harvester.sol";
import {EmergencyModule} from "../src/periphery/EmergencyModule.sol";
import {VaultRouter} from "../src/periphery/VaultRouter.sol";
import {Constants} from "../src/libraries/Constants.sol";

/// @notice Full deployment script for the Yield Vault system on Arbitrum.
///
/// Strategies:
///   - AaveLeverageStrategy (60%): USDC supply/borrow loop, 10-15% APY
///   - AaveSupplyStrategy (40%): Simple USDC supply, 3-8% APY
///
/// Both strategies are fully synchronous — no async settlement, no keepers,
/// no cross-asset swaps, no multi-step failure risk.
///
/// Usage:
///   1. Copy .env.example → .env and fill in:
///      - DEPLOYER_PRIVATE_KEY
///      - GUARDIAN_ADDRESS (your cold wallet or multisig)
///      - FEE_RECIPIENT (address to receive performance fees)
///      - ARBITRUM_RPC_URL
///
///   2. Deploy:
///      forge script script/Deploy.s.sol --rpc-url arbitrum --broadcast --verify
///
///   3. After 24h, run AddStrategy.s.sol to execute the timelock-queued strategy additions.
contract DeployScript is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address guardian = vm.envAddress("GUARDIAN_ADDRESS");
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");

        vm.startBroadcast(deployerKey);
        address deployer = vm.addr(deployerKey);

        // ─── 1. Deploy Timelock (24h delay) ───
        Timelock timelock = new Timelock(deployer, 24 hours);
        console2.log("Timelock:", address(timelock));

        // ─── 2. Deploy Vault ───
        YieldVault vault = new YieldVault(
            IERC20(Constants.USDC),
            address(timelock),
            guardian,
            deployer, // harvester = deployer initially
            feeRecipient
        );
        console2.log("YieldVault:", address(vault));
        address strategyMgr = address(vault.strategyManager());
        console2.log("StrategyManager:", strategyMgr);

        // ─── 3. Deploy Strategies ───
        AaveLeverageStrategy aaveLev = new AaveLeverageStrategy(address(vault), strategyMgr, Constants.USDC);
        console2.log("AaveLeverageStrategy:", address(aaveLev));

        AaveSupplyStrategy aaveSupply = new AaveSupplyStrategy(address(vault), strategyMgr, Constants.USDC);
        console2.log("AaveSupplyStrategy:", address(aaveSupply));

        // ─── 4. Deploy Periphery ───
        Harvester harvester = new Harvester(address(vault), deployer);
        console2.log("Harvester:", address(harvester));

        vault.setHarvester(address(harvester));

        EmergencyModule emergency = new EmergencyModule(address(vault), guardian);
        console2.log("EmergencyModule:", address(emergency));

        VaultRouter router = new VaultRouter(address(vault));
        console2.log("VaultRouter:", address(router));

        // ─── 5. Queue Strategy Additions via Timelock ───
        uint256 eta = block.timestamp + 24 hours + 1;

        // Queue: addStrategy(aaveLev, 8500) — 85% allocation
        timelock.queueTransaction(
            address(vault),
            0,
            "addStrategy(address,uint256)",
            abi.encode(address(aaveLev), 8500),
            eta
        );
        console2.log("Queued AaveLeverage addition (85%) for ETA:", eta);

        // Queue: addStrategy(aaveSupply, 1500) — 15% allocation (liquidity buffer)
        timelock.queueTransaction(
            address(vault),
            0,
            "addStrategy(address,uint256)",
            abi.encode(address(aaveSupply), 1500),
            eta
        );
        console2.log("Queued AaveSupply addition (15%) for ETA:", eta);

        vm.stopBroadcast();

        // ─── Summary ───
        console2.log("");
        console2.log("=== DEPLOYMENT COMPLETE ===");
        console2.log("Next step: Wait 24h, then run AddStrategy.s.sol to activate strategies.");
        console2.log("After strategies are active, deposit USDC and call harvest() via the Harvester.");
    }
}
