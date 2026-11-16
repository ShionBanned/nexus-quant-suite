/**
 * NEXUS QUANT SUITE v3.0 - AETHER DELTA-NEUTRAL CARRY ENGINE
 * 
 * Gestiona el 70% del capital ($70,000 USD):
 * - Posición sintética Spot Long + 1x Perp Short (FUNDING_BASIS_ARB)
 * - Rebalanceo automático si Delta Drift > 15 bps (0.15%)
 * - Piso de Funding Rate: >= 1100 bps (11.00% APR)
 * - Fallback a Vault Estable (STABLE_CONCENTRATED_LP) tras 2 épocas consecutivas de funding negativo.
 */

import {
  AetherCarryLedgerRecord,
  AetherSqliteRepository,
  CarryStrategyType,
} from '../core/db_sqlite_wal.js';

export interface CarryDeploymentInput {
  readonly carryId: string;
  readonly assetSymbol: string;
  readonly totalNotionalMicroUsd: bigint;    // Ej. 70_000_000_000n ($70,000 USD)
  readonly spotPriceMicroUsd: bigint;        // Precio Spot en micro-USD
  readonly perpPriceMicroUsd: bigint;        // Precio Perp en micro-USD
  readonly projectedFundingAprBps: bigint;   // APR anualizado de Funding en bps (ej. 1950n = 19.50%)
  readonly stableVaultFallbackAprBps: bigint;// APR del Vault estable (ej. 950n = 9.50%)
  readonly nowMs: bigint;
}

export interface CarryEpochTickInput {
  readonly carryId: string;
  readonly currentSpotUnitsMicro: bigint;
  readonly currentPerpShortUnitsMicro: bigint;
  readonly currentSpotPriceMicroUsd: bigint;
  readonly currentPerpPriceMicroUsd: bigint;
  readonly epochAnnualizedFundingAprBps: bigint; // Puede ser negativo si los shorts pagan a los longs
  readonly stableVaultFallbackAprBps: bigint;
  readonly nowMs: bigint;
}

export type CarryEpochAction =
  | 'HARVEST_AND_HOLD_BASIS'
  | 'REBALANCE_DELTA_DRIFT'
  | 'REBALANCE_PERP_MARGIN_DEFENSE'
  | 'ROTATE_TO_STABLE_VAULT_NEGATIVE_FUNDING'
  | 'ROTATE_TO_BASIS_ARB_HIGH_FUNDING'
  | 'HARVEST_STABLE_VAULT';

export interface CarryEvaluationResult {
  readonly action: CarryEpochAction;
  readonly strategyType: CarryStrategyType;
  readonly deltaDriftBps: bigint;
  readonly rebalancedUnitsDeltaMicro: bigint;
  readonly harvestedYieldThisTickMicroUsd: bigint;
  readonly cumulativeYieldMicroUsd: bigint;
  readonly effectiveAprBps: bigint;
  readonly consecutiveNegativeEpochs: number;
  readonly updatedRecord: AetherCarryLedgerRecord;
}

export class DeltaNeutralCarryEngine {
  public static readonly MIN_FUNDING_FLOOR_APR_BPS: bigint = 1100n; // 11.00% APR mínimo para abrir Spot-Perp
  public static readonly MAX_DELTA_DRIFT_BPS: bigint = 15n;         // 0.15% desviación máxima entre piernas
  public static readonly MIN_PERP_MARGIN_HEALTH_BPS: bigint = 2500n;// 25.00% margen mínimo de mantenimiento colateral
  public static readonly MAX_NEGATIVE_FUNDING_EPOCHS: number = 2;   // 2 épocas negativas rotan a Stable LP
  public static readonly MS_PER_YEAR: bigint = 31_536_000_000n;     // 365 * 24 * 3600 * 1000 ms
  public static readonly UNIT_PRECISION_SCALE: bigint = 1_000_000n; // 1 unidad = 1,000,000 micro-unidades

  private readonly repository?: AetherSqliteRepository;

