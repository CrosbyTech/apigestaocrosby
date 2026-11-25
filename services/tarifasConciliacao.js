// ============================================================
// TARIFAS BANCÁRIAS DO EXTRATO → DUPLICATA (TOTVS + Solicitação) + CONCILIAÇÃO
// Pedido do João (Recuperação de Créditos), 09/11/2026.
//
// Na tela Conciliação, saídas pequenas de tarifa / encargo / IOF / custas de
// protesto ficam pendentes porque não existe duplicata para elas. Para cada
// saída marcada:
//   1) cria a duplicata no contas a pagar do TOTVS no nome do BANCO DA CONTA
//      (Stone, Sicredi, Itaú…), empresa = titular da conta, valor e datas da
//      saída, despesa 7008 TARIFAS BANCARIAS, centro de custo 10, portador 1020
//      (o mesmo padrão das tarifas lançadas à mão no TOTVS);
//   2) grava a Solicitação Crosby correspondente (setor FINANCEIRO, status
//      enviado_totvs, paga na data da saída) com a observação de que veio da
//      Conciliação HeadCoach;
//   3) concilia a saída com essa Solicitação (sai de "pendente" na hora).
// Só aceita saída que é tarifa/encargo — o resto é recusado com o motivo.
// ============================================================
import axios from 'axios';
import supabase from '../config/supabase.js';
import { getToken } from '../utils/totvsTokenManager.js';
import { TOTVS_BASE_URL, httpsAgent } from '../totvsrouter/totvsHelper.js';
import { registrarComando as registrarComandoAP, sincronizarDuplicata as sincronizarDuplicataAP } from './erp/contasPagar.js';
import { mapearFiliaisTotvsPorCnpj } from './totvsCartoesStone.js';
import { salvarConciliacao, lancamentoComChave } from './fluxoCaixaConciliacao.js';

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const soDig = (v) => String(v ?? '').replace(/\D/g, '');
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const fmtData = (iso) => String(iso).slice(0, 10).split('-').reverse().join('/');

export const DESPESA_TARIFA = { codigo: 7008, nome: 'TARIFAS BANCARIAS', centroCusto: 10, portador: 1020 };

// Fornecedor (como está cadastrado no TOTVS) de cada banco — conferido em 09/11/2026
// nas tarifas já lançadas (despesa 7008) e no cadastro de pessoas.
export const FORNECEDOR_BANCO = {
  STONE: { cnpj: '45283962000133', nome: 'STONE INSTITUICAO FINANCEIRA DE PAGAMENTO' },
  SICREDI: { cnpj: '70038237000147', nome: 'COOPERATIVA DE CREDITO, POUPANCA E INVESTIMENTO RN - SICREDI' },
  ITAU: { cnpj: '60701190278560', nome: 'ITAU UNIBANCO S.A.' },
  CAIXA: { cnpj: '00360305000104', nome: 'CAIXA ECONOMICA FEDERAL' },
  SANTANDER: { cnpj: '90400888000142', nome: 'SANTANDER BR' },
  BNB: { cnpj: '07237373000120', nome: 'BANCO DO NORDESTE DO BRASIL SA' },
  PAGBANK: { cnpj: '08561701000101', nome: 'PAGSEGURO INTERNET INSTITUICAO DE PAGAMENTO S.A.' },
  UNICRED: { cnpj: '73750424000147', nome: 'COOPERATIVA DE ECONOMIA E CREDITO MUTUO UNICRED INTEGRACAO' },
};

/**
 * Saída que pode virar duplicata em lote ("tarifas e afins").
 * Entra: tarifa, encargo, IOF, custas/protesto/cartório, juros/mensalidade/
 * anuidade/cesta e CANCELAMENTO/ESTORNO DE VENDA (João, 09/11/2026).
 * Fica de fora: Pix, pagamento de boleto, transferência, compra no cartão e
 * fatura de cartão (ex.: anúncios Facebook de R$ 5 mil no cartão pré-pago Stone
 * — não são tarifa; virariam "Tarifa bancária" errada no TOTVS).
 */
