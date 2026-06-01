// Compara o painel oficial da filial 99 (maio) com o export do usuário.
// Export total informado: R$ 852.794,49 (transações 01–28/05, todos os vendedores).
const BASE = 'http://localhost:4100';
const f = (n) => Number(n || 0).toFixed(2);
const r = await fetch(`${BASE}/api/totvs/sale-panel/sellers`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ filtroempresa: [99], datemin: '2026-05-01', datemax: '2026-05-28' }),
});
const j = await r.json();
const d = j.data || j;
const branch = (d.branches || [])[0];
if (!branch) { console.log('sem dados', JSON.stringify(d).slice(0, 200)); process.exit(0); }
const rows = branch.dataRow || [];
const sorted = rows.slice().sort((a, b) => Number(b.seller_sale_value || 0) - Number(a.seller_sale_value || 0));
let total = 0;
console.log('Filial 99 — maio (01-28) — painel oficial:');
for (const s of sorted) {
  total += Number(s.seller_sale_value || 0);
  console.log('  ' + String(s.seller_code).padStart(5), (s.seller_name || '').slice(0, 22).padEnd(22), 'R$ ' + f(s.seller_sale_value).padStart(13));
}
console.log('  ' + '-'.repeat(50));
console.log('  TOTAL painel: R$ ' + f(total));
console.log('  TOTAL export: R$ 852794.49');
console.log('  branch.invoiceValue: R$ ' + f(branch.invoiceValue));
