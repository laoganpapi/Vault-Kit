# ArbitrumVault — Foundry Project

A yield-bearing vault with ERC-4626-style share accounting, audited end-to-end
by [Vault-Kit](../README.md).

## Layout

```
contracts/
├── foundry.toml          — Foundry configuration
├── src/
│   └── ArbitrumVault.sol — The vault contract
├── test/
│   └── ArbitrumVault.t.sol — Foundry test suite
└── AUDIT_REPORT.md       — Latest Vault-Kit audit output
```

## Running tests

Requires [Foundry](https://getfoundry.sh).

```bash
cd contracts
forge install foundry-rs/forge-std --no-commit
forge test
forge test -vvv              # verbose (show events and traces)
forge test --gas-report      # gas profiling
forge coverage               # coverage report
```

## Test coverage

| Category | Tests |
|----------|-------|
| Deposit / Withdraw | `test_firstDeposit_locksDeadShares`, `test_firstDeposit_rejectsBelowDeadShares`, `test_secondDeposit_receivesProportionalShares`, `test_withdraw_returnsCorrectAmount` |
| Share Inflation Defense | `test_shareInflationAttack_doesNotWork` — simulates the full first-depositor attack and verifies it fails |
| Fee-on-Transfer Handling | `test_feeOnTransferToken_usesActualReceivedAmount` — uses a 2% FoT mock token |
| Oracle Validation | `test_getAssetPrice_revertsOnStaleOracle`, `revertsOnZeroPrice`, `revertsOnNegativePrice` |
| Access Control | `test_pause_onlyGuardian`, `test_setPerformanceFee_enforcesMax`, `test_deposit_whenPaused_reverts` |
| Ownership | `test_twoStepOwnershipTransfer` |
| Invariants | `invariant_totalSharesEqualsSum`, `invariant_totalAssetsMatchesBalance` |
| Fuzz | `testFuzz_deposit_withdrawReturnsCorrectAmount`, `testFuzz_feeSetters_alwaysWithinMax` |

## Audit with Vault-Kit

```bash
cd ..
npx vault-kit contracts/src/ArbitrumVault.sol
```

Current results: **86/100** — LOW RISK. 0 Critical, 0 High, 2 Medium.
