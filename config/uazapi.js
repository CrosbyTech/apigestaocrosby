// UAzapi helper — wrapper das chamadas REST necessárias para o CRM.
//
// Estratégia:
//   - Token admin (UAZAPI_ADMIN_TOKEN) lista as instâncias e seus tokens.
//   - Cada instância tem token próprio para ler mensagens.
//   - Cacheamos o map { name → token } por 10 min (evita chamar /instance/all
//     toda hora).
//
// As funções públicas são as que o restante do backend usa:
//   - listUazapiInstances() → array unificado
//   - uazapiGetMessages(instName, phone, limit) → mensagens formatadas
//   - uazapiSearchMessages(instName, expr, direcao, limit) → resultados busca

import axios from 'axios';

const BASE_URL = process.env.UAZAPI_BASE_URL || '';
const ADMIN_TOKEN = process.env.UAZAPI_ADMIN_TOKEN || '';

let CACHE = { data: null, ts: 0 };
const TTL = 10 * 60 * 1000; // 10 min

function cleanPhone(tel) {
  return String(tel || '').replace(/\D/g, '');
}

function ensurePrefix55(phone) {
  const c = cleanPhone(phone);
  return c.startsWith('55') ? c : '55' + c;
}

// Gera variantes do telefone (com e sem 9 móvel) para tolerar diferenças
// no que está cadastrado no WhatsApp/UAzapi.
function phoneVariants(phone) {
  const base = ensurePrefix55(phone);
  const set = new Set([base]);
  // base = 55 + DDD(2) + restante
  if (base.length === 13) {
    // tem 9: 55 + DD + 9 + 8 dígitos -> tira o 9
    const sem9 = base.slice(0, 4) + base.slice(5);
    set.add(sem9);
  } else if (base.length === 12) {
    // sem 9: 55 + DD + 8 dígitos -> insere 9
    const com9 = base.slice(0, 4) + '9' + base.slice(4);
    set.add(com9);
  }
  return [...set];
}

async function loadInstancesRaw() {
  if (!BASE_URL || !ADMIN_TOKEN) {
    return [];
  }
  if (CACHE.data && Date.now() - CACHE.ts < TTL) return CACHE.data;
  try {
    const { data } = await axios.get(`${BASE_URL}/instance/all`, {
      headers: { AdminToken: ADMIN_TOKEN },
      timeout: 15000,
    });
    const list = Array.isArray(data) ? data : data?.instances || [];
    const norm = list.map((i) => ({
      id: i.id,
      name: i.name,
      token: i.token,
      status: i.status,
      owner: i.owner,
      profileName: i.profileName || '',
    }));
    CACHE = { data: norm, ts: Date.now() };
    return norm;
  } catch (err) {
    console.warn('[uazapi] Erro ao listar instâncias:', err.message);
    return CACHE.data || [];
  }
}

export async function listUazapiInstances() {
  const arr = await loadInstancesRaw();
  return arr.map((i) => ({
    name: i.name,
    label: i.profileName || i.name,
    status: i.status,
    owner: i.owner,
    provider: 'uazapi',
  }));
}

async function findInstanceToken(instName) {
  const arr = await loadInstancesRaw();
  const found = arr.find(
    (i) => String(i.name).toLowerCase() === String(instName).toLowerCase(),
  );
  return found?.token || null;
}

// Retorna mensagens de um chat (telefone) numa instância UAzapi.
// Tenta variantes do número (com e sem 9) e usa a que retornar mensagens.
//   formato compatível com a rota /msgs do Evolution: { texto, quem, tempo }
export async function uazapiGetMessages(instName, phone, limit = 500) {
  const token = await findInstanceToken(instName);
  if (!token) {
    throw new Error(`Instância UAzapi "${instName}" não encontrada`);
  }

  let raw = [];
  for (const v of phoneVariants(phone)) {
    const chatid = `${v}@s.whatsapp.net`;
    const { data } = await axios.post(
      `${BASE_URL}/message/find`,
      { chatid, limit },
      {
        headers: { token, 'Content-Type': 'application/json' },
        timeout: 30000,
      },
    );
    const arr = Array.isArray(data?.messages) ? data.messages : [];
    if (arr.length > 0) {
      raw = arr;
      break;
    }
  }

  // UAzapi retorna do mais recente para o mais antigo. O front espera ASC.
  return raw
    .map((m) => ({
      texto:
        m.text || m.content?.text || m.content?.extendedTextMessage?.text || '',
      quem: m.fromMe ? 'EU' : 'lead',
      tempo: Number(m.messageTimestamp) || 0,
    }))
    .filter((m) => m.texto)
    .sort((a, b) => a.tempo - b.tempo);
}

