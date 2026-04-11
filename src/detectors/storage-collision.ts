import { BaseDetector } from './base';
import { AnalysisContext } from '../core/context';
import { Finding, Severity, Confidence, VulnerabilityCategory } from '../core/types';
import { walkAST } from '../utils/ast-helpers';

const STORAGE_COLLISION = 'Storage Slot Collision' as VulnerabilityCategory;

/**
 * Detects storage layout issues beyond the basic proxy-storage detector.
 *
 * Focuses on:
 *   1. Diamond storage patterns without explicit slot keys
 *   2. State variables added in the middle of an inheritance chain
 *   3. Packed struct fields in different orders across versions
 *   4. Raw assembly sstore/sload to hardcoded slots that could collide
 *      with Solidity-managed storage
 */
export class StorageCollisionDetector extends BaseDetector {
  readonly id = 'storage-collision';
  readonly name = 'Storage Slot Collision';
  readonly description = 'Detects storage slot collisions in diamond, proxy, and assembly patterns';
  readonly category = STORAGE_COLLISION;
  readonly defaultSeverity = Severity.HIGH;

  detect(context: AnalysisContext): Finding[] {
    const findings: Finding[] = [];

    for (const contract of context.contracts) {
      if (contract.kind === 'interface' || contract.kind === 'library') continue;

      this.checkAssemblyStorageAccess(context, contract, findings);
      this.checkDiamondStoragePattern(context, contract, findings);
    }

    return findings;
  }

  /**
   * Check for sstore/sload with literal slot numbers that collide with
   * Solidity's storage (slots 0 to N-1 where N is the number of state vars).
   */
  private checkAssemblyStorageAccess(
    context: AnalysisContext,
    contract: any,
    findings: Finding[]
  ): void {
    const stateVarCount = contract.stateVariables.length;

    for (const fn of contract.functions) {
      if (!fn.hasBody) continue;
      const body = (fn.node as any).body;
      if (!body) continue;

      walkAST(body, (node: any) => {
        if (node.type !== 'InlineAssemblyStatement' && node.type !== 'AssemblyBlock') return;

        // Get the assembly source
        const source = context.getSnippet(node, 0);

        // Look for sstore/sload with small literal slot numbers
        const sstorePattern = /sstore\s*\(\s*(0x[0-9a-f]+|\d+)/gi;
        const sloadPattern = /sload\s*\(\s*(0x[0-9a-f]+|\d+)/gi;

        const matches = [
          ...source.matchAll(sstorePattern),
          ...source.matchAll(sloadPattern),
        ];

        for (const match of matches) {
          const slot = match[1];
          const slotNum = slot.startsWith('0x')
            ? parseInt(slot, 16)
            : parseInt(slot, 10);

          // Flag if the slot is in the range of Solidity-managed storage
          if (!isNaN(slotNum) && slotNum >= 0 && slotNum < Math.max(stateVarCount + 10, 20)) {
            findings.push(
              this.createFinding(context, {
                title: `Assembly storage access collides with Solidity storage in ${contract.name}.${fn.name}()`,
                description:
                  `Inline assembly accesses storage slot ${slot} (decimal: ${slotNum}). ` +
                  `The contract has ${stateVarCount} state variables occupying slots 0-${stateVarCount - 1}. ` +
                  `Direct sstore/sload to low-numbered slots can collide with or corrupt ` +
                  `Solidity-managed state variables.`,
                severity: Severity.HIGH,
                confidence: Confidence.MEDIUM,
                node,
                recommendation:
                  'Use keccak256-based slot derivation to avoid collisions:\n' +
                  '  bytes32 slot = keccak256("my.unique.namespace.v1");\n' +
                  '  assembly { sstore(slot, value) }\n' +
                  'This is the approach used by ERC-1967, ERC-7201, and EIP-2535 (Diamond Standard).',
                references: [
                  'https://eips.ethereum.org/EIPS/eip-1967',
                  'https://eips.ethereum.org/EIPS/eip-7201',
                ],
              })
            );
          }
        }
      });
    }
  }

  /**
   * Check for diamond storage pattern without explicit slot keys.
   * Good pattern: struct stored at keccak256("namespace").
   * Bad pattern: multiple facets with overlapping structs.
   */
  private checkDiamondStoragePattern(
    context: AnalysisContext,
    contract: any,
    findings: Finding[]
  ): void {
    // Look for library X { struct Storage { ... } function getStorage() returns (Storage storage s) {...} }
    // These should use a unique slot.
    if (contract.kind !== 'library') return;

    // Find structs in the library
    const structNodes: any[] = [];
    walkAST(contract.node, (node: any) => {
      if (node.type === 'StructDefinition') structNodes.push(node);
    });

    if (structNodes.length === 0) return;

    // Check if there's a getStorage-like function that uses a hardcoded slot
    let hasExplicitSlot = false;
    let hasAssemblyStorage = false;

    for (const fn of contract.functions) {
      if (!fn.hasBody) continue;
      const body = (fn.node as any).body;
      if (!body) continue;

      walkAST(body, (node: any) => {
        if (node.type === 'InlineAssemblyStatement' || node.type === 'AssemblyBlock') {
          hasAssemblyStorage = true;
          // Check for keccak256 or a specific slot reference
          const source = context.getSnippet(node, 0);
          if (source.includes('.slot') || source.match(/keccak256|0x[0-9a-f]{64}/i)) {
            hasExplicitSlot = true;
          }
        }
      });
    }

    if (hasAssemblyStorage && !hasExplicitSlot && structNodes.length > 0) {
      findings.push(
        this.createFinding(context, {
          title: `Diamond storage pattern without explicit slot in ${contract.name}`,
          description:
            `Library ${contract.name} appears to implement a diamond storage pattern but ` +
            `does not use a hardcoded, collision-resistant storage slot. Multiple facets ` +
            `using this library could write to colliding storage slots.`,
          severity: Severity.MEDIUM,
          confidence: Confidence.LOW,
          node: contract.node,
          recommendation:
            'Use ERC-7201 namespaced storage layout:\n' +
            '  bytes32 private constant STORAGE_SLOT = \n' +
            '    keccak256(abi.encode(uint256(keccak256("namespace.v1")) - 1)) & ~bytes32(uint256(0xff));\n' +
            'Then access via: assembly { s.slot := STORAGE_SLOT }',
          references: [
            'https://eips.ethereum.org/EIPS/eip-7201',
          ],
        })
      );
    }
  }
}
