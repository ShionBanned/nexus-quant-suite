# NEXUS QUANT SUITE

> **Motor de Trading Cuantitativo Institucional y Supervisor Autónomo de Riesgo 24/7**  
> *Aritmética Entera Estricta (BigInt 64/128-bit en Micro-USD y BPS) | Ejecución Atómica por Mutex | Simulación de Libro de Órdenes L2 en Tiempo Real | Persistencia Forense en SQLite WAL*

[English Version](README.md)

---

## ⚡ Descripción General

**Nexus Quant Suite** es un sistema autónomo de ejecución cuantitativa de alta frecuencia y gestión de riesgo de portafolio diseñado para operar 24/7 bajo estrictos invariantes matemáticos y de ejecución. Desarrollado en TypeScript con tipado estricto en tiempo de compilación y cero aritmética de punto flotante, la plataforma coordina estrategias multi-motor, ingesta de noticias en sub-segundos, rastreo on-chain de ballenas y captura de rendimiento por tasas de financiación delta-neutrales.

---

## 🏛️ Pilares Arquitectónicos

### 1. Aritmética Entera Estricta (Invariante Nivel N2)
- **Prohibición absoluta** de punto flotante IEEE 754 de JavaScript (`Number`, `float`, `double`) para balances, precios y cálculos de riesgo.
- Todos los valores monetarios, márgenes y nocionales se gestionan como enteros exactos de 64/128 bits (`BigInt`) en **Micro-Dólares** ($1\text{ USD} = 1,000,000\ \mu\text{USD} = 10^6$) o unidades atómicas nativas (lamports / wei).
- Todas las proporciones, umbrales, variaciones relativas y comisiones se expresan en **Puntos Base (BPS)** ($1\% = 100\text{ bps}$, $100\% = 10,000\text{ bps}$).

### 2. Clúster de Motores Cuantitativos Multi-Estrategia
- **Motor A (Sentinel On-Chain Alpha & Smart Pullback)**: Ingesta directa de RPC Solana / Raydium, firewall pre-trade anti-sybil (<150ms), detector de confluencia (>=3 ballenas en ventana de 120s), francotirador de retrocesos Fibonacci 38.2% / VWAP y salidas asimétricas (Hard Stop -8%, De-Risk +35%, Moonbag Trailing).
- **Motor B (Catalyst Sub-Second News Arbitrage)**: Ingesta WebSocket de baja latencia (<50ms), deduplicación SimHash de 64 bits, clasificación de impacto local mediante inferencia ML ONNX zero-shot, puerta de consenso multi-oráculo y enrutador Immediate-or-Cancel (IOC) anclado al libro de órdenes L2.
- **Motor C (Aether Delta-Neutral Carry)**: Cosecha de tasas de financiamiento (Spot Long + Perp Short) con clasificador de regímenes de mercado en tiempo real (Tendencial, Rango, Alta Volatilidad).
- **Motor D (Vortex Liquidation Reversion)**: Absorción de cascadas de liquidaciones y reversión a la media.
- **Motor E (Kronos Avellaneda-Stoikov Market Maker)**: Control de inventario de microestructura y captura de spread de alta frecuencia.

### 3. RiskGuardian: Invariantes Atómicos y Circuit Breakers
- **Exposición Máxima Total**: Topada rígidamente en 3,000 bps (30.00% del capital base).
- **Límite de Concurrencia**: Máximo de 3 posiciones abiertas simultáneas.
- **Circuit Breaker Diario**: Si el drawdown móvil en 24h cae $\le -400\text{ bps}$ (-4.00%), se congela el sistema de inmediato, cancelando órdenes activas y bloqueando nuevas entradas.
- **Auto-Sweep a Cold Wallet**: Si la equidad supera $+2,500\text{ bps}$ (+25.00%) sobre el High-Water Mark (HWM), la ganancia excedentaria se transfiere automáticamente a la bóveda fría.
- **Cero Órdenes Desnudas**: Paréntesis nativos atómicos con temporizador de desconexión por inactividad (`cancelAllAfter(5000ms)`).

### 4. Persistencia Forense y Reconciliación de Estado
- Base de datos SQLite configurada en modo **WAL (Write-Ahead Logging)** con garantías ACID completas.
- Reconciliación estricta de estado en arranque: previene órdenes fantasma, fills no respaldados y desincronizaciones de exposición ante caídas o reinicios.
- Dashboard web interactivo desarrollado en **React 19** con sincronización en tiempo real vía WebSocket.

---

## 📁 Estructura del Repositorio

```text
nexus-quant-suite/
├── config/                     # Parámetros y umbrales de configuración
│   ├── binance.example.json    # Plantilla de credenciales de API / Futuros
│   ├── feeds.catalyst.json     # Ingestores de noticias, SimHash y pesos NLP
│   ├── risk.guardian.json      # Límites duros de riesgo, circuit breakers y cold wallet
│   └── rpc.sentinel.json       # Endpoints RPC de Solana / L2 y filtros de liquidez
├── src/
│   ├── core/                   # Primitivas matemáticas BigInt, RiskGuardian, RingBuffers y SQLite WAL
│   ├── engine_a_sentinel/      # Rastreo on-chain de ballenas, pullback y sniper DEX
│   ├── engine_b_catalyst/      # Ingestor de noticias, SimHash 64-bit, ONNX ML y router IOC
│   ├── engine_c_aether/        # Motor Delta-Neutral Carry y clasificador de régimen de mercado
│   ├── engine_d_vortex/        # Reversión de liquidaciones en cascada
│   ├── engine_e_kronos/        # Creador de mercado Avellaneda-Stoikov
│   ├── ui_dashboard/           # Dashboard React 19 y servidor HTTP/WebSocket autenticado
│   └── index.ts                # Orquestador maestro del sistema y demonio de ejecución
├── scripts/                    # Scripts de supervisión 24/7 en Windows, backups y Monte Carlo
├── tests/                      # 16 suites / 150 pruebas unitarias, de integración y forenses
└── package.json
```

---

## 🚀 Inicio Rápido

### 1. Requisitos Previos
- **Node.js**: v20+ o v22+
- **npm** o **bun**

### 2. Instalación
```bash
git clone https://github.com/ShionBanned/nexus-quant-suite.git
cd nexus-quant-suite
npm install
```

### 3. Configuración
Copia la plantilla de configuración e ingresa tus credenciales de API:
```bash
cp config/binance.example.json config/binance.json
```

### 4. Compilación y Pruebas
Verifica el tipado TypeScript estricto y ejecuta la suite de 150 pruebas forenses:
```bash
npm run typecheck
npm test
```

### 5. Puesta en Marcha
Compila la interfaz de usuario y ejecuta el orquestador maestro:
```bash
# Iniciar en primer plano
npm start

# O iniciar como servicio en segundo plano 24/7 en Windows:
.\START_24-7.bat
```
El panel de control operativo estará accesible en `http://localhost:8080`.

---

## 🧪 Pruebas y Validación Forense

La suite incluye 16 módulos de prueba con 150 casos que validan exhaustivamente la paridad entre simulación y operativa real, la resiliencia dimensional en micro-USD y la reconciliación tras caídas:

```bash
npm test
```
```text
Test Files  16 passed (16)
     Tests  150 passed (150)
```

---

## 📜 Licencia

Privado y Propietario. Todos los derechos reservados.
