/**
 * NEXUS QUANT SUITE v2.0 - SENTINEL PHASED ENTRY ROUTER
 * 
 * Máquina de estados para Entrada Fraccionada en 2 Fases (Ventana de 15 minutos):
 * - Billetera #1: Inicia cluster de confluencia (WATCHING).
 * - Billetera #2: Fase 1 -> asigna 25% del cupo si delta <= 800 bps (+8.0%).
 * - Billetera #3: Fase 2 -> asigna 75% restante a mercado si delta <= 1200 bps (+12.0%).
 *   Si delta > 1200 bps: PROHÍBE compra a mercado y coloca orden límite en el
 *   retroceso Fibonacci del 38.2% durante 10 minutos (PULLBACK_WAIT).
 */

import { calcBpsDelta, calcFibonacciPullback, calcAllocationMicro } from '../core/math_bigint.js';

export interface WalletTradeSignal {
  walletAddress: string;
  tokenAddress: string;
  tokenTicker: string;
  priceMicroUsd: bigint;
  timestampMs: bigint;
}

export type ClusterStatus = 'WATCHING' | 'PHASE1_25PCT' | 'PHASE2_100PCT' | 'PULLBACK_WAIT' | 'ABORTED';

export interface ConfluenceCluster {
  clusterId: string;
  tokenAddress: string;
  tokenTicker: string;
  firstSeenMs: bigint;
  basePriceMicroUsd: bigint;
  currentPeakPriceMicroUsd: bigint;
  wallets: Set<string>;
  status: ClusterStatus;
  pullbackLimitPriceMicroUsd?: bigint;
  pullbackExpiryMs?: bigint;
}

export interface EntryExecutionCommand {
  type: 'MARKET_BUY' | 'LIMIT_PULLBACK_BUY' | 'NO_ACTION' | 'CLUSTER_ABORTED';
  clusterId: string;
  tokenAddress: string;
  tokenTicker: string;
  allocationBps: bigint; // 2500 bps (25%) o 7500 bps (75%)
  priceMicroUsd: bigint;
  status: ClusterStatus;
  reason: string;
}

export class SentinelPhasedEntryRouter {
  private clusters: Map<string, ConfluenceCluster> = new Map();
  private readonly clusterWindowMs: bigint = 900_000n; // 15 minutos
  private readonly maxPhase1DeltaBps: bigint = 800n; // 8.00%
  private readonly maxPhase2MarketDeltaBps: bigint = 1200n; // 12.00%
  private readonly pullbackWindowMs: bigint = 600_000n; // 10 minutos
  private readonly fibonacciPullbackBps: bigint = 3820n; // 38.2%

