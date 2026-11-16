// tests/v4_sovereign_cashflow.spec.ts
// NEXUS QUANT SUITE v4.0 - SUITE OFICIAL DE VALIDACIÓN "SOVEREIGN CASH-FLOW"

import { describe, it, expect, beforeEach } from 'vitest';
import {
  AdaptiveSentinelExitEngine,
  SentinelPositionState,
  calcBpsDelta,
  applyBpsOffset
} from '../src/engine_a_sentinel/whale_asymmetric_exit.js';
import {
  CatalystVelocityExitEngine,
  CatalystPositionState
} from '../src/engine_b_catalyst/velocity_decay_exit.js';
import {
  VortexLiquidationReversionEngine,
  MarketMicrostructureTick
} from '../src/engine_d_vortex/liquidation_reversion_engine.js';
import {
  KronosAvellanedaMakerEngine,
  KronosMarketState
} from '../src/engine_e_kronos/avellaneda_maker_engine.js';
import { SmartPullbackSniper } from '../src/engine_a_sentinel/smart_pullback_sniper.js';
import { NexusDatabase } from '../src/core/db_sqlite_wal.js';
import { RiskGuardian } from '../src/core/risk_guardian.js';
import { ActivePositionSupervisor } from '../src/core/position_supervisor.js';

