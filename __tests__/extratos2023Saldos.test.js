// ============================================================
// Extratos de 2023 (pasta "EXTRATOS 2023", separada por EMPRESA / BANCO / MÊS): o SALDO FINAL de cada mês
// tem que ser igual em todo lugar —
//   • saldo recalculado (saldo inicial + lançamentos) = saldo final impresso no extrato, sem divergência diária
//   • PDF e OFX do mesmo mês e conta → mesmo saldo inicial e final
//   • encadeamento: saldo inicial do mês = saldo final do mês anterior (buracos conhecidos listados)
//   • tabela FIM_DE_MES: saldo final impresso em cada extrato, conta a conta, mês a mês
//   • banco de dados (neb_importacoes): saldo inicial/final gravado = saldo do arquivo, todos os meses presentes,
//     e dezembro/2023 = saldo inicial gravado de janeiro/2024
// Só entram os bancos já importados em 2023 (BANCOS); os outros entram conforme forem importados.
// Os arquivos ficam fora do repositório (Desktop do Yago); sem a pasta o teste é pulado; sem SUPABASE_SERVICE_KEY, só a parte do banco é pulada.
// Rodar só este: npm test -- __tests__/extratos2023Saldos.test.js
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import supabase from '../config/supabase.js';
import { lerExtratoBb } from '../utils/extratoBbPdf.js';
import { lerExtratoBnb } from '../utils/extratoBnbPdf.js';
import { lerExtratoBbOfx, lerExtratoBnbOfx, lerExtratoCaixaOfx, lerExtratoUnicredOfx, bancoDoOfx, ehOfx } from '../utils/extratoCaixaOfx.js';
import { lerExtratoCaixaPdf } from '../utils/extratoCaixaPdf.js';
import { leiturasCaixaTranscritas } from '../utils/extratoCaixaTranscrito.js';
import { lerExtratoItau } from '../utils/extratoItauPdf.js';
import { lerExtratoItauOfx } from '../utils/extratoItauOfx.js';
import { lerExtratoSantander } from '../utils/extratoSantanderPdf.js';
import { lerExtratoSantanderOfx } from '../utils/extratoSantanderOfx.js';
import { lerExtratoBradesco } from '../utils/extratoBradescoPdf.js';
import { lerExtratoUnicred } from '../utils/extratoUnicredPdf.js';

const RAIZ = process.env.EXTRATOS_2023_DIR || 'C:/Users/yagom/Desktop/EXTRATOS 2023';
const temPasta = fs.existsSync(RAIZ);
const describeSe = temPasta ? describe : describe.skip;
const describeBanco = temPasta && process.env.SUPABASE_SERVICE_KEY && !process.env.NEB_TEST_SKIP ? describe : describe.skip;
const TIMEOUT = 180000;
const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100 + 0; // "+ 0" tira o -0 (toEqual distingue 0 de -0)
const MESES = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'].map((m) => `2023-${m}`);
const mesAnterior = (mes) => MESES[MESES.indexOf(mes) - 1] || null;
const EMPRESAS = ['FERREIRA', 'AZ', 'FA MODAS', 'IRMAOS'];

