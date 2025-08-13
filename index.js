import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import morgan from 'morgan';
import dotenv from 'dotenv';

// Importar configurações
import pool, { testConnection, closePool } from './config/database.js';
import { logger } from './utils/errorHandler.js';

// Importar middlewares
import { errorHandler } from './utils/errorHandler.js';
import { sanitizeInput } from './middlewares/validation.middleware.js';

// Importar rotas
import financialRoutes from './routes/financial.routes.js';
import salesRoutes from './routes/sales.routes.js';
import companyRoutes from './routes/company.routes.js';
import franchiseRoutes from './routes/franchise.routes.js';
import utilsRoutes from './routes/utils.routes.js';

// Carregar variáveis de ambiente
dotenv.config();

const app = express();

// =============================================================================
// CONFIGURAÇÕES DE SEGURANÇA E MIDDLEWARE
// =============================================================================

// Configurar trust proxy para Render (proxies reversos)
app.set('trust proxy', true);

// Helmet para segurança básica
app.use(helmet({
  contentSecurityPolicy: false // Desabilita CSP para APIs
}));

// Rate limiting otimizado para proxies (Render)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: process.env.NODE_ENV === 'production' ? 10000 : 50000, // Muito permissivo
  message: {
    error: 'RATE_LIMIT_EXCEEDED',
    message: 'Muitas requisições. Tente novamente em 15 minutos.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Configuração específica para proxies reversos
  trustProxy: true,
  skip: (req) => {
    // Skip para requests de health check
    return req.path === '/api/utils/health' || req.path === '/';
  }
});
app.use('/api/', limiter);

// CORS configurado para permitir qualquer origem
app.use(cors({
  origin: '*',
  credentials: false,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin']
}));

// Middleware manual para garantir CORS em todas as requisições
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With,Accept,Origin');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});

// Compressão de respostas
app.use(compression());

// Logging de requisições
if (process.env.NODE_ENV === 'production') {
  app.use(morgan('combined'));
} else {
  app.use(morgan('dev'));
}

// Parsing de JSON com limite de tamanho
app.use(express.json({ 
  limit: '10mb',
  strict: true 
}));

// Parsing de URL encoded
app.use(express.urlencoded({ 
  extended: true, 
  limit: '10mb' 
}));

// Sanitização global de entrada
app.use(sanitizeInput);

// =============================================================================
// ROTAS DA API
// =============================================================================

// Rota de boas-vindas
app.get('/', (req, res) => {
  res.json({
    message: 'API de Gestão Crosby',
    version: '2.0.0',
    status: 'online',
    timestamp: new Date().toISOString(),
    docs: '/api/docs',
    health: '/api/utils/health'
  });
});

// Rotas da API organizadas por módulos
app.use('/api/financial', financialRoutes); // Dados financeiros
app.use('/api/sales', salesRoutes);         // Vendas e faturamento
app.use('/api/company', companyRoutes);     // Empresas e lojas
app.use('/api/franchise', franchiseRoutes); // Franquias
app.use('/api/utils', utilsRoutes);         // Utilitários e autocomplete

// =============================================================================
// ROTAS DE COMPATIBILIDADE (MANTER TEMPORARIAMENTE)
// =============================================================================

// Rotas de compatibilidade (versão anterior)
app.get('/extrato', (req, res) => {
  res.redirect(308, '/api/financial/extrato');
});

app.get('/faturamento', (req, res) => {
  res.redirect(308, '/api/sales/faturamento');
});

app.get('/empresas', (req, res) => {
  res.redirect(308, '/api/company/empresas');
});

// =============================================================================
// DOCUMENTAÇÃO SIMPLES DAS ROTAS
// =============================================================================

