/**
 * NEXUS QUANT SUITE v2.0 - MAIN SYSTEM LAUNCHER (PRODUCCIÓN & SEGURIDAD BLINDADA)
 * 
 * Arranca el núcleo unificado:
 * 1. Base de datos SQLite WAL (6 tablas en BigInt).
 * 2. RiskGuardian Supervisor, Mutex Real y Reconciliación de Arranque.
 * 3. Servidor de Dashboard HTTP + WebSocket protegido en el puerto 8080.
 * 4. Aislamiento Estricto de Entornos: DATA_SOURCE = 'REAL' | 'SIMULATED'.
 */

import http from 'node:http';
import { execSync } from 'node:child_process';
import {
  NexusDatabase,
  AetherSqliteRepository,
  SentinelPullbackIntentRepository,
  SqliteWalDatabaseDriver,
  MarketRegimeState,
} from './core/db_sqlite_wal.js';
import { RiskGuardian } from './core/risk_guardian.js';
import { SentinelPurgeRotator } from './engine_a_sentinel/purge_rotator_6h.js';
import { WalletWsListener } from './engine_a_sentinel/wallet_ws_listener.js';
import { REAL_SOLANA_WHALES } from './engine_a_sentinel/real_whale_wallets.js';
import { RealNewsPoller } from './engine_b_catalyst/real_news_poller.js';
import { ActivePositionSupervisor } from './core/position_supervisor.js';
import { LivePriceFeed, PriceTickEvent } from './core/live_price_feed.js';
import { GlobalL2RingBufferManager, createL2SnapshotFromPrice } from './core/ring_buffer_l2.js';
import { L2ShadowSimulator, ShadowOrderRequest } from './core/l2_shadow_simulator.js';
import { BinanceExecutionClient } from './core/binance_execution_client.js';
import { SentinelPhasedEntryRouter } from './engine_a_sentinel/phased_entry_router.js';
import { AnchoredIocRouter } from './engine_b_catalyst/anchored_ioc_router.js';
import {
  SentinelConfluenceTracker,
  WhaleBuySignalInput,
  WalletPoolTier,
} from './engine_a_sentinel/confluence_tracker.js';
import {
  PullbackEvaluationOutput,
  SmartPullbackSniper,
} from './engine_a_sentinel/smart_pullback_sniper.js';
import {
  AdaptiveRvolTimeStop,
  AdaptiveTimeStopDecision,
  RvolTimeStopInput,
} from './engine_a_sentinel/adaptive_rvol_time_stop.js';
import {
  MarketRegimeClassifier,
  MarketRegimeEvaluationResult,
  MarketRegimeSampleInput,
} from './engine_c_aether/market_regime_classifier.js';
import {
  CarryEpochTickInput,
  CarryEvaluationResult,
  DeltaNeutralCarryEngine,
} from './engine_c_aether/delta_neutral_carry_engine.js';
import {
  DashboardServerDependencies,
  startDashboardServer,
  LOCAL_ADMIN_TOKEN
} from './ui_dashboard/server.js';
import { VaultBackupManager } from './core/vault_backup.js';

// ============================================================================
// INTERFACES DE ACOPLAMIENTO CON EL NÚCLEO EXISTENTE (v2.0 & v3.0)
// ============================================================================

export interface OrderExecutionRequest {
  readonly positionId: string;
  readonly engine: 'SENTINEL' | 'CATALYST';
  readonly mode: 'LIVE' | 'SHADOW';
  readonly walletAddress: string;
  readonly tokenSymbol: string;
  readonly tokenMint: string;
  readonly side: 'LONG' | 'SHORT';
  readonly requestedAmountMicroUsd: bigint;
  readonly executionPriceMicroUsd: bigint;
  readonly timestampMs: bigint;
}

export interface RiskGuardianAdapter {
  canOpenNewPosition(requestedAmountMicroUsd: bigint): boolean;
  registerPositionOpen(req: OrderExecutionRequest): void;
  registerPositionClose(positionId: string, exitPriceMicroUsd: bigint, nowMs?: bigint): void;
  getGlobalRiskTelemetry(): {
    readonly account_balance_micro_usd: bigint;
    readonly current_exposure_bps: bigint;
    readonly max_exposure_limit_bps: bigint;
    readonly daily_pnl_micro_usd: bigint;
    readonly daily_pnl_bps: bigint;
    readonly cold_wallet_locked_micro_usd: bigint;
    readonly circuit_breaker_tripped: boolean;
    readonly kill_switch_active: boolean;
  };
  resetCircuitBreakerWithPhrase(phrase: string): boolean;
  triggerEmergencyKillSwitch(): void;
}

export interface WhaleSignalWithMarketContext {
  readonly signal: WhaleBuySignalInput;
  readonly preWhalePriceMicroUsd: bigint;
  readonly peakImpactPriceMicroUsd: bigint;
  readonly vwap5mMicroUsd: bigint;
}

export interface NexusOrchestratorConfig {
  readonly dbDriver: SqliteWalDatabaseDriver;
  readonly riskGuardian: RiskGuardianAdapter;
  readonly httpPort?: number;
  readonly totalAccountCapitalMicroUsd?: bigint;
  readonly maxDirectionalSlotMicroUsd?: bigint;
  readonly idleCarryCapitalMicroUsd?: bigint;
  readonly enableBackgroundLoops?: boolean;
}

// ============================================================================
// CLASE ORQUESTADORA PRINCIPAL (NEXUS QUANT SUITE v3.0)
// ============================================================================

export class NexusQuantOrchestrator {
  public static readonly DEFAULT_ACCOUNT_CAPITAL_MICRO_USD: bigint = 100_000_000_000n; // $100,000 USD
  public static readonly DEFAULT_SLOT_CAPITAL_MICRO_USD: bigint = 10_000_000_000n;     // $10,000 USD
  public static readonly DEFAULT_IDLE_CARRY_MICRO_USD: bigint = 70_000_000_000n;       // $70,000 USD
  public static readonly REGIME_LOOP_INTERVAL_MS: number = 5_000;                      // 5 segundos

  public readonly aetherRepo: AetherSqliteRepository;
  public readonly pullbackRepo: SentinelPullbackIntentRepository;

  public readonly confluenceTracker: SentinelConfluenceTracker;
  public readonly pullbackSniper: SmartPullbackSniper;
  public readonly rvolTimeStop: AdaptiveRvolTimeStop;
  public readonly regimeClassifier: MarketRegimeClassifier;
  public readonly carryEngine: DeltaNeutralCarryEngine;

  private readonly riskGuardian: RiskGuardianAdapter;
  private readonly slotCapitalMicroUsd: bigint;
  private readonly idleCarryCapitalMicroUsd: bigint;
  private readonly httpPort: number;

  private currentSentinelMultiplierBps: bigint = 10000n; // 100% por defecto en TRENDING
  private currentCatalystMultiplierBps: bigint = 10000n; // 100% por defecto
  private primaryCarryId: string = 'carry_sol_primary_v3';
  private manualRegimeOverride: MarketRegimeState | null = null; // En modo automático por defecto; se activa manualmente ante override de usuario

  public setManualRegimeOverride(regime: MarketRegimeState | null): void {
    this.manualRegimeOverride = regime;
    if (regime === 'REGIME_TRENDING') {
      this.currentSentinelMultiplierBps = 10000n;
      this.currentCatalystMultiplierBps = 10000n;
    }
  }

  public getManualRegimeOverride(): MarketRegimeState | null {
    return this.manualRegimeOverride;
  }

