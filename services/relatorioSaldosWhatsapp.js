// ============================================================
// RELATÓRIO DE SALDOS NO WHATSAPP — grupo "CONTAS A PAGAR CROSBY OFC"
//
// 3x ao dia (depois da execução agendada do bot Stone das 09:30/14:00/18:00,
// com fallback por cron) o HeadCoach manda no grupo, pela instância CONTAS A
// PAGAR (a mesma dos agentes JOJO/BRUCE/THEO/VEVETO), assinadas "— Veveto":
//   1) uma IMAGEM com o card "Saldo Bancário" (total, Stone por final de CNPJ
//      com antecipável, Pagar.me disponível/a receber, demais bancos) marcando
//      o CEO Fábio Ferreira (+55 84 8782-0986);
//   2) um TEXTO com a programação da semana: títulos em PROVISÃO na Liberação
//      de Pagamento (fornecedor · valor · vencimento), de segunda a domingo.
//
// A imagem é gerada aqui mesmo (HTML → puppeteer → PNG), com o visual do
// HeadCoach, porque a tela real exige login.
//
// Env: RELATORIO_SALDOS_ENABLED (default true), RELATORIO_SALDOS_GRUPO_CHATID,
//      RELATORIO_SALDOS_GRUPO_NOME (default "CONTAS A PAGAR CROSBY OFC"),
//      RELATORIO_SALDOS_MENCIONAR (default 558487820986 → Fábio),
//      RELATORIO_SALDOS_CRON_FALLBACK (default "50 9 * * *;20 14 * * *;20 18 * * *")
// ============================================================
import cron from 'node-cron';
import supabase from '../config/supabase.js';
import * as wa from './whatsappContasPagar.js';

const env = (k, d) => process.env[k] ?? d;
const ENABLED = String(env('RELATORIO_SALDOS_ENABLED', 'true')).toLowerCase() !== 'false';
const GRUPO_NOME = env('RELATORIO_SALDOS_GRUPO_NOME', 'CONTAS A PAGAR CROSBY OFC');
export const MENCIONAR = String(env('RELATORIO_SALDOS_MENCIONAR', '558487820986')).replace(/\D/g, '');
const NOME_MENCIONADO = env('RELATORIO_SALDOS_NOME_MENCIONADO', 'Fábio');
const TRACK_ID = 'veveto';
const ASSINATURA = '— Veveto';

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const fmt = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtData = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
const sufixoCnpj = (cnpj) => {
  const d = String(cnpj || '').replace(/\D/g, '');
  return d.slice(-4); // 27.728.810/0005-49 → "0549" (como o Yago identifica as contas)
};
const agoraBr = () => new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const hojeBr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDias = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** segunda → domingo da semana de `iso` */
export function semanaDe(iso = hojeBr()) {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0 dom
  const seg = addDias(iso, dow === 0 ? -6 : 1 - dow);
  return { de: seg, ate: addDias(seg, 6) };
}

// chatid conhecido (27/10/2026) — se o grupo for recriado, o nome resolve de novo
let grupoCache = { id: env('RELATORIO_SALDOS_GRUPO_CHATID', '120363427439356982@g.us') || null, em: 0 };
export async function grupoChatid() {
  if (grupoCache.id) return grupoCache.id;
  const g = await wa.acharGrupoPorNome(GRUPO_NOME);
  if (!g?.id) throw new Error(`grupo "${GRUPO_NOME}" não encontrado na instância CONTAS A PAGAR`);
  grupoCache = { id: g.id, em: Date.now() };
  return g.id;
}

