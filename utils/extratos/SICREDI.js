/**
 * Parser para arquivos de retorno do Banco Sicredi
 * Processa arquivos CSV exportados do sistema Sicredi
 *
 * Estrutura do arquivo CSV (separador: ;):
 * - Nome Pagador (índice 0) - Nome do cliente (pode conter números/CPF)
 * - Data Baixa (índice 1) - Data de baixa do título
 * - Data Pagamento (índice 2) - Data do pagamento
 * - Data Vencimento (índice 3) - Data de vencimento
 * - Nosso Numero (índice 4) - Nosso número do banco
 * - Seu Numero (índice 5) - Número da fatura/parcela (formato: XXXXXX/YYY)
 * - Valor (índice 6) - Valor do título (formato BR: 5.549,08)
 * - Identificacao (índice 7) - CPF/CNPJ do pagador
 * - Situacao (índice 10) - A = Aberto, C = outros
 * - Valor Liq (índice 48) - Valor liquidado
 */

/**
 * Converte valor monetário BR para número
 * @param {string} valorStr - Valor em formato brasileiro (ex: "1.234,56")
 * @returns {number}
 */
const parseValorBR = (valorStr) => {
  if (!valorStr) return 0;
  if (typeof valorStr === 'number') return valorStr;
  // Remove pontos de milhar e substitui vírgula por ponto
  const valorLimpo = String(valorStr).replace(/\./g, '').replace(',', '.');
  const valor = parseFloat(valorLimpo);
  return isNaN(valor) ? 0 : valor;
};

/**
 * Converte data BR (DD/MM/YYYY) para ISO (YYYY-MM-DD)
 * @param {string} dataBR - Data em formato brasileiro
 * @returns {string|null}
 */
const parseDataBR = (dataBR) => {
  if (!dataBR || dataBR.trim() === '') return null;

  const parts = String(dataBR).trim().split('/');
  if (parts.length !== 3) return null;

  const [dia, mes, ano] = parts;
  if (!dia || !mes || !ano) return null;

  return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
};

/**
 * Normaliza CPF/CNPJ removendo caracteres especiais
 * @param {string} cpfcnpj - CPF ou CNPJ
 * @returns {string}
 */
const normalizarCpfCnpj = (cpfcnpj) => {
  if (!cpfcnpj) return '';
  return String(cpfcnpj).replace(/[^\d]/g, '');
};

/**
 * Detecta se é arquivo de títulos abertos ou liquidados
 * @param {Array} registros - Registros processados
 * @returns {string} - 'ABERTO', 'LIQUIDADO' ou 'MISTO'
 */
const detectarTipoArquivo = (registros) => {
  const abertos = registros.filter((r) => r.situacao === 'EM ABERTO').length;
  const liquidados = registros.filter((r) => r.situacao === 'LIQUIDADO').length;

  if (abertos > 0 && liquidados > 0) return 'MISTO';
  if (liquidados > abertos) return 'LIQUIDADO';
  return 'ABERTO';
};

/**
 * Parseia arquivo CSV do Sicredi
 * @param {string} csvContent - Conteúdo do arquivo CSV
 * @returns {Object} - { registros, tipoArquivo }
 */
