// tests/sentinel_v3_upgrades.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { SentinelConfluenceTracker } from '../src/engine_a_sentinel/confluence_tracker.js';
import { SmartPullbackSniper } from '../src/engine_a_sentinel/smart_pullback_sniper.js';
import { AdaptiveRvolTimeStop } from '../src/engine_a_sentinel/adaptive_rvol_time_stop.js';
import {
  SentinelPullbackIntentRepository,
  SqliteWalDatabaseDriver,
  SqliteWalStatement,
} from '../src/core/db_sqlite_wal.js';

class InMemorySqliteWalMock implements SqliteWalDatabaseDriver {
  public executedSql: string[] = [];
  private readonly store: Map<string, Record<string, unknown>> = new Map();

  public exec(sql: string): void {
    this.executedSql.push(sql);
  }

  public prepare(sql: string): SqliteWalStatement {
    const storeRef = this.store;
    return {
      run: (...params: unknown[]) => {
        if (sql.includes('INSERT INTO sentinel_pullback_intents')) {
          const id = String(params[0]);
          storeRef.set(id, {
            intent_id: params[0],
            token_symbol: params[1],
            token_mint: params[2],
            confluence_count: params[3],
            unique_funding_roots_json: params[4],
            pre_whale_price_micro_usd: params[5],
            peak_impact_price_micro_usd: params[6],
            limit_target_price_micro_usd: params[7],
            allocated_weight_bps: params[8],
            status: params[9],
            created_at_ms: params[10],
            expires_at_ms: params[11],
          });
        } else if (sql.includes('UPDATE sentinel_pullback_intents')) {
          if (params.length === 4) {
            const id = String(params[3]);
            const existing = storeRef.get(id);
            if (existing) {
              existing.status = params[0];
              existing.allocated_weight_bps = params[1];
              existing.confluence_count = params[2];
            }
          } else if (params.length === 2) {
            const id = String(params[1]);
            const existing = storeRef.get(id);
            if (existing) {
              existing.status = params[0];
            }
          }
        }
        return { changes: 1, lastInsertRowid: 1 };
      },
      get: (...params: unknown[]) => {
        const id = String(params[0]);
        return storeRef.get(id);
      },
      all: (...params: unknown[]) => {
        const mint = String(params[0]);
        return Array.from(storeRef.values()).filter((r) => r.token_mint === mint);
      },
    };
  }
}

