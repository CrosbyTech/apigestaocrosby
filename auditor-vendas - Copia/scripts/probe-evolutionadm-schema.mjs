// Explora banco evolutionadm com credenciais novas
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
console.log('✓ Conectado em evolutionadm\n');

// 1) Lista tabelas
console.log('═══ Tabelas ═══');
const tables = await c.query(`
  SELECT table_schema, table_name, table_type
    FROM information_schema.tables
   WHERE table_schema NOT IN ('pg_catalog','information_schema','pg_toast')
   ORDER BY table_schema, table_name
`);
for (const r of tables.rows) {
  console.log(`  ${r.table_schema}.${r.table_name} (${r.table_type})`);
}

// 2) Pra cada tabela com possível conteúdo de WhatsApp, mostra colunas
const interestingTables = tables.rows.filter((r) =>
  /message|chat|contact|instance|conversa|cliente/i.test(r.table_name),
);
console.log(`\n═══ Schema das tabelas relevantes (${interestingTables.length}) ═══`);
for (const t of interestingTables) {
  const cols = await c.query(
    `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
       ORDER BY ordinal_position`,
    [t.table_schema, t.table_name],
  );
  console.log(`\n  ${t.table_schema}.${t.table_name}:`);
  console.log(
    `    ${cols.rows.map((c) => `${c.column_name}(${c.data_type})`).join(', ')}`,
  );
  try {
    const cnt = await c.query(
      `SELECT COUNT(*)::bigint as n FROM ${t.table_schema}."${t.table_name}"`,
    );
    console.log(`    rows: ${cnt.rows[0].n}`);
  } catch (err) {
    console.log(`    rows: ${err.message.slice(0, 80)}`);
  }
}

await c.end();
