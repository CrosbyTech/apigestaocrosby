/**
 * Cobrança — lista consolidada de clientes devedores para disparo externo
 * (WhatsApp de cobrança em outro sistema).
 *
 *   GET /api/cobranca/inadimplentes
 *
 * Devolve EXATAMENTE o universo que as telas de inadimplência do HeadCoach
 * mostram (Inadimplentes Multimarcas, Revenda, Franquias e Inadimplência
 * BlueCred), já com as correções que as telas não têm:
 *
 *   • "hoje" no fuso da loja (America/Fortaleza), não UTC — a parcela que
 *     vence hoje não vira vencida às 21h de ontem;
 *   • vencido decidido aqui (dt_vencimento < hoje) e não pelo filtro local do
 *     contas a receber, que usa o relógio UTC do servidor;
 *   • dias de atraso calculados só com a data (sem hora/fuso);
 *   • cliente de TESTE da integração BlueCard (3591) fora de todos os canais;
 *   • título deduplicado por (empresa, fatura, parcela);
 *   • juros E multa retornados (as telas somam na tela mas gravam só juros);
 *   • telefone: o manual do Call Center (call_center_contatos) tem prioridade
 *     sobre o do TOTVS, como na tela do Call Center; já sai normalizado com
 *     DDI 55 para a API do WhatsApp;
 *   • leituras do Supabase paginadas (o PostgREST corta em 1000 linhas);
 *   • só FATURA (tp_documento 1) filtrado no TOTVS, não no cliente.
 *
 * REGRAS (as mesmas das telas)
 *   canal MTM       classificação TOTVS tipo 20/2 ou tipo 5/1 (GET multibrand-clients)
 *   canal REVENDA   tipo 7/1 ou tipo 20/3 (GET reseller-clients); filiais < 5999 fora 98/980
 *   canal FRANQUIAS tipo 2/1 ou tipo 20/4 (GET franchise-clients)
 *   canal BLUECRED  CPFs do crediário (GET bluecred/clientes); filiais < 5999 fora 98/980/551
 *   título          situação 1 (normal), em aberto (sem baixa), documento 1 (FATURA),
 *                   vencimento < hoje; sem cheque/cartão/PIX
 *   situação        vencido (≤ 60 dias de atraso) | inadimplente (> 60 dias)
 *   precedência     cliente em mais de um canal conta no primeiro:
 *                   FRANQUIAS > MTM > REVENDA > BLUECRED (mesma do Dashboard)
 *
 * QUERY
 *   canal        todos | mtm | revenda | franquias | bluecred  (csv aceito; default todos)
 *   situacao     todos | vencido | inadimplente                 (default todos)
 *   dias_min     atraso mínimo em dias                          (default 1)
 *   dias_max     atraso máximo em dias                          (opcional)
 *   dt_inicio    vencimento a partir de (YYYY-MM-DD)            (default 2024-04-01)
 *   com_telefone 1 = só clientes com telefone válido para WhatsApp
 *   formato      clientes (agrupado, default) | titulos (uma linha por parcela)
 *   refresh      1 = ignora o cache de 10 min
 *
 * AUTENTICAÇÃO
 *   Se COBRANCA_API_TOKEN estiver definido no ambiente, a rota exige
 *   `x-api-key: <token>` ou `Authorization: Bearer <token>`. Sem a variável,
 *   fica aberta como as demais rotas /api/totvs (avisa no log).
 *
 * CONFIG
 *   INTERNAL_API_BASE_URL   base interna do próprio backend (default http://localhost:PORT)
 *   COBRANCA_API_TOKEN      token exigido do sistema externo (opcional)
 *   COBRANCA_CACHE_MIN      minutos de cache (default 10)
 */
import express from 'express';
import axios from 'axios';
import supabase from '../config/supabase.js';
import {
  asyncHandler,
  successResponse,
  errorResponse,
} from '../utils/errorHandler.js';
import { getToken } from '../utils/totvsTokenManager.js';
import { getBranchesWithNames } from '../totvsrouter/totvsHelper.js';
import {
  DIAS_INADIMPLENTE,
  DOC_FATURA,
  CLIENTES_TESTE,
  chaveTitulo,
  filtrarVencidos,
  agruparClientes,
  aplicarFiltros,
  resumir,
} from '../utils/cobrancaInadimplentes.js';

const router = express.Router();

// ─── Config ──────────────────────────────────────────────────────────────────
const INTERNAL_API_BASE =
  process.env.INTERNAL_API_BASE_URL ||
  `http://localhost:${process.env.PORT || 4100}`;
