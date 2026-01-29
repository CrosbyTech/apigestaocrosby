import express from 'express';
import pool from '../config/database.js';
import {
  validateRequired,
  validateDateFormat,
  validatePagination,
  sanitizeInput,
} from '../middlewares/validation.middleware.js';
import {
  asyncHandler,
  successResponse,
  errorResponse,
} from '../utils/errorHandler.js';

const router = express.Router();

/**
 * @route GET /company/empresas
 * @desc Buscar lista de empresas
 * @access Public
 */
router.get(
  '/empresas',
  sanitizeInput,
  asyncHandler(async (req, res) => {
    const query = `
      SELECT cd_empresa, nm_grupoempresa, cd_pessoa 
      FROM vr_ger_empresa
      ORDER BY cd_grupoempresa ASC
    `;

    const { rows } = await pool.query(query);

    successResponse(
      res,
      {
        count: rows.length,
        data: rows,
      },
      'Lista de empresas obtida com sucesso',
    );
  }),
);

/**
 * @route GET /company/grupo-empresas
 * @desc Buscar grupos de empresas
 * @access Public
 */
router.get(
  '/grupo-empresas',
  sanitizeInput,
  asyncHandler(async (req, res) => {
    const query = `
      SELECT cd_grupoempresa, nm_grupoempresa 
      FROM vr_ger_empresa 
      WHERE cd_grupoempresa > 5999 
        AND cd_empresa % 2 = 0 
      ORDER BY cd_grupoempresa ASC
    `;

    const { rows } = await pool.query(query);

    successResponse(
      res,
      {
        count: rows.length,
        data: rows,
      },
      'Lista de grupos de empresas obtida com sucesso',
    );
  }),
);

/**
 * @route GET /company/faturamento-lojas
 * @desc Buscar faturamento por lojas em período específico
 * @access Public
 * @query {cd_grupoempresa_ini, cd_grupoempresa_fim, dt_inicio, dt_fim}
 */
router.get(
  '/faturamento-lojas',
  sanitizeInput,
  validateRequired([
    'cd_grupoempresa_ini',
    'cd_grupoempresa_fim',
    'dt_inicio',
    'dt_fim',
  ]),
  validateDateFormat(['dt_inicio', 'dt_fim']),
  asyncHandler(async (req, res) => {
    const { cd_grupoempresa_ini, cd_grupoempresa_fim, dt_inicio, dt_fim } =
      req.query;

    const allowedOperations = [
      1, 2, 55, 510, 511, 1511, 521, 1521, 522, 960, 9001, 9009, 9027, 9017,
      9400, 9401, 9402, 9403, 9404, 9005, 545, 546, 555, 548, 1210, 9405, 1205,
      1101, 9065, 9064, 9063, 9062, 9061, 9059, 9067, 9073, 9420,
    ];

    const excludedGroups = [
      1, 3, 4, 6, 7, 8, 9, 10, 31, 50, 51, 45, 75, 85, 99,
    ];
    const excludedPersons = [
      69994, 70596, 110000001, 73469, 61000007, 61000008, 61000009, 61000010,
      45832,
    ];

    const query = `
      SELECT
        A.CD_GRUPOEMPRESA,
        A.CD_PESSOA AS pessoa_empresa,
        B.CD_PESSOA AS pessoa_juridica,
        B.NM_FANTASIA AS nome_fantasia,
        SUM(
          CASE
            WHEN T.TP_OPERACAO = 'E' AND T.TP_SITUACAO = 4 THEN T.QT_SOLICITADA
            ELSE 0
          END
        ) AS pa_entrada,
        SUM(
          CASE
            WHEN T.TP_OPERACAO = 'S' AND T.TP_SITUACAO = 4 THEN T.QT_SOLICITADA
            ELSE 0
          END
        ) AS pa_saida,
        COUNT(*) FILTER(WHERE T.TP_SITUACAO = 4 AND T.TP_OPERACAO = 'S') AS transacoes_saida,
        COUNT(*) FILTER(WHERE T.TP_SITUACAO = 4 AND T.TP_OPERACAO = 'E') AS transacoes_entrada,
        (
          SUM(
            CASE
              WHEN T.TP_SITUACAO = 4 AND T.TP_OPERACAO = 'S' THEN T.VL_TOTAL
              WHEN T.TP_SITUACAO = 4 AND T.TP_OPERACAO = 'E' THEN -T.VL_TOTAL
              ELSE 0
            END
          )
          -
          SUM(
            CASE
              WHEN T.TP_SITUACAO = 4 AND T.TP_OPERACAO IN ('S', 'E') THEN COALESCE(T.VL_FRETE, 0)
              ELSE 0
            END
          )
        ) AS faturamento
      FROM GER_EMPRESA A
      JOIN PES_PESJURIDICA B ON A.CD_PESSOA = B.CD_PESSOA
      LEFT JOIN TRA_TRANSACAO T ON T.CD_GRUPOEMPRESA = A.CD_GRUPOEMPRESA
      WHERE B.CD_PESSOA NOT IN (${excludedPersons.join(',')})
        AND B.CD_PESSOA < 110000100
        AND T.VL_TOTAL > 1
        AND T.CD_GRUPOEMPRESA NOT IN (${excludedGroups.join(',')})
        AND (
          T.TP_SITUACAO IS NULL OR (
            T.TP_SITUACAO = 4
            AND T.TP_OPERACAO IN ('S', 'E')
            AND T.CD_OPERACAO IN (${allowedOperations.join(',')})
            AND T.CD_GRUPOEMPRESA BETWEEN $1 AND $2
            AND T.DT_TRANSACAO BETWEEN $3::timestamp AND $4::timestamp
          )
        )
      GROUP BY A.CD_GRUPOEMPRESA, A.CD_PESSOA, B.CD_PESSOA, B.NM_FANTASIA
      ORDER BY faturamento DESC, B.NM_FANTASIA
    `;

    const { rows } = await pool.query(query, [
      cd_grupoempresa_ini,
      cd_grupoempresa_fim,
      dt_inicio,
      dt_fim,
    ]);

    // Calcular estatísticas
    const stats = rows.reduce(
      (acc, row) => {
        acc.totalFaturamento += parseFloat(row.faturamento || 0);
        acc.totalLojas = rows.length;
        acc.mediaFaturamento = acc.totalFaturamento / acc.totalLojas;
        return acc;
      },
      { totalFaturamento: 0, totalLojas: 0, mediaFaturamento: 0 },
    );

    successResponse(
      res,
      {
        periodo: { dt_inicio, dt_fim },
        range_grupo: { ini: cd_grupoempresa_ini, fim: cd_grupoempresa_fim },
        estatisticas: stats,
        count: rows.length,
        data: rows,
      },
      'Faturamento por lojas obtido com sucesso',
    );
  }),
);

