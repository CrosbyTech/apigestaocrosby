// ============================================================
// Extratos da Caixa que só existem como IMAGEM e não têm OFX do mês
// ------------------------------------------------------------
// FA Modas (Fabio Ferreira de Lima Azevedo), conta 2044 | 1292 | 000578136459-1, março, agosto e
// setembro de 2023: PDFs "caixa_mar23.pdf", "caixa_ago23.pdf" e "caixa_set23.pdf" do Gerenciador CAIXA
// (emitidos em 02/01/2025, layout "Lançamentos de … à …"), que são desenho sem texto.
// As linhas abaixo foram transcritas do PDF. A coluna Saldo do extrato vem SEM sinal; cada linha é
// conferida aqui pelo saldo impresso (|saldo recalculado| = saldo impresso) e os três meses fecham com
// os vizinhos lidos pelo leitor: fev termina 0,00 → mar; jul termina 43,51 → ago → set termina 6.217,66 = out.
// ============================================================
import crypto from 'node:crypto';
import { HISTORICOS_CAIXA } from './extratoCaixaOfx.js';

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const CONTA = { agencia: '02044', conta: '000578136459', contaDv: '1', titular: 'FABIO FERREIRA DE LIMA AZEVEDO', titularCnpj: '27728810000115' };

// [dia, documento, histórico, valor (com sinal), saldo impresso (sem sinal)]
const TRANSCRITOS = [
  {
    arquivo: 'caixa_mar23.pdf',
    mes: '2023-03',
    fim: '2023-03-31',
    saldoInicial: 0,
    linhas: [
      ['06', '22023', 'DB CEST PJ', -69.0, 69.0],
      ['06', '727220', 'RESG AUTOM', 69.0, 0.0],
      ['13', '460', 'CRED EMPR', 247620.58, 247620.58],
      ['14', '942070', 'SEGURADORA', -9574.5, 238046.08],
      ['15', '108060', 'ENVIO TED', -235000.0, 3046.08],
      ['15', '108060', 'DOC/TED PESSOAL', -22.0, 3024.08],
      ['16', '161725', 'CRED PIX', 1500.0, 4524.08],
      ['16', '82563', 'PREV CAIXA', -4500.0, 24.08],
      ['21', '211539', 'ENVIO TEV', -800.0, 775.92],
      ['21', '727220', 'RESG AUTOM', 775.92, 0.0],
    ],
  },
  {
    arquivo: 'caixa_ago23.pdf',
    mes: '2023-08',
    fim: '2023-08-31',
    saldoInicial: 43.51,
    linhas: [
      ['07', '72010', 'CRED PIX', 50.0, 93.51],
      ['07', '72023', 'DB CEST PJ', -69.0, 24.51],
      ['08', '81425', 'CRED PIX', 9000.0, 9024.51],
      ['09', '373218', 'CX PROGRAM', 1135.05, 10159.56],
      ['10', '800741', 'SEGURADORA', -1129.68, 9029.88],
      ['14', '5460', 'PREST EMPR', -8227.08, 802.8],
      ['25', '251608', 'CRED PIX', 5000.0, 5802.8],
      ['25', '251653', 'DP DIN LOT', 1007.0, 6809.8],
      ['25', '0', 'PREST EMP', -5364.84, 1444.96],
    ],
  },
  {
    arquivo: 'caixa_set23.pdf',
    mes: '2023-09',
    fim: '2023-09-30',
    saldoInicial: 1444.96,
    linhas: [
      ['04', '41251', 'DP DIN LOT', 671.0, 2115.96],
      ['05', '51510', 'DP DIN LOT', 240.0, 2355.96],
      ['05', '82023', 'DB CEST PJ', -69.0, 2286.96],
      ['11', '111426', 'CRED TEV', 1341.0, 3627.96],
      ['11', '112330', 'CRED PIX', 9000.0, 12627.96],
      ['13', '131042', 'DP DIN LOT', 1478.0, 14105.96],
      ['13', '6460', 'PREST EMPR', -8238.36, 5867.6],
      ['20', '201904', 'CRED PIX', 5000.0, 10867.6],
      ['21', '211721', 'CRED PIX', 11000.0, 21867.6],
      ['25', '0', 'PREST EMP', -10232.23, 11635.37],
      ['25', '0', 'PREST EMP', -5417.71, 6217.66],
    ],
  },
];

function montar(t) {
  let corrente = round2(t.saldoInicial);
  const divergencias = [];
  const lancamentos = t.linhas.map(([dia, documento, historico, valor, saldoImpresso], i) => {
    corrente = round2(corrente + valor);
    const data = `${t.mes}-${dia}`;
    if (Math.abs(Math.abs(corrente) - saldoImpresso) > 0.005) divergencias.push({ seq: i + 1, data, historico, saldoCalculado: corrente, saldoInformado: saldoImpresso, diferenca: round2(saldoImpresso - Math.abs(corrente)) });
    return {
      seq: i + 1,
      pagina: 1,
      data,
      dataBalancete: data,
      documento: documento && !/^0+$/.test(documento) ? documento : null,
      historico,
      historicoBase: historico,
      historicoDescricao: HISTORICOS_CAIXA[historico] || null,
      valor: round2(valor),
      natureza: valor < 0 ? 'D' : 'C',
      saldoInformado: corrente, // sinal pelo recálculo (o extrato imprime sem sinal)
      saldoApos: corrente,
      contraparteNome: null,
      contraparteDoc: null,
      hora: null,
    };
  });
  const totalCreditos = round2(lancamentos.filter((l) => l.valor > 0).reduce((s, l) => s + l.valor, 0));
  const totalDebitos = round2(lancamentos.filter((l) => l.valor < 0).reduce((s, l) => s - l.valor, 0));
  return {
    banco: 'CAIXA',
    bancoCodigo: '104',
    formato: 'pdf',
    layout: 'transcrito',
    ...CONTA,
    arquivo: t.arquivo,
    mesReferencia: t.mes,
    periodo: { inicio: `${t.mes}-01`, fim: t.fim },
    saldoInicial: round2(t.saldoInicial),
    saldoFinal: corrente,
    lancamentos,
    conferencia: {
      fonte: `PDF Caixa só imagem (${t.arquivo}), transcrito: saldo após cada linha conferido com o saldo impresso (sem sinal)`,
      saldoInicial: round2(t.saldoInicial),
      totalCreditos,
      totalDebitos,
      saldoCalculado: corrente,
      saldoFinalInformado: corrente,
      diferencaFinal: 0,
      saldosDiariosConferidos: lancamentos.length,
      divergencias,
      bate: divergencias.length === 0,
    },
    paginas: 1,
    hash: crypto.createHash('sha1').update(`caixa-transcrito|${CONTA.conta}|${t.mes}|${JSON.stringify(t.linhas)}`).digest('hex'),
  };
}

/** Leituras transcritas (uma por mês), no mesmo formato dos leitores. */
export function leiturasCaixaTranscritas() {
  return TRANSCRITOS.map(montar);
}

export default { leiturasCaixaTranscritas };
