// API HEADCOACH › sale-panel — totais de venda por loja, vendedor e dia; cupons de troca e promoções do PDV.
import { criarModulo, f, q, rotaCalculada, paginarEmMemoria, lerTudo, listaDeInteiros, exigirPeriodo, inicioDoDia, fimDoDia, diaRecife, supabase, ApiError } from './_engine.js';

const modulo = criarModulo({
  nome: 'sale-panel',
  titulo: 'SalePanel',
  descricao:
    'Painel de vendas do que passa pelo HeadCoach (PDV Crosby e faturamento da expedição). Não inclui as vendas que as lojas ainda fazem pelo TOTVS. Regra: faturamento = vendas − devoluções; a venda entra pelo valor cheio e a troca ou devolução entra como devolução; transferência entre empresas não conta. Só transação com nota autorizada, pela data do caixa.',
});

const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const somaDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const PARAMS = ['startDate', 'endDate', 'branchCodeList', 'origin'];
const DOC_PARAMS = [
  { name: 'startDate', in: 'query', required: true, description: 'Data do caixa a partir de (AAAA-MM-DD).', schema: { type: 'string', format: 'date' } },
  { name: 'endDate', in: 'query', required: true, description: 'Data do caixa até (AAAA-MM-DD).', schema: { type: 'string', format: 'date' } },
  { name: 'branchCodeList', in: 'query', required: false, description: 'Empresas, separadas por vírgula.', schema: { type: 'string', example: '95,99' } },
  { name: 'origin', in: 'query', required: false, description: 'Só o PDV Crosby (Pos) ou só o faturamento da expedição (Billing). Sem o parâmetro, os dois.', schema: { type: 'string', enum: ['Pos', 'Billing'] } },
];
const metricas = {
  saleQuantity: { type: 'integer', description: 'Número de vendas.' },
  saleValue: { type: 'number', description: 'Valor das vendas (cheio).' },
  itemQuantity: { type: 'number', description: 'Peças vendidas.' },
  returnQuantity: { type: 'integer', description: 'Número de trocas e devoluções.' },
  returnValue: { type: 'number', description: 'Valor das trocas e devoluções.' },
  netValue: { type: 'number', description: 'Faturamento: vendas − devoluções.' },
  averageTicket: { type: 'number', description: 'Ticket médio (valor das vendas ÷ número de vendas).' },
  itemsPerSale: { type: 'number', description: 'Peças por venda.' },
};

/** Transações do período, já com a data do caixa e classificadas em venda ou devolução. */
async function movimentos(req) {
  const { de, ate } = exigirPeriodo(req);
  const empresas = listaDeInteiros(req, 'branchCodeList');
  const origem = req.query.origin === undefined ? null : ['Pos', 'Billing'].find((o) => o.toLowerCase() === String(req.query.origin).toLowerCase());
  if (req.query.origin !== undefined && !origem) throw new ApiError(400, 'InvalidParameter', 'Parâmetro "origin" inválido', 'Valores aceitos: Pos, Billing.');
  const vendas = await lerTudo(() => {
    let qy = supabase
      .from('pdv_vendas')
      .select('id, empresa, origem, canal, tipo_venda, total, qtd_pecas, vendedor_code, vendedor_nome, criado_em, data_caixa, caixa_id')
      .eq('status', 'autorizada')
      .gte('criado_em', inicioDoDia(somaDias(de, -3)))
      .lte('criado_em', fimDoDia(somaDias(ate, 3)))
      .order('id', { ascending: true });
    if (empresas) qy = qy.in('empresa', empresas);
    if (origem) qy = qy.eq('origem', origem === 'Pos' ? 'pdv' : 'expedicao');
    return qy;
  });
  const caixaIds = [...new Set(vendas.filter((v) => !v.data_caixa && v.caixa_id).map((v) => v.caixa_id))];
  const dataDoCaixa = new Map();
  for (let i = 0; i < caixaIds.length; i += 200) {
    const { data, error } = await supabase.from('hc_caixas').select('id, data_caixa').in('id', caixaIds.slice(i, i + 200));
    if (error) throw new ApiError(500, 'DatabaseError', 'Erro ao consultar o banco', error.message);
    for (const c of data || []) dataDoCaixa.set(c.id, String(c.data_caixa || '').slice(0, 10) || null);
  }
  const out = [];
  for (const v of vendas) {
    if (v.canal === 'transferencia') continue; // transferência não é venda
    const data = (v.data_caixa && String(v.data_caixa).slice(0, 10)) || (v.caixa_id && dataDoCaixa.get(v.caixa_id)) || diaRecife(v.criado_em);
    if (!data || data < de || data > ate) continue;
    const devolucao = v.tipo_venda === 'troca' || v.canal === 'devolucao';
    out.push({ empresa: v.empresa, vendedor: v.vendedor_code ?? null, vendedorNome: v.vendedor_nome || null, data, devolucao, valor: r2(v.total), pecas: Number(v.qtd_pecas) || 0 });
  }
  return out;
}
function agrupar(movs, chaveDe, baseDe) {
  const mapa = new Map();
  for (const m of movs) {
    const k = chaveDe(m);
    const a = mapa.get(k) || { ...baseDe(m), saleQuantity: 0, saleValue: 0, itemQuantity: 0, returnQuantity: 0, returnValue: 0 };
    if (m.devolucao) {
      a.returnQuantity += 1;
      a.returnValue = r2(a.returnValue + m.valor);
    } else {
      a.saleQuantity += 1;
      a.saleValue = r2(a.saleValue + m.valor);
      a.itemQuantity += m.pecas;
    }
    mapa.set(k, a);
  }
  return [...mapa.values()].map((a) => ({
    ...a,
    netValue: r2(a.saleValue - a.returnValue),
    averageTicket: a.saleQuantity ? r2(a.saleValue / a.saleQuantity) : 0,
    itemsPerSale: a.saleQuantity ? r2(a.itemQuantity / a.saleQuantity) : 0,
  }));
}

