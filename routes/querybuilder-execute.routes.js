import express from 'express';
import pool from '../config/database.js';
import { logger } from '../utils/errorHandler.js';

const router = express.Router();

// =============================================================================
// VALIDAÇÃO DE QUERY BUILDER
// =============================================================================

/**
 * Valida e sanitiza os parâmetros da query
 */
function validateQueryParams(params) {
  const errors = [];

  // Validar SELECT
  if (
    !params.select ||
    !Array.isArray(params.select) ||
    params.select.length === 0
  ) {
    errors.push(
      'Campo "select" é obrigatório e deve conter ao menos uma coluna',
    );
  }

  // Validar FROM
  if (!params.from || typeof params.from !== 'string') {
    errors.push('Campo "from" é obrigatório e deve ser uma string');
  }

  // Validar WHERE (opcional)
  if (params.where && !Array.isArray(params.where)) {
    errors.push('Campo "where" deve ser um array');
  }

  // Validar cada condição WHERE
  if (params.where && Array.isArray(params.where)) {
    params.where.forEach((condition, index) => {
      if (!condition.column || typeof condition.column !== 'string') {
        errors.push(`Condição WHERE[${index}]: campo "column" é obrigatório`);
      }
      if (!condition.operator) {
        errors.push(`Condição WHERE[${index}]: campo "operator" é obrigatório`);
      }
      if (
        condition.value === undefined &&
        !['IS NULL', 'IS NOT NULL'].includes(condition.operator)
      ) {
        errors.push(
          `Condição WHERE[${index}]: campo "value" é obrigatório para este operador`,
        );
      }
    });
  }

  // Validar GROUP BY (opcional)
  if (params.groupBy && !Array.isArray(params.groupBy)) {
    errors.push('Campo "groupBy" deve ser um array');
  }

  // Validar ORDER BY (opcional)
  if (params.orderBy && !Array.isArray(params.orderBy)) {
    errors.push('Campo "orderBy" deve ser um array');
  }

  // Validar LIMIT
  if (params.limit !== undefined) {
    const limit = parseInt(params.limit);
    if (isNaN(limit) || limit < 1 || limit > 10000) {
      errors.push('Campo "limit" deve ser um número entre 1 e 10000');
    }
  }

  return errors;
}

/**
 * Sanitiza identificadores SQL (nomes de tabelas e colunas)
 */
function sanitizeIdentifier(identifier) {
  // Remove caracteres perigosos e mantém apenas alfanuméricos, underscore e ponto
  return identifier.replace(/[^\w.]/g, '');
}

/**
 * Retorna o operador SQL válido
 */
function getSafeOperator(operator) {
  const validOperators = {
    '=': '=',
    '!=': '!=',
    '<>': '<>',
    '>': '>',
    '<': '<',
    '>=': '>=',
    '<=': '<=',
    LIKE: 'LIKE',
    ILIKE: 'ILIKE',
    'NOT LIKE': 'NOT LIKE',
    'NOT ILIKE': 'NOT ILIKE',
    IN: 'IN',
    'NOT IN': 'NOT IN',
    BETWEEN: 'BETWEEN',
    'NOT BETWEEN': 'NOT BETWEEN',
    'IS NULL': 'IS NULL',
    'IS NOT NULL': 'IS NOT NULL',
  };

  return validOperators[operator.toUpperCase()] || '=';
}

/**
 * Constrói a cláusula WHERE de forma segura usando parametrização
 */
