import { ethers } from "ethers";
import { getProvider, getSigner, getVaultAddress, formatUsdc } from "./utils/provider.js";
import { VAULT_ABI, STRATEGY_MANAGER_ABI, STRATEGY_ABI } from "./utils/abi.js";

export async function status() {
  const provider = getProvider();
  const vaultAddr = getVaultAddress();
  const vault = new ethers.Contract(vaultAddr, VAULT_ABI, provider);

  console.log("\n═══════════════════════════════════════");
  console.log("          YIELD VAULT STATUS");
  console.log("═══════════════════════════════════════\n");

  // Vault metrics
  const totalAssets = await vault.totalAssets();
  const totalSupply = await vault.totalSupply();
  const depositCap = await vault.DEPOSIT_CAP();
  const hwm = await vault.highWaterMark();
  const paused = await vault.paused();
  const tripped = await vault.circuitBreakerTripped();

  console.log(`  TVL:            ${formatUsdc(totalAssets)} USDC`);
  console.log(`  Deposit Cap:    ${formatUsdc(depositCap)} USDC`);
  console.log(`  Utilization:    ${totalAssets > 0n ? ((totalAssets * 100n) / depositCap).toString() : "0"}%`);
  console.log(`  High Water Mark: ${formatUsdc(hwm)} USDC`);

  // Share price
  if (totalSupply > 0n) {
    const sharePrice = (totalAssets * ethers.parseUnits("1", 12)) / totalSupply;
    console.log(`  Share Price:    ${ethers.formatUnits(sharePrice, 6)} USDC`);
  } else {
    console.log(`  Share Price:    1.000000 USDC (no deposits)`);
  }

  // Status flags
  console.log(`\n  Status:         ${paused ? "⚠️  PAUSED" : "✅ Active"}`);
  if (tripped) {
    console.log(`  Circuit Breaker: ⚠️  TRIPPED`);
    if (hwm > 0n) {
      const drawdown = ((hwm - totalAssets) * 10000n) / hwm;
      console.log(`  Drawdown:       ${Number(drawdown) / 100}%`);
    }
  }

  // Fees
  const withdrawFee = await vault.WITHDRAWAL_FEE_BPS();
  const perfFee = await vault.PERFORMANCE_FEE_BPS();
  console.log(`\n  Withdrawal Fee: ${Number(withdrawFee) / 100}%`);
  console.log(`  Performance Fee: ${Number(perfFee) / 100}%`);

  // Strategy breakdown
  const smAddr = await vault.strategyManager();
  const sm = new ethers.Contract(smAddr, STRATEGY_MANAGER_ABI, provider);
  const stratCount = await sm.strategyCount();

  if (stratCount > 0n) {
    console.log(`\n─── STRATEGIES (${stratCount}) ───\n`);

    const deployed = await sm.totalDeployedAssets();
    const idle = totalAssets - deployed;
    console.log(`  Deployed: ${formatUsdc(deployed)} USDC`);
    console.log(`  Idle:     ${formatUsdc(idle)} USDC\n`);

    for (let i = 0n; i < stratCount; i++) {
      const [stratAddr, allocBps, active, lastHarvest] = await sm.strategies(i);

      if (!active) continue;

      const strat = new ethers.Contract(stratAddr, STRATEGY_ABI, provider);
      const stratName = await strat.name();
      const stratAssets = await strat.totalAssets();
      const hf = await strat.healthFactor();

      const allocPct = Number(allocBps) / 100;
      const hfStr = hf === ethers.MaxUint256 ? "N/A" : (Number(hf) / 1e18).toFixed(2);

      const lastHarvestDate = Number(lastHarvest) > 0
        ? new Date(Number(lastHarvest) * 1000).toLocaleString()
        : "Never";

      console.log(`  ${stratName}`);
      console.log(`    Address:      ${stratAddr}`);
      console.log(`    Allocation:   ${allocPct}%`);
      console.log(`    Assets:       ${formatUsdc(stratAssets)} USDC`);
      console.log(`    Health Factor: ${hfStr}`);
      console.log(`    Last Harvest: ${lastHarvestDate}`);
      console.log();
    }
  } else {
    console.log("\n  No strategies active.");
  }

  // User position (if wallet configured)
  try {
    const signer = getSigner();
    const shares = await vault.balanceOf(signer.address);
    if (shares > 0n) {
      const value = await vault.convertToAssets(shares);
      console.log(`─── YOUR POSITION ───\n`);
      console.log(`  Wallet:  ${signer.address}`);
      console.log(`  Shares:  ${ethers.formatUnits(shares, 12)}`);
      console.log(`  Value:   ${formatUsdc(value)} USDC`);
      console.log(`  % of TVL: ${totalAssets > 0n ? ((value * 10000n) / totalAssets * 100n / 10000n).toString() : "0"}%`);
    }
  } catch {
    // No private key configured — skip user position
  }

  console.log("\n═══════════════════════════════════════\n");
}
