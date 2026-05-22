/**
 * Lista TODOS os clientes MULTIMARCAS que compraram qualquer produto da
 * linha King (447 SKUs), SEM filtro de data — histórico completo.
 *
 * Filtro:
 *   - operation_type = Output
 *   - operation_name contém MTM ou MULTIMARCAS
 *   - items[] contém algum SKU King
 *
 * Enriquecimento:
 *   - cpf/cnpj, fantasy_name, uf, telefone, email (pes_pessoa)
 *   - SKUs King comprados + nome + preço promo atual
 *   - filial vendedora dominante
 *   - última compra King + qtd NFs King + valor total King
 *
 * Saída:
 *   .tmp-test/king-multimarcas-tudo.csv
 *   .tmp-test/king-multimarcas-tudo.xlsx (rodar gerar-excel depois)
 */
import supabaseFiscal from '../config/supabaseFiscal.js';
import supabase from '../config/supabase.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const KING_SKUS_FILE = path.resolve(__dirname, '../../.tmp-test/king-skus.txt');
const PROMO_JSON = path.resolve(__dirname, '../../.tmp-test/promo-varejo.json');
const OUT_CSV = path.resolve(__dirname, '../../.tmp-test/king-multimarcas-tudo.csv');
const OUT_DETALHADO_CSV = path.resolve(
  __dirname,
  '../../.tmp-test/king-multimarcas-detalhado.csv',
);

function isMultimarcas(opName) {
  if (!opName) return false;
  const op = opName.toUpperCase();
  return /MULTIMARCAS|\bMTM\b/.test(op);
}

async function withRetry(fn, label, max = 3) {
  for (let i = 0; i < max; i++) {
    try {
      const r = await fn();
      if (!r.error) return r;
      if (i === max - 1) console.warn(`  ${label}: ${r.error.message}`);
    } catch (e) {
      if (i === max - 1) console.warn(`  ${label}: ${e.message}`);
    }
    await new Promise((res) => setTimeout(res, 400 * (i + 1)));
  }
  return { data: null, error: { message: 'falhou' } };
}

