// API HEADCOACH › cashier — caixa das empresas.
import { criarModulo, f, q } from './_engine.js';
import { CASHIER_STATUS, CASHIER_MOVEMENT, inverso } from './_maps.js';

const modulo = criarModulo({
  nome: 'cashier',
  titulo: 'Cashier',
  descricao: 'Caixa do HeadCoach: um por empresa e dia. Abertura com o fundo, suprimentos e retiradas, contagem, fechamento e o encerramento do dia. O PDV só vende com o caixa aberto.',
});

const MOVEMENT = {
  name: 'CashierMovement',
  path: '/movements',
  table: 'hc_caixa_movimentos',
  summary: 'Suprimentos e retiradas',
  description: 'Entradas e saídas de dinheiro do caixa fora das vendas: suprimento, retirada (sangria) e a retirada do fechamento.',
  order: [['id', false]],
  fields: [
    f('movementId', 'id', 'integer', 'Identificador do movimento.'),
    f('cashierCode', 'caixa_id', 'integer', 'Caixa.'),
    f('branchCode', 'empresa', 'integer', 'Empresa.'),
    f('cashierDate', 'data_caixa', 'date', 'Data do caixa.'),
    f('movementType', 'tipo', 'string', 'Tipo do movimento.', { map: CASHIER_MOVEMENT }),
    f('value', 'valor', 'number', 'Valor.'),
    f('reason', 'motivo', 'string', 'Motivo informado.'),
    f('createdBy', 'por', 'string', 'Quem lançou.'),
    f('movementDate', 'em', 'date-time', 'Quando foi lançado.'),
    f('reversalDate', 'estornado_em', 'date-time', 'Quando foi estornado (movimento estornado não conta).'),
    f('reversedBy', 'estornado_por', 'string', 'Quem estornou.'),
    f('reversalReason', 'estorno_motivo', 'string', 'Motivo do estorno.'),
  ],
  filters: [
    q('branchCodeList', 'intList', 'empresa', 'Empresas, separadas por vírgula.'),
    q('cashierCode', 'int', 'caixa_id', 'Movimentos de um caixa.'),
    q('movementType', 'enum', 'tipo', 'Tipo do movimento (aceita lista).', { map: inverso(CASHIER_MOVEMENT) }),
    q('startCashierDate', 'startDay', 'data_caixa', 'Data do caixa a partir de (AAAA-MM-DD).'),
    q('endCashierDate', 'endDay', 'data_caixa', 'Data do caixa até (AAAA-MM-DD).'),
  ],
};

const COUNT = {
  name: 'CashierCount',
  path: '/counts',
  table: 'hc_caixa_contagens',
  summary: 'Contagens do caixa',
  description: 'Contagem feita no fechamento: o dinheiro contado contra o esperado e o valor de cada forma de pagamento.',
  order: [['id', false]],
  fields: [
    f('countId', 'id', 'integer', 'Identificador da contagem.'),
    f('cashierCode', 'caixa_id', 'integer', 'Caixa.'),
    f('countedCashValue', 'dinheiro_contado', 'number', 'Dinheiro contado.'),
    f('expectedCashValue', 'dinheiro_esperado', 'number', 'Dinheiro esperado pelo sistema.'),
    f('cashDifferenceValue', 'diferenca_dinheiro', 'number', 'Diferença no dinheiro (contado − esperado).'),
    f('totalDifferenceValue', 'diferenca_total', 'number', 'Diferença somando todas as formas.'),
    f('banknotes', 'cedulas', 'object', 'Cédulas e moedas contadas, quando detalhadas (valor → quantidade).'),
    f('paymentMethods', 'formas', 'object', 'Valor informado por forma de pagamento, com as chaves em português como na tela (pix, credito, debito…).'),
    f('observation', 'observacao', 'string', 'Observação.'),
    f('countedBy', 'por', 'string', 'Quem contou.'),
    f('countDate', 'em', 'date-time', 'Quando foi contado.'),
    f('reopenedDate', 'reaberta_em', 'date-time', 'Quando a contagem foi reaberta.'),
    f('reopenedBy', 'reaberta_por', 'string', 'Quem reabriu.'),
    f('reopenAuthorizedBy', 'reabertura_autorizada_por', 'string', 'Quem autorizou a reabertura.'),
    f('reopenReason', 'reabertura_motivo', 'string', 'Motivo da reabertura.'),
  ],
  filters: [q('cashierCode', 'int', 'caixa_id', 'Contagens de um caixa.'), q('startDate', 'startDate', 'em', 'A partir de (AAAA-MM-DD).'), q('endDate', 'endDate', 'em', 'Até (AAAA-MM-DD).')],
};

