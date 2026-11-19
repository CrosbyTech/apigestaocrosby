// API HEADCOACH › stock — estoque das lojas, etiquetas RFID e balanços.
import { criarModulo, f, q, rotaCalculada, paginarEmMemoria, lerTudo, listaDeInteiros, supabase, ApiError } from './_engine.js';
import { STOCK_MOVEMENT, RFID_MOVEMENT, inverso } from './_maps.js';

const modulo = criarModulo({
  nome: 'stock',
  titulo: 'Stock',
  descricao:
    'Estoque das lojas no HeadCoach. Hoje o estoque é formado só pelas entradas conferidas no Recebimento de Mercadoria (as vendas ainda não baixam este saldo). Inclui as etiquetas RFID que entraram, o movimento das etiquetas nas vendas e os balanços feitos com o coletor.',
});

modulo.calculado({
  path: '/balances',
  summary: 'Saldo por loja e produto',
  description: 'Soma dos movimentos de estoque por empresa e produto. Atenção: por enquanto só as entradas do Recebimento de Mercadoria movimentam este saldo; ele não é o estoque completo da loja.',
  parameters: [
    { name: 'branchCodeList', in: 'query', required: false, description: 'Empresas, separadas por vírgula.', schema: { type: 'string', example: '95,98' } },
    { name: 'productCodeList', in: 'query', required: false, description: 'Produtos, separados por vírgula.', schema: { type: 'string' } },
  ],
  schemaName: 'StockBalance',
  schema: {
    type: 'object',
    description: 'Saldo de um produto numa empresa.',
    properties: {
      branchCode: { type: 'integer' },
      productCode: { type: 'integer' },
      productName: { type: 'string', nullable: true },
      quantity: { type: 'number', description: 'Saldo (soma dos movimentos).' },
      rfidTagQuantity: { type: 'integer', description: 'Etiquetas RFID deste produto que entraram na loja.' },
      lastMovementDate: { type: 'string', format: 'date-time', nullable: true },
    },
  },
  handler: rotaCalculada(async (req) => {
    const empresas = listaDeInteiros(req, 'branchCodeList');
    const produtos = listaDeInteiros(req, 'productCodeList');
    const filtra = (tabela, cols, ordem) => () => {
      let qy = supabase.from(tabela).select(cols).order(ordem, { ascending: true });
      if (empresas) qy = qy.in('empresa', empresas);
      if (produtos) qy = qy.in('product_code', produtos);
      return qy;
    };
    const [movs, epcs] = await Promise.all([lerTudo(filtra('hc_estoque_movimentos', 'id, empresa, product_code, nome, quantidade, em', 'id')), lerTudo(filtra('hc_estoque_epcs', 'epc, empresa, product_code', 'epc'))]);
    const mapa = new Map();
    for (const m of movs) {
      const k = `${m.empresa}|${m.product_code}`;
      const a = mapa.get(k) || { branchCode: m.empresa, productCode: m.product_code, productName: m.nome || null, quantity: 0, rfidTagQuantity: 0, lastMovementDate: null };
      a.quantity = Math.round((a.quantity + Number(m.quantidade || 0)) * 1000) / 1000;
      if (!a.lastMovementDate || m.em > a.lastMovementDate) a.lastMovementDate = m.em;
      if (m.nome) a.productName = m.nome;
      mapa.set(k, a);
    }
    for (const e of epcs) {
      const a = mapa.get(`${e.empresa}|${e.product_code}`);
      if (a) a.rfidTagQuantity += 1;
    }
    const itens = [...mapa.values()].sort((x, y) => x.branchCode - y.branchCode || x.productCode - y.productCode);
    return paginarEmMemoria(req, itens, ['branchCodeList', 'productCodeList']);
  }),
});

