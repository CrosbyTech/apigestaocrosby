// =============================================================================
// HEADCOACH › FINANCEIRO › LIBERAÇÃO DE PAGAMENTO — SAÍDAS DO BANCO SEM BAIXA.
// Pedido do Yago (27/11/2026): "todo pagamento deve ser linkado a uma linha e dado
// baixa automática"; na aba INCLUÍDOS aparecem as SAÍDAS dos bancos que não têm
// baixa nem inclusão, para ele escolher a duplicata que casa com a saída ou gerar
// a duplicata que casa com ela.
//
// Nada de regra nova de conciliação aqui: usa as mesmas peças da tela Conciliação.
//   • a lista = as saídas PENDENTES da Conciliação (tarifasConciliacao.saidasPendentes),
//     com a sugestão de fornecedor e despesa pelo histórico, menos as que a baixa
//     automática já casa sozinha com uma duplicata incluída;
//   • CASAR = gravar a conciliação da saída com a duplicata do Contas a Pagar
//     HeadCoach (origem HC_CP): é a conciliação que dá a baixa — valor igual quita;
//     saída maior entra com a diferença como juros e multa; saída menor é baixa
//     parcial; duplicata de PREVISÃO passa a valer o valor da saída;
//   • GERAR = criar a duplicata pela própria saída (criarDuplicatasTarifas), já
//     conciliada e baixada;
//   • SOLICITAÇÃO CROSBY (27/11/2026): a janela mostra as solicitações de todos os
//     status; escolhida uma, o sistema aprova (gestor e financeiro, no nome de quem
//     clicou), envia ao Contas a Pagar HeadCoach e casa a saída com a duplicata;
//   • CONTAS A PAGAR DO TOTVS: o título escolhido vira duplicata no HeadCoach (sem
//     passar pela Liberação) e é casado com a saída.
// Como na Conciliação, não pede senha (decisão do Yago, 24/11/2026: a baixa que
// vem da conciliação do extrato não precisa); a tela confirma antes de gravar.
// =============================================================================
import supabase from '../config/supabase.js';
import { CpError, empresasPermitidas, editarTitulo, rotuloDuplicata } from './hcContasPagar.js';
import { incluidasDoUsuario } from './hcCpLiberacao.js';
import { nomeScore } from './conciliacaoAprovados.js';
import { salvarConciliacao, lancamentoComChave, atribuirChaves } from './fluxoCaixaConciliacao.js';
import { saidasPendentesComSugestao, criarDuplicatasTarifas } from './tarifasConciliacao.js';
import { enviarSolicitacaoAoCp } from './solicitacaoContasPagar.js';
import { enviarDoTotvsParaLiberacao } from './hcCpDoTotvs.js';
import { ORIGEM_SOLICITACAO } from '../utils/solicitacaoCp.js';
import { motivoDeNaoEnviarDaqui, tituloParaCasar, acaoDaSolicitacao, ROTULO_STATUS_SOLICITACAO } from '../utils/hcCpSaidasSemBaixa.js';
import { casarIncluidos, janelaDosExtratos, bancoDaConta, addDias } from '../utils/hcCpBaixaAutomatica.js';
import { titulosHcDaConciliacao } from '../utils/hcCpComprovante.js';
import { candidatasDaSaida, planoDeCasamento, faltaEmCentavos } from '../utils/hcCpSaidasSemBaixa.js';

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const dig = (v) => String(v ?? '').replace(/\D+/g, '');
const ehData = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const hojeBrasil = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Recife' }).format(new Date());
const quem = (user) => user?.name || user?.email || null;
const brl = (v) => Number(v).toFixed(2).replace('.', ',');
const CAMPOS_TITULO = 'id, empresa, fornecedor_code, fornecedor_nome, fornecedor_cpf_cnpj, duplicata, parcela, documento_fiscal, despesa_code, despesa_nome, centro_custo_nome, emissao, vencimento, valor, valor_pago, juros, multa, desconto, situacao, previsao';

