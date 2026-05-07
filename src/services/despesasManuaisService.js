import { supabase } from '../lib/supabase';

/**
 * Serviço para gerenciar despesas manuais do DRE
 * Interage diretamente com a tabela despesas_manuais_dre no Supabase
 */

/**
 * Adicionar uma nova despesa manual
 * @param {Object} despesa - Dados da despesa
 * @returns {Promise<Object>} Despesa criada
 */
export const adicionarDespesaManual = async (despesa) => {
  try {
    console.log('💾 Salvando despesa manual no Supabase:', despesa);

    const { data, error } = await supabase
      .from('despesas_manuais_dre')
      .insert([despesa])
      .select()
      .single();

    if (error) {
      console.error('❌ Erro ao salvar despesa manual:', error);
      throw new Error(error.message || 'Erro ao salvar despesa manual');
    }

    console.log('✅ Despesa manual salva com sucesso:', data);
    return { success: true, data };
  } catch (error) {
    console.error('❌ Erro ao adicionar despesa manual:', error);
    throw error;
  }
};

/**
 * Listar despesas manuais com filtros opcionais
 * @param {Object} filtros - Filtros de busca
 * @returns {Promise<Array>} Lista de despesas
 */
export const listarDespesasManuais = async (filtros = {}) => {
  try {
    console.log('🔍 Buscando despesas manuais:', filtros);

    let query = supabase
      .from('despesas_manuais_dre')
      .select('*')
      .order('dt_cadastro', { ascending: false });

    // Aplicar filtros
    if (filtros.dt_inicio) {
      query = query.gte('dt_inicio', filtros.dt_inicio);
    }

    if (filtros.dt_fim) {
      query = query.lte('dt_fim', filtros.dt_fim);
    }

    if (filtros.categoria_principal) {
      query = query.eq('categoria_principal', filtros.categoria_principal);
    }

    if (filtros.ativo !== undefined) {
      query = query.eq('ativo', filtros.ativo);
    }

    const { data, error } = await query;

    if (error) {
      console.error('❌ Erro ao listar despesas manuais:', error);
      throw new Error(error.message || 'Erro ao listar despesas manuais');
    }

    // 🆕 Buscar informações dos usuários separadamente
    if (data && data.length > 0) {
      const userIds = [
        ...new Set(data.map((d) => d.cd_usuario).filter(Boolean)),
      ];

      if (userIds.length > 0) {
        const { data: users, error: userError } = await supabase
          .from('usuarios_view')
          .select('id, email, raw_user_meta_data')
          .in('id', userIds);

        if (!userError && users) {
          // Criar mapa de usuários
          const userMap = new Map(users.map((u) => [u.id, u]));

          // Adicionar informações do usuário a cada despesa
          data.forEach((despesa) => {
            if (despesa.cd_usuario) {
              despesa.usuario = userMap.get(despesa.cd_usuario);
            }
          });
        }
      }
    }

    console.log(`✅ ${data.length} despesas manuais encontradas`);
    return { success: true, data };
  } catch (error) {
    console.error('❌ Erro ao listar despesas manuais:', error);
    throw error;
  }
};

/**
 * Editar uma despesa manual existente
 * @param {string} id - UUID da despesa
 * @param {Object} despesa - Dados atualizados
 * @returns {Promise<Object>} Despesa atualizada
 */
export const editarDespesaManual = async (id, despesa) => {
  try {
    console.log('✏️ Editando despesa manual:', id, despesa);

    const { data, error } = await supabase
      .from('despesas_manuais_dre')
      .update(despesa)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('❌ Erro ao editar despesa manual:', error);
      throw new Error(error.message || 'Erro ao editar despesa manual');
    }

    console.log('✅ Despesa manual editada com sucesso:', data);
    return { success: true, data };
  } catch (error) {
    console.error('❌ Erro ao editar despesa manual:', error);
    throw error;
  }
};

/**
 * Excluir (desativar) uma despesa manual
 * @param {string} id - UUID da despesa
 * @returns {Promise<Object>} Resposta da operação
 */
export const excluirDespesaManual = async (id) => {
  try {
    console.log('🗑️ Excluindo despesa manual:', id);

    const { data, error } = await supabase
      .from('despesas_manuais_dre')
      .update({ ativo: false })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('❌ Erro ao excluir despesa manual:', error);
      throw new Error(error.message || 'Erro ao excluir despesa manual');
    }

    console.log('✅ Despesa manual excluída com sucesso:', data);
    return { success: true, data };
  } catch (error) {
    console.error('❌ Erro ao excluir despesa manual:', error);
    throw error;
  }
};

/**
 * Buscar uma despesa manual por ID
 * @param {string} id - UUID da despesa
 * @returns {Promise<Object>} Despesa encontrada
 */
export const buscarDespesaManualPorId = async (id) => {
  try {
    console.log('🔍 Buscando despesa manual por ID:', id);

    const { data, error } = await supabase
      .from('despesas_manuais_dre')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('❌ Erro ao buscar despesa manual:', error);
      throw new Error(error.message || 'Erro ao buscar despesa manual');
    }

    console.log('✅ Despesa manual encontrada:', data);
    return { success: true, data };
  } catch (error) {
    console.error('❌ Erro ao buscar despesa manual:', error);
    throw error;
  }
};
