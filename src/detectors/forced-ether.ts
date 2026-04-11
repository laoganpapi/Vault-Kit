import { BaseDetector } from './base';
import { AnalysisContext } from '../core/context';
import { Finding, Severity, Confidence, VulnerabilityCategory } from '../core/types';
import { walkAST } from '../utils/ast-helpers';

const FORCED_ETHER = 'Forced Ether Balance Assumption' as VulnerabilityCategory;

/**
 * Detects contracts that depend on `address(this).balance` for logic,
 * which can be manipulated via forced ether sends.
 *
 * Attack vectors that force ether into a contract:
 *   1. selfdestruct(target) — sends ETH even if target has no receive/fallback
 *   2. create2-deployed contracts — ETH can be sent to the deterministic address
 *      before the contract is deployed
 *   3. Block/coinbase rewards — miner can set themselves as the contract
 *
 * Common bugs:
 *   - require(address(this).balance == expected) — breaks if attacker sends 1 wei
 *   - Accounting based on balance: profit = balance - lastBalance
 *   - Voting/access based on balance threshold
 */
export class ForcedEtherDetector extends BaseDetector {
  readonly id = 'forced-ether';
  readonly name = 'Forced Ether Balance Assumption';
  readonly description = 'Detects logic that relies on address(this).balance which can be manipulated';
  readonly category = FORCED_ETHER;
  readonly defaultSeverity = Severity.MEDIUM;

  detect(context: AnalysisContext): Finding[] {
    const findings: Finding[] = [];

    for (const contract of context.contracts) {
      if (contract.kind === 'interface' || contract.kind === 'library') continue;

      for (const fn of contract.functions) {
        if (!fn.hasBody) continue;
        const body = (fn.node as any).body;
        if (!body) continue;

        walkAST(body, (node: any) => {
          // require(address(this).balance == X) — strict equality
          if (node.type === 'FunctionCall' && node.expression?.type === 'Identifier') {
            if (node.expression.name !== 'require' && node.expression.name !== 'assert') return;

            let hasThisBalance = false;
            let isEquality = false;

            walkAST(node, (inner: any) => {
              if (inner.type === 'BinaryOperation') {
                if (inner.operator === '==') {
                  isEquality = true;
                }
              }
              if (
                inner.type === 'MemberAccess' &&
                inner.memberName === 'balance'
              ) {
                // Check for address(this).balance
                const target = inner.expression;
                if (
                  target?.type === 'FunctionCall' &&
                  target.expression?.name === 'address' &&
                  target.arguments?.[0]?.type === 'Identifier' &&
                  target.arguments[0].name === 'this'
                ) {
                  hasThisBalance = true;
                }
              }
            });

            if (hasThisBalance && isEquality) {
              findings.push(
                this.createFinding(context, {
                  title: `Forced ether vulnerability in ${contract.name}.${fn.name}()`,
                  description:
                    `Function ${fn.name}() uses equality comparison (==) against address(this).balance. ` +
                    `An attacker can force ether into this contract via selfdestruct or by pre-funding ` +
                    `a deterministic create2 address. This can permanently break the equality check, ` +
                    `locking the contract's functionality.`,
                  severity: Severity.MEDIUM,
                  confidence: Confidence.HIGH,
                  node,
                  recommendation:
                    'Do not use == with address(this).balance. Instead, track expected balance ' +
                    'in an internal accounting variable that is updated by deposits/withdrawals. ' +
                    'Use >= if a minimum balance check is needed.',
                  references: [
                    'https://swcregistry.io/docs/SWC-132',
                  ],
                })
              );
            }
          }
        });
      }
    }

    return findings;
  }
}
