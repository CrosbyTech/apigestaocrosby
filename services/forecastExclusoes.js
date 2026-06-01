// ─── Exclusões compartilhadas do Forecast/Faturamento por canal ───────────
// Algumas pessoas (lojas) saem ou entram em canais do CRM em datas específicas
// (ex: CROSBY RECIFE MALL virou loja própria em 21/05/2026, e por isso deixa
// de contar como Franquia a partir dessa data).
//
// Esta lógica é usada em:
//   • forecast.routes.js → /promessa-mensal, /promessa-semanal, /comparativo-anual
//   • crm.routes.js      → /faturamento-por-segmento, /canal-totals
//
// Mantemos um único ponto de verdade aqui para que todas as visões (Forecast,
// Por Canal, Métricas por Canal, drill-downs) batam.
// ───────────────────────────────────────────────────────────────────────────
import axios from 'axios';

// Regras de exclusão (uma por personCode/canal/data).
// dateFrom inclusivo: a partir desse dia (D ≥ dateFrom), as NFs com personCode
// no canal listado são SUBTRAÍDAS do total daquele canal.
export const FORECAST_EXCLUSOES = [
  {
    personCode: 29541,
    canal: 'franquia',
    // Excluir mês todo (não só a partir de 21/05) — solicitação do gestor
    // pra simplificar e evitar queries fragmentadas que estressam o TOTVS.
    dateFrom: '2026-05-01',
    description:
      'CROSBY RECIFE MALL LTDA — virou loja própria em 21/05/2026, exclusão estendida pro mês inteiro de maio.',
  },
];

// Ops por canal (espelha CANAL_CONFIG do crm.routes.js)
const CANAL_OPS = {
  franquia: [7234, 7240, 7802, 9124, 7259],
  multimarcas: [7235, 7241, 9127, 200],
  business: [7237, 7269, 7279, 7277],
};

// Cache pra evitar re-calcular exclusão a cada request
const EXCLUSOES_CACHE = new Map();
const EXCLUSOES_CACHE_TTL_REALTIME = 60 * 60 * 1000; // 1h
const EXCLUSOES_CACHE_TTL_PAST = 24 * 60 * 60 * 1000; // 24h
const EXCLUSOES_INFLIGHT = new Map(); // coalescing pra mesma chave

function toYmd(d) {
  if (typeof d === 'string') return d.slice(0, 10);
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toISOString().slice(0, 10);
}

async function calcularExclusaoNF({ personCode, ops, datemin, datemax }) {
  const { getToken } = await import('../utils/totvsTokenManager.js');
  const { TOTVS_BASE_URL, httpsAgent, getBranchCodes } = await import(
    '../totvsrouter/totvsHelper.js'
  );
  const tk = await getToken();
  if (!tk?.access_token) return 0;
  let branchCodeList;
  try {
    branchCodeList = await getBranchCodes(tk.access_token);
  } catch (err) {
    console.warn(
      `[forecast/exclusoes] getBranchCodes falhou (${err.message}) — usando fallback.`,
    );
    branchCodeList = [
      1, 2, 5, 6, 11, 50, 55, 65, 75, 85, 87, 88, 89, 90, 91, 92, 93, 94, 95,
      96, 97, 98, 99, 100, 101, 111, 200,
    ];
  }
  let total = 0;
  for (let page = 1; page <= 20; page++) {
    let resp;
    try {
      resp = await axios.post(
        `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`,
        {
          filter: {
            branchCodeList,
            operationCodeList: ops,
            operationType: 'Output',
            startIssueDate: `${datemin}T00:00:00`,
            endIssueDate: `${datemax}T23:59:59`,
          },
          expand: '',
          page,
          pageSize: 100,
        },
        {
          headers: { Authorization: `Bearer ${tk.access_token}` },
          httpsAgent,
          timeout: 60000,
        },
      );
    } catch (err) {
      console.warn(`[forecast/exclusoes] pág ${page} falhou: ${err.message}`);
      break;
    }
    const items = resp.data?.items || [];
    if (items.length === 0) break;
    for (const nf of items) {
      if (nf.invoiceStatus === 'Canceled' || nf.invoiceStatus === 'Deleted') continue;
      if (parseInt(nf.personCode) !== personCode) continue;
      total += parseFloat(nf.totalValue || 0);
    }
    if (items.length < 100) break;
  }
  return total;
}

