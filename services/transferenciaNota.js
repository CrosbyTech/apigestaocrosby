// ============================================================================
// TRANSFERÊNCIA SAINDO DA EXPEDIÇÃO (empresa 99) COM A NOTA PELO HEADCOACH
// (Yago, 11/11/2026). Mesmo desenho do faturamento da expedição:
//   1. a tela de Transferências traz as peças do pedido (o "carrinho") e o
//      portal RFID confere; só o que foi conferido entra;
//   2. a NF-e de transferência sai pelo HeadCoach (empresa 99, série 3), no
//      padrão das notas que a 99 emitia pelo TOTVS (services/pdvFiscal.js):
//        destino da MESMA raiz de CNPJ → transferência (op 8400, CFOP 5151/5152)
//        destino de OUTRA raiz        → venda entre filiais (op 8405, CFOP 5101/5102)
//   3. o TOTVS recebe a transação na EMPRESA 990 como DOCUMENTO INTERNO, sem
//      nota e sem financeiro, na operação "N/OFC" equivalente:
//        transferência → 8401 SAIDA DE TRANSFERENCIA ENTRE FILIAIS N/OFC
//        venda         → 8404 VENDA MERCADORIA ENTRE FILIAIS N/OFC
//      e o HeadCoach pede o atendimento dela (services/pdvEspelhoTotvs.js).
// A venda fica em pdv_vendas (origem 'expedicao', canal 'transferencia',
// pedido_info.transferencia) para reaproveitar emissão, numeração, DANFE,
// cancelamento e espelho. O acompanhamento fica em transferencias_transacoes
// (aba Transações da página) e na solicitação (transferencias_mercadoria).
// Transferência de outra empresa continua no fluxo antigo (TRAFP005).
// ============================================================================
import supabase from '../config/supabase.js';
import { listarFiliaisPop, raizCnpj, TransferenciaError } from './transferenciasMercadoria.js';
import { buscarEmitente, buscarClienteFiscal, buscarProdutoFiscal, buscarConfig, tiposFiscais, cenarioExpedicao, cfopTransferencia } from './pdvFiscal.js';
import { acertarNumeracao } from './faturamentoExpedicao.js';
import { espelharVendaNoTotvs } from './pdvEspelhoTotvs.js';
import { emitirVendaPdv, registrarEpcs, carregarVenda } from '../routes/pdvCrosby.routes.js';

export const EMPRESA_ORIGEM_NOTA = 99;
export const EMPRESA_TOTVS_TRANSF = 990;
// nota: operação que a 99 usava no TOTVS (só referência) · docInterno: a que vai para a 990
export const OPERACOES_TRANSF_NOTA = {
  transferencia: { nota: 8400, docInterno: 8401, nome: 'Transferência entre filiais' },
  venda: { nota: 8405, docInterno: 8404, nome: 'Venda de mercadoria entre filiais' },
};

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const hojeBrasil = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Recife' }).format(new Date());
const CENARIO_TXT = { interna: 'Dentro do RN · ICMS 20%', interContrib: 'Fora do RN · ICMS 12%' };

// A nota só pode sair se o acompanhamento tiver onde ser gravado: sem as colunas
// novas (scripts/migrar-transferencia-nota.mjs) a tela recusa, em vez de emitir
// a NF-e e perder o vínculo com a solicitação e com a transação da 990.
let colunasOk = false;
async function exigirColunas() {
  if (colunasOk) return;
  const [a, b] = await Promise.all([
    supabase.from('transferencias_transacoes').select('id, venda_id, empresa_totvs, nf_status, totvs_erro').limit(1),
    supabase.from('transferencias_mercadoria').select('id, venda_id, nf_numero').limit(1),
  ]);
  if (a.error || b.error) {
    throw new TransferenciaError(
      'A transferência com nota pelo HeadCoach ainda não está liberada: faltam colunas no banco. Rode "node scripts/migrar-transferencia-nota.mjs" na pasta da API e tente de novo.',
      'MIGRATION_PENDING',
      503,
    );
  }
  colunasOk = true;
}

