/**
 * NEXUS QUANT SUITE v3.0 - ADAPTIVE RVOL TIME STOP
 * 
 * Reemplaza el Time-Stop estático de 12 minutos por un reloj dinámico:
 * - 4 minutos si RVOL < 0.50x o Spread > 2.50% (corte rápido de pool muerto)
 * - 12 minutos estándar si 0.50x <= RVOL < 1.30x
 * - Hasta 45 minutos si RVOL >= 1.30x y Spread <= 0.90% (flujo institucional activo)
 */

export interface RvolTimeStopInput {
  readonly openedAtMs: bigint;
  readonly nowMs: bigint;
  readonly current1mVolumeMicroUsd: bigint;
  readonly sma15mVolume1mMicroUsd: bigint;
  readonly currentSpreadBps: bigint;
  readonly currentPnlBps: bigint;
  readonly isAlreadyDeRisked: boolean;
}

export type TimeStopRegimeBand =
  | 'FAST_KILL_ILLIQUID_4M'
  | 'STANDARD_CLOCK_12M'
  | 'EXTENDED_INSTITUTIONAL_FLOW';

export interface AdaptiveTimeStopDecision {
  readonly shouldClosePosition: boolean;
  readonly reason:
    | 'HOLD_DE_RISKED_MOONBAG'
    | 'HOLD_PNL_ABOVE_EXPANSION_HURDLE'
    | 'HOLD_WITHIN_TIME_BUDGET'
    | 'CLOSE_FAST_KILL_LOW_RVOL_OR_WIDE_SPREAD'
    | 'CLOSE_STANDARD_TIME_STOP_EXPIRED'
    | 'CLOSE_EXTENDED_TIME_STOP_EXPIRED';
  readonly rvolBps: bigint;
  readonly allowedDurationMs: bigint;
  readonly elapsedMs: bigint;
  readonly regimeBand: TimeStopRegimeBand;
}

export class AdaptiveRvolTimeStop {
  public static readonly MIN_TIME_STOP_MS: bigint = 240_000n;       // 4 minutos (RVOL < 0.5x o Spread > 2.5%)
  public static readonly BASE_TIME_STOP_MS: bigint = 720_000n;      // 12 minutos estándar
  public static readonly MAX_TIME_STOP_MS: bigint = 2_700_000n;     // 45 minutos máximo en expansión
  public static readonly EXPANSION_PNL_HURDLE_BPS: bigint = 400n;   // +4.00% PnL mínimo requerido

  public static readonly LOW_RVOL_CUTOFF_BPS: bigint = 5000n;       // 0.50x RVOL
  public static readonly HIGH_RVOL_EXPANSION_BPS: bigint = 13000n;  // 1.30x RVOL
  public static readonly MAX_SAFE_SPREAD_BPS: bigint = 250n;        // 2.50% spread máximo tolerado
  public static readonly TIGHT_SPREAD_CAP_BPS: bigint = 90n;        // 0.90% spread cerrado institucional

