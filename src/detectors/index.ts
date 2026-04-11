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
import { ShareInflationDetector } from './share-inflation';
import { SignatureReplayDetector } from './signature-replay';
import { WeirdERC20Detector } from './weird-erc20';
import { SandwichDetector } from './sandwich';
import { StorageCollisionDetector } from './storage-collision';
import { ReadOnlyReentrancyDetector } from './readonly-reentrancy';
import { EcrecoverBugsDetector } from './ecrecover-bugs';
import { ArbitraryExternalCallDetector } from './arbitrary-external-call';
import { UninitializedProxyDetector } from './uninitialized-proxy';
import { L2SequencerDetector } from './l2-sequencer';
import { UnsafeCastDetector } from './unsafe-cast';
import { ForcedEtherDetector } from './forced-ether';

/** All available detectors, ordered by typical severity */
export function getAllDetectors(): BaseDetector[] {
  return [
    // Critical
    new ReentrancyDetector(),
    new AccessControlDetector(),
    new DelegatecallDetector(),
    new SandwichDetector(),
    new ArbitraryExternalCallDetector(),

    // High
    new UncheckedCallsDetector(),
    new IntegerOverflowDetector(),
    new TxOriginDetector(),
    new FlashLoanDetector(),
    new OracleManipulationDetector(),
    new ProxyStorageDetector(),
    new LockedEtherDetector(),
    new CentralizationRiskDetector(),
    new ShareInflationDetector(),
    new SignatureReplayDetector(),
    new StorageCollisionDetector(),
    new ReadOnlyReentrancyDetector(),
    new EcrecoverBugsDetector(),
    new UninitializedProxyDetector(),
    new L2SequencerDetector(),

    // Medium
    new SelfdestructDetector(),
    new TimestampDependenceDetector(),
    new DOSVectorsDetector(),
    new FrontRunningDetector(),
    new UninitializedStorageDetector(),
    new PrecisionLossDetector(),
    new StateShadowingDetector(),
    new UnsafeAssemblyDetector(),
    new WeirdERC20Detector(),
    new UnsafeCastDetector(),
    new ForcedEtherDetector(),

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