async function q(promessa) {
  const { data, error } = await promessa;
  if (error) throw new CpError(`Banco de dados: ${error.message}`, 'DB_ERROR', 500);
  return data;
}
async function todas(montar) {
  const out = [];
  for (let de = 0; ; de += 1000) {
    const lote = await q(montar().range(de, de + 999));
    out.push(...(lote || []));
    if (!lote || lote.length < 1000) break;
  }
  return out;
}
const tituloDaTela = (t, extra = {}) => ({ tituloId: t.id, empresa: t.empresa, fornecedor: t.fornecedor_nome, rotulo: rotuloDuplicata(t), documento: t.documento_fiscal || null, despesa: t.despesa_nome || null, vencimento: String(t.vencimento).slice(0, 10), valor: Number(t.valor), falta: faltaEmCentavos(t) / 100, previsao: t.previsao === 'previsao', ...extra });

/**
 * Baixas do contas a pagar que saíram de banco e NÃO têm linha do extrato ligada (conferência:
 * com o pagamento manual desligado isso só deve acontecer em baixa direta no Contas a Pagar).
 */
async function baixasSemLinha({ de }) {
  const baixas = await todas(() => supabase.from('hc_cp_baixas').select('id, titulo_id, data_pagamento, valor_pago, conta, forma_pagamento, por').gte('data_pagamento', de).gt('valor_pago', 0).order('id'));
  if (!baixas.length) return [];
  const ids = [...new Set(baixas.map((b) => b.titulo_id))];
  const titulos = [];
  for (let i = 0; i < ids.length; i += 200) titulos.push(...(await q(supabase.from('hc_cp_titulos').select('id, empresa, fornecedor_nome, duplicata, parcela, origem').in('id', ids.slice(i, i + 200)))));
  const tit = new Map(titulos.map((t) => [t.id, t]));
  const conc = await todas(() => supabase.from('fluxo_caixa_conciliacoes').select('id, origem, referencia').gte('data', addDias(de, -10)).in('origem', ['HC_CP', 'MANUAL', 'MULTIPLO']).order('id'));
  const ligados = new Set(conc.flatMap((c) => titulosHcDaConciliacao(c)));
  // dinheiro, cartão e as importadas já pagas do TOTVS não passam por linha de extrato daqui
  return baixas
    .filter((b) => {
      const t = tit.get(b.titulo_id);
      return t && !['totvs', 'replica-totvs'].includes(t.origem) && !['dinheiro', 'cartao'].includes(b.forma_pagamento) && !ligados.has(t.id);
    })
    .map((b) => ({ baixaId: b.id, data: String(b.data_pagamento).slice(0, 10), valor: Number(b.valor_pago), conta: b.conta || null, por: b.por || null, fornecedor: tit.get(b.titulo_id).fornecedor_nome, rotulo: rotuloDuplicata(tit.get(b.titulo_id)), empresa: tit.get(b.titulo_id).empresa }));
}

/**
 * Saídas do banco sem baixa nem inclusão, com as duplicatas que podem casar e a sugestão para gerar.
 * f: { de? (AAAA-MM-DD; padrão: 30 dias para trás) }
 */
