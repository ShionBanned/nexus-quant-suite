/**
 * NEXUS QUANT SUITE v2.0 - CATALYST SIMHASH DEDUPLICATOR & AHO-CORASICK
 * 
 * 1. Extractor Aho-Corasick de Tickers y Palabras Clave (< 0.3 ms).
 * 2. Huella SimHash de 64 bits sobre trigramas normalizados.
 * 3. Fusión en búfer RAM de 120 segundos si Distancia de Hamming <= 3.
 * 4. Fusión Bayesiana Multi-Fuente: T_combinado = 1 - ∏ (1 - T_i) sin re-ejecutar inferencia IA.
 */

import { BPS_SCALE } from '../core/math_bigint.js';

// Trie Node para el autómata Aho-Corasick
interface TrieNode {
  children: Map<string, TrieNode>;
  failure: TrieNode | null;
  outputs: string[];
}

export class AhoCorasickExtractor {
  private root: TrieNode;

  constructor(keywords: string[]) {
    this.root = { children: new Map(), failure: null, outputs: [] };
    this.buildTrie(keywords);
    this.buildFailureLinks();
  }

  private buildTrie(keywords: string[]): void {
    for (const kw of keywords) {
      const normalized = kw.toUpperCase();
      let node = this.root;
      for (const char of normalized) {
        if (!node.children.has(char)) {
          node.children.set(char, { children: new Map(), failure: null, outputs: [] });
        }
        node = node.children.get(char)!;
      }
      node.outputs.push(normalized);
    }
  }

  private buildFailureLinks(): void {
    const queue: TrieNode[] = [];
    for (const child of this.root.children.values()) {
      child.failure = this.root;
      queue.push(child);
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const [char, child] of current.children.entries()) {
        let f = current.failure;
        while (f && !f.children.has(char)) {
          f = f.failure;
        }
        child.failure = f ? f.children.get(char)! : this.root;
        child.outputs = [...child.outputs, ...(child.failure?.outputs || [])];
        queue.push(child);
      }
    }
  }

  public extractMatches(text: string): string[] {
    const upper = text.toUpperCase();
    const matches = new Set<string>();
    let node = this.root;

    for (let i = 0; i < upper.length; i++) {
      const char = upper[i];
      while (node && !node.children.has(char)) {
        node = node.failure!;
      }
      if (!node) {
        node = this.root;
        continue;
      }
      node = node.children.get(char)!;
      for (const output of node.outputs) {
        // Validación de límites de palabra para evitar sub-strings falsos en tickers
        const startIdx = i - output.length + 1;
        const endIdx = i + 1;
        const prevChar = startIdx > 0 ? upper[startIdx - 1] : ' ';
        const nextChar = endIdx < upper.length ? upper[endIdx] : ' ';
        if (!/[A-Z0-9]/.test(prevChar) && !/[A-Z0-9]/.test(nextChar)) {
          matches.add(output);
        }
      }
    }

    return Array.from(matches);
  }
}

export class SimHash64 {
  /**
   * Genera una huella SimHash de 64 bits a partir de los trigramas de caracteres del texto normalizado.
   */
  public static compute(text: string): bigint {
    const normalized = text.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
    if (normalized.length < 3) {
      return 0n;
    }

    const v = new Int32Array(64); // 64 acumuladores

    // Generar trigramas deslizantes
    for (let i = 0; i <= normalized.length - 3; i++) {
      const trigram = normalized.substring(i, i + 3);
      const hash = this.hash64(trigram);

      for (let bit = 0; bit < 64; bit++) {
        const mask = 1n << BigInt(bit);
        if ((hash & mask) !== 0n) {
          v[bit] += 1;
        } else {
          v[bit] -= 1;
        }
      }
    }

    let fingerprint = 0n;
    for (let bit = 0; bit < 64; bit++) {
      if (v[bit] > 0) {
        fingerprint |= (1n << BigInt(bit));
      }
    }

    return fingerprint;
  }

  /**
   * Hash FNV-1a de 64 bits para trigramas.
   */
  private static hash64(str: string): bigint {
    let hash = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    for (let i = 0; i < str.length; i++) {
      hash ^= BigInt(str.charCodeAt(i));
      hash = (hash * prime) & 0xffffffffffffffffn;
    }
    return hash;
  }

  /**
   * Calcula la Distancia de Hamming entre dos huellas SimHash de 64 bits.
   */
  public static hammingDistance(h1: bigint, h2: bigint): number {
    let xor = (h1 ^ h2) & 0xffffffffffffffffn;
    let dist = 0;
    while (xor > 0n) {
      dist += Number(xor & 1n);
      xor >>= 1n;
    }
    return dist;
  }
}

