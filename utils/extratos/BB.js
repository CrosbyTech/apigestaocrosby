/**
 * Parser para arquivos Excel do Banco do Brasil (batida de carteira)
 * Processa planilhas Excel de títulos em aberto/cobrança
 *
 * Estrutura do arquivo Excel:
 * - Linha 0: Cabeçalho das colunas
 * - Linhas 1+: Dados dos títulos
 *
 * Colunas:
 * - Nosso número (ex: "36837760000000036-8")
 * - Nome pagador (truncado ~20 chars, pode ter CNPJ prefixado)
 * - Nro beneficiário (formato: "000000/000" - fatura/parcela)
 * - Valor
 * - Vencimento (serial date do Excel)
 * - Situação (ex: "Normal *")
 */

import XLSX from 'xlsx';

/**
 * Converte data serial do Excel ou string DD/MM/YYYY para ISO (YYYY-MM-DD)
 * @param {number|string} dataExcel - Data serial do Excel ou string
 * @returns {string|null}
 */
const parseDataExcel = (dataExcel) => {
  if (!dataExcel) return null;

  // Se for número (serial date do Excel)
  if (typeof dataExcel === 'number') {
    const date = XLSX.SSF.parse_date_code(dataExcel);
    if (date) {
      return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
    }
    return null;
  }

  // Se for string no formato DD/MM/YYYY
  const parts = String(dataExcel).split('/');
  if (parts.length === 3) {
    const [dia, mes, ano] = parts;
    return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
  }

  return null;
};

/**
 * Converte valor monetário BR para número
 * @param {string|number} valorStr - Valor em formato brasileiro ou número
 * @returns {number}
 */
const parseValorBR = (valorStr) => {
  if (!valorStr) return 0;
  if (typeof valorStr === 'number') return valorStr;
  const valorLimpo = String(valorStr).replace(/\./g, '').replace(',', '.');
  const valor = parseFloat(valorLimpo);
  return isNaN(valor) ? 0 : valor;
};

/**
 * Encontra a linha do cabeçalho real dos dados
 * @param {Array} data - Todas as linhas do arquivo
 * @returns {number} - Índice da linha do cabeçalho
 */
const encontrarLinhaHeader = (data) => {
  for (let i = 0; i < Math.min(15, data.length); i++) {
    const row = data[i];
    if (!row) continue;
    if (
      row.some(
        (cell) =>
          String(cell || '')
            .toLowerCase()
            .includes('nosso número') ||
          String(cell || '')
            .toLowerCase()
            .includes('nosso numero') ||
          String(cell || '')
            .toLowerCase()
            .includes('nro beneficiário') ||
          String(cell || '')
            .toLowerCase()
            .includes('nro beneficiario'),
      )
    ) {
      return i;
    }
  }
  return 0; // Default: primeira linha
};

/**
 * Detecta o tipo de arquivo baseado nas situações dos registros
 * @param {Array} data - Dados do arquivo
 * @param {number} idxSituacao - Índice da coluna de situação
 * @param {number} headerRowIndex - Índice da linha do cabeçalho
 * @returns {string} - 'ABERTO' ou 'LIQUIDADO'
 */
const detectarTipoArquivo = (data, idxSituacao, headerRowIndex) => {
  if (idxSituacao < 0) return 'ABERTO';
  for (let i = headerRowIndex + 1; i < Math.min(headerRowIndex + 20, data.length); i++) {
    const sit = String(data[i]?.[idxSituacao] || '').toLowerCase();
    if (sit.includes('liquidado') || sit.includes('baixado')) {
      return 'LIQUIDADO';
    }
  }
  return 'ABERTO';
};

/**
 * Parseia arquivo Excel do Banco do Brasil
 * @param {Buffer} fileBuffer - Buffer do arquivo Excel
 * @returns {Object} - { registros, tipoArquivo }
 */
