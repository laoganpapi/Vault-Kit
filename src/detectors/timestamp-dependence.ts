import { BaseDetector } from './base';
import { AnalysisContext } from '../core/context';
import { Finding, Severity, Confidence, VulnerabilityCategory } from '../core/types';
import { walkAST, isTimestampAccess } from '../utils/ast-helpers';

/**
 * Detects dangerous reliance on block.timestamp.
 *
 * Miners/validators can manipulate block.timestamp within certain bounds (~15 seconds).
 * Using it for critical logic (randomness, deadlines, locking) can be exploited.
 */
export class TimestampDependenceDetector extends BaseDetector {
  readonly id = 'timestamp-dependence';
  readonly name = 'Timestamp Dependence';
  readonly description = 'Detects dangerous reliance on block.timestamp for critical logic';
  readonly category = VulnerabilityCategory.TIMESTAMP_DEPENDENCE;
  readonly defaultSeverity = Severity.LOW;

  detect(context: AnalysisContext): Finding[] {
    const findings: Finding[] = [];

    for (const contract of context.contracts) {
      if (contract.kind === 'interface' || contract.kind === 'library') continue;

      for (const fn of contract.functions) {
        if (!fn.hasBody) continue;
        const body = (fn.node as any).body;
        if (!body) continue;

        walkAST(body, (node: any, parent: any) => {
          if (!isTimestampAccess(node)) return;

          // Timestamp used as source of randomness
          if (this.isUsedForRandomness(node, parent, body)) {
            findings.push(
              this.createFinding(context, {
                title: `block.timestamp used for randomness in ${contract.name}.${fn.name}()`,
                description:
                  `block.timestamp is used in what appears to be randomness generation. ` +
                  `Miners/validators can manipulate block.timestamp, making this predictable.`,
                severity: Severity.HIGH,
                confidence: Confidence.MEDIUM,
                node,
                recommendation:
                  'Use Chainlink VRF or a commit-reveal scheme for randomness. ' +
                  'block.timestamp is not a safe source of entropy.',
                references: [
                  'https://swcregistry.io/docs/SWC-116',
                  'https://swcregistry.io/docs/SWC-120',
                ],
              })
            );
            return;
          }

          // Timestamp in equality comparison (exact match is manipulable)
          if (parent?.type === 'BinaryOperation' && parent.operator === '==') {
            findings.push(
              this.createFinding(context, {
                title: `Exact timestamp comparison in ${contract.name}.${fn.name}()`,
                description:
                  `block.timestamp is compared with == which can be manipulated by validators. ` +
                  `This may never match the exact expected value.`,
                severity: Severity.MEDIUM,
                confidence: Confidence.HIGH,
                node,
                recommendation:
                  'Use range comparisons (>=, <=) instead of exact equality with block.timestamp.',
              })
            );
            return;
          }

          // Timestamp used in condition (general case)
          if (
            parent?.type === 'BinaryOperation' &&
            ['<', '>', '<=', '>=', '!='].includes(parent.operator)
          ) {
            findings.push(
              this.createFinding(context, {
                title: `block.timestamp used in condition in ${contract.name}.${fn.name}()`,
                description:
                  `block.timestamp is used in a comparison. Validators can manipulate the timestamp ` +
                  `by approximately 15 seconds. Ensure this tolerance is acceptable for your use case.`,
                severity: Severity.LOW,
                confidence: Confidence.HIGH,
                node,
                recommendation:
                  'Ensure that a ~15 second manipulation of block.timestamp cannot cause harm. ' +
                  'For time-sensitive operations, consider using block numbers or external time oracles.',
              })
            );
          }
        });
      }
    }

    return findings;
  }

  private isUsedForRandomness(node: any, parent: any, body: any): boolean {
    // Check if timestamp is used with keccak256, hash operations, or modulo
    if (parent?.type === 'BinaryOperation' && parent.operator === '%') return true;

    // Walk up to find if it's inside keccak256/sha3
    let inHash = false;
    walkAST(body, (n: any) => {
      if (n.type === 'FunctionCall') {
        const fn = n.expression;
        if (
          fn?.type === 'Identifier' &&
          (fn.name === 'keccak256' || fn.name === 'sha3' || fn.name === 'sha256')
        ) {
          walkAST(n, (inner: any) => {
            if (inner === node) inHash = true;
          });
        }
      }
    });
    return inHash;
  }
}
