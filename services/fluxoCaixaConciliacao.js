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
//   • ENTRADA: antecipação de recebíveis / boleto — por enquanto só manual.
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
const hashMemo = (l) => crypto.createHash('sha1').update(semAcento(l.memo || l.descricao || '').toUpperCase().replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 10);

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
      l.conciliacao = { id: g.id, origem: g.origem, referencia: g.referencia, justificativa: g.justificativa, automatico: g.automatico, pontuacao: g.pontuacao, usuario: g.usuario, em: g.criado_em };
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
  if (hit && Date.now() - hit.em < 10 * 60 * 1000) return hit.itens;

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
  for (let start = 2; start <= totalPages; start += 10) {
    const lote = [];
    for (let p = start; p <= Math.min(start + 9, totalPages); p++) lote.push(pedir(p));
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
  cacheTotvs.set(key, { em: Date.now(), itens });
  return itens;
}

// ─── pontuação ────────────────────────────────────────────────
function pontuar(l, c) {
  const valorL = Math.abs(round2(l.valor));
  if (c.valor == null || Math.abs(c.valor - valorL) > VALOR_TOL) return null;
  const motivos = ['valor igual'];
  let score = c.origem === 'SOLICITACAO' ? 25 : 40;
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
  const nomeL = normNome(l.fornecedor || l.contraparte_nome || '');
  const nomeC = normNome(c.nome || '');
  if (nomeL && nomeC) {
    const a = new Set(nomeL.split(' ').filter((w) => w.length > 2));
    const b = new Set(nomeC.split(' ').filter((w) => w.length > 2));
    const inter = [...a].filter((w) => b.has(w)).length;
    const ratio = inter / Math.max(1, Math.min(a.size, b.size));
    if (ratio >= 0.5) {
      score += 15;
      motivos.push('nome parecido');
    }
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
  return { ...c, score, motivos };
}

/**
 * Candidatos de conciliação para UM lançamento de saída.
 * `fontes` é o cache já carregado para a janela (ver carregarFontes).
 */
export function candidatosPara(l, fontes, usados = new Set()) {
  const lista = [];
  for (const f of [fontes.liberacao, fontes.totvs, fontes.solicitacoes]) {
    for (const c of f || []) {
      if (usados.has(`${c.origem}:${c.id}`)) continue;
      const p = pontuar(l, c);
      if (p) lista.push(p);
    }
  }
  // uma duplicata liquidada no TOTVS que também está na Liberação: fica só a da Liberação
  const dupsLib = new Set(lista.filter((c) => c.origem === 'LIBERACAO' && c.duplicata).map((c) => c.duplicata));
  const semRepetidos = lista.filter((c) => !(c.origem === 'TOTVS_CP' && dupsLib.has(c.duplicata)));
  semRepetidos.sort((a, b) => b.score - a.score);
  return semRepetidos.slice(0, 8);
}

export async function carregarFontes({ de, ate }) {
  const janela = { de: addDias(de, -5), ate: addDias(ate, 5) };
  const avisos = [];
  const [liberacao, solicitacoes, totvs] = await Promise.all([
    fonteLiberacao(janela).catch((e) => (avisos.push(`Liberação de Pagamento: ${e.message}`), [])),
    fonteSolicitacoes(janela).catch((e) => (avisos.push(`Solicitações Crosby: ${e.message}`), [])),
    fonteTotvs(janela).catch((e) => (avisos.push(`Contas a Pagar TOTVS: ${e.message}`), [])),
  ]);
  return { liberacao, solicitacoes, totvs, avisos, janela };
}

// candidatos já usados por outras conciliações (não reaproveitar o mesmo pagamento)
async function usadosNaJanela({ de, ate }) {
  const rows = await listarConciliacoes({ de: addDias(de, -10), ate: addDias(ate, 10) });
  return new Set(rows.filter((r) => r.referencia?.id != null).map((r) => `${r.origem}:${r.referencia.id}`));
}

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
  if (!['LIBERACAO', 'SOLICITACAO', 'TOTVS_CP', 'MANUAL'].includes(origem)) throw new Error('Origem inválida.');
  if (origem === 'MANUAL' && !justificativa) throw new Error('Informe a justificativa.');
  const l = await lancamentoComChave(lancamentoId);
  if (!l.chave) throw new Error('Não foi possível calcular a chave do lançamento.');
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
  const { data, error } = await supabase.from(T.conc).upsert(row, { onConflict: 'chave' }).select().single();
  lancar(error);
  return data;
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
  const { data: c } = await supabase.from('fluxo_caixa_contas').select('banco,apelido,titular_nome').eq('id', l.conta_id).maybeSingle();
  return { ...l, valor: Number(l.valor), banco: c?.banco, conta_apelido: c?.apelido, conta_titular: c?.titular_nome };
}

