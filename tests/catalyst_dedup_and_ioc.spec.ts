import { describe, it, expect, beforeEach } from 'vitest';
import { AhoCorasickExtractor, SimHash64, CatalystCorroborationBuffer } from '../src/engine_b_catalyst/simhash_deduplicator.js';
import { OnnxZeroShotClassifier } from '../src/engine_b_catalyst/onnx_zero_shot_classifier.js';
import { ConsensusAndDriftGate, ConvictionCalculationInput } from '../src/engine_b_catalyst/consensus_and_drift_gate.js';
import { NewsWsIngestor, RawNewsItem } from '../src/engine_b_catalyst/news_ws_ingestor.js';
import { AnchoredIocRouter, AnchoredRoutingParams } from '../src/engine_b_catalyst/anchored_ioc_router.js';
import { CatalystVelocityDecayExitManager, CatalystPosition } from '../src/engine_b_catalyst/velocity_decay_exit.js';

describe('FASE 3: Motor B - Catalyst Engine (Deduplicación SimHash, Inferencia INT8 & Anchored IOC)', () => {
  describe('Extractor Aho-Corasick y Deduplicación SimHash 64-bit', () => {
    it('extrae tickers y palabras clave en menos de 1ms', () => {
      const keywords = ['BTC', 'ETH', 'SOL', 'SEC', 'ETF', 'APPROVED', 'HACK'];
      const extractor = new AhoCorasickExtractor(keywords);

      const headline = 'BREAKING: SEC Officially APPROVED BlackRock Spot SOL ETF';
      const start = performance.now();
      const matches = extractor.extractMatches(headline);
      const latency = performance.now() - start;

      expect(matches).toContain('SEC');
      expect(matches).toContain('APPROVED');
      expect(matches).toContain('SOL');
      expect(matches).toContain('ETF');
      expect(latency).toBeLessThan(1.0); // < 1ms
    });

    it('calcula SimHash de 64 bits y detecta distancia de Hamming <= 3 en titulares similares', () => {
      const text1 = 'SEC approves BlackRock spot Ethereum ETF application';
      const text2 = 'SEC approves Blackrock Spot Ethereum ETF Application!'; // Variación menor

      const hash1 = SimHash64.compute(text1);
      const hash2 = SimHash64.compute(text2);

      const dist = SimHash64.hammingDistance(hash1, hash2);
      expect(dist).toBeLessThanOrEqual(3);
    });

    it('fusiona fuentes en búfer de cuarentena y combina confianza Bayesiana sin re-ejecutar IA', () => {
      const buffer = new CatalystCorroborationBuffer();
      const t0 = 1_000_000n;

      // 1. Fuente 1 (Tree of Alpha, Tier 2 = 8000 bps)
      const res1 = buffer.ingestAndDeduplicate(
        'Binance will list Render RNDR token for trading',
        ['RNDR'],
        'TREE_OF_ALPHA',
        8000n,
        t0
      );

      expect(res1.isDuplicate).toBe(false);
      expect(res1.event.combinedTrustBps).toBe(8000n);
      expect(res1.event.corroboratedCount).toBe(1);

      // 2. Fuente 2 (Reuters, Tier 2 = 8000 bps) llega 1.5s después con titular casi idéntico
      const res2 = buffer.ingestAndDeduplicate(
        'Binance will list Render RNDR token for trading now',
        ['RNDR'],
        'REUTERS',
        8000n,
        t0 + 1500n
      );

      expect(res2.isDuplicate).toBe(true);
      expect(res2.event.corroboratedCount).toBe(2);

      // Fusión Bayesiana: 1 - (1 - 0.8) * (1 - 0.8) = 1 - 0.04 = 0.96 (9600 bps)
      expect(res2.event.combinedTrustBps).toBe(9600n);
    });
  });

  describe('Inferencia Determinista INT8 y Convicción Semántica S_IA', () => {
    let classifier: OnnxZeroShotClassifier;

    beforeEach(() => {
      classifier = new OnnxZeroShotClassifier();
    });

    it('entrega convicción alta en anuncio regulatorio o listado explícito', async () => {
      const text = 'SEC APPROVED SPOT SOLANA ETF FOR ALL EXCHANGES';
      const res = await classifier.classify(text);

      expect(res.category).toBe('REGULATORY');
      expect(res.pBullBps).toBeGreaterThan(9000n);
      expect(res.semanticConvictionSiaBps).toBeGreaterThan(8000n);
      expect(res.latencyMs).toBeLessThan(18.0); // < 18ms
    });

    it('aplica la regla inmutable: S_IA = 0 si la probabilidad máxima es < 82.00% (8200 bps)', async () => {
      const ambiguousText = 'Solana community discusses potential future improvements in quarterly call';
      const res = await classifier.classify(ambiguousText);

      expect(res.semanticConvictionSiaBps).toBe(0n); // Debe ser exactamente 0
    });
  });

  describe('Compuerta Maestra de Convicción C_t y Mitigación de Fallas Letales', () => {
    let gate: ConsensusAndDriftGate;
    let ingestor: NewsWsIngestor;
    const t0 = 1_000_000n;

    beforeEach(() => {
      gate = new ConsensusAndDriftGate();
      ingestor = new NewsWsIngestor();
    });

    it('VECTOR 1: Bloquea cuenta falsa de X (Tier 3) sin confirmación de flujo (Tope <= 4000 bps -> QUARANTINE)', () => {
      // Simula rumor en Twitter de cuenta verificada
      const input: ConvictionCalculationInput = {
        semanticConvictionSiaBps: 8500n, // IA cree que es alcista
        sourceTrustBps: 9000n, // Supuesta confianza alta
        sourceTier: 3, // RED SOCIAL X (Tope 4000 bps)
        corroboratedSourceCount: 1, // Fuente única no confirmada
        flowConfirmationBps: 3000n, // Sin flujo L2
        isSecuritySafe: true,
        preEventDrift15mBps: 50n,
        isMajorAsset: true,
        category: 'REGULATORY',
        direction: 1,
        publishedAtMs: t0,
        ingestedAtMs: t0 + 200n
      };

      const res = gate.evaluate(input);
      // El resultado debe ir a CUARENTENA con 0% de capital real
      expect(res.action).toBe('QUARANTINE');
      expect(res.allocationQuotaBps).toBe(0n);
      expect(res.portfolioAllocationBps).toBe(0n);
    });

    it('VECTOR 2: Bloquea trampa de Insiders (Buy Rumor, Sell News) si drift 15m > 220 bps en Majors', () => {
      const input: ConvictionCalculationInput = {
        semanticConvictionSiaBps: 9500n,
        sourceTrustBps: 10000n, // Tier 1 directa
        sourceTier: 1,
        corroboratedSourceCount: 1,
        flowConfirmationBps: 8000n,
        isSecuritySafe: true,
        preEventDrift15mBps: 350n, // +3.50% de drift en 15m (> 220 bps para Majors)
        isMajorAsset: true,
        category: 'REGULATORY',
        direction: 1,
        publishedAtMs: t0,
        ingestedAtMs: t0 + 100n
      };

      const res = gate.evaluate(input);
      expect(res.action).toBe('DROPPED');
      expect(res.iNoLeak).toBe(0); // Compuerta Ino-leak = 0
      expect(res.rejectReason).toContain('GATE_REJECT_INSIDER_DRIFT');
    });

    it('VECTOR 3: Bloquea anuncio malicioso con direcciones 0x... o términos de phishing (I_seguridad = 0)', () => {
      const rawPhish: RawNewsItem = {
        rawId: 'NEWS_HACK',
        source: 'X_TWITTER_VERIFIED',
        headline: 'Claim official ETF airdrop at https://claim-sol-etf-airdrop.xyz for contract 0x71c26909871790471b07',
        publishedAtMs: t0,
        ingestedAtMs: t0 + 50n
      };

      const sanitized = ingestor.sanitize(rawPhish);
      expect(sanitized.isSecuritySafe).toBe(false);

      const input: ConvictionCalculationInput = {
        semanticConvictionSiaBps: 9000n,
        sourceTrustBps: 4000n,
        sourceTier: 3,
        corroboratedSourceCount: 1,
        flowConfirmationBps: 5000n,
        isSecuritySafe: sanitized.isSecuritySafe, // FALSE
        preEventDrift15mBps: 0n,
        isMajorAsset: false,
        category: 'MACRO',
        direction: 1,
        publishedAtMs: t0,
        ingestedAtMs: t0 + 50n
      };

      const res = gate.evaluate(input);
      expect(res.action).toBe('DROPPED');
      expect(res.iSecurity).toBe(0);
      expect(res.rejectReason).toContain('GATE_REJECT_SECURITY');
    });

    it('dispara STRIKE_TIER_1 con 100% de cupo ante evento Tier 1 con flujo confirmado y C_t >= 82', () => {
      const input: ConvictionCalculationInput = {
        semanticConvictionSiaBps: 9200n,
        sourceTrustBps: 10000n, // Tier 1 directa SEC
        sourceTier: 1,
        corroboratedSourceCount: 1,
        flowConfirmationBps: 7500n, // Flujo L2 > 6500 bps
        isSecuritySafe: true,
        preEventDrift15mBps: 40n, // Sin insider drift
        isMajorAsset: true,
        category: 'REGULATORY',
        direction: 1,
        publishedAtMs: t0,
        ingestedAtMs: t0 + 100n // Latencia 100ms
      };

      const res = gate.evaluate(input);
      expect(res.action).toBe('STRIKE_TIER_1');
      expect(res.allocationQuotaBps).toBe(10000n); // 100% del cupo
      expect(res.portfolioAllocationBps).toBe(1000n); // 10% del portafolio
    });
  });

  describe('Anchored IOC Router y Salida por Velocidad', () => {
    let router: AnchoredIocRouter;
    let exitManager: CatalystVelocityDecayExitManager;
    const t0 = 1_000_000n;
    const anchorPrice = 200_000_000n; // $200.00 USD (Pmid en t0 - 500ms)

    beforeEach(() => {
      router = new AnchoredIocRouter();
      exitManager = new CatalystVelocityDecayExitManager();
    });

    it('envía orden Limit IOC con tope duro Pcap y piso PSL = Panchor - 45 bps', () => {
      const params: AnchoredRoutingParams = {
        orderId: 'ORD_CAT_01',
        ticker: 'SOL/USD',
        side: 1,
        isMajor: true,
        notionalMicroUsd: 10_000_000_000n,
        anchorPriceMicroUsd: anchorPrice,
        currentPriceMicroUsd: 201_000_000n, // $201.00 (+50 bps desde anchor)
        timestampMs: t0
      };

      const order = router.routeOrder(params);
      expect(order.orderType).toBe('LIMIT_IOC');
      // Pcap = $200 * (1 + 1.50%) = $203.00
      expect(order.limitPriceMicroUsd).toBe(203_000_000n);
      // PSL = $200 * (1 - 0.0045) = $199.10
      expect(order.serverStopLossMicroUsd).toBe(199_100_000n);
      expect(order.cancelAllAfterMs).toBe(5000); // Dead-Man's switch
    });

    it('Late-Entry Abort: prohíbe compra directa si precio se alejó > 1.20% (Majors) y coloca límite al 50%', () => {
      const params: AnchoredRoutingParams = {
        orderId: 'ORD_CAT_LATE',
        ticker: 'SOL/USD',
        side: 1,
        isMajor: true,
        notionalMicroUsd: 10_000_000_000n,
        anchorPriceMicroUsd: anchorPrice,
        currentPriceMicroUsd: 203_000_000n, // $203.00 (+150 bps > 120 bps)
        timestampMs: t0
      };

      const order = router.routeOrder(params);
      expect(order.orderType).toBe('PULLBACK_PASSIVE_LIMIT');
      // Impulso = $3.00. 50% = $1.50 -> Plimit = $201.50
      expect(order.limitPriceMicroUsd).toBe(201_500_000n);
    });

    it('gestiona salida por velocidad: Time-Stop 45s si PnL < +75 bps, y De-Risk 65% en +180 bps', () => {
      const pos: CatalystPosition = {
        positionId: 'CAT_POS_01',
        ticker: 'SOL/USD',
        isMajor: true,
        side: 1,
        entryPriceMicroUsd: 200_000_000n,
        peakPriceMicroUsd: 200_000_000n,
        currentStopLossMicroUsd: 199_100_000n,
        totalQuantityAtomic: 50_000_000_000n, // 50 SOL
        remainingQuantityAtomic: 50_000_000_000n,
        openedAtMs: t0,
        isDeRisked: false,
        isClosed: false
      };

      // 1. Time-Stop a los 46s con ganancia débil (+30 bps < +75 bps)
      const resStagnant = exitManager.evaluate(pos, 200_600_000n, t0 + 46_000n);
      expect(resStagnant.action).toBe('TIME_STOP_45S');
      expect(resStagnant.quantityToCloseAtomic).toBe(50_000_000_000n);

      // 2. De-Risk al alcanzar +180 bps (+1.80% en Majors -> $203.60)
      const resDeRisk = exitManager.evaluate(pos, 203_600_000n, t0 + 10_000n);
      expect(resDeRisk.action).toBe('DERISK_65PCT');
      expect(resDeRisk.quantityToCloseAtomic).toBe(32_500_000_000n); // 65% de 50
      // Stop sube a BE + 25 bps ($200.50)
      expect(resDeRisk.updatedStopLossMicroUsd).toBe(200_500_000n);
    });
  });
});
