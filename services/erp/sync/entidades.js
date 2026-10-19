// Entidades do sync TOTVS → HeadCoach (cadastros mestres da fase 0).
//
// Cada entidade exporta { nome, descricao, dependeDe?, full(ctx), delta?(ctx) }.
// ctx = { log, cursorDesde, cursorAte, empresasProprias, empresasTodas }
// full/delta devolvem { registros, paginas, totalTotvs? , detalhes? }.
//
// Chaves naturais do TOTVS são mantidas (code, produto_code+empresa...).
import { totvs, paginar, fmtTotvsDate } from '../totvsClient.js';
import { supabase, upsertLote, dedupe, agora, dataOuNull, diaOuNull, digits } from '../db.js';
import { FILIAIS } from '../../../config/sefazFiliais.js';
import { syncIncremental as apIncremental, syncPeriodo as apPeriodo, MARCO_ZERO } from '../contasPagar.js';
import { syncIncremental as arIncremental, syncPeriodo as arPeriodo } from '../contasReceber.js';
import { syncIncremental as trIncremental, syncPeriodo as trPeriodo } from '../vendas.js';
import { syncFull as bonusFull, syncIncremental as bonusIncremental } from '../bonus.js';
import { syncFull as vouchersFull } from '../vouchers.js';

const EXPAND_PESSOA = 'phones,emails,addresses,classifications';

// Empresas para preços/custos/vendedores: ERP_SYNC_EMPRESAS="1,2,5" ou todas as próprias
export function empresasProprias() {
  const env = (process.env.ERP_SYNC_EMPRESAS || '').split(',').map((s) => parseInt(s, 10)).filter(Boolean);
  if (env.length) return env;
  return FILIAIS.map((f) => f.codigo);
}
const listaEnv = (nome, padrao) =>
  (process.env[nome] || padrao || '')
    .split(',')
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isFinite(n));

const primeiro = (arr, pred) => (Array.isArray(arr) ? arr.find(pred) || arr[0] || null : null);
const telefoneDe = (phones, tipo) => {
  if (!Array.isArray(phones) || !phones.length) return null;
  const p = tipo ? phones.find((x) => (x.typeName || '').toUpperCase().includes(tipo)) : null;
  const esc = p || phones.find((x) => x.isDefault) || phones[0];
  return esc ? digits(esc.number) : null;
};
const emailDe = (emails) => {
  const e = primeiro(emails, (x) => x.isDefault);
  return e?.email || null;
};
const enderecoDe = (addresses) => primeiro(addresses, (x) => x.addressTypeCode === 1) || null;

// ─── Empresas ───────────────────────────────────────────────────────────────
export const empresas = {
  nome: 'empresas',
  descricao: 'Empresas/filiais',
  async full(ctx) {
    const rows = [];
    const r = await paginar({
      method: 'get',
      path: '/person/v2/branchesList',
      params: { BranchCodePool: 1 },
      pageSize: 500,
      log: ctx.log,
      onPage: (items) => {
        for (const b of items) {
          const propria = FILIAIS.find((f) => f.codigo === Number(b.code));
          rows.push({
            code: Number(b.code),
            descricao: b.description || null,
            cnpj: digits(b.cnpj),
            person_code: b.personCode ?? null,
            person_name: b.personName || null,
            fantasia: b.fantasyName || null,
            grupo: b.branchGroupName || null,
            propria: !!propria,
            certificado: propria?.cert || null,
            totvs_alterado_em: dataOuNull(b.lastchange || b.maxChangeFilterDate),
            origem: 'totvs',
            dados: b,
            sincronizado_em: agora(),
          });
        }
      },
    });
    // Enriquecer as próprias com IE / endereço (cadastro PJ da filial)
    const codes = rows.filter((x) => x.propria && x.person_code).map((x) => x.person_code);
    for (let i = 0; i < codes.length; i += 50) {
      const lote = codes.slice(i, i + 50);
      const d = await totvs('post', '/person/v2/legal-entities/search', {
        data: { filter: { personCodeList: lote }, expand: 'addresses', page: 1, pageSize: lote.length },
      });
      for (const pj of d?.items || []) {
        const row = rows.find((x) => x.person_code === pj.code);
        if (!row) continue;
        const end = enderecoDe(pj.addresses);
        row.ie = pj.numberStateRegistration || null;
        row.uf = pj.uf || end?.stateAbbreviation || null;
        row.cidade = end?.cityName || null;
        row.cidade_ibge = end?.ibgeCityCode ?? null;
        row.endereco = end;
        row.regime_tributario = pj.typeTaxRegime || null;
      }
    }
    const gravados = await upsertLote('erp_empresas', dedupe(rows, (x) => x.code), 'code');
    return { registros: gravados, paginas: r.paginas, totalTotvs: r.count };
  },
};

