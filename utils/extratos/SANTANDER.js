/**
 * Parser para arquivos de retorno do Banco Santander
 * Processa arquivos Excel de títulos em aberto/cobrança
 *
 * Estrutura do arquivo Excel:
 * - Linhas 0-5: Cabeçalho informativo (Cod. Beneficiário, Empresa, etc.)
 * - Linha 6: Cabeçalho das colunas de dados
 * - Linhas 7+: Dados dos títulos
 *
 * Colunas:
 * - Seu Número (formato: "000000/000" - número fatura/parcela)
 * - Nosso Número
 * - Valor do Título (R$)
 * - Vencimento
 * - Pagador (nome do cliente)
 * - Conta Cobrança
 * - Tipo Cobrança / Modalidade
 */

import XLSX from 'xlsx';

/**
 * Converte valor monetário BR para número
 * @param {string} valorStr - Valor em formato brasileiro (ex: "1.234,56")
 * @returns {number}
 */
const parseValorBR = (valorStr) => {
  if (!valorStr) return 0;
  // Se já é número, retorna
  if (typeof valorStr === 'number') return valorStr;
  // Remove pontos de milhar e substitui vírgula por ponto
  const valorLimpo = String(valorStr).replace(/\./g, '').replace(',', '.');
  const valor = parseFloat(valorLimpo);
  return isNaN(valor) ? 0 : valor;
};

/**
 * Converte data BR (DD/MM/YYYY) para ISO (YYYY-MM-DD)
 * @param {string|number} dataBR - Data em formato brasileiro ou serial do Excel
 * @returns {string|null}
 */
const parseDataBR = (dataBR) => {
  if (!dataBR) return null;

  // Se for número (serial date do Excel)
  if (typeof dataBR === 'number') {
    const date = XLSX.SSF.parse_date_code(dataBR);
    if (date) {
      return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
    }
    return null;
  }

  // Se for string no formato DD/MM/YYYY
  const parts = String(dataBR).split('/');
  if (parts.length !== 3) return null;
  const [dia, mes, ano] = parts;
  return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
};

/**
 * Detecta o tipo de arquivo baseado no conteúdo
 * @param {Array} headerInfo - Primeiras linhas do arquivo
 * @returns {string} - 'ABERTO' ou 'LIQUIDADO'
 */
const detectarTipoArquivo = (headerInfo) => {
  // Verifica se alguma linha contém "Em aberto" ou "Liquidado"
  for (const row of headerInfo) {
    if (!row) continue;
    const rowStr = row.join(' ').toLowerCase();
    if (rowStr.includes('em aberto')) return 'ABERTO';
    if (rowStr.includes('liquidado') || rowStr.includes('baixado'))
      return 'LIQUIDADO';
  }
  return 'ABERTO'; // Default
};

/**
 * Encontra a linha do cabeçalho real dos dados
 * @param {Array} data - Todas as linhas do arquivo
 * @returns {number} - Índice da linha do cabeçalho
 */
const encontrarLinhaHeader = (data) => {
  for (let i = 0; i < Math.min(20, data.length); i++) {
    const row = data[i];
    if (!row) continue;
    // Procura linha que contenha "Seu Número" ou "Nosso Número"
    if (
      row.some(
        (cell) =>
          String(cell || '')
            .toLowerCase()
            .includes('seu número') ||
          String(cell || '')
            .toLowerCase()
            .includes('nosso número'),
      )
    ) {
      return i;
    }
  }
  return 6; // Default baseado na estrutura conhecida
};

/**
 * Parseia arquivo Excel do Santander
 * @param {Buffer} fileBuffer - Buffer do arquivo Excel
 * @returns {Object} - { registros, tipoArquivo }
 */
