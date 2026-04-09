// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library Errors {
    // ─── Vault ───
    error DepositCapExceeded();
    error ZeroAmount();
    error ZeroAddress();
    error CircuitBreakerTripped();
    error StrategyAlreadyExists();
    error StrategyNotFound();
    error MaxStrategiesReached();
    error AllocationMismatch();
    error InsufficientIdle();

    // ─── Access ───
    error NotTimelock();
    error NotGuardian();
    error NotHarvester();
    error NotVault();

    // ─── Oracle ───
    error OracleStale();
    error OracleNegativePrice();
    error SequencerDown();
    error GracePeriodNotOver();

    // ─── Strategy ───
    error HealthFactorTooLow();
    error SlippageExceeded();
    error StrategyCannotDeposit();
    error MaxLeverageExceeded();
    error HedgeDriftTooHigh();

    // ─── Timelock ───
    error TimelockDelayNotMet();
    error TimelockTxNotQueued();
    error TimelockTxExpired();
    error TimelockDelayOutOfRange();
}