// ─── Pessoas (PF / PJ) ──────────────────────────────────────────────────────
export function mapPessoa(p, tipo) {
  const pj = tipo === 'PJ';
  const end = enderecoDe(p.addresses) || primeiro(p.addresses, () => true);
  return {
    code: Number(p.code),
    tipo,
    nome: p.name || null,
    fantasia: p.fantasyName || null,
    cpf_cnpj: digits(pj ? p.cnpj : p.cpf),
    ie: pj ? p.numberStateRegistration || null : null,
    rg: pj ? null : p.rg || null,
    nascimento: diaOuNull(pj ? p.dateFoundation : p.birthDate),
    genero: pj ? null : p.gender || null,
    estado_civil: pj ? null : p.maritalStatus || null,
    email: emailDe(p.emails),
    telefone: telefoneDe(p.phones),
    whatsapp: telefoneDe(p.phones, 'WHATS'),
    cep: end?.cep ? digits(end.cep) : null,
    uf: p.uf || end?.stateAbbreviation || null,
    cidade: end?.cityName || null,
    cidade_ibge: end?.ibgeCityCode ?? null,
    endereco: end,
    enderecos: p.addresses ?? null,
    telefones: p.phones ?? null,
    emails: p.emails ?? null,
    classificacoes: p.classifications ?? null,
    is_cliente: p.isCustomer ?? null,
    is_fornecedor: p.isSupplier ?? null,
    is_representante: p.isRepresentative ?? null,
    is_funcionario: pj ? null : (p.isEmployee ?? null),
    is_transportadora: p.isShippingCompany ?? null,
    inativo: !!p.isInactive,
    status_cliente: p.customerStatus || null,
    empresa_cadastro: p.branchInsertCode ?? null,
    inserido_em: dataOuNull(p.insertDate),
    regime_tributario: pj ? p.typeTaxRegime || null : null,
    cnae: pj ? (p.codeActivityCnae ?? null) : null,
    observacoes: p.observations || null,
    totvs_alterado_em: dataOuNull(p.maxChangeFilterDate),
    origem: 'totvs',
    dados: p,
    sincronizado_em: agora(),
  };
}

function entidadePessoa(tipo, path) {
  const gravar = async (items) => {
    // delta não traz expands quando só mudou o cadastro — merge preserva o que já temos
    const rows = items.map((p) => mapPessoa(p, tipo));
    for (const r of rows) {
      for (const k of ['enderecos', 'telefones', 'emails', 'classificacoes']) if (r[k] === null) delete r[k];
      if (r.enderecos === undefined) {
        for (const k of ['endereco', 'cep', 'cidade', 'cidade_ibge']) if (r[k] == null) delete r[k];
      }
      if (r.telefones === undefined) {
        for (const k of ['telefone', 'whatsapp']) if (r[k] == null) delete r[k];
      }
      if (r.emails === undefined && r.email == null) delete r.email;
    }
    return upsertLote('erp_pessoas', dedupe(rows, (x) => x.code), 'code');
  };
  return {
    nome: tipo === 'PF' ? 'pessoas_pf' : 'pessoas_pj',
    descricao: tipo === 'PF' ? 'Pessoas físicas' : 'Pessoas jurídicas',
    async full(ctx) {
      let gravados = 0;
      const r = await paginar({
        path,
        data: { filter: {}, expand: EXPAND_PESSOA },
        pageSize: 500,
        log: ctx.log,
        isolarRegistroInvalido: true, // há cadastro com data impossível no TOTVS (pessoa 67791)
        onPage: async (items) => {
          gravados += await gravar(items);
        },
      });
      return { registros: gravados, paginas: r.paginas, totalTotvs: r.count, detalhes: r.pulados?.length ? { pulados_no_totvs: r.pulados } : null };
    },
    async delta(ctx) {
      let gravados = 0;
      const r = await paginar({
        path,
        data: {
          filter: {
            change: {
              startDate: fmtTotvsDate(ctx.cursorDesde),
              endDate: fmtTotvsDate(ctx.cursorAte),
              inPerson: true,
              inAddress: true,
              inPhone: true,
              inEmail: true,
              inClassification: true,
              inCustomer: true,
            },
          },
          expand: EXPAND_PESSOA,
        },
        pageSize: 200,
        log: ctx.log,
        isolarRegistroInvalido: true,
        onPage: async (items) => {
          gravados += await gravar(items);
        },
      });
      return { registros: gravados, paginas: r.paginas, totalTotvs: r.count, detalhes: r.pulados?.length ? { pulados_no_totvs: r.pulados } : null };
    },
  };
}
export const pessoas_pf = entidadePessoa('PF', '/person/v2/individuals/search');
export const pessoas_pj = entidadePessoa('PJ', '/person/v2/legal-entities/search');