const TZ = 'America/Fortaleza';
const DT_INICIO_PADRAO = '2024-04-01';
const FILIAIS_FORA_REVENDA = new Set([98, 980]);
const FILIAIS_FORA_BLUECRED = new Set([98, 980, 551]);
const LOTE_CLIENTES = 500; // o TOTVS aceita ~1000 códigos por consulta
const LOTES_SIMULTANEOS = 5;
const CACHE_TTL = Number(process.env.COBRANCA_CACHE_MIN || 10) * 60 * 1000;

// Ordem = precedência quando o cliente está em mais de um canal
const CANAIS = [
  { key: 'FRANQUIAS', rota: '/api/totvs/franchise-clients', filial: () => true },
  { key: 'MTM', rota: '/api/totvs/multibrand-clients', filial: () => true },
  {
    key: 'REVENDA',
    rota: '/api/totvs/reseller-clients',
    filial: (bc) => Number(bc) < 5999 && !FILIAIS_FORA_REVENDA.has(Number(bc)),
  },
  {
    key: 'BLUECRED',
    rota: '/api/totvs/bluecred/clientes',
    filial: (bc) => Number(bc) < 5999 && !FILIAIS_FORA_BLUECRED.has(Number(bc)),
  },
];
const ALIAS_CANAL = {
  todos: null,
  mtm: 'MTM',
  multimarcas: 'MTM',
  revenda: 'REVENDA',
  franquias: 'FRANQUIAS',
  franquia: 'FRANQUIAS',
  bluecred: 'BLUECRED',
  bluecard: 'BLUECRED',
};

const hojeLoja = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ });

// GET interno no próprio backend (mesmo padrão dos jobs)
async function getInterno(path, params = {}, timeout = 15 * 60 * 1000) {
  const r = await axios.get(`${INTERNAL_API_BASE}${path}`, { params, timeout });
  if (r.data?.success === false) throw new Error(r.data?.message || path);
  return r.data;
}

// Leitura paginada do Supabase (PostgREST devolve no máximo 1000 por página)
async function lerTudo(tabela, colunas, aplicar = (q) => q) {
  const PAGINA = 1000;
  const linhas = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await aplicar(
      supabase.from(tabela).select(colunas).range(de, de + PAGINA - 1),
    );
    if (error) throw new Error(`${tabela}: ${error.message}`);
    linhas.push(...(data || []));
    if (!data || data.length < PAGINA) break;
  }
  return linhas;
}

// ─── Passo 1: quem é cliente de cada canal ───────────────────────────────────
async function listarCanal(canal) {
  const json = await getInterno(canal.rota);
  // bluecred/clientes devolve { codes: [...] }; os demais devolvem [{ code }]
  const lista = Array.isArray(json.data) ? json.data : json.data?.codes || [];
  const codigos = lista
    .map((c) => Number(typeof c === 'object' ? c.code : c))
    .filter((c) => Number.isFinite(c) && c > 0 && !CLIENTES_TESTE.has(c));
  const cadastro = new Map();
  for (const c of lista) {
    if (typeof c !== 'object') continue;
    cadastro.set(Number(c.code), {
      nome: c.name || '',
      fantasia: c.fantasyName || '',
      documento: c.cpfCnpj || c.cnpj || c.cpf || '',
      tipo_pessoa: c.personType || (c.cnpj ? 'PJ' : c.cpf ? 'PF' : null),
    });
  }
  return { codigos, cadastro };
}

// ─── Passo 2: contas a receber em aberto, em lotes de clientes ───────────────
async function titulosAbertos(codigos, dtInicio, hoje) {
  const lotes = [];
  for (let i = 0; i < codigos.length; i += LOTE_CLIENTES) {
    lotes.push(codigos.slice(i, i + LOTE_CLIENTES));
  }
  const itens = [];
  const avisos = [];
  for (let i = 0; i < lotes.length; i += LOTES_SIMULTANEOS) {
    const grupo = lotes.slice(i, i + LOTES_SIMULTANEOS);
    const resultados = await Promise.allSettled(
      grupo.map((lote) =>
        getInterno('/api/totvs/accounts-receivable/filter', {
          dt_inicio: dtInicio,
          dt_fim: hoje,
          modo: 'vencimento',
          situacao: '1',
          status: 'Em Aberto',
          tp_documento: String(DOC_FATURA),
          cd_cliente: lote.join(','),
        }),
      ),
    );
    resultados.forEach((r, idx) => {
      if (r.status === 'fulfilled') itens.push(...(r.value.data?.items || []));
      else avisos.push(`lote ${i + idx + 1}/${lotes.length}: ${r.reason?.message}`);
    });
  }
  return { itens, avisos };
}

