/**
 * ArbitrumVault deployment script.
 *
 * Targets: Arbitrum One mainnet, Arbitrum Sepolia testnet.
 *
 * Usage:
 *   npx hardhat run contracts/scripts/deploy.js --network arbitrumOne
 *   npx hardhat run contracts/scripts/deploy.js --network arbitrumSepolia
 *
 * Required env vars:
 *   PRIVATE_KEY               Deployer key (use a hardware wallet for mainnet via --network)
 *   ARBITRUM_RPC_URL          RPC endpoint (only needed for live deploys, not local sim)
 *   FEE_RECIPIENT             Address that receives performance + management fees (multisig)
 *
 * What this script does:
 *   1. Picks the correct Chainlink price feed + sequencer feed for the target chain
 *   2. Deploys the SimpleLendingStrategy first (using Aave V3 pool address)
 *   3. Deploys the ArbitrumVault wired to the chosen feeds and asset
 *   4. Calls vault.setStrategy() to attach the strategy
 *   5. Verifies critical invariants post-deploy and prints a summary
 */

const { ethers, network } = require('hardhat');

// Chainlink + Aave addresses for supported networks.
// Source for Chainlink: https://docs.chain.link/data-feeds/price-feeds/addresses?network=arbitrum
// Source for Aave V3:   https://docs.aave.com/developers/deployed-contracts/v3-mainnet/arbitrum
const NETWORK_CONFIG = {
  arbitrumOne: {
    chainId: 42161,
    // Asset = WETH on Arbitrum One
    asset: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    // ETH/USD Chainlink feed (8 decimals)
    priceFeed: '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612',
    // Arbitrum L2 sequencer uptime feed
    sequencerUptimeFeed: '0xFdB631F5EE196F0ed6FAa767959853A9F217697D',
    // Aave V3 Pool on Arbitrum One
    aaveV3Pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
    name: 'Vault Kit ETH (Arbitrum)',
    symbol: 'vkETH',
  },
  arbitrumSepolia: {
    chainId: 421614,
    // Sepolia WETH
    asset: '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73',
    // Sepolia ETH/USD feed
    priceFeed: '0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165',
    // Arbitrum Sepolia sequencer uptime feed (set to a placeholder if unavailable)
    sequencerUptimeFeed: '0x0000000000000000000000000000000000000000',
    // Aave V3 Pool on Arbitrum Sepolia
    aaveV3Pool: '0xBfC91D59fdAA134A4ED45f7B584cAf96D7792Eff',
    name: 'Vault Kit ETH (Sepolia)',
    symbol: 'vkETH-test',
  },
};