  /**
   * Calcula el RVOL en puntos base (1.0x = 10000n bps) y determina si se debe ejecutar el Time-Stop.
   */
  public evaluateTimeStop(input: RvolTimeStopInput): AdaptiveTimeStopDecision {
    const elapsedMs = input.nowMs >= input.openedAtMs ? input.nowMs - input.openedAtMs : 0n;

    const rvolBps =
      input.sma15mVolume1mMicroUsd > 0n
        ? (input.current1mVolumeMicroUsd * 10000n) / input.sma15mVolume1mMicroUsd
        : 0n;

    const { allowedDurationMs, regimeBand } = this.computeDynamicTimeBudgetMs(
      rvolBps,
      input.currentSpreadBps
    );

    // 1. Si la posición ya hizo De-Risk (+35%), el Moonbag del 25% no se cierra por Time-Stop
    if (input.isAlreadyDeRisked) {
      return {
        shouldClosePosition: false,
        reason: 'HOLD_DE_RISKED_MOONBAG',
        rvolBps,
        allowedDurationMs,
        elapsedMs,
        regimeBand,
      };
    }

    // 2. Si el PnL actual supera el umbral de +4.00% (+400 bps) y el pool no está roto en spread
    if (
      input.currentPnlBps >= AdaptiveRvolTimeStop.EXPANSION_PNL_HURDLE_BPS &&
      input.currentSpreadBps <= AdaptiveRvolTimeStop.MAX_SAFE_SPREAD_BPS
    ) {
      return {
        shouldClosePosition: false,
        reason: 'HOLD_PNL_ABOVE_EXPANSION_HURDLE',
        rvolBps,
        allowedDurationMs,
        elapsedMs,
        regimeBand,
      };
    }

    // 3. Evaluar si el tiempo transcurrido superó el presupuesto dinámico asignado
    if (elapsedMs >= allowedDurationMs) {
      const closeReason =
        regimeBand === 'FAST_KILL_ILLIQUID_4M'
          ? 'CLOSE_FAST_KILL_LOW_RVOL_OR_WIDE_SPREAD'
          : regimeBand === 'EXTENDED_INSTITUTIONAL_FLOW'
            ? 'CLOSE_EXTENDED_TIME_STOP_EXPIRED'
            : 'CLOSE_STANDARD_TIME_STOP_EXPIRED';

      return {
        shouldClosePosition: true,
        reason: closeReason,
        rvolBps,
        allowedDurationMs,
        elapsedMs,
        regimeBand,
      };
    }

    return {
      shouldClosePosition: false,
      reason: 'HOLD_WITHIN_TIME_BUDGET',
      rvolBps,
      allowedDurationMs,
      elapsedMs,
      regimeBand,
    };
  }

  public computeDynamicTimeBudgetMs(
    rvolBps: bigint,
    spreadBps: bigint
  ): { allowedDurationMs: bigint; regimeBand: TimeStopRegimeBand } {
    // Banda 1: Pool seco (RVOL < 0.5x) o fractura de liquidez (Spread > 2.50%) -> Corte a los 4 minutos
    if (
      rvolBps < AdaptiveRvolTimeStop.LOW_RVOL_CUTOFF_BPS ||
      spreadBps > AdaptiveRvolTimeStop.MAX_SAFE_SPREAD_BPS
    ) {
      return {
        allowedDurationMs: AdaptiveRvolTimeStop.MIN_TIME_STOP_MS,
        regimeBand: 'FAST_KILL_ILLIQUID_4M',
      };
    }

    // Banda 2: Flujo institucional activo (RVOL >= 1.3x) y Spread comprimido (<= 0.90%) -> Extensión hasta 45m
    if (
      rvolBps >= AdaptiveRvolTimeStop.HIGH_RVOL_EXPANSION_BPS &&
      spreadBps <= AdaptiveRvolTimeStop.TIGHT_SPREAD_CAP_BPS
    ) {
      // +66 segundos (66,000 ms) adicionales por cada +0.1x (1000 bps) sobre 1.0x, topado en 45m
      const excessRvolBps = rvolBps - 10000n;
      const bonusTimeMs = (excessRvolBps * 66_000n) / 1000n;
      const rawExtendedMs = AdaptiveRvolTimeStop.BASE_TIME_STOP_MS + bonusTimeMs;

      const cappedDurationMs =
        rawExtendedMs > AdaptiveRvolTimeStop.MAX_TIME_STOP_MS
          ? AdaptiveRvolTimeStop.MAX_TIME_STOP_MS
          : rawExtendedMs;

      return {
        allowedDurationMs: cappedDurationMs,
        regimeBand: 'EXTENDED_INSTITUTIONAL_FLOW',
      };
    }

    // Banda 3: Régimen estándar -> 12 minutos
    return {
      allowedDurationMs: AdaptiveRvolTimeStop.BASE_TIME_STOP_MS,
      regimeBand: 'STANDARD_CLOCK_12M',
    };
  }
}