  constructor(repository?: AetherSqliteRepository) {
    this.repository = repository;
  }

  /**
   * Calcula la desviación direccional neta (Delta Drift) en puntos base entre Spot y Perp Short.
   */
  public computeDeltaDriftBps(spotUnitsMicro: bigint, perpShortUnitsMicro: bigint): bigint {
    if (spotUnitsMicro === 0n && perpShortUnitsMicro === 0n) {
      return 0n;
    }
    if (spotUnitsMicro <= 0n) {
      return 10000n; // Desviación total si no hay pierna Spot
    }
    const diffUnits =
      spotUnitsMicro >= perpShortUnitsMicro
        ? spotUnitsMicro - perpShortUnitsMicro
        : perpShortUnitsMicro - spotUnitsMicro;

    return (diffUnits * 10000n) / spotUnitsMicro;
  }

  /**
   * Despliega el capital ocioso (ej. $70,000 USD) en arbitraje de Funding Rate o en el Vault Estable.
   */
  public deployIdleCapital(input: CarryDeploymentInput): AetherCarryLedgerRecord {
    if (input.totalNotionalMicroUsd <= 0n || input.spotPriceMicroUsd <= 0n) {
      throw new Error('INVALID_CARRY_DEPLOYMENT: notional and spotPrice must be > 0n');
    }

    const qualifiesForFundingArb =
      input.projectedFundingAprBps >= DeltaNeutralCarryEngine.MIN_FUNDING_FLOOR_APR_BPS;

    const strategyType: CarryStrategyType = qualifiesForFundingArb
      ? 'FUNDING_BASIS_ARB'
      : 'STABLE_CONCENTRATED_LP';

    // En FUNDING_BASIS_ARB: 50% compra Spot y 50% colateraliza Short 1x por el mismo número de unidades
    const halfNotionalMicro = input.totalNotionalMicroUsd / 2n;
    const matchedUnitsMicro = qualifiesForFundingArb
      ? (halfNotionalMicro * DeltaNeutralCarryEngine.UNIT_PRECISION_SCALE) / input.spotPriceMicroUsd
      : 0n;

    const activeAprBps = qualifiesForFundingArb
      ? input.projectedFundingAprBps
      : input.stableVaultFallbackAprBps;

    const record: AetherCarryLedgerRecord = {
      carry_id: input.carryId,
      asset_symbol: qualifiesForFundingArb ? input.assetSymbol : 'USDC_USDT_LP',
      strategy_type: strategyType,
      notional_deployed_micro_usd: input.totalNotionalMicroUsd,
      spot_units_micro: matchedUnitsMicro,
      perp_short_units_micro: matchedUnitsMicro,
      spot_entry_price_micro_usd: input.spotPriceMicroUsd,
      perp_short_entry_micro_usd: input.perpPriceMicroUsd,
      delta_drift_bps: 0n,
      current_apr_bps: activeAprBps,
      consecutive_negative_funding_epochs: 0,
      cumulative_yield_micro_usd: 0n,
      status: 'ACTIVE_HARVESTING',
      opened_at_ms: input.nowMs,
      last_harvest_ms: input.nowMs,
    };

    if (this.repository) {
      this.repository.upsertCarryPosition(record);
    }

    return record;
  }

