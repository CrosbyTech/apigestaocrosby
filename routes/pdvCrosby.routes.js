// ============================================================================
// PDV CROSBY — vendas fechadas no HeadCoach + emissão fiscal direta
// Montado em /api/pdv-crosby
//
//   GET  /config                     configurações fiscais de todas as empresas
//   GET  /config/:empresa            configuração da empresa
//   PUT  /config/:empresa            cria/atualiza (série, ambiente, CSC, ICMS)
//   GET  /status-sefaz?empresa=      consulta status do serviço na SEFAZ
//   POST /vendas                     registra a venda (cliente, itens, pagamentos)
//   GET  /vendas?empresa=&data=      vendas do dia (com a última nota de cada)
//   GET  /vendas/:id                 venda completa
//   POST /vendas/:id/emitir          emite NFC-e/NF-e da venda
//   POST /vendas/:id/cancelar        cancela a venda (sem nota autorizada)
//   GET  /notas/:id                  nota + QR Code (dataURL)
//   GET  /notas/:id/xml              download do XML (procNFe)
//   POST /notas/:id/consultar        consulta situação na SEFAZ
//   POST /notas/:id/cancelar         evento de cancelamento (110111)
//   GET  /produto-fiscal/:code       NCM/CEST/origem do produto (TOTVS)
//   GET  /admin/empresas             empresas do TOTVS + config fiscal + certificado
//   PUT  /config-lote                aplica a mesma configuração a várias empresas
//   GET  /epcs                       movimentação das etiquetas RFID vendidas
// ============================================================================
import express from 'express';
import QRCode from 'qrcode';
import supabase from '../config/supabase.js';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';
import {
  FiscalError,
  buscarConfig,
  buscarEmitente,
  buscarClienteFiscal,
  buscarProdutoFiscal,
  certificadoPara,
  listarBranches,
  montarXml,
  assinarEEnviar,
  consultarChave,
  cancelarNota,
  statusSefaz,
  ICMS_ALIQ_UF,
} from '../services/pdvFiscal.js';

const router = express.Router();

const TIPOS = ['nfce', 'nfe', 'troca'];
const FORMAS = ['dinheiro', 'pix', 'credito', 'debito', 'credito_loja', 'vale_troca'];
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const hojeBrasil = () =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Recife', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

function respostaErroFiscal(res, err) {
  if (err instanceof FiscalError) {
    return errorResponse(res, err.message, 422, err.code, err.details);
  }
  throw err;
}

// Regra histórica das operações do TOTVS, usada como padrão quando a empresa
// ainda não tem operação própria cadastrada em pdv_fiscal_config.
const EMPRESAS_OPERACAO_ESPECIAL = [95, 98];
export function operacoesPadrao(empresa) {
  const esp = EMPRESAS_OPERACAO_ESPECIAL.includes(Number(empresa));
  return {
    nfce: esp ? 545 : 510,
    nfe: esp ? 548 : 521,
    troca: esp ? 555 : 1,
  };
}

function operacaoDa(cfg, empresa, tipoVenda) {
  const padrao = operacoesPadrao(empresa);
  const coluna = { nfce: 'operacao_nfce', nfe: 'operacao_nfe', troca: 'operacao_troca' }[tipoVenda];
  return cfg?.[coluna] ?? padrao[tipoVenda] ?? null;
}

// Grava a movimentação de cada etiqueta RFID da venda. Nunca derruba a venda:
// falha aqui é registrada em log e a venda segue.
async function registrarEpcs({ venda, itens, tipo, nota = null }) {
  const linhas = [];
  for (const item of itens) {
    const epcs = Array.isArray(item.epcs) ? item.epcs : [];
    for (const epc of epcs) {
      const limpo = String(epc || '').trim().toUpperCase();
      if (!limpo) continue;
      linhas.push({
        epc: limpo,
        tipo,
        empresa: venda.empresa,
        venda_id: venda.id,
        item_id: item.id ?? null,
        product_code: item.product_code,
        sku: item.sku || null,
        produto_nome: item.nome || null,
        referencia: item.referencia || null,
        valor_unit: item.valor_unit ?? null,
        cliente_code: venda.cliente_code ?? null,
        cliente_nome: venda.cliente_nome ?? null,
        vendedor_code: venda.vendedor_code ?? null,
        vendedor_nome: venda.vendedor_nome ?? null,
        nota_id: nota?.id ?? null,
        chave_nf: nota?.chave ?? null,
        ocorrido_em: new Date().toISOString(),
      });
    }
  }
  if (linhas.length === 0) return 0;
  const { error } = await supabase
    .from('pdv_epc_movimentos')
    .upsert(linhas, { onConflict: 'epc,venda_id,tipo', ignoreDuplicates: true });
  if (error) {
    console.warn(`⚠️ [PDV Crosby] Movimentação de EPC não gravada (venda ${venda.id}): ${error.message}`);
    return 0;
  }
  console.log(`🏷️ [PDV Crosby] ${linhas.length} EPC(s) registrados como "${tipo}" na venda ${venda.id}`);
  return linhas.length;
}

// As colunas/tabelas da v2 (operações por empresa e movimentação de EPC) só
// existem depois de migrations/pdv_crosby_v2.sql. Enquanto não rodar, avisa.
function erroMigracao(res, error) {
  if (/column .* does not exist|relation .* does not exist/i.test(error?.message || '')) {
    return errorResponse(
      res,
      `Estrutura do banco desatualizada (${error.message}). Rode migrations/pdv_crosby_v2.sql no Supabase.`,
      503,
      'MIGRATION_PENDING',
    );
  }
  return null;
}

function mascarar(cfg) {
  if (!cfg) return cfg;
  const m = (t) => (t ? `••••${String(t).slice(-4)}` : null);
  return { ...cfg, csc_token_hom: m(cfg.csc_token_hom), csc_token_prod: m(cfg.csc_token_prod), csc_token_hom_set: !!cfg.csc_token_hom, csc_token_prod_set: !!cfg.csc_token_prod };
}

// ─── Configuração fiscal ─────────────────────────────────────────────────────
router.get(
  '/config',
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase.from('pdv_fiscal_config').select('*').order('empresa');
    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    return successResponse(res, { items: (data || []).map(mascarar), aliqPorUf: ICMS_ALIQ_UF }, 'Configurações fiscais');
  }),
);