modulo.recurso({
  name: 'StockMovement',
  path: '/movements',
  table: 'hc_estoque_movimentos',
  summary: 'Movimentos de estoque',
  description: 'Cada movimento no estoque da loja: `TransferReceipt` é a entrada pelo Recebimento de Mercadoria; `ReceiptReversal` é o estorno, com quantidade negativa, quando esse recebimento é cancelado (goods-receipt/receipts com `canceledDate`).',
  order: [['id', false]],
  fields: [
    f('movementId', 'id', 'integer', 'Identificador do movimento.'),
    f('branchCode', 'empresa', 'integer', 'Empresa.'),
    f('productCode', 'product_code', 'integer', 'Produto.'),
    f('productName', 'nome', 'string', 'Nome do produto.'),
    f('quantity', 'quantidade', 'number', 'Quantidade (positivo entra).'),
    f('rfidTag', 'epc', 'string', 'Etiqueta RFID, quando a peça foi lida.'),
    f('movementType', 'tipo', 'string', 'Tipo do movimento.', { map: STOCK_MOVEMENT }),
    f('receiptId', 'recebimento_id', 'integer', 'Recebimento que gerou (goods-receipt/receipts).'),
    f('createdBy', 'por', 'string', 'Quem fez.'),
    f('movementDate', 'em', 'date-time', 'Quando aconteceu.'),
  ],
  filters: [
    q('branchCodeList', 'intList', 'empresa', 'Empresas, separadas por vírgula.'),
    q('productCode', 'int', 'product_code', 'Produto.'),
    q('receiptId', 'int', 'recebimento_id', 'Movimentos de um recebimento.'),
    q('movementType', 'enum', 'tipo', 'Tipo do movimento.', { map: inverso(STOCK_MOVEMENT) }),
    q('startDate', 'startDate', 'em', 'A partir de (AAAA-MM-DD).'),
    q('endDate', 'endDate', 'em', 'Até (AAAA-MM-DD).'),
  ],
});

modulo.recurso({
  name: 'StockRfidTag',
  path: '/rfid-tags',
  table: 'hc_estoque_epcs',
  summary: 'Etiquetas RFID no estoque das lojas',
  description: 'Etiquetas (EPC) que entraram no estoque de uma loja pelo Recebimento de Mercadoria, com o produto de cada uma.',
  order: [['entrou_em', false]],
  fields: [
    f('rfidTag', 'epc', 'string', 'Etiqueta RFID (EPC).'),
    f('branchCode', 'empresa', 'integer', 'Empresa em que a etiqueta está.'),
    f('productCode', 'product_code', 'integer', 'Produto.'),
    f('productName', 'nome', 'string', 'Nome do produto.'),
    f('receiptId', 'recebimento_id', 'integer', 'Recebimento em que entrou.'),
    f('entryDate', 'entrou_em', 'date-time', 'Quando entrou.'),
  ],
  filters: [
    q('branchCodeList', 'intList', 'empresa', 'Empresas, separadas por vírgula.'),
    q('productCode', 'int', 'product_code', 'Produto.'),
    q('rfidTag', 'string', 'epc', 'Etiqueta exata.'),
    q('receiptId', 'int', 'recebimento_id', 'Etiquetas de um recebimento.'),
  ],
});

modulo.recurso({
  name: 'RfidMovement',
  path: '/rfid-movements',
  table: 'pdv_epc_movimentos',
  summary: 'Movimento das etiquetas RFID nas transações',
  description: 'Histórico de cada etiqueta nas transações: saiu numa venda, voltou numa devolução ou troca, ou foi estornada por cancelamento. Serve para rastrear uma peça pela etiqueta.',
  order: [['id', false]],
  fields: [
    f('movementId', 'id', 'integer', 'Identificador do movimento.'),
    f('rfidTag', 'epc', 'string', 'Etiqueta RFID (EPC).'),
    f('movementType', 'tipo', 'string', 'Tipo do movimento.', { map: RFID_MOVEMENT }),
    f('branchCode', 'empresa', 'integer', 'Empresa.'),
    f('transactionCode', 'venda_id', 'integer', 'Transação.'),
    f('productCode', 'product_code', 'integer', 'Produto.'),
    f('productSku', 'sku', 'string', 'Código de barras.'),
    f('productName', 'produto_nome', 'string', 'Nome do produto.'),
    f('referenceName', 'referencia', 'string', 'Referência.'),
    f('unitValue', 'valor_unit', 'number', 'Valor unitário na transação.'),
    f('customerCode', 'cliente_code', 'integer', 'Cliente.'),
    f('customerName', 'cliente_nome', 'string', 'Nome do cliente.'),
    f('sellerCode', 'vendedor_code', 'integer', 'Vendedor.'),
    f('sellerName', 'vendedor_nome', 'string', 'Nome do vendedor.'),
    f('invoiceId', 'nota_id', 'integer', 'Nota no HeadCoach.'),
    f('invoiceAccessKey', 'chave_nf', 'string', 'Chave da nota.'),
    f('movementDate', 'ocorrido_em', 'date-time', 'Quando aconteceu.'),
  ],
  filters: [
    q('rfidTag', 'string', 'epc', 'Etiqueta exata.'),
    q('branchCodeList', 'intList', 'empresa', 'Empresas, separadas por vírgula.'),
    q('movementType', 'enum', 'tipo', 'Tipo do movimento (aceita lista).', { map: inverso(RFID_MOVEMENT) }),
    q('productCode', 'int', 'product_code', 'Produto.'),
    q('transactionCode', 'int', 'venda_id', 'Etiquetas de uma transação.'),
    q('customerCode', 'int', 'cliente_code', 'Cliente.'),
    q('startDate', 'startDate', 'ocorrido_em', 'A partir de (AAAA-MM-DD).'),
    q('endDate', 'endDate', 'ocorrido_em', 'Até (AAAA-MM-DD).'),
  ],
});