export async function saidasSemBaixa(user, f = {}) {
  const { codes } = await empresasPermitidas(user); // só o financeiro
  const hoje = hojeBrasil();
  const padrao = janelaDosExtratos(hoje);
  const periodo = { de: ehData(f.de) && f.de <= hoje ? f.de : padrao.de, ate: hoje };
  let itens;
  try {
    itens = await saidasPendentesComSugestao(periodo);
  } catch (e) {
    throw new CpError(`Não consegui ler as saídas pendentes dos extratos: ${e.message}`, 'EXTRATOS', 500);
  }
  // as que a baixa automática já casa sozinha com uma duplicata INCLUÍDA ficam com ela
  const incluidas = await incluidasDoUsuario(user);
  const comoSaida = itens.map((i) => ({ id: i.id, conta_id: i.contaId, data: i.data, valor: -Math.abs(i.valor), contraparte_nome: i.contraparte, contraparte_doc: i.contraparteDoc, memo: i.memo }));
  const { casadas } = casarIncluidos(incluidas, comoSaida, { pontuar: nomeScore });
  const daBaixaAutomatica = new Set(casadas.map((c) => c.saida.id));

  const abertos = codes.length ? await todas(() => supabase.from('hc_cp_titulos').select(CAMPOS_TITULO).eq('situacao', 'aberto').in('empresa', codes).order('id')) : [];
  const emLiberacao = new Map((await todas(() => supabase.from('hc_cp_liberacoes').select('id, titulo_id, status').in('status', ['pendente', 'previsao', 'aprovado', 'incluido']).order('id'))).map((l) => [Number(l.titulo_id), l.status]));

  const saidas = itens
    .filter((i) => !daBaixaAutomatica.has(i.id))
    .map((i) => {
      const candidatas = candidatasDaSaida(i, abertos, nomeScore).map((c) => tituloDaTela(c.titulo, { tipo: c.tipo, acrescimo: round2(c.acrescimo), mesmoFornecedor: c.mesmoFornecedor, liberacao: emLiberacao.get(Number(c.titulo.id)) || null }));
      return {
        lancamentoId: i.id,
        chave: i.chave || null, // a tela devolve junto: se o extrato for reimportado, o servidor acha a linha por ela
        data: i.data,
        valor: i.valor,
        banco: bancoDaConta({ banco: i.banco, apelido: i.conta, titular_cnpj: i.cnpj }),
        conta: i.conta,
        empresa: i.empresa,
        para: i.contraparte || i.memo || i.descricao || null,
        memo: i.memo || i.descricao || null,
        forma: i.forma || null,
        tarifa: Boolean(i.tarifa),
        sugestao: i.sugestao || null, // fornecedor e despesa pelo histórico, para GERAR a duplicata
        candidatas, // duplicatas em aberto que podem casar (a primeira é a sugerida)
      };
    })
    .sort((a, b) => String(b.data).localeCompare(String(a.data)) || b.valor - a.valor);
  let conferencia = [];
  try {
    conferencia = await baixasSemLinha({ de: periodo.de });
  } catch (e) {
    console.warn(`[saídas sem baixa] conferência de vínculos falhou: ${e.message}`);
  }
  return { periodo, saidas, total: round2(saidas.reduce((s, x) => s + x.valor, 0)), comSugestao: saidas.filter((x) => x.candidatas.some((c) => c.mesmoFornecedor)).length, naBaixaAutomatica: daBaixaAutomatica.size, baixasSemLinha: conferencia };
}

/**
 * A linha do extrato pelo id; se o id não existe mais (o extrato é reimportado de hora em hora e os
 * ids mudam), pela CHAVE estável da linha (conta|data|valor|memo|n), que a tela manda junto.
 */
async function linhaDoExtrato(lancamentoId, chave) {
  try {
    return await lancamentoComChave(Number(lancamentoId));
  } catch (e) {
    const partes = String(chave || '').split('|');
    if (partes.length < 5) throw new CpError('Esta linha do extrato mudou (o extrato foi reimportado): clique em ATUALIZAR na lista das saídas', 'SAIDA', 404);
    const [conta, data, valor] = partes;
    const irmaos = await q(supabase.from('fluxo_caixa_lancamentos').select('id,conta_id,data,valor,seq,memo,descricao').eq('conta_id', Number(conta)).eq('data', data).eq('valor', Number(valor)));
    atribuirChaves(irmaos || []);
    const achada = (irmaos || []).find((x) => x.chave === chave);
    if (!achada) throw new CpError('Esta linha do extrato não existe mais (o extrato foi reimportado e ela mudou): clique em ATUALIZAR na lista das saídas', 'SAIDA', 404);
    return lancamentoComChave(achada.id);
  }
}

/** A saída do extrato, conferida: é saída, não é transferência entre contas e ainda não está conciliada. */
async function saidaLivre(lancamentoId, chave = null) {
  const l = await linhaDoExtrato(lancamentoId, chave);
  if (!(Number(l.valor) < 0) || l.transferencia_id || l.tipo === 'TRANSFERENCIA') throw new CpError('Só saída do banco que não seja transferência entre contas pode ser casada', 'SAIDA', 409);
  if (!l.chave) throw new CpError('Não consegui identificar esta linha do extrato', 'SAIDA', 409);
  const ja = await q(supabase.from('fluxo_caixa_conciliacoes').select('id').eq('chave', l.chave).maybeSingle());
  if (ja) throw new CpError('Esta saída já está conciliada (outra pessoa pode ter casado agora)', 'JA_CONCILIADA', 409);
  return l;
}

/**
 * CASAR a saída com uma duplicata em aberto: concilia a saída com ela, e a conciliação dá a baixa.
 * b: { lancamentoId, tituloId }
 * @returns {{ conciliacaoId, tipo, pago, juros, resta, titulo, aviso }}
 */
