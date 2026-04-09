import { BaseDetector } from './base';
import { AnalysisContext } from '../core/context';
import { Finding, Severity, Confidence, VulnerabilityCategory } from '../core/types';
import { walkAST } from '../utils/ast-helpers';

/**
 * Detects denial-of-service vulnerability patterns.
 *
 * Checks for:
 * 1. Unbounded loops (loops over dynamic arrays)
 * 2. External calls inside loops (single failure blocks everyone)
 * 3. Block gas limit issues
 * 4. Unexpected revert in loops
 */
export class DOSVectorsDetector extends BaseDetector {
  readonly id = 'dos-vectors';
  readonly name = 'Denial of Service Vectors';
  readonly description = 'Detects patterns that could lead to denial-of-service vulnerabilities';
  readonly category = VulnerabilityCategory.DOS;
  readonly defaultSeverity = Severity.MEDIUM;

  detect(context: AnalysisContext): Finding[] {
    const findings: Finding[] = [];

    for (const contract of context.contracts) {
      if (contract.kind === 'interface' || contract.kind === 'library') continue;

      const stateArrays = new Set(
        contract.stateVariables
          .filter(v => v.typeName.includes('[]'))
          .map(v => v.name)
      );

      for (const fn of contract.functions) {
        if (!fn.hasBody) continue;
        const body = (fn.node as any).body;
        if (!body) continue;

        this.checkUnboundedLoops(context, contract.name, fn.name, body, stateArrays, findings);
        this.checkExternalCallsInLoops(context, contract.name, fn.name, body, findings);
      }
    }

    return findings;
  }

  private checkUnboundedLoops(
    context: AnalysisContext,
    contractName: string,
    fnName: string,
    body: any,
    stateArrays: Set<string>,
    findings: Finding[]
  ): void {
    walkAST(body, (node: any) => {
      if (node.type !== 'ForStatement') return;

      // Check if loop bound references a state array's length
      const condition = node.conditionExpression;
      if (!condition) return;

      let loopsOverStateArray = false;
      let arrayName = '';

      walkAST(condition, (inner: any) => {
        if (
          inner.type === 'MemberAccess' &&
          inner.memberName === 'length' &&
          inner.expression?.type === 'Identifier' &&
          stateArrays.has(inner.expression.name)
        ) {
          loopsOverStateArray = true;
          arrayName = inner.expression.name;
        }
      });

      if (loopsOverStateArray) {
        findings.push(
          this.createFinding(context, {
            title: `Unbounded loop over ${arrayName} in ${contractName}.${fnName}()`,
            description:
              `A for loop iterates over the state array '${arrayName}' whose length can grow unboundedly. ` +
              `If the array grows large enough, the loop will exceed the block gas limit, ` +
              `making the function permanently uncallable (DoS).`,
            severity: Severity.HIGH,
            confidence: Confidence.HIGH,
            node,
            recommendation:
              'Implement pagination or set a maximum array size. Consider using a pull-over-push ' +
              'pattern where each user claims their own items instead of iterating over all users.',
            references: [
              'https://swcregistry.io/docs/SWC-128',
            ],
          })
        );
      }
    });
  }

  private checkExternalCallsInLoops(
    context: AnalysisContext,
    contractName: string,
    fnName: string,
    body: any,
    findings: Finding[]
  ): void {
    walkAST(body, (node: any) => {
      const isLoop =
        node.type === 'ForStatement' ||
        node.type === 'WhileStatement' ||
        node.type === 'DoWhileStatement';
      if (!isLoop) return;

      const loopBody = node.body;
      if (!loopBody) return;

      walkAST(loopBody, (inner: any) => {
        if (inner.type !== 'FunctionCall') return;

        // Resolve MemberAccess through NameValueExpression wrapper
        const expr = inner.expression;
        let memberAccess: any = null;
        if (expr?.type === 'MemberAccess') {
          memberAccess = expr;
        } else if (expr?.type === 'NameValueExpression' && expr.expression?.type === 'MemberAccess') {
          memberAccess = expr.expression;
        }
        if (!memberAccess) return;

        const member = memberAccess.memberName;
        if (['transfer', 'send', 'call'].includes(member)) {
          findings.push(
            this.createFinding(context, {
              title: `External call inside loop in ${contractName}.${fnName}()`,
              description:
                `An external call (.${member}()) is made inside a loop. If any single call fails ` +
                `(e.g., a recipient contract reverts), the entire transaction fails, blocking ` +
                `all other recipients. This is a classic DoS vector.`,
              severity: member === 'transfer' ? Severity.HIGH : Severity.MEDIUM,
              confidence: Confidence.HIGH,
              node: inner,
              recommendation:
                'Use the pull-over-push pattern: record amounts owed and let recipients ' +
                'withdraw individually. If push is necessary, use .call() with error handling ' +
                'to prevent a single failure from blocking the loop.',
              references: [
                'https://swcregistry.io/docs/SWC-113',
              ],
            })
          );
        }
      });
    });
  }
}
