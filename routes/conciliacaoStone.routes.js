// ============================================================
// CONCILIAÇÃO STONE — extrato diário de cartão × títulos do TOTVS
//
// Stone: API de Conciliação (fluxo cliente, Basic sk_ + x-user-type: client),
//        arquivo XML por StoneCode + dia, cacheado (services/stoneConciliacao.js)
// TOTVS: títulos de cartão com portador STONE (services/totvsCartoesStone.js)
// Batimento: services/stoneBatimento.js
//
// Endpoints (prefixo /api/conciliacao-stone):
//   GET  /lojas                                   → lojas configuradas (sem chaves)
//   GET  /conciliacao?stonecode=&inicio=&fim=     → só Stone (transações, pagamentos)
//   GET  /batimento?stonecode=all|<sc>&inicio=&fim=[&force=1]
//                                                 → Stone × TOTVS por loja
//   GET  /dia?stonecode=&data=                    → arquivo completo de um dia
//   POST /atualizar {stonecode, data}             → força novo download de um dia
//   GET  /vinculos?stonecode=                     → vínculos manuais
//   POST /vinculos {stonecode,nsu,filial,titulo,observacao,usuario}
//   DELETE /vinculos/:id
// ============================================================
import express from 'express';
import supabase from '../config/supabase.js';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';
import {
  STONE_LOJAS,
  getLojaByStonecode,
  getLojasPublic,
  stonecodesDaLoja,
} from '../config/stoneConciliacao.js';
import {
  obterDiaStone,
  obterPeriodoStone,
  rangeDatasIso,
  mapLimit,
} from '../services/stoneConciliacao.js';
import {
  buscarTitulosCartaoStone,
  buscarTitulosPorCodigo,
  buscarTransacoesDia,
  mapearFiliaisTotvsPorCnpj,
  resolverFiliaisLoja,
} from '../services/totvsCartoesStone.js';
import { bater } from '../services/stoneBatimento.js';
import { lancarVendaStone, clientePadraoDaLoja } from '../services/stoneLancarTotvs.js';

const router = express.Router();

const MAX_DIAS = 62; // teto de dias por consulta
const TABELA_VINCULOS = 'stone_conciliacao_vinculos';

const isMissingTable = (error) =>
  !!error &&
  (error.code === '42P01' ||
    error.code === 'PGRST205' ||
    /does not exist|Could not find the table|schema cache/i.test(error.message || ''));

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function validarPeriodo(req) {
  const { inicio, fim, data } = req.query;
  const inicioIso = data || inicio;
  const fimIso = data || fim || inicio;
  if (!inicioIso) return { erro: 'Informe "data" ou "inicio"/"fim".' };
  if (!ISO_RE.test(inicioIso) || !ISO_RE.test(fimIso))
    return { erro: 'Datas devem estar no formato YYYY-MM-DD.' };
  const datas = rangeDatasIso(inicioIso, fimIso);
  if (!datas.length) return { erro: 'Intervalo de datas inválido.' };
  if (datas.length > MAX_DIAS) return { erro: `Intervalo máximo de ${MAX_DIAS} dias.` };
  return { inicioIso, fimIso, datas };
}

function resolverLojas(stonecode) {
  if (!stonecode || stonecode === 'all' || stonecode === 'todas') {
    return STONE_LOJAS.filter((l) => l.apiKey && l.stonecode);
  }
  const codes = String(stonecode)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return codes.map((c) => getLojaByStonecode(c)).filter(Boolean);
}

async function listarVinculos(stonecodes) {
  try {
    let q = supabase.from(TABELA_VINCULOS).select('*').order('criado_em', { ascending: false });
    if (stonecodes?.length) q = q.in('stonecode', stonecodes.map(String));
    const { data, error } = await q;
    if (error) {
      if (isMissingTable(error)) return { vinculos: [], disponivel: false };
      throw error;
    }
    return { vinculos: data || [], disponivel: true };
  } catch (e) {
    console.warn(`[stone] vínculos indisponíveis: ${e.message}`);
    return { vinculos: [], disponivel: false };
  }
}

