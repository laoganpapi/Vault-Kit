import { ethers } from "ethers";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../.env") });

export function getProvider(): ethers.JsonRpcProvider {
  const rpc = process.env.ARBITRUM_RPC_URL;
  if (!rpc) {
    console.error("ERROR: Set ARBITRUM_RPC_URL in cli/.env");
    process.exit(1);
  }
  return new ethers.JsonRpcProvider(rpc);
}

export function getSigner(): ethers.Wallet {
  const key = process.env.DEPLOYER_PRIVATE_KEY;
  if (!key) {
    console.error("ERROR: Set DEPLOYER_PRIVATE_KEY in cli/.env");
    process.exit(1);
  }
  return new ethers.Wallet(key, getProvider());
}

export function getVaultAddress(): string {
  const addr = process.env.VAULT_ADDRESS;
  if (!addr) {
    console.error("ERROR: Set VAULT_ADDRESS in cli/.env");
    process.exit(1);
  }
  return addr;
}

export function formatUsdc(amount: bigint): string {
  return ethers.formatUnits(amount, 6);
}

export function parseUsdc(amount: string): bigint {
  return ethers.parseUnits(amount, 6);
}