// Bancos de 2023 já importados. `pasta` = nome da subpasta do banco dentro de cada empresa.
const BANCOS = {
  BB: {
    pasta: 'BB',
    pdf: lerExtratoBb, // jan–mar: impresso pelo navegador (cabeçalho em três linhas, uma data só); abr–dez: layout de 2024
    ofx: lerExtratoBbOfx, // .ofx ou .txt com conteúdo OFX; BALAMT = saldo do fim do período (DTASOF é só a data da exportação)
    bankId: 1, // na pasta do BB de março há um OFX da Caixa arquivado: fica de fora
    ofxFechado: true,
    ilegiveis: [],
  },
  BNB: {
    pasta: 'BNB',
    pdf: lerExtratoBnb, // "Extrato de Conta Corrente" das contas antigas (agência 185): 2286/2287 Crosby Distribuição, 2824/3228 Fabio
    // BALAMT = saldo INICIAL do período; o arquivo de nov/2023 do Fabio vai até 01/12 (a tarifa de 01/12 se repete em dezembro) → o leitor corta no fim do mês
    ofx: lerExtratoBnbOfx,
    bankId: 4,
    ilegiveis: [],
  },
  CAIXA: {
    pasta: 'CEF',
    // contas antigas (2044 | 003 | 4609-4 Crosby e 4737-6 Fabio) = as de 2024 (000578136386-2 e 000578136459-1), gravadas com o número novo.
    // jan–jul: "Extrato por período" do Internet Banking, texto com espaços no meio das palavras; out–dez: Gerenciador CAIXA.
    // Na pasta da FA Modas há cópias de arquivos da Crosby com nome de "FB/FABIO" (mar, mai, jun, jul): contam como leitura da conta da Crosby.
    pdf: lerExtratoCaixaPdf,
    // BALAMT é o saldo na data da exportação (às vezes com o limite junto) → do OFX só se compara o movimento do mês
    ofx: lerExtratoCaixaOfx,
    bankId: 104,
    ofxSoMovimento: true,
    // só imagem (Gerenciador CAIXA emitido em 02/01/2025): mar/ago/set entram pela transcrição (utils/extratoCaixaTranscrito.js); mai e jul pelo OFX
    ilegiveis: ['FA MODAS/CEF/03/caixa_mar23.pdf', 'FA MODAS/CEF/05/caixa_mai23.pdf', 'FA MODAS/CEF/07/caixa_jul23.pdf', 'FA MODAS/CEF/08/caixa_ago23.pdf', 'FA MODAS/CEF/09/caixa_set23.pdf'],
    // leituras que não vêm de um leitor de arquivo: meses transcritos do PDF-imagem
    extras: () => leiturasCaixaTranscritas().map((l) => ({ arquivo: `FA MODAS/CEF/${l.mesReferencia.slice(5)}/${l.arquivo} (transcrito)`, leitura: l })),
  },
  ITAU: {
    pasta: 'ITAU',
    // "lançamentos período" de 2023: o dia fecha com "SALDO DO DIA" ou, na conta com aplicação automática (39046), "SDO CTA/APL AUTOMATICAS"
    pdf: lerExtratoItau,
    // o OFX de 2023 traz as linhas de saldo (SALDO ANTERIOR, saldo de cada dia) e se confere sozinho; bate com o PDF centavo a centavo
    ofx: lerExtratoItauOfx,
    bankId: 341,
    ofxFechado: true,
    ilegiveis: [
      'AZ/ITAU/02/Extrato_6530-390464-02-01-2024.pdf', // reemitido em 2024, sem saldo do dia no PDF: fevereiro entra pelo OFX
      'FA MODAS/ITAU/01/ITAU FB JAN OFX.ofx', // OFX sem as linhas de saldo: janeiro entra pelo PDF
      'FERREIRA/ITAU/10/ITAU CROSBY PDF OUTUBRO.pdf', // o arquivo é de 01 a 08/11 (parcial): outubro entra pelo OFX
      'AZ/ITAU/11/ITAU FL OFX SETEMBRO.ofx', 'AZ/ITAU/11/ITAU FL SETEMBRO.pdf', // cópias de setembro na pasta de novembro
    ],
  },
  SANTANDER: {
    pasta: 'SANTANDER',
    // Internet Banking Empresarial (IBE) o ano todo: Crosby 13000599-5, Crosby João Pessoa 13001128-2 e Fabio 13006882-4.
    // Na pasta da FA Modas o "PDF de julho" é da conta João Pessoa da Crosby: julho do Fabio entra pelo OFX.
    pdf: lerExtratoSantander,
    // BALAMT na data da exportação (depois do mês) e, em abr/set/dez, com o 1º dia útil do mês seguinte → só o movimento do mês
    ofx: lerExtratoSantanderOfx,
    bankId: 33,
    ofxSoMovimento: true,
    ilegiveis: [],
  },
  BRADESCO: {
    pasta: 'BRADESCO',
    // "Extrato Mensal / Por Período" de 2023: saldo só da conta corrente (fica em 1,00; o resto vai e volta do Invest Fácil).
    // A seção "Últimos Lançamentos" entra quando continua a tabela principal (mar/2023 da Crosby: o dia 31/03 só está nela)
    // e é ignorada quando repete a última linha (mai e nov/2023) ou já é do mês seguinte.
    pdf: lerExtratoBradesco,
    // sem OFX: BALAMT sem data e linhas repetidas (nov/2023 da Crosby traz a aplicação de 7.000,00 duas vezes)
    ilegiveis: [],
  },
  UNICRED: {
    pasta: 'UNICRED',
    // "Extrato de Conta Corrente" (layout B) o ano todo, menos jan do Fabio (layout A). Nos PDFs impressos pelo navegador
    // (jan–mar) a linha da quebra de página sai nas duas páginas: o leitor reconhece a repetição pelo saldo igual.
    pdf: lerExtratoUnicred,
    ofx: lerExtratoUnicredOfx, // BALAMT = saldo do fim do mês
    bankId: 136,
    ofxFechado: true,
    ilegiveis: ['FA MODAS/UNICRED/01/Unicred Fabio Fev (1).pdf'], // cópia do PDF de fevereiro na pasta de janeiro
  },
};
// Meses em que o saldo inicial NÃO encadeia com o mês anterior por um buraco DENTRO do arquivo, conhecido e aceito
const QUEBRAS = [];
const quebra = (banco, conta, mes) => QUEBRAS.some((q) => q.banco === banco && q.conta === conta && q.mes === mes);
// Meses sem nenhum arquivo legível: o encadeamento pula e o banco pode não ter o mês
const BURACOS = [
  { banco: 'BNB', conta: '2286', meses: ['2023-10'] }, // outubro não veio (set termina 976,59 e nov começa 4.071,59)
  { banco: 'BNB', conta: '2287', meses: ['2023-01', '2023-02', '2023-04', '2023-05', '2023-06', '2023-07', '2023-08', '2023-09', '2023-10', '2023-11', '2023-12'] }, // só o OFX de março (sem movimento)
  { banco: 'BNB', conta: '3228', meses: ['2023-04'] }, // conta sem movimento o ano todo; abril não veio
  { banco: 'CAIXA', conta: '000578136386', meses: ['2023-08', '2023-09'] }, // Crosby: agosto e setembro não vieram (jul termina 2.426,06 e out começa 13.207,69)
  { banco: 'SANTANDER', conta: '13001128', meses: ['2023-02', '2023-08', '2023-09', '2023-11'] }, // João Pessoa: fev, ago, set e nov não vieram
];
const buraco = (banco, conta, mes) => BURACOS.some((b) => b.banco === banco && b.conta === conta && b.meses.includes(mes));

