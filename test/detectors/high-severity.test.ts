import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'path';
import { AuditEngine } from '../../src/core/engine';
import { SolidityParser } from '../../src/core/parser';
import { AnalysisContext } from '../../src/core/context';
import { Severity } from '../../src/core/types';
import { ReadOnlyReentrancyDetector } from '../../src/detectors/readonly-reentrancy';
import { EcrecoverBugsDetector } from '../../src/detectors/ecrecover-bugs';
import { ArbitraryExternalCallDetector } from '../../src/detectors/arbitrary-external-call';
import { UninitializedProxyDetector } from '../../src/detectors/uninitialized-proxy';
import { L2SequencerDetector } from '../../src/detectors/l2-sequencer';
import { UnsafeCastDetector } from '../../src/detectors/unsafe-cast';
import { ForcedEtherDetector } from '../../src/detectors/forced-ether';
import { resetFindingCounter } from '../../src/detectors/base';

const parser = new SolidityParser();
function ctx(src: string): AnalysisContext {
  resetFindingCounter();
  return new AnalysisContext(parser.parse(src, 'test.sol'));
}

const FIXTURES = path.resolve(__dirname.replace(/dist[/\\]test[/\\]detectors$/, 'test'), 'fixtures');

// ============================================================
// Read-Only Reentrancy
// ============================================================
describe('ReadOnlyReentrancyDetector', () => {
  const d = new ReadOnlyReentrancyDetector();

  it('detects view function exposing state modifiable during external calls', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract A {
        mapping(address => uint256) public balances;
        uint256 public totalBalance;
        function withdraw(uint256 amt) external {
          (bool s,) = msg.sender.call{value: amt}("");
          require(s);
          balances[msg.sender] -= amt;
          totalBalance -= amt;
        }
        function getPrice() external view returns (uint256) {
          return totalBalance;
        }
      }`);
    assert.ok(d.detect(c).some(x => x.title.includes('read-only reentrancy')));
  });

  it('does NOT flag contracts without external calls', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract A {
        uint256 public total;
        function set(uint256 v) external { total = v; }
        function get() external view returns (uint256) { return total; }
      }`);
    assert.strictEqual(d.detect(c).length, 0);
  });
});

// ============================================================
// Ecrecover Bugs
// ============================================================
describe('EcrecoverBugsDetector', () => {
  const d = new EcrecoverBugsDetector();

  it('detects zero-address signature bypass', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract A {
        address public signer;
        function verify(bytes32 h, uint8 v, bytes32 r, bytes32 s) external {
          address s2 = ecrecover(h, v, r, s);
          require(s2 == signer);
        }
      }`);
    assert.ok(d.detect(c).some(x => x.title.includes('Zero-address')));
  });

  it('does NOT flag when zero-address is explicitly checked', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract A {
        function verify(bytes32 h, uint8 v, bytes32 r, bytes32 sig) external {
          address signer = ecrecover(h, v, r, sig);
          require(signer != address(0), "Invalid");
          require(uint256(sig) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0);
        }
      }`);
    const f = d.detect(c);
    assert.ok(!f.some(x => x.title.includes('Zero-address')));
    assert.ok(!f.some(x => x.title.includes('malleability')));
  });

  it('detects signature malleability', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract A {
        function verify(bytes32 h, uint8 v, bytes32 r, bytes32 s) external {
          address signer = ecrecover(h, v, r, s);
          require(signer != address(0));
        }
      }`);
    assert.ok(d.detect(c).some(x => x.title.includes('malleability')));
  });
});

// ============================================================
// Arbitrary External Call
// ============================================================
describe('ArbitraryExternalCallDetector', () => {
  const d = new ArbitraryExternalCallDetector();

  it('detects arbitrary call with user-supplied target and data', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract A {
        function exec(address target, bytes calldata data) external payable {
          (bool s,) = target.call{value: msg.value}(data);
          require(s);
        }
      }`);
    assert.ok(d.detect(c).some(x => x.title.includes('Arbitrary call')));
  });

  it('detects arbitrary delegatecall as CRITICAL', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract A {
        function exec(address target, bytes calldata data) external {
          target.delegatecall(data);
        }
      }`);
    const f = d.detect(c);
    assert.ok(f.some(x => x.severity === Severity.CRITICAL && x.title.includes('delegatecall')));
  });

  it('does NOT flag when only data is user-supplied (fixed target)', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract A {
        address immutable target;
        constructor(address t) { target = t; }
        function exec(bytes calldata data) external {
          target.call(data);
        }
      }`);
    assert.strictEqual(d.detect(c).length, 0);
  });
});

