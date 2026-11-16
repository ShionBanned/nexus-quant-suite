async function getWhales() {
  const programs = [
    '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium
    'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', // Orca
    'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'  // Jupiter
  ];

  const found = new Map();

  for (const prog of programs) {
    if (found.size >= 10) break;
    const r = await fetch('https://api.mainnet-beta.solana.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getSignaturesForAddress',
        params: [prog, { limit: 15 }]
      })
    }).then(res => res.json());

    const sigs = r.result ? r.result.map(s => s.signature) : [];

    for (const sig of sigs) {
      if (found.size >= 10) break;
      try {
        const tx = await fetch('https://api.mainnet-beta.solana.com', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getTransaction',
            params: [sig, { maxSupportedTransactionVersion: 0 }]
          })
        }).then(res => res.json());

        const msg = tx.result?.transaction?.message;
        if (!msg) continue;

        let signer = null;
        if (Array.isArray(msg.accountKeys)) {
          signer = typeof msg.accountKeys[0] === 'string' ? msg.accountKeys[0] : msg.accountKeys[0]?.pubkey;
        } else if (msg.staticAccountKeys && Array.isArray(msg.staticAccountKeys)) {
          signer = msg.staticAccountKeys[0];
        }

        if (!signer || typeof signer !== 'string' || found.has(signer)) continue;

        // Verificar que es cuenta del System Program (wallet personal/trader)
        const acc = await fetch('https://api.mainnet-beta.solana.com', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getAccountInfo',
            params: [signer, { encoding: 'jsonParsed' }]
          })
        }).then(res => res.json());

        const val = acc.result?.value;
        if (val && val.owner === '11111111111111111111111111111111') {
          const sol = (val.lamports || 0) / 1e9;
          found.set(signer, sol);
          console.log(`[WHALE #${found.size}] ${signer} | Balance: ${sol.toFixed(2)} SOL | Solscan: https://solscan.io/account/${signer}`);
        }
      } catch (e) {}
    }
  }

  console.log('\n--- 10 BALLENAS REALES ENCONTRADAS ---');
  console.log(JSON.stringify(Array.from(found.entries()).map(([address, sol], i) => ({
    address,
    sol,
    tier: 'LIVE',
    root: `ROOT_WHALE_ALPHA_${String(i + 1).padStart(2, '0')}`
  })), null, 2));
}

getWhales();
