// ============================================================================
// HEADCOACH › CONTAS A PAGAR (Yago, 18/11/2026) — duplicatas próprias, sem o
// TOTVS, no molde do HEADCOACH › CONTAS A RECEBER. Tabelas: migrations/hc_contas_pagar.sql.
//
// Numeração: a DUPLICATA é um número por empresa + fornecedor (1, 2, 3…) e cada
// lançamento é uma PARCELA dela — "1/11" e "1/12" são a duplicata 1, parcelas 11
// e 12. Conta que vem todo mês (energia, aluguel) fica na mesma duplicata, com o
// mês do vencimento como parcela. O DOCUMENTO FISCAL é o número da nota/fatura
// do fornecedor e muda a cada parcela.
// A duplicata tem o que o contas a pagar do TOTVS tem: empresa, fornecedor,
// documento fiscal, parcela, portador, forma de pagamento, despesa, centro de custo,
// emissão, entrada, vencimento, valor e observação.
//   • rateio no modelo das Solicitações de RH: linhas de despesa + centro de custo
//     (de empresa ou de setor) com o percentual; a soma fecha 100%;
//   • inclusão manual pela tela (uma ou várias parcelas) ou por rotina (ex.: as
//     faturas que o bot da Cosern captura — origem "bot-cosern-whatsapp");
//   • em aberto dá para editar; a baixa pede a senha e registra juros, multa e
//     desconto; sem estorno; duplicata em aberto pode ser cancelada com motivo.
// Só owner, admin e financeiro (role user) entram neste módulo.
// Cadastros vêm das cópias locais (erp_pessoas, erp_portadores, erp_centros_custo)
// e de hc_cp_despesas — nunca do TOTVS ao vivo.
// ============================================================================
import crypto from 'node:crypto';
import supabase from '../config/supabase.js';
import { verificarSenhaAutorizador, AutorizacaoError } from './autorizacaoSenha.js';
import { empresasDoUsuario } from './hcCaixa.js';

export class CpError extends Error {
  constructor(message, code = 'HC_CP', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const PERFIS_FINANCEIRO = ['owner', 'admin', 'user']; // user = financeiro
const BUCKET_ANEXOS = 'extratos-bancarios';

export const FORMAS = {
  pix: 'Pix',
  boleto: 'Boleto',
  transferencia: 'Transferência',
  debito_automatico: 'Débito automático',
  cartao: 'Cartão de crédito',
  dinheiro: 'Dinheiro',
  outro: 'Outro',
};
export const TIPOS_DOCUMENTO = { duplicata: 'Duplicata', nota_fiscal: 'Nota fiscal', boleto: 'Boleto', recibo: 'Recibo', outro: 'Outro' };

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const hojeBrasil = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Recife' }).format(new Date());
const ehData = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(new Date(`${s}T12:00:00Z`).getTime());
const diasEntre = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000);
const num = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};
const texto = (v, max = 500) => String(v ?? '').trim().slice(0, max) || null;
const quem = (user) => user?.name || user?.email || null;

function falhaDb(error) {
  const msg = String(error?.message || '');
  if (/relation .* does not exist|could not find the table|schema cache|column .* does not exist/i.test(msg)) {
    return new CpError('O contas a pagar ainda não está liberado: faltam as tabelas no banco. Rode "node scripts/migrar-hc-contas-pagar.mjs" na pasta da API.', 'MIGRATION_PENDING', 503);
  }
  // número da duplicata pego por outra inclusão no mesmo instante: quem chama tenta de novo
  if (/hc_cp_titulos_duplicata_key/i.test(msg)) return new CpError('Esta duplicata já tem uma parcela com este número', 'NUMERO_EM_USO', 409);
  if (/duplicate key/i.test(msg)) {
    return new CpError('Já existe uma duplicata com esta empresa, fornecedor, documento fiscal e parcela', 'DUPLICADA', 409);
  }
  return new CpError(msg || 'Erro no banco', 'DB_ERROR', 500);
}
async function q(promessa) {
  const { data, error } = await promessa;
  if (error) throw falhaDb(error);
  return data;
}
// busca tudo (o Supabase devolve no máximo 1000 por vez)
async function todas(montar) {
  const out = [];
  for (let de = 0; ; de += 1000) {
    const lote = await q(montar().range(de, de + 999));
    out.push(...(lote || []));
    if (!lote || lote.length < 1000) break;
  }
  return out;
}
async function conferirSenha(email, senha) {
  try {
    return await verificarSenhaAutorizador(email, senha, PERFIS_FINANCEIRO);
  } catch (e) {
    if (e instanceof AutorizacaoError) throw new CpError(e.message, e.code, e.status);
    throw e;
  }
}
function exigirFinanceiro(user) {
  if (!PERFIS_FINANCEIRO.includes(user?.role)) throw new CpError('O contas a pagar é só para owner, admin e financeiro', 'SEM_PERMISSAO', 403);
}
async function empresasPermitidas(user, empresa) {
  exigirFinanceiro(user);
  const lista = await empresasDoUsuario(user);
  if (empresa) {
    const n = Number(empresa);
    if (!lista.some((e) => e.code === n)) throw new CpError(`Você não tem acesso à empresa ${n}`, 'SEM_ACESSO_EMPRESA', 403);
    return { lista, codes: [n] };
  }
  return { lista, codes: lista.map((e) => e.code) };
}

