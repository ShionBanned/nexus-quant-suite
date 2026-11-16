/**
 * NEXUS QUANT SUITE v2.0 - L2 SHADOW SIMULATOR (< 35ms RTT LATENCY)
 * 
 * Regla Inmutable de Paridad Estricta SHADOW vs LIVE:
 * - Prohibido el uso del último precio operado (last traded price).
 * - Aplica un retraso estricto de red RTT de 35 ms.
 * - Simula el barrido de liquidez contra el Libro de Órdenes L2 nivel a nivel.
 * - Descuenta comisión Taker (7 bps).
 * - Cancela en el acto remanente no llenado o si el precio de compra supera Pcap (Tope Duro).
 * - Registra la posición resultante en `unified_positions_ledger`.
 */

import { L2Snapshot, OrderBookLevel, InstrumentRingBuffer } from './ring_buffer_l2.js';
import { BPS_SCALE, calcAllocationMicro } from './math_bigint.js';
import { NexusDatabase } from './db_sqlite_wal.js';

export interface ShadowOrderRequest {
  orderId: string;
  engineOrigin: 'SENTINEL_ONCHAIN' | 'CATALYST_NEWS';
  signalRefId: string;
  ticker: string;
  side: 1 | -1; // 1 = Buy, -1 = Sell
  phaseAllocationBps: bigint; // 2500, 3500 o 10000 bps
  notionalMicroUsd: bigint;
  limitPriceCapMicroUsd: bigint; // Pcap
  stopLossMicroUsd: bigint; // PSL
  cancelAllAfterMs: number; // 5000 ms
  submittedAtMs: bigint;
}

export interface ShadowExecutionFill {
  filledPriceMicroUsd: bigint;
  filledQuantityAtomic: bigint;
}

export interface ShadowExecutionResult {
  orderId: string;
  status: 'FILLED' | 'PARTIALLY_FILLED' | 'REJECTED_PRICE_EXCEEDS_CAP' | 'REJECTED_ZERO_LIQUIDITY';
  effectiveLatencyMs: number;
  vwapPriceMicroUsd: bigint;
  filledNotionalMicroUsd: bigint;
  filledQuantityAtomic: bigint;
  takerFeePaidMicroUsd: bigint;
  unfilledNotionalMicroUsd: bigint;
  fills: ShadowExecutionFill[];
  executedAtMs: bigint;
}

export class L2ShadowSimulator {
  private db: NexusDatabase;
  private readonly simulatedRttLatencyMs: number = 35; // 35 ms RTT obligatorio
  private readonly takerFeeBps: bigint = 7n; // 0.07% (7 bps) comisiones taker

  constructor(db: NexusDatabase) {
    this.db = db;
  }

