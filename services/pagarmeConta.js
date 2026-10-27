// ============================================================
// PAGAR.ME — saldo das contas (recebedores) e extrato via API core/v5
//
// A Pagar.me é a adquirente (boletos + vendas online) com subconta da Stone;
// todo dia o financeiro transfere o saldo dela para a Stone. Aqui:
//   saldosPagarme()               → disponível / a receber / transferido por conta
//   extratoPagarme(contaId, per)  → operações de saldo do período
//   executarPagarme({...})        → importa o extrato no Extrato Bancário (conta
//                                   PAGARME <token>), grava stone_bot_saldos
//                                   (banco PAGARME) e saldo_bancario:
//                                   PAGARME (disponível) e PAGARME A RECEBER
//
// Roda no servidor (as chaves PAGARME_SECRET_KEY / _FABIO estão no Render):
// chamado pelo bot Stone no fim da execução, pelo botão da aba Bot Stone e
// pelo cron diário (jobs/pagarme-saldo.job.js). Só leitura na Pagar.me.
// ============================================================
import supabase from '../config/supabase.js';
import { CONTAS, pagarme } from './pagarmeBoletos.js';
import fluxo from './fluxoCaixaExt.js';
import { extratoPagarmeDaApi } from '../utils/extratoPagarmeApi.js';
import { registrarLog } from './stoneBot.js';

export const BANCO_SALDO_PAGARME = 'PAGARME';
export const BANCO_SALDO_PAGARME_RECEBER = 'PAGARME A RECEBER';
// token = identificação da conta no Extrato Bancário (mesmo da planilha "PAGARME CROSBY SET.xlsx")
const TOKEN = { crosby: 'CROSBY', fabio: 'FABIO' };

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const centavos = (v) => (v == null ? null : round2(Number(v) / 100));
const agora = () => new Date().toISOString();
const hojeBr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const menosDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

const recebedorCache = new Map(); // contaId → { id, name, document, em }

export function contasConfiguradas() {
  return Object.values(CONTAS)
    .filter((c) => c.sk)
    .map((c) => ({ id: c.id, nome: c.nome, token: TOKEN[c.id] || c.id.toUpperCase() }));
}

async function recebedorDe(contaId) {
  const c = recebedorCache.get(contaId);
  if (c && Date.now() - c.em < 6 * 3600 * 1000) return c;
  const r = await pagarme('GET', '/recipients?size=10', null, contaId);
  if (!r.ok) throw new Error(`Pagar.me ${contaId}: /recipients ${r.status} ${r.data?.message || ''}`);
  const lista = Array.isArray(r.data?.data) ? r.data.data : [];
  const ativo = lista.find((x) => x.status === 'active') || lista[0];
  if (!ativo?.id) throw new Error(`Pagar.me ${contaId}: nenhum recebedor na conta.`);
  const rec = { id: ativo.id, name: ativo.name, document: ativo.document, em: Date.now() };
  recebedorCache.set(contaId, rec);
  return rec;
}

/** Saldo de cada conta configurada (valores em reais). */
export async function saldosPagarme() {
  const out = [];
  for (const c of contasConfiguradas()) {
    try {
      const rec = await recebedorDe(c.id);
      const r = await pagarme('GET', `/recipients/${rec.id}/balance`, null, c.id);
      if (!r.ok) throw new Error(`/balance ${r.status} ${r.data?.message || JSON.stringify(r.data).slice(0, 120)}`);
      out.push({
        contaId: c.id,
        nome: c.nome,
        token: c.token,
        recebedor: { id: rec.id, nome: rec.name, documento: rec.document },
        disponivel: centavos(r.data.available_amount) ?? 0,
        aReceber: centavos(r.data.waiting_funds_amount) ?? 0,
        transferido: centavos(r.data.transferred_amount),
        bruto: r.data,
      });
    } catch (e) {
      out.push({ contaId: c.id, nome: c.nome, token: c.token, erro: e.message });
    }
  }
  return out;
}

