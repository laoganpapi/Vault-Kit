import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'path';
import { AuditEngine } from '../../src/core/engine';
import { SolidityParser } from '../../src/core/parser';
import { AnalysisContext } from '../../src/core/context';
import { AuditConfig, Severity } from '../../src/core/types';
import { ReentrancyDetector } from '../../src/detectors/reentrancy';
import { AccessControlDetector } from '../../src/detectors/access-control';
import { UncheckedCallsDetector } from '../../src/detectors/unchecked-calls';
import { TxOriginDetector } from '../../src/detectors/tx-origin';
import { FloatingPragmaDetector } from '../../src/detectors/floating-pragma';
import { SelfdestructDetector } from '../../src/detectors/selfdestruct';
import { TimestampDependenceDetector } from '../../src/detectors/timestamp-dependence';
import { DOSVectorsDetector } from '../../src/detectors/dos-vectors';
import { DelegatecallDetector } from '../../src/detectors/delegatecall';
import { IntegerOverflowDetector } from '../../src/detectors/integer-overflow';
import { FrontRunningDetector } from '../../src/detectors/front-running';
import { FlashLoanDetector } from '../../src/detectors/flash-loan';
import { OracleManipulationDetector } from '../../src/detectors/oracle-manipulation';
import { ProxyStorageDetector } from '../../src/detectors/proxy-storage';
import { ERCComplianceDetector } from '../../src/detectors/erc-compliance';
import { GasOptimizationDetector } from '../../src/detectors/gas-optimization';
import { LockedEtherDetector } from '../../src/detectors/locked-ether';
import { StateShadowingDetector } from '../../src/detectors/state-shadowing';
import { MissingEventsDetector } from '../../src/detectors/missing-events';
import { UnsafeAssemblyDetector } from '../../src/detectors/unsafe-assembly';
import { PrecisionLossDetector } from '../../src/detectors/precision-loss';
import { CentralizationRiskDetector } from '../../src/detectors/centralization-risk';
import { resetFindingCounter } from '../../src/detectors/base';

const parser = new SolidityParser();

function makeContext(source: string): AnalysisContext {
  resetFindingCounter();
  return new AnalysisContext(parser.parse(source, 'test.sol'));
}

const FIXTURES = path.resolve(__dirname.replace(/dist[/\\]test[/\\]detectors$/, 'test'), 'fixtures');

// ============================================================
// 1. Reentrancy
// ============================================================
describe('ReentrancyDetector', () => {
  const d = new ReentrancyDetector();

  it('detects state change after external call (CEI violation)', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A {
        mapping(address => uint256) public b;
        function w(uint256 a) public {
          (bool s,) = msg.sender.call{value: a}("");
          require(s);
          b[msg.sender] -= a;
        }
      }`);
    const f = d.detect(ctx);
    assert.ok(f.some(x => x.severity === Severity.CRITICAL && x.title.includes('Reentrancy')));
  });

  it('does NOT flag CEI-compliant code as critical', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A {
        mapping(address => uint256) public b;
        function w(uint256 a) public {
          b[msg.sender] -= a;
          (bool s,) = msg.sender.call{value: a}("");
          require(s);
        }
      }`);
    const f = d.detect(ctx);
    assert.ok(!f.some(x => x.severity === Severity.CRITICAL && x.title.startsWith('Reentrancy in')));
  });

  it('detects missing reentrancy guard when state + external call coexist', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A {
        mapping(address => uint256) public b;
        uint256 public t;
        function w(uint256 a) public {
          b[msg.sender] -= a;
          t -= a;
          (bool s,) = msg.sender.call{value: a}("");
          require(s);
        }
      }`);
    const f = d.detect(ctx);
    assert.ok(f.some(x => x.title.includes('Missing reentrancy guard')));
  });

  it('does NOT flag nonReentrant-guarded function as missing guard', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A {
        mapping(address => uint256) public b;
        modifier nonReentrant() { _; }
        function w(uint256 a) public nonReentrant {
          b[msg.sender] -= a;
          (bool s,) = msg.sender.call{value: a}("");
          require(s);
        }
      }`);
    const f = d.detect(ctx);
    assert.ok(!f.some(x => x.title.includes('Missing reentrancy guard')));
  });
});