router.get(
  '/config/:empresa',
  asyncHandler(async (req, res) => {
    const empresa = parseInt(req.params.empresa, 10);
    const { data, error } = await supabase.from('pdv_fiscal_config').select('*').eq('empresa', empresa).maybeSingle();
    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    let emitente = null;
    try {
      emitente = await buscarEmitente(empresa);
    } catch (e) {
      emitente = { erro: e.message };
    }
    let certificado = null;
    if (emitente?.cnpj) {
      try {
        const c = certificadoPara(emitente.cnpj);
        certificado = { arquivo: c.arquivo, cnpj: c.cnpj, razaoSocial: c.razaoSocial, validade: c.validade };
      } catch (e) {
        certificado = { erro: e.message };
      }
    }
    return successResponse(
      res,
      { config: mascarar(data), emitente, certificado, aliqPadrao: emitente?.uf ? ICMS_ALIQ_UF[emitente.uf] ?? null : null },
      data ? 'Configuração fiscal' : 'Empresa ainda sem configuração',
    );
  }),
);

router.put(
  '/config/:empresa',
  asyncHandler(async (req, res) => {
    const empresa = parseInt(req.params.empresa, 10);
    if (!empresa) return errorResponse(res, 'Empresa inválida', 400, 'INVALID_EMPRESA');
    const b = req.body || {};
    const patch = { empresa };
    const num = (v) => (v === '' || v == null ? undefined : Number(v));
    if (b.ambiente != null) patch.ambiente = Number(b.ambiente) === 1 ? 1 : 2;
    if (b.ativo != null) patch.ativo = !!b.ativo;
    for (const k of ['serie_nfce', 'serie_nfe', 'prox_num_nfce', 'prox_num_nfe', 'operacao_nfce', 'operacao_nfe', 'operacao_troca']) {
      const v = num(b[k]);
      if (v != null && Number.isInteger(v) && v >= 0) patch[k] = v;
    }
    if (b.aliq_icms !== undefined) patch.aliq_icms = b.aliq_icms === '' || b.aliq_icms == null ? null : Number(b.aliq_icms);
    if (b.info_complementar !== undefined) patch.info_complementar = b.info_complementar || null;
    if (b.empresa_nome !== undefined) patch.empresa_nome = b.empresa_nome || null;
    if (b.cnpj !== undefined) patch.cnpj = String(b.cnpj || '').replace(/\D/g, '') || null;
    for (const k of ['csc_id_hom', 'csc_id_prod']) if (b[k] !== undefined) patch[k] = b[k] ? String(b[k]).trim() : null;
    // tokens: só sobrescreve quando enviado preenchido (a tela recebe mascarado)
    for (const k of ['csc_token_hom', 'csc_token_prod']) if (b[k]) patch[k] = String(b[k]).trim();

    const { data, error } = await supabase.from('pdv_fiscal_config').upsert(patch, { onConflict: 'empresa' }).select().single();
    if (error) return erroMigracao(res, error) || errorResponse(res, error.message, 500, 'DB_ERROR');
    return successResponse(res, mascarar(data), 'Configuração salva');
  }),
);

// Aplica a mesma configuração a várias empresas de uma vez
router.put(
  '/config-lote',
  asyncHandler(async (req, res) => {
    const empresas = (req.body?.empresas || [])
      .map((e) => parseInt(e, 10))
      .filter((e) => Number.isInteger(e) && e > 0);
    if (empresas.length === 0) return errorResponse(res, 'Informe empresas: [..]', 400, 'INVALID_PAYLOAD');
    const b = req.body || {};
    const comum = {};
    if (b.ambiente != null) comum.ambiente = Number(b.ambiente) === 1 ? 1 : 2;
    if (b.ativo != null) comum.ativo = !!b.ativo;
    for (const k of ['serie_nfce', 'serie_nfe', 'operacao_nfce', 'operacao_nfe', 'operacao_troca']) {
      const v = b[k];
      if (v !== undefined && v !== '' && v !== null && Number.isInteger(Number(v))) comum[k] = Number(v);
    }
    if (b.aliq_icms !== undefined && b.aliq_icms !== '') comum.aliq_icms = Number(b.aliq_icms);
    if (b.info_complementar !== undefined) comum.info_complementar = b.info_complementar || null;
    for (const k of ['csc_id_hom', 'csc_id_prod']) if (b[k]) comum[k] = String(b[k]).trim();
    for (const k of ['csc_token_hom', 'csc_token_prod']) if (b[k]) comum[k] = String(b[k]).trim();
    // Operações padrão por empresa quando o lote não define explicitamente
    const usarPadrao = !!b.usarOperacoesPadrao;
    const linhas = empresas.map((empresa) => {
      const base = { empresa, ...comum };
      if (usarPadrao) {
        const p = operacoesPadrao(empresa);
        base.operacao_nfce = comum.operacao_nfce ?? p.nfce;
        base.operacao_nfe = comum.operacao_nfe ?? p.nfe;
        base.operacao_troca = comum.operacao_troca ?? p.troca;
      }
      if (b.nomes && b.nomes[empresa]) base.empresa_nome = b.nomes[empresa];
      return base;
    });
    const { data, error } = await supabase
      .from('pdv_fiscal_config')
      .upsert(linhas, { onConflict: 'empresa' })
      .select();
    if (error) return erroMigracao(res, error) || errorResponse(res, error.message, 500, 'DB_ERROR');
    console.log(`⚙️ [PDV Crosby] Configuração aplicada a ${data.length} empresa(s): ${empresas.join(', ')}`);
    return successResponse(res, { items: (data || []).map(mascarar) }, `Configuração aplicada a ${data.length} empresa(s)`);
  }),
);

