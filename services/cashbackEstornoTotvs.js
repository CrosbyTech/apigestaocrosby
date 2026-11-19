// ============================================================================
// CASHBACK USADO VOLTA QUANDO A VENDA É CANCELADA (Yago, 19/11/2026)
//
// No PDV Crosby o cashback do cliente é usado como desconto e baixado logo
// depois de a venda ser registrada (totvsrouter/pdv.js → /pdv/bonus/consume).
// Se a venda é cancelada — inclusive a que nem chegou a ter a nota autorizada —
// o cliente tem de receber o cashback de volta. Caso que originou: venda 378 do
// Midway (19/11/2026), R$ 104,20 de cashback usados, nota rejeitada, venda
// cancelada e o saldo do cliente ficou zerado.
//
// O que volta por aqui é a parte que saiu do SALDO BÔNUS DO TOTVS (o cashback
// antigo): lança o valor de novo no TOTVS (person/v2/bonus-due-date), na loja de
// onde saiu, valendo PDV_BONUS_VALIDADE_DIAS dias a partir de hoje (a validade
// original não é conhecida). A parte usada do cashback novo do HeadCoach
// (hc_cashback_mov) volta pelo próprio serviço dele (cashbackHc.js).
//
// NÃO PRESUME A BAIXA. A venda guarda o desconto de cashback (cashback_usado)
// mesmo quando a baixa no TOTVS falha (venda 245 do Midway, 17/11/2026: venda
// repetida, saldo já gasto pela primeira, nada baixado na segunda). Por isso a
// rota de baixa registra na venda o que saiu de verdade (pedido_info.cashbackBaixa)
// e o cancelamento devolve só o que está registrado. Venda anterior a esse
// registro fica "a conferir": só volta por decisão de quem confere
// (devolverCashbackTotvsDaVenda com semRegistro: true).
//
// Uma vez por venda: o que foi devolvido fica em pedido_info.cashbackDevolvido.
// Credev e adiantamento usados já voltam pelo estorno de saldos (hcSaldosClientes).
// ============================================================================
import axios from 'axios';
import supabase from '../config/supabase.js';
import { getToken } from '../utils/totvsTokenManager.js';
import { httpsAgent, httpAgent, TOTVS_BASE_URL } from '../totvsrouter/totvsHelper.js';

