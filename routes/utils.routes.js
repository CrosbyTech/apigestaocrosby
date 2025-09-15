import express from 'express';
import axios from 'axios';
import pool from '../config/database.js';
import { sanitizeInput, validateRequired, validateDateFormat, validatePagination } from '../middlewares/validation.middleware.js';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';

const router = express.Router();

/**
 * @route GET /utils/external-test
 * @desc Testar consumo de API externa (apenas para desenvolvimento)
 * @access Public
 */
router.get('/external-test',
  asyncHandler(async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
      return errorResponse(res, 'Endpoint disponível apenas em desenvolvimento', 403, 'FORBIDDEN');
    }

    try {
      const response = await axios.get('https://jsonplaceholder.typicode.com/todos/1', {
        timeout: 5000 // 5 segundos de timeout
      });
      
      successResponse(res, {
        source: 'https://jsonplaceholder.typicode.com',
        data: response.data
      }, 'API externa consultada com sucesso');
    } catch (error) {
      throw new Error(`Erro ao buscar dados externos: ${error.message}`);
    }
  })
);

/**
 * @route GET /utils/autocomplete/nm_fantasia
 * @desc Autocomplete para nomes fantasia de franquias
 * @access Public
 * @query {q} - termo de busca (mínimo 1 caractere)
 */
router.get('/autocomplete/nm_fantasia',
  sanitizeInput,
  asyncHandler(async (req, res) => {
    const { q } = req.query;
    
    if (!q || q.length < 1) {
      return successResponse(res, [], 'Termo de busca muito curto');
    }

    const query = `
      SELECT DISTINCT nm_fantasia
      FROM pes_pesjuridica
      WHERE nm_fantasia ILIKE 'F%CROSBY%' 
        AND nm_fantasia ILIKE $1
      ORDER BY nm_fantasia ASC
      LIMIT 100
    `;
    
    const { rows } = await pool.query(query, [`%${q}%`]);
    const suggestions = rows.map(r => r.nm_fantasia);

    successResponse(res, suggestions, 'Sugestões de nomes fantasia obtidas com sucesso');
  })
);

/**
 * @route GET /utils/autocomplete/nm_grupoempresa
 * @desc Autocomplete para nomes de grupos de empresa
 * @access Public
 * @query {q} - termo de busca (mínimo 1 caractere)
 */
router.get('/autocomplete/nm_grupoempresa',
  sanitizeInput,
  asyncHandler(async (req, res) => {
    const { q } = req.query;
    
    if (!q || q.length < 1) {
      return successResponse(res, [], 'Termo de busca muito curto');
    }

    const query = `
      SELECT DISTINCT cd_empresa, nm_grupoempresa
      FROM vr_ger_empresa
      WHERE nm_grupoempresa ILIKE $1 
        AND cd_grupoempresa < 5999
      ORDER BY nm_grupoempresa ASC
      LIMIT 100
    `;
    
    const { rows } = await pool.query(query, [`%${q}%`]);

    successResponse(res, rows, 'Sugestões de grupos de empresa obtidas com sucesso');
  })
);

/**
 * @route GET /utils/health
 * @desc Health check da aplicação
 * @access Public
 */
router.get('/health', 
  asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const healthCheck = {
      status: 'OK',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      version: process.env.npm_package_version || '2.1.0',
      startTime
    };

    // Testar conexão com banco de dados SEM timeout
    try {
      console.log('🔍 Testando conexão com banco de dados...');
      const result = await pool.query('SELECT NOW() as current_time, version() as version, current_database() as database');
      
      healthCheck.database = {
        status: 'Connected',
        responseTime: `${Date.now() - healthCheck.startTime}ms`,
        serverTime: result.rows[0].current_time,
        database: result.rows[0].database,
        version: result.rows[0].version.split(' ')[0] + ' ' + result.rows[0].version.split(' ')[1],
        message: 'Conexão sem timeout - ilimitada'
      };
      console.log('✅ Conexão com banco bem-sucedida');
    } catch (error) {
      console.error('❌ Erro na conexão com banco:', error.message);
      healthCheck.database = {
        status: 'Disconnected',
        error: error.message,
        message: 'Falha na conexão mesmo sem timeout'
      };
      healthCheck.status = 'ERROR';
    }

    // Testar uso de memória
    const memUsage = process.memoryUsage();
    healthCheck.memory = {
      rss: `${Math.round(memUsage.rss / 1024 / 1024)} MB`,
      heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)} MB`,
      heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)} MB`
    };

    const statusCode = healthCheck.status === 'OK' ? 200 : 503;
    res.status(statusCode).json(healthCheck);
  })
);

