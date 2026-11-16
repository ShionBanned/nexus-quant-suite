// scripts/monte_carlo_stress_test.cjs
// MATRIZ COMPLETA DE ESTRÉS MONTE CARLO (10,000 TRAYECTORIAS x 4 REGÍMENES)

const INITIAL_CAPITAL = 100_000;       // $100,000 USD
const DELTA_NEUTRAL_RESERVE = 70_000;  // $70,000 USD en Aether Carry
const DIRECTIONAL_SLOT = 5_000;        // $5,000 USD por operación
const NUM_SIMULATIONS = 10_000;
const TRADES_PER_PATH = 1_000;         // 1,000 operaciones (~3-4 meses de actividad)

const SCENARIOS = [
  {
    id: 'REGIME_1_BASELINE',
    name: '1. RÉGIMEN NOMINAL (Condiciones Normales Calibradas)',
    winRate: 0.65,
    winReturnPct: 0.0150,              // +1.50%
    lossReturnPct: -0.0080,            // -0.80%
    fixedFeePerTradeUsd: 5.00,
    carryApr: 0.1950,                  // 19.50% APR
    tradesPerDay: 20,
    dailyCircuitBreakerLossUsd: 2000
  },
  {
    id: 'REGIME_2_MODERATE_STRESS',
    name: '2. ESTRÉS MODERADO (Mercado Lento, Menor Convicción)',
    winRate: 0.52,                     // 52% acierto
    winReturnPct: 0.0145,              // +1.45%
    lossReturnPct: -0.0085,            // -0.85% (leve slippage)
    fixedFeePerTradeUsd: 6.50,
    carryApr: 0.1200,                  // 12.00% APR
    tradesPerDay: 20,
    dailyCircuitBreakerLossUsd: 2000
  },
  {
    id: 'REGIME_3_SEVERE_ADVERSITY',
    name: '3. ESTRÉS SEVERO ADVERSARIO (Rango Sucio y Falsas Rupturas)',
    winRate: 0.44,                     // 44% acierto (como tu racha reciente)
    winReturnPct: 0.0140,              // +1.40%
    lossReturnPct: -0.0090,            // -0.90%
    fixedFeePerTradeUsd: 8.00,
    carryApr: 0.0950,                  // 9.50% APR (piso estable)
    tradesPerDay: 20,
    dailyCircuitBreakerLossUsd: 2000
  },
  {
    id: 'REGIME_4_EXTREME_STRESS',
    name: '4. CISNE NEGRO / COLAPSO DE MERCADO (Fricción Extrema)',
    winRate: 0.38,                     // 38% acierto
    winReturnPct: 0.0135,              // +1.35%
    lossReturnPct: -0.0110,            // -1.10% (slippage severo en mechas)
    fixedFeePerTradeUsd: 10.00,
    carryApr: 0.0400,                  // 4.00% APR (funding casi muerto)
    tradesPerDay: 20,
    dailyCircuitBreakerLossUsd: 1800
  }
];

function runSimulation(config) {
  const startTime = Date.now();
  const finalEquities = new Float64Array(NUM_SIMULATIONS);
  const maxDrawdownsPct = new Float64Array(NUM_SIMULATIONS);
  const maxLosingStreaks = new Int32Array(NUM_SIMULATIONS);

  let ruinedCount = 0;              // Quiebra definida como perder el 20% del capital (< $80,000 USD)
  let circuitBreakerTrips = 0;
  let profitablePathsCount = 0;

  const carryDailyYieldUsd = (DELTA_NEUTRAL_RESERVE * config.carryApr) / 365;
  const carryYieldPerTrade = carryDailyYieldUsd / config.tradesPerDay;

  for (let sim = 0; sim < NUM_SIMULATIONS; sim++) {
    let equity = INITIAL_CAPITAL;
    let peakEquity = INITIAL_CAPITAL;
    let maxDdUsd = 0;
    let currentLosingStreak = 0;
    let maxLossStreak = 0;

    let dayLossCounter = 0;
    let isDayHalted = false;

    for (let t = 0; t < TRADES_PER_PATH; t++) {
      if (t % config.tradesPerDay === 0) {
        dayLossCounter = 0;
        isDayHalted = false;
      }

      if (isDayHalted) {
        equity += carryYieldPerTrade;
        if (equity > peakEquity) peakEquity = equity;
        continue;
      }

      const isWin = Math.random() < config.winRate;
      let tradePnl = 0;

      if (isWin) {
        tradePnl = (DIRECTIONAL_SLOT * config.winReturnPct) - config.fixedFeePerTradeUsd;
        currentLosingStreak = 0;
      } else {
        tradePnl = (DIRECTIONAL_SLOT * config.lossReturnPct) - config.fixedFeePerTradeUsd;
        currentLosingStreak++;
        if (currentLosingStreak > maxLossStreak) {
          maxLossStreak = currentLosingStreak;
        }

        dayLossCounter += Math.abs(tradePnl);
        if (dayLossCounter >= config.dailyCircuitBreakerLossUsd) {
          isDayHalted = true;
          circuitBreakerTrips++;
        }
      }

      const netStepPnl = tradePnl + carryYieldPerTrade;
      equity += netStepPnl;

      if (equity > peakEquity) {
        peakEquity = equity;
      } else {
        const dd = peakEquity - equity;
        if (dd > maxDdUsd) {
          maxDdUsd = dd;
        }
      }

      if (equity < 80_000) {
        ruinedCount++;
        break;
      }
    }

    finalEquities[sim] = equity;
    maxDrawdownsPct[sim] = (maxDdUsd / peakEquity) * 100;
    maxLosingStreaks[sim] = maxLossStreak;

    if (equity >= INITIAL_CAPITAL) {
      profitablePathsCount++;
    }
  }

  finalEquities.sort();
  maxDrawdownsPct.sort();
  maxLosingStreaks.sort();

  return {
    name: config.name,
    winRatePct: config.winRate * 100,
    carryAprPct: config.carryApr * 100,
    p05: finalEquities[Math.floor(NUM_SIMULATIONS * 0.05)],
    p50_median: finalEquities[Math.floor(NUM_SIMULATIONS * 0.50)],
    p95: finalEquities[Math.floor(NUM_SIMULATIONS * 0.95)],
    medianDrawdownPct: maxDrawdownsPct[Math.floor(NUM_SIMULATIONS * 0.50)],
    worstDrawdownPct_P99: maxDrawdownsPct[Math.floor(NUM_SIMULATIONS * 0.99)],
    medianLosingStreak: maxLosingStreaks[Math.floor(NUM_SIMULATIONS * 0.50)],
    worstObservedStreak_P99: maxLosingStreaks[Math.floor(NUM_SIMULATIONS * 0.99)],
    probabilityOfRuinPct: (ruinedCount / NUM_SIMULATIONS) * 100,
    profitablePathsPct: (profitablePathsCount / NUM_SIMULATIONS) * 100,
    circuitBreakerTripsTotal: circuitBreakerTrips,
    durationMs: Date.now() - startTime
  };
}

const results = SCENARIOS.map(runSimulation);
console.log(JSON.stringify(results, null, 2));