app.get('/api/docs', (req, res) => {
  const routes = {
    'API de Gestão Crosby': {
      version: '2.1.0',
      description: 'API para sistema de gestão - Autenticação via Supabase',
      baseURL: '/api',
      authentication: 'Gerenciada externamente via Supabase'
    },
    'Financeiro': {
      'GET /api/financial/extrato': 'Extrato bancário com filtros',
      'GET /api/financial/extrato-totvs': 'Extrato TOTVS',
      'GET /api/financial/contas-pagar': 'Contas a pagar',
      'GET /api/financial/contas-receber': 'Contas a receber',
      'GET /api/financial/saldo-conta': 'Saldo de conta bancária'
    },
    'Vendas': {
      'GET /api/sales/faturamento': 'Faturamento geral',
      'GET /api/sales/faturamento-franquia': 'Faturamento de franquias',
      'GET /api/sales/faturamento-mtm': 'Faturamento MTM',
      'GET /api/sales/faturamento-revenda': 'Faturamento de revenda',
      'GET /api/sales/ranking-vendedores': 'Ranking de vendedores'
    },
    'Empresas': {
      'GET /api/company/empresas': 'Lista de empresas',
      'GET /api/company/grupo-empresas': 'Grupos de empresas',
      'GET /api/company/faturamento-lojas': 'Faturamento por lojas',
      'GET /api/company/expedicao': 'Dados de expedição',
      'GET /api/company/pcp': 'Dados de PCP'
    },
    'Franquias': {
      'GET /api/franchise/consulta-fatura': 'Consultar faturas de franquias',
      'GET /api/franchise/fundo-propaganda': 'Fundo de propaganda',
      'GET /api/franchise/franquias-credev': 'Franquias crédito/débito'
    },
    'Utilitários': {
      'GET /api/utils/health': 'Health check da aplicação',
      'GET /api/utils/stats': 'Estatísticas do sistema',
      'GET /api/utils/autocomplete/nm_fantasia': 'Autocomplete de nomes fantasia',
      'GET /api/utils/autocomplete/nm_grupoempresa': 'Autocomplete de grupos empresa'
    },
    'Nota': {
      'Autenticação': 'Sistema de login gerenciado externamente via Supabase',
      'Acesso': 'Todas as rotas são públicas - controle de acesso no frontend'
    }
  };

  res.json(routes);
});

// =============================================================================
// TRATAMENTO DE ERROS E ROTAS INEXISTENTES
// =============================================================================

// Rota não encontrada
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'ROUTE_NOT_FOUND',
    message: 'Rota não encontrada',
    path: req.originalUrl,
    method: req.method,
    availableEndpoints: '/api/docs'
  });
});

// Middleware de tratamento de erros (deve ser o último)
app.use(errorHandler);

// =============================================================================
// INICIALIZAÇÃO DO SERVIDOR
// =============================================================================

const PORT = process.env.PORT || 4000;

// Graceful shutdown
const gracefulShutdown = (signal) => {
  logger.info(`Recebido sinal ${signal}. Encerrando servidor graciosamente...`);
  
  server.close(async () => {
    logger.info('Servidor HTTP fechado.');
    
    try {
      await closePool();
      logger.info('Pool de conexões do banco fechado.');
      process.exit(0);
    } catch (error) {
      logger.error('Erro ao fechar pool de conexões:', error);
      process.exit(1);
    }
  });
};

const server = app.listen(PORT, async () => {
  logger.info(`🚀 Servidor rodando na porta ${PORT}`);
  logger.info(`📚 Documentação disponível em http://localhost:${PORT}/api/docs`);
  logger.info(`🏥 Health check em http://localhost:${PORT}/api/utils/health`);
  logger.info(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
  
  // Configurações do servidor HTTP com timeout de 1 hora
  server.timeout = 3600000; // 1 hora timeout para requisições
  server.keepAliveTimeout = 65000; // 65 segundos para keep-alive
  server.headersTimeout = 66000; // 66 segundos para headers
  logger.info('⚙️  Timeouts do servidor configurados para 1 hora');
  
  // Testar conexão com banco de dados na inicialização
  const dbConnected = await testConnection();
  if (dbConnected) {
    logger.info('🗄️  Banco de dados conectado com sucesso');
  } else {
    logger.error('❌ Falha na conexão com banco de dados');
  }
});

// Handlers para encerramento gracioso
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handler para uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// Handler para unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

export default app;