  public processSignal(signal: WalletTradeSignal): EntryExecutionCommand {
    const key = signal.tokenAddress.toLowerCase();
    let cluster = this.clusters.get(key);

    // 1. Si no existe cluster, Billetera #1 inicia el cluster
    if (!cluster) {
      cluster = {
        clusterId: `CLUST_${signal.tokenTicker}_${signal.timestampMs.toString()}`,
        tokenAddress: signal.tokenAddress,
        tokenTicker: signal.tokenTicker,
        firstSeenMs: signal.timestampMs,
        basePriceMicroUsd: signal.priceMicroUsd,
        currentPeakPriceMicroUsd: signal.priceMicroUsd,
        wallets: new Set([signal.walletAddress.toLowerCase()]),
        status: 'WATCHING'
      };
      this.clusters.set(key, cluster);

      return {
        type: 'NO_ACTION',
        clusterId: cluster.clusterId,
        tokenAddress: cluster.tokenAddress,
        tokenTicker: cluster.tokenTicker,
        allocationBps: 0n,
        priceMicroUsd: signal.priceMicroUsd,
        status: 'WATCHING',
        reason: 'CLUSTER_INIT: Wallet #1 detected. Watching for confluence in 15m window.'
      };
    }

    // 2. Comprobar si la ventana de 15 minutos expiró o si el cluster anterior fue abortado
    if (signal.timestampMs - cluster.firstSeenMs > this.clusterWindowMs || cluster.status === 'ABORTED') {
      this.clusters.delete(key);
      cluster = {
        clusterId: `CLUST_${signal.tokenTicker}_${signal.timestampMs.toString()}`,
        tokenAddress: signal.tokenAddress,
        tokenTicker: signal.tokenTicker,
        firstSeenMs: signal.timestampMs,
        basePriceMicroUsd: signal.priceMicroUsd,
        currentPeakPriceMicroUsd: signal.priceMicroUsd,
        wallets: new Set([signal.walletAddress.toLowerCase()]),
        status: 'WATCHING'
      };
      this.clusters.set(key, cluster);

      return {
        type: 'NO_ACTION',
        clusterId: cluster.clusterId,
        tokenAddress: cluster.tokenAddress,
        tokenTicker: cluster.tokenTicker,
        allocationBps: 0n,
        priceMicroUsd: signal.priceMicroUsd,
        status: 'WATCHING',
        reason: 'CLUSTER_INIT: Previous cluster expired or was aborted. New 15m confluence window started with Wallet #1.'
      };
    }

    // Actualizar precio pico observado
    if (signal.priceMicroUsd > cluster.currentPeakPriceMicroUsd) {
      cluster.currentPeakPriceMicroUsd = signal.priceMicroUsd;
    }

    // Si la misma billetera compra de nuevo, no cuenta como confluencia de billeteras distintas
    if (cluster.wallets.has(signal.walletAddress.toLowerCase())) {
      return {
        type: 'NO_ACTION',
        clusterId: cluster.clusterId,
        tokenAddress: cluster.tokenAddress,
        tokenTicker: cluster.tokenTicker,
        allocationBps: 0n,
        priceMicroUsd: signal.priceMicroUsd,
        status: cluster.status,
        reason: 'REPEATED_WALLET: Same wallet already in cluster'
      };
    }

    // Añadir nueva billetera al cluster
    cluster.wallets.add(signal.walletAddress.toLowerCase());
    const distinctWalletCount = cluster.wallets.size;
    const deltaBps = calcBpsDelta(signal.priceMicroUsd, cluster.basePriceMicroUsd);

    // 3. FASE 1: Billetera #2 detectada
    if (distinctWalletCount === 2) {
      if (deltaBps <= this.maxPhase1DeltaBps) {
        cluster.status = 'PHASE1_25PCT';
        return {
          type: 'MARKET_BUY',
          clusterId: cluster.clusterId,
          tokenAddress: cluster.tokenAddress,
          tokenTicker: cluster.tokenTicker,
          allocationBps: 2500n, // 25% del cupo
          priceMicroUsd: signal.priceMicroUsd,
          status: 'PHASE1_25PCT',
          reason: `PHASE1_ENTRY: Wallet #2 confirmed. Delta ${deltaBps} bps <= 800 bps. 25% quota deployed.`
        };
      } else {
        return {
          type: 'NO_ACTION',
          clusterId: cluster.clusterId,
          tokenAddress: cluster.tokenAddress,
          tokenTicker: cluster.tokenTicker,
          allocationBps: 0n,
          priceMicroUsd: signal.priceMicroUsd,
          status: cluster.status,
          reason: `PHASE1_SKIPPED: Wallet #2 price delta ${deltaBps} bps > 800 bps threshold.`
        };
      }
    }

    // 4. FASE 2: Billetera #3 detectada (Confluencia 3/10 alcanzada)
    if (distinctWalletCount === 3) {
      if (deltaBps <= this.maxPhase2MarketDeltaBps) {
        // Delta aceptable: entra el 75% restante a mercado
        cluster.status = 'PHASE2_100PCT';
        return {
          type: 'MARKET_BUY',
          clusterId: cluster.clusterId,
          tokenAddress: cluster.tokenAddress,
          tokenTicker: cluster.tokenTicker,
          allocationBps: 7500n, // 75% restante
          priceMicroUsd: signal.priceMicroUsd,
          status: 'PHASE2_100PCT',
          reason: `PHASE2_ENTRY: Wallet #3 confirmed. Delta ${deltaBps} bps <= 1200 bps. 75% quota deployed.`
        };
      } else {
        // Delta excesivo (> 12%): PROHIBIDO comprar a mercado.
        // Coloca orden límite en retroceso Fibonacci del 38.2%
        const fibPullbackPrice = calcFibonacciPullback(
          cluster.basePriceMicroUsd,
          cluster.currentPeakPriceMicroUsd,
          this.fibonacciPullbackBps
        );

        cluster.status = 'PULLBACK_WAIT';
        cluster.pullbackLimitPriceMicroUsd = fibPullbackPrice;
        cluster.pullbackExpiryMs = signal.timestampMs + this.pullbackWindowMs;

        return {
          type: 'LIMIT_PULLBACK_BUY',
          clusterId: cluster.clusterId,
          tokenAddress: cluster.tokenAddress,
          tokenTicker: cluster.tokenTicker,
          allocationBps: 7500n,
          priceMicroUsd: fibPullbackPrice,
          status: 'PULLBACK_WAIT',
          reason: `PHASE2_FIBONACCI_PULLBACK: Wallet #3 delta ${deltaBps} bps > 1200 bps. Market buy prohibited. Limit order placed at 38.2% Fibonacci pullback (${fibPullbackPrice} uUSD) for 10m.`
        };
      }
    }

    return {
      type: 'NO_ACTION',
      clusterId: cluster.clusterId,
      tokenAddress: cluster.tokenAddress,
      tokenTicker: cluster.tokenTicker,
      allocationBps: 0n,
      priceMicroUsd: signal.priceMicroUsd,
      status: cluster.status,
      reason: `CONFLUENCE_EXCEEDED: ${distinctWalletCount} wallets in cluster.`
    };
  }

  public getCluster(tokenAddress: string): ConfluenceCluster | undefined {
    return this.clusters.get(tokenAddress.toLowerCase());
  }

  public resetCluster(tokenAddress: string): void {
    this.clusters.delete(tokenAddress.toLowerCase());
  }

  public clear(): void {
    this.clusters.clear();
  }
}