// Vínculo automático NSU ↔ título do cartão criado pelo "lançar no TOTVS"
// (idempotente: se a NSU já tem vínculo, não duplica).
async function vincularLancamento({ stonecode, nsu, filial, titulo, usuario }) {
  try {
    const { data: ja } = await supabase
      .from(TABELA_VINCULOS)
      .select('id, filial, titulo')
      .eq('stonecode', String(stonecode))
      .eq('nsu', String(nsu))
      .limit(1);
    if (ja?.length) return { id: ja[0].id, filial: ja[0].filial, titulo: ja[0].titulo, existente: true };
    const { data, error } = await supabase
      .from(TABELA_VINCULOS)
      .insert({
        stonecode: String(stonecode),
        nsu: String(nsu),
        filial: Number(filial),
        titulo: Number(titulo),
        observacao: 'Lançado pelo HeadCoach (fatura + baixa no cartão)',
        usuario: usuario ? String(usuario).slice(0, 120) : 'HeadCoach',
      })
      .select('id')
      .single();
    if (error) throw error;
    return { id: data.id, filial: Number(filial), titulo: Number(titulo) };
  } catch (e) {
    console.warn(`[stone] vínculo automático NSU ${nsu}: ${e.message}`);
    return { erro: e.message };
  }
}

// Mapa CNPJ → empresas do TOTVS; se o TOTVS falhar, usa o config
async function mapaFiliaisSeguro() {
  try {
    return await mapearFiliaisTotvsPorCnpj();
  } catch (e) {
    console.warn(`[stone] TOTVS branchesList indisponível (${e.message}) — usando filiais do config`);
    return null;
  }
}

// Loja com as filiais resolvidas pelo CNPJ no TOTVS
const comFiliaisTotvs = (loja, mapa) => {
  const r = resolverFiliaisLoja(loja, mapa);
  return { ...loja, filiais: r.filiais, filialTotvs: r.filialTotvs, nomesFiliais: r.nomesFiliais };
};

// Baixa o período de TODOS os StoneCodes da loja (presencial + online) e
// junta: transações marcadas com o código de origem, erros idem.
async function obterPeriodoLoja(loja, inicioIso, fimIso, opts) {
  const codes = stonecodesDaLoja(loja);
  const partes = await Promise.all(
    codes.map(async (code) => {
      const r = await obterPeriodoStone({ ...loja, stonecode: code }, inicioIso, fimIso, opts);
      return { code, ...r };
    }),
  );
  const dias = partes.flatMap((p) =>
    p.dias.map((d) => ({
      ...d,
      stonecode: p.code,
      transacoes: d.transacoes.map((t) => ({ ...t, stonecode: p.code })),
    })),
  );
  const erros = partes.flatMap((p) =>
    p.erros.map((e) => ({ ...e, stonecode: p.code, erro: codes.length > 1 ? `[${p.code}] ${e.erro}` : e.erro })),
  );
  dias.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.stonecode < b.stonecode ? -1 : 1));
  return { datas: partes[0]?.datas || [], dias, erros, stonecodes: codes };
}

const lojaPublica = (l) => ({
  nome: l.nome,
  cnpj: l.cnpjFmt,
  stonecode: l.stonecode,
  stonecodes: stonecodesDaLoja(l),
  filiais: l.filiais,
  filialTotvs: l.filialTotvs || null,
  nomesFiliais: l.nomesFiliais || null,
  observacao: l.observacao || null,
});

// ──────────────────────────────────────────────────────────────
// GET /lojas
// ──────────────────────────────────────────────────────────────
router.get(
  '/lojas',
  asyncHandler(async (req, res) => {
    const mapa = await mapaFiliaisSeguro();
    const lojas = getLojasPublic().map((pub) => {
      // por CNPJ: lojas pendentes não têm StoneCode
      const cfg = STONE_LOJAS.find((l) => l.cnpj === pub.cnpj) || pub;
      const r = resolverFiliaisLoja(cfg, mapa);
      return {
        ...pub,
        filiais: r.filiais,
        filial: r.filiais[0] ?? null,
        filialTotvs: r.filialTotvs,
        nomesFiliais: r.nomesFiliais,
      };
    });
    return successResponse(res, { lojas, totvsOk: !!mapa });
  }),
);

