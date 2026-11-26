// API HEADCOACH › general — cadastros de base que os outros módulos referenciam.
import { criarModulo, f, q, rotaCalculada, paginarEmMemoria } from './_engine.js';
import { PAYMENT_METHOD_INFO } from './_maps.js';
import { simplesDe } from '../../services/pdvFiscal.js';
import { ehSoHeadcoach, lojasSoHeadcoach } from '../../utils/lojasHeadcoach.js';

const modulo = criarModulo({
  nome: 'general',
  titulo: 'General',
  descricao: 'Cadastros de base: empresas, operações e formas de pagamento. Os códigos daqui aparecem nos outros módulos (branchCode, operationCode, paymentMethod).',
});

modulo.recurso({
  name: 'Branch',
  path: '/branches',
  table: 'erp_empresas',
  summary: 'Empresas (lojas e matriz)',
  description: 'Todas as empresas do grupo, com CNPJ e a pessoa correspondente. `isOwn` separa as empresas próprias das franquias. `headcoachOnly` marca as lojas que já vendem só pelo PDV Crosby do HeadCoach (não lançam mais venda no TOTVS): as vendas delas estão em transaction/transactions e não em consultas do TOTVS.',
  key: [{ param: 'branchCode', col: 'code', type: 'integer', description: 'Código da empresa.' }],
  order: [['code', true]],
  fields: [
    f('branchCode', 'code', 'integer', 'Código da empresa (o mesmo do TOTVS).', { example: 95 }),
    f('description', 'descricao', 'string', 'Descrição da empresa.'),
    f('fantasyName', 'fantasia', 'string', 'Nome fantasia.'),
    f('cnpj', 'cnpj', 'string', 'CNPJ, só dígitos.'),
    f('personCode', 'person_code', 'integer', 'Código da pessoa (cadastro) da empresa. É por ele que uma venda da matriz para a loja é reconhecida.'),
    f('personName', 'person_name', 'string', 'Razão social.'),
    f('group', 'grupo', 'string', 'Grupo de empresas (CROSBY, FABIO, IRMAOS VAREJO, IRMAOS CROSBY…).'),
    f('stateRegistration', 'ie', 'string', 'Inscrição estadual.'),
    f('state', 'uf', 'string', 'UF.'),
    f('city', 'cidade', 'string', 'Cidade.'),
    f('cityIbgeCode', 'cidade_ibge', 'integer', 'Código IBGE da cidade.'),
    f('address', 'endereco', 'object', 'Endereço do cadastro, com as chaves do TOTVS: cep, publicPlace (tipo do logradouro), address, addressNumber, complement, neighborhood, cityName, stateAbbreviation, ibgeCityCode.'),
    f('taxRegime', (e) => (e.propria ? (simplesDe(e.cnpj) ? 'SimplesNacional' : 'Normal') : null), 'string', 'Regime tributário com que o HeadCoach emite as notas da empresa: `SimplesNacional` (CRT 1, sem ICMS destacado — lojas dos grupos IRMAOS) ou `Normal` (CRT 3). Nulo nas franquias (o HeadCoach não emite por elas).', { cols: ['propria', 'cnpj'], enum: ['SimplesNacional', 'Normal'] }),
    f('headcoachOnly', (e) => ehSoHeadcoach(e.code), 'boolean', 'A loja vende só pelo PDV Crosby do HeadCoach e não lança mais venda no TOTVS (venda, nota, contas a receber, caixa e crediário BlueCard ficam no HeadCoach).', { cols: ['code'] }),
    f('isActive', 'ativo', 'boolean', 'Empresa ativa.'),
    f('isOwn', 'propria', 'boolean', 'Empresa própria (não franquia).'),
    f('lastChangeDate', 'atualizado_em', 'date-time', 'Última alteração do cadastro.'),
  ],
  filters: [
    q('branchCodeList', 'intList', 'code', 'Códigos das empresas, separados por vírgula.'),
    q('isOwn', 'bool', 'propria', 'Só empresas próprias (true) ou só franquias (false).'),
    q('isActive', 'bool', 'ativo', 'Só ativas (true) ou só inativas (false).'),
    q('state', 'string', 'uf', 'UF (ex.: RN).'),
    q('cnpj', 'digits', 'cnpj', 'CNPJ exato, só dígitos.'),
    q('name', 'text', 'descricao', 'Trecho da descrição.'),
    q('headcoachOnly', 'custom', null, 'Só as lojas que vendem só pelo HeadCoach (true) ou só as demais (false).', {
      apply: (qy, valor, ruim) => {
        const v = String(valor).toLowerCase();
        if (!['true', 'false'].includes(v)) ruim('Use true ou false.');
        return v === 'true' ? qy.in('code', lojasSoHeadcoach()) : qy.not('code', 'in', `(${lojasSoHeadcoach().join(',')})`);
      },
    }),
  ],
});