export async function buscarCandidatos(lancamentoId) {
  const l = await lancamentoEnriquecido(lancamentoId);
  if (l.valor >= 0) return { lancamento: l, candidatos: [], avisos: ['Entradas ainda não têm busca automática (antecipação/boleto): use a justificativa manual.'] };
  const fontes = await carregarFontes({ de: l.data, ate: l.data });
  const usados = await usadosNaJanela({ de: l.data, ate: l.data });
  const candidatos = candidatosPara(l, fontes, usados);
  return { lancamento: l, candidatos, avisos: fontes.avisos, decisao: decidir(candidatos) };
}

// regra de aceite automático: melhor ≥ 70 e com folga ≥ 15 pontos para o 2º.
// Candidatos "gêmeos" (mesma origem, nome, data e valor — ex.: 3 pagamentos
// iguais à Claro no mesmo dia) não contam como ambiguidade: o 1º é usado e
// os demais ficam para as próximas linhas iguais.
const gemeos = (a, b) => a.origem === b.origem && a.data === b.data && Math.abs(a.valor - b.valor) < 0.011 && normNome(a.nome) === normNome(b.nome);
export function decidir(candidatos) {
  if (!candidatos.length) return { automatico: false, motivo: 'sem candidato' };
  const [a] = candidatos;
  const rival = candidatos.slice(1).find((c) => !gemeos(a, c));
  if (a.score >= 70 && (!rival || a.score - rival.score >= 15)) return { automatico: true, escolhido: a };
  return { automatico: false, motivo: a.score < 70 ? 'pontuação baixa' : 'mais de um candidato parecido' };
}

/**
 * Concilia automaticamente as SAÍDAS pendentes de uma conta (ou de todas)
 * no período. Só grava quando a decisão é segura; o resto volta como
 * "ambíguas" (com candidatos) ou "sem candidato".
 */
export async function conciliarAutomatico({ contaId, de, ate, usuario }) {
  let q = supabase.from(T.lanc).select('*').gte('data', de).lte('data', ate).lt('valor', 0).is('transferencia_id', null).order('data').order('seq');
  if (contaId) q = q.eq('conta_id', contaId);
  const { data: lancs, error } = await q;
  lancar(error);
  const porConta = new Map();
  for (const l of lancs || []) {
    l.valor = Number(l.valor);
    if (!porConta.has(l.conta_id)) porConta.set(l.conta_id, []);
    porConta.get(l.conta_id).push(l);
  }
  for (const lista of porConta.values()) atribuirChaves(lista);
  const gravadas = await listarConciliacoes({ de, ate, contaIds: [...porConta.keys()] });
  const jaTem = new Set(gravadas.map((g) => g.chave));
  const pendentes = (lancs || []).filter((l) => !jaTem.has(l.chave));

  const { data: contas } = await supabase.from('fluxo_caixa_contas').select('id,banco,apelido,titular_nome');
  const contaDe = new Map((contas || []).map((c) => [c.id, c]));

  const fontes = await carregarFontes({ de, ate });
  const usados = await usadosNaJanela({ de, ate });
  const resultado = { pendentes: pendentes.length, conciliadas: [], ambiguas: [], semCandidato: 0, avisos: fontes.avisos };

  for (const l of pendentes) {
    const c = contaDe.get(l.conta_id);
    const enr = { ...l, banco: c?.banco, conta_apelido: c?.apelido, conta_titular: c?.titular_nome };
    const candidatos = candidatosPara(enr, fontes, usados);
    const d = decidir(candidatos);
    if (d.automatico) {
      const esc = d.escolhido;
      await salvarConciliacao({
        lancamentoId: l.id,
        origem: esc.origem,
        referencia: { id: esc.id, nome: esc.nome, doc: esc.doc, valor: esc.valor, data: esc.data, empresa: esc.empresa, detalhe: esc.detalhe, motivos: esc.motivos },
        justificativa: [esc.nome, esc.detalhe].filter(Boolean).join(' · '),
        usuario,
        automatico: true,
        pontuacao: esc.score,
      });
      usados.add(`${esc.origem}:${esc.id}`);
      resultado.conciliadas.push({ lancamentoId: l.id, data: l.data, valor: l.valor, origem: esc.origem, nome: esc.nome, score: esc.score });
    } else if (candidatos.length) {
      resultado.ambiguas.push({ lancamentoId: l.id, data: l.data, valor: l.valor, contraparte: l.contraparte_nome, motivo: d.motivo, candidatos: candidatos.slice(0, 5) });
    } else {
      resultado.semCandidato += 1;
    }
  }
  return resultado;
}

export default { atribuirChaves, anexarConciliacoes, listarConciliacoes, buscarCandidatos, conciliarAutomatico, salvarConciliacao, excluirConciliacao, carregarFontes, candidatosPara, decidir };
