// ============================================================
// EXTRATO STONE VIA API DO PORTAL (bot Stone Extratos)
//
// O bot local (bots/stone-extratos) navega logado em conta.stone.com.br e
// reaproveita a API que o próprio portal consome (api.openbank.stone.com.br,
// contrato público em docs.openbank.stone.com.br):
//   GET /api/v1/accounts                     → contas acessíveis
//   GET /api/v1/accounts/:id/balance         → saldo (centavos)
//   GET /api/v1/accounts/:id/statement       → lançamentos (centavos, cursor)
//
// Quando o bot não consegue exportar o PDF oficial, manda esse JSON e o
// backend monta o MESMO objeto de extrato que o parser do PDF produz
// (utils/extratosBancariosPdf.js → montarExtrato), reaproveitando o
// classificador Stone (memo no formato "NOME - Transferência | Pix").
// ============================================================
import { montarExtrato, classificarStoneNormalizado } from './extratosBancariosPdf.js';

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const centavos = (v) => (v == null || v === '' ? null : round2(Number(v) / 100));
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const limpar = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** "2026-10-25T13:45:10Z" → { data: '2026-10-25', hora: '10:45' } em horário de Brasília */
function dataHoraBr(iso) {
  if (!iso) return { data: null, hora: null };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { data: String(iso).slice(0, 10), hora: null };
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const g = (t) => p.find((x) => x.type === t)?.value;
  return { data: `${g('year')}-${g('month')}-${g('day')}`, hora: `${g('hour')}:${g('minute')}` };
}

const nomeContraparte = (e) => limpar(e?.counter_party?.entity?.name || e?.counter_party?.name || e?.details?.recipient_name || e?.title || '');

/**
 * Monta o memo no formato do extrato PDF/OFX da Stone a partir de uma entrada
 * da API, para o classificador existente reconhecer o lançamento.
 */
export function memoDaEntrada(e) {
  const tipo = String(e.type || '').toLowerCase();
  const desc = limpar(e.description || '');
  const nome = nomeContraparte(e);
  const deb = Number(e.amount) < 0 || String(e.operation).toLowerCase() === 'debit';
  // endpoint fma (o que o portal usa): title/subtitle são exatamente o texto do extrato
  // ("FABIO ... - Transferência | Pix", "Recebimento vendas - Elo | Débito", "Depósito por boleto")
  const title = limpar(e.title || '');
  const subtitle = limpar(e.subtitle || '');
  if (title) return subtitle ? `${title} - ${subtitle}` : title;
  // a descrição do portal já costuma vir no formato "NOME - Transferência | Pix"
  if (/\s-\s.*\|/.test(desc) || /^recebimento vendas/i.test(desc) || /^tarifa do boleto$/i.test(desc) || /^dep[óo]sito por boleto$/i.test(desc)) return desc;
  if (tipo === 'instant_payment') return `${nome || desc || 'PIX'} - ${/devolu/i.test(desc) ? 'Devolução' : 'Transferência'} | Pix`;
  if (tipo === 'internal') return `${nome || desc || 'CONTA STONE'} - Transferência | Conta Stone`;
  if (tipo === 'external' || tipo === 'external_refund') return `${nome || desc || 'TED'} - ${tipo === 'external_refund' ? 'Devolução' : 'Transferência'} | TED`;
  if (tipo === 'payment' || tipo === 'payment_refund') return `${nome || e?.details?.bank_name || desc || 'PAGAMENTO'} - Pagamento`;
  if (tipo === 'card_payment') return `${nome || desc || 'CARTÃO'} - ${deb ? 'Débito' : 'Crédito'} | Pré-pago`;
  if (tipo === 'balance_block') return desc || 'Bloqueio de saldo';
  return desc || nome || tipo || 'Lançamento Stone';
}

/**
 * Ordena as entradas pela cadeia de saldo (balance_before de uma = balance_after
 * da anterior). A API devolve lançamentos do mesmo segundo (lotes de Pix,
 * vendas de cartão) em ordem arbitrária, e aí o saldo corrente não fecha;
 * cada entrada traz o saldo antes/depois, então a ordem real é reconstruível.
 * Onde a cadeia quebra (saldo repetido/ausente), cai para a ordem de created_at.
 */
export function ordenarPelaCadeiaDeSaldo(entradas) {
  entradas.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  if (entradas.length < 2 || entradas.some((e) => e.balance_before == null || e.balance_after == null)) return entradas;
  // Lançamentos "gêmeos" (depósito de boleto + tarifa do boleto) compartilham
  // o MESMO id e o mesmo saldo antes/depois (o par é um movimento só): viram
  // uma unidade da cadeia. Saldos iguais em momentos diferentes (conta zera e
  // recebe o mesmo valor de novo) NÃO são gêmeos — por isso a chave é o id.
  const unidades = [];
  const porId = new Map();
  for (const e of entradas) {
    const k = e.id ? String(e.id) : `${e.created_at}|${e.balance_before}|${e.balance_after}`;
    if (!porId.has(k)) {
      porId.set(k, []);
      unidades.push(porId.get(k));
    }
    porId.get(k).push(e);
  }
  const antes = (u) => Number(u[0].balance_before);
  const depois = (u) => Number(u[0].balance_after);
  const restantes = [...unidades];
  const ordenadas = [];
  // começa pela unidade cujo saldo anterior não é o saldo posterior de nenhuma outra
  const posteriores = new Set(restantes.map(depois));
  let atual = restantes.find((u) => !posteriores.has(antes(u))) || restantes[0];
  while (atual) {
    ordenadas.push(...atual);
    restantes.splice(restantes.indexOf(atual), 1);
    const alvo = depois(atual);
    atual = restantes.find((u) => antes(u) === alvo) || null; // restantes já está em ordem de created_at
    if (!atual && restantes.length) {
      // cadeia quebrada: retoma pelo próximo "início" que sobrou
      const post = new Set(restantes.map(depois));
      atual = restantes.find((u) => !post.has(antes(u))) || restantes[0];
    }
  }
  entradas.splice(0, entradas.length, ...ordenadas);
  return entradas;
}

