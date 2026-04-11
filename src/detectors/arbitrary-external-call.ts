import { BaseDetector } from './base';
import { AnalysisContext } from '../core/context';
import { Finding, Severity, Confidence, VulnerabilityCategory } from '../core/types';
import { walkAST } from '../utils/ast-helpers';

const ARBITRARY_CALL = 'Arbitrary External Call' as VulnerabilityCategory;

/**
 * Detects functions that allow an attacker to make an arbitrary external call.
 *
 * Pattern: target.call(data) where BOTH target AND data are user-supplied.
 * This is effectively "run any code as the contract". Consequences:
 *   - Spoofing msg.sender: attacker can call another contract that trusts this one
 *   - Stealing approved tokens: call token.transferFrom() with this contract as owner
 *   - Draining proxy funds: call arbitrary logic from a proxy's context
 *
 * Famous case: Furucombo proxy attack ($14M), where the attacker made the
 * Furucombo proxy call a malicious "handler" that stole user tokens.
 */
export class ArbitraryExternalCallDetector extends BaseDetector {
  readonly id = 'arbitrary-external-call';
  readonly name = 'Arbitrary External Call';
  readonly description = 'Detects functions that allow arbitrary target + calldata from user input';
  readonly category = ARBITRARY_CALL;
  readonly defaultSeverity = Severity.HIGH;

  detect(context: AnalysisContext): Finding[] {
    const findings: Finding[] = [];

    for (const contract of context.contracts) {
      if (contract.kind === 'interface' || contract.kind === 'library') continue;

      for (const fn of contract.functions) {
        if (!fn.hasBody) continue;
        if (!context.isExternallyCallable(fn)) continue;

        const body = (fn.node as any).body;
        if (!body) continue;

        this.checkArbitraryCall(context, contract, fn, body, findings);
      }
    }

    return findings;
  }

  private checkArbitraryCall(
    context: AnalysisContext,
    contract: any,
    fn: any,
    body: any,
    findings: Finding[]
  ): void {
    const paramNames = new Set(fn.parameters.map((p: any) => p.name));
    if (paramNames.size === 0) return;

    // Find .call(data) where data references a parameter and the target is also a parameter
    walkAST(body, (node: any) => {
      if (node.type !== 'FunctionCall') return;

      // Handle .call{value: x}(data) and .call(data)
      const expr = node.expression;
      let target: any = null;
      let member: string | null = null;
      if (expr?.type === 'MemberAccess') {
        target = expr.expression;
        member = expr.memberName;
      } else if (expr?.type === 'NameValueExpression' && expr.expression?.type === 'MemberAccess') {
        target = expr.expression.expression;
        member = expr.expression.memberName;
      }

      if (!target || !['call', 'delegatecall', 'staticcall'].includes(member || '')) return;

      // Check if target references a function parameter
      const targetFromParam = this.referencesParam(target, paramNames);
      if (!targetFromParam) return;

      // Check if any argument (data) references a function parameter
      const args = node.arguments || [];
      let dataFromParam = false;
      for (const arg of args) {
        if (this.referencesParam(arg, paramNames)) {
          dataFromParam = true;
          break;
        }
      }

      if (dataFromParam) {
        const severity = member === 'delegatecall' ? Severity.CRITICAL : Severity.HIGH;
        findings.push(
          this.createFinding(context, {
            title: `Arbitrary ${member} in ${contract.name}.${fn.name}()`,
            description:
              `Function ${fn.name}() allows the caller to specify both the target address ` +
              `AND the calldata for an external ${member}. An attacker can use this to:\n` +
              `  - Make the contract call arbitrary functions on any address\n` +
              `  - Steal tokens approved to this contract\n` +
              `  - Spoof msg.sender to bypass access controls in other contracts\n` +
              (member === 'delegatecall'
                ? `  - CRITICAL: Execute arbitrary code in this contract's storage context`
                : ''),
            severity,
            confidence: Confidence.HIGH,
            node,
            recommendation:
              'Restrict either the target or the calldata:\n' +
              '1. Whitelist allowed target addresses\n' +
              '2. Use a predefined function selector with only user-specified arguments\n' +
              '3. Never combine arbitrary target + arbitrary data in a single call',
            references: [
              'https://medium.com/dedaub/furucombo-post-mortem-analysis-c5b3e8ff9cd',
            ],
          })
        );
      }
    });
  }

  private referencesParam(node: any, paramNames: Set<unknown>): boolean {
    if (!node) return false;
    let found = false;
    walkAST(node, (inner: any) => {
      if (found) return;
      if (inner.type === 'Identifier' && paramNames.has(inner.name)) found = true;
    });
    return found;
  }
}
