// ============================================================================
// TRANSFERÊNCIA SAINDO DA EXPEDIÇÃO (empresa 99) COM A NOTA PELO HEADCOACH
// (Yago, 11/11/2026). Mesmo desenho do faturamento da expedição:
//   1. a tela de Transferências traz as peças do pedido (o "carrinho") e o
//      portal RFID confere; só o que foi conferido entra;
//   2. a NF-e de transferência sai pelo HeadCoach (empresa 99, série 3), no
//      padrão das notas que a 99 emitia pelo TOTVS (services/pdvFiscal.js):
//        destino da MESMA raiz de CNPJ → transferência (op 8400, CFOP 5151/5152)
//        destino de OUTRA raiz        → venda entre filiais (op 8405, CFOP 5101/5102)
//   3. a transferência fica registrada SÓ NO HEADCOACH (Yago, 11/11/2026): não
//      há mais transação no TOTVS. A primeira versão abria um documento interno
//      na empresa 990 (operações 8401/8404), mas a API do TOTVS não finaliza
//      transferência (exige forma de recebimento) e as transações ficavam
//      abertas. Nota autorizada = transferência concluída.
// A venda fica em pdv_vendas (origem 'expedicao', canal 'transferencia',
// pedido_info.transferencia) para reaproveitar emissão, numeração, DANFE,
// cancelamento e espelho. O acompanhamento fica em transferencias_transacoes
// (aba Transações da página) e na solicitação (transferencias_mercadoria).
// Transferência de outra empresa continua no fluxo antigo (TRAFP005).
//
// MESMO ESTOQUE (Yago, 25/11/2026): Brejinho (99, CNPJ final 0010-07) e Matriz (1, CNPJ final
// 0001-16) são o mesmo estoque em dois CNPJs. Entre os dois, em qualquer sentido, a transferência
// NÃO movimenta o fiscal: grava a transação e a saída das peças, SEM NF-e
// (pedido_info.transferencia.semNota; registro com nf_status 'sem_nota' e já atendido).
// ============================================================================
import supabase from '../config/supabase.js';
import { listarFiliaisPop, raizCnpj, TransferenciaError } from './transferenciasMercadoria.js';
import { buscarEmitente, buscarClienteFiscal, buscarProdutoFiscal, buscarConfig, tiposFiscais, cenarioExpedicao, cfopTransferencia } from './pdvFiscal.js';
import { acertarNumeracao } from './faturamentoExpedicao.js';
import { emitirVendaPdv, registrarEpcs, carregarVenda } from '../routes/pdvCrosby.routes.js';

export const EMPRESA_ORIGEM_NOTA = 99;
// Brejinho ↔ Matriz: mesmo estoque, transferência sem nota fiscal (ver o topo)
export const PAR_MESMO_ESTOQUE = [99, 1];
// origens aceitas por esta tela: a 99 (para qualquer destino) e a Matriz (só para o Brejinho, sem nota)
export const ORIGENS_ACEITAS = [99, 1];
export const mesmoEstoque = (a, b) => PAR_MESMO_ESTOQUE.includes(Number(a)) && PAR_MESMO_ESTOQUE.includes(Number(b)) && Number(a) !== Number(b);
const origemValida = (code) => {
  const n = Number(code) || EMPRESA_ORIGEM_NOTA;
  if (!ORIGENS_ACEITAS.includes(n)) throw new TransferenciaError(`Por esta tela a transferência sai da empresa ${EMPRESA_ORIGEM_NOTA} (ou da Matriz para o Brejinho)`, 'ORIGEM_NAO_ATENDIDA');
  return n;
};
// nota: operação que a 99 usava no TOTVS (só referência, define a natureza da NF-e) ·
// docInterno: a que ia para a 990 quando havia transação no TOTVS (não é mais usada)
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

