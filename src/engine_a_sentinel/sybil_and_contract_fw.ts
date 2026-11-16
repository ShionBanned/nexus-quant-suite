/**
 * NEXUS QUANT SUITE v2.0 - SENTINEL PRE-TRADE FIREWALL (< 150ms)
 * 
 * Regla Inmutable:
 * - Política Default Deny: si falla cualquier verificación o la latencia excede 150ms, aborta de inmediato.
 * 1. Grafo Anti-Sybil: las billeteras del cluster deben tener raíces de fondeo disjuntas (50 tx).
 * 2. Liquidez del Pool: LP >= 40 x OrdenTotal.
 * 3. Mint / Freeze Authority: ambos deben ser estrictamente nulos/revocados.
 * 4. Concentración Top 10 Holders: <= 2200 bps (22.00%).
 * 5. Impuesto de Compra/Venta: <= 200 bps (2.00%).
 * 6. Simulación Anti-Honeypot: confirmación de venta ejecutable sin reversión de contrato.
 */

export interface TokenSecurityMetadata {
  tokenAddress: string;
  poolLiquidityMicroUsd: bigint;
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
  top10HoldersShareBps: bigint; // <= 2200 bps
  buyTaxBps: bigint; // <= 200 bps
  sellTaxBps: bigint; // <= 200 bps
  honeypotSimulationSuccess: boolean;
  rpcLatencyMs: number;
}

export interface WalletClusterInfo {
  tokenAddress: string;
  wallets: {
    address: string;
    fundingRootHash: string;
  }[];
  totalPlannedOrderMicroUsd: bigint;
}

export interface FirewallDecision {
  passed: boolean;
  latencyMs: number;
  rejectReason?: string;
}

export class SentinelPreTradeFirewall {
  private readonly maxLatencyMs: number = 150;
  private readonly minLpMultiplier: bigint = 40n;
  private readonly maxTop10HoldersBps: bigint = 2200n; // 22%
  private readonly maxTaxBps: bigint = 200n; // 2%

  /**
   * Ejecuta la evaluación completa de firewall con presupuesto estricto < 150ms y Default Deny.
   */
  public evaluate(
    cluster: WalletClusterInfo,
    metadata: TokenSecurityMetadata,
    simulatedLatencyMs?: number
  ): FirewallDecision {
    const latency = simulatedLatencyMs !== undefined ? simulatedLatencyMs : metadata.rpcLatencyMs;

    // 1. Verificación de Presupuesto de Latencia RPC (< 150 ms)
    if (latency > this.maxLatencyMs) {
      return {
        passed: false,
        latencyMs: latency,
        rejectReason: `REJECT_RPC_LATENCY_TIMEOUT: RPC responded in ${latency}ms > 150ms budget`
      };
    }

    // 2. Grafo Anti-Sybil: Comprobación de raíces de fondeo disjuntas
    const seenRoots = new Set<string>();
    for (const w of cluster.wallets) {
      const root = w.fundingRootHash.toLowerCase();
      if (seenRoots.has(root)) {
        return {
          passed: false,
          latencyMs: latency,
          rejectReason: `REJECT_SYBIL_SHARED_FUNDING_ROOT: Wallets share common parent ${root}`
        };
      }
      seenRoots.add(root);
    }

    // 3. Verificación de Liquidez de Pool (LP >= 40 x OrdenTotal)
    const requiredLiquidity = cluster.totalPlannedOrderMicroUsd * this.minLpMultiplier;
    if (metadata.poolLiquidityMicroUsd < requiredLiquidity) {
      return {
        passed: false,
        latencyMs: latency,
        rejectReason: `REJECT_INSUFFICIENT_LP_DEPTH: Pool LP ${metadata.poolLiquidityMicroUsd} < 40x order (${requiredLiquidity})`
      };
    }

    // 4. Verificación de Mint y Freeze Revocados
    if (!metadata.mintAuthorityRevoked) {
      return {
        passed: false,
        latencyMs: latency,
        rejectReason: 'REJECT_MINT_AUTHORITY_ACTIVE: Token mint authority is not revoked'
      };
    }

    if (!metadata.freezeAuthorityRevoked) {
      return {
        passed: false,
        latencyMs: latency,
        rejectReason: 'REJECT_FREEZE_AUTHORITY_ACTIVE: Token freeze authority is not revoked'
      };
    }

    // 5. Verificación de Concentración Top 10 Holders (<= 22.00%)
    if (metadata.top10HoldersShareBps > this.maxTop10HoldersBps) {
      return {
        passed: false,
        latencyMs: latency,
        rejectReason: `REJECT_TOP10_HOLDER_CONCENTRATION: Top 10 hold ${metadata.top10HoldersShareBps} bps > 2200 bps max`
      };
    }

    // 6. Verificación de Impuestos (<= 200 bps)
    if (metadata.buyTaxBps > this.maxTaxBps || metadata.sellTaxBps > this.maxTaxBps) {
      return {
        passed: false,
        latencyMs: latency,
        rejectReason: `REJECT_EXCESSIVE_TAX: Buy tax ${metadata.buyTaxBps} bps or sell tax ${metadata.sellTaxBps} bps > 200 bps max`
      };
    }

    // 7. Simulación Anti-Honeypot
    if (!metadata.honeypotSimulationSuccess) {
      return {
        passed: false,
        latencyMs: latency,
        rejectReason: 'REJECT_HONEYPOT_DETECTED: Sell simulation reverted or contract blocked transfer'
      };
    }

    return {
      passed: true,
      latencyMs: latency
    };
  }
}
