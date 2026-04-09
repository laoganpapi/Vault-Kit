# Vault-Kit Smart Contract Security Audit Report

---

## Overview

| Property | Value |
|----------|-------|
| **Date** | 4/9/2026, 10:04:59 PM |
| **Engine Version** | 1.0.0 |
| **Files Analyzed** | 1 |
| **Contracts Analyzed** | 4 |
| **Lines of Code** | 311 |

## Security Score

### 0/100 — (CRIT) Severe vulnerabilities — do not deploy

`[--------------------]` 0/100

## Findings Summary

| Severity | Count |
|----------|-------|
| Critical | **6** |
| High | **41** |
| Medium | **8** |
| Low | **14** |
| Informational | 11 |
| Gas Optimization | 0 |
| **Total** | **80** |

## Scope

| File | Contracts | Lines | Findings |
|------|-----------|-------|----------|
| `/home/user/Vault-Kit/contracts/ArbitrumVault.sol` | IERC20, IStrategy, AggregatorV3Interface, ArbitrumVault | 311 | 80 |

## Detailed Findings

### [CRITICAL] CRITICAL (6)

#### VK-011: Reentrancy in ArbitrumVault.harvest()

| | |
|---|---|
| **Severity** | CRITICAL |
| **Confidence** | high |
| **Category** | Reentrancy |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:242` |

**Description:**

State variable is modified after an external call at line 240. The state change at line 242 occurs after the external call, violating the Checks-Effects-Interactions pattern. No reentrancy guard modifier was detected.

**Code:**

```solidity
241 |             }
242 |             totalAssets += profit - fee;
243 |             emit Harvested(profit, fee);
```

**Recommendation:**

Apply the Checks-Effects-Interactions pattern: perform all state changes BEFORE external calls. Additionally, use a reentrancy guard modifier (e.g., OpenZeppelin ReentrancyGuard).

**References:**
- https://swcregistry.io/docs/SWC-107
- https://consensys.github.io/smart-contract-best-practices/attacks/reentrancy/

---

#### VK-020: Reentrancy in ArbitrumVault.collectManagementFees()

| | |
|---|---|
| **Severity** | CRITICAL |
| **Confidence** | high |
| **Category** | Reentrancy |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:252` |

**Description:**

State variable is modified after an external call at line 253. The state change at line 252 occurs after the external call, violating the Checks-Effects-Interactions pattern. No reentrancy guard modifier was detected.

**Code:**

```solidity
251 |         if (fee > 0 && fee < totalAssets) {
252 |             totalAssets -= fee;
253 |             asset.transfer(feeRecipient, fee);
```

**Recommendation:**

Apply the Checks-Effects-Interactions pattern: perform all state changes BEFORE external calls. Additionally, use a reentrancy guard modifier (e.g., OpenZeppelin ReentrancyGuard).

**References:**
- https://swcregistry.io/docs/SWC-107
- https://consensys.github.io/smart-contract-best-practices/attacks/reentrancy/

---

#### VK-021: Reentrancy in ArbitrumVault.collectManagementFees()

| | |
|---|---|
| **Severity** | CRITICAL |
| **Confidence** | high |
| **Category** | Reentrancy |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:254` |

**Description:**

State variable is modified after an external call at line 253. The state change at line 254 occurs after the external call, violating the Checks-Effects-Interactions pattern. No reentrancy guard modifier was detected.

**Code:**

```solidity
253 |             asset.transfer(feeRecipient, fee);
254 |             lastFeeCollection = block.timestamp;
255 |             emit FeesCollected(fee);
```

**Recommendation:**

Apply the Checks-Effects-Interactions pattern: perform all state changes BEFORE external calls. Additionally, use a reentrancy guard modifier (e.g., OpenZeppelin ReentrancyGuard).

**References:**
- https://swcregistry.io/docs/SWC-107
- https://consensys.github.io/smart-contract-best-practices/attacks/reentrancy/

---

#### VK-031: Reentrancy in ArbitrumVault.emergencyWithdraw()

| | |
|---|---|
| **Severity** | CRITICAL |
| **Confidence** | high |
| **Category** | Reentrancy |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:359` |

**Description:**

State variable is modified after an external call at line 357. The state change at line 359 occurs after the external call, violating the Checks-Effects-Interactions pattern. No reentrancy guard modifier was detected.

**Code:**

```solidity
358 | 
359 |         emergencyMode = true;
360 |         paused = true;
```

**Recommendation:**

Apply the Checks-Effects-Interactions pattern: perform all state changes BEFORE external calls. Additionally, use a reentrancy guard modifier (e.g., OpenZeppelin ReentrancyGuard).

**References:**
- https://swcregistry.io/docs/SWC-107
- https://consensys.github.io/smart-contract-best-practices/attacks/reentrancy/

---

#### VK-032: Reentrancy in ArbitrumVault.emergencyWithdraw()

| | |
|---|---|
| **Severity** | CRITICAL |
| **Confidence** | high |
| **Category** | Reentrancy |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:360` |

**Description:**

State variable is modified after an external call at line 357. The state change at line 360 occurs after the external call, violating the Checks-Effects-Interactions pattern. No reentrancy guard modifier was detected.

**Code:**

```solidity
359 |         emergencyMode = true;
360 |         paused = true;
361 |     }
```

**Recommendation:**

Apply the Checks-Effects-Interactions pattern: perform all state changes BEFORE external calls. Additionally, use a reentrancy guard modifier (e.g., OpenZeppelin ReentrancyGuard).

**References:**
- https://swcregistry.io/docs/SWC-107
- https://consensys.github.io/smart-contract-best-practices/attacks/reentrancy/

---

#### VK-038: Unprotected critical function: ArbitrumVault.pause()

| | |
|---|---|
| **Severity** | CRITICAL |
| **Confidence** | high |
| **Category** | Access Control |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:273` |

**Description:**

The function pause() is a critical operation that lacks access control. No ownership modifiers (onlyOwner, onlyAdmin, etc.) or msg.sender checks were found. This allows any external account to call this function.

**Code:**

```solidity
272 | 
273 |     function pause() external onlyGuardian {
274 |         paused = true;
275 |         emit Paused(msg.sender);
276 |     }
277 | 
```

**Recommendation:**

Add an appropriate access control modifier (e.g., onlyOwner) or implement a role-based access control system using OpenZeppelin AccessControl.

**References:**
- https://swcregistry.io/docs/SWC-105
- https://docs.openzeppelin.com/contracts/4.x/access-control

---

### [HIGH] HIGH (41)

#### VK-002: Cross-function reentrancy: ArbitrumVault.withdraw() -> deposit()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | medium |
| **Category** | Reentrancy |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:164` |

**Description:**

Function withdraw() makes external calls and modifies state variables [shares, totalShares, totalAssets] that are also read by deposit(). During the external call in withdraw(), an attacker can reenter through deposit() and read stale values of these variables.

**Code:**

```solidity
163 | 
164 |     function withdraw(uint256 shareAmount) external whenNotPaused {
165 |         require(shares[msg.sender] >= shareAmount, "Insufficient shares");
166 |         require(
167 |             block.timestamp >= lastDepositTime[msg.sender] + withdrawalDelay,
168 |             "Withdrawal delay"
169 |         );
170 | 
171 |         // Calculate assets
172 |         uint256 assetAmount = (shareAmount * totalAssets) / totalShares;
173 | 
174 |         // Apply withdrawal fee
175 |         uint256 fee = (assetAmount * withdrawalFee) / 10000;
176 |         uint256 netAmount = assetAmount - fee;
177 | 
178 |         // Update state
179 |         shares[msg.sender] -= shareAmount;
180 |         totalShares -= shareAmount;
181 |         totalAssets -= assetAmount;
182 | 
183 |         // Transfer fee
184 |         if (fee > 0) {
185 |             asset.transfer(feeRecipient, fee);
186 |         }
187 | 
188 |         // Transfer assets to user
189 |         asset.transfer(msg.sender, netAmount);
190 | 
191 |         emit Withdraw(msg.sender, netAmount, shareAmount);
192 |     }
193 | 
```

**Recommendation:**

Apply a shared nonReentrant modifier to both withdraw() and deposit(). Alternatively, ensure all state changes in withdraw() complete before any external call.

**References:**
- https://medium.com/coinmonks/cross-function-reentrancy-de9cbce0129e

---

#### VK-003: Cross-function reentrancy: ArbitrumVault.withdraw() -> harvest()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | medium |
| **Category** | Reentrancy |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:164` |

**Description:**

Function withdraw() makes external calls and modifies state variables [totalAssets] that are also read by harvest(). During the external call in withdraw(), an attacker can reenter through harvest() and read stale values of these variables.

**Code:**

```solidity
163 | 
164 |     function withdraw(uint256 shareAmount) external whenNotPaused {
165 |         require(shares[msg.sender] >= shareAmount, "Insufficient shares");
166 |         require(
167 |             block.timestamp >= lastDepositTime[msg.sender] + withdrawalDelay,
168 |             "Withdrawal delay"
169 |         );
170 | 
171 |         // Calculate assets
172 |         uint256 assetAmount = (shareAmount * totalAssets) / totalShares;
173 | 
174 |         // Apply withdrawal fee
175 |         uint256 fee = (assetAmount * withdrawalFee) / 10000;
176 |         uint256 netAmount = assetAmount - fee;
177 | 
178 |         // Update state
179 |         shares[msg.sender] -= shareAmount;
180 |         totalShares -= shareAmount;
181 |         totalAssets -= assetAmount;
182 | 
183 |         // Transfer fee
184 |         if (fee > 0) {
185 |             asset.transfer(feeRecipient, fee);
186 |         }
187 | 
188 |         // Transfer assets to user
189 |         asset.transfer(msg.sender, netAmount);
190 | 
191 |         emit Withdraw(msg.sender, netAmount, shareAmount);
192 |     }
193 | 
```

**Recommendation:**

Apply a shared nonReentrant modifier to both withdraw() and harvest(). Alternatively, ensure all state changes in withdraw() complete before any external call.

**References:**
- https://medium.com/coinmonks/cross-function-reentrancy-de9cbce0129e

---

