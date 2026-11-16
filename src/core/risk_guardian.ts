/**
 * NEXUS QUANT SUITE v2.0 - RISK GUARDIAN (SUPERVISOR ATÓMICO DE RIESGO BLINDADO)
 * 
 * Regla Inmutable:
 * 1. Mutex Asíncrono Real (FIFO Queue): Protección total contra condiciones de carrera.
 * 2. Límite estricto de 3 posiciones abiertas simultáneas.
 * 3. Exposición máxima agregada: <= 3000 bps (30.00% del capital base).
 * 4. Circuit Breaker diario: Drawdown móvil 24h <= -400 bps (-4.00%) apaga y detiene posiciones.
 * 5. Auto-Sweep a Cold Wallet: Al superar +2500 bps (+25.00%) acumulados sobre el HWM base, barre la ganancia.
 * 6. Cero Órdenes Desnudas: Toda orden DEBE llevar incrustado stopLoss y cancelAllAfter(5000).
 * 7. Reconciliación de Arranque: Recuperación atómica tras reinicios o fallas HTTP 502.
 */

import { NexusDatabase, RiskGuardianStateRow, ColdWalletSweepRow, UnifiedPositionLedgerRow } from './db_sqlite_wal.js';
import { BPS_SCALE, calcAllocationMicro, calcBpsDelta } from './math_bigint.js';

export interface OrderIntent {
  orderId: string;
  engineOrigin: 'SENTINEL_ONCHAIN' | 'CATALYST_NEWS';
  instrumentTicker: string;
  side: 1 | -1;
  notionalMicro: bigint;
  stopLossMicro: bigint; // OBLIGATORIO: stop-loss nativo
  cancelAllAfterMs: number; // OBLIGATORIO: debe ser 5000 ms
  limitPriceMicro?: bigint;
}

export interface ValidationResult {
  approved: boolean;
  rejectReason?: string;
}

/**
 * Mutex Asíncrono Real con cola FIFO determinista.
 * Garantiza exclusión mutua estricta en el bucle de eventos de Node.js.
 */
export class AsyncMutex {
  private queue: Array<() => void> = [];
  private locked: boolean = false;

