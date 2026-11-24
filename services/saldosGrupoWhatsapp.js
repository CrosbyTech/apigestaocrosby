// ============================================================
// SALDO BANCÁRIO NO GRUPO "CONTAS A PAGAR CROSBY OFC" — de hora em hora.
//
// Pedido do Yago (24/11/2026): o bot da Stone consulta o saldo a cada 1 h e o
// HeadCoach manda no grupo, de SEGUNDA A SEXTA, das 9h às 20h. Substitui o
// relatório 3x ao dia (saldos + previsão da Liberação antiga), removido no
// mesmo dia.
//
// Quando manda: ao fim de uma execução do bot que o próprio bot marcou para
// avisar (parametros.avisarGrupo — as consultas de hora cheia) e que trouxe
// saldo. Se o PC do bot estiver desligado não vai nada: saldo velho não é
// mandado como se fosse novo.
// O que manda: a IMAGEM do card "Saldo Bancário" (total, um chip por banco e a
// hora da atualização), marcando o Fábio, assinada "— Veveto". Se o Chrome não
// abrir, vai o mesmo conteúdo em texto.
//
// Env: SALDO_GRUPO_ENABLED (default true). Grupo e menção: os mesmos de
//      services/relatorioSaldosWhatsapp.js (RELATORIO_SALDOS_*).
// ============================================================
import * as wa from './whatsappContasPagar.js';
import { montarSaldos, grupoChatid, MENCIONAR } from './relatorioSaldosWhatsapp.js';
import { dentroDoHorarioDoSaldo, quandoFoi, textoDoSaldo } from '../utils/saldoGrupo.js';

const ENABLED = String(process.env.SALDO_GRUPO_ENABLED ?? 'true').toLowerCase() !== 'false';
const NOME_MENCIONADO = process.env.RELATORIO_SALDOS_NOME_MENCIONADO || 'Fábio';
const TRACK_ID = 'veveto';
const ASSINATURA = '— Veveto';
const fmt = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

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
  .foot{margin-top:12px;font-size:11px;color:#6b7280;display:flex;justify-content:space-between}.foot b{color:#111827}
  </style></head><body><div class="card">
    <div class="head"><div class="ico">R$</div><div><div class="t1">Saldo Bancário <small>· ${d.bancos.filter((b) => b.valor > 0).length} banco(s) · HeadCoach</small></div><div class="total">${fmt(d.total)}</div></div></div>
    <div class="chips" style="margin-bottom:0">${d.bancos.map(chip).join('')}</div>
    ${d.detalhado ? `<div class="sec" style="margin-top:14px">
      <div class="box"><h4>Stone por conta${d.antecipavel > 0 ? ` · <b>${fmt(d.antecipavel)} para antecipar</b>` : ''}</h4>${d.stone.length ? d.stone.map(linhaStone).join('') : '<div class="row"><span class="rot">sem captura do bot</span></div>'}</div>
      <div class="box"><h4>Pagar.me${d.pagarme.some((p) => p.aReceber > 0) ? ` · <i>${fmt(d.pagarme.reduce((a, p) => a + p.aReceber, 0))} a receber</i>` : ''}</h4>${d.pagarme.length ? d.pagarme.map(linhaPg).join('') : '<div class="row"><span class="rot">sem captura</span></div>'}</div>
    </div>` : ''}
    <div class="foot"><span>Atualizado em <b>${esc(quandoFoi(d.atualizadoEm))}</b></span><span>HeadCoach</span></div>
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


/** PNG do card de saldos (só cabeçalho + chips, como o Yago definiu em 27/10). */
export async function gerarImagem(dados) {
  const browser = await abrirNavegador();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 760, height: 600, deviceScaleFactor: 2 });
    await page.setContent(htmlDoCard(dados), { waitUntil: 'load' });
    const el = await page.$('.card');
    return Buffer.from(await (el || page).screenshot({ type: 'png' }));
  } finally {
    await browser.close().catch(() => {});
  }
}

const legenda = (d) => `${MENCIONAR ? `@${MENCIONAR}` : NOME_MENCIONADO}, segue o saldo atual (atualizado em ${quandoFoi(d.atualizadoEm)})

${ASSINATURA}`;

let ultimoEnvio = { em: 0, motivo: null, ok: null, erro: null };
export const statusSaldoGrupo = () => ({ enabled: ENABLED, mencionar: MENCIONAR, ultimoEnvio });

/** Manda o saldo no grupo agora (imagem; texto se a imagem falhar). */
export async function enviarSaldoNoGrupo({ motivo = 'manual' } = {}) {
  if (!wa.isConfigurado()) throw new Error('WhatsApp Contas a Pagar não configurado');
  const grupo = await grupoChatid();
  const dados = await montarSaldos();
  const out = { ok: false, grupo, motivo, total: dados.total, atualizadoEm: dados.atualizadoEm, imagem: false };
  try {
    let png = null;
    try {
      png = await gerarImagem(dados);
    } catch (e) {
      out.imagemErro = e.message;
      console.warn(`[saldo-grupo] imagem falhou (${e.message}) — mando em texto`);
    }
    if (png) {
      await wa.enviarMidia({ number: grupo, type: 'image', file: `data:image/png;base64,${png.toString('base64')}`, text: legenda(dados), mentions: MENCIONAR, trackId: TRACK_ID });
      out.imagem = true;
    } else {
      await wa.enviarTexto({ number: grupo, text: `${MENCIONAR ? `@${MENCIONAR}` : NOME_MENCIONADO}\n${textoDoSaldo(dados, { assinatura: ASSINATURA })}`, mentions: MENCIONAR, trackId: TRACK_ID });
    }
    out.ok = true;
    ultimoEnvio = { em: Date.now(), motivo, ok: true, erro: null };
  } catch (e) {
    ultimoEnvio = { em: Date.now(), motivo, ok: false, erro: e.message };
    throw e;
  }
  console.log(`[saldo-grupo] enviado (${motivo}) → ${grupo} · ${fmt(dados.total)}`);
  return out;
}

/**
 * Chamado quando uma execução do bot Stone termina. Só manda se o bot marcou a
 * execução para avisar, se ela trouxe saldo e se é segunda a sexta, 9h–20h.
 */
export async function aposExecucaoBot(execucao) {
  if (!ENABLED) return null;
  if (!execucao?.parametros?.avisarGrupo) return null;
  if (execucao?.resumo?.saldoTotal == null) return null; // a consulta não trouxe saldo: nada novo para mostrar
  if (!dentroDoHorarioDoSaldo(new Date())) return null;
  try {
    return await enviarSaldoNoGrupo({ motivo: `execução #${execucao.id}` });
  } catch (e) {
    console.error(`[saldo-grupo] após execução #${execucao?.id}: ${e.message}`);
    return null;
  }
}

export default { gerarImagem, enviarSaldoNoGrupo, aposExecucaoBot, statusSaldoGrupo };
