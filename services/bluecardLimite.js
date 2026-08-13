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

export async function postTotvs(path, payload) {
  const tokenData = await getToken();
  if (!tokenData?.access_token) throw new Error('token TOTVS indisponível');
  const doRequest = (t) =>
    axios.post(`${TOTVS_BASE_URL}${path}`, payload, {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${t}`,
      },
      timeout: 60000,
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

/** Soma (em reais) dos títulos em aberto do cliente no Contas a Receber. */
export async function somarTitulosAbertos(customerCode) {
  const resp = await postTotvs('/accounts-receivable/v2/documents/search', {
    filter: {
      customerCodeList: [Number(customerCode)],
      hasOpenInvoices: true,
      dischargeTypeList: [0],
    },
    page: 1,
    pageSize: 100,
  });
  let soma = 0;
  for (const it of resp.data?.items || []) {
    if (!it.paymentDate && !it.settlementDate) {
      soma += Number(it.installmentValue || 0);
    }
  }
  return soma;
}

/**
 * Define os 3 limites (comercial, mensal, financeiro) do cliente no TOTVS,
 * em TODAS as branches informadas (uma entrada por branch no array limits).
 * Aceita 0 (é como o cliente crediário vive). Mesma estratégia adaptativa do
 * /cliente/update-limit: se o TOTVS recusar um campo (parâmetro IN_USA_*
 * desligado), remove o campo de todas as branches e tenta de novo.
 */
export async function definirLimiteTotvs({ cpf, nome, valorReais, branchCodes }) {
  if (!branchCodes?.length) throw new Error('branchCodes vazio');
  let campos = ['saleLimitValue', 'monthlyLimitValue', 'financialLimitValue'];

  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const limits = branchCodes.map((bc) => {
      const o = { branchCode: Number(bc) };
      for (const c of campos) o[c] = valorReais;
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
          ['limite_financeiro', 'financialLimitValue'],
          ['financiallimit', 'financialLimitValue'],
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
 * Fluxo do webhook compra.aprovada: sobe o limite para
 * (valor aprovado + títulos em aberto) e registra a liberação.
 */
export async function liberarLimiteParaCompra(compra) {
  const cpf = String(compra?.cpf || '').replace(/\D/g, '');
  const valorCents = Number(compra?.valor_cents || 0);
  if (!cpf || cpf.length !== 11 || valorCents <= 0) {
    throw new Error(
      `compra.aprovada sem cpf/valor válidos (cpf=${cpf}, valor_cents=${valorCents})`,
    );
  }

  const cliente = await buscarClientePorCpf(cpf);
  if (!cliente) throw new Error(`CPF ${cpf} não encontrado no TOTVS`);

  const abertosReais = await somarTitulosAbertos(cliente.code);
  const valorReais = valorCents / 100;
  const limiteReais = Math.round((valorReais + abertosReais) * 100) / 100;

  const branchCodes = await listarBranchesLimite();
  await definirLimiteTotvs({
    cpf,
    nome: cliente.name,
    valorReais: limiteReais,
    branchCodes,
  });

  const { error } = await supabase.from('bluecard_liberacoes').upsert(
    {
      compra_id: compra.id,
      documento: compra.documento || null,
      cpf,
      nome: cliente.name,
      customer_code: cliente.code,
      branch_code: branchCodes[0],
      valor_cents: valorCents,
      abertos_cents: Math.round(abertosReais * 100),
      limite_cents: Math.round(limiteReais * 100),
      status: 'liberado',
      liberado_em: new Date().toISOString(),
      atualizado_em: new Date().toISOString(),
    },
    { onConflict: 'compra_id' },
  );
  if (error) {
    // Limite JÁ subiu no TOTVS — sem o registro o watchdog não zera depois.
    // Loga alto: precisa de intervenção manual se persistir.
    console.error(
      `🚨 [bluecard-limite] limite liberado no TOTVS mas falhou ao registrar liberação da compra ${compra.id}: ${error.message} — ZERAR MANUALMENTE se o watchdog não pegar`,
    );
    throw new Error(`registrar liberação: ${error.message}`);
  }

  console.log(
    `💳 [bluecard-limite] limite liberado em ${branchCodes.length} filial(is): cpf=${cpf} compra=${compra.id} ` +
      `valor=R$${valorReais.toFixed(2)} + abertos=R$${abertosReais.toFixed(2)} → limite=R$${limiteReais.toFixed(2)}`,
  );
  return { cliente, limiteReais, branchCodes };
}

/** Zera o limite do cliente (nas mesmas branches da regra atual) e marca a liberação. */
export async function zerarLimite(liberacao, novoStatus) {
  await definirLimiteTotvs({
    cpf: liberacao.cpf,
    nome: liberacao.nome,
    valorReais: 0,
    branchCodes: await listarBranchesLimite(),
  });
  await supabase
    .from('bluecard_liberacoes')
    .update({
      status: novoStatus,
      zerado_em: new Date().toISOString(),
      atualizado_em: new Date().toISOString(),
    })
    .eq('compra_id', liberacao.compra_id);
  console.log(
    `💳 [bluecard-limite] limite zerado: cpf=${liberacao.cpf} compra=${liberacao.compra_id} (${novoStatus})`,
  );
}
