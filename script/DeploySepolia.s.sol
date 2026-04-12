// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {YieldVault} from "../src/core/YieldVault.sol";
import {Timelock} from "../src/core/Timelock.sol";
import {Harvester} from "../src/periphery/Harvester.sol";
import {EmergencyModule} from "../src/periphery/EmergencyModule.sol";
import {IdleStrategy} from "../src/strategies/IdleStrategy.sol";

/// @title DeploySepolia
/// @notice Arbitrum Sepolia testnet deployment. Uses IdleStrategy as the single initial
///         strategy because:
///           1. Chainlink price feeds and Uniswap V3 are sparse/absent on Arbitrum Sepolia.
///           2. Testing Aave V3 integration is done via fork tests (test/fork/), not a
///              live Sepolia deployment — the fork tests give real Aave behavior at zero cost.
///           3. IdleStrategy exercises the full vault + manager + harvester + timelock
///              plumbing with zero external-dependency failure surface, which is the actual
///              purpose of a testnet deploy: verify that YOUR code behaves correctly under
///              realistic user flows (deposit → rebalance → withdraw → pause → unpause).
///
/// Known-good Arbitrum Sepolia addresses:
///   - Native USDC (Circle):    0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d
///     (Bridged USDC:           0xf3c3351d6bd0098eeb33ca8f830faf2a141ea2e1)
///
/// Usage:
///   1. Copy .env.example → .env and fill in:
///        ARBITRUM_SEPOLIA_RPC_URL=...
///        DEPLOYER_PRIVATE_KEY=0x...
///        GUARDIAN_ADDRESS=0x...
///        FEE_RECIPIENT=0x...
///        SEPOLIA_USDC_ADDRESS=0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d
///
///   2. Deploy:
///        forge script script/DeploySepolia.s.sol \
///          --rpc-url $ARBITRUM_SEPOLIA_RPC_URL --broadcast --verify
///
///   3. After 24h, execute the queued strategy addition via AddStrategy.s.sol.
///
/// @dev  Known Aave V3 Sepolia pool addresses (for reference if you want to extend this
///       later with a SepoliaAaveSupplyStrategy — but note the reward-swap path still
///       requires Chainlink which isn't reliably deployed on Sepolia):
///           Pool:                 0xBfC91D59fdAA134A4ED45f7B584cAf96D7792Eff
///           PoolAddressesProvider:0xB25a5D144626a0D488e52AE717A051a2E9997076
///           aUSDC:                0x460b97BD498E1157530AEb3086301d5225b91216
///           variableDebtUSDC:     0x4fBE3A94C60A5085dA6a2D309965DcF34c36711d
///           RewardsController:    0x3A203B14CF8749a1e3b7314c6c49004B77Ee667A
contract DeploySepoliaScript is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address guardian = vm.envAddress("GUARDIAN_ADDRESS");
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        address usdcAddr = vm.envAddress("SEPOLIA_USDC_ADDRESS");

        require(usdcAddr != address(0), "SEPOLIA_USDC_ADDRESS not set");
        require(guardian != address(0), "GUARDIAN_ADDRESS not set");
        require(feeRecipient != address(0), "FEE_RECIPIENT not set");

        vm.startBroadcast(deployerKey);
        address deployer = vm.addr(deployerKey);

        console2.log("=== Deploying Vault-Kit to Arbitrum Sepolia ===");
        console2.log("Deployer:", deployer);
        console2.log("USDC:", usdcAddr);
        console2.log("Guardian:", guardian);
        console2.log("Fee Recipient:", feeRecipient);

        // ─── 1. Timelock ───
        Timelock timelock = new Timelock(deployer, 24 hours);
        console2.log("Timelock:", address(timelock));

        // ─── 2. Vault ───
        YieldVault vault = new YieldVault(
            IERC20(usdcAddr),
            address(timelock),
            guardian,
            deployer, // harvester = deployer initially; swapped to Harvester contract below
            feeRecipient
        );
        console2.log("YieldVault:", address(vault));
        address strategyMgr = address(vault.strategyManager());
        console2.log("StrategyManager:", strategyMgr);

        // ─── 3. IdleStrategy ───
        IdleStrategy idle = new IdleStrategy(address(vault), strategyMgr, usdcAddr);
        console2.log("IdleStrategy:", address(idle));

        // ─── 4. Periphery ───
        Harvester harvester = new Harvester(address(vault), deployer);
        console2.log("Harvester:", address(harvester));
        vault.setHarvester(address(harvester));

        EmergencyModule emergency = new EmergencyModule(address(vault), guardian);
        console2.log("EmergencyModule:", address(emergency));

        // ─── 5. Queue strategy addition (100% idle reserve on Sepolia) ───
        uint256 eta = block.timestamp + 24 hours + 1;
        timelock.queueTransaction(
            address(vault),
            0,
            "addStrategy(address,uint256)",
            abi.encode(address(idle), 10_000),
            eta
        );
        console2.log("Queued IdleStrategy addition (100%) for ETA:", eta);

        vm.stopBroadcast();

        console2.log("");
        console2.log("=== SEPOLIA DEPLOYMENT COMPLETE ===");
        console2.log("Next steps:");
        console2.log("  1. Fund the deployer with test USDC from a Sepolia faucet");
        console2.log("  2. Wait 24h, then execute the queued addStrategy via AddStrategy.s.sol");
        console2.log("  3. Test the full deposit/withdraw/rebalance/pause flow manually");
        console2.log("  4. For Aave integration testing, run the fork suite:");
        console2.log("     forge test --match-contract Fork --fork-url $ARBITRUM_RPC_URL -vv");
    }
}
