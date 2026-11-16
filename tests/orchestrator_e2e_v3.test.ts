// tests/orchestrator_e2e_v3.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  NexusQuantOrchestrator,
  OrderExecutionRequest,
  RiskGuardianAdapter,
} from '../src/index.js';
import { SqliteWalDatabaseDriver, SqliteWalStatement } from '../src/core/db_sqlite_wal.js';

class UnifiedE2ESqliteMock implements SqliteWalDatabaseDriver {
  public regimeRow: Record<string, unknown> | undefined;
  public carryStore: Map<string, Record<string, unknown>> = new Map();
  public pullbackStore: Map<string, Record<string, unknown>> = new Map();

  public exec(_sql: string): void {}

  public prepare(sql: string): SqliteWalStatement {
    return {
      run: (...params: unknown[]) => {
        if (sql.includes('INSERT INTO aether_regime_telemetry')) {
          this.regimeRow = {
            id: 1,
            current_regime: params[0],
            kaufman_er_bps: params[1],
            atr_ratio_bps: params[2],
            bollinger_width_bps: params[3],
            sentinel_multiplier_bps: params[4],
            catalyst_multiplier_bps: params[5],
            carry_allocation_target_bps: params[6],
            updated_at_ms: params[7],
          };
        } else if (sql.includes('INSERT INTO aether_carry_ledger')) {
          this.carryStore.set(String(params[0]), {
            carry_id: params[0],
            asset_symbol: params[1],
            strategy_type: params[2],
            notional_deployed_micro_usd: params[3],
            spot_units_micro: params[4],
            perp_short_units_micro: params[5],
            spot_entry_price_micro_usd: params[6],
            perp_short_entry_micro_usd: params[7],
            delta_drift_bps: params[8],
            current_apr_bps: params[9],
            consecutive_negative_funding_epochs: params[10],
            cumulative_yield_micro_usd: params[11],
            status: params[12],
            opened_at_ms: params[13],
            last_harvest_ms: params[14],
          });
        } else if (sql.includes('INSERT INTO sentinel_pullback_intents')) {
          this.pullbackStore.set(String(params[0]), {
            intent_id: params[0],
            token_symbol: params[1],
            token_mint: params[2],
            confluence_count: params[3],
            unique_funding_roots_json: params[4],
            pre_whale_price_micro_usd: params[5],
            peak_impact_price_micro_usd: params[6],
            limit_target_price_micro_usd: params[7],
            allocated_weight_bps: params[8],
            status: params[9],
            created_at_ms: params[10],
            expires_at_ms: params[11],
          });
        } else if (sql.includes('UPDATE sentinel_pullback_intents')) {
          const id = String(params[params.length - 1]);
          const existing = this.pullbackStore.get(id);
          if (existing) {
            existing.status = params[0];
          }
        }
        return { changes: 1, lastInsertRowid: 1 };
      },
      get: (...params: unknown[]) => {
        if (sql.includes('FROM aether_regime_telemetry')) return this.regimeRow;
        if (sql.includes('FROM aether_carry_ledger')) {
          return this.carryStore.get(String(params[0]));
        }
        return this.pullbackStore.get(String(params[0]));
      },
      all: (...params: unknown[]) => {
        if (sql.includes('FROM aether_carry_ledger')) {
          return Array.from(this.carryStore.values());
        }
        const mint = String(params[0]);
        return Array.from(this.pullbackStore.values()).filter((r) => r.token_mint === mint);
      },
    };
  }
}

class MockRiskGuardian implements RiskGuardianAdapter {
  public openedPositions: OrderExecutionRequest[] = [];
  public closedPositions: string[] = [];

  public canOpenNewPosition(requestedAmountMicroUsd: bigint): boolean {
    return requestedAmountMicroUsd > 0n && requestedAmountMicroUsd <= 30_000_000_000n;
  }

  public registerPositionOpen(req: OrderExecutionRequest): void {
    this.openedPositions.push(req);
  }

  public registerPositionClose(positionId: string): void {
    this.closedPositions.push(positionId);
  }

  public getGlobalRiskTelemetry() {
    return {
      account_balance_micro_usd: 100_000_000_000n,
      current_exposure_bps: 1000n,
      max_exposure_limit_bps: 3000n,
      daily_pnl_micro_usd: 500_000_000n,
      daily_pnl_bps: 50n,
      cold_wallet_locked_micro_usd: 2_000_000_000n,
      circuit_breaker_tripped: false,
      kill_switch_active: false,
    };
  }

  public resetCircuitBreakerWithPhrase(phrase: string): boolean {
    return phrase === 'RESET_CIRCUIT_BREAKER_EMERGENCY';
  }

  public triggerEmergencyKillSwitch(): void {}
}