modulo.calculado({
  path: '/totals-branch',
  summary: 'Totais por empresa',
  description: 'Vendas, devoluções e faturamento de cada empresa no período.',
  parameters: DOC_PARAMS,
  schemaName: 'SaleTotalsBranch',
  schema: { type: 'object', description: 'Totais de uma empresa no período.', properties: { branchCode: { type: 'integer' }, ...metricas } },
  handler: rotaCalculada(async (req) => {
    const itens = agrupar(await movimentos(req), (m) => m.empresa, (m) => ({ branchCode: m.empresa })).sort((a, b) => b.netValue - a.netValue);
    return paginarEmMemoria(req, itens, PARAMS);
  }),
});

modulo.calculado({
  path: '/totals-seller',
  summary: 'Totais por vendedor',
  description: 'Vendas, devoluções e faturamento por empresa e vendedor no período. A troca ou devolução conta no vendedor que a registrou.',
  parameters: DOC_PARAMS,
  schemaName: 'SaleTotalsSeller',
  schema: { type: 'object', description: 'Totais de um vendedor numa empresa.', properties: { branchCode: { type: 'integer' }, sellerCode: { type: 'integer', nullable: true }, sellerName: { type: 'string', nullable: true }, ...metricas } },
  handler: rotaCalculada(async (req) => {
    const itens = agrupar(await movimentos(req), (m) => `${m.empresa}|${m.vendedor}`, (m) => ({ branchCode: m.empresa, sellerCode: m.vendedor, sellerName: m.vendedorNome })).sort((a, b) => a.branchCode - b.branchCode || b.netValue - a.netValue);
    return paginarEmMemoria(req, itens, PARAMS);
  }),
});

modulo.calculado({
  path: '/totals-day',
  summary: 'Totais por dia',
  description: 'Vendas, devoluções e faturamento por empresa e dia (data do caixa).',
  parameters: DOC_PARAMS,
  schemaName: 'SaleTotalsDay',
  schema: { type: 'object', description: 'Totais de uma empresa num dia.', properties: { cashierDate: { type: 'string', format: 'date' }, branchCode: { type: 'integer' }, ...metricas } },
  handler: rotaCalculada(async (req) => {
    const itens = agrupar(await movimentos(req), (m) => `${m.data}|${m.empresa}`, (m) => ({ cashierDate: m.data, branchCode: m.empresa })).sort((a, b) => (a.cashierDate < b.cashierDate ? -1 : a.cashierDate > b.cashierDate ? 1 : a.branchCode - b.branchCode));
    return paginarEmMemoria(req, itens, PARAMS);
  }),
});

