// ============================================================
// FLUXO DE CAIXA EXT — importação de extratos bancários (PDF) e visão
// gerencial consolidada: entradas, saídas (por forma de pagamento e por
// fornecedor) e transferências entre contas do grupo.
//
// Tabelas (migrations/fluxo_caixa_ext.sql):
//   fluxo_caixa_contas / fluxo_caixa_importacoes /
//   fluxo_caixa_lancamentos / fluxo_caixa_transferencias
//
// Fluxo:
//   importarExtrato(buffer)  → lerExtratoBancario (utils/extratosBancariosPdf.js)
//                            → garante a conta → apaga lançamentos da conta no
//                              período do PDF → grava importação + lançamentos
//   casarTransferencias()    → casa saída de uma conta com entrada em outra
//                              (mesmo valor, data D ou D+1, contraparte = titular)
//   painel(filtros)          → lançamentos + agregados prontos para a tela
// ============================================================
import crypto from 'node:crypto';
import supabase from '../config/supabase.js';
import { lerExtratoBancario, BANCOS, FORMAS } from '../utils/extratosBancariosPdf.js';
import { anexarConciliacoes, PESSOAS_PRO_LABORE } from './fluxoCaixaConciliacao.js';
import { anexarComprovantes } from './comprovantesStone.js';
import { extrairContraparte, completarContraparte } from '../utils/contraparteExtrato.js';

const T = {
  contas: 'fluxo_caixa_contas',
  imp: 'fluxo_caixa_importacoes',
  lanc: 'fluxo_caixa_lancamentos',
  transf: 'fluxo_caixa_transferencias',
};

// Escopo dos extratos: 'crosby' = Extrato Bancário do grupo (padrão);
// 'dr_ygor' = Financeiro → Dr Ygor → Extratos Bancários (mesmas tabelas,
// separadas pela coluna fluxo_caixa_contas.escopo — migrations/fluxo_caixa_escopo_dr_ygor.sql).
export const ESCOPOS = ['crosby', 'dr_ygor'];
export const ESCOPO_PADRAO = 'crosby';
export const normEscopo = (e) => (ESCOPOS.includes(String(e || '').toLowerCase()) ? String(e).toLowerCase() : ESCOPO_PADRAO);

// Enquanto a migration do escopo não roda, o módulo segue funcionando para o
// escopo padrão (sem filtro) e só o Dr Ygor responde MIGRATION_PENDING.
let _escopoColuna = null; // null = ainda não verificado
async function escopoColunaExiste() {
  if (_escopoColuna != null) return _escopoColuna;
  const { error } = await supabase.from(T.contas).select('escopo').limit(1);
  if (error && /escopo/i.test(error.message || '') && /does not exist|schema cache/i.test(error.message || '')) _escopoColuna = false;
  else {
    lancar(error);
    _escopoColuna = true;
  }
  return _escopoColuna;
}
async function prepararEscopo(escopo) {
  const esc = normEscopo(escopo);
  const existe = await escopoColunaExiste();
  if (!existe && esc !== ESCOPO_PADRAO)
    throw new MigrationPendingError('Coluna fluxo_caixa_contas.escopo não existe — rode migrations/fluxo_caixa_escopo_dr_ygor.sql no SQL Editor do Supabase (ou node scripts/migrar-fluxo-caixa-escopo.mjs).');
  return { esc, existe };
}
const eqEscopo = (q, esc, existe) => (existe ? q.eq('escopo', esc) : q);

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const addDias = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const diffDias = (a, b) => Math.round((new Date(`${a}T00:00:00Z`) - new Date(`${b}T00:00:00Z`)) / 86400000);

export class MigrationPendingError extends Error {
  constructor(msg) {
    super(msg);
    this.code = 'MIGRATION_PENDING';
  }
}
export const ehErroTabelaAusente = (error) =>
  /relation .*fluxo_caixa.* does not exist|Could not find the table 'public\.fluxo_caixa|schema cache/i.test(error?.message || '');

function lancar(error) {
  if (!error) return;
  if (ehErroTabelaAusente(error))
    throw new MigrationPendingError('Tabelas fluxo_caixa_* não existem — rode migrations/fluxo_caixa_ext.sql no SQL Editor do Supabase.');
  throw new Error(error.message || String(error));
}

// PostgREST devolve no máximo 1000 linhas por chamada → pagina
async function buscarTodos(montar, pageSize = 1000) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await montar().range(from, from + pageSize - 1);
    lancar(error);
    out.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

// ─── nomes / comparação ────────────────────────────────────────
const normNome = (s) =>
  semAcento(s)
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\b(LTDA|ME|EPP|EIRELI|SA|S A|S\/A|CIA)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function nomesBatem(a, b) {
  const x = normNome(a);
  const y = normNome(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const p = Math.min(x.length, y.length);
  if (p < 8) return false;
  return x.startsWith(y.slice(0, p)) || y.startsWith(x.slice(0, p)) || x.includes(y) || y.includes(x);
}
// Nomes pelos quais cada empresa do grupo aparece nos extratos (razão social
// antiga/nova, nome do sócio no Pix). Chave = raiz do CNPJ da conta.
const APELIDOS_EMPRESA = {
  17177680: ['FERREIRA COMERCIO E CONFECCOES LTDA', 'CROSBY CR VESTUARIO LTDA', 'CROSBY', 'CROSBY DISTRIBUICAO E CONFECCAO LTDA', 'CROSBY DISTRIBUICAO E CONFECCAO EIRELI', 'CROSBY DIST CONFEC EIRELI'],
  27728810: ['FA MODA & VAREJO LTDA', 'FABIO FERREIRA DE LIMA AZEVEDO', 'FABIO FERREIRA DE LIMA AZEVEDO LTDA'],
  53661116: ['IRMAOS VAREJO COMERCIAL LTDA', 'FLAVIO FERREIRA DE LIMA AZEVEDO LTDA', 'FLAVIO FERREIRA DE LIMA AZEVEDO'],
  // a conta Itaú 653039046-4 (hoje Irmãos CR) recebia em 2024 como "FLAVIO F LIMA AZ"
  33592092: ['IRMAOS CR VESTUARIO LTDA', 'FLAVIO FERREIRA DE LIMA AZEVEDO LTDA', 'FLAVIO FERREIRA DE LIMA AZEVEDO'],
};
// nome fantasia usado por qualquer empresa do grupo no Pix ("CROSBY", "IRMAOS"):
// vale como pista fraca (+1) para qualquer conta do grupo
const APELIDOS_GRUPO = ['CROSBY', 'IRMAOS'];
const contraparteBateGrupo = (nome) => !!nome && APELIDOS_GRUPO.some((ap) => normNome(nome) === ap || nomeTruncadoBate(nome, ap) || nomeTruncadoBate(ap, nome));
// CPF do sócio que aparece como contraparte do Pix da empresa dele (cadastro
// do pró-labore em fluxoCaixaConciliacao; o nome do sócio já cobre os demais)
const DOCS_EMPRESA = { 27728810: PESSOAS_PRO_LABORE.filter((p) => /FABIO/i.test(p.pessoa || p.id)).map((p) => String(p.cpf).replace(/\D/g, '')) };
const PARTICULAS = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'L', 'A']);
const tokensNome = (s) => normNome(s).split(' ').filter((t) => t && !PARTICULAS.has(t));
// nome truncado do extrato ("FABIO F LIMA AZE", "CROSBY DIST CONF", "CROSBY") bate
// com o nome completo quando cada pedaço é prefixo do pedaço correspondente
export function nomeTruncadoBate(curto, longo) {
  const c = tokensNome(curto);
  const l = tokensNome(longo);
  if (!c.length || !l.length) return false;
  if (c[0].length < 3 || !l[0].startsWith(c[0])) return false;
  let j = 0;
  let letras = 0;
  for (const t of c) {
    while (j < l.length && !l[j].startsWith(t)) j++;
    if (j >= l.length) return false;
    letras += t.length;
    j++;
  }
  return letras >= 5;
}
// contraparte do lançamento bate com a conta (titular gravado OU qualquer nome da empresa)
function contraparteBateConta(nome, conta) {
  if (!nome || !conta) return false;
  if (nomesBatem(nome, conta.titular_nome) || nomeTruncadoBate(nome, conta.titular_nome)) return true;
  const raiz = String(conta.titular_cnpj || '').replace(/\D/g, '').slice(0, 8);
  return (APELIDOS_EMPRESA[raiz] || []).some((ap) => nomesBatem(nome, ap) || nomeTruncadoBate(nome, ap));
}
// documento da contraparte (CNPJ da empresa ou CPF do sócio) aponta para a conta
function docAponta(doc, conta) {
  const d = String(doc || '').replace(/\D/g, '');
  const cnpj = String(conta?.titular_cnpj || '').replace(/\D/g, '');
  if (!d || !cnpj) return 0;
  if (d === cnpj) return 3;
  if (d.length === 14 && d.slice(0, 8) === cnpj.slice(0, 8)) return 1;
  if ((DOCS_EMPRESA[cnpj.slice(0, 8)] || []).includes(d)) return 3;
  return 0;
}
// agência/conta citadas no histórico (Santander "PIX ENVIADO ISPB/2207/00000367338", Itaú "TRANSF 6530.56927-3") apontam para a conta
function contaCitadaBate(pista, conta) {
  if (!pista || !conta) return false;
  const ag = String(conta.agencia || '').replace(/\D/g, '');
  const num = String(conta.conta || '').replace(/\D/g, '');
  const numDv = `${num}${String(conta.conta_dv || '').replace(/\D/g, '')}`;
  if (!num) return false;
  const agOk = !ag || !pista.agencia || String(Number(ag)) === String(Number(pista.agencia));
  const nums = [pista.numero, pista.numeroSemDv].filter(Boolean).map((x) => String(Number(x)));
  return agOk && nums.some((n) => n === String(Number(num)) || n === String(Number(numDv)) || (numDv.length > 1 && n === String(Number(numDv.slice(0, -1)))));
}

