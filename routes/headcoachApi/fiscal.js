// API HEADCOACH › fiscal — notas fiscais (NF-e / NFC-e) emitidas pelo HeadCoach.
import { criarModulo, f, q, supabase, ApiError } from './_engine.js';
import { INVOICE_STATUS, ENVIRONMENT, INVOICE_TYPE, SALE_TYPE, inverso } from './_maps.js';

const modulo = criarModulo({
  nome: 'fiscal',
  titulo: 'Fiscal',
  descricao: 'Notas fiscais emitidas pelo HeadCoach direto na SEFAZ (NF-e modelo 55 e NFC-e modelo 65): situação, chave, protocolo, cancelamento e o XML.',
});

const venda = (l) => l.pdv_vendas || {};

/** Nota fiscal — também usada como `expand=invoices` das transações. */
export const INVOICE = {
  name: 'Invoice',
  path: '/invoices',
  table: 'pdv_notas_fiscais',
  summary: 'Notas fiscais',
  description: 'Uma linha por nota emitida (autorizada, rejeitada, cancelada ou com erro). Uma transação pode ter mais de uma tentativa de nota; só uma fica autorizada. O XML fica em /xml-contents/{accessKey}.',
  key: [{ param: 'invoiceId', col: 'id', type: 'integer', description: 'Identificador interno da nota no HeadCoach.' }],
  order: [['id', false]],
  selectExtra: 'pdv_vendas(cliente_code, cliente_nome, cliente_cpf_cnpj, vendedor_code, total, operacao, tipo_venda)',
  fields: [
    f('invoiceId', 'id', 'integer', 'Identificador interno da nota.'),
    f('transactionCode', 'venda_id', 'integer', 'Transação do HeadCoach que gerou a nota (transaction/transactions).'),
    f('branchCode', 'empresa', 'integer', 'Empresa emitente.', { example: 95 }),
    f('issuerCnpj', 'cnpj_emitente', 'string', 'CNPJ do emitente.'),
    f('invoiceType', 'modelo', 'string', 'NF-e ou NFC-e.', { map: INVOICE_TYPE }),
    f('documentModel', 'modelo', 'integer', 'Modelo do documento: 55 (NF-e) ou 65 (NFC-e).'),
    f('serialCode', 'serie', 'integer', 'Série.'),
    f('invoiceCode', 'numero', 'integer', 'Número da nota.'),
    f('accessKey', 'chave', 'string', 'Chave de acesso (44 dígitos).'),
    f('environment', 'ambiente', 'string', 'Ambiente da SEFAZ.', { map: ENVIRONMENT }),
    f('invoiceStatus', 'status', 'string', 'Situação da nota.', { map: INVOICE_STATUS }),
    f('sefazStatusCode', 'cstat', 'string', 'Código de retorno da SEFAZ (100 = autorizada, 135 = evento registrado…).'),
    f('sefazMessage', 'xmotivo', 'string', 'Mensagem de retorno da SEFAZ.'),
    f('protocol', 'protocolo', 'string', 'Protocolo de autorização.'),
    f('issueDate', 'dh_emissao', 'date-time', 'Data e hora de emissão.'),
    f('authorizationDate', 'dh_autorizacao', 'date-time', 'Data e hora da autorização.'),
    f('cancelDate', 'cancel_em', 'date-time', 'Data e hora do cancelamento.'),
    f('cancelProtocol', 'cancel_protocolo', 'string', 'Protocolo do evento de cancelamento.'),
    f('cancelReason', 'cancel_justificativa', 'string', 'Justificativa do cancelamento enviada à SEFAZ.'),
    f('consultUrl', 'url_chave', 'string', 'Endereço de consulta da NFC-e pela chave.'),
    f('qrCodeUrl', 'qr_code', 'string', 'Conteúdo do QR Code da NFC-e (o endereço de consulta que vai impresso no cupom). Nulo na NF-e.'),
    f('errorMessage', 'erro', 'string', 'Erro ao emitir, quando houve.'),
    f('customerCode', (l) => venda(l).cliente_code ?? null, 'integer', 'Código do cliente da transação.'),
    f('customerName', (l) => venda(l).cliente_nome ?? null, 'string', 'Nome do cliente.'),
    f('customerCpfCnpj', (l) => venda(l).cliente_cpf_cnpj ?? null, 'string', 'CPF ou CNPJ do cliente, só dígitos.'),
    f('sellerCode', (l) => venda(l).vendedor_code ?? null, 'integer', 'Código do vendedor.'),
    f('operationCode', (l) => venda(l).operacao ?? null, 'integer', 'Operação da transação.'),
    f('saleType', (l) => SALE_TYPE[venda(l).tipo_venda] ?? venda(l).tipo_venda ?? null, 'string', 'Tipo da transação.', { enum: Object.values(SALE_TYPE) }),
    f('totalValue', (l) => venda(l).total ?? null, 'number', 'Valor total da transação.'),
    f('lastChangeDate', 'atualizado_em', 'date-time', 'Última alteração do registro.'),
  ],
  filters: [
    q('branchCodeList', 'intList', 'empresa', 'Empresas emitentes, separadas por vírgula.'),
    q('startIssueDate', 'startDate', 'dh_emissao', 'Emitidas a partir de (AAAA-MM-DD).'),
    q('endIssueDate', 'endDate', 'dh_emissao', 'Emitidas até (AAAA-MM-DD).'),
    q('invoiceStatus', 'enum', 'status', 'Situação da nota (aceita lista).', { map: inverso(INVOICE_STATUS) }),
    q('invoiceType', 'enum', 'modelo', 'NF-e ou NFC-e.', { map: { NFe: 55, NFCe: 65 } }),
    q('serialCode', 'int', 'serie', 'Série.'),
    q('invoiceCode', 'int', 'numero', 'Número da nota.'),
    q('accessKey', 'digits', 'chave', 'Chave de acesso exata.'),
    q('transactionCode', 'int', 'venda_id', 'Notas de uma transação.'),
    q('startChangeDate', 'startDate', 'atualizado_em', 'Alteradas a partir de (AAAA-MM-DD) — para sincronização.'),
  ],
};
modulo.recurso(INVOICE);

