/**
 * Watchdog: fecha as janelas de limite TOTVS abertas pelo BlueCard.
 *
 * Quando o webhook compra.aprovada sobe o limite do cliente (ver
 * services/bluecardLimite.js), este job roda a cada 5 min e, para cada
 * liberação em status 'liberado':
 *
 *   1. VENDA FECHOU?  Consulta o Contas a Receber por títulos do cliente
 *      emitidos depois da liberação. Achou → zera o limite ('consumido'),
 *      grava os títulos no espelho bluecard_titulos (externo_id
 *      TOTVS-<receivable>-<parcela>) para o job de pagamentos e a
 *      reconciliação enxergarem, e deixa o envio dos boletos
 *      (POST /api/v1/faturas) registrado como pendência no log.
 *
 *   2. EXPIROU?  Liberada há mais de BLUECARD_LIBERACAO_TIMEOUT_MIN
 *      (default 120 min) sem venda → zera ('zerado_expirado'). Sem isso,
 *      um limite aberto e nunca usado viraria crédito permanente.
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

// A cada minuto: enquanto o limite está alto, o cliente pode fechar uma
// segunda venda sem passar pelo app — que é justamente o antifraude que a
// aprovação existe pra garantir. Quanto menor a janela, menor o buraco.
const CRON_EXPR = process.env.BLUECARD_LIMITE_CRON || '* * * * *';
const TIMEOUT_MIN = Number(process.env.BLUECARD_LIBERACAO_TIMEOUT_MIN || 120);
const TZ = 'America/Sao_Paulo';

let rodando = false;

async function titulosDoClienteDesde(customerCode, desdeIso) {
  const tokenData = await getToken();
  if (!tokenData?.access_token) throw new Error('token TOTVS indisponível');
  // startIssueDate SOZINHO é ignorado pelo TOTVS (devolve o histórico inteiro
  // calado) — o par com endIssueDate é obrigatório. Sem isso o watchdog veria
  // títulos de 2024 e zeraria o limite antes de o vendedor fechar a venda.
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
  // outro, então a mesma venda aparece 2–3x. Espelhar o cancelado faria o
  // cliente ver no app um boleto que ninguém vai pagar.
  return (resp.data?.items || []).filter(
    (t) => Number(t.status) === TOTVS_STATUS_NORMAL,
  );
}

/**
 * Retenta liberações que falharam no webhook. O BlueCard recebeu 200 (o
 * processamento é assíncrono) e portanto NÃO vai reenviar — sem este retry,
 * um soluço de rede na hora do compra.aprovada deixaria o vendedor travado
 * pra sempre. liberarLimiteParaCompra ignora compra já consumida/zerada.
 */
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
      // Continua 'erro' — tenta de novo no próximo ciclo, dentro das 24h
      console.warn(`🔁 [bluecard-limite] retry do evento ${ev.id} falhou: ${e.message}`);
    }
  }
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
      .limit(200);
    if (error) throw new Error(`consulta liberações: ${error.message}`);
    if (!liberacoes || liberacoes.length === 0) return { abertas: 0 };

    let consumidas = 0;
    let expiradas = 0;

    for (const lib of liberacoes) {
      try {
        // 1) A venda fechou no TOTVS?
        // issueDate é DATA (sem hora), então um título do mesmo dia anterior à
        // liberação entraria na busca. Comparamos contra o snapshot tirado na
        // liberação: só título NOVO conta como "a venda fechou".
        const previos = new Set(lib.titulos_previos || []);
        const titulos = (
          await titulosDoClienteDesde(lib.customer_code, lib.liberado_em)
        ).filter(
          (t) => !previos.has(`${t.receivableCode}-${t.installmentCode ?? 1}`),
        );
        if (titulos.length > 0) {
          // Espelha os títulos para o job de pagamentos e a reconciliação
          for (const t of titulos) {
            const externoId = `TOTVS-${t.receivableCode}-${t.installmentCode ?? 1}`;
            await supabase.from('bluecard_titulos').upsert(
              {
                externo_id: externoId,
                compra_id: lib.compra_id,
                documento: lib.documento,
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
            .update({ venda_detectada_em: new Date().toISOString() })
            .eq('compra_id', lib.compra_id);
          await zerarLimite(lib, 'consumido');
          consumidas++;
          console.log(
            `✅ [bluecard-limite] venda detectada: compra=${lib.compra_id} cpf=${lib.cpf} ` +
              `${titulos.length} título(s) → PENDENTE: enviar boletos via POST /api/v1/faturas`,
          );
          continue;
        }

        // 2) Expirou sem venda?
        const idadeMin =
          (Date.now() - new Date(lib.liberado_em).getTime()) / 60000;
        if (idadeMin > TIMEOUT_MIN) {
          await zerarLimite(lib, 'zerado_expirado');
          expiradas++;
          console.warn(
            `⏱️ [bluecard-limite] liberação expirada sem venda (${Math.round(idadeMin)}min): ` +
              `compra=${lib.compra_id} cpf=${lib.cpf} — limite zerado`,
          );
        }
      } catch (e) {
        console.error(
          `❌ [bluecard-limite] liberação ${lib.compra_id}: ${e.message}`,
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
    console.log(
      '⏸️ [bluecard-limite] watchdog desativado (BLUECARD_LIMITE_AUTO_ENABLED != true)',
    );
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
