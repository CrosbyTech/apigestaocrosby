// ============================================================================
// CONTAS FIXAS DAS LOJAS — copiar as contas de um mês para o seguinte, como
// PREVISÃO no Contas a Pagar HeadCoach (Yago, 26/11/2026).
//   • outubro → novembro: só o que FALTA em novembro (fornecedor que teve conta em
//     outubro e ainda não tem em novembro);
//   • novembro → dezembro: TUDO.
// VALOR (decisão do Yago): aluguel e internet são fixos → o mesmo valor do mês de origem;
// o restante (condomínio, energia, água, telefone) entra com o valor simbólico de R$ 0,01,
// que o robô que busca a conta (ou o financeiro) troca pelo valor real quando ela chegar.
// Vencimento: o mesmo dia da conta de origem; para cadastro sem conta no mês, o dia do
// cadastro; sem dia nenhum, dia 30.
// planoDaCopia() só calcula (não grava); aplicarCopia() cria as duplicatas, uma vez
// só cada (origem `contas-fixas-previsao`, referência = mês de destino + conta de origem).
// ============================================================================
import supabase from '../config/supabase.js';
import { planilhaDoMes, mesmoFornecedor, TIPOS_DESPESA } from './contasFixasLojas.js';
import { validarInclusao, inserirTitulos, parcelaDoMes } from './hcContasPagar.js';

