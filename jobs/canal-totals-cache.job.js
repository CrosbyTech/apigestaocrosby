// Job: popula canal_totals_cache via /canais-totals-all do TOTVS.
// Schedule: a cada 1h (mês corrente) + 1x/dia (mês passado + ano corrente).
// Resolve divergência banco vs TOTVS: sale-panel tem NFs que fiscal/invoices não.

import cron from 'node-cron';
import axios from 'axios';
import supabase from '../config/supabase.js';
import { getPainelSellerCanais, getRicardoEletroFM } from '../services/painelCanais.js';

const INTERNAL_API_BASE =
  process.env.INTERNAL_API_BASE || `http://localhost:${process.env.PORT || 4100}`;

// Helper data
const ymd = (d) => d.toISOString().slice(0, 10);

// Helper formata "YYYY-MM" da data
const ymKey = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;

function periodosParaPopular() {
  const hoje = new Date();
  const Y = hoje.getUTCFullYear();
  const M = hoje.getUTCMonth(); // 0-11

  const inicioMes = new Date(Date.UTC(Y, M, 1));
  const inicioMesPassado = new Date(Date.UTC(Y, M - 1, 1));
  const fimMesPassado = new Date(Date.UTC(Y, M, 0));
  const inicioAno = new Date(Date.UTC(Y, 0, 1));

  return [
    { key: `mes-atual`,    datemin: ymd(inicioMes),       datemax: ymd(hoje) },
    { key: `mes-passado`,  datemin: ymd(inicioMesPassado), datemax: ymd(fimMesPassado) },
    { key: `ano-atual`,    datemin: ymd(inicioAno),       datemax: ymd(hoje) },
  ];
}

const CANAIS = [
  'varejo', 'revenda', 'multimarcas',
  'inbound_david', 'inbound_rafael',
  'franquia', 'business', 'bazar',
  'showroom', 'novidadesfranquia', 'ricardoeletro',
];

// Chama /canais-totals-all (TOTVS direto via canal-totals) pra TODOS canais.
// Antes usávamos /faturamento-por-segmento, mas ele lê do Supabase
// `notas_fiscais` que tem lag de sincronização → cache ficava desatualizado
// (ex: David ontem R$ 8.333 mas mes-atual R$ 3.892 porque NFs de ontem
// ainda não tinham sido replicadas pro Supabase no momento do cron).
// Tradeoff: TOTVS direto é 5-10x mais lento mas dados sempre frescos.
async function fetchAllCanais(datemin, datemax) {
  try {
    const r = await axios.post(
      `${INTERNAL_API_BASE}/api/crm/canais-totals-all?lite=true`,
      { datemin, datemax, lite: true },
      { timeout: 900000 }, // até 15min (TOTVS analytics é lento pra ranges grandes)
    );
    const d = r.data?.data || r.data || {};
    const segmentos = d.segmentos || {};
    return { ok: true, segmentos };
  } catch (e) {
    return { ok: false, erro: e.message, segmentos: {} };
  }
}

// 1 chamada a /canais-totals-all bate em TOTVS direto (em batches de 4).
// Valores 100% atualizados, sem lag de replicação Supabase.
async function popularCachePeriodo({ key, datemin, datemax }) {
  console.log(`[canal-totals-cache] ▶ ${key} (${datemin} → ${datemax}) — via /canais-totals-all (TOTVS direto)`);
  const res = await fetchAllCanais(datemin, datemax);
  if (!res.ok) {
    console.warn(`[canal-totals-cache] ${key} falhou: ${res.erro}`);
    return { ok: false };
  }
  // Override canônico: revenda/multimarcas vêm do Painel de Vendas (Supabase),
  // não do analytics. O analytics não mapeia vendedores novos (ex: Arthur 259
  // em multimarcas) → subconta. Só aplica no mês corrente, onde o Painel tem
  // cobertura completa; em mes-passado/ano-atual o Painel é parcial e ficaria
  // subcontado, então mantém o analytics. David/Rafael ficam com a réplica
  // oficial (já aplicada no /canais-totals-all).
  if (key === 'mes-atual') {
    try {
      const pv = await getPainelSellerCanais(datemin, datemax);
      if (pv.hasData) {
        res.segmentos.revenda = pv.revenda;
        res.segmentos.multimarcas = pv.multimarcas;
        console.log(`[canal-totals-cache]   ⟳ Painel override: revenda=${pv.revenda} multimarcas=${pv.multimarcas}`);
      }
    } catch (e) {
      console.warn(`[canal-totals-cache] painel override falhou: ${e.message}`);
    }
  }

  // Ricardo Eletro (filiais 11/111) via fiscal-movement — fonte canônica.
  // O analytics do /canais-totals-all usa só a op 5102 e subconta (ex: julho
  // 370 em vez de 7.850). Vale pra qualquer período. Só sobrescreve se vier
  // valor válido (>0); em falha/timeout preserva o que já estava.
  try {
    const re = await getRicardoEletroFM(datemin, datemax);
    if (Number(re) > 0) {
      res.segmentos.ricardoeletro = Number(re);
      console.log(`[canal-totals-cache]   ⟳ RE fiscal-movement override: ${re}`);
    }
  } catch (e) {
    console.warn(`[canal-totals-cache] RE override falhou: ${e.message}`);
  }

  const rows = [];
  for (const canal of CANAIS) {
    const valor = Number(res.segmentos[canal] || 0);
    console.log(`[canal-totals-cache]   ${valor > 0 ? '✓' : '·'} ${canal.padEnd(20)} R$ ${valor.toFixed(2)}`);
    if (valor <= 0) continue;
    rows.push({
      cache_key: key,
      canal,
      datemin,
      datemax,
      valor_liquido: valor,
      valor_bruto: valor,
      credev: 0,
      invoice_qty: 0,
      atualizado_em: new Date().toISOString(),
    });
  }
  if (rows.length === 0) return { ok: false };
  // ⚠️ NÃO apaga linhas antigas. Apenas faz upsert pros canais que conseguimos.
  // Se uma chamada falhar (timeout/ECONNRESET), preserva o valor anterior em
  // vez de zerar. Vai sendo refinado a cada execução do cron.
  const { error } = await supabase
    .from('canal_totals_cache')
    .upsert(rows, { onConflict: 'cache_key,canal' });
  if (error) {
    console.error(`[canal-totals-cache] ${key} upsert erro:`, error.message);
    return { ok: false, erro: error.message };
  }
  const total = rows.reduce((s, r) => s + Number(r.valor_liquido || 0), 0);
  console.log(`[canal-totals-cache] ✅ ${key} salvo: ${rows.length} canais  R$ ${total.toFixed(2)}`);
  return { ok: true, canais: rows.length, total };
}

export async function executarCacheCanalTotals() {
  console.log('\n📥 [canal-totals-cache] iniciado', new Date().toISOString());
  const periodos = periodosParaPopular();
  // Roda em sequência pra não martelar TOTVS
  for (const p of periodos) {
    await popularCachePeriodo(p);
  }
  console.log('[canal-totals-cache] concluído');
}

let agendado = false;
export function iniciarCanalTotalsCacheJob() {
  if (agendado) return;
  agendado = true;
  // Roda a cada 1h, minuto 5 (evita conflito com outros jobs em :00)
  cron.schedule(
    '5 * * * *',
    async () => {
      try { await executarCacheCanalTotals(); }
      catch (e) { console.error('[canal-totals-cache] cron falhou:', e.message); }
    },
    { timezone: 'America/Sao_Paulo' },
  );
  console.log('[canal-totals-cache] cron agendado: a cada 1h (minuto :05 BRT)');
}
