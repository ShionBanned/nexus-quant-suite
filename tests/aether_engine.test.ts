// tests/aether_engine.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { MarketRegimeClassifier } from '../src/engine_c_aether/market_regime_classifier.js';
import { DeltaNeutralCarryEngine } from '../src/engine_c_aether/delta_neutral_carry_engine.js';
import {
  AetherSqliteRepository,
  SqliteWalDatabaseDriver,
  SqliteWalStatement,
} from '../src/core/db_sqlite_wal.js';

class AetherSqliteWalMock implements SqliteWalDatabaseDriver {
  public regimeRow: Record<string, unknown> | undefined;
  public carryStore: Map<string, Record<string, unknown>> = new Map();

  public exec(_sql: string): void {}

  public prepare(sql: string): SqliteWalStatement {
    return {
      run: (...params: unknown[]) => {
        if (sql.includes('INSERT INTO aether_regime_telemetry')) {
          this.regimeRow = {
            id: 1,
            current_regime: params[0],
            kaufman_er_bps: params[1],
            atr_ratio_bps: params[2],
            bollinger_width_bps: params[3],
            sentinel_multiplier_bps: params[4],
            catalyst_multiplier_bps: params[5],
            carry_allocation_target_bps: params[6],
            updated_at_ms: params[7],
          };
        } else if (sql.includes('INSERT INTO aether_carry_ledger')) {
          const carryId = String(params[0]);
          this.carryStore.set(carryId, {
            carry_id: params[0],
            asset_symbol: params[1],
            strategy_type: params[2],
            notional_deployed_micro_usd: params[3],
            spot_units_micro: params[4],
            perp_short_units_micro: params[5],
            spot_entry_price_micro_usd: params[6],
            perp_short_entry_micro_usd: params[7],
            delta_drift_bps: params[8],
            current_apr_bps: params[9],
            consecutive_negative_funding_epochs: params[10],
            cumulative_yield_micro_usd: params[11],
            status: params[12],
            opened_at_ms: params[13],
            last_harvest_ms: params[14],
          });
        }
        return { changes: 1, lastInsertRowid: 1 };
      },
      get: (...params: unknown[]) => {
        if (sql.includes('FROM aether_regime_telemetry')) {
          return this.regimeRow;
        }
        const id = String(params[0]);
        return this.carryStore.get(id);
      },
      all: () => {
        return Array.from(this.carryStore.values());
      },
    };
  }
}

