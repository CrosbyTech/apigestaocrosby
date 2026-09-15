/**
 * Baixa dos títulos pagos via Pix Pagar.me no app BlueCard.
 *
 * O app cobra a fatura inteira pela Pagar.me e, quando o pagamento confirma,
 * manda o evento `pagamento.pix` para o webhook (routes/bluecardIntegracao).
 * Aqui esse evento vira SOLICITAÇÕES DE BAIXA na página Financeiro › Contas a
 * Receber › Solicitação de Baixa — uma por título/parcela do TOTVS — para o
 * financeiro conferir o crédito da Pagar.me e processar a baixa no ERP pelo
 * fluxo que já existe (mesma tabela `solicitacoes_baixa`, mesmo botão).
 *
 * Por que não baixar direto no TOTVS: o dinheiro da Pagar.me cai em conta
 * depois (D+1 ou mais), e a baixa precisa do banco/portador certo. A fila de
 * solicitações é onde o financeiro já faz essa conferência hoje.
 *
 * ── COMO O TÍTULO É LOCALIZADO ──
 *  1. Pelo `titulo` da parcela (`TOTVS-<receivableCode>-<installmentCode>`),
 *     quando o HeadCoach já casou o boleto com o app.
 *  2. Senão, entre os títulos EM ABERTO do cliente no TOTVS (pelo CPF): mesmo
 *     vencimento e mesmo valor da parcela; se ainda empatar, o mais antigo.
 *  3. Se não achar, a solicitação é criada mesmo assim, sem nr_fat/empresa,
 *     com o aviso "título não localizado" na observação: o financeiro vê e
 *     resolve na mão — melhor do que um pagamento sumir.
 *
 * ── IDEMPOTÊNCIA ──
 * `ref_externa` = `pagarme:<cobranca_id>:<parcela_id>` com índice único
 * (migrations/solicitacoes_baixa_origem.sql). Reentrega do evento não duplica
 * solicitação. Se a migração ainda não rodou, cai no fallback sem as colunas
 * novas e a dedupe passa a ser pela observação (busca textual).
 */
import supabase from '../config/supabase.js';
import { postTotvs, buscarClientePorCpf, TOTVS_STATUS_NORMAL } from './bluecardLimite.js';
import { getToken } from '../utils/totvsTokenManager.js';
import { getBranchesWithNames } from '../totvsrouter/totvsHelper.js';

const SOLICITANTE = {
  user_nome: 'BlueCard · Pix Pagar.me',
  user_email: 'bluecard@crosby.app',
};
export const FORMA_PAGAMENTO_PAGARME = 'pix_pagarme';

function centsParaReais(cents) {
  return Math.round(Number(cents || 0)) / 100;
}

function parseTitulo(externoId) {
  const m = /^TOTVS-(\d+)-(\d+)$/.exec(String(externoId || ''));
  return m ? { receivableCode: Number(m[1]), installmentCode: Number(m[2]) } : null;
}

/** Títulos normais (status 1) do cliente no TOTVS, abertos ou não. */
async function listarTitulosDoCliente(customerCode) {
  const itens = [];
  for (let page = 1; page <= 5; page++) {
    const resp = await postTotvs('/accounts-receivable/v2/documents/search', {
      filter: { customerCodeList: [Number(customerCode)], statusList: [TOTVS_STATUS_NORMAL] },
      page,
      pageSize: 100,
      order: '-issueDate',
    });
    itens.push(...(resp.data?.items || []));
    if (page >= (resp.data?.totalPages || 1)) break;
  }
  return itens.map((t) => ({
    receivableCode: Number(t.receivableCode),
    installmentCode: Number(t.installmentCode ?? 1),
    branchCode: t.branchCode ?? null,
    customerCode: t.customerCode ?? null,
    customerName: t.customerName ?? null,
    valorCents: Math.round(Number(t.installmentValue || 0) * 100),
    vencimento: (t.expiredDate || '').slice(0, 10) || null,
    emissao: (t.issueDate || '').slice(0, 10) || null,
    cd_portador: t.bearerCode ?? t.bearer?.code ?? null,
    nm_portador: t.bearerName ?? t.bearer?.name ?? null,
    aberto: !t.paymentDate && !t.settlementDate,
  }));
}

