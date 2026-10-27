// ============================================================
// CONCILIAÇÃO DOS APROVADOS — marca como PAGO os títulos da área APROVADOS
// da Liberação de Pagamento que saíram de fato dos extratos (Stone + Sicredi).
//
// Para cada título status=APROVADO procura uma SAÍDA no extrato bancário
// (fluxo_caixa_lancamentos, contas STONE/SICREDI) com o MESMO valor, nome da
// contraparte batendo e data dentro da janela (vencimento−10 .. hoje). Achou:
//   status → PAGO, dt_pagamento = data da saída, vl_real = valor da saída,
//   banco_pagamento = o já escolhido no título ou o derivado da conta,
//   e grava a conciliação (origem LIBERACAO) ligando a linha do extrato ao
//   título — o que também leva o comprovante à Solicitação Crosby, quando há.
//
// Uso:
//   conciliarAprovados({ dryRun })                 → tudo que já saiu (1ª carga)
//   conciliarAprovados({ dataSaida: '2026-10-26' }) → só as saídas desse dia
// O job diário (jobs/conciliacao-aprovados.job.js) roda com dataSaida = ontem.
// ============================================================
import supabase from '../config/supabase.js';
import { salvarConciliacao } from './fluxoCaixaConciliacao.js';

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const soDig = (v) => String(v ?? '').replace(/\D/g, '');
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const normNome = (s) =>
  semAcento(s)
    .toUpperCase()
    .replace(/\b(LTDA|ME|EPP|SA|S\/A|EIRELI|CIA|LOJA|COM|IND|E|DE|DA|DO|DOS|DAS)\b/g, ' ')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const tokensNome = (s) => new Set(normNome(s).split(' ').filter((t) => t.length > 2));