// ─── cadastros ───────────────────────────────────────────────────────────────
export async function opcoes(user) {
  const { lista } = await empresasPermitidas(user);
  const [despesas, portadores, centros] = await Promise.all([
    todas(() => supabase.from('hc_cp_despesas').select('code, nome').eq('ativo', true).order('nome')),
    todas(() => supabase.from('erp_portadores').select('code, descricao').order('descricao')),
    todas(() => supabase.from('hc_cp_centros_custo').select('code, nome, tipo').eq('ativo', true).order('nome')),
  ]);
  return {
    empresas: lista,
    formas: FORMAS,
    tiposDocumento: TIPOS_DOCUMENTO,
    despesas,
    portadores: portadores.map((p) => ({ code: p.code, nome: p.descricao })),
    centrosCusto: centros,
  };
}

/** Fornecedores da cópia local (erp_pessoas): por código, CPF/CNPJ ou nome. */
export async function buscarFornecedores(user, termo) {
  exigirFinanceiro(user);
  const t = String(termo || '').trim();
  if (t.length < 2) return [];
  const dig = t.replace(/\D/g, '');
  let qy = supabase.from('erp_pessoas').select('code, nome, fantasia, cpf_cnpj').eq('is_fornecedor', true);
  if (/^\d+$/.test(t) && dig.length <= 9) qy = qy.eq('code', Number(dig));
  else if (dig.length >= 11 && dig.length === t.replace(/[\s.\-/]/g, '').length) qy = qy.eq('cpf_cnpj', dig);
  else qy = qy.or(`nome.ilike.%${t.replace(/[%_,()]/g, ' ')}%,fantasia.ilike.%${t.replace(/[%_,()]/g, ' ')}%`);
  return q(qy.order('nome').limit(30));
}

// ─── rateio (sem banco) ──────────────────────────────────────────────────────
/**
 * Confere as linhas do rateio: despesa e centro de custo em cada uma, percentual
 * maior que zero, sem linha repetida e soma de 100%.
 * @param linhas [{ despesaCode, centroCustoCode, percentual }]
 * @param exigirCentro false só para inclusão antiga/rotina que ainda não sabe o centro
 * @returns [{ despesa_code, centro_custo_code, percentual }]
 */
export function normalizarRateio(linhas, { exigirCentro = true } = {}) {
  if (!Array.isArray(linhas) || !linhas.length) throw new CpError('Informe a despesa e o centro de custo');
  if (linhas.length > 40) throw new CpError('No máximo 40 linhas de rateio');
  const vistas = new Set();
  const out = linhas.map((l, i) => {
    const despesa = Number(l.despesaCode ?? l.despesa_code);
    if (!(despesa > 0)) throw new CpError(linhas.length > 1 ? `Escolha a despesa da linha ${i + 1} do rateio` : 'Escolha a despesa');
    const centroBruto = l.centroCustoCode ?? l.centro_custo_code;
    const centro = centroBruto ? Number(centroBruto) : null;
    if (exigirCentro && !(centro > 0)) throw new CpError(linhas.length > 1 ? `Escolha o centro de custo da linha ${i + 1} do rateio` : 'Escolha o centro de custo');
    const pct = Math.round(num(l.percentual) * 10000) / 10000;
    if (!Number.isFinite(pct) || pct <= 0) throw new CpError(`Informe o percentual da linha ${i + 1} do rateio`);
    const chave = `${despesa}|${centro}`;
    if (vistas.has(chave)) throw new CpError(`A linha ${i + 1} do rateio repete despesa e centro de custo de outra linha`);
    vistas.add(chave);
    return { despesa_code: despesa, centro_custo_code: centro, percentual: pct };
  });
  const soma = out.reduce((s, l) => s + l.percentual, 0);
  if (Math.abs(soma - 100) > 0.01) throw new CpError(`O rateio soma ${soma.toFixed(2).replace('.', ',')}%; precisa fechar 100%`);
  return out;
}

