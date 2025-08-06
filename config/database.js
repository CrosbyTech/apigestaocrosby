import pkg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pkg;

// Configuração otimizada do pool de conexões
const pool = new Pool({
  user: process.env.PGUSER || 'crosby_ro',
  host: process.env.PGHOST || 'dbexp.vcenter.com.br',
  database: process.env.PGDATABASE || 'crosby',
  password: process.env.PGPASSWORD || 'wKspo98IU2eswq',
  port: process.env.PGPORT ? parseInt(process.env.PGPORT) : 20187,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  
  // Configurações otimizadas para queries pesadas
  max: 30, // Aumentar para queries pesadas
  min: 5, // Manter mais conexões ativas
  idleTimeoutMillis: 60000, // 1 minuto para liberar conexões ociosas  
  connectionTimeoutMillis: 120000, // 2 minutos timeout para novas conexões
  acquireTimeoutMillis: 120000, // 2 minutos timeout para adquirir conexão
  
  // Configurações do PostgreSQL com timeouts de 1 hora
  statement_timeout: 3600000, // 1 hora timeout para statements
  query_timeout: 3600000, // 1 hora timeout para queries
  idle_in_transaction_session_timeout: 3600000, // 1 hora timeout para transações ociosas
  application_name: 'apigestaocrosby',
  
  // Keep alive configurado adequadamente
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000, // 10 segundos delay inicial
});

// Teste de conexão na inicialização
pool.on('connect', () => {
  console.log('Conectado ao banco de dados PostgreSQL');
});

pool.on('error', (err) => {
  console.error('Erro na conexão com o banco de dados:', err);
  
  // Log específico para timeouts
  if (err.message.includes('timeout') || err.code === 'ECONNRESET') {
    console.error('⚠️  Timeout de conexão detectado. Verifique a latência de rede.');
  }
});

// Monitoramento do pool simplificado (apenas erros críticos)
pool.on('acquire', () => {
  // Log removido para economizar memória
});

pool.on('release', () => {
  // Log removido para economizar memória
});

// Função para testar conexão
export const testConnection = async () => {
  try {
    const result = await pool.query('SELECT 1 as test');
    console.log('✅ Teste de conexão bem-sucedido');
    return true;
  } catch (error) {
    console.error('❌ Falha no teste de conexão:', error.message);
    return false;
  }
};

// Graceful shutdown do pool
export const closePool = async () => {
  try {
    await pool.end();
    console.log('🔒 Pool de conexões fechado');
  } catch (error) {
    console.error('❌ Erro ao fechar pool:', error);
  }
};

export default pool;