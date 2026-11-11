// ============================================================
// IMPORTAR FATURA DO CARTÃO (PagBank) → CONCILIAÇÃO AUTOMÁTICA
// (pedido da Titia, 11/11/2026)
//
// Cada compra da fatura está lançada como título no contas a pagar do TOTVS
// (empresa da conta, mesmo valor, emissão até 7 dias da data da compra). Os pagamentos da
// fatura saem no extrato da PagBank ("PAGAMENTO FATURA CARTÃO PAGBANK"):
//   - pagamentos ANTECIPADOS aparecem no histórico da própria fatura;
//   - o pagamento que quita a fatura ANTERIOR também aparece no histórico
//     (é o que soma o "Total fatura" da fatura anterior) → fica de fora aqui;
//   - o pagamento do TOTAL desta fatura sai perto do vencimento (procura no
//     extrato: mesmo valor, vencimento −7 a +10 dias).
// Distribuição: cada pagamento leva o conjunto de compras que soma EXATAMENTE o
// seu valor (preferindo compras até a data dele); se não fechar, distribui por
// ordem de data, usando parte de um título quando preciso (proporcional — a
// conciliação controla o quanto de cada título já foi usado).
// Pagamento cuja compra não está lançada no contas a pagar NÃO concilia (regra
// da Titia: sem lançamento não concilia).
// ============================================================
import { createRequire } from 'node:module';
import supabase from '../config/supabase.js';
import { mapearFiliaisTotvsPorCnpj } from './totvsCartoesStone.js';
import { atribuirChaves, salvarConciliacao, usadosTotais } from './fluxoCaixaConciliacao.js';

const require = createRequire(import.meta.url);
let _pdfjs;
const pdfjs = () => (_pdfjs ||= require('pdfjs-dist/legacy/build/pdf.js'));

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const cents = (v) => Math.round(Number(v) * 100);
const soDig = (v) => String(v ?? '').replace(/\D/g, '');
const brNum = (s) => Number(String(s).replace(/R\$\s?/, '').replace(/\./g, '').replace(',', '.'));
const isoBr = (d) => {
  const [dd, mm, aa] = String(d).split('/');
  return `${aa}-${mm}-${dd}`;
};
const addDias = (iso, n) => {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dias = (a, b) => Math.round((new Date(`${a}T00:00:00Z`) - new Date(`${b}T00:00:00Z`)) / 86400000);
const fmtData = (iso) => String(iso || '').slice(0, 10).split('-').reverse().join('/');

// ─── leitura do PDF ───────────────────────────────────────────
async function linhasDoPdf(buffer, senhas) {
  let doc = null;
  let ultimoErro = null;
  for (const password of [...new Set([undefined, ...senhas.filter(Boolean)])]) {
    try {
      doc = await pdfjs().getDocument({ data: new Uint8Array(buffer), password, useSystemFonts: true, isEvalSupported: false }).promise;
      break;
    } catch (e) {
      ultimoErro = e;
    }
  }
  if (!doc) {
    if (/password/i.test(String(ultimoErro?.name || ultimoErro?.message))) throw new Error('O PDF tem senha e nenhuma das tentadas abriu (o padrão da PagBank é o CNPJ do titular, só números). Informe a senha.');
    throw new Error(`Não consegui abrir o PDF: ${ultimoErro?.message || ultimoErro}`);
  }
  const paginas = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const linhas = [];
    for (const it of tc.items) {
      if (!String(it.str || '').trim()) continue;
      const y = it.transform[5];
      let l = linhas.find((x) => Math.abs(x.y - y) <= 2);
      if (!l) linhas.push((l = { y, itens: [] }));
      l.itens.push({ x: it.transform[4], s: it.str.trim() });
    }
    paginas.push(linhas.sort((a, b) => b.y - a.y).map((l) => l.itens.sort((a, b) => a.x - b.x).map((i) => i.s)));
  }
  return paginas; // [página][linha][colunas]
}

const RE_DATA = /^\d{2}\/\d{2}\/\d{4}$/;
const RE_VALOR = /^-?R?\$?\s?-?[\d.]+,\d{2}$/;

