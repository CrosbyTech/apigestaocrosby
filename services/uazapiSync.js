// ─────────────────────────────────────────────────────────────────────────
// UAzapi Sync — pega dados via REST e popula o banco Postgres dedicado
// (database1.crosbytech.com.br/uazapi).
//
// Tabelas alimentadas:
//   - instances (UAzapi instances)
//   - chats     (1 linha por chat de cada instância)
//   - messages  (mensagens do chat)
//
// Estratégia incremental: para cada instância, pega mensagens com
// timestamp >= last_message_timestamp salvo no banco − overlap de 6h
// (pra cobrir reordenamentos). Se for o primeiro sync, faz full.
// ─────────────────────────────────────────────────────────────────────────
import axios from 'axios';
import pg from 'pg';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── config de download de mídia ────────────────────────────────────
export const MEDIA_DIR = path.resolve(__dirname, '..', 'uploads', 'uazapi-media');
const MAX_MEDIA_BYTES = 50 * 1024 * 1024; // 50 MB
const DOWNLOAD_CONCURRENCY = 5;
const DOWNLOAD_TIMEOUT_MS = 60_000;
// permite desligar via env (UAZAPI_DOWNLOAD_MEDIA=false)
const DOWNLOAD_MEDIA_ENABLED = String(
  process.env.UAZAPI_DOWNLOAD_MEDIA ?? 'true',
).toLowerCase() !== 'false';

const MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/webm': 'weba',
  'audio/aac': 'aac',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/zip': 'zip',
  'application/x-rar-compressed': 'rar',
  'text/plain': 'txt',
  'text/csv': 'csv',
};

function extFromMime(mime, msgType) {
  if (mime) {
    const clean = String(mime).toLowerCase().split(';')[0].trim();
    if (MIME_TO_EXT[clean]) return MIME_TO_EXT[clean];
    // fallback genérico: usa o que vem depois de "/"
    const sub = clean.split('/')[1];
    if (sub) return sub.replace(/[^a-z0-9]/g, '').slice(0, 6) || 'bin';
  }
  // fallback por tipo de mensagem
  if (msgType === 'image') return 'jpg';
  if (msgType === 'video') return 'mp4';
  if (msgType === 'audio') return 'ogg';
  if (msgType === 'document') return 'bin';
  if (msgType === 'sticker') return 'webp';
  return 'bin';
}

// Extrai URL e mime de mensagem UAzapi (vários formatos possíveis)
function extractMediaInfo(m) {
  const url =
    m.fileURL ||
    m.fileUrl ||
    m.file_url ||
    m.mediaUrl ||
    m.media_url ||
    m.content?.imageMessage?.url ||
    m.content?.videoMessage?.url ||
    m.content?.audioMessage?.url ||
    m.content?.documentMessage?.url ||
    m.content?.stickerMessage?.url ||
    null;
  const mime =
    m.mimetype ||
    m.mime ||
    m.content?.imageMessage?.mimetype ||
    m.content?.videoMessage?.mimetype ||
    m.content?.audioMessage?.mimetype ||
    m.content?.documentMessage?.mimetype ||
    m.content?.stickerMessage?.mimetype ||
    null;
  return { url, mime };
}

