/**
 * Integração BlueCard (crediário Crosby) — lado receptor do HeadCoach.
 *
 *   POST /api/bluecard/webhook     — recebe eventos do BlueCard (assinado HMAC):
 *                                    compra.aprovada | compra.recusada |
 *                                    parcelamento.aceito | compra.cancelada |
 *                                    pagamento.pix (Pix Pagar.me pago no app →
 *                                    abre solicitações de baixa no HeadCoach)
 *   GET  /api/bluecard/clientes    — cadastro + estatísticas de compra do
 *                                    cliente no TOTVS (?cpf= ou ?cnpj=)
 *   POST /api/bluecard/clientes/lote — o mesmo para até 50 documentos
 *   GET  /api/bluecard/vendas      — vendas do PDV com formas de pagamento
 *                                    (?cpf=&desde=) → "venda extra" além do cartão
 *   GET  /api/bluecard/liberacoes/:compra_id — estado da janela de limite no
 *                                    TOTVS aberta pela compra.aprovada (o "okay")
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
import { lojaDaCompraHeadcoach } from '../utils/lojasHeadcoach.js';
import { titulosHeadcoachDoCliente, vendasHeadcoachDoCliente, transacoesBluecard } from '../services/bluecardHeadcoach.js';
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
import { abrirSolicitacoesBaixaPix } from '../services/bluecardBaixaPagarme.js';
import {
  consultarClienteBluecard,
  consultarClientesBluecardLote,
} from '../services/bluecardClientes.js';
import { listarVendasCliente } from '../services/bluecardVendas.js';
import { notificarLiberacaoFechada } from '../services/bluecardClient.js';

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
    'pagamento.pix',
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
        // Loja só-HeadCoach: registra a janela (sem tocar o TOTVS) para o vigia amarrar a venda do PDV Crosby.
        if (limiteAutoAtivo() || lojaDaCompraHeadcoach(body?.compra)) {
          await liberarLimiteParaCompra(body?.compra || {});
        } else {
          console.log(
            '⏸️ [bluecard] BLUECARD_LIMITE_AUTO_ENABLED != true — limite TOTVS não alterado',
          );
        }
        break;

      case 'compra.recusada':
        // Cliente disse não no app. Em regra o limite nunca subiu; se por
        // corrida de eventos houver janela aberta para esta compra, fecha.
        console.log(
          `🔵 [bluecard] compra.recusada — documento=${body?.compra?.documento} cpf=${body?.compra?.cpf}`,
        );
        await fecharJanelaSeAberta(body?.compra?.id, 'cancelada');
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

      case 'pagamento.pix': {
        // Cliente pagou a fatura pelo Pix da Pagar.me dentro do app. O app já
        // baixou lá (parcelas, limite). Aqui abrimos as SOLICITAÇÕES DE BAIXA
        // (Financeiro › Contas a Receber › Solicitação de Baixa) — uma por
        // título do TOTVS — para o financeiro conferir o crédito e baixar no
        // ERP pelo fluxo de sempre. Idempotente por ref_externa.
        const r = await abrirSolicitacoesBaixaPix(body);
        if (r.sem_titulo > 0) {
          console.warn(
            `⚠️ [bluecard] pagamento.pix cobrança=${body?.pagamento?.cobranca_id}: ` +
              `${r.sem_titulo} parcela(s) sem título localizado no TOTVS — ver observação da solicitação`,
          );
        }
        break;
      }

      case 'compra.cancelada': {
        // Cancelamento autorizado pela matriz — baixar o recebível no TOTVS.
        const compraId = body?.compra?.id;
        // Se a compra foi cancelada com a janela de limite ainda aberta
        // (cliente aprovou e a loja cancelou antes de passar), fecha agora em
        // vez de esperar o timeout de 120 min.
        await fecharJanelaSeAberta(compraId, 'cancelada');
        if (compraId) {
          const { error: e } = await supabase
            .from('bluecard_titulos')
            .update({ status: 'cancelado', atualizado_em: new Date().toISOString() })
            .eq('compra_id', compraId)
            .neq('status', 'pago');
          if (e) throw new Error(`cancelar títulos: ${e.message}`);

          // Se o limite estava liberado aguardando a venda fechar, fecha a janela.
          {
            const { data: lib } = await supabase
              .from('bluecard_liberacoes')
              .select('compra_id, cpf, nome, limites_anteriores, branch_code, branch_codes, customer_code')
              .eq('compra_id', compraId)
              .eq('status', 'liberado')
              .maybeSingle();
            if (lib && (limiteAutoAtivo() || lib.limites_anteriores?.headcoach === true)) await zerarLimite(lib, 'zerado_cancelado');
          }
          // compra cancelada no app DEPOIS de vendida pelo PDV Crosby: fica marcado na transação para o financeiro ver
          {
            const { data: vendida } = await supabase.from('pdv_vendas').select('id, empresa, status, pedido_info').eq('pedido_info->bluecard->>compraId', compraId).neq('status', 'cancelada').limit(1);
            if (vendida?.[0]) {
              const v = vendida[0];
              await supabase.from('pdv_vendas').update({ pedido_info: { ...v.pedido_info, bluecard: { ...v.pedido_info.bluecard, canceladaNoApp: { em: new Date().toISOString(), motivo: body?.compra?.motivo || null } } } }).eq('id', v.id);
              console.error(`🚨 [bluecard] compra ${compraId} CANCELADA no app (motivo="${body?.compra?.motivo}"), mas foi vendida pelo PDV Crosby: transação ${v.id}, loja ${v.empresa} — conferir com o BlueCard`);
            }
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
    // Parcelas BlueCard do contas a receber do HeadCoach (vendas do PDV Crosby): identificador
    // HC-<fatura>-<parcela>. Entram junto com as do TOTVS — o cliente pode ter das duas origens.
    const titulosHc = await titulosHeadcoachDoCliente({ cpf: cpf || cnpj, customerCode: cliente?.code || null, desde: desde || null, incluirCancelados });
    if (!cliente && titulosHc.length) {
      const lista = titulosHc.filter((x) => (status === 'todos' ? true : x.status === status));
      return res.json({
        cliente: { [cpf ? 'cpf' : 'cnpj']: cpf || cnpj, nome: null, codigo_totvs: null },
        total_aberto_cents: titulosHc.filter((x) => x.status === 'aberto' && x.situacao === 'normal').reduce((n, x) => n + x.valor_cents, 0),
        quantidade: lista.length,
        titulos: lista,
      });
    }
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

    // + as parcelas do HeadCoach (mais novas primeiro, como as do TOTVS)
    const doHeadcoach = titulosHc.filter((x) => (status === 'todos' ? true : x.status === status));
    totalAbertoCents += titulosHc.filter((x) => x.status === 'aberto' && x.situacao === 'normal').reduce((n, x) => n + x.valor_cents, 0);
    const todos = [...doHeadcoach, ...titulos];

    res.json({
      cliente: {
        [cpf ? 'cpf' : 'cnpj']: cpf || cnpj,
        nome: cliente.name,
        codigo_totvs: cliente.code,
      },
      total_aberto_cents: totalAbertoCents,
      quantidade: todos.length,
      titulos: todos,
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

// ─────────────────────────────────────────────────────────────────────
// GET /api/bluecard/clientes?cpf=06451367435      (ou ?cnpj=...)
//     &refresh=1                                  (opcional: fura o cache de 15 min)
//
// Cadastro + ESTATÍSTICAS do cliente no TOTVS: quanto já comprou, quantas
// compras, ticket médio, primeira/última/maior compra, atraso médio e máximo,
// parcelas pagas / em atraso / em aberto, e o limite gravado por filial.
// Fontes: person/v2/individuals|legal-entities/search + person-statistics
// (ver services/bluecardClientes.js para o porquê das duas chamadas).
// Valores em centavos, datas YYYY-MM-DD — igual ao resto da integração.
// ─────────────────────────────────────────────────────────────────────
router.get('/clientes', exigirAssinaturaBluecard, async (req, res) => {
  const cpf = String(req.query.cpf || '').replace(/\D/g, '');
  const cnpj = String(req.query.cnpj || '').replace(/\D/g, '');
  const refresh = req.query.refresh === '1' || req.query.refresh === 'true';

  if ((!cpf && !cnpj) || (cpf && cnpj)) {
    return res.status(400).json({
      erro: { codigo: 'campo_invalido', mensagem: 'informe cpf OU cnpj', detalhe: null },
    });
  }
  if ((cpf && cpf.length !== 11) || (cnpj && cnpj.length !== 14)) {
    return res.status(400).json({
      erro: {
        codigo: 'campo_invalido',
        mensagem: 'cpf deve ter 11 dígitos e cnpj 14',
        detalhe: null,
      },
    });
  }

  try {
    const dados = await consultarClienteBluecard(cpf || cnpj, { refresh });
    if (!dados) {
      return res.status(404).json({
        erro: {
          codigo: 'cliente_nao_encontrado',
          mensagem: `${cpf ? 'CPF' : 'CNPJ'} sem cadastro no TOTVS`,
          detalhe: null,
        },
      });
    }
    return res.json(dados);
  } catch (e) {
    console.error('❌ [bluecard/clientes]', e.response?.status || '', e.message);
    return res.status(502).json({
      erro: { codigo: 'erro_totvs', mensagem: 'Falha ao consultar o TOTVS', detalhe: e.message },
    });
  }
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/bluecard/clientes/lote
//   body: { "documentos": ["06451367435", "12345678000190", ...], "refresh": false }
//
// Mesmo retorno do GET, para até 50 CPFs/CNPJs por chamada (4 em paralelo no
// TOTVS). Cada item traz `encontrado`; falha de um documento não derruba o
// lote. A assinatura HMAC cobre o corpo cru, como no webhook.
// ─────────────────────────────────────────────────────────────────────
router.post('/clientes/lote', exigirAssinaturaBluecard, async (req, res) => {
  const documentos = Array.isArray(req.body?.documentos) ? req.body.documentos : null;
  if (!documentos?.length) {
    return res.status(400).json({
      erro: { codigo: 'campo_invalido', mensagem: 'documentos deve ser uma lista não vazia', detalhe: null },
    });
  }
  if (documentos.length > 50) {
    return res.status(400).json({
      erro: { codigo: 'campo_invalido', mensagem: 'máximo de 50 documentos por chamada', detalhe: null },
    });
  }
  try {
    const clientes = await consultarClientesBluecardLote(documentos, { refresh: !!req.body?.refresh });
    return res.json({
      total: clientes.length,
      encontrados: clientes.filter((c) => c.encontrado).length,
      clientes,
    });
  } catch (e) {
    console.error('❌ [bluecard/clientes/lote]', e.message);
    return res.status(502).json({
      erro: { codigo: 'erro_totvs', mensagem: 'Falha ao consultar o TOTVS', detalhe: e.message },
    });
  }
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/bluecard/vendas?cpf=06451367435&desde=2026-01-01
//     &formato=lista     (opcional: devolve só o array de vendas, como no
//                         exemplo do pedido; default é { cliente, resumo, vendas })
//     &refresh=1         (opcional: fura o cache de 5 min)
//
// Todas as vendas do cliente no PDV desde a data, com ou sem BlueCard, cada
// uma com as formas de pagamento e o título BlueCard que ela gerou. É como o
// app mede a "venda extra": o que o cliente comprou além do cartão.
// CPF sem venda → lista vazia (200). CPF sem cadastro no TOTVS → 404.
// ─────────────────────────────────────────────────────────────────────
router.get('/vendas', exigirAssinaturaBluecard, async (req, res) => {
  const cpf = String(req.query.cpf || '').replace(/\D/g, '');
  const desde = String(req.query.desde || '').slice(0, 10);
  const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
  const soLista = req.query.formato === 'lista';

  if (cpf.length !== 11) {
    return res.status(400).json({
      erro: { codigo: 'campo_invalido', mensagem: 'cpf deve ter 11 dígitos', detalhe: null },
    });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || isNaN(Date.parse(desde))) {
    return res.status(400).json({
      erro: { codigo: 'campo_invalido', mensagem: 'desde deve ser AAAA-MM-DD', detalhe: null },
    });
  }
  if (Date.parse(desde) > Date.now()) {
    return res.json(soLista ? [] : { cliente: null, desde, resumo: null, vendas: [] });
  }

  try {
    let dados = await listarVendasCliente(cpf, desde, { refresh });
    // + as vendas feitas pelo PDV Crosby (HeadCoach), que não existem no TOTVS
    const vendasHc = await vendasHeadcoachDoCliente({ cpf, customerCode: dados?.cliente?.codigo_totvs || null, desde });
    if (vendasHc.length) {
      const vendas = [...vendasHc, ...(dados?.vendas || [])].sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
      const soma = (l, k) => l.reduce((n, v) => n + Number(v[k] || 0), 0);
      dados = {
        cliente: dados?.cliente || { codigo_totvs: null, nome: null, cpf },
        desde,
        resumo: {
          vendas: vendas.length,
          vendas_com_bluecard: vendas.filter((v) => v.usou_bluecard).length,
          total_cents: soma(vendas, 'valor_total_cents'),
          bluecard_cents: soma(vendas, 'valor_bluecard_cents'),
          extra_cents: soma(vendas, 'valor_extra_cents'),
          extra_em_vendas_bluecard_cents: soma(vendas.filter((v) => v.usou_bluecard), 'valor_extra_cents'),
        },
        vendas,
      };
    }
    if (!dados) {
      return res.status(404).json({
        erro: { codigo: 'cliente_nao_encontrado', mensagem: 'CPF sem cadastro no TOTVS', detalhe: null },
      });
    }
    return res.json(soLista ? dados.vendas : dados);
  } catch (e) {
    console.error('❌ [bluecard/vendas]', e.response?.status || '', e.message);
    return res.status(502).json({
      erro: {
        codigo: 'erro_totvs',
        mensagem: 'Falha ao consultar o TOTVS',
        detalhe: e.response?.data?.[0]?.message || e.message,
      },
    });
  }
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/bluecard/transacoes?desde=AAAA-MM-DD&ate=AAAA-MM-DD[&cpf=][&compra_id=][&status=]
//
// Transações do PDV Crosby (HeadCoach) pagas com BlueCard, POR PERÍODO — para o
// BlueCard conciliar o dia (pedido do Felipe, 25/11/2026). Cada uma traz a compra
// do BlueCard (compra_id), a nota, os itens, a loja, o vendedor e a situação:
// pendente | fechada | cancelada | devolvida | devolvida_parcial. Datas no horário
// de Brasília. Período máximo de 93 dias; sem `ate`, vai até hoje.
// ─────────────────────────────────────────────────────────────────────
router.get('/transacoes', exigirAssinaturaBluecard, async (req, res) => {
  const ehDia = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
  const hoje = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  const desde = String(req.query.desde || '');
  const ate = req.query.ate ? String(req.query.ate) : hoje;
  const compraId = req.query.compra_id ? String(req.query.compra_id) : null;
  const cpf = String(req.query.cpf || '').replace(/\D/g, '');
  const invalido = (mensagem) => res.status(400).json({ erro: { codigo: 'campo_invalido', mensagem, detalhe: null } });
  if (!compraId && !ehDia(desde)) return invalido('informe desde=AAAA-MM-DD (ou compra_id)');
  if (!ehDia(ate)) return invalido('ate deve ser AAAA-MM-DD');
  const inicio = ehDia(desde) ? desde : '2026-11-01';
  if (inicio > ate) return invalido('desde não pode ser depois de ate');
  if ((Date.parse(ate) - Date.parse(inicio)) / 86400000 > 93) return invalido('período máximo de 93 dias');
  if (cpf && cpf.length !== 11) return invalido('cpf deve ter 11 dígitos');
  try {
    let transacoes = await transacoesBluecard({ desde: inicio, ate, cpf: cpf || null, compraId });
    const status = String(req.query.status || '').toLowerCase();
    if (status) transacoes = transacoes.filter((t) => t.status === status || (status === 'devolvida' && t.status === 'devolvida_parcial'));
    return res.json({
      desde: inicio,
      ate,
      quantidade: transacoes.length,
      total_bluecard_cents: transacoes.filter((t) => t.status !== 'cancelada' && t.status !== 'pendente').reduce((n, t) => n + t.valor_bluecard_cents, 0),
      transacoes,
    });
  } catch (e) {
    console.error('❌ [bluecard/transacoes]', e.message);
    return res.status(500).json({ erro: { codigo: 'erro_interno', mensagem: 'Falha ao ler as transações', detalhe: e.message } });
  }
});

// Fecha a janela de limite de uma compra se ela ainda estiver 'liberado'
// (usado por compra.recusada / compra.cancelada). Sem janela → não faz nada.
async function fecharJanelaSeAberta(compraId, novoStatus) {
  if (!compraId) return;
  const { data: lib } = await supabase
    .from('bluecard_liberacoes')
    .select('*')
    .eq('compra_id', compraId)
    .eq('status', 'liberado')
    .maybeSingle();
  if (!lib) return;
  // janela do TOTVS só é fechada com o gatilho ligado; a de loja só-HeadCoach fecha sempre
  if (!limiteAutoAtivo() && lib.limites_anteriores?.headcoach !== true) return;
  await zerarLimite(lib, novoStatus);
  console.log(`💳 [bluecard-limite] janela da compra ${compraId} fechada por ${novoStatus}`);
  notificarLiberacaoFechada(compraId, 'liberacao.cancelada', { valor_cents: lib.valor_cents }).catch((e) =>
    console.warn(`⚠️ [bluecard-limite] aviso liberacao.cancelada falhou: ${e.message}`),
  );
}

// ─────────────────────────────────────────────────────────────────────
// GET /api/bluecard/liberacoes/:compra_id
//
// O "okay" do gatilho de limite. O webhook compra.aprovada responde 200 na
// hora e sobe o limite no TOTVS em segundo plano (a escrita leva alguns
// segundos em dezenas de filiais). Aqui o app consulta se já subiu, para só
// então dizer ao cliente "pode passar no caixa".
//
// status:
//   pendente        — evento recebido, limite ainda não subiu (ou gatilho desligado)
//   liberado        — limite no TOTVS = valor da compra + títulos em aberto; caixa pode fechar
//   consumido       — venda detectada no TOTVS; limite já voltou ao anterior (0)
//   zerado_expirado — ninguém fechou a venda em BLUECARD_LIBERACAO_TIMEOUT_MIN; limite voltou a 0
//   cancelada       — compra recusada/cancelada com a janela aberta; limite voltou a 0
//   erro            — o HeadCoach não conseguiu subir o limite (detalhe no campo erro); retenta por 24h
// ─────────────────────────────────────────────────────────────────────
router.get('/liberacoes/:compra_id', exigirAssinaturaBluecard, async (req, res) => {
  const compraId = String(req.params.compra_id || '').trim();
  if (!compraId) {
    return res.status(400).json({
      erro: { codigo: 'campo_invalido', mensagem: 'compra_id obrigatório', detalhe: null },
    });
  }
  try {
    const { data: lib } = await supabase
      .from('bluecard_liberacoes')
      .select(
        'compra_id, cpf, valor_cents, abertos_cents, limite_cents, status, liberado_em, venda_detectada_em, zerado_em',
      )
      .eq('compra_id', compraId)
      .maybeSingle();

    if (lib) {
      return res.json({
        compra_id: lib.compra_id,
        gatilho_ativo: limiteAutoAtivo(),
        status: lib.status,
        valor_cents: lib.valor_cents,
        abertos_cents: lib.abertos_cents,
        limite_totvs_cents: lib.limite_cents,
        liberado_em: lib.liberado_em,
        venda_detectada_em: lib.venda_detectada_em,
        fechado_em: lib.zerado_em,
        expira_em: lib.liberado_em
          ? new Date(
              new Date(lib.liberado_em).getTime() +
                Number(process.env.BLUECARD_LIBERACAO_TIMEOUT_MIN || 120) * 60000,
            ).toISOString()
          : null,
      });
    }

    // Sem liberação: o evento chegou? Se chegou com erro, diz o motivo.
    const { data: ev } = await supabase
      .from('bluecard_eventos')
      .select('status, erro, recebido_em')
      .eq('evento', 'compra.aprovada')
      .filter('payload->compra->>id', 'eq', compraId)
      .order('recebido_em', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!ev) {
      return res.status(404).json({
        erro: { codigo: 'compra_nao_encontrada', mensagem: 'compra.aprovada não recebida para este id', detalhe: null },
      });
    }
    return res.json({
      compra_id: compraId,
      gatilho_ativo: limiteAutoAtivo(),
      status: ev.status === 'erro' ? 'erro' : 'pendente',
      erro: ev.status === 'erro' ? ev.erro : null,
      recebido_em: ev.recebido_em,
    });
  } catch (e) {
    console.error('❌ [bluecard/liberacoes]', e.message);
    return res.status(500).json({
      erro: { codigo: 'erro_interno', mensagem: 'Falha ao consultar a liberação', detalhe: e.message },
    });
  }
});

export default router;
