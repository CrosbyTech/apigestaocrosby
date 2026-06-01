const BASE = 'http://localhost:4100';
const r = await fetch(`${BASE}/api/totvs/sale-panel/sellers`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ filtroempresa: [99], datemin: '2026-05-25', datemax: '2026-05-28' }),
});
const j = await r.json();
const d = j.data || j;
const b = (d.branches || [])[0];
if (!b) { console.log('sem branches', JSON.stringify(d).slice(0, 300)); process.exit(0); }
console.log('branch_code:', b.branch_code, 'invoiceValue:', b.invoiceValue);
console.log('qtd vendedores no dataRow:', (b.dataRow || []).length);
console.log('\nCampos de UM item dataRow (todos):');
const item = (b.dataRow || [])[0];
console.log(JSON.stringify(item, null, 2));
console.log('\nTodos os vendedores (code | name | seller_sale_value | outros campos numéricos):');
for (const s of b.dataRow || []) {
  const nums = Object.entries(s).filter(([k, v]) => typeof v === 'number').map(([k, v]) => `${k}=${v}`).join(' ');
  console.log('  ', s.seller_code, (s.seller_name || '').slice(0, 18).padEnd(18), nums);
}
