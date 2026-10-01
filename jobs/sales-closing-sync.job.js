// ─────────────────────────────────────────────────────────────────────────
// Sales Closing Sync — ingestão do painel de FECHAMENTO DE MÊS (TVs)
//
// Puxa os números de venda EXATAMENTE da mesma rota do New Forecast:
//     POST /api/totvs/sale-panel/faturamento-vendedor-semanal   { mes }
// (a mesma que o NewForecast.jsx chama via
//  apiClient.totvs.salePanelFaturamentoVendedorSemanal)
//
// A rota devolve { canais: { CANAL: { s1..s5 } }, drill, ... } — dados JÁ
// agregados por canal/semana. Este job normaliza isso e faz UPSERT na tabela
// public.sales_closing_records, com chave natural (mes, canal).
//
// Regras de negócio:
//  • Fuso America/Fortaleza (UTC-3, Natal/RN) para "mês corrente" e "agora".
//  • Trava da meia-noite: ao virar o mês (em Fortaleza), o mês que fechou recebe
//    um último sync e é marcado fechado=true; a partir daí não é mais alterado
//    (uma correção retroativa do TOTVS dentro do mês não reabre o fechamento).
//  • A própria rota do forecast filtra por datemin..datemax = o mês inteiro,
//    então venda emitida já no mês seguinte nunca entra no mês que fechou.
//
// Schedule (ver iniciarSalesClosingSyncJob):
//  • Mês corrente a cada 10 min (a rota tem cache de ~30 min por semana, então
//    faz pouco sentido ir abaixo disso — ver nota no README/PR).
//  • Último dia do mês: a cada 3 min (aperto do fechamento).
//  • 00:05 do dia 1: fecha o mês anterior (fechado=true) e passa a alimentar o
//    novo mês.
// ─────────────────────────────────────────────────────────────────────────
import cron from 'node-cron';
import axios from 'axios';
import supabase from '../config/supabase.js';

const INTERNAL_API_BASE = `http://localhost:${process.env.PORT || 4100}`;
const TZ = 'America/Fortaleza'; // Natal/RN — UTC-3 o ano todo (sem horário de verão)

// ── Helpers de fuso ────────────────────────────────────────────────────────
// Devolve os componentes de data/hora de `d` JÁ no fuso de Natal. Fazemos isso
// via Intl (não com offset fixo) para não escorregar caso a política de fuso
// mude no futuro; hoje America/Fortaleza é UTC-3 fixo.
function partesFortaleza(d = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return {
    ymd: `${p.year}-${p.month}-${p.day}`, // 'YYYY-MM-DD' em Fortaleza
    mes: `${p.year}-${p.month}`, // 'YYYY-MM' em Fortaleza
    dia: Number(p.day),
    hms: `${p.hour}:${p.minute}:${p.second}`,
  };
}

// Último dia (número) de um mês 'YYYY-MM'.
function ultimoDiaDoMes(mes) {
  const [y, m] = mes.split('-').map(Number);
  return new Date(y, m, 0).getDate(); // m sem -1 => dia 0 do mês seguinte = último dia
}

// mesA < mesB ? (comparação lexicográfica funciona para 'YYYY-MM')
const mesAntesDe = (a, b) => a < b;

// Canais que a rota do forecast devolve. VAREJO já vem LÍQUIDO (varejo −
// bluecred) e BLUECRED vem separado, então somar TODOS os canais dá o total
// bruto sem contar em dobro — por isso o TOTAL_GERAL é a soma simples de tudo.
// (Regra do gestor documentada no painelVendas.js, 2026-09-08.)

