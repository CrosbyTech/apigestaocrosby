// ============================================================
// Batimento Stone × TOTVS
//
// Lado Stone : transações CAPTURADAS (FinancialTransactions) no período
// Lado TOTVS : títulos de cartão com portador STONE (docs 4/5) emitidos
//              no período (± 1 dia de folga para vendas na virada)
//
// Casamento 1:1 em níveis, do mais estrito para o mais frouxo:
//   manual  → vínculo salvo pelo usuário (stone_conciliacao_vinculos)
//   1 exato → mesma data, valor, nº parcelas, bandeira e crédito/débito
//   2 banda → mesma data, valor e parcelas (bandeira/tipo divergem no TOTVS)
//   3 data  → data ±1 dia, valor e parcelas
//   4 valor → mesma data e valor (nº de parcelas diverge)
// O que sobrar de cada lado vira "só na Stone" / "só no TOTVS".
// ============================================================

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

const addDias = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const normBandeira = (b) => String(b || '').toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
// Pré-pago/voucher da Stone é lançado no TOTVS como débito → tratamos como igual
const normTipo = (t) => {
  const n = String(t || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z]/g, '');
  return n === 'prepago' || n === 'voucher' ? 'debito' : n;
};

const NIVEIS = {
  manual: { nivel: 0, rotulo: 'Manual' },
  exato: { nivel: 1, rotulo: 'Exato' },
  bandeira: { nivel: 2, rotulo: 'Bandeira divergente' },
  data: { nivel: 3, rotulo: 'Data ±1 dia' },
  valor: { nivel: 4, rotulo: 'Parcelas divergentes' },
};

function divergencias(s, t) {
  const out = [];
  if (s.dataVenda !== t.dataEmissao) out.push(`data Stone ${s.dataVenda} × TOTVS ${t.dataEmissao}`);
  if (round2(s.valorBruto) !== round2(t.valor)) out.push(`valor Stone ${s.valorBruto} × TOTVS ${t.valor}`);
  if (Number(s.parcelas) !== Number(t.parcelas)) out.push(`parcelas Stone ${s.parcelas}x × TOTVS ${t.parcelas}x`);
  if (normBandeira(s.bandeira) !== normBandeira(t.bandeira))
    out.push(`bandeira Stone ${s.bandeira} × TOTVS ${t.bandeira}`);
  if (normTipo(s.tipoConta) !== normTipo(t.tipoConta))
    out.push(`tipo Stone ${s.tipoConta} × TOTVS ${t.tipoConta}`);
  if (s.cancelada !== t.cancelado)
    out.push(s.cancelada ? 'cancelada na Stone, ativa no TOTVS' : 'cancelado no TOTVS, ativa na Stone');
  return out;
}

/**
 * @param transacoesStone  lista normalizada (services/stoneConciliacao.js)
 * @param titulosTotvs     lista de títulos (services/totvsCartoesStone.js)
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

  // índices dos títulos livres por (data|valor|parcelas)
  const indexar = () => {
    const idx = new Map();
    for (const t of totvsLivres.values()) {
      const k = `${t.dataEmissao}|${round2(t.valor)}|${t.parcelas}`;
      if (!idx.has(k)) idx.set(k, []);
      idx.get(k).push(t);
    }
    return idx;
  };

  const tentar = (tipo, chavesDe, aceitar) => {
    const idx = indexar();
    for (const s of [...stoneLivres.values()]) {
      for (const k of chavesDe(s)) {
        const cands = (idx.get(k) || []).filter((t) => totvsLivres.has(t.chave) && aceitar(s, t));
        if (cands.length) {
          // prefere mesmo status (cancelado/ativo) e mesma bandeira
          cands.sort(
            (a, b) =>
              Number(a.cancelado !== s.cancelada) - Number(b.cancelado !== s.cancelada) ||
              Number(normBandeira(a.bandeira) !== normBandeira(s.bandeira)) -
                Number(normBandeira(b.bandeira) !== normBandeira(s.bandeira)),
          );
          fechar(s, cands[0], tipo);
          break;
        }
      }
    }
  };

  const kExata = (s) => [`${s.dataVenda}|${round2(s.valorBruto)}|${s.parcelas}`];
  const mesmaBandeiraTipo = (s, t) =>
    normBandeira(s.bandeira) === normBandeira(t.bandeira) &&
    normTipo(s.tipoConta) === normTipo(t.tipoConta);

  // 1) exato
  tentar('exato', kExata, mesmaBandeiraTipo);
  // 2) bandeira/tipo divergente
  tentar('bandeira', kExata, () => true);
  // 3) data ±1 dia
  tentar(
    'data',
    (s) => [
      `${addDias(s.dataVenda, 1)}|${round2(s.valorBruto)}|${s.parcelas}`,
      `${addDias(s.dataVenda, -1)}|${round2(s.valorBruto)}|${s.parcelas}`,
    ],
    () => true,
  );
  // 4) mesma data e valor, parcelas diferentes (índice por data|valor)
  {
    const idx = new Map();
    for (const t of totvsLivres.values()) {
      const k = `${t.dataEmissao}|${round2(t.valor)}`;
      if (!idx.has(k)) idx.set(k, []);
      idx.get(k).push(t);
    }
    for (const s of [...stoneLivres.values()]) {
      const cands = (idx.get(`${s.dataVenda}|${round2(s.valorBruto)}`) || []).filter((t) =>
        totvsLivres.has(t.chave),
      );
      if (cands.length) fechar(s, cands[0], 'valor');
    }
  }

  const stoneSemTotvs = [...stoneLivres.values()];
  const totvsSemStone = [...totvsLivres.values()];

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
      qtd: titulosTotvs.length,
      valor: soma(titulosTotvs, (t) => t.valor),
      cancelados: titulosTotvs.filter((t) => t.cancelado).length,
    },
    conciliadas: {
      qtd: pares.length,
      valorStone: soma(pares, (p) => p.stone.valorBruto),
      valorTotvs: soma(pares, (p) => p.totvs.valor),
      exatas: pares.filter((p) => p.tipo === 'exato' || p.tipo === 'manual').length,
      comDivergencia: pares.filter((p) => p.divergencias.length > 0).length,
    },
    stoneSemTotvs: { qtd: stoneSemTotvs.length, valor: soma(stoneSemTotvs, (s) => s.valorBruto) },
    totvsSemStone: { qtd: totvsSemStone.length, valor: soma(totvsSemStone, (t) => t.valor) },
  };
  resumo.diferenca = round2(resumo.stone.bruto - resumo.totvs.valor);
  resumo.percentualConciliado =
    resumo.stone.qtd > 0 ? round2((pares.length / resumo.stone.qtd) * 100) : null;

  pares.sort((a, b) => (a.stone.dataCaptura || '') < (b.stone.dataCaptura || '') ? -1 : 1);
  stoneSemTotvs.sort((a, b) => ((a.dataCaptura || '') < (b.dataCaptura || '') ? -1 : 1));

  return { pares, stoneSemTotvs, totvsSemStone, resumo };
}

export const NIVEIS_BATIMENTO = NIVEIS;
