// API HEADCOACH › customer-balance — saldos dos clientes (Credev, adiantamento, cashback).
import { criarModulo, f, q } from './_engine.js';
import { BALANCE_TYPE, BALANCE_MOVEMENT, BONUS_TYPE, inverso } from './_maps.js';

const modulo = criarModulo({
  nome: 'customer-balance',
  titulo: 'CustomerBalance',
  descricao:
    'Saldos dos clientes no HeadCoach, por empresa: Credev (crédito de devolução e troca), adiantamento e cashback, com o extrato de cada movimento. O saldo vale só na empresa em que foi gerado. O cashback gerado no HeadCoach (cashback-grants e cashback-movements) é à parte: vale em qualquer empresa, tem carência e validade.',
});

// cashback do HeadCoach (hc_cashback_lotes / hc_cashback_mov)
const CASHBACK_ORIGIN = { venda: 'Sale', ajuste: 'Adjustment' };
const CASHBACK_MOVEMENT = { geracao: 'Grant', uso: 'Use', estorno_uso: 'UseReversal', cancelamento: 'Cancellation', reativacao: 'Reactivation' };
const hojeRecife = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Recife' }).format(new Date());
const saldoLote = (l) => Math.round((Number(l.valor || 0) - Number(l.usado || 0)) * 100) / 100;
const situacaoLote = (l) => {
  const hoje = hojeRecife();
  if (l.cancelado_em) return 'Canceled';
  if (saldoLote(l) <= 0) return 'Used';
  if (String(l.expira_em) < hoje) return 'Expired';
  if (String(l.libera_em) > hoje) return 'GracePeriod';
  return 'Available';
};

const MOVEMENT = {
  name: 'BalanceMovement',
  path: '/movements',
  table: 'hc_cliente_saldos_mov',
  summary: 'Extrato dos saldos',
  description: 'Cada entrada e saída do saldo: carga inicial vinda do TOTVS, crédito de devolução ou troca, uso como pagamento, estorno por cancelamento, ajuste manual e acerto diário do cashback. `value` positivo entra, negativo sai.',
  order: [['id', false]],
  fields: [
    f('movementId', 'id', 'integer', 'Identificador do movimento.'),
    f('branchCode', 'empresa', 'integer', 'Empresa do saldo.'),
    f('customerCode', 'cliente_code', 'integer', 'Código do cliente.'),
    f('balanceType', 'tipo', 'string', 'Tipo de saldo.', { map: BALANCE_TYPE }),
    f('movementType', 'movimento', 'string', 'Tipo do movimento.', { map: BALANCE_MOVEMENT }),
    f('value', 'valor', 'number', 'Valor do movimento (positivo entra, negativo sai).'),
    f('balanceAfterValue', 'saldo_depois', 'number', 'Saldo depois do movimento.'),
    f('transactionCode', 'venda_id', 'integer', 'Transação ligada (venda que usou, ou troca que gerou).'),
    f('returnId', 'devolucao_trx_id', 'integer', 'Devolução que gerou o crédito (return/returns).'),
    f('reference', 'referencia', 'string', 'Referência curta (ex.: troca 242).'),
    f('observation', 'observacao', 'string', 'Descrição do movimento.'),
    f('createdBy', 'por', 'string', 'Quem fez.'),
    f('movementDate', 'em', 'date-time', 'Quando aconteceu.'),
  ],
  filters: [
    q('branchCodeList', 'intList', 'empresa', 'Empresas, separadas por vírgula.'),
    q('customerCode', 'int', 'cliente_code', 'Código do cliente.'),
    q('balanceType', 'enum', 'tipo', 'Tipo de saldo (aceita lista).', { map: inverso(BALANCE_TYPE) }),
    q('movementType', 'enum', 'movimento', 'Tipo do movimento (aceita lista).', { map: inverso(BALANCE_MOVEMENT) }),
    q('transactionCode', 'int', 'venda_id', 'Movimentos de uma transação.'),
    q('startDate', 'startDate', 'em', 'A partir de (AAAA-MM-DD).'),
    q('endDate', 'endDate', 'em', 'Até (AAAA-MM-DD).'),
  ],
};