const parseSantanderExcel = (fileBuffer) => {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

  if (data.length < 8) {
    throw new Error('Arquivo Excel vazio ou inválido');
  }

  // Detectar tipo de arquivo pelas primeiras linhas
  const tipoArquivo = detectarTipoArquivo(data.slice(0, 6));

  // Encontrar linha do cabeçalho
  const headerRowIndex = encontrarLinhaHeader(data);
  const header = data[headerRowIndex];

  if (!header || header.length < 4) {
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
  const idxSeuNumero = findColumnIndex(['seu número', 'seu numero']);
  const idxNossoNumero = findColumnIndex(['nosso número', 'nosso numero']);
  const idxValor = findColumnIndex([
    'valor do título',
    'valor do titulo',
    'valor',
  ]);
  const idxVencimento = findColumnIndex(['vencimento', 'data venc']);
  const idxPagador = findColumnIndex(['pagador', 'sacado', 'cliente']);
  const idxContaCobranca = findColumnIndex([
    'conta cobrança',
    'conta cobranca',
  ]);
  const idxTipoCobranca = findColumnIndex([
    'tipo cobrança',
    'tipo cobranca',
    'modalidade',
  ]);

  const registros = [];

  // Processar cada linha de dados (a partir da linha após o cabeçalho)
  for (let i = headerRowIndex + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length < 4) continue;

    // Pegar valores das colunas
    const seuNumero = row[idxSeuNumero] || '';
    const nossoNumero = row[idxNossoNumero] || '';
    const valorTitulo = row[idxValor];
    const vencimento = row[idxVencimento];
    const pagador = row[idxPagador] || '';
    const contaCobranca = row[idxContaCobranca] || '';
    const tipoCobranca = row[idxTipoCobranca] || '';

    // Ignorar linhas vazias ou totais
    if (!seuNumero && !nossoNumero && !valorTitulo) continue;
    if (String(seuNumero).toLowerCase().includes('total')) continue;

    // Extrair número da fatura e parcela do "Seu Número" (formato: "000000/000")
    const seuNumeroStr = String(seuNumero);
    let nrFatura = seuNumeroStr;
    let nrParcela = '001';

    if (seuNumeroStr.includes('/')) {
      const parts = seuNumeroStr.split('/');
      nrFatura = parts[0].replace(/^0+/, '') || '0'; // Remove zeros à esquerda
      nrParcela = parts[1] || '001';
    }

    const registro = {
      seu_numero: seuNumeroStr,
      nr_fatura: nrFatura,
      nr_parcela: nrParcela,
      nosso_numero: String(nossoNumero),
      vl_original: parseValorBR(valorTitulo),
      vl_pago: tipoArquivo === 'LIQUIDADO' ? parseValorBR(valorTitulo) : 0,
      dt_vencimento: parseDataBR(vencimento),
      dt_pagamento: null, // Não disponível neste formato
      nm_cliente: String(pagador).trim(),
      nr_cpfcnpj: '', // Não disponível no arquivo - será necessário buscar no sistema
      conta_cobranca: String(contaCobranca),
      tipo_cobranca: String(tipoCobranca),
      situacao: tipoArquivo === 'ABERTO' ? 'EM ABERTO' : 'LIQUIDADO',
      descricao_baixa:
        tipoArquivo === 'ABERTO' ? 'TITULO EM ABERTO' : 'LIQUIDADO',
      tipo_arquivo: tipoArquivo,
      banco: 'SANTANDER',
    };

    registros.push(registro);
  }

  return { registros, tipoArquivo };
};

/**
 * Processa arquivo de retorno do Banco Santander
 * @param {Buffer|string} fileContent - Conteúdo do arquivo Excel
 * @returns {Object} - Objeto com registros processados e estatísticas
 */
const processSantanderFile = (fileContent) => {
  try {
    // Garantir que é um buffer
    const buffer = Buffer.isBuffer(fileContent)
      ? fileContent
      : Buffer.from(fileContent);

    const { registros, tipoArquivo } = parseSantanderExcel(buffer);

    // Calcular estatísticas
    const stats = {
      totalRegistros: registros.length,
      tipoArquivo: tipoArquivo,
      valorTotalOriginal: registros.reduce((sum, r) => sum + r.vl_original, 0),
      valorTotalPago: registros.reduce((sum, r) => sum + r.vl_pago, 0),
      situacoes: {},
      dataProcessamento: new Date().toISOString(),
    };

    // Contar por situação
    registros.forEach((r) => {
      const sit = r.situacao || 'OUTROS';
      stats.situacoes[sit] = (stats.situacoes[sit] || 0) + 1;
    });

    return {
      success: true,
      registros,
      stats,
      tipoArquivo,
      banco: 'SANTANDER',
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      banco: 'SANTANDER',
    };
  }
};

/**
 * Agrupa registros por número de fatura para facilitar comparação
 * @param {Array} registros - Array de registros processados
 * @returns {Object} - Objeto agrupado por número de fatura
 */
const agruparPorFatura = (registros) => {
  const agrupado = {};
  registros.forEach((reg) => {
    const chave = `${reg.nr_fatura}/${reg.nr_parcela}`;
    if (!agrupado[chave]) {
      agrupado[chave] = [];
    }
    agrupado[chave].push(reg);
  });
  return agrupado;
};

export { parseSantanderExcel, processSantanderFile, agruparPorFatura };

export default processSantanderFile;
