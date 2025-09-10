import express from 'express';
import pool from '../config/database.js';
import { validateRequired, validateDateFormat, validatePagination, sanitizeInput } from '../middlewares/validation.middleware.js';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';

const router = express.Router();

// Operações permitidas para faturamento (INCLUSIVAS)
const ALLOWED_OPERATIONS = [
  1,2,510,511,1511,521,1521,522,960,9001,9009,9027,8750,9017,9400,
  9401,9402,9403,9404,9005,545,546,555,548,1210,9405,1205,1101
];

const EXCLUDED_OPERATIONS = [
  1152, 590, 5153, 660, 9200, 2008, 536, 1153, 599, 5920, 5930, 1711, 7111, 
  2009, 5152, 6029, 530, 5152, 5930, 650, 5010, 600, 620, 40, 1557, 8600, 
  5910, 3336, 9003, 9052, 662, 5909, 5153, 5910, 3336, 9003, 530, 36, 536, 
  1552, 51, 1556, 2500, 1126, 1127, 8160, 1122, 1102, 9986, 1128, 1553, 
  1556, 9200, 8002, 2551, 1557, 8160, 2004, 5912, 1410, 5914, 1407, 5102, 
  520, 300, 200, 512, 1402, 1405, 1409, 5110, 5113, 17, 21, 401, 1201, 
  1202, 1204, 1206, 1950, 1999, 2203,522, 9001, 9009, 9027, 9017, 2, 1, 548, 555, 521, 599, 1152, 9200, 
  2008, 536, 1153, 599, 5920, 5930, 1711, 7111, 2009, 5152, 6029, 530, 
  5152, 5930, 650, 5010, 600, 620, 40, 1557, 2505, 8600, 590, 5153, 660, 
  5910, 3336, 9003, 9052, 662, 5909, 5153, 5910, 3336, 9003, 530, 36, 536, 
  1552, 51, 1556, 2500, 1126, 1127, 8160, 1122, 1102, 9986, 1128, 1553, 
  1556, 9200, 8002, 2551, 1557, 8160, 2004, 5912, 1410,1926,1903,1122,1128,1913,529,
  8160
];

/**
 * @route GET /sales/faturamento
 * @desc Buscar dados de faturamento geral (apenas operações permitidas)
 * @access Public
 * @query {dt_inicio, dt_fim, cd_empresa[]}
 */
router.get('/faturamento',
  sanitizeInput,
  validateDateFormat(['dt_inicio', 'dt_fim']),
  asyncHandler(async (req, res) => {
    const { dt_inicio = '2025-07-01', dt_fim = '2025-07-15', cd_empresa } = req.query;
    
    if (!cd_empresa) {
      return errorResponse(res, 'Parâmetro cd_empresa é obrigatório', 400, 'MISSING_PARAMETER');
    }

    // Seguir o padrão de performance do contas-pagar: múltiplas empresas, sem paginação/COUNT
    let empresas = Array.isArray(cd_empresa) ? cd_empresa : [cd_empresa];
    let params = [dt_inicio, dt_fim, ...empresas];
    let empresaPlaceholders = empresas.map((_, idx) => `$${3 + idx}`).join(',');

    // Otimização baseada no número de empresas e período
    const isHeavyQuery = empresas.length > 10 || (new Date(dt_fim) - new Date(dt_inicio)) > 30 * 24 * 60 * 60 * 1000; // 30 dias
    const isVeryHeavyQuery = empresas.length > 20 || (new Date(dt_fim) - new Date(dt_inicio)) > 90 * 24 * 60 * 60 * 1000; // 90 dias

    const query = isVeryHeavyQuery ? `
      SELECT
        vfn.cd_empresa,
        vfn.nm_grupoempresa,
        vfn.cd_operacao,
        vfn.cd_nivel,
        vfn.ds_nivel,
        vfn.dt_transacao,
        vfn.tp_situacao,
        vfn.vl_unitliquido,
        vfn.vl_unitbruto,
        vfn.tp_operacao,
        vfn.nr_transacao,
        vfn.qt_faturado,
        vfn.vl_freterat
      FROM vr_fis_nfitemprod vfn
      WHERE vfn.dt_transacao BETWEEN $1 AND $2
        AND vfn.cd_empresa IN (${empresaPlaceholders})
        AND vfn.cd_operacao IN (${ALLOWED_OPERATIONS.join(',')})
        AND vfn.tp_situacao NOT IN ('C', 'X')
      ORDER BY vfn.dt_transacao DESC
      LIMIT 50000
    ` : `
      SELECT
        vfn.cd_empresa,
        vfn.nm_grupoempresa,
        vfn.cd_operacao,
        vfn.cd_nivel,
        vfn.ds_nivel,
        vfn.dt_transacao,
        vfn.tp_situacao,
        vfn.vl_unitliquido,
        vfn.vl_unitbruto,
        vfn.tp_operacao,
        vfn.nr_transacao,
        vfn.qt_faturado,
        vfn.vl_freterat
      FROM vr_fis_nfitemprod vfn
      WHERE vfn.dt_transacao BETWEEN $1 AND $2
        AND vfn.cd_empresa IN (${empresaPlaceholders})
        AND vfn.cd_operacao IN (${ALLOWED_OPERATIONS.join(',')})
        AND vfn.tp_situacao NOT IN ('C', 'X')
      ORDER BY vfn.dt_transacao DESC
      ${isHeavyQuery ? 'LIMIT 100000' : ''}
    `;

    const queryType = isVeryHeavyQuery ? 'muito-pesada' : isHeavyQuery ? 'pesada' : 'completa';
    console.log(`🔍 Faturamento (INCLUSIVO): ${empresas.length} empresas, período: ${dt_inicio} a ${dt_fim}, query: ${queryType}`);

    const { rows } = await pool.query(query, params);

    // Totais agregados (como no contas-pagar)
    const totals = rows.reduce((acc, row) => {
      acc.totalBruto += parseFloat(row.vl_unitbruto || 0);
      acc.totalLiquido += parseFloat(row.vl_unitliquido || 0);
      acc.totalQuantidade += parseFloat(row.qt_faturado || 0);
      return acc;
    }, { totalBruto: 0, totalLiquido: 0, totalQuantidade: 0 });

    successResponse(res, {
      periodo: { dt_inicio, dt_fim },
      empresas,
      operacoes_permitidas: ALLOWED_OPERATIONS,
      totals,
      count: rows.length,
      optimized: isHeavyQuery || isVeryHeavyQuery,
      queryType: queryType,
      performance: {
        isHeavyQuery,
        isVeryHeavyQuery,
        diasPeriodo: Math.ceil((new Date(dt_fim) - new Date(dt_inicio)) / (1000 * 60 * 60 * 24)),
        limiteAplicado: isVeryHeavyQuery ? 50000 : isHeavyQuery ? 100000 : 'sem limite'
      },
      data: rows
    }, `Dados de faturamento obtidos com sucesso (${queryType}) - Operações INCLUSIVAS`);
  })
);

