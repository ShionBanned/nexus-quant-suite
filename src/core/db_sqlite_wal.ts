/**
 * NEXUS QUANT SUITE v2.0 - PERSISTENCIA SQLITE WAL UNIFICADA (64-BIT INTEGER)
 * 
 * Regla Inmutable: Persistencia en modo WAL con soporte íntegro de enteros de 64 bits (BigInt).
 * Sin punto flotante en base de datos.
 */

import Database, { Database as DatabaseType } from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

export interface RiskGuardianStateRow {
  id: bigint;
  execution_mode: 'SHADOW' | 'LIVE';
  base_capital_micro: bigint;
  current_equity_micro: bigint;
  high_water_mark_micro: bigint;
  open_exposure_micro: bigint;
  open_positions_count: bigint;
  rolling_24h_pnl_micro: bigint;
  circuit_breaker_until_ms: bigint;
  updated_at_ms: bigint;
}

export interface SentinelWalletRow {
  wallet_address: string;
  chain_id: 'SOLANA' | 'BASE' | 'ARBITRUM';
  pool_tier: 'LIVE' | 'SHADOW' | 'PURGED';
  win_rate_bps: bigint;
  profit_factor_scaled: bigint; // Escalado x1000: 1750 = 1.75
  consecutive_losses: number;
  trades_count_7d: number;
  funding_root_hash: string;
  last_rotated_ms: bigint;
}

export interface SentinelConfluenceClusterRow {
  cluster_id: string;
  chain_id: string;
  token_address: string;
  first_seen_ms: bigint;
  base_price_atomic: string; // Serializado como string para atomic nativo
  wallet_count: number;
  wallets_json: string;
  firewall_passed: number; // 0 o 1
  firewall_latency_ms: number | null;
  reject_reason: string | null;
  status: 'WATCHING' | 'PHASE1_25PCT' | 'PHASE2_100PCT' | 'PULLBACK_WAIT' | 'ABORTED';
}

export interface CatalystNewsEventRow {
  event_id: string;
  simhash_64: string;
  primary_ticker: string;
  sympathy_ticker: string | null;
  category: string;
  direction: number; // -1, 0, 1
  ai_score_bps: bigint;
  source_trust_bps: bigint;
  flow_confirm_bps: bigint;
  conviction_ct_bps: bigint;
  pre_event_drift_15m_bps: bigint;
  anchor_price_micro: bigint;
  corroborated_sources: number;
  action_taken: 'STRIKE_T1' | 'PROBE_T2' | 'PANIC_SHORT' | 'QUARANTINE' | 'DROPPED';
  first_published_ms: bigint;
  ingested_at_ms: bigint;
}

export interface UnifiedPositionLedgerRow {
  position_id: string;
  engine_origin: 'SENTINEL_ONCHAIN' | 'CATALYST_NEWS';
  signal_ref_id: string;
  execution_mode: 'SHADOW' | 'LIVE';
  instrument_ticker: string;
  side: number; // 1 = Long, -1 = Short
  phase_allocation_bps: bigint;
  notional_invested_micro: bigint;
  quantity_atomic: string;
  entry_price_micro: bigint;
  stop_loss_micro: bigint;
  trailing_stop_micro: bigint | null;
  take_profit_micro: bigint | null;
  peak_price_micro: bigint;
  status: 'OPEN' | 'PARTIALLY_CLOSED' | 'CLOSED' | 'STOPPED_OUT' | 'TIME_STOPPED';
  realized_pnl_micro: bigint;
  unrealized_pnl_micro: bigint;
  opened_at_ms: bigint;
  closed_at_ms: bigint | null;
  exit_price_micro?: bigint | null;
  venue_track?: 'BINANCE_LIQUID_CEX' | 'RAYDIUM_PURE_DEX';
  is_breakeven_locked?: number;
  is_tp1_executed?: number;
  is_tp2_executed?: number;
}

export interface ColdWalletSweepRow {
  sweep_id: string;
  trigger_equity_micro: bigint;
  hwm_baseline_micro: bigint;
  swept_amount_micro: bigint;
  destination_address: string;
  tx_hash: string | null;
  status: 'PENDING' | 'CONFIRMED' | 'SIMULATED';
  created_at_ms: bigint;
}

export class NexusDatabase {
  private db: DatabaseType;

