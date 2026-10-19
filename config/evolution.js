import pg from 'pg';
const { Pool } = pg;

const evolutionPool = new Pool({
  host: process.env.EVOLUTION_DB_HOST || 'database1.crosbytech.com.br',
  port: parseInt(process.env.EVOLUTION_DB_PORT || '5432'),
  database: process.env.EVOLUTION_DB_NAME || 'evolutionadm',
  user: process.env.EVOLUTION_DB_USER || 'evolution_read',
  // senha só por env (EVOLUTION_DB_PASSWORD) — não voltar a deixar no código
  password: process.env.EVOLUTION_DB_PASSWORD,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: false,
});

evolutionPool.on('error', (err) => {
  console.error('❌ Evolution DB pool error:', err.message);
});

export default evolutionPool;
