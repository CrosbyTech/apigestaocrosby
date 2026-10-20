// ─────────────────────────────────────────────────────────────────────────
// Importador de observações dos lançamentos do DRE a partir de planilha.
//
// Alvo: tabela Supabase `observacoes_despesas_totvs` (a mesma que o DRE lê),
// chave de um lançamento = cd_empresa + cd_despesaitem + cd_fornecedor +
// nr_duplicata + nr_parcela, escopada por período (dt_inicio/dt_fim) e
// is_active = true.
//
// Fluxo seguro em 2 passos:
//   preview(buffer)            → só analisa a planilha, não grava nada
//   importar(buffer, período)  → grava as observações das linhas prontas
//
// As colunas da planilha são detectadas pelos cabeçalhos (tolerante a
// acento/caixa). Quando a planilha real da Niziany chegar, o preview mostra
// o mapeamento detectado e o que falta — aí ajustamos se necessário.
// ─────────────────────────────────────────────────────────────────────────
import * as XLSX from 'xlsx';
import supabase from '../config/supabase.js';

const TABELA = 'observacoes_despesas_totvs';

const norm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

// sinônimos de cabeçalho → campo canônico
const MAPA_COLUNAS = [
  ['cd_empresa', ['cd_empresa', 'empresa', 'cod empresa', 'codigo empresa', 'filial', 'cd_filial']],
  ['cd_despesaitem', ['cd_despesaitem', 'despesaitem', 'item de despesa', 'item despesa', 'cod despesa', 'codigo despesa', 'despesa item', 'cd_despesa']],
  ['cd_fornecedor', ['cd_fornecedor', 'cod fornecedor', 'codigo fornecedor', 'cd_pessoa', 'cod pessoa']],
  ['fornecedor_nome', ['fornecedor', 'nome fornecedor', 'razao social', 'nm_fornecedor', 'nome']],
  ['nr_duplicata', ['nr_duplicata', 'duplicata', 'documento', 'nr documento', 'numero documento', 'nota', 'nf', 'titulo']],
  ['nr_parcela', ['nr_parcela', 'parcela', 'parc']],
  ['observacao', ['observacao', 'observacoes', 'obs', 'comentario', 'comentarios', 'descricao obs', 'nota interna']],
];

function detectarColunas(headers) {
  const mapa = {};
  const usados = new Set();
  headers.forEach((h, idx) => {
    const n = norm(h);
    for (const [campo, nomes] of MAPA_COLUNAS) {
      if (mapa[campo] != null) continue;
      if (nomes.some((x) => n === x || n.includes(x))) {
        mapa[campo] = idx;
        usados.add(idx);
        break;
      }
    }
  });
  return mapa;
}

const inteiro = (v) => {
  const s = String(v ?? '').replace(/\D/g, '');
  return s ? Number(s) : null;
};
const textoChave = (v) => {
  const s = String(v ?? '').trim();
  return s || null;
};

// Lê a planilha (primeira aba) e normaliza as linhas.
export function parsePlanilha(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const aba = wb.SheetNames[0];
  const matriz = XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, blankrows: false, defval: '' });
  if (!matriz.length) return { headers: [], mapa: {}, linhas: [] };
  const headers = matriz[0].map((h) => String(h).trim());
  const mapa = detectarColunas(headers);
  const col = (linha, campo) => (mapa[campo] != null ? linha[mapa[campo]] : undefined);

  const linhas = matriz.slice(1).map((linha, i) => {
    const r = {
      linha: i + 2, // nº da linha na planilha (1 = cabeçalho)
      cd_empresa: inteiro(col(linha, 'cd_empresa')),
      cd_despesaitem: inteiro(col(linha, 'cd_despesaitem')),
      cd_fornecedor: inteiro(col(linha, 'cd_fornecedor')),
      fornecedor_nome: textoChave(col(linha, 'fornecedor_nome')),
      nr_duplicata: textoChave(col(linha, 'nr_duplicata')),
      nr_parcela: inteiro(col(linha, 'nr_parcela')),
      observacao: textoChave(col(linha, 'observacao')),
    };
    const faltam = [];
    if (!r.observacao) faltam.push('observacao');
    if (r.cd_empresa == null) faltam.push('cd_empresa');
    if (r.nr_duplicata == null) faltam.push('nr_duplicata');
    if (r.cd_fornecedor == null) faltam.push('cd_fornecedor');
    if (r.cd_despesaitem == null) faltam.push('cd_despesaitem');
    r._faltam = faltam;
    r._pronta = faltam.length === 0;
    return r;
  });
  return { headers, mapa, linhas };
}

