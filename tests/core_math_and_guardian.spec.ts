import { describe, it, expect, beforeEach } from 'vitest';
import {
  MICRO_USD_SCALE,
  BPS_SCALE,
  usdToMicro,
  microUsdToString,
  calcBpsDelta,
  applyBpsIncrease,
  applyBpsDiscount,
  calcAllocationMicro,
  calcFibonacciPullback,
  calcExpDecayBps,
  calcExponentialTrailingStopDistanceBps,
  calcTokenQuantityAtomic
} from '../src/core/math_bigint.js';
import { NexusDatabase } from '../src/core/db_sqlite_wal.js';
import { InstrumentRingBuffer, L2Snapshot } from '../src/core/ring_buffer_l2.js';
import { RiskGuardian, OrderIntent } from '../src/core/risk_guardian.js';

describe('FASE 1: Math BigInt, SQLite WAL, RingBuffer L2 & Risk Guardian', () => {
  describe('Aritmética Entera Estricta (BigInt & Micro-USD)', () => {
    it('convierte USD a micro-USD con precisión exacta de 10^6', () => {
      expect(usdToMicro(1)).toBe(1_000_000n);
      expect(usdToMicro(100_000)).toBe(100_000_000_000n);
      expect(microUsdToString(123_456_789n)).toBe('123.456789');
      expect(microUsdToString(-5_500_000n)).toBe('-5.500000');
    });

    it('calcula variaciones en Puntos Base (bps) sin números flotantes', () => {
      const pBase = 100_000_000n; // $100.00
      const pCurrent = 108_000_000n; // $108.00 (+8%)
      const delta = calcBpsDelta(pCurrent, pBase);
      expect(delta).toBe(800n); // 800 bps = 8.00%

      const pDown = 92_000_000n; // $92.00 (-8%)
      expect(calcBpsDelta(pDown, pBase)).toBe(-800n);
    });

    it('calcula retroceso Fibonacci del 38.2% (3820 bps)', () => {
      const basePrice = 100_000_000n; // $100.00
      const peakPrice = 200_000_000n; // $200.00 (impulso de $100)
      const pullback = calcFibonacciPullback(basePrice, peakPrice, 3820n);
      // Impulso = 100_000_000. 38.2% de 100 = 38.20 -> $161.80
      expect(pullback).toBe(161_800_000n);
    });

    it('calcula decaimiento exponencial e^(-lambda*dt) en escala de 10,000 bps', () => {
      // dt = 0 -> factor 10,000 (100%)
      expect(calcExpDecayBps(1500n, 0n)).toBe(10_000n);
      // dt = 2000ms con lambda = 1500 bps (0.15 s^-1): x = 0.30 -> e^-0.30 ≈ 0.7408 (7408 bps)
      const factor2s = calcExpDecayBps(1500n, 2000n);
      expect(factor2s).toBeGreaterThan(7350n);
      expect(factor2s).toBeLessThan(7450n);
    });

    it('calcula distancia de trailing stop exponencial respetando el piso de 60 bps', () => {
      // PnL <= 0: distancia inicial techo = 220 bps
      expect(calcExponentialTrailingStopDistanceBps(0n)).toBe(220n);
      // PnL a 1000 bps (10%): distancia intermedia ≈ 98 bps
      expect(calcExponentialTrailingStopDistanceBps(1000n)).toBe(98n);
      // PnL muy alto (ej. 2000 bps = 20%): la distancia decae hasta el piso duro de 60 bps
      const tightStop = calcExponentialTrailingStopDistanceBps(2000n);
      expect(tightStop).toBe(60n);
    });

    it('calcula cantidades atómicas de tokens con 9 decimales (Solana)', () => {
      const notionalMicro = 10_000_000_000n; // $10,000 USD en micro-USD
      const tokenPriceMicro = 200_000_000n; // $200.00 por SOL
      // Esperado: 50 SOL = 50 * 10^9 lamports = 50,000,000,000 lamports
      const lamports = calcTokenQuantityAtomic(notionalMicro, tokenPriceMicro, 9);
      expect(lamports).toBe(50_000_000_000n);
    });
  });

  describe('Persistencia SQLite WAL y Esquema v2.0 (6 Tablas)', () => {
    let db: NexusDatabase;

    beforeEach(() => {
      db = new NexusDatabase(':memory:');
    });

    it('crea e inicializa las 6 tablas exactas del esquema v2.0 con enteros BigInt seguros', () => {
      const initialCapital = 100_000_000_000n; // $100,000 USD
      db.initRiskGuardianState(initialCapital);

      const state = db.getRiskGuardianState();
      expect(state.id).toBe(1n);
      expect(state.execution_mode).toBe('SHADOW');
      expect(state.base_capital_micro).toBe(initialCapital);
      expect(typeof state.base_capital_micro).toBe('bigint');
      expect(state.open_positions_count).toBe(0n);

      // Verifica presencia de las 6 tablas en sqlite_master
      const rawDb = db.getRawDb();
      const tables = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
      const tableNames = tables.map(t => t.name);

      expect(tableNames).toContain('risk_guardian_state');
      expect(tableNames).toContain('sentinel_wallets_pool');
      expect(tableNames).toContain('sentinel_confluence_clusters');
      expect(tableNames).toContain('catalyst_news_events');
      expect(tableNames).toContain('unified_positions_ledger');
      expect(tableNames).toContain('cold_wallet_sweeps');
      db.close();
    });
  });

  describe('RingBuffer L2 (Ventana 15m y Microestructura)', () => {
    it('obtiene el precio ancla P_mid(t0 - 500ms) y detecta drift de 15 minutos', () => {
      const ringBuffer = new InstrumentRingBuffer(100);
      const t0 = 1_000_000n;

      // Tick hace 15m (t0 - 900,000ms): $100.00
      ringBuffer.push({
        timestampMs: t0 - 900_000n,
        midPriceMicro: 100_000_000n,
        bestBidMicro: 99_990_000n,
        bestAskMicro: 100_010_000n,
        bids: [{ priceMicro: 99_990_000n, quantityAtomic: 1000n }],
        asks: [{ priceMicro: 100_010_000n, quantityAtomic: 1000n }],
        takerBuyVolMicro: 0n,
        takerSellVolMicro: 0n
      });

      // Tick en t0 - 500ms (P_anchor): $105.00
      ringBuffer.push({
        timestampMs: t0 - 500n,
        midPriceMicro: 105_000_000n,
        bestBidMicro: 104_990_000n,
        bestAskMicro: 105_010_000n,
        bids: [{ priceMicro: 104_990_000n, quantityAtomic: 1500n }],
        asks: [{ priceMicro: 105_010_000n, quantityAtomic: 1000n }],
        takerBuyVolMicro: 50_000_000n,
        takerSellVolMicro: 10_000_000n
      });

      // Tick en t0 (noticia publicada): $106.00
      ringBuffer.push({
        timestampMs: t0,
        midPriceMicro: 106_000_000n,
        bestBidMicro: 105_990_000n,
        bestAskMicro: 106_010_000n,
        bids: [{ priceMicro: 105_990_000n, quantityAtomic: 2000n }],
        asks: [{ priceMicro: 106_010_000n, quantityAtomic: 800n }],
        takerBuyVolMicro: 80_000_000n,
        takerSellVolMicro: 10_000_000n
      });

      const pAnchor = ringBuffer.getAnchorPrice(t0);
      expect(pAnchor).toBe(105_000_000n);

      // Drift 15m: de $100 a $105 = +5.00% = +500 bps
      const drift = ringBuffer.get15mDriftBps(t0);
      expect(drift).toBe(500n);

      // Microestructura OBI alcista (más bids que asks)
      const obi = ringBuffer.getOrderBookImbalanceBps(10);
      expect(obi).toBeGreaterThan(5000n);
    });
  });

  describe('Risk Guardian (Supervisor Atómico de Riesgo)', () => {
    let db: NexusDatabase;
    let guardian: RiskGuardian;
    const baseCapital = 100_000_000_000n; // $100,000 USD

    beforeEach(() => {
      db = new NexusDatabase(':memory:');
      db.initRiskGuardianState(baseCapital);
      guardian = new RiskGuardian(db);
    });

    it('rechaza órdenes desnudas sin stopLoss o con cancelAllAfter inválido', () => {
      // Orden desnuda (sin stopLoss)
      const nakedOrder: OrderIntent = {
        orderId: 'ORD_01',
        engineOrigin: 'CATALYST_NEWS',
        instrumentTicker: 'SOL/USD',
        side: 1,
        notionalMicro: 5_000_000_000n,
        stopLossMicro: 0n, // DESNUDA
        cancelAllAfterMs: 5000
      };
      const res1 = guardian.validateOrderIntent(nakedOrder);
      expect(res1.approved).toBe(false);
      expect(res1.rejectReason).toContain('REJECTED_NAKED_ORDER');

      // Orden con Dead-Man switch incorrecto
      const badDmsOrder: OrderIntent = {
        ...nakedOrder,
        stopLossMicro: 190_000_000n,
        cancelAllAfterMs: 10000 // Invalido (debe ser 5000)
      };
      const res2 = guardian.validateOrderIntent(badDmsOrder);
      expect(res2.approved).toBe(false);
      expect(res2.rejectReason).toContain('REJECTED_DEAD_MANS_SWITCH');
    });

    it('hace cumplir el límite estricto de máximo 3 posiciones simultáneas', () => {
      const validOrder = (id: string): OrderIntent => ({
        orderId: id,
        engineOrigin: 'SENTINEL_ONCHAIN',
        instrumentTicker: 'TOKEN_XYZ',
        side: 1,
        notionalMicro: 5_000_000_000n, // $5,000 c/u (5% del capital)
        stopLossMicro: 90_000_000n,
        cancelAllAfterMs: 5000
      });

      // 1ra orden: aprobada
      expect(guardian.validateOrderIntent(validOrder('1')).approved).toBe(true);
      guardian.recordPositionOpened(5_000_000_000n);

      // 2da orden: aprobada
      expect(guardian.validateOrderIntent(validOrder('2')).approved).toBe(true);
      guardian.recordPositionOpened(5_000_000_000n);

      // 3ra orden: aprobada
      expect(guardian.validateOrderIntent(validOrder('3')).approved).toBe(true);
      guardian.recordPositionOpened(5_000_000_000n);

      // 4ta orden: RECHAZADA por límite de 3 posiciones
      const res4 = guardian.validateOrderIntent(validOrder('4'));
      expect(res4.approved).toBe(false);
      expect(res4.rejectReason).toContain('EXCEEDED_MAX_POSITIONS');
    });

    it('bloquea órdenes que excedan la exposición máxima de 3000 bps (30%)', () => {
      // 30% de 100,000 USD = 30,000 USD = 30,000,000,000 uUSD
      const hugeOrder: OrderIntent = {
        orderId: 'ORD_HUGE',
        engineOrigin: 'CATALYST_NEWS',
        instrumentTicker: 'BTC/USD',
        side: 1,
        notionalMicro: 35_000_000_000n, // 35% -> Excede el 30%
        stopLossMicro: 60_000_000_000n,
        cancelAllAfterMs: 5000
      };

      const res = guardian.validateOrderIntent(hugeOrder);
      expect(res.approved).toBe(false);
      expect(res.rejectReason).toContain('EXCEEDED_MAX_EXPOSURE');
    });

    it('dispara el Circuit Breaker si las pérdidas diarias alcanzan o superan -400 bps (-4.0%)', () => {
      guardian.recordPositionOpened(10_000_000_000n);

      // Pérdida de $4,500 USD (-4.5% del capital base de $100k) -> menor a -400 bps (-$4,000)
      guardian.recordPositionClosed(10_000_000_000n, -4_500_000_000n);

      const state = db.getRiskGuardianState();
      expect(state.circuit_breaker_until_ms).toBeGreaterThan(BigInt(Date.now()));
      expect(state.execution_mode).toBe('SHADOW');

      // Nueva orden debe ser rechazada de inmediato por el Circuit Breaker
      const newOrder: OrderIntent = {
        orderId: 'ORD_AFTER_CB',
        engineOrigin: 'SENTINEL_ONCHAIN',
        instrumentTicker: 'SOL/USD',
        side: 1,
        notionalMicro: 1_000_000_000n,
        stopLossMicro: 90_000_000n,
        cancelAllAfterMs: 5000
      };
      const res = guardian.validateOrderIntent(newOrder);
      expect(res.approved).toBe(false);
      expect(res.rejectReason).toContain('CIRCUIT_BREAKER_ACTIVE');
    });

    it('ejecuta Auto-Sweep a Cold Wallet al superar +2500 bps (+25.0%) sobre High-Water Mark', () => {
      guardian.recordPositionOpened(20_000_000_000n);

      // Ganancia de $26,000 USD (+26% sobre el HWM de $100,000)
      guardian.recordPositionClosed(20_000_000_000n, 26_000_000_000n);

      // Se debió registrar un Auto-Sweep en la tabla cold_wallet_sweeps
      const rawDb = db.getRawDb();
      const sweeps = rawDb.prepare('SELECT * FROM cold_wallet_sweeps').all() as any[];
      expect(sweeps.length).toBe(1);
      expect(sweeps[0].swept_amount_micro).toBe(26_000_000_000n);
      expect(sweeps[0].destination_address).toBe('So11111111111111111111111111111111111111112');

      // La equidad post-sweep vuelve al HWM
      const statePost = db.getRiskGuardianState();
      expect(statePost.current_equity_micro).toBe(100_000_000_000n);
      expect(statePost.high_water_mark_micro).toBe(100_000_000_000n);
    });

    it('el Kill-Switch congela el sistema y cierra posiciones abiertas', () => {
      guardian.recordPositionOpened(10_000_000_000n);
      guardian.executeKillSwitch();

      const state = db.getRiskGuardianState();
      expect(state.execution_mode).toBe('SHADOW');
      expect(state.open_positions_count).toBe(0n);
      expect(state.open_exposure_micro).toBe(0n);
      expect(state.circuit_breaker_until_ms).toBeGreaterThan(BigInt(Date.now()));
    });
  });
});
