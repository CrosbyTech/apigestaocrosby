// =============================================================================
// FORECAST DRE — receita bruta por canal de um mês, puxada do New Forecast.
//
// Automação pedida pela Niziany (27/10/2026): a partir de setembro/2026 a
// receita bruta da tela /forecast deixa de ser o número estático da planilha e
// passa a vir do módulo Comercial → New Forecast, já segmentada pelos canais da
// DRE (Varejo, Multimarcas, Franquia, Revenda, Bazar).
//
// Fonte: POST interno /api/totvs/sale-panel/faturamento-vendedor-semanal (o
// mesmo do New Forecast). Dele saem:
//   - canais base: VAREJO, REVENDA, BAZAR, FRANQUIAS (vend. 40 p/ franquia) e
//     MULTIMARCAS (soma dos vendedores MTM_*);
//   - o drill da EXPEDIÇÃO (showroom/fábricas), que o New Forecast separa por
//     cliente: franquia = nome "F<nº> - CROSBY" (ou contém CROSBY); o resto é
//     multimarcas. A operação 887 nesse drill é o BAZAR (já contado à parte) e
//     fica de fora do showroom.
// O showroom é então somado no canal certo:
//   FRANQUIA   = FRANQUIAS      + parte franquia do showroom
//   MULTIMARCAS= soma MTM_*     + parte multimarcas do showroom
//
// GET /api/forecast-dre/receita-canais?mes=YYYY-MM[&refresh=1]
// =============================================================================
import express from 'express';
import axios from 'axios';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';
import supabase from '../config/supabase.js';

const router = express.Router();

// Chaves do /faturamento-vendedor-semanal que somam em MULTIMARCAS (vendedores
// MTM). Espelha o FORECAST_PARA_MIX do mixCanais e os canais do New Forecast.
const CHAVES_MULTIMARCAS = ['MTM_RAFAEL', 'MTM_DAVID', 'MTM_ARTHUR', 'MTM_YAGO', 'MTM_JHEMYSON'];

// Cliente de franquia: nome fantasia "F<nº> - CROSBY ..." ou que contém CROSBY
// (mesma régua do New Forecast — ehClienteFranquia no front e getFranquia no
// backend do CRM).
const ehClienteFranquia = (nome) => {
  const n = String(nome || '').toUpperCase().trim();
  if (!n) return false;
  return /^F\s*\d{1,4}\s*-/.test(n) || /\bCROSBY\b/.test(n);
};

// Operação do drill de expedição que NÃO é showroom (é o Bazar, contado à parte)
const OP_BAZAR_EXPEDICAO = 887;

// CREDEV (Niziany, 28/10/2026): vem do Contas a Receber — faturas com forma de
// pagamento CREDEV (tp_documento 20), por data de emissão, só das FILIAIS
// (empresas cd < 5999 e fora de 98/980), situação NORMAIS. Soma vl_fatura.
const TP_DOCUMENTO_CREDEV = '20';
const FRANQUIA_CODES = ['98', '980'];

let _filiaisCache = null;
async function getFiliais(base) {
  if (_filiaisCache) return _filiaisCache;
  const r = await axios.get(`${base}/api/totvs/branches`, { timeout: 120000 });
  const lista = r.data?.data?.data || r.data?.data || [];
  _filiaisCache = lista
    .filter((e) => {
      const c = parseInt(e.cd_empresa, 10);
      return c < 5999 && !FRANQUIA_CODES.includes(String(e.cd_empresa));
    })
    .map((e) => e.cd_empresa);
  return _filiaisCache;
}

async function calcularCredev(base, mes) {
  const datemin = `${mes}-01`;
  const datemax = ultimoDia(mes);
  const filiais = await getFiliais(base);
  const params = new URLSearchParams({
    dt_inicio: datemin,
    dt_fim: datemax,
    modo: 'emissao',
    tp_documento: TP_DOCUMENTO_CREDEV,
    situacao: '1',
    branches: filiais.join(','),
  });
  const r = await axios.get(
    `${base}/api/totvs/accounts-receivable/filter?${params.toString()}`,
    { timeout: 300000 },
  );
  const items = r.data?.data?.items || r.data?.items || [];
  const total = items.reduce((a, x) => a + (Number(x.vl_fatura) || 0), 0);
  // No DRE o CREDEV é uma redução → valor negativo.
  return -Math.round(total * 100) / 100;
}

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const somaSemanas = (semanas) =>
  Object.values(semanas || {}).reduce((a, b) => a + (Number(b) || 0), 0);