modulo.recurso({
  name: 'RfidInventory',
  path: '/inventories',
  table: 'balanco_rfid_arquivos',
  summary: 'Balanços RFID',
  description: 'Contagens feitas com o coletor RFID (app Android). A lista traz o resumo por produto; as etiquetas lidas ficam em /inventories/{inventoryId}/rfid-tags.',
  key: [{ param: 'inventoryId', col: 'id', type: 'integer', description: 'Identificador do balanço.' }],
  order: [['id', false]],
  fields: [
    f('inventoryId', 'id', 'integer', 'Identificador do balanço.'),
    f('name', 'nome', 'string', 'Nome dado ao balanço.'),
    f('branchCode', 'empresa', 'integer', 'Empresa.'),
    f('branchName', 'empresa_nome', 'string', 'Nome da empresa.'),
    f('sector', 'setor', 'string', 'Setor contado.'),
    f('userName', 'usuario_nome', 'string', 'Quem contou.'),
    f('startDate', 'iniciado_em', 'date-time', 'Início da contagem.'),
    f('endDate', 'finalizado_em', 'date-time', 'Fim da contagem.'),
    f('durationSeconds', 'duracao_seg', 'integer', 'Duração em segundos.'),
    f('rfidTagQuantity', 'qtd_epcs', 'integer', 'Etiquetas diferentes lidas.'),
    f('readQuantity', 'qtd_leituras', 'integer', 'Leituras feitas (uma etiqueta pode ser lida várias vezes).'),
    f('productSummary', 'resumo_produtos', 'array', 'Resumo por produto (chaves em português, como gravado pelo app).', { items: { type: 'object', additionalProperties: true } }),
    f('productSummaryDate', 'resumo_em', 'date-time', 'Quando o resumo por produto foi calculado.'),
    f('observation', 'observacao', 'string', 'Observação.'),
    f('createdDate', 'criado_em', 'date-time', 'Quando o balanço chegou ao servidor.'),
  ],
  filters: [
    q('branchCodeList', 'intList', 'empresa', 'Empresas, separadas por vírgula.'),
    q('startDate', 'startDate', 'finalizado_em', 'Finalizados a partir de (AAAA-MM-DD).'),
    q('endDate', 'endDate', 'finalizado_em', 'Finalizados até (AAAA-MM-DD).'),
  ],
});

modulo.calculado({
  path: '/inventories/{inventoryId}/rfid-tags',
  express: '/inventories/:inventoryId/rfid-tags',
  notFound: true,
  summary: 'Etiquetas lidas num balanço',
  description: 'Lista das etiquetas (EPC) lidas no balanço, paginada.',
  parameters: [{ name: 'inventoryId', in: 'path', required: true, description: 'Identificador do balanço.', schema: { type: 'integer' } }],
  schemaName: 'RfidInventoryTag',
  schema: { type: 'object', description: 'Etiqueta lida no balanço.', properties: { rfidTag: { type: 'string', description: 'Etiqueta RFID (EPC).' } } },
  handler: rotaCalculada(async (req) => {
    const id = Number(req.params.inventoryId);
    if (!Number.isInteger(id)) throw new ApiError(400, 'InvalidParameter', 'Parâmetro "inventoryId" inválido', 'Esperado um número inteiro.');
    const { data, error } = await supabase.from('balanco_rfid_arquivos').select('id, epcs').eq('id', id).maybeSingle();
    if (error) throw new ApiError(500, 'DatabaseError', 'Erro ao consultar o banco', error.message);
    if (!data) throw new ApiError(404, 'NotFound', 'Balanço não encontrado');
    const itens = (Array.isArray(data.epcs) ? data.epcs : []).map((e) => ({ rfidTag: typeof e === 'string' ? e : e?.epc ?? String(e) }));
    return paginarEmMemoria(req, itens);
  }),
});

export default modulo;
