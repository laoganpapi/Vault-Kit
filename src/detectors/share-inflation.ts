import { BaseDetector } from './base';
import { AnalysisContext } from '../core/context';
import { Finding, Severity, Confidence, VulnerabilityCategory } from '../core/types';
import { walkAST } from '../utils/ast-helpers';

const SHARE_INFLATION = 'ERC-4626 Share Inflation' as VulnerabilityCategory;

/**
 * Detects the ERC-4626 / share-based vault "first depositor inflation attack".
 *
 * When a vault is empty (totalShares == 0), an attacker can:
 *   1. Deposit 1 wei, receiving 1 share (totalShares = 1)
 *   2. Donate a large amount directly to the vault (totalAssets = 10000e18)
 *   3. When a victim deposits X assets, they receive:
 *      X * totalShares / totalAssets = X * 1 / 10000e18 = 0 shares (rounded down)
 *   4. The victim loses their deposit entirely to the attacker's 1 share
 *
 * Mitigations:
 *   - Dead shares: mint 1000 shares to address(0) on first deposit
 *   - Virtual assets/shares: pretend the vault has extra shares when computing ratios
 *   - Require minimum initial deposit
 *   - Initial deposit by deployer (in constructor or initializer)
 */
export class ShareInflationDetector extends BaseDetector {
  readonly id = 'share-inflation';
  readonly name = 'ERC-4626 Share Inflation';
  readonly description = 'Detects ERC-4626 share vaults vulnerable to the first-depositor inflation attack';
  readonly category = SHARE_INFLATION;
  readonly defaultSeverity = Severity.HIGH;

  detect(context: AnalysisContext): Finding[] {
    const findings: Finding[] = [];

    for (const contract of context.contracts) {
      if (contract.kind === 'interface' || contract.kind === 'library') continue;

      // Heuristic: is this a share-based vault?
      // Look for: totalShares/totalSupply + totalAssets + a deposit function
      // that computes shares = amount * totalShares / totalAssets
      if (!this.looksLikeShareVault(contract)) continue;

      const depositFn = this.findDepositFunction(contract);
      if (!depositFn) continue;

      const body = (depositFn.node as any).body;
      if (!body) continue;

      // Look for the share computation pattern
      const hasShareComputation = this.hasShareComputation(body);
      if (!hasShareComputation) continue;

      // Check for mitigations
      const hasDeadShares = this.hasDeadSharesPattern(contract);
      const hasVirtualOffset = this.hasVirtualOffset(contract);
      const hasMinimumDeposit = this.hasMinimumFirstDeposit(contract, depositFn);
      const hasInitialDeposit = this.hasInitialDepositInConstructor(contract);

      if (!hasDeadShares && !hasVirtualOffset && !hasInitialDeposit) {
        findings.push(
          this.createFinding(context, {
            title: `ERC-4626 share inflation vulnerability in ${contract.name}`,
            description:
              `Contract ${contract.name} implements a share-based vault but has no protection ` +
              `against the first-depositor inflation attack. An attacker can:\n` +
              `  1. Deposit 1 wei when the vault is empty, receiving 1 share\n` +
              `  2. Donate a large amount directly to the vault (inflating totalAssets)\n` +
              `  3. Subsequent depositors receive 0 shares due to integer truncation\n` +
              `  4. The attacker owns 100% of shares backed by all victim deposits\n\n` +
              (hasMinimumDeposit
                ? 'A minimum deposit is enforced, which partially mitigates but does not fully prevent the attack.'
                : 'No minimum deposit is enforced, making the attack trivial.'),
            severity: Severity.HIGH,
            confidence: Confidence.MEDIUM,
            node: depositFn.node,
            recommendation:
              'Apply one of these defenses:\n' +
              '1. DEAD SHARES: On first deposit, mint a large number of shares to address(0) ' +
              '(e.g., 1e3 or 1e6 shares) to inflate the cost of the attack.\n' +
              '2. VIRTUAL OFFSETS: Use OpenZeppelin ERC4626 which adds a virtual offset to ' +
              'totalAssets and totalSupply during share price calculations.\n' +
              '3. INITIAL DEPOSIT: Make a non-trivial initial deposit in the constructor/initializer ' +
              'so the vault is never "empty" from a user perspective.\n' +
              '4. Require a minimum first deposit of sufficient size (e.g., 1 ether).',
            references: [
              'https://docs.openzeppelin.com/contracts/4.x/erc4626#inflation-attack',
              'https://blog.openzeppelin.com/a-novel-defense-against-erc4626-inflation-attacks',
            ],
          })
        );
      }

      // Also check for the rounding-direction issue in withdraw
      const withdrawFn = this.findWithdrawFunction(contract);
      if (withdrawFn) {
        const withdrawBody = (withdrawFn.node as any).body;
        if (withdrawBody && this.hasIncorrectRounding(withdrawBody)) {
          findings.push(
            this.createFinding(context, {
              title: `Incorrect rounding direction in ${contract.name}.${withdrawFn.name}()`,
              description:
                `Withdraw function uses standard division which rounds down. For withdraws, ` +
                `rounding should favor the protocol (round UP on shares burned, round DOWN on ` +
                `assets sent). Rounding in favor of the user allows dust-extraction attacks.`,
              severity: Severity.LOW,
              confidence: Confidence.LOW,
              node: withdrawFn.node,
              recommendation:
                'For deposits: round shares DOWN (fewer shares minted). ' +
                'For withdraws: round shares UP (more shares burned). ' +
                'Use mulDivUp/mulDivDown from OpenZeppelin Math library.',
            })
          );
        }
      }
    }

    return findings;
  }

