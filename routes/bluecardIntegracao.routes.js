/**
 * Integração BlueCard (crediário Crosby) — lado receptor do HeadCoach.
 *
 *   POST /api/bluecard/webhook     — recebe eventos do BlueCard (assinado HMAC):
 *                                    compra.aprovada | compra.recusada |
 *                                    parcelamento.aceito | compra.cancelada
 *                                    Responde 200 imediato e processa depois —
 *                                    webhook lento vira reenvio (retry deles por 24h).
 *   GET  /api/bluecard/pagamentos  — reconciliação (assinado HMAC): títulos
 *                                    BlueCard pagos desde ?desde=<ISO>. Rede de
 *                                    segurança pra webhook/aviso perdido.
 *
 * A autenticação é HMAC (utils/bluecardHmac.js) com o NOSSO segredo
 * (BLUECARD_WEBHOOK_SECRET) — não usa o auth admin do restante da API.
 */
import express from 'express';
import { createHash } from 'node:crypto';
import supabase from '../config/supabase.js';
import { exigirAssinaturaBluecard } from '../utils/bluecardHmac.js';

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────
// POST /api/bluecard/webhook
// ─────────────────────────────────────────────────────────────────────
router.post('/webhook', exigirAssinaturaBluecard, async (req, res) => {
  const body = req.body || {};
  const evento = String(body.evento || '');

  const CONHECIDOS = [
    'compra.aprovada',
    'compra.recusada',
    'parcelamento.aceito',
    'compra.cancelada',
  ];
  if (!CONHECIDOS.includes(evento)) {
    // Evento novo do lado deles não pode virar retry infinito: aceita e loga.
    console.warn(`⚠️ [bluecard/webhook] evento desconhecido: "${evento}"`);
    return res.json({ recebido: true, ignorado: true });
  }

  // Dedupe pelo corpo cru — o retry deles reenvia bytes idênticos.
  const dedupeHash = createHash('sha256')
    .update(req.rawBody || JSON.stringify(body))
    .digest('hex');

  const { data: inserido, error } = await supabase
    .from('bluecard_eventos')
    .insert({ evento, dedupe_hash: dedupeHash, payload: body })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505' || /duplicate key/i.test(error.message || '')) {
      // Já recebido antes — confirma pra parar o retry.
      return res.json({ recebido: true, duplicado: true });
    }
    console.error(
      '❌ [bluecard/webhook] falha ao gravar evento:',
      error.message || JSON.stringify(error),
    );
    // 500 → BlueCard reenvia depois. Melhor do que perder o evento.
    return res.status(500).json({
      erro: { codigo: 'erro_interno', mensagem: 'Falha ao registrar evento', detalhe: null },
    });
  }

  // 200 imediato; processamento segue em background.
  res.json({ recebido: true });

  processarEvento(inserido.id, evento, body).catch((e) =>
    console.error(`❌ [bluecard/webhook] processar evento ${inserido.id}:`, e.message),
  );
});

async function processarEvento(id, evento, body) {
  let erro = null;
  try {
    switch (evento) {
      case 'compra.aprovada':
      case 'compra.recusada':
        // O fluxo do PDV consulta GET /compras/{id} (pode_fechar_venda) —
        // aqui só fica o registro auditável. Em compra.recusada a venda
        // NÃO deve ser fechada no TOTVS.
        console.log(
          `🔵 [bluecard] ${evento} — documento=${body?.compra?.documento} cpf=${body?.compra?.cpf}`,
        );
        break;

      case 'parcelamento.aceito': {
        // Cliente renegociou no app: os boletos antigos DEVEM ser cancelados
        // no TOTVS e os novos emitidos (depois devolvidos via POST /faturas
        // com o mesmo compra_id). Aqui marcamos os substituídos.
        const substituidos = body?.acordo?.boletos_substituidos || [];
        if (substituidos.length > 0) {
          const { error: e } = await supabase
            .from('bluecard_titulos')
            .update({ status: 'substituido', atualizado_em: new Date().toISOString() })
            .in('externo_id', substituidos)
            .neq('status', 'pago');
          if (e) throw new Error(`marcar substituídos: ${e.message}`);
        }
        console.log(
          `🔵 [bluecard] parcelamento.aceito — acordo=${body?.acordo?.id} ` +
            `substitui ${substituidos.length} título(s): ${substituidos.join(', ')} ` +
            `→ PENDENTE: cancelar títulos no TOTVS e emitir os novos boletos`,
        );
        break;
      }

      case 'compra.cancelada': {
        // Cancelamento autorizado pela matriz — baixar o recebível no TOTVS.
        const compraId = body?.compra?.id;
        if (compraId) {
          const { error: e } = await supabase
            .from('bluecard_titulos')
            .update({ status: 'cancelado', atualizado_em: new Date().toISOString() })
            .eq('compra_id', compraId)
            .neq('status', 'pago');
          if (e) throw new Error(`cancelar títulos: ${e.message}`);
        }
        console.log(
          `🔵 [bluecard] compra.cancelada — documento=${body?.compra?.documento} ` +
            `motivo="${body?.compra?.motivo}" → PENDENTE: baixar recebível no TOTVS`,
        );
        break;
      }
    }
  } catch (e) {
    erro = e.message;
    console.error(`❌ [bluecard/webhook] evento ${id} (${evento}):`, e.message);
  }

  await supabase
    .from('bluecard_eventos')
    .update({
      status: erro ? 'erro' : 'processado',
      processado_em: new Date().toISOString(),
      erro,
    })
    .eq('id', id);
}

// ─────────────────────────────────────────────────────────────────────
// GET /api/bluecard/pagamentos?desde=2026-09-01T00:00:00Z
// ─────────────────────────────────────────────────────────────────────
router.get('/pagamentos', exigirAssinaturaBluecard, async (req, res) => {
  const desde = req.query.desde;
  if (!desde || isNaN(Date.parse(desde))) {
    return res.status(400).json({
      erro: {
        codigo: 'campo_invalido',
        mensagem: 'Parâmetro "desde" obrigatório em ISO 8601 (ex.: 2026-09-01T00:00:00Z)',
        detalhe: null,
      },
    });
  }

  const { data, error } = await supabase
    .from('bluecard_titulos')
    .select('externo_id, pago_em, valor_pago_cents, meio')
    .eq('status', 'pago')
    .gte('pago_em', new Date(desde).toISOString())
    .order('pago_em', { ascending: true })
    .limit(5000);

  if (error) {
    console.error('❌ [bluecard/pagamentos] consulta falhou:', error.message);
    return res.status(500).json({
      erro: { codigo: 'erro_interno', mensagem: 'Falha ao consultar pagamentos', detalhe: null },
    });
  }

  res.json({
    desde: new Date(desde).toISOString(),
    ate: new Date().toISOString(),
    pagamentos: (data || []).map((t) => ({
      externo_id: t.externo_id,
      pago_em: t.pago_em,
      valor_pago_cents: Number(t.valor_pago_cents),
      meio: t.meio || 'boleto',
    })),
  });
});

export default router;