export async function casarSaida(user, b = {}) {
  const { codes } = await empresasPermitidas(user);
  const l = await saidaLivre(b.lancamentoId, b.chave);
  let t = await q(supabase.from('hc_cp_titulos').select('*').eq('id', Number(b.tituloId)).maybeSingle());
  if (!t) throw new CpError('Duplicata não encontrada', 'NOT_FOUND', 404);
  if (!codes.includes(Number(t.empresa))) throw new CpError(`Você não tem acesso à empresa ${t.empresa}`, 'SEM_PERMISSAO', 403);
  const saida = round2(Math.abs(Number(l.valor)));
  const plano = planoDeCasamento(saida, t);
  if (plano.erro) throw new CpError(`Não dá para casar: ${plano.erro}`, 'NAO_CASA', 409);
  const por = quem(user);
  const rotulo = rotuloDuplicata(t);
  // previsão: o valor da duplicata era só a marcação — passa a ser o que saiu do banco
  if (plano.trocaValor != null) t = await editarTitulo(user, t.id, { valor: plano.trocaValor, previsao: 'real' });
  const como = plano.tipo === 'acrescimo' ? ` (pago com R$ ${brl(plano.juros)} de juros e multa)` : plano.tipo === 'parcial' ? ` (pagamento parcial; ficam R$ ${brl(plano.resta)} em aberto)` : plano.tipo === 'previsao' ? ' (era previsão: o valor da duplicata passou a ser o da saída)' : '';
  let conc;
  try {
    conc = await salvarConciliacao({
      lancamentoId: l.id,
      origem: 'HC_CP',
      referencia: {
        id: String(t.id),
        nome: t.fornecedor_nome,
        doc: dig(t.fornecedor_cpf_cnpj) || null,
        valor: round2(t.valor),
        valorDuplicata: round2(Number(t.valor) + plano.juros), // o que esta duplicata pode cobrir de saída (com o acréscimo)
        ...(plano.juros ? { valorPago: saida } : {}),
        data: l.data,
        vencimento: t.vencimento,
        emissao: t.emissao,
        empresa: `Empresa ${t.empresa}`,
        duplicata: `${t.duplicata}|${t.parcela}`,
        detalhe: [t.despesa_nome, `dup ${rotulo}`, t.documento_fiscal ? `doc ${t.documento_fiscal}` : null, 'Contas a Pagar HeadCoach'].filter(Boolean).join(' · '),
        motivos: ['escolhida na Liberação de Pagamento (saída do banco sem baixa)'],
        casadaPor: por,
      },
      justificativa: `${t.fornecedor_nome} · duplicata ${rotulo} — saída casada na Liberação de Pagamento por ${por || 'usuário'}${como}`,
      usuario: por,
      automatico: false,
    });
  } catch (e) {
    if (e instanceof CpError) throw e;
    throw new CpError(`A conciliação recusou: ${e.message}`, 'CONCILIACAO', 409);
  }
  // a conciliação dá a baixa (marca [conc N] na observação); confere se entrou
  const depois = await q(supabase.from('hc_cp_titulos').select(CAMPOS_TITULO).eq('id', t.id).maybeSingle());
  const baixa = await q(supabase.from('hc_cp_baixas').select('id').eq('titulo_id', t.id).ilike('observacao', `%[conc ${conc.id}]%`).limit(1));
  const aviso = baixa?.length ? null : 'a saída ficou conciliada, mas não achei a baixa gravada na duplicata: confira no Contas a Pagar';
  console.log(`🏦 [liberação · saída sem baixa] saída ${l.id} (${l.data} · R$ ${brl(saida)}) casada com ${t.fornecedor_nome} ${rotulo}${como} · ${por}`);
  return { conciliacaoId: conc.id, tipo: plano.tipo, pago: plano.pago, juros: plano.juros, resta: plano.resta, titulo: tituloDaTela(depois || t, { situacao: depois?.situacao || t.situacao }), aviso };
}

/**
 * GERAR a duplicata que casa com a saída: nasce no Contas a Pagar HeadCoach pelo valor e pela data
 * da saída, na empresa da conta, já conciliada e baixada.
 * b: { lancamentoId, fornecedorCode, despesaCode, centroCustoCode? }
 */
