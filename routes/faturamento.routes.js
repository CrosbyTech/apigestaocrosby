import express from 'express';
import pool from '../config/database.js';
import {
  validateRequired,
  validateDateFormat,
  sanitizeInput,
} from '../middlewares/validation.middleware.js';
import {
  asyncHandler,
  successResponse,
  errorResponse,
} from '../utils/errorHandler.js';

const router = express.Router();

// Endpoint para buscar faturamento do varejo
router.get(
  '/varejo',
  validateRequired(['dataInicio', 'dataFim']),
  validateDateFormat(['dataInicio', 'dataFim']),
  asyncHandler(async (req, res) => {
    const { dataInicio, dataFim, cd_empresa } = req.query;

    let queryParams = [dataInicio, dataFim];
    let empresaWhereClause = '';

    if (cd_empresa) {
      // Se cd_empresa é uma string com vírgulas, trata como array
      const empresas = cd_empresa.includes(',')
        ? cd_empresa.split(',')
        : [cd_empresa];
      const placeholders = empresas
        .map((_, index) => `$${index + 3}`)
        .join(',');
      empresaWhereClause = `AND fisnf.cd_empresa IN (${placeholders})`;
      queryParams.push(...empresas);
    } else {
      // Lista padrão de empresas
      empresaWhereClause =
        'AND fisnf.cd_empresa IN (2, 5, 55, 65, 90, 91, 92, 93, 94, 95, 96, 97, 98, 200, 500, 550, 650, 890, 910, 920, 930, 940, 950, 960, 970, 980)';
    }

    const query = `
      SELECT
        fisnf.cd_grupoempresa,
        fisnf.nm_grupoempresa,
        fisnf.dt_transacao,
        COALESCE(SUM(
          CASE 
            WHEN fisnf.vl_unitbruto IS NOT NULL AND fisnf.qt_faturado IS NOT NULL AND fisnf.qt_faturado != 0 AND fisnf.tp_operacao = 'S' 
            THEN fisnf.vl_unitbruto * fisnf.qt_faturado 
            ELSE 0 
          END
        ), 0) AS valor_sem_desconto_saida,
        COALESCE(SUM(
          CASE 
            WHEN fisnf.vl_unitbruto IS NOT NULL AND fisnf.qt_faturado IS NOT NULL AND fisnf.qt_faturado != 0 AND fisnf.tp_operacao = 'E' 
            THEN fisnf.vl_unitbruto * fisnf.qt_faturado 
            ELSE 0 
          END
        ), 0) AS valor_sem_desconto_entrada,
        COALESCE(SUM(
          CASE
            WHEN fisnf.vl_unitliquido IS NOT NULL AND fisnf.qt_faturado IS NOT NULL AND fisnf.qt_faturado != 0 AND fisnf.tp_operacao = 'S' 
            THEN fisnf.vl_unitliquido * fisnf.qt_faturado 
            ELSE 0 
          END
        ), 0) AS valor_com_desconto_saida,
        COALESCE(SUM(
          CASE 
            WHEN fisnf.vl_unitliquido IS NOT NULL AND fisnf.qt_faturado IS NOT NULL AND fisnf.qt_faturado != 0 AND fisnf.tp_operacao = 'E' 
            THEN fisnf.vl_unitliquido * fisnf.qt_faturado 
            ELSE 0 
          END
        ), 0) AS valor_com_desconto_entrada,
        COALESCE(SUM(
          CASE 
            WHEN fisnf.vl_unitbruto IS NOT NULL AND fisnf.qt_faturado IS NOT NULL AND fisnf.qt_faturado != 0 
            THEN fisnf.vl_unitbruto * fisnf.qt_faturado 
            ELSE 0 
          END
        ), 0) AS valor_sem_desconto,
        COALESCE(SUM(
          CASE 
            WHEN fisnf.vl_unitliquido IS NOT NULL AND fisnf.qt_faturado IS NOT NULL AND fisnf.qt_faturado != 0
            THEN fisnf.vl_unitliquido * fisnf.qt_faturado 
            ELSE 0 
          END
        ), 0) AS valor_com_desconto
      FROM
        vr_fis_nfitemprod fisnf
      WHERE
        fisnf.dt_transacao BETWEEN $1 AND $2
        ${empresaWhereClause}
        AND fisnf.tp_situacao NOT IN ('C', 'X')
        AND fisnf.vl_unitbruto IS NOT NULL
        AND fisnf.vl_unitliquido IS NOT NULL
        AND fisnf.qt_faturado IS NOT NULL
        AND fisnf.qt_faturado != 0
        AND fisnf.cd_operacao IN (1, 2, 510, 511, 1511, 521, 1521, 522, 960, 9001, 9009, 9027, 8750, 9017, 9400, 9401, 9402, 9403, 9404, 9005, 545, 546, 555, 548, 1210, 9405, 1205, 1101)
      GROUP BY fisnf.dt_transacao, fisnf.cd_grupoempresa, fisnf.nm_grupoempresa
      ORDER BY fisnf.dt_transacao, fisnf.cd_grupoempresa, fisnf.nm_grupoempresa
    `;

    const result = await pool.query(query, queryParams);

    return successResponse(
      res,
      {
        data: result.rows,
        total: result.rows.length,
      },
      'Faturamento varejo recuperado com sucesso',
    );
  }),
);

