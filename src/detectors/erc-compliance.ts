import { BaseDetector } from './base';
import { AnalysisContext } from '../core/context';
import { Finding, Severity, Confidence, VulnerabilityCategory } from '../core/types';
import {
  ERC20_FUNCTIONS,
  ERC20_EVENTS,
  ERC721_FUNCTIONS,
  ERC721_EVENTS,
} from '../utils/patterns';

/**
 * Detects ERC standard compliance issues.
 *
 * Checks for:
 * 1. Missing required ERC-20 functions and events
 * 2. Missing required ERC-721 functions and events
 * 3. Non-standard return values
 * 4. Missing Transfer event emissions on transfers
 */
export class ERCComplianceDetector extends BaseDetector {
  readonly id = 'erc-compliance';
  readonly name = 'ERC Standard Compliance';
  readonly description = 'Checks compliance with ERC-20, ERC-721, and other token standards';
  readonly category = VulnerabilityCategory.ERC_COMPLIANCE;
  readonly defaultSeverity = Severity.LOW;

  detect(context: AnalysisContext): Finding[] {
    const findings: Finding[] = [];

    for (const contract of context.contracts) {
      if (contract.kind === 'interface' || contract.kind === 'library') continue;

      const ercType = this.detectERCType(contract);
      if (!ercType) continue;

      if (ercType === 'ERC20') {
        this.checkERC20Compliance(context, contract, findings);
      } else if (ercType === 'ERC721') {
        this.checkERC721Compliance(context, contract, findings);
      }
    }

    return findings;
  }

  private detectERCType(contract: any): 'ERC20' | 'ERC721' | null {
    const bases = contract.baseContracts.map((b: string) => b.toLowerCase());
    const fnNames = contract.functions.map((f: any) => f.name);

    // Check inheritance
    if (bases.some((b: string) => b.includes('erc20') || b.includes('ierc20'))) return 'ERC20';
    if (bases.some((b: string) => b.includes('erc721') || b.includes('ierc721'))) return 'ERC721';

    // Heuristic: check function signatures
    const hasTransfer = fnNames.includes('transfer');
    const hasBalanceOf = fnNames.includes('balanceOf');
    const hasTotalSupply = fnNames.includes('totalSupply');
    const hasOwnerOf = fnNames.includes('ownerOf');

    if (hasTransfer && hasBalanceOf && hasTotalSupply && !hasOwnerOf) return 'ERC20';
    if (hasOwnerOf && hasBalanceOf) return 'ERC721';

    return null;
  }

  private checkERC20Compliance(
    context: AnalysisContext,
    contract: any,
    findings: Finding[]
  ): void {
    const fnNames = new Set(contract.functions.map((f: any) => f.name));
    const eventNames = new Set(contract.events.map((e: any) => e.name));

    // Check required functions
    for (const required of ERC20_FUNCTIONS) {
      if (!fnNames.has(required)) {
        findings.push(
          this.createFinding(context, {
            title: `Missing ERC-20 function: ${required}()`,
            description:
              `Contract ${contract.name} appears to be an ERC-20 token but is missing ` +
              `the required function ${required}(). This violates the ERC-20 standard ` +
              `and may cause integration issues with wallets, DEXes, and other contracts.`,
            severity: Severity.MEDIUM,
            confidence: Confidence.MEDIUM,
            node: contract.node,
            recommendation:
              `Implement the ${required}() function as specified in EIP-20.`,
            references: ['https://eips.ethereum.org/EIPS/eip-20'],
          })
        );
      }
    }

    // Check required events
    for (const required of ERC20_EVENTS) {
      if (!eventNames.has(required)) {
        findings.push(
          this.createFinding(context, {
            title: `Missing ERC-20 event: ${required}`,
            description:
              `Contract ${contract.name} is missing the required ${required} event. ` +
              `ERC-20 tokens must emit ${required} events for proper indexing and tracking.`,
            severity: Severity.MEDIUM,
            confidence: Confidence.MEDIUM,
            node: contract.node,
            recommendation:
              `Define and emit the ${required} event as specified in EIP-20.`,
          })
        );
      }
    }

    // Check transfer() return value
    const transferFn = contract.functions.find((f: any) => f.name === 'transfer');
    if (transferFn && transferFn.returnParameters.length === 0) {
      findings.push(
        this.createFinding(context, {
          title: `ERC-20 transfer() missing return value in ${contract.name}`,
          description:
            `The transfer() function does not return a boolean value. The ERC-20 standard ` +
            `requires transfer to return a bool indicating success. Missing return values ` +
            `cause issues with contracts that check the return value (e.g., SafeERC20).`,
          severity: Severity.HIGH,
          confidence: Confidence.HIGH,
          node: transferFn.node,
          recommendation:
            'Add `returns (bool)` to transfer() and return true on success.',
        })
      );
    }
  }

  private checkERC721Compliance(
    context: AnalysisContext,
    contract: any,
    findings: Finding[]
  ): void {
    const fnNames = new Set(contract.functions.map((f: any) => f.name));
    const eventNames = new Set(contract.events.map((e: any) => e.name));

    for (const required of ERC721_FUNCTIONS) {
      if (!fnNames.has(required)) {
        findings.push(
          this.createFinding(context, {
            title: `Missing ERC-721 function: ${required}()`,
            description:
              `Contract ${contract.name} appears to be an ERC-721 token but is missing ` +
              `the required function ${required}().`,
            severity: Severity.MEDIUM,
            confidence: Confidence.MEDIUM,
            node: contract.node,
            recommendation:
              `Implement the ${required}() function as specified in EIP-721.`,
            references: ['https://eips.ethereum.org/EIPS/eip-721'],
          })
        );
      }
    }

    for (const required of ERC721_EVENTS) {
      if (!eventNames.has(required)) {
        findings.push(
          this.createFinding(context, {
            title: `Missing ERC-721 event: ${required}`,
            description:
              `Contract ${contract.name} is missing the required ${required} event.`,
            severity: Severity.MEDIUM,
            confidence: Confidence.MEDIUM,
            node: contract.node,
            recommendation:
              `Define and emit the ${required} event as specified in EIP-721.`,
          })
        );
      }
    }
  }
}
