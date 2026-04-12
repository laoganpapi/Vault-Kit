# Claude Code Operating Guide

This repo is configured with a curated set of specialized agents under `.claude/agents/`, organized into three tiers: a **core team** that is always available, a **bench** of specialists that activate only when their triggers fire, and a **dynamic specialist factory** pattern for one-shot roles the bench doesn't cover.

The guide is portable. Nothing in the main body is specific to any project. Project-specific overrides live at the bottom in the **Project overlay** section.

---

## 1. Tier 1 — Core team (always available)

These nine agents are irreducible. Every non-trivial task uses some subset of them. Removing any one leaves a gap that cannot be filled by composing the others.

| Agent | Model | Writes? | Phase | Job |
| --- | --- | --- | --- | --- |
| `architect` | opus | no | Plan | Produces step-by-step implementation plans with trade-offs, risks, and rollback. Never writes code. |
| `researcher` | sonnet | no | Plan | Maps unfamiliar code, traces data flow, answers "how does X work" with file:line citations. Never writes code. |
| `implementer` | sonnet | yes | Build | Executes a plan with surgical precision. Stops and reports if the plan is wrong instead of improvising. |
| `refactorer` | sonnet | yes | Build | Simplifies existing code without changing behavior. Deletes dead code, inlines one-off helpers, clarifies names. |
| `debugger` | sonnet | yes | Build | Finds root cause before proposing a fix. Never patches symptoms. |
| `code-reviewer` | opus | no | Review | Independent blunt review of a diff. Its value is having no context from the implementation conversation. |
| `test-engineer` | sonnet | yes | Verify | Writes tests adversarially — invariants, edge cases, fuzz, property, regression. |
| `build-validator` | haiku | no | Verify | Runs build/lint/typecheck/test commands in parallel and triages first-cause failures. Fast feedback loop. |
| `docs-writer` | sonnet | yes | Ship | Writes documentation that matches the code as it actually is. Never documents aspirations. |

## 2. Tier 2 — Bench (conditional specialists)

These agents exist in the kit but only activate when their triggers fire. If the trigger doesn't fire, **do not invoke them**. Running a deep security audit on a typo fix is waste.

| Agent | Activation trigger |
| --- | --- |
| `security-auditor` | Diff touches trust boundaries: untrusted input to a sink, auth, authz, crypto, secrets, deserialization, privileged ops, SSRF-able egress, file upload, path construction, smart-contract value flows or external calls. |
| `dependency-auditor` | Dependencies added/removed/upgraded in a manifest; lockfile changes; release prep; CVE advisory affecting a used package. |
| `performance-optimizer` | A **measured** bottleneck exists (profile, benchmark, slow-query log, gas report, regression). Correctness and security are already established. Never preemptive. |

**Bench rules:**
- Bench agents are invoked by the main thread only when their activation criteria are met. Their descriptions deliberately omit the word "PROACTIVELY" to prevent auto-invocation.
- When a bench agent is skipped, the main thread should state why in one sentence. Silent skipping hides the decision.
- Bench agents are read-only (except `performance-optimizer`, which writes under strict before/after measurement discipline). They identify; `implementer` patches.

## 3. Tier 3 — Dynamic specialist factory

When a task hits a domain the bench doesn't cover — a11y audit, database migration review, ML training-loop debugging, GPU kernel tuning, IaC review, compliance (HIPAA/PCI/GDPR) walkthrough, API-design review, mobile perf, compiler internals, protocol fuzzing, game physics, smart-contract-specific audit — spawn a **one-shot specialist** via the general-purpose `Agent` tool.

Do not create a persistent `.md` file for single-use roles. Do not invoke a bench agent outside its trigger criteria just because it's the closest match.

### Specialist factory template

Every dynamic specialist prompt must include these sections. Copy-paste this skeleton and fill it in:

```
Role: <one-line role description, e.g. "Senior accessibility auditor for WCAG 2.2 AA compliance">

Scope:
- <exactly what is in scope>
- <exactly what is out of scope — defer these to other agents>

Context:
- Goal: <what the main thread is trying to accomplish>
- Relevant files: <file paths, with brief descriptions>
- Prior findings: <anything already determined that this specialist should not re-derive>
- Constraints: <language, framework, versions, performance/security budgets>

Process:
1. <step 1>
2. <step 2>
...

Output format:
- <section 1>
- <section 2>
...

Hard rules:
- Read-only / may edit <specific paths>
- Never <thing the role must not do>
- If blocked or the task is out of scope, stop and report — do not improvise

Done criteria:
- <what "complete" looks like for this invocation>
```

