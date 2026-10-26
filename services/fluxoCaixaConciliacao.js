// ============================================================
// Conciliação bancária — resolve as pendências do extrato (Extrato Bancário)
//
// Cada lançamento importado é uma PENDÊNCIA até ser justificado:
//   • TRANSFERÊNCIA entre contas do grupo: quando o par saída↔entrada está
//     casado (fluxo_caixa_transferencias), as duas pontas ficam conciliadas
//     automaticamente (derivado em tempo de leitura, nada é gravado);
//   • SAÍDA: pagamento a fornecedor — procurado em pagamentos_liberacao
//     (Liberação de Pagamento), solicitacoes_crosby (Solicitações Crosby) e
//     no contas a pagar do TOTVS (duplicatas liquidadas). Só roda quando o
//     usuário clica em Conciliar; o resultado é gravado e não é refeito;
//   • ENTRADA Stone (antecipação / liquidação de vendas por bandeira): casada
//     com os DEPÓSITOS do arquivo diário da API de Conciliação Stone da loja
//     (mesmo CNPJ da conta): valor igual e mesma data, mostrando bruto,
//     líquido e taxa cobrada;
//   • ENTRADA Pix da maquininha Stone ("<cliente> - Pix | Maquininha"): não
//     vem no arquivo da Stone; é casada com o TÍTULO do contas a RECEBER do
//     TOTVS das empresas do CNPJ da conta (fatura, nota promissória, Pix,
//     adiantamento), pelas mesmas regras das saídas (valor, data, nome);
//   • ENTRADA Pix do QR Code gerado no TOTVS (banco da contraparte FISERV):
//     cai LÍQUIDO da taxa fixa de R$ 0,79 por Pix; casada com o título PIX
//     (tipo 26) do contas a receber: valor do título = extrato + 0,79;
//   • qualquer outra ENTRADA Pix (cliente pagando fatura/crediário em qualquer
//     banco): mesmo caminho — título do contas a receber das empresas do CNPJ
//     da conta, por valor, data e nome do pagador;
//   • outras entradas (boleto, TED) só manual.
//
// A conciliação gravada (fluxo_caixa_conciliacoes) aponta para o lançamento
// por uma CHAVE estável — conta|data|valor|hash(histórico)|n — porque a
// reimportação do extrato apaga e recria os lançamentos (ids mudam).
// ============================================================
import crypto from 'node:crypto';
import axios from 'axios';
import supabase from '../config/supabase.js';
import { getToken } from '../utils/totvsTokenManager.js';
import { TOTVS_BASE_URL, httpsAgent, getBranchCodes } from '../totvsrouter/totvsHelper.js';
import { STONE_LOJAS, stonecodesDaLoja } from '../config/stoneConciliacao.js';
import { obterPeriodoStone, obterDiaStone } from './stoneConciliacao.js';
import { mapearFiliaisTotvsPorCnpj } from './totvsCartoesStone.js';
import { vincularComprovanteASolicitacao, solicitacoesDaConciliacao, comprovantePorChave, urlComprovante } from './comprovantesStone.js';

const T = { conc: 'fluxo_caixa_conciliacoes', lanc: 'fluxo_caixa_lancamentos', lib: 'pagamentos_liberacao', sol: 'solicitacoes_crosby' };

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const normNome = (s) =>
  semAcento(s)
    .toUpperCase()
    .replace(/\b(LTDA|ME|EPP|SA|S\/A|EIRELI|CIA|LOJA|COM|IND|E)\b/g, ' ')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const addDias = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const diffDias = (a, b) => Math.round((new Date(`${a}T00:00:00Z`) - new Date(`${b}T00:00:00Z`)) / 86400000);
const lancar = (error) => {
  if (error) throw new Error(error.message || String(error));
};

// ─── chave estável do lançamento ──────────────────────────────
export const hashMemo = (l) => crypto.createHash('sha1').update(semAcento(l.memo || l.descricao || '').toUpperCase().replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 10);

/**
 * Atribui `chave` a cada lançamento (mesma conta). Lançamentos idênticos no
 * mesmo dia (ex.: 3 tarifas de boleto de R$ 1,99) recebem n = 1, 2, 3 pela
 * ordem do extrato (seq).
 */
export function atribuirChaves(lancamentos) {
  const ordenados = [...lancamentos].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : (a.seq ?? 0) - (b.seq ?? 0)));
  const contagem = new Map();
  for (const l of ordenados) {
    const base = `${l.conta_id}|${l.data}|${round2(l.valor).toFixed(2)}|${hashMemo(l)}`;
    const n = (contagem.get(base) || 0) + 1;
    contagem.set(base, n);
    l.chave = `${base}|${n}`;
  }
  return lancamentos;
}

// ─── leitura das conciliações gravadas ────────────────────────
export async function listarConciliacoes({ de, ate, contaIds } = {}) {
  let q = supabase.from(T.conc).select('*');
  if (de) q = q.gte('data', de);
  if (ate) q = q.lte('data', ate);
  if (contaIds?.length) q = q.in('conta_id', contaIds);
  const { data, error } = await q;
  if (error) {
    if (/does not exist|schema cache/i.test(error.message || '')) return [];
    throw new Error(error.message);
  }
  return data || [];
}

/**
 * Anexa `conciliacao` (ou null) e `pendente` a cada lançamento já enriquecido
 * pelo painel (com `transferencia`). Muta os objetos.
 */
export async function anexarConciliacoes(lancamentos, { de, ate }) {
  // chaves por conta
  const porConta = new Map();
  for (const l of lancamentos) {
    if (!porConta.has(l.conta_id)) porConta.set(l.conta_id, []);
    porConta.get(l.conta_id).push(l);
  }
  for (const lista of porConta.values()) atribuirChaves(lista);

  const gravadas = await listarConciliacoes({ de: addDias(de, -1), ate: addDias(ate, 1), contaIds: [...porConta.keys()] });
  const porChave = new Map(gravadas.map((c) => [c.chave, c]));

  for (const l of lancamentos) {
    const g = porChave.get(l.chave);
    if (g) {
      l.conciliacao = { id: g.id, origem: g.origem, referencia: g.referencia, justificativa: g.justificativa, automatico: g.automatico, pontuacao: g.pontuacao, usuario: g.usuario, em: g.criado_em, anexos: g.anexos || [] };
    } else if (l.transferencia_id && l.transferencia) {
      l.conciliacao = {
        id: null,
        origem: 'TRANSFERENCIA',
        referencia: { transferenciaId: l.transferencia_id, sentido: l.transferencia.sentido, outraConta: l.transferencia.outraConta, confianca: l.transferencia.confianca },
        justificativa: l.transferencia.outraConta ? `Transferência ${l.transferencia.sentido === 'SAIDA' ? 'para' : 'de'} ${l.transferencia.outraConta.apelido}` : 'Transferência entre contas do grupo',
        automatico: true,
      };
    } else {
      l.conciliacao = null;
    }
    l.pendente = !l.conciliacao;
  }
  return lancamentos;
}

// ─── fontes de pagamento (saídas) ─────────────────────────────
const VALOR_TOL = 0.011;

async function fonteLiberacao({ de, ate }) {
  const { data, error } = await supabase
    .from(T.lib)
    .select('id,cd_empresa,nm_empresa,nm_fornecedor,cd_fornecedor,vl_duplicata,vl_real,dt_vencimento,dt_pagamento,pago_em,status,forma_pagamento,chave_pix,banco_pagamento,nr_duplicata,nr_parcela,ds_despesaitem,dados_completos')
    .eq('status', 'PAGO')
    .gte('dt_pagamento', de)
    .lte('dt_pagamento', ate);
  if (error) throw new Error(`pagamentos_liberacao: ${error.message}`);
  return (data || []).map((p) => {
    const doc = soDigitos(p.dados_completos?.nr_cpfcnpj_fornecedor) || (soDigitos(p.chave_pix).length === 14 || soDigitos(p.chave_pix).length === 11 ? soDigitos(p.chave_pix) : null);
    return {
      origem: 'LIBERACAO',
      id: p.id,
      valor: round2(p.vl_real ?? p.vl_duplicata),
      data: p.dt_pagamento || (p.pago_em ? String(p.pago_em).slice(0, 10) : null),
      nome: p.nm_fornecedor || null,
      doc: doc || null,
      empresa: p.nm_empresa || null,
      detalhe: [p.ds_despesaitem, p.forma_pagamento, p.banco_pagamento ? `banco ${p.banco_pagamento}` : null, p.nr_duplicata ? `dup ${p.nr_duplicata}${p.nr_parcela ? `/${p.nr_parcela}` : ''}` : null].filter(Boolean).join(' · '),
      bancoPagamento: p.banco_pagamento || null,
      duplicata: p.nr_duplicata ? `${p.nr_duplicata}|${p.nr_parcela ?? ''}` : null,
      vencimento: p.dt_vencimento || null,
    };
  });
}

async function fonteSolicitacoes({ de, ate }) {
  const { data, error } = await supabase
    .from(T.sol)
    .select('id,nm_empresa,supplier_name,supplier_cpf_cnpj,valor_total,dt_vencimento,dt_emissao,status,forma_pagamento,pagamento_liberacao_id,chave_pix,descricao,tipo_solicitacao,duplicate_code')
    .in('status', ['enviado_totvs', 'aprovado_financeiro', 'aprovado_gestor', 'nota_fiscal'])
    .is('pagamento_liberacao_id', null)
    .gte('dt_vencimento', addDias(de, -3))
    .lte('dt_vencimento', addDias(ate, 10));
  if (error) throw new Error(`solicitacoes_crosby: ${error.message}`);
  return (data || []).map((s) => ({
    origem: 'SOLICITACAO',
    id: s.id,
    valor: round2(s.valor_total),
    data: s.dt_vencimento || s.dt_emissao || null,
    nome: s.supplier_name || null,
    doc: soDigitos(s.supplier_cpf_cnpj) || (soDigitos(s.chave_pix).length === 14 ? soDigitos(s.chave_pix) : null),
    empresa: s.nm_empresa || null,
    detalhe: [s.tipo_solicitacao, s.descricao ? String(s.descricao).slice(0, 60) : null, s.forma_pagamento, s.status].filter(Boolean).join(' · '),
    duplicata: s.duplicate_code ? `${s.duplicate_code}|` : null,
    vencimento: s.dt_vencimento || null,
    semDataPagamento: true,
  }));
}

