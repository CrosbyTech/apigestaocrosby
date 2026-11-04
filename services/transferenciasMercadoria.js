// ============================================================================
// TRANSFERÊNCIAS DE MERCADORIA ENTRE EMPRESAS (página /transferencias-mercadoria)
//
// Regra do POP "Transferências de mercadorias entre empresas - Varejo"
// (Niziany, v02 de 15/07/2026): compara a RAIZ do CNPJ (8 primeiros dígitos)
// da empresa de origem com a da empresa de destino.
//   • mesmo grupo (17.177.680 → 17.177.680 ou 27.728.810 → 27.728.810) → 7272
//   • Crosby 17.177.680 → Fábio 27.728.810                              → 7273
//   • qualquer movimentação com 33.592.092 ou 53.661.116 (Irmãos)       → 7280
//   • o resto (ex.: Fábio → Crosby, CNPJ fora do POP) NÃO pode ser emitido
//     ("não prossiga sem validar com o setor responsável").
// O "cliente" da transação é a pessoa da filial de destino (branchesList:
// empresa 1 → pessoa 110000001), então origem e destino são sempre filiais.
// Tabelas: transferencias_mercadoria e transferencias_transacoes
// (migrations/transferencias_mercadoria.sql).
// ============================================================================
import axios from 'axios';
import supabase from '../config/supabase.js';
import { getToken } from '../utils/totvsTokenManager.js';
import { httpsAgent, httpAgent, TOTVS_BASE_URL } from '../totvsrouter/totvsHelper.js';

