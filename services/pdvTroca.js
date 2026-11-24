// ============================================================================
// TROCA DO PDV CROSBY (Yago, 16/11/2026). A venda do PDV é 100% no HeadCoach; o
// TOTVS só entra aqui: na hora da troca o sistema procura as COMPRAS do cliente,
// confere se ele realmente comprou a peça que está devolvendo e referencia a
// nota de origem sozinho na NF-e de devolução.
//
// Compras do cliente = notas emitidas para ele
//   • pelo TOTVS  (histórico: fiscal/v2/invoices, todas as nossas empresas);
//   • pelo HeadCoach (pdv_vendas autorizadas — é onde ficam as vendas novas).
// Devoluções já feitas (para a mesma peça não voltar duas vezes) = notas de
// entrada do cliente no TOTVS + trocas registradas no HeadCoach.
//
// Para cada peça: comprado − devolvido = disponível. Se a quantidade pedida
// cabe, a peça sai com a(s) nota(s) de origem (a mais recente primeiro, dando
// preferência à mesma empresa da troca) e o VALOR PAGO naquela nota.
//
// TROCA DE PRESENTE pelo CUPOM DE TROCA (18/11/2026): quem ganhou a peça não é
// o comprador. Ele se cadastra (vira o cliente da troca), o caixa lê o cupom e
// a troca confere as peças contra a VENDA DO CUPOM — não contra as compras de
// quem está trocando. Disponível = comprado na venda − já trocado com o cupom
// (trocas canceladas/rejeitadas não contam). Cupom de venda antiga (do TOTVS)
// confere nas compras do comprador gravado no cupom. A peça devolvida pelo
// cupom também conta como devolvida para o COMPRADOR (não volta duas vezes).
// ============================================================================
import supabase from '../config/supabase.js';
import { notasDoClienteTotvs } from '../totvsrouter/pdv.js';

export class TrocaError extends Error {
  constructor(message, code = 'TROCA', status = 400, detalhes = null) {
    super(message);
    this.code = code;
    this.status = status;
    this.detalhes = detalhes;
  }
}

// até quando procurar as compras (a consulta ao TOTVS precisa de um período)
export const TROCA_JANELA_DIAS = 365;

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const chaveValida = (c) => /^\d{44}$/.test(String(c || ''));
const diaIso = (d) => d.toISOString().slice(0, 10);
const diaBrasil = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso).slice(0, 10) : new Date(d.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
};

// ─── TOTVS: compras e devoluções do cliente (cache curto: a tela confere a cada peça) ──
const cacheTotvs = new Map(); // cliente → { em, valor }
const CACHE_MS = 2 * 60 * 1000;
async function totvsDoCliente(cliente, de, ate) {
  const chave = `${cliente}|${de}|${ate}`;
  const c = cacheTotvs.get(chave);
  if (c && Date.now() - c.em < CACHE_MS) return c.valor;
  const [compras, devolucoes] = await Promise.all([
    notasDoClienteTotvs({ customer: cliente, de, ate, tipo: 'Output' }),
    notasDoClienteTotvs({ customer: cliente, de, ate, tipo: 'Input' }).catch(() => []),
  ]);
  const valor = { compras, devolucoes };
  cacheTotvs.set(chave, { em: Date.now(), valor });
  if (cacheTotvs.size > 200) cacheTotvs.delete(cacheTotvs.keys().next().value);
  return valor;
}

// ─── HeadCoach: vendas e trocas do cliente ──────────────────────────────────
async function headcoachDoCliente(cliente, de) {
  const { data, error } = await supabase
    .from('pdv_vendas')
    .select(
      'id, empresa, tipo_venda, canal, status, criado_em, total, totvs_transacao_code, pdv_venda_itens(product_code, nome, quantidade, valor_unit, desconto_unit), pdv_notas_fiscais(numero, serie, modelo, chave, status, dh_emissao)',
    )
    .eq('cliente_code', cliente)
    .gte('criado_em', `${de}T00:00:00Z`)
    .order('id', { ascending: false })
    .limit(2000);
  if (error) throw new TrocaError(`Não consegui ler as vendas do cliente no HeadCoach: ${error.message}`, 'DB_ERROR', 500);
  return data || [];
}