/** Valor de cada linha para uma parcela; a última linha leva a diferença de centavos. */
export function ratear(linhas, valorParcela) {
  let resto = round2(valorParcela);
  return linhas.map((l, i) => {
    const valor = i === linhas.length - 1 ? resto : round2((valorParcela * l.percentual) / 100);
    resto = round2(resto - valor);
    return { ...l, valor };
  });
}

/** Linha principal (maior percentual): vai nas colunas despesa/centro de custo da duplicata. */
const principal = (linhas) => linhas.reduce((m, l) => (l.percentual > m.percentual ? l : m), linhas[0]);

// ─── validação (sem banco) ───────────────────────────────────────────────────
/**
 * Confere os dados de uma inclusão e devolve as parcelas prontas (sem os nomes
 * de fornecedor/portador/despesa, que vêm do banco).
 * b: { empresa, fornecedorCode, documentoFiscal, tipoDocumento, portadorCode, formaPagamento, chavePix, codigoBarras,
 *      rateio: [{ despesaCode, centroCustoCode, percentual }] (ou despesaCode/centroCustoCode soltos = 100% numa linha),
 *      previsao, emissao, entrada, referencia, observacao,
 *      duplicata (opcional: número de uma duplicata que já existe, para lançar mais parcelas nela; vazio = duplicata nova),
 *      parcelas: [{ parcela, vencimento, valor }] } — ou parcela/vencimento/valor soltos para uma só.
 */
export function validarInclusao(b = {}, hoje = hojeBrasil()) {
  const empresa = Number(b.empresa);
  if (!(empresa > 0)) throw new CpError('Escolha a empresa');
  const fornecedorCode = Number(b.fornecedorCode);
  if (!(fornecedorCode > 0)) throw new CpError('Escolha o fornecedor');
  const documentoFiscal = String(b.documentoFiscal ?? '').trim();
  const semDuplicata = b.duplicata === undefined || b.duplicata === null || String(b.duplicata).trim() === '';
  const duplicata = semDuplicata ? null : Number(b.duplicata);
  if (!semDuplicata && !(Number.isInteger(duplicata) && duplicata >= 1)) throw new CpError('Número da duplicata inválido');
  if (documentoFiscal.length > 40) throw new CpError('O documento fiscal tem no máximo 40 caracteres');
  const tipoDocumento = b.tipoDocumento ? String(b.tipoDocumento) : 'duplicata';
  if (!TIPOS_DOCUMENTO[tipoDocumento]) throw new CpError('Tipo de documento inválido');
  const formaPagamento = b.formaPagamento ? String(b.formaPagamento) : null;
  if (formaPagamento && !FORMAS[formaPagamento]) throw new CpError('Forma de pagamento inválida');
  const previsao = b.previsao === 'previsao' ? 'previsao' : 'real';
  if (!ehData(b.emissao)) throw new CpError('Informe a data de emissão');
  const entrada = ehData(b.entrada) ? b.entrada : hoje;
  if (b.emissao > hoje && previsao === 'real') throw new CpError('A emissão não pode ser no futuro (use Previsão para conta que ainda não chegou)');
  const temRateio = Array.isArray(b.rateio) && b.rateio.length > 0;
  const rateio = normalizarRateio(temRateio ? b.rateio : [{ despesaCode: b.despesaCode, centroCustoCode: b.centroCustoCode, percentual: 100 }], { exigirCentro: temRateio });

  const brutas = Array.isArray(b.parcelas) && b.parcelas.length ? b.parcelas : [{ parcela: b.parcela || 1, vencimento: b.vencimento, valor: b.valor }];
  if (brutas.length > 60) throw new CpError('No máximo 60 parcelas por inclusão');
  const vistas = new Set();
  const parcelas = brutas.map((p, i) => {
    const parcela = Number(p.parcela || i + 1);
    if (!Number.isInteger(parcela) || parcela < 1) throw new CpError(`Parcela inválida na linha ${i + 1}`);
    if (vistas.has(parcela)) throw new CpError(`A parcela ${parcela} está repetida`);
    vistas.add(parcela);
    if (!ehData(p.vencimento)) throw new CpError(`Informe o vencimento da parcela ${parcela}`);
    if (p.vencimento < b.emissao) throw new CpError(`O vencimento da parcela ${parcela} é anterior à emissão`);
    const valor = round2(num(p.valor));
    if (!Number.isFinite(valor) || valor <= 0) throw new CpError(`Informe o valor da parcela ${parcela}`);
    return { parcela, vencimento: p.vencimento, valor };
  });

  return {
    comum: {
      empresa,
      fornecedor_code: fornecedorCode,
      documento_fiscal: documentoFiscal || null,
      tipo_documento: tipoDocumento,
      portador_code: b.portadorCode ? Number(b.portadorCode) : null,
      forma_pagamento: formaPagamento,
      chave_pix: texto(b.chavePix, 600),
      codigo_barras: texto(b.codigoBarras, 120),
      despesa_code: principal(rateio).despesa_code,
      centro_custo_code: principal(rateio).centro_custo_code,
      previsao,
      emissao: b.emissao,
      entrada,
      referencia: texto(b.referencia, 20),
      observacao: texto(b.observacao, 2000),
    },
    duplicata,
    parcelas,
    rateio,
  };
}