// ──────────────────────────────────────────────────────────────
// GET /conciliacao — só o lado Stone (compatível com a versão anterior)
// ──────────────────────────────────────────────────────────────
router.get(
  '/conciliacao',
  asyncHandler(async (req, res) => {
    const { stonecode, force } = req.query;
    if (!stonecode) return errorResponse(res, 'Parâmetro "stonecode" obrigatório.', 400);
    const loja = getLojaByStonecode(stonecode);
    if (!loja) return errorResponse(res, 'StoneCode não configurado no servidor.', 404);
    if (!loja.apiKey)
      return errorResponse(res, `Loja ${loja.nome} ainda sem chave de API da Stone.`, 409, 'SEM_CHAVE');

    const per = validarPeriodo(req);
    if (per.erro) return errorResponse(res, per.erro, 400);

    const { dias, erros } = await obterPeriodoLoja(loja, per.inicioIso, per.fimIso, {
      force: force === '1' || force === 'true',
    });

    const transacoes = dias.flatMap((d) => d.transacoes);
    const pagamentos = dias.flatMap((d) => d.pagamentos.map((p) => ({ ...p, data: d.data })));
    const liquidacoes = dias.flatMap((d) => d.liquidacoes.map((p) => ({ ...p, data: d.data })));
    const soma = (arr, f) => +arr.reduce((s, x) => s + (Number(f(x)) || 0), 0).toFixed(2);

    return successResponse(res, {
      loja: lojaPublica(loja),
      periodo: { inicio: per.inicioIso, fim: per.fimIso },
      resumo: {
        qtdTransacoes: transacoes.length,
        totalBruto: soma(transacoes, (t) => t.valorBruto),
        totalLiquido: soma(transacoes, (t) => t.valorLiquido),
        totalTaxa: soma(transacoes, (t) => t.taxa),
        totalCancelado: soma(transacoes, (t) => t.valorCancelado),
        qtdPagamentos: pagamentos.length,
        totalPago: soma(pagamentos, (p) => p.valorTotal),
        totalLiquidado: soma(liquidacoes, (p) => p.liquido),
        diasConsultados: per.datas.length,
        diasComErro: erros.length,
        diasDoCache: dias.filter((d) => d._cache).length,
      },
      transacoes,
      pagamentos,
      liquidacoes,
      dias: dias.map((d) => ({ data: d.data, trailer: d.trailer, cache: d._cache || null })),
      erros,
    });
  }),
);