/**
 * @route GET /sales/faturamento-franquia
 * @desc Buscar faturamento específico de franquias
 * @access Public, FRANQUIA
 * @query {dt_inicio, dt_fim, cd_empresa[], nm_fantasia}
 */
router.get('/faturamento-franquia',
  sanitizeInput,
  validateDateFormat(['dt_inicio', 'dt_fim']),
  asyncHandler(async (req, res) => {
    const { dt_inicio = '2025-07-01', dt_fim = '2025-07-15', cd_empresa, nm_fantasia } = req.query;
    
    if (!cd_empresa) {
      return errorResponse(res, 'Parâmetro cd_empresa é obrigatório', 400, 'MISSING_PARAMETER');
    }

    // Seguir o padrão de performance do contas-pagar: múltiplas empresas, sem paginação/COUNT
    let empresas = Array.isArray(cd_empresa) ? cd_empresa : [cd_empresa];
    let params = [dt_inicio, dt_fim, ...empresas];
    let empresaPlaceholders = empresas.map((_, idx) => `$${3 + idx}`).join(',');
    
    let fantasiaWhere = '';
    if (nm_fantasia) {
      fantasiaWhere = `AND p.nm_fantasia = $${params.length + 1}`;
      params.push(nm_fantasia);
    } else {
      fantasiaWhere = `AND p.nm_fantasia LIKE 'F%CROSBY%'`;
    }

    // Otimização baseada no número de empresas e período
    const isHeavyQuery = empresas.length > 10 || (new Date(dt_fim) - new Date(dt_inicio)) > 30 * 24 * 60 * 60 * 1000; // 30 dias
    const isVeryHeavyQuery = empresas.length > 20 || (new Date(dt_fim) - new Date(dt_inicio)) > 90 * 24 * 60 * 60 * 1000; // 90 dias

    const query = isVeryHeavyQuery ? `
      SELECT
        vfn.cd_empresa,
        vfn.nm_grupoempresa,
        p.nm_fantasia,
        vfn.cd_operacao,
        vfn.cd_nivel,
        vfn.ds_nivel,
        vfn.dt_transacao,
        vfn.tp_situacao,
        vfn.vl_unitliquido,
        vfn.vl_unitbruto,
        vfn.tp_operacao,
        vfn.nr_transacao,
        vfn.qt_faturado,
        vfn.vl_freterat
      FROM vr_fis_nfitemprod vfn
      LEFT JOIN pes_pesjuridica p ON p.cd_pessoa = vfn.cd_pessoa   
      WHERE vfn.dt_transacao BETWEEN $1 AND $2
        AND vfn.cd_empresa IN (${empresaPlaceholders})
        AND vfn.cd_operacao NOT IN (${EXCLUDED_OPERATIONS.slice(0, 15).join(',')})
        AND vfn.tp_situacao NOT IN ('C', 'X')
        ${fantasiaWhere}
      ORDER BY vfn.dt_transacao DESC
      LIMIT 50000
    ` : `
      SELECT
        vfn.cd_empresa,
        vfn.nm_grupoempresa,
        p.nm_fantasia,
        vfn.cd_operacao,
        vfn.cd_nivel,
        vfn.ds_nivel,
        vfn.dt_transacao,
        vfn.tp_situacao,
        vfn.vl_unitliquido,
        vfn.vl_unitbruto,
        vfn.tp_operacao,
        vfn.nr_transacao,
        vfn.qt_faturado,
        vfn.vl_freterat
      FROM vr_fis_nfitemprod vfn
      LEFT JOIN pes_pesjuridica p ON p.cd_pessoa = vfn.cd_pessoa   
      WHERE vfn.dt_transacao BETWEEN $1 AND $2
        AND vfn.cd_empresa IN (${empresaPlaceholders})
        AND vfn.cd_operacao NOT IN (${EXCLUDED_OPERATIONS.slice(0, 20).join(',')})
        AND vfn.tp_situacao NOT IN ('C', 'X')
        ${fantasiaWhere}
      ORDER BY vfn.dt_transacao DESC
      ${isHeavyQuery ? 'LIMIT 100000' : ''}
    `;

    const queryType = isVeryHeavyQuery ? 'muito-pesada' : isHeavyQuery ? 'pesada' : 'completa';
    console.log(`🔍 Faturamento-franquia: ${empresas.length} empresas, período: ${dt_inicio} a ${dt_fim}, query: ${queryType}`);

    const { rows } = await pool.query(query, params);

    // Agrupar por fantasia
    const groupedData = rows.reduce((acc, row) => {
      const fantasia = row.nm_fantasia || 'Sem Fantasia';
      if (!acc[fantasia]) {
        acc[fantasia] = {
          nm_fantasia: fantasia,
          transactions: [],
          totals: { bruto: 0, liquido: 0, quantidade: 0 }
        };
      }
      acc[fantasia].transactions.push(row);
      acc[fantasia].totals.bruto += parseFloat(row.vl_unitbruto || 0);
      acc[fantasia].totals.liquido += parseFloat(row.vl_unitliquido || 0);
      acc[fantasia].totals.quantidade += parseFloat(row.qt_faturado || 0);
      return acc;
    }, {});

    successResponse(res, {
      periodo: { dt_inicio, dt_fim },
      empresas,
      count: rows.length,
      optimized: isHeavyQuery || isVeryHeavyQuery,
      queryType: queryType,
      performance: {
        isHeavyQuery,
        isVeryHeavyQuery,
        diasPeriodo: Math.ceil((new Date(dt_fim) - new Date(dt_inicio)) / (1000 * 60 * 60 * 24)),
        limiteAplicado: isVeryHeavyQuery ? 50000 : isHeavyQuery ? 100000 : 'sem limite'
      },
      groupedData: Object.values(groupedData)
    }, `Faturamento de franquias obtido com sucesso (${queryType})`);
  })
);

