// Exporta clientes da empresa 6142 (e 6143 se houver) pra CSV
import 'dotenv/config';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';

const { Pool } = pg;
const pool = new Pool({
  host: process.env.SUPABASE_DB_HOST,
  port: parseInt(process.env.SUPABASE_DB_PORT || '5432', 10),
  user: process.env.SUPABASE_DB_USER,
  password: process.env.SUPABASE_DB_PASSWORD,
  database: process.env.SUPABASE_DB_NAME,
  ssl: { rejectUnauthorized: false },
});

const r = await pool.query(`
  SELECT
    code,
    nm_pessoa,
    fantasy_name,
    tipo_pessoa,
    cpf,
    uf,
    cd_empresacad,
    branch_insert_code,
    insert_date::date AS data_cadastro,
    customer_status,
    telefone,
    email
  FROM pes_pessoa
  WHERE cd_empresacad IN (6142, 6143) AND is_customer = true
  ORDER BY insert_date DESC NULLS LAST
`);

console.log(`Total clientes: ${r.rows.length}`);

const headers = [
  'code',
  'nm_pessoa',
  'fantasy_name',
  'tipo_pessoa',
  'cpf',
  'uf',
  'cd_empresacad',
  'branch_insert_code',
  'data_cadastro',
  'customer_status',
  'telefone',
  'email',
];

const csv = [headers.join(';')];
for (const row of r.rows) {
  csv.push(
    headers
      .map((h) => {
        const v = row[h];
        if (v == null) return '';
        return String(v).replace(/;/g, ',').replace(/\r?\n/g, ' ');
      })
      .join(';'),
  );
}

// Tenta Desktop → Downloads → Documents → cwd
const home = process.env.USERPROFILE || process.env.HOME || process.cwd();
const candidates = [
  path.join(home, 'Desktop'),
  path.join(home, 'Downloads'),
  path.join(home, 'Documents'),
  process.cwd(),
];
let outDir = process.cwd();
for (const c of candidates) {
  if (fs.existsSync(c)) {
    outDir = c;
    break;
  }
}
const outPath = path.join(outDir, 'clientes_empresa_6142_6143.csv');

fs.writeFileSync(outPath, '﻿' + csv.join('\n'), 'utf-8'); // BOM pra Excel ler em UTF-8
console.log(`✅ CSV exportado: ${outPath}`);
console.log();
console.log('Top 10 mais recentes:');
for (const row of r.rows.slice(0, 10)) {
  console.log(
    ` `,
    row.code,
    '|',
    (row.nm_pessoa || '').slice(0, 35).padEnd(35),
    '|',
    row.cpf || '—',
    '|',
    row.data_cadastro || '—',
    '|',
    row.uf || '—',
    '|',
    row.customer_status,
  );
}

await pool.end();