// ─── Representantes ─────────────────────────────────────────────────────────
export const representantes = {
  nome: 'representantes',
  descricao: 'Representantes comerciais',
  async full(ctx) {
    const rows = [];
    const r = await paginar({
      path: '/person/v2/representatives/search',
      data: { filter: {}, expand: 'phones,emails,addresses,classifications,priceTables' },
      pageSize: 200,
      log: ctx.log,
      onPage: (items) => {
        for (const p of items) {
          rows.push({
            code: Number(p.code),
            nome: p.name || null,
            cpf_cnpj: digits(p.cpfCnpj),
            inativo: !!p.isInactive,
            supervisor_code: p.supervisorCode ?? null,
            supervisor_nome: p.supervisorName || null,
            empresa_cadastro: p.branchInsertCode ?? null,
            telefones: p.phones ?? null,
            emails: p.emails ?? null,
            enderecos: p.addresses ?? null,
            classificacoes: p.classifications ?? null,
            tabelas_preco: p.priceTables ?? null,
            totvs_alterado_em: dataOuNull(p.maxChangeFilterDate),
            origem: 'totvs',
            dados: p,
            sincronizado_em: agora(),
          });
        }
      },
    });
    const gravados = await upsertLote('erp_representantes', dedupe(rows, (x) => x.code), 'code');
    return { registros: gravados, paginas: r.paginas, totalTotvs: r.count };
  },
};

// ─── Vendedores (por empresa própria) ───────────────────────────────────────
export const vendedores = {
  nome: 'vendedores',
  descricao: 'Vendedores por empresa',
  async full(ctx) {
    const mapa = new Map();
    let paginas = 0;
    for (const emp of ctx.empresasProprias) {
      const d = await totvs('post', '/sale-panel/v2/sellers-list/search', { data: { branchs: [emp] } });
      paginas += 1;
      for (const s of d?.dataRow || []) {
        const code = Number(s.seller_code);
        if (!code) continue;
        const cur = mapa.get(code) || { code, nome: s.seller_name || null, empresas: [] };
        if (!cur.empresas.includes(emp)) cur.empresas.push(emp);
        mapa.set(code, cur);
      }
      ctx.log(`  empresa ${emp}: ${d?.dataRow?.length || 0} vendedores`);
    }
    const rows = [...mapa.values()].map((v) => ({ ...v, ativo: true, origem: 'totvs', sincronizado_em: agora() }));
    const gravados = await upsertLote('erp_vendedores', rows, 'code');
    return { registros: gravados, paginas, totalTotvs: rows.length };
  },
};

// ─── Produtos + códigos de barras ───────────────────────────────────────────
const EXPAND_PRODUTO = 'barCodes,classifications,suppliers,referenceCategories';
export function mapProduto(p) {
  return {
    code: Number(p.productCode),
    nome: p.productName || null,
    sku: p.productSku || null,
    referencia_code: p.ReferenceCode || p.referenceCode || null,
    referencia_id: p.referenceId ?? null,
    referencia_nome: p.referenceName || null,
    cor_code: p.colorCode || null,
    cor_nome: p.colorName || null,
    tamanho: p.size || p.sizeName || null,
    grade_code: p.gridCode ?? null,
    ncm: digits(p.ncm),
    cest: p.cest ? digits(p.cest) : null,
    cst_origem: p.cst != null ? String(p.cst) : null,
    unidade: p.measuredUnit || null,
    prefixo_ean: p.prefixEanGtin || null,
    ativo: p.isActive !== false,
    bloqueado: !!p.isBlocked,
    produto_acabado: p.isFinishedProduct ?? null,
    materia_prima: p.isRawMaterial ?? null,
    material_granel: p.isBulkMaterial ?? null,
    producao_propria: p.isOwnProduction ?? null,
    estoque_min: p.minimumStockAmount ?? null,
    estoque_max: p.maximumStockAmount ?? null,
    estoque_ideal: p.idealStockAmount ?? null,
    classificacoes: p.classifications ?? null,
    fornecedores: p.suppliers ?? null,
    categorias: p.referenceCategories ?? null,
    totvs_alterado_em: dataOuNull(p.maxChangeFilterDate),
    origem: 'totvs',
    dados: p,
    sincronizado_em: agora(),
  };
}
export function mapCodigosBarras(p) {
  const out = [];
  const lista = Array.isArray(p.barCodes) ? p.barCodes : [];
  for (const b of lista) {
    const codigo = typeof b === 'string' ? b : b.barCode || b.barcode || b.code || b.ean || null;
    if (!codigo) continue;
    const tipoRaw = typeof b === 'object' ? b.barCodeType || b.type || b.typeName || b.barCodeTypeName || null : null;
    const tipo = tipoRaw != null ? String(tipoRaw) : /^\d{13}$/.test(codigo) ? 'EAN' : codigo.length === 24 ? 'RFID' : null;
    out.push({
      produto_code: Number(p.productCode),
      codigo: String(codigo).trim(),
      tipo,
      principal: !!(typeof b === 'object' && (b.isDefault || b.isMain || b.isPrincipal)),
      origem: 'totvs',
      dados: typeof b === 'object' ? b : null,
    });
  }
  // SKU é o EAN-13 do produto quando preenchido
  if (p.productSku && /^\d{8,14}$/.test(String(p.productSku)) && !out.some((x) => x.codigo === String(p.productSku))) {
    out.push({ produto_code: Number(p.productCode), codigo: String(p.productSku), tipo: 'EAN', principal: true, origem: 'totvs', dados: null });
  }
  return out;
}
async function gravarProdutos(items) {
  const rows = dedupe(items.map(mapProduto), (x) => x.code);
  const n = await upsertLote('erp_produtos', rows, 'code');
  const barras = dedupe(items.flatMap(mapCodigosBarras), (x) => `${x.codigo}|${x.produto_code}`);
  if (barras.length) await upsertLote('erp_codigos_barras', barras, 'codigo,produto_code');
  return n;
}
export const produtos = {
  nome: 'produtos',
  descricao: 'Produtos/SKUs',
  async full(ctx) {
    let gravados = 0;
    const r = await paginar({
      path: '/product/v2/products/search',
      data: { filter: {}, option: { branchInfoCode: 1 }, expand: EXPAND_PRODUTO },
      pageSize: 500,
      log: ctx.log,
      onPage: async (items) => {
        gravados += await gravarProdutos(items);
      },
    });
    return { registros: gravados, paginas: r.paginas, totalTotvs: r.count };
  },
  async delta(ctx) {
    let gravados = 0;
    const r = await paginar({
      path: '/product/v2/products/search',
      data: {
        filter: { change: { startDate: fmtTotvsDate(ctx.cursorDesde), endDate: fmtTotvsDate(ctx.cursorAte), inProduct: true } },
        option: { branchInfoCode: 1 },
        expand: EXPAND_PRODUTO,
      },
      pageSize: 200,
      log: ctx.log,
      onPage: async (items) => {
        gravados += await gravarProdutos(items);
      },
    });
    return { registros: gravados, paginas: r.paginas, totalTotvs: r.count };
  },
};

