import Database from 'better-sqlite3';

const db = new Database('./nexus_quant.db', { readonly: true });
const positions = db.prepare('SELECT * FROM unified_positions_ledger').all() as any[];

console.log('Total positions:', positions.length);
const closed = positions.filter(p => p.status !== 'OPEN');
const open = positions.filter(p => p.status === 'OPEN');
console.log('Closed positions:', closed.length);
console.log('Open positions:', open.length);

let totalPnl = 0;
let wins = 0;
let losses = 0;
let totalWinPnl = 0;
let totalLossPnl = 0;
let byEngine: Record<string, { count: number, pnl: number, wins: number, losses: number }> = {};

for (const p of closed) {
  const pnl = p.realized_pnl_micro / 1_000_000;
  totalPnl += pnl;
  const eng = p.engine_origin || 'UNKNOWN';
  if (!byEngine[eng]) byEngine[eng] = { count: 0, pnl: 0, wins: 0, losses: 0 };
  byEngine[eng].count++;
  byEngine[eng].pnl += pnl;

  if (pnl > 0) {
    wins++;
    totalWinPnl += pnl;
    byEngine[eng].wins++;
  } else {
    losses++;
    totalLossPnl += pnl;
    byEngine[eng].losses++;
  }
}

console.log(`Total Realized PnL: $${totalPnl.toFixed(2)}`);
console.log(`Wins: ${wins}, Losses: ${losses}, Win rate: ${((wins / closed.length) * 100).toFixed(1)}%`);
console.log(`Avg Win: $${wins ? (totalWinPnl / wins).toFixed(2) : 0}, Avg Loss: $${losses ? (totalLossPnl / losses).toFixed(2) : 0}`);
console.log('By Engine:', byEngine);

// Check timestamps
if (positions.length > 0) {
  const first = positions[0].opened_at_ms;
  const last = positions[positions.length - 1].opened_at_ms;
  console.log(`First opened: ${new Date(first).toISOString()}`);
  console.log(`Last opened: ${new Date(last).toISOString()}`);
  console.log(`Timespan minutes: ${((last - first) / 60000).toFixed(1)}`);
}
