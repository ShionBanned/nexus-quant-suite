import React from 'react';

export interface WalletPoolItem {
  address: string;
  chain: 'SOLANA' | 'BASE' | 'ARBITRUM';
  tier: 'LIVE' | 'SHADOW' | 'PURGED';
  profitFactorScaled: number; // 1750 = 1.75
  winRateBps: number; // 6500 = 65%
  consecutiveLosses: number;
}

export interface ClusterMonitorItem {
  clusterId: string;
  tokenTicker: string;
  tokenAddress: string;
  confluenceStage: '1/3' | '2/3' | '3/3';
  status: 'WATCHING' | 'PHASE1_25PCT' | 'PHASE2_100PCT' | 'PULLBACK_WAIT' | 'ABORTED';
  priceDeltaBps: number;
  firewall: {
    antiSybilPassed: boolean;
    liquidityDepthPassed: boolean;
    mintFreezeNull: boolean;
    top10HoldersPassed: boolean;
    antiHoneypotPassed: boolean;
    latencyMs: number;
  };
}

export interface DexPositionItem {
  positionId: string;
  tokenTicker: string;
  entryPriceUsd: string;
  currentPriceUsd: string;
  pnlBps: number;
  deRiskStatus: 'PENDING' | 'DERISKED_75PCT' | 'CLOSED';
  moonbagStatus: 'INACTIVE' | 'ACTIVE_TRAILING_15PCT' | 'FRONTRUN_EXIT_TRIGGERED';
  remainingTokens: string;
}

export interface Section1SentinelProps {
  wallets: WalletPoolItem[];
  clusters: ClusterMonitorItem[];
  positions: DexPositionItem[];
  nextPurgeCountdownSeconds: number;
}