// ─── Dimensões pequenas de produto ──────────────────────────────────────────
export const cores = {
  nome: 'cores',
  descricao: 'Cores',
  async full(ctx) {
    const rows = [];
    const r = await paginar({
      path: '/product/v2/colors/search',
      data: { filter: {} },
      pageSize: 500,
      log: ctx.log,
      onPage: (items) => {
        for (const c of items) {
          if (!c.colorCode) continue;
          rows.push({ code: String(c.colorCode), nome: c.colorName || null, ativo: c.isActive !== false, dados: c, origem: 'totvs', sincronizado_em: agora() });
        }
      },
    });
    const gravados = await upsertLote('erp_cores', dedupe(rows, (x) => x.code), 'code');
    return { registros: gravados, paginas: r.paginas, totalTotvs: r.count };
  },
};

export const grades = {
  nome: 'grades',
  descricao: 'Grades de tamanho',
  async full(ctx) {
    const rows = [];
    const r = await paginar({
      method: 'get',
      path: '/product/v2/grid',
      pageSize: 1000,
      log: ctx.log,
      onPage: (items) => {
        for (const g of items) rows.push({ code: Number(g.code), nome: g.name || null, tipo: g.type || null, tamanhos: g.grid ?? null, totvs_alterado_em: dataOuNull(g.maxChangeFilterDate), origem: 'totvs', sincronizado_em: agora() });
      },
    });
    const gravados = await upsertLote('erp_grades', dedupe(rows, (x) => x.code), 'code');
    return { registros: gravados, paginas: r.paginas, totalTotvs: r.count };
  },
};

export const unidades = {
  nome: 'unidades',
  descricao: 'Unidades de medida',
  async full(ctx) {
    const rows = [];
    const r = await paginar({
      method: 'get',
      path: '/product/v2/measurement-unit',
      pageSize: 1000,
      log: ctx.log,
      onPage: (items) => {
        for (const u of items) if (u.code != null) rows.push({ code: String(u.code), descricao: u.description || null, origem: 'totvs', sincronizado_em: agora() });
      },
    });
    const gravados = await upsertLote('erp_unidades', dedupe(rows, (x) => x.code), 'code');
    return { registros: gravados, paginas: r.paginas, totalTotvs: r.count };
  },
};

