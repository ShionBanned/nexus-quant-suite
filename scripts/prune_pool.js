const Database = require('better-sqlite3');
const path = require('node:path');

const dbPath = path.join(__dirname, '..', 'nexus_quant.db');
const db = new Database(dbPath);

console.log('--- ANTES DE LA PODA ---');
console.log(db.prepare('SELECT pool_tier, COUNT(*) as count FROM sentinel_wallets_pool GROUP BY pool_tier').all());

db.exec(`
  DELETE FROM sentinel_wallets_pool
  WHERE wallet_address NOT IN (
    SELECT wallet_address FROM sentinel_wallets_pool
    WHERE pool_tier = 'LIVE'
    ORDER BY profit_factor_scaled DESC, last_rotated_ms DESC
    LIMIT 10
  )
  AND pool_tier = 'LIVE';

  DELETE FROM sentinel_wallets_pool
  WHERE wallet_address NOT IN (
    SELECT wallet_address FROM sentinel_wallets_pool
    WHERE pool_tier = 'SHADOW'
    ORDER BY profit_factor_scaled DESC, last_rotated_ms DESC
    LIMIT 40
  )
  AND pool_tier = 'SHADOW';
`);

console.log('--- DESPUES DE LA PODA ---');
console.log(db.prepare('SELECT pool_tier, COUNT(*) as count FROM sentinel_wallets_pool GROUP BY pool_tier').all());

db.close();
