import { BaseDetector } from './base';
import { AnalysisContext } from '../core/context';
import { Finding, Severity, Confidence, VulnerabilityCategory } from '../core/types';
import { walkAST } from '../utils/ast-helpers';

const MISSING_EVENTS = 'Missing Event Emission' as VulnerabilityCategory;

/**
 * Detects missing event emissions on critical state changes.
 *
 * Events are crucial for:
 * 1. Off-chain monitoring and alerting
 * 2. Transaction indexing (The Graph, Etherscan)
 * 3. Audit trail for governance and compliance
 * 4. Frontend application reactivity
 *
 * State-changing functions that modify ownership, balances, configuration,
 * or access control should emit events.
 */
export class MissingEventsDetector extends BaseDetector {
  readonly id = 'missing-events';
  readonly name = 'Missing Event Emissions';
  readonly description = 'Detects state-changing functions that do not emit events for off-chain tracking';
  readonly category = MISSING_EVENTS;
  readonly defaultSeverity = Severity.LOW;

  private static readonly CRITICAL_STATE_PATTERNS = new Set([
    'owner', 'admin', 'operator', 'governance', 'guardian',
    'paused', 'fee', 'rate', 'price', 'threshold', 'limit',
    'implementation', 'proxy', 'oracle', 'router',
    'whitelist', 'blacklist', 'approved', 'minter',
  ]);

  detect(context: AnalysisContext): Finding[] {
    const findings: Finding[] = [];

    for (const contract of context.contracts) {
      if (contract.kind === 'interface' || contract.kind === 'library') continue;

      const eventNames = new Set(contract.events.map(e => e.name));

      for (const fn of contract.functions) {
        if (!fn.hasBody || fn.isConstructor) continue;
        if (!context.isExternallyCallable(fn)) continue;
        if (!context.isStateMutating(fn)) continue;

        const body = (fn.node as any).body;
        if (!body) continue;

        // Check if function emits any events
        const emitsEvent = this.emitsAnyEvent(body);

        // Check if function modifies critical state
        const modifiedVars = this.getModifiedStateVars(body, contract);
        const criticalMods = modifiedVars.filter(v =>
          MissingEventsDetector.CRITICAL_STATE_PATTERNS.has(v.toLowerCase()) ||
          this.isCriticalPattern(v)
        );

        if (criticalMods.length > 0 && !emitsEvent) {
          findings.push(
            this.createFinding(context, {
              title: `Missing event emission in ${contract.name}.${fn.name}()`,
              description:
                `Function ${fn.name}() modifies critical state variable(s) [${criticalMods.join(', ')}] ` +
                `but does not emit any events. This makes it impossible for off-chain systems ` +
                `to detect these changes, hindering monitoring, governance, and incident response.`,
              severity: Severity.LOW,
              confidence: Confidence.HIGH,
              node: fn.node,
              recommendation:
                `Define and emit an event for state changes in ${fn.name}(). Example:\n` +
                `event ${this.suggestEventName(fn.name)}(${this.suggestEventParams(criticalMods)});\n` +
                `Emit the event after the state change with old and new values.`,
            })
          );
        }

        // Check setter functions specifically (setX, updateX, changeX)
        const fnLower = fn.name.toLowerCase();
        const isSetter = fnLower.startsWith('set') || fnLower.startsWith('update') ||
                         fnLower.startsWith('change') || fnLower.startsWith('configure');

        if (isSetter && !emitsEvent && modifiedVars.length > 0) {
          if (criticalMods.length === 0) { // Avoid duplicate findings
            findings.push(
              this.createFinding(context, {
                title: `Setter ${contract.name}.${fn.name}() missing event`,
                description:
                  `Setter function ${fn.name}() modifies state but emits no event. ` +
                  `Configuration changes should be logged for transparency and monitoring.`,
                severity: Severity.INFORMATIONAL,
                confidence: Confidence.MEDIUM,
                node: fn.node,
                recommendation:
                  'Emit an event with the old and new values when configuration is changed.',
              })
            );
          }
        }
      }
    }

    return findings;
  }

  private emitsAnyEvent(body: any): boolean {
    let found = false;
    walkAST(body, (node: any) => {
      if (node.type === 'EmitStatement') found = true;
    });
    return found;
  }

  private getModifiedStateVars(body: any, contract: any): string[] {
    const stateVarNames = new Set(contract.stateVariables.map((v: any) => v.name));
    const modified: string[] = [];

    walkAST(body, (node: any) => {
      if (node.type === 'BinaryOperation' && this.isAssignmentOp(node.operator)) {
        const left = node.left;
        if (left?.type === 'Identifier' && stateVarNames.has(left.name)) {
          if (!modified.includes(left.name)) modified.push(left.name);
        }
        if (left?.type === 'IndexAccess' && left.base?.type === 'Identifier' && stateVarNames.has(left.base.name)) {
          if (!modified.includes(left.base.name)) modified.push(left.base.name);
        }
      }
    });

    return modified;
  }

  private isAssignmentOp(op: string): boolean {
    return ['=', '+=', '-=', '*=', '/=', '|=', '&=', '^='].includes(op);
  }

  private isCriticalPattern(name: string): boolean {
    const lower = name.toLowerCase();
    return lower.includes('owner') || lower.includes('admin') ||
           lower.includes('fee') || lower.includes('rate') ||
           lower.includes('price') || lower.includes('oracle') ||
           lower.includes('pause') || lower.includes('role');
  }

  private suggestEventName(fnName: string): string {
    // setFee -> FeeUpdated, transferOwnership -> OwnershipTransferred
    const name = fnName.replace(/^(set|update|change|configure)/, '');
    if (name.length === 0) return 'StateUpdated';
    return name[0].toUpperCase() + name.slice(1) + 'Updated';
  }

  private suggestEventParams(vars: string[]): string {
    return vars.map(v => `${v} old${v[0].toUpperCase() + v.slice(1)}, ${v} new${v[0].toUpperCase() + v.slice(1)}`).join(', ');
  }
}
