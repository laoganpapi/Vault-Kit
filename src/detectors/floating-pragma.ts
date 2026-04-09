import { BaseDetector } from './base';
import { AnalysisContext } from '../core/context';
import { Finding, Severity, Confidence, VulnerabilityCategory } from '../core/types';

/**
 * Detects floating pragma versions.
 *
 * Contracts should be deployed with the same compiler version they were tested with.
 * Floating pragmas (^, >=, >) allow deployment with untested compiler versions.
 */
export class FloatingPragmaDetector extends BaseDetector {
  readonly id = 'floating-pragma';
  readonly name = 'Floating Pragma';
  readonly description = 'Detects floating pragma directives that allow compilation with untested compiler versions';
  readonly category = VulnerabilityCategory.FLOATING_PRAGMA;
  readonly defaultSeverity = Severity.INFORMATIONAL;

  detect(context: AnalysisContext): Finding[] {
    const findings: Finding[] = [];

    for (const pragma of context.file.pragmas) {
      if (pragma.name !== 'solidity') continue;

      const value = pragma.value;

      if (value.includes('^') || value.includes('>') || value.includes('>=')) {
        findings.push(
          this.createFinding(context, {
            title: `Floating pragma: solidity ${value}`,
            description:
              `The pragma directive 'pragma solidity ${value}' allows compilation with ` +
              `multiple compiler versions. This can lead to the contract being deployed with ` +
              `a different compiler version than it was tested with, potentially introducing ` +
              `bugs or unexpected behavior.`,
            severity: Severity.INFORMATIONAL,
            confidence: Confidence.HIGH,
            node: pragma.node,
            recommendation:
              'Lock the pragma to a specific compiler version (e.g., `pragma solidity 0.8.20;`). ' +
              'Use the exact version that the contract was tested and audited with.',
            references: [
              'https://swcregistry.io/docs/SWC-103',
            ],
          })
        );
      }

      // Check for very old compiler versions
      const versionMatch = value.match(/(\d+)\.(\d+)\.(\d+)/);
      if (versionMatch) {
        const major = parseInt(versionMatch[1], 10);
        const minor = parseInt(versionMatch[2], 10);

        if (major === 0 && minor < 8) {
          findings.push(
            this.createFinding(context, {
              title: `Outdated Solidity version: ${value}`,
              description:
                `The contract uses Solidity ${value} which is outdated. Versions below 0.8.0 ` +
                `lack built-in overflow/underflow protection and other security improvements.`,
              severity: Severity.LOW,
              confidence: Confidence.HIGH,
              node: pragma.node,
              recommendation:
                'Upgrade to Solidity >= 0.8.0 for built-in overflow checks and security improvements. ' +
                'Consider using the latest stable release.',
            })
          );
        }
      }
    }

    return findings;
  }
}
