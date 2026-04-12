# Claude Code Operating Guide

This repo is configured with a curated set of specialized agents under `.claude/agents/`. This file tells Claude Code when and how to use them.

## The agents at a glance

| Agent | Phase | Model | Writes code? | When |
| --- | --- | --- | --- | --- |
| `architect` | Plan | opus | no | Before any non-trivial change |
| `researcher` | Plan | sonnet | no | Open-ended exploration / "how does X work" |
| `implementer` | Build | sonnet | yes | Executing an approved plan |
| `refactorer` | Build | sonnet | yes | Simplifying existing code after features land |
| `debugger` | Build | sonnet | yes | Diagnosing failures to root cause |
| `code-reviewer` | Review | opus | no | After any non-trivial diff, before commit |
| `security-auditor` | Review | opus | no | Code that touches input, credentials, or privilege |
| `solidity-auditor` | Review | opus | no | Any contract change touching value, external calls, or accounting |
| `dependency-auditor` | Review | sonnet | no | Adding deps or preparing a release |
| `gas-optimizer` | Optimize | sonnet | yes | After correctness and security are established |
| `test-engineer` | Verify | sonnet | yes | Alongside or after implementation |
| `build-validator` | Verify | haiku | no | After every change and before declaring done |
| `docs-writer` | Ship | sonnet | yes | After a feature is done, reviewed, and tested |

## Default workflows

### Adding a non-trivial feature
1. `architect` → plan
2. `researcher` in parallel if the plan depends on unfamiliar code
3. `implementer` → executes the plan
4. `test-engineer` → writes tests (can run in parallel with 3 once interfaces are stable)
5. `build-validator` → verify everything compiles and tests pass
6. `code-reviewer` + `security-auditor` (+ `solidity-auditor` if contracts touched) in **parallel**
7. `implementer` → addresses blocking feedback
8. `build-validator` → re-verify
9. `docs-writer` → update NatSpec / README if public surface changed

### Fixing a bug
1. `debugger` → root-cause + minimum fix + regression test
2. `build-validator` → verify
3. `code-reviewer` → review
4. `build-validator` → re-verify

### Auditing a contract / module
- `solidity-auditor` (for Solidity) or `security-auditor` (for everything else) in parallel with `dependency-auditor`
- Findings go back to `implementer`, never applied by the auditor itself
- Re-audit after fixes

### Optimizing gas
1. `build-validator` → confirm baseline green
2. `gas-optimizer` → measure, change one class at a time, re-measure
3. `build-validator` → full suite including fuzz/invariant
4. `solidity-auditor` → confirm no security regressions introduced

## Orchestration rules

**Parallelize when independent.** Code review, security audit, and dependency audit have no dependencies on each other — launch them in a single message with multiple `Agent` tool calls.

**Serialize when dependent.** Planning → implementation → review → verification is strictly sequential. Don't dispatch the implementer before the plan is finalized.

**Delegate synthesis to the main thread, not to subagents.** Never tell a subagent "based on the previous agent's findings, fix the bug." The main thread reads each agent's output, decides what to do, and briefs the next agent with concrete file paths, lines, and changes.

**Auditors never patch.** `security-auditor`, `solidity-auditor`, `dependency-auditor`, and `code-reviewer` are read-only by design. They identify; `implementer` patches.

**Each subagent starts fresh.** It has no memory of the current conversation. Every prompt must be self-contained: goal, relevant file paths, prior findings, what "done" looks like.

**Match scope to the task.** Don't invoke `architect` for a typo fix. Don't skip `solidity-auditor` for "just one line" in a vault contract.

## Project-specific notes for Vault-Kit

- This repo is a multi-strategy ERC-4626 yield vault on Arbitrum using Aave leverage and GMX GM pool strategies. It has a completed audit in `AUDIT_REPORT.md` — read it before making contract changes.
- Security bar is **very high**. Every contract change goes through `solidity-auditor`, no exceptions. Every change to accounting or external integration goes through the full review chain in parallel.
- Use `forge test` (includes fuzz at 10,000 runs and invariant at depth 50). These are the floor — if you change accounting, `test-engineer` should add new invariants.
- `via_ir = true` and `optimizer_runs = 200` are locked in. `gas-optimizer` does not change these without explicit user approval.
- `ARBITRUM_RPC_URL` and `ARBISCAN_API_KEY` are env vars — never hardcode, never commit, never echo to logs.
