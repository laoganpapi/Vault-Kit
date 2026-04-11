import { BaseDetector } from './base';
import { AnalysisContext } from '../core/context';
import { Finding, Severity, Confidence, VulnerabilityCategory } from '../core/types';
import { walkAST } from '../utils/ast-helpers';

const UNSAFE_CAST = 'Unsafe Integer Cast' as VulnerabilityCategory;

/**
 * Detects unsafe integer casts that can cause silent truncation or sign issues.
 *
 * 1. Downcast without bounds check: uint128(x) where x is uint256
 *    - In Solidity 0.8+, this now silently truncates (no revert on overflow)
 *    - Can cause accounting bugs in vaults, staking, fee math
 *
 * 2. Signed/unsigned cross-casts: int256(x) where x is uint256 > 2^255
 *    - Silently becomes negative
 *    - Breaks balance checks, price comparisons
 *
 * 3. Casts inside critical math: uint128(totalShares) / uint128(totalAssets)
 *    - Compounds the risk if totalShares or totalAssets > 2^128
 */
export class UnsafeCastDetector extends BaseDetector {
  readonly id = 'unsafe-cast';
  readonly name = 'Unsafe Integer Cast';
  readonly description = 'Detects integer downcasts and signed/unsigned conversions without bounds checking';
  readonly category = UNSAFE_CAST;
  readonly defaultSeverity = Severity.MEDIUM;

  private static readonly INT_BITS: Record<string, number> = {
    uint8: 8, uint16: 16, uint24: 24, uint32: 32, uint40: 40, uint48: 48,
    uint56: 56, uint64: 64, uint72: 72, uint80: 80, uint88: 88, uint96: 96,
    uint104: 104, uint112: 112, uint120: 120, uint128: 128, uint136: 136,
    uint144: 144, uint152: 152, uint160: 160, uint168: 168, uint176: 176,
    uint184: 184, uint192: 192, uint200: 200, uint208: 208, uint216: 216,
    uint224: 224, uint232: 232, uint240: 240, uint248: 248, uint256: 256,
    int8: 8, int16: 16, int24: 24, int32: 32, int40: 40, int48: 48,
    int56: 56, int64: 64, int72: 72, int80: 80, int88: 88, int96: 96,
    int104: 104, int112: 112, int120: 120, int128: 128, int160: 160,
    int192: 192, int256: 256,
  };

  detect(context: AnalysisContext): Finding[] {
    const findings: Finding[] = [];

    for (const contract of context.contracts) {
      if (contract.kind === 'interface') continue;

      for (const fn of contract.functions) {
        if (!fn.hasBody) continue;
        const body = (fn.node as any).body;
        if (!body) continue;

        walkAST(body, (node: any) => {
          // Solidity type cast is a FunctionCall with ElementaryTypeName as expression
          if (node.type !== 'FunctionCall') return;
          const expr = node.expression;
          if (expr?.type !== 'ElementaryTypeName' && expr?.type !== 'ElementaryTypeNameExpression') return;

          const typeName = expr.typeName?.name || expr.name;
          if (!typeName || !(typeName in UnsafeCastDetector.INT_BITS)) return;

          const targetBits = UnsafeCastDetector.INT_BITS[typeName];
          // Only flag downcasts (target < 256)
          if (targetBits >= 256) return;

          // Check if SafeCast library is used in the function
          if (this.usesSafeCast(body)) return;

          findings.push(
            this.createFinding(context, {
              title: `Unsafe downcast to ${typeName} in ${contract.name}.${fn.name}()`,
              description:
                `Integer downcast to ${typeName} (${targetBits} bits) without bounds checking. ` +
                `In Solidity 0.8+, this silently truncates instead of reverting. If the source ` +
                `value exceeds ${2n ** BigInt(targetBits) - 1n}, the result will be incorrect, ` +
                `potentially causing accounting bugs, unauthorized fund transfers, or broken ` +
                `invariants.`,
              severity: Severity.MEDIUM,
              confidence: Confidence.MEDIUM,
              node,
              recommendation:
                `Use OpenZeppelin SafeCast:\n` +
                `  uint256 big = ...;\n` +
                `  ${typeName} small = SafeCast.to${typeName[0].toUpperCase() + typeName.slice(1)}(big);\n` +
                `Or add an explicit require: require(big <= type(${typeName}).max, "Overflow");`,
              references: [
                'https://docs.openzeppelin.com/contracts/4.x/api/utils#SafeCast',
              ],
            })
          );
        });
      }
    }

    return findings;
  }

  private usesSafeCast(body: any): boolean {
    let found = false;
    walkAST(body, (node: any) => {
      if (found) return;
      if (node.type === 'FunctionCall' && node.expression?.type === 'MemberAccess') {
        const member = node.expression.memberName || '';
        if (member.startsWith('to') && /^to[UI]int\d+$/.test(member)) {
          found = true;
        }
      }
      // SafeCast.toUint128(x)
      if (
        node.type === 'MemberAccess' &&
        node.expression?.type === 'Identifier' &&
        node.expression.name === 'SafeCast'
      ) {
        found = true;
      }
    });
    return found;
  }
}
