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

const num = (v) => {
  const n = Number(v);
  return isFinite(n) ? n : 0;
};
// Classificação de rubricas pra "média" da Previsão de 13º/Férias — mesma régua
// do dp-provisao.js do Dryland (Anny 13/10). A ordem importa: primeiro o que NÃO
// entra (senão "Gratificação férias" cairia em média). Remuneração do 13º =
// salário contratual + média (6 meses) das verbas variáveis.
const P13_NAO_ENTRA = [
  /ferias/, /abono/, /maternidade/, /familia/, /ajuda de custo/, /atestado/,
  /dissidio/, /provisao/, /bolsa/, /pro-?labore/, /salario base/,
  /verba de representa/, /bonifica/,
];
const P13_MEDIA = [
  /comiss/, /rsr s\/(comiss|remunera)/, /gratifica/, /quebra de caixa/,
  /horas? extras?/, /banco de horas/, /dsr s\/ ?(horas|comiss|remunera|variav)/,
];
const classeMedia = (desc) => {
  const d = nz(desc);
  if (P13_NAO_ENTRA.some((r) => r.test(d))) return 'fora';
  if (P13_MEDIA.some((r) => r.test(d))) return 'media';
  return 'fora';
};

// Provisão de 13º do MÊS (remuneração ÷ 12) por colaborador + encargos s/ 13º
// (INSS + FGTS pela taxa efetiva de cada CNPJ), agrupáveis por empresa —
// réplica do modo "Provisão do mês" da aba Previsão 13º/Férias do Dryland
// (dp-provisao.js). Lê a folha dos 6 meses até a competência pra tirar a média
// das verbas variáveis. Diretores (pró-labore) ficam fora (sem 13º CLT).
async function calcularProvisao13(mes, token) {
  const vazio = { total: 0, funcionarios: [], encTotal: 0, encFuncionarios: [] };
  const base = await drylandRpcDp('dp_folha_dados', { p_token: token });
  const todas = (base?.competencias || []).map((c) => String(c).slice(0, 10));
  const seis = todas.filter((c) => c.slice(0, 7) <= mes).sort().slice(-6);
  if (!seis.length) return vazio;
  const meses = {};
  for (const c of seis) {
    const r = await drylandRpcDp('dp_folha_dados', { p_token: token, p_competencia: c });
    meses[c] = (r && r.linhas) || [];
  }
  const chave = (f) => `${f.cnpj || f.empresa || ''}|${f.chapa || nz(f.nome)}`;
  const chaveCnpj = (x) => String(x.cnpj || x.empresa || '');
  const compAlvo = seis.find((c) => c.slice(0, 7) === mes) || seis[seis.length - 1];

  // Taxa efetiva de encargos por CNPJ (INSS e FGTS separados), do TOTAL GERAL
  // do PDF da folha — igual ao dp-provisao.js. A folha de set/26 às vezes vem
  // sem o INSS patronal (o campo nem existe no resumo), então, por CNPJ, usa o
  // mês MAIS RECENTE dos 6 que trouxe INSS; só cai no "só FGTS" se nenhum teve.
  // O pró-labore dos diretores diluía a taxa → base = só proventos de
  // empregados, e tira 20% do pró-labore do INSS quando a empresa paga patronal.
  const taxa = {};
  const recentes = seis.slice().reverse();
  const cnpjs = new Set((meses[compAlvo] || []).map(chaveCnpj));
  cnpjs.forEach((k) => {
    let escolhido = null;
    for (const c of recentes) {
      const rs = (meses[c] || []).find((l) => l._resumo && chaveCnpj(l) === k);
      if (!rs) continue;
      if ('inss_empresa' in rs) {
        escolhido = { c, rs };
        break;
      }
      if (!escolhido) escolhido = { c, rs };
    }
    if (!escolhido) return;
    const { c, rs } = escolhido;
    const empregados = (meses[c] || []).filter(
      (l) => !l._resumo && chaveCnpj(l) === k && !ehDiretor(l),
    );
    const provEmp = empregados.reduce((a, l) => a + num(l.proventos), 0);
    const proLabore = Math.max(0, num(rs.proventos) - provEmp);
    const inss = num(rs.inss_empresa);
    const sat = num(rs.inss_sat);
    const terc = num(rs.inss_terceiro);
    const fgts = num(rs.fgts);
    const ajustePL = inss > 0 ? 0.2 * proLabore : 0;
    const encInss = Math.max(0, inss + sat + terc - ajustePL);
    taxa[k] = {
      pctInss: provEmp ? encInss / provEmp : 0,
      pctFgts: provEmp ? fgts / provEmp : 0,
    };
  });

  // Média das verbas variáveis por pessoa (dividida pelos meses em que aparece).
  const varPorPessoa = {};
  seis.forEach((c) =>
    (meses[c] || [])
      .filter((l) => !l._resumo)
      .forEach((f) => {
        const v = (varPorPessoa[chave(f)] = varPorPessoa[chave(f)] || { soma: 0, meses: 0 });
        v.meses++;
        (f.eventos || [])
          .filter((e) => e.tipo === 'P' && classeMedia(e.desc) === 'media')
          .forEach((e) => {
            v.soma += num(e.valor);
          });
      }),
  );

  const r2 = (x) => Math.round(x * 100) / 100;
  const funcionarios = [];
  const encFuncionarios = [];
  (meses[compAlvo] || [])
    .filter((l) => !l._resumo && !ehDiretor(l))
    .forEach((f) => {
      const v = varPorPessoa[chave(f)] || { soma: 0, meses: 1 };
      const rem = num(f.salario) + (v.meses ? v.soma / v.meses : 0);
      const p13 = rem / 12;
      if (p13 <= 0) return;
      const empresa = f.empresa || '(empresa)';
      const t = taxa[chaveCnpj(f)] || { pctInss: 0, pctFgts: 0 };
      const enc13 = p13 * t.pctInss + p13 * t.pctFgts;
      const quem = {
        nome: f.nome || '(sem nome)',
        empresa,
        loja: empresa, // drill rubrica → empresa → colaborador
      };
      funcionarios.push({ ...quem, funcao: f.funcao || 'Provisão 13º', valor: r2(p13) });
      if (enc13 > 0) encFuncionarios.push({ ...quem, funcao: 'Encargos s/ 13º', valor: r2(enc13) });
    });
  funcionarios.sort((a, b) => b.valor - a.valor);
  encFuncionarios.sort((a, b) => b.valor - a.valor);
  return {
    total: r2(funcionarios.reduce((a, f) => a + f.valor, 0)),
    funcionarios,
    encTotal: r2(encFuncionarios.reduce((a, f) => a + f.valor, 0)),
    encFuncionarios,
  };
}

