import { BaseDetector } from './base';
import { ReentrancyDetector } from './reentrancy';
import { AccessControlDetector } from './access-control';
import { UncheckedCallsDetector } from './unchecked-calls';
import { IntegerOverflowDetector } from './integer-overflow';
import { TxOriginDetector } from './tx-origin';
import { DelegatecallDetector } from './delegatecall';
import { SelfdestructDetector } from './selfdestruct';
import { TimestampDependenceDetector } from './timestamp-dependence';
import { DOSVectorsDetector } from './dos-vectors';
import { FrontRunningDetector } from './front-running';
import { UninitializedStorageDetector } from './uninitialized-storage';
import { FloatingPragmaDetector } from './floating-pragma';
import { GasOptimizationDetector } from './gas-optimization';
import { FlashLoanDetector } from './flash-loan';
import { OracleManipulationDetector } from './oracle-manipulation';
import { ProxyStorageDetector } from './proxy-storage';
import { ERCComplianceDetector } from './erc-compliance';
import { LockedEtherDetector } from './locked-ether';
import { StateShadowingDetector } from './state-shadowing';
import { MissingEventsDetector } from './missing-events';
import { UnsafeAssemblyDetector } from './unsafe-assembly';
import { PrecisionLossDetector } from './precision-loss';
import { CentralizationRiskDetector } from './centralization-risk';

/** All available detectors, ordered by typical severity */
export function getAllDetectors(): BaseDetector[] {
  return [
    // Critical
    new ReentrancyDetector(),
    new AccessControlDetector(),
    new DelegatecallDetector(),

    // High
    new UncheckedCallsDetector(),
    new IntegerOverflowDetector(),
    new TxOriginDetector(),
    new FlashLoanDetector(),
    new OracleManipulationDetector(),
    new ProxyStorageDetector(),
    new LockedEtherDetector(),
    new CentralizationRiskDetector(),

    // Medium
    new SelfdestructDetector(),
    new TimestampDependenceDetector(),
    new DOSVectorsDetector(),
    new FrontRunningDetector(),
    new UninitializedStorageDetector(),
    new PrecisionLossDetector(),
    new StateShadowingDetector(),
    new UnsafeAssemblyDetector(),

    // Low / Informational / Gas
    new FloatingPragmaDetector(),
    new ERCComplianceDetector(),
    new MissingEventsDetector(),
    new GasOptimizationDetector(),
  ];
}

/** Get a detector by its ID */
export function getDetectorById(id: string): BaseDetector | undefined {
  return getAllDetectors().find(d => d.id === id);
}

/** Get detectors filtered by enabled/disabled lists */
export function getFilteredDetectors(
  enabled?: string[],
  disabled?: string[]
): BaseDetector[] {
  let detectors = getAllDetectors();

  if (enabled && enabled.length > 0) {
    const enabledSet = new Set(enabled);
    detectors = detectors.filter(d => enabledSet.has(d.id));
  }

  if (disabled && disabled.length > 0) {
    const disabledSet = new Set(disabled);
    detectors = detectors.filter(d => !disabledSet.has(d.id));
  }

  return detectors;
}

export { BaseDetector } from './base';