// Empresas do TOTVS cruzadas com a configuração fiscal e o certificado
router.get(
  '/admin/empresas',
  asyncHandler(async (req, res) => {
    const [{ data: cfgs, error }, branches] = await Promise.all([
      supabase.from('pdv_fiscal_config').select('*'),
      listarBranches(),
    ]);
    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    const porEmpresa = new Map((cfgs || []).map((c) => [Number(c.empresa), c]));
    const certCache = new Map();
    const certDe = (cnpj) => {
      const raiz = String(cnpj || '').replace(/\D/g, '').slice(0, 8);
      if (!raiz) return null;
      if (certCache.has(raiz)) return certCache.get(raiz);
      let info = null;
      try {
        const c = certificadoPara(cnpj);
        info = {
          arquivo: c.arquivo,
          cnpj: c.cnpj,
          razaoSocial: c.razaoSocial,
          validade: c.validade,
          vencido: new Date(c.validade) < new Date(),
        };
      } catch (e) {
        info = { erro: e.message };
      }
      certCache.set(raiz, info);
      return info;
    };
    const items = branches.map((b) => {
      const cfg = porEmpresa.get(Number(b.code)) || null;
      return {
        empresa: Number(b.code),
        nome: b.fantasyName || b.description || b.branchGroupName || `Empresa ${b.code}`,
        cnpj: b.cnpj || null,
        config: mascarar(cfg),
        certificado: certDe(b.cnpj),
        operacoesPadrao: operacoesPadrao(b.code),
      };
    });
    const configuradas = items.filter((i) => i.config).length;
    return successResponse(
      res,
      {
        items,
        resumo: {
          empresas: items.length,
          configuradas,
          producao: items.filter((i) => i.config?.ambiente === 1).length,
          comCertificado: items.filter((i) => i.certificado && !i.certificado.erro).length,
        },
        aliqPorUf: ICMS_ALIQ_UF,
      },
      `${items.length} empresa(s)`,
    );
  }),
);

router.get(
  '/status-sefaz',
  asyncHandler(async (req, res) => {
    const empresa = parseInt(req.query.empresa, 10);
    const modelo = parseInt(req.query.modelo, 10) || 65;
    if (!empresa) return errorResponse(res, 'Informe ?empresa=', 400, 'MISSING_EMPRESA');
    try {
      const cfg = await buscarConfig(empresa);
      const emit = await buscarEmitente(empresa);
      const cert = certificadoPara(emit.cnpj);
      const st = await statusSefaz({ modelo, emit, cfg, cert });
      return successResponse(res, { ...st, ambiente: cfg.ambiente, uf: emit.uf, certificado: cert.arquivo }, 'Status SEFAZ');
    } catch (err) {
      return respostaErroFiscal(res, err);
    }
  }),
);

router.get(
  '/produto-fiscal/:code',
  asyncHandler(async (req, res) => {
    const branch = parseInt(req.query.branch, 10);
    if (!branch) return errorResponse(res, 'Informe ?branch=', 400, 'MISSING_BRANCH');
    try {
      const p = await buscarProdutoFiscal(req.params.code, branch);
      return successResponse(res, p, 'Dados fiscais do produto');
    } catch (err) {
      return respostaErroFiscal(res, err);
    }
  }),
);

// ─── Vendas ──────────────────────────────────────────────────────────────────
async function carregarVenda(id) {
  const { data: venda, error } = await supabase.from('pdv_vendas').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!venda) return null;
  const [{ data: itens }, { data: pagamentos }, { data: notas }] = await Promise.all([
    supabase.from('pdv_venda_itens').select('*').eq('venda_id', id).order('seq'),
    supabase.from('pdv_venda_pagamentos').select('*').eq('venda_id', id).order('id'),
    supabase
      .from('pdv_notas_fiscais')
      .select('id, venda_id, empresa, modelo, serie, numero, chave, ambiente, status, cstat, xmotivo, protocolo, dh_emissao, dh_autorizacao, qr_code, url_chave, cancel_protocolo, cancel_em, erro, criado_em')
      .eq('venda_id', id)
      .order('id', { ascending: false }),
  ]);
  return { ...venda, itens: itens || [], pagamentos: pagamentos || [], notas: notas || [] };
}