/** Lê a fatura PagBank: vencimento, total, fatura anterior, compras e pagamentos. */
export async function lerFaturaPagbank(buffer, senhas = []) {
  const paginas = await linhasDoPdf(buffer, senhas);
  const p1 = paginas[0] || [];
  const plano = (pag) => pag.map((cols) => cols.join(' | '));
  const l1 = plano(p1);
  const idxVenc = l1.findIndex((l) => /Vencimento/i.test(l));
  const vencLinha = l1.slice(Math.max(0, idxVenc)).find((l) => RE_DATA.test(l.trim()));
  const vencimento = vencLinha ? isoBr(vencLinha.trim()) : null;
  const idxTotal = l1.findIndex((l) => /^Total da fatura$/i.test(l.trim()));
  const totLinha = idxTotal >= 0 ? l1.slice(idxTotal + 1).find((l) => /^R\$\s?-?[\d.]+,\d{2}$/.test(l.trim())) : null;
  const total = totLinha ? brNum(totLinha.trim()) : null;
  const idxAnt = l1.findIndex((l) => /Total fatura\s*\|\s*Pagamento anterior/i.test(l));
  let faturaAnterior = 0;
  if (idxAnt >= 0) {
    const v = (l1[idxAnt + 1] || '').split('|').map((x) => x.trim());
    if (v[0] && /R\$/.test(v[0])) faturaAnterior = brNum(v[0]);
  }
  const cartao = (l1.join(' ').match(/\d{4}\.[*•]{4}\.[*•]{4}\.(\d{4})/) || [])[1] || null;

  const compras = [];
  const pagamentos = [];
  paginas.forEach((pag, ip) => {
    let dentro = false;
    let anterior = null;
    const cartaoPag = (pag.map((c) => c.join(' ')).join(' ').match(/\d{4}\.[*•]{4}\.[*•]{4}\.(\d{4})/) || [])[1] || null;
    for (const cols of pag) {
      const linha = cols.join(' | ');
      if (/^Data \| Transa/i.test(linha)) {
        dentro = true;
        continue;
      }
      if (!dentro) continue;
      if (/^Total despesas/i.test(linha)) {
        dentro = false;
        continue;
      }
      let data = null;
      let desc = null;
      let valor = null;
      if (cols.length >= 3 && RE_DATA.test(cols[0]) && RE_VALOR.test(cols[cols.length - 1])) {
        data = isoBr(cols[0]);
        desc = cols.slice(1, -1).join(' ');
        valor = brNum(cols[cols.length - 1]);
      } else if (cols.length === 2 && RE_DATA.test(cols[0]) && RE_VALOR.test(cols[1])) {
        // compra internacional: a descrição vem na linha de cima, o câmbio na de baixo
        data = isoBr(cols[0]);
        desc = anterior || '(sem descrição)';
        valor = brNum(cols[1]);
      }
      if (data) {
        const item = { data, descricao: desc, valor: round2(valor), cartao: cartaoPag, pagina: ip + 1 };
        if (/^Pagamento de Fatura/i.test(desc)) pagamentos.push(item);
        else compras.push(item);
        anterior = null;
      } else if (!/^USD:|^EUR:/i.test(linha)) anterior = linha;
    }
  });
  const somaCompras = round2(compras.reduce((s, c) => s + c.valor, 0));
  const somaPagamentos = round2(pagamentos.reduce((s, c) => s + c.valor, 0));
  const confere = total != null ? Math.abs(round2(faturaAnterior + somaCompras - somaPagamentos) - total) < 0.02 : null;
  return { vencimento, total, faturaAnterior, cartao, compras, pagamentos, somaCompras, somaPagamentos, confere };
}

// ─── subset-sum exato (centavos) ──────────────────────────────
function subconjuntoExato(itens, alvoCents) {
  // DP sobre somas alcançáveis (itens pequenos em quantidade): soma → [índices]
  let estados = new Map([[0, []]]);
  for (let i = 0; i < itens.length; i++) {
    const v = itens[i].cents;
    if (v <= 0) continue;
    const novos = new Map(estados);
    for (const [s, idx] of estados) {
      const t = s + v;
      if (t > alvoCents || novos.has(t)) continue;
      novos.set(t, [...idx, i]);
      if (t === alvoCents) return novos.get(t).map((k) => itens[k]);
    }
    estados = novos;
    if (estados.size > 200000) return null;
  }
  return estados.has(alvoCents) && alvoCents > 0 ? estados.get(alvoCents).map((k) => itens[k]) : null;
}