/** "1/11": duplicata 1, parcela 11. */
export const rotuloDuplicata = (t) => `${t.duplicata}/${t.parcela}`;

/** Parcela de conta que vem todo mês: o mês do vencimento (11 para 06/11/2026). */
export const parcelaDoMes = (vencimento) => Number(String(vencimento).slice(5, 7));

/**
 * Conta que vem todo mês: em qual duplicata entra a parcela nova.
 * daConta = duplicatas (não canceladas) que já são desta conta: [{ duplicata, parcela }].
 * Devolve o número da duplicata em uso, ou null para abrir uma nova — quando é a
 * primeira fatura da conta ou quando a duplicata em uso já tem esta parcela
 * (deu a volta no ano: novembro de novo).
 */
export function duplicataDaContaMensal(daConta, parcela) {
  const atual = Math.max(0, ...(daConta || []).map((t) => Number(t.duplicata) || 0));
  if (!atual) return null;
  return daConta.some((t) => Number(t.duplicata) === atual && Number(t.parcela) === Number(parcela)) ? null : atual;
}

/** Dias de atraso e situação de tela (vencido é "aberto" com vencimento passado). */
export function situacaoDeTela(t, hoje = hojeBrasil()) {
  if (t.situacao !== 'aberto') return { situacao: t.situacao, diasAtraso: 0 };
  const dias = diasEntre(String(t.vencimento).slice(0, 10), hoje);
  return { situacao: dias > 0 ? 'vencido' : 'aberto', diasAtraso: Math.max(0, dias) };
}

// ─── inclusão ────────────────────────────────────────────────────────────────
/** Põe os nomes de despesa e centro de custo nas linhas do rateio (e confere se existem). */
async function nomearRateio(linhas) {
  const despesas = [...new Set(linhas.map((l) => l.despesa_code))];
  const centros = [...new Set(linhas.map((l) => l.centro_custo_code).filter(Boolean))];
  const [ds, cs] = await Promise.all([
    q(supabase.from('hc_cp_despesas').select('code, nome').in('code', despesas)),
    centros.length ? q(supabase.from('hc_cp_centros_custo').select('code, nome').in('code', centros)) : [],
  ]);
  const nomeD = new Map((ds || []).map((d) => [d.code, d.nome]));
  const nomeC = new Map((cs || []).map((c) => [c.code, c.nome]));
  return linhas.map((l) => {
    if (!nomeD.has(l.despesa_code)) throw new CpError(`Despesa ${l.despesa_code} não existe`, 'DESPESA', 404);
    if (l.centro_custo_code && !nomeC.has(l.centro_custo_code)) throw new CpError(`Centro de custo ${l.centro_custo_code} não existe`, 'CENTRO_CUSTO', 404);
    return { despesa_code: l.despesa_code, despesa_nome: nomeD.get(l.despesa_code), centro_custo_code: l.centro_custo_code, centro_custo_nome: l.centro_custo_code ? nomeC.get(l.centro_custo_code) : null, percentual: l.percentual };
  });
}

async function completarCadastros(comum) {
  const [forn, port] = await Promise.all([
    q(supabase.from('erp_pessoas').select('code, nome, cpf_cnpj, is_fornecedor').eq('code', comum.fornecedor_code).maybeSingle()),
    comum.portador_code ? q(supabase.from('erp_portadores').select('code, descricao').eq('code', comum.portador_code).maybeSingle()) : null,
  ]);
  if (!forn) throw new CpError(`Fornecedor ${comum.fornecedor_code} não existe no cadastro`, 'FORNECEDOR', 404);
  if (!forn.is_fornecedor) throw new CpError(`${forn.nome} não está marcado como fornecedor no cadastro`, 'FORNECEDOR');
  if (comum.portador_code && !port) throw new CpError(`Portador ${comum.portador_code} não existe`, 'PORTADOR', 404);
  return { ...comum, fornecedor_nome: forn.nome, fornecedor_cpf_cnpj: forn.cpf_cnpj || null, portador_nome: port?.descricao || null };
}

