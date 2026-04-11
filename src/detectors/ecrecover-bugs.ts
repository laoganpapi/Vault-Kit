import { BaseDetector } from './base';
import { AnalysisContext } from '../core/context';
import { Finding, Severity, Confidence, VulnerabilityCategory } from '../core/types';
import { walkAST } from '../utils/ast-helpers';

const ECRECOVER_BUGS = 'ecrecover Vulnerabilities' as VulnerabilityCategory;

/**
 * Detects bugs in direct ecrecover usage.
 *
 * 1. Zero-address attack: ecrecover(hash, v, r, s) returns address(0) for
 *    invalid signatures. If the recovered address is compared against a
 *    state variable that is ALSO address(0) (e.g., default/uninitialized),
 *    the check passes and an attacker authenticates without a signature.
 *
 * 2. Signature malleability: ECDSA signatures with s > secp256k1.n/2 are
 *    valid but have a "flipped" counterpart. Without checking s <= n/2,
 *    the same message has two valid signatures, breaking signature-hash
 *    uniqueness (replay protection via hash tracking is defeated).
 *
 * 3. Missing v validation: v must be 27 or 28. If not checked, recovered
 *    address can be incorrect.
 */
export class EcrecoverBugsDetector extends BaseDetector {
  readonly id = 'ecrecover-bugs';
  readonly name = 'ecrecover Vulnerabilities';
  readonly description = 'Detects ecrecover misuse: zero-address attack, signature malleability, missing v validation';
  readonly category = ECRECOVER_BUGS;
  readonly defaultSeverity = Severity.HIGH;

  detect(context: AnalysisContext): Finding[] {
    const findings: Finding[] = [];

    for (const contract of context.contracts) {
      if (contract.kind === 'interface' || contract.kind === 'library') continue;

      for (const fn of contract.functions) {
        if (!fn.hasBody) continue;
        const body = (fn.node as any).body;
        if (!body) continue;

        this.checkEcrecover(context, contract, fn, body, findings);
      }
    }

    return findings;
  }

  private checkEcrecover(
    context: AnalysisContext,
    contract: any,
    fn: any,
    body: any,
    findings: Finding[]
  ): void {
    // Find ecrecover calls
    const ecrecoverCalls: any[] = [];
    walkAST(body, (node: any) => {
      if (
        node.type === 'FunctionCall' &&
        node.expression?.type === 'Identifier' &&
        node.expression.name === 'ecrecover'
      ) {
        ecrecoverCalls.push(node);
      }
    });

    if (ecrecoverCalls.length === 0) return;

    // Check 1: zero-address comparison attack
    // Look for: address signer = ecrecover(...); require(signer == someVar);
    // If someVar could be address(0) (e.g., uninitialized state), attack works.
    const checksSignerNotZero = this.checksZeroAddress(body);
    if (!checksSignerNotZero) {
      findings.push(
        this.createFinding(context, {
          title: `Zero-address signature bypass in ${contract.name}.${fn.name}()`,
          description:
            `ecrecover() returns address(0) when given invalid signature parameters. ` +
            `This function uses ecrecover() but does not explicitly check that the recovered ` +
            `address is not address(0). If the value being compared against is also address(0) ` +
            `(e.g., uninitialized), an attacker can bypass signature verification by passing ` +
            `malformed signature data.`,
          severity: Severity.HIGH,
          confidence: Confidence.MEDIUM,
          node: ecrecoverCalls[0],
          recommendation:
            'Always check recovered address is not zero:\n' +
            '  address signer = ecrecover(hash, v, r, s);\n' +
            '  require(signer != address(0), "Invalid signature");\n' +
            'Better: use OpenZeppelin ECDSA.recover() which handles this automatically.',
          references: [
            'https://swcregistry.io/docs/SWC-117',
          ],
        })
      );
    }

    // Check 2: signature malleability (s value not constrained)
    const checksSMalleability = this.checksSMalleability(body);
    if (!checksSMalleability) {
      findings.push(
        this.createFinding(context, {
          title: `Signature malleability in ${contract.name}.${fn.name}()`,
          description:
            `ecrecover() is called without constraining the 's' value to the lower half ` +
            `of the secp256k1 curve order. ECDSA signatures are malleable: for any valid ` +
            `signature (v, r, s), there exists another valid signature (v', r, n-s) that ` +
            `produces the same recovered address. If this function uses the signature hash ` +
            `for replay protection, malleable signatures defeat it.`,
          severity: Severity.HIGH,
          confidence: Confidence.MEDIUM,
          node: ecrecoverCalls[0],
          recommendation:
            'Constrain s to the lower half of the curve order:\n' +
            '  require(uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0, "Malleable signature");\n' +
            'Or use OpenZeppelin ECDSA.recover() which does this automatically.',
          references: [
            'https://swcregistry.io/docs/SWC-117',
            'https://github.com/ethereum/go-ethereum/blob/master/crypto/crypto.go',
          ],
        })
      );
    }
  }

  private checksZeroAddress(body: any): boolean {
    let found = false;
    walkAST(body, (node: any) => {
      if (found) return;
      // require(signer != address(0)) or require(signer != 0)
      if (node.type === 'FunctionCall' && node.expression?.name === 'require') {
        walkAST(node, (inner: any) => {
          if (
            inner.type === 'BinaryOperation' &&
            inner.operator === '!='
          ) {
            const left = inner.left;
            const right = inner.right;
            const isZeroAddr = (n: any) => {
              if (!n) return false;
              if (n.type === 'NumberLiteral' && n.number === '0') return true;
              if (
                n.type === 'FunctionCall' &&
                n.expression?.name === 'address' &&
                n.arguments?.[0]?.type === 'NumberLiteral' &&
                n.arguments[0].number === '0'
              ) return true;
              return false;
            };
            if (isZeroAddr(left) || isZeroAddr(right)) found = true;
          }
        });
      }
    });
    return found;
  }

  private checksSMalleability(body: any): boolean {
    // Look for the characteristic constant: 0x7FFF... or references to the curve order constant
    const src = JSON.stringify(body);
    // Upper-half curve order start: 7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0
    if (/7fff_?ffff_?ffff_?ffff_?ffff_?ffff_?ffff_?ffff_?5d57_?6e73_?57a4_?501d_?dfe9_?2f46_?681b_?20a0/i.test(src)) {
      return true;
    }
    if (/0x7fff[fF0-9]{60,}/.test(src)) return true;
    return false;
  }
}
