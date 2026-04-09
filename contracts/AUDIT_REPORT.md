# Vault-Kit Smart Contract Security Audit Report

---

## Overview

| Property | Value |
|----------|-------|
| **Date** | 4/9/2026, 10:11:07 PM |
| **Engine Version** | 1.0.0 |
| **Files Analyzed** | 1 |
| **Contracts Analyzed** | 5 |
| **Lines of Code** | 443 |

## Security Score

### 72/100 — (LOW) Minor issues identified

`[##############------]` 72/100

## Findings Summary

| Severity | Count |
|----------|-------|
| Critical | **0** |
| High | **0** |
| Medium | **4** |
| Low | **4** |
| Informational | 6 |
| Gas Optimization | 0 |
| **Total** | **14** |

## Scope

| File | Contracts | Lines | Findings |
|------|-----------|-------|----------|
| `/home/user/Vault-Kit/contracts/ArbitrumVault.sol` | IERC20, IStrategy, AggregatorV3Interface, SafeERC20, ArbitrumVault | 443 | 14 |

## Detailed Findings

### [MEDIUM] MEDIUM (4)

#### VK-001: Single oracle dependency in ArbitrumVault

| | |
|---|---|
| **Severity** | MEDIUM |
| **Confidence** | low |
| **Category** | Oracle Manipulation |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:105` |

**Description:**

The contract depends on a single oracle (priceFeed). If this oracle fails, returns stale data, or is manipulated, the contract has no fallback mechanism.

**Code:**

```solidity
104 |     IStrategy public strategy;
105 |     AggregatorV3Interface public immutable priceFeed;
106 | 
```

**Recommendation:**

Consider implementing a fallback oracle pattern with multiple price sources. Use a primary oracle with secondary fallback, or aggregate multiple oracle responses.

---

#### VK-011: Potential division by zero in ArbitrumVault.sharePrice()

| | |
|---|---|
| **Severity** | MEDIUM |
| **Confidence** | low |
| **Category** | Arithmetic Precision Loss |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:520` |

**Description:**

Division by variable 'totalShares' without an apparent zero-check. If totalShares is zero, the transaction will revert. If this is a user-facing function, a zero divisor should produce a meaningful error message.

**Code:**

```solidity
519 |         if (totalShares == 0) return 1e18;
520 |         return (totalAssets * 1e18) / totalShares;
521 |     }
```

**Recommendation:**

Add a require statement: require(totalShares != 0, "Division by zero");

---

#### VK-012: Potential division by zero in ArbitrumVault.previewDeposit()

| | |
|---|---|
| **Severity** | MEDIUM |
| **Confidence** | low |
| **Category** | Arithmetic Precision Loss |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:530` |

**Description:**

Division by variable 'totalAssets' without an apparent zero-check. If totalAssets is zero, the transaction will revert. If this is a user-facing function, a zero divisor should produce a meaningful error message.

**Code:**

```solidity
529 |         if (totalAssets == 0) return 0;
530 |         return (amount * totalShares) / totalAssets;
531 |     }
```

**Recommendation:**

Add a require statement: require(totalAssets != 0, "Division by zero");

---

#### VK-013: Potential division by zero in ArbitrumVault.previewWithdraw()

| | |
|---|---|
| **Severity** | MEDIUM |
| **Confidence** | low |
| **Category** | Arithmetic Precision Loss |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:535` |

**Description:**

Division by variable 'totalShares' without an apparent zero-check. If totalShares is zero, the transaction will revert. If this is a user-facing function, a zero divisor should produce a meaningful error message.

**Code:**

```solidity
534 |         if (totalShares == 0) return 0;
535 |         uint256 assetAmount = (shareAmount * totalAssets) / totalShares;
536 |         uint256 fee = (assetAmount * withdrawalFee) / 10000;
```

**Recommendation:**

Add a require statement: require(totalShares != 0, "Division by zero");

---

### [LOW] LOW (4)

#### VK-008: block.timestamp used in condition in ArbitrumVault.withdraw()

