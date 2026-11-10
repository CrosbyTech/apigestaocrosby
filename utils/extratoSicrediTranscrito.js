// ============================================================
// Extrato do Sicredi que só existe como DESENHO (PDF sem texto e sem imagem embutida)
// ------------------------------------------------------------
// Irmãos Varejo Comercial (raiz 53.661.116), conta 39355-0 da Sicredi Rio Grande do Norte, dezembro/2023:
// "FLAVIO FERREIRA EXTRATO DEZ 2023.pdf" — "EXTRATO DE CONTA CORRENTE", período 12/2023 a 12/2023,
// só a linha "S A L D O  A N T E R I O R  0,00" e "SALDO ATUAL: 0,00". Conta recém-aberta, sem movimento.
// Não há linha a transcrever: o mês entra com saldo 0,00 → 0,00 e nenhum lançamento.
// ============================================================
import crypto from 'node:crypto';

const TRANSCRITOS = [
  { arquivo: 'FLAVIO FERREIRA EXTRATO DEZ 2023.pdf', agencia: '2207', conta: '39355', contaDv: '0', titular: 'IRMAOS VAREJO COMERCIAL LTDA', titularCnpj: '53661116000138', mes: '2023-12', fim: '2023-12-31', saldo: 0 },
];

function montar(t) {
  return {
    banco: 'SICREDI',
    bancoCodigo: '748',
    formato: 'pdf',
    layout: 'transcrito',
    agencia: t.agencia,
    conta: t.conta,
    contaDv: t.contaDv,
    titular: t.titular,
    titularCnpj: t.titularCnpj,
    arquivo: t.arquivo,
    mesReferencia: t.mes,
    periodo: { inicio: `${t.mes}-01`, fim: t.fim },
    saldoInicial: t.saldo,
    saldoFinal: t.saldo,
    lancamentos: [],
    conferencia: {
      fonte: `PDF do Sicredi só desenho (${t.arquivo}): SALDO ANTERIOR e SALDO ATUAL impressos, sem lançamentos`,
      saldoInicial: t.saldo,
      totalCreditos: 0,
      totalDebitos: 0,
      saldoCalculado: t.saldo,
      saldoFinalInformado: t.saldo,
      diferencaFinal: 0,
      saldosDiariosConferidos: 0,
      divergencias: [],
      bate: true,
    },
    paginas: 1,
    hash: crypto.createHash('sha1').update(`sicredi-transcrito|${t.conta}|${t.mes}|${t.saldo}`).digest('hex'),
  };
}

/** Leituras transcritas (uma por mês), no mesmo formato dos leitores. */
export function leiturasSicrediTranscritas() {
  return TRANSCRITOS.map(montar);
}

export default { leiturasSicrediTranscritas };
