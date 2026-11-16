/**
 * NEXUS QUANT SUITE v2.0 - CATALYST VELOCITY & DECAY EXIT MANAGER
 * 
 * Regla Inmutable de Salida por Velocidad:
 * 1. Time-Stop 15s: Si PnL < -0.35% (-35 bps) a los 15s -> Cierre inmediato a mercado.
 * 2. Time-Stop 45s: Si PnL < +0.75% (+75 bps) a los 45s -> Cierre inmediato a mercado.
 * 3. De-Risk Asimétrico:
 *    - Al tocar +1.80% (+180 bps) en Majors o +4.00% (+400 bps) en Alts:
 *      * Liquida el 65% de la posición.
 *      * Sube el Stop a Break-Even + 0.25% (+25 bps).
 *      * Activa Trailing Stop Exponencial en el 35% restante:
 *        Ptrail(t) = Ppeak(t) * (1 - max(0.006, 0.022 * e^(-8 * PnL)))
 */

import {
  calcBpsDelta,
  applyBpsIncrease,
  applyBpsDiscount,
  calcExponentialTrailingStopDistanceBps
} from '../core/math_bigint.js';

export interface CatalystPosition {
  positionId: string;
  ticker: string;
  isMajor: boolean;
  side: 1 | -1;
  entryPriceMicroUsd: bigint;
  peakPriceMicroUsd: bigint;
  currentStopLossMicroUsd: bigint;
  totalQuantityAtomic: bigint;
  remainingQuantityAtomic: bigint;
  openedAtMs: bigint;
  isDeRisked: boolean;
  isClosed: boolean;
}

export interface CatalystExitDecision {
  action: 'HOLD' | 'STOP_LOSS_HIT' | 'TIME_STOP_15S' | 'TIME_STOP_45S' | 'DERISK_65PCT' | 'EXPONENTIAL_TRAILING_STOP';
  quantityToCloseAtomic: bigint;
  currentPriceMicroUsd: bigint;
  pnlBps: bigint;
  updatedStopLossMicroUsd?: bigint;
  reason: string;
}

export class CatalystVelocityDecayExitManager {
  private readonly timeStop15sThresholdBps: bigint = -35n; // -0.35%
  private readonly timeStop45sThresholdBps: bigint = 75n; // +0.75%
  private readonly deRiskMajorsTargetBps: bigint = 180n; // +1.80%
  private readonly deRiskAltsTargetBps: bigint = 400n; // +4.00%
  private readonly breakEvenBufferBps: bigint = 25n; // +0.25%

