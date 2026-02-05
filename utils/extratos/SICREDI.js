/**
 * Parser para arquivos de retorno do Banco Sicredi
 * Processa arquivos CSV e XLS/XLSX do sistema Sicredi
 *
 * Formato CSV (separador: ;):
 * - Nome Pagador, Data Baixa, Data Pagamento, Data Vencimento, Nosso Numero,
 *   Seu Numero, Valor, Identificacao (CPF/CNPJ), etc.
 *
 * Formato XLS (Relatório de Boletos):
 * - Cabeçalho na linha 17: Cart, Nº Doc, Nosso Nº, TXID, Pagador, Data Vencimento,
 *   Data Liquidação, Valor (R$), Liquidação (R$), Situação do Boleto, Motivo
 * - Pagador contém CPF/CNPJ no início (ex: "43.199.386 KATIA GEANNE DE LIMA")
 */

import XLSX from 'xlsx';

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
 * @param {string|number} dataBR - Data em formato brasileiro ou serial Excel
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

  const dataStr = String(dataBR).trim();
  if (dataStr === '') return null;

  const parts = dataStr.split('/');
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
 * Extrai CPF/CNPJ do início do nome do pagador no XLS
 * Ex: "43.199.386 KATIA GEANNE DE LIMA" -> { cpfcnpj: "43199386", nome: "KATIA GEANNE DE LIMA" }
 * @param {string} pagador - String do pagador
 * @returns {Object} - { cpfcnpj, nome }
 */