// Endpoint para buscar faturamento MTM (multimarcas)
router.get(
  '/mtm',
  validateRequired(['dataInicio', 'dataFim']),
  validateDateFormat(['dataInicio', 'dataFim']),
  asyncHandler(async (req, res) => {
    const { dataInicio, dataFim, cd_empresa } = req.query;

    let queryParams = [dataInicio, dataFim];
    let empresaWhereClause = '';

    if (cd_empresa) {
      // Se cd_empresa é uma string com vírgulas, trata como array
      const empresas = cd_empresa.includes(',')
        ? cd_empresa.split(',')
        : [cd_empresa];
      const placeholders = empresas
        .map((_, index) => `$${index + 3}`)
        .join(',');
      empresaWhereClause = `AND fisnf.cd_empresa IN (${placeholders})`;
      queryParams.push(...empresas);
    } else {
      // Lista padrão de empresas
      empresaWhereClause =
        'AND fisnf.cd_empresa IN (1, 2, 5, 6, 7, 11, 31, 55, 65, 75, 85, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99)';
    }

    const query = `
      SELECT
        fisnf.dt_transacao,
        fisnf.cd_grupoempresa,
        fisnf.nm_grupoempresa,
        COALESCE(SUM(
          CASE 
            WHEN fisnf.vl_unitbruto IS NOT NULL AND fisnf.qt_faturado IS NOT NULL AND fisnf.qt_faturado != 0 AND fisnf.tp_operacao = 'S' 
            THEN fisnf.vl_unitbruto * fisnf.qt_faturado + COALESCE(fisnf.vl_freterat, 0)
            ELSE 0 
          END
        ), 0) AS valor_sem_desconto_saida,
        COALESCE(SUM(
          CASE 
            WHEN fisnf.vl_unitbruto IS NOT NULL AND fisnf.qt_faturado IS NOT NULL AND fisnf.qt_faturado != 0 AND fisnf.tp_operacao = 'E' 
            THEN fisnf.vl_unitbruto * fisnf.qt_faturado + COALESCE(fisnf.vl_freterat, 0)
            ELSE 0 
          END
        ), 0) AS valor_sem_desconto_entrada,
        COALESCE(SUM(
          CASE
            WHEN fisnf.vl_unitliquido IS NOT NULL AND fisnf.qt_faturado IS NOT NULL AND fisnf.qt_faturado != 0 AND fisnf.tp_operacao = 'S' 
            THEN fisnf.vl_unitliquido * fisnf.qt_faturado + COALESCE(fisnf.vl_freterat, 0)
            ELSE 0 
          END
        ), 0) AS valor_com_desconto_saida,
        COALESCE(SUM(
          CASE 
            WHEN fisnf.vl_unitliquido IS NOT NULL AND fisnf.qt_faturado IS NOT NULL AND fisnf.qt_faturado != 0 AND fisnf.tp_operacao = 'E' 
            THEN fisnf.vl_unitliquido * fisnf.qt_faturado + COALESCE(fisnf.vl_freterat, 0)
            ELSE 0 
          END
        ), 0) AS valor_com_desconto_entrada,
        COALESCE(SUM(
          CASE 
            WHEN fisnf.vl_unitbruto IS NOT NULL AND fisnf.qt_faturado IS NOT NULL AND fisnf.qt_faturado != 0 
            THEN fisnf.vl_unitbruto * fisnf.qt_faturado + COALESCE(fisnf.vl_freterat, 0)
            ELSE 0 
          END
        ), 0) AS valor_sem_desconto,
        COALESCE(SUM(
          CASE 
            WHEN fisnf.vl_unitliquido IS NOT NULL AND fisnf.qt_faturado IS NOT NULL AND fisnf.qt_faturado != 0
            THEN fisnf.vl_unitliquido * fisnf.qt_faturado + COALESCE(fisnf.vl_freterat, 0)
            ELSE 0 
          END
        ), 0) AS valor_com_desconto
      FROM
        vr_fis_nfitemprod fisnf
      WHERE
        fisnf.dt_transacao BETWEEN $1 AND $2
        ${empresaWhereClause}
        AND fisnf.tp_situacao NOT IN ('C', 'X')
        AND fisnf.vl_unitbruto IS NOT NULL
        AND fisnf.vl_unitliquido IS NOT NULL
        AND fisnf.qt_faturado IS NOT NULL
        AND fisnf.qt_faturado != 0
        AND fisnf.cd_operacao IN (1, 2, 17, 21, 401, 555, 1017, 1201, 1202, 1204, 1210, 1950, 1999, 2203, 2204, 2207, 9005, 9991, 200, 300, 400, 510, 511, 512, 521, 522, 545, 546, 548, 660, 661, 960, 961, 1400, 1402, 1403, 1405, 1406, 5102, 5106, 5107, 5110, 5111, 5113)
        AND EXISTS (
          SELECT
            1
          FROM
            vr_pes_pessoaclas vpp
          WHERE
            vpp.cd_pessoa = fisnf.cd_pessoatra
            AND (
              (vpp.cd_tipoclas = 20
                AND vpp.cd_classificacao::integer = 2)
              OR (vpp.cd_tipoclas = 5
                AND vpp.cd_classificacao::integer = 1)
            )
        )
      GROUP BY fisnf.dt_transacao, fisnf.cd_grupoempresa, fisnf.nm_grupoempresa
      ORDER BY fisnf.dt_transacao, fisnf.cd_grupoempresa, fisnf.nm_grupoempresa
    `;

    const result = await pool.query(query, queryParams);

    return successResponse(
      res,
      {
        data: result.rows,
        total: result.rows.length,
      },
      'Faturamento MTM recuperado com sucesso',
    );
  }),
);

