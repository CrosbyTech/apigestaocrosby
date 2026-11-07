// ============================================================
// Extrato do Santander PJ em OFX ("Money 2000 ou superior" / "Money 98/99
// Finance", que só diferem em cabeçalho) — leitor novo (06/11/2026).
// ------------------------------------------------------------
// Usado para dezembro/2024, cujo PDF ("Internet Banking Empresarial") não
// traz saldo. Pegadinhas:
//   • BANKID 033; ACCTID = agência (4) + conta (9, com dígito): 1575130005995;
//   • TRNAMT com vírgula decimal ("1785,48", "-0,23");
//   • DTSTART/DTEND são a hora da exportação (inúteis): o mês vem do DTPOSTED;
//   • LEDGERBAL/DTASOF = saldo na hora da exportação (ex.: 03/01) → quando é
//     de depois do último lançamento o serviço usa o encadeamento com o mês
//     anterior (mesma regra da Caixa);
//   • MEMO = descrição (às vezes com detalhe: "IOF ... PERIODO: 01/11 A 30/11/24");
//     CHECKNUM = documento; não há contraparte.
// ============================================================
import crypto from 'node:crypto';
import { CONTAS_SANTANDER, hintDaDescricao, contraparteSantander } from './extratoSantanderPdf.js';

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
const numOfx = (s) => round2(Number(String(s || '').replace(/\./g, '').replace(',', '.')));
const ultimoDiaMes = (mes) => {
  const [a, m] = mes.split('-').map(Number);
  return `${mes}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

export function ehOfxSantander(buffer) {
  const t = Buffer.isBuffer(buffer) ? buffer.subarray(0, 6000).toString('latin1') : String(buffer).slice(0, 6000);
  return /<OFX>/i.test(t) && /<BANKID>\s*0*33\b/i.test(t);
}

/**
 * Lê o OFX do Santander. Mesmo formato dos outros leitores.
 * @param {Buffer} buffer
 */
export function lerExtratoSantanderOfx(buffer) {
  const texto = Buffer.isBuffer(buffer) ? buffer.toString('latin1') : String(buffer);
  if (!/<OFX>/i.test(texto)) throw new Error('O arquivo não é um OFX.');
  const bankId = (campo(texto, 'BANKID') || '').replace(/\D/g, '');
  if (Number(bankId) !== 33) throw new Error(`Este OFX é do banco ${bankId || '?'}, não do Santander (033).`);
  const acctId = (campo(texto, 'ACCTID') || '').replace(/\D/g, '');
  if (acctId.length < 10) throw new Error('OFX sem o número da conta (ACCTID).');
  const agencia = acctId.slice(0, 4);
  const conta = acctId.slice(4, -1);
  const contaDv = acctId.slice(-1);
  const conhecida = CONTAS_SANTANDER[`${agencia}|${conta}-${contaDv}`] || null;

  const lista = (texto.match(/<BANKTRANLIST>([\s\S]*?)<\/BANKTRANLIST>/i) || [])[1] || texto;
  const blocos = [...lista.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)].map((m) => m[1]);
  const lanc = [];
  for (const b of blocos) {
    const valor = numOfx(campo(b, 'TRNAMT'));
    const data = dataOfx(campo(b, 'DTPOSTED'));
    if (!Number.isFinite(valor) || !data) continue;
    const memo = campo(b, 'MEMO') || campo(b, 'NAME') || '';
    const [descricao, ...detalhes] = memo.split(/\s{2,}/); // "IOF IMPOSTO ...     0000000153915 / 000173838" → descrição + detalhe
    const detalhe = limpar(detalhes.join(' ')) || null;
    const cp = contraparteSantander(descricao, detalhe, conhecida?.titular || null, conhecida?.cnpj || null);
    const doc = [campo(b, 'CHECKNUM'), campo(b, 'FITID')].find((d) => d && !/^0+$/.test(d)) || null;
    lanc.push({ data, valor, natureza: valor < 0 ? 'D' : 'C', historico: detalhe ? `${limpar(descricao)} · ${detalhe}` : limpar(descricao), historicoBase: cp.base, historicoDescricao: null, documento: doc, contraparteNome: cp.nome, contraparteDoc: cp.doc, hora: null, hint: hintDaDescricao(descricao), tipoOfx: (campo(b, 'TRNTYPE') || '').toUpperCase() });
  }
  lanc.forEach((l, i) => (l.ordem = i));
  lanc.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.ordem - b.ordem));
  lanc.forEach((l, i) => {
    l.seq = i + 1;
    l.pagina = 1;
    l.dataBalancete = l.data;
    l.saldoInformado = null;
    delete l.ordem;
  });
  if (!lanc.length) throw new Error('OFX sem lançamentos.');

  const balAmt = campo(texto, 'BALAMT');
  if (balAmt == null) throw new Error('OFX sem o saldo (LEDGERBAL/BALAMT).');
  const saldoFinal = numOfx(balAmt);
  const dtAsOf = dataOfx(campo(texto, 'DTASOF'));
  const datas = lanc.map((l) => l.data).sort();
  const mesRef = datas[0].slice(0, 7);
  const totalCreditos = round2(lanc.filter((l) => l.valor > 0).reduce((s, l) => s + l.valor, 0));
  const totalDebitos = round2(lanc.filter((l) => l.valor < 0).reduce((s, l) => s - l.valor, 0));
  const saldoInicial = round2(saldoFinal - totalCreditos + totalDebitos);
  let corrente = saldoInicial;
  for (const l of lanc) {
    corrente = round2(corrente + l.valor);
    l.saldoApos = corrente;
  }
  return {
    banco: 'SANTANDER',
    bancoCodigo: '033',
    formato: 'ofx',
    agencia,
    conta,
    contaDv,
    titular: conhecida?.titular || null,
    titularCnpj: conhecida?.cnpj || null,
    mesReferencia: mesRef,
    periodo: { inicio: `${mesRef}-01`, fim: datas.at(-1) > ultimoDiaMes(mesRef) ? datas.at(-1) : ultimoDiaMes(mesRef) },
    saldoInicial,
    saldoFinal,
    saldoFinalEm: dtAsOf,
    lancamentos: lanc,
    conferencia: {
      fonte: 'OFX (saldo do banco na exportação; saldo inicial = final − movimentos; conferido pelo encadeamento com o mês anterior)',
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

export default { lerExtratoSantanderOfx, ehOfxSantander };
