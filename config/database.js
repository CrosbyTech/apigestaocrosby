import pkg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pkg;

// Validar e exibir configuração do banco de dados
const dbConfig = {
  user: process.env.PGUSER || 'crosby_ro_geo',
  host: process.env.PGHOST || 'dbexp.vcenter.com.br',
  database: process.env.PGDATABASE || 'crosby',
  password: process.env.PGPASSWORD ? '***' : 'usando_senha_padrao',
  port: process.env.PGPORT ? parseInt(process.env.PGPORT) : 20187,
};

console.log('📊 Configuração do Banco de Dados:');
console.log(`   Host: ${dbConfig.host}`);
console.log(`   Port: ${dbConfig.port}`);
console.log(`   Database: ${dbConfig.database}`);
console.log(`   User: ${dbConfig.user}`);
console.log(`   Password: ${dbConfig.password}`);
console.log(`   SSL: ${process.env.NODE_ENV === 'production' ? 'Habilitado' : 'Desabilitado'}`);

// Configuração do pool de conexões do banco de dados (otimizada para Render)
const pool = new Pool({
  user: process.env.PGUSER || 'crosby_ro_geo',
  host: process.env.PGHOST || 'dbexp.vcenter.com.br',
  database: process.env.PGDATABASE || 'crosby',
  password: process.env.PGPASSWORD || 'fJioqw9I2@wqwc',
  port: process.env.PGPORT ? parseInt(process.env.PGPORT) : 20187,
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,

  // Configurações de pool - OTIMIZADO PARA REDUZIR CONSUMO
  max: 10, // Máximo de 10 conexões simultâneas (reduzido de 50)
  min: 2, // Mínimo de 2 conexões mantidas sempre ativas
  idleTimeoutMillis: 30000, // 30 segundos para encerrar conexões ociosas (reduzido de 10 min)
  connectionTimeoutMillis: 10000, // 10 segundos timeout para novas conexões
  
  // Configurações específicas do PostgreSQL - COM TIMEOUTS ADEQUADOS
  statement_timeout: 60000, // 60 segundos timeout para statements (previne queries travadas)
  query_timeout: 60000, // 60 segundos timeout para queries
  idle_in_transaction_session_timeout: 10000, // 10 segundos para transações ociosas (CRÍTICO!)
  application_name: 'apigestaocrosby',

  // Keep alive para conexões
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000, // 10 segundos de delay inicial
});

// Monitoramento de conexões
let totalConnections = 0;
let activeConnections = 0;
let idleConnections = 0;

// Teste de conexão na inicialização
pool.on('connect', (client) => {
  totalConnections++;
  activeConnections++;
  console.log(`✅ Nova conexão ao banco PostgreSQL (Total: ${pool.totalCount}, Ociosas: ${pool.idleCount}, Aguardando: ${pool.waitingCount})`);
});

pool.on('acquire', (client) => {
  activeConnections++;
  idleConnections--;
  console.log(`🔵 Conexão adquirida (Ativas: ${activeConnections}, Ociosas: ${idleConnections}, Total: ${totalConnections})`);
});

pool.on('release', (client) => {
  activeConnections--;
  idleConnections++;
  console.log(`🟢 Conexão liberada (Ativas: ${activeConnections}, Ociosas: ${idleConnections})`);
});

pool.on('remove', (client) => {
  totalConnections--;
  console.log(`🗑️  Conexão removida do pool (Total restante: ${totalConnections})`);
});

pool.on('error', (err, client) => {
  console.error('❌ Erro na conexão com o banco de dados:', err);

  // Log específico para timeouts
  if (err.message.includes('timeout') || err.code === 'ECONNRESET') {
    console.error('⚠️  Timeout de conexão detectado. Verifique a latência de rede.');
  }
  
  // Log para conexões presas em transações
  if (err.message.includes('idle_in_transaction')) {
    console.error('⚠️  Transação ociosa detectada! Conexão será encerrada.');
  }
});

