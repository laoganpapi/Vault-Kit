import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { SolidityParser } from '../../src/core/parser';
import { AnalysisContext } from '../../src/core/context';
import { Severity } from '../../src/core/types';
import { DelegatecallDetector } from '../../src/detectors/delegatecall';
import { FlashLoanDetector } from '../../src/detectors/flash-loan';
import { OracleManipulationDetector } from '../../src/detectors/oracle-manipulation';
import { ProxyStorageDetector } from '../../src/detectors/proxy-storage';
import { UninitializedStorageDetector } from '../../src/detectors/uninitialized-storage';
import { GasOptimizationDetector } from '../../src/detectors/gas-optimization';
import { resetFindingCounter } from '../../src/detectors/base';

const parser = new SolidityParser();
function ctx(src: string): AnalysisContext {
  resetFindingCounter();
  return new AnalysisContext(parser.parse(src, 'test.sol'));
}

// ============================================================
// Delegatecall — previously only covered by integration tests
// ============================================================
describe('DelegatecallDetector (coverage-gap)', () => {
  const d = new DelegatecallDetector();

  it('flags delegatecall to user-controlled target as CRITICAL', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract A {
        function exec(address target, bytes calldata data) external {
          target.delegatecall(data);
        }
      }`);
    const f = d.detect(c);
    assert.ok(
      f.some(x => x.severity === Severity.CRITICAL && x.title.includes('user-controlled')),
      'should flag user-controlled delegatecall'
    );
  });

  it('flags delegatecall inside a loop as HIGH', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract A {
        address[] public targets;
        function execAll(bytes calldata data) external {
          for (uint256 i = 0; i < targets.length; i++) {
            targets[i].delegatecall(data);
          }
        }
      }`);
    const f = d.detect(c);
    assert.ok(f.some(x => x.title.includes('inside loop')),
      'should flag delegatecall in loop');
  });

  it('does NOT flag delegatecall to immutable trusted target as CRITICAL', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract A {
        address immutable impl;
        constructor(address _impl) { impl = _impl; }
        function exec(bytes calldata data) external {
          impl.delegatecall(data);
        }
      }`);
    const f = d.detect(c);
    // Still flagged for review (MEDIUM) but not CRITICAL user-controlled
    assert.ok(
      !f.some(x => x.severity === Severity.CRITICAL && x.title.includes('user-controlled')),
      'should not flag trusted immutable target as user-controlled critical'
    );
  });
});

// ============================================================
// Flash Loan — balance-dependent validation
// ============================================================
describe('FlashLoanDetector (coverage-gap)', () => {
  const d = new FlashLoanDetector();

  it('flags require(balanceOf(msg.sender) > 0)', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      interface IERC20 { function balanceOf(address) external view returns (uint256); }
      contract A {
        IERC20 public token;
        function vote() external {
          require(token.balanceOf(msg.sender) > 0, "must hold tokens");
        }
      }`);
    const f = d.detect(c);
    assert.ok(f.some(x => x.title.includes('Balance-dependent')));
  });

  it('flags require(address(this).balance >= X) patterns', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract A {
        function gatekeep() external view {
          require(address(this).balance >= 1 ether, "must be funded");
        }
      }`);
    const f = d.detect(c);
    assert.ok(f.some(x => x.title.includes('Balance-dependent')));
  });

  it('flags getReserves() spot-price reliance', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      interface IPair { function getReserves() external view returns (uint112, uint112, uint32); }
      contract A {
        IPair public pair;
        function getPrice() external view returns (uint112) {
          (uint112 r0,,) = pair.getReserves();
          return r0;
        }
      }`);
    const f = d.detect(c);
    assert.ok(f.some(x => x.title.includes('Spot price')));
  });

  it('does NOT flag contracts without balance-dependent logic', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract A {
        mapping(address => uint256) public votes;
        function vote() external { votes[msg.sender] += 1; }
      }`);
    assert.strictEqual(d.detect(c).length, 0);
  });
});

// ============================================================
// Oracle Manipulation — mirrors ArbitrumVault fix flow
// ============================================================
describe('OracleManipulationDetector (coverage-gap)', () => {
  const d = new OracleManipulationDetector();

  it('flags missing staleness check', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      interface AggregatorV3Interface {
        function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
      }
      contract A {
        AggregatorV3Interface public feed;
        function price() external view returns (int256) {
          (, int256 answer,,,) = feed.latestRoundData();
          return answer;
        }
      }`);
    const f = d.detect(c);
    assert.ok(f.some(x => x.title.includes('staleness')));
    assert.ok(f.some(x => x.title.includes('price validation')));
    assert.ok(f.some(x => x.title.includes('round completeness')));
  });

  it('does NOT flag fully validated oracle call', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      interface AggregatorV3Interface {
        function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
      }
      contract A {
        AggregatorV3Interface public feed;
        function price() external view returns (int256) {
          (uint80 rid, int256 answer,, uint256 updatedAt, uint80 answeredInRound) = feed.latestRoundData();
          require(answer > 0, "invalid");
          require(block.timestamp - updatedAt < 3600, "stale");
          require(answeredInRound >= rid, "round");
          return answer;
        }
      }`);
    const f = d.detect(c);
    assert.ok(!f.some(x => x.title.includes('staleness')));
    assert.ok(!f.some(x => x.title.includes('price validation')));
    assert.ok(!f.some(x => x.title.includes('round completeness')));
  });

  it('flags deprecated latestAnswer()', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      interface AggregatorV3Interface { function latestAnswer() external view returns (int256); }
      contract A {
        AggregatorV3Interface public feed;
        function price() external view returns (int256) { return feed.latestAnswer(); }
      }`);
    assert.ok(d.detect(c).some(x => x.title.includes('Deprecated latestAnswer')));
  });

  it('does NOT flag non-oracle contracts', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract A { function foo() public pure returns (uint256) { return 42; } }`);
    assert.strictEqual(d.detect(c).length, 0);
  });
});

// ============================================================
// Proxy Storage
// ============================================================
describe('ProxyStorageDetector (coverage-gap)', () => {
  const d = new ProxyStorageDetector();

  it('flags upgradeable contract missing __gap', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract Initializable {}
      contract MyUpgradeable is Initializable {
        uint256 public value;
        address public admin;
        function initialize(uint256 v) external { value = v; admin = msg.sender; }
      }`);
    assert.ok(d.detect(c).some(x => x.title.includes('Missing storage gap')));
  });

  it('does NOT flag upgradeable contract with __gap', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract Initializable {}
      contract MyUpgradeable is Initializable {
        uint256 public value;
        uint256[49] private __gap;
        function initialize(uint256 v) external { value = v; }
      }`);
    assert.ok(!d.detect(c).some(x => x.title.includes('Missing storage gap')));
  });

  it('does NOT flag non-upgradeable contracts', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract A { uint256 public x; }`);
    assert.strictEqual(d.detect(c).length, 0);
  });

  it('flags constructor with logic in upgradeable contract', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract Initializable {}
      contract MyUpgradeable is Initializable {
        address public admin;
        uint256[50] private __gap;
        constructor() { admin = msg.sender; }
      }`);
    assert.ok(d.detect(c).some(x => x.title.includes('Constructor in upgradeable')));
  });
});

// ============================================================
// Uninitialized Storage — dangerous default address
// ============================================================
describe('UninitializedStorageDetector (coverage-gap)', () => {
  const d = new UninitializedStorageDetector();

  it('flags uninitialized address used as transfer target', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract A {
        address payable public beneficiary;
        function pay() external payable {
          beneficiary.transfer(msg.value);
        }
      }`);
    const f = d.detect(c);
    assert.ok(f.some(x => x.title.includes('Unvalidated address')));
  });

  it('does NOT flag address with zero-check before transfer', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract A {
        address payable public beneficiary;
        function pay() external payable {
          require(beneficiary != address(0), "zero");
          beneficiary.transfer(msg.value);
        }
      }`);
    const f = d.detect(c);
    assert.ok(!f.some(x => x.title.includes('Unvalidated address')));
  });

  it('does NOT flag contracts without address transfers', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract A { uint256 public x; function set(uint256 v) external { x = v; } }`);
    assert.strictEqual(d.detect(c).length, 0);
  });
});

