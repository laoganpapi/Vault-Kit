# Vault-Kit Verification & Deployment — Central Guide

This is the **single source of truth** for running every verification and deployment
step. Everything runs on GitHub Actions. You do not need a local terminal, Foundry, or
Solidity knowledge. You will click buttons and paste secrets into a web form.

If you skip this file and try to run things by hand, you will end up back here.

---

## Step 0 — One-time setup (≈5 minutes)

### 0.1 Get the values you'll need

You need six things before you add anything to GitHub. Collect them first, then add them
all at once in Step 0.2.

| Thing | How to get it | Where you'll use it |
|---|---|---|
| **Arbitrum mainnet RPC URL** | Sign up at https://www.alchemy.com (free). Create App → Chain: Arbitrum → Network: Mainnet → View Key → HTTPS URL. Or use the free public endpoint `https://arb1.arbitrum.io/rpc` (slower, rate-limited). | Fork tests |
| **Arbitrum Sepolia RPC URL** | Same Alchemy account, create a second app on Arbitrum Sepolia. Or use `https://sepolia-rollup.arbitrum.io/rpc`. | Sepolia deploy |
| **Deployer private key** | Open MetaMask → create a brand-new account → Account details → Show private key. **Use a fresh wallet. Do not reuse your mainnet key.** Fund it with a small amount of Arbitrum Sepolia ETH from https://faucet.quicknode.com/arbitrum/sepolia | Sepolia deploy |
| **Guardian address** | Any address you control (MetaMask → copy account address). Can be the same as the deployer for testnet, but on mainnet this should be a separate cold wallet or multisig. | Sepolia deploy |
| **Fee recipient address** | Any address you control. Receives protocol fees. | Sepolia deploy |
| **Arbiscan API key** | https://arbiscan.io/myapikey → Add a new API key. | Contract verification on Arbiscan (optional but nice to have) |

### 0.2 Add them as GitHub secrets

1. Open your repo on GitHub: https://github.com/laoganpapi/Vault-Kit
2. Click **Settings** (top bar)
3. In the left sidebar, click **Secrets and variables → Actions**
4. Click **New repository secret** and add each of these one at a time. The name must
   match **exactly** (case-sensitive):

   | Name | Value |
   |---|---|
   | `ARBITRUM_RPC_URL` | Your mainnet RPC URL from 0.1 |
   | `ARBITRUM_SEPOLIA_RPC_URL` | Your Sepolia RPC URL from 0.1 |
   | `DEPLOYER_PRIVATE_KEY` | Your deployer key from 0.1 (no `0x` prefix is fine either way) |
   | `GUARDIAN_ADDRESS` | `0x...` guardian address |
   | `FEE_RECIPIENT` | `0x...` fee recipient |
   | `ARBISCAN_API_KEY` | Your Arbiscan API key (optional) |

   There is no "save all" — you add each one individually. When done, you should see
   all six in the list.

That's the entire setup. Nothing is committed to the repo. Secrets never leave GitHub.

---

## Step 1 — Verify the code (automatic)

**What it runs:** `forge build`, unit + fuzz tests (10k runs), invariant tests
(1k runs × depth 100), slither static analysis, coverage, gas snapshot.

**How to trigger it:**

- It runs **automatically** on every push to `main`, `master`, or any `claude/**` branch.
- It also runs on every pull request.
- To trigger manually: **Actions → Verify → Run workflow → select branch → Run workflow**.

**Where to see results:**

- Go to the **Actions** tab
- Click the latest **Verify** run
- Each job (Build, Unit + Fuzz, Invariant Suite, Slither, Coverage, Gas Snapshot,
  Fork Tests) shows as a separate entry
- Green check = passed. Red X = failed. Click into a job to see logs.

**What to do if something is red:**

- Copy the failing job's log output
- Paste it into a new Claude Code session on the repo with "CI is red, here's the log"
- The fix gets committed to the branch and CI re-runs automatically

---

## Step 2 — Slither static analysis (automatic, part of Step 1)

Runs as part of the **Verify** workflow. Uses `crytic/slither-action@v0.4.0`.

- **Fail threshold:** medium and higher. Low + informational are filtered out.
- **Paths excluded:** `lib/`, `test/`, `script/`
- **SARIF output:** uploaded to the GitHub Security tab (Security → Code scanning alerts)

Configuration: `slither.config.json` at the repo root.

---

## Step 3 — Fork tests against live Arbitrum mainnet (automatic once secret is set)

Once you add the `ARBITRUM_RPC_URL` secret in Step 0.2, the **Fork Tests (Arbitrum
Mainnet)** job starts running on every push. It uses the real Aave V3, real Uniswap V3,
real Chainlink feeds — the same state users see on mainnet.

**Tests included:**

