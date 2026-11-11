// ============================================================
// Mês do Banco Inter que não tem extrato, só o print da tela dizendo que não houve movimento
// ------------------------------------------------------------
// Crosby Distribuição e Confecção, conta 0001-9 | 4677101-8, junho/2023: "INTER SEM MOVIMENTAÇÃO EM JUNHO.jpg" —
// tela "Extrato" do internet banking com o filtro 01/06/23 a 30/06/23 e "Sem resultado para o filtro selecionado".
// O mês entra sem lançamentos; o saldo é o do fim de maio (56,46, "Saldo do dia" de 29/05 no PDF de maio).
// ============================================================
import crypto from 'node:crypto';

const TRANSCRITOS = [
  { arquivo: 'INTER SEM MOVIMENTAÇÃO EM JUNHO.jpg', agencia: '0001', conta: '4677101', contaDv: '8', titular: 'CROSBY DISTRIBUICAO E CONFECCAO LTDA', titularCnpj: '17177680000116', mes: '2023-06', fim: '2023-06-30', saldo: 56.46 },
];

function montar(t) {
  return {
    banco: 'INTER',
    bancoCodigo: '077',
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
      fonte: `Print do internet banking do Inter (${t.arquivo}): sem lançamentos no período; saldo = o do fim do mês anterior`,
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
    hash: crypto.createHash('sha1').update(`inter-transcrito|${t.conta}|${t.mes}|${t.saldo}`).digest('hex'),
  };
}

/** Leituras transcritas (uma por mês), no mesmo formato dos leitores. */
export function leiturasInterTranscritas() {
  return TRANSCRITOS.map(montar);
}

export default { leiturasInterTranscritas };