// Origem (99, ou a Matriz), destino (filial ou pessoa informada) e a natureza pela raiz do CNPJ
async function contexto(destinoClienteCode, origemCode = EMPRESA_ORIGEM_NOTA) {
  const origem = origemValida(origemCode);
  const pessoa = Number(destinoClienteCode);
  if (!(pessoa > 0)) throw new TransferenciaError('Informe a loja de destino', 'SEM_DESTINO');
  const [emit, filiais, cliente] = await Promise.all([buscarEmitente(origem), listarFiliaisPop().catch(() => []), buscarClienteFiscal(pessoa)]);
  if (!cliente) throw new TransferenciaError(`Cliente ${pessoa} (loja de destino) não encontrado no TOTVS`, 'DESTINO_NAO_ENCONTRADO', 404);
  if (!cliente.cnpj) throw new TransferenciaError(`O destino ${cliente.nome} não tem CNPJ no TOTVS: transferência é só entre empresas`, 'DESTINO_SEM_CNPJ');
  const filial = filiais.find((f) => Number(f.personCode) === pessoa) || null;
  if (filial && Number(filial.code) === origem) throw new TransferenciaError(`A loja de destino é a própria origem (${origem})`, 'MESMA_EMPRESA');
  // Loja própria fora dos grupos do POP (ex.: 98 Shopping Recife, que recebe VENDA):
  // não é "filial" para a regra da operação, mas a nota guarda o código dela para
  // a loja ver a mercadoria em Recebimento de Mercadoria.
  let empresaDestino = filial ? Number(filial.code) : null;
  if (!empresaDestino) {
    const { data: emp } = await supabase.from('erp_empresas').select('code').eq('person_code', pessoa).eq('propria', true).order('code').limit(1);
    empresaDestino = emp?.[0]?.code ? Number(emp[0].code) : null;
  }
  if (empresaDestino === origem) throw new TransferenciaError(`A loja de destino é a própria origem (${origem})`, 'MESMA_EMPRESA');
  const natureza = raizCnpj(cliente.cnpj) === raizCnpj(emit.cnpj) ? 'transferencia' : 'venda';
  // Brejinho ↔ Matriz: mesmo estoque, sem nota fiscal
  const semNota = mesmoEstoque(origem, empresaDestino);
  if (origem !== EMPRESA_ORIGEM_NOTA && !semNota) {
    throw new TransferenciaError(`Saindo da empresa ${origem} (Matriz), por esta tela, só a movimentação para o Brejinho (${EMPRESA_ORIGEM_NOTA})`, 'ORIGEM_NAO_ATENDIDA');
  }
  const cen = cenarioExpedicao({ emitUf: emit.uf, cliente });
  return { origem, emit, cliente, filial, empresaDestino, natureza, cen, semNota, operacoes: OPERACOES_TRANSF_NOTA[natureza] };
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
  // movimentação entre estoques (sem nota): a transação registrada já conta
  if (venda.pedido_info?.transferencia?.semNota && venda.status === 'autorizada') return { vendaId: venda.id, semNota: true, numero: null, serie: null, chave: null };
  const nota = venda.notas.find((n) => n.status === 'autorizada');
  return nota ? { vendaId: venda.id, numero: nota.numero, serie: nota.serie, chave: nota.chave, totvsStatus: venda.totvs_status, transacao: venda.totvs_transacao_code } : null;
}

