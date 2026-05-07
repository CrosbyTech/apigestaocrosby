import { supabase } from './supabase';

// Nome da tabela no Supabase
const TABLE_NAME = 'retorno_bancario';

/**
 * Verifica se um arquivo já foi processado
 * @param {string} nomeArquivo - Nome do arquivo
 * @param {number} valor - Valor do saldo
 * @param {string} bancoNome - Nome do banco
 * @param {string} bancoCodigo - Código do banco
 * @param {string} dataGeracao - Data de geração do arquivo
 * @returns {Promise<boolean>} - true se já existe, false se não
 */
export const verificarArquivoExistente = async (nomeArquivo, valor, bancoNome, bancoCodigo, dataGeracao) => {
  try {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select('id')
      .eq('nome_arquivo', nomeArquivo)
      .eq('valor', valor)
      .eq('banco_nome', bancoNome)
      .eq('banco_codigo', bancoCodigo)
      .eq('data_geracao', dataGeracao)
      .single();

    if (error) {
      if (error.code === 'PGRST116') { // PGRST116 = no rows returned
        return false; // Arquivo não existe
      }
      if (error.code === '42501') { // Erro de permissão RLS
        console.warn('Erro de permissão RLS - assumindo que arquivo não existe:', error.message);
        return false; // Assumir que não existe para permitir inserção
      }
      console.error('Erro ao verificar arquivo existente:', error);
      throw error;
    }

    return !!data; // Retorna true se encontrou, false se não
  } catch (error) {
    console.error('Erro na verificação de arquivo existente:', error);
    // Em caso de erro, assumir que arquivo não existe para permitir inserção
    return false;
  }
};

/**
 * Salva os dados do arquivo .RET no Supabase
 * @param {Object} dados - Dados do arquivo processado
 * @returns {Promise<Object>} - Resultado da operação
 */
export const salvarRetornoBancario = async (dados) => {
  try {
    // Verificar se o arquivo já existe
    const arquivoExiste = await verificarArquivoExistente(
      dados.nomeArquivo,
      dados.valor,
      dados.banco.nome,
      dados.banco.codigo,
      dados.dataGeracao
    );

    if (arquivoExiste) {
      return {
        success: false,
        message: `Arquivo "${dados.nomeArquivo}" já foi processado anteriormente`,
        duplicate: true
      };
    }

    // Preparar dados para inserção
    const dadosParaInserir = {
      nome_arquivo: dados.nomeArquivo,
      data_upload: dados.dataUpload,
      valor: dados.valor,
      banco_nome: dados.banco.nome,
      banco_codigo: dados.banco.codigo,
      banco_layout: dados.banco.layout,
      agencia: dados.agencia,
      conta: dados.conta,
      saldo_formatado: dados.saldoFormatado,
      data_processamento: new Date().toISOString(),
      data_geracao: dados.dataGeracao,
      // Campos de operação (se fornecidos pelo backend)
      operacao_tipo: dados.operacao?.tipo || null,
      operacao_descricao: dados.operacao?.descricao || null,
      operacao_sinal: dados.operacao?.sinal || null,
      operacao_is_positive: dados.operacao?.isPositive || null,
      operacao_valor_absoluto: dados.operacao?.valorAbsoluto || null,
      created_at: new Date().toISOString()
    };

    // Inserir no Supabase
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .insert([dadosParaInserir])
      .select()
      .single();

    if (error) {
      if (error.code === '42501') { // Erro de permissão RLS
        console.error('Erro de permissão RLS - verifique se a tabela está configurada corretamente:', error.message);
        throw new Error('Erro de permissão no banco de dados. Verifique a configuração da tabela.');
      }
      if (error.code === '23505') { // Violação de chave única
        console.warn('Arquivo duplicado detectado pelo banco:', error.message);
        return {
          success: false,
          message: `Arquivo "${dados.nomeArquivo}" com valor ${dados.valor} do banco ${dados.banco.nome} e data de geração ${new Date(dados.dataGeracao).toLocaleString('pt-BR')} já foi processado anteriormente`,
          duplicate: true
        };
      }
      console.error('Erro ao salvar retorno bancário:', error);
      throw error;
    }

    return {
      success: true,
      message: 'Arquivo salvo com sucesso no banco de dados',
      data: data
    };

  } catch (error) {
    console.error('Erro ao salvar retorno bancário:', error);
    return {
      success: false,
      message: 'Erro ao salvar no banco de dados: ' + error.message,
      error: error
    };
  }
};

/**
 * Busca todos os retornos bancários salvos
 * @param {Object} filtros - Filtros opcionais
 * @returns {Promise<Array>} - Lista de retornos bancários
 */