export const classificacoes = {
  nome: 'classificacoes',
  descricao: 'Tipos e classificações de produto',
  async full(ctx) {
    const tipos = [];
    const r1 = await paginar({
      method: 'get',
      path: '/product/v2/classificationType',
      pageSize: 1000,
      log: ctx.log,
      onPage: (items) => {
        for (const t of items) tipos.push({ code: Number(t.code), descricao: t.description || null, descricao_aux: t.auxiliaryDescription || null, is_group: t.isGroup ?? null, origem: 'totvs', sincronizado_em: agora() });
      },
    });
    await upsertLote('erp_classificacao_tipos', dedupe(tipos, (x) => x.code), 'code');
    const rows = [];
    const r2 = await paginar({
      method: 'get',
      path: '/product/v2/classifications',
      pageSize: 1000,
      log: ctx.log,
      onPage: (items) => {
        for (const c of items) {
          if (c.typeCode == null || c.code == null) continue;
          rows.push({ tipo_code: Number(c.typeCode), code: String(c.code), nome: c.name || null, nome_aux: c.nameAux || null, tipo_nome: c.typeName || null, totvs_alterado_em: dataOuNull(c.maxChangeFilterDate), origem: 'totvs', sincronizado_em: agora() });
        }
      },
    });
    const gravados = await upsertLote('erp_classificacoes', dedupe(rows, (x) => `${x.tipo_code}|${x.code}`), 'tipo_code,code');
    // total_totvs compara com erp_classificacoes (os tipos vão para erp_classificacao_tipos)
    return { registros: gravados + tipos.length, paginas: r1.paginas + r2.paginas, totalTotvs: r2.count || 0, detalhes: { tipos: tipos.length } };
  },
};

export const tabelas_preco = {
  nome: 'tabelas_preco',
  descricao: 'Cabeçalhos de tabela de preço',
  async full(ctx) {
    const rows = [];
    const r = await paginar({
      method: 'get',
      path: '/product/v2/price-tables-headers',
      pageSize: 1000,
      log: ctx.log,
      onPage: (items) => {
        for (const t of items) {
          rows.push({
            code: Number(t.code),
            descricao: t.description || null,
            nome: t.codeName || null,
            tipo: t.type || null,
            inicio: diaOuNull(t.startDate),
            fim: diaOuNull(t.endDate),
            variacao_pct: t.variationPercentage ?? null,
            variacao_valor: t.variationValue ?? null,
            classificacoes_pedido: t.salesOrderClassification ?? null,
            classificacoes_pessoa: t.personClassification ?? null,
            condicoes_pagamento: t.paymentConditions ?? null,
            totvs_alterado_em: dataOuNull(t.maxChangeFilterDate),
            origem: 'totvs',
            dados: t,
            sincronizado_em: agora(),
          });
        }
      },
    });
    const gravados = await upsertLote('erp_tabelas_preco', dedupe(rows, (x) => x.code), 'code');
    return { registros: gravados, paginas: r.paginas, totalTotvs: r.count };
  },
};

// ─── Preços e custos por empresa ────────────────────────────────────────────
const PRECO_CODES = () => listaEnv('ERP_SYNC_PRECO_CODES', '1');
const CUSTO_CODES = () => listaEnv('ERP_SYNC_CUSTO_CODES', '1');
const CUSTO_EMPRESAS = () => listaEnv('ERP_SYNC_CUSTO_EMPRESAS', '1');

async function gravarPrecos(items) {
  const rows = [];
  for (const it of items) {
    for (const p of it.prices || []) {
      rows.push({
        produto_code: Number(it.productCode),
        empresa: Number(p.branchCode),
        preco_code: Number(p.priceCode),
        preco_nome: p.priceName || null,
        preco: p.price ?? null,
        preco_promocional: p.promotionalPrice ?? null,
        promocao: p.promotionalInformation ?? null,
        origem: 'totvs',
        atualizado_em: agora(),
      });
    }
  }
  if (!rows.length) return 0;
  return upsertLote('erp_precos', dedupe(rows, (x) => `${x.produto_code}|${x.empresa}|${x.preco_code}`), 'produto_code,empresa,preco_code');
}
export const precos = {
  nome: 'precos',
  descricao: 'Preços por produto/empresa',
  dependeDe: ['produtos'],
  async full(ctx) {
    let gravados = 0;
    let paginas = 0;
    let total = 0;
    for (const emp of ctx.empresasProprias) {
      ctx.log(`  empresa ${emp}`);
      const r = await paginar({
        path: '/product/v2/prices/search',
        data: { filter: { branchInfo: { branchCode: emp, isActive: true } }, option: { prices: [{ branchCode: emp, priceCodeList: PRECO_CODES() }] } },
        pageSize: 1000,
        log: ctx.log,
        onPage: async (items) => {
          gravados += await gravarPrecos(items);
        },
      });
      paginas += r.paginas;
      total += r.count || 0;
    }
    return { registros: gravados, paginas, totalTotvs: total };
  },
  async delta(ctx) {
    let gravados = 0;
    let paginas = 0;
    let total = 0;
    for (const emp of ctx.empresasProprias) {
      const r = await paginar({
        path: '/product/v2/prices/search',
        data: {
          // o TOTVS exige change.priceCodeList junto com branchPriceCodeList
          filter: { change: { startDate: fmtTotvsDate(ctx.cursorDesde), endDate: fmtTotvsDate(ctx.cursorAte), inPrice: true, branchPriceCodeList: [emp], priceCodeList: PRECO_CODES() } },
          option: { prices: [{ branchCode: emp, priceCodeList: PRECO_CODES() }] },
        },
        pageSize: 500,
        log: ctx.log,
        onPage: async (items) => {
          gravados += await gravarPrecos(items);
        },
      });
      paginas += r.paginas;
      total += r.count || 0;
    }
    return { registros: gravados, paginas, totalTotvs: total };
  },
};

