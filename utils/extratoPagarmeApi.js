// ============================================================
// EXTRATO PAGAR.ME VIA API (core/v5 — operações de saldo do recebedor)
//
// GET /core/v5/recipients/:id/balance/operations devolve cada movimento do
// saldo: recebíveis liquidados (payable), transferências/saques (transfer),
// tarifas (fee_collection), estornos (refund/chargeback), antecipações…
// Aqui vira o MESMO objeto de extrato que a planilha .xlsx do painel produz
// (utils/extratosBancariosExtra.js → interpretarPagarme), com as mesmas
// formas/categorias, para cair na mesma conta PAGARME do Extrato Bancário.
// ============================================================
import { montarExtrato, FORMAS as F } from './extratosBancariosPdf.js';

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const centavos = (v) => (v == null || v === '' ? 0 : round2(Number(v) / 100));
const limpar = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');

function dataHoraBr(iso) {
  if (!iso) return { data: null, hora: null };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { data: String(iso).slice(0, 10), hora: null };
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const g = (t) => p.find((x) => x.type === t)?.value;
  return { data: `${g('year')}-${g('month')}-${g('day')}`, hora: `${g('hour')}:${g('minute')}` };
}

const METODO = { credit_card: 'Crédito', debit_card: 'Débito', boleto: 'Boleto', pix: 'PIX', voucher: 'Voucher', bank_transfer: 'TED' };

/**
 * Classifica uma operação de saldo no padrão da planilha (forma/categoria/descrição).
 * @returns {{forma, categoria, descricao, bandeira, tipoTxt, descTxt, metodoTxt}}
 */
export function classificarOperacaoPagarme(op, valor) {
  const tipo = String(op.type || '').toLowerCase();
  const mo = op.movement_object || {};
  const moTipo = String(mo.type || '').toLowerCase();
  const metodo = String(mo.payment_method || '').toLowerCase();
  const bandeiraRaw = limpar(mo.card?.brand || mo.brand || mo.card_brand || '');
  const antecipado = !!(mo.anticipation_id || mo.bulk_anticipation_id || /anticipat/i.test(tipo) || /anticipat/i.test(moTipo));
  const bandeira = bandeiraRaw ? bandeiraRaw.toUpperCase() : null;

  let forma = F.OUTROS;
  let categoria = 'outros';
  let descricao;
  let tipoTxt;
  let descTxt;
  const metodoTxt = METODO[metodo] || (metodo ? metodo.toUpperCase() : '');

  if (tipo === 'transfer' || tipo === 'transfer_fee' || /withdraw|saque/.test(tipo)) {
    forma = F.TED;
    categoria = 'transferencia';
    descricao = valor < 0 ? 'TRANSFERÊNCIA ENVIADA (SAQUE PAGAR.ME)' : 'TRANSFERÊNCIA RECEBIDA';
    tipoTxt = 'Transferência';
    descTxt = valor < 0 ? 'Saque para conta bancária' : 'Crédito';
  } else if (/fee|tarifa|gateway|service/.test(tipo) && tipo !== 'transfer_fee') {
    forma = F.TARIFA;
    categoria = 'tarifa';
    tipoTxt = 'Tarifa';
    descTxt = limpar(mo.description || op.description || tipo);
    descricao = `TARIFA PAGAR.ME: ${semAcento(descTxt).toUpperCase()}`;
  } else if (/refund|chargeback|estorno/.test(tipo) || /refund|chargeback/.test(moTipo)) {
    forma = metodo === 'pix' ? F.PIX : metodo === 'boleto' ? F.BOLETO : metodo === 'debit_card' ? F.CARTAO_DEBITO : F.CARTAO_CREDITO;
    categoria = metodo === 'pix' ? 'pix' : metodo === 'boleto' ? 'boleto' : 'cartao';
    tipoTxt = /chargeback/.test(`${tipo} ${moTipo}`) ? 'Chargeback' : 'Estorno';
    descTxt = metodoTxt || 'Transação';
    descricao = `${tipoTxt.toUpperCase()} ${metodoTxt.toUpperCase()}`.trim();
  } else if (antecipado) {
    forma = F.ANTECIPACAO;
    categoria = 'antecipacao';
    tipoTxt = 'Liquidação';
    descTxt = bandeira || metodoTxt || 'Antecipação';
    descricao = semAcento(`ANTECIPAÇÃO ${bandeira || (metodoTxt ? `CARTÃO ${metodoTxt}` : '')}`).toUpperCase().trim();
  } else if (metodo === 'pix') {
    forma = F.PIX;
    categoria = 'pix';
    tipoTxt = 'Transação';
    descTxt = 'Crédito';
    descricao = valor < 0 ? 'PAGAMENTO PIX' : 'RECEBIMENTO PIX (PAGAR.ME)';
  } else if (metodo === 'boleto') {
    forma = F.BOLETO;
    categoria = 'boleto';
    tipoTxt = 'Transação';
    descTxt = 'Crédito';
    descricao = valor < 0 ? 'PAGAMENTO BOLETO' : 'RECEBIMENTO BOLETO';
  } else if (metodo === 'credit_card' || metodo === 'debit_card' || bandeira) {
    forma = metodo === 'debit_card' ? F.CARTAO_DEBITO : F.CARTAO_CREDITO;
    categoria = 'cartao';
    tipoTxt = 'Transação';
    descTxt = metodoTxt || 'Crédito';
    descricao = `VENDA CARTÃO ${metodoTxt.toUpperCase()}`.trim();
  } else {
    tipoTxt = limpar(op.type || 'Operação');
    descTxt = limpar(mo.description || op.description || moTipo || '');
    descricao = semAcento(`${tipoTxt} ${descTxt}`).toUpperCase().trim();
  }
  return { forma, categoria, descricao, bandeira, tipoTxt, descTxt, metodoTxt };
}