// apelidos da fatura → fornecedor do TOTVS (desempate quando há 2 títulos iguais)
const APELIDOS = [
  [/FACEBK|FACEBOOK|META/i, /FACEBOOK|META/i],
  [/DEEPSEEK/i, /DEEPSEEK|^$/i],
  [/GOOGLE/i, /GOOGLE/i],
  [/RENDER/i, /RENDER/i],
  [/ADOBE/i, /ADOBE/i],
  [/DROPBOX/i, /DROPBOX/i],
  [/MERCADOLIVRE|MERCADO LIVRE/i, /EBAZAR|MERCADO/i],
  [/PAGBANK|PAGSEGURO/i, /PAGSEGURO|PAGBANK/i],
  [/ANTHROPIC|CLAUDE/i, /ANTHROPIC/i],
  [/MICROSOFT/i, /MICROSOFT/i],
];
const nomeBate = (desc, fornecedor) => {
  const f = String(fornecedor || '');
  for (const [reD, reF] of APELIDOS) if (reD.test(desc)) return reF.test(f);
  const tok = String(desc).toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).find((t) => t.length >= 4);
  return tok ? f.toUpperCase().includes(tok.slice(0, 5)) : false;
};

/**
 * Importa a fatura e concilia os pagamentos dela no extrato da conta.
 * @param simular true = só mostra o plano
 */
