// ─────────────────────────────────────────────────────────────────────────
// Painel de Impostos (aba Fiscal) — apuração de ICMS por empresa/mês.
//
//   - Provisão: estimativa pelas notas do TOTVS (ICMS das saídas − das entradas)
//   - Realizado: importação do SPED EFD ICMS/IPI (registro E110, saldo a recolher)
//
// Empresas do painel = filiais (regra do FiltroEmpresa: cd_empresa < 5999 e
// fora dos códigos de franquia 98/980), lidas de /person/v2/branchesList.
//
// Tabela: fiscal_imposto_apuracao (migrations/fiscal_imposto_apuracao.sql),
// criada sob demanda via RPC exec_sql.
// ─────────────────────────────────────────────────────────────────────────
import axios from 'axios';
import supabase from '../config/supabase.js';
import { getToken } from '../utils/totvsTokenManager.js';
import { TOTVS_BASE_URL } from '../totvsrouter/totvsHelper.js';

const TABELA = 'fiscal_imposto_apuracao';
const FRANQUIA_CODES = new Set(['98', '980']);

export class MigrationPendingError extends Error {
  constructor(msg) {
    super(msg);
    this.code = 'MIGRATION_PENDING';
    this.status = 503;
  }
}

// ─── garante a tabela (exec_sql; mesmo padrão de services/erp/migrations.js) ──
let tabelaOk = false;
const DDL = `create table if not exists ${TABELA} (
  id bigint generated always as identity primary key,
  imposto text not null default 'ICMS',
  cd_empresa integer not null,
  nm_empresa text,
  cnpj text,
  ano integer not null,
  mes integer not null check (mes between 1 and 12),
  valor numeric(15,2) not null default 0,
  origem text not null check (origem in ('provisao','realizado')),
  detalhe jsonb,
  atualizado_por text,
  atualizado_em timestamptz not null default now(),
  unique (imposto, cd_empresa, ano, mes)
);`;

async function aplicarSql(sql) {
  let { error } = await supabase.rpc('exec_sql', { query: sql });
  if (error && /exec_sql\(query\)/.test(error.message || '')) {
    ({ error } = await supabase.rpc('exec_sql', { sql }));
  }
  return error;
}

async function garantirTabela() {
  if (tabelaOk) return;
  const { error } = await supabase.from(TABELA).select('id').limit(1);
  if (!error) {
    tabelaOk = true;
    return;
  }
  const relnaoexiste = /relation .* does not exist|could not find the table|schema cache/i.test(error.message || '');
  if (!relnaoexiste) return; // outro erro (RLS etc.) — deixa estourar depois
  const errDdl = await aplicarSql(DDL);
  if (errDdl) {
    throw new MigrationPendingError(
      `Tabela ${TABELA} não existe e não consegui criar automaticamente — rode migrations/fiscal_imposto_apuracao.sql no SQL Editor do Supabase. Detalhe: ${errDdl.message}`,
    );
  }
  tabelaOk = true;
}

// ─── empresas (filiais) ──────────────────────────────────────────────────
let cacheFiliais = { data: null, ate: 0 };
export async function listarFiliais() {
  if (cacheFiliais.data && cacheFiliais.ate > Date.now()) return cacheFiliais.data;
  const tokenData = await getToken();
  const url = `${TOTVS_BASE_URL}/person/v2/branchesList?BranchCodePool=1&Page=1&PageSize=1000`;
  const { data } = await axios.get(url, {
    headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: 'application/json' },
    timeout: 30000,
  });
  const items = data?.items || data?.data || [];
  const filiais = items
    .map((b) => ({
      cd_empresa: Number(b.code ?? b.branchCode ?? b.cd_empresa),
      nm_empresa: b.name || b.branchName || b.fantasyName || b.nm_grupoempresa || `Filial ${b.code}`,
      cnpj: String(b.cnpj || b.cgc || '').replace(/\D/g, '') || null,
    }))
    .filter((f) => Number.isFinite(f.cd_empresa) && f.cd_empresa < 5999 && !FRANQUIA_CODES.has(String(f.cd_empresa)))
    .sort((a, b) => a.cd_empresa - b.cd_empresa);
  cacheFiliais = { data: filiais, ate: Date.now() + 10 * 60 * 1000 };
  return filiais;
}