router.post(
  '/vendas',
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const empresa = parseInt(b.empresa, 10);
    const tipoVenda = String(b.tipoVenda || '').toLowerCase();
    if (!empresa || !TIPOS.includes(tipoVenda)) return errorResponse(res, 'empresa e tipoVenda (nfce|nfe|troca) são obrigatórios', 400, 'INVALID_PAYLOAD');
    if (!Array.isArray(b.itens) || b.itens.length === 0) return errorResponse(res, 'Venda sem itens', 400, 'INVALID_PAYLOAD');
    if (!b.vendedor?.code) return errorResponse(res, 'Vendedor obrigatório', 400, 'INVALID_PAYLOAD');
    if (tipoVenda !== 'nfce' && !b.cliente?.code) return errorResponse(res, 'NF-e e TROCA exigem cliente identificado', 400, 'INVALID_PAYLOAD');

    // Itens: totais + dados fiscais do produto (NCM/CEST/origem)
    let subtotal = 0;
    let desconto = 0;
    let qtd = 0;
    const itens = [];
    let seq = 1;
    for (const it of b.itens) {
      const q = Number(it.quantidade);
      const vUn = round2(it.valorUnit);
      const dUn = round2(it.descontoUnit || 0);
      if (!(q > 0) || !(vUn > 0)) return errorResponse(res, `Item ${it.productCode}: quantidade/valor inválidos`, 400, 'INVALID_ITEM');
      let fiscal = { ncm: it.ncm || null, cest: it.cest || null, origem: it.origem || '0', unidade: it.unidade || 'UN', referencia: it.referencia || null, sku: it.sku || null, nome: it.nome };
      try {
        const pf = await buscarProdutoFiscal(it.productCode, empresa);
        fiscal = { ...fiscal, ncm: pf.ncm || fiscal.ncm, cest: pf.cest, origem: pf.origem, unidade: pf.unidade, referencia: fiscal.referencia || pf.referencia, sku: fiscal.sku || pf.sku, nome: fiscal.nome || pf.nome };
      } catch (e) {
        console.warn(`⚠️ [PDV Crosby] Produto ${it.productCode} sem dados fiscais no TOTVS: ${e.message}`);
      }
      const total = round2(q * (vUn - dUn));
      subtotal += round2(q * vUn);
      desconto += round2(q * dUn);
      qtd += q;
      itens.push({
        seq: seq++,
        product_code: Number(it.productCode),
        sku: fiscal.sku,
        nome: String(fiscal.nome || it.nome || `Produto ${it.productCode}`).slice(0, 200),
        referencia: fiscal.referencia,
        ncm: fiscal.ncm,
        cest: fiscal.cest,
        origem: fiscal.origem,
        unidade: fiscal.unidade,
        quantidade: q,
        valor_unit: vUn,
        desconto_unit: dUn,
        total,
        epcs: Array.isArray(it.epcs) ? it.epcs : [],
      });
    }
    const cashbackUsado = round2(b.cashbackUsado || 0);
    const total = round2(subtotal - desconto);

    // Pagamentos
    const pagamentos = [];
    if (tipoVenda === 'troca') {
      pagamentos.push({ forma: 'vale_troca', valor: total, parcelas: 1 });
    } else {
      let soma = 0;
      for (const p of b.pagamentos || []) {
        const forma = String(p.forma || '').toLowerCase();
        const valor = round2(p.valor);
        if (!FORMAS.includes(forma)) return errorResponse(res, `Forma de pagamento inválida: ${p.forma}`, 400, 'INVALID_PAYMENT');
        if (!(valor > 0)) continue;
        if ((forma === 'credito' || forma === 'debito') && !p.nsu && !p.autorizacao) {
          return errorResponse(res, 'Cartão exige NSU e/ou código de autorização', 400, 'CARD_AUTH_REQUIRED');
        }
        pagamentos.push({
          forma,
          valor,
          parcelas: forma === 'credito' ? Math.max(1, parseInt(p.parcelas, 10) || 1) : 1,
          bandeira: p.bandeira || null,
          nsu: p.nsu ? String(p.nsu).trim() : null,
          autorizacao: p.autorizacao ? String(p.autorizacao).trim() : null,
          adquirente_cnpj: p.adquirenteCnpj ? String(p.adquirenteCnpj).replace(/\D/g, '') : null,
          troco: round2(p.troco || 0),
        });
        soma += valor;
      }
      const troco = round2(pagamentos.reduce((s, p) => s + p.troco, 0));
      if (Math.abs(round2(soma - troco) - total) > 0.01) {
        return errorResponse(res, `Pagamentos (R$ ${round2(soma - troco).toFixed(2)}) não fecham com o total da venda (R$ ${total.toFixed(2)})`, 400, 'PAYMENT_MISMATCH');
      }
    }

    // Operação: a enviada pela tela ou, na falta, a cadastrada para a empresa
    let operacao = b.operacao ? parseInt(b.operacao, 10) : null;
    if (!operacao) {
      const { data: cfgOp } = await supabase
        .from('pdv_fiscal_config')
        .select('operacao_nfce, operacao_nfe, operacao_troca')
        .eq('empresa', empresa)
        .maybeSingle();
      operacao = operacaoDa(cfgOp, empresa, tipoVenda);
    }

    const cabecalho = {
      empresa,
      empresa_cnpj: b.empresaCnpj ? String(b.empresaCnpj).replace(/\D/g, '') : null,
      empresa_nome: b.empresaNome || null,
      tipo_venda: tipoVenda,
      operacao,
      cliente_code: b.cliente?.code ? Number(b.cliente.code) : null,
      cliente_nome: b.cliente?.nome || b.cliente?.name || null,
      cliente_cpf_cnpj: b.cliente?.cpfCnpj ? String(b.cliente.cpfCnpj).replace(/\D/g, '') : null,
      vendedor_code: Number(b.vendedor.code),
      vendedor_nome: b.vendedor.nome || b.vendedor.name || null,
      qtd_pecas: qtd,
      subtotal: round2(subtotal),
      desconto: round2(desconto),
      cashback_usado: cashbackUsado,
      total,
      status: 'registrada',
      nf_referenciada: b.nfReferenciada ? String(b.nfReferenciada).replace(/\D/g, '') : null,
      observacao: b.observacao || null,
      criado_por: b.criadoPor || null,
    };
    const { data: venda, error } = await supabase.from('pdv_vendas').insert(cabecalho).select().single();
    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    const { data: itensGravados, error: e1 } = await supabase
      .from('pdv_venda_itens')
      .insert(itens.map((i) => ({ ...i, venda_id: venda.id })))
      .select();
    const { error: e2 } = await supabase.from('pdv_venda_pagamentos').insert(pagamentos.map((p) => ({ ...p, venda_id: venda.id })));
    if (e1 || e2) {
      await supabase.from('pdv_vendas').delete().eq('id', venda.id);
      return errorResponse(res, (e1 || e2).message, 500, 'DB_ERROR');
    }
    // Movimentação das etiquetas: TROCA devolve a peça, os demais dão saída
    await registrarEpcs({
      venda,
      itens: itensGravados || [],
      tipo: tipoVenda === 'troca' ? 'devolucao' : 'venda',
    });
    console.log(`🛍️ [PDV Crosby] Venda ${venda.id} registrada: empresa ${empresa}, ${tipoVenda}, ${qtd} pç, R$ ${total.toFixed(2)}`);
    return successResponse(res, await carregarVenda(venda.id), 'Venda registrada', 201);
  }),
);

