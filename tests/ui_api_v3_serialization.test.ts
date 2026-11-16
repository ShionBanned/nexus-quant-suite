// tests/ui_api_v3_serialization.test.ts
import { describe, it, expect } from 'vitest';
import {
  buildCarrySummaryPayload,
  serializeBigIntJson,
} from '../src/ui_dashboard/server.js';
import { formatBpsPct, formatMicroUsd } from '../src/ui_dashboard/components/GlobalRiskBar.js';
import { AetherCarryLedgerRecord, NexusDatabase } from '../src/core/db_sqlite_wal.js';

describe('NEXUS v3.0 - FASE 3: Serialización API BigInt y Formateadores UI', () => {
  it('serializa objetos con BigInt a JSON válido sin lanzar TypeError ni perder precisión', () => {
    const payload = {
      regime: 'REGIME_CHOPPY_RANGE',
      notional_micro_usd: 70_000_000_000n,
      kaufman_er_bps: 1850n,
    };

    const jsonString = serializeBigIntJson(payload);
    const parsed = JSON.parse(jsonString) as Record<string, unknown>;

    expect(parsed.regime).toBe('REGIME_CHOPPY_RANGE');
    expect(parsed.notional_micro_usd).toBe('70000000000');
    expect(parsed.kaufman_er_bps).toBe('1850');
  });

  it('calcula correctamente el resumen ponderado de Carry en BigInt para GET /api/aether/carry', () => {
    const mockPositions: AetherCarryLedgerRecord[] = [
      {
        carry_id: 'carry_sol_1',
        asset_symbol: 'SOL',
        strategy_type: 'FUNDING_BASIS_ARB',
        notional_deployed_micro_usd: 50_000_000_000n, // $50,000 USD al 20% APR (2000 bps)
        spot_units_micro: 250_000_000n,
        perp_short_units_micro: 250_000_000n,
        spot_entry_price_micro_usd: 100_000_000n,
        perp_short_entry_micro_usd: 100_000_000n,
        delta_drift_bps: 8n,
        current_apr_bps: 2000n,
        consecutive_negative_funding_epochs: 0,
        cumulative_yield_micro_usd: 1_250_000_000n, // $1,250 USD
        status: 'ACTIVE_HARVESTING',
        opened_at_ms: 1000n,
        last_harvest_ms: 2000n,
      },
      {
        carry_id: 'carry_eth_2',
        asset_symbol: 'ETH',
        strategy_type: 'STABLE_CONCENTRATED_LP',
        notional_deployed_micro_usd: 20_000_000_000n, // $20,000 USD al 10% APR (1000 bps)
        spot_units_micro: 0n,
        perp_short_units_micro: 0n,
        spot_entry_price_micro_usd: 2500_000_000n,
        perp_short_entry_micro_usd: 2500_000_000n,
        delta_drift_bps: 0n,
        current_apr_bps: 1000n,
        consecutive_negative_funding_epochs: 2,
        cumulative_yield_micro_usd: 300_000_000n, // $300 USD
        status: 'ACTIVE_HARVESTING',
        opened_at_ms: 1000n,
        last_harvest_ms: 2000n,
      },
    ];

    const summary = buildCarrySummaryPayload(mockPositions);

    expect(summary.total_notional_deployed_micro_usd).toBe('70000000000'); // $70,000 USD
    expect(summary.total_cumulative_yield_micro_usd).toBe('1550000000');   // $1,550 USD
    // APR Ponderado: (50k * 2000 + 20k * 1000) / 70k = 120,000,000 / 70,000 = 1714 bps (17.14%)
    expect(summary.weighted_apr_bps).toBe('1714');
    expect(summary.max_observed_delta_drift_bps).toBe('8');
    expect(summary.active_positions_count).toBe(2);
  });

  it('formatea micro-USD y puntos base (bps) exactamente para los badges del Dashboard', () => {
    expect(formatMicroUsd('70000000000')).toBe('$70,000.00');
    expect(formatMicroUsd('1420500000', true)).toBe('+$1,420.50');
    expect(formatMicroUsd('-350250000', true)).toBe('-$350.25');
    expect(formatBpsPct('1950')).toBe('19.50%');
    expect(formatBpsPct('142', true)).toBe('+1.42%');
  });

  it('separa métricas de por vida (Lifetime KPIs) del límite de paginación de 100 en la tabla', () => {
    const db = new NexusDatabase(':memory:');
    const rawDb = db.getRawDb();

    // Insertar 110 operaciones cerradas (70 ganadoras de +$75, 40 perdedoras de -$40)
    for (let i = 1; i <= 110; i++) {
      const isWin = i <= 70;
      const pnlMicro = isWin ? 75_000_000n : -40_000_000n;
      rawDb.prepare(`
        INSERT INTO unified_positions_ledger (
          position_id, engine_origin, signal_ref_id, execution_mode,
          instrument_ticker, side, phase_allocation_bps, notional_invested_micro,
          quantity_atomic, entry_price_micro, stop_loss_micro, peak_price_micro,
          status, realized_pnl_micro, unrealized_pnl_micro, opened_at_ms, closed_at_ms
        ) VALUES (?, 'SENTINEL_ONCHAIN', 'SIG', 'SHADOW', 'SOL/USD', 1, 10000, 5000000000, '28000000000', 180000000, 165000000, 182700000, ?, ?, 0, ?, ?)
      `).run(`POS_${i}`, isWin ? 'CLOSED' : 'STOPPED_OUT', pnlMicro.toString(), 1000 + i, 2000 + i);
    }

    const lifetimeKpis = db.getLifetimeTradeMetrics();
    const recentRows = db.getRecentPositions(100);

    // La tabla solo recibe las 100 más recientes para fluidez del navegador
    expect(recentRows.length).toBe(100);

    // Pero las métricas consolidadas auditan el 100% histórico (110 operaciones)
    expect(lifetimeKpis.totalTrades).toBe(110);
    expect(lifetimeKpis.closedCount).toBe(110);
    expect(lifetimeKpis.winningCount).toBe(70);
    expect(lifetimeKpis.losingCount).toBe(40);
    expect(lifetimeKpis.winRatePct).toBe('63.6'); // 70 / 110 = 63.63%
    expect(lifetimeKpis.grossProfitUsd).toBe(5250); // 70 * 75 = 5250
    expect(lifetimeKpis.grossLossUsd).toBe(1600);   // 40 * 40 = 1600
    expect(lifetimeKpis.netRealizedUsd).toBe(3650);  // 5250 - 1600 = 3650
    expect(lifetimeKpis.profitFactor).toBe('3.28');  // 5250 / 1600 = 3.28

    db.close();
  });
});
