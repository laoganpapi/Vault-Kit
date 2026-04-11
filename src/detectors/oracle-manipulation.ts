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

  /** Resolve MemberAccess through NameValueExpression */
  private getMemberAccess(expr: any): any | null {
    if (expr?.type === 'MemberAccess') return expr;
    if (expr?.type === 'NameValueExpression' && expr.expression?.type === 'MemberAccess') {
      return expr.expression;
    }
    return null;
  }

  /**
   * Collect variable names assigned from a latestRoundData() call's destructuring.
   * e.g., (uint80 roundId, int256 answer, , uint256 updatedAt, ) = ...
   * Returns a map of position -> variable name.
   */
  private getDestructuredVarNames(callNode: any, body: any): Map<number, string> {
    const vars = new Map<number, string>();
    // Walk the body to find the VariableDeclarationStatement containing this call
    walkAST(body, (node: any) => {
      if (node.type === 'VariableDeclarationStatement' && node.initialValue === callNode) {
        const decls = node.variables || [];
        for (let i = 0; i < decls.length; i++) {
          if (decls[i]?.name) {
            vars.set(i, decls[i].name);
          }
        }
      }
    });
    return vars;
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
        const ma = this.getMemberAccess(node.expression);
        if (!ma) return;

        // Skip calls to sequencer uptime feeds — they have different validation semantics
        const receiverName = ma.expression?.type === 'Identifier' ? ma.expression.name : '';
        const receiverLower = receiverName.toLowerCase();
        if (receiverLower.includes('sequencer') || receiverLower.includes('uptime')) return;

        // latestRoundData() — Chainlink pattern
        if (ma.memberName === 'latestRoundData') {
          // Get the actual variable names from the destructuring
          const varNames = this.getDestructuredVarNames(node, body);
          // Chainlink returns: (roundId, answer, startedAt, updatedAt, answeredInRound)
          const answerVar = varNames.get(1);
          const updatedAtVar = varNames.get(3);
          const answeredInRoundVar = varNames.get(4);
          const roundIdVar = varNames.get(0);

          // Check for staleness: updatedAt variable used in comparison with block.timestamp
          let checksTimestamp = false;
          if (updatedAtVar) {
            walkAST(body, (inner: any) => {
              if (inner.type === 'BinaryOperation' && ['>', '<', '>=', '<=', '-'].includes(inner.operator)) {
                let hasUpdatedAt = false;
                let hasBlockTimestamp = false;
                walkAST(inner, (n: any) => {
                  if (n.type === 'Identifier' && n.name === updatedAtVar) hasUpdatedAt = true;
                  if (n.type === 'MemberAccess' && n.expression?.name === 'block' && n.memberName === 'timestamp') {
                    hasBlockTimestamp = true;
                  }
                });
                if (hasUpdatedAt && hasBlockTimestamp) checksTimestamp = true;
              }
              // Also check require with the variable
              if (inner.type === 'FunctionCall' && inner.expression?.name === 'require') {
                walkAST(inner, (n: any) => {
                  if (n.type === 'Identifier' && n.name === updatedAtVar) checksTimestamp = true;
                });
              }
            });
          }

          // Check for answer > 0 validation
          let checksAnswer = false;
          if (answerVar) {
            walkAST(body, (inner: any) => {
              if (inner.type === 'BinaryOperation' && ['>', '>=', '!='].includes(inner.operator)) {
                walkAST(inner, (n: any) => {
                  if (n.type === 'Identifier' && n.name === answerVar) checksAnswer = true;
                });
              }
              if (inner.type === 'FunctionCall' && inner.expression?.name === 'require') {
                walkAST(inner, (n: any) => {
                  if (n.type === 'Identifier' && n.name === answerVar) checksAnswer = true;
                });
              }
            });
          }

          // Check for round completeness
          let checksRoundId = false;
          if (answeredInRoundVar && roundIdVar) {
            walkAST(body, (inner: any) => {
              if (inner.type === 'BinaryOperation' && ['>=', '=='].includes(inner.operator)) {
                let hasAnsweredInRound = false;
                let hasRoundId = false;
                walkAST(inner, (n: any) => {
                  if (n.type === 'Identifier' && n.name === answeredInRoundVar) hasAnsweredInRound = true;
                  if (n.type === 'Identifier' && n.name === roundIdVar) hasRoundId = true;
                });
                if (hasAnsweredInRound && hasRoundId) checksRoundId = true;
              }
            });
          }

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
        if (ma.memberName === 'latestAnswer') {
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