/** Lista paginada (cursor forward_cursor ou page) com dedupe por id. */
async function listarTudo(contaId, path, { max = 60 } = {}) {
  const itens = new Map();
  const meta = { paginas: 0, cursores: 0, repetidas: 0, chavesPaging: null };
  let cursor = null;
  const sep = path.includes('?') ? '&' : '?';
  const buscar = async (q) => {
    const r = await pagarme('GET', q, null, contaId);
    if (!r.ok) {
      const e = new Error(`${path.split('?')[0]} ${r.status} ${r.data?.message || JSON.stringify(r.data).slice(0, 160)}`);
      e.status = r.status;
      throw e;
    }
    const lote = Array.isArray(r.data?.data) ? r.data.data : Array.isArray(r.data) ? r.data : [];
    if (!meta.chavesPaging && r.data?.paging) meta.chavesPaging = Object.keys(r.data.paging).join(',');
    let novos = 0;
    for (const x of lote) {
      const k = String(x.id ?? JSON.stringify(x).slice(0, 80));
      if (!itens.has(k)) {
        itens.set(k, x);
        novos += 1;
      }
    }
    return { lote, novos, next: r.data?.paging?.forward_cursor || r.data?.paging?.next_cursor || null };
  };
  for (let pagina = 1; pagina <= max; pagina++) {
    meta.paginas += 1;
    let res;
    if (pagina === 1) res = await buscar(`${path}${sep}size=100`);
    else {
      // a API aceita cursor (forward_cursor) ou página; testa as variantes até uma trazer itens novos
      const variantes = [];
      if (cursor) variantes.push(`${path}${sep}size=100&cursor=${encodeURIComponent(cursor)}`, `${path}${sep}size=100&cursor=${cursor}`);
      variantes.push(`${path}${sep}size=100&page=${pagina}`);
      for (const q of variantes) {
        res = await buscar(q);
        if (res.novos) break;
        meta.repetidas += 1;
      }
    }
    if (!res.lote.length || !res.novos) break;
    if (res.next) {
      meta.cursores += 1;
      cursor = res.next;
    } else if (res.lote.length < 100) break;
  }
  const lista = [...itens.values()];
  lista.meta = meta;
  return lista;
}
const resumoMeta = (lista) => (lista.meta ? `${lista.meta.paginas} pág${lista.meta.cursores ? `, cursor ${lista.meta.cursores}x` : ''}${lista.meta.repetidas ? ', página repetida' : ''}${lista.meta.chavesPaging ? ` [paging: ${lista.meta.chavesPaging}]` : ''}` : '');

const dentro = (iso, de, ate) => {
  const d = String(iso || '').slice(0, 10);
  return d >= de && d <= ate;
};

/**
 * Movimentos do período (datas ISO, inclusivas), montados pelas rotas que a
 * Pagar.me manteve (a /balance/operations está sendo descontinuada):
 *   - GET /payables?payment_date_since/until → recebíveis liquidados (entradas, estornos, chargebacks, com tarifa)
 *   - GET /transfers (ou /recipients/:id/withdrawals) → saques/transferências para a conta bancária (saídas)
 * Devolve "operações" no formato consumido por utils/extratoPagarmeApi.js
 * ({ id, type, created_at, amount, fee, movement_object }).
 */
