import pkg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pkg;

// Configuração do pool de conexões do banco de dados (otimizada para Render)
const pool = new Pool({
  user: process.env.PGUSER || 'crosby_ro',
  host: process.env.PGHOST || 'dbexp.vcenter.com.br',
  database: process.env.PGDATABASE || 'crosby',
  password: process.env.PGPASSWORD || 'wKspo98IU2eswq',
  port: process.env.PGPORT ? parseInt(process.env.PGPORT) : 20187,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  
  // Configurações sem limites de tempo
  max: 1000, // Máximo de conexões no pool
  min: 200, // Mínimo de conexões mantidas
  idleTimeoutMillis: 0, // Sem timeout para conexões ociosas (ilimitado)
  connectionTimeoutMillis: 0, // Sem timeout para novas conexões (ilimitado)
  acquireTimeoutMillis: 0, // Sem timeout para adquirir conexão (ilimitado)
  createTimeoutMillis: 0, // Sem timeout para criar conexão (ilimitado)
  destroyTimeoutMillis: 0, // Sem timeout para destruir conexão (ilimitado)
  reapIntervalMillis: 0, // Sem limpeza automática de conexões
  createRetryIntervalMillis: 0, // Sem intervalo entre tentativas
  
  // Configurações específicas do PostgreSQL - SEM TIMEOUTS
  statement_timeout: 0, // Sem timeout para statements (ilimitado)
  query_timeout: 0, // Sem timeout para queries (ilimitado)
  idle_in_transaction_session_timeout: 0, // Sem timeout para transações ociosas
  application_name: 'apigestaocrosby',
  
  // Keep alive para conexões permanentes
  keepAlive: true,
  keepAliveInitialDelayMillis: 0, // Sem delay inicial
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

// Helper para executar queries com retry infinito para timeouts
const queryWithRetry = async (text, params, maxRetries = 10) => {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await originalQuery(text, params);
      if (attempt > 1) {
        console.log(`✅ Query executada com sucesso na tentativa ${attempt}`);
      }
      return result;
    } catch (error) {
      lastError = error;
      
      // Se é timeout ou conexão perdida, tenta novamente indefinidamente
      if (error.message.includes('timeout') || 
          error.code === 'ECONNRESET' || 
          error.code === 'ENOTFOUND' ||
          error.code === 'ECONNREFUSED') {
        
        console.log(`⚠️  Tentativa ${attempt} falhou: ${error.message}`);
        console.log(`🔄 Tentando novamente em ${attempt * 2000}ms...`);
        
        // Se chegou no máximo de tentativas para timeout, continua tentando
        if (attempt === maxRetries) {
          console.log(`♾️  Continuando tentativas infinitas para timeout...`);
          maxRetries += 10; // Aumenta o limite para continuar tentando
        }
        
        await new Promise(resolve => setTimeout(resolve, attempt * 2000));
        continue;
      }
      
      // Se não é erro de conexão/timeout, falha imediatamente
      console.error(`❌ Erro definitivo na query:`, error.message);
      throw error;
    }
  }
  
  throw lastError;
};

// Manter referência original antes de substituir
const originalQuery = pool.query.bind(pool);
pool.query = queryWithRetry;

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