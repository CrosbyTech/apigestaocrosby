// ============================================================
// CONCILIAÇÃO STONE — extrato diário de transações de cartão
//
// Consome a API de Conciliação Stone (fluxo "cliente Stone"):
//   1. GET .../v2/merchant/{stoneCode}/conciliation-file/{AAAAMMDD}
//      com Basic Auth (apiKey) + header x-user-type: client
//   2. A API responde 307 → Location aponta p/ blob Azure (SAS na URL)
//   3. Baixa o blob SEM Authorization; conteúdo é XML gzipado
//   4. Descompacta, faz parse do XML e devolve JSON normalizado
//
// Endpoints:
//   GET /api/conciliacao-stone/lojas
//   GET /api/conciliacao-stone/conciliacao?stonecode=&inicio=YYYY-MM-DD&fim=YYYY-MM-DD
// ============================================================
import express from 'express';
import axios from 'axios';
import zlib from 'zlib';
import { XMLParser } from 'fast-xml-parser';
import {
  asyncHandler,
  successResponse,
  errorResponse,
} from '../utils/errorHandler.js';
import {
  STONE_LOJAS,
  getLojaByStonecode,
  getLojasPublic,
} from '../config/stoneConciliacao.js';

const router = express.Router();

const STONE_BASE = 'https://conciliation.stone.com.br';
const MAX_DIAS = 62; // teto de dias por consulta (evita varredura excessiva)

const xmlParser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false, // mantém tudo string (evita perder zeros à esquerda / precisão)
  trimValues: true,
});

// Garante array mesmo quando o parser devolve objeto único ou undefined
const toArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

const num = (v) => {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// "20260605" → "2026-06-05" | "20260605131754" → "2026-06-05 13:17:54"
const fmtStoneDate = (s) => {
  if (!s) return null;
  const str = String(s);
  if (str.length >= 8) {
    const base = `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`;
    if (str.length >= 14) {
      return `${base} ${str.slice(8, 10)}:${str.slice(10, 12)}:${str.slice(12, 14)}`;
    }
    return base;
  }
  return str;
};

// "2026-06-05" → "20260605"
const toStoneDate = (iso) => String(iso || '').replace(/-/g, '').slice(0, 8);

// Mapeamentos de códigos → rótulos legíveis (best-effort; cai no código cru)
const BRANDS = {
  1: 'Visa',
  2: 'Mastercard',
  3: 'Amex',
  4: 'Elo',
  5: 'Hipercard',
  6: 'Hiper',
  9: 'Outros',
};
const ACCOUNT_TYPES = { 1: 'Débito', 2: 'Crédito' };
const ENTRY_MODES = {
  1: 'Chip',
  2: 'Tarja',
  3: 'Digitado',
  4: 'Contactless',
  7: 'E-commerce',
};
const FEE_TYPES = {
  1: 'Taxa antecip. + MDR',
  2: 'Taxa única',
  255: 'Default',
};
const label = (map, code) => map[Number(code)] || (code != null ? `Cód. ${code}` : '—');

// ──────────────────────────────────────────────────────────────
// Baixa e parseia o arquivo de conciliação de UM dia
// Retorna { transacoes:[], trailer:{}, header:{} } ou lança erro
// ──────────────────────────────────────────────────────────────
async function baixarConciliacaoDia(loja, dataStone, layout = 'XML2_2') {
  const url = `${STONE_BASE}/v2/merchant/${loja.stonecode}/conciliation-file/${dataStone}?layout=${layout}`;
  const basic = Buffer.from(`${loja.apiKey}:`).toString('base64');

  // Passo 1+2: dispara request e captura o redirect 307 (sem segui-lo)
  let location = null;
  try {
    const resp = await axios.get(url, {
      headers: {
        Authorization: `Basic ${basic}`,
        'x-user-type': 'client',
        'Accept-Encoding': 'gzip',
      },
      maxRedirects: 0,
      validateStatus: (s) => s === 307 || s === 302 || s === 200,
      responseType: 'arraybuffer',
      timeout: 30000,
    });
    if (resp.status === 200) {
      // Caso raro: a API devolveu o arquivo direto
      return parseConciliacaoBuffer(Buffer.from(resp.data), dataStone);
    }
    location = resp.headers?.location;
  } catch (err) {
    const status = err?.response?.status;
    if (status === 401)
      throw new Error('Falha de autenticação na Stone (401). Verifique a chave.');
    if (status === 403)
      throw new Error('Chave sem permissão para este StoneCode (403).');
    if (status === 307 || status === 302) {
      location = err?.response?.headers?.location;
    } else {
      throw err;
    }
  }

  if (!location) throw new Error('Stone não retornou o arquivo (sem redirect).');

  // Passo 3: baixa o blob SEM Authorization (SAS token vai na URL)
  const blob = await axios.get(location, {
    responseType: 'arraybuffer',
    timeout: 30000,
    // decompress:true (default) trata Content-Encoding de transporte;
    // o conteúdo em repouso ainda pode estar gzipado — tratado abaixo.
  });

  return parseConciliacaoBuffer(Buffer.from(blob.data), dataStone);
}

function parseConciliacaoBuffer(buf, dataStone) {
  // O blob fica gzipado em repouso → detecta magic bytes 0x1f 0x8b
  let xml;
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    xml = zlib.gunzipSync(buf).toString('utf-8');
  } else {
    xml = buf.toString('utf-8');
  }

  const parsed = xmlParser.parse(xml);
  const conc = parsed?.Conciliation || {};
  const header = conc.Header || {};
  const trailer = conc.Trailer || {};

  const ftRoot = conc.FinancialTransactions || {};
  const transacoesRaw = toArray(ftRoot.Transaction);

  const transacoes = transacoesRaw.map((t) => {
    const installments = toArray(t.Installments?.Installment).map((p) => ({
      numero: num(p.InstallmentNumber),
      bruto: num(p.GrossAmount),
      liquido: num(p.NetAmount),
      previsaoPagamento: fmtStoneDate(p.PrevisionPaymentDate),
    }));
    const bruto = num(t.CapturedAmount) || num(t.AuthorizedAmount);
    const liquido = installments.reduce((s, p) => s + p.liquido, 0);
    return {
      nsu: t.AcquirerTransactionKey || null,
      chaveIniciador: t.InitiatorTransactionKey || null,
      dataAutorizacao: fmtStoneDate(t.AuthorizationDateTime),
      dataCaptura: fmtStoneDate(t.CaptureLocalDateTime),
      bandeira: label(BRANDS, t.BrandId),
      bandeiraId: t.BrandId != null ? Number(t.BrandId) : null,
      tipoConta: label(ACCOUNT_TYPES, t.AccountType),
      formaEntrada: label(ENTRY_MODES, t.EntryMode),
      tipoTaxa: label(FEE_TYPES, t.FeeType),
      cartao: t.CardNumber || null,
      codAutorizacao: t.IssuerAuthorizationCode || null,
      parcelas: num(t.NumberOfInstallments) || installments.length || 1,
      internacional: String(t.International).toLowerCase() === 'true',
      serialPos: t.Poi?.SerialNumber || null,
      valorBruto: bruto,
      valorLiquido: liquido,
      taxa: +(bruto - liquido).toFixed(2),
      installments,
    };
  });

  return {
    dataStone,
    data: fmtStoneDate(dataStone),
    header: {
      stonecode: header.StoneCode || null,
      geradoEm: fmtStoneDate(header.GenerationDateTime),
      layout: header.LayoutVersion || null,
    },
    trailer: {
      capturadas: num(trailer.CapturedTransactionsQuantity),
      canceladas: num(trailer.CanceledTransactionsQuantity),
      parcelasPagas: num(trailer.PaidInstallmentsQuantity),
      chargebacks: num(trailer.ChargebacksQuantity),
    },
    transacoes,
  };
}

