// ============================================================
// DRYLAND · CHAMADOS — ponte HeadCoach → Supabase do Dryland
//
// O Dryland (dryland-missao-separacao.vercel.app) guarda os chamados da
// rede no Supabase "Cérebro" e opera TUDO via RPCs PostgREST com a chave
// ANON pública (a mesma que fica no bundle do site). Este router repassa
// essas RPCs pro HeadCoach poder listar, abrir, responder e concluir
// chamados SEM tocar no código do Dryland.
//
// RPCs usadas (idênticas às do core.js do Dryland):
//   chamado_listar · chamado_get · chamado_abrir · chamado_atualizar
//   chamado_painel · chamado_anexo_add
// ============================================================
import express from 'express';
import axios from 'axios';
import {
  asyncHandler,
  successResponse,
  errorResponse,
} from '../utils/errorHandler.js';

const router = express.Router();

// Supabase "Cérebro" do Dryland (chave anon pública — a mesma do bundle do site)
const DRYLAND_URL =
  process.env.DRYLAND_SUPABASE_URL || 'https://umhczriycvtagjqjnrzm.supabase.co';
const DRYLAND_KEY =
  process.env.DRYLAND_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtaGN6cml5Y3Z0YWdqcWpucnptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2NTAyOTEsImV4cCI6MjA5MzIyNjI5MX0.SVWG6_7DZNv-Tz4AgRwQ1791lAEWgpcEv15k9rERlwI';

const STORAGE_BUCKET = 'missao-nfs';

async function rpc(fn, args = {}) {
  const { data } = await axios.post(
    `${DRYLAND_URL}/rest/v1/rpc/${fn}`,
    args,
    {
      headers: {
        'Content-Type': 'application/json',
        apikey: DRYLAND_KEY,
        Authorization: `Bearer ${DRYLAND_KEY}`,
      },
      timeout: 30000,
    },
  );
  return data;
}

function rpcErrorMessage(err) {
  const j = err?.response?.data;
  return (
    (j && (j.message || j.hint || j.details)) ||
    err?.message ||
    'Erro ao falar com o Supabase do Dryland'
  );
}

const fileUrl = (path) =>
  `${DRYLAND_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${path}`;

// ── Dados fixos espelhados do core.js do Dryland ──────────────
const LOJAS = [
  [2, 'João Pessoa'],
  [5, 'Nova Cruz'],
  [55, 'Parnamirim'],
  [65, 'Canguaretama'],
  [87, 'Cidade Jardim'],
  [88, 'Guararapes'],
  [90, 'Ayrton Senna'],
  [93, 'Imperatriz'],
  [94, 'Patos'],
  [95, 'Midway'],
  [97, 'Teresina'],
  [98, 'Recife'],
];

// módulos do Dryland com publico === 'setor' (+ a opção especial 'loja')
const SETORES = [
  { id: 'loja', nome: 'Loja (a própria loja resolve)', icon: '🏪' },
  { id: 'patrimonio', nome: 'Patrimônio', icon: '🛡️' },
  { id: 'tecnologia', nome: 'Tecnologia', icon: '💻' },
  { id: 'auditoria', nome: 'Auditoria', icon: '🔍' },
  { id: 'financeiro', nome: 'Financeiro', icon: '💰' },
  { id: 'fiscal', nome: 'Fiscal', icon: '🧾' },
  { id: 'dp', nome: 'DP · RH', icon: '🧑‍💼' },
  { id: 'marketing', nome: 'Marketing', icon: '📸' },
  { id: 'producao', nome: 'Produção', icon: '🏭' },
  { id: 'separar', nome: 'Separar Lote', icon: '✂️' },
  { id: 'gerente-varejo', nome: 'Gerente Varejo', icon: '🧭' },
  // não é publico:'setor' no core.js, mas existem chamados reais com esse setor
  { id: 'expedicao', nome: 'Expedição', icon: '🚚' },
];

const STATUS = [
  { id: 'aberto', label: '🔵 Aberto' },
  { id: 'em_andamento', label: '🟢 Em andamento' },
  { id: 'aguardando_solicitante', label: '🟠 Aguardando solicitante' },
  { id: 'aguardando_responsavel', label: '🟣 Aguardando responsável' },
  { id: 'concluido', label: '✅ Resolvido' },
  { id: 'cancelado', label: '🚫 Cancelado' },
];