// Vale Transporte e Vale Alimentação (Niziany 29/10): custo da empresa pago no
// mês, pelo Contas a Pagar do HeadCoach (TOTVS), por natureza de despesa.
// 3036 = VALE TRANSPORTE · 3003 = VALE ALIMENTACAO E REFEICAO. No VT, abate o
// que é descontado do funcionário (rubrica "Desc. Vale Transporte" da folha).
// Essas duas linhas NÃO abrem (só nome e valor) — por isso vão sem funcionarios.
const EXP_VALE_TRANSPORTE = '3036';
const EXP_VALE_ALIMENTACAO = '3003';
async function calcularVales(mes, base, linhasFolha) {
  const filiais = await getFiliais(base);
  const resp = await axios.post(
    `${base}/api/totvs/accounts-payable/search`,
    {
      dt_inicio: `${mes}-01`,
      dt_fim: ultimoDia(mes),
      modo: 'liquidacao', // pago (liquidado) no mês
      situacao: 'TODAS',
      branches: filiais,
    },
    { timeout: 480000 },
  );
  const items = resp.data?.data?.data || [];
  const somaExp = (cod) => {
    let t = 0;
    for (const it of items) {
      if ((it.despesas || []).some((e) => String(e.expenseCode) === cod)) {
        t += Number(it.vl_pago) || 0;
      }
    }
    return Math.round(t * 100) / 100;
  };
  const vtPago = somaExp(EXP_VALE_TRANSPORTE);
  const vaPago = somaExp(EXP_VALE_ALIMENTACAO);
  // Desconto de VT do funcionário (folha) — abate do custo da empresa.
  let vtDesc = 0;
  for (const l of linhasFolha || []) {
    for (const e of l.eventos || []) {
      if (e.tipo === 'D' && /vale\s*transporte/.test(nz(e.desc))) vtDesc += num(e.valor);
    }
  }
  vtDesc = Math.round(vtDesc * 100) / 100;
  return {
    valeTransporte: Math.round((vtPago - vtDesc) * 100) / 100,
    valeAlimentacao: vaPago,
    vtPago,
    vtDesc,
    vaPago,
  };
}

