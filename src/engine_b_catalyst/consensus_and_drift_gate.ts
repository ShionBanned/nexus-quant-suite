/**
 * NEXUS QUANT SUITE v2.0 - CATALYST CONSENSUS & INSIDER DRIFT GATE
 * 
 * Implementa la Ecuación Maestra de Convicción C_t:
 * C_t = 100 × (0.45 · SIA + 0.35 · Tfuente + 0.20 · Φflujo) × Iseguridad × Ino-leak × e^(-λ · Δt)
 * 
 * En Puntos Base (0 a 10,000 bps):
 * - SIA: Convicción semántica de IA (0 si confianza < 8200 bps).
 * - Tfuente: Bayesiano multi-fuente (Tier 1 = 10000; Tier 2 = 8000; Tier 3 <= 4000).
 * - Φflujo: Confirmación de microestructura L2 (OBI y volumen taker).
 * - Iseguridad: 0 si contiene phishing, hex 0x... o URLs no autorizadas.
 * - Ino-leak: 0 si el drift previo de 15m > 220 bps (Majors) o > 450 bps (Alts).
 * - e^(-λ · Δt): Decaimiento exponencial por latencia de ingesta (λ = 0.15 s^-1).
 */

import { BPS_SCALE, calcExpDecayBps } from '../core/math_bigint.js';
import { CatalystCategory } from './onnx_zero_shot_classifier.js';

export type FiringAction = 'STRIKE_TIER_1' | 'PROBE_TIER_2' | 'PANIC_SHORT' | 'QUARANTINE' | 'DROPPED';

export interface ConvictionCalculationInput {
  semanticConvictionSiaBps: bigint; // SIA (0 a 10000)
  sourceTrustBps: bigint; // Tfuente (0 a 10000, Tier 3 <= 4000)
  sourceTier: 1 | 2 | 3;
  corroboratedSourceCount: number;
  flowConfirmationBps: bigint; // Φflujo (0 a 10000)
  isSecuritySafe: boolean; // Iseguridad
  preEventDrift15mBps: bigint;
  isMajorAsset: boolean; // true para BTC/ETH/SOL/Majors, false para Alts
  category: CatalystCategory;
  direction: number; // 1 = Bullish, -1 = Bearish, 0 = Neutral
  publishedAtMs: bigint;
  ingestedAtMs: bigint;
}

export interface ConvictionGateResult {
  convictionCtBps: bigint; // 0 a 10000
  action: FiringAction;
  allocationQuotaBps: bigint; // 10000 (100%), 3500 (35%), o 0
  portfolioAllocationBps: bigint; // 1000 (10%), 350 (3.5%), o 0
  iSecurity: number;
  iNoLeak: number;
  decayFactorBps: bigint;
  rejectReason?: string;
}

export class ConsensusAndDriftGate {
  private readonly lambdaDecayBps: bigint = 1500n; // 0.15 s^-1
  private readonly maxDriftMajorsBps: bigint = 220n; // +2.20% (220 bps)
  private readonly maxDriftAltsBps: bigint = 450n; // +4.50% (450 bps)
  private readonly tier3MaxTrustBps: bigint = 4000n; // Máximo 40% para Tier 3 (redes sociales)

