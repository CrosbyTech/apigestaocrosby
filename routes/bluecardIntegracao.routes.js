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
  TOTVS_STATUS_NORMAL,
  TOTVS_STATUS_NOME,
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
//     &incluir_cancelados=1       (opcional: mostra títulos cancelados)
//
// Consulta AO VIVO o Contas a Receber do TOTVS para o cliente pedido.
// É como o BlueCard enxerga as faturas/títulos de um cliente do crediário
// (fatura, vencimento, valor, pago ou não) sem depender do espelho local.
// externo_id no mesmo formato do resto da integração: TOTVS-<título>-<parcela>.
//
// DOIS DETALHES DO TOTVS QUE CUSTARAM DEBUG (não mexer sem ler):
//
//  1) `startIssueDate` SOZINHO É IGNORADO pela API. Só filtra quando vem
//     acompanhado de `endIssueDate` — sem o par, o TOTVS devolve o histórico
//     inteiro do cliente calado. Por isso mandamos sempre os dois e ainda
//     refiltramos aqui (cinto e suspensório).
//
//  2) Cancelado NÃO some da busca. O TOTVS mantém o título com status 3 e
//     emite um novo — a mesma venda aparece 2–3 vezes com valores idênticos.
//     Quem casar pelo título errado registra um boleto que ninguém vai pagar.
//     Default: só status 1 (NORMAL).
// ─────────────────────────────────────────────────────────────────────
router.get('/faturas', exigirAssinaturaBluecard, async (req, res) => {
  const cpf = String(req.query.cpf || '').replace(/\D/g, '');
  const cnpj = String(req.query.cnpj || '').replace(/\D/g, '');
  const status = String(req.query.status || 'todos').toLowerCase();
  const desde = req.query.desde;
  const incluirCancelados =
    req.query.incluir_cancelados === '1' || req.query.incluir_cancelados === 'true';

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
    if (!incluirCancelados) filter.statusList = [TOTVS_STATUS_NORMAL];
    if (desde) {
      // O par é obrigatório: startIssueDate sozinho é ignorado (ver cabeçalho)
      filter.startIssueDate = `${new Date(desde).toISOString().slice(0, 10)}T00:00:00`;
      filter.endIssueDate = `${new Date().toISOString().slice(0, 10)}T23:59:59`;
    }

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

    const desdeMs = desde ? Date.parse(desde) : null;
    let totalAbertoCents = 0;
    const titulos = itens
      .filter((t) => {
        // Refiltro local: o TOTVS ignora startIssueDate sem o par, e mesmo
        // com o par não confiamos cegamente na borda do intervalo.
        if (desdeMs && t.issueDate && Date.parse(t.issueDate) < desdeMs) return false;
        if (!incluirCancelados && Number(t.status) !== TOTVS_STATUS_NORMAL) return false;
        return true;
      })
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
          situacao: TOTVS_STATUS_NOME[Number(t.status)] || `status_${t.status}`,
          // Dados de cobrança: só existem depois que o boleto é registrado
          // no banco. qrCodePix vem vazio nesta carteira (PIX não habilitado).
          linha_digitavel: t.digitableLine || null,
          codigo_barras: t.barCode || null,
          pix_copia_e_cola: t.qrCodePix || null,
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

// ─────────────────────────────────────────────────────────────────────
// GET /api/bluecard/pix?externo_id=TOTVS-247122-1
//
// Gera o Pix copia-e-cola SOB DEMANDA para um título (contrato do doc do
// BlueCard de 12/08: pix_copia_e_cola obrigatório, resto opcional; timeout
// deles é 20s — o cliente está com o dedo no botão).
//
// Por baixo: POST accounts-receivable/v2/payment-link do TOTVS, que fala com
// o hub de pagamentos (banco Rendimento). Descobertas que custaram debug:
//   - correctedValue é OBRIGATÓRIO: sem ele o hub recebe amount=null e a
//     chamada morre com "$.amount could not be converted" enterrado no erro;
//   - branchCode tem que ser o DA FILIAL DO TÍTULO (outro dá NotFound);
//   - terminal de pagamento é configurado POR EMPRESA no TOTVS — filial sem
//     terminal devolve o erro 51732 (mapeado abaixo para o BlueCard).
//
// Encargos de atraso: régua do contrato BlueCard v3 — multa 2% única +
// mora 1% a.m. pró-rata dia, juros simples. Calculada AQUI e enviada ao
// gerar a cobrança, para o Pix cobrar o mesmo número que o app mostra.
// ─────────────────────────────────────────────────────────────────────
const PIX_MULTA_PCT = 2; // CDC art. 52 §1º — teto
const PIX_MORA_AM_PCT = 1; // Súmula 379/STJ — mora máxima p/ não-financeira

router.get('/pix', exigirAssinaturaBluecard, async (req, res) => {
  const externoId = String(req.query.externo_id || '');
  const m = externoId.match(/^TOTVS-(\d+)-(\d+)$/);
  if (!m) {
    return res.status(400).json({
      erro: {
        codigo: 'campo_invalido',
        mensagem: 'externo_id deve ter o formato TOTVS-<titulo>-<parcela>',
        detalhe: null,
      },
    });
  }
  const receivableCode = Number(m[1]);
  const installmentNumber = Number(m[2]);

  try {
    // 1) Localiza o título (branch, cpf, valor, situação)
    const busca = await postTotvs(
      '/accounts-receivable/v2/documents/search',
      {
        filter: { receivableCodeList: [receivableCode] },
        page: 1,
        pageSize: 10,
      },
      { timeout: 8000 },
    );
    // Conferir TAMBÉM o receivableCode: o TOTVS pode ignorar o filtro
    // (receivableCode inexistente devolve outros títulos calado — mesma
    // família de armadilha do startIssueDate)
    const titulo = (busca.data?.items || []).find(
      (t) =>
        Number(t.receivableCode) === receivableCode &&
        Number(t.installmentCode ?? 1) === installmentNumber,
    );
    if (!titulo) {
      return res.status(404).json({
        erro: { codigo: 'titulo_nao_encontrado', mensagem: 'Título não existe no TOTVS', detalhe: null },
      });
    }
    if (Number(titulo.status) !== TOTVS_STATUS_NORMAL) {
      return res.status(409).json({
        erro: {
          codigo: 'estado_invalido',
          mensagem: `Título ${TOTVS_STATUS_NOME[Number(titulo.status)] || 'em situação inválida'} no TOTVS`,
          detalhe: null,
        },
      });
    }
    if (titulo.paymentDate || titulo.settlementDate) {
      return res.status(409).json({
        erro: { codigo: 'ja_registrada', mensagem: 'Título já está pago', detalhe: null },
      });
    }

    // 2) Encargos de atraso (régua do contrato BlueCard v3)
    const valor = Number(titulo.installmentValue || 0);
    const hoje = new Date();
    const venc = new Date(`${String(titulo.expiredDate).slice(0, 10)}T23:59:59-03:00`);
    const daysLate = Math.max(0, Math.floor((hoje - venc) / 86400000));
    const fineValue = daysLate > 0 ? Math.round(valor * PIX_MULTA_PCT) / 100 : 0;
    const interestValue =
      daysLate > 0
        ? Math.round(valor * (PIX_MORA_AM_PCT / 100) * (daysLate / 30) * 100) / 100
        : 0;
    const correctedValue = Math.round((valor + fineValue + interestValue) * 100) / 100;

    // 3) Gera o Pix (timeout curto: o app do BlueCard desiste em 20s)
    const r = await postTotvs(
      '/accounts-receivable/v2/payment-link',
      {
        branchCode: Number(titulo.branchCode),
        customerCpfCnpj: titulo.customerCpfCnpj,
        receivableCode,
        installmentNumber,
        isPortal: true,
        daysLate,
        increaseValue: 0,
        discountValue: 0,
        fineValue,
        interestValue,
        correctedValue,
      },
      { timeout: 15000 },
    );
    const copiaECola = r.data?.content;
    if (!copiaECola || r.data?.unifaceResponseStatus !== 'Success') {
      throw new Error(`payment-link sem content (${JSON.stringify(r.data).slice(0, 200)})`);
    }

    console.log(
      `💠 [bluecard/pix] gerado: ${externoId} R$${correctedValue.toFixed(2)}` +
        (daysLate > 0 ? ` (${daysLate}d atraso: multa ${fineValue} + mora ${interestValue})` : ''),
    );
    res.json({
      pix_copia_e_cola: copiaECola,
      valor_cents: Math.round(correctedValue * 100),
      dias_atraso: daysLate,
    });
  } catch (e) {
    const totvsMsg = JSON.stringify(e.response?.data || '') || '';
    // Filial sem terminal de pagamento configurado no TOTVS (erro 51732)
    if (totvsMsg.includes('51732') || /Nenhum terminal configurado/i.test(totvsMsg)) {
      console.warn(`⚠️ [bluecard/pix] ${externoId}: filial sem terminal de pagamento`);
      return res.status(409).json({
        erro: {
          codigo: 'estado_invalido',
          mensagem: 'Filial do título sem terminal de pagamento configurado no TOTVS',
          detalhe: null,
        },
      });
    }
    console.error(`❌ [bluecard/pix] ${externoId}:`, e.message, totvsMsg.slice(0, 300));
    res.status(500).json({
      erro: { codigo: 'erro_interno', mensagem: 'Não foi possível gerar o Pix agora', detalhe: null },
    });
  }
});

export default router;