// Gera lista de datas (YYYYMMDD) entre inicio e fim (inclusive)
function rangeDatas(inicioIso, fimIso) {
  const out = [];
  const ini = new Date(`${inicioIso}T00:00:00Z`);
  const fim = new Date(`${fimIso}T00:00:00Z`);
  if (isNaN(ini) || isNaN(fim) || ini > fim) return out;
  for (let d = new Date(ini); d <= fim; d.setUTCDate(d.getUTCDate() + 1)) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    out.push(`${y}${m}${day}`);
  }
  return out;
}

// ──────────────────────────────────────────────────────────────
// GET /lojas — seletor do frontend (sem expor chaves)
// ──────────────────────────────────────────────────────────────
router.get('/lojas', (req, res) => {
  return successResponse(res, getLojasPublic());
});

// ──────────────────────────────────────────────────────────────
// GET /conciliacao?stonecode=&inicio=&fim=  (ou ?data= para 1 dia)
// ──────────────────────────────────────────────────────────────
router.get(
  '/conciliacao',
  asyncHandler(async (req, res) => {
    const { stonecode, inicio, fim, data, layout } = req.query;

    if (!stonecode) return errorResponse(res, 'Parâmetro "stonecode" obrigatório.', 400);
    const loja = getLojaByStonecode(stonecode);
    if (!loja) return errorResponse(res, 'StoneCode não configurado no servidor.', 404);

    const inicioIso = data || inicio;
    const fimIso = data || fim || inicio;
    if (!inicioIso) return errorResponse(res, 'Informe "data" ou "inicio"/"fim".', 400);

    const datas = rangeDatas(inicioIso, fimIso);
    if (!datas.length) return errorResponse(res, 'Intervalo de datas inválido.', 400);
    if (datas.length > MAX_DIAS)
      return errorResponse(res, `Intervalo máximo de ${MAX_DIAS} dias.`, 400);

    const dias = [];
    const erros = [];
    // Sequencial p/ respeitar rate limit da Stone
    for (const dStone of datas) {
      try {
        const dia = await baixarConciliacaoDia(loja, dStone, layout || 'XML2_2');
        dias.push(dia);
      } catch (err) {
        erros.push({ data: fmtStoneDate(dStone), erro: err.message });
      }
    }

    const transacoes = dias.flatMap((d) =>
      d.transacoes.map((t) => ({ ...t, dataArquivo: d.data })),
    );
    const resumo = {
      qtdTransacoes: transacoes.length,
      totalBruto: +transacoes.reduce((s, t) => s + t.valorBruto, 0).toFixed(2),
      totalLiquido: +transacoes.reduce((s, t) => s + t.valorLiquido, 0).toFixed(2),
      totalTaxa: +transacoes.reduce((s, t) => s + t.taxa, 0).toFixed(2),
      diasConsultados: datas.length,
      diasComErro: erros.length,
    };

    return successResponse(res, {
      loja: { nome: loja.nome, cnpj: loja.cnpjFmt, stonecode: loja.stonecode },
      periodo: { inicio: inicioIso, fim: fimIso },
      resumo,
      transacoes,
      dias: dias.map((d) => ({ data: d.data, trailer: d.trailer })),
      erros,
    });
  }),
);

export default router;