/**
 * @route GET /sales/faturamento-mtm
 * @desc Buscar faturamento MTM (Marca Terceira Mesa)
 * @access Public
 * @query {dt_inicio, dt_fim, cd_empresa[]}
 */
router.get('/faturamento-mtm',
  sanitizeInput,
  validateDateFormat(['dt_inicio', 'dt_fim']),
  asyncHandler(async (req, res) => {
    const { dt_inicio = '2025-07-01', dt_fim = '2025-07-15', cd_empresa } = req.query;
    
    if (!cd_empresa) {
      return errorResponse(res, 'Parâmetro cd_empresa é obrigatório', 400, 'MISSING_PARAMETER');
    }

    // Seguir o padrão de performance do contas-pagar: múltiplas empresas, sem paginação/COUNT
    let empresas = Array.isArray(cd_empresa) ? cd_empresa : [cd_empresa];
    let params = [dt_inicio, dt_fim, ...empresas];
    let empresaPlaceholders = empresas.map((_, idx) => `$${3 + idx}`).join(',');

    // Otimização baseada no número de empresas e período
    const isHeavyQuery = empresas.length > 10 || (new Date(dt_fim) - new Date(dt_inicio)) > 30 * 24 * 60 * 60 * 1000; // 30 dias
    const isVeryHeavyQuery = empresas.length > 20 || (new Date(dt_fim) - new Date(dt_inicio)) > 90 * 24 * 60 * 60 * 1000; // 90 dias

    const query = isVeryHeavyQuery ? `
      SELECT
        vfn.cd_empresa,
        vfn.nm_grupoempresa,
        p.cd_pessoa,
        p.nm_pessoa,
        pc.cd_classificacao,
        vfn.cd_operacao,
        vfn.tp_operacao,
        vfn.cd_nivel,
        vfn.ds_nivel,
        vfn.dt_transacao,
        vfn.vl_unitliquido,
        vfn.vl_unitbruto,
        vfn.nr_transacao,
        vfn.qt_faturado,
        vfn.vl_freterat
      FROM vr_fis_nfitemprod vfn
      LEFT JOIN pes_pessoa p ON p.cd_pessoa = vfn.cd_pessoa
      LEFT JOIN vr_pes_pessoaclas pc ON vfn.cd_pessoa = pc.cd_pessoa
      WHERE vfn.dt_transacao BETWEEN $1 AND $2
        AND vfn.cd_empresa IN (${empresaPlaceholders})
        AND vfn.cd_operacao NOT IN (${EXCLUDED_OPERATIONS.slice(0, 20).join(',')})
        AND vfn.tp_situacao NOT IN ('C', 'X')
        AND pc.cd_tipoclas = 5
      ORDER BY vfn.dt_transacao DESC
      LIMIT 50000
    ` : `
      SELECT
        vfn.cd_empresa,
        vfn.nm_grupoempresa,
        p.cd_pessoa,
        p.nm_pessoa,
        pc.cd_classificacao,
        vfn.cd_operacao,
        vfn.tp_operacao,
        vfn.cd_nivel,
        vfn.ds_nivel,
        vfn.dt_transacao,
        vfn.vl_unitliquido,
        vfn.vl_unitbruto,
        vfn.nr_transacao,
        vfn.qt_faturado,
        vfn.vl_freterat
      FROM vr_fis_nfitemprod vfn
      LEFT JOIN pes_pessoa p ON p.cd_pessoa = vfn.cd_pessoa
      LEFT JOIN vr_pes_pessoaclas pc ON vfn.cd_pessoa = pc.cd_pessoa
      WHERE vfn.dt_transacao BETWEEN $1 AND $2
        AND vfn.cd_empresa IN (${empresaPlaceholders})
        AND vfn.cd_operacao NOT IN (${EXCLUDED_OPERATIONS.slice(0, 25).join(',')})
        AND vfn.tp_situacao NOT IN ('C', 'X')
        AND pc.cd_tipoclas = 5
      ORDER BY vfn.dt_transacao DESC
      ${isHeavyQuery ? 'LIMIT 100000' : ''}
    `;

    const queryType = isVeryHeavyQuery ? 'muito-pesada' : isHeavyQuery ? 'pesada' : 'completa';
    console.log(`🔍 Faturamento-mtm: ${empresas.length} empresas, período: ${dt_inicio} a ${dt_fim}, query: ${queryType}`);

    const { rows } = await pool.query(query, params);

    // Totais agregados (como no contas-pagar)
    const totals = rows.reduce((acc, row) => {
      acc.totalBruto += parseFloat(row.vl_unitbruto || 0);
      acc.totalLiquido += parseFloat(row.vl_unitliquido || 0);
      acc.totalQuantidade += parseFloat(row.qt_faturado || 0);
      return acc;
    }, { totalBruto: 0, totalLiquido: 0, totalQuantidade: 0 });

    successResponse(res, {
      periodo: { dt_inicio, dt_fim },
      empresas,
      tipo: 'MTM',
      totals,
      count: rows.length,
      optimized: isHeavyQuery || isVeryHeavyQuery,
      queryType: queryType,
      performance: {
        isHeavyQuery,
        isVeryHeavyQuery,
        diasPeriodo: Math.ceil((new Date(dt_fim) - new Date(dt_inicio)) / (1000 * 60 * 60 * 24)),
        limiteAplicado: isVeryHeavyQuery ? 50000 : isHeavyQuery ? 100000 : 'sem limite'
      },
      data: rows
    }, `Faturamento MTM obtido com sucesso (${queryType})`);
  })
);