modulo.recurso({
  name: 'CustomerBalance',
  path: '/balances',
  table: 'hc_cliente_saldos',
  summary: 'Saldos por cliente',
  description: 'Uma linha por cliente + empresa + tipo de saldo. Por padrão vêm também os saldos zerados; use `onlyPositive=true` para trazer só quem tem saldo.',
  order: [['empresa', true], ['cliente_code', true], ['tipo', true]],
  fields: [
    f('branchCode', 'empresa', 'integer', 'Empresa em que o saldo vale.', { example: 95 }),
    f('customerCode', 'cliente_code', 'integer', 'Código do cliente (o mesmo do TOTVS).'),
    f('customerName', 'cliente_nome', 'string', 'Nome do cliente.'),
    f('customerCpfCnpj', 'cliente_cpf_cnpj', 'string', 'CPF ou CNPJ, só dígitos.'),
    f('balanceType', 'tipo', 'string', 'Tipo de saldo.', { map: BALANCE_TYPE }),
    f('initialValue', 'valor_inicial', 'number', 'Valor da carga inicial (vinda do TOTVS).'),
    f('balanceValue', 'saldo', 'number', 'Saldo atual.'),
    f('createdDate', 'criado_em', 'date-time', 'Quando o saldo foi criado.'),
    f('lastChangeDate', 'atualizado_em', 'date-time', 'Última alteração.'),
  ],
  filters: [
    q('branchCodeList', 'intList', 'empresa', 'Empresas, separadas por vírgula.'),
    q('customerCode', 'int', 'cliente_code', 'Código do cliente.'),
    q('customerCpfCnpj', 'digits', 'cliente_cpf_cnpj', 'CPF ou CNPJ do cliente.'),
    q('balanceType', 'enum', 'tipo', 'Tipo de saldo (aceita lista).', { map: inverso(BALANCE_TYPE) }),
    q('onlyPositive', 'custom', null, 'true = só saldos maiores que zero.', {
      apply: (qy, v, ruim) => {
        if (!/^(true|false|1|0)$/i.test(v)) ruim('Esperado true ou false.');
        return /^(true|1)$/i.test(v) ? qy.gt('saldo', 0) : qy;
      },
    }),
    q('startChangeDate', 'startDate', 'atualizado_em', 'Alterados a partir de (AAAA-MM-DD) — para sincronização.'),
  ],
});

modulo.recurso(MOVEMENT);

modulo.recurso({
  name: 'BillingBonus',
  path: '/billing-bonus',
  table: 'faturamento_saldo_bonus',
  summary: 'Saldo bônus do faturamento',
  description: 'Crédito gerado no faturamento quando faltou peça do pedido (o cliente pagou e a peça não foi): fica como saldo bônus para a próxima compra. Cada linha é um crédito ou um uso.',
  order: [['id', false]],
  fields: [
    f('bonusId', 'id', 'integer', 'Identificador do lançamento.'),
    f('customerCode', 'cliente_code', 'integer', 'Código do cliente.'),
    f('customerName', 'cliente_nome', 'string', 'Nome do cliente.'),
    f('customerCpfCnpj', 'cliente_cpf_cnpj', 'string', 'CPF ou CNPJ, só dígitos.'),
    f('entryType', 'tipo', 'string', 'Crédito ou uso.', { map: BONUS_TYPE }),
    f('value', 'valor', 'number', 'Valor.'),
    f('creditId', 'credito_id', 'integer', 'No uso: o crédito consumido.'),
    f('transactionCode', 'venda_id', 'integer', 'Transação ligada.'),
    f('orderNumber', 'numero_site', 'string', 'Número do pedido.'),
    f('reason', 'motivo', 'string', 'Motivo.'),
    f('createdBy', 'criado_por', 'string', 'Quem lançou.'),
    f('createdDate', 'criado_em', 'date-time', 'Quando foi lançado.'),
  ],
  filters: [
    q('customerCode', 'int', 'cliente_code', 'Código do cliente.'),
    q('entryType', 'enum', 'tipo', 'Crédito ou uso.', { map: inverso(BONUS_TYPE) }),
    q('transactionCode', 'int', 'venda_id', 'Lançamentos de uma transação.'),
    q('startDate', 'startDate', 'criado_em', 'A partir de (AAAA-MM-DD).'),
    q('endDate', 'endDate', 'criado_em', 'Até (AAAA-MM-DD).'),
  ],
});

