// ============================================================
// Extratos de 2025 (pasta "EXTRATOS MENSAIS 2025", separada por banco): o SALDO FINAL de cada mês
// tem que ser igual em todo lugar —
//   • saldo recalculado (saldo inicial + lançamentos) = saldo final impresso no extrato, sem divergência diária
//   • PDF e OFX do mesmo mês e conta → mesmo saldo inicial e final
//   • encadeamento: saldo inicial do mês = saldo final do mês anterior (buracos conhecidos listados)
//   • tabela FIM_DE_MES: saldo final impresso em cada extrato, conta a conta, mês a mês
//   • banco de dados (neb_importacoes): saldo inicial/final gravado = saldo do arquivo, e todos os meses presentes
// Só entram os bancos já importados em 2025 (BANCOS); os outros entram conforme forem importados.
// Os arquivos ficam fora do repositório (Desktop do Yago); sem a pasta o teste é pulado; sem SUPABASE_SERVICE_KEY, só a parte do banco é pulada.
// Rodar só este: npm test -- __tests__/extratos2025Saldos.test.js
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import supabase from '../config/supabase.js';
import { lerExtratoBb } from '../utils/extratoBbPdf.js';
import { lerExtratoBbOfx } from '../utils/extratoCaixaOfx.js';

const RAIZ = process.env.EXTRATOS_2025_DIR || 'C:/Users/yagom/Desktop/EXTRATOS MENSAIS 2025';
const temPasta = fs.existsSync(RAIZ);
const describeSe = temPasta ? describe : describe.skip;
const describeBanco = temPasta && process.env.SUPABASE_SERVICE_KEY && !process.env.NEB_TEST_SKIP ? describe : describe.skip;
const TIMEOUT = 180000;
const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100 + 0; // "+ 0" tira o -0 (toEqual distingue 0 de -0)
const listar = (sub, re) => (fs.existsSync(path.join(RAIZ, sub)) ? fs.readdirSync(path.join(RAIZ, sub)).filter((f) => re.test(f)).sort() : []);
const MESES = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'].map((m) => `2025-${m}`);
const mesAnterior = (mes) => MESES[MESES.indexOf(mes) - 1] || null;

// Bancos de 2025 já importados → arquivos lidos pelo leitor de cada formato
const BANCOS = {
  BB: {
    pdf: lerExtratoBb,
    ofx: lerExtratoBbOfx,
    // PDFs que são só imagem (o BB exportou como figura): não dá para ler; junho entrou pelo OFX
    ilegiveis: ['BB FABIO MARÇO.pdf', 'BB FABIO ABRIL.pdf', 'BB FABIO JUNHO.pdf'],
  },
};
// Meses sem nenhum arquivo legível (PDF imagem e sem OFX): o encadeamento pula e o banco pode não ter o mês
const BURACOS = [{ banco: 'BB', conta: '36960', meses: ['2025-03', '2025-04'] }];
const buraco = (banco, conta, mes) => BURACOS.some((b) => b.banco === banco && b.conta === conta && b.meses.includes(mes));

// Saldo FINAL impresso em cada extrato (conta sem dígito → mês → saldo). null = mês sem arquivo legível.
const FIM_DE_MES = {
  'BB|58711': [613.4, 15901.05, 3070.93, 4476.94, 7327.38, 787.87, 714.29, 49848.6, 9320.89, 440.54, -1027.61, -247.22],
  'BB|37051': [2612.93, 389.58, 3060.69, 899.73, 709.54, 2198.98, 2030.1, 7589.31, 5228.13, 3055.72, 885.13, 0],
  'BB|36960': [12323.91, 2308.41, null, null, 46948.75, 4566.17, 393.61, 1834.01, 0, 699.6, 0, 0],
};
// Saldo em 31/12/2024 (fim do ano anterior) → saldo inicial de janeiro
const INICIO_2025 = { 'BB|58711': 9436.26, 'BB|37051': 4808.38, 'BB|36960': 4283.34 };

const ARQUIVOS = Object.entries(BANCOS).flatMap(([banco, def]) => [
  ...listar(banco, /\.pdf$/i).filter((f) => !def.ilegiveis.includes(f)).map((f) => ({ banco, arquivo: f, caminho: path.join(RAIZ, banco, f), ler: def.pdf, formato: 'pdf' })),
  ...listar(banco, /\.ofx$/i).map((f) => ({ banco, arquivo: f, caminho: path.join(RAIZ, banco, f), ler: def.ofx, formato: 'ofx' })),
]);
const leituras = new Map(); // arquivo → leitura
const chave = (l) => `${l.banco}|${l.conta}`;

// conta → mês → leituras (PDF e OFX)
const porContaMes = () => {
  const m = new Map();
  for (const l of leituras.values()) {
    const k = chave(l);
    if (!m.has(k)) m.set(k, new Map());
    const mm = m.get(k);
    if (!mm.has(l.mesReferencia)) mm.set(l.mesReferencia, []);
    mm.get(l.mesReferencia).push(l);
  }
  return m;
};

