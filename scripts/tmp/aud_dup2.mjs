import 'dotenv/config';
import fs from 'fs';
import supabase from '../../config/supabase.js';
const pagos = [];
for (let f = 0; ; f += 1000) { const { data } = await supabase.from('contas_pagar_pagos_conciliacao').select('*').order('id').range(f, f + 999); pagos.push(...(data||[])); if (!data || data.length < 1000) break; }
const dups = [...new Set(pagos.map(p => p.nr_duplicata))];
const esp = [];
for (let i = 0; i < dups.length; i += 200) { const { data } = await supabase.from('accounts_payable_duplicates_v').select('branch_code,supplier_code,supplier_name,duplicate_code,installment_code,issue_date,due_date,settlement_date,status,duplicate_value,paid_value').in('duplicate_code', dups.slice(i, i + 200)); esp.push(...(data||[])); }
const cmp = (a, b) => (a == null || b == null ? null : Number(a) === Number(b));
const casa = (e, p) => { if (cmp(e.branch_code, p.cd_empresa) === false) return false; const pa = cmp(e.installment_code, p.nr_parcela), fo = cmp(e.supplier_code, p.cd_fornecedor); if (pa === false || fo === false) return false; return pa === true || fo === true; };
const k = (e) => `${e.branch_code}|${e.duplicate_code}|${e.installment_code}|${e.supplier_code}`;
const pagoConc = new Map(); // titulo -> pagos
for (const p of pagos) for (const e of esp.filter(e => String(e.duplicate_code) === String(p.nr_duplicata) && casa(e, p))) { if (!pagoConc.has(k(e))) pagoConc.set(k(e), { e, pagos: [] }); pagoConc.get(k(e)).pagos.push(p); }
const abertoTotvs = (e) => !e.settlement_date && !(Number(e.paid_value) > 0);
const out = [];
for (const { e, pagos: ps } of pagoConc.values()) {
  // outra linha do contas a pagar com o MESMO nº de duplicata e MESMA parcela, em aberto e não paga via conciliação
  const irmas = esp.filter(x => String(x.duplicate_code) === String(e.duplicate_code) && Number(x.installment_code) === Number(e.installment_code) && k(x) !== k(e) && abertoTotvs(x) && !pagoConc.has(k(x)));
  for (const x of irmas) out.push({ pago: e, conc: ps.map(p => p.conciliacao_id).join(','), dtPag: ps[0].dt_pagamento, aberto: x, mesmoValor: Math.abs(Number(x.duplicate_value) - Number(e.duplicate_value)) < 0.02 });
}
console.log('pares', out.length, 'mesmo valor', out.filter(o => o.mesmoValor).length);
for (const o of out) console.log(o.mesmoValor ? 'MESMO VALOR' : 'valor difer.', '| PAGO', o.pago.branch_code, o.pago.duplicate_code + '/' + o.pago.installment_code, (o.pago.supplier_name||o.pago.supplier_code), o.pago.duplicate_value, 'venc', o.pago.due_date?.slice(0,10), 'pg', o.dtPag, '| ABERTO', o.aberto.branch_code, (o.aberto.supplier_name||o.aberto.supplier_code), o.aberto.duplicate_value, 'venc', o.aberto.due_date?.slice(0,10));
fs.writeFileSync('scripts/tmp/aud_dup2.json', JSON.stringify(out, null, 1));
process.exit(0);