// Saldo FINAL impresso em cada extrato (conta sem dígito → mês → saldo). null = mês sem arquivo legível.
const FIM_DE_MES = {
  'BB|58711': [4864.72, 5231.91, 9881.72, -536.13, 5654.81, 10959.59, 7598.49, 15696.41, 5229.3, 15895.09, 1359.32, 51259.77],
  'BNB|2286': [696.67, 612.19, 3418.79, 226.22, 83.07, 646.79, 3165.68, 3999.09, 976.59, null, 2211.39, 2106.39],
  'BNB|2287': [null, null, 0, null, null, null, null, null, null, null, null, null],
  'BNB|2824': [2980.17, 1058.76, 79.46, 177.88, 361.26, 323.51, 78.98, 585.65, 588.63, 653.29, 1592.64, 2640.93],
  'BNB|3228': [0, 0, 0, null, 0, 0, 0, 0, 0, 0, 0, 0],
  'CAIXA|000578136386': [1443.42, 656.23, 16.85, -3163.15, 11489.14, 9000.85, 2426.06, null, null, 7550.35, 11611, 9451.68],
  // Fabio: mar/ago/set transcritos do PDF-imagem; mai e jul pelo OFX (saldo pelo encadeamento, igual ao do PDF-imagem do mês)
  'CAIXA|000578136459': [189.4, 0, 0, 30.86, 559.97, 1326.35, 43.51, 1444.96, 6217.66, 1327.83, -9729.12, -7944.03],
  // Itaú: "SALDO DO DIA" do último dia (39046: conta + aplicação automática)
  'ITAU|27061': [2316.09, 8833.86, 8718.49, -17098.18, -5235.44, 20478.19, 14551.85, 92861.78, 28144.47, 71405.32, 15908.62, 112683.02],
  'ITAU|33688': [40.92, 3160.23, 7037.73, -5813.88, -27867.85, 4192.36, 22168.85, 13824.87, 18361.01, 34475.43, 14808.8, 85261.05],
  'ITAU|39046': [55.78, 670.59, 177.69, -1998.43, 18708.97, 198.24, 932.54, 8066.06, 1948.53, 7061.07, 4498.61, 189111.37],
  // Santander: saldo impresso no fim do último dia do mês (IBE); julho do Fabio = junho + movimento do OFX (igual ao início de agosto)
  'SANTANDER|13000599': [0, 1539.95, 552.63, -16055.19, 0, 316.93, 8242.27, 8485.68, 3559.89, 10654.11, 417.76, 290030.44],
  'SANTANDER|13001128': [0, null, 0, 0, 0, 5443.37, 6221.45, null, null, 175.95, null, 3100.95],
  'SANTANDER|13006882': [0, 0, 0, 0, 0, 109.95, 8068.26, 2029.8, 1912.24, 76.11, 8.62, 6549.48],
  // Bradesco: saldo da conta corrente (o Invest Fácil fica de fora, como em 2024)
  'BRADESCO|249374': [11.87, 1, 1, 1, 1, 20.58, 1, 1, 1, 1, 1, 1],
  'BRADESCO|249286': [1, 9.89, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  'UNICRED|6850': [14583.56, 6028.65, 1648.84, 3742.69, 6698.79, 11797.24, 24387.65, 21328.76, 22006.97, 8505.88, 22079.73, 2022.86],
  'UNICRED|7098': [17441.83, 69.94, 3.3, 20.01, 66522.62, 329.77, 5233.29, 3230.05, 1331.55, 11855.77, 2945.96, 1335.44],
};
// Saldo em 31/12/2022 ("Saldo Anterior" do extrato de janeiro/2023) → saldo inicial de janeiro
const INICIO_2023 = {
  'BB|58711': 59708.73,
  'BNB|2286': 791.49, 'BNB|2824': 4820.55, 'BNB|3228': 0,
  'CAIXA|000578136386': 23340.95, 'CAIXA|000578136459': 23118.8,
  'ITAU|27061': 4286.53, 'ITAU|33688': 4988.17, 'ITAU|39046': 6214.35,
  'SANTANDER|13000599': -14873.5, 'SANTANDER|13001128': 0, 'SANTANDER|13006882': 0,
  'BRADESCO|249374': 1, 'BRADESCO|249286': 1,
  'UNICRED|6850': 4101.48, 'UNICRED|7098': 613.47,
};

// arquivos: RAIZ/<EMPRESA>/<pasta do banco>/<MÊS>/arquivo (o nome se repete entre meses → a chave é o caminho relativo)
const andar = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? andar(path.join(dir, e.name)) : [path.join(dir, e.name)])) : []);
const ARQUIVOS = Object.entries(BANCOS).flatMap(([banco, def]) =>
  EMPRESAS.flatMap((emp) =>
    andar(path.join(RAIZ, emp, def.pasta))
      .sort()
      .map((caminho) => {
        const arquivo = path.relative(RAIZ, caminho).replace(/\\/g, '/');
        if (def.ilegiveis.includes(arquivo)) return null;
        if (/\.pdf$/i.test(caminho)) return def.pdf ? { banco, arquivo, caminho, ler: def.pdf, formato: 'pdf' } : null;
        if (!def.ofx || !/\.(ofx|ofc|txt)$/i.test(caminho)) return null;
        const buf = fs.readFileSync(caminho);
        if (!ehOfx(buf) || (def.bankId != null && bancoDoOfx(buf) !== def.bankId)) return null;
        return { banco, arquivo, caminho, ler: def.ofx, formato: 'ofx' };
      })
      .filter(Boolean),
  ).concat((def.extras ? def.extras() : []).map((e) => ({ banco, arquivo: e.arquivo, caminho: null, ler: async () => e.leitura, formato: 'pdf' }))),
);
const lerArquivo = (a) => a.ler(a.caminho ? fs.readFileSync(a.caminho) : null);
const leituras = new Map(); // "arquivo#conta#mês" → leitura
const chave = (l) => `${l.banco}|${l.conta}`;
const lidos = new Set();
const guardar = (a, r) => {
  lidos.add(a.arquivo);
  for (const l of Array.isArray(r) ? r : [r]) {
    if (l.parcial) continue;
    l.arquivo = a.arquivo;
    l.formatoArquivo = a.formato;
    // OFX com BALAMT de depois do mês: saldo indefinido no arquivo, salvo nos bancos em que o BALAMT é o do fim do período (ofxFechado)
    // (ofxSoMovimento: o BALAMT nunca serve como saldo do fim do mês)
    l.saldoIndefinido = a.formato === 'ofx' && (!!BANCOS[a.banco].ofxSoMovimento || (!BANCOS[a.banco].ofxFechado && !!l.saldoFinalEm && l.saldoFinalEm > l.periodo.fim));
    l.movimento = r2(l.lancamentos.filter((x) => !l.saldoIndefinido || x.data.slice(0, 7) === l.mesReferencia).reduce((s, x) => s + x.valor, 0));
    leituras.set(`${a.arquivo}#${l.conta}#${l.mesReferencia}`, l);
  }
  return Array.isArray(r) ? r : [r];
};
// leitura de referência do mês: PDF com saldo definido (é o que se importa quando existe), senão OFX fechado, senão a indefinida
const referencia = (ls) => ls.find((l) => !l.saldoIndefinido && l.formatoArquivo === 'pdf') || ls.find((l) => !l.saldoIndefinido) || ls[0];
const fimDoMes = (contas, conta, mes) => {
  const ls = contas.get(conta)?.get(mes);
  if (!ls) return undefined;
  const ref = referencia(ls);
  if (!ref.saldoIndefinido) return r2(ref.saldoFinal);
  const ant = mesAnterior(mes);
  const base = ant ? fimDoMes(contas, conta, ant) : INICIO_2023[conta];
  return base == null ? null : r2(base + ref.movimento);
};
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

