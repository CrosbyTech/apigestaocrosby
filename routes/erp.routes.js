// ============================================================================
// ERP HeadCoach — fase 0. Montado em /api/erp (exige sessão do HeadCoach;
// escrita só admin/owner).
//
//   GET  /status                       visão geral: sync, outbox, config, migrations
//   GET  /sync/entidades               entidades disponíveis
//   GET  /sync/log?entidade=&limite=   histórico de execuções
//   POST /sync/:entidade/run {modo}    dispara em background (full|delta)
//   POST /sync/run-all {modo, pular[]} dispara todas em sequência (background)
//   GET  /config                       modos por módulo/empresa
//   PUT  /config {modulo, empresa, modo, observacao}
//   DELETE /config/:id                 remove sobreposição por empresa
//   GET  /outbox?status=&operacao=&limite=
//   GET  /outbox/stats
//   GET  /outbox/:id/log
//   POST /outbox/:id/reprocessar | /cancelar
//   POST /outbox/processar             roda o worker agora
//   POST /outbox {operacao, payload, chave?, ...}   enfileira (uso interno/admin)
//   GET  /migrations · POST /migrations/aplicar
//   GET  /cadastros/:entidade?q=&limite=&offset=    consulta simples das tabelas erp_*
//   GET  /divergencias                 contagem TOTVS × HeadCoach por entidade
//   GET/POST/PUT/DELETE /admin/usuarios  gestão de usuários (auth.admin) — tirou o service_role do navegador
// ============================================================================
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import supabase from '../config/supabase.js';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { executarSync, executarVarios, listarEntidades, emAndamento } from '../services/erp/sync/runner.js';
import { ORDEM } from '../services/erp/sync/entidades.js';
import { listarConfig, salvarConfig, removerConfig, MODULOS, MODOS } from '../services/erp/config.js';
import * as outbox from '../services/erp/outbox.js';
import { OPERACOES } from '../services/erp/outboxHandlers.js';
import { statusMigrations, aplicarMigrations } from '../services/erp/migrations.js';
import { comparar, corrigir, listarModulos } from '../services/erp/comparacao.js';
import { getTokenInfo, isTotvsBlocked, getBlockInfo } from '../utils/totvsTokenManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'migrations', 'erp');

const router = express.Router();
router.use(requireAuth);
const admin = requireRole('owner', 'admin');

// ─── Status geral ───────────────────────────────────────────────────────────
router.get(
  '/status',
  asyncHandler(async (req, res) => {
    const [{ data: controle }, stats, config, migrations] = await Promise.all([
      supabase.from('erp_sync_controle').select('*').order('entidade'),
      outbox.estatisticas(),
      listarConfig({ forcar: true }),
      statusMigrations(supabase, MIGRATIONS_DIR).catch((e) => [{ name: 'erro', erro: e.message }]),
    ]);
    const entidades = listarEntidades();
    const rodando = emAndamento();
    const sync = ORDEM.map((nome) => {
      const c = (controle || []).find((x) => x.entidade === nome) || {};
      const e = entidades.find((x) => x.nome === nome);
      return { ...e, ...c, rodando: rodando.find((r) => r.entidade === nome) || null };
    });
    const tk = getTokenInfo();
    return successResponse(res, {
      totvs: { bloqueado: isTotvsBlocked(), bloqueio: getBlockInfo(), token_valido: tk?.is_valid ?? null, token_expira_em: tk?.expires_at ?? null },
      sync,
      outbox: stats,
      config,
      migrations,
      modulos: MODULOS,
      modos: MODOS,
      operacoes_outbox: OPERACOES,
    });
  }),
);

// ─── Sync ───────────────────────────────────────────────────────────────────
router.get('/sync/entidades', (req, res) => successResponse(res, { entidades: listarEntidades(), rodando: emAndamento() }));

router.get(
  '/sync/log',
  asyncHandler(async (req, res) => {
    const limite = Math.min(parseInt(req.query.limite, 10) || 50, 500);
    let q = supabase.from('erp_sync_log').select('*').order('iniciado_em', { ascending: false }).limit(limite);
    if (req.query.entidade) q = q.eq('entidade', req.query.entidade);
    const { data, error } = await q;
    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    return successResponse(res, { log: data });
  }),
);

