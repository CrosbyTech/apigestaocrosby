// ============================================================
// Confere TODOS os extratos de 2024 (BB, Caixa e Itaú) contra o próprio extrato:
//   • saldo final recalculado (saldo anterior + lançamentos) = saldo impresso no extrato
//   • saldos de fim de dia impressos (BB e Itaú) sem nenhuma divergência
//   • encadeamento: saldo inicial do mês = saldo final do mês anterior
//   • valores conferidos a olho nos PDFs (tabela CONFERIDOS_NO_PDF)
//   • nada da Shopping Recife (regra do Yago)
// Os arquivos ficam fora do repositório (Desktop do Yago); sem a pasta o teste é pulado.
// Rodar só este: npm test -- __tests__/extratos2024Saldos.test.js
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { lerExtratoBb } from '../utils/extratoBbPdf.js';
import { lerExtratoCaixaOfx } from '../utils/extratoCaixaOfx.js';
import { lerExtratoItau } from '../utils/extratoItauPdf.js';
import { lerExtratoSicredi } from '../utils/extratoSicrediPdf.js';
import { lerExtratoSantander } from '../utils/extratoSantanderPdf.js';
import { lerExtratoSantanderOfx } from '../utils/extratoSantanderOfx.js';

const RAIZ = process.env.EXTRATOS_2024_DIR || 'C:/Users/yagom/Desktop/EXTRATOS MENSAIS 2024';
const temPasta = fs.existsSync(RAIZ);
const describeSe = temPasta ? describe : describe.skip;
const TIMEOUT = 120000;
const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const listar = (sub, re) => (fs.existsSync(path.join(RAIZ, sub)) ? fs.readdirSync(path.join(RAIZ, sub)).filter((f) => re.test(f)).sort() : []);

// Saldos lidos a olho nos PDFs originais (conta sem dígito → mês → saldo no fim do mês)
const CONFERIDOS_NO_PDF = [
  { banco: 'BB', conta: '58711', mes: '2024-01', saldoFinal: 54505.38 },
  { banco: 'BB', conta: '58711', mes: '2024-12', saldoFinal: 9436.26 },
  { banco: 'CAIXA', conta: '000578136386', mes: '2024-03', saldoFinal: 7582.43 }, // PDF fecha em 01/04
  { banco: 'CAIXA', conta: '000578136386', mes: '2024-08', saldoFinal: 4193.89 }, // PDF fecha em 02/09
  { banco: 'CAIXA', conta: '000578136386', mes: '2024-12', saldoFinal: 17259.0 }, // SALDO DIA 31/12 no PDF
  { banco: 'CAIXA', conta: '000578136635', mes: '2024-12', saldoFinal: 1397.81 }, // SALDO DIA 31/12 no PDF
  { banco: 'CAIXA', conta: '000578136459', mes: '2024-01', saldoInicial: -7944.03 },
  { banco: 'ITAU', conta: '27061', mes: '2024-12', saldoFinal: -42278.76 },
  { banco: 'ITAU', conta: '33688', mes: '2024-12', saldoFinal: 93865.1 },
  { banco: 'ITAU', conta: '39046', mes: '2024-12', saldoFinal: 8244.05 },
  { banco: 'ITAU', conta: '98073', mes: '2024-12', saldoFinal: 2308.86 },
  { banco: 'ITAU', conta: '98141', mes: '2024-12', saldoFinal: 31260.11 },
  { banco: 'SANTANDER', conta: '13000599', mes: '2024-01', saldoInicial: 290030.44, saldoFinal: 11994.96 }, // "SALDO EM 31/12" e "SALDO EM 31/01" do PDF
  { banco: 'SANTANDER', conta: '13000599', mes: '2024-11', saldoFinal: 1702.52 },
  { banco: 'SANTANDER', conta: '13006882', mes: '2024-01', saldoInicial: 6549.48 },
  { banco: 'SANTANDER', conta: '13001128', mes: '2024-01', saldoInicial: 3100.95 },
];

