import { BaseDetector } from './base';
import { AnalysisContext } from '../core/context';
import { Finding, Severity, Confidence, VulnerabilityCategory } from '../core/types';
import { walkAST } from '../utils/ast-helpers';

/**
 * Detects uninitialized storage pointer vulnerabilities.
 *
 * In older Solidity versions, local variables of struct/array/mapping type
 * default to storage, which can overwrite state variables.
 */
export class UninitializedStorageDetector extends BaseDetector {
  readonly id = 'uninitialized-storage';
  readonly name = 'Uninitialized Storage';
  readonly description = 'Detects uninitialized storage pointers and variables with dangerous default values';
  readonly category = VulnerabilityCategory.UNINITIALIZED_STORAGE;
  readonly defaultSeverity = Severity.HIGH;

  detect(context: AnalysisContext): Finding[] {
    const findings: Finding[] = [];

    // This is primarily a pre-0.5.0 issue, but we still check for patterns
    const hasExplicitDataLocation = context.hasBuiltinOverflowChecks(); // rough proxy for >= 0.5.0

    for (const contract of context.contracts) {
      if (contract.kind === 'interface' || contract.kind === 'library') continue;

      // Check for uninitialized state variables that are used in critical logic
      this.checkUninitializedStateVars(context, contract, findings);

      if (!hasExplicitDataLocation) {
        this.checkStoragePointers(context, contract, findings);
      }
    }

    return findings;
  }

  private checkUninitializedStateVars(
    context: AnalysisContext,
    contract: any,
    findings: Finding[]
  ): void {
    for (const stateVar of contract.stateVariables) {
      if (stateVar.isConstant || stateVar.isImmutable) continue;

      // Check if the variable is an address type that defaults to address(0)
      if (stateVar.typeName === 'address' || stateVar.typeName === 'address payable') {
        // Check if used in transfer/call without initialization check
        for (const fn of contract.functions) {
          if (!fn.hasBody) continue;
          const body = (fn.node as any).body;
          if (!body) continue;

          let usedInTransfer = false;
          let hasZeroCheck = false;

          walkAST(body, (node: any) => {
            // Used as target of transfer/call
            if (
              node.type === 'MemberAccess' &&
              ['transfer', 'send', 'call'].includes(node.memberName) &&
              node.expression?.type === 'Identifier' &&
              node.expression.name === stateVar.name
            ) {
              usedInTransfer = true;
            }

            // Checked for zero address
            if (node.type === 'BinaryOperation' && node.operator === '!=') {
              walkAST(node, (inner: any) => {
                if (inner.type === 'Identifier' && inner.name === stateVar.name) {
                  hasZeroCheck = true;
                }
              });
            }
          });

          if (usedInTransfer && !hasZeroCheck) {
            findings.push(
              this.createFinding(context, {
                title: `Unvalidated address ${stateVar.name} used in ${contract.name}.${fn.name}()`,
                description:
                  `State variable '${stateVar.name}' of type address is used as a transfer target ` +
                  `without checking if it's the zero address. If uninitialized, funds will be ` +
                  `permanently lost by sending to address(0).`,
                severity: Severity.MEDIUM,
                confidence: Confidence.MEDIUM,
                node: fn.node,
                recommendation:
                  'Add a zero-address check: `require(addr != address(0), "zero address");` ' +
                  'before using the address for transfers.',
              })
            );
          }
        }
      }
    }
  }

  private checkStoragePointers(
    context: AnalysisContext,
    contract: any,
    findings: Finding[]
  ): void {
    for (const fn of contract.functions) {
      if (!fn.hasBody) continue;
      const body = (fn.node as any).body;
      if (!body) continue;

      walkAST(body, (node: any) => {
        if (node.type === 'VariableDeclarationStatement') {
          for (const variable of node.variables || []) {
            if (!variable) continue;
            const typeName = variable.typeName;
            // Struct or array local variable without explicit storage location
            if (
              typeName &&
              (typeName.type === 'UserDefinedTypeName' || typeName.type === 'ArrayTypeName') &&
              !variable.storageLocation
            ) {
              findings.push(
                this.createFinding(context, {
                  title: `Potential uninitialized storage pointer in ${contract.name}.${fn.name}()`,
                  description:
                    `Local variable '${variable.name}' has no explicit data location. ` +
                    `In Solidity < 0.5.0, this defaults to storage, which can overwrite ` +
                    `state variables unexpectedly.`,
                  severity: Severity.HIGH,
                  confidence: Confidence.MEDIUM,
                  node,
                  recommendation:
                    'Explicitly declare data location (memory, storage, or calldata). ' +
                    'Upgrade to Solidity >= 0.5.0 which requires explicit data locations.',
                  references: [
                    'https://swcregistry.io/docs/SWC-109',
                  ],
                })
              );
            }
          }
        }
      });
    }
  }
}