export const Section1Sentinel: React.FC<Section1SentinelProps> = ({
  wallets = [],
  clusters = [],
  positions = [],
  nextPurgeCountdownSeconds = 0
}) => {
  const liveWallets = (wallets || []).filter(w => w.tier === 'LIVE');
  const shadowWallets = (wallets || []).filter(w => w.tier === 'SHADOW');

  const formatCountdown = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const fontSans = '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const fontMono = '"JetBrains Mono", "Fira Code", monospace';

  // Renderizador de Badge LED con Resplandor (Glow)
  const renderLedBadge = (passed: boolean, label: string = passed ? 'PASS' : 'FAIL') => (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      padding: '3px 9px',
      borderRadius: '999px',
      fontSize: '11px',
      fontWeight: 700,
      fontFamily: fontSans,
      letterSpacing: '0.4px',
      background: passed ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
      color: passed ? '#34d399' : '#f87171',
      border: `1px solid ${passed ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`
    }}>
      <span style={{
        width: '6px',
        height: '6px',
        borderRadius: '50%',
        background: passed ? '#10b981' : '#ef4444',
        boxShadow: `0 0 8px ${passed ? '#10b981' : '#ef4444'}`
      }} />
      {label}
    </span>
  );

  return (
    <div style={{ padding: '24px 28px', color: '#e2e8f0', fontFamily: fontSans }}>
      {/* Título de Sección y Cronómetro de Purga 6h */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '22px' }}>
        <div>
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
            <span style={{ color: '#38bdf8' }}>MOTOR A</span> • SENTINEL QUANT
            <span style={{
              fontSize: '11px',
              fontFamily: fontMono,
              fontWeight: 600,
              color: '#34d399',
              background: 'rgba(16, 185, 129, 0.12)',
              border: '1px solid rgba(16, 185, 129, 0.25)',
              padding: '2px 8px',
              borderRadius: '999px'
            }}>
              CONFLUENCIA 3/10
            </span>
          </h2>
          <div style={{ fontSize: '12px', color: '#64748b' }}>
            Rastreo on-chain multi-cadena de capital inteligente y firewall de confluencia asimétrica
          </div>
        </div>

        {/* Cuenta Regresiva de Rotación 6h */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.8) 100%)',
          padding: '8px 16px',
          borderRadius: '10px',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)'
        }}>
          <span style={{ fontSize: '13px', color: '#f59e0b' }}>⏳</span>
          <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 500 }}>Próximo Ciclo de Purga:</span>
          <span style={{ fontFamily: fontMono, fontSize: '14px', fontWeight: 700, color: '#f59e0b', letterSpacing: '0.5px' }}>
            {formatCountdown(nextPurgeCountdownSeconds)}
          </span>
        </div>
      </div>

      {/* Grid Superior: Pool Dinámico de 50 Billeteras */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px' }}>
        {/* Live Pool (10 Billeteras Titulares) */}
        <div style={{
          background: 'linear-gradient(180deg, rgba(17, 24, 39, 0.7) 0%, rgba(11, 15, 25, 0.9) 100%)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '12px',
          padding: '18px',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981', boxShadow: '0 0 10px #10b981' }} />
              <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#f8fafc' }}>
                LIVE POOL <span style={{ color: '#10b981', fontWeight: 600 }}>({liveWallets.length} Titulares)</span>
              </h3>
            </div>
            <span style={{ fontSize: '11px', color: '#64748b' }}>Filtro: PF &ge; 1.40 | Pérdidas &lt; 3</span>
          </div>

          <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: '#64748b', borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
                <th style={{ textAlign: 'left', padding: '8px 6px', fontWeight: 600 }}>Billetera</th>
                <th style={{ textAlign: 'center', fontWeight: 600 }}>Red</th>
                <th style={{ textAlign: 'right', fontWeight: 600 }}>Profit Factor</th>
                <th style={{ textAlign: 'right', fontWeight: 600 }}>Win Rate</th>
                <th style={{ textAlign: 'center', fontWeight: 600 }}>Pérdidas</th>
              </tr>
            </thead>
            <tbody>
              {liveWallets.slice(0, 10).map((w, i) => (
                <tr key={i} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.03)' }}>
                  <td style={{ padding: '8px 6px', fontFamily: fontMono, fontSize: '12px' }}>
                    <a
                      href={`https://solscan.io/account/${w.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`Ver cuenta en Solscan Mainnet: ${w.address}`}
                      style={{ color: '#38bdf8', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    >
                      <span>{w.address.slice(0, 6)}...{w.address.slice(-4)}</span>
                      <span style={{ fontSize: '10px', opacity: 0.7 }}>↗</span>
                    </a>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <span style={{
                      fontSize: '10px',
                      fontFamily: fontMono,
                      padding: '2px 6px',
                      borderRadius: '4px',
                      background: 'rgba(255, 255, 255, 0.05)',
                      color: '#cbd5e1'
                    }}>{w.chain}</span>
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: fontMono, fontWeight: 700, color: '#34d399' }}>
                    {(w.profitFactorScaled / 1000).toFixed(2)}x
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: fontMono, color: '#e2e8f0' }}>
                    {(w.winRateBps / 100).toFixed(1)}%
                  </td>
                  <td style={{ textAlign: 'center', fontFamily: fontMono, color: w.consecutiveLosses >= 2 ? '#f87171' : '#64748b' }}>
                    {w.consecutiveLosses}/3
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Shadow Pool (40 Billeteras en Evaluación) */}
        <div style={{
          background: 'linear-gradient(180deg, rgba(17, 24, 39, 0.7) 0%, rgba(11, 15, 25, 0.9) 100%)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '12px',
          padding: '18px',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f59e0b', boxShadow: '0 0 10px #f59e0b' }} />
              <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#f8fafc' }}>
                SHADOW POOL <span style={{ color: '#f59e0b', fontWeight: 600 }}>({shadowWallets.length} Simulando L2)</span>
              </h3>
            </div>
            <span style={{ fontSize: '11px', color: '#64748b' }}>Ascenso a LIVE si PF &ge; 1.75</span>
          </div>

          <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
            <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: '#64748b', borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
                  <th style={{ textAlign: 'left', padding: '8px 6px', fontWeight: 600 }}>Billetera</th>
                  <th style={{ textAlign: 'center', fontWeight: 600 }}>Red</th>
                  <th style={{ textAlign: 'right', fontWeight: 600 }}>Profit Factor</th>
                  <th style={{ textAlign: 'right', fontWeight: 600 }}>Win Rate</th>
                  <th style={{ textAlign: 'right', fontWeight: 600 }}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {shadowWallets.slice(0, 10).map((w, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.03)' }}>
                    <td style={{ padding: '8px 6px', fontFamily: fontMono, fontSize: '12px' }}>
                      <a
                        href={`https://solscan.io/account/${w.address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`Ver cuenta en Solscan Mainnet: ${w.address}`}
                        style={{ color: '#94a3b8', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                      >
                        <span>{w.address.slice(0, 6)}...{w.address.slice(-4)}</span>
                        <span style={{ fontSize: '10px', opacity: 0.6 }}>↗</span>
                      </a>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span style={{
                        fontSize: '10px',
                        fontFamily: fontMono,
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: 'rgba(255, 255, 255, 0.05)',
                        color: '#cbd5e1'
                      }}>{w.chain}</span>
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: fontMono, color: '#e2e8f0' }}>
                      {(w.profitFactorScaled / 1000).toFixed(2)}x
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: fontMono, color: '#94a3b8' }}>
                      {(w.winRateBps / 100).toFixed(1)}%
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {w.profitFactorScaled >= 1750 ? (
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          padding: '3px 8px',
                          borderRadius: '6px',
                          fontSize: '10px',
                          fontWeight: 700,
                          background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.25) 0%, rgba(217, 119, 6, 0.15) 100%)',
                          color: '#fbbf24',
                          border: '1px solid rgba(245, 158, 11, 0.4)',
                          boxShadow: '0 0 8px rgba(245, 158, 11, 0.2)'
                        }}>
                          <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#fbbf24', boxShadow: '0 0 6px #fbbf24' }} />
                          LISTA PARA ASCENSO
                        </span>
                      ) : (
                        <span style={{ fontSize: '11px', color: '#64748b' }}>SIMULANDO</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Monitor de Clusters On-Chain con los 5 Semáforos */}
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
              RADAR DE CONFLUENCIA ON-CHAIN Y LOS 5 SEMÁFOROS DEL FIREWALL (&lt; 150ms)
            </h3>
            <div style={{ fontSize: '11px', color: '#64748b' }}>
              Validación pre-trade atómica bajo política Default Deny
            </div>
          </div>
        </div>

        <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ color: '#64748b', borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
              <th style={{ textAlign: 'left', padding: '10px 8px', fontWeight: 600 }}>Activo / Ticker</th>
              <th style={{ textAlign: 'center', fontWeight: 600 }}>Confluencia</th>
              <th style={{ textAlign: 'center', fontWeight: 600 }}>Estado Máquina</th>
              <th style={{ textAlign: 'center', fontWeight: 600 }}>ΔP vs Base</th>
              <th style={{ textAlign: 'center', fontWeight: 600 }}>1. Anti-Sybil</th>
              <th style={{ textAlign: 'center', fontWeight: 600 }}>2. LP &ge; 40x</th>
              <th style={{ textAlign: 'center', fontWeight: 600 }}>3. Mint/Freeze</th>
              <th style={{ textAlign: 'center', fontWeight: 600 }}>4. Top 10 &le; 22%</th>
              <th style={{ textAlign: 'center', fontWeight: 600 }}>5. Anti-Honeypot</th>
              <th style={{ textAlign: 'right', fontWeight: 600 }}>Latencia RPC</th>
            </tr>
          </thead>
          <tbody>
            {clusters.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', padding: '24px', color: '#64748b', fontFamily: fontMono, fontSize: '12px' }}>
                  📡 Escaneando mempool y bloques de Solana Mainnet en espera de confluencia on-chain...
                </td>
              </tr>
            ) : (
              clusters.map((c, i) => (
                <tr key={i} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.03)' }}>
                  <td style={{ padding: '10px 8px' }}>
                    <div style={{ fontWeight: 800, fontSize: '13px', color: '#f8fafc' }}>{c.tokenTicker}</div>
                    <div style={{ fontFamily: fontMono, fontSize: '10px', color: '#64748b' }}>
                      {c.tokenAddress.slice(0, 8)}...{c.tokenAddress.slice(-6)}
                    </div>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <span style={{
                      fontFamily: fontMono,
                      fontWeight: 800,
                      fontSize: '12px',
                      padding: '3px 8px',
                      borderRadius: '6px',
                      background: c.confluenceStage === '3/3' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                      color: c.confluenceStage === '3/3' ? '#34d399' : '#fbbf24',
                      border: `1px solid ${c.confluenceStage === '3/3' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`
                    }}>
                      {c.confluenceStage}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <code style={{
                      fontFamily: fontMono,
                      fontSize: '11px',
                      color: '#93c5fd',
                      background: 'rgba(59, 130, 246, 0.1)',
                      padding: '2px 6px',
                      borderRadius: '4px'
                    }}>{c.status}</code>
                  </td>
                  <td style={{
                    textAlign: 'center',
                    fontFamily: fontMono,
                    fontWeight: 700,
                    color: c.priceDeltaBps >= 0 ? '#38bdf8' : '#f87171'
                  }}>
                    {c.priceDeltaBps >= 0 ? '+' : ''}{c.priceDeltaBps} bps
                  </td>
                  <td style={{ textAlign: 'center' }}>{renderLedBadge(c.firewall.antiSybilPassed)}</td>
                  <td style={{ textAlign: 'center' }}>{renderLedBadge(c.firewall.liquidityDepthPassed)}</td>
                  <td style={{ textAlign: 'center' }}>{renderLedBadge(c.firewall.mintFreezeNull)}</td>
                  <td style={{ textAlign: 'center' }}>{renderLedBadge(c.firewall.top10HoldersPassed)}</td>
                  <td style={{ textAlign: 'center' }}>{renderLedBadge(c.firewall.antiHoneypotPassed)}</td>
                  <td style={{ textAlign: 'right', fontFamily: fontMono, fontWeight: 700, color: c.firewall.latencyMs < 150 ? '#34d399' : '#f87171' }}>
                    {c.firewall.latencyMs} ms
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Tabla de Posiciones DEX y Moonbag */}
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
              POSICIONES DEX Y GESTIÓN DE MOONBAG (DE-RISK +35% & TRAILING STOP 15%)
            </h3>
            <div style={{ fontSize: '11px', color: '#64748b' }}>
              Recuperación del 100% de capital inicial en +35% y protección de salida ante venta de ballena &ge; 30%
            </div>
          </div>
        </div>

        <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ color: '#64748b', borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
              <th style={{ textAlign: 'left', padding: '10px 8px', fontWeight: 600 }}>ID Posición</th>
              <th style={{ textAlign: 'left', fontWeight: 600 }}>Activo</th>
              <th style={{ textAlign: 'right', fontWeight: 600 }}>Entrada</th>
              <th style={{ textAlign: 'right', fontWeight: 600 }}>Actual</th>
              <th style={{ textAlign: 'right', fontWeight: 600 }}>PnL</th>
              <th style={{ textAlign: 'center', fontWeight: 600 }}>De-Risk (75%)</th>
              <th style={{ textAlign: 'center', fontWeight: 600 }}>Moonbag (25%)</th>
              <th style={{ textAlign: 'right', fontWeight: 600 }}>Tokens Remanentes</th>
            </tr>
          </thead>
          <tbody>
            {positions.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: '24px', color: '#64748b', fontFamily: fontMono, fontSize: '12px' }}>
                  🛡️ Sin posiciones DEX abiertas en este momento. Monitoreando señales con RiskGuardian...
                </td>
              </tr>
            ) : (
              positions.map((p, i) => (
                <tr key={i} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.03)' }}>
                  <td style={{ padding: '10px 8px', fontFamily: fontMono, color: '#94a3b8' }}>
                    {p.positionId}
                  </td>
                  <td style={{ fontWeight: 800, color: '#f8fafc', fontSize: '13px' }}>{p.tokenTicker}</td>
                  <td style={{ textAlign: 'right', fontFamily: fontMono, color: '#cbd5e1' }}>${p.entryPriceUsd}</td>
                  <td style={{ textAlign: 'right', fontFamily: fontMono, fontWeight: 700, color: '#f8fafc' }}>${p.currentPriceUsd}</td>
                  <td style={{ textAlign: 'right', fontFamily: fontMono, fontWeight: 800, color: p.pnlBps >= 0 ? '#34d399' : '#f87171', fontSize: '13px' }}>
                    {p.pnlBps >= 0 ? '+' : ''}{(p.pnlBps / 100).toFixed(2)}%
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
                      background: p.deRiskStatus === 'DERISKED_75PCT' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(100, 116, 139, 0.15)',
                      color: p.deRiskStatus === 'DERISKED_75PCT' ? '#34d399' : '#94a3b8',
                      border: `1px solid ${p.deRiskStatus === 'DERISKED_75PCT' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(100, 116, 139, 0.3)'}`
                    }}>
                      {p.deRiskStatus === 'DERISKED_75PCT' ? '✓ EJECUTADO' : 'PENDIENTE'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <span style={{
                      padding: '3px 8px',
                      borderRadius: '6px',
                      fontSize: '11px',
                      fontWeight: 600,
                      fontFamily: fontMono,
                      background: p.moonbagStatus === 'ACTIVE_TRAILING_15PCT'
                        ? 'rgba(56, 189, 248, 0.12)'
                        : p.moonbagStatus === 'FRONTRUN_EXIT_TRIGGERED'
                          ? 'rgba(239, 68, 68, 0.15)'
                          : 'rgba(100, 116, 139, 0.12)',
                      color: p.moonbagStatus === 'ACTIVE_TRAILING_15PCT'
                        ? '#38bdf8'
                        : p.moonbagStatus === 'FRONTRUN_EXIT_TRIGGERED'
                          ? '#f87171'
                          : '#64748b',
                      border: `1px solid ${
                        p.moonbagStatus === 'ACTIVE_TRAILING_15PCT'
                          ? 'rgba(56, 189, 248, 0.25)'
                          : p.moonbagStatus === 'FRONTRUN_EXIT_TRIGGERED'
                            ? 'rgba(239, 68, 68, 0.3)'
                            : 'rgba(100, 116, 139, 0.2)'
                      }`
                    }}>
                      {p.moonbagStatus === 'ACTIVE_TRAILING_15PCT'
                        ? 'TRAILING -15%'
                        : p.moonbagStatus === 'FRONTRUN_EXIT_TRIGGERED'
                          ? '⚡ FRONTRUN EXIT'
                          : 'INACTIVO'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: fontMono, color: '#f8fafc' }}>{p.remainingTokens}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
