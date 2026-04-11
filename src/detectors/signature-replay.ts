import { BaseDetector } from './base';
import { AnalysisContext } from '../core/context';
import { Finding, Severity, Confidence, VulnerabilityCategory } from '../core/types';
import { walkAST } from '../utils/ast-helpers';

const SIGNATURE_REPLAY = 'Signature Replay' as VulnerabilityCategory;

/**
 * Detects signature replay vulnerabilities in contracts that accept signed messages.
 *
 * Common issues:
 *   1. Missing nonce — same signature can be used multiple times
 *   2. Missing deadline — signatures valid forever
 *   3. Missing chain ID (or EIP-712 domain separator) — signatures valid across chains
 *   4. Missing contract address in domain — signatures valid across deployments
 *   5. Using the same signature format for different operations
 */
export class SignatureReplayDetector extends BaseDetector {
  readonly id = 'signature-replay';
  readonly name = 'Signature Replay';
  readonly description = 'Detects signature verification without replay protection (nonce, deadline, domain)';
  readonly category = SIGNATURE_REPLAY;
  readonly defaultSeverity = Severity.HIGH;

  detect(context: AnalysisContext): Finding[] {
    const findings: Finding[] = [];

    for (const contract of context.contracts) {
      if (contract.kind === 'interface' || contract.kind === 'library') continue;

      for (const fn of contract.functions) {
        if (!fn.hasBody) continue;
        const body = (fn.node as any).body;
        if (!body) continue;

        // Check if function uses ecrecover or a signature library
        const usesSignature = this.usesSignatureVerification(body);
        if (!usesSignature) continue;

        this.checkSignatureHygiene(context, contract, fn, body, findings);
      }
    }

    return findings;
  }

  private usesSignatureVerification(body: any): boolean {
    let found = false;
    walkAST(body, (node: any) => {
      if (found) return;
      if (node.type === 'FunctionCall') {
        const expr = node.expression;
        // ecrecover(...)
        if (expr?.type === 'Identifier' && expr.name === 'ecrecover') {
          found = true;
        }
        // ECDSA.recover(...), SignatureChecker.isValidSignature(...), etc.
        if (expr?.type === 'MemberAccess') {
          const member = expr.memberName;
          if (['recover', 'isValidSignature', 'recoverSigner', 'isValidSignatureNow'].includes(member)) {
            found = true;
          }
        }
      }
    });
    return found;
  }