const bancoBate = (textoBanco, banco) => {
  const up = semAcento(textoBanco).toUpperCase();
  if (banco === 'SICREDI') return /SICREDI|COOPERATIVA DE CREDITO/.test(up);
  if (banco === 'STONE') return /STONE/.test(up);
  if (banco === 'CAIXA') return /CAIXA ECONOMICA|^CAIXA$/.test(up);
  if (banco === 'MENTORE') return /MENTORE/.test(up);
  if (banco === 'ITAU') return /\bITAU\b/.test(up);
  if (banco === 'BB') return /BANCO DO BRASIL|^BB$/.test(up);
  if (banco === 'SANTANDER') return /SANTANDER/.test(up);
  if (banco === 'UNICRED') return /UNICRED/.test(up);
  if (banco === 'BRADESCO') return /BRADESCO/.test(up);
  if (banco === 'BNB') return /NORDESTE|^BNB$/.test(up);
  return false;
};

// apelido curto para a tela: "Stone 0001-03", "Sicredi 36733-8", "Mêntore A01"
export function apelidoPadrao(extrato) {
  const { banco, titular } = extrato;
  const nomeBanco = { STONE: 'Stone', SICREDI: 'Sicredi', CAIXA: 'Caixa', MENTORE: 'Mêntore', BNB: 'BNB', SANTANDER: 'Santander', UNICRED: 'Unicred', DAYCOVAL: 'Daycoval', PAGBANK: 'PagBank', PAGARME: 'Pagar.me', BB: 'BB', ITAU: 'Itaú' }[banco] || BANCOS[banco]?.nome || banco;
  if (banco === 'MENTORE') {
    const m = String(titular.nome || '').match(/\b([A-Z]\d{2})\b/);
    if (m) return `${nomeBanco} ${m[1]}`;
  }
  if (titular.cnpj && titular.cnpj.length === 14) return `${nomeBanco} ${titular.cnpj.slice(8, 12)}-${titular.cnpj.slice(12)}`;
  return `${nomeBanco} ${titular.conta}${titular.contaDv ? `-${titular.contaDv}` : ''}`;
}

// ─── contas ────────────────────────────────────────────────────
export async function listarContas(escopo = ESCOPO_PADRAO) {
  const { esc, existe } = await prepararEscopo(escopo);
  const contas = await buscarTodos(() => eqEscopo(supabase.from(T.contas).select('*'), esc, existe).order('banco').order('conta'));
  const ids = contas.map((c) => c.id);
  const imps = ids.length ? await buscarTodos(() => supabase.from(T.imp).select('*').in('conta_id', ids).order('importado_em', { ascending: false })) : [];
  const porConta = new Map();
  for (const i of imps) {
    const c = porConta.get(i.conta_id) || { importacoes: 0, ultima: null, periodoInicio: null, periodoFim: null };
    c.importacoes += 1;
    if (!c.ultima) c.ultima = i;
    if (i.periodo_inicio && (!c.periodoInicio || i.periodo_inicio < c.periodoInicio)) c.periodoInicio = i.periodo_inicio;
    if (i.periodo_fim && (!c.periodoFim || i.periodo_fim > c.periodoFim)) c.periodoFim = i.periodo_fim;
    porConta.set(i.conta_id, c);
  }
  return contas.map((c) => {
    const r = porConta.get(c.id) || {};
    return {
      ...c,
      apelido: c.apelido || `${c.banco_nome || c.banco} ${c.conta}`,
      qtdImportacoes: r.importacoes || 0,
      ultimaImportacao: r.ultima
        ? { id: r.ultima.id, arquivo: r.ultima.arquivo_nome, em: r.ultima.importado_em, periodoInicio: r.ultima.periodo_inicio, periodoFim: r.ultima.periodo_fim, saldoInicial: r.ultima.saldo_inicial, saldoFinal: r.ultima.saldo_final, qtd: r.ultima.qtd_lancamentos }
        : null,
      periodoInicio: r.periodoInicio || null,
      periodoFim: r.periodoFim || null,
    };
  });
}

export async function atualizarConta(id, patch) {
  const permitido = {};
  if (patch.apelido !== undefined) permitido.apelido = patch.apelido ? String(patch.apelido).trim() : null;
  if (patch.titular_nome !== undefined) permitido.titular_nome = patch.titular_nome ? String(patch.titular_nome).trim() : null;
  if (patch.titular_cnpj !== undefined) {
    const d = soDigitos(patch.titular_cnpj);
    if (d && d.length !== 14) throw new Error('CNPJ do titular deve ter 14 dígitos.');
    permitido.titular_cnpj = d || null;
  }
  if (patch.ativo !== undefined) permitido.ativo = !!patch.ativo;
  // código da conta no TOTVS (CTA), usado pela página Conciliação
  if (patch.cta_totvs !== undefined) permitido.cta_totvs = patch.cta_totvs ? String(patch.cta_totvs).trim().slice(0, 20) : null;
  permitido.atualizado_em = new Date().toISOString();
  const { data, error } = await supabase.from(T.contas).update(permitido).eq('id', id).select().single();
  lancar(error);
  return data;
}

// O número menor (5+ dígitos) é o final do maior, com ou sem o dígito verificador.
export function mesmoNumeroConta(a, b) {
  const x = String(a ?? '').replace(/\D/g, '');
  const y = String(b ?? '').replace(/\D/g, '');
  const [menor, maior] = x.length <= y.length ? [x, y] : [y, x];
  if (menor.length < 5 || menor === maior) return menor.length >= 5;
  return maior.endsWith(menor) || maior.slice(0, -1).endsWith(menor);
}

