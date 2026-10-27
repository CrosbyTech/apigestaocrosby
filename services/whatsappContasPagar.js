// ─────────────────────────────────────────────────────────────────────────
// WhatsApp CONTAS A PAGAR — cliente uazapi preso a UMA instância.
//
// O HeadCoach só enxerga/controla a instância "CONTAS A PAGAR" do servidor
// techcrosby.uazapi.com. Todas as chamadas usam o token da instância
// (header `token`); o token admin do servidor nunca é usado aqui, exceto
// como fallback para resolver o token da instância pelo nome.
//
// Env:
//   WHATSAPP_CP_BASE_URL     = https://techcrosby.uazapi.com
//   WHATSAPP_CP_TOKEN        = token da instância (preferido)
//   WHATSAPP_CP_INSTANCE     = nome da instância (default "CONTAS A PAGAR")
//   WHATSAPP_CP_ADMIN_TOKEN  = (opcional) admintoken p/ resolver o token pelo nome
//
// Doc: https://docs.uazapi.com (OpenAPI 2.6.x)
// ─────────────────────────────────────────────────────────────────────────
import axios from 'axios';

const BASE_URL = (process.env.WHATSAPP_CP_BASE_URL || 'https://techcrosby.uazapi.com').replace(/\/+$/, '');
const INSTANCE_NAME = process.env.WHATSAPP_CP_INSTANCE || 'CONTAS A PAGAR';
const TOKEN_ENV = process.env.WHATSAPP_CP_TOKEN || '';
// sem o token da instância, resolve pelo admintoken do servidor (o mesmo do CRM, UAZAPI_ADMIN_TOKEN)
const ADMIN_TOKEN = process.env.WHATSAPP_CP_ADMIN_TOKEN || process.env.UAZAPI_ADMIN_TOKEN || '';
const TRACK_SOURCE = 'headcoach';

let tokenCache = { token: TOKEN_ENV || null, ate: 0 };

export function isConfigurado() {
  return Boolean(BASE_URL && (TOKEN_ENV || ADMIN_TOKEN));
}

export function infoConfig() {
  return {
    baseUrl: BASE_URL,
    instancia: INSTANCE_NAME,
    modo: TOKEN_ENV ? 'token da instância' : ADMIN_TOKEN ? 'resolvido pelo admintoken' : 'não configurado',
    configurado: isConfigurado(),
  };
}

// ─── telefone ────────────────────────────────────────────────────────────
export function normalizarNumero(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  // ids de grupo / jid já prontos passam direto
  if (s.includes('@')) return s;
  const d = s.replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('55')) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

// ─── token da instância ──────────────────────────────────────────────────
async function resolverToken({ forcar = false } = {}) {
  if (TOKEN_ENV) return TOKEN_ENV;
  if (!ADMIN_TOKEN) throw new Error('WhatsApp Contas a Pagar não configurado (WHATSAPP_CP_TOKEN ou WHATSAPP_CP_ADMIN_TOKEN)');
  if (!forcar && tokenCache.token && tokenCache.ate > Date.now()) return tokenCache.token;
  const { data } = await axios.get(`${BASE_URL}/instance/all`, {
    headers: { admintoken: ADMIN_TOKEN },
    timeout: 15_000,
  });
  const lista = Array.isArray(data) ? data : data?.instances || [];
  const alvo = INSTANCE_NAME.toLowerCase();
  const inst = lista.find((i) => String(i.name || '').toLowerCase() === alvo);
  if (!inst?.token) throw new Error(`Instância "${INSTANCE_NAME}" não encontrada em ${BASE_URL}`);
  tokenCache = { token: inst.token, ate: Date.now() + 10 * 60 * 1000 };
  return inst.token;
}

function erroUazapi(err, contexto) {
  const status = err.response?.status;
  const body = err.response?.data;
  const detalhe =
    (body && (body.message || body.error || body.response || (typeof body === 'string' ? body : null))) ||
    err.message;
  const e = new Error(`${contexto}: ${detalhe}`);
  e.status = status && status >= 400 && status < 500 ? status : 502;
  e.uazapi = body;
  return e;
}

