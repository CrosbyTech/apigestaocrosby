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
//   GET  /painel?dias=&forcar=1      Painel da expedição (cópia do PAINEL do /frete do Dryland, só leitura)
//   GET  /painel/concluidos?q=       busca de concluídos fora dos 500 cards do painel
//   GET  /painel/duplicatas          lista completa das duplicatas do boleto
//   GET  /painel/expedicao?q=        consulta de expedição (rastreio por transação/NF/cliente)
//   POST /painel/rastreio-correios   { codigo } rastreio Correios ao vivo
//   GET  /:chave                     detalhe (chave = id do card ou SEP:<ref>)
//   POST /sincronizar                copia agora do Dryland
//   PUT  /:chave/pagamento           { forma, nsu, autorizacao, obs, por } registro manual
//   POST /:chave/comprovante         { base64, nome, tipo } foto/PDF anexado no HeadCoach
//   POST /:chave/faturamentos        registra a transação de venda gerada na tela FATURAMENTO
//   POST /faturamentos/:id/status    { status } acompanha a transação (1 andamento · 4 atendida · 6 cancelada)
// ============================================================================
import express from 'express';
import supabase from '../config/supabase.js';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';
import { cardBrejinho } from '../services/brejinhoDryland.js';
import {
  montarPainel,
  buscarConcluidos,
  listarDuplicatas,
  consultarExpedicao,
  rastreioCorreios,
} from '../services/painelExpedicaoDryland.js';
import {
  sincronizarPedidosDryland,
  registrarPagamentoManual,
  salvarComprovante,
  COMPROVANTE_URL,
  linhaSeparadaVale,
  separacaoIncompleta,
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

// Último faturamento (transação gerada no HeadCoach) que não foi cancelado
const resumoFat = (lista) => {
  // NF-e pelo HeadCoach: só conta a autorizada; fluxo antigo: transação não cancelada
  const vivos = (lista || []).filter((f) => (f.venda_id ? f.nf_status === 'autorizada' : f.transacao_status !== 6));
  const f = vivos[0] || null;
  return f
    ? { id: f.id, transacao: f.transacao_code, nf: f.nf_numero, status: f.transacao_status, em: f.criado_em, qtd: f.qtd_conferida, total: Number(f.total) }
    : null;
};

const resumoSep = (p, criadoPedido = null) =>
  p ? { status: p.status, qtd_pecas: p.qtd_pecas, qtd_separada: p.qtd_separada, separado_em: p.separado_em, incompleta: separacaoIncompleta(p, criadoPedido), viva: !p.sumiu_do_dryland_em } : null;

// Linha da tela a partir do card da fila (+ separação do pedido do site)
function linhaDoCard(c, sep, anexo, fats) {
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
    separacao: resumoSep(sep, c.criado_em),
    pecas_card: c.total_pecas != null ? Number(c.total_pecas) : null,
    faturamento: resumoFat(fats),
  };
}