/**
 * @route GET /utils/stats
 * @desc Estatísticas básicas do sistema
 * @access Public - ADM only
 */
router.get('/stats',
  asyncHandler(async (req, res) => {

    try {
      // Buscar algumas estatísticas básicas
      const queries = [
        { name: 'total_empresas', query: 'SELECT COUNT(*) as count FROM vr_ger_empresa WHERE cd_grupoempresa < 5999' },
        { name: 'total_franquias', query: "SELECT COUNT(DISTINCT nm_fantasia) as count FROM pes_pesjuridica WHERE nm_fantasia LIKE 'F%CROSBY%'" },
        { name: 'conexoes_ativas', query: 'SELECT count(*) as count FROM pg_stat_activity WHERE state = \'active\'' }
      ];

      const results = await Promise.all(
        queries.map(async ({ name, query }) => {
          try {
            const result = await pool.query(query);
            return { [name]: parseInt(result.rows[0].count, 10) };
          } catch (error) {
            return { [name]: 'Erro' };
          }
        })
      );

      const stats = results.reduce((acc, curr) => ({ ...acc, ...curr }), {});

      successResponse(res, {
        timestamp: new Date().toISOString(),
        ...stats
      }, 'Estatísticas do sistema obtidas com sucesso');

    } catch (error) {
      throw new Error(`Erro ao obter estatísticas: ${error.message}`);
    }
  })
);

/**
 * @route GET /utils/cadastropessoa
 * @desc Consulta de clientes e suas classificações, paginada e indexável
 * @access Public
 * @query {dt_inicio, dt_fim, limit, offset}
 */
router.get('/cadastropessoa',
  sanitizeInput,
  validateRequired(['dt_inicio', 'dt_fim']),
  validateDateFormat(['dt_inicio', 'dt_fim']),
  validatePagination,
  asyncHandler(async (req, res) => {
    const { dt_inicio, dt_fim } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || 1000, 100000);
    const offset = parseInt(req.query.offset, 10) || 0;

    // Observação de performance:
    // - Usa BETWEEN com parâmetros para permitir uso de índices em dt_transacao
    // - Usa filtros exatos em tp_operacao e tp_situacao (bons candidatos a índice composto)
    // Índices sugeridos (criar no banco conforme necessário):
    //   CREATE INDEX IF NOT EXISTS idx_tra_transacao_dt_tp ON tra_transacao(dt_transacao, tp_operacao, tp_situacao);

    const query = `
      SELECT
        tt.cd_operacao,
        p.cd_pessoa,
        p.nm_pessoa,
        pp.nm_fantasia,
        p.nr_cpfcnpj,
        pt.nr_telefone,
        pc.cd_tipoclas,
        pc.cd_classificacao,
        tt.dt_transacao,
        tt.cd_empresa
      FROM tra_transacao tt
      LEFT JOIN pes_pessoa p ON p.cd_pessoa = tt.cd_pessoa
      LEFT JOIN pes_pesjuridica pp ON p.cd_pessoa = pp.cd_pessoa
      LEFT JOIN pes_telefone pt ON p.cd_pessoa = pt.cd_pessoa
      LEFT JOIN pes_pessoaclas pc ON p.cd_pessoa = pc.cd_pessoa
      WHERE tt.dt_transacao BETWEEN $1 AND $2
        AND tt.tp_operacao = 'S'
        AND tt.tp_situacao = 4
      ORDER BY tt.dt_transacao DESC
      LIMIT $3 OFFSET $4
    `;

    const countQuery = `
      SELECT COUNT(*) AS total
      FROM tra_transacao tt
      WHERE tt.dt_transacao BETWEEN $1 AND $2
        AND tt.tp_operacao = 'S'
        AND tt.tp_situacao = 4
    `;

    const params = [dt_inicio, dt_fim, limit, offset];

    const [result, totalResult] = await Promise.all([
      pool.query(query, params),
      pool.query(countQuery, [dt_inicio, dt_fim])
    ]);

    const total = parseInt(totalResult.rows[0]?.total || 0, 10);

    successResponse(res, {
      periodo: { dt_inicio, dt_fim },
      limit,
      offset,
      total,
      hasMore: (offset + limit) < total,
      data: result.rows
    }, 'Cadastro de pessoas consultado com sucesso');
  })
);

export default router;