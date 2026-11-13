// ============================================================================
// /api/balanco-rfid — arquivos de balanço do app Android (Urovo DT50 + RFDT50)
//
//   POST /                 salva uma contagem finalizada no app
//   GET  /                 lista (?empresa=&de=&ate=&busca=) — sem os EPCs
//   GET  /:id              arquivo completo (com os EPCs)
//   POST /:id/resumo       agrupa por produto (EPC → EAN → TOTVS); ?forcar=1 refaz
//   GET  /:id/csv          exporta (?tipo=epcs|produtos&por=email) — só nas primeiras 48 h
//   POST /:id/csv-autorizado  depois das 48 h: { email, senha } de gerente/admin/owner
// Consultas (tudo menos o POST / do app) exigem login e só mostram os balanços
// das empresas do usuário (utils/empresasUsuario.js — Yago, 13/11/2026).
// ============================================================================
import express from 'express';
import supabase from '../config/supabase.js';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';
import {
  BalancoError,
  erroMigracao,
  salvarArquivo,
  gerarResumo,
  gerarCsv,
  downloadLiberado,
  prazoDownload,
  registrarDownload,
  verificarAutorizador,
  JANELA_DOWNLOAD_HORAS,
} from '../services/balancoRfid.js';
import { empresasRestritasDoUsuario, usuarioDaRequisicao } from '../utils/empresasUsuario.js';

const router = express.Router();

// quem está consultando e quais empresas pode ver (null = todas)
async function acesso(req) {
  const user = await usuarioDaRequisicao(req);
  if (!user) throw new BalancoError('Faça login para ver os balanços', 'SEM_LOGIN', 401);
  return { user, empresas: await empresasRestritasDoUsuario(user) };
}
function conferirEmpresa(empresas, empresa) {
  if (empresas && !empresas.includes(Number(empresa))) throw new BalancoError(`Você não tem acesso aos balanços da empresa ${empresa}`, 'SEM_ACESSO_EMPRESA', 403);
}
async function exigirArquivoPermitido(req, id) {
  const { empresas } = await acesso(req);
  if (!empresas) return;
  const { data, error } = await supabase.from('balanco_rfid_arquivos').select('id, empresa').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new BalancoError('Arquivo não encontrado', 'NOT_FOUND', 404);
  conferirEmpresa(empresas, data.empresa);
}

function responder(res, err) {
  if (err instanceof BalancoError) return errorResponse(res, err.message, err.status, err.code);
  if (erroMigracao(err)) {
    return errorResponse(res, 'Tabela balanco_rfid_arquivos não existe — rode migrations/balanco_rfid.sql no Supabase', 503, 'MIGRATION_PENDING');
  }
  return errorResponse(res, err?.message || 'Erro no balanço RFID', 500, 'DB_ERROR');
}

