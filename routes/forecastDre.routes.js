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
// Proventos que vão para PESSOAL VARIÁVEL (Niziany 28/10): comissão.
const ehProventoVariavel = (desc) => /COMISSAO/.test(semAcentoUp(desc));
// Diretor (pró-labore) — mesma régua do Dryland; fica fora da folha de pessoal.
const ehDiretor = (l) =>
  /diretor/i.test(l.funcao || '') || (l.eventos || []).some((e) => /pro-?labore/.test(nz(e.desc)));

const PROLABORE_PADRAO = 80000;
async function lerProlabore(mes) {
  try {
    const { data } = await supabase
      .from('forecast_dre_prolabore')
      .select('valor')
      .eq('mes', mes)
      .maybeSingle();
    if (data && data.valor != null) return Number(data.valor) || 0;
  } catch (e) {
    console.warn(`[forecast-dre prolabore ${mes}] ${e.message}`);
  }
  return PROLABORE_PADRAO;
}

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
    // Resumos por CNPJ: trazem os encargos patronais. INSS patronal =
    // inss_empresa (20%) + inss_sat (RAT/SAT) + inss_terceiro (sistema S);
    // FGTS é separado. (Niziany 29/10: entram no Pessoal Fixo.)
    const resumos = (r.linhas || []).filter((l) => l._resumo);
    const inssDoResumo = (rz) =>
      (Number(rz.inss_empresa) || 0) + (Number(rz.inss_sat) || 0) + (Number(rz.inss_terceiro) || 0);
    // Empregados (exclui linhas de resumo por CNPJ e diretores/pró-labore —
    // mesma régua do Dryland, pra bater com a tela de rubricas da folha).
    const linhas = (r.linhas || []).filter((l) => !l._resumo && !ehDiretor(l));
    const agg = {}; // desc → {desc, tipo, qtd, valor}
    let totalFixo = 0;
    let totalVariavel = 0;
    let maternidade = 0;
    for (const l of linhas) {
      for (const e of l.eventos || []) {
        const prov = e.tipo === 'P';
        const tipo = prov ? 'provento' : 'desconto';
        const v = Number(e.valor) || 0;
        const desc = semAcentoUp(e.desc) || '(sem descrição)';
        // Entra na DRE: só provento que não seja salário maternidade.
        const entra = prov && !ehProventoForaDre(e.desc);
        // Grupo: comissão vai pra Pessoal Variável; o resto, Pessoal Fixo.
        const grupo = entra && ehProventoVariavel(e.desc) ? 'variavel' : 'fixo';
        const k = tipo + '|' + desc;
        const a = (agg[k] = agg[k] || { desc, tipo, qtd: 0, valor: 0, entra, grupo, _func: [] });
        a.qtd += 1;
        a.valor += v;
        // Funcionário que compõe a rubrica (pra abrir e ver, como no Dryland)
        a._func.push({
          nome: l.nome || '',
          chapa: l.chapa || '',
          funcao: l.funcao || '',
          empresa: l.empresa || '',
          loja: l.secao || '',
          valor: Math.round(v * 100) / 100,
        });
        if (prov) {
          if (ehProventoForaDre(e.desc)) maternidade += v;
          else if (ehProventoVariavel(e.desc)) totalVariavel += v;
          else totalFixo += v;
        }
      }
    }
    const rubricas = Object.values(agg)
      .map((a) => ({
        desc: a.desc,
        tipo: a.tipo,
        qtd: a.qtd,
        valor: Math.round(a.valor * 100) / 100,
        entra: a.entra,
        grupo: a.grupo,
        funcionarios: a._func.sort((x, y) => y.valor - x.valor),
      }))
      .sort((a, b) => b.valor - a.valor);

    // Pró-labore dos diretores (Niziany 28/10): entra no Pessoal Fixo com um
    // valor FIXO e EDITÁVEL por mês (padrão R$ 80.000), não o da folha.
    const prolabore = await lerProlabore(mes);
    rubricas.unshift({
      desc: 'PRÓ-LABORE (DIRETORES)',
      tipo: 'provento',
      qtd: null,
      valor: prolabore,
      editavel: true,
      entra: true,
      grupo: 'fixo',
    });

    // Encargos patronais (INSS patronal + FGTS) — entram no Pessoal Fixo.
    // Breakdown por empresa (razão), que é o que o resumo traz.
    const encargoFunc = (campoFn) =>
      resumos
        .map((rz) => ({
          nome: rz.empresa || '(empresa)',
          loja: rz.empresa || '(empresa)',
          funcao: '',
          empresa: rz.empresa || '',
          valor: Math.round((campoFn(rz) || 0) * 100) / 100,
        }))
        .filter((f) => f.valor !== 0)
        .sort((a, b) => b.valor - a.valor);
    const inssPatronal = resumos.reduce((a, rz) => a + inssDoResumo(rz), 0);
    const fgtsTotal = resumos.reduce((a, rz) => a + (Number(rz.fgts) || 0), 0);
    if (inssPatronal > 0) {
      rubricas.push({
        desc: 'INSS PATRONAL (EMPRESA)',
        tipo: 'provento',
        qtd: null,
        valor: Math.round(inssPatronal * 100) / 100,
        entra: true,
        grupo: 'fixo',
        encargo: true,
        funcionarios: encargoFunc(inssDoResumo),
      });
    }
    if (fgtsTotal > 0) {
      rubricas.push({
        desc: 'FGTS',
        tipo: 'provento',
        qtd: null,
        valor: Math.round(fgtsTotal * 100) / 100,
        entra: true,
        grupo: 'fixo',
        encargo: true,
        funcionarios: encargoFunc((rz) => Number(rz.fgts) || 0),
      });
    }
    // Encargos entram no Pessoal Fixo (despesa).
    totalFixo += inssPatronal + fgtsTotal;

    // ── Rescisões do mês (Niziany 29/10): entram no Pessoal Fixo como 3
    // rubricas — Verbas rescisórias, Aviso prévio indenizado e Multa
    // rescisória — abrindo por empresa → colaborador, como as demais.
    // A RPC dp_rescisoes(p_token) devolve TODAS as rescisões ({ok, itens});
    // o mês vem no campo `competencia` (YYYY-MM-DD do pagamento). NÃO passar
    // p_competencia: a função só tem a assinatura (p_token) → o overload
    // com p_competencia não existe e o PostgREST responde 404.
    let totalRescisoes = 0;
    try {
      const rr = await drylandRpcDp('dp_rescisoes', { p_token: lg.token });
      const itens = (rr?.itens || []).filter(
        (x) => String(x.competencia || '').slice(0, 7) === mes,
      );
      // Cada colaborador vira um "funcionário" da rubrica; a loja é a empresa
      // (ex.: Crosby Recife Mall) pro drill rubrica → loja → colaborador.
      const rescFunc = (campo) =>
        itens
          .map((x) => ({
            nome: x.colaborador || '(sem nome)',
            loja: x.empresa || '— sem empresa —',
            funcao: 'Rescisão',
            empresa: x.empresa || '',
            valor: Math.round((Number(x[campo]) || 0) * 100) / 100,
          }))
          .filter((f) => f.valor !== 0)
          .sort((a, b) => b.valor - a.valor);
      const grupos = [
        { desc: 'VERBAS RESCISÓRIAS', campo: 'valor_rescisao' },
        { desc: 'AVISO PRÉVIO INDENIZADO', campo: 'aviso_previo' },
        { desc: 'MULTA RESCISÓRIA', campo: 'multa' },
      ];
      for (const g of grupos) {
        const func = rescFunc(g.campo);
        const soma = func.reduce((a, f) => a + f.valor, 0);
        if (soma <= 0) continue;
        totalRescisoes += soma;
        rubricas.push({
          desc: g.desc,
          tipo: 'provento',
          qtd: func.length,
          valor: Math.round(soma * 100) / 100,
          entra: true,
          grupo: 'fixo',
          encargo: true,
          rescisao: true,
          funcionarios: func,
        });
      }
    } catch (e) {
      console.warn(`[forecast-dre rescisoes ${mes}] ${e.message}`);
    }
    // Rescisões entram no Pessoal Fixo (despesa).
    totalFixo += totalRescisoes;

    const dados = {
      mes,
      // Pessoal Fixo = proventos fixos + pró-labore; Variável = comissão.
      pessoal_fixo: -Math.round((totalFixo + prolabore) * 100) / 100,
      pessoal_variavel: -Math.round(totalVariavel * 100) / 100,
      proventos_fixo: Math.round(totalFixo * 100) / 100,
      proventos_variavel: Math.round(totalVariavel * 100) / 100,
      prolabore: Math.round(prolabore * 100) / 100,
      maternidade_fora: Math.round(maternidade * 100) / 100,
      empregados: linhas.length,
      rubricas, // pró-labore + proventos + descontos + encargos + rescisões, grupo fixo/variavel
      fonte: 'dryland_dp_folha',
      calculado_em: new Date().toISOString(),
    };
    // Persiste pra servir instantâneo mesmo com o backend recém-reiniciado
    // (a folha do Dryland é lenta num cold start) — evita a tela cair pro
    // número antigo da planilha.
    try {
      await supabase
        .from('forecast_dre_pf_cache')
        .upsert({ mes, dados, atualizado_em: new Date().toISOString() }, { onConflict: 'mes' });
    } catch (e) {
      console.warn(`[forecast-dre pf cache-save ${mes}] ${e.message}`);
    }
    return dados;
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
    const fechado = ultimoDia(mes) < hojeIso();
    const ttl = (fechado ? 24 * 60 : 30) * 60 * 1000;

    const hit = CACHE_PF.get(mes);
    if (!refresh && hit && hit.expira > agora) {
      return successResponse(res, { ...hit.dados, cache: true }, 'OK (cache)');
    }

    // Cache em memória vazio (backend recém-reiniciado): serve o valor salvo no
    // Supabase na hora e recalcula em background — a folha do Dryland é lenta.
    if (!refresh) {
      try {
        const { data } = await supabase
          .from('forecast_dre_pf_cache')
          .select('dados')
          .eq('mes', mes)
          .maybeSingle();
        if (data && data.dados) {
          CACHE_PF.set(mes, { dados: data.dados, expira: agora + ttl });
          calcularPessoalFixo(mes)
            .then((d) => CACHE_PF.set(mes, { dados: d, expira: Date.now() + ttl }))
            .catch((e) => console.warn(`[forecast-dre pf bg ${mes}] ${e.message}`));
          return successResponse(res, { ...data.dados, cache: 'supabase' }, 'OK (cache salvo)');
        }
      } catch (e) {
        console.warn(`[forecast-dre pf cache-read ${mes}] ${e.message}`);
      }
    }

    let dados;
    try {
      dados = await calcularPessoalFixo(mes);
    } catch (e) {
      return errorResponse(res, e.message, e.status || 502);
    }
    CACHE_PF.set(mes, { dados, expira: Date.now() + ttl });
    return successResponse(res, dados, 'OK');
  }),
);

