// Outbox HeadCoach → TOTVS.
//
//   enfileirar({ operacao, payload, chave?, origem_tabela?, origem_id?, empresa? })
//   processarPendentes({ limite })  — chamado pelo job a cada minuto
//   reprocessar(id) / cancelar(id) / listar() / estatisticas()
//
// Regras:
//   * chave (idempotência): mesma (destino, operacao, chave) não entra duas vezes
//   * backoff: 1m, 5m, 15m, 1h, 3h, 6h, 12h, 24h
//   * erro 4xx (exceto 408/429) = definitivo → status 'erro' sem novas tentativas
import { supabase, agora } from './db.js';
import { HANDLERS } from './outboxHandlers.js';
import { TotvsHttpError } from './totvsClient.js';
import { isTotvsBlocked } from '../../utils/totvsTokenManager.js';

const BACKOFF_MIN = [1, 5, 15, 60, 180, 360, 720, 1440];
const TRAVA_PROCESSANDO_MIN = 15; // item 'processando' há mais que isso volta pra pendente

export async function enfileirar({ destino = 'totvs', operacao, payload, chave = null, origem_tabela = null, origem_id = null, empresa = null, criado_por = null }) {
  if (!HANDLERS[operacao]) throw new Error(`operação de outbox desconhecida: ${operacao}`);
  const row = { destino, operacao, payload: payload ?? {}, chave, origem_tabela, origem_id: origem_id != null ? String(origem_id) : null, empresa, criado_por, status: 'pendente', proxima_tentativa: agora() };
  if (chave) {
    const { data: existente } = await supabase.from('integracao_outbox').select('id, status').eq('destino', destino).eq('operacao', operacao).eq('chave', chave).maybeSingle();
    if (existente) return { ...existente, duplicado: true };
  }
  const { data, error } = await supabase.from('integracao_outbox').insert(row).select('id, status').single();
  if (error) throw new Error(`outbox insert: ${error.message}`);
  return data;
}

async function registrarLog(outbox_id, tentativa, status, { http_status = null, erro = null, resposta = null, duracao_ms = null } = {}) {
  await supabase.from('integracao_outbox_log').insert({ outbox_id, tentativa, status, http_status, erro, resposta, duracao_ms });
}

async function processarItem(item, log) {
  const tentativa = (item.tentativas || 0) + 1;
  const t0 = Date.now();
  const handler = HANDLERS[item.operacao];
  if (!handler) {
    await supabase.from('integracao_outbox').update({ status: 'erro', tentativas: tentativa, ultimo_erro: `handler inexistente: ${item.operacao}`, atualizado_em: agora() }).eq('id', item.id);
    await registrarLog(item.id, tentativa, 'erro', { erro: `handler inexistente: ${item.operacao}` });
    return 'erro';
  }
  try {
    const { http_status, resposta } = await handler(item.payload, item);
    await supabase
      .from('integracao_outbox')
      .update({ status: 'enviado', tentativas: tentativa, http_status, resposta: resposta ?? null, ultimo_erro: null, enviado_em: agora(), processando_desde: null, atualizado_em: agora() })
      .eq('id', item.id);
    await registrarLog(item.id, tentativa, 'enviado', { http_status, resposta: resposta ?? null, duracao_ms: Date.now() - t0 });
    log(`[outbox] #${item.id} ${item.operacao} enviado (${Date.now() - t0}ms)`);
    return 'enviado';
  } catch (e) {
    const retryable = e instanceof TotvsHttpError ? e.retryable : true;
    const esgotou = tentativa >= (item.max_tentativas || 8);
    const definitivo = !retryable || esgotou;
    const minutos = BACKOFF_MIN[Math.min(tentativa - 1, BACKOFF_MIN.length - 1)];
    const patch = {
      status: definitivo ? 'erro' : 'pendente',
      tentativas: tentativa,
      http_status: e.status ?? null,
      resposta: e.data ?? null,
      ultimo_erro: (e.message || String(e)).slice(0, 2000),
      proxima_tentativa: definitivo ? item.proxima_tentativa : new Date(Date.now() + minutos * 60000).toISOString(),
      processando_desde: null,
      atualizado_em: agora(),
    };
    await supabase.from('integracao_outbox').update(patch).eq('id', item.id);
    await registrarLog(item.id, tentativa, definitivo ? 'erro' : 'retry', { http_status: e.status ?? null, erro: patch.ultimo_erro, resposta: e.data ?? null, duracao_ms: Date.now() - t0 });
    log(`[outbox] #${item.id} ${item.operacao} ${definitivo ? 'ERRO definitivo' : `falhou, retry em ${minutos}min`}: ${patch.ultimo_erro.slice(0, 200)}`);
    return definitivo ? 'erro' : 'retry';
  }
}

