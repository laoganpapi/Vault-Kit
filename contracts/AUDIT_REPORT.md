# Vault-Kit Smart Contract Security Audit Report

---

## Overview

| Property | Value |
|----------|-------|
| **Date** | 4/11/2026, 9:58:59 PM |
| **Engine Version** | 1.0.0 |
| **Files Analyzed** | 1 |
| **Contracts Analyzed** | 5 |
| **Lines of Code** | 463 |

## Security Score

### 91/100 — (PASS) No significant issues found

`[##################--]` 91/100

## Findings Summary

| Severity | Count |
|----------|-------|
| Critical | **0** |
| High | **0** |
| Medium | **1** |
| Low | **2** |
| Informational | 6 |
| Gas Optimization | 0 |
| **Total** | **9** |

## Scope

| File | Contracts | Lines | Findings |
|------|-----------|-------|----------|
| `/home/user/Vault-Kit/contracts/src/ArbitrumVault.sol` | IERC20, IStrategy, AggregatorV3Interface, SafeERC20, ArbitrumVault | 463 | 9 |

## Detailed Findings

### [MEDIUM] MEDIUM (1)

#### VK-009: Potential division by zero in ArbitrumVault.deposit()

| | |
|---|---|
| **Severity** | MEDIUM |
| **Confidence** | low |
| **Category** | Arithmetic Precision Loss |
| **Location** | `/home/user/Vault-Kit/contracts/src/ArbitrumVault.sol:252` |

**Description:**

Division by variable 'totalAssets' without an apparent zero-check. If totalAssets is zero, the transaction will revert. If this is a user-facing function, a zero divisor should produce a meaningful error message.

**Code:**

```solidity
251 |         } else {
252 |             sharesToMint = (received * totalShares) / totalAssets;
253 |         }
```

**Recommendation:**

Add a require statement: require(totalAssets != 0, "Division by zero");

---

### [LOW] LOW (2)

#### VK-007: Incorrect rounding direction in ArbitrumVault.withdraw()

| | |
|---|---|
| **Severity** | LOW |
| **Confidence** | low |
| **Category** | ERC-4626 Share Inflation |
| **Location** | `/home/user/Vault-Kit/contracts/src/ArbitrumVault.sol:265` |

**Description:**

Withdraw function uses standard division which rounds down. For withdraws, rounding should favor the protocol (round UP on shares burned, round DOWN on assets sent). Rounding in favor of the user allows dust-extraction attacks.

**Code:**

```solidity
264 | 
265 |     function withdraw(uint256 shareAmount) external nonReentrant whenNotPaused {
266 |         require(shareAmount != 0, "Zero shares");
267 |         require(shares[msg.sender] >= shareAmount, "Insufficient shares");
268 |         require(
269 |             block.timestamp >= lastDepositTime[msg.sender] + withdrawalDelay,
270 |             "Withdrawal delay"
271 |         );
272 |         require(totalShares != 0, "No shares outstanding");
273 | 
274 |         // Calculate assets (round down in favor of vault)
275 |         uint256 assetAmount = (shareAmount * totalAssets) / totalShares;
276 |         require(assetAmount != 0, "Zero assets");
277 | 
278 |         // Calculate withdrawal fee
279 |         uint256 fee = (assetAmount * withdrawalFee) / 10000;
280 |         uint256 netAmount = assetAmount - fee;
281 | 
282 |         // CEI: Effects BEFORE interactions
283 |         shares[msg.sender] -= shareAmount;
284 |         totalShares -= shareAmount;
285 |         totalAssets -= assetAmount;
286 | 
287 |         // Interactions: transfers AFTER all state changes
288 |         if (fee > 0) {
289 |             asset.safeTransfer(feeRecipient, fee);
290 |         }
291 |         asset.safeTransfer(msg.sender, netAmount);
292 | 
293 |         emit Withdraw(msg.sender, netAmount, shareAmount);
294 |     }
295 | 
```

**Recommendation:**

For deposits: round shares DOWN (fewer shares minted). For withdraws: round shares UP (more shares burned). Use mulDivUp/mulDivDown from OpenZeppelin Math library.

---