// ============================================================
// 2. Access Control
// ============================================================
describe('AccessControlDetector', () => {
  const d = new AccessControlDetector();

  it('detects unprotected setOwner', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A { address public owner; function setOwner(address o) external { owner = o; } }`);
    const f = d.detect(ctx);
    assert.ok(f.some(x => x.severity === Severity.CRITICAL && x.title.includes('setOwner')));
  });

  it('does NOT flag onlyOwner-protected function', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A {
        address public owner;
        modifier onlyOwner() { require(msg.sender == owner); _; }
        function setOwner(address o) external onlyOwner { owner = o; }
      }`);
    assert.strictEqual(d.detect(ctx).filter(x => x.title.includes('setOwner')).length, 0);
  });

  it('does NOT flag require(msg.sender) protected function', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A {
        address public owner;
        function setOwner(address o) external {
          require(msg.sender == owner);
          owner = o;
        }
      }`);
    assert.strictEqual(d.detect(ctx).filter(x => x.title.includes('Unprotected critical')).length, 0);
  });

  it('detects unprotected selfdestruct', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A { function kill() public { selfdestruct(payable(msg.sender)); } }`);
    assert.ok(d.detect(ctx).some(x => x.severity === Severity.CRITICAL && x.title.includes('selfdestruct')));
  });

  it('detects unprotected initializer', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A {
        address public admin;
        function initialize() external { admin = msg.sender; }
      }`);
    assert.ok(d.detect(ctx).some(x => x.title.includes('initializer')));
  });
});

// ============================================================
// 3. Unchecked Calls
// ============================================================
describe('UncheckedCallsDetector', () => {
  const d = new UncheckedCallsDetector();

  it('detects unchecked .call() (discarded return)', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A {
        function f() public { msg.sender.call{value: 1}(""); }
      }`);
    const f = d.detect(ctx);
    assert.ok(f.some(x => x.title.includes('Unchecked .call()')), 'Should detect discarded .call() return');
  });

  it('does NOT flag checked .call()', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A {
        function f(address to) public {
          (bool success,) = to.call{value: 1}("");
          require(success, "fail");
        }
      }`);
    assert.strictEqual(d.detect(ctx).filter(x => x.title.includes('Unchecked')).length, 0);
  });

  it('detects unchecked ERC-20 transfer (2 args)', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      interface IERC20 { function transfer(address, uint256) external returns (bool); }
      contract A {
        IERC20 public token;
        function f(address to) public { token.transfer(to, 100); }
      }`);
    const f = d.detect(ctx);
    assert.ok(f.some(x => x.title.includes('ERC-20 transfer')), 'Should detect unchecked ERC-20 transfer');
  });

  it('does NOT flag native ETH .transfer(amount) as ERC-20 issue', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A {
        function f(address payable to) public { to.transfer(1 ether); }
      }`);
    const f = d.detect(ctx);
    assert.ok(!f.some(x => x.title.includes('ERC-20')), 'Native .transfer(amount) should not be flagged as ERC-20');
  });
});

// ============================================================
// 4. tx.origin
// ============================================================
describe('TxOriginDetector', () => {
  const d = new TxOriginDetector();

  it('detects tx.origin in require', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A { address owner; function f() public { require(tx.origin == owner); } }`);
    assert.ok(d.detect(ctx).some(x => x.detectorId === 'tx-origin'));
  });

  it('allows safe pattern tx.origin == msg.sender', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A { function f() public view { if (tx.origin == msg.sender) {} } }`);
    assert.strictEqual(d.detect(ctx).length, 0);
  });
});

// ============================================================
// 5. Floating Pragma
// ============================================================
describe('FloatingPragmaDetector', () => {
  const d = new FloatingPragmaDetector();

  it('detects ^0.8.0', () => {
    assert.ok(d.detect(makeContext(`pragma solidity ^0.8.0; contract A {}`)).some(x => x.title.includes('Floating')));
  });

  it('does NOT flag 0.8.20', () => {
    assert.strictEqual(d.detect(makeContext(`pragma solidity 0.8.20; contract A {}`))
      .filter(x => x.title.includes('Floating')).length, 0);
  });

  it('flags outdated Solidity < 0.8', () => {
    assert.ok(d.detect(makeContext(`pragma solidity 0.7.6; contract A {}`)).some(x => x.title.includes('Outdated')));
  });
});

// ============================================================
// 6. Selfdestruct
// ============================================================
describe('SelfdestructDetector', () => {
  const d = new SelfdestructDetector();

  it('detects unprotected selfdestruct as CRITICAL', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A { function kill() public { selfdestruct(payable(msg.sender)); } }`);
    assert.ok(d.detect(ctx).some(x => x.severity === Severity.CRITICAL));
  });

  it('downgrades to MEDIUM when access control present', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A {
        address owner;
        modifier onlyOwner() { require(msg.sender == owner); _; }
        function kill() public onlyOwner { selfdestruct(payable(owner)); }
      }`);
    const f = d.detect(ctx);
    assert.ok(!f.some(x => x.severity === Severity.CRITICAL));
    assert.ok(f.some(x => x.severity === Severity.MEDIUM));
  });
});

// ============================================================
// 7. Timestamp Dependence (was negative-only, now has positive)
// ============================================================
describe('TimestampDependenceDetector', () => {
  const d = new TimestampDependenceDetector();

  it('detects block.timestamp used for randomness', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A {
        function rand() public view returns (uint256) {
          return uint256(keccak256(abi.encodePacked(block.timestamp))) % 100;
        }
      }`);
    assert.ok(d.detect(ctx).some(x => x.title.includes('randomness')));
  });

  it('detects exact timestamp equality', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A { function f(uint256 t) public view { require(block.timestamp == t); } }`);
    assert.ok(d.detect(ctx).some(x => x.title.includes('Exact timestamp')));
  });

  it('does NOT flag contracts without timestamp usage', () => {
    assert.strictEqual(d.detect(makeContext(`pragma solidity ^0.8.0;
      contract A { function f() public pure returns (uint256) { return 42; } }`)).length, 0);
  });
});

// ============================================================
// 8. DOS Vectors
// ============================================================
describe('DOSVectorsDetector', () => {
  const d = new DOSVectorsDetector();

  it('detects unbounded loop over state array', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A {
        address[] public users;
        function f() public {
          for (uint i = 0; i < users.length; i++) {}
        }
      }`);
    assert.ok(d.detect(ctx).some(x => x.title.includes('Unbounded loop')));
  });

  it('detects .transfer() in loop', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A {
        address[] public users;
        function f() public {
          for (uint i = 0; i < 10; i++) { payable(users[i]).transfer(1); }
        }
      }`);
    assert.ok(d.detect(ctx).some(x => x.title.includes('External call inside loop')));
  });

  it('detects .call{value}() in loop (NameValueExpression)', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A {
        function f(address[] memory addrs) public {
          for (uint i = 0; i < addrs.length; i++) {
            addrs[i].call{value: 1}("");
          }
        }
      }`);
    assert.ok(d.detect(ctx).some(x => x.title.includes('External call inside loop')),
      'Should detect .call{value}() inside loop');
  });

  it('does NOT flag bounded loop without external calls', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A {
        uint256 public x;
        function f() public { for (uint i = 0; i < 10; i++) { x += i; } }
      }`);
    assert.strictEqual(d.detect(ctx).length, 0);
  });
});

// ============================================================
// 9. Delegatecall
// ============================================================
describe('DelegatecallDetector', () => {
  const d = new DelegatecallDetector();

  it('detects delegatecall to user-controlled address', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A {
        function exec(address target, bytes calldata data) public {
          target.delegatecall(data);
        }
      }`);
    const f = d.detect(ctx);
    assert.ok(f.some(x => x.severity === Severity.CRITICAL && x.title.includes('user-controlled')));
  });

  it('still flags non-user-controlled delegatecall (for review)', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A {
        address immutable impl;
        constructor(address _impl) { impl = _impl; }
        function exec(bytes calldata data) public { impl.delegatecall(data); }
      }`);
    const f = d.detect(ctx);
    assert.ok(f.some(x => x.detectorId === 'delegatecall'));
    assert.ok(!f.some(x => x.title.includes('user-controlled')));
  });

  it('does NOT flag contracts without delegatecall', () => {
    assert.strictEqual(d.detect(makeContext(`pragma solidity ^0.8.0;
      contract A { function f() public {} }`)).length, 0);
  });
});

// ============================================================
// 10. Integer Overflow
// ============================================================
describe('IntegerOverflowDetector', () => {
  const d = new IntegerOverflowDetector();

  it('detects unchecked arithmetic in 0.8.0+', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A {
        function f(uint256 a, uint256 b) public pure returns (uint256) {
          unchecked { return a * b; }
        }
      }`);
    assert.ok(d.detect(ctx).some(x => x.title.includes('Unchecked arithmetic')));
  });

  it('detects pre-0.8 arithmetic without SafeMath', () => {
    const ctx = makeContext(`pragma solidity ^0.7.0;
      contract A {
        function f(uint256 a, uint256 b) public pure returns (uint256) { return a + b; }
      }`);
    assert.ok(d.detect(ctx).some(x => x.title.includes('overflow')));
  });

  it('does NOT flag regular arithmetic in 0.8.0+', () => {
    const ctx = makeContext(`pragma solidity 0.8.20;
      contract A {
        function f(uint256 a, uint256 b) public pure returns (uint256) { return a + b; }
      }`);
    assert.ok(!d.detect(ctx).some(x => x.title.includes('overflow') || x.title.includes('Unchecked')));
  });
});

