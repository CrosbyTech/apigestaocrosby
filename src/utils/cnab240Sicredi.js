// ─────────────────────────────────────────────────────────────
//  Gerador de Remessa CNAB 240 — SICREDI (Banco 748)
//  Pagamento via PIX (Forma 45 — PIX Transferência)
//
//  Layout baseado no manual SICREDI v8.2 e no arquivo de amostra
//  PG240401.REM. Cada linha possui exatamente 240 caracteres.
// ─────────────────────────────────────────────────────────────

// Dados do beneficiário (Crosby) — vir do sample. Idealmente
// deve ser carregado de configurações no Supabase.
export const EMPRESA_SICREDI = {
  cnpj: '17177680000116',
  nome: 'CROSBY DISTRIBUICAO E CONFECCA',
  agencia: '02207',
  dvAgencia: '1',
  conta: '000000036733',
  dvConta: '8',
  convenio: '5BEK', // será preenchido para 20 posições
  endereco: {
    logradouro: 'R SAO JOSE',
    numero: '02189',
    complemento: '',
    cidade: 'NATAL',
    cep: '59063150',
    uf: 'RN',
  },
};

// ─── Helpers ────────────────────────────────────────────────
const padL = (v, n, c = '0') =>
  String(v ?? '')
    .slice(0, n)
    .padStart(n, c);
const padR = (v, n, c = ' ') =>
  String(v ?? '')
    .slice(0, n)
    .padEnd(n, c);
