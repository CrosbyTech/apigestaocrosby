import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';

const ITAU_DIR = path.resolve(__dirname, '..', '..', 'EXTRATO NOVEMBRO', 'ITAU');

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

// Heurística para ITAÚ: linhas de extrato com Data e Valor em formato brasileiro
// Ex.: 01/11/2025 ... R$ 123,45 ou - R$ 123,45
function extractTransactionsFromText(text) {
  const transactions = [];
  // Valor pode aparecer como "-R$ 34,98" ou "5.000,00" (sem R$) na coluna Valor (R$).
  const pattern = /(\d{2}\/\d{2}\/\d{4})(?:[^\n]*?)(-?\s?(?:R\$\s?)?[0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2})(?:[^\n]*?)(-?\s?(?:R\$\s?)?[0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2})?/g;

  let match;
  while ((match = pattern.exec(text)) !== null) {
    const date = match[1];
    const valueFull = match[2];
    const saldoFull = match[3] || null; // algumas linhas têm saldo na mesma linha

    const normalizeMoney = (s) => s
      .replace(/R\$\s?/i, '')
      .replace(/\s+/g, '')
      .trim();

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

export async function processItauExtracts() {
  const pdfFiles = listPdfFiles(ITAU_DIR);
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
