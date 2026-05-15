import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { PDFParse } = require('pdf-parse');

const buffer = fs.readFileSync('C:/Users/teccr/Downloads/FATURA CLARO PB.pdf');
const parser = new PDFParse({ data: buffer });
const result = await parser.getText();
const t = result.text;

// Buscar todas ocorrências de TOTAL PARA CADA CELULAR e mostrar 500 chars antes/depois
let i = -1;
let count = 0;
while ((i = t.indexOf('TOTAL PARA CADA CELULAR', i + 1)) !== -1 && count < 3) {
  count++;
  console.log(`\n=== Match #${count} at ${i} ===`);
  console.log('--- ANTES ---');
  console.log(t.slice(Math.max(0, i - 800), i));
  console.log('--- DEPOIS ---');
  console.log(t.slice(i, i + 200));
}