  private looksLikeShareVault(contract: any): boolean {
    const stateVarNames = contract.stateVariables.map((v: any) => v.name.toLowerCase());
    const hasShares =
      stateVarNames.includes('totalshares') ||
      stateVarNames.includes('totalsupply') ||
      stateVarNames.some((n: string) => n.includes('share') && !n.includes('sharepriceupdated'));
    const hasAssets =
      stateVarNames.includes('totalassets') ||
      stateVarNames.includes('totalbalance') ||
      stateVarNames.some((n: string) => n.includes('asset') || n.includes('underlying'));
    return hasShares && hasAssets;
  }

  private findDepositFunction(contract: any): any | null {
    return contract.functions.find((f: any) =>
      f.hasBody && (f.name === 'deposit' || f.name === 'mint' || f.name === 'depositFor')
    );
  }

  private findWithdrawFunction(contract: any): any | null {
    return contract.functions.find((f: any) =>
      f.hasBody && (f.name === 'withdraw' || f.name === 'redeem' || f.name === 'withdrawFor')
    );
  }

  /**
   * Unwrap TupleExpressions that are just parenthesization.
   */
  private unwrap(node: any): any {
    if (node?.type === 'TupleExpression' && node.components?.length === 1) {
      return this.unwrap(node.components[0]);
    }
    return node;
  }

  /**
   * Detect the pattern: shares = amount * totalShares / totalAssets
   * or similar ratio computations involving state variables.
   */
  private hasShareComputation(body: any): boolean {
    let found = false;
    walkAST(body, (node: any) => {
      if (found) return;
      if (node.type === 'BinaryOperation' && node.operator === '/') {
        // Unwrap parenthesization: (amount * totalShares) / totalAssets
        const left = this.unwrap(node.left);
        // Look for a multiplication on the left: (a * b) / c
        if (left?.type === 'BinaryOperation' && left.operator === '*') {
          // Check if any operand references total-like state variables
          let hasTotal = false;
          walkAST(node, (inner: any) => {
            if (inner.type === 'Identifier') {
              const name = inner.name.toLowerCase();
              if (name.includes('total') || name.includes('supply') || name.includes('assets')) {
                hasTotal = true;
              }
            }
          });
          if (hasTotal) found = true;
        }
      }
    });
    return found;
  }

