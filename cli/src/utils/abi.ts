// Minimal ABIs for vault interaction — only the functions we need

export const VAULT_ABI = [
  "function deposit(uint256 assets, address receiver) returns (uint256 shares)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)",
  "function withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)",
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function convertToShares(uint256 assets) view returns (uint256)",
  "function previewDeposit(uint256 assets) view returns (uint256)",
  "function previewRedeem(uint256 shares) view returns (uint256)",
  "function asset() view returns (address)",
  "function highWaterMark() view returns (uint256)",
  "function circuitBreakerTripped() view returns (bool)",
  "function paused() view returns (bool)",
  "function strategyManager() view returns (address)",
  "function DEPOSIT_CAP() view returns (uint256)",
  "function WITHDRAWAL_FEE_BPS() view returns (uint256)",
  "function PERFORMANCE_FEE_BPS() view returns (uint256)",
];

export const STRATEGY_MANAGER_ABI = [
  "function strategyCount() view returns (uint256)",
  "function strategies(uint256 index) view returns (address strategy, uint256 allocationBps, bool active, uint256 lastHarvest)",
  "function totalDeployedAssets() view returns (uint256)",
  "function totalAllocationBps() view returns (uint256)",
  "function getStrategyHealth() view returns (address[] addrs, uint256[] healths)",
];

export const STRATEGY_ABI = [
  "function name() view returns (string)",
  "function totalAssets() view returns (uint256)",
  "function healthFactor() view returns (uint256)",
  "function canDeposit() view returns (bool)",
];

export const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];