router.post(
  '/',
  asyncHandler(async (req, res) => {
    try {
      const r = await salvarArquivo(req.body || {});
      return successResponse(res, r, r.jaExistia ? 'Arquivo já estava salvo' : 'Balanço salvo', r.jaExistia ? 200 : 201);
    } catch (err) {
      return responder(res, err);
    }
  }),
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    let permitidas;
    try {
      ({ empresas: permitidas } = await acesso(req));
    } catch (err) {
      return responder(res, err);
    }
    const empresa = parseInt(req.query.empresa, 10) || null;
    if (empresa && permitidas && !permitidas.includes(empresa)) return errorResponse(res, `Você não tem acesso aos balanços da empresa ${empresa}`, 403, 'SEM_ACESSO_EMPRESA');
    if (permitidas && !permitidas.length) {
      return successResponse(res, { items: [], janelaHoras: JANELA_DOWNLOAD_HORAS, resumo: { arquivos: 0, pecas: 0 }, empresasPermitidas: [] }, 'Nenhuma empresa liberada para você');
    }
    const de = req.query.de ? String(req.query.de).slice(0, 10) : null;
    const ate = req.query.ate ? String(req.query.ate).slice(0, 10) : null;
    const busca = String(req.query.busca || '').trim();
    let q = supabase
      .from('balanco_rfid_arquivos')
      .select('id, nome, empresa, empresa_nome, setor, usuario_nome, usuario_email, iniciado_em, finalizado_em, duracao_seg, qtd_epcs, qtd_leituras, dispositivo, resumo_em, criado_em, downloads')
      .order('finalizado_em', { ascending: false })
      .limit(Math.min(parseInt(req.query.limite, 10) || 300, 1000));
    if (empresa) q = q.eq('empresa', empresa);
    else if (permitidas) q = q.in('empresa', permitidas);
    if (de) q = q.gte('finalizado_em', `${de}T00:00:00-03:00`);
    if (ate) q = q.lte('finalizado_em', `${ate}T23:59:59.999-03:00`);
    if (busca) q = q.ilike('nome', `%${busca}%`);
    const { data, error } = await q;
    if (error) return responder(res, error);
    const items = (data || []).map((i) => ({
      ...i,
      download_ate: prazoDownload(i.criado_em).toISOString(),
      download_liberado: downloadLiberado(i.criado_em),
    }));
    return successResponse(
      res,
      { items, janelaHoras: JANELA_DOWNLOAD_HORAS, resumo: { arquivos: items.length, pecas: items.reduce((s, i) => s + (i.qtd_epcs || 0), 0) }, empresasPermitidas: permitidas },
      `${items.length} arquivo(s)`,
    );
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    let permitidas;
    try {
      ({ empresas: permitidas } = await acesso(req));
    } catch (err) {
      return responder(res, err);
    }
    const { data, error } = await supabase.from('balanco_rfid_arquivos').select('*').eq('id', parseInt(req.params.id, 10)).maybeSingle();
    if (error) return responder(res, error);
    if (!data) return errorResponse(res, 'Arquivo não encontrado', 404, 'NOT_FOUND');
    if (permitidas && !permitidas.includes(Number(data.empresa))) return errorResponse(res, `Você não tem acesso aos balanços da empresa ${data.empresa}`, 403, 'SEM_ACESSO_EMPRESA');
    return successResponse(
      res,
      { ...data, download_ate: prazoDownload(data.criado_em).toISOString(), download_liberado: downloadLiberado(data.criado_em) },
      'Arquivo de balanço',
    );
  }),
);

router.post(
  '/:id/resumo',
  asyncHandler(async (req, res) => {
    try {
      await exigirArquivoPermitido(req, parseInt(req.params.id, 10));
      const r = await gerarResumo(parseInt(req.params.id, 10), { forcar: req.query.forcar === '1' || req.body?.forcar === true });
      return successResponse(res, r, r.cache ? 'Resumo (cache)' : 'Resumo por produto');
    } catch (err) {
      return responder(res, err);
    }
  }),
);

async function enviarCsv(res, id, tipo) {
  const { arquivo, conteudo } = await gerarCsv(id, tipo);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(arquivo)}`);
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  return res.send(conteudo);
}

async function carregarCriadoEm(id) {
  const { data, error } = await supabase.from('balanco_rfid_arquivos').select('id, criado_em').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new BalancoError('Arquivo não encontrado', 'NOT_FOUND', 404);
  return data.criado_em;
}

router.get(
  '/:id/csv',
  asyncHandler(async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const tipo = req.query.tipo === 'produtos' ? 'produtos' : 'epcs';
      await exigirArquivoPermitido(req, id);
      const criadoEm = await carregarCriadoEm(id);
      if (!downloadLiberado(criadoEm)) {
        const ate = prazoDownload(criadoEm).toLocaleString('pt-BR', { timeZone: 'America/Recife' });
        return errorResponse(
          res,
          `Download liberado só nas primeiras ${JANELA_DOWNLOAD_HORAS} h (até ${ate}). Peça a senha de um gerente, admin ou owner.`,
          403,
          'DOWNLOAD_EXPIRADO',
        );
      }
      await registrarDownload(id, { tipo, por: req.query.por || null });
      return enviarCsv(res, id, tipo);
    } catch (err) {
      return responder(res, err);
    }
  }),
);

router.post(
  '/:id/csv-autorizado',
  asyncHandler(async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const tipo = req.body?.tipo === 'produtos' ? 'produtos' : 'epcs';
      await exigirArquivoPermitido(req, id);
      await carregarCriadoEm(id);
      const autorizador = await verificarAutorizador(req.body?.email, req.body?.senha);
      await registrarDownload(id, { tipo, por: req.body?.por || null, liberadoPor: autorizador.email });
      console.log(`🔓 [Balanço RFID] download do arquivo ${id} liberado por ${autorizador.email} (${autorizador.role})`);
      return enviarCsv(res, id, tipo);
    } catch (err) {
      return responder(res, err);
    }
  }),
);

export default router;
