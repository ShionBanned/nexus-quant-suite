import React from 'react';

/**
 * Formatea micro-USD (1 USD = 1,000,000 micro-USD) usando BigInt sin pérdida de precisión.
 */
export function formatMicroUsd(microUsdStr: string, showSign: boolean = false): string {
  try {
    const raw = BigInt(microUsdStr);
    const isNegative = raw < 0n;
    const absVal = isNegative ? -raw : raw;
    const wholeUsd = absVal / 1_000_000n;
    const cents = (absVal % 1_000_000n) / 10_000n;

    const formattedWhole = wholeUsd.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const formattedCents = cents.toString().padStart(2, '0');
    const signPrefix = isNegative ? '-' : showSign && raw > 0n ? '+' : '';

    return `${signPrefix}$${formattedWhole}.${formattedCents}`;
  } catch {
    return '$0.00';
  }
}

/**
 * Formatea puntos base (100 bps = 1.00%) a porcentaje legible.
 */
export function formatBpsPct(bpsStr: string, showSign: boolean = false): string {
  try {
    const raw = BigInt(bpsStr);
    const isNegative = raw < 0n;
    const absVal = isNegative ? -raw : raw;
    const wholePct = absVal / 100n;
    const fracPct = absVal % 100n;
    const signPrefix = isNegative ? '-' : showSign && raw > 0n ? '+' : '';
    return `${signPrefix}${wholePct.toString()}.${fracPct.toString().padStart(2, '0')}%`;
  } catch {
    return '0.00%';
  }
}

export interface GlobalRiskBarProps {
  executionMode: 'SHADOW' | 'LIVE';
  openExposureMicro: bigint;
  baseCapitalMicro: bigint;
  maxExposureBps: bigint; // 3000 bps = 30.0%
  rolling24hPnlMicro: bigint;
  circuitBreakerBps: bigint; // -400 bps = -4.0%
  circuitBreakerActive: boolean;
  totalColdWalletSweptMicro: bigint;
  coldWalletAddress: string;
  currentRegime?: 'REGIME_TRENDING' | 'REGIME_VOLATILE_PANIC' | 'REGIME_CHOPPY_RANGE';
  kaufmanErBps?: bigint;
  carryAllocationTargetBps?: bigint;
  solanaTelemetry?: {
    isConnected: boolean;
    currentSlot: number;
    rpcLatencyMs: number;
    liveSwapsProcessed: number;
  };
  onToggleExecutionMode?: (mode: 'SHADOW' | 'LIVE') => void;
  onTriggerKillSwitch?: () => void;
  onResetCircuitBreaker?: () => void;
  onResetRegime?: () => void;
}