// campos aceitos no patch do chamado_atualizar (mesmos que o Dryland manda).
// prazo_justificativa é OBRIGATÓRIA quando o prazo muda — sem ela a RPC devolve
// {erro:'justificativa_obrigatoria'} e o prazo não é alterado.
const PATCH_KEYS = [
  'setor',
  'prazo',
  'prazo_justificativa',
  'responsavel_nome',
  'comentario',
  'status',
];

// ──────────────────────────────────────────────────────────────
// Responsável automático por tipo de chamado
//
// A regra do "caixa/depósito" é ESCOPADA ao setor financeiro de propósito:
// nos dados reais, "caixa" aparece em 31 chamados do financeiro (depósito
// necessário, divergência de caixa, fechamento) mas também em 3 do patrimônio
// que não têm nada a ver com dinheiro ("comprar uma caixa de som", "formatar o
// pc do caixa"). Sem o escopo, esses cairiam no JOÃO por engano.
// ──────────────────────────────────────────────────────────────
const semAcento = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

const REGRAS_RESPONSAVEL = [
  {
    responsavel: 'JOAO',
    descricao: 'Financeiro sobre depósito ou caixa (solicitação de depósito, depósito necessário, divergência/fechamento de caixa)',
    quando: (c) =>
      c.setor === 'financeiro' &&
      /deposito|caixa/.test(semAcento(c.assunto)),
  },
  { responsavel: 'YAGO', descricao: 'Todo chamado do setor Tecnologia', quando: (c) => c.setor === 'tecnologia' },
  { responsavel: 'NIZIANY', descricao: 'Todo chamado do setor Fiscal', quando: (c) => c.setor === 'fiscal' },
];

// Devolve quem a regra indica, ou null se nenhuma regra bate.
// NÃO olha se o chamado já tem responsável — quem decide sobrescrever é o chamador.
function responsavelDaRegra(chamado) {
  const r = REGRAS_RESPONSAVEL.find((x) => x.quando(chamado || {}));
  return r ? r.responsavel : null;
}

// Sugestão exibida na tela: só para chamado que AINDA não tem responsável.
// Nunca sugere trocar um responsável já definido por uma pessoa.
function responsavelSugerido(chamado) {
  if (chamado?.responsavel_nome) return null;
  return responsavelDaRegra(chamado);
}

const comSugestao = (c) => ({ ...c, responsavel_sugerido: responsavelSugerido(c) });

// prazo só-data vira 18:00 de Brasília — mesma regra do core.js do Dryland
function normalizarPrazo(prazo) {
  if (typeof prazo === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(prazo)) {
    return `${prazo}T18:00:00-03:00`;
  }
  return prazo;
}

// ──────────────────────────────────────────────────────────────
// GET /chamados/meta — lojas, setores e status pro front montar filtros
// ──────────────────────────────────────────────────────────────
router.get(
  '/chamados/meta',
  asyncHandler(async (req, res) => {
    successResponse(res, {
      lojas: LOJAS.map(([cd, nome]) => ({ cd, nome })),
      setores: SETORES,
      status: STATUS,
      responsaveis_regras: REGRAS_RESPONSAVEL.map((r) => ({
        responsavel: r.responsavel,
        descricao: r.descricao,
      })),
    });
  }),
);

// ──────────────────────────────────────────────────────────────
// GET /chamados — lista todos os chamados da rede (chamado_listar)
// ──────────────────────────────────────────────────────────────
router.get(
  '/chamados',
  asyncHandler(async (req, res) => {
    try {
      const lista = await rpc('chamado_listar', {});
      successResponse(res, Array.isArray(lista) ? lista.map(comSugestao) : []);
    } catch (err) {
      errorResponse(res, rpcErrorMessage(err), 502, 'DRYLAND_RPC_ERROR');
    }
  }),
);

