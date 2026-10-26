// ============================================================
// BOT STONE EXTRATOS — fila de execuções, log, saldos e importações.
//
// Quem roda o navegador é o agente local (bots/stone-extratos/bot.mjs) no PC
// do financeiro: ele pergunta aqui se há execução pendente, manda o log linha
// a linha, sobe cada PDF (ou o JSON da API do portal) e, no fim, os saldos.
//
// Tabelas (migrations/stone_bot.sql): stone_bot_execucoes, stone_bot_saldos,
// stone_bot_agentes. Saldo consolidado vai para saldo_bancario (banco 'STONE'),
// que é o que a tela Liberação de Pagamento soma.
// ============================================================
import os from 'node:os';
import supabase from '../config/supabase.js';
import fluxo, { guardarArquivoExtrato, MigrationPendingError } from './fluxoCaixaExt.js';
import { extratoStoneDaApi } from '../utils/extratoStoneApi.js';

const T = {
  exec: 'stone_bot_execucoes',
  saldos: 'stone_bot_saldos',
  agentes: 'stone_bot_agentes',
  saldoBancario: 'saldo_bancario',
};

export const BANCO_SALDO_STONE = 'STONE'; // chave usada pela Liberação de Pagamento (saldo_bancario.banco)
const RODANDO_MAX_MIN = 45; // execução "rodando" há mais que isso = agente caiu
const AGENTE_ONLINE_SEG = 150; // ping a cada 60 s → 2,5 min sem ping = offline

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const agora = () => new Date().toISOString();
const hojeBr = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