// Endpoint para buscar faturamento de franquias
router.get(
  '/franquias',
  validateRequired(['dataInicio', 'dataFim']),
  validateDateFormat(['dataInicio', 'dataFim']),
  asyncHandler(async (req, res) => {
    const { dataInicio, dataFim, cd_empresa } = req.query;

    let queryParams = [dataInicio, dataFim];
    let empresaWhereClause = '';

    if (cd_empresa) {
      // Se cd_empresa é uma string com vírgulas, trata como array
      const empresas = cd_empresa.includes(',')
        ? cd_empresa.split(',')
        : [cd_empresa];
      const placeholders = empresas
        .map((_, index) => `$${index + 3}`)
        .join(',');
      empresaWhereClause = `AND fisnf.cd_empresa IN (${placeholders})`;
      queryParams.push(...empresas);
    } else {
      // Lista padrão de empresas
      empresaWhereClause =
        'AND fisnf.cd_empresa IN (1, 2, 5, 6, 7, 11, 31, 55, 65, 75, 85, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99)';
    }

    const query = `
      SELECT
        fisnf.dt_transacao,
        fisnf.cd_grupoempresa,
        fisnf.nm_grupoempresa,
        COALESCE(SUM(
          CASE 
            WHEN fisnf.vl_unitbruto IS NOT NULL AND fisnf.qt_faturado IS NOT NULL AND fisnf.qt_faturado != 0 AND fisnf.tp_operacao = 'S' 
            THEN fisnf.vl_unitbruto * fisnf.qt_faturado + COALESCE(fisnf.vl_freterat, 0)
            ELSE 0 
          END
        ), 0) AS valor_sem_desconto_saida,
        COALESCE(SUM(
          CASE 
            WHEN fisnf.vl_unitbruto IS NOT NULL AND fisnf.qt_faturado IS NOT NULL AND fisnf.qt_faturado != 0 AND fisnf.tp_operacao = 'E' 
            THEN fisnf.vl_unitbruto * fisnf.qt_faturado + COALESCE(fisnf.vl_freterat, 0)
            ELSE 0 
          END
        ), 0) AS valor_sem_desconto_entrada,
        COALESCE(SUM(
          CASE
            WHEN fisnf.vl_unitliquido IS NOT NULL AND fisnf.qt_faturado IS NOT NULL AND fisnf.qt_faturado != 0 AND fisnf.tp_operacao = 'S' 
            THEN fisnf.vl_unitliquido * fisnf.qt_faturado + COALESCE(fisnf.vl_freterat, 0)
            ELSE 0 
          END
        ), 0) AS valor_com_desconto_saida,
        COALESCE(SUM(
          CASE 
            WHEN fisnf.vl_unitliquido IS NOT NULL AND fisnf.qt_faturado IS NOT NULL AND fisnf.qt_faturado != 0 AND fisnf.tp_operacao = 'E' 
            THEN fisnf.vl_unitliquido * fisnf.qt_faturado + COALESCE(fisnf.vl_freterat, 0)
            ELSE 0 
          END
        ), 0) AS valor_com_desconto_entrada,
        COALESCE(SUM(
          CASE 
            WHEN fisnf.vl_unitbruto IS NOT NULL AND fisnf.qt_faturado IS NOT NULL AND fisnf.qt_faturado != 0 
            THEN fisnf.vl_unitbruto * fisnf.qt_faturado + COALESCE(fisnf.vl_freterat, 0)
            ELSE 0 
          END
        ), 0) AS valor_sem_desconto,
        COALESCE(SUM(
          CASE 
            WHEN fisnf.vl_unitliquido IS NOT NULL AND fisnf.qt_faturado IS NOT NULL AND fisnf.qt_faturado != 0
            THEN fisnf.vl_unitliquido * fisnf.qt_faturado + COALESCE(fisnf.vl_freterat, 0)
            ELSE 0 
          END
        ), 0) AS valor_com_desconto
      FROM
        vr_fis_nfitemprod fisnf
      LEFT JOIN pes_pesjuridica pp ON
        pp.cd_pessoa = fisnf.cd_pessoatra
      WHERE
        fisnf.dt_transacao BETWEEN $1 AND $2
        ${empresaWhereClause}
        AND fisnf.tp_situacao NOT IN ('C', 'X')
        AND fisnf.vl_unitbruto IS NOT NULL
        AND fisnf.vl_unitliquido IS NOT NULL
        AND fisnf.qt_faturado IS NOT NULL
        AND fisnf.qt_faturado != 0
        AND pp.nm_fantasia LIKE '%F%CROSBY%'
        AND fisnf.cd_operacao IN (1, 2, 17, 21, 401, 555, 1017, 1201, 1202, 1204, 1210, 1950, 1999, 2203, 2204, 2207, 9005, 9991, 200, 300, 400, 510, 511, 512, 521, 522, 545, 546, 548, 660, 661, 960, 961, 1400, 1402, 1403, 1405, 1406, 5102, 5106, 5107, 5110, 5111, 5113)
      GROUP BY fisnf.dt_transacao, fisnf.cd_grupoempresa, fisnf.nm_grupoempresa
      ORDER BY fisnf.dt_transacao, fisnf.cd_grupoempresa, fisnf.nm_grupoempresa
    `;

    const result = await pool.query(query, queryParams);

    return successResponse(
      res,
      {
        data: result.rows,
        total: result.rows.length,
      },
      'Faturamento franquias recuperado com sucesso',
    );
  }),
);

