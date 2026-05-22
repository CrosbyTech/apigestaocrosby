/**
 * Enriquece o CSV de King inativos com categoria do cliente (varejo / revenda /
 * multimarcas / franquia / outros) baseado nos operation_names das NFs.
 *
 * Lê: .tmp-test/king-inativos.csv
 * Escreve: .tmp-test/king-inativos-enriquecido.csv
 *
 * Categoria é o operation_name DOMINANTE entre as NFs do cliente, classificado
 * por keywords.
 */
import supabaseFiscal from '../config/supabaseFiscal.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IN_CSV = path.resolve(__dirname, '../../.tmp-test/king-inativos.csv');
const OUT_CSV = path.resolve(__dirname, '../../.tmp-test/king-inativos-enriquecido.csv');

function classificar(operationName, personName) {
  const op = (operationName || '').toUpperCase();
  const pn = (personName || '').toUpperCase();

  // Franquia: nome contém "CROSBY" + LTDA / EIRELI / SHOPPING / FRANQUIA na NF
  if (/CROSBY.*(LTDA|EIRELI|SHOPPING|ME|FRANQUIA|S\.A|MERCANTIL)/.test(pn) || /FRANQUIA/.test(op)) {
    return 'FRANQUIA';
  }
  if (/MULTIMARCAS|MTM/.test(op)) return 'MULTIMARCAS';
  if (/VAREJO|NFC-?E/.test(op)) return 'VAREJO';
  if (/ATACADO|B2B|VENDA 1\/2|REVEND/.test(op)) return 'REVENDA/ATACADO';
  if (/PROMOCAO|PROMO/.test(op)) return 'PROMOCAO';
  if (/BONIFICACAO|TRANSF|REMESSA|SUFRAMA|INDUSTRIALIZACAO/.test(op)) return 'INTERNO/TRANSF';

  // Heurística fallback pelo nome
  if (/\b(LTDA|EIRELI|ME|S\.A|MERCANTIL|COMERCIO|CONFECCOES|REPRESENTACOES|MODAS)\b/.test(pn)) {
    return 'REVENDA/ATACADO';
  }
  return 'VAREJO';
}

async function main() {
  if (!fs.existsSync(IN_CSV)) {
    console.error(`❌ ${IN_CSV} não existe.`);
    process.exit(1);
  }

  const linhas = fs.readFileSync(IN_CSV, 'utf8').split('\n').filter(Boolean);
  const header = linhas[0];
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

  // Para cada person_code: agregar operation_name das suas NFs Output
  const operationsByPerson = new Map(); // pc -> Map<op_name, count>
  const CONC = 8;
  let done = 0;
  for (let i = 0; i < personCodes.length; i += CONC) {
    const batch = personCodes.slice(i, i + CONC);
    await Promise.all(
      batch.map(async (pc) => {
        // Pega todas as NFs Output (limitado a 50 mais recentes) com retry
        let data = null;
        let error = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          const r = await supabaseFiscal
            .from('notas_fiscais')
            .select('operation_name, total_value')
            .eq('operation_type', 'Output')
            .eq('person_code', pc)
            .not('invoice_status', 'eq', 'Canceled')
            .not('invoice_status', 'eq', 'Deleted')
            .order('issue_date', { ascending: false })
            .limit(50);
          if (!r.error) { data = r.data; error = null; break; }
          error = r.error;
          await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
        }
        if (error) {
          console.warn(`  pc=${pc} FALHOU após 3 tentativas: ${error.message}`);
          return;
        }
        const opMap = new Map();
        for (const nf of data || []) {
          const op = nf.operation_name || 'SEM_OPERACAO';
          const cur = opMap.get(op) || { count: 0, value: 0 };
          cur.count += 1;
          cur.value += nf.total_value || 0;
          opMap.set(op, cur);
        }
        operationsByPerson.set(pc, opMap);
      }),
    );
    done += batch.length;
    if (done % 50 === 0 || done === personCodes.length) {
      console.log(`  → ${done}/${personCodes.length}`);
    }
  }

  // Para cada cliente: pegar operation DOMINANTE (por count primário, value secundário)
  // e classificar
  const enriched = rows.map((r) => {
    const opMap = operationsByPerson.get(+r.person_code) || new Map();
    let dominant = '';
    let maxCount = 0;
    let maxValue = 0;
    for (const [op, info] of opMap.entries()) {
      // Ignora ops internos pra escolher dominante
      if (/BONIFICACAO|TRANSF|REMESSA|SUFRAMA|INDUSTRIALIZACAO/i.test(op)) continue;
      if (info.count > maxCount || (info.count === maxCount && info.value > maxValue)) {
        maxCount = info.count;
        maxValue = info.value;
        dominant = op;
      }
    }
    // Se ninguém qualificou, pega qualquer op (mais frequente)
    if (!dominant) {
      for (const [op, info] of opMap.entries()) {
        if (info.count > maxCount) {
          maxCount = info.count;
          dominant = op;
        }
      }
    }
    const categoria = classificar(dominant, r.person_name);
    return { ...r, operation_dominante: dominant, categoria };
  });

  // Resumo por categoria
  const porCategoria = new Map();
  for (const r of enriched) {
    porCategoria.set(r.categoria, (porCategoria.get(r.categoria) || 0) + 1);
  }
  console.log('\n📊 DISTRIBUIÇÃO POR CATEGORIA:');
  for (const [cat, cnt] of [...porCategoria.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat.padEnd(20)} ${String(cnt).padStart(4)}  (${((cnt / enriched.length) * 100).toFixed(1)}%)`);
  }

  // Amostra
  console.log('\n📋 AMOSTRA POR CATEGORIA:');
  for (const cat of porCategoria.keys()) {
    console.log(`\n── ${cat} ──`);
    const exemplos = enriched.filter((r) => r.categoria === cat).slice(0, 5);
    for (const r of exemplos) {
      const nome = (r.person_name || '').slice(0, 40).padEnd(40);
      console.log(`  ${String(r.person_code).padStart(7)} | ${nome} | ${r.operation_dominante.slice(0, 35)}`);
    }
  }

  // Salva CSV enriquecido
  const out = [
    'person_code,person_name,categoria,operation_dominante,ultima_compra,ultima_compra_king,dias_inativo',
    ...enriched.map(
      (r) =>
        `${r.person_code},"${(r.person_name || '').replace(/"/g, '""')}","${r.categoria}","${(r.operation_dominante || '').replace(/"/g, '""')}",${r.ultima_compra},${r.ultima_compra_king},${r.dias_inativo}`,
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
