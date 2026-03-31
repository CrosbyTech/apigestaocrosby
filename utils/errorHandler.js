/**
 * Utilitários para tratamento de erros
 */

// Handler centralizado de erros
export const errorHandler = (err, req, res, next) => {
  const requestId = req.requestId || 'unknown';
  
  console.error(`❌ [${requestId}] Erro capturado:`, {
    message: err.message,
    code: err.code,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    url: req.url,
    method: req.method,
    path: err.path,
    duration: err.duration,
    timestamp: new Date().toISOString()
  });

  // Erro de validação do PostgreSQL (violação de chave única)
  if (err.code === '23505') {
    return res.status(409).json({
      success: false,
      message: 'Dados duplicados encontrados',
      error: 'DUPLICATE_ENTRY',
      requestId
    });
  }

  // Erro de violação de chave estrangeira
  if (err.code === '23503') {
    return res.status(400).json({
      success: false,
      message: 'Violação de integridade referencial',
      error: 'FOREIGN_KEY_VIOLATION',
      requestId
    });
  }

  // Erro de conexão com banco de dados
  if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
    return res.status(503).json({
      success: false,
      message: 'Erro de conexão com o banco de dados',
      error: 'DATABASE_CONNECTION_ERROR',
      requestId
    });
  }

  // Erro de timeout de query (configurado em 60s)
  if (err.message && err.message.includes('statement timeout')) {
    console.error(`⚠️  [${requestId}] Query timeout após 60 segundos em ${req.path}`);
    return res.status(504).json({
      success: false,
      message: 'Query excedeu o tempo limite de 60 segundos',
      error: 'QUERY_TIMEOUT',
      hint: 'Considere adicionar filtros ou reduzir o período consultado',
      requestId
    });
  }

  // Erro de transação ociosa (configurado em 10s)
  if (err.message && err.message.includes('idle_in_transaction_session_timeout')) {
    console.error(`⚠️  [${requestId}] Transação ociosa detectada e finalizada após 10 segundos`);
    return res.status(500).json({
      success: false,
      message: 'Transação interrompida por inatividade',
      error: 'IDLE_TRANSACTION_TIMEOUT',
      requestId
    });
  }

  // Erro de timeout de conexão
  if (err.code === 'ETIMEDOUT' || err.message.includes('timeout')) {
    console.error(`⚠️  [${requestId}] Timeout de conexão detectado`);
    return res.status(504).json({
      success: false,
      message: 'Timeout na operação',
      error: 'CONNECTION_TIMEOUT',
      requestId
    });
  }

  // Erro de pool esgotado (todas as conexões em uso)
  if (err.message && err.message.includes('Connection terminated')) {
    console.error(`⚠️  [${requestId}] Conexão terminada inesperadamente`);
    return res.status(503).json({
      success: false,
      message: 'Conexão com banco de dados perdida',
      error: 'CONNECTION_TERMINATED',
      requestId
    });
  }

  // Erro padrão
  const statusCode = err.status || err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || 'Erro interno do servidor',
    error: err.code || 'INTERNAL_SERVER_ERROR',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    requestId,
    timestamp: new Date().toISOString()
  });
};

// Wrapper para async functions com tratamento melhorado e rastreamento
export const asyncHandler = (fn) => {
  return async (req, res, next) => {
    const startTime = Date.now();
    const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Adicionar ID da requisição ao request
    req.requestId = requestId;
    
    try {
      // Log de entrada
      console.log(`🔵 [${requestId}] ${req.method} ${req.path} - Iniciado`);
      
      // Executar a função async
      await Promise.resolve(fn(req, res, next));
      
      // Log de sucesso (apenas se a resposta ainda não foi enviada)
      if (!res.headersSent) {
        const duration = Date.now() - startTime;
        console.log(`✅ [${requestId}] ${req.method} ${req.path} - Concluído em ${duration}ms`);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ [${requestId}] ${req.method} ${req.path} - Erro após ${duration}ms:`, error.message);
      
      // Adicionar contexto ao erro
      error.requestId = requestId;
      error.path = req.path;
      error.method = req.method;
      error.duration = duration;
      
      // Passar para o middleware de erro
      next(error);
    } finally {
      // Sempre executado, independente de sucesso ou erro
      const duration = Date.now() - startTime;
      
      // Log de finalização
      if (duration > 5000) {
        console.warn(`⚠️  [${requestId}] Query lenta detectada: ${duration}ms em ${req.method} ${req.path}`);
      }
    }
  };
};

// Resposta de sucesso padronizada
export const successResponse = (res, data, message = 'Operação realizada com sucesso', statusCode = 200) => {
  res.status(statusCode).json({
    success: true,
    message,
    data,
    timestamp: new Date().toISOString()
  });
};

// Resposta de erro padronizada
export const errorResponse = (res, message, statusCode = 500, errorCode = 'INTERNAL_ERROR', details = null) => {
  res.status(statusCode).json({
    success: false,
    message,
    error: errorCode,
    details,
    timestamp: new Date().toISOString()
  });
};

// Helper para executar queries com tratamento de erro e retry
export const executeQuery = async (pool, query, params = [], options = {}) => {
  const {
    maxRetries = 2,
    retryDelay = 1000,
    queryName = 'Query',
    logQuery = false
  } = options;
  
  let lastError;
  const startTime = Date.now();
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (logQuery) {
        console.log(`🔍 [${queryName}] Tentativa ${attempt}/${maxRetries}`);
        if (process.env.NODE_ENV === 'development') {
          console.log('Query:', query);
          console.log('Params:', params);
        }
      }
      
      const result = await pool.query(query, params);
      
      const duration = Date.now() - startTime;
      if (attempt > 1) {
        console.log(`✅ [${queryName}] Sucesso na tentativa ${attempt} após ${duration}ms`);
      } else if (duration > 3000) {
        console.log(`⚠️  [${queryName}] Query lenta: ${duration}ms`);
      }
      
      return result;
    } catch (error) {
      lastError = error;
      const duration = Date.now() - startTime;
      
      // Se é um erro de timeout ou conexão temporária, tenta novamente
      const isRetryable = 
        error.message.includes('timeout') ||
        error.message.includes('Connection terminated') ||
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT';
      
      if (isRetryable && attempt < maxRetries) {
        console.warn(`⚠️  [${queryName}] Erro na tentativa ${attempt}: ${error.message}`);
        console.warn(`🔄 Tentando novamente em ${retryDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
        continue;
      }
      
      // Se não é retryable ou esgotou tentativas, lança o erro
      console.error(`❌ [${queryName}] Falha após ${attempt} tentativas e ${duration}ms:`, error.message);
      throw error;
    }
  }
  
  throw lastError;
};

// Logger personalizado
export const logger = {
  info: (message, data = {}) => {
    console.log(JSON.stringify({
      level: 'INFO',
      message,
      data,
      timestamp: new Date().toISOString()
    }));
  },
  
  error: (message, error = {}) => {
    console.error(JSON.stringify({
      level: 'ERROR',
      message,
      error: {
        message: error.message,
        stack: error.stack,
        code: error.code
      },
      timestamp: new Date().toISOString()
    }));
  },
  
  warn: (message, data = {}) => {
    console.warn(JSON.stringify({
      level: 'WARN',
      message,
      data,
      timestamp: new Date().toISOString()
    }));
  }
};