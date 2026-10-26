// Leitura do export de manifestacoes do TOTVS (FISFP153), em CSV (;) ou Excel.
// O export com fatura vem do Excel com a chave de acesso e o CNPJ em notacao
// cientifica ("2,42606E+43"), entao a chave nao serve para casar. O que
// identifica a nota com seguranca e (codigo da empresa + NSU) e, como reserva,
// (codigo da empresa + numero da NF + serie).
// Cod.Empresa, Dt.Emissao, Chave, CnpjEmi, RazaoSocial, NrNf, Serie, Nsu,
// TpOperacao, TpSituacao, TpSituacaoMan, VlTotal, NrFatura, DtFatura
import * as XLSX from 'xlsx';

const COLUNAS = 14;
// O Excel salvo pela Niziany (26/10/2026) veio com dimensao A1:N1048477 (1 mi de
// linhas vazias); sem limite o SheetJS leva ~10 s varrendo XML vazio.
const MAX_LINHAS_XLSX = 200000;

const limpar = (v) => String(v ?? '').trim();

// Aceita "dd/mm/yyyy", "yyyy-mm-dd", Date ou serial do Excel (dias desde 1899-12-30)
export function paraIsoDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && isFinite(v)) {
    const ms = Math.round((v - 25569) * 86400 * 1000); // 25569 = 1970-01-01
    const d = new Date(ms);
    return isNaN(d) ? null : d.toISOString().slice(0, 10);
  }
  const s = limpar(v);
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  if (/^\d+(\.\d+)?$/.test(s)) return paraIsoDate(parseFloat(s));
  return null;
}

const inteiro = (v) => {
  if (typeof v === 'number') return isFinite(v) ? Math.trunc(v) : NaN;
  return parseInt(limpar(v), 10);
};

// Nr. Fatura pode vir numerico no Excel (731816) ou "731816.0"
const textoFatura = (v) => {
  if (v == null) return '';
  if (typeof v === 'number') return isFinite(v) ? String(Math.trunc(v)) : '';
  const s = limpar(v);
  return /^\d+\.0+$/.test(s) ? s.split('.')[0] : s;
};

// Linhas ja separadas em colunas (sem o cabecalho). Compartilhado por CSV e Excel.
export function parseLinhasManifestacoes(linhas, primeiraLinhaNumero = 2) {
  const registros = [];
  const ignoradas = [];
  linhas.forEach((c, idx) => {
    const numeroLinha = primeiraLinhaNumero + idx;
    const empresa = inteiro(c[0]);
    const nsu = inteiro(c[7]);
    const nf = inteiro(c[5]);
    const serie = inteiro(c[6]);
    const fatura = textoFatura(c[12]);
    const dtFatura = paraIsoDate(c[13]);

    if (!empresa || (!nsu && !nf)) {
      ignoradas.push(numeroLinha);
      return;
    }
    registros.push({
      empresa,
      nsu: isNaN(nsu) ? null : nsu,
      nf: isNaN(nf) ? null : nf,
      serie: isNaN(serie) ? null : serie,
      nrFatura: fatura || null,
      dtFatura,
      escriturada: !!fatura,
    });
  });
  return { registros, ignoradas };
}

export function parseCsvManifestacoes(texto) {
  const linhas = String(texto).split(/\r?\n/).filter((l) => l.trim());
  const colunas = [];
  for (let i = 1; i < linhas.length; i++) {
    let c = linhas[i].split(';');
    // O export termina cada linha com ';', o que deixa um campo vazio no fim
    if (c.length && c[c.length - 1] === '') c.pop();
    // Linhas com ';' extra dentro da razao social: funde as colunas excedentes
    if (c.length > COLUNAS) {
      const extra = c.length - COLUNAS;
      c = [...c.slice(0, 4), c.slice(4, 5 + extra).join(';'), ...c.slice(5 + extra)];
    }
    colunas.push(c);
  }
  return parseLinhasManifestacoes(colunas, 2);
}

// Excel (.xlsx/.xls) salvo a partir do export do TOTVS: mesmas 14 colunas, na
// mesma ordem; datas como serial do Excel, NSU/NF/fatura numericos.
export function parseXlsxManifestacoes(buffer) {
  const wb = XLSX.read(buffer, {
    type: 'buffer',
    sheetRows: MAX_LINHAS_XLSX,
    cellDates: false,
    cellStyles: false,
    cellNF: false,
    cellHTML: false,
    cellText: false,
  });
  const nome = wb.SheetNames[0];
  const ws = nome ? wb.Sheets[nome] : null;
  if (!ws) return { registros: [], ignoradas: [] };
  const rows = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: true,
    blankrows: false,
    defval: null,
  });
  if (!rows.length) return { registros: [], ignoradas: [] };
  // Pula o cabecalho se a 1a celula nao for o codigo da empresa
  const temCabecalho = isNaN(inteiro(rows[0][0]));
  const dados = temCabecalho ? rows.slice(1) : rows;
  return parseLinhasManifestacoes(dados, temCabecalho ? 2 : 1);
}

const ehZip = (b) => b && b.length > 3 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const ehOle = (b) => b && b.length > 7 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;

// Detecta pelo conteudo (e pelo nome, como reserva) e escolhe o leitor.
export function parseArquivoManifestacoes(buffer, nomeArquivo = '') {
  const nome = String(nomeArquivo || '').toLowerCase();
  if (ehZip(buffer) || ehOle(buffer) || /\.xlsx?$/.test(nome)) {
    return { formato: 'xlsx', ...parseXlsxManifestacoes(buffer) };
  }
  // O export CSV do TOTVS vem em ISO-8859-1
  return { formato: 'csv', ...parseCsvManifestacoes(buffer.toString('latin1')) };
}

export default { parseCsvManifestacoes, parseXlsxManifestacoes, parseArquivoManifestacoes, paraIsoDate };
