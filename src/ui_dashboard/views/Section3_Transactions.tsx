import React, { useState, useMemo } from 'react';

export interface TradeLedgerItem {
  positionId: string;
  engineOrigin: 'SENTINEL_ONCHAIN' | 'CATALYST_NEWS';
  signalRefId?: string;
  executionMode: 'SHADOW' | 'LIVE';
  instrumentTicker: string;
  side: number; // 1 = BUY / LONG, -1 = SELL / SHORT
  notionalInvestedMicro: string;
  entryPriceMicro: string;
  peakPriceMicro?: string;
  exitPriceMicro?: string;
  quantityAtomic?: string;
  stopLossMicro?: string;
  status: 'OPEN' | 'PARTIALLY_CLOSED' | 'CLOSED' | 'STOPPED_OUT' | 'TIME_STOPPED' | string;
  realizedPnlMicro: string;
  unrealizedPnlMicro: string;
  openedAtMs: number;
  closedAtMs: number | null;
}

export interface LifetimeKpis {
  totalTrades: number;
  closedCount: number;
  winningCount: number;
  losingCount: number;
  winRatePct: string;
  netRealizedUsd: number;
  grossProfitUsd: number;
  grossLossUsd: number;
  profitFactor: string;
}

export interface Section3TransactionsProps {
  trades: TradeLedgerItem[];
  lifetimeKpis?: LifetimeKpis | null;
}

type FilterOption = 'TODOS' | 'SOLO_SHADOW' | 'SOLO_LIVE' | 'GANADORAS' | 'PERDEDORAS';

