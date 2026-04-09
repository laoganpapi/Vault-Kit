import type { ASTNode } from '@solidity-parser/parser/dist/src/ast-types';

// --- Severity & Confidence ---

export enum Severity {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
  INFORMATIONAL = 'informational',
  GAS = 'gas',
}

export const SEVERITY_ORDER: Record<Severity, number> = {
  [Severity.CRITICAL]: 0,
  [Severity.HIGH]: 1,
  [Severity.MEDIUM]: 2,
  [Severity.LOW]: 3,
  [Severity.INFORMATIONAL]: 4,
  [Severity.GAS]: 5,
};

export enum Confidence {
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

// --- Source Location ---

export interface SourceLocation {
  file: string;
  line: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  snippet?: string;
}

// --- Findings ---

export interface Finding {
  id: string;
  detectorId: string;
  title: string;
  description: string;
  severity: Severity;
  confidence: Confidence;
  category: VulnerabilityCategory;
  location: SourceLocation;
  recommendation: string;
  references?: string[];
  gasImpact?: number;
}

export enum VulnerabilityCategory {
  REENTRANCY = 'Reentrancy',
  ACCESS_CONTROL = 'Access Control',
  UNCHECKED_CALLS = 'Unchecked External Calls',
  INTEGER_OVERFLOW = 'Integer Overflow/Underflow',
  TX_ORIGIN = 'tx.origin Authentication',
  FLOATING_PRAGMA = 'Floating Pragma',
  SELFDESTRUCT = 'Selfdestruct',
  DELEGATECALL = 'Dangerous Delegatecall',
  TIMESTAMP_DEPENDENCE = 'Timestamp Dependence',
  DOS = 'Denial of Service',
  FRONT_RUNNING = 'Front-Running',
  UNINITIALIZED_STORAGE = 'Uninitialized Storage',
  GAS_OPTIMIZATION = 'Gas Optimization',
  FLASH_LOAN = 'Flash Loan Attack Vector',
  ORACLE_MANIPULATION = 'Oracle Manipulation',
  PROXY_STORAGE = 'Proxy Storage Collision',
  ERC_COMPLIANCE = 'ERC Standard Compliance',
}

// --- Audit Configuration ---

export interface AuditConfig {
  files: string[];
  severityThreshold?: Severity;
  enabledDetectors?: string[];
  disabledDetectors?: string[];
  reportFormat?: ReportFormat;
  verbose?: boolean;
  gasAnalysis?: boolean;
}

export type ReportFormat = 'json' | 'markdown' | 'text';

// --- Audit Results ---

export interface AuditResult {
  timestamp: string;
  version: string;
  config: AuditConfig;
  files: FileAudit[];
  findings: Finding[];
  summary: AuditSummary;
}

export interface FileAudit {
  path: string;
  contractNames: string[];
  linesOfCode: number;
  solidityVersion?: string;
  imports: string[];
  findings: Finding[];
}

export interface AuditSummary {
  totalFindings: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  informational: number;
  gas: number;
  filesAnalyzed: number;
  contractsAnalyzed: number;
  linesOfCode: number;
  score: number; // 0-100 security score
  riskLevel: RiskLevel;
}

export type RiskLevel = 'PASS' | 'LOW_RISK' | 'MEDIUM_RISK' | 'HIGH_RISK' | 'CRITICAL_RISK';

// --- Contract Model ---

export interface ContractInfo {
  name: string;
  kind: 'contract' | 'library' | 'interface' | 'abstract';
  baseContracts: string[];
  stateVariables: StateVariable[];
  functions: FunctionInfo[];
  modifiers: ModifierInfo[];
  events: EventInfo[];
  node: ASTNode;
}

export interface StateVariable {
  name: string;
  typeName: string;
  visibility: string;
  mutability?: string;
  isConstant: boolean;
  isImmutable: boolean;
  node: ASTNode;
}

export interface FunctionInfo {
  name: string;
  visibility: string;
  stateMutability: string;
  modifiers: string[];
  parameters: ParameterInfo[];
  returnParameters: ParameterInfo[];
  isConstructor: boolean;
  isFallback: boolean;
  isReceive: boolean;
  hasBody: boolean;
  node: ASTNode;
}

export interface ModifierInfo {
  name: string;
  parameters: ParameterInfo[];
  node: ASTNode;
}

export interface EventInfo {
  name: string;
  parameters: ParameterInfo[];
  node: ASTNode;
}

export interface ParameterInfo {
  name: string;
  typeName: string;
  isIndexed?: boolean;
}

// --- Analysis Context ---

export interface ParsedFile {
  path: string;
  source: string;
  ast: ASTNode;
  contracts: ContractInfo[];
  pragmas: PragmaInfo[];
  imports: ImportInfo[];
}

export interface PragmaInfo {
  name: string;
  value: string;
  node: ASTNode;
}

export interface ImportInfo {
  path: string;
  symbols: string[];
  node: ASTNode;
}