/** O que a tela precisa antes de ler as peças. */
export async function prepararTransferenciaNota({ solicitacaoId = null, destinoClienteCode = null, origem = null } = {}) {
  await exigirColunas();
  const sol = await solicitacaoDe(solicitacaoId);
  const origemCode = origemValida(sol ? sol.empresa_origem : origem);
  const pessoa = sol?.cliente_code || destinoClienteCode;
  const ctx = await contexto(pessoa, origemCode);
  // sem nota (Brejinho ↔ Matriz): não precisa de numeração nem do cadastro fiscal completo do destino
  const cfg = ctx.semNota ? null : await buscarConfig(origemCode);
  const pendencias = [];
  if (!ctx.semNota) {
    if (!ctx.cliente.endereco?.cMun || !ctx.cliente.endereco?.UF) pendencias.push(`A loja de destino (${ctx.cliente.nome}) está sem endereço completo no TOTVS.`);
    if (!ctx.cen.contribuinte) pendencias.push(`A loja de destino (${ctx.cliente.nome}) está sem inscrição estadual no TOTVS.`);
  }
  return {
    semNota: ctx.semNota,
    origem: { code: origemCode, nome: ctx.emit.xFant || ctx.emit.xNome, cnpj: ctx.emit.cnpj, uf: ctx.emit.uf },
    destino: {
      personCode: ctx.cliente.code,
      code: ctx.filial?.code ?? ctx.empresaDestino ?? null,
      nome: ctx.filial?.nome || ctx.cliente.nome,
      razao: ctx.cliente.nome,
      cnpj: ctx.cliente.cnpj,
      ie: ctx.cliente.ie || null,
      uf: ctx.cliente.endereco?.UF || null,
      cidade: ctx.cliente.endereco?.xMun || null,
      foraDoPop: !ctx.filial,
    },
    natureza: ctx.natureza,
    naturezaNome: ctx.semNota ? 'Movimentação entre estoques (sem nota fiscal)' : ctx.operacoes.nome,
    operacaoNota: ctx.semNota ? null : ctx.operacoes.nota,
    semTotvs: true,
    cenario: ctx.semNota
      ? { chave: 'mesmoEstoque', texto: 'Brejinho e Matriz são o mesmo estoque: sem nota fiscal', cfops: [] }
      : { chave: ctx.cen.chave, texto: CENARIO_TXT[ctx.cen.chave] || ctx.cen.chave, cfops: ctx.cen.contribuinte ? [cfopTransferencia(ctx.cen.chave, 'producao', ctx.natureza), cfopTransferencia(ctx.cen.chave, 'adquirido', ctx.natureza)] : [] },
    numeracao: cfg ? { serie: cfg.serie_nfe, ambiente: cfg.ambiente } : null,
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
 * Emite a NF-e (se ainda não saiu) e atualiza o registro e a solicitação: com a
 * nota autorizada a transferência está concluída (não há transação no TOTVS).
 * Pode ser chamado de novo.
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

  // Brejinho ↔ Matriz: mesmo estoque, sem nota fiscal — a transação registrada já é a transferência
  if (t.semNota) {
    const agora0 = new Date().toISOString();
    if (venda.status !== 'cancelada' && venda.status !== 'autorizada') {
      await supabase.from('pdv_vendas').update({ status: 'autorizada' }).eq('id', vendaId);
      venda = await carregarVenda(vendaId);
    }
    await atualizar({ nota_id: null, nf_numero: null, nf_serie: null, nf_chave: null, nf_status: 'sem_nota', transacao_status: 4, totvs_erro: null, atendida_em: reg?.atendida_em || agora0 });
    if (t.solicitacaoId) {
      await supabase
        .from('transferencias_mercadoria')
        .update({
          status: 'concluida',
          venda_id: vendaId,
          nf_numero: null,
          nf_chave: null,
          transacao_status: 4,
          transacao_total: venda.total,
          transacao_qtd_epcs: (venda.itens || []).reduce((s, i) => s + (Array.isArray(i.epcs) ? i.epcs.length : 0), 0),
          transacao_por: venda.criado_por || null,
          transacao_atendida_em: agora0,
          atualizado_em: agora0,
        })
        .eq('id', t.solicitacaoId);
    }
    return {
      vendaId,
      venda,
      nota: null,
      fiscal: { ok: true, semNota: true, mensagem: 'Movimentação entre estoques registrada — sem nota fiscal' },
      totvs: { ok: true, semTotvs: true, mensagem: 'registrada só no HeadCoach' },
    };
  }

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
    return { vendaId, venda, nota, fiscal, totvs: { ok: false, semTotvs: true, mensagem: 'aguardando a NF-e ser autorizada' } };
  }

  // 2) sem TOTVS: a nota autorizada conclui a transferência. `totvs` continua na
  // resposta só para a tela antiga não acusar pendência.
  const agora = new Date().toISOString();
  const totvs = { ok: true, semTotvs: true, mensagem: 'registrada só no HeadCoach (sem transação no TOTVS)' };
  await atualizar({ transacao_status: 4, totvs_erro: null, atendida_em: reg?.atendida_em || agora });

  // 3) solicitação acompanha: nota autorizada = concluída
  if (t.solicitacaoId) {
    await supabase
      .from('transferencias_mercadoria')
      .update({
        status: 'concluida',
        venda_id: vendaId,
        nf_numero: nota?.numero ?? null,
        nf_chave: nota?.chave ?? null,
        transacao_status: 4,
        transacao_total: venda.total,
        transacao_qtd_epcs: (venda.itens || []).reduce((s, i) => s + (Array.isArray(i.epcs) ? i.epcs.length : 0), 0),
        transacao_por: venda.criado_por || null,
        transacao_atendida_em: agora,
        atualizado_em: agora,
      })
      .eq('id', t.solicitacaoId);
  }
  return { vendaId, venda, nota, fiscal, totvs };
}

