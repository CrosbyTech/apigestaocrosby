import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import morgan from 'morgan';
import dotenv from 'dotenv';

// Importar configurações
import { logger } from './utils/errorHandler.js';
import {
  startTokenScheduler,
  stopTokenScheduler,
} from './utils/totvsTokenManager.js';
import {
  startPesPessoaScheduler,
  stopPesPessoaScheduler,
} from './utils/syncPesPessoa.js';

// Importar middlewares
import { errorHandler } from './utils/errorHandler.js';
import { sanitizeInput } from './middlewares/validation.middleware.js';
import { requireApiKey } from './middlewares/auth.middleware.js';

// Importar rotas
import financialRoutes from './routes/financial.routes.js';
import salesRoutes from './routes/sales.routes.js';
import companyRoutes from './routes/company.routes.js';
import franchiseRoutes from './routes/franchise.routes.js';
import utilsRoutes from './routes/utils.routes.js';
import faturamentoRoutes from './routes/faturamento.routes.js';
import widgetsRoutes from './routes/widgets.routes.js';
import totvsRoutes from './routes/totvs.routes.js';
import chatRoutes from './routes/chat.routes.js';
import whatsappRoutes from './routes/whatsapp.routes.js';
import {
  initializeWhatsApp,
  client as whatsappClient,
} from './config/whatsapp.js';
// Carregar variáveis de ambiente
dotenv.config();

const app = express();

// Trust proxy (Render usa proxy reverso)
app.set('trust proxy', 1);

// =============================================================================
// CONFIGURAÇÕES DE SEGURANÇA E MIDDLEWARE
// =============================================================================

// Helmet para segurança básica
app.use(
  helmet({
    contentSecurityPolicy: false, // Desabilita CSP para APIs
  }),
);

// Rate limiting - muito permissivo para consultas grandes
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: process.env.NODE_ENV === 'production' ? 10000 : 50000, // Muito permissivo
  message: {
    error: 'RATE_LIMIT_EXCEEDED',
    message: 'Muitas requisições. Tente novamente em 15 minutos.',
    retryAfter: '15 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// CORS configurado para permitir qualquer origem
app.use(
  cors({
    origin: '*',
    credentials: false,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'x-api-key',
    ],
  }),
);

// Compressão de respostas
app.use(compression());

// Logging de requisições
if (process.env.NODE_ENV === 'production') {
  app.use(morgan('combined'));
} else {
  app.use(morgan('dev'));
}

// Parsing de JSON com limite de tamanho
app.use(
  express.json({
    limit: '10mb',
    strict: true,
  }),
);

// Parsing de URL encoded
app.use(
  express.urlencoded({
    extended: true,
    limit: '10mb',
  }),
);

// Sanitização global de entrada
app.use(sanitizeInput);

// Autenticação via API Key para todas as rotas /api/
app.use('/api/', requireApiKey);

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
    health: '/api/utils/health',
  });
});

// Rotas da API organizadas por módulos
app.use('/api/financial', financialRoutes); // Dados financeiros
app.use('/api/sales', salesRoutes); // Vendas e faturamento
app.use('/api/company', companyRoutes); // Empresas e lojas
app.use('/api/franchise', franchiseRoutes); // Franquias
app.use('/api/utils', utilsRoutes); // Utilitários e autocomplete
app.use('/api/faturamento', faturamentoRoutes); // Faturamento das lojas
app.use('/api/widgets', widgetsRoutes); // Widgets e dashboards (views e queries)
app.use('/api/totvs', totvsRoutes); // Integração com API TOTVS Moda
app.use('/api/chat', chatRoutes); // Chat IA para análise financeira
app.use('/api/whatsapp', whatsappRoutes); // WhatsApp direto via wwebjs
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
// PROXY PARA DOCUMENTOS DO SUPABASE STORAGE
// =============================================================================