// Busca textual em mensagens de uma instância UAzapi
//   direcao: 'todas' | 'recebidas' | 'enviadas'
export async function uazapiSearchMessages(
  instName,
  expr,
  direcao = 'todas',
  limit = 50,
) {
  const token = await findInstanceToken(instName);
  if (!token) {
    throw new Error(`Instância UAzapi "${instName}" não encontrada`);
  }
  const body = { search: expr, limit };
  if (direcao === 'recebidas') body.fromMe = false;
  else if (direcao === 'enviadas') body.fromMe = true;

  const { data } = await axios.post(`${BASE_URL}/message/find`, body, {
    headers: { token, 'Content-Type': 'application/json' },
    timeout: 30000,
  });

  const raw = Array.isArray(data?.messages) ? data.messages : [];
  // Agrupa por chatid (lead) e devolve no formato esperado pelo /buscar-msgs:
  //   { instance, fone, nome, msgCount, messages: [{texto, quem, tempo}] }
  const byChat = {};
  for (const m of raw) {
    const chatid = m.chatid || '';
    if (!chatid.endsWith('@s.whatsapp.net')) continue; // ignora grupos
    const fone = chatid.replace('@s.whatsapp.net', '');
    if (!byChat[fone]) {
      byChat[fone] = {
        instance: instName,
        fone,
        nome: m.senderName || m.lead_name || '',
        msgCount: 0,
        messages: [],
      };
    }
    const texto =
      m.text ||
      m.content?.text ||
      m.content?.extendedTextMessage?.text ||
      '';
    if (!texto) continue;
    byChat[fone].messages.push({
      texto,
      quem: m.fromMe ? 'EU' : 'lead',
      tempo: Number(m.messageTimestamp) || 0,
    });
    byChat[fone].msgCount += 1;
  }
  return Object.values(byChat);
}

export function isUazapiConfigured() {
  return Boolean(BASE_URL && ADMIN_TOKEN);
}

// Verifica se a instância tem chat com o telefone informado.
// Usa message/find (mais confiável que chat/find — chats podem não existir
// mesmo quando há mensagens registradas). Tenta variantes com/sem 9.
export async function uazapiPhoneHasChat(instName, phone) {
  const token = await findInstanceToken(instName);
  if (!token) return { exists: false, count: null };
  for (const v of phoneVariants(phone)) {
    const chatid = `${v}@s.whatsapp.net`;
    try {
      const { data } = await axios.post(
        `${BASE_URL}/message/find`,
        { chatid, limit: 1 },
        {
          headers: { token, 'Content-Type': 'application/json' },
          timeout: 8000,
        },
      );
      const arr = Array.isArray(data?.messages) ? data.messages : [];
      if (arr.length > 0) return { exists: true, count: null };
    } catch {
      // tenta próxima variante
    }
  }
  return { exists: false, count: null };
}

export async function listUazapiInstancesRaw() {
  return loadInstancesRaw();
}

// Retorna o timestamp da mensagem mais recente entre o telefone e a instância,
// considerando variantes com/sem 9. Retorna null se não houver mensagem.
async function uazapiLastContactInInstance(instName, phone) {
  const token = await findInstanceToken(instName);
  if (!token) return null;
  for (const v of phoneVariants(phone)) {
    const chatid = `${v}@s.whatsapp.net`;
    try {
      const { data } = await axios.post(
        `${BASE_URL}/message/find`,
        { chatid, limit: 1 },
        {
          headers: { token, 'Content-Type': 'application/json' },
          timeout: 8000,
        },
      );
      const arr = Array.isArray(data?.messages) ? data.messages : [];
      if (arr.length > 0) {
        const ts = Number(arr[0].messageTimestamp) || 0;
        if (ts > 0) return { ts, instance: instName };
      }
    } catch {
      // tenta próxima variante
    }
  }
  return null;
}

// Distribuição de mensagens por hora (BRT) numa instância UAzapi.
// Como UAzapi não tem agregação, paginamos message/find e bucketizamos.
// Limita a `maxPages * limit` mensagens recentes para não travar.
export async function uazapiTurnoForInstance(
  instName,
  { onlyReceived = false, maxPages = 5, limit = 1000 } = {},
) {
  const token = await findInstanceToken(instName);
  if (!token) return null;
  const hours = Array(24).fill(0);
  let total = 0;
  let offset = 0;
  for (let page = 0; page < maxPages; page++) {
    const body = { limit, offset };
    if (onlyReceived) body.fromMe = false;
    try {
      const { data } = await axios.post(`${BASE_URL}/message/find`, body, {
        headers: { token, 'Content-Type': 'application/json' },
        timeout: 30000,
      });
      const arr = Array.isArray(data?.messages) ? data.messages : [];
      if (arr.length === 0) break;
      for (const m of arr) {
        const ts = Number(m.messageTimestamp) || 0;
        if (!ts) continue;
        // ts em ms; converte para America/Sao_Paulo (UTC-3, sem DST desde 2019).
        const utcHour = new Date(ts).getUTCHours();
        const localHour = (utcHour - 3 + 24) % 24;
        hours[localHour]++;
        total++;
      }
      if (!data.hasMore) break;
      offset = data.nextOffset != null ? data.nextOffset : offset + arr.length;
    } catch (err) {
      console.warn(
        `[uazapi-turno] ${instName} pg ${page}: ${err.message}`,
      );
      break;
    }
  }
  let max = 0;
  let peak = null;
  for (let h = 0; h < 24; h++) {
    if (hours[h] > max) {
      max = hours[h];
      peak = h;
    }
  }
  return { hours, peak, total };
}

// Acha a instância UAzapi com mensagem mais recente para um telefone.
// Verifica todas as instâncias conectadas em paralelo.
export async function uazapiLastContactForPhone(phone) {
  const list = await loadInstancesRaw();
  const connected = list.filter((i) => i.status === 'connected');
  const results = await Promise.allSettled(
    connected.map((i) => uazapiLastContactInInstance(i.name, phone)),
  );
  let best = null;
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      if (!best || r.value.ts > best.ts) best = r.value;
    }
  }
  return best;
}
