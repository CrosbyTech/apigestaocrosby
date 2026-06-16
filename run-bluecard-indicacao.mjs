import 'dotenv/config';
import pg from 'pg';
import fs from 'fs';

const sql = fs.readFileSync('./migrations/bluecard_indicacao.sql', 'utf8');
const c = new pg.Client({
  host: process.env.SUPABASE_DB_HOST, port: 5432,
  user: process.env.SUPABASE_DB_USER, password: process.env.SUPABASE_DB_PASSWORD,
  database: process.env.SUPABASE_DB_NAME, ssl: { rejectUnauthorized: false },
});
await c.connect();
await c.query(sql);
console.log('✓ migration aplicada');
await c.end();
process.exit(0);
