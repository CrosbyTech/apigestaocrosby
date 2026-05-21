/**
 * Busca clientes que compraram produtos da linha KING (lista de 447 SKUs em
 * promoção) E cuja ÚLTIMA compra foi há 6+ meses (antes de hoje−180 dias).
 *
 * Fluxo:
 *   1. Lê lista de SKUs King (da query do site dryland-promo)
 *   2. Busca NFs (notas_fiscais) onde items[].sku ∈ kingSkus → coleta person_codes
 *   3. Pra cada person_code, busca a NF Output mais recente (qualquer SKU)
 *   4. Filtra os que têm last_purchase < hoje − 180 dias
 *   5. Imprime CSV com: person_code, person_name, last_purchase, dias_inativo
 *
 * Uso: node backend/scripts/king-inativos.mjs
 */
import supabaseFiscal from '../config/supabaseFiscal.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const KING_SKUS_FILE = path.resolve(__dirname, '../../.tmp-test/king-skus.txt');
const DIAS_INATIVO = 180; // 6 meses

async function main() {
  // 1) Lê SKUs King do arquivo
  if (!fs.existsSync(KING_SKUS_FILE)) {
    console.error(`❌ Arquivo ${KING_SKUS_FILE} não existe. Roda primeiro o script de captura.`);
    process.exit(1);
  }
  const skus = fs
    .readFileSync(KING_SKUS_FILE, 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  console.log(`📦 ${skus.length} SKUs King carregados`);

  // 2) Probe estrutura de items[] em uma NF
  const sample = await supabaseFiscal
    .from('notas_fiscais')
    .select('items')
    .eq('operation_type', 'Output')
    .not('items', 'eq', '[]')
    .limit(1);
  if (sample.error) {
    console.error('❌ Erro ao buscar sample:', sample.error.message);
    process.exit(1);
  }
  const sampleItems = sample.data?.[0]?.items;
  if (sampleItems && sampleItems.length > 0) {
    console.log('🔍 Sample items[0]:', JSON.stringify(sampleItems[0]).slice(0, 300));
  }

  // 3) Busca NFs Output que contém algum dos SKUs King.
  // Paginação em chunks de 500 NFs e filtra os items localmente.
  const HOJE = new Date();
  const SEIS_MESES_ATRAS = new Date(HOJE);
  SEIS_MESES_ATRAS.setDate(SEIS_MESES_ATRAS.getDate() - DIAS_INATIVO);
  const seisAtrasIso = SEIS_MESES_ATRAS.toISOString().slice(0, 10);
  console.log(
    `⏳ Filtrando clientes inativos antes de ${seisAtrasIso} (hoje = ${HOJE.toISOString().slice(0, 10)})`,
  );

  const kingSet = new Set(skus.map(String));

  // ─── Estratégia: NFs com SKUs King foram emitidas em algum momento.
  // Vamos buscar SOMENTE NFs ATÉ a data limite (issue_date <= seisAtrasIso).
  // Isso reduz drasticamente o conjunto — afinal queremos clientes que NÃO
  // compraram nos últimos 6 meses.
  // Primeiro: identificar quem comprou KING em algum momento. Depois cruzar.

  // PASSO A: Buscar TODOS person_codes que compraram King (qualquer época)
  // Iteração paginada em notas_fiscais Output
  const personasKing = new Map(); // person_code -> { person_name, last_king_purchase }
  let offset = 0;
  const PAGE = 1000;
  let nfsProcessadas = 0;
  let nfsKing = 0;

  console.log(`\n🔎 PASSO A: Identificando clientes que JÁ compraram King...`);
  while (true) {
    const { data, error } = await supabaseFiscal
      .from('notas_fiscais')
      .select('person_code, person_name, issue_date, items')
      .eq('operation_type', 'Output')
      .not('invoice_status', 'eq', 'Canceled')
      .not('invoice_status', 'eq', 'Deleted')
      .lt('person_code', 100000000)
      .range(offset, offset + PAGE - 1);
    if (error) {
      console.error('❌ Erro na busca:', error.message);
      break;
    }
    if (!data || data.length === 0) break;

    for (const nf of data) {
      nfsProcessadas++;
      const items = Array.isArray(nf.items) ? nf.items : [];
      let hasKing = false;
      for (const it of items) {
        // O SKU pode estar em vários campos. Tentamos cobrir
        const sku = String(it?.sku ?? it?.productCode ?? it?.product_code ?? it?.code ?? '');
        if (sku && kingSet.has(sku)) {
          hasKing = true;
          break;
        }
        // E também buscar dentro de products[] caso seja agrupado
        const products = Array.isArray(it?.products) ? it.products : [];
        for (const p of products) {
          const pSku = String(p?.sku ?? p?.productCode ?? p?.product_code ?? p?.code ?? '');
          if (pSku && kingSet.has(pSku)) {
            hasKing = true;
            break;
          }
        }
        if (hasKing) break;
      }
      if (!hasKing) continue;
      nfsKing++;
      const pc = nf.person_code;
      if (!pc) continue;
      const existing = personasKing.get(pc);
      if (!existing || nf.issue_date > existing.last_king_purchase) {
        personasKing.set(pc, {
          person_name: nf.person_name,
          last_king_purchase: nf.issue_date,
        });
      }
    }

    if (nfsProcessadas % 10000 === 0) {
      console.log(
        `  → ${nfsProcessadas} NFs processadas | ${nfsKing} com King | ${personasKing.size} pessoas`,
      );
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  console.log(
    `✅ PASSO A concluído: ${nfsProcessadas} NFs varridas | ${nfsKing} contêm King | ${personasKing.size} clientes únicos`,
  );

  if (personasKing.size === 0) {
    console.log('Nenhum cliente comprou King — encerrando.');
    return;
  }

  // PASSO B: Pra cada person_code, buscar MAX(issue_date) de QUALQUER compra
  // (não só King). Query per-person com limit(1) order desc — é o único jeito
  // de garantir que pegamos a última NF de cada um (mesmo que seja antiga).
  console.log(`\n🔎 PASSO B: Buscando ÚLTIMA compra de cada cliente...`);
  const personCodes = [...personasKing.keys()];
  const ultimaCompra = new Map(); // person_code -> issue_date
  const CONC = 10; // 10 queries em paralelo
  let done = 0;
  for (let i = 0; i < personCodes.length; i += CONC) {
    const batch = personCodes.slice(i, i + CONC);
    await Promise.all(
      batch.map(async (pc) => {
        const { data, error } = await supabaseFiscal
          .from('notas_fiscais')
          .select('issue_date')
          .eq('operation_type', 'Output')
          .eq('person_code', pc)
          .not('invoice_status', 'eq', 'Canceled')
          .not('invoice_status', 'eq', 'Deleted')
          .order('issue_date', { ascending: false })
          .limit(1);
        if (error) {
          console.warn(`  pc=${pc}: ${error.message}`);
          return;
        }
        if (data && data.length > 0) {
          ultimaCompra.set(pc, data[0].issue_date);
        }
      }),
    );
    done += batch.length;
    if (done % 100 === 0 || done === personCodes.length) {
      console.log(`  → ${done}/${personCodes.length} clientes processados`);
    }
  }
  console.log(`✅ PASSO B: ${ultimaCompra.size} clientes com última compra identificada`);

  // PASSO C: Filtrar inativos 6+ meses
  console.log(`\n🔎 PASSO C: Filtrando inativos 6+ meses (antes de ${seisAtrasIso})...`);
  const inativos = [];
  for (const [pc, info] of personasKing.entries()) {
    const ultima = ultimaCompra.get(pc);
    if (!ultima) continue;
    if (ultima > seisAtrasIso) continue; // ainda ativo
    const diasInativo = Math.floor(
      (HOJE.getTime() - new Date(ultima).getTime()) / (1000 * 60 * 60 * 24),
    );
    inativos.push({
      person_code: pc,
      person_name: info.person_name,
      ultima_compra: ultima,
      ultima_compra_king: info.last_king_purchase,
      dias_inativo: diasInativo,
    });
  }
  // Ordena por dias_inativo asc (menos inativos primeiro)
  inativos.sort((a, b) => a.dias_inativo - b.dias_inativo);
  console.log(`\n📊 RESULTADO: ${inativos.length} clientes King inativos 6+ meses\n`);

  // Imprime amostra
  const HEAD = 30;
  console.log(
    `code | nome                                | última compra | última King   | dias`,
  );
  console.log('─'.repeat(110));
  for (const c of inativos.slice(0, HEAD)) {
    const nome = (c.person_name || '?').slice(0, 35).padEnd(35);
    console.log(
      `${String(c.person_code).padStart(7)} | ${nome} | ${c.ultima_compra} | ${c.ultima_compra_king} | ${c.dias_inativo}d`,
    );
  }
  if (inativos.length > HEAD) console.log(`... e mais ${inativos.length - HEAD} clientes`);

  // Salva CSV
  const csvPath = path.resolve(__dirname, '../../.tmp-test/king-inativos.csv');
  const csv = [
    'person_code,person_name,ultima_compra,ultima_compra_king,dias_inativo',
    ...inativos.map(
      (c) =>
        `${c.person_code},"${(c.person_name || '').replace(/"/g, '""')}",${c.ultima_compra},${c.ultima_compra_king},${c.dias_inativo}`,
    ),
  ].join('\n');
  fs.writeFileSync(csvPath, csv, 'utf8');
  console.log(`\n💾 CSV salvo: ${csvPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('💥 Erro fatal:', err);
    process.exit(1);
  });
