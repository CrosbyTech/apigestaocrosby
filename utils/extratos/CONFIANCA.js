/**
 * Parser para arquivos de retorno do Banco Confiança
 * Processa arquivos CSV de títulos liquidados e títulos em aberto
 *
 * Colunas do arquivo LIQUIDADO:
 * TITU_ID;SEQU_BAIX;BORD_ID;CLIE_ID;FANT;NUME_DOCT;DATA_TITU;SACA_ID;NOME;VALO_TITU_ORIG;
 * VALO_JURO;VALO_DESC;VALO_PAGO;VALO_TITU;TIPO_TITU;SITUACAO;DATA_PAGA;BAIX_CADA_DETA_ID;TIPO_CART;FILI_ID
 *
 * Colunas do arquivo EM ABERTO:
 * TITU_ID;FILI_ID;CLIE_ID;FANT;SEQU_BAIX;NUME_DOCT;NUME_BANC;PERC_JURO;PERC_MULT;VALO_TITU;VALO_TITU_ORIG;
 * caVALO_JURO;caVALO_ATUA;DATA_TITU;DATA_DEPO;SACA_ID;NOME;caSACADO;TIPO_TITU;TIPO_PESS;AGEN_COBR_ID;
 * SITUACAO;TIPO_CART;SITU;BORD_ID;DATA_CRIA;DIAS_ATRA;PERC_MORA_CCB;PERC_MULT_CCB;UTIL_JURO_MORA_CONT;SE_MULT_ANTE_PRAZ
 */

/**
 * Detecta o tipo de arquivo baseado nas colunas do cabeçalho
 * @param {Array} header - Array com nomes das colunas
 * @returns {string} - 'LIQUIDADO' ou 'ABERTO'
 */
const detectarTipoArquivo = (header) => {
  // Se tem DATA_PAGA e VALO_PAGO, é arquivo liquidado
  if (header.includes('DATA_PAGA') && header.includes('VALO_PAGO')) {
    return 'LIQUIDADO';
  }
  // Se tem DIAS_ATRA ou caVALO_ATUA, é arquivo em aberto
  if (header.includes('DIAS_ATRA') || header.includes('caVALO_ATUA')) {
    return 'ABERTO';
  }
  // Fallback: se não tem DATA_PAGA, provavelmente é aberto
  if (!header.includes('DATA_PAGA')) {
    return 'ABERTO';
  }
  return 'LIQUIDADO';
};

