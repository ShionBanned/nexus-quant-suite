/**
 * NEXUS QUANT SUITE v2.0 - RING BUFFER L2 EN RAM (VENTANA 15 MINUTOS)
 * 
 * Mantiene en memoria una ventana circular de 15 minutos (900,000 ms) de precios e instantáneas L2.
 * Proporciona acceso O(1) / O(log N) a:
 * 1. P_anchor = P_mid(t0 - 500ms)
 * 2. P_15m = Precio hace 15 minutos para detector de Insiders (PreEventDrift)
 * 3. Microestructura L2 (Order Book Imbalance OBI y Flujo de Volumen Taker)
 */

import { BPS_SCALE, calcBpsDelta } from './math_bigint.js';

export interface OrderBookLevel {
  priceMicro: bigint;
  quantityAtomic: bigint;
}

export interface L2Snapshot {
  timestampMs: bigint;
  midPriceMicro: bigint;
  bestBidMicro: bigint;
  bestAskMicro: bigint;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  takerBuyVolMicro: bigint;
  takerSellVolMicro: bigint;
}

export class InstrumentRingBuffer {
  public lastActiveMs: bigint = BigInt(Date.now());
  private buffer: (L2Snapshot | null)[];
  private capacity: number;
  private head: number = 0;
  private size: number = 0;
  private readonly maxAgeMs: bigint = 900_000n; // 15 minutos = 900,000 ms

  constructor(capacity: number = 3600) {
    this.capacity = capacity;
    this.buffer = new Array(capacity).fill(null);
  }

  public push(snapshot: L2Snapshot): void {
    this.lastActiveMs = snapshot.timestampMs;
    this.buffer[this.head] = snapshot;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) {
      this.size++;
    }
  }

  public getLatest(): L2Snapshot | null {
    if (this.size === 0) return null;
    const idx = (this.head - 1 + this.capacity) % this.capacity;
    return this.buffer[idx];
  }

  /**
   * Obtiene la instantánea más cercana a una marca de tiempo objetivo (<= targetMs)
   */
  public getClosestAtOrBefore(targetMs: bigint): L2Snapshot | null {
    if (this.size === 0) return null;

    let bestSnapshot: L2Snapshot | null = null;
    let minDiff: bigint | null = null;

    // Búsqueda inversa desde la más reciente
    for (let i = 0; i < this.size; i++) {
      const idx = ((this.head - 1 - i) % this.capacity + this.capacity) % this.capacity;
      const snap = this.buffer[idx];
      if (!snap) continue;

      if (snap.timestampMs <= targetMs) {
        const diff = targetMs - snap.timestampMs;
        if (minDiff === null || diff < minDiff) {
          minDiff = diff;
          bestSnapshot = snap;
        }
        // En un ring buffer cronológico, iterar de más reciente a más antiguo significa
        // que el primer elemento <= targetMs maximiza snap.timestampMs y por ende minimiza diff.
        // Cualquier elemento posterior en la secuencia inversa tendrá una marca de tiempo menor o igual (diff mayor o igual).
        break;
      }
    }

    // Si no encontramos nada <= targetMs, no hay datos anteriores a targetMs (evita lookahead bias)
    return bestSnapshot;
  }

  /**
   * Obtiene el Precio Ancla Pre-Noticia: P_anchor = P_mid(t0 - 500ms)
   */
  public getAnchorPrice(t0Ms: bigint): bigint | null {
    const targetMs = t0Ms - 500n;
    const snap = this.getClosestAtOrBefore(targetMs);
    return snap ? snap.midPriceMicro : null;
  }

  /**
   * Calcula el drift previo de 15 minutos en Puntos Base (bps):
   * drift = ((P_anchor - P_15m) * 10,000) / P_15m
   */
  public get15mDriftBps(t0Ms: bigint): bigint | null {
    const anchorPrice = this.getAnchorPrice(t0Ms);
    if (!anchorPrice) return null;

    const t15mMs = t0Ms - 900_000n; // 15 minutos antes
    const snap15m = this.getClosestAtOrBefore(t15mMs);
    if (!snap15m || snap15m.midPriceMicro <= 0n) return 0n;

    return calcBpsDelta(anchorPrice, snap15m.midPriceMicro);
  }

  /**
   * Calcula la métrica de microestructura L2 (Order Book Imbalance OBI y Taker Volume)
   * Retorna valor en Puntos Base normalizado [0, 10,000]:
   * - 5,000 bps = Neutro (equilibrio)
   * - > 5,000 bps = Presión Compradora
   * - < 5,000 bps = Presión Vendedora
   */
  public getOrderBookImbalanceBps(depth: number = 10): bigint {
    const latest = this.getLatest();
    if (!latest) return 5000n;

    let bidVolume = 0n;
    let askVolume = 0n;

    const maxBids = Math.min(depth, latest.bids.length);
    for (let i = 0; i < maxBids; i++) {
      bidVolume += latest.bids[i].quantityAtomic;
    }

    const maxAsks = Math.min(depth, latest.asks.length);
    for (let i = 0; i < maxAsks; i++) {
      askVolume += latest.asks[i].quantityAtomic;
    }

    const totalVolume = bidVolume + askVolume;
    if (totalVolume === 0n) return 5000n;

    // OBI = (bid - ask) / (bid + ask) en rango [-1, 1]
    // Mapeado a [0, 10000]: 5000 + (5000 * (bid - ask)) / (bid + ask)
    const netImbalance = bidVolume - askVolume;
    const obiBps = 5000n + (5000n * netImbalance) / totalVolume;

    if (obiBps < 0n) return 0n;
    if (obiBps > 10000n) return 10000n;
    return obiBps;
  }

  /**
   * Confirmación combinada de microestructura L2 (Phi_flujo en escala 0 a 10,000):
   * 60% OBI + 40% Taker Volume Ratio
   */
  public getFlowConfirmationBps(expectedDirection: number): bigint {
    const obiBps = this.getOrderBookImbalanceBps(10);
    const latest = this.getLatest();
    let takerBps = 5000n;

    if (latest) {
      const totalTaker = latest.takerBuyVolMicro + latest.takerSellVolMicro;
      if (totalTaker > 0n) {
        takerBps = (latest.takerBuyVolMicro * 10000n) / totalTaker;
      }
    }

    // Si expectedDirection == 1 (Bullish), evaluamos alineación compradora
    if (expectedDirection > 0) {
      const combined = (obiBps * 6000n + takerBps * 4000n) / 10000n;
      return combined;
    } else if (expectedDirection < 0) {
      // Si Bearish, evaluamos alineación vendedora
      const invObi = 10000n - obiBps;
      const invTaker = 10000n - takerBps;
      const combined = (invObi * 6000n + invTaker * 4000n) / 10000n;
      return combined;
    } else {
      return 5000n;
    }
  }
}