// contas a pagar do TOTVS: duplicatas liquidadas na janela (cache de 10 min)
const cacheTotvs = new Map();
async function fonteTotvs({ de, ate }) {
  const key = `${de}|${ate}`;
  const hit = cacheTotvs.get(key);
  if (hit && Date.now() - hit.em < 30 * 60 * 1000) return hit.itens;
  if (hit?.promessa) return hit.promessa; // já está carregando: reaproveita

  const promessa = (async () => {
  const tokenData = await getToken();
  if (!tokenData?.access_token) throw new Error('Token TOTVS indisponível.');
  const token = tokenData.access_token;
  const branchCodeList = await getBranchCodes(token);
  const endpoint = `${TOTVS_BASE_URL}/accounts-payable/v2/duplicates/search`;
  const filter = { branchCodeList, startSettlementDate: `${de}T00:00:00`, endSettlementDate: `${ate}T23:59:59` };
  // pageSize máximo aceito pelo TOTVS é 100 (200 devolve 400)
  const pedir = (page) =>
    axios.post(
      endpoint,
      { filter, page, pageSize: 100 },
      { headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` }, httpsAgent, timeout: 60000 },
    );
  const first = await pedir(1);
  let itens = [...(first.data?.items || [])];
  const totalPages = Number(first.data?.totalPages) || 1;
  for (let start = 2; start <= totalPages; start += 15) {
    const lote = [];
    for (let p = start; p <= Math.min(start + 14, totalPages); p++) lote.push(pedir(p));
    for (const r of await Promise.all(lote)) itens.push(...(r.data?.items || []));
  }

  const vistos = new Set();
  itens = itens
    .filter((it) => {
      const k = `${it.branchCode}|${it.duplicateCode}|${it.installmentCode}|${it.supplierCode}`;
      if (vistos.has(k)) return false;
      vistos.add(k);
      return (it.paidValue || 0) > 0 || it.settlementDate;
    })
    .map((it) => ({
      origem: 'TOTVS_CP',
      id: `${it.branchCode}|${it.duplicateCode}|${it.installmentCode}|${it.supplierCode}`,
      valor: round2(it.paidValue || it.duplicateValue),
      data: it.settlementDate ? String(it.settlementDate).slice(0, 10) : null,
      nome: it.expense?.[0]?.expenseName ? `${it.expense[0].expenseName}` : null,
      doc: soDigitos(it.supplierCpfCnpj) || null,
      empresa: `Empresa ${it.branchCode}`,
      detalhe: [`dup ${it.duplicateCode}/${it.installmentCode}`, `fornecedor ${it.supplierCode}`, it.expense?.[0]?.expenseName].filter(Boolean).join(' · '),
      duplicata: `${it.duplicateCode}|${it.installmentCode}`,
      vencimento: it.dueDate ? String(it.dueDate).slice(0, 10) : null,
      supplierCode: it.supplierCode,
    }));
  return itens;
  })();
  cacheTotvs.set(key, { em: Date.now(), promessa });
  try {
    const itens = await promessa;
    cacheTotvs.set(key, { em: Date.now(), itens });
    return itens;
  } catch (e) {
    cacheTotvs.delete(key);
    throw e;
  }
}

// nomes de fornecedores TOTVS (pessoa jurídica) por código, em lotes
const cacheNomes = new Map();
async function nomesFornecedores(codes, token) {
  const faltam = [...new Set(codes.filter((c) => c != null && !cacheNomes.has(c)))];
  for (let i = 0; i < faltam.length; i += 50) {
    const lote = faltam.slice(i, i + 50);
    try {
      const r = await axios.post(
        `${TOTVS_BASE_URL}/person/v2/legal-entities/search`,
        { filter: { personCodeList: lote }, page: 1, pageSize: 100 },
        { headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` }, httpsAgent, timeout: 30000 },
      );
      for (const p of r.data?.items || []) cacheNomes.set(p.code, p.name || p.fantasyName || null);
    } catch {
      /* nome fica vazio */
    }
    for (const c of lote) if (!cacheNomes.has(c)) cacheNomes.set(c, null);
  }
  return cacheNomes;
}

/**
 * Busca MANUAL no Contas a Pagar (TOTVS) + Liberação + Solicitações, pelos
 * filtros do usuário: nº da duplicata, fornecedor (nome ou CNPJ), vencimento
 * (de/até) e faixa de valor. Traz pagas e em aberto; marca `pago`.
 */
