// Runner do sync TOTVS → HeadCoach: trava por entidade, registra em
// erp_sync_controle / erp_sync_log, controla o cursor do delta.
import { supabase, contar, agora } from '../db.js';
import { ENTIDADES, ORDEM, empresasProprias } from './entidades.js';

const TABELA_DA_ENTIDADE = {
  empresas: 'erp_empresas',
  pessoas_pf: 'erp_pessoas',
  pessoas_pj: 'erp_pessoas',
  representantes: 'erp_representantes',
  vendedores: 'erp_vendedores',
  produtos: 'erp_produtos',
  cores: 'erp_cores',
  grades: 'erp_grades',
  unidades: 'erp_unidades',
  classificacoes: 'erp_classificacoes',
  tabelas_preco: 'erp_tabelas_preco',
  precos: 'erp_precos',
  custos: 'erp_custos',
  precos_tabela: 'erp_precos_tabela',
  operacoes: 'erp_operacoes',
  condicoes_pagamento: 'erp_condicoes_pagamento',
  portadores: 'erp_portadores',
  despesas_centros: 'erp_despesas_itens',
  contas_pagar: 'accounts_payable_duplicates',
  contas_receber: 'accounts_receivable_documents',
  transacoes: 'general_transactions',
  bonus_saldo: 'person_balance_bonus_checks',
  vouchers: 'vouchers',
};

// Sobreposição do delta: o próximo delta começa 15 min antes do fim do anterior
const SOBREPOSICAO_MS = 15 * 60 * 1000;
// Sem cursor: delta cobre as últimas 48h
const DELTA_INICIAL_MS = 48 * 60 * 60 * 1000;

const emExecucao = new Map(); // entidade → { modo, iniciadoEm }

export const listarEntidades = () =>
  ORDEM.map((nome) => ({ nome, descricao: ENTIDADES[nome].descricao, temDelta: typeof ENTIDADES[nome].delta === 'function', tabela: TABELA_DA_ENTIDADE[nome] }));

export const emAndamento = () => [...emExecucao.entries()].map(([entidade, v]) => ({ entidade, ...v }));

async function contarLocal(entidade) {
  const tabela = TABELA_DA_ENTIDADE[entidade];
  if (!tabela) return null;
  if (entidade === 'pessoas_pf') return contar(tabela, (q) => q.eq('tipo', 'PF'));
  if (entidade === 'pessoas_pj') return contar(tabela, (q) => q.eq('tipo', 'PJ'));
  return contar(tabela);
}

async function empresasConhecidas() {
  const { data } = await supabase.from('erp_empresas').select('code').limit(2000);
  return (data || []).map((e) => e.code);
}

/**
 * Executa o sync de uma entidade.
 * @param {string} entidade
 * @param {'full'|'delta'} modo
 */
