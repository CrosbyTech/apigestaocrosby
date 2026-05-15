// Parse PDFs de fatura Claro pra extrair: número + valor do plano
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PDFParse } = require('pdf-parse');

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

for (const { uf, file } of FILES) {
  const full = path.join(DOWNLOADS, file);
  if (!fs.existsSync(full)) {
    console.log(`SKIP ${file} (não existe)`);
    continue;
  }
  const buffer = fs.readFileSync(full);
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  const text = result.text;
  console.log(`\n=== ${uf} (${file}) ===`);
  console.log(`Páginas: ${result.numpages} · ${text.length} chars`);
  // Mostra primeiros 2000 chars + chars 3000-5000 pra ver estrutura
  console.log('--- INÍCIO ---');
  console.log(text.slice(0, 1500));
  console.log('...');
  console.log('--- MEIO (3000-5000) ---');
  console.log(text.slice(3000, 5000));
  console.log('--- DEPOIS (8000-10000) ---');
  console.log(text.slice(8000, 10000));
  break; // só o primeiro pra debug
}
