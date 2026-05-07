import { useState, useCallback } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

/**
 * Hook para interagir com a API REST de widgets
 * Busca views, colunas e executa queries
 */
export const useWidgetAPI = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Buscar todas as views disponíveis
   */
  const fetchViews = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/widgets/views`);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.message || 'Erro ao buscar views');
      }

      return data.data || [];
    } catch (err) {
      console.error('Erro ao buscar views:', err);
      setError(err.message);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Buscar colunas de uma view específica
   */
  const fetchViewColumns = useCallback(async (viewName) => {
    if (!viewName) return [];

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/widgets/views/${viewName}/columns`,
      );
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.message || 'Erro ao buscar colunas');
      }

      return data.columns || [];
    } catch (err) {
      console.error('Erro ao buscar colunas:', err);
      setError(err.message);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Executar query customizada
   */
  const executeQuery = useCallback(async (queryConfig) => {
    setLoading(true);
    setError(null);

    try {
      console.log('📤 Enviando query:', queryConfig);

      const response = await fetch(`${API_BASE_URL}/api/widgets/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(queryConfig),
      });

      const data = await response.json();

      console.log(
        '📥 Resposta do servidor (status:',
        response.status,
        '):',
        data,
      );

      if (!response.ok || !data.success) {
        const errorMsg = data.message || data.error || 'Erro ao executar query';
        console.error('❌ Erro da API:', errorMsg);
        throw new Error(errorMsg);
      }

      return {
        success: true,
        data: data.data || [],
        count: data.count || 0,
      };
    } catch (err) {
      console.error('❌ Erro ao executar query:', err);
      setError(err.message);
      return {
        success: false,
        data: [],
        error: err.message,
      };
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Validar query sem executar
   */
  const validateQuery = useCallback(async (viewName, columns) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/widgets/validate-query`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ viewName, columns }),
        },
      );

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.message || 'Query inválida');
      }

      return { success: true, message: data.message };
    } catch (err) {
      console.error('Erro ao validar query:', err);
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Executar query a partir de um widget config
   */
  const executeWidgetQuery = useCallback(
    async (widgetConfig) => {
      const queryConfig = {
        viewName: widgetConfig.view,
        columns: widgetConfig.selectedColumns,
        filters: widgetConfig.filters.map((f) => ({
          column: f.column,
          operator: f.operator,
          value: f.value,
          value2: f.value2,
          values: f.values,
        })),
        aggregations: widgetConfig.aggregations,
        orderBy: widgetConfig.orderBy,
        limit: 1000,
      };

      return await executeQuery(queryConfig);
    },
    [executeQuery],
  );

  return {
    loading,
    error,
    fetchViews,
    fetchViewColumns,
    executeQuery,
    validateQuery,
    executeWidgetQuery,
  };
};