#### VK-004: Cross-function reentrancy: ArbitrumVault.withdraw() -> collectManagementFees()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | medium |
| **Category** | Reentrancy |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:164` |

**Description:**

Function withdraw() makes external calls and modifies state variables [totalAssets] that are also read by collectManagementFees(). During the external call in withdraw(), an attacker can reenter through collectManagementFees() and read stale values of these variables.

**Code:**

```solidity
163 | 
164 |     function withdraw(uint256 shareAmount) external whenNotPaused {
165 |         require(shares[msg.sender] >= shareAmount, "Insufficient shares");
166 |         require(
167 |             block.timestamp >= lastDepositTime[msg.sender] + withdrawalDelay,
168 |             "Withdrawal delay"
169 |         );
170 | 
171 |         // Calculate assets
172 |         uint256 assetAmount = (shareAmount * totalAssets) / totalShares;
173 | 
174 |         // Apply withdrawal fee
175 |         uint256 fee = (assetAmount * withdrawalFee) / 10000;
176 |         uint256 netAmount = assetAmount - fee;
177 | 
178 |         // Update state
179 |         shares[msg.sender] -= shareAmount;
180 |         totalShares -= shareAmount;
181 |         totalAssets -= assetAmount;
182 | 
183 |         // Transfer fee
184 |         if (fee > 0) {
185 |             asset.transfer(feeRecipient, fee);
186 |         }
187 | 
188 |         // Transfer assets to user
189 |         asset.transfer(msg.sender, netAmount);
190 | 
191 |         emit Withdraw(msg.sender, netAmount, shareAmount);
192 |     }
193 | 
```

**Recommendation:**

Apply a shared nonReentrant modifier to both withdraw() and collectManagementFees(). Alternatively, ensure all state changes in withdraw() complete before any external call.

**References:**
- https://medium.com/coinmonks/cross-function-reentrancy-de9cbce0129e

---

#### VK-005: Cross-function reentrancy: ArbitrumVault.withdraw() -> getTotalValueUSD()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | medium |
| **Category** | Reentrancy |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:164` |

**Description:**

Function withdraw() makes external calls and modifies state variables [totalAssets] that are also read by getTotalValueUSD(). During the external call in withdraw(), an attacker can reenter through getTotalValueUSD() and read stale values of these variables.

**Code:**

```solidity
163 | 
164 |     function withdraw(uint256 shareAmount) external whenNotPaused {
165 |         require(shares[msg.sender] >= shareAmount, "Insufficient shares");
166 |         require(
167 |             block.timestamp >= lastDepositTime[msg.sender] + withdrawalDelay,
168 |             "Withdrawal delay"
169 |         );
170 | 
171 |         // Calculate assets
172 |         uint256 assetAmount = (shareAmount * totalAssets) / totalShares;
173 | 
174 |         // Apply withdrawal fee
175 |         uint256 fee = (assetAmount * withdrawalFee) / 10000;
176 |         uint256 netAmount = assetAmount - fee;
177 | 
178 |         // Update state
179 |         shares[msg.sender] -= shareAmount;
180 |         totalShares -= shareAmount;
181 |         totalAssets -= assetAmount;
182 | 
183 |         // Transfer fee
184 |         if (fee > 0) {
185 |             asset.transfer(feeRecipient, fee);
186 |         }
187 | 
188 |         // Transfer assets to user
189 |         asset.transfer(msg.sender, netAmount);
190 | 
191 |         emit Withdraw(msg.sender, netAmount, shareAmount);
192 |     }
193 | 
```

**Recommendation:**

Apply a shared nonReentrant modifier to both withdraw() and getTotalValueUSD(). Alternatively, ensure all state changes in withdraw() complete before any external call.

**References:**
- https://medium.com/coinmonks/cross-function-reentrancy-de9cbce0129e

---

#### VK-006: Cross-function reentrancy: ArbitrumVault.withdraw() -> sharePrice()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | medium |
| **Category** | Reentrancy |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:164` |

**Description:**

Function withdraw() makes external calls and modifies state variables [totalShares, totalAssets] that are also read by sharePrice(). During the external call in withdraw(), an attacker can reenter through sharePrice() and read stale values of these variables.

**Code:**

```solidity
163 | 
164 |     function withdraw(uint256 shareAmount) external whenNotPaused {
165 |         require(shares[msg.sender] >= shareAmount, "Insufficient shares");
166 |         require(
167 |             block.timestamp >= lastDepositTime[msg.sender] + withdrawalDelay,
168 |             "Withdrawal delay"
169 |         );
170 | 
171 |         // Calculate assets
172 |         uint256 assetAmount = (shareAmount * totalAssets) / totalShares;
173 | 
174 |         // Apply withdrawal fee
175 |         uint256 fee = (assetAmount * withdrawalFee) / 10000;
176 |         uint256 netAmount = assetAmount - fee;
177 | 
178 |         // Update state
179 |         shares[msg.sender] -= shareAmount;
180 |         totalShares -= shareAmount;
181 |         totalAssets -= assetAmount;
182 | 
183 |         // Transfer fee
184 |         if (fee > 0) {
185 |             asset.transfer(feeRecipient, fee);
186 |         }
187 | 
188 |         // Transfer assets to user
189 |         asset.transfer(msg.sender, netAmount);
190 | 
191 |         emit Withdraw(msg.sender, netAmount, shareAmount);
192 |     }
193 | 
```

**Recommendation:**

Apply a shared nonReentrant modifier to both withdraw() and sharePrice(). Alternatively, ensure all state changes in withdraw() complete before any external call.

**References:**
- https://medium.com/coinmonks/cross-function-reentrancy-de9cbce0129e

---

#### VK-007: Cross-function reentrancy: ArbitrumVault.withdraw() -> balanceOf()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | medium |
| **Category** | Reentrancy |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:164` |

**Description:**

Function withdraw() makes external calls and modifies state variables [shares] that are also read by balanceOf(). During the external call in withdraw(), an attacker can reenter through balanceOf() and read stale values of these variables.

**Code:**

```solidity
163 | 
164 |     function withdraw(uint256 shareAmount) external whenNotPaused {
165 |         require(shares[msg.sender] >= shareAmount, "Insufficient shares");
166 |         require(
167 |             block.timestamp >= lastDepositTime[msg.sender] + withdrawalDelay,
168 |             "Withdrawal delay"
169 |         );
170 | 
171 |         // Calculate assets
172 |         uint256 assetAmount = (shareAmount * totalAssets) / totalShares;
173 | 
174 |         // Apply withdrawal fee
175 |         uint256 fee = (assetAmount * withdrawalFee) / 10000;
176 |         uint256 netAmount = assetAmount - fee;
177 | 
178 |         // Update state
179 |         shares[msg.sender] -= shareAmount;
180 |         totalShares -= shareAmount;
181 |         totalAssets -= assetAmount;
182 | 
183 |         // Transfer fee
184 |         if (fee > 0) {
185 |             asset.transfer(feeRecipient, fee);
186 |         }
187 | 
188 |         // Transfer assets to user
189 |         asset.transfer(msg.sender, netAmount);
190 | 
191 |         emit Withdraw(msg.sender, netAmount, shareAmount);
192 |     }
193 | 
```

**Recommendation:**

Apply a shared nonReentrant modifier to both withdraw() and balanceOf(). Alternatively, ensure all state changes in withdraw() complete before any external call.

**References:**
- https://medium.com/coinmonks/cross-function-reentrancy-de9cbce0129e

---

#### VK-008: Cross-function reentrancy: ArbitrumVault.withdraw() -> previewDeposit()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | medium |
| **Category** | Reentrancy |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:164` |

**Description:**

Function withdraw() makes external calls and modifies state variables [totalShares, totalAssets] that are also read by previewDeposit(). During the external call in withdraw(), an attacker can reenter through previewDeposit() and read stale values of these variables.

**Code:**

```solidity
163 | 
164 |     function withdraw(uint256 shareAmount) external whenNotPaused {
165 |         require(shares[msg.sender] >= shareAmount, "Insufficient shares");
166 |         require(
167 |             block.timestamp >= lastDepositTime[msg.sender] + withdrawalDelay,
168 |             "Withdrawal delay"
169 |         );
170 | 
171 |         // Calculate assets
172 |         uint256 assetAmount = (shareAmount * totalAssets) / totalShares;
173 | 
174 |         // Apply withdrawal fee
175 |         uint256 fee = (assetAmount * withdrawalFee) / 10000;
176 |         uint256 netAmount = assetAmount - fee;
177 | 
178 |         // Update state
179 |         shares[msg.sender] -= shareAmount;
180 |         totalShares -= shareAmount;
181 |         totalAssets -= assetAmount;
182 | 
183 |         // Transfer fee
184 |         if (fee > 0) {
185 |             asset.transfer(feeRecipient, fee);
186 |         }
187 | 
188 |         // Transfer assets to user
189 |         asset.transfer(msg.sender, netAmount);
190 | 
191 |         emit Withdraw(msg.sender, netAmount, shareAmount);
192 |     }
193 | 
```

**Recommendation:**

Apply a shared nonReentrant modifier to both withdraw() and previewDeposit(). Alternatively, ensure all state changes in withdraw() complete before any external call.

**References:**
- https://medium.com/coinmonks/cross-function-reentrancy-de9cbce0129e

---

#### VK-009: Cross-function reentrancy: ArbitrumVault.withdraw() -> previewWithdraw()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | medium |
| **Category** | Reentrancy |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:164` |

**Description:**

Function withdraw() makes external calls and modifies state variables [totalShares, totalAssets] that are also read by previewWithdraw(). During the external call in withdraw(), an attacker can reenter through previewWithdraw() and read stale values of these variables.

**Code:**

```solidity
163 | 
164 |     function withdraw(uint256 shareAmount) external whenNotPaused {
165 |         require(shares[msg.sender] >= shareAmount, "Insufficient shares");
166 |         require(
167 |             block.timestamp >= lastDepositTime[msg.sender] + withdrawalDelay,
168 |             "Withdrawal delay"
169 |         );
170 | 
171 |         // Calculate assets
172 |         uint256 assetAmount = (shareAmount * totalAssets) / totalShares;
173 | 
174 |         // Apply withdrawal fee
175 |         uint256 fee = (assetAmount * withdrawalFee) / 10000;
176 |         uint256 netAmount = assetAmount - fee;
177 | 
178 |         // Update state
179 |         shares[msg.sender] -= shareAmount;
180 |         totalShares -= shareAmount;
181 |         totalAssets -= assetAmount;
182 | 
183 |         // Transfer fee
184 |         if (fee > 0) {
185 |             asset.transfer(feeRecipient, fee);
186 |         }
187 | 
188 |         // Transfer assets to user
189 |         asset.transfer(msg.sender, netAmount);
190 | 
191 |         emit Withdraw(msg.sender, netAmount, shareAmount);
192 |     }
193 | 
```

**Recommendation:**

Apply a shared nonReentrant modifier to both withdraw() and previewWithdraw(). Alternatively, ensure all state changes in withdraw() complete before any external call.

**References:**
- https://medium.com/coinmonks/cross-function-reentrancy-de9cbce0129e

---

