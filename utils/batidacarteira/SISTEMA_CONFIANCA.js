/**
 * Parser para arquivo CSV exportado do sistema (portador Confiança = 422)
 *
 * Formato:
 *   CLIENTE;;CPF/CNPJ;EMPRESA;FATURA;PARCELA;DOCUMENTO;PORTADOR;EMISSAO;
 *   VENC.ORIG.;VENCIMENTO;LIQUIDACAO;VALOR FATURA
 *
 * Linhas de totalização "TOTAL MES" são ignoradas.
 * O resultado substitui os dados do sistema (setDados) no frontend.
 *
 * Encoding esperado: UTF-8 ou latin1
 */

function parseValorBR(val) {
  if (!val) return 0;
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
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
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

function parseCpfCnpj(val) {
  if (!val) return '';
  // Formato: "57.220.226.0001/15" → remove tudo que não é dígito
  return String(val)
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .replace(/[^\d]/g, '');
}

export function processSistemaConfiancaFile(fileContent) {
  // Remove BOM se existir
  const content = fileContent.replace(/^\uFEFF/, '');
  const lines = content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim());

  if (lines.length < 2) {
    throw new Error('Arquivo de sistema Confiança inválido ou vazio');
  }

  // Validar cabeçalho
  const headerLine = parseLine(lines[0]);
  const headerStr = headerLine.join(';').toUpperCase();
  if (
    !headerStr.includes('FATURA') &&
    !headerStr.includes('CPF') &&
    !headerStr.includes('PARCELA')
  ) {
    throw new Error(
      'Cabeçalho do arquivo não reconhecido como exportação do sistema Confiança',
    );
  }

  /**
   * Posições fixas do layout:
   *  0  = código cliente
   *  1  = nome cliente
   *  2  = CPF/CNPJ
   *  3  = empresa
   *  4  = fatura
   *  5  = parcela
   *  6  = documento
   *  7  = portador
   *  8  = emissão
   *  9  = venc. original
   *  10 = vencimento (corrigido)
   *  11 = liquidação
   *  12 = valor fatura
   */

  const registros = [];
  let countLiquidado = 0;
  let countAberto = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i]);
    if (cols.length < 10) continue;

    // Ignorar linhas de totalização
    const linha = cols.join(';').toUpperCase();
    if (
      linha.includes('TOTAL MES') ||
      linha.includes('TOTAL MÊS') ||
      // linhas onde os primeiros campos são vazios e há "TOTAL"
      (stripQuotes(cols[0]) === '' &&
        stripQuotes(cols[4]) === '' &&
        stripQuotes(cols[12]) !== '')
    ) {
      continue;
    }

    const cdCliente = stripQuotes(cols[0]);
    // Linha inválida se não tiver código de cliente
    if (!cdCliente) continue;

    const dtLiquidacao = parseDataBR(cols[11]);
    const isPago = !!dtLiquidacao;

    if (isPago) countLiquidado++;
    else countAberto++;

    registros.push({
      cd_cliente: cdCliente,
      nm_cliente: stripQuotes(cols[1]),
      nr_cpfcnpj: parseCpfCnpj(cols[2]),
      nr_empresa: stripQuotes(cols[3]),
      nr_fat: stripQuotes(cols[4]),
      nr_parcela: stripQuotes(cols[5]),
      nr_documento: stripQuotes(cols[6]),
      portador: stripQuotes(cols[7]),
      dt_emissao: parseDataBR(cols[8]),
      dt_vencimento_orig: parseDataBR(cols[9]),
      dt_vencimento: parseDataBR(cols[10]),
      dt_pagamento: dtLiquidacao,
      vl_fatura: parseValorBR(cols[12]),
      vl_pago: isPago ? parseValorBR(cols[12]) : 0,
      situacao: isPago ? 'LIQUIDADO' : 'ABERTO',
      banco: 'CONFIANCA',
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
    (s, r) => s + (r.vl_fatura || 0),
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
