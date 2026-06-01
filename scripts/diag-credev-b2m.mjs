// Diagnóstico: credev dos vendedores B2M com ops MULTIMARCAS apenas vs TODAS (SPECIAL_OPS).
const BASE = 'http://localhost:4100';
const f = (n) => Number(n || 0).toFixed(2);
const B2M = { 259: 'Arthur', 65: 'Renato', 177: 'Walter', 26: 'David', 21: 'Rafael' };
const MULTI_OPS = [7235, 7241, 9127, 200];
const SPECIAL = [
  1, 2, 55, 510, 511, 1511, 521, 1521, 522, 960, 9001, 9009, 9027, 9017,
  9400, 9401, 9402, 9403, 9404, 9005, 545, 546, 555, 548, 1210, 9405, 1205,
  1101, 9065, 9064, 9063, 9062, 9061, 9420, 9026, 9067, 7234, 7236, 7240,
  7241, 7242, 7235, 7237, 7254, 7259, 7255, 7243, 7245, 7244,
];
async function credev(ops, label) {
  const r = await fetch(`${BASE}/api/crm/credev-por-vendedor`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ branchs: [99], operations: ops, datemin: '2026-05-01', datemax: '2026-05-28' }),
  });
  const j = await r.json();
  return (j.data || j).credev || {};
}
const cMulti = await credev(MULTI_OPS, 'multi');
const cAll = await credev(SPECIAL, 'all');
console.log('Credev B2M: só ops MULTIMARCAS vs TODAS as ops (SPECIAL):');
console.log('cod  | nome    | credev MULTI-ops | credev TODAS-ops | diferença');
for (const code of Object.keys(B2M)) {
  const m = Number(cMulti[code] || 0);
  const a = Number(cAll[code] || 0);
  console.log(String(code).padStart(4), '|', B2M[code].padEnd(7), '|', f(m).padStart(16), '|', f(a).padStart(16), '|', f(a - m).padStart(10));
}