export const GlobalRiskBar: React.FC<GlobalRiskBarProps> = ({
  executionMode,
  openExposureMicro,
  baseCapitalMicro,
  maxExposureBps,
  rolling24hPnlMicro,
  circuitBreakerBps,
  circuitBreakerActive,
  totalColdWalletSweptMicro,
  coldWalletAddress,
  currentRegime,
  kaufmanErBps,
  carryAllocationTargetBps,
  solanaTelemetry,
  onToggleExecutionMode,
  onTriggerKillSwitch,
  onResetCircuitBreaker,
  onResetRegime
}) => {
  const exposurePctNum = baseCapitalMicro > 0n
    ? Number(openExposureMicro * 10000n / baseCapitalMicro) / 100
    : 0;
  const exposurePct = exposurePctNum.toFixed(2);
  const exposureProgress = Math.min(100, (exposurePctNum / 30) * 100);

  const pnlPctNum = baseCapitalMicro > 0n
    ? Number(rolling24hPnlMicro * 10000n / baseCapitalMicro) / 100
    : 0;
  const pnlPct = (pnlPctNum >= 0 ? '+' : '') + pnlPctNum.toFixed(2);
  const isPnlNegative = rolling24hPnlMicro < 0n;

  // Barra de progreso del Drawdown hacia el límite de -4.0%
  const ddProgress = isPnlNegative ? Math.min(100, (Math.abs(pnlPctNum) / 4.0) * 100) : 0;

  const fontSans = '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const fontMono = '"JetBrains Mono", "Fira Code", monospace';

  return (
    <header style={{
      background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.95) 0%, rgba(9, 13, 20, 0.98) 100%)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
      padding: '12px 28px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'sticky',
      top: 0,
      zIndex: 1000,
      boxShadow: '0 4px 24px rgba(0, 0, 0, 0.5)'
    }}>
      {/* Brand & Selector Maestro */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '8px',
            background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 16px rgba(37, 99, 235, 0.45)',
            border: '1px solid rgba(255, 255, 255, 0.15)'
          }}>
            <span style={{ fontSize: '16px' }}>🛡️</span>
          </div>
          <div>
            <div style={{
              fontFamily: fontSans,
              fontWeight: 800,
              fontSize: '15px',
              letterSpacing: '-0.3px',
              color: '#f8fafc',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              NEXUS <span style={{ color: '#38bdf8', fontWeight: 600 }}>RISK GUARDIAN</span>
              <span style={{
                fontSize: '10px',
                fontFamily: fontMono,
                background: 'rgba(56, 189, 248, 0.12)',
                color: '#38bdf8',
                padding: '2px 6px',
                borderRadius: '4px',
                border: '1px solid rgba(56, 189, 248, 0.25)'
              }}>v2.0</span>
            </div>
            <div style={{ fontFamily: fontSans, fontSize: '11px', color: '#64748b' }}>
              Supervisor Atómico de Preservación de Capital
            </div>
          </div>
        </div>

        {/* Segmented Control SHADOW / LIVE */}
        <div style={{
          display: 'flex',
          background: 'rgba(15, 23, 42, 0.8)',
          padding: '3px',
          borderRadius: '8px',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.5)'
        }}>
          <button
            onClick={() => onToggleExecutionMode && onToggleExecutionMode('SHADOW')}
            style={{
              background: executionMode === 'SHADOW'
                ? 'linear-gradient(180deg, #10b981 0%, #059669 100%)'
                : 'transparent',
              color: executionMode === 'SHADOW' ? '#ffffff' : '#94a3b8',
              border: 'none',
              padding: '6px 14px',
              fontFamily: fontSans,
              fontSize: '12px',
              fontWeight: 600,
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: executionMode === 'SHADOW' ? '0 0 12px rgba(16, 185, 129, 0.4)' : 'none',
              transition: 'all 0.2s ease'
            }}
          >
            <span style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: executionMode === 'SHADOW' ? '#ffffff' : '#475569',
              boxShadow: executionMode === 'SHADOW' ? '0 0 6px #ffffff' : 'none'
            }} />
            SHADOW MODE
          </button>

          <button
            onClick={() => onToggleExecutionMode && onToggleExecutionMode('LIVE')}
            style={{
              background: executionMode === 'LIVE'
                ? 'linear-gradient(180deg, #ef4444 0%, #dc2626 100%)'
                : 'transparent',
              color: executionMode === 'LIVE' ? '#ffffff' : '#94a3b8',
              border: 'none',
              padding: '6px 14px',
              fontFamily: fontSans,
              fontSize: '12px',
              fontWeight: 600,
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: executionMode === 'LIVE' ? '0 0 12px rgba(239, 68, 68, 0.4)' : 'none',
              transition: 'all 0.2s ease'
            }}
          >
            <span style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: executionMode === 'LIVE' ? '#ffffff' : '#475569',
              boxShadow: executionMode === 'LIVE' ? '0 0 6px #ffffff' : 'none'
            }} />
            LIVE MODE
          </button>
        </div>

        {/* Telemetría en Vivo de Solana Mainnet RPC */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: 'rgba(15, 23, 42, 0.85)',
          padding: '5px 12px',
          borderRadius: '8px',
          border: '1px solid rgba(16, 185, 129, 0.25)',
          fontFamily: fontMono,
          fontSize: '11px'
        }}>
          <span style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: solanaTelemetry?.isConnected ? '#10b981' : '#f59e0b',
            boxShadow: solanaTelemetry?.isConnected ? '0 0 8px #10b981' : 'none'
          }} />
          <span style={{ color: '#34d399', fontWeight: 800 }}>SOLANA MAINNET</span>
          <span style={{ color: '#475569' }}>|</span>
          <span style={{ color: '#94a3b8' }}>Slot:</span>
          <span style={{ color: '#f8fafc', fontWeight: 700 }}>{solanaTelemetry?.currentSlot ? solanaTelemetry.currentSlot.toLocaleString() : 'Conectando...'}</span>
          <span style={{ color: '#475569' }}>|</span>
          <span style={{ color: '#94a3b8' }}>Ping:</span>
          <span style={{ color: '#38bdf8', fontWeight: 700 }}>{solanaTelemetry?.rpcLatencyMs ? `${solanaTelemetry.rpcLatencyMs}ms` : '--'}</span>
          <span style={{ color: '#475569' }}>|</span>
          <span style={{ color: '#a7f3d0' }}>{solanaTelemetry?.liveSwapsProcessed || 0} Swaps</span>
        </div>
      </div>

      {/* Indicadores de Riesgo Institucional con Barras de Progreso (Centro Limpio e Invariable) */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '28px',
        flex: '1 1 auto'
      }}>
        {/* Medidor de Exposición Abierta */}
        <div style={{ width: '150px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
            <span style={{ fontFamily: fontSans, fontSize: '11px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
              Exposición
            </span>
            <span style={{ fontFamily: fontMono, fontSize: '13px', fontWeight: 700, color: exposurePctNum > 25 ? '#f87171' : '#38bdf8' }}>
              {exposurePct}% <span style={{ color: '#475569', fontWeight: 400, fontSize: '11px' }}>/ 30%</span>
            </span>
          </div>
          <div style={{ width: '100%', height: '5px', background: 'rgba(255, 255, 255, 0.08)', borderRadius: '999px', overflow: 'hidden' }}>
            <div style={{
              width: `${exposureProgress}%`,
              height: '100%',
              background: exposurePctNum > 25 ? 'linear-gradient(90deg, #f59e0b, #ef4444)' : 'linear-gradient(90deg, #38bdf8, #2563eb)',
              borderRadius: '999px',
              transition: 'width 0.4s ease'
            }} />
          </div>
        </div>

        {/* Termómetro Dinámico de PnL / Drawdown Móvil 24h */}
        <div style={{ width: '150px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
            <span style={{
              fontFamily: fontSans,
              fontSize: '11px',
              fontWeight: 600,
              color: isPnlNegative ? '#f87171' : '#34d399',
              textTransform: 'uppercase',
              letterSpacing: '0.4px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}>
              <span style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: isPnlNegative ? '#ef4444' : '#10b981',
                boxShadow: isPnlNegative ? '0 0 6px #ef4444' : '0 0 6px #10b981'
              }} />
              {isPnlNegative ? 'Drawdown 24h' : 'PnL 24h'}
            </span>
            <span style={{ fontFamily: fontMono, fontSize: '13px', fontWeight: 700, color: isPnlNegative ? '#f87171' : '#34d399' }}>
              {pnlPct}%
            </span>
          </div>
          <div style={{ width: '100%', height: '5px', background: 'rgba(255, 255, 255, 0.08)', borderRadius: '999px', overflow: 'hidden' }}>
            <div style={{
              width: `${isPnlNegative ? ddProgress : Math.min(100, Math.max(10, (pnlPctNum / 1.5) * 100))}%`,
              height: '100%',
              background: isPnlNegative ? 'linear-gradient(90deg, #f59e0b, #dc2626)' : 'linear-gradient(90deg, #10b981, #059669)',
              borderRadius: '999px',
              transition: 'width 0.4s ease'
            }} />
          </div>
        </div>

        {/* Badge Dinámico de Régimen de Mercado Aether */}
        {(() => {
          const reg = currentRegime || 'REGIME_TRENDING';
          const carryPct = formatBpsPct((carryAllocationTargetBps ?? 7000n).toString());
          let label = '🟢 TENDENCIA ACTIVA: SENTINEL 100%';
          let subLabel = `CATALYST 100% · CARRY BASE ${carryPct}`;
          let borderCol = 'rgba(16, 185, 129, 0.45)';
          let bgCol = 'rgba(16, 185, 129, 0.12)';
          let textCol = '#34d399';
          let dotCol = '#10b981';

          if (reg === 'REGIME_VOLATILE_PANIC') {
            label = '🟡 PÁNICO: CATALYST 100% / SENTINEL 20%';
            subLabel = `ESCUDO VOLATILIDAD · CARRY ${carryPct}`;
            borderCol = 'rgba(245, 158, 11, 0.55)';
            bgCol = 'rgba(245, 158, 11, 0.14)';
            textCol = '#fbbf24';
            dotCol = '#f59e0b';
          } else if (reg === 'REGIME_CHOPPY_RANGE') {
            label = '🟠 RANGO LATERAL: SENTINEL EN PAUSA';
            subLabel = `CERO SANGRADO · CARRY ${carryPct}`;
            borderCol = 'rgba(249, 115, 22, 0.55)';
            bgCol = 'rgba(249, 115, 22, 0.14)';
            textCol = '#fb923c';
            dotCol = '#f97316';
          }

          return (
            <div
              data-testid="aether-regime-badge"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '6px 14px',
                borderRadius: '8px',
                border: `1px solid ${borderCol}`,
                background: bgCol,
                boxShadow: '0 2px 10px rgba(0, 0, 0, 0.25)',
                whiteSpace: 'nowrap'
              }}
            >
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: dotCol,
                  boxShadow: `0 0 8px ${dotCol}`,
                }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 800,
                    letterSpacing: '0.03em',
                    color: textCol,
                    fontFamily: fontSans
                  }}
                >
                  {label}
                </span>
                <span style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 500, fontFamily: fontSans }}>
                  {subLabel} {kaufmanErBps !== undefined ? `· ER: ${formatBpsPct(kaufmanErBps.toString())}` : ''}
                </span>
              </div>
              {onResetRegime && reg !== 'REGIME_TRENDING' && (
                <button
                  onClick={onResetRegime}
                  title="Restablecer Régimen Aether a TENDENCIA ACTIVA"
                  style={{
                    marginLeft: '6px',
                    padding: '3px 8px',
                    fontSize: '10px',
                    fontWeight: 700,
                    borderRadius: '4px',
                    border: '1px solid rgba(245, 158, 11, 0.6)',
                    background: 'rgba(245, 158, 11, 0.25)',
                    color: '#fbbf24',
                    cursor: 'pointer',
                    fontFamily: fontSans,
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(245, 158, 11, 0.4)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(245, 158, 11, 0.25)'; }}
                >
                  ↺ RESTABLECER
                </button>
              )}
            </div>
          );
        })()}

        {/* Acumulador Bóveda Fría */}
        <div style={{
          background: 'rgba(56, 189, 248, 0.05)',
          padding: '5px 12px',
          borderRadius: '8px',
          border: '1px solid rgba(56, 189, 248, 0.15)'
        }}>
          <div style={{ fontFamily: fontSans, fontSize: '10px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.3px', fontWeight: 600 }}>
            Cold Wallet (+25% HWM)
          </div>
          <div style={{ fontFamily: fontMono, fontSize: '13px', fontWeight: 700, color: '#38bdf8' }}>
            ${(Number(totalColdWalletSweptMicro) / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 2 })} <span style={{ fontSize: '10px', color: '#64748b' }}>USD</span>
          </div>
        </div>
      </div>

      {/* Controles de Acción y Emergencia (Extremo Derecho Unificado) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: '0 0 auto' }}>
        {/* Badge Circuit Breaker */}
        {circuitBreakerActive && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            padding: '6px 12px',
            borderRadius: '6px',
            color: '#f87171',
            fontFamily: fontSans,
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '0.5px',
            whiteSpace: 'nowrap'
          }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444', boxShadow: '0 0 10px #ef4444' }} />
            CIRCUIT BREAKER ACTIVO
          </div>
        )}

        {/* Botón de Reset Circuit Breaker */}
        {circuitBreakerActive && onResetCircuitBreaker && (
          <button
            onClick={onResetCircuitBreaker}
            title="Desactivar Circuit Breaker y Reanudar Operaciones"
            style={{
              background: 'linear-gradient(135deg, #d97706 0%, #b45309 100%)',
              color: '#ffffff',
              border: '1px solid rgba(245, 158, 11, 0.5)',
              padding: '7px 14px',
              borderRadius: '7px',
              fontFamily: fontSans,
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.4px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              whiteSpace: 'nowrap',
              boxShadow: '0 0 12px rgba(217, 119, 6, 0.4)',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)';
              e.currentTarget.style.boxShadow = '0 0 18px rgba(245, 158, 11, 0.7)';
              e.currentTarget.style.transform = 'scale(1.02)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'linear-gradient(135deg, #d97706 0%, #b45309 100%)';
              e.currentTarget.style.boxShadow = '0 0 12px rgba(217, 119, 6, 0.4)';
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            <span>🔓</span> RESET CIRCUIT BREAKER
          </button>
        )}

        {/* Botón Pánico Crítico KILL-SWITCH */}
        <button
          onClick={() => onTriggerKillSwitch && onTriggerKillSwitch()}
          style={{
            background: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)',
            color: '#ffffff',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            padding: '7px 18px',
            fontFamily: fontSans,
            fontSize: '11px',
            fontWeight: 800,
            letterSpacing: '0.6px',
            borderRadius: '7px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            whiteSpace: 'nowrap',
            boxShadow: '0 0 20px rgba(239, 68, 68, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.3)',
            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.03)';
            e.currentTarget.style.boxShadow = '0 0 28px rgba(239, 68, 68, 0.75), inset 0 1px 1px rgba(255, 255, 255, 0.4)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.boxShadow = '0 0 20px rgba(239, 68, 68, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.3)';
          }}
        >
          <span style={{ fontSize: '12px' }}>🚨</span> KILL-SWITCH
        </button>
      </div>
    </header>
  );
};
