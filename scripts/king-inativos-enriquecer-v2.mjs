/**
 * Enriquecimento V2 do CSV de King inativos:
 *   - Categoria (varejo/revenda/multimarcas/franquia/interno)
 *   - operation_dominante
 *   - cpf_cnpj (de pes_pessoa)
 *   - razao_social (nm_pessoa)
 *   - fantasy_name (de pes_pessoa)
 *   - tipo_pessoa (PF/PJ)
 *   - uf
 *   - telefone (de pes_pessoa)
 *   - email (de pes_pessoa)
 *   - filial_vendedora (branch_code mais frequente das NFs King)
 *   - vendedor_responsavel (nome do vendedor da ÚLTIMA NF do cliente)
 *
 * Lê:   .tmp-test/king-inativos.csv (250 linhas)
 * Escreve: .tmp-test/king-inativos-completo.csv
 */
import supabaseFiscal from '../config/supabaseFiscal.js';
import supabase from '../config/supabase.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IN_CSV = path.resolve(__dirname, '../../.tmp-test/king-inativos.csv');
const OUT_CSV = path.resolve(__dirname, '../../.tmp-test/king-inativos-completo.csv');
const KING_SKUS_FILE = path.resolve(__dirname, '../../.tmp-test/king-skus.txt');

function classificar(operationName, personName) {
  const op = (operationName || '').toUpperCase();
  const pn = (personName || '').toUpperCase();
  // 1) Operações específicas têm prioridade sobre nome
  if (/BAZAR|SALDO\s*DEFEITO/.test(op)) return 'BAZAR/SALDO';
  if (/CONSIGNAD/.test(op)) return 'VENDA CONSIGNADA';
  if (/BONIFICACAO|TRANSF|REMESSA|SUFRAMA|INDUSTRIALIZACAO|DEMONSTRACAO|MOSTRUARIO/.test(op))
    return 'INTERNO/TRANSF';
  // 2) Franquia (cliente Crosby corporativo ou op explícita)
  if (/CROSBY.*(LTDA|EIRELI|SHOPPING|ME|FRANQUIA|S\.A|MERCANTIL)/.test(pn) || /FRANQUIA/.test(op)) {
    return 'FRANQUIA';
  }
  // 3) Canais de revenda
  if (/MULTIMARCAS|MTM/.test(op)) return 'MULTIMARCAS';
  if (/ATACADO|B2B|VENDA 1\/2|REVEND/.test(op)) return 'REVENDA/ATACADO';
  if (/PROMOCAO|PROMO/.test(op)) return 'PROMOCAO';
  // 4) Varejo (NFC-E / NF-E varejo)
  if (/VAREJO|NFC-?E/.test(op)) return 'VAREJO';
  // 5) Fallback por nome de empresa
  if (/\b(LTDA|EIRELI|ME|S\.A|MERCANTIL|COMERCIO|CONFECCOES|REPRESENTACOES|MODAS)\b/.test(pn)) {
    return 'REVENDA/ATACADO';
  }
  return 'VAREJO';
}

async function withRetry(fn, label) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fn();
      if (!r.error) return r;
      if (i === 2) console.warn(`  ${label}: ${r.error.message}`);
    } catch (e) {
      if (i === 2) console.warn(`  ${label}: ${e.message}`);
    }
    await new Promise((res) => setTimeout(res, 500 * (i + 1)));
  }
  return { data: null, error: { message: 'falhou após 3 tentativas' } };
}

