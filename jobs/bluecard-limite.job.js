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
import { limiteAutoAtivo, zerarLimite } from '../services/bluecardLimite.js';

const CRON_EXPR = process.env.BLUECARD_LIMITE_CRON || '*/5 * * * *';
const TIMEOUT_MIN = Number(process.env.BLUECARD_LIBERACAO_TIMEOUT_MIN || 120);
const TZ = 'America/Sao_Paulo';

let rodando = false;

async function titulosDoClienteDesde(customerCode, desdeIso) {
  const tokenData = await getToken();
  if (!tokenData?.access_token) throw new Error('token TOTVS indisponível');
  const resp = await axios.post(
    `${TOTVS_BASE_URL}/accounts-receivable/v2/documents/search`,
    {
      filter: {
        customerCodeList: [Number(customerCode)],
        startIssueDate: desdeIso,
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
  return resp.data?.items || [];
}

export async function executarBluecardLimiteWatchdog() {
  if (!limiteAutoAtivo()) return { desativado: true };
  if (rodando) return { pulado: true };
  rodando = true;
  try {
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
        const titulos = await titulosDoClienteDesde(
          lib.customer_code,
          lib.liberado_em,
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