export class GlobalL2RingBufferManager {
  private buffers: Map<string, InstrumentRingBuffer> = new Map();
  private readonly maxActiveBuffers: number = 50;
  private readonly maxIdleMs: bigint = 3_600_000n; // 1 hora de inactividad

  constructor() {
    // Poda periódica pasiva cada 15 minutos sin retener el bucle de eventos
    if (typeof setInterval !== 'undefined') {
      const timer = setInterval(() => this.pruneInactive(), 900_000);
      if (timer.unref) timer.unref();
    }
  }

  public getOrCreate(ticker: string, capacity: number = 3600): InstrumentRingBuffer {
    const key = ticker.toUpperCase();
    let buf = this.buffers.get(key);
    if (!buf) {
      // Si se excede la capacidad máxima, podar inactivos primero
      if (this.buffers.size >= this.maxActiveBuffers) {
        this.pruneInactive();
      }
      // Si todavía excede, desalojar el más antiguo (LRU policy)
      if (this.buffers.size >= this.maxActiveBuffers) {
        let oldestKey: string | null = null;
        let oldestTime = 0x7fffffffffffn;
        for (const [k, b] of this.buffers.entries()) {
          if (b.lastActiveMs < oldestTime) {
            oldestTime = b.lastActiveMs;
            oldestKey = k;
          }
        }
        if (oldestKey) this.buffers.delete(oldestKey);
      }

      buf = new InstrumentRingBuffer(capacity);
      this.buffers.set(key, buf);
    }
    return buf;
  }

  public pruneInactive(nowMs: bigint = BigInt(Date.now())): number {
    let pruned = 0;
    for (const [ticker, buf] of this.buffers.entries()) {
      if (nowMs - buf.lastActiveMs > this.maxIdleMs) {
        this.buffers.delete(ticker);
        pruned++;
      }
    }
    return pruned;
  }

  public getActiveCount(): number {
    return this.buffers.size;
  }

  public recordTick(ticker: string, snapshot: L2Snapshot): void {
    const buf = this.getOrCreate(ticker);
    buf.push(snapshot);
  }
}

/**
 * Genera una instantánea L2 de alta fidelidad centrada en un precio de mercado en micro-USD.
 */
export function createL2SnapshotFromPrice(
  priceMicro: bigint,
  timestampMs: bigint = BigInt(Date.now()),
  depthLevels: number = 10,
  spreadBps: bigint = 10n,
  levelNotionalMicro: bigint = 5_000_000_000n // $5,000 USD por nivel de profundidad
): L2Snapshot {
  const halfSpread = (priceMicro * spreadBps) / 20000n;
  const bestBid = priceMicro - (halfSpread > 0n ? halfSpread : 1n);
  const bestAsk = priceMicro + (halfSpread > 0n ? halfSpread : 1n);
  const bids: OrderBookLevel[] = [];
  const asks: OrderBookLevel[] = [];

  for (let i = 0; i < depthLevels; i++) {
    const stepBps = BigInt(i) * 5n; // 5 bps entre niveles sucesivos
    const bidPrice = bestBid - (bestBid * stepBps) / 10000n;
    const askPrice = bestAsk + (bestAsk * stepBps) / 10000n;
    const bidQtyAtomic = bidPrice > 0n ? (levelNotionalMicro * 1_000_000_000n) / bidPrice : 0n;
    const askQtyAtomic = askPrice > 0n ? (levelNotionalMicro * 1_000_000_000n) / askPrice : 0n;

    if (bidPrice > 0n && bidQtyAtomic > 0n) {
      bids.push({ priceMicro: bidPrice, quantityAtomic: bidQtyAtomic });
    }
    if (askPrice > 0n && askQtyAtomic > 0n) {
      asks.push({ priceMicro: askPrice, quantityAtomic: askQtyAtomic });
    }
  }

  return {
    timestampMs,
    midPriceMicro: priceMicro,
    bestBidMicro: bids.length > 0 ? bids[0].priceMicro : bestBid,
    bestAskMicro: asks.length > 0 ? asks[0].priceMicro : bestAsk,
    bids,
    asks,
    takerBuyVolMicro: 10_000_000_000n,
    takerSellVolMicro: 10_000_000_000n
  };
}

