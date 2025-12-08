import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BRADESCO_DIR = path.resolve(__dirname, '../../EXTRATO NOVEMBRO/BRADESCO');

function listPdfFiles(folderPath) {
  if (!fs.existsSync(folderPath)) return [];
  return fs
    .readdirSync(folderPath)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .map((f) => path.join(folderPath, f));
}

async function parsePdf(filePath) {
  const loadingTask = pdfjsLib.getDocument({ url: filePath });
  const pdf = await loadingTask.promise;
  let text = '';
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const pageText = content.items.map((it) => it.str).join(' ');
    text += `\n${pageText}`;
  }
  return text;
}

function normalizeValue(raw) {
  if (!raw) return null;
  const cleaned = raw.replace(/R\$\s?/i, '').replace(/\./g, '').replace(/,/g, '.');
  const num = Number(cleaned.replace(/[^0-9\-\.]/g, ''));
  return Number.isFinite(num) ? num : null;
}

function normalizeDate(raw) {
  // Expect dd/MM/yyyy or dd/MM
  const m = raw.match(/(\d{2})\/(\d{2})(?:\/(\d{4}))?/);
  if (!m) return raw;
  const [_, dd, mm, yyyy] = m;
  const year = yyyy || new Date().getFullYear();
  return `${year}-${mm}-${dd}`; // ISO-like for consistency
}

function extractTransactionsFromText(text) {
  const dateRegex = /(\b\d{2}\/\d{2}(?:\/\d{4})?\b)/g;
  const moneyRegex = /R\$\s?-?[0-9\.]+,[0-9]{2}|-?[0-9\.]+,[0-9]{2}/g;
  const skipPatterns = [/^extrato/i, /^agência/i, /^total\s+disponível/i, /^data\s+lançamento/i];

  // Segmentar o texto por ocorrências de data, para simular linhas
  const segments = [];
  let match;
  const indices = [];
  while ((match = dateRegex.exec(text)) !== null) {
    indices.push({ index: match.index, token: match[0] });
  }
  for (let i = 0; i < indices.length; i++) {
    const start = indices[i].index;
    const end = i + 1 < indices.length ? indices[i + 1].index : text.length;
    const seg = text.substring(start, end).replace(/\s{2,}/g, ' ').trim();
    if (seg) segments.push(seg);
  }

  const transactions = [];
  for (const seg of segments) {
    if (skipPatterns.some((p) => p.test(seg))) continue;
    const singleDate = seg.match(/\b\d{2}\/\d{2}(?:\/\d{4})?/);
    if (!singleDate) continue;

    const values = seg.match(moneyRegex) || [];
    // Precisamos de ao menos um valor para considerar movimento
    if (values.length === 0) continue;

    // saldo costuma ser o último valor na linha; valor de movimento o penúltimo
    const saldoRaw = values.length >= 2 ? values[values.length - 1] : null;
    const valorRaw = values.length >= 2 ? values[values.length - 2] : values[0];

    // corpo sem data e valores principais
    let body = seg
      .replace(singleDate[0], '')
      .replace(saldoRaw || '', '')
      .replace(valorRaw || '', '')
      .trim();

    // remover tokens comuns de coluna
    body = body.replace(/\bDcto\.?\b|\bCrédito\b|\bDébito\b|\bSaldo\b/gi, '').trim();

    const docMatch = body.match(/\b\d{6,}\b/);
    const documento = docMatch ? docMatch[0] : null;
    const descricao = body.replace(documento || '', '').trim();

    // Ignorar "Saldo Anterior" caso apareça como segmento
    if (/^saldo\s+anterior/i.test(descricao)) continue;

    transactions.push({
      data: normalizeDate(singleDate[0]),
      descricao,
      documento,
      valor: normalizeValue(valorRaw),
      saldo: normalizeValue(saldoRaw),
      linha: seg,
    });
  }

  return transactions;
}

export async function processBradescoExtracts() {
  const files = listPdfFiles(BRADESCO_DIR);
  const results = [];
  for (const file of files) {
    try {
      const text = await parsePdf(file);
      const transactions = extractTransactionsFromText(text);
      results.push({ file, text, transactions });
    } catch (err) {
      results.push({ file, error: err.message });
    }
  }
  return results;
}