  public evaluate(input: ConvictionCalculationInput): ConvictionGateResult {
    // 1. Compuerta Anti-Hack (I_seguridad)
    const iSecurity = input.isSecuritySafe ? 1 : 0;
    if (iSecurity === 0) {
      return {
        convictionCtBps: 0n,
        action: 'DROPPED',
        allocationQuotaBps: 0n,
        portfolioAllocationBps: 0n,
        iSecurity: 0,
        iNoLeak: 1,
        decayFactorBps: 0n,
        rejectReason: 'GATE_REJECT_SECURITY: Phishing terms, hex contract address or untrusted URL detected'
      };
    }

    // 2. Compuerta Anti-Insider (I_no-leak)
    // Compara el drift de 15m en la misma dirección de la noticia
    const maxAllowedDrift = input.isMajorAsset ? this.maxDriftMajorsBps : this.maxDriftAltsBps;
    let iNoLeak = 1;

    // Si la noticia es alcista y el precio ya subió > maxDrift, o si es bajista y ya cayó > maxDrift
    if (input.direction > 0 && input.preEventDrift15mBps > maxAllowedDrift) {
      iNoLeak = 0;
    } else if (input.direction < 0 && input.preEventDrift15mBps < -maxAllowedDrift) {
      iNoLeak = 0;
    }

    if (iNoLeak === 0) {
      return {
        convictionCtBps: 0n,
        action: 'DROPPED',
        allocationQuotaBps: 0n,
        portfolioAllocationBps: 0n,
        iSecurity: 1,
        iNoLeak: 0,
        decayFactorBps: 0n,
        rejectReason: `GATE_REJECT_INSIDER_DRIFT: 15m pre-event drift ${input.preEventDrift15mBps} bps exceeds ceiling ${maxAllowedDrift} bps`
      };
    }

    // 3. Tope duro a Redes Sociales (Tier 3 <= 4000 bps)
    let effectiveTrustBps = input.sourceTrustBps;
    if (input.sourceTier === 3 && effectiveTrustBps > this.tier3MaxTrustBps) {
      effectiveTrustBps = this.tier3MaxTrustBps;
    }

    // 4. Decaimiento por Edad e^(-lambda * dt)
    const ageMs = input.ingestedAtMs > input.publishedAtMs ? input.ingestedAtMs - input.publishedAtMs : 0n;
    const decayFactor = calcExpDecayBps(this.lambdaDecayBps, ageMs);

    // 5. Ecuación Maestra de Convicción C_t (Preservación de 128 bits sin doble truncamiento)
    // Ponderaciones: 45% SIA + 35% Tfuente + 20% Φflujo
    const rawWeighted =
      4500n * input.semanticConvictionSiaBps +
      3500n * effectiveTrustBps +
      2000n * input.flowConfirmationBps;

    // Aplicar decaimiento y compuertas en un único paso de división:
    const convictionCtBps = (rawWeighted * decayFactor) / (BPS_SCALE * BPS_SCALE);

    // 6. Matriz de Disparo (Página 4 de la especificación)
    // Caso Bajista Crítico: Ct >= 65 y Categoría Crítica
    const isCriticalBearishCategory =
      input.category === 'HACK' ||
      input.category === 'REGULATORY' ||
      input.category === 'MACRO';

    if (input.direction < 0 && convictionCtBps >= 6500n && isCriticalBearishCategory) {
      return {
        convictionCtBps,
        action: 'PANIC_SHORT',
        allocationQuotaBps: 5000n, // 50% Short de cobertura
        portfolioAllocationBps: 500n,
        iSecurity: 1,
        iNoLeak: 1,
        decayFactorBps: decayFactor,
        rejectReason: undefined
      };
    }

    // Caso 1: Ct >= 82 (8200 bps): Tier 1 directa o >= 2 fuentes independientes + Flujo > 0.65
    const hasTier1OrMultiSource = input.sourceTier === 1 || input.corroboratedSourceCount >= 2;
    if (convictionCtBps >= 8200n && hasTier1OrMultiSource && input.flowConfirmationBps > 6500n) {
      return {
        convictionCtBps,
        action: 'STRIKE_TIER_1',
        allocationQuotaBps: 10000n, // 100% cupo
        portfolioAllocationBps: 1000n, // 10% del portafolio
        iSecurity: 1,
        iNoLeak: 1,
        decayFactorBps: decayFactor
      };
    }

    // Caso 2: 68 <= Ct < 82 (6800 a 8200 bps): Tier 2 única + Flujo > 0.50
    if (convictionCtBps >= 6800n && input.flowConfirmationBps > 5000n) {
      return {
        convictionCtBps,
        action: 'PROBE_TIER_2',
        allocationQuotaBps: 3500n, // 35% cupo (sonda inicial)
        portfolioAllocationBps: 350n, // 3.5% del portafolio
        iSecurity: 1,
        iNoLeak: 1,
        decayFactorBps: decayFactor
      };
    }

    // Caso 3: 45 <= Ct < 68 (4500 a 6800 bps): Fuente social única (Tier 3) en cuarentena
    if (convictionCtBps >= 4500n) {
      return {
        convictionCtBps,
        action: 'QUARANTINE',
        allocationQuotaBps: 0n, // 0% capital real
        portfolioAllocationBps: 0n,
        iSecurity: 1,
        iNoLeak: 1,
        decayFactorBps: decayFactor,
        rejectReason: 'QUARANTINE_SHADOW: Awaiting independent 2nd source or L2 flow corroboration'
      };
    }

    // Caso 4: Ct < 45 (4500 bps) -> Descartado
    return {
      convictionCtBps,
      action: 'DROPPED',
      allocationQuotaBps: 0n,
      portfolioAllocationBps: 0n,
      iSecurity: 1,
      iNoLeak: 1,
      decayFactorBps: decayFactor,
      rejectReason: `CONVICTION_TOO_LOW: Ct ${convictionCtBps} bps < 4500 bps threshold`
    };
  }
}