// Endpoint para buscar faturamento de revenda
router.get(
  '/revenda',
  validateRequired(['dataInicio', 'dataFim']),
  validateDateFormat(['dataInicio', 'dataFim']),
  asyncHandler(async (req, res) => {
    const { dataInicio, dataFim, cd_empresa } = req.query;

    let queryParams = [dataInicio, dataFim];
    let empresaWhereClause = '';

    if (cd_empresa) {
      // Se cd_empresa é uma string com vírgulas, trata como array
      const empresas = cd_empresa.includes(',')
        ? cd_empresa.split(',')
        : [cd_empresa];
      const placeholders = empresas
        .map((_, index) => `$${index + 3}`)
        .join(',');
      empresaWhereClause = `AND fisnf.cd_empresa IN (${placeholders})`;
      queryParams.push(...empresas);
    } else {
      // Lista padrão de empresas
      empresaWhereClause =
        'AND fisnf.cd_empresa IN (1, 2, 5, 6, 7, 11, 31, 55, 65, 75, 85, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99)';
    }

    const query = `
      SELECT
        fisnf.cd_grupoempresa,
        fisnf.nm_grupoempresa,
        fisnf.dt_transacao,
        COALESCE(SUM(
          CASE 
            WHEN fisnf.vl_unitbruto IS NOT NULL AND fisnf.qt_faturado IS NOT NULL AND fisnf.qt_faturado != 0 AND fisnf.tp_operacao = 'S' 
            THEN fisnf.vl_unitbruto * fisnf.qt_faturado + COALESCE(fisnf.vl_freterat, 0)
            ELSE 0 
          END
        ), 0) AS valor_sem_desconto_saida,
        COALESCE(SUM(
          CASE 
            WHEN fisnf.vl_unitbruto IS NOT NULL AND fisnf.qt_faturado IS NOT NULL AND fisnf.qt_faturado != 0 AND fisnf.tp_operacao = 'E' 
            THEN fisnf.vl_unitbruto * fisnf.qt_faturado + COALESCE(fisnf.vl_freterat, 0)
            ELSE 0 
          END
        ), 0) AS valor_sem_desconto_entrada,
        COALESCE(SUM(
          CASE
            WHEN fisnf.vl_unitliquido IS NOT NULL AND fisnf.qt_faturado IS NOT NULL AND fisnf.qt_faturado != 0 AND fisnf.tp_operacao = 'S' 
            THEN fisnf.vl_unitliquido * fisnf.qt_faturado + COALESCE(fisnf.vl_freterat, 0)
            ELSE 0 
          END
        ), 0) AS valor_com_desconto_saida,
        COALESCE(SUM(
          CASE 
            WHEN fisnf.vl_unitliquido IS NOT NULL AND fisnf.qt_faturado IS NOT NULL AND fisnf.qt_faturado != 0 AND fisnf.tp_operacao = 'E' 
            THEN fisnf.vl_unitliquido * fisnf.qt_faturado + COALESCE(fisnf.vl_freterat, 0)
            ELSE 0 
          END
        ), 0) AS valor_com_desconto_entrada,
        COALESCE(SUM(
          CASE 
            WHEN fisnf.vl_unitbruto IS NOT NULL AND fisnf.qt_faturado IS NOT NULL AND fisnf.qt_faturado != 0 
            THEN fisnf.vl_unitbruto * fisnf.qt_faturado + COALESCE(fisnf.vl_freterat, 0)
            ELSE 0 
          END
        ), 0) AS valor_sem_desconto,
        COALESCE(SUM(
          CASE 
            WHEN fisnf.vl_unitliquido IS NOT NULL AND fisnf.qt_faturado IS NOT NULL AND fisnf.qt_faturado != 0
            THEN fisnf.vl_unitliquido * fisnf.qt_faturado + COALESCE(fisnf.vl_freterat, 0)
            ELSE 0 
          END
        ), 0) AS valor_com_desconto
      FROM
        vr_fis_nfitemprod fisnf
      WHERE
        fisnf.dt_transacao BETWEEN $1 AND $2
        ${empresaWhereClause}
        AND fisnf.tp_situacao NOT IN ('C', 'X')
        AND fisnf.vl_unitbruto IS NOT NULL
        AND fisnf.vl_unitliquido IS NOT NULL
        AND fisnf.qt_faturado IS NOT NULL
        AND fisnf.qt_faturado != 0
        AND fisnf.cd_operacao IN (1, 2, 17, 21, 401, 555, 1017, 1201, 1202, 1204, 1210, 1950, 1999, 2203, 2204, 2207, 9005, 9991, 200, 300, 400, 510, 511, 512, 521, 522, 545, 546, 548, 660, 661, 960, 961, 1400, 1402, 1403, 1405, 1406, 5102, 5106, 5107, 5110, 5111, 5113)
        AND EXISTS (
          SELECT
            1
          FROM
            vr_pes_pessoaclas vpp
          WHERE
            vpp.cd_pessoa = fisnf.cd_pessoatra
            AND (
              (vpp.cd_tipoclas = 20
                AND vpp.cd_classificacao::integer = 3)
              OR (vpp.cd_tipoclas = 7
                AND vpp.cd_classificacao::integer = 1)
            )
        )
      GROUP BY fisnf.cd_grupoempresa, fisnf.nm_grupoempresa, fisnf.dt_transacao
      ORDER BY fisnf.cd_grupoempresa, fisnf.nm_grupoempresa, fisnf.dt_transacao
    `;

    const result = await pool.query(query, queryParams);

    return successResponse(
      res,
      {
        data: result.rows,
        total: result.rows.length,
      },
      'Faturamento revenda recuperado com sucesso',
    );
  }),
);

