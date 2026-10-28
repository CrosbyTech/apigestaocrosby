// ============================================================
// CONCILIAÇÃO DAS SOLICITAÇÕES DE PATRIMÔNIO (PRODUTO) × EXTRATO BANCÁRIO
//
// O setor PATRIMONIO (Jesus) compra PRODUTOS pagando na hora com o cartão /
// saldo PagBank, sem pedir ao financeiro. Por isso a solicitação não entra no
// fluxo de aprovação: ela nasce em `aguardando_conciliacao` e precisa ser
// CONFIRMADA contra uma SAÍDA do extrato (fluxo_caixa_lancamentos) — mesmo
// valor, data perto da compra e, de preferência, nome/CNPJ do fornecedor
// batendo. Confirmada, vira `conciliado` (paga) e aí o financeiro lança no
// TOTVS (aprovado_financeiro → enviado_totvs) sem passar pela Liberação de
// Pagamento. SERVIÇO segue o fluxo normal e não passa por aqui.
//
// A conciliação em si é gravada em fluxo_caixa_conciliacoes (origem
// SOLICITACAO) pelo salvarConciliacao — o mesmo caminho da página
// /conciliacao — e é esse grava que marca a solicitação como conciliada
// (fluxoCaixaConciliacao.marcarSolicitacoesPatrimonioConciliadas).
//
// Uso:
//   conciliarPatrimonio({ dryRun })             → varre todas as pendentes (job/tela)
//   candidatosDaSolicitacao(id)                  → lista para escolha manual
//   conciliarManual({ solicitacaoId, lancamentoId, usuario })
//   desfazerConciliacao({ solicitacaoId, usuario })
// ============================================================
import supabase from '../config/supabase.js';
import { salvarConciliacao, excluirConciliacao } from './fluxoCaixaConciliacao.js';
import { puxarTudo, nomeScore } from './conciliacaoAprovados.js';

const T = { sol: 'solicitacoes_crosby', lanc: 'fluxo_caixa_lancamentos', conc: 'fluxo_caixa_conciliacoes', contas: 'fluxo_caixa_contas' };

export const SETOR = 'PATRIMONIO';
export const STATUS_AGUARDANDO = 'aguardando_conciliacao';
export const STATUS_CONCILIADO = 'conciliado';

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const soDig = (v) => String(v ?? '').replace(/\D/g, '');
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const hojeBr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDias = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const diffDias = (a, b) => Math.round((new Date(`${a}T00:00:00Z`) - new Date(`${b}T00:00:00Z`)) / 86400000);
const lancar = (error) => {
  if (error) throw new Error(error.message || String(error));
};

const VALOR_TOL = 0.011;
const NOME_MIN = 0.6;
// janela em torno da data da compra (dt_emissao / "data do pagamento" do formulário)
const JANELA_ANTES = 15;
const JANELA_DEPOIS = 30;

// O extrato do cartão/PagBank traz a BANDEIRA/estabelecimento, não a razão
// social da nota (ex.: "ATACADAO AS 842 NATAL" × "WMS SUPERMERCADOS DO
// BRASIL"). Apelidos observados nas compras do Jesus (set–out/2026).
const APELIDOS = [
  { re: /FACEBK|FACEBOOK|META PLATFORMS/, tok: 'FACEBOOK' },
  { re: /ATACADAO|WMS SUPERMERCADOS/, tok: 'ATACADAO' },
  { re: /PPRO \*MICROSOFT|MICROSOFT/, tok: 'MICROSOFT' },
  { re: /ANTHROPIC/, tok: 'ANTHROPIC' },
  { re: /IFOOD/, tok: 'IFOOD' },
  { re: /PAO & CIA|PAO & COMPANHIA|PAO E CIA|PAO E COMPANHIA/, tok: 'PAOECIA' },
  { re: /MERCADOLIVRE|MERCADO LIVRE|EBAZAR|MERCADOPAGO/, tok: 'MERCADOLIVRE' },
  { re: /SHOPEE|SHPS TECNOLOGIA/, tok: 'SHOPEE' },
  { re: /AMAZON/, tok: 'AMAZON' },
  { re: /KALUNGA/, tok: 'KALUNGA' },
  { re: /PAGUE MENOS/, tok: 'PAGUEMENOS' },
  { re: /GOOGLE/, tok: 'GOOGLE' },
  { re: /CLARO/, tok: 'CLARO' },
];
const normBruto = (s) => semAcento(s).toUpperCase().replace(/\s+/g, ' ').trim();
function tokensApelido(s) {
  const n = normBruto(s);
  const set = new Set();
  for (const a of APELIDOS) if (a.re.test(n)) set.add(a.tok);
  return set;
}
/** 0..1 — nomeScore dos aprovados + apelidos de estabelecimento. */
export function scoreNome(fornecedor, contraparte) {
  const A = tokensApelido(fornecedor);
  const B = tokensApelido(contraparte);
  for (const t of A) if (B.has(t)) return 1;
  return nomeScore(fornecedor, contraparte);
}