modulo.calculado({
  path: '/xml-contents/{accessKey}',
  express: '/xml-contents/:accessKey',
  paginado: false,
  notFound: true,
  summary: 'XML da nota fiscal',
  description: 'XML da nota pela chave de acesso. Por padrão vem em JSON com o XML em base64 (`mainInvoiceXml`, como no TOTVS); com `format=xml` vem o XML puro. Para nota autorizada é o XML com o protocolo; para as demais, o XML assinado.',
  parameters: [
    { name: 'accessKey', in: 'path', required: true, description: 'Chave de acesso (44 dígitos).', schema: { type: 'string' } },
    { name: 'format', in: 'query', required: false, description: 'Use `xml` para receber o XML puro (application/xml).', schema: { type: 'string', enum: ['json', 'xml'] } },
  ],
  schemaName: 'InvoiceXml',
  schema: {
    type: 'object',
    description: 'XML da nota.',
    properties: {
      accessKey: { type: 'string' },
      invoiceStatus: { type: 'string', enum: [...new Set(Object.values(INVOICE_STATUS))] },
      branchCode: { type: 'integer' },
      invoiceCode: { type: 'integer' },
      serialCode: { type: 'integer' },
      hasProtocol: { type: 'boolean', description: 'true quando o XML já traz o protocolo de autorização.' },
      mainInvoiceXml: { type: 'string', description: 'XML em base64.' },
    },
  },
  handler: async (req, res) => {
    try {
      const chave = String(req.params.accessKey || '').replace(/\D/g, '');
      if (chave.length !== 44) throw new ApiError(400, 'InvalidParameter', 'Chave de acesso inválida', 'Esperados 44 dígitos.');
      const { data, error } = await supabase.from('pdv_notas_fiscais').select('chave, status, empresa, numero, serie, xml_proc, xml_assinado').eq('chave', chave).order('id', { ascending: false }).limit(1);
      if (error) throw new ApiError(500, 'DatabaseError', 'Erro ao consultar o banco', error.message);
      const n = data?.[0];
      const xml = n?.xml_proc || n?.xml_assinado || null;
      if (!n || !xml) throw new ApiError(404, 'NotFound', 'Nota não encontrada para esta chave');
      if (String(req.query.format || '').toLowerCase() === 'xml') return res.type('application/xml').send(xml);
      return res.json({
        accessKey: n.chave,
        invoiceStatus: INVOICE_STATUS[n.status] ?? n.status,
        branchCode: n.empresa,
        invoiceCode: n.numero,
        serialCode: n.serie,
        hasProtocol: Boolean(n.xml_proc),
        mainInvoiceXml: Buffer.from(xml, 'utf8').toString('base64'),
      });
    } catch (e) {
      if (e instanceof ApiError) return res.status(e.status).json({ code: e.code, message: e.message, detailedMessage: e.detailedMessage });
      return res.status(500).json({ code: 'InternalError', message: 'Erro interno ao consultar', detailedMessage: e.message });
    }
  },
});

modulo.recurso({
  name: 'InvoiceSeries',
  path: '/series',
  table: 'pdv_fiscal_config',
  summary: 'Séries e numeração por empresa',
  description: 'Empresas habilitadas a emitir nota pelo HeadCoach, com a série e o próximo número de NFC-e e de NF-e. Não traz certificado nem CSC.',
  order: [['empresa', true]],
  fields: [
    f('branchCode', 'empresa', 'integer', 'Empresa.'),
    f('cnpj', 'cnpj', 'string', 'CNPJ da empresa.'),
    f('isActive', 'ativo', 'boolean', 'Emissão ligada para a empresa.'),
    f('environment', 'ambiente', 'string', 'Ambiente em uso.', { map: ENVIRONMENT }),
    f('nfceSerialCode', 'serie_nfce', 'integer', 'Série da NFC-e.'),
    f('nextNfceCode', 'prox_num_nfce', 'integer', 'Próximo número de NFC-e.'),
    f('nfeSerialCode', 'serie_nfe', 'integer', 'Série da NF-e.'),
    f('nextNfeCode', 'prox_num_nfe', 'integer', 'Próximo número de NF-e.'),
    f('nfceOperationCode', 'operacao_nfce', 'integer', 'Operação própria da loja para a venda em NFC-e. Nulo = a padrão do PDV (510; 545 nas lojas 95 e 98).'),
    f('nfeOperationCode', 'operacao_nfe', 'integer', 'Operação própria da loja para a venda em NF-e. Nulo = a padrão do PDV.'),
    f('exchangeOperationCode', 'operacao_troca', 'integer', 'Operação própria da loja para a troca (NF-e de devolução). Nulo = a padrão do PDV.'),
    f('lastChangeDate', 'atualizado_em', 'date-time', 'Última alteração.'),
  ],
  filters: [q('branchCodeList', 'intList', 'empresa', 'Empresas, separadas por vírgula.'), q('isActive', 'bool', 'ativo', 'Só as com emissão ligada (true) ou desligada (false).')],
});

export default modulo;
