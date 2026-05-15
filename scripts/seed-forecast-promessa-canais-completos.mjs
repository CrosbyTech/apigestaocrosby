// Insere/garante os 11 canais do sistema na tabela forecast_promessa_canais
// (mesmos canais usados no Forecast "Por Canal")
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
import pg from 'pg';

const c = new pg.Client({
  host: process.env.SUPABASE_DB_HOST,
  port: 5432,
  user: process.env.SUPABASE_DB_USER,
  password: process.env.SUPABASE_DB_PASSWORD,
  database: process.env.SUPABASE_DB_NAME,
  ssl: { rejectUnauthorized: false },
});

const CANAIS = [
  { nome: 'B2M',                ordem:  10, tipo: 'modulo', cfg: { modulo: 'multimarcas' } },
  { nome: 'B2R',                ordem:  20, tipo: 'modulo', cfg: { modulo: 'revenda' } },
  { nome: 'B2C',                ordem:  30, tipo: 'modulo', cfg: { modulo: 'varejo' } },
  { nome: 'B2L',                ordem:  40, tipo: 'manual', cfg: {} },
  { nome: 'Inbound David',      ordem:  50, tipo: 'modulo', cfg: { modulo: 'inbound_david' } },
  { nome: 'Inbound Rafael',     ordem:  60, tipo: 'modulo', cfg: { modulo: 'inbound_rafael' } },
  { nome: 'Franquia',           ordem:  70, tipo: 'modulo', cfg: { modulo: 'franquia' } },
  { nome: 'Business',           ordem:  80, tipo: 'modulo', cfg: { modulo: 'business' } },
  { nome: 'Bazar',              ordem:  90, tipo: 'modulo', cfg: { modulo: 'bazar' } },
  { nome: 'Showroom',           ordem: 100, tipo: 'modulo', cfg: { modulo: 'showroom' } },
  { nome: 'Novidades Franquia', ordem: 110, tipo: 'modulo', cfg: { modulo: 'novidadesfranquia' } },
  { nome: 'Ricardo Eletro',     ordem: 120, tipo: 'modulo', cfg: { modulo: 'ricardoeletro' } },
];

try {
  await c.connect();
  for (const ch of CANAIS) {
    const exists = await c.query(
      `SELECT id FROM forecast_promessa_canais
        WHERE (nome = $1
          OR (tipo = 'modulo' AND fonte_config->>'modulo' = $2))
        LIMIT 1`,
      [ch.nome, ch.cfg?.modulo || null],
    );
    if (exists.rows.length) {
      // Atualiza para garantir tipo/config correto sem mudar nome
      await c.query(
        `UPDATE forecast_promessa_canais
            SET tipo = $1,
                fonte_config = $2::jsonb,
                ordem = $3,
                ativo = true,
                atualizado_em = NOW()
          WHERE id = $4`,
        [ch.tipo, JSON.stringify(ch.cfg), ch.ordem, exists.rows[0].id],
      );
      console.log(`UPDATE  ${ch.nome.padEnd(20)} (id=${exists.rows[0].id})`);
    } else {
      const r = await c.query(
        `INSERT INTO forecast_promessa_canais (nome, ordem, tipo, fonte_config, ativo)
              VALUES ($1, $2, $3, $4::jsonb, true)
           RETURNING id`,
        [ch.nome, ch.ordem, ch.tipo, JSON.stringify(ch.cfg)],
      );
      console.log(`INSERT  ${ch.nome.padEnd(20)} (id=${r.rows[0].id})`);
    }
  }
  const all = await c.query(
    `SELECT id, nome, tipo, fonte_config FROM forecast_promessa_canais
       WHERE ativo = true ORDER BY ordem`,
  );
  console.log('\n— Canais ativos —');
  for (const r of all.rows) {
    console.log(`  [${String(r.id).padStart(3)}] ${r.nome.padEnd(22)} ${r.tipo}  ${JSON.stringify(r.fonte_config)}`);
  }
} catch (e) {
  console.error('ERR:', e.message);
} finally {
  try { await c.end(); } catch {}
}
