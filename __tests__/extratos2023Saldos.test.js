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
import { lerExtratoBbOfx, bancoDoOfx, ehOfx } from '../utils/extratoCaixaOfx.js';

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
};
// Meses em que o saldo inicial NÃO encadeia com o mês anterior por um buraco DENTRO do arquivo, conhecido e aceito
const QUEBRAS = [];
const quebra = (banco, conta, mes) => QUEBRAS.some((q) => q.banco === banco && q.conta === conta && q.mes === mes);
// Meses sem nenhum arquivo legível: o encadeamento pula e o banco pode não ter o mês
const BURACOS = [];
const buraco = (banco, conta, mes) => BURACOS.some((b) => b.banco === banco && b.conta === conta && b.meses.includes(mes));

// Saldo FINAL impresso em cada extrato (conta sem dígito → mês → saldo). null = mês sem arquivo legível.
const FIM_DE_MES = {
  'BB|58711': [4864.72, 5231.91, 9881.72, -536.13, 5654.81, 10959.59, 7598.49, 15696.41, 5229.3, 15895.09, 1359.32, 51259.77],
};
// Saldo em 31/12/2022 ("Saldo Anterior" do extrato de janeiro/2023) → saldo inicial de janeiro
const INICIO_2023 = {
  'BB|58711': 59708.73,
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
  ),
);
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
    l.saldoIndefinido = a.formato === 'ofx' && !BANCOS[a.banco].ofxFechado && !!l.saldoFinalEm && l.saldoFinalEm > l.periodo.fim;
    l.movimento = r2(l.lancamentos.filter((x) => !l.saldoIndefinido || x.data.slice(0, 7) === l.mesReferencia).reduce((s, x) => s + x.valor, 0));
    leituras.set(`${a.arquivo}#${l.conta}#${l.mesReferencia}`, l);
  }
  return Array.isArray(r) ? r : [r];
};
const referencia = (ls) => ls.find((l) => !l.saldoIndefinido) || ls[0];
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
    for (const l of guardar(a, await a.ler(fs.readFileSync(a.caminho)))) {
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
