/**
 * Parser para arquivos da Confiança (portador 422)
 *
 * Suporta dois formatos exportados pelo sistema:
 *  - LIQUIDADO  : colunas incluem DATA_PAGA e VALO_PAGO
 *  - ABERTO     : colunas incluem DIAS_ATRA e caVALO_ATUA
 *
 * Delimiter: ponto-e-vírgula (;)
 * Encoding esperado: latin1 / windows-1252
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
  return null;
}

/**
 * Converte SACA_ID (CPF/CNPJ) que pode estar em notação científica brasileira.
 * Exemplo: "5,64202E+13" → "56420200000000"
 */
function parseSacaId(val) {
  if (!val) return '';
  let s = String(val)
    .trim()
    .replace(/^"(.*)"$/, '$1');

  // Notação científica com vírgula decimal (padrão BR quando salvo pelo Excel sem aspas)
  if (/^\d[\d,]*[Ee][+\-]?\d+$/.test(s)) {
    const num = Math.round(parseFloat(s.replace(',', '.')));
    return String(num);
  }

  // Remove formatação (., -, /) e retorna apenas dígitos
  return s.replace(/[^\d]/g, '');
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

export function processConfiancaFile(fileContent) {
  const lines = fileContent
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim());

  if (lines.length < 2) {
    throw new Error('Arquivo CONFIANÇA inválido ou vazio');
  }

  const rawHeader = parseLine(lines[0]);
  const header = rawHeader.map((h) =>
    stripQuotes(h).toUpperCase().replace(/\s+/g, '_'),
  );

  const hasDataPaga = header.includes('DATA_PAGA');
  const hasDiasAtra = header.includes('DIAS_ATRA');

  const registros = [];
  let countLiquidado = 0;
  let countAberto = 0;

  if (hasDataPaga) {
    // ── Formato LIQUIDADO ────────────────────────────────────────────────────
    const idx = {
      tituId: header.indexOf('TITU_ID'),
      numeDoct: header.indexOf('NUME_DOCT'),
      sacaId: header.indexOf('SACA_ID'),
      nome: header.indexOf('NOME'),
      valOriginal: header.indexOf('VALO_TITU_ORIG'),
      valPago: header.indexOf('VALO_PAGO'),
      valJuro: header.indexOf('VALO_JURO'),
      dataTitu: header.indexOf('DATA_TITU'),
      dataPaga: header.indexOf('DATA_PAGA'),
      situacao: header.indexOf('SITUACAO'),
      baixaDeta: header.indexOf('BAIX_CADA_DETA_ID'),
    };

    for (let i = 1; i < lines.length; i++) {
      const cols = parseLine(lines[i]);
      if (cols.length < 10) continue;

      const situacao = stripQuotes(cols[idx.situacao] ?? '');
      const isPago = situacao === 'BAIXADO';

      if (isPago) countLiquidado++;
      else countAberto++;

      registros.push({
        nosso_numero: stripQuotes(cols[idx.tituId] ?? ''),
        seu_numero: stripQuotes(cols[idx.numeDoct] ?? ''),
        nr_cpfcnpj: parseSacaId(cols[idx.sacaId]),
        nm_cliente: stripQuotes(cols[idx.nome] ?? ''),
        vl_original: parseValorBR(cols[idx.valOriginal]),
        vl_pago: isPago ? parseValorBR(cols[idx.valPago]) : 0,
        vl_juros: parseValorBR(cols[idx.valJuro]),
        dt_vencimento: parseDataBR(cols[idx.dataTitu]),
        dt_pagamento: isPago ? parseDataBR(cols[idx.dataPaga]) : null,
        situacao: isPago ? 'LIQUIDADO' : 'ABERTO',
        descricao_baixa: stripQuotes(cols[idx.baixaDeta] ?? ''),
        banco: 'CONFIANCA',
      });
    }
  } else if (hasDiasAtra) {
    // ── Formato ABERTO ───────────────────────────────────────────────────────
    // TITU_ID(0) FILI_ID(1) CLIE_ID(2) FANT(3) SEQU_BAIX(4) NUME_DOCT(5)
    // NUME_BANC(6) PERC_JURO(7) PERC_MULT(8) VALO_TITU(9) VALO_TITU_ORIG(10)
    // caVALO_JURO(11) caVALO_ATUA(12) DATA_TITU(13) DATA_DEPO(14)
    // SACA_ID(15) NOME(16) caSACADO(17) … SITUACAO(21) … DIAS_ATRA(26)
    const idx = {
      tituId: header.indexOf('TITU_ID'),
      numeDoct: header.indexOf('NUME_DOCT'),
      sacaId: header.indexOf('SACA_ID'),
      nome: header.indexOf('NOME'),
      valOriginal: header.indexOf('VALO_TITU_ORIG'),
      valAtual: header.findIndex(
        (h) => h.startsWith('CA') && h.includes('VALO_ATUA'),
      ),
      dataTitu: header.indexOf('DATA_TITU'),
      situacao: header.indexOf('SITUACAO'),
      diasAtra: header.indexOf('DIAS_ATRA'),
    };

    for (let i = 1; i < lines.length; i++) {
      const cols = parseLine(lines[i]);
      if (cols.length < 10) continue;

      countAberto++;

      registros.push({
        nosso_numero: stripQuotes(cols[idx.tituId] ?? ''),
        seu_numero: stripQuotes(cols[idx.numeDoct] ?? ''),
        nr_cpfcnpj: parseSacaId(cols[idx.sacaId]),
        nm_cliente: stripQuotes(cols[idx.nome] ?? ''),
        vl_original: parseValorBR(cols[idx.valOriginal]),
        vl_atualizado: idx.valAtual >= 0 ? parseValorBR(cols[idx.valAtual]) : 0,
        vl_pago: 0,
        vl_juros: 0,
        dt_vencimento: parseDataBR(cols[idx.dataTitu]),
        dt_pagamento: null,
        situacao: 'ABERTO',
        dias_atraso:
          idx.diasAtra >= 0
            ? parseInt(stripQuotes(cols[idx.diasAtra] ?? '0'), 10) || 0
            : 0,
        descricao_baixa: '',
        banco: 'CONFIANCA',
      });
    }
  } else {
    throw new Error(
      'Formato de arquivo CONFIANÇA não reconhecido. ' +
        'Esperado coluna DATA_PAGA (liquidado) ou DIAS_ATRA (aberto).',
    );
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
