// API HEADCOACH › billing — faturamento da expedição (pedidos e Brejinho).
import { criarModulo, f, q, rotaCalculada, supabase, ApiError } from './_engine.js';
import { INVOICE_STATUS, DUPLICATE_STATUS, TOTVS_TRANSACTION_STATUS, inverso } from './_maps.js';

const modulo = criarModulo({
  nome: 'billing',
  titulo: 'Billing',
  descricao: 'Faturamento da expedição (empresa 99): cada pedido faturado, o que foi conferido, a nota emitida e a duplicata enviada ao cliente. Vale para o Faturamento de pedidos do Dryland, o Faturamento Brejinho e o faturamento avulso.',
});

const origemDe = (l) => (String(l.chave || '').startsWith('BRJ:') ? 'Brejinho' : String(l.chave || '').startsWith('AVULSO:') ? 'Direct' : 'Order');
const itemConferencia = { type: 'object', additionalProperties: true, description: 'Peça da conferência (chaves em português, como gravado na tela: sku, nome, quantidade, epcs…).' };

const DUPLICATE = {
  name: 'BillingDuplicate',
  path: '/duplicates',
  table: 'faturamento_duplicatas',
  summary: 'Duplicatas',
  description: 'Duplicata (confirmação de compra a prazo) enviada ao cliente das vendas com boleto: o documento vai para assinatura no Autentique e o link segue pelo WhatsApp. Uma por transação.',
  order: [['venda_id', false]],
  fields: [
    f('transactionCode', 'venda_id', 'integer', 'Transação da venda.'),
    f('billingId', 'faturamento_id', 'integer', 'Faturamento (/billings).'),
    f('orderKey', 'chave', 'string', 'Chave do pedido.'),
    f('invoiceCode', 'nf_numero', 'integer', 'Número da nota.'),
    f('customerName', 'cliente_nome', 'string', 'Nome do cliente.'),
    f('phone', 'telefone', 'string', 'WhatsApp para onde a duplicata foi.'),
    f('status', 'status', 'string', 'Situação da duplicata.', { map: DUPLICATE_STATUS }),
    f('errorMessage', 'erro', 'string', 'Erro do envio, quando houve.'),
    f('signatureDocumentId', 'doc_id', 'string', 'Documento no Autentique.'),
    f('signatureLink', 'link', 'string', 'Link de assinatura enviado ao cliente.'),
    f('sentDate', 'enviada_em', 'date-time', 'Quando foi enviada.'),
    f('signedDate', 'assinada_em', 'date-time', 'Quando foi assinada.'),
    f('signedDocumentUrl', 'assinada_url', 'string', 'Documento assinado.'),
    f('senderName', 'chip', 'string', 'Número de WhatsApp que enviou.'),
    f('createdBy', 'criado_por', 'string', 'Quem disparou.'),
    f('sendHistory', 'historico', 'array', 'Histórico de envios, do mais antigo ao mais novo: envio, reenvio (mesmo link), novo_documento, outro_telefone (número trocado pelo owner na tela Transações) e falha.', {
      items: { type: 'object', additionalProperties: true, description: 'Evento do histórico (chaves em português, como gravado: em, por, tipo, telefone, de, chip, link, erro).' },
    }),
    f('createdDate', 'criado_em', 'date-time', 'Criação do registro.'),
    f('lastChangeDate', 'atualizado_em', 'date-time', 'Última alteração.'),
  ],
  filters: [
    q('status', 'enum', 'status', 'Situação (aceita lista).', { map: inverso(DUPLICATE_STATUS) }),
    q('transactionCode', 'int', 'venda_id', 'Duplicata de uma transação.'),
    q('invoiceCode', 'int', 'nf_numero', 'Número da nota.'),
    q('orderKey', 'string', 'chave', 'Chave do pedido.'),
    q('startDate', 'startDate', 'criado_em', 'Criadas a partir de (AAAA-MM-DD).'),
    q('endDate', 'endDate', 'criado_em', 'Criadas até (AAAA-MM-DD).'),
    q('startChangeDate', 'startDate', 'atualizado_em', 'Alteradas a partir de (AAAA-MM-DD) — para sincronização.'),
  ],
};