describe('NEXUS v3.0 - Integración E2E en src/index.ts (NexusQuantOrchestrator)', () => {
  let dbMock: UnifiedE2ESqliteMock;
  let guardian: MockRiskGuardian;
  let orchestrator: NexusQuantOrchestrator;

  beforeEach(() => {
    dbMock = new UnifiedE2ESqliteMock();
    guardian = new MockRiskGuardian();
    orchestrator = new NexusQuantOrchestrator({
      dbDriver: dbMock,
      riskGuardian: guardian,
      enableBackgroundLoops: false,
    });
    orchestrator.boot(false, false);
  });

  it('despliega los $70,000 USD en Aether Carry al arrancar y cosecha intereses verificando Delta Drift <= 15 bps', () => {
    const activeCarry = orchestrator.aetherRepo.getAllActiveCarryPositions();
    expect(activeCarry.length).toBe(1);
    expect(activeCarry[0].notional_deployed_micro_usd).toBe(70_000_000_000n);

    // Simular medio año de operación en el bucle supervisor con desvío de Delta de 25 bps (> 15 bps)
    const { carryResult } = orchestrator.runMacroRegimeAndCarrySupervisorTick(
      {
        closePricesMicroUsd: [150_000_000n, 152_000_000n, 155_000_000n],
        atr5mMicroUsd: 1_100_000n,
        atr1hMicroUsd: 1_000_000n,
        bollingerUpperMicroUsd: 157_000_000n,
        bollingerMidMicroUsd: 153_000_000n,
        bollingerLowerMicroUsd: 149_000_000n,
        timestampMs: activeCarry[0].opened_at_ms + 15_768_000_000n,
      },
      {
        carryId: activeCarry[0].carry_id,
        currentSpotUnitsMicro: 233_916_666n,
        currentPerpShortUnitsMicro: 233_333_333n,
        currentSpotPriceMicroUsd: 155_000_000n,
        currentPerpPriceMicroUsd: 155_000_000n,
        epochAnnualizedFundingAprBps: 1950n,
        stableVaultFallbackAprBps: 950n,
        nowMs: activeCarry[0].opened_at_ms + 15_768_000_000n,
      },
      true
    );

    expect(carryResult?.action).toBe('REBALANCE_DELTA_DRIFT');
    expect(carryResult?.updatedRecord.delta_drift_bps).toBe(0n);
    expect(carryResult?.harvestedYieldThisTickMicroUsd).toBe(6_825_000_000n);
  });

  it('bloquea señales de Sentinel cuando Aether detecta REGIME_CHOPPY_RANGE y ejecuta Pullback + Confluencia en REGIME_TRENDING', () => {
    // 1. Poner el mercado en Rango Lateral (Choppy Range)
    orchestrator.runMacroRegimeAndCarrySupervisorTick(
      {
        closePricesMicroUsd: [100_000_000n, 101_000_000n, 100_000_000n, 101_000_000n, 100_000_000n],
        atr5mMicroUsd: 800_000n,
        atr1hMicroUsd: 1_000_000n,
        bollingerUpperMicroUsd: 100_800_000n,
        bollingerMidMicroUsd: 100_000_000n,
        bollingerLowerMicroUsd: 99_200_000n,
        timestampMs: 50_000n,
      },
      undefined,
      true
    );

    expect(orchestrator.getSentinelMultiplierBps()).toBe(0n);

    const blockedSignal = orchestrator.processIncomingWhaleBuySignal({
      signal: {
        walletAddress: '0xWhaleA',
        walletTier: 'LIVE',
        fundingRootAddress: '0xRootA',
        directInteractedWallets90d: [],
        tokenMint: 'MINT_SOL_MEME',
        tokenSymbol: 'MEME',
        fillPriceMicroUsd: 1_100_000n,
        timestampMs: 51_000n,
      },
      preWhalePriceMicroUsd: 1_000_000n,
      peakImpactPriceMicroUsd: 1_100_000n,
      vwap5mMicroUsd: 1_070_000n,
    });

    expect(blockedSignal.status).toBe('PAUSED_BY_CHOPPY_REGIME');
    expect(guardian.openedPositions.length).toBe(0);

    // 2. Pasar el mercado a REGIME_TRENDING (Sentinel 100%)
    orchestrator.runMacroRegimeAndCarrySupervisorTick(
      {
        closePricesMicroUsd: [100_000_000n, 103_000_000n, 106_000_000n, 109_000_000n, 112_000_000n],
        atr5mMicroUsd: 1_150_000n,
        atr1hMicroUsd: 1_000_000n,
        bollingerUpperMicroUsd: 112_000_000n,
        bollingerMidMicroUsd: 110_000_000n,
        bollingerLowerMicroUsd: 108_000_000n,
        timestampMs: 60_000n,
      },
      undefined,
      true
    );

    expect(orchestrator.getSentinelMultiplierBps()).toBe(10000n);

    // Ballena #1 entra con mecha del 10% ($1.00 -> $1.10) -> Se encola orden Pullback del 25% ($2,500 USD) en Fib 38.2% ($1.0618)
    const probeQueued = orchestrator.processIncomingWhaleBuySignal({
      signal: {
        walletAddress: '0xWhaleA',
        walletTier: 'LIVE',
        fundingRootAddress: '0xRootA',
        directInteractedWallets90d: [],
        tokenMint: 'MINT_SOL_MEME',
        tokenSymbol: 'MEME',
        fillPriceMicroUsd: 1_100_000n,
        timestampMs: 61_000n,
      },
      preWhalePriceMicroUsd: 1_000_000n,
      peakImpactPriceMicroUsd: 1_100_000n,
      vwap5mMicroUsd: 1_070_000n,
    });

    expect(probeQueued.status).toBe('QUEUED_FOR_PULLBACK_LIMIT');
    expect(probeQueued.allocatedNotionalMicroUsd).toBe(2_500_000_000n); // $2,500 USD (25% del slot de $10,000)

    // El precio retrocede a $1.0615 -> Se dispara la ejecución hacia RiskGuardian
    const tickEval = orchestrator.evaluatePendingPullbacksOnTick(
      'MINT_SOL_MEME',
      1_061_500n,
      75_000n
    );
    expect(tickEval[0].resolution).toBe('FILL_TRIGGERED');
    expect(guardian.openedPositions.length).toBe(1);
    expect(guardian.openedPositions[0].requestedAmountMicroUsd).toBe(2_500_000_000n);
    expect(guardian.openedPositions[0].executionPriceMicroUsd).toBe(1_061_500n);
  });
});