### Factory rules
- **Name the role specifically.** "Accessibility auditor" not "reviewer." "Database migration safety reviewer" not "DB specialist."
- **Scope tightly.** A specialist with a broad mandate will do shallow work. Narrow the scope to what you actually need.
- **Lock down tools in the prompt** (since you can't set `tools:` frontmatter on a dynamic specialist). State explicitly "read-only: Read, Grep, Glob, Bash for inspection only" or "may edit: only files under src/migrations/".
- **Brief prior findings.** Subagents have no memory of the main thread. Include what's already been decided so they don't re-derive it.
- **Define done.** What does the main thread need back, and in what form?

### When to promote a dynamic specialist to the bench
If you find yourself spawning the same dynamic specialist on more than two projects, promote it: write a persistent `.md` file with the specialist factory template's content as the system prompt, and add it to the bench with explicit activation criteria.

## 4. Orchestration rules

### Parallelize when independent
Code review, security audit, and dependency audit have no dependencies on each other — launch them in a single message with multiple `Agent` tool calls. Test writing can start in parallel with implementation once interfaces are stable.

### Serialize when dependent
Planning → implementation → review → verification is strictly sequential. Never dispatch `implementer` before the plan is finalized. Never declare a task done before `build-validator` passes.

### Synthesis stays on the main thread
Never tell a subagent "based on the previous agent's findings, do X." Read each agent's output yourself. Decide what to do. Brief the next agent with concrete file paths, line numbers, and changes. If you delegate synthesis, you've outsourced the only judgment call that matters.

### Auditors never patch
`security-auditor`, `dependency-auditor`, `code-reviewer` are read-only by design. They identify; `implementer` patches. This separation is what makes reviews trustworthy.

### Each subagent starts fresh
It has no memory of the current conversation. Every prompt is self-contained: goal, relevant file paths, prior findings, constraints, output format, done criteria. Terse prompts produce shallow results.

### Match scope to the task
- Typo fix: `implementer` only. No architect. No review chain.
- Bug fix: `debugger` → `build-validator` → `code-reviewer` → `build-validator`.
- Non-trivial feature: full workflow below.
- Audit: bench agents + dynamic specialists in parallel, findings flow back to `implementer`.

## 5. Default workflows

### Non-trivial feature
1. `architect` → plan
2. `researcher` in parallel if the plan depends on unfamiliar code
3. `implementer` → executes the plan
4. `test-engineer` → writes tests (parallel with 3 once interfaces stabilize)
5. `build-validator` → everything compiles and passes
6. `code-reviewer` + `security-auditor` (if trust-boundary trigger) + `dependency-auditor` (if deps changed) in **parallel**
7. `implementer` → addresses blocking feedback
8. `build-validator` → re-verify
9. `docs-writer` → only if public surface changed

### Bug fix
1. `debugger` → root cause + minimum fix + regression test that fails before and passes after
2. `build-validator` → verify
3. `code-reviewer` → review
4. `build-validator` → re-verify

### Audit (of existing code)
1. `security-auditor` (if applicable) + `dependency-auditor` (if applicable) + any dynamic specialists needed, in **parallel**
2. Findings handed to `implementer` for patches
3. Re-audit after fixes

### Performance optimization
1. `build-validator` → confirm baseline green
2. `performance-optimizer` → measure, change one class at a time, re-measure
3. `build-validator` → full suite including any fuzz/property tests
4. `security-auditor` or relevant auditor → confirm no security regression introduced

### Cleanup / simplification
1. `build-validator` → confirm baseline green
2. `refactorer` → one category of simplification at a time
3. `build-validator` → after each meaningful change

## 6. Hard rules (apply to every workflow)

- **Never skip `build-validator` before declaring work complete.** If the build is red, the work is not done — regardless of how good the diff looks.
- **Never merge a diff without `code-reviewer`.** It is the only agent whose value comes from having zero context.
- **Never invoke a bench agent outside its trigger criteria.** State why you're skipping it if the user might expect otherwise.
- **Never compose synthesis into a subagent's prompt.** Synthesis is the main thread's job.
- **Never let `implementer` drift into refactoring, or `refactorer` drift into feature work.** These are different modes and conflating them corrupts both.

---

## Project overlay

<!-- Everything below this line is project-specific. The content above is portable across projects. -->

### Vault-Kit (current project)

- This repo is a multi-strategy ERC-4626 yield vault on Arbitrum using Aave leverage and GMX GM pool strategies.
- A completed audit exists in `AUDIT_REPORT.md`. Read it before making contract changes so `security-auditor` does not re-report fixed findings.
- Security bar is **very high**. Every contract change goes through `security-auditor` — its smart-contract section covers reentrancy, CEI, oracles, MEV, economic attacks, and ERC-4626 specifics.
- When a pure smart-contract audit is needed (not a code change — an audit pass), spawn a **dynamic specialist** named "Solidity/EVM auditor" using the factory template. Brief it with the project's audit report, the specific contracts in scope, and the threat model.
- `forge test` floor: fuzz runs ≥10,000, invariant depth ≥50. If accounting changes, `test-engineer` adds new invariants.
- `via_ir = true` and `optimizer_runs = 200` are locked. `performance-optimizer` does not change these without explicit user approval.
- `ARBITRUM_RPC_URL` and `ARBISCAN_API_KEY` are env vars. Never hardcode, never commit, never echo to logs.
- When `performance-optimizer` activates on this repo, its baseline metric is `forge snapshot` + `forge test --gas-report`. The Solidity section of its prompt applies directly.