// Despesa de OCUPAÇÃO (Niziany 29/10): aluguel das lojas do mês, da página CTO
// do HeadCoach. Fonte = Contas a Pagar TOTVS, natureza 4001 (ALUGUEL); o centro
// de custo 999 é ACORDO e é EXCLUÍDO (só aluguel). Abre por FILIAL (centro de
// custo). Mesma régua da página CTO: exclui c.custo 4/30/35/43 e o fornecedor
// Soares Ribeiro Advogados; valor = vl_duplicata por dt_vencimento no mês.
const OCUPACAO_EXP_ALUGUEL = 4001;
const OCUPACAO_CC_ACORDO = '999';
const OCUPACAO_CC_EXCLUIDOS = new Set(['4', '30', '35', '43']);
const OCUPACAO_FILIAIS = [1, 2, 5, 6, 11, 55, 65, 75, 85, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 99];
const OCUPACAO_CENTROS = {
  1: 'FILIAL NATAL', 2: 'FILIAL JOAO PESSOA', 3: 'FILIAL MOSSORO', 5: 'FILIAL NOVA CRUZ',
  6: 'RECIFE', 10: 'MATRIZ', 12: 'SALVADOR', 13: 'FORTALEZA', 14: 'SAO LUIS',
  15: 'FILIAL CANGUARETAMA', 16: 'FILIAL PARNAMIRIM', 18: 'FILIAL BREJINHO', 19: 'FILIAL MIDWAY',
  31: 'FILIAL TERESINA', 32: 'FILIAL IMPERATRIZ', 33: 'FILIAL PATOS', 34: 'FILIAL SHOPPING RECIFE',
  36: 'FILIAL MACEIO', 37: 'FILIAL AYRTON SENNA', 41: 'FILIAL CIDADE JARDIM',
  42: 'FILIAL SHOPPING GUARARAPES',
};
async function calcularOcupacao(mes, base) {
  const resp = await axios.post(
    `${base}/api/totvs/accounts-payable/search`,
    {
      dt_inicio: `${mes}-01`,
      dt_fim: ultimoDia(mes),
      modo: 'vencimento', // competência da ocupação (dia 5), como na página CTO
      situacao: 'N',
      previsao: 'TODOS',
      filtroPagamento: 'TODOS',
      expenseCodeList: [OCUPACAO_EXP_ALUGUEL],
      branches: OCUPACAO_FILIAIS,
    },
    { timeout: 300000 },
  );
  const items = resp.data?.data?.data || [];
  const porFilial = new Map();
  let total = 0;
  for (const it of items) {
    const cc = String(it.cd_ccusto || '');
    if (OCUPACAO_CC_EXCLUIDOS.has(cc)) continue;
    if (/SOARES RIBEIRO ADVOGADOS/.test(semAcentoUp(it.nm_fornecedor))) continue;
    if (cc === OCUPACAO_CC_ACORDO) continue; // acordo fica de fora (só aluguel)
    const v = Number(it.vl_duplicata) || 0;
    if (!v) continue;
    const nome = OCUPACAO_CENTROS[Number(cc)] || it.ds_ccusto || `CC ${cc || '—'}`;
    porFilial.set(nome, (porFilial.get(nome) || 0) + v);
    total += v;
  }
  const filiais = [...porFilial.entries()]
    .map(([nome, valor]) => ({ nome, valor: Math.round(valor * 100) / 100 }))
    .sort((a, b) => b.valor - a.valor);
  return { total: Math.round(total * 100) / 100, filiais };
}