export const Section3Transactions: React.FC<Section3TransactionsProps> = ({ trades, lifetimeKpis }) => {
  const [filter, setFilter] = useState<FilterOption>('TODOS');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const fontSans = '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const fontMono = '"JetBrains Mono", "Fira Code", monospace';

  // Filtrado de Trades
  const filteredTrades = useMemo(() => {
    return trades.filter(t => {
      // Filtro de categoría
      if (filter === 'SOLO_SHADOW' && t.executionMode !== 'SHADOW') return false;
      if (filter === 'SOLO_LIVE' && t.executionMode !== 'LIVE') return false;
      if (filter === 'GANADORAS' && Number(t.realizedPnlMicro) <= 0) return false;
      if (filter === 'PERDEDORAS' && Number(t.realizedPnlMicro) >= 0) return false;

      // Filtro de búsqueda por ticker o ID o Firma Solscan
      if (searchQuery.trim().length > 0) {
        const q = searchQuery.toLowerCase().trim();
        const matchesTicker = t.instrumentTicker.toLowerCase().includes(q);
        const matchesId = t.positionId.toLowerCase().includes(q);
        const matchesOrigin = t.engineOrigin.toLowerCase().includes(q);
        const matchesRef = (t.signalRefId || '').toLowerCase().includes(q);
        if (!matchesTicker && !matchesId && !matchesOrigin && !matchesRef) return false;
      }

      return true;
    });
  }, [trades, filter, searchQuery]);

  // Métricas KPI Consolidadas (Histórico Global SQLite o Filtrado)
  const kpis = useMemo(() => {
    // Si estamos en la vista general sin filtros activos y disponemos de métricas consolidadas de SQLite:
    if (filter === 'TODOS' && searchQuery.trim() === '' && lifetimeKpis) {
      return {
        totalTrades: lifetimeKpis.totalTrades,
        closedCount: lifetimeKpis.closedCount,
        winningCount: lifetimeKpis.winningCount,
        losingCount: lifetimeKpis.losingCount,
        winRatePct: lifetimeKpis.winRatePct,
        netRealizedUsd: lifetimeKpis.netRealizedUsd,
        profitFactor: lifetimeKpis.profitFactor,
        isLifetime: true
      };
    }

    // Cálculo dinámico sobre dataset filtrado:
    let grossProfitUsd = 0;
    let grossLossUsd = 0;
    let netRealizedUsd = 0;
    let closedCount = 0;
    let winningCount = 0;
    let losingCount = 0;

    const dataset = (filter === 'TODOS' && searchQuery.trim() === '') ? trades : filteredTrades;

    for (const t of dataset) {
      const pnlUsd = Number(t.realizedPnlMicro) / 1_000_000;
      netRealizedUsd += pnlUsd;

      const isClosed = t.status === 'CLOSED' || t.status === 'STOPPED_OUT' || t.status === 'TIME_STOPPED' || t.closedAtMs !== null;
      if (isClosed) {
        closedCount++;
        if (pnlUsd > 0) {
          winningCount++;
          grossProfitUsd += pnlUsd;
        } else if (pnlUsd < 0) {
          losingCount++;
          grossLossUsd += Math.abs(pnlUsd);
        }
      }
    }

    const winRatePct = closedCount > 0 ? ((winningCount / closedCount) * 100).toFixed(1) : '0.0';
    const profitFactor = grossLossUsd > 0
      ? (grossProfitUsd / grossLossUsd).toFixed(2)
      : grossProfitUsd > 0 ? 'MAX' : '0.00';

    return {
      totalTrades: dataset.length,
      closedCount,
      winningCount,
      losingCount,
      winRatePct,
      netRealizedUsd,
      profitFactor,
      isLifetime: false
    };
  }, [trades, filteredTrades, filter, searchQuery, lifetimeKpis]);

  // Funciones de Formateo
  const formatDate = (ms: number): string => {
    if (!ms) return '--:--:-- --/--';
    const d = new Date(ms);
    const pad = (n: number) => n.toString().padStart(2, '0');
    const hours = pad(d.getHours());
    const minutes = pad(d.getMinutes());
    const seconds = pad(d.getSeconds());
    const day = pad(d.getDate());
    const month = pad(d.getMonth() + 1);
    return `${hours}:${minutes}:${seconds} ${day}/${month}`;
  };

  const formatPrice = (microStr: string): string => {
    const num = Number(microStr) / 1_000_000;
    if (isNaN(num)) return '$0.00';
    if (num >= 1000) return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (num >= 1) return `$${num.toFixed(4)}`;
    return `$${num.toFixed(6)}`;
  };

  const formatNotional = (microStr: string): string => {
    const num = Number(microStr) / 1_000_000;
    return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatPnl = (realizedMicroStr: string, notionalMicroStr: string) => {
    const pnlUsd = Number(realizedMicroStr) / 1_000_000;
    const notionalUsd = Number(notionalMicroStr) / 1_000_000;
    const pnlPct = notionalUsd > 0 ? (pnlUsd / notionalUsd) * 100 : 0;
    const isPositive = pnlUsd > 0;
    const isZero = pnlUsd === 0;
    const sign = isPositive ? '+' : '';
    const color = isZero ? '#94a3b8' : isPositive ? '#34d399' : '#f87171';
    return {
      text: `${sign}$${pnlUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${sign}${pnlPct.toFixed(2)}%)`,
      color,
      pnlUsd,
      isPositive,
      isZero
    };
  };

  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'OPEN':
        return (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            padding: '3px 8px',
            borderRadius: '4px',
            fontSize: '11px',
            fontWeight: 700,
            fontFamily: fontSans,
            background: 'rgba(56, 189, 248, 0.15)',
            color: '#38bdf8',
            border: '1px solid rgba(56, 189, 248, 0.3)'
          }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#38bdf8', boxShadow: '0 0 6px #38bdf8' }} />
            OPEN
          </span>
        );
      case 'PARTIALLY_CLOSED':
        return (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            padding: '3px 8px',
            borderRadius: '4px',
            fontSize: '11px',
            fontWeight: 700,
            fontFamily: fontSans,
            background: 'rgba(245, 158, 11, 0.15)',
            color: '#fbbf24',
            border: '1px solid rgba(245, 158, 11, 0.3)'
          }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#f59e0b' }} />
            DERISKED_75%
          </span>
        );
      case 'CLOSED':
        return (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            padding: '3px 8px',
            borderRadius: '4px',
            fontSize: '11px',
            fontWeight: 700,
            fontFamily: fontSans,
            background: 'rgba(16, 185, 129, 0.15)',
            color: '#34d399',
            border: '1px solid rgba(16, 185, 129, 0.3)'
          }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981' }} />
            CLOSED
          </span>
        );
      case 'STOPPED_OUT':
        return (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            padding: '3px 8px',
            borderRadius: '4px',
            fontSize: '11px',
            fontWeight: 700,
            fontFamily: fontSans,
            background: 'rgba(239, 68, 68, 0.15)',
            color: '#f87171',
            border: '1px solid rgba(239, 68, 68, 0.3)'
          }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#ef4444' }} />
            STOPPED_OUT
          </span>
        );
      case 'TIME_STOPPED':
        return (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            padding: '3px 8px',
            borderRadius: '4px',
            fontSize: '11px',
            fontWeight: 700,
            fontFamily: fontSans,
            background: 'rgba(148, 163, 184, 0.15)',
            color: '#94a3b8',
            border: '1px solid rgba(148, 163, 184, 0.3)'
          }}>
            ⏱️ TIME_STOPPED
          </span>
        );
      default:
        return (
          <span style={{
            padding: '3px 8px',
            borderRadius: '4px',
            fontSize: '11px',
            fontWeight: 600,
            background: 'rgba(255, 255, 255, 0.05)',
            color: '#94a3b8'
          }}>
            {status}
          </span>
        );
    }
  };

  return (
    <div style={{ padding: '24px 28px', color: '#e2e8f0', fontFamily: fontSans }}>
      {/* Título de Sección y Telemetría General */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '22px' }}>
        <div>
          <h2 style={{
            fontSize: '18px',
            fontWeight: 800,
            letterSpacing: '-0.3px',
            color: '#f8fafc',
            margin: '0 0 4px 0',
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
          }}>
            📜 LIBRO MAYOR DE TRANSACCIONES & POSICIONES
            <span style={{
              fontSize: '11px',
              fontFamily: fontMono,
              background: 'rgba(56, 189, 248, 0.1)',
              color: '#38bdf8',
              padding: '2px 8px',
              borderRadius: '4px',
              border: '1px solid rgba(56, 189, 248, 0.25)'
            }}>
              UNIFIED LEDGER WAL
            </span>
          </h2>
          <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>
            Auditoría de ejecuciones atómicas on-chain Sentinel y arbitraje de catalizadores Catalyst en tiempo real.
          </p>
        </div>

        {/* Buscador Rápido */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="text"
            placeholder="Buscar por Ticker, PosID o Motor..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              background: 'rgba(15, 23, 42, 0.8)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '6px',
              padding: '7px 14px',
              color: '#f8fafc',
              fontFamily: fontMono,
              fontSize: '12px',
              width: '260px',
              outline: 'none',
              transition: 'border-color 0.2s'
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = '#38bdf8'; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)'; }}
          />
        </div>
      </div>

      {/* Tarjetas Resumen KPI Superiores */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '16px',
        marginBottom: '22px'
      }}>
        {/* KPI 1: Win Rate */}
        <div style={{
          background: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '10px',
          padding: '16px 20px',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)'
        }}>
          <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '6px' }}>
            Win Rate (Cerradas)
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span style={{ fontFamily: fontMono, fontSize: '24px', fontWeight: 800, color: Number(kpis.winRatePct) >= 50 ? '#34d399' : '#f87171' }}>
              {kpis.winRatePct}%
            </span>
            <span style={{ fontSize: '11px', color: '#64748b', fontFamily: fontMono }}>
              ({kpis.winningCount}W / {kpis.losingCount}L)
            </span>
          </div>
          <div style={{ marginTop: '6px', width: '100%', height: '4px', background: 'rgba(255, 255, 255, 0.06)', borderRadius: '999px', overflow: 'hidden' }}>
            <div style={{
              width: `${Math.min(100, Math.max(0, Number(kpis.winRatePct)))}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #10b981, #34d399)',
              borderRadius: '999px'
            }} />
          </div>
        </div>

        {/* KPI 2: Total Operaciones */}
        <div style={{
          background: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '10px',
          padding: '16px 20px',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)'
        }}>
          <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '6px' }}>
            Total Operaciones {kpis.isLifetime ? '(Histórico SQLite)' : '(Filtradas)'}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span style={{ fontFamily: fontMono, fontSize: '24px', fontWeight: 800, color: '#38bdf8' }}>
              {kpis.totalTrades}
            </span>
            <span style={{ fontSize: '11px', color: '#64748b', fontFamily: fontMono }}>
              en Ledger
            </span>
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '6px' }}>
            {kpis.closedCount} cerradas • {kpis.totalTrades - kpis.closedCount} abiertas
            {kpis.isLifetime && <span style={{ color: '#38bdf8', marginLeft: '6px' }}>(100 recientes en tabla)</span>}
          </div>
        </div>

        {/* KPI 3: PnL Neto Realizado */}
        <div style={{
          background: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '10px',
          padding: '16px 20px',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)'
        }}>
          <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '6px' }}>
            PnL Neto Realizado
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span style={{
              fontFamily: fontMono,
              fontSize: '24px',
              fontWeight: 800,
              color: kpis.netRealizedUsd >= 0 ? '#34d399' : '#f87171'
            }}>
              {kpis.netRealizedUsd >= 0 ? '+' : ''}${kpis.netRealizedUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span style={{ fontSize: '11px', color: '#64748b', fontFamily: fontMono }}>
              USD
            </span>
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '6px' }}>
            Liquidado en Billeteras
          </div>
        </div>

        {/* KPI 4: Profit Factor */}
        <div style={{
          background: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '10px',
          padding: '16px 20px',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)'
        }}>
          <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '6px' }}>
            Profit Factor
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span style={{
              fontFamily: fontMono,
              fontSize: '24px',
              fontWeight: 800,
              color: kpis.profitFactor === 'MAX' || Number(kpis.profitFactor) >= 1.5 ? '#38bdf8' : '#fbbf24'
            }}>
              {kpis.profitFactor}
            </span>
            <span style={{ fontSize: '11px', color: '#64748b', fontFamily: fontMono }}>
              Ratio Bruto W/L
            </span>
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '6px' }}>
            Objetivo Institucional &gt; 1.50
          </div>
        </div>
      </div>

      {/* Barra de Filtros */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '16px',
        background: 'rgba(15, 23, 42, 0.5)',
        padding: '8px 14px',
        borderRadius: '8px',
        border: '1px solid rgba(255, 255, 255, 0.06)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', marginRight: '4px' }}>
            Filtros:
          </span>

          {(['TODOS', 'SOLO_SHADOW', 'SOLO_LIVE', 'GANADORAS', 'PERDEDORAS'] as FilterOption[]).map((opt) => {
            const labels: Record<FilterOption, string> = {
              TODOS: 'TODOS',
              SOLO_SHADOW: 'SOLO SHADOW',
              SOLO_LIVE: 'SOLO LIVE',
              GANADORAS: 'GANADORAS (PnL > 0)',
              PERDEDORAS: 'PERDEDORAS (PnL < 0)'
            };
            const isActive = filter === opt;
            return (
              <button
                key={opt}
                onClick={() => setFilter(opt)}
                style={{
                  background: isActive ? '#1f6feb' : 'rgba(255, 255, 255, 0.04)',
                  color: isActive ? '#ffffff' : '#94a3b8',
                  border: `1px solid ${isActive ? '#388bfd' : 'rgba(255, 255, 255, 0.08)'}`,
                  padding: '5px 12px',
                  borderRadius: '6px',
                  fontFamily: fontSans,
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  boxShadow: isActive ? '0 0 10px rgba(31, 111, 235, 0.4)' : 'none'
                }}
              >
                {labels[opt]}
              </button>
            );
          })}
        </div>

        <div style={{ fontSize: '11px', color: '#64748b', fontFamily: fontMono }}>
          Mostrando <strong style={{ color: '#f8fafc' }}>{filteredTrades.length}</strong> {kpis.isLifetime ? `recientes (de ${kpis.totalTrades} totales en SQLite)` : `de ${trades.length} en memoria`}
        </div>
      </div>

      {/* Tabla de Registro de Transacciones */}
      <div style={{
        background: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '10px',
        overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{
              background: 'rgba(22, 27, 34, 0.95)',
              borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
              fontSize: '11px',
              color: '#8b949e',
              textTransform: 'uppercase',
              letterSpacing: '0.4px',
              fontFamily: fontSans
            }}>
              <th style={{ padding: '12px 16px' }}>Hora / Fecha</th>
              <th style={{ padding: '12px 16px' }}>Modo</th>
              <th style={{ padding: '12px 16px' }}>Motor / Origen</th>
              <th style={{ padding: '12px 16px' }}>Par / Ticker</th>
              <th style={{ padding: '12px 16px' }}>Lado</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>Tamaño ($ USD)</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>Precio Entrada -&gt; Cierre</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>PnL ($ y %)</th>
              <th style={{ padding: '12px 16px', textAlign: 'center' }}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {filteredTrades.length === 0 ? (
              <tr>
                <td colSpan={9} style={{
                  padding: '48px 16px',
                  textAlign: 'center',
                  color: '#64748b',
                  fontFamily: fontMono,
                  fontSize: '13px'
                }}>
                  <div style={{ fontSize: '24px', marginBottom: '8px' }}>🔍</div>
                  No se encontraron transacciones en el Ledger para el filtro seleccionado.
                </td>
              </tr>
            ) : (
              filteredTrades.map((trade, idx) => {
                const pnl = formatPnl(trade.realizedPnlMicro, trade.notionalInvestedMicro);
                const isBuy = trade.side === 1;
                const isShadow = trade.executionMode === 'SHADOW';
                const isClosed = trade.status === 'CLOSED' || trade.status === 'STOPPED_OUT' || trade.status === 'TIME_STOPPED' || trade.closedAtMs !== null;
                
                // Calcular el precio de salida real en vez de usar peakPriceMicro
                let exitPriceMicroComputed: string | undefined = trade.exitPriceMicro;
                if (!exitPriceMicroComputed && isClosed && trade.quantityAtomic && Number(trade.quantityAtomic) > 0 && trade.realizedPnlMicro && trade.realizedPnlMicro !== '0') {
                  const pnlMicro = Number(trade.realizedPnlMicro);
                  const qtyAtomic = Number(trade.quantityAtomic);
                  const deltaMicro = (pnlMicro * 1_000_000_000) / qtyAtomic;
                  const entryMicro = Number(trade.entryPriceMicro);
                  const exitMicro = trade.side === 1 ? entryMicro + deltaMicro : entryMicro - deltaMicro;
                  if (exitMicro > 0) {
                    exitPriceMicroComputed = Math.round(exitMicro).toString();
                  }
                }

                const exitPriceFormatted = isClosed
                  ? (exitPriceMicroComputed ? formatPrice(exitPriceMicroComputed) : (trade.peakPriceMicro ? formatPrice(trade.peakPriceMicro) : '--'))
                  : 'EN VIVO';

                return (
                  <tr
                    key={trade.positionId || idx}
                    style={{
                      borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                      background: idx % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.015)',
                      transition: 'background 0.15s ease'
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(56, 189, 248, 0.05)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = idx % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.015)'; }}
                  >
                    {/* Hora / Fecha */}
                    <td style={{ padding: '12px 16px', fontFamily: fontMono, fontSize: '11px', color: '#94a3b8', whiteSpace: 'nowrap' }}>
                      {formatDate(trade.openedAtMs)}
                    </td>

                    {/* Modo (SHADOW / LIVE) */}
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '2px 7px',
                        borderRadius: '4px',
                        fontSize: '10px',
                        fontWeight: 700,
                        fontFamily: fontMono,
                        background: isShadow ? 'rgba(56, 189, 248, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                        color: isShadow ? '#38bdf8' : '#f87171',
                        border: `1px solid ${isShadow ? 'rgba(56, 189, 248, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`
                      }}>
                        {trade.executionMode}
                      </span>
                    </td>

                    {/* Motor / Origen & Firma On-Chain Solscan */}
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        <span style={{
                          fontSize: '11px',
                          fontWeight: 600,
                          fontFamily: fontMono,
                          color: trade.engineOrigin === 'SENTINEL_ONCHAIN' ? '#a78bfa' : '#38bdf8',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}>
                          <span>{trade.engineOrigin === 'SENTINEL_ONCHAIN' ? '👁️ SENTINEL' : '⚡ CATALYST'}</span>
                        </span>
                        {trade.signalRefId && (
                          trade.signalRefId.length > 40 ? (
                            <a
                              href={`https://solscan.io/tx/${trade.signalRefId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={`Verificar en Solscan Mainnet: ${trade.signalRefId}`}
                              style={{
                                fontSize: '10px',
                                fontFamily: fontMono,
                                color: '#38bdf8',
                                textDecoration: 'none',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px',
                                background: 'rgba(56, 189, 248, 0.1)',
                                padding: '1px 6px',
                                borderRadius: '3px',
                                border: '1px solid rgba(56, 189, 248, 0.25)',
                                width: 'fit-content'
                              }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <span>🔗 {trade.signalRefId.slice(0, 4)}...{trade.signalRefId.slice(-4)}</span>
                              <span style={{ fontSize: '9px' }}>↗</span>
                            </a>
                          ) : (
                            <span style={{ fontSize: '10px', color: '#64748b', fontFamily: fontMono }}>
                              {trade.signalRefId}
                            </span>
                          )
                        )}
                      </div>
                    </td>

                    {/* Par / Ticker */}
                    <td style={{ padding: '12px 16px', fontFamily: fontMono, fontWeight: 700, fontSize: '12px', color: '#f8fafc' }}>
                      {trade.instrumentTicker}
                    </td>

                    {/* Lado (BUY / SELL) */}
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 700,
                        fontFamily: fontMono,
                        background: isBuy ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                        color: isBuy ? '#34d399' : '#f87171',
                        border: `1px solid ${isBuy ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`
                      }}>
                        {isBuy ? 'BUY' : 'SELL'}
                      </span>
                    </td>

                    {/* Tamaño ($ USD) */}
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: fontMono, fontSize: '12px', color: '#e2e8f0', fontWeight: 600 }}>
                      {formatNotional(trade.notionalInvestedMicro)}
                    </td>

                    {/* Precio Entrada vs Cierre */}
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: fontMono, fontSize: '11px', color: '#94a3b8' }}>
                      <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{formatPrice(trade.entryPriceMicro)}</span>
                      <span style={{ color: '#64748b', margin: '0 4px' }}>-&gt;</span>
                      <span style={{ color: isClosed ? '#38bdf8' : '#fbbf24', fontWeight: 600 }}>{exitPriceFormatted}</span>
                    </td>

                    {/* PnL ($ y %) */}
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: fontMono, fontSize: '12px', fontWeight: 700, color: pnl.color }}>
                      {pnl.text}
                    </td>

                    {/* Estado */}
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      {renderStatusBadge(trade.status)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
