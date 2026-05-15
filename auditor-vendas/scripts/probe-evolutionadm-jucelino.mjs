// Busca Jucelino Reis no banco evolutionadm (3.8M mensagens)
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

const PHONES = ['94984356203', '5594984356203', '559484356203', '9484356203'];

// 1) Lista instâncias do David/Arthur/MTM
console.log('═══ Instâncias relevantes (david/mtm/arthur) ═══');
const insts = await c.query(`
  SELECT id, name, "connectionStatus", "ownerJid", number, display_name
    FROM "Instance"
   WHERE LOWER(name) SIMILAR TO '%(david|mtm|arthur|jucelino)%'
   ORDER BY name
`);
console.table(insts.rows);

// 2) Procura contato com o telefone (usando msisdn_55 que já é normalizado)
console.log('\n═══ Contatos com o telefone (qualquer instância) ═══');
const phoneFilters = PHONES.map((_, i) => `msisdn_55 LIKE $${i + 1}`).join(' OR ');
const phoneArgs = PHONES.map((p) => `%${p}%`);
const cont = await c.query(`
  SELECT c.id, c."remoteJid", c."pushName", c.msisdn_55, c."instanceId",
         i.name as instance_name
    FROM "Contact" c
    LEFT JOIN "Instance" i ON i.id = c."instanceId"
   WHERE ${phoneFilters}
      OR c."remoteJid" LIKE '%94984356203%'
      OR c."remoteJid" LIKE '%5594984356203%'
      OR c."remoteJid" LIKE '%559484356203%'
   LIMIT 50
`, phoneArgs);
if (cont.rows.length === 0) {
  console.log('  ❌ Nenhum contato com esses telefones');
} else {
  console.log(`  ✓ ${cont.rows.length} contato(s):`);
  console.table(
    cont.rows.map((r) => ({
      instance: r.instance_name,
      remoteJid: r.remoteJid,
      pushName: r.pushName,
      msisdn: r.msisdn_55,
    })),
  );
}

// 3) Procura por NOME similar (Jucelino, J Silva, Silva dos Reis, Still Urbano)
console.log('\n═══ Contatos com nome Jucelino/Silva/Reis (top 50) ═══');
const nameQ = await c.query(`
  SELECT c.id, c."remoteJid", c."pushName", c.msisdn_55, i.name as instance_name
    FROM "Contact" c
    LEFT JOIN "Instance" i ON i.id = c."instanceId"
   WHERE LOWER(c."pushName") LIKE '%jucelino%reis%'
      OR LOWER(c."pushName") LIKE '%j silva%reis%'
      OR LOWER(c."pushName") LIKE '%silva dos reis%'
      OR LOWER(c."pushName") LIKE '%still urbano%'
      OR LOWER(c."pushName") = 'jucelino reis'
   LIMIT 50
`);
if (nameQ.rows.length === 0) {
  console.log('  ❌ Nenhum contato');
} else {
  console.table(nameQ.rows);
}

// 4) Mensagens diretas por msisdn_55 ou key.remoteJid
console.log('\n═══ Mensagens (Message) com telefone Jucelino ═══');
const msgsQ = await c.query(`
  SELECT m.id, m.key->>'remoteJid' as remoteJid, (m.key->>'fromMe')::bool as fromMe,
         m."messageTimestamp", m.msg_ts_tz, m."messageType",
         m.text_content, m."pushName", m.msisdn_55, m."instanceId",
         i.name as instance_name
    FROM "Message" m
    LEFT JOIN "Instance" i ON i.id = m."instanceId"
   WHERE m.msisdn_55 IN ('5594984356203', '559484356203', '94984356203')
      OR m.key->>'remoteJid' LIKE '%94984356203%'
      OR m.key->>'remoteJid' LIKE '%5594984356203%'
      OR m.key->>'remoteJid' LIKE '%559484356203%'
   ORDER BY m."messageTimestamp" ASC
   LIMIT 500
`);
if (msgsQ.rows.length === 0) {
  console.log('  ❌ NENHUMA mensagem encontrada');
} else {
  console.log(`  ✓ ${msgsQ.rows.length} mensagens encontradas\n`);

  // Resumo por instância × dia
  const byInst = new Map();
  for (const m of msgsQ.rows) {
    const inst = m.instance_name || m.instanceId?.slice(0, 8);
    if (!byInst.has(inst)) byInst.set(inst, []);
    byInst.get(inst).push(m);
  }
  console.log(`  Instâncias envolvidas: ${[...byInst.keys()].join(', ')}\n`);

  // Por dia (geral)
  console.log('  Resumo por dia (todas instâncias):');
  const porDia = new Map();
  for (const m of msgsQ.rows) {
    const dia = m.msg_ts_tz?.toISOString().slice(0, 10) || '?';
    porDia.set(dia, (porDia.get(dia) || 0) + 1);
  }
  for (const [d, n] of [...porDia.entries()].sort()) {
    const flag = d === '2026-03-20' ? ' 🚨 (DIA das 4 NFs canceladas!)' : '';
    console.log(`    ${d}: ${n} msgs${flag}`);
  }

  // Print das mensagens entre 18/03 e 25/03 (período crítico)
  console.log('\n  📨 MENSAGENS ENTRE 18/03 e 25/03/2026 (período NFs):');
  const periodo = msgsQ.rows.filter((m) => {
    const dia = m.msg_ts_tz?.toISOString().slice(0, 10);
    return dia >= '2026-03-18' && dia <= '2026-03-25';
  });
  if (periodo.length === 0) {
    console.log('    ❌ NENHUMA no período crítico');
  } else {
    for (const m of periodo) {
      const inst = m.instance_name || m.instanceId?.slice(0, 8);
      const dir = m.fromme ? `→ ${inst.toUpperCase()}` : '← JUCELINO';
      const text = (m.text_content || `[${m.messageType || 'mídia'}]`).slice(0, 300);
      console.log(
        `    ${m.msg_ts_tz?.toISOString().slice(0, 19)} [${inst}] ${dir}: ${text}`,
      );
    }
  }

  // Print das primeiras 10 e últimas 10 (pra ver início e fim)
  console.log('\n  ⏮  PRIMEIRAS 10 MENSAGENS:');
  for (const m of msgsQ.rows.slice(0, 10)) {
    const inst = m.instance_name || m.instanceId?.slice(0, 8);
    const dir = m.fromme ? `→ ${inst.toUpperCase()}` : '← JUCELINO';
    const text = (m.text_content || `[${m.messageType || 'mídia'}]`).slice(0, 200);
    console.log(`    ${m.msg_ts_tz?.toISOString().slice(0, 19)} [${inst}] ${dir}: ${text}`);
  }
  if (msgsQ.rows.length > 10) {
    console.log('\n  ⏭  ÚLTIMAS 5 MENSAGENS:');
    for (const m of msgsQ.rows.slice(-5)) {
      const inst = m.instance_name || m.instanceId?.slice(0, 8);
      const dir = m.fromme ? `→ ${inst.toUpperCase()}` : '← JUCELINO';
      const text = (m.text_content || `[${m.messageType || 'mídia'}]`).slice(0, 200);
      console.log(`    ${m.msg_ts_tz?.toISOString().slice(0, 19)} [${inst}] ${dir}: ${text}`);
    }
  }
}

await c.end();