#### VK-008: block.timestamp used in condition in ArbitrumVault.withdraw()

| | |
|---|---|
| **Severity** | LOW |
| **Confidence** | high |
| **Category** | Timestamp Dependence |
| **Location** | `/home/user/Vault-Kit/contracts/src/ArbitrumVault.sol:269` |

**Description:**

block.timestamp is used in a comparison. Validators can manipulate the timestamp by approximately 15 seconds. Ensure this tolerance is acceptable for your use case.

**Code:**

```solidity
268 |         require(
269 |             block.timestamp >= lastDepositTime[msg.sender] + withdrawalDelay,
270 |             "Withdrawal delay"
```

**Recommendation:**

Ensure that a ~15 second manipulation of block.timestamp cannot cause harm. For time-sensitive operations, consider using block numbers or external time oracles.

---

### [INFO] INFORMATIONAL (6)

#### VK-001: Centralization risk: ArbitrumVault.pause()

| | |
|---|---|
| **Severity** | INFORMATIONAL |
| **Confidence** | high |
| **Category** | Centralization Risk |
| **Location** | `/home/user/Vault-Kit/contracts/src/ArbitrumVault.sol:412` |

**Description:**

Privileged function pause() can freeze/unfreeze all protocol operations. This is controlled by a single owner/admin account. A timelock or multisig pattern was detected, which mitigates the risk. If this account is compromised, an attacker could exploit this function.

**Code:**

```solidity
411 | 
412 |     function pause() external onlyGuardian {
413 |         paused = true;
414 |         emit Paused(msg.sender);
415 |     }
416 | 
```

**Recommendation:**

Consider implementing:
1. A timelock (e.g., OpenZeppelin TimelockController) for parameter changes
2. Multi-signature wallet for admin operations
3. Governance voting for critical decisions
4. Maximum bounds on configurable parameters (e.g., max fee < 10%)

---

#### VK-002: Centralization risk: ArbitrumVault.unpause()

| | |
|---|---|
| **Severity** | INFORMATIONAL |
| **Confidence** | high |
| **Category** | Centralization Risk |
| **Location** | `/home/user/Vault-Kit/contracts/src/ArbitrumVault.sol:417` |

**Description:**

Privileged function unpause() can freeze/unfreeze all protocol operations. This is controlled by a single owner/admin account. A timelock or multisig pattern was detected, which mitigates the risk. If this account is compromised, an attacker could exploit this function.

**Code:**

```solidity
416 | 
417 |     function unpause() external onlyOwner {
418 |         paused = false;
419 |         emit Unpaused(msg.sender);
420 |     }
421 | 
```

**Recommendation:**

Consider implementing:
1. A timelock (e.g., OpenZeppelin TimelockController) for parameter changes
2. Multi-signature wallet for admin operations
3. Governance voting for critical decisions
4. Maximum bounds on configurable parameters (e.g., max fee < 10%)

---

#### VK-003: Centralization risk: ArbitrumVault.setFeeRecipient()

| | |
|---|---|
| **Severity** | INFORMATIONAL |
| **Confidence** | high |
| **Category** | Centralization Risk |
| **Location** | `/home/user/Vault-Kit/contracts/src/ArbitrumVault.sol:467` |

**Description:**

Privileged function setFeeRecipient() can modify critical protocol parameters. This is controlled by a single owner/admin account. A timelock or multisig pattern was detected, which mitigates the risk. If this account is compromised, an attacker could exploit this function.

**Code:**

```solidity
466 | 
467 |     function setFeeRecipient(address _recipient) external onlyOwner {
468 |         require(_recipient != address(0), "Zero address");
469 |         address oldRecipient = feeRecipient;
470 |         feeRecipient = _recipient;
471 |         emit FeeRecipientUpdated(oldRecipient, _recipient);
472 |     }
473 | 
```

**Recommendation:**

Consider implementing:
1. A timelock (e.g., OpenZeppelin TimelockController) for parameter changes
2. Multi-signature wallet for admin operations
3. Governance voting for critical decisions
4. Maximum bounds on configurable parameters (e.g., max fee < 10%)

---

#### VK-004: Centralization risk: ArbitrumVault.transferOwnership()

