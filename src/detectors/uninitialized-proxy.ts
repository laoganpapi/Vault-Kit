import { BaseDetector } from './base';
import { AnalysisContext } from '../core/context';
import { Finding, Severity, Confidence, VulnerabilityCategory } from '../core/types';
import { walkAST } from '../utils/ast-helpers';

const UNINITIALIZED_PROXY = 'Uninitialized Proxy Implementation' as VulnerabilityCategory;

/**
 * Detects implementation contracts behind a proxy that can be initialized
 * by anyone.
 *
 * In the transparent/UUPS proxy pattern, the implementation contract is
 * deployed separately from the proxy. If the implementation contract's
 * initialize() function is callable on the implementation itself (not just
 * through the proxy), an attacker can:
 *
 *   1. Call initialize() on the implementation, becoming its "owner"
 *   2. For UUPS: call upgradeTo() to destroy the implementation via
 *      selfdestruct in a malicious new implementation
 *   3. Brick all proxies pointing to this implementation
 *
 * Famous case: Parity multisig bug ($150M frozen) — the library contract's
 * initWallet() was callable, an attacker took ownership and called kill().
 *
 * Fix: Call _disableInitializers() in the constructor of the implementation.
 */
export class UninitializedProxyDetector extends BaseDetector {
  readonly id = 'uninitialized-proxy';
  readonly name = 'Uninitialized Proxy Implementation';
  readonly description = 'Detects UUPS/upgradeable implementations that do not disable initializers in their constructor';
  readonly category = UNINITIALIZED_PROXY;
  readonly defaultSeverity = Severity.HIGH;

  detect(context: AnalysisContext): Finding[] {
    const findings: Finding[] = [];

    for (const contract of context.contracts) {
      if (contract.kind === 'interface' || contract.kind === 'library') continue;

      const isUpgradeable = this.isUpgradeable(contract);
      if (!isUpgradeable) continue;

      const hasInitializer = this.hasInitializer(contract);
      if (!hasInitializer) continue;

      const disablesInitializers = this.disablesInitializersInConstructor(contract);

      if (!disablesInitializers) {
        findings.push(
          this.createFinding(context, {
            title: `Uninitialized implementation in ${contract.name}`,
            description:
              `Contract ${contract.name} is an upgradeable implementation with an initializer ` +
              `function, but its constructor does not call _disableInitializers(). An attacker ` +
              `can initialize the implementation contract directly (bypassing the proxy), ` +
              `take ownership, and potentially brick all proxies pointing to this implementation ` +
              `by calling upgradeTo() with a selfdestruct-ing new implementation.`,
            severity: Severity.HIGH,
            confidence: Confidence.MEDIUM,
            node: contract.node,
            recommendation:
              'Add this constructor to the implementation:\n' +
              '  /// @custom:oz-upgrades-unsafe-allow constructor\n' +
              '  constructor() { _disableInitializers(); }\n' +
              'This prevents initialize() from being called on the implementation directly.',
            references: [
              'https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract',
              'https://www.parity.io/blog/security-alert',
            ],
          })
        );
      }
    }

    return findings;
  }

  private isUpgradeable(contract: any): boolean {
    const bases = contract.baseContracts.map((b: string) => b.toLowerCase());
    return bases.some(
      (b: string) =>
        b.includes('upgradeable') ||
        b.includes('initializable') ||
        b.includes('uups') ||
        b === 'proxy'
    );
  }

  private hasInitializer(contract: any): boolean {
    return contract.functions.some(
      (f: any) => f.name === 'initialize' || f.name === 'init' ||
                  f.modifiers.some((m: string) => m.toLowerCase() === 'initializer')
    );
  }

  private disablesInitializersInConstructor(contract: any): boolean {
    const ctor = contract.functions.find((f: any) => f.isConstructor);
    if (!ctor?.hasBody) return false;

    const body = (ctor.node as any).body;
    if (!body) return false;

    let found = false;
    walkAST(body, (node: any) => {
      if (
        node.type === 'FunctionCall' &&
        node.expression?.type === 'Identifier' &&
        node.expression.name === '_disableInitializers'
      ) {
        found = true;
      }
    });
    return found;
  }
}
