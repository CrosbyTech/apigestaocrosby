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

const T = { imp: 'neb_importacoes', lanc: 'neb_lancamentos' };
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

let tabelasOk = null;
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
create index if not exists ${T.lanc}_conta_idx on ${T.lanc} (banco, conta, data);`;
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
  if (cab.toString('latin1') !== '%PDF') throw new Error('Envie o extrato em PDF.');
  if (/\bBB\b|BANCO DO BRASIL/.test(n)) return 'BB';
  return null; // decide pelo conteúdo
}

/**
 * Importa um extrato (PDF). Devolve a leitura + o que foi gravado.
 */
export async function importarExtrato({ buffer, nome, usuario = null, forcar = false }) {
  await garantirTabelas();
  let banco = detectarBanco(nome, buffer);
  let leitura;
  try {
    leitura = await lerExtratoBb(buffer);
    banco = 'BB';
  } catch (e) {
    if (banco === 'BB') throw e;
    throw new Error(`Banco não reconhecido no arquivo "${nome}". Por enquanto o New Extrato lê só o PDF do Banco do Brasil (Consultas - Extrato de conta corrente). ${e.message}`);
  }
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
  const { data: imp, error: eImp } = await supabase
    .from(T.imp)
    .insert({
      banco,
      agencia: leitura.agencia,
      conta: leitura.conta,
      conta_dv: leitura.contaDv,
      titular: leitura.titular,
      mes_referencia: leitura.mesReferencia,
      periodo_inicio: leitura.periodo.inicio,
      periodo_fim: leitura.periodo.fim,
      saldo_inicial: leitura.saldoInicial,
      saldo_final: leitura.saldoFinal,
      saldo_calculado: conferencia.saldoCalculado,
      bate: conferencia.bate,
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
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from(T.lanc).insert(rows.slice(i, i + 500));
    if (error) throw new Error(error.message || JSON.stringify(error));
  }
  return {
    importacao: imp,
    substituidas: substituidas.length,
    banco,
    conta: `${leitura.conta}-${leitura.contaDv}`,
    titular: leitura.titular,
    mesReferencia: leitura.mesReferencia,
    periodo: leitura.periodo,
    qtd: rows.length,
    saldoInicial: leitura.saldoInicial,
    saldoFinal: leitura.saldoFinal,
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
    .map((l) => ({ ...l, valor: Number(l.valor), saldo_apos: l.saldo_apos == null ? null : Number(l.saldo_apos), tipo: Number(l.valor) > 0 ? 'ENTRADA' : 'SAIDA' }))
    .filter((l) => !tipos.length || tipos.includes(l.tipo))
    .filter((l) => !b || `${l.historico || ''} ${l.documento || ''} ${l.historico_codigo || ''} ${Math.abs(l.valor).toFixed(2).replace('.', ',')}`.toLowerCase().includes(b));
  const resumo = { entradas: 0, saidas: 0, qtdEntradas: 0, qtdSaidas: 0, qtd: filtrados.length };
  for (const l of filtrados) {
    if (l.valor > 0) {
      resumo.entradas = round2(resumo.entradas + l.valor);
      resumo.qtdEntradas++;
    } else {
      resumo.saidas = round2(resumo.saidas - l.valor);
      resumo.qtdSaidas++;
    }
  }
  resumo.resultado = round2(resumo.entradas - resumo.saidas);
  return { lancamentos: filtrados, resumo };
}

export default { importarExtrato, listarContas, listarLancamentos };
