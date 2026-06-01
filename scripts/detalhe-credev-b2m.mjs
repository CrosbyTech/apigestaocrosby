const BASE = 'http://localhost:4100';
const f = (n) => Number(n || 0).toFixed(2);
const B2M = { 259: 'Arthur', 65: 'Renato', 177: 'Walter', 26: 'David', 21: 'Rafael' };
const MULTI_OPS = [7235, 7241, 9127, 200];
// pedaços alinhados à semana (mesmo do getCredevVendedor)
const CHUNKS = [
  ['2026-05-01', '2026-05-03'], ['2026-05-04', '2026-05-10'],
  ['2026-05-11', '2026-05-17'], ['2026-05-18', '2026-05-24'],
  ['2026-05-25', '2026-05-28'],
];
const all = [];
for (const [a, b] of CHUNKS) {
  const r = await fetch(`${BASE}/api/crm/credev-por-vendedor`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ branchs: [99], operations: MULTI_OPS, datemin: a, datemax: b, detalhe: true }),
  });
  const j = await r.json();
  const d = j.data || j;
  for (const x of d.detalhe || []) if (B2M[x.dealer]) all.push(x);
}
console.log('Detalhe credev B2M (filial 99, ops multimarcas, por semana):\n');
for (const code of Object.keys(B2M)) {
  const rows = all.filter((x) => x.dealer === Number(code));
  const tot = rows.reduce((s, x) => s + Number(x.credev || 0), 0);
  console.log(`${B2M[code]} (${code}) — credev total R$${f(tot)} (${rows.length} NFs):`);
  for (const x of rows.sort((p, q) => q.credev - p.credev))
    console.log(`   NF ${String(x.invoice).padEnd(8)} op ${String(x.op).padEnd(5)} ${(x.data || '').padEnd(11)} R$${f(x.credev).padStart(10)}  ${(x.cliente || '').slice(0, 36)}`);
  console.log('');
}
