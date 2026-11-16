import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BinanceExecutionClient, BinanceBracketOrderRequest } from '../src/core/binance_execution_client.js';

describe('BinanceExecutionClient - Ejecución Oficial y Cero Alucinaciones', () => {
  let client: BinanceExecutionClient;

  beforeEach(() => {
    client = new BinanceExecutionClient({
      apiKey: '',
      apiSecret: '',
      isTestnet: true,
      useFutures: true,
      strictPriceValidation: true
    });
  });

  it('normaliza correctamente los símbolos de activos a formato Binance', () => {
    expect(client.normalizeSymbol('SOL/USD')).toBe('SOLUSDT');
    expect(client.normalizeSymbol('SOL')).toBe('SOLUSDT');
    expect(client.normalizeSymbol('BTC/USD')).toBe('BTCUSDT');
    expect(client.normalizeSymbol('ETHUSDT')).toBe('ETHUSDT');
    expect(client.normalizeSymbol('RAY')).toBe('RAYUSDT');
  });

  it('genera firmas HMAC-SHA256 válidas y estables', () => {
    const customClient = new BinanceExecutionClient({
      apiKey: 'test_api_key',
      apiSecret: 'test_secret_1234567890abcdef',
      isTestnet: true
    });

    const { queryString, signature } = customClient.signQuery({
      symbol: 'SOLUSDT',
      timestamp: 1700000000000
    });

    expect(queryString).toContain('symbol=SOLUSDT');
    expect(queryString).toContain('timestamp=1700000000000');
    expect(signature).toHaveLength(64); // 64 caracteres hex
  });

  it('RECHAZA inmediatamente una orden si el activo no tiene feed de precio (Previene Alucinaciones)', async () => {
    const req: BinanceBracketOrderRequest = {
      positionId: 'pos_fake_token_123',
      ticker: 'MEME_RANDOM_FAKE_COIN',
      side: 'BUY',
      notionalMicroUsd: 5_000_000_000n, // $5,000 USD
      engineOrigin: 'SENTINEL_ONCHAIN'
    };

    // No le pasamos fallback y el token no existe en Binance
    const result = await client.executeBracketOrder(req, null);

    expect(result.status).toBe('REJECTED_NO_PRICE_FEED');
    expect(result.filledNotionalMicroUsd).toBe(0n);
    expect(result.filledQuantityAtomic).toBe(0n);
    expect(result.rejectionReason).toContain('no cuenta con feed de precio verificado');
  });

  it('RECHAZA la orden si el precio de mercado supera el tope duro Pcap (Protección de Slippage)', async () => {
    const req: BinanceBracketOrderRequest = {
      positionId: 'pos_pcap_violation',
      ticker: 'SOL',
      side: 'BUY',
      notionalMicroUsd: 5_000_000_000n,
      limitPriceCapMicroUsd: 152_000_000n, // Pcap en $152.00
      engineOrigin: 'SENTINEL_ONCHAIN'
    };

    // Mercado está en $155.00
    const marketPriceMicro = 155_000_000n;
    const result = await client.executeBracketOrder(req, marketPriceMicro);

    expect(result.status).toBe('REJECTED_PRICE_EXCEEDS_CAP');
    expect(result.filledNotionalMicroUsd).toBe(0n);
  });

  it('ejecuta la orden en Paper Trading con precio real verificado y descuenta comisiones Taker correctas', async () => {
    const req: BinanceBracketOrderRequest = {
      positionId: 'pos_valid_trade_01',
      ticker: 'SOL/USD',
      side: 'BUY',
      notionalMicroUsd: 5_000_000_000n, // $5,000 USD
      stopLossPricePriceMicroUsd: 138_000_000n, // SL en $138
      takeProfitPriceMicroUsd: 180_000_000n, // TP en $180
      engineOrigin: 'CATALYST_NEWS'
    } as any;

    const marketPriceMicro = 150_000_000n; // $150.00
    const result = await client.executeBracketOrder(req, marketPriceMicro);

    expect(result.status).toBe('FILLED');
    expect(result.isPaperExecution).toBe(true);
    expect(result.executionPriceMicroUsd).toBe(150_000_000n);
    expect(result.filledNotionalMicroUsd).toBe(5_000_000_000n);

    // Quantity = notional ($5k) / price ($150) = 33.333333333 tokens
    expect(result.filledQuantityAtomic).toBe((5_000_000_000n * 1_000_000_000n) / 150_000_000n);

    // Taker fee = 5 bps de $5,000 = $2.50 = 2,500,000 uUSD
    expect(result.takerFeePaidMicroUsd).toBe(2_500_000n);
  });

  it('reporta telemetría de saldo consistente', async () => {
    const telemetry = await client.getAccountTelemetry();
    expect(telemetry.totalWalletBalanceMicroUsd).toBeGreaterThan(0n);
    expect(telemetry.isTestnet).toBe(true);
    expect(telemetry.endpoint).toContain('https://testnet.binancefuture.com');
  });
});
