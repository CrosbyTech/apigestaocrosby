// ============================================================
// FLUXO DE CAIXA EXT — importação de extratos bancários (PDF) e visão
// gerencial consolidada: entradas, saídas (por forma de pagamento e por
// fornecedor) e transferências entre contas do grupo.
//
// Tabelas (migrations/fluxo_caixa_ext.sql):
//   fluxo_caixa_contas / fluxo_caixa_importacoes /
//   fluxo_caixa_lancamentos / fluxo_caixa_transferencias
//
// Fluxo:
//   importarExtrato(buffer)  → lerExtratoBancario (utils/extratosBancariosPdf.js)
//                            → garante a conta → apaga lançamentos da conta no
//                              período do PDF → grava importação + lançamentos
//   casarTransferencias()    → casa saída de uma conta com entrada em outra
//                              (mesmo valor, data D ou D+1, contraparte = titular)
//   painel(filtros)          → lançamentos + agregados prontos para a tela
// ============================================================
import crypto from 'node:crypto';
import supabase from '../config/supabase.js';
import { lerExtratoBancario, BANCOS, FORMAS } from '../utils/extratosBancariosPdf.js';
import { anexarConciliacoes } from './fluxoCaixaConciliacao.js';

const T = {
  contas: 'fluxo_caixa_contas',
  imp: 'fluxo_caixa_importacoes',
  lanc: 'fluxo_caixa_lancamentos',
  transf: 'fluxo_caixa_transferencias',
};

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const addDias = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const diffDias = (a, b) => Math.round((new Date(`${a}T00:00:00Z`) - new Date(`${b}T00:00:00Z`)) / 86400000);

export class MigrationPendingError extends Error {
  constructor(msg) {
    super(msg);
    this.code = 'MIGRATION_PENDING';
  }
}
export const ehErroTabelaAusente = (error) =>
  /relation .*fluxo_caixa.* does not exist|Could not find the table 'public\.fluxo_caixa|schema cache/i.test(error?.message || '');

function lancar(error) {
  if (!error) return;
  if (ehErroTabelaAusente(error))
    throw new MigrationPendingError('Tabelas fluxo_caixa_* não existem — rode migrations/fluxo_caixa_ext.sql no SQL Editor do Supabase.');
  throw new Error(error.message || String(error));
}

// PostgREST devolve no máximo 1000 linhas por chamada → pagina
async function buscarTodos(montar, pageSize = 1000) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await montar().range(from, from + pageSize - 1);
    lancar(error);
    out.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