async function main() {
  const linhas = fs.readFileSync(IN_CSV, 'utf8').split('\n').filter(Boolean);
  const rows = [];
  for (let i = 1; i < linhas.length; i++) {
    const m = linhas[i].match(/^(\d+),"?([^"]*)"?,([^,]+),([^,]+),(\d+)$/);
    if (!m) continue;
    rows.push({
      person_code: m[1],
      person_name: m[2],
      ultima_compra: m[3],
      ultima_compra_king: m[4],
      dias_inativo: +m[5],
    });
  }
  console.log(`📦 ${rows.length} clientes para enriquecer`);

  const personCodes = rows.map((r) => +r.person_code);
  const kingSkus = new Set(
    fs.readFileSync(KING_SKUS_FILE, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean),
  );

  // ───────── 1) Buscar pes_pessoa (Supabase principal) ─────────
  console.log('\n🔎 [1/3] Buscando dados de pes_pessoa (CNPJ/fone/email/UF)...');
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
      `pes_pessoa chunk ${i}`,
    );
    for (const p of r.data || []) pessoasMap.set(p.code, p);
  }
  console.log(`  → ${pessoasMap.size}/${personCodes.length} pessoas encontradas em pes_pessoa`);

  // ───────── 2) Buscar vendedores (Supabase fiscal) ─────────
  console.log('\n🔎 [2/3] Carregando tabela vendedores...');
  const vendedoresMap = new Map();
  const rv = await withRetry(
    () => supabaseFiscal.from('vendedores').select('seller_code,seller_name,person_code,person_name'),
    'vendedores',
  );
  for (const v of rv.data || []) vendedoresMap.set(v.seller_code, v);
  console.log(`  → ${vendedoresMap.size} vendedores carregados`);

  // ───────── 3) Para cada cliente: agregar operation_name, branch_code, dealer_code ─────────
  console.log('\n🔎 [3/3] Agregando NFs por cliente (op/branch/dealer)...');
  const nfDataByPerson = new Map();
  const CONC = 8;
  let done = 0;
  for (let i = 0; i < personCodes.length; i += CONC) {
    const batch = personCodes.slice(i, i + CONC);
    await Promise.all(
      batch.map(async (pc) => {
        // Pega até 50 últimas NFs Output
        const r = await withRetry(
          () =>
            supabaseFiscal
              .from('notas_fiscais')
              .select('operation_name,branch_code,dealer_code,issue_date,items,total_value')
              .eq('operation_type', 'Output')
              .eq('person_code', pc)
              .not('invoice_status', 'eq', 'Canceled')
              .not('invoice_status', 'eq', 'Deleted')
              .order('issue_date', { ascending: false })
              .limit(50),
          `pc=${pc}`,
        );
        const data = r.data || [];
        if (data.length === 0) return;

        const opCount = new Map();
        const branchCountKing = new Map(); // só branches que venderam King
        const branchCountAll = new Map();
        let lastDealer = null;
        for (const nf of data) {
          const op = nf.operation_name || '';
          // ignora ops internos pra escolher dominante
          if (op && !/BONIFICACAO|TRANSF|REMESSA|SUFRAMA|INDUSTRIALIZACAO/i.test(op)) {
            opCount.set(op, (opCount.get(op) || 0) + 1);
          }
          if (nf.branch_code) {
            branchCountAll.set(nf.branch_code, (branchCountAll.get(nf.branch_code) || 0) + 1);
            // Detecta se essa NF contém King
            const items = Array.isArray(nf.items) ? nf.items : [];
            let hasKing = false;
            for (const it of items) {
              const sku = String(it?.code ?? it?.productCode ?? it?.sku ?? '');
              if (sku && kingSkus.has(sku)) { hasKing = true; break; }
              const products = Array.isArray(it?.products) ? it.products : [];
              for (const p of products) {
                const pSku = String(p?.productCode ?? p?.sku ?? p?.code ?? '');
                if (pSku && kingSkus.has(pSku)) { hasKing = true; break; }
              }
              if (hasKing) break;
            }
            if (hasKing) {
              branchCountKing.set(nf.branch_code, (branchCountKing.get(nf.branch_code) || 0) + 1);
            }
          }
          if (lastDealer === null && nf.dealer_code) lastDealer = nf.dealer_code;
        }
        // Pega dominante (maior count)
        let dominantOp = '';
        let maxOp = 0;
        for (const [op, c] of opCount) if (c > maxOp) { maxOp = c; dominantOp = op; }
        if (!dominantOp) {
          // se não achou (todos internos), pega qualquer
          dominantOp = data[0]?.operation_name || '';
        }
        let dominantBranch = null;
        let maxBranch = 0;
        for (const [b, c] of branchCountKing) if (c > maxBranch) { maxBranch = c; dominantBranch = b; }
        // se não tem King nessas 50 NFs, usa branch geral
        if (!dominantBranch) {
          for (const [b, c] of branchCountAll) if (c > maxBranch) { maxBranch = c; dominantBranch = b; }
        }
        nfDataByPerson.set(pc, { dominantOp, dominantBranch, lastDealer });
      }),
    );
    done += batch.length;
    if (done % 50 === 0 || done === personCodes.length) console.log(`  → ${done}/${personCodes.length}`);
  }

  // ───────── 4) Montar resultado final ─────────
  const enriched = rows.map((r) => {
    const pc = +r.person_code;
    const pp = pessoasMap.get(pc) || {};
    const nfd = nfDataByPerson.get(pc) || {};
    const vend = nfd.lastDealer ? vendedoresMap.get(nfd.lastDealer) : null;
    const categoria = classificar(nfd.dominantOp, r.person_name);
    return {
      ...r,
      categoria,
      operation_dominante: nfd.dominantOp || '',
      cpf_cnpj: pp.cpf || '',
      tipo_pessoa: pp.tipo_pessoa || '',
      fantasy_name: pp.fantasy_name || '',
      uf: pp.uf || '',
      telefone: pp.telefone || '',
      email: pp.email || '',
      filial_vendedora: nfd.dominantBranch || '',
      vendedor_codigo: nfd.lastDealer || '',
      vendedor_nome: vend?.seller_name || vend?.person_name || '',
    };
  });

  // Resumo
  const porCategoria = new Map();
  for (const r of enriched) porCategoria.set(r.categoria, (porCategoria.get(r.categoria) || 0) + 1);
  console.log('\n📊 CATEGORIA:');
  for (const [cat, cnt] of [...porCategoria.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat.padEnd(20)} ${String(cnt).padStart(4)}`);
  }

  const comCnpj = enriched.filter((r) => r.cpf_cnpj).length;
  const comFone = enriched.filter((r) => r.telefone).length;
  const comEmail = enriched.filter((r) => r.email).length;
  const comVend = enriched.filter((r) => r.vendedor_nome).length;
  console.log(`\n📋 CAMPOS PREENCHIDOS:`);
  console.log(`  CPF/CNPJ:            ${comCnpj}/${enriched.length}  (${(comCnpj / enriched.length * 100).toFixed(0)}%)`);
  console.log(`  Telefone:            ${comFone}/${enriched.length}  (${(comFone / enriched.length * 100).toFixed(0)}%)`);
  console.log(`  Email:               ${comEmail}/${enriched.length}  (${(comEmail / enriched.length * 100).toFixed(0)}%)`);
  console.log(`  Vendedor identifc.:  ${comVend}/${enriched.length}  (${(comVend / enriched.length * 100).toFixed(0)}%)`);

  // Top filiais que venderam King pra inativos
  const filialPorKing = new Map();
  for (const r of enriched) {
    if (r.filial_vendedora) filialPorKing.set(r.filial_vendedora, (filialPorKing.get(r.filial_vendedora) || 0) + 1);
  }
  console.log('\n🏪 TOP 10 FILIAIS QUE VENDERAM KING (inativos):');
  for (const [b, c] of [...filialPorKing.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  Filial ${String(b).padStart(4)}  →  ${c} clientes inativos`);
  }

  // Top vendedores
  const vendPorInativos = new Map();
  for (const r of enriched) {
    if (r.vendedor_nome) vendPorInativos.set(r.vendedor_nome, (vendPorInativos.get(r.vendedor_nome) || 0) + 1);
  }
  console.log('\n👤 TOP 10 VENDEDORES com mais inativos:');
  for (const [v, c] of [...vendPorInativos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${v.slice(0, 35).padEnd(35)}  →  ${c}`);
  }

  // Salva
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const out = [
    'person_code,person_name,categoria,operation_dominante,cpf_cnpj,tipo_pessoa,fantasy_name,uf,telefone,email,filial_vendedora,vendedor_codigo,vendedor_nome,ultima_compra,ultima_compra_king,dias_inativo',
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
      ].join(','),
    ),
  ].join('\n');
  fs.writeFileSync(OUT_CSV, out, 'utf8');
  console.log(`\n💾 CSV salvo: ${OUT_CSV}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('💥 Erro fatal:', err);
    process.exit(1);
  });
