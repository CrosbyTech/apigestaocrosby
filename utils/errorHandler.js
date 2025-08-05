/**
 * Utilitários para tratamento de erros
 */

// Handler centralizado de erros
export const errorHandler = (err, req, res, next) => {
  console.error('Erro capturado:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    timestamp: new Date().toISOString()
  });

  // Erro de validação do PostgreSQL
  if (err.code === '23505') {
    return res.status(409).json({
      message: 'Dados duplicados encontrados',
      error: 'DUPLICATE_ENTRY'
    });
  }

  // Erro de conexão com banco de dados
  if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
    return res.status(503).json({
      message: 'Erro de conexão com o banco de dados',
      error: 'DATABASE_CONNECTION_ERROR'
    });
  }

  // Erro de timeout (não deveria acontecer mais)
  if (err.code === 'ETIMEDOUT') {
    console.log('⚠️  Timeout detectado mesmo com configuração ilimitada');
    return res.status(504).json({
      message: 'Timeout na operação (investigar configuração)',
      error: 'UNEXPECTED_TIMEOUT_ERROR'
    });
  }

  // Erro padrão
  res.status(err.status || 500).json({
    message: err.message || 'Erro interno do servidor',
    error: process.env.NODE_ENV === 'development' ? err.stack : 'INTERNAL_SERVER_ERROR'
  });
};

// Wrapper para async functions
export const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
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
export const errorResponse = (res, message, statusCode = 500, errorCode = 'INTERNAL_ERROR') => {
  res.status(statusCode).json({
    success: false,
    message,
    error: errorCode,
    timestamp: new Date().toISOString()
  });
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