async function garantirConta(extrato, escopo = ESCOPO_PADRAO) {
  const { esc, existe } = await prepararEscopo(escopo);
  const chave = { banco: extrato.banco, agencia: extrato.titular.agencia || '', conta: extrato.titular.conta, ...(existe ? { escopo: esc } : {}) };
  if (!chave.conta) throw new Error('Conta não identificada no extrato.');
  const { data: exata, error } = await supabase.from(T.contas).select('*').match(chave).maybeSingle();
  lancar(error);
  // PDF e OFX escrevem o mesmo número de formas diferentes (Sicredi "36733" ×
  // "2207000000036733-8", Caixa sem × com DV). Sem isto a mesma conta vira duas e
  // as transações contam em dobro. Só aceita quando existe UMA candidata.
  let existente = exata;
  if (!existente) {
    const irmas = await buscarTodos(() => eqEscopo(supabase.from(T.contas).select('*').eq('banco', extrato.banco), esc, existe).order('id'));
    const candidatas = irmas.filter((c) => mesmoNumeroConta(c.conta, chave.conta));
    if (candidatas.length === 1) existente = candidatas[0];
  }
  const agora = new Date().toISOString();
  if (existente) {
    const patch = {
      banco_codigo: extrato.bancoCodigo,
      banco_nome: extrato.bancoNome,
      conta_dv: extrato.titular.contaDv || existente.conta_dv,
      titular_nome: existente.titular_nome || extrato.titular.nome,
      titular_cnpj: existente.titular_cnpj || extrato.titular.cnpj,
      apelido: existente.apelido || apelidoPadrao(extrato),
      atualizado_em: agora,
    };
    const r = await supabase.from(T.contas).update(patch).eq('id', existente.id).select().single();
    lancar(r.error);
    return r.data;
  }
  const r = await supabase
    .from(T.contas)
    .insert({
      ...chave,
      banco_codigo: extrato.bancoCodigo,
      banco_nome: extrato.bancoNome,
      conta_dv: extrato.titular.contaDv,
      titular_nome: extrato.titular.nome,
      titular_cnpj: extrato.titular.cnpj,
      apelido: apelidoPadrao(extrato),
    })
    .select()
    .single();
  lancar(r.error);
  return r.data;
}

// ─── importação ────────────────────────────────────────────────
const resumoExtrato = (e) => ({
  banco: e.banco,
  bancoNome: e.bancoNome,
  titular: e.titular,
  periodo: e.periodo,
  saldo: e.saldo,
  conferencia: e.conferencia,
  avisos: e.avisos,
  paginas: e.paginas,
  qtd: e.qtd,
});

/** Só lê (não grava) — para conferência na tela */
export async function lerExtrato(buffer, opts = {}) {
  const extrato = await lerExtratoBancario(buffer, opts);
  return { ...resumoExtrato(extrato), apelido: apelidoPadrao(extrato), lancamentos: extrato.lancamentos };
}

export async function importarExtrato(buffer, { nomeArquivo, usuario, banco, arquivoPath, origem, escopo } = {}) {
  const extrato = await lerExtratoBancario(buffer, { nomeArquivo, banco });
  const hash = crypto.createHash('sha1').update(buffer).digest('hex');
  return persistirExtrato(extrato, { nomeArquivo, usuario, hash, arquivoPath, origem: origem || 'upload', escopo });
}

/**
 * Importa um extrato já interpretado (ex.: JSON da API do portal Stone montado
 * por utils/extratoStoneApi.js). Mesma regra de reimportação do PDF.
 */
export async function importarExtratoObjeto(extrato, { nomeArquivo, usuario, arquivoPath, origem, escopo } = {}) {
  const hash = crypto.createHash('sha1').update(JSON.stringify(extrato.lancamentos || [])).digest('hex');
  return persistirExtrato(extrato, { nomeArquivo, usuario, hash, arquivoPath, origem: origem || 'api', escopo });
}

