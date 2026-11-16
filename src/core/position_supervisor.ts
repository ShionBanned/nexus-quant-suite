/**
 * NEXUS QUANT SUITE v4.0 - ACTIVE POSITION SUPERVISOR
 * 
 * Supervisor de Ciclo de Vida y Recuperación de Posiciones Huérfanas tras Reinicios:
 * 1. Rehidrata posiciones vivas ('OPEN', 'PARTIALLY_CLOSED') desde SQLite WAL en memoria RAM.
 * 2. Re-arma los monitores de Stop-Loss Nativo, Break-Even Guard, TP1 (40%), TP2 (35%),
 *    Moonbag Trailing Stop Dinámico y Smart Time-Stop (v4.0 Sovereign Cash-Flow).
 * 3. Evalúa en tiempo real cada tick de precio y despacha órdenes de cierre atómicas a RiskGuardian.
 */

import { NexusDatabase, UnifiedPositionLedgerRow } from './db_sqlite_wal.js';
import { RiskGuardian } from './risk_guardian.js';
import {
  SentinelAsymmetricExitManager,
  SentinelPosition,
  AdaptiveSentinelExitEngine,
  SentinelPositionState,
  ExitDecision,
  MarketVenueTrack
} from '../engine_a_sentinel/whale_asymmetric_exit.js';
import {
  CatalystVelocityDecayExitManager,
  CatalystPosition,
  CatalystVelocityExitEngine,
  CatalystPositionState
} from '../engine_b_catalyst/velocity_decay_exit.js';

export interface ExitCallback {
  (positionId: string, action: string, tokensOrQuantityAtomic: bigint, priceMicroUsd: bigint, reason: string): Promise<void> | void;
}

export class ActivePositionSupervisor {
  private db: NexusDatabase;
  private guardian: RiskGuardian;
  private sentinelExitManager: SentinelAsymmetricExitManager;
  private adaptiveSentinelEngine: AdaptiveSentinelExitEngine;
  private catalystExitManager: CatalystVelocityDecayExitManager;
  private catalystVelocityEngine: CatalystVelocityExitEngine;

  private activeSentinelPositions: Map<string, SentinelPosition> = new Map();
  private activeCatalystPositions: Map<string, CatalystPosition> = new Map();

  private onExitTriggered: ExitCallback | null = null;
  private deductTakerFees: boolean = false;

  constructor(db: NexusDatabase, guardian: RiskGuardian) {
    this.db = db;
    this.guardian = guardian;
    this.sentinelExitManager = new SentinelAsymmetricExitManager();
    this.adaptiveSentinelEngine = new AdaptiveSentinelExitEngine();
    this.catalystExitManager = new CatalystVelocityDecayExitManager();
    this.catalystVelocityEngine = new CatalystVelocityExitEngine();
  }

  public setOnExitTriggered(cb: ExitCallback): void {
    this.onExitTriggered = cb;
  }

  public enableTakerFeeDeduction(enabled: boolean = true): void {
    this.deductTakerFees = enabled;
  }

  /**
   * Rehidratación y rearme activo en el arranque del sistema.
   * Rescata todas las posiciones huérfanas en la base de datos.
   */
  public rehydrateAndResumeAll(orphanedRows: UnifiedPositionLedgerRow[]): number {
    let rearmed = 0;

    for (const row of orphanedRows) {
      if (row.engine_origin === 'SENTINEL_ONCHAIN') {
        const pos: SentinelPosition = {
          positionId: row.position_id,
          tokenAddress: row.instrument_ticker,
          tokenTicker: row.instrument_ticker,
          entryPriceMicroUsd: row.entry_price_micro,
          peakPriceMicroUsd: row.peak_price_micro,
          currentStopLossMicroUsd: row.stop_loss_micro,
          totalTokensAtomic: BigInt(row.quantity_atomic),
          remainingTokensAtomic: BigInt(row.quantity_atomic),
          openedAtMs: row.opened_at_ms,
          isDeRisked: row.status === 'PARTIALLY_CLOSED',
          isClosed: false,
          venueTrack: (row.venue_track as MarketVenueTrack) || 'BINANCE_LIQUID_CEX',
          isBreakEvenLocked: row.is_breakeven_locked === 1,
          isTp1Executed: row.is_tp1_executed === 1,
          isTp2Executed: row.is_tp2_executed === 1,
          orderflowCvdPositive: true
        };
        this.activeSentinelPositions.set(row.position_id, pos);
        rearmed++;
      } else if (row.engine_origin === 'CATALYST_NEWS') {
        const isMajor = ['BTC', 'ETH', 'SOL'].some(m => row.instrument_ticker.toUpperCase().includes(m));
        const pos: CatalystPosition = {
          positionId: row.position_id,
          ticker: row.instrument_ticker,
          isMajor,
          side: row.side as 1 | -1,
          entryPriceMicroUsd: row.entry_price_micro,
          peakPriceMicroUsd: row.peak_price_micro,
          currentStopLossMicroUsd: row.stop_loss_micro,
          totalQuantityAtomic: BigInt(row.quantity_atomic),
          remainingQuantityAtomic: BigInt(row.quantity_atomic),
          openedAtMs: row.opened_at_ms,
          isDeRisked: row.status === 'PARTIALLY_CLOSED',
          isClosed: false
        };
        this.activeCatalystPositions.set(row.position_id, pos);
        rearmed++;
      }
    }

    if (rearmed > 0) {
      console.log(`🛡️ [ActivePositionSupervisor] ${rearmed} posiciones rehidratadas con éxito. Monitoreo v4.0 reactivado.`);
    }

    return rearmed;
  }

