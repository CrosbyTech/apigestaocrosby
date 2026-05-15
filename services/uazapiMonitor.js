// ─────────────────────────────────────────────────────────────────────
// UAzapi Monitor — polling a cada N min (default 15) de /instance/all.
// Detecta transições para `disconnected`, gera relatório de causa e
// dispara alerta via WhatsApp pela instância configurada (crosbybot).
// ─────────────────────────────────────────────────────────────────────
import axios from 'axios';
import { getPool } from './uazapiSync.js';

const UAZ_BASE = process.env.UAZAPI_BASE_URL || '';
const UAZ_ADMIN = process.env.UAZAPI_ADMIN_TOKEN || '';

const ALERT_INSTANCE = process.env.UAZAPI_ALERT_INSTANCE || 'crosbybot';
const ALERT_RECIPIENT = process.env.UAZAPI_ALERT_RECIPIENT || '';
const POLL_INTERVAL_MIN = Number(process.env.UAZAPI_MONITOR_INTERVAL_MIN) || 15;

import crypto from 'node:crypto';
function toDeterministicUUID(input) {
  const hash = crypto
    .createHash('sha1')
    .update(`uazapi:${input}`)
    .digest('hex')
    .slice(0, 32);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-${(parseInt(hash[16], 16) & 0x3 | 0x8).toString(16)}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

// ─── normalização do número de telefone ───────────────────────────────
function normalizeBrPhone(s) {
  const d = String(s || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('55')) return d;
  // adiciona 55 (Brasil) se for 10 ou 11 dígitos (DDD + número)
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

// ─── Classifica causa da desconexão ───────────────────────────────────
function classifyDisconnect(reason, msgStats) {
  const r = String(reason || '').toLowerCase();
  if (r.includes('banned') || r.includes('blocked') || r.includes('403')) {
    return {
      code: 'BAN',
      label: '🚫 Conta BANIDA pelo WhatsApp',
      severity: 'critical',
    };
  }
  if (r.includes('logged') || r === 'loggedout') {
    return {
      code: 'LOGOUT',
      label: '🔓 Logout (manual ou outra sessão entrou)',
      severity: 'info',
    };
  }
  if (r.includes('replaced')) {
    return {
      code: 'REPLACED',
      label: '🔁 Sessão substituída por outra (não é ban)',
      severity: 'info',
    };
  }
  if (r.includes('timeout') || r.includes('network') || r.includes('connection')) {
    return {
      code: 'NETWORK',
      label: '🌐 Possível queda de conexão / servidor',
      severity: 'warning',
    };
  }
  // sem reason explícito: tenta inferir pelo padrão das msgs
  if (msgStats) {
    const { totalLastHour, uniqueContactsLastHour, topRepeatRatio, nightShare } = msgStats;
    if (totalLastHour > 80 && topRepeatRatio > 0.4) {
      return {
        code: 'SUSPECTED_BAN',
        label: '⚠️ Padrão de spam detectado (envios em massa) — provável ban',
        severity: 'critical',
      };
    }
    if (totalLastHour > 150) {
      return {
        code: 'HIGH_VOLUME',
        label: '⚠️ Alto volume de envios — possível flag por anti-spam',
        severity: 'warning',
      };
    }
    if (nightShare > 0.5) {
      return {
        code: 'NIGHT_PATTERN',
        label: '🌙 Maioria das msgs em horário noturno — pode ter chamado atenção',
        severity: 'warning',
      };
    }
  }
  return {
    code: 'UNKNOWN',
    label: '❓ Causa não identificada — verifique manualmente',
    severity: 'warning',
  };
}

// ─── Gera relatório das últimas 24h do dispositivo ────────────────────
export async function generateDisconnectReport(instanceId) {
  const pool = getPool();

  const stats = await pool.query(
    `WITH recent AS (
       SELECT * FROM messages
        WHERE instance_id = $1
          AND from_me = true
          AND message_timestamp >= NOW() - INTERVAL '24 hours'
     ),
     recent_1h AS (
       SELECT * FROM messages
        WHERE instance_id = $1
          AND from_me = true
          AND message_timestamp >= NOW() - INTERVAL '1 hour'
     )
     SELECT
       (SELECT COUNT(*) FROM recent)::int                                AS total_24h,
       (SELECT COUNT(DISTINCT chatid) FROM recent)::int                  AS contatos_24h,
       (SELECT COUNT(*) FROM recent_1h)::int                             AS total_1h,
       (SELECT COUNT(DISTINCT chatid) FROM recent_1h)::int               AS contatos_1h,
       (SELECT COUNT(*) FROM recent
          WHERE EXTRACT(HOUR FROM message_timestamp AT TIME ZONE 'America/Sao_Paulo') BETWEEN 0 AND 5)::int
                                                                         AS msgs_madrugada,
       (SELECT COUNT(*) FROM recent
          WHERE text ~* 'https?://')::int                                AS msgs_com_link,
       (SELECT COUNT(*) FROM recent
          WHERE message_type IN ('image','video','audio','document','sticker'))::int
                                                                         AS msgs_com_midia`,
    [instanceId],
  );

  const top = await pool.query(
    `SELECT TRIM(LEFT(text, 100)) AS texto, COUNT(*)::int AS n
       FROM messages
      WHERE instance_id = $1
        AND from_me = true
        AND message_timestamp >= NOW() - INTERVAL '24 hours'
        AND text IS NOT NULL
        AND LENGTH(TRIM(text)) > 5
      GROUP BY TRIM(LEFT(text, 100))
      ORDER BY n DESC, texto
      LIMIT 5`,
    [instanceId],
  );

  const peakHour = await pool.query(
    `SELECT date_trunc('hour', message_timestamp AT TIME ZONE 'America/Sao_Paulo') AS h,
            COUNT(*)::int AS n
       FROM messages
      WHERE instance_id = $1
        AND from_me = true
        AND message_timestamp >= NOW() - INTERVAL '24 hours'
      GROUP BY h
      ORDER BY n DESC
      LIMIT 1`,
    [instanceId],
  );

  const lastMsgs = await pool.query(
    `SELECT message_timestamp, chatid, message_type, LEFT(text, 120) AS text_short
       FROM messages
      WHERE instance_id = $1
        AND from_me = true
      ORDER BY message_timestamp DESC NULLS LAST
      LIMIT 30`,
    [instanceId],
  );

  const s = stats.rows[0] || {};
  const topTexts = top.rows;
  const totalRepeated = topTexts.reduce((a, x) => a + (Number(x.n) || 0), 0);
  const topRepeatRatio = s.total_24h ? totalRepeated / Number(s.total_24h) : 0;
  const nightShare = s.total_24h ? Number(s.msgs_madrugada) / Number(s.total_24h) : 0;
  const linkShare = s.total_24h ? Number(s.msgs_com_link) / Number(s.total_24h) : 0;

  return {
    stats: {
      total24h: Number(s.total_24h) || 0,
      contatos24h: Number(s.contatos_24h) || 0,
      totalLastHour: Number(s.total_1h) || 0,
      uniqueContactsLastHour: Number(s.contatos_1h) || 0,
      msgsMadrugada: Number(s.msgs_madrugada) || 0,
      msgsComLink: Number(s.msgs_com_link) || 0,
      msgsComMidia: Number(s.msgs_com_midia) || 0,
      topRepeatRatio,
      nightShare,
      linkShare,
    },
    topTexts,
    peakHour: peakHour.rows[0] || null,
    lastMessages: lastMsgs.rows,
  };
}

// ─── Formata mensagem WhatsApp do alerta ──────────────────────────────
function formatAlertText(instance, prevStatus, newStatus, reason, cause, report) {
  const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const s = report?.stats || {};
  const lines = [];
  lines.push('🚨 *DISPOSITIVO DESCONECTADO*');
  lines.push('');
  lines.push(`📱 Instância: *${instance.name || instance.id}*`);
  lines.push(`🕐 Detectado: ${now}`);
  lines.push(`🔌 Status: ${prevStatus || '?'} → *${newStatus}*`);
  if (reason) lines.push(`❓ Reason: ${reason}`);
  lines.push('');
  lines.push(`📊 *Causa provável*: ${cause.label}`);
  lines.push('');

  if (s.total24h !== undefined) {
    lines.push('🔍 *Últimas 24h (msgs enviadas pela instância)*:');
    lines.push(`• Total: *${s.total24h}*`);
    lines.push(`• Contatos únicos: ${s.contatos24h}`);
    lines.push(`• Última 1h: ${s.totalLastHour} msgs / ${s.uniqueContactsLastHour} contatos`);
    if (s.msgsComLink > 0)
      lines.push(`• Com link: ${s.msgsComLink} (${(s.linkShare * 100).toFixed(0)}%)`);
    if (s.msgsComMidia > 0)
      lines.push(`• Com mídia: ${s.msgsComMidia}`);
    if (s.msgsMadrugada > 0)
      lines.push(`• Madrugada (00h-06h): ${s.msgsMadrugada} (${(s.nightShare * 100).toFixed(0)}%)`);
    if (report?.peakHour) {
      const ph = new Date(report.peakHour.h);
      const hh = String(ph.getUTCHours()).padStart(2, '0');
      lines.push(`• Pico: ${hh}h com ${report.peakHour.n} msgs`);
    }
    lines.push('');
  }

  if (Array.isArray(report?.topTexts) && report.topTexts.length > 0) {
    lines.push('📝 *Textos mais repetidos*:');
    for (const t of report.topTexts.slice(0, 3)) {
      const txt = (t.texto || '').replace(/\s+/g, ' ').slice(0, 60);
      lines.push(`• ${t.n}x: "${txt}${txt.length >= 60 ? '...' : ''}"`);
    }
    lines.push('');
  }

  if (cause.severity === 'critical') {
    lines.push('🆘 *AÇÃO RECOMENDADA*: verificar imediatamente — risco de banimento permanente.');
  }

  return lines.join('\n');
}

// ─── Busca token da instância sender (crosbybot) ──────────────────────
async function getAlertSenderToken() {
  const pool = getPool();
  // tenta exato
  let r = await pool.query(
    `SELECT id, name, token, status FROM instances
      WHERE LOWER(name) = LOWER($1)
      ORDER BY (status = 'connected') DESC
      LIMIT 1`,
    [ALERT_INSTANCE],
  );
  if (r.rows[0]?.token) return r.rows[0];
  // fallback: contém
  r = await pool.query(
    `SELECT id, name, token, status FROM instances
      WHERE LOWER(name) LIKE '%' || LOWER($1) || '%'
      ORDER BY (status = 'connected') DESC
      LIMIT 1`,
    [ALERT_INSTANCE],
  );
  return r.rows[0] || null;
}

// ─── Envia o alerta via UAzapi ────────────────────────────────────────
async function sendAlertViaUaz(text) {
  if (!ALERT_RECIPIENT) {
    throw new Error('UAZAPI_ALERT_RECIPIENT não configurado');
  }
  const sender = await getAlertSenderToken();
  if (!sender?.token) {
    throw new Error(`Instância "${ALERT_INSTANCE}" não encontrada no banco (rode sync antes)`);
  }
  if (sender.status && sender.status !== 'connected') {
    console.warn(`[uazapi-monitor] sender "${sender.name}" status=${sender.status}, tentando mesmo assim`);
  }
  const number = normalizeBrPhone(ALERT_RECIPIENT);
  // UAzapi padrão: POST /send/text com { number, text }
  try {
    await axios.post(
      `${UAZ_BASE}/send/text`,
      { number, text },
      {
        headers: { token: sender.token, 'Content-Type': 'application/json' },
        timeout: 30_000,
      },
    );
  } catch (err) {
    // fallback alternativo (algumas builds)
    if (err.response?.status === 404) {
      await axios.post(
        `${UAZ_BASE}/sendText`,
        { number, text },
        {
          headers: { token: sender.token, 'Content-Type': 'application/json' },
          timeout: 30_000,
        },
      );
    } else {
      throw err;
    }
  }
  return { sender: sender.name, recipient: number };
}

// ─── Polling principal ────────────────────────────────────────────────
async function pollOnce() {
  if (!UAZ_BASE || !UAZ_ADMIN) {
    console.warn('[uazapi-monitor] UAZAPI_BASE_URL/UAZAPI_ADMIN_TOKEN não configurados');
    return;
  }
  let insts;
  try {
    const { data } = await axios.get(`${UAZ_BASE}/instance/all`, {
      headers: { AdminToken: UAZ_ADMIN },
      timeout: 30_000,
    });
    insts = Array.isArray(data) ? data : data?.instances || [];
  } catch (err) {
    console.warn(`[uazapi-monitor] falha em /instance/all: ${err.message}`);
    return;
  }

  const pool = getPool();
  for (const inst of insts) {
    if (!inst.id) continue;
    const instUuid = toDeterministicUUID(inst.id);
    const newStatus = String(inst.status || 'unknown').toLowerCase();
    const reason = inst.lastDisconnectReason || null;

    let prevStatus = null;
    try {
      const r = await pool.query(
        `SELECT status FROM instances WHERE id = $1`,
        [instUuid],
      );
      prevStatus = r.rows[0]?.status || null;
    } catch (err) {
      console.warn(`[uazapi-monitor] falha lendo status: ${err.message}`);
    }

    if (prevStatus === newStatus) continue; // sem mudança

    // Registra transição
    try {
      await pool.query(
        `INSERT INTO uazapi_instance_status_history
           (instance_id, instance_name, prev_status, new_status, reason)
         VALUES ($1, $2, $3, $4, $5)`,
        [instUuid, inst.name || null, prevStatus, newStatus, reason],
      );
      // Atualiza status atual em instances
      await pool.query(
        `UPDATE instances
            SET status = $1,
                last_disconnect_reason = COALESCE($2, last_disconnect_reason),
                updated_at = NOW()
          WHERE id = $3`,
        [newStatus, reason, instUuid],
      );
    } catch (err) {
      console.warn(`[uazapi-monitor] falha registrando transição: ${err.message}`);
      continue;
    }

    console.log(
      `[uazapi-monitor] ${inst.name}: ${prevStatus} → ${newStatus}${reason ? ` (reason: ${reason})` : ''}`,
    );

    // Só alerta se transição foi PARA disconnected
    if (newStatus !== 'disconnected') continue;

    // Gera relatório e envia alerta
    let report = null;
    let cause = null;
    try {
      report = await generateDisconnectReport(instUuid);
      cause = classifyDisconnect(reason, report.stats);
    } catch (err) {
      console.warn(`[uazapi-monitor] falha gerando relatório: ${err.message}`);
      cause = classifyDisconnect(reason, null);
      report = { stats: {}, topTexts: [], peakHour: null, lastMessages: [] };
    }

    const text = formatAlertText(inst, prevStatus, newStatus, reason, cause, report);
    let alertOk = false;
    let alertErr = null;
    try {
      const r = await sendAlertViaUaz(text);
      alertOk = true;
      console.log(`[uazapi-monitor] alerta enviado: ${r.sender} → ${r.recipient}`);
    } catch (err) {
      alertErr = err.message;
      console.error(`[uazapi-monitor] falha ao enviar alerta: ${err.message}`);
    }

    // Atualiza última linha de história com resultado do alerta + relatório
    try {
      await pool.query(
        `UPDATE uazapi_instance_status_history
            SET alerted = $1,
                alerted_at = NOW(),
                alert_channel = $2,
                alert_error = $3,
                report = $4
          WHERE id = (SELECT MAX(id) FROM uazapi_instance_status_history WHERE instance_id = $5)`,
        [alertOk, alertOk ? 'uazapi-whatsapp' : null, alertErr, JSON.stringify({ cause, ...report }), instUuid],
      );
    } catch (err) {
      console.warn(`[uazapi-monitor] falha atualizando history: ${err.message}`);
    }
  }
}

// ─── Cron principal ───────────────────────────────────────────────────
let MONITOR_TIMER = null;
export function iniciarUazapiMonitor() {
  if (MONITOR_TIMER) {
    clearInterval(MONITOR_TIMER);
    MONITOR_TIMER = null;
  }
  const intervalMs = POLL_INTERVAL_MIN * 60 * 1000;
  console.log(
    `🔍 [uazapi-monitor] Polling a cada ${POLL_INTERVAL_MIN} min — alertas via instância "${ALERT_INSTANCE}" → ${ALERT_RECIPIENT}`,
  );
  // Não roda imediatamente no startup pra evitar avalanche de "transições"
  // baseadas em status desatualizado. Espera 1 ciclo.
  MONITOR_TIMER = setInterval(() => {
    pollOnce().catch((e) => {
      console.error('[uazapi-monitor] erro no ciclo:', e.message);
    });
  }, intervalMs);
}

// Permite forçar 1 ciclo manualmente (rota /monitor/run)
export async function runMonitorOnce() {
  await pollOnce();
}

// Exporta gerador de relatório pra uso pelas rotas
export { classifyDisconnect };