export const buscarRetornosBancarios = async (filtros = {}) => {
  try {
    let query = supabase
      .from(TABLE_NAME)
      .select('*')
      .order('data_geracao', { ascending: false });

    // Aplicar filtros se fornecidos
    if (filtros.banco) {
      query = query.eq('banco_nome', filtros.banco);
    }

    if (filtros.dataInicio) {
      query = query.gte('data_geracao', filtros.dataInicio);
    }

    if (filtros.dataFim) {
      query = query.lte('data_geracao', filtros.dataFim);
    }

    if (filtros.limit) {
      query = query.limit(filtros.limit);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Erro ao buscar retornos bancários:', error);
      throw error;
    }

    return {
      success: true,
      data: data
    };

  } catch (error) {
    console.error('Erro ao buscar retornos bancários:', error);
    return {
      success: false,
      message: 'Erro ao buscar dados: ' + error.message,
      error: error
    };
  }
};

/**
 * Busca estatísticas dos retornos bancários
 * @returns {Promise<Object>} - Estatísticas
 */
export const buscarEstatisticasRetornos = async () => {
  try {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select('valor, banco_nome, data_geracao');

    if (error) {
      console.error('Erro ao buscar estatísticas:', error);
      throw error;
    }

    // Calcular estatísticas
    const totalArquivos = data.length;
    const saldoTotal = data.reduce((sum, item) => sum + parseFloat(item.valor), 0);
    const bancosUnicos = [...new Set(data.map(item => item.banco_nome))];
    
    // Agrupar por banco
    const porBanco = {};
    data.forEach(item => {
      if (!porBanco[item.banco_nome]) {
        porBanco[item.banco_nome] = {
          total: 0,
          valor: 0
        };
      }
      porBanco[item.banco_nome].total++;
      porBanco[item.banco_nome].valor += parseFloat(item.valor);
    });

    return {
      success: true,
      data: {
        totalArquivos,
        saldoTotal,
        saldoTotalFormatado: new Intl.NumberFormat('pt-BR', {
          style: 'currency',
          currency: 'BRL'
        }).format(saldoTotal),
        bancosUnicos,
        porBanco
      }
    };

  } catch (error) {
    console.error('Erro ao buscar estatísticas:', error);
    return {
      success: false,
      message: 'Erro ao buscar estatísticas: ' + error.message,
      error: error
    };
  }
};

/**
 * Remove um retorno bancário específico
 * @param {number} id - ID do registro
 * @returns {Promise<Object>} - Resultado da operação
 */
export const removerRetornoBancario = async (id) => {
  try {
    const { error } = await supabase
      .from(TABLE_NAME)
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Erro ao remover retorno bancário:', error);
      throw error;
    }

    return {
      success: true,
      message: 'Registro removido com sucesso'
    };

  } catch (error) {
    console.error('Erro ao remover retorno bancário:', error);
    return {
      success: false,
      message: 'Erro ao remover registro: ' + error.message,
      error: error
    };
  }
};

/**
 * Busca saldos por conta e período na tabela retorno_bancario
 * @param {Object} filtros - Filtros de busca
 * @param {Array} contas - Array de números de conta
 * @param {string} dataInicio - Data de início (YYYY-MM-DD)
 * @param {string} dataFim - Data de fim (YYYY-MM-DD)
 * @returns {Promise<Object>} - Resultado da busca
 */