// Calcula o total a EXCLUIR por canal para o período (datemin..datemax).
// Retorna Map<canal, valorExcluir>. Cache + coalescing pra anti-sobrecarga.
export async function getExclusoesPorCanal(datemin, datemax) {
  if (!datemin || !datemax) return new Map();
  const datemin_ymd = toYmd(datemin);
  const datemax_ymd = toYmd(datemax);
  const result = new Map();
  const hojeYmd = toYmd(new Date());
  const isPast = datemax_ymd < hojeYmd;
  const ttl = isPast ? EXCLUSOES_CACHE_TTL_PAST : EXCLUSOES_CACHE_TTL_REALTIME;

  for (const ex of FORECAST_EXCLUSOES) {
    const dfrom = ex.dateFrom > datemin_ymd ? ex.dateFrom : datemin_ymd;
    if (dfrom > datemax_ymd) continue;

    const ops = CANAL_OPS[ex.canal];
    if (!Array.isArray(ops) || ops.length === 0) continue;

    const cacheKey = `${ex.personCode}|${ex.canal}|${dfrom}|${datemax_ymd}`;
    const cached = EXCLUSOES_CACHE.get(cacheKey);
    let valor;
    if (cached && Date.now() - cached.ts < ttl) {
      valor = cached.valor;
    } else if (EXCLUSOES_INFLIGHT.has(cacheKey)) {
      // Coalescing: outra request já está calculando essa mesma chave
      try {
        valor = await EXCLUSOES_INFLIGHT.get(cacheKey);
      } catch {
        valor = 0;
      }
    } else {
      const promise = calcularExclusaoNF({
        personCode: ex.personCode,
        ops,
        datemin: dfrom,
        datemax: datemax_ymd,
      });
      EXCLUSOES_INFLIGHT.set(cacheKey, promise);
      try {
        valor = await promise;
      } catch (err) {
        console.warn(
          `[forecast/exclusoes] cálculo falhou: ${err.message}`,
        );
        valor = 0;
      } finally {
        EXCLUSOES_INFLIGHT.delete(cacheKey);
      }
      EXCLUSOES_CACHE.set(cacheKey, { valor, ts: Date.now() });
      if (EXCLUSOES_CACHE.size > 50) {
        const oldest = [...EXCLUSOES_CACHE.entries()].sort(
          (a, b) => a[1].ts - b[1].ts,
        )[0];
        EXCLUSOES_CACHE.delete(oldest[0]);
      }
      if (valor > 0) {
        console.log(
          `[forecast/exclusoes] ${ex.canal} − R$${valor.toFixed(2)} (personCode=${ex.personCode}, ${dfrom}..${datemax_ymd}) — ${ex.description?.slice(0, 50)}`,
        );
      }
    }
    result.set(ex.canal, (result.get(ex.canal) || 0) + valor);
  }
  return result;
}

// Aplica exclusões em um Map<canal, valor> (segMap). Modifica IN-PLACE.
// Retorna o próprio segMap (conveniência pra encadeamento).
export async function aplicarExclusoesForecast(segMap, datemin, datemax) {
  if (!segMap) return segMap;
  const exclusoes = await getExclusoesPorCanal(datemin, datemax);
  for (const [canal, valor] of exclusoes.entries()) {
    if (valor > 0 && segMap[canal] != null) {
      const before = Number(segMap[canal] || 0);
      segMap[canal] = Math.max(0, before - valor);
      console.log(
        `[forecast/exclusoes] ${canal}: R$${before.toFixed(2)} → R$${segMap[canal].toFixed(2)} (−R$${valor.toFixed(2)} excluído)`,
      );
    }
  }
  return segMap;
}

// Aplica exclusão a UM canal-totals (objeto com {modulo, invoice_value, ...}).
// Usado pelo /canal-totals do crm.routes.js. Subtrai o valor da exclusão de
// invoice_value, gross_invoice_value E também rateia a subtração proporcional
// pelo per_branch e per_seller (drill-down) → soma do drill-down bate com o
// total da tabela. NOOP pra módulos sem regra ativa.
export async function aplicarExclusaoCanalTotal(ctData, datemin, datemax) {
  if (!ctData || !ctData.modulo) return ctData;
  const exclusoes = await getExclusoesPorCanal(datemin, datemax);
  const valor = exclusoes.get(ctData.modulo);
  if (valor && valor > 0) {
    const before = Number(ctData.invoice_value || 0);
    const novo = Math.max(0, before - valor);
    if (before !== novo) {
      console.log(
        `[forecast/exclusoes] canal-totals ${ctData.modulo}: R$${before.toFixed(2)} → R$${novo.toFixed(2)} (−R$${valor.toFixed(2)})`,
      );
      ctData.invoice_value = novo;
      if (ctData.gross_invoice_value != null) {
        ctData.gross_invoice_value = Math.max(
          0,
          Number(ctData.gross_invoice_value || 0) - valor,
        );
      }
      // Rateia a exclusão proporcionalmente entre as linhas do drill-down
      // (per_branch e per_seller) — garante que a soma do drilldown bata com
      // o total exibido na tabela. Sem isso, a UI mostra valores divergentes
      // (ex: Franquia tabela = 100k, mas soma das filiais = 102k).
      const aplicarRateio = (arr, field = 'invoice_value') => {
        if (!Array.isArray(arr) || arr.length === 0) return;
        const total = arr.reduce((s, x) => s + Number(x[field] || 0), 0);
        if (total <= 0) return;
        for (const x of arr) {
          const peso = Number(x[field] || 0) / total;
          const subtrair = valor * peso;
          x[field] = Math.max(0, Number(x[field] || 0) - subtrair);
          if (x.invoice_value_gross != null) {
            x.invoice_value_gross = Math.max(
              0,
              Number(x.invoice_value_gross || 0) - subtrair,
            );
          }
        }
      };
      aplicarRateio(ctData.per_branch);
      aplicarRateio(ctData.per_seller);
      ctData.exclusao_aplicada = valor;
    }
  }
  return ctData;
}
