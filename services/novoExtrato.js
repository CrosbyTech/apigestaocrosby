// ============================================================
// New Extrato Bancário — importação e consulta (reconstrução do zero)
// ------------------------------------------------------------
// Tabelas próprias (criadas sob demanda via exec_sql):
//   neb_importacoes  — um registro por arquivo importado (conta, período,
//                      saldo inicial/final do banco, saldo recalculado, bate?)
//   neb_lancamentos  — as linhas do extrato, com saldo após cada lançamento
// Regras:
//   • só entra extrato cujo saldo recalculado bate com o saldo impresso
//     (dia a dia e final); se não bater, a importação é recusada e devolve
//     onde divergiu;
//   • o mesmo arquivo (hash) ou a mesma conta+mês importados de novo
//     substituem a importação anterior.
// Por enquanto só Banco do Brasil (utils/extratoBbPdf.js).
// ============================================================
import supabase from '../config/supabase.js';
import { lerExtratoBb } from '../utils/extratoBbPdf.js';
import { lerExtratoCaixaOfx, ehOfx } from '../utils/extratoCaixaOfx.js';
import { lerExtratoItau } from '../utils/extratoItauPdf.js';
import { lerExtratoSicredi } from '../utils/extratoSicrediPdf.js';
import { lerExtratoSantander } from '../utils/extratoSantanderPdf.js';
import { lerExtratoSantanderOfx, ehOfxSantander } from '../utils/extratoSantanderOfx.js';
import { lerExtratoUnicred } from '../utils/extratoUnicredPdf.js';
import { lerExtratoBradesco } from '../utils/extratoBradescoPdf.js';
import { lerExtratoBnb } from '../utils/extratoBnbPdf.js';