const parseBBExcel = (fileBuffer) => {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

  if (data.length < 2) {
    throw new Error('Arquivo Excel vazio ou inválido');
  }

  // Encontrar linha do cabeçalho
  const headerRowIndex = encontrarLinhaHeader(data);
  const header = data[headerRowIndex];

  if (!header || header.length < 3) {
    throw new Error('Cabeçalho não encontrado ou inválido');
  }

  // Mapear índices das colunas (normalizado)
  const columnIndex = {};
  header.forEach((col, idx) => {
    const colNorm = String(col || '')
      .toLowerCase()
      .trim();
    columnIndex[colNorm] = idx;
  });

  // Função para buscar coluna por nome parcial
  const findColumnIndex = (partialNames) => {
    for (const name of partialNames) {
      for (const [colName, idx] of Object.entries(columnIndex)) {
        if (colName.includes(name.toLowerCase())) {
          return idx;
        }
      }
    }
    return -1;
  };

  // Encontrar índices das colunas
  const idxNossoNumero = findColumnIndex(['nosso número', 'nosso numero']);
  const idxPagador = findColumnIndex(['nome pagador', 'pagador', 'sacado', 'cliente']);
  const idxNroBeneficiario = findColumnIndex([
    'nro beneficiário',
    'nro beneficiario',
    'seu número',
    'seu numero',
    'número beneficiário',
  ]);
  const idxValor = findColumnIndex(['valor']);
  const idxVencimento = findColumnIndex(['vencimento', 'data venc']);
  const idxSituacao = findColumnIndex(['situação', 'situacao', 'status']);

  // Detectar tipo de arquivo
  const tipoArquivo = detectarTipoArquivo(data, idxSituacao, headerRowIndex);

  const registros = [];

  // Processar cada linha de dados
  for (let i = headerRowIndex + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length < 3) continue;

    const nossoNumero = String(row[idxNossoNumero] || '').trim();
    const pagador = String(row[idxPagador] || '').trim();
    const nroBeneficiario = String(
      row[idxNroBeneficiario >= 0 ? idxNroBeneficiario : 2] || '',
    ).trim();
    const valorRaw = row[idxValor >= 0 ? idxValor : 3];
    const vencimento = row[idxVencimento >= 0 ? idxVencimento : 4];
    const situacao = String(
      row[idxSituacao >= 0 ? idxSituacao : 5] || '',
    ).trim();

    // Ignorar linhas vazias ou totais
    if (!nossoNumero && !nroBeneficiario && !valorRaw) continue;
    if (String(nossoNumero).toLowerCase().includes('total')) continue;
    if (String(nroBeneficiario).toLowerCase().includes('total')) continue;

    // Extrair número da fatura e parcela do "Nro beneficiário" (formato: "000000/000")
    let nrFatura = nroBeneficiario;
    let nrParcela = '001';

    if (nroBeneficiario.includes('/')) {
      const parts = nroBeneficiario.split('/');
      nrFatura = parts[0].replace(/^0+/, '') || '0'; // Remove zeros à esquerda
      nrParcela = parts[1] || '001';
    }

    // Tentar extrair CNPJ parcial do nome do pagador (ex: "43.199.386 KATIA GEA")
    let cpfCnpj = '';
    const cnpjMatch = pagador.match(/^(\d{2}\.\d{3}\.\d{3})\s+/);
    if (cnpjMatch) {
      cpfCnpj = cnpjMatch[1].replace(/\./g, '');
    }

    const registro = {
      seu_numero: nroBeneficiario,
      nr_fatura: nrFatura,
      nr_parcela: nrParcela,
      nosso_numero: nossoNumero,
      vl_original: parseValorBR(valorRaw),
      vl_pago: tipoArquivo === 'LIQUIDADO' ? parseValorBR(valorRaw) : 0,
      dt_vencimento: parseDataExcel(vencimento),
      dt_pagamento: null,
      nm_cliente: pagador,
      nr_cpfcnpj: cpfCnpj,
      situacao: tipoArquivo === 'ABERTO' ? 'EM ABERTO' : 'LIQUIDADO',
      descricao_baixa:
        tipoArquivo === 'ABERTO' ? 'TITULO EM ABERTO' : 'LIQUIDADO',
      tipo_arquivo: tipoArquivo,
      banco: 'BB',
    };

    registros.push(registro);
  }

  return { registros, tipoArquivo };
};

/**
 * Processa arquivo Excel do Banco do Brasil
 * @param {Buffer|string} fileContent - Conteúdo do arquivo Excel
 * @returns {Object} - Objeto com registros processados e estatísticas
 */
const processBBFile = (fileContent) => {
  try {
    const buffer = Buffer.isBuffer(fileContent)
      ? fileContent
      : Buffer.from(fileContent);

    const { registros, tipoArquivo } = parseBBExcel(buffer);

    // Calcular estatísticas
    const stats = {
      totalRegistros: registros.length,
      tipoArquivo: tipoArquivo,
      valorTotalOriginal: registros.reduce((sum, r) => sum + r.vl_original, 0),
      valorTotalPago: registros.reduce((sum, r) => sum + r.vl_pago, 0),
      situacoes: {},
      dataProcessamento: new Date().toISOString(),
    };

    registros.forEach((r) => {
      const sit = r.situacao || 'OUTROS';
      stats.situacoes[sit] = (stats.situacoes[sit] || 0) + 1;
    });

    return {
      success: true,
      registros,
      stats,
      tipoArquivo,
      banco: 'BB',
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      banco: 'BB',
    };
  }
};

export { parseBBExcel, processBBFile };

export default processBBFile;