/**
 * @route GET /sales/faturamento-revenda
 * @desc Buscar faturamento de revenda
 * @access Public
 * @query {dt_inicio, dt_fim, cd_empresa[]}
 */
router.get('/faturamento-revenda',
  sanitizeInput,
  validateDateFormat(['dt_inicio', 'dt_fim']),
  asyncHandler(async (req, res) => {
    const { dt_inicio = '2025-06-01', dt_fim = '2025-07-15', cd_empresa } = req.query;
    
    if (!cd_empresa) {
      return errorResponse(res, 'Parâmetro cd_empresa é obrigatório', 400, 'MISSING_PARAMETER');
    }

    // Seguir o padrão de performance do contas-pagar: múltiplas empresas, sem paginação/COUNT
    let empresas = Array.isArray(cd_empresa) ? cd_empresa : [cd_empresa];
    let params = [dt_inicio, dt_fim, ...empresas];
    let empresaPlaceholders = empresas.map((_, idx) => `$${3 + idx}`).join(',');

    const excludedOperationsRevenda = [
      522, 9001, 9009, 9027, 9017, 2, 1, 548, 555, 521, 599, 1152, 9200, 
      2008, 536, 1153, 599, 5920, 5930, 1711, 7111, 2009, 5152, 6029, 530, 
      5152, 5930, 650, 5010, 600, 620, 40, 1557, 2505, 8600, 590, 5153, 660, 
      5910, 3336, 9003, 9052, 662, 5909, 5153, 5910, 3336, 9003, 530, 36, 536, 
      1552, 51, 1556, 2500, 1126, 1127, 8160, 1122, 1102, 9986, 1128, 1553, 
      1556, 9200, 8002, 2551, 1557, 8160, 2004, 5912, 1410,1926,1903,1122,1128,1913,8160,10,529
    ];

    // Otimização baseada no número de empresas e período
    const isHeavyQuery = empresas.length > 10 || (new Date(dt_fim) - new Date(dt_inicio)) > 30 * 24 * 60 * 60 * 1000; // 30 dias
    const isVeryHeavyQuery = empresas.length > 20 || (new Date(dt_fim) - new Date(dt_inicio)) > 90 * 24 * 60 * 60 * 1000; // 90 dias

    const query = isVeryHeavyQuery ? `
      SELECT
        vfn.cd_grupoempresa,
        vfn.nm_grupoempresa,
        p.cd_pessoa,
        p.nm_pessoa,
        pc.cd_tipoclas,
        pc.cd_classificacao,
        vfn.cd_operacao,
        vfn.cd_nivel,
        vfn.ds_nivel,
        vfn.dt_transacao,
        vfn.tp_situacao,
        vfn.vl_unitliquido,
        vfn.vl_unitbruto,
        vfn.tp_operacao,
        vfn.nr_transacao,
        vfn.qt_faturado,
        vfn.vl_freterat
      FROM vr_fis_nfitemprod vfn
      LEFT JOIN pes_pessoa p ON p.cd_pessoa = vfn.cd_pessoa
      LEFT JOIN vr_pes_pessoaclas pc ON vfn.cd_pessoa = pc.cd_pessoa
      WHERE vfn.dt_transacao BETWEEN $1 AND $2
        AND vfn.cd_empresa IN (${empresaPlaceholders})
        AND vfn.cd_operacao NOT IN (${excludedOperationsRevenda.slice(0, 30).join(',')})
        AND pc.cd_tipoclas in (20,7)
        AND pc.cd_classificacao::integer in (3,1)
        AND vfn.tp_situacao NOT IN ('C', 'X')
      ORDER BY vfn.dt_transacao DESC
      LIMIT 50000
    ` : `
      SELECT
        vfn.cd_grupoempresa,
        vfn.nm_grupoempresa,
        p.cd_pessoa,
        p.nm_pessoa,
        pc.cd_tipoclas,
        pc.cd_classificacao,
        vfn.cd_operacao,
        vfn.cd_nivel,
        vfn.ds_nivel,
        vfn.dt_transacao,
        vfn.tp_situacao,
        vfn.vl_unitliquido,
        vfn.vl_unitbruto,
        vfn.tp_operacao,
        vfn.nr_transacao,
        vfn.qt_faturado,
        vfn.vl_freterat
      FROM vr_fis_nfitemprod vfn
      LEFT JOIN pes_pessoa p ON p.cd_pessoa = vfn.cd_pessoa
      LEFT JOIN vr_pes_pessoaclas pc ON vfn.cd_pessoa = pc.cd_pessoa
      WHERE vfn.dt_transacao BETWEEN $1 AND $2
        AND vfn.cd_empresa IN (${empresaPlaceholders})
        AND vfn.cd_operacao NOT IN (${excludedOperationsRevenda.join(',')})
        AND pc.cd_tipoclas in (20,7)
        AND pc.cd_classificacao::integer in (3,1)
        AND vfn.tp_situacao NOT IN ('C', 'X')
      ORDER BY vfn.dt_transacao DESC
      ${isHeavyQuery ? 'LIMIT 100000' : ''}
    `;

    const queryType = isVeryHeavyQuery ? 'muito-pesada' : isHeavyQuery ? 'pesada' : 'completa';
    console.log(`🔍 Faturamento-revenda: ${empresas.length} empresas, período: ${dt_inicio} a ${dt_fim}, query: ${queryType}`);

    const { rows } = await pool.query(query, params);

    // Totais agregados (como no contas-pagar)
    const totals = rows.reduce((acc, row) => {
      acc.totalBruto += parseFloat(row.vl_unitbruto || 0);
      acc.totalLiquido += parseFloat(row.vl_unitliquido || 0);
      acc.totalQuantidade += parseFloat(row.qt_faturado || 0);
      return acc;
    }, { totalBruto: 0, totalLiquido: 0, totalQuantidade: 0 });

    successResponse(res, {
      periodo: { dt_inicio, dt_fim },
      empresas,
      tipo: 'Revenda',
      totals,
      count: rows.length,
      optimized: isHeavyQuery || isVeryHeavyQuery,
      queryType: queryType,
      performance: {
        isHeavyQuery,
        isVeryHeavyQuery,
        diasPeriodo: Math.ceil((new Date(dt_fim) - new Date(dt_inicio)) / (1000 * 60 * 60 * 24)),
        limiteAplicado: isVeryHeavyQuery ? 50000 : isHeavyQuery ? 100000 : 'sem limite'
      },
      data: rows
    }, `Faturamento de revenda obtido com sucesso (${queryType})`);
  })
);