function ancoraDe(sol) {
  const d = sol.dt_emissao || sol.dt_vencimento || sol.data_solicitacao || sol.created_at;
  return d ? String(d).slice(0, 10) : hojeBr();
}
const textoLanc = (l) => [l.contraparte_nome, l.memo, l.descricao].filter(Boolean).join(' ');

function pontuar(sol, l, conta) {
  const ancora = ancoraDe(sol);
  const dias = diffDias(l.data, ancora);
  const docSol = soDig(sol.supplier_cpf_cnpj);
  const docLanc = soDig(l.contraparte_doc);
  const docBate = docSol.length >= 11 && docLanc.length >= 11 && (docSol === docLanc || docSol.slice(0, 8) === docLanc.slice(0, 8));
  const ns = docBate ? 1 : scoreNome(sol.supplier_name, textoLanc(l));
  const forma = String(sol.forma_pagamento || '').toLowerCase().replace(/\s+/g, '_');
  const contaCombina = forma === 'saldo_pagbank' ? conta?.banco === 'PAGBANK' : true;
  const motivos = ['valor igual'];
  if (docBate) motivos.push('CNPJ/CPF igual');
  else if (ns >= NOME_MIN) motivos.push('nome parecido');
  if (dias === 0) motivos.push('mesma data');
  else motivos.push(`${Math.abs(dias)} dia(s) ${dias > 0 ? 'depois' : 'antes'}`);
  if (forma === 'saldo_pagbank' && contaCombina) motivos.push('conta PagBank');
  // pontuação só para ordenar/mostrar: nome vale mais, depois conta, depois data
  const pontos = Math.round(ns * 60 + (contaCombina ? 20 : 0) + Math.max(0, 20 - Math.abs(dias)));
  return { ns, dias, docBate, contaCombina, motivos, pontos, confiavel: ns >= NOME_MIN && contaCombina };
}

async function contasExtrato() {
  const { data, error } = await supabase.from(T.contas).select('id,banco,apelido,titular_cnpj,ativo');
  lancar(error);
  return new Map((data || []).filter((c) => c.ativo !== false).map((c) => [c.id, c]));
}

async function lancamentosUsados() {
  const conc = await puxarTudo(T.conc, 'lancamento_id', (q) => q);
  return new Set((conc || []).map((c) => c.lancamento_id));
}

/** saídas do extrato com o valor da solicitação (±1 centavo), dentro da janela, em qualquer conta importada */
async function saidasParaValor(valor, { de, ate, contaIds }) {
  return puxarTudo(T.lanc, 'id,conta_id,data,valor,contraparte_nome,contraparte_doc,descricao,memo,forma,categoria', (q) =>
    q.in('conta_id', contaIds).gte('valor', -(valor + VALOR_TOL)).lte('valor', -(valor - VALOR_TOL)).is('transferencia_id', null).gte('data', de).lte('data', ate),
  );
}

const SELECT_SOL = 'id,setor,status,produto_servico,solicitante,supplier_name,supplier_cpf_cnpj,valor_total,dt_emissao,dt_vencimento,data_solicitacao,created_at,forma_pagamento,nm_empresa,descricao,pago_em,pago_por_nome,comprovante_url,conciliado_em,conciliado_por_nome,conciliacao_lancamento_id,conciliacao_banco,conciliacao_data';

