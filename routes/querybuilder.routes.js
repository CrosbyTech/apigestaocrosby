import express from 'express';
import pool from '../config/database.js';
import { logger } from '../utils/errorHandler.js';

const router = express.Router();

// =============================================================================
// LISTAGEM DE TABELAS DISPONÍVEIS
// =============================================================================

/**
 * GET /api/querybuilder/tables
 * Retorna lista de todas as tabelas acessíveis no banco de dados
 */
router.get('/tables', async (req, res) => {
  try {
    logger.info('📊 Buscando lista de tabelas disponíveis');

    const query = `
      SELECT 
        table_schema as schema,
        table_name as name,
        table_type as type
      FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        AND table_type = 'BASE TABLE'
      ORDER BY table_schema, table_name;
    `;

    const result = await pool.query(query);

    // Agrupar tabelas por schema
    const tablesBySchema = result.rows.reduce((acc, table) => {
      if (!acc[table.schema]) {
        acc[table.schema] = [];
      }
      acc[table.schema].push({
        name: table.name,
        fullName: `${table.schema}.${table.name}`,
        schema: table.schema,
        type: table.type,
      });
      return acc;
    }, {});

    logger.info(`✅ ${result.rows.length} tabelas encontradas`);

    res.json({
      success: true,
      data: {
        tables: result.rows.map((t) => ({
          name: t.name,
          fullName: `${t.schema}.${t.name}`,
          schema: t.schema,
          type: t.type,
        })),
        groupedBySchema: tablesBySchema,
        totalTables: result.rows.length,
      },
    });
  } catch (error) {
    logger.error('❌ Erro ao buscar tabelas:', error);
    res.status(500).json({
      success: false,
      error: 'TABLES_FETCH_ERROR',
      message: 'Erro ao buscar lista de tabelas',
      details:
        process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// =============================================================================
// METADADOS DE UMA TABELA ESPECÍFICA
// =============================================================================

/**
 * GET /api/querybuilder/tables/:tableName/columns
 * Retorna informações detalhadas sobre as colunas de uma tabela
 */
router.get('/tables/:tableName/columns', async (req, res) => {
  try {
    const { tableName } = req.params;

    // Extrair schema e nome da tabela
    let schemaName = 'public';
    let actualTableName = tableName;

    if (tableName.includes('.')) {
      [schemaName, actualTableName] = tableName.split('.');
    }

    logger.info(
      `📋 Buscando colunas da tabela: ${schemaName}.${actualTableName}`,
    );

    const query = `
      SELECT 
        column_name as name,
        data_type as type,
        udt_name as udt_type,
        is_nullable as nullable,
        column_default as default_value,
        character_maximum_length as max_length,
        numeric_precision as precision,
        numeric_scale as scale,
        ordinal_position as position
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = $2
      ORDER BY ordinal_position;
    `;

    const result = await pool.query(query, [schemaName, actualTableName]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'TABLE_NOT_FOUND',
        message: `Tabela ${schemaName}.${actualTableName} não encontrada`,
      });
    }

    // Buscar informações sobre chaves primárias
    const pkQuery = `
      SELECT a.attname as column_name
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = $1::regclass
        AND i.indisprimary;
    `;

    const pkResult = await pool.query(pkQuery, [
      `${schemaName}.${actualTableName}`,
    ]);
    const primaryKeys = pkResult.rows.map((row) => row.column_name);

    // Enriquecer dados das colunas
    const columns = result.rows.map((col) => ({
      name: col.name,
      type: col.type,
      udtType: col.udt_type,
      nullable: col.nullable === 'YES',
      isPrimaryKey: primaryKeys.includes(col.name),
      defaultValue: col.default_value,
      maxLength: col.max_length,
      precision: col.precision,
      scale: col.scale,
      position: col.position,
      // Adicionar categoria para facilitar filtros
      category: getColumnCategory(col.type, col.udt_type),
    }));

    logger.info(
      `✅ ${columns.length} colunas encontradas para ${schemaName}.${actualTableName}`,
    );

    res.json({
      success: true,
      data: {
        table: {
          schema: schemaName,
          name: actualTableName,
          fullName: `${schemaName}.${actualTableName}`,
        },
        columns,
        primaryKeys,
        totalColumns: columns.length,
      },
    });
  } catch (error) {
    logger.error('❌ Erro ao buscar colunas:', error);
    res.status(500).json({
      success: false,
      error: 'COLUMNS_FETCH_ERROR',
      message: 'Erro ao buscar colunas da tabela',
      details:
        process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// =============================================================================
// FUNÇÃO AUXILIAR - CATEGORIZAÇÃO DE TIPOS
// =============================================================================

function getColumnCategory(dataType, udtType) {
  const type = (dataType || udtType || '').toLowerCase();

  if (
    type.includes('int') ||
    type.includes('serial') ||
    type.includes('bigint') ||
    type.includes('smallint')
  ) {
    return 'numeric-integer';
  }
  if (
    type.includes('numeric') ||
    type.includes('decimal') ||
    type.includes('float') ||
    type.includes('double') ||
    type.includes('real')
  ) {
    return 'numeric-decimal';
  }
  if (
    type.includes('char') ||
    type.includes('text') ||
    type.includes('varchar')
  ) {
    return 'text';
  }
  if (
    type.includes('date') ||
    type.includes('time') ||
    type.includes('timestamp')
  ) {
    return 'datetime';
  }
  if (type.includes('bool')) {
    return 'boolean';
  }
  if (type.includes('json')) {
    return 'json';
  }
  if (type.includes('array')) {
    return 'array';
  }

  return 'other';
}

export default router;
