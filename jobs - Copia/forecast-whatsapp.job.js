/**
 * Job: Envio diário de imagens dos indicadores do Forecast via WhatsApp
 *
 * Horário: 12:00 de segunda a sábado (America/Sao_Paulo)
 * Indicadores enviados (referência: até ONTEM D-1, dia fechado):
 *   1) Promessa Mensal
 *   2) Promessa Semanal
 *   3) Vendedores B2R (Cleiton/Michel/Yago)
 *   4) Vendedores B2M (Walter/Renato/Arthur + David/Rafael)
 *   5) Comparativo Anual
 *
 * Configuração via .env:
 *   FORECAST_WHATSAPP_PHONE   = telefone destino (DDD + número, ex: 84991234567)
 *   FORECAST_WHATSAPP_ENABLED = 'true' pra ativar (default 'false' até validar)
 *   PUBLIC_FRONTEND_URL       = URL pública do frontend (ex: http://localhost:3000)
 *   INTERNAL_API_BASE_URL     = URL interna do backend (default http://localhost:PORT)
 *
 * Fluxo: Puppeteer abre /print/forecast?tipo=...&untilToday=false → aguarda
 * `body[data-print-ready=1]` → screenshot do elemento WhatsappReportCard →
 * POST /api/forecast/send-whatsapp-image com base64 da imagem.
 */
import cron from 'node-cron';
import axios from 'axios';
import puppeteer from 'puppeteer';

const FRONTEND_URL =
  process.env.PUBLIC_FRONTEND_URL ||
  process.env.FRONTEND_URL ||
  'http://localhost:3000';

const INTERNAL_API_BASE =
  process.env.INTERNAL_API_BASE_URL ||
  `http://localhost:${process.env.PORT || 4100}`;

const DESTINO_PHONE = process.env.FORECAST_WHATSAPP_PHONE || '';
const ENABLED = String(process.env.FORECAST_WHATSAPP_ENABLED || 'false').toLowerCase() === 'true';

// Indicadores a enviar (ordem do envio)
const INDICADORES = [
  { tipo: 'mensal',        target: '',     label: 'Promessa Mensal' },
  { tipo: 'semanal',       target: '',     label: 'Promessa Semanal' },
  { tipo: 'vendedores',    target: 'B2R',  label: 'Vendedores B2R' },
  { tipo: 'vendedores',    target: 'B2M',  label: 'Vendedores B2M' },
  { tipo: 'comparativo',   target: '',     label: 'Comparativo Anual' },
];

// Captura UM indicador via Puppeteer e retorna { base64, caption }
async function capturarIndicador(browser, indicador, untilToday) {
  const qs = new URLSearchParams({
    tipo: indicador.tipo,
    ...(indicador.target ? { target: indicador.target } : {}),
    untilToday: String(!!untilToday),
  });
  const url = `${FRONTEND_URL}/print/forecast?${qs.toString()}`;
  console.log(`📸 [forecast-whatsapp] Capturando: ${indicador.label} (${url})`);

  const page = await browser.newPage();
  try {
    // Viewport com folga horizontal (1100px) pra acomodar tabelas largas
    // do report card. fullPage screenshot só funciona bem se nada exceder
    // a largura do viewport.
    await page.setViewport({ width: 1100, height: 1400, deviceScaleFactor: 2 });
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 180000 });
    // Aguarda sinal `data-print-ready=1` no body (até 3min)
    await page.waitForSelector('body[data-print-ready="1"]', { timeout: 180000 });
    // Aguarda fontes web carregarem
    await page.evaluate(() => document.fonts?.ready);
    // Pequeno delay extra pra fontes/transições
    await new Promise((r) => setTimeout(r, 800));
    // Captura o WhatsappReportCard direto pelo seu container interno,
    // não a página inteira — assim a screenshot pega exatamente o card
    // e sua altura, sem cortar conteúdo nem incluir padding extra.
    const handle = await page.evaluateHandle(() => {
      // O PrintForecast renderiza um wrapper com padding, e dentro tem o
      // div do WhatsappReportCard. Pega o body inteiro (que é background branco
      // do PrintForecast) — assim tudo fica enquadrado.
      return document.body;
    });
    const buffer = await handle.screenshot({
      type: 'png',
      omitBackground: false,
    });
    await handle.dispose();
    const base64 = `data:image/png;base64,${buffer.toString('base64')}`;
    return { base64, caption: indicador.label };
  } finally {
    try {
      await page.close();
    } catch {}
  }
}

// Envia 1 imagem pro número configurado via endpoint existente
async function enviarImagem(phone, image, caption) {
  const r = await axios.post(
    `${INTERNAL_API_BASE}/api/forecast/send-whatsapp-image`,
    { phone, image, caption },
    { timeout: 60000 },
  );
  return r.data;
}

