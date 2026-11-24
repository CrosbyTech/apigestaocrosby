// API HEADCOACH › accounts-payable — contas a pagar próprio do HeadCoach.
import { criarModulo, f, q } from './_engine.js';
import { inverso } from './_maps.js';

// os mapas ficam aqui porque só este módulo usa
const PAYABLE_STATUS = { aberto: 'Open', pago: 'Paid', cancelado: 'Canceled' };
const PAYABLE_DOCUMENT_TYPE = { duplicata: 'Duplicate', nota_fiscal: 'Invoice', boleto: 'BankSlip', recibo: 'Receipt', outro: 'Other' };
const PAYABLE_PAYMENT_METHOD = { pix: 'Pix', boleto: 'BankSlip', transferencia: 'Transfer', debito_automatico: 'DirectDebit', cartao: 'Card', dinheiro: 'Cash', outro: 'Other' };
const FORECAST_TYPE = { real: 'Real', previsao: 'Forecast' };
const COST_CENTER_TYPE = { empresa: 'Branch', setor: 'Department', outro: 'Other' };
// etapas da Liberação de Pagamento (HEADCOACH › FINANCEIRO)
const PAYMENT_RELEASE_STATUS = { pendente: 'Pending', previsao: 'Scheduled', aprovado: 'Approved', incluido: 'Included', pago: 'Paid', cancelado: 'Returned' };

const linhaRateio = {
  type: 'object',
  description: 'Linha do rateio (chaves em português, como gravado na tela).',
  properties: {
    despesa_code: { type: 'integer', description: 'Código da despesa.' },
    despesa_nome: { type: 'string', description: 'Nome da despesa.' },
    centro_custo_code: { type: 'integer', description: 'Código do centro de custo.' },
    centro_custo_nome: { type: 'string', description: 'Nome do centro de custo.' },
    percentual: { type: 'number', description: 'Percentual da linha (a soma é 100).' },
    valor: { type: 'number', description: 'Valor da linha (a soma é o valor da duplicata).' },
  },
};

const modulo = criarModulo({
  nome: 'accounts-payable',
  titulo: 'AccountsPayable',
  descricao:
    'Contas a pagar do HeadCoach: duplicatas de fornecedor com documento fiscal, portador, despesa e rateio por centro de custo. A duplicata é um número por empresa + fornecedor e cada lançamento é uma parcela dela: 1/11 e 1/12 são a duplicata 1, parcelas 11 e 12 (em conta mensal, a parcela é o mês do vencimento).',
});

const SETTLEMENT = {
  name: 'PayableSettlement',
  path: '/settlements',
  table: 'hc_cp_baixas',
  summary: 'Baixas (pagamentos)',
  description: 'Pagamentos das duplicatas, com juros, multa e desconto. Uma linha por pagamento: a duplicata paga em parte tem várias, e `documentValue` − (`paidValue` − juros − multa + desconto) é o que ficou em aberto depois de cada uma. Não há estorno de baixa.',
  order: [['id', false]],
  fields: [
    f('settlementId', 'id', 'integer', 'Identificador da baixa.'),
    f('documentId', 'titulo_id', 'integer', 'Duplicata baixada (documentId em /documents).'),
    f('paymentDate', 'data_pagamento', 'date', 'Data do pagamento.'),
    f('documentValue', 'valor_titulo', 'number', 'Quanto estava em aberto antes deste pagamento (na primeira baixa, o valor da duplicata).'),
    f('interestValue', 'juros', 'number', 'Juros pagos.'),
    f('fineValue', 'multa', 'number', 'Multa paga.'),
    f('discountValue', 'desconto', 'number', 'Desconto obtido.'),
    f('paidValue', 'valor_pago', 'number', 'Valor pago neste pagamento.'),
    f('paymentMethod', 'forma_pagamento', 'string', 'Como foi pago.', { map: PAYABLE_PAYMENT_METHOD }),
    f('account', 'conta', 'string', 'Banco / conta de onde saiu.'),
    f('observation', 'observacao', 'string', 'Observação.'),
    f('settledBy', 'por', 'string', 'Usuário que baixou.'),
    f('settlementDate', 'em', 'date-time', 'Quando a baixa foi lançada.'),
  ],
  filters: [
    q('documentId', 'int', 'titulo_id', 'Baixas de uma duplicata.'),
    q('startPaymentDate', 'startDay', 'data_pagamento', 'Pagas a partir de (AAAA-MM-DD).'),
    q('endPaymentDate', 'endDay', 'data_pagamento', 'Pagas até (AAAA-MM-DD).'),
  ],
};

