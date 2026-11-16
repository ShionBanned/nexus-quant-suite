/**
 * NEXUS QUANT SUITE v3.0 - LIVE REAL-TIME MARKET PRICE FEED
 * 
 * Enlace directo y resiliente con los streams de precios en tiempo real de Binance Public WebSocket:
 * - Streaming de baja latencia para SOL, BTC, ETH, RAY, BNB, AVAX, NEAR.
 * - Normalización de precisión estricta a micro-USD (BigInt, 6 decimales, $1.00 = 1,000,000 uUSD).
 * - Heartbeat activo y reconexión automática con backoff exponencial.
 * - Despacho de eventos de tick de precio hacia ActivePositionSupervisor.
 */

import WebSocket from 'ws';

export interface PriceTickEvent {
  symbol: string;         // 'SOLUSDT', 'BTCUSDT', etc.
  ticker: string;         // 'SOL/USD', 'BTC/USD', etc.
  baseAsset: string;      // 'SOL', 'BTC', etc.
  priceMicroUsd: bigint;  // 89220000n = $89.22
  timestampMs: number;
}

export type PriceTickCallback = (event: PriceTickEvent) => void;

export class LivePriceFeed {
  private ws: WebSocket | null = null;
  private readonly endpoint: string;
  private isRunning: boolean = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private reconnectAttempts: number = 0;
  private readonly maxReconnectAttempts: number = 20;

  // Caché de precios en memoria (ticker normalizado -> precio en micro-USD)
  private readonly latestPrices: Map<string, bigint> = new Map();
  private readonly callbacks: PriceTickCallback[] = [];

  // Mapeo de pares monitoreados
  private readonly symbolToTicker: Record<string, { ticker: string; base: string }> = {
    SOLUSDT: { ticker: 'SOL/USD', base: 'SOL' },
    BTCUSDT: { ticker: 'BTC/USD', base: 'BTC' },
    ETHUSDT: { ticker: 'ETH/USD', base: 'ETH' },
    BNBUSDT: { ticker: 'BNB/USD', base: 'BNB' },
    AVAXUSDT: { ticker: 'AVAX/USD', base: 'AVAX' },
    NEARUSDT: { ticker: 'NEAR/USD', base: 'NEAR' },
    RAYUSDT: { ticker: 'RAY/USD', base: 'RAY' },
  };

  constructor(
    endpoint: string = 'wss://stream.binance.com:9443/stream?streams=solusdt@ticker/btcusdt@ticker/ethusdt@ticker/bnbusdt@ticker/avaxusdt@ticker/nearusdt@ticker/rayusdt@ticker'
  ) {
    this.endpoint = endpoint;
  }

  /**
   * Convierte un string de precio (ej. "89.21000000" o "75837.66000000") a micro-USD (BigInt 6 decimales)
   * sin pérdida de precisión por redondeo flotante.
   */
  public static parsePriceToMicroUsd(priceStr: string): bigint {
    const parts = priceStr.trim().split('.');
    const intPart = BigInt(parts[0] || '0');
    const fracRaw = parts[1] || '';
    const fracPart = BigInt((fracRaw + '000000').slice(0, 6));
    return intPart * 1_000_000n + fracPart;
  }

  public onPriceTick(cb: PriceTickCallback): void {
    this.callbacks.push(cb);
  }

  public getLatestPrice(tickerOrSymbol: string): bigint | null {
    const clean = tickerOrSymbol.toUpperCase().trim();
    if (this.latestPrices.has(clean)) {
      return this.latestPrices.get(clean)!;
    }
    // Buscar si viene en formato 'SOL' o 'SOL/USD' o 'SOLUSDT'
    for (const [k, v] of Object.entries(this.symbolToTicker)) {
      if (clean === k || clean === v.ticker || clean === v.base) {
        if (this.latestPrices.has(k)) return this.latestPrices.get(k)!;
        if (this.latestPrices.has(v.ticker)) return this.latestPrices.get(v.ticker)!;
      }
    }
    return null;
  }

