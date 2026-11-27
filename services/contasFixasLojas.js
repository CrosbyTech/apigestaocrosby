// ============================================================================
// CONTAS FIXAS DAS LOJAS (Financeiro › Contas a Pagar) — Yago, 26/11/2026.
// Junta o Controle de Filiais (despesas fixas e dados cadastrais) e o CTO numa
// página só. Este serviço monta a PLANILHA DO MÊS: uma linha por loja, uma
// coluna por despesa (aluguel, condomínio, energia, água, internet, outras) e,
// em cada célula, quem é o fornecedor, COMO PEGAR a conta para pagar e o que
// aconteceu no mês (pago, em aberto, pendente, sem cadastro).
//   cadastro das despesas  → despesas_fixas_filial (+ como_pegar_canal / como_pegar)
//   cadastro das lojas     → contas_fixas_lojas
//   anotação da célula     → contas_fixas_anotacoes
//   o que aconteceu no mês → hc_cp_titulos (Contas a Pagar HeadCoach) e contas_fixas_faturas
// O mês de um título é o do VENCIMENTO dele.
// FONTE POR MÊS (Yago, 26/11/2026): até outubro/2026 as contas estavam no TOTVS — a planilha lê a
// cópia dos títulos do TOTVS e confere cada um com a baixa do TOTVS e com as baixas do HeadCoach
// (conciliação do extrato e Liberação). De novembro/2026 em diante vale SÓ o HeadCoach.
// (services/contasFixasTotvs.js)
// ============================================================================
import supabase from '../config/supabase.js';
import { MES_INICIO_HEADCOACH, titulosTotvsDoMes, sincronizarContasFixasTotvs } from './contasFixasTotvs.js';

