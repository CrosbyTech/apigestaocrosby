/**
 * Job: Recalcula `forecast_comparativo_ref.valor_acumulado` diariamente
 *
 * Estratégia: **pro-rata por dias úteis** (segunda a sábado).
 *
 *   valor_acumulado = valor_full × (dias_uteis_decorridos / dias_uteis_total_do_mes)
 *
 *   onde dias_uteis_decorridos = dias_uteis de MM-01 até MM-D, com D = dia de ontem.
 *
 * Por que pro-rata:
 *   - notas_fiscais (Supabase Fiscal) não tem todas as ops de 2025 (franquia,
 *     multimarcas, showroom, etc. não foram importadas retroativamente).
 *   - TOTVS live para datas históricas é instável (timeouts, caches parciais).
 *   - O valor_full do mês de 2025 está cadastrado manualmente pelo gerente
 *     (referência confiável) — então projetar linearmente é o melhor caminho.
 *
 *   Resultado: dia_acumulado sempre "anda" com o dia de ontem, e cada canal tem
 *   um valor proporcional ao ritmo que teria que ter para bater o mês cheio.
 *
 * Horário: 02:00 BRT diariamente (após o faturamento-diario das 01:30)
 */
import cron from 'node-cron';
import supabase from '../config/supabase.js';

// Canais espelhados de COMPARATIVO_CANAIS em forecast.routes.js
// Inclui showroom + novidadesfranquia separados (o comparativo agrega como "fabrica" via getRefValues)
const CANAIS = ['multimarcas', 'revenda', 'varejo', 'ricardoeletro', 'showroom', 'novidadesfranquia', 'franquia', 'bazar'];

function ymd(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// Conta dias úteis (segunda-sábado, pula domingo) entre duas datas, inclusivo.
function diasUteisRange(start, end) {
  let n = 0;
  const cur = new Date(start);
  cur.setUTCHours(12, 0, 0, 0);
  const fim = new Date(end);
  fim.setUTCHours(12, 0, 0, 0);
  while (cur <= fim) {
    if (cur.getUTCDay() !== 0) n += 1; // pula domingo
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return n;
}

// Pro-rata: valor_full × dias_úteis_até_ontem / dias_úteis_mes_completo
function calcularProRata(valorFull, ano, mes, diaOntem) {
  if (!valorFull || valorFull <= 0) return 0;
  // Dia 1 do mês até ontem
  const dia1 = new Date(Date.UTC(ano, mes - 1, 1));
  const ontemDt = new Date(Date.UTC(ano, mes - 1, diaOntem));
  // Mês completo
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const ultimo = new Date(Date.UTC(ano, mes - 1, ultimoDia));

  const decorridos = diasUteisRange(dia1, ontemDt);
  const total = diasUteisRange(dia1, ultimo);
  if (total <= 0) return 0;
  return Number((valorFull * decorridos / total).toFixed(2));
}

export async function recalcularForecastRef() {
  const hoje = new Date();
  const ontem = new Date(hoje);
  ontem.setUTCDate(ontem.getUTCDate() - 1);

  const anoAtual = hoje.getUTCFullYear();
  const mesAtual = hoje.getUTCMonth() + 1;
  const anoAnt = anoAtual - 1;

  if (ontem.getUTCMonth() + 1 !== mesAtual || ontem.getUTCFullYear() !== anoAtual) {
    console.log(
      `ℹ️ [forecast-ref-yoy] Ontem (${ymd(ontem)}) está fora do mês corrente. Pulando recálculo.`,
    );
    return;
  }

  const diaOntem = ontem.getUTCDate();

  console.log(
    `\n🔄 [forecast-ref-yoy] Pro-rata 2025 acumulado · ${anoAnt}-${String(mesAtual).padStart(2, '0')}-01 → dia ${diaOntem}`,
  );

  // Lê todos os valor_full do ano anterior/mês atual
  const { data: refs, error: errRefs } = await supabase
    .from('forecast_comparativo_ref')
    .select('id, canal, valor_full')
    .eq('ano', anoAnt)
    .eq('mes', mesAtual);
  if (errRefs) {
    console.error(`❌ [forecast-ref-yoy] Erro lendo refs: ${errRefs.message}`);
    return;
  }
  const fullByCanal = new Map((refs || []).map((r) => [r.canal, { id: r.id, valor_full: Number(r.valor_full) || 0 }]));

  // Resumo dos dias úteis usados
  const dia1 = new Date(Date.UTC(anoAnt, mesAtual - 1, 1));
  const ontemDt = new Date(Date.UTC(anoAnt, mesAtual - 1, diaOntem));
  const ultimoDia = new Date(Date.UTC(anoAnt, mesAtual, 0)).getUTCDate();
  const ultimo = new Date(Date.UTC(anoAnt, mesAtual - 1, ultimoDia));
  const decorridos = diasUteisRange(dia1, ontemDt);
  const total = diasUteisRange(dia1, ultimo);
  console.log(`  📅 Dias úteis: ${decorridos}/${total} (até dia ${diaOntem})`);

  let atualizados = 0;
  let inseridos = 0;
  for (const canal of CANAIS) {
    const ref = fullByCanal.get(canal);
    const valorFull = ref?.valor_full || 0;
    const valor = calcularProRata(valorFull, anoAnt, mesAtual, diaOntem);

    if (ref) {
      const { error } = await supabase
        .from('forecast_comparativo_ref')
        .update({
          valor_acumulado: valor,
          dia_acumulado: diaOntem,
          atualizado_em: new Date().toISOString(),
          atualizado_por: 'cron-forecast-ref-yoy',
        })
        .eq('id', ref.id);
      if (error) console.error(`  ❌ ${canal}: ${error.message}`);
      else {
        atualizados += 1;
        console.log(`  ✓ ${canal.padEnd(15)} full=R$${valorFull.toFixed(2).padStart(11)}  acum(d${diaOntem})=R$${valor.toFixed(2).padStart(11)}`);
      }
    } else {
      // Não existe ref para esse canal — insere com valor_full=0 e acum=0
      const { error } = await supabase.from('forecast_comparativo_ref').insert({
        canal,
        ano: anoAnt,
        mes: mesAtual,
        valor_full: 0,
        valor_acumulado: 0,
        dia_acumulado: diaOntem,
        atualizado_por: 'cron-forecast-ref-yoy',
      });
      if (error) console.error(`  ❌ ${canal} (insert): ${error.message}`);
      else {
        inseridos += 1;
        console.log(`  ➕ ${canal.padEnd(15)} (NOVO, valor_full=0 — cadastre manualmente)`);
      }
    }
  }

  console.log(`✅ [forecast-ref-yoy] Concluído: ${atualizados} atualizados, ${inseridos} inseridos.\n`);
}

export function iniciarJobForecastRefYoy() {
  cron.schedule('0 2 * * *', recalcularForecastRef, {
    timezone: 'America/Sao_Paulo',
  });
  console.log('⏰ [forecast-ref-yoy] Job agendado para 02:00 (America/Sao_Paulo) todos os dias');
}
