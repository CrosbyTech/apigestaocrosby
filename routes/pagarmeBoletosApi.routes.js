/**
 * API externa — Boletos Pagar.me (Contas a Receber › Remessa Boletos).
 *
 * Tudo o que a tela "Retorno Boleto" mostra, para outros sistemas consumirem:
 * fatura, cliente, situação do boleto, linha digitável, PDF (boleto da Stone),
 * pagamento e baixa no TOTVS.
 *
 *   GET /api/pagarme-boletos                      lista com filtros + paginação
 *   GET /api/pagarme-boletos/resumo               totais por situação
 *   GET /api/pagarme-boletos/:id                  um boleto (id interno ou or_xxx da Pagar.me)
 *   GET /api/pagarme-boletos/:id/pdf              PDF do boleto (proxy da Pagar.me)
 *   GET /api/pagarme-boletos/fatura/:empresa/:fatura/:parcela?   boletos de uma fatura TOTVS
 *
 * FILTROS DA LISTA (query)
 *   situacao    aberto | vencido | pago | cancelado | falhou  (vários separados por vírgula)
 *   modo        vencimento (default) | emissao | pagamento  — a que data dt_inicio/dt_fim se referem
 *   dt_inicio, dt_fim   YYYY-MM-DD
 *   empresa     códigos de filial separados por vírgula
 *   cliente     código do cliente TOTVS
 *   documento   CPF/CNPJ do cliente (só dígitos)
 *   fatura      número da fatura TOTVS
 *   page, pageSize (default 200, máx 1000)
 *
 * AUTENTICAÇÃO
 *   Se PAGARME_BOLETOS_API_TOKEN estiver definido no ambiente, exige
 *   `x-api-key: <token>` ou `Authorization: Bearer <token>`. Sem a variável,
 *   fica aberta como as demais rotas (avisa no log).
 */
import express from 'express';
import {
  asyncHandler,
  successResponse,
  errorResponse,
} from '../utils/errorHandler.js';
import { listarBoletos } from '../services/pagarmeBoletos.js';

const router = express.Router();

const SITUACOES = ['aberto', 'vencido', 'pago', 'cancelado', 'falhou'];
const PAGE_SIZE_PADRAO = 200;
const PAGE_SIZE_MAX = 1000;