export function motivoNaoTarifa(l) {
  if (!l || Number(l.valor) >= 0) return 'não é saída';
  if (l.transferencia_id || l.tipo === 'TRANSFERENCIA') return 'transferência';
  const forma = semAcento(l.forma).toUpperCase();
  const cat = String(l.categoria || '').toLowerCase();
  const txt = semAcento(`${l.descricao || ''} ${l.memo || ''}`).toUpperCase();
  // tarifa vem antes: "TAR PIX" (Caixa) e "TARIFA BOLETO STONE" são tarifas
  if (/TARIFA|ENCARGO/.test(forma) || cat === 'tarifa' || /^TAR(IFA)?\b/.test(txt)) return null;
  if (/PIX/.test(forma) || cat === 'pix' || /\bPIX\b/.test(txt)) return 'Pix';
  if (/BOLETO/.test(forma) || cat === 'boleto' || cat === 'pagamento' || /\bBOLETO\b|PAGAMENTO DE TITULO|PAGTO\.? TITULO|LIQUIDACAO DE TITULO/.test(txt)) return 'pagamento de boleto';
  if (/TRANSFER/.test(forma) || cat === 'transferencia') return 'transferência';
  if (/FATURA/.test(forma) || /FATURA CARTAO|PAGAMENTO FATURA/.test(txt)) return 'fatura de cartão';
  if (/COMPRA CARTAO/.test(forma) || cat === 'cartao_compra' || /COMPRA CARTAO/.test(txt)) return 'compra no cartão';
  if (/TARIFA|ENCARGO/.test(forma) || cat === 'tarifa') return null;
  if (/\b(TARIFA|TAR\b|TAXA|IOF|ENCARGO|ENCARGOS|PROTESTO|CUSTAS|CARTORIO|MENSALIDADE|ANUIDADE|CESTA|MANUTENCAO DE CONTA|JUROS)\b/.test(txt)) return null;
  if (/CANCELAMENTO DE VENDA|ESTORNO DE VENDA|CHARGEBACK/.test(txt)) return null;
  return 'não é tarifa/encargo';
}
export const ehTarifa = (l) => motivoNaoTarifa(l) === null;

// ─── sugestão de fornecedor e despesa (estudo das despesas do TOTVS) ───
// 1) tarifa → 7008; 2) histórico do fornecedor no contas a pagar do TOTVS
// (cópia accounts_payable_duplicates): pelo CPF/CNPJ da contraparte ou pelo
// nome → código do fornecedor + despesa mais usada; 3) palavras do histórico.
export const DESPESAS_NOMES = {
  7008: 'TARIFAS BANCARIAS', 6031: 'PROPAGANDA E ANUNCIOS', 6024: 'LANCHES E REFEICOES', 6012: 'TELEFONE', 6028: 'INTERNET',
  6042: 'SOFTWARE E SISTEMA', 6033: 'COMBUSTIVEIS', 6019: 'DESPESAS LEGAIS E JUDICIAIS', 11009: 'CONSORCIO', 3036: 'VALE TRANSPORTE',
  1002: 'COMPRA DE MATERIA PRIMA', 6009: 'CARTAO DE CREDITO EMPRESARIAL', 3022: 'RESCISAO CONTRATO DE TRABALHO', 6008: 'TAXA DE ENTREGA (CLIENTE)',
  6017: 'ASSISTENCIA CONTABIL', 6020: 'CONSULTORIA OPERACIONAL', 3014: 'FGTS', 4001: 'ALUGUEIS DE IMOVEIS',
};
const REGRAS_DESPESA = [
  [/FACEBK|FACEBOOK|GOOGLE ?ADS|\bMETA\b|TIKTOK/, 6031],
  [/IFOOD|RESTAURANTE|LANCHE/, 6024],
  [/\bCLARO\b|\bVIVO\b|\bTIM\b|TELEFONICA/, 6012],
  [/CABO SERVICOS|TELECOMUNICAC|BRISANET|INTERNET/, 6028],
  [/RENDER\.COM|DISPARO PRO|SOFTWARE|SISTEMA|BEE TECNOLOGIA/, 6042],
  [/COMBUSTIV|POSTO /, 6033],
  [/TRIBUNAL DE JUS|JUSTICA|CARTORIO/, 6019],
  [/CONSORCI|CONSOR(\s|$)/, 11009],
  [/SINDICATO .*TRANSP|VALE TRANSPORTE|SETRANS/, 3036],
  [/INDUSTRIA TEXTIL|TEXTIL|TECIDO|MALHA/, 1002],
  [/FATURA CARTAO/, 6009],
  [/RESCISAO/, 3022],
  [/DELIVERY|ENTREGA|LALAMOVE|LOGGI/, 6008],
];
const STOP = new Set(['LTDA', 'S/A', 'SA', 'ME', 'EPP', 'EIRELI', 'DE', 'DO', 'DA', 'DOS', 'DAS', 'E', 'COM', 'SERVICOS', 'COMERCIO', 'INSTITUICAO', 'PAGAMENTO', 'BRASIL', 'AGENCIA', 'CIA', 'EMPREENDIMENTOS', 'PARTICIPACOES', 'IMOBILIARIOS', 'IMOBILIARIA', 'INDUSTRIA', 'CONSULTORIA', 'ADMINISTRADORA', 'TECNOLOGIA', 'DIGITAIS', 'FINANCEIROS', 'ONLINE', 'GRUPO', 'HOLDING']);
const tokens = (sx) => semAcento(sx).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter((t) => t.length >= 3 && !STOP.has(t));