modulo.recurso({
  name: 'PayableDocument',
  path: '/documents',
  table: 'hc_cp_titulos',
  summary: 'Duplicatas a pagar',
  description:
    'Uma linha por parcela. `duplicateCode` é o número da duplicata da empresa com aquele fornecedor (1, 2, 3…), `installmentCode` é a parcela dentro dela e `duplicateLabel` é como aparecem na tela ("1/12" = duplicata 1, parcela 12). Conta que vem todo mês (energia, aluguel) fica na mesma duplicata, com o mês do vencimento como parcela. `fiscalDocument` é a nota / fatura do fornecedor, muda a cada parcela e pode vir vazio (aluguel, recibo). Quando a despesa é rateada, `apportionment` traz as linhas, e `expenseCode` / `costCenterCode` são os da linha de maior percentual. Baixa parcial: a duplicata paga em parte continua `Open`, com `paidValue` = o que já saiu, `remainingValue` = o que falta e uma linha em /settlements por pagamento; para somar o que foi PAGO use `paidValue` (das Paid e das pagas em parte) e para o que está EM ABERTO use `remainingValue`. As duplicatas com `origin` = totvs vieram do contas a pagar do TOTVS já pagas (baixa de lá, conciliação do extrato ou Liberação de Pagamento): `fiscalDocument` guarda o número da duplicata no TOTVS e `settledBy` diz por onde foi paga.',
  key: [{ param: 'documentId', col: 'id', type: 'integer', description: 'Identificador da parcela.' }],
  order: [['vencimento', true], ['id', true]],
  fields: [
    f('documentId', 'id', 'integer', 'Identificador interno da parcela.'),
    f('branchCode', 'empresa', 'integer', 'Empresa.', { example: 87 }),
    f('supplierCode', 'fornecedor_code', 'integer', 'Código do fornecedor (pessoa).', { example: 184 }),
    f('supplierName', 'fornecedor_nome', 'string', 'Nome do fornecedor.'),
    f('supplierCpfCnpj', 'fornecedor_cpf_cnpj', 'string', 'CPF ou CNPJ do fornecedor.'),
    f('duplicateCode', 'duplicata', 'integer', 'Número da duplicata, por empresa + fornecedor.', { example: 1 }),
    f('installmentCode', 'parcela', 'integer', 'Parcela dentro da duplicata (conta mensal: o mês do vencimento).', { example: 12 }),
    f('duplicateLabel', (l) => (l.duplicata ? `${l.duplicata}/${l.parcela}` : null), 'string', 'Duplicata / parcela, como aparece na tela.', { cols: ['duplicata', 'parcela'], example: '1/12' }),
    f('fiscalDocument', 'documento_fiscal', 'string', 'Documento fiscal: número da nota / fatura do fornecedor.', { example: '169814411' }),
    f('batchId', 'lote', 'string', 'Lote: parcelas incluídas na mesma vez.'),
    f('documentType', 'tipo_documento', 'string', 'Tipo de documento.', { map: PAYABLE_DOCUMENT_TYPE }),
    f('bearerCode', 'portador_code', 'integer', 'Código do portador.'),
    f('bearerName', 'portador_nome', 'string', 'Portador.'),
    f('paymentMethod', 'forma_pagamento', 'string', 'Forma de pagamento prevista.', { map: PAYABLE_PAYMENT_METHOD }),
    f('pixKey', 'chave_pix', 'string', 'Chave Pix ou Pix copia e cola.'),
    f('barcode', 'codigo_barras', 'string', 'Linha digitável do boleto.'),
    f('expenseCode', 'despesa_code', 'integer', 'Despesa (a da linha principal do rateio).', { example: 6010 }),
    f('expenseName', 'despesa_nome', 'string', 'Nome da despesa.'),
    f('costCenterCode', 'centro_custo_code', 'integer', 'Centro de custo (o da linha principal do rateio).'),
    f('costCenterName', 'centro_custo_nome', 'string', 'Nome do centro de custo.'),
    f('apportionment', 'rateio', 'array', 'Rateio por despesa e centro de custo.', { items: linhaRateio }),
    f('forecastType', 'previsao', 'string', 'Conta real ou previsão.', { map: FORECAST_TYPE }),
    f('issueDate', 'emissao', 'date', 'Emissão.'),
    f('entryDate', 'entrada', 'date', 'Entrada (quando foi lançada).'),
    f('dueDate', 'vencimento', 'date', 'Vencimento.'),
    f('reference', 'referencia', 'string', 'Competência (ex.: 10/2026).'),
    f('value', 'valor', 'number', 'Valor da duplicata.'),
    f('status', 'situacao', 'string', 'Situação. Vencida = Open com dueDate anterior a hoje. A duplicata paga em parte continua Open até zerar (veja isPartiallyPaid).', { map: PAYABLE_STATUS }),
    f('paymentDate', 'data_pagamento', 'date', 'Data do pagamento (do último, quando houve mais de um).'),
    f('interestValue', 'juros', 'number', 'Juros pagos na baixa.'),
    f('fineValue', 'multa', 'number', 'Multa paga na baixa.'),
    f('discountValue', 'desconto', 'number', 'Desconto obtido na baixa.'),
    f('paidValue', 'valor_pago', 'number', 'Valor pago até agora (soma das baixas; na duplicata paga em parte é o que já saiu).'),
    f('remainingValue', (l) => (l.situacao !== 'aberto' ? 0 : Math.max(0, Math.round((Number(l.valor || 0) - Math.max(0, Number(l.valor_pago || 0) - Number(l.juros || 0) - Number(l.multa || 0) + Number(l.desconto || 0)) + Number.EPSILON) * 100) / 100)), 'number', 'Quanto falta pagar: valor − (pago − juros − multa + desconto). Zero na paga e na cancelada.', { cols: ['situacao', 'valor', 'valor_pago', 'juros', 'multa', 'desconto'], example: 5500 }),
    f('isPartiallyPaid', (l) => l.situacao === 'aberto' && Number(l.valor_pago || 0) > 0, 'boolean', 'Paga em parte: continua Open, com `paidValue` já pago e `remainingValue` em aberto.', { cols: ['situacao', 'valor_pago'] }),
    f('paymentAccount', 'conta_pagamento', 'string', 'Banco / conta de onde saiu o pagamento.'),
    f('observation', 'observacao', 'string', 'Observação.'),
    f('origin', 'origem', 'string', 'De onde veio: manual (tela), o robô que capturou a conta (ex.: bot-cosern-whatsapp), solicitacao-crosby (Solicitação Crosby aprovada pelo financeiro; originReference = id da solicitação) ou totvs (duplicata já paga importada do contas a pagar do TOTVS — a marca TOTVS da tela).', { example: 'totvs' }),
    f('originReference', 'origem_ref', 'string', 'Identificador na origem. Nas importadas do TOTVS: empresa|fornecedor|duplicata|parcela de lá.'),
    f('createdBy', 'criado_por', 'string', 'Quem incluiu.'),
    f('createDate', 'criado_em', 'date-time', 'Quando foi incluída.'),
    f('settledBy', 'baixado_por', 'string', 'Quem baixou.'),
    f('settledDate', 'baixado_em', 'date-time', 'Quando foi baixada.'),
    f('cancelDate', 'cancelado_em', 'date-time', 'Quando foi cancelada.'),
    f('cancelReason', 'cancelado_motivo', 'string', 'Motivo do cancelamento.'),
    f('lastChangeDate', 'atualizado_em', 'date-time', 'Última alteração.'),
  ],
  filters: [
    q('branchCodeList', 'intList', 'empresa', 'Empresas, separadas por vírgula.'),
    q('status', 'enum', 'situacao', 'Situação (aceita lista).', { map: inverso(PAYABLE_STATUS) }),
    q('supplierCode', 'int', 'fornecedor_code', 'Código do fornecedor.'),
    q('supplierCpfCnpj', 'digits', 'fornecedor_cpf_cnpj', 'CPF ou CNPJ do fornecedor.'),
    q('duplicateCode', 'int', 'duplicata', 'Número da duplicata (use junto com empresa e fornecedor): traz todas as parcelas dela.'),
    q('installmentCode', 'int', 'parcela', 'Parcela.'),
    q('fiscalDocument', 'string', 'documento_fiscal', 'Documento fiscal exato.', { example: '169814411' }),
    q('batchId', 'string', 'lote', 'Parcelas incluídas na mesma vez.'),
    q('isPartiallyPaid', 'custom', 'valor_pago', 'true = só as pagas em parte (em aberto com pagamento lançado); false = todas as outras.', {
      example: 'true',
      apply: (query, v, ruim) => (String(v) === 'true' ? query.eq('situacao', 'aberto').gt('valor_pago', 0) : String(v) === 'false' ? query.or('situacao.neq.aberto,valor_pago.eq.0') : ruim('Esperado true ou false.')),
    }),
    q('origin', 'string', 'origem', 'Origem exata (ex.: totvs = só as importadas do TOTVS; manual = só as incluídas na tela).', { example: 'totvs' }),
    q('expenseCode', 'custom', 'rateio', 'Despesa, em qualquer linha do rateio.', {
      apply: (query, v, ruim) => (Number.isInteger(Number(v)) ? query.contains('rateio', JSON.stringify([{ despesa_code: Number(v) }])) : ruim('Esperado um número inteiro.')),
    }),
    q('costCenterCode', 'custom', 'rateio', 'Centro de custo, em qualquer linha do rateio.', {
      apply: (query, v, ruim) => (Number.isInteger(Number(v)) ? query.contains('rateio', JSON.stringify([{ centro_custo_code: Number(v) }])) : ruim('Esperado um número inteiro.')),
    }),
    q('bearerCode', 'int', 'portador_code', 'Código do portador.'),
    q('paymentMethod', 'enum', 'forma_pagamento', 'Forma de pagamento (aceita lista).', { map: inverso(PAYABLE_PAYMENT_METHOD) }),
    q('forecastType', 'enum', 'previsao', 'Conta real ou previsão.', { map: inverso(FORECAST_TYPE) }),
    q('startIssueDate', 'startDay', 'emissao', 'Emitidas a partir de (AAAA-MM-DD).'),
    q('endIssueDate', 'endDay', 'emissao', 'Emitidas até (AAAA-MM-DD).'),
    q('startDueDate', 'startDay', 'vencimento', 'Vencimento a partir de (AAAA-MM-DD).'),
    q('endDueDate', 'endDay', 'vencimento', 'Vencimento até (AAAA-MM-DD).'),
    q('startPaymentDate', 'startDay', 'data_pagamento', 'Pagas a partir de (AAAA-MM-DD).'),
    q('endPaymentDate', 'endDay', 'data_pagamento', 'Pagas até (AAAA-MM-DD).'),
    q('startChangeDate', 'startDate', 'atualizado_em', 'Alteradas a partir de (AAAA-MM-DD) — para sincronização.'),
  ],
  expand: { settlements: { resource: SETTLEMENT, fk: 'titulo_id', description: 'Baixas da duplicata' } },
});

