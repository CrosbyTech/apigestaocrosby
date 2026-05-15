// Busca DIRETO na API UAzapi (sem passar pelo banco) — instâncias do David
import 'dotenv/config';
import axios from 'axios';
import pg from 'pg';

const UAZ_BASE = process.env.UAZAPI_BASE_URL;
const UAZ_ADMIN = process.env.UAZAPI_ADMIN_TOKEN;

// Pega tokens das instâncias relevantes do banco
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
  `SELECT name, token FROM instances WHERE LOWER(name) IN ('david','mtm','arthur','jucelino')`,
);
await c.end();
const insts = r.rows;
console.log(`Instâncias a investigar: ${insts.map((i) => i.name).join(', ')}\n`);

const PHONE = '94984356203';
const PHONE_INTL = `55${PHONE}`;
const CHATID_VARIANTS = [
  `${PHONE_INTL}@s.whatsapp.net`,
  `${PHONE_INTL}@c.us`,
  `${PHONE}@s.whatsapp.net`,
];

// Paginação completa de chats
async function fetchAllChats(token) {
  const all = [];
  let offset = 0;
  for (let p = 0; p < 200; p++) {
    try {
      const r = await axios.post(
        `${UAZ_BASE}/chat/find`,
        { operator: 'AND', sort: '-wa_lastMsgTimestamp', limit: 500, offset },
        {
          headers: { token, 'Content-Type': 'application/json' },
          timeout: 60_000,
        },
      );
      const arr = Array.isArray(r.data?.chats)
        ? r.data.chats
        : Array.isArray(r.data)
          ? r.data
          : [];
      if (arr.length === 0) break;
      all.push(...arr);
      if (arr.length < 500) break;
      offset += 500;
    } catch (e) {
      return all;
    }
  }
  return all;
}

for (const inst of insts) {
  console.log('═'.repeat(80));
  console.log(`▼ INSTÂNCIA: ${inst.name}`);
  console.log('═'.repeat(80));

  // 1) Lista TODOS os chats e filtra
  const allChats = await fetchAllChats(inst.token);
  console.log(`Total chats nessa instância: ${allChats.length}`);

  const matched = allChats.filter((ch) => {
    const id = ch.wa_chatid || '';
    const phone = ch.phone || '';
    return (
      id.includes(PHONE) ||
      id.includes(PHONE_INTL) ||
      phone.includes(PHONE) ||
      phone.includes(PHONE_INTL)
    );
  });

  if (matched.length === 0) {
    console.log(`  ❌ Nenhum chat com telefone ${PHONE} (${PHONE_INTL})`);
    // Tenta por NOME (caso o tel estivesse diferente)
    const PATTERNS = ['jucelino', 'j silva', 'silva dos reis', 'mtm jucelino', 'still urbano'];
    console.log(`  🔎 Procurando por nome (jucelino / silva / urbano)...`);
    const nameMatched = allChats.filter((ch) => {
      const fields = [
        ch.wa_name,
        ch.wa_contactName,
        ch.wa_contact_name,
        ch.lead_name,
        ch.lead_fullName,
        ch.name,
      ]
        .filter(Boolean)
        .map((s) => String(s).toLowerCase());
      return fields.some((f) => PATTERNS.some((p) => f.includes(p)));
    });
    if (nameMatched.length === 0) {
      console.log(`  ❌ Nenhum chat com nome similar`);
    } else {
      console.log(`  ✓ ${nameMatched.length} chats com nome similar:`);
      for (const ch of nameMatched.slice(0, 10)) {
        console.log(
          `    ${ch.wa_chatid}  | wa_name=${ch.wa_name || ''} | contact=${ch.wa_contactName || ''} | lead=${ch.lead_name || ''}`,
        );
      }
    }
    continue;
  }

  console.log(`  ✓ ${matched.length} chat(s) encontrado(s):`);
  for (const ch of matched) {
    console.log(`\n  📞 wa_chatid: ${ch.wa_chatid}`);
    console.log(`     wa_name:   ${ch.wa_name || ch.name || '?'}`);
    console.log(`     contact:   ${ch.wa_contactName || ch.wa_contact_name || '?'}`);
    console.log(`     lead_name: ${ch.lead_name || '?'}`);
    console.log(
      `     lastMsg:   ${(ch.wa_lastMessage_text_vote || ch.wa_lastMessage?.text || '(sem texto)').slice(0, 100)}`,
    );
    if (ch.wa_lastMsgTimestamp) {
      const ms = Number(ch.wa_lastMsgTimestamp);
      const dt = new Date(ms < 1e12 ? ms * 1000 : ms);
      console.log(`     lastMsgAt: ${dt.toISOString().slice(0, 19)}`);
    }
  }

  // 2) Pega mensagens do(s) chat(s) match no período 15/03 - 30/03
  if (matched.length > 0) {
    console.log(`\n  📨 Buscando mensagens entre 15/03 e 30/03/2026...`);
    const since = new Date('2026-03-15T00:00:00').getTime();
    const until = new Date('2026-03-30T23:59:59').getTime();
    for (const ch of matched) {
      try {
        const mr = await axios.post(
          `${UAZ_BASE}/message/find`,
          {
            operator: 'AND',
            sort: 'messageTimestamp',
            chatid: ch.wa_chatid,
            messageTimestamp: { $gte: since, $lte: until },
            limit: 500,
          },
          {
            headers: { token: inst.token, 'Content-Type': 'application/json' },
            timeout: 90_000,
          },
        );
        const msgs = Array.isArray(mr.data?.messages)
          ? mr.data.messages
          : Array.isArray(mr.data)
            ? mr.data
            : [];
        console.log(
          `\n  💬 ${msgs.length} msgs em ${ch.wa_chatid} (${inst.name}):`,
        );
        for (const m of msgs) {
          const ts = Number(m.messageTimestamp);
          const dt = new Date(ts < 1e12 ? ts * 1000 : ts);
          const dir = m.fromMe ? `→ ${inst.name.toUpperCase()}` : `← CLIENTE`;
          const text = (m.text || m.content?.text || `[${m.messageType || 'tipo?'}]`)
            .replace(/\s+/g, ' ')
            .slice(0, 300);
          console.log(`    ${dt.toISOString().slice(0, 19)} ${dir}: ${text}`);
        }
      } catch (e) {
        console.log(`  ❌ ${e.response?.data?.error || e.message}`);
      }
    }
  }
}

