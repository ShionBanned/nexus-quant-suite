const http = require('http');

function get(path, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:8080' + path, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    }).on('error', reject);
  });
}

async function main() {
  const root = await get('/');
  const match = root.data.match(/window\.__NEXUS_ADMIN_TOKEN__\s*=\s*"([^"]+)"/);
  const token = match ? match[1] : '';

  const trades = await get('/api/trades', { 'X-Nexus-Auth': token });
  const tJson = JSON.parse(trades.data);
  console.log('Top 3 newest trades with real timestamps:');
  tJson.trades.slice(0, 3).forEach(t => {
    const d = new Date(t.closedAtMs);
    console.log(
      d.toLocaleTimeString(),
      t.instrumentTicker,
      'Size: $' + (Number(t.notionalInvestedMicro) / 1e6).toFixed(2),
      'Entry: $' + (Number(t.entryPriceMicro) / 1e6).toFixed(4),
      'Exit: $' + (Number(t.peakPriceMicro) / 1e6).toFixed(4),
      'PnL: $' + (Number(t.realizedPnlMicro) / 1e6).toFixed(2),
      t.status
    );
  });
}
main().catch(console.error);