export const buscarSaldosPorConta = async (filtros = {}) => {
  try {
    let query = supabase
      .from(TABLE_NAME)
      .select('*')
      .neq('nome_arquivo', 'saldo_manual_deletado') // Excluir registros marcados como deletados
      .neq('nome_arquivo', 'limite_cheque_especial') // Não misturar limite como registro de saldo
      .order('data_geracao', { ascending: false });

    // Aplicar filtros se fornecidos
    if (filtros.contas && filtros.contas.length > 0) {
      query = query.in('conta', filtros.contas);
    }

    if (filtros.dataInicio) {
      query = query.gte('data_geracao', filtros.dataInicio + 'T00:00:00');
    }

    if (filtros.dataFim) {
      query = query.lte('data_geracao', filtros.dataFim + 'T23:59:59');
    }

    if (filtros.banco) {
      query = query.eq('banco_nome', filtros.banco);
    }

    // Se não há filtros, retornar todos os dados
    if (Object.keys(filtros).length === 0) {
      query = supabase
        .from(TABLE_NAME)
        .select('*')
        .neq('nome_arquivo', 'saldo_manual_deletado')
        .neq('nome_arquivo', 'limite_cheque_especial')
        .order('data_geracao', { ascending: false });
    }

        const { data, error } = await query;

     console.log('🔍 Dados retornados da query:', data?.length || 0, 'registros');
     console.log('🔍 Exemplo de registro:', data?.[0]);

     if (error) {
       console.error('Erro ao buscar saldos por conta:', error);
       throw error;
     }

    // Processar os dados para agrupar por conta
    const saldosPorConta = {};
    
    data.forEach(item => {
      const conta = item.conta;
      if (!saldosPorConta[conta]) {
        saldosPorConta[conta] = {
          numero: conta,
          nome: `Conta ${conta}`,
          saldo: 0,
          ultimaAtualizacao: null,
          banco: item.banco_nome,
          agencia: item.agencia,
          operacao: {
            tipo: item.operacao_tipo,
            descricao: item.operacao_descricao,
            sinal: item.operacao_sinal,
            isPositive: item.operacao_is_positive,
            valorAbsoluto: item.operacao_valor_absoluto
          },
          registros: []
        };
      }
      
      // Usar o valor mais recente como saldo atual (baseado na data_geracao)
      const dataGeracao = new Date(item.data_geracao);
      if (!saldosPorConta[conta].ultimaAtualizacao || dataGeracao > saldosPorConta[conta].ultimaAtualizacao) {
        saldosPorConta[conta].saldo = parseFloat(item.valor);
        saldosPorConta[conta].ultimaAtualizacao = dataGeracao;
        saldosPorConta[conta].banco = item.banco_nome;
        saldosPorConta[conta].agencia = item.agencia;
      }
      
      saldosPorConta[conta].registros.push(item);
    });

    // Converter para array e ordenar por saldo
    const resultado = Object.values(saldosPorConta).sort((a, b) => b.saldo - a.saldo);

    return {
      success: true,
      data: resultado,
      totalRegistros: data.length,
      totalContas: resultado.length
    };

  } catch (error) {
    console.error('Erro ao buscar saldos por conta:', error);
    return {
      success: false,
      message: 'Erro ao buscar dados: ' + error.message,
      error: error
    };
  }
};

/**
 * Busca o limite de cheque especial para um banco específico
 * @param {string} bancoNome - Nome do banco
 * @returns {Promise<Object>} - Resultado da busca
 */
export const buscarLimiteChequeEspecial = async (bancoNome, agenciaNumero, contaNumero) => {
  try {
    console.log(`🔍 Buscando limite para banco/agencia/conta: ${bancoNome} / ${agenciaNumero} / ${contaNumero}`);
    
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select('chq_especial, conta, agencia')
      .eq('banco_nome', bancoNome)
      .eq('agencia', agenciaNumero)
      .eq('conta', contaNumero)
      .eq('nome_arquivo', 'limite_cheque_especial')
      .not('chq_especial', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      if (error.code === 'PGRST116') { // No rows returned
        return { success: true, data: null };
      }
      console.error('Erro ao buscar limite de cheque especial:', error);
      throw error;
    }

    return {
      success: true,
      data: data?.chq_especial || null,
      conta: data?.conta || null,
      agencia: data?.agencia || null
    };
  } catch (error) {
    console.error('Erro ao buscar limite de cheque especial:', error);
    return {
      success: false,
      message: 'Erro ao buscar limite: ' + error.message,
      error: error
    };
  }
};

/**
 * Salva um saldo bancário inserido manualmente
 * @param {Object} dados - Dados do saldo manual
 * @returns {Promise<Object>} - Resultado da operação
 */
