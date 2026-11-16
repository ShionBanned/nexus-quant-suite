/**
 * NEXUS QUANT SUITE v2.0 - CATALYST ANCHORED IOC ROUTER
 * 
 * Regla Inmutable de Ejecución Anti-Slippage Tóxico:
 * 1. Panchor = Pmid(t0 - 500ms) obtenido del Ring Buffer.
 * 2. Late-Entry Abort: Si Pactual se alejó de Panchor > 1.20% (Majors) o > 2.80% (Alts),
 *    se prohíbe el disparo directo y se coloca orden límite pasiva al 50% del retroceso por 20s.
 * 3. Barrido Límite IOC con Tope Duro Pcap = Panchor * (1 + deltaMax):
 *    deltaMax = 1.50% (Majors) o 3.20% (Alts).
 * 4. Pre-News Floor Stop incrustado: PSL = Panchor * (1 - 0.0045) (-45 bps).
 * 5. Dead-Man's Switch nativo: cancelAllAfter(5000).
 */

import { calcBpsDelta, applyBpsIncrease, applyBpsDiscount } from '../core/math_bigint.js';

export interface AnchoredRoutingParams {
  orderId: string;
  ticker: string;
  side: 1 | -1;
  isMajor: boolean;
  notionalMicroUsd: bigint;
  anchorPriceMicroUsd: bigint; // Panchor = Pmid(t0 - 500ms)
  currentPriceMicroUsd: bigint;
  timestampMs: bigint;
}

export interface AnchoredIocExecutionOrder {
  orderId: string;
  ticker: string;
  orderType: 'LIMIT_IOC' | 'PULLBACK_PASSIVE_LIMIT' | 'ABORTED_TOO_LATE';
  side: 1 | -1;
  notionalMicroUsd: bigint;
  limitPriceMicroUsd: bigint; // Pcap o Plimit_pullback
  serverStopLossMicroUsd: bigint; // PSL = Panchor - 45 bps
  cancelAllAfterMs: number; // 5000 ms
  reason: string;
}

export class AnchoredIocRouter {
  // Umbrales Late-Entry Abort: 1.20% (120 bps) en Majors, 2.80% (280 bps) en Alts
  private readonly lateEntryThresholdMajorsBps: bigint = 120n;
  private readonly lateEntryThresholdAltsBps: bigint = 280n;

  // Techo duro Pcap (deltaMax): 1.50% (150 bps) en Majors, 3.20% (320 bps) en Alts
  private readonly deltaMaxMajorsBps: bigint = 150n;
  private readonly deltaMaxAltsBps: bigint = 320n;

  // Pre-News Floor Stop: -0.45% (-45 bps) respecto a Panchor
  private readonly preNewsFloorStopBps: bigint = 45n;

  public routeOrder(params: AnchoredRoutingParams): AnchoredIocExecutionOrder {
    const deltaFromAnchorBps = calcBpsDelta(params.currentPriceMicroUsd, params.anchorPriceMicroUsd);
    const absDeltaBps = deltaFromAnchorBps < 0n ? -deltaFromAnchorBps : deltaFromAnchorBps;

    const lateEntryThreshold = params.isMajor
      ? this.lateEntryThresholdMajorsBps
      : this.lateEntryThresholdAltsBps;

    const deltaMaxBps = params.isMajor ? this.deltaMaxMajorsBps : this.deltaMaxAltsBps;

    // 1. Escudo de Piso Pre-Noticia (Pre-News Floor Stop) en Panchor - 45 bps para Compras
    // Si Side = 1 (Long), PSL = Panchor * (1 - 0.0045).
    // Si Side = -1 (Short), PSL = Panchor * (1 + 0.0045).
    const serverStopLoss = params.side === 1
      ? applyBpsDiscount(params.anchorPriceMicroUsd, this.preNewsFloorStopBps)
      : applyBpsIncrease(params.anchorPriceMicroUsd, this.preNewsFloorStopBps);

    // 2. Filtro de Persecución Tardía (Late-Entry Abort)
    if (absDeltaBps > lateEntryThreshold) {
      // Precio ya despegó > umbral. Prohibido comprar a mercado o barrer IOC.
      // Calcula límite pasivo al 50% del impulso del movimiento
      const impulse = params.currentPriceMicroUsd > params.anchorPriceMicroUsd
        ? params.currentPriceMicroUsd - params.anchorPriceMicroUsd
        : params.anchorPriceMicroUsd - params.currentPriceMicroUsd;

      const pullback50Price = params.side === 1
        ? params.currentPriceMicroUsd - (impulse / 2n)
        : params.currentPriceMicroUsd + (impulse / 2n);

      return {
        orderId: params.orderId,
        ticker: params.ticker,
        orderType: 'PULLBACK_PASSIVE_LIMIT',
        side: params.side,
        notionalMicroUsd: params.notionalMicroUsd,
        limitPriceMicroUsd: pullback50Price,
        serverStopLossMicroUsd: serverStopLoss,
        cancelAllAfterMs: 20000, // 20s para orden pasiva de retroceso
        reason: `LATE_ENTRY_ABORT: Price moved ${absDeltaBps} bps from anchor > ${lateEntryThreshold} bps limit. Passive limit placed at 50% impulse pullback (${pullback50Price} uUSD) for 20s.`
      };
    }

    // 3. Barrido Límite IOC con Tope Duro Pcap = Panchor * (1 + deltaMax)
    const pCap = params.side === 1
      ? applyBpsIncrease(params.anchorPriceMicroUsd, deltaMaxBps)
      : applyBpsDiscount(params.anchorPriceMicroUsd, deltaMaxBps);

    return {
      orderId: params.orderId,
      ticker: params.ticker,
      orderType: 'LIMIT_IOC',
      side: params.side,
      notionalMicroUsd: params.notionalMicroUsd,
      limitPriceMicroUsd: pCap,
      serverStopLossMicroUsd: serverStopLoss,
      cancelAllAfterMs: 5000,
      reason: `ANCHORED_IOC_SWEEP: Sending Limit IOC capped at ${pCap} uUSD (+${deltaMaxBps} bps max) with server floor stop at ${serverStopLoss} uUSD.`
    };
  }
}
