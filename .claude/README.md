# Claude Code Agent Kit

A minimum-viable, maximum-coverage set of hyperspecialized subagents for Claude Code. Three tiers: a **core team** that ships every project, a **bench** of conditional specialists with explicit activation triggers, and a **dynamic specialist factory** pattern for everything else.

The orchestration policy (when to invoke, what to parallelize, how to brief specialists) lives in the repo root at `../CLAUDE.md`.

## Layout

```
.claude/
├── README.md                   # this file
└── agents/
    ├── architect.md            # CORE — plans before building
    ├── researcher.md           # CORE — explores unfamiliar code
    ├── implementer.md          # CORE — executes plans precisely
    ├── refactorer.md           # CORE — simplifies without changing behavior
    ├── debugger.md             # CORE — root-cause, not symptom-patch
    ├── code-reviewer.md        # CORE — blunt independent review
    ├── test-engineer.md        # CORE — adversarial test writing
    ├── build-validator.md      # CORE — fast build/lint/test loop
    ├── docs-writer.md          # CORE — docs match reality
    │
    ├── security-auditor.md     # BENCH — trust-boundary code
    ├── dependency-auditor.md   # BENCH — manifest/lockfile changes, releases
    └── performance-optimizer.md # BENCH — measured bottlenecks only
```

**9 core + 3 bench = 12 persistent agents.** Everything else is a dynamic specialist.

## The three tiers

### Tier 1 — Core (9 agents, always available)
These are the irreducible phases of shipping quality software: plan, explore, build, simplify, debug, review, test, verify, document. Remove any one and you leave a gap that cannot be filled by composing the others.

### Tier 2 — Bench (3 agents, conditional)
Security, dependencies, and performance are near-universal concerns but they have mechanical activation triggers. Running them unconditionally is waste; skipping them when their triggers fire is negligence. The bench lets Claude invoke them precisely.

| Bench agent | Activates when |
| --- | --- |
| `security-auditor` | Code touches untrusted input, auth, secrets, crypto, privileged operations, or smart-contract value flows |
| `dependency-auditor` | Manifest/lockfile changed, release prep, or new CVE affects a used package |
| `performance-optimizer` | A measured bottleneck exists AND correctness + security are already established |

### Tier 3 — Dynamic specialists (spawned on demand)
When a task hits a domain the bench doesn't cover — a11y, database migrations, ML training, GPU kernels, IaC, compliance, mobile perf, protocol fuzzing, smart-contract audits, etc. — the main thread spawns a one-shot specialist via the general-purpose `Agent` tool using the **specialist factory template** in `CLAUDE.md`. No persistent file, no kit bloat.

If the same dynamic specialist appears on ≥3 projects, promote it to the bench with explicit activation criteria.

## Design principles

1. **Core is irreducible.** Every core agent maps to a phase no other agent can cover. Nine is the fixed point.
2. **Bench is triggered, not default.** Bench agents are silent unless their activation criteria fire. Skipping is a decision, not a default.
3. **Long tail is dynamic.** The factory pattern absorbs infinite variety without growing the kit.
4. **Hyperspecialization over versatility.** Each agent owns one concern. Versatile agents become mediocre at everything.
5. **Tool-scoped by role.** Auditors are read-only. Implementers can write. Validators run commands but cannot edit. The `tools:` allowlist enforces this at the framework level, not by convention.
6. **Model-matched to difficulty.** Opus where false negatives are most expensive (review, planning). Sonnet for implementation and other cognitive work. Haiku for fast mechanical loops.
7. **Auditors never patch.** Separation of identify-vs-fix is what keeps review honest and diffs reviewable.
8. **Synthesis stays on the main thread.** Subagents never dispatch other subagents. The main thread is the sole orchestrator.
9. **Self-contained briefs.** Subagents have zero context from the conversation; every prompt must include goal, files, prior findings, constraints, output format, and done criteria.
10. **Portable by default, project overlays at the bottom.** `CLAUDE.md` has a portable body and a project-specific overlay section clearly marked.

## Installing on another project

Two ways:

### Option A — Per-project (recommended)
Copy `.claude/` and `CLAUDE.md` into the new project. The only edit needed is the Project overlay section at the bottom of `CLAUDE.md`.

```bash
cp -r Vault-Kit/.claude other-project/
cp Vault-Kit/CLAUDE.md other-project/CLAUDE.md
# edit the Project overlay section in other-project/CLAUDE.md
```

### Option B — User-global
Install the agents into `~/.claude/agents/` so every project inherits them. Put the portable section of `CLAUDE.md` into `~/.claude/CLAUDE.md` for global orchestration policy; keep project-specific overlays in each repo's local `CLAUDE.md`.

```bash
mkdir -p ~/.claude/agents
cp .claude/agents/*.md ~/.claude/agents/
```

Project-local agents (in a repo's `.claude/agents/`) override user-global ones with the same name. This lets a specific project add, say, a persistent `solidity-auditor` without touching the global kit.

## Extending the kit

**Adding a bench agent** — create an `agents/<name>.md` file with:
- YAML frontmatter: `name`, `description` (must state activation trigger, do not include "PROACTIVELY"), `tools` (explicit allowlist), `model`
- An "Activation criteria" section with mechanical triggers
- Scope, process, output format, and hard rules
- Update `CLAUDE.md`'s bench table with the trigger

**Adding a core agent** — don't, unless you've identified a phase of the software lifecycle the current nine don't cover. The bar is high: prove the gap cannot be filled by composing existing agents.

**Tightening tool access** — omit tools the agent should never have. Read-only agents should never have `Edit` or `Write`. Validators should have `Bash` but not `Edit`. Err on the side of strict.

**Model selection** — opus for reasoning-heavy roles where missing a bug is expensive (architect, code-reviewer, security-auditor). Sonnet for writing code, tests, and docs. Haiku for mechanical tight-loop roles (build-validator).

## Philosophy

The goal is **better decisions per token**, not more automation. Each agent is a specialist you'd hire for exactly one job, briefed with exactly what they need, held to a narrow scope. The main thread plays conductor: breaks work into pieces, dispatches specialists, synthesizes their outputs, and makes every final call itself.

Synthesis never gets delegated. Specialists never patch what they review. Reviewers never write the diff. These separations are what make the system trustworthy at scale — and what make it cheap, because nothing runs that doesn't need to.
