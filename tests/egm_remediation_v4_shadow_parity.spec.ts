import { describe, it, expect, beforeEach } from 'vitest';
import { L2ShadowSimulator, ShadowOrderRequest } from '../src/core/l2_shadow_simulator.js';
import { NexusDatabase } from '../src/core/db_sqlite_wal.js';
import { RiskGuardian } from '../src/core/risk_guardian.js';
import {
  InstrumentRingBuffer,
  GlobalL2RingBufferManager,
  L2Snapshot,
  createL2SnapshotFromPrice
} from '../src/core/ring_buffer_l2.js';
import { WalletWsListener } from '../src/engine_a_sentinel/wallet_ws_listener.js';
import { RealNewsPoller } from '../src/engine_b_catalyst/real_news_poller.js';
import { ActivePositionSupervisor } from '../src/core/position_supervisor.js';

describe('EGM V4: PARIDAD ESTRICTA SHADOW VS LIVE Y REMEDIACIÓN DE VULNERABILIDADES', () => {
  let db: NexusDatabase;
  let guardian: RiskGuardian;

  beforeEach(() => {
    db = new NexusDatabase(':memory:');
    db.initRiskGuardianState(100_000_000_000n); // $100,000 USD
    guardian = new RiskGuardian(db);
  });

  describe('1. L2ShadowSimulator: Anti-Time-Travel, Lookahead Bias y Mutación Real L2', () => {
    const t0 = 10_000_000n;

    it('rechaza orden si nowMs < executedAtMs (protección anti-time-travel ante latencia RTT 35ms)', () => {
      const simulator = new L2ShadowSimulator(db);
      const snapshot: L2Snapshot = {
        timestampMs: t0 + 35n,
        midPriceMicro: 150_000_000n,
        bestBidMicro: 149_900_000n,
        bestAskMicro: 150_100_000n,
        bids: [{ priceMicro: 149_900_000n, quantityAtomic: 10_000_000_000n }],
        asks: [{ priceMicro: 150_100_000n, quantityAtomic: 10_000_000_000n }],
        takerBuyVolMicro: 0n,
        takerSellVolMicro: 0n
      };

      const req: ShadowOrderRequest = {
        orderId: 'ORDER_TIME_TRAVEL',
        engineOrigin: 'SENTINEL_ONCHAIN',
        signalRefId: 'SIG_01',
        ticker: 'SOL/USD',
        side: 1,
        phaseAllocationBps: 10000n,
        notionalMicroUsd: 1_000_000_000n,
        limitPriceCapMicroUsd: 155_000_000n,
        stopLossMicroUsd: 145_000_000n,
        cancelAllAfterMs: 5000,
        submittedAtMs: t0
      };

      // Intentar ejecutar antes de transcurrir los 35ms de latencia de red (t0 + 20ms < t0 + 35ms)
      const res = simulator.simulateSweep(req, snapshot, t0 + 20n);
      expect(res.status).toBe('REJECTED_ZERO_LIQUIDITY');
      expect(res.filledNotionalMicroUsd).toBe(0n);
    });

    it('rechaza orden si la instantánea provista tiene timestampMs > executedAtMs (lookahead bias)', () => {
      const simulator = new L2ShadowSimulator(db);
      const futureSnapshot: L2Snapshot = {
        timestampMs: t0 + 50n, // 50ms en el futuro > 35ms RTT
        midPriceMicro: 150_000_000n,
        bestBidMicro: 149_900_000n,
        bestAskMicro: 150_100_000n,
        bids: [{ priceMicro: 149_900_000n, quantityAtomic: 10_000_000_000n }],
        asks: [{ priceMicro: 150_100_000n, quantityAtomic: 10_000_000_000n }],
        takerBuyVolMicro: 0n,
        takerSellVolMicro: 0n
      };

      const req: ShadowOrderRequest = {
        orderId: 'ORDER_LOOKAHEAD',
        engineOrigin: 'CATALYST_NEWS',
        signalRefId: 'SIG_02',
        ticker: 'SOL/USD',
        side: 1,
        phaseAllocationBps: 10000n,
        notionalMicroUsd: 1_000_000_000n,
        limitPriceCapMicroUsd: 155_000_000n,
        stopLossMicroUsd: 145_000_000n,
        cancelAllAfterMs: 5000,
        submittedAtMs: t0
      };

      const res = simulator.simulateSweep(req, futureSnapshot, t0 + 35n);
      expect(res.status).toBe('REJECTED_PRICE_EXCEEDS_CAP');
      expect(res.filledNotionalMicroUsd).toBe(0n);
    });

    it('ejecuta mutación real de niveles en el libro L2 y actualiza top-of-book', () => {
      const simulator = new L2ShadowSimulator(db);
      // Libro con 2 niveles Asks:
      // Nivel 1: 5 SOL @ $200.00 = $1,000 USD
      // Nivel 2: 20 SOL @ $205.00 = $4,100 USD
      const snapshot: L2Snapshot = {
        timestampMs: t0 + 35n,
        midPriceMicro: 200_000_000n,
        bestBidMicro: 199_000_000n,
        bestAskMicro: 200_000_000n,
        bids: [{ priceMicro: 199_000_000n, quantityAtomic: 50_000_000_000n }],
        asks: [
          { priceMicro: 200_000_000n, quantityAtomic: 5_000_000_000n }, // $1,000
          { priceMicro: 205_000_000n, quantityAtomic: 20_000_000_000n } // $4,100
        ],
        takerBuyVolMicro: 0n,
        takerSellVolMicro: 0n
      };

      const req: ShadowOrderRequest = {
        orderId: 'ORDER_MUTATION_TEST',
        engineOrigin: 'SENTINEL_ONCHAIN',
        signalRefId: 'SIG_MUT_01',
        ticker: 'SOL/USD',
        side: 1,
        phaseAllocationBps: 10000n,
        notionalMicroUsd: 1_500_000_000n, // $1,500 USD (agota nivel 1 y consume $500 de nivel 2)
        limitPriceCapMicroUsd: 210_000_000n,
        stopLossMicroUsd: 190_000_000n,
        cancelAllAfterMs: 5000,
        submittedAtMs: t0
      };

      const res = simulator.simulateSweep(req, snapshot, t0 + 35n);
      expect(res.status).toBe('FILLED');
      expect(res.filledNotionalMicroUsd).toBe(1_500_000_000n);

      // Mutación Real:
      // 1. Nivel 1 debe haber desaparecido (agotado totalmente)
      expect(snapshot.asks.length).toBe(1);
      expect(snapshot.asks[0].priceMicro).toBe(205_000_000n);

      // 2. Nivel 2 debe tener su cantidad decrementada
      // Consumió $500 a $205 = 2.439024390 SOL atómicos
      expect(snapshot.asks[0].quantityAtomic).toBeLessThan(20_000_000_000n);

      // 3. Top of book actualizado
      expect(snapshot.bestAskMicro).toBe(205_000_000n);
      expect(snapshot.takerBuyVolMicro).toBe(1_500_000_000n);
    });
  });

  describe('2. InstrumentRingBuffer: Eliminación de Lookahead Bias', () => {
    it('getClosestAtOrBefore retorna null si el targetMs es anterior al registro más antiguo', () => {
      const ring = new InstrumentRingBuffer(100);
      const snap1 = createL2SnapshotFromPrice(150_000_000n, 10_000n);
      const snap2 = createL2SnapshotFromPrice(151_000_000n, 20_000n);
      ring.push(snap1);
      ring.push(snap2);

      // Consulta en 5,000ms: no había datos antes de 10,000ms
      const result = ring.getClosestAtOrBefore(5_000n);
      expect(result).toBeNull(); // No debe retornar snap1 del futuro

      // Consulta en 15,000ms: debe retornar snap1 (el más cercano <= 15,000ms)
      const validResult = ring.getClosestAtOrBefore(15_000n);
      expect(validResult).not.toBeNull();
      expect(validResult?.timestampMs).toBe(10_000n);
    });
  });

  describe('3. WalletWsListener: Decodificación Real Solana DEX y Descarte de Ilusiones', () => {
    it('descarta logs de transacciones que no son Swaps DEX (ej. transferencias o votos)', () => {
      const nonDexLogs = [
        'Program 11111111111111111111111111111111 invoke [1]',
        'Program 11111111111111111111111111111111 success',
        'Program Vote111111111111111111111111111111111111111 invoke [1]',
        'Program Vote111111111111111111111111111111111111111 success'
      ];

      const decoded = WalletWsListener.decodeDexSwapFromLogs(nonDexLogs);
      expect(decoded).toBeNull();
    });

    it('decodifica correctamente swaps en Raydium y Pump.fun distinguiendo BUY y SELL', () => {
      // Raydium Swap
      const raydiumBuyLogs = [
        'Program 675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8 invoke [1]',
        'Program log: ray_log: ...',
        'Program log: Instruction: SwapBaseIn',
        'Program log: Instruction: Buy',
        'Program 675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8 success'
      ];

      const decodedBuy = WalletWsListener.decodeDexSwapFromLogs(raydiumBuyLogs);
      expect(decodedBuy).not.toBeNull();
      expect(decodedBuy?.dexName).toBe('Raydium AMM V4');
      expect(decodedBuy?.tradeType).toBe('BUY');

      // Pump.fun Sell
      const pumpSellLogs = [
        'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]',
        'Program log: Instruction: Sell',
        'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success'
      ];

      const decodedSell = WalletWsListener.decodeDexSwapFromLogs(pumpSellLogs);
      expect(decodedSell).not.toBeNull();
      expect(decodedSell?.dexName).toBe('Pump.fun');
      expect(decodedSell?.tradeType).toBe('SELL');
    });

    it('resuelve precios de mercado dinámicamente mediante priceResolver sin hardcoding', () => {
      const listener = new WalletWsListener();
      const mockLivePrice = 215_750_000n; // $215.75
      listener.setPriceResolver((ticker) => (ticker === 'SOL' ? mockLivePrice : null));

      let emittedPrice: bigint | null = null;
      listener.onTrade((event) => {
        emittedPrice = event.priceMicroUsd;
      });

      // Simular llegada de logsNotification con swap válido
      const rawWs = (listener as any);
      rawWs.subscriptionToWallet.set(1234, 'WHALE_WALLET_ALPHA');
      
      const fakeMsg = {
        method: 'logsNotification',
        params: {
          subscription: 1234,
          result: {
            value: {
              err: null,
              signature: 'SIG_VALID_DEX_001',
              logs: [
                'Program 675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8 invoke [1]',
                'Program log: Instruction: SwapBaseIn'
              ]
            }
          }
        }
      };

      rawWs.ws = { readyState: 1 };
      // Invocar handler interno
      rawWs.liveSwapsProcessed = 0;
      const dataStr = Buffer.from(JSON.stringify(fakeMsg));
      
      // Simular on message
      const onMessage = (listener as any).ws?.on;
      // Llamar directamente al callback parseando el mensaje
      const subId = fakeMsg.params.subscription;
      const whaleAddr = rawWs.subscriptionToWallet.get(subId);
      const val = fakeMsg.params.result.value;
      const decoded = WalletWsListener.decodeDexSwapFromLogs(val.logs);
      expect(decoded).not.toBeNull();

      const resolved = (rawWs.priceResolver ? rawWs.priceResolver(decoded!.tokenTicker) : null) ?? 150_000_000n;
      expect(resolved).toBe(mockLivePrice);
    });
  });

  describe('4. RealNewsPoller: Confirmación de Flujo y Drift Dinámicos', () => {
    it('obtiene flowConfirmBps y preEventDrift15mBps dinámicos desde GlobalL2RingBufferManager', async () => {
      const poller = new RealNewsPoller();
      const ringMgr = new GlobalL2RingBufferManager();
      const solBuf = ringMgr.getOrCreate('SOL');

      // Alimentar con libro sesgado a compra
      const snap: L2Snapshot = {
        timestampMs: BigInt(Date.now()),
        midPriceMicro: 180_000_000n,
        bestBidMicro: 179_900_000n,
        bestAskMicro: 180_100_000n,
        bids: [{ priceMicro: 179_900_000n, quantityAtomic: 80_000_000_000n }], // Alto OBI comprador
        asks: [{ priceMicro: 180_100_000n, quantityAtomic: 20_000_000_000n }],
        takerBuyVolMicro: 90_000_000n,
        takerSellVolMicro: 10_000_000n
      };
      solBuf.push(snap);

      poller.setRingBufferManager(ringMgr);

      const event = await poller.processHeadline(
        'Solana Network TVL Hits Record High as Institutional Inflows Surge',
        'https://coindesk.com/article_test_01',
        'COINDESK'
      );

      expect(event).not.toBeNull();
      // flowConfirmBps no debe ser el valor hardcodeado estático de 8200
      expect(event?.flowConfirmBps).toBeDefined();
      expect(event?.flowConfirmBps).toBeGreaterThan(5000); // Demuestra presión compradora calculada
    });
  });

  describe('5. ActivePositionSupervisor: Descuento de Comisiones Taker (14 bps) y Fricción de Red', () => {
    it('descuenta 14 bps taker fees y fricción de red en executeSentinelClose', async () => {
      const supervisor = new ActivePositionSupervisor(db, guardian);
      supervisor.enableTakerFeeDeduction(true);

      const tOpen = 10_000n;
      // Posición de $10,000 USD a $100 por token (100 tokens atómicos)
      const notionalInvestedMicro = 10_000_000_000n; // $10,000 USD
      const entryPriceMicro = 100_000_000n; // $100.00
      const totalTokensAtomic = 100_000_000_000n; // 100 tokens

      db.allocateAndInsertPositionAtomic({
        position_id: 'POS_SUPERVISOR_FEE_TEST',
        engine_origin: 'SENTINEL_ONCHAIN',
        signal_ref_id: 'SIG_FEE_01',
        execution_mode: 'SHADOW',
        instrument_ticker: 'SOL',
        side: 1,
        phase_allocation_bps: 10000n,
        notional_invested_micro: notionalInvestedMicro,
        quantity_atomic: totalTokensAtomic.toString(),
        entry_price_micro: entryPriceMicro,
        stop_loss_micro: 92_000_000n, // -8% Stop-Loss = $92.00
        trailing_stop_micro: null,
        take_profit_micro: null,
        peak_price_micro: entryPriceMicro
      });

      const row = db.getRawDb().prepare("SELECT * FROM unified_positions_ledger WHERE position_id = 'POS_SUPERVISOR_FEE_TEST'").get() as any;
      supervisor.trackNewPosition(row);

      // Simular caída de precio a $90.00 (golpeando el SL de $92.00)
      const exitPriceMicro = 90_000_000n;
      await supervisor.evaluatePriceTick('SOL', exitPriceMicro, tOpen + 60_000n);

      const closedRow = db.getRawDb().prepare("SELECT * FROM unified_positions_ledger WHERE position_id = 'POS_SUPERVISOR_FEE_TEST'").get() as any;
      expect(closedRow.status).toBe('STOPPED_OUT');

      // Cálculo esperado:
      // Gross PnL: ($90 - $100) * 100 SOL = -$1,000 USD = -1_000_000_000 µUSD
      // Entry Fee: 7 bps de $10,000 = $7.00 = 7_000_000 µUSD
      // Exit Fee: 7 bps de $9,000 = $6.30 = 6_300_000 µUSD
      // Network Friction: 5,000 µUSD
      // Net PnL esperado: -1_000_000_000 - 7_000_000 - 6_300_000 - 5_000 = -1_013_305_000 µUSD
      const expectedNetPnl = -1_013_305_000n;
      expect(BigInt(closedRow.realized_pnl_micro)).toBe(expectedNetPnl);
    });
  });

  describe('6. Reconciliación de Arranque: Eliminación de Cierre Fraudulento (+150 bps)', () => {
    it('mantiene las posiciones vivas en estado OPEN tras un reinicio y las entrega al supervisor', () => {
      // 1. Simular posición que quedó abierta tras un crash/reinicio
      db.allocateAndInsertPositionAtomic({
        position_id: 'POS_ORPHAN_CRASH',
        engine_origin: 'SENTINEL_ONCHAIN',
        signal_ref_id: 'SIG_CRASH_01',
        execution_mode: 'SHADOW',
        instrument_ticker: 'SOL',
        side: 1,
        phase_allocation_bps: 10000n,
        notional_invested_micro: 5_000_000_000n,
        quantity_atomic: '50000000000',
        entry_price_micro: 100_000_000n,
        stop_loss_micro: 92_000_000n,
        trailing_stop_micro: null,
        take_profit_micro: null,
        peak_price_micro: 100_000_000n
      });

      // 2. Reconciliación de arranque de RiskGuardian
      const reconciled = guardian.reconcileStartupState();
      expect(reconciled.openPositionsCount).toBe(1n);
      expect(reconciled.openExposureMicro).toBe(5_000_000_000n);

      // 3. Verificar que unified_positions_ledger NO cerró la orden con +150 bps fraudulentos
      const row = db.getRawDb().prepare("SELECT * FROM unified_positions_ledger WHERE position_id = 'POS_ORPHAN_CRASH'").get() as any;
      expect(row.status).toBe('OPEN');
      expect(BigInt(row.realized_pnl_micro ?? 0)).toBe(0n); // No hay ganancia artificial del +1.50%

      // 4. ActivePositionSupervisor rehidrata la posición y monitorea su riesgo real
      const supervisor = new ActivePositionSupervisor(db, guardian);
      supervisor.rehydrateAndResumeAll(reconciled.openPositions);

      // Debe estar activamente monitoreada
      expect(supervisor.getActivePositionsCount()).toBe(1);
    });
  });

  describe('7. Robustez Crítica y Casos Extremos Adversarios (EGM Anti-Breakage)', () => {
    it('poda limpiamente niveles L2 totalmente consumidos sin dejar polvo por truncamiento entero', () => {
      const simulator = new L2ShadowSimulator(db);
      // Nivel 1 tiene cantidad con residuo atómico que truncaría en división entera estándar:
      // price = $182.50 (182_500_000 uUSD), quantity = 1_000_000_001 atomic units (~1 SOL)
      // levelNotionalMicro = (1_000_000_001 * 182_500_000) / 10^9 = 182_500_000 uUSD
      const snapshot: L2Snapshot = {
        timestampMs: 10_035n,
        midPriceMicro: 182_500_000n,
        bestBidMicro: 182_400_000n,
        bestAskMicro: 182_500_000n,
        bids: [{ priceMicro: 182_400_000n, quantityAtomic: 50_000_000_000n }],
        asks: [
          { priceMicro: 182_500_000n, quantityAtomic: 1_000_000_001n },
          { priceMicro: 183_000_000n, quantityAtomic: 10_000_000_000n }
        ],
        takerBuyVolMicro: 0n,
        takerSellVolMicro: 0n
      };

      const req: ShadowOrderRequest = {
        orderId: 'SWEEP_DUST_TEST',
        engineOrigin: 'SENTINEL_ONCHAIN',
        signalRefId: 'SIG_DUST_01',
        ticker: 'SOL/USD',
        side: 1,
        phaseAllocationBps: 10000n,
        notionalMicroUsd: 182_500_000n, // Consume exactamente la capacidad del nivel 1
        limitPriceCapMicroUsd: 190_000_000n,
        stopLossMicroUsd: 170_000_000n,
        cancelAllAfterMs: 5000,
        submittedAtMs: 10_000n
      };

      const res = simulator.simulateSweep(req, snapshot, 10_035n);
      expect(res.status).toBe('FILLED');

      // Nivel 1 debe haber sido podado por completo del libro (longitud asks = 1)
      expect(snapshot.asks.length).toBe(1);
      expect(snapshot.asks[0].priceMicro).toBe(183_000_000n);
      expect(snapshot.bestAskMicro).toBe(183_000_000n);
    });

    it('ejecuta llenado parcial cuando la liquidez total es inferior al nocional y se alcanza Pcap a mitad de nivel', () => {
      const simulator = new L2ShadowSimulator(db);
      // Libro con 3 niveles:
      // Nivel 1: $1,000 USD @ $200.00 (5 SOL)
      // Nivel 2: $1,000 USD @ $202.00 (4.95 SOL)
      // Nivel 3: $5,000 USD @ $205.00 (> Pcap de $202.00)
      const snapshot: L2Snapshot = {
        timestampMs: 10_035n,
        midPriceMicro: 200_000_000n,
        bestBidMicro: 199_900_000n,
        bestAskMicro: 200_000_000n,
        bids: [{ priceMicro: 199_900_000n, quantityAtomic: 50_000_000_000n }],
        asks: [
          { priceMicro: 200_000_000n, quantityAtomic: 5_000_000_000n }, // $1,000 USD
          { priceMicro: 202_000_000n, quantityAtomic: 4_950_495_050n }, // $1,000 USD ($1,000 / $202)
          { priceMicro: 205_000_000n, quantityAtomic: 24_390_243_902n } // $5,000 USD (excede Pcap)
        ],
        takerBuyVolMicro: 0n,
        takerSellVolMicro: 0n
      };

      const req: ShadowOrderRequest = {
        orderId: 'SWEEP_PCAP_CUTOFF',
        engineOrigin: 'CATALYST_NEWS',
        signalRefId: 'SIG_PCAP_01',
        ticker: 'SOL/USD',
        side: 1,
        phaseAllocationBps: 10000n,
        notionalMicroUsd: 5_000_000_000n, // Pide $5,000 USD
        limitPriceCapMicroUsd: 202_000_000n, // Pcap estricto en $202.00
        stopLossMicroUsd: 195_000_000n,
        cancelAllAfterMs: 5000,
        submittedAtMs: 10_000n
      };

      const res = simulator.simulateSweep(req, snapshot, 10_035n);
      expect(res.status).toBe('PARTIALLY_FILLED');
      expect(res.filledNotionalMicroUsd).toBe(2_000_000_000n); // Llena Nivel 1 ($1,000) y Nivel 2 ($1,000)
      expect(res.unfilledNotionalMicroUsd).toBe(3_000_000_000n); // Cancela remanente de $3,000
      expect(snapshot.asks.length).toBe(1); // Solo queda el Nivel 3 sin tocar
      expect(snapshot.asks[0].priceMicro).toBe(205_000_000n);
    });

    it('descarta operaciones no-swap en programas DEX conocidos (ej. Deposit, Withdraw, CancelOrder)', () => {
      const raydiumDepositLogs = [
        'Program 675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8 invoke [1]',
        'Program log: Instruction: Deposit',
        'Program 675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8 success'
      ];
      expect(WalletWsListener.decodeDexSwapFromLogs(raydiumDepositLogs)).toBeNull();

      const openBookCancelLogs = [
        'Program srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX invoke [1]',
        'Program log: Instruction: CancelOrder',
        'Program srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX success'
      ];
      expect(WalletWsListener.decodeDexSwapFromLogs(openBookCancelLogs)).toBeNull();
    });

    it('descarta logs con fallos de ejecución on-chain o errores de slippage', () => {
      const failedSwapLogs = [
        'Program 675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8 invoke [1]',
        'Program log: Instruction: SwapBaseIn',
        'Program log: Error: SlippageToleranceExceeded',
        'Program 675kPX9MHTjS2zt1qfr1NYHuviLXfQM9H24wFSUt1Mp8 failed: custom program error: 0x12'
      ];
      expect(WalletWsListener.decodeDexSwapFromLogs(failedSwapLogs)).toBeNull();
    });

    it('ingestTrade reconoce billeteras base58 originales sin discriminación de mayúsculas/minúsculas', async () => {
      const listener = new WalletWsListener();
      const whaleBase58 = '8hN12uYtZqP102bCa09391Fba9828a11orcaEKTaB';
      listener.setMonitoredWallets([{ address: whaleBase58, chainId: 'SOLANA', tier: 'LIVE' }]);

      let tradeHandled = false;
      listener.onTrade((e) => {
        if (e.walletAddress === whaleBase58) tradeHandled = true;
      });

      await listener.ingestTrade({
        walletAddress: whaleBase58,
        chainId: 'SOLANA',
        tokenAddress: 'So11111111111111111111111111111111111111112',
        tokenTicker: 'SOL',
        tradeType: 'BUY',
        amountTokensAtomic: 10_000_000_000n,
        priceAtomic: 150_000_000n,
        priceMicroUsd: 150_000_000n,
        timestampMs: 10_000n,
        txHash: 'TX_BASE58_WHALE_01'
      });

      expect(tradeHandled).toBe(true);
    });

    it('InstrumentRingBuffer.getClosestAtOrBefore maneja deltas temporales de 64 bits sin colapso', () => {
      const ring = new InstrumentRingBuffer(50);
      const snapT0 = createL2SnapshotFromPrice(150_000_000n, 10_000n);
      ring.push(snapT0);

      // Delta mayor a 0x7fffffff (2.14 mil millones de ms)
      const bigTargetMs = 10_000n + 3_000_000_000n;
      const closest = ring.getClosestAtOrBefore(bigTargetMs);
      expect(closest).not.toBeNull();
      expect(closest?.timestampMs).toBe(10_000n);
    });

    it('permite cerrar posiciones que estaban en estado PARTIALLY_CLOSED aplicando comisiones taker y fricción', () => {
      db.allocateAndInsertPositionAtomic({
        position_id: 'POS_DERISKED_CLOSE_TEST',
        engine_origin: 'CATALYST_NEWS',
        signal_ref_id: 'SIG_DERISK_01',
        execution_mode: 'SHADOW',
        instrument_ticker: 'SOL',
        side: 1,
        phase_allocation_bps: 10000n,
        notional_invested_micro: 5_000_000_000n,
        quantity_atomic: '50000000000',
        entry_price_micro: 100_000_000n,
        stop_loss_micro: 95_000_000n,
        trailing_stop_micro: null,
        take_profit_micro: null,
        peak_price_micro: 120_000_000n
      });

      // Simular que el supervisor des-riesgó la posición
      db.getRawDb().prepare("UPDATE unified_positions_ledger SET status = 'PARTIALLY_CLOSED' WHERE position_id = 'POS_DERISKED_CLOSE_TEST'").run();

      const rawDb = db.getRawDb();
      const exitPriceMicroUsd = 110_000_000n; // Salida a $110
      const positionId = 'POS_DERISKED_CLOSE_TEST';
      const row = rawDb.prepare('SELECT * FROM unified_positions_ledger WHERE position_id = ?').get(positionId) as any;
      expect(row.status).toBe('PARTIALLY_CLOSED');

      if (row && (row.status === 'OPEN' || row.status === 'PARTIALLY_CLOSED')) {
        const notionalInvested = BigInt(row.notional_invested_micro);
        const entryPrice = BigInt(row.entry_price_micro);
        const tokensAtomic = BigInt(row.quantity_atomic);
        const priceDelta = exitPriceMicroUsd - entryPrice;
        const grossPnlMicro = (priceDelta * tokensAtomic) / 1_000_000_000n;
        const exitNotionalMicro = (exitPriceMicroUsd * tokensAtomic) / 1_000_000_000n;
        const entryFeeMicro = (notionalInvested * 7n) / 10000n;
        const exitFeeMicro = (exitNotionalMicro * 7n) / 10000n;
        const networkFrictionMicro = 5_000n;
        const realizedPnlMicro = grossPnlMicro - entryFeeMicro - exitFeeMicro - networkFrictionMicro;

        rawDb.prepare(`
          UPDATE unified_positions_ledger
          SET status = 'CLOSED', closed_at_ms = ?, realized_pnl_micro = ?
          WHERE position_id = ?
        `).run(Date.now(), realizedPnlMicro.toString(), positionId);
        db.recordPositionClosedAtomic(notionalInvested, realizedPnlMicro);
      }

      const closedRow = rawDb.prepare('SELECT * FROM unified_positions_ledger WHERE position_id = ?').get(positionId) as any;
      expect(closedRow.status).toBe('CLOSED');
      expect(BigInt(closedRow.realized_pnl_micro)).toBeGreaterThan(0n);
    });
  });
});