export async function extratoPagarme(contaId, { de, ate }) {
  const rec = await recebedorDe(contaId);
  const operacoes = [];
  const fontes = [];

  // 1) recebíveis creditados no período
  const payables = await listarTudo(contaId, `/payables?payment_date_since=${de}T00:00:00&payment_date_until=${ate}T23:59:59`);
  let pagos = 0;
  for (const x of payables) {
    if (String(x.status || '') !== 'paid') continue; // waiting_funds/prepaid ainda não entraram no saldo
    if (!dentro(x.payment_date, de, ate)) continue;
    pagos += 1;
    const tipo = String(x.type || 'credit').toLowerCase(); // credit | refund | chargeback
    const bruto = Math.abs(Number(x.amount || 0)) * (tipo === 'credit' ? 1 : -1);
    const tarifa = Number(x.fee || 0) + Number(x.anticipation_fee || 0) + Number(x.fraud_coverage_fee || 0);
    operacoes.push({
      id: `pay_${x.id}`,
      type: 'payable',
      created_at: `${String(x.payment_date).slice(0, 10)}T12:00:00-03:00`,
      amount: bruto,
      fee: tipo === 'credit' ? -Math.abs(tarifa) : Math.abs(tarifa), // estorno devolve a tarifa
      movement_object: {
        object: 'payable',
        id: x.id,
        type: tipo,
        payment_method: x.payment_method,
        installment: x.installment,
        anticipation_id: x.anticipation_id || null,
        bulk_anticipation_id: x.bulk_anticipation_id || null,
        charge_id: x.charge_id || null,
        originator_model: x.originator_model || null,
      },
    });
  }
  fontes.push(`payables ${pagos}/${payables.length} (${resumoMeta(payables)})`);

  // 2) saques / transferências para a conta bancária
  let saidas = [];
  let origemSaida = null;
  const tentativas = [
    { rota: `/transfers?created_since=${de}T00:00:00&created_until=${ate}T23:59:59&recipient_id=${rec.id}`, nome: 'transfers' },
    { rota: `/settlements?recipient_id=${rec.id}&payment_date_start=${de}&payment_date_end=${ate}`, nome: 'settlements' },
    { rota: `/recipients/${rec.id}/withdrawals?created_since=${de}T00:00:00&created_until=${ate}T23:59:59`, nome: 'withdrawals' },
  ];
  const errosSaida = [];
  for (const t of tentativas) {
    try {
      const lista = await listarTudo(contaId, t.rota, { max: 20 });
      saidas = lista;
      origemSaida = t.nome;
      break;
    } catch (e) {
      errosSaida.push(`${t.nome}: ${e.message}`);
    }
  }
  if (!origemSaida) throw new Error(`saques indisponíveis — ${errosSaida.join(' | ')}`);
  // a Pagar.me bloqueia a LEITURA de /transfers por IP (26/10/2026); o bot não transfere nada,
  // só deixaria de mostrar a transferência diária como saída — aviso curto, sem erro
  if (errosSaida.some((e) => /IP de origem/i.test(e))) fontes.push('saídas: leitura de transferências bloqueada pela Pagar.me (IP) — só entradas');
  else if (errosSaida.length) fontes.push(`saídas: ${errosSaida.join(' | ')}`);
  let saquesNoPeriodo = 0;
  for (const s of saidas) {
    const status = String(s.status || '').toLowerCase();
    if (/fail|cancel/.test(status)) continue;
    const quando = s.funding_date || s.payment_date || s.settlement_date || s.created_at || s.date_created || s.updated_at;
    if (!dentro(quando, de, ate)) continue;
    saquesNoPeriodo += 1;
    operacoes.push({
      id: `tr_${s.id}`,
      type: 'transfer',
      created_at: quando,
      amount: -Math.abs(Number(s.amount || 0)),
      fee: -Math.abs(Number(s.fee || 0)),
      movement_object: { object: 'transfer', id: s.id, type: 'transfer', status, bank_account: s.bank_account || null, description: `${origemSaida === 'settlements' ? 'Liquidação' : 'Saque'} ${status}`, bruto: s },
    });
  }
  fontes.push(`${origemSaida} ${saquesNoPeriodo}/${saidas.length} (${resumoMeta(saidas)})`);

  return { recebedor: rec, operacoes, fontes };
}

/**
 * Executa a rotina completa (saldos + extratos + gravação).
 * @param {{execucaoId?:number, de?:string, ate?:string, diasRetroativos?:number}} p
 */
