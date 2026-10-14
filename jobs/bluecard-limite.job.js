/**
 * Watchdog: fecha as janelas de limite TOTVS abertas pelo BlueCard.
 *
 * Quando o webhook compra.aprovada sobe o limite do cliente (ver
 * services/bluecardLimite.js), este job roda a cada minuto e, por CPF com
 * janela em status 'liberado':
 *
 *   1. VENDA FECHOU?  Consulta o Contas a Receber por títulos do cliente
 *      emitidos depois da liberação mais antiga, descarta os que já existiam
 *      (snapshot titulos_previos) e os já atribuídos a outra compra, e casa
 *      cada documento NOVO com a janela de mesmo valor (duas compras seguidas
 *      não se confundem). Achou → fecha a janela ('consumido'), espelha os
 *      títulos em bluecard_titulos e avisa o BlueCard
 *      (POST /api/v1/vendas/{compra_id}/registrada) para a compra se amarrar
 *      ao título na hora.
 *
 *   2. EXPIROU?  Liberada há mais de BLUECARD_LIBERACAO_TIMEOUT_MIN
 *      (default 120 min) sem venda → fecha ('zerado_expirado') e avisa o
 *      BlueCard (POST /api/v1/liberacoes/{compra_id}, evento
 *      liberacao.expirada) para a compra ser desfeita no app.
 *
 *   3. RETRY: compra.aprovada que falhou no webhook é retentada por 24h.
 *
 * Só roda com BLUECARD_LIMITE_AUTO_ENABLED=true (mesma flag do webhook).
 */
import cron from 'node-cron';
import axios from 'axios';
import supabase from '../config/supabase.js';
import { getToken } from '../utils/totvsTokenManager.js';
import { TOTVS_BASE_URL } from '../totvsrouter/totvsHelper.js';
import {
  limiteAutoAtivo,
  zerarLimite,
  liberarLimiteParaCompra,
  TOTVS_STATUS_NORMAL,
} from '../services/bluecardLimite.js';
import { notificarVendaRegistrada, notificarLiberacaoFechada } from '../services/bluecardClient.js';

// A cada minuto: enquanto o limite está alto, o cliente pode fechar uma
// segunda venda sem passar pelo app — que é justamente o antifraude que a
// aprovação existe pra garantir. Quanto menor a janela, menor o buraco.
const CRON_EXPR = process.env.BLUECARD_LIMITE_CRON || '* * * * *';
const TIMEOUT_MIN = Number(process.env.BLUECARD_LIBERACAO_TIMEOUT_MIN || 120);
const TZ = 'America/Sao_Paulo';
// Tolerância ao casar documento ↔ janela (arredondamento de parcelas)
const TOLERANCIA_CENTS = 5;

let rodando = false;

