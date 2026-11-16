// src/engine_d_vortex/liquidation_reversion_engine.ts
// NEXUS QUANT SUITE v4.0 - Motor D: Caza de Cascadas de Liquidación y Reversión al VWAP (BigInt)

import { calcBpsDelta } from '../core/math_bigint.js';
import { applyBpsOffset } from '../engine_a_sentinel/whale_asymmetric_exit.js';

export interface MarketMicrostructureTick {
  symbol: string;
  timestampMs: bigint;
  priceMicroUsd: bigint;
  vwap15mMicroUsd: bigint;
  realizedVolStdDevBps: bigint; // 1 desviación estándar en bps (ej. 45n = 0.45%)
  rvolScaled: bigint;           // Volumen relativo escalado x100 (ej. 320n = 3.20x volumen normal)
  liquidationSpikeUsdMicro: bigint; // Liquidaciones de largos en los últimos 60s
  bidAbsorptionRatioScaled: bigint; // > 130n indica que las ballenas están absorbiendo la caída con límites en Bid
}

export interface VortexSignal {
  shouldEnterLong: boolean;
  limitBidPriceMicroUsd: bigint;
  takeProfit1MicroUsd: bigint; // Mitad del camino al VWAP
  takeProfit2MicroUsd: bigint; // Toque exacto del VWAP
  hardStopMicroUsd: bigint;
  reason: string;
}

export class VortexLiquidationReversionEngine {
  // Exige desviación >= 2.5 Sigma bajo el VWAP y volumen >= 2.8x
  public static readonly MIN_SIGMA_MULTIPLIER_SCALED = 250n; // 2.50x
  public static readonly MIN_RVOL_SCALED = 280n;             // 2.80x
  public static readonly MIN_ABSORPTION_SCALED = 130n;       // 1.30x Bid/Ask absorption

  public scanForCapitulationWick(tick: MarketMicrostructureTick): VortexSignal {
    const distanceFromVwapBps = calcBpsDelta(tick.priceMicroUsd, tick.vwap15mMicroUsd);

    // Umbral requerido de caída en bps = -(2.5 * Sigma)
    const requiredDropBps = -((tick.realizedVolStdDevBps * VortexLiquidationReversionEngine.MIN_SIGMA_MULTIPLIER_SCALED) / 100n);

    // Condición 1: El precio cayó más de 2.5 desviaciones estándar bajo el VWAP (mínimo -110 bps / -1.10%)
    const isExtremeOversold = distanceFromVwapBps <= requiredDropBps && distanceFromVwapBps <= -110n;

    // Condición 2: Clímax de volumen por liquidaciones forzadas y absorción institucional en el libro L2
    const hasCapitulationVolume = tick.rvolScaled >= VortexLiquidationReversionEngine.MIN_RVOL_SCALED;
    const hasWhaleBidAbsorption = tick.bidAbsorptionRatioScaled >= VortexLiquidationReversionEngine.MIN_ABSORPTION_SCALED;

    if (isExtremeOversold && hasCapitulationVolume && hasWhaleBidAbsorption) {
      // Entrada Post-Only ligeramente por encima del mejor Bid actual (-2 bps) para asegurar ejecución Maker (0% fee)
      const entryPrice = applyBpsOffset(tick.priceMicroUsd, -2n);
      const halfReversionBps = (-distanceFromVwapBps) / 2n;

      return {
        shouldEnterLong: true,
        limitBidPriceMicroUsd: entryPrice,
        takeProfit1MicroUsd: applyBpsOffset(entryPrice, halfReversionBps), // Cobra 50% a mitad de camino al VWAP
        takeProfit2MicroUsd: tick.vwap15mMicroUsd,                         // Cobra el otro 50% en el VWAP
        hardStopMicroUsd: applyBpsOffset(entryPrice, -95n),                // Stop ajustado de -0.95% bajo la mecha
        reason: `Cascada de liquidación detectada (${distanceFromVwapBps} bps vs VWAP, RVOL ${tick.rvolScaled}x). Entrada Maker Post-Only.`,
      };
    }

    return {
      shouldEnterLong: false,
      limitBidPriceMicroUsd: 0n,
      takeProfit1MicroUsd: 0n,
      takeProfit2MicroUsd: 0n,
      hardStopMicroUsd: 0n,
      reason: 'Sin anomalía estadística de liquidación',
    };
  }
}
