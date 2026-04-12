const { expect } = require('chai');
const { ethers } = require('hardhat');

const PRICE_8_DECIMALS = 2000n * 10n ** 8n;

async function deployFullStack() {
  const [owner, alice, bob, feeRecipient] = await ethers.getSigners();

  const MockERC20 = await ethers.getContractFactory('MockERC20');
  const token = await MockERC20.deploy('Mock', 'MOCK', 18);

  const MockLendingPool = await ethers.getContractFactory('MockLendingPool');
  const lendingPool = await MockLendingPool.deploy(await token.getAddress());

  const MockAggregator = await ethers.getContractFactory('MockAggregator');
  const priceFeed = await MockAggregator.deploy(PRICE_8_DECIMALS);
  const sequencerFeed = await MockAggregator.deploy(0n);

  await ethers.provider.send('evm_increaseTime', [7200]);
  await ethers.provider.send('evm_mine', []);
  await priceFeed.setAnswer(PRICE_8_DECIMALS);

  const ArbitrumVault = await ethers.getContractFactory('ArbitrumVault');
  const vault = await ArbitrumVault.deploy(
    'Vault', 'vMOCK',
    await token.getAddress(),
    await priceFeed.getAddress(),
    await sequencerFeed.getAddress(),
    feeRecipient.address
  );

  const SimpleLendingStrategy = await ethers.getContractFactory('SimpleLendingStrategy');
  const strategy = await SimpleLendingStrategy.deploy(
    await vault.getAddress(),
    await token.getAddress(),
    await lendingPool.getAddress()
  );

  await vault.setStrategy(await strategy.getAddress());

  // The strategy needs to approve the lending pool to pull aTokens during withdraw
  // (in our mock the pool uses transferFrom on burn). Bootstrap that approval.
  // In a real Aave integration this isn't needed because aTokens are burned in-place.
  const aTokenAddr = await lendingPool.getATokenAddress(await token.getAddress());
  const aToken = await ethers.getContractAt('MockERC20', aTokenAddr);
  // We need to give the strategy the ability to approve the lending pool to pull aTokens.
  // Easiest path: do it from inside the test by impersonating the strategy address.
  await ethers.provider.send('hardhat_impersonateAccount', [await strategy.getAddress()]);
  await ethers.provider.send('hardhat_setBalance', [
    await strategy.getAddress(),
    '0x' + (10n ** 18n).toString(16),
  ]);
  const stratSigner = await ethers.getSigner(await strategy.getAddress());
  await aToken.connect(stratSigner).approve(await lendingPool.getAddress(), ethers.MaxUint256);
  await ethers.provider.send('hardhat_stopImpersonatingAccount', [await strategy.getAddress()]);

  // Fund users
  for (const user of [alice, bob]) {
    await token.mint(user.address, ethers.parseEther('1000'));
    await token.connect(user).approve(await vault.getAddress(), ethers.MaxUint256);
  }

  return { vault, strategy, lendingPool, token, aToken, owner, alice, bob, feeRecipient };
}

describe('ArbitrumVault + SimpleLendingStrategy integration', function () {
  it('deposit then deployToStrategy then harvest then withdraw round-trip', async function () {
    const { vault, strategy, lendingPool, token, alice } = await deployFullStack();

    // Alice deposits
    await vault.connect(alice).deposit(ethers.parseEther('10'));
    expect(await vault.totalAssets()).to.equal(ethers.parseEther('10'));

    // Owner deploys to strategy
    await vault.deployToStrategy(ethers.parseEther('10'));
    expect(await strategy.balanceOf()).to.equal(ethers.parseEther('10'));

    // Simulate yield: lending pool mints 1 ETH of aTokens to strategy
    await lendingPool.mockYield(await strategy.getAddress(), ethers.parseEther('1'));

    // Harvest
    await vault.harvest();
    // 15% of 1 ETH = 0.15 ETH fee, 0.85 ETH added to totalAssets
    expect(await vault.totalAssets()).to.equal(ethers.parseEther('10.85'));

    // Alice withdraws all her shares after delay
    await ethers.provider.send('evm_increaseTime', [86401]);
    await ethers.provider.send('evm_mine', []);

    const aliceShares = await vault.shares(alice.address);
    const balBefore = await token.balanceOf(alice.address);

    // Withdraw needs underlying back from the strategy first
    await vault.withdrawFromStrategy(await strategy.balanceOf());
    await vault.connect(alice).withdraw(aliceShares);

    const received = (await token.balanceOf(alice.address)) - balBefore;
    // She should receive ~10.85 - 0.5% withdrawal fee = ~10.79 ETH
    expect(received).to.be.greaterThan(ethers.parseEther('10.7'));
    expect(received).to.be.lessThan(ethers.parseEther('10.86'));
  });

  it('emergencyWithdraw drains strategy and pauses', async function () {
    const { vault, strategy, lendingPool, token, owner, alice } = await deployFullStack();

    await vault.connect(alice).deposit(ethers.parseEther('10'));
    await vault.deployToStrategy(ethers.parseEther('10'));
    await lendingPool.mockYield(await strategy.getAddress(), ethers.parseEther('1'));

    const ownerBalBefore = await token.balanceOf(owner.address);
    await vault.emergencyWithdraw();
    const ownerBalAfter = await token.balanceOf(owner.address);

    expect(ownerBalAfter - ownerBalBefore).to.equal(ethers.parseEther('11'));
    expect(await vault.paused()).to.equal(true);
    expect(await vault.emergencyMode()).to.equal(true);
  });

  it('rejects strategy deposit when paused', async function () {
    const { vault, alice } = await deployFullStack();
    await vault.connect(alice).deposit(ethers.parseEther('10'));
    await vault.pause();
    await expect(vault.deployToStrategy(ethers.parseEther('5'))).to.be.revertedWith('Paused');
  });

  it('non-vault address cannot call strategy.deposit/withdraw/harvest', async function () {
    const { strategy, alice } = await deployFullStack();
    await expect(strategy.connect(alice).deposit(1n)).to.be.revertedWithCustomError(strategy, 'NotVault');
    await expect(strategy.connect(alice).withdraw(1n)).to.be.revertedWithCustomError(strategy, 'NotVault');
    await expect(strategy.connect(alice).harvest()).to.be.revertedWithCustomError(strategy, 'NotVault');
  });
});
