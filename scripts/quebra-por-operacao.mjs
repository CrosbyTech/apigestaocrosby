// Quebra por OPERAÇÃO × vendedor (filial 99, semana 22) via Supabase fiscal (LEVE).
// Objetivo: descobrir quais operações o relatório oficial soma.
// Referência (líquido): Cleyton 9688.63, Michel 5936.08, Yago 4936.81,
//   Renato 16802.00, Walter 14430.25, David 4264.06, Arthur 1282.72
import 'dotenv/config';
import supabaseFiscal from '../config/supabaseFiscal.js';

const ALVO = { 161: 'Cleyton', 165: 'Michel', 241: 'Yago', 65: 'Renato', 177: 'Walter', 26: 'David', 259: 'Arthur' };
const REF = { 161: 9688.63, 165: 5936.08, 241: 4936.81, 65: 16802.00, 177: 14430.25, 26: 4264.06, 259: 1282.72 };
const f = (n) => Number(n || 0).toFixed(2);

const { data, error } = await supabaseFiscal
  .from('notas_fiscais')
  .select('operation_code, operation_type, dealer_code, total_value, items')
  .eq('branch_code', 99)
  .gte('issue_date', '2026-05-25')
  .lte('issue_date', '2026-05-28')
  .not('invoice_status', 'eq', 'Canceled')
  .not('invoice_status', 'eq', 'Deleted')
  .limit(20000);
if (error) { console.log('ERRO:', error.message); process.exit(1); }
console.log('NFs filial 99 (25-28):', (data || []).length);

// dealer principal = dealer_code; fallback = maior netValue nos itens
function mainDealer(nf) {
  if (nf.dealer_code) return Number(nf.dealer_code);
  const by = {};
  for (const it of Array.isArray(nf.items) ? nf.items : [])
    for (const p of Array.isArray(it.products) ? it.products : []) {
      const dc = parseInt(p.dealerCode); if (dc) by[dc] = (by[dc] || 0) + (parseFloat(p.netValue) || 0);
    }
  let md = null, mx = -1; for (const [dc, v] of Object.entries(by)) if (v > mx) { mx = v; md = Number(dc); }
  return md;
}

// matriz: seller -> { op -> {Output: val, Input: val} }
const M = {};
for (const nf of data || []) {
  const d = mainDealer(nf); if (!d || !ALVO[d]) continue;
  const op = nf.operation_code;
  const tipo = nf.operation_type;
  const v = parseFloat(nf.total_value) || 0;
  M[d] = M[d] || {};
  M[d][op] = M[d][op] || { Output: 0, Input: 0, n: 0 };
  M[d][op][tipo] = (M[d][op][tipo] || 0) + v;
  M[d][op].n++;
}

for (const code of Object.keys(ALVO)) {
  const ops = M[code] || {};
  const totalOut = Object.values(ops).reduce((a, o) => a + (o.Output || 0), 0);
  const totalIn = Object.values(ops).reduce((a, o) => a + (o.Input || 0), 0);
  console.log(`\n### ${ALVO[code]} (${code}) — Output total=R$${f(totalOut)} | Input(credev)=R$${f(totalIn)} | líq=R$${f(totalOut - totalIn)} | REF=R$${f(REF[code])}`);
  for (const [op, o] of Object.entries(ops).sort((a, b) => (b[1].Output || 0) - (a[1].Output || 0))) {
    console.log(`   op ${String(op).padStart(5)}: Output=R$${f(o.Output).padStart(11)} Input=R$${f(o.Input).padStart(9)} (${o.n} nf)`);
  }
}