/**
 * @param {object} p
 * @param {object} p.conta   { id, account_code, branch_code, owner_name, owner_document }
 * @param {object[]} p.entradas entradas do statement (qualquer ordem)
 * @param {object} [p.saldo] { balance, blocked_balance, scheduled_balance } em centavos (saldo atual)
 * @param {{de:string, ate:string}} p.periodo
 * @returns extrato no formato de lerExtratoBancario()
 */
export function extratoStoneDaApi({ conta, entradas, saldo, periodo, nomeArquivo }) {
  if (!conta?.account_code) throw new Error('Conta Stone sem account_code.');
  // A conta precisa casar com a que o PDF cria (chave banco+agência+conta):
  // o PDF traz agência "0001" e conta "21774800" + DV "3". A API traz
  // branch_code "1" e account_code SEMPRE com o DV junto ("217748003",
  // "83579664" = 8357966-4; confirmado em 26/10/2026 nas 15 contas) → normaliza.
  const contaDigitos = soDigitos(conta.account_code);
  const dvSeparado = conta.account_dv ? soDigitos(conta.account_dv) : null;
  const temDvJunto = !dvSeparado && contaDigitos.length >= 2;
  const titular = {
    nome: limpar(conta.owner_name) || null,
    cnpj: soDigitos(conta.owner_document) || null,
    agencia: (soDigitos(conta.branch_code || '1') || '1').padStart(4, '0'),
    conta: temDvJunto ? contaDigitos.slice(0, -1) : contaDigitos,
    contaDv: dvSeparado || (temDvJunto ? contaDigitos.slice(-1) : null),
  };

  const validas = (entradas || []).filter((e) => e && e.amount != null && !/CANCEL|FAILED|REJECT/i.test(String(e.status || '')));
  ordenarPelaCadeiaDeSaldo(validas);

  const lancamentos = validas.map((e, i) => {
    const { data, hora } = dataHoraBr(e.created_at);
    // No endpoint fma, depósito de boleto / Pix da maquininha vêm com `amount`
    // LÍQUIDO (fee_amount já descontado) e a tarifa aparece de novo como
    // lançamento próprio ("Cobrança de tarifa"). Como no PDF, usa o bruto
    // (operation_amount) e deixa a tarifa na linha dela.
    const temTarifaSeparada = Number(e.fee_amount || 0) !== 0 && e.operation_amount != null;
    const deb = Number(e.amount) < 0 || String(e.operation).toLowerCase() === 'debit';
    const valor = temTarifaSeparada ? (deb ? -1 : 1) * Math.abs(centavos(e.operation_amount)) : centavos(e.amount);
    const memo = memoDaEntrada(e);
    const l = {
      pagina: null,
      data,
      hora,
      valor,
      saldoApos: centavos(e.balance_after),
      memo,
      bancoContraparte: e?.counter_party?.account?.institution_name || null,
      documento: e.id || e.operation_id || null,
      ordemApi: i,
    };
    const cls = classificarStoneNormalizado(l);
    const doc = soDigitos(e?.counter_party?.entity?.document || e?.details?.recipient_cpf_cnpj || '');
    return { ...l, ...cls, documento: l.documento, contraparteDoc: doc.length === 11 || doc.length === 14 ? doc : null };
  });

  // saldo anterior ao 1º lançamento vem pronto da API (balance_before); o
  // cálculo "saldoApos − valor" falharia nos pares gêmeos (mesmo saldo)
  const primeiraEntrada = validas[0];
  const primeiro = lancamentos[0];
  const saldoInicial = primeiraEntrada?.balance_before != null ? centavos(primeiraEntrada.balance_before) : primeiro?.saldoApos != null ? round2(primeiro.saldoApos - primeiro.valor) : null;
  const avisos = [];
  const saldoAtual = saldo?.balance != null ? centavos(saldo.balance) : null;
  if (!lancamentos.length) avisos.push('Stone (API): nenhum lançamento no período.');
  avisos.push('Importado pelo bot via API do portal Stone (sem o PDF oficial).');

  return montarExtrato(
    'STONE',
    {
      titular,
      periodo: { inicio: periodo?.de || null, fim: periodo?.ate || null },
      saldoInicial,
      // sem lançamentos: o saldo final do período é o saldo atual da conta
      saldoFinalInformado: lancamentos.at(-1)?.saldoApos ?? (lancamentos.length ? null : saldoAtual),
      lancamentos,
      avisos,
    },
    { nomeArquivo: nomeArquivo || null, paginas: 0 },
  );
}

export default { extratoStoneDaApi, memoDaEntrada };