  public getActivePositionsCount(): number {
    return this.activeSentinelPositions.size + this.activeCatalystPositions.size;
  }

  /**
   * Registra dinámicamente una nueva posición recién abierta para supervisión continua.
   */
  public trackNewPosition(row: UnifiedPositionLedgerRow): void {
    if (row.engine_origin === 'SENTINEL_ONCHAIN') {
      const pos: SentinelPosition = {
        positionId: row.position_id,
        tokenAddress: row.instrument_ticker,
        tokenTicker: row.instrument_ticker,
        entryPriceMicroUsd: row.entry_price_micro,
        peakPriceMicroUsd: row.peak_price_micro,
        currentStopLossMicroUsd: row.stop_loss_micro,
        totalTokensAtomic: BigInt(row.quantity_atomic),
        remainingTokensAtomic: BigInt(row.quantity_atomic),
        openedAtMs: row.opened_at_ms,
        isDeRisked: row.status === 'PARTIALLY_CLOSED',
        isClosed: false,
        venueTrack: (row.venue_track as MarketVenueTrack) || 'BINANCE_LIQUID_CEX',
        isBreakEvenLocked: row.is_breakeven_locked === 1,
        isTp1Executed: row.is_tp1_executed === 1,
        isTp2Executed: row.is_tp2_executed === 1,
        orderflowCvdPositive: true
      };
      this.activeSentinelPositions.set(row.position_id, pos);
    } else if (row.engine_origin === 'CATALYST_NEWS') {
      const isMajor = ['BTC', 'ETH', 'SOL'].some(m => row.instrument_ticker.toUpperCase().includes(m));
      const pos: CatalystPosition = {
        positionId: row.position_id,
        ticker: row.instrument_ticker,
        isMajor,
        side: row.side as 1 | -1,
        entryPriceMicroUsd: row.entry_price_micro,
        peakPriceMicroUsd: row.peak_price_micro,
        currentStopLossMicroUsd: row.stop_loss_micro,
        totalQuantityAtomic: BigInt(row.quantity_atomic),
        remainingQuantityAtomic: BigInt(row.quantity_atomic),
        openedAtMs: row.opened_at_ms,
        isDeRisked: row.status === 'PARTIALLY_CLOSED',
        isClosed: false
      };
      this.activeCatalystPositions.set(row.position_id, pos);
    }
  }