export async function executarSync(entidade, modo = 'delta', { disparadoPor = 'manual', log = console.log, opcoes = {} } = {}) {
  const ent = ENTIDADES[entidade];
  if (!ent) throw new Error(`Entidade desconhecida: ${entidade}`);
  if (modo === 'delta' && typeof ent.delta !== 'function') modo = 'full';
  if (emExecucao.has(entidade)) {
    const v = emExecucao.get(entidade);
    throw new Error(`Sync de ${entidade} já está rodando (${v.modo} desde ${v.iniciadoEm})`);
  }
  emExecucao.set(entidade, { modo, iniciadoEm: agora() });

  const { data: ctrl } = await supabase.from('erp_sync_controle').select('*').eq('entidade', entidade).maybeSingle();
  const inicio = new Date();
  const cursorDesde = modo === 'delta' ? new Date((ctrl?.cursor_ate ? new Date(ctrl.cursor_ate).getTime() : inicio.getTime() - DELTA_INICIAL_MS) - SOBREPOSICAO_MS) : null;

  const { data: logRow } = await supabase
    .from('erp_sync_log')
    .insert({ entidade, modo, iniciado_em: inicio.toISOString(), status: 'rodando', disparado_por: disparadoPor })
    .select('id')
    .single();
  await supabase
    .from('erp_sync_controle')
    .upsert({ entidade, descricao: ent.descricao, status: 'rodando', ultimo_erro: null, atualizado_em: agora() }, { onConflict: 'entidade' });

  const prefixo = `[erp-sync ${entidade}/${modo}]`;
  const ctxLog = (m) => log(`${prefixo} ${m}`);
  ctxLog(`início${cursorDesde ? ` (desde ${cursorDesde.toISOString()})` : ''}`);

  try {
    const ctx = {
      log: ctxLog,
      cursorDesde,
      cursorAte: inicio,
      empresasProprias: empresasProprias(),
      empresasTodas: await empresasConhecidas(),
      opcoes,
    };
    const res = (modo === 'delta' ? await ent.delta(ctx) : await ent.full(ctx)) || {};
    const totalLocal = await contarLocal(entidade);
    const duracao = Date.now() - inicio.getTime();
    const patch = {
      entidade,
      descricao: ent.descricao,
      status: 'ocioso',
      ultimo_erro: null,
      total_totvs: Number.isFinite(res.totalTotvs) ? res.totalTotvs : ctrl?.total_totvs ?? null,
      total_local: totalLocal,
      ultima_duracao_ms: duracao,
      cursor_ate: inicio.toISOString(),
      atualizado_em: agora(),
      ...(modo === 'delta' ? { ultimo_delta_em: agora() } : { ultimo_full_em: agora(), ultimo_delta_em: agora() }),
    };
    await supabase.from('erp_sync_controle').upsert(patch, { onConflict: 'entidade' });
    if (logRow?.id) {
      await supabase
        .from('erp_sync_log')
        .update({ status: 'ok', concluido_em: agora(), registros: res.registros || 0, paginas: res.paginas || 0, detalhes: res.detalhes || null })
        .eq('id', logRow.id);
    }
    ctxLog(`ok — ${res.registros || 0} registros, ${res.paginas || 0} páginas, ${Math.round(duracao / 1000)}s`);
    return { entidade, modo, ...res, duracaoMs: duracao, totalLocal };
  } catch (e) {
    const msg = (e?.message || String(e)).slice(0, 2000);
    await supabase
      .from('erp_sync_controle')
      .upsert({ entidade, descricao: ent.descricao, status: 'erro', ultimo_erro: msg, atualizado_em: agora() }, { onConflict: 'entidade' });
    if (logRow?.id) await supabase.from('erp_sync_log').update({ status: 'erro', concluido_em: agora(), erro: msg }).eq('id', logRow.id);
    ctxLog(`ERRO — ${msg}`);
    throw e;
  } finally {
    emExecucao.delete(entidade);
  }
}

/** Roda várias entidades em sequência (na ordem de dependência). Erros não interrompem as demais. */
export async function executarVarios(entidades, modo = 'delta', opts = {}) {
  const ordem = ORDEM.filter((n) => entidades.includes(n));
  const resultados = [];
  for (const nome of ordem) {
    try {
      resultados.push(await executarSync(nome, modo, opts));
    } catch (e) {
      resultados.push({ entidade: nome, modo, erro: e.message });
    }
  }
  return resultados;
}

export const executarTodos = (modo = 'full', opts = {}) => executarVarios(ORDEM, modo, opts);

// contas_pagar tem cron próprio (a cada 30 min) em jobs/erp-sync.job.js
export const ENTIDADES_COM_CRON_PROPRIO = ['contas_pagar', 'contas_receber', 'transacoes', 'bonus_saldo', 'vouchers'];
export const ENTIDADES_DELTA = ORDEM.filter((n) => typeof ENTIDADES[n].delta === 'function' && !ENTIDADES_COM_CRON_PROPRIO.includes(n));
export const ENTIDADES_PEQUENAS = ORDEM.filter((n) => !['pessoas_pf', 'pessoas_pj', 'produtos', 'precos', 'custos', 'precos_tabela', 'despesas_centros', ...ENTIDADES_COM_CRON_PROPRIO].includes(n));
