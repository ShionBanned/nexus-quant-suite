/**
 * NEXUS QUANT SUITE v2.0 - CORE MATH BIGINT
 * 
 * Regla Inmutable: Prohibición total de float/double para precios, saldos o slippage.
 * Toda la matemática financiera se procesa mediante enteros exactos BigInt de 64/128 bits.
 * - Micro-USD: 1 USD = 1,000,000 µUSD (10^6)
 * - Puntos Base: 1% = 100 bps, 100% = 10,000 bps (10^4)
 */

export const MICRO_USD_SCALE = 1_000_000n;
export const BPS_SCALE = 10_000n;

/**
 * Convierte dólares enteros a Micro-USD (10^6).
 */
export function usdToMicro(usd: bigint | number): bigint {
  return BigInt(usd) * MICRO_USD_SCALE;
}

/**
 * Formatea Micro-USD a string legible "123.456789" para visualización/UI únicamente.
 * NUNCA se utiliza para cálculos internos.
 */
export function microUsdToString(micro: bigint): string {
  const isNegative = micro < 0n;
  const absVal = isNegative ? -micro : micro;
  const whole = absVal / MICRO_USD_SCALE;
  const fraction = absVal % MICRO_USD_SCALE;
  const fractionStr = fraction.toString().padStart(6, '0');
  return `${isNegative ? '-' : ''}${whole.toString()}.${fractionStr}`;
}

/**
 * Convierte un porcentaje entero (ej: 5 para 5%) a Puntos Base (500 bps).
 */
export function pctToBps(pct: bigint | number): bigint {
  return BigInt(pct) * 100n;
}

/**
 * Calcula la variación relativa en Puntos Base (bps):
 * delta = ((pCurrent - pBase) * 10,000) / pBase
 */
export function calcBpsDelta(pCurrent: bigint, pBase: bigint): bigint {
  if (pBase === 0n) {
    throw new Error('MATH_ERR_DIV_ZERO: Base price cannot be zero');
  }
  const num = (pCurrent - pBase) * BPS_SCALE;
  // Floor rounding hacia -infinito para variaciones negativas
  if (num < 0n && num % pBase !== 0n) {
    return (num / pBase) - 1n;
  }
  return num / pBase;
}

/**
 * Aplica un incremento en Puntos Base a un valor base:
 * resultado = valor * (10,000 + bps) / 10,000
 */
export function applyBpsIncrease(value: bigint, bps: bigint): bigint {
  return (value * (BPS_SCALE + bps)) / BPS_SCALE;
}

/**
 * Aplica un descuento en Puntos Base a un valor base:
 * resultado = valor * (10,000 - bps) / 10,000
 */
export function applyBpsDiscount(value: bigint, bps: bigint): bigint {
  return (value * (BPS_SCALE - bps)) / BPS_SCALE;
}

/**
 * Calcula la porción proporcional en Puntos Base de un monto en Micro-USD:
 * asignado = (montoMicro * bps) / 10,000
 */
export function calcAllocationMicro(totalMicro: bigint, allocationBps: bigint): bigint {
  if (allocationBps < 0n) {
    throw new Error('MATH_ERR_INVALID_BPS: Allocation bps cannot be negative');
  }
  return (totalMicro * allocationBps) / BPS_SCALE;
}

/**
 * Calcula el retroceso de Fibonacci sobre un impulso alcista:
 * Retorna el precio objetivo tras un retroceso de X bps (por defecto 38.2% = 3820 bps):
 * P_target = P_peak - ((P_peak - P_base) * 3820) / 10,000
 */
export function calcFibonacciPullback(
  basePrice: bigint,
  peakPrice: bigint,
  pullbackBps: bigint = 3820n
): bigint {
  if (peakPrice <= basePrice) {
    return basePrice;
  }
  const impulse = peakPrice - basePrice;
  const pullback = (impulse * pullbackBps) / BPS_SCALE;
  return peakPrice - pullback;
}

/**
 * Calcula el decaimiento exponencial e^(-lambda * dt) en aritmética entera fija (escala 10,000 bps).
 * lambdaScaled: lambda en 10,000 (ej: 0.15 s^-1 -> 1500 bps)
 * dtMs: delta tiempo en milisegundos
 * Retorna factor en Puntos Base [0, 10,000].
 * 
 * Implementación Numérica Estable:
 * Para evitar la divergencia del polinomio de Taylor para x > 2.18, se utiliza
 * el método de reducción de rango y duplicación binaria en punto fijo:
 * e^(-x) = (e^(-x / 2^k))^(2^k)
 * donde x/2^k es lo suficientemente pequeño (< 0.5) para que Taylor converja monótonamente.
 */
