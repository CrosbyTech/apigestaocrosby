import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export const useMetas = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Função para salvar metas no banco
  const salvarMetas = async (metasData) => {
    setLoading(true);
    setError(null);

    try {
      // Preparar dados para inserção
      const metasParaInserir = [];

      metasData.forEach(({ tipo, nome, metas, mes, usuario }) => {
        Object.entries(metas).forEach(([campo, valor]) => {
          if (valor && valor !== 'R$ 0,00') {
            metasParaInserir.push({
              tipo: tipo, // 'lojas' ou 'vendedores'
              nome: nome,
              campo: campo, // 'bronze', 'prata', 'ouro', 'diamante'
              valor: valor,
              mes: mes, // formato YYYY-MM
              usuario: usuario,
              data_alteracao: new Date().toISOString(),
            });
          }
        });
      });

      if (metasParaInserir.length === 0) {
        throw new Error('Nenhuma meta válida para salvar');
      }

      // Usar UPSERT (INSERT com ON CONFLICT) para evitar duplicatas
      const { data, error: upsertError } = await supabase
        .from('metas_varejo')
        .upsert(metasParaInserir, {
          onConflict: 'tipo,nome,campo,mes',
          ignoreDuplicates: false,
        })
        .select();

      if (upsertError) {
        throw upsertError;
      }

      return { success: true, data };
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  // Função para buscar metas por período
  const buscarMetas = async (mesInicio, mesFim, tipo = null) => {
    setLoading(true);
    setError(null);

    try {
      let query = supabase
        .from('metas_varejo')
        .select('*')
        .gte('mes', mesInicio)
        .lte('mes', mesFim);

      if (tipo) {
        query = query.eq('tipo', tipo);
      }

      const { data, error: fetchError } = await query.order('data_alteracao', {
        ascending: false,
      });

      if (fetchError) {
        throw fetchError;
      }

      return { success: true, data: data || [] };
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  // Função para buscar log de alterações
  const buscarLogAlteracoes = async (mesInicio = null, mesFim = null) => {
    setLoading(true);
    setError(null);

    try {
      let query = supabase
        .from('metas_varejo')
        .select('*')
        .order('data_alteracao', { ascending: false });

      if (mesInicio && mesFim) {
        query = query.gte('mes', mesInicio).lte('mes', mesFim);
      }

      const { data, error: fetchError } = await query.limit(100);

      if (fetchError) {
        throw fetchError;
      }

      return { success: true, data: data || [] };
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  // Função para deletar meta específica
  const deletarMeta = async (id) => {
    setLoading(true);
    setError(null);

    try {
      const { error: deleteError } = await supabase
        .from('metas_varejo')
        .delete()
        .eq('id', id);

      if (deleteError) {
        throw deleteError;
      }

      return { success: true };
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  // Função para deletar metas por critérios específicos
  const deletarMetasPorCriterios = async (criterios) => {
    setLoading(true);
    setError(null);

    try {
      console.log('🗑️ Excluindo metas mensais com critérios:', criterios);

      let query = supabase.from('metas_varejo').delete();

      // Aplicar filtros baseados nos critérios
      if (criterios.mes) {
        query = query.eq('mes', criterios.mes);
      }
      if (criterios.tipo) {
        query = query.eq('tipo', criterios.tipo);
      }
      if (criterios.nome) {
        query = query.eq('nome', criterios.nome);
      }
      if (criterios.campo) {
        query = query.eq('campo', criterios.campo);
      }

      const { data, error: deleteError } = await query;

      if (deleteError) {
        throw deleteError;
      }

      return { success: true, data };
    } catch (err) {
      setError(err.message);
      console.error('❌ Erro ao excluir metas mensais:', err);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  return {
    loading,
    error,
    salvarMetas,
    buscarMetas,
    buscarLogAlteracoes,
    deletarMeta,
    deletarMetasPorCriterios,
  };
};

export default useMetas;
