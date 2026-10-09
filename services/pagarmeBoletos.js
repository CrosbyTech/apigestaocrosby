/**
 * Boletos Pagar.me das faturas do TOTVS — remessa (emissão) e retorno
 * (status + baixa automática). Tabela: pagarme_boletos
 * (migrations/pagarme_boletos.sql).
 *
 * ── REMESSA ──
 *  Só faturas em aberto nos portadores PORTADORES_REMESSA (título em carteira /
 *  baixado por solicitação da empresa) — as demais já têm boleto no banco do
 *  portador e um segundo boleto cobraria o cliente em dobro.
 *  Para cada fatura: reserva a linha na tabela (índice único = idempotência),
 *  cria o pedido na Pagar.me e muda a carteira no TOTVS para Simples. O
 *  portador NÃO muda no TOTVS (a API não tem rota para isso): quem diz que a
 *  fatura está na Pagar.me é esta tabela.
 *
 * ── RETORNO ──
 *  Consulta na Pagar.me os boletos ainda pendentes; os pagos são baixados no
 *  TOTVS (invoices-payment, mesmo caminho da Solicitação de Baixa). A baixa é
 *  "reivindicada" na tabela antes (pendente → processando) para dois processos
 *  (Render + dev local, job + botão) nunca baixarem o mesmo título duas vezes.
 */
import supabase from '../config/supabase.js';
import { postTotvs } from './bluecardLimite.js';

export const PORTADORES_REMESSA = [1020, 1098];
const TABELA = 'pagarme_boletos';
const TP_DOCUMENTO_FATURA = 1;
const CARTEIRA_SIMPLES = 1; // ReceivableChargeType.Simple

const SK = process.env.PAGARME_SECRET_KEY || '';
const BANCO_STONE = '197';
// Multa (%) e juros (% a.m.) cobrados após o vencimento. 0 = não cobra.
const MULTA_PCT = Number(process.env.PAGARME_BOLETO_MULTA_PCT ?? 2);
const JUROS_PCT_MES = Number(process.env.PAGARME_BOLETO_JUROS_PCT_MES ?? 1);

// Conta em que o repasse da Pagar.me cai (Sicredi) — banco da baixa no TOTVS.
// Override: PAGARME_BAIXA_BANCO="748,2207,367338"
const [BX_BANCO, BX_AGENCIA, BX_CONTA] = (process.env.PAGARME_BAIXA_BANCO || '748,2207,367338')
  .split(',')
  .map((s) => s.trim());
const PAID_TYPE_CONTA_CORRENTE = 4;

const soDigitos = (s) => String(s || '').replace(/\D/g, '');
const reais = (cents) => Math.round(Number(cents || 0)) / 100;

/**
 * Erro de emissão em linguagem do financeiro. Recebe a mensagem técnica
 * gravada em pagarme_boletos.erro (ou o motivo de /gerar) e devolve o que
 * aconteceu e o que fazer.
 */
