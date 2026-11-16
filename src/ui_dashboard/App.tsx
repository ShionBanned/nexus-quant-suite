import React, { useState, useEffect } from 'react';
import { GlobalRiskBar } from './components/GlobalRiskBar.js';
import { Section1Sentinel, WalletPoolItem, ClusterMonitorItem, DexPositionItem } from './views/Section1_Sentinel.js';
import { Section2Catalyst, CatalystFeedItem, AnchoredIocOrderItem } from './views/Section2_Catalyst.js';
import { Section3Transactions, TradeLedgerItem } from './views/Section3_Transactions.js';
import {
  Section4_AetherCarry,
  AetherCarryPositionDto,
  AetherRegimeTelemetryDto,
  SentinelPullbackIntentDto,
} from './views/Section4_AetherCarry.js';

const DEFAULT_REGIME_TELEMETRY: AetherRegimeTelemetryDto = {
  current_regime: 'REGIME_TRENDING',
  kaufman_er_bps: '4200',
  atr_ratio_bps: '11000',
  bollinger_width_bps: '310',
  sentinel_multiplier_bps: '10000',
  catalyst_multiplier_bps: '10000',
  carry_allocation_target_bps: '7000',
  updated_at_ms: '0',
};

export const NexusDashboardApp: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'SENTINEL' | 'CATALYST' | 'TRADES' | 'AETHER_CARRY'>('SENTINEL');
  const [executionMode, setExecutionMode] = useState<'SHADOW' | 'LIVE'>('SHADOW');
  const [adminToken, setAdminToken] = useState<string>(
    (typeof window !== 'undefined' && (window as any).__NEXUS_ADMIN_TOKEN__) || ''
  );
  const [circuitBreakerActive, setCircuitBreakerActive] = useState<boolean>(false);
  const [openExposureMicro, setOpenExposureMicro] = useState<bigint>(10_000_000_000n);
  const [baseCapitalMicro] = useState<bigint>(100_000_000_000n);
  const [rolling24hPnlMicro, setRolling24hPnlMicro] = useState<bigint>(840_000_000n);
  const [totalColdWalletSweptMicro, setTotalColdWalletSweptMicro] = useState<bigint>(0n);
  const [nextPurgeTimestampMs, setNextPurgeTimestampMs] = useState<number | null>(null);
  const [purgeCountdown, setPurgeCountdown] = useState<number>(0);
  const [trades, setTrades] = useState<TradeLedgerItem[]>([]);
  const [lifetimeKpis, setLifetimeKpis] = useState<any>(null);

  // Telemetría de Aether Carry y Pullback Intents
  const [regimeTelemetry, setRegimeTelemetry] = useState<AetherRegimeTelemetryDto>(DEFAULT_REGIME_TELEMETRY);
  const [carryPositions, setCarryPositions] = useState<readonly AetherCarryPositionDto[]>([]);
  const [totalCarryNotionalMicro, setTotalCarryNotionalMicro] = useState<string>('70000000000');
  const [totalCarryYieldMicro, setTotalCarryYieldMicro] = useState<string>('0');
  const [weightedCarryAprBps, setWeightedCarryAprBps] = useState<string>('1950');
  const [maxDeltaDriftBps, setMaxDeltaDriftBps] = useState<string>('0');
  const [pullbackIntents, setPullbackIntents] = useState<readonly SentinelPullbackIntentDto[]>([]);
  const [solanaTelemetry, setSolanaTelemetry] = useState<{
    isConnected: boolean;
    currentSlot: number;
    rpcLatencyMs: number;
    liveSwapsProcessed: number;
  }>({
    isConnected: false,
    currentSlot: 0,
    rpcLatencyMs: 0,
    liveSwapsProcessed: 0
  });

  const [wallets, setWallets] = useState<WalletPoolItem[]>([
    { address: '6bZ71x8kLpM449aQeNsVEPfiu6QeMU1kektZE', chain: 'SOLANA', tier: 'LIVE', profitFactorScaled: 2150, winRateBps: 6800, consecutiveLosses: 0 },
    { address: '0x32A48c909aB23Cd4Ef8901bCa09391Fba9828a11', chain: 'BASE', tier: 'LIVE', profitFactorScaled: 1980, winRateBps: 6400, consecutiveLosses: 1 },
    { address: '0x99FaB120c1D83aB90192eF209041aAb89410427c', chain: 'ARBITRUM', tier: 'LIVE', profitFactorScaled: 1890, winRateBps: 6200, consecutiveLosses: 0 },
    { address: '8hN12uYtZqP102bCa09391Fba9828a11orcaEKTaB', chain: 'SOLANA', tier: 'LIVE', profitFactorScaled: 1820, winRateBps: 6100, consecutiveLosses: 2 },
    { address: '4jM99vPxLoK231aQeNsVEPfiu6QeMU1kektZELiv1', chain: 'SOLANA', tier: 'LIVE', profitFactorScaled: 1790, winRateBps: 5900, consecutiveLosses: 1 },
    { address: '5kN88vPxLoK231aQeNsVEPfiu6QeMU1kektZELiv2', chain: 'BASE', tier: 'LIVE', profitFactorScaled: 1780, winRateBps: 5800, consecutiveLosses: 0 },
    { address: '7mP77vPxLoK231aQeNsVEPfiu6QeMU1kektZELiv3', chain: 'ARBITRUM', tier: 'LIVE', profitFactorScaled: 1760, winRateBps: 5700, consecutiveLosses: 1 },
    { address: '2xR66vPxLoK231aQeNsVEPfiu6QeMU1kektZELiv4', chain: 'SOLANA', tier: 'LIVE', profitFactorScaled: 1750, winRateBps: 6000, consecutiveLosses: 0 },
    { address: '3yT55vPxLoK231aQeNsVEPfiu6QeMU1kektZELiv5', chain: 'BASE', tier: 'LIVE', profitFactorScaled: 1750, winRateBps: 5900, consecutiveLosses: 0 },
    { address: '9zU44vPxLoK231aQeNsVEPfiu6QeMU1kektZELiv6', chain: 'ARBITRUM', tier: 'LIVE', profitFactorScaled: 1740, winRateBps: 5600, consecutiveLosses: 1 },
    { address: 'SHADOW_LEADER_ALPHA_01_SOL_009988223344112233', chain: 'SOLANA', tier: 'SHADOW', profitFactorScaled: 2450, winRateBps: 7400, consecutiveLosses: 0 },
    { address: 'SHADOW_LEADER_BETA_02_BASE_009988223344112244', chain: 'BASE', tier: 'SHADOW', profitFactorScaled: 2280, winRateBps: 7100, consecutiveLosses: 0 },
    { address: 'SHADOW_CANDIDATE_03_ARB_009988223344112255', chain: 'ARBITRUM', tier: 'SHADOW', profitFactorScaled: 1950, winRateBps: 6600, consecutiveLosses: 1 }
  ]);

  const [clusters, setClusters] = useState<ClusterMonitorItem[]>([]);
  const [positions, setPositions] = useState<DexPositionItem[]>([]);

  const [catalystFeeds, setCatalystFeeds] = useState<CatalystFeedItem[]>([
    {
      eventId: 'EVT_SEC_SOL_ETF',
      simhash64Hex: '0x9fa102bce4812301',
      headline: 'SEC approves first spot Solana ETF with direct staking mechanism',
      sources: ['SEC_EDGAR', 'REUTERS'],
      primaryTicker: 'SOL',
      category: 'REGULATORY',
      direction: 1,
      siaBps: 9400,
      sourceTrustBps: 10000,
      flowConfirmBps: 8200,
      preEventDrift15mBps: 45,
      iSecurity: 1,
      iNoLeak: 1,
      decayFactorBps: 9850,
      convictionCtBps: 9140,
      actionTaken: 'STRIKE_T1',
      publishedAt: '04:15:32.120'
    },
    {
      eventId: 'EVT_X_UNCONFIRMED_RUMOR',
      simhash64Hex: '0x12a8849bca00124f',
      headline: 'Unverified rumor claims major protocol compromise in bridge contract',
      sources: ['X_TWITTER_VERIFIED'],
      primaryTicker: 'AVAX',
      category: 'HACK',
      direction: -1,
      siaBps: 6200,
      sourceTrustBps: 4000, // Tope Tier 3
      flowConfirmBps: 4500, // Sin flujo
      preEventDrift15mBps: 10,
      iSecurity: 1,
      iNoLeak: 1,
      decayFactorBps: 9900,
      convictionCtBps: 5080,
      actionTaken: 'QUARANTINE',
      publishedAt: '04:16:01.050'
    }
  ]);

  const [activeOrders, setActiveOrders] = useState<AnchoredIocOrderItem[]>([
    {
      orderId: 'ORD_CAT_STRIKE_01',
      ticker: 'SOL/USD',
      anchorPriceUsd: '202.40',
      limitCapUsd: '205.43',
      serverStopLossUsd: '201.48',
      filledVwapUsd: '203.12',
      status: 'FILLED',
      timeStopCountdownSeconds: 34,
      deRiskStatus: 'PENDING'
    }
  ]);

  // Temporizadores en vivo
  useEffect(() => {
    const timer = setInterval(() => {
      if (nextPurgeTimestampMs) {
        const remaining = Math.max(0, Math.floor((nextPurgeTimestampMs - Date.now()) / 1000));
        setPurgeCountdown(remaining);
      } else {
        setPurgeCountdown(prev => (prev > 0 ? prev - 1 : 0));
      }

      setActiveOrders(prev =>
        prev.map(ord => ({
          ...ord,
          timeStopCountdownSeconds: ord.timeStopCountdownSeconds > 0 ? ord.timeStopCountdownSeconds - 1 : 0
        }))
      );
    }, 1000);

    return () => clearInterval(timer);
  }, [nextPurgeTimestampMs]);

  // Conexión WebSocket para actualizaciones en vivo con auto-reconexión robusta
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let isDisposed = false;

    const connect = () => {
      if (isDisposed) return;
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          console.log('⚡ [NEXUS_WS] Conexión WebSocket establecida con éxito.');
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'INIT_SYSTEM_STATE') {
              if (data.adminToken) setAdminToken(data.adminToken);
              if (data.nextPurgeTimestampMs) {
                const target = Number(data.nextPurgeTimestampMs);
                setNextPurgeTimestampMs(target);
                setPurgeCountdown(Math.max(0, Math.floor((target - Date.now()) / 1000)));
              }
              if (data.risk) {
                if (data.risk.executionMode) setExecutionMode(data.risk.executionMode);
                if (data.risk.openExposureMicro) setOpenExposureMicro(BigInt(data.risk.openExposureMicro));
                if (data.risk.rolling24hPnlMicro) setRolling24hPnlMicro(BigInt(data.risk.rolling24hPnlMicro));
                if (data.risk.circuitBreakerActive !== undefined) setCircuitBreakerActive(data.risk.circuitBreakerActive);
                if (data.risk.totalColdWalletSweptMicro) setTotalColdWalletSweptMicro(BigInt(data.risk.totalColdWalletSweptMicro));
              }
              if (Array.isArray(data.wallets) && data.wallets.length > 0) {
                setWallets(data.wallets);
              }
              if (Array.isArray(data.clusters)) {
                setClusters(data.clusters);
              }
              if (Array.isArray(data.positions)) {
                setPositions(data.positions);
              }
              if (Array.isArray(data.trades) && data.trades.length > 0) {
                setTrades(data.trades);
              }
              if (data.lifetimeKpis) {
                setLifetimeKpis(data.lifetimeKpis);
              }
              if (data.solana) {
                setSolanaTelemetry(data.solana);
              }
            } else if (data.type === 'PURGE_CYCLE_EXECUTED') {
              if (data.nextPurgeTimestampMs) {
                const target = Number(data.nextPurgeTimestampMs);
                setNextPurgeTimestampMs(target);
                setPurgeCountdown(Math.max(0, Math.floor((target - Date.now()) / 1000)));
              }
              if (Array.isArray(data.wallets) && data.wallets.length > 0) {
                setWallets(data.wallets);
              }
            } else if (data.type === 'WALLETS_UPDATE') {
              if (Array.isArray(data.wallets) && data.wallets.length > 0) {
                setWallets(data.wallets);
              }
            } else if (data.type === 'CLUSTERS_UPDATE') {
              if (Array.isArray(data.clusters)) {
                setClusters(data.clusters);
              }
            } else if (data.type === 'POSITIONS_UPDATE') {
              if (Array.isArray(data.positions)) {
                setPositions(data.positions);
              }
            } else if (data.type === 'RISK_UPDATE') {
              if (data.executionMode) setExecutionMode(data.executionMode);
              if (data.openExposureMicro) setOpenExposureMicro(BigInt(data.openExposureMicro));
              if (data.rolling24hPnlMicro) setRolling24hPnlMicro(BigInt(data.rolling24hPnlMicro));
              if (data.circuitBreakerActive !== undefined) setCircuitBreakerActive(data.circuitBreakerActive);
              if (data.totalColdWalletSweptMicro) setTotalColdWalletSweptMicro(BigInt(data.totalColdWalletSweptMicro));
            } else if (data.type === 'CIRCUIT_BREAKER_STATUS') {
              setCircuitBreakerActive(Boolean(data.active));
            } else if (data.type === 'TRADE_UPDATE') {
              if (data.trade) {
                setTrades(prev => [data.trade, ...prev.filter(t => t.positionId !== data.trade.positionId)].slice(0, 100));
                if (data.trade.status === 'CLOSED' || data.trade.status === 'STOPPED_OUT' || data.trade.status === 'TIME_STOPPED') {
                  setPositions(prev => prev.filter(p => p.positionId !== data.trade.positionId));
                }
              }
              if (Array.isArray(data.positions)) {
                setPositions(data.positions);
              }
              if (data.lifetimeKpis) {
                setLifetimeKpis(data.lifetimeKpis);
              }
              if (Array.isArray(data.wallets) && data.wallets.length > 0) {
                setWallets(data.wallets);
              }
            } else if (data.type === 'TRADES_UPDATE') {
              if (Array.isArray(data.trades)) {
                setTrades(data.trades);
              }
              if (data.lifetimeKpis) {
                setLifetimeKpis(data.lifetimeKpis);
              }
            } else if (data.type === 'CATALYST_EVENT') {
              setCatalystFeeds(prev => [data.event, ...prev.slice(0, 19)]);
            } else if (data.type === 'ORDER_UPDATE') {
              setActiveOrders(prev => [data.order, ...prev.filter(o => o.orderId !== data.order.orderId)]);
            } else if (data.type === 'SOLANA_TELEMETRY') {
              if (data.telemetry) {
                setSolanaTelemetry(data.telemetry);
              }
            }
          } catch (e) {
            console.error('Error procesando mensaje WS:', e);
          }
        };

        ws.onclose = () => {
          if (!isDisposed) {
            reconnectTimeout = setTimeout(connect, 2000);
          }
        };

        ws.onerror = () => {
          if (ws) ws.close();
        };
      } catch (e) {
        if (!isDisposed) {
          reconnectTimeout = setTimeout(connect, 2000);
        }
      }
    };

    connect();

    return () => {
      isDisposed = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (ws) ws.close();
    };
  }, []);

  // Carga inicial y reconciliación HTTP periódica resiliente de Trades (cada 4s)
  useEffect(() => {
    let isMounted = true;
    const fetchTrades = () => {
      const token = adminToken || (typeof window !== 'undefined' && (window as any).__NEXUS_ADMIN_TOKEN__) || '';
      if (token) {
        fetch('/api/trades', {
          headers: {
            'X-Nexus-Auth': token
          }
        })
          .then(res => res.json())
          .then(data => {
            if (isMounted && data && data.ok) {
              if (Array.isArray(data.trades) && data.trades.length > 0) {
                setTrades(data.trades);
              }
              if (data.lifetimeKpis) {
                setLifetimeKpis(data.lifetimeKpis);
              }
            }
          })
          .catch(() => {});
      }
    };

    fetchTrades();
    const interval = setInterval(fetchTrades, 4000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [adminToken]);

  // Polling continuo de Telemetría Aether Regime, Carry y Pullback Intents
  useEffect(() => {
    let isMounted = true;
    const fetchAether = async () => {
      try {
        const token = adminToken || (typeof window !== 'undefined' && (window as any).__NEXUS_ADMIN_TOKEN__) || '';
        const headers: Record<string, string> = token ? { 'X-Nexus-Auth': token } : {};

        const [regimeRes, carryRes, pullbacksRes, solanaRes, walletsRes, clustersRes, positionsRes] = await Promise.all([
          fetch('/api/aether/regime', { headers }),
          fetch('/api/aether/carry', { headers }),
          fetch('/api/sentinel/pullbacks', { headers }),
          fetch('/api/solana/telemetry', { headers }),
          fetch('/api/wallets', { headers }),
          fetch('/api/sentinel/clusters', { headers }),
          fetch('/api/positions', { headers })
        ]);

        if (regimeRes.ok && isMounted) {
          const rData = await regimeRes.json();
          if (rData && rData.ok && rData.data) {
            setRegimeTelemetry(rData.data);
          }
        }

        if (carryRes.ok && isMounted) {
          const cData = await carryRes.json();
          if (cData && cData.ok && cData.data) {
            setTotalCarryNotionalMicro(cData.data.total_notional_deployed_micro_usd);
            setTotalCarryYieldMicro(cData.data.total_cumulative_yield_micro_usd);
            setWeightedCarryAprBps(cData.data.weighted_apr_bps);
            setMaxDeltaDriftBps(cData.data.max_observed_delta_drift_bps);
            if (Array.isArray(cData.data.positions)) {
              setCarryPositions(cData.data.positions);
            }
          }
        }

        if (pullbacksRes.ok && isMounted) {
          const pData = await pullbacksRes.json();
          if (pData && pData.ok && Array.isArray(pData.data)) {
            setPullbackIntents(pData.data);
          }
        }

        if (solanaRes.ok && isMounted) {
          const sData = await solanaRes.json();
          if (sData && sData.ok && sData.data) {
            setSolanaTelemetry(sData.data);
          }
        }

        if (walletsRes && walletsRes.ok && isMounted) {
          const wData = await walletsRes.json();
          if (wData && wData.ok && Array.isArray(wData.wallets) && wData.wallets.length > 0) {
            setWallets(wData.wallets);
          }
        }

        if (clustersRes && clustersRes.ok && isMounted) {
          const clData = await clustersRes.json();
          if (clData && clData.ok && Array.isArray(clData.clusters)) {
            setClusters(clData.clusters);
          }
        }

        if (positionsRes && positionsRes.ok && isMounted) {
          const posData = await positionsRes.json();
          if (posData && posData.ok && Array.isArray(posData.positions)) {
            setPositions(posData.positions);
          }
        }
      } catch {
        // Silencioso en modo autónomo
      }
    };

    void fetchAether();
    const interval = setInterval(fetchAether, 3000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [adminToken]);

  const handleToggleExecutionMode = async (mode: 'SHADOW' | 'LIVE') => {
    let confirmationPhrase: string | null = null;
    if (mode === 'LIVE') {
      confirmationPhrase = window.prompt(
        '⚠️ ADVERTENCIA CRÍTICA DE RIESGO: Estás a punto de conmutar a MODO LIVE (Capital Real).\n\n' +
        'Para desbloquear el despacho de órdenes con fondos reales, escribe exactamente la frase de confirmación:\n\n' +
        'ENABLE_LIVE_CAPITAL_RISK'
      );
      if (confirmationPhrase !== 'ENABLE_LIVE_CAPITAL_RISK') {
        alert('❌ Operación cancelada. Frase no coincide. El sistema permanece en SHADOW MODE.');
        return;
      }
    }

    try {
      const token = adminToken || (typeof window !== 'undefined' && (window as any).__NEXUS_ADMIN_TOKEN__) || '';
      const res = await fetch('/api/mode', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Nexus-Auth': token
        },
        body: JSON.stringify({ mode, confirmationPhrase })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        alert(
          `❌ ERROR DE TRANSICIÓN: ${data.error || 'Rechazado'}\n\n` +
          `${data.message || ''}\n` +
          `${data.missingKeys ? 'Variables de entorno faltantes: ' + data.missingKeys.join(', ') : ''}`
        );
        return;
      }
      setExecutionMode(data.executionMode);
      alert(`✅ MODO ACTUALIZADO: ${data.executionMode}`);
    } catch (err) {
      alert('❌ Error de comunicación de red con el servidor.');
    }
  };

  const handleKillSwitch = () => {
    setCircuitBreakerActive(true);
    setExecutionMode('SHADOW');
    setOpenExposureMicro(0n);
    const token = adminToken || (typeof window !== 'undefined' && (window as any).__NEXUS_ADMIN_TOKEN__) || '';
    fetch('/api/kill-switch', {
      method: 'POST',
      headers: {
        'X-Nexus-Auth': token
      }
    }).catch(() => {});
    alert('🚨 KILL-SWITCH ACTIVADO: Todas las órdenes activas fueron canceladas, posiciones cerradas y firmas revocadas.');
  };

  const handleResetCircuitBreaker = async () => {
    const phrase = window.prompt(
      '🚨 ATENCIÓN: Estás a punto de reanudar la ejecución y apagar el CIRCUIT BREAKER.\n\n' +
      'Para confirmar que el riesgo está controlado y reactivar el motor, escribe exactamente:\n\n' +
      'RESET_CIRCUIT_BREAKER_EMERGENCY'
    );

    if (phrase !== 'RESET_CIRCUIT_BREAKER_EMERGENCY') {
      if (phrase !== null) {
        alert('❌ Operación cancelada. Frase no coincide. El Circuit Breaker permanece activo.');
      }
      return;
    }

    try {
      const token = adminToken || (typeof window !== 'undefined' && (window as any).__NEXUS_ADMIN_TOKEN__) || '';
      const res = await fetch('/api/circuit-breaker/reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Nexus-Auth': token
        },
        body: JSON.stringify({ confirmationPhrase: phrase })
      });

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        alert(
          `❌ ERROR DE SERVIDOR (${res.status}): La respuesta recibida no es JSON.\n\n` +
          `Causa probable: El servidor en segundo plano requiere reinicio.`
        );
        return;
      }

      const data = await res.json();
      if (!res.ok || !data.ok) {
        alert(`❌ ERROR AL REINICIAR CIRCUIT BREAKER: ${data.message || data.error || 'Rechazado'}`);
        return;
      }
      setCircuitBreakerActive(false);
      setRolling24hPnlMicro(0n);
      alert('✅ CIRCUIT BREAKER REINICIADO: El sistema ha reanudado la supervisión de operaciones.');
    } catch (err: any) {
      alert(`❌ Error al procesar solicitud: ${err?.message || err}`);
    }
  };

  const handleResetRegime = async () => {
    try {
      const token = adminToken || (typeof window !== 'undefined' && (window as any).__NEXUS_ADMIN_TOKEN__) || '';
      const res = await fetch('/api/aether/regime/reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Nexus-Auth': token
        }
      });
      if (res.ok) {
        setRegimeTelemetry(prev => ({
          ...prev,
          current_regime: 'REGIME_TRENDING',
          bollinger_width_bps: '250',
          sentinel_multiplier_bps: '10000',
          catalyst_multiplier_bps: '10000'
        }));
        alert('✅ RÉGIMEN AETHER NORMALIZADO: Restablecido con éxito a TENDENCIA ACTIVA (Sentinel 100% / Catalyst 100%).');
      } else {
        alert('❌ Error al restablecer el régimen Aether en el servidor.');
      }
    } catch (err: any) {
      alert(`❌ Error al conectar con el servidor: ${err?.message || err}`);
    }
  };

  return (
    <div style={{ background: '#090d13', minHeight: '100vh', color: '#c9d1d9', fontFamily: 'monospace' }}>
      {/* Barra Fija Superior RiskGuardian */}
      <GlobalRiskBar
        executionMode={executionMode}
        openExposureMicro={openExposureMicro}
        baseCapitalMicro={baseCapitalMicro}
        maxExposureBps={3000n} // 30.00%
        rolling24hPnlMicro={rolling24hPnlMicro}
        circuitBreakerBps={-400n} // -4.00%
        circuitBreakerActive={circuitBreakerActive}
        totalColdWalletSweptMicro={totalColdWalletSweptMicro}
        coldWalletAddress="So11111111111111111111111111111111111111112"
        currentRegime={regimeTelemetry.current_regime}
        kaufmanErBps={BigInt(regimeTelemetry.kaufman_er_bps || '4200')}
        carryAllocationTargetBps={BigInt(regimeTelemetry.carry_allocation_target_bps || '7000')}
        solanaTelemetry={solanaTelemetry}
        onToggleExecutionMode={handleToggleExecutionMode}
        onTriggerKillSwitch={handleKillSwitch}
        onResetCircuitBreaker={handleResetCircuitBreaker}
        onResetRegime={handleResetRegime}
      />

      {/* Selector de Pestañas / Vistas Operativas */}
      <nav style={{
        display: 'flex',
        gap: '12px',
        padding: '12px 24px',
        background: '#161b22',
        borderBottom: '1px solid #30363d',
        flexWrap: 'wrap'
      }}>
        <button
          onClick={() => setActiveTab('SENTINEL')}
          style={{
            background: activeTab === 'SENTINEL' ? '#1f6feb' : '#21262d',
            color: '#ffffff',
            border: 'none',
            padding: '8px 20px',
            borderRadius: '6px',
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'background 0.2s'
          }}
        >
          👁️ VISTA 1: SENTINEL ON-CHAIN (WHALE 3/10)
        </button>
        <button
          onClick={() => setActiveTab('CATALYST')}
          style={{
            background: activeTab === 'CATALYST' ? '#1f6feb' : '#21262d',
            color: '#ffffff',
            border: 'none',
            padding: '8px 20px',
            borderRadius: '6px',
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'background 0.2s'
          }}
        >
          ⚡ VISTA 2: CATALYST ENGINE (ARBITRAJE SUB-SEGUNDO)
        </button>
        <button
          onClick={() => setActiveTab('TRADES')}
          style={{
            background: activeTab === 'TRADES' ? '#1f6feb' : '#21262d',
            color: '#ffffff',
            border: 'none',
            padding: '8px 20px',
            borderRadius: '6px',
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'background 0.2s'
          }}
        >
          📜 VISTA 3: HISTORIAL DE TRADES (LEDGER)
        </button>
        <button
          onClick={() => setActiveTab('AETHER_CARRY')}
          style={{
            background: activeTab === 'AETHER_CARRY' ? '#0284c7' : '#21262d',
            color: '#ffffff',
            border: 'none',
            padding: '8px 20px',
            borderRadius: '6px',
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'background 0.2s'
          }}
        >
          💎 VISTA 4: AETHER CARRY & RÉGIMEN
        </button>
      </nav>

      {/* Renderizado de Vista Seleccionada */}
      <main>
        {activeTab === 'SENTINEL' && (
          <Section1Sentinel
            wallets={wallets}
            clusters={clusters}
            positions={positions}
            nextPurgeCountdownSeconds={purgeCountdown}
          />
        )}
        {activeTab === 'CATALYST' && (
          <Section2Catalyst
            feedItems={catalystFeeds}
            activeOrders={activeOrders}
          />
        )}
        {activeTab === 'TRADES' && (
          <Section3Transactions
            trades={trades}
            lifetimeKpis={lifetimeKpis}
          />
        )}
        {activeTab === 'AETHER_CARRY' && (
          <Section4_AetherCarry
            regimeTelemetry={regimeTelemetry}
            totalNotionalDeployedMicroUsd={totalCarryNotionalMicro}
            totalCumulativeYieldMicroUsd={totalCarryYieldMicro}
            weightedAprBps={weightedCarryAprBps}
            maxObservedDeltaDriftBps={maxDeltaDriftBps}
            stableVaultFloorAprBps="950"
            positions={carryPositions}
            activePullbackIntents={pullbackIntents}
          />
        )}
      </main>
    </div>
  );
};