modulo.recurso({
  name: 'ExchangeCoupon',
  path: '/exchange-coupons',
  table: 'pdv_cupons_troca',
  summary: 'Cupons de troca',
  description: 'Cupom entregue ao cliente junto com a nota da venda (serve para presente: não mostra valores). `transactionCode` é a transação do HeadCoach nos cupons novos; nos antigos, do tempo em que a venda ia ao TOTVS, é a transação do TOTVS. Na troca de presente o caixa lê o código do cupom: a troca é conferida contra a venda do cupom e cada peça trocada fica anotada em `uses`.',
  key: [{ param: 'couponCode', col: 'codigo', type: 'string', description: 'Código impresso no cupom.' }],
  order: [['id', false]],
  fields: [
    f('couponCode', 'codigo', 'string', 'Código impresso no cupom.'),
    f('branchCode', 'empresa', 'integer', 'Empresa da venda.'),
    f('transactionCode', 'transacao_code', 'integer', 'Transação da venda.'),
    f('transactionDate', 'transacao_date', 'date', 'Data da venda.'),
    f('totalValue', 'total', 'number', 'Valor da venda.'),
    f('customerCode', 'cliente_code', 'integer', 'Cliente da venda.'),
    f('customerName', 'cliente_nome', 'string', 'Nome do cliente.'),
    f('sellerCode', 'vendedor_code', 'integer', 'Vendedor.'),
    f('sellerName', 'vendedor_nome', 'string', 'Nome do vendedor.'),
    f('items', 'itens', 'array', 'Peças da venda.', { items: { type: 'object', properties: { productCode: { type: 'integer' }, name: { type: 'string' }, quantity: { type: 'number' } } } }),
    f('uses', 'usos', 'array', 'Peças já trocadas com este cupom (troca de presente), uma linha por peça de cada troca, com as chaves como gravado na tela. O uso de uma troca cancelada ou rejeitada continua na lista, mas não conta: confira a situação da transação em `transacao_code`.', {
      items: {
        type: 'object',
        properties: {
          productCode: { type: 'integer', description: 'Produto trocado.' },
          quantity: { type: 'number', description: 'Quantidade trocada.' },
          transacao_code: { type: 'integer', description: 'Transação da troca no HeadCoach (transaction/transactions).' },
          empresa: { type: 'integer', description: 'Loja onde a troca foi feita.' },
          em: { type: 'string', format: 'date-time', description: 'Quando foi trocado.' },
          por: { type: 'string', nullable: true, description: 'Quem fez a troca.' },
        },
      },
    }),
    f('createdBy', 'criado_por', 'string', 'Quem gerou.'),
    f('createdDate', 'criado_em', 'date-time', 'Quando foi gerado.'),
  ],
  filters: [
    q('branchCodeList', 'intList', 'empresa', 'Empresas, separadas por vírgula.'),
    q('transactionCode', 'int', 'transacao_code', 'Cupom de uma transação.'),
    q('customerCode', 'int', 'cliente_code', 'Cliente.'),
    q('startDate', 'startDay', 'transacao_date', 'Data da venda a partir de (AAAA-MM-DD).'),
    q('endDate', 'endDay', 'transacao_date', 'Data da venda até (AAAA-MM-DD).'),
  ],
});

const PROMO_ITEM = {
  name: 'PromotionItem',
  path: '/promotion-items',
  table: 'pdv_promocao_itens',
  summary: 'Produtos em promoção',
  description: 'Produto de uma promoção do PDV, com o preço cheio e o promocional.',
  order: [['promocao_id', false], ['product_code', true]],
  fields: [
    f('promotionId', 'promocao_id', 'integer', 'Promoção.'),
    f('productCode', 'product_code', 'integer', 'Produto.'),
    f('productSku', 'sku', 'string', 'Código de barras.'),
    f('productName', 'nome', 'string', 'Nome do produto.'),
    f('basePrice', 'preco_base', 'number', 'Preço cheio.'),
    f('promotionalPrice', 'preco_promocional', 'number', 'Preço promocional.'),
  ],
  filters: [q('promotionId', 'int', 'promocao_id', 'Produtos de uma promoção.'), q('productCode', 'int', 'product_code', 'Produto.')],
};

