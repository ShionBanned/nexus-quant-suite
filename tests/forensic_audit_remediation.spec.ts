import { describe, it, expect, beforeEach } from 'vitest';
import { calcBpsDelta, BPS_SCALE } from '../src/core/math_bigint.js';
import { NexusDatabase } from '../src/core/db_sqlite_wal.js';
import { RiskGuardian } from '../src/core/risk_guardian.js';
import { SentinelAsymmetricExitManager, SentinelPosition } from '../src/engine_a_sentinel/whale_asymmetric_exit.js';
import { CatalystVelocityDecayExitManager, CatalystPosition } from '../src/engine_b_catalyst/velocity_decay_exit.js';
import { GlobalL2RingBufferManager } from '../src/core/ring_buffer_l2.js';
import { CatalystCorroborationBuffer } from '../src/engine_b_catalyst/simhash_deduplicator.js';
import { ActivePositionSupervisor } from '../src/core/position_supervisor.js';

describe('FORENSIC AUDIT REMEDIATION VERIFICATION (EGM SWARM V2.0)', () => {

  describe('Vector 2: Aritmética BigInt, Redondeo Floor y Short PnL', () => {
    it('calcBpsDelta redondea hacia -infinito para variaciones negativas (sin truncamiento complaciente)', () => {
      // Base: 10,000,000 µUSD. Variación pequeña negativa: delta = -1 µUSD.
      // -1 * 10,000 / 10,000,000 = -10,000 / 10,000,000.
      // Con truncamiento estándar hacia cero de JS (-10000n / 10000000n) daba 0n (pérdida ignorada).
      // Con floor rounding hacia -infinito debe dar -1n (-1 bps de pérdida reconocido de inmediato).
      const pCurrent = 9_999_999n;
      const pBase = 10_000_000n;
      const deltaBps = calcBpsDelta(pCurrent, pBase);
      expect(deltaBps).toBe(-1n);
    });

    it('CatalystVelocityDecayExitManager calcula correctamente el PnL para órdenes SHORT anclado a entryPrice', () => {
      const exitManager = new CatalystVelocityDecayExitManager();
      const pos: CatalystPosition = {
        positionId: 'POS_SHORT_ETH_01',
        ticker: 'ETH',
        isMajor: true,
        side: -1, // SHORT
        entryPriceMicroUsd: 3000_000_000n, // $3000
        peakPriceMicroUsd: 3000_000_000n,
        currentStopLossMicroUsd: 3045_000_000n, // +45 bps
        totalQuantityAtomic: 10_000_000_000n,
        remainingQuantityAtomic: 10_000_000_000n,
        openedAtMs: 1000n,
        isDeRisked: false,
        isClosed: false
      };

      // Si el precio cae a $2940 (caída del 2%), el short gana +200 bps
      const decisionProfit = exitManager.evaluate(pos, 2940_000_000n, 2000n);
      expect(decisionProfit.pnlBps).toBe(200n);

      // Si el precio sube a $3030 (subida del 1%), el short pierde -100 bps
      const decisionLoss = exitManager.evaluate(pos, 3030_000_000n, 2000n);
      expect(decisionLoss.pnlBps).toBe(-100n);
    });
  });

  describe('Vector 1 & DB: Transacción Atómica SQLite contra TOCTOU', () => {
    let db: NexusDatabase;
    let guardian: RiskGuardian;

    beforeEach(() => {
      db = new NexusDatabase(':memory:');
      db.initRiskGuardianState(100_000_000_000n); // $100k
      guardian = new RiskGuardian(db);
    });

    it('allocateAndInsertPositionAtomic impide exceder las 3 posiciones máximas o la exposición del 30%', () => {
      // Insertar 3 posiciones de $10k
      for (let i = 1; i <= 3; i++) {
        const allocated = db.allocateAndInsertPositionAtomic({
          position_id: `POS_${i}`,
          engine_origin: 'CATALYST_NEWS',
          signal_ref_id: `SIG_${i}`,
          execution_mode: 'SHADOW',
          instrument_ticker: `TOKEN_${i}`,
          side: 1,
          phase_allocation_bps: 1000n,
          notional_invested_micro: 10_000_000_000n,
          quantity_atomic: '1000',
          entry_price_micro: 10_000_000n,
          stop_loss_micro: 9_550_000n,
          trailing_stop_micro: null,
          take_profit_micro: null,
          peak_price_micro: 10_000_000n,
          status: 'OPEN',
          opened_at_ms: BigInt(Date.now())
        }, 3n, 3000n);

        expect(allocated.success).toBe(true);
      }

      // Intentar una 4ta posición atómica simultánea: DEBE ser rechazada
      const fourthAttempt = db.allocateAndInsertPositionAtomic({
        position_id: 'POS_4',
        engine_origin: 'CATALYST_NEWS',
        signal_ref_id: 'SIG_4',
        execution_mode: 'SHADOW',
        instrument_ticker: 'TOKEN_4',
        side: 1,
        phase_allocation_bps: 1000n,
        notional_invested_micro: 10_000_000_000n,
        quantity_atomic: '1000',
        entry_price_micro: 10_000_000n,
        stop_loss_micro: 9_550_000n,
        trailing_stop_micro: null,
        take_profit_micro: null,
        peak_price_micro: 10_000_000n,
        status: 'OPEN',
        opened_at_ms: BigInt(Date.now())
      }, 3n, 3000n);

      expect(fourthAttempt.success).toBe(false);
      expect(fourthAttempt.rejectReason).toContain('EXCEEDED_MAX_POSITIONS');

      // Verificar que el estado en DB se mantuvo exactamente en 3 posiciones y 30k exposición
      const state = db.getRiskGuardianState();
      expect(state.open_positions_count).toBe(3n);
      expect(state.open_exposure_micro).toBe(30_000_000_000n);
    });

    it('reconcileExecutionDelta libera la exposición no ejecutada de órdenes IOC parciales', () => {
      // 1. Asignar $30k
      const alloc = db.allocateAndInsertPositionAtomic({
        position_id: 'POS_IOC_PARTIAL',
        engine_origin: 'CATALYST_NEWS',
        signal_ref_id: 'SIG_IOC',
        execution_mode: 'SHADOW',
        instrument_ticker: 'SOL',
        side: 1,
        phase_allocation_bps: 3000n,
        notional_invested_micro: 30_000_000_000n,
        quantity_atomic: '300',
        entry_price_micro: 100_000_000n,
        stop_loss_micro: 95_000_000n,
        trailing_stop_micro: null,
        take_profit_micro: null,
        peak_price_micro: 100_000_000n,
        status: 'OPEN',
        opened_at_ms: BigInt(Date.now())
      }, 3n, 3000n);

      expect(alloc.success).toBe(true);
      expect(db.getRiskGuardianState().open_exposure_micro).toBe(30_000_000_000n);

      // Si el IOC solo llenó $10k, se liberan $20k sobrantes
      guardian.reconcileExecutionDelta(30_000_000_000n, 10_000_000_000n, false);
      expect(db.getRiskGuardianState().open_exposure_micro).toBe(10_000_000_000n);
    });
  });

  describe('Vector 5: Higiene de Memoria (RingBuffer LRU y SimHash Expired)', () => {
    it('GlobalL2RingBufferManager elimina instrumentos inactivos cuando excede la capacidad LRU', () => {
      const registry = new GlobalL2RingBufferManager();
      // Insertar 55 instrumentos (el tope es 50)
      for (let i = 1; i <= 55; i++) {
        registry.recordTick(`INST_${i}`, {
          timestampMs: BigInt(i * 1000),
          midPriceMicro: 100_000_000n,
          bestBidMicro: 99_950_000n,
          bestAskMicro: 100_050_000n,
          bids: [],
          asks: [],
          takerBuyVolMicro: 1_000_000_000n,
          takerSellVolMicro: 1_000_000_000n
        });
      }

      // El número de buffers activos en RAM debe estar acotado a 50
      expect(registry.getActiveCount()).toBeLessThanOrEqual(50);
    });

    it('CatalystCorroborationBuffer expira huellas fuera de la ventana de 1 hora', () => {
      const buffer = new CatalystCorroborationBuffer(3_600_000n); // 1 hora
      const t0 = 1_000_000_000n;

      buffer.ingestAndDeduplicate('SEC approves spot Solana ETF with direct staking', ['SOL'], 'SEC_EDGAR', 10000n, t0);
      expect(buffer.getActiveCount(t0)).toBe(1);

      // A los 30 minutos (1800s), sigue vivo
      expect(buffer.getActiveCount(t0 + 1_800_000n)).toBe(1);

      // A los 65 minutos (3900s), está expirado y se purga
      expect(buffer.getActiveCount(t0 + 3_900_000n)).toBe(0);
    });
  });

  describe('Supervisor de Posiciones Activas y Rearme de Salidas Asimétricas', () => {
    it('SentinelAsymmetricExitManager activa De-Risk al alcanzar +35% y activa Moonbag Trailing Stop', () => {
      const exitManager = new SentinelAsymmetricExitManager();
      const pos: SentinelPosition = {
        positionId: 'POS_WHALE_01',
        tokenAddress: 'TOKEN_XYZ',
        tokenTicker: 'XYZ',
        entryPriceMicroUsd: 1_000_000n, // $1.00
        peakPriceMicroUsd: 1_000_000n,
        totalTokensAtomic: 100_000n,
        remainingTokensAtomic: 100_000n,
        openedAtMs: 1000n,
        isDeRisked: false,
        isClosed: false
      };

      // Subida a $1.36 (+3600 bps > +3500 bps)
      const decisionDeRisk = exitManager.evaluatePriceTick(pos, 1_360_000n, 2000n);
      expect(decisionDeRisk.action).toBe('DERISK_75PCT');
      expect(decisionDeRisk.tokensToSellAtomic).toBe(75_000n); // 75% vendido
      expect(pos.isDeRisked).toBe(true);
      expect(pos.remainingTokensAtomic).toBe(25_000n); // Moonbag restante

      // Moonbag sube a nuevo pico de $2.00
      exitManager.evaluatePriceTick(pos, 2_000_000n, 3000n);
      expect(pos.peakPriceMicroUsd).toBe(2_000_000n);

      // Moonbag retrocede -16% desde el pico de $2.00 (cae a $1.68)
      // Debe disparar MOONBAG_TRAILING_STOP (-15%)
      const decisionTrailing = exitManager.evaluatePriceTick(pos, 1_680_000n, 4000n);
      expect(decisionTrailing.action).toBe('MOONBAG_TRAILING_STOP');
      expect(decisionTrailing.tokensToSellAtomic).toBe(25_000n);
    });

    it('ActivePositionSupervisor rehidrata posiciones desde SQLite y evalúa ticks de mercado', async () => {
      const db = new NexusDatabase(':memory:');
      db.initRiskGuardianState(100_000_000_000n);
      const guardian = new RiskGuardian(db);
      const supervisor = new ActivePositionSupervisor(db, guardian);

      let triggeredAction = '';
      supervisor.setOnExitTriggered((posId, action) => {
        triggeredAction = action;
      });

      const rearmed = supervisor.rehydrateAndResumeAll([{
        position_id: 'POS_SUPERVISED_01',
        engine_origin: 'SENTINEL_ONCHAIN',
        signal_ref_id: 'SIG_SUP_01',
        execution_mode: 'SHADOW',
        instrument_ticker: 'SOL',
        side: 1,
        phase_allocation_bps: 1000n,
        notional_invested_micro: 10_000_000_000n,
        quantity_atomic: '100000',
        entry_price_micro: 100_000_000n, // $100
        stop_loss_micro: 92_000_000n,     // -8% Hard Stop
        trailing_stop_micro: null,
        take_profit_micro: null,
        peak_price_micro: 100_000_000n,
        status: 'OPEN',
        realized_pnl_micro: 0n,
        unrealized_pnl_micro: 0n,
        opened_at_ms: BigInt(Date.now()),
        closed_at_ms: null
      }]);

      expect(rearmed).toBe(1);

      // Simular tick que cae a $90 (-10%, por debajo del Hard Stop de -8% a $92)
      await supervisor.evaluatePriceTick('SOL', 90_000_000n);
      expect(triggeredAction).toBe('HARD_STOP');
    });
  });
});
