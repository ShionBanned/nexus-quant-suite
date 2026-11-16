import React from 'react';

export interface CatalystFeedItem {
  eventId: string;
  simhash64Hex: string;
  headline: string;
  sources: string[];
  primaryTicker: string;
  category: string;
  direction: number; // 1 = Bull, -1 = Bear
  siaBps: number;
  sourceTrustBps: number;
  flowConfirmBps: number;
  preEventDrift15mBps: number;
  iSecurity: number;
  iNoLeak: number;
  decayFactorBps: number;
  convictionCtBps: number;
  actionTaken: 'STRIKE_T1' | 'PROBE_T2' | 'PANIC_SHORT' | 'QUARANTINE' | 'DROPPED';
  publishedAt: string;
  articleUrl?: string;
}

export interface AnchoredIocOrderItem {
  orderId: string;
  ticker: string;
  anchorPriceUsd: string;
  limitCapUsd: string;
  serverStopLossUsd: string;
  filledVwapUsd?: string;
  status: 'PENDING_SWEEP' | 'FILLED' | 'PARTIALLY_FILLED' | 'LATE_ENTRY_PULLBACK_LIMIT';
  timeStopCountdownSeconds: number;
  deRiskStatus: 'PENDING' | 'DERISKED_65PCT' | 'TIME_STOPPED';
}

export interface Section2CatalystProps {
  feedItems: CatalystFeedItem[];
  activeOrders: AnchoredIocOrderItem[];
}

