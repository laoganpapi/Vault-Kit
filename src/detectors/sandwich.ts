import { BaseDetector } from './base';
import { AnalysisContext } from '../core/context';
import { Finding, Severity, Confidence, VulnerabilityCategory } from '../core/types';
import { walkAST } from '../utils/ast-helpers';

const SANDWICH = 'Sandwich Attack Vulnerability' as VulnerabilityCategory;

/**
 * Detects patterns that are highly vulnerable to sandwich attacks.
 *
 * A sandwich attack works like this:
 *   1. Attacker observes a victim's pending swap in the mempool
 *   2. Attacker front-runs with a buy, pushing the price up
 *   3. Victim's swap executes at the inflated price (bad rate)
 *   4. Attacker back-runs with a sell, profiting from the victim's slippage
 *
 * Patterns that enable this:
 *   1. Swap functions without minAmountOut / slippage parameter
 *   2. Swap functions without deadline parameter
 *   3. Use of block.timestamp as the deadline (attacker validators can delay)
 *   4. Price queries from AMM spot reserves for critical logic
 *   5. Auto-compounding strategies that swap on every interaction
 */
export class SandwichDetector extends BaseDetector {
  readonly id = 'sandwich';
  readonly name = 'Sandwich Attack Vulnerability';
  readonly description = 'Detects swap/trade functions vulnerable to sandwich (MEV) attacks';
  readonly category = SANDWICH;
  readonly defaultSeverity = Severity.HIGH;

  detect(context: AnalysisContext): Finding[] {
    const findings: Finding[] = [];

    for (const contract of context.contracts) {
      if (contract.kind === 'interface' || contract.kind === 'library') continue;

      for (const fn of contract.functions) {
        if (!fn.hasBody) continue;
        const body = (fn.node as any).body;
        if (!body) continue;

        // Check if this function interacts with a DEX
        const callsDex = this.callsDexFunction(body);
        if (!callsDex) continue;

        this.checkSwapCallSafety(context, contract, fn, body, findings);
      }
    }

    return findings;
  }

  private callsDexFunction(body: any): boolean {
    let found = false;
    walkAST(body, (node: any) => {
      if (found) return;
      if (node.type === 'FunctionCall') {
        const expr = node.expression;
        if (expr?.type === 'MemberAccess') {
          const member = expr.memberName;
          if (
            ['swapExactTokensForTokens', 'swapTokensForExactTokens',
             'swapExactETHForTokens', 'swapExactTokensForETH',
             'swap', 'exchange', 'swapExactInput', 'swapExactOutput',
             'exactInput', 'exactOutput', 'exactInputSingle',
             'exchangeUnderlying'].includes(member)
          ) {
            found = true;
          }
        }
      }
    });
    return found;
  }