router.get(
  '/vendas',
  asyncHandler(async (req, res) => {
    const empresa = parseInt(req.query.empresa, 10) || null;
    // ?data=YYYY-MM-DD (um dia) ou ?de=&ate= (período). Sem nada: hoje.
    const de = String(req.query.de || req.query.data || hojeBrasil()).slice(0, 10);
    const ate = String(req.query.ate || req.query.data || de).slice(0, 10);
    const tipo = String(req.query.tipo || '').toLowerCase();
    const status = String(req.query.status || '').toLowerCase();
    const comDetalhes = req.query.detalhes === '1' || req.query.detalhes === 'true';
    const limite = Math.min(parseInt(req.query.limite, 10) || 500, 2000);

    let q = supabase
      .from('pdv_vendas')
      .select('*')
      .gte('criado_em', `${de}T00:00:00-03:00`)
      .lte('criado_em', `${ate}T23:59:59.999-03:00`)
      .order('id', { ascending: false })
      .limit(limite);
    if (empresa) q = q.eq('empresa', empresa);
    if (TIPOS.includes(tipo)) q = q.eq('tipo_venda', tipo);
    if (status) q = q.eq('status', status);

    const { data: vendas, error } = await q;
    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');

    const ids = (vendas || []).map((v) => v.id);
    let notas = [];
    let itens = [];
    let pagamentos = [];
    let epcs = [];
    if (ids.length) {
      const consultas = [
        supabase
          .from('pdv_notas_fiscais')
          .select('id, venda_id, modelo, serie, numero, chave, status, cstat, xmotivo, protocolo, dh_autorizacao, ambiente')
          .in('venda_id', ids)
          .order('id', { ascending: false }),
        supabase.from('pdv_venda_pagamentos').select('*').in('venda_id', ids),
        supabase.from('pdv_epc_movimentos').select('venda_id, epc, tipo').in('venda_id', ids),
      ];
      if (comDetalhes) consultas.push(supabase.from('pdv_venda_itens').select('*').in('venda_id', ids).order('seq'));
      const r = await Promise.all(consultas);
      notas = r[0].data || [];
      pagamentos = r[1].data || [];
      epcs = r[2].data || [];
      itens = comDetalhes ? r[3].data || [] : [];
    }

    const primeiraNota = new Map();
    for (const n of notas) if (!primeiraNota.has(n.venda_id)) primeiraNota.set(n.venda_id, n);
    const agrupar = (lista) => {
      const m = new Map();
      for (const x of lista) {
        if (!m.has(x.venda_id)) m.set(x.venda_id, []);
        m.get(x.venda_id).push(x);
      }
      return m;
    };
    const pagPorVenda = agrupar(pagamentos);
    const itensPorVenda = agrupar(itens);
    const epcPorVenda = agrupar(epcs);

    const items = (vendas || []).map((v) => ({
      ...v,
      nota: primeiraNota.get(v.id) || null,
      pagamentos: pagPorVenda.get(v.id) || [],
      qtd_epcs: (epcPorVenda.get(v.id) || []).length,
      ...(comDetalhes ? { itens: itensPorVenda.get(v.id) || [] } : {}),
    }));

    // Totais: trocas e canceladas ficam fora do faturamento
    const validas = items.filter((v) => v.status !== 'cancelada' && v.tipo_venda !== 'troca');
    const porForma = {};
    for (const v of validas) {
      for (const p of v.pagamentos) {
        porForma[p.forma] = round2((porForma[p.forma] || 0) + Number(p.valor));
      }
    }
    const trocas = items.filter((v) => v.tipo_venda === 'troca' && v.status !== 'cancelada');
    const totais = {
      vendas: validas.length,
      valor: round2(validas.reduce((s2, v) => s2 + Number(v.total), 0)),
      pecas: validas.reduce((s2, v) => s2 + Number(v.qtd_pecas || 0), 0),
      ticketMedio: validas.length ? round2(validas.reduce((s2, v) => s2 + Number(v.total), 0) / validas.length) : 0,
      descontos: round2(validas.reduce((s2, v) => s2 + Number(v.desconto || 0), 0)),
      cashbackUsado: round2(validas.reduce((s2, v) => s2 + Number(v.cashback_usado || 0), 0)),
      trocas: trocas.length,
      valorTrocas: round2(trocas.reduce((s2, v) => s2 + Number(v.total), 0)),
      canceladas: items.filter((v) => v.status === 'cancelada').length,
      pendentes: items.filter((v) => ['registrada', 'emitindo', 'rejeitada'].includes(v.status)).length,
      autorizadas: items.filter((v) => v.status === 'autorizada').length,
      epcs: epcs.length,
      porForma,
    };
    return successResponse(res, { items, totais, de, ate, empresa }, `${items.length} venda(s)`);
  }),
);

// ─── Movimentação das etiquetas RFID ────────────────────────────────────────
router.get(
  '/epcs',
  asyncHandler(async (req, res) => {
    const empresa = parseInt(req.query.empresa, 10) || null;
    const epc = String(req.query.epc || '').trim().toUpperCase();
    const produto = parseInt(req.query.produto, 10) || null;
    const vendaId = parseInt(req.query.venda, 10) || null;
    const limite = Math.min(parseInt(req.query.limite, 10) || 500, 2000);
    const de = req.query.de ? String(req.query.de).slice(0, 10) : null;
    const ate = req.query.ate ? String(req.query.ate).slice(0, 10) : null;

    let q = supabase
      .from('pdv_epc_movimentos')
      .select('*')
      .order('ocorrido_em', { ascending: false })
      .limit(limite);
    if (empresa) q = q.eq('empresa', empresa);
    if (epc) q = epc.length >= 8 ? q.ilike('epc', `%${epc}%`) : q.eq('epc', epc);
    if (produto) q = q.eq('product_code', produto);
    if (vendaId) q = q.eq('venda_id', vendaId);
    if (de) q = q.gte('ocorrido_em', `${de}T00:00:00-03:00`);
    if (ate) q = q.lte('ocorrido_em', `${ate}T23:59:59.999-03:00`);

    const { data, error } = await q;
    if (error) {
      if (/relation .*pdv_epc_movimentos.* does not exist/i.test(error.message)) {
        return errorResponse(
          res,
          'Tabela pdv_epc_movimentos ainda não existe — rode migrations/pdv_crosby_v2.sql no Supabase',
          503,
          'MIGRATION_PENDING',
        );
      }
      return errorResponse(res, error.message, 500, 'DB_ERROR');
    }
    const items = data || [];
    const resumo = {
      total: items.length,
      vendas: items.filter((i) => i.tipo === 'venda').length,
      devolucoes: items.filter((i) => i.tipo === 'devolucao').length,
      estornos: items.filter((i) => i.tipo === 'estorno').length,
      etiquetas: new Set(items.map((i) => i.epc)).size,
    };
    return successResponse(res, { items, resumo }, `${items.length} movimento(s)`);
  }),
);

router.get(
  '/vendas/:id',
  asyncHandler(async (req, res) => {
    const venda = await carregarVenda(parseInt(req.params.id, 10));
    if (!venda) return errorResponse(res, 'Venda não encontrada', 404, 'NOT_FOUND');
    return successResponse(res, venda, 'Venda');
  }),
);

