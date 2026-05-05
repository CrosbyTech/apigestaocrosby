import http from 'http';

http.get('http://localhost:4001/api/crm/erp-data?meses=12', (res) => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    const raw = JSON.parse(d);
    // Check structure
    console.log('Top keys:', Object.keys(raw));
    const j = raw.data || raw;
    console.log('Data keys:', Object.keys(j));
    
    if (!j.clientes) { console.log('NO clientes key!'); process.exit(1); }
    
    // Find client 74738 in clientes array
    const c74 = j.clientes.find(c => c.code === 74738);
    console.log('C74738:', c74 ? 'FOUND vendedorCode=' + c74.vendedorCode : 'NOT FOUND');
    
    // Show a sample client structure
    const sample = j.clientes[0];
    console.log('\nSample client keys:', Object.keys(sample));
    console.log('Sample has transacoes?', !!sample.transacoes);
    console.log('Sample has txs?', !!sample.txs);
    
    // Gather ALL transactions from all clients
    let allTxs = [];
    const sc = {};
    for (const c of j.clientes) {
      const txArr = c.transacoes || c.txs || [];
      for (const t of txArr) {
        allTxs.push({ ...t, personCode: c.code });
        sc[t.sellerCode] = (sc[t.sellerCode] || 0) + 1;
      }
    }
    console.log('\nTotal txs across all clients:', allTxs.length);
    
    // sellerCode distribution for target sellers
    [21, 26, 259, 65, 177, 69].forEach(s => console.log('seller ' + s + ':', sc[s] || 0));
    
    // Find clients that have vendedorCode 21,26,259
    const v21 = j.clientes.filter(c => c.vendedorCode === 21);
    const v26 = j.clientes.filter(c => c.vendedorCode === 26);
    const v259 = j.clientes.filter(c => c.vendedorCode === 259);
    console.log('\nClients with vendedorCode 21 (Rafael):', v21.length);
    console.log('Clients with vendedorCode 26 (David):', v26.length);
    console.log('Clients with vendedorCode 259 (Arthur):', v259.length);
  });
});
