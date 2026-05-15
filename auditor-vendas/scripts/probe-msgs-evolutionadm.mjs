// Tenta TODOS os formatos de JID/telefone pra achar mensagens com Jucelino Reis
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

// IDs do contato encontrados
const CONTACT_IDS = [
  'cmmwf0tld993yq94qgs8oldh6', // rafael
  'cmnnmpi7lz3jvq94qdut21pof', // michel
  'cmnnnkrv21l2zq94qwl827bfn', // jucelino
  'cmmkvnajqtrpuq94qqcpyq396', // david
];

console.log('═══ 1) Total de mensagens por instância (qualquer JID com 559484356203) ═══');
const r = await c.query(`
  SELECT i.name as instance_name, COUNT(*)::int as msgs,
         MIN(m.msg_ts_tz) as first_msg, MAX(m.msg_ts_tz) as last_msg
    FROM "Message" m
    LEFT JOIN "Instance" i ON i.id = m."instanceId"
   WHERE m.key->>'remoteJid' = '559484356203@s.whatsapp.net'
      OR m.key->>'remoteJid' = '5594984356203@s.whatsapp.net'
      OR m.key->>'remoteJid' = '559484356203@c.us'
      OR m.key->>'remoteJid' = '5594984356203@c.us'
   GROUP BY i.name
   ORDER BY msgs DESC
`);
if (r.rows.length === 0) {
  console.log('  ❌ Nada por JID exato. Tentando LIKE...');
} else {
  console.table(r.rows);
}

console.log('\n═══ 2) Por LIKE (mais amplo) ═══');
const r2 = await c.query(`
  SELECT i.name as instance_name, COUNT(*)::int as msgs,
         MIN(m.msg_ts_tz) as first_msg, MAX(m.msg_ts_tz) as last_msg
    FROM "Message" m
    LEFT JOIN "Instance" i ON i.id = m."instanceId"
   WHERE m.key->>'remoteJid' LIKE '%9484356203%'
   GROUP BY i.name
   ORDER BY msgs DESC
`);
if (r2.rows.length === 0) {
  console.log('  ❌ NADA NEM POR LIKE — não há mensagens com esse telefone');
} else {
  console.table(r2.rows);
}

console.log('\n═══ 3) Por msisdn_55 ═══');
const r3 = await c.query(`
  SELECT i.name as instance_name, COUNT(*)::int as msgs,
         MIN(m.msg_ts_tz) as first_msg, MAX(m.msg_ts_tz) as last_msg
    FROM "Message" m
    LEFT JOIN "Instance" i ON i.id = m."instanceId"
   WHERE m.msisdn_55 IN ('5594984356203', '559484356203')
   GROUP BY i.name
   ORDER BY msgs DESC
`);
if (r3.rows.length === 0) {
  console.log('  ❌ Nada por msisdn_55');
} else {
  console.table(r3.rows);
}

console.log('\n═══ 4) Por msisdn_55_v2 ═══');
const r4 = await c.query(`
  SELECT i.name as instance_name, COUNT(*)::int as msgs
    FROM "Message" m
    LEFT JOIN "Instance" i ON i.id = m."instanceId"
   WHERE m.msisdn_55_v2 IN ('5594984356203', '559484356203')
      OR m.msisdn_55_v2 LIKE '%9484356203%'
   GROUP BY i.name
   ORDER BY msgs DESC
`);
if (r4.rows.length === 0) {
  console.log('  ❌ Nada por msisdn_55_v2');
} else {
  console.table(r4.rows);
}

console.log('\n═══ 5) Vamos ver o formato real dos JIDs em mensagens recentes da instância DAVID ═══');
const r5 = await c.query(`
  SELECT m.key->>'remoteJid' as jid, m.msisdn_55, m.msisdn_55_v2,
         COUNT(*)::int as msgs
    FROM "Message" m
   WHERE m."instanceId" = '6c23d656-18f0-4f25-ae92-2ec5ac57741e'
   GROUP BY jid, m.msisdn_55, m.msisdn_55_v2
   ORDER BY msgs DESC
   LIMIT 5
`);
console.log('  Sample de JIDs na instância DAVID:');
for (const row of r5.rows) {
  console.log(`    jid=${row.jid}  msisdn=${row.msisdn_55}  msisdn_v2=${row.msisdn_55_v2}  msgs=${row.msgs}`);
}

console.log('\n═══ 6) Procura textuais "Jucelino Reis" no pushName da Message ═══');
const r6 = await c.query(`
  SELECT i.name as instance_name, m.key->>'remoteJid' as jid, m.msisdn_55,
         COUNT(*)::int as msgs, MIN(m.msg_ts_tz) as first_msg, MAX(m.msg_ts_tz) as last_msg
    FROM "Message" m
    LEFT JOIN "Instance" i ON i.id = m."instanceId"
   WHERE LOWER(m."pushName") LIKE '%jucelino%reis%'
   GROUP BY i.name, jid, m.msisdn_55
   ORDER BY msgs DESC
   LIMIT 20
`);
if (r6.rows.length === 0) {
  console.log('  ❌ Nada por pushName=jucelino reis');
} else {
  console.table(r6.rows);
}

console.log('\n═══ 7) Tentando via vw_messages view ═══');
try {
  const r7 = await c.query(`
    SELECT * FROM vw_messages WHERE msisdn_55 LIKE '%9484356203%' LIMIT 5
  `);
  if (r7.rows.length > 0) {
    console.log(`  ✓ ${r7.rows.length} resultados em vw_messages`);
    console.log('  Colunas:', Object.keys(r7.rows[0]).join(', '));
    console.table(r7.rows.slice(0, 3));
  } else {
    console.log('  ❌ vw_messages vazio pra esse telefone');
  }
} catch (e) {
  console.log(`  ❌ ${e.message.slice(0, 100)}`);
}

await c.end();
