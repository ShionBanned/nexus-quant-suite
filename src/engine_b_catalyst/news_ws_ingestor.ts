/**
 * NEXUS QUANT SUITE v2.0 - CATALYST NEWS WS INGESTOR
 * 
 * Ingesta streaming multi-fuente en tiempo real y sanitización anti-phishing.
 * Calcula la compuerta I_seguridad ∈ {0, 1}:
 * Vale 0 si el texto incluye direcciones hexadecimales 0x..., URLs externas
 * no autorizadas o términos sospechosos de phishing (claim, airdrop, migrate).
 */

export interface RawNewsItem {
  rawId: string;
  source: string; // e.g., 'SEC_EDGAR', 'BINANCE_ANNOUNCEMENT', 'TREE_OF_ALPHA', 'X_TWITTER_VERIFIED'
  headline: string;
  body?: string;
  url?: string;
  publishedAtMs: bigint;
  ingestedAtMs: bigint;
}

export interface SanitizedNewsEvent {
  newsId: string;
  source: string;
  sanitizedText: string;
  isSecuritySafe: boolean; // I_seguridad: true = 1, false = 0
  securityRejectReason?: string;
  publishedAtMs: bigint;
  ingestedAtMs: bigint;
}

export class NewsWsIngestor {
  private readonly phishingKeywords: RegExp = /\b(claim|airdrop|migrate|mint\s*now|giveaway|connect\s*wallet|free\s*tokens|bonus\s*reward)\b/i;
  private readonly hexAddressRegex: RegExp = /0x[a-fA-F0-9]{40}/;
  private readonly solanaAddressRegex: RegExp = /\b[1-9A-HJ-NP-za-km-z]{32,44}\b/;
  private readonly suspiciousUrlRegex: RegExp = /https?:\/\/(?!(www\.)?(sec\.gov|binance\.com|reuters\.com|bloomberg\.com|prnewswire\.com|treeofalpha\.com|coindesk\.com|cointelegraph\.com|decrypt\.co|theblock\.co)(?:[\/\s:?#]|$))[^\s]+/i;

  /**
   * Sanitiza y evalúa la compuerta I_seguridad del contenido de la noticia.
   */
  public sanitize(raw: RawNewsItem): SanitizedNewsEvent {
    const fullText = `${raw.headline} ${raw.body || ''}`.trim();

    // 1. Detección de Direcciones Hexadecimales (0x...) o contratos en texto
    if (this.hexAddressRegex.test(fullText)) {
      return {
        newsId: raw.rawId,
        source: raw.source,
        sanitizedText: fullText,
        isSecuritySafe: false,
        securityRejectReason: 'SECURITY_HACK_DETECTED: Text contains hexadecimal contract address (0x...)',
        publishedAtMs: raw.publishedAtMs,
        ingestedAtMs: raw.ingestedAtMs
      };
    }

    // 2. Detección de Palabras Clave de Phishing / Drainers
    if (this.phishingKeywords.test(fullText)) {
      return {
        newsId: raw.rawId,
        source: raw.source,
        sanitizedText: fullText,
        isSecuritySafe: false,
        securityRejectReason: 'SECURITY_PHISHING_DETECTED: Text contains blacklisted drainer/phishing terms',
        publishedAtMs: raw.publishedAtMs,
        ingestedAtMs: raw.ingestedAtMs
      };
    }

    // 3. Detección de Enlaces Externos No Autorizados
    if (this.suspiciousUrlRegex.test(fullText) || (raw.url && this.suspiciousUrlRegex.test(raw.url))) {
      return {
        newsId: raw.rawId,
        source: raw.source,
        sanitizedText: fullText,
        isSecuritySafe: false,
        securityRejectReason: 'SECURITY_UNAUTHORIZED_URL: Text references unverified external URL',
        publishedAtMs: raw.publishedAtMs,
        ingestedAtMs: raw.ingestedAtMs
      };
    }

    // Limpieza de caracteres de control o invisibles
    const cleanText = fullText.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ').replace(/\s+/g, ' ');

    return {
      newsId: raw.rawId,
      source: raw.source,
      sanitizedText: cleanText,
      isSecuritySafe: true,
      publishedAtMs: raw.publishedAtMs,
      ingestedAtMs: raw.ingestedAtMs
    };
  }
}
