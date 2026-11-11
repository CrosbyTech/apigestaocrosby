// ============================================================
// CONCILIAÇÃO ↔ CONTAS A PAGAR (Consulta) ↔ LIBERAÇÃO DE PAGAMENTO
// Pedido do Yago, 09/11/2026: as três telas precisam conversar.
//
// 1) Saída CONCILIADA (tela /conciliacao, automática ou manual) com uma ou
//    mais duplicatas (TOTVS_CP, LIBERACAO, SOLICITACAO ou MULTIPLO):
//    - a duplicata vira "PAGO VIA CONCILIAÇÃO" na Contas a Pagar - Consulta,
//      com data de liquidação (= data da saída) e valor pago
//      → tabela derivada contas_pagar_pagos_conciliacao (o front lê);
//    - se ela estiver em APROVADOS na Liberação, vai para PAGO (data, valor,
//      banco = conta do extrato).
// 2) Liberação marcada PAGO (tela, à mão) → procura a SAÍDA no extrato
//    (mesmo valor, data ±5 dias, nome/CNPJ do fornecedor) e concilia sozinho
//    (conciliarLiberacaoPagos). A Consulta já mostrava esses como
//    "PAGO - LIBERAÇÃO DE PAGAMENTO".
// Nada é baixado no TOTVS: é marcação do HeadCoach.
// ============================================================
import supabase from '../config/supabase.js';
import { labelBanco, nomeScore } from './conciliacaoAprovados.js';