// ── Núcleo: sincroniza UM mês ───────────────────────────────────────────────
export async function syncMes(mes, { force = false } = {}) {
  const agora = partesFortaleza();
  const mesAtual = agora.mes;

  // Nunca sincroniza mês no futuro.
  if (mesAntesDe(mesAtual, mes)) {
    return { ok: false, mes, motivo: 'mes_futuro' };
  }

  // Um mês passado é sempre "encerrado". O mês corrente encerra quando a data
  // de Fortaleza já virou para o mês seguinte (tratado no ramo acima).
  const encerrado = mesAntesDe(mes, mesAtual);

  // Trava da meia-noite: se já está fechado no banco e não é force, não mexe.
  const { data: existentes } = await supabase
    .from('sales_closing_records')
    .select('canal, fechado')
    .eq('mes', mes)
    .limit(1);
  if (!force && existentes?.[0]?.fechado) {
    return { ok: true, mes, rows: 0, motivo: 'ja_fechado' };
  }

  // 1) Busca na MESMA rota do New Forecast (por 'mes').
  let payload;
  try {
    const r = await axios.post(
      `${INTERNAL_API_BASE}/api/totvs/sale-panel/faturamento-vendedor-semanal`,
      { mes },
      { timeout: 600000 }, // rota pesada em cache frio (mesmo timeout do frontend)
    );
    payload = r.data?.data || r.data || {};
  } catch (e) {
    console.warn(`[sales-closing-sync] ${mes} fetch falhou: ${e.message}`);
    return { ok: false, mes, motivo: 'fetch_falhou' };
  }

  const canais = payload.canais || {};
  const datemin = payload.datemin || `${mes}-01`;
  const datemax = payload.datemax || `${mes}-${String(ultimoDiaDoMes(mes)).padStart(2, '0')}`;
  const now = new Date().toISOString();
  const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

  // 1b) Detalhe por canal, somando as semanas do drill (sem bater no TOTVS de novo):
  //   VAREJO    -> por loja     [{ nome, branch_code, valor }]
  //   REVENDA   -> por vendedor (sellers 161/241/165)
  //   FRANQUIAS -> por vendedor (seller 40)
  // (Multimarcas é montado no front a partir dos 3 canais MTM.)
  const drill = payload.drill || {};
  const vendAcc = {}; // seller_code -> { nome, valor }
  const lojaAcc = {}; // branch_code -> { nome, branch_code, valor }
  for (const semana of Object.values(drill)) {
    for (const [code, v] of Object.entries(semana?.vendedores || {})) {
      if (!vendAcc[code]) vendAcc[code] = { nome: v.seller_name || `Vendedor ${code}`, valor: 0 };
      vendAcc[code].valor += Number(v.valor || 0);
      if (!vendAcc[code].nome && v.seller_name) vendAcc[code].nome = v.seller_name;
    }
    for (const l of semana?.varejo || []) {
      const bc = Number(l.branch_code);
      if (!Number.isFinite(bc)) continue;
      if (!lojaAcc[bc]) lojaAcc[bc] = { nome: l.branch_name || l.name || `Filial ${bc}`, branch_code: bc, valor: 0 };
      lojaAcc[bc].valor += Number(l.valor || 0);
    }
  }
  const porVendedor = (codes) =>
    codes
      .map((c) => vendAcc[c])
      .filter(Boolean)
      .map((v) => ({ nome: v.nome, valor: r2(v.valor) }))
      .filter((x) => x.valor > 0)
      .sort((a, b) => b.valor - a.valor);
  const detalhePorCanal = {
    VAREJO: Object.values(lojaAcc)
      .map((l) => ({ nome: l.nome, branch_code: l.branch_code, valor: r2(l.valor) }))
      .filter((x) => x.valor > 0)
      .sort((a, b) => b.valor - a.valor),
    REVENDA: porVendedor([161, 241, 165]),
    FRANQUIAS: porVendedor([40]),
  };

  // 2) Normaliza cada canal -> uma linha; calcula total do mês.
  const rows = [];
  const totalGeral = { s1: 0, s2: 0, s3: 0, s4: 0, s5: 0, total: 0 };
  for (const [canal, semanas] of Object.entries(canais)) {
    const s = {
      s1: r2(semanas.s1),
      s2: r2(semanas.s2),
      s3: r2(semanas.s3),
      s4: r2(semanas.s4),
      s5: r2(semanas.s5),
    };
    const total = r2(s.s1 + s.s2 + s.s3 + s.s4 + s.s5);
    for (const k of ['s1', 's2', 's3', 's4', 's5']) totalGeral[k] = r2(totalGeral[k] + s[k]);
    totalGeral.total = r2(totalGeral.total + total);
    rows.push({
      mes,
      canal,
      ...s,
      total_mes: total,
      detalhe: detalhePorCanal[canal] || [],
      fechado: encerrado,
      datemin,
      datemax,
      atualizado_em: now,
    });
  }

  // Linha-resumo TOTAL_GERAL (soma de todos os canais, sem dupla contagem).
  rows.push({
    mes,
    canal: 'TOTAL_GERAL',
    s1: totalGeral.s1,
    s2: totalGeral.s2,
    s3: totalGeral.s3,
    s4: totalGeral.s4,
    s5: totalGeral.s5,
    total_mes: totalGeral.total,
    detalhe: [],
    fechado: encerrado,
    datemin,
    datemax,
    atualizado_em: now,
  });

  if (rows.length === 0) {
    console.log(`[sales-closing-sync] ${mes} sem canais (nada a gravar)`);
    return { ok: true, mes, rows: 0 };
  }

  // 3) UPSERT por (mes, canal) — insere se não existe, atualiza se já existe.
  const { error } = await supabase
    .from('sales_closing_records')
    .upsert(rows, { onConflict: 'mes,canal' });
  if (error) {
    console.error(`[sales-closing-sync] ${mes} upsert falhou: ${error.message}`);
    return { ok: false, mes, motivo: error.message };
  }

  console.log(
    `[sales-closing-sync] ✅ ${mes}: ${rows.length} canais | total R$ ${totalGeral.total.toLocaleString('pt-BR')}${encerrado ? ' | FECHADO' : ''}`,
  );
  return { ok: true, mes, rows: rows.length, total: totalGeral.total, fechado: encerrado };
}

