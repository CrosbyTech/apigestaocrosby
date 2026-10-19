/**
 * Limite TOTVS automático para o crediário BlueCard.
 *
 * O DESENHO (decisão do Yago, 2026-08-12)
 *   O cliente do crediário vive com limite comercial/financeiro ZERADO no
 *   TOTVS — o PDV não consegue fechar venda FATURA - BLUECARD. Quando ele
 *   aprova a compra no app (token/biometria), o webhook `compra.aprovada`
 *   chega aqui e nós subimos o limite para o valor exato aprovado (mais os
 *   títulos em aberto, senão a checagem "limite − em aberto" do TOTVS
 *   bloquearia a 2ª compra). O vendedor então fecha a venda naquele valor.
 *   O watchdog (jobs/bluecard-limite.job.js) zera o limite de volta quando a
 *   venda aparece no TOTVS — ou por timeout se ela nunca fechar.
 *
 *   Ou seja: a "ordem importa" do BlueCard (aprovar ANTES de fechar) é
 *   garantida pelo próprio bloqueio de crédito do ERP.
 *
 * CONFIG
 *   BLUECARD_LIMITE_AUTO_ENABLED = 'true' ativa (default 'false' — inerte)
 *   BLUECARD_LIMITE_BRANCH_CODES = lista fixa de branches (ex: "2,5,6") —
 *                                  se vazio, usa a regra do Ranking de
 *                                  Faturamento tipo FILIAL: nome contém
 *                                  CROSBY, não é FRANQUIA, exclui 98/980
 */
import axios from 'axios';
import supabase from '../config/supabase.js';
import { getToken } from '../utils/totvsTokenManager.js';
import {
  TOTVS_BASE_URL,
  getFilialBranchCodes,
} from '../totvsrouter/totvsHelper.js';
import { sanitizePayload } from '../totvsrouter/cadastroCliente.js';
import { comandoDoPath, espelharEscritaAR } from './erp/contasReceber.js';

// statusList do Contas a Receber TOTVS. Cancelar NÃO tira o título da busca:
// o TOTVS marca status 3 e emite outro, então a mesma venda volta 2–3 vezes
// com valor idêntico. Quem casa pelo título errado registra um boleto que
// ninguém vai pagar.
export const TOTVS_STATUS_NORMAL = 1;
export const TOTVS_STATUS_NOME = {
  1: 'normal',
  2: 'devolvido',
  3: 'cancelado',
  4: 'quebrada',
};

/**
 * Branches onde o limite BlueCard é gravado. Override por env
 * (BLUECARD_LIMITE_BRANCH_CODES="2,5,6") ou regra FILIAL do ranking.
 */
export async function listarBranchesLimite() {
  const fixo = (process.env.BLUECARD_LIMITE_BRANCH_CODES || '')
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n) && n > 0);
  if (fixo.length > 0) return fixo;

  const tokenData = await getToken();
  if (!tokenData?.access_token) throw new Error('token TOTVS indisponível');
  return getFilialBranchCodes(tokenData.access_token);
}

export function limiteAutoAtivo() {
  return (
    String(process.env.BLUECARD_LIMITE_AUTO_ENABLED || 'false').toLowerCase() ===
    'true'
  );
}

export async function postTotvs(path, payload, opts = {}) {
  // ERP fase 1: escritas no contas a receber ficam registradas e espelhadas no
  // HeadCoach (accounts_receivable_*), em background, sem mudar o retorno.
  if (comandoDoPath(path)) {
    try {
      const r = await postTotvsBruto(path, payload, opts);
      espelharEscritaAR(path, payload, { sucesso: true, http_status: r.status, resposta: r.data });
      return r;
    } catch (e) {
      espelharEscritaAR(path, payload, { sucesso: false, http_status: e.response?.status ?? null, resposta: e.response?.data ?? null, erro: e.message });
      throw e;
    }
  }
  return postTotvsBruto(path, payload, opts);
}

