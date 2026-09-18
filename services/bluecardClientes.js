/**
 * Dados do cliente para o app BlueCard — cadastro + ESTATÍSTICAS de compra.
 *
 * Fontes no TOTVS (as mesmas que o HeadCoach já usa):
 *   POST /person/v2/individuals/search      (PF, por CPF)
 *   POST /person/v2/legal-entities/search   (PJ, por CNPJ)
 *   GET  /person/v2/person-statistics       (estatísticas agregadas)
 *
 * ── POR QUE DUAS CHAMADAS ──
 * O `expand: 'statistics'` das rotas de busca NÃO traz histórico de compra:
 * ele devolve só o registro de limite por filial (e vem vazio para quem não
 * tem limite gravado). Quanto comprou, ticket médio, atraso, parcelas em
 * aberto — tudo isso mora no `person-statistics`, agregado pelas filiais
 * pedidas. Então: a busca resolve QUEM é (código, cadastro, limite) e o
 * person-statistics diz QUANTO comprou.
 *
 * Filiais consideradas: as do Ranking de Faturamento tipo FILIAL (as mesmas
 * do gatilho de limite) — o crediário é varejo próprio, franquia não entra.
 *
 * Cache em memória de 15 min por documento: a tela de análise do app abre e
 * reabre o mesmo cliente, e estatística de compra não muda de minuto em
 * minuto. `?refresh=1` fura o cache.
 */
import axios from 'axios';
import { getToken } from '../utils/totvsTokenManager.js';
import { TOTVS_BASE_URL } from '../totvsrouter/totvsHelper.js';
import { postTotvs, listarBranchesLimite } from './bluecardLimite.js';

const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map(); // doc → { at, dados }

const reais = (v) => (v == null ? null : Math.round(Number(v) * 100));
const data = (v) => (v ? String(v).slice(0, 10) : null);
const so = (s) => String(s || '').replace(/\D/g, '');

async function getTotvsStats(customerCode, branchCodes) {
  const qs = [`CustomerCode=${Number(customerCode)}`, ...branchCodes.map((b) => `BranchCode=${Number(b)}`)].join('&');
  const chamar = async (force) => {
    const tk = await getToken(force);
    if (!tk?.access_token) throw new Error('token TOTVS indisponível');
    return axios.get(`${TOTVS_BASE_URL}/person/v2/person-statistics?${qs}`, {
      headers: { Authorization: `Bearer ${tk.access_token}`, Accept: 'application/json' },
      timeout: 60000,
    });
  };
  try {
    return (await chamar(false)).data || {};
  } catch (e) {
    if (e.response?.status === 401) return (await chamar(true)).data || {};
    throw e;
  }
}

function mapearCadastro(p, tipo) {
  const fone = (p.phones || []).find((f) => f.isDefault) || (p.phones || [])[0] || null;
  const mail = (p.emails || []).find((m) => m.isDefault) || (p.emails || [])[0] || null;
  const end = (p.addresses || [])[0] || null;
  return {
    tipo, // 'pf' | 'pj'
    codigo_totvs: p.code,
    documento: tipo === 'pf' ? so(p.cpf) : so(p.cnpj),
    nome: p.name || null,
    nome_fantasia: tipo === 'pj' ? p.fantasyName || null : null,
    ativo: p.isInactive === false,
    situacao_cliente: p.customerStatus || null,
    cadastrado_em: data(p.insertDate),
    filial_cadastro: p.branchInsertCode ?? null,
    // Só PF — o que pesa em análise de crédito. RG, CTPS e filiação ficam de
    // fora de propósito: o app não precisa e não deve carregar isso.
    nascimento: tipo === 'pf' ? data(p.birthDate) : null,
    genero: tipo === 'pf' ? p.gender || null : null,
    estado_civil: tipo === 'pf' ? p.maritalStatus || null : null,
    ocupacao: tipo === 'pf' ? p.occupation || null : null,
    local_trabalho: tipo === 'pf' ? p.workPlace || null : null,
    admissao: tipo === 'pf' ? data(p.hireDate) : null,
    renda_mensal_cents: tipo === 'pf' ? reais(p.monthlyIncome) : null,
    telefone: fone ? { tipo: fone.typeName || null, numero: so(fone.number) } : null,
    telefones: (p.phones || []).map((f) => ({
      tipo: f.typeName || null,
      numero: so(f.number),
      principal: !!f.isDefault,
    })),
    email: mail?.email || null,
    endereco: end
      ? {
          logradouro: [end.publicPlace, end.address].filter(Boolean).join(' ') || null,
          numero: end.addressNumber || null,
          complemento: end.complement || null,
          bairro: end.neighborhood || null,
          cidade: end.cityName || null,
          uf: end.stateAbbreviation || null,
          cep: so(end.cep) || null,
        }
      : null,
    classificacoes: (p.classifications || []).map((c) => ({
      tipo: c.typeName || null,
      valor: c.name || null,
    })),
  };
}

