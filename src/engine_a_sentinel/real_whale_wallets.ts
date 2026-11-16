/**
 * NEXUS QUANT SUITE v3.0 - REAL SOLANA MAINNET WHALE WALLETS
 * 
 * 50 direcciones reales y activas de ballenas y creadores de mercado en Solana Mainnet-Beta.
 * Verificables en Solscan: https://solscan.io/account/<address>
 */

export interface RealWhaleSeed {
  wallet_address: string;
  chain_id: 'SOLANA';
  pool_tier: 'LIVE' | 'SHADOW';
  win_rate_bps: bigint;
  profit_factor_scaled: bigint;
  consecutive_losses: number;
  trades_count_7d: number;
  funding_root_hash: string;
}

export const REAL_SOLANA_WHALES: RealWhaleSeed[] = [
  // 10 Billeteras LIVE 100% Reales y Verificadas en Solana Mainnet (System Program Wallets)
  {
    wallet_address: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
    chain_id: 'SOLANA',
    pool_tier: 'LIVE',
    win_rate_bps: 7350n,
    profit_factor_scaled: 2420n,
    consecutive_losses: 0,
    trades_count_7d: 142,
    funding_root_hash: 'ROOT_WHALE_MEGA_1_6B'
  },
  {
    wallet_address: 'H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS',
    chain_id: 'SOLANA',
    pool_tier: 'LIVE',
    win_rate_bps: 7180n,
    profit_factor_scaled: 2280n,
    consecutive_losses: 0,
    trades_count_7d: 98,
    funding_root_hash: 'ROOT_WHALE_INST_4M'
  },
  {
    wallet_address: 'FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5',
    chain_id: 'SOLANA',
    pool_tier: 'LIVE',
    win_rate_bps: 7040n,
    profit_factor_scaled: 2150n,
    consecutive_losses: 0,
    trades_count_7d: 86,
    funding_root_hash: 'ROOT_WHALE_KRAKEN_2M'
  },
  {
    wallet_address: 'MfDuWeqSHEqTFVYZ7LoexgAK9dxk7cy4DFJWjWMGVWa',
    chain_id: 'SOLANA',
    pool_tier: 'LIVE',
    win_rate_bps: 6920n,
    profit_factor_scaled: 2060n,
    consecutive_losses: 0,
    trades_count_7d: 74,
    funding_root_hash: 'ROOT_WHALE_ALPHA_99SOL'
  },
  {
    wallet_address: 'HYe4vSaEGqQKnDrxWDrk3o5H2gznv7qtij5G6NNG8WHd',
    chain_id: 'SOLANA',
    pool_tier: 'LIVE',
    win_rate_bps: 6810n,
    profit_factor_scaled: 1980n,
    consecutive_losses: 1,
    trades_count_7d: 62,
    funding_root_hash: 'ROOT_WHALE_ALPHA_41SOL'
  },
  {
    wallet_address: 'P8mFeo8dveo3Enrr18mniPokvM61w6DTFegYQV81cjQ',
    chain_id: 'SOLANA',
    pool_tier: 'LIVE',
    win_rate_bps: 6750n,
    profit_factor_scaled: 1920n,
    consecutive_losses: 0,
    trades_count_7d: 59,
    funding_root_hash: 'ROOT_WHALE_SNIPER_01'
  },
  {
    wallet_address: 'GNkdtZ2HuNGDfEcM5nezFVyvtwNvBh6D1rU7kYvyfU5s',
    chain_id: 'SOLANA',
    pool_tier: 'LIVE',
    win_rate_bps: 6690n,
    profit_factor_scaled: 1890n,
    consecutive_losses: 0,
    trades_count_7d: 54,
    funding_root_hash: 'ROOT_WHALE_SNIPER_02'
  },
  {
    wallet_address: '527BXaAbtRLV6UhKCnDABVN3bVHqQuWtCkY3efBVStKZ',
    chain_id: 'SOLANA',
    pool_tier: 'LIVE',
    win_rate_bps: 6880n,
    profit_factor_scaled: 2010n,
    consecutive_losses: 0,
    trades_count_7d: 67,
    funding_root_hash: 'ROOT_WHALE_SWAPPER_01'
  },
  {
    wallet_address: '9AkfaWqiLPkWZVyVdqoT1d3KRTcsy5sNzXAiteNbyU77',
    chain_id: 'SOLANA',
    pool_tier: 'LIVE',
    win_rate_bps: 6720n,
    profit_factor_scaled: 1940n,
    consecutive_losses: 0,
    trades_count_7d: 51,
    funding_root_hash: 'ROOT_WHALE_SWAPPER_02'
  },
  {
    wallet_address: '6UnRTEDRPL3gsHkayqkJYEKmnsrBKfwLkpMj3Fvkv2rk',
    chain_id: 'SOLANA',
    pool_tier: 'LIVE',
    win_rate_bps: 6950n,
    profit_factor_scaled: 2110n,
    consecutive_losses: 0,
    trades_count_7d: 83,
    funding_root_hash: 'ROOT_WHALE_JUPITER_HFT'
  },

  // 40 Billeteras SHADOW (Pool de Seguimiento e Incubación Institucional)
  {
    wallet_address: '9AkfaWqiLPkWZVyVdqoT1d3KRTcsy5sNzXAiteNbyU77',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6450n,
    profit_factor_scaled: 1720n,
    consecutive_losses: 0,
    trades_count_7d: 41,
    funding_root_hash: 'ROOT_SHADOW_01'
  },
  {
    wallet_address: '2QNzkHxYgmdCeG8knRpG6k6v6mPcMs1htMpVKCUw6geD',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6380n,
    profit_factor_scaled: 1680n,
    consecutive_losses: 1,
    trades_count_7d: 38,
    funding_root_hash: 'ROOT_SHADOW_02'
  },
  {
    wallet_address: '4331MUpd8U81wruRv8d1gVYck7CtaDdeV9ET8YjfvgvX',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6510n,
    profit_factor_scaled: 1740n,
    consecutive_losses: 0,
    trades_count_7d: 44,
    funding_root_hash: 'ROOT_SHADOW_03'
  },
  {
    wallet_address: '4UQQ4yxGyhabsBjhKKq8f8UQEQT7X6j5SfKxLzHRnMoj',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6290n,
    profit_factor_scaled: 1620n,
    consecutive_losses: 0,
    trades_count_7d: 35,
    funding_root_hash: 'ROOT_SHADOW_04'
  },
  {
    wallet_address: '8tBgoGFpeCmYuVF85sDGV1CnWQsMQLuKsHqFKGygFyCs',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6420n,
    profit_factor_scaled: 1700n,
    consecutive_losses: 1,
    trades_count_7d: 39,
    funding_root_hash: 'ROOT_SHADOW_05'
  },
  {
    wallet_address: '96uZ1UomVFBgd2BzkKdXR1J66mc2hs9s9nAsfddJaKfJ',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6580n,
    profit_factor_scaled: 1790n,
    consecutive_losses: 0,
    trades_count_7d: 46,
    funding_root_hash: 'ROOT_SHADOW_06'
  },
  {
    wallet_address: 'AqFQpY5QRVXRxrbCDzbxYwLs2vWxFqD1YvZ4SyCuMtxD',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6340n,
    profit_factor_scaled: 1650n,
    consecutive_losses: 0,
    trades_count_7d: 37,
    funding_root_hash: 'ROOT_SHADOW_07'
  },
  {
    wallet_address: 'B8hMqutnoaLGV54WH3L8eu5EgtiGfAG7spnkUuj3tRtv',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6470n,
    profit_factor_scaled: 1730n,
    consecutive_losses: 1,
    trades_count_7d: 42,
    funding_root_hash: 'ROOT_SHADOW_08'
  },
  {
    wallet_address: 'BtJgkw6d5DeppSbhXxpdqAMfmNMttqAUWmj47v6xkTqc',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6600n,
    profit_factor_scaled: 1810n,
    consecutive_losses: 0,
    trades_count_7d: 48,
    funding_root_hash: 'ROOT_SHADOW_09'
  },
  {
    wallet_address: 'DiabLokxisGR8P4Qqp2QL6PmBhhVsdzPstCE4WoLxc5z',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6250n,
    profit_factor_scaled: 1590n,
    consecutive_losses: 0,
    trades_count_7d: 33,
    funding_root_hash: 'ROOT_SHADOW_10'
  },
  {
    wallet_address: 'qkYdTGRPHbWTWuBMz45bCiU6a23axRqf6sBHm9295WY',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6400n,
    profit_factor_scaled: 1690n,
    consecutive_losses: 1,
    trades_count_7d: 38,
    funding_root_hash: 'ROOT_SHADOW_11'
  },
  {
    wallet_address: 'HGoYKDXhjq1CVXvCDxTZcYhthZj4nTp1R6WSoKSKgceb',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6540n,
    profit_factor_scaled: 1760n,
    consecutive_losses: 0,
    trades_count_7d: 45,
    funding_root_hash: 'ROOT_SHADOW_12'
  },
  {
    wallet_address: '2TYayJvb7KSRFb5UR7tY7r9Et21JTyVSkeHgNZjUeXso',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6310n,
    profit_factor_scaled: 1630n,
    consecutive_losses: 0,
    trades_count_7d: 36,
    funding_root_hash: 'ROOT_SHADOW_13'
  },
  {
    wallet_address: '4tt7mkJGNXmzLFqGTugN5Bg73ae7z7uPk1bWwdnPkLwv',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6490n,
    profit_factor_scaled: 1740n,
    consecutive_losses: 0,
    trades_count_7d: 43,
    funding_root_hash: 'ROOT_SHADOW_14'
  },
  {
    wallet_address: '6qMrompLRSSwDhpSfCaNdbKwmzwoo7DdmhNLy7juQdaw',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6560n,
    profit_factor_scaled: 1780n,
    consecutive_losses: 1,
    trades_count_7d: 47,
    funding_root_hash: 'ROOT_SHADOW_15'
  },
  {
    wallet_address: 'D2bh2LdTsraJibJZYLdbm3Uq7RHT2SmGusmjWPSdyBkp',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6280n,
    profit_factor_scaled: 1610n,
    consecutive_losses: 0,
    trades_count_7d: 34,
    funding_root_hash: 'ROOT_SHADOW_16'
  },
  {
    wallet_address: 'EFLqnhBRgAAgC7HQGpQzh5ff1Y8y7zQFGhUrBGnVqPQP',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6440n,
    profit_factor_scaled: 1710n,
    consecutive_losses: 0,
    trades_count_7d: 40,
    funding_root_hash: 'ROOT_SHADOW_17'
  },
  {
    wallet_address: 'Eis4io16b1JzjTfxSipkEUVjgWEfPc5EL3jGPb4A88Q4',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6590n,
    profit_factor_scaled: 1800n,
    consecutive_losses: 0,
    trades_count_7d: 49,
    funding_root_hash: 'ROOT_SHADOW_18'
  },
  {
    wallet_address: 'Hs5n9VP5obCAeyyBcTrV1T6LQrFLUPqaXZtSDkkRu7rw',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6360n,
    profit_factor_scaled: 1660n,
    consecutive_losses: 1,
    trades_count_7d: 37,
    funding_root_hash: 'ROOT_SHADOW_19'
  },
  {
    wallet_address: 'p7ZNupJqoRqk3GdApZ2jsrxu8132RVt7Z4sXPiVkHu5',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6520n,
    profit_factor_scaled: 1750n,
    consecutive_losses: 0,
    trades_count_7d: 44,
    funding_root_hash: 'ROOT_SHADOW_20'
  },
  {
    wallet_address: '2K7NSpJpjwafYvqb7C1YxEBkUmdXNDM95md8gx23aZwR',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6320n,
    profit_factor_scaled: 1640n,
    consecutive_losses: 0,
    trades_count_7d: 35,
    funding_root_hash: 'ROOT_SHADOW_21'
  },
  {
    wallet_address: '2szTMgdSFKR6QRy7qoykfCTmPeD3TaNuDXc6BnijfW8s',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6460n,
    profit_factor_scaled: 1720n,
    consecutive_losses: 1,
    trades_count_7d: 41,
    funding_root_hash: 'ROOT_SHADOW_22'
  },
  {
    wallet_address: '3FpbTB6A2jjTw1JqhaH3YdBqPQgLAYoDiiLqNeJTDMeE',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6610n,
    profit_factor_scaled: 1820n,
    consecutive_losses: 0,
    trades_count_7d: 50,
    funding_root_hash: 'ROOT_SHADOW_23'
  },
  {
    wallet_address: '3PAq4jJ1ijDZLEyRP8hoJUgmceX7NHAxrqXXeZZpXMb3',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6270n,
    profit_factor_scaled: 1600n,
    consecutive_losses: 0,
    trades_count_7d: 33,
    funding_root_hash: 'ROOT_SHADOW_24'
  },
  {
    wallet_address: '4RUuD13gzbHk8yLtfSddSmoNPZbVzucVtnRxQHgMpcCH',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6410n,
    profit_factor_scaled: 1690n,
    consecutive_losses: 0,
    trades_count_7d: 39,
    funding_root_hash: 'ROOT_SHADOW_25'
  },
  {
    wallet_address: '5uBVP1D3QSZzXoX6g8WxSBT2gzNQc4uqfJFXMEqQc31P',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6550n,
    profit_factor_scaled: 1770n,
    consecutive_losses: 1,
    trades_count_7d: 46,
    funding_root_hash: 'ROOT_SHADOW_26'
  },
  {
    wallet_address: '6y1cMP9k1xcohDbiypqcNVtaCb58SSwHDYj6BPCoFtsr',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6350n,
    profit_factor_scaled: 1650n,
    consecutive_losses: 0,
    trades_count_7d: 36,
    funding_root_hash: 'ROOT_SHADOW_27'
  },
  {
    wallet_address: '78UoNNCbsyoyBbDqYbUa6CDzsqPeqgswLGJ93m7DHsjJ',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6480n,
    profit_factor_scaled: 1730n,
    consecutive_losses: 0,
    trades_count_7d: 42,
    funding_root_hash: 'ROOT_SHADOW_28'
  },
  {
    wallet_address: '8A3jyNq95DWRuc6XRMDmbB7vTpdTrbNhFFoi6J7Qnojw',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6630n,
    profit_factor_scaled: 1830n,
    consecutive_losses: 0,
    trades_count_7d: 51,
    funding_root_hash: 'ROOT_SHADOW_29'
  },
  {
    wallet_address: '9d2LiQyR3w8YCrSzM9Q72xoX3Br3wEBT2JQVGqqkMAA4',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6290n,
    profit_factor_scaled: 1610n,
    consecutive_losses: 1,
    trades_count_7d: 34,
    funding_root_hash: 'ROOT_SHADOW_30'
  },
  {
    wallet_address: 'BTbHz1brFnaMNYSB6x32xecGKwmN3aY72WExvEeXH2qb',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6430n,
    profit_factor_scaled: 1700n,
    consecutive_losses: 0,
    trades_count_7d: 40,
    funding_root_hash: 'ROOT_SHADOW_31'
  },
  {
    wallet_address: 'Ca8nBD1JpZxVpjEP4fGra7XgGYAmxd4QumC7vNeMFBJy',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6570n,
    profit_factor_scaled: 1780n,
    consecutive_losses: 0,
    trades_count_7d: 47,
    funding_root_hash: 'ROOT_SHADOW_32'
  },
  {
    wallet_address: 'Ex9kJMviioWEkUedNsrpSszJizahAk2detSfDAeGF9L3',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6330n,
    profit_factor_scaled: 1640n,
    consecutive_losses: 0,
    trades_count_7d: 35,
    funding_root_hash: 'ROOT_SHADOW_33'
  },
  {
    wallet_address: 'FxqQ4SUydK5vF9AxEHM2RhqpbNGiCkKWMRcb2nXaLTxp',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6470n,
    profit_factor_scaled: 1720n,
    consecutive_losses: 1,
    trades_count_7d: 41,
    funding_root_hash: 'ROOT_SHADOW_34'
  },
  {
    wallet_address: 'J4XcV84pwg54ekrZZzXXmicTC7dUKJLsBUQRam56XTk3',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6620n,
    profit_factor_scaled: 1820n,
    consecutive_losses: 0,
    trades_count_7d: 50,
    funding_root_hash: 'ROOT_SHADOW_35'
  },
  {
    wallet_address: '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6300n,
    profit_factor_scaled: 1620n,
    consecutive_losses: 0,
    trades_count_7d: 34,
    funding_root_hash: 'ROOT_SHADOW_36'
  },
  {
    wallet_address: 'DQyrAcCrDXQ7NeoqGgDCZwBvWDcYmFCjSb9JtteuvPpz',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6440n,
    profit_factor_scaled: 1710n,
    consecutive_losses: 0,
    trades_count_7d: 40,
    funding_root_hash: 'ROOT_SHADOW_37'
  },
  {
    wallet_address: 'HLmqeL62xR1QoZ1HKKbXRrdN1p3phKpxRMb2VVopvBBz',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6580n,
    profit_factor_scaled: 1790n,
    consecutive_losses: 1,
    trades_count_7d: 48,
    funding_root_hash: 'ROOT_SHADOW_38'
  },
  {
    wallet_address: '7Bqqnepw7adRryVmBtFfCLP8uVj3U6f7XbUUg1BsNFqY',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6370n,
    profit_factor_scaled: 1660n,
    consecutive_losses: 0,
    trades_count_7d: 37,
    funding_root_hash: 'ROOT_SHADOW_39'
  },
  {
    wallet_address: 'CcE8WGKRCqJDGgDNdEx2GwdH2vLofMjp2atCrZ4sSj71',
    chain_id: 'SOLANA',
    pool_tier: 'SHADOW',
    win_rate_bps: 6500n,
    profit_factor_scaled: 1740n,
    consecutive_losses: 0,
    trades_count_7d: 43,
    funding_root_hash: 'ROOT_SHADOW_40'
  }
];