async function historicoFornecedores(itens) {
  // por documento
  const docs = [...new Set(itens.map((i) => soDig(i.contraparteDoc)).filter((d) => d.length === 11 || d.length === 14))];
  const porDoc = new Map();
  for (let k = 0; k < docs.length; k += 100) {
    const { data } = await supabase.from('accounts_payable_duplicates_v').select('supplier_code,supplier_name,supplier_cpf_cnpj,expense').in('supplier_cpf_cnpj', docs.slice(k, k + 100)).limit(5000);
    for (const r of data || []) {
      const d = soDig(r.supplier_cpf_cnpj);
      if (!porDoc.has(d)) porDoc.set(d, []);
      porDoc.get(d).push(r);
    }
  }
  return porDoc;
}
function topDespesa(rows) {
  const cnt = new Map();
  for (const r of rows) for (const e of Array.isArray(r.expense) ? r.expense : []) {
    const k = Number(e.expenseCode);
    if (!k) continue;
    const c = cnt.get(k) || { n: 0, nome: e.expenseName };
    c.n += 1;
    cnt.set(k, c);
  }
  const best = [...cnt.entries()].sort((a, b) => b[1].n - a[1].n)[0];
  return best ? { codigo: best[0], nome: best[1].nome, vezes: best[1].n } : null;
}
async function porNome(nome) {
  const tks = tokens(nome);
  if (!tks.length) return null;
  const principal = tks.sort((a, b) => b.length - a.length)[0];
  const { data } = await supabase.from('accounts_payable_duplicates_v').select('supplier_code,supplier_name,supplier_cpf_cnpj,expense').ilike('supplier_name', `%${principal}%`).limit(500);
  if (!data?.length) return null;
  const grupos = new Map();
  for (const r of data) {
    const g = grupos.get(r.supplier_code) || { rows: [], nome: r.supplier_name, doc: r.supplier_cpf_cnpj };
    g.rows.push(r);
    grupos.set(r.supplier_code, g);
  }
  const alvo = new Set(tokens(nome));
  // só 1 palavra em comum vale se for a 1ª palavra do fornecedor ("RENDER.COM" →
  // RENDER); evita "R CARVALHO" → "HERMELINDA ... CARVALHO" e "MIRANDA
  // EMPREENDIMENTOS" → "VERISSIMO ... EMPREENDIMENTOS"
  const score = (g) => {
    const t = tokens(g.nome);
    const comuns = t.filter((x) => alvo.has(x));
    if (!comuns.length) return 0;
    if (comuns.length === 1 && (t[0] !== comuns[0] || g.rows.length < 2)) return 0;
    return comuns.length / Math.max(1, Math.min(t.length, alvo.size));
  };
  const melhor = [...grupos.entries()].map(([code, g]) => ({ code, ...g, sc: score(g) })).sort((a, b) => b.sc - a.sc || b.rows.length - a.rows.length)[0];
  if (!melhor || melhor.sc < 0.5) return null;
  return { codigo: Number(melhor.code), nome: melhor.nome, doc: soDig(melhor.doc), despesa: topDespesa(melhor.rows) };
}