function lancar(error) {
  if (!error) return;
  if (/relation .*stone_bot.* does not exist|Could not find the table 'public\.stone_bot|schema cache/i.test(error.message || ''))
    throw new MigrationPendingError('Tabelas stone_bot_* não existem — rode migrations/stone_bot.sql.');
  throw new Error(error.message || String(error));
}

// ─── execuções ────────────────────────────────────────────────
export async function listarExecucoes({ limite = 20 } = {}) {
  const { data, error } = await supabase
    .from(T.exec)
    .select('id,status,origem,solicitado_por,parametros,resumo,erro,agente,criado_em,iniciado_em,concluido_em')
    .order('criado_em', { ascending: false })
    .limit(limite);
  lancar(error);
  return data || [];
}

export async function obterExecucao(id) {
  const { data, error } = await supabase.from(T.exec).select('*').eq('id', id).maybeSingle();
  lancar(error);
  if (!data) throw new Error('Execução não encontrada.');
  return data;
}

async function execucaoAberta() {
  const { data, error } = await supabase.from(T.exec).select('*').in('status', ['pendente', 'rodando']).order('criado_em', { ascending: true }).limit(5);
  lancar(error);
  return data || [];
}

/**
 * Enfileira uma execução. Se já houver uma pendente/rodando, devolve essa
 * (não duplica). parametros: { de, ate } (ISO) — sem eles o bot usa o padrão
 * (últimos N dias do config).
 */
export async function solicitarExecucao({ solicitadoPor, origem = 'manual', parametros = null } = {}) {
  await marcarInterrompidas();
  const abertas = await execucaoAberta();
  if (abertas.length) return { execucao: abertas[0], reaproveitada: true };
  const { data, error } = await supabase
    .from(T.exec)
    .insert({ status: 'pendente', origem, solicitado_por: solicitadoPor || null, parametros, log: [] })
    .select()
    .single();
  lancar(error);
  return { execucao: data, reaproveitada: false };
}

export async function cancelarExecucao(id, { por } = {}) {
  const ex = await obterExecucao(id);
  if (ex.status !== 'pendente') throw new Error(`Só dá para cancelar execução pendente (esta está "${ex.status}").`);
  const { data, error } = await supabase
    .from(T.exec)
    .update({ status: 'cancelado', concluido_em: agora(), erro: `Cancelada por ${por || 'usuário'}` })
    .eq('id', id)
    .select()
    .single();
  lancar(error);
  return data;
}

/** Execuções "rodando" há tempo demais viram erro (agente caiu no meio). */
async function marcarInterrompidas() {
  const limite = new Date(Date.now() - RODANDO_MAX_MIN * 60000).toISOString();
  const { error } = await supabase
    .from(T.exec)
    .update({ status: 'erro', erro: `Interrompida: sem resposta do agente por mais de ${RODANDO_MAX_MIN} min`, concluido_em: agora() })
    .eq('status', 'rodando')
    .lt('iniciado_em', limite);
  lancar(error);
}

// ─── agente ───────────────────────────────────────────────────
export async function pingAgente({ host, versao, sessaoOk, proximaAgendada, detalhes } = {}) {
  const { error } = await supabase
    .from(T.agentes)
    .upsert({ host: host || os.hostname(), versao: versao || null, sessao_ok: sessaoOk ?? null, proxima_agendada: proximaAgendada || null, detalhes: detalhes || null, ultimo_ping: agora() }, { onConflict: 'host' });
  lancar(error);
  return { ok: true };
}

/** Pega a execução pendente mais antiga e marca como rodando (claim). */
export async function proximaExecucao({ host } = {}) {
  await marcarInterrompidas();
  const { data: pend, error } = await supabase.from(T.exec).select('*').eq('status', 'pendente').order('criado_em', { ascending: true }).limit(1);
  lancar(error);
  if (!pend?.length) return null;
  const { data, error: e2 } = await supabase
    .from(T.exec)
    .update({ status: 'rodando', iniciado_em: agora(), agente: host || null })
    .eq('id', pend[0].id)
    .eq('status', 'pendente') // claim atômico: só um agente leva
    .select()
    .maybeSingle();
  lancar(e2);
  return data || null;
}

export async function registrarLog(id, linhas) {
  const ex = await obterExecucao(id);
  const novas = (Array.isArray(linhas) ? linhas : [linhas]).filter(Boolean).map((l) => ({
    t: l.t || agora(),
    nivel: l.nivel || 'info',
    msg: String(l.msg ?? l).slice(0, 2000),
  }));
  const log = [...(ex.log || []), ...novas].slice(-2000);
  const { error } = await supabase.from(T.exec).update({ log }).eq('id', id);
  lancar(error);
  return { total: log.length };
}

export async function finalizarExecucao(id, { status = 'concluido', resumo = null, erro = null } = {}) {
  const ok = ['concluido', 'erro'].includes(status) ? status : 'erro';
  const { data, error } = await supabase
    .from(T.exec)
    .update({ status: ok, resumo, erro: erro || null, concluido_em: agora() })
    .eq('id', id)
    .select()
    .single();
  lancar(error);
  return data;
}

// ─── extratos ─────────────────────────────────────────────────
/**
 * PDF oficial exportado do portal → guarda no Storage + importa pelo parser
 * do PDF (mesmo caminho do upload manual).
 */
export async function importarPdf(execucaoId, { buffer, nome, meta = {} }) {
  let arquivoPath = null;
  let avisoStorage = null;
  try {
    arquivoPath = await guardarArquivoExtrato(buffer, { nome, pasta: 'stone-bot' });
  } catch (e) {
    avisoStorage = e.message; // não bloqueia a importação
  }
  const r = await fluxo.importarVarios([{ buffer, nome, arquivoPath, origem: 'bot-stone-pdf' }], { usuario: 'bot-stone' });
  const res = r.resultados[0];
  if (avisoStorage) res.avisos = [...(res.avisos || []), `PDF não guardado no Storage: ${avisoStorage}`];
  res.arquivoPath = arquivoPath;
  res.meta = meta;
  await registrarLog(execucaoId, {
    nivel: res.ok ? 'ok' : 'erro',
    msg: res.ok
      ? `PDF ${nome}: ${res.conta} · ${res.qtd} lançamento(s) · ${res.periodo?.inicio} a ${res.periodo?.fim} · saldo final ${res.saldo?.final}`
      : `PDF ${nome}: FALHOU — ${res.erro}`,
  });
  return { ...res, transferencias: r.transferencias };
}

/**
 * Fallback: JSON da API do portal (conta + lançamentos + saldo) → extrato no
 * formato do parser → importa.
 */
export async function importarJson(execucaoId, { conta, entradas, saldo, periodo }) {
  const nome = `Stone_${conta?.account_code || 'conta'}_${periodo?.de || ''}_${periodo?.ate || ''}.api.json`;
  let extrato;
  try {
    extrato = extratoStoneDaApi({ conta, entradas, saldo, periodo, nomeArquivo: nome });
  } catch (e) {
    await registrarLog(execucaoId, { nivel: 'erro', msg: `API ${conta?.account_code}: não consegui montar o extrato — ${e.message}` });
    return { ok: false, arquivo: nome, erro: e.message };
  }
  const r = await fluxo.importarVarios([{ extrato, nome, origem: 'bot-stone-api' }], { usuario: 'bot-stone' });
  const res = r.resultados[0];
  await registrarLog(execucaoId, {
    nivel: res.ok ? 'ok' : 'erro',
    msg: res.ok
      ? `API ${conta?.account_code} (${conta?.owner_name || ''}): ${res.qtd} lançamento(s) · ${res.periodo?.inicio} a ${res.periodo?.fim} · saldo final ${res.saldo?.final}`
      : `API ${conta?.account_code}: FALHOU — ${res.erro}`,
  });
  return { ...res, transferencias: r.transferencias };
}

// ─── saldos ───────────────────────────────────────────────────
/**
 * Grava o saldo de cada conta (histórico) e consolida em saldo_bancario
 * (banco STONE = soma), que é o valor que a Liberação de Pagamento exibe.
 * @param saldos [{ accountId, agencia, conta, titular, cnpj, saldo, bloqueado, agendado }]
 */
export async function gravarSaldos(execucaoId, saldos, { data } = {}) {
  const dia = data || hojeBr();
  const linhas = (saldos || [])
    .filter((s) => s && s.conta && s.saldo != null && !Number.isNaN(Number(s.saldo)))
    .map((s) => ({
      execucao_id: execucaoId || null,
      banco: 'STONE',
      data: dia,
      stone_account_id: s.accountId || null,
      agencia: s.agencia || null,
      conta: String(s.conta),
      titular_nome: s.titular || null,
      titular_cnpj: s.cnpj ? String(s.cnpj).replace(/\D/g, '') : null,
      saldo: round2(s.saldo),
      saldo_bloqueado: s.bloqueado == null ? null : round2(s.bloqueado),
      saldo_agendado: s.agendado == null ? null : round2(s.agendado),
      capturado_em: agora(),
    }));
  if (!linhas.length) throw new Error('Nenhum saldo válido recebido.');
  const { error } = await supabase.from(T.saldos).upsert(linhas, { onConflict: 'data,conta' });
  lancar(error);

  const total = round2(linhas.reduce((a, l) => a + l.saldo, 0));
  const { error: e2 } = await supabase
    .from(T.saldoBancario)
    .upsert({ banco: BANCO_SALDO_STONE, valor: total, updated_at: agora(), updated_by: 'bot-stone' }, { onConflict: 'banco' });
  if (e2) throw new Error(`saldo_bancario: ${e2.message}`);

  if (execucaoId)
    await registrarLog(execucaoId, {
      nivel: 'ok',
      msg: `Saldo STONE atualizado na Liberação de Pagamento: R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${linhas.length} conta(s))`,
    });
  return { data: dia, contas: linhas.length, total };
}

export async function ultimosSaldos() {
  const { data: ult, error } = await supabase.from(T.saldos).select('data').order('data', { ascending: false }).limit(1);
  lancar(error);
  const dia = ult?.[0]?.data;
  if (!dia) return { data: null, contas: [], total: 0, porBanco: {} };
  const { data, error: e2 } = await supabase.from(T.saldos).select('*').eq('data', dia).order('banco').order('titular_nome');
  lancar(e2);
  const contas = (data || []).map((l) => ({ ...l, banco: l.banco || 'STONE' }));
  const porBanco = {};
  for (const l of contas) {
    const b = porBanco[l.banco] || (porBanco[l.banco] = { banco: l.banco, contas: 0, total: 0, aReceber: 0 });
    b.contas += 1;
    b.total = round2(b.total + Number(l.saldo));
    b.aReceber = round2(b.aReceber + Number(l.saldo_a_receber || 0));
  }
  const total = round2(contas.reduce((a, l) => a + Number(l.saldo), 0));
  return { data: dia, contas, total, porBanco };
}

export async function status() {
  await marcarInterrompidas();
  const [{ data: agentes, error }, execs, saldos] = await Promise.all([
    supabase.from(T.agentes).select('*').order('ultimo_ping', { ascending: false }),
    listarExecucoes({ limite: 15 }),
    ultimosSaldos(),
  ]);
  lancar(error);
  const lim = Date.now() - AGENTE_ONLINE_SEG * 1000;
  const lista = (agentes || []).map((a) => ({ ...a, online: new Date(a.ultimo_ping).getTime() >= lim }));
  const { data: sbs } = await supabase.from(T.saldoBancario).select('*').in('banco', [BANCO_SALDO_STONE, 'PAGARME', 'PAGARME A RECEBER']);
  const sb = (sbs || []).find((x) => x.banco === BANCO_SALDO_STONE);
  const linha = (b) => {
    const x = (sbs || []).find((y) => y.banco === b);
    return x ? { valor: Number(x.valor), atualizadoEm: x.updated_at, por: x.updated_by } : null;
  };
  return {
    agentes: lista,
    online: lista.some((a) => a.online),
    emAndamento: execs.find((e) => ['pendente', 'rodando'].includes(e.status)) || null,
    execucoes: execs,
    saldos,
    saldoLiberacao: sb ? { valor: Number(sb.valor), atualizadoEm: sb.updated_at, por: sb.updated_by } : null,
    saldoPagarme: linha('PAGARME'),
    saldoPagarmeReceber: linha('PAGARME A RECEBER'),
  };
}

export default {
  listarExecucoes,
  obterExecucao,
  solicitarExecucao,
  cancelarExecucao,
  pingAgente,
  proximaExecucao,
  registrarLog,
  finalizarExecucao,
  importarPdf,
  importarJson,
  gravarSaldos,
  ultimosSaldos,
  status,
};
