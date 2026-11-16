// tests/egm_remediation_v3.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { NexusDatabase } from '../src/core/db_sqlite_wal.js';
import { RiskGuardian } from '../src/core/risk_guardian.js';
import { ActivePositionSupervisor } from '../src/core/position_supervisor.js';
import { SmartPullbackSniper } from '../src/engine_a_sentinel/smart_pullback_sniper.js';
import { SentinelPullbackIntentRepository, AetherSqliteRepository } from '../src/core/db_sqlite_wal.js';
import { DeltaNeutralCarryEngine } from '../src/engine_c_aether/delta_neutral_carry_engine.js';
import { MarketRegimeClassifier } from '../src/engine_c_aether/market_regime_classifier.js';

describe('REMEDIACIÓN AUDITORÍA EGM SWARM v3.0 (BLOCKERS P0 Y STABILITY)', () => {
  let db: NexusDatabase;
  let guardian: RiskGuardian;

  beforeEach(() => {
    db = new NexusDatabase(':memory:');
    db.initRiskGuardianState(100_000_000_000n); // $100k
    guardian = new RiskGuardian(db);
  });

  describe('1. Corrección Dimensional de PnL en Sentinel (Vector V-01)', () => {
    it('calcula y registra el PnL de Sentinel en micro-USD (no en BPS) y dispara el Circuit Breaker ante pérdidas reales', async () => {
      const supervisor = new ActivePositionSupervisor(db, guardian);

      // Posición de $10,000 USD nocional: 10,000 tokens a $1.00 (1,000,000 µUSD)
      const notionalInvested = 10_000_000_000n; // $10,000 USD
      const entryPrice = 1_000_000n;           // $1.00
      const totalTokensAtomic = 10_000_000_000_000n; // 10,000 * 10^9

      db.allocateAndInsertPositionAtomic({
        position_id: 'POS_SENTINEL_EGM_01',
        engine_origin: 'SENTINEL_ONCHAIN',
        signal_ref_id: 'SIG_01',
        execution_mode: 'SHADOW',
        instrument_ticker: 'MEME',
        side: 1,
        phase_allocation_bps: 10000n,
        notional_invested_micro: notionalInvested,
        quantity_atomic: totalTokensAtomic.toString(),
        entry_price_micro: entryPrice,
        stop_loss_micro: 920_000n, // -8% Stop-Loss
        trailing_stop_micro: null,
        take_profit_micro: null,
        peak_price_micro: entryPrice,
      });

      // Rehidratar posición en supervisor
      const openRows = db.getOpenPositions();
      supervisor.rehydrateAndResumeAll(openRows);

      // Simular tick que cae a $0.90 (-10% de pérdida = -$1,000 USD = -1,000,000,000 µUSD)
      // Debe liquidar por Hard Stop (-8%)
      await supervisor.evaluatePriceTick('MEME', 900_000n);

      const stateAfter = db.getRiskGuardianState();
      // Verificación: la pérdida registrada debe ser de exactamente -$1,000 USD (-1,000,000,000 µUSD), NO -$100 µUSD (-1000 BPS)
      expect(stateAfter.rolling_24h_pnl_micro).toBe(-1_000_000_000n);
      expect(stateAfter.current_equity_micro).toBe(99_000_000_000n); // $99,000 USD
      expect(stateAfter.open_exposure_micro).toBe(0n); // Exposición completamente liberada
      expect(stateAfter.open_positions_count).toBe(0n);
    });
  });

  describe('2. Inversión de Operador en Smart Pullback Sniper (Vector V-02)', () => {
    it('fija el objetivo en Fib 38.2% sin colapsar al precio pre-ballena cuando VWAP es bajo o no supera el pico', () => {
      const pullbackRepo = new SentinelPullbackIntentRepository(db.getRawDb());
      const sniper = new SmartPullbackSniper(pullbackRepo);

      // Pre-ballena: $1.00, Pico: $1.10 (Mecha = $0.10)
      // Fib 38.2% = $1.10 - $0.0382 = $1.0618 (1,061,800 µUSD)
      // Caso A: VWAP es bajo ($1.01) -> NO debe colapsar a $1.01 o $1.00
      const planLowVwap = sniper.createEntryIntent({
        intentId: 'intent_egm_01',
        tokenSymbol: 'SOL',
        tokenMint: 'MINT_SOL',
        preWhalePriceMicroUsd: 1_000_000n,
        peakImpactPriceMicroUsd: 1_100_000n,
        vwap5mMicroUsd: 1_010_000n, // VWAP muy bajo
        allocatedWeightBps: 2500n,
        confluenceCount: 1,
        uniqueFundingRoots: ['0xRoot1'],
        nowMs: 1000n,
      });

      expect(planLowVwap.limitTargetPriceMicroUsd).toBe(1_061_800n);

      // Caso B: VWAP es 0 (no disponible) -> Debe usar el nivel Fib 38.2%
      const planZeroVwap = sniper.createEntryIntent({
        intentId: 'intent_egm_02',
        tokenSymbol: 'SOL',
        tokenMint: 'MINT_SOL',
        preWhalePriceMicroUsd: 1_000_000n,
        peakImpactPriceMicroUsd: 1_100_000n,
        vwap5mMicroUsd: 0n,
        allocatedWeightBps: 2500n,
        confluenceCount: 1,
        uniqueFundingRoots: ['0xRoot1'],
        nowMs: 1000n,
      });

      expect(planZeroVwap.limitTargetPriceMicroUsd).toBe(1_061_800n);
    });
  });

  describe('3. Persistencia Completa en SQLite WAL de Carry Position (Vector V-03)', () => {
    it('actualiza asset_symbol y precios de entrada en ON CONFLICT(carry_id) DO UPDATE SET', () => {
      const aetherRepo = new AetherSqliteRepository(db.getRawDb());

      // 1. Insertar posición inicial en SOL
      aetherRepo.upsertCarryPosition({
        carry_id: 'carry_test_01',
        asset_symbol: 'SOL',
        strategy_type: 'FUNDING_BASIS_ARB',
        notional_deployed_micro_usd: 70_000_000_000n,
        spot_units_micro: 350_000_000n,
        perp_short_units_micro: 350_000_000n,
        spot_entry_price_micro_usd: 100_000_000n,
        perp_short_entry_micro_usd: 100_050_000n,
        delta_drift_bps: 0n,
        current_apr_bps: 1800n,
        consecutive_negative_funding_epochs: 0,
        cumulative_yield_micro_usd: 500_000n,
        status: 'ACTIVE_HARVESTING',
        opened_at_ms: 10_000n,
        last_harvest_ms: 20_000n,
      });

      // 2. Rotar a USDC_USDT_LP con nuevos precios y símbolos
      aetherRepo.upsertCarryPosition({
        carry_id: 'carry_test_01',
        asset_symbol: 'USDC_USDT_LP',
        strategy_type: 'STABLE_CONCENTRATED_LP',
        notional_deployed_micro_usd: 70_000_000_000n,
        spot_units_micro: 0n,
        perp_short_units_micro: 0n,
        spot_entry_price_micro_usd: 1_000_000n,
        perp_short_entry_micro_usd: 1_000_000n,
        delta_drift_bps: 0n,
        current_apr_bps: 950n,
        consecutive_negative_funding_epochs: 2,
        cumulative_yield_micro_usd: 750_000n,
        status: 'ACTIVE_HARVESTING',
        opened_at_ms: 10_000n,
        last_harvest_ms: 25_000n,
      });

      // 3. Recuperar desde SQLite WAL y verificar que NO se congelaron los valores viejos
      const recovered = aetherRepo.getCarryPositionById('carry_test_01');
      expect(recovered).toBeDefined();
      expect(recovered?.asset_symbol).toBe('USDC_USDT_LP');
      expect(recovered?.strategy_type).toBe('STABLE_CONCENTRATED_LP');
      expect(recovered?.spot_entry_price_micro_usd).toBe(1_000_000n);
      expect(recovered?.perp_short_entry_micro_usd).toBe(1_000_000n);
      expect(recovered?.cumulative_yield_micro_usd).toBe(750_000n);
    });
  });

  describe('4. Blindaje contra División por Cero y Rebalanceo de Margen Perp (Vector V-04)', () => {
    it('lanza excepción explícita si el precio spot es 0n al rotar a basis arb', () => {
      const aetherRepo = new AetherSqliteRepository(db.getRawDb());
      const carryEngine = new DeltaNeutralCarryEngine(aetherRepo);

      const stablePos = carryEngine.deployIdleCapital({
        carryId: 'carry_zero_test',
        assetSymbol: 'USDC_USDT_LP',
        totalNotionalMicroUsd: 70_000_000_000n,
        spotPriceMicroUsd: 1_000_000n,
        perpPriceMicroUsd: 1_000_000n,
        projectedFundingAprBps: 800n, // < 1100 -> va a STABLE_CONCENTRATED_LP
        stableVaultFallbackAprBps: 950n,
        nowMs: 1000n,
      });

      expect(() => {
        carryEngine.evaluateCarryEpoch(stablePos, {
          carryId: 'carry_zero_test',
          currentSpotUnitsMicro: 0n,
          currentPerpShortUnitsMicro: 0n,
          currentSpotPriceMicroUsd: 0n, // Spot colapsado o feed muerto
          currentPerpPriceMicroUsd: 150_000_000n,
          epochAnnualizedFundingAprBps: 2000n,
          stableVaultFallbackAprBps: 950n,
          nowMs: 2000n,
        });
      }).toThrowError(/INVALID_SPOT_PRICE/);
    });

    it('dispara REBALANCE_PERP_MARGIN_DEFENSE cuando el subyacente experimenta un rally > 75%', () => {
      const aetherRepo = new AetherSqliteRepository(db.getRawDb());
      const carryEngine = new DeltaNeutralCarryEngine(aetherRepo);

      // Entrada con SOL a $100 (100,000,000 µUSD)
      const basisPos = carryEngine.deployIdleCapital({
        carryId: 'carry_margin_test',
        assetSymbol: 'SOL',
        totalNotionalMicroUsd: 70_000_000_000n,
        spotPriceMicroUsd: 100_000_000n,
        perpPriceMicroUsd: 100_000_000n,
        projectedFundingAprBps: 1800n,
        stableVaultFallbackAprBps: 950n,
        nowMs: 1000n,
      });

      // SOL sube de $100 a $180 (+80% rally). Margen restante cae a 20% (< 25% umbral mínimo)
      const res = carryEngine.evaluateCarryEpoch(basisPos, {
        carryId: 'carry_margin_test',
        currentSpotUnitsMicro: basisPos.spot_units_micro,
        currentPerpShortUnitsMicro: basisPos.perp_short_units_micro,
        currentSpotPriceMicroUsd: 180_000_000n,
        currentPerpPriceMicroUsd: 180_050_000n,
        epochAnnualizedFundingAprBps: 2200n,
        stableVaultFallbackAprBps: 950n,
        nowMs: 6000n,
      });

      expect(res.action).toBe('REBALANCE_PERP_MARGIN_DEFENSE');
      expect(res.updatedRecord.status).toBe('REBALANCING');
    });
  });

  describe('5. Semáforo Macro Defensivo ante Volatilidad Muerta (Vector V-05)', () => {
    it('clasifica mercados con volatilidad colapsada como REGIME_CHOPPY_RANGE protegiendo a Sentinel con 0% multiplicador', () => {
      const classifier = new MarketRegimeClassifier();

      // Precios con ligera deriva pero ATR extremadamente comprimido (mercado ilíquido / zombi)
      const res = classifier.evaluateMarketRegime(
        {
          closePricesMicroUsd: [100_000_000n, 100_500_000n, 101_000_000n, 101_500_000n, 102_000_000n],
          atr5mMicroUsd: 500_000n,
          atr1hMicroUsd: 1_000_000n, // ATR Ratio = 5000 bps (0.50x < 0.85x requerido para tendencia)
          bollingerUpperMicroUsd: 103_000_000n,
          bollingerMidMicroUsd: 101_000_000n,
          bollingerLowerMicroUsd: 99_000_000n,
          timestampMs: 5000n,
        },
        true
      );

      // NO debe ser clasificado como REGIME_TRENDING (evita el bug de falso positivo en el bloque else)
      expect(res.regime).toBe('REGIME_CHOPPY_RANGE');
      expect(res.sentinelMultiplierBps).toBe(0n);
      expect(res.carryAllocationTargetBps).toBe(8500n);
    });
  });
});
