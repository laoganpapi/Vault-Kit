# Security Policy — ArbitrumVault

## Scope

This document covers the in-repo `contracts/src/ArbitrumVault.sol` and
`contracts/src/strategies/SimpleLendingStrategy.sol`. The Vault-Kit static
analyzer in `src/` is a separate project with its own security model.

## Trust assumptions

ArbitrumVault is a custodial yield vault. Users delegate the following trust
to the protocol operator:

| Role | Power | Recommended setup |
|---|---|---|
| `owner` | Can change strategy, fees (within caps), pause, emergency-withdraw all funds | **Multi-sig (Gnosis Safe), 3-of-5 minimum, all signers on hardware wallets** |
| `guardian` | Can pause but NOT unpause, NOT change fees, NOT withdraw | **Separate multi-sig** (e.g., the security team) — at least 2-of-3, fast response |
| `feeRecipient` | Receives performance + management + withdrawal fees | Treasury multi-sig |
| `pendingOwner` | Two-step ownership transfer target | N/A — must call `acceptOwnership()` to take effect |

The vault is **not** trustless. If the owner key is compromised, the attacker
can `emergencyWithdraw()` all funds in one transaction. Mitigate by:
1. Owning the owner role with a hardware-wallet multi-sig
2. Wrapping the owner role behind a `TimelockController` (e.g., 48h delay)
3. Using a separate guardian multi-sig that can pause faster than the owner can act
4. Maintaining off-chain monitoring that alerts on any owner transaction

## Reporting a vulnerability

**Please do NOT open a public GitHub issue for security vulnerabilities.**

Email: `security@vault-kit.example` (replace with your real address)

PGP key: see `SECURITY.pgp` at the root of this repo (publish your key here).

When reporting, please include:
- A description of the vulnerability and its impact
- Steps to reproduce (a Foundry test case is ideal)
- Your suggested mitigation if you have one
- Whether you would like a public credit when the fix is released

We commit to:
- Acknowledging your report within **24 hours**
- Providing a triage assessment within **72 hours**
- Releasing a fix within **14 days** for high/critical issues
- Crediting reporters in the release notes (with their consent)

## Bug bounty

See `BUG_BOUNTY.md` for the bounty schedule and qualifying rules.

## Audit history

| Date | Auditor | Scope | Report |
|---|---|---|---|
| _pending_ | _TBD_ | ArbitrumVault.sol, SimpleLendingStrategy.sol | _link_ |

Static analysis by [Vault-Kit](../README.md) is run on every PR. The current
benchmark score is **100/100** with zero Critical/High/Medium/Low findings.
However, **static analysis is a preflight, not an audit** — see the
disclaimer at the bottom of the main README.

## Known limitations

These are documented constraints, not bugs:

1. **Owner can drain via `emergencyWithdraw()`.** This is by design for
   incident response. Mitigate via timelock + multisig as described above.
2. **Single oracle dependency.** Vault-Kit flags this as INFORMATIONAL. Consider
   adding a fallback oracle (Pyth, Redstone) for redundancy.
3. **Strategy is permissioned.** Only the vault owner can call `setStrategy`.
   A malicious or buggy strategy can drain the vault. Audit any new strategy
   with the same rigor as the vault itself before wiring it in.
4. **No deposit/withdraw fee on the strategy itself.** All fees are levied
   at the vault layer. If the underlying lending protocol charges its own
   fees, those reduce the vault's effective yield.
5. **`block.timestamp` is used for the withdrawal delay.** Validators can
   manipulate `block.timestamp` by ~15 seconds. The withdrawal delay is
   measured in days so this is not exploitable, but the tolerance is real.
6. **No share-token blocklist.** The vault's share token (ERC-20-shaped)
   has no compliance gates. If you deploy this in a regulated context,
   wrap it with a compliance layer.
