// ============================================================================
// Contas a Receber — Receita Financeira (pedido do Yago, 25/10/2026).
//
//   GET /api/contas-receber/receita-financeira?inicio=AAAA-MM-DD&fim=AAAA-MM-DD[&refresh=1]
//
// Faturas (tipo de documento 1) PAGAS no período, pela data de pagamento, com a
// mesma base da tela Metas Inadimplência (situação normal, fora renegociação).
// Receita financeira = o que o cliente pagou a mais do que a fatura (juros,
// multa, taxas). Ficam de fora, mas listadas com o motivo:
//   - sem_valor_pago : tem data de liquidação e valor pago zero (baixa por
//                      abatimento/decurso — tipo de baixa 17 na prática);
//   - credev         : fatura quitada com crédito do cliente — na mesma baixa
//                      (settlementBranchCode + settlementDate + settlementSequence)
//                      há um título CREDEV (tipo de documento 20). Confirmado
//                      na amostra jul–out/2026: 90 faturas, todas com tipo de baixa 1;
//   - renegociacao   : tipo de baixa 9 — o saldo virou outro título, não entrou dinheiro.
// Pegadinha TOTVS: startSettlementDate é ignorado; o filtro é startPaymentDate.
// Resultado em cache por RECEITA_FIN_CACHE_MIN (5 min) por período.
// ============================================================================
import express from "express";
import axios from "axios";
import {
  asyncHandler,
  successResponse,
  errorResponse,
} from "../utils/errorHandler.js";
import { requireAuth } from "../middlewares/auth.js";
import { postTotvs } from "../services/bluecardLimite.js";
import { getToken } from "../utils/totvsTokenManager.js";
import { TOTVS_BASE_URL } from "../totvsrouter/totvsHelper.js";

const router = express.Router();

const TP_FATURA = 1;
const TP_CREDEV = 20;
const TP_BAIXA_RENEGOCIACAO = 9;
const STATUS_NORMAL = 1;
const ATRASO_SEM_JUROS_DIAS = 3;
const TAXA_BOLETO = 0.98; // tarifa do boleto embutida no valor pago; não é juros
const ehTaxaBoleto = (diferenca) => Math.abs(diferenca - TAXA_BOLETO) < 0.005;
const PAGE_SIZE = 1000;
const MAX_PAGINAS = 60;
const TOTVS_TIMEOUT_MS = Number(
  process.env.RECEITA_FIN_TOTVS_TIMEOUT_MS || 120000,
);
const CACHE_MS = Number(process.env.RECEITA_FIN_CACHE_MIN || 5) * 60 * 1000;

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const ymd = (v) => (v ? String(v).slice(0, 10) : null);
const num = (v) =>
  v === null || v === undefined || v === "" ? 0 : Number(v) || 0;
