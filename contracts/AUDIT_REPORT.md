# Vault-Kit Smart Contract Security Audit Report

---

## Overview

| Property | Value |
|----------|-------|
| **Date** | 4/11/2026, 9:50:21 PM |
| **Engine Version** | 1.0.0 |
| **Files Analyzed** | 1 |
| **Contracts Analyzed** | 5 |
| **Lines of Code** | 453 |

## Security Score

### 86/100 — (LOW) Minor issues identified

`[#################---]` 86/100

## Findings Summary

| Severity | Count |
|----------|-------|
| Critical | **0** |
| High | **0** |
| Medium | **2** |
| Low | **2** |
| Informational | 6 |
| Gas Optimization | 0 |
| **Total** | **10** |

## Scope

| File | Contracts | Lines | Findings |
|------|-----------|-------|----------|
| `/home/user/Vault-Kit/contracts/src/ArbitrumVault.sol` | IERC20, IStrategy, AggregatorV3Interface, SafeERC20, ArbitrumVault | 453 | 10 |

## Detailed Findings

### [MEDIUM] MEDIUM (2)

#### VK-001: Single oracle dependency in ArbitrumVault

| | |
|---|---|
| **Severity** | MEDIUM |
| **Confidence** | low |
| **Category** | Oracle Manipulation |
| **Location** | `/home/user/Vault-Kit/contracts/src/ArbitrumVault.sol:105` |

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

#### VK-010: Potential division by zero in ArbitrumVault.deposit()

| | |
|---|---|
| **Severity** | MEDIUM |
| **Confidence** | low |
| **Category** | Arithmetic Precision Loss |
| **Location** | `/home/user/Vault-Kit/contracts/src/ArbitrumVault.sol:247` |

**Description:**

Division by variable 'totalAssets' without an apparent zero-check. If totalAssets is zero, the transaction will revert. If this is a user-facing function, a zero divisor should produce a meaningful error message.

**Code:**

```solidity
246 |         } else {
247 |             sharesToMint = (received * totalShares) / totalAssets;
248 |         }
```

**Recommendation:**

Add a require statement: require(totalAssets != 0, "Division by zero");

---

### [LOW] LOW (2)

#### VK-008: Incorrect rounding direction in ArbitrumVault.withdraw()

| | |
|---|---|
| **Severity** | LOW |
| **Confidence** | low |
| **Category** | ERC-4626 Share Inflation |
| **Location** | `/home/user/Vault-Kit/contracts/src/ArbitrumVault.sol:260` |

**Description:**

Withdraw function uses standard division which rounds down. For withdraws, rounding should favor the protocol (round UP on shares burned, round DOWN on assets sent). Rounding in favor of the user allows dust-extraction attacks.

**Code:**

```solidity
259 | 
260 |     function withdraw(uint256 shareAmount) external nonReentrant whenNotPaused {
261 |         require(shareAmount != 0, "Zero shares");
262 |         require(shares[msg.sender] >= shareAmount, "Insufficient shares");
263 |         require(
264 |             block.timestamp >= lastDepositTime[msg.sender] + withdrawalDelay,
265 |             "Withdrawal delay"
266 |         );
267 |         require(totalShares != 0, "No shares outstanding");
268 | 
269 |         // Calculate assets (round down in favor of vault)
270 |         uint256 assetAmount = (shareAmount * totalAssets) / totalShares;
271 |         require(assetAmount != 0, "Zero assets");
272 | 
273 |         // Calculate withdrawal fee
274 |         uint256 fee = (assetAmount * withdrawalFee) / 10000;
275 |         uint256 netAmount = assetAmount - fee;
276 | 
277 |         // CEI: Effects BEFORE interactions
278 |         shares[msg.sender] -= shareAmount;
279 |         totalShares -= shareAmount;
280 |         totalAssets -= assetAmount;
281 | 
282 |         // Interactions: transfers AFTER all state changes
283 |         if (fee > 0) {
284 |             asset.safeTransfer(feeRecipient, fee);
285 |         }
286 |         asset.safeTransfer(msg.sender, netAmount);
287 | 
288 |         emit Withdraw(msg.sender, netAmount, shareAmount);
289 |     }
290 | 
```

**Recommendation:**

For deposits: round shares DOWN (fewer shares minted). For withdraws: round shares UP (more shares burned). Use mulDivUp/mulDivDown from OpenZeppelin Math library.

---

#### VK-009: block.timestamp used in condition in ArbitrumVault.withdraw()

| | |
|---|---|
| **Severity** | LOW |
| **Confidence** | high |
| **Category** | Timestamp Dependence |
| **Location** | `/home/user/Vault-Kit/contracts/src/ArbitrumVault.sol:264` |

**Description:**

block.timestamp is used in a comparison. Validators can manipulate the timestamp by approximately 15 seconds. Ensure this tolerance is acceptable for your use case.