const T = { imp: 'neb_importacoes', lanc: 'neb_lancamentos', transf: 'neb_transferencias' };
const semAcento = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const normNome = (v) => semAcento(v).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\b(LTDA|ME|EPP|EIRELI|SA|S A|CIA)\b/g, ' ').replace(/\s+/g, ' ').trim();
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
// Empresas do grupo: raiz do CNPJ (todas as filiais: 0001-16, 0005-40, 0008-92, 0013-50…) +
// nomes/razões sociais pelos quais aparecem nos extratos. Regra do Yago: qualquer
// movimento com um desses CNPJs na outra ponta é entre contas.
const GRUPO = {
  17177680: ['CROSBY', 'CROSBY D CONFECCAO', 'CROSBY DISTRIBUICAO E CONFECCAO', 'CROSBY CR VESTUARIO', 'FERREIRA COMERCIO E CONFECCOES'],
  27728810: ['FABIO F LIMA AZEVEDO', 'FABIO FERREIRA DE LIMA AZEVEDO', 'FA MODA VAREJO', 'FA MODA & VAREJO'],
  53661116: ['IRMAOS VAREJO COMERCIAL', 'FLAVIO FERREIRA DE LIMA AZEVEDO', 'FLAVIO F LIMA AZEVEDO'],
  33592092: ['IRMAOS C V', 'IRMAOS CR VESTUARIO', 'IRMAOS C V LTDA', 'IRMAOS CROSBY'],
  // 36.569.459 (Crosby Recife Mall / Shopping Recife) NÃO entra: regra do Yago (06/11/2026), nada da Shopping Recife em nenhum banco
};
const SHOPPING_RECIFE = /SHOPPING\s*RECIFE|RECIFE\s*MALL|36\.?569\.?459/i;
const PARTICULAS = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E']);
const tokens = (v) => normNome(v).split(' ').filter((t) => t && !PARTICULAS.has(t));
// nome curto/truncado do extrato bate com o nome completo quando cada pedaço é prefixo do pedaço correspondente
function nomeBate(curto, longo) {
  const c = tokens(curto);
  const l = tokens(longo);
  if (!c.length || !l.length || c[0].length < 3 || !l[0].startsWith(c[0])) return false;
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
/** raiz do CNPJ do grupo que a contraparte representa (ou null) */
function raizDoGrupo(nome, doc) {
  const d = soDigitos(doc);
  if (d.length === 14) return Object.keys(GRUPO).includes(d.slice(0, 8)) ? d.slice(0, 8) : null;
  if (d.length === 11) return null; // pessoa física não é entre contas
  if (!nome) return null;
  for (const [raiz, nomes] of Object.entries(GRUPO)) if (nomes.some((n) => nomeBate(nome, n) || nomeBate(n, nome))) return raiz;
  return null;
}
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

let tabelasOk = null; // v2: colunas de contraparte/tipo/transferência
async function garantirTabelas() {
  if (tabelasOk) return true;
  const query = `
create table if not exists ${T.imp} (
  id bigserial primary key,
  banco text not null,
  agencia text,
  conta text not null,
  conta_dv text,
  titular text,
  mes_referencia text,
  periodo_inicio date,
  periodo_fim date,
  saldo_inicial numeric(15,2),
  saldo_final numeric(15,2),
  saldo_calculado numeric(15,2),
  bate boolean not null default false,
  qtd integer not null default 0,
  total_creditos numeric(15,2),
  total_debitos numeric(15,2),
  arquivo_nome text,
  arquivo_hash text,
  usuario text,
  criado_em timestamptz not null default now()
);
create index if not exists ${T.imp}_conta_idx on ${T.imp} (banco, conta, mes_referencia);
create table if not exists ${T.lanc} (
  id bigserial primary key,
  importacao_id bigint not null references ${T.imp}(id) on delete cascade,
  banco text not null,
  agencia text,
  conta text not null,
  conta_dv text,
  titular text,
  data date not null,
  data_balancete date,
  seq integer not null,
  pagina integer,
  agencia_origem text,
  lote text,
  historico_codigo text,
  historico text,
  documento text,
  valor numeric(15,2) not null,
  natureza text,
  saldo_apos numeric(15,2),
  saldo_informado numeric(15,2),
  criado_em timestamptz not null default now()
);
create index if not exists ${T.lanc}_data_idx on ${T.lanc} (data);
create index if not exists ${T.lanc}_conta_idx on ${T.lanc} (banco, conta, data);
alter table ${T.lanc} add column if not exists historico_base text;
alter table ${T.lanc} add column if not exists hora text;
alter table ${T.lanc} add column if not exists contraparte_nome text;
alter table ${T.lanc} add column if not exists contraparte_doc text;
alter table ${T.lanc} add column if not exists tipo text;
alter table ${T.lanc} add column if not exists transferencia_id bigint;
alter table ${T.lanc} add column if not exists grupo_raiz text;
alter table ${T.lanc} add column if not exists titular_cnpj text;
alter table ${T.lanc} add column if not exists historico_descricao text;
alter table ${T.lanc} add column if not exists valor_transferido numeric(15,2) not null default 0;
alter table ${T.imp} add column if not exists titular_cnpj text;
alter table ${T.imp} add column if not exists formato text;
alter table ${T.imp} add column if not exists encadeamento jsonb;
alter table ${T.imp} add column if not exists descartados integer;
create table if not exists ${T.transf} (
  id bigserial primary key,
  data date not null,
  data_entrada date,
  valor numeric(15,2) not null,
  origem_lancamento_id bigint not null,
  destino_lancamento_id bigint not null,
  origem_banco text, origem_conta text, destino_banco text, destino_conta text,
  evidencia text,
  criado_em timestamptz not null default now()
);`;
  const { error } = await supabase.rpc('exec_sql', { query });
  // tabela nova só aparece na API depois de o PostgREST recarregar o esquema
  if (!error) await supabase.rpc('exec_sql', { query: "select pg_notify('pgrst', 'reload schema')" });
  if (error) {
    // sem a RPC: tenta seguir (as tabelas podem já existir)
    const { error: e2 } = await supabase.from(T.imp).select('id', { head: true, count: 'exact' });
    if (e2) throw new Error(`Tabelas do New Extrato não existem e não foi possível criá-las: ${error.message}`);
  }
  tabelasOk = true;
  return true;
}

function detectarBanco(nome, buffer) {
  const n = String(nome || '').toUpperCase();
  const cab = buffer.subarray(0, 4);
  if (cab.toString('latin1') === '%PDF') return /\bBNB\b|NORDESTE/.test(n) ? 'BNB' : /BRADESCO/.test(n) ? 'BRADESCO' : /UNICRED/.test(n) ? 'UNICRED' : /SANTANDER/.test(n) ? 'SANTANDER' : /SICREDI/.test(n) ? 'SICREDI' : /ITAU|ITAÚ/.test(n) ? 'ITAU' : /\bBB\b|BANCO DO BRASIL/.test(n) ? 'BB' : 'PDF';
  if (ehOfx(buffer)) return 'OFX';
  throw new Error('Envie o extrato em PDF (Banco do Brasil, Itaú, Sicredi, Santander, Unicred, Bradesco ou BNB) ou OFX (Caixa ou Santander).');
}

/**
 * Importa um extrato (PDF). Devolve a leitura + o que foi gravado.
 */
export async function importarExtrato({ buffer, nome, usuario = null, forcar = false, leitura: leituraPronta = null }) {
  await garantirTabelas();
  let banco = leituraPronta ? leituraPronta.banco : detectarBanco(nome, buffer);
  let leitura = leituraPronta;
  if (SHOPPING_RECIFE.test(String(nome || ''))) throw new Error('Arquivo da Shopping Recife: não entra em nenhum banco (regra do Yago).');
  if (leitura) {
    // uma das contas de um extrato com várias contas (BNB consolidado), já lida
  } else if (banco === 'OFX') {
    // OFX: o banco vem do BANKID (104 Caixa, 033 Santander); outro banco dá erro claro
    if (ehOfxSantander(buffer)) {
      leitura = lerExtratoSantanderOfx(buffer);
      banco = 'SANTANDER';
    } else {
      leitura = lerExtratoCaixaOfx(buffer);
      banco = 'CAIXA';
    }
  } else {
    // PDF: tenta primeiro o leitor sugerido pelo nome do arquivo e depois o outro
    const LEITORES = { BB: lerExtratoBb, ITAU: lerExtratoItau, SICREDI: lerExtratoSicredi, SANTANDER: lerExtratoSantander, UNICRED: lerExtratoUnicred, BRADESCO: lerExtratoBradesco, BNB: lerExtratoBnb };
    const ordem = [banco, ...Object.keys(LEITORES)].filter((b, i, a) => LEITORES[b] && a.indexOf(b) === i);
    const erros = [];
    for (const b of ordem) {
      try {
        leitura = await LEITORES[b](buffer);
        banco = b;
        break;
      } catch (e) {
        if (/Shopping Recife/i.test(e.message)) throw e;
        erros.push(`${b}: ${e.message}`);
      }
    }
    if (!leitura) throw new Error(`Banco não reconhecido no arquivo "${nome}". O New Extrato lê o PDF do Banco do Brasil, do Itaú, do Sicredi, do Santander (consolidado), da Unicred, do Bradesco e do BNB e o OFX da Caixa e do Santander. ${erros.join(' · ')}`);
  }
  if (Array.isArray(leitura)) {
    // extrato com VÁRIAS contas (BNB "Extrato Consolidado"): importa uma por uma
    const resultados = [];
    for (const l of leitura) resultados.push(await importarExtrato({ buffer, nome, usuario, forcar, leitura: l }));
    return { multiplas: resultados.length, banco, conta: resultados.map((r) => `${r.conta}-${r.contaDv}`).join(', '), mesReferencia: resultados[0]?.mesReferencia || null, qtd: resultados.reduce((s, r) => s + (r.qtd || 0), 0), conferencia: { bate: resultados.every((r) => r.conferencia?.bate) }, encadeamento: null, resultados };
  }
  if (SHOPPING_RECIFE.test(`${leitura.titular || ''} ${leitura.titularCnpj || ''}`)) throw new Error('Extrato da Shopping Recife: não entra em nenhum banco (regra do Yago).');
  const { conferencia } = leitura;
  if (!conferencia.bate && !forcar) {
    const d = conferencia.divergencias[0];
    throw Object.assign(
      new Error(
        `Saldo não bate: calculado ${conferencia.saldoCalculado.toFixed(2)} × informado ${conferencia.saldoFinalInformado.toFixed(2)}` +
          (d ? ` (primeira divergência em ${d.data}, "${d.historico}": calculado ${d.saldoCalculado.toFixed(2)} × impresso ${d.saldoInformado.toFixed(2)})` : ''),
      ),
      { status: 422, leitura },
    );
  }
  // substitui importação anterior do mesmo arquivo ou da mesma conta+mês
  const { data: antigas } = await supabase
    .from(T.imp)
    .select('id,arquivo_hash,mes_referencia')
    .eq('banco', banco)
    .eq('conta', leitura.conta)
    .or(`arquivo_hash.eq.${leitura.hash},mes_referencia.eq.${leitura.mesReferencia || 'x'}`);
  const substituidas = (antigas || []).map((a) => a.id);
  if (substituidas.length) {
    const { error } = await supabase.from(T.imp).delete().in('id', substituidas);
    if (error) throw new Error(error.message);
  }
  // ── sobreposição com o que já existe da mesma conta ──
  // Caixa: o extrato "do mês" vai até o 1º dia útil do mês seguinte e o mês
  // seguinte repete esse dia. Dia que já está importado em outra importação
  // da conta é descartado deste arquivo; o saldo é ajustado para o último dia
  // que ficou (saldo final do arquivo − movimentos descartados depois dele).
  const datasArq = leitura.lancamentos.map((l) => l.data).sort();
  const jaImportados = datasArq.length
    ? await todos(() => supabase.from(T.lanc).select('data,valor').eq('banco', banco).eq('conta', leitura.conta).gte('data', datasArq[0]).lte('data', datasArq.at(-1)).order('id'))
    : [];
  const datasOcupadas = new Set(jaImportados.map((l) => l.data));
  const descartados = leitura.lancamentos.filter((l) => datasOcupadas.has(l.data));
  const mantidos = leitura.lancamentos.filter((l) => !datasOcupadas.has(l.data));
  let saldoFinalArquivo = leitura.saldoFinal;
  let saldoFinalGravar = leitura.saldoFinal;
  if (descartados.length) {
    const ultimaMantida = mantidos.length ? mantidos.map((l) => l.data).sort().at(-1) : null;
    const depois = descartados.filter((l) => !ultimaMantida || l.data > ultimaMantida).reduce((s, l) => s + l.valor, 0);
    saldoFinalGravar = round2(leitura.saldoFinal - depois);
    const saldoInicial = round2(saldoFinalGravar - mantidos.reduce((s, l) => s + l.valor, 0));
    let c = saldoInicial;
    mantidos.forEach((l, i) => {
      l.seq = i + 1;
      c = round2(c + l.valor);
      l.saldoApos = c;
    });
    leitura.saldoInicial = saldoInicial;
    leitura.lancamentos = mantidos;
    conferencia.saldoInicial = saldoInicial;
    conferencia.saldoCalculado = c;
    conferencia.saldoFinalInformado = saldoFinalGravar;
    conferencia.descartados = descartados.length;
  }
  // encadeamento com a importação anterior da conta (saldo final dela = saldo inicial desta)
  let encadeamento = null;
  const inicioLanc = leitura.lancamentos.map((l) => l.data).sort()[0] || leitura.periodo.inicio;
  if (inicioLanc) {
    const { data: ant } = await supabase.from(T.imp).select('id,mes_referencia,periodo_fim,saldo_final').eq('banco', banco).eq('conta', leitura.conta).lt('periodo_fim', inicioLanc).order('periodo_fim', { ascending: false }).limit(1);
    const a = ant?.[0];
    if (a) {
      const dif = round2(Number(leitura.saldoInicial) - Number(a.saldo_final));
      encadeamento = { anteriorMes: a.mes_referencia, anteriorFim: a.periodo_fim, saldoFinalAnterior: Number(a.saldo_final), saldoInicialDeste: leitura.saldoInicial, diferenca: dif, bate: Math.abs(dif) <= 0.005 };
    }
  }
  // OFX cujo saldo final (DTASOF) é de DEPOIS do último lançamento do arquivo
  // (Caixa de dezembro: BALAMT em 03/01 já com os movimentos de janeiro): o saldo
  // do fim do mês vem do encadeamento — saldo final do mês anterior + movimentos
  // deste arquivo. Conferido no PDF de dez/2024 da Crosby (17.259,00 em 31/12).
  const ultimaDataLanc = leitura.lancamentos.map((l) => l.data).sort().at(-1) || null;
  if (encadeamento && !encadeamento.bate && leitura.formato === 'ofx' && leitura.saldoFinalEm && ultimaDataLanc && leitura.saldoFinalEm > ultimaDataLanc) {
    const inicial = encadeamento.saldoFinalAnterior;
    let c = inicial;
    for (const l of leitura.lancamentos) {
      c = round2(c + l.valor);
      l.saldoApos = c;
    }
    leitura.saldoInicial = inicial;
    saldoFinalGravar = c;
    conferencia.saldoInicial = inicial;
    conferencia.saldoCalculado = c;
    conferencia.saldoFinalInformado = c;
    conferencia.nota = `saldo final do arquivo (${leitura.saldoFinal.toFixed(2)} em ${leitura.saldoFinalEm}) é de depois do fim do mês; usado o encadeamento com ${encadeamento.anteriorMes}`;
    encadeamento = { ...encadeamento, saldoInicialDeste: inicial, diferenca: 0, bate: true, viaEncadeamento: true, saldoArquivoEm: leitura.saldoFinalEm, saldoArquivo: leitura.saldoFinal };
  }
  const bateGeral = conferencia.bate && (!encadeamento || encadeamento.bate);
  if (!bateGeral && !forcar) {
    throw Object.assign(new Error(`O saldo não encadeia com o mês anterior (${encadeamento.anteriorMes}): saldo final anterior ${encadeamento.saldoFinalAnterior.toFixed(2)} × saldo inicial deste ${encadeamento.saldoInicialDeste.toFixed(2)} (diferença ${encadeamento.diferenca.toFixed(2)}). Provável mês faltando ou arquivo de outro período.`), { status: 422, leitura });
  }
  const { data: imp, error: eImp } = await supabase
    .from(T.imp)
    .insert({
      banco,
      agencia: leitura.agencia,
      conta: leitura.conta,
      conta_dv: leitura.contaDv,
      titular: leitura.titular,
      titular_cnpj: leitura.titularCnpj || null,
      formato: leitura.formato || 'pdf',
      mes_referencia: leitura.mesReferencia,
      periodo_inicio: leitura.lancamentos.length && leitura.lancamentos.map((l) => l.data).sort()[0] < leitura.periodo.inicio ? leitura.lancamentos.map((l) => l.data).sort()[0] : leitura.periodo.inicio,
      periodo_fim: leitura.lancamentos.length ? leitura.lancamentos.map((l) => l.data).sort().at(-1) > leitura.periodo.fim ? leitura.lancamentos.map((l) => l.data).sort().at(-1) : leitura.periodo.fim : leitura.periodo.fim,
      saldo_inicial: leitura.saldoInicial,
      saldo_final: saldoFinalGravar,
      saldo_calculado: conferencia.saldoCalculado,
      bate: bateGeral,
      encadeamento,
      descartados: descartados.length,
      qtd: leitura.lancamentos.length,
      total_creditos: conferencia.totalCreditos,
      total_debitos: conferencia.totalDebitos,
      arquivo_nome: nome || null,
      arquivo_hash: leitura.hash,
      usuario,
    })
    .select()
    .single();
  if (eImp) throw new Error(eImp.message || JSON.stringify(eImp));
  const rows = leitura.lancamentos.map((l) => ({
    importacao_id: imp.id,
    banco,
    agencia: leitura.agencia,
    conta: leitura.conta,
    conta_dv: leitura.contaDv,
    titular: leitura.titular,
    titular_cnpj: leitura.titularCnpj || null,
    historico_descricao: l.historicoDescricao || null,
    data: l.data,
    data_balancete: l.dataBalancete,
    seq: l.seq,
    pagina: l.pagina,
    agencia_origem: l.agenciaOrigem,
    lote: l.lote,
    historico_codigo: l.historicoCodigo,
    historico: l.historico,
    documento: l.documento,
    valor: l.valor,
    natureza: l.natureza,
    saldo_apos: l.saldoApos,
    saldo_informado: l.saldoInformado,
    historico_base: l.historicoBase || l.historico,
    hora: l.hora || null,
    contraparte_nome: l.contraparteNome || null,
    contraparte_doc: l.contraparteDoc || null,
    tipo: l.tipo === 'APLICACAO' ? 'APLICACAO' : l.valor > 0 ? 'ENTRADA' : 'SAIDA',
    grupo_raiz: raizDoGrupo(l.contraparteNome, l.contraparteDoc),
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from(T.lanc).insert(rows.slice(i, i + 500));
    if (error) throw new Error(error.message || JSON.stringify(error));
  }
  const transferencias = await casarTransferencias().catch((e) => ({ erro: e.message }));
  return {
    transferencias,
    importacao: imp,
    substituidas: substituidas.length,
    banco,
    conta: `${leitura.conta}-${leitura.contaDv}`,
    titular: leitura.titular,
    mesReferencia: leitura.mesReferencia,
    periodo: leitura.periodo,
    qtd: rows.length,
    descartados: descartados.length,
    saldoInicial: leitura.saldoInicial,
    saldoFinal: saldoFinalGravar,
    saldoFinalArquivo,
    encadeamento,
    conferencia,
  };
}

async function todos(montar, pagina = 1000) {
  const out = [];
  for (let ini = 0; ; ini += pagina) {
    const { data, error } = await montar().range(ini, ini + pagina - 1);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < pagina) return out;
  }
}

/**
 * Transferências entre as contas importadas: saída numa conta e entrada noutra,
 * mesmo valor, mesmo dia (ou dia seguinte), com a contraparte apontando para a
 * outra conta (CNPJ/nome do titular) — ou, sem contraparte, par único do dia
 * acima de R$ 1.000. Linha sem par cuja contraparte é empresa do grupo vira
 * transferência "sem par" (a outra conta ainda não foi importada).
 * Refaz tudo a cada chamada (os pares são sempre automáticos).
 */
export async function casarTransferencias() {
  await garantirTabelas();
  const imps = await todos(() => supabase.from(T.imp).select('id,banco,conta,conta_dv,titular,titular_cnpj').order('id'));
  const contas = new Map();
  for (const i of imps) if (!contas.has(`${i.banco}|${i.conta}`)) contas.set(`${i.banco}|${i.conta}`, { banco: i.banco, conta: i.conta, titular: i.titular, cnpj: i.titular_cnpj || null, cnpjRaiz: null });
  // raiz do CNPJ de cada conta: pelo CNPJ gravado (Caixa) ou pelo nome do titular (o PDF do BB não traz o CNPJ)
  for (const c of contas.values()) c.cnpjRaiz = (c.cnpj && soDigitos(c.cnpj).slice(0, 8)) || raizDoGrupo(c.titular, null);
  const rows = await todos(() => supabase.from(T.lanc).select('id,banco,conta,data,valor,historico_base,contraparte_nome,contraparte_doc,grupo_raiz,tipo,transferencia_id,valor_transferido').order('data').order('id'));
  // zera o estado anterior
  const { error: eDel } = await supabase.from(T.transf).delete().gte('id', 0);
  if (eDel) throw new Error(eDel.message);
  const cents = (v) => Math.round(Math.abs(Number(v)) * 100);
  const dd = (a, b) => Math.round((new Date(`${a}T00:00:00Z`) - new Date(`${b}T00:00:00Z`)) / 86400000);
  const chaveConta = (r) => `${r.banco}|${r.conta}`;
  const apontaPara = (r, conta) => {
    // contraparte do lançamento é a conta de destino/origem?
    const raiz = r.grupo_raiz || raizDoGrupo(r.contraparte_nome, r.contraparte_doc);
    if (raiz && conta.cnpjRaiz && raiz === conta.cnpjRaiz) return 3;
    if (r.contraparte_nome && conta.titular && (nomeBate(r.contraparte_nome, conta.titular) || nomeBate(conta.titular, r.contraparte_nome))) return 2;
    return 0;
  };
  const entradasPorValor = new Map();
  const saidasPorValor = new Map();
  for (const r of rows) {
    if (cents(r.valor) < 100 || r.tipo === 'APLICACAO') continue; // aplicação automática não casa com nada
    const m = Number(r.valor) > 0 ? entradasPorValor : saidasPorValor;
    const k = cents(r.valor);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  // SISPAG = sistema de pagamentos do Itaú: quem recebe vê "SISPAG <pagador>", quem paga vê "SISPAG FORNECEDORES …"
  const ehPixOuTransf = (r) => /PIX|TRANSF|TED|TEV|DOC|SISPAG/i.test(semAcento(r.historico_base || ''));
  const combos = [];
  for (const s of rows) {
    if (Number(s.valor) >= 0 || s.tipo === 'APLICACAO') continue;
    for (const e of entradasPorValor.get(cents(s.valor)) || []) {
      if (chaveConta(e) === chaveConta(s)) continue;
      const d = dd(e.data, s.data);
      if (d < 0 || d > 1) continue;
      const origem = contas.get(chaveConta(s));
      const destino = contas.get(chaveConta(e));
      let sc = apontaPara(s, destino) + apontaPara(e, origem);
      if (!ehPixOuTransf(s) || !ehPixOuTransf(e)) continue;
      if (d === 0) sc += 1;
      // sem nenhuma contraparte dos dois lados: par único do dia, ≥ R$ 1.000
      if (sc <= 1 && !s.contraparte_nome && !s.contraparte_doc && !e.contraparte_nome && !e.contraparte_doc && cents(s.valor) >= 100000 && d === 0) {
        const outrasE = (entradasPorValor.get(cents(s.valor)) || []).filter((x) => x.id !== e.id && Math.abs(dd(x.data, s.data)) <= 1);
        const outrasS = (saidasPorValor.get(cents(s.valor)) || []).filter((x) => x.id !== s.id && Math.abs(dd(x.data, e.data)) <= 1);
        if (!outrasE.length && !outrasS.length) sc = 2;
      }
      // contraparte com CNPJ/CPF apontando para OUTRA empresa (não a da conta de destino) desqualifica.
      // Só pelo documento: o nome é rótulo (no Santander "PIX ENVIADO CROSBY" sai até da conta da
      // Fabio para a Sicredi da Fabio) e muitas vezes vem truncado.
      const raizDoc = (r) => (r.contraparte_doc ? raizDoGrupo(null, r.contraparte_doc) : null);
      const raizS = raizDoc(s);
      if (raizS && destino?.cnpjRaiz && raizS !== destino.cnpjRaiz) continue;
      const raizE = raizDoc(e);
      if (raizE && origem?.cnpjRaiz && raizE !== origem.cnpjRaiz) continue;
      if (sc >= 2) combos.push({ s, e, sc, d });
    }
  }
  combos.sort((a, b) => b.sc - a.sc || a.d - b.d);
  const usados = new Set();
  const pares = [];
  for (const c of combos) {
    if (usados.has(c.s.id) || usados.has(c.e.id)) continue;
    usados.add(c.s.id);
    usados.add(c.e.id);
    pares.push({ data: c.s.data, data_entrada: c.e.data, valor: round2(Math.abs(Number(c.s.valor))), origem_lancamento_id: c.s.id, destino_lancamento_id: c.e.id, origem_banco: c.s.banco, origem_conta: c.s.conta, destino_banco: c.e.banco, destino_conta: c.e.conta, evidencia: c.sc >= 3 ? 'contraparte' : c.sc === 2 && (c.s.contraparte_nome || c.e.contraparte_nome) ? 'nome' : 'valor e dia únicos' });
  }
  // ── parte de lote (Yago, 06/11/2026) ──────────────────────────────────
  // A saída "SISPAG …" do Itaú é a remessa de pagamentos: dentro dela pode haver
  // fornecedor E transferência para conta do grupo, e o que entra na outra conta
  // pode ser só uma parte do valor. Entrada sem par vinda de empresa do grupo →
  // procura, nas contas dessa empresa, uma saída de lote do mesmo dia (ou do dia
  // anterior) com "espaço" (valor ainda não alocado) ≥ entrada. A saída continua
  // SAÍDA com valor_transferido (a parte), ou vira TRANSFERENCIA se o lote inteiro
  // foi para o grupo. Só lotes que podem carregar transferência: fornecedores,
  // Pix transferência, TED e transf. c/c Itaú (boleto, tributo, salário, QR não).
  const LOTE = /^SISPAG(\s+FORNECEDORES)?(\s+(PIX\s+TRANSFERENCI\w*|TED|TRANSF\s+CC\s+ITAU))?$/i;
  const contasDaRaiz = new Map();
  for (const [k, c] of contas) {
    if (!c.cnpjRaiz) continue;
    if (!contasDaRaiz.has(c.cnpjRaiz)) contasDaRaiz.set(c.cnpjRaiz, new Set());
    contasDaRaiz.get(c.cnpjRaiz).add(k);
  }
  const capacidade = new Map(); // id da saída de lote → centavos ainda não alocados
  const lotesPorConta = new Map();
  for (const r of rows) {
    if (usados.has(r.id) || Number(r.valor) >= 0 || r.tipo === 'APLICACAO' || !LOTE.test(semAcento(r.historico_base || '').trim())) continue;
    capacidade.set(r.id, cents(r.valor));
    const k = chaveConta(r);
    if (!lotesPorConta.has(k)) lotesPorConta.set(k, []);
    lotesPorConta.get(k).push(r);
  }
  const alocado = new Map(); // id da saída de lote → centavos transferidos para o grupo
  const entradasSemPar = rows.filter((r) => Number(r.valor) > 0 && !usados.has(r.id) && cents(r.valor) >= 100 && r.tipo !== 'APLICACAO').sort((a, b) => a.data.localeCompare(b.data) || cents(b.valor) - cents(a.valor));
  for (const e of entradasSemPar) {
    const raiz = e.grupo_raiz || raizDoGrupo(e.contraparte_nome, e.contraparte_doc);
    if (!raiz || !ehPixOuTransf(e)) continue;
    const origens = contasDaRaiz.get(raiz);
    if (!origens) continue;
    let melhor = null;
    for (const k of origens) {
      if (k === chaveConta(e)) continue;
      for (const s of lotesPorConta.get(k) || []) {
        const d = dd(e.data, s.data);
        if (d < 0 || d > 1) continue;
        const cap = capacidade.get(s.id);
        if (cap < cents(e.valor)) continue;
        if (!melhor || d < melhor.d || (d === melhor.d && cap < capacidade.get(melhor.s.id))) melhor = { s, d };
      }
    }
    if (!melhor) continue;
    const s = melhor.s;
    capacidade.set(s.id, capacidade.get(s.id) - cents(e.valor));
    alocado.set(s.id, (alocado.get(s.id) || 0) + cents(e.valor));
    usados.add(e.id);
    pares.push({ data: s.data, data_entrada: e.data, valor: round2(Number(e.valor)), origem_lancamento_id: s.id, destino_lancamento_id: e.id, origem_banco: s.banco, origem_conta: s.conta, destino_banco: e.banco, destino_conta: e.conta, evidencia: 'parte do lote SISPAG' });
  }
  const valorPorId = new Map(rows.map((r) => [r.id, cents(r.valor)]));
  const loteCheio = (id) => alocado.has(id) && alocado.get(id) === valorPorId.get(id);
  // grava pares e marca as duas pontas (a saída de lote só recebe o id do par quando o lote inteiro foi para o grupo)
  const idPar = new Map();
  for (let i = 0; i < pares.length; i += 300) {
    const { data, error } = await supabase.from(T.transf).insert(pares.slice(i, i + 300)).select('id,origem_lancamento_id,destino_lancamento_id,evidencia');
    if (error) throw new Error(error.message);
    for (const t of data || []) {
      if (!alocado.has(t.origem_lancamento_id)) idPar.set(t.origem_lancamento_id, t.id);
      else if (loteCheio(t.origem_lancamento_id) && !idPar.has(t.origem_lancamento_id)) idPar.set(t.origem_lancamento_id, t.id);
      idPar.set(t.destino_lancamento_id, t.id);
    }
  }
  const sqlStr = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
  const sets = [];
  for (const r of rows) {
    if (r.tipo === 'APLICACAO') continue; // aplicação automática fica como está
    const par = idPar.get(r.id) || null;
    const raiz = r.grupo_raiz || raizDoGrupo(r.contraparte_nome, r.contraparte_doc);
    // sem par mas a contraparte é empresa do grupo (outra conta não importada) → transferência sem par
    // Regra do Yago (06/11/2026): QUALQUER entrada vinda de um CNPJ do grupo e
    // QUALQUER saída para um CNPJ do grupo é entre contas, mesmo sem a outra
    // ponta importada (inclusive a própria empresa em outro banco).
    const semPar = !par && raiz && ehPixOuTransf(r);
    const tipo = par || semPar ? 'TRANSFERENCIA' : Number(r.valor) > 0 ? 'ENTRADA' : 'SAIDA';
    // parte do lote SISPAG que foi para o grupo (a saída continua SAÍDA, mas essa parte não é "pago")
    const vt = tipo === 'SAIDA' && alocado.has(r.id) ? round2(alocado.get(r.id) / 100) : 0;
    if (tipo !== r.tipo || (par || null) !== (r.transferencia_id || null) || (raiz || null) !== (r.grupo_raiz || null) || vt !== round2(Number(r.valor_transferido || 0))) sets.push({ id: r.id, tipo, par, raiz, vt });
  }
  for (let i = 0; i < sets.length; i += 400) {
    // casts explícitos: um lote só com NULL em "par" faria o Postgres tipar a coluna como text
    const values = sets.slice(i, i + 400).map((x) => `(${x.id}::bigint, ${sqlStr(x.tipo)}::text, ${x.par == null ? 'NULL::bigint' : `${x.par}::bigint`}, ${sqlStr(x.raiz)}::text, ${x.vt}::numeric)`).join(',');
    const { data: ret, error } = await supabase.rpc('exec_sql', { query: `update ${T.lanc} l set tipo = v.tipo, transferencia_id = v.par, grupo_raiz = v.raiz, valor_transferido = v.vt from (values ${values}) as v(id, tipo, par, raiz, vt) where l.id = v.id` });
    if (error) throw new Error(error.message);
    if (ret && typeof ret === 'object' && ret.error) throw new Error(String(ret.error));
  }
  const partes = pares.filter((p) => p.evidencia === 'parte do lote SISPAG');
  return { pares: pares.length, valor: round2(pares.reduce((a, p) => a + p.valor, 0)), partesDeLote: partes.length, valorPartesDeLote: round2(partes.reduce((a, p) => a + p.valor, 0)), semPar: sets.filter((x) => x.tipo === 'TRANSFERENCIA' && !x.par).length, atualizados: sets.length };
}

export async function listarContas() {
  await garantirTabelas();
  const imps = await todos(() => supabase.from(T.imp).select('id,banco,agencia,conta,conta_dv,titular,mes_referencia,periodo_inicio,periodo_fim,saldo_inicial,saldo_final,bate,qtd,arquivo_nome,criado_em').order('banco').order('conta').order('periodo_inicio'));
  const porConta = new Map();
  for (const i of imps) {
    const k = `${i.banco}|${i.conta}`;
    if (!porConta.has(k)) porConta.set(k, { chave: k, banco: i.banco, agencia: i.agencia, conta: i.conta, contaDv: i.conta_dv, titular: i.titular, importacoes: [], periodoInicio: i.periodo_inicio, periodoFim: i.periodo_fim });
    const c = porConta.get(k);
    c.importacoes.push(i);
    if (i.periodo_inicio < c.periodoInicio) c.periodoInicio = i.periodo_inicio;
    if (i.periodo_fim > c.periodoFim) c.periodoFim = i.periodo_fim;
  }
  return [...porConta.values()];
}

/**
 * Lançamentos do período com os filtros da tela. Entradas/saídas/resultado
 * somam só as linhas de lançamento; o saldo fica na coluna "saldo após".
 */
export async function listarLancamentos({ de, ate, bancos = [], contas = [], tipos = [], busca = '' } = {}) {
  await garantirTabelas();
  const rows = await todos(() => {
    let q = supabase.from(T.lanc).select('*').order('data').order('conta').order('seq');
    if (de) q = q.gte('data', de);
    if (ate) q = q.lte('data', ate);
    if (bancos.length) q = q.in('banco', bancos);
    if (contas.length) q = q.in('conta', contas);
    return q;
  });
  const b = String(busca || '').trim().toLowerCase();
  const filtrados = rows
    .map((l) => ({ ...l, valor: Number(l.valor), valor_transferido: round2(Number(l.valor_transferido || 0)), saldo_apos: l.saldo_apos == null ? null : Number(l.saldo_apos), tipo: l.tipo || (Number(l.valor) > 0 ? 'ENTRADA' : 'SAIDA'), sentido: Number(l.valor) > 0 ? 'ENTRADA' : 'SAIDA' }))
    .filter((l) => !tipos.length || tipos.includes(l.tipo))
    .filter((l) => !b || `${l.historico || ''} ${l.documento || ''} ${l.historico_codigo || ''} ${l.contraparte_nome || ''} ${l.contraparte_doc || ''} ${Math.abs(l.valor).toFixed(2).replace('.', ',')}`.toLowerCase().includes(b));
  // Recebido/Pago só com lançamentos de fora; transferências (as duas pontas) ficam fora e contam uma vez
  const resumo = { entradas: 0, saidas: 0, qtdEntradas: 0, qtdSaidas: 0, transfEnviadas: 0, transfRecebidas: 0, transfSemParEnviadas: 0, transfSemParRecebidas: 0, transfParteLote: 0, qtdParteLote: 0, qtdTransf: 0, aplicado: 0, resgatado: 0, qtdAplicacoes: 0, qtd: filtrados.length };
  for (const l of filtrados) {
    if (l.tipo === 'APLICACAO') {
      // dinheiro indo/voltando da aplicação automática (Invest Fácil): nem recebido nem pago
      resumo.qtdAplicacoes++;
      if (l.valor < 0) resumo.aplicado = round2(resumo.aplicado - l.valor);
      else resumo.resgatado = round2(resumo.resgatado + l.valor);
    } else if (l.tipo === 'TRANSFERENCIA') {
      resumo.qtdTransf++;
      if (l.transferencia_id) {
        if (l.valor > 0) resumo.transfRecebidas = round2(resumo.transfRecebidas + l.valor);
        else resumo.transfEnviadas = round2(resumo.transfEnviadas - l.valor);
      } else if (l.valor > 0) resumo.transfSemParRecebidas = round2(resumo.transfSemParRecebidas + l.valor);
      else resumo.transfSemParEnviadas = round2(resumo.transfSemParEnviadas - l.valor);
    } else if (l.valor > 0) {
      resumo.entradas = round2(resumo.entradas + l.valor);
      resumo.qtdEntradas++;
    } else {
      // saída de lote SISPAG com uma parte para o grupo: só o resto é "pago"; a parte conta como transferência enviada
      resumo.saidas = round2(resumo.saidas - l.valor - l.valor_transferido);
      resumo.qtdSaidas++;
      if (l.valor_transferido) {
        resumo.transfEnviadas = round2(resumo.transfEnviadas + l.valor_transferido);
        resumo.transfParteLote = round2(resumo.transfParteLote + l.valor_transferido);
        resumo.qtdParteLote++;
      }
    }
  }
  resumo.resultado = round2(resumo.entradas - resumo.saidas);
  // pares do período (as duas pontas), para a área de transferências
  const idsTransf = [...new Set(filtrados.filter((l) => l.transferencia_id).map((l) => l.transferencia_id))];
  const pares = [];
  for (let i = 0; i < idsTransf.length; i += 300) {
    const { data, error } = await supabase.from(T.transf).select('*').in('id', idsTransf.slice(i, i + 300));
    if (error) throw new Error(error.message);
    pares.push(...(data || []));
  }
  const porId = new Map(rows.map((l) => [l.id, l]));
  const transferencias = pares
    .map((t) => {
      const o = porId.get(t.origem_lancamento_id);
      const d = porId.get(t.destino_lancamento_id);
      return { ...t, valor: Number(t.valor), origem: o ? { conta: o.conta, conta_dv: o.conta_dv, banco: o.banco, titular: o.titular, historico: o.historico, contraparte: o.contraparte_nome, data: o.data } : null, destino: d ? { conta: d.conta, conta_dv: d.conta_dv, banco: d.banco, titular: d.titular, historico: d.historico, contraparte: d.contraparte_nome, data: d.data } : null };
    })
    .sort((a, b) => String(a.data).localeCompare(String(b.data)));
  const semPar = filtrados.filter((l) => l.tipo === 'TRANSFERENCIA' && !l.transferencia_id);
  return { lancamentos: filtrados, resumo, transferencias, semPar };
}

export default { importarExtrato, listarContas, listarLancamentos, casarTransferencias };
