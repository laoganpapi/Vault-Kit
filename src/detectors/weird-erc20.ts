import { BaseDetector } from './base';
import { AnalysisContext } from '../core/context';
import { Finding, Severity, Confidence, VulnerabilityCategory } from '../core/types';
import { walkAST } from '../utils/ast-helpers';

const WEIRD_ERC20 = 'Weird ERC-20 Incompatibility' as VulnerabilityCategory;

/**
 * Detects patterns that break on "weird" ERC-20 tokens.
 *
 * Real-world ERC-20 quirks that cause bugs:
 *   1. Fee-on-transfer (FoT) / deflationary tokens (SAFEMOON, some BSC tokens)
 *      - balanceOf(contract) after transfer != amount transferred
 *   2. Rebasing tokens (AMPL, stETH)
 *      - balanceOf changes without transfers
 *   3. Blocklist tokens (USDC, USDT)
 *      - transfer() reverts if either party is blocklisted
 *   4. Tokens with callback hooks (ERC-777)
 *      - transfer() can trigger arbitrary code (reentrancy surface)
 *   5. Non-standard return values (USDT returns nothing)
 *      - .transfer() call appears successful but state wasn't updated
 *
 * Common bug patterns:
 *   - Using the transferred `amount` parameter instead of balanceAfter - balanceBefore
 *   - Comparing balanceOf to expected values (fails for rebasing)
 *   - Assuming approve() resets cleanly (USDT requires 0 first)
 */
export class WeirdERC20Detector extends BaseDetector {
  readonly id = 'weird-erc20';
  readonly name = 'Weird ERC-20 Incompatibility';
  readonly description = 'Detects patterns that break on fee-on-transfer, rebasing, and non-standard ERC-20 tokens';
  readonly category = WEIRD_ERC20;
  readonly defaultSeverity = Severity.MEDIUM;

  detect(context: AnalysisContext): Finding[] {
    const findings: Finding[] = [];

    for (const contract of context.contracts) {
      if (contract.kind === 'interface' || contract.kind === 'library') continue;

      for (const fn of contract.functions) {
        if (!fn.hasBody) continue;
        const body = (fn.node as any).body;
        if (!body) continue;

        this.checkFeeOnTransferBug(context, contract, fn, body, findings);
        this.checkApproveResetIssue(context, contract, fn, body, findings);
        this.checkBalanceAssumption(context, contract, fn, body, findings);
      }
    }

    return findings;
  }

  /**
   * Detect pattern: transferFrom(user, this, amount); totalAssets += amount;
   * This breaks on fee-on-transfer tokens where the actual received amount is less.
   */
  private checkFeeOnTransferBug(
    context: AnalysisContext,
    contract: any,
    fn: any,
    body: any,
    findings: Finding[]
  ): void {
    const stateVarNames = new Set(contract.stateVariables.map((v: any) => v.name));

    walkAST(body, (node: any) => {
      if (node.type !== 'FunctionCall') return;
      const expr = node.expression;
      if (expr?.type !== 'MemberAccess') return;
      if (expr.memberName !== 'transferFrom' && expr.memberName !== 'safeTransferFrom') return;

      // Find the amount argument (3rd arg: from, to, amount)
      const args = node.arguments || [];
      if (args.length < 3) return;
      const amountArg = args[2];
      const amountName = this.getIdentifierName(amountArg);
      if (!amountName) return;

      // Check if the SAME amount variable is added to a state variable
      // AFTER the transferFrom call
      let addedToState = false;
      walkAST(body, (inner: any) => {
        if (
          inner.type === 'BinaryOperation' &&
          inner.operator === '+=' &&
          inner.left?.type === 'Identifier' &&
          stateVarNames.has(inner.left.name)
        ) {
          // Check if right-hand side references the same amount variable
          walkAST(inner.right, (r: any) => {
            if (r.type === 'Identifier' && r.name === amountName) {
              addedToState = true;
            }
          });
        }
      });

      // Check if there's a balance diff pattern — indicates author IS handling FoT
      const hasBalanceDiff = this.hasBalanceDifferencePattern(body);

      if (addedToState && !hasBalanceDiff) {
        findings.push(
          this.createFinding(context, {
            title: `Fee-on-transfer incompatibility in ${contract.name}.${fn.name}()`,
            description:
              `Function ${fn.name}() calls transferFrom() and then adds the nominal amount ` +
              `'${amountName}' to a state variable. This is incorrect for fee-on-transfer tokens ` +
              `(e.g., SAFEMOON, some BSC tokens) that deduct a fee on every transfer. The ` +
              `contract will track a higher balance than it actually holds, causing accounting ` +
              `errors and eventually failed withdrawals.`,
            severity: Severity.MEDIUM,
            confidence: Confidence.MEDIUM,
            node: fn.node,
            recommendation:
              'Measure the actual received amount:\n' +
              '  uint256 balanceBefore = token.balanceOf(address(this));\n' +
              '  token.safeTransferFrom(msg.sender, address(this), amount);\n' +
              '  uint256 received = token.balanceOf(address(this)) - balanceBefore;\n' +
              '  // Use `received` instead of `amount` for accounting.\n' +
              'Alternatively, explicitly disallow fee-on-transfer tokens in documentation ' +
              'and require strict token whitelisting.',
            references: [
              'https://github.com/d-xo/weird-erc20#fee-on-transfer',
            ],
          })
        );
      }
    });
  }

