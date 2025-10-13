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
router.get('/varejo', 
  validateRequired(['dataInicio', 'dataFim']),
  validateDateFormat(['dataInicio', 'dataFim']),
  asyncHandler(async (req, res) => {
    const { dataInicio, dataFim, cd_empresa } = req.query;
    
    let queryParams = [dataInicio, dataFim];
    let empresaWhereClause = '';
    
    if (cd_empresa) {
      // Se cd_empresa é uma string com vírgulas, trata como array
      const empresas = cd_empresa.includes(',') ? cd_empresa.split(',') : [cd_empresa];
      const placeholders = empresas.map((_, index) => `$${index + 3}`).join(',');
      empresaWhereClause = `AND fisnf.cd_empresa IN (${placeholders})`;
      queryParams.push(...empresas);
    } else {
      // Lista padrão de empresas
      empresaWhereClause = 'AND fisnf.cd_empresa IN (2, 5, 55, 65, 90, 91, 92, 93, 94, 95, 96, 97, 98, 200, 500, 550, 650, 890, 910, 920, 930, 940, 950, 960, 970, 980)';
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
    
    return successResponse(res, {
      data: result.rows,
      total: result.rows.length
    }, 'Faturamento varejo recuperado com sucesso');
  })
);

// Endpoint para buscar faturamento MTM (multimarcas)
router.get('/mtm', 
  validateRequired(['dataInicio', 'dataFim']),
  validateDateFormat(['dataInicio', 'dataFim']),
  asyncHandler(async (req, res) => {
    const { dataInicio, dataFim, cd_empresa } = req.query;
    
    let queryParams = [dataInicio, dataFim];
    let empresaWhereClause = '';
    
    if (cd_empresa) {
      // Se cd_empresa é uma string com vírgulas, trata como array
      const empresas = cd_empresa.includes(',') ? cd_empresa.split(',') : [cd_empresa];
      const placeholders = empresas.map((_, index) => `$${index + 3}`).join(',');
      empresaWhereClause = `AND fisnf.cd_empresa IN (${placeholders})`;
      queryParams.push(...empresas);
    } else {
      // Lista padrão de empresas
      empresaWhereClause = 'AND fisnf.cd_empresa IN (1, 2, 5, 6, 7, 11, 31, 55, 65, 75, 85, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99)';
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
    
    return successResponse(res, {
      data: result.rows,
      total: result.rows.length
    }, 'Faturamento MTM recuperado com sucesso');
  })
);

// Endpoint para buscar faturamento de franquias
router.get('/franquias', 
  validateRequired(['dataInicio', 'dataFim']),
  validateDateFormat(['dataInicio', 'dataFim']),
  asyncHandler(async (req, res) => {
    const { dataInicio, dataFim, cd_empresa } = req.query;
    
    let queryParams = [dataInicio, dataFim];
    let empresaWhereClause = '';
    
    if (cd_empresa) {
      // Se cd_empresa é uma string com vírgulas, trata como array
      const empresas = cd_empresa.includes(',') ? cd_empresa.split(',') : [cd_empresa];
      const placeholders = empresas.map((_, index) => `$${index + 3}`).join(',');
      empresaWhereClause = `AND fisnf.cd_empresa IN (${placeholders})`;
      queryParams.push(...empresas);
    } else {
      // Lista padrão de empresas
      empresaWhereClause = 'AND fisnf.cd_empresa IN (1, 2, 5, 6, 7, 11, 31, 55, 65, 75, 85, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99)';
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
    
    return successResponse(res, {
      data: result.rows,
      total: result.rows.length
    }, 'Faturamento franquias recuperado com sucesso');
  })
);

// Endpoint para buscar faturamento de revenda
router.get('/revenda', 
  validateRequired(['dataInicio', 'dataFim']),
  validateDateFormat(['dataInicio', 'dataFim']),
  asyncHandler(async (req, res) => {
    const { dataInicio, dataFim, cd_empresa } = req.query;
    
    let queryParams = [dataInicio, dataFim];
    let empresaWhereClause = '';
    
    if (cd_empresa) {
      // Se cd_empresa é uma string com vírgulas, trata como array
      const empresas = cd_empresa.includes(',') ? cd_empresa.split(',') : [cd_empresa];
      const placeholders = empresas.map((_, index) => `$${index + 3}`).join(',');
      empresaWhereClause = `AND fisnf.cd_empresa IN (${placeholders})`;
      queryParams.push(...empresas);
    } else {
      // Lista padrão de empresas
      empresaWhereClause = 'AND fisnf.cd_empresa IN (1, 2, 5, 6, 7, 11, 31, 55, 65, 75, 85, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99)';
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
    
    return successResponse(res, {
      data: result.rows,
      total: result.rows.length
    }, 'Faturamento revenda recuperado com sucesso');
  })
);

// Endpoint consolidado para buscar todos os tipos de faturamento
router.get('/consolidado', 
  validateRequired(['dataInicio', 'dataFim']),
  validateDateFormat(['dataInicio', 'dataFim']),
  asyncHandler(async (req, res) => {
    const { dataInicio, dataFim, cd_empresa } = req.query;
    
    let whereClause = 'WHERE dt_transacao BETWEEN $1 AND $2';
    let queryParams = [dataInicio, dataFim];
    
    if (cd_empresa) {
      // Se cd_empresa é uma string com vírgulas, trata como array
      const empresas = cd_empresa.includes(',') ? cd_empresa.split(',') : [cd_empresa];
      const placeholders = empresas.map((_, index) => `$${index + 3}`).join(',');
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
    const [varejoResult, mtmResult, franquiasResult, revendaResult] = await Promise.all([
      pool.query(varejoQuery, queryParams),
      pool.query(mtmQuery, queryParams),
      pool.query(franquiasQuery, queryParams),
      pool.query(revendaQuery, queryParams)
    ]);

    const data = {
      varejo: varejoResult.rows,
      mtm: mtmResult.rows,
      franquias: franquiasResult.rows,
      revenda: revendaResult.rows
    };

    return successResponse(res, data, 'Faturamento consolidado recuperado com sucesso');
  })
);

// Endpoint para análise de cashback
router.get('/analise-cashback', 
  asyncHandler(async (req, res) => {
    const query = `
      WITH trx_do_dia AS (
        SELECT
          t.*,
          DATE(t.dt_transacao) AS d_trans,
          ROW_NUMBER() OVER (
            PARTITION BY t.cd_pessoa, DATE(t.dt_transacao)
            ORDER BY t.dt_transacao DESC, t.nr_transacao DESC
          ) AS rn_dia
        FROM tra_transacao t
        WHERE t.tp_situacao = 4
          and t.cd_operacao <> 599
          and t.tp_operacao = 'S'
      )
      SELECT
        v.cd_pessoa,
        v.nr_voucher,
        v.vl_voucher,
        v.tp_situacao              AS tp_situacao_voucher,
        v.dt_cadastro              AS dt_voucher,
        t.nr_transacao,
        t.dt_transacao,
        t.vl_total,                -- líquido
        t.vl_desconto,
        -- BRUTO = total (líquido) + desconto
        (COALESCE(t.vl_total,0) + COALESCE(t.vl_desconto,0)) AS vl_bruto,
        -- % de desconto sobre o BRUTO
        ROUND(
          100.0 * COALESCE(t.vl_desconto,0)
          / NULLIF(COALESCE(t.vl_total,0) + COALESCE(t.vl_desconto,0), 0)
        , 2) AS pct_desconto_bruto,
        t.cd_empresa,
        t.tp_operacao,
        t.tp_situacao              AS tp_situacao_transacao
      FROM pdv_voucher v
      JOIN trx_do_dia t
        ON t.cd_pessoa = v.cd_pessoa
       AND t.d_trans = DATE(v.dt_cadastro)
       AND t.rn_dia = 1
      WHERE v.tp_situacao = 4
    `;

    const result = await pool.query(query);
    
    return successResponse(res, {
      data: result.rows,
      total: result.rows.length
    }, 'Análise de cashback recuperada com sucesso');
  })
);

export default router;