modulo.recurso({
  name: 'Cashier',
  path: '/cashiers',
  table: 'hc_caixas',
  summary: 'Caixas',
  description: 'Um caixa por empresa e dia. `summary` é o resumo gravado no fechamento (vendas por forma, devoluções, faturamento do caixa), com as chaves em português como na tela.',
  key: [{ param: 'cashierCode', col: 'id', type: 'integer', description: 'Número do caixa.' }],
  order: [['id', false]],
  fields: [
    f('cashierCode', 'id', 'integer', 'Número do caixa.', { example: 7 }),
    f('branchCode', 'empresa', 'integer', 'Empresa.', { example: 95 }),
    f('terminalCode', 'terminal', 'integer', 'Terminal.'),
    f('cashierDate', 'data_caixa', 'date', 'Data do caixa (a data em que as vendas contam).'),
    f('status', 'status', 'string', 'Aberto ou fechado.', { map: CASHIER_STATUS }),
    f('openingFloatValue', 'fundo_inicial', 'number', 'Fundo de troco na abertura.'),
    f('suggestedFloatValue', 'fundo_sugerido', 'number', 'Fundo sugerido pelo sistema (o que ficou no fechamento anterior).'),
    f('openingObservation', 'observacao_abertura', 'string', 'Observação da abertura.'),
    f('openedDate', 'aberto_em', 'date-time', 'Quando foi aberto.'),
    f('openedBy', 'aberto_por', 'string', 'Quem abriu.'),
    f('closedDate', 'fechado_em', 'date-time', 'Quando foi fechado.'),
    f('closedBy', 'fechado_por', 'string', 'Quem fechou.'),
    f('closingFloatValue', 'fundo_final', 'number', 'Fundo que ficou para o dia seguinte.'),
    f('closingWithdrawalValue', 'retirada_fechamento', 'number', 'Retirada feita no fechamento.'),
    f('differenceValue', 'diferenca', 'number', 'Diferença total do fechamento.'),
    f('cashDifferenceValue', 'diferenca_dinheiro', 'number', 'Diferença no dinheiro.'),
    f('summary', 'resumo', 'object', 'Resumo do caixa gravado no fechamento, com as chaves da tela: `totalVendas`, `formas` (total por forma de pagamento), `fundoFinal`, `retiradaFechamento`, `pendentes` (vendas sem nota no fechamento) e `contagem` (`dinheiroContado`, `diferencaDinheiro`, `diferencaTotal`).'),
    f('closingObservation', 'observacao_fechamento', 'string', 'Observação do fechamento.'),
    f('reopenedDate', 'reaberto_em', 'date-time', 'Quando foi reaberto.'),
    f('reopenedBy', 'reaberto_por', 'string', 'Quem reabriu.'),
    f('reopenReason', 'reabertura_motivo', 'string', 'Motivo da reabertura.'),
    f('lastChangeDate', 'atualizado_em', 'date-time', 'Última alteração.'),
  ],
  filters: [
    q('branchCodeList', 'intList', 'empresa', 'Empresas, separadas por vírgula.'),
    q('status', 'enum', 'status', 'Aberto ou fechado.', { map: inverso(CASHIER_STATUS) }),
    q('startCashierDate', 'startDay', 'data_caixa', 'Data do caixa a partir de (AAAA-MM-DD).'),
    q('endCashierDate', 'endDay', 'data_caixa', 'Data do caixa até (AAAA-MM-DD).'),
  ],
  expand: {
    movements: { resource: MOVEMENT, fk: 'caixa_id', description: 'Suprimentos e retiradas do caixa' },
    counts: { resource: COUNT, fk: 'caixa_id', description: 'Contagens do caixa' },
  },
});

modulo.recurso(MOVEMENT);
modulo.recurso(COUNT);

modulo.recurso({
  name: 'CashierDayClosing',
  path: '/day-closings',
  table: 'hc_caixa_encerramentos',
  summary: 'Encerramentos do dia',
  description: 'Encerramento diário da empresa: confere que tudo do dia está fechado e avança a data do caixa para o próximo dia.',
  order: [['id', false]],
  fields: [
    f('closingId', 'id', 'integer', 'Identificador do encerramento.'),
    f('branchCode', 'empresa', 'integer', 'Empresa.'),
    f('cashierDate', 'data_caixa', 'date', 'Dia encerrado.'),
    f('nextCashierDate', 'proxima_data', 'date', 'Data do caixa depois do encerramento.'),
    f('verification', 'verificacao', 'object', 'O que foi conferido no encerramento, com as chaves da tela: `caixas` (caixas do dia), `comDiferenca` (quantos fecharam com diferença), `vendasPendentes` (vendas sem nota) e `automatico` (encerramento feito sozinho pelo sistema).'),
    f('authorizedBy', 'autorizado_por', 'string', 'Quem autorizou, quando precisou de senha.'),
    f('closedBy', 'por', 'string', 'Quem encerrou.'),
    f('closingDate', 'em', 'date-time', 'Quando foi encerrado.'),
  ],
  filters: [
    q('branchCodeList', 'intList', 'empresa', 'Empresas, separadas por vírgula.'),
    q('startCashierDate', 'startDay', 'data_caixa', 'Dia encerrado a partir de (AAAA-MM-DD).'),
    q('endCashierDate', 'endDay', 'data_caixa', 'Dia encerrado até (AAAA-MM-DD).'),
  ],
});

modulo.recurso({
  name: 'CashierDate',
  path: '/cashier-dates',
  table: 'hc_caixa_datas',
  summary: 'Data do caixa de cada empresa',
  description: 'Em que dia o caixa de cada empresa está AGORA. Toda transação entra com essa data (`cashierDate`); ela avança no encerramento do dia (/day-closings) e pode ser voltada por quem tem permissão. Empresa que não aparece aqui ainda não abriu caixa no HeadCoach.',
  key: [{ param: 'branchCode', col: 'empresa', type: 'integer', description: 'Código da empresa.' }],
  order: [['empresa', true]],
  fields: [
    f('branchCode', 'empresa', 'integer', 'Empresa.', { example: 95 }),
    f('cashierDate', 'data_caixa', 'date', 'Data do caixa em vigor.'),
    f('changedBy', 'atualizado_por', 'string', 'Quem mudou a data por último.'),
    f('lastChangeDate', 'atualizado_em', 'date-time', 'Quando a data mudou por último.'),
  ],
  filters: [q('branchCodeList', 'intList', 'empresa', 'Empresas, separadas por vírgula.')],
});

export default modulo;