describeSe('extratos 2023 — saldo final de cada mês igual em todo lugar', () => {
  test('há extratos na pasta', () => {
    expect(ARQUIVOS.length).toBeGreaterThan(0);
  });

  test('nada da Shopping Recife na pasta', () => {
    expect(andar(RAIZ).filter((f) => /recife\s*mall|shopping\s*recife/i.test(f))).toEqual([]);
  });

  test.each(ARQUIVOS.map((a) => [a.banco, a.arquivo, a]))('%s %s: saldo recalculado = saldo do extrato', async (_b, _f, a) => {
    for (const l of guardar(a, await lerArquivo(a))) {
      expect(l.banco).toBe(a.banco);
      expect(l.mesReferencia).toMatch(/^2023-\d{2}$/);
      expect(l.mesReferencia.slice(5)).toBe(a.arquivo.split('/')[2]); // o mês lido é o da pasta do mês
      expect({ arquivo: a.arquivo, conta: l.conta, bate: l.conferencia.bate, divergencias: l.conferencia.divergencias || [] }).toEqual({ arquivo: a.arquivo, conta: l.conta, bate: true, divergencias: [] });
      expect({ arquivo: a.arquivo, conta: l.conta, saldoFinal: r2(l.saldoInicial + l.lancamentos.reduce((s, x) => s + x.valor, 0)) }).toEqual({ arquivo: a.arquivo, conta: l.conta, saldoFinal: r2(l.saldoFinal) });
    }
  }, TIMEOUT);

  test('todos os arquivos foram lidos', () => {
    expect(lidos.size).toBe(ARQUIVOS.length);
  });

  test('PDF e OFX do mesmo mês têm o mesmo saldo inicial, saldo final e movimento', () => {
    let comparados = 0;
    for (const [conta, meses] of porContaMes()) {
      for (const [mes, ls] of meses) {
        for (const l of ls.slice(1)) {
          if (l.saldoIndefinido || ls[0].saldoIndefinido) {
            expect({ conta, mes, arquivo: l.arquivo, movimento: l.movimento }).toEqual({ conta, mes, arquivo: l.arquivo, movimento: ls[0].movimento });
          } else {
            expect({ conta, mes, arquivo: l.arquivo, saldoInicial: r2(l.saldoInicial), saldoFinal: r2(l.saldoFinal), movimento: l.movimento }).toEqual({ conta, mes, arquivo: l.arquivo, saldoInicial: r2(ls[0].saldoInicial), saldoFinal: r2(ls[0].saldoFinal), movimento: ls[0].movimento });
          }
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
        if (l.saldoIndefinido) continue;
        if (quebra(banco, numero, mes)) continue;
        const ant = mesAnterior(mes);
        const esperado = ant ? (meses.get(ant) ? fimDoMes(contas, conta, ant) : buraco(banco, numero, ant) ? null : undefined) : INICIO_2023[conta];
        if (esperado === null) continue;
        expect({ conta, mes, saldoInicial: r2(l.saldoInicial) }).toEqual({ conta, mes, saldoInicial: r2(esperado) });
        verificados.push(`${conta} ${mes}`);
      }
    }
    expect(verificados.length).toBeGreaterThan(0);
  });

  test('saldo final de cada mês = saldo impresso no extrato (tabela FIM_DE_MES)', () => {
    const contas = porContaMes();
    expect([...contas.keys()].sort()).toEqual(Object.keys(FIM_DE_MES).sort()); // nenhuma conta fora da tabela
    for (const [conta, saldos] of Object.entries(FIM_DE_MES)) {
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

describeBanco('extratos 2023 — saldos gravados no banco = saldos dos arquivos', () => {
  let imps = [];
  let lancs = [];
  let jan2024 = [];
  beforeAll(async () => {
    const bancos = Object.keys(BANCOS);
    const { data, error } = await supabase.from('neb_importacoes').select('id,banco,conta,mes_referencia,saldo_inicial,saldo_final,qtd,arquivo_nome').gte('mes_referencia', '2023-01').lte('mes_referencia', '2023-12').in('banco', bancos);
    if (error) throw new Error(error.message);
    imps = data || [];
    const j = await supabase.from('neb_importacoes').select('banco,conta,saldo_inicial').eq('mes_referencia', '2024-01').in('banco', bancos);
    if (j.error) throw new Error(j.error.message);
    jan2024 = j.data || [];
    // lançamentos gravados de 2023 (paginado, com desempate por id)
    for (let de = 0; ; de += 1000) {
      const p = await supabase.from('neb_lancamentos').select('id,importacao_id,valor').in('importacao_id', imps.map((i) => i.id)).order('id').range(de, de + 999);
      if (p.error) throw new Error(p.error.message);
      lancs.push(...p.data);
      if (p.data.length < 1000) break;
    }
    for (const a of ARQUIVOS) if (!lidos.has(a.arquivo)) guardar(a, await lerArquivo(a));
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
        const fim = fimDoMes(contas, conta, mes);
        const ini = r2(fim - l.movimento);
        expect({ conta, mes, saldoInicial: r2(gravadas[0].saldo_inicial), saldoFinal: r2(gravadas[0].saldo_final) }).toEqual({ conta, mes, saldoInicial: ini, saldoFinal: fim });
      }
    }
  });

  test('lançamentos gravados de cada mês: mesma quantidade e mesma soma do arquivo', () => {
    const contas = porContaMes();
    for (const [conta, meses] of contas) {
      const [banco, numero] = conta.split('|');
      for (const [mes, ls] of meses) {
        const imp = imps.find((i) => i.banco === banco && i.conta === numero && i.mes_referencia === mes);
        if (!imp) continue; // já acusado no teste anterior
        const l = referencia(ls);
        const doMes = lancs.filter((x) => x.importacao_id === imp.id);
        expect({ conta, mes, qtd: doMes.length, soma: r2(doMes.reduce((s, x) => s + Number(x.valor), 0)) }).toEqual({ conta, mes, qtd: l.lancamentos.length, soma: l.movimento });
      }
    }
  });

  test('nenhuma conta de 2023 gravada fora da tabela', () => {
    expect([...new Set(imps.map((i) => `${i.banco}|${i.conta}`))].sort()).toEqual(Object.keys(FIM_DE_MES).sort());
  });

  test('saldo final gravado em dezembro/2023 = tabela = saldo inicial gravado de janeiro/2024', () => {
    for (const [conta, saldos] of Object.entries(FIM_DE_MES)) {
      const [banco, numero] = conta.split('|');
      const dez = imps.find((i) => i.banco === banco && i.conta === numero && i.mes_referencia === '2023-12');
      expect({ conta, saldoFinal: dez ? r2(dez.saldo_final) : null }).toEqual({ conta, saldoFinal: saldos[11] });
      const jan = jan2024.find((i) => i.banco === banco && i.conta === numero);
      if (jan && saldos[11] !== null) expect({ conta, saldoInicialJan2024: r2(jan.saldo_inicial) }).toEqual({ conta, saldoInicialJan2024: saldos[11] });
    }
  });
});