export const custos = {
  nome: 'custos',
  descricao: 'Custos por produto/empresa',
  dependeDe: ['produtos'],
  async full(ctx) {
    let gravados = 0;
    let paginas = 0;
    let total = 0;
    for (const emp of CUSTO_EMPRESAS()) {
      ctx.log(`  empresa ${emp}`);
      const r = await paginar({
        path: '/product/v2/costs/search',
        data: { filter: {}, option: { costs: [{ branchCode: emp, costCodeList: CUSTO_CODES() }] } },
        pageSize: 1000,
        log: ctx.log,
        onPage: async (items) => {
          const rows = [];
          for (const it of items) {
            for (const c of it.costs || []) {
              rows.push({ produto_code: Number(it.productCode), empresa: Number(c.branchCode), custo_code: Number(c.costCode), custo_nome: c.costName || null, custo: c.cost ?? null, origem: 'totvs', atualizado_em: agora() });
            }
          }
          if (rows.length) gravados += await upsertLote('erp_custos', dedupe(rows, (x) => `${x.produto_code}|${x.empresa}|${x.custo_code}`), 'produto_code,empresa,custo_code');
        },
      });
      paginas += r.paginas;
      total += r.count || 0;
    }
    return { registros: gravados, paginas, totalTotvs: total };
  },
};

// Preços de tabela: só para as tabelas listadas em ERP_SYNC_TABELAS_PRECO (ex.: "1,19,26")
export const precos_tabela = {
  nome: 'precos_tabela',
  descricao: 'Preços de tabela por produto/empresa',
  dependeDe: ['produtos', 'tabelas_preco'],
  async full(ctx) {
    const tabelas = listaEnv('ERP_SYNC_TABELAS_PRECO', '');
    if (!tabelas.length) {
      ctx.log('  ERP_SYNC_TABELAS_PRECO vazio — nada a sincronizar');
      return { registros: 0, paginas: 0, totalTotvs: 0, detalhes: { pulado: 'ERP_SYNC_TABELAS_PRECO vazio' } };
    }
    let gravados = 0;
    let paginas = 0;
    for (const tab of tabelas) {
      ctx.log(`  tabela ${tab}`);
      const r = await paginar({
        path: '/product/v2/price-tables/search',
        data: { filter: {}, option: { branchCodeList: ctx.empresasProprias, priceTableCode: tab } },
        pageSize: 1000,
        log: ctx.log,
        onPage: async (items) => {
          const rows = [];
          for (const it of items) {
            for (const p of it.prices || []) {
              rows.push({ tabela_code: tab, produto_code: Number(it.productCode), empresa: Number(p.branchCode), preco: p.price ?? null, preco_original: p.originalPrice ?? null, escala: p.scaleCode ?? null, origem: 'totvs', atualizado_em: agora() });
            }
          }
          if (rows.length) gravados += await upsertLote('erp_precos_tabela', dedupe(rows, (x) => `${x.tabela_code}|${x.produto_code}|${x.empresa}`), 'tabela_code,produto_code,empresa');
        },
      });
      paginas += r.paginas;
    }
    return { registros: gravados, paginas, totalTotvs: gravados };
  },
};

// ─── Operações, condições, portadores ───────────────────────────────────────
export const operacoes = {
  nome: 'operacoes',
  descricao: 'Operações (CFOP/natureza)',
  async full(ctx) {
    const rows = [];
    const estoques = new Map();
    const r = await paginar({
      method: 'get',
      path: '/general/v2/operations',
      params: { StartChangeDate: '1900-01-01T00:00:00', EndChangeDate: '2100-01-01T00:00:00', Expand: 'calculations,values,balances,classifications' },
      pageSize: 500,
      log: ctx.log,
      onPage: (items) => {
        for (const o of items) {
          const inv = o.invoiceData || {};
          const saldos = Array.isArray(o.balances) ? o.balances : null;
          for (const s of saldos || []) if (s.code != null) estoques.set(Number(s.code), s.description || null);
          rows.push({
            code: Number(o.operationCode),
            descricao: o.description || null,
            financeira: o.isFinancial ?? null,
            inativa: !!o.isInactive,
            tipo: inv.operationsType || null,
            documento_tipo: inv.documentType ?? null,
            modelo_documento: inv.documentModel ?? null,
            regra_fiscal: inv.taxRuleCode ?? null,
            modo_operacao: inv.operationMode != null ? String(inv.operationMode) : null,
            finalidade_nfe: inv.purposeNFE ?? null,
            indicador_presenca: inv.presenceIndicator ?? null,
            tipo_danfe: inv.danfeType ?? null,
            operacao_vinculada: inv.linkedOperationCode ?? null,
            valores: o.values ?? null,
            saldos,
            calculos: o.calculations ?? null,
            classificacoes: o.classifications ?? null,
            movimenta_estoque: saldos ? saldos.length > 0 : null,
            totvs_alterado_em: dataOuNull(o.maxChangeFilterDate),
            origem: 'totvs',
            dados: o,
            sincronizado_em: agora(),
          });
        }
      },
    });
    const gravados = await upsertLote('erp_operacoes', dedupe(rows, (x) => x.code), 'code');
    if (estoques.size) {
      await upsertLote('erp_estoques', [...estoques].map(([code, descricao]) => ({ code, descricao, origem: 'totvs', sincronizado_em: agora() })), 'code');
    }
    return { registros: gravados, paginas: r.paginas, totalTotvs: r.count, detalhes: { estoques: estoques.size } };
  },
};

