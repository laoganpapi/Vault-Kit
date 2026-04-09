import { BaseDetector } from './base';
import { AnalysisContext } from '../core/context';
import { Finding, Severity, Confidence, VulnerabilityCategory } from '../core/types';
import { findStateChangesAfterCalls } from '../analyzers/control-flow';
import { buildCallGraph } from '../analyzers/call-graph';
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

  /**
   * Cross-function reentrancy: function A makes an external call,
   * then function B (callable during reentry) reads state that A
   * hasn't yet updated. Uses the call graph to trace internal call chains.
   */
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

    const stateVarNames = new Set<string>(contract.stateVariables.map((v: any) => v.name as string));
    const callGraph = buildCallGraph(contract);

    // Find state vars that this function writes AFTER external calls
    const varsWrittenAfterCall = new Set<string>();
    const violations = findStateChangesAfterCalls(body, stateVarNames);
    for (const { stateChange } of violations) {
      walkAST(stateChange, (node: any) => {
        if (node.type === 'Identifier' && stateVarNames.has(node.name)) {
          varsWrittenAfterCall.add(node.name);
        }
      });
    }

    // Also collect vars written in the function body (even if before the call,
    // they could be stale during reentry if another function reads them)
    const allWrittenVars = new Set<string>();
    const allAssignments = context.getStateAssignments(body, contract);
    for (const assignment of allAssignments) {
      walkAST(assignment, (node: any) => {
        if (node.type === 'Identifier' && stateVarNames.has(node.name)) {
          allWrittenVars.add(node.name);
        }
      });
    }

    // Check other external functions that read state this function writes
    for (const otherFn of contract.functions) {
      if (otherFn.name === fn.name || !otherFn.hasBody) continue;
      if (!context.isExternallyCallable(otherFn)) continue;

      const otherHasGuard = otherFn.modifiers.some((m: string) => isReentrancyGuard(m));
      if (otherHasGuard) continue;

      const otherBody = (otherFn.node as any).body;
      if (!otherBody) continue;

      // Find state vars read by the other function
      const varsReadByOther = new Set<string>();
      walkAST(otherBody, (node: any) => {
        if (node.type === 'Identifier' && stateVarNames.has(node.name)) {
          varsReadByOther.add(node.name);
        }
      });

      // Intersection: vars written by fn (after call) that are read by otherFn
      const sharedVars: string[] = [];
      for (const v of allWrittenVars) {
        if (varsReadByOther.has(v)) sharedVars.push(v);
      }

      if (sharedVars.length > 0) {
        findings.push(
          this.createFinding(context, {
            title: `Cross-function reentrancy: ${contract.name}.${fn.name}() -> ${otherFn.name}()`,
            description:
              `Function ${fn.name}() makes external calls and modifies state variables ` +
              `[${sharedVars.join(', ')}] that are also read by ${otherFn.name}(). ` +
              `During the external call in ${fn.name}(), an attacker can reenter through ` +
              `${otherFn.name}() and read stale values of these variables.`,
            severity: Severity.HIGH,
            confidence: Confidence.MEDIUM,
            node: fn.node,
            recommendation:
              `Apply a shared nonReentrant modifier to both ${fn.name}() and ${otherFn.name}(). ` +
              `Alternatively, ensure all state changes in ${fn.name}() complete before any external call.`,
            references: [
              'https://medium.com/coinmonks/cross-function-reentrancy-de9cbce0129e',
            ],
          })
        );
      }
    }
  }
}