// ============================================================
// 11. Front-Running
// ============================================================
describe('FrontRunningDetector', () => {
  const d = new FrontRunningDetector();

  it('detects swap function without slippage protection', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A {
        function swap(address tokenIn, address tokenOut, uint256 amountIn) external {}
      }`);
    assert.ok(d.detect(ctx).some(x => x.title.includes('slippage')));
  });

  it('does NOT flag swap with minAmountOut parameter', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A {
        function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut) external {}
      }`);
    assert.ok(!d.detect(ctx).some(x => x.title.includes('slippage')));
  });

  it('detects approve race condition', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract Token {
        mapping(address => mapping(address => uint256)) public allowance;
        function approve(address spender, uint256 amount) public returns (bool) {
          allowance[msg.sender][spender] = amount;
          return true;
        }
      }`);
    assert.ok(d.detect(ctx).some(x => x.title.includes('approve race')));
  });
});

// ============================================================
// 12. Flash Loan
// ============================================================
describe('FlashLoanDetector', () => {
  const d = new FlashLoanDetector();

  it('detects balance-dependent validation in require', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      interface IERC20 { function balanceOf(address) external view returns (uint256); }
      contract A {
        IERC20 public token;
        function vote() public {
          require(token.balanceOf(msg.sender) > 0, "No tokens");
        }
      }`);
    assert.ok(d.detect(ctx).some(x => x.title.includes('Balance-dependent')));
  });

  it('detects getReserves() spot price reliance', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      interface IPair { function getReserves() external view returns (uint112, uint112, uint32); }
      contract A {
        IPair public pair;
        function getPrice() public view { pair.getReserves(); }
      }`);
    assert.ok(d.detect(ctx).some(x => x.title.includes('Spot price')));
  });

  it('does NOT flag contracts without balance checks', () => {
    assert.strictEqual(d.detect(makeContext(`pragma solidity ^0.8.0;
      contract A { function f() public pure returns (uint256) { return 1; } }`)).length, 0);
  });
});

// ============================================================
// 13. Oracle Manipulation
// ============================================================
describe('OracleManipulationDetector', () => {
  const d = new OracleManipulationDetector();

  it('detects missing staleness check on latestRoundData', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      interface AggregatorV3Interface {
        function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
      }
      contract A {
        AggregatorV3Interface public feed;
        function getPrice() public view returns (int256) {
          (, int256 answer,,,) = feed.latestRoundData();
          return answer;
        }
      }`);
    const f = d.detect(ctx);
    assert.ok(f.some(x => x.title.includes('staleness')), 'Should detect missing staleness check');
    assert.ok(f.some(x => x.title.includes('price validation')), 'Should detect missing price validation');
  });

  it('does NOT flag properly validated oracle calls', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      interface AggregatorV3Interface {
        function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
      }
      contract A {
        AggregatorV3Interface public feed;
        function getPrice() public view returns (int256) {
          (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) = feed.latestRoundData();
          require(answer > 0, "Invalid price");
          require(block.timestamp - updatedAt < 3600, "Stale");
          require(answeredInRound >= roundId, "Round not complete");
          return answer;
        }
      }`);
    const f = d.detect(ctx);
    assert.ok(!f.some(x => x.title.includes('staleness')), 'Should not flag validated staleness');
    assert.ok(!f.some(x => x.title.includes('price validation')), 'Should not flag validated price');
    assert.ok(!f.some(x => x.title.includes('round completeness')), 'Should not flag validated round');
  });

  it('detects deprecated latestAnswer()', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      interface AggregatorV3Interface { function latestAnswer() external view returns (int256); }
      contract A {
        AggregatorV3Interface public feed;
        function f() public view returns (int256) { return feed.latestAnswer(); }
      }`);
    assert.ok(d.detect(ctx).some(x => x.title.includes('Deprecated latestAnswer')));
  });
});