async function chamar(method, path, { body, params, timeout = 30_000, contexto } = {}) {
  if (!BASE_URL) throw new Error('WHATSAPP_CP_BASE_URL não configurado');
  const token = await resolverToken();
  try {
    const { data } = await axios({
      method,
      url: `${BASE_URL}${path}`,
      data: body,
      params,
      headers: { token, 'Content-Type': 'application/json' },
      timeout,
    });
    return data;
  } catch (err) {
    // token resolvido pelo admin pode ter rotacionado: tenta 1x de novo
    if (!TOKEN_ENV && err.response?.status === 401 && tokenCache.ate) {
      tokenCache = { token: null, ate: 0 };
      const novo = await resolverToken({ forcar: true });
      try {
        const { data } = await axios({ method, url: `${BASE_URL}${path}`, data: body, params, headers: { token: novo, 'Content-Type': 'application/json' }, timeout });
        return data;
      } catch (err2) {
        throw erroUazapi(err2, contexto || `${method.toUpperCase()} ${path}`);
      }
    }
    throw erroUazapi(err, contexto || `${method.toUpperCase()} ${path}`);
  }
}

// Esconde campos sensíveis da instância antes de devolver ao front
function sanitizarInstancia(i) {
  if (!i || typeof i !== 'object') return i;
  const { token, openai_apikey, ...resto } = i;
  return resto;
}

// ─── instância ───────────────────────────────────────────────────────────
export async function status() {
  const data = await chamar('get', '/instance/status', { contexto: 'status da instância' });
  const inst = data?.instance || {};
  const st = data?.status || {};
  return {
    instancia: sanitizarInstancia(inst),
    conectado: Boolean(st.connected),
    logado: Boolean(st.loggedIn),
    jid: st.jid || null,
    status: inst.status || (st.connected ? 'connected' : 'disconnected'),
    qrcode: inst.qrcode || null,
    paircode: inst.paircode || null,
    numero: inst.owner || null,
    nome: inst.profileName || inst.name || null,
    foto: inst.profilePicUrl || null,
    ultimaDesconexao: inst.lastDisconnect || null,
    motivoDesconexao: inst.lastDisconnectReason || null,
  };
}

// Conecta: sem phone → QR code; com phone → código de pareamento
export async function conectar({ phone } = {}) {
  const body = {};
  const n = phone ? normalizarNumero(phone) : null;
  if (n) body.phone = n;
  const data = await chamar('post', '/instance/connect', { body, timeout: 60_000, contexto: 'conectar instância' });
  const inst = data?.instance || {};
  return {
    conectado: Boolean(data?.connected),
    logado: Boolean(data?.loggedIn),
    qrcode: inst.qrcode || null,
    paircode: inst.paircode || null,
    status: inst.status || null,
    instancia: sanitizarInstancia(inst),
  };
}

export async function desconectar() {
  const data = await chamar('post', '/instance/disconnect', { body: {}, contexto: 'desconectar instância' });
  return { instancia: sanitizarInstancia(data?.instance), resposta: data?.response || null, info: data?.info || null };
}

// ─── envio ───────────────────────────────────────────────────────────────
// mentions: números (só dígitos) a marcar numa mensagem de grupo — a uazapi aceita
// "5511999999999,5511888888888"; o texto deve trazer "@<número>" para a marcação aparecer.
const mentionsDe = (v) => {
  const lista = (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => String(x).replace(/\D/g, '')).filter(Boolean);
  return lista.length ? lista.join(',') : null;
};

export async function enviarTexto({ number, text, replyid, linkPreview, delay, trackId, readchat, mentions } = {}) {
  const n = normalizarNumero(number);
  if (!n) throw Object.assign(new Error('Número inválido'), { status: 400 });
  const t = String(text || '').trim();
  if (!t) throw Object.assign(new Error('Texto vazio'), { status: 400 });
  const body = { number: n, text: t, track_source: TRACK_SOURCE };
  const men = mentionsDe(mentions);
  if (men) body.mentions = men;
  if (trackId) body.track_id = String(trackId).slice(0, 120);
  if (replyid) body.replyid = replyid;
  if (typeof linkPreview === 'boolean') body.linkPreview = linkPreview;
  if (Number.isFinite(delay) && delay > 0) body.delay = Math.min(delay, 15_000);
  if (readchat) body.readchat = true;
  const data = await chamar('post', '/send/text', { body, timeout: 60_000, contexto: 'enviar texto' });
  return { numero: n, resposta: data };
}

const TIPOS_MIDIA = new Set(['image', 'video', 'videoplay', 'document', 'audio', 'myaudio', 'ptt', 'ptv', 'sticker']);

