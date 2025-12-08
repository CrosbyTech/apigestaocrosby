import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';

const CAIXA_DIR = path.resolve(__dirname, '..', '..', 'EXTRATO NOVEMBRO', 'CAIXA');

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

// Tentativa simples de parse de movimentações a partir do texto
// Sem conhecer o layout exato do extrato CAIXA, começamos extraindo linhas e
// aplicando heurísticas comuns (data, histórico, valores). Ajustaremos conforme os exemplos.
function extractTransactionsFromText(text) {
  const transactions = [];
  const pattern = /(\d{2}\/\d{2}\/\d{4})(?:[^\n]*?)(R\$\s?-?[0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2})/g;

  let match;
  while ((match = pattern.exec(text)) !== null) {
    const date = match[1];
    const valueFull = match[2];
    const valueStr = valueFull.replace(/^R\$\s?/, '');
    const isDebit = /-\s?R\$/.test(valueFull) || valueStr.startsWith('-');
    const type = isDebit ? 'DEBITO' : 'CREDITO';

    // Para histórico, pegamos a janela entre o início da data e antes do valor
    const sliceStart = Math.max(0, match.index);
    const sliceEnd = sliceStart + Math.max(0, (match[0] || '').length);
    const whole = text.substring(sliceStart, sliceEnd);
    const history = whole
      .replace(date, '')
      .replace(valueFull, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    transactions.push({ date, history, value: valueStr, type, raw: whole });
  }

  return transactions;
}

export async function processCaixaExtracts() {
  const pdfFiles = listPdfFiles(CAIXA_DIR);
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