export interface FusedCatalystEvent {
  catalystId: string;
  simhash64Hex: string;
  primaryHeadline: string;
  extractedTickers: string[];
  sources: Set<string>;
  sourceTrustBpsList: bigint[];
  combinedTrustBps: bigint;
  firstSeenMs: bigint;
  lastUpdatedMs: bigint;
  corroboratedCount: number;
}

export class CatalystCorroborationBuffer {
  private events: FusedCatalystEvent[] = [];
  private readonly windowMs: bigint;
  private readonly maxHammingDistance: number = 3;

  constructor(windowMs: bigint = 3_600_000n) {
    this.windowMs = windowMs;
    // Purga periódica pasiva cada 60s sin bloquear el bucle de eventos
    if (typeof setInterval !== 'undefined') {
      const timer = setInterval(() => this.purgeExpired(BigInt(Date.now())), 60_000);
      if (timer.unref) timer.unref();
    }
  }

  public purgeExpired(nowMs: bigint): number {
    const before = this.events.length;
    this.events = this.events.filter(e => nowMs - e.lastUpdatedMs <= this.windowMs);
    return before - this.events.length;
  }

  /**
   * Fusión Multi-Fuente Bayesiana:
   * T_combinado = 1 - ∏ (1 - T_i)
   * En enteros de 10,000 bps:
   * residual = (10000 - T_1) * (10000 - T_2) * ... / 10000^(n-1)
   * T_comb = 10000 - residual
   */
  public static combineBayesianTrust(trustBpsList: bigint[]): bigint {
    if (trustBpsList.length === 0) return 0n;
    if (trustBpsList.length === 1) return trustBpsList[0];

    let residual = BPS_SCALE;
    for (const t of trustBpsList) {
      const safeT = t > BPS_SCALE ? BPS_SCALE : (t < 0n ? 0n : t);
      const factor = BPS_SCALE - safeT;
      residual = (residual * factor) / BPS_SCALE;
    }

    const combined = BPS_SCALE - residual;
    return combined > BPS_SCALE ? BPS_SCALE : combined;
  }

  /**
   * Procesa un evento entrante: si colisiona con SimHash (Hamming <= 3) dentro de 120s,
   * fusiona las fuentes y actualiza la confianza instantáneamente sin re-ejecutar inferencia IA.
   */
  public ingestAndDeduplicate(
    headline: string,
    extractedTickers: string[],
    source: string,
    sourceTrustBps: bigint,
    nowMs: bigint
  ): { isDuplicate: boolean; event: FusedCatalystEvent } {
    // 1. Limpieza de eventos expirados
    this.events = this.events.filter(e => nowMs - e.lastUpdatedMs <= this.windowMs);

    const hash = SimHash64.compute(headline);
    const hashHex = `0x${hash.toString(16).padStart(16, '0')}`;

    // 2. Buscar evento colisionante con Hamming <= 3
    for (const existing of this.events) {
      const existingHash = BigInt(existing.simhash64Hex);
      const dist = SimHash64.hammingDistance(hash, existingHash);

      if (dist <= this.maxHammingDistance) {
        // FUSIÓN DE CATALIZADOR (solo añadir confianza si es una fuente nueva para evitar auto-inflación)
        if (!existing.sources.has(source)) {
          existing.sources.add(source);
          existing.sourceTrustBpsList.push(sourceTrustBps);
          existing.combinedTrustBps = CatalystCorroborationBuffer.combineBayesianTrust(existing.sourceTrustBpsList);
          existing.corroboratedCount = existing.sources.size;
        }
        existing.lastUpdatedMs = nowMs;

        // Fusión de tickers detectados
        for (const t of extractedTickers) {
          if (!existing.extractedTickers.includes(t)) {
            existing.extractedTickers.push(t);
          }
        }

        return { isDuplicate: true, event: existing };
      }
    }

    // 3. Nuevo catalizador
    const newEvent: FusedCatalystEvent = {
      catalystId: `CAT_${nowMs.toString()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
      simhash64Hex: hashHex,
      primaryHeadline: headline,
      extractedTickers: [...extractedTickers],
      sources: new Set([source]),
      sourceTrustBpsList: [sourceTrustBps],
      combinedTrustBps: sourceTrustBps,
      firstSeenMs: nowMs,
      lastUpdatedMs: nowMs,
      corroboratedCount: 1
    };

    this.events.push(newEvent);
    return { isDuplicate: false, event: newEvent };
  }

  public getActiveCount(nowMs?: bigint): number {
    if (nowMs !== undefined) {
      return this.events.filter(e => nowMs - e.lastUpdatedMs <= this.windowMs).length;
    }
    return this.events.length;
  }
}