/**
 * Confere a troca: para cada peça, se o cliente comprou e qual nota referenciar.
 * itens: [{ productCode, quantidade }]. Devolve
 *   { ok, periodo, avisos[], chaves[], itens: [{ productCode, quantidade, ok, motivo,
 *     mensagem, comprado, devolvido, disponivel, valorUnit, notas: [{ origem, empresa,
 *     numero, serie, modelo, chave, data, quantidade, valorUnit, totalNota }] }] }
 */
export async function conferirTroca({ empresa, clienteCode, itens }) {
  const cliente = parseInt(clienteCode, 10);
  const emp = parseInt(empresa, 10) || null;
  if (!cliente) throw new TrocaError('A troca exige o cliente identificado', 'CLIENTE_OBRIGATORIO');
  const pedidos = new Map(); // produto → quantidade pedida
  for (const it of itens || []) {
    const cod = parseInt(it.productCode, 10);
    const q = Number(it.quantidade);
    if (!cod || !(q > 0)) continue;
    pedidos.set(cod, (pedidos.get(cod) || 0) + q);
  }
  if (pedidos.size === 0) throw new TrocaError('Nenhuma peça na troca', 'SEM_ITENS');

  const hoje = new Date();
  const ate = diaIso(new Date(hoje.getTime() + 86400000));
  const de = diaIso(new Date(hoje.getTime() - TROCA_JANELA_DIAS * 86400000));
  const avisos = [];

  const [hcVendas, totvs] = await Promise.all([
    headcoachDoCliente(cliente, de),
    totvsDoCliente(cliente, de, ate).catch((e) => {
      avisos.push(`O TOTVS não respondeu (${e.message}): conferi só as compras feitas pelo HeadCoach.`);
      return { compras: [], devolucoes: [] };
    }),
  ]);

  // linhas de compra por produto e quantidade já devolvida por produto
  const compras = new Map(); // produto → [{ origem, empresa, numero, serie, modelo, chave, data, quantidade, valorUnit }]
  const devolvido = new Map();
  const addCompra = (cod, linha) => {
    if (!pedidos.has(cod)) return;
    if (!compras.has(cod)) compras.set(cod, []);
    compras.get(cod).push(linha);
  };
  const addDevolvido = (cod, q) => {
    if (pedidos.has(cod)) devolvido.set(cod, (devolvido.get(cod) || 0) + q);
  };

  const transacoesEspelhadas = new Set();
  const chavesHc = new Set();
  for (const v of hcVendas) {
    const itensV = v.pdv_venda_itens || [];
    if (v.tipo_venda === 'troca') {
      // troca já registrada (com ou sem nota autorizada ainda): a peça já voltou
      if (v.status === 'cancelada' || v.status === 'rejeitada') continue;
      for (const i of itensV) addDevolvido(Number(i.product_code), Number(i.quantidade) || 0);
      continue;
    }
    if (v.status !== 'autorizada' || ['transferencia', 'devolucao'].includes(v.canal)) continue;
    const nota = (v.pdv_notas_fiscais || []).find((n) => n.status === 'autorizada');
    if (!nota) continue;
    if (v.totvs_transacao_code) transacoesEspelhadas.add(Number(v.totvs_transacao_code));
    if (chaveValida(nota.chave)) chavesHc.add(String(nota.chave));
    for (const i of itensV) {
      addCompra(Number(i.product_code), {
        origem: 'headcoach',
        empresa: Number(v.empresa),
        numero: nota.numero,
        serie: nota.serie,
        modelo: Number(nota.modelo) || null,
        chave: chaveValida(nota.chave) ? String(nota.chave) : null,
        data: diaBrasil(nota.dh_emissao || v.criado_em),
        quantidade: Number(i.quantidade) || 0,
        valorUnit: r2(Number(i.valor_unit) - Number(i.desconto_unit || 0)),
        totalNota: r2(v.total), // a nota da troca referencia UMA só: a que cobre o valor (pdvFiscal.notaReferenciadaDaTroca)
      });
    }
  }
  for (const n of totvs.compras) {
    // venda do HeadCoach espelhada no TOTVS (documento interno): já contada acima
    if (n.accessKey && chavesHc.has(String(n.accessKey))) continue;
    if (!n.accessKey && n.transactionCode && transacoesEspelhadas.has(Number(n.transactionCode))) continue;
    for (const i of n.itens || []) {
      addCompra(Number(i.productCode), {
        origem: 'totvs',
        empresa: Number(n.branchCode),
        numero: n.invoiceCode,
        serie: n.serialCode,
        modelo: Number(n.documentType) || null,
        chave: chaveValida(n.accessKey) ? String(n.accessKey) : null,
        data: n.invoiceDate,
        quantidade: Number(i.quantity) || 0,
        valorUnit: r2(i.unitNet || Number(i.unitGross) - Number(i.unitDiscount || 0)),
        totalNota: r2(n.totalValue),
      });
    }
  }
  for (const n of totvs.devolucoes) for (const i of n.itens || []) addDevolvido(Number(i.productCode), Number(i.quantity) || 0);
  // peça que voltou por CUPOM DE TROCA (presente, no nome de outra pessoa) com
  // referência a uma nota deste cliente: conta como devolvida para ele também
  const chavesDoCliente = new Set([...chavesHc, ...totvs.compras.map((n) => String(n.accessKey || '')).filter(chaveValida)]);
  if (chavesDoCliente.size) {
    const { data: porCupom } = await supabase
      .from('pdv_vendas')
      .select('id, cliente_code, status, nf_referenciada, pedido_info, pdv_venda_itens(product_code, quantidade)')
      .eq('tipo_venda', 'troca')
      .not('pedido_info->>cupomTroca', 'is', null)
      .gte('criado_em', `${de}T00:00:00-03:00`);
    for (const t of porCupom || []) {
      if (Number(t.cliente_code) === cliente || ['cancelada', 'rejeitada'].includes(t.status)) continue;
      const refs = String(t.nf_referenciada || '').split(',');
      if (!refs.some((c) => chavesDoCliente.has(c))) continue;
      for (const i of t.pdv_venda_itens || []) addDevolvido(Number(i.product_code), Number(i.quantidade) || 0);
    }
  }

  const saida = [];
  const chaves = [];
  for (const [cod, qtd] of pedidos) {
    const linhas = (compras.get(cod) || []).sort(
      (a, b) => Number(b.empresa === emp) - Number(a.empresa === emp) || String(b.data).localeCompare(String(a.data)),
    );
    const comprado = linhas.reduce((s, l) => s + l.quantidade, 0);
    const jaDevolvido = Math.min(devolvido.get(cod) || 0, comprado);
    const disponivel = comprado - jaDevolvido;
    const base = { productCode: cod, quantidade: qtd, comprado, devolvido: jaDevolvido, disponivel, valorUnit: null, notas: [] };
    if (comprado === 0) {
      saida.push({ ...base, ok: false, motivo: 'sem_compra', mensagem: `O cliente não comprou esta peça nos últimos ${TROCA_JANELA_DIAS} dias` });
      continue;
    }
    if (qtd > disponivel) {
      saida.push({
        ...base,
        ok: false,
        motivo: disponivel === 0 ? 'ja_devolvida' : 'quantidade',
        mensagem:
          disponivel === 0
            ? `O cliente comprou ${comprado} e já devolveu ${jaDevolvido}: não há o que trocar`
            : `O cliente comprou ${comprado} e já devolveu ${jaDevolvido}: só dá para trocar ${disponivel}`,
      });
      continue;
    }
    // nota(s) de origem: só as que têm chave servem para referenciar
    let falta = qtd;
    const usadas = [];
    for (const l of linhas) {
      if (falta <= 0) break;
      if (!l.chave || !(l.quantidade > 0)) continue;
      const q = Math.min(falta, l.quantidade);
      usadas.push({ ...l, quantidade: q });
      falta -= q;
    }
    if (falta > 0) {
      saida.push({ ...base, ok: false, motivo: 'sem_chave', mensagem: 'A compra desta peça não tem nota eletrônica para referenciar' });
      continue;
    }
    const valorUnit = r2(usadas.reduce((s, l) => s + l.quantidade * l.valorUnit, 0) / qtd);
    if (!(valorUnit > 0)) {
      saida.push({ ...base, ok: false, motivo: 'sem_valor', mensagem: 'A nota de origem está sem o valor da peça' });
      continue;
    }
    for (const l of usadas) if (!chaves.includes(l.chave)) chaves.push(l.chave);
    saida.push({ ...base, ok: true, motivo: null, mensagem: null, valorUnit, notas: usadas });
  }
  return { ok: saida.every((i) => i.ok), periodo: { de, ate: diaIso(hoje) }, avisos, chaves, itens: saida };
}