/**
 * @route GET /sales/ranking-vendedores
 * @desc Buscar ranking de vendedores por período
 * @access Public
 * @query {inicio, fim, limit, offset}
 */
router.get('/ranking-vendedores',
  sanitizeInput,
  validateRequired(['inicio', 'fim']),
  validateDateFormat(['inicio', 'fim']),
  validatePagination,
  asyncHandler(async (req, res) => {
    const { inicio, fim } = req.query;
    const limit = parseInt(req.query.limit, 10) || 100; // Limite padrão mais razoável
    const offset = parseInt(req.query.offset, 10) || 0;
    
    const dataInicio = `${inicio} 00:00:00`;
    const dataFim = `${fim} 23:59:59`;

    const excludedGroups = [1,3,4,6,7,8,9,10,31,50,51,45,75,85,99];
    const allowedOperations = [
      1,2,510,511,1511,521,1521,522,960,9001,9009,9027,8750,9017,9400,
      9401,9402,9403,9404,9005,545,546,555,548,1210,9405,1205,1101
    ];

    // Query otimizada com LIMIT para evitar sobrecarga
    const query = `
      SELECT
        A.CD_VENDEDOR AS vendedor,
        A.NM_VENDEDOR AS nome_vendedor,
        B.CD_COMPVEND,
        SUM(
          CASE
            WHEN B.TP_OPERACAO = 'E' AND B.TP_SITUACAO = 4 THEN COALESCE(B.QT_SOLICITADA, 0)
            ELSE 0
          END
        ) AS pa_entrada,
        SUM(
          CASE
            WHEN B.TP_OPERACAO = 'S' AND B.TP_SITUACAO = 4 THEN COALESCE(B.QT_SOLICITADA, 0)
            ELSE 0
          END
        ) AS pa_saida,
        COUNT(*) FILTER (WHERE B.TP_SITUACAO = 4 AND B.TP_OPERACAO = 'S') AS transacoes_saida,
        COUNT(*) FILTER (WHERE B.TP_SITUACAO = 4 AND B.TP_OPERACAO = 'E') AS transacoes_entrada,
        COALESCE(
          (
            SUM(
              CASE
                WHEN B.TP_SITUACAO = 4 AND B.TP_OPERACAO = 'S' THEN COALESCE(B.VL_TOTAL, 0)
                WHEN B.TP_SITUACAO = 4 AND B.TP_OPERACAO = 'E' THEN -COALESCE(B.VL_TOTAL, 0)
                ELSE 0
              END
            )
            -
            SUM(
              CASE
                WHEN B.TP_SITUACAO = 4 AND B.TP_OPERACAO IN ('S', 'E') THEN COALESCE(B.VL_FRETE, 0)
                ELSE 0
              END
            )
          ), 0
        ) AS faturamento
      FROM PES_VENDEDOR A
      INNER JOIN TRA_TRANSACAO B ON A.CD_VENDEDOR = B.CD_COMPVEND
      WHERE B.TP_SITUACAO = 4
        AND B.TP_OPERACAO IN ('S', 'E')
        AND B.CD_GRUPOEMPRESA NOT IN (${excludedGroups.join(',')})
        AND B.CD_OPERACAO IN (${allowedOperations.join(',')})
        AND B.DT_TRANSACAO BETWEEN $1::timestamp AND $2::timestamp
      GROUP BY A.CD_VENDEDOR, A.NM_VENDEDOR, B.CD_COMPVEND
      HAVING COALESCE(
        (
          SUM(
            CASE
              WHEN B.TP_SITUACAO = 4 AND B.TP_OPERACAO = 'S' THEN COALESCE(B.VL_TOTAL, 0)
              WHEN B.TP_SITUACAO = 4 AND B.TP_OPERACAO = 'E' THEN -COALESCE(B.VL_TOTAL, 0)
              ELSE 0
            END
          )
          -
          SUM(
            CASE
              WHEN B.TP_SITUACAO = 4 AND B.TP_OPERACAO IN ('S', 'E') THEN COALESCE(B.VL_FRETE, 0)
              ELSE 0
            END
          )
        ), 0
      ) > 0
      ORDER BY faturamento DESC
      LIMIT $3 OFFSET $4
    `;

    // Query de contagem simplificada
    const countQuery = `
      SELECT COUNT(DISTINCT A.CD_VENDEDOR) as total
      FROM PES_VENDEDOR A
      INNER JOIN TRA_TRANSACAO B ON A.CD_VENDEDOR = B.CD_COMPVEND
      WHERE B.TP_SITUACAO = 4
        AND B.TP_OPERACAO IN ('S', 'E')
        AND B.CD_GRUPOEMPRESA NOT IN (${excludedGroups.join(',')})
        AND B.CD_OPERACAO IN (${allowedOperations.join(',')})
        AND B.DT_TRANSACAO BETWEEN $1::timestamp AND $2::timestamp
    `;

    console.log(`🔍 Ranking-vendedores: período ${dataInicio} a ${dataFim}, limit: ${limit}, offset: ${offset}`);

    try {
      const [resultado, totalResult] = await Promise.all([
        pool.query(query, [dataInicio, dataFim, limit, offset]),
        pool.query(countQuery, [dataInicio, dataFim])
      ]);

      const total = parseInt(totalResult.rows[0]?.total || 0, 10);

      successResponse(res, {
        total,
        limit,
        offset,
        hasMore: (offset + limit) < total,
        periodo: { inicio: dataInicio, fim: dataFim },
        data: resultado.rows
      }, 'Ranking de vendedores obtido com sucesso');
    } catch (error) {
      console.error('❌ Erro na query de ranking de vendedores:', error);
      throw error;
    }
  })
);

