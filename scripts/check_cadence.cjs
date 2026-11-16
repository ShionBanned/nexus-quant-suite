const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.resolve(__dirname, '../nexus_quant.db'));

const trades = db.prepare('SELECT position_id, instrument_ticker, notional_invested_micro, status, realized_pnl_micro, opened_at_ms, closed_at_ms FROM unified_positions_ledger ORDER BY opened_at_ms ASC').all();
console.log('Total trades in ledger:', trades.length);
if (trades.length > 0) {
  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    const durationSec = t.closed_at_ms ? ((t.closed_at_ms - t.opened_at_ms) / 1000).toFixed(1) : 'STILL_OPEN';
    const gapFromPrev = i > 0 ? ((t.opened_at_ms - trades[i-1].opened_at_ms) / 1000).toFixed(1) : 'FIRST';
    const pnlUsd = (Number(t.realized_pnl_micro) / 1_000_000).toFixed(2);
    console.log(`Trade #${i+1}: ${t.position_id} | Status: ${t.status} | PnL: $${pnlUsd} | Duration: ${durationSec}s | Gap: ${gapFromPrev}s`);
  }
}

const metrics = db.prepare('SELECT * FROM risk_guardian_state WHERE id = 1').get();
console.log('--- RISK GUARDIAN STATE ---');
console.log('Base Capital:', (Number(metrics.base_capital_micro) / 1e6).toFixed(2), 'USD');
console.log('Equity:', (Number(metrics.current_equity_micro) / 1e6).toFixed(2), 'USD');
console.log('Rolling 24h PnL:', (Number(metrics.rolling_24h_pnl_micro) / 1e6).toFixed(2), 'USD');
console.log('Open Exposure:', (Number(metrics.open_exposure_micro) / 1e6).toFixed(2), 'USD');
console.log('Open Positions:', metrics.open_positions_count);

db.close();
