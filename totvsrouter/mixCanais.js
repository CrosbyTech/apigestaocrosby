// =============================================================================
// MIX DE CANAIS — participação de cada canal no faturamento, mês a mês.
//
// Fonte por mês (nesta ordem de prioridade):
//   1. tabela mix_canais_mensal (migrations/mix_canais_mensal.sql): histórico
//      fechado (jan–jul/2026, relatório "Ds. Tipo Cliente") ou ajuste manual;
//   2. HISTORICO_FIXO abaixo (mesmos números do jan–jul/2026) — vale enquanto a
//      migration não rodou, para a tela não depender do TOTVS para o passado;
//   3. New Forecast: POST interno /sale-panel/faturamento-vendedor-semanal do
//      mês inteiro (blocos 1-7, 8-14, 15-21, 22-28, 29+ — a mesma régua do New
//      Forecast, então os blocos fechados vêm do cache new_forecast_semana_cache)
//      com as chaves do painel mapeadas para os canais do mix.
// Mês que ainda não começou → origem 'futuro', sem valores.
// SHOWROOM / FABRICAS (expedição: showroom + novidades) NÃO aparece como
// canal: o gestor manda 85% para FRANQUIAS e 15% para MULTIMARCAS
// (SHOWROOM_SPLIT) — vale para o forecast e para linha gravada com essa chave.
//
// GET    /api/totvs/mix-canais?ano=2026&refresh=1
// POST   /api/totvs/mix-canais/mes   { mes:'YYYY-MM', canais:{CANAL:valor}, observacao? }
// DELETE /api/totvs/mix-canais/mes?mes=YYYY-MM   (volta a calcular do forecast)
// =============================================================================
import express from 'express';
import axios from 'axios';
import {
  asyncHandler,
  successResponse,
  errorResponse,
} from '../utils/errorHandler.js';
import supabase from '../config/supabase.js';

const router = express.Router();

// Ordem fixa dos canais na tela (a cor de cada um segue esta ordem no frontend)
export const MIX_CANAIS = [
  'VAREJO',
  'REVENDA',
  'FRANQUIAS',
  'MULTIMARCAS',
  'BAZAR',
  'BLUECRED',
  'MAGAZINE JESUS',
  'OUTROS',
];

// Expedição (showroom/fábricas + novidades) rateada entre dois canais
const SHOWROOM_KEY = 'SHOWROOM / FABRICAS';
const SHOWROOM_SPLIT = { FRANQUIAS: 0.85, MULTIMARCAS: 0.15 };

// Chave do /faturamento-vendedor-semanal → canal do mix. MULTIMARCAS usa as
// chaves legadas por vendedor (MTM_*), que o backend ainda publica; VEND_* e
// VEND_241_* ficam de fora para não contar em dobro.
const FORECAST_PARA_MIX = {
  VAREJO: 'VAREJO',
  BLUECRED: 'BLUECRED',
  REVENDA: 'REVENDA',
  FRANQUIAS: 'FRANQUIAS',
  MTM_RAFAEL: 'MULTIMARCAS',
  MTM_DAVID: 'MULTIMARCAS',
  MTM_ARTHUR: 'MULTIMARCAS',
  MTM_YAGO: 'MULTIMARCAS',
  BAZAR: 'BAZAR',
  SHOWROOM: SHOWROOM_KEY, // rateado em normaliza()
  NOVIDADES: SHOWROOM_KEY,
  RICARDO_ELETRO: 'MAGAZINE JESUS',
};

