// ============================================================================
// PEDIDOS DE VENDA (Dryland) — montado em /api/pedidos-venda
// Página /expedicao/pedidos-venda. A lista é a FILA DE FATURAMENTO do Painel
// do Dryland (/frete): um card por venda de todos os canais (cópia em
// pedidos_venda_fila), juntando a SEPARAÇÃO do pedido do site
// (pedidos_venda_dryland, por numero_site = ref). Pedido do site que ainda não
// tem card na fila (aguardando separação) entra também, pela separação.
// Cópia feita pelo job pedidos-venda-sync (services/pedidosVendaDryland.js).
//
//   GET  /?canal=&status=&separacao=&transferencias=1&de=&ate=&busca=   lista + resumo
//   GET  /:chave                     detalhe (chave = id do card ou SEP:<ref>)
//   POST /sincronizar                copia agora do Dryland
//   PUT  /:chave/pagamento           { forma, nsu, autorizacao, obs, por } registro manual
//   POST /:chave/comprovante         { base64, nome, tipo } foto/PDF anexado no HeadCoach
// ============================================================================
import express from 'express';
import supabase from '../config/supabase.js';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';
import {
  sincronizarPedidosDryland,
  registrarPagamentoManual,
  salvarComprovante,
  COMPROVANTE_URL,
} from '../services/pedidosVendaDryland.js';

const router = express.Router();

// Uma sincronização por vez (job e botão da tela dividem a trava)
let emAndamento = null;
let ultima = null; // { em, resultado }
export async function sincronizarComTrava() {
  if (emAndamento) return { emAndamento: true, ...(await emAndamento) };
  emAndamento = sincronizarPedidosDryland()
    .then((r) => {
      ultima = { em: new Date().toISOString(), resultado: r };
      return r;
    })
    .finally(() => {
      emAndamento = null;
    });
  return emAndamento;
}

function responder(res, err) {
  if (/pedidos_venda_/.test(err?.message || '') && /does not exist|schema cache/i.test(err.message)) {
    return errorResponse(res, 'Tabelas de pedidos não existem — rode migrations/pedidos_venda_*.sql', 503, 'MIGRATION_PENDING');
  }
  return errorResponse(res, err?.message || 'Erro nos pedidos de venda', 500, 'DB_ERROR');
}

// canal da separação → canal da fila
const CANAL_SEP = { revenda: 'revenda', varejo: 'varejo', multimarca: 'mtm', franquia: 'franquias', transferencia: 'varejo', brinde: 'varejo' };

