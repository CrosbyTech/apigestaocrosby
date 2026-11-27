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
//     conciliada e baixada.
// Como na Conciliação, não pede senha (decisão do Yago, 24/11/2026: a baixa que
// vem da conciliação do extrato não precisa); a tela confirma antes de gravar.
// =============================================================================
import supabase from '../config/supabase.js';
import { CpError, empresasPermitidas, editarTitulo, rotuloDuplicata } from './hcContasPagar.js';
import { incluidasDoUsuario } from './hcCpLiberacao.js';
import { nomeScore } from './conciliacaoAprovados.js';
import { salvarConciliacao, lancamentoComChave } from './fluxoCaixaConciliacao.js';
import { saidasPendentesComSugestao, criarDuplicatasTarifas } from './tarifasConciliacao.js';
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

/** A saída do extrato, conferida: é saída, não é transferência entre contas e ainda não está conciliada. */
async function saidaLivre(lancamentoId) {
  let l;
  try {
    l = await lancamentoComChave(Number(lancamentoId));
  } catch (e) {
    throw new CpError(e.message, 'SAIDA', 404);
  }
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
  const l = await saidaLivre(b.lancamentoId);
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
  const l = await saidaLivre(b.lancamentoId);
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

export default { saidasSemBaixa, casarSaida, gerarDuplicataDaSaida };
