// ============================================================
// Extrato da Caixa Econômica Federal (Gerenciador CAIXA) em OFX — leitor
// novo, feito do zero (06/11/2026).
// ------------------------------------------------------------
// O PDF do Gerenciador CAIXA é desenho vetorial sem texto (não dá para ler),
// e o OFX do mesmo extrato traz exatamente os mesmos lançamentos, com sinal,
// mais o saldo final (LEDGERBAL). Dois formatos:
//   • jan–nov/2024: SGML numa linha só, <NAME>, DTPOSTED "20240102030000.000",
//     DTSTART/DTEND trocados, BRANCHID presente;
//   • dez/2024+: XML indentado, <MEMO> + <CHECKNUM>, DTPOSTED "20241202120000[-3:BRT]",
//     sem BRANCHID, DTASOF alguns dias depois do fim do mês.
// Pegadinhas:
//   • o extrato "do mês" vai até o 1º dia útil do mês seguinte (01/04 no de
//     março) e o mês seguinte repete esse dia → quem importa precisa descartar
//     o que já veio no arquivo anterior (feito no serviço, por conta e data);
//   • não há saldo linha a linha nem "saldo anterior": saldo inicial =
//     saldo final − soma dos lançamentos; a conferência é o encadeamento com
//     o mês anterior;
//   • o PDF mostra o saldo sem sinal (conta no cheque especial aparece
//     positiva); o OFX traz o sinal certo;
//   • os históricos são códigos curtos ("DP DIN LOT", "CRED PIX", "PREST
//     EMP", "TAR EXT EL") e não há contraparte.
// ============================================================
import crypto from 'node:crypto';

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const limpar = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const campo = (bloco, tag) => {
  const m = String(bloco).match(new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i'));
  return m ? limpar(m[1]) : null;
};
const dataOfx = (s) => {
  const m = String(s || '').match(/(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};
const ultimoDiaMes = (mes) => {
  const [a, m] = mes.split('-').map(Number);
  return `${mes}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

// Contas conhecidas (o OFX não traz titular nem CNPJ; vêm do cabeçalho do PDF)
export const CONTAS_CAIXA = {
  '0005781363862': { titular: 'CROSBY DISTRIBUICAO E CONF LTDA', cnpj: '17177680000116' },
  '0005781364591': { titular: 'FABIO FERREIRA DE LIMA AZEVEDO', cnpj: '27728810000115' },
  '0005781366357': { titular: 'IRMAOS CR VESTUARIO LTDA', cnpj: '33592092000103' },
};
// Banco do Brasil (BANKID 001): mesmo OFX, usado quando o PDF do mês é só imagem (ex.: Fabio jun/2025).
// Titulares como o leitor do PDF do BB grava (sem agência para Fabio/Irmãos).
export const CONTAS_BB = {
  '587117': { titular: 'CROSBY D CONFECCAO LTDA', cnpj: '17177680000116', agencia: '1533-4' },
  '369608': { titular: 'FABIO F LIMA AZEVEDO', cnpj: '27728810000115', agencia: null },
  '370517': { titular: 'IRMAOS C V LTDA', cnpj: '33592092000103', agencia: null },
};
// BNB (BANKID 004): ACCTID "699181" = 69918-1; agência sempre 035 (Natal Tirol). PEGADINHA: o LEDGERBAL/BALAMT do OFX do BNB
// é o saldo do INÍCIO do período (= "Saldo Anterior" do PDF), não o do fim; DTASOF é a data da exportação. Vários PDFs
// "no período" de 2025 vieram vazios ("Nenhuma movimentação") em meses com movimento → o OFX é a fonte certa nesses meses.
export const CONTAS_BNB = {
  '699181': { titular: 'CROSBY CR VESTUARIO LTDA', cnpj: '17177680000116' },
  '699190': { titular: 'CROSBY CR VESTUARIO LTDA', cnpj: '17177680000116' },
  '699211': { titular: 'FABIO FERREIRA DE LIMA AZEVEDO', cnpj: '27728810000115' },
  '699220': { titular: 'FABIO FERREIRA DE LIMA AZEVEDO', cnpj: '27728810000115' },
  '693612': { titular: 'IRMAOS CR VESTUARIO LTDA', cnpj: '33592092000103' },
  '693639': { titular: 'IRMAOS CR VESTUARIO LTDA', cnpj: '33592092000103' },
  // contas antigas (agência 185), usadas até 2023/2024
  '22863': { titular: 'CROSBY DISTRIBUICAO E CONFECCAO LTDA', cnpj: '17177680000116', agencia: '185' },
  '22871': { titular: 'CROSBY DISTRIBUICAO E CONFECCAO LTDA', cnpj: '17177680000116', agencia: '185' },
  '28241': { titular: 'FABIO FERREIRA DE LIMA AZEVEDO', cnpj: '27728810000115', agencia: '185' },
  '32281': { titular: 'FABIO FERREIRA DE LIMA AZEVEDO', cnpj: '27728810000115', agencia: '185' },
};
export const CONTAS_SICREDI_OFX = {
  '367338': { titular: 'CROSBY CR VESTUARIO LTDA', cnpj: '17177680000116' },
  '326933': { titular: 'FABIO FERREIRA DE LIMA AZEVEDO', cnpj: '27728810000115' },
  '367346': { titular: 'IRMAOS CR VESTUARIO LTDA', cnpj: '33592092000103' },
};
export const CONTAS_UNICRED_OFX = {
  '68500': { titular: 'CROSBY D CONFECCAO LTDA', cnpj: '17177680000116' },
  '70980': { titular: 'FABIO FERREIRA DE LIMA AZEVEDO', cnpj: '27728810000115' },
};
const BANCOS_OFX = {
  104: { banco: 'CAIXA', nome: 'da Caixa', contas: CONTAS_CAIXA },
  136: { banco: 'UNICRED', nome: 'da Unicred', contas: CONTAS_UNICRED_OFX, agencia: '6012' }, // ACCTID 68500 = 6850-0; BALAMT = saldo do fim do mês
  // Daycoval: ACCTID 0015165800; BALAMT em DTASOF = último dia do mês; titular não vem no OFX (conta da Crosby CR Vestuário: o Pix
  // que sai dela chega no Sicredi 36733 com o CNPJ 17.177.680/0001-16). Arquivo diz CHARSET 1252 mas é UTF-8.
  707: { banco: 'DAYCOVAL', nome: 'do Daycoval', contas: { '0015165800': { titular: 'CROSBY CR VESTUARIO LTDA', cnpj: '17177680000116' } }, agencia: null },
  748: { banco: 'SICREDI', nome: 'do Sicredi', contas: CONTAS_SICREDI_OFX, agencia: '2207', normalizarConta: (a) => a.replace(/^2207/, '').replace(/^0+/, '') },
  1: { banco: 'BB', nome: 'do Banco do Brasil', contas: CONTAS_BB },
  4: { banco: 'BNB', nome: 'do Banco do Nordeste', contas: CONTAS_BNB, agencia: '035', balamtInicial: true },
};

// Históricos da Caixa → o que são (para a tela e para o casamento de transferências). Usado também pelo leitor do PDF 2025.
export const HISTORICOS_CAIXA = {
  'DEPOSITO DINH LOTERICO': 'Depósito em dinheiro (lotérica)',
  'PIX RECEBIDO': 'Pix recebido',
  'DEB PIX CHAVE': 'Pix enviado',
  'TAR PIX': 'Tarifa Pix',
  'DEBITO PRESTACAO CDC': 'Prestação de empréstimo (CDC)',
  'DEB PREST CDC': 'Prestação de empréstimo (CDC)',
  'DEBITO PRESTA SIEMP': 'Prestação de empréstimo',
  'DEB PREST EMPRS SIAPI': 'Prestação de empréstimo',
  'DEBITO DE IOF': 'IOF',
  'COBRANCA DE JUROS': 'Juros cheque especial',
  'DEB JUROS DE MORA': 'Juros de mora',
  'MENSALIDADE CESTA SERVICO': 'Tarifa cesta de serviços',
  'DEBITO VR BENEFICIOS': 'Vale-refeição',
  'DEB TARIF MANUTENCAO': 'Tarifa de manutenção',
  'CRED PIX': 'Pix recebido',
  'ENVIO PIX': 'Pix enviado',
  'DEB PIX CH': 'Pix enviado',
  'CRED TEV': 'Transferência recebida (TEV)',
  'ENVIO TEV': 'Transferência enviada (TEV)',
  'ENVIO TED': 'TED enviada',
  'DOC/TED PE': 'TED/DOC recebido',
  TEDPESSOAL: 'TED enviada',
  'DP DIN LOT': 'Depósito em dinheiro (lotérica)',
  'DP DIN ENV': 'Depósito em dinheiro (envelope)',
  'DP DINH AG': 'Depósito em dinheiro (agência)',
  'DEP DIN AG': 'Depósito em dinheiro (agência)',
  'DP CX AQUI': 'Depósito (Caixa Aqui)',
  'PREST EMP': 'Prestação de empréstimo',
  'PREST EMPR': 'Prestação de empréstimo',
  'CR EMPREST': 'Crédito de empréstimo',
  'TAR EXT EL': 'Tarifa extrato eletrônico',
  'TAR SITEX': 'Tarifa',
  'DB CEST PJ': 'Tarifa cesta PJ',
  'DB T CESTA': 'Tarifa cesta',
  'DEB.IOF': 'IOF',
  'DEB IOF': 'IOF',
  'DEB.JUROS': 'Juros cheque especial',
  'DEB JUROS': 'Juros cheque especial',
  VR: 'Vale-refeição',
  'DEBITO VR': 'Vale-refeição',
  SEGURADORA: 'Seguro',
  'DB SEGUROS': 'Seguro',
  'VIDA PREVI': 'Seguro/previdência',
  'DEB.AUTOR.': 'Débito autorizado',
};

const HISTORICOS = HISTORICOS_CAIXA;

export function ehOfx(buffer) {
  const t = Buffer.isBuffer(buffer) ? buffer.subarray(0, 4000).toString('latin1') : String(buffer).slice(0, 4000);
  return /<OFX>/i.test(t) || /OFXHEADER/i.test(t);
}

/**
 * Lê o OFX da Caixa. Devolve o mesmo formato do leitor do BB.
 * @param {Buffer} buffer
 */
export function lerExtratoCaixaOfx(buffer) {
  return lerOfxBanco(buffer, 104);
}
export function lerExtratoBbOfx(buffer) {
  return lerOfxBanco(buffer, 1);
}
export function lerExtratoBnbOfx(buffer) {
  return lerOfxBanco(buffer, 4);
}
export function lerExtratoSicrediOfx(buffer) {
  return lerOfxBanco(buffer, 748);
}
export function lerExtratoUnicredOfx(buffer) {
  return lerOfxBanco(buffer, 136);
}
export function lerExtratoDaycovalOfx(buffer) {
  return lerOfxBanco(buffer, 707);
}
/** Código do banco (BANKID) de um OFX, como número; null se não achar. */
export function bancoDoOfx(buffer) {
  const t = Buffer.isBuffer(buffer) ? buffer.subarray(0, 8000).toString('latin1') : String(buffer).slice(0, 8000);
  const b = (campo(t, 'BANKID') || '').replace(/\D/g, '');
  return b ? Number(b) : null;
}
// OFX costuma ser latin1 (CHARSET:1252), mas alguns bancos gravam UTF-8 mesmo dizendo 1252 (Daycoval) → se os bytes
// formam UTF-8 válido com acentos, decodifica como UTF-8
function textoOfx(buffer) {
  if (!Buffer.isBuffer(buffer)) return String(buffer);
  try {
    const t = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    if (/[\u00C0-\u00FF]/.test(t)) return t;
  } catch { /* não é UTF-8 válido */ }
  return buffer.toString('latin1');
}
function lerOfxBanco(buffer, esperado) {
  const texto = textoOfx(buffer);
  if (!ehOfx(texto)) throw new Error('O arquivo não é um OFX.');
  const def = BANCOS_OFX[esperado];
  const bankId = (campo(texto, 'BANKID') || '').replace(/\D/g, '');
  if (bankId && Number(bankId) !== esperado) throw new Error(`Este OFX é do banco ${bankId}, não ${def.nome} (${String(esperado).padStart(3, '0')}).`);
  const acctIdBruto = (campo(texto, 'ACCTID') || '').replace(/\D/g, '');
  if (!acctIdBruto) throw new Error('OFX sem o número da conta (ACCTID).');
  const acctId = def.normalizarConta ? def.normalizarConta(acctIdBruto) : acctIdBruto;
  const conhecida = def.contas[acctId] || null;
  const agencia = conhecida && 'agencia' in conhecida ? conhecida.agencia : def.agencia ?? ((campo(texto, 'BRANCHID') || '').replace(/\D/g, '') || null);
  const conta = acctId.slice(0, -1);
  const contaDv = acctId.slice(-1);

  const lista = (texto.match(/<BANKTRANLIST>([\s\S]*?)<\/BANKTRANLIST>/i) || [])[1] || texto;
  const blocos = [...lista.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)].map((m) => m[1]);
  const lanc = [];
  for (const b of blocos) {
    const valor = round2(Number(String(campo(b, 'TRNAMT') || '').replace(',', '.')));
    const data = dataOfx(campo(b, 'DTPOSTED'));
    if (!Number.isFinite(valor) || !data) continue;
    let nome = campo(b, 'NAME') || campo(b, 'MEMO') || '';
    let contraparteNome = null;
    if (def.banco === 'BNB') {
      // "RECEBIMENTO VIA PIX      -CROSBY D CONFECCAO LTDA ::26/9/2025" → tipo + contraparte
      const m = nome.match(/^(.*?)\s+-\s*(.+?)\s*(::\S+)?$/);
      if (m) { nome = `${limpar(m[1])} · ${limpar(m[2])}`; contraparteNome = limpar(m[2]) || null; }
      else nome = limpar(nome.replace(/::\S+$/, ''));
    }
    const fitid = campo(b, 'FITID');
    const checknum = campo(b, 'CHECKNUM');
    const doc = [fitid, checknum].find((d) => d && !/^0+$/.test(d) && d !== '1') || null;
    lanc.push({
      data,
      valor,
      natureza: valor < 0 ? 'D' : 'C',
      historico: nome,
      historicoBase: nome,
      historicoDescricao: HISTORICOS[nome] || null,
      documento: doc,
      contraparteNome,
      contraparteDoc: null,
      hora: null,
      tipoOfx: (campo(b, 'TRNTYPE') || '').toUpperCase(),
    });
  }
  // ordem cronológica estável (o arquivo já vem em ordem; garante)
  lanc.forEach((l, i) => (l.ordem = i));
  lanc.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.ordem - b.ordem));
  lanc.forEach((l, i) => {
    l.seq = i + 1;
    l.pagina = 1;
    l.dataBalancete = l.data;
    l.saldoInformado = null;
    delete l.ordem;
  });

  const balAmt = Number(String(campo(texto, 'BALAMT') || '').replace(',', '.'));
  if (!Number.isFinite(balAmt)) throw new Error('OFX sem o saldo final (LEDGERBAL/BALAMT).');
  const dtAsOf0 = dataOfx(campo(texto, 'DTASOF'));
  const d1 = dataOfx(campo(lista, 'DTSTART'));
  const d2 = dataOfx(campo(lista, 'DTEND'));
  const datasArq = [d1, d2].filter(Boolean).sort();
  const datasLanc = lanc.map((l) => l.data).sort();
  // mês de referência = mês com mais lançamentos (Caixa avança até o 1º dia útil do mês seguinte; o BB começa
  // o DTSTART no último dia útil do mês anterior). Sem lançamentos: Caixa pelo DTSTART, BB pelo DTEND.
  const freq = {};
  for (const d of datasLanc) freq[d.slice(0, 7)] = (freq[d.slice(0, 7)] || 0) + 1;
  const maisFrequente = Object.entries(freq).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0]?.[0] || null;
  const inicio = datasArq[0] || datasLanc[0] || null;
  const mesRef = maisFrequente || (def.banco === 'BB' ? (d2 || d1 || inicio) : inicio)?.slice(0, 7) || null;
  // BNB (BALAMT = saldo INICIAL): o arquivo exportado no dia 1º/2 do mês seguinte traz lançamentos desse mês
  // (ex.: nov/2023 vai até 01/12 e a tarifa de 01/12 se repete no arquivo de dezembro) → ficam só os do mês de referência
  if (def.balamtInicial && mesRef) {
    const limite = ultimoDiaMes(mesRef);
    const antes = lanc.length;
    for (let i = lanc.length - 1; i >= 0; i--) if (lanc[i].data > limite) lanc.splice(i, 1);
    if (lanc.length !== antes) {
      lanc.forEach((l, i) => (l.seq = i + 1));
      datasLanc.splice(0, datasLanc.length, ...lanc.map((l) => l.data).sort());
      for (let i = datasArq.length - 1; i >= 0; i--) if (datasArq[i] > limite) datasArq[i] = limite;
    }
  }
  const fim = datasLanc.at(-1) && datasArq.at(-1) ? (datasLanc.at(-1) > datasArq.at(-1) ? datasLanc.at(-1) : datasArq.at(-1)) : datasArq.at(-1) || datasLanc.at(-1) || (mesRef ? ultimoDiaMes(mesRef) : null);

  const totalCreditos = round2(lanc.filter((l) => l.valor > 0).reduce((s, l) => s + l.valor, 0));
  const totalDebitos = round2(lanc.filter((l) => l.valor < 0).reduce((s, l) => s - l.valor, 0));
  // BNB: BALAMT é o saldo inicial; nos outros é o saldo final (na data DTASOF)
  const saldoInicial = def.balamtInicial ? round2(balAmt) : round2(round2(balAmt) - totalCreditos + totalDebitos);
  const saldoFinal = def.balamtInicial ? round2(saldoInicial + totalCreditos - totalDebitos) : round2(balAmt);
  const dtAsOf = def.balamtInicial ? null : dtAsOf0;
  let corrente = saldoInicial;
  for (const l of lanc) {
    corrente = round2(corrente + l.valor);
    l.saldoApos = corrente;
  }

  return {
    banco: def.banco,
    bancoCodigo: String(esperado).padStart(3, '0'),
    formato: 'ofx',
    agencia,
    conta,
    contaDv,
    titular: conhecida?.titular || null,
    titularCnpj: conhecida?.cnpj || null,
    mesReferencia: mesRef,
    periodo: { inicio: mesRef ? `${mesRef}-01` : inicio, fim },
    saldoInicial,
    saldoFinal,
    saldoFinalEm: dtAsOf,
    lancamentos: lanc,
    conferencia: {
      fonte: def.balamtInicial ? 'OFX (BALAMT = saldo inicial do período; saldo final = inicial + movimentos; conferido pelo encadeamento com o mês anterior)' : 'OFX (saldo final do banco; saldo inicial = final − movimentos; conferido pelo encadeamento com o mês anterior)',
      saldoInicial,
      totalCreditos,
      totalDebitos,
      saldoCalculado: corrente,
      saldoFinalInformado: saldoFinal,
      diferencaFinal: 0,
      saldosDiariosConferidos: 0,
      divergencias: [],
      bate: true,
    },
    paginas: 1,
    hash: crypto.createHash('sha1').update(Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer))).digest('hex'),
  };
}

export default { lerExtratoCaixaOfx, lerExtratoBbOfx, lerExtratoBnbOfx, lerExtratoSicrediOfx, lerExtratoUnicredOfx, lerExtratoDaycovalOfx, bancoDoOfx, ehOfx, CONTAS_CAIXA, CONTAS_BB, CONTAS_BNB, CONTAS_SICREDI_OFX, CONTAS_UNICRED_OFX };