router.post(
  '/sync/run-all',
  admin,
  asyncHandler(async (req, res) => {
    const modo = req.body?.modo === 'delta' ? 'delta' : 'full';
    const pular = Array.isArray(req.body?.pular) ? req.body.pular : [];
    const entidades = ORDEM.filter((e) => !pular.includes(e));
    executarVarios(entidades, modo, { disparadoPor: `api:${req.user.email}` }).catch((e) => console.error('[erp run-all]', e.message));
    return successResponse(res, { disparado: true, modo, entidades }, 'Sync disparado em background');
  }),
);

router.post(
  '/sync/:entidade/run',
  admin,
  asyncHandler(async (req, res) => {
    const { entidade } = req.params;
    if (!ORDEM.includes(entidade)) return errorResponse(res, `Entidade desconhecida: ${entidade}`, 404, 'NOT_FOUND');
    const modo = req.body?.modo === 'full' ? 'full' : 'delta';
    if (emAndamento().some((r) => r.entidade === entidade)) return errorResponse(res, 'Já está rodando', 409, 'ALREADY_RUNNING');
    executarSync(entidade, modo, { disparadoPor: `api:${req.user.email}` }).catch((e) => console.error(`[erp sync ${entidade}]`, e.message));
    return successResponse(res, { disparado: true, entidade, modo }, 'Sync disparado em background');
  }),
);

// ─── Config (modo por módulo/empresa) ───────────────────────────────────────
router.get('/config', asyncHandler(async (req, res) => successResponse(res, { config: await listarConfig({ forcar: true }), modulos: MODULOS, modos: MODOS })));

router.put(
  '/config',
  admin,
  asyncHandler(async (req, res) => {
    try {
      const row = await salvarConfig({ ...req.body, atualizadoPor: req.user.email });
      return successResponse(res, { config: row }, 'Modo salvo');
    } catch (e) {
      return errorResponse(res, e.message, 400, 'INVALID');
    }
  }),
);

router.delete(
  '/config/:id',
  admin,
  asyncHandler(async (req, res) => {
    await removerConfig(req.params.id);
    return successResponse(res, { removido: true });
  }),
);

// ─── Outbox ─────────────────────────────────────────────────────────────────
router.get('/outbox/stats', asyncHandler(async (req, res) => successResponse(res, await outbox.estatisticas())));

router.get(
  '/outbox',
  asyncHandler(async (req, res) => {
    const itens = await outbox.listar({ status: req.query.status || null, operacao: req.query.operacao || null, limite: Math.min(parseInt(req.query.limite, 10) || 100, 500) });
    return successResponse(res, { itens });
  }),
);

router.get('/outbox/:id/log', asyncHandler(async (req, res) => successResponse(res, { log: await outbox.logDe(req.params.id) })));

router.post('/outbox/:id/reprocessar', admin, asyncHandler(async (req, res) => successResponse(res, { item: await outbox.reprocessar(req.params.id) }, 'Reenfileirado')));
router.post('/outbox/:id/cancelar', admin, asyncHandler(async (req, res) => successResponse(res, { item: await outbox.cancelar(req.params.id) }, 'Cancelado')));
router.post('/outbox/processar', admin, asyncHandler(async (req, res) => successResponse(res, await outbox.processarPendentes({ limite: 50 }))));

router.post(
  '/outbox',
  admin,
  asyncHandler(async (req, res) => {
    const { operacao, payload, chave, origem_tabela, origem_id, empresa } = req.body || {};
    if (!operacao) return errorResponse(res, 'operacao é obrigatória', 400, 'INVALID');
    try {
      const item = await outbox.enfileirar({ operacao, payload, chave, origem_tabela, origem_id, empresa, criado_por: req.user.email });
      return successResponse(res, { item }, item.duplicado ? 'Já estava na fila' : 'Enfileirado', item.duplicado ? 200 : 201);
    } catch (e) {
      return errorResponse(res, e.message, 400, 'INVALID');
    }
  }),
);

