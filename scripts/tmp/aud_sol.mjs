import 'dotenv/config';
import fs from 'fs';
import supabase from '../../config/supabase.js';
const r = JSON.parse(fs.readFileSync('scripts/tmp/auditoria_pagos_conc.json', 'utf8'));
const concIds = [...new Set([...r.semLinha.map(x => x.conc), ...r.naoCasa.map(x => x.conciliacao_id)])];
const { data: concs } = await supabase.from('fluxo_caixa_conciliacoes').select('id,origem,referencia,data,valor').in('id', concIds);
const sol = new Set(), lib = new Set();
const porConc = new Map();
for (const c of concs) {
  const its = Array.isArray(c.referencia?.itens) && c.referencia.itens.length ? c.referencia.itens : [{ origem: c.origem, id: c.referencia?.id }];
  porConc.set(c.id, its);
  for (const it of its) { if (it.origem === 'SOLICITACAO') sol.add(it.id); if (it.origem === 'LIBERACAO') lib.add(it.id); }
}
const { data: sols } = await supabase.from('solicitacoes_crosby').select('id,status,duplicate_code,pagamento_liberacao_id,aprovado_financeiro_em,supplier_name,valor_total').in('id', [...sol]);
const { data: libs } = await supabase.from('pagamentos_liberacao').select('id,status,nr_duplicata,nm_fornecedor,vl_duplicata').in('id', [...lib]);
const g = (a, f) => a.reduce((m, x) => (m[f(x)] = (m[f(x)] || 0) + 1, m), {});
console.log('Solicitações:', sols.length, JSON.stringify(g(sols, s => `${s.status}|aprov:${!!s.aprovado_financeiro_em}|dup:${!!s.duplicate_code}|lib:${!!s.pagamento_liberacao_id}`)));
console.log('Liberações:', libs.length, JSON.stringify(g(libs, l => `${l.status}|dup:${!!l.nr_duplicata}`)));
console.log('Lib sem duplicata:', JSON.stringify(libs.filter(l => !l.nr_duplicata).map(l => [l.nm_fornecedor, l.vl_duplicata, l.status])));
process.exit(0);