async function lerTudo(tabela, montar) {
  const out = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await montar(supabase.from(tabela)).range(off, off + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const resumoSep = (p) => (p ? { status: p.status, qtd_pecas: p.qtd_pecas, qtd_separada: p.qtd_separada, separado_em: p.separado_em } : null);

// Linha da tela a partir do card da fila (+ separação do pedido do site)
function linhaDoCard(c, sep, anexo) {
  return {
    chave: c.id,
    fonte: 'fila',
    canal: c.canal,
    titulo: c.titulo,
    status_fat: c.status,
    numero_site: c.numero_site,
    pedido_totvs: c.pedido_totvs,
    transacao: c.transacao,
    eh_venda: c.eh_venda,
    cliente: c.cliente,
    cliente_doc: c.cliente_doc,
    cliente_telefone: c.cliente_telefone,
    vendedor: c.vendedor,
    loja: c.loja,
    forma_pagamento: anexo?.pagamento_manual?.forma || c.forma_pagamento,
    parcelamento: c.parcelamento,
    valor: c.valor_pedido != null ? Number(c.valor_pedido) : sep ? Number(sep.valor_total) : null,
    nf_numero: c.nf_numero,
    tem_nsu: !!(c.cartao_nsu || c.pix_e2e || anexo?.pagamento_manual?.nsu),
    nsu: anexo?.pagamento_manual?.nsu || c.cartao_nsu || null,
    autorizacao: anexo?.pagamento_manual?.autorizacao || c.cartao_autorizacao || null,
    comprovantes: (c.comprovantes || []).length + (anexo?.comprovante_url ? 1 : 0),
    criado_em: c.criado_em,
    sumiu_do_dryland_em: c.sumiu_do_dryland_em,
    separacao: resumoSep(sep),
  };
}

// Pedido do site que ainda não tem card na fila (aguardando separação)
function linhaDaSeparacao(p, anexo) {
  return {
    chave: `SEP:${p.ref}`,
    fonte: 'separacao',
    canal: CANAL_SEP[p.canal] || p.canal,
    titulo: `SITE ${p.ref} — ${p.cliente || ''}`.trim(),
    status_fat: null,
    numero_site: p.ref,
    pedido_totvs: (p.totvs_pedidos || []).join(', ') || null,
    transacao: null,
    eh_venda: p.eh_venda,
    cliente: p.cliente,
    cliente_doc: p.cliente_doc,
    cliente_telefone: p.cliente_telefone,
    vendedor: p.vendedor_nome ? `${p.vendedor_code ? `${p.vendedor_code} - ` : ''}${p.vendedor_nome}` : null,
    loja: null,
    forma_pagamento: anexo?.pagamento_manual?.forma || p.pagamento,
    parcelamento: p.pagamento_info?.parcelas || null,
    valor: Number(p.valor_total),
    nf_numero: null,
    tem_nsu: !!(p.pagamento_info?.nsu || p.pagamento_info?.end_to_end_id || anexo?.pagamento_manual?.nsu),
    nsu: anexo?.pagamento_manual?.nsu || p.pagamento_info?.nsu || null,
    autorizacao: anexo?.pagamento_manual?.autorizacao || p.pagamento_info?.autorizacao || null,
    comprovantes: anexo?.comprovante_url ? 1 : 0,
    criado_em: p.criado_em,
    sumiu_do_dryland_em: p.sumiu_do_dryland_em,
    separacao: resumoSep(p),
  };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { canal, status, separacao, de, ate } = req.query;
    const busca = String(req.query.busca || '').trim().toUpperCase();
    const comTransf = req.query.transferencias === '1';
    const deIso = de ? `${String(de).slice(0, 10)}T00:00:00-03:00` : null;
    const ateIso = ate ? `${String(ate).slice(0, 10)}T23:59:59.999-03:00` : null;
    try {
      const [cards, seps, anexos] = await Promise.all([
        lerTudo('pedidos_venda_fila', (q) => {
          let x = q
            .select(
              'id, canal, titulo, status, numero_site, pedido_totvs, transacao, eh_venda, cliente, cliente_doc, cliente_telefone, vendedor, loja, forma_pagamento, parcelamento, valor_pedido, nf_numero, cartao_nsu, cartao_autorizacao, pix_e2e, comprovantes, criado_em, sumiu_do_dryland_em',
            )
            .order('criado_em', { ascending: false });
          if (deIso) x = x.gte('criado_em', deIso);
          if (ateIso) x = x.lte('criado_em', ateIso);
          return x;
        }),
        lerTudo('pedidos_venda_dryland', (q) => q.select('*').order('ref')),
        lerTudo('pedidos_venda_anexos', (q) => q.select('chave, pagamento_manual, comprovante_url').order('chave')),
      ]);
      const sepPorRef = new Map(seps.map((p) => [p.ref, p]));
      const anexoPor = new Map(anexos.map((a) => [a.chave, a]));
      const comCard = new Set();
      let linhas = cards.map((c) => {
        if (c.numero_site) comCard.add(c.numero_site);
        return linhaDoCard(c, c.numero_site ? sepPorRef.get(c.numero_site) : null, anexoPor.get(c.id));
      });
      for (const p of seps) {
        if (comCard.has(p.ref)) continue;
        if (deIso && p.criado_em && p.criado_em < new Date(deIso).toISOString()) continue;
        if (ateIso && p.criado_em && p.criado_em > new Date(ateIso).toISOString()) continue;
        linhas.push(linhaDaSeparacao(p, anexoPor.get(`SEP:${p.ref}`)));
      }
      if (!comTransf) linhas = linhas.filter((l) => l.eh_venda);
      if (canal) linhas = linhas.filter((l) => l.canal === canal);
      if (status) linhas = linhas.filter((l) => (l.status_fat || '').toLowerCase() === String(status).toLowerCase());
      if (separacao === 'sem') linhas = linhas.filter((l) => !l.separacao);
      else if (separacao) linhas = linhas.filter((l) => l.separacao?.status === separacao);
      if (busca) {
        linhas = linhas.filter((l) =>
          [l.titulo, l.cliente, l.numero_site, l.vendedor, l.pedido_totvs, l.transacao, l.nf_numero, l.cliente_doc, l.nsu, l.autorizacao]
            .filter(Boolean)
            .some((v) => String(v).toUpperCase().includes(busca)),
        );
      }
      linhas.sort((a, b) => String(b.criado_em || '').localeCompare(String(a.criado_em || '')));
      const soma = (fn) => linhas.reduce((s, l) => s + fn(l), 0);
      const conta = (fn) => linhas.filter(fn).length;
      return successResponse(
        res,
        {
          items: linhas,
          resumo: {
            pedidos: linhas.length,
            valor: Math.round(soma((l) => Number(l.valor || 0)) * 100) / 100,
            aguardando: conta((l) => l.separacao?.status === 'aguardando'),
            emSeparacao: conta((l) => l.separacao?.status === 'em_separacao'),
            separados: conta((l) => l.separacao?.status === 'separado'),
            semSeparacao: conta((l) => !l.separacao),
            aFaturar: conta((l) => /^a faturar$/i.test(l.status_fat || '')),
            faturados: conta((l) => /faturad|enviado|conclu/i.test(l.status_fat || '')),
            comComprovante: conta((l) => l.comprovantes > 0),
          },
          statusFat: [...new Set(linhas.map((l) => l.status_fat).filter(Boolean))].sort(),
          sincronizacao: ultima,
        },
        `${linhas.length} pedido(s)`,
      );
    } catch (err) {
      return responder(res, err);
    }
  }),
);