  /**
   * Evalúa una época de Funding / Tick de supervisión: cosecha rendimiento, verifica neutralidad Delta (<= 15 bps)
   * y rota hacia o desde el Vault Estable según las tasas de financiación.
   */
  public evaluateCarryEpoch(
    existing: AetherCarryLedgerRecord,
    tick: CarryEpochTickInput
  ): CarryEvaluationResult {
    const elapsedMs =
      tick.nowMs > existing.last_harvest_ms ? tick.nowMs - existing.last_harvest_ms : 0n;

    // 1. Calcular rendimiento devengado en el periodo usando BigInt puro (solo si el APR previo > 0)
    const positiveAprBps = existing.current_apr_bps > 0n ? existing.current_apr_bps : 0n;
    const harvestedYieldMicroUsd =
      elapsedMs > 0n
        ? (existing.notional_deployed_micro_usd * positiveAprBps * elapsedMs) /
          (10000n * DeltaNeutralCarryEngine.MS_PER_YEAR)
        : 0n;

    const newCumulativeYieldMicroUsd =
      existing.cumulative_yield_micro_usd + harvestedYieldMicroUsd;
    // Si el rendimiento truncó a 0n en ticks de alta frecuencia, preservar last_harvest_ms para no fugar yield
    const effectiveHarvestMs = harvestedYieldMicroUsd > 0n ? tick.nowMs : existing.last_harvest_ms;

    // 2. Actualizar contador de épocas con Funding Rate negativo
    const isFundingNegative = tick.epochAnnualizedFundingAprBps < 0n;
    const consecutiveNegEpochs = isFundingNegative
      ? existing.consecutive_negative_funding_epochs + 1
      : 0;

    // 3. Si estamos en FUNDING_BASIS_ARB y se acumulan >= 2 épocas negativas -> Rotar a STABLE_CONCENTRATED_LP
    if (
      existing.strategy_type === 'FUNDING_BASIS_ARB' &&
      consecutiveNegEpochs >= DeltaNeutralCarryEngine.MAX_NEGATIVE_FUNDING_EPOCHS
    ) {
      const rotatedRecord: AetherCarryLedgerRecord = {
        ...existing,
        asset_symbol: 'USDC_USDT_LP',
        strategy_type: 'STABLE_CONCENTRATED_LP',
        spot_units_micro: 0n,
        perp_short_units_micro: 0n,
        delta_drift_bps: 0n,
        current_apr_bps: tick.stableVaultFallbackAprBps,
        consecutive_negative_funding_epochs: consecutiveNegEpochs,
        cumulative_yield_micro_usd: newCumulativeYieldMicroUsd,
        status: 'ACTIVE_HARVESTING',
        last_harvest_ms: effectiveHarvestMs,
      };

      if (this.repository) {
        this.repository.upsertCarryPosition(rotatedRecord);
      }

      return {
        action: 'ROTATE_TO_STABLE_VAULT_NEGATIVE_FUNDING',
        strategyType: 'STABLE_CONCENTRATED_LP',
        deltaDriftBps: 0n,
        rebalancedUnitsDeltaMicro: 0n,
        harvestedYieldThisTickMicroUsd: harvestedYieldMicroUsd,
        cumulativeYieldMicroUsd: newCumulativeYieldMicroUsd,
        effectiveAprBps: tick.stableVaultFallbackAprBps,
        consecutiveNegativeEpochs: consecutiveNegEpochs,
        updatedRecord: rotatedRecord,
      };
    }

    // 4. Si estamos en STABLE_CONCENTRATED_LP y el Funding vuelve a superar >= 11.00% APR -> Rotar a FUNDING_BASIS_ARB
    if (
      existing.strategy_type === 'STABLE_CONCENTRATED_LP' &&
      tick.epochAnnualizedFundingAprBps >= DeltaNeutralCarryEngine.MIN_FUNDING_FLOOR_APR_BPS
    ) {
      if (tick.currentSpotPriceMicroUsd <= 0n) {
        throw new Error(`INVALID_SPOT_PRICE: currentSpotPriceMicroUsd must be > 0n, got ${tick.currentSpotPriceMicroUsd}`);
      }

      const halfNotionalMicro = existing.notional_deployed_micro_usd / 2n;
      const newMatchedUnitsMicro =
        (halfNotionalMicro * DeltaNeutralCarryEngine.UNIT_PRECISION_SCALE) /
        tick.currentSpotPriceMicroUsd;

      const upgradedRecord: AetherCarryLedgerRecord = {
        ...existing,
        strategy_type: 'FUNDING_BASIS_ARB',
        spot_units_micro: newMatchedUnitsMicro,
        perp_short_units_micro: newMatchedUnitsMicro,
        spot_entry_price_micro_usd: tick.currentSpotPriceMicroUsd,
        perp_short_entry_micro_usd: tick.currentPerpPriceMicroUsd,
        delta_drift_bps: 0n,
        current_apr_bps: tick.epochAnnualizedFundingAprBps,
        consecutive_negative_funding_epochs: 0,
        cumulative_yield_micro_usd: newCumulativeYieldMicroUsd,
        status: 'ACTIVE_HARVESTING',
        last_harvest_ms: effectiveHarvestMs,
      };

      if (this.repository) {
        this.repository.upsertCarryPosition(upgradedRecord);
      }

      return {
        action: 'ROTATE_TO_BASIS_ARB_HIGH_FUNDING',
        strategyType: 'FUNDING_BASIS_ARB',
        deltaDriftBps: 0n,
        rebalancedUnitsDeltaMicro: newMatchedUnitsMicro,
        harvestedYieldThisTickMicroUsd: harvestedYieldMicroUsd,
        cumulativeYieldMicroUsd: newCumulativeYieldMicroUsd,
        effectiveAprBps: tick.epochAnnualizedFundingAprBps,
        consecutiveNegativeEpochs: 0,
        updatedRecord: upgradedRecord,
      };
    }

    // 5. Si permanece en STABLE_CONCENTRATED_LP -> Solo cosechar rendimiento estable
    if (existing.strategy_type === 'STABLE_CONCENTRATED_LP') {
      const stableRecord: AetherCarryLedgerRecord = {
        ...existing,
        current_apr_bps: tick.stableVaultFallbackAprBps,
        consecutive_negative_funding_epochs: consecutiveNegEpochs,
        cumulative_yield_micro_usd: newCumulativeYieldMicroUsd,
        last_harvest_ms: effectiveHarvestMs,
      };

      if (this.repository) {
        this.repository.upsertCarryPosition(stableRecord);
      }

      return {
        action: 'HARVEST_STABLE_VAULT',
        strategyType: 'STABLE_CONCENTRATED_LP',
        deltaDriftBps: 0n,
        rebalancedUnitsDeltaMicro: 0n,
        harvestedYieldThisTickMicroUsd: harvestedYieldMicroUsd,
        cumulativeYieldMicroUsd: newCumulativeYieldMicroUsd,
        effectiveAprBps: tick.stableVaultFallbackAprBps,
        consecutiveNegativeEpochs: consecutiveNegEpochs,
        updatedRecord: stableRecord,
      };
    }

    // 6. Estamos en FUNDING_BASIS_ARB -> Auditar neutralidad Delta (umbral estricto <= 15 bps)
    const currentDriftBps = this.computeDeltaDriftBps(
      tick.currentSpotUnitsMicro,
      tick.currentPerpShortUnitsMicro
    );

    // 6a. Verificación de Riesgo de Liquidación en Perp Short ante Rally Violento
    const spotEntry = existing.spot_entry_price_micro_usd;
    const currentSpot = tick.currentSpotPriceMicroUsd;
    if (spotEntry > 0n && currentSpot > spotEntry) {
      const rallyBps = ((currentSpot - spotEntry) * 10000n) / spotEntry;
      const marginRemainingBps = rallyBps < 10000n ? 10000n - rallyBps : 0n;

      if (marginRemainingBps < DeltaNeutralCarryEngine.MIN_PERP_MARGIN_HEALTH_BPS) {
        // Alerta de margen colateral bajo (< 2500 bps / 25% restante): rebalanceo defensivo
        const defenseRecord: AetherCarryLedgerRecord = {
          ...existing,
          spot_units_micro: tick.currentSpotUnitsMicro,
          perp_short_units_micro: tick.currentSpotUnitsMicro,
          delta_drift_bps: 0n,
          current_apr_bps: tick.epochAnnualizedFundingAprBps,
          consecutive_negative_funding_epochs: consecutiveNegEpochs,
          cumulative_yield_micro_usd: newCumulativeYieldMicroUsd,
          status: 'REBALANCING',
          last_harvest_ms: effectiveHarvestMs,
        };

        if (this.repository) {
          this.repository.upsertCarryPosition(defenseRecord);
        }

        return {
          action: 'REBALANCE_PERP_MARGIN_DEFENSE',
          strategyType: 'FUNDING_BASIS_ARB',
          deltaDriftBps: currentDriftBps,
          rebalancedUnitsDeltaMicro: 0n,
          harvestedYieldThisTickMicroUsd: harvestedYieldMicroUsd,
          cumulativeYieldMicroUsd: newCumulativeYieldMicroUsd,
          effectiveAprBps: tick.epochAnnualizedFundingAprBps,
          consecutiveNegativeEpochs: consecutiveNegEpochs,
          updatedRecord: defenseRecord,
        };
      }
    }

    if (currentDriftBps > DeltaNeutralCarryEngine.MAX_DELTA_DRIFT_BPS) {
      // Rebalancear la pierna Short para igualar exactamente las unidades Spot (Delta = 0)
      const rebalancedDeltaMicro =
        tick.currentSpotUnitsMicro >= tick.currentPerpShortUnitsMicro
          ? tick.currentSpotUnitsMicro - tick.currentPerpShortUnitsMicro
          : tick.currentPerpShortUnitsMicro - tick.currentSpotUnitsMicro;

      const rebalancedRecord: AetherCarryLedgerRecord = {
        ...existing,
        spot_units_micro: tick.currentSpotUnitsMicro,
        perp_short_units_micro: tick.currentSpotUnitsMicro, // Emparejado a 0 bps de drift
        delta_drift_bps: 0n,
        current_apr_bps: tick.epochAnnualizedFundingAprBps,
        consecutive_negative_funding_epochs: consecutiveNegEpochs,
        cumulative_yield_micro_usd: newCumulativeYieldMicroUsd,
        status: 'ACTIVE_HARVESTING',
        last_harvest_ms: effectiveHarvestMs,
      };

      if (this.repository) {
        this.repository.upsertCarryPosition(rebalancedRecord);
      }

      return {
        action: 'REBALANCE_DELTA_DRIFT',
        strategyType: 'FUNDING_BASIS_ARB',
        deltaDriftBps: currentDriftBps,
        rebalancedUnitsDeltaMicro: rebalancedDeltaMicro,
        harvestedYieldThisTickMicroUsd: harvestedYieldMicroUsd,
        cumulativeYieldMicroUsd: newCumulativeYieldMicroUsd,
        effectiveAprBps: tick.epochAnnualizedFundingAprBps,
        consecutiveNegativeEpochs: consecutiveNegEpochs,
        updatedRecord: rebalancedRecord,
      };
    }

    // 7. Delta dentro de tolerancia (<= 15 bps) -> Cosechar Funding Rate y mantener
    const heldRecord: AetherCarryLedgerRecord = {
      ...existing,
      spot_units_micro: tick.currentSpotUnitsMicro,
      perp_short_units_micro: tick.currentPerpShortUnitsMicro,
      delta_drift_bps: currentDriftBps,
      current_apr_bps: tick.epochAnnualizedFundingAprBps,
      consecutive_negative_funding_epochs: consecutiveNegEpochs,
      cumulative_yield_micro_usd: newCumulativeYieldMicroUsd,
      status: 'ACTIVE_HARVESTING',
      last_harvest_ms: effectiveHarvestMs,
    };

    if (this.repository) {
      this.repository.upsertCarryPosition(heldRecord);
    }

    return {
      action: 'HARVEST_AND_HOLD_BASIS',
      strategyType: 'FUNDING_BASIS_ARB',
      deltaDriftBps: currentDriftBps,
      rebalancedUnitsDeltaMicro: 0n,
      harvestedYieldThisTickMicroUsd: harvestedYieldMicroUsd,
      cumulativeYieldMicroUsd: newCumulativeYieldMicroUsd,
      effectiveAprBps: tick.epochAnnualizedFundingAprBps,
      consecutiveNegativeEpochs: consecutiveNegEpochs,
      updatedRecord: heldRecord,
    };
  }
}
