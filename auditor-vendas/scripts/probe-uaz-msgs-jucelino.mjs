// Puxa TODAS as mensagens entre David e "Jucelino Reis" (559484356203)
// foco no período das 4 NFs canceladas (20/03/2026)
import 'dotenv/config';
import axios from 'axios';
import pg from 'pg';

const UAZ_BASE = process.env.UAZAPI_BASE_URL;

const c = new pg.Client({
  host: process.env.UAZAPI_DB_HOST,
  port: 5432,
  user: process.env.UAZAPI_DB_USER,
  password: process.env.UAZAPI_DB_PASSWORD,
  database: process.env.UAZAPI_DB_NAME,
  ssl: false,
});
await c.connect();
const r = await c.query(
  `SELECT name, token FROM instances WHERE LOWER(name) = 'david'`,
);
await c.end();
const inst = r.rows[0];
if (!inst) {
  console.log('Instância David não encontrada');
  process.exit(1);
}

const CHATID = '559484356203@s.whatsapp.net';
console.log(`Instância: ${inst.name}`);
console.log(`Chat: ${CHATID} (Jucelino Reis)\n`);

async function fetchMsgs(since, until, limit = 500) {
  try {
    const mr = await axios.post(
      `${UAZ_BASE}/message/find`,
      {
        operator: 'AND',
        sort: 'messageTimestamp',
        chatid: CHATID,
        ...(since && { messageTimestamp: { $gte: since, ...(until && { $lte: until }) } }),
        limit,
      },
      {
        headers: { token: inst.token, 'Content-Type': 'application/json' },
        timeout: 90_000,
      },
    );
    return Array.isArray(mr.data?.messages) ? mr.data.messages : [];
  } catch (e) {
    console.warn(`erro: ${e.response?.data?.error || e.message}`);
    return [];
  }
}

// Período amplo: 01/03 a 30/04
console.log('═══ MENSAGENS ENTRE 01/03/2026 e 30/04/2026 ═══\n');
const since = new Date('2026-03-01T00:00:00').getTime();
const until = new Date('2026-04-30T23:59:59').getTime();
const msgs = await fetchMsgs(since, until, 1000);
console.log(`Total mensagens nesse período: ${msgs.length}\n`);

if (msgs.length === 0) {
  console.log('⚠️ ZERO mensagens entre 01/03 e 30/04');
  // Tenta sem filtro de data
  console.log('\nTentando sem filtro de data (todas as mensagens do chat)...');
  const all = await fetchMsgs(null, null, 1000);
  console.log(`Total geral: ${all.length}`);
  if (all.length > 0) {
    console.log('\n── 10 mais recentes ──');
    for (const m of all
      .sort((a, b) => Number(b.messageTimestamp) - Number(a.messageTimestamp))
      .slice(0, 10)) {
      const ts = Number(m.messageTimestamp);
      const dt = new Date(ts < 1e12 ? ts * 1000 : ts);
      const dir = m.fromMe ? '→ DAVID' : '← JUCELINO';
      const text = (m.text || m.content?.text || `[${m.messageType}]`)
        .replace(/\s+/g, ' ')
        .slice(0, 250);
      console.log(`  ${dt.toISOString().slice(0, 19)} ${dir}: ${text}`);
    }
  }
} else {
  // Sort por data
  msgs.sort((a, b) => Number(a.messageTimestamp) - Number(b.messageTimestamp));

  // Imprime todas, marca as 19-23/03
  for (const m of msgs) {
    const ts = Number(m.messageTimestamp);
    const dt = new Date(ts < 1e12 ? ts * 1000 : ts);
    const dia = dt.toISOString().slice(0, 10);
    const dir = m.fromMe ? '→ DAVID' : '← JUCELINO';
    const text = (m.text || m.content?.text || `[${m.messageType}]`)
      .replace(/\s+/g, ' ')
      .slice(0, 300);
    const flag =
      dia >= '2026-03-19' && dia <= '2026-03-23' ? ' 🚨' : '';
    console.log(
      `  ${dt.toISOString().slice(0, 19)} ${dir}: ${text}${flag}`,
    );
  }

  // Procura palavras-chave de cancelamento
  console.log('\n═══ Mensagens com palavras-chave (cancelar, devolução, assinar, nota) ═══');
  const KEYWORDS = /cancel|devolv|assin|nota fiscal|nf |estorn|errado/i;
  const keyMsgs = msgs.filter((m) => {
    const t = m.text || m.content?.text || '';
    return KEYWORDS.test(t);
  });
  if (keyMsgs.length === 0) {
    console.log('  ❌ Nenhuma mensagem fala de cancelamento, devolução, NF ou assinatura');
  } else {
    for (const m of keyMsgs) {
      const ts = Number(m.messageTimestamp);
      const dt = new Date(ts < 1e12 ? ts * 1000 : ts);
      const dir = m.fromMe ? '→ DAVID' : '← JUCELINO';
      console.log(
        `  ${dt.toISOString().slice(0, 19)} ${dir}: ${(m.text || '').slice(0, 300)}`,
      );
    }
  }
}
