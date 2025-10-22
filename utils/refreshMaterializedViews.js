import cron from 'node-cron';
import pool from '../config/database.js';
import { logger } from './errorHandler.js';

// Lista de views materializadas que precisam ser atualizadas
const MATERIALIZED_VIEWS = [
  'public.fatbazar',
  'public.fatvarejo',
  'public.fatrevenda',
  'public.fatfranquias',
  'public.fatmtm',
  'public.fatsellect',
  'public.cmv_varejo',
  'public.cmv_revenda',
  'public.cmv_mtm',
  'public.cmv_franquias',
];

/**
 * Atualiza uma view materializada específica
 * @param {string} viewName - Nome da view materializada
 * @returns {Promise<boolean>} - True se atualizada com sucesso
 */
const refreshView = async (viewName) => {
  const startTime = Date.now();
  
  try {
    logger.info(`🔄 Iniciando atualização da view: ${viewName}`);
    
    await pool.query(`REFRESH MATERIALIZED VIEW ${viewName}`);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.info(`✅ View ${viewName} atualizada com sucesso em ${duration}s`);
    
    return true;
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.error(`❌ Erro ao atualizar view ${viewName} após ${duration}s:`, error.message);
    return false;
  }
};

/**
 * Atualiza todas as views materializadas
 * @returns {Promise<Object>} - Resultado da atualização
 */
export const refreshAllMaterializedViews = async () => {
  const startTime = Date.now();
  const results = {
    total: MATERIALIZED_VIEWS.length,
    success: 0,
    failed: 0,
    views: [],
  };

  logger.info('🚀 ========================================');
  logger.info(`🚀 Iniciando atualização de ${MATERIALIZED_VIEWS.length} views materializadas`);
  logger.info('🚀 ========================================');

  for (const viewName of MATERIALIZED_VIEWS) {
    const success = await refreshView(viewName);
    
    results.views.push({
      name: viewName,
      success: success,
    });

    if (success) {
      results.success++;
    } else {
      results.failed++;
    }
  }

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
  
  logger.info('📊 ========================================');
  logger.info(`📊 Atualização concluída em ${totalDuration}s`);
  logger.info(`📊 Sucesso: ${results.success}/${results.total}`);
  logger.info(`📊 Falhas: ${results.failed}/${results.total}`);
  logger.info('📊 ========================================');

  return results;
};

/**
 * Inicia o agendamento automático das atualizações
 * Executa sempre aos 5 minutos de cada hora (00:05, 01:05, 02:05, etc.)
 */
export const startMaterializedViewsScheduler = () => {
  // Cron expression: '5 * * * *' significa aos 5 minutos de cada hora
  // Minuto: 5
  // Hora: * (todas as horas)
  // Dia do mês: * (todos os dias)
  // Mês: * (todos os meses)
  // Dia da semana: * (todos os dias da semana)
  
  const cronExpression = '5 * * * *';
  
  const task = cron.schedule(cronExpression, async () => {
    const now = new Date();
    const timestamp = now.toLocaleString('pt-BR', { 
      timeZone: 'America/Sao_Paulo',
      dateStyle: 'short',
      timeStyle: 'medium'
    });
    
    logger.info(`⏰ ========================================`);
    logger.info(`⏰ Trigger de atualização automática: ${timestamp}`);
    logger.info(`⏰ ========================================`);
    
    await refreshAllMaterializedViews();
  }, {
    scheduled: true,
    timezone: 'America/Sao_Paulo' // Timezone de Brasília
  });

  task.start();

  logger.info('⏰ ========================================');
  logger.info('⏰ Scheduler de views materializadas INICIADO');
  logger.info('⏰ Agendamento: A cada hora aos 5 minutos');
  logger.info('⏰ Horários de execução:');
  logger.info('⏰   00:05, 01:05, 02:05, 03:05, 04:05, 05:05');
  logger.info('⏰   06:05, 07:05, 08:05, 09:05, 10:05, 11:05');
  logger.info('⏰   12:05, 13:05, 14:05, 15:05, 16:05, 17:05');
  logger.info('⏰   18:05, 19:05, 20:05, 21:05, 22:05, 23:05');
  logger.info('⏰ Timezone: America/Sao_Paulo (Brasília)');
  logger.info('⏰ ========================================');

  // Calcular próxima execução
  const now = new Date();
  const nextRun = new Date(now);
  nextRun.setMinutes(5);
  nextRun.setSeconds(0);
  nextRun.setMilliseconds(0);
  
  if (nextRun <= now) {
    nextRun.setHours(nextRun.getHours() + 1);
  }
  
  const nextRunFormatted = nextRun.toLocaleString('pt-BR', { 
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'medium'
  });
  
  logger.info(`⏰ Próxima execução agendada para: ${nextRunFormatted}`);
  logger.info('⏰ ========================================');

  return task;
};

/**
 * Para o agendamento automático
 * @param {Object} task - Tarefa cron para parar
 */
export const stopMaterializedViewsScheduler = (task) => {
  if (task) {
    task.stop();
    logger.info('⏸️  Scheduler de views materializadas PARADO');
  }
};