export const ORIGEM_PREVISAO = 'contas-fixas-previsao';
// colunas de valor fixo: a previsão repete o valor do mês anterior
export const COLUNAS_DE_VALOR_FIXO = ['ALUGUEL', 'INTERNET'];
export const VALOR_SIMBOLICO = 0.01;
const DESPESA_DA_COLUNA = { ALUGUEL: 4001, CONDOMINIO: 4005, ENERGIA: 6010, AGUA: 6011, INTERNET: 6028 };
const DESPESA_DO_TIPO = { ALUGUEL: 4001, CONDOMINIO: 4005, ENERGIA: 6010, AGUA: 6011, INTERNET: 6028, TELEFONE: 6012 };
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const nomeDoMes = (m) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`;
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const ultimoDiaDoMes = (mes) => new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).getUTCDate();
/** O dia `d` dentro do mês (31 em novembro vira 30). */
export const diaNoMes = (mes, d) => `${mes}-${String(Math.min(Math.max(1, Number(d) || 30), ultimoDiaDoMes(mes))).padStart(2, '0')}`;

/**
 * O que seria criado no mês `destino` a partir do mês `origem`.
 *   valor: 'fixos' (padrão: aluguel e internet com o valor da origem, o resto a R$ 0,01), 'origem' (tudo com o valor da origem) ou um número
 *   soFaltantes: true = só o fornecedor que não tem conta no destino; false = todas as contas da origem
 *   comCadastroSemConta: inclui o cadastro que não teve conta na origem (dia do cadastro, ou 30)
 */
export async function planoDaCopia({ origem, destino, valor = 'fixos', soFaltantes = true, comCadastroSemConta = false } = {}) {
  const valorPara = (coluna, daOrigem) => (valor === 'origem' || (valor === 'fixos' && COLUNAS_DE_VALOR_FIXO.includes(coluna)) ? round2(daOrigem) : valor === 'fixos' ? VALOR_SIMBOLICO : round2(valor));
  const [o, d] = await Promise.all([planilhaDoMes({ mes: origem }), planilhaDoMes({ mes: destino })]);
  const { data: lojasCad, error } = await supabase.from('contas_fixas_lojas').select('cd_filial, empresa, centro_custo_code');
  if (error) throw new Error(error.message);
  const dadosDaLoja = new Map((lojasCad || []).map((l) => [String(l.cd_filial), l]));
  const itens = [];
  const fora = []; // o que não dá para copiar, com o motivo
  for (const loja of o.lojas) {
    const lojaDest = d.lojas.find((x) => x.cdFilial === loja.cdFilial);
    const cad = dadosDaLoja.get(loja.cdFilial) || {};
    for (const col of o.colunas) {
      const cel = loja.celulas[col.id];
      const celDest = lojaDest?.celulas[col.id];
      if (cel.naoSeAplica || celDest?.naoSeAplica) continue;
      const livres = [...(celDest?.lancamentos || [])]; // contas do destino ainda não casadas
      const origemOrdenada = [...cel.lancamentos].sort((a, b) => b.valor - a.valor);
      // fornecedor cujo total no destino já cobre o da origem não tem conta faltando, mesmo com menos linhas
      // (o aluguel da SB Imóveis veio em duas duplicatas em outubro e numa só em novembro)
      const totalDo = (lista, ref) => lista.filter((y) => mesmoFornecedor(ref, y)).reduce((s, y) => s + y.valor, 0);
      const parDeOcupacao = { ALUGUEL: 'CONDOMINIO', CONDOMINIO: 'ALUGUEL' }[col.id] || null;
      const noPar = (l) => [...l.celulas[col.id].lancamentos, ...(parDeOcupacao ? l.celulas[parDeOcupacao].lancamentos : [])];
      const titulosDe = (lista, ref) => new Set(lista.filter((y) => mesmoFornecedor(ref, y)).map((y) => y.titulo)).size;
      for (const x of origemOrdenada) {
        const ref = { cd_fornecedor: x.fornecedorCode, nm_fornecedor: x.fornecedor };
        if (soFaltantes && totalDo(celDest?.lancamentos || [], ref) >= totalDo(cel.lancamentos, ref) * 0.97) continue;
        // aluguel e condomínio do mesmo fornecedor costumam vir no mesmo boleto: se o destino já tem os títulos dele
        // (em qualquer das duas colunas), não falta nada — o Guararapes lança o boleto inteiro como aluguel
        if (soFaltantes && parDeOcupacao && lojaDest && titulosDe(noPar(lojaDest), ref) >= titulosDe(noPar(loja), ref)) continue;
        const candidatos = livres.filter((y) => mesmoFornecedor(ref, y));
        if (candidatos.length) {
          // a conta do destino mais parecida em valor é "a mesma conta" → não falta
          const par = candidatos.sort((a, b) => Math.abs(a.valor - x.valor) - Math.abs(b.valor - x.valor))[0];
          livres.splice(livres.indexOf(par), 1);
          if (soFaltantes) continue;
        }
        if (!soFaltantes && candidatos.length) continue; // já existe no destino: nunca duplica
        const base = { mes: destino, cdFilial: loja.cdFilial, loja: loja.nome, coluna: col.id, despesa: col.nome, fornecedor: x.fornecedor, fornecedorCode: x.fornecedorCode, valorOrigem: x.valor, vencimentoOrigem: x.vencimento, contaOrigem: x.duplicata, situacaoOrigem: x.situacao };
        if (!x.fornecedorCode) { fora.push({ ...base, motivo: 'conta de origem sem o código do fornecedor (fatura capturada que ainda não virou duplicata)' }); continue; }
        const empresa = Number(x.empresa) || Number(cad.empresa) || null;
        if (!empresa) { fora.push({ ...base, motivo: 'não sei em qual empresa lançar' }); continue; }
        itens.push({
          ...base,
          empresa,
          despesaCode: DESPESA_DA_COLUNA[col.id] || x.despesaCode || 6012,
          centroCustoCode: x.centroCustoCode ?? cad.centro_custo_code ?? null,
          valor: valorPara(col.id, x.valor),
          vencimento: diaNoMes(destino, x.vencimento.slice(8, 10)),
          temVencimento: true,
          // conta mensal: a parcela é o mês; se a duplicata de origem é do HeadCoach e ainda não tem essa parcela, a previsão entra nela
          duplicataDeOrigem: x.tituloId && x.duplicataNumero && x.parcela !== parcelaDoMes(`${destino}-01`) ? x.duplicataNumero : null,
          ref: `${destino}|${x.titulo}`,
          de: `conta de ${nomeDoMes(origem)} (${x.duplicata || 's/ nº'}, ${brl(x.valor)}, venc. ${x.vencimento.slice(8, 10)}/${x.vencimento.slice(5, 7)})`,
        });
      }
      if (!comCadastroSemConta) continue;
      // cadastro da loja que não teve conta no mês de origem (ex.: internet da Claro, ainda sem captura)
      for (const c of cel.cadastros) {
        if (cel.lancamentos.some((x) => mesmoFornecedor({ cd_fornecedor: c.fornecedorCode, nm_fornecedor: c.fornecedor }, x))) continue;
        if ((celDest?.lancamentos || []).some((x) => mesmoFornecedor({ cd_fornecedor: c.fornecedorCode, nm_fornecedor: c.fornecedor }, x))) continue;
        const base = { mes: destino, cdFilial: loja.cdFilial, loja: loja.nome, coluna: col.id, despesa: c.tipoNome, fornecedor: c.fornecedor, fornecedorCode: c.fornecedorCode ? Number(c.fornecedorCode) : null, valorOrigem: null, vencimentoOrigem: null, contaOrigem: null, situacaoOrigem: 'sem conta no mês' };
        if (TIPOS_DESPESA[c.tipo]?.sobDemanda || c.comoPegarCanal === 'sob_demanda') { fora.push({ ...base, motivo: 'compra sob demanda (sem conta mensal)' }); continue; }
        if (!base.fornecedorCode) { fora.push({ ...base, motivo: 'cadastro sem o código do fornecedor' }); continue; }
        if (!cad.empresa) { fora.push({ ...base, motivo: 'imóvel sem empresa: não sei em qual empresa lançar' }); continue; }
        itens.push({
          ...base,
          empresa: Number(cad.empresa),
          despesaCode: DESPESA_DO_TIPO[c.tipo] || 6012,
          centroCustoCode: cad.centro_custo_code ?? null,
          valor: VALOR_SIMBOLICO, // sem conta de origem não há valor para repetir, nem no aluguel
          vencimento: diaNoMes(destino, c.vencimentoDia || 30),
          temVencimento: !!c.vencimentoDia,
          duplicataDeOrigem: null,
          ref: `${destino}|cad:${c.id}`,
          de: `cadastro da loja (${c.vencimentoDia ? `vence todo dia ${c.vencimentoDia}` : 'sem dia de vencimento: dia 30'})`,
        });
      }
    }
  }
  // o que já foi criado numa rodada anterior não entra de novo
  const refs = itens.map((i) => i.ref);
  const jaCriados = new Set();
  for (let i = 0; i < refs.length; i += 100) {
    const { data, error: e2 } = await supabase.from('hc_cp_titulos').select('origem_ref').eq('origem', ORIGEM_PREVISAO).neq('situacao', 'cancelado').in('origem_ref', refs.slice(i, i + 100));
    if (e2) throw new Error(e2.message);
    for (const t of data || []) jaCriados.add(String(t.origem_ref));
  }
  const novos = itens.filter((i) => !jaCriados.has(i.ref));
  return { origem, destino, itens: novos, jaCriados: itens.length - novos.length, fora, total: round2(novos.reduce((s, i) => s + i.valor, 0)) };
}

/** Cria no Contas a Pagar HeadCoach, como PREVISÃO, as contas do plano. Devolve o que foi criado e o que falhou. */
export async function aplicarCopia(plano, { por = 'Contas fixas (previsão do mês)', hoje = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10) } = {}) {
  const criados = [];
  const falhas = [];
  for (const i of plano.itens) {
    const simbolico = i.valor <= 0.011;
    const observacao = `Previsão de ${nomeDoMes(plano.destino)} — ${i.despesa} de ${i.loja}. Copiada da ${i.de}. ${simbolico ? 'Valor simbólico de R$ 0,01: o robô que busca a conta (ou o financeiro) troca pelo valor real quando ela chegar.' : 'Valor fixo, igual ao do mês anterior: conferir quando a conta chegar.'}${i.temVencimento ? '' : ' Vencimento provisório no dia 30.'}`;
    const montar = (duplicata) =>
      validarInclusao(
        { empresa: i.empresa, duplicata, fornecedorCode: i.fornecedorCode, despesaCode: i.despesaCode, centroCustoCode: i.centroCustoCode, tipoDocumento: 'duplicata', previsao: 'previsao', emissao: `${plano.destino}-01`, entrada: hoje, referencia: `${plano.destino.slice(5, 7)}/${plano.destino.slice(0, 4)}`, observacao, parcela: parcelaDoMes(i.vencimento), vencimento: i.vencimento, valor: i.valor },
        hoje,
      );
    try {
      let titulo;
      try {
        [titulo] = await inserirTitulos(montar(i.duplicataDeOrigem), { por, origem: ORIGEM_PREVISAO, origemRef: i.ref });
      } catch (e) {
        // a duplicata de origem já tem a parcela do mês (ou sumiu): abre uma duplicata nova
        if (!i.duplicataDeOrigem || !['DUPLICADA', 'DUPLICATA'].includes(e.code)) throw e;
        [titulo] = await inserirTitulos(montar(null), { por, origem: ORIGEM_PREVISAO, origemRef: i.ref });
      }
      criados.push({ ...i, tituloId: titulo.id, duplicata: `${titulo.duplicata}/${titulo.parcela}` });
    } catch (e) {
      falhas.push({ ...i, erro: e.message });
    }
  }
  return { destino: plano.destino, criados, falhas, total: round2(criados.reduce((s, i) => s + i.valor, 0)) };
}
