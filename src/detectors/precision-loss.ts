import { BaseDetector } from './base';
import { AnalysisContext } from '../core/context';
import { Finding, Severity, Confidence, VulnerabilityCategory } from '../core/types';
import { walkAST } from '../utils/ast-helpers';

const PRECISION_LOSS = 'Arithmetic Precision Loss' as VulnerabilityCategory;

/**
 * Detects arithmetic precision loss patterns.
 *
 * In Solidity, integer division truncates. Common bugs include:
 * 1. Division before multiplication (loses precision)
 * 2. Division that can truncate to zero (dust amounts)
 * 3. Missing precision scaling in financial calculations
 * 4. Rounding direction not considered in protocol favor
 */
export class PrecisionLossDetector extends BaseDetector {
  readonly id = 'precision-loss';
  readonly name = 'Arithmetic Precision Loss';
  readonly description = 'Detects division-before-multiplication and other precision loss patterns in financial math';
  readonly category = PRECISION_LOSS;
  readonly defaultSeverity = Severity.MEDIUM;

  detect(context: AnalysisContext): Finding[] {
    const findings: Finding[] = [];

    for (const contract of context.contracts) {
      if (contract.kind === 'interface' || contract.kind === 'library') continue;

      for (const fn of contract.functions) {
        if (!fn.hasBody) continue;
        const body = (fn.node as any).body;
        if (!body) continue;

        this.checkDivisionBeforeMultiplication(context, contract.name, fn.name, body, findings);
        this.checkDivisionTruncation(context, contract.name, fn.name, body, findings);
      }
    }

    return findings;
  }

  /**
   * Detects patterns like: (a / b) * c
   * Should be: (a * c) / b to preserve precision
   */
  private checkDivisionBeforeMultiplication(
    context: AnalysisContext,
    contractName: string,
    fnName: string,
    body: any,
    findings: Finding[]
  ): void {
    walkAST(body, (node: any) => {
      if (node.type !== 'BinaryOperation' || node.operator !== '*') return;

      // Check if either operand is a division
      const leftDiv = this.containsDivision(node.left);
      const rightDiv = this.containsDivision(node.right);

      if (leftDiv || rightDiv) {
        findings.push(
          this.createFinding(context, {
            title: `Division before multiplication in ${contractName}.${fnName}()`,
            description:
              `A division operation is performed before multiplication. In Solidity, integer ` +
              `division truncates toward zero, so dividing before multiplying loses precision. ` +
              `For example, (100 / 3) * 3 = 99, not 100.`,
            severity: Severity.MEDIUM,
            confidence: Confidence.MEDIUM,
            node,
            recommendation:
              'Reorder the operations to perform multiplication before division:\n' +
              'Instead of: (a / b) * c\n' +
              'Use: (a * c) / b\n' +
              'Be aware of potential overflow when multiplying first — consider using ' +
              'mulDiv from OpenZeppelin Math library.',
          })
        );
      }
    });
  }

  /**
   * Detects divisions that could truncate to zero when the dividend is smaller
   * than the divisor, especially in calculations involving user amounts.
   */
  private checkDivisionTruncation(
    context: AnalysisContext,
    contractName: string,
    fnName: string,
    body: any,
    findings: Finding[]
  ): void {
    walkAST(body, (node: any) => {
      if (node.type !== 'BinaryOperation' || node.operator !== '/') return;

      // Check for division by large constants (basis points, percentages)
      const divisor = node.right;

      if (divisor?.type === 'NumberLiteral') {
        const value = parseInt(divisor.number, 10);

        // Division by large numbers (like 10000 for basis points, 1e18 for wad)
        if (value >= 10000) {
          findings.push(
            this.createFinding(context, {
              title: `Potential precision loss in division by ${value} in ${contractName}.${fnName}()`,
              description:
                `Division by ${value} can truncate small amounts to zero. For example, ` +
                `if amount < ${value}, the result will be 0. This can lead to users losing ` +
                `small amounts of tokens ("dust") or getting 0 rewards/shares.`,
              severity: Severity.LOW,
              confidence: Confidence.LOW,
              node,
              recommendation:
                'Consider adding a minimum amount check, or use fixed-point arithmetic ' +
                'libraries. Ensure rounding favors the protocol (round down for shares ' +
                'issued, round up for shares redeemed).',
            })
          );
        }
      }

      // Check for division by a variable (possible division by zero)
      if (divisor?.type === 'Identifier') {
        // Check if there's a require/if check for zero
        let hasDivZeroGuard = false;
        walkAST(body, (inner: any) => {
          if (inner.type === 'FunctionCall') {
            const fn = inner.expression;
            if (fn?.type === 'Identifier' && fn.name === 'require') {
              walkAST(inner, (req: any) => {
                if (req.type === 'BinaryOperation' &&
                    (req.operator === '>' || req.operator === '!=' || req.operator === '>=')) {
                  walkAST(req, (operand: any) => {
                    if (operand.type === 'Identifier' && operand.name === divisor.name) {
                      hasDivZeroGuard = true;
                    }
                  });
                }
              });
            }
          }
        });

        if (!hasDivZeroGuard) {
          findings.push(
            this.createFinding(context, {
              title: `Potential division by zero in ${contractName}.${fnName}()`,
              description:
                `Division by variable '${divisor.name}' without an apparent zero-check. ` +
                `If ${divisor.name} is zero, the transaction will revert. If this is a ` +
                `user-facing function, a zero divisor should produce a meaningful error message.`,
              severity: Severity.MEDIUM,
              confidence: Confidence.LOW,
              node,
              recommendation:
                `Add a require statement: require(${divisor.name} != 0, "Division by zero");`,
            })
          );
        }
      }
    });
  }

  private containsDivision(node: any): boolean {
    if (!node) return false;
    if (node.type === 'BinaryOperation' && node.operator === '/') return true;
    if (node.type === 'TupleExpression' && node.components) {
      return node.components.some((c: any) => this.containsDivision(c));
    }
    // Check sub-expressions
    if (node.type === 'BinaryOperation') {
      return this.containsDivision(node.left) || this.containsDivision(node.right);
    }
    return false;
  }
}