// file: URL http(s), data URL ou base64 puro
export async function enviarMidia({ number, type = 'document', file, text, docName, mimetype, replyid, delay, trackId, mentions } = {}) {
  const n = normalizarNumero(number);
  if (!n) throw Object.assign(new Error('Número inválido'), { status: 400 });
  if (!TIPOS_MIDIA.has(type)) throw Object.assign(new Error(`Tipo de mídia inválido: ${type}`), { status: 400 });
  const f = String(file || '').trim();
  if (!f) throw Object.assign(new Error('Arquivo vazio (file: URL ou base64)'), { status: 400 });
  const body = { number: n, type, file: f, track_source: TRACK_SOURCE };
  const men = mentionsDe(mentions);
  if (men) body.mentions = men;
  if (text) body.text = String(text);
  if (docName) body.docName = String(docName).slice(0, 200);
  if (mimetype) body.mimetype = mimetype;
  if (replyid) body.replyid = replyid;
  if (trackId) body.track_id = String(trackId).slice(0, 120);
  if (Number.isFinite(delay) && delay > 0) body.delay = Math.min(delay, 15_000);
  const data = await chamar('post', '/send/media', { body, timeout: 120_000, contexto: 'enviar mídia' });
  return { numero: n, resposta: data };
}

/** Apaga para todos uma mensagem enviada pela instância (id "owner:XXXX"). Testado em 27/10/2026. */
export async function apagarMensagem(id) {
  if (!id) throw Object.assign(new Error('Informe o id da mensagem'), { status: 400 });
  const data = await chamar('post', '/message/delete', { body: { id: String(id) }, timeout: 60_000, contexto: 'apagar mensagem' });
  return { id: String(id), resposta: data };
}

// ─── consultas ───────────────────────────────────────────────────────────
export async function verificarNumeros(numbers) {
  const lista = (Array.isArray(numbers) ? numbers : [numbers]).map(normalizarNumero).filter(Boolean);
  if (!lista.length) throw Object.assign(new Error('Informe ao menos um número'), { status: 400 });
  const data = await chamar('post', '/chat/check', { body: { numbers: lista.slice(0, 50) }, contexto: 'verificar números' });
  return (Array.isArray(data) ? data : []).map((r) => ({
    consulta: r.query,
    noWhatsapp: Boolean(r.isInWhatsapp),
    jid: r.jid || null,
    lid: r.lid || null,
    nomeVerificado: r.verifiedName || null,
    erro: r.error || null,
  }));
}

function resumirChat(c) {
  return {
    id: c.id,
    chatid: c.wa_chatid,
    nome: c.wa_contactName || c.lead_name || c.wa_name || c.name || c.phone || c.wa_chatid,
    telefone: c.phone || (String(c.wa_chatid || '').endsWith('@s.whatsapp.net') ? String(c.wa_chatid).split('@')[0] : null),
    grupo: Boolean(c.wa_isGroup),
    arquivado: Boolean(c.wa_archived),
    fixado: Boolean(c.wa_isPinned),
    naoLidas: Number(c.wa_unreadCount) || 0,
    ultimaMensagemEm: c.wa_lastMsgTimestamp ? new Date(Number(c.wa_lastMsgTimestamp)).toISOString() : null,
    ultimaMensagemTipo: c.wa_lastMessageType || null,
    ultimaMensagemTexto: c.wa_lastMessageTextVote || null,
    foto: c.imagePreview || c.image || null,
  };
}

/**
 * Grupos da instância (GET /group/list?force=true) — é o jeito confiável de achar
 * o chatid de um grupo pelo nome (/chat/find não acha grupo recém-criado).
 * @returns [{ id: '...@g.us', nome, participantes }]
 */
export async function listarGrupos({ force = true } = {}) {
  const data = await chamar('get', '/group/list', { params: { force: force ? 'true' : 'false' }, timeout: 60_000, contexto: 'listar grupos' });
  const lista = Array.isArray(data?.groups) ? data.groups : Array.isArray(data) ? data : [];
  return lista.map((g) => ({
    id: g.JID || g.jid || g.id || g.chatid || null,
    nome: g.Name || g.name || g.subject || g.wa_name || '',
    participantes: Array.isArray(g.Participants) ? g.Participants.length : Array.isArray(g.participants) ? g.participants.length : null,
  }));
}

const normNomeGrupo = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
/** Acha um grupo pelo nome (sem acento/caixa), aceitando correspondência parcial. */
export async function acharGrupoPorNome(nome) {
  const alvo = normNomeGrupo(nome);
  const grupos = await listarGrupos();
  return grupos.find((g) => normNomeGrupo(g.nome) === alvo) || grupos.find((g) => normNomeGrupo(g.nome).includes(alvo)) || null;
}