// Helper para executar queries com retry limitado
const queryWithRetry = async (text, params, maxRetries = 3) => {
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

      // ECONNREFUSED significa que o banco não está acessível - não adianta tentar novamente
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        console.error(`❌ Erro de conexão com banco de dados: ${error.message}`);
        console.error(`� Verifique: IP do banco, porta, firewall, e variáveis de ambiente`);
        throw error; // Falha imediatamente em erros de conexão
      }

      // Para timeouts temporários ou conexões resetadas, tenta novamente (máximo 3 vezes)
      const isRetryable = 
        error.message.includes('timeout') ||
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT';

      if (isRetryable && attempt < maxRetries) {
        const delay = Math.min(attempt * 1000, 5000); // Máximo 5 segundos
        console.warn(`⚠️  Tentativa ${attempt}/${maxRetries} falhou: ${error.message}`);
        console.warn(`🔄 Tentando novamente em ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      // Se não é retryable ou esgotou tentativas, falha
      if (attempt === maxRetries) {
        console.error(`❌ Falha após ${maxRetries} tentativas:`, error.message);
      } else {
        console.error(`❌ Erro não recuperável na query:`, error.message);
      }
      throw error;
    }
  }

  throw lastError;
};

// Manter referência original antes de substituir
const originalQuery = pool.query.bind(pool);
pool.query = queryWithRetry;

// Função para testar conexão com diagnóstico detalhado
export const testConnection = async () => {
  console.log('\n🔌 Testando conexão com banco de dados...');
  
  try {
    const startTime = Date.now();
    const result = await originalQuery.call(pool, 'SELECT NOW() as current_time, version() as pg_version');
    const duration = Date.now() - startTime;
    
    console.log('✅ Teste de conexão bem-sucedido!');
    console.log(`   Tempo de resposta: ${duration}ms`);
    console.log(`   Hora do servidor: ${result.rows[0].current_time}`);
    console.log(`   Versão PostgreSQL: ${result.rows[0].pg_version.split(' ')[0]}\n`);
    
    return true;
  } catch (error) {
    console.error('\n❌ FALHA NO TESTE DE CONEXÃO\n');
    console.error(`Erro: ${error.message}`);
    console.error(`Código: ${error.code || 'N/A'}`);
    
    // Diagnóstico específico
    if (error.code === 'ECONNREFUSED') {
      console.error('\n🔧 DIAGNÓSTICO:');
      console.error('   • O banco de dados não está respondendo na porta especificada');
      console.error('   • Verifique se o IP e porta estão corretos');
      console.error('   • Verifique se o firewall permite conexões');
      console.error('   • Verifique as variáveis de ambiente no Render\n');
    } else if (error.code === 'ENOTFOUND') {
      console.error('\n🔧 DIAGNÓSTICO:');
      console.error('   • O hostname do banco de dados não foi encontrado');
      console.error('   • Verifique a variável PGHOST\n');
    } else if (error.message.includes('password')) {
      console.error('\n🔧 DIAGNÓSTICO:');
      console.error('   • Erro de autenticação');
      console.error('   • Verifique usuário e senha (PGUSER, PGPASSWORD)\n');
    } else if (error.message.includes('timeout')) {
      console.error('\n🔧 DIAGNÓSTICO:');
      console.error('   • Timeout ao conectar');
      console.error('   • A rede pode estar lenta ou o banco sobrecarregado\n');
    }
    
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

// Health check da conexão com informações do pool
export const checkConnectionHealth = async () => {
  try {
    const result = await pool.query(
      'SELECT NOW() as time, version() as version',
    );
    
    // Consultar conexões ativas no banco
    const connectionsQuery = await pool.query(`
      SELECT 
        COUNT(*) as total_connections,
        COUNT(*) FILTER (WHERE state = 'active') as active_queries,
        COUNT(*) FILTER (WHERE state = 'idle') as idle_connections,
        COUNT(*) FILTER (WHERE state = 'idle in transaction') as idle_in_transaction
      FROM pg_stat_activity 
      WHERE datname = current_database()
        AND application_name = 'apigestaocrosby'
    `);
    
    const dbStats = connectionsQuery.rows[0];
    
    return {
      healthy: true,
      time: result.rows[0].time,
      version: result.rows[0].version,
      pool: {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
        max: pool.options.max,
      },
      database: {
        total_connections: parseInt(dbStats.total_connections),
        active_queries: parseInt(dbStats.active_queries),
        idle_connections: parseInt(dbStats.idle_connections),
        idle_in_transaction: parseInt(dbStats.idle_in_transaction),
      },
      warning: dbStats.idle_in_transaction > 0 ? 'Conexões presas em transações detectadas!' : null,
    };
  } catch (error) {
    return {
      healthy: false,
      error: error.message,
      pool: {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
        max: pool.options.max,
      },
    };
  }
};

// Função para monitorar e reportar status do pool periodicamente
export const startPoolMonitoring = (intervalMinutes = 5) => {
  setInterval(async () => {
    const health = await checkConnectionHealth();
    console.log('\n📊 ===== STATUS DO POOL DE CONEXÕES =====');
    console.log(`Pool: ${health.pool.total} total, ${health.pool.idle} ociosas, ${health.pool.waiting} aguardando`);
    console.log(`Banco: ${health.database?.total_connections} conexões, ${health.database?.active_queries} queries ativas`);
    if (health.database?.idle_in_transaction > 0) {
      console.log(`⚠️  ALERTA: ${health.database.idle_in_transaction} conexões presas em transações!`);
    }
    console.log('=========================================\n');
  }, intervalMinutes * 60 * 1000);
};

export default pool;