modulo.recurso({
  name: 'CashbackGrant',
  path: '/cashback-grants',
  table: 'hc_cashback_lotes',
  summary: 'Cashback gerado (HeadCoach)',
  description:
    'Uma linha por cashback gerado: toda venda do PDV Crosby com cliente identificado gera 20% do valor. Só pode ser usado a partir de `releaseDate` (3 dias depois da venda) e até `expirationDate` (dia 93), em qualquer empresa. Depois de vencido deixa de contar no saldo, mas a linha continua aqui e pode ser reativada (`reactivationDate`). Saldo do cliente = soma de `balanceValue` das linhas com `status=Available`.',
  order: [['id', false]],
  fields: [
    f('grantId', 'id', 'integer', 'Identificador do cashback gerado.'),
    f('customerCode', 'cliente_code', 'integer', 'Código do cliente (o mesmo do TOTVS).'),
    f('customerName', 'cliente_nome', 'string', 'Nome do cliente.'),
    f('customerCpfCnpj', 'cliente_cpf_cnpj', 'string', 'CPF ou CNPJ, só dígitos.'),
    f('branchCode', 'empresa', 'integer', 'Empresa da venda que gerou (o cashback vale em qualquer empresa).'),
    f('origin', 'origem', 'string', 'De onde veio.', { map: CASHBACK_ORIGIN }),
    f('transactionCode', 'venda_id', 'integer', 'Venda que gerou (transaction/transactions).'),
    f('baseValue', 'base', 'number', 'Valor da venda sobre o qual o cashback foi calculado.'),
    f('percentage', 'pct', 'number', 'Percentual aplicado.'),
    f('value', 'valor', 'number', 'Valor gerado.'),
    f('usedValue', 'usado', 'number', 'Quanto já foi usado.'),
    f('balanceValue', 'saldo', 'number', 'Quanto resta (value menos usedValue).'),
    f('status', situacaoLote, 'string', 'Situação hoje: em carência, disponível, vencido, usado por inteiro ou cancelado.', { cols: ['valor', 'usado', 'libera_em', 'expira_em', 'cancelado_em'], enum: ['GracePeriod', 'Available', 'Expired', 'Used', 'Canceled'] }),
    f('grantDate', 'gerado_em', 'date-time', 'Quando foi gerado.'),
    f('releaseDate', 'libera_em', 'date', 'Primeiro dia em que pode ser usado.'),
    f('expirationDate', 'expira_em', 'date', 'Último dia em que pode ser usado.'),
    f('cancellationDate', 'cancelado_em', 'date-time', 'Quando foi cancelado (venda cancelada).'),
    f('cancellationReason', 'cancelado_motivo', 'string', 'Motivo do cancelamento.'),
    f('reactivationDate', 'reativado_em', 'date-time', 'Última reativação depois de vencido.'),
    f('reactivatedBy', 'reativado_por', 'string', 'Quem reativou.'),
    f('observation', 'observacao', 'string', 'Descrição.'),
    f('createdBy', 'por', 'string', 'Quem registrou a venda.'),
  ],
  filters: [
    q('customerCode', 'int', 'cliente_code', 'Código do cliente.'),
    q('customerCpfCnpj', 'digits', 'cliente_cpf_cnpj', 'CPF ou CNPJ do cliente.'),
    q('branchCodeList', 'intList', 'empresa', 'Empresas da venda que gerou, separadas por vírgula.'),
    q('transactionCode', 'int', 'venda_id', 'Cashback gerado por uma venda.'),
    q('status', 'custom', null, 'Situação hoje: GracePeriod, Available, Expired, Used ou Canceled.', {
      apply: (qy, v, ruim) => {
        const hoje = hojeRecife();
        switch (String(v)) {
          case 'Canceled':
            return qy.not('cancelado_em', 'is', null);
          case 'GracePeriod':
            return qy.is('cancelado_em', null).gt('saldo', 0).gt('libera_em', hoje).gte('expira_em', hoje);
          case 'Available':
            return qy.is('cancelado_em', null).gt('saldo', 0).lte('libera_em', hoje).gte('expira_em', hoje);
          case 'Expired':
            return qy.is('cancelado_em', null).gt('saldo', 0).lt('expira_em', hoje);
          case 'Used':
            return qy.is('cancelado_em', null).lte('saldo', 0);
          default:
            return ruim('Esperado GracePeriod, Available, Expired, Used ou Canceled.');
        }
      },
    }),
    q('startDate', 'startDate', 'gerado_em', 'Gerados a partir de (AAAA-MM-DD).'),
    q('endDate', 'endDate', 'gerado_em', 'Gerados até (AAAA-MM-DD).'),
    q('startExpirationDate', 'startDay', 'expira_em', 'Vencem a partir de (AAAA-MM-DD).'),
    q('endExpirationDate', 'endDay', 'expira_em', 'Vencem até (AAAA-MM-DD).'),
  ],
});

