import { BaseDetector } from './base';
import { AnalysisContext } from '../core/context';
import { Finding, Severity, Confidence, VulnerabilityCategory } from '../core/types';
import { walkAST, isLowLevelCall, isSendCall } from '../utils/ast-helpers';

/**
 * Detects unchecked return values from external calls.
 *
 * Checks for:
 * 1. .call() without checking the bool return
 * 2. .send() without checking the bool return
 * 3. Low-level calls whose return is silently discarded
 * 4. ERC-20 transfer/transferFrom without return value check
 */
export class UncheckedCallsDetector extends BaseDetector {
  readonly id = 'unchecked-calls';
  readonly name = 'Unchecked External Calls';
  readonly description = 'Detects external calls whose return values are not checked';
  readonly category = VulnerabilityCategory.UNCHECKED_CALLS;
  readonly defaultSeverity = Severity.HIGH;

  detect(context: AnalysisContext): Finding[] {
    const findings: Finding[] = [];

    for (const contract of context.contracts) {
      if (contract.kind === 'interface' || contract.kind === 'library') continue;

      for (const fn of contract.functions) {
        if (!fn.hasBody) continue;
        const body = (fn.node as any).body;
        if (!body) continue;

        this.checkUncheckedLowLevelCalls(context, contract.name, fn.name, body, findings);
        this.checkUncheckedERC20(context, contract.name, fn.name, body, findings);
      }
    }

    return findings;
  }

  private checkUncheckedLowLevelCalls(
    context: AnalysisContext,
    contractName: string,
    fnName: string,
    body: any,
    findings: Finding[]
  ): void {
    walkAST(body, (node: any, parent: any) => {
      if (!isLowLevelCall(node) && !isSendCall(node)) return;

      const memberName = node.expression?.memberName || 'call';

      // Check if the call is within an ExpressionStatement (return value discarded)
      if (parent?.type === 'ExpressionStatement') {
        findings.push(
          this.createFinding(context, {
            title: `Unchecked .${memberName}() in ${contractName}.${fnName}()`,
            description:
              `The return value of .${memberName}() is not checked. ` +
              `If the call fails, execution will continue silently, potentially leading to ` +
              `loss of funds or inconsistent state.`,
            severity: memberName === 'call' ? Severity.HIGH : Severity.MEDIUM,
            confidence: Confidence.HIGH,
            node,
            recommendation:
              memberName === 'call'
                ? 'Check the boolean return value: `(bool success, ) = addr.call{value: amount}(""); require(success);`'
                : `Check the return value of .${memberName}() or use .transfer() which reverts on failure.`,
            references: [
              'https://swcregistry.io/docs/SWC-104',
            ],
          })
        );
        return;
      }

      // Check if result is assigned but the bool is not checked
      if (parent?.type === 'VariableDeclarationStatement') {
        // (bool success, bytes memory data) = ... -> check if success is used in require
        const variables = parent.variables || [];
        const boolVar = variables[0];
        if (boolVar && !this.isBoolChecked(boolVar.name, body)) {
          findings.push(
            this.createFinding(context, {
              title: `Return value of .${memberName}() not verified in ${contractName}.${fnName}()`,
              description:
                `The boolean return value of .${memberName}() is captured but never checked with require() or an if statement.`,
              severity: Severity.MEDIUM,
              confidence: Confidence.MEDIUM,
              node,
              recommendation:
                'Add `require(success, "Call failed");` after the low-level call.',
            })
          );
        }
      }
    });
  }

  private checkUncheckedERC20(
    context: AnalysisContext,
    contractName: string,
    fnName: string,
    body: any,
    findings: Finding[]
  ): void {
    walkAST(body, (node: any, parent: any) => {
      if (node.type !== 'FunctionCall') return;
      const expr = node.expression;
      if (expr?.type !== 'MemberAccess') return;

      const memberName = expr.memberName;
      if (!['transfer', 'transferFrom', 'approve'].includes(memberName)) return;

      // Skip ETH transfer (address.transfer)
      if (memberName === 'transfer' && node.arguments?.length === 1) return;

      // Check if used as expression statement (return not checked)
      if (parent?.type === 'ExpressionStatement') {
        findings.push(
          this.createFinding(context, {
            title: `Unchecked ERC-20 ${memberName}() in ${contractName}.${fnName}()`,
            description:
              `The return value of ERC-20 ${memberName}() is not checked. ` +
              `Some tokens (e.g., USDT) do not revert on failure but return false. ` +
              `Ignoring the return value can lead to silent failures and fund loss.`,
            severity: Severity.HIGH,
            confidence: Confidence.MEDIUM,
            node,
            recommendation:
              `Use OpenZeppelin SafeERC20 library: safeTransfer(), safeTransferFrom(), or safeApprove() ` +
              `which handle non-standard return values correctly.`,
            references: [
              'https://docs.openzeppelin.com/contracts/4.x/api/token/erc20#SafeERC20',
            ],
          })
        );
      }
    });
  }

  private isBoolChecked(varName: string, body: any): boolean {
    let checked = false;
    walkAST(body, (node: any) => {
      if (checked) return;
      // require(success)
      if (node.type === 'FunctionCall') {
        const fn = node.expression;
        if (fn?.type === 'Identifier' && (fn.name === 'require' || fn.name === 'assert')) {
          walkAST(node, (inner: any) => {
            if (inner.type === 'Identifier' && inner.name === varName) {
              checked = true;
            }
          });
        }
      }
      // if (!success) revert
      if (node.type === 'IfStatement') {
        walkAST(node.condition, (inner: any) => {
          if (inner.type === 'Identifier' && inner.name === varName) {
            checked = true;
          }
        });
      }
    });
    return checked;
  }
}
