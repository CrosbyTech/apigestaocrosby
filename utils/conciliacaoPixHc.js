// ============================================================
// Pix recebido × venda em Pix do PDV Crosby (contas a receber do HeadCoach)
//
// Regra do Yago (27/11/2026) para o Pix da maquininha: LOJA + VALOR + DIA DA
// VENDA. Nome não entra: o cliente paga da conta de outra pessoa e o nome do
// extrato não bate com o cadastro. A venda do PDV Crosby não guarda nenhum
// identificador do Pix, então não há o que comparar além disso.
//
// · mesma loja, valor igual ao centavo e mesmo dia → 80 pontos (concilia
//   sozinho, a não ser que exista um título do TOTVS igualmente provável)
// · 1 dia de diferença → 55 pontos (aparece para conferir, não concilia só)
// · Pix que não é da maquininha → no máximo 60 (aparece para conferir)
// Duas vendas de mesmo valor na mesma loja e no mesmo dia são equivalentes
// (semNome): a primeira linha do extrato usa uma, a seguinte usa a outra.
// ============================================================

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const VALOR_TOL = 0.011;

export const ORIGEM_HC_CR = 'HC_CR';
export const PONTOS_MESMO_DIA = 80;
export const PONTOS_UM_DIA = 55;
export const PONTOS_FORA_MAQUININHA = 60;

// dia da venda no fuso das lojas (UTC−3)
export function diaDaVenda(t) {
  if (t?.criado_em) {
    const d = new Date(t.criado_em);
    if (!Number.isNaN(d.getTime())) return new Date(d.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  }
  return t?.emissao ? String(t.emissao).slice(0, 10) : null;
}

const diffDias = (a, b) => Math.round((new Date(`${a}T12:00:00Z`) - new Date(`${b}T12:00:00Z`)) / 864e5);

/** Título Pix do contas a receber do HeadCoach → candidato da Conciliação. */
export function candidatoDoTitulo(t) {
  const dia = diaDaVenda(t);
  const nf = t.nf_numero ? `NF ${t.nf_numero}` : null;
  return {
    origem: ORIGEM_HC_CR,
    id: String(t.id),
    branch: Number(t.empresa),
    valor: round2(t.valor),
    valorPago: null,
    data: dia,
    emissao: t.emissao ? String(t.emissao).slice(0, 10) : dia,
    nome: t.cliente_nome || null,
    doc: String(t.cliente_cpf_cnpj || '').replace(/\D/g, '') || null,
    empresa: `Empresa ${t.empresa}`,
    detalhe: ['Pix · PDV Crosby (HeadCoach)', t.venda_id ? `venda ${t.venda_id}` : null, nf, `vendido em ${dia}`].filter(Boolean).join(' · '),
    duplicata: `${t.fatura}|${t.parcela}`,
    vencimento: t.vencimento ? String(t.vencimento).slice(0, 10) : null,
    semNome: true,
    hcCr: { tituloId: Number(t.id), vendaId: t.venda_id ?? null, fatura: t.fatura, parcela: t.parcela, nf: t.nf_numero ?? null, nfModelo: t.nf_modelo ?? null, vendedor: t.vendedor_nome || null, canal: t.origem || null, emissao: t.emissao ? String(t.emissao).slice(0, 10) : null },
  };
}

/**
 * Pontua a venda do PDV Crosby para a linha de Pix do extrato.
 * `l.filiaisConta` = empresas da conta (a loja); `l.pixMaquininha` = linha de Pix da maquininha.
 */
export function pontuarPixHc(l, c, usado = 0) {
  if (c?.origem !== ORIGEM_HC_CR) return null;
  const valorL = round2(Math.abs(Number(l.valor)));
  if (Math.abs(c.valor - valorL) > VALOR_TOL) return null;
  if (usado > VALOR_TOL) return null; // venda já conciliada com outra linha
  const lojas = Array.isArray(l.filiaisConta) ? l.filiaisConta.map(Number) : [];
  if (!lojas.includes(Number(c.branch))) return null; // outra loja não é candidata
  if (!c.data || !l.data) return null;
  const d = Math.abs(diffDias(c.data, String(l.data).slice(0, 10)));
  if (d > 1) return null;
  const motivos = ['mesma loja', 'valor igual', d === 0 ? 'mesmo dia da venda' : '1 dia de diferença da venda'];
  let score = d === 0 ? PONTOS_MESMO_DIA : PONTOS_UM_DIA;
  if (!l.pixMaquininha && score > PONTOS_FORA_MAQUININHA) {
    score = PONTOS_FORA_MAQUININHA;
    motivos.push('Pix fora da maquininha: confira');
  }
  return { ...c, score, motivos, parcial: false, valorDuplicata: c.valor, restanteAntes: c.valor, restanteDepois: 0 };
}

export function candidatosPixHc(l, itens, usados = new Map()) {
  const lista = [];
  for (const c of itens || []) {
    const p = pontuarPixHc(l, c, usados.get(`${c.origem}:${c.id}`) || 0);
    if (p) lista.push(p);
  }
  // mesmo dia primeiro; entre iguais, a venda mais antiga (ordem estável entre gêmeas)
  lista.sort((a, b) => b.score - a.score || Number(a.id) - Number(b.id));
  return lista;
}

/** Junta os candidatos do TOTVS com os do HeadCoach, do mais provável ao menos. */
export function juntarCandidatos(doTotvs, doHc, limite = 8) {
  const todos = [...(doTotvs || []), ...(doHc || [])];
  todos.sort((a, b) => b.score - a.score || Number(!!a.parcial) - Number(!!b.parcial));
  return todos.slice(0, limite);
}

// ─── marca no título do HeadCoach ─────────────────────────────
// conciliacao_id do título aponta para a conciliação D+1 do próprio contas a
// receber; a conciliação bancária fica registrada em conciliado_por.
export const marcaDaConciliacao = (id) => `[conc ${id}]`;
export const textoConciliadoPor = (usuario, id) => `${String(usuario || 'Conciliação').slice(0, 80)} · extrato ${marcaDaConciliacao(id)}`;
export const feitaPeloExtrato = (conciliadoPor) => /\[conc \d+\]/.test(String(conciliadoPor || ''));

/** Ids dos títulos do contas a receber do HeadCoach usados numa conciliação gravada. */
export function idsHcCrDaConciliacao(conc) {
  const ref = conc?.referencia || {};
  const ids = Array.isArray(ref.itens) ? ref.itens.filter((it) => it?.origem === ORIGEM_HC_CR && it.id != null).map((it) => Number(it.id)) : [];
  if (conc?.origem === ORIGEM_HC_CR && ref.id != null) ids.push(Number(ref.id));
  return [...new Set(ids.filter(Number.isFinite))];
}
