/**
 * NEXUS QUANT SUITE v3.0 - REAL NEWS POLLER (EXPANDED MULTI-SOURCE FEEDS)
 * 
 * Ingesta noticias reales recién publicadas de las fuentes más importantes del ecosistema cripto:
 * - CoinDesk (Tier 1)
 * - The Block (Tier 1)
 * - CoinTelegraph (Tier 2)
 * - Decrypt (Tier 2)
 * 
 * Pipeline de filtrado y ejecución institucional:
 * 1. Sanitización anti-phishing (I_seguridad).
 * 2. Deduplicación y corroboración cruzada SimHash con CatalystCorroborationBuffer (Hamming <= 3).
 * 3. Cálculo de edad real de la noticia desde <pubDate> y decaimiento exponencial e^(-lambda * dt).
 * 4. Descarte automático de noticias con antigüedad > 3 a 5 minutos.
 * 5. Compuerta anti-insider (I_no-leak) y confirmación de flujo L2.
 */

import { NewsWsIngestor } from './news_ws_ingestor.js';
import { SimHash64, CatalystCorroborationBuffer } from './simhash_deduplicator.js';
import { OnnxZeroShotClassifier } from './onnx_zero_shot_classifier.js';
import { GlobalL2RingBufferManager } from '../core/ring_buffer_l2.js';
import { calcExpDecayBps } from '../core/math_bigint.js';

export type NewsSourceId = 'COINDESK' | 'COINTELEGRAPH' | 'DECRYPT' | 'THEBLOCK' | string;

export interface RealCatalystFeedEvent {
  eventId: string;
  simhash64Hex: string;
  headline: string;
  sources: string[];
  primaryTicker: string;
  category: string;
  direction: number; // 1 = Bull, -1 = Bear
  siaBps: number;
  sourceTrustBps: number;
  flowConfirmBps: number;
  preEventDrift15mBps: number;
  iSecurity: number;
  iNoLeak: number;
  decayFactorBps: number;
  convictionCtBps: number;
  actionTaken: 'STRIKE_T1' | 'PROBE_T2' | 'PANIC_SHORT' | 'QUARANTINE' | 'DROPPED';
  publishedAt: string;
  articleUrl?: string;
}

export type NewsEventCallback = (event: RealCatalystFeedEvent) => Promise<void> | void;

export class RealNewsPoller {
  public static readonly MAX_NEWS_AGE_MS: number = 300_000; // 5 minutos de antigüedad máxima permitida
  public static readonly LAMBDA_DECAY_BPS: bigint = 1500n;   // 0.15 s^-1

  private ingestor: NewsWsIngestor;
  private classifier: OnnxZeroShotClassifier;
  private corroborationBuffer: CatalystCorroborationBuffer;
  private ringBufferManager: GlobalL2RingBufferManager | null = null;
  private seenUrls: Set<string> = new Set();
  private lastDispatchedMs: number = Date.now();
  private callbacks: NewsEventCallback[] = [];
  private pollInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  constructor() {
    this.ingestor = new NewsWsIngestor();
    this.classifier = new OnnxZeroShotClassifier();
    this.corroborationBuffer = new CatalystCorroborationBuffer(3_600_000n);
  }

  public setRingBufferManager(mgr: GlobalL2RingBufferManager): void {
    this.ringBufferManager = mgr;
  }

  public onNews(cb: NewsEventCallback): void {
    this.callbacks.push(cb);
  }

  public start(intervalMs: number = 30_000): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastDispatchedMs = Date.now();

    // Primera carga inmediata de todas las fuentes
    this.pollAllSources().catch(() => {});

    // Ciclo periódico de consulta a feeds RSS multi-fuente
    this.pollInterval = setInterval(() => {
      this.pollAllSources().catch(() => {});
    }, intervalMs);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  public async pollAllSources(): Promise<void> {
    await Promise.allSettled([
      this.pollCoinDesk(),
      this.pollCoinTelegraph(),
      this.pollDecrypt(),
      this.pollTheBlock()
    ]);
  }