describe('NEXUS QUANT SUITE v4.0 - SOVEREIGN CASH-FLOW ARCHITECTURE', () => {
  const t0 = 10_000_000n;

  describe('1. Motor A: Sentinel Dual-Track (Binance Liquid CEX vs Raydium Pure DEX)', () => {
    let engine: AdaptiveSentinelExitEngine;

    beforeEach(() => {
      engine = new AdaptiveSentinelExitEngine();
    });

    const createCexPosition = (): SentinelPositionState => ({
      positionId: 'POS_CEX_01',
      venueTrack: 'BINANCE_LIQUID_CEX',
      openedAtMs: t0,
      entryPriceMicroUsd: 100_000_000n, // $100.00
      peakPriceMicroUsd: 100_000_000n,
      currentStopLossMicroUsd: 98_200_000n, // -1.80% Hard Stop
      initialTokensAtomic: 100_000_000_000n, // 100 tokens
      remainingTokensAtomic: 100_000_000_000n,
      isBreakEvenLocked: false,
      isTp1Executed: false,
      isTp2Executed: false,
      orderflowCvdPositive: true,
    });

    it('Pista CEX: activa Break-Even Neto en +0.65% (+65 bps) asegurando +0.22% neto', () => {
      const pos = createCexPosition();
      // Precio sube a $100.70 (+70 bps > +65 bps)
      const currentPrice = 100_700_000n;
      const decision = engine.evaluateExit(pos, currentPrice, t0 + 60_000n);

      expect(decision.action).toBe('ACTIVATE_BREAKEVEN_GUARD');
      expect(decision.tokensToSellAtomic).toBe(0n);
      expect(pos.isBreakEvenLocked).toBe(true);
      // Stop sube a Entry + 22 bps ($100.22)
      expect(pos.currentStopLossMicroUsd).toBe(100_220_000n);
    });

    it('Pista CEX: ejecuta TP1 en +1.25% vendiendo 40% y asegurando ganancias', () => {
      const pos = createCexPosition();
      // Precio sube a $101.30 (+130 bps >= +125 bps)
      const currentPrice = 101_300_000n;
      const decision = engine.evaluateExit(pos, currentPrice, t0 + 120_000n);

      expect(decision.action).toBe('TAKE_PROFIT_1_40PCT');
      expect(decision.tokensToSellAtomic).toBe(40_000_000_000n); // 40% de 100
      expect(pos.remainingTokensAtomic).toBe(60_000_000_000n); // 60% remanente
      expect(pos.isTp1Executed).toBe(true);
      expect(pos.isBreakEvenLocked).toBe(true);
    });

    it('Pista CEX: ejecuta TP2 en +2.80% vendiendo 35% y dejando 25% Moonbag con Trailing Stop', () => {
      const pos = createCexPosition();
      pos.isTp1Executed = true;
      pos.remainingTokensAtomic = 60_000_000_000n;

      // Precio sube a $103.00 (+300 bps >= +280 bps)
      const currentPrice = 103_000_000n;
      const decision = engine.evaluateExit(pos, currentPrice, t0 + 240_000n);

      expect(decision.action).toBe('TAKE_PROFIT_2_35PCT');
      expect(decision.tokensToSellAtomic).toBe(35_000_000_000n); // 35%
      expect(pos.remainingTokensAtomic).toBe(25_000_000_000n); // 25% Moonbag exacto
      expect(pos.isTp2Executed).toBe(true);
      // Trailing del 0.85% (85 bps) desde el pico de $103.00 = $102.1245
      expect(pos.currentStopLossMicroUsd).toBe(applyBpsOffset(103_000_000n, -85n));
    });

    it('Smart Time-Stop: PROHÍBE cerrar a mercado a los 15m si la posición va en verde (+35 bps)', () => {
      const pos = createCexPosition();
      const fifteenMinLater = t0 + 901_000n; // > 15 minutos (900,000ms)
      const pGreen = 100_350_000n; // +0.35% (+35 bps > +20 bps)

      const decision = engine.evaluateExit(pos, pGreen, fifteenMinLater);

      // No debe cerrar a mercado; debe proteger con Break-Even / Trailing ceñido
      expect(decision.action).toBe('ACTIVATE_BREAKEVEN_GUARD');
      expect(decision.tokensToSellAtomic).toBe(0n);
      expect(pos.isBreakEvenLocked).toBe(true);
      // Floor lock a -15 bps del precio actual ($100.35 - 15 bps = $100.1994)
      expect(pos.currentStopLossMicroUsd).toBe(applyBpsOffset(pGreen, -15n));
    });

    it('Smart Time-Stop: sale con orden Limit Maker si tras 15m está estancada (+10 bps) con CVD negativo', () => {
      const pos = createCexPosition();
      pos.orderflowCvdPositive = false; // CVD vendedor / muerto
      const fifteenMinLater = t0 + 905_000n;
      const pStagnant = 100_100_000n; // +10 bps (< +20 bps)

      const decision = engine.evaluateExit(pos, pStagnant, fifteenMinLater);

      expect(decision.action).toBe('SMART_TIME_STOP_MAKER');
      expect(decision.tokensToSellAtomic).toBe(100_000_000_000n);
      expect(decision.executionStyle).toBe('LIMIT_POST_ONLY_20S');
    });

    it('Pista DEX (Raydium): aplica umbrales asimétricos de alta volatilidad (+9% TP1, +22% TP2)', () => {
      const pos: SentinelPositionState = {
        positionId: 'POS_DEX_01',
        venueTrack: 'RAYDIUM_PURE_DEX',
        openedAtMs: t0,
        entryPriceMicroUsd: 1_000_000n, // $1.00
        peakPriceMicroUsd: 1_000_000n,
        currentStopLossMicroUsd: 935_000n, // -6.50% Hard Stop
        initialTokensAtomic: 50_000n,
        remainingTokensAtomic: 50_000n,
        isBreakEvenLocked: false,
        isTp1Executed: false,
        isTp2Executed: false,
        orderflowCvdPositive: true,
      };

      // Subida a $1.10 (+10.00% >= +9.00% TP1)
      const decision = engine.evaluateExit(pos, 1_100_000n, t0 + 100_000n);
      expect(decision.action).toBe('TAKE_PROFIT_1_40PCT');
      expect(decision.tokensToSellAtomic).toBe(20_000n); // 40% de 50,000
      expect(pos.remainingTokensAtomic).toBe(30_000n);
    });
  });

  describe('2. Motor B: Catalyst News Scalping (Eliminación de Asfixia de 45s)', () => {
    let engine: CatalystVelocityExitEngine;

    beforeEach(() => {
      engine = new CatalystVelocityExitEngine();
    });

    const createNewsPosition = (): CatalystPositionState => ({
      positionId: 'CAT_POS_01',
      isMajorAsset: true,
      openedAtMs: t0,
      entryPriceMicroUsd: 200_000_000n, // $200.00
      peakPriceMicroUsd: 200_000_000n,
      currentStopLossMicroUsd: 199_100_000n,
      initialQuantityAtomic: 100_000_000_000n,
      remainingQuantityAtomic: 100_000_000_000n,
      isDeRisked: false,
      l2OrderbookImbalanceBps: 1200n, // Presión compradora viva
    });

    it('cobra 60% de la posición en Majors en +0.55% (+55 bps) y blinda el 40% restante en +25 bps', () => {
      const pos = createNewsPosition();
      // Precio sube a $201.20 (+60 bps > +55 bps)
      const currentPrice = 201_200_000n;
      const decision = engine.evaluate(pos, currentPrice, t0 + 30_000n);

      expect(decision.action).toBe('DERISK_60PCT_CASHFLOW');
      expect(decision.quantityAtomic).toBe(60_000_000_000n);
      expect(pos.remainingQuantityAtomic).toBe(40_000_000_000n);
      expect(pos.isDeRisked).toBe(true);
      // Stop sube a Entry + 25 bps ($200.50)
      expect(pos.currentStopLossMicroUsd).toBe(applyBpsOffset(pos.entryPriceMicroUsd, 25n));
    });

    it('a los 60 segundos NO cierra si va ganando >= +22 bps; bloquea piso de ganancia en +16 bps', () => {
      const pos = createNewsPosition();
      const sixtySecLater = t0 + 61_000n;
      const currentPrice = 200_600_000n; // +30 bps (>= +22 bps)

      const decision = engine.evaluate(pos, currentPrice, sixtySecLater);

      expect(decision.action).toBe('LOCK_PROFIT_FLOOR_60S');
      expect(decision.quantityAtomic).toBe(0n);
      // Stop asegurado en +16 bps ($200.32)
      expect(pos.currentStopLossMicroUsd).toBe(applyBpsOffset(pos.entryPriceMicroUsd, 16n));
    });

    it('micro-timer de 15s solo aborta si hay un fakeout severo (<= -45 bps con libro vendedor)', () => {
      const pos = createNewsPosition();
      pos.l2OrderbookImbalanceBps = -1500n; // Presión fuertemente vendedora
      const fifteenSecLater = t0 + 16_000n;
      const pDrop = 198_800_000n; // -60 bps (<= -45 bps)

      const decision = engine.evaluate(pos, pDrop, fifteenSecLater);
      expect(decision.action).toBe('FAKEOUT_ABORT_15S');
      expect(decision.quantityAtomic).toBe(100_000_000_000n);
    });
  });

  describe('3. Motor D (NUEVO): Vortex Engine (Caza de Cascadas de Liquidación)', () => {
    let vortex: VortexLiquidationReversionEngine;

    beforeEach(() => {
      vortex = new VortexLiquidationReversionEngine();
    });

    it('detecta mecha de capitulación (desviación >= 2.5 sigma, RVOL >= 2.8x, absorción >= 1.30x) y emite señal Long', () => {
      const tick: MarketMicrostructureTick = {
        symbol: 'SOLUSDT',
        timestampMs: t0,
        priceMicroUsd: 147_000_000n,     // $147.00
        vwap15mMicroUsd: 150_000_000n,   // $150.00 (-200 bps de desviación)
        realizedVolStdDevBps: 50n,       // 1 Sigma = 50 bps -> 2.5 Sigma = 125 bps
        rvolScaled: 350n,                // 3.5x volumen de liquidación
        liquidationSpikeUsdMicro: 12_000_000_000n, // $12k liquidaciones
        bidAbsorptionRatioScaled: 160n   // 1.6x absorción en el Bid
      };

      const signal = vortex.scanForCapitulationWick(tick);

      expect(signal.shouldEnterLong).toBe(true);
      // Entrada Post-Only -2 bps bajo el precio actual ($146.97)
      expect(signal.limitBidPriceMicroUsd).toBe(applyBpsOffset(147_000_000n, -2n));
      // TP1 a mitad de camino del VWAP
      expect(signal.takeProfit1MicroUsd).toBeGreaterThan(signal.limitBidPriceMicroUsd);
      // TP2 en el toque exacto del VWAP ($150.00)
      expect(signal.takeProfit2MicroUsd).toBe(150_000_000n);
      // Hard Stop ceñido a -0.95% bajo la mecha
      expect(signal.hardStopMicroUsd).toBe(applyBpsOffset(signal.limitBidPriceMicroUsd, -95n));
    });

    it('ignora movimientos ordinarios que no cumplen con los 2.5 Sigma de liquidación forzada', () => {
      const normalTick: MarketMicrostructureTick = {
        symbol: 'SOLUSDT',
        timestampMs: t0,
        priceMicroUsd: 149_500_000n,     // $149.50 (-33 bps del VWAP)
        vwap15mMicroUsd: 150_000_000n,
        realizedVolStdDevBps: 50n,
        rvolScaled: 120n,                // 1.2x volumen normal
        liquidationSpikeUsdMicro: 500_000_000n,
        bidAbsorptionRatioScaled: 100n
      };

      const signal = vortex.scanForCapitulationWick(normalTick);
      expect(signal.shouldEnterLong).toBe(false);
    });
  });

  describe('4. Integración ActivePositionSupervisor con SQLite WAL y Flujo de Caja v4.0', () => {
    it('persiste Break-Even, TP1 y TP2 en SQLite y actualiza el saldo de RiskGuardian de forma atómica', async () => {
      const db = new NexusDatabase(':memory:');
      db.initRiskGuardianState(100_000_000_000n);
      const guardian = new RiskGuardian(db);
      const supervisor = new ActivePositionSupervisor(db, guardian);
      supervisor.enableTakerFeeDeduction(true);

      let lastAction = '';
      supervisor.setOnExitTriggered((posId, action) => {
        lastAction = action;
      });

      // 1. Abrir posición Sentinel en CEX
      db.allocateAndInsertPositionAtomic({
        position_id: 'POS_CEX_INTEGRATION_01',
        engine_origin: 'SENTINEL_ONCHAIN',
        signal_ref_id: 'SIG_WHALE_01',
        execution_mode: 'SHADOW',
        instrument_ticker: 'SOL',
        side: 1,
        phase_allocation_bps: 10000n,
        notional_invested_micro: 5_000_000_000n, // $5,000 USD
        quantity_atomic: '50000000000',          // 50 SOL (50 * 10^9)
        entry_price_micro: 100_000_000n,         // $100.00
        stop_loss_micro: 98_200_000n,            // -1.80%
        trailing_stop_micro: null,
        take_profit_micro: null,
        peak_price_micro: 100_000_000n,
        venue_track: 'BINANCE_LIQUID_CEX',
        is_breakeven_locked: 0,
        is_tp1_executed: 0,
        is_tp2_executed: 0
      });

      const openRows = db.getOpenPositions();
      supervisor.rehydrateAndResumeAll(openRows);

      // 2. Tick sube a $100.70 (+70 bps) -> Dispara ACTIVATE_BREAKEVEN_GUARD
      await supervisor.evaluatePriceTick('SOL', 100_700_000n, t0 + 60_000n);
      expect(lastAction).toBe('ACTIVATE_BREAKEVEN_GUARD');
      let row = db.getRawDb().prepare("SELECT * FROM unified_positions_ledger WHERE position_id = 'POS_CEX_INTEGRATION_01'").get() as any;
      expect(Number(row.is_breakeven_locked)).toBe(1);
      expect(BigInt(row.stop_loss_micro)).toBe(100_220_000n);

      // 3. Tick sube a $101.30 (+130 bps) -> Dispara TAKE_PROFIT_1_40PCT (vende 40% = 20 SOL)
      await supervisor.evaluatePriceTick('SOL', 101_300_000n, t0 + 120_000n);
      expect(lastAction).toBe('TAKE_PROFIT_1_40PCT');
      row = db.getRawDb().prepare("SELECT * FROM unified_positions_ledger WHERE position_id = 'POS_CEX_INTEGRATION_01'").get() as any;
      expect(row.status).toBe('PARTIALLY_CLOSED');
      expect(Number(row.is_tp1_executed)).toBe(1);
      expect(row.quantity_atomic).toBe('30000000000'); // 30 SOL restantes (60%)
      expect(BigInt(row.realized_pnl_micro)).toBeGreaterThan(0n); // Ganancia neta cobrada en dólares
    });
  });

  describe('5. Motor E (NUEVO): Kronos Avellaneda-Stoikov Maker Engine', () => {
    let kronos: KronosAvellanedaMakerEngine;
    const baseOrderMicro = 1_000_000_000n; // $1,000 USD
    const maxInvMicro = 5_000_000_000n;    // $5,000 USD

    beforeEach(() => {
      kronos = new KronosAvellanedaMakerEngine();
    });

    it('cotiza órdenes duales Post-Only cuando el mercado está en rango estricto (ER <= 0.22)', () => {
      const state: KronosMarketState = {
        symbol: 'SOLUSDT',
        midPriceMicroUsd: 150_000_000n, // $150.00
        kaufmanErScaled: 1800n,          // 0.18 ER (mercado plano)
        realizedVolBps: 20n,             // 0.20% (usa piso mínimo de 28 bps)
        l2ImbalanceBps: 500n,            // Desequilibrio mínimo
        currentInventoryUsdMicro: 0n,    // Inventario neutro
        maxInventoryUsdMicro: maxInvMicro
      };

      const quotes = kronos.computeMakerQuotes(state, baseOrderMicro);

      expect(quotes.action).toBe('DEPLOY_DUAL_QUOTES');
      expect(quotes.bidSizeUsdMicro).toBe(baseOrderMicro);
      expect(quotes.askSizeUsdMicro).toBe(baseOrderMicro);
      // Spread de 28 bps alrededor de $150.00
      expect(quotes.postOnlyBidMicroUsd).toBe(applyBpsOffset(150_000_000n, -28n));
      expect(quotes.postOnlyAskMicroUsd).toBe(applyBpsOffset(150_000_000n, 28n));
    });

    it('aplica sesgo de inventario (Inventory Skew): si estamos comprados, baja precios para vender más rápido', () => {
      const state: KronosMarketState = {
        symbol: 'SOLUSDT',
        midPriceMicroUsd: 150_000_000n,
        kaufmanErScaled: 1900n,
        realizedVolBps: 28n,
        l2ImbalanceBps: 0n,
        currentInventoryUsdMicro: 2_500_000_000n, // +$2,500 Long (50% del inventario)
        maxInventoryUsdMicro: maxInvMicro         // $5,000
      };

      const quotes = kronos.computeMakerQuotes(state, baseOrderMicro);

      expect(quotes.action).toBe('DEPLOY_DUAL_QUOTES');
      // Con 50% de inventario, skew = -(5000 * 18 / 10000) = -9 bps
      // El precio de reserva baja 9 bps, por lo que el Ask está más cerca del mercado para deshacer inventario
      const reservationPrice = applyBpsOffset(150_000_000n, -9n);
      expect(quotes.postOnlyAskMicroUsd).toBe(applyBpsOffset(reservationPrice, 28n));
      expect(quotes.postOnlyBidMicroUsd).toBe(applyBpsOffset(reservationPrice, -28n));
      expect(quotes.postOnlyAskMicroUsd).toBeLessThan(applyBpsOffset(150_000_000n, 28n));
    });

    it('cortacircuitos anti-tendencia: aborta y cancela órdenes si Kaufman ER >= 0.30 o desequilibrio L2 >= 65%', () => {
      // Caso A: Explosión de tendencia (ER = 0.32)
      const trendState: KronosMarketState = {
        symbol: 'SOLUSDT',
        midPriceMicroUsd: 150_000_000n,
        kaufmanErScaled: 3200n, // 0.32 ER
        realizedVolBps: 45n,
        l2ImbalanceBps: 0n,
        currentInventoryUsdMicro: 0n,
        maxInventoryUsdMicro: maxInvMicro
      };
      const quoteTrend = kronos.computeMakerQuotes(trendState, baseOrderMicro);
      expect(quoteTrend.action).toBe('FLATTEN_AND_PAUSE');
      expect(quoteTrend.postOnlyBidMicroUsd).toBe(0n);

      // Caso B: Flujo tóxico institucional en el libro L2 (> 65% imbalance)
      const toxicState: KronosMarketState = {
        symbol: 'SOLUSDT',
        midPriceMicroUsd: 150_000_000n,
        kaufmanErScaled: 2000n,
        realizedVolBps: 30n,
        l2ImbalanceBps: 7000n, // 70% presión vendedora/compradora unilateral
        currentInventoryUsdMicro: 0n,
        maxInventoryUsdMicro: maxInvMicro
      };
      const quoteToxic = kronos.computeMakerQuotes(toxicState, baseOrderMicro);
      expect(quoteToxic.action).toBe('FLATTEN_AND_PAUSE');
    });

    it('si el inventario máximo está lleno (+100%), solo cotiza venta (HOLD_SINGLE_SIDE)', () => {
      const fullLongState: KronosMarketState = {
        symbol: 'SOLUSDT',
        midPriceMicroUsd: 150_000_000n,
        kaufmanErScaled: 1500n,
        realizedVolBps: 28n,
        l2ImbalanceBps: 0n,
        currentInventoryUsdMicro: 5_000_000_000n, // $5,000 (100% de límite)
        maxInventoryUsdMicro: maxInvMicro
      };

      const quotes = kronos.computeMakerQuotes(fullLongState, baseOrderMicro);
      expect(quotes.action).toBe('HOLD_SINGLE_SIDE');
      expect(quotes.postOnlyBidMicroUsd).toBe(0n); // No compra más
      expect(quotes.postOnlyAskMicroUsd).toBeGreaterThan(0n); // Solo vende
    });
  });

  describe('6. Sentinel: Gatillo de Absorción en Pullback (Anti-Selección Adversa)', () => {
    it('no compra a ciegas si el precio cae al Fib 38.2% con CVD vendedor; espera absorción compradora (CVD > 0)', () => {
      const sniper = new SmartPullbackSniper();
      const plan = sniper.createEntryIntent({
        intentId: 'intent_knife_test',
        tokenSymbol: 'SOL',
        tokenMint: 'MINT_SOL',
        preWhalePriceMicroUsd: 100_000_000n,      // $100.00
        peakImpactPriceMicroUsd: 110_000_000n,    // $110.00 (Delta = $10.00)
        vwap5mMicroUsd: 106_000_000n,
        allocatedWeightBps: 10000n,
        confluenceCount: 3,
        uniqueFundingRoots: ['WHALE_01'],
        nowMs: t0
      });

      // Fib 38.2% = $110 - ($10 * 0.382) = $106.18 (106_180_000 µUSD)
      expect(plan.limitTargetPriceMicroUsd).toBe(106_180_000n);

      // CASO A: El precio cae a $106.00 (por debajo de Fib 38.2%), pero el CVD es NEGATIVO (cuchillo cayendo)
      const knifeTickPrice = 106_000_000n;
      const knifeCvd = -50_000_000n; // CVD vendedor agresivo

      const resKnife = sniper.evaluateMarketTick(plan.record, knifeTickPrice, t0 + 10_000n, knifeCvd);
      // NO debe ejecutar la compra en el cuchillo cayendo
      expect(resKnife.resolution).toBe('HOLD_WAITING');
      expect(resKnife.fillExecutionPriceMicroUsd).toBeNull();

      // CASO B: En el mismo precio de $106.00, se confirma absorción compradora institucional (CVD > 0)
      const absorptionCvd = 120_000_000n; // Delta de volumen comprador positivo
      const resAbsorption = sniper.evaluateMarketTick(plan.record, knifeTickPrice, t0 + 12_000n, absorptionCvd);

      // AHORA SÍ ejecuta la compra con absorción confirmada
      expect(resAbsorption.resolution).toBe('FILL_TRIGGERED');
      expect(resAbsorption.fillExecutionPriceMicroUsd).toBe(knifeTickPrice);
    });
  });
});