function buildWhereClause(conditions, startParamIndex = 1) {
  if (!conditions || conditions.length === 0) {
    return { clause: '', values: [] };
  }

  const clauses = [];
  const values = [];
  let paramIndex = startParamIndex;

  conditions.forEach((condition) => {
    const column = sanitizeIdentifier(condition.column);
    const operator = getSafeOperator(condition.operator);
    const logicOperator =
      condition.logic?.toUpperCase() === 'OR' ? 'OR' : 'AND';

    if (operator === 'IS NULL' || operator === 'IS NOT NULL') {
      clauses.push(`${column} ${operator}`);
    } else if (operator === 'IN' || operator === 'NOT IN') {
      // Para IN, esperamos um array de valores
      const valueArray = Array.isArray(condition.value)
        ? condition.value
        : [condition.value];
      const placeholders = valueArray.map(() => `$${paramIndex++}`).join(', ');
      clauses.push(`${column} ${operator} (${placeholders})`);
      values.push(...valueArray);
    } else if (operator === 'BETWEEN' || operator === 'NOT BETWEEN') {
      // Para BETWEEN, aceitar array [val1, val2] ou value + value2
      let val1, val2;

      if (Array.isArray(condition.value) && condition.value.length === 2) {
        val1 = condition.value[0];
        val2 = condition.value[1];
      } else if (condition.value && condition.value2) {
        val1 = condition.value;
        val2 = condition.value2;
      }

      if (val1 !== undefined && val2 !== undefined) {
        clauses.push(
          `${column} ${operator} $${paramIndex} AND $${paramIndex + 1}`,
        );
        values.push(val1, val2);
        paramIndex += 2;
      }
    } else if (operator.includes('LIKE')) {
      // Para LIKE, adicionar % se necessário
      let likeValue = condition.value;
      if (condition.likeMode === 'contains') {
        likeValue = `%${likeValue}%`;
      } else if (condition.likeMode === 'startsWith') {
        likeValue = `${likeValue}%`;
      } else if (condition.likeMode === 'endsWith') {
        likeValue = `%${likeValue}`;
      }
      clauses.push(`${column} ${operator} $${paramIndex++}`);
      values.push(likeValue);
    } else {
      clauses.push(`${column} ${operator} $${paramIndex++}`);
      values.push(condition.value);
    }

    // Adicionar operador lógico para próxima condição (exceto na última)
    if (clauses.length > 1) {
      clauses[clauses.length - 2] += ` ${logicOperator}`;
    }
  });

  return {
    clause: clauses.length > 0 ? `WHERE ${clauses.join(' ')}` : '',
    values,
  };
}

/**
 * Constrói a query SQL de forma segura
 */
function buildSafeQuery(params) {
  const select = params.select
    .map((col) => {
      // Se for string simples, converter para objeto
      if (typeof col === 'string') {
        return sanitizeIdentifier(col);
      }

      // Se for agregação, construir apropriadamente
      if (col.aggregation) {
        const func = col.aggregation.toUpperCase();
        const column = sanitizeIdentifier(col.column);
        const alias = col.alias ? ` AS ${sanitizeIdentifier(col.alias)}` : '';
        return `${func}(${column})${alias}`;
      }

      // Coluna simples (objeto)
      const column = sanitizeIdentifier(col.column || col);
      const alias = col.alias ? ` AS ${sanitizeIdentifier(col.alias)}` : '';
      return `${column}${alias}`;
    })
    .join(', ');

  const from = sanitizeIdentifier(params.from);

  // Construir WHERE
  const { clause: whereClause, values } = buildWhereClause(params.where);

  // Construir GROUP BY
  let groupByClause = '';
  if (params.groupBy && params.groupBy.length > 0) {
    const groupColumns = params.groupBy
      .map((col) => sanitizeIdentifier(col))
      .join(', ');
    groupByClause = `GROUP BY ${groupColumns}`;
  }

  // Construir ORDER BY
  let orderByClause = '';
  if (
    params.orderBy &&
    Array.isArray(params.orderBy) &&
    params.orderBy.length > 0
  ) {
    const orderColumns = params.orderBy
      .map((col) => {
        // Se for string simples
        if (typeof col === 'string') {
          return `${sanitizeIdentifier(col)} ASC`;
        }
        // Se for objeto
        const column = sanitizeIdentifier(col.column || col);
        const direction =
          col.direction?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
        return `${column} ${direction}`;
      })
      .join(', ');
    orderByClause = `ORDER BY ${orderColumns}`;
  }

  // LIMIT padrão de 1000 se não especificado
  const limit = params.limit ? parseInt(params.limit) : 1000;
  const limitClause = `LIMIT ${limit}`;

  // Montar query final
  const query = [
    `SELECT ${select}`,
    `FROM ${from}`,
    whereClause,
    groupByClause,
    orderByClause,
    limitClause,
  ]
    .filter(Boolean)
    .join('\n');

  return { query, values };
}

// =============================================================================
// ENDPOINT DE EXECUÇÃO DE QUERY
// =============================================================================

/**
 * POST /api/querybuilder/execute
 * Executa uma query construída dinamicamente
 */