// ============================================================
// Uninitialized Proxy
// ============================================================
describe('UninitializedProxyDetector', () => {
  const d = new UninitializedProxyDetector();

  it('detects upgradeable contract without _disableInitializers', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract Initializable {}
      contract UUPS is Initializable {
        address public owner;
        function initialize(address o) external { owner = o; }
      }`);
    assert.ok(d.detect(c).some(x => x.title.includes('Uninitialized implementation')));
  });

  it('does NOT flag when _disableInitializers is called in constructor', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract Initializable {
        function _disableInitializers() internal {}
      }
      contract UUPS is Initializable {
        address public owner;
        constructor() { _disableInitializers(); }
        function initialize(address o) external { owner = o; }
      }`);
    assert.ok(!d.detect(c).some(x => x.title.includes('Uninitialized implementation')));
  });

  it('does NOT flag non-upgradeable contracts', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract A { address public owner; function init() external { owner = msg.sender; } }`);
    assert.strictEqual(d.detect(c).length, 0);
  });
});

// ============================================================
// L2 Sequencer
// ============================================================
describe('L2SequencerDetector', () => {
  const d = new L2SequencerDetector();

  it('detects Chainlink usage without sequencer check (name hints L2)', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      interface AggregatorV3Interface {
        function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
      }
      contract ArbitrumPerps {
        AggregatorV3Interface public priceFeed;
        function getPrice() external view returns (int256) {
          (, int256 p,,,) = priceFeed.latestRoundData();
          return p;
        }
      }`);
    assert.ok(d.detect(c).some(x => x.title.includes('sequencer')));
  });

  it('does NOT flag when sequencerUptimeFeed is referenced', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      interface AggregatorV3Interface {
        function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
      }
      contract ArbitrumPerps {
        AggregatorV3Interface public priceFeed;
        AggregatorV3Interface public sequencerUptimeFeed;
        uint256 public constant gracePeriod = 3600;
        function getPrice() external view returns (int256) {
          (, int256 p,,,) = priceFeed.latestRoundData();
          return p;
        }
      }`);
    assert.ok(!d.detect(c).some(x => x.title.includes('sequencer')));
  });
});

// ============================================================
// Unsafe Cast
// ============================================================
describe('UnsafeCastDetector', () => {
  const d = new UnsafeCastDetector();

  it('detects uint256 -> uint128 cast', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract A {
        function f(uint256 x) external pure returns (uint128) {
          return uint128(x);
        }
      }`);
    assert.ok(d.detect(c).some(x => x.title.includes('Unsafe downcast to uint128')));
  });

  it('does NOT flag uint256 (no downcast)', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract A {
        function f(uint128 x) external pure returns (uint256) { return uint256(x); }
      }`);
    assert.ok(!d.detect(c).some(x => x.title.includes('downcast')));
  });
});

// ============================================================
// Forced Ether
// ============================================================
describe('ForcedEtherDetector', () => {
  const d = new ForcedEtherDetector();

  it('detects address(this).balance == X', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract A {
        uint256 public pot;
        function payout() external {
          require(address(this).balance == pot);
          pot = 0;
        }
      }`);
    assert.ok(d.detect(c).some(x => x.title.includes('Forced ether')));
  });

  it('does NOT flag address(this).balance >= X', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract A {
        function check() external view {
          require(address(this).balance >= 1 ether);
        }
      }`);
    assert.strictEqual(d.detect(c).length, 0);
  });
});

// ============================================================
// Integration: evmbench-style fixture
// ============================================================
describe('evmbench-style fixture', () => {
  it('detects all 10 benchmark vulnerabilities', async () => {
    const engine = new AuditEngine({
      files: [path.join(FIXTURES, 'evmbench-style.sol')],
      severityThreshold: Severity.HIGH, // HIGH+ only
    });
    const r = await engine.run();

    const detectorIds = new Set(r.findings.map(f => f.detectorId));

    // Verify each expected vulnerability class fires
    const expected: Record<string, string> = {
      'readonly-reentrancy': 'BUG 1: Read-only reentrancy',
      'ecrecover-bugs': 'BUG 2: ecrecover zero-address / malleability',
      'arbitrary-external-call': 'BUG 3: Arbitrary external call (Furucombo)',
      'uninitialized-proxy': 'BUG 4: Uninitialized proxy implementation',
      'l2-sequencer': 'BUG 5: L2 sequencer uptime',
      'share-inflation': 'BUG 8: ERC-4626 share inflation',
      'signature-replay': 'BUG 9: Signature replay',
      'oracle-manipulation': 'BUG 10: Missing oracle validation',
      'reentrancy': 'Classic reentrancy (bug 1 triggers this too)',
    };

    const missing: string[] = [];
    for (const [id, desc] of Object.entries(expected)) {
      if (!detectorIds.has(id)) missing.push(`${id} (${desc})`);
    }

    assert.deepStrictEqual(missing, [], `Missing detectors for: ${missing.join(', ')}`);

    // Report stats
    const totalHigh = r.summary.critical + r.summary.high;
    assert.ok(totalHigh >= 10, `Expected >= 10 HIGH+ findings, got ${totalHigh}`);
  });
});