export async function gerarDuplicataDaSaida(user, b = {}) {
  await empresasPermitidas(user);
  const l = await saidaLivre(b.lancamentoId, b.chave);
  const fornecedor = Number(dig(b.fornecedorCode));
  const despesa = Number(dig(b.despesaCode));
  if (!fornecedor) throw new CpError('Escolha o fornecedor da duplicata');
  if (!despesa) throw new CpError('Escolha a despesa da duplicata');
  const centro = Number(dig(b.centroCustoCode)) || null;
  let r;
  try {
    r = await criarDuplicatasTarifas({ itens: [{ lancamentoId: l.id, fornecedorCodigo: fornecedor, despesaCodigo: despesa, ...(centro ? { centroCustoCodigo: centro } : {}) }], usuario: quem(user) });
  } catch (e) {
    throw new CpError(`Não consegui gerar a duplicata: ${e.message}`, 'GERAR', 409);
  }
  const criada = r.criadas?.[0];
  if (!criada) throw new CpError(`A duplicata não foi gerada: ${r.recusadas?.[0]?.motivo || 'motivo não informado'}`, 'GERAR', 409);
  const t = await q(supabase.from('hc_cp_titulos').select(CAMPOS_TITULO).eq('id', criada.tituloId).maybeSingle());
  console.log(`🏦 [liberação · saída sem baixa] saída ${l.id} (${l.data} · R$ ${brl(Math.abs(l.valor))}) virou a duplicata ${criada.duplicata} de ${criada.fornecedor} · ${quem(user)}`);
  return { titulo: t ? tituloDaTela(t, { situacao: t.situacao }) : null, duplicata: criada.duplicata, fornecedor: criada.fornecedor, empresa: criada.empresa, valor: criada.valor };
}

// ─── Solicitações Crosby ─────────────────────────────────────────────────────
const CAMPOS_SOL = 'id, status, tipo_solicitacao, solicitante, setor, supplier_name, supplier_cpf_cnpj, valor_total, dt_vencimento, dt_emissao, descricao, tem_nota_fiscal, nf_escriturado_em, duplicate_code, nm_empresa, cd_empresa, pago_em, data_solicitacao, created_at';

async function titulosDasSolicitacoes(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const lote = await q(supabase.from('hc_cp_titulos').select(`${CAMPOS_TITULO}, origem_ref`).eq('origem', ORIGEM_SOLICITACAO).in('origem_ref', ids.slice(i, i + 100).map(String)).neq('situacao', 'cancelado').order('parcela'));
    for (const t of lote || []) {
      const k = String(t.origem_ref);
      if (!out.has(k)) out.set(k, []);
      out.get(k).push(t);
    }
  }
  return out;
}

/**
 * Solicitações Crosby para resolver a saída: sem busca, as de mesmo valor (ou até 10% menor, paga
 * com juros) e as do mesmo recebedor; com busca, por fornecedor, solicitante, CPF/CNPJ, número ou valor.
 * f: { lancamentoId, q? }
 */