router.post('/execute', async (req, res) => {
  try {
    const params = req.body;

    logger.info(
      '🔍 Executando query builder:',
      JSON.stringify(params, null, 2),
    );

    // Validar parâmetros
    const validationErrors = validateQueryParams(params);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Parâmetros inválidos',
        errors: validationErrors,
      });
    }

    // Construir query segura
    const { query, values } = buildSafeQuery(params);

    logger.info('📝 Query SQL gerada:', query);
    logger.info('📊 Valores:', values);

    // Executar query
    const startTime = Date.now();
    const result = await pool.query(query, values);
    const executionTime = Date.now() - startTime;

    logger.info(
      `✅ Query executada com sucesso em ${executionTime}ms - ${result.rows.length} registros`,
    );

    res.json({
      success: true,
      data: {
        rows: result.rows,
        totalRows: result.rows.length,
        columns: result.fields.map((field) => ({
          name: field.name,
          dataTypeID: field.dataTypeID,
        })),
        executionTime: `${executionTime}ms`,
        query: process.env.NODE_ENV === 'development' ? query : undefined,
      },
    });
  } catch (error) {
    logger.error('❌ Erro ao executar query:', error);

    // Tratar erros específicos do PostgreSQL
    let errorMessage = 'Erro ao executar consulta';
    let errorCode = 'QUERY_EXECUTION_ERROR';

    if (error.code === '42P01') {
      errorMessage = 'Tabela não encontrada';
      errorCode = 'TABLE_NOT_FOUND';
    } else if (error.code === '42703') {
      errorMessage = 'Coluna não encontrada';
      errorCode = 'COLUMN_NOT_FOUND';
    } else if (error.code === '42601') {
      errorMessage = 'Erro de sintaxe SQL';
      errorCode = 'SYNTAX_ERROR';
    }

    res.status(500).json({
      success: false,
      error: errorCode,
      message: errorMessage,
      details:
        process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// =============================================================================
// ENDPOINT DE PREVIEW (LIMIT 10)
// =============================================================================

/**
 * POST /api/querybuilder/preview
 * Executa preview da query com limit de 10 registros
 */
router.post('/preview', async (req, res) => {
  try {
    // Forçar limit de 10 para preview
    const params = { ...req.body, limit: 10 };

    logger.info('🔍 Executando PREVIEW:', JSON.stringify(params, null, 2));

    // Validar parâmetros
    const validationErrors = validateQueryParams(params);
    if (validationErrors.length > 0) {
      logger.error('❌ Validação falhou:', validationErrors);
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Parâmetros inválidos',
        errors: validationErrors,
      });
    }

    // Construir query segura
    const { query, values } = buildSafeQuery(params);

    logger.info('📝 Query SQL (preview):', query);
    logger.info('📊 Valores (preview):', values);

    // Executar query
    const startTime = Date.now();
    const result = await pool.query(query, values);
    const executionTime = Date.now() - startTime;

    logger.info(
      `✅ Preview executado com sucesso em ${executionTime}ms - ${result.rows.length} registros`,
    );

    res.json({
      success: true,
      data: {
        rows: result.rows,
        total: result.rows.length,
        columns: result.fields.map((field) => ({
          name: field.name,
          dataTypeID: field.dataTypeID,
        })),
      },
      executionTime: `${executionTime}ms`,
      query: process.env.NODE_ENV === 'development' ? query : undefined,
    });
  } catch (error) {
    logger.error('❌ Erro ao executar preview:', error);
    logger.error('❌ Error stack:', error.stack);

    // Tratar erros específicos do PostgreSQL
    let errorMessage = 'Erro ao executar preview';
    let errorCode = 'PREVIEW_ERROR';

    if (error.code === '42P01') {
      errorMessage = 'Tabela não encontrada';
      errorCode = 'TABLE_NOT_FOUND';
    } else if (error.code === '42703') {
      errorMessage = 'Coluna não encontrada';
      errorCode = 'COLUMN_NOT_FOUND';
    } else if (error.code === '42601') {
      errorMessage = 'Erro de sintaxe SQL';
      errorCode = 'SYNTAX_ERROR';
    }

    res.status(500).json({
      success: false,
      error: errorCode,
      message: errorMessage,
      details:
        process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

export default router;