function localizarTitulo(parcela, titulos, usados) {
  const livre = (t) => !usados.has(`${t.receivableCode}-${t.installmentCode}`);

  const ref = parseTitulo(parcela.titulo);
  if (ref) {
    const exato = titulos.find(
      (t) =>
        t.receivableCode === ref.receivableCode &&
        t.installmentCode === ref.installmentCode &&
        livre(t),
    );
    if (exato) return { titulo: exato, criterio: 'titulo' };
  }

  const valor = Number(parcela.valor_cents || 0);
  const venc = String(parcela.vencimento || '').slice(0, 10);
  const candidatos = titulos
    .filter((t) => t.aberto && livre(t) && t.valorCents === valor && (!venc || t.vencimento === venc))
    .sort((a, b) => String(a.emissao).localeCompare(String(b.emissao)));
  if (candidatos.length) return { titulo: candidatos[0], criterio: venc ? 'vencimento+valor' : 'valor' };

  return null;
}

async function inserirSolicitacao(row) {
  const { error } = await supabase.from('solicitacoes_baixa').insert(row);
  if (!error) return 'inserida';
  if (error.code === '23505') return 'ja_existia';

  // Migração solicitacoes_baixa_origem.sql ainda não rodou → sem as colunas novas.
  if (/origem|ref_externa|column/i.test(error.message || '')) {
    const { origem, ref_externa, ...semNovas } = row;
    const { data: jaTem } = await supabase
      .from('solicitacoes_baixa')
      .select('id')
      .ilike('observacao', `%${ref_externa}%`)
      .limit(1);
    if (jaTem?.length) return 'ja_existia';
    const { error: e2 } = await supabase.from('solicitacoes_baixa').insert(semNovas);
    if (e2) throw new Error(`solicitacoes_baixa: ${e2.message}`);
    console.warn(
      `⚠️ [bluecard/baixa] ${origem}: gravado sem origem/ref_externa — rode migrations/solicitacoes_baixa_origem.sql`,
    );
    return 'inserida_sem_ref';
  }
  throw new Error(`solicitacoes_baixa: ${error.message}`);
}

/**
 * Abre as solicitações de baixa de um evento `pagamento.pix`.
 * Payload (BlueCard → HeadCoach):
 * {
 *   pagamento: {
 *     cobranca_id, order_id, charge_id, cpf, nome, customer_id,
 *     invoice_id, ciclo, valor_cents, encargos_cents, pago_em,
 *     parcelas: [{ parcela_id, titulo, numero, de, valor_cents, vencimento, compra_documento }]
 *   }
 * }
 */