/**
 * Grava as parcelas já validadas. Usado pela tela (criarTitulos) e pelas rotinas
 * (bots), que passam origem/origemRef/anexoPath e o nome de quem criou.
 */
export async function inserirTitulos(dados, { por, origem = 'manual', origemRef = null, anexoPath = null } = {}) {
  const [comum, rateio] = await Promise.all([completarCadastros(dados.comum), nomearRateio(dados.rateio)]);
  const pri = principal(rateio);
  const lote = crypto.randomUUID();
  const daEmpresa = () => supabase.from('hc_cp_titulos').select('duplicata, parcela').eq('empresa', comum.empresa).eq('fornecedor_code', comum.fornecedor_code);
  for (let tentativa = 1; ; tentativa += 1) {
    let numero = dados.duplicata;
    if (numero) {
      // mais parcelas numa duplicata que já existe
      const nela = await q(daEmpresa().eq('duplicata', numero).neq('situacao', 'cancelado'));
      if (!nela?.length) throw new CpError(`Este fornecedor não tem a duplicata ${numero} nesta empresa`, 'DUPLICATA', 404);
      const repetida = dados.parcelas.find((p) => nela.some((t) => t.parcela === p.parcela));
      if (repetida) throw new CpError(`A duplicata ${numero} deste fornecedor já tem a parcela ${repetida.parcela}`, 'DUPLICADA', 409);
    } else {
      // duplicata nova: o próximo número da empresa com este fornecedor
      const ultima = await q(daEmpresa().order('duplicata', { ascending: false }).limit(1));
      numero = Number(ultima?.[0]?.duplicata || 0) + 1;
    }
    const linhas = dados.parcelas.map((p) => ({ ...comum, despesa_nome: pri.despesa_nome, centro_custo_nome: pri.centro_custo_nome, ...p, duplicata: numero, lote, rateio: ratear(rateio, p.valor), origem, origem_ref: origemRef, anexo_path: anexoPath, criado_por: por || null, atualizado_por: por || null }));
    try {
      return await q(supabase.from('hc_cp_titulos').insert(linhas).select());
    } catch (e) {
      // duplicata nova: outra inclusão pegou o mesmo número no mesmo instante → tenta o seguinte
      if (e.code !== 'NUMERO_EM_USO' || dados.duplicata || tentativa >= 4) throw e;
    }
  }
}

/** Duplicatas que o fornecedor já tem na empresa, com as parcelas — para lançar mais uma parcela. */
export async function duplicatasDoFornecedor(user, f = {}) {
  const empresa = Number(f.empresa);
  const fornecedor = Number(f.fornecedor);
  if (!(empresa > 0) || !(fornecedor > 0)) return { duplicatas: [] };
  await empresasPermitidas(user, empresa);
  const rows = await q(supabase.from('hc_cp_titulos').select('duplicata, parcela, vencimento, situacao, despesa_nome').eq('empresa', empresa).eq('fornecedor_code', fornecedor).neq('situacao', 'cancelado').order('duplicata').order('vencimento'));
  const por = new Map();
  for (const r of rows || []) {
    if (!por.has(r.duplicata)) por.set(r.duplicata, { duplicata: r.duplicata, despesa: r.despesa_nome, parcelas: [], ultimoVencimento: r.vencimento });
    const d = por.get(r.duplicata);
    d.parcelas.push(r.parcela);
    d.ultimoVencimento = r.vencimento;
  }
  return { duplicatas: [...por.values()] };
}

export async function criarTitulos(user, b = {}) {
  const dados = validarInclusao(b);
  await empresasPermitidas(user, dados.comum.empresa);
  const criados = await inserirTitulos(dados, { por: quem(user) });
  console.log(`🧾 [contas a pagar] ${criados.length} duplicata(s) ${criados.map(rotuloDuplicata).join(', ')} · ${criados[0]?.fornecedor_nome} · empresa ${dados.comum.empresa} · ${quem(user)}`);
  return { titulos: criados };
}

// ─── consulta ────────────────────────────────────────────────────────────────
const CAMPOS_DATA = { emissao: 'emissao', entrada: 'entrada', vencimento: 'vencimento', pagamento: 'data_pagamento' };

