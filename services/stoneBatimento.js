// ============================================================
// Batimento Stone × TOTVS
//
// Lado Stone : transações CAPTURADAS (FinancialTransactions) no período
// Lado TOTVS : títulos de cartão (docs 4/5) emitidos no período (± 1 dia de
//              folga), de QUALQUER portador, enriquecidos com NSU e código de
//              autorização lidos do pagamento da NF (fiscal/v2/invoices).
//
// A chave do casamento é a IDENTIDADE da transação (NSU e autorização), não o
// valor. Regra fechada com o Yago em 14/10/2026:
//   manual        → vínculo salvo pelo usuário (stone_conciliacao_vinculos)
//   exato         → NSU, autorização e valor batem
//   valor_diverge → NSU e autorização batem, valor não  → concilia e FLAGRA
//   nsu_diverge   → valor e autorização batem, NSU não  → concilia e FLAGRA
//   aut_diverge   → valor e NSU batem, autorização não  → concilia e FLAGRA
//   só o valor    → NÃO concilia (vai para "só na Stone" / "só no TOTVS";
//                   o drill-down do vínculo manual resolve).
// Portador deixou de importar: o caixa que lança STONE como "VISA DEBITO"
// concilia do mesmo jeito. O que sobra no TOTVS só é "só no TOTVS" quando o
// portador é Stone — título de outra adquirente não é problema desta tela.
// ============================================================

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

const normBandeira = (b) => String(b || '').toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
// Pré-pago/voucher da Stone é lançado no TOTVS como débito → tratamos como igual
const normTipo = (t) => {
  const n = String(t || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z]/g, '');
  return n === 'prepago' || n === 'voucher' ? 'debito' : n;
};
// NSU: só dígitos, sem zeros à esquerda (o TOTVS guarda como texto livre)
const normNsu = (v) => String(v ?? '').replace(/\D/g, '').replace(/^0+/, '') || null;
// Autorização: alfanumérica, sem espaços, maiúscula, sem zeros à esquerda
const normAut = (v) =>
  String(v ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+(?=.)/, '') || null;

const NIVEIS = {
  manual: { nivel: 0, rotulo: 'Manual' },
  exato: { nivel: 1, rotulo: 'Exato' },
  valor_diverge: { nivel: 2, rotulo: 'NSU e AUT batem · valor diverge' },
  nsu_diverge: { nivel: 3, rotulo: 'Valor e AUT batem · NSU diverge' },
  aut_diverge: { nivel: 4, rotulo: 'Valor e NSU batem · AUT diverge' },
  agrupado: { nivel: 1, rotulo: 'Exato · títulos somados (mesmo NSU)' },
  digitado_errado: { nivel: 5, rotulo: 'Data, valor e bandeira batem · NSU/AUT digitados errado' },
};

function divergencias(s, t) {
  const out = [];
  const nsuS = normNsu(s.nsu);
  const nsuT = normNsu(t.nsu);
  const autS = normAut(s.codAutorizacao);
  const autT = normAut(t.autorizacao);
  if (round2(s.valorBruto) !== round2(t.valor)) out.push(`valor Stone ${s.valorBruto} × TOTVS ${t.valor}`);
  if (nsuS !== nsuT) out.push(`NSU Stone ${s.nsu ?? '—'} × TOTVS ${t.nsu ?? '—'}`);
  if (autS !== autT) out.push(`autorização Stone ${s.codAutorizacao ?? '—'} × TOTVS ${t.autorizacao ?? '—'}`);
  if (s.dataVenda !== t.dataEmissao) out.push(`data Stone ${s.dataVenda} × TOTVS ${t.dataEmissao}`);
  if (Number(s.parcelas) !== Number(t.parcelas)) out.push(`parcelas Stone ${s.parcelas}x × TOTVS ${t.parcelas}x`);
  if (normBandeira(s.bandeira) !== normBandeira(t.bandeira))
    out.push(`bandeira Stone ${s.bandeira} × TOTVS ${t.bandeira}`);
  // pré-pago: as lojas lançam como débito, mas o lançamento pelo HeadCoach
  // baixa como crédito (João, 04/11/2026) → aceita os dois
  const prePago = /^pr[eé]-?pago|voucher/i.test(String(s.tipoConta || ''));
  if (!prePago && normTipo(s.tipoConta) !== normTipo(t.tipoConta))
    out.push(`tipo Stone ${s.tipoConta} × TOTVS ${t.tipoConta}`);
  if (!t.portadorStone) out.push(`portador no TOTVS: ${t.portador || '—'} (não é Stone)`);
  if (s.cancelada !== t.cancelado)
    out.push(s.cancelada ? 'cancelada na Stone, ativa no TOTVS' : 'cancelado no TOTVS, ativa na Stone');
  return out;
}