export async function buscarContasPagar({ duplicata, fornecedor, de, ate, emissaoDe, emissaoAte, valorMin, valorMax, lancamentoId } = {}) {
  const avisos = [];
  const f = { duplicata: soDigitos(duplicata) || null, fornecedor: limparTxt(fornecedor), de: de || null, ate: ate || null, emissaoDe: emissaoDe || null, emissaoAte: emissaoAte || null, valorMin: valorMin != null && valorMin !== '' ? Number(valorMin) : null, valorMax: valorMax != null && valorMax !== '' ? Number(valorMax) : null };
  if (!f.duplicata && !f.fornecedor && !f.de && !f.ate && !f.emissaoDe && !f.emissaoAte && f.valorMin == null && f.valorMax == null) throw new Error('Informe pelo menos um filtro (duplicata, fornecedor, emissão, vencimento ou valor).');
  const digitosForn = soDigitos(f.fornecedor);
  const docFornecedor = digitosForn.length === 14 || digitosForn.length === 11 ? digitosForn : null;
  // só dígitos, mais curto que um CPF → é o código do fornecedor no TOTVS
  const codigoFornecedor = f.fornecedor && /^\d+$/.test(f.fornecedor.trim()) && digitosForn.length < 11 ? Number(digitosForn) : null;
  const nomeRe = f.fornecedor && !docFornecedor && codigoFornecedor == null ? f.fornecedor : null;

  const usados = await usadosTotais();
  const lanc = lancamentoId ? await lancamentoEnriquecido(lancamentoId) : null;
  const out = [];

  // ── TOTVS: fornecedores por CNPJ ou por nome (via histórico da Liberação / Solicitações)
  const tokenData = await getToken();
  const token = tokenData?.access_token;
  if (!token) avisos.push('TOTVS indisponível (sem token).');
  let supplierCodes = null;
  if (codigoFornecedor != null) {
    supplierCodes = [codigoFornecedor];
    if (token) await nomesFornecedores([codigoFornecedor], token).catch(() => {});
  } else if (token && docFornecedor) {
    try {
      const r = await axios.post(`${TOTVS_BASE_URL}/person/v2/legal-entities/search`, { filter: { cnpjList: [docFornecedor] }, page: 1, pageSize: 20 }, { headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` }, httpsAgent, timeout: 30000 });
      supplierCodes = (r.data?.items || []).map((p) => p.code);
      for (const p of r.data?.items || []) cacheNomes.set(p.code, p.name);
    } catch (e) {
      avisos.push(`fornecedor por CNPJ: ${e.message}`);
    }
  } else if (nomeRe) {
    const { data: libs } = await supabase.from(T.lib).select('cd_fornecedor,nm_fornecedor').ilike('nm_fornecedor', `%${nomeRe}%`).not('cd_fornecedor', 'is', null).limit(200);
    const codes = new Set((libs || []).map((x) => Number(x.cd_fornecedor)).filter((n) => Number.isFinite(n)));
    const { data: sols } = await supabase.from(T.sol).select('supplier_cpf_cnpj').ilike('supplier_name', `%${nomeRe}%`).not('supplier_cpf_cnpj', 'is', null).limit(100);
    const cnpjs = [...new Set((sols || []).map((x) => soDigitos(x.supplier_cpf_cnpj)).filter((d) => d.length === 14 || d.length === 11))];
    if (token && cnpjs.length) {
      try {
        const r = await axios.post(`${TOTVS_BASE_URL}/person/v2/legal-entities/search`, { filter: { cnpjList: cnpjs.slice(0, 50) }, page: 1, pageSize: 100 }, { headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` }, httpsAgent, timeout: 30000 });
        for (const p of r.data?.items || []) {
          codes.add(p.code);
          cacheNomes.set(p.code, p.name);
        }
      } catch {
        /* segue só com os códigos da Liberação */
      }
    }
    supplierCodes = [...codes];
    if (!supplierCodes.length && !f.duplicata) avisos.push(`Nenhum fornecedor com "${nomeRe}" no histórico de pagamentos; no TOTVS a busca foi só pelos outros filtros.`);
  }

  if (token && (f.duplicata || supplierCodes?.length || f.de || f.ate || f.emissaoDe || f.emissaoAte || f.valorMin != null || f.valorMax != null)) {
    try {
      const branchCodeList = await getBranchCodes(token);
      const filter = { branchCodeList };
      if (f.duplicata) filter.duplicateCodeList = [Number(f.duplicata)];
      if (supplierCodes?.length) filter.supplierCodeList = supplierCodes.slice(0, 200);
      if (f.de) filter.startExpiredDate = `${f.de}T00:00:00`;
      if (f.ate) filter.endExpiredDate = `${f.ate}T23:59:59`;
      if (f.emissaoDe) filter.startIssueDate = `${f.emissaoDe}T00:00:00`;
      if (f.emissaoAte) filter.endIssueDate = `${f.emissaoAte}T23:59:59`;
      if (!f.duplicata && !supplierCodes?.length && !f.de && !f.ate && !f.emissaoDe && !f.emissaoAte) {
        // só valor: limita ao entorno do lançamento (±60 dias) para não varrer o TOTVS inteiro
        const base = lanc?.data || new Date().toISOString().slice(0, 10);
        filter.startExpiredDate = `${addDias(base, -60)}T00:00:00`;
        filter.endExpiredDate = `${addDias(base, 60)}T23:59:59`;
      }
      if (f.valorMin != null) filter.startDuplicateValue = f.valorMin;
      if (f.valorMax != null) filter.endDuplicateValue = f.valorMax;
      const pedir = (page) => axios.post(`${TOTVS_BASE_URL}/accounts-payable/v2/duplicates/search`, { filter, page, pageSize: 100 }, { headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` }, httpsAgent, timeout: 60000 });
      const first = await pedir(1);
      let itens = [...(first.data?.items || [])];
      const totalPages = Math.min(Number(first.data?.totalPages) || 1, 10);
      for (let p = 2; p <= totalPages; p++) itens.push(...((await pedir(p)).data?.items || []));
      if ((Number(first.data?.totalPages) || 1) > 10) avisos.push('Busca no TOTVS limitada aos primeiros 1.000 títulos; refine os filtros.');
      await nomesFornecedores(itens.map((it) => it.supplierCode), token);
      for (const it of itens) {
        const id = `${it.branchCode}|${it.duplicateCode}|${it.installmentCode}|${it.supplierCode}`;
        const valorDup = round2(it.duplicateValue);
        const pago = (it.paidValue || 0) > 0 || !!it.settlementDate;
        out.push({
          origem: 'TOTVS_CP',
          id,
          valor: round2(pago ? it.paidValue || it.duplicateValue : it.duplicateValue),
          valorDuplicata: valorDup,
          data: it.settlementDate ? String(it.settlementDate).slice(0, 10) : null,
          vencimento: it.dueDate ? String(it.dueDate).slice(0, 10) : null,
          emissao: it.issueDate ? String(it.issueDate).slice(0, 10) : null,
          nome: cacheNomes.get(it.supplierCode) || null,
          doc: soDigitos(it.supplierCpfCnpj) || null,
          empresa: `Empresa ${it.branchCode}`,
          duplicata: `${it.duplicateCode}|${it.installmentCode}`,
          detalhe: [`dup ${it.duplicateCode}/${it.installmentCode}`, it.expense?.[0]?.expenseName, pago ? 'liquidada' : 'em aberto'].filter(Boolean).join(' · '),
          pago,
          supplierCode: it.supplierCode,
        });
      }
    } catch (e) {
      avisos.push(`Contas a Pagar TOTVS: ${e.message}`);
    }
  }

  // ── Liberação de Pagamento (qualquer status) e Solicitações, com os mesmos filtros
  try {
    let q = supabase.from(T.lib).select('id,cd_empresa,nm_empresa,nm_fornecedor,cd_fornecedor,vl_duplicata,vl_real,dt_emissao,dt_vencimento,dt_pagamento,pago_em,status,forma_pagamento,chave_pix,banco_pagamento,nr_duplicata,nr_parcela,ds_despesaitem,dados_completos').neq('status', 'CANCELADO').limit(300);
    if (f.duplicata) q = q.eq('nr_duplicata', f.duplicata);
    if (nomeRe) q = q.ilike('nm_fornecedor', `%${nomeRe}%`);
    if (codigoFornecedor != null) q = q.eq('cd_fornecedor', codigoFornecedor);
    if (f.de) q = q.gte('dt_vencimento', f.de);
    if (f.ate) q = q.lte('dt_vencimento', f.ate);
    if (f.emissaoDe) q = q.gte('dt_emissao', f.emissaoDe);
    if (f.emissaoAte) q = q.lte('dt_emissao', f.emissaoAte);
    if (f.valorMin != null) q = q.gte('vl_duplicata', f.valorMin);
    if (f.valorMax != null) q = q.lte('vl_duplicata', f.valorMax);
    const { data } = await q;
    for (const p of data || []) {
      const doc = soDigitos(p.dados_completos?.nr_cpfcnpj_fornecedor) || null;
      if (docFornecedor && doc && doc !== docFornecedor) continue;
      out.push({
        origem: 'LIBERACAO',
        id: p.id,
        valor: round2(p.vl_real ?? p.vl_duplicata),
        valorDuplicata: round2(p.vl_duplicata),
        data: p.dt_pagamento || null,
        vencimento: p.dt_vencimento || null,
        emissao: p.dt_emissao || null,
        nome: p.nm_fornecedor || null,
        doc,
        empresa: p.nm_empresa || null,
        duplicata: p.nr_duplicata ? `${p.nr_duplicata}|${p.nr_parcela ?? ''}` : null,
        detalhe: [p.ds_despesaitem, p.forma_pagamento, p.banco_pagamento ? `banco ${p.banco_pagamento}` : null, p.status].filter(Boolean).join(' · '),
        pago: p.status === 'PAGO',
      });
    }
  } catch (e) {
    avisos.push(`Liberação de Pagamento: ${e.message}`);
  }
  try {
    let q = supabase.from(T.sol).select('id,nm_empresa,supplier_name,supplier_code,supplier_cpf_cnpj,valor_total,dt_vencimento,dt_emissao,status,forma_pagamento,pagamento_liberacao_id,descricao,tipo_solicitacao,duplicate_code').is('pagamento_liberacao_id', null).not('status', 'in', '("rejeitado","cancelado")').limit(200);
    if (f.duplicata) q = q.eq('duplicate_code', f.duplicata);
    if (nomeRe) q = q.ilike('supplier_name', `%${nomeRe}%`);
    if (docFornecedor) q = q.eq('supplier_cpf_cnpj', docFornecedor);
    if (codigoFornecedor != null) q = q.eq('supplier_code', codigoFornecedor);
    if (f.de) q = q.gte('dt_vencimento', f.de);
    if (f.ate) q = q.lte('dt_vencimento', f.ate);
    if (f.emissaoDe) q = q.gte('dt_emissao', f.emissaoDe);
    if (f.emissaoAte) q = q.lte('dt_emissao', f.emissaoAte);
    if (f.valorMin != null) q = q.gte('valor_total', f.valorMin);
    if (f.valorMax != null) q = q.lte('valor_total', f.valorMax);
    const { data } = await q;
    for (const s of data || []) {
      out.push({
        origem: 'SOLICITACAO',
        id: s.id,
        valor: round2(s.valor_total),
        valorDuplicata: round2(s.valor_total),
        data: null,
        vencimento: s.dt_vencimento || null,
        emissao: s.dt_emissao || null,
        nome: s.supplier_name || null,
        doc: soDigitos(s.supplier_cpf_cnpj) || null,
        empresa: s.nm_empresa || null,
        duplicata: s.duplicate_code ? `${s.duplicate_code}|` : null,
        detalhe: [s.tipo_solicitacao, s.descricao ? String(s.descricao).slice(0, 60) : null, s.status].filter(Boolean).join(' · '),
        pago: false,
      });
    }
  } catch (e) {
    avisos.push(`Solicitações Crosby: ${e.message}`);
  }

  // duplicatas da Liberação já cobrem as do TOTVS com o mesmo número
  const dupsLib = new Set(out.filter((c) => c.origem === 'LIBERACAO' && c.duplicata).map((c) => c.duplicata));
  const lista = out
    .filter((c) => !(c.origem === 'TOTVS_CP' && dupsLib.has(c.duplicata)))
    .map((c) => {
      const usado = usados.get(`${c.origem}:${c.id}`) || 0;
      return { ...c, usado, restante: round2((c.valorDuplicata ?? c.valor) - usado) };
    })
    .filter((c) => c.restante > VALOR_TOL);
  // mais perto do valor/data da saída primeiro
  const alvo = lanc ? Math.abs(lanc.valor) : null;
  lista.sort((a, b) => {
    if (alvo != null) {
      const da = Math.abs((a.restante ?? a.valor) - alvo);
      const db = Math.abs((b.restante ?? b.valor) - alvo);
      if (da !== db) return da - db;
    }
    return String(b.vencimento || '').localeCompare(String(a.vencimento || ''));
  });
  return { candidatos: lista.slice(0, 200), avisos, filtros: f, lancamento: lanc ? { id: lanc.id, data: lanc.data, valor: lanc.valor } : null };
}
const limparTxt = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// ─── entradas Pix da maquininha: títulos do contas a receber TOTVS ──
// Tipos de documento do contas a receber (cadastro "Tipo de documento" do
// TOTVS, conferido com o usuário em 23/10/2026): 1 Fatura · 2 Cheque · 3 Dinheiro
// · 4/5 Cartão crédito/débito · 6 Nota de débito · 7 TEF · 10 Adiantamento
// (saída cx.) · 11 Desconto financeiro · 14 Nota promissória · 16 TED/DOC ·
// 20 CREDEV · 21 Cartão próprio · 26 PIX · 27 PicPay · 29 Mercado Pago ·
// 30 Marketplace · 50 Outro documento. O Pix da maquininha é procurado em
// fatura, nota promissória, Pix e adiantamento (os 4 que o caixa usa).
export const TIPOS_CR = { 1: 'Fatura', 2: 'Cheque', 3: 'Dinheiro', 4: 'Cartão de crédito', 5: 'Cartão de débito', 6: 'Nota de débito', 7: 'TEF', 8: 'Cheque TEF', 9: 'Troco', 10: 'Adiantamento', 11: 'Desconto financeiro', 12: 'DOFINI', 13: 'Vale', 14: 'Nota promissória', 15: 'Cheque garantido', 16: 'TED/DOC', 17: 'Pré-autorização TEF', 18: 'Cheque presente', 19: 'TEF/TECBAN', 20: 'CREDEV', 21: 'Cartão próprio', 22: 'TEF/Hipercard', 23: 'Bônus desconto', 25: 'Voucher', 26: 'PIX', 27: 'PicPay', 28: 'Ame', 29: 'Mercado Pago', 30: 'Marketplace', 50: 'Outro documento' };
export const TIPOS_CR_PIX = { 1: TIPOS_CR[1], 10: TIPOS_CR[10], 14: TIPOS_CR[14], 26: TIPOS_CR[26] };
// Pix do QR Code emitido pelo TOTVS (Fiserv): valor cai líquido da taxa fixa
export const TAXA_PIX_FISERV = 0.79;
export const ehEntradaPixTotvs = (l) => Number(l.valor) > 0 && String(l.categoria || '') === 'pix' && /FISERV/i.test(String(l.contraparte_banco || ''));
// qualquer Pix recebido de cliente (não transferência do grupo, não devolução)
export const ehEntradaPixCliente = (l) => Number(l.valor) > 0 && String(l.categoria || '') === 'pix' && !l.transferencia_id && !/DEVOLU/i.test(String(l.descricao || ''));
export const ehEntradaPixMaquininha = (l) => Number(l.valor) > 0 && String(l.banco || '').toUpperCase() === 'STONE' && String(l.categoria || '') === 'pix' && /MAQUININHA/i.test(`${l.descricao || ''} ${l.memo || ''}`);

const cacheClientes = new Map(); // personCode → nome
async function nomesClientes(itens, token) {
  const pf = [...new Set(itens.filter((it) => soDigitos(it.customerCpfCnpj).length !== 14).map((it) => it.customerCode).filter((c) => c != null && !cacheClientes.has(c)))];
  const pj = [...new Set(itens.filter((it) => soDigitos(it.customerCpfCnpj).length === 14).map((it) => it.customerCode).filter((c) => c != null && !cacheClientes.has(c)))];
  const h = { headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` }, httpsAgent, timeout: 30000 };
  for (const [path, lista] of [['/person/v2/individuals/search', pf], ['/person/v2/legal-entities/search', pj]]) {
    for (let i = 0; i < lista.length; i += 50) {
      const lote = lista.slice(i, i + 50);
      try {
        const r = await axios.post(`${TOTVS_BASE_URL}${path}`, { filter: { personCodeList: lote }, page: 1, pageSize: 100 }, h);
        for (const x of r.data?.items || []) cacheClientes.set(x.code, x.name || x.fantasyName || null);
      } catch {
        /* nome fica vazio */
      }
      for (const c of lote) if (!cacheClientes.has(c)) cacheClientes.set(c, null);
    }
  }
}

const cacheCR = new Map();
async function fonteTotvsCR(branchCodes, { de, ate }) {
  const key = `${branchCodes.join(',')}|${de}|${ate}`;
  const hit = cacheCR.get(key);
  if (hit && hit.itens && Date.now() - hit.em < 60 * 60 * 1000) return hit.itens;
  if (hit?.promessa) return hit.promessa;
  const promessa = (async () => {
    const tokenData = await getToken();
    if (!tokenData?.access_token) throw new Error('Token TOTVS indisponível.');
    const token = tokenData.access_token;
    // A API ignora start/endSettlementDate; o que funciona é start/endPaymentDate
    // (data do pagamento) e start/endIssueDate. Junta os dois: títulos PAGOS no
    // período (fatura antiga quitada agora) + títulos EMITIDOS no período (venda
    // do dia, paga ou ainda em aberto).
    const base = { branchCodeList: branchCodes.map(Number), documentTypeList: Object.keys(TIPOS_CR_PIX).map(Number) };
    const buscar = async (filter) => {
      const pedir = (page) => axios.post(`${TOTVS_BASE_URL}/accounts-receivable/v2/documents/search`, { filter, page, pageSize: 100 }, { headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` }, httpsAgent, timeout: 90000 });
      const first = await pedir(1);
      const out = [...(first.data?.items || [])];
      const totalPages = Number(first.data?.totalPages) || 1;
      for (let start = 2; start <= totalPages; start += 10) {
        const lote = [];
        for (let p = start; p <= Math.min(start + 9, totalPages); p++) lote.push(pedir(p));
        for (const r of await Promise.all(lote)) out.push(...(r.data?.items || []));
      }
      return out;
    };
    const [pagos, emitidos] = await Promise.all([
      buscar({ ...base, startPaymentDate: `${de}T00:00:00`, endPaymentDate: `${ate}T23:59:59` }),
      buscar({ ...base, startIssueDate: `${de}T00:00:00`, endIssueDate: `${ate}T23:59:59` }),
    ]);
    let itens = [...pagos, ...emitidos];
    const vistos = new Set();
    itens = itens.filter((it) => {
      const k = `${it.branchCode}|${it.receivableCode}|${it.installmentCode}`;
      if (vistos.has(k) || ![1, 2].includes(Number(it.status))) return false; // 3 = cancelado, 4 = quebrada
      vistos.add(k);
      return true;
    });
    await nomesClientes(itens, token);
    return itens.map((it) => {
      const liquidado = !!(it.settlementDate || it.paymentDate);
      const dataPag = liquidado ? String(it.paymentDate || it.settlementDate).slice(0, 10) : null;
      const tipo = TIPOS_CR[it.documentType] || `tipo ${it.documentType}`;
      return {
        origem: 'TOTVS_CR',
        id: `${it.branchCode}|${it.receivableCode}|${it.installmentCode}`,
        branch: Number(it.branchCode),
        // valor do TÍTULO (installmentValue); valorPago = o que entrou (juros/desconto
        // já aplicados; no PIX vem líquido da taxa Fiserv). Qualquer um dos dois casa.
        valor: round2(it.installmentValue),
        valorPago: liquidado && it.paidValue ? round2(it.paidValue) : null,
        // data a comparar com o extrato: pagamento (se pago) ou emissão
        data: dataPag || (it.issueDate ? String(it.issueDate).slice(0, 10) : null),
        emissao: it.issueDate ? String(it.issueDate).slice(0, 10) : null,
        nome: cacheClientes.get(it.customerCode) || null,
        doc: soDigitos(it.customerCpfCnpj) || null,
        empresa: `Empresa ${it.branchCode}`,
        detalhe: [tipo, it.bearerName ? `portador ${it.bearerName}` : null, `título ${it.receivableCode}/${it.installmentCode}`, `emitido ${String(it.issueDate || '').slice(0, 10)}`, liquidado ? `pago ${dataPag}` : 'em aberto'].filter(Boolean).join(' · '),
        duplicata: `${it.receivableCode}|${it.installmentCode}`,
        vencimento: it.expiredDate ? String(it.expiredDate).slice(0, 10) : null,
        cr: { tipoDocumento: it.documentType, tipo, portador: it.bearerName, portadorCodigo: it.bearerCode, clienteCodigo: it.customerCode, liquidacao: dataPag, emissao: it.issueDate ? String(it.issueDate).slice(0, 10) : null, valorTitulo: round2(it.installmentValue), valorPago: round2(it.paidValue || 0), juros: round2(it.interestValue || 0), desconto: round2(it.discountValue || 0), status: it.status },
      };
    });
  })();
  cacheCR.set(key, { promessa, em: Date.now() });
  try {
    const itens = await promessa;
    cacheCR.set(key, { itens, em: Date.now() });
    return itens;
  } catch (e) {
    cacheCR.delete(key);
    throw e;
  }
}

async function filiaisDaConta(cnpj) {
  const mapa = await mapearFiliaisTotvsPorCnpj();
  return (mapa.get(soDigitos(cnpj)) || []).map((f) => f.code);
}
// Conta Stone é da loja: só as empresas do CNPJ. Conta de banco (Sicredi, Caixa…)
// é central: clientes de qualquer loja pagam nela → todas as empresas, com
// ponto extra para as do CNPJ da conta.
const filiasSeguras = (l) => filiaisParaPix(l).catch(() => ({ filiais: [], proprias: [] }));
async function filiaisParaPix(l) {
  const proprias = await filiaisDaConta(l.conta_cnpj).catch(() => []);
  if (String(l.banco || '').toUpperCase() === 'STONE' && proprias.length) return { filiais: proprias, proprias };
  const tokenData = await getToken();
  const todas = tokenData?.access_token ? await getBranchCodes(tokenData.access_token) : [];
  return { filiais: todas.length ? todas : proprias, proprias };
}

/**
 * Busca MANUAL no contas a RECEBER (entradas Pix): nº do título, cliente
 * (nome, CPF/CNPJ ou código), emissão, vencimento e faixa de valor. A API só
 * filtra por título, código/CPF-CNPJ do cliente e datas; nome e valor são
 * filtrados aqui (nome só entre os títulos do mês da linha, já carregados).
 */
export async function buscarContasReceber({ titulo, cliente, de, ate, emissaoDe, emissaoAte, valorMin, valorMax, lancamentoId } = {}) {
  const avisos = [];
  const f = { titulo: soDigitos(titulo) || null, cliente: limparTxt(cliente), de: de || null, ate: ate || null, emissaoDe: emissaoDe || null, emissaoAte: emissaoAte || null, valorMin: valorMin != null && valorMin !== '' ? Number(valorMin) : null, valorMax: valorMax != null && valorMax !== '' ? Number(valorMax) : null };
  if (!f.titulo && !f.cliente && !f.de && !f.ate && !f.emissaoDe && !f.emissaoAte && f.valorMin == null && f.valorMax == null) throw new Error('Informe pelo menos um filtro (título, cliente, emissão, vencimento ou valor).');
  const dig = soDigitos(f.cliente);
  const docCliente = dig.length === 11 || dig.length === 14 ? dig : null;
  const codCliente = f.cliente && /^\d+$/.test(f.cliente) && dig.length < 11 ? Number(dig) : null;
  const nomeRe = f.cliente && !docCliente && codCliente == null ? normNome(f.cliente) : null;

  const lanc = lancamentoId ? await lancamentoEnriquecido(lancamentoId) : null;
  const { filiais, proprias } = lanc ? await filiasSeguras(lanc) : { filiais: [], proprias: [] };
  const tokenData = await getToken();
  if (!tokenData?.access_token) throw new Error('Token TOTVS indisponível.');
  const token = tokenData.access_token;
  const branchCodeList = filiais.length ? filiais : await getBranchCodes(token);
  const usados = await usadosTotais();

  let itens = [];
  const soValor = !f.titulo && !docCliente && codCliente == null && !nomeRe && !f.de && !f.ate && !f.emissaoDe && !f.emissaoAte;
  if ((nomeRe && !f.titulo) || soValor) {
    // nome ou só valor: a API não filtra por isso → procura entre os títulos
    // emitidos/pagos no mês da linha (já carregados para a conciliação)
    const base = lanc?.data || new Date().toISOString().slice(0, 10);
    const todos = await fonteTotvsCR(branchCodeList, janelaMensal({ de: base, ate: base }));
    itens = nomeRe ? todos.filter((c) => normNome(c.nome || '').includes(nomeRe)) : todos;
    if (nomeRe && !itens.length) avisos.push(`Nenhum cliente com "${f.cliente}" nos títulos emitidos/pagos no mês da linha; tente o CPF/CNPJ ou o código do cliente.`);
    if (soValor) avisos.push('Só valor: busca entre os títulos emitidos ou pagos no mês da linha.');
  } else {
    const filter = { branchCodeList, documentTypeList: Object.keys(TIPOS_CR_PIX).map(Number) };
    if (f.titulo) filter.receivableCodeList = [Number(f.titulo)];
    if (docCliente) filter.customerCpfCnpjList = [docCliente];
    if (codCliente != null) filter.customerCodeList = [codCliente];
    if (f.de) filter.startExpiredDate = `${f.de}T00:00:00`;
    if (f.ate) filter.endExpiredDate = `${f.ate}T23:59:59`;
    if (f.emissaoDe) filter.startIssueDate = `${f.emissaoDe}T00:00:00`;
    if (f.emissaoAte) filter.endIssueDate = `${f.emissaoAte}T23:59:59`;
    const pedir = (page) => axios.post(`${TOTVS_BASE_URL}/accounts-receivable/v2/documents/search`, { filter, page, pageSize: 100 }, { headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` }, httpsAgent, timeout: 90000 });
    const first = await pedir(1);
    let brutos = [...(first.data?.items || [])];
    const totalPages = Math.min(Number(first.data?.totalPages) || 1, 10);
    for (let p = 2; p <= totalPages; p++) brutos.push(...((await pedir(p)).data?.items || []));
    if ((Number(first.data?.totalPages) || 1) > 10) avisos.push('Busca limitada aos primeiros 1.000 títulos; refine os filtros.');
    const vistos = new Set();
    brutos = brutos.filter((it) => {
      const k = `${it.branchCode}|${it.receivableCode}|${it.installmentCode}`;
      if (vistos.has(k) || ![1, 2].includes(Number(it.status))) return false;
      vistos.add(k);
      return true;
    });
    await nomesClientes(brutos, token);
    itens = brutos.map((it) => {
      const liquidado = !!(it.settlementDate || it.paymentDate);
      const dataPag = liquidado ? String(it.paymentDate || it.settlementDate).slice(0, 10) : null;
      const tipo = TIPOS_CR[it.documentType] || `tipo ${it.documentType}`;
      return {
        origem: 'TOTVS_CR',
        id: `${it.branchCode}|${it.receivableCode}|${it.installmentCode}`,
        branch: Number(it.branchCode),
        valor: round2(it.installmentValue),
        valorPago: liquidado && it.paidValue ? round2(it.paidValue) : null,
        data: dataPag || (it.issueDate ? String(it.issueDate).slice(0, 10) : null),
        emissao: it.issueDate ? String(it.issueDate).slice(0, 10) : null,
        nome: cacheClientes.get(it.customerCode) || null,
        doc: soDigitos(it.customerCpfCnpj) || null,
        empresa: `Empresa ${it.branchCode}`,
        detalhe: [tipo, it.bearerName ? `portador ${it.bearerName}` : null, `título ${it.receivableCode}/${it.installmentCode}`, `emitido ${String(it.issueDate || '').slice(0, 10)}`, liquidado ? `pago ${dataPag}` : 'em aberto'].filter(Boolean).join(' · '),
        duplicata: `${it.receivableCode}|${it.installmentCode}`,
        vencimento: it.expiredDate ? String(it.expiredDate).slice(0, 10) : null,
        cr: { tipoDocumento: it.documentType, tipo, portador: it.bearerName, portadorCodigo: it.bearerCode, clienteCodigo: it.customerCode, liquidacao: dataPag, emissao: it.issueDate ? String(it.issueDate).slice(0, 10) : null, valorTitulo: round2(it.installmentValue), valorPago: round2(it.paidValue || 0), juros: round2(it.interestValue || 0), desconto: round2(it.discountValue || 0), status: it.status },
      };
    });
  }
  // valor (a API ignora faixa de valor): título OU valor pago dentro da faixa
  if (f.valorMin != null) itens = itens.filter((c) => c.valor >= f.valorMin || (c.valorPago != null && c.valorPago >= f.valorMin));
  if (f.valorMax != null) itens = itens.filter((c) => c.valor <= f.valorMax || (c.valorPago != null && c.valorPago <= f.valorMax));
  const alvo = lanc ? Math.abs(lanc.valor) : null;
  const lista = itens.map((c) => {
    const capacidade = c.valorPago ?? c.valor; // o que entra na conta
    const usado = usados.get(`${c.origem}:${c.id}`) || 0;
    return { ...c, valorDuplicata: capacidade, pago: c.valorPago != null, usado: round2(usado), restante: round2(capacidade - usado), motivos: [], score: null, ...(proprias.includes(c.branch) ? { empresaDaConta: true } : {}) };
  }).filter((c) => c.restante > VALOR_TOL);
  lista.sort((a, b) => {
    if (alvo != null) {
      const da = Math.abs(a.restante - alvo);
      const db = Math.abs(b.restante - alvo);
      if (da !== db) return da - db;
    }
    return String(b.data || '').localeCompare(String(a.data || ''));
  });
  return { candidatos: lista.slice(0, 200), avisos, filtros: f, lancamento: lanc ? { id: lanc.id, data: lanc.data, valor: lanc.valor } : null };
}

// ─── entradas Stone: depósitos do arquivo de conciliação ─────
const fmtBr = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const lojaStoneDoCnpj = (cnpj) => STONE_LOJAS.find((l) => l.cnpj === soDigitos(cnpj) && l.apiKey && l.stonecode) || null;
export const ehEntradaStone = (l) => Number(l.valor) > 0 && String(l.banco || '').toUpperCase() === 'STONE' && ['antecipacao', 'cartao'].includes(String(l.categoria || ''));

/** Um candidato por depósito (Payment) da Stone, com as parcelas liquidadas somadas. */
export function depositosStoneDoDia(dia, loja, code) {
  const out = [];
  for (const p of dia.pagamentos || []) {
    const liqs = (dia.liquidacoes || []).filter((x) => x.paymentId === p.id);
    const bruto = round2(liqs.reduce((a, x) => a + x.bruto, 0));
    const liquido = round2(liqs.reduce((a, x) => a + x.liquido, 0));
    const taxa = round2(bruto - liquido);
    const taxaPct = bruto ? round2((taxa / bruto) * 100) : null;
    const nAnt = liqs.filter((x) => x.antecipada).length;
    const tipo = liqs.length && nAnt === liqs.length ? 'ANTECIPACAO' : nAnt ? 'MISTO' : 'LIQUIDACAO';
    const rotulo = tipo === 'ANTECIPACAO' ? 'Antecipação' : tipo === 'MISTO' ? 'Liquidação + antecipação' : `Liquidação ${p.carteira || ''}`.trim();
    out.push({
      origem: 'STONE',
      id: `${code}|${dia.data}|${p.id}`,
      valor: round2(p.valorTotal),
      data: dia.data,
      nome: 'STONE',
      doc: null,
      empresa: loja.nome,
      detalhe: `${rotulo} · ${liqs.length} parcela(s) · bruto ${fmtBr(bruto)} · taxa ${fmtBr(taxa)}${taxaPct != null ? ` (${fmtBr(taxaPct)}%)` : ''}`,
      stone: { stonecode: code, paymentId: p.id, carteira: p.carteira, carteiraId: p.carteiraId, tipo, bruto, liquido, taxa, taxaPct, parcelas: liqs.length, antecipadas: nAnt, valorEventos: p.valorEventos, saldoNegativoAnterior: p.saldoNegativoAnterior, contaDeposito: p.conta, dataOriginal: liqs.map((x) => x.dataOriginal).filter(Boolean).sort()[0] || null },
    });
  }
  return out;
}

// depósitos Stone da loja na janela (cache 30 min por loja+janela; o serviço
// Stone ainda guarda cada dia em memória/Supabase, respeitando o limite 7/h)
const cacheStone = new Map();
async function fonteStone(loja, { de, ate }) {
  const key = `${loja.cnpj}|${de}|${ate}`;
  const hit = cacheStone.get(key);
  if (hit && hit.itens && Date.now() - hit.em < 30 * 60 * 1000) return hit;
  if (hit?.promessa) return hit.promessa;
  const promessa = (async () => {
    const itens = [];
    const erros = [];
    for (const code of stonecodesDaLoja(loja)) {
      const r = await obterPeriodoStone({ ...loja, stonecode: code }, de, ate, { concorrencia: 4 });
      erros.push(...r.erros.map((e) => ({ ...e, code })));
      for (const dia of r.dias) itens.push(...depositosStoneDoDia(dia, loja, code));
    }
    const avisos = erros.length ? [`Stone ${loja.nome}: ${erros.length} dia(s) sem arquivo (${erros[0].data}: ${erros[0].erro})`] : [];
    return { itens, avisos, em: Date.now() };
  })();
  cacheStone.set(key, { promessa, em: Date.now() });
  try {
    const r = await promessa;
    cacheStone.set(key, r);
    return r;
  } catch (e) {
    cacheStone.delete(key);
    throw e;
  }
}

function pontuarEntradaStone(l, c, usado = 0) {
  const valorL = round2(Number(l.valor));
  if (Math.abs(c.valor - valorL) > VALOR_TOL) return null;
  if (usado > VALOR_TOL) return null; // depósito já conciliado com outra linha
  const motivos = ['valor igual'];
  let score = 60;
  const d = Math.abs(diffDias(c.data, l.data));
  if (d === 0) {
    score += 40;
    motivos.push('mesma data');
  } else if (d === 1) {
    score += 25;
    motivos.push('1 dia de diferença');
  } else if (d === 2) {
    score += 10;
    motivos.push('2 dias de diferença');
  } else return null;
  const cat = String(l.categoria || '');
  if (cat === 'antecipacao' && c.stone?.tipo === 'ANTECIPACAO') {
    score += 10;
    motivos.push('antecipação confere');
  } else if (cat === 'cartao' && c.stone?.tipo === 'LIQUIDACAO') {
    const band = semAcento(l.bandeira || '').toUpperCase().split(' ')[0];
    if (band && semAcento(c.stone.carteira || '').toUpperCase().includes(band)) {
      score += 10;
      motivos.push('bandeira confere');
    }
  } else if ((cat === 'antecipacao') !== (c.stone?.tipo === 'ANTECIPACAO')) {
    score -= 10;
  }
  return { ...c, score, motivos, parcial: false, valorDuplicata: c.valor, restanteAntes: c.valor, restanteDepois: 0 };
}

export function candidatosEntradaStone(l, itens, usados = new Map()) {
  const lista = [];
  for (const c of itens || []) {
    const p = pontuarEntradaStone(l, c, usados.get(`${c.origem}:${c.id}`) || 0);
    if (p) lista.push(p);
  }
  lista.sort((a, b) => b.score - a.score);
  return lista.slice(0, 8);
}

// ─── pontuação ────────────────────────────────────────────────
function pontuar(l, c, usado = 0) {
  const taxaFixa = Number(l.taxaFixa) || 0;
  const valorL = round2(Math.abs(round2(l.valor)) + taxaFixa);
  if (c.valor == null) return null;
  const restante = round2(c.valor - usado);
  const motivos = [];
  let score = c.origem === 'SOLICITACAO' ? 25 : 40;
  let parcial = false;
  const valorExtrato = Math.abs(round2(l.valor));
  let viaPago = false;
  if (Math.abs(c.valor - valorL) <= VALOR_TOL) {
    if (usado > VALOR_TOL) return null; // já foi usada inteira por outra saída
    motivos.push(taxaFixa ? `valor igual (líquido da taxa R$ ${taxaFixa.toFixed(2).replace('.', ',')})` : 'valor igual');
  } else if (c.valorPago != null && Math.abs(c.valorPago - valorExtrato) <= VALOR_TOL) {
    // título pago com juros/desconto: o que entrou na conta é o valor pago
    if (usado > VALOR_TOL) return null;
    viaPago = true;
    motivos.push(`valor pago igual (título ${c.valor.toFixed(2)})`);
  } else if (!l.semParcial && c.valor > valorL + VALOR_TOL && restante >= valorL - VALOR_TOL) {
    // duplicata maior que a saída: pagamento parcial (o restante fica para outra saída)
    parcial = true;
    score -= 15;
    motivos.push(`pagamento parcial (duplicata ${c.valor.toFixed(2)}, restante ${round2(restante - valorL).toFixed(2)})`);
  } else return null;
  if (c.data) {
    const d = Math.abs(diffDias(c.data, l.data));
    if (c.semDataPagamento) {
      if (d <= 7) {
        score += 5;
        motivos.push(`vencimento a ${d} dia(s)`);
      } else return null;
    } else if (d === 0) {
      score += 30;
      motivos.push('mesma data');
    } else if (d === 1) {
      score += 22;
      motivos.push('1 dia de diferença');
    } else if (d === 2) {
      score += 15;
      motivos.push('2 dias de diferença');
    } else if (d <= 5) {
      score += 8;
      motivos.push(`${d} dias de diferença`);
    } else return null;
  }
  const docL = soDigitos(l.contraparte_doc);
  if (docL && c.doc && docL === c.doc) {
    score += 30;
    motivos.push('mesmo CNPJ/CPF');
  }
  // nome: ignora a marca e termos genéricos (toda franquia chama "CROSBY ...") e
  // não compara quando a contraparte é o próprio titular da conta (QR Code
  // pago pelo cliente aparece com o nome da loja no extrato)
  const GENERICOS = new Set(['CROSBY', 'FRANQUIA', 'VESTUARIO', 'CONFECCOES', 'COMERCIO', 'MODA', 'VAREJO', 'SHOPPING', 'LTDA', 'DOS', 'DAS']);
  const nomeL = normNome(l.fornecedor || l.contraparte_nome || '');
  const nomeC = normNome(c.nome || '');
  const ehTitular = nomeL && l.conta_titular && (normNome(l.conta_titular).startsWith(nomeL.slice(0, 12)) || nomeL.startsWith(normNome(l.conta_titular).slice(0, 12)));
  if (nomeL && nomeC && !ehTitular) {
    const a = new Set(nomeL.split(' ').filter((w) => w.length > 2 && !GENERICOS.has(w)));
    const b = new Set(nomeC.split(' ').filter((w) => w.length > 2 && !GENERICOS.has(w)));
    const inter = [...a].filter((w) => b.has(w)).length;
    const ratio = a.size && b.size ? inter / Math.min(a.size, b.size) : 0;
    if (inter > 0 && ratio >= 0.5) {
      score += 15;
      motivos.push('nome parecido');
    }
  }
  if (Array.isArray(l.filiaisConta) && c.branch != null && l.filiaisConta.includes(c.branch)) {
    score += 5;
    motivos.push('empresa da conta');
  }
  if (c.bancoPagamento && l.conta_apelido) {
    const bp = semAcento(c.bancoPagamento).toUpperCase();
    const ap = semAcento(`${l.banco} ${l.conta_titular || ''}`).toUpperCase();
    const marca = bp.split(' ')[0];
    if (marca && ap.includes(marca)) {
      score += 5;
      motivos.push('banco de pagamento confere');
    }
  }
  // capacidade da duplicata/título em termos do que entra na conta: quando casou
  // pelo valor pago (juros/desconto), é o valor pago que limita o uso
  const capacidade = viaPago ? c.valorPago : c.valor;
  return { ...c, score, motivos, parcial, valorDuplicata: capacidade, restanteAntes: viaPago ? capacidade : restante, restanteDepois: viaPago ? 0 : round2(restante - valorL), ...(taxaFixa ? { taxaFixa } : {}) };
}

/**
 * Candidatos de conciliação para UM lançamento de saída.
 * `fontes` é o cache já carregado para a janela (ver carregarFontes).
 */
export function candidatosPara(l, fontes, usados = new Map()) {
  const lista = [];
  for (const f of [fontes.liberacao, fontes.totvs, fontes.solicitacoes]) {
    for (const c of f || []) {
      const usado = usados.get(`${c.origem}:${c.id}`) || 0;
      const p = pontuar(l, c, usado);
      if (p) lista.push(p);
    }
  }
  // uma duplicata liquidada no TOTVS que também está na Liberação: fica só a da Liberação
  const dupsLib = new Set(lista.filter((c) => c.origem === 'LIBERACAO' && c.duplicata).map((c) => c.duplicata));
  const semRepetidos = lista.filter((c) => !(c.origem === 'TOTVS_CP' && dupsLib.has(c.duplicata)));
  semRepetidos.sort((a, b) => b.score - a.score || Number(!!a.parcial) - Number(!!b.parcial));
  return semRepetidos.slice(0, 8);
}

// janela de busca: o(s) mês(es) inteiro(s) que cobrem o período, com 5 dias
// de folga — assim o cache do TOTVS (pesado) é reaproveitado entre as linhas
const janelaMensal = ({ de, ate }) => {
  const ini = `${de.slice(0, 7)}-01`;
  const [y, m] = ate.slice(0, 7).split('-').map(Number);
  const fim = `${y}-${String(m).padStart(2, '0')}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
  return { de: addDias(ini, -5), ate: addDias(fim, 5) };
};

export async function carregarFontes({ de, ate }) {
  const janela = janelaMensal({ de, ate });
  const avisos = [];
  const [liberacao, solicitacoes, totvs] = await Promise.all([
    fonteLiberacao(janela).catch((e) => (avisos.push(`Liberação de Pagamento: ${e.message}`), [])),
    fonteSolicitacoes(janela).catch((e) => (avisos.push(`Solicitações Crosby: ${e.message}`), [])),
    fonteTotvs(janela).catch((e) => (avisos.push(`Contas a Pagar TOTVS: ${e.message}`), [])),
  ]);
  return { liberacao, solicitacoes, totvs, avisos, janela };
}

// quanto de cada pagamento já foi usado por outras conciliações: uma duplicata
// só serve para UMA saída, salvo pagamento parcial (saídas somadas ≤ duplicata)
async function usadosNaJanela({ de, ate }) {
  const rows = await listarConciliacoes({ de: addDias(de, -40), ate: addDias(ate, 40) });
  const m = new Map();
  const soma = (k, v) => m.set(k, round2((m.get(k) || 0) + Math.abs(Number(v))));
  for (const r of rows) {
    if (Array.isArray(r.referencia?.itens)) {
      for (const it of r.referencia.itens) if (it?.id != null) soma(`${it.origem}:${it.id}`, it.valorUsado ?? it.valor ?? 0);
    } else if (r.referencia?.id != null) soma(`${r.origem}:${r.referencia.id}`, r.valor);
  }
  return m;
}
// uso acumulado de TODAS as conciliações (busca manual pode trazer duplicatas antigas)
async function usadosTotais() {
  return usadosNaJanela({ de: '2000-01-01', ate: '2099-12-31' });
}
const marcarUso = (usados, origem, id, valor) => usados.set(`${origem}:${id}`, round2((usados.get(`${origem}:${id}`) || 0) + Math.abs(valor)));

// ─── gravação ─────────────────────────────────────────────────
async function lancamentoComChave(lancamentoId) {
  const { data: l, error } = await supabase.from(T.lanc).select('*').eq('id', lancamentoId).maybeSingle();
  lancar(error);
  if (!l) throw new Error('Lançamento não encontrado.');
  const { data: irmaos, error: e2 } = await supabase.from(T.lanc).select('id,conta_id,data,valor,seq,memo,descricao').eq('conta_id', l.conta_id).eq('data', l.data).eq('valor', l.valor);
  lancar(e2);
  atribuirChaves(irmaos || []);
  const eu = (irmaos || []).find((x) => x.id === l.id);
  return { ...l, chave: eu?.chave };
}

export async function salvarConciliacao({ lancamentoId, origem, referencia, justificativa, usuario, automatico = false, pontuacao = null }) {
  if (!['LIBERACAO', 'SOLICITACAO', 'TOTVS_CP', 'TOTVS_CR', 'STONE', 'MANUAL', 'MULTIPLO'].includes(origem)) throw new Error('Origem inválida.');
  if (origem === 'MANUAL' && !justificativa) throw new Error('Informe a justificativa.');
  const l = await lancamentoComChave(lancamentoId);
  if (!l.chave) throw new Error('Não foi possível calcular a chave do lançamento.');
  // várias duplicatas somando a saída (ex.: 2.000 + 2.000 = 4.000)
  if (Array.isArray(referencia?.itens)) {
    const itens = referencia.itens.filter((it) => it && it.id != null && it.origem);
    if (!itens.length) throw new Error('Selecione pelo menos uma duplicata.');
    const usados = await usadosTotais();
    const { data: atual } = await supabase.from(T.conc).select('referencia,origem,valor').eq('chave', l.chave).maybeSingle();
    // se está regravando a mesma linha, libera o que ela já usava
    if (atual) {
      if (Array.isArray(atual.referencia?.itens)) for (const it of atual.referencia.itens) usados.set(`${it.origem}:${it.id}`, round2((usados.get(`${it.origem}:${it.id}`) || 0) - Math.abs(it.valorUsado ?? it.valor ?? 0)));
      else if (atual.referencia?.id != null) usados.set(`${atual.origem}:${atual.referencia.id}`, round2((usados.get(`${atual.origem}:${atual.referencia.id}`) || 0) - Math.abs(Number(atual.valor))));
    }
    let restante = Math.abs(Number(l.valor));
    const alocados = [];
    for (const it of itens) {
      const valorDup = Number(it.valorDuplicata ?? it.valor);
      const jaUsado = usados.get(`${it.origem}:${it.id}`) || 0;
      const disponivel = round2(valorDup - jaUsado);
      if (disponivel <= VALOR_TOL) throw new Error(`A duplicata ${it.duplicata || it.id} (R$ ${valorDup.toFixed(2)}) já foi totalmente usada em outras saídas.`);
      const usar = round2(Math.min(disponivel, restante));
      restante = round2(restante - usar);
      alocados.push({ origem: it.origem, id: it.id, nome: it.nome, doc: it.doc, duplicata: it.duplicata, vencimento: it.vencimento, data: it.data, empresa: it.empresa, detalhe: it.detalhe, valorDuplicata: valorDup, valorUsado: usar, parcial: usar < disponivel - VALOR_TOL || jaUsado > VALOR_TOL });
      if (restante <= VALOR_TOL) break;
    }
    if (restante > VALOR_TOL) throw new Error(`As duplicatas selecionadas (R$ ${round2(Math.abs(Number(l.valor)) - restante).toFixed(2)} disponíveis) não cobrem a saída de R$ ${Math.abs(Number(l.valor)).toFixed(2)}.`);
    const multi = alocados.length > 1;
    const row = {
      conta_id: l.conta_id,
      lancamento_id: l.id,
      chave: l.chave,
      data: l.data,
      valor: l.valor,
      origem: multi ? 'MULTIPLO' : alocados[0].origem,
      referencia: multi
        ? { multiplo: true, itens: alocados, valorTotal: round2(alocados.reduce((s, a) => s + a.valorUsado, 0)), valorDuplicata: round2(alocados.reduce((s, a) => s + a.valorDuplicata, 0)), nome: alocados[0].nome, motivos: ['escolha manual'] }
        : { ...referenciaDe({ ...alocados[0], valor: alocados[0].valorDuplicata, restanteDepois: round2(alocados[0].valorDuplicata - (usados.get(`${alocados[0].origem}:${alocados[0].id}`) || 0) - alocados[0].valorUsado), motivos: ['escolha manual'] }), itens: alocados },
      justificativa: justificativa || (multi ? `${alocados.length} duplicatas: ${alocados.map((a) => `${a.nome || ''} ${a.duplicata || a.id} (${a.valorUsado.toFixed(2)})`).join(' + ')}` : [alocados[0].parcial ? 'PARCIAL' : null, alocados[0].nome, alocados[0].detalhe].filter(Boolean).join(' · ')),
      automatico: false,
      pontuacao,
      usuario: usuario || null,
    };
    return gravarConciliacaoRow(row);
  }
  // a mesma duplicata não pode cobrir mais saídas do que o seu valor
  if (origem !== 'MANUAL' && referencia?.id != null && referencia?.valorDuplicata != null) {
    const usados = await usadosNaJanela({ de: l.data, ate: l.data });
    const { data: atual } = await supabase.from(T.conc).select('valor').eq('chave', l.chave).maybeSingle();
    const jaUsado = round2((usados.get(`${origem}:${referencia.id}`) || 0) - (atual ? Math.abs(Number(atual.valor)) : 0));
    if (jaUsado + Math.abs(Number(l.valor)) > Number(referencia.valorDuplicata) + VALOR_TOL) {
      throw new Error(`Esta duplicata (R$ ${Number(referencia.valorDuplicata).toFixed(2)}) já foi usada em outras saídas (R$ ${jaUsado.toFixed(2)}); o restante não cobre esta saída.`);
    }
  }
  const row = {
    conta_id: l.conta_id,
    lancamento_id: l.id,
    chave: l.chave,
    data: l.data,
    valor: l.valor,
    origem,
    referencia: referencia || null,
    justificativa: justificativa || (referencia ? [referencia.nome, referencia.detalhe].filter(Boolean).join(' · ') : null),
    automatico: !!automatico,
    pontuacao,
    usuario: usuario || null,
  };
  return gravarConciliacaoRow(row);
}

/**
 * Grava a conciliação e, quando a origem envolve Solicitação Crosby, leva o
 * comprovante da saída (baixado pelo bot Stone) para a solicitação: anexo na
 * conciliação + comprovante_url + marcada como paga (+ Liberação PAGO).
 */
async function gravarConciliacaoRow(row) {
  const { data, error } = await supabase.from(T.conc).upsert(row, { onConflict: 'chave' }).select().single();
  lancar(error);
  try {
    const ids = await solicitacoesDaConciliacao(data);
    if (ids.length) {
      const anexos = [...(data.anexos || [])];
      let mudou = false;
      for (const solicitacaoId of ids) {
        const r = await vincularComprovanteASolicitacao({ chave: data.chave, solicitacaoId, dataPagamento: data.data, usuario: data.usuario });
        if (r?.url && !anexos.some((a) => a.url === r.url)) {
          anexos.push({ tipo: 'comprovante', url: r.url, nome: 'Comprovante Stone (bot)', em: new Date().toISOString(), usuario: 'bot-stone' });
          mudou = true;
        }
        if (r) data.solicitacaoVinculada = { id: solicitacaoId, comprovante: r.url, jaEstavaPaga: r.jaEstavaPaga };
      }
      if (mudou) {
        const { data: d2 } = await supabase.from(T.conc).update({ anexos }).eq('id', data.id).select().single();
        if (d2) data.anexos = d2.anexos;
      }
    }
  } catch (e) {
    console.error('[conciliacao] comprovante → solicitação falhou:', e.message);
    data.avisoComprovante = e.message;
  }
  return data;
}

export async function atualizarAnexos(id, anexos) {
  if (!Array.isArray(anexos)) throw new Error('anexos deve ser uma lista.');
  const limpos = anexos
    .filter((a) => a && a.url)
    .map((a) => ({ tipo: ['comprovante', 'nota_fiscal'].includes(a.tipo) ? a.tipo : 'outro', url: String(a.url), nome: a.nome ? String(a.nome).slice(0, 200) : null, em: a.em || new Date().toISOString(), usuario: a.usuario || null }));
  const { data, error } = await supabase.from(T.conc).update({ anexos: limpos }).eq('id', id).select().single();
  lancar(error);
  return data;
}

/**
 * Detalhe de uma conciliação: o lançamento, o registro de origem completo
 * (duplicata/solicitação/liberação), outras saídas que usam a mesma origem
 * (pagamento parcial) e os anexos.
 */
export async function detalheConciliacao(id) {
  const { data: c, error } = await supabase.from(T.conc).select('*').eq('id', id).maybeSingle();
  lancar(error);
  if (!c) throw new Error('Conciliação não encontrada.');
  const { data: l } = await supabase.from(T.lanc).select('*').eq('id', c.lancamento_id).maybeSingle();
  const ref = c.referencia || {};
  let origem = null;
  let solicitacao = null;
  // comprovante da saída baixado do portal Stone pelo bot (link temporário)
  let comprovante = null;
  try {
    const comp = await comprovantePorChave(c.chave);
    if (comp) comprovante = { ...(await urlComprovante(comp.id)), solicitacaoId: comp.solicitacao_id, em: comp.criado_em, tipo: comp.stone_tipo };
  } catch (e) {
    comprovante = null;
  }
  if (Array.isArray(ref.itens) && ref.itens.length > 1) {
    // várias duplicatas somando a saída: o detalhe é a lista
    return {
      conciliacao: { ...c, valor: Number(c.valor) },
      lancamento: l ? { ...l, valor: Number(l.valor) } : null,
      origem: null,
      solicitacao: null,
      comprovante,
      itens: ref.itens,
      usos: [],
      parcial: { totalUsado: ref.valorTotal, valorDuplicata: ref.valorDuplicata, restante: ref.valorDuplicata != null && ref.valorTotal != null ? round2(ref.valorDuplicata - ref.valorTotal) : null },
    };
  }
  if (c.origem === 'LIBERACAO' && ref.id) {
    const { data: p } = await supabase.from(T.lib).select('*').eq('id', ref.id).maybeSingle();
    if (p) {
      const dc = p.dados_completos || {};
      origem = {
        tipo: 'Liberação de Pagamento',
        empresa: p.nm_empresa,
        fornecedor: p.nm_fornecedor,
        fornecedorCodigo: p.cd_fornecedor,
        doc: soDigitos(dc.nr_cpfcnpj_fornecedor) || null,
        duplicata: p.nr_duplicata,
        parcela: p.nr_parcela,
        emissao: p.dt_emissao || dc.dt_emissao || null,
        vencimento: p.dt_vencimento,
        dataPagamento: p.dt_pagamento,
        pagoEm: p.pago_em,
        pagoPor: p.pago_por,
        valor: p.vl_duplicata,
        valorPago: p.vl_real ?? p.vl_duplicata,
        forma: p.forma_pagamento,
        chavePix: p.chave_pix,
        codigoBarras: p.codigo_barras,
        banco: p.banco_pagamento,
        despesa: p.ds_despesaitem,
        centroCusto: p.cd_ccusto,
        observacao: p.observacao,
        status: p.status,
        origemRegistro: dc.origem || null,
      };
      if (dc.solicitacao_id) {
        const { data: s } = await supabase.from(T.sol).select('id,descricao,comprovante_url,nota_fiscal_url,comprovante_gestor_url,comprovante_fabio_url,tem_nota_fiscal,solicitante,setor,status').eq('id', dc.solicitacao_id).maybeSingle();
        solicitacao = s || null;
      }
    }
  } else if (c.origem === 'SOLICITACAO' && ref.id) {
    const { data: s } = await supabase.from(T.sol).select('*').eq('id', ref.id).maybeSingle();
    if (s) {
      origem = {
        tipo: 'Solicitação Crosby',
        empresa: s.nm_empresa,
        fornecedor: s.supplier_name,
        doc: soDigitos(s.supplier_cpf_cnpj) || null,
        duplicata: s.duplicate_code,
        emissao: s.dt_emissao,
        vencimento: s.dt_vencimento,
        dataPagamento: s.pago_em ? String(s.pago_em).slice(0, 10) : null,
        valor: s.valor_total,
        valorPago: s.valor_total,
        forma: s.forma_pagamento,
        chavePix: s.chave_pix,
        codigoBarras: s.codigo_barras,
        despesa: s.despesa_code,
        centroCusto: s.cost_center_code,
        observacao: s.descricao,
        status: s.status,
        solicitante: s.solicitante,
        setor: s.setor,
      };
      solicitacao = { id: s.id, comprovante_url: s.comprovante_url, nota_fiscal_url: s.nota_fiscal_url, comprovante_gestor_url: s.comprovante_gestor_url, comprovante_fabio_url: s.comprovante_fabio_url, tem_nota_fiscal: s.tem_nota_fiscal };
    }
  } else if (c.origem === 'TOTVS_CP') {
    const [branch, dup, parc, forn] = String(ref.id || '').split('|');
    origem = {
      tipo: 'Contas a Pagar (TOTVS)',
      empresa: ref.empresa || (branch ? `Empresa ${branch}` : null),
      fornecedor: ref.nome,
      fornecedorCodigo: forn,
      doc: ref.doc,
      duplicata: dup,
      parcela: parc,
      vencimento: ref.vencimento,
      dataPagamento: ref.data,
      valor: ref.valorDuplicata ?? ref.valor,
      valorPago: ref.valor,
      despesa: ref.detalhe,
    };
  }
  else if (c.origem === 'TOTVS_CR') {
    const [branch, tit, parc] = String(ref.id || '').split('|');
    const cr = ref.cr || {};
    origem = {
      tipo: 'Contas a Receber (TOTVS)',
      cliente: true,
      empresa: ref.empresa || (branch ? `Empresa ${branch}` : null),
      fornecedor: ref.nome,
      fornecedorCodigo: cr.clienteCodigo,
      doc: ref.doc,
      duplicata: tit,
      parcela: parc,
      emissao: cr.emissao || ref.emissao || ref.data,
      vencimento: ref.vencimento,
      dataPagamento: cr.liquidacao || null,
      valor: cr.valorTitulo ?? ref.valor,
      valorPago: cr.valorPago || ref.valor,
      juros: cr.juros || null,
      desconto: cr.desconto || null,
      forma: cr.tipo || null,
      banco: cr.portador || null,
      despesa: ref.detalhe,
      status: cr.status,
      taxa: ref.taxaFixa || null,
    };
  } else if (c.origem === 'STONE') {
    const st = ref.stone || {};
    origem = {
      tipo: st.tipo === 'ANTECIPACAO' ? 'Antecipação Stone' : 'Depósito Stone (liquidação de vendas)',
      empresa: ref.empresa,
      fornecedor: 'STONE',
      dataPagamento: ref.data,
      valor: ref.valor,
      valorPago: ref.valor,
      despesa: ref.detalhe,
      stone: { ...st, parcelas: [] },
    };
    // parcelas liquidadas nesse depósito (NSU, captura, bruto, líquido, taxa)
    try {
      const loja = STONE_LOJAS.find((x) => x.stonecode === st.stonecode || (x.stonecodesExtras || []).includes(st.stonecode)) || lojaStoneDoCnpj(ref.cnpj);
      if (loja && ref.data) {
        const dia = await obterDiaStone({ ...loja, stonecode: st.stonecode || loja.stonecode }, ref.data);
        origem.stone.parcelas = (dia.liquidacoes || [])
          .filter((x) => x.paymentId === st.paymentId)
          .map((x) => ({ nsu: x.nsu, dataCaptura: x.dataCaptura, formaEntrada: x.formaEntrada, parcela: x.numero, bruto: x.bruto, liquido: x.liquido, taxa: x.taxa, mdr: x.mdr, antecipada: x.antecipada, dataOriginal: x.dataOriginal, dataPagamento: x.dataPagamento }))
          .sort((a, b) => String(a.dataCaptura).localeCompare(String(b.dataCaptura)));
        origem.stone.eventos = (dia.eventosFinanceiros || []).filter((e) => e.paymentId === st.paymentId);
      }
    } catch (e) {
      origem.stone.erroParcelas = e.message;
    }
  }
  // outras saídas conciliadas com a mesma origem (pagamento parcial)
  let usos = [];
  if (ref.id != null && c.origem !== 'MANUAL') {
    const { data: outras } = await supabase.from(T.conc).select('id,lancamento_id,conta_id,data,valor,justificativa,usuario,criado_em,referencia').eq('origem', c.origem).neq('id', c.id);
    usos = (outras || []).filter((o) => String(o.referencia?.id) === String(ref.id)).map((o) => ({ id: o.id, lancamentoId: o.lancamento_id, contaId: o.conta_id, data: o.data, valor: Number(o.valor), justificativa: o.justificativa, usuario: o.usuario }));
  }
  const totalUsado = round2(Math.abs(Number(c.valor)) + usos.reduce((s, u) => s + Math.abs(u.valor), 0));
  const valorDuplicata = ref.valorDuplicata != null ? Number(ref.valorDuplicata) : origem?.valorPago != null ? Number(origem.valorPago) : null;
  return {
    conciliacao: { ...c, valor: Number(c.valor) },
    lancamento: l ? { ...l, valor: Number(l.valor) } : null,
    origem,
    solicitacao,
    comprovante,
    usos,
    parcial: { totalUsado, valorDuplicata, restante: valorDuplicata != null ? round2(valorDuplicata - totalUsado) : null },
  };
}

export async function excluirConciliacao(id) {
  const { error } = await supabase.from(T.conc).delete().eq('id', id);
  lancar(error);
  return { id };
}

// ─── busca para um lançamento / lote ──────────────────────────
async function lancamentoEnriquecido(lancamentoId) {
  const { data: l, error } = await supabase.from(T.lanc).select('*').eq('id', lancamentoId).maybeSingle();
  lancar(error);
  if (!l) throw new Error('Lançamento não encontrado.');
  const { data: c } = await supabase.from('fluxo_caixa_contas').select('banco,apelido,titular_nome,titular_cnpj').eq('id', l.conta_id).maybeSingle();
  return { ...l, valor: Number(l.valor), banco: c?.banco, conta_apelido: c?.apelido, conta_titular: c?.titular_nome, conta_cnpj: c?.titular_cnpj };
}

export async function buscarCandidatos(lancamentoId) {
  const l = await lancamentoEnriquecido(lancamentoId);
  if (l.valor >= 0) {
    if (ehEntradaPixCliente(l)) {
      if (ehEntradaPixTotvs(l)) l.taxaFixa = TAXA_PIX_FISERV;
      // Pix de venda (maquininha / QR do TOTVS) paga um título inteiro; Pix de
      // cliente revenda/franquia pode ser parcial (fica para escolha manual)
      l.semParcial = ehEntradaPixTotvs(l) || ehEntradaPixMaquininha(l);
      const { filiais, proprias } = await filiasSeguras(l);
      l.filiaisConta = proprias;
      if (!filiais.length) return { lancamento: l, candidatos: [], avisos: [`Nenhuma empresa do TOTVS para esta conta (CNPJ ${l.conta_cnpj || '?'}).`] };
      const janela = janelaMensal({ de: l.data, ate: l.data });
      const cr = await fonteTotvsCR(filiais, janela);
      const usados = await usadosNaJanela({ de: l.data, ate: l.data });
      const candidatos = candidatosPara(l, { totvs: cr }, usados);
      return { lancamento: l, candidatos, avisos: [], decisao: decidir(candidatos), filiais };
    }
    if (!ehEntradaStone(l)) return { lancamento: l, candidatos: [], avisos: ['Só entradas Pix e as vendas Stone (antecipação/liquidação) têm busca automática por enquanto; para boleto/TED use a justificativa manual.'] };
    const loja = lojaStoneDoCnpj(l.conta_cnpj);
    if (!loja) return { lancamento: l, candidatos: [], avisos: [`Conta Stone sem chave da API de Conciliação cadastrada (CNPJ ${l.conta_cnpj || '?'}). Cadastre em config/stoneConciliacao.js.`] };
    const f = await fonteStone(loja, janelaMensal({ de: l.data, ate: l.data }));
    const usados = await usadosNaJanela({ de: l.data, ate: l.data });
    const candidatos = candidatosEntradaStone(l, f.itens, usados);
    return { lancamento: l, candidatos, avisos: f.avisos, decisao: decidir(candidatos) };
  }
  const fontes = await carregarFontes({ de: l.data, ate: l.data });
  const usados = await usadosNaJanela({ de: l.data, ate: l.data });
  const candidatos = candidatosPara(l, fontes, usados);
  return { lancamento: l, candidatos, avisos: fontes.avisos, decisao: decidir(candidatos) };
}

export const referenciaDe = (c) => ({ id: c.id, nome: c.nome, doc: c.doc, valor: c.valor, valorDuplicata: c.valorDuplicata ?? c.valor, parcial: !!c.parcial, restanteDepois: c.restanteDepois ?? null, data: c.data, vencimento: c.vencimento, empresa: c.empresa, detalhe: c.detalhe, duplicata: c.duplicata, motivos: c.motivos, ...(c.emissao ? { emissao: c.emissao } : {}), ...(c.stone ? { stone: c.stone } : {}), ...(c.cr ? { cr: c.cr } : {}), ...(c.taxaFixa ? { taxaFixa: c.taxaFixa } : {}) });

// regra de aceite automático: melhor ≥ 70 e com folga ≥ 15 pontos para o 2º.
// Candidatos "gêmeos" (mesma origem, nome, data e valor — ex.: 3 pagamentos
// iguais à Claro no mesmo dia) não contam como ambiguidade: o 1º é usado e
// os demais ficam para as próximas linhas iguais.
const gemeos = (a, b) => a.origem === b.origem && a.data === b.data && Math.abs(a.valor - b.valor) < 0.011 && normNome(a.nome) === normNome(b.nome);
export function decidir(candidatos) {
  if (!candidatos.length) return { automatico: false, motivo: 'sem candidato' };
  const [a] = candidatos;
  // um pagamento parcial só rivaliza com um candidato exato se pontuar MAIS
  const rival = candidatos.slice(1).find((c) => !gemeos(a, c) && !(c.parcial && !a.parcial && c.score <= a.score));
  if (a.score >= 70 && (!rival || a.score - rival.score >= 15)) return { automatico: true, escolhido: a };
  return { automatico: false, motivo: a.score < 70 ? 'pontuação baixa' : 'mais de um candidato parecido' };
}

/**
 * Concilia automaticamente as SAÍDAS pendentes de uma conta (ou de todas)
 * no período. Só grava quando a decisão é segura; o resto volta como
 * "ambíguas" (com candidatos) ou "sem candidato".
 */
export async function conciliarAutomatico({ contaId, de, ate, usuario, simular = false, apenas = null }) {
  let q = supabase.from(T.lanc).select('*').gte('data', de).lte('data', ate).is('transferencia_id', null).order('data').order('seq');
  if (contaId) q = q.eq('conta_id', contaId);
  const { data: lancs, error } = await q;
  lancar(error);
  const { data: contas } = await supabase.from('fluxo_caixa_contas').select('id,banco,apelido,titular_nome,titular_cnpj');
  const contaDe = new Map((contas || []).map((c) => [c.id, c]));
  const enriquecer = (l) => {
    const c = contaDe.get(l.conta_id);
    return { ...l, valor: Number(l.valor), banco: c?.banco, conta_apelido: c?.apelido, conta_titular: c?.titular_nome, conta_cnpj: c?.titular_cnpj };
  };
  // saídas e entradas Stone (antecipação / liquidação de vendas); as outras entradas ficam pendentes
  const alvo = (lancs || []).map(enriquecer).filter((l) => (l.valor < 0 ? apenas !== 'entradas' : apenas !== 'saidas' && (ehEntradaStone(l) || ehEntradaPixCliente(l))));
  const porConta = new Map();
  for (const l of alvo) {
    if (!porConta.has(l.conta_id)) porConta.set(l.conta_id, []);
    porConta.get(l.conta_id).push(l);
  }
  for (const lista of porConta.values()) atribuirChaves(lista);
  const gravadas = await listarConciliacoes({ de, ate, contaIds: [...porConta.keys()] });
  const jaTem = new Set(gravadas.map((g) => g.chave));
  const pendentes = alvo.filter((l) => !jaTem.has(l.chave));

  const temSaida = pendentes.some((l) => l.valor < 0);
  const fontes = temSaida ? await carregarFontes({ de, ate }) : { avisos: [] };
  const usados = await usadosNaJanela({ de, ate });
  const resultado = { pendentes: pendentes.length, conciliadas: [], ambiguas: [], semCandidato: 0, avisos: [...fontes.avisos] };
  const stonePorCnpj = new Map();
  const crPorCnpj = new Map();

  for (const l of pendentes) {
    let candidatos;
    if (l.valor < 0) {
      candidatos = candidatosPara(l, fontes, usados);
    } else if (ehEntradaPixCliente(l)) {
      if (ehEntradaPixTotvs(l)) l.taxaFixa = TAXA_PIX_FISERV;
      l.semParcial = ehEntradaPixTotvs(l) || ehEntradaPixMaquininha(l);
      const chave = `${l.banco}|${soDigitos(l.conta_cnpj)}`;
      if (!crPorCnpj.has(chave)) {
        const { filiais, proprias } = await filiasSeguras(l);
        const itens = filiais.length ? await fonteTotvsCR(filiais, janelaMensal({ de, ate })).catch((e) => (resultado.avisos.push(`Contas a Receber TOTVS: ${e.message}`), [])) : [];
        if (!filiais.length) resultado.avisos.push(`${l.conta_apelido}: nenhuma empresa do TOTVS para a conta; Pix fica pendente.`);
        crPorCnpj.set(chave, { itens, proprias });
      }
      const f = crPorCnpj.get(chave);
      l.filiaisConta = f.proprias;
      candidatos = candidatosPara(l, { totvs: f.itens }, usados);
    } else {
      const loja = lojaStoneDoCnpj(l.conta_cnpj);
      if (!loja) {
        if (!resultado.avisos.some((a) => a.includes(l.conta_apelido || ''))) resultado.avisos.push(`${l.conta_apelido}: conta Stone sem chave da API de Conciliação; entradas ficam pendentes.`);
        resultado.semCandidato += 1;
        continue;
      }
      if (!stonePorCnpj.has(loja.cnpj)) {
        const f = await fonteStone(loja, janelaMensal({ de, ate })).catch((e) => ({ itens: [], avisos: [`Stone ${loja.nome}: ${e.message}`] }));
        stonePorCnpj.set(loja.cnpj, f);
        resultado.avisos.push(...f.avisos);
      }
      candidatos = candidatosEntradaStone(l, stonePorCnpj.get(loja.cnpj).itens, usados);
    }
    const d = decidir(candidatos);
    if (d.automatico) {
      const esc = d.escolhido;
      try {
      if (!simular) await salvarConciliacao({
        lancamentoId: l.id,
        origem: esc.origem,
        referencia: referenciaDe(esc),
        justificativa: [esc.parcial ? 'PARCIAL' : null, esc.nome, esc.detalhe, esc.taxaFixa ? `taxa Fiserv R$ ${esc.taxaFixa.toFixed(2).replace('.', ',')}` : null].filter(Boolean).join(' · '),
        usuario,
        automatico: true,
        pontuacao: esc.score,
      });
      marcarUso(usados, esc.origem, esc.id, l.valor);
      resultado.conciliadas.push({ lancamentoId: l.id, data: l.data, valor: l.valor, origem: esc.origem, nome: esc.nome, score: esc.score });
      } catch (e) {
        resultado.avisos.push(`${l.data} ${Number(l.valor).toFixed(2)}: ${e.message}`);
        resultado.ambiguas.push({ lancamentoId: l.id, data: l.data, valor: l.valor, contraparte: l.contraparte_nome, motivo: `não gravou: ${e.message}`, candidatos: candidatos.slice(0, 5) });
      }
    } else if (candidatos.length) {
      resultado.ambiguas.push({ lancamentoId: l.id, data: l.data, valor: l.valor, contraparte: l.contraparte_nome, motivo: d.motivo, candidatos: candidatos.slice(0, 5) });
    } else {
      resultado.semCandidato += 1;
    }
  }
  return resultado;
}

/** Aquece as fontes do período (chamado pela tela ao escolher o mês). */
export async function prepararFontes({ de, ate }) {
  const t0 = Date.now();
  // contas a receber de todas as empresas (entradas Pix) é a carga mais pesada
  // (~2 min a frio): aquece junto, sem derrubar o resto se falhar
  const cr = (async () => {
    const tokenData = await getToken();
    const todas = tokenData?.access_token ? await getBranchCodes(tokenData.access_token) : [];
    return todas.length ? fonteTotvsCR(todas, janelaMensal({ de, ate })) : [];
  })();
  const [f, itensCr] = await Promise.all([carregarFontes({ de, ate }), cr.catch((e) => (console.warn(`[conciliacao] contas a receber: ${e.message}`), []))]);
  return { janela: f.janela, liberacao: f.liberacao.length, solicitacoes: f.solicitacoes.length, totvs: f.totvs.length, contasReceber: itensCr.length, avisos: f.avisos, ms: Date.now() - t0 };
}

export default { prepararFontes, detalheConciliacao, atualizarAnexos, buscarContasPagar, buscarContasReceber, atribuirChaves, anexarConciliacoes, listarConciliacoes, buscarCandidatos, conciliarAutomatico, salvarConciliacao, excluirConciliacao, carregarFontes, candidatosPara, candidatosEntradaStone, depositosStoneDoDia, ehEntradaStone, ehEntradaPixMaquininha, ehEntradaPixTotvs, ehEntradaPixCliente, decidir };