  /**
   * Detect approve() without reset-to-zero for non-standard tokens like USDT.
   */
  private checkApproveResetIssue(
    context: AnalysisContext,
    contract: any,
    fn: any,
    body: any,
    findings: Finding[]
  ): void {
    // Find approve calls where the amount is non-zero
    walkAST(body, (node: any) => {
      if (node.type !== 'FunctionCall') return;
      const expr = node.expression;
      if (expr?.type !== 'MemberAccess') return;
      if (expr.memberName !== 'approve') return;

      const args = node.arguments || [];
      if (args.length !== 2) return;

      // Only flag if the approve is to an external contract (not internal token math)
      // Heuristic: the receiver is the contract we're calling approve on
      // And the amount is not clearly zero
      const amountArg = args[1];
      if (amountArg?.type === 'NumberLiteral' && amountArg.number === '0') return;

      // Check if this is wrapped in safeApprove (which handles reset)
      // Walk up — if parent is a call to safeApprove/forceApprove, skip
      // (Hard to do without parent tracking, so we check if safeApprove is used elsewhere)
      const usesSafeApprove = this.usesSafeApprove(fn);
      if (usesSafeApprove) return;

      findings.push(
        this.createFinding(context, {
          title: `Unsafe approve() without reset in ${contract.name}.${fn.name}()`,
          description:
            `Direct approve() call with non-zero amount. Some tokens (notably USDT on mainnet) ` +
            `revert if the current allowance is non-zero and you try to set it to another ` +
            `non-zero value. This causes the approve to fail permanently.`,
          severity: Severity.MEDIUM,
          confidence: Confidence.LOW,
          node,
          recommendation:
            'Use OpenZeppelin SafeERC20 safeApprove() or forceApprove(), which resets to 0 first:\n' +
            '  token.safeApprove(spender, 0);\n' +
            '  token.safeApprove(spender, amount);',
          references: [
            'https://github.com/d-xo/weird-erc20#approval-race-protections',
          ],
        })
      );
    });
  }

  /**
   * Detect reliance on balanceOf() for critical accounting.
   * Rebasing tokens change balanceOf without transfers, breaking invariants.
   */
  private checkBalanceAssumption(
    context: AnalysisContext,
    contract: any,
    fn: any,
    body: any,
    findings: Finding[]
  ): void {
    // Skip if function name suggests it's a balance query
    if (fn.name.toLowerCase().includes('balance')) return;

    // Look for balanceOf used in require/assert with a specific value
    walkAST(body, (node: any) => {
      if (node.type !== 'FunctionCall') return;
      const expr = node.expression;
      if (expr?.type !== 'Identifier' || expr.name !== 'require') return;

      // Walk into the require to find balanceOf == X pattern
      walkAST(node, (inner: any) => {
        if (
          inner.type === 'BinaryOperation' &&
          inner.operator === '=='
        ) {
          const hasBalanceOf = this.containsBalanceOf(inner.left) || this.containsBalanceOf(inner.right);
          if (hasBalanceOf) {
            findings.push(
              this.createFinding(context, {
                title: `Equality check on balanceOf() in ${contract.name}.${fn.name}()`,
                description:
                  `The function checks balanceOf() against an exact value using ==. ` +
                  `This breaks for rebasing tokens (e.g., stETH, AMPL) whose balances change ` +
                  `over time without transfers. It also breaks for fee-on-transfer tokens ` +
                  `whose received amount differs from the sent amount.`,
                severity: Severity.MEDIUM,
                confidence: Confidence.LOW,
                node: inner,
                recommendation:
                  'Use >= instead of == when checking balances. Avoid storing balance snapshots ' +
                  'in state; re-read balanceOf() when needed. For rebasing tokens, track shares ' +
                  'instead of raw balances.',
              })
            );
          }
        }
      });
    });
  }

  private hasBalanceDifferencePattern(body: any): boolean {
    // Look for: uint256 before = token.balanceOf(this); ... uint256 after = token.balanceOf(this);
    let beforeCount = 0;
    walkAST(body, (node: any) => {
      if (node.type === 'FunctionCall' && node.expression?.type === 'MemberAccess') {
        if (node.expression.memberName === 'balanceOf') {
          beforeCount++;
        }
      }
    });
    // Two or more balanceOf calls in the same function suggest diff tracking
    return beforeCount >= 2;
  }

  private usesSafeApprove(fn: any): boolean {
    // Check if the function (or contract level) uses SafeERC20
    // This is a weak heuristic — if any call in the function is safeApprove, assume safe practices
    let found = false;
    walkAST(fn.node, (node: any) => {
      if (node.type === 'FunctionCall' && node.expression?.type === 'MemberAccess') {
        const member = node.expression.memberName;
        if (member === 'safeApprove' || member === 'forceApprove') {
          found = true;
        }
      }
    });
    return found;
  }

  private containsBalanceOf(node: any): boolean {
    if (!node) return false;
    let found = false;
    walkAST(node, (n: any) => {
      if (found) return;
      if (n.type === 'FunctionCall' && n.expression?.type === 'MemberAccess') {
        if (n.expression.memberName === 'balanceOf') found = true;
      }
    });
    return found;
  }

  private getIdentifierName(node: any): string | null {
    if (!node) return null;
    if (node.type === 'Identifier') return node.name;
    return null;
  }
}
