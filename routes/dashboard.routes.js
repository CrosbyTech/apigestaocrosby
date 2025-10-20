import express from 'express';
import pool from '../config/database.js';
import { logger } from '../utils/errorHandler.js';

const router = express.Router();

// =============================================================================
// MIDDLEWARE - Verificar permissões de admin/proprietário
// =============================================================================
const requireAdminOrOwner = (req, res, next) => {
  // TODO: Integrar com seu sistema de autenticação real
  // Por enquanto, esperamos que o frontend envie via header
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
// LISTAR TODOS OS DASHBOARDS (Admin)
// =============================================================================
router.get('/admin/dashboards', requireAdminOrOwner, async (req, res) => {
  try {
    const query = `
      SELECT 
        d.*,
        COUNT(DISTINCT dp.user_email) as total_users,
        COUNT(DISTINCT dw.id) as total_widgets
      FROM dashboards d
      LEFT JOIN dashboard_permissions dp ON d.id = dp.dashboard_id
      LEFT JOIN dashboard_widgets dw ON d.id = dw.dashboard_id
      WHERE d.is_active = true
      GROUP BY d.id
      ORDER BY d.created_at DESC;
    `;
    
    const result = await pool.query(query);
    
    res.json({
      success: true,
      data: {
        dashboards: result.rows,
        total: result.rows.length,
      },
    });
  } catch (error) {
    logger.error('❌ Erro ao listar dashboards:', error);
    res.status(500).json({
      success: false,
      error: 'DASHBOARDS_FETCH_ERROR',
      message: 'Erro ao buscar dashboards',
    });
  }
});

// =============================================================================
// CRIAR NOVO DASHBOARD
// =============================================================================
router.post('/admin/dashboards', requireAdminOrOwner, async (req, res) => {
  try {
    const { name, description, layoutConfig } = req.body;
    
    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Nome do dashboard é obrigatório',
      });
    }
    
    const query = `
      INSERT INTO dashboards (name, description, created_by, created_by_role, layout_config)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
    `;
    
    const result = await pool.query(query, [
      name,
      description || null,
      req.user.email,
      req.user.role,
      layoutConfig || null,
    ]);
    
    logger.info(`✅ Dashboard criado: ${name} por ${req.user.email}`);
    
    res.status(201).json({
      success: true,
      data: result.rows[0],
      message: 'Dashboard criado com sucesso',
    });
  } catch (error) {
    logger.error('❌ Erro ao criar dashboard:', error);
    res.status(500).json({
      success: false,
      error: 'DASHBOARD_CREATE_ERROR',
      message: 'Erro ao criar dashboard',
    });
  }
});

// =============================================================================
// ATUALIZAR DASHBOARD
// =============================================================================
router.put('/admin/dashboards/:id', requireAdminOrOwner, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, layoutConfig, isActive } = req.body;
    
    const query = `
      UPDATE dashboards 
      SET 
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        layout_config = COALESCE($3, layout_config),
        is_active = COALESCE($4, is_active),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $5
      RETURNING *;
    `;
    
    const result = await pool.query(query, [
      name || null,
      description || null,
      layoutConfig || null,
      isActive !== undefined ? isActive : null,
      id,
    ]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'DASHBOARD_NOT_FOUND',
        message: 'Dashboard não encontrado',
      });
    }
    
    logger.info(`✅ Dashboard atualizado: ${id} por ${req.user.email}`);
    
    res.json({
      success: true,
      data: result.rows[0],
      message: 'Dashboard atualizado com sucesso',
    });
  } catch (error) {
    logger.error('❌ Erro ao atualizar dashboard:', error);
    res.status(500).json({
      success: false,
      error: 'DASHBOARD_UPDATE_ERROR',
      message: 'Erro ao atualizar dashboard',
    });
  }
});

// =============================================================================
// DELETAR DASHBOARD
// =============================================================================
router.delete('/admin/dashboards/:id', requireAdminOrOwner, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Soft delete (marca como inativo)
    const query = `
      UPDATE dashboards 
      SET is_active = false, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *;
    `;
    
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'DASHBOARD_NOT_FOUND',
        message: 'Dashboard não encontrado',
      });
    }
    
    logger.info(`✅ Dashboard deletado: ${id} por ${req.user.email}`);
    
    res.json({
      success: true,
      message: 'Dashboard deletado com sucesso',
    });
  } catch (error) {
    logger.error('❌ Erro ao deletar dashboard:', error);
    res.status(500).json({
      success: false,
      error: 'DASHBOARD_DELETE_ERROR',
      message: 'Erro ao deletar dashboard',
    });
  }
});