  public evaluate(
    pos: CatalystPosition,
    currentPriceMicroUsd: bigint,
    nowMs: bigint
  ): CatalystExitDecision {
    if (pos.isClosed || pos.remainingQuantityAtomic <= 0n) {
      return {
        action: 'HOLD',
        quantityToCloseAtomic: 0n,
        currentPriceMicroUsd,
        pnlBps: 0n,
        reason: 'POSITION_ALREADY_CLOSED'
      };
    }

    // Actualizar precio pico
    if (pos.side === 1 && currentPriceMicroUsd > pos.peakPriceMicroUsd) {
      pos.peakPriceMicroUsd = currentPriceMicroUsd;
    } else if (pos.side === -1 && currentPriceMicroUsd < pos.peakPriceMicroUsd) {
      pos.peakPriceMicroUsd = currentPriceMicroUsd;
    }

    // Calcular PnL en Puntos Base con denominador fijo en precio de entrada (Shorts y Longs)
    const pnlBps = pos.side === 1
      ? calcBpsDelta(currentPriceMicroUsd, pos.entryPriceMicroUsd)
      : calcBpsDelta(pos.entryPriceMicroUsd * 2n - currentPriceMicroUsd, pos.entryPriceMicroUsd);

    // 1. Verificación de Stop-Loss Nativo en Servidor
    const stopHit = pos.side === 1
      ? currentPriceMicroUsd <= pos.currentStopLossMicroUsd
      : currentPriceMicroUsd >= pos.currentStopLossMicroUsd;

    if (stopHit) {
      return {
        action: 'STOP_LOSS_HIT',
        quantityToCloseAtomic: pos.remainingQuantityAtomic,
        currentPriceMicroUsd,
        pnlBps,
        reason: `SERVER_STOP_LOSS_HIT: Price ${currentPriceMicroUsd} breached stop ${pos.currentStopLossMicroUsd}`
      };
    }

    const elapsedMs = nowMs - pos.openedAtMs;

    // 2. Time-Stop a los 15 Segundos: si PnL <= -0.35% (-35 bps)
    if (elapsedMs >= 15_000n && elapsedMs < 20_000n && pnlBps <= this.timeStop15sThresholdBps) {
      return {
        action: 'TIME_STOP_15S',
        quantityToCloseAtomic: pos.remainingQuantityAtomic,
        currentPriceMicroUsd,
        pnlBps,
        reason: `TIME_STOP_15S: PnL ${pnlBps} bps <= -35 bps at 15s mark. Closing at market.`
      };
    }

    // 3. Time-Stop a los 45 Segundos: si PnL < +0.75% (+75 bps)
    if (elapsedMs >= 45_000n && pnlBps < this.timeStop45sThresholdBps) {
      return {
        action: 'TIME_STOP_45S',
        quantityToCloseAtomic: pos.remainingQuantityAtomic,
        currentPriceMicroUsd,
        pnlBps,
        reason: `TIME_STOP_45S: Velocity dead. PnL ${pnlBps} bps < +75 bps after 45s. Closing at market.`
      };
    }

    // 4. De-Risk Asimétrico: Liquidación del 65% de la posición
    const deRiskTarget = pos.isMajor ? this.deRiskMajorsTargetBps : this.deRiskAltsTargetBps;

    if (!pos.isDeRisked && pnlBps >= deRiskTarget) {
      const qty65pct = (pos.totalQuantityAtomic * 6500n) / 10000n;
      const closeAmount = qty65pct > pos.remainingQuantityAtomic ? pos.remainingQuantityAtomic : qty65pct;

      // Mutación de estado para activar el Trailing Stop en el 35% restante
      pos.isDeRisked = true;
      pos.remainingQuantityAtomic = pos.remainingQuantityAtomic > closeAmount
        ? pos.remainingQuantityAtomic - closeAmount
        : 0n;

      // Subir Stop a Break-Even + 0.25%
      const newStop = pos.side === 1
        ? applyBpsIncrease(pos.entryPriceMicroUsd, this.breakEvenBufferBps)
        : applyBpsDiscount(pos.entryPriceMicroUsd, this.breakEvenBufferBps);
      pos.currentStopLossMicroUsd = newStop;

      return {
        action: 'DERISK_65PCT',
        quantityToCloseAtomic: closeAmount,
        currentPriceMicroUsd,
        pnlBps,
        updatedStopLossMicroUsd: newStop,
        reason: `DERISK_ACHIEVED: PnL ${pnlBps} bps >= target ${deRiskTarget} bps. Liquidating 65%, moving stop to BE+25bps.`
      };
    }

    // 5. Trailing Stop Exponencial sobre el 35% restante
    if (pos.isDeRisked) {
      const trailDistanceBps = calcExponentialTrailingStopDistanceBps(pnlBps);
      const trailFloorPrice = pos.side === 1
        ? applyBpsDiscount(pos.peakPriceMicroUsd, trailDistanceBps)
        : applyBpsIncrease(pos.peakPriceMicroUsd, trailDistanceBps);

      const trailHit = pos.side === 1
        ? currentPriceMicroUsd <= trailFloorPrice
        : currentPriceMicroUsd >= trailFloorPrice;

      if (trailHit) {
        return {
          action: 'EXPONENTIAL_TRAILING_STOP',
          quantityToCloseAtomic: pos.remainingQuantityAtomic,
          currentPriceMicroUsd,
          pnlBps,
          reason: `EXPONENTIAL_TRAILING_STOP_HIT: Price ${currentPriceMicroUsd} breached dynamic trail ${trailFloorPrice} (distance ${trailDistanceBps} bps)`
        };
      }
    }

    return {
      action: 'HOLD',
      quantityToCloseAtomic: 0n,
      currentPriceMicroUsd,
      pnlBps,
      reason: 'POSITION_HEALTHY'
    };
  }
}

// ============================================================================
// NEXUS QUANT SUITE v4.0 - Micro-Scalping News Exit (Zero Float / BigInt)
// ============================================================================

import { applyBpsOffset } from '../engine_a_sentinel/whale_asymmetric_exit.js';