/** Recebe a conferência da tela, grava a venda e emite a nota. */
export async function transferirComNota(b = {}) {
  await exigirColunas();
  if (!Number(b.vendedorCode)) throw new TransferenciaError('Escolha o vendedor', 'SEM_VENDEDOR');
  if (!Array.isArray(b.itens) || !b.itens.length) throw new TransferenciaError('Nenhuma peça conferida', 'SEM_ITENS');
  const sol = await solicitacaoDe(b.solicitacaoId);
  const origemCode = origemValida(sol ? sol.empresa_origem : b.origem);
  if (sol) {
    if (sol.status === 'cancelada') throw new TransferenciaError('Solicitação cancelada', 'SOLICITACAO_CANCELADA');
    const ja = await notaDaSolicitacao(sol);
    if (ja?.semNota) throw new TransferenciaError(`Esta solicitação já foi registrada (transação nº ${ja.vendaId}). Para refazer, cancele a transação.`, 'JA_EMITIDA', 409);
    if (ja) throw new TransferenciaError(`Esta solicitação já tem a NF-e ${ja.numero}/${ja.serie}. Para emitir de novo, cancele a nota.`, 'JA_EMITIDA', 409);
  }
  const ctx = await contexto(sol?.cliente_code || b.destinoClienteCode, origemCode);
  const { emit, cliente, natureza, cen, operacoes, semNota } = ctx;
  if (!semNota) {
    if (!cen.contribuinte) throw new TransferenciaError(`A loja de destino (${cliente.nome}) está sem inscrição estadual no TOTVS`, 'DESTINO_SEM_IE');
    if (!cliente.endereco?.cMun || !cliente.endereco?.UF) throw new TransferenciaError(`A loja de destino (${cliente.nome}) está sem endereço completo no TOTVS`, 'DESTINO_SEM_ENDERECO');
  }

  // itens + dados fiscais
  const itens = [];
  let seq = 1;
  for (const it of b.itens) {
    const q = Number(it.quantidade);
    const vUn = round2(it.valorUnit);
    if (!(q > 0) || !(vUn > 0)) throw new TransferenciaError(`Peça ${it.productCode}: quantidade ou valor inválido`, 'ITEM_INVALIDO');
    // sem nota: os dados fiscais da peça não são exigidos (servem só para nome e SKU)
    const pf = semNota
      ? await buscarProdutoFiscal(it.productCode, origemCode).catch(() => ({ sku: it.sku || null, nome: it.nome || null, referencia: null, ncm: null, cest: null, origem: null, unidade: null }))
      : await buscarProdutoFiscal(it.productCode, origemCode);
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
  if (!semNota) {
    const tipos = await tiposFiscais(origemCode, itens);
    for (const it of itens) {
      it.tipo_fiscal = tipos.get(it.product_code) || 'producao';
      it.cfop = cfopTransferencia(cen.chave, it.tipo_fiscal, natureza);
    }
  }
  const total = round2(itens.reduce((s, i) => s + i.total, 0));
  const qtd = itens.reduce((s, i) => s + i.quantidade, 0);
  const ref = sol?.origem_ref || (sol ? `TRF-${sol.id}` : null);
  const destinoNome = ctx.filial?.nome || cliente.nome;

  const cabecalho = {
    empresa: origemCode,
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
    operacao_doc_interno: null,
    frete: 0,
    transporte: null,
    cobranca: null,
    comprovantes: [],
    pedido_info: {
      transferencia: { natureza, ref, solicitacaoId: sol?.id || null, destinoCode: ctx.filial?.code ?? ctx.empresaDestino ?? null, destinoNome, operacaoNota: semNota ? null : operacoes.nota, ...(semNota ? { semNota: true } : {}) },
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

  // registro da aba Transações (acompanha a nota; não há transação no TOTVS)
  const { error: e2 } = await supabase.from('transferencias_transacoes').insert({
    transferencia_id: sol?.id || null,
    empresa: origemCode,
    empresa_destino: ctx.filial?.code ?? ctx.empresaDestino ?? 0,
    empresa_totvs: null,
    venda_id: venda.id,
    natureza,
    transacao_code: null,
    transacao_status: 1,
    operacao: semNota ? null : operacoes.nota,
    cfop: itens[0]?.cfop || null,
    ...(semNota ? { nf_status: 'sem_nota' } : {}),
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
  console.log(`🔁 [transferência] ${ref || 'avulsa'}: ${origemCode} → ${ctx.filial?.code ?? ctx.empresaDestino ?? cliente.code} ${destinoNome} · ${qtd} pç · R$ ${total.toFixed(2)} · ${semNota ? 'mesmo estoque, SEM NOTA' : natureza} · só HeadCoach · venda ${venda.id}`);
  return processarTransferenciaNota(venda.id);
}