/** Sugere fornecedor (código TOTVS) e despesa para cada saída pendente. Muta os itens (campo `sugestao`). */
export async function sugerirFornecedorDespesa(itens) {
  const porDoc = await historicoFornecedores(itens);
  const cacheNome = new Map();
  for (const i of itens) {
    const txt = semAcento(`${i.descricao || ''} ${i.memo || ''} ${i.contraparte || ''}`).toUpperCase();
    const sug = { fornecedorCodigo: null, fornecedorNome: null, despesaCodigo: null, despesaNome: null, fonte: null };
    if (i.tarifa) {
      const f = FORNECEDOR_BANCO[String(i.banco || '').toUpperCase()];
      Object.assign(sug, { fornecedorNome: f?.nome || null, despesaCodigo: DESPESA_TARIFA.codigo, despesaNome: DESPESA_TARIFA.nome, fonte: 'tarifa (fornecedor = banco da conta)' });
      i.sugestao = sug;
      continue;
    }
    let hist = null;
    const doc = soDig(i.contraparteDoc);
    if (porDoc.has(doc)) {
      const rows = porDoc.get(doc);
      hist = { codigo: Number(rows[0].supplier_code), nome: rows[0].supplier_name, doc, despesa: topDespesa(rows) };
    } else if (i.contraparte) {
      const k = semAcento(i.contraparte).toUpperCase();
      if (!cacheNome.has(k)) cacheNome.set(k, await porNome(i.contraparte).catch(() => null));
      hist = cacheNome.get(k);
    }
    if (hist) {
      sug.fornecedorCodigo = hist.codigo;
      sug.fornecedorNome = hist.nome;
      // 126 DESPESAS NAO IDENTIFICADAS não ajuda: deixa a regra por palavra decidir
      if (hist.despesa && Number(hist.despesa.codigo) !== 126) Object.assign(sug, { despesaCodigo: hist.despesa.codigo, despesaNome: hist.despesa.nome, fonte: `histórico do fornecedor no TOTVS (${hist.despesa.vezes}x)` });
    }
    if (!sug.despesaCodigo) {
      const regra = REGRAS_DESPESA.find(([re]) => re.test(txt));
      if (regra) Object.assign(sug, { despesaCodigo: regra[1], despesaNome: DESPESAS_NOMES[regra[1]] || null, fonte: sug.fonte || 'palavra do histórico' });
    }
    i.sugestao = sug;
  }
  return itens;
}