| | |
|---|---|
| **Severity** | LOW |
| **Confidence** | high |
| **Category** | Timestamp Dependence |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:253` |

**Description:**

block.timestamp is used in a comparison. Validators can manipulate the timestamp by approximately 15 seconds. Ensure this tolerance is acceptable for your use case.

**Code:**

```solidity
252 |         require(
253 |             block.timestamp >= lastDepositTime[msg.sender] + withdrawalDelay,
254 |             "Withdrawal delay"
```

**Recommendation:**

Ensure that a ~15 second manipulation of block.timestamp cannot cause harm. For time-sensitive operations, consider using block numbers or external time oracles.

---

#### VK-009: Potential precision loss in division by 10000 in ArbitrumVault.withdraw()

| | |
|---|---|
| **Severity** | LOW |
| **Confidence** | low |
| **Category** | Arithmetic Precision Loss |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:263` |

**Description:**

Division by 10000 can truncate small amounts to zero. For example, if amount < 10000, the result will be 0. This can lead to users losing small amounts of tokens ("dust") or getting 0 rewards/shares.

**Code:**

```solidity
262 |         // Calculate withdrawal fee
263 |         uint256 fee = (assetAmount * withdrawalFee) / 10000;
264 |         uint256 netAmount = assetAmount - fee;
```

**Recommendation:**

Consider adding a minimum amount check, or use fixed-point arithmetic libraries. Ensure rounding favors the protocol (round down for shares issued, round up for shares redeemed).

---

#### VK-010: Potential precision loss in division by 10000 in ArbitrumVault.harvest()

| | |
|---|---|
| **Severity** | LOW |
| **Confidence** | low |
| **Category** | Arithmetic Precision Loss |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:328` |

**Description:**

Division by 10000 can truncate small amounts to zero. For example, if amount < 10000, the result will be 0. This can lead to users losing small amounts of tokens ("dust") or getting 0 rewards/shares.

**Code:**

```solidity
327 |         if (profit > 0) {
328 |             uint256 fee = (profit * performanceFee) / 10000;
329 | 
```

**Recommendation:**

Consider adding a minimum amount check, or use fixed-point arithmetic libraries. Ensure rounding favors the protocol (round down for shares issued, round up for shares redeemed).

---

#### VK-014: Potential precision loss in division by 10000 in ArbitrumVault.previewWithdraw()

| | |
|---|---|
| **Severity** | LOW |
| **Confidence** | low |
| **Category** | Arithmetic Precision Loss |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:536` |

**Description:**

Division by 10000 can truncate small amounts to zero. For example, if amount < 10000, the result will be 0. This can lead to users losing small amounts of tokens ("dust") or getting 0 rewards/shares.

**Code:**

```solidity
535 |         uint256 assetAmount = (shareAmount * totalAssets) / totalShares;
536 |         uint256 fee = (assetAmount * withdrawalFee) / 10000;
537 |         return assetAmount - fee;
```

**Recommendation:**

Consider adding a minimum amount check, or use fixed-point arithmetic libraries. Ensure rounding favors the protocol (round down for shares issued, round up for shares redeemed).

---

### [INFO] INFORMATIONAL (6)

#### VK-002: Centralization risk: ArbitrumVault.pause()

| | |
|---|---|
| **Severity** | INFORMATIONAL |
| **Confidence** | high |
| **Category** | Centralization Risk |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:390` |

**Description:**

Privileged function pause() can freeze/unfreeze all protocol operations. This is controlled by a single owner/admin account. A timelock or multisig pattern was detected, which mitigates the risk. If this account is compromised, an attacker could exploit this function.

**Code:**

```solidity
389 | 
390 |     function pause() external onlyGuardian {
391 |         paused = true;
392 |         emit Paused(msg.sender);
393 |     }
394 | 
```

**Recommendation:**

Consider implementing:
1. A timelock (e.g., OpenZeppelin TimelockController) for parameter changes
2. Multi-signature wallet for admin operations
3. Governance voting for critical decisions
4. Maximum bounds on configurable parameters (e.g., max fee < 10%)

---

#### VK-003: Centralization risk: ArbitrumVault.unpause()

| | |
|---|---|
| **Severity** | INFORMATIONAL |
| **Confidence** | high |
| **Category** | Centralization Risk |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:395` |

**Description:**

Privileged function unpause() can freeze/unfreeze all protocol operations. This is controlled by a single owner/admin account. A timelock or multisig pattern was detected, which mitigates the risk. If this account is compromised, an attacker could exploit this function.

**Code:**

```solidity
394 | 
395 |     function unpause() external onlyOwner {
396 |         paused = false;
397 |         emit Unpaused(msg.sender);
398 |     }
399 | 
```

**Recommendation:**

Consider implementing:
1. A timelock (e.g., OpenZeppelin TimelockController) for parameter changes
2. Multi-signature wallet for admin operations
3. Governance voting for critical decisions
4. Maximum bounds on configurable parameters (e.g., max fee < 10%)

---

#### VK-004: Centralization risk: ArbitrumVault.setFeeRecipient()

| | |
|---|---|
| **Severity** | INFORMATIONAL |
| **Confidence** | high |
| **Category** | Centralization Risk |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:445` |

**Description:**

Privileged function setFeeRecipient() can modify critical protocol parameters. This is controlled by a single owner/admin account. A timelock or multisig pattern was detected, which mitigates the risk. If this account is compromised, an attacker could exploit this function.

**Code:**

```solidity
444 | 
445 |     function setFeeRecipient(address _recipient) external onlyOwner {
446 |         require(_recipient != address(0), "Zero address");
447 |         address oldRecipient = feeRecipient;
448 |         feeRecipient = _recipient;
449 |         emit FeeRecipientUpdated(oldRecipient, _recipient);
450 |     }
451 | 
```

**Recommendation:**

Consider implementing:
1. A timelock (e.g., OpenZeppelin TimelockController) for parameter changes
2. Multi-signature wallet for admin operations
3. Governance voting for critical decisions
4. Maximum bounds on configurable parameters (e.g., max fee < 10%)

---

#### VK-005: Centralization risk: ArbitrumVault.transferOwnership()

| | |
|---|---|
| **Severity** | INFORMATIONAL |
| **Confidence** | high |
| **Category** | Centralization Risk |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:459` |

**Description:**

Privileged function transferOwnership() can transfer ownership to a new address. This is controlled by a single owner/admin account. A timelock or multisig pattern was detected, which mitigates the risk. If this account is compromised, an attacker could exploit this function.

**Code:**

```solidity
458 | 
459 |     function transferOwnership(address _newOwner) external onlyOwner {
460 |         require(_newOwner != address(0), "Zero address");
461 |         pendingOwner = _newOwner;
462 |         emit OwnershipTransferStarted(owner, _newOwner);
463 |     }
464 | 
```

**Recommendation:**

Consider implementing:
1. A timelock (e.g., OpenZeppelin TimelockController) for parameter changes
2. Multi-signature wallet for admin operations
3. Governance voting for critical decisions
4. Maximum bounds on configurable parameters (e.g., max fee < 10%)

---

#### VK-006: Centralization risk: ArbitrumVault.setWhitelistEnabled()

| | |
|---|---|
| **Severity** | INFORMATIONAL |
| **Confidence** | high |
| **Category** | Centralization Risk |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:473` |

**Description:**

Privileged function setWhitelistEnabled() can modify access permissions. This is controlled by a single owner/admin account. A timelock or multisig pattern was detected, which mitigates the risk. If this account is compromised, an attacker could exploit this function.

**Code:**

```solidity
472 | 
473 |     function setWhitelistEnabled(bool _enabled) external onlyOwner {
474 |         whitelistEnabled = _enabled;
475 |         emit WhitelistEnabledUpdated(_enabled);
476 |     }
477 | 
```

**Recommendation:**

Consider implementing:
1. A timelock (e.g., OpenZeppelin TimelockController) for parameter changes
2. Multi-signature wallet for admin operations
3. Governance voting for critical decisions
4. Maximum bounds on configurable parameters (e.g., max fee < 10%)

---

#### VK-007: Centralization risk: ArbitrumVault.emergencyWithdraw()

| | |
|---|---|
| **Severity** | INFORMATIONAL |
| **Confidence** | high |
| **Category** | Centralization Risk |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:493` |

**Description:**

Privileged function emergencyWithdraw() can drain all funds from the contract. This is controlled by a single owner/admin account. A timelock or multisig pattern was detected, which mitigates the risk. If this account is compromised, an attacker could exploit this function.

**Code:**

```solidity
492 | 
493 |     function emergencyWithdraw() external nonReentrant onlyOwner {
494 |         // CEI: set state BEFORE external calls
495 |         emergencyMode = true;
496 |         paused = true;
497 | 
498 |         // Pull everything from strategy
499 |         if (address(strategy) != address(0)) {
500 |             uint256 balance = strategy.balanceOf();
501 |             if (balance > 0) {
502 |                 strategy.withdraw(balance);
503 |             }
504 |         }
505 | 
506 |         // Send all assets to owner
507 |         uint256 total = asset.balanceOf(address(this));
508 |         if (total > 0) {
509 |             asset.safeTransfer(owner, total);
510 |         }
511 | 
512 |         emit EmergencyModeSet(true);
513 |         emit Paused(msg.sender);
514 |     }
515 | 
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