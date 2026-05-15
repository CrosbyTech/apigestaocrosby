// Importa chips/números das faturas Claro de vários estados.
//   - Lê PDF, extrai blocos "VALOR DE COBRANÇAS POR CELULAR..."
//   - Em cada bloco: encontra números (XX) XXXXX XXXX e o
//     "TOTAL PARA CADA CELULAR" com valores R$ em sequência
//   - Insere/upsert na tabela tech_chips
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
const require = createRequire(import.meta.url);
const { PDFParse } = require('pdf-parse');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
import pg from 'pg';

const DOWNLOADS = 'C:/Users/teccr/Downloads';
const FILES = [
  { uf: 'RN', file: 'FATURA CLARO RN.pdf' },
  { uf: 'PI', file: 'FATURA CLARO PI.pdf' },
  { uf: 'PA', file: 'FATURA CLARO PA.pdf' },
  { uf: 'MT', file: 'FATURA CLARO MT.pdf' },
  { uf: 'MA', file: 'FATURA CLARO MA.pdf' },
  { uf: 'BA', file: 'FATURA CLARO BA.pdf' },
  { uf: 'CE', file: 'FATURA CLARO CE.pdf' },
  { uf: 'PE', file: 'FATURA CLARO PE.pdf' },
  { uf: 'PB', file: 'FATURA CLARO PB.pdf' },
];

const PHONE_REGEX = /\((\d{2})\)\s*(\d{4,5})\s*(\d{4})/g;
const TOTAL_LINE_REGEX = /TOTAL\s+PARA\s+CADA\s+CELULAR((?:\s*R\$\s*[\d.,-]+)+)/g;
const RS_REGEX = /R\$\s*([\d.]+,\d{2}|[\d]+,\d{2}|-)/g;

function parseBR(numStr) {
  if (!numStr || numStr === '-') return 0;
  const clean = String(numStr).trim().replace(/\./g, '').replace(',', '.');
  return Number(clean) || 0;
}

// Extrai pares { numero, valor } iterando "BLOCOS DE COBRANÇAS POR CELULAR..."
function extrairChipsDoTexto(text) {
  // O texto tem N blocos. Cada bloco começa com header "VALOR DE COBRANÇAS POR CELULAR..."
  // e termina antes do próximo header (ou final do doc).
  const blocks = text.split(/VALOR DE COBRANÇAS POR CELULAR[^\n]*/);
  // O primeiro elemento antes do primeiro header é descartado (introdução/plano geral)
  blocks.shift();

  const chips = [];

  for (const block of blocks) {
    // Pega todos os números do bloco na ordem
    const numeros = [];
    PHONE_REGEX.lastIndex = 0;
    let m;
    while ((m = PHONE_REGEX.exec(block)) !== null) {
      numeros.push(`(${m[1]}) ${m[2]}-${m[3]}`);
    }
    if (numeros.length === 0) continue;

    // Pega linha "TOTAL PARA CADA CELULAR" do bloco
    TOTAL_LINE_REGEX.lastIndex = 0;
    const totalMatch = TOTAL_LINE_REGEX.exec(block);
    if (!totalMatch) continue;
    const totalStr = totalMatch[1];

    // Extrai todos os R$ em sequência
    const valores = [];
    RS_REGEX.lastIndex = 0;
    let mv;
    while ((mv = RS_REGEX.exec(totalStr)) !== null) {
      valores.push(parseBR(mv[1]));
    }

    // Casa numeros[i] com valores[i] (alguns blocos podem ter números a mais — pega o min)
    const n = Math.min(numeros.length, valores.length);
    for (let i = 0; i < n; i++) {
      chips.push({ numero: numeros[i], valor: valores[i] });
    }
  }

  return chips;
}

async function processarPDF(file, uf) {
  const full = path.join(DOWNLOADS, file);
  if (!fs.existsSync(full)) return { uf, chips: [], erro: 'arquivo não encontrado' };
  const buffer = fs.readFileSync(full);
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  const chips = extrairChipsDoTexto(result.text);
  return { uf, chips };
}

const c = new pg.Client({
  host: process.env.SUPABASE_DB_HOST,
  port: 5432,
  user: process.env.SUPABASE_DB_USER,
  password: process.env.SUPABASE_DB_PASSWORD,
  database: process.env.SUPABASE_DB_NAME,
  ssl: { rejectUnauthorized: false },
});

try {
  await c.connect();
  let totalInserido = 0;
  let totalAtualizado = 0;
  let totalSkipDup = 0;
  let totalGlobal = 0;

  for (const { uf, file } of FILES) {
    const r = await processarPDF(file, uf);
    console.log(`\n📱 ${uf} (${file}) — ${r.chips.length} chips encontrados`);
    if (r.erro) { console.log(`  ERRO: ${r.erro}`); continue; }
    for (const ch of r.chips) {
      const numeroClean = ch.numero.replace(/\D/g, '');
      // Upsert: se já existe (numero_clean), só atualiza valor_plano + uf no local_uso
      const { rows: ex } = await c.query(
        'SELECT id, valor_plano FROM tech_chips WHERE numero_clean = $1',
        [numeroClean],
      );
      if (ex.length > 0) {
        await c.query(
          `UPDATE tech_chips SET valor_plano = $1, atualizado_em = NOW(), atualizado_por = 'import-fatura-claro' WHERE id = $2`,
          [ch.valor, ex[0].id],
        );
        totalAtualizado += 1;
      } else {
        try {
          await c.query(
            `INSERT INTO tech_chips (numero, numero_clean, operadora, status, valor_plano, local_uso, criado_por, atualizado_por)
             VALUES ($1, $2, 'claro', 'ativo', $3, $4, 'import-fatura-claro', 'import-fatura-claro')`,
            [ch.numero, numeroClean, ch.valor, `Estado ${uf}`],
          );
          totalInserido += 1;
        } catch (e) {
          console.log(`  SKIP ${ch.numero}: ${e.message}`);
          totalSkipDup += 1;
        }
      }
      totalGlobal += 1;
    }
    // Mostra primeiros 5 chips do estado
    for (const ch of r.chips.slice(0, 5)) {
      console.log(`  ${ch.numero}  R$ ${ch.valor.toFixed(2)}`);
    }
    if (r.chips.length > 5) console.log(`  ... mais ${r.chips.length - 5}`);
  }

  console.log(`\n✅ Resumo:`);
  console.log(`   Total processado: ${totalGlobal}`);
  console.log(`   Inseridos novos: ${totalInserido}`);
  console.log(`   Atualizados (já existiam): ${totalAtualizado}`);
  console.log(`   Pulados (duplicados): ${totalSkipDup}`);

  // Total no banco
  const { rows } = await c.query('SELECT COUNT(*)::int n, COALESCE(SUM(valor_plano),0)::numeric v FROM tech_chips');
  console.log(`\n📊 Tabela tech_chips agora tem ${rows[0].n} chips, total mensal R$ ${Number(rows[0].v).toFixed(2)}`);
} catch (e) {
  console.error('ERR:', e.message);
} finally {
  try { await c.end(); } catch {}
}
