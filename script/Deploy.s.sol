// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {YieldVault} from "../src/core/YieldVault.sol";
import {Timelock} from "../src/core/Timelock.sol";
import {AaveLeverageStrategy} from "../src/strategies/AaveLeverageStrategy.sol";
import {AaveDeltaNeutralStrategy} from "../src/strategies/AaveDeltaNeutralStrategy.sol";
import {GmxGmPoolStrategy} from "../src/strategies/GmxGmPoolStrategy.sol";
import {Harvester} from "../src/periphery/Harvester.sol";
import {EmergencyModule} from "../src/periphery/EmergencyModule.sol";
import {VaultRouter} from "../src/periphery/VaultRouter.sol";
import {Constants} from "../src/libraries/Constants.sol";

/// @notice Full deployment script for the Yield Vault system on Arbitrum.
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

        // GMX GM Market — ETH/USD market (stablecoin side earns perp fees)
        // This address should be verified on GMX's market list before deployment
        address gmMarket = vm.envOr("GM_MARKET", address(0));

        vm.startBroadcast(deployerKey);
        address deployer = vm.addr(deployerKey);

        // ─── 1. Deploy Timelock (24h delay) ───
        Timelock timelock = new Timelock(deployer, 24 hours);
        console2.log("Timelock:", address(timelock));

        // ─── 2. Deploy Vault ───
        // Note: harvester set to deployer initially, updated below after Harvester deploy
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
        // Strategies need both vault address (for USDC returns) and strategyManager (authorized caller)
        AaveLeverageStrategy aaveLev = new AaveLeverageStrategy(address(vault), strategyMgr, Constants.USDC);
        console2.log("AaveLeverageStrategy:", address(aaveLev));

        AaveDeltaNeutralStrategy aaveDn = new AaveDeltaNeutralStrategy(address(vault), strategyMgr, Constants.USDC);
        console2.log("AaveDeltaNeutralStrategy:", address(aaveDn));

        GmxGmPoolStrategy gmxStrat;
        if (gmMarket != address(0)) {
            gmxStrat = new GmxGmPoolStrategy(address(vault), strategyMgr, Constants.USDC, gmMarket);
            console2.log("GmxGmPoolStrategy:", address(gmxStrat));
        } else {
            console2.log("GmxGmPoolStrategy: SKIPPED (set GM_MARKET env var)");
        }

        // ─── 4. Deploy Periphery ───
        Harvester harvester = new Harvester(address(vault), deployer);
        console2.log("Harvester:", address(harvester));

        // Update harvester on vault
        vault.setHarvester(address(harvester));

        EmergencyModule emergency = new EmergencyModule(address(vault), guardian);
        console2.log("EmergencyModule:", address(emergency));

        VaultRouter router = new VaultRouter(address(vault));
        console2.log("VaultRouter:", address(router));

        // ─── 5. Queue Strategy Additions via Timelock ───
        uint256 eta = block.timestamp + 24 hours + 1;

        // Queue: addStrategy(aaveLev, 4000) — 40% allocation
        timelock.queueTransaction(
            address(vault),
            0,
            "addStrategy(address,uint256)",
            abi.encode(address(aaveLev), 4000),
            eta
        );
        console2.log("Queued AaveLeverage addition (40%) for ETA:", eta);

        // Queue: addStrategy(aaveDn, 3000) — 30% allocation
        timelock.queueTransaction(
            address(vault),
            0,
            "addStrategy(address,uint256)",
            abi.encode(address(aaveDn), 3000),
            eta
        );
        console2.log("Queued AaveDeltaNeutral addition (30%) for ETA:", eta);

        // Queue: addStrategy(gmxStrat, 3000) — 30% allocation
        if (address(gmxStrat) != address(0)) {
            timelock.queueTransaction(
                address(vault),
                0,
                "addStrategy(address,uint256)",
                abi.encode(address(gmxStrat), 3000),
                eta
            );
            console2.log("Queued GmxGmPool addition (30%) for ETA:", eta);
        }

        vm.stopBroadcast();

        // ─── Summary ───
        console2.log("");
        console2.log("=== DEPLOYMENT COMPLETE ===");
        console2.log("Next step: Wait 24h, then run AddStrategy.s.sol to activate strategies.");
        console2.log("After strategies are active, deposit USDC and call harvest() via the Harvester.");
    }
}