router.post(
  '/vendas/:id/cancelar',
  asyncHandler(async (req, res) => {
    const venda = await carregarVenda(parseInt(req.params.id, 10));
    if (!venda) return errorResponse(res, 'Venda não encontrada', 404, 'NOT_FOUND');
    if (venda.notas.some((n) => n.status === 'autorizada')) {
      return errorResponse(res, 'Venda com nota autorizada — cancele a nota fiscal primeiro', 409, 'HAS_AUTHORIZED_NF');
    }
    const { error } = await supabase.from('pdv_vendas').update({ status: 'cancelada', observacao: [venda.observacao, req.body?.motivo].filter(Boolean).join(' | ') || null }).eq('id', venda.id);
    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    await registrarEpcs({ venda, itens: venda.itens, tipo: 'estorno' });
    return successResponse(res, await carregarVenda(venda.id), 'Venda cancelada');
  }),
);

// ─── Emissão ─────────────────────────────────────────────────────────────────
const emitindo = new Set(); // trava por venda (evita duplo clique)

router.post(
  '/vendas/:id/emitir',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (emitindo.has(id)) return errorResponse(res, 'Emissão já em andamento para esta venda', 409, 'EMIT_IN_PROGRESS');
    emitindo.add(id);
    try {
      const venda = await carregarVenda(id);
      if (!venda) return errorResponse(res, 'Venda não encontrada', 404, 'NOT_FOUND');
      if (venda.status === 'cancelada') return errorResponse(res, 'Venda cancelada', 409, 'SALE_CANCELED');
      const autorizada = venda.notas.find((n) => n.status === 'autorizada');
      if (autorizada) return successResponse(res, { venda, nota: autorizada, jaAutorizada: true }, 'Nota já autorizada');

      const cfg = await buscarConfig(venda.empresa);
      const emit = await buscarEmitente(venda.empresa);
      const cert = certificadoPara(emit.cnpj);
      const cliente = venda.cliente_code ? await buscarClienteFiscal(venda.cliente_code) : null;
      if (venda.cliente_code && !cliente) throw new FiscalError(`Cliente ${venda.cliente_code} não encontrado no TOTVS`, 'DEST_NOT_FOUND');

      const modelo = venda.tipo_venda === 'nfce' ? 65 : 55;
      const serie = modelo === 65 ? cfg.serie_nfce : cfg.serie_nfe;

      // Reaproveita a numeração de uma tentativa rejeitada/erro da mesma venda
      const reaproveitar = venda.notas.find(
        (n) => (n.status === 'rejeitada' || n.status === 'erro' || n.status === 'gerada') && n.modelo === modelo && n.serie === serie && n.ambiente === cfg.ambiente,
      );
      let numero;
      if (reaproveitar) {
        numero = reaproveitar.numero;
      } else {
        const { data: n, error } = await supabase.rpc('pdv_fiscal_proximo_numero', { p_empresa: venda.empresa, p_modelo: modelo });
        if (error) throw new FiscalError(`Falha ao obter numeração: ${error.message}`, 'NUMBERING_ERROR');
        numero = Number(n);
      }

      await supabase.from('pdv_vendas').update({ status: 'emitindo' }).eq('id', id);

      // Grava a nota ANTES de montar o XML: se a montagem falhar (NCM, endereço,
      // CSC…), a linha fica como "erro" e o mesmo número é reaproveitado depois.
      const base = {
        venda_id: id,
        empresa: venda.empresa,
        cnpj_emitente: emit.cnpj,
        modelo,
        serie,
        numero,
        chave: null,
        ambiente: cfg.ambiente,
        status: 'gerada',
        dh_emissao: null,
        cstat: null,
        xmotivo: null,
        protocolo: null,
        erro: null,
      };
      let notaId = reaproveitar?.id;
      if (notaId) {
        await supabase.from('pdv_notas_fiscais').update(base).eq('id', notaId);
      } else {
        const { data: nova, error } = await supabase.from('pdv_notas_fiscais').insert(base).select('id').single();
        if (error) throw new FiscalError(`Falha ao gravar a nota: ${error.message}`, 'DB_ERROR');
        notaId = nova.id;
      }

      let montado;
      try {
        montado = await montarXml({ venda, itens: venda.itens, pagamentos: venda.pagamentos, cfg, emit, cliente, numero });
      } catch (err) {
        await supabase.from('pdv_notas_fiscais').update({ status: 'erro', erro: err.message }).eq('id', notaId);
        throw err;
      }
      await supabase.from('pdv_notas_fiscais').update({ chave: montado.chave, dh_emissao: montado.dhEmi }).eq('id', notaId);

      let envio;
      try {
        envio = await assinarEEnviar({ xml: montado.xml, modelo, emit, cfg, cert });
      } catch (err) {
        await supabase.from('pdv_notas_fiscais').update({ status: 'erro', erro: err.message, xml_assinado: err.details?.xmlAssinado || null }).eq('id', notaId);
        await supabase.from('pdv_vendas').update({ status: 'rejeitada' }).eq('id', id);
        throw err;
      }

      const patch = {
        status: envio.autorizada ? 'autorizada' : 'rejeitada',
        cstat: envio.cStat,
        xmotivo: envio.xMotivo,
        protocolo: envio.nProt,
        dh_autorizacao: envio.autorizada ? envio.dhRecbto : null,
        xml_assinado: envio.xmlAssinado,
        xml_proc: envio.xmlProc,
        qr_code: envio.qrCode,
        url_chave: envio.urlChave,
        erro: envio.autorizada ? null : `${envio.cStat} - ${envio.xMotivo}`,
      };
      await supabase.from('pdv_notas_fiscais').update(patch).eq('id', notaId);
      await supabase.from('pdv_vendas').update({ status: envio.autorizada ? 'autorizada' : 'rejeitada' }).eq('id', id);
      console.log(
        `${envio.autorizada ? '✅' : '❌'} [PDV Crosby] Venda ${id} → ${modelo === 65 ? 'NFC-e' : 'NF-e'} ${serie}/${numero} ${envio.cStat} ${envio.xMotivo} (amb ${cfg.ambiente})`,
      );
      const { data: nota } = await supabase.from('pdv_notas_fiscais').select('*').eq('id', notaId).single();
      const qrDataUrl = nota?.qr_code ? await QRCode.toDataURL(nota.qr_code, { margin: 1, width: 240 }) : null;
      return successResponse(
        res,
        { venda: await carregarVenda(id), nota: { ...nota, xml_assinado: undefined, qrDataUrl }, emitente: emit },
        envio.autorizada ? 'Nota autorizada' : `Nota rejeitada: ${envio.cStat} ${envio.xMotivo}`,
        envio.autorizada ? 200 : 422,
      );
    } catch (err) {
      if (err instanceof FiscalError) {
        await supabase.from('pdv_vendas').update({ status: 'rejeitada' }).eq('id', id);
        return errorResponse(res, err.message, 422, err.code, err.details && { ...err.details, xmlAssinado: undefined });
      }
      throw err;
    } finally {
      emitindo.delete(id);
    }
  }),
);