const ultimoDia = (mes) => {
  const [y, m] = mes.split('-').map(Number);
  return `${mes}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
};
const hojeIso = () => new Date().toISOString().slice(0, 10);

// Cache em memória: mês fechado dura 24 h; mês corrente 30 min (ainda recebe
// venda). Evita martelar o sale-panel (TOTVS) a cada abertura da tela.
const CACHE = new Map(); // mes → { dados, expira }

async function calcularMes(mes) {
  const datemin = `${mes}-01`;
  const datemax = ultimoDia(mes);
  const base = `http://localhost:${process.env.PORT || 4100}`;
  // Uma semana única cobrindo o mês inteiro → o drill (expedição por cliente)
  // vem junto na resposta (o cache semanal padrão não guarda drill).
  const resp = await axios.post(
    `${base}/api/totvs/sale-panel/faturamento-vendedor-semanal`,
    { datemin, datemax, usarCache: true, salvar: false, semanas: [{ s: 1, datemin, datemax }] },
    { timeout: 600000 },
  );
  const payload = resp.data?.data || resp.data || {};
  const canais = payload.canais || {};

  const varejo = somaSemanas(canais.VAREJO);
  const revenda = somaSemanas(canais.REVENDA);
  const bazar = somaSemanas(canais.BAZAR);
  const franquiasBase = somaSemanas(canais.FRANQUIAS);
  let multimarcasBase = 0;
  for (const k of CHAVES_MULTIMARCAS) multimarcasBase += somaSemanas(canais[k]);

  // Showroom/fábricas: separa por cliente a partir do drill da expedição.
  let showroomFranquia = 0;
  let showroomMultimarcas = 0;
  const drill = payload.drill || {};
  for (const bloco of Object.values(drill)) {
    for (const e of bloco?.expedicao || []) {
      if (Number(e.op) === OP_BAZAR_EXPEDICAO) continue; // é bazar, já contado
      const v = Number(e.valor) || 0;
      if (ehClienteFranquia(e.cliente_nome)) showroomFranquia += v;
      else showroomMultimarcas += v;
    }
  }

  const franquia = franquiasBase + showroomFranquia;
  const multimarcas = multimarcasBase + showroomMultimarcas;

  // CREDEV do Contas a Receber (não deixa a tela inteira cair se falhar)
  let credev = null;
  try {
    credev = await calcularCredev(base, mes);
  } catch (e) {
    console.warn(`[forecast-dre credev ${mes}] ${e.message}`);
  }

  return {
    mes,
    varejo: r2(varejo),
    multimarcas: r2(multimarcas),
    franquia: r2(franquia),
    revenda: r2(revenda),
    bazar: r2(bazar),
    credev,
    detalhe: {
      franquias_base: r2(franquiasBase),
      multimarcas_base: r2(multimarcasBase),
      showroom_franquia: r2(showroomFranquia),
      showroom_multimarcas: r2(showroomMultimarcas),
      showroom_total: r2(showroomFranquia + showroomMultimarcas),
    },
    fonte: 'new_forecast_sale_panel',
    calculado_em: new Date().toISOString(),
  };
}

router.get(
  '/receita-canais',
  asyncHandler(async (req, res) => {
    req.setTimeout(600000);
    res.setTimeout(600000);
    const mes = String(req.query.mes || '');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) {
      return errorResponse(res, "Informe mes no formato 'YYYY-MM'", 400, 'BAD_MES');
    }
    const refresh = ['1', 'true'].includes(String(req.query.refresh || ''));
    const agora = Date.now();
    const hit = CACHE.get(mes);
    if (!refresh && hit && hit.expira > agora) {
      return successResponse(res, { ...hit.dados, cache: true }, 'OK (cache)');
    }
    const dados = await calcularMes(mes);
    const fechado = ultimoDia(mes) < hojeIso();
    CACHE.set(mes, { dados, expira: agora + (fechado ? 24 * 60 : 30) * 60 * 1000 });
    return successResponse(res, dados, 'OK');
  }),
);

// ─── Config: quais meses são Realizado × Previsão (clicável na tela) ─────────
// Niziany (28/10/2026): ela mesma marca um mês como realizado sem pedir. Fica
// salvo em forecast_dre_config e vale para todos. A tela mescla isso por cima
// do tipo padrão da planilha.
router.get(
  '/config',
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase
      .from('forecast_dre_config')
      .select('mes, tipo');
    if (error) return errorResponse(res, error.message, 500, 'DB');
    const overrides = {};
    for (const r of data || []) overrides[r.mes] = r.tipo;
    return successResponse(res, { overrides }, 'OK');
  }),
);

router.post(
  '/config',
  asyncHandler(async (req, res) => {
    const mes = String(req.body?.mes || '');
    const tipo = String(req.body?.tipo || '');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) {
      return errorResponse(res, "mes inválido ('YYYY-MM')", 400, 'BAD_MES');
    }
    if (!['realizado', 'previsao'].includes(tipo)) {
      return errorResponse(res, "tipo deve ser 'realizado' ou 'previsao'", 400, 'BAD_TIPO');
    }
    const { error } = await supabase
      .from('forecast_dre_config')
      .upsert({ mes, tipo, atualizado_em: new Date().toISOString() }, { onConflict: 'mes' });
    if (error) return errorResponse(res, error.message, 500, 'DB');
    return successResponse(res, { mes, tipo }, 'OK');
  }),
);

export default router;