// ─── nomes / comparação ────────────────────────────────────────
const normNome = (s) =>
  semAcento(s)
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\b(LTDA|ME|EPP|EIRELI|SA|S A|S\/A|CIA)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function nomesBatem(a, b) {
  const x = normNome(a);
  const y = normNome(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const p = Math.min(x.length, y.length);
  if (p < 8) return false;
  return x.startsWith(y.slice(0, p)) || y.startsWith(x.slice(0, p)) || x.includes(y) || y.includes(x);
}

const bancoBate = (textoBanco, banco) => {
  const up = semAcento(textoBanco).toUpperCase();
  if (banco === 'SICREDI') return /SICREDI|COOPERATIVA DE CREDITO/.test(up);
  if (banco === 'STONE') return /STONE/.test(up);
  if (banco === 'CAIXA') return /CAIXA ECONOMICA/.test(up);
  if (banco === 'MENTORE') return /MENTORE/.test(up);
  return false;
};

// apelido curto para a tela: "Stone 0001-03", "Sicredi 36733-8", "Mêntore A01"
export function apelidoPadrao(extrato) {
  const { banco, titular } = extrato;
  const nomeBanco = { STONE: 'Stone', SICREDI: 'Sicredi', CAIXA: 'Caixa', MENTORE: 'Mêntore', BNB: 'BNB', SANTANDER: 'Santander', UNICRED: 'Unicred', DAYCOVAL: 'Daycoval', PAGARME: 'Pagar.me' }[banco] || BANCOS[banco]?.nome || banco;
  if (banco === 'MENTORE') {
    const m = String(titular.nome || '').match(/\b([A-Z]\d{2})\b/);
    if (m) return `${nomeBanco} ${m[1]}`;
  }
  if (titular.cnpj && titular.cnpj.length === 14) return `${nomeBanco} ${titular.cnpj.slice(8, 12)}-${titular.cnpj.slice(12)}`;
  return `${nomeBanco} ${titular.conta}${titular.contaDv ? `-${titular.contaDv}` : ''}`;
}

// ─── contas ────────────────────────────────────────────────────
export async function listarContas() {
  const contas = await buscarTodos(() => supabase.from(T.contas).select('*').order('banco').order('conta'));
  const imps = await buscarTodos(() => supabase.from(T.imp).select('*').order('importado_em', { ascending: false }));
  const porConta = new Map();
  for (const i of imps) {
    const c = porConta.get(i.conta_id) || { importacoes: 0, ultima: null, periodoInicio: null, periodoFim: null };
    c.importacoes += 1;
    if (!c.ultima) c.ultima = i;
    if (i.periodo_inicio && (!c.periodoInicio || i.periodo_inicio < c.periodoInicio)) c.periodoInicio = i.periodo_inicio;
    if (i.periodo_fim && (!c.periodoFim || i.periodo_fim > c.periodoFim)) c.periodoFim = i.periodo_fim;
    porConta.set(i.conta_id, c);
  }
  return contas.map((c) => {
    const r = porConta.get(c.id) || {};
    return {
      ...c,
      apelido: c.apelido || `${c.banco_nome || c.banco} ${c.conta}`,
      qtdImportacoes: r.importacoes || 0,
      ultimaImportacao: r.ultima
        ? { id: r.ultima.id, arquivo: r.ultima.arquivo_nome, em: r.ultima.importado_em, periodoInicio: r.ultima.periodo_inicio, periodoFim: r.ultima.periodo_fim, saldoInicial: r.ultima.saldo_inicial, saldoFinal: r.ultima.saldo_final, qtd: r.ultima.qtd_lancamentos }
        : null,
      periodoInicio: r.periodoInicio || null,
      periodoFim: r.periodoFim || null,
    };
  });
}

export async function atualizarConta(id, patch) {
  const permitido = {};
  if (patch.apelido !== undefined) permitido.apelido = patch.apelido ? String(patch.apelido).trim() : null;
  if (patch.titular_nome !== undefined) permitido.titular_nome = patch.titular_nome ? String(patch.titular_nome).trim() : null;
  if (patch.titular_cnpj !== undefined) {
    const d = soDigitos(patch.titular_cnpj);
    if (d && d.length !== 14) throw new Error('CNPJ do titular deve ter 14 dígitos.');
    permitido.titular_cnpj = d || null;
  }
  if (patch.ativo !== undefined) permitido.ativo = !!patch.ativo;
  // código da conta no TOTVS (CTA), usado pela página Conciliação
  if (patch.cta_totvs !== undefined) permitido.cta_totvs = patch.cta_totvs ? String(patch.cta_totvs).trim().slice(0, 20) : null;
  permitido.atualizado_em = new Date().toISOString();
  const { data, error } = await supabase.from(T.contas).update(permitido).eq('id', id).select().single();
  lancar(error);
  return data;
}

async function garantirConta(extrato) {
  const chave = { banco: extrato.banco, agencia: extrato.titular.agencia || '', conta: extrato.titular.conta };
  if (!chave.conta) throw new Error('Conta não identificada no extrato.');
  const { data: existente, error } = await supabase.from(T.contas).select('*').match(chave).maybeSingle();
  lancar(error);
  const agora = new Date().toISOString();
  if (existente) {
    const patch = {
      banco_codigo: extrato.bancoCodigo,
      banco_nome: extrato.bancoNome,
      conta_dv: extrato.titular.contaDv || existente.conta_dv,
      titular_nome: existente.titular_nome || extrato.titular.nome,
      titular_cnpj: existente.titular_cnpj || extrato.titular.cnpj,
      apelido: existente.apelido || apelidoPadrao(extrato),
      atualizado_em: agora,
    };
    const r = await supabase.from(T.contas).update(patch).eq('id', existente.id).select().single();
    lancar(r.error);
    return r.data;
  }
  const r = await supabase
    .from(T.contas)
    .insert({
      ...chave,
      banco_codigo: extrato.bancoCodigo,
      banco_nome: extrato.bancoNome,
      conta_dv: extrato.titular.contaDv,
      titular_nome: extrato.titular.nome,
      titular_cnpj: extrato.titular.cnpj,
      apelido: apelidoPadrao(extrato),
    })
    .select()
    .single();
  lancar(r.error);
  return r.data;
}

// ─── importação ────────────────────────────────────────────────
const resumoExtrato = (e) => ({
  banco: e.banco,
  bancoNome: e.bancoNome,
  titular: e.titular,
  periodo: e.periodo,
  saldo: e.saldo,
  conferencia: e.conferencia,
  avisos: e.avisos,
  paginas: e.paginas,
  qtd: e.qtd,
});

/** Só lê (não grava) — para conferência na tela */
export async function lerExtrato(buffer, opts = {}) {
  const extrato = await lerExtratoBancario(buffer, opts);
  return { ...resumoExtrato(extrato), apelido: apelidoPadrao(extrato), lancamentos: extrato.lancamentos };
}

export async function importarExtrato(buffer, { nomeArquivo, usuario, banco } = {}) {
  const extrato = await lerExtratoBancario(buffer, { nomeArquivo, banco });
  const conta = await garantirConta(extrato);
  const hash = crypto.createHash('sha1').update(buffer).digest('hex');
  const inicio = extrato.periodo.inicio || extrato.periodo.primeiroLancamento;
  const fim = extrato.periodo.fim || extrato.periodo.ultimoLancamento;

  // reimportação: o PDF é a fonte da verdade do período que cobre
  if (inicio && fim) {
    const del = await supabase.from(T.lanc).delete().eq('conta_id', conta.id).gte('data', inicio).lte('data', fim);
    lancar(del.error);
    // importações anteriores da mesma conta totalmente cobertas por este período ficam obsoletas
    const delImp = await supabase.from(T.imp).delete().eq('conta_id', conta.id).gte('periodo_inicio', inicio).lte('periodo_fim', fim);
    lancar(delImp.error);
  }

  const imp = await supabase
    .from(T.imp)
    .insert({
      conta_id: conta.id,
      arquivo_nome: nomeArquivo || null,
      arquivo_hash: hash,
      periodo_inicio: inicio,
      periodo_fim: fim,
      saldo_inicial: extrato.saldo.inicial,
      saldo_final: extrato.saldo.final,
      qtd_lancamentos: extrato.qtd,
      inconsistencias: extrato.conferencia?.inconsistencias || 0,
      avisos: extrato.avisos?.length ? extrato.avisos : null,
      usuario: usuario || null,
    })
    .select()
    .single();
  lancar(imp.error);

  const rows = extrato.lancamentos.map((l) => ({
    conta_id: conta.id,
    importacao_id: imp.data.id,
    data: l.data,
    hora: l.hora,
    seq: l.seq,
    valor: l.valor,
    natureza: l.natureza,
    tipo: l.tipo,
    forma: l.forma,
    categoria: l.categoria,
    descricao: l.descricao || null,
    memo: l.memo || null,
    documento: l.documento || null,
    contraparte_nome: l.contraparteNome || null,
    contraparte_doc: l.contraparteDoc || null,
    contraparte_banco: l.contraparteBanco || null,
    bandeira: l.bandeira || null,
    loja: l.loja || null,
    saldo_apos: l.saldoApos,
    pagina: l.pagina,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const ins = await supabase.from(T.lanc).insert(rows.slice(i, i + 500));
    lancar(ins.error);
  }

  return { conta, importacao: imp.data, extrato: resumoExtrato(extrato) };
}

/**
 * Importa vários PDFs e recasa as transferências do período coberto.
 * @param arquivos [{ buffer, nome }]
 */
export async function importarVarios(arquivos, { usuario } = {}) {
  const resultados = [];
  let de = null;
  let ate = null;
  for (const a of arquivos) {
    try {
      const r = await importarExtrato(a.buffer, { nomeArquivo: a.nome, usuario });
      const p = r.extrato.periodo;
      if (p.inicio && (!de || p.inicio < de)) de = p.inicio;
      if (p.fim && (!ate || p.fim > ate)) ate = p.fim;
      resultados.push({
        arquivo: a.nome,
        ok: true,
        banco: r.extrato.banco,
        contaId: r.conta.id,
        conta: r.conta.apelido,
        titular: r.conta.titular_nome,
        periodo: p,
        qtd: r.extrato.qtd,
        saldo: r.extrato.saldo,
        inconsistencias: r.extrato.conferencia?.inconsistencias || 0,
        avisos: r.extrato.avisos || [],
      });
    } catch (e) {
      if (e instanceof MigrationPendingError) throw e;
      resultados.push({ arquivo: a.nome, ok: false, erro: e.message });
    }
  }
  let transferencias = null;
  if (de && ate) transferencias = await casarTransferencias({ de, ate });
  return { resultados, periodo: { de, ate }, transferencias };
}

export async function listarImportacoes() {
  const imps = await buscarTodos(() => supabase.from(T.imp).select('*').order('importado_em', { ascending: false }));
  const contas = await buscarTodos(() => supabase.from(T.contas).select('id,apelido,banco,titular_nome'));
  const porId = new Map(contas.map((c) => [c.id, c]));
  return imps.map((i) => ({ ...i, conta: porId.get(i.conta_id) || null }));
}

export async function excluirImportacao(id) {
  const { data: imp, error } = await supabase.from(T.imp).select('*').eq('id', id).maybeSingle();
  lancar(error);
  if (!imp) throw new Error('Importação não encontrada.');
  const d1 = await supabase.from(T.lanc).delete().eq('importacao_id', id);
  lancar(d1.error);
  const d2 = await supabase.from(T.imp).delete().eq('id', id);
  lancar(d2.error);
  if (imp.periodo_inicio && imp.periodo_fim) await casarTransferencias({ de: imp.periodo_inicio, ate: imp.periodo_fim });
  return imp;
}

// ─── transferências entre contas ───────────────────────────────
/**
 * Casa saídas de uma conta com entradas em outra conta do grupo.
 * Critérios: mesmo valor, entrada no mesmo dia ou no dia seguinte, e pelo
 * menos uma evidência de identidade (CNPJ/nome da contraparte = titular da
 * outra conta, ou banco da contraparte = banco da outra conta).
 * Pares automáticos anteriores do período são refeitos.
 */
export async function casarTransferencias({ de, ate }) {
  const deM = addDias(de, -1);
  const ateM = addDias(ate, 1);
  const contas = await buscarTodos(() => supabase.from(T.contas).select('*'));
  const porId = new Map(contas.map((c) => [c.id, c]));

  // desfaz pares automáticos do período
  const antigos = await buscarTodos(() => supabase.from(T.transf).select('id').eq('metodo', 'auto').gte('data', deM).lte('data', ateM));
  if (antigos.length) {
    const ids = antigos.map((t) => t.id);
    for (let i = 0; i < ids.length; i += 200) {
      const fatia = ids.slice(i, i + 200);
      lancar((await supabase.from(T.lanc).update({ tipo: 'SAIDA', transferencia_id: null }).in('transferencia_id', fatia).lt('valor', 0)).error);
      lancar((await supabase.from(T.lanc).update({ tipo: 'ENTRADA', transferencia_id: null }).in('transferencia_id', fatia).gt('valor', 0)).error);
      lancar((await supabase.from(T.transf).delete().in('id', fatia)).error);
    }
  }

  const rows = await buscarTodos(() =>
    supabase
      .from(T.lanc)
      .select('id,conta_id,data,valor,forma,categoria,contraparte_nome,contraparte_doc,contraparte_banco')
      .gte('data', deM)
      .lte('data', ateM)
      .in('categoria', ['pix', 'transferencia'])
      .is('transferencia_id', null)
      .order('data'),
  );
  const cents = (v) => Math.round(Math.abs(Number(v)) * 100);
  const entradasPorValor = new Map();
  for (const r of rows) {
    if (Number(r.valor) <= 0 || Math.abs(Number(r.valor)) < 1) continue;
    const k = cents(r.valor);
    if (!entradasPorValor.has(k)) entradasPorValor.set(k, []);
    entradasPorValor.get(k).push(r);
  }
  const usados = new Set();
  const pares = [];
  for (const s of rows) {
    if (Number(s.valor) >= 0 || Math.abs(Number(s.valor)) < 1 || usados.has(s.id)) continue;
    const origem = porId.get(s.conta_id);
    const cands = (entradasPorValor.get(cents(s.valor)) || []).filter((e) => {
      if (usados.has(e.id) || e.conta_id === s.conta_id) return false;
      const d = diffDias(e.data, s.data);
      return d >= 0 && d <= 1;
    });
    if (!cands.length) continue;
    let melhor = null;
    for (const e of cands) {
      const destino = porId.get(e.conta_id);
      let sc = 0;
      if (s.contraparte_doc && destino?.titular_cnpj) {
        if (s.contraparte_doc === destino.titular_cnpj) sc += 3;
        else if (s.contraparte_doc.slice(0, 8) === destino.titular_cnpj.slice(0, 8)) sc += 1;
      }
      if (e.contraparte_doc && origem?.titular_cnpj) {
        if (e.contraparte_doc === origem.titular_cnpj) sc += 3;
        else if (e.contraparte_doc.slice(0, 8) === origem.titular_cnpj.slice(0, 8)) sc += 1;
      }
      if (nomesBatem(s.contraparte_nome, destino?.titular_nome)) sc += 2;
      if (nomesBatem(e.contraparte_nome, origem?.titular_nome)) sc += 2;
      if (s.contraparte_banco && destino && bancoBate(s.contraparte_banco, destino.banco)) sc += 1;
      if (e.contraparte_banco && origem && bancoBate(e.contraparte_banco, origem.banco)) sc += 1;
      if (e.data === s.data) sc += 1;
      if (!melhor || sc > melhor.sc) melhor = { e, sc };
    }
    if (!melhor || melhor.sc < 2) continue;
    usados.add(s.id);
    usados.add(melhor.e.id);
    pares.push({
      data: s.data,
      data_entrada: melhor.e.data,
      valor: round2(Math.abs(Number(s.valor))),
      origem_conta_id: s.conta_id,
      destino_conta_id: melhor.e.conta_id,
      origem_lancamento_id: s.id,
      destino_lancamento_id: melhor.e.id,
      metodo: 'auto',
      confianca: melhor.sc >= 3 ? 'alta' : 'media',
    });
  }

  let criadas = 0;
  for (let i = 0; i < pares.length; i += 200) {
    const { data, error } = await supabase.from(T.transf).insert(pares.slice(i, i + 200)).select('id,origem_lancamento_id,destino_lancamento_id');
    lancar(error);
    for (const t of data || []) {
      const [u1, u2] = await Promise.all([
        supabase.from(T.lanc).update({ tipo: 'TRANSFERENCIA', transferencia_id: t.id }).eq('id', t.origem_lancamento_id),
        supabase.from(T.lanc).update({ tipo: 'TRANSFERENCIA', transferencia_id: t.id }).eq('id', t.destino_lancamento_id),
      ]);
      lancar(u1.error);
      lancar(u2.error);
      criadas += 1;
    }
  }
  return { periodo: { de, ate }, desfeitas: antigos.length, criadas };
}

// ─── lançamentos (ajustes manuais) ─────────────────────────────
export async function atualizarLancamento(id, patch) {
  const permitido = {};
  for (const k of ['fornecedor', 'observacao', 'forma', 'categoria']) {
    if (patch[k] !== undefined) permitido[k] = patch[k] === '' ? null : patch[k];
  }
  if (patch.tipo && ['ENTRADA', 'SAIDA', 'TRANSFERENCIA'].includes(patch.tipo)) permitido.tipo = patch.tipo;
  if (!Object.keys(permitido).length) throw new Error('Nada para atualizar.');
  const { data, error } = await supabase.from(T.lanc).update(permitido).eq('id', id).select().single();
  lancar(error);
  return data;
}

// ─── painel ────────────────────────────────────────────────────
const chaveNome = (l) =>
  (l.contraparte_doc && l.contraparte_doc.length >= 11 ? `DOC ${l.contraparte_doc}` : '') || normNome(l.fornecedor || l.contraparte_nome || '') || normNome(l.descricao || '');

function somar(mapa, chave, criar, aplicar) {
  if (!mapa.has(chave)) mapa.set(chave, criar());
  aplicar(mapa.get(chave));
}

/**
 * @param f { de, ate, contas?: number[], bancos?: string[], tipo?: 'ENTRADA'|'SAIDA'|'TRANSFERENCIA',
 *            formas?: string[], categoria?: string, contraparte?: string, busca?: string }
 */
export async function painel(f) {
  if (!f.de || !f.ate) throw new Error('Informe o período (de/ate).');
  const contas = await listarContas();
  const porConta = new Map(contas.map((c) => [c.id, c]));

  let contaIds = f.contas?.length ? f.contas.map(Number).filter(Boolean) : null;
  if (f.bancos?.length) {
    const set = new Set(f.bancos.map((b) => String(b).toUpperCase()));
    const ids = contas.filter((c) => set.has(c.banco)).map((c) => c.id);
    contaIds = contaIds ? contaIds.filter((id) => ids.includes(id)) : ids;
    if (!contaIds.length) contaIds = [-1];
  }

  const brutos = await buscarTodos(() => {
    let q = supabase.from(T.lanc).select('*').gte('data', f.de).lte('data', f.ate).order('data').order('conta_id').order('seq');
    if (contaIds) q = q.in('conta_id', contaIds);
    return q;
  });

  const raizesGrupo = new Set(contas.map((c) => (c.titular_cnpj || '').slice(0, 8)).filter((r) => r.length === 8));
  const docsGrupo = new Set(contas.map((c) => c.titular_cnpj).filter(Boolean));

  const transfRows = await buscarTodos(() => supabase.from(T.transf).select('*').gte('data', addDias(f.de, -1)).lte('data', f.ate).order('data'));
  const transfPorId = new Map(transfRows.map((t) => [t.id, t]));

  // enriquece com a conta e a "outra ponta" da transferência
  const todos = brutos.map((l) => {
    const c = porConta.get(l.conta_id);
    const t = l.transferencia_id ? transfPorId.get(l.transferencia_id) : null;
    const outraContaId = t ? (t.origem_lancamento_id === l.id ? t.destino_conta_id : t.origem_conta_id) : null;
    const outra = outraContaId ? porConta.get(outraContaId) : null;
    return {
      ...l,
      valor: Number(l.valor),
      saldo_apos: l.saldo_apos == null ? null : Number(l.saldo_apos),
      banco: c?.banco || null,
      banco_nome: c?.banco_nome || null,
      conta_apelido: c?.apelido || null,
      conta_titular: c?.titular_nome || null,
      conta_cnpj: c?.titular_cnpj || null,
      transferencia: t ? { id: t.id, confianca: t.confianca, metodo: t.metodo, sentido: t.origem_lancamento_id === l.id ? 'SAIDA' : 'ENTRADA', outraConta: outra ? { id: outra.id, apelido: outra.apelido, banco: outra.banco, titular: outra.titular_nome } : null } : null,
      nomeExibicao: l.fornecedor || l.contraparte_nome || null,
      contraparteGrupo: !!(l.contraparte_doc && (docsGrupo.has(l.contraparte_doc) || raizesGrupo.has(l.contraparte_doc.slice(0, 8)))),
    };
  });

  // conciliação: justificativas gravadas + transferências casadas (derivadas)
  await anexarConciliacoes(todos, { de: f.de, ate: f.ate });

  // filtros em memória (volume mensal é pequeno)
  const formas = f.formas?.length ? new Set(f.formas) : null;
  const buscaTxt = semAcento(f.busca || '').toUpperCase().trim();
  const buscaDig = soDigitos(f.busca || '');
  const contraparteN = f.contraparte ? normNome(f.contraparte) : null;
  const contraparteDoc = f.contraparte && /^\d{11,14}$/.test(soDigitos(f.contraparte)) && soDigitos(f.contraparte).length === String(f.contraparte).trim().length ? soDigitos(f.contraparte) : null;
  const lancamentos = todos.filter((l) => {
    if (f.tipo && l.tipo !== f.tipo) return false;
    if (f.tipos?.length && !f.tipos.includes(l.tipo)) return false;
    if (formas && !formas.has(l.forma)) return false;
    if (f.categoria && l.categoria !== f.categoria) return false;
    if (f.pendencia === 'pendentes' && !l.pendente) return false;
    if (f.pendencia === 'conciliadas' && l.pendente) return false;
    if (contraparteDoc) {
      if (l.contraparte_doc !== contraparteDoc) return false;
    } else if (contraparteN && chaveNome(l) !== contraparteN && normNome(l.nomeExibicao || '') !== contraparteN) return false;
    if (buscaTxt) {
      const alvo = semAcento([l.descricao, l.memo, l.contraparte_nome, l.fornecedor, l.documento, l.contraparte_banco, l.conta_apelido, l.conta_titular, l.loja].filter(Boolean).join(' | ')).toUpperCase();
      const porTexto = alvo.includes(buscaTxt);
      const porDoc = buscaDig.length >= 3 && ((l.contraparte_doc || '').includes(buscaDig) || (l.conta_cnpj || '').includes(buscaDig) || (l.loja || '').replace(/\D/g, '').includes(buscaDig) || (l.documento || '').includes(buscaDig));
      const porValor = /^\d+([.,]\d{1,2})?$/.test(f.busca.trim()) && Math.abs(l.valor) === Number(f.busca.trim().replace(',', '.'));
      if (!porTexto && !porDoc && !porValor) return false;
    }
    return true;
  });

  // ── agregados ──
  const resumo = { entradas: 0, saidas: 0, transfEntradas: 0, transfSaidas: 0, qtdEntradas: 0, qtdSaidas: 0, qtdTransf: 0, qtd: lancamentos.length, pendencias: lancamentos.filter((l) => l.pendente).length, conciliadas: lancamentos.filter((l) => !l.pendente).length };
  const porFormaM = new Map();
  const porContaM = new Map();
  const porDiaM = new Map();
  const fornecedoresM = new Map();
  const pagadoresM = new Map();
  const porBancoM = new Map();

  for (const l of lancamentos) {
    const ent = l.valor > 0;
    const v = Math.abs(l.valor);
    const transf = l.tipo === 'TRANSFERENCIA';
    if (transf) {
      if (ent) resumo.transfEntradas += v;
      else resumo.transfSaidas += v;
      resumo.qtdTransf += 1;
    } else if (ent) {
      resumo.entradas += v;
      resumo.qtdEntradas += 1;
    } else {
      resumo.saidas += v;
      resumo.qtdSaidas += 1;
    }

    somar(porContaM, l.conta_id, () => ({ contaId: l.conta_id, conta: l.conta_apelido, banco: l.banco, titular: l.conta_titular, cnpj: l.conta_cnpj, entradas: 0, saidas: 0, transfEntradas: 0, transfSaidas: 0, qtd: 0, saldoInicial: null, saldoFinal: null, ultimaData: null, pendencias: 0, pendEntradas: 0, pendSaidas: 0, conciliadas: 0 }), (a) => {
      a.qtd += 1;
      if (l.pendente) {
        a.pendencias += 1;
        if (ent) a.pendEntradas += 1;
        else a.pendSaidas += 1;
      } else a.conciliadas += 1;
      if (transf) ent ? (a.transfEntradas += v) : (a.transfSaidas += v);
      else ent ? (a.entradas += v) : (a.saidas += v);
      if (l.saldo_apos != null) {
        a.saldoFinal = l.saldo_apos;
        a.ultimaData = l.data;
      }
    });
    somar(porBancoM, l.banco, () => ({ banco: l.banco, bancoNome: l.banco_nome, entradas: 0, saidas: 0, transfEntradas: 0, transfSaidas: 0, qtd: 0 }), (a) => {
      a.qtd += 1;
      if (transf) ent ? (a.transfEntradas += v) : (a.transfSaidas += v);
      else ent ? (a.entradas += v) : (a.saidas += v);
    });
    somar(porDiaM, l.data, () => ({ data: l.data, entradas: 0, saidas: 0, transf: 0, qtd: 0 }), (a) => {
      a.qtd += 1;
      if (transf) a.transf += ent ? v : 0;
      else ent ? (a.entradas += v) : (a.saidas += v);
    });
    if (!transf) {
      somar(porFormaM, l.forma, () => ({ forma: l.forma, entradas: 0, saidas: 0, qtdEntradas: 0, qtdSaidas: 0, porBanco: {} }), (a) => {
        if (ent) {
          a.entradas += v;
          a.qtdEntradas += 1;
        } else {
          a.saidas += v;
          a.qtdSaidas += 1;
        }
        const b = (a.porBanco[l.banco] ||= { entradas: 0, saidas: 0, qtd: 0 });
        b.qtd += 1;
        ent ? (b.entradas += v) : (b.saidas += v);
      });
      const nomeKey = chaveNome(l);
      const alvo = ent ? pagadoresM : fornecedoresM;
      somar(alvo, nomeKey || '(SEM IDENTIFICAÇÃO)', () => ({ chave: nomeKey, nome: l.nomeExibicao || l.descricao || '(sem identificação)', doc: l.contraparte_doc || null, grupo: l.contraparteGrupo, qtd: 0, total: 0, formas: {}, bancos: {}, primeiraData: l.data, ultimaData: l.data }), (a) => {
        a.qtd += 1;
        if (l.nomeExibicao && l.nomeExibicao.length > a.nome.length) a.nome = l.nomeExibicao;
        a.total += v;
        a.formas[l.forma] = round2((a.formas[l.forma] || 0) + v);
        a.bancos[l.conta_apelido] = round2((a.bancos[l.conta_apelido] || 0) + v);
        if (l.data < a.primeiraData) a.primeiraData = l.data;
        if (l.data > a.ultimaData) a.ultimaData = l.data;
        if (!a.doc && l.contraparte_doc) a.doc = l.contraparte_doc;
      });
    }
  }

  // saldo inicial/final por conta a partir das importações que cobrem o período
  const imps = await buscarTodos(() => supabase.from(T.imp).select('conta_id,periodo_inicio,periodo_fim,saldo_inicial,saldo_final,importado_em').lte('periodo_inicio', f.ate).gte('periodo_fim', f.de).order('importado_em', { ascending: false }));
  for (const a of porContaM.values()) {
    const cobre = imps.filter((i) => i.conta_id === a.contaId).sort((x, y) => (x.periodo_inicio < y.periodo_inicio ? -1 : 1));
    if (cobre.length) {
      a.saldoInicial = cobre[0].saldo_inicial == null ? null : Number(cobre[0].saldo_inicial);
      if (a.saldoFinal == null) a.saldoFinal = cobre.at(-1).saldo_final == null ? null : Number(cobre.at(-1).saldo_final);
    }
  }

  const arr = (m) => [...m.values()];
  const fix = (o) => {
    for (const k of Object.keys(o)) {
      if (typeof o[k] === 'number') o[k] = round2(o[k]);
      else if (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) for (const v of Object.values(o[k])) if (v && typeof v === 'object') fix(v);
    }
    return o;
  };
  for (const k of Object.keys(resumo)) resumo[k] = round2(resumo[k]);
  resumo.resultado = round2(resumo.entradas - resumo.saidas);

  // transferências do período (com as duas pontas)
  const lancPorId = new Map(todos.map((l) => [l.id, l]));
  const idsFaltando = [];
  for (const t of transfRows) {
    if (!lancPorId.has(t.origem_lancamento_id)) idsFaltando.push(t.origem_lancamento_id);
    if (!lancPorId.has(t.destino_lancamento_id)) idsFaltando.push(t.destino_lancamento_id);
  }
  if (idsFaltando.length) {
    const extra = await buscarTodos(() => supabase.from(T.lanc).select('*').in('id', idsFaltando.slice(0, 1000)));
    for (const l of extra) lancPorId.set(l.id, { ...l, valor: Number(l.valor), conta_apelido: porConta.get(l.conta_id)?.apelido || null, banco: porConta.get(l.conta_id)?.banco || null });
  }
  const transferencias = transfRows
    .filter((t) => t.data >= f.de || (t.data_entrada && t.data_entrada >= f.de))
    .map((t) => {
      const o = lancPorId.get(t.origem_lancamento_id);
      const d = lancPorId.get(t.destino_lancamento_id);
      const co = porConta.get(t.origem_conta_id);
      const cd = porConta.get(t.destino_conta_id);
      return {
        id: t.id,
        data: t.data,
        dataEntrada: t.data_entrada,
        valor: Number(t.valor),
        confianca: t.confianca,
        metodo: t.metodo,
        origem: { contaId: t.origem_conta_id, conta: co?.apelido, banco: co?.banco, titular: co?.titular_nome, lancamentoId: t.origem_lancamento_id, descricao: o?.descricao, contraparte: o?.contraparte_nome, forma: o?.forma },
        destino: { contaId: t.destino_conta_id, conta: cd?.apelido, banco: cd?.banco, titular: cd?.titular_nome, lancamentoId: t.destino_lancamento_id, descricao: d?.descricao, contraparte: d?.contraparte_nome, forma: d?.forma },
      };
    })
    .filter((t) => !contaIds || contaIds.includes(t.origem.contaId) || contaIds.includes(t.destino.contaId));

  const opcoesFormas = [...new Set(todos.map((l) => l.forma))].sort();
  const opcoesContrapartes = [...new Map(todos.filter((l) => l.nomeExibicao).map((l) => [chaveNome(l), { chave: chaveNome(l), nome: l.nomeExibicao, doc: l.contraparte_doc || null }])).values()].sort((a, b) => a.nome.localeCompare(b.nome));

  return {
    periodo: { de: f.de, ate: f.ate },
    filtros: f,
    contas,
    lancamentos,
    resumo,
    porForma: arr(porFormaM).map(fix).sort((a, b) => b.entradas + b.saidas - (a.entradas + a.saidas)),
    porBanco: arr(porBancoM).map(fix),
    porConta: arr(porContaM).map(fix).sort((a, b) => (a.banco + a.conta).localeCompare(b.banco + b.conta)),
    porDia: arr(porDiaM).map(fix).sort((a, b) => (a.data < b.data ? -1 : 1)),
    fornecedores: arr(fornecedoresM).map(fix).sort((a, b) => b.total - a.total),
    pagadores: arr(pagadoresM).map(fix).sort((a, b) => b.total - a.total),
    transferencias,
    opcoes: { formas: opcoesFormas, contrapartes: opcoesContrapartes.slice(0, 500), todasFormas: Object.values(FORMAS) },
  };
}

export default {
  listarContas,
  atualizarConta,
  lerExtrato,
  importarExtrato,
  importarVarios,
  listarImportacoes,
  excluirImportacao,
  casarTransferencias,
  atualizarLancamento,
  painel,
  MigrationPendingError,
};