export const Section2Catalyst: React.FC<Section2CatalystProps> = ({
  feedItems,
  activeOrders
}) => {
  const fontSans = '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const fontMono = '"JetBrains Mono", "Fira Code", monospace';

  const renderActionBadge = (action: CatalystFeedItem['actionTaken']) => {
    switch (action) {
      case 'STRIKE_T1':
        return (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            padding: '4px 10px',
            borderRadius: '6px',
            fontSize: '11px',
            fontWeight: 800,
            fontFamily: fontSans,
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.25) 0%, rgba(5, 150, 105, 0.2) 100%)',
            color: '#34d399',
            border: '1px solid rgba(16, 185, 129, 0.4)',
            boxShadow: '0 0 10px rgba(16, 185, 129, 0.2)'
          }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981', boxShadow: '0 0 6px #10b981' }} />
            STRIKE TIER 1
          </span>
        );
      case 'PROBE_T2':
        return (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            padding: '4px 10px',
            borderRadius: '6px',
            fontSize: '11px',
            fontWeight: 800,
            fontFamily: fontSans,
            background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.25) 0%, rgba(37, 99, 235, 0.2) 100%)',
            color: '#38bdf8',
            border: '1px solid rgba(56, 189, 248, 0.4)',
            boxShadow: '0 0 10px rgba(56, 189, 248, 0.2)'
          }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#38bdf8', boxShadow: '0 0 6px #38bdf8' }} />
            PROBE TIER 2
          </span>
        );
      case 'PANIC_SHORT':
        return (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            padding: '4px 10px',
            borderRadius: '6px',
            fontSize: '11px',
            fontWeight: 800,
            fontFamily: fontSans,
            background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.25) 0%, rgba(185, 28, 28, 0.2) 100%)',
            color: '#f87171',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            boxShadow: '0 0 10px rgba(239, 68, 68, 0.2)'
          }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#ef4444', boxShadow: '0 0 6px #ef4444' }} />
            PANIC SHORT
          </span>
        );
      case 'QUARANTINE':
        return (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            padding: '4px 10px',
            borderRadius: '6px',
            fontSize: '11px',
            fontWeight: 700,
            fontFamily: fontSans,
            background: 'rgba(245, 158, 11, 0.15)',
            color: '#fbbf24',
            border: '1px solid rgba(245, 158, 11, 0.3)'
          }}>
            <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#fbbf24' }} />
            QUARANTINE
          </span>
        );
      default:
        return (
          <span style={{
            padding: '3px 8px',
            borderRadius: '6px',
            fontSize: '11px',
            color: '#64748b',
            background: 'rgba(255, 255, 255, 0.05)'
          }}>
            DROPPED
          </span>
        );
    }
  };

  return (
    <div style={{ padding: '24px 28px', color: '#e2e8f0', fontFamily: fontSans }}>
      {/* Título de Sección */}
      <div style={{ marginBottom: '22px' }}>
        <h2 style={{
          fontSize: '18px',
          fontWeight: 800,
          margin: '0 0 4px 0',
          letterSpacing: '-0.3px',
          color: '#f8fafc',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <span style={{ color: '#38bdf8' }}>MOTOR B</span> • CATALYST ENGINE
          <span style={{
            fontSize: '11px',
            fontFamily: fontMono,
            fontWeight: 600,
            color: '#38bdf8',
            background: 'rgba(56, 189, 248, 0.12)',
            border: '1px solid rgba(56, 189, 248, 0.25)',
            padding: '2px 8px',
            borderRadius: '999px'
          }}>
            SUB-SECOND ARBITRAGE
          </span>
        </h2>
        <div style={{ fontSize: '12px', color: '#64748b' }}>
          Deduplicación SimHash 64-bit, inferencia INT8 (&lt; 18ms), matriz de convicción C_t y barrido Anchored IOC
        </div>
      </div>

      {/* Feed Sub-Segundo y Desglose C_t */}
      <div style={{
        background: 'linear-gradient(180deg, rgba(17, 24, 39, 0.7) 0%, rgba(11, 15, 25, 0.9) 100%)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '12px',
        padding: '18px',
        marginBottom: '24px',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <div>
            <h3 style={{ margin: '0 0 2px 0', fontSize: '14px', fontWeight: 700, color: '#f8fafc' }}>
              RADAR DE NOTICIAS Y DESGLOSE VISUAL DE LA ECUACIÓN C_t
            </h3>
            <div style={{ fontSize: '11px', color: '#64748b' }}>
              C_t = 100 &times; (0.45 &middot; S_IA + 0.35 &middot; T_fuente + 0.20 &middot; &Phi;_flujo) &times; I_seguridad &times; I_no-leak &times; e^(-&lambda;&middot;&Delta;t)
            </div>
          </div>
        </div>

        <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ color: '#64748b', borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
              <th style={{ textAlign: 'left', padding: '10px 8px', fontWeight: 600 }}>Titular & Fuentes</th>
              <th style={{ textAlign: 'center', fontWeight: 600 }}>SimHash</th>
              <th style={{ textAlign: 'center', fontWeight: 600 }}>Activo</th>
              <th style={{ textAlign: 'right', fontWeight: 600 }}>S_IA (45%)</th>
              <th style={{ textAlign: 'right', fontWeight: 600 }}>T_fuente (35%)</th>
              <th style={{ textAlign: 'right', fontWeight: 600 }}>&Phi;_flujo (20%)</th>
              <th style={{ textAlign: 'center', fontWeight: 600 }}>Drift 15m</th>
              <th style={{ textAlign: 'right', fontWeight: 600 }}>Decay</th>
              <th style={{ textAlign: 'right', fontWeight: 600 }}>Score C_t</th>
              <th style={{ textAlign: 'right', fontWeight: 600 }}>Comando Disparo</th>
            </tr>
          </thead>
          <tbody>
            {feedItems.map((item, i) => (
              <tr key={i} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.03)' }}>
                <td style={{ padding: '10px 8px', maxWidth: '340px' }}>
                  <div style={{ color: '#f8fafc', fontWeight: 600, fontSize: '13px', lineHeight: '1.4' }}>
                    {item.articleUrl ? (
                      <a
                        href={item.articleUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: '#f8fafc', textDecoration: 'none', transition: 'color 0.15s' }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = '#38bdf8'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = '#f8fafc'; }}
                        title="Ver noticia real publicada en prensa"
                      >
                        {item.headline} <span style={{ fontSize: '11px', color: '#38bdf8' }}>↗</span>
                      </a>
                    ) : (
                      item.headline
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                    <span style={{ fontSize: '10px', color: '#38bdf8', background: 'rgba(56, 189, 248, 0.1)', padding: '1px 6px', borderRadius: '4px' }}>
                      {item.sources.join(', ')}
                    </span>
                    <span style={{ fontSize: '10px', color: '#94a3b8', background: 'rgba(255, 255, 255, 0.05)', padding: '1px 6px', borderRadius: '4px' }}>
                      {item.category}
                    </span>
                  </div>
                </td>
                <td style={{ textAlign: 'center', fontFamily: fontMono, fontSize: '11px', color: '#64748b' }}>
                  {item.simhash64Hex.slice(0, 8)}...
                </td>
                <td style={{ textAlign: 'center' }}>
                  <span style={{
                    fontFamily: fontMono,
                    fontWeight: 800,
                    fontSize: '13px',
                    color: item.direction > 0 ? '#34d399' : '#f87171'
                  }}>
                    {item.primaryTicker}
                  </span>
                </td>
                <td style={{ textAlign: 'right', fontFamily: fontMono, color: '#cbd5e1' }}>
                  {(item.siaBps / 100).toFixed(1)}%
                </td>
                <td style={{ textAlign: 'right', fontFamily: fontMono, color: '#cbd5e1' }}>
                  {(item.sourceTrustBps / 100).toFixed(1)}%
                </td>
                <td style={{ textAlign: 'right', fontFamily: fontMono, color: '#cbd5e1' }}>
                  {(item.flowConfirmBps / 100).toFixed(1)}%
                </td>
                <td style={{ textAlign: 'center' }}>
                  <span style={{
                    fontFamily: fontMono,
                    fontSize: '11px',
                    fontWeight: 600,
                    color: Math.abs(item.preEventDrift15mBps) > 220 ? '#f87171' : '#34d399'
                  }}>
                    {item.preEventDrift15mBps > 0 ? '+' : ''}{item.preEventDrift15mBps} bps
                  </span>
                </td>
                <td style={{ textAlign: 'right', fontFamily: fontMono, color: '#64748b' }}>
                  {(item.decayFactorBps / 100).toFixed(1)}%
                </td>
                <td style={{ textAlign: 'right', fontFamily: fontMono, fontWeight: 800, fontSize: '14px', color: item.convictionCtBps >= 8200 ? '#34d399' : '#fbbf24' }}>
                  {(item.convictionCtBps / 100).toFixed(2)}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {renderActionBadge(item.actionTaken)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Monitor de Barrido Anchored IOC y Cronómetros Time-Stop */}
      <div style={{
        background: 'linear-gradient(180deg, rgba(17, 24, 39, 0.7) 0%, rgba(11, 15, 25, 0.9) 100%)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '12px',
        padding: '18px',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <div>
            <h3 style={{ margin: '0 0 2px 0', fontSize: '14px', fontWeight: 700, color: '#f8fafc' }}>
              MONITOR DE BARRIDO ANCHORED IOC Y CRONÓMETROS DE TIME-STOP (45s)
            </h3>
            <div style={{ fontSize: '11px', color: '#64748b' }}>
              Protección anti-slippage tóxico anclada a P_anchor = P_mid(t0 - 500ms) y bracket nativo de servidor (-45 bps)
            </div>
          </div>
        </div>

        <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ color: '#64748b', borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
              <th style={{ textAlign: 'left', padding: '10px 8px', fontWeight: 600 }}>ID Orden</th>
              <th style={{ textAlign: 'left', fontWeight: 600 }}>Activo</th>
              <th style={{ textAlign: 'right', fontWeight: 600 }}>P_anchor (t0 - 500ms)</th>
              <th style={{ textAlign: 'right', fontWeight: 600 }}>Tope Duro (Pcap)</th>
              <th style={{ textAlign: 'right', fontWeight: 600 }}>Piso Pre-Noticia (PSL)</th>
              <th style={{ textAlign: 'right', fontWeight: 600 }}>VWAP Llenado</th>
              <th style={{ textAlign: 'center', fontWeight: 600 }}>Estado Barrido</th>
              <th style={{ textAlign: 'center', fontWeight: 600 }}>Time-Stop (45s)</th>
              <th style={{ textAlign: 'center', fontWeight: 600 }}>De-Risk (65%)</th>
            </tr>
          </thead>
          <tbody>
            {activeOrders.map((ord, i) => (
              <tr key={i} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.03)' }}>
                <td style={{ padding: '10px 8px', fontFamily: fontMono, color: '#94a3b8' }}>{ord.orderId}</td>
                <td style={{ fontWeight: 800, color: '#f8fafc', fontSize: '13px' }}>{ord.ticker}</td>
                <td style={{ textAlign: 'right', fontFamily: fontMono, color: '#cbd5e1' }}>${ord.anchorPriceUsd}</td>
                <td style={{ textAlign: 'right', fontFamily: fontMono, fontWeight: 700, color: '#fbbf24' }}>${ord.limitCapUsd}</td>
                <td style={{ textAlign: 'right', fontFamily: fontMono, color: '#f87171' }}>
                  ${ord.serverStopLossUsd} <span style={{ fontSize: '10px', color: '#64748b' }}>(-45 bps)</span>
                </td>
                <td style={{ textAlign: 'right', fontFamily: fontMono, fontWeight: 700, color: '#34d399' }}>
                  {ord.filledVwapUsd ? `$${ord.filledVwapUsd}` : '-'}
                </td>
                <td style={{ textAlign: 'center' }}>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '3px 8px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontWeight: 600,
                    background: 'rgba(16, 185, 129, 0.15)',
                    color: '#34d399',
                    border: '1px solid rgba(16, 185, 129, 0.3)'
                  }}>
                    ✓ {ord.status}
                  </span>
                </td>
                <td style={{ textAlign: 'center' }}>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '3px 9px',
                    borderRadius: '999px',
                    fontSize: '11px',
                    fontWeight: 700,
                    fontFamily: fontMono,
                    background: ord.timeStopCountdownSeconds <= 15 ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                    color: ord.timeStopCountdownSeconds <= 15 ? '#f87171' : '#34d399',
                    border: `1px solid ${ord.timeStopCountdownSeconds <= 15 ? 'rgba(239, 68, 68, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`
                  }}>
                    ⏱️ {ord.timeStopCountdownSeconds}s restantes
                  </span>
                </td>
                <td style={{ textAlign: 'center' }}>
                  <span style={{
                    padding: '3px 8px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    color: '#94a3b8',
                    background: 'rgba(255, 255, 255, 0.05)'
                  }}>
                    {ord.deRiskStatus === 'DERISKED_65PCT' ? '✓ DE-RISK 65% COMPLETADO' : 'OBSERVANDO VELOCIDAD'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