// ============================================================
// 14. Proxy Storage
// ============================================================
describe('ProxyStorageDetector', () => {
  const d = new ProxyStorageDetector();

  it('detects missing __gap in upgradeable contract', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract Initializable {}
      contract MyContract is Initializable {
        uint256 public value;
        function initialize(uint256 v) external { value = v; }
      }`);
    assert.ok(d.detect(ctx).some(x => x.title.includes('Missing storage gap')));
  });

  it('does NOT flag non-upgradeable contracts', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A { uint256 public value; }`);
    assert.strictEqual(d.detect(ctx).length, 0);
  });

  it('detects constructor logic in upgradeable contract', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract Initializable {}
      contract MyUpgradeable is Initializable {
        address public admin;
        constructor() { admin = msg.sender; }
      }`);
    assert.ok(d.detect(ctx).some(x => x.title.includes('Constructor in upgradeable')));
  });
});

// ============================================================
// 15. ERC Compliance
// ============================================================
describe('ERCComplianceDetector', () => {
  const d = new ERCComplianceDetector();

  it('detects missing ERC-20 functions', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract Token {
        uint256 public totalSupply;
        function balanceOf(address a) public view returns (uint256) { return 0; }
        function transfer(address to, uint256 amt) public returns (bool) { return true; }
        // missing: allowance, approve, transferFrom
      }`);
    const f = d.detect(ctx);
    assert.ok(f.some(x => x.title.includes('transferFrom')), 'Should detect missing transferFrom');
    assert.ok(f.some(x => x.title.includes('allowance')), 'Should detect missing allowance');
  });

  it('detects missing ERC-20 transfer return value', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract Token {
        uint256 public totalSupply;
        function balanceOf(address a) public view returns (uint256) { return 0; }
        function transfer(address to, uint256 amt) public {
          // no return value
        }
      }`);
    const f = d.detect(ctx);
    assert.ok(f.some(x => x.title.includes('missing return value')), 'Should detect missing return');
  });

  it('does NOT flag non-token contracts', () => {
    assert.strictEqual(d.detect(makeContext(`pragma solidity ^0.8.0;
      contract A { function foo() public {} }`)).length, 0);
  });
});

// ============================================================
// 16. Gas Optimization
// ============================================================
describe('GasOptimizationDetector', () => {
  const d = new GasOptimizationDetector();

  it('detects storage reads in loops', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A {
        uint256 public total;
        function f() public {
          for (uint i = 0; i < 10; i++) { total += i; }
        }
      }`);
    assert.ok(d.detect(ctx).some(x => x.title.includes('read in loop')));
  });

  it('detects > 0 comparison for uints', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A {
        function f(uint256 x) public pure { require(x > 0); }
      }`);
    assert.ok(d.detect(ctx).some(x => x.title.includes('!= 0')));
  });

  it('does NOT flag contracts without gas issues', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A {
        function f(uint256 x) public pure returns (uint256) { return x + 1; }
      }`);
    assert.strictEqual(d.detect(ctx).length, 0);
  });
});