  /**
   * Check for dead shares mint: _mint(address(0), ...) or similar.
   */
  private hasDeadSharesPattern(contract: any): boolean {
    for (const fn of contract.functions) {
      if (!fn.hasBody) continue;
      const body = (fn.node as any).body;
      if (!body) continue;

      let found = false;
      walkAST(body, (node: any) => {
        if (found) return;
        // _mint(address(0), ...) or shares[address(0)] = ...
        if (node.type === 'FunctionCall' && node.expression?.name === '_mint') {
          const firstArg = node.arguments?.[0];
          if (this.isZeroAddress(firstArg)) found = true;
        }
        // shares[address(0)] += X
        if (
          node.type === 'BinaryOperation' &&
          (node.operator === '+=' || node.operator === '=') &&
          node.left?.type === 'IndexAccess'
        ) {
          if (this.isZeroAddress(node.left.index)) found = true;
        }
      });
      if (found) return true;
    }
    return false;
  }

  private isZeroAddress(node: any): boolean {
    if (!node) return false;
    // address(0)
    if (
      node.type === 'FunctionCall' &&
      node.expression?.name === 'address' &&
      node.arguments?.[0]?.type === 'NumberLiteral' &&
      node.arguments[0].number === '0'
    ) {
      return true;
    }
    return false;
  }

  /**
   * Check for virtual offset pattern (OpenZeppelin ERC4626).
   * Usually involves adding a constant like 1e6 or 10**_decimalsOffset() to totalAssets/totalSupply
   * when computing share price.
   */
  private hasVirtualOffset(contract: any): boolean {
    for (const fn of contract.functions) {
      if (!fn.hasBody) continue;
      if (!['_convertToShares', '_convertToAssets', 'convertToShares', 'convertToAssets', 'previewDeposit'].includes(fn.name)) {
        continue;
      }
      const body = (fn.node as any).body;
      if (!body) continue;

      // Look for '+ 10 **' or '+ 1' additions that look like virtual offsets
      let found = false;
      walkAST(body, (node: any) => {
        if (found) return;
        if (node.type === 'BinaryOperation' && node.operator === '+') {
          // + 10**decimalsOffset
          if (
            node.right?.type === 'BinaryOperation' &&
            node.right.operator === '**'
          ) {
            found = true;
          }
          // + 1 (virtual share)
          if (node.right?.type === 'NumberLiteral' && node.right.number === '1') {
            found = true;
          }
        }
      });
      if (found) return true;
    }
    return false;
  }

  private hasMinimumFirstDeposit(contract: any, depositFn: any): boolean {
    const body = (depositFn.node as any).body;
    if (!body) return false;

    const stateVarNames = new Set(contract.stateVariables.map((v: any) => v.name));
    let found = false;

    walkAST(body, (node: any) => {
      if (found) return;
      if (node.type === 'FunctionCall' && node.expression?.name === 'require') {
        walkAST(node, (inner: any) => {
          if (inner.type === 'BinaryOperation' && ['>=', '>'].includes(inner.operator)) {
            // Check if comparing deposit amount to a minimum
            walkAST(inner, (n: any) => {
              if (
                n.type === 'Identifier' &&
                (n.name === 'minDeposit' || n.name === 'MIN_DEPOSIT' || n.name === 'minimum' ||
                 (stateVarNames.has(n.name) && n.name.toLowerCase().includes('min')))
              ) {
                found = true;
              }
            });
          }
        });
      }
    });
    return found;
  }

  private hasInitialDepositInConstructor(contract: any): boolean {
    const ctor = contract.functions.find((f: any) => f.isConstructor);
    if (!ctor?.hasBody) return false;

    const body = (ctor.node as any).body;
    if (!body) return false;

    // Look for state assignments to totalShares/totalAssets in constructor
    let found = false;
    walkAST(body, (node: any) => {
      if (
        node.type === 'BinaryOperation' &&
        (node.operator === '=' || node.operator === '+=') &&
        node.left?.type === 'Identifier'
      ) {
        const name = node.left.name.toLowerCase();
        if (name.includes('total') || name.includes('share')) {
          found = true;
        }
      }
    });
    return found;
  }

  private hasIncorrectRounding(body: any): boolean {
    // Simple check: division used in withdraw calculations without rounding up
    let hasDiv = false;
    walkAST(body, (node: any) => {
      if (node.type === 'BinaryOperation' && node.operator === '/') hasDiv = true;
    });
    return hasDiv;
  }
}
