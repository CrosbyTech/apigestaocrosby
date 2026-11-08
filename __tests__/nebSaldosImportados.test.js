// ============================================================
// Saldos GRAVADOS no New Extrato Bancário (tabelas neb_*) — para cada importação
// e cada conta já importada no Supabase:
//   • saldo inicial + lançamentos gravados = saldo final gravado (e o leitor bateu)
//   • "saldo após" da última linha = saldo final
//   • encadeamento: saldo inicial do mês = saldo final do mês anterior (mesma conta)
//   • saldo no fim de 2024 de cada conta = o do extrato (tabela FIM_2024)
//   • arquivos na pasta de extratos: saldo final lido do arquivo = saldo final gravado
// Precisa do Supabase (.env com SUPABASE_SERVICE_KEY); sem ele o teste é pulado.
// Rodar só este: npm test -- __tests__/nebSaldosImportados.test.js
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import supabase from '../config/supabase.js';
import { lerExtratoBb } from '../utils/extratoBbPdf.js';
import { lerExtratoCaixaOfx } from '../utils/extratoCaixaOfx.js';
import { lerExtratoItau } from '../utils/extratoItauPdf.js';
import { lerExtratoSicredi } from '../utils/extratoSicrediPdf.js';
import { lerExtratoSantander } from '../utils/extratoSantanderPdf.js';
import { lerExtratoSantanderOfx } from '../utils/extratoSantanderOfx.js';
import { lerExtratoUnicred } from '../utils/extratoUnicredPdf.js';
import { lerExtratoBradesco } from '../utils/extratoBradescoPdf.js';
import { lerExtratoBnb } from '../utils/extratoBnbPdf.js';