  public getAllLatestPrices(): Map<string, bigint> {
    return new Map(this.latestPrices);
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.connect();
    // Carga inicial rápida de precios por REST para tener precios desde el milisegundo cero
    this.seedInitialPricesRest().catch(() => {});
  }

  public stop(): void {
    this.isRunning = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      try {
        this.ws.close();
      } catch { /* ignore */ }
      this.ws = null;
    }
  }

  private connect(): void {
    if (!this.isRunning) return;

    try {
      this.ws = new WebSocket(this.endpoint);

      this.ws.on('open', () => {
        this.reconnectAttempts = 0;
        console.log(`📡 [LivePriceFeed] Conectado a Binance Public Stream (Tickers en tiempo real activos).`);

        if (this.pingInterval) clearInterval(this.pingInterval);
        this.pingInterval = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.ping();
          }
        }, 15000);
      });

      this.ws.on('message', (raw: WebSocket.RawData) => {
        try {
          const payload = JSON.parse(raw.toString());
          // Formato multiplexado: { stream: "solusdt@ticker", data: { s: "SOLUSDT", c: "89.21000000", ... } }
          const data = payload.data || payload;
          const symbol = data.s;
          const closePrice = data.c;

          if (symbol && closePrice) {
            const priceMicro = LivePriceFeed.parsePriceToMicroUsd(String(closePrice));
            const mapping = this.symbolToTicker[symbol] || { ticker: `${symbol}/USD`, base: symbol };

            // Actualizar caché para todos los alias
            this.latestPrices.set(symbol, priceMicro);
            this.latestPrices.set(mapping.ticker, priceMicro);
            this.latestPrices.set(mapping.base, priceMicro);

            const event: PriceTickEvent = {
              symbol,
              ticker: mapping.ticker,
              baseAsset: mapping.base,
              priceMicroUsd: priceMicro,
              timestampMs: Number(data.E || Date.now())
            };

            for (const cb of this.callbacks) {
              try {
                cb(event);
              } catch (e) {
                // Silenciar errores en handlers individuales para proteger el flujo de precios
              }
            }
          }
        } catch {
          // Ignorar frames no conformes
        }
      });

      this.ws.on('error', (err) => {
        console.warn(`⚠️ [LivePriceFeed] Advertencia de socket Binance:`, err.message);
      });

      this.ws.on('close', (code, reason) => {
        if (!this.isRunning) return;
        const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 15000);
        this.reconnectAttempts++;
        console.warn(`⚠️ [LivePriceFeed] Conexión cerrada (${code} - ${reason.toString()}). Reconectando en ${Math.round(delay)}ms...`);
        this.reconnectTimer = setTimeout(() => this.connect(), delay);
      });
    } catch (err: any) {
      console.error(`❌ [LivePriceFeed] Error al inicializar conexión:`, err.message);
      if (this.isRunning) {
        this.reconnectTimer = setTimeout(() => this.connect(), 5000);
      }
    }
  }

  /**
   * Carga semillero REST inicial de precios de mercado
   */
  private async seedInitialPricesRest(): Promise<void> {
    try {
      const symbols = Object.keys(this.symbolToTicker);
      const url = `https://api.binance.com/api/v3/ticker/price?symbols=${JSON.stringify(symbols)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return;
      const data = await res.json() as Array<{ symbol: string; price: string }>;
      for (const item of data) {
        if (item.symbol && item.price) {
          const priceMicro = LivePriceFeed.parsePriceToMicroUsd(item.price);
          const mapping = this.symbolToTicker[item.symbol] || { ticker: `${item.symbol}/USD`, base: item.symbol };
          this.latestPrices.set(item.symbol, priceMicro);
          this.latestPrices.set(mapping.ticker, priceMicro);
          this.latestPrices.set(mapping.base, priceMicro);
        }
      }
      console.log(`🌱 [LivePriceFeed] Precios base de mercado precargados exitosamente (${symbols.length} activos).`);
    } catch {
      // Ignorar fallback REST si el WS conecta primero
    }
  }
}