#### VK-010: Cross-function reentrancy: ArbitrumVault.withdraw() -> maxDeposit()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | medium |
| **Category** | Reentrancy |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:164` |

**Description:**

Function withdraw() makes external calls and modifies state variables [totalAssets] that are also read by maxDeposit(). During the external call in withdraw(), an attacker can reenter through maxDeposit() and read stale values of these variables.

**Code:**

```solidity
163 | 
164 |     function withdraw(uint256 shareAmount) external whenNotPaused {
165 |         require(shares[msg.sender] >= shareAmount, "Insufficient shares");
166 |         require(
167 |             block.timestamp >= lastDepositTime[msg.sender] + withdrawalDelay,
168 |             "Withdrawal delay"
169 |         );
170 | 
171 |         // Calculate assets
172 |         uint256 assetAmount = (shareAmount * totalAssets) / totalShares;
173 | 
174 |         // Apply withdrawal fee
175 |         uint256 fee = (assetAmount * withdrawalFee) / 10000;
176 |         uint256 netAmount = assetAmount - fee;
177 | 
178 |         // Update state
179 |         shares[msg.sender] -= shareAmount;
180 |         totalShares -= shareAmount;
181 |         totalAssets -= assetAmount;
182 | 
183 |         // Transfer fee
184 |         if (fee > 0) {
185 |             asset.transfer(feeRecipient, fee);
186 |         }
187 | 
188 |         // Transfer assets to user
189 |         asset.transfer(msg.sender, netAmount);
190 | 
191 |         emit Withdraw(msg.sender, netAmount, shareAmount);
192 |     }
193 | 
```

**Recommendation:**

Apply a shared nonReentrant modifier to both withdraw() and maxDeposit(). Alternatively, ensure all state changes in withdraw() complete before any external call.

**References:**
- https://medium.com/coinmonks/cross-function-reentrancy-de9cbce0129e

---

#### VK-012: Cross-function reentrancy: ArbitrumVault.harvest() -> deposit()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | medium |
| **Category** | Reentrancy |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:232` |

**Description:**

Function harvest() makes external calls and modifies state variables [totalAssets] that are also read by deposit(). During the external call in harvest(), an attacker can reenter through deposit() and read stale values of these variables.

**Code:**

```solidity
231 | 
232 |     function harvest() external onlyGuardian whenNotPaused {
233 |         require(address(strategy) != address(0), "No strategy");
234 | 
235 |         uint256 profit = strategy.harvest();
236 | 
237 |         if (profit > 0) {
238 |             uint256 fee = (profit * performanceFee) / 10000;
239 |             if (fee > 0) {
240 |                 asset.transfer(feeRecipient, fee);
241 |             }
242 |             totalAssets += profit - fee;
243 |             emit Harvested(profit, fee);
244 |         }
245 |     }
246 | 
```

**Recommendation:**

Apply a shared nonReentrant modifier to both harvest() and deposit(). Alternatively, ensure all state changes in harvest() complete before any external call.

**References:**
- https://medium.com/coinmonks/cross-function-reentrancy-de9cbce0129e

---

#### VK-013: Cross-function reentrancy: ArbitrumVault.harvest() -> withdraw()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | medium |
| **Category** | Reentrancy |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:232` |

**Description:**

Function harvest() makes external calls and modifies state variables [totalAssets] that are also read by withdraw(). During the external call in harvest(), an attacker can reenter through withdraw() and read stale values of these variables.

**Code:**

```solidity
231 | 
232 |     function harvest() external onlyGuardian whenNotPaused {
233 |         require(address(strategy) != address(0), "No strategy");
234 | 
235 |         uint256 profit = strategy.harvest();
236 | 
237 |         if (profit > 0) {
238 |             uint256 fee = (profit * performanceFee) / 10000;
239 |             if (fee > 0) {
240 |                 asset.transfer(feeRecipient, fee);
241 |             }
242 |             totalAssets += profit - fee;
243 |             emit Harvested(profit, fee);
244 |         }
245 |     }
246 | 
```

**Recommendation:**

Apply a shared nonReentrant modifier to both harvest() and withdraw(). Alternatively, ensure all state changes in harvest() complete before any external call.

**References:**
- https://medium.com/coinmonks/cross-function-reentrancy-de9cbce0129e

---

#### VK-014: Cross-function reentrancy: ArbitrumVault.harvest() -> collectManagementFees()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | medium |
| **Category** | Reentrancy |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:232` |

**Description:**

Function harvest() makes external calls and modifies state variables [totalAssets] that are also read by collectManagementFees(). During the external call in harvest(), an attacker can reenter through collectManagementFees() and read stale values of these variables.

**Code:**

```solidity
231 | 
232 |     function harvest() external onlyGuardian whenNotPaused {
233 |         require(address(strategy) != address(0), "No strategy");
234 | 
235 |         uint256 profit = strategy.harvest();
236 | 
237 |         if (profit > 0) {
238 |             uint256 fee = (profit * performanceFee) / 10000;
239 |             if (fee > 0) {
240 |                 asset.transfer(feeRecipient, fee);
241 |             }
242 |             totalAssets += profit - fee;
243 |             emit Harvested(profit, fee);
244 |         }
245 |     }
246 | 
```

**Recommendation:**

Apply a shared nonReentrant modifier to both harvest() and collectManagementFees(). Alternatively, ensure all state changes in harvest() complete before any external call.

**References:**
- https://medium.com/coinmonks/cross-function-reentrancy-de9cbce0129e

---

#### VK-015: Cross-function reentrancy: ArbitrumVault.harvest() -> getTotalValueUSD()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | medium |
| **Category** | Reentrancy |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:232` |

**Description:**

Function harvest() makes external calls and modifies state variables [totalAssets] that are also read by getTotalValueUSD(). During the external call in harvest(), an attacker can reenter through getTotalValueUSD() and read stale values of these variables.

**Code:**

```solidity
231 | 
232 |     function harvest() external onlyGuardian whenNotPaused {
233 |         require(address(strategy) != address(0), "No strategy");
234 | 
235 |         uint256 profit = strategy.harvest();
236 | 
237 |         if (profit > 0) {
238 |             uint256 fee = (profit * performanceFee) / 10000;
239 |             if (fee > 0) {
240 |                 asset.transfer(feeRecipient, fee);
241 |             }
242 |             totalAssets += profit - fee;
243 |             emit Harvested(profit, fee);
244 |         }
245 |     }
246 | 
```

**Recommendation:**

Apply a shared nonReentrant modifier to both harvest() and getTotalValueUSD(). Alternatively, ensure all state changes in harvest() complete before any external call.

**References:**
- https://medium.com/coinmonks/cross-function-reentrancy-de9cbce0129e

---

#### VK-016: Cross-function reentrancy: ArbitrumVault.harvest() -> sharePrice()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | medium |
| **Category** | Reentrancy |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:232` |

**Description:**

Function harvest() makes external calls and modifies state variables [totalAssets] that are also read by sharePrice(). During the external call in harvest(), an attacker can reenter through sharePrice() and read stale values of these variables.

**Code:**

```solidity
231 | 
232 |     function harvest() external onlyGuardian whenNotPaused {
233 |         require(address(strategy) != address(0), "No strategy");
234 | 
235 |         uint256 profit = strategy.harvest();
236 | 
237 |         if (profit > 0) {
238 |             uint256 fee = (profit * performanceFee) / 10000;
239 |             if (fee > 0) {
240 |                 asset.transfer(feeRecipient, fee);
241 |             }
242 |             totalAssets += profit - fee;
243 |             emit Harvested(profit, fee);
244 |         }
245 |     }
246 | 
```

**Recommendation:**

Apply a shared nonReentrant modifier to both harvest() and sharePrice(). Alternatively, ensure all state changes in harvest() complete before any external call.

**References:**
- https://medium.com/coinmonks/cross-function-reentrancy-de9cbce0129e

---

#### VK-017: Cross-function reentrancy: ArbitrumVault.harvest() -> previewDeposit()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | medium |
| **Category** | Reentrancy |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:232` |

**Description:**

Function harvest() makes external calls and modifies state variables [totalAssets] that are also read by previewDeposit(). During the external call in harvest(), an attacker can reenter through previewDeposit() and read stale values of these variables.

**Code:**

```solidity
231 | 
232 |     function harvest() external onlyGuardian whenNotPaused {
233 |         require(address(strategy) != address(0), "No strategy");
234 | 
235 |         uint256 profit = strategy.harvest();
236 | 
237 |         if (profit > 0) {
238 |             uint256 fee = (profit * performanceFee) / 10000;
239 |             if (fee > 0) {
240 |                 asset.transfer(feeRecipient, fee);
241 |             }
242 |             totalAssets += profit - fee;
243 |             emit Harvested(profit, fee);
244 |         }
245 |     }
246 | 
```

**Recommendation:**

Apply a shared nonReentrant modifier to both harvest() and previewDeposit(). Alternatively, ensure all state changes in harvest() complete before any external call.

**References:**
- https://medium.com/coinmonks/cross-function-reentrancy-de9cbce0129e

---

#### VK-018: Cross-function reentrancy: ArbitrumVault.harvest() -> previewWithdraw()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | medium |
| **Category** | Reentrancy |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:232` |

**Description:**

Function harvest() makes external calls and modifies state variables [totalAssets] that are also read by previewWithdraw(). During the external call in harvest(), an attacker can reenter through previewWithdraw() and read stale values of these variables.

**Code:**

```solidity
231 | 
232 |     function harvest() external onlyGuardian whenNotPaused {
233 |         require(address(strategy) != address(0), "No strategy");
234 | 
235 |         uint256 profit = strategy.harvest();
236 | 
237 |         if (profit > 0) {
238 |             uint256 fee = (profit * performanceFee) / 10000;
239 |             if (fee > 0) {
240 |                 asset.transfer(feeRecipient, fee);
241 |             }
242 |             totalAssets += profit - fee;
243 |             emit Harvested(profit, fee);
244 |         }
245 |     }
246 | 
```

**Recommendation:**

Apply a shared nonReentrant modifier to both harvest() and previewWithdraw(). Alternatively, ensure all state changes in harvest() complete before any external call.

**References:**
- https://medium.com/coinmonks/cross-function-reentrancy-de9cbce0129e

---