// Pedido do site que ainda não tem card na fila (aguardando separação)
function linhaDaSeparacao(p, anexo, fats) {
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
    faturamento: resumoFat(fats),
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
      const [cards, seps, anexos, fats] = await Promise.all([
        lerTudo('pedidos_venda_fila', (q) => {
          let x = q
            .select(
              'id, canal, titulo, status, numero_site, pedido_totvs, transacao, eh_venda, cliente, cliente_doc, cliente_telefone, vendedor, loja, forma_pagamento, parcelamento, valor_pedido, nf_numero, cartao_nsu, cartao_autorizacao, pix_e2e, comprovantes, criado_em, sumiu_do_dryland_em, total_pecas',
            )
            .order('criado_em', { ascending: false });
          if (deIso) x = x.gte('criado_em', deIso);
          if (ateIso) x = x.lte('criado_em', ateIso);
          return x;
        }),
        lerTudo('pedidos_venda_dryland', (q) => q.select('*').order('ref')),
        lerTudo('pedidos_venda_anexos', (q) => q.select('chave, pagamento_manual, comprovante_url').order('chave')),
        lerTudo('pedidos_venda_faturamentos', (q) =>
          q.select('id, chave, venda_id, nf_numero, nf_status, transacao_code, transacao_status, qtd_conferida, total, criado_em').order('criado_em', { ascending: false }),
        ).catch(() => []),
      ]);
      const fatsPor = new Map();
      for (const f of fats) {
        if (!fatsPor.has(f.chave)) fatsPor.set(f.chave, []);
        fatsPor.get(f.chave).push(f);
      }
      const sepPorRef = new Map(seps.map((p) => [p.ref, p]));
      const anexoPor = new Map(anexos.map((a) => [a.chave, a]));
      const comCard = new Set();
      let linhas = cards.map((c) => {
        if (c.numero_site) comCard.add(c.numero_site);
        return linhaDoCard(c, c.numero_site ? sepPorRef.get(c.numero_site) : null, anexoPor.get(c.id), fatsPor.get(c.id));
      });
      for (const p of seps) {
        if (comCard.has(p.ref)) continue;
        if (deIso && p.criado_em && p.criado_em < new Date(deIso).toISOString()) continue;
        if (ateIso && p.criado_em && p.criado_em > new Date(ateIso).toISOString()) continue;
        linhas.push(linhaDaSeparacao(p, anexoPor.get(`SEP:${p.ref}`), fatsPor.get(`SEP:${p.ref}`)));
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
            faturadosHeadcoach: conta((l) => !!l.faturamento),
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

// ─── PAINEL DA EXPEDIÇÃO (antes do /:chave, senão "painel" vira chave) ───────
const falhaDryland = (res, err) => errorResponse(res, `Não consegui ler o Dryland: ${err.message}`, 502, 'DRYLAND_ERROR');

router.get(
  '/painel',
  asyncHandler(async (req, res) => {
    try {
      const p = await montarPainel({ diasVarejo: req.query.dias, forcar: req.query.forcar === '1' });
      return successResponse(res, p, `${p.cards.length} card(s) do painel`);
    } catch (err) {
      return falhaDryland(res, err);
    }
  }),
);

router.get(
  '/painel/concluidos',
  asyncHandler(async (req, res) => {
    try {
      const l = await buscarConcluidos(req.query.q);
      return successResponse(res, l, `${l.length} concluído(s)`);
    } catch (err) {
      return falhaDryland(res, err);
    }
  }),
);

router.get(
  '/painel/duplicatas',
  asyncHandler(async (req, res) => {
    try {
      const l = await listarDuplicatas({ forcar: req.query.forcar === '1' });
      return successResponse(res, l, `${l.length} card(s) no boleto`);
    } catch (err) {
      return falhaDryland(res, err);
    }
  }),
);

router.get(
  '/painel/expedicao',
  asyncHandler(async (req, res) => {
    try {
      const l = await consultarExpedicao(req.query.q);
      return successResponse(res, l, `${l.length} envio(s)`);
    } catch (err) {
      return falhaDryland(res, err);
    }
  }),
);

router.post(
  '/painel/rastreio-correios',
  asyncHandler(async (req, res) => {
    try {
      const j = await rastreioCorreios(req.body?.codigo);
      return successResponse(res, j, 'Rastreio');
    } catch (err) {
      return errorResponse(res, err.message, 400, 'RASTREIO_ERRO');
    }
  }),
);

router.get(
  '/:chave',
  asyncHandler(async (req, res) => {
    const chave = String(req.params.chave);
    try {
      // Expedição Brejinho: card montado do Dryland /brejinho + transação TOTVS
      if (/^BRJ:/i.test(chave)) {
        const { card } = await cardBrejinho(chave);
        const [anexo, fats] = await Promise.all([
          supabase.from('pedidos_venda_anexos').select('*').eq('chave', card.id).maybeSingle(),
          supabase.from('pedidos_venda_faturamentos').select('*').eq('chave', card.id).order('criado_em', { ascending: false }),
        ]);
        return successResponse(
          res,
          { chave: card.id, card, separacao: null, itens: [], anexo: anexo.data || null, faturamentos: fats.data || [] },
          'Pedido do Brejinho',
        );
      }
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
      const [sep, itens, anexo, fats] = await Promise.all([
        ref ? supabase.from('pedidos_venda_dryland').select('*').eq('ref', ref).maybeSingle() : Promise.resolve({ data: null }),
        ref ? supabase.from('pedidos_venda_dryland_itens').select('*').eq('ref', ref).order('descricao') : Promise.resolve({ data: [] }),
        supabase.from('pedidos_venda_anexos').select('*').eq('chave', chave).maybeSingle(),
        supabase.from('pedidos_venda_faturamentos').select('*').eq('chave', chave).order('criado_em', { ascending: false }),
      ]);
      if (!card && !sep.data) return errorResponse(res, 'Pedido não encontrado', 404, 'NOT_FOUND');
      // Peças do pedido = separação do Dryland (tela /separar): as linhas de
      // agora + as que já saíram da tela separadas (72 h). Linha que saiu sem
      // separar foi tirada do pedido e não entra.
      const todosItens = itens.data || [];
      const itensValidos = todosItens.filter(linhaSeparadaVale);
      const incompleta = separacaoIncompleta(sep.data, card?.criado_em);
      return successResponse(
        res,
        {
          chave,
          card: card ? { ...card, comprovantes_url: (card.comprovantes || []).map((p) => ({ path: p, url: COMPROVANTE_URL(p) })) } : null,
          separacao: sep.data
            ? {
                ...sep.data,
                qtd_itens: itensValidos.length || sep.data.qtd_itens,
                qtd_pecas: itensValidos.reduce((s, i) => s + Number(i.qtd || 0), 0) || sep.data.qtd_pecas,
                qtd_separada: itensValidos.reduce((s, i) => s + Math.min(Number(i.separado || 0), Number(i.qtd || 0)), 0) || sep.data.qtd_separada,
              }
            : null,
          itens: itensValidos,
          // separação que o HeadCoach só pegou pela metade: a tela usa as peças do card
          separacaoIncompleta: incompleta,
          itensRemovidos: todosItens.filter((i) => !linhaSeparadaVale(i)),
          anexo: anexo.data || null,
          faturamentos: fats.data || [],
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

// ─── FATURAMENTO (tela /expedicao/faturamento) ──────────────────────────────
const inteiro = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};
const lista = (v) => (Array.isArray(v) ? v : []);

router.post(
  '/:chave/faturamentos',
  asyncHandler(async (req, res) => {
    const chave = String(req.params.chave);
    const b = req.body || {};
    const empresa = inteiro(b.empresa);
    const trx = inteiro(b.transactionCode);
    if (!empresa || !trx) return errorResponse(res, 'empresa e transactionCode são obrigatórios', 400, 'DADOS_INVALIDOS');
    const conferidos = lista(b.conferidos);
    const faltando = lista(b.faltando);
    const sobrando = lista(b.sobrando);
    const soma = (l) => l.reduce((s, i) => s + (Number(i.quantidade) || 0), 0);
    try {
      const { data, error } = await supabase
        .from('pedidos_venda_faturamentos')
        .upsert(
          {
            chave,
            numero_site: b.numeroSite || null,
            empresa,
            transacao_code: trx,
            transacao_date: b.transactionDate ? String(b.transactionDate).slice(0, 10) : null,
            transacao_status: inteiro(b.status) || 1,
            operacao: inteiro(b.operacao),
            cfop: inteiro(b.cfop),
            total: Number(b.total) || 0,
            cliente_code: inteiro(b.clienteCode),
            cliente_nome: b.clienteNome || null,
            vendedor_code: inteiro(b.vendedorCode),
            qtd_pedido: inteiro(b.qtdPedido) || soma(conferidos) + soma(faltando),
            qtd_conferida: soma(conferidos),
            qtd_faltando: soma(faltando),
            qtd_sobrando: soma(sobrando),
            conferidos,
            faltando,
            sobrando,
            criado_por: b.por || null,
            atualizado_em: new Date().toISOString(),
          },
          { onConflict: 'empresa,transacao_code' },
        )
        .select()
        .single();
      if (error) throw error;
      return successResponse(res, data, 'Faturamento registrado');
    } catch (err) {
      return responder(res, err);
    }
  }),
);

router.post(
  '/faturamentos/:id/status',
  asyncHandler(async (req, res) => {
    const st = inteiro(req.body?.status);
    if (!st) return errorResponse(res, 'status obrigatório', 400, 'DADOS_INVALIDOS');
    try {
      const agora = new Date().toISOString();
      const { data, error } = await supabase
        .from('pedidos_venda_faturamentos')
        .update({ transacao_status: st, atualizado_em: agora, ...(st === 4 ? { atendida_em: agora } : {}) })
        .eq('id', inteiro(req.params.id))
        .select()
        .maybeSingle();
      if (error) throw error;
      if (!data) return errorResponse(res, 'Faturamento não encontrado', 404, 'NOT_FOUND');
      return successResponse(res, data, 'Status atualizado');
    } catch (err) {
      return responder(res, err);
    }
  }),
);

export default router;
