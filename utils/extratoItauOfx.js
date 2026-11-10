// ============================================================
// New Extrato Bancário — leitor do OFX do Itaú (2023)
// ------------------------------------------------------------
// O OFX que o Itaú gerava em 2023 é a cópia da tela "lançamentos período": além dos lançamentos,
// traz como <STMTTRN> as linhas de SALDO —
//   • "SALDO ANTERIOR" (datado do último dia útil do mês anterior) = saldo inicial
//   • "SALDO DO DIA" ou "SDO CTA/APL AUTOMATICAS" (conta + aplicação automática) no fim de cada dia
//   • "(-) SALDO A LIBERAR", "SALDO FINAL DISPONIVEL", "SALDO FINAL DEVEDOR": informação, ignoradas
// Com isso o arquivo se confere sozinho, dia a dia, igual ao PDF (e bate com ele centavo a centavo).
//
// Variante reemitida em 2024 (ex.: AZ fev/2023, exportado em 02/01/2024): começa com "SALDO INICIAL"
// (só a conta corrente), traz as linhas "APL/RES APLIC AUT MAIS" e, no fim do dia, "SALDO APLIC AUT MAIS"
// (saldo da aplicação). Aqui o saldo é o TOTAL (conta + aplicação), como no resto do New Extrato:
//   saldo inicial = SALDO INICIAL + aplicação antes do 1º movimento; APL/RES ficam de fora (não mudam o total);
//   a cada "SALDO APLIC AUT MAIS" confere conta corrente recalculada + aplicação = total recalculado.
//
// O BALAMT do arquivo é o saldo na data da exportação e vem sem vírgula: não é usado.
// OFX do Itaú sem as linhas de saldo (2024+): não dá para conferir → erro pedindo o PDF.
// ============================================================
import crypto from 'node:crypto';
import { CONTAS_ITAU, contraparteDaDescricao } from './extratoItauPdf.js';

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const limpar = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const campo = (bloco, tag) => (bloco.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i')) || [])[1]?.trim() || '';
const dataOfx = (s) => (/^\d{8}/.test(s || '') ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);
const ultimoDiaMes = (mes) => {
  const [a, m] = mes.split('-').map(Number);
  return `${mes}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
};
const SHOPPING_RECIFE = /SHOPPING RECIFE|RECIFE MALL|36\.?569\.?459|1339983916|133998391/i;

export function ehOfxItau(buffer) {
  const t = Buffer.isBuffer(buffer) ? buffer.subarray(0, 6000).toString('latin1') : String(buffer).slice(0, 6000);
  return /<OFX>|OFXHEADER/i.test(t) && /<BANKID>\s*0*341\b/i.test(t);
}

export function lerExtratoItauOfx(buffer) {
  const texto = Buffer.isBuffer(buffer) ? buffer.toString('latin1') : String(buffer);
  if (!ehOfxItau(texto)) throw new Error('O arquivo não é um OFX do Itaú (BANKID 341).');
  const acct = campo(texto, 'ACCTID').replace(/\D/g, '');
  if (acct.length < 7) throw new Error('OFX do Itaú sem o número da conta (ACCTID).');
  const agencia = acct.slice(0, 4);
  const conta = String(Number(acct.slice(4, -1)));
  const contaDv = acct.slice(-1);
  if (SHOPPING_RECIFE.test(`${conta}${contaDv} ${conta}-${contaDv}`)) throw new Error('Extrato da Shopping Recife: não entra em nenhum banco (regra do Yago).');
  const conhecida = CONTAS_ITAU[`${agencia}|${conta}-${contaDv}`] || null;

  const blocos = [...texto.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)].map((m) => m[1]);
  const lanc = [];
  const saldosDia = []; // { apos, valor } saldo TOTAL impresso depois do lançamento `apos`
  const conferenciasAplic = []; // variante reemitida: { apos, aplic, cc } → total = cc + aplic
  let saldoAnterior = null; // 1º "SALDO ANTERIOR"/"SALDO INICIAL"
  let reemitido = false;
  let cc = null; // conta corrente recalculada (variante reemitida)
  let aplicInicial = null;
  let somaAplRes = 0;
  let aplicado = 0;
  let resgatado = 0;
  let qtdAplic = 0;
  for (const b of blocos) {
    const valor = round2(Number(campo(b, 'TRNAMT').replace(',', '.')));
    const data = dataOfx(campo(b, 'DTPOSTED'));
    const memo = limpar(campo(b, 'MEMO') || campo(b, 'NAME'));
    const up = memo.toUpperCase();
    if (!Number.isFinite(valor) || !data) continue;
    if (/^SALDO (ANTERIOR|INICIAL)$/.test(up)) {
      if (saldoAnterior == null) {
        saldoAnterior = valor;
        cc = valor;
        reemitido = up === 'SALDO INICIAL';
      }
      continue; // "SALDO ANTERIOR" no meio do arquivo (variante reemitida, depois de "SALDO PARCIAL"): só repete o saldo da conta
    }
    if (/^(SALDO DO DIA|SDO CTA\/APL AUTOMATICAS)$/.test(up)) {
      if (saldosDia.at(-1)?.apos === lanc.length - 1) saldosDia.pop();
      saldosDia.push({ apos: lanc.length - 1, valor });
      continue;
    }
    if (/^SALDO APLIC AUT/.test(up)) {
      // saldo da aplicação automática no fim do dia (variante reemitida)
      if (aplicInicial == null) aplicInicial = round2(valor + somaAplRes);
      conferenciasAplic.push({ apos: lanc.length - 1, aplic: valor, cc: round2(cc) });
      continue;
    }
    if (/^SALDO|^\(-\)\s*SALDO|^SDO /.test(up)) continue; // SALDO A LIBERAR, SALDO FINAL DISPONIVEL/DEVEDOR, SALDO PARCIAL, SALDO FINAL
    if (/^(APL|RES|APLIC|RESG)\w* APLIC AUT/.test(up)) {
      // aplicação/resgate automático: sai da conta e entra na aplicação (ou o contrário) → o total não muda
      somaAplRes = round2(somaAplRes + valor);
      if (cc != null) cc = round2(cc + valor);
      if (valor < 0) aplicado = round2(aplicado - valor);
      else resgatado = round2(resgatado + valor);
      qtdAplic++;
      continue;
    }
    if (cc != null) cc = round2(cc + valor);
    const cp = contraparteDaDescricao(memo);
    lanc.push({ data, valor, descricao: memo, contraparteNome: cp.nome, contraparteDoc: cp.doc, hint: cp.hint });
  }
  if (saldoAnterior == null) throw new Error('OFX do Itaú sem a linha "SALDO ANTERIOR": não dá para conferir o saldo. Use o PDF do mesmo mês.');
  if (!saldosDia.length && !conferenciasAplic.length) throw new Error('OFX do Itaú sem as linhas de saldo do dia: não dá para conferir. Use o PDF do mesmo mês.');

  // mês de referência = mês com mais lançamentos
  const freq = {};
  for (const l of lanc) freq[l.data.slice(0, 7)] = (freq[l.data.slice(0, 7)] || 0) + 1;
  const mesRef = Object.entries(freq).sort((x, y) => y[1] - x[1])[0]?.[0] || dataOfx(campo(texto, 'DTEND'))?.slice(0, 7) || null;
  if (!mesRef) throw new Error('OFX do Itaú sem lançamentos e sem período.');
  const foraDoMes = lanc.filter((l) => l.data.slice(0, 7) !== mesRef);
  if (foraDoMes.length) throw new Error(`OFX do Itaú com ${foraDoMes.length} lançamento(s) fora de ${mesRef} (ex.: ${foraDoMes[0].data} ${foraDoMes[0].descricao}).`);

  // saldo inicial TOTAL: na variante reemitida, conta corrente + aplicação antes do 1º movimento
  const saldoInicial = round2(saldoAnterior + (reemitido ? aplicInicial || 0 : 0));
  let corrente = saldoInicial;
  const lancamentos = lanc.map((l, i) => {
    corrente = round2(corrente + l.valor);
    return { ...l, seq: i + 1, pagina: 1, dataBalancete: l.data, natureza: l.valor < 0 ? 'D' : 'C', historico: l.descricao, historicoBase: l.descricao.replace(/\s*\d{2}\/\d{2}$/, ''), documento: null, hora: null, saldoInformado: null, saldoApos: corrente };
  });
  const divergencias = [];
  const conferir = (apos, informado) => {
    const calc = apos >= 0 ? lancamentos[apos].saldoApos : saldoInicial;
    const l = lancamentos[apos] || null;
    if (l) l.saldoInformado = round2(informado);
    if (Math.abs(calc - informado) > 0.005) divergencias.push({ seq: l?.seq ?? 0, data: l?.data ?? null, historico: l?.descricao ?? 'saldo inicial', saldoCalculado: calc, saldoInformado: round2(informado), diferenca: round2(informado - calc) });
  };
  for (const s of saldosDia) conferir(s.apos, s.valor);
  for (const s of conferenciasAplic) conferir(s.apos, round2(s.cc + s.aplic));
  const saldoCalculado = lancamentos.length ? lancamentos.at(-1).saldoApos : saldoInicial;
  // saldo final impresso: o último saldo do dia (na variante reemitida, o total recalculado, conferido pelos saldos da aplicação)
  const saldoFinal = saldosDia.length ? round2(saldosDia.at(-1).valor) : saldoCalculado;
  const totalCreditos = round2(lancamentos.filter((l) => l.valor > 0).reduce((s, l) => s + l.valor, 0));
  const totalDebitos = round2(lancamentos.filter((l) => l.valor < 0).reduce((s, l) => s - l.valor, 0));
  return {
    banco: 'ITAU',
    bancoCodigo: '341',
    formato: 'ofx',
    layout: reemitido ? 'ofx-reemitido' : 'ofx-2023',
    agencia,
    conta,
    contaDv,
    titular: conhecida?.titular || null,
    titularCnpj: conhecida?.cnpj || null,
    mesReferencia: mesRef,
    periodo: { inicio: `${mesRef}-01`, fim: ultimoDiaMes(mesRef) },
    saldoInicial,
    saldoFinal,
    saldoFinalEm: null, // os saldos vêm de dentro do arquivo (não do BALAMT)
    lancamentos,
    conferencia: {
      fonte: reemitido
        ? 'OFX Itaú (reemitido): SALDO INICIAL da conta + aplicação automática; total conferido a cada "SALDO APLIC AUT MAIS"'
        : 'OFX Itaú 2023: SALDO ANTERIOR e saldo de cada dia ("SALDO DO DIA" / "SDO CTA/APL AUTOMATICAS") vêm no arquivo',
      saldoInicial,
      totalCreditos,
      totalDebitos,
      saldoCalculado,
      saldoFinalInformado: saldoFinal,
      diferencaFinal: round2(saldoFinal - saldoCalculado),
      saldosDiariosConferidos: saldosDia.length + conferenciasAplic.length,
      divergencias,
      bate: divergencias.length === 0 && Math.abs(saldoCalculado - saldoFinal) <= 0.005,
      aplicacoesAutomaticas: { qtd: qtdAplic, aplicado, resgatado },
    },
    paginas: 1,
    hash: crypto.createHash('sha1').update(Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer))).digest('hex'),
  };
}

export default { lerExtratoItauOfx, ehOfxItau };
