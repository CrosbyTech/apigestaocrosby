/**
 * Faturamento por vendedor, mês a mês, com cache permanente no Supabase.
 *
 * POR QUE EXISTE: a rota POST /sale-panel/faturamento-vendedor leva de 50 a
 * 110 s por mês e não responde em janelas longas (janeiro→setembro estourou
 * 542 s sem retorno). Mês fechado não muda mais, então é gravado uma vez em
 * `faturamento_vendedor_mensal` e lido em milissegundos.
 *
 * REGRA DE FECHAMENTO: só grava um mês 10 dias depois de ele terminar —
 * devolução e acerto ainda entram na virada. Mês ainda aberto (ou dentro da
 * carência) é consultado ao vivo no TOTVS a cada chamada.
 */
import axios from 'axios';
import supabase from '../config/supabase.js';

const TABELA = 'faturamento_vendedor_mensal';
const DIAS_CARENCIA = Number(process.env.FAT_VEND_DIAS_CARENCIA || 10);
const INTERNAL_API_BASE =
  process.env.INTERNAL_API_BASE_URL ||
  `http://localhost:${process.env.PORT || 4100}`;
const TZ = 'America/Sao_Paulo';

const hojeISO = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });

const ultimoDiaDoMes = (mes) => {
  const [y, m] = mes.split('-').map(Number);
  const dia = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${mes}-${String(dia).padStart(2, '0')}`;
};

const somarDias = (iso, dias) => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + dias);
  return dt.toISOString().slice(0, 10);
};

/** Lista de 'YYYY-MM' que o período toca (inclusive parciais nas pontas). */
export function mesesDoPeriodo(datemin, datemax) {
  const meses = [];
  let [y, m] = datemin.slice(0, 7).split('-').map(Number);
  const fim = datemax.slice(0, 7);
  for (let i = 0; i < 240; i++) {
    const mes = `${y}-${String(m).padStart(2, '0')}`;
    meses.push(mes);
    if (mes >= fim) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return meses;
}

/** Mês fechado = terminou há mais de DIAS_CARENCIA dias. */
export function mesEstaFechado(mes, hoje = hojeISO()) {
  return hoje > somarDias(ultimoDiaDoMes(mes), DIAS_CARENCIA);
}

/** Consulta um mês inteiro no TOTVS (rota pesada). */
export async function buscarMesNoTotvs(mes, { ini, fim } = {}) {
  const datemin = ini || `${mes}-01`;
  const datemax = fim || ultimoDiaDoMes(mes);
  const resp = await axios.post(
    `${INTERNAL_API_BASE}/api/totvs/sale-panel/faturamento-vendedor`,
    { datemin, datemax },
    { timeout: 600_000 },
  );
  return {
    datemin,
    datemax,
    linhas: resp.data?.data?.dataRow || [],
  };
}

/** Grava (ou regrava) um mês fechado. */
export async function salvarMes(mes, linhas, { datemin, datemax }) {
  if (!linhas.length) return 0;
  const registros = linhas.map((r) => ({
    mes: `${mes}-01`,
    seller_code: Number(r.seller_code),
    seller_name: r.seller_name || null,
    qtd: Number(r.qtd) || 0,
    valor: Number(r.valor) || 0,
    periodo_ini: datemin,
    periodo_fim: datemax,
    fechado_em: new Date().toISOString(),
  }));
  const { error } = await supabase
    .from(TABELA)
    .upsert(registros, { onConflict: 'mes,seller_code' });
  if (error) throw new Error(`gravar ${mes}: ${error.message}`);
  return registros.length;
}

/** Meses já gravados, em um Set de 'YYYY-MM'. */
export async function mesesGravados() {
  const { data, error } = await supabase.from(TABELA).select('mes');
  if (error) throw new Error(`ler meses: ${error.message}`);
  return new Set((data || []).map((r) => String(r.mes).slice(0, 7)));
}

/**
 * Faturamento por vendedor no período. Mês fechado sai do banco; mês
 * aberto (ou sem registro) vai ao TOTVS. As pontas parciais do período
 * são sempre consultadas ao vivo, porque o banco guarda mês cheio.
 */
export async function faturamentoPorPeriodo(datemin, datemax) {
  const meses = mesesDoPeriodo(datemin, datemax);
  const gravados = await mesesGravados();

  const doBanco = [];
  const doTotvs = [];
  for (const mes of meses) {
    const ini = `${mes}-01`;
    const fim = ultimoDiaDoMes(mes);
    // Ponta parcial não pode vir do banco: lá está o mês inteiro
    const parcial = datemin > ini || datemax < fim;
    if (!parcial && gravados.has(mes)) doBanco.push(mes);
    else
      doTotvs.push({
        mes,
        ini: datemin > ini ? datemin : ini,
        fim: datemax < fim ? datemax : fim,
      });
  }

  const porVendedor = new Map();
  const acumular = (code, name, qtd, valor) => {
    const k = Number(code);
    const atual = porVendedor.get(k) || {
      seller_code: k,
      seller_name: name || null,
      qtd: 0,
      valor: 0,
    };
    atual.qtd += Number(qtd) || 0;
    atual.valor += Number(valor) || 0;
    if (!atual.seller_name && name) atual.seller_name = name;
    porVendedor.set(k, atual);
  };

  if (doBanco.length > 0) {
    const { data, error } = await supabase
      .from(TABELA)
      .select('mes, seller_code, seller_name, qtd, valor')
      .in(
        'mes',
        doBanco.map((m) => `${m}-01`),
      );
    if (error) throw new Error(`ler faturamento: ${error.message}`);
    (data || []).forEach((r) =>
      acumular(r.seller_code, r.seller_name, r.qtd, r.valor),
    );
  }

  for (const alvo of doTotvs) {
    const { linhas } = await buscarMesNoTotvs(alvo.mes, alvo);
    linhas.forEach((r) =>
      acumular(r.seller_code, r.seller_name, r.qtd, r.valor),
    );
  }

  return {
    datemin,
    datemax,
    meses_do_banco: doBanco,
    meses_do_totvs: doTotvs.map((t) => t.mes),
    vendedores: [...porVendedor.values()]
      .map((v) => ({ ...v, valor: Math.round(v.valor * 100) / 100 }))
      .sort((a, b) => b.valor - a.valor),
  };
}

/**
 * Faturamento de cada vendedor na SUA propria janela.
 *
 * Cada vendedor entrou em uma data diferente, entao o periodo muda por
 * pessoa (Walter desde 01/01/2025, Rafael desde 10/03/2025...). Somar tudo
 * a partir de uma data unica inflaria quem entrou depois.
 *
 * Nao adianta "uma rota por vendedor": a rota do TOTVS devolve todos os
 * vendedores de uma vez e o custo esta na JANELA DE DATAS. Entao aqui as
 * consultas sao agrupadas por janela e reaproveitadas entre vendedores —
 * na pratica sobram 2 idas ao TOTVS (o mes aberto, comum a todos, e a
 * cabeca parcial de quem comecou no meio do mes).
 *
 * @param {Array<{seller_code:number, datemin:string, datemax?:string}>} janelas
 */
export async function faturamentoPorVendedorJanelas(janelas, datemaxGlobal) {
  const hoje = datemaxGlobal || hojeISO();
  const alvos = (janelas || [])
    .map((j) => ({
      seller_code: Number(j.seller_code),
      datemin: String(j.datemin || '').slice(0, 10),
      datemax: String(j.datemax || hoje).slice(0, 10),
    }))
    .filter((j) => j.seller_code && /^\d{4}-\d{2}-\d{2}$/.test(j.datemin));

  if (alvos.length === 0) return { vendedores: [], consultas_totvs: [], meses_do_banco: [] };

  const minGlobal = alvos.reduce((m, a) => (a.datemin < m ? a.datemin : m), alvos[0].datemin);
  const maxGlobal = alvos.reduce((m, a) => (a.datemax > m ? a.datemax : m), alvos[0].datemax);

  // ── 1. Meses fechados que ja estao no banco ────────────────────────────
  const gravados = await mesesGravados();
  const mesesRange = mesesDoPeriodo(minGlobal, maxGlobal);
  const mesesBanco = mesesRange.filter((m) => gravados.has(m) && mesEstaFechado(m, hoje));
  const doBanco = new Map(); // `${mes}|${code}` -> {valor, qtd, nome}

  if (mesesBanco.length > 0) {
    const { data, error } = await supabase
      .from(TABELA)
      .select('mes, seller_code, seller_name, qtd, valor')
      .in('mes', mesesBanco.map((m) => `${m}-01`));
    if (error) throw new Error(`ler faturamento: ${error.message}`);
    for (const r of data || []) {
      doBanco.set(`${String(r.mes).slice(0, 7)}|${Number(r.seller_code)}`, {
        valor: Number(r.valor) || 0,
        qtd: Number(r.qtd) || 0,
        nome: r.seller_name || null,
      });
    }
  }
  const setBanco = new Set(mesesBanco);

  // ── 2. Consultas ao TOTVS, deduplicadas por janela ─────────────────────
  const cacheJanela = new Map();
  const consultasFeitas = [];
  const buscarJanela = async (ini, fim) => {
    const k = `${ini}|${fim}`;
    if (cacheJanela.has(k)) return cacheJanela.get(k);
    const { linhas } = await buscarMesNoTotvs(ini.slice(0, 7), { ini, fim });
    const mapa = new Map();
    for (const r of linhas) {
      mapa.set(Number(r.seller_code), {
        valor: Number(r.valor) || 0,
        qtd: Number(r.qtd) || 0,
        nome: r.seller_name || null,
      });
    }
    cacheJanela.set(k, mapa);
    consultasFeitas.push(k);
    return mapa;
  };

  // ── 3. Soma cada vendedor na janela dele ──────────────────────────────
  const resultado = [];
  for (const alvo of alvos) {
    const meses = mesesDoPeriodo(alvo.datemin, alvo.datemax);
    let valor = 0;
    let qtd = 0;
    let nome = null;
    const origem = { banco: 0, totvs: 0 };

    for (const mes of meses) {
      const mesIni = `${mes}-01`;
      const mesFim = ultimoDiaDoMes(mes);
      const ini = alvo.datemin > mesIni ? alvo.datemin : mesIni;
      const fim = alvo.datemax < mesFim ? alvo.datemax : mesFim;
      const mesInteiro = ini === mesIni && fim === mesFim;

      // Mes cheio e fechado sai do banco; ponta parcial vai ao TOTVS
      if (mesInteiro && setBanco.has(mes)) {
        const r = doBanco.get(`${mes}|${alvo.seller_code}`);
        if (r) {
          valor += r.valor;
          qtd += r.qtd;
          nome = nome || r.nome;
        }
        origem.banco++;
        continue;
      }

      const mapa = await buscarJanela(ini, fim);
      const r = mapa.get(alvo.seller_code);
      if (r) {
        valor += r.valor;
        qtd += r.qtd;
        nome = nome || r.nome;
      }
      origem.totvs++;
    }

    resultado.push({
      seller_code: alvo.seller_code,
      seller_name: nome,
      datemin: alvo.datemin,
      datemax: alvo.datemax,
      qtd,
      valor: Math.round(valor * 100) / 100,
      meses_banco: origem.banco,
      meses_totvs: origem.totvs,
    });
  }

  return {
    vendedores: resultado.sort((a, b) => b.valor - a.valor),
    consultas_totvs: consultasFeitas,
    meses_do_banco: mesesBanco,
  };
}

/**
 * Grava todo mês fechado que ainda não está no banco, do mais antigo para
 * o mais novo. É o backfill e o fechamento mensal no mesmo código.
 */
export async function fecharMesesPendentes(desde = '2025-01') {
  const hoje = hojeISO();
  const meses = mesesDoPeriodo(`${desde}-01`, hoje).filter((m) =>
    mesEstaFechado(m, hoje),
  );
  const gravados = await mesesGravados();
  const pendentes = meses.filter((m) => !gravados.has(m));

  const resultado = { candidatos: meses.length, pendentes: pendentes.length, gravados: [], falhas: [] };
  for (const mes of pendentes) {
    try {
      const { linhas, datemin, datemax } = await buscarMesNoTotvs(mes);
      const n = await salvarMes(mes, linhas, { datemin, datemax });
      resultado.gravados.push({ mes, vendedores: n });
      console.log(`💾 [fat-vend-mensal] ${mes} gravado (${n} vendedores)`);
    } catch (e) {
      resultado.falhas.push({ mes, erro: e.message });
      console.error(`❌ [fat-vend-mensal] ${mes}: ${e.message}`);
    }
  }
  return resultado;
}