// Pró-labore editável por mês (entra no Pessoal Fixo)
router.get(
  '/prolabore',
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase.from('forecast_dre_prolabore').select('mes, valor');
    if (error) return errorResponse(res, error.message, 500, 'DB');
    const overrides = {};
    for (const r of data || []) overrides[r.mes] = Number(r.valor) || 0;
    return successResponse(res, { overrides, padrao: PROLABORE_PADRAO }, 'OK');
  }),
);
router.post(
  '/prolabore',
  asyncHandler(async (req, res) => {
    const mes = String(req.body?.mes || '');
    const valor = Number(req.body?.valor);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) {
      return errorResponse(res, "mes inválido ('YYYY-MM')", 400, 'BAD_MES');
    }
    if (!Number.isFinite(valor) || valor < 0) {
      return errorResponse(res, 'valor inválido', 400, 'BAD_VALOR');
    }
    const { error } = await supabase
      .from('forecast_dre_prolabore')
      .upsert({ mes, valor, atualizado_em: new Date().toISOString() }, { onConflict: 'mes' });
    if (error) return errorResponse(res, error.message, 500, 'DB');
    CACHE_PF.delete(mes); // força recalcular o Pessoal Fixo com o novo pró-labore
    // recalcula e regrava o cache persistido com o novo pró-labore (background)
    calcularPessoalFixo(mes).catch((e) => console.warn(`[forecast-dre pf recalc ${mes}] ${e.message}`));
    return successResponse(res, { mes, valor }, 'OK');
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