async function main() {
  // 1) SKUs King
  const skus = fs.readFileSync(KING_SKUS_FILE, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
  const kingSet = new Set(skus);
  console.log(`📦 ${kingSet.size} SKUs King carregados`);

  // 2) Catálogo de preços
  const promoRaw = JSON.parse(fs.readFileSync(PROMO_JSON, 'utf8'));
  const promoArr = Array.isArray(promoRaw)
    ? promoRaw
    : promoRaw.items || promoRaw.data || [];
  const promoMap = new Map();
  for (const p of promoArr) promoMap.set(String(p.sku), p);
  console.log(`💰 ${promoMap.size} SKUs King com preço promo`);

  // 3) Varre TODAS as NFs Output, filtra King + multimarcas
  const HOJE = new Date();
  console.log(`\n🔎 Varrendo notas_fiscais Output (sem limite de data)...`);
  const personMap = new Map(); // person_code -> { ... }
  const vendasDetalhadas = []; // 1 linha por NF×SKU
  let offset = 0;
  const PAGE = 1000;
  let nfsProcessadas = 0;
  let nfsKingMM = 0;
  let nfsKingOutras = 0;

  while (true) {
    const r = await withRetry(
      () =>
        supabaseFiscal
          .from('notas_fiscais')
          .select('person_code,person_name,operation_name,branch_code,dealer_code,issue_date,items,total_value')
          .eq('operation_type', 'Output')
          .not('invoice_status', 'eq', 'Canceled')
          .not('invoice_status', 'eq', 'Deleted')
          .lt('person_code', 100000000)
          .order('id', { ascending: true })
          .range(offset, offset + PAGE - 1),
      `range ${offset}`,
    );
    if (r.error) break;
    const data = r.data || [];
    if (data.length === 0) break;

    for (const nf of data) {
      nfsProcessadas++;
      const items = Array.isArray(nf.items) ? nf.items : [];
      // Coleta SKUs King da NF
      const kingSkusNF = new Map(); // sku -> { qtd, valor, name }
      for (const it of items) {
        const skuTop = String(it?.code ?? it?.productCode ?? it?.sku ?? '');
        if (skuTop && kingSet.has(skuTop)) {
          const ex = kingSkusNF.get(skuTop) || { qtd: 0, valor: 0, name: it?.name || '' };
          ex.qtd += Number(it?.quantity || 0);
          ex.valor += Number(it?.netValue || 0);
          if (!ex.name && it?.name) ex.name = it.name;
          kingSkusNF.set(skuTop, ex);
        }
        const products = Array.isArray(it?.products) ? it.products : [];
        for (const p of products) {
          const pSku = String(p?.productCode ?? p?.sku ?? p?.code ?? '');
          if (pSku && kingSet.has(pSku)) {
            const ex = kingSkusNF.get(pSku) || { qtd: 0, valor: 0, name: p?.productName || it?.name || '' };
            ex.qtd += Number(p?.quantity || 0);
            ex.valor += Number(p?.netValue || 0);
            if (!ex.name) ex.name = p?.productName || it?.name || '';
            kingSkusNF.set(pSku, ex);
          }
        }
      }
      if (kingSkusNF.size === 0) continue;

      const mm = isMultimarcas(nf.operation_name);
      if (!mm) {
        nfsKingOutras++;
        continue;
      }
      nfsKingMM++;

      const pc = nf.person_code;
      if (!pc) continue;
      let p = personMap.get(pc);
      if (!p) {
        p = {
          person_code: pc,
          person_name: nf.person_name,
          ultima_compra_king: nf.issue_date,
          primeira_compra_king: nf.issue_date,
          qtd_nfs_king: 0,
          valor_total_king: 0,
          qtd_pecas_king: 0,
          skus: new Map(), // sku -> { qtd, valor, name }
          branchCount: new Map(),
          lastDealer: null,
          operationsCount: new Map(),
        };
        personMap.set(pc, p);
      }
      p.qtd_nfs_king++;
      if (nf.issue_date > p.ultima_compra_king) p.ultima_compra_king = nf.issue_date;
      if (nf.issue_date < p.primeira_compra_king) p.primeira_compra_king = nf.issue_date;
      if (nf.branch_code) p.branchCount.set(nf.branch_code, (p.branchCount.get(nf.branch_code) || 0) + 1);
      if (!p.lastDealer && nf.dealer_code) p.lastDealer = nf.dealer_code;
      if (nf.operation_name) p.operationsCount.set(nf.operation_name, (p.operationsCount.get(nf.operation_name) || 0) + 1);

      for (const [sku, info] of kingSkusNF) {
        p.qtd_pecas_king += info.qtd;
        p.valor_total_king += info.valor;
        const ex = p.skus.get(sku) || { qtd: 0, valor: 0, name: info.name, lastDate: nf.issue_date };
        ex.qtd += info.qtd;
        ex.valor += info.valor;
        if (!ex.name && info.name) ex.name = info.name;
        if (nf.issue_date > ex.lastDate) ex.lastDate = nf.issue_date;
        p.skus.set(sku, ex);
        // Linha detalhada: 1 por NF×SKU
        vendasDetalhadas.push({
          issue_date: nf.issue_date,
          person_code: pc,
          person_name: nf.person_name,
          dealer_code: nf.dealer_code || null,
          branch_code: nf.branch_code || null,
          operation_name: nf.operation_name || '',
          sku,
          produto: info.name,
          qtd: info.qtd,
          valor: info.valor,
        });
      }
    }

    if (nfsProcessadas % 10000 === 0) {
      console.log(`  → ${nfsProcessadas} NFs | ${nfsKingMM} King-MM | ${nfsKingOutras} King-outras | ${personMap.size} clientes MM`);
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  console.log(`\n✅ Varredura: ${nfsProcessadas} NFs | ${nfsKingMM} King-MULTIMARCAS | ${personMap.size} clientes únicos`);

  if (personMap.size === 0) { console.log('Nenhum cliente encontrado.'); return; }

  // 4) Enriquece com pes_pessoa
  console.log(`\n🔎 Buscando dados de pes_pessoa (CNPJ/fantasy/fone/email/UF)...`);
  const personCodes = [...personMap.keys()];
  const pessoasMap = new Map();
  const CHUNK = 100;
  for (let i = 0; i < personCodes.length; i += CHUNK) {
    const chunk = personCodes.slice(i, i + CHUNK);
    const r = await withRetry(
      () =>
        supabase
          .from('pes_pessoa')
          .select('code,nm_pessoa,fantasy_name,cpf,tipo_pessoa,uf,telefone,email')
          .in('code', chunk),
      `pes_pessoa ${i}`,
    );
    for (const p of r.data || []) pessoasMap.set(p.code, p);
  }
  console.log(`  → ${pessoasMap.size}/${personCodes.length} encontrados`);

  // 4.1) FILTRA FRANQUIAS — fantasy_name contém CROSBY ou REPASSE ou padrão F<n>
  //      e nome do cliente contém CROSBY (caso fantasy ausente)
  const isFranquia = (pc) => {
    const pp = pessoasMap.get(pc) || {};
    const fan = (pp.fantasy_name || '').toUpperCase();
    const nm = (pp.nm_pessoa || personMap.get(pc)?.person_name || '').toUpperCase();
    if (/CROSBY|REPASSE|^F\d+\s*-?\s*CROSBY/i.test(fan)) return true;
    if (/CROSBY/i.test(nm) && /LTDA|EIRELI|ME\b|S\.?A\b|MERCANTIL/i.test(nm)) return true;
    return false;
  };
  const totalAntes = personMap.size;
  let removidas = 0;
  for (const pc of [...personMap.keys()]) {
    if (isFranquia(pc)) {
      personMap.delete(pc);
      removidas++;
    }
  }
  console.log(`\n🧹 Filtragem de franquias: removidas ${removidas}/${totalAntes} → restam ${personMap.size} multimarcas reais`);

  // 5) Carrega vendedores (Supabase fiscal)
  const rv = await withRetry(
    () => supabaseFiscal.from('vendedores').select('seller_code,seller_name,person_code,person_name'),
    'vendedores',
  );
  const vendedoresMap = new Map();
  for (const v of rv.data || []) vendedoresMap.set(v.seller_code, v);
  console.log(`  → ${vendedoresMap.size} vendedores`);

  // 6) Monta CSV
  const fmtMoeda = (v) => Number(v || 0).toFixed(2).replace('.', ',');
  const fmtBRL = (v) => `R$${fmtMoeda(v)}`;
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

  const rows = [];
  for (const [pc, p] of personMap) {
    const pp = pessoasMap.get(pc) || {};
    const vend = p.lastDealer ? vendedoresMap.get(p.lastDealer) : null;
    // Dominante de filial / operation
    let dominantBranch = null, maxB = 0;
    for (const [b, c] of p.branchCount) if (c > maxB) { maxB = c; dominantBranch = b; }
    let dominantOp = '', maxO = 0;
    for (const [op, c] of p.operationsCount) if (c > maxO) { maxO = c; dominantOp = op; }
    // Produtos King — só inclui SKUs presentes na promoção atual; mais recente primeiro
    const skusOrdenados = [...p.skus.entries()]
      .filter(([sku]) => promoMap.has(sku))
      .sort((a, b) => (a[1].lastDate < b[1].lastDate ? 1 : -1));
    const produtos = skusOrdenados.map(([sku, info]) => {
      const promo = promoMap.get(sku);
      const nome = `${promo.produto} ${promo.cor} ${promo.tam}`.trim();
      const precoStr = ` — ${promo.desconto_pct}% off ${fmtBRL(promo.preco_promo)}`;
      return `${info.lastDate} | ${sku} ${nome} ×${info.qtd} ${fmtBRL(info.valor)}${precoStr}`;
    }).join('  ||  ');
    const diasInativo = Math.floor((Date.now() - new Date(p.ultima_compra_king).getTime()) / (1000 * 60 * 60 * 24));
    rows.push({
      person_code: pc,
      person_name: p.person_name || pp.nm_pessoa || '',
      cpf_cnpj: pp.cpf || '',
      tipo_pessoa: pp.tipo_pessoa || '',
      fantasy_name: pp.fantasy_name || '',
      uf: pp.uf || '',
      telefone: pp.telefone || '',
      email: pp.email || '',
      operation_dominante: dominantOp,
      filial_vendedora: dominantBranch || '',
      vendedor_codigo: p.lastDealer || '',
      vendedor_nome: vend?.seller_name || vend?.person_name || '',
      primeira_compra_king: p.primeira_compra_king,
      ultima_compra_king: p.ultima_compra_king,
      dias_inativo: diasInativo,
      qtd_nfs_king: p.qtd_nfs_king,
      qtd_skus_distintos: p.skus.size,
      qtd_pecas_king: p.qtd_pecas_king,
      valor_total_king: p.valor_total_king,
      produtos_king_comprados: produtos,
    });
  }
  // Ordena por valor_total_king desc (maiores compradores primeiro)
  rows.sort((a, b) => b.valor_total_king - a.valor_total_king);

  // Estatísticas
  const valorTotal = rows.reduce((s, r) => s + r.valor_total_king, 0);
  const pecasTotal = rows.reduce((s, r) => s + r.qtd_pecas_king, 0);
  const ativos180 = rows.filter((r) => r.dias_inativo <= 180).length;
  console.log(`\n📊 RESULTADO:`);
  console.log(`  Clientes multimarcas que compraram King:  ${rows.length}`);
  console.log(`  NFs King-Multimarcas:                     ${nfsKingMM}`);
  console.log(`  Peças King vendidas (acumulado):          ${pecasTotal.toLocaleString('pt-BR')}`);
  console.log(`  Valor total King (líquido):               ${fmtBRL(valorTotal)}`);
  console.log(`  Ativos (compraram King últimos 180d):     ${ativos180}`);
  console.log(`  Inativos (>180d sem comprar King):        ${rows.length - ativos180}`);

  console.log(`\n🥇 TOP 10 MULTIMARCAS por valor King:`);
  for (const r of rows.slice(0, 10)) {
    console.log(`  ${String(r.person_code).padStart(7)} | ${(r.person_name || '?').slice(0, 35).padEnd(35)} | ${fmtBRL(r.valor_total_king).padStart(14)} | ${r.qtd_pecas_king}pç | últ ${r.ultima_compra_king}`);
  }

  const header =
    'person_code,person_name,cpf_cnpj,tipo_pessoa,fantasy_name,uf,telefone,email,operation_dominante,filial_vendedora,vendedor_codigo,vendedor_nome,primeira_compra_king,ultima_compra_king,dias_inativo,qtd_nfs_king,qtd_skus_distintos,qtd_pecas_king,valor_total_king,produtos_king_comprados';
  const out = [
    header,
    ...rows.map((r) =>
      [
        r.person_code,
        escape(r.person_name),
        escape(r.cpf_cnpj),
        escape(r.tipo_pessoa),
        escape(r.fantasy_name),
        escape(r.uf),
        escape(r.telefone),
        escape(r.email),
        escape(r.operation_dominante),
        r.filial_vendedora,
        r.vendedor_codigo,
        escape(r.vendedor_nome),
        r.primeira_compra_king,
        r.ultima_compra_king,
        r.dias_inativo,
        r.qtd_nfs_king,
        r.qtd_skus_distintos,
        r.qtd_pecas_king,
        r.valor_total_king.toFixed(2),
        escape(r.produtos_king_comprados),
      ].join(','),
    ),
  ].join('\n');
  fs.writeFileSync(OUT_CSV, out, 'utf8');
  console.log(`\n💾 CSV resumo salvo: ${OUT_CSV}`);

  // ───── CSV detalhado: 1 linha por NF × SKU (só pessoas multimarcas reais) ─────
  const validPersons = new Set([...personMap.keys()]);
  const detRows = vendasDetalhadas.filter((d) => validPersons.has(d.person_code));
  detRows.sort((a, b) => (a.issue_date < b.issue_date ? 1 : -1)); // mais recente primeiro
  const detHeader =
    'issue_date,person_code,person_name,cpf_cnpj,fantasy_name,telefone,operation_name,branch_code,dealer_code,vendedor_nome,sku,produto,produto_promo,preco_unitario,preco_promo_atual,desconto_pct,qtd,valor_total_nf_sku';
  const detLines = [detHeader];
  for (const d of detRows) {
    const pp = pessoasMap.get(d.person_code) || {};
    const vend = d.dealer_code ? vendedoresMap.get(d.dealer_code) : null;
    const promo = promoMap.get(d.sku);
    const precoUnit = d.qtd > 0 ? d.valor / d.qtd : 0;
    detLines.push(
      [
        d.issue_date,
        d.person_code,
        escape(d.person_name || pp.nm_pessoa || ''),
        escape(pp.cpf || ''),
        escape(pp.fantasy_name || ''),
        escape(pp.telefone || ''),
        escape(d.operation_name),
        d.branch_code || '',
        d.dealer_code || '',
        escape(vend?.seller_name || vend?.person_name || ''),
        d.sku,
        escape(d.produto || ''),
        escape(promo ? `${promo.produto} ${promo.cor} ${promo.tam}`.trim() : ''),
        precoUnit.toFixed(2),
        promo?.preco_promo != null ? Number(promo.preco_promo).toFixed(2) : '',
        promo?.desconto_pct != null ? promo.desconto_pct : '',
        d.qtd,
        d.valor.toFixed(2),
      ].join(','),
    );
  }
  fs.writeFileSync(OUT_DETALHADO_CSV, detLines.join('\n'), 'utf8');
  console.log(`💾 CSV detalhado salvo: ${OUT_DETALHADO_CSV} (${detRows.length} linhas — 1 por NF×SKU)`);

  // Estatísticas: top vendedores no detalhado
  const vendStats = new Map();
  for (const d of detRows) {
    const v = d.dealer_code ? vendedoresMap.get(d.dealer_code) : null;
    const nome = v?.seller_name || v?.person_name || `(sem vend ${d.dealer_code})`;
    const e = vendStats.get(nome) || { vendas: 0, pecas: 0, valor: 0, clientes: new Set() };
    e.vendas++;
    e.pecas += d.qtd;
    e.valor += d.valor;
    e.clientes.add(d.person_code);
    vendStats.set(nome, e);
  }
  console.log(`\n👤 TOP 10 VENDEDORES (multimarcas King — sem franquias):`);
  for (const [nome, e] of [...vendStats.entries()].sort((a, b) => b[1].valor - a[1].valor).slice(0, 10)) {
    console.log(
      `  ${nome.slice(0, 32).padEnd(32)} | ${e.clientes.size}cli | ${e.vendas}NFs | ${e.pecas}pç | ${fmtBRL(e.valor)}`,
    );
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