- `AaveSupplyStrategyForkTest`
  - Full lifecycle: deposit → rebalance → warp 7 days → harvest → withdraw
  - Emergency exit leaves vault holding principal
- `AaveLeverageStrategyForkTest`
  - Leveraged deposit produces healthy HF ≥ 1.3
  - Full emergency unwind from a deep loop position
  - Partial user withdrawal leaves a healthy remaining position

**If the secret is not set:** the job `Fork Tests (SKIPPED — secret missing)` runs
instead and prints a warning. Nothing breaks; you just don't get fork coverage.

---

## Step 4 — Deploy to Arbitrum Sepolia (manual, one click)

**Once per deployment:**

1. Go to **Actions → Deploy to Arbitrum Sepolia**
2. Click **Run workflow** (top right)
3. In the confirmation box, type exactly `DEPLOY` (all caps)
4. Click **Run workflow** again to kick it off

**What it does:**

- Checks all required secrets are present
- `forge build`
- `forge script script/DeploySepolia.s.sol --broadcast --verify`
- Uploads the `broadcast/` directory as a downloadable artifact

**After deploy:**

- The run summary shows every deployed contract address in the logs
- Download the `sepolia-broadcast-<id>` artifact for the full transaction record
- Track the deployed contracts on https://sepolia.arbiscan.io/

**Initial Sepolia deploy uses `IdleStrategy`** — a zero-dependency cash reserve. This is
intentional: Aave integration on testnets is flaky (address drift, absent incentive
programs), and **fork tests already cover the real Aave behavior against mainnet state**.
Sepolia is for verifying YOUR code under realistic user flows (deposit, withdraw, pause,
timelock, harvest scheduling).

---

## Step 5 — Human audit (not automated, for obvious reasons)

No GitHub Action can replace a human security review. When you're ready for mainnet,
contact one of these:

| Vendor | Format | Price range | Turnaround | Intake |
|---|---|---|---|---|
| **Code4rena** | Public contest | $10k – $100k pool | 1–2 weeks | https://code4rena.com/submit |
| **Sherlock** | Private contest + insurance | $10k – $50k pool | 1–2 weeks | https://sherlock.xyz |
| **Cantina** | Private contest | Variable | Variable | https://cantina.xyz |
| **OpenZeppelin** | Traditional audit | $50k+ | 4–8 weeks | https://www.openzeppelin.com/security-audits |
| **Trail of Bits** | Traditional audit | $50k+ | 4–8 weeks | https://www.trailofbits.com |
| **Spearbit** | Distributed audit | $50k+ | 4–8 weeks | https://spearbit.com |

**Order of operations for a contest submission:**

1. Make sure CI is green (Step 1)
2. Make sure fork tests are green (Step 3)
3. Make sure Sepolia deploy has been running for ≥1 week with test traffic (Step 4)
4. Tag a release on GitHub: `git tag audit-v1 && git push --tags`
5. Send the contest platform a link to the tagged commit + `docs/VERIFICATION.md`

**When findings come back:**

- Each finding gets an issue opened using the `audit-finding.yml` template
- Fix on a branch, commit referencing the issue (`Fixes #42`), get CI green, merge
- Document remediation in the issue before closing

---

## Local execution (optional — you don't need this if CI works)

If you want to run the same checks on your own machine:

```bash
# One-time: install Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup

# One-time: install slither
pip install slither-analyzer

# Run everything
make verify              # build + test + fuzz + invariant + slither
make fork                # fork tests (export ARBITRUM_RPC_URL first)
make deploy-sepolia      # export all required secrets first
```

The `make help` target lists everything.

---

## Troubleshooting

**CI is red and I don't know why.**
Open the failing run, click the failing job, scroll to the red step. Copy the log.
Paste it into a Claude Code session with "CI is red, fix this". Commit the fix to the
branch; CI re-runs automatically.

**Fork tests skipped with a warning.**
Add the `ARBITRUM_RPC_URL` secret per Step 0.2. Re-run the workflow from the Actions tab.

**Deploy workflow says "Missing required secrets".**
The preflight job lists exactly which names are missing. Add them per Step 0.2.

**Deploy succeeds but contract verification fails.**
Contract verification requires `ARBISCAN_API_KEY`. It's optional — deployment still
works without verification. Add the key and re-run to verify later.

**Sepolia faucet is empty.**
Try https://faucet.quicknode.com/arbitrum/sepolia or https://www.alchemy.com/faucets/arbitrum-sepolia
or bridge from Sepolia mainnet at https://bridge.arbitrum.io/.

**I want to run on a different testnet / mainnet.**
Mainnet deployment uses `script/Deploy.s.sol` instead of `DeploySepolia.s.sol`. It needs
a separate workflow you haven't been given yet. Do not run mainnet deploy until all of
Steps 1–5 are green AND a human auditor has signed off.
