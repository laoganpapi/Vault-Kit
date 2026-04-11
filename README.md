# Vault-Kit

> Enterprise-grade static analyzer for Solidity. 35 vulnerability detectors, evmbench-aligned benchmark mode, and professional audit reports — in a single `npx` command.

```bash
npx vault-kit contracts/MyToken.sol
```

Vault-Kit parses Solidity into an AST, runs 35 modular detectors against it, and produces an actionable audit report in text, markdown, or JSON. It ships with a `--benchmark` mode that matches the scope of OpenAI/Paradigm's [evmbench](https://github.com/openai/evmbench) — HIGH-severity findings only — for use as a CI gate.

Designed to audit smart contracts produced by Claude and other LLM agents, but works on any human-written Solidity too.

---

## Install

```bash
# One-shot (no install)
npx vault-kit contracts/

# Or install globally
npm install -g vault-kit
vault-kit contracts/

# Or add as a dev dependency
npm install --save-dev vault-kit
```

Requires Node.js 18+.

## Quick start

```bash
# Audit a single contract
vault-kit contracts/MyToken.sol

# Audit a whole directory (recurses, skips node_modules/lib/out/artifacts/cache)
vault-kit contracts/

# Emit a markdown report
vault-kit contracts/ --format markdown --output AUDIT.md

# Emit JSON (for piping into other tools)
vault-kit contracts/ --format json > findings.json

# Benchmark mode — HIGH+ findings only, matches evmbench scope
vault-kit contracts/ --benchmark

# Run only specific detectors
vault-kit contracts/Vault.sol --enable reentrancy,share-inflation,oracle-manipulation

# Disable noisy detectors
vault-kit contracts/ --disable gas-optimization,floating-pragma

# See everything Vault-Kit can check
vault-kit --list-detectors
```

Exit codes:

| Code | Meaning |
|------|---------|
| `0` | Clean — no Critical or High findings |
| `1` | Critical or High findings present |
| `2` | Engine error (parse failure, unknown flag, etc.) |

Perfect for CI: `vault-kit contracts/ --benchmark || exit 1`.

## Detector catalog

All 35 detectors, grouped by default severity. Every detector is opt-in/opt-out via `--enable` / `--disable`.

### Critical

| ID | What it catches | Notable incidents |
|----|----|----|
| `reentrancy` | CEI violations, missing guards, **cross-function reentrancy** via call-graph analysis | The DAO ($60M), Cream Finance ($130M) |
| `access-control` | Unprotected critical functions, unguarded initializers, selfdestruct without auth | Many |
| `delegatecall` | User-controlled targets, delegatecall inside loops | Parity multisig ($150M) |
| `sandwich` | Swaps without slippage / deadline / with `block.timestamp` deadline | Endless MEV |
| `arbitrary-external-call` | User-controlled target AND calldata (Furucombo-style) | Furucombo ($14M) |

### High

| ID | What it catches |
|----|----|
| `unchecked-calls` | `.call()` / `.send()` with unchecked return; ERC-20 `transfer()` without `SafeERC20` |
| `integer-overflow` | Pre-0.8 arithmetic without SafeMath, unchecked blocks, unsafe downcasts |
| `tx-origin` | Phishing-vulnerable `tx.origin == owner` auth (recognizes the safe `tx.origin == msg.sender` pattern) |
| `flash-loan` | Balance-dependent validation, unprotected flash-loan callbacks, spot-price reliance |
| `oracle-manipulation` | Missing staleness / price-sign / round-completeness checks on Chainlink, deprecated `latestAnswer()` |
| `proxy-storage` | Missing `__gap`, constructor logic in upgradeable impls, missing parent init calls |
| `locked-ether` | Contract receives ETH but has no mechanism to withdraw it |
| `centralization-risk` | Privileged functions without timelock/multisig (drain, pause, upgrade, mint, fee setters) |
| `share-inflation` | ERC-4626 first-depositor inflation attack; recognizes dead-shares / virtual-offset mitigations |
| `signature-replay` | Missing nonce, deadline, or EIP-712 domain separator |
| `storage-collision` | Assembly `sstore` to low slots, diamond storage without explicit keys |
| `readonly-reentrancy` | View functions exposing state modifiable by in-progress external calls (Curve-style) |
| `ecrecover-bugs` | Zero-address signature bypass + ECDSA signature malleability |
| `uninitialized-proxy` | UUPS impl without `_disableInitializers()` in constructor (Parity-style) |
| `l2-sequencer` | Chainlink oracle use on Arbitrum/Optimism/Base without sequencer uptime check |

### Medium