async function titulosDoClienteDesde(customerCode, desdeIso) {
  const tokenData = await getToken();
  if (!tokenData?.access_token) throw new Error('token TOTVS indisponível');
  // startIssueDate SOZINHO é ignorado pelo TOTVS (devolve o histórico inteiro
  // calado) — o par com endIssueDate é obrigatório.
  const dia = String(desdeIso).slice(0, 10);
  const resp = await axios.post(
    `${TOTVS_BASE_URL}/accounts-receivable/v2/documents/search`,
    {
      filter: {
        customerCodeList: [Number(customerCode)],
        startIssueDate: `${dia}T00:00:00`,
        endIssueDate: `${new Date().toISOString().slice(0, 10)}T23:59:59`,
      },
      page: 1,
      pageSize: 100,
    },
    {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${tokenData.access_token}`,
      },
      timeout: 60000,
    },
  );
  // Cancelado (status 3) não some da busca: o TOTVS mantém o título e emite
  // outro. Espelhar o cancelado faria o cliente ver um boleto que ninguém paga.
  return (resp.data?.items || []).filter((t) => Number(t.status) === TOTVS_STATUS_NORMAL);
}

async function retentarLiberacoesComErro() {
  const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: eventos } = await supabase
    .from('bluecard_eventos')
    .select('id, payload')
    .eq('evento', 'compra.aprovada')
    .eq('status', 'erro')
    .gte('recebido_em', desde)
    .limit(20);

  for (const ev of eventos || []) {
    try {
      await liberarLimiteParaCompra(ev.payload?.compra || {});
      await supabase
        .from('bluecard_eventos')
        .update({ status: 'processado', processado_em: new Date().toISOString(), erro: null })
        .eq('id', ev.id);
      console.log(`🔁 [bluecard-limite] liberação recuperada no retry (evento ${ev.id})`);
    } catch (e) {
      console.warn(`🔁 [bluecard-limite] retry do evento ${ev.id} falhou: ${e.message}`);
    }
  }
}

const chave = (t) => `${t.receivableCode}-${t.installmentCode ?? 1}`;

/** Títulos novos do cliente agrupados por documento (receivableCode). */
async function documentosNovos(cpfLibs) {
  const customerCode = cpfLibs[0].customer_code;
  const desde = cpfLibs.reduce(
    (m, l) => (l.liberado_em < m ? l.liberado_em : m),
    cpfLibs[0].liberado_em,
  );
  const todos = await titulosDoClienteDesde(customerCode, desde);
  if (!todos.length) return [];

  // Já atribuídos a alguma compra (espelho) não contam como venda nova
  const { data: espelhados } = await supabase
    .from('bluecard_titulos')
    .select('externo_id')
    .in(
      'externo_id',
      todos.map((t) => `TOTVS-${chave(t)}`),
    );
  const usados = new Set((espelhados || []).map((e) => e.externo_id));

  // "Prévio" para o CPF = estava no snapshot de TODAS as janelas abertas
  // (se alguma janela nasceu depois dele, é anterior a ela e não é venda sua)
  const previosPorLib = cpfLibs.map((l) => new Set(l.titulos_previos || []));

  const porDoc = new Map();
  for (const t of todos) {
    const k = chave(t);
    if (usados.has(`TOTVS-${k}`)) continue;
    if (previosPorLib.every((s) => s.has(k))) continue;
    const doc = String(t.receivableCode);
    const cur = porDoc.get(doc) || { receivableCode: t.receivableCode, titulos: [], totalCents: 0, emissao: t.issueDate };
    cur.titulos.push(t);
    cur.totalCents += Math.round(Number(t.installmentValue || 0) * 100);
    porDoc.set(doc, cur);
  }
  return [...porDoc.values()];
}

async function consumir(lib, doc) {
  for (const t of doc.titulos) {
    await supabase.from('bluecard_titulos').upsert(
      {
        externo_id: `TOTVS-${chave(t)}`,
        compra_id: lib.compra_id,
        documento: lib.documento || String(doc.receivableCode),
        cpf: lib.cpf,
        valor_cents: Math.round(Number(t.installmentValue || 0) * 100),
        vencimento: (t.expiredDate || '').slice(0, 10) || null,
        totvs_branch_code: t.branchCode ?? lib.branch_code,
        totvs_receivable_code: t.receivableCode,
        totvs_installment_code: t.installmentCode ?? null,
        status: 'aberto',
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: 'externo_id', ignoreDuplicates: true },
    );
  }
  await supabase
    .from('bluecard_liberacoes')
    .update({ venda_detectada_em: new Date().toISOString(), documento: lib.documento || String(doc.receivableCode) })
    .eq('compra_id', lib.compra_id);
  await zerarLimite(lib, 'consumido');

  // Amarra a compra ao título no app na hora (sem esperar a varredura deles)
  try {
    await notificarVendaRegistrada(lib.compra_id, String(doc.receivableCode));
  } catch (e) {
    console.warn(
      `⚠️ [bluecard-limite] app não aceitou /vendas/${lib.compra_id}/registrada: ${e.message} — a varredura deles casa depois`,
    );
  }
  console.log(
    `✅ [bluecard-limite] venda detectada: compra=${lib.compra_id} cpf=${lib.cpf} documento=${doc.receivableCode} ` +
      `(${doc.titulos.length} parcela(s), R$${(doc.totalCents / 100).toFixed(2)})`,
  );
}

export async function executarBluecardLimiteWatchdog() {
  if (!limiteAutoAtivo()) return { desativado: true };
  if (rodando) return { pulado: true };
  rodando = true;
  try {
    await retentarLiberacoesComErro();
    const { data: liberacoes, error } = await supabase
      .from('bluecard_liberacoes')
      .select('*')
      .eq('status', 'liberado')
      .order('liberado_em', { ascending: true })
      .limit(200);
    if (error) throw new Error(`consulta liberações: ${error.message}`);
    if (!liberacoes?.length) return { abertas: 0 };

    let consumidas = 0;
    let expiradas = 0;

    const porCpf = new Map();
    for (const l of liberacoes) {
      if (!porCpf.has(l.cpf)) porCpf.set(l.cpf, []);
      porCpf.get(l.cpf).push(l);
    }

    for (const [cpf, libs] of porCpf) {
      let docs = [];
      try {
        docs = await documentosNovos(libs);
      } catch (e) {
        console.error(`❌ [bluecard-limite] títulos do cpf ${cpf}: ${e.message}`);
      }

      for (const lib of libs) {
        try {
          // 1) A venda desta janela fechou? Primeiro documento de MESMO valor;
          //    se é a única janela do cliente, qualquer documento novo serve.
          let i = docs.findIndex((d) => Math.abs(d.totalCents - Number(lib.valor_cents)) <= TOLERANCIA_CENTS);
          if (i < 0 && libs.length === 1 && docs.length) i = 0;
          if (i >= 0) {
            const [doc] = docs.splice(i, 1);
            await consumir(lib, doc);
            consumidas++;
            continue;
          }

          // 2) Expirou sem venda?
          const idadeMin = (Date.now() - new Date(lib.liberado_em).getTime()) / 60000;
          if (idadeMin > TIMEOUT_MIN) {
            await zerarLimite(lib, 'zerado_expirado');
            expiradas++;
            console.warn(
              `⏱️ [bluecard-limite] liberação expirada sem venda (${Math.round(idadeMin)}min): ` +
                `compra=${lib.compra_id} cpf=${lib.cpf} — limite de volta`,
            );
            notificarLiberacaoFechada(lib.compra_id, 'liberacao.expirada', {
              valor_cents: lib.valor_cents,
              liberado_em: lib.liberado_em,
            }).catch((e) =>
              console.warn(`⚠️ [bluecard-limite] aviso liberacao.expirada falhou: ${e.message}`),
            );
          }
        } catch (e) {
          console.error(`❌ [bluecard-limite] liberação ${lib.compra_id}: ${e.message}`);
        }
      }

      if (docs.length && libs.some((l) => l.status === 'liberado')) {
        console.log(
          `ℹ️ [bluecard-limite] cpf ${cpf}: ${docs.length} documento(s) novo(s) sem janela de mesmo valor — aguardando`,
        );
      }
    }

    if (consumidas > 0 || expiradas > 0) {
      console.log(
        `💳 [bluecard-limite] ciclo: ${consumidas} consumida(s), ${expiradas} expirada(s), ${liberacoes.length} aberta(s) no início`,
      );
    }
    return { abertas: liberacoes.length, consumidas, expiradas };
  } finally {
    rodando = false;
  }
}

export function iniciarBluecardLimiteWatchdog() {
  if (!limiteAutoAtivo()) {
    console.log('⏸️ [bluecard-limite] watchdog desativado (BLUECARD_LIMITE_AUTO_ENABLED != true)');
    return;
  }
  cron.schedule(
    CRON_EXPR,
    () =>
      executarBluecardLimiteWatchdog().catch((e) =>
        console.error('❌ [bluecard-limite] ciclo falhou:', e.message),
      ),
    { timezone: TZ },
  );
  console.log(`⏰ [bluecard-limite] watchdog agendado (${CRON_EXPR} ${TZ})`);
}