const extrairCpfCnpjDoNome = (pagador) => {
  if (!pagador) return { cpfcnpj: '', nome: '' };

  const pagadorStr = String(pagador).trim();

  // Padrão 1: CPF/CNPJ formatado no início (XX.XXX.XXX ou XX.XXX.XXX/XXXX-XX)
  const matchCnpj = pagadorStr.match(
    /^(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\s+(.+)$/,
  );
  if (matchCnpj) {
    return {
      cpfcnpj: normalizarCpfCnpj(matchCnpj[1]),
      nome: matchCnpj[2].trim(),
    };
  }

  // Padrão 2: Número parcial no início (XX.XXX.XXX NOME...)
  const matchParcial = pagadorStr.match(/^(\d{2}\.\d{3}\.\d{3})\s+(.+)$/);
  if (matchParcial) {
    return {
      cpfcnpj: normalizarCpfCnpj(matchParcial[1]),
      nome: matchParcial[2].trim(),
    };
  }

  // Padrão 3: CPF simples no início (XXX.XXX.XXX-XX NOME...)
  const matchCpf = pagadorStr.match(/^(\d{3}\.\d{3}\.\d{3}-\d{2})\s+(.+)$/);
  if (matchCpf) {
    return {
      cpfcnpj: normalizarCpfCnpj(matchCpf[1]),
      nome: matchCpf[2].trim(),
    };
  }

  // Padrão 4: Qualquer número formatado seguido de nome
  const matchGenerico = pagadorStr.match(/^([\d.\/-]+)\s+(.+)$/);
  if (matchGenerico) {
    const numeros = normalizarCpfCnpj(matchGenerico[1]);
    if (numeros.length >= 8) {
      return {
        cpfcnpj: numeros,
        nome: matchGenerico[2].trim(),
      };
    }
  }

  // Sem padrão encontrado - retorna nome completo
  return { cpfcnpj: '', nome: pagadorStr };
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
 * Verifica se o conteúdo parece ser um arquivo Excel (XLS/XLSX)
 * @param {Buffer} buffer - Buffer do arquivo
 * @returns {boolean}
 */
const isExcelFile = (buffer) => {
  if (!Buffer.isBuffer(buffer)) return false;

  // Verifica assinatura do arquivo
  // XLS: D0 CF 11 E0
  // XLSX: 50 4B 03 04 (ZIP)
  const xlsSignature =
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0;
  const xlsxSignature =
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04;

  return xlsSignature || xlsxSignature;
};

/**
 * Parseia arquivo Excel (XLS/XLSX) do Sicredi - Relatório de Boletos
 * @param {Buffer} fileBuffer - Buffer do arquivo
 * @returns {Object} - { registros, tipoArquivo }
 */
const parseSicrediExcel = (fileBuffer) => {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

  if (data.length < 20) {
    throw new Error('Arquivo Excel vazio ou inválido');
  }

  // Encontrar linha do cabeçalho (procura por "Nº Doc" ou "Cart")
  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(25, data.length); i++) {
    const row = data[i];
    if (!row) continue;
    const rowStr = row.join(' ').toLowerCase();
    if (
      (rowStr.includes('nº doc') || rowStr.includes('n doc')) &&
      rowStr.includes('pagador')
    ) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1) {
    throw new Error('Cabeçalho não encontrado no arquivo Excel');
  }

  const header = data[headerRowIndex];

  // Mapear índices das colunas
  const findColumnIndex = (row, ...searchTerms) => {
    for (let i = 0; i < row.length; i++) {
      const cellLower = String(row[i] || '')
        .toLowerCase()
        .trim();
      for (const term of searchTerms) {
        if (cellLower.includes(term.toLowerCase())) {
          return i;
        }
      }
    }
    return -1;
  };

  const idxCarteira = findColumnIndex(header, 'cart');
  const idxNumDoc = findColumnIndex(header, 'nº doc', 'n doc', 'num doc');
  const idxNossoNumero = findColumnIndex(header, 'nosso');
  const idxPagador = findColumnIndex(header, 'pagador');
  const idxDataVencimento = findColumnIndex(
    header,
    'data vencimento',
    'vencimento',
  );
  const idxDataLiquidacao = findColumnIndex(
    header,
    'data liquidação',
    'liquidação',
    'liquidacao',
  );
  const idxValor = findColumnIndex(header, 'valor');
  const idxValorLiquidacao = findColumnIndex(
    header,
    'liquidação',
    'liquidacao',
  );
  const idxSituacao = findColumnIndex(header, 'situação', 'situacao');

  // Corrigir: se idxValorLiquidacao == idxDataLiquidacao, ajustar
  let idxValorLiq = idxValorLiquidacao;
  if (idxValorLiq === idxDataLiquidacao) {
    // Procurar próxima coluna com "liquidação" após valor
    for (let i = idxValor + 1; i < header.length; i++) {
      const cellLower = String(header[i] || '')
        .toLowerCase()
        .trim();
      if (
        cellLower.includes('liquidação') ||
        cellLower.includes('liquidacao')
      ) {
        if (i !== idxDataLiquidacao) {
          idxValorLiq = i;
          break;
        }
      }
    }
  }

  const registros = [];

  // Processar dados (a partir da linha após cabeçalho)
  for (let i = headerRowIndex + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length < 4) continue;

    // Pegar valores das colunas importantes
    const numDoc = row[idxNumDoc] || '';
    const pagador = row[idxPagador] || '';
    const dataVencimento = row[idxDataVencimento] || '';
    const valorStr = row[idxValor];
    const situacaoStr = row[idxSituacao] || '';

    // Ignorar linhas vazias ou sem número de documento
    if (!numDoc || String(numDoc).trim() === '') continue;
    if (String(numDoc).toLowerCase().includes('total')) continue;

    // Extrair CPF/CNPJ e nome do pagador
    const { cpfcnpj, nome } = extrairCpfCnpjDoNome(pagador);

    // Extrair número da fatura e parcela do "Nº Doc" (formato: XXXXXX/YYY)
    const numDocStr = String(numDoc).trim();
    let nrFatura = numDocStr;
    let nrParcela = '001';

    if (numDocStr.includes('/')) {
      const parts = numDocStr.split('/');
      nrFatura = parts[0].replace(/^0+/, '') || '0';
      nrParcela = parts[1] || '001';
    }

    // Determinar situação
    const situacao = String(situacaoStr).toUpperCase().trim();
    let situacaoNormalizada = 'EM ABERTO';
    if (
      situacao.includes('LIQUIDADO') ||
      situacao.includes('PAGO') ||
      situacao.includes('BAIXADO')
    ) {
      situacaoNormalizada = 'LIQUIDADO';
    }

    const valor = parseValorBR(valorStr);
    const valorLiq = parseValorBR(row[idxValorLiq] || 0);

    const registro = {
      seu_numero: numDocStr,
      nr_fatura: nrFatura,
      nr_parcela: nrParcela,
      nosso_numero: String(row[idxNossoNumero] || ''),
      carteira: String(row[idxCarteira] || ''),
      vl_original: valor,
      vl_pago: situacaoNormalizada === 'LIQUIDADO' ? valorLiq || valor : 0,
      dt_vencimento: parseDataBR(dataVencimento),
      dt_pagamento:
        situacaoNormalizada === 'LIQUIDADO'
          ? parseDataBR(row[idxDataLiquidacao])
          : null,
      nm_cliente: nome || pagador,
      nr_cpfcnpj: cpfcnpj,
      situacao: situacaoNormalizada,
      situacao_original: situacao,
      descricao_baixa:
        situacaoNormalizada === 'LIQUIDADO' ? 'LIQUIDADO' : 'EM ABERTO',
      tipo_arquivo:
        situacaoNormalizada === 'LIQUIDADO' ? 'LIQUIDADO' : 'ABERTO',
      banco: 'SICREDI',
    };

    registros.push(registro);
  }

  const tipoArquivo = detectarTipoArquivo(registros);

  return { registros, tipoArquivo };
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
 * Processa arquivo de retorno do Banco Sicredi (CSV ou XLS/XLSX)
 * @param {Buffer|string} fileContent - Conteúdo do arquivo
 * @returns {Object} - Objeto com registros processados e estatísticas
 */
const processSicrediFile = (fileContent) => {
  try {
    let registros, tipoArquivo;

    // Determinar tipo de arquivo e processar adequadamente
    if (Buffer.isBuffer(fileContent) && isExcelFile(fileContent)) {
      // Arquivo Excel (XLS/XLSX)
      const result = parseSicrediExcel(fileContent);
      registros = result.registros;
      tipoArquivo = result.tipoArquivo;
    } else {
      // Arquivo CSV ou texto
      const content = Buffer.isBuffer(fileContent)
        ? fileContent.toString('utf-8')
        : fileContent;

      // Verificar se parece ser um CSV válido (tem ; como separador)
      if (content.includes(';')) {
        const result = parseSicrediCSV(content);
        registros = result.registros;
        tipoArquivo = result.tipoArquivo;
      } else {
        // Tentar como Excel (pode ser HTML mascarado como XLS)
        try {
          const buffer = Buffer.isBuffer(fileContent)
            ? fileContent
            : Buffer.from(fileContent);
          const result = parseSicrediExcel(buffer);
          registros = result.registros;
          tipoArquivo = result.tipoArquivo;
        } catch {
          throw new Error(
            'Formato de arquivo não reconhecido. Use CSV ou XLS/XLSX.',
          );
        }
      }
    }

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

export { parseSicrediCSV, parseSicrediExcel, processSicrediFile };

export default processSicrediFile;