export function calcExpDecayBps(lambdaBps: bigint = 1500n, dtMs: bigint): bigint {
  if (dtMs <= 0n) return BPS_SCALE;

  // x_scaled = (lambdaBps * dtMs) / 1000n (en escala 10,000 bps)
  // ej: lambda=1500 (0.15), dt=20,000ms -> x_scaled = 30,000 (x = 3.0)
  const x_scaled = (lambdaBps * dtMs) / 1000n;

  if (x_scaled >= 80_000n) {
    // Para x >= 8.0, e^-x < 0.00033 (< 4 bps), decaimiento prácticamente total
    return 0n;
  }

  // Reducción de rango: dividimos x entre 16 (2^4) para que z = x/16 <= 0.5
  // Para z <= 0.5, la serie de Taylor de orden 4 es estrictamente decreciente y monótona
  const k = 4; // 2^4 = 16
  const z = x_scaled / 16n;

  // Taylor de orden 4 para e^(-z) con base BPS_SCALE (10,000) sin truncamiento prematuro:
  // e^-z = 1 - z + z^2/2 - z^3/6 + z^4/24
  const term1 = BPS_SCALE;
  const term2 = z;
  const z2 = (z * z) / BPS_SCALE;
  const z3 = (z2 * z) / BPS_SCALE;
  const z4 = (z3 * z) / BPS_SCALE;

  const term3 = z2 / 2n;
  const term4 = z3 / 6n;
  const term5 = z4 / 24n;

  let baseVal = term1 - term2 + term3 - term4 + term5;
  if (baseVal < 0n) baseVal = 0n;
  if (baseVal > BPS_SCALE) baseVal = BPS_SCALE;

  // Duplicación binaria k veces: y = y^2 / BPS_SCALE
  let result = baseVal;
  for (let step = 0; step < k; step++) {
    result = (result * result) / BPS_SCALE;
  }

  return result;
}

/**
 * Distancia del Trailing Stop Exponencial para Catalyst Engine (Page 5):
 * Ptrail(t) = Ppeak(t) * (1 - max(0.006, 0.022 * e^(-8 * PnL)))
 * 
 * En Puntos Base (bps):
 * - min_distance = 60 bps (0.60%)
 * - base_distance = 220 bps (2.20%)
 * - factor_exp = e^(-8 * PnL)
 * 
 * Si pnlBps <= 0: distancia = 220 bps.
 * A medida que PnL aumenta, la distancia se ajusta exponencialmente hasta el piso de 60 bps.
 */
export function calcExponentialTrailingStopDistanceBps(pnlBps: bigint): bigint {
  const FLOOR_DISTANCE_BPS = 60n; // 0.006 = 60 bps
  const CEILING_DISTANCE_BPS = 220n; // 0.022 = 220 bps

  if (pnlBps <= 0n) {
    return CEILING_DISTANCE_BPS;
  }

  // 8 * PnL: si PnL = 100 bps (1%), 8 * 1% = 0.08 = 800 bps
  const exponent_scaled = 8n * pnlBps;
  // Calculamos e^(-exponent) usando calcExpDecayBps
  // lambda = 10,000 bps (1.0), dtMs = (exponent_scaled * 1000) / 10000
  const dtSimulatedMs = (exponent_scaled * 1000n) / BPS_SCALE;
  const decayFactor = calcExpDecayBps(BPS_SCALE, dtSimulatedMs); // [0, 10000]

  const dynamicDistance = (CEILING_DISTANCE_BPS * decayFactor) / BPS_SCALE;
  return dynamicDistance > FLOOR_DISTANCE_BPS ? dynamicDistance : FLOOR_DISTANCE_BPS;
}

/**
 * Multiplicación y división entera de alta precisión para unidades atómicas (tokens / lamports / wei):
 * tokensReceived = (notionalMicro * ATOMIC_UNIT) / priceMicro
 */
export function calcTokenQuantityAtomic(
  notionalMicro: bigint,
  priceMicro: bigint,
  decimals: number = 9 // Default Solana (9) o Base/Arb (18)
): bigint {
  if (priceMicro <= 0n) {
    throw new Error('MATH_ERR_PRICE_INVALID: Price must be strictly positive');
  }
  const atomicScale = 10n ** BigInt(decimals);
  return (notionalMicro * atomicScale) / priceMicro;
}

/**
 * Calcula el valor nocional en micro-USD a partir de cantidad de tokens y precio unitario en micro-USD:
 * notionalMicro = (quantityAtomic * priceMicro) / ATOMIC_UNIT
 */
export function calcNotionalFromAtomic(
  quantityAtomic: bigint,
  priceMicro: bigint,
  decimals: number = 9
): bigint {
  const atomicScale = 10n ** BigInt(decimals);
  return (quantityAtomic * priceMicro) / atomicScale;
}
