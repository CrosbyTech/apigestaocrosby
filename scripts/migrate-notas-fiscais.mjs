import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres:WFMxwIvphALdIktj@db.wnjapaczjcvhumfikwwe.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

await client.connect();
console.log('Conectado ao PostgreSQL');

const statements = [
  'ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS invoice_date DATE',
  'ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS user_code INTEGER',
  'ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS release_date DATE',
  'ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS exit_time TEXT',
  'ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS last_change_date TIMESTAMPTZ',
  'ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS max_change_filter_date TIMESTAMPTZ',
  'ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS payment_condition_code INTEGER',
  'ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS payment_condition_name TEXT',
  'ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS terminal_code INTEGER',
  'ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS seller_cpf TEXT',
  'ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS inclusion_component_code TEXT',
  'ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS peripheral_pdv_code TEXT',
  'ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS version_pdv TEXT',
  'ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS mobile_version TEXT',
  'ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS additional_value DECIMAL(15,2)',
  'ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS shipping_value DECIMAL(15,2)',
  'ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS base_icms_value DECIMAL(15,2)',
  'ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS icms_value DECIMAL(15,2)',
  'ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS eletronic JSONB',
  'ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS ecf JSONB',
  'ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS sat JSONB',
  'ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS shipping_company JSONB',
  'ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS person JSONB',
  'ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS production_order JSONB',
  'ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS sales_order JSONB',
  'ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS payments JSONB',
  'ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS observation_nf JSONB',
];

let ok = 0;
for (const sql of statements) {
  try {
    await client.query(sql);
    const col = sql.match(/IF NOT EXISTS (\w+)/)?.[1];
    console.log('OK:', col);
    ok++;
  } catch (e) {
    console.log('ERRO:', e.message);
  }
}

await client.query("NOTIFY pgrst, 'reload schema'");
console.log('---');
console.log('Criadas: ' + ok + '/' + statements.length);
console.log('Schema cache recarregado');
await client.end();