/**
 * @route GET /sales/ranking-vendedores-simples
 * @desc Buscar ranking de vendedores simplificado (versão de teste)
 * @access Public
 * @query {inicio, fim}
 */
router.get('/ranking-vendedores-simples',
  sanitizeInput,
  validateRequired(['inicio', 'fim']),
  validateDateFormat(['inicio', 'fim']),
  asyncHandler(async (req, res) => {
    const { inicio, fim } = req.query;
    
    const dataInicio = `${inicio} 00:00:00`;
    const dataFim = `${fim} 23:59:59`;

    // Query simplificada para teste
    const query = `
      SELECT
        A.CD_VENDEDOR AS vendedor,
        A.NM_VENDEDOR AS nome_vendedor,
        COUNT(*) as total_transacoes,
        SUM(COALESCE(B.VL_TOTAL, 0)) as faturamento_total
      FROM PES_VENDEDOR A
      INNER JOIN TRA_TRANSACAO B ON A.CD_VENDEDOR = B.CD_COMPVEND
      WHERE B.TP_SITUACAO = 4
        AND B.TP_OPERACAO = 'S'
        AND B.DT_TRANSACAO BETWEEN $1::timestamp AND $2::timestamp
      GROUP BY A.CD_VENDEDOR, A.NM_VENDEDOR
      ORDER BY faturamento_total DESC
      LIMIT 50
    `;

    console.log(`🔍 Ranking-vendedores-simples: período ${dataInicio} a ${dataFim}`);

    try {
      const resultado = await pool.query(query, [dataInicio, dataFim]);

      successResponse(res, {
        periodo: { inicio: dataInicio, fim: dataFim },
        count: resultado.rows.length,
        data: resultado.rows
      }, 'Ranking de vendedores simplificado obtido com sucesso');
    } catch (error) {
      console.error('❌ Erro na query de ranking de vendedores simplificado:', error);
      throw error;
    }
  })
);