**Code:**

```solidity
263 |         require(
264 |             block.timestamp >= lastDepositTime[msg.sender] + withdrawalDelay,
265 |             "Withdrawal delay"
```

**Recommendation:**

Ensure that a ~15 second manipulation of block.timestamp cannot cause harm. For time-sensitive operations, consider using block numbers or external time oracles.

---

### [INFO] INFORMATIONAL (6)

#### VK-002: Centralization risk: ArbitrumVault.pause()

| | |
|---|---|
| **Severity** | INFORMATIONAL |
| **Confidence** | high |
| **Category** | Centralization Risk |
| **Location** | `/home/user/Vault-Kit/contracts/src/ArbitrumVault.sol:401` |

**Description:**

Privileged function pause() can freeze/unfreeze all protocol operations. This is controlled by a single owner/admin account. A timelock or multisig pattern was detected, which mitigates the risk. If this account is compromised, an attacker could exploit this function.

**Code:**

```solidity
400 | 
401 |     function pause() external onlyGuardian {
402 |         paused = true;
403 |         emit Paused(msg.sender);
404 |     }
405 | 
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
| **Location** | `/home/user/Vault-Kit/contracts/src/ArbitrumVault.sol:406` |

**Description:**

Privileged function unpause() can freeze/unfreeze all protocol operations. This is controlled by a single owner/admin account. A timelock or multisig pattern was detected, which mitigates the risk. If this account is compromised, an attacker could exploit this function.

**Code:**

```solidity
405 | 
406 |     function unpause() external onlyOwner {
407 |         paused = false;
408 |         emit Unpaused(msg.sender);
409 |     }
410 | 
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
| **Location** | `/home/user/Vault-Kit/contracts/src/ArbitrumVault.sol:456` |

**Description:**

Privileged function setFeeRecipient() can modify critical protocol parameters. This is controlled by a single owner/admin account. A timelock or multisig pattern was detected, which mitigates the risk. If this account is compromised, an attacker could exploit this function.

**Code:**

```solidity
455 | 
456 |     function setFeeRecipient(address _recipient) external onlyOwner {
457 |         require(_recipient != address(0), "Zero address");
458 |         address oldRecipient = feeRecipient;
459 |         feeRecipient = _recipient;
460 |         emit FeeRecipientUpdated(oldRecipient, _recipient);
461 |     }
462 | 
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
| **Location** | `/home/user/Vault-Kit/contracts/src/ArbitrumVault.sol:470` |

**Description:**

Privileged function transferOwnership() can transfer ownership to a new address. This is controlled by a single owner/admin account. A timelock or multisig pattern was detected, which mitigates the risk. If this account is compromised, an attacker could exploit this function.

**Code:**

```solidity
469 | 
470 |     function transferOwnership(address _newOwner) external onlyOwner {
471 |         require(_newOwner != address(0), "Zero address");
472 |         pendingOwner = _newOwner;
473 |         emit OwnershipTransferStarted(owner, _newOwner);
474 |     }
475 | 
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
| **Location** | `/home/user/Vault-Kit/contracts/src/ArbitrumVault.sol:484` |

**Description:**

Privileged function setWhitelistEnabled() can modify access permissions. This is controlled by a single owner/admin account. A timelock or multisig pattern was detected, which mitigates the risk. If this account is compromised, an attacker could exploit this function.

**Code:**

```solidity
483 | 
484 |     function setWhitelistEnabled(bool _enabled) external onlyOwner {
485 |         whitelistEnabled = _enabled;
486 |         emit WhitelistEnabledUpdated(_enabled);
487 |     }
488 | 
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
| **Location** | `/home/user/Vault-Kit/contracts/src/ArbitrumVault.sol:504` |

**Description:**

Privileged function emergencyWithdraw() can drain all funds from the contract. This is controlled by a single owner/admin account. A timelock or multisig pattern was detected, which mitigates the risk. If this account is compromised, an attacker could exploit this function.

**Code:**

```solidity
503 | 
504 |     function emergencyWithdraw() external nonReentrant onlyOwner {
505 |         // CEI: set state BEFORE external calls
506 |         emergencyMode = true;
507 |         paused = true;
508 | 
509 |         // Pull everything from strategy
510 |         if (address(strategy) != address(0)) {
511 |             uint256 balance = strategy.balanceOf();
512 |             if (balance > 0) {
513 |                 strategy.withdraw(balance);
514 |             }
515 |         }
516 | 
517 |         // Send all assets to owner
518 |         uint256 total = asset.balanceOf(address(this));
519 |         if (total > 0) {
520 |             asset.safeTransfer(owner, total);
521 |         }
522 | 
523 |         emit EmergencyModeSet(true);
524 |         emit Paused(msg.sender);
525 |     }
526 | 
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