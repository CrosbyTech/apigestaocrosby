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
import {
  limiteAutoAtivo,
  liberarLimiteParaCompra,
  zerarLimite,
  buscarClientePorCpf,
  buscarClientePorCnpj,
  postTotvs,
} from '../services/bluecardLimite.js';

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
        console.log(
          `🔵 [bluecard] compra.aprovada — documento=${body?.compra?.documento} cpf=${body?.compra?.cpf}`,
        );
        // Cliente autorizou no app → sobe o limite no TOTVS para o valor
        // exato aprovado; é o que destrava o PDV a fechar a venda
        // FATURA - BLUECARD (cliente vive com limite 0). O watchdog
        // (bluecard-limite.job.js) zera de volta depois.
        if (limiteAutoAtivo()) {
          await liberarLimiteParaCompra(body?.compra || {});
        } else {
          console.log(
            '⏸️ [bluecard] BLUECARD_LIMITE_AUTO_ENABLED != true — limite TOTVS não alterado',
          );
        }
        break;

      case 'compra.recusada':
        // Limite nunca subiu — nada a fazer no TOTVS. A venda NÃO deve
        // ser fechada no PDV.
        console.log(
          `🔵 [bluecard] compra.recusada — documento=${body?.compra?.documento} cpf=${body?.compra?.cpf}`,
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

          // Se o limite estava liberado aguardando a venda fechar, fecha a janela.
          if (limiteAutoAtivo()) {
            const { data: lib } = await supabase
              .from('bluecard_liberacoes')
              .select('compra_id, cpf, nome')
              .eq('compra_id', compraId)
              .eq('status', 'liberado')
              .maybeSingle();
            if (lib) await zerarLimite(lib, 'zerado_cancelado');
          }
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

// ─────────────────────────────────────────────────────────────────────
// GET /api/bluecard/faturas?cpf=06451367435          (ou ?cnpj=...)
//     &status=aberto|pago|todos   (default: todos)
//     &desde=2026-01-01           (opcional: emissão a partir de)
//
// Consulta AO VIVO o Contas a Receber do TOTVS para o cliente pedido.
// É como o BlueCard enxerga as faturas/títulos de um cliente do crediário
// (fatura, vencimento, valor, pago ou não) sem depender do espelho local.
// externo_id no mesmo formato do resto da integração: TOTVS-<título>-<parcela>.
// ─────────────────────────────────────────────────────────────────────
router.get('/faturas', exigirAssinaturaBluecard, async (req, res) => {
  const cpf = String(req.query.cpf || '').replace(/\D/g, '');
  const cnpj = String(req.query.cnpj || '').replace(/\D/g, '');
  const status = String(req.query.status || 'todos').toLowerCase();
  const desde = req.query.desde;

  if ((!cpf || cpf.length !== 11) && (!cnpj || cnpj.length !== 14)) {
    return res.status(400).json({
      erro: {
        codigo: 'campo_invalido',
        mensagem: 'Informe ?cpf= (11 dígitos) ou ?cnpj= (14 dígitos)',
        detalhe: null,
      },
    });
  }
  if (!['todos', 'aberto', 'pago'].includes(status)) {
    return res.status(400).json({
      erro: {
        codigo: 'campo_invalido',
        mensagem: 'status deve ser: aberto, pago ou todos',
        detalhe: null,
      },
    });
  }
  if (desde && isNaN(Date.parse(desde))) {
    return res.status(400).json({
      erro: { codigo: 'campo_invalido', mensagem: 'desde deve ser data ISO 8601', detalhe: null },
    });
  }

  try {
    const cliente = cpf
      ? await buscarClientePorCpf(cpf)
      : await buscarClientePorCnpj(cnpj);
    if (!cliente) {
      return res.status(404).json({
        erro: {
          codigo: 'cliente_nao_encontrado',
          mensagem: `${cpf ? 'CPF' : 'CNPJ'} sem cadastro no TOTVS`,
          detalhe: null,
        },
      });
    }

    const filter = { customerCodeList: [Number(cliente.code)] };
    if (desde) filter.startIssueDate = new Date(desde).toISOString();

    // Pagina até 5x100 títulos — muito acima do plausível pra um cliente PF
    const itens = [];
    for (let page = 1; page <= 5; page++) {
      const resp = await postTotvs('/accounts-receivable/v2/documents/search', {
        filter,
        page,
        pageSize: 100,
        order: '-issueDate',
      });
      itens.push(...(resp.data?.items || []));
      if (page >= (resp.data?.totalPages || 1)) break;
    }

    let totalAbertoCents = 0;
    const titulos = itens
      .map((t) => {
        const pagoEm = t.paymentDate || t.settlementDate || null;
        const valorCents = Math.round(Number(t.installmentValue || 0) * 100);
        if (!pagoEm) totalAbertoCents += valorCents;
        return {
          externo_id: `TOTVS-${t.receivableCode}-${t.installmentCode ?? 1}`,
          documento: String(t.receivableCode),
          parcela: t.installmentCode ?? 1,
          valor_cents: valorCents,
          emitido_em: t.issueDate || null,
          vencimento: (t.expiredDate || '').slice(0, 10) || null,
          status: pagoEm ? 'pago' : 'aberto',
          pago_em: pagoEm,
          valor_pago_cents: pagoEm
            ? Math.round(Number(t.netValue ?? t.installmentValue ?? 0) * 100)
            : null,
          filial: t.branchCode ?? null,
        };
      })
      .filter((t) => (status === 'todos' ? true : t.status === status));

    res.json({
      cliente: {
        [cpf ? 'cpf' : 'cnpj']: cpf || cnpj,
        nome: cliente.name,
        codigo_totvs: cliente.code,
      },
      total_aberto_cents: totalAbertoCents,
      quantidade: titulos.length,
      titulos,
    });
  } catch (e) {
    console.error('❌ [bluecard/faturas] consulta falhou:', e.message);
    res.status(500).json({
      erro: {
        codigo: 'erro_interno',
        mensagem: 'Falha ao consultar o Contas a Receber',
        detalhe: null,
      },
    });
  }
});

export default router;