const ativo = !!process.env.SUPABASE_SERVICE_KEY && !process.env.NEB_TEST_SKIP;
const describeSe = ativo ? describe : describe.skip;
const RAIZ = process.env.EXTRATOS_2024_DIR || 'C:/Users/yagom/Desktop/EXTRATOS MENSAIS 2024';
const TIMEOUT = 300000;
const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const chave = (x) => `${x.banco}|${x.conta}`;
const mesSeguinte = (mes) => {
  const [a, m] = mes.split('-').map(Number);
  return `${m === 12 ? a + 1 : a}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}`;
};
async function todos(q) {
  const out = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await q().range(i, i + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

// Saldo em 31/12/2024 de cada conta, conferido no extrato de dezembro (PDF/OFX)
const FIM_2024 = [
  { banco: 'BB', conta: '58711', saldo: 9436.26 },
  { banco: 'CAIXA', conta: '000578136386', saldo: 17259.0 },
  { banco: 'CAIXA', conta: '000578136635', saldo: 1397.81 },
  { banco: 'ITAU', conta: '27061', saldo: -42278.76 },
  { banco: 'ITAU', conta: '33688', saldo: 93865.1 },
  { banco: 'ITAU', conta: '39046', saldo: 8244.05 },
  { banco: 'ITAU', conta: '98073', saldo: 2308.86 },
  { banco: 'ITAU', conta: '98141', saldo: 31260.11 },
  { banco: 'SICREDI', conta: '36733', saldo: 4935.25 },
  { banco: 'SICREDI', conta: '32693', saldo: 12392.96 },
  { banco: 'SICREDI', conta: '36734', saldo: 39776.59 },
  { banco: 'SANTANDER', conta: '13000599', saldo: 11141.2 },
  { banco: 'SANTANDER', conta: '13001128', saldo: 1095.23 },
  { banco: 'SANTANDER', conta: '13006882', saldo: 8255.8 },
  { banco: 'UNICRED', conta: '6850', saldo: 369.19 },
  { banco: 'UNICRED', conta: '7098', saldo: 848.05 },
  { banco: 'BRADESCO', conta: '249374', saldo: 1.0 },
  { banco: 'BRADESCO', conta: '249286', saldo: 1.0 },
  { banco: 'BNB', conta: '69918', saldo: 1124.09 },
  { banco: 'BNB', conta: '69919', saldo: 1038.99 },
  { banco: 'BNB', conta: '69921', saldo: 1081.57 },
  { banco: 'BNB', conta: '69922', saldo: 0 },
  { banco: 'BNB', conta: '69361', saldo: 1043.99 },
  { banco: 'BNB', conta: '69363', saldo: 0 },
];
// Importações aceitas com "forçar", com motivo conhecido: o saldo não encadeia com o mês vizinho
// (Bradesco set/2024 veio no "Extrato Mensal", cujo saldo soma o Invest Fácil; os outros meses são só conta corrente)
const FORCADAS = new Set(['BRADESCO|249374|2024-09', 'BRADESCO|249374|2024-10', 'BRADESCO|249286|2024-09', 'BRADESCO|249286|2024-10']);
const forcada = (i) => FORCADAS.has(`${i.banco}|${i.conta}|${i.mes_referencia}`);

describeSe('New Extrato — saldos gravados no banco', () => {
  let imps = [];
  let lancs = [];
  const porImp = new Map();

  beforeAll(async () => {
    imps = await todos(() => supabase.from('neb_importacoes').select('id,banco,conta,conta_dv,titular,titular_cnpj,mes_referencia,periodo_inicio,periodo_fim,saldo_inicial,saldo_final,saldo_calculado,bate,encadeamento,qtd,arquivo_nome').order('id'));
    lancs = await todos(() => supabase.from('neb_lancamentos').select('id,importacao_id,banco,conta,data,seq,valor,saldo_apos,tipo,transferencia_id,valor_transferido,titular_cnpj').order('id'));
    for (const l of lancs) {
      if (!porImp.has(l.importacao_id)) porImp.set(l.importacao_id, []);
      porImp.get(l.importacao_id).push(l);
    }
    for (const ls of porImp.values()) ls.sort((a, b) => a.data.localeCompare(b.data) || a.seq - b.seq);
  }, TIMEOUT);

  test('há importações gravadas', () => {
    expect(imps.length).toBeGreaterThan(0);
    expect(lancs.length).toBeGreaterThan(0);
  });

  test('nada da Shopping Recife', () => {
    for (const i of imps) expect(`${i.titular || ''} ${i.titular_cnpj || ''} ${i.conta}`).not.toMatch(/RECIFE|36569459|133998391/i);
    expect(lancs.filter((l) => String(l.titular_cnpj || '').startsWith('36569459')).length).toBe(0);
  });

  test('cada importação: saldo inicial + lançamentos gravados = saldo final gravado', () => {
    for (const i of imps) {
      const ls = porImp.get(i.id) || [];
      const soma = r2(ls.reduce((s, l) => s + Number(l.valor), 0));
      const rot = { id: i.id, conta: `${i.banco} ${i.conta}`, mes: i.mes_referencia };
      expect({ ...rot, qtd: ls.length }).toEqual({ ...rot, qtd: i.qtd });
      expect({ ...rot, saldoFinal: r2(Number(i.saldo_inicial) + soma) }).toEqual({ ...rot, saldoFinal: r2(Number(i.saldo_final)) });
      if (!forcada(i)) expect({ ...rot, bate: i.bate }).toEqual({ ...rot, bate: true });
      else expect({ ...rot, leitorBateu: i.encadeamento?.bate === false && Math.abs(Number(i.saldo_calculado) - Number(i.saldo_final)) <= 0.005 }).toEqual({ ...rot, leitorBateu: true });
      // "saldo após" encadeado linha a linha e igual ao saldo final na última
      let corrente = r2(Number(i.saldo_inicial));
      for (const l of ls) {
        corrente = r2(corrente + Number(l.valor));
        if (l.saldo_apos != null) expect({ ...rot, seq: l.seq, saldoApos: r2(Number(l.saldo_apos)) }).toEqual({ ...rot, seq: l.seq, saldoApos: corrente });
      }
    }
  });

  test('cada conta: um mês por importação e saldo inicial = saldo final do mês anterior', () => {
    const porConta = new Map();
    for (const i of imps) {
      if (!porConta.has(chave(i))) porConta.set(chave(i), new Map());
      const meses = porConta.get(chave(i));
      expect({ conta: chave(i), mes: i.mes_referencia, repetido: meses.has(i.mes_referencia) }).toEqual({ conta: chave(i), mes: i.mes_referencia, repetido: false });
      meses.set(i.mes_referencia, i);
    }
    let verificados = 0;
    for (const [conta, meses] of porConta) {
      for (const [mes, i] of meses) {
        const seg = meses.get(mesSeguinte(mes));
        if (!seg) continue;
        if (forcada(seg)) continue; // diferença conhecida (Invest Fácil)
        expect({ conta, de: mes, para: seg.mes_referencia, saldo: r2(Number(seg.saldo_inicial)) }).toEqual({ conta, de: mes, para: seg.mes_referencia, saldo: r2(Number(i.saldo_final)) });
        verificados++;
      }
    }
    expect(verificados).toBeGreaterThan(0);
  });

  test('saldo no fim de 2024 de cada conta = o do extrato de dezembro', () => {
    let conferidos = 0;
    for (const c of FIM_2024) {
      const dez = imps.find((i) => i.banco === c.banco && i.conta === c.conta && i.mes_referencia === '2024-12');
      if (!dez) continue;
      expect({ ...c, gravado: r2(Number(dez.saldo_final)) }).toEqual({ ...c, gravado: c.saldo });
      conferidos++;
    }
    expect(conferidos).toBe(FIM_2024.filter((c) => imps.some((i) => i.banco === c.banco && i.conta === c.conta && i.mes_referencia === '2024-12')).length);
    expect(conferidos).toBeGreaterThan(0);
  });

  test('transferências: pares com as duas pontas gravadas e parte de lote dentro do valor da saída', async () => {
    const pares = await todos(() => supabase.from('neb_transferencias').select('id,valor,origem_lancamento_id,destino_lancamento_id,evidencia').order('id'));
    const porId = new Map(lancs.map((l) => [l.id, l]));
    const alocadoPorSaida = new Map();
    for (const p of pares) {
      const o = porId.get(p.origem_lancamento_id);
      const d = porId.get(p.destino_lancamento_id);
      expect({ par: p.id, origem: !!o, destino: !!d }).toEqual({ par: p.id, origem: true, destino: true });
      expect(Number(o.valor)).toBeLessThan(0);
      expect(Number(d.valor)).toBeGreaterThan(0);
      expect({ par: p.id, valor: r2(Number(p.valor)) }).toEqual({ par: p.id, valor: r2(Number(d.valor)) });
      expect(d.tipo).toBe('TRANSFERENCIA');
      alocadoPorSaida.set(o.id, r2((alocadoPorSaida.get(o.id) || 0) + Number(p.valor)));
    }
    for (const [id, alocado] of alocadoPorSaida) {
      const o = porId.get(id);
      expect({ saida: id, cabe: alocado <= r2(-Number(o.valor)) + 0.005 }).toEqual({ saida: id, cabe: true });
      // lote inteiro para o grupo → TRANSFERENCIA; parte → SAÍDA com valor_transferido = soma das partes
      if (o.tipo === 'TRANSFERENCIA') expect({ saida: id, alocado }).toEqual({ saida: id, alocado: r2(-Number(o.valor)) });
      else expect({ saida: id, valorTransferido: r2(Number(o.valor_transferido || 0)) }).toEqual({ saida: id, valorTransferido: alocado });
    }
    // valor_transferido só existe em saídas que têm partes alocadas
    for (const l of lancs) if (Number(l.valor_transferido || 0) > 0) expect({ id: l.id, temParte: alocadoPorSaida.has(l.id) }).toEqual({ id: l.id, temParte: true });
  }, TIMEOUT);

  const temPasta = fs.existsSync(RAIZ);
  (temPasta ? test : test.skip)(
    'arquivos na pasta: saldo final lido do extrato = saldo final gravado',
    async () => {
      const listar = (sub, re) => (fs.existsSync(path.join(RAIZ, sub)) ? fs.readdirSync(path.join(RAIZ, sub)).filter((f) => re.test(f)).map((f) => path.join(RAIZ, sub, f)) : []);
      const arquivos = [
        ...listar('BB', /\.pdf$/i).map((a) => ({ a, ler: lerExtratoBb })),
        ...listar('CAIXA', /\.ofx$/i).map((a) => ({ a, ler: (b) => lerExtratoCaixaOfx(b) })),
        ...listar('ITAU', /\.pdf$/i).map((a) => ({ a, ler: lerExtratoItau })),
        ...listar('SICREDI', /\.pdf$/i).map((a) => ({ a, ler: lerExtratoSicredi })),
        ...listar('SANTANDER', /\.pdf$/i).filter((a) => !/DEZEMBRO\.pdf$|JOAO PESSOA\.pdf$/i.test(a)).map((a) => ({ a, ler: lerExtratoSantander })),
        ...listar('SANTANDER', /DEZEMBRO Money 2000|JOAO PESSOA MONEY 2000/i).map((a) => ({ a, ler: (b) => lerExtratoSantanderOfx(b) })),
        ...listar('UNICRED', /\.pdf$/i).map((a) => ({ a, ler: lerExtratoUnicred })),
        ...listar('BRADESCO', /\.pdf$/i).map((a) => ({ a, ler: lerExtratoBradesco })),
        ...listar('BNB', /\.pdf$/i).map((a) => ({ a, ler: lerExtratoBnb })),
      ];
      let conferidos = 0;
      for (const { a, ler } of arquivos) {
        const lida = await ler(fs.readFileSync(a));
        for (const l of Array.isArray(lida) ? lida : [lida]) {
        const imp = imps.find((i) => i.banco === l.banco && i.conta === l.conta && i.mes_referencia === l.mesReferencia);
        if (!imp) continue; // não importado (ex.: duplicata descartada)
        if (imp.encadeamento?.viaEncadeamento) continue; // Caixa dezembro: saldo do arquivo é de janeiro, o gravado vem do encadeamento
        if (l.layout === 'mensal' && imp.arquivo_nome && imp.arquivo_nome !== path.basename(a)) continue; // Bradesco: "Extrato Mensal" de um mês importado pelo "Consolidado" (saldo com Invest Fácil)
        expect({ arquivo: path.basename(a), conta: l.conta, gravado: r2(Number(imp.saldo_final)) }).toEqual({ arquivo: path.basename(a), conta: l.conta, gravado: l.saldoFinal });
        conferidos++;
        }
      }
      expect(conferidos).toBeGreaterThan(0);
    },
    TIMEOUT,
  );
});