export const condicoes_pagamento = {
  nome: 'condicoes_pagamento',
  descricao: 'Condições de pagamento',
  async full() {
    const d = await totvs('get', '/general/v2/payment-conditions');
    const rows = (d?.items || []).map((c) => ({
      code: Number(c.code),
      nome: c.name || null,
      parcelas: c.installment ?? null,
      dias: c.installmentDays ?? null,
      desconto_pct: c.discountPercentage ?? null,
      juros_pct: c.interestPercentage ?? null,
      bloqueada: !!c.isBlocked,
      origem: 'totvs',
      dados: c,
      sincronizado_em: agora(),
    }));
    const gravados = await upsertLote('erp_condicoes_pagamento', dedupe(rows, (x) => x.code), 'code');
    return { registros: gravados, paginas: 1, totalTotvs: d?.count ?? rows.length };
  },
};

export const portadores = {
  nome: 'portadores',
  descricao: 'Portadores',
  async full(ctx) {
    const rows = [];
    const r = await paginar({
      method: 'get',
      path: '/accounts-receivable/v2/bearers',
      pageSize: 1000,
      log: ctx.log,
      onPage: (items) => {
        for (const b of items) rows.push({ code: Number(b.bearerCode), descricao: b.bearerDescription || null, tipo: b.bearertype || b.bearerType || null, totvs_alterado_em: dataOuNull(b.maxChangeFilterDate), origem: 'totvs', sincronizado_em: agora() });
      },
    });
    const gravados = await upsertLote('erp_portadores', dedupe(rows, (x) => x.code), 'code');
    return { registros: gravados, paginas: r.paginas, totalTotvs: r.count };
  },
};

// ─── Itens de despesa + centros de custo (derivados do contas a pagar) ──────
// O TOTVS não tem endpoint de cadastro para eles: varremos as duplicatas das
// empresas próprias e extraímos expense[].{expenseCode, expenseName, costCenterCode}.
export const despesas_centros = {
  nome: 'despesas_centros',
  descricao: 'Itens de despesa e centros de custo',
  async full(ctx) {
    const meses = parseInt(process.env.ERP_SYNC_DESPESAS_MESES || '24', 10);
    const fim = new Date();
    const ini = new Date(fim);
    ini.setMonth(ini.getMonth() - meses);
    return varrerDespesas(ctx, { startIssueDate: fmtTotvsDate(ini), endIssueDate: fmtTotvsDate(fim) });
  },
  async delta(ctx) {
    return varrerDespesas(ctx, { change: { startDate: fmtTotvsDate(ctx.cursorDesde), endDate: fmtTotvsDate(ctx.cursorAte), inDuplicate: true } });
  },
};
async function varrerDespesas(ctx, filtroExtra) {
  const despesas = new Map();
  const centros = new Set();
  const r = await paginar({
    path: '/accounts-payable/v2/duplicates/search',
    data: { filter: { branchCodeList: ctx.empresasTodas.length ? ctx.empresasTodas : ctx.empresasProprias, ...filtroExtra } },
    pageSize: 100,
    log: ctx.log,
    onPage: (items) => {
      for (const d of items) {
        for (const e of d.expense || []) {
          if (e.expenseCode != null) despesas.set(Number(e.expenseCode), e.expenseName || despesas.get(Number(e.expenseCode)) || null);
          if (e.costCenterCode != null) centros.add(Number(e.costCenterCode));
        }
      }
    },
  });
  // Complementa com o que o HeadCoach já conhece (solicitações / liberação)
  try {
    const { data } = await supabase.from('pagamentos_liberacao').select('cd_despesaitem, cd_ccusto').limit(5000);
    for (const row of data || []) {
      const cd = parseInt(row.cd_despesaitem, 10);
      if (Number.isFinite(cd) && !despesas.has(cd)) despesas.set(cd, null);
      const cc = parseInt(row.cd_ccusto, 10);
      if (Number.isFinite(cc)) centros.add(cc);
    }
  } catch {
    /* tabela pode não existir no ambiente */
  }
  const rowsD = [...despesas].map(([code, nome]) => ({ code, nome, origem: 'totvs', sincronizado_em: agora() }));
  const rowsC = [...centros].map((code) => ({ code, origem: 'totvs', sincronizado_em: agora() }));
  // não sobrescrever nome já preenchido no HeadCoach com null
  const gD = rowsD.length ? await upsertLote('erp_despesas_itens', rowsD.filter((x) => x.nome != null), 'code') : 0;
  if (rowsD.some((x) => x.nome == null)) {
    const semNome = rowsD.filter((x) => x.nome == null).map((x) => ({ code: x.code, origem: 'totvs', sincronizado_em: agora() }));
    await upsertLote('erp_despesas_itens', semNome, 'code');
  }
  const gC = rowsC.length ? await upsertLote('erp_centros_custo', rowsC, 'code') : 0;
  return { registros: gD + gC, paginas: r.paginas, totalTotvs: r.count, detalhes: { despesas: despesas.size, centros: centros.size } };
}