export class TransferenciaError extends Error {
  constructor(message, code = 'TRANSFERENCIA_ERROR', status = 400, details = null) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const STATUS = ['aguardando_transferencia', 'em_transferencia', 'concluida', 'cancelada'];
export const LOCAIS = ['origem', 'em_transito', 'destino'];

const INTERNAL_API_BASE =
  process.env.API_BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 4100}`;

// ─── Regra do POP ────────────────────────────────────────────────────────────
export const GRUPOS_POP = {
  17177680: 'CROSBY',
  27728810: 'FÁBIO',
  33592092: 'IRMÃOS CR',
  53661116: 'IRMÃOS VAREJO',
};
const RAIZ_CROSBY = '17177680';
const RAIZ_FABIO = '27728810';
const RAIZES_IRMAOS = ['33592092', '53661116'];

export const OPERACOES_POP = {
  7272: 'TRANSFERÊNCIA PARA BLUE HOUSE FISCAL CR X CR',
  7273: 'VENDA PARA BLUE HOUSE FISCAL FABIO X CR',
  7280: 'VENDA PARA BLUE HOUSE FISCAL CR X IRMÃOS',
};

export const raizCnpj = (cnpj) => String(cnpj || '').replace(/\D/g, '').padStart(14, '0').slice(0, 8);

// Operação do POP para origem × destino (CNPJs completos ou raízes)
export function operacaoPop(cnpjOrigem, cnpjDestino) {
  const o = raizCnpj(cnpjOrigem);
  const d = raizCnpj(cnpjDestino);
  if (!GRUPOS_POP[o] || !GRUPOS_POP[d]) {
    return { permitido: false, operacao: null, motivo: 'CNPJ não contemplado no POP — não prossiga sem validar com o setor responsável' };
  }
  const base = { grupoOrigem: GRUPOS_POP[o], grupoDestino: GRUPOS_POP[d] };
  if (RAIZES_IRMAOS.includes(o) || RAIZES_IRMAOS.includes(d)) {
    return { ...base, permitido: true, operacao: 7280, descricao: OPERACOES_POP[7280], aplicacao: 'Irmãos CR / Flávio' };
  }
  if (o === d) {
    return { ...base, permitido: true, operacao: 7272, descricao: OPERACOES_POP[7272], aplicacao: `Mesmo grupo ${GRUPOS_POP[o]}` };
  }
  if (o === RAIZ_CROSBY && d === RAIZ_FABIO) {
    return { ...base, permitido: true, operacao: 7273, descricao: OPERACOES_POP[7273], aplicacao: 'Crosby para Fábio' };
  }
  return {
    ...base,
    permitido: false,
    operacao: null,
    motivo: `O POP não prevê transferência do grupo ${GRUPOS_POP[o]} para o grupo ${GRUPOS_POP[d]} — valide com o setor responsável`,
  };
}

// CFOP pela natureza da operação e pela UF: transferência (7272) 5152/6152;
// venda entre grupos (7273/7280) 5102/6102 — 5xxx no mesmo estado, 6xxx fora.
export function cfopPop(operacao, ufOrigem, ufDestino) {
  const fora = ufOrigem && ufDestino && ufOrigem !== ufDestino;
  const final = Number(operacao) === 7272 ? 152 : 102;
  return (fora ? 6000 : 5000) + final;
}

// ─── Filiais dos grupos do POP (branchesList, com UF) ────────────────────────
let cacheFiliais = null;
let cacheFiliaisEm = 0;

const enderecoPrincipal = (addresses) =>
  (addresses || []).find((a) => a.addressTypeCode === 1 && a.stateAbbreviation) ||
  (addresses || []).find((a) => a.stateAbbreviation) ||
  null;

export async function listarFiliaisPop({ fresco = false } = {}) {
  if (!fresco && cacheFiliais && Date.now() - cacheFiliaisEm < 30 * 60 * 1000) return cacheFiliais;
  const tokenData = await getToken();
  const token = tokenData?.access_token;
  if (!token) throw new TransferenciaError('Não foi possível obter token do TOTVS', 'TOKEN_UNAVAILABLE', 503);
  const resp = await axios.get(`${TOTVS_BASE_URL}/person/v2/branchesList`, {
    params: { BranchCodePool: 1, Page: 1, PageSize: 1000 },
    headers: { Authorization: `Bearer ${token}` },
    httpsAgent,
    httpAgent,
    timeout: 60000,
  });
  const filiais = (resp.data?.items || []).filter((b) => GRUPOS_POP[raizCnpj(b.cnpj)] && Number(b.code) < 6000);
  // o branchesList não traz endereço: UF/cidade vêm da pessoa jurídica da filial
  const enderecos = new Map();
  try {
    const pj = await axios.post(
      `${TOTVS_BASE_URL}/person/v2/legal-entities/search`,
      { filter: { personCodeList: filiais.map((b) => Number(b.personCode)) }, expand: 'addresses', page: 1, pageSize: 100 },
      { headers: { Authorization: `Bearer ${token}` }, httpsAgent, httpAgent, timeout: 60000 },
    );
    for (const p of pj.data?.items || []) enderecos.set(Number(p.code), enderecoPrincipal(p.addresses));
  } catch (err) {
    console.log(`⚠️ [Transferências] UF das filiais indisponível: ${err.message}`);
  }
  cacheFiliais = filiais
    .map((b) => {
      const raiz = raizCnpj(b.cnpj);
      const end = enderecos.get(Number(b.personCode)) || null;
      return {
        code: Number(b.code),
        personCode: Number(b.personCode),
        nome: b.fantasyName || b.description || `Empresa ${b.code}`,
        razao: b.personName || b.description || null,
        cnpj: String(b.cnpj || '').replace(/\D/g, '') || null,
        raiz,
        grupo: GRUPOS_POP[raiz] || null,
        uf: end?.stateAbbreviation || null,
        cidade: end?.cityName || null,
      };
    })
    .filter((b) => b.grupo)
    .sort((a, b) => a.code - b.code);
  cacheFiliaisEm = Date.now();
  return cacheFiliais;
}

// Confere origem (empresa) × destino (cliente = pessoa da filial) pelo POP
export async function validarPar(empresaOrigem, clienteCode) {
  const filiais = await listarFiliaisPop();
  const origem = filiais.find((f) => f.code === Number(empresaOrigem));
  if (!origem) {
    throw new TransferenciaError(`Empresa ${empresaOrigem} não está nos grupos do POP de transferência`, 'ORIGEM_FORA_DO_POP');
  }
  const destino = filiais.find((f) => f.personCode === Number(clienteCode));
  if (!destino) {
    throw new TransferenciaError(`O cliente ${clienteCode} não é uma filial dos grupos do POP`, 'DESTINO_FORA_DO_POP');
  }
  if (destino.code === origem.code) {
    throw new TransferenciaError('A empresa de destino é a própria origem', 'MESMA_EMPRESA');
  }
  const regra = operacaoPop(origem.cnpj, destino.cnpj);
  if (!regra.permitido) throw new TransferenciaError(regra.motivo, 'FORA_DO_POP', 422, { origem, destino });
  return { origem, destino, ...regra, cfop: cfopPop(regra.operacao, origem.uf, destino.uf) };
}

// Gera a transação no TOTVS só se origem, destino, operação e CFOP baterem
// com o POP (o front não consegue emitir uma operação diferente da regra).
export async function gerarTransacaoTotvs(payload = {}) {
  const par = await validarPar(payload.branchCode, payload.customerCode);
  if (Number(payload.operationCode) !== par.operacao) {
    throw new TransferenciaError(
      `Pelo POP, ${par.origem.code} → ${par.destino.code} é a operação ${par.operacao}, não ${payload.operationCode}`,
      'OPERACAO_FORA_DO_POP',
      422,
    );
  }
  const itens = Array.isArray(payload.items) ? payload.items : [];
  if (!itens.length) throw new TransferenciaError('Nenhum produto na transferência', 'SEM_ITENS');
  const corpo = { ...payload, items: itens.map((i) => ({ ...i, cfop: par.cfop })) };
  const r = await fetch(`${INTERNAL_API_BASE}/api/totvs/pdv/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.success) {
    throw new TransferenciaError(j?.message || `TOTVS recusou a transferência (HTTP ${r.status})`, j?.error || 'TOTVS_ERROR', r.status >= 400 ? r.status : 502, j?.details);
  }
  return { ...j.data, operacao: par.operacao, cfop: par.cfop, origem: par.origem, destino: par.destino };
}