let processando = false;

export async function processarPendentes({ limite = 20, log = console.log } = {}) {
  if (processando) return { pulado: 'já em execução' };
  if (isTotvsBlocked()) return { pulado: 'TOTVS bloqueado' };
  processando = true;
  const resumo = { enviado: 0, retry: 0, erro: 0, total: 0 };
  try {
    // destrava itens presos em 'processando' (processo caiu no meio)
    const limiteTrava = new Date(Date.now() - TRAVA_PROCESSANDO_MIN * 60000).toISOString();
    await supabase.from('integracao_outbox').update({ status: 'pendente', processando_desde: null }).eq('status', 'processando').lt('processando_desde', limiteTrava);

    const { data: itens, error } = await supabase
      .from('integracao_outbox')
      .select('*')
      .eq('status', 'pendente')
      .lte('proxima_tentativa', agora())
      .order('proxima_tentativa', { ascending: true })
      .limit(limite);
    if (error) throw new Error(`outbox select: ${error.message}`);
    for (const item of itens || []) {
      const { data: travado } = await supabase
        .from('integracao_outbox')
        .update({ status: 'processando', processando_desde: agora() })
        .eq('id', item.id)
        .eq('status', 'pendente')
        .select('id');
      if (!travado?.length) continue; // outro worker pegou
      resumo.total += 1;
      const r = await processarItem(item, log);
      resumo[r] += 1;
    }
  } finally {
    processando = false;
  }
  return resumo;
}

export async function reprocessar(id) {
  const { data, error } = await supabase
    .from('integracao_outbox')
    .update({ status: 'pendente', proxima_tentativa: agora(), tentativas: 0, ultimo_erro: null, processando_desde: null, atualizado_em: agora() })
    .eq('id', id)
    .in('status', ['erro', 'cancelado', 'pendente'])
    .select()
    .single();
  if (error) throw new Error(`outbox reprocessar: ${error.message}`);
  return data;
}

export async function cancelar(id) {
  const { data, error } = await supabase
    .from('integracao_outbox')
    .update({ status: 'cancelado', atualizado_em: agora() })
    .eq('id', id)
    .in('status', ['pendente', 'erro'])
    .select()
    .single();
  if (error) throw new Error(`outbox cancelar: ${error.message}`);
  return data;
}

export async function listar({ status = null, operacao = null, limite = 100 } = {}) {
  let q = supabase.from('integracao_outbox').select('*').order('criado_em', { ascending: false }).limit(limite);
  if (status) q = q.eq('status', status);
  if (operacao) q = q.eq('operacao', operacao);
  const { data, error } = await q;
  if (error) throw new Error(`outbox listar: ${error.message}`);
  return data || [];
}

export async function logDe(id) {
  const { data, error } = await supabase.from('integracao_outbox_log').select('*').eq('outbox_id', id).order('criado_em', { ascending: false }).limit(50);
  if (error) throw new Error(`outbox log: ${error.message}`);
  return data || [];
}

export async function estatisticas() {
  const out = {};
  for (const st of ['pendente', 'processando', 'enviado', 'erro', 'cancelado']) {
    const { count } = await supabase.from('integracao_outbox').select('*', { count: 'exact', head: true }).eq('status', st);
    out[st] = count ?? 0;
  }
  const { count: atrasados } = await supabase.from('integracao_outbox').select('*', { count: 'exact', head: true }).eq('status', 'pendente').lte('proxima_tentativa', agora());
  out.prontos = atrasados ?? 0;
  return out;
}
