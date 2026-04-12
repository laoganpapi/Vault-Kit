# ArbitrumVault Operations Runbook

This document is for the **on-call operator** of a deployed ArbitrumVault.
Read it once before any deployment, and again at the start of every shift.

## At-a-glance

| Action | Who | How fast |
|---|---|---|
| Pause deposits | Guardian or owner multi-sig | Within 5 minutes of incident |
| Drain funds to safety | Owner multi-sig | Within 30 minutes |
| Change fee parameters | Owner multi-sig (subject to MAX caps) | Routine, with timelock if installed |
| Rotate strategy | Owner multi-sig | Routine, with smoke test on testnet first |
| Cycle a guardian or fee recipient | Owner multi-sig | Routine |

## Standing on-call rotations

Define BEFORE going to mainnet:

- Primary on-call: __________________ (24/7 contact: __________)
- Secondary on-call: __________________ (24/7 contact: __________)
- Escalation: __________________ (CEO / security lead)

The primary on-call should have:
- A hardware wallet that is a signer on the GUARDIAN multi-sig
- Saved Etherscan/Arbiscan bookmarks for the vault, strategy, multi-sigs
- Pre-staged Tenderly/OpenZeppelin Defender alerts (see Monitoring)
- Phone numbers for at least 2 other guardian signers (for fast pause)

## Incident response procedures

### IR-001: Suspected exploit in progress

**Symptoms:** Sudden large withdrawals, abnormal share-price movement, alerts firing.

1. **PAUSE first, investigate second.** Speed > thoroughness here.
2. From any guardian signer's hardware wallet, propose:
   ```
   vault.pause()
   ```
3. Get a 2nd signature from another guardian. The pause takes effect on
   the second signature.
4. Verify on-chain: `vault.paused()` returns `true`.
5. Notify the owner multi-sig signers via the agreed channel.
6. Begin forensics. Tools: Tenderly, Phalcon, Cast, Foundry fork.
7. If funds are at risk and the fix requires more than 1 hour:
   ```
   vault.emergencyWithdraw()
   ```
   This requires the OWNER multi-sig (not guardian). It pulls everything
   from the strategy and sends all assets to the owner address.
   **Get 3-of-5 owner signatures for this — never sign alone.**

### IR-002: Oracle malfunction

**Symptoms:** `getAssetPrice()` reverts (`Oracle: stale price` / `Oracle: invalid price` / `Sequencer down`).

The vault is **fail-safe by design** here: when the oracle is bad, all
oracle-dependent operations revert. Users cannot deposit at a wrong price.

1. Check Chainlink status: https://data.chain.link/feeds/arbitrum/mainnet/eth-usd
2. Check Arbitrum sequencer status: https://status.arbitrum.io/
3. If outage is < 1 hour: wait it out. The vault will resume automatically.
4. If outage is > 1 hour: consider pausing the vault to prevent confusion
   even though it's already fail-safe.
5. Post a status update on your social channels.

### IR-003: Strategy contract is misbehaving

**Symptoms:** Yield not accruing, harvest fails, or strategy.balanceOf() is suspicious.

1. PAUSE the vault.
2. Run `vault.withdrawFromStrategy(strategy.balanceOf())` from owner multi-sig
   to pull funds back to the vault.
3. If that succeeds, swap to a known-good strategy via `vault.setStrategy(...)`.
4. If `withdrawFromStrategy` reverts, escalate to IR-001 emergency drain.

### IR-004: Fee parameter mistake

**Symptoms:** Wrong fee was set; users are getting charged incorrectly.

1. From owner multi-sig, call the corresponding setter with the corrected value.
2. The setters enforce MAX_* caps, so you can't make it worse than the cap.
3. Communicate the change to users via your social channels.
4. If a user was overcharged, queue a remediation tx from treasury.

## Routine operations

### Weekly

- Review monitoring dashboard for anomalies
- Verify the price feed is updating (last `updatedAt` < 1 hour ago)
- Check `totalAssets` matches your expected accounting
- Run a small test deposit/withdraw on a separate test account

### Monthly

- Run `vault.collectManagementFees()` from owner multi-sig
- Run `vault.harvest()` from guardian multi-sig (or whoever owns the harvest role)
- Reconcile fees received against on-chain Harvested events
- Review the cap (`vault.depositCap()`) and consider raising if utilization is high

### Quarterly

- Re-run the full Vault-Kit audit (`npx vault-kit contracts/src/`)
- Re-run the Foundry / hardhat test suite (`npm test`)
- Review and rotate any expiring multi-sig signers

## Monitoring

You MUST set up the following alerts before mainnet deploy. Use OpenZeppelin
Defender, Tenderly Alerts, Forta, or equivalent.

| Event | Severity | Alert who |
|---|---|---|
| `Deposit(amount > 10 ETH)` | Info | Slack #vault-ops |
| `Withdraw(amount > 10 ETH)` | Info | Slack #vault-ops |
| `Withdraw(amount > 50% of totalAssets)` | **High** | Page on-call |
| `Paused` | **High** | Page on-call + post status |
| `EmergencyModeSet(true)` | **CRITICAL** | Page entire team |
| `StrategyUpdated` | **High** | Notify owner multi-sig + audit |
| `OwnershipTransferStarted` | **High** | Notify ALL owner multi-sig signers |
| `PerformanceFeeUpdated`, `WithdrawalFeeUpdated`, `ManagementFeeUpdated` | Medium | Notify owner multi-sig |
| `getAssetPrice()` reverting on simulation | Medium | Notify on-call |
| Block timestamp on price feed > 1 hour stale | **High** | Page on-call |

## Pre-deploy checklist

Before pushing the deploy button, confirm every line:

```
[ ] Foundry/hardhat tests pass: npx hardhat test
[ ] Vault-Kit audit clean: node dist/src/cli.js contracts/src/ --benchmark
[ ] Deployment script reviewed by 2 engineers
[ ] Chainlink feed addresses verified against docs.chain.link
[ ] Sequencer feed address verified against docs.chain.link
[ ] Aave V3 pool address verified against docs.aave.com
[ ] WETH address verified against arbitrum.io
[ ] Owner multi-sig is deployed and funded with ETH for gas
[ ] Guardian multi-sig is deployed (separate from owner)
[ ] Fee recipient multi-sig is deployed
[ ] depositCap set conservatively (start with 1% of audit cost)
[ ] Monitoring alerts configured and TESTED
[ ] On-call schedule published
[ ] Bug bounty live on Immunefi
[ ] Insurance considered
[ ] Communication template prepared for incident response
```

## Post-deploy checklist

```
[ ] Vault verified on Arbiscan
[ ] Strategy verified on Arbiscan
[ ] transferOwnership to multi-sig completed
[ ] acceptOwnership called from multi-sig
[ ] setGuardian to guardian multi-sig completed
[ ] First end-to-end test (deposit 0.01 ETH, harvest, withdraw) successful
[ ] Monitoring alerts firing on test events
[ ] On-call has hardware wallet ready and tested
```
