// Exporta clientes da empresa 6142 que TÊM telefone preenchido
// Pega de qualquer fonte: telefone direto OU array phones JSON
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
    insert_date::date AS data_cadastro,
    customer_status,
    telefone,
    email,
    phones
  FROM pes_pessoa
  WHERE cd_empresacad IN (6142, 6143) AND is_customer = true
  ORDER BY insert_date DESC NULLS LAST
`);

console.log(`Total clientes na empresa: ${r.rows.length}`);

// Helper: pega o melhor telefone disponível (default primeiro, ou primeiro do array)
function extractPhone(row) {
  // 1. Campo telefone direto
  if (row.telefone && String(row.telefone).replace(/\D/g, '').length >= 8) {
    return { numero: row.telefone, tipo: 'telefone', isWhatsApp: false };
  }
  // 2. Array phones (JSON) — pega o default primeiro, depois qualquer
  const phones = Array.isArray(row.phones) ? row.phones : [];
  if (phones.length === 0) return null;
  // Tenta WHATSAPP padrão
  const wpp = phones.find(
    (p) =>
      (p.isDefault || p.is_default) &&
      /whatsapp/i.test(p.typeName || p.type_name || ''),
  );
  if (wpp?.number)
    return { numero: wpp.number, tipo: 'WhatsApp', isWhatsApp: true };
  // Outro padrão
  const def = phones.find((p) => p.isDefault || p.is_default);
  if (def?.number)
    return {
      numero: def.number,
      tipo: def.typeName || def.type_name || 'Padrão',
      isWhatsApp: /whatsapp/i.test(def.typeName || def.type_name || ''),
    };
  // Qualquer um
  const any = phones[0];
  if (any?.number)
    return {
      numero: any.number,
      tipo: any.typeName || any.type_name || 'Telefone',
      isWhatsApp: /whatsapp/i.test(any.typeName || any.type_name || ''),
    };
  return null;
}

function fmtFone(v) {
  if (!v) return '';
  const d = String(v).replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return v;
}

const comTelefone = [];
const semTelefone = [];

for (const row of r.rows) {
  const fone = extractPhone(row);
  if (fone) {
    comTelefone.push({
      code: row.code,
      nm_pessoa: row.nm_pessoa || '',
      fantasy_name: row.fantasy_name || '',
      cpf: row.cpf || '',
      uf: row.uf || '',
      data_cadastro: row.data_cadastro || '',
      customer_status: row.customer_status || '',
      telefone: fmtFone(fone.numero),
      telefone_raw: String(fone.numero).replace(/\D/g, ''),
      tipo_telefone: fone.tipo,
      whatsapp: fone.isWhatsApp ? 'Sim' : 'Não',
      email: row.email || '',
    });
  } else {
    semTelefone.push(row.code);
  }
}

console.log(`Com telefone: ${comTelefone.length}`);
console.log(`Sem telefone: ${semTelefone.length}`);
console.log();

// Salva CSV
const headers = [
  'code',
  'nm_pessoa',
  'fantasy_name',
  'cpf',
  'uf',
  'data_cadastro',
  'customer_status',
  'telefone',
  'telefone_raw',
  'tipo_telefone',
  'whatsapp',
  'email',
];

const csv = [headers.join(';')];
for (const row of comTelefone) {
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
const outPath = path.join(outDir, 'clientes_6142_com_telefone.csv');
fs.writeFileSync(outPath, '﻿' + csv.join('\n'), 'utf-8');
console.log(`✅ CSV exportado: ${outPath}`);
console.log();
console.log('Top 10 mais recentes COM telefone:');
for (const row of comTelefone.slice(0, 10)) {
  console.log(
    ` `,
    row.code,
    '|',
    (row.nm_pessoa || '').slice(0, 30).padEnd(30),
    '|',
    row.telefone.padEnd(16),
    '|',
    row.tipo_telefone.padEnd(12),
    '|',
    'WP:' + row.whatsapp,
  );
}

await pool.end();