export const ehProdutoPatrimonio = (sol) => String(sol?.setor || '').trim().toUpperCase() === SETOR && String(sol?.produto_servico || '').toUpperCase() === 'PRODUTO';

async function carregarSolicitacao(id) {
  const { data, error } = await supabase.from(T.sol).select(SELECT_SOL).eq('id', id).maybeSingle();
  lancar(error);
  if (!data) throw new Error('Solicitação não encontrada.');
  return data;
}

async function pendentes(ids = null) {
  let q = supabase.from(T.sol).select(SELECT_SOL).ilike('setor', SETOR).eq('produto_servico', 'PRODUTO').eq('status', STATUS_AGUARDANDO);
  if (Array.isArray(ids) && ids.length) q = q.in('id', ids);
  const { data, error } = await q.order('created_at', { ascending: true });
  lancar(error);
  return (data || []).filter((s) => round2(s.valor_total) > VALOR_TOL);
}

/**
 * Candidatos de uma solicitação (para escolha manual na tela): saídas com o
 * mesmo valor na janela, ordenadas por pontuação. `confiavel` = casaria sozinha.
 */
export async function candidatosDaSolicitacao(solicitacaoId) {
  const sol = await carregarSolicitacao(solicitacaoId);
  const contas = await contasExtrato();
  const usados = await lancamentosUsados();
  const ancora = ancoraDe(sol);
  const hoje = hojeBr();
  const de = addDias(ancora, -JANELA_ANTES);
  const ate = addDias(ancora, JANELA_DEPOIS) < hoje ? addDias(ancora, JANELA_DEPOIS) : hoje;
  const valor = round2(sol.valor_total);
  const saidas = await saidasParaValor(valor, { de, ate, contaIds: [...contas.keys()] });
  const candidatos = saidas
    .map((l) => {
      const conta = contas.get(l.conta_id);
      const p = pontuar(sol, l, conta);
      return {
        lancamentoId: l.id,
        contaId: l.conta_id,
        conta: conta?.apelido || `conta ${l.conta_id}`,
        banco: conta?.banco || null,
        data: l.data,
        valor: round2(Math.abs(l.valor)),
        contraparte: l.contraparte_nome || null,
        contraparteDoc: l.contraparte_doc || null,
        descricao: l.descricao || null,
        memo: l.memo || null,
        jaConciliado: usados.has(l.id),
        ...p,
      };
    })
    .sort((a, b) => Number(a.jaConciliado) - Number(b.jaConciliado) || b.pontos - a.pontos || Math.abs(a.dias) - Math.abs(b.dias));
  return { solicitacao: sol, janela: { de, ate, ancora }, valor, candidatos };
}

/**
 * Grava a conciliação (origem SOLICITACAO) e confirma que a solicitação virou
 * `conciliado` (quem muda o status é gravarConciliacaoRow, em fluxoCaixaConciliacao).
 */
async function confirmar(sol, l, conta, { usuario, automatico, pontuacao, motivos }) {
  const valor = round2(sol.valor_total);
  const conc = await salvarConciliacao({
    lancamentoId: l.id,
    origem: 'SOLICITACAO',
    referencia: {
      id: sol.id,
      nome: sol.supplier_name || null,
      doc: soDig(sol.supplier_cpf_cnpj) || null,
      valor,
      valorDuplicata: valor,
      data: l.data,
      vencimento: sol.dt_vencimento ? String(sol.dt_vencimento).slice(0, 10) : null,
      emissao: sol.dt_emissao ? String(sol.dt_emissao).slice(0, 10) : null,
      empresa: sol.nm_empresa || null,
      detalhe: ['PATRIMÔNIO · produto pago no cartão', sol.descricao ? String(sol.descricao).slice(0, 60) : null].filter(Boolean).join(' · '),
      motivos: motivos || ['conciliação de patrimônio'],
      patrimonio: true,
    },
    justificativa: `${sol.supplier_name || sol.solicitante} · patrimônio (produto) pago no cartão${automatico ? ' · conciliação automática' : ''}`,
    usuario,
    automatico: !!automatico,
    pontuacao: pontuacao ?? null,
  });
  // garante os campos da solicitação mesmo que a marcação automática do grava tenha falhado
  const atual = await carregarSolicitacao(sol.id);
  if (atual.status !== STATUS_CONCILIADO) {
    const agora = new Date().toISOString();
    const { error } = await supabase
      .from(T.sol)
      .update({
        status: STATUS_CONCILIADO,
        conciliado_em: agora,
        conciliado_por_nome: usuario || null,
        conciliacao_lancamento_id: l.id,
        conciliacao_banco: conta?.apelido || conta?.banco || null,
        conciliacao_data: l.data,
        pago_em: atual.pago_em || agora,
        pago_por_nome: atual.pago_por_nome || usuario || null,
      })
      .eq('id', sol.id);
    lancar(error);
  }
  return conc;
}

