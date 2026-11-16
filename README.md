# NEXUS QUANT SUITE

> **Institutional-Grade Quantitative Trading Engine & 24/7 Autonomous Risk Supervisor**  
> *Zero-Floating-Point Math (Strict 64/128-bit BigInt Micro-USD & BPS) | Atomic Mutex Execution | Real-time L2 Order Book Simulation | Forensic SQLite WAL Persistence*

[Versión en Español](README.es.md)

---

## ⚡ Overview

**Nexus Quant Suite** is an autonomous high-frequency quantitative execution and portfolio risk system designed to operate 24/7 under strict mathematical and execution invariants. Built in TypeScript with strict compile-time typing and zero floating-point arithmetic, the platform coordinates multi-engine trading strategies, sub-second news ingestion, on-chain whale tracking, and delta-neutral funding yield harvest.

### Core Architectural Pillars

1. **Strict Integer Arithemtic (Level N2 Invariant)**
   - Absolute prohibition of IEEE 754 floating-point decimals (`Number`, `float`, `double`).
   - All balance, equity, notional, and price values are strictly evaluated as 64/128-bit `BigInt` in **Micro-USD** ($1\text{ USD} = 1,000,000\ \mu\text{USD} = 10^6$).
   - All proportions, slippages, fees, and thresholds are expressed in integer **Basis Points (BPS)** ($1\% = 100\text{ bps}$, $100\% = 10,000\text{ bps}$).

2. **Multi-Strategy Engine Cluster**:
   - **Engine A: Sentinel On-Chain Alpha & Smart Pullback**: Real-time Raydium / Solana RPC listener, anti-sybil firewall, 64-bit whale tracking, Fibonacci 38.2% / VWAP pullback sniper, and asymmetric exits.
   - **Engine B: Catalyst High-Frequency Arbitrage**: Sub-50ms news WebSocket ingestion, 64-bit SimHash deduplication, local ONNX zero-shot sentiment classification, multi-oracle consensus gate, and Immediate-or-Cancel (IOC) execution.
   - **Engine C: Aether Delta-Neutral Carry**: Spot Long + Perp Short funding rate harvester with real-time market regime classification (Trending, Mean-Reverting, Volatile).
   - **Engine D: Vortex Liquidation Reversion**: Order flow imbalance and cascade absorption.
   - **Engine E: Kronos Avellaneda-Stoikov Market Maker**: Microstructure inventory control and high-frequency spread capture.

3. **RiskGuardian Atomic Mutex & Invariant Enforcement**:
   - Maximum portfolio exposure capped at 3,000 bps (30.00% of base capital).
   - Hard limit of 3 concurrent open positions.
   - Daily rolling Circuit Breaker at -400 bps (-4.00% daily drawdown) with automated emergency stop and order flushing.
   - High-Water Mark (HWM) profit sweeps to cold storage at +2,500 bps (+25.00%).
   - Atomic server-side bracket orders with dead-man's switch (`cancelAllAfter(5000ms)`).

4. **Forensic Persistence & Zero-Downtime Rehydration**:
   - SQLite Write-Ahead Logging (WAL) mode with ACID guarantees.
   - State reconciliation on bootstrap preventing phantom orders or unbacked fills.
   - Full live web dashboard powered by React 19 + WebSocket real-time telemetry.

---

## 📁 Repository Structure

```text
nexus-quant-suite/
├── config/                     # Configuration parameters & strategy thresholds
│   ├── binance.example.json    # Binance API & Futures credentials template
│   ├── feeds.catalyst.json     # News ingestion, SimHash and NLP weights
│   ├── risk.guardian.json      # Hard risk limits, circuit breakers & cold wallet
│   └── rpc.sentinel.json       # Solana / L2 RPC endpoints & pool filters
├── src/
│   ├── core/                   # Mathematical primitives, RiskGuardian, L2 RingBuffers & SQLite WAL
│   ├── engine_a_sentinel/      # On-chain whale tracking, smart pullback & Raydium DEX sniper
│   ├── engine_b_catalyst/      # News ingestor, SimHash 64-bit, ONNX ML & IOC execution
│   ├── engine_c_aether/        # Delta-neutral carry engine & market regime classifier
│   ├── engine_d_vortex/        # Liquidation cascade reversion engine
│   ├── engine_e_kronos/        # Avellaneda-Stoikov market maker
│   ├── ui_dashboard/           # React 19 dashboard & authenticated WebSocket/HTTP server
│   └── index.ts                # Master orchestrator & daemon entrypoint
├── scripts/                    # 24/7 background supervisors, backups & stress test runners
├── tests/                      # 16 suites / 150 vitest unit, integration & forensic tests
└── package.json
```

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js**: v20+ or v22+
- **npm** or **bun**

### 2. Installation
```bash
git clone https://github.com/ShionBanned/nexus-quant-suite.git
cd nexus-quant-suite
npm install
```

### 3. Configuration
Copy the template configuration and specify your API credentials:
```bash
cp config/binance.example.json config/binance.json
```

### 4. Build & Verify
Run strict TypeScript typechecking and the 150-test forensic suite:
```bash
npm run typecheck
npm test
```

### 5. Running the System
Build the dashboard assets and start the master orchestrator:
```bash
# Build UI and launch engine in foreground
npm start

# Or launch as a 24/7 background service on Windows:
.\START_24-7.bat
```
The real-time operational dashboard will be accessible at `http://localhost:8080`.

---

## 🧪 Testing & Verification

The suite includes 16 test modules covering zero-point math, reconciliation protocols, and shadow-to-live execution parity:

```bash
npm test
```
```text
Test Files  16 passed (16)
     Tests  150 passed (150)
```

---

## 📜 License

Private & Proprietary. All rights reserved.
