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
    
    let whereClause = 'WHERE f.dt_transacao BETWEEN $1 AND $2';
    let queryParams = [dataInicio, dataFim];
    
    if (cd_empresa) {
      // Se cd_empresa é uma string com vírgulas, trata como array
      const empresas = cd_empresa.includes(',') ? cd_empresa.split(',') : [cd_empresa];
      const placeholders = empresas.map((_, index) => `$${index + 3}`).join(',');
      whereClause += ` AND f.cd_empresa IN (${placeholders})`;
      queryParams.push(...empresas);
    }

    const query = `
      SELECT
        f.cd_empresa,
        f.nm_grupoempresa,
        SUM(f.vendas) as vendas,
        SUM(f.devolucoes) as devolucoes,
        SUM(f.total) as venda_liquida,
        SUM(f.frete) as frete,
        SUM(f.total + f.frete) as total
      FROM faturamentovarejo f
      ${whereClause}
      GROUP BY f.cd_empresa, f.nm_grupoempresa
      ORDER BY f.cd_empresa
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
    
    let whereClause = 'WHERE f.dt_transacao BETWEEN $1 AND $2';
    let queryParams = [dataInicio, dataFim];
    
    if (cd_empresa) {
      // Se cd_empresa é uma string com vírgulas, trata como array
      const empresas = cd_empresa.includes(',') ? cd_empresa.split(',') : [cd_empresa];
      const placeholders = empresas.map((_, index) => `$${index + 3}`).join(',');
      whereClause += ` AND f.cd_empresa IN (${placeholders})`;
      queryParams.push(...empresas);
    }

    const query = `
      SELECT
        f.cd_empresa,
        f.nm_grupoempresa,
        SUM(f.vendas) as vendas,
        SUM(f.devolucoes) as devolucoes,
        SUM(f.total) as venda_liquida,
        SUM(f.frete) as frete,
        SUM(f.total + f.frete) as total
      FROM faturamentomtm f
      ${whereClause}
      GROUP BY f.cd_empresa, f.nm_grupoempresa
      ORDER BY f.cd_empresa
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
    
    let whereClause = 'WHERE f.dt_transacao BETWEEN $1 AND $2';
    let queryParams = [dataInicio, dataFim];
    
    if (cd_empresa) {
      // Se cd_empresa é uma string com vírgulas, trata como array
      const empresas = cd_empresa.includes(',') ? cd_empresa.split(',') : [cd_empresa];
      const placeholders = empresas.map((_, index) => `$${index + 3}`).join(',');
      whereClause += ` AND f.cd_empresa IN (${placeholders})`;
      queryParams.push(...empresas);
    }

    const query = `
      SELECT
        f.cd_empresa,
        f.nm_grupoempresa,
        SUM(f.vendas) as vendas,
        SUM(f.devolucoes) as devolucoes,
        SUM(f.total) as venda_liquida,
        SUM(f.frete) as frete,
        SUM(f.total + f.frete) as total
      FROM faturamentofranquia f
      ${whereClause}
      GROUP BY f.cd_empresa, f.nm_grupoempresa
      ORDER BY f.cd_empresa
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
    
    let whereClause = 'WHERE f.dt_transacao BETWEEN $1 AND $2';
    let queryParams = [dataInicio, dataFim];
    
    if (cd_empresa) {
      // Se cd_empresa é uma string com vírgulas, trata como array
      const empresas = cd_empresa.includes(',') ? cd_empresa.split(',') : [cd_empresa];
      const placeholders = empresas.map((_, index) => `$${index + 3}`).join(',');
      whereClause += ` AND f.cd_empresa IN (${placeholders})`;
      queryParams.push(...empresas);
    }

    const query = `
      SELECT
        f.cd_empresa,
        f.nm_grupoempresa,
        SUM(f.vendas) as vendas,
        SUM(f.devolucoes) as devolucoes,
        SUM(f.total) as venda_liquida,
        SUM(f.frete) as frete,
        SUM(f.total + f.frete) as total
      FROM faturamentorevenda f
      ${whereClause}
      GROUP BY f.cd_empresa, f.nm_grupoempresa
      ORDER BY f.cd_empresa
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

export default router;