  constructor(dbPath: string = ':memory:') {
    if (dbPath !== ':memory:') {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new Database(dbPath);
    // Configura enteros nativos en 64-bit BigInt automáticamente
    this.db.defaultSafeIntegers(true);
    this.initPragmas();
    this.createSchema();
  }

  private initPragmas(): void {
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('foreign_keys = ON');
  }

  private createSchema(): void {
    const schemaSql = `
      -- 1. Estado Global del Supervisor Financiero (RiskGuardian - Fila Única ID = 1)
      CREATE TABLE IF NOT EXISTS risk_guardian_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        execution_mode TEXT NOT NULL CHECK (execution_mode IN ('SHADOW', 'LIVE')) DEFAULT 'SHADOW',
        base_capital_micro INTEGER NOT NULL,
        current_equity_micro INTEGER NOT NULL,
        high_water_mark_micro INTEGER NOT NULL,
        open_exposure_micro INTEGER NOT NULL DEFAULT 0,
        open_positions_count INTEGER NOT NULL DEFAULT 0,
        rolling_24h_pnl_micro INTEGER NOT NULL DEFAULT 0,
        circuit_breaker_until_ms INTEGER NOT NULL DEFAULT 0,
        updated_at_ms INTEGER NOT NULL
      );

      -- 2. Motor A (Sentinel): Pool Dinámico de 50 Billeteras (10 LIVE / 40 SHADOW)
      CREATE TABLE IF NOT EXISTS sentinel_wallets_pool (
        wallet_address TEXT PRIMARY KEY,
        chain_id TEXT NOT NULL CHECK (chain_id IN ('SOLANA', 'BASE', 'ARBITRUM')),
        pool_tier TEXT NOT NULL CHECK (pool_tier IN ('LIVE', 'SHADOW', 'PURGED')),
        win_rate_bps INTEGER NOT NULL DEFAULT 0,
        profit_factor_scaled INTEGER NOT NULL DEFAULT 0,
        consecutive_losses INTEGER NOT NULL DEFAULT 0,
        trades_count_7d INTEGER NOT NULL DEFAULT 0,
        funding_root_hash TEXT NOT NULL,
        last_rotated_ms INTEGER NOT NULL
      );

      -- 3. Motor A (Sentinel): Clusters de Confluencia On-Chain (Ventana 15m)
      CREATE TABLE IF NOT EXISTS sentinel_confluence_clusters (
        cluster_id TEXT PRIMARY KEY,
        chain_id TEXT NOT NULL,
        token_address TEXT NOT NULL,
        first_seen_ms INTEGER NOT NULL,
        base_price_atomic TEXT NOT NULL,
        wallet_count INTEGER NOT NULL DEFAULT 1,
        wallets_json TEXT NOT NULL,
        firewall_passed INTEGER NOT NULL DEFAULT 0,
        firewall_latency_ms INTEGER,
        reject_reason TEXT,
        status TEXT NOT NULL CHECK (status IN ('WATCHING', 'PHASE1_25PCT', 'PHASE2_100PCT', 'PULLBACK_WAIT', 'ABORTED'))
      );

      -- 4. Motor B (Catalyst): Eventos de Noticias, SimHash y Matriz de Convicción C_t
      CREATE TABLE IF NOT EXISTS catalyst_news_events (
        event_id TEXT PRIMARY KEY,
        simhash_64 TEXT NOT NULL,
        primary_ticker TEXT NOT NULL,
        sympathy_ticker TEXT,
        category TEXT NOT NULL,
        direction INTEGER NOT NULL CHECK (direction IN (-1, 0, 1)),
        ai_score_bps INTEGER NOT NULL,
        source_trust_bps INTEGER NOT NULL,
        flow_confirm_bps INTEGER NOT NULL,
        conviction_ct_bps INTEGER NOT NULL,
        pre_event_drift_15m_bps INTEGER NOT NULL,
        anchor_price_micro INTEGER NOT NULL,
        corroborated_sources INTEGER NOT NULL DEFAULT 1,
        action_taken TEXT NOT NULL CHECK (action_taken IN ('STRIKE_T1', 'PROBE_T2', 'PANIC_SHORT', 'QUARANTINE', 'DROPPED')),
        first_published_ms INTEGER NOT NULL,
        ingested_at_ms INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_catalyst_simhash ON catalyst_news_events(simhash_64, ingested_at_ms);

      -- 5. Libro Mayor Unificado de Posiciones (Compartido por Motor A y Motor B)
      CREATE TABLE IF NOT EXISTS unified_positions_ledger (
        position_id TEXT PRIMARY KEY,
        engine_origin TEXT NOT NULL CHECK (engine_origin IN ('SENTINEL_ONCHAIN', 'CATALYST_NEWS')),
        signal_ref_id TEXT NOT NULL,
        execution_mode TEXT NOT NULL CHECK (execution_mode IN ('SHADOW', 'LIVE')),
        instrument_ticker TEXT NOT NULL,
        side INTEGER NOT NULL CHECK (side IN (-1, 1)),
        phase_allocation_bps INTEGER NOT NULL,
        notional_invested_micro INTEGER NOT NULL,
        quantity_atomic TEXT NOT NULL,
        entry_price_micro INTEGER NOT NULL,
        stop_loss_micro INTEGER NOT NULL,
        trailing_stop_micro INTEGER,
        take_profit_micro INTEGER,
        peak_price_micro INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('OPEN', 'PARTIALLY_CLOSED', 'CLOSED', 'STOPPED_OUT', 'TIME_STOPPED')),
        realized_pnl_micro INTEGER NOT NULL DEFAULT 0,
        unrealized_pnl_micro INTEGER NOT NULL DEFAULT 0,
        opened_at_ms INTEGER NOT NULL,
        closed_at_ms INTEGER,
        venue_track TEXT DEFAULT 'BINANCE_LIQUID_CEX',
        is_breakeven_locked INTEGER DEFAULT 0,
        is_tp1_executed INTEGER DEFAULT 0,
        is_tp2_executed INTEGER DEFAULT 0
      );

      -- 6. Registro de Auto-Sweeps a Cold Wallet (+2500 bps sobre HWM)
      CREATE TABLE IF NOT EXISTS cold_wallet_sweeps (
        sweep_id TEXT PRIMARY KEY,
        trigger_equity_micro INTEGER NOT NULL,
        hwm_baseline_micro INTEGER NOT NULL,
        swept_amount_micro INTEGER NOT NULL,
        destination_address TEXT NOT NULL,
        tx_hash TEXT,
        status TEXT NOT NULL CHECK (status IN ('PENDING', 'CONFIRMED', 'SIMULATED')),
        created_at_ms INTEGER NOT NULL
      );
    `;

    this.db.exec(schemaSql);

    // Migraciones idempotentes de esquema
    try {
      this.db.exec("ALTER TABLE unified_positions_ledger ADD COLUMN exit_price_micro INTEGER;");
    } catch {
      // Ignorar si la columna ya existe
    }
    try {
      this.db.exec("ALTER TABLE unified_positions_ledger ADD COLUMN venue_track TEXT DEFAULT 'BINANCE_LIQUID_CEX';");
    } catch {}
    try {
      this.db.exec("ALTER TABLE unified_positions_ledger ADD COLUMN is_breakeven_locked INTEGER DEFAULT 0;");
    } catch {}
    try {
      this.db.exec("ALTER TABLE unified_positions_ledger ADD COLUMN is_tp1_executed INTEGER DEFAULT 0;");
    } catch {}
    try {
      this.db.exec("ALTER TABLE unified_positions_ledger ADD COLUMN is_tp2_executed INTEGER DEFAULT 0;");
    } catch {}
  }

  public getRawDb(): DatabaseType {
    return this.db;
  }

  public initRiskGuardianState(initialCapitalMicro: bigint): void {
    const now = BigInt(Date.now());
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO risk_guardian_state (
        id, execution_mode, base_capital_micro, current_equity_micro,
        high_water_mark_micro, open_exposure_micro, open_positions_count,
        rolling_24h_pnl_micro, circuit_breaker_until_ms, updated_at_ms
      ) VALUES (1, 'SHADOW', ?, ?, ?, 0, 0, 0, 0, ?)
    `);
    stmt.run(initialCapitalMicro, initialCapitalMicro, initialCapitalMicro, now);
  }

  public getRiskGuardianState(): RiskGuardianStateRow {
    const stmt = this.db.prepare('SELECT * FROM risk_guardian_state WHERE id = 1');
    const row = stmt.get() as RiskGuardianStateRow | undefined;
    if (!row) {
      throw new Error('RISK_GUARDIAN_NOT_INITIALIZED: State row 1 not found');
    }
    return row;
  }

  public updateRiskGuardianState(updates: Partial<Omit<RiskGuardianStateRow, 'id'>> & { circuit_breaker_active?: number | boolean }): void {
    const tx = this.db.transaction(() => {
      const current = this.getRiskGuardianState();
      let circuitBreakerUntil = updates.circuit_breaker_until_ms !== undefined ? updates.circuit_breaker_until_ms : current.circuit_breaker_until_ms;
      if (updates.circuit_breaker_active !== undefined) {
        if (!updates.circuit_breaker_active) {
          circuitBreakerUntil = 0n;
        }
      }
      const merged = { ...current, ...updates, circuit_breaker_until_ms: circuitBreakerUntil, updated_at_ms: BigInt(Date.now()) };
      const stmt = this.db.prepare(`
        UPDATE risk_guardian_state SET
          execution_mode = ?,
          base_capital_micro = ?,
          current_equity_micro = ?,
          high_water_mark_micro = ?,
          open_exposure_micro = ?,
          open_positions_count = ?,
          rolling_24h_pnl_micro = ?,
          circuit_breaker_until_ms = ?,
          updated_at_ms = ?
        WHERE id = 1
      `);
      stmt.run(
        merged.execution_mode,
        merged.base_capital_micro,
        merged.current_equity_micro,
        merged.high_water_mark_micro,
        merged.open_exposure_micro,
        merged.open_positions_count,
        merged.rolling_24h_pnl_micro,
        merged.circuit_breaker_until_ms,
        merged.updated_at_ms
      );
    });
    tx.immediate();
  }

  public getOpenPositions(): UnifiedPositionLedgerRow[] {
    return this.db.prepare(`
      SELECT * FROM unified_positions_ledger
      WHERE status IN ('OPEN', 'PARTIALLY_CLOSED')
      ORDER BY opened_at_ms ASC
    `).all() as unknown as UnifiedPositionLedgerRow[];
  }

  public getRecentPositions(limit: number = 100): UnifiedPositionLedgerRow[] {
    return this.db.prepare(`
      SELECT * FROM unified_positions_ledger
      ORDER BY opened_at_ms DESC
      LIMIT ?
    `).all(limit) as unknown as UnifiedPositionLedgerRow[];
  }

  /**
   * Métricas y KPIs consolidados de por vida (Lifetime) directamente desde SQLite WAL.
   * Audita el 100% histórico acumulado de operaciones sin verse afectado por límites de paginación UI.
   */
  public getLifetimeTradeMetrics(): {
    totalTrades: number;
    closedCount: number;
    winningCount: number;
    losingCount: number;
    winRatePct: string;
    netRealizedUsd: number;
    grossProfitUsd: number;
    grossLossUsd: number;
    profitFactor: string;
  } {
    const row = this.db.prepare(`
      SELECT 
        COUNT(*) as total_trades,
        SUM(CASE WHEN status IN ('CLOSED', 'STOPPED_OUT', 'TIME_STOPPED') OR closed_at_ms IS NOT NULL THEN 1 ELSE 0 END) as closed_count,
        SUM(CASE WHEN (status IN ('CLOSED', 'STOPPED_OUT', 'TIME_STOPPED') OR closed_at_ms IS NOT NULL) AND CAST(realized_pnl_micro as REAL) > 0 THEN 1 ELSE 0 END) as winning_count,
        SUM(CASE WHEN (status IN ('CLOSED', 'STOPPED_OUT', 'TIME_STOPPED') OR closed_at_ms IS NOT NULL) AND CAST(realized_pnl_micro as REAL) < 0 THEN 1 ELSE 0 END) as losing_count,
        COALESCE(SUM(CASE WHEN (status IN ('CLOSED', 'STOPPED_OUT', 'TIME_STOPPED') OR closed_at_ms IS NOT NULL) AND CAST(realized_pnl_micro as REAL) > 0 THEN CAST(realized_pnl_micro as REAL) ELSE 0 END), 0) as gross_profit_micro,
        COALESCE(SUM(CASE WHEN (status IN ('CLOSED', 'STOPPED_OUT', 'TIME_STOPPED') OR closed_at_ms IS NOT NULL) AND CAST(realized_pnl_micro as REAL) < 0 THEN ABS(CAST(realized_pnl_micro as REAL)) ELSE 0 END), 0) as gross_loss_micro,
        COALESCE(SUM(CASE WHEN status IN ('CLOSED', 'STOPPED_OUT', 'TIME_STOPPED') OR closed_at_ms IS NOT NULL THEN CAST(realized_pnl_micro as REAL) ELSE 0 END), 0) as net_realized_micro
      FROM unified_positions_ledger
    `).get() as any;

    if (!row) {
      return {
        totalTrades: 0,
        closedCount: 0,
        winningCount: 0,
        losingCount: 0,
        winRatePct: '0.0',
        netRealizedUsd: 0,
        grossProfitUsd: 0,
        grossLossUsd: 0,
        profitFactor: '0.00'
      };
    }

    const totalTrades = Number(row.total_trades || 0);
    const closedCount = Number(row.closed_count || 0);
    const winningCount = Number(row.winning_count || 0);
    const losingCount = Number(row.losing_count || 0);
    const grossProfitUsd = Number(row.gross_profit_micro || 0) / 1_000_000;
    const grossLossUsd = Number(row.gross_loss_micro || 0) / 1_000_000;
    const netRealizedUsd = Number(row.net_realized_micro || 0) / 1_000_000;

    const winRatePct = closedCount > 0 ? ((winningCount / closedCount) * 100).toFixed(1) : '0.0';
    const profitFactor = grossLossUsd > 0
      ? (grossProfitUsd / grossLossUsd).toFixed(2)
      : grossProfitUsd > 0 ? 'MAX' : '0.00';

    return {
      totalTrades,
      closedCount,
      winningCount,
      losingCount,
      winRatePct,
      netRealizedUsd,
      grossProfitUsd,
      grossLossUsd,
      profitFactor
    };
  }

  /**
   * Asignación e Inserción Atómica Check-and-Insert en SQLite WAL (BEGIN IMMEDIATE).
   * Elimina cualquier race condition TOCTOU entre motores concurrentes.
   */
  public allocateAndInsertPositionAtomic(
    position: Omit<UnifiedPositionLedgerRow, 'status' | 'realized_pnl_micro' | 'unrealized_pnl_micro' | 'opened_at_ms' | 'closed_at_ms'> & {
      status?: UnifiedPositionLedgerRow['status'];
      opened_at_ms?: bigint;
    },
    maxPositions: bigint = 3n,
    maxExposureBps: bigint = 3000n
  ): { success: boolean; rejectReason?: string } {
    const maxPos = BigInt(maxPositions);
    const maxExpBps = BigInt(maxExposureBps);

    const tx = this.db.transaction(() => {
      const state = this.getRiskGuardianState();
      const now = BigInt(Date.now());

      if (state.circuit_breaker_until_ms > now) {
        return { success: false, rejectReason: 'CIRCUIT_BREAKER_ACTIVE' };
      }
      if (state.open_positions_count >= maxPos) {
        return { success: false, rejectReason: `EXCEEDED_MAX_POSITIONS: ${state.open_positions_count}` };
      }

      const maxAllowedExposure = (state.base_capital_micro * maxExpBps) / 10000n;
      const projected = state.open_exposure_micro + position.notional_invested_micro;
      if (projected > maxAllowedExposure) {
        return { success: false, rejectReason: `EXCEEDED_MAX_EXPOSURE: ${projected} > ${maxAllowedExposure}` };
      }

      const openedAt = position.opened_at_ms || now;
      const status = position.status || 'OPEN';
      const venueTrack = position.venue_track || 'BINANCE_LIQUID_CEX';
      const isBreakevenLocked = position.is_breakeven_locked !== undefined ? Number(position.is_breakeven_locked) : 0;
      const isTp1Executed = position.is_tp1_executed !== undefined ? Number(position.is_tp1_executed) : 0;
      const isTp2Executed = position.is_tp2_executed !== undefined ? Number(position.is_tp2_executed) : 0;

      this.db.prepare(`
        INSERT INTO unified_positions_ledger (
          position_id, engine_origin, signal_ref_id, execution_mode, instrument_ticker,
          side, phase_allocation_bps, notional_invested_micro, quantity_atomic,
          entry_price_micro, stop_loss_micro, trailing_stop_micro, take_profit_micro,
          peak_price_micro, status, realized_pnl_micro, unrealized_pnl_micro, opened_at_ms, closed_at_ms,
          venue_track, is_breakeven_locked, is_tp1_executed, is_tp2_executed
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, NULL, ?, ?, ?, ?)
      `).run(
        position.position_id,
        position.engine_origin,
        position.signal_ref_id,
        position.execution_mode,
        position.instrument_ticker,
        position.side,
        position.phase_allocation_bps,
        position.notional_invested_micro,
        position.quantity_atomic,
        position.entry_price_micro,
        position.stop_loss_micro,
        position.trailing_stop_micro,
        position.take_profit_micro,
        position.peak_price_micro,
        status,
        openedAt,
        venueTrack,
        isBreakevenLocked,
        isTp1Executed,
        isTp2Executed
      );

      this.db.prepare(`
        UPDATE risk_guardian_state SET
          open_positions_count = open_positions_count + 1,
          open_exposure_micro = open_exposure_micro + ?,
          updated_at_ms = ?
        WHERE id = 1
      `).run(position.notional_invested_micro, now);

      return { success: true };
    });

    return tx.immediate();
  }

  /**
   * Cierre Atómico SQL Directo (sin Lost Updates en concurrencia).
   */
  public recordPositionClosedAtomic(notionalFreedMicro: bigint, realizedPnlMicro: bigint): void {
    const tx = this.db.transaction(() => {
      const now = BigInt(Date.now());
      this.db.prepare(`
        UPDATE risk_guardian_state SET
          open_positions_count = CASE WHEN open_positions_count > 0 THEN open_positions_count - 1 ELSE 0 END,
          open_exposure_micro = CASE WHEN open_exposure_micro > ? THEN open_exposure_micro - ? ELSE 0 END,
          current_equity_micro = current_equity_micro + ?,
          rolling_24h_pnl_micro = rolling_24h_pnl_micro + ?,
          updated_at_ms = ?
        WHERE id = 1
      `).run(notionalFreedMicro, notionalFreedMicro, realizedPnlMicro, realizedPnlMicro, now);
    });
    tx.immediate();
  }

  /**
   * Reconciliación de Llenados Parciales / Rechazos IOC para liberar exposición fantasma.
   */
  public reconcileExecutionDelta(requestedNotionalMicro: bigint, filledNotionalMicro: bigint, wasRejected: boolean): void {
    const unfilled = requestedNotionalMicro > filledNotionalMicro ? requestedNotionalMicro - filledNotionalMicro : 0n;
    if (unfilled > 0n || wasRejected) {
      const tx = this.db.transaction(() => {
        const now = BigInt(Date.now());
        const rejectFlag = wasRejected ? 1 : 0;
        this.db.prepare(`
          UPDATE risk_guardian_state SET
            open_exposure_micro = CASE WHEN open_exposure_micro > ? THEN open_exposure_micro - ? ELSE 0 END,
            open_positions_count = CASE WHEN ? = 1 AND open_positions_count > 0 THEN open_positions_count - 1 ELSE open_positions_count END,
            updated_at_ms = ?
          WHERE id = 1
        `).run(unfilled, unfilled, rejectFlag, now);
      });
      tx.immediate();
    }
  }

  public close(): void {
    this.db.close();
  }

  /**
   * Obtiene la marca de tiempo absoluta (ms) del próximo ciclo de purga (cada 6 horas).
   * Basado en la marca real de persistencia en SQLite, evitando desincronizaciones con el navegador.
   */
  public getNextPurgeTimestampMs(): number {
    try {
      const row = this.db.prepare('SELECT MAX(last_rotated_ms) as lastRotated FROM sentinel_wallets_pool').get() as { lastRotated: bigint | null };
      const CYCLE_MS = 6 * 60 * 60 * 1000;
      const now = Date.now();
      if (!row || !row.lastRotated) {
        return now + CYCLE_MS;
      }
      const lastRotatedMs = Number(row.lastRotated);
      if (now < lastRotatedMs + CYCLE_MS) {
        return lastRotatedMs + CYCLE_MS;
      }
      const elapsed = now - lastRotatedMs;
      const cycles = Math.floor(elapsed / CYCLE_MS);
      return lastRotatedMs + (cycles + 1) * CYCLE_MS;
    } catch {
      return Date.now() + (6 * 60 * 60 * 1000);
    }
  }

  /**
   * Actualiza el desempeño on-chain de una ballena tras el cierre de un trade:
   * - Si pierde (STOPPED_OUT): incrementa consecutive_losses (1/3, 2/3).
   * - Si gana (CLOSED): resetea consecutive_losses a 0 (0/3).
   * - Incrementa trades_count_7d.
   */
  public recordWhaleTradeOutcome(walletAddress: string, isWin: boolean): { consecutiveLosses: number; updated: boolean } {
    try {
      if (!walletAddress || typeof walletAddress !== 'string' || walletAddress.trim() === '') {
        return { consecutiveLosses: 0, updated: false };
      }
      const rawDb = this.db;
      const cleanAddress = walletAddress.trim();

      const tx = rawDb.transaction(() => {
        if (isWin) {
          const res = rawDb.prepare(`
            UPDATE sentinel_wallets_pool
            SET consecutive_losses = 0,
                trades_count_7d = trades_count_7d + 1
            WHERE wallet_address = ?
          `).run(cleanAddress);

          return { consecutiveLosses: 0, updated: res.changes > 0 };
        } else {
          const res = rawDb.prepare(`
            UPDATE sentinel_wallets_pool
            SET consecutive_losses = consecutive_losses + 1,
                trades_count_7d = trades_count_7d + 1
            WHERE wallet_address = ?
          `).run(cleanAddress);

          if (res.changes === 0) {
            return { consecutiveLosses: 0, updated: false };
          }

          const row = rawDb.prepare(`
            SELECT consecutive_losses FROM sentinel_wallets_pool WHERE wallet_address = ?
          `).get(cleanAddress) as { consecutive_losses: number } | undefined;

          return {
            consecutiveLosses: row ? Number(row.consecutive_losses) : 0,
            updated: true
          };
        }
      });

      return tx.immediate();
    } catch (err) {
      console.error('❌ [DB_WHALE_OUTCOME_ERROR] Error al registrar resultado de ballena:', err);
      return { consecutiveLosses: 0, updated: false };
    }
  }

  /**
   * Realiza un backup atómico consistente en caliente de SQLite WAL hacia un archivo de destino.
   * Totalmente seguro para replicar a OneDrive / Google Drive sin bloqueos ni corrupción.
   */
  public async backupToFile(destPath: string): Promise<string> {
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    await this.db.backup(destPath);
    return destPath;
  }
}

// ============================================================================
// NEXUS QUANT SUITE v3.0 - EXTENSIONES ADITIVAS (FASE 1 & FASE 2)
// ============================================================================

export type PullbackIntentStatus =
  | 'WAITING_PULLBACK'
  | 'FILLED_PROBE'
  | 'SCALED_FULL'
  | 'CANCELLED_TTL_EXPIRED'
  | 'CANCELLED_ESCAPED_ROOF'
  | 'EXEC_DIRECT_LOW_IMPACT';

export interface SentinelPullbackIntentRecord {
  readonly intent_id: string;
  readonly token_symbol: string;
  readonly token_mint: string;
  readonly confluence_count: number;
  readonly unique_funding_roots_json: string;
  readonly pre_whale_price_micro_usd: bigint;
  readonly peak_impact_price_micro_usd: bigint;
  readonly limit_target_price_micro_usd: bigint;
  readonly allocated_weight_bps: bigint;
  readonly status: PullbackIntentStatus;
  readonly created_at_ms: bigint;
  readonly expires_at_ms: bigint;
}

export interface SqliteWalStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Array<Record<string, unknown>>;
}

export interface SqliteWalDatabaseDriver {
  exec(sql: string): void;
  prepare(sql: string): SqliteWalStatement;
}

export const SENTINEL_V3_PHASE1_MIGRATION_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS sentinel_pullback_intents (
    intent_id TEXT PRIMARY KEY,
    token_symbol TEXT NOT NULL,
    token_mint TEXT NOT NULL,
    confluence_count INTEGER NOT NULL DEFAULT 1,
    unique_funding_roots_json TEXT NOT NULL,
    pre_whale_price_micro_usd INTEGER NOT NULL,
    peak_impact_price_micro_usd INTEGER NOT NULL,
    limit_target_price_micro_usd INTEGER NOT NULL,
    allocated_weight_bps INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    expires_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pullback_token_status 
ON sentinel_pullback_intents(token_mint, status, expires_at_ms);
`;

export function toBigIntSafe(val: unknown): bigint {
  if (typeof val === 'bigint') return val;
  const s = String(val ?? '0').trim().replace(/\..*$/, '');
  return BigInt(s || '0');
}

export class SentinelPullbackIntentRepository {
  private readonly db: SqliteWalDatabaseDriver;

  constructor(db: SqliteWalDatabaseDriver) {
    this.db = db;
    this.applyAdditiveMigration();
  }

  public applyAdditiveMigration(): void {
    this.db.exec(SENTINEL_V3_PHASE1_MIGRATION_SQL);
  }

  public upsertIntent(record: SentinelPullbackIntentRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO sentinel_pullback_intents (
        intent_id,
        token_symbol,
        token_mint,
        confluence_count,
        unique_funding_roots_json,
        pre_whale_price_micro_usd,
        peak_impact_price_micro_usd,
        limit_target_price_micro_usd,
        allocated_weight_bps,
        status,
        created_at_ms,
        expires_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(intent_id) DO UPDATE SET
        confluence_count = excluded.confluence_count,
        unique_funding_roots_json = excluded.unique_funding_roots_json,
        allocated_weight_bps = excluded.allocated_weight_bps,
        status = excluded.status,
        expires_at_ms = excluded.expires_at_ms
    `);

    stmt.run(
      record.intent_id,
      record.token_symbol,
      record.token_mint,
      record.confluence_count,
      record.unique_funding_roots_json,
      record.pre_whale_price_micro_usd.toString(),
      record.peak_impact_price_micro_usd.toString(),
      record.limit_target_price_micro_usd.toString(),
      record.allocated_weight_bps.toString(),
      record.status,
      record.created_at_ms.toString(),
      record.expires_at_ms.toString()
    );
  }

  public getIntentById(intentId: string): SentinelPullbackIntentRecord | null {
    const stmt = this.db.prepare(`
      SELECT * FROM sentinel_pullback_intents WHERE intent_id = ?
    `);
    const row = stmt.get(intentId);
    if (!row) return null;
    return this.mapRowToRecord(row);
  }

  public getActiveIntentsByMint(tokenMint: string, nowMs: bigint): SentinelPullbackIntentRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM sentinel_pullback_intents
      WHERE token_mint = ?
        AND status IN ('WAITING_PULLBACK', 'FILLED_PROBE', 'EXEC_DIRECT_LOW_IMPACT')
    `);
    const rows = stmt.all(tokenMint);
    return rows
      .map((r) => this.mapRowToRecord(r))
      .filter((rec) => rec.expires_at_ms >= nowMs || rec.status !== 'WAITING_PULLBACK');
  }

  public getAllWaitingIntents(): SentinelPullbackIntentRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM sentinel_pullback_intents
      WHERE status = 'WAITING_PULLBACK'
    `);
    const rows = stmt.all();
    return rows.map((r) => this.mapRowToRecord(r));
  }

  public updateIntentStatus(
    intentId: string,
    newStatus: PullbackIntentStatus,
    allocatedWeightBps?: bigint,
    confluenceCount?: number
  ): void {
    if (allocatedWeightBps !== undefined && confluenceCount !== undefined) {
      const stmt = this.db.prepare(`
        UPDATE sentinel_pullback_intents
        SET status = ?, allocated_weight_bps = ?, confluence_count = ?
        WHERE intent_id = ?
      `);
      stmt.run(newStatus, allocatedWeightBps.toString(), confluenceCount, intentId);
      return;
    }

    const stmt = this.db.prepare(`
      UPDATE sentinel_pullback_intents
      SET status = ?
      WHERE intent_id = ?
    `);
    stmt.run(newStatus, intentId);
  }

  private mapRowToRecord(row: Record<string, unknown>): SentinelPullbackIntentRecord {
    return {
      intent_id: String(row.intent_id),
      token_symbol: String(row.token_symbol),
      token_mint: String(row.token_mint),
      confluence_count: Number(row.confluence_count),
      unique_funding_roots_json: String(row.unique_funding_roots_json),
      pre_whale_price_micro_usd: toBigIntSafe(row.pre_whale_price_micro_usd),
      peak_impact_price_micro_usd: toBigIntSafe(row.peak_impact_price_micro_usd),
      limit_target_price_micro_usd: toBigIntSafe(row.limit_target_price_micro_usd),
      allocated_weight_bps: toBigIntSafe(row.allocated_weight_bps),
      status: String(row.status) as PullbackIntentStatus,
      created_at_ms: toBigIntSafe(row.created_at_ms),
      expires_at_ms: toBigIntSafe(row.expires_at_ms),
    };
  }
}

export type MarketRegimeState =
  | 'REGIME_TRENDING'
  | 'REGIME_VOLATILE_PANIC'
  | 'REGIME_CHOPPY_RANGE';

export type CarryStrategyType = 'FUNDING_BASIS_ARB' | 'STABLE_CONCENTRATED_LP';

export type CarryPositionStatus = 'ACTIVE_HARVESTING' | 'REBALANCING' | 'CLOSED';

export interface AetherRegimeTelemetryRecord {
  readonly current_regime: MarketRegimeState;
  readonly kaufman_er_bps: bigint;
  readonly atr_ratio_bps: bigint;
  readonly bollinger_width_bps: bigint;
  readonly sentinel_multiplier_bps: bigint;
  readonly catalyst_multiplier_bps: bigint;
  readonly carry_allocation_target_bps: bigint;
  readonly updated_at_ms: bigint;
}

export interface AetherCarryLedgerRecord {
  readonly carry_id: string;
  readonly asset_symbol: string;
  readonly strategy_type: CarryStrategyType;
  readonly notional_deployed_micro_usd: bigint;
  readonly spot_units_micro: bigint;
  readonly perp_short_units_micro: bigint;
  readonly spot_entry_price_micro_usd: bigint;
  readonly perp_short_entry_micro_usd: bigint;
  readonly delta_drift_bps: bigint;
  readonly current_apr_bps: bigint;
  readonly consecutive_negative_funding_epochs: number;
  readonly cumulative_yield_micro_usd: bigint;
  readonly status: CarryPositionStatus;
  readonly opened_at_ms: bigint;
  readonly last_harvest_ms: bigint;
}

export const AETHER_V3_PHASE2_MIGRATION_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS aether_regime_telemetry (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    current_regime TEXT NOT NULL,
    kaufman_er_bps INTEGER NOT NULL,
    atr_ratio_bps INTEGER NOT NULL,
    bollinger_width_bps INTEGER NOT NULL,
    sentinel_multiplier_bps INTEGER NOT NULL,
    catalyst_multiplier_bps INTEGER NOT NULL,
    carry_allocation_target_bps INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS aether_carry_ledger (
    carry_id TEXT PRIMARY KEY,
    asset_symbol TEXT NOT NULL,
    strategy_type TEXT NOT NULL,
    notional_deployed_micro_usd INTEGER NOT NULL,
    spot_units_micro INTEGER NOT NULL,
    perp_short_units_micro INTEGER NOT NULL,
    spot_entry_price_micro_usd INTEGER NOT NULL,
    perp_short_entry_micro_usd INTEGER NOT NULL,
    delta_drift_bps INTEGER NOT NULL,
    current_apr_bps INTEGER NOT NULL,
    consecutive_negative_funding_epochs INTEGER NOT NULL DEFAULT 0,
    cumulative_yield_micro_usd INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    opened_at_ms INTEGER NOT NULL,
    last_harvest_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_aether_carry_status 
ON aether_carry_ledger(status, strategy_type);
`;

export class AetherSqliteRepository {
  private readonly db: SqliteWalDatabaseDriver;

  constructor(db: SqliteWalDatabaseDriver) {
    this.db = db;
    this.applyAdditiveMigration();
  }

  public applyAdditiveMigration(): void {
    this.db.exec(AETHER_V3_PHASE2_MIGRATION_SQL);
  }

  public saveRegimeTelemetry(record: AetherRegimeTelemetryRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO aether_regime_telemetry (
        id,
        current_regime,
        kaufman_er_bps,
        atr_ratio_bps,
        bollinger_width_bps,
        sentinel_multiplier_bps,
        catalyst_multiplier_bps,
        carry_allocation_target_bps,
        updated_at_ms
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        current_regime = excluded.current_regime,
        kaufman_er_bps = excluded.kaufman_er_bps,
        atr_ratio_bps = excluded.atr_ratio_bps,
        bollinger_width_bps = excluded.bollinger_width_bps,
        sentinel_multiplier_bps = excluded.sentinel_multiplier_bps,
        catalyst_multiplier_bps = excluded.catalyst_multiplier_bps,
        carry_allocation_target_bps = excluded.carry_allocation_target_bps,
        updated_at_ms = excluded.updated_at_ms
    `);

    stmt.run(
      record.current_regime,
      record.kaufman_er_bps.toString(),
      record.atr_ratio_bps.toString(),
      record.bollinger_width_bps.toString(),
      record.sentinel_multiplier_bps.toString(),
      record.catalyst_multiplier_bps.toString(),
      record.carry_allocation_target_bps.toString(),
      record.updated_at_ms.toString()
    );
  }

  public getLatestRegimeTelemetry(): AetherRegimeTelemetryRecord | null {
    const stmt = this.db.prepare(`SELECT * FROM aether_regime_telemetry WHERE id = 1`);
    const row = stmt.get();
    if (!row) return null;

    return {
      current_regime: String(row.current_regime) as MarketRegimeState,
      kaufman_er_bps: toBigIntSafe(row.kaufman_er_bps),
      atr_ratio_bps: toBigIntSafe(row.atr_ratio_bps),
      bollinger_width_bps: toBigIntSafe(row.bollinger_width_bps),
      sentinel_multiplier_bps: toBigIntSafe(row.sentinel_multiplier_bps),
      catalyst_multiplier_bps: toBigIntSafe(row.catalyst_multiplier_bps),
      carry_allocation_target_bps: toBigIntSafe(row.carry_allocation_target_bps),
      updated_at_ms: toBigIntSafe(row.updated_at_ms),
    };
  }

  public upsertCarryPosition(record: AetherCarryLedgerRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO aether_carry_ledger (
        carry_id,
        asset_symbol,
        strategy_type,
        notional_deployed_micro_usd,
        spot_units_micro,
        perp_short_units_micro,
        spot_entry_price_micro_usd,
        perp_short_entry_micro_usd,
        delta_drift_bps,
        current_apr_bps,
        consecutive_negative_funding_epochs,
        cumulative_yield_micro_usd,
        status,
        opened_at_ms,
        last_harvest_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(carry_id) DO UPDATE SET
        asset_symbol = excluded.asset_symbol,
        strategy_type = excluded.strategy_type,
        notional_deployed_micro_usd = excluded.notional_deployed_micro_usd,
        spot_units_micro = excluded.spot_units_micro,
        perp_short_units_micro = excluded.perp_short_units_micro,
        spot_entry_price_micro_usd = excluded.spot_entry_price_micro_usd,
        perp_short_entry_micro_usd = excluded.perp_short_entry_micro_usd,
        delta_drift_bps = excluded.delta_drift_bps,
        current_apr_bps = excluded.current_apr_bps,
        consecutive_negative_funding_epochs = excluded.consecutive_negative_funding_epochs,
        cumulative_yield_micro_usd = excluded.cumulative_yield_micro_usd,
        status = excluded.status,
        opened_at_ms = excluded.opened_at_ms,
        last_harvest_ms = excluded.last_harvest_ms
    `);

    stmt.run(
      record.carry_id,
      record.asset_symbol,
      record.strategy_type,
      record.notional_deployed_micro_usd.toString(),
      record.spot_units_micro.toString(),
      record.perp_short_units_micro.toString(),
      record.spot_entry_price_micro_usd.toString(),
      record.perp_short_entry_micro_usd.toString(),
      record.delta_drift_bps.toString(),
      record.current_apr_bps.toString(),
      record.consecutive_negative_funding_epochs,
      record.cumulative_yield_micro_usd.toString(),
      record.status,
      record.opened_at_ms.toString(),
      record.last_harvest_ms.toString()
    );
  }

  public getCarryPositionById(carryId: string): AetherCarryLedgerRecord | null {
    const stmt = this.db.prepare(`SELECT * FROM aether_carry_ledger WHERE carry_id = ?`);
    const row = stmt.get(carryId);
    if (!row) return null;
    return this.mapCarryRow(row);
  }

  public getAllActiveCarryPositions(): AetherCarryLedgerRecord[] {
    const stmt = this.db.prepare(
      `SELECT * FROM aether_carry_ledger WHERE status IN ('ACTIVE_HARVESTING', 'REBALANCING')`
    );
    return stmt.all().map((r) => this.mapCarryRow(r));
  }

  private mapCarryRow(row: Record<string, unknown>): AetherCarryLedgerRecord {
    return {
      carry_id: String(row.carry_id),
      asset_symbol: String(row.asset_symbol),
      strategy_type: String(row.strategy_type) as CarryStrategyType,
      notional_deployed_micro_usd: toBigIntSafe(row.notional_deployed_micro_usd),
      spot_units_micro: toBigIntSafe(row.spot_units_micro),
      perp_short_units_micro: toBigIntSafe(row.perp_short_units_micro),
      spot_entry_price_micro_usd: toBigIntSafe(row.spot_entry_price_micro_usd),
      perp_short_entry_micro_usd: toBigIntSafe(row.perp_short_entry_micro_usd),
      delta_drift_bps: toBigIntSafe(row.delta_drift_bps),
      current_apr_bps: toBigIntSafe(row.current_apr_bps),
      consecutive_negative_funding_epochs: Number(row.consecutive_negative_funding_epochs),
      cumulative_yield_micro_usd: toBigIntSafe(row.cumulative_yield_micro_usd),
      status: String(row.status) as CarryPositionStatus,
      opened_at_ms: toBigIntSafe(row.opened_at_ms),
      last_harvest_ms: toBigIntSafe(row.last_harvest_ms),
    };
  }
}