#### VK-019: Cross-function reentrancy: ArbitrumVault.harvest() -> maxDeposit()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | medium |
| **Category** | Reentrancy |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:232` |

**Description:**

Function harvest() makes external calls and modifies state variables [totalAssets] that are also read by maxDeposit(). During the external call in harvest(), an attacker can reenter through maxDeposit() and read stale values of these variables.

**Code:**

```solidity
231 | 
232 |     function harvest() external onlyGuardian whenNotPaused {
233 |         require(address(strategy) != address(0), "No strategy");
234 | 
235 |         uint256 profit = strategy.harvest();
236 | 
237 |         if (profit > 0) {
238 |             uint256 fee = (profit * performanceFee) / 10000;
239 |             if (fee > 0) {
240 |                 asset.transfer(feeRecipient, fee);
241 |             }
242 |             totalAssets += profit - fee;
243 |             emit Harvested(profit, fee);
244 |         }
245 |     }
246 | 
```

**Recommendation:**

Apply a shared nonReentrant modifier to both harvest() and maxDeposit(). Alternatively, ensure all state changes in harvest() complete before any external call.

**References:**
- https://medium.com/coinmonks/cross-function-reentrancy-de9cbce0129e

---

#### VK-022: Cross-function reentrancy: ArbitrumVault.collectManagementFees() -> ()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | medium |
| **Category** | Reentrancy |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:247` |

**Description:**

Function collectManagementFees() makes external calls and modifies state variables [lastFeeCollection] that are also read by (). During the external call in collectManagementFees(), an attacker can reenter through () and read stale values of these variables.

**Code:**

```solidity
246 | 
247 |     function collectManagementFees() external onlyOwner {
248 |         uint256 elapsed = block.timestamp - lastFeeCollection;
249 |         uint256 fee = (totalAssets * managementFee * elapsed) / (10000 * 365 days);
250 | 
251 |         if (fee > 0 && fee < totalAssets) {
252 |             totalAssets -= fee;
253 |             asset.transfer(feeRecipient, fee);
254 |             lastFeeCollection = block.timestamp;
255 |             emit FeesCollected(fee);
256 |         }
257 |     }
258 | 
```

**Recommendation:**

Apply a shared nonReentrant modifier to both collectManagementFees() and (). Alternatively, ensure all state changes in collectManagementFees() complete before any external call.

**References:**
- https://medium.com/coinmonks/cross-function-reentrancy-de9cbce0129e

---

#### VK-023: Cross-function reentrancy: ArbitrumVault.collectManagementFees() -> deposit()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | medium |
| **Category** | Reentrancy |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:247` |

**Description:**

Function collectManagementFees() makes external calls and modifies state variables [totalAssets] that are also read by deposit(). During the external call in collectManagementFees(), an attacker can reenter through deposit() and read stale values of these variables.

**Code:**

```solidity
246 | 
247 |     function collectManagementFees() external onlyOwner {
248 |         uint256 elapsed = block.timestamp - lastFeeCollection;
249 |         uint256 fee = (totalAssets * managementFee * elapsed) / (10000 * 365 days);
250 | 
251 |         if (fee > 0 && fee < totalAssets) {
252 |             totalAssets -= fee;
253 |             asset.transfer(feeRecipient, fee);
254 |             lastFeeCollection = block.timestamp;
255 |             emit FeesCollected(fee);
256 |         }
257 |     }
258 | 
```

**Recommendation:**

Apply a shared nonReentrant modifier to both collectManagementFees() and deposit(). Alternatively, ensure all state changes in collectManagementFees() complete before any external call.

**References:**
- https://medium.com/coinmonks/cross-function-reentrancy-de9cbce0129e

---

#### VK-024: Cross-function reentrancy: ArbitrumVault.collectManagementFees() -> withdraw()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | medium |
| **Category** | Reentrancy |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:247` |

**Description:**

Function collectManagementFees() makes external calls and modifies state variables [totalAssets] that are also read by withdraw(). During the external call in collectManagementFees(), an attacker can reenter through withdraw() and read stale values of these variables.

**Code:**

```solidity
246 | 
247 |     function collectManagementFees() external onlyOwner {
248 |         uint256 elapsed = block.timestamp - lastFeeCollection;
249 |         uint256 fee = (totalAssets * managementFee * elapsed) / (10000 * 365 days);
250 | 
251 |         if (fee > 0 && fee < totalAssets) {
252 |             totalAssets -= fee;
253 |             asset.transfer(feeRecipient, fee);
254 |             lastFeeCollection = block.timestamp;
255 |             emit FeesCollected(fee);
256 |         }
257 |     }
258 | 
```

**Recommendation:**

Apply a shared nonReentrant modifier to both collectManagementFees() and withdraw(). Alternatively, ensure all state changes in collectManagementFees() complete before any external call.

**References:**
- https://medium.com/coinmonks/cross-function-reentrancy-de9cbce0129e

---

#### VK-025: Cross-function reentrancy: ArbitrumVault.collectManagementFees() -> harvest()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | medium |
| **Category** | Reentrancy |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:247` |

**Description:**

Function collectManagementFees() makes external calls and modifies state variables [totalAssets] that are also read by harvest(). During the external call in collectManagementFees(), an attacker can reenter through harvest() and read stale values of these variables.

**Code:**

```solidity
246 | 
247 |     function collectManagementFees() external onlyOwner {
248 |         uint256 elapsed = block.timestamp - lastFeeCollection;
249 |         uint256 fee = (totalAssets * managementFee * elapsed) / (10000 * 365 days);
250 | 
251 |         if (fee > 0 && fee < totalAssets) {
252 |             totalAssets -= fee;
253 |             asset.transfer(feeRecipient, fee);
254 |             lastFeeCollection = block.timestamp;
255 |             emit FeesCollected(fee);
256 |         }
257 |     }
258 | 
```

**Recommendation:**

Apply a shared nonReentrant modifier to both collectManagementFees() and harvest(). Alternatively, ensure all state changes in collectManagementFees() complete before any external call.

**References:**
- https://medium.com/coinmonks/cross-function-reentrancy-de9cbce0129e

---

#### VK-026: Cross-function reentrancy: ArbitrumVault.collectManagementFees() -> getTotalValueUSD()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | medium |
| **Category** | Reentrancy |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:247` |

**Description:**

Function collectManagementFees() makes external calls and modifies state variables [totalAssets] that are also read by getTotalValueUSD(). During the external call in collectManagementFees(), an attacker can reenter through getTotalValueUSD() and read stale values of these variables.

**Code:**

```solidity
246 | 
247 |     function collectManagementFees() external onlyOwner {
248 |         uint256 elapsed = block.timestamp - lastFeeCollection;
249 |         uint256 fee = (totalAssets * managementFee * elapsed) / (10000 * 365 days);
250 | 
251 |         if (fee > 0 && fee < totalAssets) {
252 |             totalAssets -= fee;
253 |             asset.transfer(feeRecipient, fee);
254 |             lastFeeCollection = block.timestamp;
255 |             emit FeesCollected(fee);
256 |         }
257 |     }
258 | 
```

**Recommendation:**

Apply a shared nonReentrant modifier to both collectManagementFees() and getTotalValueUSD(). Alternatively, ensure all state changes in collectManagementFees() complete before any external call.

**References:**
- https://medium.com/coinmonks/cross-function-reentrancy-de9cbce0129e

---

#### VK-027: Cross-function reentrancy: ArbitrumVault.collectManagementFees() -> sharePrice()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | medium |
| **Category** | Reentrancy |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:247` |

**Description:**

Function collectManagementFees() makes external calls and modifies state variables [totalAssets] that are also read by sharePrice(). During the external call in collectManagementFees(), an attacker can reenter through sharePrice() and read stale values of these variables.

**Code:**

```solidity
246 | 
247 |     function collectManagementFees() external onlyOwner {
248 |         uint256 elapsed = block.timestamp - lastFeeCollection;
249 |         uint256 fee = (totalAssets * managementFee * elapsed) / (10000 * 365 days);
250 | 
251 |         if (fee > 0 && fee < totalAssets) {
252 |             totalAssets -= fee;
253 |             asset.transfer(feeRecipient, fee);
254 |             lastFeeCollection = block.timestamp;
255 |             emit FeesCollected(fee);
256 |         }
257 |     }
258 | 
```

**Recommendation:**

Apply a shared nonReentrant modifier to both collectManagementFees() and sharePrice(). Alternatively, ensure all state changes in collectManagementFees() complete before any external call.

**References:**
- https://medium.com/coinmonks/cross-function-reentrancy-de9cbce0129e

---

#### VK-028: Cross-function reentrancy: ArbitrumVault.collectManagementFees() -> previewDeposit()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | medium |
| **Category** | Reentrancy |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:247` |

**Description:**

Function collectManagementFees() makes external calls and modifies state variables [totalAssets] that are also read by previewDeposit(). During the external call in collectManagementFees(), an attacker can reenter through previewDeposit() and read stale values of these variables.

**Code:**

```solidity
246 | 
247 |     function collectManagementFees() external onlyOwner {
248 |         uint256 elapsed = block.timestamp - lastFeeCollection;
249 |         uint256 fee = (totalAssets * managementFee * elapsed) / (10000 * 365 days);
250 | 
251 |         if (fee > 0 && fee < totalAssets) {
252 |             totalAssets -= fee;
253 |             asset.transfer(feeRecipient, fee);
254 |             lastFeeCollection = block.timestamp;
255 |             emit FeesCollected(fee);
256 |         }
257 |     }
258 | 
```

**Recommendation:**

Apply a shared nonReentrant modifier to both collectManagementFees() and previewDeposit(). Alternatively, ensure all state changes in collectManagementFees() complete before any external call.

**References:**
- https://medium.com/coinmonks/cross-function-reentrancy-de9cbce0129e

---

#### VK-029: Cross-function reentrancy: ArbitrumVault.collectManagementFees() -> previewWithdraw()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | medium |
| **Category** | Reentrancy |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:247` |

**Description:**

Function collectManagementFees() makes external calls and modifies state variables [totalAssets] that are also read by previewWithdraw(). During the external call in collectManagementFees(), an attacker can reenter through previewWithdraw() and read stale values of these variables.

**Code:**

```solidity
246 | 
247 |     function collectManagementFees() external onlyOwner {
248 |         uint256 elapsed = block.timestamp - lastFeeCollection;
249 |         uint256 fee = (totalAssets * managementFee * elapsed) / (10000 * 365 days);
250 | 
251 |         if (fee > 0 && fee < totalAssets) {
252 |             totalAssets -= fee;
253 |             asset.transfer(feeRecipient, fee);
254 |             lastFeeCollection = block.timestamp;
255 |             emit FeesCollected(fee);
256 |         }
257 |     }
258 | 
```

**Recommendation:**

Apply a shared nonReentrant modifier to both collectManagementFees() and previewWithdraw(). Alternatively, ensure all state changes in collectManagementFees() complete before any external call.

**References:**
- https://medium.com/coinmonks/cross-function-reentrancy-de9cbce0129e

---

#### VK-030: Cross-function reentrancy: ArbitrumVault.collectManagementFees() -> maxDeposit()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | medium |
| **Category** | Reentrancy |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:247` |