// ─── dados ────────────────────────────────────────────────────
export async function montarDados() {
  const BANCOS = ['STONE', 'PAGARME', 'ITAU RECIFE', 'MENTORE']; // PAGARME A RECEBER fora da contagem (pedido do Yago, 27/10)
  const { data: sb } = await supabase.from('saldo_bancario').select('*').in('banco', BANCOS);
  const saldoDe = (b) => Number((sb || []).find((x) => x.banco === b)?.valor || 0);
  const bancos = BANCOS.map((b) => ({ banco: b, valor: round2(saldoDe(b)) }));

  const { data: ult } = await supabase.from('stone_bot_saldos').select('data,capturado_em').order('capturado_em', { ascending: false }).limit(1);
  const dia = ult?.[0]?.data || null;
  let stone = [];
  let pagarme = [];
  if (dia) {
    const { data: linhas } = await supabase.from('stone_bot_saldos').select('*').eq('data', dia).order('saldo', { ascending: false });
    stone = (linhas || []).filter((l) => (l.banco || 'STONE') === 'STONE').map((l) => ({ rotulo: `Stone ${sufixoCnpj(l.titular_cnpj) || l.conta}`, titular: l.titular_nome, saldo: Number(l.saldo || 0), antecipavel: Number(l.saldo_antecipavel || 0) }));
    pagarme = (linhas || []).filter((l) => l.banco === 'PAGARME').map((l) => ({ rotulo: l.titular_nome || l.conta, saldo: Number(l.saldo || 0), aReceber: Number(l.saldo_a_receber || 0) }));
  }
  const antecipavel = round2(stone.reduce((a, s) => a + s.antecipavel, 0));
  // total inclui o antecipável da STONE (pedido do Yago, 28/10); a Pagar.me NÃO soma o "a receber"
  const total = round2(bancos.reduce((a, b) => a + b.valor, 0) + antecipavel);
  const capturadoEm = ult?.[0]?.capturado_em || null;

  const semana = semanaDe();
  const { data: prov } = await supabase
    .from('pagamentos_liberacao')
    .select('id,nm_fornecedor,vl_duplicata,vl_real,dt_vencimento,nm_empresa,forma_pagamento,cd_despesaitem,ds_despesaitem,dados_completos')
    .eq('status', 'PROVISAO') // tudo que está em previsão: vencidos, de hoje e a vencer (pedido do Yago, 27/10)
    .order('dt_vencimento')
    .order('nm_fornecedor');
  const programacao = (prov || []).map((p) => ({ id: p.id, fornecedor: p.nm_fornecedor || '—', valor: Number(p.vl_real ?? p.vl_duplicata ?? 0), vencimento: p.dt_vencimento, empresa: p.nm_empresa, despesaCodigo: p.cd_despesaitem, despesa: p.ds_despesaitem, origem: p.dados_completos?.origem || null }));
  const totalProgramacao = round2(programacao.reduce((a, p) => a + p.valor, 0));
  const itensSemana = agruparProgramacao(programacao);

  return { geradoEm: agoraBr(), capturadoEm, dia, bancos, total, stone, pagarme, antecipavel, semana, programacao, itensSemana, totalProgramacao };
}

// ─── despesas fixas agrupadas (uma linha por despesa, somando as duplicatas) ──
// Regra do Yago (27/10/2026): água/esgoto, energia, internet, vale transporte e
// vale alimentação viram UMA linha cada, com o total; o resto fica por fornecedor.
const GRUPOS_FIXOS = [
  { rotulo: 'ÁGUA E ESGOTO', codigos: ['6011'], re: /AGUA|ESGOTO|CAERN|CAGEPA|COMPESA|SANEAMENTO/i },
  { rotulo: 'ENERGIA', codigos: ['6010'], re: /ENERGIA|ENERGISA|COSERN|NEOENERGIA|CELPE|ELETRIC|COMPANHIA ENERGETICA/i },
  { rotulo: 'INTERNET', codigos: ['6028'], re: /INTERNET|PROVEDOR|FIBRA|TELECOM|BRISANET|VIVO FIBRA|CLARO NET/i },
  { rotulo: 'VALE TRANSPORTE', codigos: ['3036'], re: /VALE TRANSPORTE|TRANSP COL|TRANSPORTE COLETIVO|SINDICATO DAS EMPRESAS DE TRANSP|SIND DAS EMP DE TRANSP/i },
  { rotulo: 'VALE ALIMENTAÇÃO', codigos: ['3003'], re: /VALE ALIMENTACAO|VALE REFEICAO|PLUXEE|SODEXO|ALELO|TICKET|VR BENEFICIOS|FLASH/i },
];
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
function grupoDe(p) {
  const cod = String(p.despesaCodigo || '').replace(/\D/g, '');
  const texto = semAcento(`${p.despesa || ''} ${p.fornecedor || ''}`).toUpperCase();
  return GRUPOS_FIXOS.find((g) => (cod && g.codigos.includes(cod)) || g.re.test(texto)) || null;
}
/** @returns [{ rotulo, valor, vencimento, vencimentoAte, qtd, agrupado }] em ordem de vencimento */
export function agruparProgramacao(programacao) {
  const grupos = new Map();
  const itens = [];
  for (const p of programacao) {
    const g = grupoDe(p);
    if (!g) {
      itens.push({ rotulo: p.fornecedor, valor: round2(p.valor), vencimento: p.vencimento, vencimentoAte: p.vencimento, qtd: 1, agrupado: false });
      continue;
    }
    if (!grupos.has(g.rotulo)) grupos.set(g.rotulo, { rotulo: g.rotulo, valor: 0, vencimento: p.vencimento, vencimentoAte: p.vencimento, qtd: 0, agrupado: true });
    const x = grupos.get(g.rotulo);
    x.valor = round2(x.valor + p.valor);
    x.qtd += 1;
    if (p.vencimento < x.vencimento) x.vencimento = p.vencimento;
    if (p.vencimento > x.vencimentoAte) x.vencimentoAte = p.vencimento;
  }
  return [...itens, ...grupos.values()].sort((a, b) => (a.vencimento < b.vencimento ? -1 : a.vencimento > b.vencimento ? 1 : b.valor - a.valor));
}