export const salvarSaldoManual = async (dados) => {
  try {
        // Preparar dados para inserção
    const dadosParaInserir = {
      nome_arquivo: dados.nome_arquivo,
      data_upload: dados.data_upload,
      valor: dados.valor,
      banco_nome: dados.banco_nome,
      banco_codigo: dados.banco_codigo,
      banco_layout: dados.banco_layout,
      agencia: dados.agencia,
      conta: dados.conta,
      saldo_formatado: dados.saldo_formatado,
      data_processamento: dados.data_processamento,
      data_geracao: dados.data_geracao,
      operacao_tipo: dados.operacao_tipo,
      operacao_descricao: dados.operacao_descricao,
      operacao_sinal: dados.operacao_sinal,
      operacao_is_positive: dados.operacao_is_positive,
      operacao_valor_absoluto: dados.operacao_valor_absoluto,
      chq_especial: dados.chq_especial,
      usuario_inseriu: dados.usuario_inseriu,
      created_at: dados.created_at
    };

   // Inserir no Supabase
   const { data, error } = await supabase
     .from(TABLE_NAME)
     .insert([dadosParaInserir])
     .select()
     .single();

   if (error) {
     if (error.code === '42501') { // Erro de permissão RLS
       console.error('Erro de permissão RLS - verifique se a tabela está configurada corretamente:', error.message);
       throw new Error('Erro de permissão no banco de dados. Verifique a configuração da tabela.');
     }
     if (error.code === '23505') { // Violação de chave única
       console.warn('Saldo duplicado detectado pelo banco:', error.message);
       return {
         success: false,
         message: `Saldo para ${dados.banco_nome} - Agência ${dados.agencia} - Conta ${dados.conta} já foi inserido anteriormente`,
         duplicate: true
       };
     }
     console.error('Erro ao salvar saldo manual:', error);
     throw error;
   }

   return {
     success: true,
     message: 'Saldo manual salvo com sucesso no banco de dados',
     data: data
   };

 } catch (error) {
   console.error('Erro ao salvar saldo manual:', error);
   return {
     success: false,
     message: 'Erro ao salvar no banco de dados: ' + error.message,
     error: error
   };
 }
};

 /**
  * Remove um saldo bancário manual
  * @param {number} id - ID do registro
  * @returns {Promise<Object>} - Resultado da operação
  */
 export const removerSaldoManual = async (id) => {
   try {
     console.log('🔍 Tentando remover saldo manual com ID:', id);
     
     // Primeiro, verificar se o registro existe e é um saldo manual
     const { data: checkData, error: checkError } = await supabase
       .from(TABLE_NAME)
       .select('*')
       .eq('id', id)
       .single();
     
     console.log('🔍 Verificação do registro:', { checkData, checkError });
     
     if (checkError) {
       console.error('❌ Erro ao verificar registro:', checkError);
       return {
         success: false,
         message: 'Registro não encontrado: ' + checkError.message
       };
     }
     
     if (!checkData || checkData.nome_arquivo !== 'saldo_manual') {
       console.error('❌ Registro não é um saldo manual:', checkData);
       return {
         success: false,
         message: 'Registro não é um saldo manual'
       };
     }
     
     console.log('✅ Registro encontrado e é um saldo manual. Tentando excluir...');
     
     // Tentar excluir usando apenas o ID (mais simples)
     const { data: deleteData, error: deleteError } = await supabase
       .from(TABLE_NAME)
       .delete()
       .eq('id', id)
       .select();

     console.log('📊 Resultado da query de exclusão:', { deleteData, deleteError });

     if (deleteError) {
       console.error('❌ Erro ao remover saldo manual:', deleteError);
       
       // Se der erro de permissão, tentar uma abordagem diferente
       if (deleteError.code === '42501') {
         console.log('🔄 Tentando abordagem alternativa para exclusão...');
         
         // Tentar marcar como deletado em vez de excluir fisicamente
         const { data: updateData, error: updateError } = await supabase
           .from(TABLE_NAME)
           .update({ 
             nome_arquivo: 'saldo_manual_deletado',
             data_processamento: new Date().toISOString()
           })
           .eq('id', id)
           .eq('nome_arquivo', 'saldo_manual')
           .select();
         
         console.log('📊 Resultado da marcação como deletado:', { updateData, updateError });
         
         if (updateError) {
           console.error('❌ Erro ao marcar como deletado:', updateError);
           return {
             success: false,
             message: 'Erro de permissão: ' + deleteError.message + '. Erro ao marcar como deletado: ' + updateError.message
           };
         }
         
         return {
           success: true,
           message: 'Saldo manual marcado como deletado (não foi possível excluir fisicamente)',
           data: updateData
         };
       }
       
       throw deleteError;
     }

     console.log('✅ Saldo manual removido com sucesso. Registros afetados:', deleteData?.length || 0);

     return {
       success: true,
       message: 'Saldo manual removido com sucesso',
       data: deleteData
     };

   } catch (error) {
     console.error('❌ Erro ao remover saldo manual:', error);
     return {
       success: false,
       message: 'Erro ao remover saldo: ' + error.message,
       error: error
     };
   }
 };

 /**
  * Salva ou atualiza o limite de cheque especial para um banco+conta
  * @param {string} bancoNome - Nome do banco
  * @param {number} limite - Valor do limite
  * @param {string} contaNumero - Número da conta
  * @returns {Promise<Object>} - Resultado da operação
  */
 export const salvarLimiteChequeEspecial = async (bancoNome, limite, contaNumero, agenciaNumero) => {
   try {
     // Buscar um registro existente para este banco+agência+conta do tipo 'limite_cheque_especial'
     const { data: existingData, error: searchError } = await supabase
       .from(TABLE_NAME)
       .select('*')
       .eq('banco_nome', bancoNome)
       .eq('agencia', agenciaNumero)
       .eq('conta', contaNumero)
       .eq('nome_arquivo', 'limite_cheque_especial')
       .order('created_at', { ascending: false })
       .limit(1)
       .maybeSingle();

     if (searchError && searchError.code !== 'PGRST116') {
       console.error('Erro ao buscar dados do banco/conta:', searchError);
       throw searchError;
     }

     let result;

     if (existingData) {
       // Atualizar o registro existente
       const { data: updateData, error: updateError } = await supabase
         .from(TABLE_NAME)
         .update({ chq_especial: limite, data_processamento: new Date().toISOString() })
         .eq('id', existingData.id)
         .select()
         .single();

       if (updateError) {
         console.error('Erro ao atualizar limite de cheque especial:', updateError);
         throw updateError;
       }

       result = updateData;
     } else {
       // Criar um novo registro do tipo 'limite_cheque_especial'
       const agora = new Date().toISOString();
       const novoRegistro = {
         nome_arquivo: 'limite_cheque_especial',
         data_upload: agora,
         valor: 0,
         banco_nome: bancoNome,
         banco_codigo: '000',
         banco_layout: 'limite',
         agencia: agenciaNumero,
         conta: contaNumero,
         chq_especial: limite,
         saldo_formatado: (0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
         data_processamento: agora,
         data_geracao: agora,
         created_at: agora
       };

       const { data: insertData, error: insertError } = await supabase
         .from(TABLE_NAME)
         .insert([novoRegistro])
         .select()
         .single();

       if (insertError) {
         console.error('Erro ao criar limite de cheque especial:', insertError);
         throw insertError;
       }

       result = insertData;
     }

     return {
       success: true,
       data: result,
       message: existingData ? 'Limite de cheque especial atualizado com sucesso' : 'Limite de cheque especial criado com sucesso'
     };

   } catch (error) {
     console.error('Erro ao salvar limite de cheque especial:', error);
     return {
       success: false,
       message: 'Erro ao salvar limite: ' + error.message,
       error: error
     };
   }
 };

 /**
  * Força a remoção de um saldo bancário manual (tenta múltiplas abordagens)
  * @param {number} id - ID do registro
  * @returns {Promise<Object>} - Resultado da operação
  */
 export const forcarRemocaoSaldoManual = async (id) => {
   try {
     console.log('🔨 Forçando remoção de saldo manual com ID:', id);
     
     // Abordagem 1: Tentar exclusão direta
     try {
       const { data, error } = await supabase
         .from(TABLE_NAME)
         .delete()
         .eq('id', id)
         .select();
       
       if (!error && data && data.length > 0) {
         console.log('✅ Exclusão direta bem-sucedida');
         return {
           success: true,
           message: 'Saldo manual removido com sucesso',
           data: data
         };
       }
     } catch (error) {
       console.log('❌ Exclusão direta falhou:', error.message);
     }
     
     // Abordagem 2: Marcar como deletado
     try {
       const { data, error } = await supabase
         .from(TABLE_NAME)
         .update({ 
           nome_arquivo: 'saldo_manual_deletado',
           data_processamento: new Date().toISOString()
         })
         .eq('id', id)
         .select();
       
       if (!error && data && data.length > 0) {
         console.log('✅ Marcação como deletado bem-sucedida');
         return {
           success: true,
           message: 'Saldo manual marcado como deletado',
           data: data
         };
       }
     } catch (error) {
       console.log('❌ Marcação como deletado falhou:', error.message);
     }
     
     // Abordagem 3: Tentar com RPC (se disponível)
     try {
       const { data, error } = await supabase
         .rpc('remover_saldo_manual', { saldo_id: id });
       
       if (!error && data) {
         console.log('✅ Remoção via RPC bem-sucedida');
         return {
           success: true,
           message: 'Saldo manual removido via RPC',
           data: data
         };
       }
     } catch (error) {
       console.log('❌ Remoção via RPC falhou:', error.message);
     }
     
     return {
       success: false,
       message: 'Não foi possível remover o saldo manual. Verifique as permissões do banco de dados.'
     };
     
   } catch (error) {
     console.error('❌ Erro ao forçar remoção de saldo manual:', error);
     return {
       success: false,
       message: 'Erro ao forçar remoção: ' + error.message,
       error: error
     };
   }
 };