  private async pollCoinDesk(): Promise<void> {
    try {
      const res = await fetch('https://www.coindesk.com/arc/outboundfeeds/rss/', {
        headers: { 'User-Agent': 'NexusQuantSuite/3.0' },
        signal: AbortSignal.timeout(6000)
      });
      if (!res.ok) return;
      const xml = await res.text();
      await this.parseAndDispatchXml(xml, 'COINDESK');
    } catch {
      // Silenciar errores temporales de red
    }
  }

  private async pollCoinTelegraph(): Promise<void> {
    try {
      const res = await fetch('https://cointelegraph.com/rss', {
        headers: { 'User-Agent': 'NexusQuantSuite/3.0' },
        signal: AbortSignal.timeout(6000)
      });
      if (!res.ok) return;
      const xml = await res.text();
      await this.parseAndDispatchXml(xml, 'COINTELEGRAPH');
    } catch {
      // Silenciar errores temporales de red
    }
  }

  private async pollDecrypt(): Promise<void> {
    try {
      const res = await fetch('https://decrypt.co/feed', {
        headers: { 'User-Agent': 'NexusQuantSuite/3.0' },
        signal: AbortSignal.timeout(6000)
      });
      if (!res.ok) return;
      const xml = await res.text();
      await this.parseAndDispatchXml(xml, 'DECRYPT');
    } catch {
      // Silenciar errores temporales de red
    }
  }

  private async pollTheBlock(): Promise<void> {
    try {
      const res = await fetch('https://www.theblock.co/rss.xml', {
        headers: { 'User-Agent': 'NexusQuantSuite/3.0' },
        signal: AbortSignal.timeout(6000)
      });
      if (!res.ok) return;
      const xml = await res.text();
      await this.parseAndDispatchXml(xml, 'THEBLOCK');
    } catch {
      // Silenciar errores temporales de red
    }
  }

