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
import { lerExtratoBnb } from '../utils/extratoBnbPdf.js';
import { lerExtratoBbOfx, lerExtratoBnbOfx, lerExtratoCaixaOfx, lerExtratoSicrediOfx, lerExtratoUnicredOfx, lerExtratoDaycovalOfx } from '../utils/extratoCaixaOfx.js';
import { lerExtratoCaixaPdf } from '../utils/extratoCaixaPdf.js';
import { lerExtratoItau } from '../utils/extratoItauPdf.js';
import { lerExtratoSicredi } from '../utils/extratoSicrediPdf.js';
import { lerExtratoSantander } from '../utils/extratoSantanderPdf.js';
import { lerExtratoSantanderOfx } from '../utils/extratoSantanderOfx.js';
import { lerExtratoUnicred } from '../utils/extratoUnicredPdf.js';
import { lerExtratoBradesco } from '../utils/extratoBradescoPdf.js';

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
  BNB: {
    pdf: lerExtratoBnb, // "no período", "Extrato de Conta Corrente" (2025, pode trazer mais de um mês → array) e consolidado (array)
    ofx: lerExtratoBnbOfx, // BALAMT = saldo INICIAL do período
    ilegiveis: [
      // só imagem
      'BNB CROSBY 069918-1 DEZEMBRO.pdf', 'BNB FABIO 069921-1 DEZEMBRO.pdf',
      'BNB IRMAOS 069361-2 AGOSTO.pdf', 'BNB IRMAOS 069361-2 OUTUBRO.pdf', 'BNB IRMAOS 069363-9 AGOSTO.pdf', 'BNB IRMAOS 069363-9 OUTUBRO.pdf',
      // PDFs "no período" ERRADOS: dizem "Nenhuma movimentação" em mês com movimento (o OFX do mês e o saldo do mês seguinte provam)
      'BNB CROSBY 069918-1 FEVEREIRO.pdf', 'BNB CROSBY 069918-1 SETEMBRO.pdf', 'BNB CROSBY 069918-1 OUTUBRO.pdf',
      'BNB FABIO 069921-1 FEVEREIRO.pdf', 'BNB FABIO 069921-1 SETEMBRO.pdf', 'BNB FABIO 069921-1 OUTUBRO.pdf',
      'BNB CROSBY 069919-0 OUTUBRO.pdf',
    ],
  },
  CAIXA: {
    pdf: lerExtratoCaixaPdf, // PDF com texto (2025): layouts "Lançamentos de", "Extrato no período" (app) e "Extrato por período" (Gerenciador)
    ofx: lerExtratoCaixaOfx, // BALAMT costuma ser de DEPOIS do fim do mês (data da exportação) → saldo indefinido no arquivo, fecha pelo encadeamento
    ilegiveis: [
      // só imagem (Gerenciador CAIXA antigo)
      'CAIXA CROSBY JANEIRO.pdf', 'CAIXA CROSBY FEVEREIRO.pdf', 'CAIXA CROSBY MARÇO.pdf', 'CAIXA CROSBY DEZEMBRO.pdf',
      'CAIXA FABIO JANEIRO.pdf', 'CAIXA FABIO FEVEREIRO.pdf', 'CAIXA FABIO MARÇO.pdf', 'CAIXA FABIO DEZEMBRO.pdf',
      'CAIXA IRMAOS JANEIRO.pdf', 'CAIXA IRMAOS FEVEREIRO.pdf', 'CAIXA IRMAOS MARÇO.pdf', 'CAIXA IRMAOS DEZEMBRO.pdf',
      // PDF do app usa data de PROCESSAMENTO: a TAR EXT EL de 28/10 (0,20) só aparece no PDF de novembro → saldo final do PDF de outubro
      // não é o do fim do mês (o OFX e o "Saldo anterior" do PDF de novembro provam: -9.916,05)
      'CAIXA CROSBY OUTUBRO.pdf',
    ],
  },
  ITAU: {
    pdf: lerExtratoItau, // jan–ago "lançamentos período" (layout B), set–dez "Lançamentos do período" (layout C); CONSOLIDADO = cópia do mês
    // sem OFX: o OFX do Itaú traz a aplicação automática misturada (centenas de milhares por mês) e o BALAMT não é o saldo da conta
    ilegiveis: [],
  },
  SICREDI: {
    pdf: lerExtratoSicredi, // layout clássico (jan–jul, nov) e Internet Banking Sicredi (ago–out)
    ofx: lerExtratoSicrediOfx, // BALAMT = saldo do fim do mês (31/12) → dezembro entra pelo OFX
    ilegiveis: ['SICREDI CROSBY DEZEMBRO.pdf', 'SICREDI FABIO DEZEMBRO.pdf', 'SICREDI IRMAOS DEZEMBRO.pdf'], // só imagem
  },
  SANTANDER: {
    pdf: lerExtratoSantander, // Internet Banking Empresarial (IBE jan–ago, IBPJ set–dez) e Consolidado Inteligente (Irmãos)
    ofx: lerExtratoSantanderOfx, // BALAMT na data da exportação (depois do mês) → saldo indefinido, compara só o movimento do mês
    ilegiveis: ['SANTANDER CROSBY DEZEMBRO.pdf'], // só imagem (dezembro da Crosby entra pelo OFX)
  },
  UNICRED: {
    pdf: lerExtratoUnicred, // layout A o ano todo; "Lançamentos futuros" (agendados) no fim do PDF ficam de fora
    ofx: lerExtratoUnicredOfx, // BALAMT = saldo do fim do mês
    ilegiveis: [],
  },
  BRADESCO: {
    pdf: lerExtratoBradesco, // "Extrato Mensal / Por Período" jan–nov (saldo = conta corrente + Invest Fácil); em jul/out/nov a tabela vem deslocada
    // sem OFX: BALAMT fixo e sem data (DTASOF zerado), com linhas de outros meses
    // CONSOLIDADO de maio: mesmo mês na base só conta corrente (1 → 1) — não se compara com o Mensal
    ilegiveis: ['BRADESCO CROSBY CONSOLIDADO MAIO.pdf', 'BRADESCO FABIO CONSOLIDADO MAIO.pdf'],
  },
  DAYCOVAL: {
    ofx: lerExtratoDaycovalOfx, // só dezembro/2025; BALAMT em 31/12; PDF é imagem
    ilegiveis: ['DAYCOVAL CROSBY DEZEMBRO.pdf'],
  },
};
// Meses em que o saldo inicial NÃO encadeia com o mês anterior por um buraco DENTRO do arquivo (dias faltando), conhecido e aceito
const QUEBRAS = [
  { banco: 'SANTANDER', conta: '13000599', mes: '2025-11', motivo: 'o PDF de novembro começa em 04/11: 03/11 ficou fora (R$ 927,07 de diferença com 31/10)' },
  { banco: 'BRADESCO', conta: '249374', mes: '2025-01', motivo: 'dez/2024 gravado na base só conta corrente (1,00); 2025 inteiro na base c/c + Invest Fácil do Extrato Mensal' },
  { banco: 'BRADESCO', conta: '249286', mes: '2025-01', motivo: 'idem' },
];
const quebra = (banco, conta, mes) => QUEBRAS.some((q) => q.banco === banco && q.conta === conta && q.mes === mes);
// Meses sem nenhum arquivo legível (PDF imagem/errado e sem OFX): o encadeamento pula e o banco pode não ter o mês
const BURACOS = [
  { banco: 'BB', conta: '36960', meses: ['2025-03', '2025-04'] },
  { banco: 'BNB', conta: '69918', meses: ['2025-02'] },
  { banco: 'BNB', conta: '69921', meses: ['2025-02'] },
  { banco: 'BNB', conta: '69922', meses: ['2025-08'] },
  { banco: 'BNB', conta: '69361', meses: ['2025-02', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-10', '2025-12'] }, // abril só até 23/04 (parcial)
  { banco: 'BNB', conta: '69363', meses: ['2025-02', '2025-03', '2025-04', '2025-05', '2025-07', '2025-08', '2025-09', '2025-10', '2025-12'] },
  { banco: 'CAIXA', conta: '000578136386', meses: ['2025-02', '2025-03'] },
  { banco: 'CAIXA', conta: '000578136459', meses: ['2025-02', '2025-03'] },
  { banco: 'CAIXA', conta: '000578136635', meses: ['2025-02', '2025-03'] },
  { banco: 'SICREDI', conta: '36734', meses: ['2025-07'] }, // Irmãos: julho não existe na pasta
  { banco: 'SANTANDER', conta: '13008301', meses: ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-10', '2025-11', '2025-12'] }, // Irmãos: só ago e set na pasta
  { banco: 'SANTANDER', conta: '29000199', meses: ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10'] }, // conta vinculada aberta em novembro
  { banco: 'BRADESCO', conta: '249374', meses: ['2025-12'] }, // dezembro não existe na pasta
  { banco: 'BRADESCO', conta: '249286', meses: ['2025-12'] },
  { banco: 'DAYCOVAL', conta: '001516580', meses: ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11'] }, // só dezembro na pasta
];
const buraco = (banco, conta, mes) => BURACOS.some((b) => b.banco === banco && b.conta === conta && b.meses.includes(mes));

// Saldo FINAL impresso em cada extrato (conta sem dígito → mês → saldo). null = mês sem arquivo legível.
const FIM_DE_MES = {
  'BB|58711': [613.4, 15901.05, 3070.93, 4476.94, 7327.38, 787.87, 714.29, 49848.6, 9320.89, 440.54, -1027.61, -247.22],
  'BB|37051': [2612.93, 389.58, 3060.69, 899.73, 709.54, 2198.98, 2030.1, 7589.31, 5228.13, 3055.72, 885.13, 0],
  'BB|36960': [12323.91, 2308.41, null, null, 46948.75, 4566.17, 393.61, 1834.01, 0, 699.6, 0, 0],
  'BNB|69918': [82.17, null, 229.12, 463.07, 418.31, 408.55, 180.93, 7.5, 2280.33, 0, 0, 0],
  'BNB|69919': [1218.99, 1218.99, 1218.99, 1218.99, 1218.99, 1218.99, 1218.99, 1208.99, 1208.99, 2557.87, 2557.87, 2557.87],
  'BNB|69921': [220148.07, null, 682.04, 356.87, 395.29, 320.03, 472.53, 367.53, 177.43, 0, 0, 0],
  'BNB|69922': [0, 0, 0, 0, 0, 0, 0, null, 0, 0, 0, 0],
  'BNB|69361': [259.04, null, 73.56, null, null, null, null, null, 110.14, null, 0, null],
  'BNB|69363': [0, null, null, null, null, 0, null, null, null, null, 0, null],
  // Caixa: jan e ago–dez só pelo OFX (saldo pelo encadeamento); dez inclui o 1º dia útil de janeiro/2026 (BALAMT em 02/01), como em 2024
  'CAIXA|000578136386': [425.2, null, null, 2808.45, 470.41, 1188.34, -7528.14, -9832.13, -9123.4, -9916.05, -7604.92, -11121.77],
  'CAIXA|000578136459': [659.86, null, null, 523.48, 331.09, 124.84, -9927.02, -9737.48, -9368.93, -10801.01, -8843.07, -12709.21],
  'CAIXA|000578136635': [236.49, null, null, 1767.69, 429.73, 809.98, -7953.26, -7583.87, -9985.92, -8866.84, 0, 7056.51],
  // Itaú: "SALDO TOTAL DISPONÍVEL DIA" do último dia (ou "SALDO TOTAL" quando há cheque bloqueado, fev/2025 do Fabio)
  'ITAU|27061': [6880.91, -45917.81, 125626.49, 20411.12, 69212.48, -44490.1, -41953.95, -51141.58, -50189.12, -50724.32, -54942.81, -52263.18],
  'ITAU|33688': [13536.51, -45094.67, 115647.16, 46250.55, 12840.46, -5138.32, -44942.94, -55249.39, -56291.13, -56327.59, -59093.1, -59246.18],
  'ITAU|39046': [-85527.29, -81952.52, 5152.29, 1914.1, 751.68, -85130.82, -85304.57, -84631.13, -97551.11, -106812.59, -12148.86, 0],
  'ITAU|98073': [1005.32, 506.77, 890.27, 2990.27, 447.27, 3389.28, 128.43, 820.49, 667.9, 321.19, 1209.83, 688.28],
  'ITAU|98141': [14017.26, 50.97, 1789.42, 2702.02, 723.94, 821.92, 107.3, 81.4, 69.21, 2097.32, 1351.81, 833.51],
  'SICREDI|32693': [5565.68, 623.86, 3133.86, 76377.57, 3457.09, 15877.04, 69.83, 85.78, 83.21, 844.42, -0.38, 20735.23],
  'SICREDI|36733': [3490.01, 8890.32, 62637.18, 2977.57, 233039.52, 30086.64, 342.45, 58.52, 53.43, 7998.09, 722.77, 0.83],
  'SICREDI|36734': [4067.68, -9273.76, 10710.32, 859.1, 711.15, 2579.63, null, -9659.22, -19360.34, -19948.61, -20000, -19987.56],
  // Santander: saldo impresso no fim do último dia do mês (IBE) ou "Saldo do dia" do último dia (IBPJ); dez da Crosby = nov + movimentos do OFX
  'SANTANDER|13000599': [729.17, -29509.97, -2861.77, 9824.43, -1464.24, -26398.63, -23789.54, -26010.72, -30886.26, -26101.56, -26139, -37292.11],
  'SANTANDER|13001128': [-23567.16, -23370.02, 144.72, 708.28, 272.78, -23633.5, -23312.73, -23282.55, -28091.65, -24107.79, -29634.62, -108],
  'SANTANDER|13006882': [-58921.8, -37027.67, 2783.72, 5034.77, 1237.95, -59591.52, -59768.44, -60245.84, -64603.89, -60380.57, -49583.76, -55315.99],
  'SANTANDER|13008301': [null, null, null, null, null, null, null, -1168.04, -1286.85, null, null, null],
  'SANTANDER|29000199': [null, null, null, null, null, null, null, null, null, null, 2574.47, 33756.6],
  'UNICRED|6850': [817, 2044.43, 757.07, 2421.96, 143.98, 319.76, -4687.9, -4635.37, -4983.06, -5320.42, -4818.78, -5479.02],
  'UNICRED|7098': [4548.6, 2299.1, 4777.2, 11688.05, 4236.73, 831.23, 1010.64, -4648.33, -4986.24, -4345.7, -2151.22, -5345.94],
  // Bradesco: saldo do Extrato Mensal (conta corrente + Invest Fácil)
  'BRADESCO|249374': [419.62, 7713.27, 9254.88, 1083.64, 149.14, 612.86, 228.19, 284.38, 0, 57.84, 10.08, null],
  'BRADESCO|249286': [353.24, -28397, 173.54, 1838.4, 191.9, 123.76, -29235.62, -29454.6, -30000, -29958.23, -29579.26, null],
  'DAYCOVAL|001516580': [null, null, null, null, null, null, null, null, null, null, null, 821],
};
// Saldo em 31/12/2024 (fim do ano anterior) → saldo inicial de janeiro
const INICIO_2025 = {
  'BB|58711': 9436.26, 'BB|37051': 4808.38, 'BB|36960': 4283.34,
  'BNB|69918': 1124.09, 'BNB|69919': 1038.99, 'BNB|69921': 1081.57, 'BNB|69922': 0, 'BNB|69361': 1043.99, 'BNB|69363': 0,
  'CAIXA|000578136386': 17259, 'CAIXA|000578136459': 2898.77, 'CAIXA|000578136635': 1397.81,
  'ITAU|27061': -42278.76, 'ITAU|33688': 93865.1, 'ITAU|39046': 8244.05, 'ITAU|98073': 2308.86, 'ITAU|98141': 31260.11,
  'SICREDI|32693': 12392.96, 'SICREDI|36733': 4935.25, 'SICREDI|36734': 39776.59,
  'SANTANDER|13000599': 11141.2, 'SANTANDER|13001128': 1095.23, 'SANTANDER|13006882': 8255.8,
  'UNICRED|6850': 369.19, 'UNICRED|7098': 848.05,
  'BRADESCO|249374': 1, 'BRADESCO|249286': 1, // base só c/c (o resto estava no Invest Fácil): janeiro está em QUEBRAS
};

const ARQUIVOS = Object.entries(BANCOS).flatMap(([banco, def]) => [
  ...(def.pdf ? listar(banco, /\.pdf$/i).filter((f) => !def.ilegiveis.includes(f)).map((f) => ({ banco, arquivo: f, caminho: path.join(RAIZ, banco, f), ler: def.pdf, formato: 'pdf' })) : []),
  ...(def.ofx ? listar(banco, /\.ofx$/i).map((f) => ({ banco, arquivo: f, caminho: path.join(RAIZ, banco, f), ler: def.ofx, formato: 'ofx' })) : []),
]);
const leituras = new Map(); // "arquivo#conta#mês" → leitura (um arquivo pode trazer várias contas/meses)
const chave = (l) => `${l.banco}|${l.conta}`;
const lidos = new Set(); // arquivos já lidos
const guardar = (a, r) => {
  lidos.add(a.arquivo);
  for (const l of Array.isArray(r) ? r : [r]) {
    if (l.parcial) continue; // mês não coberto até o último dia (ex.: abril até 23/04): não entra nas conferências de mês
    l.arquivo = a.arquivo;
    l.formatoArquivo = a.formato;
    l.saldoIndefinido = a.formato === 'ofx' && !!l.saldoFinalEm && l.saldoFinalEm > l.periodo.fim; // BALAMT de depois do mês
    // movimento do mês: no OFX com saldo indefinido (Santander) só as linhas do próprio mês (o arquivo traz o 1º dia útil seguinte);
    // no OFX fechado (Caixa dezembro, BALAMT em 02/01 já com as linhas de janeiro) todas as linhas, como o importador grava
    l.movimento = r2(l.lancamentos.filter((x) => !l.saldoIndefinido || x.data.slice(0, 7) === l.mesReferencia).reduce((s, x) => s + x.valor, 0));
    leituras.set(`${a.arquivo}#${l.conta}#${l.mesReferencia}`, l);
  }
  return Array.isArray(r) ? r : [r];
};
// leitura "de referência" do mês: a primeira com saldo definido (PDF ou OFX fechado), senão a indefinida
const referencia = (ls) => ls.find((l) => !l.saldoIndefinido) || ls[0];
// saldo no fim do mês: da leitura definida; se só há OFX indefinido, saldo do fim do mês anterior + movimentos
const fimDoMes = (contas, conta, mes) => {
  const ls = contas.get(conta)?.get(mes);
  if (!ls) return undefined; // sem arquivo
  const ref = referencia(ls);
  if (!ref.saldoIndefinido) return r2(ref.saldoFinal);
  const ant = mesAnterior(mes);
  const base = ant ? fimDoMes(contas, conta, ant) : INICIO_2025[conta];
  return base == null ? null : r2(base + ref.movimento);
};

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
    for (const l of guardar(a, await a.ler(fs.readFileSync(a.caminho)))) {
      expect(l.banco).toBe(a.banco);
      expect(l.mesReferencia).toMatch(/^2025-\d{2}$/);
      expect({ arquivo: a.arquivo, conta: l.conta, bate: l.conferencia.bate, divergencias: l.conferencia.divergencias || [] }).toEqual({ arquivo: a.arquivo, conta: l.conta, bate: true, divergencias: [] });
      expect({ arquivo: a.arquivo, conta: l.conta, saldoFinal: r2(l.saldoInicial + l.lancamentos.reduce((s, x) => s + x.valor, 0)) }).toEqual({ arquivo: a.arquivo, conta: l.conta, saldoFinal: r2(l.saldoFinal) });
    }
  }, TIMEOUT);

  test('todos os arquivos foram lidos', () => {
    expect(lidos.size).toBe(ARQUIVOS.length);
  });

  test('PDF e OFX do mesmo mês têm o mesmo saldo inicial e final', () => {
    let comparados = 0;
    for (const [conta, meses] of porContaMes()) {
      for (const [mes, ls] of meses) {
        for (const l of ls.slice(1)) {
          if (l.saldoIndefinido || ls[0].saldoIndefinido) {
            // um dos lados não tem saldo do fim do mês: compara o movimento (a quantidade pode diferir por linha de valor zero no OFX)
            expect({ conta, mes, arquivo: l.arquivo, movimento: l.movimento }).toEqual({ conta, mes, arquivo: l.arquivo, movimento: ls[0].movimento });
          } else expect({ conta, mes, arquivo: l.arquivo, saldoInicial: r2(l.saldoInicial), saldoFinal: r2(l.saldoFinal) }).toEqual({ conta, mes, arquivo: l.arquivo, saldoInicial: r2(ls[0].saldoInicial), saldoFinal: r2(ls[0].saldoFinal) });
          comparados++;
        }
      }
    }
    expect(comparados).toBeGreaterThan(0);
  });

  test('encadeamento: saldo inicial do mês = saldo final do mês anterior', () => {
    const verificados = [];
    const contas = porContaMes();
    for (const [conta, meses] of contas) {
      const [banco, numero] = conta.split('|');
      for (const mes of MESES) {
        const ls = meses.get(mes);
        if (!ls) {
          expect({ conta, mes, temArquivo: false, buracoConhecido: buraco(banco, numero, mes) }).toEqual({ conta, mes, temArquivo: false, buracoConhecido: true });
          continue;
        }
        const l = referencia(ls);
        if (l.saldoIndefinido) continue; // só OFX com BALAMT de depois do mês: o saldo dele É o encadeamento, nada a conferir aqui
        if (quebra(banco, numero, mes)) continue; // dias faltando dentro do arquivo: quebra conhecida
        const ant = mesAnterior(mes);
        const esperado = ant ? (meses.get(ant) ? fimDoMes(contas, conta, ant) : buraco(banco, numero, ant) ? null : undefined) : INICIO_2025[conta];
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
        expect({ conta, mes, saldoFinal: l ? fimDoMes(contas, conta, mes) : null }).toEqual({ conta, mes, saldoFinal: saldo });
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
    for (const a of ARQUIVOS) if (!lidos.has(a.arquivo)) guardar(a, await a.ler(fs.readFileSync(a.caminho)));
  }, TIMEOUT);

  test('cada mês com arquivo legível está importado uma vez, com os saldos do arquivo', () => {
    const contas = porContaMes();
    for (const [conta, meses] of contas) {
      const [banco, numero] = conta.split('|');
      for (const mes of MESES) {
        const ls = meses.get(mes);
        const gravadas = imps.filter((i) => i.banco === banco && i.conta === numero && i.mes_referencia === mes);
        if (!ls) {
          expect({ conta, mes, importacoes: gravadas.length, buracoConhecido: buraco(banco, numero, mes) }).toEqual({ conta, mes, importacoes: 0, buracoConhecido: true });
          continue;
        }
        const l = referencia(ls);
        expect({ conta, mes, importacoes: gravadas.length }).toEqual({ conta, mes, importacoes: 1 });
        // saldo final do mês: do arquivo ou, no OFX com BALAMT de depois do mês, pelo encadeamento
        const fim = fimDoMes(contas, conta, mes);
        const ini = r2(fim - l.movimento);
        expect({ conta, mes, saldoInicial: r2(gravadas[0].saldo_inicial), saldoFinal: r2(gravadas[0].saldo_final) }).toEqual({ conta, mes, saldoInicial: ini, saldoFinal: fim });
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