export async function listarChats({ limit = 50, offset = 0, somenteNaoLidas = false, incluirGrupos = true, nome } = {}) {
  const body = { sort: '-wa_lastMsgTimestamp', limit: Math.min(Number(limit) || 50, 200), offset: Number(offset) || 0, compact: true };
  if (somenteNaoLidas) body.wa_unreadCount = '>0';
  if (!incluirGrupos) body.wa_isGroup = false;
  if (nome) body.wa_contactName = String(nome);
  const data = await chamar('post', '/chat/find', { body, contexto: 'listar conversas' });
  const chats = Array.isArray(data?.chats) ? data.chats : [];
  return { chats: chats.map(resumirChat), paginacao: data?.pagination || null, totais: data?.totalChatsStats || null };
}

function resumirMensagem(m) {
  const ts = Number(m.messageTimestamp) || 0;
  return {
    id: m.id || m.messageid,
    chatid: m.chatid,
    deMim: Boolean(m.fromMe),
    tipo: m.messageType || m.type || null,
    texto: m.text || m.content?.text || m.content?.extendedTextMessage?.text || m.caption || '',
    remetente: m.senderName || m.sender || null,
    remetenteId: m.sender || null,
    remetentePn: m.sender_pn || null,
    quoted: m.quoted || null,
    em: ts ? new Date(ts < 1e12 ? ts * 1000 : ts).toISOString() : null,
    status: m.status || null,
    temMidia: Boolean(m.fileURL || m.mediaUrl || ['image', 'video', 'audio', 'document', 'sticker', 'ptt'].some((t) => String(m.messageType || '').toLowerCase().includes(t))),
    arquivo: m.fileURL || m.mediaUrl || null,
    nomeArquivo: m.fileName || m.docName || null,
    trackSource: m.track_source || null,
    trackId: m.track_id || null,
  };
}

export async function buscarMensagens({ chatid, number, limit = 50, offset = 0, trackSource } = {}) {
  let cid = chatid;
  if (!cid && number) {
    const n = normalizarNumero(number);
    cid = n?.includes('@') ? n : `${n}@s.whatsapp.net`;
  }
  const body = { limit: Math.min(Number(limit) || 50, 1000), offset: Number(offset) || 0 };
  if (cid) body.chatid = cid;
  if (trackSource) body.track_source = trackSource;
  const data = await chamar('post', '/message/find', { body, contexto: 'buscar mensagens' });
  const msgs = Array.isArray(data?.messages) ? data.messages : [];
  return { mensagens: msgs.map(resumirMensagem), paginacao: data?.pagination || null };
}

export async function baixarMidia(id, { base64 = false } = {}) {
  if (!id) throw Object.assign(new Error('id da mensagem obrigatório'), { status: 400 });
  const data = await chamar('post', '/message/download', { body: { id, return_base64: Boolean(base64) }, timeout: 120_000, contexto: 'baixar mídia' });
  return { url: data?.fileURL || null, mimetype: data?.mimetype || null, base64: data?.base64Data || null };
}

export async function marcarLidas(ids) {
  const lista = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  if (!lista.length) throw Object.assign(new Error('Informe os ids'), { status: 400 });
  return chamar('post', '/message/markread', { body: { id: lista }, contexto: 'marcar como lidas' });
}

export async function detalhesChat(number) {
  const n = normalizarNumero(number);
  if (!n) throw Object.assign(new Error('Número inválido'), { status: 400 });
  return chamar('post', '/chat/details', { body: { number: n, preview: true }, contexto: 'detalhes do chat' });
}

// ─── webhooks da instância (eventos → HeadCoach) ─────────────────────────
export async function listarWebhooks() {
  const data = await chamar('get', '/webhook', { contexto: 'listar webhooks' });
  return Array.isArray(data) ? data : data ? [data] : [];
}

export async function configurarWebhook({ action = 'add', id, url, enabled = true, events, excludeMessages } = {}) {
  const body = { action, enabled };
  if (id) body.id = id;
  if (url) body.url = url;
  if (Array.isArray(events)) body.events = events;
  if (Array.isArray(excludeMessages)) body.excludeMessages = excludeMessages;
  return chamar('post', '/webhook', { body, contexto: 'configurar webhook' });
}