// Jan–jul/2026 do relatório "Ds. Tipo Cliente" (mesmos números da migration).
// O relatório lista 5 canais, mas o Total global é maior: a diferença entra
// em OUTROS para os percentuais baterem com o relatório.
const HISTORICO_FIXO = {
  '2026-01': { VAREJO: 319965.05, REVENDA: 277992.41, FRANQUIAS: 187166.9, MULTIMARCAS: 166607.03, BAZAR: 25083.61, OUTROS: 17178.5 },
  '2026-02': { VAREJO: 280689.46, REVENDA: 225296.15, FRANQUIAS: 106478.3, MULTIMARCAS: 177559.96, BAZAR: 38251.6, OUTROS: 60478.91 },
  '2026-03': { VAREJO: 293356.84, REVENDA: 265181.57, FRANQUIAS: 123422.98, MULTIMARCAS: 302042.51, BAZAR: 25075.1, OUTROS: 63495.8 },
  '2026-04': { VAREJO: 348542.26, REVENDA: 208221.05, FRANQUIAS: 261865.01, MULTIMARCAS: 280552.15, BAZAR: 22055.94, OUTROS: 5924.02 },
  '2026-05': { VAREJO: 331406.76, REVENDA: 193692.01, FRANQUIAS: 454966.98, MULTIMARCAS: 337400.29, BAZAR: 34794.47, OUTROS: 4940 },
  '2026-06': { VAREJO: 372333.15, REVENDA: 151739.08, FRANQUIAS: 273191.66, MULTIMARCAS: 174790.99, BAZAR: 19104.85, OUTROS: 6380 },
  '2026-07': { VAREJO: 296520.86, REVENDA: 160574.81, FRANQUIAS: 431350.61, MULTIMARCAS: 289969.7, BAZAR: 24680.11, OUTROS: 13382.81 },
};

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const isMes = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || ''));
const hojeIso = () => new Date().toISOString().slice(0, 10);
const ultimoDia = (mes) => {
  const [y, m] = mes.split('-').map(Number);
  return `${mes}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
};

// Garante todas as chaves do mix (canal sem valor = 0 → "sem movimentação").
// SHOWROOM / FABRICAS é rateado (85% FRANQUIAS / 15% MULTIMARCAS); outra
// chave desconhecida gravada à mão não some: vai para OUTROS.
const normaliza = (canais) => {
  const out = {};
  for (const c of MIX_CANAIS) out[c] = r2(canais?.[c]);
  for (const [k, v] of Object.entries(canais || {})) {
    if (MIX_CANAIS.includes(k)) continue;
    const valor = Number(v) || 0;
    if (k === SHOWROOM_KEY) {
      for (const [alvo, fator] of Object.entries(SHOWROOM_SPLIT))
        out[alvo] = r2(out[alvo] + valor * fator);
      continue;
    }
    out.OUTROS = r2(out.OUTROS + valor);
  }
  return out;
};
const soma = (canais) =>
  r2(Object.values(canais || {}).reduce((a, b) => a + (Number(b) || 0), 0));

// Cache em memória do que vem do forecast (o cálculo frio bate no TOTVS).
// Mês fechado dura 6 h; mês corrente 30 min (ainda recebe venda).
const FORECAST_CACHE = new Map(); // mes → { canais, expira }
const forecastDoMes = async (mes, refresh) => {
  const agora = Date.now();
  const hit = FORECAST_CACHE.get(mes);
  if (!refresh && hit && hit.expira > agora) return { canais: hit.canais, doCache: true };
  const datemin = `${mes}-01`;
  const datemax = ultimoDia(mes);
  const INTERNAL = `http://localhost:${process.env.PORT || 4100}/api/totvs/sale-panel/faturamento-vendedor-semanal`;
  const r = await axios.post(
    INTERNAL,
    { datemin, datemax, usarCache: refresh ? false : true, salvar: true },
    { timeout: 600000 },
  );
  const payload = r.data?.data || r.data || {};
  const canais = {};
  for (const [chave, semanas] of Object.entries(payload.canais || {})) {
    const alvo = FORECAST_PARA_MIX[chave];
    if (!alvo) continue;
    const total = Object.values(semanas || {}).reduce((a, b) => a + (Number(b) || 0), 0);
    canais[alvo] = r2((canais[alvo] || 0) + total);
  }
  const fechado = datemax < hojeIso();
  FORECAST_CACHE.set(mes, {
    canais,
    expira: agora + (fechado ? 6 : 0.5) * 60 * 60 * 1000,
  });
  return { canais, doCache: false };
};