// ─── imagem (HTML → PNG) ──────────────────────────────────────
function htmlDoCard(d) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const chip = (b) => `<span class="chip ${b.valor > 0 ? 'on' : ''}">${esc(b.banco)}: ${fmt(b.valor)}</span>`;
  const linhaStone = (s) => `<div class="row"><span class="rot" title="${esc(s.titular)}">${esc(s.rotulo)}</span><span class="val ${s.saldo > 0 ? '' : 'zero'}">${fmt(s.saldo)}</span>${s.antecipavel > 0 ? `<span class="ant">+${fmt(s.antecipavel)} antec.</span>` : '<span class="ant"></span>'}</div>`;
  const linhaPg = (p) => `<div class="row"><span class="rot">${esc(p.rotulo)}</span><span class="val ${p.saldo > 0 ? '' : 'zero'}">${fmt(p.saldo)}</span>${p.aReceber > 0 ? `<span class="rec">+${fmt(p.aReceber)} a rec.</span>` : '<span class="rec"></span>'}</div>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0} body{width:760px;background:#f3f4f6;font-family:Inter,Segoe UI,Arial,sans-serif;color:#1f2937;padding:18px}
  .card{background:#fff;border:1px solid #99f6e4;border-radius:14px;box-shadow:0 1px 3px rgba(0,0,0,.08);padding:18px}
  .head{display:flex;align-items:center;gap:12px;margin-bottom:12px}
  .ico{width:40px;height:40px;border-radius:10px;background:#ccfbf1;display:flex;align-items:center;justify-content:center;color:#0d9488;font-weight:800;font-size:18px}
  .t1{font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#0d9488}
  .t1 small{color:#9ca3af;font-weight:400;text-transform:none;letter-spacing:0;margin-left:8px}
  .total{font-size:30px;font-weight:800;color:#111827;line-height:1.1}
  .chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 14px}
  .chip{font-size:11px;padding:4px 9px;border-radius:999px;border:1px solid #e5e7eb;background:#f9fafb;color:#9ca3af;font-weight:700}
  .chip.on{background:#f0fdfa;color:#0f766e;border-color:#99f6e4}
  .sec{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .box{border-top:1px solid #f3f4f6;padding-top:8px}
  .box h4{font-size:11px;color:#6b7280;font-weight:700;margin-bottom:6px}
  .box h4 b{color:#b45309}.box h4 i{color:#a21caf;font-style:normal}
  .row{display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center;font-size:12px;padding:3px 0;border-bottom:1px dashed #f3f4f6}
  .rot{color:#4b5563;font-weight:600}.val{font-weight:700;color:#111827;text-align:right}.val.zero{color:#9ca3af;font-weight:500}
  .ant{color:#b45309;font-size:11px;min-width:120px;text-align:right}.rec{color:#a21caf;font-size:11px;min-width:120px;text-align:right}
  .foot{margin-top:12px;font-size:10px;color:#9ca3af;display:flex;justify-content:space-between}
  </style></head><body><div class="card">
    <div class="head"><div class="ico">R$</div><div><div class="t1">Saldo Bancário <small>· ${d.bancos.filter((b) => b.valor > 0).length} banco(s) · HeadCoach</small></div><div class="total">${fmt(d.total)}</div></div></div>
    <div class="chips" style="margin-bottom:0">${d.bancos.map(chip).join('')}</div>
    ${d.detalhado ? `<div class="sec" style="margin-top:14px">
      <div class="box"><h4>Stone por conta${d.antecipavel > 0 ? ` · <b>${fmt(d.antecipavel)} para antecipar</b>` : ''}</h4>${d.stone.length ? d.stone.map(linhaStone).join('') : '<div class="row"><span class="rot">sem captura do bot</span></div>'}</div>
      <div class="box"><h4>Pagar.me${d.pagarme.some((p) => p.aReceber > 0) ? ` · <i>${fmt(d.pagarme.reduce((a, p) => a + p.aReceber, 0))} a receber</i>` : ''}</h4>${d.pagarme.length ? d.pagarme.map(linhaPg).join('') : '<div class="row"><span class="rot">sem captura</span></div>'}</div>
    </div>` : ''}
  </div></body></html>`;
}

