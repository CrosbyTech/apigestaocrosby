/**
 * Parser para arquivos do Sicredi (portador 748)
 *
 * Suporta dois formatos:
 *  - CSV  : exportação padrão do Sicredi (fileExport.csv)
 *           Cabeçalho: Nome Pagador;Data Baixa;Data Pagamento;Data Vencimento;
 *                      Nosso Numero;Seu Numero;Valor;Identificacao;...
 *  - Excel: planilha com dados iniciando na linha 17 (0-based = 16)
 *           Cabeçalho: Cart;Nº Doc;Nosso Nº;TXID;Pagador;Data Vencimento;
 *                      Data Liquidação;Valor (R$);Liquidação (R$);Situação do Boleto;Motivo
 *
 * Encoding CSV esperado: UTF-8 (com ou sem BOM)
 */

import * as XLSX from 'xlsx';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseValorBR(val) {
  if (!val && val !== 0) return 0;
  const s = String(val)
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .replace(/\./g, '')
    .replace(',', '.');
  return parseFloat(s) || 0;
}

function parseDataBR(val) {
  if (!val) return null;
  const s = String(val)
    .trim()
    .replace(/^"(.*)"$/, '$1');
  // DD/MM/YYYY
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  // YYYY-MM-DD (já normalizado)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

function parseExcelDate(val) {
  if (!val) return null;
  // Se for número serial do Excel
  if (typeof val === 'number') {
    const jsDate = XLSX.SSF.parse_date_code(val);
    if (jsDate) {
      const y = jsDate.y;
      const m = String(jsDate.m).padStart(2, '0');
      const d = String(jsDate.d).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    return null;
  }
  return parseDataBR(String(val));
}

function stripQuotes(val) {
  if (!val) return '';
  return String(val)
    .trim()
    .replace(/^"(.*)"$/, '$1');
}

function parseLine(line) {
  return line.split(';').map((f) => f.trim());
}

/**
 * Extrai CPF/CNPJ do campo "Identificacao" do CSV ou do campo "Pagador" do Excel.
 * O campo pode conter: "53661116000308" (limpo) ou "43.199.386 NOME..." (parte do nome).
 */
function parseCpfCnpj(val) {
  if (!val) return '';
  const s = String(val)
    .trim()
    .replace(/^"(.*)"$/, '$1');
  // Tenta extrair sequência de dígitos
  const digits = s.replace(/[^\d]/g, '');
  if (digits.length >= 11) return digits;
  return digits;
}

/**
 * Extrai nr_fatura e nr_parcela de string como "852456/001"
 */
function parseSeuNumero(val) {
  if (!val) return { nr_fatura: '', nr_parcela: '' };
  const s = stripQuotes(val);
  const m = s.match(/^(\d+)\/(\d+)$/);
  if (m) return { nr_fatura: m[1], nr_parcela: m[2] };
  return { nr_fatura: s, nr_parcela: '' };
}

// ─── Detecção de formato ──────────────────────────────────────────────────────

function isExcelBuffer(buf) {
  // XLS: D0 CF 11 E0  |  XLSX (ZIP): 50 4B 03 04
  if (buf.length < 4) return false;
  return (
    (buf[0] === 0xd0 &&
      buf[1] === 0xcf &&
      buf[2] === 0x11 &&
      buf[3] === 0xe0) ||
    (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04)
  );
}

// ─── Parser CSV ───────────────────────────────────────────────────────────────

function parseSicrediCSV(fileContent) {
  // Remove BOM se existir
  const content = fileContent.replace(/^\uFEFF/, '');
  const lines = content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim());

  if (lines.length < 2) {
    throw new Error('Arquivo CSV Sicredi inválido ou vazio');
  }

  const rawHeader = parseLine(lines[0]);
  const header = rawHeader.map((h) => stripQuotes(h).toLowerCase().trim());

  // Mapear índices pelas colunas conhecidas
  const idx = {
    nomePagador: header.findIndex(
      (h) => h.includes('nome pagador') || h.includes('nome_pagador'),
    ),
    dataBaixa: header.findIndex(
      (h) => h.includes('data baixa') || h.includes('data_baixa'),
    ),
    dataPagamento: header.findIndex(
      (h) => h.includes('data pagamento') || h.includes('data_pagamento'),
    ),
    dataVencimento: header.findIndex(
      (h) => h.includes('data vencimento') || h.includes('data_vencimento'),
    ),
    nossoNumero: header.findIndex(
      (h) => h.includes('nosso numero') || h.includes('nosso_numero'),
    ),
    seuNumero: header.findIndex(
      (h) => h.includes('seu numero') || h.includes('seu_numero'),
    ),
    valor: header.findIndex((h) => h === 'valor' || h === 'vlr'),
    identificacao: header.findIndex(
      (h) =>
        h.includes('identificacao') ||
        h.includes('identificação') ||
        h.includes('cpf') ||
        h.includes('cnpj'),
    ),
  };

  // Fallback para posições fixas se não encontrar pelos nomes
  if (idx.nomePagador < 0) idx.nomePagador = 0;
  if (idx.dataBaixa < 0) idx.dataBaixa = 1;
  if (idx.dataPagamento < 0) idx.dataPagamento = 2;
  if (idx.dataVencimento < 0) idx.dataVencimento = 3;
  if (idx.nossoNumero < 0) idx.nossoNumero = 4;
  if (idx.seuNumero < 0) idx.seuNumero = 5;
  if (idx.valor < 0) idx.valor = 6;
  if (idx.identificacao < 0) idx.identificacao = 7;

  const registros = [];
  let countLiquidado = 0;
  let countAberto = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i]);
    if (cols.length < 7) continue;

    const dtPagamento = parseDataBR(cols[idx.dataPagamento]);
    const isPago = !!dtPagamento;

    if (isPago) countLiquidado++;
    else countAberto++;

    const seuNumero = stripQuotes(cols[idx.seuNumero] ?? '');
    const { nr_fatura, nr_parcela } = parseSeuNumero(seuNumero);
    const valor = parseValorBR(cols[idx.valor]);

    registros.push({
      nosso_numero: stripQuotes(cols[idx.nossoNumero] ?? ''),
      seu_numero: seuNumero,
      nr_fatura,
      nr_parcela,
      nr_cpfcnpj: parseCpfCnpj(cols[idx.identificacao]),
      nm_cliente: stripQuotes(cols[idx.nomePagador] ?? ''),
      vl_original: valor,
      vl_pago: isPago ? valor : 0,
      dt_vencimento: parseDataBR(cols[idx.dataVencimento]),
      dt_pagamento: dtPagamento,
      situacao: isPago ? 'LIQUIDADO' : 'ABERTO',
      descricao_baixa: '',
      banco: 'SICREDI',
    });
  }

  const tipoArquivo =
    countLiquidado > 0 && countAberto > 0
      ? 'MISTO'
      : countLiquidado > 0
        ? 'LIQUIDADO'
        : 'ABERTO';

  const valorTotalPago = registros.reduce((s, r) => s + (r.vl_pago || 0), 0);
  const valorTotalOriginal = registros.reduce(
    (s, r) => s + (r.vl_original || 0),
    0,
  );

  return {
    registros,
    stats: {
      totalRegistros: registros.length,
      valorTotalPago,
      valorTotalOriginal,
      tipoArquivo,
    },
  };
}