// ============================================================
// 17. Locked Ether
// ============================================================
describe('LockedEtherDetector', () => {
  const d = new LockedEtherDetector();

  it('detects contract that receives ETH with no withdrawal', () => {
    assert.ok(d.detect(makeContext(`pragma solidity ^0.8.0;
      contract A { receive() external payable {} }`)).length > 0);
  });

  it('does NOT flag when withdraw exists', () => {
    assert.strictEqual(d.detect(makeContext(`pragma solidity ^0.8.0;
      contract A {
        receive() external payable {}
        function withdraw() public {
          (bool s,) = msg.sender.call{value: address(this).balance}("");
          require(s);
        }
      }`)).length, 0);
  });

  it('does NOT flag contract that cannot receive ETH', () => {
    assert.strictEqual(d.detect(makeContext(`pragma solidity ^0.8.0;
      contract A { function f() public {} }`)).length, 0);
  });
});

// ============================================================
// 18. State Shadowing
// ============================================================
describe('StateShadowingDetector', () => {
  const d = new StateShadowingDetector();

  it('detects shadowed state variable in derived contract', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract Base { uint256 public value; }
      contract Derived is Base { uint256 public value; }`);
    assert.ok(d.detect(ctx).some(x => x.title.includes('shadows')));
  });

  it('detects local variable shadowing state variable', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A {
        uint256 public value;
        function f() public { uint256 value = 1; }
      }`);
    assert.ok(d.detect(ctx).some(x => x.title.includes('Local variable')));
  });

  it('does NOT flag unique variable names', () => {
    assert.strictEqual(d.detect(makeContext(`pragma solidity ^0.8.0;
      contract Base { uint256 public x; }
      contract Derived is Base { uint256 public y; }`)).length, 0);
  });
});