// ──────────────────────────────────────────────────────────────
// GET /batimento — Stone × TOTVS por loja
// ──────────────────────────────────────────────────────────────
router.get(
  '/batimento',
  asyncHandler(async (req, res) => {
    const per = validarPeriodo(req);
    if (per.erro) return errorResponse(res, per.erro, 400);
    const force = req.query.force === '1' || req.query.force === 'true';

    const lojas = resolverLojas(req.query.stonecode);
    if (!lojas.length) return errorResponse(res, 'Nenhuma loja válida informada.', 404);

    const t0 = Date.now();
    const mapa = await mapaFiliaisSeguro();
    const lojasResolvidas = lojas.map((l) => comFiliaisTotvs(l, mapa));
    const semChave = lojasResolvidas.filter((l) => !l.apiKey || !l.stonecode);
    const comChave = lojasResolvidas.filter((l) => l.apiKey && l.stonecode);

    // TOTVS: uma busca só com todas as filiais envolvidas, com 1 dia de folga
    // de cada lado (venda na virada da noite / captura no dia seguinte).
    const filiais = [...new Set(comChave.flatMap((l) => l.filiais))];
    const iniTotvs = rangeDatasIso(per.inicioIso, per.inicioIso)[0];
    const totvsInicio = addDias(iniTotvs, -1);
    const totvsFim = addDias(per.fimIso, 1);

    const [titulosTodos, vincRes, stonePorLoja] = await Promise.all([
      filiais.length
        ? buscarTitulosCartaoStone({ branchCodes: filiais, inicioIso: totvsInicio, fimIso: totvsFim })
        : Promise.resolve([]),
      listarVinculos(comChave.map((l) => l.stonecode)),
      mapLimit(comChave, 3, async (loja) => {
        const r = await obterPeriodoLoja(loja, per.inicioIso, per.fimIso, { force, concorrencia: 4 });
        return { loja, ...r };
      }),
    ]);

    // Vínculo manual pode apontar para título que a busca por portador STONE
    // não traz (caixa lançou com outro portador): busca esses pelo código,
    // senão o vínculo salvo nunca vira par.
    const chavesTotvs = new Set(titulosTodos.map((t) => t.chave));
    const faltam = (vincRes.vinculos || []).filter((v) => !chavesTotvs.has(`${v.filial}|${v.titulo}`));
    if (faltam.length) {
      try {
        titulosTodos.push(...(await buscarTitulosPorCodigo(faltam)));
      } catch (e) {
        console.warn(`[stone] títulos dos vínculos manuais: ${e.message}`);
      }
    }

    const resultado = stonePorLoja.map(({ loja, dias, erros }) => {
      const transacoes = dias.flatMap((d) => d.transacoes);
      // Depósito ↔ vendas (João, 04/11/2026): cada depósito (Payment) junta
      // parcelas liquidadas no dia (FinancialTransactionsAccounts, PaymentId).
      // O WalletTypeId do depósito NÃO é bandeira/carteira (um "Mastercard
      // Débito" vinha cheio de Visa crédito antecipado) — o tipo real sai das
      // parcelas: antecipada ou liquidação normal.
      const vendaPorNsu = new Map(transacoes.map((t) => [String(t.nsu), t]));
      const liqPorPagamento = new Map();
      const depositosPorNsu = new Map();
      for (const d of dias) {
        for (const l of d.liquidacoes || []) {
          const pid = String(l.paymentId || '');
          if (!pid) continue;
          if (!liqPorPagamento.has(pid)) liqPorPagamento.set(pid, []);
          liqPorPagamento.get(pid).push(l);
          const k = String(l.nsu);
          if (!depositosPorNsu.has(k)) depositosPorNsu.set(k, []);
          depositosPorNsu.get(k).push({
            id: pid,
            data: l.dataPagamento ? String(l.dataPagamento).slice(0, 10) : d.data,
            parcela: l.numero,
            liquido: l.liquido,
            antecipada: !!l.antecipada,
          });
        }
      }
      for (const t of transacoes) t.depositos = depositosPorNsu.get(String(t.nsu)) || [];
      // títulos das filiais desta maquininha; fora do período estrito só
      // entram os que casarem por data ±1 (o resto é descartado abaixo)
      const titulos = titulosTodos.filter((t) => loja.filiais.includes(t.filial));
      const vinculos = vincRes.vinculos.filter((v) => String(v.stonecode) === String(loja.stonecode));
      const b = bater(transacoes, titulos, vinculos);
      // títulos de folga (fora do período) que não casaram não são "só no TOTVS"
      b.totvsSemStone = b.totvsSemStone.filter(
        (t) => t.dataEmissao >= per.inicioIso && t.dataEmissao <= per.fimIso,
      );
      const somaT = +b.totvsSemStone.reduce((s, t) => s + t.valor, 0).toFixed(2);
      b.resumo.totvsSemStone = { qtd: b.totvsSemStone.length, valor: somaT };
      // resumo do TOTVS: só portador Stone (título de outra adquirente que
      // entrou na busca não é conta desta tela)
      const titulosNoPeriodo = titulos.filter(
        (t) => t.portadorStone !== false && t.dataEmissao >= per.inicioIso && t.dataEmissao <= per.fimIso,
      );
      b.resumo.totvs = {
        qtd: titulosNoPeriodo.length,
        valor: +titulosNoPeriodo.reduce((s, t) => s + t.valor, 0).toFixed(2),
        cancelados: titulosNoPeriodo.filter((t) => t.cancelado).length,
      };
      b.resumo.diferenca = +(b.resumo.stone.bruto - b.resumo.totvs.valor).toFixed(2);

      const pagamentos = dias.flatMap((d) =>
        d.pagamentos.map((p) => {
          const liq = liqPorPagamento.get(String(p.id)) || [];
          const antecipadas = liq.filter((l) => l.antecipada).length;
          const bandeiras = {};
          for (const l of liq) {
            const v = vendaPorNsu.get(String(l.nsu));
            const k = v ? `${v.bandeira} ${v.tipoConta}` : 'venda fora do período';
            bandeiras[k] = (bandeiras[k] || 0) + 1;
          }
          const tipo = !liq.length
            ? 'Sem venda (outro lançamento Stone)'
            : antecipadas === liq.length
              ? 'Antecipação'
              : antecipadas === 0
                ? 'Liquidação normal'
                : 'Liquidação + antecipação';
          return {
            ...p,
            carteiraStone: p.carteira, // código bruto da Stone (WalletTypeId), só referência
            carteira: tipo,
            composicao: {
              qtd: liq.length,
              antecipadas,
              normais: liq.length - antecipadas,
              bruto: +liq.reduce((s, l) => s + (Number(l.bruto) || 0), 0).toFixed(2),
              liquido: +liq.reduce((s, l) => s + (Number(l.liquido) || 0), 0).toFixed(2),
              bandeiras,
              nsus: liq.map((l) => String(l.nsu)),
            },
            data: d.data,
            stonecode: d.stonecode,
          };
        }),
      );
      return {
        loja: lojaPublica(loja),
        resumo: {
          ...b.resumo,
          pagamentos: {
            qtd: pagamentos.length,
            valor: +pagamentos.reduce((s, p) => s + p.valorTotal, 0).toFixed(2),
          },
          diasConsultados: per.datas.length,
          // com mais de um StoneCode, conta datas distintas (não arquivos)
          diasOk: new Set(dias.map((d) => d.data)).size,
          diasComErro: erros.length,
        },
        pares: b.pares,
        stoneSemTotvs: b.stoneSemTotvs,
        totvsSemStone: b.totvsSemStone,
        totvsCanceladosSemStone: b.totvsCanceladosSemStone || [],
        pagamentos,
        erros,
      };
    });

    // cliente padrão p/ lançar "Só na Stone" no TOTVS = a própria loja (trocável na tela)
    await Promise.all(
      resultado.map(async (r, i) => {
        if (!r.stoneSemTotvs.length) return;
        try {
          r.loja.clientePadrao = await clientePadraoDaLoja(stonePorLoja[i].loja.cnpj);
        } catch (e) {
          console.warn(`[stone] cliente padrão ${r.loja.nome}: ${e.message}`);
        }
      }),
    );

    const agg = (f) => +resultado.reduce((s, r) => s + (Number(f(r.resumo)) || 0), 0).toFixed(2);
    const geral = {
      lojas: resultado.length,
      lojasSemChave: semChave.map((l) => ({
        nome: l.nome,
        stonecode: l.stonecode,
        cnpj: l.cnpjFmt,
        motivo: !l.stonecode ? 'sem StoneCode' : 'sem chave',
      })),
      stoneQtd: agg((r) => r.stone.qtd),
      stoneBruto: agg((r) => r.stone.bruto),
      stoneLiquido: agg((r) => r.stone.liquido),
      stoneTaxa: agg((r) => r.stone.taxa),
      totvsQtd: agg((r) => r.totvs.qtd),
      totvsValor: agg((r) => r.totvs.valor),
      conciliadasQtd: agg((r) => r.conciliadas.qtd),
      conciliadasValor: agg((r) => r.conciliadas.valorStone),
      comDivergencia: agg((r) => r.conciliadas.comDivergencia),
      stoneSemTotvsQtd: agg((r) => r.stoneSemTotvs.qtd),
      stoneSemTotvsValor: agg((r) => r.stoneSemTotvs.valor),
      totvsSemStoneQtd: agg((r) => r.totvsSemStone.qtd),
      totvsSemStoneValor: agg((r) => r.totvsSemStone.valor),
      pagamentosValor: agg((r) => r.pagamentos.valor),
      diasComErro: agg((r) => r.diasComErro),
      vinculosDisponivel: vincRes.disponivel,
      filiaisViaTotvs: !!mapa,
      tempoMs: Date.now() - t0,
    };
    geral.diferenca = +(geral.stoneBruto - geral.totvsValor).toFixed(2);
    geral.percentualConciliado =
      geral.stoneQtd > 0 ? +((geral.conciliadasQtd / geral.stoneQtd) * 100).toFixed(1) : null;

    return successResponse(res, {
      periodo: { inicio: per.inicioIso, fim: per.fimIso, dias: per.datas.length },
      geral,
      lojas: resultado,
    });
  }),
);

