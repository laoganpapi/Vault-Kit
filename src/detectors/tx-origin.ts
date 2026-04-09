import { BaseDetector } from './base';
import { AnalysisContext } from '../core/context';
import { Finding, Severity, Confidence, VulnerabilityCategory } from '../core/types';
import { walkAST, isTxOrigin } from '../utils/ast-helpers';

/**
 * Detects use of tx.origin for authentication.
 *
 * tx.origin returns the original sender of the transaction, not the immediate caller.
 * Using it for authentication is vulnerable to phishing attacks where a malicious
 * contract tricks a user into calling it, then uses the user's tx.origin identity.
 */
export class TxOriginDetector extends BaseDetector {
  readonly id = 'tx-origin';
  readonly name = 'tx.origin Authentication';
  readonly description = 'Detects use of tx.origin for authorization, which is vulnerable to phishing attacks';
  readonly category = VulnerabilityCategory.TX_ORIGIN;
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
          // tx.origin in require/assert
          if (node.type === 'FunctionCall') {
            const expr = node.expression;
            if (expr?.type === 'Identifier' && (expr.name === 'require' || expr.name === 'assert')) {
              let hasTxOrigin = false;
              walkAST(node, (inner: any) => {
                if (isTxOrigin(inner)) hasTxOrigin = true;
              });
              if (hasTxOrigin) {
                findings.push(
                  this.createFinding(context, {
                    title: `tx.origin used for authentication in ${contract.name}.${fn.name}()`,
                    description:
                      `tx.origin is used in a require/assert statement for authentication. ` +
                      `This is vulnerable to phishing attacks: a malicious contract can trick a user ` +
                      `into calling it, then forward the call to this contract using the user's tx.origin.`,
                    severity: Severity.HIGH,
                    confidence: Confidence.HIGH,
                    node,
                    recommendation:
                      'Replace tx.origin with msg.sender for authentication. ' +
                      'tx.origin should only be used to determine if the caller is an EOA (tx.origin == msg.sender).',
                    references: [
                      'https://swcregistry.io/docs/SWC-115',
                    ],
                  })
                );
              }
            }
          }

          // tx.origin in if condition
          if (node.type === 'IfStatement') {
            let hasTxOrigin = false;
            walkAST(node.condition, (inner: any) => {
              if (isTxOrigin(inner)) hasTxOrigin = true;
            });
            if (hasTxOrigin) {
              // Check if it's the safe pattern: tx.origin == msg.sender
              if (!this.isSafePattern(node.condition)) {
                findings.push(
                  this.createFinding(context, {
                    title: `tx.origin used in conditional in ${contract.name}.${fn.name}()`,
                    description:
                      `tx.origin is used in a conditional check. If this is for authorization, ` +
                      `it is vulnerable to phishing attacks.`,
                    severity: Severity.MEDIUM,
                    confidence: Confidence.MEDIUM,
                    node,
                    recommendation:
                      'Use msg.sender instead of tx.origin for authorization. ' +
                      'The only safe use of tx.origin is checking `tx.origin == msg.sender` to verify the caller is an EOA.',
                  })
                );
              }
            }
          }
        });
      }
    }

    return findings;
  }

  /** Check if tx.origin is used in the safe pattern: tx.origin == msg.sender */
  private isSafePattern(condition: any): boolean {
    if (condition.type !== 'BinaryOperation') return false;
    if (condition.operator !== '==' && condition.operator !== '!=') return false;

    const left = condition.left;
    const right = condition.right;

    const isTxOriginLeft = isTxOrigin(left);
    const isTxOriginRight = isTxOrigin(right);
    const isMsgSenderLeft =
      left?.type === 'MemberAccess' && left.expression?.name === 'msg' && left.memberName === 'sender';
    const isMsgSenderRight =
      right?.type === 'MemberAccess' && right.expression?.name === 'msg' && right.memberName === 'sender';

    return (isTxOriginLeft && isMsgSenderRight) || (isTxOriginRight && isMsgSenderLeft);
  }
}
