/**
 * NEXUS QUANT SUITE v3.0 - SMART PULLBACK SNIPER
 * 
 * Calcula en BigInt puro la distorsión de la mecha de la ballena:
 * - Si impacto <= 85 bps (0.85%) -> Ejecución directa IOC
 * - Si impacto > 85 bps -> Orden límite en Fib 38.2% o VWAP_5m con TTL 60s
 * - Escape roof: si el precio sube > +15% sobre el pico sin retroceder -> Cancela por escape.
 */

import {
  PullbackIntentStatus,
  SentinelPullbackIntentRecord,
  SentinelPullbackIntentRepository,
} from '../core/db_sqlite_wal.js';

export interface WhaleImpactTickInput {
  readonly intentId: string;
  readonly tokenSymbol: string;
  readonly tokenMint: string;
  readonly preWhalePriceMicroUsd: bigint;
  readonly peakImpactPriceMicroUsd: bigint;
  readonly vwap5mMicroUsd: bigint;
  readonly allocatedWeightBps: bigint;
  readonly confluenceCount: number;
  readonly uniqueFundingRoots: readonly string[];
  readonly nowMs: bigint;
}

export interface PullbackPlanResult {
  readonly executionMode: 'DIRECT_IOC_LOW_IMPACT' | 'LIMIT_PULLBACK_TRAP';
  readonly whaleImpactBps: bigint;
  readonly fib382PriceMicroUsd: bigint;
  readonly limitTargetPriceMicroUsd: bigint;
  readonly expiresAtMs: bigint;
  readonly record: SentinelPullbackIntentRecord;
}

export type PullbackTickResolution =
  | 'FILL_TRIGGERED'
  | 'HOLD_WAITING'
  | 'CANCELLED_TTL_EXPIRED'
  | 'CANCELLED_ESCAPED_ROOF';

export interface PullbackEvaluationOutput {
  readonly resolution: PullbackTickResolution;
  readonly fillExecutionPriceMicroUsd: bigint | null;
  readonly updatedStatus: PullbackIntentStatus;
}

export class SmartPullbackSniper {
  public static readonly DIRECT_IMPACT_THRESHOLD_BPS: bigint = 85n;   // 0.85%
  public static readonly FIB_RETRACEMENT_BPS: bigint = 3820n;         // 38.20% de retroceso de mecha
  public static readonly PULLBACK_TTL_MS: bigint = 60_000n;           // 60 segundos máximo de espera
  public static readonly ESCAPE_ROOF_ABOVE_PEAK_BPS: bigint = 1500n;  // +15.00% arriba del pico aborta

  private readonly repository?: SentinelPullbackIntentRepository;

  constructor(repository?: SentinelPullbackIntentRepository) {
    this.repository = repository;
  }

  /**
   * Calcula el precio objetivo de entrada en Pullback (Fib 38.2% vs VWAP_5m) usando BigInt.
   */
  public createEntryIntent(input: WhaleImpactTickInput): PullbackPlanResult {
    if (
      input.preWhalePriceMicroUsd <= 0n ||
      input.peakImpactPriceMicroUsd < input.preWhalePriceMicroUsd
    ) {
      throw new Error('INVALID_WHALE_IMPACT_PRICES: peak must be >= preWhalePrice > 0n');
    }

    const wickDeltaMicro = input.peakImpactPriceMicroUsd - input.preWhalePriceMicroUsd;
    const whaleImpactBps = (wickDeltaMicro * 10000n) / input.preWhalePriceMicroUsd;

    // Retroceso de Fibonacci 38.2%: P_peak - (Delta_Wick * 3820 / 10000)
    const fibRetracementMicro =
      (wickDeltaMicro * SmartPullbackSniper.FIB_RETRACEMENT_BPS) / 10000n;
    const fib382PriceMicroUsd = input.peakImpactPriceMicroUsd - fibRetracementMicro;

    // Piso mínimo de seguridad: jamás ofertar por debajo del precio pre-ballena
    const floorPriceMicroUsd = input.preWhalePriceMicroUsd;

    // El precio objetivo de entrada en retroceso es Fib 38.2% garantizando no perforar el precio pre-ballena
    const calculatedPullbackTargetMicro =
      fib382PriceMicroUsd >= floorPriceMicroUsd ? fib382PriceMicroUsd : floorPriceMicroUsd;

    const isLowImpact = whaleImpactBps <= SmartPullbackSniper.DIRECT_IMPACT_THRESHOLD_BPS;
    const executionMode = isLowImpact ? 'DIRECT_IOC_LOW_IMPACT' : 'LIMIT_PULLBACK_TRAP';
    const limitTargetPriceMicroUsd = isLowImpact
      ? input.peakImpactPriceMicroUsd
      : calculatedPullbackTargetMicro;

    const status: PullbackIntentStatus = isLowImpact
      ? 'EXEC_DIRECT_LOW_IMPACT'
      : 'WAITING_PULLBACK';
    const expiresAtMs = input.nowMs + SmartPullbackSniper.PULLBACK_TTL_MS;

    const record: SentinelPullbackIntentRecord = {
      intent_id: input.intentId,
      token_symbol: input.tokenSymbol,
      token_mint: input.tokenMint,
      confluence_count: input.confluenceCount,
      unique_funding_roots_json: JSON.stringify(input.uniqueFundingRoots),
      pre_whale_price_micro_usd: input.preWhalePriceMicroUsd,
      peak_impact_price_micro_usd: input.peakImpactPriceMicroUsd,
      limit_target_price_micro_usd: limitTargetPriceMicroUsd,
      allocated_weight_bps: input.allocatedWeightBps,
      status,
      created_at_ms: input.nowMs,
      expires_at_ms: expiresAtMs,
    };

    if (this.repository) {
      this.repository.upsertIntent(record);
    }

    return {
      executionMode,
      whaleImpactBps,
      fib382PriceMicroUsd,
      limitTargetPriceMicroUsd,
      expiresAtMs,
      record,
    };
  }

