# EVMBench Detect-Mode Audit — Vault-Kit

**Harness**: [paradigmxyz/evmbench](https://github.com/paradigmxyz/evmbench), `backend/worker_runner/detect.md` prompt + schema
**Protocol**: Loss-of-funds vulnerabilities only (high severity). Admin/owner/governance assumed trusted.
**Note**: Full Docker+RabbitMQ+Codex stack not executed in this environment. The detect prompt and JSON output schema were applied manually against the Vault-Kit `src/` tree. This is an adaptation of the EVMBench protocol, not a graded run against the 120-vuln dataset.

---

```json
{
  "vulnerabilities": [
    {
      "title": "Reward swap slippage tolerance below uniswap pool fee causes harvest to always revert",
      "severity": "high",
      "summary": "Both Aave strategies set MAX_SLIPPAGE_BPS=10 (0.1%) for the ARB→USDC reward swap, but route the swap through the 0.3% Uniswap V3 pool (fee: 3000). The pool charges 0.3% on input, so the actual output is always ~0.3% below the oracle-derived expected value, while `amountOutMinimum` is only 0.1% below it. The swap's minOut check always fails and the call reverts.",
      "description": [
        {
          "file": "src/strategies/AaveLeverageStrategy.sol",
          "line_start": 188,
          "line_end": 226,
          "desc": "`_harvest` claims ARB rewards from Aave, then builds a swap with `fee: 3000` (0.3% pool) and `amountOutMinimum = expectedUsdc * (10000 - MAX_SLIPPAGE_BPS) / 10000`, where `MAX_SLIPPAGE_BPS = 10`. Effective pool output is `amountIn * 0.997 * price`; minOut is `amountIn * 0.999 * price`. 0.997 < 0.999 ⇒ revert. Because `exactInputSingle` reverts, the entire `_harvest` reverts, which propagates up through `StrategyManager.harvestAll` and `YieldVault.harvest`. The harvest pipeline is permanently DOSed."
        },
        {
          "file": "src/strategies/AaveSupplyStrategy.sol",
          "line_start": 81,
          "line_end": 114,
          "desc": "Identical bug: `fee: 3000` with `MAX_SLIPPAGE_BPS = 10`. Same failure mode — harvest always reverts."
        }
      ],
      "impact": "Permanent loss of all reward-token yield (ARB incentives) for the lifetime of the vault. With Aave's ARB incentive program averaging 1-3% APY on aUSDC, a $10M TVL vault loses $100k-$300k per year of recoverable yield. Additionally, because `YieldVault.harvest` first calls `strategyManager.harvestAll()` before rebalancing, the broken swap also DOSes automated rebalancing through the harvest path.",
      "proof_of_concept": "1. Deploy AaveSupplyStrategy and wire it into the vault. 2. Wait for ARB rewards to accrue at Aave rewards controller. 3. Call `vault.harvest()`. 4. Observe revert from Uniswap router because `amountOut < amountOutMinimum`. 5. No reward was ever claimable, because the minOut is mathematically unreachable through a 0.3% fee pool without lowering slippage tolerance.",
      "remediation": "Set `MAX_SLIPPAGE_BPS` to at least 50 (0.5%) — 30 bps for the pool fee + 20 bps buffer for market impact/oracle drift. Alternatively, route through the 0.05% fee pool (`fee: 500`) if liquidity permits, and widen slippage to ≥25 bps. Also consider using TWAP instead of spot for the minOut derivation, and passing a real `deadline` instead of `block.timestamp`."
    },
    {
      "title": "Reward tokens stranded on strategy contracts after removestrategy cleanup",
      "severity": "high",
      "summary": "When `StrategyManager.removeStrategy` retires a strategy, it calls `IStrategy.emergencyWithdraw()` which only sweeps USDC. Any ARB reward tokens (claimed or claimable) held on the strategy are not swept. After removal the strategy is orphaned — all mutative functions are `onlyManager`-gated, and the manager no longer references it — so the tokens become permanently unrecoverable.",
      "description": [
        {
          "file": "src/strategies/BaseStrategy.sol",
          "line_start": 60,
          "line_end": 66,
          "desc": "`emergencyWithdraw` only transfers `usdc.balanceOf(address(this))` to the vault. It does not claim pending rewards from the Aave rewards controller, nor does it sweep any ARB sitting on the strategy from a prior partially-successful harvest."
        },
        {
          "file": "src/core/StrategyManager.sol",
          "line_start": 69,
          "line_end": 89,
          "desc": "`removeStrategy` calls `IStrategy(strategy).emergencyWithdraw()` after marking the strategy inactive. Once `isStrategy[strategy] = false`, the manager's `harvestAll`/`rebalance`/`withdrawFromStrategies` loops skip it. There is no ad-hoc path back into the orphaned contract."
        }
      ],
      "impact": "Every strategy rotation permanently burns accrued reward yield. Combined with the slippage bug above (which prevents rewards from being swapped during the strategy's lifetime), this means ARB incentives sit unclaimed at Aave; if a guardian ever claims them directly to the strategy (via the rewards controller), they are instantly trapped.",
      "proof_of_concept": "1. Strategy is live; ARB rewards accrue at Aave rewards controller for `strategy`. 2. Governance decides to rotate strategies and queues `removeStrategy(strategy)` through the timelock. 3. `removeStrategy` executes, calls `emergencyWithdraw`, which sweeps USDC only. 4. Pending ARB rewards remain claimable only by `strategy`, which has no remaining caller (manager excludes it, no public harvest entry point, no rescue function). Tokens are lost forever.",
      "remediation": "In `BaseStrategy.emergencyWithdraw`, claim rewards before sweeping and either (a) swap them to USDC with a realistic slippage tolerance, or (b) transfer the raw reward tokens to the vault via a `sweep(address token)` helper. Add a `rescueToken(address token, address to)` function callable by the vault/owner post-removal to recover any residual ERC-20 balances."
    },
    {
      "title": "Aave leverage strategy deposit reverts unconditionally at the second loop iteration",
      "severity": "high",
      "summary": "The `_deposit` loop is dead code after the first iteration. With Aave USDC's LTV 75% / liquidation threshold 77%, a 70% target LTV per loop drives the health factor below the hardcoded `MIN_HEALTH_FACTOR = 1.8e18` on loop 2 regardless of the deposit size. The strategy always reverts on any deposit of nontrivial size, bricking any `rebalance` that targets it.",
      "description": [
        {
          "file": "src/strategies/AaveLeverageStrategy.sol",
          "line_start": 83,
          "line_end": 120,
          "desc": "Trace (any deposit size X): Loop 1 borrows X·0.75·0.70 = 0.525X and re-supplies, giving supplied=1.525X debt=0.525X HF=1.525·0.77/0.525≈2.24 (passes). Loop 2 borrows 0.4125X, leaving supplied=1.9375X debt=0.9375X HF=1.9375·0.77/0.9375≈1.59 (below 1.8 floor, `HealthFactorTooLow()` reverts). The ratio is deposit-independent; the loop can never advance past iteration 1."
        },
        {
          "file": "src/core/StrategyManager.sol",
          "line_start": 112,
          "line_end": 144,
          "desc": "`rebalance` calls `strat.deposit(toDeposit)` inside a straight loop with no try/catch. When AaveLeverageStrategy is in the registry, any rebalance that routes capital to it reverts atomically, reverting the entire rebalance (including deposits to other strategies that would have succeeded)."
        }
      ],
      "impact": "Two compounding losses: (1) any TVL allocated to the leverage strategy sits permanently idle because deposits revert, forfeiting the advertised 15-20% APY; (2) a single broken strategy in the registry DOSes rebalancing for every other strategy, preventing idle USDC from ever being deployed and capping the vault's realized yield. Principal is safe but opportunity-cost loss is continuous.",
      "proof_of_concept": "1. Governance adds AaveLeverageStrategy via timelock with any allocationBps. 2. Users deposit USDC; vault becomes non-empty. 3. Harvester calls `vault.rebalance()` or `vault.harvest()`. 4. Manager iterates strategies; at AaveLeverageStrategy.deposit, the loop enters iter 2, HF check reverts, bubble-up reverts the entire rebalance. 5. No capital is deployed anywhere on that call.",
      "remediation": "Either (a) lower `TARGET_LTV_BPS` to ~35-40% so that iterated HF stays above 1.8, or (b) lower `MIN_HEALTH_FACTOR` to 1.4-1.5e18 given the USDC-USDC same-asset loop has no price-liquidation risk, or (c) compute the target borrow per loop from the declared HF floor instead of a fixed LTV-of-availableBorrow, clamping borrow amounts so the post-loop HF is exactly at the floor. Additionally, wrap `strat.deposit` in `StrategyManager.rebalance` with try/catch so one broken strategy cannot DOS rebalancing for the rest."
    },
    {
      "title": "Aave leverage emergencywithdraw reverts once debt exceeds single-shot withdrawal bound",
      "severity": "high",
      "summary": "`AaveLeverageStrategy._emergencyWithdraw` sets `toWithdraw = min(supplied, debt)` and calls `aavePool.withdraw(toWithdraw)` without first repaying. Aave rejects any withdraw that would push HF < 1. At the target 70% LTV the max single-shot withdrawal is ~9% of collateral; requesting `debt` (≈67% of collateral) reverts. If/when the `_deposit` HF-check bug is fixed and multi-loop positions become possible, the emergency exit path is unusable.",
      "description": [
        {
          "file": "src/strategies/AaveLeverageStrategy.sol",
          "line_start": 228,
          "line_end": 257,
          "desc": "Iteration 1 of the loop: supplied=S, debt=D, toWithdraw=min(S,D)=D (since S>D). `aavePool.withdraw(D)` would leave collateral at (S-D) and debt at D, giving HF = (S-D)·liqThreshold/D. For S=1.525X, D=0.525X (after 1 loop only) → HF post-withdraw = 1.0·0.77/0.525 = 1.467 (passes). For S=1.9375X, D=0.9375X (after 2 loops) → HF post-withdraw = 1·0.77/0.9375 = 0.821 (Aave reverts). Worse for deeper loops. The unwind flow has no repay-first fallback."
        }
      ],
      "impact": "Emergency guardian recovery becomes impossible once leverage exceeds ~1.5x, exactly the situation where emergency recovery is most needed (rate spikes, cascading liquidations). Currently masked by the depositor-HF-check bug above, but as a standalone defect it traps all user capital in the strategy during any adverse event after the deposit bug is fixed.",
      "proof_of_concept": "1. Lower `MIN_HEALTH_FACTOR` to 1.4e18 to unblock the deposit bug. 2. Deposit 100 USDC, complete 3 loops (supplied≈237, debt≈137). 3. Call `emergencyWithdraw`. 4. Loop iter 1 requests `aavePool.withdraw(137)`, which would drop HF to (237-137)·0.77/137=0.562, Aave reverts. 5. Entire tx fails; guardian cannot exit.",
      "remediation": "Rewrite the unwind loop to compute a safe per-iteration withdrawal amount from the current HF floor (same math as `_withdraw` uses via `EMERGENCY_HEALTH_FACTOR`), withdraw that amount, immediately repay from the freed USDC, and iterate. Consider using Aave flash loans to repay the full debt in one call before withdrawing all collateral. Add an integration test that deploys to a fork, builds a deep-loop position, and asserts `emergencyWithdraw` fully unwinds without reverting."
    }
  ]
}
```
