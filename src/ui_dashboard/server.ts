/**
 * NEXUS QUANT SUITE v2.0 - DASHBOARD HTTP & WEBSOCKET SERVER (BLINDADO)
 * 
 * Expone la interfaz web interactiva en http://localhost:8080 con streaming WebSocket
 * en tiempo real de métricas de RiskGuardian, pool Sentinel y eventos Catalyst.
 * 
 * Mejoras de Seguridad de Auditoría EGM:
 * 1. Control de acceso estricto y protección anti-misclick con Challenge String en `/api/mode`.
 * 2. Verificación de variables de entorno (PRIVATE_KEY, EXCHANGE_API_KEY, EXCHANGE_SECRET) antes de permitir LIVE.
 * 3. Bloqueo estricto si el Circuit Breaker está activo (HTTP 423).
 * 4. Límite de tamaño de body (anti-OOM DoS) y sanitización de inputs.
 * 5. Telemetría de Cold Wallet calculada dinámicamente desde la tabla `cold_wallet_sweeps`.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import {
  NexusDatabase,
  AetherCarryLedgerRecord,
  AetherRegimeTelemetryRecord,
  AetherSqliteRepository,
  SentinelPullbackIntentRecord,
  SentinelPullbackIntentRepository
} from '../core/db_sqlite_wal.js';
import { RiskGuardian } from '../core/risk_guardian.js';

export const LOCAL_ADMIN_TOKEN = crypto.randomBytes(16).toString('hex');

export interface DashboardServerDependencies {
  readonly aetherRepo?: AetherSqliteRepository;
  readonly pullbackRepo?: SentinelPullbackIntentRepository;
  readonly getGlobalRiskState?: () => Record<string, unknown>;
  readonly getSolanaTelemetry?: () => any;
  readonly getConfluenceClusters?: () => any[];
  readonly getLivePrice?: (ticker: string) => bigint | null;
  readonly onResetCircuitBreaker?: (phrase: string) => boolean;
  readonly onTriggerKillSwitch?: () => void;
  readonly onResetRegime?: () => void;
}

export interface AetherCarrySummaryResponse {
  readonly total_notional_deployed_micro_usd: string;
  readonly total_cumulative_yield_micro_usd: string;
  readonly weighted_apr_bps: string;
  readonly max_observed_delta_drift_bps: string;
  readonly active_positions_count: number;
  readonly positions: readonly AetherCarryLedgerRecord[];
}

export function serializeBigIntJson(payload: unknown): string {
  return JSON.stringify(payload, (_key: string, value: unknown): unknown => {
    if (typeof value === 'bigint') {
      return value.toString();
    }
    return value;
  });
}

export function buildCarrySummaryPayload(
  positions: readonly AetherCarryLedgerRecord[]
): AetherCarrySummaryResponse {
  let totalNotionalMicro = 0n;
  let totalYieldMicro = 0n;
  let weightedAprNumerator = 0n;
  let maxDriftBps = 0n;

  for (const pos of positions) {
    totalNotionalMicro += pos.notional_deployed_micro_usd;
    totalYieldMicro += pos.cumulative_yield_micro_usd;
    weightedAprNumerator += pos.notional_deployed_micro_usd * pos.current_apr_bps;
    if (pos.delta_drift_bps > maxDriftBps) {
      maxDriftBps = pos.delta_drift_bps;
    }
  }

  const weightedAprBps =
    totalNotionalMicro > 0n ? weightedAprNumerator / totalNotionalMicro : 0n;

  return {
    total_notional_deployed_micro_usd: totalNotionalMicro.toString(),
    total_cumulative_yield_micro_usd: totalYieldMicro.toString(),
    weighted_apr_bps: weightedAprBps.toString(),
    max_observed_delta_drift_bps: maxDriftBps.toString(),
    active_positions_count: positions.length,
    positions,
  };
}

export function safeJsonStringify(obj: any): string {
  return JSON.stringify(obj, (_key, value) => {
    return typeof value === 'bigint' ? value.toString() : value;
  });
}

export function startDashboardServer(
  db: NexusDatabase,
  guardian?: RiskGuardian,
  port: number = 8080,
  deps?: DashboardServerDependencies
): {
  server: http.Server;
  wss: WebSocketServer;
  broadcast: (msg: any) => void;
  getWalletPool: () => any[];
  getTradeLedger: (limit?: number) => any[];
  getOpenPositions: () => any[];
} {
  const publicDir = path.resolve(process.cwd(), 'public');
  const bundlePath = path.join(publicDir, 'dashboard.js');
  const MAX_BODY_BYTES = 4096;

  const server = http.createServer((req, res) => {
    // Verificación de Seguridad y CSRF para endpoints de la API
    if (req.url?.startsWith('/api/')) {
      const origin = req.headers['origin'] || req.headers['referer'];
      if (origin) {
        const isLocal = origin.startsWith('http://localhost') || 
                        origin.startsWith('http://127.0.0.1') || 
                        origin.startsWith('https://localhost');
        if (!isLocal) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'CSRF_ORIGIN_DENIED', message: 'Origen no autorizado.' }));
          return;
        }
      }

      const authHeader = req.headers['x-nexus-auth'];
      if (authHeader !== LOCAL_ADMIN_TOKEN) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'UNAUTHORIZED', message: 'Falta o es inválido el encabezado X-Nexus-Auth.' }));
        return;
      }
    }

    // 1. Endpoint POST /api/mode (Transición Segura con Challenge String)
    if (req.method === 'POST' && req.url === '/api/mode') {
      let body = '';
      let bodyLength = 0;

      req.on('data', chunk => {
        bodyLength += chunk.length;
        if (bodyLength > MAX_BODY_BYTES) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'PAYLOAD_TOO_LARGE' }));
          req.destroy();
          return;
        }
        body += chunk;
      });

      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const targetMode = parsed.mode;

          if (targetMode !== 'SHADOW' && targetMode !== 'LIVE') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'INVALID_MODE', message: "Mode must be 'SHADOW' or 'LIVE'" }));
            return;
          }

          if (targetMode === 'LIVE') {
            // (a) Verificación de Circuit Breaker activo
            const currentState = db.getRiskGuardianState();
            const now = BigInt(Date.now());
            if (currentState.circuit_breaker_until_ms > now) {
              res.writeHead(423, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                ok: false,
                error: 'CIRCUIT_BREAKER_LOCKED',
                message: `Transición a LIVE bloqueada: Circuit Breaker activo hasta ${new Date(Number(currentState.circuit_breaker_until_ms)).toISOString()}`
              }));
              return;
            }

            // (b) Verificación de llaves privadas y credenciales en variables de entorno
            const requiredEnv = ['EXCHANGE_API_KEY', 'EXCHANGE_SECRET'];
            const missingEnv = requiredEnv.filter(k => !process.env[k] || process.env[k]?.trim() === '');
            const hasSigningKey = Boolean(process.env.PRIVATE_KEY || process.env.SOLANA_PRIVATE_KEY || process.env.EVM_PRIVATE_KEY);
            if (!hasSigningKey) missingEnv.push('PRIVATE_KEY (SOLANA o EVM)');

            if (missingEnv.length > 0) {
              res.writeHead(422, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                ok: false,
                error: 'MISSING_LIVE_CREDENTIALS',
                message: 'No se puede activar MODO LIVE sin credenciales criptográficas configuradas en el entorno.',
                missingKeys: missingEnv
              }));
              return;
            }

            // (c) Verificación de confirmación explícita (Two-Man Challenge String)
            const EXPECTED_CHALLENGE = 'ENABLE_LIVE_CAPITAL_RISK';
            if (parsed.confirmationPhrase !== EXPECTED_CHALLENGE) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                ok: false,
                error: 'EXPLICIT_CONFIRMATION_REQUIRED',
                message: `Confirmación de seguridad requerida. Envía confirmationPhrase: '${EXPECTED_CHALLENGE}'`
              }));
              return;
            }
          }

          // Si pasó todas las validaciones o si es degradación a SHADOW
          db.updateRiskGuardianState({ execution_mode: targetMode });
          broadcast({ type: 'RISK_UPDATE', executionMode: targetMode });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, executionMode: targetMode }));
          return;
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'INTERNAL_SERVER_ERROR' }));
          return;
        }
      });
      return;
    }

    // 2. Endpoint POST /api/kill-switch
    if (req.method === 'POST' && req.url === '/api/kill-switch') {
      if (guardian) {
        guardian.executeKillSwitch();
      } else {
        db.updateRiskGuardianState({
          execution_mode: 'SHADOW',
          circuit_breaker_until_ms: BigInt(Date.now() + 86400000),
          open_exposure_micro: 0n,
          open_positions_count: 0n
        });
      }
      broadcast({
        type: 'RISK_UPDATE',
        executionMode: 'SHADOW',
        circuitBreakerActive: true,
        openExposureMicro: '0'
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: 'KILL_SWITCH_EXECUTED' }));
      return;
    }

    // 3. Endpoint POST /api/circuit-breaker/reset (Reanudación Segura con Challenge String)
    if (req.method === 'POST' && req.url === '/api/circuit-breaker/reset') {
      let body = '';
      let bodyLength = 0;

      req.on('data', chunk => {
        bodyLength += chunk.length;
        if (bodyLength > MAX_BODY_BYTES) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'PAYLOAD_TOO_LARGE' }));
          req.destroy();
          return;
        }
        body += chunk;
      });

      req.on('end', () => {
        try {
          let parsed: any = {};
          if (body.trim().length > 0) {
            parsed = JSON.parse(body);
          }

          const EXPECTED_CHALLENGE = 'RESET_CIRCUIT_BREAKER_EMERGENCY';
          if (parsed.confirmationPhrase !== EXPECTED_CHALLENGE) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              ok: false,
              error: 'INVALID_CONFIRMATION_PHRASE',
              message: `Confirmación de seguridad requerida. Envía confirmationPhrase: '${EXPECTED_CHALLENGE}'`
            }));
            return;
          }

          if (guardian) {
            guardian.resetCircuitBreaker();
          } else {
            db.updateRiskGuardianState({
              circuit_breaker_active: 0,
              circuit_breaker_until_ms: 0n,
              rolling_24h_pnl_micro: 0n
            });
          }

          broadcast({
            type: 'RISK_UPDATE',
            circuitBreakerActive: false,
            rolling24hPnlMicro: '0'
          });
          broadcast({
            type: 'CIRCUIT_BREAKER_STATUS',
            active: false
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, message: 'Circuit breaker reiniciado exitosamente' }));
          return;
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'INTERNAL_SERVER_ERROR' }));
          return;
        }
      });
      return;
    }

    // 4. Endpoint GET /api/trades (Historial de Posiciones / Trade Ledger)
    if (req.method === 'GET' && (req.url === '/api/trades' || req.url?.startsWith('/api/trades?'))) {
      const trades = getInitialTradeLedger(100);
      const lifetimeKpis = db.getLifetimeTradeMetrics();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(safeJsonStringify({ ok: true, count: trades.length, lifetimeKpis, trades }));
      return;
    }

    // 5. Endpoint GET /api/aether/regime (Telemetría de Régimen Macro)
    if (req.method === 'GET' && req.url === '/api/aether/regime') {
      const aetherRepo = new AetherSqliteRepository(db.getRawDb());
      const latestRegime = aetherRepo.getLatestRegimeTelemetry() ?? {
        current_regime: 'REGIME_TRENDING',
        kaufman_er_bps: 4200n,
        atr_ratio_bps: 11000n,
        bollinger_width_bps: 310n,
        sentinel_multiplier_bps: 10000n,
        catalyst_multiplier_bps: 10000n,
        carry_allocation_target_bps: 7000n,
        updated_at_ms: BigInt(Date.now()),
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(serializeBigIntJson({ ok: true, data: latestRegime }));
      return;
    }

    // 5b. Endpoint POST /api/aether/regime/reset (Restablecer Régimen a TRENDING)
    if (req.method === 'POST' && req.url === '/api/aether/regime/reset') {
      const aetherRepo = new AetherSqliteRepository(db.getRawDb());
      const nowMs = BigInt(Date.now());
      aetherRepo.saveRegimeTelemetry({
        current_regime: 'REGIME_TRENDING',
        kaufman_er_bps: 4200n,
        atr_ratio_bps: 11000n,
        bollinger_width_bps: 250n,
        sentinel_multiplier_bps: 10000n,
        catalyst_multiplier_bps: 10000n,
        carry_allocation_target_bps: 7000n,
        updated_at_ms: nowMs,
      });
      if (deps?.onResetRegime) {
        deps.onResetRegime();
      }
      broadcast({
        type: 'AETHER_REGIME_UPDATE',
        regime: 'REGIME_TRENDING'
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: 'Régimen Aether restablecido con éxito a REGIME_TRENDING.' }));
      return;
    }

    // 6. Endpoint GET /api/aether/carry (Posiciones y Rendimiento de Carry Delta-Neutral)
    if (req.method === 'GET' && req.url === '/api/aether/carry') {
      const aetherRepo = new AetherSqliteRepository(db.getRawDb());
      const activePositions = aetherRepo.getAllActiveCarryPositions();
      const summaryPayload = buildCarrySummaryPayload(activePositions);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(serializeBigIntJson({ ok: true, data: summaryPayload }));
      return;
    }

    // 7. Endpoint GET /api/sentinel/pullbacks (Órdenes Límite de Retroceso Pendientes)
    if (req.method === 'GET' && (req.url === '/api/sentinel/pullbacks' || req.url?.startsWith('/api/sentinel/pullbacks?'))) {
      const pullbackRepo = new SentinelPullbackIntentRepository(db.getRawDb());
      const urlObj = new URL(req.url, 'http://localhost:8080');
      const mintFilter = urlObj.searchParams.get('mint') ?? '';
      const nowMs = BigInt(Date.now());
      const intents = mintFilter
        ? pullbackRepo.getActiveIntentsByMint(mintFilter, nowMs)
        : pullbackRepo.getAllWaitingIntents();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(serializeBigIntJson({ ok: true, data: intents }));
      return;
    }

    // 5b. Endpoint GET /api/solana/telemetry (Telemetría en Vivo de Solana Mainnet RPC)
    if (req.method === 'GET' && req.url === '/api/solana/telemetry') {
      const solana = deps?.getSolanaTelemetry ? deps.getSolanaTelemetry() : { isConnected: false };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(safeJsonStringify({ ok: true, data: solana }));
      return;
    }

    // 8. Endpoint GET /api/wallets (Pool de Billeteras Sentinel LIVE & SHADOW con Contadores de Pérdidas)
    if (req.method === 'GET' && (req.url === '/api/wallets' || req.url?.startsWith('/api/wallets?'))) {
      const wallets = getInitialWalletPool();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(safeJsonStringify({ ok: true, data: wallets, wallets }));
      return;
    }

    // 9. Endpoint GET /api/positions (Posiciones DEX y Moonbag Activas con PnL Dinámico)
    if (req.method === 'GET' && (req.url === '/api/positions' || req.url?.startsWith('/api/positions?'))) {
      const positions = getInitialOpenPositions();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(safeJsonStringify({ ok: true, count: positions.length, positions }));
      return;
    }

    // 10. Endpoint GET /api/sentinel/clusters & /api/clusters (Radar de Confluencia On-Chain y 5 Semáforos Firewall)
    if (
      req.method === 'GET' &&
      (req.url === '/api/sentinel/clusters' ||
        req.url === '/api/clusters' ||
        req.url?.startsWith('/api/sentinel/clusters?') ||
        req.url?.startsWith('/api/clusters?'))
    ) {
      const clusters = deps?.getConfluenceClusters ? deps.getConfluenceClusters() : [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(safeJsonStringify({ ok: true, count: clusters.length, clusters }));
      return;
    }

    // 4b. Manejador Estricto 404 para Rutas /api/* No Coincidentes (Evita Caída al Fallback HTML)
    if (req.url?.startsWith('/api/')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: false,
        error: 'API_ENDPOINT_NOT_FOUND',
        message: `El endpoint '${req.method} ${req.url}' no existe o el backend requiere reinicio.`
      }));
      return;
    }

    // 5. Servir Bundle de JavaScript
    if (req.url === '/dashboard.js') {
      if (fs.existsSync(bundlePath)) {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        fs.createReadStream(bundlePath).pipe(res);
        return;
      }
    }

    // 6. Servir Documento Principal HTML con Tipografía Moderna y Token de Sesión
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NEXUS QUANT SUITE v2.0 — Dual Engine Dashboard</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🛡️</text></svg>">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #090d13;
      color: #e2e8f0;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      -webkit-font-smoothing: antialiased;
    }
  </style>
</head>
<body>
  <div id="root">
    <div style="padding: 40px; text-align: center; font-family: monospace;">
      <h2 style="color: #58a6ff;">🛡️ INICIALIZANDO NEXUS QUANT SUITE v2.0...</h2>
      <p style="color: #8b949e;">Cargando Radar Sentinel On-Chain y Catalyst Engine en tiempo real...</p>
    </div>
  </div>
  <script>
    window.__NEXUS_ADMIN_TOKEN__ = "${LOCAL_ADMIN_TOKEN}";
  </script>
  <script src="/dashboard.js"></script>
</body>
</html>`);
  });

  const wss = new WebSocketServer({ server });

  const getAggregatedSweepsMicro = (): string => {
    try {
      const rawDb = db.getRawDb();
      const row = rawDb.prepare('SELECT COALESCE(SUM(swept_amount_micro), 0) as total FROM cold_wallet_sweeps').get() as { total: bigint };
      return row.total.toString();
    } catch {
      return '0';
    }
  };

  const getInitialWalletPool = (): any[] => {
    try {
      const rawDb = db.getRawDb();
      const liveRows = rawDb.prepare(
        `SELECT wallet_address as address, chain_id as chain, pool_tier as tier, 
                profit_factor_scaled as profitFactorScaled, 
                win_rate_bps as winRateBps, 
                consecutive_losses as consecutiveLosses 
         FROM sentinel_wallets_pool 
         WHERE pool_tier = 'LIVE' 
         ORDER BY profit_factor_scaled DESC 
         LIMIT 10`
      ).all() as any[];

      const shadowRows = rawDb.prepare(
        `SELECT wallet_address as address, chain_id as chain, pool_tier as tier, 
                profit_factor_scaled as profitFactorScaled, 
                win_rate_bps as winRateBps, 
                consecutive_losses as consecutiveLosses 
         FROM sentinel_wallets_pool 
         WHERE pool_tier = 'SHADOW' 
         ORDER BY profit_factor_scaled DESC 
         LIMIT 40`
      ).all() as any[];

      const rows = [...liveRows, ...shadowRows];
      return rows.map(r => ({
        address: String(r.address),
        chain: String(r.chain),
        tier: String(r.tier),
        profitFactorScaled: Number(r.profitFactorScaled),
        winRateBps: Number(r.winRateBps),
        consecutiveLosses: Number(r.consecutiveLosses)
      }));
    } catch (err) {
      console.error('❌ [LEDGER_FETCH_ERROR] Error al consultar unified_positions_ledger:', err);
      return [];
    }
  };

  const getInitialOpenPositions = (): any[] => {
    try {
      const openRows = db.getOpenPositions();
      return openRows.map(r => {
        const livePrice = deps?.getLivePrice ? deps.getLivePrice(r.instrument_ticker) : null;
        const currentPriceMicro = livePrice ?? (r.peak_price_micro || r.entry_price_micro);
        const entryPriceMicro = r.entry_price_micro;
        const side = BigInt(r.side || 1);

        let pnlBps = 0;
        if (entryPriceMicro > 0n) {
          const delta = side === 1n
            ? (currentPriceMicro - entryPriceMicro)
            : (entryPriceMicro - currentPriceMicro);
          pnlBps = Number((delta * 10000n) / entryPriceMicro);
        }

        const isDerisked = r.status === 'PARTIALLY_CLOSED';
        const isClosed = r.status === 'CLOSED' || r.status === 'STOPPED_OUT' || r.status === 'TIME_STOPPED';

        return {
          positionId: String(r.position_id),
          tokenTicker: String(r.instrument_ticker),
          entryPriceUsd: (Number(entryPriceMicro) / 1_000_000).toFixed(6),
          currentPriceUsd: (Number(currentPriceMicro) / 1_000_000).toFixed(6),
          pnlBps,
          deRiskStatus: isDerisked ? 'DERISKED_75PCT' : (isClosed ? 'CLOSED' : 'PENDING'),
          moonbagStatus: isDerisked ? 'ACTIVE_TRAILING_15PCT' : 'INACTIVE',
          remainingTokens: BigInt(r.quantity_atomic || '0').toLocaleString('en-US'),
          venueTrack: r.venue_track || 'BINANCE_LIQUID_CEX',
          isBreakEvenLocked: r.is_breakeven_locked === 1,
          isTp1Executed: r.is_tp1_executed === 1,
          isTp2Executed: r.is_tp2_executed === 1
        };
      });
    } catch (err) {
      console.error('❌ [LEDGER_FETCH_ERROR] Error al consultar unified_positions_ledger:', err);
      return [];
    }
  };

  const getInitialTradeLedger = (limit: number = 100): any[] => {
    try {
      const rows = db.getRecentPositions(limit);
      return rows.map(r => ({
        positionId: String(r.position_id),
        engineOrigin: String(r.engine_origin),
        signalRefId: String(r.signal_ref_id || ''),
        executionMode: String(r.execution_mode),
        instrumentTicker: String(r.instrument_ticker),
        side: Number(r.side),
        notionalInvestedMicro: r.notional_invested_micro.toString(),
        entryPriceMicro: r.entry_price_micro.toString(),
        peakPriceMicro: r.peak_price_micro ? r.peak_price_micro.toString() : r.entry_price_micro.toString(),
        exitPriceMicro: (r as any).exit_price_micro ? (r as any).exit_price_micro.toString() : undefined,
        quantityAtomic: r.quantity_atomic ? r.quantity_atomic.toString() : '0',
        stopLossMicro: r.stop_loss_micro ? r.stop_loss_micro.toString() : '0',
        status: String(r.status),
        realizedPnlMicro: r.realized_pnl_micro ? r.realized_pnl_micro.toString() : '0',
        unrealizedPnlMicro: r.unrealized_pnl_micro ? r.unrealized_pnl_micro.toString() : '0',
        openedAtMs: Number(r.opened_at_ms),
        closedAtMs: r.closed_at_ms ? Number(r.closed_at_ms) : null
      }));
    } catch (err) {
      console.error('❌ [LEDGER_FETCH_ERROR] Error al consultar unified_positions_ledger:', err);
      return [];
    }
  };

  const broadcast = (msg: any) => {
    try {
      const payload = safeJsonStringify(msg);
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload, (err) => {
            if (err) {
              console.warn('[WS Broadcast Client Error]:', err.message);
            }
          });
        }
      });
    } catch (e) {
      console.warn('[WS Broadcast Catch]:', e);
    }
  };

  wss.on('error', (err) => {
    console.warn('[WSS Server Error]:', err.message);
  });

  wss.on('connection', (ws: WebSocket) => {
    ws.on('error', (err) => {
      console.warn('[WS Client Socket Error]:', err.message);
    });

    try {
      const state = db.getRiskGuardianState();
      const wallets = getInitialWalletPool();
      const clusters = deps?.getConfluenceClusters ? deps.getConfluenceClusters() : [];
      const positions = getInitialOpenPositions();
      const trades = getInitialTradeLedger(100);
      const lifetimeKpis = db.getLifetimeTradeMetrics();

      ws.send(safeJsonStringify({
        type: 'INIT_SYSTEM_STATE',
        adminToken: LOCAL_ADMIN_TOKEN,
        nextPurgeTimestampMs: db.getNextPurgeTimestampMs(),
        risk: {
          executionMode: state.execution_mode,
          openExposureMicro: state.open_exposure_micro.toString(),
          baseCapitalMicro: state.base_capital_micro.toString(),
          rolling24hPnlMicro: state.rolling_24h_pnl_micro.toString(),
          circuitBreakerActive: state.circuit_breaker_until_ms > BigInt(Date.now()),
          totalColdWalletSweptMicro: getAggregatedSweepsMicro()
        },
        wallets,
        clusters,
        positions,
        lifetimeKpis,
        trades,
        solana: deps?.getSolanaTelemetry ? deps.getSolanaTelemetry() : null
      }));
    } catch (e) {
      console.warn('WS Init State Error:', e);
    }
  });

  return {
    server,
    wss,
    broadcast,
    getWalletPool: getInitialWalletPool,
    getTradeLedger: getInitialTradeLedger,
    getOpenPositions: getInitialOpenPositions
  };
}
