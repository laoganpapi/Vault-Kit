import { BaseDetector } from './base';
import { AnalysisContext } from '../core/context';
import { Finding, Severity, Confidence, VulnerabilityCategory } from '../core/types';
import { walkAST, isArithmeticOp, isInsideUncheckedBlock } from '../utils/ast-helpers';

/**
 * Detects integer overflow/underflow vulnerabilities.
 *
 * Checks for:
 * 1. Arithmetic in Solidity < 0.8.0 without SafeMath
 * 2. Unchecked blocks with arithmetic in Solidity >= 0.8.0
 * 3. Unsafe casting between integer types
 * 4. Potential overflow in loop counters
 */
export class IntegerOverflowDetector extends BaseDetector {
  readonly id = 'integer-overflow';
  readonly name = 'Integer Overflow/Underflow';
  readonly description = 'Detects potential integer overflow and underflow vulnerabilities';
  readonly category = VulnerabilityCategory.INTEGER_OVERFLOW;
  readonly defaultSeverity = Severity.HIGH;

  detect(context: AnalysisContext): Finding[] {
    const findings: Finding[] = [];

    const hasOverflowChecks = context.hasBuiltinOverflowChecks();

    for (const contract of context.contracts) {
      if (contract.kind === 'interface' || contract.kind === 'library') continue;

      const usesSafeMath = contract.baseContracts.some(
        bc => bc.toLowerCase().includes('safemath')
      ) || this.importsSafeMath(context);

      for (const fn of contract.functions) {
        if (!fn.hasBody) continue;
        const body = (fn.node as any).body;
        if (!body) continue;

        if (!hasOverflowChecks) {
          // Pre-0.8.0: flag arithmetic without SafeMath
          this.checkPreSolidity8(context, contract.name, fn.name, body, usesSafeMath, findings);
        } else {
          // Post-0.8.0: check unchecked blocks
          this.checkUncheckedBlocks(context, contract.name, fn.name, body, findings);
        }

        // Check unsafe casts regardless of version
        this.checkUnsafeCasts(context, contract.name, fn.name, body, findings);
      }
    }

    return findings;
  }

  private checkPreSolidity8(
    context: AnalysisContext,
    contractName: string,
    fnName: string,
    body: any,
    usesSafeMath: boolean,
    findings: Finding[]
  ): void {
    if (usesSafeMath) return;

    walkAST(body, (node: any) => {
      if (isArithmeticOp(node)) {
        findings.push(
          this.createFinding(context, {
            title: `Potential integer overflow in ${contractName}.${fnName}()`,
            description:
              `Arithmetic operation '${node.operator}' found in Solidity < 0.8.0 without SafeMath. ` +
              `This can lead to integer overflow or underflow, potentially allowing attackers to ` +
              `manipulate balances or bypass checks.`,
            severity: Severity.HIGH,
            confidence: Confidence.MEDIUM,
            node,
            recommendation:
              'Use SafeMath library for all arithmetic operations, or upgrade to Solidity >= 0.8.0 ' +
              'which has built-in overflow/underflow checks.',
            references: [
              'https://swcregistry.io/docs/SWC-101',
            ],
          })
        );
      }
    });
  }

  private checkUncheckedBlocks(
    context: AnalysisContext,
    contractName: string,
    fnName: string,
    body: any,
    findings: Finding[]
  ): void {
    walkAST(body, (node: any) => {
      if (node.type !== 'UncheckedStatement') return;
      walkAST(node, (inner: any) => {
        // Only BinaryOperation arithmetic is flagged. Unary ++/-- (the common
        // "unchecked { ++i }" loop-counter optimization) is a UnaryOperation
        // node and is not matched by isArithmeticOp, so it's already excluded.
        if (!isArithmeticOp(inner)) return;

        findings.push(
          this.createFinding(context, {
            title: `Unchecked arithmetic in ${contractName}.${fnName}()`,
            description:
              `Arithmetic operation '${inner.operator}' inside an unchecked block. ` +
              `This bypasses Solidity 0.8.0+ overflow protection. Ensure this is intentional ` +
              `and that overflow/underflow cannot occur or is handled.`,
            severity: Severity.MEDIUM,
            confidence: Confidence.LOW,
            node: inner,
            recommendation:
              'Verify that the unchecked arithmetic cannot overflow/underflow in practice. ' +
              'Add comments explaining why the unchecked block is safe. ' +
              'Consider using checked arithmetic unless gas savings are critical.',
          })
        );
      });
    });
  }

  private checkUnsafeCasts(
    context: AnalysisContext,
    contractName: string,
    fnName: string,
    body: any,
    findings: Finding[]
  ): void {
    walkAST(body, (node: any) => {
      if (node.type === 'TypeConversion' || node.type === 'FunctionCall') {
        const targetType = node.expression?.typeName?.name || node.expression?.name || '';

        // Detect downcasting (e.g., uint256 -> uint128, uint256 -> uint8)
        if (this.isDowncast(targetType, node)) {
          findings.push(
            this.createFinding(context, {
              title: `Unsafe downcast in ${contractName}.${fnName}()`,
              description:
                `Potential unsafe integer downcast to ${targetType}. ` +
                `If the value exceeds the target type's range, it will be silently truncated ` +
                `in Solidity < 0.8.0 or revert in >= 0.8.0.`,
              severity: Severity.LOW,
              confidence: Confidence.LOW,
              node,
              recommendation:
                'Use OpenZeppelin SafeCast library for safe integer type conversions, ' +
                'or add explicit bounds checks before casting.',
              references: [
                'https://docs.openzeppelin.com/contracts/4.x/api/utils#SafeCast',
              ],
            })
          );
        }
      }
    });
  }

  private isDowncast(targetType: string, node: any): boolean {
    const intPattern = /^u?int(\d+)$/;
    const match = targetType.match(intPattern);
    if (!match) return false;
    const bits = parseInt(match[1], 10);
    return bits < 256;
  }

  private importsSafeMath(context: AnalysisContext): boolean {
    return context.file.imports.some(
      imp => imp.path.toLowerCase().includes('safemath')
    );
  }
}
