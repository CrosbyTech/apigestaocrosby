/**
 * Job: Pagamentos BlueCard — TOTVS → BlueCard (crediário Crosby)
 *
 * O QUE FAZ
 *   Para cada título em `bluecard_titulos` com status 'aberto', consulta o
 *   Contas a Receber do TOTVS (fonte da verdade do dinheiro). Se o título foi
 *   pago, grava pago_em/valor no espelho e avisa o BlueCard via
 *   POST /api/v1/pagamentos — é esse aviso que devolve limite ao cliente.
 *
 *   O espelho atualizado também alimenta o endpoint de reconciliação
 *   GET /api/bluecard/pagamentos (rede de segurança que o BlueCard consulta
 *   de hora em hora).
 *
 * IDEMPOTÊNCIA
 *   - Idempotency-Key determinística por título (pg-<externo_id>): retry após
 *     timeout não duplica o aviso no BlueCard.
 *   - `notificado_bluecard_em` só é gravado após 2xx; se o aviso falhar, o
 *     título fica 'pago' sem notificação e o próximo ciclo tenta de novo.
 *
 * CONFIG (.env / Render)
 *   BLUECARD_PAGAMENTOS_SYNC_ENABLED = 'true' para ativar (default 'true';
 *                                      sem títulos abertos o ciclo é no-op)
 *   BLUECARD_PAGAMENTOS_SYNC_CRON    = default a cada 15 min
 */
import cron from 'node-cron';
import axios from 'axios';
import supabase from '../config/supabase.js';
import { getToken } from '../utils/totvsTokenManager.js';
import { TOTVS_BASE_URL } from '../totvsrouter/totvsHelper.js';
import { notificarPagamento } from '../services/bluecardClient.js';

const ENABLED =
  String(process.env.BLUECARD_PAGAMENTOS_SYNC_ENABLED || 'true').toLowerCase() ===
  'true';
const CRON_EXPR = process.env.BLUECARD_PAGAMENTOS_SYNC_CRON || '*/15 * * * *';
const TZ = 'America/Sao_Paulo';

let rodando = false;

async function buscarTitulosTotvs(token, receivableCodes) {
  const endpoint = `${TOTVS_BASE_URL}/accounts-receivable/v2/documents/search`;
  const itens = [];
  let page = 1;
  let totalPages = 1;
  do {
    const resp = await axios.post(
      endpoint,
      {
        filter: { receivableCodeList: receivableCodes },
        page,
        pageSize: 100,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        timeout: 60000,
      },
    );
    itens.push(...(resp.data?.items || []));
    totalPages = resp.data?.totalPages || 1;
    page++;
  } while (page <= totalPages);
  return itens;
}

