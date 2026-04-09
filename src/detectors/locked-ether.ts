import { BaseDetector } from './base';
import { AnalysisContext } from '../core/context';
import { Finding, Severity, Confidence, VulnerabilityCategory } from '../core/types';
import { walkAST } from '../utils/ast-helpers';

// Extend the category enum at runtime
const LOCKED_ETHER = 'Locked Ether' as VulnerabilityCategory;

/**
 * Detects contracts that can receive ETH but have no way to withdraw it.
 *
 * Checks for:
 * 1. Payable functions or receive()/fallback() without corresponding withdraw
 * 2. No transfer/send/call outgoing in any function
 * 3. Contracts inheriting payable but lacking extraction mechanism
 */
export class LockedEtherDetector extends BaseDetector {
  readonly id = 'locked-ether';
  readonly name = 'Locked Ether';
  readonly description = 'Detects contracts that can receive ETH but have no mechanism to withdraw it';
  readonly category = LOCKED_ETHER;
  readonly defaultSeverity = Severity.HIGH;

  detect(context: AnalysisContext): Finding[] {
    const findings: Finding[] = [];

    for (const contract of context.contracts) {
      if (contract.kind === 'interface' || contract.kind === 'library') continue;

      const canReceiveEth = this.canReceiveEther(contract);
      if (!canReceiveEth) continue;

      const canSendEth = this.canSendEther(contract, context);
      if (canSendEth) continue;

      findings.push(
        this.createFinding(context, {
          title: `Locked Ether in ${contract.name}`,
          description:
            `Contract ${contract.name} can receive ETH (via ${this.getReceiveMechanism(contract)}) ` +
            `but has no function that sends ETH out (no .transfer(), .send(), or .call{value}()). ` +
            `Any ETH sent to this contract will be permanently locked.`,
          severity: Severity.HIGH,
          confidence: Confidence.MEDIUM,
          node: contract.node,
          recommendation:
            'Add a withdraw function with appropriate access control, or remove the ability ' +
            'to receive ETH if it is not needed. Example:\n' +
            'function withdraw() external onlyOwner {\n' +
            '    (bool s,) = msg.sender.call{value: address(this).balance}("");\n' +
            '    require(s);\n' +
            '}',
        })
      );
    }

    return findings;
  }

  private canReceiveEther(contract: any): boolean {
    // Has receive() or fallback()
    if (contract.functions.some((f: any) => f.isReceive || f.isFallback)) return true;

    // Has payable functions
    if (contract.functions.some((f: any) => f.stateMutability === 'payable')) return true;

    return false;
  }

  private canSendEther(contract: any, context: AnalysisContext): boolean {
    for (const fn of contract.functions) {
      if (!fn.hasBody) continue;
      const body = (fn.node as any).body;
      if (!body) continue;

      let sends = false;
      walkAST(body, (node: any) => {
        if (sends) return;
        if (node.type === 'FunctionCall') {
          const expr = node.expression;
          // .transfer() or .send()
          if (expr?.type === 'MemberAccess' && ['transfer', 'send'].includes(expr.memberName)) {
            sends = true;
          }
          // .call{value: ...}()
          if (expr?.type === 'NameValueExpression' && expr.expression?.type === 'MemberAccess') {
            if (expr.expression.memberName === 'call') {
              sends = true;
            }
          }
        }
        // selfdestruct also sends ether
        if (node.type === 'FunctionCall') {
          const fn = node.expression;
          if (fn?.type === 'Identifier' && (fn.name === 'selfdestruct' || fn.name === 'suicide')) {
            sends = true;
          }
        }
      });

      if (sends) return true;
    }
    return false;
  }

  private getReceiveMechanism(contract: any): string {
    const mechanisms: string[] = [];
    if (contract.functions.some((f: any) => f.isReceive)) mechanisms.push('receive()');
    if (contract.functions.some((f: any) => f.isFallback)) mechanisms.push('fallback()');
    const payableFns = contract.functions
      .filter((f: any) => f.stateMutability === 'payable' && !f.isReceive && !f.isFallback)
      .map((f: any) => `${f.name}()`);
    if (payableFns.length > 0) mechanisms.push(...payableFns);
    return mechanisms.join(', ');
  }
}
