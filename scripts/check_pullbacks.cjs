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

  const pullbacks = await get('/api/sentinel/pullbacks', { 'X-Nexus-Auth': token });
  console.log('Pullbacks status:', pullbacks.status);
  console.log('Pullbacks data:', pullbacks.data);
}
main().catch(console.error);
