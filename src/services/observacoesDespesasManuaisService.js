import { supabase } from '../lib/supabase';

/**
 * Serviço para gerenciar observações de despesas manuais
 * Usa a coluna 'observacoes' da própria tabela despesas_manuais_dre
 */

/**
 * Salvar/atualizar observação de despesa manual
 * Atualiza a coluna 'observacoes' na tabela despesas_manuais_dre
 * @param {Object} dados - Dados da observação
 * @param {string} dados.id - ID da despesa manual
 * @param {string} dados.observacao - Texto da observação
 * @returns {Promise<Object>} Despesa atualizada
 */
export const salvarObservacaoDespesaManual = async (dados) => {
  try {
    console.log('💬 Salvando observação de despesa manual:', dados);

    // Buscar usuário autenticado
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      console.error('❌ Erro ao buscar usuário:', userError);
      throw new Error('Usuário não autenticado');
    }

    // UPDATE da coluna observacoes na tabela despesas_manuais_dre
    const { data, error } = await supabase
      .from('despesas_manuais_dre')
      .update({
        observacoes: dados.observacao,
        cd_usuario: user.id,
      })
      .eq('id', dados.id)
      .select('*')
      .single();

    if (error) {
      console.error('❌ Erro ao atualizar observação:', error);
      throw error;
    }

    console.log('✅ Observação atualizada com sucesso:', data);

    // Buscar dados do usuário da view
    const { data: usuarioData, error: usuarioError } = await supabase
      .from('usuarios_view')
      .select('*')
      .eq('id', user.id)
      .single();

    if (usuarioError) {
      console.warn('⚠️ Erro ao buscar usuário da observação:', usuarioError);
      // Continuar sem dados do usuário (não é crítico)
    }

    // Retornar despesa atualizada com dados do usuário
    return {
      success: true,
      data: {
        ...data,
        usuario: usuarioData || null,
      },
    };
  } catch (error) {
    console.error('❌ Erro ao salvar observação de despesa manual:', error);
    throw error;
  }
};

/**
 * Buscar observação de uma despesa manual
 * Retorna a coluna 'observacoes' da tabela despesas_manuais_dre
 * @param {string} idDespesaManual - ID da despesa manual
 * @returns {Promise<Object>} Observação da despesa
 */
export const buscarObservacaoDespesaManual = async (idDespesaManual) => {
  try {
    console.log('🔍 Buscando observação da despesa manual:', idDespesaManual);

    // Buscar a despesa com observação
    const { data, error } = await supabase
      .from('despesas_manuais_dre')
      .select('id, observacoes, cd_usuario, dt_cadastro')
      .eq('id', idDespesaManual)
      .eq('ativo', true)
      .single();

    if (error) {
      console.error('❌ Erro ao buscar observação:', error);
      throw error;
    }

    if (!data || !data.observacoes) {
      console.log('ℹ️ Nenhuma observação encontrada');
      return { success: true, data: null };
    }

    console.log('✅ Observação encontrada');

    // Buscar dados do usuário se houver cd_usuario
    let usuario = null;
    if (data.cd_usuario) {
      const { data: usuarioData, error: usuarioError } = await supabase
        .from('usuarios_view')
        .select('*')
        .eq('id', data.cd_usuario)
        .single();

      if (usuarioError) {
        console.warn('⚠️ Erro ao buscar usuário:', usuarioError);
      } else {
        usuario = usuarioData;
      }
    }

    // Retornar observação com dados do usuário
    return {
      success: true,
      data: {
        id: data.id,
        observacao: data.observacoes,
        cd_usuario: data.cd_usuario,
        dt_cadastro: data.dt_cadastro,
        usuario: usuario,
      },
    };
  } catch (error) {
    console.error('❌ Erro ao buscar observação de despesa manual:', error);
    throw error;
  }
};

/**
 * Limpar observação de uma despesa manual
 * @param {string} idDespesaManual - ID da despesa manual
 * @returns {Promise<Object>} Resultado da operação
 */
export const limparObservacaoDespesaManual = async (idDespesaManual) => {
  try {
    console.log('🗑️ Limpando observação de despesa manual:', idDespesaManual);

    // Buscar usuário autenticado
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      console.error('❌ Erro ao buscar usuário:', userError);
      throw new Error('Usuário não autenticado');
    }

    const { data, error } = await supabase
      .from('despesas_manuais_dre')
      .update({
        observacoes: null,
        cd_usuario: user.id,
      })
      .eq('id', idDespesaManual)
      .select()
      .single();

    if (error) {
      console.error('❌ Erro ao limpar observação:', error);
      throw error;
    }

    console.log('✅ Observação limpa com sucesso:', data);
    return { success: true, data };
  } catch (error) {
    console.error('❌ Erro ao limpar observação de despesa manual:', error);
    throw error;
  }
};

/**
 * Buscar observações de múltiplas despesas manuais (usado no DRE)
 * @param {Array<string>} idsDespesas - Array de IDs de despesas manuais
 * @returns {Promise<Object>} Map de observações por ID de despesa
 */
export const buscarObservacoesMultiplasDespesas = async (idsDespesas) => {
  try {
    console.log(
      `🔍 Buscando observações de ${idsDespesas.length} despesas manuais`,
    );

    // Buscar todas as despesas com observações
    const { data: despesas, error } = await supabase
      .from('despesas_manuais_dre')
      .select('id, observacoes, cd_usuario, dt_cadastro')
      .in('id', idsDespesas)
      .eq('ativo', true)
      .not('observacoes', 'is', null);

    if (error) {
      console.error('❌ Erro ao buscar observações:', error);
      throw error;
    }

    if (!despesas || despesas.length === 0) {
      console.log('ℹ️ Nenhuma observação encontrada');
      return { success: true, data: new Map() };
    }

    console.log(`✅ ${despesas.length} observações encontradas`);

    // Buscar dados dos usuários
    const usuariosIds = [
      ...new Set(despesas.filter((d) => d.cd_usuario).map((d) => d.cd_usuario)),
    ];

    let usuarios = [];
    if (usuariosIds.length > 0) {
      const { data: usuariosData, error: usuariosError } = await supabase
        .from('usuarios_view')
        .select('*')
        .in('id', usuariosIds);

      if (usuariosError) {
        console.warn('⚠️ Erro ao buscar usuários:', usuariosError);
      } else {
        usuarios = usuariosData || [];
      }
    }

    // Criar mapa de usuários
    const usuariosMap = new Map();
    usuarios.forEach((usuario) => {
      usuariosMap.set(usuario.id, usuario);
    });

    // Criar mapa de observações por despesa
    const observacoesMap = new Map();
    despesas.forEach((despesa) => {
      observacoesMap.set(despesa.id, {
        id: despesa.id,
        observacao: despesa.observacoes,
        cd_usuario: despesa.cd_usuario,
        dt_cadastro: despesa.dt_cadastro,
        usuario: usuariosMap.get(despesa.cd_usuario) || null,
      });
    });

    console.log(
      `✅ Observações agrupadas para ${observacoesMap.size} despesas`,
    );
    return { success: true, data: observacoesMap };
  } catch (error) {
    console.error(
      '❌ Erro ao buscar observações de múltiplas despesas:',
      error,
    );
    throw error;
  }
};