// ─── Contas a pagar (accounts-payable/v2) — tabelas no formato da API ─────────
// delta = alterações desde o cursor + janelas móveis de emissão e liquidação
// full  = carga por emissão; sem --desde cobre só a janela a partir do marco 0
export const contas_pagar = {
  nome: 'contas_pagar',
  descricao: 'Contas a pagar — duplicatas (accounts-payable/v2/duplicates)',
  dependeDe: ['empresas'],
  semCompararTotal: true,
  async full(ctx) {
    const padrao = new Date(new Date(MARCO_ZERO).getTime() - 120 * 86400000).toISOString().slice(0, 10);
    return apPeriodo(ctx, { desde: ctx.opcoes?.desde || padrao, ate: ctx.opcoes?.ate || new Date() });
  },
  async delta(ctx) {
    return apIncremental(ctx);
  },
};

// ─── Contas a receber (accounts-receivable/v2) — tabelas no formato da API ────
// delta = alterações desde o cursor (traz inclusões e baixas) + janelas curtas
// full  = carga por emissão; sem --desde cobre só 7 dias antes do marco 0
export const contas_receber = {
  nome: 'contas_receber',
  descricao: 'Contas a receber — títulos (accounts-receivable/v2/documents)',
  semCompararTotal: true,
  async full(ctx) {
    const padrao = new Date(new Date(MARCO_ZERO).getTime() - 7 * 86400000).toISOString().slice(0, 10);
    return arPeriodo(ctx, { desde: ctx.opcoes?.desde || padrao, ate: ctx.opcoes?.ate || new Date() });
  },
  async delta(ctx) {
    return arIncremental(ctx);
  },
};

// ─── Vendas (fase 1) — tabelas no formato da API ────────────────────────────
// transações: todas as 290 empresas e todas as operações; delta por data de alteração
export const transacoes = {
  nome: 'transacoes',
  descricao: 'Transações — todas as empresas e operações (general/v2/transactions)',
  dependeDe: ['empresas'],
  semCompararTotal: true,
  async full(ctx) {
    return trPeriodo(ctx, { desde: ctx.opcoes?.desde || MARCO_ZERO.slice(0, 10), ate: ctx.opcoes?.ate || new Date() });
  },
  async delta(ctx) {
    return trIncremental(ctx);
  },
};

// saldo de bônus/cashback: full = saldo atual de quem comprou (retomável); delta = quem movimentou
export const bonus_saldo = {
  nome: 'bonus_saldo',
  descricao: 'Saldo de bônus/cashback por CPF (person/v2/list-balance-bonus)',
  dependeDe: ['empresas', 'transacoes'],
  semCompararTotal: true,
  async full(ctx) {
    return bonusFull(ctx);
  },
  async delta(ctx) {
    return bonusIncremental(ctx);
  },
};

// vouchers: a API não filtra por alteração — sempre a lista inteira
export const vouchers = {
  nome: 'vouchers',
  descricao: 'Vouchers (voucher/v2/search)',
  async full(ctx) {
    return vouchersFull(ctx);
  },
};

// Ordem de execução do "full" (dependências primeiro, o mais pesado por último)
export const ORDEM = [
  'empresas',
  'cores',
  'grades',
  'unidades',
  'classificacoes',
  'tabelas_preco',
  'operacoes',
  'condicoes_pagamento',
  'portadores',
  'representantes',
  'vendedores',
  'contas_pagar',
  'contas_receber',
  'transacoes',
  'bonus_saldo',
  'vouchers',
  'despesas_centros',
  'pessoas_pj',
  'produtos',
  'precos',
  'custos',
  'precos_tabela',
  'pessoas_pf',
];

export const ENTIDADES = {
  empresas,
  pessoas_pf,
  pessoas_pj,
  representantes,
  vendedores,
  produtos,
  cores,
  grades,
  unidades,
  classificacoes,
  tabelas_preco,
  precos,
  custos,
  precos_tabela,
  operacoes,
  condicoes_pagamento,
  portadores,
  despesas_centros,
  contas_pagar,
  contas_receber,
  transacoes,
  bonus_saldo,
  vouchers,
};