const ARQUIVOS = [
  ...listar('BB', /\.pdf$/i).map((f) => ({ banco: 'BB', arquivo: path.join(RAIZ, 'BB', f), ler: lerExtratoBb })),
  ...listar('CAIXA', /\.ofx$/i).map((f) => ({ banco: 'CAIXA', arquivo: path.join(RAIZ, 'CAIXA', f), ler: (b) => lerExtratoCaixaOfx(b) })),
  ...listar('ITAU', /\.pdf$/i).map((f) => ({ banco: 'ITAU', arquivo: path.join(RAIZ, 'ITAU', f), ler: lerExtratoItau })),
  ...listar('SICREDI', /\.pdf$/i).map((f) => ({ banco: 'SICREDI', arquivo: path.join(RAIZ, 'SICREDI', f), ler: lerExtratoSicredi })),
  // Santander: PDF consolidado (jan–nov); dezembro só no formato "Internet Banking" sem saldo → OFX "Money 2000 ou superior"
  ...listar('SANTANDER', /\.pdf$/i)
    .filter((f) => !/DEZEMBRO\.pdf$|JOAO PESSOA\.pdf$/i.test(f))
    .map((f) => ({ banco: 'SANTANDER', arquivo: path.join(RAIZ, 'SANTANDER', f), ler: lerExtratoSantander })),
  ...listar('SANTANDER', /DEZEMBRO Money 2000|JOAO PESSOA MONEY 2000/i).map((f) => ({ banco: 'SANTANDER', arquivo: path.join(RAIZ, 'SANTANDER', f), ler: (b) => lerExtratoSantanderOfx(b) })),
];
// Sicredi: o OFX do mesmo mês (exportado à parte) traz o saldo final do banco → contraprova do PDF
const campoOfx = (t, tag) => (t.match(new RegExp(`<${tag}>([^<\r\n]*)`, 'i')) || [])[1]?.trim();
const OFX_SICREDI = listar('SICREDI', /\.ofx$/i).map((f) => {
  const t = fs.readFileSync(path.join(RAIZ, 'SICREDI', f), 'latin1');
  return { arquivo: f, conta: (campoOfx(t, 'ACCTID') || '').replace(/^0+/, ''), mes: (campoOfx(t, 'DTSTART') || '').replace(/^(\d{4})(\d{2}).*/, '$1-$2'), saldoFinal: r2(Number(campoOfx(t, 'BALAMT'))) };
});
const leituras = new Map(); // arquivo → leitura

// saldo da conta no fim de uma data, recalculado a partir do arquivo (saldo inicial + lançamentos até a data)
const saldoNaData = (l, data) => r2(l.saldoInicial + l.lancamentos.filter((x) => x.data <= data).reduce((s, x) => s + x.valor, 0));
// Caixa: o extrato "do mês" avança até o 1º dia útil do mês seguinte e o arquivo seguinte repete esse dia
const corteCaixa = (l) => [l.lancamentos.at(-1)?.data, l.periodo.fim].filter(Boolean).sort().at(-1);
// Caixa: o OFX de dezembro traz o saldo do banco já em janeiro (03/01) → o saldo inicial/final do arquivo não valem;
// o saldo de 31/12 só sai pelo encadeamento: saldo final de novembro + lançamentos de dezembro depois do dia repetido
const saldoBancoForaDoMes = (l) => l.banco === 'CAIXA' && l.saldoFinalEm && l.saldoFinalEm > l.periodo.fim;
const saldoCaixaEncadeado = (ant, seg, ate) => r2(ant.saldoFinal + seg.lancamentos.filter((x) => x.data > corteCaixa(ant) && x.data <= ate).reduce((s, x) => s + x.valor, 0));
const mesAnterior = (mes) => {
  const [a, m] = mes.split('-').map(Number);
  return `${m === 1 ? a - 1 : a}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`;
};
const mesSeguinte = (mes) => {
  const [a, m] = mes.split('-').map(Number);
  return `${m === 12 ? a + 1 : a}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}`;
};

// agrupa por conta e mês (um mês pode vir em dois arquivos: BB JUNHO = maio repetido; Itaú setembro em dois layouts)
const porConta = () => {
  const m = new Map();
  for (const l of leituras.values()) {
    const k = `${l.banco}|${l.conta}`;
    if (!m.has(k)) m.set(k, new Map());
    const meses = m.get(k);
    if (!meses.has(l.mesReferencia)) meses.set(l.mesReferencia, []);
    meses.get(l.mesReferencia).push(l);
  }
  return m;
};