// ──────────────────────────────────────────────────────────────
// GET /chamados/painel?setor=tecnologia — painel "Para mim" ×
// "Aguardando a loja" de um setor (chamado_painel)
// ──────────────────────────────────────────────────────────────
router.get(
  '/chamados/painel',
  asyncHandler(async (req, res) => {
    const setor = String(req.query.setor || '').trim();
    if (!setor) {
      return errorResponse(res, 'Informe ?setor=', 400, 'VALIDATION_ERROR');
    }
    try {
      const painel = await rpc('chamado_painel', { p_setor: setor });
      successResponse(res, painel || {});
    } catch (err) {
      errorResponse(res, rpcErrorMessage(err), 502, 'DRYLAND_RPC_ERROR');
    }
  }),
);

// ──────────────────────────────────────────────────────────────
// GET /chamados/:id — detalhe: chamado + histórico + anexos (chamado_get)
// ──────────────────────────────────────────────────────────────
router.get(
  '/chamados/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return errorResponse(res, 'id inválido', 400, 'VALIDATION_ERROR');
    }
    try {
      const d = await rpc('chamado_get', { p_id: id });
      if (!d || !d.chamado) {
        return errorResponse(res, 'Chamado não encontrado', 404, 'NOT_FOUND');
      }
      successResponse(res, {
        chamado: comSugestao(d.chamado),
        eventos: d.eventos || [],
        anexos: (d.anexos || []).map((a) => ({ ...a, url: fileUrl(a.path) })),
      });
    } catch (err) {
      errorResponse(res, rpcErrorMessage(err), 502, 'DRYLAND_RPC_ERROR');
    }
  }),
);

// ──────────────────────────────────────────────────────────────
// POST /chamados — abre um chamado novo (chamado_abrir)
// body: { loja_cd, assunto, texto?, setor?, direcao? ('adm'|'loja'), por?,
//         responsavel_nome? (se vazio, aplica a regra automática) }
// ──────────────────────────────────────────────────────────────
router.post(
  '/chamados',
  asyncHandler(async (req, res) => {
    const { loja_cd, assunto, texto, setor, direcao, por, responsavel_nome } = req.body || {};
    const cd = Number(loja_cd);
    const loja = LOJAS.find(([c]) => c === cd);
    if (!loja) {
      return errorResponse(res, 'loja_cd inválido', 400, 'VALIDATION_ERROR');
    }
    if (!assunto || !String(assunto).trim()) {
      return errorResponse(res, 'assunto é obrigatório', 400, 'VALIDATION_ERROR');
    }
    const setorFinal = setor || 'tecnologia';
    const assuntoFinal = String(assunto).trim();
    try {
      const r = await rpc('chamado_abrir', {
        p_loja_cd: cd,
        p_loja_nome: loja[1],
        p_assunto: assuntoFinal,
        p_texto: texto ? String(texto).trim() : null,
        p_aberto_por: (por && String(por).trim()) || 'headcoach',
        p_direcao: direcao === 'adm' ? 'adm' : 'loja',
        p_setor: setorFinal,
      });
      if (!r || !(r.ok || r.id)) {
        return errorResponse(res, 'Supabase recusou o chamado_abrir', 502, 'DRYLAND_RPC_ERROR', r);
      }
      // "abre já com responsável": o chamado_abrir não aceita responsável, então
      // gravamos logo depois. Se falhar, o chamado continua criado — só devolvemos
      // o aviso, nunca perdemos o chamado por causa da automação.
      const responsavel =
        (responsavel_nome && String(responsavel_nome).trim()) ||
        responsavelDaRegra({ setor: setorFinal, assunto: assuntoFinal });
      let responsavel_aplicado = null;
      let aviso = null;
      if (responsavel && r.id) {
        try {
          const up = await rpc('chamado_atualizar', {
            p_id: r.id,
            p_patch: { responsavel_nome: responsavel },
            p_por: (por && String(por).trim()) || 'headcoach',
          });
          if (up && up.ok) responsavel_aplicado = responsavel;
          else aviso = `Chamado criado, mas não consegui definir o responsável (${responsavel}).`;
        } catch {
          aviso = `Chamado criado, mas não consegui definir o responsável (${responsavel}).`;
        }
      }
      successResponse(res, { ...r, responsavel_aplicado, aviso }, 'Chamado aberto', 201);
    } catch (err) {
      errorResponse(res, rpcErrorMessage(err), 502, 'DRYLAND_RPC_ERROR');
    }
  }),
);