  private cleanXmlText(raw: string): string {
    let cleaned = raw.trim();
    const cdataMatch = cleaned.match(/<!\[CDATA\[([\s\S]*?)\]\]>/i);
    if (cdataMatch) {
      cleaned = cdataMatch[1].trim();
    }
    return cleaned
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#038;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private async parseAndDispatchXml(
    xml: string,
    source: NewsSourceId
  ): Promise<void> {
    const items = [...xml.matchAll(/<(?:item|entry)[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi)];

    for (const item of items) {
      const text = item[1];
      const titleMatch = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const linkMatch = text.match(/<link[^>]*>([\s\S]*?)<\/link>/i)
        || text.match(/<link[^>]+href=["']([^"']+)["']/i);
      const pubDateMatch = text.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)
        || text.match(/<dc:date[^>]*>([\s\S]*?)<\/dc:date>/i)
        || text.match(/<published[^>]*>([\s\S]*?)<\/published>/i)
        || text.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i);

      if (!titleMatch) continue;
      const headline = this.cleanXmlText(titleMatch[1]);
      if (!headline) continue;

      let articleUrl = '';
      if (linkMatch) {
        articleUrl = this.cleanXmlText(linkMatch[1]);
      }

      // Parsear fecha real de publicación (<pubDate>) para cálculo preciso de edad delta t
      let publishedMs = Date.now();
      if (pubDateMatch) {
        const rawDate = this.cleanXmlText(pubDateMatch[1]);
        const parsed = Date.parse(rawDate);
        if (!isNaN(parsed) && parsed > 0) {
          publishedMs = parsed;
        }
      }

      if (this.seenUrls.has(headline)) continue;
      this.seenUrls.add(headline);
      if (this.seenUrls.size > 200) {
        const first = this.seenUrls.values().next().value;
        if (first) this.seenUrls.delete(first);
      }

      await this.processHeadline(headline, articleUrl, source, publishedMs);
    }
  }

  public async processHeadline(
    headline: string,
    articleUrl: string,
    source: NewsSourceId,
    publishedMs?: number
  ): Promise<RealCatalystFeedEvent | null> {
    const now = Date.now();
    const effectivePublishedMs = publishedMs !== undefined ? publishedMs : now;
    const isFutureTimestamp = effectivePublishedMs > (now + 60_000); // Marca en el futuro > 1 min
    const ageMs = Math.max(0, now - effectivePublishedMs);

    // 1. Sanitización con NewsWsIngestor (I_seguridad anti-phishing)
    const sanitized = this.ingestor.sanitize({
      rawId: `RAW_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      source,
      headline,
      url: articleUrl,
      publishedAtMs: BigInt(effectivePublishedMs),
      ingestedAtMs: BigInt(now)
    });

    const iSecurity = sanitized.isSecuritySafe ? 1 : 0;

    // 2. Extracción de Ticker y Clasificación Semántica Zero-Shot (<1ms)
    const primaryTicker = this.extractPrimaryTicker(sanitized.sanitizedText);
    const inferred = this.inferDirectionAndCategory(sanitized.sanitizedText);
    const inference = await this.classifier.classify(sanitized.sanitizedText);

    // Determinar dirección y categoría con fusión inteligente
    let direction = inferred.direction;
    if (inference.pBearBps > 8200n && inference.pBearBps > inference.pBullBps) {
      direction = -1;
    } else if (inference.pBullBps > 8200n && inference.pBullBps > inference.pBearBps) {
      direction = 1;
    }

    const category = inference.category !== 'MACRO' ? inference.category : inferred.category;

    // 3. Filtrado Anti-Fake News con Corroboración Cruzada SimHash (Hamming <= 3)
    const baseTrustBps = source === 'COINDESK'
      ? 9500n
      : source === 'THEBLOCK'
        ? 9400n
        : source === 'COINTELEGRAPH'
          ? 9200n
          : source === 'DECRYPT'
            ? 9100n
            : 9000n;

    const corroboration = this.corroborationBuffer.ingestAndDeduplicate(
      sanitized.sanitizedText,
      [primaryTicker],
      source,
      baseTrustBps,
      BigInt(now)
    );

    const fused = corroboration.event;
    const sourcesList = Array.from(fused.sources);
    if (!sourcesList.includes(source)) {
      sourcesList.push(source);
    }
    const sourceTrustBps = Number(fused.combinedTrustBps);

    // 4. Confirmación de flujo L2 (OBI y volumen taker) y deriva en 15m (I_no-leak)
    let flowConfirmBps = 5000;
    let preEventDrift15mBps = 0;

    if (this.ringBufferManager) {
      const ringBuf = this.ringBufferManager.getOrCreate(primaryTicker);
      const dynamicFlow = Number(ringBuf.getFlowConfirmationBps(direction));
      if (dynamicFlow > 0) flowConfirmBps = dynamicFlow;
      const rawDrift = ringBuf.get15mDriftBps(BigInt(now));
      preEventDrift15mBps = rawDrift !== null ? Math.abs(Number(rawDrift)) : 0;
    }

    const iNoLeak = preEventDrift15mBps < 150 ? 1 : 0;

    // 5. Decaimiento Exponencial Dinámico e^(-lambda * dt)
    // Descartar automáticamente noticias con antigüedad > 3 a 5 minutos (300,000 ms) o fechas en el futuro
    const isStaleNews = isFutureTimestamp || ageMs > RealNewsPoller.MAX_NEWS_AGE_MS;
    let decayFactorBps = 0;

    if (!isStaleNews) {
      decayFactorBps = Number(calcExpDecayBps(RealNewsPoller.LAMBDA_DECAY_BPS, BigInt(ageMs)));
      if (decayFactorBps < 0) decayFactorBps = 0;
      if (decayFactorBps > 10000) decayFactorBps = 10000;
    }

    // 6. Ecuación Maestra de Convicción C_t (Ponderación: 45% SIA + 35% Tfuente + 20% Φflujo)
    let siaBps = Number(inference.semanticConvictionSiaBps);
    if (siaBps === 0) {
      siaBps = direction === -1 ? 8600 : 8800;
    }

    const rawWeightedBps = Math.floor(
      (4500 * siaBps + 3500 * sourceTrustBps + 2000 * flowConfirmBps) / 10000
    );

    const convictionCtBps = (iSecurity === 0 || iNoLeak === 0 || isStaleNews)
      ? 0
      : Math.floor((rawWeightedBps * decayFactorBps) / 10000);

    // 7. Matriz de Disparo Institucional (STRIKE_T1, PROBE_T2, PANIC_SHORT, QUARANTINE, DROPPED)
    let actionTaken: RealCatalystFeedEvent['actionTaken'] = 'DROPPED';
    if (iSecurity === 0 || iNoLeak === 0) {
      actionTaken = 'QUARANTINE';
    } else if (isStaleNews) {
      actionTaken = 'DROPPED';
    } else if (direction === -1) {
      // Posiciones Cortas (SHORT) ante Hacks, Demandas Regulatorias o Tensión de Mercado
      const isCriticalBearish =
        category === 'HACK' ||
        category === 'REGULATORY' ||
        category === 'REGULATORY_ENFORCEMENT' ||
        category === 'MARKET_STRESS';

      if (convictionCtBps >= 7000 || (convictionCtBps >= 6500 && isCriticalBearish)) {
        actionTaken = 'PANIC_SHORT';
      } else if (convictionCtBps >= 4500) {
        actionTaken = 'QUARANTINE';
      }
    } else {
      // Posiciones Largas (LONG) por Aprobaciones ETF, Inyecciones de Liquidez o Expansión
      if (convictionCtBps >= 8000) {
        actionTaken = 'STRIKE_T1';
      } else if (convictionCtBps >= 6800) {
        actionTaken = 'PROBE_T2';
      } else if (convictionCtBps >= 4500) {
        actionTaken = 'QUARANTINE';
      }
    }

    const event: RealCatalystFeedEvent = {
      eventId: `EVT_${source}_${Date.now().toString().substring(7)}`,
      simhash64Hex: fused.simhash64Hex,
      headline,
      sources: sourcesList.length > 0 ? sourcesList : [source],
      primaryTicker,
      category,
      direction,
      siaBps,
      sourceTrustBps,
      flowConfirmBps,
      preEventDrift15mBps,
      iSecurity,
      iNoLeak,
      decayFactorBps,
      convictionCtBps,
      actionTaken,
      publishedAt: new Date(effectivePublishedMs).toLocaleTimeString(),
      articleUrl
    };

    this.lastDispatchedMs = Date.now();

    for (const cb of this.callbacks) {
      try { cb(event); } catch { /* ignore */ }
    }

    return event;
  }

  private extractPrimaryTicker(text: string): string {
    const upper = text.toUpperCase();
    if (upper.includes('SOLANA') || upper.includes('SOL ')) return 'SOL';
    if (upper.includes('BITCOIN') || upper.includes('BTC')) return 'BTC';
    if (upper.includes('ETHEREUM') || upper.includes('ETH')) return 'ETH';
    if (upper.includes('AVALANCHE') || upper.includes('AVAX')) return 'AVAX';
    if (upper.includes('NEAR')) return 'NEAR';
    if (upper.includes('RIPPLE') || upper.includes('XRP')) return 'XRP';
    if (upper.includes('BINANCE') || upper.includes('BNB')) return 'BNB';
    return 'SOL'; // Activo base
  }

  private inferDirectionAndCategory(text: string): { direction: number; category: string } {
    const lower = text.toLowerCase();

    // Categorías de Riesgo / Bajistas
    if (lower.includes('hack') || lower.includes('breach') || lower.includes('stole') || lower.includes('drain') || lower.includes('exploit')) {
      return { direction: -1, category: 'HACK' };
    }
    if (lower.includes('lawsuit') || lower.includes('sec') || lower.includes('charges') || lower.includes('arrest') || lower.includes('illicit') || lower.includes('cut off')) {
      return { direction: -1, category: 'REGULATORY_ENFORCEMENT' };
    }
    if (lower.includes('crash') || lower.includes('plunge') || lower.includes('liquidat') || lower.includes('drop')) {
      return { direction: -1, category: 'MARKET_STRESS' };
    }

    // Categorías Alcistas
    if (lower.includes('approve') || lower.includes('etf') || lower.includes('treasury') || lower.includes('reserve')) {
      return { direction: 1, category: 'ETF_APPROVAL' };
    }
    if (lower.includes('partnership') || lower.includes('invest') || lower.includes('surge') || lower.includes('rally') || lower.includes('high')) {
      return { direction: 1, category: 'LIQUIDITY_SURGE' };
    }

    return { direction: 1, category: 'ECOSYSTEM_DEVELOPMENT' };
  }
}
