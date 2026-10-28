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
import { DRYLAND_URL, DRYLAND_KEY } from '../services/drylandBaixas.js';

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

// CREDEV do Contas a Receber: total e por canal (a soma por canal BATE com o
// total — Niziany, 28/10/2026). Classifica cada fatura CREDEV pelo cliente:
//   pessoa física (CPF)                 → VAREJO (crédito de loja ao consumidor)
//   CNPJ "F<nº> - CROSBY" / contém CROSBY → FRANQUIA
//   CNPJ "MTM ..."                       → MULTIMARCAS
//   demais CNPJ                          → REVENDA
// O por-canal é só visualização; o total é o que entra na linha CREDEV.
async function calcularCredevCompleto(base, mes) {
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

  // Nome fantasia dos clientes (pes_pessoa) p/ classificar os CNPJ
  const codes = [...new Set(items.map((it) => Number(it.cd_cliente)).filter(Boolean))];
  const porCode = {};
  for (let i = 0; i < codes.length; i += 300) {
    try {
      const { data } = await supabase
        .from('pes_pessoa')
        .select('code, fantasy_name')
        .in('code', codes.slice(i, i + 300));
      for (const p of data || []) porCode[String(p.code)] = p;
    } catch (e) {
      console.warn(`[forecast-dre credev pes_pessoa ${mes}] ${e.message}`);
    }
  }

  const canais = { varejo: 0, multimarcas: 0, franquia: 0, revenda: 0, bazar: 0 };
  let total = 0;
  for (const it of items) {
    const v = Number(it.vl_fatura) || 0;
    total += v;
    const doc = String(it.nr_cpfcnpj || '').replace(/\D/g, '');
    const fn = String(porCode[String(it.cd_cliente)]?.fantasy_name || '').toUpperCase();
    let canal;
    if (doc.length !== 14) canal = 'varejo';
    else if (ehClienteFranquia(fn)) canal = 'franquia';
    else if (fn.startsWith('MTM')) canal = 'multimarcas';
    else canal = 'revenda';
    canais[canal] += v;
  }
  const neg = (x) => (x ? -Math.round(x * 100) / 100 : 0);
  return {
    total: -Math.round(total * 100) / 100,
    canais: {
      varejo: neg(canais.varejo),
      multimarcas: neg(canais.multimarcas),
      franquia: neg(canais.franquia),
      revenda: neg(canais.revenda),
      bazar: neg(canais.bazar),
    },
  };
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

  // CREDEV do Contas a Receber: total (linha CREDEV) + por canal (visualização).
  // Não deixa a tela inteira cair se falhar.
  let credev = null;
  let credevCanais = null;
  try {
    const cc = await calcularCredevCompleto(base, mes);
    credev = cc.total;
    credevCanais = cc.canais;
  } catch (e) {
    console.warn(`[forecast-dre credev ${mes}] ${e.message}`);
  }

  const dados = {
    mes,
    varejo: r2(varejo),
    multimarcas: r2(multimarcas),
    franquia: r2(franquia),
    revenda: r2(revenda),
    bazar: r2(bazar),
    credev,
    credev_canais: credevCanais,
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

  // Persiste pra servir instantâneo mesmo com o backend recém-reiniciado
  // (cache em memória vazio) — evita a tela mostrar o número antigo.
  try {
    await supabase
      .from('forecast_dre_cache')
      .upsert({ mes, dados, atualizado_em: new Date().toISOString() }, { onConflict: 'mes' });
  } catch (e) {
    console.warn(`[forecast-dre cache-save ${mes}] ${e.message}`);
  }

  return dados;
}

// Resultado salvo no Supabase (fallback quando o cache em memória está vazio)
async function lerCachePersistido(mes) {
  try {
    const { data, error } = await supabase
      .from('forecast_dre_cache')
      .select('dados')
      .eq('mes', mes)
      .maybeSingle();
    if (error || !data) return null;
    return data.dados || null;
  } catch {
    return null;
  }
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
    const fechado = ultimoDia(mes) < hojeIso();
    const ttl = (fechado ? 24 * 60 : 30) * 60 * 1000;

    const hit = CACHE.get(mes);
    if (!refresh && hit && hit.expira > agora) {
      return successResponse(res, { ...hit.dados, cache: true }, 'OK (cache)');
    }

    // Cache em memória vazio (ex.: backend recém-reiniciado): serve o valor
    // salvo no Supabase na hora e recalcula em background, pra tela nunca
    // cair pro número antigo enquanto o cálculo pesado roda.
    if (!refresh) {
      const salvo = await lerCachePersistido(mes);
      if (salvo) {
        CACHE.set(mes, { dados: salvo, expira: agora + ttl });
        calcularMes(mes)
          .then((d) => CACHE.set(mes, { dados: d, expira: Date.now() + ttl }))
          .catch((e) => console.warn(`[forecast-dre bg ${mes}] ${e.message}`));
        return successResponse(res, { ...salvo, cache: 'supabase' }, 'OK (cache salvo)');
      }
    }

    const dados = await calcularMes(mes);
    CACHE.set(mes, { dados, expira: Date.now() + ttl });
    return successResponse(res, dados, 'OK');
  }),
);