async function persistirExtrato(extrato, { nomeArquivo, usuario, hash, arquivoPath, origem, escopo } = {}) {
  const conta = await garantirConta(extrato, escopo);
  const inicio = extrato.periodo.inicio || extrato.periodo.primeiroLancamento;
  const fim = extrato.periodo.fim || extrato.periodo.ultimoLancamento;

  // reimportação: o PDF é a fonte da verdade do período que cobre
  // edições manuais (fornecedor/observação) dos lançamentos que vão ser
  // substituídos são reaplicadas nos novos pela chave data|valor|memo
  const manuais = new Map();
  if (inicio && fim) {
    const { data: antigos, error: eAnt } = await supabase
      .from(T.lanc)
      .select('data,valor,memo,fornecedor,observacao')
      .eq('conta_id', conta.id)
      .gte('data', inicio)
      .lte('data', fim)
      .or('fornecedor.not.is.null,observacao.not.is.null');
    lancar(eAnt);
    for (const a of antigos || []) {
      const k = `${a.data}|${Number(a.valor)}|${a.memo || ''}`;
      if (!manuais.has(k)) manuais.set(k, []);
      manuais.get(k).push({ fornecedor: a.fornecedor, observacao: a.observacao });
    }
    const del = await supabase.from(T.lanc).delete().eq('conta_id', conta.id).gte('data', inicio).lte('data', fim);
    lancar(del.error);
    // importações anteriores da mesma conta totalmente cobertas por este período ficam obsoletas
    const delImp = await supabase.from(T.imp).delete().eq('conta_id', conta.id).gte('periodo_inicio', inicio).lte('periodo_fim', fim);
    lancar(delImp.error);
  }

  const imp = await supabase
    .from(T.imp)
    .insert({
      conta_id: conta.id,
      arquivo_nome: nomeArquivo || null,
      arquivo_hash: hash,
      periodo_inicio: inicio,
      periodo_fim: fim,
      saldo_inicial: extrato.saldo.inicial,
      saldo_final: extrato.saldo.final,
      qtd_lancamentos: extrato.qtd,
      inconsistencias: extrato.conferencia?.inconsistencias || 0,
      avisos: extrato.avisos?.length ? extrato.avisos : null,
      usuario: usuario || null,
      ...(arquivoPath ? { arquivo_path: arquivoPath } : {}),
      ...(origem ? { origem } : {}),
    })
    .select()
    .single();
  lancar(imp.error);

  const rows = extrato.lancamentos.map((l) => ({
    conta_id: conta.id,
    importacao_id: imp.data.id,
    data: l.data,
    hora: l.hora,
    seq: l.seq,
    valor: l.valor,
    natureza: l.natureza,
    tipo: l.tipo,
    forma: l.forma,
    categoria: l.categoria,
    descricao: l.descricao || null,
    memo: l.memo || null,
    documento: l.documento || null,
    ...(() => {
      const { patch } = completarContraparte(l, extrato.banco);
      return {
        contraparte_nome: patch.nome || l.contraparteNome || null,
        contraparte_doc: patch.doc || l.contraparteDoc || null,
        contraparte_banco: patch.banco || l.contraparteBanco || null,
      };
    })(),
    bandeira: l.bandeira || null,
    loja: l.loja || null,
    saldo_apos: l.saldoApos,
    pagina: l.pagina,
    ...(() => {
      const fila = manuais.get(`${l.data}|${Number(l.valor)}|${l.memo || ''}`);
      const m = fila?.shift();
      return m ? { fornecedor: m.fornecedor, observacao: m.observacao } : {};
    })(),
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const ins = await supabase.from(T.lanc).insert(rows.slice(i, i + 500));
    lancar(ins.error);
  }

  return { conta, importacao: imp.data, extrato: resumoExtrato(extrato) };
}

/**
 * Importa vários PDFs e recasa as transferências do período coberto.
 * @param arquivos [{ buffer, nome }]
 */
export async function importarVarios(arquivos, { usuario, origem, escopo } = {}) {
  const esc = normEscopo(escopo);
  const resultados = [];
  let de = null;
  let ate = null;
  for (const a of arquivos) {
    try {
      const r = a.extrato
        ? await importarExtratoObjeto(a.extrato, { nomeArquivo: a.nome, usuario, arquivoPath: a.arquivoPath, origem: a.origem || origem, escopo: esc })
        : await importarExtrato(a.buffer, { nomeArquivo: a.nome, usuario, arquivoPath: a.arquivoPath, origem: a.origem || origem, escopo: esc });
      const p = r.extrato.periodo;
      if (p.inicio && (!de || p.inicio < de)) de = p.inicio;
      if (p.fim && (!ate || p.fim > ate)) ate = p.fim;
      resultados.push({
        arquivo: a.nome,
        ok: true,
        banco: r.extrato.banco,
        importacaoId: r.importacao.id,
        contaId: r.conta.id,
        conta: r.conta.apelido,
        titular: r.conta.titular_nome,
        periodo: p,
        qtd: r.extrato.qtd,
        saldo: r.extrato.saldo,
        inconsistencias: r.extrato.conferencia?.inconsistencias || 0,
        avisos: r.extrato.avisos || [],
      });
    } catch (e) {
      if (e instanceof MigrationPendingError) throw e;
      resultados.push({ arquivo: a.nome, ok: false, erro: e.message });
    }
  }
  let transferencias = null;
  if (de && ate) transferencias = await casarTransferencias({ de, ate, escopo: esc });
  return { resultados, periodo: { de, ate }, transferencias };
}

export async function listarImportacoes(escopo = ESCOPO_PADRAO) {
  const { esc, existe } = await prepararEscopo(escopo);
  const contas = await buscarTodos(() => eqEscopo(supabase.from(T.contas).select('id,apelido,banco,titular_nome'), esc, existe));
  const ids = contas.map((c) => c.id);
  if (!ids.length) return [];
  const imps = await buscarTodos(() => supabase.from(T.imp).select('*').in('conta_id', ids).order('importado_em', { ascending: false }));
  const porId = new Map(contas.map((c) => [c.id, c]));
  return imps.map((i) => ({ ...i, conta: porId.get(i.conta_id) || null }));
}

export const BUCKET_EXTRATOS = 'extratos-bancarios';

/** Guarda o arquivo original (PDF) no Storage e devolve o path gravado. */
export async function guardarArquivoExtrato(buffer, { nome, pasta = 'upload' } = {}) {
  const seguro = String(nome || 'extrato.pdf').replace(/[^\w.\-]+/g, '_');
  const path = `${pasta}/${new Date().toISOString().slice(0, 7)}/${Date.now()}_${seguro}`;
  const { error } = await supabase.storage.from(BUCKET_EXTRATOS).upload(path, buffer, {
    contentType: /\.xlsx$/i.test(seguro) ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf',
    upsert: false,
  });
  if (error) throw new Error(`Storage (${BUCKET_EXTRATOS}): ${error.message}`);
  return path;
}

/** Link temporário (5 min) para baixar o arquivo da importação. */
export async function urlArquivoImportacao(id) {
  const { data: imp, error } = await supabase.from(T.imp).select('id,arquivo_nome,arquivo_path').eq('id', id).maybeSingle();
  lancar(error);
  if (!imp) throw new Error('Importação não encontrada.');
  if (!imp.arquivo_path) throw new Error('Esta importação não tem o arquivo guardado (importada antes do bot ou via API).');
  const { data, error: e2 } = await supabase.storage.from(BUCKET_EXTRATOS).createSignedUrl(imp.arquivo_path, 60 * 5, { download: imp.arquivo_nome || undefined });
  if (e2) throw new Error(`Storage: ${e2.message}`);
  return { url: data.signedUrl, nome: imp.arquivo_nome };
}

export async function excluirImportacao(id) {
  const { data: imp, error } = await supabase.from(T.imp).select('*').eq('id', id).maybeSingle();
  lancar(error);
  if (!imp) throw new Error('Importação não encontrada.');
  if (imp.arquivo_path) await supabase.storage.from(BUCKET_EXTRATOS).remove([imp.arquivo_path]).catch(() => {});
  const d1 = await supabase.from(T.lanc).delete().eq('importacao_id', id);
  lancar(d1.error);
  const d2 = await supabase.from(T.imp).delete().eq('id', id);
  lancar(d2.error);
  if (imp.periodo_inicio && imp.periodo_fim) {
    const { data: conta } = await supabase.from(T.contas).select('*').eq('id', imp.conta_id).maybeSingle();
    await casarTransferencias({ de: imp.periodo_inicio, ate: imp.periodo_fim, escopo: conta?.escopo });
  }
  return imp;
}

// ─── transferências entre contas ───────────────────────────────
/**
 * Casa saídas de uma conta com entradas em outra conta do grupo.
 * Critérios: mesmo valor, entrada no mesmo dia ou no dia seguinte, e pelo
 * menos uma evidência de identidade (CNPJ/nome da contraparte = titular da
 * outra conta, ou banco da contraparte = banco da outra conta).
 * Pares automáticos anteriores do período são refeitos.
 */
/**
 * Completa contraparte_doc/nome/banco dos lançamentos já importados a partir
 * do histórico/documento (extratos antigos de 2024/2025 guardavam o CNPJ e o
 * nome só no texto). Só preenche o que falta ou é lixo. Grava em lotes por
 * SQL (exec_sql) para não fazer um UPDATE por linha.
 */
export async function enriquecerContrapartes({ de, ate, escopo } = {}) {
  const { esc, existe } = await prepararEscopo(escopo);
  const contas = await buscarTodos(() => eqEscopo(supabase.from(T.contas).select('id,banco'), esc, existe));
  const bancoDe = new Map(contas.map((c) => [c.id, c.banco]));
  const ids = contas.map((c) => c.id);
  if (!ids.length) return { lidos: 0, atualizados: 0 };
  const rows = await buscarTodos(() => {
    let q = supabase.from(T.lanc).select('id,conta_id,memo,documento,contraparte_nome,contraparte_doc,contraparte_banco').in('conta_id', ids).order('id');
    if (de) q = q.gte('data', de);
    if (ate) q = q.lte('data', ate);
    return q;
  });
  const patches = [];
  for (const r of rows) {
    const { patch } = completarContraparte(r, bancoDe.get(r.conta_id) || null);
    if (Object.keys(patch).length) patches.push({ id: r.id, ...patch });
  }
  const sqlStr = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
  let atualizados = 0;
  for (let i = 0; i < patches.length; i += 400) {
    const fatia = patches.slice(i, i + 400);
    const values = fatia.map((p) => `(${p.id}, ${sqlStr(p.nome)}, ${sqlStr(p.doc)}, ${sqlStr(p.banco)})`).join(',');
    const query = `update ${T.lanc} l set contraparte_nome = coalesce(v.nome, l.contraparte_nome), contraparte_doc = coalesce(v.doc, l.contraparte_doc), contraparte_banco = coalesce(v.banco, l.contraparte_banco) from (values ${values}) as v(id, nome, doc, banco) where l.id = v.id`;
    const { error } = await supabase.rpc('exec_sql', { query });
    if (error) {
      // sem a RPC: um a um
      for (const p of fatia) {
        const upd = {};
        if (p.nome) upd.contraparte_nome = p.nome;
        if (p.doc) upd.contraparte_doc = p.doc;
        if (p.banco) upd.contraparte_banco = p.banco;
        lancar((await supabase.from(T.lanc).update(upd).eq('id', p.id)).error);
      }
    }
    atualizados += fatia.length;
  }
  return { lidos: rows.length, atualizados };
}

/**
 * Entre contas de um lado só: entrada/saída cuja contraparte é uma EMPRESA do
 * grupo (CNPJ de raiz igual à de alguma conta do escopo, ou nome/razão social
 * das empresas), que não achou a outra ponta (extrato da outra conta não
 * importado, valor com tarifa, etc.). Pedido do Yago (05/11/2026): "todo
 * dinheiro que vem dessas empresas é entre contas". Marca tipo TRANSFERENCIA
 * (sem par) e anota na observação; fica fora de Recebido/Pago. Não entra:
 * linha já conciliada, Pix do próprio CNPJ da conta (QR Code TOTVS/Fiserv),
 * contraparte igual ao próprio titular (saque Pagar.me na Stone), e pessoa
 * física (sócio = pró-labore, não entre contas).
 */
export const MARCA_UM_LADO = 'Entre contas (outra ponta não importada)';
export async function marcarEntreContasSemPar({ de, ate, escopo }) {
  const { esc, existe } = await prepararEscopo(escopo);
  const contas = await buscarTodos(() => eqEscopo(supabase.from(T.contas).select('*'), esc, existe));
  const porId = new Map(contas.map((c) => [c.id, c]));
  const ids = contas.map((c) => c.id);
  if (!ids.length) return { desmarcadas: 0, marcadas: 0 };
  const raizes = new Set(contas.map((c) => String(c.titular_cnpj || '').replace(/\D/g, '').slice(0, 8)).filter((r) => r.length === 8));
  const nomesGrupo = [...new Set([...contas.map((c) => c.titular_nome).filter(Boolean), ...Object.values(APELIDOS_EMPRESA).flat()])];
  const ehEmpresaDoGrupo = (nome, doc) => {
    const d = String(doc || '').replace(/\D/g, '');
    if (d.length === 14) return raizes.has(d.slice(0, 8));
    if (d.length === 11) return false; // pessoa física não é entre contas
    return !!nome && nomesGrupo.some((n) => nomesBatem(nome, n) || nomeTruncadoBate(nome, n));
  };
  // desfaz as marcas anteriores do período (a cada rodada, parte do zero)
  const marcadas = await buscarTodos(() => supabase.from(T.lanc).select('id,valor').in('conta_id', ids).gte('data', de).lte('data', ate).is('transferencia_id', null).eq('tipo', 'TRANSFERENCIA').eq('observacao', MARCA_UM_LADO));
  for (let i = 0; i < marcadas.length; i += 200) {
    const fatia = marcadas.slice(i, i + 200);
    const ent = fatia.filter((l) => Number(l.valor) > 0).map((l) => l.id);
    const sai = fatia.filter((l) => Number(l.valor) <= 0).map((l) => l.id);
    if (ent.length) lancar((await supabase.from(T.lanc).update({ tipo: 'ENTRADA', observacao: null }).in('id', ent)).error);
    if (sai.length) lancar((await supabase.from(T.lanc).update({ tipo: 'SAIDA', observacao: null }).in('id', sai)).error);
  }
  const rows = await buscarTodos(() =>
    supabase.from(T.lanc).select('id,conta_id,valor,categoria,memo,contraparte_nome,contraparte_doc,contraparte_banco,observacao,tipo').in('conta_id', ids).gte('data', de).lte('data', ate).is('transferencia_id', null).in('categoria', ['pix', 'transferencia']).order('id'),
  );
  const conciliadas = new Set();
  for (let i = 0; i < rows.length; i += 300) {
    const { data } = await supabase.from('fluxo_caixa_conciliacoes').select('lancamento_id').in('lancamento_id', rows.slice(i, i + 300).map((r) => r.id));
    for (const c of data || []) conciliadas.add(c.lancamento_id);
  }
  const alvo = rows.filter((r) => {
    if (conciliadas.has(r.id)) return false;
    if (r.tipo === 'TRANSFERENCIA') return false; // marcada manualmente
    const conta = porId.get(r.conta_id);
    const pista = extrairContraparte(r, conta?.banco || null);
    const doc = String(r.contraparte_doc || pista.doc || '').replace(/\D/g, '');
    const nome = r.contraparte_nome || pista.nome || null;
    const proprio = String(conta?.titular_cnpj || '').replace(/\D/g, '');
    if (doc && doc === proprio) return false; // Pix do QR Code TOTVS (Fiserv) parece a própria empresa
    if (/FISERV/i.test(r.contraparte_banco || '')) return false;
    if (!doc && nome && conta?.titular_nome && nomesBatem(nome, conta.titular_nome)) return false; // saque Pagar.me / mesma titularidade
    return ehEmpresaDoGrupo(nome, doc);
  });
  for (let i = 0; i < alvo.length; i += 200) {
    const fatia = alvo.slice(i, i + 200);
    const semObs = fatia.filter((l) => !l.observacao).map((l) => l.id);
    const comObs = fatia.filter((l) => l.observacao).map((l) => l.id);
    if (semObs.length) lancar((await supabase.from(T.lanc).update({ tipo: 'TRANSFERENCIA', observacao: MARCA_UM_LADO }).in('id', semObs)).error);
    if (comObs.length) lancar((await supabase.from(T.lanc).update({ tipo: 'TRANSFERENCIA' }).in('id', comObs)).error);
  }
  return { desmarcadas: marcadas.length, marcadas: alvo.length, valor: round2(alvo.reduce((s, l) => s + Math.abs(Number(l.valor)), 0)) };
}

export async function casarTransferencias({ de, ate, escopo }) {
  const deM = addDias(de, -1);
  const ateM = addDias(ate, 1);
  // só casa contas do mesmo escopo (Crosby × Dr Ygor nunca se misturam)
  const { esc, existe } = await prepararEscopo(escopo);
  const contas = await buscarTodos(() => eqEscopo(supabase.from(T.contas).select('*'), esc, existe));
  const porId = new Map(contas.map((c) => [c.id, c]));
  const idsEscopo = contas.map((c) => c.id);
  if (!idsEscopo.length) return { periodo: { de, ate }, desfeitas: 0, criadas: 0 };

  // desfaz pares automáticos do período
  const antigos = await buscarTodos(() => supabase.from(T.transf).select('id').eq('metodo', 'auto').in('origem_conta_id', idsEscopo).gte('data', deM).lte('data', ateM));
  if (antigos.length) {
    const ids = antigos.map((t) => t.id);
    for (let i = 0; i < ids.length; i += 200) {
      const fatia = ids.slice(i, i + 200);
      lancar((await supabase.from(T.lanc).update({ tipo: 'SAIDA', transferencia_id: null }).in('transferencia_id', fatia).lt('valor', 0)).error);
      lancar((await supabase.from(T.lanc).update({ tipo: 'ENTRADA', transferencia_id: null }).in('transferencia_id', fatia).gt('valor', 0)).error);
      lancar((await supabase.from(T.transf).delete().in('id', fatia)).error);
    }
  }

  const brutos = await buscarTodos(() =>
    supabase
      .from(T.lanc)
      .select('id,conta_id,data,valor,forma,categoria,descricao,memo,documento,contraparte_nome,contraparte_doc,contraparte_banco')
      .in('conta_id', idsEscopo)
      .gte('data', deM)
      .lte('data', ateM)
      .in('categoria', ['pix', 'transferencia', 'outros'])
      .is('transferencia_id', null)
      .order('data'),
  );
  // "outros" só entra quando o histórico é claramente TED/transferência (Sicredi 2024 classificou a TED recebida como outros)
  // linha já conciliada com contas a pagar/Liberação/Solicitação/CR não é transferência (a conciliação é prova)
  const conciliadas = new Set();
  for (let i = 0; i < brutos.length; i += 300) {
    const ids = brutos.slice(i, i + 300).map((r) => r.id);
    const { data } = await supabase.from('fluxo_caixa_conciliacoes').select('lancamento_id').in('lancamento_id', ids);
    for (const c of data || []) conciliadas.add(c.lancamento_id);
  }
  const rows = brutos.filter((r) => !conciliadas.has(r.id) && (r.categoria !== 'outros' || /^(TED|DOC|TRANSF)/i.test(semAcento(`${r.descricao || ''} ${r.memo || ''}`).trim())));
  const pistaDe = new Map();
  for (const r of rows) pistaDe.set(r.id, extrairContraparte(r, porId.get(r.conta_id)?.banco || null));
  const cents = (v) => Math.round(Math.abs(Number(v)) * 100);
  const entradasPorValor = new Map();
  const saidasPorValor = new Map();
  for (const r of rows) {
    if (Math.abs(Number(r.valor)) < 1) continue;
    const k = cents(r.valor);
    const mapa = Number(r.valor) > 0 ? entradasPorValor : saidasPorValor;
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k).push(r);
  }
  // lançamento sem nenhuma pista de contraparte (nem nome, nem documento, nem banco/conta)
  const semPista = (r) => {
    const p = pistaDe.get(r.id) || {};
    return !r.contraparte_nome && !r.contraparte_doc && !r.contraparte_banco && !p.nome && !p.doc && !p.banco && !p.conta && !p.mesmaTitularidade;
  };
  // 1) pontua TODAS as combinações saída × entrada de mesmo valor (entrada até
  //    3 dias depois: PIX agendado / fim de semana); 2) fecha os pares do
  //    melhor para o pior — assim um encadeamento A→B→C (mesmo valor, mesmo
  //    dia) vira A→B e B→C em vez de A→C com as pontas de B soltas.
  const combos = [];
  for (const s of rows) {
    if (Number(s.valor) >= 0 || Math.abs(Number(s.valor)) < 1) continue;
    const origem = porId.get(s.conta_id);
    for (const e of entradasPorValor.get(cents(s.valor)) || []) {
      if (e.conta_id === s.conta_id) continue;
      const dd = diffDias(e.data, s.data);
      // entrada até 3 dias depois da saída; ou até 3 dias ANTES quando o banco
      // da saída só lança no dia útil seguinte (Pix no sábado: Stone credita
      // no dia, Sicredi debita na segunda) — nesse caso exige evidência forte
      if (dd > 3 || dd < -3) continue;
      const destino = porId.get(e.conta_id);
      const ps = pistaDe.get(s.id) || {};
      const pe = pistaDe.get(e.id) || {};
      let sc = 0;
      sc += Math.max(docAponta(s.contraparte_doc, destino), docAponta(ps.doc, destino));
      sc += Math.max(docAponta(e.contraparte_doc, origem), docAponta(pe.doc, origem));
      if (contraparteBateConta(s.contraparte_nome, destino) || contraparteBateConta(ps.nome, destino)) sc += 2;
      else if (contraparteBateGrupo(s.contraparte_nome) || contraparteBateGrupo(ps.nome)) sc += 1;
      if (contraparteBateConta(e.contraparte_nome, origem) || contraparteBateConta(pe.nome, origem)) sc += 2;
      else if (contraparteBateGrupo(e.contraparte_nome) || contraparteBateGrupo(pe.nome)) sc += 1;
      const bancoS = s.contraparte_banco || ps.banco;
      const bancoE = e.contraparte_banco || pe.banco;
      if (bancoS && destino && bancoBate(bancoS, destino.banco)) sc += 1;
      if (bancoE && origem && bancoBate(bancoE, origem.banco)) sc += 1;
      // agência/conta de destino citadas na saída (Santander/Itaú)
      if (ps.conta && contaCitadaBate(ps.conta, destino)) sc += 3;
      // "mesma titularidade" (Santander): destino é conta do mesmo CNPJ
      if (ps.mesmaTitularidade && origem?.titular_cnpj && origem.titular_cnpj === destino?.titular_cnpj) sc += 3;
      if (dd === 0) sc += 1;
      else if (dd >= 2 || dd < 0) sc -= 1;
      // sem nenhuma pista dos dois lados: só o par ÚNICO do dia (mesmo valor, nenhuma
      // outra saída/entrada igual em ±3 dias) com valor ≥ R$ 1.000 vale como entre contas
      if (sc === 1 && dd === 0 && semPista(s) && semPista(e) && Math.abs(Number(s.valor)) >= 1000) {
        const k = cents(s.valor);
        const outrasE = (entradasPorValor.get(k) || []).filter((x) => x.id !== e.id && Math.abs(diffDias(x.data, s.data)) <= 3);
        const outrasS = (saidasPorValor.get(k) || []).filter((x) => x.id !== s.id && Math.abs(diffDias(x.data, e.data)) <= 3);
        if (!outrasE.length && !outrasS.length) sc = 2;
      }
      if (dd < 0 && sc < 4) continue; // entrada antes da saída só com CNPJ/nome batendo
      if (sc >= 2) combos.push({ s, e, sc, dd: Math.abs(dd) });
    }
  }
  combos.sort((a, b) => b.sc - a.sc || a.dd - b.dd || (a.s.data < b.s.data ? -1 : a.s.data > b.s.data ? 1 : 0));
  const usados = new Set();
  const pares = [];
  for (const { s, e: melhorE, sc } of combos) {
    if (usados.has(s.id) || usados.has(melhorE.id)) continue;
    const melhor = { e: melhorE, sc };
    usados.add(s.id);
    usados.add(melhor.e.id);
    pares.push({
      data: s.data,
      data_entrada: melhor.e.data,
      valor: round2(Math.abs(Number(s.valor))),
      origem_conta_id: s.conta_id,
      destino_conta_id: melhor.e.conta_id,
      origem_lancamento_id: s.id,
      destino_lancamento_id: melhor.e.id,
      metodo: 'auto',
      confianca: melhor.sc >= 3 ? 'alta' : 'media',
    });
  }

  let criadas = 0;
  for (let i = 0; i < pares.length; i += 200) {
    const { data, error } = await supabase.from(T.transf).insert(pares.slice(i, i + 200)).select('id,origem_lancamento_id,destino_lancamento_id');
    lancar(error);
    for (const t of data || []) {
      const [u1, u2] = await Promise.all([
        supabase.from(T.lanc).update({ tipo: 'TRANSFERENCIA', transferencia_id: t.id }).eq('id', t.origem_lancamento_id),
        supabase.from(T.lanc).update({ tipo: 'TRANSFERENCIA', transferencia_id: t.id }).eq('id', t.destino_lancamento_id),
      ]);
      lancar(u1.error);
      lancar(u2.error);
      criadas += 1;
    }
  }
  return { periodo: { de, ate }, desfeitas: antigos.length, criadas };
}

// ─── lançamentos (ajustes manuais) ─────────────────────────────
export async function atualizarLancamento(id, patch) {
  const permitido = {};
  for (const k of ['fornecedor', 'observacao', 'forma', 'categoria']) {
    if (patch[k] !== undefined) permitido[k] = patch[k] === '' ? null : patch[k];
  }
  if (patch.tipo && ['ENTRADA', 'SAIDA', 'TRANSFERENCIA'].includes(patch.tipo)) permitido.tipo = patch.tipo;
  if (!Object.keys(permitido).length) throw new Error('Nada para atualizar.');
  const { data, error } = await supabase.from(T.lanc).update(permitido).eq('id', id).select().single();
  lancar(error);
  return data;
}

// ─── painel ────────────────────────────────────────────────────
const chaveNome = (l) =>
  (l.contraparte_doc && l.contraparte_doc.length >= 11 ? `DOC ${l.contraparte_doc}` : '') || normNome(l.fornecedor || l.contraparte_nome || '') || normNome(l.descricao || '');

function somar(mapa, chave, criar, aplicar) {
  if (!mapa.has(chave)) mapa.set(chave, criar());
  aplicar(mapa.get(chave));
}

/**
 * @param f { de, ate, contas?: number[], bancos?: string[], tipo?: 'ENTRADA'|'SAIDA'|'TRANSFERENCIA',
 *            formas?: string[], categoria?: string, contraparte?: string, busca?: string }
 */
export async function painel(f) {
  if (!f.de || !f.ate) throw new Error('Informe o período (de/ate).');
  const contas = await listarContas(f.escopo);
  const porConta = new Map(contas.map((c) => [c.id, c]));
  const idsEscopo = contas.map((c) => c.id);

  // sempre restringe às contas do escopo (sem contas → nada)
  let contaIds = f.contas?.length ? f.contas.map(Number).filter((id) => idsEscopo.includes(id)) : [...idsEscopo];
  if (!contaIds.length) contaIds = [-1];
  if (f.bancos?.length) {
    const set = new Set(f.bancos.map((b) => String(b).toUpperCase()));
    const ids = contas.filter((c) => set.has(c.banco)).map((c) => c.id);
    contaIds = contaIds ? contaIds.filter((id) => ids.includes(id)) : ids;
    if (!contaIds.length) contaIds = [-1];
  }

  const brutos = await buscarTodos(() => {
    let q = supabase.from(T.lanc).select('*').gte('data', f.de).lte('data', f.ate).order('data').order('conta_id').order('seq');
    if (contaIds) q = q.in('conta_id', contaIds);
    return q;
  });

  const raizesGrupo = new Set(contas.map((c) => (c.titular_cnpj || '').slice(0, 8)).filter((r) => r.length === 8));
  const docsGrupo = new Set(contas.map((c) => c.titular_cnpj).filter(Boolean));

  const transfRows = await buscarTodos(() => supabase.from(T.transf).select('*').in('origem_conta_id', idsEscopo.length ? idsEscopo : [-1]).gte('data', addDias(f.de, -1)).lte('data', f.ate).order('data'));
  const transfPorId = new Map(transfRows.map((t) => [t.id, t]));

  // enriquece com a conta e a "outra ponta" da transferência
  const todos = brutos.map((l) => {
    const c = porConta.get(l.conta_id);
    const t = l.transferencia_id ? transfPorId.get(l.transferencia_id) : null;
    const outraContaId = t ? (t.origem_lancamento_id === l.id ? t.destino_conta_id : t.origem_conta_id) : null;
    const outra = outraContaId ? porConta.get(outraContaId) : null;
    return {
      ...l,
      valor: Number(l.valor),
      saldo_apos: l.saldo_apos == null ? null : Number(l.saldo_apos),
      banco: c?.banco || null,
      banco_nome: c?.banco_nome || null,
      conta_apelido: c?.apelido || null,
      conta_titular: c?.titular_nome || null,
      conta_cnpj: c?.titular_cnpj || null,
      transferencia: t ? { id: t.id, confianca: t.confianca, metodo: t.metodo, sentido: t.origem_lancamento_id === l.id ? 'SAIDA' : 'ENTRADA', outraConta: outra ? { id: outra.id, apelido: outra.apelido, banco: outra.banco, titular: outra.titular_nome } : null } : null,
      nomeExibicao: l.fornecedor || l.contraparte_nome || null,
      contraparteGrupo: !!(l.contraparte_doc && (docsGrupo.has(l.contraparte_doc) || raizesGrupo.has(l.contraparte_doc.slice(0, 8)))),
    };
  });

  // conciliação: justificativas gravadas + transferências casadas (derivadas)
  await anexarConciliacoes(todos, { de: f.de, ate: f.ate });
  await anexarComprovantes(todos);

  // filtros em memória (volume mensal é pequeno)
  const formas = f.formas?.length ? new Set(f.formas) : null;
  const buscaTxt = semAcento(f.busca || '').toUpperCase().trim();
  const buscaDig = soDigitos(f.busca || '');
  const contraparteN = f.contraparte ? normNome(f.contraparte) : null;
  const contraparteDoc = f.contraparte && /^\d{11,14}$/.test(soDigitos(f.contraparte)) && soDigitos(f.contraparte).length === String(f.contraparte).trim().length ? soDigitos(f.contraparte) : null;
  const lancamentos = todos.filter((l) => {
    if (f.tipo && l.tipo !== f.tipo) return false;
    if (f.tipos?.length && !f.tipos.includes(l.tipo)) return false;
    if (formas && !formas.has(l.forma)) return false;
    if (f.categoria && l.categoria !== f.categoria) return false;
    if (f.pendencia === 'pendentes' && !l.pendente) return false;
    if (f.pendencia === 'conciliadas' && l.pendente) return false;
    if (contraparteDoc) {
      if (l.contraparte_doc !== contraparteDoc) return false;
    } else if (contraparteN && chaveNome(l) !== contraparteN && normNome(l.nomeExibicao || '') !== contraparteN) return false;
    if (buscaTxt) {
      const alvo = semAcento([l.descricao, l.memo, l.contraparte_nome, l.fornecedor, l.documento, l.contraparte_banco, l.conta_apelido, l.conta_titular, l.loja].filter(Boolean).join(' | ')).toUpperCase();
      const porTexto = alvo.includes(buscaTxt);
      const porDoc = buscaDig.length >= 3 && ((l.contraparte_doc || '').includes(buscaDig) || (l.conta_cnpj || '').includes(buscaDig) || (l.loja || '').replace(/\D/g, '').includes(buscaDig) || (l.documento || '').includes(buscaDig));
      const porValor = /^\d+([.,]\d{1,2})?$/.test(f.busca.trim()) && Math.abs(l.valor) === Number(f.busca.trim().replace(',', '.'));
      if (!porTexto && !porDoc && !porValor) return false;
    }
    return true;
  });

  // ── agregados ──
  const resumo = { entradas: 0, saidas: 0, transfEntradas: 0, transfSaidas: 0, qtdEntradas: 0, qtdSaidas: 0, qtdTransf: 0, qtd: lancamentos.length, pendencias: lancamentos.filter((l) => l.pendente).length, conciliadas: lancamentos.filter((l) => !l.pendente).length };
  const porFormaM = new Map();
  const porContaM = new Map();
  const porDiaM = new Map();
  const fornecedoresM = new Map();
  const pagadoresM = new Map();
  const porBancoM = new Map();

  for (const l of lancamentos) {
    const ent = l.valor > 0;
    const v = Math.abs(l.valor);
    const transf = l.tipo === 'TRANSFERENCIA';
    if (transf) {
      if (ent) resumo.transfEntradas += v;
      else resumo.transfSaidas += v;
      resumo.qtdTransf += 1;
    } else if (ent) {
      resumo.entradas += v;
      resumo.qtdEntradas += 1;
    } else {
      resumo.saidas += v;
      resumo.qtdSaidas += 1;
    }

    somar(porContaM, l.conta_id, () => ({ contaId: l.conta_id, conta: l.conta_apelido, banco: l.banco, titular: l.conta_titular, cnpj: l.conta_cnpj, entradas: 0, saidas: 0, transfEntradas: 0, transfSaidas: 0, qtd: 0, saldoInicial: null, saldoFinal: null, ultimaData: null, pendencias: 0, pendEntradas: 0, pendSaidas: 0, conciliadas: 0 }), (a) => {
      a.qtd += 1;
      if (l.pendente) {
        a.pendencias += 1;
        if (ent) a.pendEntradas += 1;
        else a.pendSaidas += 1;
      } else a.conciliadas += 1;
      if (transf) ent ? (a.transfEntradas += v) : (a.transfSaidas += v);
      else ent ? (a.entradas += v) : (a.saidas += v);
      if (l.saldo_apos != null) {
        a.saldoFinal = l.saldo_apos;
        a.ultimaData = l.data;
      }
    });
    somar(porBancoM, l.banco, () => ({ banco: l.banco, bancoNome: l.banco_nome, entradas: 0, saidas: 0, transfEntradas: 0, transfSaidas: 0, qtd: 0 }), (a) => {
      a.qtd += 1;
      if (transf) ent ? (a.transfEntradas += v) : (a.transfSaidas += v);
      else ent ? (a.entradas += v) : (a.saidas += v);
    });
    somar(porDiaM, l.data, () => ({ data: l.data, entradas: 0, saidas: 0, transf: 0, qtd: 0 }), (a) => {
      a.qtd += 1;
      if (transf) a.transf += ent ? v : 0;
      else ent ? (a.entradas += v) : (a.saidas += v);
    });
    if (!transf) {
      somar(porFormaM, l.forma, () => ({ forma: l.forma, entradas: 0, saidas: 0, qtdEntradas: 0, qtdSaidas: 0, porBanco: {} }), (a) => {
        if (ent) {
          a.entradas += v;
          a.qtdEntradas += 1;
        } else {
          a.saidas += v;
          a.qtdSaidas += 1;
        }
        const b = (a.porBanco[l.banco] ||= { entradas: 0, saidas: 0, qtd: 0 });
        b.qtd += 1;
        ent ? (b.entradas += v) : (b.saidas += v);
      });
      const nomeKey = chaveNome(l);
      const alvo = ent ? pagadoresM : fornecedoresM;
      somar(alvo, nomeKey || '(SEM IDENTIFICAÇÃO)', () => ({ chave: nomeKey, nome: l.nomeExibicao || l.descricao || '(sem identificação)', doc: l.contraparte_doc || null, grupo: l.contraparteGrupo, qtd: 0, total: 0, formas: {}, bancos: {}, primeiraData: l.data, ultimaData: l.data }), (a) => {
        a.qtd += 1;
        if (l.nomeExibicao && l.nomeExibicao.length > a.nome.length) a.nome = l.nomeExibicao;
        a.total += v;
        a.formas[l.forma] = round2((a.formas[l.forma] || 0) + v);
        a.bancos[l.conta_apelido] = round2((a.bancos[l.conta_apelido] || 0) + v);
        if (l.data < a.primeiraData) a.primeiraData = l.data;
        if (l.data > a.ultimaData) a.ultimaData = l.data;
        if (!a.doc && l.contraparte_doc) a.doc = l.contraparte_doc;
      });
    }
  }

  // saldo inicial/final por conta a partir das importações que cobrem o período
  const imps = await buscarTodos(() => supabase.from(T.imp).select('conta_id,periodo_inicio,periodo_fim,saldo_inicial,saldo_final,importado_em').lte('periodo_inicio', f.ate).gte('periodo_fim', f.de).order('importado_em', { ascending: false }));
  for (const a of porContaM.values()) {
    const cobre = imps.filter((i) => i.conta_id === a.contaId).sort((x, y) => (x.periodo_inicio < y.periodo_inicio ? -1 : 1));
    if (cobre.length) {
      a.saldoInicial = cobre[0].saldo_inicial == null ? null : Number(cobre[0].saldo_inicial);
      if (a.saldoFinal == null) a.saldoFinal = cobre.at(-1).saldo_final == null ? null : Number(cobre.at(-1).saldo_final);
    }
  }

  const arr = (m) => [...m.values()];
  const fix = (o) => {
    for (const k of Object.keys(o)) {
      if (typeof o[k] === 'number') o[k] = round2(o[k]);
      else if (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) for (const v of Object.values(o[k])) if (v && typeof v === 'object') fix(v);
    }
    return o;
  };
  for (const k of Object.keys(resumo)) resumo[k] = round2(resumo[k]);
  resumo.resultado = round2(resumo.entradas - resumo.saidas);

  // transferências do período (com as duas pontas)
  const lancPorId = new Map(todos.map((l) => [l.id, l]));
  const idsFaltando = [];
  for (const t of transfRows) {
    if (!lancPorId.has(t.origem_lancamento_id)) idsFaltando.push(t.origem_lancamento_id);
    if (!lancPorId.has(t.destino_lancamento_id)) idsFaltando.push(t.destino_lancamento_id);
  }
  if (idsFaltando.length) {
    const extra = await buscarTodos(() => supabase.from(T.lanc).select('*').in('id', idsFaltando.slice(0, 1000)));
    for (const l of extra) lancPorId.set(l.id, { ...l, valor: Number(l.valor), conta_apelido: porConta.get(l.conta_id)?.apelido || null, banco: porConta.get(l.conta_id)?.banco || null });
  }
  const transferencias = transfRows
    .filter((t) => t.data >= f.de || (t.data_entrada && t.data_entrada >= f.de))
    .map((t) => {
      const o = lancPorId.get(t.origem_lancamento_id);
      const d = lancPorId.get(t.destino_lancamento_id);
      const co = porConta.get(t.origem_conta_id);
      const cd = porConta.get(t.destino_conta_id);
      return {
        id: t.id,
        data: t.data,
        dataEntrada: t.data_entrada,
        valor: Number(t.valor),
        confianca: t.confianca,
        metodo: t.metodo,
        origem: { contaId: t.origem_conta_id, conta: co?.apelido, banco: co?.banco, titular: co?.titular_nome, lancamentoId: t.origem_lancamento_id, descricao: o?.descricao, contraparte: o?.contraparte_nome, forma: o?.forma },
        destino: { contaId: t.destino_conta_id, conta: cd?.apelido, banco: cd?.banco, titular: cd?.titular_nome, lancamentoId: t.destino_lancamento_id, descricao: d?.descricao, contraparte: d?.contraparte_nome, forma: d?.forma },
      };
    })
    .filter((t) => contaIds.includes(t.origem.contaId) || contaIds.includes(t.destino.contaId));

  const opcoesFormas = [...new Set(todos.map((l) => l.forma))].sort();
  const opcoesContrapartes = [...new Map(todos.filter((l) => l.nomeExibicao).map((l) => [chaveNome(l), { chave: chaveNome(l), nome: l.nomeExibicao, doc: l.contraparte_doc || null }])).values()].sort((a, b) => a.nome.localeCompare(b.nome));

  return {
    periodo: { de: f.de, ate: f.ate },
    filtros: f,
    contas,
    lancamentos,
    resumo,
    porForma: arr(porFormaM).map(fix).sort((a, b) => b.entradas + b.saidas - (a.entradas + a.saidas)),
    porBanco: arr(porBancoM).map(fix),
    porConta: arr(porContaM).map(fix).sort((a, b) => (a.banco + a.conta).localeCompare(b.banco + b.conta)),
    porDia: arr(porDiaM).map(fix).sort((a, b) => (a.data < b.data ? -1 : 1)),
    fornecedores: arr(fornecedoresM).map(fix).sort((a, b) => b.total - a.total),
    pagadores: arr(pagadoresM).map(fix).sort((a, b) => b.total - a.total),
    transferencias,
    opcoes: { formas: opcoesFormas, contrapartes: opcoesContrapartes.slice(0, 500), todasFormas: Object.values(FORMAS) },
  };
}

export default {
  ESCOPOS,
  ESCOPO_PADRAO,
  normEscopo,
  listarContas,
  atualizarConta,
  lerExtrato,
  importarExtrato,
  importarExtratoObjeto,
  importarVarios,
  listarImportacoes,
  excluirImportacao,
  guardarArquivoExtrato,
  urlArquivoImportacao,
  casarTransferencias,
  atualizarLancamento,
  painel,
  MigrationPendingError,
};
