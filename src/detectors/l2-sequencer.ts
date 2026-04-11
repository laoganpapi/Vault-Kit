import { BaseDetector } from './base';
import { AnalysisContext } from '../core/context';
import { Finding, Severity, Confidence, VulnerabilityCategory } from '../core/types';
import { walkAST } from '../utils/ast-helpers';

const L2_SEQUENCER = 'L2 Sequencer Uptime' as VulnerabilityCategory;

/**
 * Detects missing L2 sequencer uptime checks on Chainlink oracles.
 *
 * On Arbitrum, Optimism, Base, and other L2s, Chainlink price feeds rely on
 * the sequencer being live. When the sequencer goes down:
 *   - Price feeds become stale
 *   - When it comes back up, prices jump to "real" values instantly
 *   - Users can front-run liquidations, arbitrage, or oracle updates
 *
 * Chainlink provides a "sequencer uptime feed" that reports:
 *   - answer: 1 if sequencer is down, 0 if up
 *   - startedAt: when the current status started
 *
 * Protocols must check this feed AND enforce a grace period after recovery
 * before allowing price-dependent operations.
 */
export class L2SequencerDetector extends BaseDetector {
  readonly id = 'l2-sequencer';
  readonly name = 'L2 Sequencer Uptime Check';
  readonly description = 'Detects Chainlink oracle usage on L2s without sequencer uptime validation';
  readonly category = L2_SEQUENCER;
  readonly defaultSeverity = Severity.HIGH;

  detect(context: AnalysisContext): Finding[] {
    const findings: Finding[] = [];

    // Only check contracts that use Chainlink-style oracles
    for (const contract of context.contracts) {
      if (contract.kind === 'interface' || contract.kind === 'library') continue;

      const usesChainlink = this.usesChainlinkOracle(contract);
      if (!usesChainlink) continue;

      const hasSequencerCheck = this.checksSequencerUptime(contract, context);
      if (hasSequencerCheck) continue;

      // Only flag if the contract is intended for L2 (heuristic: name suggests Arbitrum/Optimism/Base)
      const contractNameLower = contract.name.toLowerCase();
      const l2Hint =
        contractNameLower.includes('arbitrum') ||
        contractNameLower.includes('optimism') ||
        contractNameLower.includes('base') ||
        contractNameLower.includes('l2');

      findings.push(
        this.createFinding(context, {
          title: `Missing L2 sequencer uptime check in ${contract.name}`,
          description:
            `Contract ${contract.name} uses Chainlink price feeds but does not validate that ` +
            `the L2 sequencer is live. On L2s (Arbitrum, Optimism, Base), if the sequencer ` +
            `goes offline, price feeds become stale. When the sequencer comes back online, ` +
            `prices update instantly, allowing attackers to front-run liquidations, execute ` +
            `arbitrage, or manipulate oracle-dependent operations.` +
            (l2Hint ? ' The contract name suggests it is deployed on an L2.' : ''),
          severity: l2Hint ? Severity.HIGH : Severity.MEDIUM,
          confidence: l2Hint ? Confidence.MEDIUM : Confidence.LOW,
          node: contract.node,
          recommendation:
            'Check the Chainlink sequencer uptime feed before using price data:\n' +
            '  (,int256 answer, uint256 startedAt,,) = sequencerUptimeFeed.latestRoundData();\n' +
            '  require(answer == 0, "Sequencer down");\n' +
            '  require(block.timestamp - startedAt > GRACE_PERIOD, "Grace period not over");\n' +
            'Grace periods of 1 hour are typical to let price feeds catch up.',
          references: [
            'https://docs.chain.link/data-feeds/l2-sequencer-feeds',
          ],
        })
      );
    }

    return findings;
  }

  private usesChainlinkOracle(contract: any): boolean {
    // Check for latestRoundData or aggregator interface references
    for (const v of contract.stateVariables) {
      const type = v.typeName.toLowerCase();
      if (type.includes('aggregator') || type.includes('pricefeed') || type.includes('chainlink')) {
        return true;
      }
    }

    for (const fn of contract.functions) {
      if (!fn.hasBody) continue;
      const body = (fn.node as any).body;
      if (!body) continue;

      let found = false;
      walkAST(body, (node: any) => {
        if (found) return;
        if (node.type === 'FunctionCall' && node.expression?.type === 'MemberAccess') {
          if (['latestRoundData', 'latestAnswer'].includes(node.expression.memberName)) {
            found = true;
          }
        }
      });
      if (found) return true;
    }
    return false;
  }

  private checksSequencerUptime(contract: any, context: AnalysisContext): boolean {
    // Look for references to sequencer uptime patterns
    const src = context.source.toLowerCase();
    if (
      src.includes('sequenceruptime') ||
      src.includes('sequencer_uptime') ||
      src.includes('sequencerfeed') ||
      src.includes('graceperiod')
    ) {
      return true;
    }

    // Also check state variables
    for (const v of contract.stateVariables) {
      const name = v.name.toLowerCase();
      if (name.includes('sequencer') || name.includes('uptime')) return true;
    }

    return false;
  }
}