export interface CatalystPositionState {
  positionId: string;
  isMajorAsset: boolean; // true = BTC/ETH/SOL/BNB, false = Mid-Cap Altcoin
  openedAtMs: bigint;
  entryPriceMicroUsd: bigint;
  peakPriceMicroUsd: bigint;
  currentStopLossMicroUsd: bigint;
  initialQuantityAtomic: bigint;
  remainingQuantityAtomic: bigint;
  isDeRisked: boolean;
  l2OrderbookImbalanceBps: bigint; // Positivo = presión compradora en libro L2
}

export interface CatalystVelocityExitDecision {
  action: string;
  quantityAtomic: bigint;
  newStopMicroUsd?: bigint;
}

export class CatalystVelocityExitEngine {
  public evaluate(
    pos: CatalystPositionState,
    currentPriceMicroUsd: bigint,
    nowMs: bigint
  ): CatalystVelocityExitDecision {
    if (currentPriceMicroUsd > pos.peakPriceMicroUsd) {
      pos.peakPriceMicroUsd = currentPriceMicroUsd;
    }

    const elapsedMs = nowMs - pos.openedAtMs;
    const pnlBps = calcBpsDelta(currentPriceMicroUsd, pos.entryPriceMicroUsd);

    // 1. Micro-Timer 15s: Solo aborta si la noticia fue un Fakeout severo (<= -45 bps y libro L2 vendedor)
    if (elapsedMs >= 15_000n && elapsedMs < 25_000n && pnlBps <= -45n && pos.l2OrderbookImbalanceBps < 0n) {
      return { action: 'FAKEOUT_ABORT_15S', quantityAtomic: pos.remainingQuantityAtomic };
    }

    // 2. Stop-Loss o Trailing Stop tocado
    if (currentPriceMicroUsd <= pos.currentStopLossMicroUsd) {
      return {
        action: pos.isDeRisked ? 'PROFIT_TRAIL_STOP' : 'L2_ANCHORED_STOP_LOSS',
        quantityAtomic: pos.remainingQuantityAtomic,
      };
    }

    // 3. Toma de Ganancia Rápida Asimétrica (De-Risk del 60%):
    // En Majors cobra rápido en +0.55% (55n bps); en Alts en +1.20% (120n bps)
    const targetDeRiskBps = pos.isMajorAsset ? 55n : 120n;
    if (!pos.isDeRisked && pnlBps >= targetDeRiskBps) {
      const sell60Pct = (pos.initialQuantityAtomic * 6000n) / 10_000n;
      pos.isDeRisked = true;
      pos.remainingQuantityAtomic -= sell60Pct;
      // Ancla el Stop del 40% restante en +25 bps (ganancia neta blindada)
      pos.currentStopLossMicroUsd = applyBpsOffset(pos.entryPriceMicroUsd, 25n);

      return {
        action: 'DERISK_60PCT_CASHFLOW',
        quantityAtomic: sell60Pct,
        newStopMicroUsd: pos.currentStopLossMicroUsd,
      };
    }

    // 4. Micro-Timer 60s Inteligente (Reemplaza al antiguo Time-Stop suicida de 45s):
    // Si a los 60 segundos va ganando >= +22 bps, NO CIERRA: sube el Stop a Break-Even (+16 bps).
    // Solo cierra si tras 60s el PnL es < +16 bps y la presión compradora en L2 desapareció.
    if (!pos.isDeRisked && elapsedMs >= 60_000n) {
      if (pnlBps >= 22n) {
        const safeStop = applyBpsOffset(pos.entryPriceMicroUsd, 16n);
        if (safeStop > pos.currentStopLossMicroUsd) pos.currentStopLossMicroUsd = safeStop;
        return { action: 'LOCK_PROFIT_FLOOR_60S', quantityAtomic: 0n, newStopMicroUsd: pos.currentStopLossMicroUsd };
      }
      if (pos.l2OrderbookImbalanceBps <= 500n) {
        return { action: 'VELOCITY_EXHAUSTED_MAKER_EXIT', quantityAtomic: pos.remainingQuantityAtomic };
      }
    }

    // 5. Trailing Stop Dinámico sobre el 40% restante (cierra si retrocede 30 bps desde el pico)
    if (pos.isDeRisked) {
      const trailStop = applyBpsOffset(pos.peakPriceMicroUsd, pos.isMajorAsset ? -30n : -65n);
      if (trailStop > pos.currentStopLossMicroUsd) {
        pos.currentStopLossMicroUsd = trailStop;
      }
    }

    return { action: 'HOLD', quantityAtomic: 0n };
  }
}

