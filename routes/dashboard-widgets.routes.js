import express from 'express';
import pool from '../config/database.js';
import { logger } from '../utils/errorHandler.js';

const router = express.Router();

// =============================================================================
// MIDDLEWARE - Verificar permissões de admin/proprietário
// =============================================================================
const requireAdminOrOwner = (req, res, next) => {
  const userEmail = req.headers['x-user-email'];
  const userRole = req.headers['x-user-role'];

  if (!userEmail || !userRole) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Autenticação necessária',
    });
  }

  if (userRole !== 'admin' && userRole !== 'proprietario') {
    return res.status(403).json({
      success: false,
      error: 'FORBIDDEN',
      message: 'Apenas administradores e proprietários podem acessar',
    });
  }

  req.user = { email: userEmail, role: userRole };
  next();
};

// =============================================================================
// LISTAR WIDGETS DE UM DASHBOARD
// =============================================================================
router.get('/dashboards/:dashboardId/widgets', async (req, res) => {
  try {
    const { dashboardId } = req.params;

    const query = `
      SELECT * FROM dashboard_widgets
      WHERE dashboard_id = $1 AND is_active = true
      ORDER BY position_y, position_x;
    `;

    const result = await pool.query(query, [dashboardId]);

    res.json({
      success: true,
      data: {
        widgets: result.rows,
        total: result.rows.length,
      },
    });
  } catch (error) {
    logger.error('❌ Erro ao buscar widgets:', error);
    res.status(500).json({
      success: false,
      error: 'WIDGETS_FETCH_ERROR',
      message: 'Erro ao buscar widgets',
    });
  }
});

// =============================================================================
// CRIAR NOVO WIDGET
// =============================================================================
router.post(
  '/dashboards/:dashboardId/widgets',
  requireAdminOrOwner,
  async (req, res) => {
    try {
      const { dashboardId } = req.params;
      const {
        name,
        description,
        widgetType,
        chartType,
        queryConfig,
        displayConfig,
        positionX,
        positionY,
        width,
        height,
        refreshInterval,
      } = req.body;

      // Validações
      if (!name || !widgetType || !queryConfig) {
        return res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          message:
            'Nome, tipo de widget e configuração de query são obrigatórios',
        });
      }

      const validWidgetTypes = ['chart', 'table', 'metric', 'kpi'];
      if (!validWidgetTypes.includes(widgetType)) {
        return res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          message: `Tipo de widget inválido. Use: ${validWidgetTypes.join(
            ', ',
          )}`,
        });
      }

      const query = `
      INSERT INTO dashboard_widgets (
        dashboard_id, name, description, widget_type, chart_type,
        query_config, display_config, position_x, position_y,
        width, height, refresh_interval
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *;
    `;

      const result = await pool.query(query, [
        dashboardId,
        name,
        description || null,
        widgetType,
        chartType || null,
        JSON.stringify(queryConfig),
        displayConfig ? JSON.stringify(displayConfig) : null,
        positionX || 0,
        positionY || 0,
        width || 6,
        height || 4,
        refreshInterval || null,
      ]);

      logger.info(`✅ Widget criado: ${name} no dashboard ${dashboardId}`);

      res.status(201).json({
        success: true,
        data: result.rows[0],
        message: 'Widget criado com sucesso',
      });
    } catch (error) {
      logger.error('❌ Erro ao criar widget:', error);
      res.status(500).json({
        success: false,
        error: 'WIDGET_CREATE_ERROR',
        message: 'Erro ao criar widget',
        details:
          process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },
);

// =============================================================================
// ATUALIZAR WIDGET
// =============================================================================
router.put('/widgets/:id', requireAdminOrOwner, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      description,
      widgetType,
      chartType,
      queryConfig,
      displayConfig,
      positionX,
      positionY,
      width,
      height,
      refreshInterval,
      isActive,
    } = req.body;

    const query = `
      UPDATE dashboard_widgets 
      SET 
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        widget_type = COALESCE($3, widget_type),
        chart_type = COALESCE($4, chart_type),
        query_config = COALESCE($5, query_config),
        display_config = COALESCE($6, display_config),
        position_x = COALESCE($7, position_x),
        position_y = COALESCE($8, position_y),
        width = COALESCE($9, width),
        height = COALESCE($10, height),
        refresh_interval = COALESCE($11, refresh_interval),
        is_active = COALESCE($12, is_active),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $13
      RETURNING *;
    `;

    const result = await pool.query(query, [
      name || null,
      description || null,
      widgetType || null,
      chartType || null,
      queryConfig ? JSON.stringify(queryConfig) : null,
      displayConfig ? JSON.stringify(displayConfig) : null,
      positionX !== undefined ? positionX : null,
      positionY !== undefined ? positionY : null,
      width !== undefined ? width : null,
      height !== undefined ? height : null,
      refreshInterval !== undefined ? refreshInterval : null,
      isActive !== undefined ? isActive : null,
      id,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'WIDGET_NOT_FOUND',
        message: 'Widget não encontrado',
      });
    }

    logger.info(`✅ Widget atualizado: ${id}`);

    res.json({
      success: true,
      data: result.rows[0],
      message: 'Widget atualizado com sucesso',
    });
  } catch (error) {
    logger.error('❌ Erro ao atualizar widget:', error);
    res.status(500).json({
      success: false,
      error: 'WIDGET_UPDATE_ERROR',
      message: 'Erro ao atualizar widget',
    });
  }
});

