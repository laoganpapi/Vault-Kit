import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'path';
import { AuditEngine } from '../src/core/engine';
import { SolidityParser } from '../src/core/parser';
import { AnalysisContext } from '../src/core/context';
import { getAllDetectors } from '../src/detectors';
import { Severity, AuditConfig } from '../src/core/types';
import { generateReport } from '../src/report/generator';

// Resolve to the source test/fixtures/ directory (works from dist/ or source)
const FIXTURES = path.resolve(__dirname.replace(/dist[/\\]test$/, 'test'), 'fixtures');

describe('SolidityParser', () => {
  const parser = new SolidityParser();

  it('should parse a valid Solidity file', () => {
    const source = `
      pragma solidity ^0.8.0;
      contract Test {
        uint256 public value;
        function setValue(uint256 _value) public {
          value = _value;
        }
      }
    `;
    const result = parser.parse(source, 'test.sol');
    assert.strictEqual(result.contracts.length, 1);
    assert.strictEqual(result.contracts[0].name, 'Test');
    assert.strictEqual(result.contracts[0].functions.length, 1);
    assert.strictEqual(result.contracts[0].stateVariables.length, 1);
  });

  it('should extract pragma information', () => {
    const source = `pragma solidity ^0.8.0; contract A {}`;
    const result = parser.parse(source, 'test.sol');
    assert.strictEqual(result.pragmas.length, 1);
    assert.strictEqual(result.pragmas[0].name, 'solidity');
    assert.ok(result.pragmas[0].value.includes('0.8.0'));
  });

  it('should extract imports', () => {
    const source = `
      pragma solidity ^0.8.0;
      import "./IERC20.sol";
      contract A {}
    `;
    const result = parser.parse(source, 'test.sol');
    assert.strictEqual(result.imports.length, 1);
  });

  it('should handle multiple contracts', () => {
    const source = `
      pragma solidity ^0.8.0;
      contract A { }
      contract B { }
      library L { }
      interface I { }
    `;
    const result = parser.parse(source, 'test.sol');
    assert.strictEqual(result.contracts.length, 4);
  });
});

describe('AnalysisContext', () => {
  const parser = new SolidityParser();

  it('should detect Solidity version', () => {
    const source = `pragma solidity ^0.8.20; contract A {}`;
    const parsed = parser.parse(source, 'test.sol');
    const ctx = new AnalysisContext(parsed);
    assert.ok(ctx.hasBuiltinOverflowChecks());
  });

  it('should detect pre-0.8 version', () => {
    const source = `pragma solidity ^0.7.0; contract A {}`;
    const parsed = parser.parse(source, 'test.sol');
    const ctx = new AnalysisContext(parsed);
    assert.strictEqual(ctx.hasBuiltinOverflowChecks(), false);
  });

  it('should find nodes by type', () => {
    const source = `
      pragma solidity ^0.8.0;
      contract A {
        function foo() public {
          uint x = 1 + 2;
        }
      }
    `;
    const parsed = parser.parse(source, 'test.sol');
    const ctx = new AnalysisContext(parsed);
    const binaryOps = ctx.findNodes(parsed.ast, 'BinaryOperation');
    assert.ok(binaryOps.length > 0);
  });
});

describe('Detectors', () => {
  it('should have at least 23 detectors registered', () => {
    const detectors = getAllDetectors();
    assert.ok(detectors.length >= 23, `Expected >= 23, got ${detectors.length}`);
  });

  it('should have unique IDs', () => {
    const detectors = getAllDetectors();
    const ids = detectors.map(d => d.id);
    const unique = new Set(ids);
    assert.strictEqual(unique.size, ids.length, 'Detector IDs must be unique');
  });
});

