// ============================================================
// Conciliação dos repasses da Techfin (Pix TOTVS) com o extrato bancário
// ------------------------------------------------------------
// Entrada: um ou mais relatórios da Techfin (utils/techfinPix.js). Para cada
// REPASSE: acha o crédito do extrato (conta de destino, valor líquido exato,
// data de liquidação ou dias seguintes). Para cada PIX do repasse: acha o
// título PIX (tipo 26) do contas a receber TOTVS da filial do CNPJ, pelo
// valor BRUTO e data (pago ou ainda em aberto — a baixa no TOTVS costuma
// atrasar). Grava a conciliação da linha com os títulos (TOTVS_CR se for um,
// MULTIPLO se forem vários), cada título valendo o líquido (bruto − 0,79),
// guardando o repasse e o NSU de cada Pix na referência.
// ============================================================
import supabase from '../config/supabase.js';
import { interpretarTechfin, mesclarTechfin } from '../utils/techfinPix.js';
import { mapearFiliaisTotvsPorCnpj } from './totvsCartoesStone.js';
import { fonteTotvsCR, usadosTotais, marcarUso, salvarConciliacao } from './fluxoCaixaConciliacao.js';
import { normEscopo, ESCOPO_PADRAO } from './fluxoCaixaExt.js';

const T = { conc: 'fluxo_caixa_conciliacoes', lanc: 'fluxo_caixa_lancamentos', contas: 'fluxo_caixa_contas' };
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const addDias = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const diffDias = (a, b) => Math.round((new Date(`${a}T00:00:00Z`) - new Date(`${b}T00:00:00Z`)) / 86400000);
const dia = (dh) => (dh ? String(dh).slice(0, 10) : null);
const cents = (v) => Math.round(Math.abs(Number(v)) * 100);

// Dias que o crédito pode levar para aparecer no extrato depois da liquidação
// (fim de semana/feriado: repasse de sábado 10/10 entrou na Sicredi em 13/10).
const JANELA_EXTRATO = 4;
// Distância aceita entre o Pix e a data do título (pago: data do pagamento;
// em aberto: emissão). A baixa no TOTVS pode vir dias depois do Pix.
const JANELA_TITULO = { antes: 1, depois: 10 };

const BANCOS_CODIGO = { 197: 'STONE', 748: 'SICREDI' };

// o Supabase devolve no máximo 1000 linhas por chamada
async function todos(montar, pagina = 1000) {
  const out = [];
  for (let ini = 0; ; ini += pagina) {
    const { data, error } = await montar(ini, ini + pagina - 1);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < pagina) return out;
  }
}

/** conta do extrato que recebe o repasse */
function contaDoRepasse(r, contas) {
  const candidatos = [];
  if (r.conta?.numero) {
    const banco = BANCOS_CODIGO[Number(r.conta.banco)] || null;
    for (const c of contas) {
      if (banco && String(c.banco || '').toUpperCase() !== banco) continue;
      const n = soDigitos(c.conta);
      const ndv = soDigitos(`${c.conta || ''}${c.conta_dv || ''}`);
      const alvo = soDigitos(r.conta.numero);
      if ((n && (n === alvo || n === alvo.slice(0, -1))) || (ndv && ndv === alvo)) candidatos.push(c);
    }
  }
  if (!candidatos.length && r.cnpj) {
    // extrato da conta Techfin da loja: repasse cai na Stone do CNPJ
    for (const c of contas) if (String(c.banco || '').toUpperCase() === 'STONE' && soDigitos(c.titular_cnpj) === soDigitos(r.cnpj)) candidatos.push(c);
  }
  // mesma conta cadastrada duas vezes (apelidos antigos): prefere a ativa/mais recente
  candidatos.sort((a, b) => (b.ativo === false ? 0 : 1) - (a.ativo === false ? 0 : 1) || b.id - a.id);
  return candidatos[0] || null;
}

const ehCreditoPix = (l) => Number(l.valor) > 0 && !l.transferencia_id && (String(l.categoria || '') === 'pix' || /PIX/i.test(String(l.memo || '')) || /PIX/i.test(String(l.descricao || '')));