// ─── Migrations ─────────────────────────────────────────────────────────────
router.get('/migrations', asyncHandler(async (req, res) => successResponse(res, { migrations: await statusMigrations(supabase, MIGRATIONS_DIR) })));

router.post(
  '/migrations/aplicar',
  admin,
  asyncHandler(async (req, res) => {
    const logs = [];
    const r = await aplicarMigrations(supabase, MIGRATIONS_DIR, { force: req.body?.force || null, log: (m) => logs.push(m) });
    return successResponse(res, { ...r, logs }, r.erros.length ? 'Houve erro' : 'Migrations aplicadas', r.erros.length ? 500 : 200);
  }),
);

// ─── Consulta simples dos cadastros ─────────────────────────────────────────
const CADASTROS = {
  empresas: { tabela: 'erp_empresas', busca: ['descricao', 'fantasia', 'cnpj', 'grupo'], ordem: 'code' },
  pessoas: { tabela: 'erp_pessoas', busca: ['nome', 'fantasia', 'cpf_cnpj', 'email'], ordem: 'nome' },
  representantes: { tabela: 'erp_representantes', busca: ['nome', 'cpf_cnpj'], ordem: 'nome' },
  vendedores: { tabela: 'erp_vendedores', busca: ['nome'], ordem: 'nome' },
  produtos: { tabela: 'erp_produtos', busca: ['nome', 'sku', 'referencia_code', 'referencia_nome'], ordem: 'code' },
  codigos_barras: { tabela: 'erp_codigos_barras', busca: ['codigo'], ordem: 'produto_code' },
  cores: { tabela: 'erp_cores', busca: ['nome', 'code'], ordem: 'code' },
  grades: { tabela: 'erp_grades', busca: ['nome'], ordem: 'code' },
  unidades: { tabela: 'erp_unidades', busca: ['descricao', 'code'], ordem: 'code' },
  classificacoes: { tabela: 'erp_classificacoes', busca: ['nome', 'tipo_nome'], ordem: 'tipo_code' },
  tabelas_preco: { tabela: 'erp_tabelas_preco', busca: ['descricao', 'nome'], ordem: 'code' },
  precos: { tabela: 'erp_precos', busca: [], ordem: 'produto_code' },
  custos: { tabela: 'erp_custos', busca: [], ordem: 'produto_code' },
  operacoes: { tabela: 'erp_operacoes', busca: ['descricao'], ordem: 'code' },
  condicoes_pagamento: { tabela: 'erp_condicoes_pagamento', busca: ['nome'], ordem: 'code' },
  portadores: { tabela: 'erp_portadores', busca: ['descricao'], ordem: 'code' },
  despesas_itens: { tabela: 'erp_despesas_itens', busca: ['nome'], ordem: 'code' },
  centros_custo: { tabela: 'erp_centros_custo', busca: ['nome'], ordem: 'code' },
  estoques: { tabela: 'erp_estoques', busca: ['descricao'], ordem: 'code' },
  // fase 1 — tabelas no formato da API TOTVS v2
  contas_pagar: { tabela: 'accounts_payable_duplicates_v', busca: ['supplier_name', 'supplier_cpf_cnpj', 'user_inclusion_name', 'branch_name'], ordem: 'due_date', desc: true, colEmpresa: 'branch_code', numericos: ['duplicate_code', 'supplier_code'] },
  contas_pagar_comandos: { tabela: 'accounts_payable_commands', busca: ['supplier_cpf_cnpj', 'branch_cnpj', 'erro'], ordem: 'criado_em', desc: true, numericos: ['duplicate_code'] },
  contas_receber: { tabela: 'accounts_receivable_documents_v', busca: ['customer_name', 'customer_cpf_cnpj', 'bearer_name', 'branch_name'], ordem: 'expired_date', desc: true, colEmpresa: 'branch_code', numericos: ['receivable_code', 'customer_code'] },
  contas_receber_comandos: { tabela: 'accounts_receivable_commands', busca: ['command', 'customer_cpf_cnpj', 'erro'], ordem: 'criado_em', desc: true, numericos: ['receivable_code', 'customer_code'] },
  vendas: { tabela: 'vendas_v', busca: ['customer_name', 'seller_name', 'operation_name', 'branch_name', 'venda'], ordem: 'data', desc: true, colEmpresa: 'branch_code', numericos: ['customer_code', 'seller_code', 'operation_code'] },
  transacoes: { tabela: 'general_transactions_v', busca: ['customer_name', 'seller_name', 'operation_name', 'branch_name'], ordem: 'transaction_date', desc: true, colEmpresa: 'branch_code', numericos: ['transaction_code', 'customer_code', 'operation_code'] },
  transacoes_comandos: { tabela: 'general_transaction_commands', busca: ['command', 'erro'], ordem: 'criado_em', desc: true, numericos: ['transaction_code'] },
  bonus_saldo: { tabela: 'person_balance_bonus_v', busca: ['person_name', 'person_cpf', 'branch_name'], ordem: 'balance_value', desc: true, colEmpresa: 'branch_code', numericos: ['person_code'] },
  bonus_comandos: { tabela: 'person_bonus_commands', busca: ['command', 'erro'], ordem: 'criado_em', desc: true, numericos: ['person_code'] },
  vouchers: { tabela: 'vouchers', busca: ['customer_name', 'description', 'prefix_code', 'voucher_code'], ordem: 'voucher_number', desc: true, numericos: ['voucher_number', 'customer_code'] },
  vouchers_comandos: { tabela: 'voucher_commands', busca: ['command', 'erro'], ordem: 'criado_em', desc: true, numericos: ['voucher_number', 'customer_code'] },
};

