/**
 * V3 — Adiciona ao CSV V2 a coluna `produtos_king_comprados`:
 *   lista dos produtos da linha King (em promoção HOJE) que cada cliente
 *   realmente comprou.
 *
 * Formato da coluna (separado por " | "):
 *   "31888 BERMUDA KING VERMELHO 52 -70% R$53,70 (de R$179)"
 *
 * Entrada:
 *   .tmp-test/king-inativos-completo.csv  (V2, 250 clientes)
 *   .tmp-test/promo-varejo.json           (catálogo King com preços promo)
 *   .tmp-test/king-skus.txt               (SKUs King)
 * Saída:
 *   .tmp-test/king-inativos-com-produtos.csv  (V3, 17 colunas)
 */
import supabaseFiscal from '../config/supabaseFiscal.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IN_CSV = path.resolve(__dirname, '../../.tmp-test/king-inativos-completo.csv');
const OUT_CSV = path.resolve(__dirname, '../../.tmp-test/king-inativos-com-produtos.csv');
const PROMO_JSON = path.resolve(__dirname, '../../.tmp-test/promo-varejo.json');
const KING_SKUS_FILE = path.resolve(__dirname, '../../.tmp-test/king-skus.txt');

function brl(v) {
  if (v == null) return '?';
  return `R$${Number(v).toFixed(2).replace('.', ',')}`;
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
  // ───── Carrega catálogo de promoção ─────
  const promoRaw = JSON.parse(fs.readFileSync(PROMO_JSON, 'utf8'));
  const promoArr = Array.isArray(promoRaw)
    ? promoRaw
    : promoRaw.items || promoRaw.data || promoRaw.products || [];
  const promoMap = new Map();
  for (const p of promoArr) {
    promoMap.set(String(p.sku), {
      produto: p.produto || '',
      descricao: p.descricao || '',
      cor: p.cor || '',
      tam: p.tam || '',
      preco_cheio: p.preco_cheio,
      preco_promo: p.preco_promo,
      desconto_pct: p.desconto_pct,
    });
  }
  console.log(`📦 ${promoMap.size} SKUs King em promoção carregados`);

  const kingSet = new Set(
    fs.readFileSync(KING_SKUS_FILE, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean),
  );

  // ───── Lê CSV V2 ─────
  const linhasV2 = fs.readFileSync(IN_CSV, 'utf8').split('\n').filter(Boolean);
  const header = linhasV2[0];
  const rows = [];
  // Parser CSV simples — respeitando aspas
  function parseCsvLine(line) {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQ && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = !inQ;
        }
      } else if (c === ',' && !inQ) {
        out.push(cur);
        cur = '';
      } else {
        cur += c;
      }
    }
    out.push(cur);
    return out;
  }
  const cols = parseCsvLine(header);
  for (let i = 1; i < linhasV2.length; i++) {
    const parts = parseCsvLine(linhasV2[i]);
    const obj = {};
    cols.forEach((c, j) => (obj[c] = parts[j] || ''));
    rows.push(obj);
  }
  console.log(`📋 ${rows.length} clientes para enriquecer com produtos`);

  // ───── Pra cada cliente, busca SKUs King comprados ─────
  const produtosByPerson = new Map();
  const CONC = 8;
  let done = 0;
  for (let i = 0; i < rows.length; i += CONC) {
    const batch = rows.slice(i, i + CONC);
    await Promise.all(
      batch.map(async (r) => {
        const pc = +r.person_code;
        const resp = await withRetry(
          () =>
            supabaseFiscal
              .from('notas_fiscais')
              .select('items,issue_date')
              .eq('operation_type', 'Output')
              .eq('person_code', pc)
              .not('invoice_status', 'eq', 'Canceled')
              .not('invoice_status', 'eq', 'Deleted')
              .order('issue_date', { ascending: false })
              .limit(50),
          `pc=${pc}`,
        );
        const skusEncontrados = new Map(); // sku -> { qtd, lastDate, nameFromNF }
        for (const nf of resp.data || []) {
          const items = Array.isArray(nf.items) ? nf.items : [];
          for (const it of items) {
            const candidatos = [];
            const skuTop = String(it?.code ?? it?.productCode ?? it?.sku ?? '');
            if (skuTop && kingSet.has(skuTop)) {
              candidatos.push({ sku: skuTop, name: it?.name || '' });
            }
            const products = Array.isArray(it?.products) ? it.products : [];
            for (const p of products) {
              const pSku = String(p?.productCode ?? p?.sku ?? p?.code ?? '');
              if (pSku && kingSet.has(pSku)) {
                candidatos.push({ sku: pSku, name: p?.productName || it?.name || '' });
              }
            }
            for (const cand of candidatos) {
              const ex = skusEncontrados.get(cand.sku);
              if (!ex) {
                skusEncontrados.set(cand.sku, { qtd: 1, lastDate: nf.issue_date, nameFromNF: cand.name });
              } else {
                ex.qtd++;
                if (nf.issue_date > ex.lastDate) ex.lastDate = nf.issue_date;
                if (!ex.nameFromNF && cand.name) ex.nameFromNF = cand.name;
              }
            }
          }
        }
        produtosByPerson.set(pc, skusEncontrados);
      }),
    );
    done += batch.length;
    if (done % 50 === 0 || done === rows.length) console.log(`  → ${done}/${rows.length}`);
  }

  // ───── Monta coluna `produtos_king_comprados` ─────
  let totalSkusVendidos = 0;
  const enriched = rows.map((r) => {
    const pc = +r.person_code;
    const skus = produtosByPerson.get(pc) || new Map();
    const items = [];
    for (const [sku, info] of skus) {
      const promo = promoMap.get(sku);
      const nome = promo
        ? `${promo.produto} ${promo.cor} ${promo.tam}`.trim()
        : info.nameFromNF || '?';
      const precoStr = promo
        ? `${promo.desconto_pct}% off ${brl(promo.preco_promo)} (de ${brl(promo.preco_cheio)})`
        : '';
      const qtdStr = info.qtd > 1 ? ` ×${info.qtd}` : '';
      items.push(`${sku} ${nome}${qtdStr}${precoStr ? ` — ${precoStr}` : ''}`);
      totalSkusVendidos++;
    }
    return { ...r, produtos_king_comprados: items.join(' | '), qtd_skus_king: items.length };
  });

  // Estatísticas
  console.log(`\n📊 ${totalSkusVendidos} SKU-cliente únicos identificados`);
  const semProd = enriched.filter((r) => r.qtd_skus_king === 0).length;
  if (semProd > 0) console.log(`⚠️  ${semProd} clientes ficaram SEM produto identificado (item antigo da NF não casa com kingSet)`);

  // Top produtos vendidos pra inativos
  const prodCount = new Map();
  for (const r of enriched) {
    for (const item of r.produtos_king_comprados.split(' | ').filter(Boolean)) {
      const sku = item.split(' ')[0];
      if (!sku) continue;
      const key = sku;
      prodCount.set(key, (prodCount.get(key) || 0) + 1);
    }
  }
  console.log('\n🔝 TOP 10 SKUs King mais comprados por inativos:');
  for (const [sku, c] of [...prodCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    const p = promoMap.get(sku);
    const desc = p ? `${p.produto} ${p.cor} ${p.tam} (-${p.desconto_pct}% ${brl(p.preco_promo)})` : '?';
    console.log(`  ${sku.padStart(6)}  →  ${c} clientes  |  ${desc}`);
  }

  // ───── Salva CSV V3 ─────
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const headerOut =
    'person_code,person_name,categoria,operation_dominante,cpf_cnpj,tipo_pessoa,fantasy_name,uf,telefone,email,filial_vendedora,vendedor_codigo,vendedor_nome,ultima_compra,ultima_compra_king,dias_inativo,qtd_skus_king,produtos_king_comprados';
  const out = [
    headerOut,
    ...enriched.map((r) =>
      [
        r.person_code,
        escape(r.person_name),
        escape(r.categoria),
        escape(r.operation_dominante),
        escape(r.cpf_cnpj),
        escape(r.tipo_pessoa),
        escape(r.fantasy_name),
        escape(r.uf),
        escape(r.telefone),
        escape(r.email),
        r.filial_vendedora,
        r.vendedor_codigo,
        escape(r.vendedor_nome),
        r.ultima_compra,
        r.ultima_compra_king,
        r.dias_inativo,
        r.qtd_skus_king,
        escape(r.produtos_king_comprados),
      ].join(','),
    ),
  ].join('\n');
  fs.writeFileSync(OUT_CSV, out, 'utf8');
  console.log(`\n💾 CSV final salvo: ${OUT_CSV}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('💥 Erro fatal:', err);
    process.exit(1);
  });