app.get('/docs/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    // Validar que o filename é seguro (só letras, números, underline, hífen, ponto)
    if (!/^[a-zA-Z0-9_\-\.]+$/.test(filename)) {
      return res.status(400).json({ error: 'Nome de arquivo inválido' });
    }
    const supabaseUrl = `https://dorztqiunewggydvkjnf.supabase.co/storage/v1/object/public/clientes-confianca/notificacoes/${filename}`;
    const response = await fetch(supabaseUrl);
    if (!response.ok) {
      return res
        .status(response.status)
        .json({ error: 'Arquivo não encontrado' });
    }
    res.setHeader(
      'Content-Type',
      response.headers.get('content-type') || 'application/octet-stream',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar arquivo' });
  }
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
      authentication: 'Gerenciada externamente via Supabase',
    },
    Financeiro: {
      'GET /api/financial/extrato': 'Extrato bancário com filtros',

      'GET /api/financial/contas-pagar': 'Contas a pagar',
      'GET /api/financial/contas-receber': 'Contas a receber',
      'GET /api/financial/fluxo-caixa': 'Fluxo de caixa com múltiplas empresas',
    },
    Vendas: {
      'GET /api/sales/faturamento': 'Faturamento geral',
      'GET /api/sales/faturamento-franquia': 'Faturamento de franquias',
      'GET /api/sales/faturamento-mtm': 'Faturamento MTM',
      'GET /api/sales/faturamento-revenda': 'Faturamento de revenda',
      'GET /api/sales/ranking-vendedores': 'Ranking de vendedores',
    },
    Empresas: {
      'GET /api/company/empresas': 'Lista de empresas',
      'GET /api/company/grupo-empresas': 'Grupos de empresas',
      'GET /api/company/faturamento-lojas': 'Faturamento por lojas',
      'GET /api/company/expedicao': 'Dados de expedição',
      'GET /api/company/pcp': 'Dados de PCP',
    },
    Franquias: {
      'GET /api/franchise/consulta-fatura': 'Consultar faturas de franquias',

      'GET /api/franchise/franquias-credev': 'Franquias crédito/débito',
    },
    Utilitários: {
      'GET /api/utils/health': 'Health check da aplicação',
      'GET /api/utils/stats': 'Estatísticas do sistema',
      'GET /api/utils/autocomplete/nm_fantasia':
        'Autocomplete de nomes fantasia',
      'GET /api/utils/autocomplete/nm_grupoempresa':
        'Autocomplete de grupos empresa',
      'POST /api/utils/refresh-materialized-views':
        'Atualiza manualmente todas as views materializadas',
    },
    Nota: {
      Autenticação: 'Sistema de login gerenciado externamente via Supabase',
      Acesso: 'Todas as rotas são públicas - controle de acesso no frontend',
    },
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
    availableEndpoints: '/api/docs',
  });
});

// Middleware de tratamento de erros (deve ser o último)
app.use(errorHandler);

// =============================================================================
// INICIALIZAÇÃO DO SERVIDOR
// =============================================================================

const PORT = process.env.PORT || 4000;

// Variáveis para armazenar os schedulers
let totvsTokenTask = null;

// Graceful shutdown
const gracefulShutdown = (signal) => {
  logger.info(`Recebido sinal ${signal}. Encerrando servidor graciosamente...`);

  // Parar os schedulers
  // if (materializedViewsTask) {
  //   stopMaterializedViewsScheduler(materializedViewsTask);
  // }

  if (totvsTokenTask) {
    stopTokenScheduler(totvsTokenTask);
  }

  // Parar scheduler de sync pes_pessoa
  stopPesPessoaScheduler();

  // Destruir client WhatsApp
  try {
    whatsappClient.destroy();
  } catch (e) {
    // ignora se já destruído
  }

  server.close(() => {
    logger.info('Servidor HTTP fechado.');
    process.exit(0);
  });
};

const server = app.listen(PORT, async () => {
  // URL base da API (Render ou localhost)
  const API_BASE_URL =
    process.env.API_BASE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    `http://localhost:${PORT}`;

  logger.info(`🚀 Servidor rodando na porta ${PORT}`);
  logger.info(`🌐 URL da API: ${API_BASE_URL}`);
  logger.info(`📚 Documentação disponível em ${API_BASE_URL}/api/docs`);
  logger.info(`🏥 Health check em ${API_BASE_URL}/api/utils/health`);
  logger.info(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);

  // Logs das rotas TOTVS
  logger.info(`🔐 Rotas TOTVS disponíveis:`);
  logger.info(`   GET  ${API_BASE_URL}/api/totvs/token`);
  logger.info(`   POST ${API_BASE_URL}/api/totvs/auth`);
  logger.info(`   POST ${API_BASE_URL}/api/totvs/bank-slip`);

  // Remover timeout do servidor HTTP (ilimitado)
  server.timeout = 0; // Sem timeout para requisições
  server.keepAliveTimeout = 0; // Sem timeout para keep-alive
  server.headersTimeout = 0; // Sem timeout para headers
  logger.info('♾️  Timeouts do servidor removidos - requisições ilimitadas');

  // Iniciar o scheduler de geração automática de token TOTVS
  totvsTokenTask = startTokenScheduler();

  // Iniciar scheduler de sync pes_pessoa (diário às 03:00)
  startPesPessoaScheduler();

  // Inicializar WhatsApp client
  initializeWhatsApp();
  logger.info(`📱 WhatsApp QR: ${API_BASE_URL}/api/whatsapp/qr`);

  // Keep-alive: pingar a si mesmo a cada 14 minutos para evitar que o Render adormeça
  if (process.env.NODE_ENV === 'production') {
    const KEEP_ALIVE_INTERVAL = 14 * 60 * 1000; // 14 minutos
    const keepAliveUrl = `${API_BASE_URL}/api/utils/health`;
    setInterval(async () => {
      try {
        const resp = await fetch(keepAliveUrl);
        logger.info(`💓 Keep-alive ping: ${resp.status}`);
      } catch (err) {
        logger.warn(`⚠️ Keep-alive falhou: ${err.message}`);
      }
    }, KEEP_ALIVE_INTERVAL);
    logger.info(`💓 Keep-alive ativo: ping a cada 14min em ${keepAliveUrl}`);
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