router.get(
  '/cadastros/:entidade',
  asyncHandler(async (req, res) => {
    const def = CADASTROS[req.params.entidade];
    if (!def) return errorResponse(res, `Cadastro desconhecido. Opções: ${Object.keys(CADASTROS).join(', ')}`, 404, 'NOT_FOUND');
    const limite = Math.min(parseInt(req.query.limite, 10) || 50, 500);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const q = String(req.query.q || '').trim();
    let query = supabase.from(def.tabela).select('*', { count: 'exact' }).order(def.ordem, { ascending: !def.desc }).range(offset, offset + limite - 1);
    if (q) {
      const numCols = def.numericos || (def.ordem === 'code' ? ['code'] : []);
      const partes = def.busca.map((c) => `${c}.ilike.%${q}%`);
      if (/^\d+$/.test(q) && q.length <= 15) partes.unshift(...numCols.map((c) => `${c}.eq.${q}`));
      if (partes.length) query = query.or(partes.join(','));
    }
    if (req.query.produto_code) query = query.eq('produto_code', req.query.produto_code);
    if (req.query.empresa) query = query.eq(def.colEmpresa || 'empresa', req.query.empresa);
    const { data, count, error } = await query;
    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    return successResponse(res, { itens: data, total: count, limite, offset });
  }),
);

// ─── Divergências (fase 0: contagem TOTVS × HeadCoach por entidade) ─────────
router.get(
  '/divergencias',
  asyncHandler(async (req, res) => {
    const { data } = await supabase.from('erp_sync_controle').select('*').order('entidade');
    const itens = (data || []).map((c) => ({
      entidade: c.entidade,
      descricao: c.descricao,
      total_totvs: c.total_totvs,
      total_local: c.total_local,
      diferenca: c.total_totvs != null && c.total_local != null ? c.total_local - c.total_totvs : null,
      ultimo_full_em: c.ultimo_full_em,
      ultimo_delta_em: c.ultimo_delta_em,
      status: c.status,
      ultimo_erro: c.ultimo_erro,
    }));
    return successResponse(res, { itens });
  }),
);

// ─── Conferência TOTVS × HeadCoach (fase 1): registro a registro no período ─
router.get('/comparacao/modulos', asyncHandler(async (req, res) => {
  const { data } = await supabase.from('erp_empresas').select('code,descricao,propria').order('code');
  return successResponse(res, { modulos: listarModulos(), empresas: data || [] });
}));