  private checkSignatureHygiene(
    context: AnalysisContext,
    contract: any,
    fn: any,
    body: any,
    findings: Finding[]
  ): void {
    // Check for nonce tracking
    const stateVarNames = new Set(contract.stateVariables.map((v: any) => v.name));
    const hasNonceParam = fn.parameters.some((p: any) =>
      p.name.toLowerCase().includes('nonce')
    );
    const hasNonceState = contract.stateVariables.some((v: any) =>
      v.name.toLowerCase().includes('nonce') || v.name.toLowerCase().includes('used')
    );

    // Check if nonce is actually incremented or marked used in this function
    let noncesIncremented = false;
    if (hasNonceState) {
      walkAST(body, (node: any) => {
        // Assignment forms: nonces[x] = y, nonces[x] += y
        if (
          node.type === 'BinaryOperation' &&
          (node.operator === '+=' || node.operator === '=') &&
          node.left
        ) {
          const leftName = this.getIdentifierName(node.left);
          if (leftName && (leftName.toLowerCase().includes('nonce') || leftName.toLowerCase().includes('used'))) {
            noncesIncremented = true;
          }
        }
        // Unary increment/decrement: nonces[x]++, ++nonces[x], nonces[x]--
        if (
          node.type === 'UnaryOperation' &&
          (node.operator === '++' || node.operator === '--')
        ) {
          const target = this.getIdentifierName(node.subExpression || node.subExpr);
          if (target && (target.toLowerCase().includes('nonce') || target.toLowerCase().includes('used'))) {
            noncesIncremented = true;
          }
        }
        // used[hash] = true pattern
        if (
          node.type === 'BinaryOperation' &&
          node.operator === '=' &&
          node.left?.type === 'IndexAccess' &&
          node.left.base?.type === 'Identifier'
        ) {
          const name = node.left.base.name.toLowerCase();
          if (name.includes('used') || name.includes('executed') || name.includes('processed')) {
            noncesIncremented = true;
          }
        }
      });
    }

    if (!hasNonceParam && !noncesIncremented) {
      findings.push(
        this.createFinding(context, {
          title: `Missing replay protection in ${contract.name}.${fn.name}()`,
          description:
            `Function ${fn.name}() verifies a signature but has no nonce parameter or ` +
            `nonce-tracking state variable. The same signature can be replayed indefinitely. ` +
            `An attacker can watch the mempool, capture a valid signature, and replay it.`,
          severity: Severity.HIGH,
          confidence: Confidence.MEDIUM,
          node: fn.node,
          recommendation:
            'Add replay protection using one of:\n' +
            '1. Per-account nonces: mapping(address => uint256) public nonces;\n' +
            '   require(_nonce == nonces[signer]++, "Invalid nonce");\n' +
            '2. Used-hash tracking: mapping(bytes32 => bool) public used;\n' +
            '   require(!used[hash], "Already used"); used[hash] = true;\n' +
            '3. Use OpenZeppelin Nonces or EIP712 contracts.',
          references: [
            'https://swcregistry.io/docs/SWC-121',
          ],
        })
      );
    }

    // Check for deadline
    const hasDeadlineParam = fn.parameters.some((p: any) => {
      const name = p.name.toLowerCase();
      return name.includes('deadline') || name.includes('expir') || name.includes('validuntil');
    });

    let checksTimestampAgainstDeadline = false;
    if (hasDeadlineParam) {
      walkAST(body, (node: any) => {
        if (
          node.type === 'BinaryOperation' &&
          ['<', '<=', '>', '>='].includes(node.operator)
        ) {
          let hasTimestamp = false;
          let hasDeadline = false;
          walkAST(node, (inner: any) => {
            if (
              inner.type === 'MemberAccess' &&
              inner.expression?.name === 'block' &&
              inner.memberName === 'timestamp'
            ) {
              hasTimestamp = true;
            }
            if (inner.type === 'Identifier') {
              const n = inner.name.toLowerCase();
              if (n.includes('deadline') || n.includes('expir') || n.includes('validuntil')) {
                hasDeadline = true;
              }
            }
          });
          if (hasTimestamp && hasDeadline) checksTimestampAgainstDeadline = true;
        }
      });
    }

    if (!hasDeadlineParam) {
      findings.push(
        this.createFinding(context, {
          title: `Missing deadline in signed operation: ${contract.name}.${fn.name}()`,
          description:
            `Function ${fn.name}() accepts a signature but has no deadline parameter. ` +
            `Signatures are valid forever, which means a user can never revoke a signed ` +
            `intent. If the signer's key is later compromised, all old signatures remain valid.`,
          severity: Severity.MEDIUM,
          confidence: Confidence.MEDIUM,
          node: fn.node,
          recommendation:
            'Add a deadline parameter: require(block.timestamp <= deadline, "Signature expired"); ' +
            'Include the deadline in the signed message hash.',
        })
      );
    } else if (!checksTimestampAgainstDeadline) {
      findings.push(
        this.createFinding(context, {
          title: `Deadline parameter not validated in ${contract.name}.${fn.name}()`,
          description:
            `Function ${fn.name}() has a deadline parameter but does not appear to validate ` +
            `it against block.timestamp. The deadline is ineffective.`,
          severity: Severity.HIGH,
          confidence: Confidence.LOW,
          node: fn.node,
          recommendation:
            'Add: require(block.timestamp <= deadline, "Signature expired");',
        })
      );
    }

    // Check for EIP-712 domain (prevents cross-chain/cross-contract replay)
    const usesDomainSeparator = this.usesDomainSeparator(body, contract);
    if (!usesDomainSeparator) {
      findings.push(
        this.createFinding(context, {
          title: `Missing EIP-712 domain separator in ${contract.name}.${fn.name}()`,
          description:
            `Function ${fn.name}() verifies a signature without using an EIP-712 domain separator. ` +
            `Without the domain separator (which includes chainId and contract address), ` +
            `the same signature could be valid on multiple chains or multiple deployments of ` +
            `the same contract.`,
          severity: Severity.MEDIUM,
          confidence: Confidence.LOW,
          node: fn.node,
          recommendation:
            'Implement EIP-712 using OpenZeppelin EIP712.sol. Include chainId and verifyingContract ' +
            'in the domain separator. Use _hashTypedDataV4() to compute the digest.',
          references: [
            'https://eips.ethereum.org/EIPS/eip-712',
          ],
        })
      );
    }
  }

  private getIdentifierName(node: any): string | null {
    if (!node) return null;
    if (node.type === 'Identifier') return node.name;
    if (node.type === 'IndexAccess' && node.base?.type === 'Identifier') return node.base.name;
    if (node.type === 'MemberAccess' && node.expression?.type === 'Identifier') return node.expression.name;
    return null;
  }

  private usesDomainSeparator(body: any, contract: any): boolean {
    // Look for references to DOMAIN_SEPARATOR, _domainSeparator, chainid, EIP712
    let found = false;
    walkAST(body, (node: any) => {
      if (found) return;
      if (node.type === 'Identifier') {
        const name = node.name.toLowerCase();
        if (
          name.includes('domain') ||
          name.includes('eip712') ||
          name === 'chainid'
        ) {
          found = true;
        }
      }
      if (node.type === 'MemberAccess') {
        const member = node.memberName?.toLowerCase() || '';
        if (member.includes('domain') || member === 'chainid') found = true;
      }
    });

    // Also check base contracts
    const bases = contract.baseContracts.map((b: string) => b.toLowerCase());
    if (bases.some((b: string) => b.includes('eip712') || b.includes('eip-712'))) {
      found = true;
    }

    return found;
  }
}