function addDias(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ──────────────────────────────────────────────────────────────
// GET /dia — arquivo completo de um dia (drill-down)
// ──────────────────────────────────────────────────────────────
router.get(
  '/dia',
  asyncHandler(async (req, res) => {
    const { stonecode, data } = req.query;
    const loja = getLojaByStonecode(stonecode);
    if (!loja) return errorResponse(res, 'StoneCode não configurado no servidor.', 404);
    if (!ISO_RE.test(String(data || ''))) return errorResponse(res, 'Informe "data" (YYYY-MM-DD).', 400);
    try {
      const dia = await obterDiaStone(loja, data);
      return successResponse(res, { loja: lojaPublica(loja), ...dia });
    } catch (err) {
      return errorResponse(res, err.message, err.status === 429 ? 429 : 502, err.codigo || 'STONE_ERROR');
    }
  }),
);

// ──────────────────────────────────────────────────────────────
// POST /atualizar — força novo download de um dia (respeita 7/h da Stone)
// ──────────────────────────────────────────────────────────────
router.post(
  '/atualizar',
  asyncHandler(async (req, res) => {
    const { stonecode, data } = req.body || {};
    const loja = getLojaByStonecode(stonecode);
    if (!loja) return errorResponse(res, 'StoneCode não configurado no servidor.', 404);
    if (!ISO_RE.test(String(data || ''))) return errorResponse(res, 'Informe "data" (YYYY-MM-DD).', 400);
    try {
      const dia = await obterDiaStone(loja, data, { force: true });
      return successResponse(
        res,
        { data: dia.data, trailer: dia.trailer, qtdTransacoes: dia.transacoes.length },
        'Arquivo atualizado.',
      );
    } catch (err) {
      return errorResponse(res, err.message, err.status === 429 ? 429 : 502, err.codigo || 'STONE_ERROR');
    }
  }),
);

// ──────────────────────────────────────────────────────────────
// Vínculos manuais
// ──────────────────────────────────────────────────────────────
router.get(
  '/vinculos',
  asyncHandler(async (req, res) => {
    const codes = req.query.stonecode ? String(req.query.stonecode).split(',') : null;
    const r = await listarVinculos(codes);
    return successResponse(res, r);
  }),
);

// ──────────────────────────────────────────────────────────────
// GET /transacoes-dia?stonecode=&data=YYYY-MM-DD — drill-down do vínculo
// manual: todas as vendas do dia no TOTVS (filiais da maquininha) com as
// formas de pagamento e o título de cada pagamento no cartão.
// ──────────────────────────────────────────────────────────────
router.get(
  '/transacoes-dia',
  asyncHandler(async (req, res) => {
    const { stonecode, data } = req.query;
    if (!stonecode || !ISO_RE.test(String(data || '')))
      return errorResponse(res, 'Informe stonecode e data (YYYY-MM-DD).', 400);
    const cfg = getLojaByStonecode(String(stonecode));
    if (!cfg) return errorResponse(res, 'StoneCode não configurado no servidor.', 404);
    const loja = comFiliaisTotvs(cfg, await mapaFiliaisSeguro());
    if (!loja.filiais?.length) return errorResponse(res, 'Loja sem filial TOTVS resolvida.', 422);
    const t0 = Date.now();
    const transacoes = await buscarTransacoesDia({ branchCodes: loja.filiais, dataIso: String(data) });
    return successResponse(res, {
      loja: { stonecode: loja.stonecode, nome: loja.nome, filiais: loja.filiais },
      data: String(data),
      total: transacoes.length,
      transacoes,
      ms: Date.now() - t0,
    });
  }),
);

router.post(
  '/vinculos',
  asyncHandler(async (req, res) => {
    const { stonecode, nsu, filial, titulo, observacao, usuario } = req.body || {};
    if (!stonecode || !nsu || !filial || !titulo)
      return errorResponse(res, 'stonecode, nsu, filial e titulo são obrigatórios.', 400);
    if (!getLojaByStonecode(stonecode))
      return errorResponse(res, 'StoneCode não configurado no servidor.', 404);

    const { data, error } = await supabase
      .from(TABELA_VINCULOS)
      .insert({
        stonecode: String(stonecode),
        nsu: String(nsu),
        filial: Number(filial),
        titulo: Number(titulo),
        observacao: observacao ? String(observacao).slice(0, 500) : null,
        usuario: usuario ? String(usuario).slice(0, 120) : null,
      })
      .select()
      .single();
    if (error) {
      if (isMissingTable(error))
        return errorResponse(
          res,
          'Tabela de vínculos não existe. Rode migrations/stone_conciliacao.sql no Supabase.',
          503,
          'SEM_TABELA',
        );
      if (error.code === '23505')
        return errorResponse(res, 'Esta transação ou este título já possui vínculo.', 409, 'DUPLICADO');
      throw error;
    }
    return successResponse(res, data, 'Vínculo salvo.', 201);
  }),
);

router.delete(
  '/vinculos/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) return errorResponse(res, 'id inválido.', 400);
    const { error } = await supabase.from(TABELA_VINCULOS).delete().eq('id', id);
    if (error) {
      if (isMissingTable(error))
        return errorResponse(res, 'Tabela de vínculos não existe.', 503, 'SEM_TABELA');
      throw error;
    }
    return successResponse(res, { id }, 'Vínculo removido.');
  }),
);