describe('AuditEngine on vulnerable.sol', () => {
  it('should detect multiple vulnerabilities', async () => {
    const config: AuditConfig = {
      files: [path.join(FIXTURES, 'vulnerable.sol')],
      verbose: false,
    };
    const engine = new AuditEngine(config);
    const result = await engine.run();

    assert.ok(result.findings.length > 0, 'Should find vulnerabilities');
    assert.ok(result.summary.critical > 0, 'Should find critical issues');
    assert.ok(result.summary.high > 0, 'Should find high issues');
    assert.ok(result.summary.score < 50, `Score should be low, got ${result.summary.score}`);
    assert.ok(result.files.length === 1);
    assert.ok(result.files[0].contractNames.length >= 3);
  });

  it('should detect reentrancy', async () => {
    const config: AuditConfig = {
      files: [path.join(FIXTURES, 'vulnerable.sol')],
      enabledDetectors: ['reentrancy'],
    };
    const engine = new AuditEngine(config);
    const result = await engine.run();

    const reentrancy = result.findings.filter(f => f.detectorId === 'reentrancy');
    assert.ok(reentrancy.length > 0, 'Should detect reentrancy');
    assert.ok(
      reentrancy.some(f => f.severity === Severity.CRITICAL),
      'Reentrancy should be critical'
    );
  });

  it('should detect access control issues', async () => {
    const config: AuditConfig = {
      files: [path.join(FIXTURES, 'vulnerable.sol')],
      enabledDetectors: ['access-control'],
    };
    const engine = new AuditEngine(config);
    const result = await engine.run();

    const acFindings = result.findings.filter(f => f.detectorId === 'access-control');
    assert.ok(acFindings.length > 0, 'Should detect access control issues');
  });

  it('should detect unchecked calls', async () => {
    const config: AuditConfig = {
      files: [path.join(FIXTURES, 'vulnerable.sol')],
      enabledDetectors: ['unchecked-calls'],
    };
    const engine = new AuditEngine(config);
    const result = await engine.run();

    const unchecked = result.findings.filter(f => f.detectorId === 'unchecked-calls');
    assert.ok(unchecked.length > 0, 'Should detect unchecked calls');
  });

  it('should detect tx.origin usage', async () => {
    const config: AuditConfig = {
      files: [path.join(FIXTURES, 'vulnerable.sol')],
      enabledDetectors: ['tx-origin'],
    };
    const engine = new AuditEngine(config);
    const result = await engine.run();

    assert.ok(
      result.findings.some(f => f.detectorId === 'tx-origin'),
      'Should detect tx.origin'
    );
  });

  it('should detect selfdestruct', async () => {
    const config: AuditConfig = {
      files: [path.join(FIXTURES, 'vulnerable.sol')],
      enabledDetectors: ['selfdestruct'],
    };
    const engine = new AuditEngine(config);
    const result = await engine.run();

    assert.ok(
      result.findings.some(f => f.detectorId === 'selfdestruct'),
      'Should detect selfdestruct'
    );
  });

  it('should detect floating pragma', async () => {
    const config: AuditConfig = {
      files: [path.join(FIXTURES, 'vulnerable.sol')],
      enabledDetectors: ['floating-pragma'],
    };
    const engine = new AuditEngine(config);
    const result = await engine.run();

    assert.ok(
      result.findings.some(f => f.detectorId === 'floating-pragma'),
      'Should detect floating pragma'
    );
  });

  it('should detect DOS vectors', async () => {
    const config: AuditConfig = {
      files: [path.join(FIXTURES, 'vulnerable.sol')],
      enabledDetectors: ['dos-vectors'],
    };
    const engine = new AuditEngine(config);
    const result = await engine.run();

    assert.ok(
      result.findings.some(f => f.detectorId === 'dos-vectors'),
      'Should detect DOS vectors'
    );
  });
});

describe('AuditEngine on safe.sol', () => {
  it('should find significantly fewer issues', async () => {
    const config: AuditConfig = {
      files: [path.join(FIXTURES, 'safe.sol')],
    };
    const engine = new AuditEngine(config);
    const result = await engine.run();

    assert.strictEqual(result.summary.critical, 0, 'Safe contract should have no critical findings');
    assert.ok(result.summary.score >= 70, `Safe contract score should be >= 70, got ${result.summary.score}`);
  });
});

describe('Report Generation', () => {
  it('should generate text report', async () => {
    const config: AuditConfig = {
      files: [path.join(FIXTURES, 'vulnerable.sol')],
    };
    const engine = new AuditEngine(config);
    const result = await engine.run();

    const text = generateReport(result, 'text');
    assert.ok(text.includes('VAULT-KIT'));
    assert.ok(text.includes('SECURITY SCORE'));
    assert.ok(text.includes('FINDINGS SUMMARY'));
  });

  it('should generate markdown report', async () => {
    const config: AuditConfig = {
      files: [path.join(FIXTURES, 'vulnerable.sol')],
    };
    const engine = new AuditEngine(config);
    const result = await engine.run();

    const md = generateReport(result, 'markdown');
    assert.ok(md.includes('# Vault-Kit'));
    assert.ok(md.includes('## Security Score'));
    assert.ok(md.includes('## Findings Summary'));
  });

  it('should generate JSON report', async () => {
    const config: AuditConfig = {
      files: [path.join(FIXTURES, 'vulnerable.sol')],
    };
    const engine = new AuditEngine(config);
    const result = await engine.run();

    const json = generateReport(result, 'json');
    const parsed = JSON.parse(json);
    assert.ok(parsed.findings.length > 0);
    assert.ok(parsed.summary.totalFindings > 0);
  });
});
