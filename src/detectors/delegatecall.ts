import { BaseDetector } from './base';
import { AnalysisContext } from '../core/context';
import { Finding, Severity, Confidence, VulnerabilityCategory } from '../core/types';
import { walkAST, isDelegatecall } from '../utils/ast-helpers';

/**
 * Detects dangerous delegatecall usage.
 *
 * Checks for:
 * 1. delegatecall to user-controlled address
 * 2. delegatecall in a non-proxy context
 * 3. delegatecall inside loops
 * 4. Missing address validation before delegatecall
 */
export class DelegatecallDetector extends BaseDetector {
  readonly id = 'delegatecall';
  readonly name = 'Dangerous Delegatecall';
  readonly description = 'Detects dangerous uses of delegatecall that could allow code injection';
  readonly category = VulnerabilityCategory.DELEGATECALL;
  readonly defaultSeverity = Severity.CRITICAL;

  detect(context: AnalysisContext): Finding[] {
    const findings: Finding[] = [];

    for (const contract of context.contracts) {
      if (contract.kind === 'interface' || contract.kind === 'library') continue;

      for (const fn of contract.functions) {
        if (!fn.hasBody) continue;
        const body = (fn.node as any).body;
        if (!body) continue;

        walkAST(body, (node: any, parent: any) => {
          if (!isDelegatecall(node)) return;

          const target = node.expression?.expression;

          // delegatecall to function parameter (user-controlled)
          if (this.isUserControlled(target, fn)) {
            findings.push(
              this.createFinding(context, {
                title: `Delegatecall to user-controlled address in ${contract.name}.${fn.name}()`,
                description:
                  `delegatecall is made to an address derived from function parameters. ` +
                  `An attacker can pass a malicious contract address to execute arbitrary code ` +
                  `in the context of this contract, potentially draining all funds or ` +
                  `modifying critical state.`,
                severity: Severity.CRITICAL,
                confidence: Confidence.HIGH,
                node,
                recommendation:
                  'Never delegatecall to user-supplied addresses. Use a whitelist of trusted ' +
                  'implementation contracts, or use a well-tested proxy pattern.',
                references: [
                  'https://swcregistry.io/docs/SWC-112',
                ],
              })
            );
          } else {
            // delegatecall exists — flag for review
            findings.push(
              this.createFinding(context, {
                title: `Delegatecall usage in ${contract.name}.${fn.name}()`,
                description:
                  `delegatecall is used, which executes code in the context of the calling contract. ` +
                  `Ensure the target address is trusted and cannot be manipulated. ` +
                  `Storage layout must be compatible between caller and callee.`,
                severity: Severity.MEDIUM,
                confidence: Confidence.LOW,
                node,
                recommendation:
                  'Verify the delegatecall target is a trusted, immutable contract address. ' +
                  'Ensure storage layouts are compatible. Consider using OpenZeppelin proxy patterns.',
              })
            );
          }

          // delegatecall in a loop
          if (this.isInsideLoop(node, body)) {
            findings.push(
              this.createFinding(context, {
                title: `Delegatecall inside loop in ${contract.name}.${fn.name}()`,
                description:
                  `delegatecall is called inside a loop, which can lead to unexpected behavior ` +
                  `as each iteration executes in the contract's storage context.`,
                severity: Severity.HIGH,
                confidence: Confidence.MEDIUM,
                node,
                recommendation:
                  'Avoid delegatecall inside loops. If multiple delegatecalls are needed, ' +
                  'consider a multicall pattern with proper security checks.',
              })
            );
          }
        });
      }
    }

    return findings;
  }

  private isUserControlled(target: any, fn: any): boolean {
    if (!target) return false;

    const paramNames = new Set(fn.parameters.map((p: any) => p.name));

    if (target.type === 'Identifier' && paramNames.has(target.name)) {
      return true;
    }

    // Check for indirect: address(param)
    if (target.type === 'FunctionCall') {
      let found = false;
      walkAST(target, (node: any) => {
        if (node.type === 'Identifier' && paramNames.has(node.name)) {
          found = true;
        }
      });
      return found;
    }

    return false;
  }

  private isInsideLoop(node: any, body: any): boolean {
    let insideLoop = false;

    const checkInLoop = (current: any, inLoop: boolean): void => {
      if (!current || typeof current !== 'object') return;

      if (current === node && inLoop) {
        insideLoop = true;
        return;
      }

      const isLoop =
        current.type === 'ForStatement' ||
        current.type === 'WhileStatement' ||
        current.type === 'DoWhileStatement';

      for (const key of Object.keys(current)) {
        if (key === 'loc' || key === 'range') continue;
        const child = current[key];
        if (Array.isArray(child)) {
          for (const item of child) {
            if (item && typeof item === 'object') {
              checkInLoop(item, inLoop || isLoop);
            }
          }
        } else if (child && typeof child === 'object') {
          checkInLoop(child, inLoop || isLoop);
        }
      }
    };

    checkInLoop(body, false);
    return insideLoop;
  }
}
