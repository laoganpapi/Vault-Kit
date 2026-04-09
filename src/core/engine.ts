import * as fs from 'fs';
import * as path from 'path';
import { SolidityParser } from './parser';
import { AnalysisContext } from './context';
import {
  AuditConfig,
  AuditResult,
  AuditSummary,
  FileAudit,
  Finding,
  Severity,
  SEVERITY_ORDER,
  RiskLevel,
} from './types';
import { getFilteredDetectors } from '../detectors';
import { resetFindingCounter } from '../detectors/base';

const VERSION = '1.0.0';

/**
 * The main audit engine. Orchestrates parsing, analysis, and detection
 * across all input files and detectors.
 */
export class AuditEngine {
  private parser: SolidityParser;
  private config: AuditConfig;

  constructor(config: AuditConfig) {
    this.config = config;
    this.parser = new SolidityParser();
  }

  async run(): Promise<AuditResult> {
    resetFindingCounter();

    const detectors = getFilteredDetectors(
      this.config.enabledDetectors,
      this.config.disabledDetectors
    );

    const files = this.resolveFiles();
    const fileAudits: FileAudit[] = [];
    const allFindings: Finding[] = [];

    for (const filePath of files) {
      const source = fs.readFileSync(filePath, 'utf-8');
      let parsedFile;

      try {
        parsedFile = this.parser.parse(source, filePath);
      } catch (err: any) {
        console.error(`[!] Parse error in ${filePath}: ${err.message}`);
        continue;
      }

      const context = new AnalysisContext(parsedFile);
      const fileFindings: Finding[] = [];

      for (const detector of detectors) {
        try {
          const findings = detector.detect(context);
          fileFindings.push(...findings);
        } catch (err: any) {
          if (this.config.verbose) {
            console.error(`[!] Detector ${detector.id} failed on ${filePath}: ${err.message}`);
          }
        }
      }

      // Filter by severity threshold
      const filtered = this.filterBySeverity(fileFindings);

      const fileAudit: FileAudit = {
        path: filePath,
        contractNames: context.contracts.map(c => c.name),
        linesOfCode: context.linesOfCode,
        solidityVersion: context.getSolidityVersion(),
        imports: context.file.imports.map(i => i.path),
        findings: filtered,
      };

      fileAudits.push(fileAudit);
      allFindings.push(...filtered);
    }

    // Sort findings by severity
    allFindings.sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    );

    const summary = this.buildSummary(fileAudits, allFindings);

    return {
      timestamp: new Date().toISOString(),
      version: VERSION,
      config: this.config,
      files: fileAudits,
      findings: allFindings,
      summary,
    };
  }

  private resolveFiles(): string[] {
    const files: string[] = [];

    for (const input of this.config.files) {
      const resolved = path.resolve(input);

      if (fs.statSync(resolved).isDirectory()) {
        this.collectSolFiles(resolved, files);
      } else if (resolved.endsWith('.sol')) {
        files.push(resolved);
      }
    }

    return [...new Set(files)]; // deduplicate
  }

  private collectSolFiles(dir: string, result: string[]): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip node_modules and common build directories
        if (['node_modules', 'lib', 'out', 'artifacts', 'cache'].includes(entry.name)) continue;
        this.collectSolFiles(fullPath, result);
      } else if (entry.name.endsWith('.sol')) {
        result.push(fullPath);
      }
    }
  }

  private filterBySeverity(findings: Finding[]): Finding[] {
    if (!this.config.severityThreshold) return findings;

    const threshold = SEVERITY_ORDER[this.config.severityThreshold];
    return findings.filter(f => SEVERITY_ORDER[f.severity] <= threshold);
  }

  private buildSummary(fileAudits: FileAudit[], findings: Finding[]): AuditSummary {
    const critical = findings.filter(f => f.severity === Severity.CRITICAL).length;
    const high = findings.filter(f => f.severity === Severity.HIGH).length;
    const medium = findings.filter(f => f.severity === Severity.MEDIUM).length;
    const low = findings.filter(f => f.severity === Severity.LOW).length;
    const informational = findings.filter(f => f.severity === Severity.INFORMATIONAL).length;
    const gas = findings.filter(f => f.severity === Severity.GAS).length;
    const linesOfCode = fileAudits.reduce((sum, f) => sum + f.linesOfCode, 0);
    const contractsAnalyzed = fileAudits.reduce((sum, f) => sum + f.contractNames.length, 0);

    const score = this.calculateSecurityScore(critical, high, medium, low);
    const riskLevel = this.classifyRisk(score);

    return {
      totalFindings: findings.length,
      critical,
      high,
      medium,
      low,
      informational,
      gas,
      filesAnalyzed: fileAudits.length,
      contractsAnalyzed,
      linesOfCode,
      score,
      riskLevel,
    };
  }

  /**
   * Calculate a 0-100 security score.
   * Starts at 100 and deducts points based on findings:
   * - Critical: -25 each (min 0)
   * - High: -15 each
   * - Medium: -5 each
   * - Low: -2 each
   */
  private calculateSecurityScore(
    critical: number,
    high: number,
    medium: number,
    low: number
  ): number {
    let score = 100;
    score -= critical * 25;
    score -= high * 15;
    score -= medium * 5;
    score -= low * 2;
    return Math.max(0, Math.min(100, score));
  }

  private classifyRisk(score: number): RiskLevel {
    if (score >= 90) return 'PASS';
    if (score >= 70) return 'LOW_RISK';
    if (score >= 50) return 'MEDIUM_RISK';
    if (score >= 25) return 'HIGH_RISK';
    return 'CRITICAL_RISK';
  }
}