/** Pessoa do TOTVS pelo código (PJ ou PF) → { code, nome, doc }. */
export async function fornecedorPorCodigo(codigo) {
  const c = Number(soDig(codigo));
  if (!c) return null;
  const tk = await getToken();
  for (const [path, campo] of [['/person/v2/legal-entities/search', 'cnpj'], ['/person/v2/individuals/search', 'cpf']]) {
    const r = await axios.post(`${TOTVS_BASE_URL}${path}`, { filter: { personCodeList: [c] }, page: 1, pageSize: 1 }, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk.access_token}` }, httpsAgent, timeout: 30000 }).catch(() => null);
    const it = r?.data?.items?.[0];
    if (it) return { code: Number(it.code), nome: it.name || it.fantasyName || null, doc: soDig(it[campo] || it.cpfCnpj), fornecedor: it.isSupplier !== false };
  }
  return null;
}

/**
 * Fornecedor para o Contas a Pagar HeadCoach (cópia local erp_pessoas). Se não
 * estiver na cópia, lê o cadastro (só leitura) e grava a cópia.
 * @returns { code, nome, cpf_cnpj, naoFornecedor? } | null
 */
async function fornecedorHc({ code = null, cnpj = null }) {
  const doc = soDig(cnpj);
  let q = supabase.from('erp_pessoas').select('code,nome,cpf_cnpj,is_fornecedor,inativo');
  q = code ? q.eq('code', code) : q.eq('cpf_cnpj', doc);
  let { data } = await q;
  if (!data?.length) {
    try {
      const [{ totvs }, { mapPessoa }] = await Promise.all([import('./erp/totvsClient.js'), import('./erp/sync/entidades.js')]);
      for (const [rota, tipo] of [['legal-entities', 'PJ'], ['individuals', 'PF']]) {
        const filtro = code ? { personCodeList: [code] } : tipo === 'PJ' ? { cnpjList: [doc] } : { cpfList: [doc] };
        if (!code && (tipo === 'PJ') !== (doc.length === 14)) continue;
        const r = await totvs('POST', `/person/v2/${rota}/search`, { data: { filter: filtro, expand: 'phones,emails,addresses,classifications', page: 1, pageSize: 10 }, timeout: 30000 });
        const itens = r?.items || r?.data?.items || [];
        if (itens.length) {
          const linhas = itens.map((x) => mapPessoa(x, tipo));
          await supabase.from('erp_pessoas').upsert(linhas, { onConflict: 'code' });
          data = linhas;
          break;
        }
      }
    } catch {
      /* sem cadastro */
    }
  }
  if (!data?.length) return null;
  const ativos = data.filter((x) => !x.inativo);
  const escolhido = ativos.find((x) => x.is_fornecedor) || ativos[0] || data[0];
  return { code: Number(escolhido.code), nome: escolhido.nome, cpf_cnpj: escolhido.cpf_cnpj, ...(escolhido.is_fornecedor ? {} : { naoFornecedor: true }) };
}

/** Saídas PENDENTES de todas as contas no período (mesma regra da tela), com a conta. */
export async function saidasPendentes({ de, ate, escopo = 'crosby', sentido = 'SAIDA' }) {
  const { anexarConciliacoes } = await import('./fluxoCaixaConciliacao.js');
  const { data: contas, error: eC } = await supabase.from('fluxo_caixa_contas').select('id,banco,apelido,titular_nome,titular_cnpj,escopo,ativo');
  if (eC) throw new Error(eC.message);
  // Pagar.me é adquirente e fica fora da tela da Conciliação (BANCOS_FORA no front) — mesma regra aqui
  const contasEsc = (contas || []).filter((c) => (c.escopo || 'crosby') === escopo && c.ativo !== false && String(c.banco || '').toUpperCase() !== 'PAGARME');
  const contaDe = new Map(contasEsc.map((c) => [c.id, c]));
  const todos = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('fluxo_caixa_lancamentos')
      .select('*')
      .in('conta_id', [...contaDe.keys()])
      .gte('data', de)
      .lte('data', ate)
      .order('conta_id')
      .order('data')
      .order('seq')
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    todos.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const lista = todos.map((l) => {
    const c = contaDe.get(l.conta_id);
    return { ...l, valor: Number(l.valor), banco: c?.banco, conta_apelido: c?.apelido, conta_cnpj: c?.titular_cnpj };
  });
  await anexarConciliacoes(lista, { de, ate });
  const mapa = await mapearFiliaisTotvsPorCnpj().catch(() => null);
  return lista
    .filter((l) => (sentido === 'ENTRADA' ? l.valor > 0 : l.valor < 0) && l.pendente && !l.transferencia_id && l.tipo !== 'TRANSFERENCIA')
    .map((l) => {
      const c = contaDe.get(l.conta_id);
      const filial = (mapa?.get(soDig(c?.titular_cnpj)) || [])[0] || null;
      return {
        id: l.id,
        data: l.data,
        valor: round2(Math.abs(l.valor)),
        forma: l.forma,
        categoria: l.categoria,
        descricao: l.descricao,
        memo: l.memo,
        contraparte: l.contraparte_nome || null,
        contraparteDoc: l.contraparte_doc || null,
        documento: l.documento || null,
        contaId: l.conta_id,
        conta: c?.apelido || null,
        banco: c?.banco || null,
        titular: c?.titular_nome || null,
        cnpj: c?.titular_cnpj || null,
        empresa: filial ? `${filial.code} · ${filial.nome}` : c?.titular_nome || null,
        tarifa: ehTarifa(l) && !!FORNECEDOR_BANCO[String(c?.banco || '').toUpperCase()],
        elegivel: ehTarifa(l) && !!FORNECEDOR_BANCO[String(c?.banco || '').toUpperCase()],
        motivoBloqueio: motivoNaoTarifa(l) || (!FORNECEDOR_BANCO[String(c?.banco || '').toUpperCase()] ? `banco ${c?.banco} sem fornecedor no TOTVS` : null),
      };
    })
    .sort((a, b) => String(a.empresa).localeCompare(String(b.empresa)) || String(a.banco).localeCompare(String(b.banco)) || a.data.localeCompare(b.data));
}

/** Entradas PENDENTES de todas as contas (Inefável, 10/11/2026) — mesma regra da tela, sem sugestão de despesa. */
export async function entradasPendentes(p) {
  const itens = await saidasPendentes({ ...p, sentido: 'ENTRADA' });
  return itens.map(({ tarifa, elegivel, motivoBloqueio, ...i }) => i);
}

/** Saídas pendentes + sugestão de fornecedor/despesa. */
export async function saidasPendentesComSugestao(p) {
  const itens = await saidasPendentes(p);
  await sugerirFornecedorDespesa(itens);
  return itens;
}

const novoCodigo = () => Math.floor(10000000 + Math.random() * 89999999);
const ehCodigoDuplicado = (e) => /DuplicateCode/i.test(JSON.stringify(e?.response?.data || e?.message || '')) && /(already|duplicate|exist)/i.test(JSON.stringify(e?.response?.data || e?.message || ''));
const msgTotvs = (e) => {
  const d = e?.response?.data;
  if (Array.isArray(d)) return d.map((x) => x.message || x.detailedMessage).filter(Boolean).join(' | ');
  if (d?.message) return d.message;
  return e?.message || String(e);
};
const diaAntes = (iso) => {
  const x = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() - 1);
  return x.toISOString().slice(0, 10);
};
// a TOTVS recusa emissão/chegada = hoje: recua para ontem
const dataPassada = (iso) => {
  const hoje = new Date().toISOString().slice(0, 10);
  let d = String(iso).slice(0, 10);
  if (d >= hoje) {
    const x = new Date(`${hoje}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() - 1);
    d = x.toISOString().slice(0, 10);
  }
  return `${d}T15:00:00.000Z`;
};

