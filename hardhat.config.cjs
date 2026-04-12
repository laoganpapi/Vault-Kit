// CommonJS hardhat config so it doesn't conflict with the existing TypeScript build.
// We only use hardhat for compiling and testing the Solidity contracts in contracts/src/.
require('@nomicfoundation/hardhat-toolbox');

module.exports = {
  solidity: {
    version: '0.8.20',
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  paths: {
    sources: './contracts/src',
    tests: './contracts/test-hh',
    cache: './contracts/cache',
    artifacts: './contracts/artifacts',
  },
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
    },
  },
  mocha: {
    timeout: 60000,
  },
};