| ID | What it catches |
|----|----|
| `selfdestruct` | Usage of selfdestruct (deprecated post-Dencun); unprotected access |
| `timestamp-dependence` | `block.timestamp` used for randomness or exact equality |
| `dos-vectors` | Unbounded loops over state arrays, external calls in loops |
| `front-running` | ERC-20 approve race, swap functions without slippage/deadline |
| `uninitialized-storage` | Unvalidated addresses used as transfer targets |
| `precision-loss` | Division-before-multiplication, dangerous denominators, division by unguarded variable |
| `state-shadowing` | State variables shadowing parent contract vars; local shadowing |
| `unsafe-assembly` | Dangerous opcodes (`sstore`, `delegatecall`, `create2`, `selfdestruct`) inside inline assembly |
| `weird-erc20` | Fee-on-transfer incompatibility, USDT-style approve reset, balance-diff patterns |
| `unsafe-cast` | Silent integer downcasts without SafeCast |
| `forced-ether` | `require(address(this).balance == X)` strict equality |

### Informational / Gas

| ID | What it catches |
|----|----|
| `floating-pragma` | `^0.8.0` and other floating pragmas; outdated Solidity |
| `erc-compliance` | Missing ERC-20/721 functions, events, and return values |
| `missing-events` | State-changing functions without event emissions |
| `gas-optimization` | Storage reads in loops, immutable candidates, `> 0` vs `!= 0`, storage packing |

## Programmatic API

```ts
import { AuditEngine, generateReport, Severity } from 'vault-kit';

const engine = new AuditEngine({
  files: ['contracts/MyToken.sol'],
  severityThreshold: Severity.HIGH,
  disabledDetectors: ['gas-optimization'],
});

const result = await engine.run();

console.log(`Score: ${result.summary.score}/100`);
console.log(`Findings: ${result.summary.critical} critical, ${result.summary.high} high`);

// Generate a markdown report
const markdown = generateReport(result, 'markdown');

// Or walk the findings directly
for (const finding of result.findings) {
  console.log(`[${finding.severity}] ${finding.title} @ ${finding.location.file}:${finding.location.line}`);
}
```

Every type is exported from the root: `Finding`, `AuditConfig`, `AuditResult`, `Severity`, `Confidence`, `BaseDetector`, etc.

## Benchmark results

Run on the fixtures in this repo:

| Fixture | Score | Critical | High | Total HIGH+ |
|---|---|---|---|---|
| `test/fixtures/safe.sol` (well-written) | **100/100** | 0 | 0 | 0 |
| `contracts/src/ArbitrumVault.sol` (hardened via self-audit) | **100/100** | 0 | 0 | 0 |
| `test/fixtures/evmbench-style.sol` (10 canonical HIGH bugs) | 0/100 | **7** | **24** | **31** |
| `test/fixtures/vulnerable.sol` (kitchen sink) | 0/100 | **11** | **32** | **43** |

All 35 detectors are covered by unit tests (146 tests total, including engine, fixtures, and positive+negative per-detector cases). Run them with `npm test`.

## CI integration

Drop this into any Solidity repo at `.github/workflows/vault-kit.yml`:

```yaml
name: Vault-Kit audit
on:
  pull_request:
    paths: ['**/*.sol']
  push:
    branches: [main]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npx --yes vault-kit contracts/ --benchmark
```

The step fails the PR if any Critical or High finding is present. Use `--format markdown --output audit.md` to also upload a report artifact.

## Contributing

### Adding a new detector

1. Create `src/detectors/my-detector.ts` extending `BaseDetector`
2. Implement `detect(context: AnalysisContext): Finding[]`
3. Register it in `src/detectors/index.ts`
4. Add positive + negative unit tests in `test/detectors/` — tight assertions (check `detectorId`, severity, and specific title text, not just `length > 0`)
5. Run `npm test`

Every finding must include: `severity`, `confidence`, `location`, and `recommendation`. Findings without actionable recommendations are rejected in review.

### Running the test suite

```bash
npm install
npm run lint      # tsc --noEmit
npm run build     # compile TypeScript
npm test          # 146 tests
```

### Architecture

- `src/core/` — types, parser wrapper, engine orchestrator, analysis context
- `src/detectors/` — 30 modular detectors, one class per file
- `src/analyzers/` — control flow (CEI), data flow (taint), call graph (cross-function)
- `src/utils/ast-helpers.ts` — AST traversal, NameValueExpression resolution, common patterns
- `src/report/` — text / markdown / JSON report generators
- `test/fixtures/` — sample Solidity contracts (safe, vulnerable, defi-lending, evmbench-style)

See `CLAUDE.md` for the in-repo agent guidance.

## Disclaimer

This report was generated by Vault-Kit automated static analysis. **Static analysis is a valuable first step in security assessment but cannot detect all vulnerability classes** (notably: business-logic errors, economic attacks, and novel exploit chains). Vault-Kit should not be considered a substitute for a comprehensive manual audit by experienced security researchers. Use it as a CI gate and as a preflight before commissioning a manual audit — not as the final word.

## License

MIT — see [LICENSE](LICENSE).