async function main() {
  const netName = network.name;
  const config = NETWORK_CONFIG[netName];

  if (!config) {
    console.error(`Unsupported network: ${netName}`);
    console.error(`Supported: ${Object.keys(NETWORK_CONFIG).join(', ')}`);
    console.error('To deploy to a new chain, add an entry to NETWORK_CONFIG with verified addresses.');
    process.exit(1);
  }

  // Refuse to deploy to mainnet without an explicit fee recipient
  const feeRecipient = process.env.FEE_RECIPIENT;
  if (!feeRecipient || !ethers.isAddress(feeRecipient)) {
    console.error('FEE_RECIPIENT env var is missing or invalid.');
    console.error('Set it to your multisig address (e.g., a Gnosis Safe).');
    process.exit(1);
  }

  if (config.sequencerUptimeFeed === '0x0000000000000000000000000000000000000000') {
    console.warn('WARNING: sequencerUptimeFeed is the zero address.');
    console.warn('  This is acceptable on testnets without a real sequencer feed but');
    console.warn('  the contract will refuse construction. Update NETWORK_CONFIG.');
    process.exit(1);
  }

  const [deployer] = await ethers.getSigners();
  console.log('=================================================================');
  console.log('  ArbitrumVault deployment');
  console.log('=================================================================');
  console.log(`  Network:           ${netName} (chainId ${config.chainId})`);
  console.log(`  Deployer:          ${deployer.address}`);
  console.log(`  Asset (WETH):      ${config.asset}`);
  console.log(`  Price feed:        ${config.priceFeed}`);
  console.log(`  Sequencer feed:    ${config.sequencerUptimeFeed}`);
  console.log(`  Aave V3 Pool:      ${config.aaveV3Pool}`);
  console.log(`  Fee recipient:     ${feeRecipient}`);
  console.log('=================================================================');

  // 1. Deploy ArbitrumVault first (strategy needs the vault's address)
  console.log('\n[1/3] Deploying ArbitrumVault...');
  const ArbitrumVault = await ethers.getContractFactory('ArbitrumVault');
  const vault = await ArbitrumVault.deploy(
    config.name,
    config.symbol,
    config.asset,
    config.priceFeed,
    config.sequencerUptimeFeed,
    feeRecipient
  );
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log(`      Vault deployed at: ${vaultAddress}`);

  // 2. Deploy strategy
  console.log('\n[2/3] Deploying SimpleLendingStrategy...');
  const SimpleLendingStrategy = await ethers.getContractFactory('SimpleLendingStrategy');
  const strategy = await SimpleLendingStrategy.deploy(
    vaultAddress,
    config.asset,
    config.aaveV3Pool
  );
  await strategy.waitForDeployment();
  const strategyAddress = await strategy.getAddress();
  console.log(`      Strategy deployed at: ${strategyAddress}`);

  // 3. Wire strategy to vault
  console.log('\n[3/3] Setting strategy on vault...');
  const tx = await vault.setStrategy(strategyAddress);
  await tx.wait();
  console.log(`      Strategy wired (tx ${tx.hash})`);

  // Post-deploy verification
  console.log('\n=================================================================');
  console.log('  Post-deploy verification');
  console.log('=================================================================');
  console.log(`  vault.owner():            ${await vault.owner()}`);
  console.log(`  vault.guardian():         ${await vault.guardian()}`);
  console.log(`  vault.strategy():         ${await vault.strategy()}`);
  console.log(`  vault.feeRecipient():     ${await vault.feeRecipient()}`);
  console.log(`  vault.performanceFee():   ${await vault.performanceFee()} bps`);
  console.log(`  vault.withdrawalFee():    ${await vault.withdrawalFee()} bps`);
  console.log(`  vault.managementFee():    ${await vault.managementFee()} bps/yr`);
  console.log(`  vault.depositCap():       ${ethers.formatEther(await vault.depositCap())} ETH`);
  console.log(`  vault.minDeposit():       ${ethers.formatEther(await vault.minDeposit())} ETH`);
  console.log(`  vault.withdrawalDelay():  ${await vault.withdrawalDelay()}s`);
  console.log(`  vault.DECIMALS_OFFSET():  ${await vault.DECIMALS_OFFSET()}`);

  // Critical invariants
  if ((await vault.owner()) === ethers.ZeroAddress) throw new Error('owner is zero');
  if ((await vault.feeRecipient()) === ethers.ZeroAddress) throw new Error('feeRecipient is zero');
  if ((await vault.strategy()) !== strategyAddress) throw new Error('strategy mismatch');

  console.log('\n  All invariants OK.');
  console.log('\n=================================================================');
  console.log('  IMMEDIATE POST-DEPLOY ACTIONS REQUIRED:');
  console.log('=================================================================');
  console.log('  1. transferOwnership() to your multisig (Gnosis Safe)');
  console.log('  2. setGuardian() to your operations multisig (separate from owner)');
  console.log('  3. Verify the contract source on Arbiscan');
  console.log('  4. Run a small end-to-end test (deposit 0.01 ETH, harvest, withdraw)');
  console.log('  5. Subscribe monitoring (Forta / Tenderly / OpenZeppelin Defender) to:');
  console.log('     - Deposit / Withdraw events');
  console.log('     - StrategyUpdated / EmergencyModeSet events');
  console.log('     - Any *Updated event for fee changes');
  console.log('  6. Activate bug bounty (Immunefi)');
  console.log('  7. Cap depositCap to 1% of audit cost initially');
  console.log('=================================================================\n');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