// Origem (99), destino (filial ou pessoa informada) e a natureza pela raiz do CNPJ
async function contexto(destinoClienteCode) {
  const pessoa = Number(destinoClienteCode);
  if (!(pessoa > 0)) throw new TransferenciaError('Informe a loja de destino', 'SEM_DESTINO');
  const [emit, filiais, cliente] = await Promise.all([buscarEmitente(EMPRESA_ORIGEM_NOTA), listarFiliaisPop().catch(() => []), buscarClienteFiscal(pessoa)]);
  if (!cliente) throw new TransferenciaError(`Cliente ${pessoa} (loja de destino) não encontrado no TOTVS`, 'DESTINO_NAO_ENCONTRADO', 404);
  if (!cliente.cnpj) throw new TransferenciaError(`O destino ${cliente.nome} não tem CNPJ no TOTVS: transferência é só entre empresas`, 'DESTINO_SEM_CNPJ');
  const filial = filiais.find((f) => Number(f.personCode) === pessoa) || null;
  if (filial && Number(filial.code) === EMPRESA_ORIGEM_NOTA) throw new TransferenciaError('A loja de destino é a própria origem (99)', 'MESMA_EMPRESA');
  const natureza = raizCnpj(cliente.cnpj) === raizCnpj(emit.cnpj) ? 'transferencia' : 'venda';
  const cen = cenarioExpedicao({ emitUf: emit.uf, cliente });
  return { emit, cliente, filial, natureza, cen, operacoes: OPERACOES_TRANSF_NOTA[natureza] };
}

async function solicitacaoDe(id) {
  if (!id) return null;
  const { data } = await supabase.from('transferencias_mercadoria').select('*').eq('id', Number(id)).maybeSingle();
  if (!data) throw new TransferenciaError('Solicitação não encontrada', 'NOT_FOUND', 404);
  return data;
}

// nota já emitida para esta solicitação (não emite duas)
async function notaDaSolicitacao(sol) {
  if (!sol?.venda_id) return null;
  const venda = await carregarVenda(sol.venda_id);
  if (!venda || venda.status === 'cancelada') return null;
  const nota = venda.notas.find((n) => n.status === 'autorizada');
  return nota ? { vendaId: venda.id, numero: nota.numero, serie: nota.serie, chave: nota.chave, totvsStatus: venda.totvs_status, transacao: venda.totvs_transacao_code } : null;
}

/** O que a tela precisa antes de ler as peças. */
export async function prepararTransferenciaNota({ solicitacaoId = null, destinoClienteCode = null } = {}) {
  await exigirColunas();
  const sol = await solicitacaoDe(solicitacaoId);
  if (sol && Number(sol.empresa_origem) !== EMPRESA_ORIGEM_NOTA) {
    throw new TransferenciaError(`A nota pelo HeadCoach é só para transferência saindo da empresa ${EMPRESA_ORIGEM_NOTA}`, 'ORIGEM_NAO_ATENDIDA');
  }
  const pessoa = sol?.cliente_code || destinoClienteCode;
  const ctx = await contexto(pessoa);
  const cfg = await buscarConfig(EMPRESA_ORIGEM_NOTA);
  const pendencias = [];
  if (!ctx.cliente.endereco?.cMun || !ctx.cliente.endereco?.UF) pendencias.push(`A loja de destino (${ctx.cliente.nome}) está sem endereço completo no TOTVS.`);
  if (!ctx.cen.contribuinte) pendencias.push(`A loja de destino (${ctx.cliente.nome}) está sem inscrição estadual no TOTVS.`);
  return {
    origem: { code: EMPRESA_ORIGEM_NOTA, nome: ctx.emit.xFant || ctx.emit.xNome, cnpj: ctx.emit.cnpj, uf: ctx.emit.uf },
    destino: {
      personCode: ctx.cliente.code,
      code: ctx.filial?.code ?? null,
      nome: ctx.filial?.nome || ctx.cliente.nome,
      razao: ctx.cliente.nome,
      cnpj: ctx.cliente.cnpj,
      ie: ctx.cliente.ie || null,
      uf: ctx.cliente.endereco?.UF || null,
      cidade: ctx.cliente.endereco?.xMun || null,
      foraDoPop: !ctx.filial,
    },
    natureza: ctx.natureza,
    naturezaNome: ctx.operacoes.nome,
    operacaoNota: ctx.operacoes.nota,
    operacaoDocInterno: ctx.operacoes.docInterno,
    empresaTotvs: EMPRESA_TOTVS_TRANSF,
    cenario: { chave: ctx.cen.chave, texto: CENARIO_TXT[ctx.cen.chave] || ctx.cen.chave, cfops: ctx.cen.contribuinte ? [cfopTransferencia(ctx.cen.chave, 'producao', ctx.natureza), cfopTransferencia(ctx.cen.chave, 'adquirido', ctx.natureza)] : [] },
    numeracao: { serie: cfg.serie_nfe, ambiente: cfg.ambiente },
    pendencias,
    solicitacao: sol
      ? { id: sol.id, ref: sol.origem_ref || null, origem: sol.origem || null, status: sol.status, qtd_pecas: sol.qtd_pecas, valor: Number(sol.valor) || 0, observacao: sol.observacao || null, itens: Array.isArray(sol.itens) ? sol.itens : [] }
      : null,
    jaEmitida: await notaDaSolicitacao(sol),
  };
}

