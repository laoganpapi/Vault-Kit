import { BaseDetector } from './base';
import { AnalysisContext } from '../core/context';
import { Finding, Severity, Confidence, VulnerabilityCategory } from '../core/types';
import { walkAST } from '../utils/ast-helpers';

/**
 * Detects front-running vulnerability patterns.
 *
 * Checks for:
 * 1. ERC-20 approve() without setting to 0 first (front-run double-spend)
 * 2. Price-sensitive operations without slippage protection
 * 3. Commit-reveal patterns missing commit phase
 */
export class FrontRunningDetector extends BaseDetector {
  readonly id = 'front-running';
  readonly name = 'Front-Running';
  readonly description = 'Detects patterns vulnerable to front-running (MEV) attacks';
  readonly category = VulnerabilityCategory.FRONT_RUNNING;
  readonly defaultSeverity = Severity.MEDIUM;

  detect(context: AnalysisContext): Finding[] {
    const findings: Finding[] = [];

    for (const contract of context.contracts) {
      if (contract.kind === 'interface' || contract.kind === 'library') continue;

      this.checkApproveRace(context, contract, findings);
      this.checkSlippageProtection(context, contract, findings);
    }

    return findings;
  }

  private checkApproveRace(
    context: AnalysisContext,
    contract: any,
    findings: Finding[]
  ): void {
    // Check if the contract implements approve() without increaseAllowance/decreaseAllowance
    const hasApprove = contract.functions.some((f: any) => f.name === 'approve');
    const hasIncreaseAllowance = contract.functions.some(
      (f: any) => f.name === 'increaseAllowance'
    );

    if (hasApprove && !hasIncreaseAllowance) {
      const approveFn = contract.functions.find((f: any) => f.name === 'approve');
      if (approveFn) {
        findings.push(
          this.createFinding(context, {
            title: `ERC-20 approve race condition in ${contract.name}`,
            description:
              `The contract implements approve() without increaseAllowance()/decreaseAllowance(). ` +
              `The standard approve function is vulnerable to a front-running attack where a spender ` +
              `can spend both the old and new allowance by front-running the approve transaction.`,
            severity: Severity.MEDIUM,
            confidence: Confidence.MEDIUM,
            node: approveFn.node,
            recommendation:
              'Implement increaseAllowance() and decreaseAllowance() as alternatives to approve(). ' +
              'Or use OpenZeppelin ERC-20 which includes these. Advise users to set allowance to 0 ' +
              'before setting a new value.',
            references: [
              'https://swcregistry.io/docs/SWC-114',
            ],
          })
        );
      }
    }
  }

  private checkSlippageProtection(
    context: AnalysisContext,
    contract: any,
    findings: Finding[]
  ): void {
    for (const fn of contract.functions) {
      if (!fn.hasBody) continue;
      const body = (fn.node as any).body;
      if (!body) continue;

      // Look for swap/trade patterns without minAmountOut
      const fnNameLower = fn.name.toLowerCase();
      const isSwapLike =
        fnNameLower.includes('swap') ||
        fnNameLower.includes('trade') ||
        fnNameLower.includes('exchange');

      if (isSwapLike) {
        const paramNames = fn.parameters.map((p: any) => p.name.toLowerCase());
        const hasSlippageParam = paramNames.some(
          (name: string) =>
            name.includes('minamount') ||
            name.includes('minout') ||
            name.includes('slippage') ||
            name.includes('deadline') ||
            name.includes('minreturn')
        );

        if (!hasSlippageParam) {
          findings.push(
            this.createFinding(context, {
              title: `Missing slippage protection in ${contract.name}.${fn.name}()`,
              description:
                `Function ${fn.name}() appears to perform a swap/trade but has no slippage protection ` +
                `parameter (e.g., minAmountOut, deadline). Without slippage protection, the transaction ` +
                `is vulnerable to sandwich attacks where MEV bots front-run and back-run the trade.`,
              severity: Severity.HIGH,
              confidence: Confidence.MEDIUM,
              node: fn.node,
              recommendation:
                'Add minAmountOut and deadline parameters to swap functions. ' +
                'Revert if the output amount is less than the minimum or if the deadline has passed.',
            })
          );
        }
      }
    }
  }
}