const BONUS_TYPE = parseInt(process.env.PDV_BONUS_TYPE || '14', 10);
const BONUS_VALIDADE_DIAS = parseInt(process.env.PDV_BONUS_VALIDADE_DIAS || '90', 10);
const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const diaBrasil = (d = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Recife' }).format(d);

export class CashbackEstornoError extends Error {
  constructor(message, code = 'CASHBACK_ESTORNO', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// soma [{ branchCode, valor }] por loja
function porLoja(partes) {
  const m = new Map();
  for (const p of partes || []) {
    const loja = Number(p?.branchCode);
    const valor = r2(p?.valor || 0);
    if (!loja || !(valor > 0)) continue;
    m.set(loja, r2((m.get(loja) || 0) + valor));
  }
  return m;
}
const emPartes = (m) => [...m.entries()].map(([branchCode, valor]) => ({ branchCode, valor }));
const somaDe = (m) => r2([...m.values()].reduce((t, v) => t + v, 0));

/**
 * Registra na venda o cashback que SAIU do saldo bônus do TOTVS (chamada pela
 * rota de baixa, com sucesso ou com baixa parcial). Não lança: a baixa já foi feita.
 * A venda é a informada (vendaId) ou — telas que não mandam o número — a mais
 * recente do cliente com aquele valor de cashback nos últimos 15 minutos.
 * @param consumido [{ branchCode, valor }] o que foi baixado no TOTVS, por loja
 * @returns {number|null} id da venda em que ficou registrado
 */
export async function registrarBaixaDoCashback({ vendaId = null, personCode = null, usedValue = null, consumido = [], erro = null } = {}) {
  try {
    let venda = null;
    const id = parseInt(vendaId, 10);
    if (id) {
      const { data } = await supabase.from('pdv_vendas').select('id, pedido_info').eq('id', id).maybeSingle();
      venda = data || null;
    } else if (personCode && usedValue > 0) {
      const desde = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from('pdv_vendas')
        .select('id, pedido_info')
        .eq('cliente_code', parseInt(personCode, 10))
        .eq('cashback_usado', r2(usedValue))
        .gte('criado_em', desde)
        .order('id', { ascending: false })
        .limit(1);
      venda = data?.[0] || null;
    }
    if (!venda) {
      console.warn(`⚠️ [cashback] baixa de ${brl(usedValue)} do cliente ${personCode}: não achei a venda para registrar (${JSON.stringify(consumido)})`);
      return null;
    }
    const antes = venda.pedido_info?.cashbackBaixa || null;
    const soma = porLoja([...(antes?.totvs || []), ...(consumido || [])]);
    const cashbackBaixa = { totvs: emPartes(soma), total: somaDe(soma), em: new Date().toISOString(), ...(erro ? { erro: String(erro).slice(0, 200) } : {}) };
    const { error } = await supabase.from('pdv_vendas').update({ pedido_info: { ...(venda.pedido_info || {}), cashbackBaixa } }).eq('id', venda.id);
    if (error) throw new Error(error.message);
    return venda.id;
  } catch (e) {
    console.error(`❌ [cashback] baixa de ${brl(usedValue)} do cliente ${personCode} feita no TOTVS, mas o registro na venda ${vendaId || '?'} não foi gravado: ${e.message}`);
    return null;
  }
}

// parte do cashback da venda que saiu do cashback novo do HeadCoach (essa volta por lá)
async function usadoDoHeadcoach(vendaId) {
  const { data, error } = await supabase.from('hc_cashback_mov').select('valor').eq('venda_id', Number(vendaId)).eq('movimento', 'uso');
  if (error) return 0; // tabela do cashback novo ainda não existe: tudo veio do TOTVS
  return r2(-(data || []).reduce((s, m) => s + Number(m.valor), 0));
}

/**
 * Quanto de cashback do TOTVS a venda usou e ainda não voltou.
 * → {
 *   usado, doHeadcoach,
 *   semRegistro  — a venda não tem o registro da baixa (anterior a 19/11/2026)
 *   doTotvs      — o que saiu do TOTVS (registrado; sem registro, o presumido)
 *   jaDevolvido, devolvido (registro ou null)
 *   aDevolver    — volta sozinho ao cancelar (só com a baixa registrada)
 *   aConferir    — sem registro da baixa: alguém confere antes de devolver
 *   partes       — [{ branchCode, valor }] ainda a devolver, por loja
 * }
 */
export async function situacaoDoCashbackUsado(venda) {
  const usado = r2(venda?.cashback_usado || 0);
  const registro = venda?.pedido_info?.cashbackDevolvido || null;
  const baixa = venda?.pedido_info?.cashbackBaixa || null;
  const semRegistro = !baixa;
  const devolvidoPorLoja = porLoja(registro?.partes || (registro?.valor > 0 ? [{ branchCode: registro.empresa, valor: registro.valor }] : []));
  const jaDevolvido = somaDe(devolvidoPorLoja);

  const doHeadcoach = usado > 0 ? Math.min(usado, await usadoDoHeadcoach(venda.id)) : 0;
  // com o registro: o que a rota de baixa anotou; sem ele: presume o que não saiu do HeadCoach, na loja da venda
  const baixadoPorLoja = semRegistro ? porLoja([{ branchCode: venda?.empresa, valor: r2(usado - doHeadcoach) }]) : porLoja(baixa.totvs);
  const doTotvs = somaDe(baixadoPorLoja);

  // o que falta voltar: primeiro loja a loja; se o devolvido foi lançado em outra loja, abate do resto
  const falta = new Map();
  let sobra = 0;
  for (const [loja, v] of devolvidoPorLoja) if (!baixadoPorLoja.has(loja)) sobra = r2(sobra + v);
  for (const [loja, v] of baixadoPorLoja) {
    let f = r2(v - (devolvidoPorLoja.get(loja) || 0));
    if (f < 0) {
      sobra = r2(sobra - f);
      f = 0;
    }
    falta.set(loja, f);
  }
  for (const [loja, f] of falta) {
    if (!(sobra > 0)) break;
    const tira = Math.min(sobra, f);
    falta.set(loja, r2(f - tira));
    sobra = r2(sobra - tira);
  }
  const partes = emPartes(falta).filter((p) => p.valor > 0);
  const pendente = r2(partes.reduce((t, p) => t + p.valor, 0));
  return {
    usado,
    doHeadcoach,
    doTotvs,
    semRegistro,
    jaDevolvido,
    aDevolver: semRegistro ? 0 : pendente,
    aConferir: semRegistro ? pendente : 0,
    partes,
    devolvido: registro,
  };
}

const emCurso = new Set(); // uma devolução por venda de cada vez

// lança o bônus de volta no TOTVS (trocável nos testes)
let lancarNoTotvs = async (payload) => {
  const tk = await getToken();
  if (!tk?.access_token) throw new CashbackEstornoError('Não foi possível obter o token do TOTVS', 'TOKEN_UNAVAILABLE', 503);
  const r = await axios.post(`${TOTVS_BASE_URL}/person/v2/bonus-due-date`, payload, { headers: { Authorization: `Bearer ${tk.access_token}` }, httpsAgent, httpAgent, timeout: 60000 });
  return r.data ?? {};
};
export function __trocarLancamento(fn) {
  lancarNoTotvs = fn;
}

/**
 * Devolve ao cliente o cashback do TOTVS que a venda CANCELADA usou.
 * Pode ser chamada de novo: não devolve duas vezes.
 * Sem o registro da baixa (venda antiga) NÃO devolve — a menos que quem conferiu
 * mande semRegistro: true (aí devolve o presumido, na loja da venda).
 * @returns {{ devolvido:number, jaDevolvido:number, aConferir:number, empresa:number|null, valeAte:string|null, motivo?:string }}
 */
export async function devolverCashbackTotvsDaVenda(vendaId, { por = null, motivo = null, semRegistro = false } = {}) {
  const id = Number(vendaId);
  if (emCurso.has(id)) throw new CashbackEstornoError('A devolução do cashback desta venda já está em andamento', 'EM_ANDAMENTO', 409);
  emCurso.add(id);
  try {
    const { data: venda, error } = await supabase.from('pdv_vendas').select('id, empresa, status, tipo_venda, cliente_code, cliente_nome, cashback_usado, pedido_info').eq('id', id).maybeSingle();
    if (error) throw new CashbackEstornoError(error.message, 'DB_ERROR', 500);
    if (!venda) throw new CashbackEstornoError('Venda não encontrada', 'NOT_FOUND', 404);
    const s = await situacaoDoCashbackUsado(venda);
    const nada = (porque, aConferir = 0) => ({ devolvido: 0, jaDevolvido: s.jaDevolvido, aConferir, empresa: null, valeAte: null, motivo: porque });
    if (!(s.usado > 0)) return nada('a venda não usou cashback');
    if (venda.status !== 'cancelada') throw new CashbackEstornoError('O cashback só volta com a venda cancelada', 'VENDA_NAO_CANCELADA', 409);
    const valor = s.semRegistro ? s.aConferir : s.aDevolver;
    if (!(valor > 0)) return nada(s.jaDevolvido > 0 ? 'o cashback desta venda já foi devolvido' : s.doHeadcoach > 0 ? 'o cashback desta venda saiu do HeadCoach e volta por lá' : 'nada foi baixado do cashback do cliente nesta venda');
    if (s.semRegistro && !semRegistro) return nada('a venda é anterior ao registro da baixa do cashback: é preciso conferir o saldo do cliente antes de devolver', s.aConferir);
    if (!venda.cliente_code) throw new CashbackEstornoError('Venda sem cliente identificado: não há a quem devolver o cashback', 'SEM_CLIENTE', 409);

    const hoje = new Date();
    const valeAte = diaBrasil(new Date(hoje.getTime() + BONUS_VALIDADE_DIAS * 86400000));
    const feitas = porLoja(s.devolvido?.partes || (s.devolvido?.valor > 0 ? [{ branchCode: s.devolvido.empresa, valor: s.devolvido.valor }] : []));
    let pedidoInfo = venda.pedido_info || {};
    let devolvidoAgora = 0;
    const gravar = async () => {
      const registro = {
        valor: somaDe(feitas),
        empresa: Number(venda.empresa),
        partes: emPartes(feitas),
        destino: 'totvs',
        valeAte,
        em: hoje.toISOString(),
        por: por || null,
        motivo: motivo || null,
        ...(s.semRegistro ? { semRegistroDaBaixa: true } : {}),
      };
      pedidoInfo = { ...pedidoInfo, cashbackDevolvido: registro };
      const { error: e2 } = await supabase.from('pdv_vendas').update({ pedido_info: pedidoInfo }).eq('id', id);
      if (e2) console.error(`❌ [cashback] venda ${id}: ${brl(devolvidoAgora)} devolvidos no TOTVS, mas o registro não foi gravado (${e2.message}) — NÃO devolver de novo à mão`);
    };
    // loja a loja, de onde saiu; o registro é gravado a cada lançamento (uma falha no meio não duplica na nova tentativa)
    for (const p of s.partes) {
      try {
        await lancarNoTotvs({
          branchCode: p.branchCode,
          personCode: Number(venda.cliente_code),
          bonusType: BONUS_TYPE,
          movementDate: diaBrasil(hoje),
          bonusValue: p.valor,
          startDate: diaBrasil(hoje),
          endDate: valeAte,
          historic: `Estorno do cashback usado na venda ${venda.id} do HeadCoach (cancelada)`.slice(0, 100),
        });
      } catch (err) {
        if (err instanceof CashbackEstornoError) throw err;
        const d = err.response?.data;
        const msg = Array.isArray(d) ? d.map((x) => x.message).join('; ') : d?.message || err.message;
        throw new CashbackEstornoError(`O TOTVS não aceitou a devolução do cashback${devolvidoAgora > 0 ? ` (${brl(devolvidoAgora)} de ${brl(valor)} já voltaram)` : ''}: ${msg}`, 'TOTVS_RECUSOU', 502);
      }
      feitas.set(p.branchCode, r2((feitas.get(p.branchCode) || 0) + p.valor));
      devolvidoAgora = r2(devolvidoAgora + p.valor);
      await gravar();
    }
    console.log(
      `🎁 [cashback] venda ${id} cancelada: ${brl(devolvidoAgora)} de cashback de volta para o cliente ${venda.cliente_code} ${venda.cliente_nome || ''} no TOTVS (${s.partes.map((p) => `empresa ${p.branchCode}: ${brl(p.valor)}`).join(', ')}; vale até ${valeAte})${s.semRegistro ? ' · sem registro da baixa, conferido à mão' : ''}${por ? ` · ${por}` : ''}`,
    );
    return { devolvido: devolvidoAgora, jaDevolvido: s.jaDevolvido, aConferir: 0, empresa: Number(venda.empresa), valeAte };
  } finally {
    emCurso.delete(id);
  }
}

/**
 * Vendas canceladas que usaram cashback do TOTVS e ainda não tiveram a devolução.
 * aDevolver = baixa registrada (é só devolver); aConferir = venda sem o registro da baixa.
 */
export async function cashbackPendenteDeDevolucao({ desde = null, empresas = null } = {}) {
  let q = supabase.from('pdv_vendas').select('id, empresa, status, cliente_code, cliente_nome, cashback_usado, total, criado_em, pedido_info').eq('status', 'cancelada').gt('cashback_usado', 0).order('id', { ascending: false }).limit(500);
  if (desde) q = q.gte('criado_em', desde);
  if (Array.isArray(empresas) && empresas.length) q = q.in('empresa', empresas);
  const { data, error } = await q;
  if (error) throw new CashbackEstornoError(error.message, 'DB_ERROR', 500);
  const out = [];
  for (const v of data || []) {
    const s = await situacaoDoCashbackUsado(v);
    if (s.aDevolver > 0 || s.aConferir > 0) {
      out.push({ vendaId: v.id, empresa: v.empresa, cliente: { code: v.cliente_code, nome: v.cliente_nome }, criadoEm: v.criado_em, usado: s.usado, aDevolver: s.aDevolver, aConferir: s.aConferir, semRegistro: s.semRegistro });
    }
  }
  return out;
}