  private regimeTimer: ReturnType<typeof setInterval> | null = null;
  private httpServer: http.Server | null = null;

  constructor(config: NexusOrchestratorConfig) {
    this.riskGuardian = config.riskGuardian;
    this.slotCapitalMicroUsd =
      config.maxDirectionalSlotMicroUsd ??
      NexusQuantOrchestrator.DEFAULT_SLOT_CAPITAL_MICRO_USD;
    this.idleCarryCapitalMicroUsd =
      config.idleCarryCapitalMicroUsd ??
      NexusQuantOrchestrator.DEFAULT_IDLE_CARRY_MICRO_USD;
    this.httpPort = config.httpPort ?? 8080;

    // 1. Inicializar repositorios aditivos sobre SQLite WAL
    this.aetherRepo = new AetherSqliteRepository(config.dbDriver);
    this.pullbackRepo = new SentinelPullbackIntentRepository(config.dbDriver);

    // 2. Instanciar motores v3.0
    this.confluenceTracker = new SentinelConfluenceTracker();
    this.pullbackSniper = new SmartPullbackSniper(this.pullbackRepo);
    this.rvolTimeStop = new AdaptiveRvolTimeStop();
    this.regimeClassifier = new MarketRegimeClassifier(this.aetherRepo);
    this.carryEngine = new DeltaNeutralCarryEngine(this.aetherRepo);
  }

  public boot(enableHttpServer: boolean = true, enableTimers: boolean = true): void {
    const nowMs = BigInt(Date.now());

    // 1. Verificar o desplegar la reserva de $70,000 USD en Aether Carry
    const existingCarry = this.aetherRepo.getCarryPositionById(this.primaryCarryId);
    if (!existingCarry) {
      this.carryEngine.deployIdleCapital({
        carryId: this.primaryCarryId,
        assetSymbol: 'SOL',
        totalNotionalMicroUsd: this.idleCarryCapitalMicroUsd, // $70,000 USD
        spotPriceMicroUsd: 150_000_000n,                      // $150.00 Spot
        perpPriceMicroUsd: 150_060_000n,                      // $150.06 Perp Short 1x
        projectedFundingAprBps: 1950n,                        // 19.50% APR
        stableVaultFallbackAprBps: 950n,                      // 9.50% APR fallback
        nowMs,
      });
    }

    // 2. Sembrar telemetría inicial de régimen si la base de datos está fresca
    const existingRegime = this.aetherRepo.getLatestRegimeTelemetry();
    if (!existingRegime) {
      this.runMacroRegimeAndCarrySupervisorTick(this.computeDynamicRegimeSample(nowMs));
    } else {
      this.currentSentinelMultiplierBps = existingRegime.sentinel_multiplier_bps;
      this.currentCatalystMultiplierBps = existingRegime.catalyst_multiplier_bps;
    }

    // 3. Iniciar bucle supervisor en segundo plano cada 5 segundos
    if (enableTimers && this.regimeTimer === null) {
      this.regimeTimer = setInterval(() => {
        const tickNowMs = BigInt(Date.now());
        this.runDefaultBackgroundSupervisorCycle(tickNowMs);
      }, NexusQuantOrchestrator.REGIME_LOOP_INTERVAL_MS);

      if (typeof this.regimeTimer.unref === 'function') {
        this.regimeTimer.unref();
      }
    }
  }