function safeMsgIdForFs(s) {
  return String(s || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}

function buildMediaPaths(instUuid, m, mime) {
  const ts = Number(m.messageTimestamp || m.timestamp);
  const tsMs = ts ? (ts < 1e12 ? ts * 1000 : ts) : Date.now();
  const d = new Date(tsMs);
  const year = String(d.getUTCFullYear());
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const ext = extFromMime(mime, m.messageType || m.type);
  const safeId = safeMsgIdForFs(m.id || m.messageid);
  const fileName = `msg_${safeId}.${ext}`;
  const relative = `${instUuid}/${year}/${month}/${fileName}`;
  const absolute = path.join(MEDIA_DIR, instUuid, year, month, fileName);
  return { relative, absolute };
}

// Baixa 1 mídia. Retorna { path, size, mime } se sucesso, null se pulado, lança em erro fatal.
async function downloadOneMedia(instUuid, m) {
  const { url, mime } = extractMediaInfo(m);
  if (!url) return null;
  const chatid = m.chatid || m.key?.remoteJid || '';
  if (chatid.endsWith('@g.us')) return null; // pula grupos

  const { absolute, relative } = buildMediaPaths(instUuid, m, mime);

  // Idempotente — se já existe, só retorna stat
  if (fs.existsSync(absolute)) {
    try {
      const st = fs.statSync(absolute);
      return { path: relative, size: st.size, mime, alreadyExisted: true };
    } catch {}
  }

  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const tmp = `${absolute}.part`;

  let resp;
  try {
    resp = await axios.get(url, {
      responseType: 'stream',
      timeout: DOWNLOAD_TIMEOUT_MS,
      maxContentLength: MAX_MEDIA_BYTES,
      maxBodyLength: MAX_MEDIA_BYTES,
      validateStatus: (s) => s >= 200 && s < 300,
    });
  } catch (err) {
    throw new Error(`HTTP ${err.response?.status || ''} ${err.message}`);
  }

  const contentLen = Number(resp.headers['content-length'] || 0);
  if (contentLen > MAX_MEDIA_BYTES) {
    resp.data.destroy();
    throw new Error(`arquivo excede ${MAX_MEDIA_BYTES} bytes (${contentLen})`);
  }
  const respMime = String(resp.headers['content-type'] || '').split(';')[0].trim() || mime;

  let bytes = 0;
  let aborted = false;
  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(tmp);
    resp.data.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_MEDIA_BYTES) {
        aborted = true;
        resp.data.destroy();
        writer.destroy();
        reject(new Error(`arquivo excede ${MAX_MEDIA_BYTES} bytes (streaming)`));
      }
    });
    resp.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
    resp.data.on('error', reject);
  }).catch((e) => {
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  });

  if (aborted) {
    try { fs.unlinkSync(tmp); } catch {}
    throw new Error('download abortado');
  }

  fs.renameSync(tmp, absolute);
  return { path: relative, size: bytes, mime: respMime, alreadyExisted: false };
}

// Processa downloads de uma página de mensagens em paralelo (concorrência limitada)
async function processMediaForPage(client, instUuid, messages) {
  if (!DOWNLOAD_MEDIA_ENABLED) return { downloaded: 0, skipped: 0, errors: 0 };
  let downloaded = 0;
  let skipped = 0;
  let errors = 0;

  // Filtra candidatos: não-grupo + tem URL
  const candidates = messages.filter((m) => {
    const chatid = m.chatid || m.key?.remoteJid || '';
    if (!chatid || chatid.endsWith('@g.us')) return false;
    const { url } = extractMediaInfo(m);
    return !!url;
  });

  for (let i = 0; i < candidates.length; i += DOWNLOAD_CONCURRENCY) {
    const batch = candidates.slice(i, i + DOWNLOAD_CONCURRENCY);
    await Promise.all(
      batch.map(async (m) => {
        const messageId = m.id || m.messageid || m.message_id;
        if (!messageId) return;
        try {
          const result = await downloadOneMedia(instUuid, m);
          if (!result) {
            skipped++;
            return;
          }
          downloaded++;
          await client.query(
            `UPDATE messages
                SET media_local_path = $1,
                    media_size_bytes = $2,
                    media_mime       = $3,
                    media_downloaded_at = NOW(),
                    media_download_error = NULL
              WHERE instance_id = $4 AND message_id = $5`,
            [result.path, result.size, result.mime || null, instUuid, messageId],
          );
        } catch (err) {
          errors++;
          try {
            await client.query(
              `UPDATE messages
                  SET media_download_error = $1
                WHERE instance_id = $2 AND message_id = $3`,
              [String(err.message).slice(0, 500), instUuid, messageId],
            );
          } catch {}
        }
      }),
    );
  }

  return { downloaded, skipped, errors };
}