async function postTotvsBruto(path, payload, { timeout = 60000 } = {}) {
  const tokenData = await getToken();
  if (!tokenData?.access_token) throw new Error('token TOTVS indisponível');
  const doRequest = (t) =>
    axios.post(`${TOTVS_BASE_URL}${path}`, payload, {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${t}`,
      },
      timeout,
    });
  try {
    return await doRequest(tokenData.access_token);
  } catch (e) {
    if (e.response?.status === 401) {
      const novo = await getToken(true);
      return await doRequest(novo.access_token);
    }
    throw e;
  }
}

/** Busca PF no TOTVS por CPF. Retorna { code, name } ou null. */
export async function buscarClientePorCpf(cpf) {
  const resp = await postTotvs('/person/v2/individuals/search', {
    filter: { cpfList: [String(cpf).replace(/\D/g, '')] },
    page: 1,
    pageSize: 1,
  });
  const item = resp.data?.items?.[0];
  if (!item) return null;
  return { code: item.code, name: item.name };
}

/** Busca PJ no TOTVS por CNPJ. Retorna { code, name } ou null. */
export async function buscarClientePorCnpj(cnpj) {
  const resp = await postTotvs('/person/v2/legal-entities/search', {
    filter: { cnpjList: [String(cnpj).replace(/\D/g, '')] },
    page: 1,
    pageSize: 1,
  });
  const item = resp.data?.items?.[0];
  if (!item) return null;
  return { code: item.code, name: item.name };
}

/**
 * Títulos em aberto do cliente: soma em reais + ids de TODOS os títulos do dia
 * de hoje (snapshot que o watchdog usa pra saber o que já existia antes da
 * liberação — ver jobs/bluecard-limite.job.js).
 *
 * A soma inclui título de compra à vista antiga, não só crediário: é
 * intencional. O TOTVS calcula "disponível = limite − em aberto", então sem
 * somar o que o cliente já deve, a 2ª compra ficaria bloqueada mesmo aprovada.
 */
export async function levantarTitulos(customerCode) {
  // statusList [1]: cancelado (3) continua aparecendo na busca e não é dívida
  const resp = await postTotvs('/accounts-receivable/v2/documents/search', {
    filter: {
      customerCodeList: [Number(customerCode)],
      statusList: [1],
    },
    page: 1,
    pageSize: 100,
  });
  const itens = resp.data?.items || [];
  const hoje = new Date().toISOString().slice(0, 10);
  let soma = 0;
  const idsHoje = [];
  for (const it of itens) {
    if (!it.paymentDate && !it.settlementDate && Number(it.dischargeType) === 0) {
      soma += Number(it.installmentValue || 0);
    }
    if ((it.issueDate || '').slice(0, 10) === hoje) {
      idsHoje.push(`${it.receivableCode}-${it.installmentCode ?? 1}`);
    }
  }
  return { abertosReais: soma, titulosHoje: idsHoje };
}

/**
 * Define os 3 limites (comercial, mensal, financeiro) do cliente no TOTVS,
 * em TODAS as branches informadas (uma entrada por branch no array limits).
 * Aceita 0 (é como o cliente crediário vive). Mesma estratégia adaptativa do
 * /cliente/update-limit: se o TOTVS recusar um campo (parâmetro IN_USA_*
 * desligado), remove o campo de todas as branches e tenta de novo.
 */
export async function definirLimiteTotvs({
  cpf,
  nome,
  valorReais,
  branchCodes,
  valoresPorBranch = null,
}) {
  if (!branchCodes?.length) throw new Error('branchCodes vazio');
  // limitValue (financeiro) e saleLimitValue (comercial) SEMPRE juntos: o POST
  // substitui o registro de limite da filial por inteiro, entao mandar so o
  // comercial ZERAVA o financeiro como efeito colateral — era isso que engolia
  // limites definidos manualmente. monthlyLimitValue fica de fora
  // (IN_USA_LIMITE_MENSAL=0 nesta instalacao: o TOTVS recusa o payload todo se
  // ele vier) e financialLimitValue nao existe na API 2.8.25.
  // valoresPorBranch ({ branch: valor }) permite valor diferente por filial —
  // e como o zerar restaura o snapshot; sem ele, valorReais vale para todas.
  let campos = ['limitValue', 'saleLimitValue'];

  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const limits = branchCodes.map((bc) => {
      const o = { branchCode: Number(bc) };
      const valor = valoresPorBranch
        ? Number(valoresPorBranch[bc] ?? valoresPorBranch[String(bc)] ?? 0)
        : valorReais;
      for (const c of campos) o[c] = valor;
      return o;
    });
    // sanitizePayload preserva 0 (só remove '', null, undefined, NaN)
    const payload = sanitizePayload({
      cpf: String(cpf).replace(/\D/g, ''),
      name: nome,
      branchInsertCode: Number(branchCodes[0]),
      insertDate: new Date().toISOString(),
      limits,
    });
    try {
      await postTotvs('/person/v2/individual-customers', payload);
      return { ok: true, campos, branches: branchCodes.length };
    } catch (e) {
      const items = Array.isArray(e.response?.data) ? e.response.data : [];
      let removeu = false;
      for (const err of items) {
        if (err.code !== 'parameterValueField') continue;
        const msg = (err.message || '').toLowerCase();
        for (const [flag, campo] of [
          ['limite_comercial', 'saleLimitValue'],
          ['salelimit', 'saleLimitValue'],
          ['limite_mensal', 'monthlyLimitValue'],
          ['monthlylimit', 'monthlyLimitValue'],
          ['limite_financeiro', 'limitValue'],
          ['financiallimit', 'limitValue'],
          ['limitvalue', 'limitValue'],
        ]) {
          if (msg.includes(flag) && campos.includes(campo)) {
            campos = campos.filter((c) => c !== campo);
            removeu = true;
          }
        }
      }
      if (!removeu || campos.length === 0) throw e;
    }
  }
  throw new Error('TOTVS recusou o limite após múltiplas tentativas');
}

/**
 * Limite FINANCEIRO vigente por filial ({ branch: valor }). E o unico campo de
 * limite legivel na API — o comercial nao aparece em consulta nenhuma. O
 * snapshot disto e o que o zerar restaura.
 */
export async function lerLimitesFinanceiros(customerCode, branchCodes) {
  const resp = await postTotvs('/person/v2/individuals/search', {
    filter: { personCodeList: [Number(customerCode)] },
    option: { branchStaticDataList: branchCodes.map(Number) },
    expand: 'statistics',
    page: 1,
    pageSize: 1,
  });
  const stats = resp.data?.items?.[0]?.statistics || [];
  const mapa = {};
  for (const st of stats) {
    if (st.limitValue) mapa[st.branchCode] = Number(st.limitValue);
  }
  return mapa;
}

// ─────────────────────────────────────────────────────────────────────
// JANELAS DE LIMITE (compra.aprovada → limite sobe → venda → limite volta)
//
// Regras fechadas com o BlueCard em 14/10/2026 (issue #2 do credit-crosby):
//  • o limite sobe SÓ na filial da compra (`compra.filial`); sem ela, nas
//    filiais participantes (`compra.filiais_bluecard`); sem nada, na regra
//    FILIAL do ranking. BLUECARD_LIMITE_BRANCH_CODES, quando definida, é um
//    piloto: só filiais dessa lista podem receber limite (loja a loja);
//  • duas compras seguidas somam: limite = títulos em aberto + soma das
//    janelas abertas do cliente que cobrem aquela filial. Fechar uma janela
//    recalcula as outras em vez de zerar tudo;
//  • ao fechar a última janela, cada filial volta ao valor que tinha antes
//    (snapshot em limites_anteriores) — para o crediário, 0.
// ─────────────────────────────────────────────────────────────────────

function allowlistPiloto() {
  return (process.env.BLUECARD_LIMITE_BRANCH_CODES || '')
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n) && n > 0);
}

/** Filiais onde a janela desta compra abre (ver cabeçalho desta seção). */
export async function resolverBranchesDaCompra(compra) {
  const filial = Number(compra?.filial);
  const participantes = (Array.isArray(compra?.filiais_bluecard) ? compra.filiais_bluecard : [])
    .map(Number)
    .filter((n) => n > 0);
  const piloto = allowlistPiloto();

  let base;
  let origem;
  if (filial > 0) {
    base = [filial];
    origem = 'filial da compra';
  } else if (participantes.length) {
    base = participantes;
    origem = 'filiais_bluecard';
  } else if (piloto.length) {
    base = piloto;
    origem = 'BLUECARD_LIMITE_BRANCH_CODES';
  } else {
    const tokenData = await getToken();
    if (!tokenData?.access_token) throw new Error('token TOTVS indisponível');
    base = await getFilialBranchCodes(tokenData.access_token);
    origem = 'regra FILIAL';
  }

  if (piloto.length) {
    const dentro = base.filter((b) => piloto.includes(b));
    if (!dentro.length) {
      const e = new Error(
        `filial ${base.join(',')} fora do piloto (BLUECARD_LIMITE_BRANCH_CODES=${piloto.join(',')})`,
      );
      e.codigo = 'fora_do_piloto';
      throw e;
    }
    base = dentro;
  }
  return { branches: [...new Set(base)], origem };
}

function branchesDaJanela(lib) {
  const lista = Array.isArray(lib?.branch_codes) ? lib.branch_codes.map(Number) : [];
  if (lista.length) return lista;
  return lib?.branch_code ? [Number(lib.branch_code)] : [];
}

async function janelasAbertas(cpf, excetoCompraId = null) {
  let q = supabase.from('bluecard_liberacoes').select('*').eq('cpf', cpf).eq('status', 'liberado');
  if (excetoCompraId) q = q.neq('compra_id', excetoCompraId);
  const { data } = await q;
  return data || [];
}

/**
 * Monta { branch: limite } para o cliente a partir das janelas abertas:
 * filial coberta por janela → abertos + soma dos valores; filial sem janela
 * → valor anterior (snapshot) ou 0.
 */
function montarMapaDeLimites({ branchesAlvo, janelas, abertosReais, anteriores }) {
  const mapa = {};
  for (const b of branchesAlvo) {
    const cobrem = janelas.filter((j) => branchesDaJanela(j).includes(Number(b)));
    if (cobrem.length) {
      const soma = cobrem.reduce((s, j) => s + Number(j.valor_cents || 0), 0) / 100;
      mapa[b] = Math.round((abertosReais + soma) * 100) / 100;
    } else {
      mapa[b] = Number(anteriores?.[b] ?? anteriores?.[String(b)] ?? 0);
    }
  }
  return mapa;
}

async function upsertLiberacaoTolerante(registro) {
  let { error } = await supabase
    .from('bluecard_liberacoes')
    .upsert(registro, { onConflict: 'compra_id' });
  // Colunas que podem faltar em producao (migrations ainda nao rodadas): tira
  // a coluna e tenta de novo, para NUNCA segurar a venda no caixa por schema.
  for (const col of ['limites_anteriores', 'titulos_previos', 'branch_codes']) {
    if (error && new RegExp(col, 'i').test(error.message || '')) {
      console.warn(
        `⚠️ [bluecard-limite] coluna ${col} ausente — rode migrations/bluecard_liberacoes*.sql; gravando sem ela`,
      );
      delete registro[col];
      ({ error } = await supabase
        .from('bluecard_liberacoes')
        .upsert(registro, { onConflict: 'compra_id' }));
    }
  }
  return error;
}

/**
 * Fluxo do webhook compra.aprovada: abre a janela desta compra e grava no
 * TOTVS o limite resultante de TODAS as janelas abertas do cliente.
 */
export async function liberarLimiteParaCompra(compra) {
  const cpf = String(compra?.cpf || '').replace(/\D/g, '');
  const valorCents = Number(compra?.valor_cents || 0);
  if (!cpf || cpf.length !== 11 || valorCents <= 0) {
    throw new Error(
      `compra.aprovada sem cpf/valor válidos (cpf=${cpf}, valor_cents=${valorCents})`,
    );
  }

  // Reprocessamento (retry do BlueCard ou do watchdog) não pode REABRIR uma
  // janela que já foi fechada — senão um webhook atrasado devolve limite a um
  // cliente cuja venda já fechou.
  const { data: existente } = await supabase
    .from('bluecard_liberacoes')
    .select('status')
    .eq('compra_id', compra.id)
    .maybeSingle();
  if (existente && existente.status !== 'liberado') {
    console.log(
      `⏭️ [bluecard-limite] compra ${compra.id} já ${existente.status} — liberação ignorada`,
    );
    return { jaProcessada: true, status: existente.status };
  }

  const cliente = await buscarClientePorCpf(cpf);
  if (!cliente) throw new Error(`CPF ${cpf} não encontrado no TOTVS`);

  const { branches, origem } = await resolverBranchesDaCompra(compra);
  const { abertosReais, titulosHoje } = await levantarTitulos(cliente.code);
  const outras = await janelasAbertas(cpf, compra.id);

  // Snapshot do que existia ANTES de qualquer janela: para filial já coberta
  // por outra janela aberta, o "anterior" é o que ela guardou (o valor atual
  // no TOTVS já está inflado); para as demais, lê agora.
  let anteriores = {};
  try {
    anteriores = await lerLimitesFinanceiros(cliente.code, branches);
  } catch (e) {
    console.warn(
      `⚠️ [bluecard-limite] snapshot do limite anterior falhou (${e.message}) — o fechar voltara a 0`,
    );
  }
  for (const o of outras) {
    for (const b of branchesDaJanela(o)) {
      if (o.limites_anteriores && b in o.limites_anteriores) anteriores[b] = o.limites_anteriores[b];
      else if (branches.includes(b)) anteriores[b] = anteriores[b] ?? 0;
    }
  }

  const janelaNova = { compra_id: compra.id, valor_cents: valorCents, branch_codes: branches };
  const todas = [...outras, janelaNova];
  const branchesAlvo = [...new Set(todas.flatMap(branchesDaJanela))];
  const mapa = montarMapaDeLimites({ branchesAlvo, janelas: todas, abertosReais, anteriores });

  await definirLimiteTotvs({
    cpf,
    nome: cliente.name,
    valorReais: 0,
    branchCodes: branchesAlvo,
    valoresPorBranch: mapa,
  });

  const limiteDesta = mapa[branches[0]] ?? Math.round((abertosReais + valorCents / 100) * 100) / 100;
  const registro = {
    compra_id: compra.id,
    documento: compra.documento || null,
    cpf,
    nome: cliente.name,
    customer_code: cliente.code,
    branch_code: branches[0],
    branch_codes: branches,
    valor_cents: valorCents,
    abertos_cents: Math.round(abertosReais * 100),
    limite_cents: Math.round(limiteDesta * 100),
    titulos_previos: titulosHoje,
    status: 'liberado',
    liberado_em: new Date().toISOString(),
    atualizado_em: new Date().toISOString(),
    limites_anteriores: Object.fromEntries(branches.map((b) => [b, anteriores[b] ?? 0])),
  };
  const error = await upsertLiberacaoTolerante(registro);
  if (error) {
    // Limite JÁ subiu no TOTVS — sem o registro o watchdog não fecha depois.
    console.error(
      `🚨 [bluecard-limite] limite liberado no TOTVS mas falhou ao registrar liberação da compra ${compra.id}: ${error.message} — ZERAR MANUALMENTE se o watchdog não pegar`,
    );
    throw new Error(`registrar liberação: ${error.message}`);
  }

  console.log(
    `💳 [bluecard-limite] janela aberta em ${branches.length} filial(is) [${branches.join(',')}] (${origem}): ` +
      `cpf=${cpf} compra=${compra.id} valor=R$${(valorCents / 100).toFixed(2)} + abertos=R$${abertosReais.toFixed(2)}` +
      (outras.length ? ` + ${outras.length} janela(s) já aberta(s)` : '') +
      ` → limite=R$${limiteDesta.toFixed(2)}`,
  );
  return { cliente, limiteReais: limiteDesta, branchCodes: branches, janelasAbertas: outras.length + 1 };
}

/**
 * Fecha a janela de uma compra e RECALCULA o limite do cliente: filiais ainda
 * cobertas por outra janela aberta ficam com (abertos + soma); as demais
 * voltam ao valor anterior ao gatilho (snapshot) — para o crediário, 0.
 */
export async function zerarLimite(liberacao, novoStatus) {
  const outras = await janelasAbertas(liberacao.cpf, liberacao.compra_id);
  const branchesLib = branchesDaJanela(liberacao).length
    ? branchesDaJanela(liberacao)
    : await listarBranchesLimite();

  let anteriores = liberacao?.limites_anteriores || null;
  if (!anteriores) {
    const { data } = await supabase
      .from('bluecard_liberacoes')
      .select('limites_anteriores')
      .eq('compra_id', liberacao.compra_id)
      .maybeSingle();
    anteriores = data?.limites_anteriores || {};
  }

  // Com outra janela aberta o limite dela depende dos títulos em aberto de
  // AGORA (a venda recém-fechada já virou título) — relê.
  let abertosReais = 0;
  if (outras.length && liberacao.customer_code) {
    try {
      abertosReais = (await levantarTitulos(liberacao.customer_code)).abertosReais;
    } catch {
      abertosReais = Number(liberacao.abertos_cents || 0) / 100;
    }
  }

  const branchesAlvo = [...new Set([...branchesLib, ...outras.flatMap(branchesDaJanela)])];
  const mapa = montarMapaDeLimites({ branchesAlvo, janelas: outras, abertosReais, anteriores });

  await definirLimiteTotvs({
    cpf: liberacao.cpf,
    nome: liberacao.nome,
    valorReais: 0,
    branchCodes: branchesAlvo,
    valoresPorBranch: mapa,
  });
  await supabase
    .from('bluecard_liberacoes')
    .update({
      status: novoStatus,
      zerado_em: new Date().toISOString(),
      atualizado_em: new Date().toISOString(),
    })
    .eq('compra_id', liberacao.compra_id);

  const restauradas = branchesLib.filter((b) => !outras.some((o) => branchesDaJanela(o).includes(b)));
  console.log(
    `💳 [bluecard-limite] janela fechada (${novoStatus}): cpf=${liberacao.cpf} compra=${liberacao.compra_id} — ` +
      `${restauradas.length} filial(is) de volta ao anterior` +
      (outras.length ? `, ${outras.length} janela(s) seguem abertas (limite recalculado)` : ''),
  );
}