/**
 * @param {{arquivos: {buffer: Buffer, nome: string}[], usuario?: string, simular?: boolean, escopo?: string}} p
 */
export async function importarTechfin({ arquivos, usuario = null, simular = false, escopo = ESCOPO_PADRAO }) {
  if (!arquivos?.length) throw new Error('Envie pelo menos um relatório da Techfin.');
  const relatorios = [];
  const avisos = [];
  for (const a of arquivos) {
    try {
      const rel = interpretarTechfin(a.buffer);
      rel.nome = a.nome;
      relatorios.push(rel);
    } catch (e) {
      avisos.push(`${a.nome}: ${e.message}`);
    }
  }
  if (!relatorios.length) throw new Error(avisos.join(' · ') || 'Nenhum relatório reconhecido.');
  const { pix, repasses, avisos: avisosMescla } = mesclarTechfin(relatorios);
  avisos.push(...avisosMescla);
  const pixPorNsu = new Map(pix.map((p) => [p.nsu, p]));

  const datas = repasses.map((r) => dia(r.dataLiquidacao)).filter(Boolean).sort();
  const datasPix = pix.map((p) => dia(p.dataPagamento)).filter(Boolean).sort();
  if (!datas.length) throw new Error('Nenhum repasse liquidado nos relatórios.');
  const de = datas[0];
  const ate = datas[datas.length - 1];

  // contas e lançamentos do período
  const esc = normEscopo(escopo);
  const { data: contasTodas, error: ec } = await supabase.from(T.contas).select('*');
  if (ec) throw new Error(ec.message);
  const contas = (contasTodas || []).filter((c) => !c.escopo || c.escopo === esc);
  const lancs = await todos((ini, fim) =>
    supabase
      .from(T.lanc)
      .select('id,conta_id,data,valor,memo,descricao,categoria,contraparte_doc,contraparte_nome,contraparte_banco,transferencia_id')
      .gte('data', de)
      .lte('data', addDias(ate, JANELA_EXTRATO))
      .gt('valor', 0)
      .in('conta_id', contas.map((c) => c.id))
      .order('id')
      .range(ini, fim),
  );
  const linhas = lancs.filter(ehCreditoPix);
  const concs = [];
  for (let i = 0; i < linhas.length; i += 200) {
    const ids = linhas.slice(i, i + 200).map((l) => l.id);
    const { data, error } = await supabase.from(T.conc).select('id,lancamento_id,origem,referencia,automatico').in('lancamento_id', ids);
    if (error) throw new Error(error.message);
    concs.push(...(data || []));
  }
  const concPorLanc = new Map(concs.map((c) => [c.lancamento_id, c]));
  const linhasUsadas = new Set();

  // títulos PIX do TOTVS das filiais dos CNPJs envolvidos
  const mapa = await mapearFiliaisTotvsPorCnpj();
  const cnpjs = [...new Set(pix.map((p) => p.cnpj).filter(Boolean))];
  const filiaisPorCnpj = new Map(cnpjs.map((c) => [c, (mapa.get(c) || []).map((f) => f.code)]));
  const branches = [...new Set([...filiaisPorCnpj.values()].flat())];
  const semFilial = cnpjs.filter((c) => !filiaisPorCnpj.get(c)?.length);
  if (semFilial.length) avisos.push(`CNPJ sem filial no TOTVS: ${semFilial.join(', ')}`);
  const janelaCR = { de: addDias(datasPix[0] || de, -JANELA_TITULO.antes), ate: addDias(datasPix[datasPix.length - 1] || ate, JANELA_TITULO.depois) };
  const titulos = branches.length ? await fonteTotvsCR(branches, janelaCR) : [];
  const porChave = new Map();
  for (const t of titulos) {
    if (Number(t.cr?.tipoDocumento) !== 26) continue;
    const k = `${t.branch}|${cents(t.valor)}`;
    if (!porChave.has(k)) porChave.set(k, []);
    porChave.get(k).push(t);
  }
  const usados = await usadosTotais();
  const livre = (t) => (usados.get(`${t.origem}:${t.id}`) || 0) < 0.011;

  const tituloDoPix = (p) => {
    const fils = filiaisPorCnpj.get(p.cnpj) || [];
    const d = dia(p.dataPagamento);
    const cands = fils
      .flatMap((f) => porChave.get(`${f}|${cents(p.valor)}`) || [])
      .filter(livre)
      .map((t) => ({ t, dd: diffDias(t.data, d), pago: t.valorPago != null }))
      .filter((x) => x.dd >= -JANELA_TITULO.antes && x.dd <= JANELA_TITULO.depois)
      .sort((a, b) => Math.abs(a.dd) - Math.abs(b.dd) || b.pago - a.pago);
    return cands[0]?.t || null;
  };

  const resultado = {
    arquivos: relatorios.map((r) => ({ nome: r.nome, formato: r.formato, apelido: r.apelido, pix: r.pix.length, repasses: r.repasses.length })),
    periodo: { de, ate },
    pix: pix.length,
    repasses: repasses.length,
    conciliadas: [],
    jaConciliadas: [],
    semLinha: [],
    semConta: [],
    titulosNaoLocalizados: 0,
    avisos,
    simulado: !!simular,
  };

  const ordenados = [...repasses].sort((a, b) => String(a.dataLiquidacao).localeCompare(String(b.dataLiquidacao)));
  for (const r of ordenados) {
    const conta = contaDoRepasse(r, contas);
    const dLiq = dia(r.dataLiquidacao);
    if (!conta || !dLiq) {
      resultado.semConta.push({ repasse: r.id, apelido: r.apelido, cnpj: r.cnpj, conta: r.conta, data: dLiq, valor: r.valor, pix: r.pix.length });
      continue;
    }
    const alvo = cents(r.valor);
    const cands = linhas
      .filter((l) => l.conta_id === conta.id && !linhasUsadas.has(l.id) && cents(l.valor) === alvo && diffDias(l.data, dLiq) >= 0 && diffDias(l.data, dLiq) <= JANELA_EXTRATO)
      .sort((a, b) => diffDias(a.data, dLiq) - diffDias(b.data, dLiq) || (concPorLanc.has(a.id) ? 1 : 0) - (concPorLanc.has(b.id) ? 1 : 0));
    let l = cands[0];
    let contaLinha = conta;
    if (!l) {
      // relatório sem conta de destino ("-/-/-"): o repasse pode ter caído em
      // outra conta do grupo (ex.: Sicredi central). Vale se for crédito único.
      const outras = linhas.filter((x) => x.conta_id !== conta.id && !linhasUsadas.has(x.id) && cents(x.valor) === alvo && diffDias(x.data, dLiq) >= 0 && diffDias(x.data, dLiq) <= JANELA_EXTRATO);
      if (outras.length === 1) {
        l = outras[0];
        contaLinha = contas.find((c) => c.id === l.conta_id) || conta;
      }
    }
    if (!l) {
      resultado.semLinha.push({ repasse: r.id, conta: `${conta.banco} ${conta.apelido}`, contaId: conta.id, data: dLiq, valor: r.valor, pix: r.pix.length });
      continue;
    }
    linhasUsadas.add(l.id);
    const ja = concPorLanc.get(l.id);
    if (ja) {
      resultado.jaConciliadas.push({ lancamentoId: l.id, conta: `${contaLinha.banco} ${contaLinha.apelido}`, data: l.data, valor: l.valor, origem: ja.origem, repasse: r.id });
      continue;
    }
    // títulos de cada Pix do repasse
    const itens = [];
    let naoLocalizados = 0;
    for (const nsu of r.pix) {
      const p = pixPorNsu.get(nsu);
      if (!p) continue;
      const t = tituloDoPix(p);
      const techfin = { nsu: p.nsu, identificador: p.identificador, repasse: r.id, pagamento: p.dataPagamento, liquidacao: p.dataLiquidacao || r.dataLiquidacao, bruto: p.valor, taxa: p.taxa, liquido: p.liquido, cnpj: p.cnpj, pagador: p.pagador || null };
      if (t) {
        marcarUso(usados, t.origem, t.id, p.liquido);
        itens.push({ origem: t.origem, id: t.id, nome: t.nome, doc: t.doc, duplicata: t.duplicata, vencimento: t.vencimento, data: t.data, empresa: t.empresa, detalhe: `${t.detalhe} · Pix ${String(p.dataPagamento || '').slice(0, 16).replace('T', ' ')} bruto ${p.valor.toFixed(2)} − taxa ${p.taxa.toFixed(2)}`, valorDuplicata: p.liquido, valor: p.liquido, cr: t.cr, techfin });
      } else {
        naoLocalizados++;
        itens.push({ origem: 'TECHFIN', id: p.nsu || p.identificador || `${p.cnpj}|${p.dataPagamento}|${p.valor}`, nome: 'Pix TOTVS sem título localizado', doc: null, duplicata: null, vencimento: null, data: dia(p.dataPagamento), empresa: p.cnpj, detalhe: `Pix ${String(p.dataPagamento || '').slice(0, 16).replace('T', ' ')} bruto ${p.valor.toFixed(2)} − taxa ${p.taxa.toFixed(2)} · nenhum título PIX de R$ ${p.valor.toFixed(2)} nesta filial`, valorDuplicata: p.liquido, valor: p.liquido, techfin });
      }
    }
    resultado.titulosNaoLocalizados += naoLocalizados;
    if (!itens.length) {
      resultado.semLinha.push({ repasse: r.id, conta: `${contaLinha.banco} ${contaLinha.apelido}`, contaId: conta.id, data: dLiq, valor: r.valor, pix: 0, motivo: 'repasse sem Pix listado' });
      continue;
    }
    const soma = round2(itens.reduce((s, it) => s + it.valor, 0));
    if (cents(soma) !== alvo) {
      resultado.avisos.push(`Repasse ${r.id.slice(-8)} ${dLiq} R$ ${r.valor.toFixed(2)}: os Pix listados somam R$ ${soma.toFixed(2)}`);
      continue;
    }
    const nomes = itens.filter((it) => it.nome && it.origem === 'TOTVS_CR').map((it) => `${(it.nome || '').split(' ').slice(0, 2).join(' ')} ${String(it.duplicata || '').split('|')[0]} ${it.valor.toFixed(2)}`);
    const justificativa = `Pix TOTVS via Techfin · repasse ${String(r.dataLiquidacao || '').slice(0, 16).replace('T', ' ')} · ${itens.length} Pix (bruto ${itens.reduce((s, it) => s + it.techfin.bruto, 0).toFixed(2)} − taxas ${itens.reduce((s, it) => s + it.techfin.taxa, 0).toFixed(2)})${nomes.length ? ` · ${nomes.join(' + ')}` : ''}${naoLocalizados ? ` · ${naoLocalizados} sem título no TOTVS` : ''}`;
    const referencia = { itens, motivos: ['repasse da Techfin: valor líquido e data batem com o extrato'], techfin: { repasse: r.id, apelido: r.apelido, conta: r.conta, liquidacao: r.dataLiquidacao, valor: r.valor, pix: itens.length, bruto: round2(itens.reduce((s, it) => s + it.techfin.bruto, 0)), taxas: round2(itens.reduce((s, it) => s + it.techfin.taxa, 0)), naoLocalizados } };
    try {
      if (!simular) await salvarConciliacao({ lancamentoId: l.id, origem: itens.length > 1 ? 'MULTIPLO' : itens[0].origem, referencia, justificativa, usuario, automatico: true, pontuacao: null });
      resultado.conciliadas.push({ lancamentoId: l.id, conta: `${contaLinha.banco} ${contaLinha.apelido}`, data: l.data, valor: l.valor, origem: itens.length > 1 ? 'MULTIPLO' : itens[0].origem, pix: itens.length, titulos: itens.length - naoLocalizados, repasse: r.id });
    } catch (e) {
      resultado.avisos.push(`${l.data} R$ ${Number(l.valor).toFixed(2)} (${contaLinha.banco} ${contaLinha.apelido}): ${e.message}`);
    }
  }
  resultado.totais = {
    conciliadas: resultado.conciliadas.length,
    valorConciliado: round2(resultado.conciliadas.reduce((s, c) => s + Number(c.valor), 0)),
    jaConciliadas: resultado.jaConciliadas.length,
    semLinha: resultado.semLinha.length,
    semConta: resultado.semConta.length,
  };
  return resultado;
}

export default { importarTechfin };