router.post(
  '/sincronizar',
  asyncHandler(async (req, res) => {
    try {
      const r = await sincronizarComTrava();
      return successResponse(res, r, `${r.fila?.cards ?? 0} venda(s) da fila e ${r.pedidos} pedido(s) da separação atualizados`);
    } catch (err) {
      return errorResponse(res, `Não consegui ler o Dryland: ${err.message}`, 502, 'DRYLAND_ERROR');
    }
  }),
);

router.get(
  '/:chave',
  asyncHandler(async (req, res) => {
    const chave = String(req.params.chave);
    try {
      let card = null;
      let ref = null;
      if (chave.startsWith('SEP:')) ref = chave.slice(4).toUpperCase();
      else {
        const { data, error } = await supabase.from('pedidos_venda_fila').select('*').eq('id', chave).maybeSingle();
        if (error) throw error;
        if (!data) return errorResponse(res, 'Pedido não encontrado', 404, 'NOT_FOUND');
        card = data;
        ref = data.numero_site;
      }
      const [sep, itens, anexo] = await Promise.all([
        ref ? supabase.from('pedidos_venda_dryland').select('*').eq('ref', ref).maybeSingle() : Promise.resolve({ data: null }),
        ref ? supabase.from('pedidos_venda_dryland_itens').select('*').eq('ref', ref).order('descricao') : Promise.resolve({ data: [] }),
        supabase.from('pedidos_venda_anexos').select('*').eq('chave', chave).maybeSingle(),
      ]);
      if (!card && !sep.data) return errorResponse(res, 'Pedido não encontrado', 404, 'NOT_FOUND');
      return successResponse(
        res,
        {
          chave,
          card: card ? { ...card, comprovantes_url: (card.comprovantes || []).map((p) => ({ path: p, url: COMPROVANTE_URL(p) })) } : null,
          separacao: sep.data || null,
          itens: itens.data || [],
          anexo: anexo.data || null,
        },
        'Pedido',
      );
    } catch (err) {
      return responder(res, err);
    }
  }),
);

router.put(
  '/:chave/pagamento',
  asyncHandler(async (req, res) => {
    try {
      const a = await registrarPagamentoManual(String(req.params.chave), req.body || {});
      return successResponse(res, a, 'Pagamento registrado');
    } catch (err) {
      return errorResponse(res, err.message, 400, 'PAGAMENTO_INVALIDO');
    }
  }),
);

router.post(
  '/:chave/comprovante',
  asyncHandler(async (req, res) => {
    try {
      const a = await salvarComprovante(String(req.params.chave), req.body || {});
      return successResponse(res, a, 'Comprovante salvo');
    } catch (err) {
      return errorResponse(res, err.message, 400, 'COMPROVANTE_INVALIDO');
    }
  }),
);

export default router;
