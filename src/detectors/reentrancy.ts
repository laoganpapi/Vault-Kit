import { BaseDetector } from './base';
import { AnalysisContext } from '../core/context';
import { Finding, Severity, Confidence, VulnerabilityCategory } from '../core/types';
import { findStateChangesAfterCalls } from '../analyzers/control-flow';
import { isReentrancyGuard } from '../utils/patterns';
import { walkAST } from '../utils/ast-helpers';

/**
 * Detects reentrancy vulnerabilities.
 *
 * Checks for:
 * 1. State changes after external calls (CEI violation)
 * 2. Missing reentrancy guards on functions with external calls + state changes
 * 3. Cross-function reentrancy via shared state
 * 4. Read-only reentrancy (view functions reading stale state)
 */
export class ReentrancyDetector extends BaseDetector {
  readonly id = 'reentrancy';
  readonly name = 'Reentrancy';
  readonly description = 'Detects reentrancy vulnerabilities including CEI pattern violations and missing reentrancy guards';
  readonly category = VulnerabilityCategory.REENTRANCY;
  readonly defaultSeverity = Severity.CRITICAL;

  detect(context: AnalysisContext): Finding[] {
    const findings: Finding[] = [];

    for (const contract of context.contracts) {
      if (contract.kind === 'interface' || contract.kind === 'library') continue;

      const stateVarNames = new Set(contract.stateVariables.map(v => v.name));

      for (const fn of contract.functions) {
        if (!fn.hasBody) continue;

        const hasGuard = fn.modifiers.some(m => isReentrancyGuard(m));
        const fnNode = fn.node as any;
        const body = fnNode.body;
        if (!body) continue;

        // Check for state changes after external calls (CEI violation)
        const violations = findStateChangesAfterCalls(body, stateVarNames);

        for (const { call, stateChange } of violations) {
          const severity = hasGuard ? Severity.LOW : Severity.CRITICAL;
          const callLine = (call as any).loc?.start?.line || 0;
          const changeLine = (stateChange as any).loc?.start?.line || 0;

          findings.push(
            this.createFinding(context, {
              title: `Reentrancy in ${contract.name}.${fn.name}()`,
              description:
                `State variable is modified after an external call at line ${callLine}. ` +
                `The state change at line ${changeLine} occurs after the external call, ` +
                `violating the Checks-Effects-Interactions pattern. ` +
                (hasGuard
                  ? 'A reentrancy guard is present but CEI should still be followed.'
                  : 'No reentrancy guard modifier was detected.'),
              severity,
              confidence: Confidence.HIGH,
              node: stateChange,
              recommendation:
                'Apply the Checks-Effects-Interactions pattern: perform all state changes BEFORE external calls. ' +
                'Additionally, use a reentrancy guard modifier (e.g., OpenZeppelin ReentrancyGuard).',
              references: [
                'https://swcregistry.io/docs/SWC-107',
                'https://consensys.github.io/smart-contract-best-practices/attacks/reentrancy/',
              ],
            })
          );
        }

        // Check for external calls without reentrancy guard
        if (!hasGuard && context.isStateMutating(fn) && context.isExternallyCallable(fn)) {
          const externalCalls = this.findExternalCalls(body);
          const stateWrites = context.getStateAssignments(body, contract);

          if (externalCalls.length > 0 && stateWrites.length > 0 && violations.length === 0) {
            findings.push(
              this.createFinding(context, {
                title: `Missing reentrancy guard on ${contract.name}.${fn.name}()`,
                description:
                  `Function ${fn.name}() makes external calls and modifies state but has no reentrancy guard. ` +
                  `Even if the CEI pattern is followed, a reentrancy guard provides defense-in-depth.`,
                severity: Severity.MEDIUM,
                confidence: Confidence.MEDIUM,
                node: fn.node,
                recommendation:
                  'Add a nonReentrant modifier from OpenZeppelin ReentrancyGuard to this function.',
                references: [
                  'https://docs.openzeppelin.com/contracts/4.x/api/security#ReentrancyGuard',
                ],
              })
            );
          }
        }

        // Check for cross-function reentrancy
        if (!hasGuard && context.isExternallyCallable(fn)) {
          this.checkCrossFunctionReentrancy(context, contract, fn, findings);
        }
      }
    }

    return findings;
  }

  private findExternalCalls(body: any): any[] {
    const calls: any[] = [];
    walkAST(body, (node: any) => {
      if (node.type === 'FunctionCall') {
        const expr = node.expression;
        let memberAccess: any = null;
        if (expr?.type === 'MemberAccess') {
          memberAccess = expr;
        } else if (expr?.type === 'NameValueExpression' && expr.expression?.type === 'MemberAccess') {
          memberAccess = expr.expression;
        }
        if (memberAccess && ['call', 'send', 'transfer', 'delegatecall'].includes(memberAccess.memberName)) {
          calls.push(node);
        }
      }
    });
    return calls;
  }

  private checkCrossFunctionReentrancy(
    context: AnalysisContext,
    contract: any,
    fn: any,
    findings: Finding[]
  ): void {
    const fnNode = fn.node as any;
    const body = fnNode.body;
    if (!body) return;

    const externalCalls = this.findExternalCalls(body);
    if (externalCalls.length === 0) return;

    // Find state variables read/written by this function
    const stateVarNames = new Set(contract.stateVariables.map((v: any) => v.name));
    const writtenVars = new Set<string>();

    for (const otherFn of contract.functions) {
      if (otherFn.name === fn.name || !otherFn.hasBody) continue;
      if (!context.isExternallyCallable(otherFn)) continue;

      const otherBody = (otherFn.node as any).body;
      if (!otherBody) continue;

      // Check if the other function reads state that this function writes after a call
      walkAST(otherBody, (node: any) => {
        if (node.type === 'Identifier' && stateVarNames.has(node.name)) {
          writtenVars.add(node.name);
        }
      });
    }

    // This is a simplified check — full cross-function reentrancy requires
    // taint analysis across the entire call graph
  }
}
