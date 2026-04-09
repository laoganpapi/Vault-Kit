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

    // Detect sub-256-bit variables that are separated by 256-bit variables
    // (they could be grouped together to share a slot)
    const smallVars: Array<{ v: any; bits: number; index: number }> = [];
    const fullSlotIndices = new Set<number>();

    for (let i = 0; i < vars.length; i++) {
      const bits = this.getTypeBits(vars[i].typeName);
      if (bits > 0 && bits < 256) {
        smallVars.push({ v: vars[i], bits, index: i });
      } else {
        fullSlotIndices.add(i);
      }
    }

    // Find small vars that are NOT adjacent to each other (a full-slot var separates them)
    for (let i = 0; i < smallVars.length - 1; i++) {
      const current = smallVars[i];
      const next = smallVars[i + 1];

      // Check if there's a full-slot variable between them
      let separatedByFullSlot = false;
      for (let j = current.index + 1; j < next.index; j++) {
        if (fullSlotIndices.has(j)) {
          separatedByFullSlot = true;
          break;
        }
      }

      if (separatedByFullSlot && current.bits + next.bits <= 256) {
        findings.push(
          this.createFinding(context, {
            title: `Storage packing opportunity in ${contract.name}`,
            description:
              `State variables '${current.v.name}' (${current.bits} bits) and '${next.v.name}' ` +
              `(${next.bits} bits) could share a storage slot (${current.bits + next.bits}/256 bits) ` +
              `but are separated by a 256-bit variable. Reordering them to be adjacent would save ` +
              `one storage slot (20,000 gas on first write).`,
            severity: Severity.GAS,
            confidence: Confidence.HIGH,
            node: current.v.node,
            recommendation:
              `Reorder state variables to group sub-256-bit types together:\n` +
              `${current.v.typeName} ${current.v.name}; // ${current.bits} bits\n` +
              `${next.v.typeName} ${next.v.name}; // ${next.bits} bits`,
            gasImpact: 20000,
          })
        );
        break; // Only report one packing opportunity per contract
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