// Despesa de MARKETING (Niziany 29/10): lançamentos de Propaganda e Anúncios
// (natureza 6031) do Contas a Pagar do mês. Essa natureza foi TIRADA da DRE
// Analítica (despesas gerais) e vai pra linha MARKETING. Abre por lançamento.
// Mesma régua da DRE Analítica: modo emissao, situacao N, EMPRESAS_DRE,
// cd_ccusto≠999, e (set+) título pago só entra com dt_liq e vl_pago>0.
const MARKETING_EXP = 6031;
const MARKETING_FILIAIS = [
  1, 2, 5, 6, 7, 11, 12, 13, 14, 15, 16, 31, 55, 65, 75, 85, 90, 91, 92, 93, 94,
  95, 96, 97, 99, 100, 101, 111, 200, 311, 500, 550, 600, 650, 700, 750, 850,
  890, 910, 920, 930, 940, 950, 960, 970, 990,
];
async function calcularMarketing(mes, base) {
  const resp = await axios.post(
    `${base}/api/totvs/accounts-payable/search`,
    {
      dt_inicio: `${mes}-01`,
      dt_fim: ultimoDia(mes),
      modo: 'emissao',
      situacao: 'N',
      previsao: 'TODOS',
      filtroPagamento: 'TODOS',
      expenseCodeList: [MARKETING_EXP],
      branches: MARKETING_FILIAIS,
    },
    { timeout: 300000 },
  );
  const items = resp.data?.data?.data || [];
  const brData = (iso) => {
    const s = String(iso || '').slice(0, 10);
    const p = s.split('-');
    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : '';
  };
  const lanc = [];
  let total = 0;
  for (const it of items) {
    if (Number(it.cd_ccusto) === 999) continue;
    const forn =
      it.nm_fornecedor ||
      it.nm_razaosocial_fornecedor ||
      `Fornecedor ${it.cd_fornecedor || '?'}`;
    // Niziany 29/10: tirar os lançamentos do Facebook do Marketing.
    if (/FACEBOOK/.test(semAcentoUp(forn))) continue;
    const vlPago = Number(it.vl_pago) || 0;
    const pago =
      it.tp_estagio === 'Liquid' || it.tp_estagio === 'Liquidado' || !!it.dt_liq || vlPago > 0;
    if (!(!pago || (it.dt_liq && vlPago > 0))) continue; // regra set+
    const val = vlPago > 0 ? vlPago : Number(it.vl_duplicata) || 0;
    if (!val) continue;
    total += val;
    lanc.push({
      forn,
      venc: brData(it.dt_vencimento),
      valor: Math.round(val * 100) / 100,
    });
  }
  lanc.sort((a, b) => b.valor - a.valor);
  return { total: Math.round(total * 100) / 100, lanc };
}

