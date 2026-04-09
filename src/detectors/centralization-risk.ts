import { BaseDetector } from './base';
import { AnalysisContext } from '../core/context';
import { Finding, Severity, Confidence, VulnerabilityCategory } from '../core/types';
import { walkAST } from '../utils/ast-helpers';
import { isAccessControlModifier } from '../utils/patterns';

const CENTRALIZATION = 'Centralization Risk' as VulnerabilityCategory;

/**
 * Detects centralization risks in smart contracts.
 *
 * A key concern for DeFi protocols: single points of failure where one
 * privileged account can:
 * 1. Drain all funds
 * 2. Pause the protocol indefinitely
 * 3. Change critical parameters without timelock
 * 4. Upgrade to a malicious implementation
 * 5. Mint unlimited tokens
 *
 * These are not "bugs" but architectural concerns that users should be aware of.
 */
export class CentralizationRiskDetector extends BaseDetector {
  readonly id = 'centralization-risk';
  readonly name = 'Centralization Risk';
  readonly description = 'Identifies privileged operations that represent single points of failure';
  readonly category = CENTRALIZATION;
  readonly defaultSeverity = Severity.MEDIUM;

  private static readonly PRIVILEGE_PATTERNS: Array<{
    namePattern: RegExp;
    risk: string;
    severity: Severity;
  }> = [
    {
      namePattern: /^(emergency)?withdraw(all|funds|tokens|eth)?$/i,
      risk: 'can drain all funds from the contract',
      severity: Severity.HIGH,
    },
    {
      namePattern: /^(un)?pause$/i,
      risk: 'can freeze/unfreeze all protocol operations',
      severity: Severity.MEDIUM,
    },
    {
      namePattern: /^mint$/i,
      risk: 'can mint unlimited tokens, diluting all holders',
      severity: Severity.HIGH,
    },
    {
      namePattern: /^(set|change|update)(fee|rate|price|oracle|router)/i,
      risk: 'can modify critical protocol parameters',
      severity: Severity.MEDIUM,
    },
    {
      namePattern: /^(upgrade|set)(to|implementation|proxy)/i,
      risk: 'can upgrade the contract to arbitrary code',
      severity: Severity.HIGH,
    },
    {
      namePattern: /^(transfer|renounce|set)ownership/i,
      risk: 'can transfer ownership to a new address',
      severity: Severity.MEDIUM,
    },
    {
      namePattern: /^(add|remove|set)(whitelist|blacklist|minter|operator)/i,
      risk: 'can modify access permissions',
      severity: Severity.LOW,
    },
  ];

  detect(context: AnalysisContext): Finding[] {
    const findings: Finding[] = [];

    for (const contract of context.contracts) {
      if (contract.kind === 'interface' || contract.kind === 'library') continue;

      const privilegedFunctions: Array<{ fn: any; risk: string; severity: Severity }> = [];

      for (const fn of contract.functions) {
        if (!fn.hasBody || fn.isConstructor) continue;
        if (!context.isExternallyCallable(fn)) continue;

        // Only flag functions with access control (that's what makes them "privileged")
        const hasAccessControl = fn.modifiers.some((m: string) => isAccessControlModifier(m))
          || this.hasOwnerCheck(fn.node);

        if (!hasAccessControl) continue;

        for (const pattern of CentralizationRiskDetector.PRIVILEGE_PATTERNS) {
          if (pattern.namePattern.test(fn.name)) {
            privilegedFunctions.push({ fn, risk: pattern.risk, severity: pattern.severity });
            break;
          }
        }
      }

      if (privilegedFunctions.length === 0) continue;

      // Check for timelock protection
      const hasTimelock = this.hasTimelockPattern(contract, context);
      const hasMultisig = this.hasMultisigPattern(contract);

      for (const { fn, risk, severity } of privilegedFunctions) {
        const mitigated = hasTimelock || hasMultisig;
        const effectiveSeverity = mitigated ? Severity.INFORMATIONAL : severity;

        findings.push(
          this.createFinding(context, {
            title: `Centralization risk: ${contract.name}.${fn.name}()`,
            description:
              `Privileged function ${fn.name}() ${risk}. ` +
              `This is controlled by a single owner/admin account. ` +
              (mitigated
                ? 'A timelock or multisig pattern was detected, which mitigates the risk.'
                : 'No timelock or multi-signature mechanism was detected.') +
              ` If this account is compromised, an attacker could exploit this function.`,
            severity: effectiveSeverity,
            confidence: Confidence.HIGH,
            node: fn.node,
            recommendation:
              'Consider implementing:\n' +
              '1. A timelock (e.g., OpenZeppelin TimelockController) for parameter changes\n' +
              '2. Multi-signature wallet for admin operations\n' +
              '3. Governance voting for critical decisions\n' +
              '4. Maximum bounds on configurable parameters (e.g., max fee < 10%)',
          })
        );
      }

      // Report the overall centralization risk summary
      if (privilegedFunctions.length >= 3 && !hasTimelock && !hasMultisig) {
        findings.push(
          this.createFinding(context, {
            title: `High centralization in ${contract.name}`,
            description:
              `Contract ${contract.name} has ${privilegedFunctions.length} privileged functions ` +
              `controlled by a single owner/admin without timelock or multi-sig protection. ` +
              `This represents a significant centralization risk. Functions: ` +
              `${privilegedFunctions.map(p => p.fn.name + '()').join(', ')}.`,
            severity: Severity.HIGH,
            confidence: Confidence.MEDIUM,
            node: contract.node,
            recommendation:
              'Decentralize admin capabilities through:\n' +
              '- Governance token voting for critical changes\n' +
              '- TimelockController for delayed execution\n' +
              '- Multi-sig wallets (e.g., Gnosis Safe)\n' +
              '- Immutable parameters where possible',
          })
        );
      }
    }

    return findings;
  }

  private hasOwnerCheck(fnNode: any): boolean {
    let found = false;
    walkAST(fnNode, (node: any) => {
      if (found) return;
      if (node.type === 'FunctionCall') {
        const fn = node.expression;
        if (fn?.type === 'Identifier' && fn.name === 'require') {
          walkAST(node, (inner: any) => {
            if (inner.type === 'MemberAccess' &&
                inner.expression?.name === 'msg' &&
                inner.memberName === 'sender') {
              found = true;
            }
          });
        }
      }
    });
    return found;
  }

  private hasTimelockPattern(contract: any, context: AnalysisContext): boolean {
    // Check base contracts for timelock
    const bases = contract.baseContracts.map((b: string) => b.toLowerCase());
    if (bases.some((b: string) => b.includes('timelock') || b.includes('timelocked'))) return true;

    // Check for timelock state variables
    return contract.stateVariables.some((v: any) =>
      v.name.toLowerCase().includes('timelock') ||
      v.name.toLowerCase().includes('delay') ||
      v.typeName.toLowerCase().includes('timelock')
    );
  }

  private hasMultisigPattern(contract: any): boolean {
    const bases = contract.baseContracts.map((b: string) => b.toLowerCase());
    return bases.some((b: string) =>
      b.includes('multisig') || b.includes('gnosis') || b.includes('safe')
    );
  }
}
