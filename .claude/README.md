# Claude Code Agent Kit

A curated set of hyperspecialized subagents for Claude Code, tuned for building secure, high-quality software (with extra sharpness for Solidity/DeFi work). Designed to compose — each agent owns one concern and returns structured output for the main thread to synthesize.

## What's in here

```
.claude/agents/
├── architect.md           # Plan before building
├── researcher.md          # Explore unfamiliar code
├── implementer.md         # Execute plans, nothing more
├── refactorer.md          # Simplify without changing behavior
├── debugger.md            # Root-cause, not symptom-patch
├── code-reviewer.md       # Blunt independent review
├── security-auditor.md    # Web2/infra/appsec
├── solidity-auditor.md    # Solidity/DeFi/economic attacks
├── dependency-auditor.md  # CVEs, supply chain, licenses
├── gas-optimizer.md       # Solidity gas (security-preserving)
├── test-engineer.md       # Fuzz, invariants, property tests
├── build-validator.md     # Fast compile/lint/test loop
└── docs-writer.md         # Docs that match reality
```

Orchestration is defined in `../CLAUDE.md` — it tells Claude Code when to invoke which agent, what to run in parallel, and what to serialize.

## Design principles

1. **Hyperspecialization.** Each agent owns one concern. No "do everything" agents.
2. **Tool-scoped by role.** Auditors are read-only. Implementers can write. Validators run commands but don't edit.
3. **Model-matched to difficulty.** Opus for reasoning-heavy planning and review. Sonnet for implementation. Haiku for fast feedback loops.
4. **Auditors never patch.** Separation of identify-vs-fix keeps review honest and diffs reviewable.
5. **Every prompt is self-contained.** Subagents have zero context from the main conversation. Briefings must include paths, lines, goals, and done-criteria.
6. **Composition over hierarchy.** The main thread is the orchestrator; subagents are not allowed to dispatch further subagents. This keeps reasoning and synthesis on one thread.

## Using these agents on another project

This kit is versioned here but designed to be portable. Two ways to use it elsewhere:

### Option A — Per-project (recommended)
Copy `.claude/agents/` and `CLAUDE.md` into each project. Edit `CLAUDE.md`'s project-specific notes section to match the new project. Commit both.

```bash
cp -r /path/to/Vault-Kit/.claude/agents /path/to/other-project/.claude/
cp /path/to/Vault-Kit/CLAUDE.md /path/to/other-project/CLAUDE.md
# then edit the project-specific notes at the bottom of CLAUDE.md
```

### Option B — User-global
Install into `~/.claude/agents/` so every project sees them automatically:

```bash
mkdir -p ~/.claude/agents
cp .claude/agents/*.md ~/.claude/agents/
```

Project-local agents (in `.claude/agents/`) override user-global ones with the same name, so you can keep this kit as your baseline and specialize per project.

## Adjusting the kit

- **Add a domain-specific agent** by dropping a new `*.md` file in `.claude/agents/` with YAML frontmatter (`name`, `description`, `tools`, `model`) and a system prompt.
- **Tighten tool access** by editing the `tools:` line. Omitting it inherits all tools — always prefer an explicit allowlist for read-only roles.
- **Change models** by editing `model:`. Valid values: `opus`, `sonnet`, `haiku`, or inherit.
- **Update the workflows** in `CLAUDE.md` as you discover which chains work best for your projects.

## Philosophy

The goal of this kit is not "more automation" — it's **better decisions per token**. Each agent is a specialist you'd hire for exactly one job, briefed with exactly what they need, held to a narrow scope. The main thread plays conductor: breaks work into pieces, dispatches specialists, synthesizes their outputs, and makes every final call itself.

Synthesis never gets delegated. Specialists never patch what they review. Reviewers never write the diff. These separations are what make the system trustworthy at scale.