// Endpoint consolidado para buscar todos os tipos de faturamento
router.get(
  '/consolidado',
  validateRequired(['dataInicio', 'dataFim']),
  validateDateFormat(['dataInicio', 'dataFim']),
  asyncHandler(async (req, res) => {
    const { dataInicio, dataFim, cd_empresa } = req.query;

    let whereClause = 'WHERE dt_transacao BETWEEN $1 AND $2';
    let queryParams = [dataInicio, dataFim];

    if (cd_empresa) {
      // Se cd_empresa é uma string com vírgulas, trata como array
      const empresas = cd_empresa.includes(',')
        ? cd_empresa.split(',')
        : [cd_empresa];
      const placeholders = empresas
        .map((_, index) => `$${index + 3}`)
        .join(',');
      whereClause += ` AND cd_empresa IN (${placeholders})`;
      queryParams.push(...empresas);
    }

    // Queries para cada tipo de faturamento
    const varejoQuery = `
      SELECT 
        'varejo' as tipo,
        cd_empresa,
        nm_grupoempresa,
        SUM(vendas) as vendas,
        SUM(devolucoes) as devolucoes,
        SUM(total) as venda_liquida,
        SUM(frete) as frete,
        SUM(total + frete) as total
      FROM faturamentovarejo 
      ${whereClause}
      GROUP BY cd_empresa, nm_grupoempresa
    `;

    const mtmQuery = `
      SELECT 
        'mtm' as tipo,
        cd_empresa,
        nm_grupoempresa,
        SUM(vendas) as vendas,
        SUM(devolucoes) as devolucoes,
        SUM(total) as venda_liquida,
        SUM(frete) as frete,
        SUM(total + frete) as total
      FROM faturamentomtm 
      ${whereClause}
      GROUP BY cd_empresa, nm_grupoempresa
    `;

    const franquiasQuery = `
      SELECT 
        'franquias' as tipo,
        cd_empresa,
        nm_grupoempresa,
        SUM(vendas) as vendas,
        SUM(devolucoes) as devolucoes,
        SUM(total) as venda_liquida,
        SUM(frete) as frete,
        SUM(total + frete) as total
      FROM faturamentofranquia 
      ${whereClause}
      GROUP BY cd_empresa, nm_grupoempresa
    `;

    const revendaQuery = `
      SELECT 
        'revenda' as tipo,
        cd_empresa,
        nm_grupoempresa,
        SUM(vendas) as vendas,
        SUM(devolucoes) as devolucoes,
        SUM(total) as venda_liquida,
        SUM(frete) as frete,
        SUM(total + frete) as total
      FROM faturamentorevenda 
      ${whereClause}
      GROUP BY cd_empresa, nm_grupoempresa
    `;

    // Executar todas as queries em paralelo
    const [varejoResult, mtmResult, franquiasResult, revendaResult] =
      await Promise.all([
        pool.query(varejoQuery, queryParams),
        pool.query(mtmQuery, queryParams),
        pool.query(franquiasQuery, queryParams),
        pool.query(revendaQuery, queryParams),
      ]);

    const data = {
      varejo: varejoResult.rows,
      mtm: mtmResult.rows,
      franquias: franquiasResult.rows,
      revenda: revendaResult.rows,
    };

    return successResponse(
      res,
      data,
      'Faturamento consolidado recuperado com sucesso',
    );
  }),
);