// ─── Pessoal Fixo — folha de pagamento do Dryland (RH/DP) ────────────────────
// Niziany (28/10/2026): a despesa "Pessoal Fixo" da DRE vem da folha do Dryland.
// Regras: somam os PROVENTOS (eventos tipo 'P'); fica de fora o Salário
// Maternidade (a empresa paga mas compensa no INSS). Descontos (INSS empregado,
// IRRF, eConsignado, adiantamento, VT) não entram — são retenções do funcionário.
const DP_USUARIO = process.env.DRYLAND_DP_USUARIO || '';
const DP_SENHA = process.env.DRYLAND_DP_SENHA || '';

async function drylandRpcDp(fn, args = {}) {
  const { data } = await axios.post(`${DRYLAND_URL}/rest/v1/rpc/${fn}`, args, {
    headers: { 'Content-Type': 'application/json', apikey: DRYLAND_KEY, Authorization: `Bearer ${DRYLAND_KEY}` },
    timeout: 60000,
  });
  return data;
}

const nz = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const semAcentoUp = (s) =>
  String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
// Proventos que NÃO entram na DRE (compensados em outra conta)
const ehProventoForaDre = (desc) => /MATERNIDADE/.test(semAcentoUp(desc));
// Diretor (pró-labore) — mesma régua do Dryland; fica fora da folha de pessoal.
const ehDiretor = (l) =>
  /diretor/i.test(l.funcao || '') || (l.eventos || []).some((e) => /pro-?labore/.test(nz(e.desc)));

// Lê a folha de uma competência: rubricas (proventos + descontos, como no
// Dryland) e o total de Pessoal Fixo (proventos que entram na DRE).
async function calcularPessoalFixo(mes) {
  if (!DP_USUARIO || !DP_SENHA) {
    throw Object.assign(new Error('Acesso ao DP do Dryland não configurado (DRYLAND_DP_USUARIO/SENHA).'), { status: 503 });
  }
  const lg = await drylandRpcDp('dp_login', { p_usuario: DP_USUARIO, p_senha: DP_SENHA });
  if (!lg || lg.ok !== true || !lg.token) {
    throw Object.assign(new Error(`login no DP do Dryland falhou (${(lg && lg.erro) || 'recusado'})`), { status: 502 });
  }
  try {
    const comp = `${mes}-01`; // competência da folha é 'AAAA-MM-01'
    const r = await drylandRpcDp('dp_folha_dados', { p_token: lg.token, p_competencia: comp });
    if (!r || r.ok === false) {
      throw Object.assign(new Error(`folha ${mes}: ${(r && r.erro) || 'sem resposta'}`), { status: 502 });
    }
    // Empregados (exclui linhas de resumo por CNPJ e diretores/pró-labore —
    // mesma régua do Dryland, pra bater com a tela de rubricas da folha).
    const linhas = (r.linhas || []).filter((l) => !l._resumo && !ehDiretor(l));
    const agg = {}; // desc → {desc, tipo, qtd, valor}
    let totalProventos = 0;
    let maternidade = 0;
    for (const l of linhas) {
      for (const e of l.eventos || []) {
        const tipo = e.tipo === 'P' ? 'provento' : 'desconto';
        const v = Number(e.valor) || 0;
        const desc = semAcentoUp(e.desc) || '(sem descrição)';
        const k = tipo + '|' + desc;
        const a = (agg[k] = agg[k] || { desc, tipo, qtd: 0, valor: 0 });
        a.qtd += 1;
        a.valor += v;
        if (e.tipo === 'P') {
          if (ehProventoForaDre(e.desc)) maternidade += v;
          else totalProventos += v;
        }
      }
    }
    const rubricas = Object.values(agg)
      .map((a) => ({ ...a, valor: Math.round(a.valor * 100) / 100 }))
      .sort((a, b) => b.valor - a.valor);
    return {
      mes,
      pessoal_fixo: -Math.round(totalProventos * 100) / 100, // despesa → negativo
      total_proventos: Math.round(totalProventos * 100) / 100,
      maternidade_fora: Math.round(maternidade * 100) / 100,
      empregados: linhas.length,
      rubricas, // proventos + descontos, como no Dryland
      fonte: 'dryland_dp_folha',
      calculado_em: new Date().toISOString(),
    };
  } finally {
    drylandRpcDp('dp_logout', { p_token: lg.token }).catch(() => {});
  }
}

let CACHE_PF = new Map(); // mes → { dados, expira }
router.get(
  '/pessoal-fixo',
  asyncHandler(async (req, res) => {
    req.setTimeout(120000);
    res.setTimeout(120000);
    const mes = String(req.query.mes || '');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) {
      return errorResponse(res, "Informe mes no formato 'YYYY-MM'", 400, 'BAD_MES');
    }
    const refresh = ['1', 'true'].includes(String(req.query.refresh || ''));
    const agora = Date.now();
    const hit = CACHE_PF.get(mes);
    if (!refresh && hit && hit.expira > agora) {
      return successResponse(res, { ...hit.dados, cache: true }, 'OK (cache)');
    }
    let dados;
    try {
      dados = await calcularPessoalFixo(mes);
    } catch (e) {
      return errorResponse(res, e.message, e.status || 502);
    }
    const fechado = ultimoDia(mes) < hojeIso();
    CACHE_PF.set(mes, { dados, expira: agora + (fechado ? 24 * 60 : 30) * 60 * 1000 });
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
