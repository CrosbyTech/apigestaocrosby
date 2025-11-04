import express from 'express';
import pool from '../config/database.js';

const router = express.Router();

/**
 * @route GET /api/widgets/views
 * @desc Busca todas as views/tabelas disponíveis no banco de dados
 * @access Private (Admin/Owner apenas)
 */
router.get('/views', async (req, res) => {
  let queryStartTime;
  try {
    queryStartTime = Date.now();
    
    // Query para listar todas as views do banco
    const query = `
      SELECT 
        table_name as name,
        table_type as type
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type IN ('VIEW', 'BASE TABLE')
      AND (table_name LIKE 'vw_%' OR table_name LIKE 'view_%')
      ORDER BY table_name;
    `;

    const result = await pool.query(query);

    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length,
    });
  } catch (error) {
    console.error('❌ Erro ao buscar views:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar views disponíveis',
      error: error.message,
    });
  } finally {
    if (queryStartTime) {
      const duration = Date.now() - queryStartTime;
      console.log(`⏱️  Query '/views' executada em ${duration}ms`);
    }
  }
});

/**
 * @route GET /api/widgets/views/:viewName/columns
 * @desc Busca todas as colunas de uma view específica
 * @access Private (Admin/Owner apenas)
 */
router.get('/views/:viewName/columns', async (req, res) => {
  let queryStartTime;
  try {
    queryStartTime = Date.now();
    const { viewName } = req.params;

    // Validação básica do nome da view
    if (!viewName || !/^[a-zA-Z0-9_]+$/.test(viewName)) {
      return res.status(400).json({
        success: false,
        message: 'Nome da view inválido',
      });
    }

    // Query para listar todas as colunas da view
    const query = `
      SELECT 
        column_name as name,
        data_type as type,
        is_nullable as nullable,
        column_default as default_value
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = $1
      ORDER BY ordinal_position;
    `;

    const result = await pool.query(query, [viewName]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'View não encontrada ou sem colunas',
      });
    }

    res.json({
      success: true,
      viewName: viewName,
      columns: result.rows,
      count: result.rows.length,
    });
  } catch (error) {
    console.error('❌ Erro ao buscar colunas da view:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar colunas da view',
      error: error.message,
    });
  } finally {
    if (queryStartTime) {
      const duration = Date.now() - queryStartTime;
      console.log(`⏱️  Query '/views/:viewName/columns' executada em ${duration}ms`);
    }
  }
});

/**
 * @route POST /api/widgets/query
 * @desc Executa uma query customizada (SELECT apenas) com filtros e agregações
 * @access Private (Admin/Owner apenas)
 * @body {
 *   viewName: string,
 *   columns: string[],
 *   filters: [{ column, operator, value, value2?, values? }],
 *   aggregations: [{ column, function }],
 *   orderBy: { column, direction },
 *   limit: number
 * }
 */
