/**
 * NEXUS QUANT SUITE v2.0 - SENTINEL WHALE ASYMMETRIC EXIT & FRONT-RUNNING
 * 
 * Regla Inmutable de Salida Asimétrica:
 * 1. Hard Stop: -8.0% (-800 bps) de pérdida desde precio de entrada.
 * 2. Time-Stop: 12 minutos (720,000 ms) si PnL < +4.0% (+400 bps).
 * 3. De-Risk (+35.0% = +3500 bps): Vende el 75% de los tokens (recupera 100% de capital).
 * 4. Moonbag (25% restante): Trailing Stop del 15.0% (-1500 bps desde precio pico).
 * 5. Salida por Front-Running Defensivo: Si una ballena vende >= 30% de su posición,
 *    se ejecuta venta inmediata con prioridad de gas.
 */

import { calcBpsDelta, applyBpsDiscount } from '../core/math_bigint.js';
export { calcBpsDelta };

export interface SentinelPosition {
  positionId: string;
  tokenAddress: string;
  tokenTicker: string;
  entryPriceMicroUsd: bigint;
  peakPriceMicroUsd: bigint;
  totalTokensAtomic: bigint;
  remainingTokensAtomic: bigint;
  openedAtMs: bigint;
  isDeRisked: boolean; // Si ya se vendió el 75%
  isClosed: boolean;
  venueTrack?: MarketVenueTrack;
  currentStopLossMicroUsd?: bigint;
  isBreakEvenLocked?: boolean;
  isTp1Executed?: boolean;
  isTp2Executed?: boolean;
  orderflowCvdPositive?: boolean;
}

export interface WhaleSellEvent {
  walletAddress: string;
  tokenAddress: string;
  tokensSoldAtomic: bigint;
  walletInitialPositionAtomic: bigint;
  timestampMs: bigint;
}

export interface ExitSignalDecision {
  action: 'HOLD' | 'HARD_STOP' | 'TIME_STOP' | 'DERISK_75PCT' | 'MOONBAG_TRAILING_STOP' | 'WHALE_FRONTRUN_EXIT';
  tokensToSellAtomic: bigint;
  currentPriceMicroUsd: bigint;
  pnlBps: bigint;
  reason: string;
  isGasPriority: boolean;
}

export class SentinelAsymmetricExitManager {
  private readonly hardStopBps: bigint = -800n; // -8.00%
  private readonly timeStopThresholdBps: bigint = 400n; // +4.00%
  private readonly timeStopDurationMs: bigint = 720_000n; // 12 minutos
  private readonly deRiskTargetBps: bigint = 3500n; // +35.00%
  private readonly moonbagTrailingStopBps: bigint = 1500n; // 15.00%
  private readonly whaleDumpThresholdBps: bigint = 3000n; // 30.00%