export async function abrirSolicitacoesBaixaPix(body) {
  const pg = body?.pagamento || {};
  const parcelas = Array.isArray(pg.parcelas) ? pg.parcelas : [];
  if (!pg.cobranca_id) throw new Error('pagamento.cobranca_id ausente');
  if (!parcelas.length) throw new Error('pagamento.parcelas vazio');

  const cpf = String(pg.cpf || '').replace(/\D/g, '');
  let cliente = null;
  let titulos = [];
  if (cpf) {
    cliente = await buscarClientePorCpf(cpf).catch(() => null);
    if (cliente) titulos = await listarTitulosDoCliente(cliente.code).catch(() => []);
  }

  // código da filial → nome (CROSBY SHOPPING MIDWAY…) — só para a coluna
  // "portador" não ficar vazia quando o TOTVS não devolve o portador do título.
  let nomes = new Map();
  try {
    const lista = await getBranchesWithNames(await getToken());
    nomes = new Map((lista || []).map((b) => [Number(b.code), String(b.name || '')]));
  } catch {
    /* sem nomes: fica só o código */
  }
  const nomeFilial = (bc) => nomes.get(Number(bc)) || null;

  // Encargos (multa+juros do app) rateados proporcionalmente ao valor das parcelas
  const somaParcelas = parcelas.reduce((s, p) => s + Number(p.valor_cents || 0), 0) || 1;
  const encargos = Number(pg.encargos_cents || 0);
  const pagoEm = pg.pago_em ? new Date(pg.pago_em) : new Date();
  const dtPagamento = isNaN(pagoEm) ? new Date().toISOString().slice(0, 10) : pagoEm.toISOString().slice(0, 10);

  const usados = new Set();
  const resultado = { inseridas: 0, ja_existiam: 0, sem_titulo: 0, detalhes: [] };

  for (const p of parcelas) {
    const achado = localizarTitulo(p, titulos, usados);
    const t = achado?.titulo || null;
    if (t) usados.add(`${t.receivableCode}-${t.installmentCode}`);
    else resultado.sem_titulo++;

    const ref = parseTitulo(p.titulo);
    const jurosCents = Math.round((encargos * Number(p.valor_cents || 0)) / somaParcelas);
    const refExterna = `pagarme:${pg.cobranca_id}:${p.parcela_id}`;

    const obs = [
      `Pago via Pix Pagar.me no app BlueCard em ${dtPagamento}.`,
      `Pedido Pagar.me ${pg.order_id || '?'} · cobrança ${pg.cobranca_id}.`,
      `Parcela ${p.numero ?? '?'}/${p.de ?? '?'} do app` +
        (p.compra_documento ? ` (compra doc. ${p.compra_documento})` : '') +
        ` · valor ${centsParaReais(p.valor_cents).toFixed(2)}` +
        (jurosCents ? ` + encargos ${centsParaReais(jurosCents).toFixed(2)}` : '') +
        '.',
      t
        ? `Título TOTVS ${t.receivableCode}-${t.installmentCode} localizado por ${achado.criterio}.`
        : `⚠️ TÍTULO NÃO LOCALIZADO NO TOTVS${ref ? ` (app informou ${ref.receivableCode}-${ref.installmentCode})` : ''}${
            cliente ? '' : ' — CPF sem cadastro no TOTVS'
          }. Conferir manualmente.`,
      `[${refExterna}]`,
    ].join(' ');

    const row = {
      cd_empresa: t?.branchCode ?? null,
      cd_cliente: t?.customerCode ?? cliente?.code ?? null,
      nm_cliente: t?.customerName || cliente?.name || pg.nome || '',
      nr_fat: t?.receivableCode ?? ref?.receivableCode ?? null,
      nr_parcela: t?.installmentCode ?? ref?.installmentCode ?? p.numero ?? 1,
      vl_fatura: t ? centsParaReais(t.valorCents) : centsParaReais(p.valor_cents),
      vl_juros: centsParaReais(jurosCents),
      dt_vencimento: t?.vencimento || String(p.vencimento || '').slice(0, 10) || null,
      dt_emissao: t?.emissao || null,
      cd_portador: t?.cd_portador ?? null,
      nm_portador: t?.nm_portador || (t?.branchCode ? nomeFilial(t.branchCode) : null),
      comprovante_url: null,
      comprovante_path: null,
      status: 'pendente',
      user_id: null,
      ...SOLICITANTE,
      observacao: obs,
      dt_pagamento: dtPagamento,
      forma_pagamento: FORMA_PAGAMENTO_PAGARME,
      dados_cartao: null,
      origem: 'bluecard_pagarme',
      ref_externa: refExterna,
    };

    const r = await inserirSolicitacao(row);
    if (r === 'ja_existia') resultado.ja_existiam++;
    else resultado.inseridas++;
    resultado.detalhes.push({
      parcela_id: p.parcela_id,
      titulo: t ? `${t.receivableCode}-${t.installmentCode}` : null,
      criterio: achado?.criterio || null,
      resultado: r,
    });
  }

  console.log(
    `🔵 [bluecard] pagamento.pix cobrança=${pg.cobranca_id} cpf=${cpf || '?'} → ` +
      `${resultado.inseridas} solicitação(ões) de baixa aberta(s), ${resultado.ja_existiam} já existiam, ` +
      `${resultado.sem_titulo} sem título localizado`,
  );
  return resultado;
}