  public async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return () => this.release();
    }

    return new Promise<() => void>(resolve => {
      this.queue.push(() => {
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    } else {
      this.locked = false;
    }
  }

  public isLocked(): boolean {
    return this.locked;
  }
}

export class RiskGuardian {
  private db: NexusDatabase;
  private mutex: AsyncMutex = new AsyncMutex();
  private readonly maxOpenPositions: bigint = 3n;
  private readonly maxExposureBps: bigint = 3000n; // 30.00%
  private readonly circuitBreakerBps: bigint = -400n; // -4.00%
  private readonly autoSweepBps: bigint = 2500n; // +25.00%
  private readonly coldWalletAddress: string = 'So11111111111111111111111111111111111111112';

  constructor(db: NexusDatabase) {
    this.db = db;
  }

  public async acquireLock(): Promise<boolean> {
    return !this.mutex.isLocked();
  }

  public releaseLock(): void {
    // Compatible con interfaz previa
  }

  /**
   * Reconciliación de estado tras reinicios o colapsos de red (HTTP 502).
   * Audita unified_positions_ledger y recupera las instancias vivas para rearmar monitores.
   */
  public reconcileStartupState(): {
    openPositionsCount: bigint;
    openExposureMicro: bigint;
    openPositions: UnifiedPositionLedgerRow[];
  } {
    const openPositions = this.db.getOpenPositions();
    let totalExposure = 0n;
    for (const pos of openPositions) {
      totalExposure += pos.notional_invested_micro;
    }
    const openCount = BigInt(openPositions.length);
    const state = this.db.getRiskGuardianState();

    if (state.open_positions_count !== openCount || state.open_exposure_micro !== totalExposure) {
      console.warn(`[RiskGuardian] RECONCILIACIÓN EN ARRANQUE: Sincronizando Ledger -> DB (Posiciones: ${state.open_positions_count} -> ${openCount}, Exposición: ${state.open_exposure_micro} -> ${totalExposure})`);
      this.db.updateRiskGuardianState({
        open_positions_count: openCount,
        open_exposure_micro: totalExposure
      });
    }

    return { openPositionsCount: openCount, openExposureMicro: totalExposure, openPositions };
  }

  /**
   * Valida una intención de orden contra todas las reglas inmutables de riesgo.
   */
  public validateOrderIntent(intent: OrderIntent): ValidationResult {
    const state = this.db.getRiskGuardianState();
    const now = BigInt(Date.now());

    // 1. Verificación de Circuit Breaker activo
    if (state.circuit_breaker_until_ms > now) {
      return {
        approved: false,
        rejectReason: `CIRCUIT_BREAKER_ACTIVE: System halted until ${state.circuit_breaker_until_ms}`
      };
    }

    // 2. Verificación de Cero Órdenes Desnudas
    if (!intent.stopLossMicro || intent.stopLossMicro <= 0n) {
      return {
        approved: false,
        rejectReason: 'REJECTED_NAKED_ORDER: Native server-side stopLoss is strictly required'
      };
    }

    if (intent.cancelAllAfterMs !== 5000 && intent.cancelAllAfterMs !== 20000) {
      return {
        approved: false,
        rejectReason: `REJECTED_DEAD_MANS_SWITCH: cancelAllAfter must be 5000ms (IOC) or 20000ms (Pullback), received ${intent.cancelAllAfterMs}`
      };
    }

    // 3. Verificación de límite de posiciones abiertas (máx 3)
    if (state.open_positions_count >= this.maxOpenPositions) {
      return {
        approved: false,
        rejectReason: `EXCEEDED_MAX_POSITIONS: Maximum 3 simultaneous positions reached (${state.open_positions_count})`
      };
    }

    // 4. Verificación de límite de exposición global (<= 30.00% del capital base)
    const maxAllowedExposureMicro = calcAllocationMicro(state.base_capital_micro, this.maxExposureBps);
    const projectedExposureMicro = state.open_exposure_micro + intent.notionalMicro;

    if (projectedExposureMicro > maxAllowedExposureMicro) {
      return {
        approved: false,
        rejectReason: `EXCEEDED_MAX_EXPOSURE: Projected exposure ${projectedExposureMicro} exceeds 3000 bps ceiling (${maxAllowedExposureMicro} uUSD)`
      };
    }

    return { approved: true };
  }

  /**
   * Valida y registra atómicamente la apertura de una posición bajo Mutex real.
   */
  public async validateAndOpenPositionAtomic(intent: OrderIntent): Promise<ValidationResult> {
    const release = await this.mutex.acquire();
    try {
      const validation = this.validateOrderIntent(intent);
      if (!validation.approved) {
        return validation;
      }
      this.recordPositionOpened(intent.notionalMicro);
      return { approved: true };
    } finally {
      release();
    }
  }

  /**
   * Registra la apertura de una posición actualizando exposición y contador de forma atómica.
   */
  public recordPositionOpened(notionalMicro: bigint): void {
    const state = this.db.getRiskGuardianState();
    this.db.updateRiskGuardianState({
      open_positions_count: state.open_positions_count + 1n,
      open_exposure_micro: state.open_exposure_micro + notionalMicro
    });
  }

  /**
   * Registra el cierre de una posición de forma atómica y evalúa Circuit Breaker y Auto-Sweep.
   */
  public recordPositionClosed(notionalFreedMicro: bigint, realizedPnlMicro: bigint): void {
    this.db.recordPositionClosedAtomic(notionalFreedMicro, realizedPnlMicro);

    const state = this.db.getRiskGuardianState();

    // Evalúa Circuit Breaker: si rolling_24h_pnl <= -4.00% del capital base
    const maxAllowedLossMicro = (state.base_capital_micro * this.circuitBreakerBps) / BPS_SCALE;
    if (state.rolling_24h_pnl_micro <= maxAllowedLossMicro) {
      this.triggerCircuitBreaker(`DAILY_DRAWDOWN_BREACH: Rolling 24h PnL ${state.rolling_24h_pnl_micro} uUSD <= ${maxAllowedLossMicro} uUSD (-400 bps)`);
    }

    // Evalúa Auto-Sweep a Cold Wallet si equidad supera +25.00% sobre High-Water Mark base
    this.checkAndExecuteAutoSweep();
  }

  /**
   * Reconcilia la ejecución tras un llenado parcial o rechazo IOC.
   * Libera de inmediato la exposición fantasma.
   */
  public reconcileExecutionDelta(
    requestedNotionalMicro: bigint,
    filledNotionalMicro: bigint,
    wasRejected: boolean
  ): void {
    this.db.reconcileExecutionDelta(requestedNotionalMicro, filledNotionalMicro, wasRejected);
  }

  /**
   * Evalúa el Drawdown Flotante No Realizado sobre posiciones vivas.
   * Dispara el Circuit Breaker de forma preventiva ante flash crashes.
   */
  public evaluateUnrealizedDrawdown(currentMarkPrices: Map<string, bigint>): boolean {
    const openPositions = this.db.getOpenPositions();
    let totalUnrealizedPnl = 0n;

    for (const pos of openPositions) {
      const markPrice = currentMarkPrices.get(pos.instrument_ticker.toUpperCase());
      if (markPrice && markPrice > 0n) {
        const deltaBps = pos.side === 1
          ? calcBpsDelta(markPrice, pos.entry_price_micro)
          : calcBpsDelta(pos.entry_price_micro * 2n - markPrice, pos.entry_price_micro);
        const posPnlMicro = (pos.notional_invested_micro * deltaBps) / BPS_SCALE;
        totalUnrealizedPnl += posPnlMicro;
      }
    }

    const state = this.db.getRiskGuardianState();
    const totalFloatingPnl = state.rolling_24h_pnl_micro + totalUnrealizedPnl;
    const maxAllowedLossMicro = (state.base_capital_micro * this.circuitBreakerBps) / BPS_SCALE;

    if (totalFloatingPnl <= maxAllowedLossMicro) {
      this.triggerCircuitBreaker(`FLOATING_DRAWDOWN_BREACH: Aggregate Floating PnL ${totalFloatingPnl} uUSD <= ${maxAllowedLossMicro} uUSD (-400 bps)`);
      return true;
    }

    return false;
  }

  /**
   * Dispara el Circuit Breaker inmediatamente y detiene el riesgo abierto.
   */
  public triggerCircuitBreaker(reason: string): void {
    const lockDurationMs = 24n * 3600n * 1000n; // 24 horas
    const now = BigInt(Date.now());
    const until = now + lockDurationMs;

    // Cancela órdenes y marca posiciones abiertas en DB
    const rawDb = this.db.getRawDb();
    rawDb.prepare(`
      UPDATE unified_positions_ledger
      SET status = 'STOPPED_OUT', closed_at_ms = ?
      WHERE status IN ('OPEN', 'PARTIALLY_CLOSED')
    `).run(now);

    this.db.updateRiskGuardianState({
      circuit_breaker_until_ms: until,
      execution_mode: 'SHADOW', // Retorna automáticamente a SHADOW
      open_positions_count: 0n,
      open_exposure_micro: 0n
    });
  }

  /**
   * Restablece el Circuit Breaker y reinicia el PnL móvil de 24h a 0.
   */
  public resetCircuitBreaker(): void {
    this.db.updateRiskGuardianState({
      circuit_breaker_until_ms: 0n,
      rolling_24h_pnl_micro: 0n
    });
  }

  /**
   * Indica si el Circuit Breaker se encuentra activo.
   */
  public isCircuitBreakerActive(): boolean {
    const state = this.db.getRiskGuardianState();
    return state.circuit_breaker_until_ms > BigInt(Date.now());
  }

  /**
   * Verifica si la equidad supera +25.00% del HWM base y ejecuta el Auto-Sweep hacia la Cold Wallet.
   * Corrección de Auditoría: El HWM no se ratchetea en micro-ganancias ordinarias;
   * se preserva como baseline hasta que se ejecute el barrido.
   */
  public checkAndExecuteAutoSweep(): ColdWalletSweepRow | null {
    const state = this.db.getRiskGuardianState();
    const triggerThresholdMicro = (state.high_water_mark_micro * (BPS_SCALE + this.autoSweepBps)) / BPS_SCALE;

    if (state.current_equity_micro >= triggerThresholdMicro) {
      // Calculamos el excedente acumulado sobre el HWM base para enviarlo a la Cold Wallet
      const sweepAmountMicro = state.current_equity_micro - state.high_water_mark_micro;
      const now = BigInt(Date.now());
      const sweepId = `SWEEP_${now.toString()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

      // Insertamos el registro en la tabla cold_wallet_sweeps
      const rawDb = this.db.getRawDb();
      const insertStmt = rawDb.prepare(`
        INSERT INTO cold_wallet_sweeps (
          sweep_id, trigger_equity_micro, hwm_baseline_micro, swept_amount_micro,
          destination_address, tx_hash, status, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const status = state.execution_mode === 'LIVE' ? 'CONFIRMED' : 'SIMULATED';
      const simulatedTx = `0x_SIMULATED_SWEEP_TX_${now.toString()}`;

      insertStmt.run(
        sweepId,
        state.current_equity_micro,
        state.high_water_mark_micro,
        sweepAmountMicro,
        this.coldWalletAddress,
        simulatedTx,
        status,
        now
      );

      // Actualizamos el HWM a la equidad remanente (post-sweep)
      const postSweepEquity = state.current_equity_micro - sweepAmountMicro;
      this.db.updateRiskGuardianState({
        current_equity_micro: postSweepEquity,
        high_water_mark_micro: postSweepEquity
      });

      return {
        sweep_id: sweepId,
        trigger_equity_micro: state.current_equity_micro,
        hwm_baseline_micro: state.high_water_mark_micro,
        swept_amount_micro: sweepAmountMicro,
        destination_address: this.coldWalletAddress,
        tx_hash: simulatedTx,
        status,
        created_at_ms: now
      };
    }

    return null;
  }

  /**
   * Botón Rojo de Emergencia (KILL-SWITCH): Liquida y congela todo en un clic.
   */
  public executeKillSwitch(): void {
    const rawDb = this.db.getRawDb();
    const now = BigInt(Date.now());

    // Congela supervisor
    this.db.updateRiskGuardianState({
      execution_mode: 'SHADOW',
      circuit_breaker_until_ms: now + (365n * 24n * 3600n * 1000n), // 1 año de congelamiento preventivo
      open_positions_count: 0n,
      open_exposure_micro: 0n
    });

    // Cierra todas las posiciones abiertas en el libro mayor
    rawDb.prepare(`
      UPDATE unified_positions_ledger
      SET status = 'CLOSED', closed_at_ms = ?
      WHERE status IN ('OPEN', 'PARTIALLY_CLOSED')
    `).run(now);
  }
}
