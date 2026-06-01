// Total da filial 99 (maio) via sellers-canal SEM filtro de operações (todas).
// Compara com o export do usuário: R$ 852.794,49.
const BASE = 'http://localhost:4100';
const f = (n) => Number(n || 0).toFixed(2);
const r = await fetch(`${BASE}/api/totvs/sale-panel/sellers-canal`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ branchs: [99], datemin: '2026-05-01', datemax: '2026-05-28' }),
});
const j = await r.json();
const d = j.data || j;
const sellers = d.sellers || [];
let total = 0;
console.log('Filial 99 — maio (01-28) — TODAS operações (sellers-canal):');
for (const s of sellers) {
  total += Number(s.value || 0);
  console.log('  ' + String(s.seller_code).padStart(5), (s.seller_name || '').slice(0, 22).padEnd(22), 'R$ ' + f(s.value).padStart(13));
}
console.log('  ' + '-'.repeat(50));
console.log('  TOTAL nosso (todas ops): R$ ' + f(total));
console.log('  TOTAL export usuário:    R$ 852794.49');
console.log('  diferença: R$ ' + f(852794.49 - total));
