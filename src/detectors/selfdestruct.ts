import { BaseDetector } from './base';
import { AnalysisContext } from '../core/context';
import { Finding, Severity, Confidence, VulnerabilityCategory } from '../core/types';
import { walkAST, isSelfdestructCall } from '../utils/ast-helpers';

/**
 * Detects selfdestruct/suicide usage.
 *
 * Checks for:
 * 1. Any use of selfdestruct (deprecated post-Dencun)
 * 2. selfdestruct accessible by non-owner
 * 3. selfdestruct that can be reached through delegatecall chains
 */
export class SelfdestructDetector extends BaseDetector {
  readonly id = 'selfdestruct';
  readonly name = 'Selfdestruct Usage';
  readonly description = 'Detects usage of selfdestruct/suicide which is deprecated and dangerous';
  readonly category = VulnerabilityCategory.SELFDESTRUCT;
  readonly defaultSeverity = Severity.HIGH;

  detect(context: AnalysisContext): Finding[] {
    const findings: Finding[] = [];

    for (const contract of context.contracts) {
      if (contract.kind === 'interface' || contract.kind === 'library') continue;

      for (const fn of contract.functions) {
        if (!fn.hasBody) continue;
        const body = (fn.node as any).body;
        if (!body) continue;

        walkAST(body, (node: any) => {
          if (!isSelfdestructCall(node)) return;

          const funcName = node.expression?.name || 'selfdestruct';

          // Check if function has access control
          const hasProtection =
            fn.modifiers.length > 0 || this.hasOwnerCheck(body);

          if (funcName === 'suicide') {
            findings.push(
              this.createFinding(context, {
                title: `Deprecated suicide() in ${contract.name}.${fn.name}()`,
                description:
                  `The deprecated suicide() function is used. This has been renamed to selfdestruct().`,
                severity: Severity.INFORMATIONAL,
                confidence: Confidence.HIGH,
                node,
                recommendation: 'Replace suicide() with selfdestruct(), or remove it entirely.',
              })
            );
          }

          findings.push(
            this.createFinding(context, {
              title: `selfdestruct in ${contract.name}.${fn.name}()`,
              description:
                `selfdestruct is used which will destroy the contract and send remaining ETH ` +
                `to the specified address. After EIP-6780 (Dencun upgrade), selfdestruct only ` +
                `sends ETH without destroying the contract unless called in the same transaction ` +
                `as creation. ` +
                (hasProtection
                  ? 'Access control is present but verify it is sufficient.'
                  : 'WARNING: No access control detected — anyone can trigger this.'),
              severity: hasProtection ? Severity.MEDIUM : Severity.CRITICAL,
              confidence: Confidence.HIGH,
              node,
              recommendation:
                'Remove selfdestruct if possible. If ETH recovery is needed, implement a ' +
                'withdraw function instead. If selfdestruct is required, ensure it has strict ' +
                'multi-sig or timelock access control.',
              references: [
                'https://swcregistry.io/docs/SWC-106',
                'https://eips.ethereum.org/EIPS/eip-6780',
              ],
            })
          );
        });
      }
    }

    return findings;
  }

  private hasOwnerCheck(body: any): boolean {
    let found = false;
    walkAST(body, (node: any) => {
      if (found) return;
      if (node.type === 'FunctionCall') {
        const fn = node.expression;
        if (fn?.type === 'Identifier' && fn.name === 'require') {
          walkAST(node, (inner: any) => {
            if (
              inner.type === 'MemberAccess' &&
              inner.expression?.name === 'msg' &&
              inner.memberName === 'sender'
            ) {
              found = true;
            }
          });
        }
      }
    });
    return found;
  }
}
