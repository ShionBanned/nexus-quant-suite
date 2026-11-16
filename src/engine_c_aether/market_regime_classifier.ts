/**
 * NEXUS QUANT SUITE v3.0 - AETHER MARKET REGIME CLASSIFIER
 * 
 * Evalúa cada 5 segundos:
 * - Kaufman Efficiency Ratio (ER en bps: 0 a 10000)
 * - Ratio de expansión de volatilidad ATR_5m / ATR_1h
 * - Ancho de Bandas de Bollinger (BBW en bps)
 * Clasifica en 3 modos: TRENDING (100%), VOLATILE_PANIC (Sentinel 20%), CHOPPY_RANGE (Sentinel 0%).
 */

import {
  AetherRegimeTelemetryRecord,
  AetherSqliteRepository,
  MarketRegimeState,
} from '../core/db_sqlite_wal.js';

export interface MarketRegimeSampleInput {
  readonly closePricesMicroUsd: readonly bigint[]; // Ventana de cierres (ej. N=24 velas de 5m)
  readonly atr5mMicroUsd: bigint;
  readonly atr1hMicroUsd: bigint;
  readonly bollingerUpperMicroUsd: bigint;
  readonly bollingerMidMicroUsd: bigint;
  readonly bollingerLowerMicroUsd: bigint;
  readonly timestampMs: bigint;
}

export interface MarketRegimeEvaluationResult {
  readonly regime: MarketRegimeState;
  readonly kaufmanErBps: bigint;
  readonly atrRatioBps: bigint;
  readonly bollingerWidthBps: bigint;
  readonly sentinelMultiplierBps: bigint;
  readonly catalystMultiplierBps: bigint;
  readonly carryAllocationTargetBps: bigint;
  readonly evaluatedAtMs: bigint;
  readonly skippedByTickInterval: boolean;
}

export class MarketRegimeClassifier {
  public static readonly EVALUATION_INTERVAL_MS: bigint = 5_000n; // Tick de 5 segundos

  // Umbrales Kaufman ER (en bps: 0 a 10000)
  public static readonly TRENDING_MIN_ER_BPS: bigint = 3800n;     // >= 0.38 eficiencia direccional
  public static readonly CHOPPY_MAX_ER_BPS: bigint = 2400n;       // < 0.24 ruido lateral

  // Umbrales ATR Ratio (ATR_5m / ATR_1h en bps)
  public static readonly TRENDING_MIN_ATR_RATIO_BPS: bigint = 8500n;  // 0.85x
  public static readonly PANIC_MIN_ATR_RATIO_BPS: bigint = 17500n;    // > 1.75x explosión de volatilidad

  // Umbrales Ancho de Bollinger (BBW en bps)
  public static readonly PANIC_MIN_BBW_BPS: bigint = 600n;        // > 6.00% ancho de banda
  public static readonly CHOPPY_MAX_BBW_BPS: bigint = 210n;       // < 2.10% compresión lateral

  private readonly repository?: AetherSqliteRepository;
  private lastEvaluatedAtMs: bigint = 0n;
  private lastResult: MarketRegimeEvaluationResult | null = null;

  constructor(repository?: AetherSqliteRepository) {
    this.repository = repository;
  }

  /**
   * Calcula Kaufman ER en puntos base [0n, 10000n] usando aritmética entera BigInt.
   * ER = (|P_t - P_0| * 10000n) / Sum(|P_i - P_{i-1}|)
   */
  public computeKaufmanErBps(pricesMicroUsd: readonly bigint[]): bigint {
    if (pricesMicroUsd.length < 2) {
      throw new Error('INVALID_PRICE_SERIES: at least 2 price points required for Kaufman ER');
    }

    const firstPrice = pricesMicroUsd[0];
    const lastPrice = pricesMicroUsd[pricesMicroUsd.length - 1];
    const netDirectionChange =
      lastPrice >= firstPrice ? lastPrice - firstPrice : firstPrice - lastPrice;

    let totalPathVolatility = 0n;
    for (let i = 1; i < pricesMicroUsd.length; i++) {
      const prev = pricesMicroUsd[i - 1];
      const curr = pricesMicroUsd[i];
      const stepDiff = curr >= prev ? curr - prev : prev - curr;
      totalPathVolatility += stepDiff;
    }

    if (totalPathVolatility === 0n) {
      return 0n;
    }

    const erBps = (netDirectionChange * 10000n) / totalPathVolatility;
    return erBps > 10000n ? 10000n : erBps;
  }

  /**
   * Calcula el ratio de expansión de volatilidad ATR_5m / ATR_1h en puntos base.
   */
  public computeAtrRatioBps(atr5mMicroUsd: bigint, atr1hMicroUsd: bigint): bigint {
    if (atr1hMicroUsd <= 0n || atr5mMicroUsd < 0n) {
      throw new Error('INVALID_ATR_VALUES: atr1h must be > 0n and atr5m >= 0n');
    }
    return (atr5mMicroUsd * 10000n) / atr1hMicroUsd;
  }