  /**
   * Simula el barrido contra la instantánea L2 o InstrumentRingBuffer tras 35ms de latencia RTT.
   * Aplica mutación real al libro de órdenes y elimina el sesgo de anticipación (lookahead bias).
   */
  public simulateSweep(
    request: ShadowOrderRequest,
    source: L2Snapshot | InstrumentRingBuffer,
    nowMs: bigint = BigInt(Date.now())
  ): ShadowExecutionResult {
    // 1. Simulación estricta de latencia RTT de 35 ms
    const executedAtMs = request.submittedAtMs + BigInt(this.simulatedRttLatencyMs);

    // Protección anti-time-travel: no se puede ejecutar en el pasado si nowMs < executedAtMs
    if (nowMs < executedAtMs) {
      return {
        orderId: request.orderId,
        status: 'REJECTED_ZERO_LIQUIDITY',
        effectiveLatencyMs: this.simulatedRttLatencyMs,
        vwapPriceMicroUsd: 0n,
        filledNotionalMicroUsd: 0n,
        filledQuantityAtomic: 0n,
        takerFeePaidMicroUsd: 0n,
        unfilledNotionalMicroUsd: request.notionalMicroUsd,
        fills: [],
        executedAtMs
      };
    }

    // 2. Obtención del libro L2 libre de Lookahead Bias
    let l2Snapshot: L2Snapshot | null = null;
    if (source instanceof InstrumentRingBuffer) {
      // Consulta en el ring buffer al instante exacto t0 + RTT
      l2Snapshot = source.getClosestAtOrBefore(executedAtMs);
      if (!l2Snapshot || l2Snapshot.timestampMs > executedAtMs) {
        return {
          orderId: request.orderId,
          status: 'REJECTED_ZERO_LIQUIDITY',
          effectiveLatencyMs: this.simulatedRttLatencyMs,
          vwapPriceMicroUsd: 0n,
          filledNotionalMicroUsd: 0n,
          filledQuantityAtomic: 0n,
          takerFeePaidMicroUsd: 0n,
          unfilledNotionalMicroUsd: request.notionalMicroUsd,
          fills: [],
          executedAtMs
        };
      }
    } else {
      l2Snapshot = source;
      // Si la instantánea provista tiene una marca temporal posterior a t0 + RTT, hay lookahead bias
      if (l2Snapshot.timestampMs > executedAtMs) {
        return {
          orderId: request.orderId,
          status: 'REJECTED_PRICE_EXCEEDS_CAP',
          effectiveLatencyMs: this.simulatedRttLatencyMs,
          vwapPriceMicroUsd: 0n,
          filledNotionalMicroUsd: 0n,
          filledQuantityAtomic: 0n,
          takerFeePaidMicroUsd: 0n,
          unfilledNotionalMicroUsd: request.notionalMicroUsd,
          fills: [],
          executedAtMs
        };
      }
    }

    // 3. Selección de libro: compras barren Asks; ventas barren Bids
    const levels: OrderBookLevel[] = request.side === 1 ? l2Snapshot.asks : l2Snapshot.bids;

    if (!levels || levels.length === 0) {
      return {
        orderId: request.orderId,
        status: 'REJECTED_ZERO_LIQUIDITY',
        effectiveLatencyMs: this.simulatedRttLatencyMs,
        vwapPriceMicroUsd: 0n,
        filledNotionalMicroUsd: 0n,
        filledQuantityAtomic: 0n,
        takerFeePaidMicroUsd: 0n,
        unfilledNotionalMicroUsd: request.notionalMicroUsd,
        fills: [],
        executedAtMs
      };
    }

    // 4. Verificación de precio tope inicial (Pcap)
    const bestPrice = levels[0].priceMicro;
    if (request.side === 1 && bestPrice > request.limitPriceCapMicroUsd) {
      return {
        orderId: request.orderId,
        status: 'REJECTED_PRICE_EXCEEDS_CAP',
        effectiveLatencyMs: this.simulatedRttLatencyMs,
        vwapPriceMicroUsd: 0n,
        filledNotionalMicroUsd: 0n,
        filledQuantityAtomic: 0n,
        takerFeePaidMicroUsd: 0n,
        unfilledNotionalMicroUsd: request.notionalMicroUsd,
        fills: [],
        executedAtMs
      };
    }
    if (request.side === -1 && bestPrice < request.limitPriceCapMicroUsd) {
      return {
        orderId: request.orderId,
        status: 'REJECTED_PRICE_EXCEEDS_CAP',
        effectiveLatencyMs: this.simulatedRttLatencyMs,
        vwapPriceMicroUsd: 0n,
        filledNotionalMicroUsd: 0n,
        filledQuantityAtomic: 0n,
        takerFeePaidMicroUsd: 0n,
        unfilledNotionalMicroUsd: request.notionalMicroUsd,
        fills: [],
        executedAtMs
      };
    }

    // 5. Barrido nivel a nivel y Mutación Real del Libro L2
    let remainingNotionalToFill = request.notionalMicroUsd;
    let totalFilledNotional = 0n;
    let totalFilledQuantityAtomic = 0n;
    let cumulativeCost = 0n;
    const fills: ShadowExecutionFill[] = [];

    for (const level of levels) {
      if (remainingNotionalToFill <= 0n) break;

      // Si el precio del nivel supera el tope Pcap para compra o cae del tope para venta, se detiene
      if (request.side === 1 && level.priceMicro > request.limitPriceCapMicroUsd) {
        break;
      }
      if (request.side === -1 && level.priceMicro < request.limitPriceCapMicroUsd) {
        break;
      }

      // Capacidad de este nivel en micro-USD
      const levelNotionalMicro = (level.quantityAtomic * level.priceMicro) / 1_000_000_000n;
      if (levelNotionalMicro <= 0n) continue;

      let fillNotional = 0n;
      let fillQuantityAtomic = 0n;

      if (remainingNotionalToFill >= levelNotionalMicro) {
        fillNotional = levelNotionalMicro;
        fillQuantityAtomic = level.quantityAtomic;
        level.quantityAtomic = 0n;
      } else {
        fillNotional = remainingNotionalToFill;
        fillQuantityAtomic = (fillNotional * 1_000_000_000n) / level.priceMicro;
        level.quantityAtomic -= fillQuantityAtomic;
        if (level.quantityAtomic < 0n) level.quantityAtomic = 0n;
      }

      fills.push({
        filledPriceMicroUsd: level.priceMicro,
        filledQuantityAtomic: fillQuantityAtomic
      });

      totalFilledNotional += fillNotional;
      totalFilledQuantityAtomic += fillQuantityAtomic;
      cumulativeCost += (fillQuantityAtomic * level.priceMicro);
      remainingNotionalToFill -= fillNotional;
    }

    // Mutación del libro L2: eliminar niveles totalmente agotados y actualizar top-of-book
    if (request.side === 1) {
      l2Snapshot.asks = l2Snapshot.asks.filter(l => l.quantityAtomic > 0n);
      if (l2Snapshot.asks.length > 0) {
        l2Snapshot.bestAskMicro = l2Snapshot.asks[0].priceMicro;
      }
      l2Snapshot.takerBuyVolMicro += totalFilledNotional;
    } else {
      l2Snapshot.bids = l2Snapshot.bids.filter(l => l.quantityAtomic > 0n);
      if (l2Snapshot.bids.length > 0) {
        l2Snapshot.bestBidMicro = l2Snapshot.bids[0].priceMicro;
      }
      l2Snapshot.takerSellVolMicro += totalFilledNotional;
    }
    if (l2Snapshot.bids.length > 0 && l2Snapshot.asks.length > 0) {
      l2Snapshot.midPriceMicro = (l2Snapshot.bestBidMicro + l2Snapshot.bestAskMicro) / 2n;
    }

    if (totalFilledQuantityAtomic === 0n) {
      return {
        orderId: request.orderId,
        status: 'REJECTED_PRICE_EXCEEDS_CAP',
        effectiveLatencyMs: this.simulatedRttLatencyMs,
        vwapPriceMicroUsd: 0n,
        filledNotionalMicroUsd: 0n,
        filledQuantityAtomic: 0n,
        takerFeePaidMicroUsd: 0n,
        unfilledNotionalMicroUsd: request.notionalMicroUsd,
        fills: [],
        executedAtMs
      };
    }

    // VWAP = cumulativeCost / totalFilledQuantityAtomic
    const vwapPriceMicroUsd = cumulativeCost / totalFilledQuantityAtomic;
    const takerFeePaidMicroUsd = (totalFilledNotional * this.takerFeeBps) / BPS_SCALE;

    const status = remainingNotionalToFill === 0n ? 'FILLED' : 'PARTIALLY_FILLED';

    // 6. Registrar posición en `unified_positions_ledger`
    const isRecorded = this.recordInLedger(request, vwapPriceMicroUsd, totalFilledNotional, totalFilledQuantityAtomic, executedAtMs);
    if (!isRecorded) {
      return {
        orderId: request.orderId,
        status: 'REJECTED_ZERO_LIQUIDITY',
        effectiveLatencyMs: this.simulatedRttLatencyMs,
        vwapPriceMicroUsd: 0n,
        filledNotionalMicroUsd: 0n,
        filledQuantityAtomic: 0n,
        takerFeePaidMicroUsd: 0n,
        unfilledNotionalMicroUsd: request.notionalMicroUsd,
        fills: [],
        executedAtMs
      };
    }

    return {
      orderId: request.orderId,
      status,
      effectiveLatencyMs: this.simulatedRttLatencyMs,
      vwapPriceMicroUsd,
      filledNotionalMicroUsd: totalFilledNotional,
      filledQuantityAtomic: totalFilledQuantityAtomic,
      takerFeePaidMicroUsd,
      unfilledNotionalMicroUsd: remainingNotionalToFill,
      fills,
      executedAtMs
    };
  }

  private recordInLedger(
    request: ShadowOrderRequest,
    entryPriceMicroUsd: bigint,
    notionalInvestedMicro: bigint,
    quantityAtomic: bigint,
    openedAtMs: bigint
  ): boolean {
    const positionId = `POS_${request.orderId}`;
    const res = this.db.allocateAndInsertPositionAtomic({
      position_id: positionId,
      engine_origin: request.engineOrigin,
      signal_ref_id: request.signalRefId,
      execution_mode: 'SHADOW',
      instrument_ticker: request.ticker,
      side: request.side,
      phase_allocation_bps: request.phaseAllocationBps,
      notional_invested_micro: notionalInvestedMicro,
      quantity_atomic: quantityAtomic.toString(),
      entry_price_micro: entryPriceMicroUsd,
      stop_loss_micro: request.stopLossMicroUsd,
      trailing_stop_micro: null,
      take_profit_micro: null,
      peak_price_micro: entryPriceMicroUsd,
      status: 'OPEN',
      opened_at_ms: openedAtMs
    });
    return res.success;
  }
}
