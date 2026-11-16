// src/ui_dashboard/views/Section4_AetherCarry.tsx

import React from 'react';
import { CarryPositionStatus, CarryStrategyType, MarketRegimeState } from '../../core/db_sqlite_wal.js';
import { formatBpsPct, formatMicroUsd } from '../components/GlobalRiskBar.js';

export interface AetherCarryPositionDto {
  readonly carry_id: string;
  readonly asset_symbol: string;
  readonly strategy_type: CarryStrategyType;
  readonly notional_deployed_micro_usd: string;
  readonly spot_units_micro: string;
  readonly perp_short_units_micro: string;
  readonly spot_entry_price_micro_usd: string;
  readonly perp_short_entry_micro_usd: string;
  readonly delta_drift_bps: string;
  readonly current_apr_bps: string;
  readonly consecutive_negative_funding_epochs: number;
  readonly cumulative_yield_micro_usd: string;
  readonly status: CarryPositionStatus;
  readonly opened_at_ms: string;
  readonly last_harvest_ms: string;
}

export interface AetherRegimeTelemetryDto {
  readonly current_regime: MarketRegimeState;
  readonly kaufman_er_bps: string;
  readonly atr_ratio_bps: string;
  readonly bollinger_width_bps: string;
  readonly sentinel_multiplier_bps: string;
  readonly catalyst_multiplier_bps: string;
  readonly carry_allocation_target_bps: string;
  readonly updated_at_ms: string;
}

export interface SentinelPullbackIntentDto {
  readonly intent_id: string;
  readonly token_symbol: string;
  readonly token_mint: string;
  readonly confluence_count: number;
  readonly pre_whale_price_micro_usd: string;
  readonly peak_impact_price_micro_usd: string;
  readonly limit_target_price_micro_usd: string;
  readonly allocated_weight_bps: string;
  readonly status: string;
  readonly expires_at_ms: string;
}

export interface Section4AetherCarryProps {
  readonly regimeTelemetry: AetherRegimeTelemetryDto;
  readonly totalNotionalDeployedMicroUsd: string;
  readonly totalCumulativeYieldMicroUsd: string;
  readonly weightedAprBps: string;
  readonly maxObservedDeltaDriftBps: string;
  readonly stableVaultFloorAprBps: string;
  readonly positions: readonly AetherCarryPositionDto[];
  readonly activePullbackIntents: readonly SentinelPullbackIntentDto[];
}

function formatUnitsMicro(unitsMicroStr: string): string {
  try {
    const raw = BigInt(unitsMicroStr);
    const whole = raw / 1_000_000n;
    const dec = (raw % 1_000_000n) / 1_000n;
    return `${whole.toString()}.${dec.toString().padStart(3, '0')}`;
  } catch {
    return '0.000';
  }
}

const cardStyle: React.CSSProperties = {
  background: 'rgba(30, 41, 59, 0.62)',
  backdropFilter: 'blur(12px)',
  border: '1px solid rgba(148, 163, 184, 0.16)',
  borderRadius: '12px',
  padding: '18px',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};