modulo.recurso(SETTLEMENT);

modulo.recurso({
  name: 'PayablePaymentRelease',
  path: '/payment-releases',
  table: 'hc_cp_liberacoes',
  summary: 'Liberação de pagamento',
  description:
    'Duplicatas que o financeiro liberou para pagamento, no fluxo Pending (pendente) → Scheduled (previsão) → Approved (aprovado) → Included (incluído no banco) → Paid (pago). Returned = devolvida ao contas a pagar sem pagar. Uma duplicata tem no máximo uma liberação em andamento; `value` é quanto vai ser pago nela (menor que o que falta = pagamento parcial). Ao pagar, `settlementId` aponta a baixa em /settlements.',
  key: [{ param: 'releaseId', col: 'id', type: 'integer', description: 'Identificador da liberação.' }],
  order: [['id', false]],
  fields: [
    f('releaseId', 'id', 'integer', 'Identificador da liberação.'),
    f('documentId', 'titulo_id', 'integer', 'Duplicata liberada (documentId em /documents).'),
    f('status', 'status', 'string', 'Etapa da liberação.', { map: PAYMENT_RELEASE_STATUS }),
    f('value', 'valor', 'number', 'Quanto vai ser (ou foi) pago nesta liberação.'),
    f('scheduledDate', 'data_prevista', 'date', 'Dia previsto para pagar.'),
    f('bankAccount', 'banco', 'string', 'Banco / conta de onde o pagamento sai.', { example: 'STONE 0116' }),
    f('paymentMethod', 'forma_pagamento', 'string', 'Forma de pagamento.', { map: PAYABLE_PAYMENT_METHOD }),
    f('observation', 'observacao', 'string', 'Observação.'),
    f('releasedBy', 'liberado_por', 'string', 'Quem liberou para pagamento.'),
    f('releaseDate', 'liberado_em', 'date-time', 'Quando foi liberada.'),
    f('approvedBy', 'aprovado_por', 'string', 'Quem aprovou.'),
    f('approvalDate', 'aprovado_em', 'date-time', 'Quando foi aprovada.'),
    f('includedBy', 'incluido_por', 'string', 'Quem incluiu o pagamento no banco.'),
    f('inclusionDate', 'incluido_em', 'date-time', 'Quando foi incluída no banco.'),
    f('paidBy', 'pago_por', 'string', 'Quem marcou como paga.'),
    f('paymentDate', 'data_pagamento', 'date', 'Data do pagamento.'),
    f('settlementId', 'baixa_id', 'integer', 'Baixa gravada na duplicata (settlementId em /settlements).'),
    f('returnedBy', 'cancelado_por', 'string', 'Quem devolveu ao contas a pagar.'),
    f('returnDate', 'cancelado_em', 'date-time', 'Quando foi devolvida.'),
    f('returnReason', 'cancelado_motivo', 'string', 'Motivo da devolução.'),
    f('stoneInclusion', 'inclusao', 'object', 'Inclusão automática na Stone (chaves em português, como gravado): status (fila, processando, incluido, erro, bloqueado, verificar, cancelada ou manual), conta, forma, recebedor, erro/motivo e em (quando).'),
    f('lastChangeDate', 'atualizado_em', 'date-time', 'Última alteração.'),
  ],
  filters: [
    q('documentId', 'int', 'titulo_id', 'Liberações de uma duplicata.'),
    q('status', 'enum', 'status', 'Etapa (aceita lista).', { map: inverso(PAYMENT_RELEASE_STATUS) }),
    q('bankAccount', 'string', 'banco', 'Banco / conta exata.', { example: 'STONE 0116' }),
    q('paymentMethod', 'enum', 'forma_pagamento', 'Forma de pagamento (aceita lista).', { map: inverso(PAYABLE_PAYMENT_METHOD) }),
    q('startScheduledDate', 'startDay', 'data_prevista', 'Previstas a partir de (AAAA-MM-DD).'),
    q('endScheduledDate', 'endDay', 'data_prevista', 'Previstas até (AAAA-MM-DD).'),
    q('startPaymentDate', 'startDay', 'data_pagamento', 'Pagas a partir de (AAAA-MM-DD).'),
    q('endPaymentDate', 'endDay', 'data_pagamento', 'Pagas até (AAAA-MM-DD).'),
    q('startChangeDate', 'startDate', 'atualizado_em', 'Alteradas a partir de (AAAA-MM-DD) — para sincronização.'),
  ],
});

