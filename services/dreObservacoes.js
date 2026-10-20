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

// normaliza p/ comparação: sem acento, minúsculo, só alfanumérico
// ("COD.DESP." → "coddesp", "NR.DUPL." → "nrdupl")
const norm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

// sinônimos de cabeçalho (já normalizados) → campo canônico.
// Cobre o formato exportado do Contas a Pagar (EMPRESA, COD.FORN., NR.DUPL.,
// PARCELA, COD.DESP., OBSERVACAO) e variações.
const MAPA_COLUNAS = [
  ['cd_empresa', ['cdempresa', 'empresa', 'codempresa', 'codigoempresa', 'filial', 'cdfilial']],
  ['cd_despesaitem', ['coddesp', 'cddespesaitem', 'despesaitem', 'coddespesa', 'codigodespesa', 'cddespesa', 'itemdespesa', 'itemdedespesa']],
  ['cd_fornecedor', ['codforn', 'cdfornecedor', 'codfornecedor', 'codigofornecedor', 'cdpessoa', 'codpessoa']],
  ['fornecedor_nome', ['nomefornecedor', 'fornecedor', 'razaosocial', 'nmfornecedor']],
  ['nr_duplicata', ['nrdupl', 'nrduplicata', 'duplicata', 'documento', 'nrdocumento', 'numerodocumento', 'titulo', 'nota', 'nf']],
  ['nr_parcela', ['nrparcela', 'parcela', 'parc']],
  ['observacao', ['observacao', 'observacoes', 'obs', 'comentario', 'comentarios', 'notainterna']],
];

function detectarColunas(headers) {
  const mapa = {};
  headers.forEach((h, idx) => {
    const n = norm(h);
    if (!n) return;
    for (const [campo, nomes] of MAPA_COLUNAS) {
      if (mapa[campo] != null) continue;
      // match exato primeiro; depois prefixo/contido (evita "nomefornecedor" cair em "fornecedor" antes da hora via ordem da lista)
      if (nomes.includes(n) || nomes.some((x) => n === x)) {
        mapa[campo] = idx;
        break;
      }
    }
  });
  // segunda passada: contidos, para cabeçalhos com texto extra
  headers.forEach((h, idx) => {
    const n = norm(h);
    if (!n) return;
    for (const [campo, nomes] of MAPA_COLUNAS) {
      if (mapa[campo] != null) continue;
      if (nomes.some((x) => n.includes(x))) {
        mapa[campo] = idx;
        break;
      }
    }
  });
  return mapa;
}

// código → inteiro ("005"→5, "6.023"→6023)
const inteiro = (v) => {
  const s = String(v ?? '').replace(/\D/g, '');
  return s ? Number(s) : null;
};
// duplicata → só dígitos, como o HeadCoach guarda ("2.209.202.601"→"2209202601")
const digitos = (v) => {
  const s = String(v ?? '').replace(/\D/g, '');
  return s || null;
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
      nr_duplicata: digitos(col(linha, 'nr_duplicata')),
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
export async function importar({ buffer, dtInicio, dtFim, cdUsuario, por = 'import-planilha', substituir = false }) {
  if (!cdUsuario) throw Object.assign(new Error('cd_usuario é obrigatório (a tabela exige um usuário dono da observação).'), { status: 400 });
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
        cd_usuario: cdUsuario,
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
