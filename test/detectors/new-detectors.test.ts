import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { SolidityParser } from '../../src/core/parser';
import { AnalysisContext } from '../../src/core/context';
import { ShareInflationDetector } from '../../src/detectors/share-inflation';
import { SignatureReplayDetector } from '../../src/detectors/signature-replay';
import { WeirdERC20Detector } from '../../src/detectors/weird-erc20';
import { SandwichDetector } from '../../src/detectors/sandwich';
import { StorageCollisionDetector } from '../../src/detectors/storage-collision';
import { resetFindingCounter } from '../../src/detectors/base';

const parser = new SolidityParser();
function ctx(source: string): AnalysisContext {
  resetFindingCounter();
  return new AnalysisContext(parser.parse(source, 'test.sol'));
}

// ============================================================
// Share Inflation
// ============================================================
describe('ShareInflationDetector', () => {
  const d = new ShareInflationDetector();

  it('detects vulnerable share vault without protection', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract Vault {
        mapping(address => uint256) public shares;
        uint256 public totalShares;
        uint256 public totalAssets;

        function deposit(uint256 amount) external {
          uint256 sharesToMint;
          if (totalShares == 0) {
            sharesToMint = amount;
          } else {
            sharesToMint = (amount * totalShares) / totalAssets;
          }
          shares[msg.sender] += sharesToMint;
          totalShares += sharesToMint;
          totalAssets += amount;
        }

        function withdraw(uint256 shareAmount) external {
          uint256 assetAmount = (shareAmount * totalAssets) / totalShares;
          shares[msg.sender] -= shareAmount;
          totalShares -= shareAmount;
          totalAssets -= assetAmount;
        }
      }`);
    const f = d.detect(c);
    assert.ok(f.some(x => x.title.includes('share inflation')),
      'Should detect inflation vulnerability');
  });

  it('does NOT flag vault with dead shares pattern', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract Vault {
        mapping(address => uint256) public shares;
        uint256 public totalShares;
        uint256 public totalAssets;

        function deposit(uint256 amount) external {
          uint256 sharesToMint = totalShares == 0
            ? amount
            : (amount * totalShares) / totalAssets;
          if (totalShares == 0) {
            shares[address(0)] += 1000;
            totalShares += 1000;
          }
          shares[msg.sender] += sharesToMint;
          totalShares += sharesToMint;
          totalAssets += amount;
        }
      }`);
    const f = d.detect(c);
    assert.ok(!f.some(x => x.title.includes('share inflation')),
      'Should not flag vault with dead shares');
  });

  it('does NOT flag non-share vault contracts', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract A { function foo() public pure returns (uint256) { return 42; } }`);
    assert.strictEqual(d.detect(c).length, 0);
  });
});

// ============================================================
// Signature Replay
// ============================================================
describe('SignatureReplayDetector', () => {
  const d = new SignatureReplayDetector();

  it('detects ecrecover without nonce protection', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract A {
        function claim(bytes32 hash, uint8 v, bytes32 r, bytes32 s) external {
          address signer = ecrecover(hash, v, r, s);
          require(signer != address(0));
        }
      }`);
    const f = d.detect(c);
    assert.ok(f.some(x => x.title.includes('replay protection')));
  });

  it('does NOT flag functions without signature verification', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract A { function foo() public pure returns (uint256) { return 42; } }`);
    assert.strictEqual(d.detect(c).length, 0);
  });

  it('detects missing deadline in signed operation', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract A {
        mapping(bytes32 => bool) public used;
        function claim(bytes32 hash, uint8 v, bytes32 r, bytes32 s) external {
          require(!used[hash]);
          used[hash] = true;
          address signer = ecrecover(hash, v, r, s);
        }
      }`);
    const f = d.detect(c);
    assert.ok(f.some(x => x.title.includes('deadline')));
  });

  it('does NOT flag function with nonce AND deadline validation', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract A {
        mapping(address => uint256) public nonces;
        bytes32 public constant DOMAIN_SEPARATOR = bytes32(uint256(1));
        function permit(
          address owner, address spender, uint256 value,
          uint256 deadline, uint8 v, bytes32 r, bytes32 s
        ) external {
          require(block.timestamp <= deadline, "Expired");
          bytes32 hash = keccak256(abi.encode(DOMAIN_SEPARATOR, owner, nonces[owner]++));
          address signer = ecrecover(hash, v, r, s);
          require(signer == owner);
        }
      }`);
    const f = d.detect(c);
    assert.ok(!f.some(x => x.title.includes('replay protection')));
    assert.ok(!f.some(x => x.title.includes('Missing deadline')));
  });
});

// ============================================================
// Weird ERC-20
// ============================================================
describe('WeirdERC20Detector', () => {
  const d = new WeirdERC20Detector();

  it('detects fee-on-transfer incompatibility', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      interface IERC20 {
        function transferFrom(address, address, uint256) external returns (bool);
      }
      contract A {
        uint256 public totalAssets;
        IERC20 public token;
        function deposit(uint256 amount) external {
          token.transferFrom(msg.sender, address(this), amount);
          totalAssets += amount;
        }
      }`);
    const f = d.detect(c);
    assert.ok(f.some(x => x.title.includes('Fee-on-transfer')));
  });

  it('does NOT flag when balance diff pattern is used', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      interface IERC20 {
        function transferFrom(address, address, uint256) external returns (bool);
        function balanceOf(address) external view returns (uint256);
      }
      contract A {
        uint256 public totalAssets;
        IERC20 public token;
        function deposit(uint256 amount) external {
          uint256 before = token.balanceOf(address(this));
          token.transferFrom(msg.sender, address(this), amount);
          uint256 received = token.balanceOf(address(this)) - before;
          totalAssets += received;
        }
      }`);
    const f = d.detect(c);
    assert.ok(!f.some(x => x.title.includes('Fee-on-transfer')));
  });
});

// ============================================================
// Sandwich
// ============================================================
describe('SandwichDetector', () => {
  const d = new SandwichDetector();

  it('detects swap with zero amountOutMin', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      interface IRouter {
        function swapExactTokensForTokens(
          uint256 amountIn, uint256 amountOutMin,
          address[] calldata path, address to, uint256 deadline
        ) external returns (uint256[] memory);
      }
      contract A {
        IRouter public router;
        function swap(uint256 amountIn, address[] calldata path) external {
          router.swapExactTokensForTokens(amountIn, 0, path, address(this), block.timestamp);
        }
      }`);
    const f = d.detect(c);
    assert.ok(f.some(x => x.title.includes('Zero amountOutMin')));
  });

  it('detects block.timestamp as deadline', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      interface IRouter {
        function swapExactTokensForTokens(
          uint256, uint256, address[] calldata, address, uint256
        ) external returns (uint256[] memory);
      }
      contract A {
        IRouter public router;
        function swap(uint256 amountIn, uint256 minOut, address[] calldata path) external {
          router.swapExactTokensForTokens(amountIn, minOut, path, address(this), block.timestamp);
        }
      }`);
    const f = d.detect(c);
    assert.ok(f.some(x => x.title.includes('Deadline = block.timestamp')));
  });

  it('does NOT flag contracts without DEX interactions', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract A { function foo() public pure returns (uint256) { return 42; } }`);
    assert.strictEqual(d.detect(c).length, 0);
  });
});

// ============================================================
// Storage Collision
// ============================================================
describe('StorageCollisionDetector', () => {
  const d = new StorageCollisionDetector();

  it('detects sstore to low-numbered slot that could collide', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract A {
        uint256 public value1;
        uint256 public value2;
        function setSlot(bytes32 v) external {
          assembly { sstore(0, v) }
        }
      }`);
    const f = d.detect(c);
    assert.ok(f.some(x => x.title.includes('collides with Solidity storage')));
  });

  it('does NOT flag sstore to high-numbered slot (namespace pattern)', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract A {
        uint256 public value;
        function setSlot(bytes32 v) external {
          assembly {
            sstore(0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc, v)
          }
        }
      }`);
    const f = d.detect(c);
    assert.ok(!f.some(x => x.title.includes('collides')),
      'Hashed slot should not be flagged');
  });

  it('does NOT flag contracts without assembly', () => {
    const c = ctx(`pragma solidity ^0.8.0;
      contract A { uint256 public x; function f() public {} }`);
    assert.strictEqual(d.detect(c).length, 0);
  });
});