// Codigo morto abaixo (já tratado acima)
if (false) {
  for (const chatid of CHATID_VARIANTS) {
    try {
      const resp = await axios.post(
        `${UAZ_BASE}/chat/find`,
        { operator: 'AND', wa_chatid: chatid, limit: 5 },
        {
          headers: { token: '', 'Content-Type': 'application/json' },
          timeout: 30_000,
        },
      );
      const chats = Array.isArray(resp.data?.chats)
        ? resp.data.chats
        : Array.isArray(resp.data)
          ? resp.data
          : [];
      if (chats.length > 0) {
        console.log(`\n✓ Chat encontrado com ${chatid}:`);
        for (const ch of chats) {
          console.log(`  wa_chatid: ${ch.wa_chatid}`);
          console.log(`  wa_name:   ${ch.wa_name || ch.name || '?'}`);
          console.log(`  wa_contact_name: ${ch.wa_contactName || ch.wa_contact_name || '?'}`);
          console.log(`  lead_name: ${ch.lead_name || '?'}`);
          console.log(`  unread:    ${ch.wa_unreadCount || 0}`);
          console.log(
            `  lastMsg:   ${ch.wa_lastMessage_text_vote || ch.wa_lastMessage?.text || '(sem texto)'}`,
          );
          if (ch.wa_lastMsgTimestamp) {
            const ms = Number(ch.wa_lastMsgTimestamp);
            const dt = new Date(ms < 1e12 ? ms * 1000 : ms);
            console.log(`  lastMsgAt: ${dt.toISOString()}`);
          }
        }

        // 2) Pega mensagens desse chat no período 19/03 - 25/03
        console.log(`\n📨 Mensagens entre 19/03 e 25/03/2026:`);
        const since = new Date('2026-03-19T00:00:00').getTime();
        const until = new Date('2026-03-25T23:59:59').getTime();
        try {
          const mr = await axios.post(
            `${UAZ_BASE}/message/find`,
            {
              operator: 'AND',
              sort: 'messageTimestamp',
              chatid: chats[0].wa_chatid,
              messageTimestamp: { $gte: since, $lte: until },
              limit: 200,
            },
            {
              headers: { token: inst.token, 'Content-Type': 'application/json' },
              timeout: 60_000,
            },
          );
          const msgs = Array.isArray(mr.data?.messages)
            ? mr.data.messages
            : Array.isArray(mr.data)
              ? mr.data
              : [];
          if (msgs.length === 0) {
            console.log('  (nenhuma mensagem nesse período)');
          } else {
            for (const m of msgs) {
              const ts = Number(m.messageTimestamp);
              const dt = new Date(ts < 1e12 ? ts * 1000 : ts);
              const dir = m.fromMe ? '→ DAVID' : '← CLIENTE';
              const text = (m.text || m.content?.text || `[${m.messageType || 'tipo?'}]`).slice(0, 200);
              console.log(`  ${dt.toISOString().slice(0, 19)} ${dir}: ${text}`);
            }
          }
        } catch (e) {
          console.log(`  ❌ erro message/find: ${e.response?.data?.error || e.message}`);
        }
        break; // achou o chat, pula variantes
      }
    } catch (e) {
      // tenta próxima variante
    }
  }
}