async function acharRegistro(vendaId) {
  const { data } = await supabase.from('transferencias_transacoes').select('*').eq('venda_id', vendaId).maybeSingle();
  return data || null;
}

/**
 * Emite a NF-e (se ainda não saiu), abre e atende a transação na 990 (se ainda
 * não foi) e atualiza o registro e a solicitação. Pode ser chamado de novo.
 */
export async function processarTransferenciaNota(vendaId) {
  await exigirColunas();
  let venda = await carregarVenda(vendaId);
  if (!venda) throw new TransferenciaError('Transferência não encontrada', 'NOT_FOUND', 404);
  const t = venda.pedido_info?.transferencia;
  if (!t) throw new TransferenciaError('Esta venda não é uma transferência com nota pelo HeadCoach', 'NAO_E_TRANSFERENCIA');
  const reg = await acharRegistro(vendaId);
  const atualizar = async (patch) => {
    if (reg) await supabase.from('transferencias_transacoes').update({ ...patch, atualizado_em: new Date().toISOString() }).eq('id', reg.id);
  };

  // 1) NF-e
  let nota = venda.notas.find((n) => n.status === 'autorizada') || null;
  let fiscal = { ok: !!nota };
  if (!nota) {
    try {
      await acertarNumeracao(venda.empresa);
      const r = await emitirVendaPdv(vendaId);
      nota = r.dados?.nota || null;
      fiscal = { ok: r.status === 200, mensagem: r.mensagem };
    } catch (err) {
      fiscal = { ok: false, mensagem: err.message, code: err.code };
    }
    venda = await carregarVenda(vendaId);
    nota = venda.notas.find((n) => n.status === 'autorizada') || venda.notas[0] || nota;
  }
  await atualizar({ nota_id: nota?.id ?? null, nf_numero: nota?.numero ?? null, nf_serie: nota?.serie != null ? String(nota.serie) : null, nf_chave: nota?.chave ?? null, nf_status: nota?.status || (fiscal.ok ? 'autorizada' : 'erro') });
  if (!fiscal.ok && nota?.status !== 'autorizada') {
    return { vendaId, venda, nota, fiscal, totvs: { ok: false, mensagem: 'aguardando a NF-e ser autorizada' } };
  }

  // 2) documento interno na 990 (sem nota, sem financeiro) + atendimento
  let totvs;
  try {
    const r = await espelharVendaNoTotvs(vendaId, { forcar: true });
    totvs = { ok: true, ...r };
  } catch (err) {
    totvs = { ok: false, mensagem: err.message, code: err.code };
  }
  venda = await carregarVenda(vendaId);
  const atendida = venda.totvs_status === 4;
  await atualizar({
    transacao_code: venda.totvs_transacao_code || null,
    transacao_date: venda.totvs_transacao_date || null,
    transacao_status: venda.totvs_status || 1,
    totvs_erro: totvs.ok ? null : totvs.mensagem,
    ...(atendida ? { atendida_em: reg?.atendida_em || new Date().toISOString() } : {}),
  });

  // 3) solicitação acompanha: nota + transação atendida = concluída
  if (t.solicitacaoId) {
    await supabase
      .from('transferencias_mercadoria')
      .update({
        status: atendida ? 'concluida' : 'em_transferencia',
        venda_id: vendaId,
        nf_numero: nota?.numero ?? null,
        nf_chave: nota?.chave ?? null,
        transacao_code: venda.totvs_transacao_code || null,
        transacao_branch: EMPRESA_TOTVS_TRANSF,
        transacao_date: venda.totvs_transacao_date || null,
        transacao_status: venda.totvs_status || 1,
        transacao_total: venda.total,
        transacao_operacao: venda.operacao_doc_interno,
        transacao_qtd_epcs: (venda.itens || []).reduce((s, i) => s + (Array.isArray(i.epcs) ? i.epcs.length : 0), 0),
        transacao_por: venda.criado_por || null,
        ...(atendida ? { transacao_atendida_em: new Date().toISOString() } : {}),
        atualizado_em: new Date().toISOString(),
      })
      .eq('id', t.solicitacaoId);
  }
  return { vendaId, venda, nota, fiscal, totvs };
}