describeSe('extratos 2025 — saldo final de cada mês igual em todo lugar', () => {
  test('há extratos na pasta', () => {
    expect(ARQUIVOS.length).toBeGreaterThan(0);
  });

  test.each(ARQUIVOS.map((a) => [a.banco, a.arquivo, a]))('%s %s: saldo recalculado = saldo do extrato', async (_b, _f, a) => {
    const l = await a.ler(fs.readFileSync(a.caminho));
    l.arquivo = a.arquivo;
    l.formatoArquivo = a.formato;
    leituras.set(a.arquivo, l);
    expect(l.banco).toBe(a.banco);
    expect(l.mesReferencia).toMatch(/^2025-\d{2}$/);
    expect({ arquivo: a.arquivo, bate: l.conferencia.bate, divergencias: l.conferencia.divergencias || [] }).toEqual({ arquivo: a.arquivo, bate: true, divergencias: [] });
    expect({ arquivo: a.arquivo, saldoFinal: r2(l.saldoInicial + l.lancamentos.reduce((s, x) => s + x.valor, 0)) }).toEqual({ arquivo: a.arquivo, saldoFinal: r2(l.saldoFinal) });
  }, TIMEOUT);

  test('todos os arquivos foram lidos', () => {
    expect(leituras.size).toBe(ARQUIVOS.length);
  });

  test('PDF e OFX do mesmo mês têm o mesmo saldo inicial e final', () => {
    let comparados = 0;
    for (const [conta, meses] of porContaMes()) {
      for (const [mes, ls] of meses) {
        for (const l of ls.slice(1)) {
          expect({ conta, mes, arquivo: l.arquivo, saldoInicial: r2(l.saldoInicial), saldoFinal: r2(l.saldoFinal) }).toEqual({ conta, mes, arquivo: l.arquivo, saldoInicial: r2(ls[0].saldoInicial), saldoFinal: r2(ls[0].saldoFinal) });
          comparados++;
        }
      }
    }
    expect(comparados).toBeGreaterThan(0);
  });

  test('encadeamento: saldo inicial do mês = saldo final do mês anterior', () => {
    const verificados = [];
    for (const [conta, meses] of porContaMes()) {
      const [banco, numero] = conta.split('|');
      for (const mes of MESES) {
        const l = meses.get(mes)?.[0];
        if (!l) {
          expect({ conta, mes, temArquivo: false, buracoConhecido: buraco(banco, numero, mes) }).toEqual({ conta, mes, temArquivo: false, buracoConhecido: true });
          continue;
        }
        const ant = mesAnterior(mes);
        const esperado = ant ? (meses.get(ant)?.[0]?.saldoFinal ?? (buraco(banco, numero, ant) ? null : undefined)) : INICIO_2025[conta];
        if (esperado === null) continue; // mês anterior é buraco conhecido: não dá para encadear
        expect({ conta, mes, saldoInicial: r2(l.saldoInicial) }).toEqual({ conta, mes, saldoInicial: r2(esperado) });
        verificados.push(`${conta} ${mes}`);
      }
    }
    expect(verificados.length).toBeGreaterThan(0);
  });

  test('saldo final de cada mês = saldo impresso no extrato (tabela FIM_DE_MES)', () => {
    const contas = porContaMes();
    for (const [conta, saldos] of Object.entries(FIM_DE_MES)) {
      expect(contas.has(conta)).toBe(true);
      saldos.forEach((saldo, i) => {
        const mes = MESES[i];
        const l = contas.get(conta)?.get(mes)?.[0];
        if (saldo === null) {
          expect({ conta, mes, arquivo: l?.arquivo ?? null }).toEqual({ conta, mes, arquivo: null });
          return;
        }
        expect({ conta, mes, saldoFinal: l ? r2(l.saldoFinal) : null }).toEqual({ conta, mes, saldoFinal: saldo });
      });
    }
  });
});

describeBanco('extratos 2025 — saldos gravados no banco = saldos dos arquivos', () => {
  let imps = [];
  beforeAll(async () => {
    const { data, error } = await supabase.from('neb_importacoes').select('banco,conta,mes_referencia,saldo_inicial,saldo_final,arquivo_nome').gte('mes_referencia', '2025-01').lte('mes_referencia', '2025-12').in('banco', Object.keys(BANCOS));
    if (error) throw new Error(error.message);
    imps = data || [];
    // garante as leituras mesmo se só este describe rodar
    for (const a of ARQUIVOS) if (!leituras.has(a.arquivo)) leituras.set(a.arquivo, Object.assign(await a.ler(fs.readFileSync(a.caminho)), { arquivo: a.arquivo }));
  }, TIMEOUT);

  test('cada mês com arquivo legível está importado uma vez, com os saldos do arquivo', () => {
    for (const [conta, meses] of porContaMes()) {
      const [banco, numero] = conta.split('|');
      for (const mes of MESES) {
        const l = meses.get(mes)?.[0];
        const gravadas = imps.filter((i) => i.banco === banco && i.conta === numero && i.mes_referencia === mes);
        if (!l) {
          expect({ conta, mes, importacoes: gravadas.length, buracoConhecido: buraco(banco, numero, mes) }).toEqual({ conta, mes, importacoes: 0, buracoConhecido: true });
          continue;
        }
        expect({ conta, mes, importacoes: gravadas.length }).toEqual({ conta, mes, importacoes: 1 });
        expect({ conta, mes, saldoInicial: r2(gravadas[0].saldo_inicial), saldoFinal: r2(gravadas[0].saldo_final) }).toEqual({ conta, mes, saldoInicial: r2(l.saldoInicial), saldoFinal: r2(l.saldoFinal) });
      }
    }
  });

  test('saldo final gravado em dezembro = fim de ano da tabela', () => {
    for (const [conta, saldos] of Object.entries(FIM_DE_MES)) {
      const [banco, numero] = conta.split('|');
      const dez = imps.find((i) => i.banco === banco && i.conta === numero && i.mes_referencia === '2025-12');
      expect({ conta, saldoFinal: dez ? r2(dez.saldo_final) : null }).toEqual({ conta, saldoFinal: saldos[11] });
    }
  });
});
