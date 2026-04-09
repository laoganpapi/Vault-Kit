import { AnalysisContext } from '../core/context';
import { Finding, Severity, Confidence, VulnerabilityCategory, SourceLocation } from '../core/types';

let findingCounter = 0;

/**
 * Base class for all vulnerability detectors.
 * Each detector scans an AnalysisContext and returns findings.
 */
export abstract class BaseDetector {
  /** Unique identifier for this detector (e.g., "reentrancy") */
  abstract readonly id: string;

  /** Human-readable name */
  abstract readonly name: string;

  /** Description of what this detector checks */
  abstract readonly description: string;

  /** Vulnerability category */
  abstract readonly category: VulnerabilityCategory;

  /** Default severity for findings from this detector */
  abstract readonly defaultSeverity: Severity;

  /** Run the detector against a parsed file context */
  abstract detect(context: AnalysisContext): Finding[];

  /** Create a finding with standard fields filled in */
  protected createFinding(
    context: AnalysisContext,
    opts: {
      title: string;
      description: string;
      severity?: Severity;
      confidence: Confidence;
      node: any;
      recommendation: string;
      references?: string[];
      gasImpact?: number;
    }
  ): Finding {
    const loc = opts.node?.loc;
    const line = loc?.start?.line || 0;
    const endLine = loc?.end?.line || line;

    const location: SourceLocation = {
      file: context.filePath,
      line,
      column: loc?.start?.column,
      endLine,
      endColumn: loc?.end?.column,
      snippet: line > 0 ? this.extractSnippet(context, line, endLine) : undefined,
    };

    return {
      id: `VK-${String(++findingCounter).padStart(3, '0')}`,
      detectorId: this.id,
      title: opts.title,
      description: opts.description,
      severity: opts.severity || this.defaultSeverity,
      confidence: opts.confidence,
      category: this.category,
      location,
      recommendation: opts.recommendation,
      references: opts.references,
      gasImpact: opts.gasImpact,
    };
  }

  private extractSnippet(context: AnalysisContext, startLine: number, endLine: number): string {
    const lines = context.sourceLines;
    const start = Math.max(0, startLine - 2);
    const end = Math.min(lines.length, endLine + 1);
    return lines
      .slice(start, end)
      .map((l, i) => `${start + i + 1} | ${l}`)
      .join('\n');
  }
}

/** Reset finding counter (for testing) */
export function resetFindingCounter(): void {
  findingCounter = 0;
}