export function descreverErro(msg) {
  const m = String(msg || '');
  const t = (texto) => texto;
  if (!m) return '';
  if (/email/i.test(m)) return t('E-mail do cliente inválido. Corrija no cadastro (olhinho) e reenvie.');
  if (/zip_code|\bcep\b/i.test(m)) return t('CEP do cliente inválido. Corrija o endereço no cadastro e reenvie.');
  if (/address|line_1|city|state/i.test(m)) return t('Endereço do cliente incompleto ou inválido. Corrija no cadastro e reenvie.');
  if (/area_code|mobile_phone|home_phone|phone/i.test(m)) return t('Telefone do cliente inválido (precisa de DDD + número). Corrija no cadastro e reenvie.');
  if (/document_type|"document"|\bdocument\b|cpf|cnpj/i.test(m) && !/document_number/i.test(m)) return t('CPF/CNPJ do cliente inválido. Corrija no cadastro e reenvie.');
  if (/\bname\b/i.test(m)) return t('Nome do cliente inválido ou longo demais para a Pagar.me.');
  if (/amount/i.test(m)) return t('Valor do boleto abaixo do mínimo aceito pela Stone.');
  if (/due_at|expir/i.test(m)) return t('Data de vencimento não aceita pela Pagar.me (já passou ou é inválida).');
  if (/REFUSED/i.test(m)) return t('Boleto recusado pela Stone sem detalhe. Reenvie; se repetir, confira valor e cadastro do cliente.');
  if (/PAGARME_SECRET_KEY/.test(m)) return t('Chave da Pagar.me não estava configurada no servidor. Reenvie.');
  if (/request is invalid/i.test(m)) return t('A Pagar.me recusou os dados sem detalhar (costuma ser endereço, telefone ou nome do cliente). Confira o cadastro e reenvie.');
  if (/inacess|fetch failed|ECONN|ETIMEDOUT|timeout|socket/i.test(m)) return t('Falha de comunicação com a Pagar.me. Reenvie.');
  if (/interrompida/i.test(m)) return t('Envio interrompido antes de criar o boleto. Reenvie.');
  if (/já tem boleto/i.test(m)) return t('Esta fatura já tem boleto Pagar.me.');
  if (/cadastro incompleto/i.test(m)) return t(m.replace(/^cadastro incompleto:/i, 'Cadastro incompleto no TOTVS:') + '. Corrija no olhinho e reenvie.');
  if (/não está mais em aberto/i.test(m)) return t('Fatura não está mais em aberto ou a vencer no TOTVS.');
  if (/portador .* não entra/i.test(m)) return t('Portador da fatura não entra na remessa.');
  return t('Erro não identificado: ' + m.slice(0, 160));
}

export function tabelaAusente(error) {
  return (
    error?.code === '42P01' ||
    error?.code === 'PGRST205' ||
    /pagarme_boletos.*(does not exist|schema cache)/i.test(error?.message || '')
  );
}