/**
 * @route GET /sales/ranking-vendedores-test
 * @desc Teste básico de conexão e query simples
 * @access Public
 */
router.get('/ranking-vendedores-test',
  asyncHandler(async (req, res) => {
    try {
      // Teste simples de conexão
      const testQuery = `
        SELECT 
          COUNT(*) as total_vendedores
        FROM PES_VENDEDOR
        LIMIT 1
      `;
      
      const resultado = await pool.query(testQuery);
      
      successResponse(res, {
        message: 'Teste de conexão bem-sucedido',
        total_vendedores: resultado.rows[0]?.total_vendedores || 0,
        timestamp: new Date().toISOString()
      }, 'Teste de ranking de vendedores executado com sucesso');
    } catch (error) {
      console.error('❌ Erro no teste de ranking de vendedores:', error);
      throw error;
    }
  })
);

// ----------------------------------------------------------------------------------------------

/**
 * @route GET /sales/receitaliquida-faturamento
 * @desc Faturamento (receita líquida) com colunas reduzidas
 * @access Public
 * @query {dt_inicio, dt_fim, cd_empresa[]}
 */
router.get('/receitaliquida-faturamento',
  sanitizeInput,
  validateDateFormat(['dt_inicio', 'dt_fim']),
  asyncHandler(async (req, res) => {
    const { dt_inicio = '2025-07-01', dt_fim = '2025-07-15', cd_empresa } = req.query;
    if (!cd_empresa) return errorResponse(res, 'Parâmetro cd_empresa é obrigatório', 400, 'MISSING_PARAMETER');

    const empresas = Array.isArray(cd_empresa) ? cd_empresa : [cd_empresa];
    const params = [dt_inicio, dt_fim, ...empresas];
    const empresaPlaceholders = empresas.map((_, idx) => `$${3 + idx}`).join(',');

    const query = `
      SELECT
        p.cd_pessoa,
        p.nm_pessoa,
        pc.cd_tipoclas,
        pc.cd_classificacao,
        vfn.vl_unitliquido,
        vfn.vl_unitbruto,
        vfn.tp_operacao,
        vfn.nr_transacao,
        vfn.vl_freterat,
        vfn.vl_icms
      FROM vr_fis_nfitemprod vfn
      LEFT JOIN pes_pessoa p ON p.cd_pessoa = vfn.cd_pessoa
      LEFT JOIN vr_pes_pessoaclas pc ON vfn.cd_pessoa = pc.cd_pessoa
      WHERE vfn.dt_transacao BETWEEN $1 AND $2
        AND vfn.cd_empresa IN (${empresaPlaceholders})
        AND vfn.cd_operacao IN (${ALLOWED_OPERATIONS.join(',')})
        AND vfn.tp_situacao NOT IN ('C', 'X')
    `;

    const { rows } = await pool.query(query, params);
    successResponse(res, { periodo: { dt_inicio, dt_fim }, empresas, tipo: 'Faturamento', count: rows.length, data: rows }, 'Receita líquida - faturamento obtida com sucesso');
  })
);

/**
 * @route GET /sales/receitaliquida-franquias
 * @desc Faturamento Franquias (receita líquida) com colunas reduzidas
 * @access Public
 * @query {dt_inicio, dt_fim, cd_empresa[], nm_fantasia}
 */
router.get('/receitaliquida-franquias',
  sanitizeInput,
  validateDateFormat(['dt_inicio', 'dt_fim']),
  asyncHandler(async (req, res) => {
    const { dt_inicio = '2025-07-01', dt_fim = '2025-07-15', cd_empresa, nm_fantasia } = req.query;
    if (!cd_empresa) return errorResponse(res, 'Parâmetro cd_empresa é obrigatório', 400, 'MISSING_PARAMETER');

    const empresas = Array.isArray(cd_empresa) ? cd_empresa : [cd_empresa];
    const params = [dt_inicio, dt_fim, ...empresas];
    const empresaPlaceholders = empresas.map((_, idx) => `$${3 + idx}`).join(',');

    let fantasiaWhere = '';
    if (nm_fantasia) {
      fantasiaWhere = `AND pj.nm_fantasia = $${params.length + 1}`;
      params.push(nm_fantasia);
    } else {
      fantasiaWhere = `AND pj.nm_fantasia LIKE 'F%CROSBY%'`;
    }

    const query = `
      SELECT
        p.cd_pessoa,
        p.nm_pessoa,
        pc.cd_tipoclas,
        pc.cd_classificacao,
        vfn.vl_unitliquido,
        vfn.vl_unitbruto,
        vfn.tp_operacao,
        vfn.nr_transacao,
        vfn.vl_freterat,
        vfn.vl_icms
      FROM vr_fis_nfitemprod vfn
      LEFT JOIN pes_pessoa p ON p.cd_pessoa = vfn.cd_pessoa
      LEFT JOIN pes_pesjuridica pj ON pj.cd_pessoa = vfn.cd_pessoa
      LEFT JOIN vr_pes_pessoaclas pc ON vfn.cd_pessoa = pc.cd_pessoa
      WHERE vfn.dt_transacao BETWEEN $1 AND $2
        AND vfn.cd_empresa IN (${empresaPlaceholders})
        AND vfn.cd_operacao NOT IN (${EXCLUDED_OPERATIONS.join(',')})
        AND vfn.tp_situacao NOT IN ('C', 'X')
        ${fantasiaWhere}
    `;

    const { rows } = await pool.query(query, params);
    successResponse(res, { periodo: { dt_inicio, dt_fim }, empresas, tipo: 'Franquias', count: rows.length, data: rows }, 'Receita líquida - franquias obtida com sucesso');
  })
);