// ============================================================
// 19. Missing Events
// ============================================================
describe('MissingEventsDetector', () => {
  const d = new MissingEventsDetector();

  it('detects missing event on owner change', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A {
        address public owner;
        function setOwner(address o) external { owner = o; }
      }`);
    const f = d.detect(ctx);
    assert.ok(f.some(x => x.title.includes('Missing event') && x.title.includes('setOwner')));
  });

  it('does NOT flag when event is emitted', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A {
        address public owner;
        event OwnerUpdated(address, address);
        function setOwner(address o) external { emit OwnerUpdated(owner, o); owner = o; }
      }`);
    assert.ok(!d.detect(ctx).some(x => x.title.includes('Missing event')));
  });
});

// ============================================================
// 20. Unsafe Assembly
// ============================================================
describe('UnsafeAssemblyDetector', () => {
  const d = new UnsafeAssemblyDetector();

  it('detects sstore in assembly', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A {
        function f(uint256 s, bytes32 v) public {
          assembly { sstore(s, v) }
        }
      }`);
    assert.ok(d.detect(ctx).some(x => x.title.includes('sstore')));
  });

  it('does NOT flag contracts without assembly', () => {
    assert.strictEqual(d.detect(makeContext(`pragma solidity ^0.8.0;
      contract A { function f() public {} }`)).length, 0);
  });
});

// ============================================================
// 21. Precision Loss
// ============================================================
describe('PrecisionLossDetector', () => {
  const d = new PrecisionLossDetector();

  it('detects (a / b) * c pattern', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A {
        function f(uint256 a, uint256 b, uint256 c) public pure returns (uint256) {
          return (a / b) * c;
        }
      }`);
    assert.ok(d.detect(ctx).some(x => x.title.includes('Division before multiplication')));
  });

  it('does NOT flag (a * c) / b pattern', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A {
        function f(uint256 a, uint256 b, uint256 c) public pure returns (uint256) {
          return (a * c) / b;
        }
      }`);
    assert.ok(!d.detect(ctx).some(x => x.title.includes('Division before multiplication')));
  });

  it('detects division by variable without zero check', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A {
        function f(uint256 a, uint256 b) public pure returns (uint256) { return a / b; }
      }`);
    assert.ok(d.detect(ctx).some(x => x.title.includes('division by zero')));
  });
});