// Converte um id UAzapi (ex: "r78ad0bd3687162") em UUID v5-like
// determinístico. Mesma entrada → sempre mesma UUID.
function toDeterministicUUID(input) {
  const hash = crypto
    .createHash('sha1')
    .update(`uazapi:${input}`)
    .digest('hex')
    .slice(0, 32);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-${(parseInt(hash[16], 16) & 0x3 | 0x8).toString(16)}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

const UAZ_BASE = process.env.UAZAPI_BASE_URL || '';
const UAZ_ADMIN = process.env.UAZAPI_ADMIN_TOKEN || '';

let pool = null;
export function getPool() {
  if (pool) return pool;
  pool = new pg.Pool({
    host: process.env.UAZAPI_DB_HOST,
    port: Number(process.env.UAZAPI_DB_PORT) || 5432,
    user: process.env.UAZAPI_DB_USER,
    password: process.env.UAZAPI_DB_PASSWORD,
    database: process.env.UAZAPI_DB_NAME,
    ssl: false,
    max: 5,
    idleTimeoutMillis: 30_000,
    statement_timeout: 120_000,
  });
  return pool;
}

// ─── helpers ──────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tsToMs(v) {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  // UAzapi pode mandar em segundos ou ms
  return n < 1e12 ? n * 1000 : n;
}

function isoFromTsMs(ms) {
  if (!ms) return null;
  return new Date(ms).toISOString();
}

function digitsOnly(s) {
  return String(s || '').replace(/\D/g, '');
}

// ─── 1. Sync de instances ────────────────────────────────────────────
async function fetchUazInstances() {
  const { data } = await axios.get(`${UAZ_BASE}/instance/all`, {
    headers: { AdminToken: UAZ_ADMIN },
    timeout: 30_000,
  });
  return Array.isArray(data) ? data : data?.instances || [];
}

async function upsertInstances(client, instances) {
  let upserted = 0;
  for (const inst of instances) {
    if (!inst.id || !inst.token) continue;
    await client.query(
      `INSERT INTO instances
        (id, token, name, status, profile_name, profile_pic_url,
         is_business, plataform, system_name, owner, last_disconnect,
         last_disconnect_reason, openai_apikey, chatbot_enabled,
         created_at, updated_at, synced_at, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
               COALESCE($15, NOW()), NOW(), NOW(), $16)
       ON CONFLICT (id) DO UPDATE SET
         token = EXCLUDED.token,
         name = EXCLUDED.name,
         status = EXCLUDED.status,
         profile_name = EXCLUDED.profile_name,
         profile_pic_url = EXCLUDED.profile_pic_url,
         is_business = EXCLUDED.is_business,
         plataform = EXCLUDED.plataform,
         system_name = EXCLUDED.system_name,
         owner = EXCLUDED.owner,
         last_disconnect = EXCLUDED.last_disconnect,
         last_disconnect_reason = EXCLUDED.last_disconnect_reason,
         openai_apikey = EXCLUDED.openai_apikey,
         chatbot_enabled = EXCLUDED.chatbot_enabled,
         updated_at = NOW(),
         synced_at = NOW(),
         raw = EXCLUDED.raw`,
      [
        toDeterministicUUID(inst.id),
        inst.token,
        inst.name || null,
        inst.status || null,
        inst.profileName || null,
        inst.profilePicUrl || null,
        inst.isBusiness ?? null,
        inst.plataform || null,
        inst.systemName || null,
        inst.owner || null,
        inst.lastDisconnect ? new Date(inst.lastDisconnect).toISOString() : null,
        inst.lastDisconnectReason || null,
        inst.openaiApikey || null,
        inst.chatbotEnabled ?? null,
        inst.created ? new Date(inst.created).toISOString() : null,
        JSON.stringify(inst),
      ],
    );
    upserted++;
  }
  return upserted;
}

// ─── 2. Sync de chats ───────────────────────────────────────────────
// Pagina chat/find pra trazer TODOS os chats (não só os primeiros N)
async function fetchUazChats(token) {
  const all = [];
  let offset = 0;
  const limit = 500;
  for (let page = 0; page < 200; page++) {
    try {
      const { data } = await axios.post(
        `${UAZ_BASE}/chat/find`,
        {
          operator: 'AND',
          sort: '-wa_lastMsgTimestamp',
          limit,
          offset,
        },
        {
          headers: { token, 'Content-Type': 'application/json' },
          timeout: 60_000,
        },
      );
      const arr = Array.isArray(data?.chats)
        ? data.chats
        : Array.isArray(data)
          ? data
          : [];
      if (arr.length === 0) break;
      all.push(...arr);
      if (arr.length < limit) break;
      offset += limit;
    } catch (err) {
      const body = err.response?.data
        ? JSON.stringify(err.response.data).slice(0, 200)
        : '';
      console.warn(
        `[uazapi-sync chat/find offset=${offset}] ${err.message} ${body}`,
      );
      break;
    }
  }
  return all;
}