// =============================================================================
// GERENCIAR PERMISSÕES - Adicionar usuário ao dashboard
// =============================================================================
router.post('/admin/dashboards/:id/permissions', requireAdminOrOwner, async (req, res) => {
  try {
    const { id } = req.params;
    const { userEmail, userRole, canView, canExport } = req.body;
    
    if (!userEmail) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Email do usuário é obrigatório',
      });
    }
    
    const query = `
      INSERT INTO dashboard_permissions 
        (dashboard_id, user_email, user_role, granted_by, can_view, can_export)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (dashboard_id, user_email) 
      DO UPDATE SET
        user_role = EXCLUDED.user_role,
        can_view = EXCLUDED.can_view,
        can_export = EXCLUDED.can_export,
        granted_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;
    
    const result = await pool.query(query, [
      id,
      userEmail,
      userRole || null,
      req.user.email,
      canView !== undefined ? canView : true,
      canExport !== undefined ? canExport : false,
    ]);
    
    logger.info(`✅ Permissão concedida: Dashboard ${id} -> ${userEmail}`);
    
    res.status(201).json({
      success: true,
      data: result.rows[0],
      message: 'Permissão concedida com sucesso',
    });
  } catch (error) {
    logger.error('❌ Erro ao conceder permissão:', error);
    res.status(500).json({
      success: false,
      error: 'PERMISSION_CREATE_ERROR',
      message: 'Erro ao conceder permissão',
    });
  }
});

// =============================================================================
// LISTAR PERMISSÕES DE UM DASHBOARD
// =============================================================================
router.get('/admin/dashboards/:id/permissions', requireAdminOrOwner, async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = `
      SELECT * FROM dashboard_permissions
      WHERE dashboard_id = $1
      ORDER BY granted_at DESC;
    `;
    
    const result = await pool.query(query, [id]);
    
    res.json({
      success: true,
      data: {
        permissions: result.rows,
        total: result.rows.length,
      },
    });
  } catch (error) {
    logger.error('❌ Erro ao listar permissões:', error);
    res.status(500).json({
      success: false,
      error: 'PERMISSIONS_FETCH_ERROR',
      message: 'Erro ao buscar permissões',
    });
  }
});

// =============================================================================
// REMOVER PERMISSÃO
// =============================================================================
router.delete('/admin/dashboards/:id/permissions/:userEmail', requireAdminOrOwner, async (req, res) => {
  try {
    const { id, userEmail } = req.params;
    
    const query = `
      DELETE FROM dashboard_permissions
      WHERE dashboard_id = $1 AND user_email = $2
      RETURNING *;
    `;
    
    const result = await pool.query(query, [id, userEmail]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'PERMISSION_NOT_FOUND',
        message: 'Permissão não encontrada',
      });
    }
    
    logger.info(`✅ Permissão removida: Dashboard ${id} -> ${userEmail}`);
    
    res.json({
      success: true,
      message: 'Permissão removida com sucesso',
    });
  } catch (error) {
    logger.error('❌ Erro ao remover permissão:', error);
    res.status(500).json({
      success: false,
      error: 'PERMISSION_DELETE_ERROR',
      message: 'Erro ao remover permissão',
    });
  }
});

// =============================================================================
// LISTAR DASHBOARDS DO USUÁRIO LOGADO
// =============================================================================
router.get('/my-dashboards', async (req, res) => {
  try {
    const userEmail = req.headers['x-user-email'];
    
    if (!userEmail) {
      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Autenticação necessária',
      });
    }
    
    const query = `
      SELECT 
        d.*,
        dp.can_view,
        dp.can_export,
        COUNT(DISTINCT dw.id) as total_widgets
      FROM dashboards d
      INNER JOIN dashboard_permissions dp ON d.id = dp.dashboard_id
      LEFT JOIN dashboard_widgets dw ON d.id = dw.dashboard_id AND dw.is_active = true
      WHERE d.is_active = true 
        AND dp.user_email = $1
        AND dp.can_view = true
      GROUP BY d.id, dp.can_view, dp.can_export
      ORDER BY d.name;
    `;
    
    const result = await pool.query(query, [userEmail]);
    
    res.json({
      success: true,
      data: {
        dashboards: result.rows,
        total: result.rows.length,
      },
    });
  } catch (error) {
    logger.error('❌ Erro ao buscar dashboards do usuário:', error);
    res.status(500).json({
      success: false,
      error: 'MY_DASHBOARDS_FETCH_ERROR',
      message: 'Erro ao buscar seus dashboards',
    });
  }
});

// =============================================================================
// VER DETALHES DE UM DASHBOARD (com widgets)
// =============================================================================
router.get('/dashboards/:id', async (req, res) => {
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
    
    // Verificar permissão
    const permQuery = `
      SELECT dp.*, d.* 
      FROM dashboard_permissions dp
      INNER JOIN dashboards d ON dp.dashboard_id = d.id
      WHERE dp.dashboard_id = $1 AND dp.user_email = $2 AND dp.can_view = true AND d.is_active = true;
    `;
    
    const permResult = await pool.query(permQuery, [id, userEmail]);
    
    if (permResult.rows.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN',
        message: 'Você não tem permissão para visualizar este dashboard',
      });
    }
    
    // Buscar widgets
    const widgetsQuery = `
      SELECT * FROM dashboard_widgets
      WHERE dashboard_id = $1 AND is_active = true
      ORDER BY position_y, position_x;
    `;
    
    const widgetsResult = await pool.query(widgetsQuery, [id]);
    
    // Registrar acesso (opcional)
    await pool.query(
      'INSERT INTO dashboard_access_log (dashboard_id, user_email, ip_address) VALUES ($1, $2, $3)',
      [id, userEmail, req.ip]
    );
    
    res.json({
      success: true,
      data: {
        dashboard: permResult.rows[0],
        widgets: widgetsResult.rows,
        permissions: {
          canView: permResult.rows[0].can_view,
          canExport: permResult.rows[0].can_export,
        },
      },
    });
  } catch (error) {
    logger.error('❌ Erro ao buscar dashboard:', error);
    res.status(500).json({
      success: false,
      error: 'DASHBOARD_FETCH_ERROR',
      message: 'Erro ao buscar dashboard',
    });
  }
});

export default router;