/**
 * @param {object} p
 * @param {string} p.token    identificador curto da conta no Extrato Bancário ("CROSBY" | "FABIO")
 * @param {object} p.recebedor { id, name, document }
 * @param {object[]} p.operacoes operações de saldo (qualquer ordem)
 * @param {object} [p.saldo]  { available_amount, waiting_funds_amount, transferred_amount } (centavos)
 * @param {{de,ate}} p.periodo
 */
export function extratoPagarmeDaApi({ token, recebedor, operacoes, saldo, periodo, nomeArquivo }) {
  const validas = (operacoes || []).filter((op) => op && op.amount != null);
  validas.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)));
  const lancamentos = [];
  const avisos = ['Importado pelo bot via API da Pagar.me (operações de saldo).'];
  for (const op of validas) {
    const { data, hora } = dataHoraBr(op.created_at);
    const bruto = centavos(op.amount); // já assinado (+ entrada, − saída/estorno)
    const taxa = centavos(op.fee || 0); // negativa quando desconta, positiva quando devolve
    // no extrato gerencial entra o LÍQUIDO (como a planilha "Entrada líquida / Saída líquida")
    const valor = round2(bruto + taxa);
    if (!valor) continue;
    const cls = classificarOperacaoPagarme(op, valor);
    const memoPartes = [`${cls.tipoTxt} | ${cls.descTxt}${cls.metodoTxt && cls.descTxt !== cls.metodoTxt ? ` | ${cls.metodoTxt}` : ''}`];
    if (bruto && bruto !== valor) memoPartes.push(`bruto ${bruto.toFixed(2)}`);
    if (taxa) memoPartes.push(`taxa ${taxa.toFixed(2)}`);
    const mo = op.movement_object || {};
    if (Number(mo.installment) > 0) memoPartes.push(`parcela ${mo.installment}`);
    const saqueProprio = cls.categoria === 'transferencia' && valor < 0;
    lancamentos.push({
      pagina: null,
      data,
      hora,
      valor,
      saldoApos: null, // payables/transfers não trazem saldo corrente (só a /balance/operations, descontinuada)
      memo: memoPartes.join(' · '),
      descricao: cls.descricao,
      documento: String(mo.id || op.id || '') || null,
      forma: cls.forma,
      categoria: cls.categoria,
      // saque para a conta bancária do próprio recebedor: contraparte = a própria empresa,
      // para o casamento automático com a entrada na conta Stone (mesmo CNPJ)
      contraparteNome: saqueProprio ? limpar(recebedor?.name) || 'PAGAR.ME' : 'PAGAR.ME',
      contraparteDoc: saqueProprio ? String(recebedor?.document || '').replace(/\D/g, '') || null : null,
      contraparteBanco: saqueProprio ? 'Stone' : null,
      bandeira: cls.bandeira,
    });
  }
  if (!lancamentos.length) avisos.push('Pagar.me (API): nenhuma operação com valor no período.');

  return montarExtrato(
    'PAGARME',
    {
      titular: { nome: `PAGAR.ME ${token}`, cnpj: String(recebedor?.document || '').replace(/\D/g, '') || null, agencia: '', conta: token, contaDv: null },
      periodo: { inicio: periodo?.de || null, fim: periodo?.ate || null },
      saldoInicial: null,
      saldoFinalInformado: saldo?.available_amount != null ? centavos(saldo.available_amount) : null,
      lancamentos,
      avisos,
    },
    { nomeArquivo: nomeArquivo || null, paginas: 0 },
  );
}

export default { extratoPagarmeDaApi, classificarOperacaoPagarme };