// ============================================================
// 22. Centralization Risk
// ============================================================
describe('CentralizationRiskDetector', () => {
  const d = new CentralizationRiskDetector();

  it('detects privileged withdraw', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A {
        address owner;
        modifier onlyOwner() { require(msg.sender == owner); _; }
        function withdrawAll() external onlyOwner { payable(owner).transfer(address(this).balance); }
      }`);
    assert.ok(d.detect(ctx).some(x => x.detectorId === 'centralization-risk' && x.title.includes('withdrawAll')));
  });

  it('detects high centralization when 3+ privileged functions exist', () => {
    const ctx = makeContext(`pragma solidity ^0.8.0;
      contract A {
        address owner;
        modifier onlyOwner() { require(msg.sender == owner); _; }
        function withdrawAll() external onlyOwner {}
        function pause() external onlyOwner {}
        function mint(address to, uint256 amt) external onlyOwner {}
      }`);
    assert.ok(d.detect(ctx).some(x => x.title.includes('High centralization')));
  });

  it('does NOT flag non-privileged functions', () => {
    assert.strictEqual(d.detect(makeContext(`pragma solidity ^0.8.0;
      contract A { function open() external {} }`)).length, 0);
  });
});

// ============================================================
// INTEGRATION: DeFi Lending fixture coverage
// ============================================================
describe('DeFi Lending fixture', () => {
  it('detects ALL expected vulnerability classes', async () => {
    const engine = new AuditEngine({ files: [path.join(FIXTURES, 'defi-lending.sol')] });
    const r = await engine.run();

    const detectorIds = new Set(r.findings.map(f => f.detectorId));

    assert.ok(detectorIds.has('locked-ether'), 'Should detect locked ether in ETHTrap');
    assert.ok(detectorIds.has('state-shadowing'), 'Should detect state shadowing in Derived');
    assert.ok(detectorIds.has('missing-events'), 'Should detect missing events in LendingPool');
    assert.ok(detectorIds.has('precision-loss'), 'Should detect precision loss');
    assert.ok(detectorIds.has('centralization-risk'), 'Should detect centralization risk');
    assert.ok(detectorIds.has('unsafe-assembly'), 'Should detect unsafe assembly');
    assert.ok(detectorIds.has('unchecked-calls'), 'Should detect unchecked ERC-20 calls');
    assert.ok(detectorIds.has('oracle-manipulation'), 'Should detect oracle issues');
  });
});

describe('Vulnerable fixture', () => {
  it('detects ALL expected vulnerability classes', async () => {
    const engine = new AuditEngine({ files: [path.join(FIXTURES, 'vulnerable.sol')] });
    const r = await engine.run();

    const detectorIds = new Set(r.findings.map(f => f.detectorId));

    assert.ok(detectorIds.has('reentrancy'), 'Should detect reentrancy');
    assert.ok(detectorIds.has('access-control'), 'Should detect access control');
    assert.ok(detectorIds.has('unchecked-calls'), 'Should detect unchecked calls');
    assert.ok(detectorIds.has('tx-origin'), 'Should detect tx.origin');
    assert.ok(detectorIds.has('selfdestruct'), 'Should detect selfdestruct');
    assert.ok(detectorIds.has('floating-pragma'), 'Should detect floating pragma');
    assert.ok(detectorIds.has('dos-vectors'), 'Should detect DOS vectors');
    assert.ok(detectorIds.has('timestamp-dependence'), 'Should detect timestamp dependence');
    assert.ok(detectorIds.has('delegatecall'), 'Should detect delegatecall');
    assert.ok(detectorIds.has('oracle-manipulation'), 'Should detect oracle manipulation');
    assert.ok(detectorIds.has('front-running'), 'Should detect front-running');
  });
});
