# ArbitrumVault Bug Bounty

## Overview

We pay bug bounties for responsibly-disclosed vulnerabilities in the deployed
`ArbitrumVault.sol` and `SimpleLendingStrategy.sol` contracts.

This bounty is run on **Immunefi** (link to your Immunefi page when live).

## Reward schedule

| Severity | Reward (USD equivalent) |
|---|---|
| **Critical** | Up to $250,000 or 10% of funds at risk, whichever is greater (capped at $1M) |
| **High** | $25,000 - $100,000 |
| **Medium** | $5,000 - $25,000 |
| **Low** | $1,000 - $5,000 |

Rewards are paid in WETH (or USDC, your choice) via the protocol treasury
multi-sig within 14 days of a verified report.

## Severity definitions

We follow the **Immunefi Vulnerability Severity Classification System v2.3**.

### Critical
- Direct theft of any user funds, whether at-rest or in-motion
- Permanent freezing of user funds
- Insolvency of the vault (totalAssets < total user deposits)
- Theft of the vault's strategy assets
- A failed `oracle.latestRoundData()` call letting trades execute at wrong prices

### High
- Theft of unclaimed yield
- Permanent freezing of unclaimed yield
- Temporary freezing of all user funds (>1 hour) where recovery requires upgrade
- Smart contract unable to operate due to lack of token funds

### Medium
- Smart contract unable to function as intended (but recoverable)
- Block-stuffing attacks that extend liquidation/withdraw delays meaningfully
- Theft of gas

### Low
- Contract fails to deliver promised returns but no loss of value
- Off-by-one errors that result in <1 wei discrepancies
- Inefficient state usage that materially increases gas costs

## Out of scope

The following are explicitly **not** in scope and will not be rewarded:

- Findings reported by **automated tools** (Slither, MythX, Vault-Kit) without
  manual verification of exploitability. We already run Vault-Kit on every PR.
- Theoretical attacks that depend on **trusting actions** taken by the owner
  multi-sig (the owner has explicit privileges, see SECURITY.md).
- Issues in third-party dependencies (Chainlink oracles, Aave V3) — please
  report those to the respective projects.
- Any attack that requires the **attacker to control >50% of the multi-sig**.
- Bugs in **test/mock contracts** (`contracts/src/mocks/`, `contracts/test-hh/`).
- Issues in the **frontend** (separate scope, separate bounty if applicable).
- **Best-practice / informational** findings (e.g., "consider using more events").
- **Known issues** documented in SECURITY.md.

## Reporting

1. Email security@vault-kit.example with subject `[BOUNTY] <short title>`
2. Include:
   - Clear description of the bug and its impact
   - Severity rating you believe it warrants
   - **Working proof of concept** (Foundry test case strongly preferred)
   - Suggested fix
   - Your preferred payment address (must be ETH-compatible)
3. We acknowledge within 24 hours, triage within 72 hours.

## Rules of engagement

- **No public disclosure** until we have shipped a fix and you have received
  the reward (or 90 days have passed without a fix, whichever is earlier).
- **No social engineering** of team members or users.
- **No DoS** or rate-limit attacks against our infrastructure.
- **No testing on mainnet** unless explicitly authorized — use a fork.
- Findings via mass-exploit tools (e.g., scraping for typical vulnerability
  patterns) are accepted only if accompanied by a manual exploit and analysis.

## Hall of fame

Reporters whose findings led to fixes (with their consent):

| Date | Reporter | Severity | Summary |
|---|---|---|---|
| _none yet_ | | | |

We are grateful for every responsible disclosure. Thank you for helping
keep ArbitrumVault and its users safe.
