// Aplicação de migrations versionadas via RPC exec_sql (Supabase principal).
// Usado pelo script scripts/erp-migrate.mjs e pela rota POST /api/erp/migrations/aplicar.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const checksumDe = (sql) => crypto.createHash('sha256').update(sql).digest('hex').slice(0, 16);

// A função no Supabase é exec_sql(query text). Mantém fallback para o nome
// antigo do parâmetro (sql) caso a função seja recriada com outra assinatura.
export async function execSql(supabase, sql) {
  let { data, error } = await supabase.rpc('exec_sql', { query: sql });
  if (error && /exec_sql\(query\)/.test(error.message || '')) {
    ({ data, error } = await supabase.rpc('exec_sql', { sql }));
  }
  if (error) throw new Error(error.message || JSON.stringify(error));
  return data;
}

async function garantirTabelaControle(supabase) {
  await execSql(
    supabase,
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name TEXT PRIMARY KEY,
       checksum TEXT,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );
}

export function listarArquivos(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => {
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      return { name: f.replace(/\.sql$/, ''), file: path.join(dir, f), sql, checksum: checksumDe(sql) };
    });
}

export async function statusMigrations(supabase, dir) {
  await garantirTabelaControle(supabase);
  let { data: aplicadas, error } = await supabase.from('schema_migrations').select('name, checksum, applied_at');
  if (error && /schema cache/i.test(error.message || '')) {
    // tabela acabou de ser criada e o PostgREST ainda não recarregou o cache
    await new Promise((r) => setTimeout(r, 3000));
    ({ data: aplicadas, error } = await supabase.from('schema_migrations').select('name, checksum, applied_at'));
  }
  if (error) throw new Error(error.message);
  const mapa = new Map((aplicadas || []).map((m) => [m.name, m]));
  return listarArquivos(dir).map((m) => {
    const ap = mapa.get(m.name);
    return {
      name: m.name,
      checksum: m.checksum,
      aplicada: !!ap,
      applied_at: ap?.applied_at || null,
      checksumDiferente: !!ap && ap.checksum && ap.checksum !== m.checksum,
    };
  });
}

export async function aplicarMigrations(supabase, dir, { force = null, log = () => {} } = {}) {
  await garantirTabelaControle(supabase);
  const status = await statusMigrations(supabase, dir);
  const arquivos = listarArquivos(dir);
  const aplicadas = [];
  const puladas = [];
  const erros = [];
  for (const m of arquivos) {
    const st = status.find((s) => s.name === m.name);
    if (st?.aplicada && force !== m.name) {
      puladas.push(m.name);
      continue;
    }
    const t0 = Date.now();
    log(`▶ aplicando ${m.name}...`);
    try {
      await execSql(supabase, m.sql);
      // registro via SQL (o cache do PostgREST pode ainda não conhecer a tabela recém-criada)
      await execSql(
        supabase,
        `INSERT INTO schema_migrations (name, checksum, applied_at)
         VALUES ('${m.name.replace(/'/g, "''")}', '${m.checksum}', now())
         ON CONFLICT (name) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = now()`,
      );
      aplicadas.push(m.name);
      log(`  ✅ ${m.name} em ${Date.now() - t0}ms`);
    } catch (e) {
      erros.push({ name: m.name, erro: e.message });
      log(`  ❌ ${m.name}: ${e.message}`);
      break; // não segue para as próximas: ordem importa
    }
  }
  return { aplicadas, puladas, erros };
}
