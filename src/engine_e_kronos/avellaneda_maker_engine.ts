// src/engine_e_kronos/avellaneda_maker_engine.ts
// NEXUS QUANT SUITE v4.0 - Motor E: Market Making Asimétrico con Sesgo de Inventario (BigInt)

import { calcBpsDelta, applyBpsOffset } from '../engine_a_sentinel/whale_asymmetric_exit.js';

export interface KronosMarketState {
  symbol: string;
  midPriceMicroUsd: bigint;
  kaufmanErScaled: bigint;         // Escalado x10000 (ej. 2200n = 0.22 ER)
  realizedVolBps: bigint;          // Volatilidad de 5m en puntos básicos (ej. 30n = 0.30%)
  l2ImbalanceBps: bigint;          // Desequilibrio Bid/Ask (-10000n a +10000n)
  currentInventoryUsdMicro: bigint;// Inventario neto actual (+ Long, - Short)
  maxInventoryUsdMicro: bigint;    // Límite duro por par (ej. $5,000 USD = 5_000_000_000n)
}

export interface KronosMakerQuote {
  action: 'DEPLOY_DUAL_QUOTES' | 'FLATTEN_AND_PAUSE' | 'HOLD_SINGLE_SIDE';
  postOnlyBidMicroUsd: bigint;
  postOnlyAskMicroUsd: bigint;
  bidSizeUsdMicro: bigint;
  askSizeUsdMicro: bigint;
  reason: string;
}

export class KronosAvellanedaMakerEngine {
  // Solo opera cuando el mercado está en rango estricto (ER <= 0.22)
  public static readonly MAX_ALLOWED_ER_SCALED = 2200n;
  // Si el ER supera 0.30 o el desequilibrio L2 supera el 65%, aborta por inicio de tendencia
  public static readonly EMERGENCY_TREND_ER_SCALED = 3000n;
  public static readonly MAX_TOXIC_FLOW_BPS = 6500n;

  // Spread base mínimo por lado (28 bps = 0.28% a cada lado -> 0.56% spread total capturado)
  public static readonly MIN_HALF_SPREAD_BPS = 28n;
  // Penalización máxima de precio por inventario lleno (18 bps)
  public static readonly MAX_INVENTORY_SKEW_BPS = 18n;

  public computeMakerQuotes(state: KronosMarketState, baseOrderUsdMicro: bigint): KronosMakerQuote {
    const absImbalance = state.l2ImbalanceBps < 0n ? -state.l2ImbalanceBps : state.l2ImbalanceBps;

    // 1. CORTACIRCUITOS ANTI-TENDENCIA (Evita ser arrollado por una ballena o noticia)
    if (
      state.kaufmanErScaled >= KronosAvellanedaMakerEngine.EMERGENCY_TREND_ER_SCALED ||
      absImbalance >= KronosAvellanedaMakerEngine.MAX_TOXIC_FLOW_BPS
    ) {
      return {
        action: 'FLATTEN_AND_PAUSE',
        postOnlyBidMicroUsd: 0n,
        postOnlyAskMicroUsd: 0n,
        bidSizeUsdMicro: 0n,
        askSizeUsdMicro: 0n,
        reason: `Flujo direccional detectado (ER: ${state.kaufmanErScaled}, L2 Imbalance: ${state.l2ImbalanceBps}). Cancelando órdenes Maker.`,
      };
    }

    // 2. FILTRO DE ENTRADA: Si el ER está entre 0.22 y 0.30, no abre nuevas posiciones, solo descarga inventario
    if (state.kaufmanErScaled > KronosAvellanedaMakerEngine.MAX_ALLOWED_ER_SCALED && state.currentInventoryUsdMicro === 0n) {
      return {
        action: 'FLATTEN_AND_PAUSE',
        postOnlyBidMicroUsd: 0n,
        postOnlyAskMicroUsd: 0n,
        bidSizeUsdMicro: 0n,
        askSizeUsdMicro: 0n,
        reason: 'Régimen intermedio (ER > 0.22) sin inventario activo. Esperando consolidación.',
      };
    }

    // 3. CÁLCULO DEL PRECIO DE RESERVA (Avellaneda-Stoikov Inventory Skew en BigInt)
    // Ratio de inventario escalado (-10000n a +10000n)
    const invRatioBps = state.maxInventoryUsdMicro > 0n
      ? (state.currentInventoryUsdMicro * 10_000n) / state.maxInventoryUsdMicro
      : 0n;

    // Si estamos muy comprados (invRatioBps > 0), bajamos nuestro precio de reserva para vender más rápido y comprar más barato
    const skewBps = -((invRatioBps * KronosAvellanedaMakerEngine.MAX_INVENTORY_SKEW_BPS) / 10_000n);
    const reservationPriceMicro = applyBpsOffset(state.midPriceMicroUsd, skewBps);

    // 4. SPREAD DINÁMICO BASADO EN VOLATILIDAD REALIZADA
    const dynamicHalfSpreadBps = state.realizedVolBps > KronosAvellanedaMakerEngine.MIN_HALF_SPREAD_BPS
      ? state.realizedVolBps
      : KronosAvellanedaMakerEngine.MIN_HALF_SPREAD_BPS;

    const bidPriceMicro = applyBpsOffset(reservationPriceMicro, -dynamicHalfSpreadBps);
    const askPriceMicro = applyBpsOffset(reservationPriceMicro, dynamicHalfSpreadBps);

    // 5. GESTIÓN DE TAMAÑO Y LÍMITE DE INVENTARIO
    const canBuyMore = state.currentInventoryUsdMicro < state.maxInventoryUsdMicro;
    const canSellMore = state.currentInventoryUsdMicro > -state.maxInventoryUsdMicro;

    return {
      action: canBuyMore && canSellMore ? 'DEPLOY_DUAL_QUOTES' : 'HOLD_SINGLE_SIDE',
      postOnlyBidMicroUsd: canBuyMore ? bidPriceMicro : 0n,
      postOnlyAskMicroUsd: canSellMore ? askPriceMicro : 0n,
      bidSizeUsdMicro: canBuyMore ? baseOrderUsdMicro : 0n,
      askSizeUsdMicro: canSellMore ? baseOrderUsdMicro : 0n,
      reason: `Quotes Post-Only desplegados (+/-${dynamicHalfSpreadBps} bps, Skew: ${skewBps} bps). Cero comisión Taker.`,
    };
  }
}