// Endpoint para análise de cashback
router.get(
  '/analise-cashback',
  asyncHandler(async (req, res) => {
    const {
      dataInicio,
      dataFim,
      cd_empresa,
      dateField,
      limit = 1000,
      offset = 0,
    } = req.query;

    // dateField: 'dt_transacao' or 'dt_voucher' (v.dt_cadastro)
    const useVoucherDate = dateField === 'dt_voucher';

    // Construir cláusula WHERE dinamicamente
    const whereClauses = ['v.tp_situacao = 4'];
    const params = [];

    // Filtrar por empresa se informado
    if (cd_empresa) {
      const empresas = cd_empresa.split(',').map((s) => s.trim());
      const placeholders = empresas
        .map((_, i) => `$${params.length + i + 1}`)
        .join(',');
      whereClauses.push(`t.cd_empresa IN (${placeholders})`);
      params.push(...empresas);
    }

    // Filtrar por período (usando o campo de data escolhido)
    if (dataInicio && dataFim) {
      const startIdx = params.length + 1;
      const endIdx = params.length + 2;
      if (useVoucherDate) {
        whereClauses.push(
          `v.dt_cadastro >= $${startIdx} AND v.dt_cadastro <= $${endIdx}::date + INTERVAL '1 day'`,
        );
      } else {
        whereClauses.push(
          `t.dt_transacao >= $${startIdx} AND t.dt_transacao <= $${endIdx}::date + INTERVAL '1 day'`,
        );
      }
      params.push(dataInicio, dataFim);
    }

    // Adicionar LIMIT e OFFSET para paginação
    const limitParam = `$${params.length + 1}`;
    const offsetParam = `$${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const query = `
      WITH voucher_filtrado AS (
        SELECT 
          v.cd_pessoa,
          v.nr_voucher,
          v.vl_voucher,
          v.tp_situacao,
          v.dt_cadastro,
          DATE(v.dt_cadastro) AS d_voucher
        FROM pdv_voucher v
        WHERE v.tp_situacao = 4
          ${
            useVoucherDate && dataInicio && dataFim
              ? `AND v.dt_cadastro >= $1 AND v.dt_cadastro <= $2::date + INTERVAL '1 day'`
              : ''
          }
      ),
      trx_otimizada AS (
        SELECT DISTINCT ON (t.cd_pessoa, DATE(t.dt_transacao))
          t.cd_pessoa,
          t.nr_transacao,
          t.dt_transacao,
          t.vl_total,
          t.vl_desconto,
          t.cd_empresa,
          t.tp_operacao,
          t.tp_situacao,
	        t.cd_compvend,
          DATE(t.dt_transacao) AS d_trans
        FROM tra_transacao t
        WHERE t.tp_situacao = 4
          AND t.cd_operacao <> 599
          AND t.tp_operacao = 'S'
          AND t.cd_empresa < 5999
          ${
            !useVoucherDate && dataInicio && dataFim
              ? `AND t.dt_transacao >= $1 AND t.dt_transacao <= $2::date + INTERVAL '1 day'`
              : ''
          }
        ORDER BY t.cd_pessoa, DATE(t.dt_transacao), t.dt_transacao DESC, t.nr_transacao DESC
      )
      SELECT
        v.cd_pessoa,
        v.nr_voucher,
        v.vl_voucher,
        v.tp_situacao AS tp_situacao_voucher,
        v.dt_cadastro AS dt_voucher,
        t.nr_transacao,
        t.dt_transacao,
        t.vl_total,
        t.vl_desconto,
        (COALESCE(t.vl_total,0) + COALESCE(t.vl_desconto,0)) AS vl_bruto,
        ROUND(
          100.0 * COALESCE(t.vl_desconto,0)
          / NULLIF(COALESCE(t.vl_total,0) + COALESCE(t.vl_desconto,0), 0)
        , 2) AS pct_desconto_bruto,
        t.cd_empresa,
        t.tp_operacao,
        t.tp_situacao AS tp_situacao_transacao
      FROM voucher_filtrado v
      INNER JOIN trx_otimizada t
        ON t.cd_pessoa = v.cd_pessoa
       AND t.d_trans = v.d_voucher
      ${
        cd_empresa
          ? `WHERE t.cd_empresa IN (${cd_empresa
              .split(',')
              .map((_, i) => `$${i + 3}`)
              .join(',')})`
          : ''
      }
      ORDER BY t.dt_transacao DESC
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `;

    const result = await pool.query(query, params);

    return successResponse(
      res,
      {
        data: result.rows,
        total: result.rows.length,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: result.rows.length === parseInt(limit),
      },
      'Análise de cashback recuperada com sucesso',
    );
  }),
);

// Endpoint para buscar vendedores
router.get(
  '/pes_vendedor',
  asyncHandler(async (req, res) => {
    const { cd_vendedor } = req.query;

    let whereClause = '';
    let queryParams = [];

    if (cd_vendedor) {
      // Se cd_vendedor é uma string com vírgulas, trata como array
      const vendedores = cd_vendedor.includes(',')
        ? cd_vendedor.split(',').map((s) => s.trim())
        : [cd_vendedor];
      const placeholders = vendedores
        .map((_, index) => `$${index + 1}`)
        .join(',');
      whereClause = `WHERE pv.cd_vendedor IN (${placeholders})`;
      queryParams.push(...vendedores);
    }

    const query = `
      SELECT
        pv.cd_vendedor,
        pv.nm_vendedor
      FROM pes_vendedor pv
      ${whereClause}
      ORDER BY pv.nm_vendedor
    `;

    const result = await pool.query(query, queryParams);

    return successResponse(
      res,
      {
        data: result.rows,
        total: result.rows.length,
      },
      'Vendedores recuperados com sucesso',
    );
  }),
);

// Endpoint para buscar faturamento do varejo (view materializada)
router.get(
  '/fat-varejo',
  validateRequired(['dataInicio', 'dataFim']),
  validateDateFormat(['dataInicio', 'dataFim']),
  asyncHandler(async (req, res) => {
    const { dataInicio, dataFim, cd_empresa } = req.query;

    let queryParams = [dataInicio, dataFim];
    let empresaWhereClause = '';

    if (cd_empresa) {
      const empresas = cd_empresa.includes(',')
        ? cd_empresa.split(',').map((s) => s.trim())
        : [cd_empresa];
      const placeholders = empresas
        .map((_, index) => `$${index + 3}`)
        .join(',');
      empresaWhereClause = `AND fv.cd_grupoempresa IN (${placeholders})`;
      queryParams.push(...empresas);
    }

    const query = `
      SELECT
        fv.cd_grupoempresa,
        fv.dt_transacao,
        fv.nm_grupoempresa,
        fv.valor_com_desconto,
        fv.valor_com_desconto_entrada,
        fv.valor_com_desconto_saida,
        fv.valor_sem_desconto,
        fv.valor_sem_desconto_entrada,
        fv.valor_sem_desconto_saida
      FROM fatvarejo fv
      WHERE fv.dt_transacao BETWEEN $1 AND $2
      ${empresaWhereClause}
      ORDER BY fv.dt_transacao, fv.cd_grupoempresa
    `;

    const result = await pool.query(query, queryParams);

    return successResponse(
      res,
      {
        data: result.rows,
        total: result.rows.length,
      },
      'Faturamento varejo recuperado com sucesso',
    );
  }),
);

// Endpoint para buscar faturamento multimarcas (view materializada)
router.get(
  '/fat-multimarcas',
  validateRequired(['dataInicio', 'dataFim']),
  validateDateFormat(['dataInicio', 'dataFim']),
  asyncHandler(async (req, res) => {
    const { dataInicio, dataFim, cd_empresa } = req.query;

    let queryParams = [dataInicio, dataFim];
    let empresaWhereClause = '';

    if (cd_empresa) {
      const empresas = cd_empresa.includes(',')
        ? cd_empresa.split(',').map((s) => s.trim())
        : [cd_empresa];
      const placeholders = empresas
        .map((_, index) => `$${index + 3}`)
        .join(',');
      empresaWhereClause = `AND fm.cd_grupoempresa IN (${placeholders})`;
      queryParams.push(...empresas);
    }

    const query = `
      SELECT
        fm.cd_grupoempresa,
        fm.dt_transacao,
        fm.nm_grupoempresa,
        fm.valor_com_desconto,
        fm.valor_com_desconto_entrada,
        fm.valor_com_desconto_saida,
        fm.valor_sem_desconto,
        fm.valor_sem_desconto_entrada,
        fm.valor_sem_desconto_saida
      FROM fatmtm fm
      WHERE fm.dt_transacao BETWEEN $1 AND $2
      ${empresaWhereClause}
      ORDER BY fm.dt_transacao, fm.cd_grupoempresa
    `;

    const result = await pool.query(query, queryParams);

    return successResponse(
      res,
      {
        data: result.rows,
        total: result.rows.length,
      },
      'Faturamento multimarcas recuperado com sucesso',
    );
  }),
);

// Endpoint para buscar faturamento revenda (view materializada)
router.get(
  '/fat-revenda',
  validateRequired(['dataInicio', 'dataFim']),
  validateDateFormat(['dataInicio', 'dataFim']),
  asyncHandler(async (req, res) => {
    const { dataInicio, dataFim, cd_empresa } = req.query;

    let queryParams = [dataInicio, dataFim];
    let empresaWhereClause = '';

    if (cd_empresa) {
      const empresas = cd_empresa.includes(',')
        ? cd_empresa.split(',').map((s) => s.trim())
        : [cd_empresa];
      const placeholders = empresas
        .map((_, index) => `$${index + 3}`)
        .join(',');
      empresaWhereClause = `AND fr.cd_grupoempresa IN (${placeholders})`;
      queryParams.push(...empresas);
    }

    const query = `
      SELECT
        fr.cd_grupoempresa,
        fr.dt_transacao,
        fr.nm_grupoempresa,
        fr.valor_com_desconto,
        fr.valor_com_desconto_entrada,
        fr.valor_com_desconto_saida,
        fr.valor_sem_desconto,
        fr.valor_sem_desconto_entrada,
        fr.valor_sem_desconto_saida
      FROM fatrevenda fr
      WHERE fr.dt_transacao BETWEEN $1 AND $2
      ${empresaWhereClause}
      ORDER BY fr.dt_transacao, fr.cd_grupoempresa
    `;

    const result = await pool.query(query, queryParams);

    return successResponse(
      res,
      {
        data: result.rows,
        total: result.rows.length,
      },
      'Faturamento revenda recuperado com sucesso',
    );
  }),
);

// Endpoint para buscar faturamento franquias (view materializada)
router.get(
  '/fat-franquias',
  validateRequired(['dataInicio', 'dataFim']),
  validateDateFormat(['dataInicio', 'dataFim']),
  asyncHandler(async (req, res) => {
    const { dataInicio, dataFim, cd_empresa } = req.query;

    let queryParams = [dataInicio, dataFim];
    let empresaWhereClause = '';

    if (cd_empresa) {
      const empresas = cd_empresa.includes(',')
        ? cd_empresa.split(',').map((s) => s.trim())
        : [cd_empresa];
      const placeholders = empresas
        .map((_, index) => `$${index + 3}`)
        .join(',');
      empresaWhereClause = `AND ff.cd_grupoempresa IN (${placeholders})`;
      queryParams.push(...empresas);
    }

    const query = `
      SELECT
        ff.cd_grupoempresa,
        ff.dt_transacao,
        ff.nm_grupoempresa,
        ff.valor_com_desconto,
        ff.valor_com_desconto_entrada,
        ff.valor_com_desconto_saida,
        ff.valor_sem_desconto,
        ff.valor_sem_desconto_entrada,
        ff.valor_sem_desconto_saida
      FROM fatfranquias ff
      WHERE ff.dt_transacao BETWEEN $1 AND $2
      ${empresaWhereClause}
      ORDER BY ff.dt_transacao, ff.cd_grupoempresa
    `;

    const result = await pool.query(query, queryParams);

    return successResponse(
      res,
      {
        data: result.rows,
        total: result.rows.length,
      },
      'Faturamento franquias recuperado com sucesso',
    );
  }),
);

// ============================================================================
// ROTAS CMV (Custo de Mercadoria Vendida) - Views Materializadas
// ============================================================================

/**
 * GET /api/faturamento/cmv-varejo
 * Retorna dados de CMV do Varejo da view materializada cmv_varejo
 * Query params:
 *  - dataInicio (obrigatório): data inicial YYYY-MM-DD
 *  - dataFim (obrigatório): data final YYYY-MM-DD
 *  - cd_grupoempresa (opcional): filtro por grupo empresa (string ou array)
 */
router.get(
  '/cmv-varejo',
  validateRequired(['dataInicio', 'dataFim']),
  validateDateFormat(['dataInicio', 'dataFim']),
  asyncHandler(async (req, res) => {
    const { dataInicio, dataFim, cd_grupoempresa } = req.query;

    let query = `
      SELECT
        cv.cd_grupoempresa,
        cv.cmv,
        cv.dt_transacao,
        cv.nm_grupoempresa,
        cv.produtos_entrada,
        cv.produtos_saida,
        cv.nr_transacao
      FROM cmv_varejo cv
      WHERE cv.dt_transacao BETWEEN $1 AND $2
    `;

    const queryParams = [dataInicio, dataFim];

    // Filtro opcional por cd_grupoempresa
    if (cd_grupoempresa) {
      const empresas = Array.isArray(cd_grupoempresa)
        ? cd_grupoempresa
        : cd_grupoempresa.split(',').map((e) => e.trim());

      if (empresas.length > 0) {
        query += ` AND cv.cd_grupoempresa = ANY($3)`;
        queryParams.push(empresas);
      }
    }

    query += `
      ORDER BY cv.dt_transacao, cv.cd_grupoempresa
    `;

    const result = await pool.query(query, queryParams);

    return successResponse(
      res,
      {
        data: result.rows,
        total: result.rows.length,
      },
      'CMV Varejo recuperado com sucesso',
    );
  }),
);

/**
 * GET /api/faturamento/cmv-multimarcas
 * Retorna dados de CMV de Multimarcas da view materializada cmv_mtm
 * Query params:
 *  - dataInicio (obrigatório): data inicial YYYY-MM-DD
 *  - dataFim (obrigatório): data final YYYY-MM-DD
 *  - cd_grupoempresa (opcional): filtro por grupo empresa (string ou array)
 */
router.get(
  '/cmv-multimarcas',
  validateRequired(['dataInicio', 'dataFim']),
  validateDateFormat(['dataInicio', 'dataFim']),
  asyncHandler(async (req, res) => {
    const { dataInicio, dataFim, cd_grupoempresa } = req.query;

    let query = `
      SELECT
        cm.cd_grupoempresa,
        cm.cmv,
        cm.dt_transacao,
        cm.nm_grupoempresa,
        cm.produtos_entrada,
        cm.produtos_saida,
        cm.nr_transacao
      FROM cmv_mtm cm
      WHERE cm.dt_transacao BETWEEN $1 AND $2
    `;

    const queryParams = [dataInicio, dataFim];

    // Filtro opcional por cd_grupoempresa
    if (cd_grupoempresa) {
      const empresas = Array.isArray(cd_grupoempresa)
        ? cd_grupoempresa
        : cd_grupoempresa.split(',').map((e) => e.trim());

      if (empresas.length > 0) {
        query += ` AND cm.cd_grupoempresa = ANY($3)`;
        queryParams.push(empresas);
      }
    }

    query += `
      ORDER BY cm.dt_transacao, cm.cd_grupoempresa
    `;

    const result = await pool.query(query, queryParams);

    return successResponse(
      res,
      {
        data: result.rows,
        total: result.rows.length,
      },
      'CMV Multimarcas recuperado com sucesso',
    );
  }),
);

/**
 * GET /api/faturamento/cmv-revenda
 * Retorna dados de CMV de Revenda da view materializada cmv_revenda
 * Query params:
 *  - dataInicio (obrigatório): data inicial YYYY-MM-DD
 *  - dataFim (obrigatório): data final YYYY-MM-DD
 *  - cd_grupoempresa (opcional): filtro por grupo empresa (string ou array)
 */
router.get(
  '/cmv-revenda',
  validateRequired(['dataInicio', 'dataFim']),
  validateDateFormat(['dataInicio', 'dataFim']),
  asyncHandler(async (req, res) => {
    const { dataInicio, dataFim, cd_grupoempresa } = req.query;

    let query = `
      SELECT
        cr.cd_grupoempresa,
        cr.cmv,
        cr.dt_transacao,
        cr.nm_grupoempresa,
        cr.produtos_entrada,
        cr.produtos_saida,
        cr.nr_transacao
      FROM cmv_revenda cr
      WHERE cr.dt_transacao BETWEEN $1 AND $2
    `;

    const queryParams = [dataInicio, dataFim];

    // Filtro opcional por cd_grupoempresa
    if (cd_grupoempresa) {
      const empresas = Array.isArray(cd_grupoempresa)
        ? cd_grupoempresa
        : cd_grupoempresa.split(',').map((e) => e.trim());

      if (empresas.length > 0) {
        query += ` AND cr.cd_grupoempresa = ANY($3)`;
        queryParams.push(empresas);
      }
    }

    query += `
      ORDER BY cr.dt_transacao, cr.cd_grupoempresa
    `;

    const result = await pool.query(query, queryParams);

    return successResponse(
      res,
      {
        data: result.rows,
        total: result.rows.length,
      },
      'CMV Revenda recuperado com sucesso',
    );
  }),
);

/**
 * GET /api/faturamento/cmv-franquias
 * Retorna dados de CMV de Franquias da view materializada cmv_franquias
 * Query params:
 *  - dataInicio (obrigatório): data inicial YYYY-MM-DD
 *  - dataFim (obrigatório): data final YYYY-MM-DD
 *  - cd_grupoempresa (opcional): filtro por grupo empresa (string ou array)
 */
router.get(
  '/cmv-franquias',
  validateRequired(['dataInicio', 'dataFim']),
  validateDateFormat(['dataInicio', 'dataFim']),
  asyncHandler(async (req, res) => {
    const { dataInicio, dataFim, cd_grupoempresa } = req.query;

    let query = `
      SELECT
        cf.cd_grupoempresa,
        cf.cmv,
        cf.dt_transacao,
        cf.nm_grupoempresa,
        cf.produtos_entrada,
        cf.produtos_saida,
        cf.nr_transacao
      FROM cmv_franquias cf
      WHERE cf.dt_transacao BETWEEN $1 AND $2
    `;

    const queryParams = [dataInicio, dataFim];

    // Filtro opcional por cd_grupoempresa
    if (cd_grupoempresa) {
      const empresas = Array.isArray(cd_grupoempresa)
        ? cd_grupoempresa
        : cd_grupoempresa.split(',').map((e) => e.trim());

      if (empresas.length > 0) {
        query += ` AND cf.cd_grupoempresa = ANY($3)`;
        queryParams.push(empresas);
      }
    }

    query += `
      ORDER BY cf.dt_transacao, cf.cd_grupoempresa
    `;

    const result = await pool.query(query, queryParams);

    return successResponse(
      res,
      {
        data: result.rows,
        total: result.rows.length,
      },
      'CMV Franquias recuperado com sucesso',
    );
  }),
);

export default router;
