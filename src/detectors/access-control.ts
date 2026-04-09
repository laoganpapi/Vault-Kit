import { BaseDetector } from './base';
import { AnalysisContext } from '../core/context';
import { Finding, Severity, Confidence, VulnerabilityCategory } from '../core/types';
import { isAccessControlModifier, isCriticalFunction } from '../utils/patterns';
import { walkAST, isSelfdestructCall } from '../utils/ast-helpers';

/**
 * Detects access control vulnerabilities.
 *
 * Checks for:
 * 1. Critical functions without access control modifiers
 * 2. Public/external state-changing functions without protection
 * 3. Missing ownership validation
 * 4. Functions that can drain funds without access control
 * 5. Unprotected initializers
 */
export class AccessControlDetector extends BaseDetector {
  readonly id = 'access-control';
  readonly name = 'Access Control';
  readonly description = 'Detects missing or inadequate access control on sensitive functions';
  readonly category = VulnerabilityCategory.ACCESS_CONTROL;
  readonly defaultSeverity = Severity.HIGH;

  detect(context: AnalysisContext): Finding[] {
    const findings: Finding[] = [];

    for (const contract of context.contracts) {
      if (contract.kind === 'interface' || contract.kind === 'library') continue;

      for (const fn of contract.functions) {
        if (!fn.hasBody || fn.isConstructor) continue;
        if (!context.isExternallyCallable(fn)) continue;

        const hasAccessControl = fn.modifiers.some(m => isAccessControlModifier(m));
        const hasRequireSenderCheck = this.hasRequireMsgSender(fn.node);

        if (hasAccessControl || hasRequireSenderCheck) continue;

        // Check for critical named functions without access control
        if (isCriticalFunction(fn.name)) {
          findings.push(
            this.createFinding(context, {
              title: `Unprotected critical function: ${contract.name}.${fn.name}()`,
              description:
                `The function ${fn.name}() is a critical operation that lacks access control. ` +
                `No ownership modifiers (onlyOwner, onlyAdmin, etc.) or msg.sender checks were found. ` +
                `This allows any external account to call this function.`,
              severity: Severity.CRITICAL,
              confidence: Confidence.HIGH,
              node: fn.node,
              recommendation:
                'Add an appropriate access control modifier (e.g., onlyOwner) or implement a ' +
                'role-based access control system using OpenZeppelin AccessControl.',
              references: [
                'https://swcregistry.io/docs/SWC-105',
                'https://docs.openzeppelin.com/contracts/4.x/access-control',
              ],
            })
          );
        }

        // Check for functions that transfer ETH without access control
        if (context.isStateMutating(fn) && this.transfersValue(fn.node)) {
          findings.push(
            this.createFinding(context, {
              title: `Unprotected value transfer in ${contract.name}.${fn.name}()`,
              description:
                `Function ${fn.name}() transfers ETH/tokens but has no access control. ` +
                `Any external caller can trigger this transfer.`,
              severity: Severity.HIGH,
              confidence: Confidence.MEDIUM,
              node: fn.node,
              recommendation:
                'Add access control to functions that transfer value. Consider using ' +
                'OpenZeppelin Ownable or AccessControl.',
            })
          );
        }

        // Check for selfdestruct without access control
        if (this.hasSelfDestruct(fn.node)) {
          findings.push(
            this.createFinding(context, {
              title: `Unprotected selfdestruct in ${contract.name}.${fn.name}()`,
              description:
                `Function ${fn.name}() contains selfdestruct without access control. ` +
                `Any caller can destroy this contract.`,
              severity: Severity.CRITICAL,
              confidence: Confidence.HIGH,
              node: fn.node,
              recommendation:
                'Add strict access control to any function containing selfdestruct. ' +
                'Consider removing selfdestruct entirely as it is deprecated in newer EVM versions.',
            })
          );
        }

        // Unprotected initializers
        if (fn.name.toLowerCase() === 'initialize' || fn.name.toLowerCase() === 'init') {
          if (!this.hasInitializerGuard(fn)) {
            findings.push(
              this.createFinding(context, {
                title: `Unprotected initializer in ${contract.name}.${fn.name}()`,
                description:
                  `The initializer function ${fn.name}() has no access control and no initializer guard. ` +
                  `It could be called multiple times or by unauthorized accounts.`,
                severity: Severity.CRITICAL,
                confidence: Confidence.HIGH,
                node: fn.node,
                recommendation:
                  'Use OpenZeppelin Initializable modifier (initializer) to prevent re-initialization, ' +
                  'and add access control if needed.',
                references: [
                  'https://docs.openzeppelin.com/contracts/4.x/api/proxy#Initializable',
                ],
              })
            );
          }
        }
      }
    }

    return findings;
  }

  private hasRequireMsgSender(fnNode: any): boolean {
    let found = false;
    walkAST(fnNode, (node: any) => {
      if (found) return;
      // require(msg.sender == ...)
      if (node.type === 'FunctionCall') {
        const expr = node.expression;
        if (expr?.type === 'Identifier' && (expr.name === 'require' || expr.name === 'assert')) {
          walkAST(node, (inner: any) => {
            if (
              inner.type === 'MemberAccess' &&
              inner.expression?.type === 'Identifier' &&
              inner.expression.name === 'msg' &&
              inner.memberName === 'sender'
            ) {
              found = true;
            }
          });
        }
      }
      // if (msg.sender != ...) revert
      if (node.type === 'IfStatement') {
        walkAST(node.condition, (inner: any) => {
          if (
            inner.type === 'MemberAccess' &&
            inner.expression?.type === 'Identifier' &&
            inner.expression.name === 'msg' &&
            inner.memberName === 'sender'
          ) {
            found = true;
          }
        });
      }
    });
    return found;
  }

  private transfersValue(fnNode: any): boolean {
    let found = false;
    walkAST(fnNode, (node: any) => {
      if (found) return;
      if (node.type === 'FunctionCall') {
        const expr = node.expression;
        let memberAccess: any = null;
        if (expr?.type === 'MemberAccess') {
          memberAccess = expr;
        } else if (expr?.type === 'NameValueExpression' && expr.expression?.type === 'MemberAccess') {
          memberAccess = expr.expression;
        }
        if (memberAccess && ['transfer', 'send', 'call'].includes(memberAccess.memberName)) {
          found = true;
        }
      }
    });
    return found;
  }

  private hasSelfDestruct(fnNode: any): boolean {
    let found = false;
    walkAST(fnNode, (node: any) => {
      if (isSelfdestructCall(node)) found = true;
    });
    return found;
  }

  private hasInitializerGuard(fn: any): boolean {
    return fn.modifiers.some(
      (m: string) => m.toLowerCase() === 'initializer' || m.toLowerCase() === 'reinitializer'
    );
  }
}