async function pagarme(method, path, body) {
  if (!SK) throw new Error('PAGARME_SECRET_KEY não configurada no backend');
  const r = await fetch(`https://api.pagar.me/core/v5${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Basic ' + Buffer.from(`${SK}:`).toString('base64'),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

function erroTotvs(err) {
  const d = err.response?.data;
  if (Array.isArray(d)) return d.map((x) => x.message || x.detailedMessage).join('; ');
  return d?.message || d?.detailedMessage || d?.title || err.message;
}

/** Boletos "vivos" (não falhos/cancelados) das faturas informadas, por chave empresa-fatura-parcela. */
export async function boletosAtivosPorTitulo(nrFaturas) {
  const mapa = {};
  const lista = [...new Set(nrFaturas.map(Number).filter(Boolean))];
  for (let i = 0; i < lista.length; i += 300) {
    const { data, error } = await supabase
      .from(TABELA)
      .select('id, cd_empresa, nr_fatura, nr_parcela, status, boleto_url, linha_digitavel, baixa_status')
      .in('nr_fatura', lista.slice(i, i + 300))
      .not('status', 'in', '(failed,canceled)');
    if (error) {
      if (tabelaAusente(error)) return { mapa: {}, tabelaAusente: true };
      throw new Error(`pagarme_boletos: ${error.message}`);
    }
    for (const b of data || []) mapa[`${b.cd_empresa}-${b.nr_fatura}-${b.nr_parcela}`] = b;
  }
  return { mapa, tabelaAusente: false };
}

/** Última tentativa que FALHOU por fatura (para a tela mostrar o erro e permitir reenviar). */
export async function ultimosErrosPorTitulo(nrFaturas) {
  const mapa = {};
  const lista = [...new Set(nrFaturas.map(Number).filter(Boolean))];
  for (let i = 0; i < lista.length; i += 300) {
    const { data, error } = await supabase
      .from(TABELA)
      .select('id, cd_empresa, nr_fatura, nr_parcela, erro, remessa_id, created_at')
      .in('nr_fatura', lista.slice(i, i + 300))
      .eq('status', 'failed')
      .order('id', { ascending: false });
    if (error) {
      if (tabelaAusente(error)) return mapa;
      throw new Error(`pagarme_boletos: ${error.message}`);
    }
    for (const b of data || []) {
      const k = `${b.cd_empresa}-${b.nr_fatura}-${b.nr_parcela}`;
      if (!mapa[k]) {
        mapa[k] = {
          quando: b.created_at,
          remessa_id: b.remessa_id,
          tecnico: b.erro,
          descricao: descreverErro(b.erro),
        };
      }
    }
  }
  return mapa;
}

// Pagar.me devolve 400 com { message: "The request is invalid.", errors: { "customer.address.zip_code": [...] } }
// — o detalhe útil está em errors, não em message.
function detalharErroPagarme(order, tx) {
  const gw = (tx?.gateway_response?.errors || []).map((x) => x.message).join('; ');
  if (gw) return gw;
  if (order?.errors && typeof order.errors === 'object') {
    const partes = Object.entries(order.errors).map(
      ([campo, msgs]) => `${campo}: ${[].concat(msgs).join(', ')}`,
    );
    if (partes.length) return partes.join(' | ').slice(0, 500);
  }
  return order?.message || JSON.stringify(order).slice(0, 300);
}

function montarPedido(fatura, cliente, code) {
  const e = cliente.endereco;
  const fone = cliente.telefone.replace(/^55(?=\d{10,11}$)/, '');
  const titulo = `Fatura ${fatura.nr_fatura}/${fatura.nr_parcela}`;
  const boleto = {
    bank: BANCO_STONE,
    instructions: [
      `${titulo} - Crosby.`,
      MULTA_PCT || JUROS_PCT_MES
        ? `Apos o vencimento:${MULTA_PCT ? ` multa de ${MULTA_PCT}%` : ''}${
            MULTA_PCT && JUROS_PCT_MES ? ' e' : ''
          }${JUROS_PCT_MES ? ` juros de ${JUROS_PCT_MES}% a.m.` : ''}`
        : '',
    ]
      .filter(Boolean)
      .join(' ')
      .slice(0, 256),
    // fim do dia do vencimento, horário de Brasília
    due_at: `${fatura.dt_vencimento}T23:59:59-03:00`,
    type: 'DM',
  };
  if (MULTA_PCT > 0) boleto.fine = { days: 1, type: 'percentage', amount: MULTA_PCT };
  if (JUROS_PCT_MES > 0) boleto.interest = { days: 1, type: 'percentage', amount: JUROS_PCT_MES };

  return {
    code,
    items: [
      { code, amount: Math.round(fatura.vl_fatura * 100), description: titulo, quantity: 1 },
    ],
    customer: {
      name: cliente.nome.slice(0, 64),
      email: cliente.email || undefined,
      document: cliente.documento,
      document_type: cliente.tipo === 'PJ' ? 'CNPJ' : 'CPF',
      type: cliente.tipo === 'PJ' ? 'company' : 'individual',
      address: {
        line_1: [e.numero || 'S/N', e.logradouro, e.bairro].filter(Boolean).join(', '),
        line_2: e.complemento || undefined,
        zip_code: e.cep,
        city: e.cidade,
        state: e.uf,
        country: 'BR',
      },
      phones: {
        mobile_phone: { country_code: '55', area_code: fone.slice(0, 2), number: fone.slice(2) },
      },
    },
    payments: [{ payment_method: 'boleto', boleto }],
    metadata: {
      origem: 'headcoach_remessa',
      cd_empresa: String(fatura.cd_empresa),
      cd_cliente: String(fatura.cd_cliente),
      nr_fatura: String(fatura.nr_fatura),
      nr_parcela: String(fatura.nr_parcela),
    },
  };
}

async function mudarCarteiraSimples(fatura) {
  await postTotvs('/accounts-receivable/v2/documents/change-charge-type', {
    branchCode: Number(fatura.cd_empresa),
    customerCode: Number(fatura.cd_cliente),
    receivableCode: Number(fatura.nr_fatura),
    installmentCode: Number(fatura.nr_parcela),
    chargeType: CARTEIRA_SIMPLES,
    observation: 'Boleto emitido na Pagar.me (HeadCoach - Remessa Boletos)',
  });
}

/**
 * Emite o boleto de UMA fatura. `fatura` = item de /remessa-boletos/faturas
 * (já validado contra o TOTVS), com `cliente` completo.
 * Retorna { ok, motivo?, boleto? }.
 */
export async function emitirBoleto(fatura, { remessaId, usuario }) {
  const chave = `${fatura.cd_empresa}-${fatura.nr_fatura}-${fatura.nr_parcela}`;
  const cliente = fatura.cliente || {};
  if (!PORTADORES_REMESSA.includes(Number(fatura.cd_portador))) {
    return { ok: false, chave, motivo: `portador ${fatura.cd_portador} não entra na remessa` };
  }
  if (cliente.pendencias?.length) {
    return { ok: false, chave, motivo: `cadastro incompleto: ${cliente.pendencias.join(', ')}` };
  }

  const code = `HC-${chave}-${Date.now().toString(36)}`.slice(0, 52);

  // 1) Reserva a linha. O índice único barra a fatura que já tem boleto vivo.
  const { data: reservado, error: eIns } = await supabase
    .from(TABELA)
    .insert({
      remessa_id: remessaId,
      cd_empresa: fatura.cd_empresa,
      cd_cliente: fatura.cd_cliente,
      nm_cliente: cliente.nome,
      nr_documento: cliente.documento,
      nr_fatura: fatura.nr_fatura,
      nr_parcela: fatura.nr_parcela,
      dt_emissao: fatura.dt_emissao,
      dt_vencimento: fatura.dt_vencimento,
      vl_fatura: fatura.vl_fatura,
      cd_portador_totvs: fatura.cd_portador,
      nm_portador_totvs: fatura.nm_portador,
      order_code: code,
      status: 'creating',
      criado_por: usuario || null,
    })
    .select('id')
    .single();
  if (eIns) {
    if (eIns.code === '23505') return { ok: false, chave, motivo: 'já tem boleto Pagar.me' };
    throw new Error(`pagarme_boletos: ${eIns.message}`);
  }
  const id = reservado.id;
  const gravar = async (campos) => {
    const { error } = await supabase
      .from(TABELA)
      .update({ ...campos, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) console.error(`❌ [remessa-boletos] falha ao gravar boleto ${id}:`, error.message);
  };

  // 2) Pedido na Pagar.me
  let resp;
  try {
    resp = await pagarme('POST', '/orders', montarPedido(fatura, cliente, code));
  } catch (e) {
    await gravar({ status: 'failed', erro: `Pagar.me inacessível: ${e.message}` });
    return { ok: false, chave, motivo: `Pagar.me inacessível: ${e.message}` };
  }
  const order = resp.data || {};
  const charge = (order.charges || [])[0] || {};
  const tx = charge.last_transaction || {};
  if (!resp.ok || order.status === 'failed' || !tx.line) {
    const motivo = detalharErroPagarme(order, tx);
    await gravar({ status: 'failed', erro: motivo, order_id: order.id || null });
    return { ok: false, chave, motivo: `Pagar.me recusou: ${motivo}` };
  }
  await gravar({
    status: 'pending',
    order_id: order.id,
    charge_id: charge.id || null,
    boleto_url: tx.url || null,
    boleto_pdf: tx.pdf || null,
    linha_digitavel: tx.line,
    nosso_numero: tx.nosso_numero || null,
  });

  // 3) Carteira → Simples no TOTVS. Falha aqui não desfaz o boleto: fica
  //    registrada na linha para o financeiro ajustar.
  let carteiraErro = null;
  try {
    await mudarCarteiraSimples(fatura);
    await gravar({ carteira_ok: true, carteira_erro: null });
  } catch (e) {
    carteiraErro = erroTotvs(e);
    await gravar({ carteira_ok: false, carteira_erro: carteiraErro });
    console.error(`⚠️ [remessa-boletos] carteira ${chave}: ${carteiraErro}`);
  }

  return {
    ok: true,
    chave,
    boleto: { id, order_id: order.id, url: tx.url, linha_digitavel: tx.line },
    carteiraErro,
  };
}

// ── RETORNO ────────────────────────────────────────────────────────────────

async function baixarNoTotvs(b) {
  const pago = Number(b.vl_pago);
  const fatura = Number(b.vl_fatura);
  if (pago + 0.005 < fatura) {
    throw new Error(`pago a menor (${pago.toFixed(2)} de ${fatura.toFixed(2)}) — baixar manualmente`);
  }
  const juros = Number((pago - fatura).toFixed(2));
  const data = new Date(b.dt_pagamento || Date.now()).toISOString();
  await postTotvs('/accounts-receivable/v2/invoices-payment', {
    branchCode: Number(b.cd_empresa),
    settlementDate: data,
    invoices: [
      {
        branchCode: Number(b.cd_empresa),
        customerCode: Number(b.cd_cliente),
        receivableCode: Number(b.nr_fatura),
        installmentCode: Number(b.nr_parcela),
        paidValue: fatura,
        ...(juros > 0 ? { interestValue: juros } : {}),
      },
    ],
    payments: [
      {
        value: pago,
        paidType: PAID_TYPE_CONTA_CORRENTE,
        movementDate: data,
        bank: {
          bankNumber: Number(BX_BANCO),
          agencyNumber: Number(BX_AGENCIA),
          account: String(BX_CONTA),
        },
      },
    ],
  });
}

/** Baixa um boleto pago, se ninguém baixou ainda. Retorna 'processada' | 'erro' | 'ocupado'. */
async function baixarBoletoPago(b) {
  // Reivindica: só segue quem conseguir tirar a linha de "pendente".
  const { data: claim, error } = await supabase
    .from(TABELA)
    .update({ baixa_status: 'processando', updated_at: new Date().toISOString() })
    .eq('id', b.id)
    .eq('baixa_status', 'pendente')
    .select('id');
  if (error) throw new Error(`pagarme_boletos: ${error.message}`);
  if (!claim?.length) return 'ocupado';

  try {
    await baixarNoTotvs(b);
    await supabase
      .from(TABELA)
      .update({ baixa_status: 'processada', baixa_erro: null, baixa_em: new Date().toISOString() })
      .eq('id', b.id);
    console.log(`✅ [retorno-boleto] baixa TOTVS ${b.cd_empresa}-${b.nr_fatura}/${b.nr_parcela}`);
    return 'processada';
  } catch (e) {
    const msg = erroTotvs(e);
    await supabase.from(TABELA).update({ baixa_status: 'erro', baixa_erro: msg }).eq('id', b.id);
    console.error(`❌ [retorno-boleto] baixa ${b.cd_empresa}-${b.nr_fatura}/${b.nr_parcela}: ${msg}`);
    return 'erro';
  }
}

/**
 * Atualiza na Pagar.me os boletos ainda pendentes e baixa no TOTVS os pagos.
 * `retentarErros`: também tenta de novo as baixas que deram erro (botão manual).
 */
export async function sincronizarRetorno({ retentarErros = false } = {}) {
  const r = { consultados: 0, pagos: 0, cancelados: 0, baixados: 0, errosBaixa: 0, errosConsulta: 0 };

  const { data: pendentes, error } = await supabase
    .from(TABELA)
    .select('*')
    .eq('status', 'pending')
    .not('order_id', 'is', null)
    .limit(1000);
  if (error) {
    if (tabelaAusente(error)) return { ...r, tabelaAusente: true };
    throw new Error(`pagarme_boletos: ${error.message}`);
  }

  for (const b of pendentes || []) {
    r.consultados++;
    let resp;
    try {
      resp = await pagarme('GET', `/orders/${b.order_id}`);
    } catch {
      r.errosConsulta++;
      continue;
    }
    if (!resp.ok) {
      r.errosConsulta++;
      continue;
    }
    const order = resp.data;
    const charge = (order.charges || [])[0] || {};
    // overpaid/underpaid também são pagamento — a baixa decide o que fazer com a diferença
    const pago = ['paid', 'overpaid', 'underpaid'].includes(charge.status) || order.status === 'paid';
    if (pago) {
      const campos = {
        status: 'paid',
        vl_pago: reais(charge.paid_amount ?? charge.amount),
        dt_pagamento: charge.paid_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await supabase.from(TABELA).update(campos).eq('id', b.id);
      r.pagos++;
    } else if (order.status === 'canceled' || charge.status === 'canceled') {
      await supabase
        .from(TABELA)
        .update({ status: 'canceled', updated_at: new Date().toISOString() })
        .eq('id', b.id);
      r.cancelados++;
    }
  }

  // Reserva que nunca virou pedido (processo caiu no meio da emissão): libera a fatura.
  await supabase
    .from(TABELA)
    .update({ status: 'failed', erro: 'emissão interrompida antes de criar o pedido na Pagar.me' })
    .eq('status', 'creating')
    .is('order_id', null)
    .lt('created_at', new Date(Date.now() - 15 * 60000).toISOString());

  if (retentarErros) {
    await supabase.from(TABELA).update({ baixa_status: 'pendente' }).eq('status', 'paid').eq('baixa_status', 'erro');
  }
  const { data: aBaixar, error: e2 } = await supabase
    .from(TABELA)
    .select('*')
    .eq('status', 'paid')
    .eq('baixa_status', 'pendente')
    .limit(500);
  if (e2) throw new Error(`pagarme_boletos: ${e2.message}`);
  for (const b of aBaixar || []) {
    const res = await baixarBoletoPago(b);
    if (res === 'processada') r.baixados++;
    else if (res === 'erro') r.errosBaixa++;
  }
  return r;
}

/** Lista os boletos para a página Retorno Boleto. */
export async function listarBoletos({ branches, dt_inicio, dt_fim, modo = 'vencimento' }) {
  const coluna = modo === 'emissao' ? 'created_at' : modo === 'pagamento' ? 'dt_pagamento' : 'dt_vencimento';
  let q = supabase.from(TABELA).select('*').order('dt_vencimento', { ascending: true }).limit(5000);
  if (branches?.length) q = q.in('cd_empresa', branches);
  if (dt_inicio) q = q.gte(coluna, coluna === 'dt_vencimento' ? dt_inicio : `${dt_inicio}T00:00:00-03:00`);
  if (dt_fim) q = q.lte(coluna, coluna === 'dt_vencimento' ? dt_fim : `${dt_fim}T23:59:59-03:00`);
  const { data, error } = await q;
  if (error) {
    if (tabelaAusente(error)) return { items: [], tabelaAusente: true };
    throw new Error(`pagarme_boletos: ${error.message}`);
  }
  const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10); // dia em Brasília
  const items = (data || []).map((b) => ({
    ...b,
    erro_descricao: b.status === 'failed' ? descreverErro(b.erro) : null,
    situacao:
      b.status === 'paid'
        ? 'pago'
        : b.status === 'canceled'
          ? 'cancelado'
          : b.status === 'failed'
            ? 'falhou'
            : b.dt_vencimento && b.dt_vencimento < hoje
              ? 'vencido'
              : 'aberto',
  }));
  return { items, tabelaAusente: false };
}