modulo.recurso({
  name: 'Promotion',
  path: '/promotions',
  table: 'pdv_promocoes',
  summary: 'Promoções do PDV',
  description: 'Promoções geradas no HeadCoach para o PDV Crosby (tela Preço Promocional). Vale nas empresas de `branchCodes`, entre `startDate` e `endDate`, enquanto `isActive` for true.',
  key: [{ param: 'promotionId', col: 'id', type: 'integer', description: 'Identificador da promoção.' }],
  order: [['id', false]],
  fields: [
    f('promotionId', 'id', 'integer', 'Identificador da promoção.'),
    f('name', 'nome', 'string', 'Nome da promoção.'),
    f('branchCodes', 'empresas', 'array', 'Empresas em que vale.', { items: { type: 'integer' } }),
    f('startDate', 'inicio', 'date', 'Início.'),
    f('endDate', 'fim', 'date', 'Fim.'),
    f('isActive', 'ativa', 'boolean', 'Promoção ligada.'),
    f('discountPercentage', 'desconto_pct', 'number', 'Percentual de desconto aplicado.'),
    f('createdBy', 'criado_por', 'string', 'Quem criou.'),
    f('createdDate', 'criado_em', 'date-time', 'Criação.'),
    f('lastChangeDate', 'atualizado_em', 'date-time', 'Última alteração.'),
  ],
  filters: [q('isActive', 'bool', 'ativa', 'Só as ligadas (true) ou desligadas (false).'), q('name', 'text', 'nome', 'Trecho do nome.')],
  expand: { items: { resource: PROMO_ITEM, fk: 'promocao_id', description: 'Produtos da promoção' } },
});
modulo.recurso(PROMO_ITEM);

// Limite de desconto do PDV Crosby por usuário (tela Financeiro › Liberação de Desconto)
modulo.recurso({
  name: 'DiscountLimit',
  path: '/discount-limits',
  table: 'pdv_desconto_limites',
  summary: 'Limite de desconto por vendedor',
  description:
    'Percentual máximo de desconto que cada usuário do setor Varejo pode dar no PDV Crosby sem a senha de um owner/admin (tela Financeiro › Liberação de Desconto). Só traz quem já teve o limite gravado: **usuário que não aparece aqui usa o padrão de 15%**. Owner e admin não têm limite.',
  key: [{ param: 'userId', col: 'user_id', type: 'string', description: 'Usuário do HeadCoach (uuid).' }],
  order: [['usuario_nome', true]],
  fields: [
    f('userId', 'user_id', 'string', 'Usuário do HeadCoach (uuid).'),
    f('userName', 'usuario_nome', 'string', 'Nome do usuário.'),
    f('userEmail', 'usuario_email', 'string', 'E-mail do usuário.'),
    f('branchCodes', 'empresas', 'array', 'Lojas configuradas para o usuário quando o limite foi gravado.', { items: { type: 'integer' } }),
    f('discountPercentage', 'pct', 'number', 'Limite de desconto, em % (0 a 100).'),
    f('changedBy', 'atualizado_por', 'string', 'Quem definiu.'),
    f('lastChangeDate', 'atualizado_em', 'date-time', 'Quando foi definido.'),
  ],
  filters: [q('userEmail', 'text', 'usuario_email', 'Trecho do e-mail.'), q('userName', 'text', 'usuario_nome', 'Trecho do nome.')],
});

modulo.recurso({
  name: 'DiscountLimitChange',
  path: '/discount-limit-changes',
  table: 'pdv_desconto_limites_hist',
  summary: 'Histórico do limite de desconto',
  description: 'Uma linha por usuário a cada mudança do limite de desconto do PDV Crosby: de quanto para quanto, quem mudou e se foi só aquele usuário (`User`), todos de uma loja (`Branch`) ou todos (`All`).',
  key: [{ param: 'changeId', col: 'id', type: 'integer', description: 'Identificador da mudança.' }],
  order: [['id', false]],
  fields: [
    f('changeId', 'id', 'integer', 'Identificador da mudança.'),
    f('userId', 'user_id', 'string', 'Usuário que teve o limite mudado (uuid).'),
    f('userName', 'usuario_nome', 'string', 'Nome do usuário.'),
    f('userEmail', 'usuario_email', 'string', 'E-mail do usuário.'),
    f('branchCodes', 'empresas', 'array', 'Lojas do usuário na hora da mudança.', { items: { type: 'integer' } }),
    f('previousDiscountPercentage', 'de_pct', 'number', 'Limite anterior, em %.'),
    f('discountPercentage', 'para_pct', 'number', 'Limite novo, em %.'),
    f('scope', 'escopo', 'string', 'Como foi mudado.', { map: { usuario: 'User', loja: 'Branch', todos: 'All' } }),
    f('scopeBranchCode', 'escopo_empresa', 'integer', 'Loja escolhida, quando a mudança foi por loja.'),
    f('changedBy', 'alterado_por', 'string', 'Quem mudou.'),
    f('changeDate', 'alterado_em', 'date-time', 'Quando mudou.'),
  ],
  filters: [q('userId', 'string', 'user_id', 'Usuário (uuid).'), q('scopeBranchCode', 'int', 'escopo_empresa', 'Mudanças feitas para uma loja.')],
});

export default modulo;
