// Puxa TODAS as mensagens entre David e Jucelino Reis no evolutionadm
import pg from 'pg';

const c = new pg.Client({
  host: 'database1.crosbytech.com.br',
  port: 5432,
  user: 'evolution_read',
  password: 'HDDC6v9FSBXzZER3',
  database: 'evolutionadm',
  ssl: false,
});
await c.connect();

const JID_LID = '77812241330368@lid';

// 1) Stats gerais da conversa David ↔ Jucelino Reis
console.log('═══ Conversa DAVID ↔ Jucelino Reis (instância david) ═══');
const stats = await c.query(`
  SELECT COUNT(*)::int as total,
         COUNT(*) FILTER (WHERE (key->>'fromMe')::bool = true)::int as enviadas,
         COUNT(*) FILTER (WHERE (key->>'fromMe')::bool = false)::int as recebidas,
         MIN(msg_ts_tz) as primeira, MAX(msg_ts_tz) as ultima
    FROM "Message"
   WHERE "instanceId" = '6c23d656-18f0-4f25-ae92-2ec5ac57741e'
     AND key->>'remoteJid' = $1
`, [JID_LID]);
console.table(stats.rows);

// 2) Por dia
console.log('\n═══ Mensagens por dia ═══');
const porDia = await c.query(`
  SELECT msg_ts_tz::date as dia, COUNT(*)::int as total,
         COUNT(*) FILTER (WHERE (key->>'fromMe')::bool = true)::int as david,
         COUNT(*) FILTER (WHERE (key->>'fromMe')::bool = false)::int as cliente
    FROM "Message"
   WHERE "instanceId" = '6c23d656-18f0-4f25-ae92-2ec5ac57741e'
     AND key->>'remoteJid' = $1
   GROUP BY dia ORDER BY dia
`, [JID_LID]);
for (const r of porDia.rows) {
  const flag =
    r.dia.toISOString().slice(0, 10) === '2026-03-20'
      ? ' 🚨 DIA DAS 4 NFs CANCELADAS'
      : '';
  console.log(`  ${r.dia.toISOString().slice(0, 10)}: ${String(r.total).padStart(4)} (David=${r.david}, Cliente=${r.cliente})${flag}`);
}

// 3) CONVERSA COMPLETA do período 18/03 a 25/03 (em torno das NFs canceladas)
console.log('\n═══ CONVERSA 18/03 a 25/03/2026 (período crítico das NFs) ═══');
const conv = await c.query(`
  SELECT msg_ts_tz, (key->>'fromMe')::bool as fromMe, "messageType",
         text_content, "pushName"
    FROM "Message"
   WHERE "instanceId" = '6c23d656-18f0-4f25-ae92-2ec5ac57741e'
     AND key->>'remoteJid' = $1
     AND msg_ts_tz BETWEEN '2026-03-18' AND '2026-03-26'
   ORDER BY msg_ts_tz ASC
`, [JID_LID]);
console.log(`Total: ${conv.rows.length} mensagens\n`);
for (const m of conv.rows) {
  const dt = m.msg_ts_tz.toISOString().slice(0, 19);
  const dir = m.fromme ? '→ DAVID  ' : '← CLIENTE';
  const text = (m.text_content || `[${m.messagetype || 'mídia'}]`)
    .replace(/\s+/g, ' ')
    .slice(0, 400);
  console.log(`  ${dt}  ${dir}:  ${text}`);
}

// 4) Procura palavras-chave de cancelamento
console.log('\n═══ Mensagens com palavras-chave (cancel/devolu/assin/nota fiscal/NF/estorn) ═══');
const keys = await c.query(`
  SELECT msg_ts_tz, (key->>'fromMe')::bool as fromMe, text_content
    FROM "Message"
   WHERE "instanceId" = '6c23d656-18f0-4f25-ae92-2ec5ac57741e'
     AND key->>'remoteJid' = $1
     AND text_content ~* 'cancel|devolv|assin|nota fiscal|\\sNF\\s|estorn|errado|pedido|comprar|compra'
   ORDER BY msg_ts_tz ASC
`, [JID_LID]);
console.log(`Total: ${keys.rows.length} mensagens com palavras-chave\n`);
for (const m of keys.rows) {
  const dt = m.msg_ts_tz.toISOString().slice(0, 19);
  const dir = m.fromme ? '→ DAVID' : '← CLIENTE';
  console.log(`  ${dt}  ${dir}:  ${(m.text_content || '').slice(0, 350)}`);
}

await c.end();
