const Database = require('better-sqlite3');
const db = new Database('nexus_quant.db');

console.log('=== METRICAS CATALYST EN LIBRO MAYOR (LEDGER) ===');
const summary = db.prepare(`
  SELECT 
    COUNT(*) as total_trades,
    SUM(CASE WHEN side = 1 THEN 1 ELSE 0 END) as longs_count,
    SUM(CASE WHEN side = -1 THEN 1 ELSE 0 END) as shorts_count,
    SUM(CASE WHEN status = 'CLOSED' THEN 1 ELSE 0 END) as wins_count,
    SUM(CASE WHEN status = 'STOPPED_OUT' THEN 1 ELSE 0 END) as losses_count,
    SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END) as currently_open,
    ROUND(SUM(realized_pnl_micro) / 1000000.0, 2) as total_realized_pnl_usd
  FROM unified_positions_ledger
  WHERE engine_origin = 'CATALYST_NEWS'
`).get();
console.log(summary);

console.log('\n=== ULTIMAS 10 POSICIONES EJECUTADAS POR CATALYST ===');
const trades = db.prepare(`
  SELECT 
    position_id,
    instrument_ticker,
    CASE WHEN side = 1 THEN 'LONG (Compra)' ELSE 'SHORT (Corto)' END as lado,
    ROUND(notional_invested_micro / 1000000.0, 2) as notional_usd,
    ROUND(entry_price_micro / 1000000.0, 4) as entry_price_usd,
    ROUND(peak_price_micro / 1000000.0, 4) as exit_price_usd,
    status,
    ROUND(realized_pnl_micro / 1000000.0, 2) as pnl_usd,
    datetime(opened_at_ms/1000, 'unixepoch', 'localtime') as abierto,
    datetime(closed_at_ms/1000, 'unixepoch', 'localtime') as cerrado
  FROM unified_positions_ledger
  WHERE engine_origin = 'CATALYST_NEWS'
  ORDER BY opened_at_ms DESC
  LIMIT 10
`).all();
console.table(trades);

console.log('\n=== ULTIMOS 5 EVENTOS DE NOTICIAS REALES PROCESADOS POR CATALYST ===');
const news = db.prepare(`
  SELECT 
    event_id,
    primary_ticker,
    CASE WHEN direction = 1 THEN 'BULL' ELSE 'BEAR' END as direccion,
    conviction_ct_bps,
    action_taken,
    category,
    datetime(ingested_at_ms/1000, 'unixepoch', 'localtime') as ingerido
  FROM catalyst_news_events
  ORDER BY ingested_at_ms DESC
  LIMIT 5
`).all();
console.table(news);