// ─── CUPOM DE TROCA ──────────────────────────────────────────────────────────
const normCupom = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * O cupom com o que ainda dá para trocar: { cupom, origem, comprador, itens[] }.
 * itens: { productCode, nome, comprado, trocado, disponivel, valorUnit }.
 */
export async function cupomParaTroca(codigo) {
  const cod = normCupom(codigo);
  if (!cod) throw new TrocaError('Informe o código do cupom de troca', 'CUPOM_VAZIO');
  const { data: cupom, error } = await supabase.from('pdv_cupons_troca').select('*').eq('codigo', cod).maybeSingle();
  if (error) throw new TrocaError(`Não consegui ler o cupom: ${error.message}`, 'CUPOM_ERRO', 500);
  if (!cupom) throw new TrocaError(`Cupom ${cod} não encontrado`, 'CUPOM_NAO_ENCONTRADO', 404);

  // o que já foi trocado com o cupom (troca cancelada/rejeitada libera a peça)
  const usos = Array.isArray(cupom.usos) ? cupom.usos : [];
  const trocaIds = [...new Set(usos.map((u) => Number(u.transacao_code)).filter(Boolean))];
  const invalidas = new Set();
  if (trocaIds.length) {
    const { data: trs } = await supabase.from('pdv_vendas').select('id, status').in('id', trocaIds);
    for (const t of trs || []) if (['cancelada', 'rejeitada'].includes(t.status)) invalidas.add(Number(t.id));
  }
  const trocado = new Map();
  for (const u of usos) {
    if (u.transacao_code && invalidas.has(Number(u.transacao_code))) continue;
    trocado.set(Number(u.productCode), (trocado.get(Number(u.productCode)) || 0) + (Number(u.quantity) || 0));
  }

  // venda de origem: a do HeadCoach (o cupom guarda o nº da transação)
  const { data: venda } = await supabase
    .from('pdv_vendas')
    .select('id, empresa, status, tipo_venda, cliente_code, cliente_nome, criado_em, pdv_venda_itens(product_code, nome, quantidade, valor_unit, desconto_unit), pdv_notas_fiscais(numero, serie, modelo, chave, status, dh_emissao)')
    .eq('id', Number(cupom.transacao_code))
    .eq('empresa', Number(cupom.empresa))
    .maybeSingle();
  const nota = venda ? (venda.pdv_notas_fiscais || []).find((n) => n.status === 'autorizada') : null;
  const comprador = { code: cupom.cliente_code || venda?.cliente_code || null, nome: cupom.cliente_nome || venda?.cliente_nome || null };
  let origem;
  const porProduto = new Map();
  if (venda && venda.tipo_venda !== 'troca') {
    if (venda.status === 'cancelada') throw new TrocaError(`A venda do cupom ${cod} (transação ${venda.id}) foi cancelada`, 'CUPOM_VENDA_CANCELADA', 409);
    if (!nota || !chaveValida(nota.chave)) throw new TrocaError(`A venda do cupom ${cod} (transação ${venda.id}) ainda não tem nota fiscal autorizada`, 'CUPOM_SEM_NOTA', 409);
    origem = {
      tipo: 'headcoach',
      vendaId: venda.id,
      empresa: Number(venda.empresa),
      nota: { origem: 'headcoach', empresa: Number(venda.empresa), numero: nota.numero, serie: nota.serie, modelo: Number(nota.modelo) || null, chave: String(nota.chave), data: diaBrasil(nota.dh_emissao || venda.criado_em) },
    };
    for (const i of venda.pdv_venda_itens || []) {
      const c = Number(i.product_code);
      const x = porProduto.get(c) || { productCode: c, nome: i.nome, comprado: 0, soma: 0 };
      const q = Number(i.quantidade) || 0;
      x.comprado += q;
      x.soma += q * (Number(i.valor_unit) - Number(i.desconto_unit || 0));
      porProduto.set(c, x);
    }
  } else {
    // cupom de venda antiga (do TOTVS): as peças do cupom; a nota sai das compras do comprador
    if (!comprador.code) throw new TrocaError(`O cupom ${cod} é de uma venda antiga sem o comprador: faça a troca pelo cliente que comprou`, 'CUPOM_SEM_COMPRADOR', 409);
    origem = { tipo: 'totvs', transacao: cupom.transacao_code, empresa: Number(cupom.empresa), nota: null };
    for (const i of cupom.itens || []) {
      const c = Number(i.productCode);
      const x = porProduto.get(c) || { productCode: c, nome: i.name, comprado: 0, soma: 0 };
      x.comprado += Number(i.quantity) || 0;
      porProduto.set(c, x);
    }
  }
  const itens = [...porProduto.values()].map((x) => {
    const jaTrocado = Math.min(trocado.get(x.productCode) || 0, x.comprado);
    return {
      productCode: x.productCode,
      nome: x.nome,
      comprado: x.comprado,
      trocado: jaTrocado,
      disponivel: Math.max(0, x.comprado - jaTrocado),
      valorUnit: x.comprado > 0 && x.soma > 0 ? r2(x.soma / x.comprado) : null,
    };
  });
  return {
    cupom: { codigo: cupom.codigo, empresa: Number(cupom.empresa), transacao: cupom.transacao_code, data: cupom.transacao_date, total: Number(cupom.total) || 0 },
    origem,
    comprador,
    itens,
  };
}

