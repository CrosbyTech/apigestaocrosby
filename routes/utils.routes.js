import express from 'express';
import axios from 'axios';
import pool from '../config/database.js';
import {
  sanitizeInput,
  validateRequired,
  validateDateFormat,
} from '../middlewares/validation.middleware.js';
import {
  asyncHandler,
  successResponse,
  errorResponse,
} from '../utils/errorHandler.js';
import { refreshAllMaterializedViews } from '../utils/refreshMaterializedViews.js';

const router = express.Router();

/**
 * @route GET /utils/external-test
 * @desc Testar consumo de API externa (apenas para desenvolvimento)
 * @access Public
 */
router.get(
  '/external-test',
  asyncHandler(async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
      return errorResponse(
        res,
        'Endpoint disponível apenas em desenvolvimento',
        403,
        'FORBIDDEN',
      );
    }

    try {
      const response = await axios.get(
        'https://jsonplaceholder.typicode.com/todos/1',
        {
          timeout: 5000, // 5 segundos de timeout
        },
      );


      successResponse(
        res,
        {
          source: 'https://jsonplaceholder.typicode.com',
          data: response.data,
        },
        'API externa consultada com sucesso',
      );
    } catch (error) {
      throw new Error(`Erro ao buscar dados externos: ${error.message}`);
    }
  }),
);

/**
 * @route GET /utils/nm-franquia
 * @desc Retorna nm_fantasia (nome fantasia) e consultor do cliente associado a um número de transação
 * @query {nr_transacao} - número da transação (pode ser único ou lista separada por vírgula)
 */
router.get(
  '/nm-franquia',
  sanitizeInput,
  asyncHandler(async (req, res) => {
    let { nr_transacao } = req.query;

    if (!nr_transacao) {
      return successResponse(res, [], 'Nenhuma transação informada');
    }

    // Aceitar lista separada por vírgula
    const transacoes = String(nr_transacao)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    // Construir placeholders dinamicamente
    const placeholders = transacoes.map((_, i) => `$${i + 1}`).join(',');

    const query = `
      SELECT
        pj.cd_pessoa,
        pj.nm_fantasia,
        tt.nr_transacao,
        COALESCE(
          CASE
            WHEN pc.cd_classificacao::integer = 1 THEN 'IVANNA'
            WHEN pc.cd_classificacao::integer = 2 THEN 'ARTHUR'
            WHEN pc.cd_classificacao::integer = 3 THEN 'JHEMYSON'
            ELSE 'Sem consultor'
          END
        ) as consultor
      FROM
        pes_pesjuridica pj
      LEFT JOIN tra_transacao tt ON
        tt.cd_pessoa = pj.cd_pessoa
      LEFT JOIN vr_pes_pessoaclas pc ON
        pj.cd_pessoa = pc.cd_pessoa
      WHERE
        tt.nr_transacao IN (${placeholders})
        AND pc.cd_tipoclas = 57
      GROUP BY
        pj.cd_pessoa,
        pj.nm_fantasia,
        tt.nr_transacao,
        pc.cd_classificacao
    `;

    const result = await pool.query(query, transacoes);

    // Retornar map por nr_transacao
    const map = result.rows.reduce((acc, row) => {
      acc[row.nr_transacao] = {
        cd_pessoa: row.cd_pessoa,
        nm_fantasia: row.nm_fantasia,
        consultor: row.consultor,
      };
      return acc;
    }, {});

    successResponse(res, map, 'Nomes fantasia e consultores obtidos com sucesso');
  }),
);

/**
 * @route GET /utils/autocomplete/nm_fantasia
 * @desc Autocomplete para nomes fantasia de franquias
 * @access Public
 * @query {q} - termo de busca (mínimo 1 caractere)
 */
router.get(
  '/autocomplete/nm_fantasia',
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
    const suggestions = rows.map((r) => r.nm_fantasia);

    successResponse(
      res,
      suggestions,
      'Sugestões de nomes fantasia obtidas com sucesso',
    );
  }),
);

/**
 * @route GET /utils/autocomplete/nm_grupoempresa
 * @desc Autocomplete para nomes de grupos de empresa
 * @access Public
 * @query {q} - termo de busca (mínimo 1 caractere)
 */
router.get(
  '/autocomplete/nm_grupoempresa',
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

    successResponse(
      res,
      rows,
      'Sugestões de grupos de empresa obtidas com sucesso',
    );
  }),
);

/**
 * @route GET /utils/health
 * @desc Health check da aplicação
 * @access Public
 */