export async function executarBluecardPagamentosSync() {
  if (rodando) {
    console.log('⏭️ [bluecard-pagamentos] ciclo anterior ainda em execução, pulando');
    return { pulado: true };
  }
  rodando = true;
  try {
    const { data: abertos, error } = await supabase
      .from('bluecard_titulos')
      .select(
        'externo_id, valor_cents, totvs_branch_code, totvs_receivable_code, totvs_installment_code',
      )
      .eq('status', 'aberto')
      .not('totvs_receivable_code', 'is', null)
      .limit(2000);
    if (error) throw new Error(`consulta títulos abertos: ${error.message}`);

    // Também reenviar avisos que falharam (pago mas nunca confirmado 2xx)
    const { data: pendentesAviso } = await supabase
      .from('bluecard_titulos')
      .select('externo_id, pago_em, valor_pago_cents, meio')
      .eq('status', 'pago')
      .is('notificado_bluecard_em', null)
      .limit(500);

    if ((!abertos || abertos.length === 0) && (!pendentesAviso || pendentesAviso.length === 0)) {
      return { abertos: 0, pagosNovos: 0, avisados: 0 };
    }

    let pagosNovos = 0;
    let avisados = 0;

    if (abertos && abertos.length > 0) {
      const tokenData = await getToken();
      if (!tokenData?.access_token) throw new Error('token TOTVS indisponível');

      // TOTVS aceita lista de receivableCode — consulta em lotes de 50
      const codes = [...new Set(abertos.map((t) => Number(t.totvs_receivable_code)))];
      const itens = [];
      for (let i = 0; i < codes.length; i += 50) {
        itens.push(
          ...(await buscarTitulosTotvs(tokenData.access_token, codes.slice(i, i + 50))),
        );
      }

      for (const t of abertos) {
        const item = itens.find(
          (i) =>
            Number(i.receivableCode) === Number(t.totvs_receivable_code) &&
            (t.totvs_installment_code == null ||
              Number(i.installmentCode) === Number(t.totvs_installment_code)) &&
            (t.totvs_branch_code == null ||
              Number(i.branchCode) === Number(t.totvs_branch_code)),
        );
        if (!item) continue;

        const pagoEm = item.paymentDate || item.settlementDate;
        if (!pagoEm) continue; // ainda em aberto no TOTVS

        const valorPago = Math.round(Number(item.netValue ?? item.installmentValue ?? 0) * 100);
        const { error: eUpd } = await supabase
          .from('bluecard_titulos')
          .update({
            status: 'pago',
            pago_em: new Date(pagoEm).toISOString(),
            valor_pago_cents: valorPago || t.valor_cents,
            meio: 'boleto',
            atualizado_em: new Date().toISOString(),
          })
          .eq('externo_id', t.externo_id)
          .eq('status', 'aberto');
        if (eUpd) {
          console.error(`❌ [bluecard-pagamentos] update ${t.externo_id}:`, eUpd.message);
          continue;
        }
        pagosNovos++;
      }
    }

    // Avisar o BlueCard de todo pago ainda não notificado (novos + retries)
    const { data: aNotificar } = await supabase
      .from('bluecard_titulos')
      .select('externo_id, pago_em, valor_pago_cents, meio')
      .eq('status', 'pago')
      .is('notificado_bluecard_em', null)
      .limit(500);

    for (const t of aNotificar || []) {
      try {
        await notificarPagamento(
          {
            externo_id: t.externo_id,
            pago_em: t.pago_em,
            valor_pago_cents: Number(t.valor_pago_cents),
            meio: t.meio || 'boleto',
          },
          `pg-${t.externo_id}`,
        );
        await supabase
          .from('bluecard_titulos')
          .update({ notificado_bluecard_em: new Date().toISOString() })
          .eq('externo_id', t.externo_id);
        avisados++;
      } catch (e) {
        // ja_registrada = o BlueCard já conhecia este pagamento — marca e segue
        if (e.codigo === 'ja_registrada') {
          await supabase
            .from('bluecard_titulos')
            .update({ notificado_bluecard_em: new Date().toISOString() })
            .eq('externo_id', t.externo_id);
          avisados++;
        } else {
          console.error(`❌ [bluecard-pagamentos] aviso ${t.externo_id}:`, e.message);
        }
      }
    }

    if (pagosNovos > 0 || avisados > 0) {
      console.log(
        `💳 [bluecard-pagamentos] ${pagosNovos} pago(s) novo(s) no TOTVS, ${avisados} aviso(s) enviados ao BlueCard`,
      );
    }
    return { abertos: abertos?.length || 0, pagosNovos, avisados };
  } finally {
    rodando = false;
  }
}

export function iniciarBluecardPagamentosSync() {
  if (!ENABLED) {
    console.log('⏸️ [bluecard-pagamentos] desativado (BLUECARD_PAGAMENTOS_SYNC_ENABLED != true)');
    return;
  }
  cron.schedule(
    CRON_EXPR,
    () =>
      executarBluecardPagamentosSync().catch((e) =>
        console.error('❌ [bluecard-pagamentos] ciclo falhou:', e.message),
      ),
    { timezone: TZ },
  );
  console.log(`⏰ [bluecard-pagamentos] agendado (${CRON_EXPR} ${TZ})`);
}