modulo.recurso({
  name: 'CashbackMovement',
  path: '/cashback-movements',
  table: 'hc_cashback_mov',
  summary: 'Extrato do cashback (HeadCoach)',
  description:
    'Histórico de geração e uso do cashback do HeadCoach: geração na venda, uso em outra venda, volta do uso quando a venda é cancelada, cancelamento do cashback gerado por venda cancelada e reativação do vencido. `value` positivo entra, negativo sai; `grantId` aponta o cashback gerado (cashback-grants) de onde saiu ou para onde voltou.',
  order: [['id', false]],
  fields: [
    f('movementId', 'id', 'integer', 'Identificador do movimento.'),
    f('grantId', 'lote_id', 'integer', 'Cashback gerado a que o movimento pertence (cashback-grants).'),
    f('customerCode', 'cliente_code', 'integer', 'Código do cliente.'),
    f('branchCode', 'empresa', 'integer', 'Empresa em que aconteceu (no uso: a loja da venda que usou).'),
    f('movementType', 'movimento', 'string', 'Tipo do movimento.', { map: CASHBACK_MOVEMENT }),
    f('value', 'valor', 'number', 'Valor (positivo entra, negativo sai).'),
    f('transactionCode', 'venda_id', 'integer', 'Venda ligada: a que gerou ou a que usou.'),
    f('observation', 'observacao', 'string', 'Descrição do movimento.'),
    f('createdBy', 'por', 'string', 'Quem fez.'),
    f('movementDate', 'em', 'date-time', 'Quando aconteceu.'),
  ],
  filters: [
    q('customerCode', 'int', 'cliente_code', 'Código do cliente.'),
    q('grantId', 'int', 'lote_id', 'Movimentos de um cashback gerado.'),
    q('branchCodeList', 'intList', 'empresa', 'Empresas, separadas por vírgula.'),
    q('movementType', 'enum', 'movimento', 'Tipo do movimento (aceita lista).', { map: inverso(CASHBACK_MOVEMENT) }),
    q('transactionCode', 'int', 'venda_id', 'Movimentos de uma venda.'),
    q('startDate', 'startDate', 'em', 'A partir de (AAAA-MM-DD).'),
    q('endDate', 'endDate', 'em', 'Até (AAAA-MM-DD).'),
  ],
});

export default modulo;