const onlyDigits = (s) => String(s ?? '').replace(/\D/g, '');
const semAcento = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
const clean = (s) =>
  semAcento(s)
    .toUpperCase()
    .replace(/[^A-Z0-9 ./]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const fmtDataDDMMYYYY = (d) => {
  if (!d) return '00000000';
  const dt = typeof d === 'string' ? new Date(d + 'T00:00:00') : new Date(d);
  if (isNaN(dt.getTime())) return '00000000';
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yy = String(dt.getFullYear());
  return `${dd}${mm}${yy}`;
};

const fmtHoraHHMMSS = (d = new Date()) =>
  `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;

const valorCentavos = (v) => Math.round(parseFloat(v || 0) * 100);

// Detecta o tipo de chave PIX e retorna { tipoChave, valorChave }
// Códigos SICREDI: 01=Telefone, 02=Email, 03=CPF/CNPJ, 04=Chave Aleatória
export function detectarChavePix(chave) {
  const k = String(chave || '').trim();
  if (!k) return { tipo: '00', valor: '', cpfCnpj: '' };
  const d = onlyDigits(k);
  if (/^[\w.+-]+@[\w.-]+\.\w{2,}$/.test(k))
    return { tipo: '02', valor: k.toLowerCase(), cpfCnpj: '' };
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k))
    return { tipo: '04', valor: k.toLowerCase(), cpfCnpj: '' };
  if (d.length === 11) return { tipo: '03', valor: d, cpfCnpj: d };
  if (d.length === 14) return { tipo: '03', valor: d, cpfCnpj: d };
  if (d.length >= 10 && d.length <= 13)
    return {
      tipo: '01',
      valor: d.startsWith('55') ? `+${d}` : `+55${d}`,
      cpfCnpj: '',
    };
  return { tipo: '00', valor: k, cpfCnpj: '' };
}

// ─── Header de Arquivo (tipo 0) ─────────────────────────────
function gerarHeaderArquivo(empresa, seqArquivo, dataGeracao) {
  const linha =
    '748' + // 1-3   banco
    '0000' + // 4-7   lote
    '0' + // 8     tipo
    padR('', 9) + // 9-17  FEBRABAN
    '2' + // 18    tipo insc (CNPJ)
    padL(empresa.cnpj, 14) + // 19-32 CNPJ
    padR(empresa.convenio, 20) + // 33-52 convênio
    padL(empresa.agencia, 5) + // 53-57 agência
    padL(empresa.dvAgencia, 1) + // 58    DV
    padL(empresa.conta, 12) + // 59-70 conta
    padL(empresa.dvConta, 1) + // 71    DV conta
    padR('', 1) + // 72    DV ag/conta
    padR(clean(empresa.nome), 30) + // 73-102 nome empresa
    padR('SICREDI', 30) + // 103-132 nome banco
    padR('', 10) + // 133-142 FEBRABAN
    '1' + // 143 cód remessa
    fmtDataDDMMYYYY(dataGeracao) + // 144-151 data
    fmtHoraHHMMSS(dataGeracao) + // 152-157 hora
    padL(seqArquivo, 6) + // 158-163 seq arquivo
    '082' + // 164-166 versão layout
    '01600' + // 167-171 densidade
    padR('', 20) + // 172-191 reservado banco
    padR('', 20) + // 192-211 reservado empresa
    padR('', 29); // 212-240 uso exclusivo
  return linha.padEnd(240, ' ').slice(0, 240);
}

// ─── Header de Lote (tipo 1) — PIX Transferência ────────────
function gerarHeaderLote(empresa, nrLote) {
  const linha =
    '748' +
    padL(nrLote, 4) +
    '1' +
    'C' + // 9   tipo oper (crédito)
    '20' + // 10-11 tipo serv (pagamento fornecedor)
    '45' + // 12-13 forma lançamento (PIX Transferência)
    '042' + // 14-16 layout lote
    padR('', 1) + // 17 FEBRABAN
    '2' + // 18 tipo insc
    padL(empresa.cnpj, 14) +
    padR(empresa.convenio, 20) +
    padL(empresa.agencia, 5) +
    padL(empresa.dvAgencia, 1) +
    padL(empresa.conta, 12) +
    padL(empresa.dvConta, 1) +
    padR('', 1) + // DV ag/conta
    padR(clean(empresa.nome), 30) + // 73-102
    padR('', 40) + // 103-142 mensagem
    padR(clean(empresa.endereco.logradouro), 30) + // 143-172
    padL(empresa.endereco.numero, 5) + // 173-177
    padR(clean(empresa.endereco.complemento), 15) + // 178-192
    padR(clean(empresa.endereco.cidade), 20) + // 193-212
    padL(onlyDigits(empresa.endereco.cep), 8) + // 213-220
    padR(empresa.endereco.uf, 2) + // 221-222
    padR('', 8) + // 223-230 FEBRABAN
    padR('', 10); // 231-240 ocorrências
  return linha.padEnd(240, ' ').slice(0, 240);
}

// ─── Segmento A — dados do pagamento ────────────────────────
function gerarSegmentoA(nrLote, seqReg, titulo, dataPgto) {
  const vlCent = valorCentavos(titulo.vl_real ?? titulo.vl_duplicata);
  const linha =
    '748' +
    padL(nrLote, 4) +
    '3' +
    padL(seqReg, 5) +
    'A' +
    '000' + // 15-17 movimento (inclusão)
    '009' + // 18-20 câmara (009 = PIX)
    '000' + // 21-23 banco favorecido (não usado p/ PIX)
    padL('', 5) + // 24-28 ag fav
    '0' + // 29 DV
    padL('', 12) + // 30-41 conta fav
    padR('', 1) + // 42 DV
    padR('', 1) + // 43 DV ag/conta
    padR(clean(titulo.nm_fornecedor), 30) + // 44-73 nome fav
    padR(onlyDigits(titulo.nr_duplicata) || padL(seqReg, 20), 20) + // 74-93 nº doc empresa
    fmtDataDDMMYYYY(dataPgto) + // 94-101 data pgto
    'BRL' + // 102-104
    padL('0', 15) + // 105-119 quant moeda
    padL(vlCent, 15) + // 120-134 valor
    padR('', 15) + // 135-149 nº doc banco
    padL('0', 8) + // 150-157 data efetiva
    padL('0', 15) + // 158-172 valor real efetivo
    padR('', 20) + // 173-192 info 2
    padR('', 20) + // 193-212 info adicional
    padR('', 17) + // 213-229 reservado
    '0' + // 230 aviso favorecido
    padR('', 10); // 231-240 ocorr
  return linha.padEnd(240, ' ').slice(0, 240);
}

// ─── Segmento B — CPF/CNPJ + chave PIX do favorecido ────────
function gerarSegmentoB(nrLote, seqReg, titulo) {
  const info = detectarChavePix(titulo.chave_pix);
  // Se chave não é CPF/CNPJ, tenta extrair CPF/CNPJ do próprio nome/dados
  const cpfCnpj =
    info.cpfCnpj ||
    onlyDigits(titulo.dados_completos?.nr_cgcpessoa) ||
    onlyDigits(titulo.dados_completos?.cnpj) ||
    onlyDigits(titulo.dados_completos?.cpf) ||
    '';
  const tipoInsc = cpfCnpj.length === 11 ? '1' : '2';

  const linha =
    '748' +
    padL(nrLote, 4) +
    '3' +
    padL(seqReg, 5) +
    'B' +
    padR(info.tipo, 3) + // 15-17 tipo chave PIX (ex: "03 ")
    tipoInsc + // 18
    padL(cpfCnpj, 14) + // 19-32
    padR('', 30) + // 33-62 logradouro
    padR('', 5) + // 63-67 número
    padR('', 15) + // 68-82 complemento
    padR('', 15) + // 83-97 bairro
    padR('', 20) + // 98-117 cidade
    padR('', 8) + // 118-125 CEP
    padR('', 2) + // 126-127 UF
    padR('', 8) + // 128-135 data venc
    padR('', 15) + // 136-150 valor doc
    padR('', 15) + // 151-165 valor abat
    padR('', 15) + // 166-180 valor desc
    padR('', 15) + // 181-195 valor mora
    padR('', 15) + // 196-210 valor multa
    padR('', 15) + // 211-225 cód doc favorecido
    padR('', 15); // 226-240 uso exclusivo
  return linha.padEnd(240, ' ').slice(0, 240);
}

// ─── Trailer Lote (tipo 5) ──────────────────────────────────
function gerarTrailerLote(nrLote, qtdRegistros, somatorioCentavos) {
  const linha =
    '748' +
    padL(nrLote, 4) +
    '5' +
    padR('', 9) + // 9-17
    padL(qtdRegistros, 6) + // 18-23
    padL(somatorioCentavos, 18) + // 24-41
    padL('0', 18) + // 42-59 soma quantidade
    padL('0', 6) + // 60-65 nº aviso débito
    padR('', 165) + // 66-230
    padR('', 10); // 231-240
  return linha.padEnd(240, ' ').slice(0, 240);
}

// ─── Trailer Arquivo (tipo 9) ───────────────────────────────
function gerarTrailerArquivo(qtdLotes, qtdRegistros) {
  const linha =
    '748' +
    '9999' +
    '9' +
    padR('', 9) + // 9-17
    padL(qtdLotes, 6) + // 18-23
    padL(qtdRegistros, 6) + // 24-29
    padL('0', 6) + // 30-35 qt contas conciliação
    padR('', 205); // 36-240
  return linha.padEnd(240, ' ').slice(0, 240);
}

// ─── Gerador principal ──────────────────────────────────────
export function gerarArquivoRemessaSicredi(titulos, opcoes = {}) {
  if (!Array.isArray(titulos) || titulos.length === 0) {
    throw new Error('Nenhum título informado para gerar remessa.');
  }
  const empresa = opcoes.empresa || EMPRESA_SICREDI;
  const seqArquivo = opcoes.seqArquivo || 1;
  const nrLote = 1;
  const dataGeracao = opcoes.dataGeracao || new Date();
  const dataPagamento = opcoes.dataPagamento || new Date();

  const linhas = [];
  linhas.push(gerarHeaderArquivo(empresa, seqArquivo, dataGeracao));
  linhas.push(gerarHeaderLote(empresa, nrLote));

  let seqReg = 1;
  let somaCent = 0;
  for (const t of titulos) {
    linhas.push(gerarSegmentoA(nrLote, seqReg++, t, dataPagamento));
    linhas.push(gerarSegmentoB(nrLote, seqReg++, t));
    somaCent += valorCentavos(t.vl_real ?? t.vl_duplicata);
  }

  // trailer lote: qtd registros = header(1) + detalhes + trailer(1)
  const qtdRegLote = 2 + titulos.length * 2;
  linhas.push(gerarTrailerLote(nrLote, qtdRegLote, somaCent));

  // trailer arquivo: qtd total = header arq + header lote + detalhes + trailer lote + trailer arq
  const qtdRegArq = 4 + titulos.length * 2;
  linhas.push(gerarTrailerArquivo(1, qtdRegArq));

  // Valida 240 caracteres por linha
  linhas.forEach((l, i) => {
    if (l.length !== 240) {
      console.warn(`Linha ${i + 1} tem ${l.length} caracteres (esperado 240).`);
    }
  });

  return linhas.join('\r\n') + '\r\n';
}

// ─── Helper: nome do arquivo com sequencial auto-incrementado ──
// O sequencial reseta a cada novo dia e é persistido via localStorage.
export function proximoNomeArquivoRemessa() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const chave = `remessa_seq_${dd}${mm}`;

  const seq = (parseInt(localStorage.getItem(chave) || '0', 10) || 0) + 1;
  localStorage.setItem(chave, String(seq));

  const seqStr = String(seq).padStart(2, '0');
  return `PG${dd}${mm}${seqStr}.REM`;
}

// Mantido por compatibilidade retroativa
export function nomeArquivoRemessa(seq = 1) {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const seqStr = String(seq).padStart(2, '0');
  return `PG${dd}${mm}${seqStr}.REM`;
}