// Despesa de PJ (Niziany 29/10): pago no mês nos Contratos PJ do Dryland
// (aba Contratos PJ, RPC dp_pj_listar). Abre por NOME do contratado. É a linha
// "PJ" da DRE (r25), separada do Pessoal Fixo — NÃO entra no totalFixo.
async function calcularPJ(mes, token) {
  const r = await drylandRpcDp('dp_pj_listar', { p_token: token });
  const contratos = (r && r.contratos) || [];
  const nomes = [];
  let total = 0;
  for (const c of contratos) {
    const pago = (c.pagamentos || [])
      .filter((p) => String(p.competencia || '').slice(0, 7) === mes)
      .reduce((a, p) => a + (Number(p.valor_pago) || 0), 0);
    if (pago > 0) {
      nomes.push({ nome: c.nome || '(sem nome)', valor: Math.round(pago * 100) / 100 });
      total += pago;
    }
  }
  nomes.sort((a, b) => b.valor - a.valor);
  return { total: Math.round(total * 100) / 100, nomes };
}

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
    const base = `http://localhost:${process.env.PORT || 4100}`;
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

    // ── Provisão de 13º do mês (Niziany 29/10): mais uma rubrica no Pessoal
    // Fixo, abrindo empresa → colaborador, vinda da aba Previsão 13º/Férias do
    // Dryland (remuneração ÷ 12, médias de 6 meses). Entra no totalFixo.
    let totalP13 = 0;
    try {
      const p13 = await calcularProvisao13(mes, lg.token);
      if (p13.total > 0) {
        totalP13 += p13.total;
        rubricas.push({
          desc: 'PROVISÃO 13º',
          tipo: 'provento',
          qtd: p13.funcionarios.length,
          valor: p13.total,
          entra: true,
          grupo: 'fixo',
          encargo: true,
          provisao13: true,
          funcionarios: p13.funcionarios,
        });
      }
      // Encargos s/ 13º (INSS + FGTS pela taxa de cada CNPJ) — Niziany 29/10.
      if (p13.encTotal > 0) {
        totalP13 += p13.encTotal;
        rubricas.push({
          desc: 'ENCARGOS S/ 13º',
          tipo: 'provento',
          qtd: p13.encFuncionarios.length,
          valor: p13.encTotal,
          entra: true,
          grupo: 'fixo',
          encargo: true,
          provisao13: true,
          funcionarios: p13.encFuncionarios,
        });
      }
    } catch (e) {
      console.warn(`[forecast-dre provisao13 ${mes}] ${e.message}`);
    }
    totalFixo += totalP13;

    // ── Vale Transporte + Vale Alimentação (Niziany 29/10): custo da empresa
    // pago no mês (Contas a Pagar do HeadCoach). Duas linhas SEM drill (só nome
    // e valor → sem campo funcionarios). VT = pago − descontado do funcionário.
    let totalVales = 0;
    try {
      const vales = await calcularVales(mes, base, linhas);
      if (vales.valeTransporte > 0) {
        totalVales += vales.valeTransporte;
        rubricas.push({
          desc: 'VALE TRANSPORTE',
          tipo: 'provento',
          qtd: null,
          valor: vales.valeTransporte,
          entra: true,
          grupo: 'fixo',
          encargo: true,
        });
      }
      if (vales.valeAlimentacao > 0) {
        totalVales += vales.valeAlimentacao;
        rubricas.push({
          desc: 'VALE ALIMENTAÇÃO',
          tipo: 'provento',
          qtd: null,
          valor: vales.valeAlimentacao,
          entra: true,
          grupo: 'fixo',
          encargo: true,
        });
      }
    } catch (e) {
      console.warn(`[forecast-dre vales ${mes}] ${e.message}`);
    }
    totalFixo += totalVales;

    // Despesa de PJ (linha PJ da DRE, separada — NÃO entra no totalFixo).
    let pjTotal = 0;
    let pjNomes = [];
    try {
      const pj = await calcularPJ(mes, lg.token);
      pjTotal = pj.total;
      pjNomes = pj.nomes;
    } catch (e) {
      console.warn(`[forecast-dre pj ${mes}] ${e.message}`);
    }

    // Despesa de OCUPAÇÃO (linha OCUPAÇÃO, aluguel das lojas) — NÃO entra no
    // totalFixo (é linha própria da DRE). Abre por filial.
    let ocupTotal = 0;
    let ocupFiliais = [];
    try {
      const oc = await calcularOcupacao(mes, base);
      ocupTotal = oc.total;
      ocupFiliais = oc.filiais;
    } catch (e) {
      console.warn(`[forecast-dre ocupacao ${mes}] ${e.message}`);
    }

    // Despesa de MARKETING (Propaganda e Anúncios do Contas a Pagar) — linha
    // própria da DRE, NÃO entra no totalFixo. Abre por lançamento.
    let mktTotal = 0;
    let mktLanc = [];
    try {
      const mk = await calcularMarketing(mes, base);
      mktTotal = mk.total;
      mktLanc = mk.lanc;
    } catch (e) {
      console.warn(`[forecast-dre marketing ${mes}] ${e.message}`);
    }

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
      // Linha PJ da DRE (separada do Pessoal Fixo): pago no mês por contratado.
      pj_total: -Math.round(pjTotal * 100) / 100,
      pj_nomes: pjNomes,
      // Linha OCUPAÇÃO (aluguel das lojas, só aluguel): total e por filial.
      ocupacao_total: -Math.round(ocupTotal * 100) / 100,
      ocupacao_filiais: ocupFiliais,
      // Linha MARKETING (Propaganda e Anúncios): total e lançamentos.
      marketing_total: -Math.round(mktTotal * 100) / 100,
      marketing_lanc: mktLanc,
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