**Description:**

Function collectManagementFees() makes external calls and modifies state variables [totalAssets] that are also read by maxDeposit(). During the external call in collectManagementFees(), an attacker can reenter through maxDeposit() and read stale values of these variables.

**Code:**

```solidity
246 | 
247 |     function collectManagementFees() external onlyOwner {
248 |         uint256 elapsed = block.timestamp - lastFeeCollection;
249 |         uint256 fee = (totalAssets * managementFee * elapsed) / (10000 * 365 days);
250 | 
251 |         if (fee > 0 && fee < totalAssets) {
252 |             totalAssets -= fee;
253 |             asset.transfer(feeRecipient, fee);
254 |             lastFeeCollection = block.timestamp;
255 |             emit FeesCollected(fee);
256 |         }
257 |     }
258 | 
```

**Recommendation:**

Apply a shared nonReentrant modifier to both collectManagementFees() and maxDeposit(). Alternatively, ensure all state changes in collectManagementFees() complete before any external call.

**References:**
- https://medium.com/coinmonks/cross-function-reentrancy-de9cbce0129e

---

#### VK-033: Cross-function reentrancy: ArbitrumVault.emergencyWithdraw() -> pause()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | medium |
| **Category** | Reentrancy |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:346` |

**Description:**

Function emergencyWithdraw() makes external calls and modifies state variables [paused] that are also read by pause(). During the external call in emergencyWithdraw(), an attacker can reenter through pause() and read stale values of these variables.

**Code:**

```solidity
345 | 
346 |     function emergencyWithdraw() external onlyOwner {
347 |         // Pull everything from strategy
348 |         if (address(strategy) != address(0)) {
349 |             uint256 balance = strategy.balanceOf();
350 |             if (balance > 0) {
351 |                 strategy.withdraw(balance);
352 |             }
353 |         }
354 | 
355 |         // Send all assets to owner
356 |         uint256 total = asset.balanceOf(address(this));
357 |         asset.transfer(owner, total);
358 | 
359 |         emergencyMode = true;
360 |         paused = true;
361 |     }
362 | 
```

**Recommendation:**

Apply a shared nonReentrant modifier to both emergencyWithdraw() and pause(). Alternatively, ensure all state changes in emergencyWithdraw() complete before any external call.

**References:**
- https://medium.com/coinmonks/cross-function-reentrancy-de9cbce0129e

---

#### VK-034: Cross-function reentrancy: ArbitrumVault.emergencyWithdraw() -> unpause()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | medium |
| **Category** | Reentrancy |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:346` |

**Description:**

Function emergencyWithdraw() makes external calls and modifies state variables [paused] that are also read by unpause(). During the external call in emergencyWithdraw(), an attacker can reenter through unpause() and read stale values of these variables.

**Code:**

```solidity
345 | 
346 |     function emergencyWithdraw() external onlyOwner {
347 |         // Pull everything from strategy
348 |         if (address(strategy) != address(0)) {
349 |             uint256 balance = strategy.balanceOf();
350 |             if (balance > 0) {
351 |                 strategy.withdraw(balance);
352 |             }
353 |         }
354 | 
355 |         // Send all assets to owner
356 |         uint256 total = asset.balanceOf(address(this));
357 |         asset.transfer(owner, total);
358 | 
359 |         emergencyMode = true;
360 |         paused = true;
361 |     }
362 | 
```

**Recommendation:**

Apply a shared nonReentrant modifier to both emergencyWithdraw() and unpause(). Alternatively, ensure all state changes in emergencyWithdraw() complete before any external call.

**References:**
- https://medium.com/coinmonks/cross-function-reentrancy-de9cbce0129e

---

#### VK-035: Cross-function reentrancy: ArbitrumVault.emergencyWithdraw() -> setEmergencyMode()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | medium |
| **Category** | Reentrancy |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:346` |

**Description:**

Function emergencyWithdraw() makes external calls and modifies state variables [emergencyMode] that are also read by setEmergencyMode(). During the external call in emergencyWithdraw(), an attacker can reenter through setEmergencyMode() and read stale values of these variables.

**Code:**

```solidity
345 | 
346 |     function emergencyWithdraw() external onlyOwner {
347 |         // Pull everything from strategy
348 |         if (address(strategy) != address(0)) {
349 |             uint256 balance = strategy.balanceOf();
350 |             if (balance > 0) {
351 |                 strategy.withdraw(balance);
352 |             }
353 |         }
354 | 
355 |         // Send all assets to owner
356 |         uint256 total = asset.balanceOf(address(this));
357 |         asset.transfer(owner, total);
358 | 
359 |         emergencyMode = true;
360 |         paused = true;
361 |     }
362 | 
```

**Recommendation:**

Apply a shared nonReentrant modifier to both emergencyWithdraw() and setEmergencyMode(). Alternatively, ensure all state changes in emergencyWithdraw() complete before any external call.

**References:**
- https://medium.com/coinmonks/cross-function-reentrancy-de9cbce0129e

---

#### VK-036: Cross-function reentrancy: ArbitrumVault.emergencyWithdraw() -> maxDeposit()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | medium |
| **Category** | Reentrancy |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:346` |

**Description:**

Function emergencyWithdraw() makes external calls and modifies state variables [emergencyMode, paused] that are also read by maxDeposit(). During the external call in emergencyWithdraw(), an attacker can reenter through maxDeposit() and read stale values of these variables.

**Code:**

```solidity
345 | 
346 |     function emergencyWithdraw() external onlyOwner {
347 |         // Pull everything from strategy
348 |         if (address(strategy) != address(0)) {
349 |             uint256 balance = strategy.balanceOf();
350 |             if (balance > 0) {
351 |                 strategy.withdraw(balance);
352 |             }
353 |         }
354 | 
355 |         // Send all assets to owner
356 |         uint256 total = asset.balanceOf(address(this));
357 |         asset.transfer(owner, total);
358 | 
359 |         emergencyMode = true;
360 |         paused = true;
361 |     }
362 | 
```

**Recommendation:**

Apply a shared nonReentrant modifier to both emergencyWithdraw() and maxDeposit(). Alternatively, ensure all state changes in emergencyWithdraw() complete before any external call.

**References:**
- https://medium.com/coinmonks/cross-function-reentrancy-de9cbce0129e

---

#### VK-037: Unprotected value transfer in ArbitrumVault.harvest()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | medium |
| **Category** | Access Control |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:232` |

**Description:**

Function harvest() transfers ETH/tokens but has no access control. Any external caller can trigger this transfer.

**Code:**

```solidity
231 | 
232 |     function harvest() external onlyGuardian whenNotPaused {
233 |         require(address(strategy) != address(0), "No strategy");
234 | 
235 |         uint256 profit = strategy.harvest();
236 | 
237 |         if (profit > 0) {
238 |             uint256 fee = (profit * performanceFee) / 10000;
239 |             if (fee > 0) {
240 |                 asset.transfer(feeRecipient, fee);
241 |             }
242 |             totalAssets += profit - fee;
243 |             emit Harvested(profit, fee);
244 |         }
245 |     }
246 | 
```

**Recommendation:**

Add access control to functions that transfer value. Consider using OpenZeppelin Ownable or AccessControl.

---

#### VK-039: Unchecked ERC-20 transferFrom() in ArbitrumVault.deposit()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | medium |
| **Category** | Unchecked External Calls |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:153` |

**Description:**

The return value of ERC-20 transferFrom() is not checked. Some tokens (e.g., USDT) do not revert on failure but return false. Ignoring the return value can lead to silent failures and fund loss.

**Code:**

```solidity
152 |         // Transfer assets
153 |         asset.transferFrom(msg.sender, address(this), amount);
154 | 
```

**Recommendation:**

Use OpenZeppelin SafeERC20 library: safeTransfer(), safeTransferFrom(), or safeApprove() which handle non-standard return values correctly.

**References:**
- https://docs.openzeppelin.com/contracts/4.x/api/token/erc20#SafeERC20

---

#### VK-040: Unchecked ERC-20 transfer() in ArbitrumVault.withdraw()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | medium |
| **Category** | Unchecked External Calls |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:185` |

**Description:**

The return value of ERC-20 transfer() is not checked. Some tokens (e.g., USDT) do not revert on failure but return false. Ignoring the return value can lead to silent failures and fund loss.

**Code:**

```solidity
184 |         if (fee > 0) {
185 |             asset.transfer(feeRecipient, fee);
186 |         }
```

**Recommendation:**

Use OpenZeppelin SafeERC20 library: safeTransfer(), safeTransferFrom(), or safeApprove() which handle non-standard return values correctly.

**References:**
- https://docs.openzeppelin.com/contracts/4.x/api/token/erc20#SafeERC20

---

#### VK-041: Unchecked ERC-20 transfer() in ArbitrumVault.withdraw()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | medium |
| **Category** | Unchecked External Calls |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:189` |

**Description:**

The return value of ERC-20 transfer() is not checked. Some tokens (e.g., USDT) do not revert on failure but return false. Ignoring the return value can lead to silent failures and fund loss.

**Code:**

```solidity
188 |         // Transfer assets to user
189 |         asset.transfer(msg.sender, netAmount);
190 | 
```

**Recommendation:**

Use OpenZeppelin SafeERC20 library: safeTransfer(), safeTransferFrom(), or safeApprove() which handle non-standard return values correctly.

**References:**
- https://docs.openzeppelin.com/contracts/4.x/api/token/erc20#SafeERC20

---