modulo.recurso({
  name: 'PayableExpense',
  path: '/expenses',
  table: 'hc_cp_despesas',
  summary: 'Despesas',
  description: 'Plano de despesas usado nas duplicatas.',
  key: [{ param: 'expenseCode', col: 'code', type: 'integer', description: 'Código da despesa.' }],
  order: [['code', true]],
  fields: [
    f('expenseCode', 'code', 'integer', 'Código da despesa.', { example: 6010 }),
    f('expenseName', 'nome', 'string', 'Nome da despesa.'),
    f('isActive', 'ativo', 'boolean', 'Em uso.'),
  ],
  filters: [q('expenseName', 'text', 'nome', 'Parte do nome.'), q('isActive', 'bool', 'ativo', 'Só as em uso (true).')],
});

modulo.recurso({
  name: 'PayableCostCenter',
  path: '/cost-centers',
  table: 'hc_cp_centros_custo',
  summary: 'Centros de custo',
  description: 'Centros de custo do rateio: por empresa (loja, matriz) ou por setor.',
  key: [{ param: 'costCenterCode', col: 'code', type: 'integer', description: 'Código do centro de custo.' }],
  order: [['code', true]],
  fields: [
    f('costCenterCode', 'code', 'integer', 'Código do centro de custo.'),
    f('costCenterName', 'nome', 'string', 'Nome do centro de custo.'),
    f('costCenterType', 'tipo', 'string', 'Empresa, setor ou outro.', { map: COST_CENTER_TYPE }),
    f('isActive', 'ativo', 'boolean', 'Em uso.'),
  ],
  filters: [
    q('costCenterType', 'enum', 'tipo', 'Tipo (aceita lista).', { map: inverso(COST_CENTER_TYPE) }),
    q('isActive', 'bool', 'ativo', 'Só os em uso (true).'),
  ],
});

export default modulo;
