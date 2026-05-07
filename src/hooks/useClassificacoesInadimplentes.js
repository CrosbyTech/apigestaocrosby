import { useState } from 'react';
import { supabase } from '../lib/supabase';

export const useClassificacoesInadimplentes = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Salvar ou atualizar classificação de um cliente
   * @param {Object} classificacao - Dados da classificação
   * @returns {Object} - Resultado da operação
   */
  const salvarClassificacao = async (classificacao) => {
    setLoading(true);
    setError(null);

    try {
      const dadosParaSalvar = {
        cd_cliente: classificacao.cd_cliente,
        nm_cliente: classificacao.nm_cliente,
        valor_total: classificacao.valor_total,
        ds_siglaest: classificacao.ds_siglaest,
        situacao: classificacao.situacao,
        feeling: classificacao.feeling || null,
        status: classificacao.status || null,
        representante: classificacao.representante || null,
        usuario: classificacao.usuario,
        data_alteracao: new Date().toISOString(),
      };

      // Usar UPSERT para inserir ou atualizar
      const { data, error: upsertError } = await supabase
        .from('classificacoes_inadimplentes')
        .upsert(dadosParaSalvar, {
          onConflict: 'cd_cliente',
          ignoreDuplicates: false,
        })
        .select();

      if (upsertError) {
        throw upsertError;
      }

      return { success: true, data };
    } catch (err) {
      console.error('Erro ao salvar classificação:', err);
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  /**
   * Buscar todas as classificações
   * @returns {Object} - Lista de classificações
   */
  const buscarClassificacoes = async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('classificacoes_inadimplentes')
        .select('*')
        .order('data_alteracao', { ascending: false });

      if (fetchError) {
        throw fetchError;
      }

      return { success: true, data };
    } catch (err) {
      console.error('Erro ao buscar classificações:', err);
      setError(err.message);
      return { success: false, error: err.message, data: [] };
    } finally {
      setLoading(false);
    }
  };

  /**
   * Buscar classificação de um cliente específico
   * @param {string} cdCliente - Código do cliente
   * @returns {Object} - Classificação do cliente
   */
  const buscarClassificacaoPorCliente = async (cdCliente) => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('classificacoes_inadimplentes')
        .select('*')
        .eq('cd_cliente', cdCliente)
        .maybeSingle(); // Retorna null se não encontrar

      if (fetchError) {
        throw fetchError;
      }

      return { success: true, data };
    } catch (err) {
      console.error('Erro ao buscar classificação do cliente:', err);
      setError(err.message);
      return { success: false, error: err.message, data: null };
    } finally {
      setLoading(false);
    }
  };

  /**
   * Deletar classificação de um cliente
   * @param {string} cdCliente - Código do cliente
   * @returns {Object} - Resultado da operação
   */
  const deletarClassificacao = async (cdCliente) => {
    setLoading(true);
    setError(null);

    try {
      const { error: deleteError } = await supabase
        .from('classificacoes_inadimplentes')
        .delete()
        .eq('cd_cliente', cdCliente);

      if (deleteError) {
        throw deleteError;
      }

      return { success: true };
    } catch (err) {
      console.error('Erro ao deletar classificação:', err);
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  /**
   * Salvar múltiplas classificações em lote
   * @param {Array} classificacoes - Array de classificações
   * @returns {Object} - Resultado da operação
   */
  const salvarClassificacoesEmLote = async (classificacoes) => {
    setLoading(true);
    setError(null);

    try {
      const dadosParaSalvar = classificacoes.map((c) => ({
        cd_cliente: c.cd_cliente,
        nm_cliente: c.nm_cliente,
        valor_total: c.valor_total,
        ds_siglaest: c.ds_siglaest,
        situacao: c.situacao,
        feeling: c.feeling || null,
        status: c.status || null,
        representante: c.representante || null,
        usuario: c.usuario,
        data_alteracao: new Date().toISOString(),
      }));

      const { data, error: upsertError } = await supabase
        .from('classificacoes_inadimplentes')
        .upsert(dadosParaSalvar, {
          onConflict: 'cd_cliente',
          ignoreDuplicates: false,
        })
        .select();

      if (upsertError) {
        throw upsertError;
      }

      return { success: true, data };
    } catch (err) {
      console.error('Erro ao salvar classificações em lote:', err);
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  /**
   * Buscar histórico de alterações (log)
   * @param {string} cdCliente - Código do cliente (opcional)
   * @returns {Object} - Histórico de alterações
   */
  const buscarHistorico = async (cdCliente = null) => {
    setLoading(true);
    setError(null);

    try {
      let query = supabase
        .from('classificacoes_inadimplentes')
        .select('*')
        .order('data_alteracao', { ascending: false });

      if (cdCliente) {
        query = query.eq('cd_cliente', cdCliente);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) {
        throw fetchError;
      }

      return { success: true, data };
    } catch (err) {
      console.error('Erro ao buscar histórico:', err);
      setError(err.message);
      return { success: false, error: err.message, data: [] };
    } finally {
      setLoading(false);
    }
  };

  /**
   * Salvar observação de um cliente
   * @param {Object} observacao - Dados da observação
   * @returns {Object} - Resultado da operação
   */
  const salvarObservacao = async (observacao) => {
    setLoading(true);
    setError(null);

    try {
      const dadosParaSalvar = {
        cd_cliente: observacao.cd_cliente,
        nm_cliente: observacao.nm_cliente,
        observacao: observacao.observacao,
        usuario: observacao.usuario,
        data_criacao: new Date().toISOString(),
      };

      const { data, error: insertError } = await supabase
        .from('observacoes_inadimplentes')
        .insert(dadosParaSalvar)
        .select();

      if (insertError) {
        throw insertError;
      }

      return { success: true, data };
    } catch (err) {
      console.error('Erro ao salvar observação:', err);
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  /**
   * Buscar observações de um cliente
   * @param {string} cdCliente - Código do cliente
   * @returns {Object} - Lista de observações
   */
  const buscarObservacoes = async (cdCliente) => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('observacoes_inadimplentes')
        .select('*')
        .eq('cd_cliente', cdCliente)
        .order('data_criacao', { ascending: true });

      if (fetchError) {
        throw fetchError;
      }

      return { success: true, data };
    } catch (err) {
      console.error('Erro ao buscar observações:', err);
      setError(err.message);
      return { success: false, error: err.message, data: [] };
    } finally {
      setLoading(false);
    }
  };

  /**
   * Salvar observação de um cliente de franquia
   * @param {Object} observacao - Dados da observação
   * @returns {Object} - Resultado da operação
   */
  const salvarObservacaoFranquia = async (observacao) => {
    setLoading(true);
    setError(null);

    try {
      const dadosParaSalvar = {
        cd_cliente: observacao.cd_cliente,
        nm_cliente: observacao.nm_cliente,
        observacao: observacao.observacao,
        usuario: observacao.usuario,
        data_criacao: new Date().toISOString(),
      };

      const { data, error: insertError } = await supabase
        .from('observacoes_inadimplentes_franquias')
        .insert(dadosParaSalvar)
        .select();

      if (insertError) {
        throw insertError;
      }

      return { success: true, data };
    } catch (err) {
      console.error('Erro ao salvar observação de franquia:', err);
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  /**
   * Buscar observações de um cliente de franquia
   * @param {string} cdCliente - Código do cliente
   * @returns {Object} - Lista de observações
   */
  const buscarObservacoesFranquia = async (cdCliente) => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('observacoes_inadimplentes_franquias')
        .select('*')
        .eq('cd_cliente', cdCliente)
        .order('data_criacao', { ascending: true });

      if (fetchError) {
        throw fetchError;
      }

      return { success: true, data };
    } catch (err) {
      console.error('Erro ao buscar observações de franquia:', err);
      setError(err.message);
      return { success: false, error: err.message, data: [] };
    } finally {
      setLoading(false);
    }
  };

  /**
   * Deletar observação (Multimarcas)
   * @param {number} id - ID da observação
   * @returns {Object} - Resultado da operação
   */
  const deletarObservacao = async (id) => {
    setLoading(true);
    setError(null);

    try {
      const { error: deleteError } = await supabase
        .from('observacoes_inadimplentes')
        .delete()
        .eq('id', id);

      if (deleteError) {
        throw deleteError;
      }

      return { success: true };
    } catch (err) {
      console.error('Erro ao deletar observação:', err);
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  /**
   * Deletar observação (Franquias)
   * @param {number} id - ID da observação
   * @returns {Object} - Resultado da operação
   */
  const deletarObservacaoFranquia = async (id) => {
    setLoading(true);
    setError(null);

    try {
      const { error: deleteError } = await supabase
        .from('observacoes_inadimplentes_franquias')
        .delete()
        .eq('id', id);

      if (deleteError) {
        throw deleteError;
      }

      return { success: true };
    } catch (err) {
      console.error('Erro ao deletar observação de franquia:', err);
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  return {
    loading,
    error,
    salvarClassificacao,
    buscarClassificacoes,
    buscarClassificacaoPorCliente,
    deletarClassificacao,
    salvarClassificacoesEmLote,
    buscarHistorico,
    salvarObservacao,
    buscarObservacoes,
    salvarObservacaoFranquia,
    buscarObservacoesFranquia,
    deletarObservacao,
    deletarObservacaoFranquia,
  };
};

export default useClassificacoesInadimplentes;