// ─── Autenticação opcional ───────────────────────────────────────────────────
let avisouSemToken = false;
function exigirToken(req, res, next) {
  const esperado = process.env.PAGARME_BOLETOS_API_TOKEN;
  if (!esperado) {
    if (!avisouSemToken) {
      console.warn(
        '⚠️ [pagarme-boletos-api] PAGARME_BOLETOS_API_TOKEN não definido — rota aberta',
      );
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
router.use(exigirToken);

// ─── Formato externo (estável, sem colunas internas) ─────────────────────────
const SITUACAO_LABEL = {
  aberto: 'Em aberto',
  vencido: 'Vencido',
  pago: 'Pago',
  cancelado: 'Cancelado',
  falhou: 'Não emitido',
};
const BAIXA_LABEL = {
  pendente: 'Aguardando baixa',
  processando: 'Baixando',
  processada: 'Baixada no TOTVS',
  erro: 'Erro na baixa',
};

export function formatarBoleto(b, req) {
  const base = `${req.protocol}://${req.get('host')}`;
  return {
    id: b.id,
    remessa_id: b.remessa_id,
    emitido_em: b.created_at,
    atualizado_em: b.updated_at,
    situacao: b.situacao,
    situacao_descricao: SITUACAO_LABEL[b.situacao] || b.situacao,
    status_pagarme: b.status,
    erro: b.status === 'failed' ? b.erro_descricao || b.erro : null,
    fatura: {
      cd_empresa: b.cd_empresa,
      nr_fatura: b.nr_fatura,
      nr_parcela: b.nr_parcela,
      dt_emissao: b.dt_emissao,
      dt_vencimento: b.dt_vencimento,
      vl_fatura: Number(b.vl_fatura),
      portador_totvs: b.cd_portador_totvs,
      nm_portador_totvs: b.nm_portador_totvs,
      carteira_simples_totvs: Boolean(b.carteira_ok),
    },
    cliente: {
      cd_cliente: b.cd_cliente,
      nome: b.nm_cliente,
      documento: b.nr_documento,
    },
    boleto: b.linha_digitavel
      ? {
          order_id: b.order_id,
          charge_id: b.charge_id,
          nosso_numero: b.nosso_numero,
          linha_digitavel: b.linha_digitavel,
          url: b.boleto_url,
          pdf: b.boleto_pdf,
          pdf_proxy: `${base}/api/pagarme-boletos/${b.id}/pdf`,
          banco: '197',
          banco_nome: 'Stone',
        }
      : null,
    pagamento:
      b.status === 'paid'
        ? { pago_em: b.dt_pagamento, vl_pago: b.vl_pago == null ? null : Number(b.vl_pago) }
        : null,
    baixa_totvs:
      b.status === 'paid'
        ? {
            status: b.baixa_status,
            descricao: BAIXA_LABEL[b.baixa_status] || b.baixa_status,
            baixada_em: b.baixa_em,
            erro: b.baixa_erro,
          }
        : null,
  };
}

function lerFiltros(q) {
  const lista = (v) =>
    String(v || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  const situacoes = lista(q.situacao).map((s) => s.toLowerCase());
  const invalidas = situacoes.filter((s) => !SITUACOES.includes(s));
  if (invalidas.length) {
    throw Object.assign(
      new Error(`situacao inválida: ${invalidas.join(', ')} (use ${SITUACOES.join(', ')})`),
      { status: 400 },
    );
  }
  return {
    branches: lista(q.empresa || q.branches)
      .map((b) => parseInt(b, 10))
      .filter((b) => !isNaN(b) && b > 0),
    dt_inicio: q.dt_inicio || undefined,
    dt_fim: q.dt_fim || undefined,
    modo: q.modo || 'vencimento',
    cd_cliente: q.cliente ? parseInt(q.cliente, 10) : undefined,
    nr_fatura: q.fatura ? parseInt(q.fatura, 10) : undefined,
    documento: q.documento ? String(q.documento).replace(/\D/g, '') : undefined,
    situacoes,
  };
}

async function consultar(q) {
  const f = lerFiltros(q);
  const { items, tabelaAusente } = await listarBoletos(f);
  const filtrados = f.situacoes.length
    ? items.filter((b) => f.situacoes.includes(b.situacao))
    : items;
  return { items: filtrados, tabelaAusente, filtros: f };
}

// GET /api/pagarme-boletos
router.get(
  '/',
  asyncHandler(async (req, res) => {
    let r;
    try {
      r = await consultar(req.query);
    } catch (e) {
      if (e.status === 400) return errorResponse(res, e.message, 400, 'INVALID_FILTER');
      throw e;
    }
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(
      PAGE_SIZE_MAX,
      Math.max(1, parseInt(req.query.pageSize, 10) || PAGE_SIZE_PADRAO),
    );
    const inicio = (page - 1) * pageSize;
    const pagina = r.items.slice(inicio, inicio + pageSize);
    return successResponse(
      res,
      {
        total: r.items.length,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(r.items.length / pageSize)),
        valorTotal: Number(r.items.reduce((s, b) => s + Number(b.vl_fatura || 0), 0).toFixed(2)),
        items: pagina.map((b) => formatarBoleto(b, req)),
      },
      'Boletos Pagar.me',
    );
  }),
);

// GET /api/pagarme-boletos/resumo
router.get(
  '/resumo',
  asyncHandler(async (req, res) => {
    let r;
    try {
      r = await consultar(req.query);
    } catch (e) {
      if (e.status === 400) return errorResponse(res, e.message, 400, 'INVALID_FILTER');
      throw e;
    }
    const porSituacao = {};
    for (const s of SITUACOES) porSituacao[s] = { quantidade: 0, valor: 0, descricao: SITUACAO_LABEL[s] };
    let baixadas = 0;
    let aguardandoBaixa = 0;
    let erroBaixa = 0;
    for (const b of r.items) {
      porSituacao[b.situacao].quantidade++;
      porSituacao[b.situacao].valor = Number(
        (porSituacao[b.situacao].valor + Number(b.vl_fatura || 0)).toFixed(2),
      );
      if (b.status === 'paid') {
        if (b.baixa_status === 'processada') baixadas++;
        else if (b.baixa_status === 'erro') erroBaixa++;
        else aguardandoBaixa++;
      }
    }
    return successResponse(
      res,
      {
        total: r.items.length,
        por_situacao: porSituacao,
        baixa_totvs: { baixadas, aguardando: aguardandoBaixa, erro: erroBaixa },
      },
      'Resumo dos boletos Pagar.me',
    );
  }),
);

// GET /api/pagarme-boletos/fatura/:empresa/:fatura/:parcela?
router.get(
  '/fatura/:empresa/:fatura/:parcela?',
  asyncHandler(async (req, res) => {
    const cd_empresa = parseInt(req.params.empresa, 10);
    const nr_fatura = parseInt(req.params.fatura, 10);
    const nr_parcela = req.params.parcela ? parseInt(req.params.parcela, 10) : null;
    if (isNaN(cd_empresa) || isNaN(nr_fatura)) {
      return errorResponse(res, 'empresa e fatura devem ser numéricos', 400, 'INVALID_PARAMS');
    }
    const { items } = await listarBoletos({ branches: [cd_empresa], nr_fatura });
    const lista = items
      .filter((b) => nr_parcela == null || Number(b.nr_parcela) === nr_parcela)
      .sort((a, b) => b.id - a.id); // mais recente primeiro
    if (!lista.length) {
      return errorResponse(res, 'Fatura sem boleto Pagar.me', 404, 'NOT_FOUND');
    }
    return successResponse(
      res,
      {
        // o "vivo" (não falhou/cancelado) é o que vale; o histórico vem junto
        atual: formatarBoleto(lista.find((b) => !['failed', 'canceled'].includes(b.status)) || lista[0], req),
        historico: lista.map((b) => formatarBoleto(b, req)),
      },
      'Boletos da fatura',
    );
  }),
);

async function buscarUm(idOuOrder) {
  const porOrder = /^or_/i.test(idOuOrder);
  const { items } = await listarBoletos(porOrder ? { order_id: idOuOrder } : { id: parseInt(idOuOrder, 10) });
  return items[0] || null;
}

// GET /api/pagarme-boletos/:id/pdf — repassa o PDF do boleto (Stone via Pagar.me)
router.get(
  '/:id/pdf',
  asyncHandler(async (req, res) => {
    const b = await buscarUm(req.params.id);
    if (!b) return errorResponse(res, 'Boleto não encontrado', 404, 'NOT_FOUND');
    if (!b.boleto_pdf) return errorResponse(res, 'Boleto sem PDF (não emitido)', 404, 'NO_PDF');
    const r = await fetch(b.boleto_pdf);
    if (!r.ok) return errorResponse(res, `Pagar.me respondeu ${r.status}`, 502, 'PAGARME_ERROR');
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="boleto-${b.cd_empresa}-${b.nr_fatura}-${b.nr_parcela}.pdf"`,
    );
    return res.send(buf);
  }),
);

// GET /api/pagarme-boletos/:id — id interno ou or_xxx da Pagar.me
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!/^(\d+|or_[A-Za-z0-9]+)$/.test(req.params.id)) {
      return errorResponse(res, 'id deve ser numérico ou um order_id (or_...)', 400, 'INVALID_ID');
    }
    const b = await buscarUm(req.params.id);
    if (!b) return errorResponse(res, 'Boleto não encontrado', 404, 'NOT_FOUND');
    return successResponse(res, formatarBoleto(b, req), 'Boleto Pagar.me');
  }),
);

export default router;