async function upsertChats(client, instanceId, chats) {
  let upserted = 0;
  for (const ch of chats) {
    const chatid = ch.wa_chatid || ch.chatid || ch.id;
    if (!chatid) continue;
    const phone = digitsOnly(
      ch.phone || ch.wa_chatid?.split('@')[0] || chatid?.split('@')[0],
    );
    const lastMsgTs = ch.wa_lastMsgTimestamp || ch.lastMessageTimestamp;
    const lastMsgIso = lastMsgTs
      ? isoFromTsMs(tsToMs(lastMsgTs))
      : null;
    await client.query(
      `INSERT INTO chats
        (instance_id, uaz_id, wa_fastid, wa_chatid, wa_chatlid, is_group,
         wa_contact_name, wa_name, name, image, image_preview, phone,
         wa_archived, wa_is_pinned, wa_is_blocked, wa_ephemeral_expiration,
         wa_label, wa_notes,
         wa_last_message_text_vote, wa_last_message_type,
         wa_last_msg_timestamp, wa_last_message_sender, wa_unread_count,
         lead_name, lead_full_name, lead_email, lead_personalid, lead_status,
         lead_tags, lead_notes, lead_fields,
         raw, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
               $18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,
               NOW(), NOW())
       ON CONFLICT (instance_id, wa_chatid) DO UPDATE SET
         wa_contact_name = EXCLUDED.wa_contact_name,
         wa_name = EXCLUDED.wa_name,
         name = EXCLUDED.name,
         image = EXCLUDED.image,
         phone = EXCLUDED.phone,
         wa_last_message_text_vote = EXCLUDED.wa_last_message_text_vote,
         wa_last_message_type = EXCLUDED.wa_last_message_type,
         wa_last_msg_timestamp = EXCLUDED.wa_last_msg_timestamp,
         wa_last_message_sender = EXCLUDED.wa_last_message_sender,
         wa_unread_count = EXCLUDED.wa_unread_count,
         lead_name = EXCLUDED.lead_name,
         lead_status = EXCLUDED.lead_status,
         lead_tags = EXCLUDED.lead_tags,
         raw = EXCLUDED.raw,
         updated_at = NOW()`,
      [
        instanceId,
        ch.id || null,
        ch.wa_fastid || null,
        chatid,
        ch.wa_chatlid || null,
        Boolean(ch.isGroup || ch.is_group),
        ch.wa_contactName || ch.wa_contact_name || null,
        ch.wa_name || null,
        ch.name || null,
        ch.image || null,
        ch.imagePreview || ch.image_preview || null,
        phone || null,
        ch.wa_archived ?? null,
        ch.wa_isPinned ?? ch.wa_is_pinned ?? null,
        ch.wa_isBlocked ?? ch.wa_is_blocked ?? null,
        ch.wa_ephemeralExpiration ?? null,
        Array.isArray(ch.wa_label) ? ch.wa_label : null,
        ch.wa_notes || null,
        ch.wa_lastMessage_text_vote || ch.wa_last_message_text_vote || null,
        ch.wa_lastMessage_type || ch.wa_last_message_type || null,
        lastMsgIso,
        ch.wa_lastMessage_sender || ch.wa_last_message_sender || null,
        ch.wa_unreadCount ?? ch.wa_unread_count ?? null,
        ch.lead_name || null,
        ch.lead_fullName || ch.lead_full_name || null,
        ch.lead_email || null,
        ch.lead_personalid || null,
        ch.lead_status || null,
        Array.isArray(ch.lead_tags) ? ch.lead_tags : null,
        ch.lead_notes || null,
        ch.lead_fields ? JSON.stringify(ch.lead_fields) : null,
        JSON.stringify(ch),
      ],
    );
    upserted++;
  }
  return upserted;
}