// ─── Parser Excel (XLS/XLSX) ──────────────────────────────────────────────────

function parseSicrediExcel(fileBuffer) {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer', cellDates: false });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Converter em array de arrays para manipulação manual
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  // Encontrar a linha de cabeçalho (busca por "Nosso Nº" ou "Nº Doc")
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const rowStr = rows[i].map((c) => String(c).toLowerCase()).join('|');
    if (
      rowStr.includes('nosso') ||
      rowStr.includes('nº doc') ||
      rowStr.includes('pagador')
    ) {
      headerRowIdx = i;
      break;
    }
  }

  if (headerRowIdx < 0) {
    throw new Error('Cabeçalho não encontrado no arquivo Excel Sicredi');
  }

  const rawHeader = rows[headerRowIdx].map((h) =>
    String(h).toLowerCase().trim(),
  );

  const idx = {
    nossoNumero: rawHeader.findIndex((h) => h.includes('nosso')),
    nrDoc: rawHeader.findIndex(
      (h) => h.includes('nº doc') || h.includes('nr doc') || h.includes('seu'),
    ),
    pagador: rawHeader.findIndex((h) => h.includes('pagador')),
    dataVencimento: rawHeader.findIndex((h) => h.includes('vencimento')),
    dataLiquidacao: rawHeader.findIndex(
      (h) => h.includes('liquidaç') || h.includes('liquidacao'),
    ),
    valor: rawHeader.findIndex(
      (h) =>
        h.includes('valor') &&
        !h.includes('liquidaç') &&
        !h.includes('liquidacao'),
    ),
    valorLiquidacao: rawHeader.findIndex(
      (h) =>
        h.includes('valor') &&
        (h.includes('liquidaç') || h.includes('liquidacao')),
    ),
    situacao: rawHeader.findIndex(
      (h) => h.includes('situaç') || h.includes('situacao'),
    ),
  };

  // Fallback para posições típicas do layout Sicredi (cabeçalho na linha 17)
  // Cart;Nº Doc;Nosso Nº;TXID;Pagador;Data Vencimento;Data Liquidação;Valor (R$);Liquidação (R$);Situação do Boleto;Motivo
  if (idx.nrDoc < 0) idx.nrDoc = 1;
  if (idx.nossoNumero < 0) idx.nossoNumero = 2;
  if (idx.pagador < 0) idx.pagador = 4;
  if (idx.dataVencimento < 0) idx.dataVencimento = 5;
  if (idx.dataLiquidacao < 0) idx.dataLiquidacao = 6;
  if (idx.valor < 0) idx.valor = 7;
  if (idx.valorLiquidacao < 0) idx.valorLiquidacao = 8;
  if (idx.situacao < 0) idx.situacao = 9;

  const registros = [];
  let countLiquidado = 0;
  let countAberto = 0;

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => String(c).trim() === '')) continue;

    const nossoNumero = String(row[idx.nossoNumero] ?? '').trim();
    if (!nossoNumero) continue; // linha vazia / totalizador

    const situacaoRaw = String(row[idx.situacao] ?? '')
      .trim()
      .toUpperCase();
    const isPago =
      situacaoRaw.includes('LIQUI') ||
      situacaoRaw.includes('PAGO') ||
      situacaoRaw.includes('QUITADO') ||
      (row[idx.dataLiquidacao] !== '' && row[idx.dataLiquidacao] != null);

    if (isPago) countLiquidado++;
    else countAberto++;

    const nrDocRaw = String(row[idx.nrDoc] ?? '').trim();
    const { nr_fatura, nr_parcela } = parseSeuNumero(nrDocRaw);
    const pagadorRaw = String(row[idx.pagador] ?? '').trim();
    const valor = parseValorBR(String(row[idx.valor] ?? '0'));

    // CPF/CNPJ: tirar do campo pagador (ex: "XX.XXX.XXX/XXXX-XX NOME" ou "XXX.XXX.XXX-XX NOME")
    const cpfCnpjMatch = pagadorRaw.match(/^([\d\.\-\/]+)\s/);
    const nr_cpfcnpj = cpfCnpjMatch
      ? cpfCnpjMatch[1].replace(/[^\d]/g, '')
      : '';

    const nm_cliente =
      pagadorRaw.replace(/^[\d\.\-\/]+\s*/, '').trim() || pagadorRaw;

    registros.push({
      nosso_numero: nossoNumero,
      seu_numero: nrDocRaw,
      nr_fatura,
      nr_parcela,
      nr_cpfcnpj,
      nm_cliente,
      vl_original: valor,
      vl_pago: isPago
        ? parseValorBR(String(row[idx.valorLiquidacao] ?? '0')) || valor
        : 0,
      dt_vencimento: parseExcelDate(row[idx.dataVencimento]),
      dt_pagamento: isPago ? parseExcelDate(row[idx.dataLiquidacao]) : null,
      situacao: isPago ? 'LIQUIDADO' : 'ABERTO',
      descricao_baixa: '',
      banco: 'SICREDI',
    });
  }

  const tipoArquivo =
    countLiquidado > 0 && countAberto > 0
      ? 'MISTO'
      : countLiquidado > 0
        ? 'LIQUIDADO'
        : 'ABERTO';

  const valorTotalPago = registros.reduce((s, r) => s + (r.vl_pago || 0), 0);
  const valorTotalOriginal = registros.reduce(
    (s, r) => s + (r.vl_original || 0),
    0,
  );

  return {
    registros,
    stats: {
      totalRegistros: registros.length,
      valorTotalPago,
      valorTotalOriginal,
      tipoArquivo,
    },
  };
}

// ─── Export principal ─────────────────────────────────────────────────────────

export function processSicrediFile(fileBuffer) {
  if (isExcelBuffer(fileBuffer)) {
    return parseSicrediExcel(fileBuffer);
  }
  // Decodifica como UTF-8 (com fallback para latin1)
  let content;
  try {
    content = fileBuffer.toString('utf-8');
    // Verificação simples: se a decodificação UTF-8 produzir muitos caracteres estranhos
    if ((content.match(/\ufffd/g) || []).length > 5) {
      content = fileBuffer.toString('latin1');
    }
  } catch {
    content = fileBuffer.toString('latin1');
  }
  return parseSicrediCSV(content);
}