// ─── Passo 3: nome/telefone/UF no TOTVS ──────────────────────────────────────
async function pessoas(codigos) {
  if (!codigos.length) return {};
  const r = await axios.post(
    `${INTERNAL_API_BASE}/api/totvs/persons/batch-lookup`,
    { personCodes: codigos },
    { timeout: 10 * 60 * 1000 },
  );
  return r.data?.data || {};
}

async function nomesDasFiliais() {
  try {
    const tokenData = await getToken();
    const lista = await getBranchesWithNames(tokenData?.access_token);
    return new Map((lista || []).map((b) => [Number(b.code), String(b.name || '')]));
  } catch {
    return new Map();
  }
}

// ─── Passo 4: dados operacionais do HeadCoach (Supabase) ─────────────────────
async function dadosHeadCoach() {
  const avisos = [];
  const telefoneManual = new Map();
  const representante = new Map();
  const emProtesto = new Set();
  await Promise.all([
    lerTudo('call_center_contatos', 'cd_cliente, telefone')
      .then((rows) =>
        rows.forEach((r) => {
          if (r.telefone) telefoneManual.set(Number(r.cd_cliente), r.telefone);
        }),
      )
      .catch((e) => avisos.push(`telefone manual indisponível: ${e.message}`)),
    lerTudo('classificacoes_inadimplentes', 'cd_cliente, representante')
      .then((rows) =>
        rows.forEach((r) => {
          if (r.representante) representante.set(Number(r.cd_cliente), r.representante);
        }),
      )
      .catch((e) => avisos.push(`representante indisponível: ${e.message}`)),
    lerTudo('esteira_protesto', 'cd_empresa, nr_fat, nr_parcela')
      .then((rows) => rows.forEach((r) => emProtesto.add(chaveTitulo(r))))
      .catch((e) => avisos.push(`esteira de protesto indisponível: ${e.message}`)),
  ]);
  return { telefoneManual, representante, emProtesto, avisos };
}

// ─── Montagem ────────────────────────────────────────────────────────────────
async function montar(canaisPedidos, dtInicio) {
  const t0 = Date.now();
  const hoje = hojeLoja();
  const avisos = [];

  // 1) listas por canal, em paralelo; canal que falhar sai com aviso
  const listas = await Promise.allSettled(canaisPedidos.map(listarCanal));
  const canalDoCliente = new Map(); // cd_cliente → canal (precedência = ordem de CANAIS)
  const cadastro = new Map();
  canaisPedidos.forEach((canal, i) => {
    const r = listas[i];
    if (r.status === 'rejected') {
      avisos.push(`canal ${canal.key} fora desta carga: ${r.reason?.message}`);
      return;
    }
    for (const cod of r.value.codigos) {
      if (!canalDoCliente.has(cod)) canalDoCliente.set(cod, canal);
    }
    for (const [cod, dados] of r.value.cadastro) {
      if (!cadastro.has(cod)) cadastro.set(cod, dados);
    }
  });
  const codigos = [...canalDoCliente.keys()];

  // 2) títulos em aberto até hoje
  const { itens, avisos: avisosAR } = codigos.length
    ? await titulosAbertos(codigos, dtInicio, hoje)
    : { itens: [], avisos: [] };
  avisos.push(...avisosAR);

  // 3) vencidos de verdade, deduplicados, na filial certa do canal
  const vencidos = filtrarVencidos(itens, canalDoCliente, hoje);

  // 4) enriquecimento
  const codsComVencido = [...new Set(vencidos.map((t) => Number(t.cd_cliente)))];
  const [pessoasMap, nomeFilial, hc] = await Promise.all([
    pessoas(codsComVencido).catch((e) => {
      avisos.push(`cadastro TOTVS indisponível: ${e.message}`);
      return {};
    }),
    nomesDasFiliais(),
    dadosHeadCoach(),
  ]);
  avisos.push(...hc.avisos);

  // 5) agrupa por cliente
  const clientes = agruparClientes(vencidos, {
    pessoas: pessoasMap,
    cadastro,
    nomeFilial,
    telefoneManual: hc.telefoneManual,
    representante: hc.representante,
    emProtesto: hc.emProtesto,
  });

  console.log(
    `[cobranca/inadimplentes] ${codigos.length} clientes nos canais · ${itens.length} títulos abertos · ` +
      `${clientes.length} devedores (${vencidos.length} títulos) em ${Date.now() - t0}ms`,
  );
  return {
    hoje,
    gerado_em: new Date().toISOString(),
    dias_inadimplente: DIAS_INADIMPLENTE,
    dt_inicio: dtInicio,
    canais: canaisPedidos.map((c) => c.key),
    clientes_nos_canais: codigos.length,
    avisos,
    clientes,
  };
}