modulo.recurso({
  name: 'Billing',
  path: '/billings',
  table: 'pedidos_venda_faturamentos',
  summary: 'Faturamentos',
  description:
    'Uma linha por faturamento de pedido. `orderKey` é a chave do pedido no Dryland (BRJ:… = Brejinho, AVULSO:… = sem pedido) e `orderNumber` o número (RV…, MT…, FR…, VJ…, PE…). `transactionCode` é a transação do HeadCoach; os campos `totvs…` só existem nos faturamentos de 10 a 12/11/2026, que ainda foram espelhados no TOTVS. Um pedido refaturado tem mais de uma linha: a nota cancelada e a nova.',
  key: [{ param: 'billingId', col: 'id', type: 'integer', description: 'Identificador do faturamento.' }],
  order: [['id', false]],
  fields: [
    f('billingId', 'id', 'integer', 'Identificador do faturamento.'),
    f('origin', origemDe, 'string', 'Pedido do Dryland, Brejinho ou avulso.', { cols: ['chave'], enum: ['Order', 'Brejinho', 'Direct'] }),
    f('orderKey', 'chave', 'string', 'Chave do pedido no Dryland.'),
    f('orderNumber', 'numero_site', 'string', 'Número do pedido.'),
    f('branchCode', 'empresa', 'integer', 'Empresa que faturou.', { example: 99 }),
    f('transactionCode', 'venda_id', 'integer', 'Transação do HeadCoach (transaction/transactions).'),
    f('operationCode', 'operacao', 'integer', 'Operação.'),
    f('cfop', 'cfop', 'integer', 'CFOP principal.'),
    f('customerCode', 'cliente_code', 'integer', 'Código do cliente.'),
    f('customerName', 'cliente_nome', 'string', 'Nome do cliente.'),
    f('sellerCode', 'vendedor_code', 'integer', 'Código do vendedor.'),
    f('totalValue', 'total', 'number', 'Valor faturado.'),
    f('freightValue', 'frete', 'number', 'Frete.'),
    f('paymentMethods', 'forma_pagamento', 'string', 'Formas de pagamento, em texto, com os nomes em português (ex.: "pix + credito_loja").'),
    f('orderQuantity', 'qtd_pedido', 'number', 'Peças do pedido.'),
    f('checkedQuantity', 'qtd_conferida', 'number', 'Peças conferidas (lidas no portal RFID).'),
    f('missingQuantity', 'qtd_faltando', 'number', 'Peças do pedido que não foram.'),
    f('surplusQuantity', 'qtd_sobrando', 'number', 'Peças lidas que não eram do pedido.'),
    f('checkedItems', 'conferidos', 'array', 'Peças conferidas.', { items: itemConferencia }),
    f('missingItems', 'faltando', 'array', 'Peças que faltaram.', { items: itemConferencia }),
    f('surplusItems', 'sobrando', 'array', 'Peças que sobraram.', { items: itemConferencia }),
    f('invoiceCode', 'nf_numero', 'integer', 'Número da nota.'),
    f('invoiceSerialCode', 'nf_serie', 'integer', 'Série da nota.'),
    f('invoiceAccessKey', 'nf_chave', 'string', 'Chave da nota.'),
    f('invoiceStatus', 'nf_status', 'string', 'Situação da nota.', { map: INVOICE_STATUS }),
    f('totvsTransactionCode', 'transacao_code', 'integer', 'Transação no TOTVS (só nos faturamentos espelhados).'),
    f('totvsTransactionStatus', 'transacao_status', 'string', 'Situação da transação no padrão do TOTVS.', { map: TOTVS_TRANSACTION_STATUS }),
    f('totvsError', 'totvs_erro', 'string', 'Erro do espelho no TOTVS, quando houve.'),
    f('attendedDate', 'atendida_em', 'date-time', 'Quando foi atendida.'),
    f('createdBy', 'criado_por', 'string', 'Quem faturou.'),
    f('billingDate', 'criado_em', 'date-time', 'Data e hora do faturamento.'),
    f('lastChangeDate', 'atualizado_em', 'date-time', 'Última alteração.'),
  ],
  filters: [
    q('origin', 'custom', null, 'Pedido do Dryland (Order), Brejinho ou avulso (Direct).', {
      apply: (qy, v, ruim) => {
        const o = ['Order', 'Brejinho', 'Direct'].find((k) => k.toLowerCase() === v.toLowerCase());
        if (!o) ruim('Valores aceitos: Order, Brejinho, Direct.');
        if (o === 'Brejinho') return qy.like('chave', 'BRJ:%');
        if (o === 'Direct') return qy.like('chave', 'AVULSO:%');
        return qy.not('chave', 'like', 'BRJ:%').not('chave', 'like', 'AVULSO:%');
      },
    }),
    q('orderKey', 'string', 'chave', 'Chave do pedido no Dryland (exata).'),
    q('orderNumber', 'string', 'numero_site', 'Número do pedido (exato).'),
    q('customerCode', 'int', 'cliente_code', 'Código do cliente.'),
    q('sellerCode', 'int', 'vendedor_code', 'Código do vendedor.'),
    q('invoiceCode', 'int', 'nf_numero', 'Número da nota.'),
    q('invoiceStatus', 'enum', 'nf_status', 'Situação da nota (aceita lista).', { map: inverso(INVOICE_STATUS) }),
    q('transactionCode', 'int', 'venda_id', 'Faturamento de uma transação.'),
    q('startDate', 'startDate', 'criado_em', 'Faturados a partir de (AAAA-MM-DD).'),
    q('endDate', 'endDate', 'criado_em', 'Faturados até (AAAA-MM-DD).'),
    q('startChangeDate', 'startDate', 'atualizado_em', 'Alterados a partir de (AAAA-MM-DD) — para sincronização.'),
  ],
  expand: { duplicates: { resource: DUPLICATE, fk: 'faturamento_id', description: 'Duplicata do faturamento' } },
});