export async function listarTitulos(user, f = {}) {
  const { lista, codes } = await empresasPermitidas(user, f.empresa);
  if (!codes.length) return { titulos: [], totais: {}, empresas: lista };
  const campo = CAMPOS_DATA[f.campoData] || 'vencimento';
  const hoje = hojeBrasil();
  const busca = String(f.fornecedor || '').trim();
  const rows = await todas(() => {
    let qy = supabase.from('hc_cp_titulos').select('*').in('empresa', codes);
    if (ehData(f.de)) qy = qy.gte(campo, f.de);
    if (ehData(f.ate)) qy = qy.lte(campo, f.ate);
    if (f.situacao === 'vencido') qy = qy.eq('situacao', 'aberto').lt('vencimento', hoje);
    else if (f.situacao === 'a_vencer') qy = qy.eq('situacao', 'aberto').gte('vencimento', hoje);
    else if (['aberto', 'pago', 'cancelado'].includes(f.situacao)) qy = qy.eq('situacao', f.situacao);
    if (f.forma && FORMAS[f.forma]) qy = qy.eq('forma_pagamento', f.forma);
    if (f.portador) qy = qy.eq('portador_code', Number(f.portador));
    if (f.despesa) qy = qy.contains('rateio', JSON.stringify([{ despesa_code: Number(f.despesa) }])); // jsonb: o filtro vai como texto JSON
    if (f.centroCusto) qy = qy.contains('rateio', JSON.stringify([{ centro_custo_code: Number(f.centroCusto) }]));
    if (['real', 'previsao'].includes(f.previsao)) qy = qy.eq('previsao', f.previsao);
    const doc = String(f.documentoFiscal || '').trim();
    if (doc) qy = qy.eq('documento_fiscal', doc);
    const [dup, parc] = String(f.duplicata || '').split('/').map((s) => s.replace(/\D/g, '')); // "1" = a duplicata inteira; "1/12" = só a parcela 12
    if (dup) qy = qy.eq('duplicata', Number(dup));
    if (parc) qy = qy.eq('parcela', Number(parc));
    if (busca) {
      const dig = busca.replace(/\D/g, '');
      if (/^\d+$/.test(busca) && dig.length <= 9) qy = qy.eq('fornecedor_code', Number(dig));
      else if (dig.length >= 11 && dig.length === busca.replace(/[\s.\-/]/g, '').length) qy = qy.eq('fornecedor_cpf_cnpj', dig);
      else qy = qy.ilike('fornecedor_nome', `%${busca.replace(/[%_,()]/g, ' ')}%`);
    }
    return qy.order(campo, { ascending: true }).order('fornecedor_nome').order('duplicata').order('parcela');
  });
  const totais = { qtd: 0, valor: 0, aberto: 0, vencido: 0, venceHoje: 0, pago: 0, valorPago: 0, encargos: 0, desconto: 0, cancelado: 0 };
  const titulos = rows.map((t) => {
    const tela = situacaoDeTela(t, hoje);
    const v = round2(t.valor);
    totais.qtd += 1;
    if (t.situacao === 'cancelado') totais.cancelado = round2(totais.cancelado + v);
    else {
      totais.valor = round2(totais.valor + v);
      if (t.situacao === 'aberto') {
        totais.aberto = round2(totais.aberto + v);
        if (tela.diasAtraso > 0) totais.vencido = round2(totais.vencido + v);
        if (String(t.vencimento).slice(0, 10) === hoje) totais.venceHoje = round2(totais.venceHoje + v);
      } else {
        totais.pago = round2(totais.pago + v);
        totais.valorPago = round2(totais.valorPago + Number(t.valor_pago || 0));
        totais.encargos = round2(totais.encargos + Number(t.juros || 0) + Number(t.multa || 0));
        totais.desconto = round2(totais.desconto + Number(t.desconto || 0));
      }
    }
    return { ...t, tela };
  });
  return { titulos, totais, empresas: lista, hoje };
}

async function tituloDoUsuario(user, id) {
  const t = await q(supabase.from('hc_cp_titulos').select('*').eq('id', Number(id)).maybeSingle());
  if (!t) throw new CpError('Duplicata não encontrada', 'NOT_FOUND', 404);
  await empresasPermitidas(user, t.empresa);
  return t;
}