| | |
|---|---|
| **Severity** | INFORMATIONAL |
| **Confidence** | high |
| **Category** | Centralization Risk |
| **Location** | `/home/user/Vault-Kit/contracts/src/ArbitrumVault.sol:481` |

**Description:**

Privileged function transferOwnership() can transfer ownership to a new address. This is controlled by a single owner/admin account. A timelock or multisig pattern was detected, which mitigates the risk. If this account is compromised, an attacker could exploit this function.

**Code:**

```solidity
480 | 
481 |     function transferOwnership(address _newOwner) external onlyOwner {
482 |         require(_newOwner != address(0), "Zero address");
483 |         pendingOwner = _newOwner;
484 |         emit OwnershipTransferStarted(owner, _newOwner);
485 |     }
486 | 
```

**Recommendation:**

Consider implementing:
1. A timelock (e.g., OpenZeppelin TimelockController) for parameter changes
2. Multi-signature wallet for admin operations
3. Governance voting for critical decisions
4. Maximum bounds on configurable parameters (e.g., max fee < 10%)

---

#### VK-005: Centralization risk: ArbitrumVault.setWhitelistEnabled()

| | |
|---|---|
| **Severity** | INFORMATIONAL |
| **Confidence** | high |
| **Category** | Centralization Risk |
| **Location** | `/home/user/Vault-Kit/contracts/src/ArbitrumVault.sol:495` |

**Description:**

Privileged function setWhitelistEnabled() can modify access permissions. This is controlled by a single owner/admin account. A timelock or multisig pattern was detected, which mitigates the risk. If this account is compromised, an attacker could exploit this function.

**Code:**

```solidity
494 | 
495 |     function setWhitelistEnabled(bool _enabled) external onlyOwner {
496 |         whitelistEnabled = _enabled;
497 |         emit WhitelistEnabledUpdated(_enabled);
498 |     }
499 | 
```

**Recommendation:**

Consider implementing:
1. A timelock (e.g., OpenZeppelin TimelockController) for parameter changes
2. Multi-signature wallet for admin operations
3. Governance voting for critical decisions
4. Maximum bounds on configurable parameters (e.g., max fee < 10%)

---

#### VK-006: Centralization risk: ArbitrumVault.emergencyWithdraw()

| | |
|---|---|
| **Severity** | INFORMATIONAL |
| **Confidence** | high |
| **Category** | Centralization Risk |
| **Location** | `/home/user/Vault-Kit/contracts/src/ArbitrumVault.sol:515` |

**Description:**

Privileged function emergencyWithdraw() can drain all funds from the contract. This is controlled by a single owner/admin account. A timelock or multisig pattern was detected, which mitigates the risk. If this account is compromised, an attacker could exploit this function.

**Code:**

```solidity
514 | 
515 |     function emergencyWithdraw() external nonReentrant onlyOwner {
516 |         // CEI: set state BEFORE external calls
517 |         emergencyMode = true;
518 |         paused = true;
519 | 
520 |         // Pull everything from strategy
521 |         if (address(strategy) != address(0)) {
522 |             uint256 balance = strategy.balanceOf();
523 |             if (balance > 0) {
524 |                 strategy.withdraw(balance);
525 |             }
526 |         }
527 | 
528 |         // Send all assets to owner
529 |         uint256 total = asset.balanceOf(address(this));
530 |         if (total > 0) {
531 |             asset.safeTransfer(owner, total);
532 |         }
533 | 
534 |         emit EmergencyModeSet(true);
535 |         emit Paused(msg.sender);
536 |     }
537 | 
```

**Recommendation:**

Consider implementing:
1. A timelock (e.g., OpenZeppelin TimelockController) for parameter changes
2. Multi-signature wallet for admin operations
3. Governance voting for critical decisions
4. Maximum bounds on configurable parameters (e.g., max fee < 10%)

---

## Disclaimer

This report was generated by **Vault-Kit** automated static analysis engine. Static analysis is a valuable first step in security assessment but cannot detect all vulnerability classes (e.g., business logic errors, economic attacks). This report should not be considered a substitute for a comprehensive manual audit by experienced security researchers.

---
*Generated by Vault-Kit v1.0.0*