// Analisa a planilha sem gravar nada.
export function preview(buffer) {
  const { headers, mapa, linhas } = parsePlanilha(buffer);
  const prontas = linhas.filter((l) => l._pronta);
  const semObs = linhas.filter((l) => !l.observacao);
  const incompletas = linhas.filter((l) => l.observacao && !l._pronta);
  const camposDetectados = Object.keys(mapa);
  const faltamColunas = ['cd_empresa', 'cd_despesaitem', 'cd_fornecedor', 'nr_duplicata', 'nr_parcela', 'observacao'].filter((c) => mapa[c] == null);
  return {
    cabecalhos: headers,
    colunas_detectadas: camposDetectados,
    colunas_faltando: faltamColunas, // para montar a chave do lançamento
    total_linhas: linhas.length,
    prontas: prontas.length,
    sem_observacao: semObs.length,
    incompletas: incompletas.length,
    amostra_prontas: prontas.slice(0, 5),
    amostra_incompletas: incompletas.slice(0, 5).map((l) => ({ linha: l.linha, faltam: l._faltam, fornecedor: l.fornecedor_nome, duplicata: l.nr_duplicata })),
    observacao: faltamColunas.length
      ? `A planilha precisa de colunas para: ${faltamColunas.join(', ')}. Hoje a chave de um lançamento no DRE é cd_empresa + cd_despesaitem + cd_fornecedor + nr_duplicata + nr_parcela.`
      : 'Todas as colunas-chave foram detectadas.',
  };
}

// Grava as observações das linhas prontas. Idempotente: não duplica uma
// observação igual já existente para o mesmo lançamento/período.
export async function importar({ buffer, dtInicio, dtFim, por = 'import-planilha', substituir = false }) {
  if (!dtInicio || !dtFim) throw Object.assign(new Error('Informe o período (dt_inicio e dt_fim) do DRE — ex.: 2026-09-01 e 2026-09-30.'), { status: 400 });
  const { linhas } = parsePlanilha(buffer);
  const prontas = linhas.filter((l) => l._pronta);
  if (!prontas.length) throw Object.assign(new Error('Nenhuma linha pronta (faltam colunas-chave ou a observação). Rode o preview primeiro.'), { status: 400 });

  const resultados = { gravadas: 0, puladas: 0, erros: 0, detalhe: [] };
  for (const l of prontas) {
    const chave = {
      cd_empresa: l.cd_empresa,
      cd_despesaitem: l.cd_despesaitem,
      cd_fornecedor: l.cd_fornecedor,
      nr_duplicata: l.nr_duplicata,
      nr_parcela: l.nr_parcela,
      dt_inicio: dtInicio,
      dt_fim: dtFim,
    };
    try {
      const { data: existentes, error: errSel } = await supabase
        .from(TABELA)
        .select('id, observacao, is_active')
        .match({ ...chave, is_active: true });
      if (errSel) throw new Error(errSel.message);

      if (existentes && existentes.length) {
        const igual = existentes.find((e) => String(e.observacao).trim() === l.observacao);
        if (igual) {
          resultados.puladas++;
          resultados.detalhe.push({ linha: l.linha, status: 'ja_existe' });
          continue;
        }
        if (!substituir) {
          resultados.puladas++;
          resultados.detalhe.push({ linha: l.linha, status: 'tem_outra_obs (use substituir=true p/ adicionar)' });
          continue;
        }
      }

      // só colunas conhecidas da tabela (observacoes_despesas_totvs)
      const { error: errIns } = await supabase.from(TABELA).insert({
        ...chave,
        observacao: l.observacao,
        is_active: true,
      });
      if (errIns) throw new Error(errIns.message);
      resultados.gravadas++;
      resultados.detalhe.push({ linha: l.linha, status: 'gravada' });
    } catch (e) {
      resultados.erros++;
      resultados.detalhe.push({ linha: l.linha, status: 'erro', erro: e.message });
    }
  }
  return resultados;
}