// ─── 3. Sync de messages ────────────────────────────────────────────
// /message/find — UAzapi aceita filtros mongo-style. Aqui trazemos por
// chatid (mais confiável que paginar tudo da instância) e desde um ts.
async function fetchUazMessagesPage(
  token,
  { chatid, since, offset = 0, limit = 1000 },
) {
  const body = {
    operator: 'AND',
    sort: 'messageTimestamp',
    limit,
    offset,
  };
  if (chatid) body.chatid = chatid;
  if (since) body.messageTimestamp = { $gte: since };

  try {
    const { data } = await axios.post(`${UAZ_BASE}/message/find`, body, {
      headers: { token, 'Content-Type': 'application/json' },
      timeout: 90_000,
    });
    const arr = Array.isArray(data?.messages)
      ? data.messages
      : Array.isArray(data)
        ? data
        : [];
    return {
      messages: arr,
      hasMore: arr.length >= limit,
      nextOffset: offset + arr.length,
    };
  } catch (err) {
    const ebody = err.response?.data
      ? JSON.stringify(err.response.data).slice(0, 300)
      : '';
    console.warn(
      `[uazapi-sync message/find chat=${chatid || 'all'} offset=${offset}] ${err.message} ${ebody}`,
    );
    return { messages: [], hasMore: false, nextOffset: offset };
  }
}

async function upsertMessages(client, instanceId, messages, chatIdMap) {
  if (messages.length === 0) return 0;
  let upserted = 0;
  // Insere em batch usando INSERT ... ON CONFLICT
  for (const m of messages) {
    const messageId = m.id || m.messageid || m.message_id;
    const chatid = m.chatid || m.key?.remoteJid;
    if (!messageId || !chatid) continue;
    const tsMs = tsToMs(m.messageTimestamp || m.timestamp);
    const tsIso = tsMs ? isoFromTsMs(tsMs) : null;
    const internalChatId = chatIdMap.get(chatid) || null;
    // URL de mídia pode vir em vários campos dependendo do tipo
    const mediaUrl =
      m.fileURL ||
      m.fileUrl ||
      m.file_url ||
      m.mediaUrl ||
      m.media_url ||
      m.content?.imageMessage?.url ||
      m.content?.videoMessage?.url ||
      m.content?.audioMessage?.url ||
      m.content?.documentMessage?.url ||
      m.content?.stickerMessage?.url ||
      null;

    await client.query(
      `INSERT INTO messages
        (instance_id, uaz_id, message_id, chatid, chat_id,
         sender, sender_name, sender_pn, sender_lid,
         is_group, from_me, message_type, source, message_timestamp, status,
         text, quoted_id, edited, reaction, vote,
         button_or_list_id, owner, content,
         was_sent_by_api, send_function, send_payload, file_url,
         track_source, track_id, ai_metadata,
         raw, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
               $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
               $31, NOW(), NOW())
       ON CONFLICT (instance_id, message_id) DO UPDATE SET
         status = EXCLUDED.status,
         text = EXCLUDED.text,
         edited = EXCLUDED.edited,
         reaction = EXCLUDED.reaction,
         vote = EXCLUDED.vote,
         content = EXCLUDED.content,
         updated_at = NOW()`,
      [
        instanceId,
        m.id_uaz || m.uaz_id || null,
        messageId,
        chatid,
        internalChatId,
        m.sender || null,
        m.senderName || m.sender_name || null,
        m.senderPn || m.sender_pn || null,
        m.senderLid || m.sender_lid || null,
        Boolean(m.isGroup || m.is_group),
        Boolean(m.fromMe || m.from_me),
        m.messageType || m.type || null,
        m.source || null,
        tsIso,
        m.status || null,
        m.text || m.content?.text || m.content?.extendedTextMessage?.text || null,
        m.quotedId || m.quoted_id || null,
        m.edited || null,
        m.reaction || null,
        m.vote || null,
        m.buttonOrListId || m.button_or_list_id || null,
        m.owner || null,
        m.content ? JSON.stringify(m.content) : null,
        m.wasSentByApi ?? null,
        m.sendFunction || null,
        m.sendPayload ? JSON.stringify(m.sendPayload) : null,
        mediaUrl,
        m.track?.source || m.track_source || null,
        m.track?.id || m.track_id || null,
        m.aiMetadata ? JSON.stringify(m.aiMetadata) : null,
        JSON.stringify(m),
      ],
    );
    upserted++;
  }
  return upserted;
}