function mapearEstatisticas(s) {
  return {
    // Compras
    qtd_compras: s.purchaseQuantity ?? 0,
    qtd_pecas: s.purchasePiecesQuantity ?? 0,
    total_comprado_cents: reais(s.totalPurchaseValue) ?? 0,
    ticket_medio_cents: reais(s.averagePurchaseValue) ?? 0,
    primeira_compra: { data: data(s.firstPurchaseDate), valor_cents: reais(s.firstPurchaseValue) },
    ultima_compra: { data: data(s.lastPurchaseDate), valor_cents: reais(s.lastPurchaseValue) },
    maior_compra: { data: data(s.biggestPurchaseDate), valor_cents: reais(s.biggestPurchaseValue) },
    // Comportamento de pagamento
    atraso_medio_dias: s.averageDelay ?? 0,
    atraso_maximo_dias: s.maximumDelay ?? 0,
    parcelas_pagas: {
      qtd: s.quantityInstallmentsPaid ?? 0,
      total_cents: reais(s.totalInstallmentsPaid) ?? 0,
      media_cents: reais(s.averageValueInstallmentsPaid) ?? 0,
    },
    parcelas_em_atraso: {
      qtd: s.quantityInstallmentsDelayed ?? 0,
      total_cents: reais(s.totalInstallmentsDelayed) ?? 0,
      atraso_medio_dias: s.averageInstallmentDelay ?? 0,
    },
    parcelas_em_aberto: {
      qtd: s.quantityInstallmentsOpen ?? 0,
      total_cents: reais(s.totalInstallmentsOpen) ?? 0,
      media_cents: reais(s.averageInstallmentsOpen) ?? 0,
    },
    ultimo_pagamento: { data: data(s.lastInvoicePaidDate), valor_cents: reais(s.lastInvoicePaidValue) },
    maior_divida: { data: data(s.highestDebtDate), valor_cents: reais(s.highestDebtValue ?? s.highestDebt) },
    ultimo_aviso_debito: data(s.lastDebtNoticeDate),
  };
}

/**
 * Consulta um cliente por CPF (11 dígitos) ou CNPJ (14).
 * Retorna null se não existir no TOTVS. Lança em falha de comunicação.
 */
export async function consultarClienteBluecard(documento, { refresh = false } = {}) {
  const doc = so(documento);
  if (doc.length !== 11 && doc.length !== 14) {
    const e = new Error('documento deve ter 11 (CPF) ou 14 (CNPJ) dígitos');
    e.codigo = 'campo_invalido';
    throw e;
  }
  const tipo = doc.length === 11 ? 'pf' : 'pj';

  const emCache = cache.get(doc);
  if (!refresh && emCache && Date.now() - emCache.at < CACHE_TTL_MS) {
    return { ...emCache.dados, cache: { origem: 'memoria', atualizado_em: new Date(emCache.at).toISOString() } };
  }

  const branches = (await listarBranchesLimite()).map(Number);

  const resp = await postTotvs(
    tipo === 'pf' ? '/person/v2/individuals/search' : '/person/v2/legal-entities/search',
    {
      filter: tipo === 'pf' ? { cpfList: [doc] } : { cnpjList: [doc] },
      option: { branchStaticDataList: branches },
      expand: 'phones,emails,addresses,classifications,statistics',
      page: 1,
      pageSize: 1,
    },
  );
  const pessoa = resp.data?.items?.[0];
  if (!pessoa) return null;

  const stats = await getTotvsStats(pessoa.code, branches);

  // `statistics` da busca = registro de limite por filial (só o financeiro é
  // legível; o comercial não aparece em consulta nenhuma do TOTVS).
  const limites = (pessoa.statistics || [])
    .filter((st) => Number(st.limitValue || 0) > 0)
    .map((st) => ({ filial: st.branchCode, limite_cents: reais(st.limitValue) }));

  const dados = {
    cliente: mapearCadastro(pessoa, tipo),
    estatisticas: mapearEstatisticas(stats),
    limite_totvs: {
      // No gatilho do crediário o cliente vive com limite 0 e só sobe na hora
      // da compra aprovada — então vazio aqui é o normal, não é erro.
      por_filial: limites,
      maior_cents: limites.reduce((m, l) => Math.max(m, l.limite_cents || 0), 0),
    },
    filiais_consideradas: branches.length,
  };

  cache.set(doc, { at: Date.now(), dados });
  return { ...dados, cache: { origem: 'totvs', atualizado_em: new Date().toISOString() } };
}

/**
 * Lote: vários documentos de uma vez (máx. 50), 4 em paralelo para não
 * martelar o TOTVS. Nunca lança por um documento: cada item traz seu status.
 */
export async function consultarClientesBluecardLote(documentos, opts = {}) {
  const docs = [...new Set((documentos || []).map(so).filter(Boolean))].slice(0, 50);
  const saida = [];
  const CONC = 4;
  for (let i = 0; i < docs.length; i += CONC) {
    const bloco = docs.slice(i, i + CONC);
    const r = await Promise.all(
      bloco.map(async (doc) => {
        try {
          const dados = await consultarClienteBluecard(doc, opts);
          return dados
            ? { documento: doc, encontrado: true, ...dados }
            : { documento: doc, encontrado: false };
        } catch (e) {
          return { documento: doc, encontrado: false, erro: e.codigo || 'erro_totvs', mensagem: e.message };
        }
      }),
    );
    saida.push(...r);
  }
  return saida;
}
