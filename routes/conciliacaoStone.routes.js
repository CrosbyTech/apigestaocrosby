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
import { STONE_LOJAS, getLojaByStonecode, getLojasPublic } from '../config/stoneConciliacao.js';
import {
  obterDiaStone,
  obterPeriodoStone,
  rangeDatasIso,
  mapLimit,
} from '../services/stoneConciliacao.js';
import {
  buscarTitulosCartaoStone,
  mapearFiliaisTotvsPorCnpj,
  resolverFiliaisLoja,
} from '../services/totvsCartoesStone.js';
import { bater } from '../services/stoneBatimento.js';

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
    return STONE_LOJAS.filter((l) => l.apiKey);
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

const lojaPublica = (l) => ({
  nome: l.nome,
  cnpj: l.cnpjFmt,
  stonecode: l.stonecode,
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
      const cfg = getLojaByStonecode(pub.stonecode);
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

    const { dias, erros } = await obterPeriodoStone(loja, per.inicioIso, per.fimIso, {
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
    const semChave = lojasResolvidas.filter((l) => !l.apiKey);
    const comChave = lojasResolvidas.filter((l) => l.apiKey);

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
        const r = await obterPeriodoStone(loja, per.inicioIso, per.fimIso, { force, concorrencia: 4 });
        return { loja, ...r };
      }),
    ]);

    const resultado = stonePorLoja.map(({ loja, dias, erros }) => {
      const transacoes = dias.flatMap((d) => d.transacoes);
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
      const titulosNoPeriodo = titulos.filter(
        (t) => t.dataEmissao >= per.inicioIso && t.dataEmissao <= per.fimIso,
      );
      b.resumo.totvs = {
        qtd: titulosNoPeriodo.length,
        valor: +titulosNoPeriodo.reduce((s, t) => s + t.valor, 0).toFixed(2),
        cancelados: titulosNoPeriodo.filter((t) => t.cancelado).length,
      };
      b.resumo.diferenca = +(b.resumo.stone.bruto - b.resumo.totvs.valor).toFixed(2);

      const pagamentos = dias.flatMap((d) => d.pagamentos.map((p) => ({ ...p, data: d.data })));
      return {
        loja: lojaPublica(loja),
        resumo: {
          ...b.resumo,
          pagamentos: {
            qtd: pagamentos.length,
            valor: +pagamentos.reduce((s, p) => s + p.valorTotal, 0).toFixed(2),
          },
          diasConsultados: per.datas.length,
          diasOk: dias.length,
          diasComErro: erros.length,
        },
        pares: b.pares,
        stoneSemTotvs: b.stoneSemTotvs,
        totvsSemStone: b.totvsSemStone,
        pagamentos,
        erros,
      };
    });

    const agg = (f) => +resultado.reduce((s, r) => s + (Number(f(r.resumo)) || 0), 0).toFixed(2);
    const geral = {
      lojas: resultado.length,
      lojasSemChave: semChave.map((l) => ({ nome: l.nome, stonecode: l.stonecode, cnpj: l.cnpjFmt })),
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

export default router;