  /**
   * Calcula el Ancho de Bandas de Bollinger (BBW) en puntos base: ((Upper - Lower) * 10000n) / Mid
   */
  public computeBollingerWidthBps(
    upperMicroUsd: bigint,
    midMicroUsd: bigint,
    lowerMicroUsd: bigint
  ): bigint {
    if (midMicroUsd <= 0n || upperMicroUsd < lowerMicroUsd) {
      throw new Error('INVALID_BOLLINGER_BANDS: mid > 0n and upper >= lower required');
    }
    const bandSpreadMicro = upperMicroUsd - lowerMicroUsd;
    return (bandSpreadMicro * 10000n) / midMicroUsd;
  }

  /**
   * Evalúa el estado macro del mercado respetando el ciclo de 5 segundos (a menos que force=true).
   */
  public evaluateMarketRegime(
    input: MarketRegimeSampleInput,
    forceEvaluation: boolean = false
  ): MarketRegimeEvaluationResult {
    if (
      !forceEvaluation &&
      this.lastResult !== null &&
      input.timestampMs - this.lastEvaluatedAtMs < MarketRegimeClassifier.EVALUATION_INTERVAL_MS
    ) {
      return {
        ...this.lastResult,
        skippedByTickInterval: true,
      };
    }

    const kaufmanErBps = this.computeKaufmanErBps(input.closePricesMicroUsd);
    const atrRatioBps = this.computeAtrRatioBps(input.atr5mMicroUsd, input.atr1hMicroUsd);
    const bollingerWidthBps = this.computeBollingerWidthBps(
      input.bollingerUpperMicroUsd,
      input.bollingerMidMicroUsd,
      input.bollingerLowerMicroUsd
    );

    let regime: MarketRegimeState;
    let sentinelMultiplierBps: bigint;
    let catalystMultiplierBps: bigint;
    let carryAllocationTargetBps: bigint;

    // 1. Prioridad Máxima: Detección de Pánico Volátil / Dislocación
    if (
      atrRatioBps > MarketRegimeClassifier.PANIC_MIN_ATR_RATIO_BPS ||
      bollingerWidthBps > MarketRegimeClassifier.PANIC_MIN_BBW_BPS
    ) {
      regime = 'REGIME_VOLATILE_PANIC';
      sentinelMultiplierBps = 2000n;       // Sentinel reducido al 20%
      catalystMultiplierBps = 10000n;      // Catalyst al 100% (arbitraje de volatilidad)
      carryAllocationTargetBps = 7000n;    // 70% reserva en Carry cosechando picos de funding
    }
    // 2. Detección de Mercado Muerto / Rango Lateral (Choppy Range)
    else if (
      kaufmanErBps < MarketRegimeClassifier.CHOPPY_MAX_ER_BPS &&
      bollingerWidthBps < MarketRegimeClassifier.CHOPPY_MAX_BBW_BPS
    ) {
      regime = 'REGIME_CHOPPY_RANGE';
      sentinelMultiplierBps = 0n;          // PAUSA ESTRICTA en Sentinel (0% entradas nuevas)
      catalystMultiplierBps = 5000n;       // Catalyst selectivo al 50%
      carryAllocationTargetBps = 8500n;    // Desvía hasta el 85% del capital al motor de Carry
    }
    // 3. Régimen de Tendencia Limpia o Expansión Ordenada
    else if (
      kaufmanErBps >= MarketRegimeClassifier.TRENDING_MIN_ER_BPS &&
      atrRatioBps >= MarketRegimeClassifier.TRENDING_MIN_ATR_RATIO_BPS &&
      atrRatioBps <= MarketRegimeClassifier.PANIC_MIN_ATR_RATIO_BPS
    ) {
      regime = 'REGIME_TRENDING';
      sentinelMultiplierBps = 10000n;      // Sentinel al 100% de agresividad
      catalystMultiplierBps = 10000n;      // Catalyst al 100%
      carryAllocationTargetBps = 7000n;    // 70% base en Carry ($70,000 USD)
    }
    // 4. Zona Transicional / Rango No Confirmado: proteger capital ante falta de tendencia clara
    else {
      regime = 'REGIME_CHOPPY_RANGE';
      sentinelMultiplierBps = 0n;          // Pausa estricta en Sentinel hasta confirmación de tendencia
      catalystMultiplierBps = 5000n;       // Catalyst selectivo al 50%
      carryAllocationTargetBps = 8500n;    // Conservar 85% de capital en Carry
    }

    const record: AetherRegimeTelemetryRecord = {
      current_regime: regime,
      kaufman_er_bps: kaufmanErBps,
      atr_ratio_bps: atrRatioBps,
      bollinger_width_bps: bollingerWidthBps,
      sentinel_multiplier_bps: sentinelMultiplierBps,
      catalyst_multiplier_bps: catalystMultiplierBps,
      carry_allocation_target_bps: carryAllocationTargetBps,
      updated_at_ms: input.timestampMs,
    };

    if (this.repository) {
      this.repository.saveRegimeTelemetry(record);
    }

    const result: MarketRegimeEvaluationResult = {
      regime,
      kaufmanErBps,
      atrRatioBps,
      bollingerWidthBps,
      sentinelMultiplierBps,
      catalystMultiplierBps,
      carryAllocationTargetBps,
      evaluatedAtMs: input.timestampMs,
      skippedByTickInterval: false,
    };

    this.lastEvaluatedAtMs = input.timestampMs;
    this.lastResult = result;
    return result;
  }
}
