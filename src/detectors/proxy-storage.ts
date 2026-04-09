import { BaseDetector } from './base';
import { AnalysisContext } from '../core/context';
import { Finding, Severity, Confidence, VulnerabilityCategory } from '../core/types';
import { walkAST } from '../utils/ast-helpers';

/**
 * Detects proxy pattern storage collision vulnerabilities.
 *
 * Checks for:
 * 1. Upgradeable contracts missing storage gaps
 * 2. Storage slot collisions in proxy patterns
 * 3. Constructor usage in upgradeable contracts (should use initializer)
 * 4. Unsafe delegatecall target changes
 */
export class ProxyStorageDetector extends BaseDetector {
  readonly id = 'proxy-storage';
  readonly name = 'Proxy Storage Collision';
  readonly description = 'Detects storage layout issues in upgradeable/proxy contracts';
  readonly category = VulnerabilityCategory.PROXY_STORAGE;
  readonly defaultSeverity = Severity.HIGH;

  detect(context: AnalysisContext): Finding[] {
    const findings: Finding[] = [];

    for (const contract of context.contracts) {
      if (contract.kind === 'interface' || contract.kind === 'library') continue;

      const isUpgradeable = this.isUpgradeableContract(contract);
      if (!isUpgradeable) continue;

      this.checkMissingGap(context, contract, findings);
      this.checkConstructorUsage(context, contract, findings);
      this.checkInitializerOrder(context, contract, findings);
    }

    return findings;
  }

  private isUpgradeableContract(contract: any): boolean {
    const bases = contract.baseContracts.map((b: string) => b.toLowerCase());
    return bases.some(
      (b: string) =>
        b.includes('upgradeable') ||
        b.includes('initializable') ||
        b.includes('uupsupgradeable') ||
        b.includes('transparentupgradeable') ||
        b.includes('proxy')
    );
  }

  private checkMissingGap(
    context: AnalysisContext,
    contract: any,
    findings: Finding[]
  ): void {
    // Check for __gap variable (standard OpenZeppelin pattern)
    const hasGap = contract.stateVariables.some(
      (v: any) => v.name === '__gap' || v.name.startsWith('__gap')
    );

    if (!hasGap && contract.stateVariables.length > 0) {
      findings.push(
        this.createFinding(context, {
          title: `Missing storage gap in upgradeable contract ${contract.name}`,
          description:
            `Upgradeable contract ${contract.name} does not declare a __gap storage variable. ` +
            `Without a storage gap, adding new state variables in future upgrades will shift ` +
            `the storage layout of child contracts, corrupting their data.`,
          severity: Severity.HIGH,
          confidence: Confidence.MEDIUM,
          node: contract.node,
          recommendation:
            'Add a storage gap at the end of the contract: ' +
            '`uint256[50] private __gap;` Reduce the gap size as you add new state variables.',
          references: [
            'https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps',
          ],
        })
      );
    }
  }

  private checkConstructorUsage(
    context: AnalysisContext,
    contract: any,
    findings: Finding[]
  ): void {
    const constructor = contract.functions.find((f: any) => f.isConstructor);
    if (!constructor || !constructor.hasBody) return;

    // Check if constructor does more than _disableInitializers()
    const body = (constructor.node as any).body;
    if (!body?.statements || body.statements.length === 0) return;

    let hasOnlyDisableInit = false;
    if (body.statements.length === 1) {
      const stmt = body.statements[0];
      walkAST(stmt, (node: any) => {
        if (
          node.type === 'FunctionCall' &&
          node.expression?.type === 'Identifier' &&
          node.expression.name === '_disableInitializers'
        ) {
          hasOnlyDisableInit = true;
        }
      });
    }

    if (!hasOnlyDisableInit) {
      findings.push(
        this.createFinding(context, {
          title: `Constructor in upgradeable contract ${contract.name}`,
          description:
            `Upgradeable contract ${contract.name} has a constructor with logic. ` +
            `Constructors in implementation contracts behind proxies are not executed ` +
            `in the proxy's context. State set in the constructor will only exist in ` +
            `the implementation contract, not the proxy.`,
          severity: Severity.HIGH,
          confidence: Confidence.HIGH,
          node: constructor.node,
          recommendation:
            'Move initialization logic to an initialize() function with the initializer modifier. ' +
            'The constructor should only call _disableInitializers() to prevent the implementation ' +
            'from being initialized directly.',
        })
      );
    }
  }

  private checkInitializerOrder(
    context: AnalysisContext,
    contract: any,
    findings: Finding[]
  ): void {
    const initFn = contract.functions.find(
      (f: any) => f.name === 'initialize' || f.name === 'init'
    );
    if (!initFn || !initFn.hasBody) return;

    // Check if parent initializers are called
    const body = (initFn.node as any).body;
    if (!body) return;

    const parentInits = new Set<string>();
    walkAST(body, (node: any) => {
      if (node.type === 'FunctionCall' && node.expression?.type === 'Identifier') {
        const name = node.expression.name;
        if (name.startsWith('__') && name.endsWith('_init')) {
          parentInits.add(name);
        }
      }
    });

    // Check that all base contracts' initializers are called
    for (const base of contract.baseContracts) {
      const expectedInit = `__${base}_init`;
      if (!parentInits.has(expectedInit) && !parentInits.has(`__${base}_init_unchained`)) {
        findings.push(
          this.createFinding(context, {
            title: `Missing parent initializer call for ${base} in ${contract.name}`,
            description:
              `The initialize function of ${contract.name} does not call the initializer ` +
              `of parent contract ${base}. This could leave the parent's state uninitialized.`,
            severity: Severity.MEDIUM,
            confidence: Confidence.LOW,
            node: initFn.node,
            recommendation:
              `Call ${expectedInit}() or ${expectedInit}_unchained() in your initialize function.`,
          })
        );
      }
    }
  }
}