router.get(
  '/health',
  asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const healthCheck = {
      status: 'OK',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      version: process.env.npm_package_version || '2.1.0',
      startTime,
    };

    // Testar conexão com banco de dados SEM timeout
    try {
      console.log('🔍 Testando conexão com banco de dados...');
      const result = await pool.query(
        'SELECT NOW() as current_time, version() as version, current_database() as database',
      );

      healthCheck.database = {
        status: 'Connected',
        responseTime: `${Date.now() - healthCheck.startTime}ms`,
        serverTime: result.rows[0].current_time,
        database: result.rows[0].database,
        version:
          result.rows[0].version.split(' ')[0] +
          ' ' +
          result.rows[0].version.split(' ')[1],
        message: 'Conexão sem timeout - ilimitada',
      };
      console.log('✅ Conexão com banco bem-sucedida');
    } catch (error) {
      console.error('❌ Erro na conexão com banco:', error.message);
      healthCheck.database = {
        status: 'Disconnected',
        error: error.message,
        message: 'Falha na conexão mesmo sem timeout',
      };
      healthCheck.status = 'ERROR';
    }

    // Testar uso de memória
    const memUsage = process.memoryUsage();
    healthCheck.memory = {
      rss: `${Math.round(memUsage.rss / 1024 / 1024)} MB`,
      heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)} MB`,
      heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)} MB`,
    };

    const statusCode = healthCheck.status === 'OK' ? 200 : 503;
    res.status(statusCode).json(healthCheck);
  }),
);

/**
 * @route GET /utils/stats
 * @desc Estatísticas básicas do sistema
 * @access Public - ADM only
 */
router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    try {
      // Buscar algumas estatísticas básicas
      const queries = [
        {
          name: 'total_empresas',
          query:
            'SELECT COUNT(*) as count FROM vr_ger_empresa WHERE cd_grupoempresa < 5999',
        },
        {
          name: 'total_franquias',
          query:
            "SELECT COUNT(DISTINCT nm_fantasia) as count FROM pes_pesjuridica WHERE nm_fantasia LIKE 'F%CROSBY%'",
        },
        {
          name: 'conexoes_ativas',
          query:
            "SELECT count(*) as count FROM pg_stat_activity WHERE state = 'active'",
        },
      ];

      const results = await Promise.all(
        queries.map(async ({ name, query }) => {
          try {
            const result = await pool.query(query);
            return { [name]: parseInt(result.rows[0].count, 10) };
          } catch (error) {
            return { [name]: 'Erro' };
          }
        }),
      );

      const stats = results.reduce((acc, curr) => ({ ...acc, ...curr }), {});

      successResponse(
        res,
        {
          timestamp: new Date().toISOString(),
          ...stats,
        },
        'Estatísticas do sistema obtidas com sucesso',
      );
    } catch (error) {
      throw new Error(`Erro ao obter estatísticas: ${error.message}`);
    }
  }),
);

// Rota /utils/classcliente removida a pedido

/**
 * @route GET /utils/cadastropessoa
 * @desc Consulta de clientes e suas classificações, paginada e indexável
 * @access Public
 * @query {dt_inicio, dt_fim, limit, offset}
 */
router.get(
  '/cadastropessoa',
  sanitizeInput,
  validateRequired(['dt_inicio', 'dt_fim']),
  validateDateFormat(['dt_inicio', 'dt_fim']),
  asyncHandler(async (req, res) => {
    const { dt_inicio, dt_fim } = req.query;

    // Observação de performance:
    // - Usa BETWEEN com parâmetros para permitir uso de índices em dt_transacao
    // - Usa filtros exatos em tp_operacao e tp_situacao (bons candidatos a índice composto)
    // Índices sugeridos (criar no banco conforme necessário):
    //   CREATE INDEX IF NOT EXISTS idx_tra_transacao_dt_tp ON tra_transacao(dt_transacao, tp_operacao, tp_situacao);

    const query = `
      SELECT
        tt.cd_empresa,
        pp.nr_cpfcnpj,
        pp.nm_pessoa,
        pj.nm_fantasia,
        tt.cd_operacao,
        pc.cd_tipoclas,
        pt.ds_tipoclas,
        pc.cd_classificacao,
        c.ds_classificacao,
        tt.dt_transacao
      FROM
        tra_transacao tt
      LEFT JOIN pes_pessoa pp ON
        tt.cd_pessoa = pp.cd_pessoa
      LEFT JOIN pes_pessoaclas pc ON
        pp.cd_pessoa = pc.cd_pessoa
      LEFT JOIN pes_tipoclas pt ON
        pc.cd_tipoclas = pt.cd_tipoclas
      LEFT JOIN pes_classificacao c ON
        pt.cd_tipoclas = c.cd_tipoclas
        AND pc.cd_classificacao = c.cd_classificacao
      LEFT JOIN pes_pesjuridica pj ON
        pp.cd_pessoa = pj.cd_pessoa
      WHERE
        tt.dt_transacao BETWEEN $1 AND $2
        AND tt.tp_operacao = 'S'
        AND tt.cd_empresa < 6000
      ORDER BY
        tt.dt_transacao DESC
    `;

    const params = [dt_inicio, dt_fim];

    const result = await pool.query(query, params);

    successResponse(
      res,
      {
        periodo: { dt_inicio, dt_fim },
        count: result.rows.length,
        data: result.rows,
      },
      'Cadastro de pessoas consultado com sucesso',
    );
  }),
);

