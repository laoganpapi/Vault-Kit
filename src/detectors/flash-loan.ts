import { BaseDetector } from './base';
import { AnalysisContext } from '../core/context';
import { Finding, Severity, Confidence, VulnerabilityCategory } from '../core/types';
import { walkAST } from '../utils/ast-helpers';
import { FLASH_LOAN_CALLBACKS } from '../utils/patterns';

/**
 * Detects flash loan attack vectors.
 *
 * Checks for:
 * 1. Token balance used for price or access control (manipulable via flash loans)
 * 2. Missing flash loan guards on callback functions
 * 3. Spot price reliance (vs TWAP)
 * 4. Balance-dependent access control
 */
export class FlashLoanDetector extends BaseDetector {
  readonly id = 'flash-loan';
  readonly name = 'Flash Loan Attack Vectors';
  readonly description = 'Detects patterns that are vulnerable to flash loan manipulation';
  readonly category = VulnerabilityCategory.FLASH_LOAN;
  readonly defaultSeverity = Severity.HIGH;

  detect(context: AnalysisContext): Finding[] {
    const findings: Finding[] = [];

    for (const contract of context.contracts) {
      if (contract.kind === 'interface' || contract.kind === 'library') continue;

      this.checkBalanceDependentLogic(context, contract, findings);
      this.checkFlashLoanCallbacks(context, contract, findings);
      this.checkSpotPriceReliance(context, contract, findings);
    }

    return findings;
  }

  private checkBalanceDependentLogic(
    context: AnalysisContext,
    contract: any,
    findings: Finding[]
  ): void {
    for (const fn of contract.functions) {
      if (!fn.hasBody) continue;
      const body = (fn.node as any).body;
      if (!body) continue;

      walkAST(body, (node: any) => {
        // Check for balanceOf() used in require/if
        if (node.type === 'FunctionCall') {
          const expr = node.expression;
          if (expr?.type === 'Identifier' && (expr.name === 'require' || expr.name === 'assert')) {
            let usesBalance = false;
            walkAST(node, (inner: any) => {
              if (
                inner.type === 'FunctionCall' &&
                inner.expression?.type === 'MemberAccess' &&
                inner.expression.memberName === 'balanceOf'
              ) {
                usesBalance = true;
              }
              // address(this).balance
              if (
                inner.type === 'MemberAccess' &&
                inner.memberName === 'balance'
              ) {
                usesBalance = true;
              }
            });

            if (usesBalance) {
              findings.push(
                this.createFinding(context, {
                  title: `Balance-dependent validation in ${contract.name}.${fn.name}()`,
                  description:
                    `Token balance or ETH balance is used in a require statement for validation. ` +
                    `An attacker can temporarily inflate their balance using flash loans to ` +
                    `bypass this check, then repay the loan in the same transaction.`,
                  severity: Severity.HIGH,
                  confidence: Confidence.MEDIUM,
                  node,
                  recommendation:
                    'Do not rely on instantaneous token balances for access control or critical logic. ' +
                    'Use time-weighted mechanisms, staking with lockup periods, or snapshot-based voting.',
                })
              );
            }
          }
        }
      });
    }
  }

  private checkFlashLoanCallbacks(
    context: AnalysisContext,
    contract: any,
    findings: Finding[]
  ): void {
    for (const fn of contract.functions) {
      if (!FLASH_LOAN_CALLBACKS.has(fn.name.toLowerCase())) continue;
      if (!fn.hasBody) continue;

      // Flash loan callback should verify the initiator
      const body = (fn.node as any).body;
      if (!body) continue;

      let checksInitiator = false;
      walkAST(body, (node: any) => {
        if (node.type === 'FunctionCall') {
          const expr = node.expression;
          if (expr?.type === 'Identifier' && expr.name === 'require') {
            walkAST(node, (inner: any) => {
              if (inner.type === 'Identifier' && inner.name === 'initiator') {
                checksInitiator = true;
              }
              if (inner.type === 'Identifier' && inner.name === 'sender') {
                checksInitiator = true;
              }
            });
          }
        }
      });

      if (!checksInitiator) {
        findings.push(
          this.createFinding(context, {
            title: `Unprotected flash loan callback: ${contract.name}.${fn.name}()`,
            description:
              `The flash loan callback ${fn.name}() does not verify the initiator/sender. ` +
              `An attacker could directly call this function or trick the contract into ` +
              `executing it with attacker-controlled parameters.`,
            severity: Severity.HIGH,
            confidence: Confidence.MEDIUM,
            node: fn.node,
            recommendation:
              'Verify the initiator address equals address(this) or the expected sender. ' +
              'Verify msg.sender is the expected lending pool address.',
          })
        );
      }
    }
  }

  private checkSpotPriceReliance(
    context: AnalysisContext,
    contract: any,
    findings: Finding[]
  ): void {
    for (const fn of contract.functions) {
      if (!fn.hasBody) continue;
      const body = (fn.node as any).body;
      if (!body) continue;

      walkAST(body, (node: any) => {
        if (node.type !== 'FunctionCall') return;
        const expr = node.expression;
        if (expr?.type !== 'MemberAccess') return;

        // getReserves() — AMM spot price
        if (expr.memberName === 'getReserves') {
          findings.push(
            this.createFinding(context, {
              title: `Spot price reliance via getReserves() in ${contract.name}.${fn.name}()`,
              description:
                `getReserves() returns the current AMM reserves which can be manipulated ` +
                `via flash loans or large trades. Deriving prices from spot reserves is ` +
                `vulnerable to price manipulation attacks.`,
              severity: Severity.HIGH,
              confidence: Confidence.MEDIUM,
              node,
              recommendation:
                'Use a TWAP (Time-Weighted Average Price) oracle instead of spot reserves. ' +
                'Chainlink price feeds or Uniswap V3 TWAP oracles are safer alternatives.',
            })
          );
        }
      });
    }
  }
}