const parseSicrediCSV = (csvContent) => {
  const lines = csvContent.split('\n');

  if (lines.length < 2) {
    throw new Error('Arquivo CSV vazio ou inválido');
  }

  // Primeira linha é o cabeçalho
  const header = lines[0].split(';').map((col) => col.trim().replace(/"/g, ''));

  // Mapear índices das colunas pelo nome
  const columnIndex = {};
  header.forEach((col, idx) => {
    columnIndex[col.toLowerCase()] = idx;
  });

  // Função para encontrar índice de coluna por nome parcial
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

  // Encontrar índices das colunas principais
  const idxNomePagador = findColumnIndex(['nome pagador']);
  const idxDataBaixa = findColumnIndex(['data baixa']);
  const idxDataPagamento = findColumnIndex(['data pagamento']);
  const idxDataVencimento = findColumnIndex(['data vencimento']);
  const idxNossoNumero = findColumnIndex(['nosso numero', 'nosso número']);
  const idxSeuNumero = findColumnIndex(['seu numero', 'seu número']);
  const idxValor = findColumnIndex(['valor']);
  const idxIdentificacao = findColumnIndex(['identificacao', 'identificação']);
  const idxSituacao = findColumnIndex(['situacao', 'situação']);
  const idxValorLiq = findColumnIndex(['valor liq', 'valor liquidacao']);
  const idxCpfCnpjPagador = findColumnIndex(['cpf/cnpj pagador']);

  // Validação básica
  if (idxValor === -1) {
    throw new Error('Coluna "Valor" não encontrada no arquivo');
  }

  const registros = [];

  // Processar cada linha (exceto cabeçalho)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = line.split(';').map((val) => val.trim().replace(/"/g, ''));

    // Função para pegar valor da coluna
    const getValue = (idx) => {
      if (idx === -1 || idx >= values.length) return '';
      return values[idx] || '';
    };

    // Pegar valores das colunas
    const nomePagador = getValue(idxNomePagador);
    const dataBaixa = getValue(idxDataBaixa);
    const dataPagamento = getValue(idxDataPagamento);
    const dataVencimento = getValue(idxDataVencimento);
    const nossoNumero = getValue(idxNossoNumero);
    const seuNumero = getValue(idxSeuNumero);
    const valorStr = getValue(idxValor);
    const identificacao = getValue(idxIdentificacao);
    const situacaoStr = getValue(idxSituacao);
    const valorLiqStr = getValue(idxValorLiq);
    const cpfCnpjPagador = getValue(idxCpfCnpjPagador);

    // Ignorar linhas sem valor ou vazias
    const valor = parseValorBR(valorStr);
    if (valor === 0 && !seuNumero) continue;

    // Determinar CPF/CNPJ (preferir cpfCnpjPagador, senão usar identificação)
    let cpfcnpj = normalizarCpfCnpj(cpfCnpjPagador || identificacao);

    // Extrair número da fatura e parcela do "Seu Número" (formato: XXXXXX/YYY)
    let nrFatura = seuNumero;
    let nrParcela = '001';

    if (seuNumero && seuNumero.includes('/')) {
      const parts = seuNumero.split('/');
      nrFatura = parts[0].replace(/^0+/, '') || '0'; // Remove zeros à esquerda
      nrParcela = parts[1] || '001';
    }

    // Determinar situação
    // A = Aberto, B = Baixado, C = outros
    let situacao = 'EM ABERTO';
    const valorLiq = parseValorBR(valorLiqStr);

    if (
      situacaoStr === 'B' ||
      situacaoStr === 'C' ||
      dataPagamento ||
      valorLiq > 0
    ) {
      situacao = 'LIQUIDADO';
    }

    // Limpar nome do cliente (pode conter números/CPF no início)
    let nomeCliente = String(nomePagador).trim();

    const registro = {
      seu_numero: seuNumero,
      nr_fatura: nrFatura,
      nr_parcela: nrParcela,
      nosso_numero: nossoNumero,
      vl_original: valor,
      vl_pago: situacao === 'LIQUIDADO' ? valorLiq || valor : 0,
      dt_vencimento: parseDataBR(dataVencimento),
      dt_pagamento: parseDataBR(dataPagamento) || parseDataBR(dataBaixa),
      dt_baixa: parseDataBR(dataBaixa),
      nm_cliente: nomeCliente,
      nr_cpfcnpj: cpfcnpj,
      situacao: situacao,
      descricao_baixa: situacao === 'LIQUIDADO' ? 'LIQUIDADO' : 'EM ABERTO',
      tipo_arquivo: situacao === 'LIQUIDADO' ? 'LIQUIDADO' : 'ABERTO',
      banco: 'SICREDI',
    };

    registros.push(registro);
  }

  const tipoArquivo = detectarTipoArquivo(registros);

  return { registros, tipoArquivo };
};

/**
 * Processa arquivo de retorno do Banco Sicredi
 * @param {string} fileContent - Conteúdo do arquivo CSV
 * @returns {Object} - Objeto com registros processados e estatísticas
 */
const processSicrediFile = (fileContent) => {
  try {
    // Converter buffer para string se necessário
    const content = Buffer.isBuffer(fileContent)
      ? fileContent.toString('utf-8')
      : fileContent;

    const { registros, tipoArquivo } = parseSicrediCSV(content);

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
      banco: 'SICREDI',
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      banco: 'SICREDI',
    };
  }
};

export { parseSicrediCSV, processSicrediFile };

export default processSicrediFile;
