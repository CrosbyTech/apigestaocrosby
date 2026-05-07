import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Hook para gerenciar avisos (notices) no sistema
 * CRUD completo de avisos e gerenciamento de leituras
 */
export const useNotices = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Criar novo aviso
   * @param {Object} noticeData - { title, content, styles }
   * @param {Array} recipients - [{ userId, role }]
   */
  const createNotice = useCallback(async (noticeData, recipients) => {
    setLoading(true);
    setError(null);

    try {
      // 1. Criar o aviso
      const { data: notice, error: noticeError } = await supabase
        .from('notices')
        .insert([
          {
            title: noticeData.title,
            content: noticeData.content,
            styles: noticeData.styles || {},
          },
        ])
        .select()
        .single();

      if (noticeError) throw noticeError;

      // 2. Adicionar destinatários
      const recipientsData = recipients.map((r) => ({
        notice_id: notice.id,
        user_id: r.userId,
        role: r.role,
      }));

      const { error: recipientsError } = await supabase
        .from('notice_recipients')
        .insert(recipientsData);

      if (recipientsError) throw recipientsError;

      return { success: true, data: notice };
    } catch (err) {
      console.error('Erro ao criar aviso:', err);
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Buscar avisos não lidos de um usuário
   * @param {string} userId - ID do usuário
   */
  const getUnreadNotices = useCallback(async (userId) => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase.rpc(
        'get_unread_notices',
        { p_user_id: userId },
      );

      if (fetchError) throw fetchError;

      return { success: true, data: data || [] };
    } catch (err) {
      console.error('Erro ao buscar avisos não lidos:', err);
      setError(err.message);
      return { success: false, error: err.message, data: [] };
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Buscar todos os avisos de um usuário (lidos e não lidos)
   * @param {string} userId - ID do usuário
   */
  const getUserNotices = useCallback(async (userId) => {
    setLoading(true);
    setError(null);

    try {
      // Primeiro, buscar os IDs dos avisos do usuário
      const { data: recipientData, error: recipientError } = await supabase
        .from('notice_recipients')
        .select('notice_id')
        .eq('user_id', userId);

      if (recipientError) throw recipientError;

      const noticeIds = recipientData.map((r) => r.notice_id);

      if (noticeIds.length === 0) {
        return { success: true, data: [] };
      }

      // Buscar os avisos
      const { data: noticesData, error: noticesError } = await supabase
        .from('notices')
        .select('*')
        .in('id', noticeIds)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (noticesError) throw noticesError;

      // Buscar os status de leitura
      const { data: readsData, error: readsError } = await supabase
        .from('notice_reads')
        .select('notice_id, read_at, confirmed_at')
        .eq('user_id', userId)
        .in('notice_id', noticeIds);

      if (readsError) throw readsError;

      // Mapear status de leitura
      const readsMap = {};
      readsData.forEach((read) => {
        readsMap[read.notice_id] = read;
      });

      // Combinar dados
      const formattedData = noticesData.map((notice) => {
        const readStatus = readsMap[notice.id];
        return {
          ...notice,
          is_read: !!readStatus,
          is_confirmed: !!readStatus?.confirmed_at,
          read_at: readStatus?.read_at || null,
          confirmed_at: readStatus?.confirmed_at || null,
        };
      });

      return { success: true, data: formattedData };
    } catch (err) {
      console.error('Erro ao buscar avisos do usuário:', err);
      setError(err.message);
      return { success: false, error: err.message, data: [] };
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Buscar avisos não lidos do dia atual
   * @param {string} userId - ID do usuário
   */
  const getTodayUnreadNotices = useCallback(async (userId) => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase.rpc(
        'get_unread_notices',
        { p_user_id: userId },
      );

      if (fetchError) throw fetchError;

      // Filtrar avisos do dia
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const todayNotices = (data || []).filter((notice) => {
        const noticeDate = new Date(notice.created_at);
        noticeDate.setHours(0, 0, 0, 0);
        return noticeDate.getTime() === today.getTime();
      });

      return { success: true, data: todayNotices };
    } catch (err) {
      console.error('Erro ao buscar avisos não lidos do dia:', err);
      setError(err.message);
      return { success: false, error: err.message, data: [] };
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Marcar aviso como lido
   * @param {string} noticeId - ID do aviso
   * @param {string} userId - ID do usuário
   */
  const markAsRead = useCallback(async (noticeId, userId) => {
    setLoading(true);
    setError(null);

    try {
      const { error: upsertError } = await supabase.from('notice_reads').upsert(
        {
          notice_id: noticeId,
          user_id: userId,
          read_at: new Date().toISOString(),
        },
        {
          onConflict: 'notice_id,user_id',
        },
      );

      if (upsertError) throw upsertError;

      return { success: true };
    } catch (err) {
      console.error('Erro ao marcar aviso como lido:', err);
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Confirmar leitura do aviso (após o countdown)
   * @param {string} noticeId - ID do aviso
   * @param {string} userId - ID do usuário
   */
  const confirmRead = useCallback(async (noticeId, userId) => {
    setLoading(true);
    setError(null);

    try {
      // Primeiro marca como lido (caso não tenha sido)
      const { error: upsertError } = await supabase.from('notice_reads').upsert(
        {
          notice_id: noticeId,
          user_id: userId,
          read_at: new Date().toISOString(),
          confirmed_at: new Date().toISOString(),
        },
        {
          onConflict: 'notice_id,user_id',
        },
      );

      if (upsertError) throw upsertError;

      return { success: true };
    } catch (err) {
      console.error('Erro ao confirmar leitura do aviso:', err);
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Buscar estatísticas de um aviso
   * @param {string} noticeId - ID do aviso
   */
  const getNoticeStats = useCallback(async (noticeId) => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase.rpc(
        'get_notice_stats',
        { p_notice_id: noticeId },
      );

      if (fetchError) throw fetchError;

      return { success: true, data };
    } catch (err) {
      console.error('Erro ao buscar estatísticas do aviso:', err);
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Buscar destinatários e status de leitura de um aviso
   * @param {string} noticeId - ID do aviso
   */
  const getNoticeRecipients = useCallback(async (noticeId) => {
    setLoading(true);
    setError(null);

    try {
      // Buscar destinatários
      const { data: recipientsData, error: recipientsError } = await supabase
        .from('notice_recipients')
        .select('*')
        .eq('notice_id', noticeId)
        .order('created_at', { ascending: true });

      if (recipientsError) throw recipientsError;

      if (recipientsData.length === 0) {
        return { success: true, data: [] };
      }

      const userIds = recipientsData.map((r) => r.user_id);

      // Buscar informações dos usuários da tabela user_profiles
      const { data: usersData, error: usersError } = await supabase
        .from('user_profiles')
        .select('user_id, email, name, role')
        .in('user_id', userIds);

      // Se não houver tabela user_profiles, tentar buscar via RPC
      let usersMap = {};
      if (usersError || !usersData) {
        // Fallback: tentar função RPC
        const { data: rpcUsers, error: rpcError } = await supabase.rpc(
          'get_all_users',
        );

        if (!rpcError && rpcUsers) {
          rpcUsers.forEach((u) => {
            usersMap[u.id] = u;
          });
        }
      } else {
        usersData.forEach((u) => {
          usersMap[u.user_id] = {
            email: u.email,
            name: u.name,
            role: u.role,
          };
        });
      }

      // Buscar status de leitura
      const { data: readsData, error: readsError } = await supabase
        .from('notice_reads')
        .select('user_id, read_at, confirmed_at')
        .eq('notice_id', noticeId)
        .in('user_id', userIds);

      if (readsError) throw readsError;

      // Mapear status de leitura
      const readsMap = {};
      (readsData || []).forEach((read) => {
        readsMap[read.user_id] = read;
      });

      // Combinar dados
      const formattedData = recipientsData.map((item) => {
        const userInfo = usersMap[item.user_id] || {};
        const readStatus = readsMap[item.user_id];

        return {
          user_id: item.user_id,
          role: item.role,
          email: userInfo.email || 'Email não disponível',
          name: userInfo.name || userInfo.email || 'Usuário',
          has_read: !!readStatus,
          has_confirmed: !!readStatus?.confirmed_at,
          read_at: readStatus?.read_at || null,
          confirmed_at: readStatus?.confirmed_at || null,
        };
      });

      return { success: true, data: formattedData };
    } catch (err) {
      console.error('Erro ao buscar destinatários do aviso:', err);
      setError(err.message);
      return { success: false, error: err.message, data: [] };
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Buscar todos os avisos criados (para painel admin)
   * @param {Object} filters - Filtros opcionais
   */
  const getAllNotices = useCallback(async (filters = {}) => {
    setLoading(true);
    setError(null);

    try {
      let query = supabase
        .from('notices')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      // Aplicar filtros se necessário
      if (filters.startDate) {
        query = query.gte('created_at', filters.startDate);
      }
      if (filters.endDate) {
        query = query.lte('created_at', filters.endDate);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;

      return { success: true, data: data || [] };
    } catch (err) {
      console.error('Erro ao buscar todos os avisos:', err);
      setError(err.message);
      return { success: false, error: err.message, data: [] };
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Atualizar um aviso
   * @param {string} noticeId - ID do aviso
   * @param {Object} updates - Dados a atualizar
   */
  const updateNotice = useCallback(async (noticeId, updates) => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: updateError } = await supabase
        .from('notices')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq('id', noticeId)
        .select()
        .single();

      if (updateError) throw updateError;

      return { success: true, data };
    } catch (err) {
      console.error('Erro ao atualizar aviso:', err);
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Deletar (desativar) um aviso
   * @param {string} noticeId - ID do aviso
   */
  const deleteNotice = useCallback(async (noticeId) => {
    setLoading(true);
    setError(null);

    try {
      const { error: deleteError } = await supabase
        .from('notices')
        .update({ is_active: false })
        .eq('id', noticeId);

      if (deleteError) throw deleteError;

      return { success: true };
    } catch (err) {
      console.error('Erro ao deletar aviso:', err);
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Buscar contagem de avisos não lidos para um usuário
   * @param {string} userId - ID do usuário
   */
  const getUnreadCount = useCallback(async (userId) => {
    try {
      const { data, error: fetchError } = await supabase.rpc(
        'get_unread_notices',
        { p_user_id: userId },
      );

      if (fetchError) throw fetchError;

      return { success: true, count: data?.length || 0 };
    } catch (err) {
      console.error('Erro ao buscar contagem de não lidos:', err);
      return { success: false, count: 0 };
    }
  }, []);

  return {
    loading,
    error,
    createNotice,
    getUnreadNotices,
    getUserNotices,
    getTodayUnreadNotices,
    markAsRead,
    confirmRead,
    getNoticeStats,
    getNoticeRecipients,
    getAllNotices,
    updateNotice,
    deleteNotice,
    getUnreadCount,
  };
};