export async function solicitacoesParaASaida(user, f = {}) {
  await empresasPermitidas(user);
  const termo = String(f.q || '').trim();
  const filtros = [];
  let valorDaSaida = null;
  if (termo) {
    const numero = Number(termo.replace(/\./g, '').replace(',', '.'));
    const d = dig(termo);
    const nome = termo.replace(/[%_,()]/g, ' ');
    filtros.push(`supplier_name.ilike.%${nome}%`, `solicitante.ilike.%${nome}%`);
    if (d.length >= 5) filtros.push(`supplier_cpf_cnpj.ilike.%${d}%`, `duplicate_code.eq.${d}`);
    if (Number.isFinite(numero) && numero > 0) filtros.push(`valor_total.eq.${numero}`);
  } else {
    const l = await linhaDoExtrato(f.lancamentoId, f.chave);
    const valor = round2(Math.abs(Number(l.valor)));
    valorDaSaida = valor;
    const nome = String(l.contraparte_nome && !/^(transfer|pix|pagamento|ted|doc)/i.test(l.contraparte_nome) ? l.contraparte_nome : l.memo || '')
      .replace(/\s+-\s+(Transfer.ncia|Pagamento).*$/i, '')
      .replace(/[%_,()."']/g, ' ')
      .trim();
    const palavras = nome.split(/\s+/).filter((p) => p.length > 2).slice(0, 2).join(' ');
    filtros.push(`and(valor_total.gte.${round2(valor / 1.1)},valor_total.lte.${valor})`);
    if (palavras.length >= 4) filtros.push(`supplier_name.ilike.%${palavras}%`);
  }
  const lista = await q(supabase.from('solicitacoes_crosby').select(CAMPOS_SOL).or(filtros.join(',')).order('created_at', { ascending: false }).limit(80));
  const titulos = await titulosDasSolicitacoes((lista || []).map((x) => x.id));
  let solicitacoes = (lista || []).map((x) => {
    const dup = (titulos.get(String(x.id)) || []).map((t) => tituloDaTela(t, { situacao: t.situacao }));
    const abertas = dup.filter((t) => t.situacao === 'aberto');
    const motivo = dup.length ? (abertas.length ? null : 'a duplicata desta solicitação já está paga') : motivoDeNaoEnviarDaqui(x);
    return {
      id: x.id,
      status: x.status,
      statusRotulo: ROTULO_STATUS_SOLICITACAO[x.status] || x.status,
      tipo: x.tipo_solicitacao,
      solicitante: x.solicitante,
      setor: x.setor,
      fornecedor: x.supplier_name,
      cpfCnpj: x.supplier_cpf_cnpj,
      valor: Number(x.valor_total),
      vencimento: x.dt_vencimento ? String(x.dt_vencimento).slice(0, 10) : null,
      descricao: x.descricao ? String(x.descricao).slice(0, 200) : null,
      notaFiscal: x.tem_nota_fiscal === true,
      escriturada: Boolean(x.nf_escriturado_em),
      empresa: x.cd_empresa,
      criadaEm: String(x.data_solicitacao || x.created_at || '').slice(0, 10),
      paga: Boolean(x.pago_em),
      duplicatas: dup,
      pode: !motivo,
      motivo: motivo ? `Esta solicitação ${motivo}`.replace('Esta solicitação a duplicata', 'A duplicata') : null,
      acao: acaoDaSolicitacao(x, dup.length > 0),
    };
  });
  // sem busca: primeiro as de valor igual ao da saída, depois as que dão para resolver daqui
  if (!termo && valorDaSaida != null) {
    const igual = (x) => Math.round(x.valor * 100) === Math.round(valorDaSaida * 100);
    solicitacoes = solicitacoes.map((x, i) => ({ x, i })).sort((p, o) => Number(igual(o.x)) - Number(igual(p.x)) || Number(o.x.pode) - Number(p.x.pode) || p.i - o.i).map((p) => p.x);
  }
  return { solicitacoes };
}

/**
 * Aprova (se ainda faltar), envia a solicitação ao Contas a Pagar HeadCoach e casa a saída com a
 * duplicata. A que já tem duplicata em aberto só é casada.
 * b: { lancamentoId, solicitacaoId }
 */
export async function casarComSolicitacao(user, b = {}) {
  await empresasPermitidas(user);
  const l = await saidaLivre(b.lancamentoId, b.chave); // antes de aprovar qualquer coisa: a saída tem de estar livre
  const saida = round2(Math.abs(Number(l.valor)));
  const sol = await q(supabase.from('solicitacoes_crosby').select('*').eq('id', b.solicitacaoId).maybeSingle());
  if (!sol) throw new CpError('Solicitação não encontrada', 'NOT_FOUND', 404);
  let titulos = (await titulosDasSolicitacoes([sol.id])).get(String(sol.id)) || [];
  let enviou = false;
  // PRODUTO DE PATRIMÔNIO aguardando conciliação: esta saída É o pagamento dela. Usa o fluxo que já existe
  // (a mesma conciliação da tela das Solicitações): a solicitação fica conciliada e paga com esta saída,
  // e a duplicata entra no contas a pagar já paga.
  if (!titulos.length && sol.status === 'aguardando_conciliacao') {
    const { conciliarManual } = await import('./conciliacaoPatrimonio.js');
    try {
      await conciliarManual({ solicitacaoId: sol.id, lancamentoId: l.id, usuario: quem(user) });
    } catch (e) {
      throw new CpError(`Não conciliei a solicitação com esta saída: ${e.message}`, 'PATRIMONIO', 409);
    }
    let r;
    try {
      r = await enviarSolicitacaoAoCp(user, sol.id);
    } catch (e) {
      throw new CpError(`A saída foi conciliada com a solicitação (que ficou paga), mas a duplicata não entrou no contas a pagar: ${e.message}. Lance pela tela das Solicitações.`, 'PATRIMONIO', 409);
    }
    const t = await q(supabase.from('hc_cp_titulos').select(CAMPOS_TITULO).eq('id', r.titulos[0].id).maybeSingle());
    console.log(`🏦 [liberação · saída sem baixa] saída ${l.id} conciliada com a solicitação de patrimônio ${sol.id} e lançada no contas a pagar (${r.rotulo}) · ${quem(user)}`);
    return { conciliacaoId: null, tipo: 'igual', pago: saida, juros: 0, resta: 0, titulo: tituloDaTela(t || r.titulos[0], { situacao: t?.situacao || 'pago' }), aviso: t?.situacao === 'pago' ? null : 'a duplicata entrou no contas a pagar, mas não ficou paga: confira', enviou: true, patrimonio: true, solicitacaoId: sol.id };
  }
  if (!titulos.length) {
    const motivo = motivoDeNaoEnviarDaqui(sol);
    if (motivo) throw new CpError(`Esta solicitação ${motivo}`, 'NAO_ENVIA', 409);
    // aprovações que faltam, no nome de quem clicou
    const agora = new Date().toISOString();
    const por = quem(user);
    const uuid = /^[0-9a-f-]{36}$/i.test(String(user?.id || '')) ? user.id : null;
    const patch = {};
    if (sol.status === 'pendente') Object.assign(patch, { aprovado_gestor_em: agora, aprovado_gestor_por: uuid, aprovado_gestor_por_nome: por });
    if (['pendente', 'aprovado_gestor'].includes(sol.status)) Object.assign(patch, { status: 'aprovado_financeiro', aprovado_financeiro_em: agora, aprovado_financeiro_por: uuid, aprovado_financeiro_por_nome: por });
    if (Object.keys(patch).length) await q(supabase.from('solicitacoes_crosby').update(patch).eq('id', sol.id).eq('status', sol.status));
    const r = await enviarSolicitacaoAoCp(user, sol.id); // cria a duplicata (ou grava o erro de envio na solicitação)
    titulos = r.titulos || [];
    enviou = true;
  }
  const escolha = tituloParaCasar(titulos, saida);
  if (escolha.erro) throw new CpError(`${enviou ? 'A solicitação foi enviada ao contas a pagar, mas não casei: ' : 'Não dá para casar: '}${escolha.erro}`, 'NAO_CASA', 409);
  let r;
  try {
    r = await casarSaida(user, { lancamentoId: l.id, tituloId: escolha.titulo.id });
  } catch (e) {
    if (enviou && e instanceof CpError) throw new CpError(`A solicitação foi aprovada e enviada ao contas a pagar (duplicata ${rotuloDuplicata(escolha.titulo)}), mas a saída não casou: ${e.message}`, e.code, e.status);
    throw e;
  }
  return { ...r, enviou, solicitacaoId: sol.id };
}

// ─── Contas a pagar do TOTVS ─────────────────────────────────────────────────
/**
 * O título do contas a pagar do TOTVS vira duplicata no Contas a Pagar HeadCoach (sem passar pela
 * Liberação) e é casado com a saída. Se a duplicata já existe em aberto lá, só casa.
 * b: { lancamentoId, item: linha da consulta do TOTVS (cd_empresa, cd_fornecedor, nr_duplicata, nr_parcela, vl_duplicata, dt_vencimento…) }
 */
export async function casarComTituloTotvs(user, b = {}) {
  await empresasPermitidas(user);
  const l = await saidaLivre(b.lancamentoId, b.chave);
  const item = b.item && typeof b.item === 'object' && !Array.isArray(b.item) ? b.item : null;
  if (!item) throw new CpError('Escolha o título do contas a pagar');
  const r = await enviarDoTotvsParaLiberacao(user, { itens: [item] }, { semLiberar: true });
  if (!r.ids?.length) throw new CpError(`Não criei a duplicata no HeadCoach: ${r.ignoradas?.[0]?.motivo || 'motivo não informado'}`, 'TOTVS', 409);
  let casou;
  try {
    casou = await casarSaida(user, { lancamentoId: l.id, tituloId: r.ids[0] });
  } catch (e) {
    if (r.criadas && e instanceof CpError) throw new CpError(`A duplicata foi criada no Contas a Pagar HeadCoach, mas a saída não casou: ${e.message}`, e.code, e.status);
    throw e;
  }
  return { ...casou, criou: r.criadas > 0 };
}

export default { saidasSemBaixa, casarSaida, gerarDuplicataDaSaida, solicitacoesParaASaida, casarComSolicitacao, casarComTituloTotvs };
