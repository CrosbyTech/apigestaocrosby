// Acha qual consulta TOTVS reproduz o relatório do usuário (empresa 99, semana 22).
// Referência (Vl. Faturado, líquido): Cleyton 9688.63, Michel 5936.08, Yago 4936.81,
// Renato 16802.00, Walter 14430.25, David 4264.06, Arthur 1282.72
const BASE = 'http://localhost:4100';
const f = (n) => Number(n || 0).toFixed(2);
const REF = { 161: 9688.63, 165: 5936.08, 241: 4936.81, 65: 16802.00, 177: 14430.25, 26: 4264.06, 259: 1282.72 };
const NOMES = { 161: 'Cleyton', 165: 'Michel', 241: 'Yago', 65: 'Renato', 177: 'Walter', 26: 'David', 259: 'Arthur' };

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}

// 1) seller-panel/totals (Analytics) — branch 99, semana, SEM operations
const r1 = await post('/api/totvs/seller-panel/totals', { branchs: [99], datemin: '2026-05-25', datemax: '2026-05-28' });
const d1 = r1.data || r1;
console.log('=== seller-panel/totals (Analytics) branch 99, 25-28, sem ops ===');
const rows = Array.isArray(d1) ? d1 : (d1.dataRow || d1.items || d1.sellers || []);
console.log('estrutura keys:', Object.keys(Array.isArray(d1) ? (d1[0] || {}) : d1).join(','));
if (rows[0]) console.log('amostra row:', JSON.stringify(rows[0]).slice(0, 300));
const byCode = {};
for (const s of rows) {
  const code = Number(s.seller_code ?? s.sellerCode ?? s.code ?? s.salesman_code ?? 0);
  const val = Number(s.invoice_value ?? s.seller_sale_value ?? s.value ?? s.netValue ?? s.total ?? 0);
  if (code) byCode[code] = (byCode[code] || 0) + val;
}
console.log('\ncode | nome    | TOTVS totals | REF       | bate?');
for (const code of Object.keys(REF)) {
  const ours = byCode[code];
  const ref = REF[code];
  const ok = ours != null ? (Math.abs(ours - ref) < 1 ? 'OK' : `dif ${f(ours - ref)}`) : 'AUSENTE';
  console.log(String(code).padStart(4), '|', (NOMES[code] || '').padEnd(8), '|', (ours != null ? f(ours) : '—').padStart(12), '|', f(ref).padStart(9), '|', ok);
}
