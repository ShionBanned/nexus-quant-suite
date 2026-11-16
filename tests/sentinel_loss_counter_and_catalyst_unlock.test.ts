import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NexusDatabase } from '../src/core/db_sqlite_wal.js';
import { SentinelPurgeRotator } from '../src/engine_a_sentinel/purge_rotator_6h.js';
import { RealNewsPoller, RealCatalystFeedEvent } from '../src/engine_b_catalyst/real_news_poller.js';
import { SentinelConfluenceTracker } from '../src/engine_a_sentinel/confluence_tracker.js';
import { startDashboardServer } from '../src/ui_dashboard/server.js';
import { RiskGuardian } from '../src/core/risk_guardian.js';

describe('SENTINEL WHALE LOSS COUNTER & CATALYST ENGINE UNLOCK', () => {
  let db: NexusDatabase;

  beforeEach(() => {
    db = new NexusDatabase(':memory:');
    db.initRiskGuardianState(100_000_000_000n);
  });

  afterEach(() => {
    try {
      db.getRawDb().close();
    } catch { /* ignore */ }
  });

  describe('1. Conexión de pérdidas por trade a cada ballena (Motor A)', () => {
    it('incrementa consecutive_losses tras STOPPED_OUT (1/3, 2/3) y resetea a 0/3 tras ganar', () => {
      const rotator = new SentinelPurgeRotator(db);
      const testWhale = '6bZ71x8kLpM449aQeNsVEPfiu6QeMU1kektZE';

      rotator.seedInitialPool([
        {
          wallet_address: testWhale,
          chain_id: 'SOLANA',
          pool_tier: 'LIVE',
          win_rate_bps: 6800n,
          profit_factor_scaled: 2150n,
          consecutive_losses: 0,
          trades_count_7d: 10,
          funding_root_hash: 'cluster_sol_live_01'
        }
      ]);

      // 1. Primer trade perdido (STOPPED_OUT) -> 1/3
      const loss1 = db.recordWhaleTradeOutcome(testWhale, false);
      expect(loss1.consecutiveLosses).toBe(1);

      let row = db.getRawDb().prepare('SELECT consecutive_losses, trades_count_7d FROM sentinel_wallets_pool WHERE wallet_address = ?').get(testWhale) as any;
      expect(Number(row.consecutive_losses)).toBe(1);
      expect(Number(row.trades_count_7d)).toBe(11);

      // 2. Segundo trade perdido (STOPPED_OUT) -> 2/3
      const loss2 = db.recordWhaleTradeOutcome(testWhale, false);
      expect(loss2.consecutiveLosses).toBe(2);

      row = db.getRawDb().prepare('SELECT consecutive_losses, trades_count_7d FROM sentinel_wallets_pool WHERE wallet_address = ?').get(testWhale) as any;
      expect(Number(row.consecutive_losses)).toBe(2);
      expect(Number(row.trades_count_7d)).toBe(12);

      // 3. Tercer trade ganado (CLOSED) -> Reseteo a 0/3
      const win = db.recordWhaleTradeOutcome(testWhale, true);
      expect(win.consecutiveLosses).toBe(0);

      row = db.getRawDb().prepare('SELECT consecutive_losses, trades_count_7d FROM sentinel_wallets_pool WHERE wallet_address = ?').get(testWhale) as any;
      expect(Number(row.consecutive_losses)).toBe(0);
      expect(Number(row.trades_count_7d)).toBe(13);
    });

    it('maneja direcciones inexistentes o vacías con gracia sin lanzar excepciones', () => {
      const resNull = db.recordWhaleTradeOutcome('', false);
      expect(resNull.consecutiveLosses).toBe(0);
      expect(resNull.updated).toBe(false);

      const resNotFound = db.recordWhaleTradeOutcome('NON_EXISTENT_WALLET', false);
      expect(resNotFound.updated).toBe(false);
      expect(resNotFound.consecutiveLosses).toBe(0);
    });
  });

  describe('2. Radar de Confluencia y Posiciones DEX en Tiempo Real (Motor A)', () => {
    it('seedDefaultClusters inicializa clusters con los 5 semáforos activos', () => {
      const tracker = new SentinelConfluenceTracker();
      tracker.seedDefaultClusters();
      const clusters = tracker.getActiveClusters();

      expect(clusters.length).toBeGreaterThanOrEqual(2);
      const orca = clusters.find(c => c.tokenTicker === 'ORCA');
      expect(orca).toBeDefined();
      expect(orca!.firewall.antiSybilPassed).toBe(true);
      expect(orca!.firewall.liquidityDepthPassed).toBe(true);
      expect(orca!.firewall.mintFreezeNull).toBe(true);
      expect(orca!.firewall.top10HoldersPassed).toBe(true);
      expect(orca!.firewall.antiHoneypotPassed).toBe(true);
      expect(orca!.firewall.latencyMs).toBeLessThan(150);
    });

    it('actualiza dinámicamente delta de precio en los clusters al recibir ticks de mercado', () => {
      const tracker = new SentinelConfluenceTracker();
      tracker.seedDefaultClusters();

      // ORCA entry inicial es 3.25 USD (3_250_000 microUSD). Subida a 3.50 USD
      const updated = tracker.updateClusterPrice('ORCA', 3_500_000n);
      expect(updated).toBe(true);

      const clusters = tracker.getActiveClusters();
      const orca = clusters.find(c => c.tokenTicker === 'ORCA');
      expect(orca).toBeDefined();
      // Delta: (3.50 - 3.25) / 3.25 = +7.69% (~769 bps)
      expect(orca!.priceDeltaBps).toBeGreaterThan(700);
      expect(orca!.priceDeltaBps).toBeLessThan(800);
    });

    it('getOpenPositions calcula PnL en tiempo real con getLivePrice y excluye posiciones cerradas', () => {
      const guardian = new RiskGuardian(db);
      const livePrices: Record<string, bigint> = {
        'SOL': 180_000_000n, // Subió de 150 a 180 (+20%)
      };

      const serverDeps = {
        getLivePrice: (ticker: string) => livePrices[ticker] ?? null,
        getConfluenceClusters: () => []
      };

      const { getOpenPositions, server } = startDashboardServer(db, guardian, 8911, serverDeps);

      try {
        // 1. Abrir posición en SOL
        db.allocateAndInsertPositionAtomic({
          position_id: 'POS_TEST_01',
          engine_origin: 'SENTINEL_ONCHAIN',
          signal_ref_id: '6bZ71x8kLpM449aQeNsVEPfiu6QeMU1kektZE',
          execution_mode: 'SHADOW',
          instrument_ticker: 'SOL',
          side: 1,
          phase_allocation_bps: 10000n,
          notional_invested_micro: 10_000_000_000n,
          quantity_atomic: '66666666666',
          entry_price_micro: 150_000_000n,
          stop_loss_micro: 138_000_000n,
          trailing_stop_micro: null,
          take_profit_micro: null,
          peak_price_micro: 150_000_000n,
          status: 'OPEN',
          opened_at_ms: BigInt(Date.now())
        });

        // Verificar que aparece en posiciones abiertas y tiene PnL +20% (2000 bps)
        let open = getOpenPositions();
        expect(open.length).toBe(1);
        expect(open[0].positionId).toBe('POS_TEST_01');
        expect(open[0].currentPriceUsd).toBe('180.000000');
        expect(open[0].pnlBps).toBe(2000);

        // 2. Cerrar la posición por Stop-Loss / Take-Profit
        db.getRawDb().prepare(`
          UPDATE unified_positions_ledger
          SET status = 'CLOSED', closed_at_ms = ?, realized_pnl_micro = 2000000000
          WHERE position_id = 'POS_TEST_01'
        `).run(Date.now());

        // Verificar que la posición cerrada se elimina inmediatamente de getOpenPositions
        open = getOpenPositions();
        expect(open.length).toBe(0);
      } finally {
        server.close();
      }
    });
  });

  describe('3. Motor B (Catalyst Engine): Multi-Fuente, Decaimiento y Corroboración', () => {
    it('calcula convicción alta y genera STRIKE_T1 para noticias regulatorias alcistas de CoinDesk', async () => {
      const poller = new RealNewsPoller();
      let capturedEvent: RealCatalystFeedEvent | null = null;

      poller.onNews((evt) => {
        capturedEvent = evt;
      });

      const rssXml = `
        <rss version="2.0">
          <channel>
            <item>
              <title><![CDATA[SEC Officially Approves First Spot Solana ETF with Staking Integration]]></title>
              <link>https://www.coindesk.com/policy/2026/sec-approves-sol-etf</link>
            </item>
          </channel>
        </rss>
      `;

      await (poller as any).parseAndDispatchXml(rssXml, 'COINDESK');

      expect(capturedEvent).not.toBeNull();
      expect(capturedEvent!.primaryTicker).toBe('SOL');
      expect(capturedEvent!.direction).toBe(1);
      expect(capturedEvent!.convictionCtBps).toBeGreaterThanOrEqual(8000);
      expect(capturedEvent!.actionTaken).toBe('STRIKE_T1');
    });

    it('calcula convicción bajista y genera PANIC_SHORT para noticias de Hack o Exploit', async () => {
      const poller = new RealNewsPoller();
      let capturedEvent: RealCatalystFeedEvent | null = null;

      poller.onNews((evt) => {
        capturedEvent = evt;
      });

      const rssXml = `
        <rss version="2.0">
          <channel>
            <item>
              <title><![CDATA[Critical Hack Exploits Cross-Chain Bridge Draining $120M in Tokens]]></title>
              <link>https://cointelegraph.com/news/critical-hack-bridge-exploit</link>
            </item>
          </channel>
        </rss>
      `;

      await (poller as any).parseAndDispatchXml(rssXml, 'COINTELEGRAPH');

      expect(capturedEvent).not.toBeNull();
      expect(capturedEvent!.direction).toBe(-1);
      expect(capturedEvent!.convictionCtBps).toBeGreaterThanOrEqual(6500);
      expect(capturedEvent!.actionTaken).toBe('PANIC_SHORT');
    });

    it('bloquea y manda a QUARANTINE titulares sospechosos con URLs no autorizadas o phishing', async () => {
      const poller = new RealNewsPoller();
      let capturedEvent: RealCatalystFeedEvent | null = null;

      poller.onNews((evt) => {
        capturedEvent = evt;
      });

      const phishXml = `
        <rss version="2.0">
          <channel>
            <item>
              <title><![CDATA[Claim your free Solana Airdrop immediately at http://claim-sol-now.xyz before deadline]]></title>
              <link>http://claim-sol-now.xyz</link>
            </item>
          </channel>
        </rss>
      `;

      await (poller as any).parseAndDispatchXml(phishXml, 'COINDESK');

      expect(capturedEvent).not.toBeNull();
      expect(capturedEvent!.iSecurity).toBe(0);
      expect(capturedEvent!.convictionCtBps).toBe(0);
      expect(capturedEvent!.actionTaken).toBe('QUARANTINE');
    });

    it('soporta feeds de Decrypt y The Block con parsing correcto de XML', async () => {
      const poller = new RealNewsPoller();
      const events: RealCatalystFeedEvent[] = [];

      poller.onNews((evt) => {
        events.push(evt);
      });

      const decryptXml = `
        <rss version="2.0">
          <channel>
            <item>
              <title>Solana Ecosystem Rally Surges as Major DEX Inflows Double</title>
              <link>https://decrypt.co/solana-rally-inflows</link>
              <pubDate>${new Date().toUTCString()}</pubDate>
            </item>
          </channel>
        </rss>
      `;

      const theBlockXml = `
        <rss version="2.0">
          <channel>
            <item>
              <title>Federal Reserve Integrates Bitcoin and Solana in Modern Reserve Framework</title>
              <link>https://www.theblock.co/post/fed-reserve-btc-sol</link>
              <pubDate>${new Date().toUTCString()}</pubDate>
            </item>
          </channel>
        </rss>
      `;

      await (poller as any).parseAndDispatchXml(decryptXml, 'DECRYPT');
      await (poller as any).parseAndDispatchXml(theBlockXml, 'THEBLOCK');

      expect(events.length).toBe(2);
      expect(events[0].sources).toContain('DECRYPT');
      expect(events[1].sources).toContain('THEBLOCK');
    });

    it('parsea <pubDate> y descarta automáticamente noticias con antigüedad > 5 minutos para evitar compras tardías', async () => {
      const poller = new RealNewsPoller();
      let capturedEvent: RealCatalystFeedEvent | null = null;

      poller.onNews((evt) => {
        capturedEvent = evt;
      });

      // Noticia de hace 2 horas (antigüedad > 5 minutos = 300,000 ms)
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toUTCString();

      const staleXml = `
        <rss version="2.0">
          <channel>
            <item>
              <title>SEC Approves Spot Solana ETF with Complete Staking Mechanism</title>
              <link>https://www.theblock.co/post/old-news-stale</link>
              <pubDate>${twoHoursAgo}</pubDate>
            </item>
          </channel>
        </rss>
      `;

      await (poller as any).parseAndDispatchXml(staleXml, 'THEBLOCK');

      expect(capturedEvent).not.toBeNull();
      // Debe haber sido descartada automáticamente por antigüedad
      expect(capturedEvent!.decayFactorBps).toBe(0);
      expect(capturedEvent!.convictionCtBps).toBe(0);
      expect(capturedEvent!.actionTaken).toBe('DROPPED');
    });

    it('corrobora noticias multi-fuente con SimHash y fusiona fuentes mediante CatalystCorroborationBuffer', async () => {
      const poller = new RealNewsPoller();
      const events: RealCatalystFeedEvent[] = [];

      poller.onNews((evt) => {
        events.push(evt);
      });

      const now = new Date().toUTCString();

      // 1. Fuente 1: CoinDesk
      const xml1 = `
        <rss version="2.0">
          <channel>
            <item>
              <title>SEC Officially Approves First Spot Solana ETF for trading</title>
              <link>https://www.coindesk.com/policy/sec-solana-etf</link>
              <pubDate>${now}</pubDate>
            </item>
          </channel>
        </rss>
      `;

      // 2. Fuente 2: The Block confirma la misma noticia con titular casi idéntico
      const xml2 = `
        <rss version="2.0">
          <channel>
            <item>
              <title>SEC Officially Approves First Spot Solana ETF for trading now</title>
              <link>https://www.theblock.co/post/sec-solana-etf-approved</link>
              <pubDate>${now}</pubDate>
            </item>
          </channel>
        </rss>
      `;

      await (poller as any).parseAndDispatchXml(xml1, 'COINDESK');
      await (poller as any).parseAndDispatchXml(xml2, 'THEBLOCK');

      expect(events.length).toBe(2);
      // El segundo evento debe reflejar la fusión de ambas fuentes
      const secondEvent = events[1];
      expect(secondEvent.sources).toContain('COINDESK');
      expect(secondEvent.sources).toContain('THEBLOCK');
      // La confianza combinada Bayesiana debe ser superior a la individual
      expect(secondEvent.sourceTrustBps).toBeGreaterThan(9500);
    });

    it('no mantiene cadenceInterval activo (eliminación del reciclaje de titulares viejos)', () => {
      const poller = new RealNewsPoller();
      poller.start(60_000);

      // cadenceInterval no debe existir en la instancia
      expect((poller as any).cadenceInterval).toBeUndefined();
      expect((poller as any).storedHeadlines).toBeUndefined();

      poller.stop();
    });

    it('parsea XML con nuevas líneas en etiquetas y CDATA multilínea sin perder pubDate ni titular', async () => {
      const poller = new RealNewsPoller();
      let capturedEvent: RealCatalystFeedEvent | null = null;
      poller.onNews((evt) => { capturedEvent = evt; });

      const multilineXml = `
        <rss version="2.0">
          <channel>
            <item>
              <title>
                <![CDATA[
                  SEC &amp; CFTC Officially Approve Solana ETF Staking Framework
                ]]>
              </title>
              <link>
                https://decrypt.co/post/solana-framework-approved
              </link>
              <pubDate>
                ${new Date().toISOString()}
              </pubDate>
            </item>
          </channel>
        </rss>
      `;

      await (poller as any).parseAndDispatchXml(multilineXml, 'DECRYPT');
      expect(capturedEvent).not.toBeNull();
      expect(capturedEvent!.headline).toBe('SEC & CFTC Officially Approve Solana ETF Staking Framework');
      expect(capturedEvent!.primaryTicker).toBe('SOL');
      expect(capturedEvent!.actionTaken).toBe('STRIKE_T1');
    });

    it('bloquea URLs de phishing que intentan imitar dominios legítimos con subdominios (ej. decrypt.co.attacker.xyz)', async () => {
      const poller = new RealNewsPoller();
      let capturedEvent: RealCatalystFeedEvent | null = null;
      poller.onNews((evt) => { capturedEvent = evt; });

      const spoofXml = `
        <rss version="2.0">
          <channel>
            <item>
              <title>Solana Foundation Announces Immediate Treasury Claim</title>
              <link>https://decrypt.co.attacker-drain.xyz/sol-claim</link>
              <pubDate>${new Date().toUTCString()}</pubDate>
            </item>
          </channel>
        </rss>
      `;

      await (poller as any).parseAndDispatchXml(spoofXml, 'DECRYPT');
      expect(capturedEvent).not.toBeNull();
      expect(capturedEvent!.iSecurity).toBe(0);
      expect(capturedEvent!.actionTaken).toBe('QUARANTINE');
    });

    it('no infla la confianza Bayesiana cuando la misma fuente repite o actualiza su propio titular', () => {
      const poller = new RealNewsPoller();
      const buffer = (poller as any).corroborationBuffer;
      const t0 = BigInt(Date.now());

      const res1 = buffer.ingestAndDeduplicate(
        'Solana Breaks All Time Highs After Inflows Double',
        ['SOL'],
        'COINDESK',
        9500n,
        t0
      );
      expect(res1.event.combinedTrustBps).toBe(9500n);
      expect(res1.event.corroboratedCount).toBe(1);

      // Misma fuente envía titular casi idéntico
      const res2 = buffer.ingestAndDeduplicate(
        'Solana Breaks All Time Highs After Inflows Double Today',
        ['SOL'],
        'COINDESK',
        9500n,
        t0 + 1000n
      );
      // No debe inflar la confianza con la misma fuente
      expect(res2.event.combinedTrustBps).toBe(9500n);
      expect(res2.event.corroboratedCount).toBe(1);

      // Fuente distinta corrobora
      const res3 = buffer.ingestAndDeduplicate(
        'Solana Breaks All Time Highs After Inflows Double Today Now',
        ['SOL'],
        'THEBLOCK',
        9400n,
        t0 + 2000n
      );
      expect(res3.event.combinedTrustBps).toBeGreaterThan(9500n);
      expect(res3.event.corroboratedCount).toBe(2);
    });

    it('descarta automáticamente titulares con fecha futura anómala (> 1 min adelante)', async () => {
      const poller = new RealNewsPoller();
      let capturedEvent: RealCatalystFeedEvent | null = null;
      poller.onNews((evt) => { capturedEvent = evt; });

      const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000).toUTCString();
      const futureXml = `
        <rss version="2.0">
          <channel>
            <item>
              <title>Solana Next Gen Rollup Live On Mainnet</title>
              <link>https://www.theblock.co/post/solana-future</link>
              <pubDate>${futureDate}</pubDate>
            </item>
          </channel>
        </rss>
      `;

      await (poller as any).parseAndDispatchXml(futureXml, 'THEBLOCK');
      expect(capturedEvent).not.toBeNull();
      expect(capturedEvent!.actionTaken).toBe('DROPPED');
    });
  });
});
