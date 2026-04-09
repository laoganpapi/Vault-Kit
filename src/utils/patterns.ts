/**
 * Common Solidity vulnerability patterns expressed as helpers.
 * These are used by multiple detectors.
 */

/** Known reentrancy guard modifier names */
export const REENTRANCY_GUARD_MODIFIERS = new Set([
  'nonreentrant',
  'nonreentrancy',
  'noreentrancy',
  'reentrancyguard',
  'lock',
  'mutex',
]);

/** Known access control modifier names */
export const ACCESS_CONTROL_MODIFIERS = new Set([
  'onlyowner',
  'onlyadmin',
  'onlyrole',
  'onlyauthorized',
  'onlyminter',
  'onlygovernance',
  'onlyguardian',
  'onlyoperator',
  'onlymanager',
  'onlywhitelisted',
  'onlypendinggovernor',
  'onlykeeper',
  'onlymultisig',
  'onlydao',
  'auth',
  'authorized',
  'restricted',
  'requiresauth',
]);

/** Critical function names that should have access control */
export const CRITICAL_FUNCTIONS = new Set([
  'withdraw',
  'withdrawall',
  'withdrawfunds',
  'emergencywithdraw',
  'mint',
  'burn',
  'pause',
  'unpause',
  'setowner',
  'transferownership',
  'renounceownership',
  'upgradeto',
  'upgradetoandcall',
  'setimplementation',
  'setadmin',
  'setfee',
  'setprice',
  'setoracleaddress',
  'initialize',
  'init',
]);

/** ERC-20 required functions */
export const ERC20_FUNCTIONS = [
  'totalSupply',
  'balanceOf',
  'transfer',
  'allowance',
  'approve',
  'transferFrom',
];

/** ERC-20 required events */
export const ERC20_EVENTS = ['Transfer', 'Approval'];

/** ERC-721 required functions */
export const ERC721_FUNCTIONS = [
  'balanceOf',
  'ownerOf',
  'safeTransferFrom',
  'transferFrom',
  'approve',
  'setApprovalForAll',
  'getApproved',
  'isApprovedForAll',
];

/** ERC-721 required events */
export const ERC721_EVENTS = ['Transfer', 'Approval', 'ApprovalForAll'];

/** Common oracle interface function names */
export const ORACLE_FUNCTIONS = new Set([
  'latestanswer',
  'latestrounddata',
  'getprice',
  'getlatestprice',
  'consultprice',
  'getamountout',
  'getamountsout',
  'getreserves',
  'quote',
]);

/** Flash loan callback function signatures */
export const FLASH_LOAN_CALLBACKS = new Set([
  'onflashloan',
  'executeOperation', // Aave
  'uniswapV2Call',
  'uniswapV3FlashCallback',
  'pancakeCall',
]);

/** Functions that indicate value transfer */
export const VALUE_TRANSFER_MEMBERS = new Set([
  'transfer',
  'send',
  'call',
]);

/** Known safe math library patterns */
export const SAFE_MATH_LIBRARIES = new Set([
  'safemath',
  'math',
  'signedmath',
  'safecasting',
]);

/** Check if a modifier name indicates access control */
export function isAccessControlModifier(name: string): boolean {
  return ACCESS_CONTROL_MODIFIERS.has(name.toLowerCase());
}

/** Check if a modifier name indicates reentrancy protection */
export function isReentrancyGuard(name: string): boolean {
  return REENTRANCY_GUARD_MODIFIERS.has(name.toLowerCase());
}

/** Check if a function name suggests it's critical and needs access control */
export function isCriticalFunction(name: string): boolean {
  return CRITICAL_FUNCTIONS.has(name.toLowerCase());
}