  /**
   * Evalúa la posición contra ticks de precio actuales (Hard Stop, Time Stop, De-Risk, Trailing Stop)
   */
  public evaluatePriceTick(
    pos: SentinelPosition,
    currentPriceMicroUsd: bigint,
    nowMs: bigint
  ): ExitSignalDecision {
    if (pos.isClosed || pos.remainingTokensAtomic <= 0n) {
      return {
        action: 'HOLD',
        tokensToSellAtomic: 0n,
        currentPriceMicroUsd,
        pnlBps: 0n,
        reason: 'POSITION_ALREADY_CLOSED',
        isGasPriority: false
      };
    }

    // Actualizar precio pico
    if (currentPriceMicroUsd > pos.peakPriceMicroUsd) {
      pos.peakPriceMicroUsd = currentPriceMicroUsd;
    }

    const pnlBps = calcBpsDelta(currentPriceMicroUsd, pos.entryPriceMicroUsd);

    // 1. Hard Stop: PnL <= -800 bps (-8.00%)
    if (pnlBps <= this.hardStopBps) {
      return {
        action: 'HARD_STOP',
        tokensToSellAtomic: pos.remainingTokensAtomic,
        currentPriceMicroUsd,
        pnlBps,
        reason: `HARD_STOP_TRIGGERED: Loss reached ${pnlBps} bps <= -800 bps`,
        isGasPriority: false
      };
    }

    // 2. Time-Stop: 12 minutos transcurridos y PnL < +400 bps (+4.00%)
    const elapsedMs = nowMs - pos.openedAtMs;
    if (elapsedMs >= this.timeStopDurationMs && pnlBps < this.timeStopThresholdBps) {
      return {
        action: 'TIME_STOP',
        tokensToSellAtomic: pos.remainingTokensAtomic,
        currentPriceMicroUsd,
        pnlBps,
        reason: `TIME_STOP_TRIGGERED: Position stagnant after ${elapsedMs / 1000n}s with PnL ${pnlBps} bps < +400 bps`,
        isGasPriority: false
      };
    }

    // 3. De-Risk: Al tocar +35.0% (+3500 bps), vende 75% del principal inicial
    if (!pos.isDeRisked && pnlBps >= this.deRiskTargetBps) {
      const tokens75pct = (pos.totalTokensAtomic * 7500n) / 10000n;
      const sellAmount = tokens75pct > pos.remainingTokensAtomic ? pos.remainingTokensAtomic : tokens75pct;

      // Mutación de estado para activar el Moonbag Trailing Stop
      pos.isDeRisked = true;
      pos.remainingTokensAtomic = pos.remainingTokensAtomic > sellAmount
        ? pos.remainingTokensAtomic - sellAmount
        : 0n;

      return {
        action: 'DERISK_75PCT',
        tokensToSellAtomic: sellAmount,
        currentPriceMicroUsd,
        pnlBps,
        reason: `DERISK_TARGET_REACHED: Gain ${pnlBps} bps >= +3500 bps. Selling 75% to recover 100% of capital.`,
        isGasPriority: false
      };
    }

    // 4. Moonbag Trailing Stop (15% desde el precio pico registrado post De-Risk)
    if (pos.isDeRisked) {
      const trailingFloorPrice = applyBpsDiscount(pos.peakPriceMicroUsd, this.moonbagTrailingStopBps);
      if (currentPriceMicroUsd <= trailingFloorPrice) {
        return {
          action: 'MOONBAG_TRAILING_STOP',
          tokensToSellAtomic: pos.remainingTokensAtomic,
          currentPriceMicroUsd,
          pnlBps,
          reason: `MOONBAG_TRAILING_STOP_TRIGGERED: Price ${currentPriceMicroUsd} dropped 1500 bps below peak ${pos.peakPriceMicroUsd}`,
          isGasPriority: false
        };
      }
    }

    return {
      action: 'HOLD',
      tokensToSellAtomic: 0n,
      currentPriceMicroUsd,
      pnlBps,
      reason: 'POSITION_WITHIN_NORMAL_BOUNDS',
      isGasPriority: false
    };
  }

  /**
   * Front-Running Defensivo ante venta de ballena del pool (>= 30% de su posición)
   */
  public evaluateWhaleActivity(
    pos: SentinelPosition,
    whaleEvent: WhaleSellEvent,
    currentPriceMicroUsd: bigint
  ): ExitSignalDecision {
    if (pos.isClosed || pos.remainingTokensAtomic <= 0n) {
      return {
        action: 'HOLD',
        tokensToSellAtomic: 0n,
        currentPriceMicroUsd,
        pnlBps: 0n,
        reason: 'POSITION_ALREADY_CLOSED',
        isGasPriority: false
      };
    }

    if (pos.tokenAddress.toLowerCase() !== whaleEvent.tokenAddress.toLowerCase()) {
      return {
        action: 'HOLD',
        tokensToSellAtomic: 0n,
        currentPriceMicroUsd,
        pnlBps: 0n,
        reason: 'DIFFERENT_TOKEN',
        isGasPriority: false
      };
    }

    if (whaleEvent.walletInitialPositionAtomic <= 0n) {
      return {
        action: 'HOLD',
        tokensToSellAtomic: 0n,
        currentPriceMicroUsd,
        pnlBps: 0n,
        reason: 'INVALID_WHALE_BALANCE',
        isGasPriority: false
      };
    }

    // Porcentaje vendido por la ballena
    const whaleSoldBps = (whaleEvent.tokensSoldAtomic * 10000n) / whaleEvent.walletInitialPositionAtomic;

    if (whaleSoldBps >= this.whaleDumpThresholdBps) {
      const pnlBps = calcBpsDelta(currentPriceMicroUsd, pos.entryPriceMicroUsd);
      return {
        action: 'WHALE_FRONTRUN_EXIT',
        tokensToSellAtomic: pos.remainingTokensAtomic,
        currentPriceMicroUsd,
        pnlBps,
        reason: `WHALE_DUMP_DETECTED: Whale ${whaleEvent.walletAddress} dumped ${whaleSoldBps} bps (>= 3000 bps) of position. Executing emergency front-run exit with gas priority.`,
        isGasPriority: true
      };
    }

    return {
      action: 'HOLD',
      tokensToSellAtomic: 0n,
      currentPriceMicroUsd,
      pnlBps: 0n,
      reason: 'WHALE_SELL_BELOW_THRESHOLD',
      isGasPriority: false
    };
  }
}

