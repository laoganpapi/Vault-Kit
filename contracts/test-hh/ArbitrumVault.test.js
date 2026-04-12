const { expect } = require('chai');
const { ethers } = require('hardhat');

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const PRICE_8_DECIMALS = 2000n * 10n ** 8n; // $2000 with 8 decimals (Chainlink convention)

async function deployFixture() {
  const [owner, alice, bob, attacker, feeRecipient] = await ethers.getSigners();

  const MockERC20 = await ethers.getContractFactory('MockERC20');
  const token = await MockERC20.deploy('Mock', 'MOCK', 18);

  const MockAggregator = await ethers.getContractFactory('MockAggregator');
  const priceFeed = await MockAggregator.deploy(PRICE_8_DECIMALS);
  const sequencerFeed = await MockAggregator.deploy(0n); // 0 = sequencer up

  // Advance past sequencer grace period (1 hour) BEFORE refreshing the price
  // so the price's updatedAt is fresh relative to the new block.timestamp.
  await ethers.provider.send('evm_increaseTime', [7200]);
  await ethers.provider.send('evm_mine', []);
  await priceFeed.setAnswer(PRICE_8_DECIMALS); // refresh updatedAt

  const ArbitrumVault = await ethers.getContractFactory('ArbitrumVault');
  const vault = await ArbitrumVault.deploy(
    'Vault Token',
    'vMOCK',
    await token.getAddress(),
    await priceFeed.getAddress(),
    await sequencerFeed.getAddress(),
    feeRecipient.address
  );

  // Fund users with 1000 each
  for (const user of [alice, bob, attacker]) {
    await token.mint(user.address, ethers.parseEther('1000'));
    await token.connect(user).approve(await vault.getAddress(), ethers.MaxUint256);
  }

  return { vault, token, priceFeed, sequencerFeed, owner, alice, bob, attacker, feeRecipient };
}