  private checkSwapCallSafety(
    context: AnalysisContext,
    contract: any,
    fn: any,
    body: any,
    findings: Finding[]
  ): void {
    walkAST(body, (node: any) => {
      if (node.type !== 'FunctionCall') return;
      const expr = node.expression;
      if (expr?.type !== 'MemberAccess') return;

      const member = expr.memberName;
      const isSwap = [
        'swapExactTokensForTokens', 'swapTokensForExactTokens',
        'swapExactETHForTokens', 'swapExactTokensForETH',
      ].includes(member);

      if (!isSwap) return;

      const args = node.arguments || [];
      if (args.length < 2) return;

      // For swapExactTokensForTokens: (amountIn, amountOutMin, path, to, deadline)
      // Check amountOutMin (arg 1) — if it's 0, zero, or a constant 0, flag it
      const amountOutMin = args[1];
      if (this.isZeroLiteral(amountOutMin)) {
        findings.push(
          this.createFinding(context, {
            title: `Zero amountOutMin in ${contract.name}.${fn.name}() — MEV exposure`,
            description:
              `Function ${fn.name}() calls ${member}() with amountOutMin = 0 (no slippage protection). ` +
              `An attacker can sandwich this transaction by front-running with a large swap to ` +
              `push the price unfavorably, then back-running to profit. The victim receives ` +
              `whatever amount the attacker chooses to leave them.`,
            severity: Severity.CRITICAL,
            confidence: Confidence.HIGH,
            node,
            recommendation:
              'Compute amountOutMin based on an oracle price (e.g., Chainlink) with acceptable ' +
              'slippage tolerance (typically 0.5%-2%). Never pass 0. Example:\n' +
              '  uint256 expected = oracle.getPrice() * amountIn / 1e18;\n' +
              '  uint256 minOut = expected * (10000 - slippageBps) / 10000;',
          })
        );
      }

      // Check deadline (last arg)
      if (args.length >= 5) {
        const deadline = args[args.length - 1];
        if (this.isBlockTimestamp(deadline)) {
          findings.push(
            this.createFinding(context, {
              title: `Deadline = block.timestamp in ${contract.name}.${fn.name}()`,
              description:
                `Function ${fn.name}() passes block.timestamp as the swap deadline, which means ` +
                `the transaction has no meaningful expiration. A validator can hold the transaction ` +
                `indefinitely and execute it when market conditions are most favorable for them ` +
                `(worst for the user).`,
              severity: Severity.MEDIUM,
              confidence: Confidence.HIGH,
              node,
              recommendation:
                'Use a user-supplied deadline parameter: ' +
                'function swap(..., uint256 deadline) { ... } and pass it through. ' +
                'The deadline should be a short window (e.g., block.timestamp + 15 minutes).',
            })
          );
        }

        if (this.isLargeConstant(deadline)) {
          findings.push(
            this.createFinding(context, {
              title: `Effectively infinite deadline in ${contract.name}.${fn.name}()`,
              description:
                `Function ${fn.name}() passes a very large value (appears to be type(uint256).max or ` +
                `similar) as the swap deadline. This disables deadline protection entirely.`,
              severity: Severity.MEDIUM,
              confidence: Confidence.MEDIUM,
              node,
              recommendation:
                'Use a finite, user-supplied deadline. Never pass max uint256 as a deadline.',
            })
          );
        }
      }
    });

    // Also check for uses of getAmountOut/quote that suggest spot-price reliance
    this.checkSpotPriceComputation(context, contract, fn, body, findings);
  }

  private checkSpotPriceComputation(
    context: AnalysisContext,
    contract: any,
    fn: any,
    body: any,
    findings: Finding[]
  ): void {
    walkAST(body, (node: any) => {
      if (node.type !== 'FunctionCall') return;
      const expr = node.expression;
      if (expr?.type !== 'MemberAccess') return;

      const member = expr.memberName;
      if (['getAmountsOut', 'getAmountOut', 'quote'].includes(member)) {
        // Check if the result is used as amountOutMin input (dangerous)
        // This is a heuristic — just flag for review
        findings.push(
          this.createFinding(context, {
            title: `Spot price query via ${member}() in ${contract.name}.${fn.name}()`,
            description:
              `Function ${fn.name}() calls ${member}() to compute expected output. ` +
              `If this result is used as amountOutMin, it provides NO slippage protection because ` +
              `the spot price can be manipulated within the same transaction by a sandwich attacker.`,
            severity: Severity.HIGH,
            confidence: Confidence.LOW,
            node,
            recommendation:
              'Do not use AMM spot prices (getAmountsOut, getReserves) to compute slippage limits. ' +
              'Use an external oracle (Chainlink, TWAP) as the source of truth for expected prices.',
          })
        );
      }
    });
  }

  private isZeroLiteral(node: any): boolean {
    if (!node) return false;
    if (node.type === 'NumberLiteral' && node.number === '0') return true;
    // Simple identifier named 'zero' or similar
    if (node.type === 'Identifier' && node.name === 'ZERO') return true;
    return false;
  }

  private isBlockTimestamp(node: any): boolean {
    return (
      node?.type === 'MemberAccess' &&
      node.expression?.type === 'Identifier' &&
      node.expression.name === 'block' &&
      node.memberName === 'timestamp'
    );
  }

  private isLargeConstant(node: any): boolean {
    // type(uint256).max
    if (node?.type === 'MemberAccess' && node.memberName === 'max') {
      if (node.expression?.type === 'FunctionCall' && node.expression.expression?.name === 'type') {
        return true;
      }
    }
    // Very large number literals
    if (node?.type === 'NumberLiteral') {
      const n = node.number?.toString() || '';
      if (n.length >= 20) return true;
    }
    return false;
  }
}