  /**
   * Evalúa el precio de mercado actual contra todas las posiciones vivas activas.
   */
  public async evaluatePriceTick(ticker: string, currentPriceMicroUsd: bigint, nowMs: bigint = BigInt(Date.now())): Promise<void> {
    const upperTicker = ticker.toUpperCase();

    // 1. Evaluar posiciones Sentinel (v4.0 Adaptive Dual-Track)
    for (const [id, pos] of this.activeSentinelPositions.entries()) {
      if (pos.isClosed) continue;
      if (pos.tokenTicker.toUpperCase() === upperTicker || pos.tokenAddress.toUpperCase() === upperTicker) {
        const v4Pos: SentinelPositionState = {
          positionId: pos.positionId,
          venueTrack: pos.venueTrack || 'BINANCE_LIQUID_CEX',
          openedAtMs: pos.openedAtMs,
          entryPriceMicroUsd: pos.entryPriceMicroUsd,
          peakPriceMicroUsd: pos.peakPriceMicroUsd,
          currentStopLossMicroUsd: pos.currentStopLossMicroUsd ?? ((pos.entryPriceMicroUsd * 9200n) / 10000n),
          initialTokensAtomic: pos.totalTokensAtomic,
          remainingTokensAtomic: pos.remainingTokensAtomic,
          isBreakEvenLocked: !!pos.isBreakEvenLocked,
          isTp1Executed: !!pos.isTp1Executed,
          isTp2Executed: !!pos.isTp2Executed,
          orderflowCvdPositive: pos.orderflowCvdPositive ?? true
        };

        const decision = this.adaptiveSentinelEngine.evaluateExit(v4Pos, currentPriceMicroUsd, nowMs);

        if (decision.action !== 'HOLD') {
          await this.executeAdaptiveSentinelAction(id, pos, decision, currentPriceMicroUsd, nowMs);
        }
      }
    }

    // 2. Evaluar posiciones Catalyst (v4.0 Velocity Exit)
    for (const [id, pos] of this.activeCatalystPositions.entries()) {
      if (pos.isClosed) continue;
      if (pos.ticker.toUpperCase() === upperTicker) {
        const v4CatPos: CatalystPositionState = {
          positionId: pos.positionId,
          isMajorAsset: pos.isMajor,
          openedAtMs: pos.openedAtMs,
          entryPriceMicroUsd: pos.entryPriceMicroUsd,
          peakPriceMicroUsd: pos.peakPriceMicroUsd,
          currentStopLossMicroUsd: pos.currentStopLossMicroUsd,
          initialQuantityAtomic: pos.totalQuantityAtomic,
          remainingQuantityAtomic: pos.remainingQuantityAtomic,
          isDeRisked: pos.isDeRisked,
          l2OrderbookImbalanceBps: 0n
        };

        const decision = this.catalystVelocityEngine.evaluate(v4CatPos, currentPriceMicroUsd, nowMs);

        if (decision.action !== 'HOLD') {
          await this.executeAdaptiveCatalystAction(id, pos, decision, currentPriceMicroUsd, nowMs);
        }
      }
    }
  }