// ──────────────────────────────────────────────────────────────
// PATCH /chamados/:id — atualiza/responde (chamado_atualizar)
// body: { setor?, prazo? (YYYY-MM-DD ou ISO), responsavel_nome?,
//         comentario?, status?, por? }
// ──────────────────────────────────────────────────────────────
router.patch(
  '/chamados/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return errorResponse(res, 'id inválido', 400, 'VALIDATION_ERROR');
    }
    const body = req.body || {};
    const patch = {};
    for (const k of PATCH_KEYS) {
      if (body[k] !== undefined && body[k] !== null && body[k] !== '') {
        patch[k] = body[k];
      }
    }
    if (patch.prazo) patch.prazo = normalizarPrazo(patch.prazo);
    if (patch.status && !STATUS.some((s) => s.id === patch.status)) {
      return errorResponse(res, `status inválido: ${patch.status}`, 400, 'VALIDATION_ERROR');
    }
    if (Object.keys(patch).length === 0) {
      return errorResponse(
        res,
        `Nada pra atualizar — mande ao menos um de: ${PATCH_KEYS.join(', ')}`,
        400,
        'VALIDATION_ERROR',
      );
    }
    try {
      const r = await rpc('chamado_atualizar', {
        p_id: id,
        p_patch: patch,
        p_por: (body.por && String(body.por).trim()) || 'headcoach',
      });
      if (r && r.ok) return successResponse(res, r, 'Chamado atualizado');
      // regra de negócio do Dryland (ex: justificativa_obrigatoria) — devolve a
      // mensagem real pro usuário saber o que faltou, não um erro genérico
      if (r && r.erro) {
        return errorResponse(
          res,
          r.mensagem || `Dryland recusou: ${r.erro}`,
          400,
          String(r.erro).toUpperCase(),
        );
      }
      errorResponse(res, 'Supabase recusou o chamado_atualizar', 502, 'DRYLAND_RPC_ERROR', r);
    } catch (err) {
      errorResponse(res, rpcErrorMessage(err), 502, 'DRYLAND_RPC_ERROR');
    }
  }),
);

// ──────────────────────────────────────────────────────────────
// POST /chamados/aplicar-responsaveis — aplica a regra automática nos chamados
// que JÁ existem. Só mexe em chamado EM ABERTO e SEM responsável: nunca
// sobrescreve pessoa que já está no chamado nem mexe em concluído/cancelado.
// body: { dry_run?: true (só simula, não grava), setores?: [ids], por? }
// ──────────────────────────────────────────────────────────────
router.post(
  '/chamados/aplicar-responsaveis',
  asyncHandler(async (req, res) => {
    const { dry_run, setores, por } = req.body || {};
    // simula por padrão: só grava quando o chamador manda dry_run:false de propósito
    const simular = !(dry_run === false || dry_run === 'false');
    try {
      const lista = await rpc('chamado_listar', {});
      if (!Array.isArray(lista)) {
        return errorResponse(res, 'chamado_listar não devolveu lista', 502, 'DRYLAND_RPC_ERROR');
      }
      const noEscopo = (c) =>
        !Array.isArray(setores) || setores.length === 0 || setores.includes(c.setor);
      const alvos = lista
        .filter((c) => c.status !== 'concluido' && c.status !== 'cancelado')
        .filter((c) => !c.responsavel_nome)
        .filter(noEscopo)
        .map((c) => ({ chamado: c, responsavel: responsavelDaRegra(c) }))
        .filter((x) => x.responsavel);

      const resumo = alvos.reduce((acc, x) => {
        acc[x.responsavel] = (acc[x.responsavel] || 0) + 1;
        return acc;
      }, {});

      if (simular) {
        return successResponse(
          res,
          {
            simulacao: true,
            total: alvos.length,
            por_responsavel: resumo,
            chamados: alvos.map((x) => ({
              id: x.chamado.id,
              numero: x.chamado.numero,
              setor: x.chamado.setor,
              assunto: x.chamado.assunto,
              responsavel: x.responsavel,
            })),
          },
          `${alvos.length} chamado(s) receberiam responsável`,
        );
      }

      const aplicados = [];
      const falhas = [];
      for (const { chamado, responsavel } of alvos) {
        try {
          const r = await rpc('chamado_atualizar', {
            p_id: chamado.id,
            p_patch: { responsavel_nome: responsavel },
            p_por: (por && String(por).trim()) || 'headcoach',
          });
          if (r && r.ok) aplicados.push({ numero: chamado.numero, responsavel });
          else falhas.push({ numero: chamado.numero, erro: (r && (r.mensagem || r.erro)) || 'recusado' });
        } catch (e) {
          falhas.push({ numero: chamado.numero, erro: rpcErrorMessage(e) });
        }
      }
      successResponse(
        res,
        { simulacao: false, total: alvos.length, aplicados, falhas, por_responsavel: resumo },
        `${aplicados.length} chamado(s) atualizados${falhas.length ? `, ${falhas.length} falharam` : ''}`,
      );
    } catch (err) {
      errorResponse(res, rpcErrorMessage(err), 502, 'DRYLAND_RPC_ERROR');
    }
  }),
);