// Executa o job inteiro: captura cada indicador e envia em sequência
export async function executarForecastWhatsapp({ phone, untilToday = false } = {}) {
  const destino = phone || DESTINO_PHONE;
  if (!destino) {
    console.warn(
      '⚠️ [forecast-whatsapp] FORECAST_WHATSAPP_PHONE não configurado — abortando.',
    );
    return { ok: false, error: 'phone-missing' };
  }

  const result = {
    ok: true,
    phone: destino,
    untilToday,
    started_at: new Date().toISOString(),
    indicadores: [],
  };

  // ─── HEALTHCHECK: verifica se TOTVS tá saudável ANTES de capturar ──────
  // Faz uma chamada rápida ao /promessa-mensal e checa se algum canal tem
  // real_acumulado > 0. Se TODOS zerados, é sinal de TOTVS rejeitando (400)
  // ou cache vazio. Aborta o envio pra não mandar imagens vazias.
  try {
    const hojeISO = new Date().toISOString().slice(0, 10);
    const ano = new Date().getFullYear();
    const mes = new Date().getMonth() + 1;
    const hc = await axios.get(
      `${INTERNAL_API_BASE}/api/forecast/promessa-mensal?ano=${ano}&mes=${mes}`,
      { timeout: 60000 },
    );
    const canais = hc.data?.data?.canais || [];
    const totalReal = canais.reduce(
      (s, c) => s + Number(c.real_acumulado || 0),
      0,
    );
    if (totalReal <= 0) {
      console.warn(
        `🚫 [forecast-whatsapp] ABORTADO: real_acumulado total = R$ 0,00 (TOTVS provavelmente indisponível). Não vou enviar imagens vazias.`,
      );
      result.ok = false;
      result.error = 'totvs-zero-data';
      result.finished_at = new Date().toISOString();
      return result;
    }
    console.log(
      `✓ [forecast-whatsapp] healthcheck OK — real_acumulado total = R$ ${totalReal.toFixed(2)}, prosseguindo`,
    );
  } catch (err) {
    console.warn(
      `⚠️ [forecast-whatsapp] healthcheck falhou: ${err.message} — prosseguindo mesmo assim`,
    );
  }

  // Estratégia: 1 browser por indicador. Se uma captura falhar (frame detached
  // por timeout do TOTVS lento), só ESSE indicador é perdido — os próximos
  // sobem um browser novo e seguem. Antes, 1 browser pra todos crashava em
  // cascata quando o primeiro time out fechava a conexão.
  const browserArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--font-render-hinting=none',
  ];
  try {
    for (const ind of INDICADORES) {
      const t0 = Date.now();
      let browser;
      try {
        browser = await puppeteer.launch({ headless: 'new', args: browserArgs });
        const { base64, caption } = await capturarIndicador(browser, ind, untilToday);
        const sendRes = await enviarImagem(destino, base64, caption);
        const ms = Date.now() - t0;
        const success = !!(sendRes?.success);
        result.indicadores.push({
          label: ind.label,
          tipo: ind.tipo,
          target: ind.target || null,
          ok: success,
          duration_ms: ms,
        });
        console.log(
          `${success ? '✅' : '❌'} [forecast-whatsapp] ${ind.label} (${ms}ms)`,
        );
      } catch (err) {
        const ms = Date.now() - t0;
        result.ok = false;
        result.indicadores.push({
          label: ind.label,
          tipo: ind.tipo,
          target: ind.target || null,
          ok: false,
          duration_ms: ms,
          error: err.message,
        });
        console.error(
          `❌ [forecast-whatsapp] ${ind.label} falhou em ${ms}ms: ${err.message}`,
        );
      } finally {
        if (browser) {
          try {
            await browser.close();
          } catch {}
        }
      }
      // Espaça envios em 2s pra não disparar rate limit do UAzapi
      await new Promise((r) => setTimeout(r, 2000));
    }
  } catch (err) {
    result.ok = false;
    result.error = err.message;
    console.error('❌ [forecast-whatsapp] Erro fatal:', err.message);
  }
  result.finished_at = new Date().toISOString();
  console.log(
    `🏁 [forecast-whatsapp] Concluído: ${result.indicadores.filter((i) => i.ok).length}/${result.indicadores.length} ok`,
  );
  return result;
}

// ─── Agendamento: 12:00 de seg a sáb (Brasília) ──────────────────────────────
export function iniciarJobForecastWhatsapp() {
  if (!ENABLED) {
    console.log(
      'ℹ️ [forecast-whatsapp] Job DESATIVADO. Defina FORECAST_WHATSAPP_ENABLED=true no .env pra ativar.',
    );
    return null;
  }
  if (!DESTINO_PHONE) {
    console.warn(
      '⚠️ [forecast-whatsapp] FORECAST_WHATSAPP_PHONE ausente — job não será agendado.',
    );
    return null;
  }
  // Expressão cron: 0 12 * * 1-6 → minuto=0, hora=12, dia da semana 1-6 (seg a sáb)
  const task = cron.schedule(
    '0 12 * * 1-6',
    () => executarForecastWhatsapp({ untilToday: false }),
    { timezone: 'America/Sao_Paulo' },
  );
  console.log(
    `⏰ [forecast-whatsapp] Job agendado: 12:00 seg-sáb (BRT) → ${DESTINO_PHONE}`,
  );
  return task;
}