/**
 * @route GET /sales/receitaliquida-mtm
 * @desc Faturamento MTM (receita líquida) com colunas reduzidas
 * @access Public
 * @query {dt_inicio, dt_fim, cd_empresa[]}
 */
router.get('/receitaliquida-mtm',
  sanitizeInput,
  validateDateFormat(['dt_inicio', 'dt_fim']),
  asyncHandler(async (req, res) => {
    const { dt_inicio = '2025-07-01', dt_fim = '2025-07-15', cd_empresa } = req.query;
    if (!cd_empresa) return errorResponse(res, 'Parâmetro cd_empresa é obrigatório', 400, 'MISSING_PARAMETER');

    const empresas = Array.isArray(cd_empresa) ? cd_empresa : [cd_empresa];
    const params = [dt_inicio, dt_fim, ...empresas];
    const empresaPlaceholders = empresas.map((_, idx) => `$${3 + idx}`).join(',');

    const query = `
      SELECT
        p.cd_pessoa,
        p.nm_pessoa,
        pc.cd_tipoclas,
        pc.cd_classificacao,
        vfn.vl_unitliquido,
        vfn.vl_unitbruto,
        vfn.tp_operacao,
        vfn.nr_transacao,
        vfn.vl_freterat,
        vfn.vl_icms
      FROM vr_fis_nfitemprod vfn
      LEFT JOIN pes_pessoa p ON p.cd_pessoa = vfn.cd_pessoa
      LEFT JOIN vr_pes_pessoaclas pc ON vfn.cd_pessoa = pc.cd_pessoa
      WHERE vfn.dt_transacao BETWEEN $1 AND $2
        AND vfn.cd_empresa IN (${empresaPlaceholders})
        AND vfn.cd_operacao NOT IN (${EXCLUDED_OPERATIONS.join(',')})
        AND vfn.tp_situacao NOT IN ('C', 'X')
        AND pc.cd_tipoclas = 5
    `;

    const { rows } = await pool.query(query, params);
    successResponse(res, { periodo: { dt_inicio, dt_fim }, empresas, tipo: 'MTM', count: rows.length, data: rows }, 'Receita líquida - MTM obtida com sucesso');
  })
);

/**
 * @route GET /sales/receitaliquida-revenda
 * @desc Faturamento Revenda (receita líquida) com colunas reduzidas
 * @access Public
 * @query {dt_inicio, dt_fim, cd_empresa[]}
 */
router.get('/receitaliquida-revenda',
  sanitizeInput,
  validateDateFormat(['dt_inicio', 'dt_fim']),
  asyncHandler(async (req, res) => {
    const { dt_inicio = '2025-06-01', dt_fim = '2025-07-15', cd_empresa } = req.query;
    if (!cd_empresa) return errorResponse(res, 'Parâmetro cd_empresa é obrigatório', 400, 'MISSING_PARAMETER');

    const empresas = Array.isArray(cd_empresa) ? cd_empresa : [cd_empresa];
    const params = [dt_inicio, dt_fim, ...empresas];
    const empresaPlaceholders = empresas.map((_, idx) => `$${3 + idx}`).join(',');

    const excludedOperationsRevenda = [
      522, 9001, 9009, 9027, 9017, 2, 1, 548, 555, 521, 599, 1152, 9200, 
      2008, 536, 1153, 599, 5920, 5930, 1711, 7111, 2009, 5152, 6029, 530, 
      5152, 5930, 650, 5010, 600, 620, 40, 1557, 2505, 8600, 590, 5153, 660, 
      5910, 3336, 9003, 9052, 662, 5909, 5153, 5910, 3336, 9003, 530, 36, 536, 
      1552, 51, 1556, 2500, 1126, 1127, 8160, 1122, 1102, 9986, 1128, 1553, 
      1556, 9200, 8002, 2551, 1557, 8160, 2004, 5912, 1410,1926,1903,1122,1128,1913,8160,10,529
    ];

    const query = `
      SELECT
        p.cd_pessoa,
        p.nm_pessoa,
        pc.cd_tipoclas,
        pc.cd_classificacao,
        vfn.vl_unitliquido,
        vfn.vl_unitbruto,
        vfn.tp_operacao,
        vfn.nr_transacao,
        vfn.vl_freterat,
        vfn.vl_icms
      FROM vr_fis_nfitemprod vfn
      LEFT JOIN pes_pessoa p ON p.cd_pessoa = vfn.cd_pessoa
      LEFT JOIN vr_pes_pessoaclas pc ON vfn.cd_pessoa = pc.cd_pessoa
      WHERE vfn.dt_transacao BETWEEN $1 AND $2
        AND vfn.cd_empresa IN (${empresaPlaceholders})
        AND vfn.cd_operacao NOT IN (${excludedOperationsRevenda.join(',')})
        AND pc.cd_tipoclas in (20,7)
        AND pc.cd_classificacao::integer in (3,1)
        AND vfn.tp_situacao NOT IN ('C', 'X')
    `;

    const { rows } = await pool.query(query, params);
    successResponse(res, { periodo: { dt_inicio, dt_fim }, empresas, tipo: 'Revenda', count: rows.length, data: rows }, 'Receita líquida - revenda obtida com sucesso');
  })
);


export default router;