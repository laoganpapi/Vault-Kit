import * as path from 'path';
import * as fs from 'fs';
import { AuditEngine } from './core/engine';
import { AuditConfig, Severity, ReportFormat } from './core/types';
import { generateReport } from './report/generator';
import { getAllDetectors } from './detectors';

const BANNER = `
 __      __         _ _       _  ___ _
 \\ \\    / /_ _ _  _| | |_ ___| |/ (_) |_
  \\ \\/\\/ / _\` | || | |  _|___| ' <| |  _|
   \\_/\\_/\\__,_|\\_,_|_|\\__|   |_|\\_\\_|\\__|

  Smart Contract Security Auditor v1.0.0
`;

function printUsage(): void {
  console.log(BANNER);
  console.log('Usage: vault-kit <file|directory> [options]');
  console.log('');
  console.log('Options:');
  console.log('  --format <text|markdown|json>  Output format (default: text)');
  console.log('  --output <file>                Write report to file');
  console.log('  --severity <level>             Minimum severity: critical|high|medium|low|informational|gas');
  console.log('  --enable <ids>                 Comma-separated detector IDs to enable');
  console.log('  --disable <ids>                Comma-separated detector IDs to disable');
  console.log('  --high-only                    Only report HIGH and CRITICAL findings (benchmark mode)');
  console.log('  --benchmark                    Benchmark mode: HIGH+ only, evmbench-compatible output');
  console.log('  --verbose                      Show detailed processing info');
  console.log('  --list-detectors               List all available detectors');
  console.log('  --gas                          Include gas optimization findings');
  console.log('  --help                         Show this help');
  console.log('');
  console.log('Examples:');
  console.log('  vault-kit contracts/Token.sol');
  console.log('  vault-kit contracts/ --format markdown --output report.md');
  console.log('  vault-kit Token.sol --severity high --disable gas-optimization');
  console.log('  vault-kit Token.sol --enable reentrancy,access-control');
}

function printDetectors(): void {
  console.log(BANNER);
  console.log('Available Detectors:');
  console.log('');
  console.log(
    'ID'.padEnd(25) +
    'Severity'.padEnd(15) +
    'Description'
  );
  console.log('-'.repeat(80));

  for (const detector of getAllDetectors()) {
    console.log(
      detector.id.padEnd(25) +
      detector.defaultSeverity.toUpperCase().padEnd(15) +
      detector.description
    );
  }
  console.log('');
}

function parseArgs(args: string[]): {
  files: string[];
  format: ReportFormat;
  output?: string;
  severity?: Severity;
  enable?: string[];
  disable?: string[];
  verbose: boolean;
  listDetectors: boolean;
  gas: boolean;
  help: boolean;
  highOnly: boolean;
  benchmark: boolean;
} {
  const result = {
    files: [] as string[],
    format: 'text' as ReportFormat,
    output: undefined as string | undefined,
    severity: undefined as Severity | undefined,
    enable: undefined as string[] | undefined,
    disable: undefined as string[] | undefined,
    verbose: false,
    listDetectors: false,
    gas: false,
    help: false,
    highOnly: false,
    benchmark: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--list-detectors') {
      result.listDetectors = true;
    } else if (arg === '--verbose' || arg === '-v') {
      result.verbose = true;
    } else if (arg === '--gas') {
      result.gas = true;
    } else if (arg === '--high-only') {
      result.highOnly = true;
    } else if (arg === '--benchmark') {
      result.benchmark = true;
    } else if (arg === '--format' || arg === '-f') {
      result.format = (args[++i] as ReportFormat) || 'text';
    } else if (arg === '--output' || arg === '-o') {
      result.output = args[++i];
    } else if (arg === '--severity' || arg === '-s') {
      result.severity = args[++i] as Severity;
    } else if (arg === '--enable') {
      result.enable = args[++i]?.split(',');
    } else if (arg === '--disable') {
      result.disable = args[++i]?.split(',');
    } else if (!arg.startsWith('-')) {
      result.files.push(arg);
    }

    i++;
  }

  return result;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || (args.files.length === 0 && !args.listDetectors)) {
    printUsage();
    process.exit(0);
  }

  if (args.listDetectors) {
    printDetectors();
    process.exit(0);
  }

  console.log(BANNER);

  // Validate input files
  for (const file of args.files) {
    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) {
      console.error(`Error: ${file} does not exist`);
      process.exit(1);
    }
  }

  // Determine severity threshold
  let severityThreshold = args.severity;
  if (!severityThreshold) {
    if (args.highOnly || args.benchmark) {
      severityThreshold = Severity.HIGH;
    } else if (args.gas) {
      severityThreshold = Severity.GAS;
    } else {
      severityThreshold = Severity.INFORMATIONAL;
    }
  }

  const config: AuditConfig = {
    files: args.files.map(f => path.resolve(f)),
    reportFormat: args.format,
    severityThreshold,
    enabledDetectors: args.enable,
    disabledDetectors: args.gas ? args.disable : [...(args.disable || [])],
    verbose: args.verbose,
    gasAnalysis: args.gas,
  };

  if (args.verbose) {
    console.log(`  Analyzing ${config.files.length} path(s)...`);
    console.log('');
  }

  const engine = new AuditEngine(config);

  try {
    const result = await engine.run();
    const report = generateReport(result, args.format);

    if (args.output) {
      fs.writeFileSync(args.output, report, 'utf-8');
      console.log(`  Report written to: ${args.output}`);
      console.log('');

      // Also print summary to console
      printSummary(result);
    } else {
      console.log(report);
    }

    // Exit with code 1 if critical/high findings
    if (result.summary.critical > 0 || result.summary.high > 0) {
      process.exit(1);
    }
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    if (args.verbose) {
      console.error(err.stack);
    }
    process.exit(2);
  }
}

function printSummary(result: any): void {
  const s = result.summary;
  console.log(`  Security Score: ${s.score}/100 [${s.riskLevel}]`);
  console.log(`  Findings: ${s.critical} critical, ${s.high} high, ${s.medium} medium, ${s.low} low`);
  console.log(`  Files: ${s.filesAnalyzed} | Contracts: ${s.contractsAnalyzed} | Lines: ${s.linesOfCode}`);
  console.log('');
}

main();
