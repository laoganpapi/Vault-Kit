// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library Constants {
    // ─── Tokens ───
    address internal constant USDC = 0xaf88d065e77c8cC2239327C5EDb3A432268e5831;
    address internal constant WETH = 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1;
    address internal constant WSTETH = 0x5979D7b546E38E414F7E9822514be443A4800529;
    address internal constant ARB = 0x912CE59144191C1204E64559FE8253a0e49E6548;

    // ─── Aave V3 ───
    address internal constant AAVE_POOL = 0x794a61358D6845594F94dc1DB02A252b5b4814aD;
    address internal constant AAVE_REWARDS = 0x929EC64c34a17401F460460D4B9390518E5B473e;
    address internal constant AAVE_AUSDC = 0x625E7708f30cA75bfd92586e17077590C60eb4cD;
    address internal constant AAVE_VARIABLE_DEBT_USDC = 0xFCCf3cAbbe80101232d343252614b6A3eE81C989;

    // ─── GMX V2 ───
    address internal constant GMX_EXCHANGE_ROUTER = 0x7C68C7866A64FA2160F78EEaE12217FFbf871fa8;
    address internal constant GMX_ROUTER = 0x7452c558d45f8afC8c83dAe62C3f8A5BE19c71f6;
    address internal constant GMX_DATA_STORE = 0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8;
    address internal constant GMX_READER = 0xf60becbba223EEA9495Da3f606753867eC10d139;
    address internal constant GMX_DEPOSIT_VAULT = 0xF89e77e8Dc11691C9e8757e84aaFbCD8A67d7A55;
    address internal constant GMX_WITHDRAWAL_VAULT = 0x0628D46b5D145f183AdB6Ef1f2c97eD1C4701C55;

    // ─── Uniswap V3 (Arbitrum) ───
    address internal constant UNISWAP_ROUTER = 0xE592427A0AEce92De3Edee1F18E0157C05861564;

    // ─── Chainlink Feeds (Arbitrum) ───
    address internal constant CHAINLINK_ETH_USD = 0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612;
    address internal constant CHAINLINK_USDC_USD = 0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3;
    address internal constant CHAINLINK_WSTETH_ETH = 0xb523AE262D20A936BC152e6023996e46FDC2A95D;
    address internal constant CHAINLINK_ARB_USD = 0xb2A824043730FE05F3DA2efaFa1CBbe83fa548D6;
    address internal constant CHAINLINK_SEQUENCER_UPTIME = 0xFdB631F5EE196F0ed6FAa767959853A9F217697D;

    // ─── Vault Parameters ───
    uint256 internal constant MAX_BPS = 10_000;
    uint256 internal constant USDC_DECIMALS = 6;
    uint256 internal constant WAD = 1e18;
}