// ─── Notas ───────────────────────────────────────────────────────────────────
async function contextoNota(id) {
  const { data: nota, error } = await supabase.from('pdv_notas_fiscais').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!nota) return null;
  const cfg = await buscarConfig(nota.empresa);
  const emit = await buscarEmitente(nota.empresa);
  const cert = certificadoPara(emit.cnpj);
  return { nota, cfg, emit, cert };
}

router.get(
  '/notas/:id',
  asyncHandler(async (req, res) => {
    const { data: nota, error } = await supabase.from('pdv_notas_fiscais').select('*').eq('id', parseInt(req.params.id, 10)).maybeSingle();
    if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
    if (!nota) return errorResponse(res, 'Nota não encontrada', 404, 'NOT_FOUND');
    const venda = await carregarVenda(nota.venda_id);
    let emitente = null;
    try {
      emitente = await buscarEmitente(nota.empresa);
    } catch {
      emitente = null;
    }
    const qrDataUrl = nota.qr_code ? await QRCode.toDataURL(nota.qr_code, { margin: 1, width: 240 }) : null;
    return successResponse(res, { nota: { ...nota, xml_assinado: undefined, xml_proc: undefined, qrDataUrl }, venda, emitente }, 'Nota fiscal');
  }),
);

router.get(
  '/notas/:id/xml',
  asyncHandler(async (req, res) => {
    const { data: nota } = await supabase.from('pdv_notas_fiscais').select('chave, numero, serie, modelo, xml_proc, xml_assinado').eq('id', parseInt(req.params.id, 10)).maybeSingle();
    if (!nota) return errorResponse(res, 'Nota não encontrada', 404, 'NOT_FOUND');
    const xml = nota.xml_proc || nota.xml_assinado;
    if (!xml) return errorResponse(res, 'Nota sem XML gravado', 404, 'NO_XML');
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nota.chave || `nf-${nota.serie}-${nota.numero}`}.xml"`);
    return res.send(xml);
  }),
);

router.post(
  '/notas/:id/consultar',
  asyncHandler(async (req, res) => {
    try {
      const ctx = await contextoNota(parseInt(req.params.id, 10));
      if (!ctx) return errorResponse(res, 'Nota não encontrada', 404, 'NOT_FOUND');
      if (!ctx.nota.chave) return errorResponse(res, 'Nota sem chave', 400, 'NO_KEY');
      const r = await consultarChave({ chave: ctx.nota.chave, modelo: ctx.nota.modelo, emit: ctx.emit, cfg: ctx.cfg, cert: ctx.cert });
      const patch = { cstat: r.cStat, xmotivo: r.xMotivo };
      if (r.cStat === '100' && ctx.nota.status !== 'autorizada') Object.assign(patch, { status: 'autorizada', protocolo: r.nProt });
      if (r.cancelada) patch.status = 'cancelada';
      await supabase.from('pdv_notas_fiscais').update(patch).eq('id', ctx.nota.id);
      return successResponse(res, r, `Situação: ${r.cStat} ${r.xMotivo}`);
    } catch (err) {
      return respostaErroFiscal(res, err);
    }
  }),
);

const cancelando = new Set(); // trava por nota (evita duplo clique)

router.post(
  '/notas/:id/cancelar',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (cancelando.has(id)) {
      return errorResponse(res, 'Cancelamento já em andamento para esta nota', 409, 'CANCEL_IN_PROGRESS');
    }
    cancelando.add(id);
    try {
      const ctx = await contextoNota(id);
      if (!ctx) return errorResponse(res, 'Nota não encontrada', 404, 'NOT_FOUND');
      if (ctx.nota.status === 'cancelada') {
        return successResponse(res, { jaCancelada: true, nProt: ctx.nota.cancel_protocolo }, 'Nota já estava cancelada');
      }
      if (ctx.nota.status !== 'autorizada') {
        return errorResponse(res, 'Só é possível cancelar nota autorizada', 409, 'NOT_AUTHORIZED');
      }

      console.log(
        `🚫 [PDV Crosby] Cancelando ${ctx.nota.modelo === 65 ? 'NFC-e' : 'NF-e'} ${ctx.nota.serie}/${ctx.nota.numero} (chave ${ctx.nota.chave})…`,
      );
      const r = await cancelarNota({
        chave: ctx.nota.chave,
        nProt: ctx.nota.protocolo,
        justificativa: req.body?.justificativa,
        modelo: ctx.nota.modelo,
        emit: ctx.emit,
        cfg: ctx.cfg,
        cert: ctx.cert,
      });

      // 573 = duplicidade de evento: o cancelamento já havia sido registrado.
      // Confirma na SEFAZ antes de marcar, para não mascarar outra rejeição.
      let jaCancelada = false;
      if (!r.ok && r.cStat === '573') {
        const sit = await consultarChave({
          chave: ctx.nota.chave,
          modelo: ctx.nota.modelo,
          emit: ctx.emit,
          cfg: ctx.cfg,
          cert: ctx.cert,
        });
        jaCancelada = sit.cancelada;
      }

      if (r.ok || jaCancelada) {
        await supabase
          .from('pdv_notas_fiscais')
          .update({
            status: 'cancelada',
            cancel_protocolo: r.nProt,
            cancel_justificativa: req.body?.justificativa || null,
            cancel_em: new Date().toISOString(),
            cstat: r.cStat,
            xmotivo: r.xMotivo,
          })
          .eq('id', ctx.nota.id);
        await supabase.from('pdv_vendas').update({ status: 'cancelada' }).eq('id', ctx.nota.venda_id);
        const vendaCancelada = await carregarVenda(ctx.nota.venda_id);
        if (vendaCancelada) {
          await registrarEpcs({ venda: vendaCancelada, itens: vendaCancelada.itens, tipo: 'estorno', nota: ctx.nota });
        }
        console.log(`🚫 [PDV Crosby] Nota ${ctx.nota.chave} cancelada (${r.cStat} ${r.xMotivo})`);
        return successResponse(
          res,
          { cStat: r.cStat, xMotivo: r.xMotivo, nProt: r.nProt, dhRegEvento: r.dhRegEvento, jaCancelada },
          jaCancelada ? 'Nota já constava cancelada na SEFAZ' : 'Nota cancelada na SEFAZ',
        );
      }

      console.warn(`⚠️ [PDV Crosby] SEFAZ recusou o cancelamento: ${r.cStat} ${r.xMotivo}`);
      return errorResponse(
        res,
        `SEFAZ recusou o cancelamento: ${r.cStat} — ${r.xMotivo}`,
        422,
        'CANCEL_REJECTED',
        { cStat: r.cStat, xMotivo: r.xMotivo },
      );
    } catch (err) {
      return respostaErroFiscal(res, err);
    } finally {
      cancelando.delete(id);
    }
  }),
);

