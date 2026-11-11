import 'dotenv/config';
import supabase from '../../config/supabase.js';
import { listarConciliacoes } from '../../services/fluxoCaixaConciliacao.js';
const concs = (await listarConciliacoes({ de: '2026-01-01' })).filter((c) => Number(c.valor) < 0 && ['TOTVS_CP','LIBERACAO','SOLICITACAO','MULTIPLO'].includes(c.origem));
const cont = {}; let itens = 0;
const totvsIds = new Set(), libIds = new Set(), solIds = new Set();
for (const c of concs) {
  cont[c.origem] = (cont[c.origem] || 0) + 1;
  const its = Array.isArray(c.referencia?.itens) && c.referencia.itens.length ? c.referencia.itens : [{ origem: c.origem, id: c.referencia?.id }];
  for (const it of its) { if (it.id == null) continue; itens++; if (it.origem === 'TOTVS_CP') totvsIds.add(it.id); if (it.origem === 'LIBERACAO') libIds.add(it.id); if (it.origem === 'SOLICITACAO') solIds.add(it.id); }
}
console.log('conciliações de saída', concs.length, cont, 'itens', itens, 'TOTVS', totvsIds.size, 'LIB', libIds.size, 'SOL', solIds.size);
// APROVADOS que virariam PAGO
const { data: aprov } = await supabase.from('pagamentos_liberacao').select('id,nr_duplicata,nr_parcela,cd_empresa,cd_fornecedor,nm_fornecedor,vl_duplicata').eq('status', 'APROVADO').limit(2000);
const dupsTotvs = [...totvsIds].map((id) => id.split('|'));
let n = 0; const ex = [];
for (const a of aprov || []) {
  const hit = libIds.has(a.id) || dupsTotvs.some(([b, d, p, f]) => String(d) === String(a.nr_duplicata) && (a.cd_empresa == null || String(b) === String(a.cd_empresa)) && (a.nr_parcela != null ? String(p) === String(a.nr_parcela) : (a.cd_fornecedor != null && String(f) === String(a.cd_fornecedor))));
  if (hit) { n++; if (ex.length < 10) ex.push(`${a.nm_fornecedor} ${a.vl_duplicata} dup ${a.nr_duplicata}/${a.nr_parcela}`); }
}
console.log('APROVADOS total', aprov?.length, 'virariam PAGO (via TOTVS_CP/LIBERACAO):', n); ex.forEach((e) => console.log('  ', e));
process.exit(0);