/** Confere as peças de uma troca pelo CUPOM (mesmo formato de conferirTroca). */
export async function conferirTrocaPorCupom({ empresa, codigo, itens }) {
  const c = await cupomParaTroca(codigo);
  const pedidos = new Map();
  for (const it of itens || []) {
    const cod = parseInt(it.productCode, 10);
    const q = Number(it.quantidade);
    if (!cod || !(q > 0)) continue;
    pedidos.set(cod, (pedidos.get(cod) || 0) + q);
  }
  if (pedidos.size === 0) throw new TrocaError('Nenhuma peça na troca', 'SEM_ITENS');
  const avisos = [];
  const emp = parseInt(empresa, 10) || null;
  if (emp && c.cupom.empresa !== emp) avisos.push(`O cupom é de uma venda da empresa ${c.cupom.empresa}; a troca está sendo feita na ${emp}.`);
  // cupom antigo (TOTVS): valor e nota pelas compras do comprador
  const doComprador =
    c.origem.tipo === 'totvs' ? await conferirTroca({ empresa: emp || c.cupom.empresa, clienteCode: c.comprador.code, itens: [...pedidos].map(([productCode, quantidade]) => ({ productCode, quantidade })) }) : null;
  if (doComprador) avisos.push(...doComprador.avisos);
  const saida = [];
  const chaves = [];
  for (const [cod, qtd] of pedidos) {
    const linha = c.itens.find((i) => i.productCode === cod);
    const base = { productCode: cod, quantidade: qtd, comprado: linha?.comprado || 0, devolvido: linha?.trocado || 0, disponivel: linha?.disponivel || 0, valorUnit: null, notas: [] };
    if (!linha) {
      saida.push({ ...base, ok: false, motivo: 'fora_do_cupom', mensagem: `Esta peça não está no cupom ${c.cupom.codigo}` });
      continue;
    }
    if (qtd > linha.disponivel) {
      saida.push({
        ...base,
        ok: false,
        motivo: linha.disponivel === 0 ? 'ja_devolvida' : 'quantidade',
        mensagem: linha.disponivel === 0 ? `Já foi trocada com este cupom` : `O cupom tem ${linha.comprado} e já trocou ${linha.trocado}: só dá para trocar ${linha.disponivel}`,
      });
      continue;
    }
    if (doComprador) {
      const r = doComprador.itens.find((i) => Number(i.productCode) === cod);
      if (!r?.ok) {
        saida.push({ ...base, ok: false, motivo: r?.motivo || 'sem_compra', mensagem: r?.mensagem || 'Não achei a compra desta peça' });
        continue;
      }
      for (const l of r.notas) if (l.chave && !chaves.includes(l.chave)) chaves.push(l.chave);
      saida.push({ ...base, ok: true, motivo: null, mensagem: null, valorUnit: r.valorUnit, notas: r.notas });
      continue;
    }
    if (!(linha.valorUnit > 0)) {
      saida.push({ ...base, ok: false, motivo: 'sem_valor', mensagem: 'A venda do cupom está sem o valor da peça' });
      continue;
    }
    if (!chaves.includes(c.origem.nota.chave)) chaves.push(c.origem.nota.chave);
    saida.push({ ...base, ok: true, motivo: null, mensagem: null, valorUnit: linha.valorUnit, notas: [{ ...c.origem.nota, quantidade: qtd, valorUnit: linha.valorUnit }] });
  }
  return { ok: saida.every((i) => i.ok), avisos, chaves, itens: saida, cupom: c.cupom, comprador: c.comprador };
}