// ─── provisão (notas do TOTVS) ─────────────────────────────────────────────
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const ultimoDia = (ano, mes) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();

// Classifica a nota em entrada (crédito) ou saída (débito). Tolerante aos
// vários formatos que o TOTVS devolve em operationType/operationName/origin.
function direcao(item) {
  const t = String(item.operationType || '').trim().toUpperCase();
  if (t === 'E' || t === 'ENTRADA' || t === 'I' || t === 'INPUT') return 'entrada';
  if (t === 'S' || t === 'SAIDA' || t === 'SAÍDA' || t === 'O' || t === 'OUTPUT') return 'saida';
  const nome = String(item.operationName || item.operatioName || '').toUpperCase();
  if (nome.includes('ENTRADA') || nome.includes('COMPRA') || nome.includes('DEVOL') && nome.includes('VENDA')) return 'entrada';
  if (nome.includes('SAIDA') || nome.includes('SAÍDA') || nome.includes('VENDA')) return 'saida';
  const o = String(item.origin || '').toUpperCase();
  if (o.includes('ENTRAD')) return 'entrada';
  if (o.includes('SAID') || o.includes('SAÍD')) return 'saida';
  return 'saida'; // varejo: maioria é venda; registra como débito por padrão
}

async function buscarNotasTotvs(cdEmpresa, ano, mes) {
  const tokenData = await getToken();
  const ini = `${ano}-${String(mes).padStart(2, '0')}-01T00:00:00`;
  const fim = `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDia(ano, mes)).padStart(2, '0')}T23:59:59`;
  const endpoint = `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`;
  const pageSize = 200;
  const MAX_PAGES = 60; // teto de segurança
  let page = 1;
  let token = tokenData.access_token;
  const notas = [];
  for (; page <= MAX_PAGES; page++) {
    const body = {
      filter: { branchCodeList: [cdEmpresa], startIssueDate: ini, endIssueDate: fim },
      page,
      pageSize,
      expand: 'person',
    };
    let resp;
    try {
      resp = await axios.post(endpoint, body, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        timeout: 45000,
      });
    } catch (err) {
      if (err.response?.status === 401) {
        token = (await getToken(true)).access_token;
        page--;
        continue;
      }
      throw new Error(`TOTVS invoices/search: ${err.response?.data?.message || err.message}`);
    }
    const items = resp.data?.items || [];
    notas.push(...items);
    const totalPages = resp.data?.totalPages || 1;
    if (page >= totalPages || items.length === 0) break;
  }
  return notas;
}

// Calcula e persiste a provisão de ICMS de uma empresa/mês.
export async function calcularProvisao({ cdEmpresa, ano, mes, por = 'sistema' }) {
  await garantirTabela();
  const filiais = await listarFiliais();
  const filial = filiais.find((f) => f.cd_empresa === Number(cdEmpresa));
  if (!filial) throw Object.assign(new Error(`Empresa ${cdEmpresa} não é uma filial do grupo`), { status: 400 });

  // não sobrescreve um realizado já importado
  const { data: atual } = await supabase.from(TABELA).select('origem').match({ imposto: 'ICMS', cd_empresa: Number(cdEmpresa), ano: Number(ano), mes: Number(mes) }).maybeSingle();
  if (atual?.origem === 'realizado') {
    return { pulado: true, motivo: 'já tem SPED realizado', cd_empresa: Number(cdEmpresa), ano, mes };
  }

  const notas = await buscarNotasTotvs(Number(cdEmpresa), Number(ano), Number(mes));
  let debito = 0;
  let credito = 0;
  for (const n of notas) {
    const icms = num(n.icmsValue ?? n.icms_value);
    if (!icms) continue;
    if (direcao(n) === 'entrada') credito += icms;
    else debito += icms;
  }
  debito = Math.round(debito * 100) / 100;
  credito = Math.round(credito * 100) / 100;
  const saldo = Math.round(Math.max(debito - credito, 0) * 100) / 100;

  const row = {
    imposto: 'ICMS',
    cd_empresa: Number(cdEmpresa),
    nm_empresa: filial.nm_empresa,
    cnpj: filial.cnpj,
    ano: Number(ano),
    mes: Number(mes),
    valor: saldo,
    origem: 'provisao',
    detalhe: { debito, credito, saldo, notas: notas.length, calculado_em: new Date().toISOString() },
    atualizado_por: por,
    atualizado_em: new Date().toISOString(),
  };
  const { error } = await supabase.from(TABELA).upsert(row, { onConflict: 'imposto,cd_empresa,ano,mes' });
  if (error) throw new Error(`Falha ao salvar provisão: ${error.message}`);
  return { ...row };
}