// Constrói mapa wa_chatid → chats.id (bigint) pra preencher messages.chat_id
async function buildChatIdMap(client, instanceId) {
  const r = await client.query(
    `SELECT id, wa_chatid FROM chats WHERE instance_id = $1`,
    [instanceId],
  );
  const map = new Map();
  for (const row of r.rows) map.set(row.wa_chatid, row.id);
  return map;
}

// Pega timestamp da última mensagem salva pra essa instância (incremental sync)
async function getLastMessageTs(client, instanceId) {
  const r = await client.query(
    `SELECT EXTRACT(EPOCH FROM MAX(message_timestamp))::bigint AS last_ts
       FROM messages WHERE instance_id = $1`,
    [instanceId],
  );
  const sec = r.rows[0]?.last_ts;
  if (!sec) return null;
  // Subtrai 6h de buffer para cobrir mensagens reordenadas
  return (sec - 6 * 3600) * 1000;
}

// ─── orquestração ────────────────────────────────────────────────────
export async function runUazapiSync({ triggeredBy = 'manual' } = {}) {
  if (!UAZ_BASE || !UAZ_ADMIN) {
    throw new Error('UAZAPI_BASE_URL / UAZAPI_ADMIN_TOKEN não configurados');
  }
  const startedAt = new Date();
  const detalhes = [];
  let instCount = 0;
  let msgCount = 0;
  let chatCount = 0;
  let errorMsg = null;

  const dbPool = getPool();
  const client = await dbPool.connect();
  try {
    // 1) instances
    console.log('[uazapi-sync] buscando instâncias...');
    const insts = await fetchUazInstances();
    instCount = await upsertInstances(client, insts);
    console.log(`[uazapi-sync] ${instCount} instâncias upserted`);

    // 2) por instância: chats + messages (iterando POR CHAT pra capturar tudo)
    for (const inst of insts) {
      const instUuid = toDeterministicUUID(inst.id);
      const instLog = {
        instance: inst.name || inst.id,
        chats: 0,
        messages: 0,
        chats_with_msgs: 0,
        error: null,
      };
      try {
        if (!inst.token) {
          instLog.error = 'sem token';
          detalhes.push(instLog);
          continue;
        }

        // 2a) chats
        const chats = await fetchUazChats(inst.token);
        const chUp = await upsertChats(client, instUuid, chats);
        instLog.chats = chUp;
        chatCount += chUp;
        console.log(
          `[uazapi-sync] ${inst.name}: ${chats.length} chats (${chUp} upserted)`,
        );

        // mapa chatid → chats.id (pra preencher messages.chat_id FK)
        const chatIdMap = await buildChatIdMap(client, instUuid);

        // 2b) messages — pagina /message/find pela INSTÂNCIA inteira
        // (mais rápido que iterar por chat). Incremental via $gte timestamp.
        const lastTsMs = await getLastMessageTs(client, instUuid);
        let pageMsgsTotal = 0;
        let pages = 0;
        let mediaDownTotal = 0;
        let mediaErrTotal = 0;
        const PAGE_SIZE = 1000;
        let offset = 0;
        for (let page = 0; page < 5000; page++) {
          const { messages, hasMore } = await fetchUazMessagesPage(
            inst.token,
            { since: lastTsMs, offset, limit: PAGE_SIZE },
          );
          if (messages.length === 0) break;
          const inserted = await upsertMessages(
            client,
            instUuid,
            messages,
            chatIdMap,
          );
          pageMsgsTotal += inserted;
          pages++;

          // baixa mídia (não-grupos) em paralelo após upsert
          const mr = await processMediaForPage(client, instUuid, messages);
          mediaDownTotal += mr.downloaded;
          mediaErrTotal += mr.errors;

          if (!hasMore) break;
          offset += messages.length;
          if (page % 5 === 4) {
            console.log(
              `[uazapi-sync] ${inst.name}: ${pageMsgsTotal} msgs, ${mediaDownTotal} mídias (pg ${pages})...`,
            );
          }
          await sleep(100);
        }

        instLog.messages = pageMsgsTotal;
        instLog.media_downloaded = mediaDownTotal;
        instLog.media_errors = mediaErrTotal;
        msgCount += pageMsgsTotal;
        console.log(
          `[uazapi-sync] ${inst.name}: ${chUp} chats, ${pageMsgsTotal} msgs, ${mediaDownTotal} mídias baixadas (${mediaErrTotal} erros), ${pages} pgs`,
        );
      } catch (err) {
        instLog.error = err.message;
        console.warn(`[uazapi-sync] ${inst.name} erro:`, err.message);
      }
      detalhes.push(instLog);
    }
  } catch (err) {
    errorMsg = err.message;
    console.error('[uazapi-sync] FATAL:', err.message);
    throw err;
  } finally {
    // log de execução
    try {
      await client.query(
        `INSERT INTO uazapi_sync_log
          (started_at, finished_at, status, triggered_by,
           instances_processed, messages_inserted, chats_upserted,
           errors, details)
         VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8)`,
        [
          startedAt.toISOString(),
          errorMsg ? 'failed' : 'success',
          triggeredBy,
          instCount,
          msgCount,
          chatCount,
          errorMsg,
          JSON.stringify(detalhes),
        ],
      ).catch((e) => {
        // se a tabela de log não existir, ignora silenciosamente
        if (!String(e.message).includes('relation') && !String(e.message).includes('does not exist')) {
          console.warn('[uazapi-sync log]', e.message);
        }
      });
    } catch {}
    client.release();
  }
  return { instances: instCount, chats: chatCount, messages: msgCount, detalhes };
}

