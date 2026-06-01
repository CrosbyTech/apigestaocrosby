/**
 * Base de clientes MULTIMARCAS (classificação TOTVS tipo 20/cód2 + tipo5/cód1)
 * que COMPRARAM em 2026, com o vendedor que atendeu.
 *
 * Entrada:
 *   ../../.tmp/multimarcas_base.json   (os 484 — classificação)
 *   ../../.tmp/mm_phones.json          (telefones/uf/nome do batch-lookup)
 * Saída:
 *   ../../.tmp/base_multimarcas_compraram_2026.csv
 */
import supabaseFiscal from '../config/supabaseFiscal.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../');
const ANO_INI = '2026-01-01';

const base = JSON.parse(fs.readFileSync(path.join(ROOT, '.tmp/multimarcas_base.json'), 'utf8')).data || [];
const phonesItems = (JSON.parse(fs.readFileSync(path.join(ROOT, '.tmp/mm_phones.json'), 'utf8')).data || {}).items || [];
const phoneByCode = new Map(phonesItems.map((i) => [i.code, i]));
const baseByCode = new Map(base.map((c) => [c.code, c]));
const codes = base.map((c) => c.code);
console.log(`📋 ${codes.length} clientes multimarcas (classificação) carregados`);

// 1) Vendedores
const rv = await supabaseFiscal.from('vendedores').select('seller_code,seller_name,person_name');
const vendMap = new Map((rv.data || []).map((v) => [v.seller_code, v.seller_name || v.person_name || `cód ${v.seller_code}`]));
console.log(`👤 ${vendMap.size} vendedores`);

// 2) Notas 2026 dos 484 (chunk de person_code)
const CHUNK = 80;
const PAGE = 1000;
const perPessoa = new Map(); // code -> {nfs, valor, ultima, primeira, sellers:Map, ops:Map}
let totalNfs = 0;

for (let i = 0; i < codes.length; i += CHUNK) {
  const chunk = codes.slice(i, i + CHUNK);
  let offset = 0;
  while (true) {
    const { data, error } = await supabaseFiscal
      .from('notas_fiscais')
      .select('person_code,dealer_code,operation_name,issue_date,total_value')
      .eq('operation_type', 'Output')
      .not('invoice_status', 'eq', 'Canceled')
      .not('invoice_status', 'eq', 'Deleted')
      .gte('issue_date', ANO_INI)
      .in('person_code', chunk)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) { console.warn('  erro:', error.message); break; }
    if (!data || data.length === 0) break;
    for (const nf of data) {
      totalNfs++;
      const pc = nf.person_code;
      let p = perPessoa.get(pc);
      if (!p) { p = { nfs: 0, valor: 0, ultima: nf.issue_date, primeira: nf.issue_date, sellers: new Map(), ops: new Map() }; perPessoa.set(pc, p); }
      p.nfs++;
      p.valor += Number(nf.total_value || 0);
      if (nf.issue_date > p.ultima) p.ultima = nf.issue_date;
      if (nf.issue_date < p.primeira) p.primeira = nf.issue_date;
      if (nf.dealer_code != null) p.sellers.set(nf.dealer_code, (p.sellers.get(nf.dealer_code) || 0) + 1);
      if (nf.operation_name) p.ops.set(nf.operation_name, (p.ops.get(nf.operation_name) || 0) + 1);
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  process.stdout.write(`\r  varrido ${Math.min(i + CHUNK, codes.length)}/${codes.length} clientes | ${perPessoa.size} compraram | ${totalNfs} NFs`);
}
console.log(`\n✅ ${perPessoa.size}/${codes.length} clientes multimarcas compraram em 2026 (${totalNfs} NFs)`);

// 3) Monta CSV
const fmtCnpj = (c) => { const s = String(c || '').replace(/\D/g, ''); return s.length === 14 ? s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : (s || ''); };
const fmtTel = (n) => { const s = String(n || '').replace(/\D/g, ''); if (s.length === 11) return s.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3'); if (s.length === 10) return s.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3'); return s; };
const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const telPrincipal = (it) => { const ph = Array.isArray(it?.phones) ? it.phones : []; const d = ph.find((p) => p.isDefault) || ph[0]; return d ? d.number : ''; };

const rows = [];
for (const [pc, p] of perPessoa) {
  const b = baseByCode.get(pc) || {};
  const it = phoneByCode.get(pc) || {};
  // Vendedor dominante (mais NFs) + todos ordenados por nº de NFs
  const sellersSorted = [...p.sellers.entries()].sort((a, b2) => b2[1] - a[1]);
  const vendDom = sellersSorted[0] ? vendMap.get(sellersSorted[0][0]) || `cód ${sellersSorted[0][0]}` : '';
  const vendTodos = sellersSorted.map(([code, n]) => `${vendMap.get(code) || `cód ${code}`} (${n})`).join(' | ');
  rows.push({
    code: pc,
    name: b.name || it.name || '',
    fantasy: b.fantasyName || it.fantasyName || '',
    cnpj: fmtCnpj(b.cnpj || it.cnpj),
    uf: it.uf || '',
    tel: fmtTel(telPrincipal(it)),
    nfs: p.nfs,
    valor: p.valor,
    primeira: p.primeira,
    ultima: p.ultima,
    vendedor: vendDom,
    vendedores_todos: vendTodos,
  });
}
rows.sort((a, b) => b.valor - a.valor);

const header = 'codigo,razao_social,nome_fantasia,cnpj,uf,telefone,qtd_nfs_2026,valor_total_2026,primeira_compra_2026,ultima_compra_2026,vendedor,vendedores_todos';
const out = [header, ...rows.map((r) => [
  r.code, esc(r.name), esc(r.fantasy), esc(r.cnpj), esc(r.uf), esc(r.tel),
  r.nfs, r.valor.toFixed(2).replace('.', ','), r.primeira, r.ultima, esc(r.vendedor), esc(r.vendedores_todos),
].join(','))];
const OUT = path.join(ROOT, '.tmp/base_multimarcas_compraram_2026.csv');
fs.writeFileSync(OUT, '﻿' + out.join('\r\n'), 'utf8');

const valorTotal = rows.reduce((s, r) => s + r.valor, 0);
console.log(`\n💾 CSV: ${OUT}`);
console.log(`📊 Compraram 2026: ${rows.length} clientes | ${totalNfs} NFs | R$ ${valorTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
console.log(`   Não compraram em 2026: ${codes.length - rows.length}`);
console.log(`\n🥇 TOP 10 por valor:`);
for (const r of rows.slice(0, 10)) console.log(`  ${String(r.code).padStart(7)} | ${(r.name || '?').slice(0, 32).padEnd(32)} | R$ ${r.valor.toFixed(2).padStart(12)} | ${r.nfs}NF | vend: ${r.vendedor}`);

process.exit(0);
