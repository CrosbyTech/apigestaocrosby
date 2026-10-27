// ============================================================
// RELATÓRIO DE SALDOS NO WHATSAPP — grupo "CONTAS A PAGAR CROSBY OFC"
//
// 3x ao dia (depois da execução agendada do bot Stone das 09:30/14:00/18:00,
// com fallback por cron) o HeadCoach manda no grupo, pela instância CONTAS A
// PAGAR (a mesma dos agentes JOJO/BRUCE/THEO/CAIXA):
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
const MENCIONAR = String(env('RELATORIO_SALDOS_MENCIONAR', '558487820986')).replace(/\D/g, '');
const NOME_MENCIONADO = env('RELATORIO_SALDOS_NOME_MENCIONADO', 'Fábio');
const TRACK_ID = 'relatorio-saldos';

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const fmt = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtData = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
const sufixoCnpj = (cnpj) => {
  const d = String(cnpj || '').replace(/\D/g, '');
  return d.length === 14 ? d.slice(8, 12) : d.slice(-4);
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

let grupoCache = { id: env('RELATORIO_SALDOS_GRUPO_CHATID', null) || null, em: 0 };
export async function grupoChatid() {
  if (grupoCache.id) return grupoCache.id;
  const g = await wa.acharGrupoPorNome(GRUPO_NOME);
  if (!g?.id) throw new Error(`grupo "${GRUPO_NOME}" não encontrado na instância CONTAS A PAGAR`);
  grupoCache = { id: g.id, em: Date.now() };
  return g.id;
}

// ─── dados ────────────────────────────────────────────────────
export async function montarDados() {
  const BANCOS = ['STONE', 'PAGARME', 'PAGARME A RECEBER', 'ITAU RECIFE', 'MENTORE'];
  const { data: sb } = await supabase.from('saldo_bancario').select('*').in('banco', BANCOS);
  const saldoDe = (b) => Number((sb || []).find((x) => x.banco === b)?.valor || 0);
  const bancos = BANCOS.map((b) => ({ banco: b, valor: round2(saldoDe(b)) }));
  const total = round2(bancos.reduce((a, b) => a + b.valor, 0));

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
  const capturadoEm = ult?.[0]?.capturado_em || null;

  const semana = semanaDe();
  const { data: prov } = await supabase
    .from('pagamentos_liberacao')
    .select('id,nm_fornecedor,vl_duplicata,vl_real,dt_vencimento,nm_empresa,forma_pagamento,dados_completos')
    .eq('status', 'PROVISAO')
    .gte('dt_vencimento', semana.de)
    .lte('dt_vencimento', semana.ate)
    .order('dt_vencimento')
    .order('nm_fornecedor');
  const programacao = (prov || []).map((p) => ({ id: p.id, fornecedor: p.nm_fornecedor || '—', valor: Number(p.vl_real ?? p.vl_duplicata ?? 0), vencimento: p.dt_vencimento, empresa: p.nm_empresa, origem: p.dados_completos?.origem || null }));
  const totalProgramacao = round2(programacao.reduce((a, p) => a + p.valor, 0));

  return { geradoEm: agoraBr(), capturadoEm, dia, bancos, total, stone, pagarme, antecipavel, semana, programacao, totalProgramacao };
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
    <div class="chips">${d.bancos.map(chip).join('')}</div>
    <div class="sec">
      <div class="box"><h4>Stone por conta${d.antecipavel > 0 ? ` · <b>${fmt(d.antecipavel)} para antecipar</b>` : ''}</h4>${d.stone.length ? d.stone.map(linhaStone).join('') : '<div class="row"><span class="rot">sem captura do bot</span></div>'}</div>
      <div class="box"><h4>Pagar.me${d.pagarme.some((p) => p.aReceber > 0) ? ` · <i>${fmt(d.pagarme.reduce((a, p) => a + p.aReceber, 0))} a receber</i>` : ''}</h4>${d.pagarme.length ? d.pagarme.map(linhaPg).join('') : '<div class="row"><span class="rot">sem captura</span></div>'}
        <h4 style="margin-top:12px">Programação da semana (${fmtData(d.semana.de)} a ${fmtData(d.semana.ate)})</h4>
        <div class="row"><span class="rot">${d.programacao.length} título(s) em previsão</span><span class="val">${fmt(d.totalProgramacao)}</span><span class="ant"></span></div>
      </div>
    </div>
    <div class="foot"><span>Saldos capturados ${d.capturadoEm ? new Date(d.capturadoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'} pelo bot Stone/Pagar.me</span><span>gerado ${esc(d.geradoEm)}</span></div>
  </div></body></html>`;
}

export async function gerarImagem(dados) {
  const { launchPuppeteer } = await import('../routes/autentique.routes.js');
  const { browser } = await launchPuppeteer();
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
export function textoProgramacao(d) {
  const linhas = [`*Programação da semana* (${fmtData(d.semana.de)} a ${fmtData(d.semana.ate)}) — títulos em previsão na Liberação de Pagamento:`];
  if (!d.programacao.length) linhas.push('• nenhum título em previsão para esta semana.');
  let diaAtual = null;
  for (const p of d.programacao) {
    if (p.vencimento !== diaAtual) {
      diaAtual = p.vencimento;
      linhas.push(`\n📅 *${fmtData(p.vencimento)}*`);
    }
    linhas.push(`• ${p.fornecedor} — ${fmt(p.valor)}`);
  }
  linhas.push(`\nTotal: *${fmt(d.totalProgramacao)}* em ${d.programacao.length} título(s).`);
  linhas.push(`\nPara incluir algo na lista, é só me chamar aqui: "caixa, adiciona <fornecedor> <valor> vence <data>".`);
  return linhas.join('\n');
}

function legendaImagem(d) {
  const quem = MENCIONAR ? `@${MENCIONAR} ` : '';
  return `${quem}${NOME_MENCIONADO}, segue o saldo do momento (${d.geradoEm}):\n• Total: *${fmt(d.total)}*\n• Stone: ${fmt(d.bancos.find((b) => b.banco === 'STONE')?.valor)}${d.antecipavel > 0 ? ` (+${fmt(d.antecipavel)} para antecipar)` : ''}\n• Pagar.me: ${fmt(d.bancos.find((b) => b.banco === 'PAGARME')?.valor)} disponível + ${fmt(d.bancos.find((b) => b.banco === 'PAGARME A RECEBER')?.valor)} a receber`;
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
export async function enviarRelatorio({ motivo = 'manual', soTexto = false } = {}) {
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
        out.imagemErro = e.message;
        console.warn(`[relatorio-saldos] imagem falhou (${e.message}) — mando só texto`);
      }
      if (png) {
        const r = await wa.enviarMidia({ number: grupo, type: 'image', file: `data:image/png;base64,${png.toString('base64')}`, text: legendaImagem(dados), mentions: MENCIONAR, trackId: TRACK_ID });
        out.imagem = r?.resposta?.id || true;
      } else {
        const r = await wa.enviarTexto({ number: grupo, text: legendaImagem(dados), mentions: MENCIONAR, trackId: TRACK_ID });
        out.imagem = r?.resposta?.id || true;
      }
    }
    const r2 = await wa.enviarTexto({ number: grupo, text: textoProgramacao(dados), trackId: TRACK_ID });
    out.texto = r2?.resposta?.id || true;
    out.ok = true;
    ultimoEnvio = { em: Date.now(), motivo, ok: true, erro: null };
  } catch (e) {
    ultimoEnvio = { em: Date.now(), motivo, ok: false, erro: e.message };
    throw e;
  }
  console.log(`[relatorio-saldos] enviado (${motivo}) → ${grupo}`);
  return out;
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
