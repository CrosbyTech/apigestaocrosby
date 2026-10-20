// ─────────────────────────────────────────────────────────────────────────
// Importa o HISTÓRICO de despesas (jan–ago) do HTML "Despesas Gerais 2026"
// (a ferramenta anterior) para o HeadCoach.
//
// O HTML embute, por mês, `const <MES>_DETAILS = { "CATEGORIA": [ {emp, forn,
// dupl, emis, venc, val, estag, obs}, ... ], ... }`. As observações estão no
// campo `obs` de cada lançamento.
//
// Grava as observações em observacoes_despesas_totvs com chave "leve"
// (cd_empresa + nr_duplicata; parcela/fornecedor/item = 0), por período. A DRE
// Analítica mostra essas observações casando por empresa|duplicata (fallback
// no store, além do rowId completo).
// ─────────────────────────────────────────────────────────────────────────
import supabase from '../config/supabase.js';

const MESES = {
  JAN: 1, FEV: 2, MAR: 3, ABR: 4, MAI: 5, JUN: 6, JUL: 7, AGO: 8,
};

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '') || null;

// Extrai o literal (objeto/array) de `const NOME = ...;` balanceando chaves.
function extrairConst(html, nome) {
  const i = html.indexOf(`const ${nome}`);
  if (i < 0) return null;
  const eq = html.indexOf('=', i);
  if (eq < 0) return null;
  let j = eq + 1;
  let depth = 0;
  let started = false;
  let emStr = false;
  let aspas = '';
  for (; j < html.length; j++) {
    const c = html[j];
    if (emStr) {
      if (c === '\\') {
        j++;
        continue;
      }
      if (c === aspas) emStr = false;
      continue;
    }
    if (c === '"' || c === "'") {
      emStr = true;
      aspas = c;
      continue;
    }
    if (c === '{' || c === '[') {
      depth++;
      started = true;
    } else if (c === '}' || c === ']') {
      depth--;
      if (started && depth === 0) {
        j++;
        break;
      }
    }
  }
  return html.slice(eq + 1, j).trim();
}

// Normaliza um literal JS para JSON válido SEM eval (arquivo é dado não
// confiável). Põe aspas nas chaves sem aspas (jan–jul vêm assim: {emp:"1"})
// e remove vírgulas finais, respeitando o conteúdo das strings.
function normalizarLiteral(str) {
  let out = '';
  let emStr = false;
  let asp = '';
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (emStr) {
      out += c;
      if (c === '\\') {
        out += str[++i] ?? '';
        continue;
      }
      if (c === asp) emStr = false;
      continue;
    }
    if (c === '"' || c === "'") {
      // normaliza aspas simples de string para aspas duplas
      emStr = true;
      asp = c;
      out += '"';
      continue;
    }
    // chave sem aspas: início de identificador logo após { , ou espaço,
    // seguido (após espaços) de ':'
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < str.length && /[A-Za-z0-9_$]/.test(str[j])) j++;
      let k = j;
      while (k < str.length && /\s/.test(str[k])) k++;
      if (str[k] === ':') {
        out += `"${str.slice(i, j)}"`;
        i = j - 1;
        continue;
      }
    }
    out += c;
  }
  // vírgulas finais antes de } ou ]
  return out.replace(/,(\s*[}\]])/g, '$1');
}

// Lê os <MES>_DETAILS e devolve os lançamentos com observação.
// [{ mes:1..8, emp, nr_duplicata, forn, val, obs }]
export function parseHistoricoHtml(html) {
  const registros = [];
  for (const [sigla, num] of Object.entries(MESES)) {
    const bruto = extrairConst(html, `${sigla}_DETAILS`);
    if (!bruto) continue;
    let detalhes;
    try {
      detalhes = JSON.parse(normalizarLiteral(bruto));
    } catch {
      continue;
    }
    for (const cat of Object.keys(detalhes)) {
      const linhas = Array.isArray(detalhes[cat]) ? detalhes[cat] : [];
      for (const l of linhas) {
        const obs = String(l.obs || '').trim();
        if (!obs) continue;
        const emp = Number(soDigitos(l.emp));
        const dup = soDigitos(l.dupl);
        if (!Number.isFinite(emp) || !dup) continue;
        registros.push({ mes: num, cat, emp, nr_duplicata: dup, forn: l.forn || null, val: Number(l.val) || 0, obs });
      }
    }
  }
  return registros;
}

const ultimoDia = (ano, mes) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();

// Importa as observações do histórico para o período de cada mês.
export async function importarHistorico({ html, ano = 2026, cdUsuario, substituir = false }) {
  if (!cdUsuario) throw Object.assign(new Error('cd_usuario é obrigatório.'), { status: 400 });
  const registros = parseHistoricoHtml(html);
  if (!registros.length) throw Object.assign(new Error('Não achei lançamentos com observação no HTML (const <MES>_DETAILS).'), { status: 400 });

  // dedup por empresa|duplicata|mes (chave leve); concatena obs distintas
  const porChave = new Map();
  for (const r of registros) {
    const k = `${r.emp}|${r.nr_duplicata}|${r.mes}`;
    if (!porChave.has(k)) porChave.set(k, { ...r, obsSet: new Set([r.obs]) });
    else porChave.get(k).obsSet.add(r.obs);
  }

  // agrupa por mês
  const porMes = new Map(); // mes -> [item]
  for (const item of porChave.values()) {
    if (!porMes.has(item.mes)) porMes.set(item.mes, []);
    porMes.get(item.mes).push(item);
  }

  const resultado = { meses: {}, gravadas: 0, puladas: 0, erros: 0, lancamentos: registros.length, chaves: porChave.size, amostraErros: [] };
  for (const [mes, itens] of porMes) {
    const dtInicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
    const dtFim = `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDia(ano, mes)).padStart(2, '0')}`;
    try {
      // já existentes nesse período (chave leve: parcela/fornecedor/item = 0)
      const { data: ex } = await supabase
        .from('observacoes_despesas_totvs')
        .select('cd_empresa,nr_duplicata')
        .match({ nr_parcela: 0, cd_fornecedor: 0, cd_despesaitem: 0, dt_inicio: dtInicio, dt_fim: dtFim, is_active: true });
      const jaTem = new Set((ex || []).map((e) => `${e.cd_empresa}|${e.nr_duplicata}`));
      const novos = itens
        .filter((it) => substituir || !jaTem.has(`${it.emp}|${it.nr_duplicata}`))
        .map((it) => ({
          cd_empresa: it.emp,
          nr_duplicata: it.nr_duplicata,
          nr_parcela: 0,
          cd_fornecedor: 0,
          cd_despesaitem: 0,
          dt_inicio: dtInicio,
          dt_fim: dtFim,
          observacao: [...it.obsSet].join(' | '),
          is_active: true,
          cd_usuario: cdUsuario,
        }));
      resultado.puladas += itens.length - novos.length;
      // insere em lotes
      for (let i = 0; i < novos.length; i += 200) {
        const lote = novos.slice(i, i + 200);
        const { error } = await supabase.from('observacoes_despesas_totvs').insert(lote);
        if (error) {
          resultado.erros += lote.length;
          if (resultado.amostraErros.length < 5) resultado.amostraErros.push(error.message);
        } else {
          resultado.gravadas += lote.length;
          resultado.meses[mes] = (resultado.meses[mes] || 0) + lote.length;
        }
      }
    } catch (e) {
      resultado.erros++;
      if (resultado.amostraErros.length < 5) resultado.amostraErros.push(e.message);
    }
  }
  return resultado;
}
