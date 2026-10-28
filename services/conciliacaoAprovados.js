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
// apelidos de concessionárias: a marca no extrato × a razão social no título.
// Cada regra injeta um token canônico nos dois lados quando o nome casa.
// regex testadas contra o nome JÁ NORMALIZADO (sem DO/DA/DE/E, maiúsculo)
const APELIDOS = [
  { re: /COSERN|COMENER|ENERGETICA.*RIO GRANDE.*NORTE|ENERGETICA.*\bRN\b/, tok: 'ENERGIARN' },
  { re: /ENERGISA/, tok: 'ENERGISA' },
  { re: /EQUATORIAL/, tok: 'EQUATORIAL' },
  { re: /NEOENERGIA|CELPE/, tok: 'NEOENERGIA' },
  { re: /CAGEPA|AGUA.*ESGOTO.*PARAIBA/, tok: 'CAGEPA' },
  { re: /CAERN|AGUA.*ESGOTO.*RIO GRANDE.*NORTE|AGUA.*ESGOTO.*\bRN\b/, tok: 'AGUARN' },
  { re: /COMPESA/, tok: 'AGUAPE' },
  { re: /CLARO/, tok: 'CLARO' },
  { re: /\bVIVO\b|TELEFONICA/, tok: 'VIVO' },
  { re: /\bTIM\b/, tok: 'TIM' },
  { re: /BRISANET/, tok: 'BRISANET' },
];
function tokensNome(s) {
  const norm = normNome(s);
  const set = new Set(norm.split(' ').filter((t) => t.length > 2));
  for (const a of APELIDOS) if (a.re.test(norm)) set.add(a.tok);
  return set;
}
function nomeScore(a, b) {
  const A = tokensNome(a);
  const B = tokensNome(b);
  if (!A.size || !B.size) return 0;
  // apelido canônico em comum já basta (COSERN × "COMPANHIA ENERGETICA DO RN")
  for (const al of APELIDOS) if (A.has(al.tok) && B.has(al.tok)) return 1;
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

  const { data: aprovados0, error: eA } = await supabase
    .from('pagamentos_liberacao')
    .select('id,nm_fornecedor,vl_duplicata,vl_real,dt_vencimento,dt_emissao,nm_empresa,banco_pagamento,aprovado_em,aprovado_por,dados_completos')
    .eq('status', 'APROVADO');
  if (eA) throw new Error(eA.message);
  // VALOR REAL (vl_real) é o que o Yago pagou de fato — quando preenchido, é o
  // valor a procurar no extrato (pode diferir da duplicata: juros/desconto).
  // vl_real = 0 explícito = não foi pago → fica de fora.
  const valorAlvo = (t) => (t.vl_real != null ? round2(Number(t.vl_real)) : round2(Math.abs(t.vl_duplicata)));
  const aprovados = aprovados0.filter((t) => valorAlvo(t) > VALOR_TOL);

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
  const agora = () => new Date().toISOString();
  const janelaOk = (t, l) => {
    const ancora = (t.aprovado_em ? String(t.aprovado_em).slice(0, 10) : null) || t.dt_vencimento || de;
    return l.data >= addDias(ancora, -JANELA_ANTES) && l.data <= ate;
  };

  // marca um título como PAGO; só grava a conciliação quando ÚNICO (1:1). Em grupo,
  // a conciliação MULTIPLO é gravada uma vez com todos os títulos.
  async function pagarTitulo(t, l, conta, valorReal) {
    const banco = labelBanco(conta);
    const { error } = await supabase
      .from('pagamentos_liberacao')
      .update({ status: 'PAGO', banco_pagamento: banco, dt_pagamento: l.data, vl_real: valorReal, pago_em: agora(), pago_por: usuario, aprovado_em: t.aprovado_em || agora(), aprovado_por: t.aprovado_por || usuario })
      .eq('id', t.id);
    return { banco, error };
  }

  // ── passo 1: 1 título ↔ 1 saída (valor exato) ──
  const ordenados = aprovados.slice().sort((a, b) => (a.dt_vencimento || '').localeCompare(b.dt_vencimento || ''));
  const pagos1 = new Set();
  for (const t of ordenados) {
    const V = valorAlvo(t);
    const cand = saidas.filter((l) => Math.abs(round2(Math.abs(l.valor)) - V) < VALOR_TOL && !usados.has(l.id) && !lancUsado.has(l.id) && janelaOk(t, l));
    const ancora = (t.aprovado_em ? String(t.aprovado_em).slice(0, 10) : null) || t.dt_vencimento || de;
    const scored = cand
      .map((l) => ({ l, ns: nomeScore(t.nm_fornecedor, l.contraparte_nome || l.memo || ''), dv: Math.abs((new Date(l.data) - new Date(ancora)) / 864e5) }))
      .sort((a, b) => b.ns - a.ns || a.dv - b.dv);
    const top = scored[0];
    if (!top || top.ns < NOME_MIN) continue;
    const bons = scored.filter((x) => x.ns >= NOME_MIN);
    if (bons.length > 1 && bons[1].ns >= top.ns - 0.01 && (bons[0].l.conta_id !== bons[1].l.conta_id || bons[0].l.data !== bons[1].l.data)) continue;
    usados.add(top.l.id);
    pagos1.add(t.id);
    const conta = contaById.get(top.l.conta_id);
    const item = { id: t.id, fornecedor: t.nm_fornecedor, valor: V, vencimento: t.dt_vencimento, dataPagamento: top.l.data, banco: labelBanco(conta), conta: conta?.apelido, lancamentoId: top.l.id, score: round2(top.ns), tipo: 'individual' };
    if (!dryRun) {
      const r = await pagarTitulo(t, top.l, conta, t.vl_real != null ? round2(Number(t.vl_real)) : round2(Math.abs(top.l.valor)));
      if (r.error) {
        item.erro = r.error.message;
        resultados.push(item);
        continue;
      }
      try {
        await salvarConciliacao({ lancamentoId: top.l.id, origem: 'LIBERACAO', referencia: { id: t.id, nome: t.nm_fornecedor, valor: V, valorDuplicata: V, data: top.l.data, vencimento: t.dt_vencimento, empresa: t.nm_empresa, detalhe: 'aprovado pago', motivos: ['conciliação de aprovados'] }, justificativa: `${t.nm_fornecedor} · aprovado pago (conciliação automática)`, usuario, automatico: true });
        item.conciliado = true;
      } catch (e) {
        item.avisoConciliacao = e.message;
      }
    }
    resultados.push(item);
  }

  // ── passo 2: 1 saída = SOMA de 2+ duplicatas do MESMO fornecedor (valor exato) ──
  const sugestoes = [];
  const restantes = ordenados.filter((t) => !pagos1.has(t.id));
  const grupos = new Map(); // chave fornecedor → títulos
  for (const t of restantes) {
    const chave = soDig(t.cd_fornecedor) || normNome(t.nm_fornecedor);
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(t);
  }
  for (const titulos of grupos.values()) {
    if (titulos.length < 2 || titulos.length > 16) {
      if (titulos.length > 16) sugestoes.push({ tipo: 'grupo grande', fornecedor: titulos[0].nm_fornecedor, titulos: titulos.length });
      continue;
    }
    // saídas candidatas do fornecedor (nome bate), não usadas, na janela de algum título
    const vals = titulos.map((t) => valorAlvo(t));
    const somaTudo = round2(vals.reduce((a, v) => a + v, 0));
    const cand = saidas.filter(
      (l) => !usados.has(l.id) && !lancUsado.has(l.id) && nomeScore(titulos[0].nm_fornecedor, l.contraparte_nome || l.memo || '') >= NOME_MIN && titulos.some((t) => janelaOk(t, l)) && round2(Math.abs(l.valor)) <= round2(somaTudo * 1.1) + 1,
    );
    for (const l of cand) {
      const alvo = round2(Math.abs(l.valor));
      // subsets que somam exatamente o valor da saída
      const achados = [];
      for (let mask = 1; mask < 1 << titulos.length; mask++) {
        let soma = 0;
        for (let i = 0; i < titulos.length; i++) if (mask & (1 << i)) soma += vals[i];
        if (Math.abs(round2(soma) - alvo) < 0.02) achados.push(mask);
      }
      if (achados.length === 1) {
        // subset único soma EXATA → concilia o grupo
        const mask = achados[0];
        const sel = titulos.filter((_, i) => mask & (1 << i));
        usados.add(l.id);
        for (const t of sel) pagos1.add(t.id);
        const conta = contaById.get(l.conta_id);
        const banco = labelBanco(conta);
        if (!dryRun) {
          let okAll = true;
          for (const t of sel) {
            const r = await pagarTitulo(t, l, conta, t.vl_real != null ? round2(Number(t.vl_real)) : round2(Math.abs(t.vl_duplicata)));
            if (r.error) okAll = false;
          }
          try {
            await salvarConciliacao({
              lancamentoId: l.id,
              origem: 'LIBERACAO',
              referencia: { itens: sel.map((t) => ({ origem: 'LIBERACAO', id: t.id, nome: t.nm_fornecedor, valor: valorAlvo(t), valorDuplicata: valorAlvo(t), vencimento: t.dt_vencimento, empresa: t.nm_empresa, detalhe: 'aprovado pago (soma)' })) },
              justificativa: `${sel[0].nm_fornecedor} · ${sel.length} duplicatas pagas juntas (conciliação automática)`,
              usuario,
              automatico: true,
            });
          } catch (e) {
            /* conciliação MULTIPLO opcional */
          }
          void okAll;
        }
        resultados.push({ tipo: 'grupo', fornecedor: sel[0].nm_fornecedor, valor: round2(Math.abs(l.valor)), dataPagamento: l.data, banco, conta: conta?.apelido, lancamentoId: l.id, titulos: sel.map((t) => ({ id: t.id, valor: valorAlvo(t), vencimento: t.dt_vencimento })) });
      }
    }
    // sugestão: saída ≈ soma do grupo + extra (provável juros/multa) — não aplica, só reporta
    const restaDoGrupo = titulos.filter((t) => !pagos1.has(t.id));
    if (restaDoGrupo.length >= 1) {
      const somaResta = round2(restaDoGrupo.reduce((a, t) => a + valorAlvo(t), 0));
      const perto = saidas.find(
        (l) => !usados.has(l.id) && !lancUsado.has(l.id) && nomeScore(restaDoGrupo[0].nm_fornecedor, l.contraparte_nome || l.memo || '') >= NOME_MIN && restaDoGrupo.some((t) => janelaOk(t, l)) && round2(Math.abs(l.valor)) > somaResta + 0.02 && round2(Math.abs(l.valor)) <= round2(somaResta * 1.08) + 1,
      );
      if (perto) {
        const conta = contaById.get(perto.conta_id);
        sugestoes.push({
          tipo: 'soma + juros?',
          fornecedor: restaDoGrupo[0].nm_fornecedor,
          saida: round2(Math.abs(perto.valor)),
          somaDuplicatas: somaResta,
          diferenca: round2(Math.abs(perto.valor) - somaResta),
          data: perto.data,
          conta: conta?.apelido,
          banco: labelBanco(conta),
          titulos: restaDoGrupo.map((t) => ({ id: t.id, valor: valorAlvo(t), vencimento: t.dt_vencimento })),
        });
      }
    }
  }

  const total = round2(resultados.filter((r) => !r.erro).reduce((a, r) => a + r.valor, 0));
  const pagos = resultados.filter((r) => !r.erro).reduce((n, r) => n + (r.tipo === 'grupo' ? r.titulos.length : 1), 0);
  return { periodo: { de, ate }, aprovadosAnalisados: aprovados.length, pagos, individuais: resultados.filter((r) => r.tipo === 'individual' && !r.erro).length, grupos: resultados.filter((r) => r.tipo === 'grupo').length, erros: resultados.filter((r) => r.erro).length, total, resultados, sugestoes, dryRun };
}

