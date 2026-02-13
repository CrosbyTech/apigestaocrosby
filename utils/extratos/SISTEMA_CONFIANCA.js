/**
 * Parser para arquivo CSV exportado do SISTEMA (CONFIANÇA)
 * Usado quando a API do render.com está indisponível
 *
 * Formato do CSV (separador: ;):
 * CLIENTE;;CPF/CNPJ;EMPRESA;FATURA;PARCELA;DOCUMENTO;PORTADOR;EMISSAO;VENC.ORIG.;VENCIMENTO;LIQUIDACAO;VALOR FATURA
 *
 * Exemplo:
 * 44748;COLLYER & SOARES LTDA;57.220.226.0001/15;100;390.048;1;Fatura;422;24/10/2024;23/11/2024;23/11/2024;25/11/2024;30.168,98
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
  if (!dataBR) return null;

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
 * Parseia arquivo CSV do Sistema CONFIANÇA
 * @param {string} csvContent - Conteúdo do arquivo CSV
 * @returns {Object} - { registros }
 */
const parseSistemaConfiancaCSV = (csvContent) => {
  const lines = csvContent.split('\n');

  if (lines.length < 2) {
    throw new Error('Arquivo CSV vazio ou inválido');
  }

  // Primeira linha é o cabeçalho
  const headerLine = lines[0].trim();
  const header = headerLine
    .split(';')
    .map((col) => col.trim().replace(/"/g, ''));

  // Mapear índices das colunas pelo nome
  const columnIndex = {};
  header.forEach((col, idx) => {
    columnIndex[col.toUpperCase()] = idx;
  });

  // Função para encontrar índice de coluna por nome parcial
  const findColumnIndex = (partialNames) => {
    for (const name of partialNames) {
      for (const [colName, idx] of Object.entries(columnIndex)) {
        if (colName.includes(name.toUpperCase())) {
          return idx;
        }
      }
    }
    return -1;
  };

  // Encontrar índices das colunas principais
  const idxCliente = findColumnIndex(['CLIENTE']);
  const idxCpfCnpj = findColumnIndex(['CPF/CNPJ', 'CNPJ', 'CPF']);
  const idxEmpresa = findColumnIndex(['EMPRESA']);
  const idxFatura = findColumnIndex(['FATURA']);
  const idxParcela = findColumnIndex(['PARCELA']);
  const idxDocumento = findColumnIndex(['DOCUMENTO']);
  const idxPortador = findColumnIndex(['PORTADOR']);
  const idxEmissao = findColumnIndex(['EMISSAO']);
  const idxVencOrig = findColumnIndex(['VENC.ORIG', 'VENC ORIG']);
  const idxVencimento = findColumnIndex(['VENCIMENTO']);
  const idxLiquidacao = findColumnIndex(['LIQUIDACAO', 'LIQUIDAÇÃO']);
  const idxValorFatura = findColumnIndex(['VALOR FATURA', 'VALOR']);

  // O CSV tem uma coluna extra no início (código cliente) e nome vem na posição 1
  // CLIENTE;;CPF/CNPJ -> posição 0 = código, 1 = nome, 2 = cpfcnpj
  // Detectar se segunda coluna está vazia (é nome do cliente)
  let idxNomeCliente = 1; // Posição padrão do nome

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

    // Pegar valores - ajustando para o formato específico do CSV
    // O CSV parece ter: código;nome;cpf;empresa;fatura;parcela;doc;portador;emissao;vencOrig;vencimento;liquidacao;valor
    const codigoCliente = values[0] || '';
    const nomeCliente = values[1] || '';
    const cpfCnpj = values[2] || '';
    const empresa = values[3] || '';
    const fatura = values[4] || '';
    const parcela = values[5] || '';
    const documento = values[6] || '';
    const portador = values[7] || '';
    const emissao = values[8] || '';
    const vencOrig = values[9] || '';
    const vencimento = values[10] || '';
    const liquidacao = values[11] || '';
    const valorFatura = values[12] || '';

    // Ignorar linhas vazias ou sem fatura
    if (!fatura || fatura.trim() === '') continue;

    const valor = parseValorBR(valorFatura);
    if (valor === 0) continue;

    // Criar registro no formato esperado pelo sistema (mesmo formato da API)
    const registro = {
      cd_cliente: codigoCliente,
      nm_cliente: nomeCliente,
      nr_cpfcnpj: normalizarCpfCnpj(cpfCnpj),
      cd_empresa: empresa,
      nr_fat: fatura,
      nr_parcela: parcela || '1',
      tp_documento: documento,
      cd_portador: portador,
      dt_emissao: parseDataBR(emissao),
      dt_vencimento_original: parseDataBR(vencOrig),
      dt_vencimento: parseDataBR(vencimento),
      dt_liquidacao: parseDataBR(liquidacao),
      vl_fatura: valor,
      // Campos adicionais para compatibilidade
      nr_fatura: fatura,
      situacao: liquidacao ? 'LIQUIDADO' : 'EM ABERTO',
      tipo_arquivo: 'SISTEMA',
      fonte: 'SISTEMA_CSV',
    };

    registros.push(registro);
  }

  return { registros };
};

/**
 * Processa arquivo CSV do Sistema CONFIANÇA
 * @param {Buffer|string} fileContent - Conteúdo do arquivo CSV
 * @returns {Object} - Objeto com registros processados e estatísticas
 */
const processSistemaConfiancaFile = (fileContent) => {
  try {
    // Converter buffer para string se necessário
    const content = Buffer.isBuffer(fileContent)
      ? fileContent.toString('utf-8')
      : fileContent;

    // Verificar se parece ser um CSV válido
    if (!content.includes(';')) {
      throw new Error(
        'Arquivo não parece ser um CSV válido (separador ; não encontrado)',
      );
    }

    const { registros } = parseSistemaConfiancaCSV(content);

    // Calcular estatísticas
    const stats = {
      totalRegistros: registros.length,
      tipoArquivo: 'SISTEMA',
      valorTotal: registros.reduce((sum, r) => sum + (r.vl_fatura || 0), 0),
      dataProcessamento: new Date().toISOString(),
    };

    return {
      success: true,
      registros,
      stats,
      tipoArquivo: 'SISTEMA',
      fonte: 'SISTEMA_CONFIANCA',
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      fonte: 'SISTEMA_CONFIANCA',
    };
  }
};

export { parseSistemaConfiancaCSV, processSistemaConfiancaFile };

export default processSistemaConfiancaFile;