export async function importarFaturaCartao({ contaId, buffer, senha = null, usuario = null, simular = true }) {
  const { data: conta, error: eC } = await supabase.from('fluxo_caixa_contas').select('id,banco,apelido,titular_nome,titular_cnpj').eq('id', contaId).maybeSingle();
  if (eC || !conta) throw new Error('Conta não encontrada.');
  const fatura = await lerFaturaPagbank(buffer, [senha, soDig(conta.titular_cnpj), soDig(conta.titular_cnpj).slice(0, 8)]);
  if (!fatura.vencimento || fatura.total == null) throw new Error('Não reconheci o vencimento/total — é uma fatura do cartão PagBank em PDF?');

  // ── 1) compras → títulos do contas a pagar ──
  const mapa = await mapearFiliaisTotvsPorCnpj().catch(() => null);
  const filiais = (mapa?.get(soDig(conta.titular_cnpj)) || []).map((f) => Number(f.code));
  const usados = await usadosTotais();
  const valores = [...new Set(fatura.compras.map((c) => c.valor).filter((v) => v > 0))];
  const datas = fatura.compras.map((c) => c.data).sort();
  let titulos = [];
  if (valores.length) {
    let q = supabase
      .from('accounts_payable_duplicates_v')
      .select('branch_code,supplier_code,supplier_name,duplicate_code,installment_code,issue_date,due_date,settlement_date,duplicate_value')
      .in('duplicate_value', valores)
      .gte('issue_date', `${addDias(datas[0], -7)}T00:00:00`)
      .lte('issue_date', `${addDias(datas[datas.length - 1], 7)}T23:59:59`);
    if (filiais.length) q = q.in('branch_code', filiais);
    const { data } = await q;
    titulos = data || [];
  }
  const idTitulo = (t) => `${t.branch_code}|${t.duplicate_code}|${t.installment_code}|${t.supplier_code}`;
  const pegos = new Set();
  const compras = fatura.compras
    .map((c, i) => ({ ...c, n: i + 1, cents: cents(c.valor) }))
    .sort((a, b) => a.data.localeCompare(b.data) || a.n - b.n);
  for (const c of compras) {
    if (c.valor <= 0) {
      c.status = 'credito';
      continue;
    }
    const cands = titulos
      .filter((t) => Math.abs(round2(t.duplicate_value) - c.valor) < 0.005 && !pegos.has(idTitulo(t)))
      .map((t) => ({ t, d: Math.abs(dias(String(t.issue_date).slice(0, 10), c.data)), nome: nomeBate(c.descricao, t.supplier_name), usado: usados.get(`TOTVS_CP:${idTitulo(t)}`) || 0 }))
      .filter((x) => x.d <= 7) // título lançado até 7 dias da compra
      // prefere título ainda não usado, depois nome do fornecedor batendo, depois data mais perto
      .sort((a, b) => Number(a.usado > 0.005) - Number(b.usado > 0.005) || Number(b.nome) - Number(a.nome) || a.d - b.d);
    const esc = cands[0];
    if (!esc) {
      c.status = 'sem_lancamento';
      continue;
    }
    pegos.add(idTitulo(esc.t));
    c.status = 'ok';
    c.titulo = {
      id: idTitulo(esc.t),
      empresa: esc.t.branch_code,
      duplicata: esc.t.duplicate_code,
      parcela: esc.t.installment_code,
      fornecedorCodigo: esc.t.supplier_code,
      fornecedor: esc.t.supplier_name || null,
      emissao: String(esc.t.issue_date).slice(0, 10),
      vencimento: String(esc.t.due_date || '').slice(0, 10) || null,
      valor: round2(esc.t.duplicate_value),
      disponivel: round2(esc.t.duplicate_value - esc.usado),
    };
  }

  // ── 2) pagamentos desta fatura ──
  // o(s) do histórico que somam o total da fatura ANTERIOR pagam a anterior
  const pagHist = fatura.pagamentos.map((p, i) => ({ ...p, n: i + 1, cents: cents(p.valor) })).sort((a, b) => a.data.localeCompare(b.data) || a.n - b.n);
  let daAnterior = [];
  if (fatura.faturaAnterior > 0.005) daAnterior = subconjuntoExato(pagHist, cents(fatura.faturaAnterior)) || [];
  const antecipados = pagHist.filter((p) => !daAnterior.includes(p));
  // linhas do extrato (saídas de pagamento de fatura) no período
  const { data: lancs } = await supabase
    .from('fluxo_caixa_lancamentos')
    .select('*')
    .eq('conta_id', contaId)
    .gte('data', addDias(datas[0] || fatura.vencimento, -40))
    .lte('data', addDias(fatura.vencimento, 15))
    .order('data')
    .order('seq')
    .order('id');
  atribuirChaves(lancs || []);
  const saidasFatura = (lancs || []).filter((l) => Number(l.valor) < 0 && /FATURA/i.test(`${l.descricao} ${l.memo}`));
  const chaves = saidasFatura.map((l) => l.chave);
  const concPorChave = new Map();
  for (let i = 0; i < chaves.length; i += 200) {
    const { data } = await supabase.from('fluxo_caixa_conciliacoes').select('id,chave,justificativa').in('chave', chaves.slice(i, i + 200));
    for (const c of data || []) concPorChave.set(c.chave, c);
  }
  const usadasExtrato = new Set();
  const acharSaida = (valor, de, ate, preferida) => {
    const c = saidasFatura
      .filter((l) => !usadasExtrato.has(l.id) && Math.abs(Math.abs(Number(l.valor)) - valor) < 0.005 && l.data >= de && l.data <= ate)
      .sort((a, b) => Math.abs(dias(a.data, preferida)) - Math.abs(dias(b.data, preferida)));
    if (!c[0]) return null;
    usadasExtrato.add(c[0].id);
    return c[0];
  };
  const pagamentos = antecipados.map((p) => ({ tipo: 'antecipado', data: p.data, valor: p.valor, cents: p.cents, saida: acharSaida(p.valor, addDias(p.data, -2), addDias(p.data, 2), p.data) }));
  if (fatura.total > 0.005) {
    const s = acharSaida(fatura.total, addDias(fatura.vencimento, -7), addDias(fatura.vencimento, 10), fatura.vencimento);
    pagamentos.push({ tipo: 'total', data: s?.data || fatura.vencimento, valor: fatura.total, cents: cents(fatura.total), saida: s });
  }

  // ── 3) distribuição das compras nos pagamentos ──
  const restantes = compras.filter((c) => c.valor > 0);
  const fatias = new Map(); // pagamento → [{ compra, valor }]
  for (const p of pagamentos) fatias.set(p, []);
  // 3a) exato: compras até a data do pagamento, depois qualquer uma
  for (const p of pagamentos) {
    const ate = restantes.filter((c) => c.data <= p.data);
    const sub = subconjuntoExato(ate, p.cents) || subconjuntoExato(restantes, p.cents);
    if (sub) {
      fatias.set(p, sub.map((c) => ({ compra: c, valor: c.valor })));
      for (const c of sub) restantes.splice(restantes.indexOf(c), 1);
      p.distribuicao = 'exata';
    }
  }
  // 3b) proporcional: pagamentos sem conjunto exato consomem as compras restantes por data
  const filaCompras = restantes.map((c) => ({ compra: c, resta: c.valor }));
  for (const p of pagamentos) {
    if (p.distribuicao) continue;
    let falta = p.valor;
    const lista = [];
    for (const f of filaCompras) {
      if (falta <= 0.005) break;
      if (f.resta <= 0.005) continue;
      const usar = round2(Math.min(f.resta, falta));
      lista.push({ compra: f.compra, valor: usar, parcial: usar < f.compra.valor - 0.005 });
      f.resta = round2(f.resta - usar);
      falta = round2(falta - usar);
    }
    fatias.set(p, lista);
    p.distribuicao = falta > 0.005 ? 'incompleta' : 'proporcional';
    p.falta = falta > 0.005 ? falta : 0;
  }

  // ── 4) status / gravação ──
  const out = [];
  for (const p of pagamentos) {
    const lista = fatias.get(p) || [];
    const semLanc = lista.filter((x) => x.compra.status !== 'ok');
    const r = {
      tipo: p.tipo,
      data: p.data,
      valor: p.valor,
      distribuicao: p.distribuicao,
      saida: p.saida ? { id: p.saida.id, data: p.saida.data, valor: Math.abs(Number(p.saida.valor)), descricao: p.saida.descricao } : null,
      compras: lista.map((x) => ({ n: x.compra.n, data: x.compra.data, descricao: x.compra.descricao, valor: x.valor, valorCompra: x.compra.valor, parcial: !!x.parcial, titulo: x.compra.titulo || null, status: x.compra.status })),
    };
    if (!p.saida) r.status = p.tipo === 'total' ? 'aguardando_extrato' : 'sem_saida_no_extrato';
    else if (concPorChave.has(p.saida.chave)) r.status = 'ja_conciliada';
    else if (semLanc.length) r.status = 'sem_lancamento';
    else if (p.distribuicao === 'incompleta') r.status = 'nao_fecha';
    else r.status = 'pronta';
    r.motivo = {
      aguardando_extrato: `pagamento do total (vencimento ${fmtData(fatura.vencimento)}) ainda não está no extrato importado`,
      sem_saida_no_extrato: 'saída não encontrada no extrato da conta',
      ja_conciliada: `saída já conciliada${concPorChave.get(p.saida?.chave)?.justificativa ? `: ${concPorChave.get(p.saida.chave).justificativa}` : ''}`,
      sem_lancamento: `compra sem título no contas a pagar: ${semLanc.map((x) => `${x.compra.descricao} ${x.compra.valor.toFixed(2)} (${fmtData(x.compra.data)})`).join('; ')} — lance a duplicata e importe de novo`,
      nao_fecha: `as compras não cobrem o pagamento (faltam R$ ${Number(p.falta || 0).toFixed(2)} — juros/IOF/estorno?)`,
      pronta: null,
    }[r.status];
    if (r.status === 'pronta' && !simular) {
      try {
        const itens = lista.map((x) => ({
          origem: 'TOTVS_CP',
          id: x.compra.titulo.id,
          nome: x.compra.titulo.fornecedor || x.compra.descricao,
          duplicata: `${x.compra.titulo.duplicata}|${x.compra.titulo.parcela}`,
          valor: x.compra.titulo.valor,
          valorDuplicata: x.compra.titulo.valor,
          vencimento: x.compra.titulo.vencimento,
          empresa: `Empresa ${x.compra.titulo.empresa}`,
          detalhe: `fatura cartão ${conta.banco} ${fatura.cartao || ''} (venc. ${fmtData(fatura.vencimento)}) · ${x.compra.descricao} ${fmtData(x.compra.data)}`,
        }));
        const conc = await salvarConciliacao({
          lancamentoId: p.saida.id,
          origem: itens.length > 1 ? 'MULTIPLO' : 'TOTVS_CP',
          referencia: { itens, motivos: [`fatura do cartão ${conta.banco} ${fatura.cartao || ''} importada (${p.distribuicao})`] },
          justificativa: `Fatura cartão ${conta.banco} ${fatura.cartao || ''} (venc. ${fmtData(fatura.vencimento)}) — ${p.tipo === 'total' ? 'pagamento do total' : 'pagamento antecipado'} ${fmtData(p.data)}: ${lista.map((x) => `${x.compra.descricao} ${x.valor.toFixed(2)}${x.parcial ? ' (parte)' : ''}`).join(' + ')}`.slice(0, 900),
          usuario: usuario || 'Importar fatura do cartão',
          automatico: false,
        });
        r.status = 'conciliada';
        r.conciliacaoId = conc?.id || null;
      } catch (e) {
        r.status = 'erro';
        r.motivo = e.message;
      }
    }
    out.push(r);
  }
  const usadasNaDistribuicao = new Set(out.flatMap((r) => r.compras.map((c) => c.n)));
  return {
    conta: { id: conta.id, apelido: conta.apelido, banco: conta.banco },
    fatura: { vencimento: fatura.vencimento, total: fatura.total, faturaAnterior: fatura.faturaAnterior, cartao: fatura.cartao, somaCompras: fatura.somaCompras, somaPagamentos: fatura.somaPagamentos, confere: fatura.confere },
    compras: compras.map((c) => ({ n: c.n, data: c.data, descricao: c.descricao, valor: c.valor, status: c.status, titulo: c.titulo || null, distribuida: usadasNaDistribuicao.has(c.n) })),
    pagamentosFaturaAnterior: daAnterior.map((p) => ({ data: p.data, valor: p.valor })),
    pagamentos: out,
    simulado: !!simular,
  };
}

export default { lerFaturaPagbank, importarFaturaCartao };