  /**
   * Evalúa cada tick entrante contra una orden de Pullback pendiente.
   * GATILLO DE ABSORCIÓN v4.0: Exige que el precio toque la zona de retroceso Y que exista
   * absorción compradora (CVD_tick > 0n o buyerAbsorption = true) para no atrapar cuchillos cayendo.
   */
  public evaluateMarketTick(
    intent: SentinelPullbackIntentRecord,
    currentAskPriceMicroUsd: bigint,
    nowMs: bigint,
    cvdTickOrAbsorption?: bigint | boolean
  ): PullbackEvaluationOutput {
    // 1. Verificar expiración de la ventana de 60 segundos
    if (nowMs > intent.expires_at_ms) {
      const expiredStatus: PullbackIntentStatus = 'CANCELLED_TTL_EXPIRED';
      if (this.repository) {
        this.repository.updateIntentStatus(intent.intent_id, expiredStatus);
      }
      return {
        resolution: 'CANCELLED_TTL_EXPIRED',
        fillExecutionPriceMicroUsd: null,
        updatedStatus: expiredStatus,
      };
    }

    // 2. Verificar si el precio retrocedió hasta o por debajo de nuestro límite objetivo
    if (currentAskPriceMicroUsd <= intent.limit_target_price_micro_usd) {
      // GATILLO DE ABSORCIÓN ANTI-SELECCIÓN ADVERSA:
      // Si se provee CVD o flag de absorción, debe confirmar que el delta comprador es positivo (> 0).
      // Si no se provee, asume true por compatibilidad hacia atrás.
      const hasAbsorption = cvdTickOrAbsorption === undefined
        ? true
        : typeof cvdTickOrAbsorption === 'boolean'
          ? cvdTickOrAbsorption
          : cvdTickOrAbsorption > 0n;

      if (!hasAbsorption) {
        // En zona de pullback pero la oferta sigue presionando (CVD <= 0). No agarrar cuchillo cayendo.
        return {
          resolution: 'HOLD_WAITING',
          fillExecutionPriceMicroUsd: null,
          updatedStatus: intent.status,
        };
      }

      const filledStatus: PullbackIntentStatus =
        intent.confluence_count >= 2 ? 'SCALED_FULL' : 'FILLED_PROBE';
      if (this.repository) {
        this.repository.updateIntentStatus(intent.intent_id, filledStatus);
      }
      return {
        resolution: 'FILL_TRIGGERED',
        fillExecutionPriceMicroUsd: currentAskPriceMicroUsd,
        updatedStatus: filledStatus,
      };
    }

    // 3. Regla Anti-FOMO: si el precio escapa > +15% por encima del pico sin retroceder, abortar
    const escapeRoofPriceMicro =
      intent.peak_impact_price_micro_usd +
      (intent.peak_impact_price_micro_usd * SmartPullbackSniper.ESCAPE_ROOF_ABOVE_PEAK_BPS) /
        10000n;

    if (currentAskPriceMicroUsd >= escapeRoofPriceMicro) {
      const escapedStatus: PullbackIntentStatus = 'CANCELLED_ESCAPED_ROOF';
      if (this.repository) {
        this.repository.updateIntentStatus(intent.intent_id, escapedStatus);
      }
      return {
        resolution: 'CANCELLED_ESCAPED_ROOF',
        fillExecutionPriceMicroUsd: null,
        updatedStatus: escapedStatus,
      };
    }

    return {
      resolution: 'HOLD_WAITING',
      fillExecutionPriceMicroUsd: null,
      updatedStatus: intent.status,
    };
  }
}