describeSe('extratos 2024 — saldo recalculado = saldo do extrato', () => {
  test('há extratos na pasta', () => {
    expect(ARQUIVOS.length).toBeGreaterThan(0);
  });

  test.each(ARQUIVOS.map((a) => [path.basename(a.arquivo), a]))(
    '%s',
    async (_nome, a) => {
      const l = await a.ler(fs.readFileSync(a.arquivo));
      leituras.set(a.arquivo, l);
      expect(l.banco).toBe(a.banco);
      expect(l.mesReferencia).toMatch(/^2024-\d{2}$/);
      // nada da Shopping Recife
      expect(`${l.titular || ''} ${l.titularCnpj || ''} ${l.conta}${l.contaDv || ''}`).not.toMatch(/RECIFE|36569459|1339983916/i);
      // saldo anterior + lançamentos = saldo final impresso
      const soma = r2(l.lancamentos.reduce((s, x) => s + x.valor, 0));
      expect(r2(l.saldoInicial + soma)).toBe(l.saldoFinal);
      expect(l.conferencia.saldoCalculado).toBe(l.conferencia.saldoFinalInformado);
      // cada saldo de fim de dia impresso bate (BB e Itaú); a Caixa não imprime saldo por dia
      expect(l.conferencia.divergencias).toEqual([]);
      // (BB Irmãos tem meses sem nenhum lançamento: saldo 0 → 0, sem saldo diário impresso)
      if (a.banco !== 'CAIXA' && l.formato !== 'ofx' && l.lancamentos.length) expect(l.conferencia.saldosDiariosConferidos).toBeGreaterThan(0);
      expect(l.conferencia.bate).toBe(true);
      // o saldo após cada lançamento também encadeia linha a linha
      let corrente = l.saldoInicial;
      for (const x of l.lancamentos) {
        corrente = r2(corrente + x.valor);
        expect(x.saldoApos).toBe(corrente);
      }
    },
    TIMEOUT,
  );

  test('todos os arquivos foram lidos', () => {
    expect(leituras.size).toBe(ARQUIVOS.length);
  });

  test('o mesmo mês em dois arquivos tem o mesmo saldo inicial e final', () => {
    for (const [conta, meses] of porConta()) {
      for (const [mes, ls] of meses) {
        for (const l of ls.slice(1)) {
          expect({ conta, mes, saldoInicial: l.saldoInicial, saldoFinal: l.saldoFinal }).toEqual({ conta, mes, saldoInicial: ls[0].saldoInicial, saldoFinal: ls[0].saldoFinal });
        }
      }
    }
  });

  test('encadeamento: saldo inicial do mês = saldo final do mês anterior', () => {
    const verificados = [];
    for (const [conta, meses] of porConta()) {
      for (const [mes, ls] of meses) {
        const prox = meses.get(mesSeguinte(mes));
        if (!prox) continue; // mês seguinte não está na pasta (ex.: BB Crosby junho)
        const ant = ls[0];
        const seg = prox[0];
        // o extrato da Caixa avança até o 1º dia útil do mês seguinte e o arquivo seguinte repete esse dia:
        // o saldo final do anterior tem de ser igual ao saldo do seguinte naquela mesma data
        if (saldoBancoForaDoMes(seg)) continue; // dezembro da Caixa: conferido em "saldos conferidos a olho" pelo encadeamento
        const esperado = ant.banco === 'CAIXA' ? saldoNaData(seg, corteCaixa(ant)) : seg.saldoInicial;
        expect({ conta, de: mes, para: seg.mesReferencia, saldo: esperado }).toEqual({ conta, de: mes, para: seg.mesReferencia, saldo: ant.saldoFinal });
        verificados.push(`${conta} ${mes}`);
      }
    }
    expect(verificados.length).toBeGreaterThan(0);
  });

  test('Sicredi: saldo final do PDF = saldo final do OFX do mesmo mês', () => {
    let conferidos = 0;
    for (const l of leituras.values()) {
      if (l.banco !== 'SICREDI') continue;
      const o = OFX_SICREDI.find((x) => x.mes === l.mesReferencia && x.conta.endsWith(`${l.conta}${l.contaDv}`));
      if (!o) continue;
      expect({ conta: l.conta, mes: l.mesReferencia, ofx: o.saldoFinal }).toEqual({ conta: l.conta, mes: l.mesReferencia, ofx: l.saldoFinal });
      conferidos++;
    }
    if (OFX_SICREDI.length) expect(conferidos).toBeGreaterThan(0);
  });

  test('saldos conferidos a olho nos PDFs', () => {
    const contas = porConta();
    let conferidos = 0;
    for (const c of CONFERIDOS_NO_PDF) {
      const ls = contas.get(`${c.banco}|${c.conta}`)?.get(c.mes);
      if (!ls) continue; // conta/mês não está na pasta
      const l = ls[0];
      if (c.saldoInicial != null) expect({ ...c, lido: l.saldoInicial }).toEqual({ ...c, lido: c.saldoInicial });
      if (c.saldoFinal != null) {
        // o PDF da Caixa fecha no mesmo dia do OFX (1º dia útil seguinte), salvo dezembro, cujo saldo em 31/12 vem do encadeamento
        let lido = l.saldoFinal;
        if (saldoBancoForaDoMes(l)) {
          const ant = contas.get(`${c.banco}|${c.conta}`)?.get(mesAnterior(c.mes))?.[0];
          expect(ant).toBeDefined();
          lido = saldoCaixaEncadeado(ant, l, `${c.mes}-31`);
        }
        expect({ ...c, lido }).toEqual({ ...c, lido: c.saldoFinal });
      }
      conferidos++;
    }
    expect(conferidos).toBe(CONFERIDOS_NO_PDF.length);
  });
});