const parseConfiancaCSV = (csvContent) => {
  const lines = csvContent.split('\n');

  if (lines.length < 2) {
    throw new Error('Arquivo CSV vazio ou inválido');
  }

  // Primeira linha é o cabeçalho
  const header = lines[0].split(';').map((col) => col.trim().replace(/"/g, ''));

  // Detectar tipo de arquivo
  const tipoArquivo = detectarTipoArquivo(header);

  // Mapear índices das colunas
  const columnIndex = {};
  header.forEach((col, idx) => {
    columnIndex[col] = idx;
  });

  // Validar colunas obrigatórias baseado no tipo
  const requiredColumnsLiquidado = [
    'TITU_ID',
    'NUME_DOCT',
    'DATA_TITU',
    'SACA_ID',
    'NOME',
    'VALO_TITU_ORIG',
    'VALO_PAGO',
    'SITUACAO',
    'DATA_PAGA',
  ];

  const requiredColumnsAberto = [
    'TITU_ID',
    'NUME_DOCT',
    'DATA_TITU',
    'SACA_ID',
    'NOME',
    'VALO_TITU_ORIG',
    'SITUACAO',
  ];

  const requiredColumns =
    tipoArquivo === 'LIQUIDADO'
      ? requiredColumnsLiquidado
      : requiredColumnsAberto;

  for (const col of requiredColumns) {
    if (columnIndex[col] === undefined) {
      throw new Error(`Coluna obrigatória não encontrada: ${col}`);
    }
  }

  const registros = [];

  // Processar cada linha (exceto cabeçalho)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = line.split(';').map((val) => val.trim().replace(/"/g, ''));

    // Função para pegar valor da coluna
    const getValue = (colName) => {
      const idx = columnIndex[colName];
      return idx !== undefined ? values[idx] : null;
    };

    // Função para converter data BR para ISO
    const parseDataBR = (dataBR) => {
      if (!dataBR) return null;
      const parts = dataBR.split('/');
      if (parts.length !== 3) return null;
      const [dia, mes, ano] = parts;
      return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
    };

    // Função para converter valor monetário BR para número
    const parseValorBR = (valorStr) => {
      if (!valorStr) return 0;
      // Remove pontos de milhar e substitui vírgula por ponto
      const valorLimpo = valorStr.replace(/\./g, '').replace(',', '.');
      const valor = parseFloat(valorLimpo);
      return isNaN(valor) ? 0 : valor;
    };

    // Extrair CNPJ/CPF do SACA_ID
    const sacaId = getValue('SACA_ID');
    let cpfCnpj = sacaId;
    if (sacaId) {
      // Remove caracteres não numéricos para padronizar
      cpfCnpj = sacaId.replace(/\D/g, '');
    }

    // Extrair número da fatura do NUME_DOCT (formato: "573456/001")
    const numeDoct = getValue('NUME_DOCT') || '';
    const [nrFatura, nrParcela] = numeDoct.split('/');

    // Campos específicos para cada tipo de arquivo
    let vl_pago = 0;
    let dt_pagamento = null;
    let descricao_baixa = null;
    let dias_atraso = null;
    let vl_juros_calculado = 0;
    let vl_atualizado = 0;
    let agencia_cobranca = null;
    let situacao_detalhe = null;

    if (tipoArquivo === 'LIQUIDADO') {
      vl_pago = parseValorBR(getValue('VALO_PAGO'));
      dt_pagamento = parseDataBR(getValue('DATA_PAGA'));
      descricao_baixa = getValue('BAIX_CADA_DETA_ID');
    } else {
      // ABERTO
      dias_atraso = parseInt(getValue('DIAS_ATRA')) || 0;
      vl_juros_calculado = parseValorBR(getValue('caVALO_JURO'));
      vl_atualizado = parseValorBR(getValue('caVALO_ATUA'));
      agencia_cobranca = getValue('AGEN_COBR_ID');
      situacao_detalhe = getValue('SITU');
      descricao_baixa = situacao_detalhe; // Usar SITU como descrição
    }

    const registro = {
      titu_id: getValue('TITU_ID'),
      sequ_baix: getValue('SEQU_BAIX'),
      bord_id: getValue('BORD_ID'),
      clie_id: getValue('CLIE_ID'),
      fantasia: getValue('FANT'),
      nr_fatura: nrFatura || numeDoct,
      nr_parcela: nrParcela || '001',
      nosso_numero: getValue('NUME_BANC') || numeDoct,
      dt_vencimento: parseDataBR(getValue('DATA_TITU')),
      nr_cpfcnpj: cpfCnpj,
      nm_cliente: getValue('NOME'),
      vl_original: parseValorBR(getValue('VALO_TITU_ORIG')),
      vl_juros: parseValorBR(getValue('VALO_JURO')) || vl_juros_calculado,
      vl_desconto: parseValorBR(getValue('VALO_DESC')),
      vl_pago: vl_pago,
      vl_titulo: parseValorBR(getValue('VALO_TITU')),
      vl_atualizado: vl_atualizado,
      tp_titulo: getValue('TIPO_TITU'),
      situacao: getValue('SITUACAO'),
      situacao_detalhe: situacao_detalhe,
      dt_pagamento: dt_pagamento,
      descricao_baixa: descricao_baixa,
      tipo_carteira: getValue('TIPO_CART'),
      filial_id: getValue('FILI_ID'),
      dias_atraso: dias_atraso,
      agencia_cobranca: agencia_cobranca,
      tipo_arquivo: tipoArquivo,
      banco: 'CONFIANCA',
    };

    registros.push(registro);
  }

  return { registros, tipoArquivo };
};

/**
 * Processa arquivo de retorno do Banco Confiança
 * @param {Buffer|string} fileContent - Conteúdo do arquivo CSV
 * @returns {Object} - Objeto com registros processados e estatísticas
 */
const processConfiancaFile = (fileContent) => {
  try {
    // Converter buffer para string se necessário
    const content = Buffer.isBuffer(fileContent)
      ? fileContent.toString('utf-8')
      : fileContent;

    const { registros, tipoArquivo } = parseConfiancaCSV(content);

    // Calcular estatísticas
    const stats = {
      totalRegistros: registros.length,
      tipoArquivo: tipoArquivo,
      valorTotalOriginal: registros.reduce((sum, r) => sum + r.vl_original, 0),
      valorTotalPago: registros.reduce((sum, r) => sum + r.vl_pago, 0),
      valorTotalJuros: registros.reduce((sum, r) => sum + r.vl_juros, 0),
      valorTotalDesconto: registros.reduce((sum, r) => sum + r.vl_desconto, 0),
      valorTotalAtualizado: registros.reduce(
        (sum, r) => sum + (r.vl_atualizado || 0),
        0,
      ),
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
      banco: 'CONFIANCA',
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      banco: 'CONFIANCA',
    };
  }
};

/**
 * Agrupa registros por CNPJ/CPF para facilitar comparação com contas a receber
 * @param {Array} registros - Array de registros processados
 * @returns {Object} - Objeto agrupado por CNPJ/CPF
 */
const agruparPorCnpj = (registros) => {
  const agrupado = {};

  registros.forEach((reg) => {
    const key = reg.nr_cpfcnpj;
    if (!agrupado[key]) {
      agrupado[key] = {
        nr_cpfcnpj: reg.nr_cpfcnpj,
        nm_cliente: reg.nm_cliente,
        titulos: [],
        totalOriginal: 0,
        totalPago: 0,
      };
    }
    agrupado[key].titulos.push(reg);
    agrupado[key].totalOriginal += reg.vl_original;
    agrupado[key].totalPago += reg.vl_pago;
  });

  return agrupado;
};

/**
 * Agrupa registros por número de fatura
 * @param {Array} registros - Array de registros processados
 * @returns {Object} - Objeto agrupado por número de fatura
 */
const agruparPorFatura = (registros) => {
  const agrupado = {};

  registros.forEach((reg) => {
    const key = reg.nr_fatura;
    if (!agrupado[key]) {
      agrupado[key] = {
        nr_fatura: reg.nr_fatura,
        nr_cpfcnpj: reg.nr_cpfcnpj,
        nm_cliente: reg.nm_cliente,
        parcelas: [],
        totalOriginal: 0,
        totalPago: 0,
      };
    }
    agrupado[key].parcelas.push(reg);
    agrupado[key].totalOriginal += reg.vl_original;
    agrupado[key].totalPago += reg.vl_pago;
  });

  return agrupado;
};

export {
  parseConfiancaCSV,
  processConfiancaFile,
  agruparPorCnpj,
  agruparPorFatura,
};

export default processConfiancaFile;