// ============================================================================
// NEXUS QUANT SUITE v4.0 - Dual-Track Adaptive Exit & Smart Time-Guard
// ============================================================================

export type MarketVenueTrack = 'BINANCE_LIQUID_CEX' | 'RAYDIUM_PURE_DEX';

export type SentinelExitAction =
  | 'HOLD'
  | 'ACTIVATE_BREAKEVEN_GUARD'
  | 'TAKE_PROFIT_1_40PCT'
  | 'TAKE_PROFIT_2_35PCT'
  | 'TRAILING_STOP_EXIT'
  | 'SMART_TIME_STOP_MAKER'
  | 'HARD_STOP_LOSS'
  | 'WHALE_FRONTRUN_EXIT';

export interface SentinelPositionState {
  positionId: string;
  venueTrack: MarketVenueTrack;
  openedAtMs: bigint;
  entryPriceMicroUsd: bigint;
  peakPriceMicroUsd: bigint;
  currentStopLossMicroUsd: bigint;
  initialTokensAtomic: bigint;
  remainingTokensAtomic: bigint;
  isBreakEvenLocked: boolean;
  isTp1Executed: boolean;
  isTp2Executed: boolean;
  orderflowCvdPositive: boolean; // True si el volumen neto comprador sigue vivo
}

export interface ExitDecision {
  action: SentinelExitAction;
  tokensToSellAtomic: bigint;
  executionStyle: 'MARKET_IOC' | 'LIMIT_POST_ONLY_20S' | 'NONE';
  newStopLossMicroUsd?: bigint;
  reason: string;
}

export function applyBpsOffset(priceMicro: bigint, bpsOffset: bigint): bigint {
  return (priceMicro * (10_000n + bpsOffset)) / 10_000n;
}

export class AdaptiveSentinelExitEngine {
  // Parámetros diferenciados por Pista de Liquidez (en Puntos Básicos: 100n = 1.00%)
  public static readonly PARAMS = {
    BINANCE_LIQUID_CEX: {
      hardStopBps: -180n,          // -1.80% Hard Stop (No -8% en pares líquidos)
      breakEvenTriggerBps: 65n,    // +0.65% activa Break-Even Neto
      breakEvenLockBps: 22n,       // Asegura +0.22% (cubre 14 bps de fee + 8 bps profit)
      tp1TriggerBps: 125n,         // +1.25% cobra el primer 40%
      tp2TriggerBps: 280n,         // +2.80% cobra el siguiente 35% (deja 25% Moonbag)
      trailDiscountTp1Bps: 55n,    // Trailing de 0.55% desde el pico tras TP1
      trailDiscountTp2Bps: 85n,    // Trailing de 0.85% desde el pico para el Moonbag
      timeStopMs: 900_000n,        // 15 minutos de maduración
      minAlivePnlBps: 20n,         // +0.20% mínimo para considerar viva la operación
    },
    RAYDIUM_PURE_DEX: {
      hardStopBps: -650n,          // -6.50% Hard Stop en DEX On-Chain
      breakEvenTriggerBps: 400n,   // +4.00% activa Break-Even Neto
      breakEvenLockBps: 80n,       // Asegura +0.80% libre de gas/slippage
      tp1TriggerBps: 900n,         // +9.00% cobra el primer 40%
      tp2TriggerBps: 2200n,        // +22.00% cobra el siguiente 35% (deja 25% Moonbag)
      trailDiscountTp1Bps: 350n,   // Trailing de 3.50% tras TP1
      trailDiscountTp2Bps: 900n,   // Trailing de 9.00% para el Moonbag
      timeStopMs: 720_000n,        // 12 minutos en memecoins/DEX
      minAlivePnlBps: 120n,        // +1.20% mínimo
    },
  } as const;

