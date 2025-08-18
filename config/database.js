import pkg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pkg;

// Configuração otimizada do pool de conexões com proteção contra timeouts
const pool = new Pool({
  user: process.env.PGUSER || 'crosby_ro',
  host: process.env.PGHOST || 'dbexp.vcenter.com.br',
  database: process.env.PGDATABASE || 'crosby',
  password: process.env.PGPASSWORD || 'wKspo98IU2eswq',
  port: process.env.PGPORT ? parseInt(process.env.PGPORT) : 20187,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  
  // Configurações otimizadas para queries pesadas e proteção contra timeouts
  max: 20, // Reduzir para evitar sobrecarga
  min: 3, // Manter menos conexões ativas
  idleTimeoutMillis: 30000, // 30 segundos para liberar conexões ociosas mais rapidamente
  connectionTimeoutMillis: 30000, // 30 segundos timeout para novas conexões
  acquireTimeoutMillis: 30000, // 30 segundos timeout para adquirir conexão
  
  // Configurações do PostgreSQL com timeouts mais conservadores
  statement_timeout: 1800000, // 30 minutos timeout para statements
  query_timeout: 1800000, // 30 minutos timeout para queries
  idle_in_transaction_session_timeout: 1800000, // 30 minutos timeout para transações ociosas
  application_name: 'apigestaocrosby',
  
  // Keep alive configurado para manter conexões ativas
  keepAlive: true,
  keepAliveInitialDelayMillis: 5000, // 5 segundos delay inicial
});

// Teste de conexão na inicialização
pool.on('connect', () => {
  console.log('Conectado ao banco de dados PostgreSQL');
});

// Monitoramento e tratamento de erros de conexão
let connectionErrors = 0;
let lastErrorTime = 0;

pool.on('connect', () => {
  console.log('✅ Conectado ao banco de dados PostgreSQL');
  connectionErrors = 0; // Reset contador de erros
});

pool.on('error', (err) => {
  const now = Date.now();
  connectionErrors++;
  
  console.error(`❌ Erro na conexão com o banco de dados (${connectionErrors}):`, err.message);
  
  // Log específico para timeouts
  if (err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET' || err.message.includes('timeout')) {
    console.error('⚠️  Timeout de conexão detectado. Possíveis causas:');
    console.error('   - Latência de rede alta');
    console.error('   - Sobrecarga no servidor de banco');
    console.error('   - Firewall bloqueando conexões');
    console.error('   - Configuração de SSL inadequada');
    
    // Se muitos erros em pouco tempo, logar alerta
    if (connectionErrors > 5 && (now - lastErrorTime) < 60000) {
      console.error('🚨 ALERTA: Muitos timeouts em sequência. Verificar conectividade de rede.');
    }
  }
  
  lastErrorTime = now;
});

// Monitoramento do pool simplificado (apenas erros críticos)
pool.on('acquire', () => {
  // Log removido para economizar memória
});

pool.on('release', () => {
  // Log removido para economizar memória
});

// Função para executar queries com retry automático
export const executeQueryWithRetry = async (query, params = [], maxRetries = 3) => {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await pool.query(query, params);
      return result;
    } catch (error) {
      lastError = error;
      
      // Se for timeout, tentar novamente
      if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET' || error.message.includes('timeout')) {
        console.warn(`⚠️  Tentativa ${attempt}/${maxRetries} falhou por timeout. Tentando novamente...`);
        
        if (attempt < maxRetries) {
          // Aguardar antes da próxima tentativa (backoff exponencial)
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }
      
      // Se não for timeout ou já tentou o máximo, não tentar novamente
      break;
    }
  }
  
  throw lastError;
};

// Função para verificar saúde da conexão
export const checkConnectionHealth = async () => {
  try {
    const start = Date.now();
    const result = await pool.query('SELECT 1 as health_check');
    const duration = Date.now() - start;
    
    return {
      healthy: true,
      responseTime: duration,
      connectionCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount
    };
  } catch (error) {
    return {
      healthy: false,
      error: error.message,
      connectionCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount
    };
  }
};

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