  private async executeAdaptiveSentinelAction(
    id: string,
    pos: SentinelPosition,
    decision: ExitDecision,
    priceMicroUsd: bigint,
    nowMs: bigint
  ): Promise<void> {
    const rawDb = this.db.getRawDb();

    // 1. ACTIVACIÓN DE BREAK-EVEN NETO
    if (decision.action === 'ACTIVATE_BREAKEVEN_GUARD') {
      pos.isBreakEvenLocked = true;
      if (decision.newStopLossMicroUsd) {
        pos.currentStopLossMicroUsd = decision.newStopLossMicroUsd;
      }
      rawDb.prepare(`
        UPDATE unified_positions_ledger
        SET is_breakeven_locked = 1, stop_loss_micro = ?, peak_price_micro = ?
        WHERE position_id = ?
      `).run(pos.currentStopLossMicroUsd ?? 0n, pos.peakPriceMicroUsd, id);

      if (this.onExitTriggered) {
        await this.onExitTriggered(id, decision.action, 0n, priceMicroUsd, decision.reason);
      }
      return;
    }

    // 2. TOMA DE GANANCIAS ESCALONADA (TP1 40% o TP2 35%)
    if (decision.action === 'TAKE_PROFIT_1_40PCT' || decision.action === 'TAKE_PROFIT_2_35PCT') {
      const isTp1 = decision.action === 'TAKE_PROFIT_1_40PCT';
      if (isTp1) {
        pos.isTp1Executed = true;
      } else {
        pos.isTp2Executed = true;
      }
      pos.isBreakEvenLocked = true;
      pos.isDeRisked = true;

      const tokensSold = decision.tokensToSellAtomic;
      pos.remainingTokensAtomic = pos.remainingTokensAtomic > tokensSold ? pos.remainingTokensAtomic - tokensSold : 0n;
      if (decision.newStopLossMicroUsd) {
        pos.currentStopLossMicroUsd = decision.newStopLossMicroUsd;
      }

      // Cálculo de PnL parcial para la porción vendida
      const priceDeltaMicroUsd = priceMicroUsd - pos.entryPriceMicroUsd;
      let realizedPnlMicro = (priceDeltaMicroUsd * tokensSold) / 1_000_000_000n;
      const notionalFreed = (pos.entryPriceMicroUsd * tokensSold) / 1_000_000_000n;

      if (this.deductTakerFees) {
        const exitNotionalMicro = (priceMicroUsd * tokensSold) / 1_000_000_000n;
        const entryFee = (notionalFreed * 7n) / 10000n;
        const exitFee = (exitNotionalMicro * 7n) / 10000n;
        realizedPnlMicro = realizedPnlMicro - entryFee - exitFee;
      }

      rawDb.prepare(`
        UPDATE unified_positions_ledger
        SET status = 'PARTIALLY_CLOSED',
            is_tp1_executed = CASE WHEN ? = 1 THEN 1 ELSE is_tp1_executed END,
            is_tp2_executed = CASE WHEN ? = 1 THEN 1 ELSE is_tp2_executed END,
            is_breakeven_locked = 1,
            quantity_atomic = ?,
            stop_loss_micro = ?,
            peak_price_micro = ?,
            realized_pnl_micro = realized_pnl_micro + ?
        WHERE position_id = ?
      `).run(
        isTp1 ? 1 : 0,
        isTp1 ? 0 : 1,
        pos.remainingTokensAtomic.toString(),
        pos.currentStopLossMicroUsd ?? 0n,
        pos.peakPriceMicroUsd,
        realizedPnlMicro.toString(),
        id
      );

      this.guardian.recordPositionClosed(notionalFreed, realizedPnlMicro);

      if (this.onExitTriggered) {
        await this.onExitTriggered(id, decision.action, tokensSold, priceMicroUsd, decision.reason);
      }
      return;
    }

    // 3. CIERRE TOTAL (HARD_STOP_LOSS, TRAILING_STOP_EXIT, SMART_TIME_STOP_MAKER, WHALE_FRONTRUN_EXIT)
    pos.isClosed = true;
    this.activeSentinelPositions.delete(id);

    const isStopped = decision.action === 'HARD_STOP_LOSS';
    const isTimeStopped = decision.action === 'SMART_TIME_STOP_MAKER';
    const status = isStopped ? 'STOPPED_OUT' : (isTimeStopped ? 'TIME_STOPPED' : 'CLOSED');

    const tokensToSell = pos.remainingTokensAtomic > 0n ? pos.remainingTokensAtomic : pos.totalTokensAtomic;
    const priceDeltaMicroUsd = priceMicroUsd - pos.entryPriceMicroUsd;
    let realizedPnlMicro = (priceDeltaMicroUsd * tokensToSell) / 1_000_000_000n;
    const notionalFreed = (pos.entryPriceMicroUsd * tokensToSell) / 1_000_000_000n;

    if (this.deductTakerFees) {
      const exitNotionalMicro = (priceMicroUsd * tokensToSell) / 1_000_000_000n;
      const entryFee = (notionalFreed * 7n) / 10000n;
      const exitFee = (exitNotionalMicro * 7n) / 10000n;
      const networkFriction = 5_000n;
      realizedPnlMicro = realizedPnlMicro - entryFee - exitFee - networkFriction;
    }

    rawDb.prepare(`
      UPDATE unified_positions_ledger
      SET status = ?, closed_at_ms = ?, peak_price_micro = ?,
          realized_pnl_micro = realized_pnl_micro + ?,
          unrealized_pnl_micro = 0, exit_price_micro = ?
      WHERE position_id = ?
    `).run(status, nowMs, pos.peakPriceMicroUsd, realizedPnlMicro.toString(), priceMicroUsd.toString(), id);

    this.guardian.recordPositionClosed(notionalFreed, realizedPnlMicro);

    if (this.onExitTriggered) {
      const reportedAction = isStopped ? 'HARD_STOP' : (isTimeStopped ? 'TIME_STOP' : decision.action);
      await this.onExitTriggered(id, reportedAction, decision.tokensToSellAtomic, priceMicroUsd, decision.reason);
    }
  }