router.post('/query', async (req, res) => {
  let queryStartTime;
  let finalQuery;
  let queryParams;
  
  try {
    queryStartTime = Date.now();
    
    const {
      viewName,
      columns = [],
      filters = [],
      aggregations = [],
      orderBy = {},
      limit = 1000,
    } = req.body;

    // Validações
    if (!viewName || !/^[a-zA-Z0-9_]+$/.test(viewName)) {
      return res.status(400).json({
        success: false,
        message: 'Nome da view inválido',
      });
    }

    if (!columns || columns.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Selecione pelo menos uma coluna',
      });
    }

    // Validar nomes das colunas (apenas alfanuméricos e underscore)
    const invalidColumns = columns.filter(
      (col) => !/^[a-zA-Z0-9_]+$/.test(col),
    );
    if (invalidColumns.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Colunas inválidas: ${invalidColumns.join(', ')}`,
      });
    }

    // Construir SELECT com agregações
    let selectClause = [];
    let groupByClause = [];

    columns.forEach((col) => {
      const agg = aggregations.find((a) => a.column === col);
      if (agg && ['SUM', 'COUNT', 'AVG', 'MIN', 'MAX'].includes(agg.function)) {
        selectClause.push(`${agg.function}(${col}) as ${col}`);
      } else {
        selectClause.push(col);
        // Se houver agregações, colunas sem agregação vão para GROUP BY
        if (aggregations.length > 0) {
          groupByClause.push(col);
        }
      }
    });

    // Construir WHERE
    let whereClause = '';
    queryParams = [];
    let paramIndex = 1;

    if (filters && filters.length > 0) {
      const conditions = filters.map((filter) => {
        const { column, operator, value, value2, values } = filter;

        // Validar coluna
        if (!/^[a-zA-Z0-9_]+$/.test(column)) {
          throw new Error(`Coluna inválida: ${column}`);
        }

        // Construir condição baseada no operador
        switch (operator) {
          case '=':
          case '<>':
          case '>':
          case '>=':
          case '<':
          case '<=':
            queryParams.push(value);
            return `${column} ${operator} $${paramIndex++}`;

          case 'LIKE':
          case 'NOT LIKE':
            queryParams.push(`%${value}%`);
            return `${column} ${operator} $${paramIndex++}`;

          case 'BETWEEN':
            queryParams.push(value, value2);
            return `${column} BETWEEN $${paramIndex++} AND $${paramIndex++}`;

          case 'IN':
            if (!values || values.length === 0) {
              throw new Error('Operador IN requer valores');
            }
            const placeholders = values
              .map(() => `$${paramIndex++}`)
              .join(', ');
            queryParams.push(...values);
            return `${column} IN (${placeholders})`;

          case 'IS NULL':
            return `${column} IS NULL`;

          case 'IS NOT NULL':
            return `${column} IS NOT NULL`;

          default:
            throw new Error(`Operador inválido: ${operator}`);
        }
      });

      whereClause = `WHERE ${conditions.join(' AND ')}`;
    }

    // Construir ORDER BY
    let orderByClause = '';
    if (orderBy.column && columns.includes(orderBy.column)) {
      const direction = orderBy.direction === 'DESC' ? 'DESC' : 'ASC';
      orderByClause = `ORDER BY ${orderBy.column} ${direction}`;
    }

    // Construir GROUP BY
    let groupBySQL = '';
    if (groupByClause.length > 0) {
      groupBySQL = `GROUP BY ${groupByClause.join(', ')}`;
    }

    // Montar query final
    finalQuery = `
      SELECT ${selectClause.join(', ')}
      FROM ${viewName}
      ${whereClause}
      ${groupBySQL}
      ${orderByClause}
      LIMIT ${parseInt(limit) || 1000}
    `.trim();

    console.log('🔍 Executando query personalizada:', finalQuery);
    console.log('📊 Parâmetros:', queryParams);

    // Executar query
    const result = await pool.query(finalQuery, queryParams);

    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length,
      query: finalQuery, // Para debug (remover em produção)
      params: queryParams, // Para debug (remover em produção)
    });
  } catch (error) {
    console.error('❌ Erro ao executar query:', error);
    console.error('Query que falhou:', finalQuery);
    console.error('Parâmetros:', queryParams);
    
    res.status(500).json({
      success: false,
      message: 'Erro ao executar query',
      error: error.message,
    });
  } finally {
    if (queryStartTime) {
      const duration = Date.now() - queryStartTime;
      console.log(`⏱️  Query personalizada executada em ${duration}ms`);
    }
  }
});

/**
 * @route POST /api/widgets/validate-query
 * @desc Valida uma query sem executá-la (útil para preview)
 * @access Private
 */
router.post('/validate-query', async (req, res) => {
  let queryStartTime;
  try {
    queryStartTime = Date.now();
    const { viewName, columns } = req.body;

    // Validações básicas
    if (!viewName || !/^[a-zA-Z0-9_]+$/.test(viewName)) {
      return res.status(400).json({
        success: false,
        message: 'Nome da view inválido',
      });
    }

    if (!columns || columns.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Selecione pelo menos uma coluna',
      });
    }

    // Verificar se a view existe
    const viewCheck = await pool.query(
      `SELECT table_name FROM information_schema.tables 
       WHERE table_schema = 'public' AND table_name = $1`,
      [viewName],
    );

    if (viewCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'View não encontrada',
      });
    }

    // Verificar se as colunas existem na view
    const columnsCheck = await pool.query(
      `SELECT column_name FROM information_schema.columns 
       WHERE table_schema = 'public' AND table_name = $1 
       AND column_name = ANY($2)`,
      [viewName, columns],
    );

    const existingColumns = columnsCheck.rows.map((r) => r.column_name);
    const invalidColumns = columns.filter(
      (col) => !existingColumns.includes(col),
    );

    if (invalidColumns.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Colunas inválidas',
        invalidColumns,
      });
    }

    res.json({
      success: true,
      message: 'Query válida',
      viewName,
      columns: existingColumns,
    });
  } catch (error) {
    console.error('❌ Erro ao validar query:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao validar query',
      error: error.message,
    });
  } finally {
    if (queryStartTime) {
      const duration = Date.now() - queryStartTime;
      console.log(`⏱️  Validação de query executada em ${duration}ms`);
    }
  }
});

export default router;