export class ContasFixasError extends Error {
  constructor(message, code = 'CONTAS_FIXAS', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// colunas da planilha; `despesas` = códigos de despesa do Contas a Pagar que caem na coluna
export const COLUNAS = [
  { id: 'ALUGUEL', nome: 'Aluguel', despesas: [4001], esperada: true },
  { id: 'CONDOMINIO', nome: 'Condomínio', despesas: [4005], esperada: true },
  { id: 'ENERGIA', nome: 'Energia', despesas: [6010], esperada: true },
  { id: 'AGUA', nome: 'Água', despesas: [6011], esperada: true },
  { id: 'INTERNET', nome: 'Internet', despesas: [6028], esperada: true },
  // telefone e água mineral: nem toda loja tem, por isso a falta não vira "sem cadastro"
  { id: 'OUTRAS', nome: 'Telefone e outras', despesas: [6012], esperada: false },
];
// tipos aceitos no cadastro da despesa → coluna em que aparecem
export const TIPOS_DESPESA = {
  ALUGUEL: { nome: 'Aluguel', coluna: 'ALUGUEL' },
  CONDOMINIO: { nome: 'Condomínio', coluna: 'CONDOMINIO' },
  ENERGIA: { nome: 'Energia', coluna: 'ENERGIA' },
  AGUA: { nome: 'Água', coluna: 'AGUA' },
  INTERNET: { nome: 'Internet', coluna: 'INTERNET' },
  TELEFONE: { nome: 'Telefone', coluna: 'OUTRAS' },
  AGUA_MINERAL: { nome: 'Água mineral', coluna: 'OUTRAS', sobDemanda: true },
  OUTRA: { nome: 'Outra', coluna: 'OUTRAS' },
};
// como a conta chega até o financeiro
export const CANAIS = {
  robo_whatsapp: 'Robô do WhatsApp',
  email_automatico: 'E-mail (o HeadCoach lança sozinho)',
  email: 'E-mail (pegar à mão)',
  whatsapp: 'WhatsApp (pedir ou receber)',
  site: 'Site ou aplicativo da operadora',
  loja_envia: 'A loja envia',
  pix_direto: 'Pix direto ao locador',
  boleto: 'Boleto enviado pelo fornecedor',
  sob_demanda: 'Compra sob demanda',
  fora_do_controle: 'Fora do controle',
  nao_definido: 'A definir',
};
export const TIPOS_LOJA = { matriz: 'Matriz', loja_rua: 'Loja de rua', loja_shopping: 'Loja de shopping', imovel: 'Imóvel' };
const ORIGENS = {
  totvs: 'Importado (já pago)',
  'replica-totvs': 'Consulta antiga',
  'solicitacao-crosby': 'Solicitação',
  manual: 'Lançado à mão',
  'conciliacao-extrato': 'Conciliação do extrato',
  'contas-fixas-previsao': 'Previsão do mês (contas fixas)',
};
const origemRotulo = (o) => ORIGENS[o] || (/^bot-/.test(o || '') ? 'Robô do WhatsApp' : /^email-/.test(o || '') ? 'E-mail' : o || '—');
const TIPO_DA_CONCESSIONARIA = { COSERN: 'ENERGIA', ENERGISA: 'ENERGIA', EQUATORIAL: 'ENERGIA', CAERN: 'AGUA', CAGEPA: 'AGUA', ALARES: 'INTERNET', LANSERVI: 'INTERNET' };
const PODE_EDITAR = ['owner', 'admin', 'manager', 'user'];

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const diaMes = (d) => (d ? String(d).slice(8, 10) + '/' + String(d).slice(5, 7) : '');
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const hojeBrasil = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
const texto = (v, max = 2000) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const ordemCd = (a, b) => String(a).localeCompare(String(b), 'pt', { numeric: true });

async function q(promessa) {
  const { data, error } = await promessa;
  if (error) {
    if (/relation .* does not exist|could not find the table|schema cache|column .* does not exist/i.test(error.message)) {
      throw new ContasFixasError('As Contas Fixas das Lojas ainda não estão liberadas: rode "node scripts/migrar-contas-fixas-lojas.mjs" na pasta da API.', 'MIGRATION_PENDING', 503);
    }
    throw new ContasFixasError(error.message, 'DB_ERROR', 500);
  }
  return data;
}
async function lerTudo(montar) {
  const out = [];
  for (let de = 0; ; de += 1000) {
    const lote = await q(montar().range(de, de + 999));
    out.push(...(lote || []));
    if (!lote || lote.length < 1000) break;
  }
  return out;
}
function exigirEdicao(user) {
  if (!PODE_EDITAR.includes(user?.role)) throw new ContasFixasError('Só o financeiro, admin ou owner alteram as contas fixas', 'SEM_PERMISSAO', 403);
  return user?.name || user?.email || null;
}

// o mesmo fornecedor no cadastro e no título: pelo código ou pelo nome (CLARO S.A × CLARO S.A.)
const PALAVRAS_VAZIAS = new Set(['COMPANHIA', 'CIA', 'DE', 'DO', 'DA', 'DOS', 'DAS', 'E', 'LTDA', 'SA', 'S', 'A', 'ME', 'SERVICO', 'SERVICOS', 'EMPRESA', 'CONDOMINIO']);
const palavrasDe = (nome) => norm(nome).split(' ').filter((p) => p.length > 1 && !PALAVRAS_VAZIAS.has(p));
// nomes diferentes do mesmo fornecedor (cadastro × Contas a Pagar)
const APELIDOS = [
  ['ALARES', 'CABO SERVICOES DE TELECOMUNICACOES'],
  ['COSERN', 'COMPANHIA ENERGETICA DO RIO GRANDE DO NORTE'],
];
export function mesmoFornecedor(cad, tit) {
  if (cad.cd_fornecedor && tit.fornecedorCode && String(cad.cd_fornecedor) === String(tit.fornecedorCode)) return true;
  const a = norm(cad.nm_fornecedor);
  const b = norm(tit.fornecedor);
  if (!a || !b) return false;
  if (APELIDOS.some((g) => g.some((x) => a.includes(x)) && g.some((x) => b.includes(x)))) return true;
  const pa = palavrasDe(a);
  const pb = palavrasDe(b);
  return pa.length > 0 && pb.length > 0 && pa[0] === pb[0];
}

const primeiroDia = (mes) => `${mes}-01`;
const ultimoDia = (mes) => {
  const [a, m] = mes.split('-').map(Number);
  return `${mes}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

// ─── leitura ─────────────────────────────────────────────────────────────────
export async function listarLojas({ incluirInativas = false } = {}) {
  let qy = supabase.from('contas_fixas_lojas').select('*').order('ordem').order('cd_filial');
  if (!incluirInativas) qy = qy.eq('ativo', true);
  return (await q(qy)) || [];
}

// nome curto do fornecedor para caber na célula da planilha
const NOMES_CURTOS = [
  [/ENERGETICA DO RIO GRANDE|COSERN/, 'Cosern'],
  [/ENERGISA/, 'Energisa'],
  [/EQUATORIAL/, 'Equatorial'],
  [/AGUAS E ESGOTOS DO RIO GRANDE|CAERN/, 'CAERN'],
  [/ESGOTOS DA PARAIBA|CAGEPA/, 'Cagepa'],
  [/SERVICO AUTONOMO DE AGUA|SAAE/, 'SAAE'],
  [/ALARES|CABO SERVICOES/, 'Alares'],
  [/CLARO/, 'Claro'],
  [/TELEFONICA/, 'Telefônica'],
  [/INFORWAY/, 'Inforway'],
  [/BRISANET/, 'Brisanet'],
  [/LANSERVI/, 'Lanservi'],
  [/INNOTECH/, 'Innotech'],
];
export function nomeCurto(nome) {
  const n = norm(nome);
  const conhecido = NOMES_CURTOS.find(([re]) => re.test(n));
  if (conhecido) return conhecido[1];
  const LIGA = new Set(['DE', 'DO', 'DA', 'DOS', 'DAS', 'E']);
  const palavras = n.split(' ').filter((p) => p && !/^\d+$/.test(p) && !['LTDA', 'SA', 'ME', 'EIRELI', 'EPP'].includes(p)).slice(0, 3);
  while (palavras.length > 1 && LIGA.has(palavras[palavras.length - 1])) palavras.pop(); // não termina em "de", "da"…
  return palavras.map((p) => (LIGA.has(p) ? p.toLowerCase() : p.length <= 2 ? p : p[0] + p.slice(1).toLowerCase())).join(' ') || String(nome || '—');
}

const cadastroPublico = (c) => ({
  id: c.id,
  fornecedorCurto: nomeCurto(c.nm_fornecedor),
  cdFilial: String(c.cd_filial),
  tipo: c.tipo_despesa,
  tipoNome: TIPOS_DESPESA[c.tipo_despesa]?.nome || c.tipo_despesa,
  fornecedorCode: c.cd_fornecedor || null,
  fornecedor: c.nm_fornecedor || null,
  vencimentoDia: c.vencimento || null,
  formaPagamento: c.forma_pagamento || null,
  comoPegarCanal: c.como_pegar_canal || 'nao_definido',
  comoPegarCanalNome: CANAIS[c.como_pegar_canal] || CANAIS.nao_definido,
  comoPegar: c.como_pegar || null,
  observacao: c.observacao || null,
  contratoVencimento: c.contrato_vencimento || null,
  contratoNome: c.contrato_nome || null,
  atualizadoEm: c.updated_at || null,
});

// lançamentos do mês que caem numa coluna: [{ coluna, cdFilial|null, ...dados }] — do Contas a Pagar HeadCoach
async function lancamentosHeadcoachDoMes(mes, lojas) {
  const porCc = new Map(lojas.filter((l) => l.centro_custo_code != null).map((l) => [Number(l.centro_custo_code), String(l.cd_filial)]));
  const porEmpresa = new Map(lojas.filter((l) => l.empresa != null).map((l) => [Number(l.empresa), String(l.cd_filial)]));
  const colunaDaDespesa = new Map(COLUNAS.flatMap((c) => c.despesas.map((d) => [d, c.id])));
  const titulos = await lerTudo(() =>
    supabase
      .from('hc_cp_titulos')
      .select('id, empresa, fornecedor_code, fornecedor_nome, duplicata, parcela, valor, valor_pago, vencimento, data_pagamento, situacao, origem, origem_ref, previsao, despesa_code, centro_custo_code, centro_custo_nome, rateio, documento_fiscal, forma_pagamento, chave_pix, codigo_barras, observacao')
      .gte('vencimento', primeiroDia(mes))
      .lte('vencimento', ultimoDia(mes))
      .neq('situacao', 'cancelado')
      .order('vencimento')
      .order('id'),
  );
  const out = [];
  const faturasLancadas = new Set();
  for (const t of titulos) {
    if (/^(bot-|email-)/.test(t.origem || '') && t.origem_ref) faturasLancadas.add(String(t.origem_ref));
    // com rateio, cada linha (despesa + centro de custo) vira um lançamento na sua coluna e loja
    const partes = Array.isArray(t.rateio) && t.rateio.length ? t.rateio : [{ despesa_code: t.despesa_code, centro_custo_code: t.centro_custo_code, centro_custo_nome: t.centro_custo_nome, valor: t.valor, percentual: 100 }];
    const total = Number(t.valor) || 0;
    for (const p of partes) {
      const coluna = colunaDaDespesa.get(Number(p.despesa_code));
      if (!coluna) continue;
      const valor = round2(p.valor ?? (total * Number(p.percentual || 0)) / 100);
      const fracao = total > 0 ? valor / total : 1;
      const cc = p.centro_custo_code != null ? Number(p.centro_custo_code) : null;
      // a loja vem do centro de custo; sem centro de custo de loja, da empresa do título
      const cdFilial = porCc.get(cc) || (cc == null || cc === 999 ? porEmpresa.get(Number(t.empresa)) : null) || null;
      out.push({
        chave: `t${t.id}-${coluna}-${cc ?? 'x'}`,
        titulo: `t${t.id}`,
        tituloId: t.id,
        despesaCode: Number(p.despesa_code),
        centroCustoCode: cc,
        duplicataNumero: t.duplicata != null ? Number(t.duplicata) : null,
        parcela: t.parcela != null ? Number(t.parcela) : null,
        coluna,
        cdFilial,
        fornecedor: t.fornecedor_nome,
        fornecedorCurto: nomeCurto(t.fornecedor_nome),
        fornecedorCode: t.fornecedor_code,
        duplicata: t.duplicata != null ? `${t.duplicata}/${t.parcela}` : null,
        valor,
        valorPago: round2(Number(t.valor_pago || 0) * fracao),
        vencimento: String(t.vencimento).slice(0, 10),
        pagamento: t.data_pagamento ? String(t.data_pagamento).slice(0, 10) : null,
        situacao: t.situacao === 'pago' ? 'pago' : 'aberto',
        // previsão = conta que ainda não chegou; valor simbólico (R$ 0,01) = o valor real entra quando ela chegar
        previsao: t.previsao === 'previsao' && t.situacao !== 'pago',
        simbolico: t.situacao !== 'pago' && Number(t.valor) <= 0.011,
        origem: t.origem,
        origemNome: origemRotulo(t.origem),
        documentoFiscal: t.documento_fiscal || null,
        formaPagamento: t.forma_pagamento || null,
        chavePix: t.chave_pix || null,
        codigoBarras: t.codigo_barras || null,
        observacao: t.observacao || null,
        centroCusto: p.centro_custo_nome || t.centro_custo_nome || null,
        rateado: partes.length > 1,
        empresa: t.empresa,
      });
    }
  }
  // faturas que o robô / e-mail capturou e que ainda não viraram título
  const faturas = (await q(supabase.from('contas_fixas_faturas').select('id, tipo_despesa, concessionaria, cd_filial, codigo_cliente, valor, vencimento, pix_copia_cola, linha_digitavel, origem, capturado_em').gte('vencimento', primeiroDia(mes)).lte('vencimento', ultimoDia(mes)).order('vencimento'))) || [];
  for (const f of faturas) {
    if (faturasLancadas.has(String(f.id))) continue;
    const tipo = TIPOS_DESPESA[f.tipo_despesa] ? f.tipo_despesa : TIPO_DA_CONCESSIONARIA[f.concessionaria];
    const coluna = TIPOS_DESPESA[tipo]?.coluna;
    if (!coluna) continue;
    out.push({
      chave: `f${f.id}`,
      titulo: `f${f.id}`,
      faturaId: f.id,
      despesaCode: null,
      centroCustoCode: null,
      duplicataNumero: null,
      parcela: null,
      coluna,
      cdFilial: lojas.some((l) => String(l.cd_filial) === String(f.cd_filial)) ? String(f.cd_filial) : null,
      fornecedor: f.concessionaria,
      fornecedorCurto: nomeCurto(f.concessionaria),
      fornecedorCode: null,
      duplicata: null,
      valor: round2(f.valor),
      valorPago: 0,
      vencimento: String(f.vencimento).slice(0, 10),
      pagamento: null,
      situacao: 'capturada',
      origem: f.origem,
      origemNome: `${origemRotulo(f.origem)} — fatura capturada, ainda sem lançamento no Contas a Pagar`,
      documentoFiscal: null,
      formaPagamento: f.pix_copia_cola ? 'pix' : f.linha_digitavel ? 'boleto' : null,
      chavePix: f.pix_copia_cola || null,
      codigoBarras: f.linha_digitavel || null,
      observacao: f.codigo_cliente ? `código do cliente ${f.codigo_cliente}` : null,
      centroCusto: null,
      rateado: false,
      empresa: null,
    });
  }
  return out;
}

// ─── meses antes de novembro/2026: títulos do TOTVS conferidos com as baixas ─
const dataBr = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
function textoDaConferencia(t) {
  const hc = t.headcoach ? `${t.headcoach.tipo === 'conciliacao' ? 'conciliado no extrato pelo HeadCoach' : t.headcoach.tipo === 'liberacao' ? 'pago na Liberação de Pagamento' : 'baixado no Contas a Pagar HeadCoach'} em ${dataBr(t.headcoach.data)}${t.headcoach.banco ? ` (${t.headcoach.banco})` : ''}` : null;
  if (t.totvs && hc) return `Baixado no TOTVS em ${dataBr(t.totvs.data)} · ${hc}`;
  if (t.totvs) return `Baixado no TOTVS em ${dataBr(t.totvs.data)}`;
  if (hc) return `Sem baixa no TOTVS · ${hc}`;
  return 'Em aberto: sem baixa no TOTVS e sem baixa no HeadCoach';
}
async function lancamentosTotvsDoMes(mes, lojas) {
  const porCc = new Map(lojas.filter((l) => l.centro_custo_code != null).map((l) => [Number(l.centro_custo_code), String(l.cd_filial)]));
  const porEmpresa = new Map(lojas.filter((l) => l.empresa != null).map((l) => [Number(l.empresa), String(l.cd_filial)]));
  const colunaDaDespesa = new Map(COLUNAS.flatMap((c) => c.despesas.map((d) => [d, c.id])));
  const [{ titulos, sincronizadoEm }, ccs] = await Promise.all([titulosTotvsDoMes(mes), q(supabase.from('hc_cp_centros_custo').select('code, nome').limit(2000))]);
  const nomeCc = new Map((ccs || []).map((c) => [Number(c.code), c.nome]));
  const lancs = [];
  for (const t of titulos) {
    const coluna = colunaDaDespesa.get(Number(t.despesa_code));
    if (!coluna) continue;
    const cc = t.centro_custo_code != null ? Number(t.centro_custo_code) : null;
    const baixa = t.totvs || t.headcoach;
    const fornecedor = t.fornecedor_nome || `Fornecedor ${t.fornecedor_code}`;
    lancs.push({
      chave: `v${t.id}`,
      titulo: `v${t.empresa}|${t.fornecedor_code}|${t.duplicata}|${t.parcela}`,
      tituloId: null,
      despesaCode: Number(t.despesa_code),
      centroCustoCode: cc,
      duplicataNumero: Number(t.duplicata),
      parcela: Number(t.parcela),
      coluna,
      cdFilial: porCc.get(cc) || (cc == null || cc === 999 ? porEmpresa.get(Number(t.empresa)) : null) || null,
      fornecedor,
      fornecedorCurto: nomeCurto(fornecedor),
      fornecedorCode: t.fornecedor_code,
      duplicata: `${t.duplicata}/${t.parcela}`,
      valor: round2(t.valor),
      valorPago: baixa ? round2(baixa.valor) : 0,
      vencimento: String(t.vencimento).slice(0, 10),
      pagamento: baixa?.data || null,
      situacao: t.situacao,
      origem: 'totvs-historico',
      origemNome: 'TOTVS',
      documentoFiscal: null,
      formaPagamento: null,
      chavePix: null,
      codigoBarras: null,
      observacao: null,
      centroCusto: nomeCc.get(cc) || (cc != null ? `centro de custo ${cc}` : null),
      rateado: Number(t.percentual) < 99.99,
      empresa: t.empresa,
      // a conferência pedida pelo Yago: o título está baixado no TOTVS? e no HeadCoach?
      conferencia: { pagoOnde: t.pagoOnde, totvs: t.totvs, headcoach: t.headcoach, texto: textoDaConferencia(t) },
    });
  }
  return { lancs, fonte: 'totvs', sincronizadoEm };
}
// o resumo da conferência do mês (TOTVS × HeadCoach), sobre os lançamentos que ficaram na planilha
function resumoDaConferencia(lancs, sincronizadoEm) {
  const soma = (l) => round2(l.reduce((s, x) => s + x.valor, 0));
  const com = (onde) => lancs.filter((x) => x.conferencia?.pagoOnde === onde);
  const abertos = lancs.filter((x) => x.situacao !== 'pago');
  return {
    sincronizadoEm,
    titulos: lancs.length,
    valor: soma(lancs),
    baixadosNoTotvs: com('totvs').length + com('totvs+headcoach').length,
    baixadosNosDois: com('totvs+headcoach').length,
    soNoHeadcoach: com('headcoach').length,
    valorSoNoHeadcoach: soma(com('headcoach')),
    emAberto: abertos.length,
    valorEmAberto: soma(abertos),
  };
}
/** De onde vêm os lançamentos do mês: TOTVS conferido (antes de novembro/2026) ou só o HeadCoach. */
async function lancamentosDoMes(mes, lojas) {
  if (mes < MES_INICIO_HEADCOACH) return lancamentosTotvsDoMes(mes, lojas);
  return { lancs: await lancamentosHeadcoachDoMes(mes, lojas), fonte: 'headcoach', sincronizadoEm: null };
}

// carga do TOTVS disparada pela tela: uma por vez, em segundo plano
let cargaTotvs = null; // { iniciadaEm, por, promessa }
export function atualizarDoTotvs(user, { de = '2026-01', ate = '2026-10' } = {}) {
  const quem = exigirEdicao(user);
  const ok = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || ''));
  if (!ok(de) || !ok(ate) || de > ate) throw new ContasFixasError('Informe os meses no formato AAAA-MM');
  if (ate >= MES_INICIO_HEADCOACH) throw new ContasFixasError('De novembro/2026 em diante a planilha usa só o HeadCoach: não há o que trazer do TOTVS');
  if (cargaTotvs) return { iniciado: false, emAndamento: true, iniciadaEm: cargaTotvs.iniciadaEm, por: cargaTotvs.por };
  const iniciadaEm = new Date().toISOString();
  const promessa = sincronizarContasFixasTotvs({ de: `${de}-01`, ate: `${ate}-28`, log: (m) => console.log(`[contas fixas × TOTVS] ${m}`) })
    .then((r) => console.log(`✅ [contas fixas × TOTVS] ${r.linhas} linha(s) de ${r.meses.length} mês(es), pedido de ${quem}`))
    .catch((e) => console.error(`❌ [contas fixas × TOTVS] ${e.message}`))
    .finally(() => { cargaTotvs = null; });
  cargaTotvs = { iniciadaEm, por: quem, promessa };
  return { iniciado: true, iniciadaEm, por: quem, de, ate };
}

// ─── regras do cadastro sobre os lançamentos (correções do Yago, 26/11/2026) ─
// 1) Entre ALUGUEL e CONDOMÍNIO quem decide a coluna é o cadastro da loja: se o fornecedor do lançamento
//    não está cadastrado na coluna em que caiu, mas está na outra, o lançamento vai para a do cadastro
//    (Teresina Administradora é condomínio; Midway e Ayrton Senna têm o boleto inteiro em aluguel).
// 2) As partes de um mesmo título que ficam na mesma célula viram uma linha só (o boleto rateado soma).
// 3) Célula marcada "só os fornecedores do cadastro": lançamento de outro fornecedor é desconsiderado
//    (o aluguel da Matriz é só a SB Imóveis; no TOTVS outros aluguéis caíam no centro de custo dela).
// 4) Célula "não se aplica": todos os lançamentos dela são desconsiderados (Matriz não tem telefone e outras).
// O que sai da planilha por (3) e (4) volta em `desconsiderados`, com o motivo — nada some calado.
const PAR_DE_OCUPACAO = { ALUGUEL: 'CONDOMINIO', CONDOMINIO: 'ALUGUEL' };
const colunaDoCadastro = (c) => TIPOS_DESPESA[c.tipo]?.coluna || 'OUTRAS';
const doCadastro = (c, x) => mesmoFornecedor({ cd_fornecedor: c.fornecedorCode, nm_fornecedor: c.fornecedor }, x);
export function aplicarRegrasDoCadastro(brutos, cadastros, anot) {
  const porLoja = new Map();
  for (const c of cadastros) porLoja.set(c.cdFilial, [...(porLoja.get(c.cdFilial) || []), c]);
  const tem = (x, coluna) => (porLoja.get(x.cdFilial) || []).some((c) => colunaDoCadastro(c) === coluna && doCadastro(c, x));
  // 1) coluna pelo cadastro
  const movidos = brutos.map((x) => {
    const outra = PAR_DE_OCUPACAO[x.coluna];
    if (!x.cdFilial || !outra || tem(x, x.coluna) || !tem(x, outra)) return x;
    return { ...x, coluna: outra, colunaPeloCadastro: true };
  });
  // 2) partes do mesmo título na mesma célula
  const juntos = new Map();
  for (const x of movidos) {
    const k = `${x.titulo}|${x.cdFilial}|${x.coluna}`;
    const ja = juntos.get(k);
    if (!ja) juntos.set(k, { ...x });
    else Object.assign(ja, { valor: round2(ja.valor + x.valor), valorPago: round2((ja.valorPago || 0) + (x.valorPago || 0)), rateado: false, partes: (ja.partes || 1) + 1 });
  }
  // 3) e 4) o que a célula manda desconsiderar
  const lancs = [];
  const desconsiderados = [];
  for (const x of juntos.values()) {
    const a = x.cdFilial ? anot.get(`${x.cdFilial}|${x.coluna}`) : null;
    if (a?.nao_se_aplica) desconsiderados.push({ ...x, motivo: 'A loja não tem essa despesa (célula marcada "não se aplica")' });
    else if (a?.so_cadastro && !tem(x, x.coluna)) desconsiderados.push({ ...x, motivo: 'Fornecedor fora do cadastro da loja (a célula só considera os fornecedores cadastrados)' });
    else lancs.push(x);
  }
  return { lancs, desconsiderados };
}

// resumo do que aconteceu no mês, a partir dos lançamentos
function resumoDosLancamentos(lancs, hoje) {
  const pagos = lancs.filter((l) => l.situacao === 'pago');
  const abertos = lancs.filter((l) => l.situacao !== 'pago');
  const partes = [];
  if (pagos.length) {
    const total = round2(pagos.reduce((s, l) => s + (l.valorPago || l.valor), 0));
    const dias = [...new Set(pagos.map((l) => diaMes(l.pagamento)).filter(Boolean))];
    partes.push(`${pagos.length > 1 ? `${pagos.length} pagos` : 'Pago'} ${brl(total)}${dias.length === 1 ? ` em ${dias[0]}` : ''}`);
  }
  const simbolicos = abertos.filter((l) => l.simbolico);
  if (abertos.length && simbolicos.length === abertos.length) {
    // só previsões de R$ 0,01: o que importa é que a conta ainda não chegou, não o valor
    const vencs = [...new Set(abertos.map((l) => diaMes(l.vencimento)))];
    partes.push(`Previsão: aguardando a conta${abertos.length > 1 ? ` (${abertos.length})` : ''} · venc. ${vencs.join(' e ')}`);
  } else if (abertos.length) {
    const total = round2(abertos.reduce((s, l) => s + l.valor, 0));
    const vencs = [...new Set(abertos.map((l) => diaMes(l.vencimento)))];
    const vencido = abertos.some((l) => l.vencimento < hoje);
    partes.push(`${abertos.every((l) => l.previsao) ? 'Previsão' : vencido ? 'Vencido' : 'Em aberto'} ${brl(total)}${abertos.length > 1 ? ` (${abertos.length} contas)` : ''} · venc. ${vencs.join(' e ')}`);
  }
  return partes.join(' · ');
}

/**
 * A planilha do mês. mes = 'AAAA-MM' (padrão: o mês corrente).
 * Situação de cada célula: vencido | aberto | pendente | pago | sem_cadastro | nao_se_aplica | fora_do_controle | vazio.
 * `user` decide se a observação do cadastro vai junto (só para quem pode editar).
 */
export async function planilhaDoMes({ mes = null, user = null } = {}) {
  const hoje = hojeBrasil();
  const m = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(mes || '')) ? String(mes) : hoje.slice(0, 7);
  const [lojas, cadastrosBrutos, anotacoes] = await Promise.all([
    listarLojas(),
    q(supabase.from('despesas_fixas_filial').select('*').limit(5000)),
    q(supabase.from('contas_fixas_anotacoes').select('*').limit(5000)),
  ]);
  const { lancs: brutos, fonte, sincronizadoEm } = await lancamentosDoMes(m, lojas);
  // a observação do cadastro guarda login de site e documento do titular: só vai para quem pode editar (financeiro, admin, owner)
  const verObservacao = PODE_EDITAR.includes(user?.role);
  const cadastros = (cadastrosBrutos || []).map((x) => ({ ...cadastroPublico(x), ...(verObservacao ? {} : { observacao: null }) }));
  const anot = new Map((anotacoes || []).map((a) => [`${a.cd_filial}|${a.tipo_despesa}`, a]));
  const { lancs, desconsiderados } = aplicarRegrasDoCadastro(brutos, cadastros, anot);
  const conferencia = fonte === 'totvs' ? resumoDaConferencia(lancs, sincronizadoEm) : null;
  const passado = m < hoje.slice(0, 7);

  const totais = { pago: 0, aberto: 0, vencido: 0, pendentes: 0, semCadastro: 0, porColuna: Object.fromEntries(COLUNAS.map((c) => [c.id, { pago: 0, aberto: 0 }])) };
  const pendencias = [];
  const linhas = lojas.map((l) => {
    const cd = String(l.cd_filial);
    const celulas = {};
    for (const col of COLUNAS) {
      const cads = cadastros.filter((c) => c.cdFilial === cd && (TIPOS_DESPESA[c.tipo]?.coluna || 'OUTRAS') === col.id).sort((a, b) => String(a.fornecedor).localeCompare(String(b.fornecedor)));
      const ls = lancs.filter((x) => x.cdFilial === cd && x.coluna === col.id);
      const a = anot.get(`${cd}|${col.id}`);
      // cada cadastro: o que houve com ele no mês
      const usados = new Set();
      for (const c of cads) {
        const meus = ls.filter((x) => mesmoFornecedor({ cd_fornecedor: c.fornecedorCode, nm_fornecedor: c.fornecedor }, x));
        meus.forEach((x) => usados.add(x.chave));
        const sobDemanda = !!TIPOS_DESPESA[c.tipo]?.sobDemanda || c.comoPegarCanal === 'sob_demanda';
        c.noMes = meus.length ? { situacao: meus.some((x) => x.situacao !== 'pago') ? (meus.some((x) => x.situacao !== 'pago' && x.vencimento < hoje) ? 'vencido' : 'aberto') : 'pago', resumo: resumoDosLancamentos(meus, hoje) } : c.comoPegarCanal === 'fora_do_controle' ? { situacao: 'fora_do_controle', resumo: 'Fora do controle' } : sobDemanda ? { situacao: 'vazio', resumo: 'Sob demanda' } : { situacao: 'pendente', resumo: passado ? 'Nada lançado no mês' : 'Pendente: conta ainda não lançada' };
      }
      const avulsos = ls.filter((x) => !usados.has(x.chave)); // lançamento de fornecedor que não está no cadastro
      const pago = round2(ls.filter((x) => x.situacao === 'pago').reduce((s, x) => s + (x.valorPago || x.valor), 0));
      const abertos = ls.filter((x) => x.situacao !== 'pago');
      const aberto = round2(abertos.reduce((s, x) => s + x.valor, 0));
      const vencido = round2(abertos.filter((x) => x.vencimento < hoje).reduce((s, x) => s + x.valor, 0));
      let situacao;
      if (a?.nao_se_aplica) situacao = 'nao_se_aplica';
      else if (vencido > 0) situacao = 'vencido';
      else if (aberto > 0) situacao = 'aberto';
      else if (cads.some((c) => c.noMes.situacao === 'pendente')) situacao = 'pendente';
      else if (ls.length) situacao = 'pago';
      else if (cads.length && cads.every((c) => c.noMes.situacao === 'fora_do_controle')) situacao = 'fora_do_controle';
      else if (cads.length) situacao = 'vazio';
      else situacao = col.esperada && l.tipo !== 'imovel' ? 'sem_cadastro' : 'vazio';
      const semCadastro = !cads.length && (ls.length > 0 || situacao === 'sem_cadastro');
      celulas[col.id] = { situacao, semCadastro, resumo: ls.length ? resumoDosLancamentos(ls, hoje) : null, pago, aberto, vencido, cadastros: cads, lancamentos: ls, lancamentosSemCadastro: avulsos.length, naoSeAplica: !!a?.nao_se_aplica, soCadastro: !!a?.so_cadastro, anotacao: a?.observacao || null };
      totais.pago = round2(totais.pago + pago);
      totais.aberto = round2(totais.aberto + aberto);
      totais.vencido = round2(totais.vencido + vencido);
      totais.porColuna[col.id].pago = round2(totais.porColuna[col.id].pago + pago);
      totais.porColuna[col.id].aberto = round2(totais.porColuna[col.id].aberto + aberto);
      // o que falta
      if (situacao === 'sem_cadastro') {
        totais.semCadastro += 1;
        pendencias.push({ cdFilial: cd, loja: l.nome, coluna: col.id, despesa: col.nome, fornecedor: null, oQueFalta: 'Sem cadastro: informar o fornecedor e como pegar a conta (ou marcar que não se aplica).' });
      } else if (semCadastro) {
        pendencias.push({ cdFilial: cd, loja: l.nome, coluna: col.id, despesa: col.nome, fornecedor: [...new Set(ls.map((x) => x.fornecedor))].join(', '), oQueFalta: 'Tem lançamento no mês, mas a despesa não está no cadastro da loja.' });
      }
      for (const c of a?.nao_se_aplica ? [] : cads) {
        if (c.noMes.situacao === 'pendente') {
          totais.pendentes += 1;
          pendencias.push({ cdFilial: cd, loja: l.nome, coluna: col.id, despesa: c.tipoNome, fornecedor: c.fornecedor, oQueFalta: `${c.noMes.resumo}. Como pegar: ${c.comoPegarCanalNome}${c.comoPegar ? ` — ${c.comoPegar}` : ''}` });
        } else if (c.noMes.situacao === 'vencido') {
          pendencias.push({ cdFilial: cd, loja: l.nome, coluna: col.id, despesa: c.tipoNome, fornecedor: c.fornecedor, oQueFalta: c.noMes.resumo });
        }
        if (c.comoPegarCanal === 'nao_definido') pendencias.push({ cdFilial: cd, loja: l.nome, coluna: col.id, despesa: c.tipoNome, fornecedor: c.fornecedor, oQueFalta: 'Falta definir como pegar a conta.' });
      }
    }
    return {
      cdFilial: cd,
      empresa: l.empresa,
      nome: l.nome,
      tipo: l.tipo,
      tipoNome: TIPOS_LOJA[l.tipo] || l.tipo,
      shopping: l.shopping || null,
      cidade: l.cidade || null,
      uf: l.uf || null,
      celulas,
      pago: round2(COLUNAS.reduce((s, c) => s + celulas[c.id].pago, 0)),
      aberto: round2(COLUNAS.reduce((s, c) => s + celulas[c.id].aberto, 0)),
    };
  });
  // lançamentos das despesas da planilha que não caíram em nenhuma loja (centro de custo de setor, por exemplo)
  const semLoja = lancs.filter((x) => !x.cdFilial);
  return {
    mes: m,
    hoje,
    // 'totvs' = mês anterior a novembro/2026 (títulos do TOTVS conferidos com as baixas) · 'headcoach' = só o Contas a Pagar HeadCoach
    fonte,
    conferencia,
    mesInicioHeadcoach: MES_INICIO_HEADCOACH,
    colunas: COLUNAS.map((c) => ({ id: c.id, nome: c.nome })),
    tiposDespesa: Object.entries(TIPOS_DESPESA).map(([id, t]) => ({ id, nome: t.nome, coluna: t.coluna })),
    canais: Object.entries(CANAIS).map(([id, nome]) => ({ id, nome })),
    lojas: linhas,
    totais,
    pendencias,
    semLoja,
    // lançamentos que a regra de uma célula tirou da planilha (com o motivo)
    desconsiderados,
  };
}

// ─── cadastro das despesas ───────────────────────────────────────────────────
function camposDoCadastro(b) {
  const tipo = String(b.tipo || '').toUpperCase();
  if (!TIPOS_DESPESA[tipo]) throw new ContasFixasError('Escolha o tipo da despesa');
  const fornecedor = texto(b.fornecedor, 200);
  if (!fornecedor) throw new ContasFixasError('Informe o fornecedor');
  const canal = String(b.comoPegarCanal || 'nao_definido');
  if (!CANAIS[canal]) throw new ContasFixasError('Escolha como a conta chega (canal)');
  const dia = String(b.vencimentoDia ?? '').replace(/\D/g, '');
  if (dia && !(Number(dia) >= 1 && Number(dia) <= 31)) throw new ContasFixasError('O dia do vencimento vai de 1 a 31');
  const contrato = String(b.contratoVencimento || '').slice(0, 10);
  if (contrato && !/^\d{4}-\d{2}-\d{2}$/.test(contrato)) throw new ContasFixasError('Data do contrato inválida');
  return {
    tipo_despesa: tipo,
    nm_fornecedor: fornecedor,
    cd_fornecedor: texto(String(b.fornecedorCode ?? '').replace(/\D/g, ''), 20),
    vencimento: dia || null,
    forma_pagamento: texto(b.formaPagamento, 20)?.toUpperCase() || null,
    como_pegar_canal: canal,
    como_pegar: texto(b.comoPegar),
    observacao: texto(b.observacao, 4000),
    contrato_vencimento: contrato || null,
    updated_at: new Date().toISOString(),
  };
}
export async function criarDespesa(user, b = {}) {
  exigirEdicao(user);
  const cd = texto(b.cdFilial, 20);
  if (!cd) throw new ContasFixasError('Informe a loja');
  const loja = await q(supabase.from('contas_fixas_lojas').select('cd_filial').eq('cd_filial', cd).maybeSingle());
  if (!loja) throw new ContasFixasError(`A loja ${cd} não está no cadastro das lojas`, 'LOJA_INVALIDA');
  const linha = await q(supabase.from('despesas_fixas_filial').insert({ cd_filial: cd, ...camposDoCadastro(b) }).select('*').single());
  return cadastroPublico(linha);
}
export async function alterarDespesa(user, id, b = {}) {
  exigirEdicao(user);
  const linha = await q(supabase.from('despesas_fixas_filial').update(camposDoCadastro(b)).eq('id', String(id)).select('*').maybeSingle());
  if (!linha) throw new ContasFixasError('Despesa não encontrada', 'NAO_ENCONTRADA', 404);
  return cadastroPublico(linha);
}
export async function excluirDespesa(user, id) {
  const quem = exigirEdicao(user);
  const linha = await q(supabase.from('despesas_fixas_filial').select('*').eq('id', String(id)).maybeSingle());
  if (!linha) throw new ContasFixasError('Despesa não encontrada', 'NAO_ENCONTRADA', 404);
  if (linha.contrato_path) throw new ContasFixasError('Esta despesa tem contrato anexado: remova o contrato no Controle de Filiais antes de excluir', 'TEM_CONTRATO', 409);
  await q(supabase.from('despesas_fixas_filial').delete().eq('id', String(id)));
  console.log(`🗑️ [contas fixas] despesa ${linha.tipo_despesa} / ${linha.nm_fornecedor} da loja ${linha.cd_filial} excluída por ${quem}`);
  return { excluida: true, id: linha.id };
}

// ─── anotação da célula (loja + coluna) ──────────────────────────────────────
export async function anotarCelula(user, b = {}) {
  const quem = exigirEdicao(user);
  const cd = texto(b.cdFilial, 20);
  const coluna = String(b.coluna || '').toUpperCase();
  if (!cd) throw new ContasFixasError('Informe a loja');
  if (!COLUNAS.some((c) => c.id === coluna)) throw new ContasFixasError('Coluna inválida');
  const linha = { cd_filial: cd, tipo_despesa: coluna, nao_se_aplica: b.naoSeAplica === true, so_cadastro: b.soCadastro === true, observacao: texto(b.observacao), atualizado_por: quem, atualizado_em: new Date().toISOString() };
  if (!linha.nao_se_aplica && !linha.so_cadastro && !linha.observacao) {
    await q(supabase.from('contas_fixas_anotacoes').delete().eq('cd_filial', cd).eq('tipo_despesa', coluna));
    return { cdFilial: cd, coluna, naoSeAplica: false, observacao: null };
  }
  await q(supabase.from('contas_fixas_anotacoes').upsert(linha, { onConflict: 'cd_filial,tipo_despesa' }));
  return { cdFilial: cd, coluna, naoSeAplica: linha.nao_se_aplica, soCadastro: linha.so_cadastro, observacao: linha.observacao };
}

// ─── cadastro das lojas ──────────────────────────────────────────────────────
const lojaPublica = (l) => ({
  cdFilial: String(l.cd_filial),
  empresa: l.empresa,
  nome: l.nome,
  tipo: l.tipo,
  tipoNome: TIPOS_LOJA[l.tipo] || l.tipo,
  razaoSocial: l.razao_social,
  nomeFantasia: l.nome_fantasia,
  cnpj: l.cnpj,
  inscricaoEstadual: l.inscricao_estadual,
  grupo: l.grupo,
  endereco: l.endereco,
  bairro: l.bairro,
  cidade: l.cidade,
  uf: l.uf,
  cep: l.cep,
  shopping: l.shopping,
  telefone: l.telefone,
  email: l.email,
  responsavel: l.responsavel,
  centroCustoCode: l.centro_custo_code,
  observacao: l.observacao,
  ordem: l.ordem,
  ativo: l.ativo,
  atualizadoEm: l.atualizado_em,
  atualizadoPor: l.atualizado_por,
});
export async function lojasDoCadastro() {
  const [lojas, cads, ccs] = await Promise.all([listarLojas({ incluirInativas: true }), q(supabase.from('despesas_fixas_filial').select('cd_filial, tipo_despesa').limit(5000)), q(supabase.from('hc_cp_centros_custo').select('code, nome, tipo').eq('tipo', 'empresa').order('nome'))]);
  return {
    tipos: Object.entries(TIPOS_LOJA).map(([id, nome]) => ({ id, nome })),
    centrosCusto: (ccs || []).map((c) => ({ code: c.code, nome: c.nome })),
    lojas: lojas.map((l) => ({ ...lojaPublica(l), despesas: (cads || []).filter((c) => String(c.cd_filial) === String(l.cd_filial)).length })),
  };
}
function camposDaLoja(b) {
  const nome = texto(b.nome, 120);
  if (!nome) throw new ContasFixasError('Informe o nome da loja');
  const tipo = String(b.tipo || 'loja_rua');
  if (!TIPOS_LOJA[tipo]) throw new ContasFixasError('Tipo de loja inválido');
  const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
  return {
    nome: nome.toUpperCase(),
    tipo,
    empresa: num(b.empresa),
    razao_social: texto(b.razaoSocial, 200),
    nome_fantasia: texto(b.nomeFantasia, 200),
    cnpj: texto(String(b.cnpj ?? '').replace(/\D/g, ''), 14),
    inscricao_estadual: texto(b.inscricaoEstadual, 30),
    grupo: texto(b.grupo, 80),
    endereco: texto(b.endereco, 300),
    bairro: texto(b.bairro, 120),
    cidade: texto(b.cidade, 120),
    uf: texto(b.uf, 2)?.toUpperCase() || null,
    cep: texto(String(b.cep ?? '').replace(/\D/g, ''), 8),
    shopping: texto(b.shopping, 160),
    telefone: texto(b.telefone, 60),
    email: texto(b.email, 160),
    responsavel: texto(b.responsavel, 160),
    centro_custo_code: num(b.centroCustoCode),
    observacao: texto(b.observacao, 4000),
    ordem: num(b.ordem) ?? 0,
    ativo: b.ativo !== false,
  };
}
export async function salvarLoja(user, cdFilial, b = {}, { nova = false } = {}) {
  const quem = exigirEdicao(user);
  const cd = texto(cdFilial, 20)?.toUpperCase().replace(/\s+/g, '_');
  if (!cd || !/^[A-Z0-9_]+$/.test(cd)) throw new ContasFixasError('Código da loja inválido (use o código da empresa ou um nome sem espaços, ex.: CASA_CROSBY)');
  const linha = { ...camposDaLoja(b), atualizado_por: quem, atualizado_em: new Date().toISOString() };
  const existe = await q(supabase.from('contas_fixas_lojas').select('cd_filial').eq('cd_filial', cd).maybeSingle());
  if (nova && existe) throw new ContasFixasError(`Já existe uma loja com o código ${cd}`, 'JA_EXISTE', 409);
  if (!nova && !existe) throw new ContasFixasError('Loja não encontrada', 'NAO_ENCONTRADA', 404);
  const salva = nova ? await q(supabase.from('contas_fixas_lojas').insert({ cd_filial: cd, ...linha }).select('*').single()) : await q(supabase.from('contas_fixas_lojas').update(linha).eq('cd_filial', cd).select('*').single());
  return lojaPublica(salva);
}
