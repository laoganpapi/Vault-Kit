import { BaseDetector } from './base';
import { AnalysisContext } from '../core/context';
import { Finding, Severity, Confidence, VulnerabilityCategory } from '../core/types';

const STATE_SHADOWING = 'State Variable Shadowing' as VulnerabilityCategory;

/**
 * Detects state variable shadowing.
 *
 * When a derived contract declares a state variable with the same name as one
 * in a base contract, it creates a new storage slot rather than overriding.
 * This leads to subtle bugs where the base and derived contracts read/write
 * different storage slots for what appears to be the same variable.
 */
export class StateShadowingDetector extends BaseDetector {
  readonly id = 'state-shadowing';
  readonly name = 'State Variable Shadowing';
  readonly description = 'Detects state variables that shadow variables in parent contracts';
  readonly category = STATE_SHADOWING;
  readonly defaultSeverity = Severity.MEDIUM;

  detect(context: AnalysisContext): Finding[] {
    const findings: Finding[] = [];

    // Build a map of contract names to their state variables
    const contractVars = new Map<string, Set<string>>();
    for (const contract of context.contracts) {
      contractVars.set(
        contract.name,
        new Set(contract.stateVariables.map(v => v.name))
      );
    }

    for (const contract of context.contracts) {
      if (contract.kind === 'interface' || contract.kind === 'library') continue;
      if (contract.baseContracts.length === 0) continue;

      const ownVars = contract.stateVariables;

      for (const baseName of contract.baseContracts) {
        const baseVars = contractVars.get(baseName);
        if (!baseVars) continue;

        for (const ownVar of ownVars) {
          if (baseVars.has(ownVar.name)) {
            findings.push(
              this.createFinding(context, {
                title: `State variable '${ownVar.name}' shadows ${baseName}.${ownVar.name}`,
                description:
                  `Contract ${contract.name} declares state variable '${ownVar.name}' which also ` +
                  `exists in parent contract ${baseName}. This creates a separate storage slot — ` +
                  `the base contract will read/write its own slot while the derived contract uses ` +
                  `a different one. This is almost always a bug.`,
                severity: Severity.MEDIUM,
                confidence: Confidence.HIGH,
                node: ownVar.node,
                recommendation:
                  `Remove the duplicate declaration in ${contract.name} and use the inherited ` +
                  `variable from ${baseName} instead. If different behavior is needed, use a ` +
                  `different variable name to make the distinction explicit.`,
                references: [
                  'https://swcregistry.io/docs/SWC-119',
                ],
              })
            );
          }
        }
      }

      // Also check for local variables shadowing state variables
      for (const fn of contract.functions) {
        if (!fn.hasBody) continue;
        const fnNode = fn.node as any;
        const body = fnNode.body;
        if (!body?.statements) continue;

        this.checkLocalShadowing(context, contract, fn, body, findings);
      }
    }

    return findings;
  }

  private checkLocalShadowing(
    context: AnalysisContext,
    contract: any,
    fn: any,
    body: any,
    findings: Finding[]
  ): void {
    const stateVarNames = new Set(contract.stateVariables.map((v: any) => v.name));

    const checkStatements = (statements: any[]) => {
      for (const stmt of statements) {
        if (stmt.type === 'VariableDeclarationStatement') {
          for (const v of stmt.variables || []) {
            if (v && stateVarNames.has(v.name)) {
              findings.push(
                this.createFinding(context, {
                  title: `Local variable '${v.name}' shadows state variable in ${contract.name}.${fn.name}()`,
                  description:
                    `Local variable '${v.name}' in function ${fn.name}() has the same name as ` +
                    `state variable ${contract.name}.${v.name}. This can cause confusion about ` +
                    `which variable is being read or written.`,
                  severity: Severity.LOW,
                  confidence: Confidence.HIGH,
                  node: stmt,
                  recommendation:
                    `Rename the local variable to avoid shadowing (e.g., _${v.name} or local${v.name[0].toUpperCase() + v.name.slice(1)}).`,
                  references: [
                    'https://swcregistry.io/docs/SWC-119',
                  ],
                })
              );
            }
          }
        }
      }
    };

    if (body.statements) checkStatements(body.statements);
  }
}
