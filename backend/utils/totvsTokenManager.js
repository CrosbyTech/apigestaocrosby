import cron from 'node-cron';
import axios from 'axios';
import { logger } from './errorHandler.js';

// URL da API TOTVS Moda
const TOTVS_AUTH_ENDPOINT = 
  process.env.TOTVS_AUTH_ENDPOINT || 
  'https://www30.bhan.com.br:9443/api/totvsmoda/authorization/v2/token';

// Credenciais padrão (podem ser sobrescritas via variáveis de ambiente)
const TOTVS_CREDENTIALS = {
  grant_type: 'password',
  client_id: process.env.TOTVS_CLIENT_ID || 'crosbyapiv2',
  client_secret: process.env.TOTVS_CLIENT_SECRET || '5955950459',
  username: process.env.TOTVS_USERNAME || 'APINOVA',
  password: process.env.TOTVS_PASSWORD || '123456',
};

// Armazenamento do token em memória
let currentToken = null;
let tokenExpiresAt = null;

/**
 * Gera um novo token de autenticação na API TOTVS
 * @returns {Promise<Object>} Token e informações relacionadas
 */
export const generateToken = async () => {
  try {
    logger.info('🔐 Gerando novo token TOTVS...');

    // Preparar payload conforme formato esperado pela API
    const formData = new URLSearchParams();
    formData.append('Grant_type', TOTVS_CREDENTIALS.grant_type);
    formData.append('Client_id', TOTVS_CREDENTIALS.client_id);
    formData.append('Client_secret', TOTVS_CREDENTIALS.client_secret);
    formData.append('Username', TOTVS_CREDENTIALS.username);
    formData.append('Password', TOTVS_CREDENTIALS.password);
    formData.append('Branch', '');
    formData.append('Mfa_totvs', '');
    formData.append('ValidationResult.IsValid', '');
    formData.append('Refresh_token', '');

    const response = await axios.post(
      TOTVS_AUTH_ENDPOINT,
      formData.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        timeout: 30000,
      }
    );

    const tokenData = {
      access_token: response.data.access_token,
      token_type: response.data.token_type,
      expires_in: response.data.expires_in,
      refresh_token: response.data.refresh_token,
      ...response.data,
    };

    // Armazenar token e calcular tempo de expiração
    currentToken = tokenData;
    tokenExpiresAt = new Date(Date.now() + (tokenData.expires_in * 1000));

    logger.info('✅ Token TOTVS gerado com sucesso');
    logger.info(`   Token expira em: ${tokenExpiresAt.toLocaleString('pt-BR', { 
      timeZone: 'America/Sao_Paulo',
      dateStyle: 'short',
      timeStyle: 'medium' 
    })}`);

    return tokenData;
  } catch (error) {
    logger.error('❌ Erro ao gerar token TOTVS:', {
      message: error.message,
      code: error.code,
      response: error.response?.data,
      status: error.response?.status,
    });

    // Limpar token atual em caso de erro
    currentToken = null;
    tokenExpiresAt = null;

    throw error;
  }
};

/**
 * Obtém o token atual (se válido) ou gera um novo
 * @param {boolean} forceNew - Força a geração de um novo token mesmo se já existir um válido
 * @returns {Promise<Object>} Token atual
 */
export const getToken = async (forceNew = false) => {
  // Verificar se existe um token válido
  if (!forceNew && currentToken && tokenExpiresAt) {
    const now = new Date();
    const timeUntilExpiry = tokenExpiresAt.getTime() - now.getTime();

    // Se o token ainda é válido (com margem de 5 minutos de segurança)
    if (timeUntilExpiry > 5 * 60 * 1000) {
      logger.info('🔑 Usando token TOTVS existente (ainda válido)');
      return currentToken;
    } else {
      logger.info('⏰ Token TOTVS expirado ou próximo do vencimento. Gerando novo...');
    }
  }

  // Gerar novo token
  return await generateToken();
};

/**
 * Retorna informações sobre o token atual sem gerar novo
 * @returns {Object|null} Informações do token ou null se não existir
 */