export function resumoTexto(r) {
  const linhas = [`${r.dryRun ? '[simulação] ' : ''}Conciliação de aprovados (${r.periodo.de} a ${r.periodo.ate}): ${r.pagos} título(s) marcado(s) como pago (${r.individuais} individual(is) + ${r.grupos} por soma), ${fmt(r.total)}.`];
  for (const x of r.resultados) {
    if (x.tipo === 'grupo') linhas.push(`  • [soma] ${x.fornecedor} — ${fmt(x.valor)} · ${x.banco} · pago ${x.dataPagamento} · ${x.titulos.length} duplicatas (${x.titulos.map((t) => fmt(t.valor)).join(' + ')})`);
    else linhas.push(`  • ${x.fornecedor} — ${fmt(x.valor)} · ${x.banco} · pago ${x.dataPagamento}${x.erro ? ` · ERRO ${x.erro}` : ''}`);
  }
  if (r.sugestoes?.length) {
    linhas.push(`\nRevisar manualmente (saída ≈ soma + extra, provável juros):`);
    for (const sug of r.sugestoes.filter((s) => s.tipo === 'soma + juros?')) linhas.push(`  ? ${sug.fornecedor} — saiu ${fmt(sug.saida)} em ${sug.data} (${sug.conta}); ${sug.titulos.length} duplicatas somam ${fmt(sug.somaDuplicatas)} · diferença ${fmt(sug.diferenca)}`);
  }
  return linhas.join('\n');
}

export default { conciliarAprovados, resumoTexto };
