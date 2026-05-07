import { useState, useEffect } from 'react';
import { useSupabase } from './useSupabase';

/**
 * Hook para gerenciar dashboards no Supabase
 * CRUD completo de dashboards
 */
export const useDashboards = (userId = null) => {
  const { supabase } = useSupabase();
  const [dashboards, setDashboards] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Buscar todos os dashboards do usuário
   */
  const fetchDashboards = async (userIdParam = userId) => {
    if (!userIdParam) return [];

    setLoading(true);
    setError(null);

    try {
      // Buscar todos os dashboards ativos
      const { data, error: fetchError } = await supabase
        .from('dashboards')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;

      // Filtrar no frontend para dashboards onde o usuário está em 'usuarios' ou é o criador
      const userDashboards = (data || []).filter(
        (dashboard) =>
          dashboard.usuarios?.includes(userIdParam) ||
          dashboard.created_by === userIdParam,
      );

      setDashboards(userDashboards);
      return userDashboards;
    } catch (err) {
      console.error('Erro ao buscar dashboards:', err);
      setError(err.message);
      return [];
    } finally {
      setLoading(false);
    }
  };

  /**
   * Buscar um dashboard específico por ID
   */
  const getDashboardById = async (dashboardId) => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('dashboards')
        .select('*')
        .eq('id', dashboardId)
        .eq('is_active', true)
        .single();

      if (fetchError) throw fetchError;

      return data;
    } catch (err) {
      console.error('Erro ao buscar dashboard:', err);
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Criar um novo dashboard
   */
  const createDashboard = async (dashboardData) => {
    setLoading(true);
    setError(null);

    try {
      // Aceitar ambos: name/user_ids (do frontend) e nome/usuarios (legado)
      const nome = dashboardData.name || dashboardData.nome;
      const descricao = dashboardData.description || dashboardData.descricao;
      const usuarios = dashboardData.user_ids || dashboardData.usuarios || [];

      const { data, error: insertError } = await supabase
        .from('dashboards')
        .insert([
          {
            nome,
            descricao,
            usuarios,
            created_by: userId,
            is_active: true,
          },
        ])
        .select()
        .single();

      if (insertError) throw insertError;

      // Atualizar lista local
      setDashboards((prev) => [data, ...prev]);

      return { success: true, data };
    } catch (err) {
      console.error('Erro ao criar dashboard:', err);
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  /**
   * Atualizar um dashboard existente
   */
  const updateDashboard = async (dashboardId, updates) => {
    setLoading(true);
    setError(null);

    try {
      // Aceitar ambos: name/user_ids e nome/usuarios
      const updateData = {};
      if (updates.name || updates.nome) {
        updateData.nome = updates.name || updates.nome;
      }
      if (updates.description || updates.descricao) {
        updateData.descricao = updates.description || updates.descricao;
      }
      if (updates.user_ids || updates.usuarios) {
        updateData.usuarios = updates.user_ids || updates.usuarios;
      }

      const { data, error: updateError } = await supabase
        .from('dashboards')
        .update(updateData)
        .eq('id', dashboardId)
        .select()
        .single();

      if (updateError) throw updateError;

      // Atualizar lista local
      setDashboards((prev) =>
        prev.map((dash) => (dash.id === dashboardId ? data : dash)),
      );

      return { success: true, data };
    } catch (err) {
      console.error('Erro ao atualizar dashboard:', err);
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  /**
   * Deletar um dashboard (soft delete)
   */
  const deleteDashboard = async (dashboardId) => {
    setLoading(true);
    setError(null);

    try {
      const { error: deleteError } = await supabase
        .from('dashboards')
        .update({ is_active: false })
        .eq('id', dashboardId);

      if (deleteError) throw deleteError;

      // Remover da lista local
      setDashboards((prev) => prev.filter((dash) => dash.id !== dashboardId));

      return { success: true };
    } catch (err) {
      console.error('Erro ao deletar dashboard:', err);
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  /**
   * Contar widgets de um dashboard
   */
  const getWidgetCount = async (dashboardId) => {
    try {
      const { count, error: countError } = await supabase
        .from('widgets')
        .select('*', { count: 'exact', head: true })
        .eq('dashboard_id', dashboardId)
        .eq('is_active', true);

      if (countError) throw countError;

      return count || 0;
    } catch (err) {
      console.error('Erro ao contar widgets:', err);
      return 0;
    }
  };

  /**
   * Buscar dashboards com contagem de widgets
   */
  const fetchDashboardsWithWidgetCount = async (userIdParam = userId) => {
    if (!userIdParam) return [];

    setLoading(true);
    setError(null);

    try {
      // 1. Buscar todos os dashboards ativos (sem join)
      const { data, error: fetchError } = await supabase
        .from('dashboards')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;

      // 2. Filtrar no frontend para dashboards onde o usuário está em 'usuarios' ou é o criador
      const userDashboards = (data || []).filter(
        (dashboard) =>
          dashboard.usuarios?.includes(userIdParam) ||
          dashboard.created_by === userIdParam,
      );

      // 3. Para cada dashboard, contar widgets
      const dashboardsWithCount = await Promise.all(
        userDashboards.map(async (dashboard) => {
          try {
            const { count } = await supabase
              .from('widgets')
              .select('*', { count: 'exact', head: true })
              .eq('dashboard_id', dashboard.id)
              .eq('is_active', true);

            return {
              ...dashboard,
              widget_count: count || 0,
            };
          } catch (err) {
            console.error(
              `Erro ao contar widgets do dashboard ${dashboard.id}:`,
              err,
            );
            return {
              ...dashboard,
              widget_count: 0,
            };
          }
        }),
      );

      setDashboards(dashboardsWithCount);
      return dashboardsWithCount;
    } catch (err) {
      console.error('Erro ao buscar dashboards com widgets:', err);
      setError(err.message);
      return [];
    } finally {
      setLoading(false);
    }
  };

  // Auto-fetch ao montar se userId for fornecido
  useEffect(() => {
    if (userId) {
      fetchDashboardsWithWidgetCount(userId);
    }
  }, [userId]);

  return {
    dashboards,
    loading,
    error,
    fetchDashboards,
    fetchUserDashboards: () => fetchDashboardsWithWidgetCount(userId),
    getDashboardById,
    createDashboard,
    updateDashboard,
    deleteDashboard,
    getWidgetCount,
    fetchDashboardsWithWidgetCount,
    refetch: fetchDashboardsWithWidgetCount,
  };
};