// ──────────────────────────────────────────────────────────────
// POST /chamados/:id/concluir — atalho pro status 'concluido'
// body: { comentario?, por? }
// ──────────────────────────────────────────────────────────────
router.post(
  '/chamados/:id/concluir',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return errorResponse(res, 'id inválido', 400, 'VALIDATION_ERROR');
    }
    const { comentario, por } = req.body || {};
    const patch = { status: 'concluido' };
    if (comentario && String(comentario).trim()) patch.comentario = String(comentario).trim();
    try {
      const r = await rpc('chamado_atualizar', {
        p_id: id,
        p_patch: patch,
        p_por: (por && String(por).trim()) || 'headcoach',
      });
      if (r && r.ok) return successResponse(res, r, 'Chamado concluído');
      errorResponse(res, 'Supabase recusou a conclusão', 502, 'DRYLAND_RPC_ERROR', r);
    } catch (err) {
      errorResponse(res, rpcErrorMessage(err), 502, 'DRYLAND_RPC_ERROR');
    }
  }),
);

// ──────────────────────────────────────────────────────────────
// POST /chamados/:id/anexo — anexa foto (upload no bucket público
// missao-nfs + chamado_anexo_add, mesmo fluxo do Dryland)
// body: { base64, content_type?, ext?, por? }
// ──────────────────────────────────────────────────────────────
router.post(
  '/chamados/:id/anexo',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return errorResponse(res, 'id inválido', 400, 'VALIDATION_ERROR');
    }
    const { base64, content_type, ext, por } = req.body || {};
    if (!base64) {
      return errorResponse(res, 'base64 é obrigatório', 400, 'VALIDATION_ERROR');
    }
    const buf = Buffer.from(String(base64).replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (!buf.length) {
      return errorResponse(res, 'base64 vazio/inválido', 400, 'VALIDATION_ERROR');
    }
    const extension = String(ext || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `chamado-${id}-${Date.now()}.${extension}`;
    try {
      await axios.post(`${DRYLAND_URL}/storage/v1/object/${STORAGE_BUCKET}/${path}`, buf, {
        headers: {
          apikey: DRYLAND_KEY,
          Authorization: `Bearer ${DRYLAND_KEY}`,
          'Content-Type': content_type || 'image/jpeg',
          'x-upsert': 'true',
        },
        maxBodyLength: Infinity,
        timeout: 60000,
      });
      const r = await rpc('chamado_anexo_add', {
        p_id: id,
        p_path: path,
        p_por: (por && String(por).trim()) || 'headcoach',
      });
      if (r && r.ok) return successResponse(res, { path, url: fileUrl(path) }, 'Anexo enviado', 201);
      errorResponse(res, 'Upload ok mas o chamado_anexo_add falhou', 502, 'DRYLAND_RPC_ERROR', r);
    } catch (err) {
      errorResponse(res, rpcErrorMessage(err), 502, 'DRYLAND_RPC_ERROR');
    }
  }),
);

export default router;