// ─── Solicitação ↔ transação ─────────────────────────────────────────────────
export async function vincularTransacao(id, b = {}, por = null) {
  const status = Number(b.status) || 1;
  const patch = {
    transacao_code: b.transactionCode ?? null,
    transacao_branch: b.branchCode ?? null,
    transacao_date: b.transactionDate ? String(b.transactionDate).slice(0, 10) : null,
    transacao_status: status,
    transacao_total: b.total ?? null,
    transacao_operacao: b.operacao ?? null,
    transacao_qtd_epcs: b.qtdEpcs ?? null,
    transacao_por: por,
    status: status === 4 ? 'concluida' : status === 6 ? 'aguardando_transferencia' : 'em_transferencia',
    ...(status === 4 ? { transacao_atendida_em: new Date().toISOString(), local: 'destino' } : {}),
    ...(status === 1 ? { local: 'em_transito' } : {}),
  };
  const { data, error } = await supabase.from('transferencias_mercadoria').update(patch).eq('id', id).select().maybeSingle();
  if (error) throw error;
  if (!data) throw new TransferenciaError('Solicitação não encontrada', 'NOT_FOUND', 404);
  return data;
}

export async function registrarTransacao(b = {}) {
  const itens = Array.isArray(b.itens) ? b.itens : [];
  const linha = {
    transferencia_id: b.transferenciaId || null,
    empresa: Number(b.empresa),
    empresa_destino: Number(b.empresaDestino),
    transacao_code: Number(b.transactionCode),
    transacao_date: b.transactionDate ? String(b.transactionDate).slice(0, 10) : null,
    transacao_status: Number(b.status) || 1,
    operacao: b.operacao ?? null,
    cfop: b.cfop ?? null,
    total: Number(b.total) || 0,
    qtd_pecas: itens.reduce((s, i) => s + Number(i.quantidade || 0), 0),
    qtd_epcs: itens.reduce((s, i) => s + (i.epcs || []).length, 0),
    cliente_code: b.clienteCode ?? null,
    cliente_nome: b.clienteNome ?? null,
    vendedor_code: b.vendedorCode ?? null,
    vendedor_nome: b.vendedorNome ?? null,
    itens,
    criado_por: b.por || null,
  };
  if (!linha.empresa || !linha.empresa_destino || !linha.transacao_code) {
    throw new TransferenciaError('empresa, empresaDestino e transactionCode são obrigatórios', 'INVALID_PAYLOAD');
  }
  const { data, error } = await supabase
    .from('transferencias_transacoes')
    .upsert(linha, { onConflict: 'empresa,transacao_code' })
    .select('id')
    .single();
  if (error) throw error;
  return data;
}
