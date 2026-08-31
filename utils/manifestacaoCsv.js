// Leitura do CSV de manifestacoes exportado do TOTVS (FISFP153).
// O export com fatura vem do Excel com a chave de acesso e o CNPJ em notacao
// cientifica ("2,42606E+43"), entao a chave nao serve para casar. O que
// identifica a nota com seguranca e (codigo da empresa + NSU) e, como reserva,
// (codigo da empresa + numero da NF + serie).
// Cod.Empresa, Dt.Emissao, Chave, CnpjEmi, RazaoSocial, NrNf, Serie, Nsu,
// TpOperacao, TpSituacao, TpSituacaoMan, VlTotal, NrFatura, DtFatura
const COLUNAS = 14;

const limpar = (v) => String(v ?? '').trim();

export function parseCsvManifestacoes(texto) {
  const linhas = String(texto).split(/\r?\n/).filter((l) => l.trim());
  const registros = [];
  const ignoradas = [];

  for (let i = 1; i < linhas.length; i++) {
    let c = linhas[i].split(';');

    // O export termina cada linha com ';', o que deixa um campo vazio no fim
    if (c.length && c[c.length - 1] === '') c.pop();

    // Linhas com ';' extra dentro da razao social: funde as colunas excedentes
    if (c.length > COLUNAS) {
      const extra = c.length - COLUNAS;
      c = [...c.slice(0, 4), c.slice(4, 5 + extra).join(';'), ...c.slice(5 + extra)];
    }

    const empresa = parseInt(limpar(c[0]));
    const nsu = parseInt(limpar(c[7]));
    const nf = parseInt(limpar(c[5]));
    const serie = parseInt(limpar(c[6]));
    const fatura = limpar(c[12]);
    const dtFatura = limpar(c[13]);

    if (!empresa || (!nsu && !nf)) {
      ignoradas.push(i + 1);
      continue;
    }

    const [dd, mm, yyyy] = (dtFatura || '').split('/');
    registros.push({
      empresa,
      nsu: isNaN(nsu) ? null : nsu,
      nf: isNaN(nf) ? null : nf,
      serie: isNaN(serie) ? null : serie,
      nrFatura: fatura || null,
      dtFatura: yyyy ? `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}` : null,
      escriturada: !!fatura,
    });
  }

  return { registros, ignoradas };
}

export default { parseCsvManifestacoes };
