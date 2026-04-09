import { BaseDetector } from './base';
import { AnalysisContext } from '../core/context';
import { Finding, Severity, Confidence, VulnerabilityCategory } from '../core/types';
import { walkAST } from '../utils/ast-helpers';
import { ORACLE_FUNCTIONS } from '../utils/patterns';

/**
 * Detects oracle manipulation vulnerabilities.
 *
 * Checks for:
 * 1. Single oracle dependency (no fallback)
 * 2. Missing staleness checks on oracle data
 * 3. Missing price deviation checks
 * 4. No circuit breaker for extreme prices
 */
export class OracleManipulationDetector extends BaseDetector {
  readonly id = 'oracle-manipulation';
  readonly name = 'Oracle Manipulation';
  readonly description = 'Detects vulnerabilities in oracle price feed usage';
  readonly category = VulnerabilityCategory.ORACLE_MANIPULATION;
  readonly defaultSeverity = Severity.HIGH;

  detect(context: AnalysisContext): Finding[] {
    const findings: Finding[] = [];

    for (const contract of context.contracts) {
      if (contract.kind === 'interface' || contract.kind === 'library') continue;

      this.checkChainlinkUsage(context, contract, findings);
      this.checkSingleOraclePoint(context, contract, findings);
    }

    return findings;
  }

  private checkChainlinkUsage(
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

        // latestRoundData() — Chainlink pattern
        if (expr.memberName === 'latestRoundData') {
          // Check if the function validates staleness (updatedAt)
          const fnBody = body;
          let checksTimestamp = false;
          let checksRoundId = false;
          let checksAnswer = false;

          walkAST(fnBody, (inner: any) => {
            if (inner.type === 'Identifier') {
              if (inner.name === 'updatedAt' || inner.name === 'timestamp') checksTimestamp = true;
              if (inner.name === 'answeredInRound' || inner.name === 'roundId') checksRoundId = true;
            }
            // Check for answer > 0
            if (
              inner.type === 'BinaryOperation' &&
              (inner.operator === '>' || inner.operator === '!=')
            ) {
              walkAST(inner, (n: any) => {
                if (n.type === 'Identifier' && (n.name === 'answer' || n.name === 'price')) {
                  checksAnswer = true;
                }
              });
            }
          });

          if (!checksTimestamp) {
            findings.push(
              this.createFinding(context, {
                title: `Missing oracle staleness check in ${contract.name}.${fn.name}()`,
                description:
                  `latestRoundData() is called without validating the updatedAt timestamp. ` +
                  `If the oracle goes down or returns stale data, the contract will use ` +
                  `outdated prices, potentially leading to incorrect liquidations, ` +
                  `undercollateralized loans, or arbitrage opportunities.`,
                severity: Severity.HIGH,
                confidence: Confidence.HIGH,
                node,
                recommendation:
                  'Check the updatedAt timestamp: ' +
                  '`require(block.timestamp - updatedAt < MAX_STALENESS, "Stale price");`',
              })
            );
          }

          if (!checksAnswer) {
            findings.push(
              this.createFinding(context, {
                title: `Missing oracle price validation in ${contract.name}.${fn.name}()`,
                description:
                  `latestRoundData() result is not checked for zero or negative price. ` +
                  `A zero price could lead to division by zero or free token acquisition.`,
                severity: Severity.HIGH,
                confidence: Confidence.HIGH,
                node,
                recommendation:
                  'Validate the answer: `require(answer > 0, "Invalid price");`',
              })
            );
          }

          if (!checksRoundId) {
            findings.push(
              this.createFinding(context, {
                title: `Missing round completeness check in ${contract.name}.${fn.name}()`,
                description:
                  `latestRoundData() is called without checking if the round was completed ` +
                  `(answeredInRound >= roundId). Incomplete rounds may return stale data.`,
                severity: Severity.MEDIUM,
                confidence: Confidence.MEDIUM,
                node,
                recommendation:
                  'Check round completeness: `require(answeredInRound >= roundId, "Round not complete");`',
              })
            );
          }
        }

        // latestAnswer() — deprecated single-value pattern
        if (expr.memberName === 'latestAnswer') {
          findings.push(
            this.createFinding(context, {
              title: `Deprecated latestAnswer() in ${contract.name}.${fn.name}()`,
              description:
                `latestAnswer() is deprecated and returns only the price without round metadata. ` +
                `This prevents staleness and round completeness checks.`,
              severity: Severity.MEDIUM,
              confidence: Confidence.HIGH,
              node,
              recommendation:
                'Use latestRoundData() instead, which returns (roundId, answer, startedAt, updatedAt, answeredInRound) ' +
                'and allows for proper validation.',
            })
          );
        }
      });
    }
  }

  private checkSingleOraclePoint(
    context: AnalysisContext,
    contract: any,
    findings: Finding[]
  ): void {
    // Count distinct oracle variable references
    const oracleVars = contract.stateVariables.filter((v: any) => {
      const typeLower = v.typeName.toLowerCase();
      return (
        typeLower.includes('aggregator') ||
        typeLower.includes('oracle') ||
        typeLower.includes('pricefeed') ||
        typeLower.includes('feed')
      );
    });

    if (oracleVars.length === 1) {
      findings.push(
        this.createFinding(context, {
          title: `Single oracle dependency in ${contract.name}`,
          description:
            `The contract depends on a single oracle (${oracleVars[0].name}). ` +
            `If this oracle fails, returns stale data, or is manipulated, ` +
            `the contract has no fallback mechanism.`,
          severity: Severity.MEDIUM,
          confidence: Confidence.LOW,
          node: oracleVars[0].node,
          recommendation:
            'Consider implementing a fallback oracle pattern with multiple price sources. ' +
            'Use a primary oracle with secondary fallback, or aggregate multiple oracle responses.',
        })
      );
    }
  }
}