const soDigitos = (s) => String(s || "").replace(/\D/g, "");
const diasEntre = (a, b) => {
  if (!a || !b) return null;
  return Math.round(
    (new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000,
  );
};
const dataValida = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

// ─── TOTVS ──────────────────────────────────────────────────────────────────
// Uma página do TOTVS, com até 3 tentativas: o gateway deles devolve 502 ou
// aborta a conexão quando a janela de pagamento é grande.
async function paginaTotvs(filter, page, tentativa = 1) {
  try {
    return await postTotvs(
      "/accounts-receivable/v2/documents/search",
      { filter, page, pageSize: PAGE_SIZE, order: "expiredDate" },
      { timeout: TOTVS_TIMEOUT_MS },
    );
  } catch (e) {
    const status = e.response?.status;
    const transitorio =
      !status ||
      status >= 500 ||
      status === 429 ||
      /abort|timeout/i.test(e.message || "");
    if (!transitorio || tentativa >= 3) throw e;
    await new Promise((r) => setTimeout(r, 1500 * tentativa));
    return paginaTotvs(filter, page, tentativa + 1);
  }
}

async function buscarTitulos(filter) {
  const primeira = await paginaTotvs(filter, 1);
  const totalPages = Math.min(primeira.data?.totalPages || 1, MAX_PAGINAS);
  let itens = [...(primeira.data?.items || [])];
  for (let ini = 2; ini <= totalPages; ini += 3) {
    const lote = [];
    for (let p = ini; p <= Math.min(ini + 2, totalPages); p++)
      lote.push(paginaTotvs(filter, p));
    for (const r of await Promise.all(lote))
      itens = itens.concat(r.data?.items || []);
  }
  return { itens, truncado: (primeira.data?.totalPages || 1) > MAX_PAGINAS };
}

// Janelas mensais dentro de [inicio, fim]: consultas menores respondem em
// segundos, enquanto o ano inteiro numa chamada só estoura o tempo do TOTVS.
function janelasMensais(inicio, fim) {
  const janelas = [];
  let ini = inicio;
  while (ini <= fim) {
    const [a, m] = ini.split("-").map(Number);
    const ultimo = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
    const ate = ultimo < fim ? ultimo : fim;
    janelas.push({ inicio: ini, fim: ate });
    const prox = new Date(Date.UTC(a, m, 1)).toISOString().slice(0, 10);
    ini = prox;
  }
  return janelas;
}

// Busca por janelas mensais, 2 janelas por vez (cada uma com faturas + CREDEV).
async function buscarPeriodo(inicio, fim) {
  const janelas = janelasMensais(inicio, fim);
  const fat = { itens: [], truncado: false };
  const cred = { itens: [], truncado: false };
  for (let i = 0; i < janelas.length; i += 2) {
    const grupo = janelas.slice(i, i + 2);
    const resultados = await Promise.all(
      grupo.map(async (j) => {
        const periodo = {
          startPaymentDate: `${j.inicio}T00:00:00`,
          endPaymentDate: `${j.fim}T23:59:59`,
        };
        const [f, c] = await Promise.all([
          buscarTitulos({
            ...periodo,
            documentTypeList: [TP_FATURA],
            statusList: [STATUS_NORMAL],
          }),
          buscarTitulos({ ...periodo, documentTypeList: [TP_CREDEV] }),
        ]);
        return { f, c };
      }),
    );
    for (const { f, c } of resultados) {
      fat.itens.push(...f.itens);
      fat.truncado ||= f.truncado;
      cred.itens.push(...c.itens);
      cred.truncado ||= c.truncado;
    }
  }
  return { fat, cred };
}

// Nome dos clientes (a consulta de títulos devolve só o CPF/CNPJ). Cache em memória.
const cacheNomes = new Map(); // customerCode → nome
async function nomesClientes(itens) {
  const pf = new Set();
  const pj = new Set();
  for (const it of itens) {
    if (it.customerCode == null || cacheNomes.has(it.customerCode)) continue;
    (soDigitos(it.customerCpfCnpj).length === 14 ? pj : pf).add(
      it.customerCode,
    );
  }
  if (!pf.size && !pj.size) return;
  const tokenData = await getToken();
  if (!tokenData?.access_token) return;
  const h = {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${tokenData.access_token}`,
    },
    timeout: 30000,
  };
  for (const [path, lista] of [
    ["/person/v2/individuals/search", [...pf]],
    ["/person/v2/legal-entities/search", [...pj]],
  ]) {
    for (let i = 0; i < lista.length; i += 50) {
      const lote = lista.slice(i, i + 50);
      try {
        const r = await axios.post(
          `${TOTVS_BASE_URL}${path}`,
          { filter: { personCodeList: lote }, page: 1, pageSize: 100 },
          h,
        );
        for (const x of r.data?.items || [])
          cacheNomes.set(x.code, x.name || x.fantasyName || null);
      } catch {
        /* sem nome: a tela mostra o código */
      }
    }
  }
}

// ─── cálculo ────────────────────────────────────────────────────────────────
const chaveBaixa = (t) =>
  `${t.settlementBranchCode}|${ymd(t.settlementDate)}|${t.settlementSequence}`;

function classificar(t, credevPorBaixa) {
  if (Number(t.dischargeType) === TP_BAIXA_RENEGOCIACAO)
    return { situacao: "renegociacao" };
  if (!(num(t.paidValue) > 0)) return { situacao: "sem_valor_pago" };
  const credev = credevPorBaixa.get(chaveBaixa(t));
  if (credev?.length) return { situacao: "credev", credev };
  return { situacao: "considerada" };
}

export async function calcularReceitaFinanceira({ inicio, fim }) {
  const { fat, cred } = await buscarPeriodo(inicio, fim);
  const avisos = [];
  if (fat.truncado)
    avisos.push(
      `Algum mês tem mais de ${MAX_PAGINAS * PAGE_SIZE} faturas: a lista veio cortada.`,
    );

  const credevPorBaixa = new Map();
  for (const c of cred.itens) {
    const k = chaveBaixa(c);
    credevPorBaixa.set(k, [
      ...(credevPorBaixa.get(k) || []),
      {
        nr_titulo: c.receivableCode,
        nr_parcela: c.installmentCode ?? 1,
        valor: r2(c.paidValue || c.installmentValue),
      },
    ]);
  }

  const faturas = fat.itens.filter(
    (t) => Number(t.documentType ?? TP_FATURA) === TP_FATURA && t.paymentDate,
  );
  await nomesClientes(faturas);

  const titulos = faturas.map((t) => {
    const { situacao, credev } = classificar(t, credevPorBaixa);
    const vlFatura = r2(t.installmentValue);
    const vlPago = r2(t.paidValue);
    const pagamento = ymd(t.paymentDate);
    const vencimento = ymd(t.expiredDate);
    const diasAtraso = Math.max(diasEntre(vencimento, pagamento) ?? 0, 0);
    const diferenca = situacao === "considerada" ? r2(vlPago - vlFatura) : 0;
    return {
      cd_empresa: t.branchCode,
      cd_cliente: t.customerCode,
      nm_cliente: cacheNomes.get(t.customerCode) || null,
      nr_cpfcnpj: t.customerCpfCnpj || null,
      nr_fatura: t.receivableCode,
      nr_parcela: t.installmentCode ?? 1,
      dt_emissao: ymd(t.issueDate),
      dt_vencimento: vencimento,
      dt_pagamento: pagamento,
      dt_liquidacao: ymd(t.settlementDate),
      dias_atraso: diasAtraso,
      vl_fatura: vlFatura,
      vl_pago: vlPago,
      vl_diferenca: diferenca,
      // % cobrado sobre o valor da fatura (juros + multa + taxas embutidos no pago)
      pct_juros: vlFatura > 0 ? r2((diferenca / vlFatura) * 100) : 0,
      // paga depois de 3 dias do vencimento sem juros: o "a mais" é no máximo a
      // taxa de boleto (R$ 0,98). A taxa continua somando na receita financeira;
      // só não conta como juros para este card.
      atraso_sem_juros:
        situacao === "considerada" &&
        diasAtraso > ATRASO_SEM_JUROS_DIAS &&
        diferenca <= TAXA_BOLETO + 0.005,
      so_taxa_boleto: diferenca > 0 && diferenca <= TAXA_BOLETO + 0.005,
      // receita dividida (regra do Yago, 25/10/2026): fatura paga com exatamente
      // R$ 0,98 a mais é TAXA de boleto; qualquer outro valor a mais é JUROS por
      // inteiro. Não usa os campos interestValue/assessmentValue do TOTVS, que
      // não estão configurados.
      vl_taxa_boleto: ehTaxaBoleto(diferenca) ? r2(diferenca) : 0,
      vl_juros_cobrado:
        diferenca > 0 && !ehTaxaBoleto(diferenca) ? r2(diferenca) : 0,
      vl_juros: r2(t.interestValue),
      vl_multa: r2(t.assessmentValue),
      vl_desconto: r2(t.discountValue),
      vl_abatimento: r2(t.rebateValue),
      tp_baixa: t.dischargeType ?? null,
      cd_portador: t.bearerCode ?? null,
      nm_portador: t.bearerName || null,
      situacao,
      credev: credev || null,
    };
  });

  const consideradas = titulos.filter((t) => t.situacao === "considerada");
  const soma = (lista, f) => r2(lista.reduce((a, t) => a + (f(t) || 0), 0));
  const bloco = (lista) => ({
    n: lista.length,
    clientes: new Set(lista.map((t) => t.cd_cliente)).size,
    vl_fatura: soma(lista, (t) => t.vl_fatura),
    vl_pago: soma(lista, (t) => t.vl_pago),
  });
  const resumo = {
    consideradas: {
      ...bloco(consideradas),
      receita_financeira: soma(consideradas, (t) => t.vl_diferenca),
      pago_a_mais: soma(
        consideradas.filter((t) => t.vl_diferenca > 0),
        (t) => t.vl_diferenca,
      ),
      pago_a_menos: soma(
        consideradas.filter((t) => t.vl_diferenca < 0),
        (t) => t.vl_diferenca,
      ),
      taxa_boleto: soma(consideradas, (t) => t.vl_taxa_boleto),
      juros_cobrado: soma(consideradas, (t) => t.vl_juros_cobrado),
      n_pago_a_mais: consideradas.filter((t) => t.vl_diferenca > 0).length,
      n_pago_a_menos: consideradas.filter((t) => t.vl_diferenca < 0).length,
      juros_totvs: soma(consideradas, (t) => t.vl_juros),
      multa_totvs: soma(consideradas, (t) => t.vl_multa),
      desconto_totvs: soma(consideradas, (t) => t.vl_desconto),
      // % médio cobrado: receita líquida sobre o valor das faturas consideradas
      pct_receita: (() => {
        const base = soma(consideradas, (t) => t.vl_fatura);
        return base > 0
          ? r2((soma(consideradas, (t) => t.vl_diferenca) / base) * 100)
          : 0;
      })(),
      atraso_sem_juros: {
        ...bloco(consideradas.filter((t) => t.atraso_sem_juros)),
        dias: ATRASO_SEM_JUROS_DIAS,
      },
    },
    desconsideradas: {
      sem_valor_pago: bloco(
        titulos.filter((t) => t.situacao === "sem_valor_pago"),
      ),
      credev: bloco(titulos.filter((t) => t.situacao === "credev")),
      renegociacao: bloco(titulos.filter((t) => t.situacao === "renegociacao")),
    },
  };

  const porMesMap = {};
  for (const t of consideradas) {
    const m = t.dt_pagamento.slice(0, 7);
    porMesMap[m] ||= {
      mes: m,
      n: 0,
      vl_fatura: 0,
      vl_pago: 0,
      receita_financeira: 0,
      pago_a_mais: 0,
      pago_a_menos: 0,
      taxa_boleto: 0,
      juros_cobrado: 0,
    };
    const b = porMesMap[m];
    b.n++;
    b.vl_fatura = r2(b.vl_fatura + t.vl_fatura);
    b.vl_pago = r2(b.vl_pago + t.vl_pago);
    b.receita_financeira = r2(b.receita_financeira + t.vl_diferenca);
    b.taxa_boleto = r2(b.taxa_boleto + t.vl_taxa_boleto);
    b.juros_cobrado = r2(b.juros_cobrado + t.vl_juros_cobrado);
    if (t.vl_diferenca > 0) b.pago_a_mais = r2(b.pago_a_mais + t.vl_diferenca);
    if (t.vl_diferenca < 0)
      b.pago_a_menos = r2(b.pago_a_menos + t.vl_diferenca);
  }

  titulos.sort((a, b) =>
    a.dt_pagamento < b.dt_pagamento
      ? -1
      : a.dt_pagamento > b.dt_pagamento
        ? 1
        : b.vl_diferenca - a.vl_diferenca,
  );

  return {
    periodo: { inicio, fim },
    geradoEm: new Date().toISOString(),
    avisos,
    resumo,
    porMes: Object.values(porMesMap).sort((a, b) => (a.mes < b.mes ? -1 : 1)),
    titulos,
  };
}

// ─── cache + rota ───────────────────────────────────────────────────────────
const cache = new Map(); // `${inicio}|${fim}` → { em, dados, promessa }
async function obter({ inicio, fim }, refresh) {
  const key = `${inicio}|${fim}`;
  const hit = cache.get(key);
  if (!refresh && hit?.dados && Date.now() - hit.em < CACHE_MS)
    return { ...hit.dados, cache: true };
  if (hit?.promessa) return hit.promessa;
  const promessa = calcularReceitaFinanceira({ inicio, fim })
    .then((dados) => {
      cache.set(key, { em: Date.now(), dados });
      return dados;
    })
    .finally(() => {
      const atual = cache.get(key);
      if (atual?.promessa === promessa)
        cache.set(key, { em: atual.em || 0, dados: atual.dados });
    });
  cache.set(key, { ...(hit || {}), promessa });
  return promessa;
}

router.use(requireAuth);

router.get(
  "/receita-financeira",
  asyncHandler(async (req, res) => {
    const { inicio, fim } = req.query;
    if (!dataValida(inicio) || !dataValida(fim))
      return errorResponse(
        res,
        "Informe inicio e fim no formato AAAA-MM-DD",
        400,
        "MISSING_PARAMS",
      );
    if (inicio > fim)
      return errorResponse(
        res,
        "A data inicial não pode ser maior que a final",
        400,
        "INVALID_PERIOD",
      );
    req.setTimeout(5 * 60 * 1000);
    const refresh = req.query.refresh === "1" || req.query.refresh === "true";
    const dados = await obter({ inicio, fim }, refresh);
    return successResponse(
      res,
      dados,
      "Receita financeira do contas a receber",
    );
  }),
);

export default router;