/**
 * Varre as solicitações PATRIMONIO/PRODUTO em `aguardando_conciliacao` e
 * concilia sozinha as que têm UMA saída confiável (valor igual, nome/CNPJ
 * batendo, conta compatível). O resto fica para a escolha manual na tela.
 */
export async function conciliarPatrimonio({ ids = null, dryRun = false, usuario = 'Conciliação de patrimônio' } = {}) {
  const sols = await pendentes(ids);
  const contas = await contasExtrato();
  const usados = await lancamentosUsados();
  const hoje = hojeBr();
  const nestaRodada = new Set();
  const resultados = [];
  const manuais = [];
  const semCandidato = [];
  for (const sol of sols) {
    const ancora = ancoraDe(sol);
    const de = addDias(ancora, -JANELA_ANTES);
    const ate = addDias(ancora, JANELA_DEPOIS) < hoje ? addDias(ancora, JANELA_DEPOIS) : hoje;
    const valor = round2(sol.valor_total);
    const saidas = (await saidasParaValor(valor, { de, ate, contaIds: [...contas.keys()] })).filter((l) => !usados.has(l.id) && !nestaRodada.has(l.id));
    if (!saidas.length) {
      semCandidato.push({ id: sol.id, fornecedor: sol.supplier_name, valor, ancora });
      continue;
    }
    const scored = saidas.map((l) => ({ l, conta: contas.get(l.conta_id), p: pontuar(sol, l, contas.get(l.conta_id)) })).sort((a, b) => b.p.pontos - a.p.pontos || Math.abs(a.p.dias) - Math.abs(b.p.dias));
    const confiaveis = scored.filter((x) => x.p.confiavel);
    const top = confiaveis[0];
    const empate = confiaveis.length > 1 && confiaveis[1].p.pontos >= top.p.pontos - 2 && (confiaveis[1].l.conta_id !== top.l.conta_id || confiaveis[1].l.data !== top.l.data);
    if (!top || empate) {
      manuais.push({ id: sol.id, fornecedor: sol.supplier_name, valor, ancora, candidatos: scored.length, motivo: !top ? 'nenhuma saída com nome/conta batendo' : 'mais de uma saída confiável' });
      continue;
    }
    nestaRodada.add(top.l.id);
    const item = { id: sol.id, fornecedor: sol.supplier_name, valor, dataPagamento: top.l.data, conta: top.conta?.apelido, banco: top.conta?.banco, lancamentoId: top.l.id, contraparte: top.l.contraparte_nome || top.l.descricao, score: round2(top.p.ns), pontos: top.p.pontos };
    if (!dryRun) {
      try {
        await confirmar(sol, top.l, top.conta, { usuario, automatico: true, pontuacao: top.p.pontos, motivos: top.p.motivos });
        item.conciliado = true;
      } catch (e) {
        item.erro = e.message;
      }
    }
    resultados.push(item);
  }
  const ok = resultados.filter((r) => !r.erro);
  return { dryRun, analisadas: sols.length, conciliadas: ok.length, total: round2(ok.reduce((a, r) => a + r.valor, 0)), erros: resultados.filter((r) => r.erro).length, resultados, manuais, semCandidato };
}