const T = { conc: 'fluxo_caixa_conciliacoes', lanc: 'fluxo_caixa_lancamentos', lib: 'pagamentos_liberacao', sol: 'solicitacoes_crosby', pagos: 'contas_pagar_pagos_conciliacao' };
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const soDig = (v) => String(v ?? '').replace(/\D/g, '');
const int = (v) => {
  const n = parseInt(soDig(v), 10);
  return Number.isFinite(n) ? n : null;
};
const addDias = (iso, n) => {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
let tabelaPagosOk = true; // vira false se a migration ainda não rodou

const ORIGENS_CP = new Set(['TOTVS_CP', 'LIBERACAO', 'SOLICITACAO']);

/** Itens (origem, id, valor) cobertos por uma conciliação gravada. */
function itensDaConciliacao(conc) {
  const ref = conc.referencia || {};
  if (Array.isArray(ref.itens) && ref.itens.length) {
    return ref.itens
      .filter((it) => ORIGENS_CP.has(it.origem) && it.id != null)
      .map((it) => ({ origem: it.origem, id: it.id, valor: round2(Math.abs(Number(it.valorUsado ?? it.valor ?? 0))) }));
  }
  if (ORIGENS_CP.has(conc.origem) && ref.id != null) return [{ origem: conc.origem, id: ref.id, valor: round2(Math.abs(Number(conc.valor))) }];
  return [];
}

/** Resolve cada item em duplicata do TOTVS e/ou linha da Liberação. */
async function resolverItens(itens) {
  const libIds = itens.filter((i) => i.origem === 'LIBERACAO').map((i) => i.id);
  const solIds = itens.filter((i) => i.origem === 'SOLICITACAO').map((i) => i.id);
  const sols = solIds.length ? (await supabase.from(T.sol).select('id,duplicate_code,cd_empresa,pagamento_liberacao_id').in('id', solIds)).data || [] : [];
  const libIdsTodos = [...new Set([...libIds, ...sols.map((s) => s.pagamento_liberacao_id).filter(Boolean)])];
  const libs = libIdsTodos.length ? (await supabase.from(T.lib).select('id,status,cd_empresa,nr_duplicata,nr_parcela,cd_fornecedor').in('id', libIdsTodos)).data || [] : [];
  const libDe = new Map(libs.map((l) => [String(l.id), l]));
  const solDe = new Map(sols.map((s) => [String(s.id), s]));
  return itens.map((it) => {
    if (it.origem === 'TOTVS_CP') {
      const [b, d, p, f] = String(it.id).split('|');
      return { ...it, dup: { cd_empresa: int(b), nr_duplicata: int(d), nr_parcela: int(p), cd_fornecedor: int(f) }, libId: null };
    }
    if (it.origem === 'LIBERACAO') {
      const l = libDe.get(String(it.id));
      return { ...it, dup: l && l.nr_duplicata ? { cd_empresa: int(l.cd_empresa), nr_duplicata: int(l.nr_duplicata), nr_parcela: int(l.nr_parcela), cd_fornecedor: int(l.cd_fornecedor) } : null, libId: it.id };
    }
    const s = solDe.get(String(it.id));
    const l = s?.pagamento_liberacao_id ? libDe.get(String(s.pagamento_liberacao_id)) : null;
    const dup = l?.nr_duplicata
      ? { cd_empresa: int(l.cd_empresa), nr_duplicata: int(l.nr_duplicata), nr_parcela: int(l.nr_parcela), cd_fornecedor: int(l.cd_fornecedor) }
      : s?.duplicate_code
        ? { cd_empresa: int(s.cd_empresa), nr_duplicata: int(s.duplicate_code), nr_parcela: null, cd_fornecedor: null }
        : null;
    return { ...it, dup, libId: s?.pagamento_liberacao_id || null };
  });
}

/**
 * Completa parcela/fornecedor pela cópia do TOTVS (accounts_payable_duplicates)
 * quando a Liberação/Solicitação não os tem — sem eles a Consulta não consegue
 * casar e o título seguia EM ABERTO (auditoria da Titia, 11/11/2026). Casa por
 * empresa + duplicata; com mais de uma parcela, escolhe pelo valor.
 */
async function completarPelaCopiaTotvs(resolvidos) {
  const falta = resolvidos.filter((r) => r.dup?.nr_duplicata && r.dup.nr_parcela == null && r.dup.cd_fornecedor == null);
  if (!falta.length) return resolvidos;
  const dups = [...new Set(falta.map((r) => r.dup.nr_duplicata))];
  const linhas = [];
  for (let i = 0; i < dups.length; i += 200) {
    const { data } = await supabase.from('accounts_payable_duplicates').select('branch_code,duplicate_code,installment_code,supplier_code,duplicate_value').in('duplicate_code', dups.slice(i, i + 200));
    linhas.push(...(data || []));
  }
  for (const r of falta) {
    let cand = linhas.filter((l) => Number(l.duplicate_code) === Number(r.dup.nr_duplicata) && (r.dup.cd_empresa == null || Number(l.branch_code) === Number(r.dup.cd_empresa)));
    if (cand.length > 1) {
      const porValor = cand.filter((l) => Math.abs(round2(l.duplicate_value) - round2(r.valor)) <= 0.05);
      if (porValor.length) cand = porValor;
    }
    if (cand.length !== 1) continue;
    const c = cand[0];
    r.dup = { ...r.dup, cd_empresa: r.dup.cd_empresa ?? int(c.branch_code), nr_parcela: int(c.installment_code), cd_fornecedor: int(c.supplier_code) };
  }
  return resolvidos;
}

/** APROVADOS da Liberação que são estas duplicatas (pelo id ou pela duplicata). */
async function aprovadosDe(resolvidos) {
  const porId = resolvidos.map((r) => r.libId).filter(Boolean);
  const dups = resolvidos.map((r) => r.dup).filter((d) => d?.nr_duplicata);
  const out = new Map();
  if (porId.length) {
    const { data } = await supabase.from(T.lib).select('id,status,vl_real,vl_duplicata,cd_empresa,nr_duplicata,nr_parcela,cd_fornecedor').in('id', porId).eq('status', 'APROVADO');
    for (const l of data || []) out.set(String(l.id), l);
  }
  if (dups.length) {
    const { data } = await supabase
      .from(T.lib)
      .select('id,status,vl_real,vl_duplicata,cd_empresa,nr_duplicata,nr_parcela,cd_fornecedor')
      .eq('status', 'APROVADO')
      .in('nr_duplicata', [...new Set(dups.map((d) => String(d.nr_duplicata)))]);
    for (const l of data || []) {
      // null = falta num dos lados; senão igual/diferente. Parcela diferente
      // NUNCA casa (2 parcelas do mesmo fornecedor na mesma duplicata).
      const cmp = (x, y) => (x == null || y == null ? null : Number(x) === Number(y));
      const casa = dups.some((d) => {
        if (String(d.nr_duplicata) !== String(l.nr_duplicata)) return false;
        if (cmp(d.cd_empresa, l.cd_empresa) === false) return false;
        const parc = cmp(d.nr_parcela, l.nr_parcela);
        const forn = cmp(d.cd_fornecedor, l.cd_fornecedor);
        if (parc === false || forn === false) return false;
        return parc === true || forn === true;
      });
      if (casa) out.set(String(l.id), l);
    }
  }
  return out;
}

/**
 * Depois de gravar uma conciliação: marca a(s) duplicata(s) como pagas para a
 * Consulta e leva os APROVADOS da Liberação para PAGO. Idempotente.
 */
export async function propagarConciliacao(conc) {
  const itens = itensDaConciliacao(conc);
  const res = { conciliacaoId: conc.id, duplicatas: 0, liberacaoPagos: 0 };
  await removerPagosDaConciliacao(conc.id);
  if (!itens.length || Number(conc.valor) >= 0) return res;
  const resolvidos = await completarPelaCopiaTotvs(await resolverItens(itens));
  const { data: conta } = await supabase.from('fluxo_caixa_contas').select('banco,apelido,titular_cnpj').eq('id', conc.conta_id).maybeSingle();
  const banco = labelBanco(conta) || conta?.apelido || conta?.banco || null;

  // 1) Consulta do contas a pagar
  const linhas = resolvidos
    .filter((r) => r.dup?.nr_duplicata && r.dup.cd_empresa != null)
    .map((r) => ({
      conciliacao_id: conc.id,
      cd_empresa: r.dup.cd_empresa,
      nr_duplicata: r.dup.nr_duplicata,
      nr_parcela: r.dup.nr_parcela,
      cd_fornecedor: r.dup.cd_fornecedor,
      dt_pagamento: conc.data,
      vl_pago: r.valor,
      banco,
      origem: r.origem,
    }));
  if (linhas.length && tabelaPagosOk) {
    const { error } = await supabase.from(T.pagos).insert(linhas);
    if (error) {
      if (/does not exist|schema cache|Could not find the table/i.test(error.message)) {
        tabelaPagosOk = false;
        console.warn('[conciliacao→CP] tabela contas_pagar_pagos_conciliacao não existe — rode migrations/contas_pagar_pagos_conciliacao.sql');
      } else console.warn('[conciliacao→CP]', error.message);
    } else res.duplicatas = linhas.length;
  }

  // 2) APROVADOS da Liberação → PAGO
  const aprov = await aprovadosDe(resolvidos);
  const agora = new Date().toISOString();
  for (const l of aprov.values()) {
    const r = resolvidos.find((x) => String(x.libId) === String(l.id)) || resolvidos.find((x) => x.dup && String(x.dup.nr_duplicata) === String(l.nr_duplicata));
    const { error } = await supabase
      .from(T.lib)
      .update({
        status: 'PAGO',
        dt_pagamento: conc.data,
        pago_em: agora,
        pago_por: conc.usuario ? `conciliação (${conc.usuario})` : 'conciliação',
        ...(l.vl_real == null && r?.valor ? { vl_real: r.valor } : {}),
        ...(banco ? { banco_pagamento: banco } : {}),
      })
      .eq('id', l.id)
      .eq('status', 'APROVADO');
    if (!error) res.liberacaoPagos += 1;
    else console.warn(`[conciliacao→Liberação] ${l.id}: ${error.message}`);
  }
  return res;
}

/** Conciliação desfeita: some da Consulta (a Liberação não volta sozinha). */
export async function removerPagosDaConciliacao(conciliacaoId) {
  if (!tabelaPagosOk || conciliacaoId == null) return;
  const { error } = await supabase.from(T.pagos).delete().eq('conciliacao_id', conciliacaoId);
  if (error && /does not exist|schema cache|Could not find the table/i.test(error.message)) tabelaPagosOk = false;
}

/** Recalcula a Consulta a partir de TODAS as conciliações (1ª carga). */
export async function sincronizarTodas({ de = '2026-01-01' } = {}) {
  let from = 0;
  const tot = { conciliacoes: 0, duplicatas: 0, liberacaoPagos: 0 };
  for (;;) {
    const { data, error } = await supabase.from(T.conc).select('id,conta_id,data,valor,origem,referencia,usuario').gte('data', de).lt('valor', 0).in('origem', ['TOTVS_CP', 'LIBERACAO', 'SOLICITACAO', 'MULTIPLO']).order('id').range(from, from + 499);
    if (error) throw new Error(error.message);
    for (const c of data || []) {
      const r = await propagarConciliacao(c);
      tot.conciliacoes += 1;
      tot.duplicatas += r.duplicatas;
      tot.liberacaoPagos += r.liberacaoPagos;
    }
    if (!data || data.length < 500) break;
    from += 500;
  }
  return tot;
}

/**
 * Liberação PAGO → concilia a saída do extrato sozinho.
 * Para cada título PAGO que nenhuma conciliação usa ainda: saídas de mesmo
 * valor (vl_real ?? vl_duplicata, ±0,01) entre dt_pagamento−5 e +5 dias, ainda
 * não conciliadas. Grava quando sobra UMA (ou uma só com nome/CNPJ do
 * fornecedor batendo); senão fica para a tela (ambíguo).
 */
export async function conciliarLiberacaoPagos({ ids = null, dias = 15, usuario = 'Liberação PAGO → conciliação', simular = false } = {}) {
  const { salvarConciliacao, usadosTotais, referenciaDe, lancamentoComChave } = await import('./fluxoCaixaConciliacao.js');
  let q = supabase
    .from(T.lib)
    .select('id,cd_empresa,nm_empresa,nm_fornecedor,cd_fornecedor,vl_duplicata,vl_real,dt_vencimento,dt_pagamento,pago_em,status,forma_pagamento,chave_pix,banco_pagamento,nr_duplicata,nr_parcela,ds_despesaitem,dados_completos')
    .eq('status', 'PAGO');
  if (ids?.length) q = q.in('id', ids);
  else q = q.gte('dt_pagamento', addDias(new Date().toISOString().slice(0, 10), -dias));
  const { data: libs, error } = await q.limit(2000);
  if (error) throw new Error(error.message);
  const usados = await usadosTotais();
  const out = { analisados: 0, conciliados: [], ambiguos: [], semSaida: 0 };
  const usadosAgora = new Set();
  for (const l of libs || []) {
    const alvo = round2(l.vl_real ?? Math.abs(Number(l.vl_duplicata)));
    if (!(alvo > 0) || !l.dt_pagamento) continue;
    if ((usados.get(`LIBERACAO:${l.id}`) || 0) >= alvo - 0.011) continue; // já conciliado
    out.analisados += 1;
    const { data: saidas } = await supabase
      .from(T.lanc)
      .select('id,conta_id,data,valor,contraparte_nome,contraparte_doc,descricao,memo,transferencia_id,tipo')
      .gte('valor', -(alvo + 0.011))
      .lte('valor', -(alvo - 0.011))
      .gte('data', addDias(l.dt_pagamento, -5))
      .lte('data', addDias(l.dt_pagamento, 5))
      .is('transferencia_id', null)
      .limit(50);
    const ids2 = (saidas || []).map((s) => s.id).filter((id) => !usadosAgora.has(id));
    if (!ids2.length) {
      out.semSaida += 1;
      continue;
    }
    // "já conciliada" pela CHAVE estável (o id do lançamento muda quando o extrato é reimportado)
    const jaConc = new Set();
    for (const s of (saidas || []).filter((x) => ids2.includes(x.id))) {
      try {
        const { chave } = await lancamentoComChave(s.id);
        if (!chave) continue;
        const { data: c } = await supabase.from(T.conc).select('id').eq('chave', chave).maybeSingle();
        if (c) jaConc.add(s.id);
      } catch {
        jaConc.add(s.id);
      }
    }
    const livres = (saidas || []).filter((s) => ids2.includes(s.id) && !jaConc.has(s.id) && s.tipo !== 'TRANSFERENCIA');
    if (!livres.length) {
      out.semSaida += 1;
      continue;
    }
    const docForn = soDig(l.dados_completos?.nr_cpfcnpj_fornecedor) || null;
    const pont = (s) => {
      if (docForn && soDig(s.contraparte_doc) === docForn) return 1;
      return nomeScore(l.nm_fornecedor, s.contraparte_nome || s.descricao || s.memo || '');
    };
    const ord = livres.map((s) => ({ s, p: pont(s), dist: Math.abs(new Date(s.data) - new Date(l.dt_pagamento)) })).sort((a, b) => b.p - a.p || a.dist - b.dist);
    let escolhido = null;
    if (ord.length === 1 && ord[0].p >= 0.34) escolhido = ord[0].s;
    else if (ord[0].p >= 0.6 && (ord.length === 1 || ord[1].p < 0.6)) escolhido = ord[0].s;
    if (!escolhido) {
      out.ambiguos.push({ liberacaoId: l.id, fornecedor: l.nm_fornecedor, valor: alvo, dtPagamento: l.dt_pagamento, saidas: ord.slice(0, 4).map((o) => ({ id: o.s.id, data: o.s.data, nome: o.s.contraparte_nome, nota: round2(o.p) })) });
      continue;
    }
    const item = {
      id: l.id,
      nome: l.nm_fornecedor,
      doc: docForn,
      valor: alvo,
      valorDuplicata: alvo,
      data: l.dt_pagamento,
      vencimento: l.dt_vencimento,
      empresa: l.nm_empresa,
      detalhe: [l.ds_despesaitem, l.forma_pagamento, l.banco_pagamento ? `banco ${l.banco_pagamento}` : null, l.nr_duplicata ? `dup ${l.nr_duplicata}${l.nr_parcela ? `/${l.nr_parcela}` : ''}` : null].filter(Boolean).join(' · '),
      duplicata: l.nr_duplicata ? `${l.nr_duplicata}|${l.nr_parcela ?? ''}` : null,
      motivos: ['Liberação marcada PAGO', 'mesmo valor', 'data ±5 dias'],
    };
    try {
      if (!simular) await salvarConciliacao({ lancamentoId: escolhido.id, origem: 'LIBERACAO', referencia: referenciaDe(item), usuario, automatico: true, pontuacao: Math.round(pont(escolhido) * 100) });
      usadosAgora.add(escolhido.id);
      out.conciliados.push({ liberacaoId: l.id, fornecedor: l.nm_fornecedor, valor: alvo, saida: { id: escolhido.id, data: escolhido.data } });
    } catch (e) {
      out.ambiguos.push({ liberacaoId: l.id, fornecedor: l.nm_fornecedor, valor: alvo, erro: e.message });
    }
  }
  return out;
}

export default { propagarConciliacao, removerPagosDaConciliacao, sincronizarTodas, conciliarLiberacaoPagos };