// ── Runner principal ────────────────────────────────────────────────────────
// Sincroniza o mês corrente. No começo do dia 1, também dá o fecho final no
// mês anterior (se ainda não estiver fechado).
export async function executarSalesClosingSync({ force = false } = {}) {
  const inicio = Date.now();
  const { mes, dia, hms } = partesFortaleza();
  console.log(`\n📥 [sales-closing-sync] iniciado — mês ${mes} (Fortaleza ${hms})`);

  // Fecho do mês anterior nas primeiras horas do dia 1.
  if (dia === 1) {
    const [y, m] = mes.split('-').map(Number);
    const anterior = new Date(y, m - 2, 1); // mês anterior
    const mesAnterior = `${anterior.getFullYear()}-${String(anterior.getMonth() + 1).padStart(2, '0')}`;
    const rAnt = await syncMes(mesAnterior, { force }); // encerrado=true => grava fechado
    if (rAnt.ok && rAnt.rows > 0) {
      console.log(`[sales-closing-sync] mês anterior ${mesAnterior} fechado.`);
    }
  }

  const r = await syncMes(mes, { force });
  const segs = ((Date.now() - inicio) / 1000).toFixed(0);
  console.log(`[sales-closing-sync] concluído em ${segs}s — ${JSON.stringify(r)}`);
  return { ...r, duracao_s: Number(segs) };
}

// ── Agendamento ──────────────────────────────────────────────────────────────
let agendado = false;
export function iniciarSalesClosingSyncJob() {
  if (agendado) return;
  agendado = true;

  // Mês corrente a cada 10 min (a rota tem cache ~30min por semana; abaixo disso
  // não traz número mais fresco). Cobre o dia inteiro.
  cron.schedule(
    '*/10 * * * *',
    async () => {
      try {
        // No último dia, o cron de 3min abaixo cuida; evita sync duplicado.
        const { mes, dia } = partesFortaleza();
        if (dia === ultimoDiaDoMes(mes)) return;
        await executarSalesClosingSync();
      } catch (e) {
        console.error('[sales-closing-sync] cron 10min falhou:', e.message);
      }
    },
    { timezone: TZ },
  );

  // Último dia do mês: aperto do fechamento a cada 3 min.
  cron.schedule(
    '*/3 * * * *',
    async () => {
      try {
        const { mes, dia } = partesFortaleza();
        if (dia !== ultimoDiaDoMes(mes)) return;
        await executarSalesClosingSync();
      } catch (e) {
        console.error('[sales-closing-sync] cron último dia falhou:', e.message);
      }
    },
    { timezone: TZ },
  );

  // 00:05 do dia 1: fecho do mês anterior + primeiro sync do novo mês.
  cron.schedule(
    '5 0 1 * *',
    async () => {
      try {
        await executarSalesClosingSync();
      } catch (e) {
        console.error('[sales-closing-sync] cron fecho falhou:', e.message);
      }
    },
    { timezone: TZ },
  );

  console.log('[sales-closing-sync] cron agendado: 10min (mês), 3min (último dia), 00:05 dia 1 (fecho)');
}

// Permite rodar manualmente: `node jobs/sales-closing-sync.job.js [YYYY-MM] [--force]`
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('sales-closing-sync.job.js')) {
  const argMes = process.argv.find((a) => /^\d{4}-\d{2}$/.test(a));
  const force = process.argv.includes('--force');
  const run = argMes ? syncMes(argMes, { force }) : executarSalesClosingSync({ force });
  run
    .then((r) => {
      console.log('Resultado:', r);
      process.exit(0);
    })
    .catch((e) => {
      console.error('Erro:', e);
      process.exit(1);
    });
}