// Busca o último log de execução
export async function getLastSyncLog() {
  const dbPool = getPool();
  try {
    const r = await dbPool.query(
      `SELECT * FROM uazapi_sync_log ORDER BY started_at DESC LIMIT 5`,
    );
    return r.rows;
  } catch (e) {
    if (String(e.message).includes('does not exist')) return [];
    throw e;
  }
}

// Cron diário (03:00 America/Sao_Paulo) — usa node-cron via setInterval simples
// pra não exigir dependência nova. Calcula próxima 03:00 e dispara.
let CRON_TIMER = null;
function msUntilNext(hour = 3, minute = 0, tz = 'America/Sao_Paulo') {
  const now = new Date();
  const local = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  const target = new Date(local);
  target.setHours(hour, minute, 0, 0);
  if (target <= local) target.setDate(target.getDate() + 1);
  // Diferença entre target (no fuso BRT) e local (mesmo fuso) é a mesma de
  // now → momento alvo absoluto (já q ambos são representados no mesmo fuso).
  return target.getTime() - local.getTime();
}

export function iniciarCronUazapiSync() {
  if (CRON_TIMER) {
    clearTimeout(CRON_TIMER);
    CRON_TIMER = null;
  }
  const schedule = () => {
    const wait = msUntilNext(3, 0);
    const next = new Date(Date.now() + wait);
    console.log(
      `⏰ [uazapi-sync] Próxima execução: ${next.toISOString()} (em ${Math.round(wait / 60000)} min)`,
    );
    CRON_TIMER = setTimeout(async () => {
      try {
        console.log('▶️  [uazapi-sync] Iniciando cron diário...');
        const r = await runUazapiSync({ triggeredBy: 'cron' });
        console.log('✅ [uazapi-sync] Cron concluído:', r);
      } catch (e) {
        console.error('❌ [uazapi-sync] Cron falhou:', e.message);
      } finally {
        schedule(); // agenda próximo
      }
    }, wait);
  };
  schedule();
  console.log('⏰ [uazapi-sync] Cron agendado: todo dia às 03:00 (America/Sao_Paulo)');
}

export async function getDbStats() {
  const dbPool = getPool();
  const result = {};
  for (const t of ['instances', 'chats', 'messages', 'contacts']) {
    try {
      const r = await dbPool.query(`SELECT COUNT(*)::bigint AS n FROM ${t}`);
      result[t] = Number(r.rows[0]?.n || 0);
    } catch {
      result[t] = null;
    }
  }
  // Última mensagem
  try {
    const r = await dbPool.query(
      `SELECT MAX(message_timestamp) AS last_ts FROM messages`,
    );
    result.lastMessageAt = r.rows[0]?.last_ts || null;
  } catch {}
  return result;
}