// Calcula a provisão de todas as filiais para um mês (sequencial — respeita o TOTVS).
export async function calcularProvisaoMes({ ano, mes, por = 'sistema' }) {
  const filiais = await listarFiliais();
  const resultados = [];
  for (const f of filiais) {
    try {
      const r = await calcularProvisao({ cdEmpresa: f.cd_empresa, ano, mes, por });
      resultados.push({ cd_empresa: f.cd_empresa, ok: true, valor: r.valor, pulado: r.pulado || false });
    } catch (e) {
      resultados.push({ cd_empresa: f.cd_empresa, ok: false, erro: e.message });
    }
  }
  return { ano: Number(ano), mes: Number(mes), filiais: resultados };
}

// ─── SPED EFD ICMS/IPI (realizado) ─────────────────────────────────────────
// Lê o arquivo texto (pipe-delimited). Registro 0000 traz CNPJ e período;
// E110 traz a apuração do ICMS (saldo devedor a recolher).
export function parseSpedEfd(conteudo) {
  const linhas = String(conteudo).split(/\r?\n/);
  const blocos = [];
  let atual = null;
  for (const linha of linhas) {
    if (!linha.includes('|')) continue;
    const campos = linha.split('|');
    const reg = campos[1];
    if (reg === '0000') {
      // layout EFD ICMS/IPI: |0000|COD_VER|COD_FIN|DT_INI|DT_FIN|NOME|CNPJ|CPF|UF|IE|COD_MUN|IM|SUFRAMA|IND_PERFIL|IND_ATIV|
      const dtIni = campos[4] || '';
      const cnpj = (campos[7] || '').replace(/\D/g, '');
      const nome = campos[6] || '';
      const mes = Number(dtIni.slice(2, 4));
      const ano = Number(dtIni.slice(4, 8));
      atual = { cnpj, nome, ano, mes, e110: null };
      blocos.push(atual);
    } else if (reg === 'E110' && atual) {
      // |E110|VL_TOT_DEBITOS|VL_AJ_DEBITOS|VL_TOT_AJ_DEBITOS|VL_ESTORNOS_CRED|VL_TOT_CREDITOS|VL_AJ_CREDITOS|VL_TOT_AJ_CREDITOS|VL_ESTORNOS_DEB|VL_SLD_CREDOR_ANT|VL_SLD_APURADO|VL_TOT_DED|VL_ICMS_RECOLHER|VL_SLD_CREDOR_TRANSPORTAR|DEB_ESP|
      const n = (i) => {
        const v = String(campos[i] ?? '').replace(/\./g, '').replace(',', '.');
        const x = Number(v);
        return Number.isFinite(x) ? x : 0;
      };
      atual.e110 = {
        total_debitos: n(2),
        total_creditos: n(6),
        saldo_apurado: n(11),
        icms_recolher: n(13),
        saldo_credor_transportar: n(14),
      };
    }
  }
  return blocos.filter((b) => b.cnpj && b.ano && b.mes);
}