// ─── Cache (por conjunto de canais + dt_inicio; filtros são aplicados depois)
const cache = new Map();
async function obter(canaisPedidos, dtInicio, refresh) {
  const chave = `${canaisPedidos.map((c) => c.key).join(',')}|${dtInicio}`;
  const c = cache.get(chave);
  if (!refresh && c?.data && Date.now() - c.ts < CACHE_TTL) return { ...c.data, cached: true };
  // single-flight: duas chamadas simultâneas disparam UMA montagem
  if (!refresh && c?.pendente) return { ...(await c.pendente), cached: false };
  const pendente = montar(canaisPedidos, dtInicio);
  cache.set(chave, { ts: 0, data: null, pendente });
  try {
    const data = await pendente;
    cache.set(chave, { ts: Date.now(), data });
    return { ...data, cached: false };
  } catch (e) {
    cache.delete(chave);
    throw e;
  }
}

// ─── Autenticação opcional ───────────────────────────────────────────────────
let avisouSemToken = false;
function exigirToken(req, res, next) {
  const esperado = process.env.COBRANCA_API_TOKEN;
  if (!esperado) {
    if (!avisouSemToken) {
      console.warn('⚠️ [cobranca] COBRANCA_API_TOKEN não definido — rota aberta');
      avisouSemToken = true;
    }
    return next();
  }
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const recebido = req.headers['x-api-key'] || bearer;
  if (recebido !== esperado) {
    return errorResponse(res, 'Token inválido', 401, 'UNAUTHORIZED');
  }
  next();
}

// ─── Rota ────────────────────────────────────────────────────────────────────
router.get(
  '/inadimplentes',
  exigirToken,
  asyncHandler(async (req, res) => {
    req.setTimeout(20 * 60 * 1000);

    const pedidos = String(req.query.canal || 'todos')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const invalidos = pedidos.filter((p) => !(p in ALIAS_CANAL));
    if (invalidos.length) {
      return errorResponse(
        res,
        `canal inválido: ${invalidos.join(', ')} (use todos, mtm, revenda, franquias, bluecred)`,
        400,
        'INVALID_CANAL',
      );
    }
    const keys = new Set(pedidos.map((p) => ALIAS_CANAL[p]).filter(Boolean));
    const canaisPedidos =
      pedidos.includes('todos') || !keys.size ? CANAIS : CANAIS.filter((c) => keys.has(c.key));

    const dtInicio = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.dt_inicio || ''))
      ? String(req.query.dt_inicio)
      : DT_INICIO_PADRAO;
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const situacao = String(req.query.situacao || 'todos').toLowerCase();
    if (!['todos', 'vencido', 'inadimplente'].includes(situacao)) {
      return errorResponse(res, 'situacao deve ser todos, vencido ou inadimplente', 400, 'INVALID_SITUACAO');
    }
    const diasMin = Math.max(1, Number(req.query.dias_min) || 1);
    const diasMax = req.query.dias_max ? Number(req.query.dias_max) : null;
    const comTelefone = req.query.com_telefone === '1' || req.query.com_telefone === 'true';
    const formato = String(req.query.formato || 'clientes').toLowerCase();

    const base = await obter(canaisPedidos, dtInicio, refresh);
    const clientes = aplicarFiltros(base.clientes, { situacao, diasMin, diasMax, comTelefone });

    const comum = {
      hoje: base.hoje,
      gerado_em: base.gerado_em,
      cached: base.cached,
      dias_inadimplente: base.dias_inadimplente,
      parametros: {
        canais: base.canais,
        dt_inicio: base.dt_inicio,
        situacao,
        dias_min: diasMin,
        dias_max: diasMax,
        com_telefone: comTelefone,
        formato,
      },
      avisos: base.avisos,
      resumo: resumir(clientes),
    };

    if (formato === 'titulos') {
      const titulos = clientes.flatMap((c) => {
        const { titulos: ts, ...cliente } = c;
        return ts.map((t) => ({ ...cliente, ...t }));
      });
      return successResponse(res, { ...comum, titulos }, `${titulos.length} título(s) vencido(s)`);
    }
    return successResponse(res, { ...comum, clientes }, `${clientes.length} cliente(s) devedor(es)`);
  }),
);

export default router;