modulo.recurso(DUPLICATE);

modulo.calculado({
  path: '/settings',
  paginado: false,
  summary: 'Configurações do faturamento',
  description: 'O que o admin ou o owner liga pela tela do Faturamento. Hoje: a troca de produtos na conferência (a peça que falta pode ser substituída por outra, pelo mesmo valor), que vale enquanto `allowed` for true e hoje não passar de `allowedUntil`.',
  schemaName: 'BillingSettings',
  schema: {
    type: 'object',
    description: 'Configurações do faturamento.',
    properties: {
      productExchange: {
        type: 'object',
        description: 'Troca de produtos na conferência.',
        properties: {
          allowed: { type: 'boolean', description: 'Marcada como liberada.' },
          allowedUntil: { type: 'string', format: 'date', nullable: true, description: 'Último dia em que vale.' },
          inEffect: { type: 'boolean', description: 'Vale hoje (liberada e dentro do prazo).' },
          lastChangedBy: { type: 'string', nullable: true },
          lastChangeDate: { type: 'string', format: 'date-time', nullable: true },
        },
      },
    },
  },
  handler: rotaCalculada(async (req) => {
    if (Object.keys(req.query).length) throw new ApiError(400, 'UnknownParameter', `Parâmetro desconhecido: ${Object.keys(req.query).join(', ')}`, 'Este recurso não tem parâmetros.');
    const { data, error } = await supabase.from('faturamento_config').select('*').eq('chave', 'troca_produtos').maybeSingle();
    if (error) throw new ApiError(500, 'DatabaseError', 'Erro ao consultar o banco', error.message);
    const v = data?.valor || {};
    const hoje = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Recife' }).format(new Date());
    const ate = /^\d{4}-\d{2}-\d{2}$/.test(String(v.ate || '')) ? v.ate : null;
    const liberada = v.liberada === true && !!ate;
    return { productExchange: { allowed: liberada, allowedUntil: ate, inEffect: liberada && hoje <= ate, lastChangedBy: data?.atualizado_por || null, lastChangeDate: data?.atualizado_em || null } };
  }),
});

export default modulo;
