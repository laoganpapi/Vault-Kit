import { ethers } from "ethers";
import { getSigner, getVaultAddress, formatUsdc, parseUsdc } from "./utils/provider.js";
import { VAULT_ABI, ERC20_ABI } from "./utils/abi.js";

export async function deposit(amountStr: string) {
  const signer = getSigner();
  const vaultAddr = getVaultAddress();
  const amount = parseUsdc(amountStr);

  const vault = new ethers.Contract(vaultAddr, VAULT_ABI, signer);
  const usdcAddr = await vault.asset();
  const usdc = new ethers.Contract(usdcAddr, ERC20_ABI, signer);

  console.log(`\nDepositing ${formatUsdc(amount)} USDC into vault...`);
  console.log(`Wallet: ${signer.address}`);

  // Check USDC balance
  const balance = await usdc.balanceOf(signer.address);
  if (balance < amount) {
    console.error(`Insufficient USDC. Balance: ${formatUsdc(balance)}, Need: ${formatUsdc(amount)}`);
    return;
  }

  // Check allowance and approve if needed
  const allowance = await usdc.allowance(signer.address, vaultAddr);
  if (allowance < amount) {
    console.log("Approving USDC...");
    const approveTx = await usdc.approve(vaultAddr, ethers.MaxUint256);
    await approveTx.wait();
    console.log("Approved.");
  }

  // Check vault state
  const paused = await vault.paused();
  if (paused) {
    console.error("Vault is currently paused. Deposits are disabled.");
    return;
  }

  const tripped = await vault.circuitBreakerTripped();
  if (tripped) {
    console.error("Circuit breaker tripped. Deposits are disabled until guardian resets.");
    return;
  }

  // Preview shares
  const expectedShares = await vault.previewDeposit(amount);
  console.log(`Expected shares: ${ethers.formatUnits(expectedShares, 12)}`); // 6 + 6 offset = 12

  // Execute deposit
  const tx = await vault.deposit(amount, signer.address);
  console.log(`Tx submitted: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`Confirmed in block ${receipt.blockNumber}`);

  // Show final state
  const shares = await vault.balanceOf(signer.address);
  const value = await vault.convertToAssets(shares);
  console.log(`\nYour position:`);
  console.log(`  Shares: ${ethers.formatUnits(shares, 12)}`);
  console.log(`  Value:  ${formatUsdc(value)} USDC`);
}
