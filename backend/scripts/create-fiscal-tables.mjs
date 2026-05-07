import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const { Client } = pg;

const __dirname = dirname(fileURLToPath(import.meta.url));

const client = new Client({
  host: 'aws-1-sa-east-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.wnjapaczjcvhumfikwwe',
  password: 'WFMxwIvphALdIktj',
  ssl: { rejectUnauthorized: false },
});

const sql = readFileSync(
  join(__dirname, '../../database/schema-notas-fiscais.sql'),
  'utf-8',
);

try {
  await client.connect();
  console.log('✅ Conectado ao banco fiscal');

  await client.query(sql);

  console.log('🎉 Tabela notas_fiscais criada com sucesso no banco fiscal!');
} catch (err) {
  // Ignorar erros de "já existe"
  if (err.message.includes('already exists')) {
    console.warn(`⚠ Objeto já existe (ignorado): ${err.message.split('\n')[0]}`);
    console.log('🎉 Schema já aplicado anteriormente.');
  } else {
    console.error('❌ Erro:', err.message);
    process.exit(1);
  }
} finally {
  await client.end();
}