/**
 * Abre um Chrome para a captura. No servidor (Linux) prefere o Chromium
 * empacotado do @sparticuz/chromium (extraído em /tmp, não depende do Chrome
 * baixado pelo puppeteer, que no Render às vezes está "ocupado" — ETXTBSY —
 * enquanto o prewarm reinstala). Localmente usa o launcher do autentique.
 */
async function abrirNavegador() {
  const erros = [];
  if (process.platform === 'linux') {
    try {
      const chromium = (await import('@sparticuz/chromium')).default;
      const puppeteer = (await import('puppeteer')).default;
      const execPath = await chromium.executablePath();
      const browser = await puppeteer.launch({ headless: true, args: [...chromium.args, '--disable-dev-shm-usage'], defaultViewport: { width: 760, height: 600 }, executablePath: execPath });
      return browser;
    } catch (e) {
      erros.push(`sparticuz: ${e.message}`);
    }
  }
  const { launchPuppeteer } = await import('../routes/autentique.routes.js');
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      const { browser } = await launchPuppeteer();
      return browser;
    } catch (e) {
      erros.push(`launcher ${tentativa}: ${e.message}`);
      if (!/ETXTBSY|EBUSY|ENOENT/i.test(e.message) || tentativa === 3) break;
      await new Promise((r) => setTimeout(r, 10000));
    }
  }
  throw new Error(`não consegui abrir o Chrome (${erros.join(' | ')})`);
}

export async function gerarImagem(dados) {
  const browser = await abrirNavegador();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 760, height: 600, deviceScaleFactor: 2 });
    await page.setContent(htmlDoCard(dados), { waitUntil: 'load' });
    const el = await page.$('.card');
    const png = await (el || page).screenshot({ type: 'png' });
    return Buffer.from(png);
  } finally {
    await browser.close().catch(() => {});
  }
}

// ─── textos ───────────────────────────────────────────────────
const fmtDiaMes = (iso) => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}` : '');
export function textoProgramacao(d) {
  const itens = d.itensSemana || agruparProgramacao(d.programacao || []);
  const hoje = hojeBr();
  const vencidos = itens.filter((it) => it.vencimentoAte < hoje).length;
  const linhas = [`*Previsão de pagamentos* (${fmtDiaMes(hoje)})${vencidos ? ` · ${vencidos} vencido(s)` : ''}`];
  if (!itens.length) linhas.push('Nenhum título em previsão.');
  itens.forEach((it, i) => {
    const quando = it.agrupado && it.vencimento !== it.vencimentoAte ? `${fmtDiaMes(it.vencimento)} a ${fmtDiaMes(it.vencimentoAte)}` : fmtDiaMes(it.vencimento);
    linhas.push(`${i + 1} - ${it.rotulo} — ${fmt(it.valor)} (${quando}${it.agrupado && it.qtd > 1 ? `, ${it.qtd} contas` : ''})`);
  });
  linhas.push(`\nTotal: *${fmt(d.totalProgramacao)}*`);
  linhas.push(`\n${ASSINATURA}`);
  return linhas.join('\n');
}

function legendaImagem() {
  // só a marcação do Fábio: o print já traz os números
  return `${MENCIONAR ? `@${MENCIONAR}` : NOME_MENCIONADO}, segue o saldo atual