export async function executarPagarme({ execucaoId = null, de, ate, diasRetroativos = 3 } = {}) {
  const log = async (msg, nivel = 'info') => {
    console.log(`[pagarme] ${nivel}: ${msg}`);
    if (execucaoId) await registrarLog(execucaoId, { nivel, msg }).catch(() => {});
  };
  const dia = hojeBr();
  const periodo = { de: de || menosDias(dia, diasRetroativos), ate: ate || dia };
  const contas = contasConfiguradas();
  const resumo = { contas: contas.length, importados: 0, falhas: 0, disponivel: 0, aReceber: 0, saldos: [], avisos: [] };
  if (!contas.length) {
    await log('Pagar.me: nenhuma chave configurada no servidor (PAGARME_SECRET_KEY / PAGARME_SECRET_KEY_FABIO).', 'erro');
    return { ...resumo, falhas: 1 };
  }
  await log(`Pagar.me: ${contas.length} conta(s) (${contas.map((c) => c.nome).join(', ')}) · período ${periodo.de} a ${periodo.ate}`);

  const saldos = await saldosPagarme();
  const linhas = [];
  for (const s of saldos) {
    if (s.erro) {
      resumo.falhas += 1;
      await log(`Pagar.me ${s.nome}: saldo FALHOU — ${s.erro}`, 'erro');
      continue;
    }
    resumo.disponivel = round2(resumo.disponivel + s.disponivel);
    resumo.aReceber = round2(resumo.aReceber + s.aReceber);
    resumo.saldos.push({ conta: s.token, titular: s.recebedor.nome, disponivel: s.disponivel, aReceber: s.aReceber });
    linhas.push({
      execucao_id: execucaoId,
      banco: 'PAGARME',
      data: dia,
      stone_account_id: s.recebedor.id,
      agencia: null,
      conta: `PAGARME ${s.token}`,
      titular_nome: s.recebedor.nome,
      titular_cnpj: String(s.recebedor.documento || '').replace(/\D/g, '') || null,
      saldo: s.disponivel,
      saldo_a_receber: s.aReceber,
      saldo_transferido: s.transferido,
      saldo_bloqueado: null,
      saldo_agendado: null,
      capturado_em: agora(),
    });
    await log(`Pagar.me ${s.nome}: disponível R$ ${s.disponivel.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} · a receber R$ ${s.aReceber.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);

    // extrato
    try {
      const { recebedor, operacoes, fontes } = await extratoPagarme(s.contaId, periodo);
      const nome = `Pagarme_${s.token}_${periodo.de}_${periodo.ate}.api.json`;
      const extrato = extratoPagarmeDaApi({ token: s.token, recebedor, operacoes, saldo: s.bruto, periodo, nomeArquivo: nome });
      const r = await fluxo.importarVarios([{ extrato, nome, origem: 'bot-pagarme-api' }], { usuario: 'bot-stone' });
      const res = r.resultados[0];
      if (res.ok) {
        resumo.importados += 1;
        await log(`Pagar.me ${s.nome}: ${operacoes.length} movimento(s) (${fontes.join(', ')}) → ${res.qtd} lançamento(s) em ${res.conta}`, 'ok');
      } else {
        resumo.falhas += 1;
        await log(`Pagar.me ${s.nome}: importação FALHOU — ${res.erro}`, 'erro');
      }
    } catch (e) {
      resumo.falhas += 1;
      await log(`Pagar.me ${s.nome}: extrato FALHOU — ${e.message}`, 'erro');
    }
  }

  if (linhas.length) {
    const { error } = await supabase.from('stone_bot_saldos').upsert(linhas, { onConflict: 'data,conta' });
    if (error) throw new Error(`stone_bot_saldos: ${error.message}`);
    // só o DISPONÍVEL entra no saldo da Liberação; o "a receber" demora até 2 dias e fica fora da contagem (Yago, 27/10)
    const up = [{ banco: BANCO_SALDO_PAGARME, valor: resumo.disponivel, updated_at: agora(), updated_by: 'bot-pagarme' }];
    const { error: e2 } = await supabase.from('saldo_bancario').upsert(up, { onConflict: 'banco' });
    if (e2) throw new Error(`saldo_bancario: ${e2.message}`);
    await log(`Saldo PAGARME atualizado na Liberação de Pagamento: disponível R$ ${resumo.disponivel.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} · a receber R$ ${resumo.aReceber.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 'ok');
  }
  return resumo;
}

export default { contasConfiguradas, saldosPagarme, extratoPagarme, executarPagarme, BANCO_SALDO_PAGARME, BANCO_SALDO_PAGARME_RECEBER };
