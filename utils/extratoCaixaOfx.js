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

// Históricos da Caixa → o que são (para a tela e para o casamento de transferências)
const HISTORICOS = {
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

export function ehOfx(buffer) {
  const t = Buffer.isBuffer(buffer) ? buffer.subarray(0, 4000).toString('latin1') : String(buffer).slice(0, 4000);
  return /<OFX>/i.test(t) || /OFXHEADER/i.test(t);
}

/**
 * Lê o OFX da Caixa. Devolve o mesmo formato do leitor do BB.
 * @param {Buffer} buffer
 */
export function lerExtratoCaixaOfx(buffer) {
  const texto = Buffer.isBuffer(buffer) ? buffer.toString('latin1') : String(buffer);
  if (!ehOfx(texto)) throw new Error('O arquivo não é um OFX.');
  const bankId = (campo(texto, 'BANKID') || '').replace(/\D/g, '');
  if (bankId && Number(bankId) !== 104) throw new Error(`Este OFX é do banco ${bankId}, não da Caixa (104).`);
  const acctId = (campo(texto, 'ACCTID') || '').replace(/\D/g, '');
  if (!acctId) throw new Error('OFX sem o número da conta (ACCTID).');
  const agencia = (campo(texto, 'BRANCHID') || '').replace(/\D/g, '') || null;
  const conta = acctId.slice(0, -1);
  const contaDv = acctId.slice(-1);
  const conhecida = CONTAS_CAIXA[acctId] || null;

  const lista = (texto.match(/<BANKTRANLIST>([\s\S]*?)<\/BANKTRANLIST>/i) || [])[1] || texto;
  const blocos = [...lista.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)].map((m) => m[1]);
  const lanc = [];
  for (const b of blocos) {
    const valor = round2(Number(String(campo(b, 'TRNAMT') || '').replace(',', '.')));
    const data = dataOfx(campo(b, 'DTPOSTED'));
    if (!Number.isFinite(valor) || !data) continue;
    const nome = campo(b, 'NAME') || campo(b, 'MEMO') || '';
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
      contraparteNome: null,
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
  const saldoFinal = round2(balAmt);
  const dtAsOf = dataOfx(campo(texto, 'DTASOF'));
  const d1 = dataOfx(campo(lista, 'DTSTART'));
  const d2 = dataOfx(campo(lista, 'DTEND'));
  const datasArq = [d1, d2].filter(Boolean).sort();
  const datasLanc = lanc.map((l) => l.data).sort();
  // mês de referência = mês do início do período (o arquivo pode avançar até o 1º dia útil do mês seguinte)
  const inicio = datasArq[0] || datasLanc[0] || null;
  const mesRef = inicio ? inicio.slice(0, 7) : null;
  const fim = datasLanc.at(-1) && datasArq.at(-1) ? (datasLanc.at(-1) > datasArq.at(-1) ? datasLanc.at(-1) : datasArq.at(-1)) : datasArq.at(-1) || datasLanc.at(-1) || (mesRef ? ultimoDiaMes(mesRef) : null);

  const totalCreditos = round2(lanc.filter((l) => l.valor > 0).reduce((s, l) => s + l.valor, 0));
  const totalDebitos = round2(lanc.filter((l) => l.valor < 0).reduce((s, l) => s - l.valor, 0));
  const saldoInicial = round2(saldoFinal - totalCreditos + totalDebitos);
  let corrente = saldoInicial;
  for (const l of lanc) {
    corrente = round2(corrente + l.valor);
    l.saldoApos = corrente;
  }

  return {
    banco: 'CAIXA',
    bancoCodigo: '104',
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
      fonte: 'OFX (saldo final do banco; saldo inicial = final − movimentos; conferido pelo encadeamento com o mês anterior)',
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

export default { lerExtratoCaixaOfx, ehOfx, CONTAS_CAIXA };
