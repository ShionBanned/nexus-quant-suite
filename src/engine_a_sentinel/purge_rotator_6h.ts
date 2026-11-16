/**
 * NEXUS QUANT SUITE v2.0 - SENTINEL PURGE & ROTATOR ENGINE (CICLO 6H)
 * 
 * Regla Inmutable:
 * - Pool dinámico de 50 billeteras (10 LIVE / 40 SHADOW).
 * - Profit Factor PF = ∑ Ganancias Netas ÷ ∑ Pérdidas Netas (7 días).
 * - Escalado x1000: PF 1.75 = 1750; PF 1.40 = 1400.
 * - Degradación: si PF < 1.40 o 3 pérdidas consecutivas -> desciende a SHADOW o PURGED.
 * - Ascenso: billeteras líderes de SHADOW con PF >= 1.75 ascienden a LIVE cada 6 horas.
 */

import { NexusDatabase, SentinelWalletRow } from '../core/db_sqlite_wal.js';

export interface RotationResult {
  demotedCount: number;
  promotedCount: number;
  purgedCount: number;
  activeLiveCount: number;
  activeShadowCount: number;
  demotedWallets: string[];
  promotedWallets: string[];
}

export class SentinelPurgeRotator {
  private db: NexusDatabase;
  private readonly targetLiveCount: number = 10;
  private readonly minPromotionPfScaled: bigint = 1750n; // PF >= 1.75
  private readonly demotionPfScaled: bigint = 1400n; // PF < 1.40
  private readonly maxConsecutiveLosses: number = 3;

  constructor(db: NexusDatabase) {
    this.db = db;
  }

  /**
   * Ejecuta el ciclo de rotación y purga cada 6 horas.
   */
  public executeRotationCycle(nowMs: bigint = BigInt(Date.now())): RotationResult {
    const rawDb = this.db.getRawDb();

    // 1. Obtener todas las billeteras activas (LIVE y SHADOW)
    const allWallets = rawDb.prepare(`
      SELECT * FROM sentinel_wallets_pool
      WHERE pool_tier IN ('LIVE', 'SHADOW')
    `).all() as unknown as SentinelWalletRow[];

    const demotedWallets: string[] = [];
    const promotedWallets: string[] = [];
    let purgedCount = 0;

    const currentLive: SentinelWalletRow[] = [];
    const eligibleShadow: SentinelWalletRow[] = [];

    // 2. Evaluar degradación para cada billetera LIVE
    for (const wallet of allWallets) {
      if (wallet.pool_tier === 'LIVE') {
        const shouldDemote =
          wallet.profit_factor_scaled < this.demotionPfScaled ||
          wallet.consecutive_losses >= this.maxConsecutiveLosses;

        if (shouldDemote) {
          // Si tiene 5 o más pérdidas o PF < 1.0, se purga totalmente; si no, baja a SHADOW
          const targetTier = wallet.consecutive_losses >= 5 ? 'PURGED' : 'SHADOW';
          rawDb.prepare(`
            UPDATE sentinel_wallets_pool
            SET pool_tier = ?, last_rotated_ms = ?
            WHERE wallet_address = ?
          `).run(targetTier, nowMs, wallet.wallet_address);

          demotedWallets.push(wallet.wallet_address);
          if (targetTier === 'PURGED') purgedCount++;
        } else {
          currentLive.push(wallet);
        }
      } else if (wallet.pool_tier === 'SHADOW') {
        // Evaluar si califica para ascenso
        if (
          wallet.profit_factor_scaled >= this.minPromotionPfScaled &&
          wallet.consecutive_losses < this.maxConsecutiveLosses
        ) {
          eligibleShadow.push(wallet);
        }
      }
    }

    // 3. Ordenar candidatas de SHADOW por mayor Profit Factor y Win Rate
    eligibleShadow.sort((a, b) => {
      if (b.profit_factor_scaled !== a.profit_factor_scaled) {
        return Number(b.profit_factor_scaled - a.profit_factor_scaled);
      }
      return Number(b.win_rate_bps - a.win_rate_bps);
    });

    // 4. Determinar cuántos puestos LIVE hacen falta para completar exactamente 10
    const neededLive = this.targetLiveCount - currentLive.length;
    const toPromote = eligibleShadow.slice(0, Math.max(0, neededLive));

    for (const candidate of toPromote) {
      rawDb.prepare(`
        UPDATE sentinel_wallets_pool
        SET pool_tier = 'LIVE', last_rotated_ms = ?
        WHERE wallet_address = ?
      `).run(nowMs, candidate.wallet_address);

      promotedWallets.push(candidate.wallet_address);
      currentLive.push({ ...candidate, pool_tier: 'LIVE' });
    }

    // 5. Conteo final
    const counts = rawDb.prepare(`
      SELECT pool_tier, COUNT(*) as count
      FROM sentinel_wallets_pool
      GROUP BY pool_tier
    `).all() as { pool_tier: string; count: bigint }[];

    let liveCount = 0;
    let shadowCount = 0;
    for (const row of counts) {
      if (row.pool_tier === 'LIVE') liveCount = Number(row.count);
      if (row.pool_tier === 'SHADOW') shadowCount = Number(row.count);
    }

    return {
      demotedCount: demotedWallets.length,
      promotedCount: promotedWallets.length,
      purgedCount,
      activeLiveCount: liveCount,
      activeShadowCount: shadowCount,
      demotedWallets,
      promotedWallets
    };
  }

  /**
   * Sembrado inicial del pool de 50 billeteras (10 LIVE / 40 SHADOW) para pruebas y arranque.
   */
  public seedInitialPool(wallets: Omit<SentinelWalletRow, 'last_rotated_ms'>[]): void {
    const rawDb = this.db.getRawDb();
    const now = BigInt(Date.now());
    const stmt = rawDb.prepare(`
      INSERT OR REPLACE INTO sentinel_wallets_pool (
        wallet_address, chain_id, pool_tier, win_rate_bps, profit_factor_scaled,
        consecutive_losses, trades_count_7d, funding_root_hash, last_rotated_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = rawDb.transaction((rows: Omit<SentinelWalletRow, 'last_rotated_ms'>[]) => {
      for (const w of rows) {
        stmt.run(
          w.wallet_address,
          w.chain_id,
          w.pool_tier,
          w.win_rate_bps,
          w.profit_factor_scaled,
          w.consecutive_losses,
          w.trades_count_7d,
          w.funding_root_hash,
          now
        );
      }
    });

    insertMany(wallets);
  }
}