/** Recebe a conferência da tela, grava a venda e processa (nota + 990). */
export async function transferirComNota(b = {}) {
  await exigirColunas();
  if (!Number(b.vendedorCode)) throw new TransferenciaError('Escolha o vendedor', 'SEM_VENDEDOR');
  if (!Array.isArray(b.itens) || !b.itens.length) throw new TransferenciaError('Nenhuma peça conferida', 'SEM_ITENS');
  const sol = await solicitacaoDe(b.solicitacaoId);
  if (sol) {
    if (Number(sol.empresa_origem) !== EMPRESA_ORIGEM_NOTA) throw new TransferenciaError(`A nota pelo HeadCoach é só para transferência saindo da empresa ${EMPRESA_ORIGEM_NOTA}`, 'ORIGEM_NAO_ATENDIDA');
    if (sol.status === 'cancelada') throw new TransferenciaError('Solicitação cancelada', 'SOLICITACAO_CANCELADA');
    const ja = await notaDaSolicitacao(sol);
    if (ja) throw new TransferenciaError(`Esta solicitação já tem a NF-e ${ja.numero}/${ja.serie}. Para emitir de novo, cancele a nota.`, 'JA_EMITIDA', 409);
  }
  const ctx = await contexto(sol?.cliente_code || b.destinoClienteCode);
  const { emit, cliente, natureza, cen, operacoes } = ctx;
  if (!cen.contribuinte) throw new TransferenciaError(`A loja de destino (${cliente.nome}) está sem inscrição estadual no TOTVS`, 'DESTINO_SEM_IE');
  if (!cliente.endereco?.cMun || !cliente.endereco?.UF) throw new TransferenciaError(`A loja de destino (${cliente.nome}) está sem endereço completo no TOTVS`, 'DESTINO_SEM_ENDERECO');

  // itens + dados fiscais
  const itens = [];
  let seq = 1;
  for (const it of b.itens) {
    const q = Number(it.quantidade);
    const vUn = round2(it.valorUnit);
    if (!(q > 0) || !(vUn > 0)) throw new TransferenciaError(`Peça ${it.productCode}: quantidade ou valor inválido`, 'ITEM_INVALIDO');
    const pf = await buscarProdutoFiscal(it.productCode, EMPRESA_ORIGEM_NOTA);
    itens.push({
      seq: seq++,
      product_code: Number(it.productCode),
      sku: pf.sku,
      nome: String(pf.nome || it.nome || `Produto ${it.productCode}`).slice(0, 200),
      referencia: pf.referencia,
      ncm: pf.ncm,
      cest: pf.cest,
      origem: pf.origem,
      unidade: pf.unidade,
      quantidade: q,
      valor_unit: vUn,
      desconto_unit: 0,
      total: round2(q * vUn),
      epcs: Array.isArray(it.epcs) ? it.epcs : [],
    });
  }
  const tipos = await tiposFiscais(EMPRESA_ORIGEM_NOTA, itens);
  for (const it of itens) {
    it.tipo_fiscal = tipos.get(it.product_code) || 'producao';
    it.cfop = cfopTransferencia(cen.chave, it.tipo_fiscal, natureza);
  }
  const total = round2(itens.reduce((s, i) => s + i.total, 0));
  const qtd = itens.reduce((s, i) => s + i.quantidade, 0);
  const ref = sol?.origem_ref || (sol ? `TRF-${sol.id}` : null);
  const destinoNome = ctx.filial?.nome || cliente.nome;

  const cabecalho = {
    empresa: EMPRESA_ORIGEM_NOTA,
    empresa_cnpj: emit.cnpj,
    empresa_nome: emit.xNome,
    tipo_venda: 'nfe',
    operacao: null,
    cliente_code: cliente.code,
    cliente_nome: cliente.nome,
    cliente_cpf_cnpj: cliente.cnpj,
    vendedor_code: Number(b.vendedorCode),
    vendedor_nome: b.vendedorNome || null,
    qtd_pecas: qtd,
    subtotal: total,
    desconto: 0,
    cashback_usado: 0,
    total,
    status: 'registrada',
    observacao: b.observacao || null,
    criado_por: b.por || null,
    origem: 'expedicao',
    canal: 'transferencia',
    pedido_chave: null,
    numero_site: ref,
    data_caixa: hojeBrasil(),
    operacao_doc_interno: operacoes.docInterno,
    frete: 0,
    transporte: null,
    cobranca: null,
    comprovantes: [],
    pedido_info: {
      transferencia: { natureza, ref, solicitacaoId: sol?.id || null, destinoCode: ctx.filial?.code ?? null, destinoNome, operacaoNota: operacoes.nota },
      empresaTotvs: EMPRESA_TOTVS_TRANSF,
      terminal: Number(b.terminal) > 0 ? Number(b.terminal) : null,
    },
  };
  const { data: venda, error } = await supabase.from('pdv_vendas').insert(cabecalho).select().single();
  if (error) throw new TransferenciaError(error.message, 'DB_ERROR', 500);
  const { data: itensGravados, error: e1 } = await supabase.from('pdv_venda_itens').insert(itens.map((i) => ({ ...i, venda_id: venda.id }))).select();
  if (e1) {
    await supabase.from('pdv_vendas').delete().eq('id', venda.id);
    throw new TransferenciaError(e1.message, 'DB_ERROR', 500);
  }
  await registrarEpcs({ venda, itens: itensGravados || [], tipo: 'venda' });

  // registro da aba Transações (acompanha nota e transação da 990)
  const { error: e2 } = await supabase.from('transferencias_transacoes').insert({
    transferencia_id: sol?.id || null,
    empresa: EMPRESA_ORIGEM_NOTA,
    empresa_destino: ctx.filial?.code ?? 0,
    empresa_totvs: EMPRESA_TOTVS_TRANSF,
    venda_id: venda.id,
    natureza,
    transacao_code: null,
    transacao_status: 1,
    operacao: operacoes.docInterno,
    cfop: itens[0]?.cfop || null,
    total,
    qtd_pecas: qtd,
    qtd_epcs: itens.reduce((s, i) => s + i.epcs.length, 0),
    qtd_faltando: (b.faltando || []).reduce((s, x) => s + (Number(x.quantidade) || 0), 0),
    qtd_sobrando: (b.sobrando || []).reduce((s, x) => s + (Number(x.quantidade) || 0), 0),
    cliente_code: cliente.code,
    cliente_nome: destinoNome,
    vendedor_code: Number(b.vendedorCode),
    vendedor_nome: b.vendedorNome || null,
    itens: itens.map((i) => ({ productCode: i.product_code, name: i.nome, quantidade: i.quantidade, unit: i.valor_unit, total: i.total, cfop: i.cfop, epcs: i.epcs })),
    criado_por: b.por || null,
  });
  if (e2) console.warn(`⚠️ [transferência] venda ${venda.id}: não gravei o registro da aba Transações: ${e2.message}`);
  if (sol) await supabase.from('transferencias_mercadoria').update({ status: 'em_transferencia', venda_id: venda.id, atualizado_em: new Date().toISOString() }).eq('id', sol.id);
  console.log(`🔁 [transferência] ${ref || 'avulsa'}: 99 → ${ctx.filial?.code ?? cliente.code} ${destinoNome} · ${qtd} pç · R$ ${total.toFixed(2)} · ${natureza} (990 op ${operacoes.docInterno}) · venda ${venda.id}`);
  return processarTransferenciaNota(venda.id);
}