  public shutdown(): Promise<void> {
    if (this.regimeTimer !== null) {
      clearInterval(this.regimeTimer);
      this.regimeTimer = null;
    }

    return new Promise((resolve) => {
      if (this.httpServer !== null) {
        this.httpServer.close(() => {
          this.httpServer = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  public runMacroRegimeAndCarrySupervisorTick(
    regimeSample: MarketRegimeSampleInput,
    carryTickOverride?: CarryEpochTickInput,
    forceRegimeEval: boolean = false
  ): {
    regimeResult: MarketRegimeEvaluationResult;
    carryResult: CarryEvaluationResult | null;
  } {
    const regimeResult: MarketRegimeEvaluationResult = this.manualRegimeOverride
      ? {
          regime: this.manualRegimeOverride,
          kaufmanErBps: 4500n,
          atrRatioBps: 11000n,
          bollingerWidthBps: 250n,
          sentinelMultiplierBps: 10000n,
          catalystMultiplierBps: 10000n,
          carryAllocationTargetBps: 7000n,
          evaluatedAtMs: regimeSample.timestampMs,
          skippedByTickInterval: false
        }
      : this.regimeClassifier.evaluateMarketRegime(
          regimeSample,
          forceRegimeEval
        );

    this.currentSentinelMultiplierBps = regimeResult.sentinelMultiplierBps;
    this.currentCatalystMultiplierBps = regimeResult.catalystMultiplierBps;

    const activeCarry = this.aetherRepo.getCarryPositionById(this.primaryCarryId);
    let carryResult: CarryEvaluationResult | null = null;

    if (activeCarry) {
      const latestPriceMicro =
        regimeSample.closePricesMicroUsd[regimeSample.closePricesMicroUsd.length - 1] ??
        150_000_000n;

      const effectiveCarryTick: CarryEpochTickInput = carryTickOverride ?? {
        carryId: activeCarry.carry_id,
        currentSpotUnitsMicro: activeCarry.spot_units_micro,
        currentPerpShortUnitsMicro: activeCarry.perp_short_units_micro,
        currentSpotPriceMicroUsd: latestPriceMicro,
        currentPerpPriceMicroUsd: latestPriceMicro,
        epochAnnualizedFundingAprBps: activeCarry.current_apr_bps,
        stableVaultFallbackAprBps: 950n,
        nowMs: regimeSample.timestampMs,
      };

      carryResult = this.carryEngine.evaluateCarryEpoch(activeCarry, effectiveCarryTick);
    }

    return { regimeResult, carryResult };
  }

  public processIncomingWhaleBuySignal(context: WhaleSignalWithMarketContext): {
    status:
      | 'PAUSED_BY_CHOPPY_REGIME'
      | 'REJECTED_BY_CONFLUENCE_OR_SYBIL'
      | 'QUEUED_FOR_PULLBACK_LIMIT'
      | 'EXECUTED_IMMEDIATE_LOW_IMPACT'
      | 'BLOCKED_BY_RISK_GUARDIAN';
    allocatedNotionalMicroUsd: bigint;
    intentId: string | null;
  } {
    if (this.currentSentinelMultiplierBps === 0n) {
      return {
        status: 'PAUSED_BY_CHOPPY_REGIME',
        allocatedNotionalMicroUsd: 0n,
        intentId: null,
      };
    }

    const confluence = this.confluenceTracker.evaluateWhaleSignal(
      context.signal,
      this.currentSentinelMultiplierBps
    );

    if (
      confluence.action !== 'OPEN_PROBE_25_PCT' &&
      confluence.action !== 'SCALE_TO_100_PCT'
    ) {
      return {
        status: 'REJECTED_BY_CONFLUENCE_OR_SYBIL',
        allocatedNotionalMicroUsd: 0n,
        intentId: null,
      };
    }

    const incrementalNotionalMicroUsd =
      (this.slotCapitalMicroUsd * confluence.incrementalWeightBps) / 10000n;

    if (!this.riskGuardian.canOpenNewPosition(incrementalNotionalMicroUsd)) {
      return {
        status: 'BLOCKED_BY_RISK_GUARDIAN',
        allocatedNotionalMicroUsd: 0n,
        intentId: null,
      };
    }

    const intentId = `intent_${context.signal.tokenSymbol}_${context.signal.timestampMs.toString()}_${confluence.uniqueWhaleCount}`;
    const pullbackPlan = this.pullbackSniper.createEntryIntent({
      intentId,
      tokenSymbol: context.signal.tokenSymbol,
      tokenMint: context.signal.tokenMint,
      preWhalePriceMicroUsd: context.preWhalePriceMicroUsd,
      peakImpactPriceMicroUsd: context.peakImpactPriceMicroUsd,
      vwap5mMicroUsd: context.vwap5mMicroUsd,
      allocatedWeightBps: confluence.incrementalWeightBps,
      confluenceCount: confluence.uniqueWhaleCount,
      uniqueFundingRoots: confluence.uniqueFundingRoots,
      nowMs: context.signal.timestampMs,
    });

    if (pullbackPlan.executionMode === 'DIRECT_IOC_LOW_IMPACT') {
      this.riskGuardian.registerPositionOpen({
        positionId: `pos_${intentId}`,
        engine: 'SENTINEL',
        mode: 'LIVE',
        walletAddress: context.signal.walletAddress,
        tokenSymbol: context.signal.tokenSymbol,
        tokenMint: context.signal.tokenMint,
        side: 'LONG',
        requestedAmountMicroUsd: incrementalNotionalMicroUsd,
        executionPriceMicroUsd: pullbackPlan.limitTargetPriceMicroUsd,
        timestampMs: context.signal.timestampMs,
      });

      return {
        status: 'EXECUTED_IMMEDIATE_LOW_IMPACT',
        allocatedNotionalMicroUsd: incrementalNotionalMicroUsd,
        intentId,
      };
    }

    return {
      status: 'QUEUED_FOR_PULLBACK_LIMIT',
      allocatedNotionalMicroUsd: incrementalNotionalMicroUsd,
      intentId,
    };
  }

  public evaluatePendingPullbacksOnTick(
    tokenMint: string,
    currentAskPriceMicroUsd: bigint,
    nowMs: bigint,
    cvdTickOrAbsorption?: bigint | boolean
  ): PullbackEvaluationOutput[] {
    const activeIntents = this.pullbackRepo.getActiveIntentsByMint(tokenMint, nowMs);
    const outputs: PullbackEvaluationOutput[] = [];

    for (const intent of activeIntents) {
      if (intent.status !== 'WAITING_PULLBACK') continue;

      const evalOut = this.pullbackSniper.evaluateMarketTick(
        intent,
        currentAskPriceMicroUsd,
        nowMs,
        cvdTickOrAbsorption
      );
      outputs.push(evalOut);

      if (
        evalOut.resolution === 'FILL_TRIGGERED' &&
        evalOut.fillExecutionPriceMicroUsd !== null
      ) {
        const notionalMicroUsd =
          (this.slotCapitalMicroUsd * intent.allocated_weight_bps) / 10000n;

        if (this.riskGuardian.canOpenNewPosition(notionalMicroUsd)) {
          this.riskGuardian.registerPositionOpen({
            positionId: `pos_${intent.intent_id}`,
            engine: 'SENTINEL',
            mode: 'LIVE',
            walletAddress: 'CONFLUENCE_PULLBACK_SNIPER',
            tokenSymbol: intent.token_symbol,
            tokenMint: intent.token_mint,
            side: 'LONG',
            requestedAmountMicroUsd: notionalMicroUsd,
            executionPriceMicroUsd: evalOut.fillExecutionPriceMicroUsd,
            timestampMs: nowMs,
          });
        }
      }
    }

    return outputs;
  }

  public evaluateOpenPositionTimeStop(
    positionId: string,
    currentExitPriceMicroUsd: bigint,
    rvolInput: RvolTimeStopInput
  ): AdaptiveTimeStopDecision {
    const decision = this.rvolTimeStop.evaluateTimeStop(rvolInput);
    if (decision.shouldClosePosition) {
      this.riskGuardian.registerPositionClose(
        positionId,
        currentExitPriceMicroUsd,
        rvolInput.nowMs
      );
    }
    return decision;
  }

  public getSentinelMultiplierBps(): bigint {
    return this.currentSentinelMultiplierBps;
  }

  public getCatalystMultiplierBps(): bigint {
    return this.currentCatalystMultiplierBps;
  }

  private rollingClosePricesMicroUsd: bigint[] = [];

  public recordPriceTick(priceMicroUsd: bigint): void {
    if (priceMicroUsd <= 0n) return;
    this.rollingClosePricesMicroUsd.push(priceMicroUsd);
    if (this.rollingClosePricesMicroUsd.length > 50) {
      this.rollingClosePricesMicroUsd.shift();
    }
  }

  public resetRollingPrices(basePrice?: bigint): void {
    this.rollingClosePricesMicroUsd = [];
    if (basePrice && basePrice > 0n) {
      for (let i = 0; i < 20; i++) {
        this.rollingClosePricesMicroUsd.push(basePrice);
      }
    }
  }

  public computeDynamicRegimeSample(nowMs: bigint): MarketRegimeSampleInput {
    const rawBasePrice = this.rollingClosePricesMicroUsd.length > 0
      ? this.rollingClosePricesMicroUsd[this.rollingClosePricesMicroUsd.length - 1]
      : 89_300_000n;
    const basePrice = rawBasePrice > 0n ? rawBasePrice : 89_300_000n;

    let prices: bigint[] = [];
    if (this.rollingClosePricesMicroUsd.length >= 5) {
      // Filtrar precios anómalos que difieran más de un 20% del precio base (ej. mezclas de otros activos)
      const cleanPrices = this.rollingClosePricesMicroUsd.slice(-20).filter(p => {
        const delta = p > basePrice ? p - basePrice : basePrice - p;
        return (delta * 10000n) / basePrice <= 2000n; // Máximo 20.00% de delta
      });
      prices = cleanPrices.length >= 5 ? cleanPrices : [basePrice, basePrice, basePrice, basePrice, basePrice];
    } else {
      prices = [
        basePrice - (basePrice * 15n) / 10000n,
        basePrice - (basePrice * 8n) / 10000n,
        basePrice - (basePrice * 2n) / 10000n,
        basePrice + (basePrice * 3n) / 10000n,
        basePrice
      ];
    }

    const sum = prices.reduce((acc, p) => acc + p, 0n);
    const mean = sum / BigInt(prices.length);

    let varianceSum = 0n;
    for (const p of prices) {
      const diff = p - mean;
      varianceSum += (diff * diff) / 1_000_000n;
    }
    const variance = varianceSum / BigInt(prices.length);
    const stdDev = BigInt(Math.floor(Math.sqrt(Number(variance)))) * 1_000n;

    const bollingerMidMicroUsd = mean;
    const bollingerUpperMicroUsd = mean + (2n * stdDev);
    const bollingerLowerMicroUsd = mean > (2n * stdDev) ? mean - (2n * stdDev) : 0n;

    let deltaSum = 0n;
    for (let i = 1; i < prices.length; i++) {
      const d = prices[i] - prices[i - 1];
      deltaSum += d < 0n ? -d : d;
    }
    const avgDelta = prices.length > 1 ? deltaSum / BigInt(prices.length - 1) : 1_000_000n;
    const atr5mMicroUsd = avgDelta > 0n ? avgDelta : 1_000_000n;
    const atr1hMicroUsd = (atr5mMicroUsd * 8500n) / 10000n;

    return {
      closePricesMicroUsd: prices,
      atr5mMicroUsd,
      atr1hMicroUsd,
      bollingerUpperMicroUsd,
      bollingerMidMicroUsd,
      bollingerLowerMicroUsd,
      timestampMs: nowMs
    };
  }

  private isSupervisorTicking: boolean = false;

  private runDefaultBackgroundSupervisorCycle(nowMs: bigint): void {
    if (this.isSupervisorTicking) return;
    this.isSupervisorTicking = true;
    try {
      const latestRegime = this.aetherRepo.getLatestRegimeTelemetry();
      if (!latestRegime) return;

      this.runMacroRegimeAndCarrySupervisorTick(this.computeDynamicRegimeSample(nowMs));

      // Evaluar expiración por TTL de órdenes límite de retroceso pendientes
      const waitingIntents = this.pullbackRepo.getAllWaitingIntents();
      for (const intent of waitingIntents) {
        if (nowMs >= intent.expires_at_ms) {
          this.pullbackRepo.updateIntentStatus(intent.intent_id, 'CANCELLED_TTL_EXPIRED');
        }
      }
    } catch (err) {
      console.error('[SUPERVISOR_CYCLE_ERROR]:', err);
    } finally {
      this.isSupervisorTicking = false;
    }
  }
}

async function main() {
  const DATA_SOURCE = (process.env.DATA_SOURCE || 'SIMULATED').toUpperCase();
  if (DATA_SOURCE !== 'REAL' && DATA_SOURCE !== 'SIMULATED') {
    throw new Error(`CONFIG_ERROR: DATA_SOURCE debe ser 'REAL' o 'SIMULATED'. Recibido: ${process.env.DATA_SOURCE}`);
  }

  console.log('================================================================');
  console.log('🛡️  NEXUS QUANT SUITE v2.0: SENTINEL & CATALYST ENGINES');
  console.log(`   Protocolo de Ingeniería Cuantitativa N2 [MODO: ${DATA_SOURCE}]`);
  console.log('================================================================');

  // 1. Inicializar persistencia SQLite WAL
  const db = new NexusDatabase('nexus_quant.db');
  const baseCapitalMicro = 100_000_000_000n; // $100,000 USD
  db.initRiskGuardianState(baseCapitalMicro);

  // 2. Supervisor de Riesgo y Reconciliación de Estado tras Reinicios/Crashes
  const guardian = new RiskGuardian(db);
  const reconciled = guardian.reconcileStartupState();
  console.log(`[BOOT] Reconciliación de Estado: Posiciones Abiertas = ${reconciled.openPositionsCount}, Exposición = ${reconciled.openExposureMicro} µUSD`);

  // 2b. Supervisor Activo de Posiciones Vivas (Stop-Loss, Trailing, Time-Stops)
  const supervisor = new ActivePositionSupervisor(db, guardian);
  supervisor.enableTakerFeeDeduction(true);
  supervisor.rehydrateAndResumeAll(reconciled.openPositions);

  // 3. Sembrado Condicional del Pool de 50 Billeteras
  const rotator = new SentinelPurgeRotator(db);
  if (DATA_SOURCE === 'SIMULATED') {
    const rawDb = db.getRawDb();
    const countRow = rawDb.prepare('SELECT COUNT(*) as count FROM sentinel_wallets_pool').get() as { count: bigint };
    if (Number(countRow.count) === 0) {
      console.log('🌱 Sembrando pool inicial de 50 billeteras reales de Solana Mainnet-Beta...');
      rotator.seedInitialPool(REAL_SOLANA_WHALES);
    } else if (Number(countRow.count) > 50) {
      console.log(`🧹 Podando pool dinámico de billeteras a exactamente 50 (10 LIVE / 40 SHADOW)...`);
      rawDb.exec(`
        DELETE FROM sentinel_wallets_pool
        WHERE wallet_address NOT IN (
          SELECT wallet_address FROM sentinel_wallets_pool
          WHERE pool_tier = 'LIVE'
          ORDER BY profit_factor_scaled DESC
          LIMIT 10
        ) AND pool_tier = 'LIVE';

        DELETE FROM sentinel_wallets_pool
        WHERE wallet_address NOT IN (
          SELECT wallet_address FROM sentinel_wallets_pool
          WHERE pool_tier = 'SHADOW'
          ORDER BY profit_factor_scaled DESC
          LIMIT 40
        ) AND pool_tier = 'SHADOW';
      `);
      console.log(`ℹ️  Pool de billeteras podado y normalizado a 50 registros.`);
    } else {
      console.log(`ℹ️  Pool de billeteras existente en SQLite (${countRow.count} registros preservados).`);
    }
  } else {
    console.log('🔒 PRODUCCIÓN REAL: Sembrado simulado desactivado. Conservando pool on-chain estricto.');
  }

  // 4. Iniciar Enlace WebSocket en Vivo con Solana Mainnet RPC y Servidor de Dashboard
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
  const solanaWsListener = new WalletWsListener();
  solanaWsListener.start();

  // Sincronizar billeteras monitoreadas en el listener de Solana Mainnet
  const initialDbWallets = (db.getRawDb().prepare('SELECT wallet_address as address, chain_id as chainId, pool_tier as tier FROM sentinel_wallets_pool').all() as any[])
    .map(w => ({ address: String(w.address), chainId: String(w.chainId || 'SOLANA'), tier: w.tier as 'LIVE' | 'SHADOW' }));
  solanaWsListener.setMonitoredWallets(initialDbWallets);
  console.log(`📡 [SolanaWsListener] Monitoreando ${initialDbWallets.length} billeteras de Solana Mainnet.`);

  // Instanciar motores cuantitativos institucionales y enlace de precios en tiempo real
  const livePriceFeed = new LivePriceFeed();
  const ringBufferManager = new GlobalL2RingBufferManager();
  const l2Simulator = new L2ShadowSimulator(db);
  const phasedEntryRouter = new SentinelPhasedEntryRouter();
  const anchoredIocRouter = new AnchoredIocRouter();

  // Conectar resolvedor de precios de mercado dinámico y ring buffer
  solanaWsListener.setPriceResolver((ticker) => livePriceFeed.getLatestPrice(ticker));

  // 4d. Orquestador Triádico v3.0 (Aether Macro Regime + Carry Delta-Neutral)
  const guardianAdapter: RiskGuardianAdapter = {
    canOpenNewPosition: (requestedAmountMicroUsd) => {
      const state = db.getRiskGuardianState();
      const now = BigInt(Date.now());
      if (state.circuit_breaker_until_ms > now) return false;
      if (state.open_positions_count >= 3n) return false;
      const maxAllowedExposure = (state.base_capital_micro * 3000n) / 10000n;
      return (state.open_exposure_micro + requestedAmountMicroUsd) <= maxAllowedExposure;
    },
    registerPositionOpen: (req) => {
      const quantityAtomic = req.executionPriceMicroUsd > 0n
        ? ((req.requestedAmountMicroUsd * 1_000_000_000n) / req.executionPriceMicroUsd).toString()
        : '0';

      const stopLossMicro = req.side === 'LONG'
        ? (req.executionPriceMicroUsd * 9200n) / 10000n // -8% Stop-Loss nativo
        : (req.executionPriceMicroUsd * 10800n) / 10000n;

      const res = db.allocateAndInsertPositionAtomic({
        position_id: req.positionId,
        engine_origin: req.engine === 'SENTINEL' ? 'SENTINEL_ONCHAIN' : 'CATALYST_NEWS',
        signal_ref_id: req.engine === 'SENTINEL' ? req.walletAddress : req.tokenMint,
        execution_mode: req.mode,
        instrument_ticker: req.tokenSymbol,
        side: req.side === 'LONG' ? 1 : -1,
        phase_allocation_bps: 10000n,
        notional_invested_micro: req.requestedAmountMicroUsd,
        quantity_atomic: quantityAtomic,
        entry_price_micro: req.executionPriceMicroUsd,
        stop_loss_micro: stopLossMicro,
        trailing_stop_micro: null,
        take_profit_micro: null,
        peak_price_micro: req.executionPriceMicroUsd
      });

      if (!res.success) {
        console.warn(`[ORCHESTRATOR] Entrada rechazada por RiskGuardian: ${res.rejectReason}`);
      } else {
        const row = db.getRawDb().prepare('SELECT * FROM unified_positions_ledger WHERE position_id = ?').get(req.positionId) as any;
        if (row) {
          supervisor.trackNewPosition(row);
        }
        console.log(`[ORCHESTRATOR] Entrada registrada y persistida: ${req.positionId} (${req.tokenSymbol}) @ ${req.executionPriceMicroUsd}`);
      }
    },
    registerPositionClose: (positionId, exitPriceMicroUsd, nowMsParam) => {
      const rawDb = db.getRawDb();
      const row = rawDb.prepare('SELECT * FROM unified_positions_ledger WHERE position_id = ?').get(positionId) as any;
      if (row && (row.status === 'OPEN' || row.status === 'PARTIALLY_CLOSED')) {
        const notionalInvested = BigInt(row.notional_invested_micro);
        const entryPrice = BigInt(row.entry_price_micro);
        const tokensAtomic = BigInt(row.quantity_atomic);
        const isShort = row.side === -1;
        const priceDelta = isShort ? (entryPrice - exitPriceMicroUsd) : (exitPriceMicroUsd - entryPrice);
        const grossPnlMicro = (priceDelta * tokensAtomic) / 1_000_000_000n;
        const exitNotionalMicro = (exitPriceMicroUsd * tokensAtomic) / 1_000_000_000n;

        // Comisiones Taker institucionales (7 bps entrada + 7 bps salida = 14 bps roundtrip) + fricción de red
        const entryFeeMicro = (notionalInvested * 7n) / 10000n;
        const exitFeeMicro = (exitNotionalMicro * 7n) / 10000n;
        const networkFrictionMicro = 5_000n; // Fricción de red on-chain
        const realizedPnlMicro = grossPnlMicro - entryFeeMicro - exitFeeMicro - networkFrictionMicro;
        const nowMs = nowMsParam ?? BigInt(Date.now());

        rawDb.prepare(`
          UPDATE unified_positions_ledger
          SET status = 'CLOSED', closed_at_ms = ?, realized_pnl_micro = ?, exit_price_micro = ?
          WHERE position_id = ?
        `).run(nowMs, realizedPnlMicro.toString(), exitPriceMicroUsd.toString(), positionId);

        db.recordPositionClosedAtomic(notionalInvested, realizedPnlMicro);
        console.log(`[ORCHESTRATOR] Cierre atómico completado: ${positionId} PnL Neto: ${realizedPnlMicro} µUSD (Bruto: ${grossPnlMicro}, Fees: -${entryFeeMicro + exitFeeMicro + networkFrictionMicro})`);

        // Reconciliación de ballena si es un trade Sentinel cerrado
        if (row.engine_origin === 'SENTINEL_ONCHAIN' && row.signal_ref_id) {
          const isWin = realizedPnlMicro > 0n;
          db.recordWhaleTradeOutcome(row.signal_ref_id, isWin);
        }
      }
    },
    getGlobalRiskTelemetry: () => {
      const state = db.getRiskGuardianState();
      return {
        account_balance_micro_usd: state.base_capital_micro,
        current_exposure_bps: state.base_capital_micro > 0n ? (state.open_exposure_micro * 10000n / state.base_capital_micro) : 0n,
        max_exposure_limit_bps: 3000n,
        daily_pnl_micro_usd: state.rolling_24h_pnl_micro,
        daily_pnl_bps: state.base_capital_micro > 0n ? (state.rolling_24h_pnl_micro * 10000n / state.base_capital_micro) : 0n,
        cold_wallet_locked_micro_usd: 0n,
        circuit_breaker_tripped: state.circuit_breaker_until_ms > BigInt(Date.now()),
        kill_switch_active: false
      };
    },
    resetCircuitBreakerWithPhrase: (phrase) => phrase === 'RESET_CIRCUIT_BREAKER_EMERGENCY',
    triggerEmergencyKillSwitch: () => guardian.executeKillSwitch()
  };

  const orchestrator = new NexusQuantOrchestrator({
    dbDriver: db.getRawDb(),
    riskGuardian: guardianAdapter,
    enableBackgroundLoops: true
  });
  orchestrator.boot(false, true);
  orchestrator.confluenceTracker.seedDefaultClusters();

  const { server, broadcast, getWalletPool, getOpenPositions } = startDashboardServer(db, guardian, port, {
    getSolanaTelemetry: () => solanaWsListener.getNetworkTelemetry(),
    getConfluenceClusters: () => orchestrator.confluenceTracker.getActiveClusters(),
    getLivePrice: (ticker) => livePriceFeed.getLatestPrice(ticker),
    onResetRegime: () => {
      const currentSol = livePriceFeed.getLatestPrice('SOL') ?? 89_300_000n;
      orchestrator.setManualRegimeOverride('REGIME_TRENDING');
      orchestrator.resetRollingPrices(currentSol);
      console.log(`🛡️ [AETHER_REGIME_RESET] Régimen forzado a TENDENCIA ACTIVA y precios móviles depurados (${currentSol} µUSD).`);
    }
  });

  // Registrar callback de salida de posiciones supervisadas activamente
  supervisor.setOnExitTriggered(async (positionId, action, qty, price, reason) => {
    console.log(`⚡ [EXIT_EXECUTED] ${positionId} -> ${action} | Qty: ${qty} @ ${price} µUSD | Motivo: ${reason}`);

    const rawDb = db.getRawDb();
    const row = rawDb.prepare('SELECT * FROM unified_positions_ledger WHERE position_id = ?').get(positionId) as any;
    let updatedWallets: any[] | null = null;
    if (row && row.engine_origin === 'SENTINEL_ONCHAIN' && row.signal_ref_id) {
      // Reconciliar resultado de ballena únicamente ante cierres totales (no en De-Risk parcial)
      if (action !== 'DERISK_75PCT' && action !== 'DERISK_65PCT') {
        const pnl = row.realized_pnl_micro ? BigInt(row.realized_pnl_micro) : 0n;
        const isWin = pnl > 0n || action === 'MOONBAG_TRAILING_STOP';
        const outcome = db.recordWhaleTradeOutcome(row.signal_ref_id, isWin);
        console.log(`🐋 [WHALE_RECONCILIATION] Ballena ${row.signal_ref_id} -> ${isWin ? 'WIN' : 'LOSS'} | Pérdidas consecutivas: ${outcome.consecutiveLosses}/3`);
        updatedWallets = getWalletPool();
        broadcast({
          type: 'WALLETS_UPDATE',
          wallets: updatedWallets
        });

        // Liberar el cluster en PhasedEntryRouter si ya no quedan posiciones vivas en ese token
        const remainingForToken = getOpenPositions().filter(p => p.tokenTicker === row.instrument_ticker);
        if (remainingForToken.length === 0) {
          phasedEntryRouter.resetCluster(row.instrument_ticker);
          phasedEntryRouter.resetCluster('So11111111111111111111111111111111111111112');
          console.log(`🔄 [ROUTER_RESET] Cluster de confluencia reseteado para ${row.instrument_ticker}. Listo para nuevos ciclos.`);
        }
      }
    }

    const currentPositions = getOpenPositions();
    const state = db.getRiskGuardianState();
    broadcast({
      type: 'TRADE_UPDATE',
      lifetimeKpis: db.getLifetimeTradeMetrics(),
      wallets: updatedWallets || undefined,
      positions: currentPositions,
      trade: row ? {
        positionId: row.position_id,
        engineOrigin: row.engine_origin,
        signalRefId: row.signal_ref_id,
        executionMode: row.execution_mode,
        instrumentTicker: row.instrument_ticker,
        side: row.side,
        notionalInvestedMicro: row.notional_invested_micro.toString(),
        entryPriceMicro: row.entry_price_micro.toString(),
        peakPriceMicro: (row.peak_price_micro || price).toString(),
        exitPriceMicro: price.toString(),
        quantityAtomic: row.quantity_atomic ? row.quantity_atomic.toString() : '0',
        stopLossMicro: row.stop_loss_micro ? row.stop_loss_micro.toString() : '0',
        status: row.status,
        realizedPnlMicro: row.realized_pnl_micro ? row.realized_pnl_micro.toString() : '0',
        unrealizedPnlMicro: '0',
        openedAtMs: Number(row.opened_at_ms),
        closedAtMs: Number(row.closed_at_ms || Date.now())
      } : undefined
    });

    broadcast({
      type: 'POSITIONS_UPDATE',
      positions: currentPositions
    });

    broadcast({
      type: 'RISK_UPDATE',
      executionMode: state.execution_mode,
      openExposureMicro: state.open_exposure_micro.toString(),
      baseCapitalMicro: state.base_capital_micro.toString(),
      rolling24hPnlMicro: state.rolling_24h_pnl_micro.toString(),
      circuitBreakerActive: state.circuit_breaker_until_ms > BigInt(Date.now())
    });
  });

  // Iniciar feed en tiempo real de Binance Public WebSocket y cablear eventos
  livePriceFeed.start();
  livePriceFeed.onPriceTick(async (tick) => {
    // 1. Alimentar ring buffer con instantánea L2 nivel a nivel
    const snapshot = createL2SnapshotFromPrice(
      tick.priceMicroUsd,
      BigInt(tick.timestampMs),
      10,
      10n,
      5_000_000_000n
    );
    ringBufferManager.recordTick(tick.baseAsset, snapshot);
    ringBufferManager.recordTick(tick.ticker, snapshot);

    // Actualizar precios y semáforos en el radar de confluencia Sentinel
    const clusterUpdated = orchestrator.confluenceTracker.updateClusterPrice(tick.ticker, tick.priceMicroUsd) ||
      orchestrator.confluenceTracker.updateClusterPrice(tick.baseAsset, tick.priceMicroUsd);
    if (clusterUpdated) {
      broadcast({
        type: 'CLUSTERS_UPDATE',
        clusters: orchestrator.confluenceTracker.getActiveClusters()
      });
    }

    // 2. Registrar precio en el orquestador macro (Aether Carry & Regímenes)
    // CRÍTICO: Filtrar únicamente ticks del activo primario (SOL).
    // Previene contaminación cruzada de precios con BTC ($91,500) o ETH ($3,000)
    // que detonaban falsos positivos de volatilidad extrema (BBW > 480%).
    if (tick.baseAsset === 'SOL' || tick.ticker === 'SOL/USD') {
      orchestrator.recordPriceTick(tick.priceMicroUsd);
    }

    // 3. Evaluar Stop-Loss nativo, Trailing Stop y Time-Stops en ActivePositionSupervisor
    await supervisor.evaluatePriceTick(tick.ticker, tick.priceMicroUsd, BigInt(tick.timestampMs));
    if (tick.baseAsset !== tick.ticker) {
      await supervisor.evaluatePriceTick(tick.baseAsset, tick.priceMicroUsd, BigInt(tick.timestampMs));
    }

    // 4. Evaluar intenciones de retroceso pendientes (Pullbacks)
    orchestrator.evaluatePendingPullbacksOnTick(tick.baseAsset, tick.priceMicroUsd, BigInt(tick.timestampMs));

    // 5. Transmitir posiciones abiertas en tiempo real con PnL dinámico actualizado
    broadcast({
      type: 'POSITIONS_UPDATE',
      positions: getOpenPositions()
    });
  });

  server.listen(port, () => {
    console.log(`\n🚀 DASHBOARD ACTIVO: http://localhost:${port}`);
    console.log(`   - RiskGuardian Control Bar: ACTIVO [DATA_SOURCE: ${DATA_SOURCE}]`);
    console.log(`   - Vista 1: Sentinel On-Chain (10 LIVE / 40 SHADOW): ACTIVO`);
    console.log(`   - Vista 2: Catalyst Engine (Arbitraje Sub-Segundo): ACTIVO`);
    console.log(`   - Vista 3: Unified Ledger (Historial de Trades): ACTIVO`);
    console.log(`   - Vista 4: Aether Carry & Régimen (Pilar Delta-Neutral): ACTIVO`);
    console.log(`   - WebSocket Feed en tiempo real: Conectado`);
    console.log(`   - Ephemeral Admin Token (X-Nexus-Auth): ${LOCAL_ADMIN_TOKEN}`);
    console.log(`   - Próximo Ciclo de Purga: ${new Date(db.getNextPurgeTimestampMs()).toLocaleTimeString()}`);
  });

  // 4b. Gestor de Snapshots Atómicos Periódicos (Cada 6h con replicación a la Nube)
  const backupManager = new VaultBackupManager();
  const BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
  setInterval(async () => {
    try {
      const res = await backupManager.executeBackup(db);
      console.log(`💾 [AUTO_BACKUP] Snapshot completado: ${res.localPath} (Cloud: ${res.cloudPath || 'N/A'})`);
    } catch (err) {
      console.error('⚠️ [AUTO_BACKUP_ERROR] Fallo en snapshot periódico:', err);
    }
  }, BACKUP_INTERVAL_MS);

  // 4c. Programador del Ciclo de Rotación y Purga (6 Horas Persistentes en SQLite)
  const ROTATION_CHECK_INTERVAL_MS = 30_000;
  setInterval(() => {
    const now = Date.now();
    const nextPurge = db.getNextPurgeTimestampMs();
    if (now >= nextPurge) {
      console.log('🔄 [ROTATOR_6H] Ejecutando rotación programada del pool de 50 billeteras...');
      const rotationResult = rotator.executeRotationCycle(BigInt(now));
      console.log(`✅ [ROTATOR_6H] Ciclo completado: Promovidas = ${rotationResult.promotedCount}, Degradadas = ${rotationResult.demotedCount}, Purgadas = ${rotationResult.purgedCount}`);
      const updatedWallets = getWalletPool();
      broadcast({
        type: 'PURGE_CYCLE_EXECUTED',
        nextPurgeTimestampMs: db.getNextPurgeTimestampMs(),
        wallets: updatedWallets,
        result: rotationResult
      });
    }
  }, ROTATION_CHECK_INTERVAL_MS);

  // 5. Motor de Ejecución Oficial Binance (Testnet & Producción / Paper Trading con Precios Reales)
  const binanceClient = new BinanceExecutionClient();

  const executeQuantitativeShadowOrder = async (params: {
    origin: 'SENTINEL_ONCHAIN' | 'CATALYST_NEWS';
    refId: string;
    walletAddress?: string;
    ticker: string;
    side: 1 | -1;
    notionalMicroUsd: bigint;
    phaseAllocationBps?: bigint;
    limitPriceCapMicroUsd: bigint;
    stopLossMicroUsd: bigint;
    label: string;
  }) => {
    // 1. Guardia de Circuit Breaker y Exposición
    const currentState = db.getRiskGuardianState();
    const now = BigInt(Date.now());
    if (currentState.circuit_breaker_until_ms > now) {
      console.warn(`⚠️ [EXECUTION] Operación rechazada: Circuit Breaker temporal activo.`);
      return;
    }

    if (!guardianAdapter.canOpenNewPosition(params.notionalMicroUsd)) {
      console.warn(`⚠️ [EXECUTION] Risk Guardian rechazó orden para ${params.ticker}: excede límite de exposición.`);
      return;
    }

    const effectiveSignalRef = params.origin === 'SENTINEL_ONCHAIN' && params.walletAddress ? params.walletAddress : params.refId;
    const orderId = `${params.origin === 'SENTINEL_ONCHAIN' ? 'SENT' : 'CAT'}_${effectiveSignalRef.slice(0, 8)}_${now.toString().slice(-6)}`;
    const posId = `POS_${orderId}`;

    // 2. Consulta de precio de mercado verificado en tiempo real (CERO ALUCINACIONES)
    let verifiedPrice = livePriceFeed.getLatestPrice(params.ticker);
    if (!verifiedPrice || verifiedPrice <= 0n) {
      verifiedPrice = await binanceClient.getMarketPrice(params.ticker);
    }

    // 3. Ejecución directa a través de BinanceExecutionClient
    const execResult = await binanceClient.executeBracketOrder({
      positionId: posId,
      ticker: params.ticker,
      side: params.side,
      notionalMicroUsd: params.notionalMicroUsd,
      stopLossPriceMicroUsd: params.stopLossMicroUsd,
      limitPriceCapMicroUsd: params.limitPriceCapMicroUsd,
      engineOrigin: params.origin,
      walletAddress: params.walletAddress,
      nowMs: now
    }, verifiedPrice);

    if (execResult.status !== 'FILLED') {
      console.warn(`⚠️ [EXECUTION] Orden ${orderId} no ejecutada por BinanceExecutionClient: ${execResult.status} (${execResult.rejectionReason || ''})`);
      return;
    }

    // 4. Asignación atómica en SQLite WAL y actualización de RiskGuardian
    const allocRes = db.allocateAndInsertPositionAtomic({
      position_id: posId,
      engine_origin: params.origin,
      signal_ref_id: effectiveSignalRef,
      execution_mode: execResult.isPaperExecution ? 'SHADOW' : 'LIVE',
      instrument_ticker: params.ticker,
      side: params.side,
      phase_allocation_bps: params.phaseAllocationBps ?? 10000n,
      notional_invested_micro: execResult.filledNotionalMicroUsd,
      quantity_atomic: execResult.filledQuantityAtomic.toString(),
      entry_price_micro: execResult.executionPriceMicroUsd,
      stop_loss_micro: params.stopLossMicroUsd,
      trailing_stop_micro: null,
      take_profit_micro: null,
      peak_price_micro: execResult.executionPriceMicroUsd,
      venue_track: 'BINANCE_LIQUID_CEX',
      is_breakeven_locked: 0,
      is_tp1_executed: 0,
      is_tp2_executed: 0
    });

    if (!allocRes.success) {
      console.warn(`⚠️ [EXECUTION] Error al persistir posición en SQLite: ${allocRes.rejectReason}`);
      return;
    }

    const posRow = db.getRawDb().prepare('SELECT * FROM unified_positions_ledger WHERE position_id = ?').get(posId) as any;
    if (posRow) {
      // Registrar en ActivePositionSupervisor para monitoreo de Trailing Stops
      supervisor.trackNewPosition(posRow);

      const stateAfter = db.getRiskGuardianState();
      const modeLabel = execResult.isPaperExecution ? 'PAPER (PRECIOS REALES BINANCE)' : 'BINANCE_TESTNET_LIVE';
      console.log(`⚡ [EXECUTION_SUCCESS] ${posId} (${params.ticker} ${params.side === 1 ? 'LONG' : 'SHORT'}) | Precio: $${(Number(execResult.executionPriceMicroUsd) / 1_000_000).toFixed(4)} | Nocional: $${(Number(execResult.filledNotionalMicroUsd) / 1_000_000).toFixed(2)} USD | Taker Fee: $${(Number(execResult.takerFeePaidMicroUsd) / 1_000_000).toFixed(4)} | Modo: ${modeLabel}`);

      broadcast({
        type: 'TRADE_UPDATE',
        lifetimeKpis: db.getLifetimeTradeMetrics(),
        positions: getOpenPositions(),
        trade: {
          positionId: posId,
          engineOrigin: params.origin,
          signalRefId: effectiveSignalRef,
          executionMode: execResult.isPaperExecution ? 'SHADOW' : 'LIVE',
          instrumentTicker: params.ticker,
          side: params.side,
          notionalInvestedMicro: execResult.filledNotionalMicroUsd.toString(),
          entryPriceMicro: execResult.executionPriceMicroUsd.toString(),
          peakPriceMicro: execResult.executionPriceMicroUsd.toString(),
          stopLossMicro: params.stopLossMicroUsd.toString(),
          status: 'OPEN',
          realizedPnlMicro: '0',
          unrealizedPnlMicro: '0',
          openedAtMs: Number(now),
          closedAtMs: null
        }
      });

      broadcast({
        type: 'POSITIONS_UPDATE',
        positions: getOpenPositions()
      });

      broadcast({
        type: 'RISK_UPDATE',
        executionMode: stateAfter.execution_mode,
        openExposureMicro: stateAfter.open_exposure_micro.toString(),
        baseCapitalMicro: stateAfter.base_capital_micro.toString(),
        rolling24hPnlMicro: stateAfter.rolling_24h_pnl_micro.toString(),
        circuitBreakerActive: stateAfter.circuit_breaker_until_ms > now
      });
    }
  };

  // 1. DISPARADOR REAL ON-CHAIN: Enrutamiento cuantitativo institucional por fases
  solanaWsListener.onTrade(async (tradeEvent) => {
    console.log(`🐋 [SENTINEL_WHALE_HIT] Transacción confirmada de ballena LIVE: ${tradeEvent.walletAddress.slice(0, 8)}... | ${tradeEvent.tradeType} ${tradeEvent.tokenTicker} | Tx: https://solscan.io/tx/${tradeEvent.txHash}`);

    // Cero Alucinaciones: Solo operar tokens con cotización verificada
    let currentPrice = livePriceFeed.getLatestPrice(tradeEvent.tokenTicker)
      ?? (tradeEvent.priceMicroUsd > 0n ? tradeEvent.priceMicroUsd : null);

    if (!currentPrice || currentPrice <= 0n) {
      currentPrice = await binanceClient.getMarketPrice(tradeEvent.tokenTicker);
    }

    if (!currentPrice || currentPrice <= 0n) {
      console.warn(`🛑 [SENTINEL_DISCARD] Descartada transacción de ballena en '${tradeEvent.tokenTicker}': Sin cotización verificada en Binance. Protegiendo capital contra alucinación.`);
      return;
    }

    // Actualizar precios y semáforos en el radar de confluencia Sentinel
    orchestrator.confluenceTracker.updateClusterPrice(tradeEvent.tokenTicker, currentPrice);
    broadcast({
      type: 'CLUSTERS_UPDATE',
      clusters: orchestrator.confluenceTracker.getActiveClusters()
    });

    const command = phasedEntryRouter.processSignal({
      walletAddress: tradeEvent.walletAddress,
      tokenAddress: tradeEvent.tokenAddress,
      tokenTicker: tradeEvent.tokenTicker,
      priceMicroUsd: currentPrice,
      timestampMs: tradeEvent.timestampMs
    });

    if (command.type === 'LIMIT_PULLBACK_BUY') {
      orchestrator.pullbackRepo.upsertIntent({
        intent_id: `intent_${tradeEvent.tokenTicker}_${Date.now()}`,
        token_symbol: tradeEvent.tokenTicker,
        token_mint: tradeEvent.tokenAddress,
        confluence_count: 3,
        unique_funding_roots_json: JSON.stringify([tradeEvent.walletAddress]),
        pre_whale_price_micro_usd: currentPrice,
        peak_impact_price_micro_usd: currentPrice + (currentPrice * 1200n) / 10000n,
        limit_target_price_micro_usd: command.priceMicroUsd,
        allocated_weight_bps: command.allocationBps,
        status: 'WAITING_PULLBACK',
        created_at_ms: tradeEvent.timestampMs,
        expires_at_ms: tradeEvent.timestampMs + 600_000n
      });
      console.log(`🎯 [PULLBACK_ROUTER] Límite de retroceso registrado para ${tradeEvent.tokenTicker} @ ${command.priceMicroUsd} µUSD`);
      return;
    }

    if (command.type !== 'MARKET_BUY') {
      return;
    }

    const tradeNotional = (5_000_000_000n * command.allocationBps) / 10000n;
    const pCap = currentPrice + (currentPrice * 100n) / 10000n; // Tope duro +1%
    const stopLoss = currentPrice - (currentPrice * 180n) / 10000n; // v4.0 CEX SL nativo -1.80% (Protección estricta)

    await executeQuantitativeShadowOrder({
      origin: 'SENTINEL_ONCHAIN',
      refId: tradeEvent.walletAddress,
      walletAddress: tradeEvent.walletAddress,
      ticker: tradeEvent.tokenTicker,
      side: 1, // LONG
      notionalMicroUsd: tradeNotional,
      phaseAllocationBps: command.allocationBps,
      limitPriceCapMicroUsd: pCap,
      stopLossMicroUsd: stopLoss,
      label: `Ballena ${tradeEvent.walletAddress.slice(0, 8)}... (${command.reason})`
    });
  });

  // 2. DISPARADOR REAL DE NOTICIAS: Ingesta en vivo de CoinDesk y CoinTelegraph para Catalyst Engine
  const realNewsPoller = new RealNewsPoller();
  realNewsPoller.setRingBufferManager(ringBufferManager);
  realNewsPoller.onNews(async (event) => {
    let anchorPrice = livePriceFeed.getLatestPrice(event.primaryTicker);
    if (!anchorPrice || anchorPrice <= 0n) {
      anchorPrice = await binanceClient.getMarketPrice(event.primaryTicker);
    }
    if (!anchorPrice || anchorPrice <= 0n) {
      console.warn(`🛑 [CATALYST_DISCARD] Noticia descartada para ${event.primaryTicker}: Sin cotización verificada en Binance. Protegiendo capital contra alucinación.`);
      return;
    }

    try {
      const rawDb = db.getRawDb();
      rawDb.prepare(`
        INSERT OR IGNORE INTO catalyst_news_events (
          event_id, simhash_64, primary_ticker, category, direction,
          ai_score_bps, source_trust_bps, flow_confirm_bps, conviction_ct_bps,
          pre_event_drift_15m_bps, anchor_price_micro, action_taken,
          first_published_ms, ingested_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        event.eventId,
        event.simhash64Hex,
        event.primaryTicker,
        event.category,
        event.direction,
        event.siaBps,
        event.sourceTrustBps,
        event.flowConfirmBps,
        event.convictionCtBps,
        event.preEventDrift15mBps,
        anchorPrice,
        event.actionTaken,
        Date.now(),
        Date.now()
      );
    } catch { /* ignore */ }

    broadcast({
      type: 'CATALYST_EVENT',
      event
    });
    console.log(`[CATALYST_REAL_NEWS] [${event.sources[0]}] ${event.headline.slice(0, 65)}... -> ${event.primaryTicker} | ${event.actionTaken} | Anchor: $${(Number(anchorPrice) / 1_000_000).toFixed(2)}`);

    if (event.actionTaken === 'STRIKE_T1' || event.actionTaken === 'PROBE_T2' || event.actionTaken === 'PANIC_SHORT') {
      const currentPrice = livePriceFeed.getLatestPrice(event.primaryTicker) ?? anchorPrice;
      const isMajor = ['BTC', 'ETH', 'SOL'].some(m => event.primaryTicker.includes(m));
      const side: 1 | -1 = event.direction === -1 ? -1 : 1;
      const notional = event.actionTaken === 'STRIKE_T1' ? 5_000_000_000n : 2_500_000_000n;

      const routing = anchoredIocRouter.routeOrder({
        orderId: `ORD_CAT_${event.eventId}`,
        ticker: `${event.primaryTicker}/USD`,
        side,
        isMajor,
        notionalMicroUsd: notional,
        anchorPriceMicroUsd: anchorPrice,
        currentPriceMicroUsd: currentPrice,
        timestampMs: BigInt(Date.now())
      });

      if (routing.orderType === 'LIMIT_IOC') {
        await executeQuantitativeShadowOrder({
          origin: 'CATALYST_NEWS',
          refId: event.eventId,
          ticker: event.primaryTicker,
          side,
          notionalMicroUsd: notional,
          limitPriceCapMicroUsd: routing.limitPriceMicroUsd,
          stopLossMicroUsd: routing.serverStopLossMicroUsd,
          label: `Catalyst [${event.sources[0]}] ${event.headline.slice(0, 40)}...`
        });
      } else {
        console.log(`ℹ️ [CATALYST_ROUTER] ${routing.reason}`);
      }
    }
  });
  realNewsPoller.start(30_000);

  // 3. Telemetría periódica hacia el Dashboard UI
  let telemetryTick = 0;
  setInterval(() => {
    telemetryTick++;
    if (telemetryTick % 2 === 0) {
      broadcast({
        type: 'SOLANA_TELEMETRY',
        telemetry: solanaWsListener.getNetworkTelemetry()
      });
    }
  }, 2000);
}

process.on('uncaughtException', (err) => {
  console.error('[GLOBAL_UNCAUGHT_EXCEPTION]:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[GLOBAL_UNHANDLED_REJECTION]:', reason);
});

process.on('SIGINT', () => {
  console.log('\n🛑 Señal SIGINT recibida. Cerrando servicio limpiamente...');
  process.exit(0);
});
process.on('SIGTERM', () => {
  console.log('\n🛑 Señal SIGTERM recibida. Cerrando servicio limpiamente...');
  process.exit(0);
});

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  main().catch(err => {
    console.error('CRITICAL_STARTUP_ERROR:', err);
    process.exit(1);
  });
}