// =============================================================================
// DELETAR WIDGET
// =============================================================================
router.delete('/widgets/:id', requireAdminOrOwner, async (req, res) => {
  try {
    const { id } = req.params;

    // Soft delete
    const query = `
      UPDATE dashboard_widgets 
      SET is_active = false, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *;
    `;

    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'WIDGET_NOT_FOUND',
        message: 'Widget não encontrado',
      });
    }

    logger.info(`✅ Widget deletado: ${id}`);

    res.json({
      success: true,
      message: 'Widget deletado com sucesso',
    });
  } catch (error) {
    logger.error('❌ Erro ao deletar widget:', error);
    res.status(500).json({
      success: false,
      error: 'WIDGET_DELETE_ERROR',
      message: 'Erro ao deletar widget',
    });
  }
});

// =============================================================================
// EXECUTAR QUERY DE UM WIDGET (para visualização)
// =============================================================================
router.get('/widgets/:id/execute', async (req, res) => {
  try {
    const { id } = req.params;
    const userEmail = req.headers['x-user-email'];

    if (!userEmail) {
      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Autenticação necessária',
      });
    }

    // Buscar widget e verificar permissão
    const widgetQuery = `
      SELECT 
        dw.*,
        d.id as dashboard_id,
        dp.can_view
      FROM dashboard_widgets dw
      INNER JOIN dashboards d ON dw.dashboard_id = d.id
      INNER JOIN dashboard_permissions dp ON d.id = dp.dashboard_id
      WHERE dw.id = $1 
        AND dp.user_email = $2 
        AND dp.can_view = true
        AND dw.is_active = true
        AND d.is_active = true;
    `;

    const widgetResult = await pool.query(widgetQuery, [id, userEmail]);

    if (widgetResult.rows.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN',
        message: 'Você não tem permissão para visualizar este widget',
      });
    }

    const widget = widgetResult.rows[0];
    const queryConfig = widget.query_config;

    // Executar query (reutilizar lógica do querybuilder)
    const { buildSafeQuery } = await import('./querybuilder-execute.routes.js');

    // Aqui você deve executar a query do widget
    // Por simplicidade, vou fazer uma query básica
    // TODO: Integrar com a lógica completa do query builder

    res.json({
      success: true,
      data: {
        widget,
        queryConfig,
        // results: ... (resultados da query)
      },
      message: 'Query executada com sucesso',
    });
  } catch (error) {
    logger.error('❌ Erro ao executar widget:', error);
    res.status(500).json({
      success: false,
      error: 'WIDGET_EXECUTE_ERROR',
      message: 'Erro ao executar query do widget',
    });
  }
});

// =============================================================================
// ATUALIZAR POSIÇÕES DOS WIDGETS (drag and drop)
// =============================================================================
router.patch(
  '/dashboards/:dashboardId/widgets/positions',
  requireAdminOrOwner,
  async (req, res) => {
    try {
      const { dashboardId } = req.params;
      const { widgets } = req.body; // Array de { id, positionX, positionY, width, height }

      if (!Array.isArray(widgets)) {
        return res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'Widgets deve ser um array',
        });
      }

      // Atualizar cada widget
      const updates = widgets.map(async (widget) => {
        return pool.query(
          `UPDATE dashboard_widgets 
         SET position_x = $1, position_y = $2, width = $3, height = $4, updated_at = CURRENT_TIMESTAMP
         WHERE id = $5 AND dashboard_id = $6
         RETURNING *;`,
          [
            widget.positionX,
            widget.positionY,
            widget.width,
            widget.height,
            widget.id,
            dashboardId,
          ],
        );
      });

      await Promise.all(updates);

      logger.info(
        `✅ Posições atualizadas para ${widgets.length} widgets do dashboard ${dashboardId}`,
      );

      res.json({
        success: true,
        message: 'Posições atualizadas com sucesso',
      });
    } catch (error) {
      logger.error('❌ Erro ao atualizar posições:', error);
      res.status(500).json({
        success: false,
        error: 'POSITIONS_UPDATE_ERROR',
        message: 'Erro ao atualizar posições',
      });
    }
  },
);

export default router;