describe('NEXUS v3.0 - FASE 1: Optimización Quintaesencial de Sentinel', () => {
  describe('1. SentinelConfluenceTracker (Smart Money Consensus & Anti-Sybil)', () => {
    let tracker: SentinelConfluenceTracker;

    beforeEach(() => {
      tracker = new SentinelConfluenceTracker();
    });

    it('asigna únicamente 25% (2500 bps) en compra aislada de 1 sola ballena LIVE', () => {
      const res = tracker.evaluateWhaleSignal({
        walletAddress: '0xWhale1',
        walletTier: 'LIVE',
        fundingRootAddress: '0xBinanceHot1',
        directInteractedWallets90d: [],
        tokenMint: 'So111_MINT_A',
        tokenSymbol: 'BONK',
        fillPriceMicroUsd: 1_000_000n, // $1.00
        timestampMs: 1_700_000_000_000n,
      });

      expect(res.action).toBe('OPEN_PROBE_25_PCT');
      expect(res.totalWeightBps).toBe(2500n);
      expect(res.incrementalWeightBps).toBe(2500n);
      expect(res.uniqueWhaleCount).toBe(1);
    });

    it('escala al 100% (10000 bps, +7500 bps incremental) cuando una 2da ballena LIVE independiente compra dentro de 180s', () => {
      const t0 = 1_700_000_000_000n;
      tracker.evaluateWhaleSignal({
        walletAddress: '0xWhale1',
        walletTier: 'LIVE',
        fundingRootAddress: '0xRootAlpha',
        directInteractedWallets90d: [],
        tokenMint: 'So111_MINT_A',
        tokenSymbol: 'WIF',
        fillPriceMicroUsd: 2_000_000n, // $2.00
        timestampMs: t0,
      });

      const res2 = tracker.evaluateWhaleSignal({
        walletAddress: '0xWhale2',
        walletTier: 'LIVE',
        fundingRootAddress: '0xRootBeta',
        directInteractedWallets90d: [],
        tokenMint: 'So111_MINT_A',
        tokenSymbol: 'WIF',
        fillPriceMicroUsd: 2_120_000n, // $2.12 (+6.00% < 12% límite)
        timestampMs: t0 + 95_000n, // 95s después (< 180s)
      });

      expect(res2.action).toBe('SCALE_TO_100_PCT');
      expect(res2.totalWeightBps).toBe(10000n);
      expect(res2.incrementalWeightBps).toBe(7500n);
      expect(res2.uniqueWhaleCount).toBe(2);
      expect(res2.priceDriftFromFirstBps).toBe(600n);
    });

    it('bloquea el escalado si las 2 ballenas comparten la misma raíz de fondeo o transferencias cruzadas (Anti-Sybil)', () => {
      const t0 = 1_700_000_000_000n;
      tracker.evaluateWhaleSignal({
        walletAddress: '0xWhale1',
        walletTier: 'LIVE',
        fundingRootAddress: '0xSameMotherWallet',
        directInteractedWallets90d: ['0xSybilPeer'],
        tokenMint: 'So111_MINT_SYBIL',
        tokenSymbol: 'SCAM',
        fillPriceMicroUsd: 1_000_000n,
        timestampMs: t0,
      });

      // Caso A: Misma raíz madre
      const sybilRootRes = tracker.evaluateWhaleSignal({
        walletAddress: '0xWhale2',
        walletTier: 'LIVE',
        fundingRootAddress: '0xSameMotherWallet',
        directInteractedWallets90d: [],
        tokenMint: 'So111_MINT_SYBIL',
        tokenSymbol: 'SCAM',
        fillPriceMicroUsd: 1_020_000n,
        timestampMs: t0 + 15_000n,
      });
      expect(sybilRootRes.action).toBe('REJECT_SYBIL_LINKED_ROOT');
      expect(sybilRootRes.incrementalWeightBps).toBe(0n);

      // Caso B: Raíz distinta pero con transferencia directa en los últimos 90 días
      const sybilPeerRes = tracker.evaluateWhaleSignal({
        walletAddress: '0xSybilPeer',
        walletTier: 'LIVE',
        fundingRootAddress: '0xDifferentRoot',
        directInteractedWallets90d: [],
        tokenMint: 'So111_MINT_SYBIL',
        tokenSymbol: 'SCAM',
        fillPriceMicroUsd: 1_030_000n,
        timestampMs: t0 + 20_000n,
      });
      expect(sybilPeerRes.action).toBe('REJECT_SYBIL_DIRECT_TX');
    });

    it('rechaza compras de billeteras SHADOW para ejecución en vivo', () => {
      const res = tracker.evaluateWhaleSignal({
        walletAddress: '0xShadowWallet',
        walletTier: 'SHADOW',
        fundingRootAddress: '0xRootShadow',
        directInteractedWallets90d: [],
        tokenMint: 'So111_MINT_A',
        tokenSymbol: 'SOL',
        fillPriceMicroUsd: 150_000_000n,
        timestampMs: 1_700_000_000_000n,
      });
      expect(res.action).toBe('REJECT_NON_LIVE_WALLET');
      expect(res.totalWeightBps).toBe(0n);
    });
  });

  describe('2. SmartPullbackSniper (Fib 38.2% / VWAP_5m + TTL 60s)', () => {
    let dbMock: InMemorySqliteWalMock;
    let repo: SentinelPullbackIntentRepository;
    let sniper: SmartPullbackSniper;

    beforeEach(() => {
      dbMock = new InMemorySqliteWalMock();
      repo = new SentinelPullbackIntentRepository(dbMock);
      sniper = new SmartPullbackSniper(repo);
    });

    it('calcula con exactitud BigInt el retroceso Fib 38.2% cuando la mecha de la ballena supera 85 bps', () => {
      // Precio pre-ballena: $1.00 (1,000,000 microUSD)
      // Punta de mecha post-ballena: $1.10 (1,100,000 microUSD) -> Impacto = 1000 bps (10%)
      // Mecha = 100,000 microUSD. Retroceso 38.2% = 1,100,000 - 38,200 = 1,061,800 microUSD ($1.0618)
      const plan = sniper.createEntryIntent({
        intentId: 'intent_001',
        tokenSymbol: 'JUP',
        tokenMint: 'JUP_MINT',
        preWhalePriceMicroUsd: 1_000_000n,
        peakImpactPriceMicroUsd: 1_100_000n,
        vwap5mMicroUsd: 1_080_000n,
        allocatedWeightBps: 2500n,
        confluenceCount: 1,
        uniqueFundingRoots: ['0xRoot1'],
        nowMs: 10_000n,
      });

      expect(plan.executionMode).toBe('LIMIT_PULLBACK_TRAP');
      expect(plan.whaleImpactBps).toBe(1000n);
      expect(plan.fib382PriceMicroUsd).toBe(1_061_800n);
      expect(plan.limitTargetPriceMicroUsd).toBe(1_061_800n);
      expect(plan.expiresAtMs).toBe(70_000n); // +60,000ms TTL

      // Verificar llenado cuando el precio retrocede a $1.0610
      const evalFill = sniper.evaluateMarketTick(plan.record, 1_061_000n, 35_000n);
      expect(evalFill.resolution).toBe('FILL_TRIGGERED');
      expect(evalFill.fillExecutionPriceMicroUsd).toBe(1_061_000n);
      expect(evalFill.updatedStatus).toBe('FILLED_PROBE');
    });

    it('cancela la intención si pasan más de 60 segundos sin retroceso o si escapa >15% sobre el pico', () => {
      const plan = sniper.createEntryIntent({
        intentId: 'intent_002',
        tokenSymbol: 'PYTH',
        tokenMint: 'PYTH_MINT',
        preWhalePriceMicroUsd: 1_000_000n,
        peakImpactPriceMicroUsd: 1_050_000n,
        vwap5mMicroUsd: 1_020_000n,
        allocatedWeightBps: 2500n,
        confluenceCount: 1,
        uniqueFundingRoots: ['0xRoot1'],
        nowMs: 100_000n,
      });

      // Caso 1: Escape de techo (> +15% sobre $1.05 = $1.2075) antes de los 60s
      const escaped = sniper.evaluateMarketTick(plan.record, 1_210_000n, 120_000n);
      expect(escaped.resolution).toBe('CANCELLED_ESCAPED_ROOF');

      // Caso 2: Expiración por TTL (> 160,000 ms)
      const expired = sniper.evaluateMarketTick(plan.record, 1_045_000n, 160_001n);
      expect(expired.resolution).toBe('CANCELLED_TTL_EXPIRED');
    });
  });

  describe('3. AdaptiveRvolTimeStop (Reloj Elástico 4m a 45m por RVOL y Spread)', () => {
    const clock = new AdaptiveRvolTimeStop();

    it('acelera el Time-Stop a 4 minutos (240,000 ms) cuando el RVOL cae por debajo de 0.5x (< 5000 bps)', () => {
      const res = clock.evaluateTimeStop({
        openedAtMs: 0n,
        nowMs: 245_000n, // 4 min 5 seg
        current1mVolumeMicroUsd: 40_000_000_000n, // $40k
        sma15mVolume1mMicroUsd: 100_000_000_000n, // $100k -> RVOL = 0.40x (4000 bps)
        currentSpreadBps: 50n,
        currentPnlBps: -120n, // -1.20%
        isAlreadyDeRisked: false,
      });

      expect(res.rvolBps).toBe(4000n);
      expect(res.regimeBand).toBe('FAST_KILL_ILLIQUID_4M');
      expect(res.allowedDurationMs).toBe(240_000n);
      expect(res.shouldClosePosition).toBe(true);
      expect(res.reason).toBe('CLOSE_FAST_KILL_LOW_RVOL_OR_WIDE_SPREAD');
    });

    it('extiende el Time-Stop hasta 45 minutos (2,700,000 ms) cuando el volumen se expande (RVOL >= 4.0x) con spread cerrado', () => {
      const res = clock.evaluateTimeStop({
        openedAtMs: 0n,
        nowMs: 1_500_000n, // 25 minutos transcurridos (en v2.0 habría cerrado a los 12m)
        current1mVolumeMicroUsd: 450_000_000_000n, // $450k
        sma15mVolume1mMicroUsd: 100_000_000_000n,  // $100k -> RVOL = 4.50x (45000 bps)
        currentSpreadBps: 45n,                     // 0.45% spread cerrado
        currentPnlBps: 280n,                       // +2.80% consolidando antes del breakout
        isAlreadyDeRisked: false,
      });

      expect(res.rvolBps).toBe(45000n);
      expect(res.regimeBand).toBe('EXTENDED_INSTITUTIONAL_FLOW');
      expect(res.allowedDurationMs).toBe(2_700_000n); // Tope de 45m alcanzado
      expect(res.shouldClosePosition).toBe(false);
      expect(res.reason).toBe('HOLD_WITHIN_TIME_BUDGET');
    });
  });
});