  public evaluateExit(
    pos: SentinelPositionState,
    currentPriceMicroUsd: bigint,
    nowMs: bigint,
    whaleDumped30Pct: boolean = false
  ): ExitDecision {
    const cfg = AdaptiveSentinelExitEngine.PARAMS[pos.venueTrack];

    // Actualizar máximo histórico (High-Water Mark) de la posición
    if (currentPriceMicroUsd > pos.peakPriceMicroUsd) {
      pos.peakPriceMicroUsd = currentPriceMicroUsd;
    }

    const pnlBps = calcBpsDelta(currentPriceMicroUsd, pos.entryPriceMicroUsd);
    const elapsedMs = nowMs - pos.openedAtMs;

    // 0. FRONT-RUNNING DEFENSIVO: Si la ballena origen vende >= 30%, salida inmediata
    if (whaleDumped30Pct) {
      return {
        action: 'WHALE_FRONTRUN_EXIT',
        tokensToSellAtomic: pos.remainingTokensAtomic,
        executionStyle: 'MARKET_IOC',
        reason: 'Ballena origen liquidando >=30% de posición',
      };
    }

    // 1. STOP-LOSS DINÁMICO O HARD STOP INICIAL
    if (currentPriceMicroUsd <= pos.currentStopLossMicroUsd || pnlBps <= cfg.hardStopBps) {
      return {
        action: pos.isBreakEvenLocked ? 'TRAILING_STOP_EXIT' : 'HARD_STOP_LOSS',
        tokensToSellAtomic: pos.remainingTokensAtomic,
        executionStyle: 'MARKET_IOC',
        reason: pos.isBreakEvenLocked
          ? `Salida en ganancia protegida por Stop Dinámico (${pnlBps} bps)`
          : `Hard Stop alcanzado (${pnlBps} bps)`,
      };
    }

    // 2. ESCALÓN TP2 (+2.80% en CEX / +22.00% en DEX): Vende 35% adicional y deja 25% Moonbag
    if (!pos.isTp2Executed && pnlBps >= cfg.tp2TriggerBps) {
      const tokens35Pct = (pos.initialTokensAtomic * 3500n) / 10_000n;
      const sellQty = tokens35Pct < pos.remainingTokensAtomic ? tokens35Pct : pos.remainingTokensAtomic;

      pos.isTp1Executed = true;
      pos.isTp2Executed = true;
      pos.isBreakEvenLocked = true;
      pos.remainingTokensAtomic -= sellQty; // CORRECCIÓN DEL BUG v3.0: Resta exactamente lo vendido

      const newStop = applyBpsOffset(pos.peakPriceMicroUsd, -cfg.trailDiscountTp2Bps);
      if (newStop > pos.currentStopLossMicroUsd) pos.currentStopLossMicroUsd = newStop;

      return {
        action: 'TAKE_PROFIT_2_35PCT',
        tokensToSellAtomic: sellQty,
        executionStyle: 'LIMIT_POST_ONLY_20S',
        newStopLossMicroUsd: pos.currentStopLossMicroUsd,
        reason: `TP2 alcanzado (${pnlBps} bps). 75% del capital cobrado en USD; 25% Moonbag libre.`,
      };
    }

    // 3. ESCALÓN TP1 (+1.25% en CEX / +9.00% en DEX): Cobra 40% rápido para asegurar flujo de caja
    if (!pos.isTp1Executed && pnlBps >= cfg.tp1TriggerBps) {
      const tokens40Pct = (pos.initialTokensAtomic * 4000n) / 10_000n;
      const sellQty = tokens40Pct < pos.remainingTokensAtomic ? tokens40Pct : pos.remainingTokensAtomic;

      pos.isTp1Executed = true;
      pos.isBreakEvenLocked = true;
      pos.remainingTokensAtomic -= sellQty;

      // Sube el Stop-Loss al nivel de Break-Even Neto o Trailing TP1
      const trailStop = applyBpsOffset(pos.peakPriceMicroUsd, -cfg.trailDiscountTp1Bps);
      const beStop = applyBpsOffset(pos.entryPriceMicroUsd, cfg.breakEvenLockBps);
      pos.currentStopLossMicroUsd = trailStop > beStop ? trailStop : beStop;

      return {
        action: 'TAKE_PROFIT_1_40PCT',
        tokensToSellAtomic: sellQty,
        executionStyle: 'LIMIT_POST_ONLY_20S',
        newStopLossMicroUsd: pos.currentStopLossMicroUsd,
        reason: `TP1 alcanzado (${pnlBps} bps). 40% cobrado y Stop anclado en ganancia.`,
      };
    }

    // 4. ACTIVACIÓN DE BREAK-EVEN NETO (+0.65% en CEX / +4.00% en DEX)
    if (!pos.isBreakEvenLocked && pnlBps >= cfg.breakEvenTriggerBps) {
      pos.isBreakEvenLocked = true;
      pos.currentStopLossMicroUsd = applyBpsOffset(pos.entryPriceMicroUsd, cfg.breakEvenLockBps);

      return {
        action: 'ACTIVATE_BREAKEVEN_GUARD',
        tokensToSellAtomic: 0n,
        executionStyle: 'NONE',
        newStopLossMicroUsd: pos.currentStopLossMicroUsd,
        reason: `Break-Even Neto activado en +${cfg.breakEvenLockBps} bps (Comisiones cubiertas).`,
      };
    }

    // 5. ACTUALIZACIÓN CONTINUA DE TRAILING STOP (Si ya cobró TP1 o TP2)
    if (pos.isTp1Executed) {
      const activeDiscount = pos.isTp2Executed ? cfg.trailDiscountTp2Bps : cfg.trailDiscountTp1Bps;
      const candidateStop = applyBpsOffset(pos.peakPriceMicroUsd, -activeDiscount);
      if (candidateStop > pos.currentStopLossMicroUsd) {
        pos.currentStopLossMicroUsd = candidateStop;
      }
    }

    // 6. EL NUEVO TIME-STOP INTELIGENTE (Solo actúa si NO se ha cobrado TP1 aún)
    if (!pos.isTp1Executed && elapsedMs >= cfg.timeStopMs) {
      // CASO A: La operación está en ganancia neta (> +20 bps en CEX).
      // ¡PROHIBIDO CERRARLA A MERCADO! Ajustamos un Stop ceñido a -15 bps del precio actual para asegurar el verde.
      if (pnlBps >= cfg.minAlivePnlBps) {
        const tightProfitLock = applyBpsOffset(currentPriceMicroUsd, -15n);
        if (tightProfitLock > pos.currentStopLossMicroUsd) {
          pos.currentStopLossMicroUsd = tightProfitLock;
          pos.isBreakEvenLocked = true;
        }
        return {
          action: 'ACTIVATE_BREAKEVEN_GUARD',
          tokensToSellAtomic: 0n,
          executionStyle: 'NONE',
          newStopLossMicroUsd: pos.currentStopLossMicroUsd,
          reason: `Timer cumplido en verde (${pnlBps} bps). En vez de cerrar, se blinda ganancia con Trailing ceñido.`,
        };
      }

      // CASO B: La operación está estancada (< +20 bps) y el Orderflow comprador murió.
      // Salimos con orden Limit Maker (Post-Only) durante 20s para evitar pagar los 14 bps de Taker fee.
      if (!pos.orderflowCvdPositive || elapsedMs >= cfg.timeStopMs + 180_000n) {
        return {
          action: 'SMART_TIME_STOP_MAKER',
          tokensToSellAtomic: pos.remainingTokensAtomic,
          executionStyle: 'LIMIT_POST_ONLY_20S',
          reason: `Impulso agotado tras ${elapsedMs / 1000n}s (${pnlBps} bps) con CVD negativo. Salida Maker sin fricción.`,
        };
      }
    }

    return {
      action: 'HOLD',
      tokensToSellAtomic: 0n,
      executionStyle: 'NONE',
      reason: 'Posición saludable en desarrollo',
    };
  }
}