/** Escolha manual na tela: casa a solicitação com o lançamento informado. */
export async function conciliarManual({ solicitacaoId, lancamentoId, usuario }) {
  const sol = await carregarSolicitacao(solicitacaoId);
  if (!ehProdutoPatrimonio(sol)) throw new Error('Só solicitações do setor PATRIMONIO do tipo PRODUTO passam pela conciliação de extrato.');
  if (sol.status !== STATUS_AGUARDANDO) throw new Error(`A solicitação está em "${sol.status}", não em aguardando conciliação.`);
  const { data: l, error } = await supabase.from(T.lanc).select('id,conta_id,data,valor,contraparte_nome,contraparte_doc,descricao,memo,transferencia_id').eq('id', lancamentoId).maybeSingle();
  lancar(error);
  if (!l) throw new Error('Lançamento do extrato não encontrado (o extrato pode ter sido reimportado — busque de novo).');
  if (Number(l.valor) >= 0) throw new Error('O lançamento escolhido não é uma saída.');
  if (l.transferencia_id) throw new Error('O lançamento escolhido é uma transferência entre contas.');
  const valor = round2(sol.valor_total);
  if (Math.abs(round2(Math.abs(l.valor)) - valor) > VALOR_TOL) throw new Error(`Valor da saída (R$ ${Math.abs(l.valor).toFixed(2)}) diferente da solicitação (R$ ${valor.toFixed(2)}).`);
  const usados = await lancamentosUsados();
  if (usados.has(l.id)) throw new Error('Essa saída já está conciliada com outro título.');
  const contas = await contasExtrato();
  const conta = contas.get(l.conta_id);
  const p = pontuar(sol, l, conta);
  const conc = await confirmar(sol, l, conta, { usuario, automatico: false, pontuacao: p.pontos, motivos: [...p.motivos, 'escolha manual'] });
  return { conciliacaoId: conc?.id || null, solicitacao: await carregarSolicitacao(sol.id) };
}

/** Desfaz: apaga a conciliação gravada e devolve a solicitação para aguardando_conciliacao. */
export async function desfazerConciliacao({ solicitacaoId, usuario }) {
  const sol = await carregarSolicitacao(solicitacaoId);
  if (sol.status !== STATUS_CONCILIADO) throw new Error(`A solicitação está em "${sol.status}", não em conciliado.`);
  if (sol.conciliacao_lancamento_id) {
    const { data: concs } = await supabase.from(T.conc).select('id,origem,referencia').eq('lancamento_id', sol.conciliacao_lancamento_id);
    for (const c of concs || []) {
      if (c.origem === 'SOLICITACAO' && String(c.referencia?.id) === String(sol.id)) await excluirConciliacao(c.id);
    }
  }
  const { error } = await supabase
    .from(T.sol)
    .update({ status: STATUS_AGUARDANDO, conciliado_em: null, conciliado_por_nome: null, conciliacao_lancamento_id: null, conciliacao_banco: null, conciliacao_data: null, pago_em: null, pago_por_nome: null })
    .eq('id', sol.id);
  lancar(error);
  console.log(`[conciliacao-patrimonio] conciliação desfeita em ${sol.id} por ${usuario || '?'}`);
  return { solicitacao: await carregarSolicitacao(sol.id) };
}

export function resumoTexto(r) {
  const fmt = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  const linhas = [`${r.dryRun ? '[simulação] ' : ''}Conciliação de patrimônio: ${r.analisadas} pendente(s), ${r.conciliadas} conciliada(s) (${fmt(r.total)}), ${r.manuais.length} para escolha manual, ${r.semCandidato.length} sem saída no extrato.`];
  for (const x of r.resultados) linhas.push(`  • ${x.fornecedor} — ${fmt(x.valor)} · ${x.conta} · ${x.dataPagamento} · "${x.contraparte}"${x.erro ? ` · ERRO ${x.erro}` : ''}`);
  return linhas.join('\n');
}

export default { conciliarPatrimonio, candidatosDaSolicitacao, conciliarManual, desfazerConciliacao, resumoTexto, ehProdutoPatrimonio };