  private async executeAdaptiveCatalystAction(
    id: string,
    pos: CatalystPosition,
    decision: any,
    priceMicroUsd: bigint,
    nowMs: bigint
  ): Promise<void> {
    const rawDb = this.db.getRawDb();

    if (decision.action === 'LOCK_PROFIT_FLOOR_60S') {
      if (decision.newStopMicroUsd) {
        pos.currentStopLossMicroUsd = decision.newStopMicroUsd;
      }
      rawDb.prepare(`
        UPDATE unified_positions_ledger
        SET stop_loss_micro = ?, peak_price_micro = ?
        WHERE position_id = ?
      `).run(pos.currentStopLossMicroUsd, pos.peakPriceMicroUsd, id);

      if (this.onExitTriggered) {
        await this.onExitTriggered(id, decision.action, 0n, priceMicroUsd, 'Profit floor locked at 60s');
      }
      return;
    }

    if (decision.action === 'DERISK_60PCT_CASHFLOW') {
      const soldQty = decision.quantityAtomic;
      pos.isDeRisked = true;
      pos.remainingQuantityAtomic = pos.remainingQuantityAtomic > soldQty ? pos.remainingQuantityAtomic - soldQty : 0n;
      if (decision.newStopMicroUsd) {
        pos.currentStopLossMicroUsd = decision.newStopMicroUsd;
      }

      const notionalFreed = (pos.entryPriceMicroUsd * soldQty) / 1_000_000_000n;
      const isShort = pos.side === -1;
      const priceDelta = isShort ? (pos.entryPriceMicroUsd - priceMicroUsd) : (priceMicroUsd - pos.entryPriceMicroUsd);
      let pnlMicro = (priceDelta * soldQty) / 1_000_000_000n;

      if (this.deductTakerFees) {
        const exitNotionalMicro = (priceMicroUsd * soldQty) / 1_000_000_000n;
        const entryFee = (notionalFreed * 7n) / 10000n;
        const exitFee = (exitNotionalMicro * 7n) / 10000n;
        pnlMicro = pnlMicro - entryFee - exitFee;
      }

      rawDb.prepare(`
        UPDATE unified_positions_ledger
        SET status = 'PARTIALLY_CLOSED', stop_loss_micro = ?, peak_price_micro = ?, quantity_atomic = ?,
            realized_pnl_micro = realized_pnl_micro + ?
        WHERE position_id = ?
      `).run(pos.currentStopLossMicroUsd, pos.peakPriceMicroUsd, pos.remainingQuantityAtomic.toString(), pnlMicro.toString(), id);

      this.guardian.recordPositionClosed(notionalFreed, pnlMicro);

      if (this.onExitTriggered) {
        await this.onExitTriggered(id, decision.action, soldQty, priceMicroUsd, 'De-Risk 60% cash-in achieved');
      }
      return;
    }

    // Cierre total
    pos.isClosed = true;
    this.activeCatalystPositions.delete(id);

    const isStopped = decision.action === 'L2_ANCHORED_STOP_LOSS' || decision.action === 'STOP_LOSS_HIT';
    const isTimeStopped = decision.action.startsWith('TIME_STOP') || decision.action === 'VELOCITY_EXHAUSTED_MAKER_EXIT';
    const status = isStopped ? 'STOPPED_OUT' : (isTimeStopped ? 'TIME_STOPPED' : 'CLOSED');

    const notionalInvested = (pos.entryPriceMicroUsd * pos.totalQuantityAtomic) / 1_000_000_000n;
    const isShort = pos.side === -1;
    const priceDelta = isShort ? (pos.entryPriceMicroUsd - priceMicroUsd) : (priceMicroUsd - pos.entryPriceMicroUsd);
    let pnlMicro = (priceDelta * pos.totalQuantityAtomic) / 1_000_000_000n;

    if (this.deductTakerFees) {
      const exitNotionalMicro = (priceMicroUsd * pos.totalQuantityAtomic) / 1_000_000_000n;
      const entryFee = (notionalInvested * 7n) / 10000n;
      const exitFee = (exitNotionalMicro * 7n) / 10000n;
      const networkFriction = 5_000n;
      pnlMicro = pnlMicro - entryFee - exitFee - networkFriction;
    }

    rawDb.prepare(`
      UPDATE unified_positions_ledger
      SET status = ?, closed_at_ms = ?, peak_price_micro = ?, realized_pnl_micro = realized_pnl_micro + ?, unrealized_pnl_micro = 0, exit_price_micro = ?
      WHERE position_id = ?
    `).run(status, nowMs, pos.peakPriceMicroUsd, pnlMicro.toString(), priceMicroUsd.toString(), id);

    this.guardian.recordPositionClosed(notionalInvested, pnlMicro);

    if (this.onExitTriggered) {
      await this.onExitTriggered(id, decision.action, decision.quantityAtomic ?? pos.remainingQuantityAtomic, priceMicroUsd, status);
    }
  }

  public getActiveCount(): { sentinel: number; catalyst: number } {
    return {
      sentinel: this.activeSentinelPositions.size,
      catalyst: this.activeCatalystPositions.size
    };
  }
}
