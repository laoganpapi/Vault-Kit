// Vault-Kit: Smart Contract Security Auditor
// Public API

export { AuditEngine } from './core/engine';
export { SolidityParser } from './core/parser';
export { AnalysisContext } from './core/context';
export {
  Severity,
  Confidence,
  VulnerabilityCategory,
  SEVERITY_ORDER,
  type Finding,
  type AuditConfig,
  type AuditResult,
  type AuditSummary,
  type FileAudit,
  type SourceLocation,
  type ContractInfo,
  type FunctionInfo,
  type StateVariable,
  type ParsedFile,
  type ReportFormat,
  type RiskLevel,
} from './core/types';
export { getAllDetectors, getDetectorById, getFilteredDetectors, BaseDetector } from './detectors';
export { generateReport } from './report/generator';
export { buildCallGraph } from './analyzers/call-graph';
export { buildCFG, findStateChangesAfterCalls } from './analyzers/control-flow';
export { analyzeDataFlow } from './analyzers/data-flow';