/**
 * @param transacoesStone  lista normalizada (services/stoneConciliacao.js)
 * @param titulosTotvs     lista de títulos (services/totvsCartoesStone.js),
 *                         já com nsu/autorizacao/portadorStone
 * @param vinculos         [{ nsu, filial, titulo, id, usuario, criado_em }]
 */
export function bater(transacoesStone, titulosTotvs, vinculos = []) {
  const stoneLivres = new Map(transacoesStone.map((s) => [s.nsu, s]));
  const totvsLivres = new Map(titulosTotvs.map((t) => [t.chave, t]));
  const pares = [];

  const fechar = (s, t, tipo, vinculo = null) => {
    stoneLivres.delete(s.nsu);
    totvsLivres.delete(t.chave);
    pares.push({
      ...NIVEIS[tipo],
      tipo,
      stone: s,
      totvs: t,
      divergencias: divergencias(s, t),
      diferencaValor: round2(s.valorBruto - t.valor),
      vinculo,
    });
  };

  // 0) vínculos manuais
  for (const v of vinculos) {
    const s = stoneLivres.get(String(v.nsu));
    const t = totvsLivres.get(`${v.filial}|${v.titulo}`);
    if (s && t) fechar(s, t, 'manual', { id: v.id, usuario: v.usuario, criadoEm: v.criado_em, observacao: v.observacao });
  }

  // Índices dos títulos livres por NSU e por autorização (reconstruídos a
  // cada nível porque os pares fechados saem de circulação).
  const indexar = () => {
    const porNsu = new Map();
    const porAut = new Map();
    for (const t of totvsLivres.values()) {
      const n = normNsu(t.nsu);
      const a = normAut(t.autorizacao);
      if (n) (porNsu.get(n) || porNsu.set(n, []).get(n)).push(t);
      if (a) (porAut.get(a) || porAut.set(a, []).get(a)).push(t);
    }
    return { porNsu, porAut };
  };

  const bateNsu = (s, t) => normNsu(s.nsu) != null && normNsu(s.nsu) === normNsu(t.nsu);
  const bateAut = (s, t) => normAut(s.codAutorizacao) != null && normAut(s.codAutorizacao) === normAut(t.autorizacao);
  const bateValor = (s, t) => round2(s.valorBruto) === round2(t.valor);

  const nivelDoPar = (s, t) => {
    const n = bateNsu(s, t);
    const a = bateAut(s, t);
    const v = bateValor(s, t);
    if (n && a && v) return 'exato';
    if (n && a) return 'valor_diverge';
    if (v && a) return 'nsu_diverge';
    if (v && n) return 'aut_diverge';
    return null; // só valor, só NSU ou só AUT: não concilia sozinho
  };

  // Do mais estrito ao mais frouxo, para um título não ser "roubado" por um
  // par pior antes de o par exato dele aparecer.
  for (const nivel of ['exato', 'valor_diverge', 'nsu_diverge', 'aut_diverge']) {
    const { porNsu, porAut } = indexar();
    for (const s of [...stoneLivres.values()]) {
      const cands = new Map();
      for (const t of porNsu.get(normNsu(s.nsu)) || []) cands.set(t.chave, t);
      for (const t of porAut.get(normAut(s.codAutorizacao)) || []) cands.set(t.chave, t);
      const escolhido = [...cands.values()]
        .filter((t) => totvsLivres.has(t.chave) && nivelDoPar(s, t) === nivel)
        // desempate: mesma data, depois mesmo status de cancelamento
        .sort(
          (a, b) =>
            Number(a.dataEmissao !== s.dataVenda) - Number(b.dataEmissao !== s.dataVenda) ||
            Number(a.cancelado !== s.cancelada) - Number(b.cancelado !== s.cancelada),
        )[0];
      if (escolhido) fechar(s, escolhido, nivel);
    }
  }

  // Um pagamento no cartão (1 NSU na Stone) dividido em 2+ títulos no TOTVS
  // (duas NFs com o mesmo NSU/AUT). Visto em Patos 04/11/2026: Stone R$ 333,00
  // = títulos 195120 (155,00) + 195121 (178,00). O par 1:1 ficava "valor
  // diverge" e o outro título sobrava em "só no TOTVS". Se os títulos livres
  // com o mesmo NSU e AUT completam o valor da Stone, juntam no par.
  for (const p of pares) {
    if (p.tipo !== 'valor_diverge') continue;
    const s = p.stone;
    const extras = [...totvsLivres.values()].filter(
      (t) => bateNsu(s, t) && bateAut(s, t) && t.chave !== p.totvs.chave,
    );
    if (!extras.length) continue;
    const soma = round2(extras.reduce((a, t) => a + t.valor, round2(p.totvs.valor)));
    if (soma !== round2(s.valorBruto)) continue;
    for (const t of extras) totvsLivres.delete(t.chave);
    Object.assign(p, NIVEIS.agrupado, {
      tipo: 'agrupado',
      totvsExtras: extras,
      valorTotvsTotal: soma,
      diferencaValor: 0,
      divergencias: [
        `1 pagamento no cartão dividido em ${extras.length + 1} títulos no TOTVS (${[p.totvs, ...extras].map((t) => `${t.filial}/${t.titulo} ${t.valor}`).join(' + ')})`,
        ...divergencias(s, { ...p.totvs, valor: soma }),
      ],
    });
  }

  // NSU/AUT digitados errados no caixa (João, 05/11/2026): o caixa põe o
  // StoneCode no lugar do NSU, deixa em branco, troca NSU↔AUT ou erra um
  // dígito da AUT. Outubro/2026: ~19 títulos assim em "só no TOTVS" com a
  // venda da Stone em "só na Stone". Casa quando, entre os que sobraram, há
  // UM único candidato de cada lado com mesma data, mesmo valor (±0,05),
  // mesmas parcelas e mesma bandeira (ou bandeira da Stone desconhecida).
  // Concilia, mas fica em "Com divergência" mostrando o que foi digitado.
  const bandeiraOk = (s, t) =>
    normBandeira(s.bandeira) === normBandeira(t.bandeira) || /^cod/.test(normBandeira(s.bandeira)) || !s.bandeira;
  const compativel = (s, t) =>
    s.dataVenda === t.dataEmissao &&
    Math.abs(round2(s.valorBruto) - round2(t.valor)) <= 0.05 &&
    Number(s.parcelas) === Number(t.parcelas) &&
    bandeiraOk(s, t) &&
    !s.cancelada &&
    !t.cancelado;
  for (const s of [...stoneLivres.values()]) {
    const cands = [...totvsLivres.values()].filter((t) => t.portadorStone !== false && compativel(s, t));
    if (cands.length !== 1) continue;
    const t = cands[0];
    const rivais = [...stoneLivres.values()].filter((x) => x !== s && compativel(x, t));
    if (rivais.length) continue;
    const trocados = normNsu(t.autorizacao) === normNsu(s.nsu) && normAut(t.nsu) === normAut(s.codAutorizacao);
    fechar(s, t, 'digitado_errado');
    const p = pares[pares.length - 1];
    p.divergencias.unshift(
      trocados
        ? 'NSU e AUT trocados no caixa'
        : `NSU/AUT digitados no caixa: NSU ${t.nsu ?? '(vazio)'} · AUT ${t.autorizacao ?? '(vazio)'}`,
    );
  }

  const stoneSemTotvs = [...stoneLivres.values()];
  // Sobra do TOTVS: só título de portador Stone é problema desta conciliação.
  // Título CANCELADO no TOTVS sem venda na Stone não é pendência (vai à parte).
  const sobraTotvs = [...totvsLivres.values()].filter((t) => t.portadorStone !== false);
  const totvsCanceladosSemStone = sobraTotvs.filter((t) => t.cancelado);
  const totvsSemStone = sobraTotvs
    .filter((t) => !t.cancelado)
    .map((t) => {
      // Baixa da Pagar.me/link de pagamento que caiu num portador STONE:
      // nº do título = NSU de 10 dígitos começando com 46 (ID da Pagar.me).
      const nsu = normNsu(t.nsu);
      const pagarme = !!nsu && nsu.length === 10 && nsu.startsWith('46') && String(t.titulo) === nsu;
      return pagarme ? { ...t, origemProvavel: 'pagarme' } : t;
    });
  const titulosStone = titulosTotvs.filter((t) => t.portadorStone !== false);

  const soma = (arr, f) => round2(arr.reduce((acc, x) => acc + (Number(f(x)) || 0), 0));
  const resumo = {
    stone: {
      qtd: transacoesStone.length,
      bruto: soma(transacoesStone, (s) => s.valorBruto),
      liquido: soma(transacoesStone, (s) => s.valorLiquido),
      taxa: soma(transacoesStone, (s) => s.taxa),
      canceladas: transacoesStone.filter((s) => s.cancelada).length,
    },
    totvs: {
      qtd: titulosStone.length,
      valor: soma(titulosStone, (t) => t.valor),
      cancelados: titulosStone.filter((t) => t.cancelado).length,
    },
    conciliadas: {
      qtd: pares.length,
      valorStone: soma(pares, (p) => p.stone.valorBruto),
      valorTotvs: soma(pares, (p) => p.valorTotvsTotal ?? p.totvs.valor),
      exatas: pares.filter((p) => p.tipo === 'exato' || p.tipo === 'manual' || p.tipo === 'agrupado').length,
      comDivergencia: pares.filter((p) => p.tipo !== 'exato' && p.tipo !== 'manual' && p.tipo !== 'agrupado').length,
      porNivel: Object.fromEntries(Object.keys(NIVEIS).map((k) => [k, pares.filter((p) => p.tipo === k).length])),
    },
    stoneSemTotvs: { qtd: stoneSemTotvs.length, valor: soma(stoneSemTotvs, (s) => s.valorBruto) },
    totvsSemStone: { qtd: totvsSemStone.length, valor: soma(totvsSemStone, (t) => t.valor) },
  };
  resumo.diferenca = round2(resumo.stone.bruto - resumo.totvs.valor);
  resumo.percentualConciliado =
    resumo.stone.qtd > 0 ? round2((pares.length / resumo.stone.qtd) * 100) : null;

  pares.sort((a, b) => ((a.stone.dataCaptura || '') < (b.stone.dataCaptura || '') ? -1 : 1));
  stoneSemTotvs.sort((a, b) => ((a.dataCaptura || '') < (b.dataCaptura || '') ? -1 : 1));

  return { pares, stoneSemTotvs, totvsSemStone, totvsCanceladosSemStone, resumo };
}

export const NIVEIS_BATIMENTO = NIVEIS;