// ============================================================
// Gas Optimization — storage reads in loops, > 0 vs != 0
// ============================================================
describe('GasOptimizationDetector (coverage-gap)', () => {
  const d = new GasOptimizationDetector();

  it('flags storage variable read inside loop', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract A {
        uint256 public total;
        uint256[] public items;
        function sum() external {
          for (uint256 i = 0; i < items.length; i++) {
            total += items[i];
          }
        }
      }`);
    const f = d.detect(c);
    assert.ok(f.some(x => x.title.includes('read in loop')));
  });

  it('does NOT flag loops without storage reads', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract A {
        function sum(uint256[] calldata items) external pure returns (uint256 s) {
          for (uint256 i = 0; i < items.length; i++) {
            s += items[i];
          }
        }
      }`);
    const f = d.detect(c);
    assert.ok(!f.some(x => x.title.includes('read in loop')));
  });

  it('flags > 0 comparison on unsigned integer', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract A {
        function check(uint256 x) external pure {
          require(x > 0, "zero");
        }
      }`);
    const f = d.detect(c);
    assert.ok(f.some(x => x.title.includes('!= 0')));
  });

  it('does NOT flag != 0 comparison', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract A {
        function check(uint256 x) external pure {
          require(x != 0, "zero");
        }
      }`);
    const f = d.detect(c);
    assert.ok(!f.some(x => x.title.includes('!= 0')));
  });

  it('flags state variable assigned only in constructor (should be immutable)', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract A {
        uint256 public factor;
        constructor(uint256 _factor) { factor = _factor; }
      }`);
    const f = d.detect(c);
    assert.ok(f.some(x => x.title.includes('could be immutable')));
  });
});