export async function detalheTitulo(user, id) {
  const t = await tituloDoUsuario(user, id);
  const [baixas, irmas] = await Promise.all([
    q(supabase.from('hc_cp_baixas').select('*').eq('titulo_id', t.id).order('id')),
    q(supabase.from('hc_cp_titulos').select('id, parcela, duplicata, valor, vencimento, situacao, data_pagamento').eq('empresa', t.empresa).eq('fornecedor_code', t.fornecedor_code).eq('duplicata', t.duplicata).order('vencimento').order('id')),
  ]);
  let anexoUrl = null;
  if (t.anexo_path) {
    const { data } = await supabase.storage.from(BUCKET_ANEXOS).createSignedUrl(t.anexo_path, 600);
    anexoUrl = data?.signedUrl || null;
  }
  return { titulo: { ...t, tela: situacaoDeTela(t) }, baixas: baixas || [], parcelas: irmas || [], anexoUrl };
}

// ─── alteração (só em aberto) ────────────────────────────────────────────────
export async function editarTitulo(user, id, b = {}) {
  const t = await tituloDoUsuario(user, id);
  if (t.situacao !== 'aberto') throw new CpError(`Esta duplicata está ${t.situacao} e não pode mais ser alterada`, 'NAO_ABERTA', 409);
  const patch = {};
  if (b.vencimento !== undefined) {
    if (!ehData(b.vencimento)) throw new CpError('Vencimento inválido');
    patch.vencimento = b.vencimento;
  }
  if (b.emissao !== undefined) {
    if (!ehData(b.emissao)) throw new CpError('Emissão inválida');
    patch.emissao = b.emissao;
  }
  if (b.entrada !== undefined) {
    if (!ehData(b.entrada)) throw new CpError('Data de entrada inválida');
    patch.entrada = b.entrada;
  }
  if ((patch.vencimento || String(t.vencimento).slice(0, 10)) < (patch.emissao || String(t.emissao).slice(0, 10))) throw new CpError('O vencimento é anterior à emissão');
  if (b.valor !== undefined) {
    const valor = round2(num(b.valor));
    if (!Number.isFinite(valor) || valor <= 0) throw new CpError('Valor inválido');
    patch.valor = valor;
  }
  if (b.formaPagamento !== undefined) {
    if (b.formaPagamento && !FORMAS[b.formaPagamento]) throw new CpError('Forma de pagamento inválida');
    patch.forma_pagamento = b.formaPagamento || null;
  }
  if (b.previsao !== undefined) patch.previsao = b.previsao === 'previsao' ? 'previsao' : 'real';
  if (b.chavePix !== undefined) patch.chave_pix = texto(b.chavePix, 600);
  if (b.codigoBarras !== undefined) patch.codigo_barras = texto(b.codigoBarras, 120);
  if (b.referencia !== undefined) patch.referencia = texto(b.referencia, 20);
  if (b.documentoFiscal !== undefined) patch.documento_fiscal = texto(b.documentoFiscal, 40);
  if (b.observacao !== undefined) patch.observacao = texto(b.observacao, 2000);
  if (b.portadorCode !== undefined) {
    const port = b.portadorCode ? await q(supabase.from('erp_portadores').select('code, descricao').eq('code', Number(b.portadorCode)).maybeSingle()) : null;
    if (b.portadorCode && !port) throw new CpError('Portador não existe', 'PORTADOR', 404);
    patch.portador_code = port?.code || null;
    patch.portador_nome = port?.descricao || null;
  }
  // rateio novo (lista inteira) ou só o valor mudou: as linhas são recalculadas pelo valor da parcela
  const mudouRateio = Array.isArray(b.rateio) || b.despesaCode !== undefined || b.centroCustoCode !== undefined;
  if (mudouRateio || patch.valor !== undefined) {
    let base;
    if (Array.isArray(b.rateio)) base = await nomearRateio(normalizarRateio(b.rateio));
    else if (mudouRateio) base = await nomearRateio(normalizarRateio([{ despesaCode: b.despesaCode ?? t.despesa_code, centroCustoCode: b.centroCustoCode !== undefined ? b.centroCustoCode : t.centro_custo_code, percentual: 100 }], { exigirCentro: false }));
    else base = (t.rateio || [{ despesa_code: t.despesa_code, despesa_nome: t.despesa_nome, centro_custo_code: t.centro_custo_code, centro_custo_nome: t.centro_custo_nome, percentual: 100 }]).map(({ valor: _v, ...l }) => l);
    const pri = principal(base);
    patch.rateio = ratear(base, patch.valor ?? round2(t.valor));
    patch.despesa_code = pri.despesa_code;
    patch.despesa_nome = pri.despesa_nome;
    patch.centro_custo_code = pri.centro_custo_code;
    patch.centro_custo_nome = pri.centro_custo_nome;
  }
  if (!Object.keys(patch).length) return t;
  const { data, error } = await supabase
    .from('hc_cp_titulos')
    .update({ ...patch, atualizado_por: quem(user), atualizado_em: new Date().toISOString() })
    .eq('id', t.id)
    .eq('situacao', 'aberto')
    .select()
    .maybeSingle();
  if (error) throw falhaDb(error);
  if (!data) throw new CpError('Esta duplicata acabou de ser baixada ou cancelada', 'NAO_ABERTA', 409);
  return data;
}

