// API HEADCOACH › customer-balance — saldos dos clientes (Credev, adiantamento, cashback).
import { criarModulo, f, q } from './_engine.js';
import { BALANCE_TYPE, BALANCE_MOVEMENT, BONUS_TYPE, inverso } from './_maps.js';

const modulo = criarModulo({
  nome: 'customer-balance',
  titulo: 'CustomerBalance',
  descricao: 'Saldos dos clientes no HeadCoach, por empresa: Credev (crédito de devolução e troca), adiantamento e cashback, com o extrato de cada movimento. O saldo vale só na empresa em que foi gerado.',
});

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

export default modulo;