/**
 * @route GET /company/expedicao
 * @desc Buscar dados para expedição
 * @access Public
 */
router.get(
  '/expedicao',
  asyncHandler(async (req, res) => {
    // Primeiro, vamos descobrir quais colunas existem na view
    const describeQuery = `
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'vw_detalhe_pedido_completo'
      ORDER BY ordinal_position
    `;

    const { rows: columns } = await pool.query(describeQuery);

    // Agora vamos tentar uma query simples para ver os dados
    const query = `
      SELECT * 
      FROM vw_detalhe_pedido_completo 
      WHERE cd_empresa = 850 
        AND cd_tabpreco IN (21, 22)
      LIMIT 50000000
    `;

    const { rows } = await pool.query(query);

    successResponse(
      res,
      {
        empresa: 850,
        tabelas_preco: [21, 22],
        colunas_disponiveis: columns,
        count: rows.length,
        data: rows,
      },
      'Dados de expedição obtidos com sucesso',
    );
  }),
);

/**
 * @route GET /company/pcp
 * @desc Buscar dados para PCP (Planejamento e Controle da Produção)
 * @access Public
 * @query {limit, offset}
 */
router.get(
  '/pcp',
  sanitizeInput,
  validatePagination,
  asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 50000000;
    const offset = parseInt(req.query.offset, 10) || 0;

    // Primeiro, vamos descobrir quais colunas existem na view
    const describeQuery = `
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'vw_detalhe_pedido_completo'
      ORDER BY ordinal_position
    `;

    const { rows: columns } = await pool.query(describeQuery);

    const query = `
      SELECT * 
      FROM vw_detalhe_pedido_completo 
      WHERE cd_empresa = 111 
      LIMIT $1 OFFSET $2
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM vw_detalhe_pedido_completo 
      WHERE cd_empresa = 111
    `;

    const [resultado, totalResult] = await Promise.all([
      pool.query(query, [limit, offset]),
      pool.query(countQuery),
    ]);

    const total = parseInt(totalResult.rows[0].total, 10);

    successResponse(
      res,
      {
        empresa: 111,
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
        colunas_disponiveis: columns,
        data: resultado.rows,
      },
      'Dados de PCP obtidos com sucesso',
    );
  }),
);

export default router;