// ──────────────────────────────────────────────────────────────
// POST /lancar-totvs — vendas "Só na Stone" → fatura no TOTVS + baixa no cartão
// body: { itens: [{ stonecode, nsu, dataArquivo, cliente }], simular?, usuario? }
// Valor/NSU/AUT/bandeira/parcelas vêm do arquivo da Stone (cache), não da tela.
// Sequencial: uma venda por vez (o TOTVS não gosta de rajada de escrita).
// ──────────────────────────────────────────────────────────────
router.post(
  '/lancar-totvs',
  asyncHandler(async (req, res) => {
    const { itens, simular = false, usuario = null } = req.body || {};
    if (!Array.isArray(itens) || !itens.length) return errorResponse(res, 'Envie "itens".', 400);
    const mapa = await mapaFiliaisSeguro();
    const resultados = [];
    for (const it of itens) {
      const base = { nsu: String(it?.nsu || ''), stonecode: String(it?.stonecode || ''), cliente: it?.cliente ?? null };
      try {
        const cfg = getLojaByStonecode(base.stonecode);
        if (!cfg) {
          resultados.push({ ...base, ok: false, erro: 'StoneCode não configurado no servidor.' });
          continue;
        }
        // sem cliente informado → a própria loja (padrão combinado com o João)
        let cliente = Number(String(it?.cliente ?? '').replace(/\D/g, ''));
        if (!cliente) cliente = (await clientePadraoDaLoja(cfg.cnpj))?.code || 0;
        if (!cliente) {
          resultados.push({ ...base, ok: false, erro: 'Informe o código do cliente (a loja não tem cadastro de cliente no TOTVS).' });
          continue;
        }
        if (!ISO_RE.test(String(it?.dataArquivo || ''))) {
          resultados.push({ ...base, ok: false, erro: 'Venda sem data do arquivo Stone.' });
          continue;
        }
        const dia = await obterDiaStone({ ...cfg, stonecode: base.stonecode }, String(it.dataArquivo));
        const venda = (dia.transacoes || []).find((t) => String(t.nsu) === base.nsu);
        if (!venda) {
          resultados.push({ ...base, ok: false, erro: `NSU ${base.nsu} não está no arquivo da Stone de ${it.dataArquivo}.` });
          continue;
        }
        const loja = comFiliaisTotvs(cfg, mapa);
        const r = await lancarVendaStone({ venda, loja, cliente, simular: !!simular, usuario });
        // O título do cartão gerado pela baixa não tem NSU → grava o vínculo
        // NSU ↔ título para a venda sair de "Só na Stone" e ir para Conciliadas.
        if (r.ok && !simular && r.tituloCartao) {
          r.vinculo = await vincularLancamento({
            stonecode: cfg.stonecode,
            nsu: base.nsu,
            filial: r.tituloCartao.filial,
            titulo: r.tituloCartao.titulo,
            usuario,
          });
        }
        resultados.push({ ...base, ...r });
      } catch (e) {
        resultados.push({ ...base, ok: false, erro: e.message || String(e) });
      }
    }
    const okQtd = resultados.filter((r) => r.ok).length;
    return successResponse(
      res,
      { resultados, ok: okQtd, falhas: resultados.length - okQtd, simulado: !!simular },
      `${okQtd} de ${resultados.length} venda(s) ${simular ? 'validadas' : 'lançadas'}.`,
    );
  }),
);

export default router;