async function criarNoTotvs({ branchCnpj, supplierCpfCnpj, valor, data, observacao, despesaCodigo = DESPESA_TARIFA.codigo }) {
  const tk = await getToken();
  let token = tk.access_token;
  let ultimo = null;
  for (let tentativa = 1; tentativa <= 5; tentativa++) {
    const duplicateCode = novoCodigo();
    const payload = {
      branchCnpj,
      supplierCpfCnpj,
      duplicateCode,
      installments: [
        {
          installmentCode: 1,
          bearerCode: DESPESA_TARIFA.portador,
          // TOTVS: "Invalid DueDate" quando vencimento = emissão (09/11/2026, todas
          // as 96 duplicatas aceitas tinham vencimento > emissão). Emissão/chegada
          // 1 dia antes da saída; vencimento = data da saída.
          issueDate: dataPassada(diaAntes(data)),
          arrivalDate: dataPassada(diaAntes(data)),
          dueDate: `${String(data).slice(0, 10)}T15:00:00.000Z`,
          duplicateValue: valor,
          expenses: [{ expenseCode: despesaCodigo, costCenterCode: DESPESA_TARIFA.centroCusto, proratedPercentage: 100 }],
          Document: 1, // Duplicate
          Prevision: 2, // Real
          Stage: 1, // InvoiceNotConfered
        },
      ],
    };
    const post = (t) => axios.post(`${TOTVS_BASE_URL}/accounts-payable/v2/duplicates`, payload, { headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${t}` }, httpsAgent, timeout: 60000 });
    try {
      let resp;
      try {
        resp = await post(token);
      } catch (e) {
        if (e.response?.status !== 401) throw e;
        token = (await getToken(true)).access_token;
        resp = await post(token);
      }
      // espelho ERP (accounts_payable_commands / _duplicates), em segundo plano
      setImmediate(() => {
        Promise.resolve()
          .then(async () => {
            await registrarComandoAP({ command: 'create', payload, sucesso: true, http_status: resp.status, resposta: resp.data ?? null, origem_tabela: 'conciliacao-tarifas', origem_id: null });
            const n = await sincronizarDuplicataAP({ ...payload, comando: payload });
            if (!n) setTimeout(() => sincronizarDuplicataAP({ ...payload, comando: payload }).catch(() => {}), 60000);
          })
          .catch((e) => console.warn('[tarifas] espelho AP:', e.message));
      });
      return { duplicateCode, payload, resposta: resp.data ?? null };
    } catch (e) {
      ultimo = e;
      // falha também fica no espelho (accounts_payable_commands) para diagnóstico
      registrarComandoAP({ command: 'create', payload, sucesso: false, http_status: e.response?.status ?? null, resposta: e.response?.data ?? null, erro: e.message, origem_tabela: 'conciliacao-tarifas', origem_id: null }).catch(() => {});
      if (ehCodigoDuplicado(e)) continue; // sorteia outro número
      throw new Error(`TOTVS recusou a duplicata: ${msgTotvs(e)}`);
    }
  }
  throw new Error(`TOTVS recusou a duplicata: ${msgTotvs(ultimo)}`);
}

/**
 * @param {number[]} lancamentoIds  saídas do extrato (fluxo_caixa_lancamentos.id)
 * @param {boolean} [simular]       só valida e mostra o que faria
 */
export async function criarDuplicatasTarifas({ lancamentoIds, itens: itensIn = null, usuario = null, simular = false }) {
  // itens: [{ lancamentoId, fornecedorCodigo?, despesaCodigo? }] — fornecedor e
  // despesa escolhidos na tela (qualquer saída); sem eles, só tarifa (banco + 7008)
  const escolhas = new Map((itensIn || []).map((x) => [Number(x.lancamentoId), x]));
  const ids = [...new Set([...(lancamentoIds || []), ...(itensIn || []).map((x) => x.lancamentoId)].map(Number).filter(Boolean))];
  if (!ids.length) throw new Error('Marque pelo menos uma saída.');
  const mapa = await mapearFiliaisTotvsPorCnpj().catch(() => null);
  const contasCache = new Map();
  const out = { criadas: [], recusadas: [], total: 0 };

  for (const id of ids) {
    let l;
    try {
      l = await lancamentoComChave(id);
    } catch (e) {
      out.recusadas.push({ lancamentoId: id, motivo: e.message });
      continue;
    }
    const base = { lancamentoId: id, data: l.data, valor: Math.abs(Number(l.valor)), descricao: l.descricao || l.memo };
    const esc = escolhas.get(id) || {};
    const temEscolha = !!(soDig(esc.fornecedorCodigo) && soDig(esc.despesaCodigo));
    if (l.transferencia_id || l.tipo === 'TRANSFERENCIA' || Number(l.valor) >= 0) {
      out.recusadas.push({ ...base, motivo: 'transferência/entrada não vira duplicata.' });
      continue;
    }
    if (!temEscolha && !ehTarifa(l)) {
      out.recusadas.push({ ...base, motivo: `${motivoNaoTarifa(l)}: informe o código do fornecedor e a despesa.` });
      continue;
    }
    const { data: jaConc } = await supabase.from('fluxo_caixa_conciliacoes').select('id').eq('chave', l.chave).maybeSingle();
    if (jaConc) {
      out.recusadas.push({ ...base, motivo: 'Saída já conciliada.' });
      continue;
    }
    if (!contasCache.has(l.conta_id)) {
      const { data: c } = await supabase.from('fluxo_caixa_contas').select('id,banco,apelido,titular_nome,titular_cnpj').eq('id', l.conta_id).maybeSingle();
      contasCache.set(l.conta_id, c);
    }
    const conta = contasCache.get(l.conta_id);
    // Desde 24/11/2026 (Titia): a duplicata da tarifa/saída nasce no CONTAS A PAGAR DO
    // HEADCOACH (não mais no TOTVS + Solicitação) e a saída é conciliada com ela — a
    // conciliação dá a baixa automática (origem HC_CP).
    let despesaCodigo = DESPESA_TARIFA.codigo;
    let fornHc = null;
    if (temEscolha) {
      fornHc = await fornecedorHc({ code: Number(soDig(esc.fornecedorCodigo)) });
      if (!fornHc) {
        out.recusadas.push({ ...base, motivo: `Fornecedor ${esc.fornecedorCodigo} não encontrado no cadastro de fornecedores.` });
        continue;
      }
      if (fornHc.naoFornecedor) {
        out.recusadas.push({ ...base, motivo: `${fornHc.code} ${fornHc.nome} não está marcado como FORNECEDOR no cadastro — marque como fornecedor e tente de novo.` });
        continue;
      }
      despesaCodigo = Number(soDig(esc.despesaCodigo));
    } else {
      const fb = FORNECEDOR_BANCO[String(conta?.banco || '').toUpperCase()];
      fornHc = fb ? await fornecedorHc({ cnpj: fb.cnpj }) : null;
      if (fornHc?.naoFornecedor) fornHc = null;
    }
    if (!fornHc) {
      out.recusadas.push({ ...base, motivo: `Banco ${conta?.banco || '?'} sem fornecedor de tarifa no cadastro — informe o código do fornecedor.` });
      continue;
    }
    const branchCnpj = soDig(conta.titular_cnpj);
    const filial = (mapa?.get(branchCnpj) || [])[0] || null;
    if (!filial?.code) {
      out.recusadas.push({ ...base, motivo: `Não achei a empresa da conta ${conta.apelido} (CNPJ ${branchCnpj}).` });
      continue;
    }
    const valor = round2(Math.abs(Number(l.valor)));
    const texto = `${l.descricao || ''}${l.memo && l.memo !== l.descricao ? ` · ${l.memo}` : ''}`.trim();
    if (simular) {
      out.criadas.push({ ...base, banco: conta.banco, fornecedor: fornHc.nome, despesa: despesaCodigo, empresa: filial.code, simulado: true });
      out.total = round2(out.total + valor);
      continue;
    }
    try {
      const { validarInclusao, inserirTitulos } = await import('./hcContasPagar.js');
      const dados = validarInclusao({
        empresa: filial.code,
        fornecedorCode: fornHc.code,
        // uma por linha do extrato: várias tarifas do mesmo banco no mesmo dia batiam na
        // chave única (empresa, fornecedor, documento fiscal, parcela) e eram recusadas
        documentoFiscal: `Extrato ${fmtData(l.data)} #${l.id}`.slice(0, 40),
        tipoDocumento: 'outro',
        formaPagamento: 'debito_automatico',
        despesaCode: despesaCodigo,
        centroCustoCode: DESPESA_TARIFA.centroCusto,
        emissao: l.data,
        vencimento: l.data,
        valor,
        observacao: `${temEscolha ? 'Saída' : 'Tarifa bancária'} do extrato ${conta.apelido} em ${fmtData(l.data)}: ${texto}`.slice(0, 1000),
      });
      const [titulo] = await inserirTitulos(dados, { por: usuario || 'Conciliação HeadCoach', origem: 'conciliacao-extrato', origemRef: String(l.id) });
      await salvarConciliacao({
        lancamentoId: l.id,
        origem: 'HC_CP',
        referencia: {
          id: String(titulo.id),
          nome: fornHc.nome,
          doc: fornHc.cpf_cnpj || null,
          valor,
          valorDuplicata: valor,
          data: l.data,
          vencimento: l.data,
          empresa: `Empresa ${filial.code}`,
          detalhe: `${temEscolha ? 'Saída do extrato' : 'Tarifa bancária'} · dup ${titulo.duplicata}/${titulo.parcela} · despesa ${despesaCodigo} · Contas a Pagar HeadCoach`,
          duplicata: `${titulo.duplicata}|${titulo.parcela}`,
          motivos: ['duplicata criada pela Conciliação HeadCoach'],
        },
        justificativa: `${temEscolha ? `${fornHc.nome} (despesa ${despesaCodigo})` : `Tarifa bancária ${conta.banco}`} — duplicata ${titulo.duplicata}/${titulo.parcela} criada no Contas a Pagar HeadCoach pela Conciliação`,
        usuario: usuario || 'Conciliação HeadCoach',
        automatico: false,
      });
      out.criadas.push({ ...base, banco: conta.banco, fornecedor: fornHc.nome, empresa: filial.code, duplicata: `${titulo.duplicata}/${titulo.parcela}`, tituloId: titulo.id });
      out.total = round2(out.total + valor);
    } catch (e) {
      out.recusadas.push({ ...base, motivo: e.message });
    }
  }
  return out;
}

export default { criarDuplicatasTarifas, ehTarifa, saidasPendentes, entradasPendentes, saidasPendentesComSugestao, sugerirFornecedorDespesa, fornecedorPorCodigo, FORNECEDOR_BANCO, DESPESA_TARIFA };