router.get(
  '/comparacao/:modulo',
  asyncHandler(async (req, res) => {
    try {
      const r = await comparar(req.params.modulo, {
        de: req.query.de,
        ate: req.query.ate,
        empresas: req.query.empresas || null,
        limiteDivergencias: Math.min(parseInt(req.query.limite, 10) || 500, 2000),
      });
      return successResponse(res, r);
    } catch (e) {
      if (e.status === 400) return errorResponse(res, e.message, 400, 'INVALID');
      throw e;
    }
  }),
);

router.post(
  '/comparacao/:modulo/corrigir',
  admin,
  asyncHandler(async (req, res) => {
    try {
      const r = await corrigir(req.params.modulo, { de: req.body?.de, ate: req.body?.ate, empresas: req.body?.empresas || null });
      return successResponse(res, r, `${r.gravados} registro(s) regravados a partir do TOTVS`);
    } catch (e) {
      if (e.status === 400) return errorResponse(res, e.message, 400, 'INVALID');
      throw e;
    }
  }),
);

// ─── Usuários (auth.admin) — substitui o supabaseAdmin do navegador ─────────
const mapUser = (u) => ({
  id: u.id,
  email: u.email,
  name: u.user_metadata?.name || null,
  role: u.user_metadata?.role || 'guest',
  user_metadata: u.user_metadata || {},
  created_at: u.created_at,
  last_sign_in_at: u.last_sign_in_at,
  email_confirmed_at: u.email_confirmed_at,
});

router.get(
  '/admin/usuarios',
  admin,
  asyncHandler(async (req, res) => {
    const perPage = 1000;
    let page = 1;
    const todos = [];
    for (;;) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
      if (error) return errorResponse(res, error.message, 500, 'AUTH_ERROR');
      todos.push(...(data?.users || []));
      if (!data?.users?.length || data.users.length < perPage) break;
      page += 1;
    }
    return successResponse(res, { usuarios: todos.map(mapUser) });
  }),
);

router.post(
  '/admin/usuarios',
  admin,
  asyncHandler(async (req, res) => {
    const { email, password, name, role, user_metadata } = req.body || {};
    if (!email || !password) return errorResponse(res, 'email e password são obrigatórios', 400, 'INVALID');
    const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { ...(user_metadata || {}), name: name ?? user_metadata?.name, role: role ?? user_metadata?.role ?? 'user' } });
    if (error) return errorResponse(res, error.message, 400, 'AUTH_ERROR');
    return successResponse(res, { usuario: mapUser(data.user) }, 'Usuário criado', 201);
  }),
);

router.put(
  '/admin/usuarios/:id',
  admin,
  asyncHandler(async (req, res) => {
    const { email, password, user_metadata, name, role } = req.body || {};
    const patch = {};
    if (email) patch.email = email;
    if (password) patch.password = password;
    if (user_metadata || name !== undefined || role !== undefined) {
      const { data: atual } = await supabase.auth.admin.getUserById(req.params.id);
      patch.user_metadata = { ...(atual?.user?.user_metadata || {}), ...(user_metadata || {}) };
      if (name !== undefined) patch.user_metadata.name = name;
      if (role !== undefined) patch.user_metadata.role = role;
    }
    const { data, error } = await supabase.auth.admin.updateUserById(req.params.id, patch);
    if (error) return errorResponse(res, error.message, 400, 'AUTH_ERROR');
    return successResponse(res, { usuario: mapUser(data.user) }, 'Usuário atualizado');
  }),
);

router.delete(
  '/admin/usuarios/:id',
  admin,
  asyncHandler(async (req, res) => {
    if (req.params.id === req.user.id) return errorResponse(res, 'Não é possível excluir o próprio usuário', 400, 'INVALID');
    const { error } = await supabase.auth.admin.deleteUser(req.params.id);
    if (error) return errorResponse(res, error.message, 400, 'AUTH_ERROR');
    return successResponse(res, { removido: true }, 'Usuário excluído');
  }),
);

export default router;