modulo.recurso({
  name: 'Operation',
  path: '/operations',
  table: 'erp_operacoes',
  summary: 'Operações',
  description: 'Operações (natureza da transação). `operationType` diz se é entrada ou saída.',
  key: [{ param: 'operationCode', col: 'code', type: 'integer', description: 'Código da operação.' }],
  order: [['code', true]],
  fields: [
    f('operationCode', 'code', 'integer', 'Código da operação (o mesmo do TOTVS).', { example: 545 }),
    f('description', 'descricao', 'string', 'Descrição.'),
    f('operationType', 'tipo', 'string', 'Entrada ou saída.', { map: { S: 'Output', E: 'Input' } }),
    f('isFinancial', 'financeira', 'boolean', 'Gera financeiro.'),
    f('isInactive', 'inativa', 'boolean', 'Operação inativa.'),
    f('documentModel', 'modelo_documento', 'integer', 'Modelo do documento fiscal (55 NF-e, 65 NFC-e).'),
    f('movesStock', 'movimenta_estoque', 'boolean', 'Movimenta estoque.'),
  ],
  filters: [
    q('operationCodeList', 'intList', 'code', 'Códigos das operações, separados por vírgula.'),
    q('operationType', 'enum', 'tipo', 'Entrada ou saída.', { map: { Output: 'S', Input: 'E' } }),
    q('isInactive', 'bool', 'inativa', 'Só inativas (true) ou só ativas (false).'),
    q('description', 'text', 'descricao', 'Trecho da descrição.'),
  ],
});

modulo.calculado({
  path: '/payment-methods',
  summary: 'Formas de pagamento',
  description: 'Lista fixa das formas de pagamento do HeadCoach: o código que aparece em `paymentMethod`, como vai na nota (tPag) e o que acontece no contas a receber.',
  schemaName: 'PaymentMethod',
  schema: {
    type: 'object',
    description: 'Forma de pagamento.',
    properties: {
      code: { type: 'string', description: 'Código usado em `paymentMethod` nos outros módulos.', enum: PAYMENT_METHOD_INFO.map((p) => p.code) },
      name: { type: 'string', description: 'Nome em português, como aparece nas telas.' },
      nfePaymentType: { type: 'string', description: 'Código da forma na nota fiscal (tPag).' },
      documentTypeCode: { type: 'integer', nullable: true, description: 'Tipo de documento do título no contas a receber (mesmos códigos do TOTVS).' },
      receivable: { type: 'string', description: 'Como o título nasce: Paid (pago), PaidToReconcile (pago, a conciliar), Open (em aberto) ou None (não gera título).', enum: ['Paid', 'PaidToReconcile', 'Open', 'None'] },
      description: { type: 'string' },
    },
  },
  handler: rotaCalculada(async (req) => paginarEmMemoria(req, PAYMENT_METHOD_INFO)),
});

export default modulo;
