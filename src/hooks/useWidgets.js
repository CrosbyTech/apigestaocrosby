import { useState, useEffect } from 'react';
import { useSupabase } from './useSupabase';

/**
 * Hook para gerenciar widgets no Supabase
 * CRUD completo de widgets
 */
export const useWidgets = (dashboardId = null) => {
  const { supabase } = useSupabase();
  const [widgets, setWidgets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Buscar todos os widgets de um dashboard
   */
  const fetchWidgets = async (dashId = dashboardId) => {
    if (!dashId) return [];

    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('widgets')
        .select('*')
        .eq('dashboard_id', dashId)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;

      setWidgets(data || []);
      return data;
    } catch (err) {
      console.error('Erro ao buscar widgets:', err);
      setError(err.message);
      return [];
    } finally {
      setLoading(false);
    }
  };

  /**
   * Buscar widgets do usuário (todos os dashboards com acesso)
   */
  const fetchUserWidgets = async (userId) => {
    if (!userId) return [];

    setLoading(true);
    setError(null);

    try {
      console.log('🔍 [useWidgets] Buscando dashboards para userId:', userId);

      // Buscar dashboards do usuário usando RLS
      // As políticas RLS já filtram automaticamente baseado em auth.uid()
      const { data: dashboards, error: dashError } = await supabase
        .from('dashboards')
        .select('id, nome, usuarios, created_by')
        .eq('is_active', true);

      console.log('📊 [useWidgets] Dashboards retornados:', dashboards);
      if (dashError) {
        console.error('❌ [useWidgets] Erro ao buscar dashboards:', dashError);
        throw dashError;
      }

      const dashboardIds = dashboards.map((d) => d.id);
      console.log('🎯 [useWidgets] Dashboard IDs:', dashboardIds);

      if (dashboardIds.length === 0) {
        console.log('⚠️ [useWidgets] Nenhum dashboard encontrado');
        setWidgets([]);
        return [];
      }

      // Buscar widgets desses dashboards
      console.log(
        '🔍 [useWidgets] Buscando widgets para dashboards:',
        dashboardIds,
      );
      const { data: widgetsData, error: widgetsError } = await supabase
        .from('widgets')
        .select(
          `
          *,
          dashboard:dashboards(id, nome, usuarios)
        `,
        )
        .in('dashboard_id', dashboardIds)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      console.log('📦 [useWidgets] Widgets retornados:', widgetsData);
      if (widgetsError) {
        console.error('❌ [useWidgets] Erro ao buscar widgets:', widgetsError);
        throw widgetsError;
      }

      // Formatar dados
      const formattedWidgets = widgetsData.map((widget) => ({
        ...widget,
        dashboardName: widget.dashboard?.nome || 'Dashboard',
      }));

      console.log(
        '✅ [useWidgets] Widgets formatados:',
        formattedWidgets.length,
      );
      setWidgets(formattedWidgets);
      return formattedWidgets;
    } catch (err) {
      console.error('❌ [useWidgets] Erro ao buscar widgets do usuário:', err);
      setError(err.message);
      return [];
    } finally {
      setLoading(false);
    }
  };

  /**
   * Buscar um widget específico por ID
   */
  const getWidgetById = async (widgetId) => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('widgets')
        .select('*')
        .eq('id', widgetId)
        .eq('is_active', true)
        .single();

      if (fetchError) throw fetchError;

      return data;
    } catch (err) {
      console.error('Erro ao buscar widget:', err);
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Criar um novo widget
   */
  const createWidget = async (widgetData, userId) => {
    setLoading(true);
    setError(null);

    try {
      // Determinar o dashboard_id (pode vir de diferentes formas)
      const dashboardId = widgetData.dashboard_id || widgetData.dashboardId;

      // Determinar o nome do widget
      const widgetName =
        widgetData.name || widgetData.config?.nome || 'Widget sem nome';

      // Determinar a view (pode vir como viewName ou view)
      const viewName =
        widgetData.view_name ||
        widgetData.config?.viewName ||
        widgetData.config?.view ||
        'unknown_view';

      const { data, error: insertError } = await supabase
        .from('widgets')
        .insert([
          {
            dashboard_id: dashboardId,
            nome: widgetName,
            view_name: viewName,
            config: {
              selectedColumns:
                widgetData.config?.selectedColumns ||
                widgetData.selectedColumns ||
                [],
              filters: widgetData.config?.filters || widgetData.filters || [],
              aggregations:
                widgetData.config?.aggregations ||
                widgetData.aggregations ||
                [],
              orderBy: widgetData.config?.orderBy || widgetData.orderBy || {},
              type: widgetData.config?.type || widgetData.type || 'table',
            },
            created_by: userId,
            is_active: true,
          },
        ])
        .select()
        .single();

      if (insertError) throw insertError;

      // Atualizar lista local
      setWidgets((prev) => [data, ...prev]);

      return { success: true, data };
    } catch (err) {
      console.error('Erro ao criar widget:', err);
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  /**
   * Atualizar um widget existente
   */
  const updateWidget = async (widgetId, updates) => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: updateError } = await supabase
        .from('widgets')
        .update({
          nome: updates.config.nome,
          view_name: updates.config.view,
          config: {
            selectedColumns: updates.config.selectedColumns,
            filters: updates.config.filters,
            aggregations: updates.config.aggregations,
            orderBy: updates.config.orderBy,
            type: updates.config.type,
          },
        })
        .eq('id', widgetId)
        .select()
        .single();

      if (updateError) throw updateError;

      // Atualizar lista local
      setWidgets((prev) =>
        prev.map((widget) => (widget.id === widgetId ? data : widget)),
      );

      return { success: true, data };
    } catch (err) {
      console.error('Erro ao atualizar widget:', err);
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  /**
   * Deletar um widget (soft delete)
   */
  const deleteWidget = async (widgetId) => {
    setLoading(true);
    setError(null);

    try {
      const { error: deleteError } = await supabase
        .from('widgets')
        .update({ is_active: false })
        .eq('id', widgetId);

      if (deleteError) throw deleteError;

      // Remover da lista local
      setWidgets((prev) => prev.filter((widget) => widget.id !== widgetId));

      return { success: true };
    } catch (err) {
      console.error('Erro ao deletar widget:', err);
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  // Auto-fetch ao montar se dashboardId for fornecido
  useEffect(() => {
    if (dashboardId) {
      fetchWidgets(dashboardId);
    }
  }, [dashboardId]);

  return {
    widgets,
    loading,
    error,
    fetchWidgets,
    fetchUserWidgets,
    getWidgetById,
    createWidget,
    updateWidget,
    deleteWidget,
    refetch: fetchWidgets,
  };
};
