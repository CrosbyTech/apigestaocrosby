import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';

const BNB_DIR = path.resolve(__dirname, '..', '..', 'EXTRATO NOVEMBRO', 'BNB');

function listPdfFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    throw new Error(`Diretório não encontrado: ${dirPath}`);
  }
  const files = fs.readdirSync(dirPath);
  return files
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .map((f) => path.join(dirPath, f));
}

async function parsePdf(filePath) {
  const dataBuffer = new Uint8Array(fs.readFileSync(filePath));
  const loadingTask = pdfjsLib.getDocument({ data: dataBuffer });
  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;
  let fullText = '';
  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((it) => it.str).join(' ');
    fullText += pageText + '\n';
  }
  return fullText;
}

// Heurística inicial para BNB:
// Extratos costumam trazer colunas de Data, Histórico, Documento, Valor, Saldo
function extractTransactionsFromText(text) {
  const transactions = [];
  const pattern = /(\d{2}\/\d{2}\/\d{4})(?:[^\n]*?)(-?\s?(?:R\$\s?)?[0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2})(?:[^\n]*?)(-?\s?(?:R\$\s?)?[0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2})?/g;

  const normalizeMoney = (s) => s
    .replace(/R\$\s?/i, '')
    .replace(/\s+/g, '')
    .trim();

  let match;
  while ((match = pattern.exec(text)) !== null) {
    const date = match[1];
    const valueFull = match[2];
    const saldoFull = match[3] || null;

    const valueStr = normalizeMoney(valueFull);
    const saldoStr = saldoFull ? normalizeMoney(saldoFull) : null;
    const isDebit = /^-/.test(valueStr);
    const type = isDebit ? 'DEBITO' : 'CREDITO';

    const sliceStart = Math.max(0, match.index);
    const sliceEnd = sliceStart + (match[0] ? match[0].length : 0);
    const whole = text.substring(sliceStart, sliceEnd);

    const history = whole
      .replace(date, '')
      .replace(valueFull, '')
      .replace(saldoFull || '', '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    transactions.push({ date, history, value: valueStr, saldo: saldoStr, type, raw: whole });
  }

  return transactions;
}

export async function processBNBExtracts() {
  const pdfFiles = listPdfFiles(BNB_DIR);
  const results = [];

  for (const file of pdfFiles) {
    try {
      const text = await parsePdf(file);
      const txs = extractTransactionsFromText(text);
      results.push({ file, text, transactions: txs });
    } catch (err) {
      console.error(`Erro ao processar ${file}:`, err.message);
    }
  }

  return results;
}

export { extractTransactionsFromText };