export const Section4_AetherCarry: React.FC<Section4AetherCarryProps> = (props) => {
  const maxDriftBpsNum = Number(props.maxObservedDeltaDriftBps || '0');
  const isDriftHealthy = maxDriftBpsNum <= 15;

  return (
    <section
      style={{
        padding: '24px',
        color: '#f8fafc',
        fontFamily: 'Inter, system-ui, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
      }}
    >
      {/* 1. FILA DE TARJETAS KPI: CARRY, DELTA DRIFT, APR Y TELEMETRÍA DE RÉGIMEN */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
          gap: '16px',
        }}
      >
        {/* Tarjeta A: Capital Carry Activo vs Reserva */}
        <div style={cardStyle}>
          <span style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8' }}>
            CAPITAL DELTA-NEUTRAL ACTIVO (AETHER)
          </span>
          <span style={{ fontSize: '26px', fontWeight: 800, color: '#38bdf8' }}>
            {formatMicroUsd(props.totalNotionalDeployedMicroUsd)}
          </span>
          <span style={{ fontSize: '12px', color: '#cbd5e1' }}>
            Objetivo de Régimen:{' '}
            <strong>{formatBpsPct(props.regimeTelemetry.carry_allocation_target_bps)}</strong> del
            Portafolio
          </span>
        </div>

        {/* Tarjeta B: Neutralidad Delta (Drift en bps vs Límite de 15 bps) */}
        <div style={cardStyle}>
          <span style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8' }}>
            DESVIACIÓN NETA (DELTA DRIFT SPOT vs PERP)
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
            <span
              style={{
                fontSize: '26px',
                fontWeight: 800,
                color: isDriftHealthy ? '#4ade80' : '#fbbf24',
              }}
            >
              {props.maxObservedDeltaDriftBps} bps
            </span>
            <span style={{ fontSize: '12px', color: '#94a3b8' }}>/ Máx 15 bps (0.15%)</span>
          </div>
          <span style={{ fontSize: '12px', color: isDriftHealthy ? '#86efac' : '#fde047' }}>
            {isDriftHealthy
              ? '✓ Neutralidad Delta Confirmada (Exposición Direccional = 0)'
              : '⚡ Rebalanceo Automático de Pierna Perp en Curso'}
          </span>
        </div>

        {/* Tarjeta C: APR Instantáneo Ponderado vs Piso Vault Estable */}
        <div style={cardStyle}>
          <span style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8' }}>
            APR INSTANTÁNEO PONDERADO (FUNDING / LP)
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
            <span style={{ fontSize: '26px', fontWeight: 800, color: '#a855f7' }}>
              {formatBpsPct(props.weightedAprBps)} APR
            </span>
            <span style={{ fontSize: '12px', color: '#94a3b8' }}>
              (Piso Vault Estable: {formatBpsPct(props.stableVaultFloorAprBps)})
            </span>
          </div>
          <span style={{ fontSize: '12px', color: '#cbd5e1' }}>
            Umbral de Activación Spot-Perp: <strong>&ge; 11.00% APR (1100 bps)</strong>
          </span>
        </div>

        {/* Tarjeta D: Rendimiento Acumulado Cosechado en USD */}
        <div style={cardStyle}>
          <span style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8' }}>
            RENDIMIENTO ACUMULADO COSECHADO (YIELD NETO)
          </span>
          <span style={{ fontSize: '26px', fontWeight: 800, color: '#4ade80' }}>
            {formatMicroUsd(props.totalCumulativeYieldMicroUsd, true)}
          </span>
          <span style={{ fontSize: '12px', color: '#cbd5e1' }}>
            Kaufman ER: <strong>{formatBpsPct(props.regimeTelemetry.kaufman_er_bps)}</strong> · ATR
            Ratio: <strong>{formatBpsPct(props.regimeTelemetry.atr_ratio_bps)}</strong> · BBW:{' '}
            <strong>{formatBpsPct(props.regimeTelemetry.bollinger_width_bps)}</strong>
          </span>
        </div>
      </div>

      {/* 2. TABLA DE POSICIONES SINTÉTICAS SPOT-PERP 1X Y VAULT ESTABLE */}
      <div style={cardStyle}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '8px',
          }}
        >
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#e2e8f0' }}>
            BÓVEDA DE POSICIONES SINTÉTICAS DELTA-NEUTRALES (AETHER CARRY LEDGER)
          </h3>
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>
            {props.positions.length} Posiciones Activas
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '13px',
              textAlign: 'left',
            }}
          >
            <thead>
              <tr
                style={{
                  borderBottom: '1px solid rgba(148, 163, 184, 0.2)',
                  color: '#94a3b8',
                  fontSize: '11px',
                }}
              >
                <th style={{ padding: '10px 8px' }}>ID POSICIÓN</th>
                <th style={{ padding: '10px 8px' }}>ACTIVO</th>
                <th style={{ padding: '10px 8px' }}>ESTRATEGIA</th>
                <th style={{ padding: '10px 8px' }}>NOCIONAL DESPLEGADO</th>
                <th style={{ padding: '10px 8px' }}>UNIDADES SPOT / SHORT 1X</th>
                <th style={{ padding: '10px 8px' }}>DELTA DRIFT</th>
                <th style={{ padding: '10px 8px' }}>APR ACTUAL</th>
                <th style={{ padding: '10px 8px' }}>ÉPOCAS NEG.</th>
                <th style={{ padding: '10px 8px' }}>YIELD COSECHADO</th>
                <th style={{ padding: '10px 8px' }}>ESTADO</th>
              </tr>
            </thead>
            <tbody>
              {props.positions.length === 0 ? (
                <tr>
                  <td
                    colSpan={10}
                    style={{ padding: '20px', textAlign: 'center', color: '#64748b' }}
                  >
                    Sin posiciones activas en Aether Carry Ledger.
                  </td>
                </tr>
              ) : (
                props.positions.map((pos) => (
                  <tr
                    key={pos.carry_id}
                    style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.08)' }}
                  >
                    <td style={{ padding: '10px 8px', fontFamily: 'monospace', color: '#cbd5e1' }}>
                      {pos.carry_id}
                    </td>
                    <td style={{ padding: '10px 8px', fontWeight: 700, color: '#f8fafc' }}>
                      {pos.asset_symbol}
                    </td>
                    <td style={{ padding: '10px 8px' }}>
                      <span
                        style={{
                          padding: '3px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 700,
                          background:
                            pos.strategy_type === 'FUNDING_BASIS_ARB'
                              ? 'rgba(56, 189, 248, 0.15)'
                              : 'rgba(168, 85, 247, 0.15)',
                          color:
                            pos.strategy_type === 'FUNDING_BASIS_ARB' ? '#38bdf8' : '#c084fc',
                        }}
                      >
                        {pos.strategy_type}
                      </span>
                    </td>
                    <td style={{ padding: '10px 8px', fontWeight: 600 }}>
                      {formatMicroUsd(pos.notional_deployed_micro_usd)}
                    </td>
                    <td style={{ padding: '10px 8px', fontFamily: 'monospace', fontSize: '12px' }}>
                      {formatUnitsMicro(pos.spot_units_micro)} /{' '}
                      {formatUnitsMicro(pos.perp_short_units_micro)}
                    </td>
                    <td
                      style={{
                        padding: '10px 8px',
                        fontWeight: 700,
                        color: Number(pos.delta_drift_bps) <= 15 ? '#4ade80' : '#fbbf24',
                      }}
                    >
                      {pos.delta_drift_bps} bps
                    </td>
                    <td style={{ padding: '10px 8px', fontWeight: 700, color: '#c084fc' }}>
                      {formatBpsPct(pos.current_apr_bps)}
                    </td>
                    <td style={{ padding: '10px 8px', color: '#94a3b8' }}>
                      {pos.consecutive_negative_funding_epochs} / 2
                    </td>
                    <td style={{ padding: '10px 8px', fontWeight: 700, color: '#4ade80' }}>
                      {formatMicroUsd(pos.cumulative_yield_micro_usd, true)}
                    </td>
                    <td style={{ padding: '10px 8px', fontSize: '11px', fontWeight: 700 }}>
                      {pos.status}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 3. PANEL DE TELEMETRÍA DE CONFLUENCIA MULTI-BALLENA Y ÓRDENES PULLBACK (FASE 1) */}
      <div style={cardStyle}>
        <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#e2e8f0' }}>
          COLA DE INTENCIONES SMART PULLBACK (FIB 38.2% / VWAP) & CONSENSO DE BALLENAS
        </h3>
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '13px',
              textAlign: 'left',
            }}
          >
            <thead>
              <tr
                style={{
                  borderBottom: '1px solid rgba(148, 163, 184, 0.2)',
                  color: '#94a3b8',
                  fontSize: '11px',
                }}
              >
                <th style={{ padding: '10px 8px' }}>TOKEN</th>
                <th style={{ padding: '10px 8px' }}>CONFLUENCIA</th>
                <th style={{ padding: '10px 8px' }}>PESO ASIGNADO</th>
                <th style={{ padding: '10px 8px' }}>PRECIO PRE-BALLENA</th>
                <th style={{ padding: '10px 8px' }}>PICO DE MECHA</th>
                <th style={{ padding: '10px 8px' }}>LÍMITE OBJETIVO (FIB 38.2%)</th>
                <th style={{ padding: '10px 8px' }}>ESTADO</th>
              </tr>
            </thead>
            <tbody>
              {props.activePullbackIntents.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    style={{ padding: '18px', textAlign: 'center', color: '#64748b' }}
                  >
                    Sin órdenes límite de retroceso pendientes en este segundo.
                  </td>
                </tr>
              ) : (
                props.activePullbackIntents.map((intent) => (
                  <tr
                    key={intent.intent_id}
                    style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.08)' }}
                  >
                    <td style={{ padding: '10px 8px', fontWeight: 700 }}>
                      {intent.token_symbol}
                    </td>
                    <td style={{ padding: '10px 8px' }}>
                      {intent.confluence_count} Ballena(s) LIVE
                    </td>
                    <td style={{ padding: '10px 8px', fontWeight: 700, color: '#38bdf8' }}>
                      {formatBpsPct(intent.allocated_weight_bps)}
                    </td>
                    <td style={{ padding: '10px 8px' }}>
                      {formatMicroUsd(intent.pre_whale_price_micro_usd)}
                    </td>
                    <td style={{ padding: '10px 8px', color: '#f87171' }}>
                      {formatMicroUsd(intent.peak_impact_price_micro_usd)}
                    </td>
                    <td style={{ padding: '10px 8px', fontWeight: 700, color: '#4ade80' }}>
                      {formatMicroUsd(intent.limit_target_price_micro_usd)}
                    </td>
                    <td style={{ padding: '10px 8px', fontSize: '11px', fontWeight: 700 }}>
                      {intent.status}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
};
