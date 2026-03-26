/**
 * Middleware de autenticação via API Key
 *
 * Valida o header x-api-key em todas as requisições à API.
 * A chave deve ser configurada na variável de ambiente API_KEY no Render.
 */

const API_KEY = process.env.API_KEY;

export const requireApiKey = (req, res, next) => {
  // Permitir requisições OPTIONS (CORS preflight)
  if (req.method === 'OPTIONS') {
    return next();
  }

  // Se API_KEY não estiver configurada no ambiente, bloqueia tudo (fail-secure)
  if (!API_KEY) {
    console.error(
      '🔒 API_KEY não configurada no ambiente. Todas as requisições serão bloqueadas.',
    );
    return res.status(500).json({
      success: false,
      message: 'Servidor mal configurado: chave de API não definida',
      error: 'API_KEY_NOT_CONFIGURED',
    });
  }

  const clientKey = req.headers['x-api-key'];

  if (!clientKey) {
    return res.status(401).json({
      success: false,
      message: 'Acesso não autorizado. Header x-api-key é obrigatório.',
      error: 'MISSING_API_KEY',
    });
  }

  // Comparação em tempo constante para evitar timing attacks
  if (clientKey.length !== API_KEY.length || clientKey !== API_KEY) {
    return res.status(403).json({
      success: false,
      message: 'Chave de API inválida.',
      error: 'INVALID_API_KEY',
    });
  }

  next();
};