router.get(
  '/mix-canais',
  asyncHandler(async (req, res) => {
    req.setTimeout(600000);
    res.setTimeout(600000);
    const ano = String(req.query.ano || hojeIso().slice(0, 4));
    if (!/^\d{4}$/.test(ano)) return errorResponse(res, 'ano inválido', 400, 'BAD_YEAR');
    const refresh = ['1', 'true'].includes(String(req.query.refresh || ''));

    // 1. linhas gravadas (histórico/manual)
    const gravados = new Map();
    const { data: rows, error } = await supabase
      .from('mix_canais_mensal')
      .select('mes, canais, origem, observacao, atualizado_em')
      .like('mes', `${ano}-%`);
    if (error) console.warn(`[mix-canais] tabela mix_canais_mensal: ${error.message}`);
    for (const r of rows || []) gravados.set(r.mes, r);

    const hoje = hojeIso();
    const meses = [];
    const avisos = [];
    for (let m = 1; m <= 12; m++) {
      const mes = `${ano}-${String(m).padStart(2, '0')}`;
      const inicio = `${mes}-01`;
      const gravado = gravados.get(mes);
      if (gravado) {
        meses.push({
          mes,
          origem: gravado.origem === 'historico' ? 'historico' : 'manual',
          canais: normaliza(gravado.canais),
          observacao: gravado.observacao || null,
          atualizado_em: gravado.atualizado_em || null,
        });
        continue;
      }
      if (HISTORICO_FIXO[mes]) {
        meses.push({ mes, origem: 'historico', canais: normaliza(HISTORICO_FIXO[mes]) });
        continue;
      }
      if (inicio > hoje) {
        meses.push({ mes, origem: 'futuro', canais: normaliza({}) });
        continue;
      }
      // 3. New Forecast (sequencial: cada mês já roda 2 semanas em paralelo)
      try {
        const { canais, doCache } = await forecastDoMes(mes, refresh);
        meses.push({
          mes,
          origem: 'forecast',
          canais: normaliza(canais),
          parcial: ultimoDia(mes) >= hoje,
          doCache,
        });
      } catch (e) {
        console.warn(`[mix-canais] forecast ${mes} falhou: ${e.message}`);
        avisos.push(`${mes}: ${e.message}`);
        meses.push({ mes, origem: 'erro', canais: normaliza({}), erro: e.message });
      }
    }

    for (const mm of meses) mm.total = soma(mm.canais);
    const acumulado = normaliza({});
    for (const mm of meses)
      if (mm.origem !== 'futuro' && mm.origem !== 'erro')
        for (const c of MIX_CANAIS) acumulado[c] = r2(acumulado[c] + mm.canais[c]);

    return successResponse(
      res,
      {
        ano,
        canais: MIX_CANAIS,
        meses,
        acumulado: { canais: acumulado, total: soma(acumulado) },
        avisos,
        geradoEm: new Date().toISOString(),
      },
      `Mix de canais ${ano}`,
    );
  }),
);

router.post(
  '/mix-canais/mes',
  asyncHandler(async (req, res) => {
    const { mes, canais, observacao } = req.body || {};
    if (!isMes(mes)) return errorResponse(res, "mes obrigatório ('YYYY-MM')", 400, 'BAD_MONTH');
    if (!canais || typeof canais !== 'object')
      return errorResponse(res, 'canais obrigatório ({ CANAL: valor })', 400, 'BAD_BODY');
    const row = {
      mes,
      canais: normaliza(canais),
      origem: 'manual',
      observacao: observacao ? String(observacao).slice(0, 500) : null,
      atualizado_em: new Date().toISOString(),
    };
    const { error } = await supabase
      .from('mix_canais_mensal')
      .upsert(row, { onConflict: 'mes' });
    if (error) return errorResponse(res, `Supabase: ${error.message}`, 500);
    FORECAST_CACHE.delete(mes);
    return successResponse(res, { ...row, total: soma(row.canais) }, `Mês ${mes} salvo`);
  }),
);

router.delete(
  '/mix-canais/mes',
  asyncHandler(async (req, res) => {
    const mes = String(req.query.mes || '');
    if (!isMes(mes)) return errorResponse(res, "mes obrigatório ('YYYY-MM')", 400, 'BAD_MONTH');
    const { error } = await supabase.from('mix_canais_mensal').delete().eq('mes', mes);
    if (error) return errorResponse(res, `Supabase: ${error.message}`, 500);
    FORECAST_CACHE.delete(mes);
    return successResponse(res, { mes }, `Mês ${mes} volta a ser calculado automaticamente`);
  }),
);

export default router;