// ─── Cupons de troca ─────────────────────────────────────────────────────────
// Toda venda do PDV Crosby gera um cupom (presente): o código leva à transação
// de origem para a troca ser referenciada sem os dados do comprador.
//   POST /cupons-troca              cria (ou devolve o já criado) para a transação
//   GET  /cupons-troca/:codigo      consulta pelo código impresso
//   POST /cupons-troca/:codigo/uso  registra as peças já trocadas
const CUPOM_ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O e 1/I
const novoCodigoCupom = () =>
  Array.from({ length: 8 }, () => CUPOM_ALFABETO[Math.floor(Math.random() * CUPOM_ALFABETO.length)]).join('');
const erroCupom = (res, error) =>
  /pdv_cupons_troca.* does not exist|pdv_cupons_troca.* in the schema cache/i.test(error?.message || '')
    ? errorResponse(res, 'Tabela pdv_cupons_troca não existe — rode migrations/pdv_cupons_troca.sql no Supabase', 503, 'MIGRATION_PENDING')
    : errorResponse(res, error.message, 500, 'DB_ERROR');
const comQr = async (cupom) => ({
  ...cupom,
  qrDataUrl: await QRCode.toDataURL(cupom.codigo, { margin: 1, width: 240 }),
});

router.post(
  '/cupons-troca',
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const empresa = parseInt(b.empresa, 10);
    const transacaoCode = Number(b.transacaoCode);
    const transacaoDate = String(b.transacaoDate || '').slice(0, 10);
    if (!empresa || !transacaoCode || !transacaoDate) {
      return errorResponse(res, 'empresa, transacaoCode e transacaoDate são obrigatórios', 400, 'INVALID_PAYLOAD');
    }
    // uma venda = um cupom: se já existe, devolve o mesmo
    const { data: existente, error: e0 } = await supabase
      .from('pdv_cupons_troca')
      .select('*')
      .eq('empresa', empresa)
      .eq('transacao_code', transacaoCode)
      .maybeSingle();
    if (e0) return erroCupom(res, e0);
    if (existente) return successResponse(res, await comQr(existente), 'Cupom de troca');

    const registro = {
      empresa,
      transacao_code: transacaoCode,
      transacao_date: transacaoDate,
      total: round2(b.total || 0),
      cliente_code: b.clienteCode ? Number(b.clienteCode) : null,
      cliente_nome: b.clienteNome || null,
      vendedor_code: b.vendedorCode ? Number(b.vendedorCode) : null,
      vendedor_nome: b.vendedorNome || null,
      itens: (Array.isArray(b.itens) ? b.itens : []).slice(0, 500).map((i) => ({
        productCode: Number(i.productCode),
        name: String(i.name || '').slice(0, 200),
        quantity: Number(i.quantity) || 0,
      })),
      criado_por: b.por || null,
    };
    for (let tentativa = 0; tentativa < 5; tentativa++) {
      const { data, error } = await supabase
        .from('pdv_cupons_troca')
        .insert({ ...registro, codigo: novoCodigoCupom() })
        .select('*')
        .single();
      if (!error) return successResponse(res, await comQr(data), 'Cupom de troca gerado', 201);
      if (error.code !== '23505') return erroCupom(res, error); // 23505 = código repetido: sorteia outro
    }
    return errorResponse(res, 'Não foi possível gerar um código único para o cupom', 500, 'CODE_COLLISION');
  }),
);

router.get(
  '/cupons-troca/:codigo',
  asyncHandler(async (req, res) => {
    const codigo = String(req.params.codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!codigo) return errorResponse(res, 'Informe o código do cupom', 400, 'INVALID_CODE');
    const { data, error } = await supabase.from('pdv_cupons_troca').select('*').eq('codigo', codigo).maybeSingle();
    if (error) return erroCupom(res, error);
    if (!data) return errorResponse(res, `Cupom ${codigo} não encontrado`, 404, 'NOT_FOUND');
    return successResponse(res, await comQr(data), 'Cupom de troca');
  }),
);

router.post(
  '/cupons-troca/:codigo/uso',
  asyncHandler(async (req, res) => {
    const codigo = String(req.params.codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const b = req.body || {};
    const novos = (Array.isArray(b.itens) ? b.itens : [])
      .map((i) => ({
        productCode: Number(i.productCode),
        quantity: Number(i.quantity) || 0,
        transacao_code: b.transacaoCode ? Number(b.transacaoCode) : null,
        empresa: b.empresa ? Number(b.empresa) : null,
        em: new Date().toISOString(),
        por: b.por || null,
      }))
      .filter((i) => i.productCode && i.quantity > 0);
    if (!novos.length) return errorResponse(res, 'Nenhuma peça informada', 400, 'INVALID_PAYLOAD');
    const { data: cupom, error } = await supabase.from('pdv_cupons_troca').select('id, usos').eq('codigo', codigo).maybeSingle();
    if (error) return erroCupom(res, error);
    if (!cupom) return errorResponse(res, `Cupom ${codigo} não encontrado`, 404, 'NOT_FOUND');
    const { error: e2 } = await supabase
      .from('pdv_cupons_troca')
      .update({ usos: [...(cupom.usos || []), ...novos] })
      .eq('id', cupom.id);
    if (e2) return erroCupom(res, e2);
    return successResponse(res, { codigo, registrados: novos.length }, 'Uso do cupom registrado');
  }),
);

export default router;
