import { BaseDetector } from './base';
import { AnalysisContext } from '../core/context';
import { Finding, Severity, Confidence, VulnerabilityCategory } from '../core/types';
import { walkAST } from '../utils/ast-helpers';

const READONLY_REENTRANCY = 'Read-Only Reentrancy' as VulnerabilityCategory;

/**
 * Detects read-only reentrancy vulnerabilities.
 *
 * Read-only reentrancy occurs when:
 *   1. Function A makes an external call that triggers attacker-controlled code
 *   2. During the call, the attacker calls a view/pure function B
 *   3. Function B returns stale state because A hasn't finished updating it
 *   4. Protocols integrating with B (e.g., for price feeds) use this stale value
 *
 * Famous case: Curve Finance's virtual price could be manipulated during
 * remove_liquidity callbacks, leading to $70M+ in exploits of integrators.
 */
export class ReadOnlyReentrancyDetector extends BaseDetector {
  readonly id = 'readonly-reentrancy';
  readonly name = 'Read-Only Reentrancy';
  readonly description = 'Detects view functions that expose state modifiable by in-progress external calls';
  readonly category = READONLY_REENTRANCY;
  readonly defaultSeverity = Severity.HIGH;

  detect(context: AnalysisContext): Finding[] {
    const findings: Finding[] = [];

    for (const contract of context.contracts) {
      if (contract.kind === 'interface' || contract.kind === 'library') continue;

      // Find state variables that are (a) read by view functions and
      // (b) modified in functions that make external calls
      const stateVarNames = new Set(contract.stateVariables.map((v: any) => v.name));

      // Build set of state vars modified AROUND external calls
      const varsModifiedAroundCalls = this.getVarsAroundExternalCalls(contract, stateVarNames);
      if (varsModifiedAroundCalls.size === 0) continue;

      // For each view function, check if it reads these variables
      for (const fn of contract.functions) {
        if (!fn.hasBody) continue;
        if (fn.stateMutability !== 'view' && fn.stateMutability !== 'pure') continue;
        if (!context.isExternallyCallable(fn)) continue;

        const body = (fn.node as any).body;
        if (!body) continue;

        const readVars: string[] = [];
        walkAST(body, (node: any) => {
          if (node.type === 'Identifier' && varsModifiedAroundCalls.has(node.name)) {
            if (!readVars.includes(node.name)) readVars.push(node.name);
          }
        });

        if (readVars.length > 0) {
          findings.push(
            this.createFinding(context, {
              title: `Potential read-only reentrancy in ${contract.name}.${fn.name}()`,
              description:
                `View function ${fn.name}() reads state variable(s) [${readVars.join(', ')}] ` +
                `that are modified around external calls in non-view functions. During an ` +
                `external call in those functions, an attacker can reenter and query ${fn.name}() ` +
                `to obtain stale data. Integrating protocols that use ${fn.name}() as a price ` +
                `oracle or invariant check can be exploited.`,
              severity: Severity.HIGH,
              confidence: Confidence.LOW,
              node: fn.node,
              recommendation:
                'Apply a nonReentrant modifier to view functions (OpenZeppelin ReentrancyGuard ' +
                'does not support this by default — use a custom implementation that checks ' +
                'but does not modify the reentrancy slot). Alternatively, ensure that all ' +
                'state updates in non-view functions complete before any external calls.',
              references: [
                'https://chainsecurity.com/heartbreaks-curve-lp-oracle-manipulation-post-mortem/',
                'https://medium.com/coinmonks/read-only-reentrancy-explained-9f4bed4dedc7',
              ],
            })
          );
        }
      }
    }

    return findings;
  }

  private getVarsAroundExternalCalls(contract: any, stateVarNames: Set<string>): Set<string> {
    const vars = new Set<string>();

    for (const fn of contract.functions) {
      if (!fn.hasBody) continue;
      if (fn.stateMutability === 'view' || fn.stateMutability === 'pure') continue;

      const body = (fn.node as any).body;
      if (!body?.statements) continue;

      // Check if this function makes external calls
      let hasExternalCall = false;
      walkAST(body, (node: any) => {
        if (node.type === 'FunctionCall') {
          const expr = node.expression;
          const ma = expr?.type === 'MemberAccess'
            ? expr
            : (expr?.type === 'NameValueExpression' ? expr.expression : null);
          if (ma && ['call', 'send', 'transfer', 'delegatecall'].includes(ma.memberName)) {
            hasExternalCall = true;
          }
        }
      });

      if (!hasExternalCall) continue;

      // Collect state variables written in this function
      walkAST(body, (node: any) => {
        if (
          node.type === 'BinaryOperation' &&
          ['=', '+=', '-=', '*=', '/='].includes(node.operator)
        ) {
          const left = node.left;
          if (left?.type === 'Identifier' && stateVarNames.has(left.name)) {
            vars.add(left.name);
          }
          if (left?.type === 'IndexAccess' && left.base?.type === 'Identifier' && stateVarNames.has(left.base.name)) {
            vars.add(left.base.name);
          }
        }
      });
    }

    return vars;
  }
}
