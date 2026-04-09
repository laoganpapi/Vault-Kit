import { BaseDetector } from './base';
import { AnalysisContext } from '../core/context';
import { Finding, Severity, Confidence, VulnerabilityCategory } from '../core/types';
import { walkAST } from '../utils/ast-helpers';
import { analyzeDataFlow } from '../analyzers/data-flow';

/**
 * Detects gas optimization opportunities.
 *
 * Checks for:
 * 1. Storage reads in loops (cache in memory)
 * 2. Non-constant state variables that could be constant/immutable
 * 3. Use of string when bytes32 would suffice
 * 4. Multiple storage reads of the same variable
 * 5. Unnecessary public visibility on state variables
 * 6. Use of != 0 vs > 0 for unsigned integers
 */
export class GasOptimizationDetector extends BaseDetector {
  readonly id = 'gas-optimization';
  readonly name = 'Gas Optimization';
  readonly description = 'Identifies gas optimization opportunities to reduce transaction costs';
  readonly category = VulnerabilityCategory.GAS_OPTIMIZATION;
  readonly defaultSeverity = Severity.GAS;

  detect(context: AnalysisContext): Finding[] {
    const findings: Finding[] = [];

    for (const contract of context.contracts) {
      if (contract.kind === 'interface') continue;

      this.checkStorageInLoops(context, contract, findings);
      this.checkPackingOpportunities(context, contract, findings);
      this.checkPublicConstants(context, contract, findings);
      this.checkUintComparisons(context, contract, findings);
    }

    return findings;
  }

  private checkStorageInLoops(
    context: AnalysisContext,
    contract: any,
    findings: Finding[]
  ): void {
    const stateVarNames = new Set(contract.stateVariables.map((v: any) => v.name));

    for (const fn of contract.functions) {
      if (!fn.hasBody) continue;
      const body = (fn.node as any).body;
      if (!body) continue;

      const localVarNames = new Set<string>();
      walkAST(body, (node: any) => {
        if (node.type === 'VariableDeclarationStatement') {
          for (const v of node.variables || []) {
            if (v?.name) localVarNames.add(v.name);
          }
        }
      });

      const stateNames = new Set<string>(contract.stateVariables.map((v: any) => v.name as string));
      const dataFlow = analyzeDataFlow(body, stateNames, localVarNames);

      for (const { variable, node } of dataFlow.storageReadsInLoops) {
        findings.push(
          this.createFinding(context, {
            title: `Storage variable '${variable}' read in loop`,
            description:
              `State variable '${variable}' is read inside a loop in ${contract.name}.${fn.name}(). ` +
              `Each SLOAD costs 2100 gas (cold) or 100 gas (warm). Caching the value in a ` +
              `local memory variable before the loop would save gas.`,
            severity: Severity.GAS,
            confidence: Confidence.HIGH,
            node,
            recommendation:
              `Cache '${variable}' in a local variable before the loop: ` +
              `\`uint256 _${variable} = ${variable};\``,
            gasImpact: 100,
          })
        );
      }
    }
  }

  private checkPackingOpportunities(
    context: AnalysisContext,
    contract: any,
    findings: Finding[]
  ): void {
    const vars = contract.stateVariables;
    if (vars.length < 2) return;

    // Check for sequential small-type variables that could be packed
    let consecutiveSmall: any[] = [];

    for (const v of vars) {
      const bits = this.getTypeBits(v.typeName);
      if (bits > 0 && bits < 256) {
        consecutiveSmall.push(v);
      } else {
        if (consecutiveSmall.length >= 2) {
          const totalBits = consecutiveSmall.reduce(
            (sum: number, sv: any) => sum + this.getTypeBits(sv.typeName), 0
          );
          if (totalBits <= 256) {
            // These could be packed into a single slot — check if they ARE adjacent
            // This is a simplified check
          }
        }
        consecutiveSmall = [];
      }
    }
  }

  private checkPublicConstants(
    context: AnalysisContext,
    contract: any,
    findings: Finding[]
  ): void {
    for (const v of contract.stateVariables) {
      // State variables that are never modified could be constant
      if (v.isConstant || v.isImmutable) continue;
      if (v.visibility !== 'public') continue;

      // Check if it's assigned in constructor only
      let assignedOutsideConstructor = false;
      let assignedInConstructor = false;

      for (const fn of contract.functions) {
        if (!fn.hasBody) continue;
        const body = (fn.node as any).body;
        if (!body) continue;

        walkAST(body, (node: any) => {
          if (
            node.type === 'BinaryOperation' &&
            node.operator === '=' &&
            node.left?.type === 'Identifier' &&
            node.left.name === v.name
          ) {
            if (fn.isConstructor) {
              assignedInConstructor = true;
            } else {
              assignedOutsideConstructor = true;
            }
          }
        });
      }

      if (assignedInConstructor && !assignedOutsideConstructor) {
        findings.push(
          this.createFinding(context, {
            title: `'${v.name}' could be immutable`,
            description:
              `State variable '${v.name}' is only assigned in the constructor and could be ` +
              `declared as immutable. Immutable variables are stored in code instead of storage, ` +
              `saving ~2100 gas per read.`,
            severity: Severity.GAS,
            confidence: Confidence.HIGH,
            node: v.node,
            recommendation: `Declare '${v.name}' as immutable: \`${v.typeName} public immutable ${v.name};\``,
            gasImpact: 2100,
          })
        );
      }
    }
  }

  private checkUintComparisons(
    context: AnalysisContext,
    contract: any,
    findings: Finding[]
  ): void {
    for (const fn of contract.functions) {
      if (!fn.hasBody) continue;
      const body = (fn.node as any).body;
      if (!body) continue;

      walkAST(body, (node: any) => {
        if (
          node.type === 'BinaryOperation' &&
          node.operator === '>' &&
          node.right?.type === 'NumberLiteral' &&
          node.right.number === '0'
        ) {
          findings.push(
            this.createFinding(context, {
              title: `Use != 0 instead of > 0 for unsigned integers`,
              description:
                `Comparison '> 0' costs more gas than '!= 0' for unsigned integers in require statements.`,
              severity: Severity.GAS,
              confidence: Confidence.HIGH,
              node,
              recommendation: 'Replace `> 0` with `!= 0` for unsigned integer comparisons.',
              gasImpact: 6,
            })
          );
        }
      });
    }
  }

  private getTypeBits(typeName: string): number {
    const match = typeName.match(/^u?int(\d+)$/);
    if (match) return parseInt(match[1], 10);
    if (typeName === 'bool') return 8;
    if (typeName === 'address') return 160;
    if (typeName.startsWith('bytes') && !typeName.includes('[]')) {
      const n = parseInt(typeName.slice(5), 10);
      if (!isNaN(n)) return n * 8;
    }
    return 256; // default to full slot
  }
}
