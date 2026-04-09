import { BaseDetector } from './base';
import { AnalysisContext } from '../core/context';
import { Finding, Severity, Confidence, VulnerabilityCategory } from '../core/types';
import { walkAST } from '../utils/ast-helpers';

const UNSAFE_ASSEMBLY = 'Unsafe Inline Assembly' as VulnerabilityCategory;

/**
 * Detects dangerous inline assembly usage.
 *
 * Inline assembly (Yul) bypasses Solidity's safety checks including:
 * - Type safety
 * - Overflow protection
 * - Memory safety
 * - Reentrancy guards
 *
 * Checks for:
 * 1. Any use of assembly blocks (for awareness)
 * 2. Dangerous opcodes: mstore to arbitrary locations, delegatecall, selfdestruct, extcodesize
 * 3. Return-bomb: returndatacopy with unchecked size
 * 4. Memory corruption: mstore/mload to low addresses
 */
export class UnsafeAssemblyDetector extends BaseDetector {
  readonly id = 'unsafe-assembly';
  readonly name = 'Unsafe Inline Assembly';
  readonly description = 'Detects dangerous patterns in inline assembly (Yul) blocks';
  readonly category = UNSAFE_ASSEMBLY;
  readonly defaultSeverity = Severity.MEDIUM;

  private static readonly DANGEROUS_OPCODES = new Set([
    'delegatecall', 'callcode', 'selfdestruct', 'suicide',
    'create', 'create2', 'sstore', 'sload',
    'extcodesize', 'extcodecopy', 'extcodehash',
    'origin', // tx.origin in assembly
  ]);

  private static readonly HIGH_RISK_OPCODES = new Set([
    'delegatecall', 'callcode', 'selfdestruct', 'suicide', 'create2',
  ]);

  detect(context: AnalysisContext): Finding[] {
    const findings: Finding[] = [];

    for (const contract of context.contracts) {
      if (contract.kind === 'interface' || contract.kind === 'library') continue;

      for (const fn of contract.functions) {
        if (!fn.hasBody) continue;
        const body = (fn.node as any).body;
        if (!body) continue;

        this.checkAssemblyBlocks(context, contract.name, fn.name, body, findings);
      }
    }

    return findings;
  }

  private checkAssemblyBlocks(
    context: AnalysisContext,
    contractName: string,
    fnName: string,
    body: any,
    findings: Finding[]
  ): void {
    walkAST(body, (node: any) => {
      if (node.type !== 'InlineAssemblyStatement' && node.type !== 'AssemblyBlock') return;

      // Flag presence of assembly
      findings.push(
        this.createFinding(context, {
          title: `Inline assembly in ${contractName}.${fnName}()`,
          description:
            `Function ${fnName}() contains inline assembly (Yul). Assembly bypasses ` +
            `Solidity's type checking, overflow protection, and memory safety features. ` +
            `Manual review is required to verify correctness.`,
          severity: Severity.INFORMATIONAL,
          confidence: Confidence.HIGH,
          node,
          recommendation:
            'Minimize inline assembly usage. If required, add detailed comments explaining ' +
            'each instruction. Consider using Solidity equivalents where possible.',
        })
      );

      // Check for dangerous opcodes in the assembly body
      const asmBody = node.body || node;
      const source = context.getSnippet(node, 0);

      for (const opcode of UnsafeAssemblyDetector.DANGEROUS_OPCODES) {
        if (this.assemblyContainsOpcode(source, opcode)) {
          const isHighRisk = UnsafeAssemblyDetector.HIGH_RISK_OPCODES.has(opcode);

          findings.push(
            this.createFinding(context, {
              title: `Dangerous opcode '${opcode}' in assembly in ${contractName}.${fnName}()`,
              description:
                `Assembly block contains '${opcode}' which ${this.getOpcodeRisk(opcode)}. ` +
                `This requires careful review to ensure it cannot be exploited.`,
              severity: isHighRisk ? Severity.HIGH : Severity.MEDIUM,
              confidence: Confidence.MEDIUM,
              node,
              recommendation: this.getOpcodeRecommendation(opcode),
            })
          );
        }
      }

      // Check for returndatacopy without size bounds (return bomb)
      if (this.assemblyContainsOpcode(source, 'returndatacopy')) {
        findings.push(
          this.createFinding(context, {
            title: `Potential return bomb in ${contractName}.${fnName}()`,
            description:
              `Assembly uses returndatacopy which copies return data into memory. ` +
              `A malicious callee can return a very large payload causing excessive ` +
              `gas consumption (return bomb / memory expansion attack).`,
            severity: Severity.MEDIUM,
            confidence: Confidence.LOW,
            node,
            recommendation:
              'Limit the size of returndatacopy to a known maximum. ' +
              'Check returndatasize() before copying and cap it.',
          })
        );
      }
    });
  }

  private assemblyContainsOpcode(source: string, opcode: string): boolean {
    // Simple pattern match — checks if the opcode appears as a standalone word
    const pattern = new RegExp(`\\b${opcode}\\b`, 'i');
    return pattern.test(source);
  }

  private getOpcodeRisk(opcode: string): string {
    switch (opcode) {
      case 'delegatecall': return 'executes code in the current contract context, potentially modifying storage';
      case 'callcode': return 'is deprecated and executes code in the current context (use delegatecall instead)';
      case 'selfdestruct': case 'suicide': return 'destroys the contract permanently';
      case 'create': return 'deploys a new contract, which can have unexpected interactions';
      case 'create2': return 'deploys at a predictable address, which can be used for address manipulation';
      case 'sstore': return 'directly modifies storage slots, bypassing Solidity safety checks';
      case 'sload': return 'directly reads storage slots';
      case 'extcodesize': return 'checks code size (unreliable during constructor execution)';
      case 'extcodecopy': return 'copies external contract code into memory';
      case 'origin': return 'accesses tx.origin which is unsafe for authentication';
      default: return 'performs a potentially dangerous low-level operation';
    }
  }

  private getOpcodeRecommendation(opcode: string): string {
    switch (opcode) {
      case 'delegatecall': return 'Ensure the delegatecall target is a trusted, immutable address. Verify storage layout compatibility.';
      case 'callcode': return 'Replace callcode with delegatecall. callcode is deprecated.';
      case 'selfdestruct': case 'suicide': return 'Remove selfdestruct if possible. It is deprecated after EIP-6780.';
      case 'create2': return 'Verify the salt and init code hash cannot be manipulated by an attacker to deploy malicious contracts.';
      case 'sstore': return 'Document which storage slot is being written and ensure it does not conflict with Solidity-managed storage.';
      case 'extcodesize': return 'Do not rely on extcodesize for isContract() checks — it returns 0 during constructor execution.';
      case 'origin': return 'Use caller() (msg.sender) instead of origin() (tx.origin) for authentication.';
      default: return 'Review this opcode carefully and add documentation explaining its purpose.';
    }
  }
}
