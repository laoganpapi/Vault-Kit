const { expect } = require('chai');
const { ethers } = require('hardhat');

const PRICE_8_DECIMALS = 2000n * 10n ** 8n;

async function deploy() {
  const [owner, ...users] = await ethers.getSigners();
  const feeRecipient = users[users.length - 1];
  const accounts = users.slice(0, 5);

  const MockERC20 = await ethers.getContractFactory('MockERC20');
  const token = await MockERC20.deploy('Mock', 'MOCK', 18);

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

  // Bump cap to allow large fuzz amounts
  await vault.setDepositCap(ethers.parseEther('10000'));

  for (const a of accounts) {
    await token.mint(a.address, ethers.parseEther('1000'));
    await token.connect(a).approve(await vault.getAddress(), ethers.MaxUint256);
  }

  return { vault, token, owner, accounts };
}

/// Sums shares across the in-test users; the dead-share account isn't used in
/// this contract since virtual offset replaced DEAD_SHARES.
async function sumUserShares(vault, accounts) {
  let total = 0n;
  for (const a of accounts) {
    total += await vault.shares(a.address);
  }
  return total;
}

describe('Vault invariants (property tests)', function () {
  it('totalShares == sum of all user shares (after random ops)', async function () {
    const { vault, accounts } = await deploy();
    // Random sequence of deposits
    const seed = [3n, 1n, 4n, 1n, 5n, 9n, 2n, 6n, 5n, 3n];
    for (let i = 0; i < seed.length; i++) {
      const user = accounts[i % accounts.length];
      const amount = seed[i] * ethers.parseEther('1');
      await vault.connect(user).deposit(amount);
      // Invariant after every op
      const sumShares = await sumUserShares(vault, accounts);
      expect(sumShares).to.equal(await vault.totalShares());
    }
  });

  it('totalAssets == on-chain token balance held by vault', async function () {
    const { vault, token, accounts } = await deploy();
    for (let i = 0; i < 5; i++) {
      await vault.connect(accounts[i]).deposit(ethers.parseEther('5'));
      expect(await vault.totalAssets()).to.equal(await token.balanceOf(await vault.getAddress()));
    }
  });

  it('share price is monotonically non-decreasing under deposit-only ops', async function () {
    const { vault, accounts } = await deploy();
    let lastPrice = await vault.sharePrice();
    for (let i = 0; i < 10; i++) {
      const user = accounts[i % accounts.length];
      await vault.connect(user).deposit(ethers.parseEther('1'));
      const newPrice = await vault.sharePrice();
      expect(newPrice).to.be.greaterThanOrEqual(lastPrice - 1n);
      lastPrice = newPrice;
    }
  });

  it('previewDeposit(amount) approximately equals actual minted shares', async function () {
    const { vault, accounts } = await deploy();
    // Bootstrap pool
    await vault.connect(accounts[0]).deposit(ethers.parseEther('5'));

    const amount = ethers.parseEther('1');
    const preview = await vault.previewDeposit(amount);
    const sharesBefore = await vault.shares(accounts[1].address);
    await vault.connect(accounts[1]).deposit(amount);
    const sharesAfter = await vault.shares(accounts[1].address);
    const actualMinted = sharesAfter - sharesBefore;
    // Allow 1 wei rounding tolerance
    const diff = preview > actualMinted ? preview - actualMinted : actualMinted - preview;
    expect(diff).to.be.lessThanOrEqual(1n);
  });

  it('previewWithdraw(shares) approximately equals actual withdrawn assets', async function () {
    const { vault, token, accounts } = await deploy();
    await vault.connect(accounts[0]).deposit(ethers.parseEther('10'));

    await ethers.provider.send('evm_increaseTime', [86401]);
    await ethers.provider.send('evm_mine', []);

    const userShares = await vault.shares(accounts[0].address);
    const half = userShares / 2n;
    const preview = await vault.previewWithdraw(half);

    const balBefore = await token.balanceOf(accounts[0].address);
    await vault.connect(accounts[0]).withdraw(half);
    const received = (await token.balanceOf(accounts[0].address)) - balBefore;

    const diff = preview > received ? preview - received : received - preview;
    expect(diff).to.be.lessThanOrEqual(1n);
  });
});

describe('Vault fuzz (random sequences)', function () {
  it('no user can withdraw more than they deposited (after fees)', async function () {
    const { vault, token, accounts } = await deploy();

    // Each account deposits a random amount, then withdraws all
    const RNG = (() => {
      let s = 12345;
      return () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s;
      };
    })();

    for (let trial = 0; trial < 10; trial++) {
      const user = accounts[trial % accounts.length];
      const amountWei = BigInt(RNG() % 1000) * ethers.parseEther('0.01') + ethers.parseEther('0.01');
      const balBefore = await token.balanceOf(user.address);

      await vault.connect(user).deposit(amountWei);
      const userShares = await vault.shares(user.address);

      await ethers.provider.send('evm_increaseTime', [86401]);
      await ethers.provider.send('evm_mine', []);

      await vault.connect(user).withdraw(userShares);
      const balAfter = await token.balanceOf(user.address);

      // User should have at most what they started with (no profit possible without yield)
      // and within 1% of what they deposited (only the withdrawal fee should be missing)
      expect(balAfter).to.be.lessThanOrEqual(balBefore);
      // Net loss should not exceed 2% (0.5% withdraw fee + virtual-offset dust + rounding)
      const lost = balBefore - balAfter;
      const maxAcceptableLoss = (amountWei * 200n) / 10000n + 100n; // 2% + 100 wei dust
      expect(lost).to.be.lessThanOrEqual(maxAcceptableLoss);
    }
  });

  it('cannot deposit when emergencyMode is set', async function () {
    const { vault, accounts } = await deploy();
    await vault.setEmergencyMode(true);
    await expect(vault.connect(accounts[0]).deposit(ethers.parseEther('1'))).to.be.revertedWith('Emergency mode');
  });
});