#### VK-042: Unchecked ERC-20 approve() in ArbitrumVault.setStrategy()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | medium |
| **Category** | Unchecked External Calls |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:212` |

**Description:**

The return value of ERC-20 approve() is not checked. Some tokens (e.g., USDT) do not revert on failure but return false. Ignoring the return value can lead to silent failures and fund loss.

**Code:**

```solidity
211 |         if (available > 0) {
212 |             asset.approve(_strategy, available);
213 |             strategy.deposit(available);
```

**Recommendation:**

Use OpenZeppelin SafeERC20 library: safeTransfer(), safeTransferFrom(), or safeApprove() which handle non-standard return values correctly.

**References:**
- https://docs.openzeppelin.com/contracts/4.x/api/token/erc20#SafeERC20

---

#### VK-043: Unchecked ERC-20 approve() in ArbitrumVault.deployToStrategy()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | medium |
| **Category** | Unchecked External Calls |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:221` |

**Description:**

The return value of ERC-20 approve() is not checked. Some tokens (e.g., USDT) do not revert on failure but return false. Ignoring the return value can lead to silent failures and fund loss.

**Code:**

```solidity
220 |         require(address(strategy) != address(0), "No strategy");
221 |         asset.approve(address(strategy), amount);
222 |         strategy.deposit(amount);
```

**Recommendation:**

Use OpenZeppelin SafeERC20 library: safeTransfer(), safeTransferFrom(), or safeApprove() which handle non-standard return values correctly.

**References:**
- https://docs.openzeppelin.com/contracts/4.x/api/token/erc20#SafeERC20

---

#### VK-044: Unchecked ERC-20 transfer() in ArbitrumVault.harvest()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | medium |
| **Category** | Unchecked External Calls |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:240` |

**Description:**

The return value of ERC-20 transfer() is not checked. Some tokens (e.g., USDT) do not revert on failure but return false. Ignoring the return value can lead to silent failures and fund loss.

**Code:**

```solidity
239 |             if (fee > 0) {
240 |                 asset.transfer(feeRecipient, fee);
241 |             }
```

**Recommendation:**

Use OpenZeppelin SafeERC20 library: safeTransfer(), safeTransferFrom(), or safeApprove() which handle non-standard return values correctly.

**References:**
- https://docs.openzeppelin.com/contracts/4.x/api/token/erc20#SafeERC20

---

#### VK-045: Unchecked ERC-20 transfer() in ArbitrumVault.collectManagementFees()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | medium |
| **Category** | Unchecked External Calls |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:253` |

**Description:**

The return value of ERC-20 transfer() is not checked. Some tokens (e.g., USDT) do not revert on failure but return false. Ignoring the return value can lead to silent failures and fund loss.

**Code:**

```solidity
252 |             totalAssets -= fee;
253 |             asset.transfer(feeRecipient, fee);
254 |             lastFeeCollection = block.timestamp;
```

**Recommendation:**

Use OpenZeppelin SafeERC20 library: safeTransfer(), safeTransferFrom(), or safeApprove() which handle non-standard return values correctly.

**References:**
- https://docs.openzeppelin.com/contracts/4.x/api/token/erc20#SafeERC20

---

#### VK-046: Unchecked ERC-20 transfer() in ArbitrumVault.emergencyWithdraw()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | medium |
| **Category** | Unchecked External Calls |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:357` |

**Description:**

The return value of ERC-20 transfer() is not checked. Some tokens (e.g., USDT) do not revert on failure but return false. Ignoring the return value can lead to silent failures and fund loss.

**Code:**

```solidity
356 |         uint256 total = asset.balanceOf(address(this));
357 |         asset.transfer(owner, total);
358 | 
```

**Recommendation:**

Use OpenZeppelin SafeERC20 library: safeTransfer(), safeTransferFrom(), or safeApprove() which handle non-standard return values correctly.

**References:**
- https://docs.openzeppelin.com/contracts/4.x/api/token/erc20#SafeERC20

---

#### VK-047: Missing oracle staleness check in ArbitrumVault.getAssetPrice()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | high |
| **Category** | Oracle Manipulation |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:262` |

**Description:**

latestRoundData() is called without validating the updatedAt timestamp. If the oracle goes down or returns stale data, the contract will use outdated prices, potentially leading to incorrect liquidations, undercollateralized loans, or arbitrage opportunities.

**Code:**

```solidity
261 |     function getAssetPrice() public view returns (uint256) {
262 |         (, int256 price,,,) = priceFeed.latestRoundData();
263 |         return uint256(price);
```

**Recommendation:**

Check the updatedAt timestamp: `require(block.timestamp - updatedAt < MAX_STALENESS, "Stale price");`

---

#### VK-048: Missing oracle price validation in ArbitrumVault.getAssetPrice()

| | |
|---|---|
| **Severity** | HIGH |
| **Confidence** | high |
| **Category** | Oracle Manipulation |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:262` |

**Description:**

latestRoundData() result is not checked for zero or negative price. A zero price could lead to division by zero or free token acquisition.

**Code:**

```solidity
261 |     function getAssetPrice() public view returns (uint256) {
262 |         (, int256 price,,,) = priceFeed.latestRoundData();
263 |         return uint256(price);
```

**Recommendation:**

Validate the answer: `require(answer > 0, "Invalid price");`

---

### [MEDIUM] MEDIUM (8)

#### VK-001: Missing reentrancy guard on ArbitrumVault.withdraw()

| | |
|---|---|
| **Severity** | MEDIUM |
| **Confidence** | medium |
| **Category** | Reentrancy |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:164` |

**Description:**

Function withdraw() makes external calls and modifies state but has no reentrancy guard. Even if the CEI pattern is followed, a reentrancy guard provides defense-in-depth.

**Code:**

```solidity
163 | 
164 |     function withdraw(uint256 shareAmount) external whenNotPaused {
165 |         require(shares[msg.sender] >= shareAmount, "Insufficient shares");
166 |         require(
167 |             block.timestamp >= lastDepositTime[msg.sender] + withdrawalDelay,
168 |             "Withdrawal delay"
169 |         );
170 | 
171 |         // Calculate assets
172 |         uint256 assetAmount = (shareAmount * totalAssets) / totalShares;
173 | 
174 |         // Apply withdrawal fee
175 |         uint256 fee = (assetAmount * withdrawalFee) / 10000;
176 |         uint256 netAmount = assetAmount - fee;
177 | 
178 |         // Update state
179 |         shares[msg.sender] -= shareAmount;
180 |         totalShares -= shareAmount;
181 |         totalAssets -= assetAmount;
182 | 
183 |         // Transfer fee
184 |         if (fee > 0) {
185 |             asset.transfer(feeRecipient, fee);
186 |         }
187 | 
188 |         // Transfer assets to user
189 |         asset.transfer(msg.sender, netAmount);
190 | 
191 |         emit Withdraw(msg.sender, netAmount, shareAmount);
192 |     }
193 | 
```

**Recommendation:**

Add a nonReentrant modifier from OpenZeppelin ReentrancyGuard to this function.

**References:**
- https://docs.openzeppelin.com/contracts/4.x/api/security#ReentrancyGuard

---

#### VK-049: Missing round completeness check in ArbitrumVault.getAssetPrice()

| | |
|---|---|
| **Severity** | MEDIUM |
| **Confidence** | medium |
| **Category** | Oracle Manipulation |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:262` |

**Description:**

latestRoundData() is called without checking if the round was completed (answeredInRound >= roundId). Incomplete rounds may return stale data.

**Code:**

```solidity
261 |     function getAssetPrice() public view returns (uint256) {
262 |         (, int256 price,,,) = priceFeed.latestRoundData();
263 |         return uint256(price);
```

**Recommendation:**

Check round completeness: `require(answeredInRound >= roundId, "Round not complete");`

---

#### VK-050: Single oracle dependency in ArbitrumVault

| | |
|---|---|
| **Severity** | MEDIUM |
| **Confidence** | low |
| **Category** | Oracle Manipulation |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:50` |

**Description:**

The contract depends on a single oracle (priceFeed). If this oracle fails, returns stale data, or is manipulated, the contract has no fallback mechanism.

**Code:**

```solidity
49 |     IStrategy public strategy;              // Active yield strategy
50 |     AggregatorV3Interface public priceFeed;  // Chainlink price feed
51 | 
```

**Recommendation:**

Consider implementing a fallback oracle pattern with multiple price sources. Use a primary oracle with secondary fallback, or aggregate multiple oracle responses.

---

#### VK-057: Potential division by zero in ArbitrumVault.deposit()

| | |
|---|---|
| **Severity** | MEDIUM |
| **Confidence** | low |
| **Category** | Arithmetic Precision Loss |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:149` |

**Description:**

Division by variable 'totalAssets' without an apparent zero-check. If totalAssets is zero, the transaction will revert. If this is a user-facing function, a zero divisor should produce a meaningful error message.

**Code:**

```solidity
148 |         } else {
149 |             sharesToMint = (amount * totalShares) / totalAssets;
150 |         }
```

**Recommendation:**

Add a require statement: require(totalAssets != 0, "Division by zero");

---

#### VK-058: Potential division by zero in ArbitrumVault.withdraw()

| | |
|---|---|
| **Severity** | MEDIUM |
| **Confidence** | low |
| **Category** | Arithmetic Precision Loss |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:172` |

**Description:**

Division by variable 'totalShares' without an apparent zero-check. If totalShares is zero, the transaction will revert. If this is a user-facing function, a zero divisor should produce a meaningful error message.

**Code:**

```solidity
171 |         // Calculate assets
172 |         uint256 assetAmount = (shareAmount * totalAssets) / totalShares;
173 | 
```

**Recommendation:**

Add a require statement: require(totalShares != 0, "Division by zero");

---

#### VK-061: Potential division by zero in ArbitrumVault.sharePrice()

| | |
|---|---|
| **Severity** | MEDIUM |
| **Confidence** | low |
| **Category** | Arithmetic Precision Loss |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:367` |

**Description:**

Division by variable 'totalShares' without an apparent zero-check. If totalShares is zero, the transaction will revert. If this is a user-facing function, a zero divisor should produce a meaningful error message.

**Code:**

```solidity
366 |         if (totalShares == 0) return 1e18;
367 |         return (totalAssets * 1e18) / totalShares;
368 |     }
```

**Recommendation:**

Add a require statement: require(totalShares != 0, "Division by zero");

---

#### VK-062: Potential division by zero in ArbitrumVault.previewDeposit()

| | |
|---|---|
| **Severity** | MEDIUM |
| **Confidence** | low |
| **Category** | Arithmetic Precision Loss |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:376` |

**Description:**

Division by variable 'totalAssets' without an apparent zero-check. If totalAssets is zero, the transaction will revert. If this is a user-facing function, a zero divisor should produce a meaningful error message.

**Code:**

```solidity
375 |         if (totalShares == 0) return amount;
376 |         return (amount * totalShares) / totalAssets;
377 |     }
```

**Recommendation:**

Add a require statement: require(totalAssets != 0, "Division by zero");

---

#### VK-063: Potential division by zero in ArbitrumVault.previewWithdraw()

| | |
|---|---|
| **Severity** | MEDIUM |
| **Confidence** | low |
| **Category** | Arithmetic Precision Loss |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:381` |

**Description:**

Division by variable 'totalShares' without an apparent zero-check. If totalShares is zero, the transaction will revert. If this is a user-facing function, a zero divisor should produce a meaningful error message.

**Code:**

```solidity
380 |         if (totalShares == 0) return 0;
381 |         uint256 assetAmount = (shareAmount * totalAssets) / totalShares;
382 |         uint256 fee = (assetAmount * withdrawalFee) / 10000;
```

**Recommendation:**

Add a require statement: require(totalShares != 0, "Division by zero");

---

### [LOW] LOW (14)

#### VK-056: block.timestamp used in condition in ArbitrumVault.withdraw()

| | |
|---|---|
| **Severity** | LOW |
| **Confidence** | high |
| **Category** | Timestamp Dependence |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:167` |

**Description:**

block.timestamp is used in a comparison. Validators can manipulate the timestamp by approximately 15 seconds. Ensure this tolerance is acceptable for your use case.

**Code:**

```solidity
166 |         require(
167 |             block.timestamp >= lastDepositTime[msg.sender] + withdrawalDelay,
168 |             "Withdrawal delay"
```

**Recommendation:**

Ensure that a ~15 second manipulation of block.timestamp cannot cause harm. For time-sensitive operations, consider using block numbers or external time oracles.

---

#### VK-059: Potential precision loss in division by 10000 in ArbitrumVault.withdraw()

| | |
|---|---|
| **Severity** | LOW |
| **Confidence** | low |
| **Category** | Arithmetic Precision Loss |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:175` |

**Description:**

Division by 10000 can truncate small amounts to zero. For example, if amount < 10000, the result will be 0. This can lead to users losing small amounts of tokens ("dust") or getting 0 rewards/shares.

**Code:**

```solidity
174 |         // Apply withdrawal fee
175 |         uint256 fee = (assetAmount * withdrawalFee) / 10000;
176 |         uint256 netAmount = assetAmount - fee;
```

**Recommendation:**

Consider adding a minimum amount check, or use fixed-point arithmetic libraries. Ensure rounding favors the protocol (round down for shares issued, round up for shares redeemed).

---

#### VK-060: Potential precision loss in division by 10000 in ArbitrumVault.harvest()

| | |
|---|---|
| **Severity** | LOW |
| **Confidence** | low |
| **Category** | Arithmetic Precision Loss |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:238` |

**Description:**

Division by 10000 can truncate small amounts to zero. For example, if amount < 10000, the result will be 0. This can lead to users losing small amounts of tokens ("dust") or getting 0 rewards/shares.

**Code:**

```solidity
237 |         if (profit > 0) {
238 |             uint256 fee = (profit * performanceFee) / 10000;
239 |             if (fee > 0) {
```

**Recommendation:**

Consider adding a minimum amount check, or use fixed-point arithmetic libraries. Ensure rounding favors the protocol (round down for shares issued, round up for shares redeemed).

---

#### VK-064: Potential precision loss in division by 10000 in ArbitrumVault.previewWithdraw()

| | |
|---|---|
| **Severity** | LOW |
| **Confidence** | low |
| **Category** | Arithmetic Precision Loss |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:382` |

**Description:**

Division by 10000 can truncate small amounts to zero. For example, if amount < 10000, the result will be 0. This can lead to users losing small amounts of tokens ("dust") or getting 0 rewards/shares.

**Code:**

```solidity
381 |         uint256 assetAmount = (shareAmount * totalAssets) / totalShares;
382 |         uint256 fee = (assetAmount * withdrawalFee) / 10000;
383 |         return assetAmount - fee;
```

**Recommendation:**

Consider adding a minimum amount check, or use fixed-point arithmetic libraries. Ensure rounding favors the protocol (round down for shares issued, round up for shares redeemed).

---

#### VK-067: Missing event emission in ArbitrumVault.setPerformanceFee()

| | |
|---|---|
| **Severity** | LOW |
| **Confidence** | high |
| **Category** | Missing Event Emission |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:287` |

**Description:**

Function setPerformanceFee() modifies critical state variable(s) [performanceFee] but does not emit any events. This makes it impossible for off-chain systems to detect these changes, hindering monitoring, governance, and incident response.

**Code:**

```solidity
286 | 
287 |     function setPerformanceFee(uint256 _fee) external onlyOwner {
288 |         performanceFee = _fee;
289 |     }
290 | 
```

**Recommendation:**

Define and emit an event for state changes in setPerformanceFee(). Example:
event PerformanceFeeUpdated(performanceFee oldPerformanceFee, performanceFee newPerformanceFee);
Emit the event after the state change with old and new values.

---

#### VK-068: Missing event emission in ArbitrumVault.setWithdrawalFee()

| | |
|---|---|
| **Severity** | LOW |
| **Confidence** | high |
| **Category** | Missing Event Emission |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:291` |

**Description:**

Function setWithdrawalFee() modifies critical state variable(s) [withdrawalFee] but does not emit any events. This makes it impossible for off-chain systems to detect these changes, hindering monitoring, governance, and incident response.

**Code:**

```solidity
290 | 
291 |     function setWithdrawalFee(uint256 _fee) external onlyOwner {
292 |         withdrawalFee = _fee;
293 |     }
294 | 
```

**Recommendation:**

Define and emit an event for state changes in setWithdrawalFee(). Example:
event WithdrawalFeeUpdated(withdrawalFee oldWithdrawalFee, withdrawalFee newWithdrawalFee);
Emit the event after the state change with old and new values.

---

#### VK-069: Missing event emission in ArbitrumVault.setManagementFee()

| | |
|---|---|
| **Severity** | LOW |
| **Confidence** | high |
| **Category** | Missing Event Emission |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:295` |

**Description:**

Function setManagementFee() modifies critical state variable(s) [managementFee] but does not emit any events. This makes it impossible for off-chain systems to detect these changes, hindering monitoring, governance, and incident response.

**Code:**

```solidity
294 | 
295 |     function setManagementFee(uint256 _fee) external onlyOwner {
296 |         managementFee = _fee;
297 |     }
298 | 
```

**Recommendation:**

Define and emit an event for state changes in setManagementFee(). Example:
event ManagementFeeUpdated(managementFee oldManagementFee, managementFee newManagementFee);
Emit the event after the state change with old and new values.

---

#### VK-073: Missing event emission in ArbitrumVault.setFeeRecipient()

| | |
|---|---|
| **Severity** | LOW |
| **Confidence** | high |
| **Category** | Missing Event Emission |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:311` |

**Description:**

Function setFeeRecipient() modifies critical state variable(s) [feeRecipient] but does not emit any events. This makes it impossible for off-chain systems to detect these changes, hindering monitoring, governance, and incident response.

**Code:**

```solidity
310 | 
311 |     function setFeeRecipient(address _recipient) external onlyOwner {
312 |         feeRecipient = _recipient;
313 |     }
314 | 
```

**Recommendation:**

Define and emit an event for state changes in setFeeRecipient(). Example:
event FeeRecipientUpdated(feeRecipient oldFeeRecipient, feeRecipient newFeeRecipient);
Emit the event after the state change with old and new values.

---

#### VK-074: Missing event emission in ArbitrumVault.setGuardian()

| | |
|---|---|
| **Severity** | LOW |
| **Confidence** | high |
| **Category** | Missing Event Emission |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:315` |

**Description:**

Function setGuardian() modifies critical state variable(s) [guardian] but does not emit any events. This makes it impossible for off-chain systems to detect these changes, hindering monitoring, governance, and incident response.

**Code:**

```solidity
314 | 
315 |     function setGuardian(address _guardian) external onlyOwner {
316 |         guardian = _guardian;
317 |     }
318 | 
```

**Recommendation:**

Define and emit an event for state changes in setGuardian(). Example:
event GuardianUpdated(guardian oldGuardian, guardian newGuardian);
Emit the event after the state change with old and new values.

---

#### VK-075: Missing event emission in ArbitrumVault.transferOwnership()

| | |
|---|---|
| **Severity** | LOW |
| **Confidence** | high |
| **Category** | Missing Event Emission |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:319` |

**Description:**

Function transferOwnership() modifies critical state variable(s) [pendingOwner] but does not emit any events. This makes it impossible for off-chain systems to detect these changes, hindering monitoring, governance, and incident response.

**Code:**

```solidity
318 | 
319 |     function transferOwnership(address _newOwner) external onlyOwner {
320 |         pendingOwner = _newOwner;
321 |     }
322 | 
```

**Recommendation:**

Define and emit an event for state changes in transferOwnership(). Example:
event TransferOwnershipUpdated(pendingOwner oldPendingOwner, pendingOwner newPendingOwner);
Emit the event after the state change with old and new values.

---

#### VK-076: Missing event emission in ArbitrumVault.acceptOwnership()

| | |
|---|---|
| **Severity** | LOW |
| **Confidence** | high |
| **Category** | Missing Event Emission |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:323` |

**Description:**

Function acceptOwnership() modifies critical state variable(s) [owner, pendingOwner] but does not emit any events. This makes it impossible for off-chain systems to detect these changes, hindering monitoring, governance, and incident response.

**Code:**

```solidity
322 | 
323 |     function acceptOwnership() external {
324 |         require(msg.sender == pendingOwner, "Not pending owner");
325 |         owner = pendingOwner;
326 |         pendingOwner = address(0);
327 |     }
328 | 
```

**Recommendation:**

Define and emit an event for state changes in acceptOwnership(). Example:
event AcceptOwnershipUpdated(owner oldOwner, owner newOwner, pendingOwner oldPendingOwner, pendingOwner newPendingOwner);
Emit the event after the state change with old and new values.

---

#### VK-078: Missing event emission in ArbitrumVault.addToWhitelist()

| | |
|---|---|
| **Severity** | LOW |
| **Confidence** | high |
| **Category** | Missing Event Emission |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:333` |

**Description:**

Function addToWhitelist() modifies critical state variable(s) [whitelist] but does not emit any events. This makes it impossible for off-chain systems to detect these changes, hindering monitoring, governance, and incident response.

**Code:**

```solidity
332 | 
333 |     function addToWhitelist(address[] calldata _addresses) external onlyOwner {
334 |         for (uint256 i = 0; i < _addresses.length; i++) {
335 |             whitelist[_addresses[i]] = true;
336 |             whitelistedAddresses.push(_addresses[i]);
337 |         }
338 |     }
339 | 
```

**Recommendation:**

Define and emit an event for state changes in addToWhitelist(). Example:
event AddToWhitelistUpdated(whitelist oldWhitelist, whitelist newWhitelist);
Emit the event after the state change with old and new values.

---

#### VK-079: Missing event emission in ArbitrumVault.removeFromWhitelist()

| | |
|---|---|
| **Severity** | LOW |
| **Confidence** | high |
| **Category** | Missing Event Emission |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:340` |

**Description:**

Function removeFromWhitelist() modifies critical state variable(s) [whitelist] but does not emit any events. This makes it impossible for off-chain systems to detect these changes, hindering monitoring, governance, and incident response.

**Code:**

```solidity
339 | 
340 |     function removeFromWhitelist(address _address) external onlyOwner {
341 |         whitelist[_address] = false;
342 |     }
343 | 
```

**Recommendation:**

Define and emit an event for state changes in removeFromWhitelist(). Example:
event RemoveFromWhitelistUpdated(whitelist oldWhitelist, whitelist newWhitelist);
Emit the event after the state change with old and new values.

---

#### VK-080: Missing event emission in ArbitrumVault.emergencyWithdraw()

| | |
|---|---|
| **Severity** | LOW |
| **Confidence** | high |
| **Category** | Missing Event Emission |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:346` |

**Description:**

Function emergencyWithdraw() modifies critical state variable(s) [paused] but does not emit any events. This makes it impossible for off-chain systems to detect these changes, hindering monitoring, governance, and incident response.

**Code:**

```solidity
345 | 
346 |     function emergencyWithdraw() external onlyOwner {
347 |         // Pull everything from strategy
348 |         if (address(strategy) != address(0)) {
349 |             uint256 balance = strategy.balanceOf();
350 |             if (balance > 0) {
351 |                 strategy.withdraw(balance);
352 |             }
353 |         }
354 | 
355 |         // Send all assets to owner
356 |         uint256 total = asset.balanceOf(address(this));
357 |         asset.transfer(owner, total);
358 | 
359 |         emergencyMode = true;
360 |         paused = true;
361 |     }
362 | 
```

**Recommendation:**

Define and emit an event for state changes in emergencyWithdraw(). Example:
event EmergencyWithdrawUpdated(paused oldPaused, paused newPaused);
Emit the event after the state change with old and new values.

---

### [INFO] INFORMATIONAL (11)

#### VK-051: Centralization risk: ArbitrumVault.unpause()

| | |
|---|---|
| **Severity** | INFORMATIONAL |
| **Confidence** | high |
| **Category** | Centralization Risk |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:278` |

**Description:**

Privileged function unpause() can freeze/unfreeze all protocol operations. This is controlled by a single owner/admin account. A timelock or multisig pattern was detected, which mitigates the risk. If this account is compromised, an attacker could exploit this function.

**Code:**

```solidity
277 | 
278 |     function unpause() external onlyOwner {
279 |         paused = false;
280 |         emit Unpaused(msg.sender);
281 |     }
282 | 
```

**Recommendation:**

Consider implementing:
1. A timelock (e.g., OpenZeppelin TimelockController) for parameter changes
2. Multi-signature wallet for admin operations
3. Governance voting for critical decisions
4. Maximum bounds on configurable parameters (e.g., max fee < 10%)

---

#### VK-052: Centralization risk: ArbitrumVault.setFeeRecipient()

| | |
|---|---|
| **Severity** | INFORMATIONAL |
| **Confidence** | high |
| **Category** | Centralization Risk |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:311` |

**Description:**

Privileged function setFeeRecipient() can modify critical protocol parameters. This is controlled by a single owner/admin account. A timelock or multisig pattern was detected, which mitigates the risk. If this account is compromised, an attacker could exploit this function.

**Code:**

```solidity
310 | 
311 |     function setFeeRecipient(address _recipient) external onlyOwner {
312 |         feeRecipient = _recipient;
313 |     }
314 | 
```

**Recommendation:**

Consider implementing:
1. A timelock (e.g., OpenZeppelin TimelockController) for parameter changes
2. Multi-signature wallet for admin operations
3. Governance voting for critical decisions
4. Maximum bounds on configurable parameters (e.g., max fee < 10%)

---

#### VK-053: Centralization risk: ArbitrumVault.transferOwnership()

| | |
|---|---|
| **Severity** | INFORMATIONAL |
| **Confidence** | high |
| **Category** | Centralization Risk |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:319` |

**Description:**

Privileged function transferOwnership() can transfer ownership to a new address. This is controlled by a single owner/admin account. A timelock or multisig pattern was detected, which mitigates the risk. If this account is compromised, an attacker could exploit this function.

**Code:**

```solidity
318 | 
319 |     function transferOwnership(address _newOwner) external onlyOwner {
320 |         pendingOwner = _newOwner;
321 |     }
322 | 
```

**Recommendation:**

Consider implementing:
1. A timelock (e.g., OpenZeppelin TimelockController) for parameter changes
2. Multi-signature wallet for admin operations
3. Governance voting for critical decisions
4. Maximum bounds on configurable parameters (e.g., max fee < 10%)

---

#### VK-054: Centralization risk: ArbitrumVault.setWhitelistEnabled()

| | |
|---|---|
| **Severity** | INFORMATIONAL |
| **Confidence** | high |
| **Category** | Centralization Risk |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:329` |

**Description:**

Privileged function setWhitelistEnabled() can modify access permissions. This is controlled by a single owner/admin account. A timelock or multisig pattern was detected, which mitigates the risk. If this account is compromised, an attacker could exploit this function.

**Code:**

```solidity
328 | 
329 |     function setWhitelistEnabled(bool _enabled) external onlyOwner {
330 |         whitelistEnabled = _enabled;
331 |     }
332 | 
```

**Recommendation:**

Consider implementing:
1. A timelock (e.g., OpenZeppelin TimelockController) for parameter changes
2. Multi-signature wallet for admin operations
3. Governance voting for critical decisions
4. Maximum bounds on configurable parameters (e.g., max fee < 10%)

---

#### VK-055: Centralization risk: ArbitrumVault.emergencyWithdraw()

| | |
|---|---|
| **Severity** | INFORMATIONAL |
| **Confidence** | high |
| **Category** | Centralization Risk |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:346` |

**Description:**

Privileged function emergencyWithdraw() can drain all funds from the contract. This is controlled by a single owner/admin account. A timelock or multisig pattern was detected, which mitigates the risk. If this account is compromised, an attacker could exploit this function.

**Code:**

```solidity
345 | 
346 |     function emergencyWithdraw() external onlyOwner {
347 |         // Pull everything from strategy
348 |         if (address(strategy) != address(0)) {
349 |             uint256 balance = strategy.balanceOf();
350 |             if (balance > 0) {
351 |                 strategy.withdraw(balance);
352 |             }
353 |         }
354 | 
355 |         // Send all assets to owner
356 |         uint256 total = asset.balanceOf(address(this));
357 |         asset.transfer(owner, total);
358 | 
359 |         emergencyMode = true;
360 |         paused = true;
361 |     }
362 | 
```

**Recommendation:**

Consider implementing:
1. A timelock (e.g., OpenZeppelin TimelockController) for parameter changes
2. Multi-signature wallet for admin operations
3. Governance voting for critical decisions
4. Maximum bounds on configurable parameters (e.g., max fee < 10%)

---

#### VK-065: Floating pragma: solidity ^0.8.20

| | |
|---|---|
| **Severity** | INFORMATIONAL |
| **Confidence** | high |
| **Category** | Floating Pragma |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:2` |

**Description:**

The pragma directive 'pragma solidity ^0.8.20' allows compilation with multiple compiler versions. This can lead to the contract being deployed with a different compiler version than it was tested with, potentially introducing bugs or unexpected behavior.

**Code:**

```solidity
1 | // SPDX-License-Identifier: MIT
2 | pragma solidity ^0.8.20;
3 | 
```

**Recommendation:**

Lock the pragma to a specific compiler version (e.g., `pragma solidity 0.8.20;`). Use the exact version that the contract was tested and audited with.

**References:**
- https://swcregistry.io/docs/SWC-103

---

#### VK-066: Setter ArbitrumVault.setEmergencyMode() missing event

| | |
|---|---|
| **Severity** | INFORMATIONAL |
| **Confidence** | medium |
| **Category** | Missing Event Emission |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:283` |

**Description:**

Setter function setEmergencyMode() modifies state but emits no event. Configuration changes should be logged for transparency and monitoring.

**Code:**

```solidity
282 | 
283 |     function setEmergencyMode(bool _emergency) external onlyOwner {
284 |         emergencyMode = _emergency;
285 |     }
286 | 
```

**Recommendation:**

Emit an event with the old and new values when configuration is changed.

---

#### VK-070: Setter ArbitrumVault.setDepositCap() missing event

| | |
|---|---|
| **Severity** | INFORMATIONAL |
| **Confidence** | medium |
| **Category** | Missing Event Emission |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:299` |

**Description:**

Setter function setDepositCap() modifies state but emits no event. Configuration changes should be logged for transparency and monitoring.

**Code:**

```solidity
298 | 
299 |     function setDepositCap(uint256 _cap) external onlyOwner {
300 |         depositCap = _cap;
301 |     }
302 | 
```

**Recommendation:**

Emit an event with the old and new values when configuration is changed.

---

#### VK-071: Setter ArbitrumVault.setMinDeposit() missing event

| | |
|---|---|
| **Severity** | INFORMATIONAL |
| **Confidence** | medium |
| **Category** | Missing Event Emission |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:303` |

**Description:**

Setter function setMinDeposit() modifies state but emits no event. Configuration changes should be logged for transparency and monitoring.

**Code:**

```solidity
302 | 
303 |     function setMinDeposit(uint256 _min) external onlyOwner {
304 |         minDeposit = _min;
305 |     }
306 | 
```

**Recommendation:**

Emit an event with the old and new values when configuration is changed.

---

#### VK-072: Setter ArbitrumVault.setWithdrawalDelay() missing event

| | |
|---|---|
| **Severity** | INFORMATIONAL |
| **Confidence** | medium |
| **Category** | Missing Event Emission |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:307` |

**Description:**

Setter function setWithdrawalDelay() modifies state but emits no event. Configuration changes should be logged for transparency and monitoring.

**Code:**

```solidity
306 | 
307 |     function setWithdrawalDelay(uint256 _delay) external onlyOwner {
308 |         withdrawalDelay = _delay;
309 |     }
310 | 
```

**Recommendation:**

Emit an event with the old and new values when configuration is changed.

---

#### VK-077: Setter ArbitrumVault.setWhitelistEnabled() missing event

| | |
|---|---|
| **Severity** | INFORMATIONAL |
| **Confidence** | medium |
| **Category** | Missing Event Emission |
| **Location** | `/home/user/Vault-Kit/contracts/ArbitrumVault.sol:329` |

**Description:**

Setter function setWhitelistEnabled() modifies state but emits no event. Configuration changes should be logged for transparency and monitoring.

**Code:**

```solidity
328 | 
329 |     function setWhitelistEnabled(bool _enabled) external onlyOwner {
330 |         whitelistEnabled = _enabled;
331 |     }
332 | 
```

**Recommendation:**

Emit an event with the old and new values when configuration is changed.

---

## Disclaimer

This report was generated by **Vault-Kit** automated static analysis engine. Static analysis is a valuable first step in security assessment but cannot detect all vulnerability classes (e.g., business logic errors, economic attacks). This report should not be considered a substitute for a comprehensive manual audit by experienced security researchers.

---
*Generated by Vault-Kit v1.0.0*