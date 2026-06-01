/**
 * Base MULTIMARCAS (classificação) — telefone + data da ÚLTIMA COMPRA (histórico completo),
 * com o vendedor que atendeu na última compra.
 *
 * Entrada: ../../.tmp/multimarcas_base.json + ../../.tmp/mm_phones.json
 * Saída:   ../../.tmp/base_multimarcas_telefone_ultima_compra.csv
 */
import supabaseFiscal from '../config/supabaseFiscal.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../');

const base = JSON.parse(fs.readFileSync(path.join(ROOT, '.tmp/multimarcas_base.json'), 'utf8')).data || [];
const phonesItems = (JSON.parse(fs.readFileSync(path.join(ROOT, '.tmp/mm_phones.json'), 'utf8')).data || {}).items || [];
const phoneByCode = new Map(phonesItems.map((i) => [i.code, i]));
const baseByCode = new Map(base.map((c) => [c.code, c]));
const codes = base.map((c) => c.code);
console.log(`📋 ${codes.length} clientes multimarcas (classificação)`);

const rv = await supabaseFiscal.from('vendedores').select('seller_code,seller_name,person_name');
const vendMap = new Map((rv.data || []).map((v) => [v.seller_code, v.seller_name || v.person_name || `cód ${v.seller_code}`]));

const CHUNK = 80, PAGE = 1000;
const perPessoa = new Map(); // code -> {ultima, ultimoDealer, nfs, valor}
let totalNfs = 0;

for (let i = 0; i < codes.length; i += CHUNK) {
  const chunk = codes.slice(i, i + CHUNK);
  let offset = 0;
  while (true) {
    const { data, error } = await supabaseFiscal
      .from('notas_fiscais')
      .select('person_code,dealer_code,issue_date,total_value')
      .eq('operation_type', 'Output')
      .not('invoice_status', 'eq', 'Canceled')
      .not('invoice_status', 'eq', 'Deleted')
      .in('person_code', chunk)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) { console.warn('  erro:', error.message); break; }
    if (!data || data.length === 0) break;
    for (const nf of data) {
      totalNfs++;
      const pc = nf.person_code;
      let p = perPessoa.get(pc);
      if (!p) { p = { ultima: nf.issue_date, ultimoDealer: nf.dealer_code, nfs: 0, valor: 0 }; perPessoa.set(pc, p); }
      p.nfs++;
      p.valor += Number(nf.total_value || 0);
      if (nf.issue_date >= p.ultima) { p.ultima = nf.issue_date; p.ultimoDealer = nf.dealer_code; }
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  process.stdout.write(`\r  ${Math.min(i + CHUNK, codes.length)}/${codes.length} | ${perPessoa.size} com compras | ${totalNfs} NFs`);
}
console.log('');

const fmtCnpj = (c) => { const s = String(c || '').replace(/\D/g, ''); return s.length === 14 ? s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : (s || ''); };
const fmtTel = (n) => { const s = String(n || '').replace(/\D/g, ''); if (s.length === 11) return s.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3'); if (s.length === 10) return s.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3'); return s; };
const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const telPrincipal = (it) => { const ph = Array.isArray(it?.phones) ? it.phones : []; const d = ph.find((p) => p.isDefault) || ph[0]; return d ? d.number : ''; };
const wpp = (it) => { const ph = Array.isArray(it?.phones) ? it.phones : []; const w = ph.find((p) => /WHATS/i.test(p.typeName || '') || p.typeCode === 3); return w ? w.number : ''; };
const HOJE = new Date('2026-06-01');

const rows = base.map((c) => {
  const it = phoneByCode.get(c.code) || {};
  const p = perPessoa.get(c.code);
  const dias = p ? Math.floor((HOJE - new Date(p.ultima)) / 86400000) : '';
  return {
    code: c.code,
    name: c.name || '',
    fantasy: c.fantasyName || '',
    cnpj: fmtCnpj(c.cnpj),
    uf: it.uf || '',
    tel: fmtTel(telPrincipal(it)),
    wpp: fmtTel(wpp(it)),
    ultima: p ? p.ultima : '',
    dias_sem_comprar: dias,
    nfs: p ? p.nfs : 0,
    valor: p ? p.valor : 0,
    vendedor: p && p.ultimoDealer != null ? (vendMap.get(p.ultimoDealer) || `cód ${p.ultimoDealer}`) : '',
  };
});
// Ordena: quem comprou mais recente primeiro; sem compra por último
rows.sort((a, b) => (b.ultima || '').localeCompare(a.ultima || ''));

const header = 'codigo,razao_social,nome_fantasia,cnpj,uf,telefone,whatsapp,ultima_compra,dias_sem_comprar,qtd_nfs_total,valor_total,vendedor_ultima_compra';
const out = [header, ...rows.map((r) => [
  r.code, esc(r.name), esc(r.fantasy), esc(r.cnpj), esc(r.uf), esc(r.tel), esc(r.wpp),
  r.ultima, r.dias_sem_comprar, r.nfs, r.valor.toFixed(2).replace('.', ','), esc(r.vendedor),
].join(','))];
const OUT = path.join(ROOT, '.tmp/base_multimarcas_telefone_ultima_compra.csv');
fs.writeFileSync(OUT, '﻿' + out.join('\r\n'), 'utf8');

const comCompra = rows.filter((r) => r.ultima).length;
console.log(`\n💾 CSV: ${OUT}`);
console.log(`📊 ${rows.length} clientes | ${comCompra} já compraram | ${rows.length - comCompra} sem nenhuma compra registrada`);
console.log(`\n🕒 Amostra (mais recentes):`);
for (const r of rows.slice(0, 8)) console.log(`  ${String(r.code).padStart(7)} | ${(r.name || '?').slice(0, 28).padEnd(28)} | últ ${r.ultima} (${r.dias_sem_comprar}d) | ${r.tel} | vend ${r.vendedor}`);

process.exit(0);