describe('ArbitrumVault', function () {
  // ============ Deposit / Withdraw ============

  describe('deposit / withdraw', function () {
    it('first depositor receives shares minted via virtual offset', async function () {
      const { vault, alice } = await deployFixture();
      await vault.connect(alice).deposit(ethers.parseEther('10'));

      const aliceShares = await vault.shares(alice.address);
      // With virtual offset (1e6 virtual shares, 1 virtual asset),
      // first deposit of 10e18 mints: 10e18 * (0 + 1e6) / (0 + 1) = 10e24 shares
      expect(aliceShares).to.equal(ethers.parseEther('10') * 10n ** 6n);
      expect(await vault.totalShares()).to.equal(aliceShares);
      expect(await vault.totalAssets()).to.equal(ethers.parseEther('10'));
    });

    it('second depositor receives proportional shares', async function () {
      const { vault, alice, bob } = await deployFixture();
      await vault.connect(alice).deposit(ethers.parseEther('10'));
      await vault.connect(bob).deposit(ethers.parseEther('10'));

      const aliceShares = await vault.shares(alice.address);
      const bobShares = await vault.shares(bob.address);
      // Bob should get nearly the same shares (within 1 wei due to rounding)
      const diff = aliceShares > bobShares ? aliceShares - bobShares : bobShares - aliceShares;
      expect(diff).to.be.lessThan(2n);
    });

    it('withdraw returns approximately the deposited amount minus fee', async function () {
      const { vault, alice, token } = await deployFixture();
      await vault.connect(alice).deposit(ethers.parseEther('10'));

      // Skip the withdrawal delay
      await ethers.provider.send('evm_increaseTime', [86401]);
      await ethers.provider.send('evm_mine', []);

      const aliceShares = await vault.shares(alice.address);
      const balBefore = await token.balanceOf(alice.address);
      await vault.connect(alice).withdraw(aliceShares);
      const received = (await token.balanceOf(alice.address)) - balBefore;

      // Should receive ~10 ether minus 0.5% fee = ~9.95 ether
      expect(received).to.be.greaterThan(ethers.parseEther('9.94'));
      expect(received).to.be.lessThan(ethers.parseEther('10.01'));
    });

    it('rejects withdraw before delay expires', async function () {
      const { vault, alice } = await deployFixture();
      await vault.connect(alice).deposit(ethers.parseEther('10'));

      const aliceShares = await vault.shares(alice.address);
      await expect(
        vault.connect(alice).withdraw(aliceShares)
      ).to.be.revertedWith('Withdrawal delay');
    });

    it('rejects deposit below minimum', async function () {
      const { vault, alice } = await deployFixture();
      await expect(
        vault.connect(alice).deposit(1)
      ).to.be.revertedWith('Below minimum');
    });

    it('rejects deposit when paused', async function () {
      const { vault, alice } = await deployFixture();
      await vault.pause();
      await expect(
        vault.connect(alice).deposit(ethers.parseEther('10'))
      ).to.be.revertedWith('Paused');
    });
  });

  // ============ Share Inflation Attack ============

  describe('share inflation attack defense', function () {
    it('virtual offset defeats first-depositor donation attack', async function () {
      const { vault, token, alice, attacker } = await deployFixture();

      // Step 1: attacker deposits the minimum
      await vault.connect(attacker).deposit(ethers.parseEther('0.01'));
      const attackerShares = await vault.shares(attacker.address);

      // Step 2: attacker donates a huge amount directly to inflate share price
      await token.connect(attacker).transfer(await vault.getAddress(), ethers.parseEther('100'));

      // Step 3: victim deposits 10 ETH
      await vault.connect(alice).deposit(ethers.parseEther('10'));
      const aliceShares = await vault.shares(alice.address);

      // Without protection, alice would get 0 shares (10e18 * 1 / 100e18 rounds to 0).
      // With virtual offset, alice gets ~10/100 of the existing supply, which is
      // a meaningful number of shares (orders of magnitude > 0).
      expect(aliceShares).to.be.greaterThan(0n);
      expect(aliceShares).to.be.greaterThan(ethers.parseEther('0.001'));

      // Crucially, when alice withdraws, she gets back AT LEAST 50% of her deposit
      // (the rest is "absorbed" into the donation, which the attacker gave away).
      // This means the attack COSTS the attacker 100 ETH and makes them no profit.
      await ethers.provider.send('evm_increaseTime', [86401]);
      await ethers.provider.send('evm_mine', []);

      const balBefore = await token.balanceOf(alice.address);
      await vault.connect(alice).withdraw(aliceShares);
      const received = (await token.balanceOf(alice.address)) - balBefore;
      expect(received).to.be.greaterThan(ethers.parseEther('5'));
    });
  });

  // ============ Fee-on-Transfer ============

  describe('fee-on-transfer token compatibility', function () {
    it('uses balance-diff measurement so totalAssets matches actual balance', async function () {
      const [owner, alice, , , feeRecipient] = await ethers.getSigners();

      const FoTToken = await ethers.getContractFactory('FoTToken');
      const fot = await FoTToken.deploy();

      const MockAggregator = await ethers.getContractFactory('MockAggregator');
      const priceFeed = await MockAggregator.deploy(PRICE_8_DECIMALS);
      const sequencerFeed = await MockAggregator.deploy(0n);
      await ethers.provider.send('evm_increaseTime', [7200]);
      await ethers.provider.send('evm_mine', []);

      const ArbitrumVault = await ethers.getContractFactory('ArbitrumVault');
      const vault = await ArbitrumVault.deploy(
        'FoT Vault', 'vFOT',
        await fot.getAddress(),
        await priceFeed.getAddress(),
        await sequencerFeed.getAddress(),
        feeRecipient.address
      );

      await fot.mint(alice.address, ethers.parseEther('100'));
      await fot.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256);

      await vault.connect(alice).deposit(ethers.parseEther('10'));

      // FoT token took 2% fee, so vault should have 9.8 ETH and totalAssets = 9.8
      expect(await vault.totalAssets()).to.equal(ethers.parseEther('9.8'));
      expect(await fot.balanceOf(await vault.getAddress())).to.equal(ethers.parseEther('9.8'));
    });
  });

  // ============ Oracle ============

  describe('oracle validation', function () {
    it('reverts on stale oracle', async function () {
      const { vault, priceFeed } = await deployFixture();
      // Freeze updatedAt then advance time
      await priceFeed.setStale();
      await ethers.provider.send('evm_increaseTime', [7200]);
      await ethers.provider.send('evm_mine', []);
      await expect(vault.getAssetPrice()).to.be.revertedWith('Oracle: stale price');
    });

    it('reverts on zero/negative price', async function () {
      const { vault, priceFeed } = await deployFixture();
      await priceFeed.setAnswer(0);
      await expect(vault.getAssetPrice()).to.be.revertedWith('Oracle: invalid price');

      await priceFeed.setAnswer(-1);
      await expect(vault.getAssetPrice()).to.be.revertedWith('Oracle: invalid price');
    });

    it('reverts when sequencer is down', async function () {
      const { vault, sequencerFeed } = await deployFixture();
      await sequencerFeed.setAnswer(1n); // 1 = sequencer DOWN
      // Bypass grace period — the down state itself reverts
      await expect(vault.getAssetPrice()).to.be.revertedWith('Sequencer down');
    });

    it('returns valid price under normal conditions', async function () {
      const { vault } = await deployFixture();
      const price = await vault.getAssetPrice();
      expect(price).to.equal(PRICE_8_DECIMALS);
    });
  });

  // ============ Access Control ============

  describe('access control', function () {
    it('pause requires guardian or owner', async function () {
      const { vault, alice } = await deployFixture();
      await expect(vault.connect(alice).pause()).to.be.revertedWith('Not guardian');
      await vault.pause(); // owner can
      expect(await vault.paused()).to.equal(true);
    });

    it('setPerformanceFee enforces MAX_PERFORMANCE_FEE', async function () {
      const { vault } = await deployFixture();
      await expect(vault.setPerformanceFee(3001n)).to.be.revertedWith('Fee exceeds maximum');
      await vault.setPerformanceFee(2500n);
      expect(await vault.performanceFee()).to.equal(2500n);
    });

    it('setWithdrawalFee enforces MAX_WITHDRAWAL_FEE', async function () {
      const { vault } = await deployFixture();
      await expect(vault.setWithdrawalFee(501n)).to.be.revertedWith('Fee exceeds maximum');
      await vault.setWithdrawalFee(100n);
    });

    it('two-step ownership transfer', async function () {
      const { vault, owner, alice, bob } = await deployFixture();

      await vault.transferOwnership(alice.address);
      expect(await vault.pendingOwner()).to.equal(alice.address);
      expect(await vault.owner()).to.equal(owner.address);

      // Wrong account cannot accept
      await expect(vault.connect(bob).acceptOwnership()).to.be.revertedWith('Not pending owner');

      await vault.connect(alice).acceptOwnership();
      expect(await vault.owner()).to.equal(alice.address);
      expect(await vault.pendingOwner()).to.equal(ZERO_ADDRESS);
    });

    it('rejects zero-address fee recipient', async function () {
      const { vault } = await deployFixture();
      await expect(vault.setFeeRecipient(ZERO_ADDRESS)).to.be.revertedWith('Zero address');
    });
  });

  // ============ ERC-2612 permit ============

  describe('permit (ERC-2612)', function () {
    async function signPermit(vault, signer, spender, value, deadline) {
      const nonce = await vault.nonces(signer.address);
      const domain = {
        name: await vault.name(),
        version: '1',
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await vault.getAddress(),
      };
      const types = {
        Permit: [
          { name: 'owner', type: 'address' },
          { name: 'spender', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      };
      const message = {
        owner: signer.address,
        spender,
        value,
        nonce,
        deadline,
      };
      const sig = await signer.signTypedData(domain, types, message);
      return ethers.Signature.from(sig);
    }

    it('grants allowance via valid signature', async function () {
      const { vault, alice, bob } = await deployFixture();
      const value = ethers.parseEther('5');
      const deadline = (await ethers.provider.getBlock('latest')).timestamp + 3600;

      const sig = await signPermit(vault, alice, bob.address, value, deadline);
      await vault.permit(alice.address, bob.address, value, deadline, sig.v, sig.r, sig.s);

      expect(await vault.allowance(alice.address, bob.address)).to.equal(value);
      expect(await vault.nonces(alice.address)).to.equal(1n);
    });

    it('rejects expired permit', async function () {
      const { vault, alice, bob } = await deployFixture();
      const deadline = 1; // way in the past
      const sig = await signPermit(vault, alice, bob.address, 1n, deadline);
      await expect(
        vault.permit(alice.address, bob.address, 1n, deadline, sig.v, sig.r, sig.s)
      ).to.be.revertedWith('Permit expired');
    });

    it('rejects replayed permit (nonce increments)', async function () {
      const { vault, alice, bob } = await deployFixture();
      const value = ethers.parseEther('5');
      const deadline = (await ethers.provider.getBlock('latest')).timestamp + 3600;

      const sig = await signPermit(vault, alice, bob.address, value, deadline);
      await vault.permit(alice.address, bob.address, value, deadline, sig.v, sig.r, sig.s);

      // Replaying the same sig must fail because nonce has advanced
      await expect(
        vault.permit(alice.address, bob.address, value, deadline, sig.v, sig.r, sig.s)
      ).to.be.revertedWith('Invalid signature');
    });

    it('rejects malformed signature (zero address recovered)', async function () {
      const { vault, alice, bob } = await deployFixture();
      const deadline = (await ethers.provider.getBlock('latest')).timestamp + 3600;
      // Garbage v/r/s
      await expect(
        vault.permit(
          alice.address, bob.address, 1n, deadline,
          27, '0x' + '11'.repeat(32), '0x' + '22'.repeat(32)
        )
      ).to.be.revertedWith('Invalid signature');
    });
  });

  // ============ Share token ERC-20 surface ============

  describe('share-token transfer / approve / transferFrom', function () {
    it('transfer moves shares between accounts', async function () {
      const { vault, alice, bob } = await deployFixture();
      await vault.connect(alice).deposit(ethers.parseEther('10'));
      const aliceShares = await vault.shares(alice.address);
      await vault.connect(alice).transfer(bob.address, aliceShares / 2n);
      expect(await vault.shares(bob.address)).to.equal(aliceShares / 2n);
      expect(await vault.shares(alice.address)).to.equal(aliceShares - aliceShares / 2n);
    });

    it('transferFrom respects allowance', async function () {
      const { vault, alice, bob } = await deployFixture();
      await vault.connect(alice).deposit(ethers.parseEther('10'));
      const half = (await vault.shares(alice.address)) / 2n;
      await vault.connect(alice).approve(bob.address, half);
      await vault.connect(bob).transferFrom(alice.address, bob.address, half);
      expect(await vault.shares(bob.address)).to.equal(half);
      expect(await vault.allowance(alice.address, bob.address)).to.equal(0n);
    });
  });
});
