// Testa /seller-panel/sellers-detalhado (que usa /sale-panel/v2/totals/search por
// vendedor) na filial 99, semana 22, comparando invoice_value com o relatório.
const BASE = 'http://localhost:4100';
const f = (n) => Number(n || 0).toFixed(2);
const REF = { 161: 9688.63, 165: 5936.08, 241: 4936.81, 65: 16802.00, 177: 14430.25, 26: 4264.06, 259: 1282.72 };
const NOMES = { 161: 'Cleyton', 165: 'Michel', 241: 'Yago', 65: 'Renato', 177: 'Walter', 26: 'David', 259: 'Arthur' };
// ops combinadas revenda + multimarcas
const OPS = [7236, 9122, 5102, 7242, 9061, 9001, 9121, 512, 7235, 7241, 9127, 200];

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}

for (const [label, ops] of [['SEM ops (todas)', undefined], ['ops canais', OPS]]) {
  const body = { branchs: [99], datemin: '2026-05-25', datemax: '2026-05-28' };
  if (ops) body.operations = ops;
  const r = await post('/api/totvs/seller-panel/sellers-detalhado', body);
  const d = r.data || r;
  const rows = d.dataRow || [];
  const byCode = {};
  for (const s of rows) byCode[Number(s.seller_code)] = Number(s.invoice_value || 0);
  console.log(`\n=== sellers-detalhado branch 99, 25-28 | ${label} (${rows.length} vendedores) ===`);
  console.log('code | nome    | invoice_value | REF       | bate?');
  for (const code of Object.keys(REF)) {
    const ours = byCode[code];
    const ref = REF[code];
    const ok = ours != null ? (Math.abs(ours - ref) < 1 ? 'OK ✅' : `dif ${f(ours - ref)}`) : 'AUSENTE';
    console.log(String(code).padStart(4), '|', (NOMES[code] || '').padEnd(8), '|', (ours != null ? f(ours) : '—').padStart(13), '|', f(ref).padStart(9), '|', ok);
  }
}