${ASSINATURA}`;
}

// ─── envio ────────────────────────────────────────────────────
let ultimoEnvio = { em: 0, motivo: null, ok: null, erro: null };
export function statusRelatorio() {
  return { enabled: ENABLED, grupoNome: GRUPO_NOME, grupo: grupoCache.id, mencionar: MENCIONAR, ultimoEnvio };
}

/**
 * Manda imagem + programação no grupo. `motivo` só para log.
 * @returns {{ok, grupo, imagem, texto}}
 */
export async function enviarRelatorio({ motivo = 'manual', soTexto = false, soImagem = false } = {}) {
  if (!wa.isConfigurado()) throw new Error('WhatsApp Contas a Pagar não configurado');
  const grupo = await grupoChatid();
  const dados = await montarDados();
  const out = { ok: false, grupo, motivo, imagem: null, texto: null, dados: { total: dados.total, programacao: dados.programacao.length } };
  try {
    if (!soTexto) {
      let png = null;
      try {
        png = await gerarImagem(dados);
      } catch (e) {
        out.imagemErro = `${e.message} | ${String(e.stack || '').split(/\r?\n/).slice(1, 3).join(' ')}`;
        console.warn(`[relatorio-saldos] imagem falhou (${e.message}) — mando só texto`);
      }
      if (png) {
        const r = await wa.enviarMidia({ number: grupo, type: 'image', file: `data:image/png;base64,${png.toString('base64')}`, text: legendaImagem(), mentions: MENCIONAR, trackId: TRACK_ID });
        out.imagem = r?.resposta?.id || true;
      } else {
        const r = await wa.enviarTexto({ number: grupo, text: legendaImagem(), mentions: MENCIONAR, trackId: TRACK_ID });
        out.imagem = r?.resposta?.id || true;
      }
    }
    if (!soImagem) {
      const r2 = await wa.enviarTexto({ number: grupo, text: textoProgramacao(dados), trackId: TRACK_ID });
      out.texto = r2?.resposta?.id || true;
    }
    out.ok = true;
    ultimoEnvio = { em: Date.now(), motivo, ok: true, erro: null };
  } catch (e) {
    ultimoEnvio = { em: Date.now(), motivo, ok: false, erro: e.message };
    throw e;
  }
  console.log(`[relatorio-saldos] enviado (${motivo}) → ${grupo}`);
  return out;
}

/** Diagnóstico: gera a imagem sem enviar (tamanho ou erro com stack). */
export async function testarImagem() {
  const t0 = Date.now();
  try {
    const png = await gerarImagem(await montarDados());
    return { ok: true, bytes: png.length, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, erro: e.message, stack: String(e.stack || '').split(/\r?\n/).slice(0, 6), ms: Date.now() - t0 };
  }
}

/** Chamado quando uma execução AGENDADA do bot Stone termina. */
export async function aposExecucaoBot(execucao) {
  if (!ENABLED) return null;
  if (execucao?.origem !== 'agendado') return null;
  try {
    return await enviarRelatorio({ motivo: `execução #${execucao.id}` });
  } catch (e) {
    console.error(`[relatorio-saldos] após execução #${execucao?.id}: ${e.message}`);
    return null;
  }
}

/** Cron de segurança: se o bot do PC não rodou no horário, manda com os dados que existem. */
export function iniciarRelatorioSaldos() {
  if (!ENABLED) {
    console.log('[relatorio-saldos] desligado (RELATORIO_SALDOS_ENABLED=false)');
    return;
  }
  const exprs = String(env('RELATORIO_SALDOS_CRON_FALLBACK', '50 9 * * *;20 14 * * *;20 18 * * *')).split(';').map((s) => s.trim()).filter(Boolean);
  for (const expr of exprs) {
    cron.schedule(
      expr,
      () => {
        if (Date.now() - ultimoEnvio.em < 40 * 60 * 1000 && ultimoEnvio.ok) return; // já foi depois do bot
        enviarRelatorio({ motivo: 'cron fallback' }).catch((e) => console.error('[relatorio-saldos] fallback:', e.message));
      },
      { timezone: 'America/Sao_Paulo' },
    );
  }
  console.log(`[relatorio-saldos] fallback agendado (${exprs.join(' | ')} America/Sao_Paulo) · grupo "${GRUPO_NOME}" · marca ${MENCIONAR}`);
}

export default { montarDados, gerarImagem, textoProgramacao, enviarRelatorio, aposExecucaoBot, iniciarRelatorioSaldos, statusRelatorio, semanaDe };