/**
 * @route POST /utils/refresh-materialized-views
 * @desc Atualiza manualmente todas as views materializadas
 * @access Public (pode adicionar autenticação se necessário)
 */
router.post(
  '/refresh-materialized-views',
  asyncHandler(async (req, res) => {
    const startTime = Date.now();
    
    // Executar atualização de todas as views materializadas
    const results = await refreshAllMaterializedViews();
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    successResponse(
      res,
      {
        ...results,
        duration: `${duration}s`,
        timestamp: new Date().toISOString(),
      },
      `Views materializadas atualizadas com sucesso em ${duration}s`,
    );
  }),
);

/**
 * @route GET /utils/acao-cartoes
 * @desc Retorna informações de vouchers e transações do dia relacionadas
 * @access Public
 * @query {cd_empcad} - código(s) de empresa cadastro (pode ser único ou lista separada por vírgula)
 * @query {cd_sufixo} - código sufixo (opcional) - filtra por cd_sufixo exato
 */
router.get(
  '/acao-cartoes',
  sanitizeInput,
  asyncHandler(async (req, res) => {
    let { cd_empcad, cd_sufixo } = req.query;

    if (!cd_empcad) {
      return errorResponse(
        res,
        'Parâmetro cd_empcad é obrigatório',
        400,
        'BAD_REQUEST',
      );
    }

    // Aceitar lista separada por vírgula
    const empresas = String(cd_empcad)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    // Construir placeholders dinamicamente
    const placeholders = empresas.map((_, i) => `$${i + 1}`).join(',');
    
    // Construir parâmetros e condições dinamicamente
    let params = [...empresas];
    let paramIndex = empresas.length + 1;
    let whereConditions = [
      'v.cd_pessoa is not null',
      `v.cd_sufixo not like '%crosby%'`,
      `v.cd_sufixo not like '%CROSBY%'`,
      `v.tp_situacao <> 6`,
      `v.cd_empcad in (${placeholders})`
    ];
    
    // Adicionar filtro de cd_sufixo se fornecido
    if (cd_sufixo) {
      whereConditions.push(`v.cd_sufixo = $${paramIndex}`);
      params.push(cd_sufixo);
    }

    const query = `
      with trx_do_dia as (
        select
          t.cd_pessoa,
          DATE(t.dt_transacao) as d_trans,
          t.nr_transacao,
          t.dt_transacao,
          t.vl_total,
          t.vl_desconto,
          t.cd_empresa,
          t.tp_operacao,
          t.tp_situacao,
          row_number() over (
            partition by t.cd_pessoa,
              DATE(t.dt_transacao)
            order by
              t.dt_transacao desc,
              t.nr_transacao desc
          ) as rn_dia
        from
          tra_transacao t
        where
          t.tp_situacao = 4
          and t.cd_operacao <> 599
          and t.tp_operacao = 'S'
      )
      select
        v.cd_empcad,
        v.cd_pessoa,
        v.nr_voucher,
        v.cd_sufixo,
        v.vl_voucher,
        v.dt_cadastro,
        v.tp_situacao,
        case
          when v.tp_situacao = 4 then 'USADO'
          else 'NÃO USADO'
        end as situacao_uso,
        t.nr_transacao,
        t.dt_transacao,
        t.cd_empresa as cd_empresa_transacao,
        t.vl_total,
        t.vl_desconto,
        (coalesce(t.vl_total, 0) + coalesce(t.vl_desconto, 0)) as vl_bruto,
        ROUND(
          100.0 * coalesce(t.vl_desconto, 0)
          / nullif(coalesce(t.vl_total, 0) + coalesce(t.vl_desconto, 0), 0)
        , 2) as pct_desconto_bruto
      from
        pdv_voucher v
      left join trx_do_dia t
        on
          t.cd_pessoa = v.cd_pessoa
          and t.d_trans = v.dt_cadastro::date
          and t.rn_dia = 1
      where
        ${whereConditions.join(' AND ')}
      order by
        v.cd_empcad,
        v.dt_cadastro desc
    `;

    const result = await pool.query(query, params);

    successResponse(
      res,
      {
        count: result.rows.length,
        data: result.rows,
      },
      'Dados de ação cartões obtidos com sucesso',
    );
  }),
);


export default router;