describe('NEXUS v3.0 - FASE 2: Motor C «Aether» (Market Regime & Delta-Neutral Carry)', () => {
  let dbMock: AetherSqliteWalMock;
  let repository: AetherSqliteRepository;

  beforeEach(() => {
    dbMock = new AetherSqliteWalMock();
    repository = new AetherSqliteRepository(dbMock);
  });

  describe('1. MarketRegimeClassifier (El Semáforo Macro en BigInt bps)', () => {
    it('clasifica REGIME_TRENDING y habilita Sentinel al 100% (10000n bps) cuando ER >= 3800n y ATR es saludable', () => {
      const classifier = new MarketRegimeClassifier(repository);

      const trendingPrices = [
        100_000_000n,
        102_000_000n,
        104_000_000n,
        106_000_000n,
        108_000_000n,
        110_000_000n,
      ];

      const resClean = classifier.evaluateMarketRegime(
        {
          closePricesMicroUsd: trendingPrices,
          atr5mMicroUsd: 1_150_000n,
          atr1hMicroUsd: 1_000_000n,
          bollingerUpperMicroUsd: 110_000_000n,
          bollingerMidMicroUsd: 108_000_000n,
          bollingerLowerMicroUsd: 106_000_000n,
          timestampMs: 1_700_000_006_000n,
        },
        true
      );

      expect(resClean.regime).toBe('REGIME_TRENDING');
      expect(resClean.kaufmanErBps).toBe(10000n);
      expect(resClean.sentinelMultiplierBps).toBe(10000n);
      expect(resClean.catalystMultiplierBps).toBe(10000n);
      expect(resClean.carryAllocationTargetBps).toBe(7000n);

      const saved = repository.getLatestRegimeTelemetry();
      expect(saved?.current_regime).toBe('REGIME_TRENDING');
    });

    it('clasifica REGIME_CHOPPY_RANGE, pausa Sentinel al 0% (0n bps) y eleva Carry al 85% en mercado lateral', () => {
      const classifier = new MarketRegimeClassifier(repository);

      const choppyPrices = [
        100_000_000n,
        101_000_000n,
        100_000_000n,
        101_000_000n,
        100_000_000n,
      ];

      const res = classifier.evaluateMarketRegime({
        closePricesMicroUsd: choppyPrices,
        atr5mMicroUsd: 800_000n,
        atr1hMicroUsd: 1_000_000n,
        bollingerUpperMicroUsd: 100_800_000n,
        bollingerMidMicroUsd: 100_000_000n,
        bollingerLowerMicroUsd: 99_200_000n,
        timestampMs: 1_700_000_010_000n,
      });

      expect(res.regime).toBe('REGIME_CHOPPY_RANGE');
      expect(res.kaufmanErBps).toBe(0n);
      expect(res.bollingerWidthBps).toBe(160n);
      expect(res.sentinelMultiplierBps).toBe(0n);
      expect(res.carryAllocationTargetBps).toBe(8500n);
    });

    it('clasifica REGIME_VOLATILE_PANIC, reduce Sentinel al 20% (2000n bps) y prioriza Catalyst al 100% en picos de volatilidad', () => {
      const classifier = new MarketRegimeClassifier(repository);

      const panicPrices = [100_000_000n, 92_000_000n, 96_000_000n, 85_000_000n];

      const res = classifier.evaluateMarketRegime({
        closePricesMicroUsd: panicPrices,
        atr5mMicroUsd: 2_200_000n,
        atr1hMicroUsd: 1_000_000n,
        bollingerUpperMicroUsd: 105_000_000n,
        bollingerMidMicroUsd: 95_000_000n,
        bollingerLowerMicroUsd: 85_000_000n,
        timestampMs: 1_700_000_020_000n,
      });

      expect(res.regime).toBe('REGIME_VOLATILE_PANIC');
      expect(res.sentinelMultiplierBps).toBe(2000n);
      expect(res.catalystMultiplierBps).toBe(10000n);
    });

    it('respeta el intervalo de 5 segundos (5000n ms) devolviendo el estado en caché sin recalcular', () => {
      const classifier = new MarketRegimeClassifier(repository);
      const sample = {
        closePricesMicroUsd: [100_000_000n, 105_000_000n],
        atr5mMicroUsd: 1_000_000n,
        atr1hMicroUsd: 1_000_000n,
        bollingerUpperMicroUsd: 102_000_000n,
        bollingerMidMicroUsd: 100_000_000n,
        bollingerLowerMicroUsd: 98_000_000n,
        timestampMs: 10_000n,
      };

      const first = classifier.evaluateMarketRegime(sample);
      expect(first.skippedByTickInterval).toBe(false);

      const second = classifier.evaluateMarketRegime({
        ...sample,
        timestampMs: 13_000n,
      });
      expect(second.skippedByTickInterval).toBe(true);
    });
  });

  describe('2. DeltaNeutralCarryEngine (Spot-Perp 1x, Rebalanceo > 15 bps y Piso de Funding)', () => {
    it('despliega los $70,000 USD ociosos en FUNDING_BASIS_ARB cuando el Funding APR >= 11.00% (1100n bps)', () => {
      const carryEngine = new DeltaNeutralCarryEngine(repository);

      const deployed = carryEngine.deployIdleCapital({
        carryId: 'carry_sol_001',
        assetSymbol: 'SOL',
        totalNotionalMicroUsd: 70_000_000_000n,
        spotPriceMicroUsd: 100_000_000n,
        perpPriceMicroUsd: 100_050_000n,
        projectedFundingAprBps: 1950n,
        stableVaultFallbackAprBps: 950n,
        nowMs: 1_000_000n,
      });

      expect(deployed.strategy_type).toBe('FUNDING_BASIS_ARB');
      expect(deployed.spot_units_micro).toBe(350_000_000n);
      expect(deployed.perp_short_units_micro).toBe(350_000_000n);
      expect(deployed.delta_drift_bps).toBe(0n);
      expect(deployed.current_apr_bps).toBe(1950n);
    });

    it('ejecuta rebalanceo automático cuando el Delta Drift entre Spot y Perp supera los 15 bps (0.15%)', () => {
      const carryEngine = new DeltaNeutralCarryEngine(repository);
      const deployed = carryEngine.deployIdleCapital({
        carryId: 'carry_eth_001',
        assetSymbol: 'ETH',
        totalNotionalMicroUsd: 70_000_000_000n,
        spotPriceMicroUsd: 100_000_000n,
        perpPriceMicroUsd: 100_000_000n,
        projectedFundingAprBps: 2000n,
        stableVaultFallbackAprBps: 900n,
        nowMs: 0n,
      });

      const evalRes = carryEngine.evaluateCarryEpoch(deployed, {
        carryId: 'carry_eth_001',
        currentSpotUnitsMicro: 351_050_000n,
        currentPerpShortUnitsMicro: 350_000_000n,
        currentSpotPriceMicroUsd: 105_000_000n,
        currentPerpPriceMicroUsd: 105_000_000n,
        epochAnnualizedFundingAprBps: 2000n,
        stableVaultFallbackAprBps: 900n,
        nowMs: 15_768_000_000n,
      });

      expect(evalRes.action).toBe('REBALANCE_DELTA_DRIFT');
      expect(evalRes.deltaDriftBps).toBe(29n);
      expect(evalRes.rebalancedUnitsDeltaMicro).toBe(1_050_000n);
      expect(evalRes.updatedRecord.perp_short_units_micro).toBe(351_050_000n);
      expect(evalRes.updatedRecord.delta_drift_bps).toBe(0n);
      expect(evalRes.harvestedYieldThisTickMicroUsd).toBe(7_000_000_000n);
    });

    it('rota el capital a STABLE_CONCENTRATED_LP cuando acumula 2 épocas consecutivas de Funding Rate negativo', () => {
      const carryEngine = new DeltaNeutralCarryEngine(repository);
      const initial = carryEngine.deployIdleCapital({
        carryId: 'carry_btc_001',
        assetSymbol: 'BTC',
        totalNotionalMicroUsd: 70_000_000_000n,
        spotPriceMicroUsd: 100_000_000n,
        perpPriceMicroUsd: 100_000_000n,
        projectedFundingAprBps: 1500n,
        stableVaultFallbackAprBps: 950n,
        nowMs: 1_000n,
      });

      const epoch1 = carryEngine.evaluateCarryEpoch(initial, {
        carryId: 'carry_btc_001',
        currentSpotUnitsMicro: 350_000_000n,
        currentPerpShortUnitsMicro: 350_000_000n,
        currentSpotPriceMicroUsd: 100_000_000n,
        currentPerpPriceMicroUsd: 100_000_000n,
        epochAnnualizedFundingAprBps: -450n,
        stableVaultFallbackAprBps: 950n,
        nowMs: 28_801_000n,
      });
      expect(epoch1.consecutiveNegativeEpochs).toBe(1);
      expect(epoch1.strategyType).toBe('FUNDING_BASIS_ARB');

      const epoch2 = carryEngine.evaluateCarryEpoch(epoch1.updatedRecord, {
        carryId: 'carry_btc_001',
        currentSpotUnitsMicro: 350_000_000n,
        currentPerpShortUnitsMicro: 350_000_000n,
        currentSpotPriceMicroUsd: 100_000_000n,
        currentPerpPriceMicroUsd: 100_000_000n,
        epochAnnualizedFundingAprBps: -600n,
        stableVaultFallbackAprBps: 950n,
        nowMs: 57_601_000n,
      });

      expect(epoch2.action).toBe('ROTATE_TO_STABLE_VAULT_NEGATIVE_FUNDING');
      expect(epoch2.strategyType).toBe('STABLE_CONCENTRATED_LP');
      expect(epoch2.effectiveAprBps).toBe(950n);
      expect(epoch2.updatedRecord.spot_units_micro).toBe(0n);
      expect(epoch2.updatedRecord.perp_short_units_micro).toBe(0n);
    });
  });
});