function nomeScore(a, b) {
  const A = tokensNome(a);
  const B = tokensNome(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / Math.min(A.size, B.size);
}
const hojeBr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDias = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const fmt = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

const VALOR_TOL = 0.011;
const NOME_MIN = 0.6; // fração de tokens do fornecedor que precisam aparecer na contraparte
// âncora da data: a INCLUSÃO como aprovado (o pagamento sai perto de quando é
// aprovado, não do vencimento — regra do Yago, 27/10). A saída pode ter ocorrido
// alguns dias antes (aprovação retroativa) ou a partir dali.
const JANELA_ANTES = 7;

// rótulo de banco_pagamento (convenção da Liberação) a partir da conta do extrato
function labelBanco(conta) {
  if (!conta) return null;
  const raiz = soDig(conta.titular_cnpj).slice(0, 8);
  if (conta.banco === 'SICREDI') {
    if (raiz === '17177680') return 'SICREDI CROSBY';
    if (raiz === '27728810') return 'SICREDI FÁBIO';
    if (raiz === '53661116') return 'SICREDI FLAVIO';
    return 'SICREDI CROSBY';
  }
  // STONE: por raiz do CNPJ do titular
  if (raiz === '17177680') return 'STONE CROSBY';
  if (raiz === '27728810') return 'STONE FABIO';
  if (raiz === '53661116') return 'STONE PARNAMIRIM';
  if (raiz === '33592092') return 'STONE CROSBY';
  return 'STONE';
}

/**
 * @param {object} p
 * @param {string} [p.dataSaida]  um dia específico (AAAA-MM-DD); as saídas consideradas são só desse dia
 * @param {string} [p.saidaDe] / [p.saidaAte]  janela de datas das saídas (default: desde 01/09 até hoje)
 * @param {boolean} [p.dryRun]
 * @param {string} [p.usuario]
 */
export async function conciliarAprovados({ dataSaida = null, saidaDe = null, saidaAte = null, dryRun = false, usuario = 'Conciliação de aprovados' } = {}) {
  const hoje = hojeBr();
  const de = dataSaida || saidaDe || '2026-09-01';
  const ate = dataSaida || saidaAte || hoje;

  const { data: contas, error: eC } = await supabase.from('fluxo_caixa_contas').select('id,banco,apelido,titular_cnpj').in('banco', ['STONE', 'SICREDI']);
  if (eC) throw new Error(eC.message);
  const contaById = new Map((contas || []).map((c) => [c.id, c]));
  const contaIds = (contas || []).map((c) => c.id);

  const { data: aprovados, error: eA } = await supabase
    .from('pagamentos_liberacao')
    .select('id,nm_fornecedor,vl_duplicata,vl_real,dt_vencimento,dt_emissao,nm_empresa,banco_pagamento,aprovado_em,aprovado_por,dados_completos')
    .eq('status', 'APROVADO');
  if (eA) throw new Error(eA.message);

  // saídas candidatas no período
  const { data: saidas, error: eS } = await supabase
    .from('fluxo_caixa_lancamentos')
    .select('id,conta_id,data,valor,contraparte_nome,contraparte_doc,memo')
    .in('conta_id', contaIds)
    .lt('valor', 0)
    .is('transferencia_id', null)
    .gte('data', de)
    .lte('data', ate);
  if (eS) throw new Error(eS.message);

  // saídas já conciliadas com título (não reusar)
  const { data: conc } = await supabase.from('fluxo_caixa_conciliacoes').select('lancamento_id,origem');
  const lancUsado = new Set((conc || []).filter((c) => ['LIBERACAO', 'MULTIPLO'].includes(c.origem)).map((c) => c.lancamento_id));

  const usados = new Set();
  const resultados = [];
  // mais antigos primeiro, para o pagamento mais próximo do vencimento casar primeiro
  const ordenados = aprovados.sort((a, b) => (a.dt_vencimento || '').localeCompare(b.dt_vencimento || ''));
  for (const t of ordenados) {
    const V = round2(Math.abs(t.vl_duplicata));
    // janela a partir da inclusão como aprovado (fallback: vencimento)
    const ancora = (t.aprovado_em ? String(t.aprovado_em).slice(0, 10) : null) || t.dt_vencimento || de;
    const limiteAntes = addDias(ancora, -JANELA_ANTES);
    const cand = saidas.filter(
      (l) => Math.abs(round2(Math.abs(l.valor)) - V) < VALOR_TOL && !usados.has(l.id) && !lancUsado.has(l.id) && l.data >= limiteAntes && l.data <= ate,
    );
    const scored = cand
      .map((l) => ({ l, ns: nomeScore(t.nm_fornecedor, l.contraparte_nome || l.memo || ''), dv: Math.abs((new Date(l.data) - new Date(ancora)) / 864e5) }))
      .sort((a, b) => b.ns - a.ns || a.dv - b.dv);
    const top = scored[0];
    if (!top || top.ns < NOME_MIN) continue;
    // ambiguidade: 2+ candidatos empatados em nome em contas/datas diferentes → não decide sozinho
    const bons = scored.filter((x) => x.ns >= NOME_MIN);
    if (bons.length > 1 && bons[1].ns >= top.ns - 0.01 && (bons[0].l.conta_id !== bons[1].l.conta_id || bons[0].l.data !== bons[1].l.data)) continue;

    usados.add(top.l.id);
    const conta = contaById.get(top.l.conta_id);
    const banco = t.banco_pagamento || labelBanco(conta);
    const item = {
      id: t.id,
      fornecedor: t.nm_fornecedor,
      valor: V,
      vencimento: t.dt_vencimento,
      dataPagamento: top.l.data,
      banco,
      conta: conta?.apelido,
      lancamentoId: top.l.id,
      score: round2(top.ns),
    };
    if (!dryRun) {
      const agora = new Date().toISOString();
      const { error: eU } = await supabase
        .from('pagamentos_liberacao')
        .update({
          status: 'PAGO',
          banco_pagamento: banco,
          dt_pagamento: top.l.data,
          vl_real: round2(Math.abs(top.l.valor)),
          pago_em: agora,
          pago_por: usuario,
          aprovado_em: t.aprovado_em || agora,
          aprovado_por: t.aprovado_por || usuario,
        })
        .eq('id', t.id);
      if (eU) {
        item.erro = eU.message;
        resultados.push(item);
        continue;
      }
      // concilia a linha do extrato contra este título (liga comprovante → solicitação quando há)
      try {
        await salvarConciliacao({
          lancamentoId: top.l.id,
          origem: 'LIBERACAO',
          referencia: { id: t.id, nome: t.nm_fornecedor, valor: V, valorDuplicata: V, data: top.l.data, vencimento: t.dt_vencimento, empresa: t.nm_empresa, detalhe: 'aprovado pago', motivos: ['conciliação de aprovados'] },
          justificativa: `${t.nm_fornecedor} · aprovado pago (conciliação automática)`,
          usuario,
          automatico: true,
        });
        item.conciliado = true;
      } catch (e) {
        item.avisoConciliacao = e.message;
      }
    }
    resultados.push(item);
  }

  const total = round2(resultados.filter((r) => !r.erro).reduce((a, r) => a + r.valor, 0));
  return { periodo: { de, ate }, aprovadosAnalisados: aprovados.length, pagos: resultados.filter((r) => !r.erro).length, erros: resultados.filter((r) => r.erro).length, total, resultados, dryRun };
}

export function resumoTexto(r) {
  const linhas = [`${r.dryRun ? '[simulação] ' : ''}Conciliação de aprovados (${r.periodo.de} a ${r.periodo.ate}): ${r.pagos} de ${r.aprovadosAnalisados} marcado(s) como pago, ${fmt(r.total)}.`];
  for (const x of r.resultados) linhas.push(`  • ${x.fornecedor} — ${fmt(x.valor)} · ${x.banco} · pago ${x.dataPagamento}${x.erro ? ` · ERRO ${x.erro}` : ''}`);
  return linhas.join('\n');
}

export default { conciliarAprovados, resumoTexto };