// ─── baixa (pagamento) — sem estorno ─────────────────────────────────────────
export async function baixarTitulo(user, id, b = {}) {
  const t = await tituloDoUsuario(user, id);
  if (t.situacao !== 'aberto') throw new CpError(`Esta duplicata já está ${t.situacao}`, 'JA_BAIXADA', 409);
  const hoje = hojeBrasil();
  const data = ehData(b.dataPagamento) ? b.dataPagamento : hoje;
  if (data > hoje) throw new CpError('A data do pagamento não pode ser no futuro');
  const juros = round2(num(b.juros));
  const multa = round2(num(b.multa));
  const desconto = round2(num(b.desconto));
  for (const [n, v] of [['juros', juros], ['multa', multa], ['desconto', desconto]]) {
    if (!Number.isFinite(v) || v < 0) throw new CpError(`Valor inválido em ${n}`);
  }
  const valor = round2(t.valor);
  if (desconto > valor + juros + multa) throw new CpError('O desconto é maior que o valor a pagar');
  const forma = b.formaPagamento ? String(b.formaPagamento) : t.forma_pagamento;
  if (forma && !FORMAS[forma]) throw new CpError('Forma de pagamento inválida');
  const pago = round2(valor + juros + multa - desconto);
  await conferirSenha(user?.email, b.senha);
  const agora = new Date().toISOString();
  const { data: atual, error } = await supabase
    .from('hc_cp_titulos')
    .update({ situacao: 'pago', data_pagamento: data, juros, multa, desconto, valor_pago: pago, forma_pagamento: forma || null, conta_pagamento: texto(b.conta, 120), baixado_por: quem(user), baixado_em: agora, atualizado_em: agora })
    .eq('id', t.id)
    .eq('situacao', 'aberto')
    .select()
    .maybeSingle();
  if (error) throw falhaDb(error);
  if (!atual) throw new CpError('Esta duplicata acabou de ser baixada por outra pessoa', 'JA_BAIXADA', 409);
  await q(
    supabase.from('hc_cp_baixas').insert({
      titulo_id: t.id,
      data_pagamento: data,
      valor_titulo: valor,
      juros,
      multa,
      desconto,
      valor_pago: pago,
      forma_pagamento: forma || null,
      conta: texto(b.conta, 120),
      observacao: texto(b.observacao, 1000),
      por_id: user?.id || null,
      por: quem(user),
    }),
  );
  console.log(`💸 [contas a pagar] baixa ${t.fornecedor_nome} duplicata ${rotuloDuplicata(t)} (empresa ${t.empresa}) R$ ${pago.toFixed(2)} · ${quem(user)}`);
  return atual;
}

// ─── cancelamento (só em aberto, com motivo e senha) ─────────────────────────
export async function cancelarTitulo(user, id, b = {}) {
  const t = await tituloDoUsuario(user, id);
  if (t.situacao !== 'aberto') throw new CpError(`Esta duplicata está ${t.situacao}; só dá para cancelar duplicata em aberto`, 'NAO_ABERTA', 409);
  const motivo = texto(b.motivo, 500);
  if (!motivo || motivo.length < 5) throw new CpError('Informe o motivo do cancelamento');
  await conferirSenha(user?.email, b.senha);
  const agora = new Date().toISOString();
  const { data, error } = await supabase
    .from('hc_cp_titulos')
    .update({ situacao: 'cancelado', cancelado_por: quem(user), cancelado_em: agora, cancelado_motivo: motivo, atualizado_em: agora })
    .eq('id', t.id)
    .eq('situacao', 'aberto')
    .select()
    .maybeSingle();
  if (error) throw falhaDb(error);
  if (!data) throw new CpError('Esta duplicata acabou de ser baixada ou cancelada', 'NAO_ABERTA', 409);
  console.log(`🚫 [contas a pagar] cancelada ${t.fornecedor_nome} duplicata ${rotuloDuplicata(t)} (empresa ${t.empresa}) · ${quem(user)}: ${motivo}`);
  return data;
}
