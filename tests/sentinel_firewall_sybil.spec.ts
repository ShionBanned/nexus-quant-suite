import { describe, it, expect, beforeEach } from 'vitest';
import { SentinelPreTradeFirewall, TokenSecurityMetadata, WalletClusterInfo } from '../src/engine_a_sentinel/sybil_and_contract_fw.js';
import { SentinelPurgeRotator } from '../src/engine_a_sentinel/purge_rotator_6h.js';
import { SentinelPhasedEntryRouter, WalletTradeSignal } from '../src/engine_a_sentinel/phased_entry_router.js';
import { SentinelAsymmetricExitManager, SentinelPosition, WhaleSellEvent } from '../src/engine_a_sentinel/whale_asymmetric_exit.js';
import { NexusDatabase } from '../src/core/db_sqlite_wal.js';

describe('FASE 2: Motor A - Sentinel Quant (Confluencia On-Chain & Purge Engine)', () => {
  describe('Firewall Pre-Trade (< 150ms) y Filtros Anti-Fraude', () => {
    let firewall: SentinelPreTradeFirewall;

    beforeEach(() => {
      firewall = new SentinelPreTradeFirewall();
    });

    const defaultMetadata: TokenSecurityMetadata = {
      tokenAddress: 'TOKEN_CLEAN_123',
      poolLiquidityMicroUsd: 100_000_000_000n, // $100k
      mintAuthorityRevoked: true,
      freezeAuthorityRevoked: true,
      top10HoldersShareBps: 1800n, // 18.00% <= 2200 bps
      buyTaxBps: 50n, // 0.5%
      sellTaxBps: 50n, // 0.5%
      honeypotSimulationSuccess: true,
      rpcLatencyMs: 45 // < 150ms
    };

    const cleanCluster: WalletClusterInfo = {
      tokenAddress: 'TOKEN_CLEAN_123',
      wallets: [
        { address: 'WALLET_ALPHA', fundingRootHash: 'ROOT_001' },
        { address: 'WALLET_BETA', fundingRootHash: 'ROOT_002' },
        { address: 'WALLET_GAMMA', fundingRootHash: 'ROOT_003' }
      ],
      totalPlannedOrderMicroUsd: 2_000_000_000n // $2,000 USD
    };

    it('aprueba un token legítimo con raíces disjuntas, LP >= 40x y simulación exitosa', () => {
      const decision = firewall.evaluate(cleanCluster, defaultMetadata);
      expect(decision.passed).toBe(true);
      expect(decision.rejectReason).toBeUndefined();
    });

    it('bloquea inmediatamente un ataque Sybil si las billeteras comparten raíz de fondeo', () => {
      const sybilCluster: WalletClusterInfo = {
        tokenAddress: 'TOKEN_SYBIL',
        wallets: [
          { address: 'WALLET_ALPHA', fundingRootHash: 'SHARED_PARENT_BINANCE_HOT' },
          { address: 'WALLET_CLONE_1', fundingRootHash: 'SHARED_PARENT_BINANCE_HOT' } // MISMA RAÍZ
        ],
        totalPlannedOrderMicroUsd: 2_000_000_000n
      };

      const decision = firewall.evaluate(sybilCluster, defaultMetadata);
      expect(decision.passed).toBe(false);
      expect(decision.rejectReason).toContain('REJECT_SYBIL_SHARED_FUNDING_ROOT');
    });

    it('rechaza contratos Honeypot donde la simulación de venta revierte', () => {
      const honeypotMetadata: TokenSecurityMetadata = {
        ...defaultMetadata,
        honeypotSimulationSuccess: false // Reversión en contrato
      };

      const decision = firewall.evaluate(cleanCluster, honeypotMetadata);
      expect(decision.passed).toBe(false);
      expect(decision.rejectReason).toContain('REJECT_HONEYPOT_DETECTED');
    });

    it('rechaza tokens con liquidez de pool insuficiente (< 40x de la orden total)', () => {
      const lowLpMetadata: TokenSecurityMetadata = {
        ...defaultMetadata,
        // Orden total = $2,000 USD. 40x = $80,000 USD (80_000_000_000 uUSD).
        poolLiquidityMicroUsd: 50_000_000_000n // Solo $50,000 USD < 40x
      };

      const decision = firewall.evaluate(cleanCluster, lowLpMetadata);
      expect(decision.passed).toBe(false);
      expect(decision.rejectReason).toContain('REJECT_INSUFFICIENT_LP_DEPTH');
    });

    it('rechaza tokens con autoridades de Mint o Freeze activas', () => {
      const mintActiveMeta: TokenSecurityMetadata = {
        ...defaultMetadata,
        mintAuthorityRevoked: false
      };
      expect(firewall.evaluate(cleanCluster, mintActiveMeta).passed).toBe(false);

      const freezeActiveMeta: TokenSecurityMetadata = {
        ...defaultMetadata,
        freezeAuthorityRevoked: false
      };
      expect(firewall.evaluate(cleanCluster, freezeActiveMeta).passed).toBe(false);
    });

    it('aplica política Default Deny si el nodo RPC tarda más de 150 ms', () => {
      const slowMeta: TokenSecurityMetadata = {
        ...defaultMetadata,
        rpcLatencyMs: 165 // > 150ms
      };

      const decision = firewall.evaluate(cleanCluster, slowMeta);
      expect(decision.passed).toBe(false);
      expect(decision.rejectReason).toContain('REJECT_RPC_LATENCY_TIMEOUT');
    });
  });

  describe('Pool Dinámico de 50 Billeteras y Rotador Automático (6h)', () => {
    let db: NexusDatabase;
    let rotator: SentinelPurgeRotator;

    beforeEach(() => {
      db = new NexusDatabase(':memory:');
      rotator = new SentinelPurgeRotator(db);
    });

    it('degrada billeteras LIVE con PF < 1.40 o 3 pérdidas seguidas y asciende líderes de SHADOW (PF >= 1.75)', () => {
      // Sembrar 10 LIVE y 40 SHADOW
      const initialWallets: any[] = [];

      // 8 LIVE saludables (PF 2.00 = 2000)
      for (let i = 1; i <= 8; i++) {
        initialWallets.push({
          wallet_address: `LIVE_GOOD_${i}`,
          chain_id: 'SOLANA',
          pool_tier: 'LIVE',
          win_rate_bps: 6500n,
          profit_factor_scaled: 2000n,
          consecutive_losses: 0,
          trades_count_7d: 15,
          funding_root_hash: `ROOT_LIVE_${i}`
        });
      }

      // 1 LIVE degradada por PF bajo (PF 1.20 = 1200 < 1400)
      initialWallets.push({
        wallet_address: 'LIVE_BAD_PF',
        chain_id: 'SOLANA',
        pool_tier: 'LIVE',
        win_rate_bps: 4000n,
        profit_factor_scaled: 1200n,
        consecutive_losses: 1,
        trades_count_7d: 12,
        funding_root_hash: 'ROOT_LIVE_BAD1'
      });

      // 1 LIVE degradada por 3 pérdidas consecutivas
      initialWallets.push({
        wallet_address: 'LIVE_3_LOSSES',
        chain_id: 'SOLANA',
        pool_tier: 'LIVE',
        win_rate_bps: 5000n,
        profit_factor_scaled: 1600n,
        consecutive_losses: 3,
        trades_count_7d: 10,
        funding_root_hash: 'ROOT_LIVE_BAD2'
      });

      // 40 SHADOW: 2 líderes con PF >= 1.75 y 38 estándar
      initialWallets.push({
        wallet_address: 'SHADOW_LEADER_1',
        chain_id: 'SOLANA',
        pool_tier: 'SHADOW',
        win_rate_bps: 7000n,
        profit_factor_scaled: 2500n, // Líder #1
        consecutive_losses: 0,
        trades_count_7d: 20,
        funding_root_hash: 'ROOT_SHAD_1'
      });

      initialWallets.push({
        wallet_address: 'SHADOW_LEADER_2',
        chain_id: 'SOLANA',
        pool_tier: 'SHADOW',
        win_rate_bps: 6800n,
        profit_factor_scaled: 2200n, // Líder #2
        consecutive_losses: 0,
        trades_count_7d: 18,
        funding_root_hash: 'ROOT_SHAD_2'
      });

      for (let i = 3; i <= 40; i++) {
        initialWallets.push({
          wallet_address: `SHADOW_REGULAR_${i}`,
          chain_id: 'SOLANA',
          pool_tier: 'SHADOW',
          win_rate_bps: 5500n,
          profit_factor_scaled: 1500n,
          consecutive_losses: 1,
          trades_count_7d: 8,
          funding_root_hash: `ROOT_SHAD_${i}`
        });
      }

      rotator.seedInitialPool(initialWallets);

      // Ejecutar ciclo de rotación
      const res = rotator.executeRotationCycle();

      expect(res.demotedCount).toBe(2);
      expect(res.demotedWallets).toContain('LIVE_BAD_PF');
      expect(res.demotedWallets).toContain('LIVE_3_LOSSES');
      expect(res.promotedCount).toBe(2);
      expect(res.promotedWallets).toContain('SHADOW_LEADER_1');
      expect(res.promotedWallets).toContain('SHADOW_LEADER_2');
      expect(res.activeLiveCount).toBe(10); // Exactamente 10 LIVE mantenidas
    });
  });

  describe('Máquina de Estados de Entrada en 2 Fases (Ventana 15m)', () => {
    let router: SentinelPhasedEntryRouter;
    const t0 = 1_000_000n;

    beforeEach(() => {
      router = new SentinelPhasedEntryRouter();
    });

    it('gestiona la transición Billetera 1 (WATCHING), Billetera 2 (25%) y Billetera 3 (75% a mercado)', () => {
      // 1. Billetera #1 compra a $100.00
      const sig1: WalletTradeSignal = {
        walletAddress: 'WALLET_1',
        tokenAddress: 'TOKEN_ABC',
        tokenTicker: 'ABC',
        priceMicroUsd: 100_000_000n,
        timestampMs: t0
      };
      const cmd1 = router.processSignal(sig1);
      expect(cmd1.status).toBe('WATCHING');
      expect(cmd1.allocationBps).toBe(0n);

      // 2. Billetera #2 compra a $105.00 (+5.0% = 500 bps <= 800 bps)
      const sig2: WalletTradeSignal = {
        walletAddress: 'WALLET_2',
        tokenAddress: 'TOKEN_ABC',
        tokenTicker: 'ABC',
        priceMicroUsd: 105_000_000n,
        timestampMs: t0 + 60_000n
      };
      const cmd2 = router.processSignal(sig2);
      expect(cmd2.status).toBe('PHASE1_25PCT');
      expect(cmd2.allocationBps).toBe(2500n); // 25% del cupo
      expect(cmd2.type).toBe('MARKET_BUY');

      // 3. Billetera #3 compra a $110.00 (+10.0% = 1000 bps <= 1200 bps)
      const sig3: WalletTradeSignal = {
        walletAddress: 'WALLET_3',
        tokenAddress: 'TOKEN_ABC',
        tokenTicker: 'ABC',
        priceMicroUsd: 110_000_000n,
        timestampMs: t0 + 120_000n
      };
      const cmd3 = router.processSignal(sig3);
      expect(cmd3.status).toBe('PHASE2_100PCT');
      expect(cmd3.allocationBps).toBe(7500n); // 75% restante
      expect(cmd3.type).toBe('MARKET_BUY');
    });

    it('prohíbe compra a mercado y coloca orden límite en retroceso Fibonacci 38.2% si delta > 1200 bps', () => {
      // Billetera #1 compra a $100.00
      router.processSignal({
        walletAddress: 'WALLET_1',
        tokenAddress: 'TOKEN_HOT',
        tokenTicker: 'HOT',
        priceMicroUsd: 100_000_000n,
        timestampMs: t0
      });

      // Billetera #2 compra a $106.00 (+6% <= 8%)
      router.processSignal({
        walletAddress: 'WALLET_2',
        tokenAddress: 'TOKEN_HOT',
        tokenTicker: 'HOT',
        priceMicroUsd: 106_000_000n,
        timestampMs: t0 + 50_000n
      });

      // Billetera #3 compra a $118.00 (+18% = 1800 bps > 1200 bps)
      const cmd3 = router.processSignal({
        walletAddress: 'WALLET_3',
        tokenAddress: 'TOKEN_HOT',
        tokenTicker: 'HOT',
        priceMicroUsd: 118_000_000n,
        timestampMs: t0 + 100_000n
      });

      expect(cmd3.status).toBe('PULLBACK_WAIT');
      expect(cmd3.type).toBe('LIMIT_PULLBACK_BUY');
      expect(cmd3.allocationBps).toBe(7500n);
      // Impulso $100 -> $118. Retroceso 38.2% de 18 = 6.876 -> $111.124
      // 118_000_000 - (18_000_000 * 3820 / 10000) = 118_000_000 - 6_876_000 = 111_124_000
      expect(cmd3.priceMicroUsd).toBe(111_124_000n);
    });
  });

  describe('Salida Asimétrica, De-Risk, Moonbag y Front-Run Defensivo', () => {
    let exitManager: SentinelAsymmetricExitManager;
    const t0 = 1_000_000n;

    beforeEach(() => {
      exitManager = new SentinelAsymmetricExitManager();
    });

    const createPosition = (): SentinelPosition => ({
      positionId: 'POS_001',
      tokenAddress: 'TOKEN_XYZ',
      tokenTicker: 'XYZ',
      entryPriceMicroUsd: 100_000_000n, // $100.00
      peakPriceMicroUsd: 100_000_000n,
      totalTokensAtomic: 10_000_000_000n, // 10 tokens
      remainingTokensAtomic: 10_000_000_000n,
      openedAtMs: t0,
      isDeRisked: false,
      isClosed: false
    });

    it('ejecuta Hard Stop si el precio cae <= -8.0% (-800 bps)', () => {
      const pos = createPosition();
      const pDrop = 91_500_000n; // $91.50 = -8.5% (-850 bps)
      const res = exitManager.evaluatePriceTick(pos, pDrop, t0 + 60_000n);

      expect(res.action).toBe('HARD_STOP');
      expect(res.tokensToSellAtomic).toBe(10_000_000_000n);
    });

    it('ejecuta Time-Stop tras 12 minutos si la ganancia no supera +4.0% (+400 bps)', () => {
      const pos = createPosition();
      const pStagnant = 102_000_000n; // $102.00 (+2.0% < +4.0%)
      const twelveMinLater = t0 + 721_000n; // > 12 min (720,000ms)
      const res = exitManager.evaluatePriceTick(pos, pStagnant, twelveMinLater);

      expect(res.action).toBe('TIME_STOP');
      expect(res.tokensToSellAtomic).toBe(10_000_000_000n);
    });

    it('ejecuta De-Risk al tocar +35.0% (+3500 bps) vendiendo 75% para recuperar 100% de capital', () => {
      const pos = createPosition();
      const pTarget = 136_000_000n; // $136.00 (+36% >= +35%)
      const res = exitManager.evaluatePriceTick(pos, pTarget, t0 + 300_000n);

      expect(res.action).toBe('DERISK_75PCT');
      expect(res.tokensToSellAtomic).toBe(7_500_000_000n); // 75% de 10 tokens

      // Marcar posición como de-risked con el 25% remanente (Moonbag)
      pos.isDeRisked = true;
      pos.remainingTokensAtomic = 2_500_000_000n;
      pos.peakPriceMicroUsd = 150_000_000n; // Precio pico alcanzó $150.00

      // Caída del 15% desde $150.00 = $127.50 (127_500_000 uUSD)
      const pPullback = 126_000_000n; // Cayó a $126.00
      const trailingRes = exitManager.evaluatePriceTick(pos, pPullback, t0 + 500_000n);
      expect(trailingRes.action).toBe('MOONBAG_TRAILING_STOP');
      expect(trailingRes.tokensToSellAtomic).toBe(2_500_000_000n);
    });

    it('ejecuta Front-Running defensivo con prioridad de gas si una ballena del pool vende >= 30%', () => {
      const pos = createPosition();
      const whaleEvent: WhaleSellEvent = {
        walletAddress: 'WHALE_ALPHA',
        tokenAddress: 'TOKEN_XYZ',
        tokensSoldAtomic: 350_000_000n,
        walletInitialPositionAtomic: 1_000_000_000n, // Vendió 35% (3500 bps >= 3000 bps)
        timestampMs: t0 + 100_000n
      };

      const res = exitManager.evaluateWhaleActivity(pos, whaleEvent, 120_000_000n);
      expect(res.action).toBe('WHALE_FRONTRUN_EXIT');
      expect(res.tokensToSellAtomic).toBe(pos.remainingTokensAtomic);
      expect(res.isGasPriority).toBe(true); // Prioridad de gas defensiva
    });
  });
});
