import { ethers } from "ethers";
import { getSigner, getVaultAddress, formatUsdc, parseUsdc } from "./utils/provider.js";
import { VAULT_ABI } from "./utils/abi.js";

export async function withdraw(amountStr: string) {
  const signer = getSigner();
  const vaultAddr = getVaultAddress();
  const vault = new ethers.Contract(vaultAddr, VAULT_ABI, signer);

  const shares = await vault.balanceOf(signer.address);
  if (shares === 0n) {
    console.error("You have no vault shares to withdraw.");
    return;
  }

  const totalValue = await vault.convertToAssets(shares);
  console.log(`\nYour position: ${formatUsdc(totalValue)} USDC`);

  let sharesToRedeem: bigint;

  if (amountStr.toLowerCase() === "all" || amountStr.toLowerCase() === "max") {
    sharesToRedeem = shares;
    console.log(`Redeeming ALL shares...`);
  } else {
    const targetUsdc = parseUsdc(amountStr);
    sharesToRedeem = await vault.convertToShares(targetUsdc);

    if (sharesToRedeem > shares) {
      console.error(`Insufficient shares. You can withdraw max ${formatUsdc(totalValue)} USDC.`);
      return;
    }
    console.log(`Withdrawing ~${amountStr} USDC...`);
  }

  // Preview
  const expectedAssets = await vault.previewRedeem(sharesToRedeem);
  const fee = (expectedAssets * 10n) / 10000n; // 0.1% withdrawal fee
  console.log(`Expected USDC out: ${formatUsdc(expectedAssets)} (fee: ${formatUsdc(fee)})`);

  // Execute
  const tx = await vault.redeem(sharesToRedeem, signer.address, signer.address);
  console.log(`Tx submitted: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`Confirmed in block ${receipt.blockNumber}`);

  // Show remaining
  const remainingShares = await vault.balanceOf(signer.address);
  if (remainingShares > 0n) {
    const remainingValue = await vault.convertToAssets(remainingShares);
    console.log(`\nRemaining position: ${formatUsdc(remainingValue)} USDC`);
  } else {
    console.log("\nFully withdrawn. No remaining position.");
  }
}
