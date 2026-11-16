import { describe, it, expect, beforeEach } from 'vitest';
import { L2ShadowSimulator, ShadowOrderRequest } from '../src/core/l2_shadow_simulator.js';
import { NexusDatabase } from '../src/core/db_sqlite_wal.js';
import { L2Snapshot } from '../src/core/ring_buffer_l2.js';

describe('FASE 4: L2 Shadow Simulator (Paridad Estricta, 35ms RTT & Barrido L2)', () => {
  let db: NexusDatabase;
  let simulator: L2ShadowSimulator;
  const t0 = 1_000_000n;

  beforeEach(() => {
    db = new NexusDatabase(':memory:');
    db.initRiskGuardianState(100_000_000_000n);
    simulator = new L2ShadowSimulator(db);
  });

  it('aplica 35ms de latencia RTT y ejecuta barrido L2 nivel a nivel calculando VWAP y comisiones taker', () => {
    // Libro L2 con 3 niveles de Asks
    // Nivel 1: 10 SOL a $200.00 (Capacidad $2,000 USD)
    // Nivel 2: 20 SOL a $201.00 (Capacidad $4,020 USD)
    // Nivel 3: 50 SOL a $205.00 (Capacidad $10,250 USD)
    const snapshot: L2Snapshot = {
      timestampMs: t0 + 35n,
      midPriceMicro: 199_900_000n,
      bestBidMicro: 199_800_000n,
      bestAskMicro: 200_000_000n,
      bids: [{ priceMicro: 199_800_000n, quantityAtomic: 50_000_000_000n }],
      asks: [
        { priceMicro: 200_000_000n, quantityAtomic: 10_000_000_000n }, // $200.00 (10 SOL)
        { priceMicro: 201_000_000n, quantityAtomic: 20_000_000_000n }, // $201.00 (20 SOL)
        { priceMicro: 205_000_000n, quantityAtomic: 50_000_000_000n }  // $205.00 (50 SOL)
      ],
      takerBuyVolMicro: 100_000_000n,
      takerSellVolMicro: 50_000_000n
    };

    // Orden de compra por $5,000 USD con tope duro Pcap = $202.00 (202_000_000 uUSD)
    const orderReq: ShadowOrderRequest = {
      orderId: 'SIM_ORD_01',
      engineOrigin: 'CATALYST_NEWS',
      signalRefId: 'CAT_SIG_01',
      ticker: 'SOL/USD',
      side: 1, // Buy
      phaseAllocationBps: 10000n,
      notionalMicroUsd: 5_000_000_000n, // $5,000 USD
      limitPriceCapMicroUsd: 202_000_000n, // Pcap = $202.00
      stopLossMicroUsd: 199_000_000n,
      cancelAllAfterMs: 5000,
      submittedAtMs: t0
    };

    const res = simulator.simulateSweep(orderReq, snapshot);

    // 1. Debe haber aplicado 35ms de retraso
    expect(res.effectiveLatencyMs).toBe(35);
    expect(res.executedAtMs).toBe(t0 + 35n);

    // 2. Debe haber consumido nivel 1 ($2,000) y parte del nivel 2 ($3,000 restantes)
    expect(res.status).toBe('FILLED');
    expect(res.filledNotionalMicroUsd).toBe(5_000_000_000n);
    expect(res.unfilledNotionalMicroUsd).toBe(0n);

    // 3. VWAP debe estar entre $200.00 y $201.00
    expect(res.vwapPriceMicroUsd).toBeGreaterThanOrEqual(200_000_000n);
    expect(res.vwapPriceMicroUsd).toBeLessThanOrEqual(201_000_000n);

    // 4. Comisión Taker descontada (7 bps = 0.07% de $5,000 = $3.50 = 3_500_000 uUSD)
    expect(res.takerFeePaidMicroUsd).toBe(3_500_000n);

    // 5. Debe persistirse en unified_positions_ledger
    const rawDb = db.getRawDb();
    const ledgerRow = rawDb.prepare("SELECT * FROM unified_positions_ledger WHERE position_id = 'POS_SIM_ORD_01'").get() as any;
    expect(ledgerRow).toBeDefined();
    expect(ledgerRow.instrument_ticker).toBe('SOL/USD');
    expect(ledgerRow.execution_mode).toBe('SHADOW');
    expect(ledgerRow.entry_price_micro).toBe(res.vwapPriceMicroUsd);
  });

  it('cancela en el acto remanente no llenado si el precio supera el tope Pcap', () => {
    // Solo $2,000 de liquidez por debajo del Pcap ($202.00)
    const snapshot: L2Snapshot = {
      timestampMs: t0 + 35n,
      midPriceMicro: 200_000_000n,
      bestBidMicro: 199_900_000n,
      bestAskMicro: 200_000_000n,
      asks: [
        { priceMicro: 200_000_000n, quantityAtomic: 10_000_000_000n }, // $200.00 (10 SOL = $2,000)
        { priceMicro: 204_000_000n, quantityAtomic: 50_000_000_000n }  // $204.00 > Pcap ($202.00)
      ],
      bids: [],
      takerBuyVolMicro: 0n,
      takerSellVolMicro: 0n
    };

    const orderReq: ShadowOrderRequest = {
      orderId: 'SIM_ORD_PARTIAL',
      engineOrigin: 'CATALYST_NEWS',
      signalRefId: 'CAT_SIG_02',
      ticker: 'SOL/USD',
      side: 1,
      phaseAllocationBps: 10000n,
      notionalMicroUsd: 5_000_000_000n, // $5,000 pedidos
      limitPriceCapMicroUsd: 202_000_000n, // Pcap = $202.00
      stopLossMicroUsd: 199_000_000n,
      cancelAllAfterMs: 5000,
      submittedAtMs: t0
    };

    const res = simulator.simulateSweep(orderReq, snapshot);

    expect(res.status).toBe('PARTIALLY_FILLED');
    expect(res.filledNotionalMicroUsd).toBe(2_000_000_000n); // Solo llenó $2,000
    expect(res.unfilledNotionalMicroUsd).toBe(3_000_000_000n); // Canceló $3,000
  });

  it('rechaza orden completa si el mejor Ask ya supera el precio tope Pcap', () => {
    const snapshot: L2Snapshot = {
      timestampMs: t0 + 35n,
      midPriceMicro: 203_000_000n,
      bestBidMicro: 202_500_000n,
      bestAskMicro: 203_000_000n, // Mejor ask = $203.00
      asks: [
        { priceMicro: 203_000_000n, quantityAtomic: 10_000_000_000n }
      ],
      bids: [],
      takerBuyVolMicro: 0n,
      takerSellVolMicro: 0n
    };

    const orderReq: ShadowOrderRequest = {
      orderId: 'SIM_ORD_REJECTED',
      engineOrigin: 'CATALYST_NEWS',
      signalRefId: 'CAT_SIG_03',
      ticker: 'SOL/USD',
      side: 1,
      phaseAllocationBps: 10000n,
      notionalMicroUsd: 5_000_000_000n,
      limitPriceCapMicroUsd: 202_000_000n, // Pcap = $202.00 < $203.00
      stopLossMicroUsd: 199_000_000n,
      cancelAllAfterMs: 5000,
      submittedAtMs: t0
    };

    const res = simulator.simulateSweep(orderReq, snapshot);
    expect(res.status).toBe('REJECTED_PRICE_EXCEEDS_CAP');
    expect(res.filledNotionalMicroUsd).toBe(0n);
  });
});
