import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { calcExpDecayBps, BPS_SCALE } from '../src/core/math_bigint.js';
import { RiskGuardian, AsyncMutex, OrderIntent } from '../src/core/risk_guardian.js';
import { NexusDatabase } from '../src/core/db_sqlite_wal.js';
import { startDashboardServer, LOCAL_ADMIN_TOKEN } from '../src/ui_dashboard/server.js';
import http from 'node:http';

describe('AUDITORÍA EGM: Pruebas de Parches de Seguridad, Decaimiento Matemático y Reconciliación', () => {
  describe('Estabilidad Numérica de calcExpDecayBps (Eliminación de Divergencia de Taylor)', () => {
    it('mantiene decaimiento monótono sin colapsar a 0 en t >= 15s (x >= 2.19)', () => {
      // lambda = 1500 bps (0.15 s^-1)
      // t = 20s -> x = 3.0 -> e^-3.0 ≈ 0.04978 (498 bps)
      const factor20s = calcExpDecayBps(1500n, 20_000n);
      expect(factor20s).toBeGreaterThan(450n);
      expect(factor20s).toBeLessThan(550n);

      // t = 30s -> x = 4.5 -> e^-4.5 ≈ 0.0111 (111 bps)
      const factor30s = calcExpDecayBps(1500n, 30_000n);
      expect(factor30s).toBeGreaterThan(90n);
      expect(factor30s).toBeLessThan(130n);

      // Monotonía estricta: t=0s > t=5s > t=10s > t=20s > t=30s
      const f0 = calcExpDecayBps(1500n, 0n);
      const f5 = calcExpDecayBps(1500n, 5000n);
      const f10 = calcExpDecayBps(1500n, 10_000n);
      const f20 = factor20s;
      const f30 = factor30s;

      expect(f0).toBe(10_000n);
      expect(f0).toBeGreaterThan(f5);
      expect(f5).toBeGreaterThan(f10);
      expect(f10).toBeGreaterThan(f20);
      expect(f20).toBeGreaterThan(f30);
    });
  });

  describe('AsyncMutex Real y Límite Inmutable de 3 Posiciones ante Concurrencia Asíncrona', () => {
    let db: NexusDatabase;
    let guardian: RiskGuardian;

    beforeEach(() => {
      db = new NexusDatabase(':memory:');
      db.initRiskGuardianState(100_000_000_000n);
      guardian = new RiskGuardian(db);
    });

    it('impide condiciones de carrera: 6 órdenes concurrentes simultáneas resultan en exactamente 3 aprobadas y 3 rechazadas', async () => {
      const orders: OrderIntent[] = Array.from({ length: 6 }, (_, i) => ({
        orderId: `CONCURRENT_ORD_${i}`,
        engineOrigin: 'CATALYST_NEWS',
        instrumentTicker: `TICKER_${i}`,
        side: 1,
        notionalMicro: 5_000_000_000n, // $5,000 USD
        stopLossMicro: 90_000_000n,
        cancelAllAfterMs: 5000
      }));

      // Disparar las 6 validaciones concurrentemente en paralelo
      const results = await Promise.all(orders.map(ord => guardian.validateAndOpenPositionAtomic(ord)));

      const approved = results.filter(r => r.approved);
      const rejected = results.filter(r => !r.approved);

      expect(approved.length).toBe(3);
      expect(rejected.length).toBe(3);
      for (const rej of rejected) {
        expect(rej.rejectReason).toContain('EXCEEDED_MAX_POSITIONS');
      }

      const state = db.getRiskGuardianState();
      expect(state.open_positions_count).toBe(3n);
    });
  });

  describe('Auto-Sweep a Cold Wallet ante Ganancias Incrementales (+5%, +5%, +5%...)', () => {
    let db: NexusDatabase;
    let guardian: RiskGuardian;

    beforeEach(() => {
      db = new NexusDatabase(':memory:');
      db.initRiskGuardianState(100_000_000_000n); // $100k
      guardian = new RiskGuardian(db);
    });

    it('activa el Auto-Sweep cuando la sumatoria de ganancias acumuladas supera +25.0% sobre el HWM base', () => {
      // 5 ganancias consecutivas de $5,200 USD (+5.2% c/u -> +26.0% total acumulado)
      for (let i = 0; i < 5; i++) {
        guardian.recordPositionOpened(10_000_000_000n);
        guardian.recordPositionClosed(10_000_000_000n, 5_200_000_000n);
      }

      // Se debió disparar el sweep al superar $125k (126k alcanzados)
      const rawDb = db.getRawDb();
      const sweeps = rawDb.prepare('SELECT * FROM cold_wallet_sweeps').all() as any[];
      expect(sweeps.length).toBe(1);
      expect(sweeps[0].swept_amount_micro).toBe(26_000_000_000n); // $26k barridos
      expect(sweeps[0].hwm_baseline_micro).toBe(100_000_000_000n); // Baseline preservado

      // Post-sweep: la equidad remanente vuelve a $100k
      const postState = db.getRiskGuardianState();
      expect(postState.current_equity_micro).toBe(100_000_000_000n);
      expect(postState.high_water_mark_micro).toBe(100_000_000_000n);
    });
  });

  describe('Reconciliación de Estado tras Reinicios (Resiliencia ante HTTP 502 / Caídas)', () => {
    let db: NexusDatabase;

    beforeEach(() => {
      db = new NexusDatabase(':memory:');
      db.initRiskGuardianState(100_000_000_000n);
    });

    it('sincroniza posiciones vivas del Ledger al arrancar si la tabla risk_guardian_state quedó desfasada', () => {
      const rawDb = db.getRawDb();

      // Simular que en el Ledger quedaron 2 posiciones abiertas por un crash previo ($15k total)
      rawDb.prepare(`
        INSERT INTO unified_positions_ledger (
          position_id, engine_origin, signal_ref_id, execution_mode,
          instrument_ticker, side, phase_allocation_bps, notional_invested_micro,
          quantity_atomic, entry_price_micro, stop_loss_micro, peak_price_micro,
          status, opened_at_ms
        ) VALUES 
          ('POS_PREV_1', 'SENTINEL_ONCHAIN', 'SIG_1', 'SHADOW', 'SOL', 1, 10000, 10000000000, '50000000000', 200000000, 190000000, 200000000, 'OPEN', 1000),
          ('POS_PREV_2', 'CATALYST_NEWS', 'SIG_2', 'SHADOW', 'BTC', 1, 3500, 5000000000, '100000000', 50000000000, 48000000000, 50000000000, 'PARTIALLY_CLOSED', 2000)
      `).run();

      // En el estado de supervisor, las posiciones figuraban en 0 por el crash
      db.updateRiskGuardianState({ open_positions_count: 0n, open_exposure_micro: 0n });

      const guardian = new RiskGuardian(db);
      const reconciled = guardian.reconcileStartupState();

      expect(reconciled.openPositionsCount).toBe(2n);
      expect(reconciled.openExposureMicro).toBe(15_000_000_000n);

      const stateAfter = db.getRiskGuardianState();
      expect(stateAfter.open_positions_count).toBe(2n);
      expect(stateAfter.open_exposure_micro).toBe(15_000_000_000n);
    });
  });

  describe('Protección del Endpoint /api/mode contra Conmutación Insegura a LIVE', () => {
    let db: NexusDatabase;
    let guardian: RiskGuardian;
    let server: http.Server;
    let port: number;

    beforeEach(async () => {
      db = new NexusDatabase(':memory:');
      db.initRiskGuardianState(100_000_000_000n);
      guardian = new RiskGuardian(db);
      port = 8899 + Math.floor(Math.random() * 500);

      const s = startDashboardServer(db, guardian, port);
      server = s.server;

      await new Promise(resolve => server.listen(port, () => resolve(true)));
    });

    afterEach(async () => {
      await new Promise(resolve => server.close(resolve));
    });

    it('rechaza cualquier petición a /api/ sin encabezado X-Nexus-Auth (HTTP 401)', async () => {
      const res = await fetch(`http://localhost:${port}/api/mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'SHADOW' })
      });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toBe('UNAUTHORIZED');
    });

    it('rechaza la transición a LIVE si faltan variables de entorno en el servidor (HTTP 422)', async () => {
      delete process.env.EXCHANGE_API_KEY;
      delete process.env.EXCHANGE_SECRET;
      delete process.env.PRIVATE_KEY;

      const res = await fetch(`http://localhost:${port}/api/mode`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Nexus-Auth': LOCAL_ADMIN_TOKEN
        },
        body: JSON.stringify({ mode: 'LIVE', confirmationPhrase: 'ENABLE_LIVE_CAPITAL_RISK' })
      });

      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toBe('MISSING_LIVE_CREDENTIALS');
      expect(data.missingKeys.length).toBeGreaterThan(0);
    });

    it('rechaza la transición a LIVE si no se incluye la frase de confirmación explícita (HTTP 400)', async () => {
      process.env.EXCHANGE_API_KEY = 'TEST_KEY';
      process.env.EXCHANGE_SECRET = 'TEST_SECRET';
      process.env.PRIVATE_KEY = 'TEST_KEY';

      const res = await fetch(`http://localhost:${port}/api/mode`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Nexus-Auth': LOCAL_ADMIN_TOKEN
        },
        body: JSON.stringify({ mode: 'LIVE', confirmationPhrase: 'WRONG_PHRASE' })
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toBe('EXPLICIT_CONFIRMATION_REQUIRED');
    });

    it('rechaza la transición a LIVE si hay un Circuit Breaker activo (HTTP 423)', async () => {
      process.env.EXCHANGE_API_KEY = 'TEST_KEY';
      process.env.EXCHANGE_SECRET = 'TEST_SECRET';
      process.env.PRIVATE_KEY = 'TEST_KEY';

      // Disparar Circuit Breaker
      guardian.triggerCircuitBreaker('TEST_BREACH');

      const res = await fetch(`http://localhost:${port}/api/mode`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Nexus-Auth': LOCAL_ADMIN_TOKEN
        },
        body: JSON.stringify({ mode: 'LIVE', confirmationPhrase: 'ENABLE_LIVE_CAPITAL_RISK' })
      });

      expect(res.status).toBe(423);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toBe('CIRCUIT_BREAKER_LOCKED');
    });

    it('permite cambiar a LIVE cuando existen credenciales, frase correcta y sin Circuit Breaker', async () => {
      process.env.EXCHANGE_API_KEY = 'TEST_KEY';
      process.env.EXCHANGE_SECRET = 'TEST_SECRET';
      process.env.PRIVATE_KEY = 'TEST_KEY';

      const res = await fetch(`http://localhost:${port}/api/mode`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Nexus-Auth': LOCAL_ADMIN_TOKEN
        },
        body: JSON.stringify({ mode: 'LIVE', confirmationPhrase: 'ENABLE_LIVE_CAPITAL_RISK' })
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.executionMode).toBe('LIVE');

      const state = db.getRiskGuardianState();
      expect(state.execution_mode).toBe('LIVE');
    });
  });

  describe('Reset y Desactivación del Circuit Breaker (/api/circuit-breaker/reset)', () => {
    let db: NexusDatabase;
    let guardian: RiskGuardian;
    let server: http.Server;
    let port: number;

    beforeEach(async () => {
      db = new NexusDatabase(':memory:');
      db.initRiskGuardianState(100_000_000_000n);
      guardian = new RiskGuardian(db);
      port = 9200 + Math.floor(Math.random() * 500);

      const s = startDashboardServer(db, guardian, port);
      server = s.server;

      await new Promise(resolve => server.listen(port, () => resolve(true)));
    });

    afterEach(async () => {
      await new Promise(resolve => server.close(resolve));
    });

    it('rechaza la petición si falta o es inválido el encabezado X-Nexus-Auth (HTTP 401)', async () => {
      const res = await fetch(`http://localhost:${port}/api/circuit-breaker/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmationPhrase: 'RESET_CIRCUIT_BREAKER_EMERGENCY' })
      });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toBe('UNAUTHORIZED');
    });

    it('rechaza la petición si la frase de confirmación no es exacta (HTTP 400)', async () => {
      guardian.triggerCircuitBreaker('TEST_BREACH');
      expect(guardian.isCircuitBreakerActive()).toBe(true);

      const res = await fetch(`http://localhost:${port}/api/circuit-breaker/reset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Nexus-Auth': LOCAL_ADMIN_TOKEN
        },
        body: JSON.stringify({ confirmationPhrase: 'RESET_BREAKER' })
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toBe('INVALID_CONFIRMATION_PHRASE');
      expect(guardian.isCircuitBreakerActive()).toBe(true);
    });

    it('reinicia exitosamente el Circuit Breaker con frase exacta RESET_CIRCUIT_BREAKER_EMERGENCY (HTTP 200)', async () => {
      guardian.triggerCircuitBreaker('DRAWDOWN_LIMIT_REACHED');
      db.updateRiskGuardianState({ rolling_24h_pnl_micro: -5_000_000_000n });
      expect(guardian.isCircuitBreakerActive()).toBe(true);

      const res = await fetch(`http://localhost:${port}/api/circuit-breaker/reset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Nexus-Auth': LOCAL_ADMIN_TOKEN
        },
        body: JSON.stringify({ confirmationPhrase: 'RESET_CIRCUIT_BREAKER_EMERGENCY' })
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.message).toBe('Circuit breaker reiniciado exitosamente');

      const stateAfter = db.getRiskGuardianState();
      expect(stateAfter.circuit_breaker_until_ms).toBe(0n);
      expect(stateAfter.rolling_24h_pnl_micro).toBe(0n);
      expect(guardian.isCircuitBreakerActive()).toBe(false);
    });

    it('permite conmutar a LIVE tras haber reiniciado el Circuit Breaker bloqueado', async () => {
      process.env.EXCHANGE_API_KEY = 'TEST_KEY';
      process.env.EXCHANGE_SECRET = 'TEST_SECRET';
      process.env.PRIVATE_KEY = 'TEST_KEY';

      // Disparar Circuit Breaker
      guardian.triggerCircuitBreaker('TEST_HALT');
      expect(guardian.isCircuitBreakerActive()).toBe(true);

      // Intento a LIVE debe fallar (HTTP 423)
      const resBlocked = await fetch(`http://localhost:${port}/api/mode`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Nexus-Auth': LOCAL_ADMIN_TOKEN
        },
        body: JSON.stringify({ mode: 'LIVE', confirmationPhrase: 'ENABLE_LIVE_CAPITAL_RISK' })
      });
      expect(resBlocked.status).toBe(423);

      // Reiniciar Circuit Breaker
      const resReset = await fetch(`http://localhost:${port}/api/circuit-breaker/reset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Nexus-Auth': LOCAL_ADMIN_TOKEN
        },
        body: JSON.stringify({ confirmationPhrase: 'RESET_CIRCUIT_BREAKER_EMERGENCY' })
      });
      expect(resReset.status).toBe(200);

      // Ahora la conmutación a LIVE debe permitirse
      const resLive = await fetch(`http://localhost:${port}/api/mode`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Nexus-Auth': LOCAL_ADMIN_TOKEN
        },
        body: JSON.stringify({ mode: 'LIVE', confirmationPhrase: 'ENABLE_LIVE_CAPITAL_RISK' })
      });
      expect(resLive.status).toBe(200);
      const dataLive = await resLive.json();
      expect(dataLive.ok).toBe(true);
      expect(dataLive.executionMode).toBe('LIVE');
    });
  });

  describe('Historial de Transacciones y Trade Ledger (/api/trades y WebSocket)', () => {
    let db: NexusDatabase;
    let guardian: RiskGuardian;
    let server: http.Server;
    let port: number;

    beforeEach(async () => {
      db = new NexusDatabase(':memory:');
      db.initRiskGuardianState(100_000_000_000n);
      guardian = new RiskGuardian(db);
      port = 9600 + Math.floor(Math.random() * 300);

      const rawDb = db.getRawDb();
      rawDb.prepare(`
        INSERT INTO unified_positions_ledger (
          position_id, engine_origin, signal_ref_id, execution_mode,
          instrument_ticker, side, phase_allocation_bps, notional_invested_micro,
          quantity_atomic, entry_price_micro, stop_loss_micro, peak_price_micro,
          status, realized_pnl_micro, unrealized_pnl_micro, opened_at_ms, closed_at_ms
        ) VALUES 
          ('POS_TEST_01', 'SENTINEL_ONCHAIN', 'SIG_01', 'SHADOW', 'SOL/USD', 1, 10000, 5000000000, '1000000', 180000000, 175000000, 185000000, 'CLOSED', 138888000, 0, 1000, 1200),
          ('POS_TEST_02', 'CATALYST_NEWS', 'SIG_02', 'LIVE', 'AVAX/USD', 1, 10000, 4000000000, '1000000', 25000000, 24000000, 24500000, 'STOPPED_OUT', -80000000, 0, 2000, 2100)
      `).run();

      const s = startDashboardServer(db, guardian, port);
      server = s.server;

      await new Promise(resolve => server.listen(port, () => resolve(true)));
    });

    afterEach(async () => {
      await new Promise(resolve => server.close(resolve));
    });

    it('rechaza GET /api/trades si falta encabezado X-Nexus-Auth (HTTP 401)', async () => {
      const res = await fetch(`http://localhost:${port}/api/trades`);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toBe('UNAUTHORIZED');
    });

    it('retorna la lista de transacciones en JSON con autenticación (HTTP 200)', async () => {
      const res = await fetch(`http://localhost:${port}/api/trades`, {
        headers: { 'X-Nexus-Auth': LOCAL_ADMIN_TOKEN }
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.count).toBe(2);
      expect(Array.isArray(data.trades)).toBe(true);
      expect(data.trades.length).toBe(2);
      // Ordenadas por opened_at_ms DESC (POS_TEST_02 abrió en t=2000, POS_TEST_01 en t=1000)
      expect(data.trades[0].positionId).toBe('POS_TEST_02');
      expect(data.trades[0].instrumentTicker).toBe('AVAX/USD');
      expect(data.trades[0].executionMode).toBe('LIVE');
      expect(data.trades[1].positionId).toBe('POS_TEST_01');
      expect(data.trades[1].instrumentTicker).toBe('SOL/USD');
      expect(data.trades[1].executionMode).toBe('SHADOW');
    });
  });
});