export async function importarSped({ conteudo, nomeArquivo = 'sped.txt', por = 'sistema' }) {
  await garantirTabela();
  const blocos = parseSpedEfd(conteudo);
  if (!blocos.length) throw Object.assign(new Error('Arquivo não parece um SPED EFD ICMS/IPI válido (não achei registro 0000).'), { status: 400 });
  const filiais = await listarFiliais();
  const porCnpj = new Map(filiais.map((f) => [f.cnpj, f]));
  const resultados = [];
  for (const b of blocos) {
    const filial = porCnpj.get(b.cnpj);
    if (!filial) {
      resultados.push({ cnpj: b.cnpj, nome: b.nome, ano: b.ano, mes: b.mes, ok: false, erro: 'CNPJ não é filial do grupo (fora do painel)' });
      continue;
    }
    if (!b.e110) {
      resultados.push({ cd_empresa: filial.cd_empresa, ano: b.ano, mes: b.mes, ok: false, erro: 'Sem registro E110 (apuração de ICMS) no arquivo' });
      continue;
    }
    // ICMS a recolher: usa VL_ICMS_RECOLHER; se zero, cai no saldo apurado devedor
    const valor = Math.round((b.e110.icms_recolher || b.e110.saldo_apurado || 0) * 100) / 100;
    const row = {
      imposto: 'ICMS',
      cd_empresa: filial.cd_empresa,
      nm_empresa: filial.nm_empresa,
      cnpj: b.cnpj,
      ano: b.ano,
      mes: b.mes,
      valor,
      origem: 'realizado',
      detalhe: { sped: b.e110, arquivo: nomeArquivo, importado_em: new Date().toISOString() },
      atualizado_por: por,
      atualizado_em: new Date().toISOString(),
    };
    const { error } = await supabase.from(TABELA).upsert(row, { onConflict: 'imposto,cd_empresa,ano,mes' });
    if (error) resultados.push({ cd_empresa: filial.cd_empresa, ano: b.ano, mes: b.mes, ok: false, erro: error.message });
    else resultados.push({ cd_empresa: filial.cd_empresa, nm_empresa: filial.nm_empresa, ano: b.ano, mes: b.mes, ok: true, valor });
  }
  return { periodos: blocos.length, resultados };
}

// ─── painel ────────────────────────────────────────────────────────────────
export async function listarPainel({ ano, imposto = 'ICMS' }) {
  await garantirTabela();
  const [filiais, { data, error }] = await Promise.all([
    listarFiliais(),
    supabase.from(TABELA).select('*').match({ imposto, ano: Number(ano) }),
  ]);
  if (error) throw new Error(`Falha ao ler apuração: ${error.message}`);
  const porChave = new Map((data || []).map((r) => [`${r.cd_empresa}-${r.mes}`, r]));
  const linhas = filiais.map((f) => {
    const meses = {};
    for (let m = 1; m <= 12; m++) {
      const r = porChave.get(`${f.cd_empresa}-${m}`);
      meses[m] = r ? { valor: Number(r.valor), origem: r.origem, detalhe: r.detalhe, atualizado_em: r.atualizado_em } : null;
    }
    const total = Object.values(meses).reduce((s, c) => s + (c ? c.valor : 0), 0);
    return { cd_empresa: f.cd_empresa, nm_empresa: f.nm_empresa, cnpj: f.cnpj, meses, total: Math.round(total * 100) / 100 };
  });
  // totais por mês
  const totaisMes = {};
  for (let m = 1; m <= 12; m++) {
    totaisMes[m] = Math.round(linhas.reduce((s, l) => s + (l.meses[m] ? l.meses[m].valor : 0), 0) * 100) / 100;
  }
  const totalGeral = Math.round(linhas.reduce((s, l) => s + l.total, 0) * 100) / 100;
  return { ano: Number(ano), imposto, linhas, totaisMes, totalGeral };
}