export const getTokenInfo = () => {
  if (!currentToken || !tokenExpiresAt) {
    return null;
  }

  const now = new Date();
  const timeUntilExpiry = tokenExpiresAt.getTime() - now.getTime();
  const isExpired = timeUntilExpiry <= 0;

  return {
    access_token: currentToken.access_token,
    token_type: currentToken.token_type,
    expires_in: Math.floor(timeUntilExpiry / 1000),
    refresh_token: currentToken.refresh_token,
    expires_at: tokenExpiresAt.toISOString(),
    is_expired: isExpired,
    is_valid: !isExpired && timeUntilExpiry > 5 * 60 * 1000, // Válido se não expirado e com mais de 5 min restantes
  };
};

/**
 * Inicia o agendamento automático de geração de token
 * Executa às 00:00, 06:00, 12:00 e 18:00 (a cada 6 horas)
 */
export const startTokenScheduler = () => {
  // Cron expression: '0 0,6,12,18 * * *' significa:
  // Minuto: 0
  // Hora: 0,6,12,18 (meia-noite, 6h, meio-dia, 18h)
  // Dia do mês: * (todos os dias)
  // Mês: * (todos os meses)
  // Dia da semana: * (todos os dias da semana)
  
  const cronExpression = '0 0,6,12,18 * * *';
  
  const task = cron.schedule(cronExpression, async () => {
    const now = new Date();
    const timestamp = now.toLocaleString('pt-BR', { 
      timeZone: 'America/Sao_Paulo',
      dateStyle: 'short',
      timeStyle: 'medium'
    });
    
    logger.info(`🔐 ========================================`);
    logger.info(`🔐 Geração automática de token TOTVS: ${timestamp}`);
    logger.info(`🔐 ========================================`);
    
    try {
      await generateToken();
      logger.info(`🔐 ========================================`);
    } catch (error) {
      logger.error('🔐 Erro na geração automática de token:', error.message);
    }
  }, {
    scheduled: true,
    timezone: 'America/Sao_Paulo' // Timezone de Brasília
  });

  task.start();

  logger.info('🔐 ========================================');
  logger.info('🔐 Scheduler de token TOTVS INICIADO');
  logger.info('🔐 Agendamento: A cada 6 horas');
  logger.info('🔐 Horários de execução:');
  logger.info('🔐   00:00, 06:00, 12:00, 18:00');
  logger.info('🔐 Timezone: America/Sao_Paulo (Brasília)');
  logger.info('🔐 ========================================');

  // Calcular próxima execução
  const now = new Date();
  const nextRun = new Date(now);
  const currentHour = now.getHours();
  
  // Encontrar o próximo horário agendado (00, 06, 12, 18)
  const scheduledHours = [0, 6, 12, 18];
  let nextHour = scheduledHours.find(h => h > currentHour) || scheduledHours[0];
  
  if (nextHour <= currentHour) {
    // Se já passou o último horário do dia, agendar para 00:00 do dia seguinte
    nextRun.setDate(nextRun.getDate() + 1);
    nextHour = 0;
  }
  
  nextRun.setHours(nextHour);
  nextRun.setMinutes(0);
  nextRun.setSeconds(0);
  nextRun.setMilliseconds(0);
  
  const nextRunFormatted = nextRun.toLocaleString('pt-BR', { 
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'medium'
  });
  
  logger.info(`🔐 Próxima execução agendada para: ${nextRunFormatted}`);
  logger.info('🔐 ========================================');

  // Gerar token imediatamente na inicialização
  logger.info('🔐 Gerando token inicial...');
  generateToken().catch(error => {
    logger.error('🔐 Erro ao gerar token inicial:', error.message);
  });

  return task;
};

/**
 * Para o agendamento automático
 * @param {Object} task - Tarefa cron para parar
 */
export const stopTokenScheduler = (task) => {
  if (task) {
    task.stop();
    logger.info('⏸️  Scheduler de token TOTVS PARADO');
  }
};

