import { supabase } from './supabase';

// Constantes para status de autorização
export const STATUS_AUTORIZACAO = {
  NAO_AUTORIZADO: 'NAO_AUTORIZADO',
  AUTORIZADO: 'AUTORIZADO',
  ENVIADO_PAGAMENTO: 'ENVIADO_PAGAMENTO'
};

// Funções para gerenciar autorizações no Supabase
export const autorizacoesSupabase = {
  // Buscar todas as autorizações
  async buscarAutorizacoes() {
    try {
      const { data, error } = await supabase
        .from('contas_autorizacoes')
        .select('*')
        .order('autorizado_em', { ascending: false });
      
      if (error) throw error;
      
      // Converter para o formato usado no frontend
      const autorizacoes = {};
      data.forEach(item => {
        autorizacoes[item.chave_unica] = {
          autorizadoPor: item.autorizado_por,
          status: item.status || STATUS_AUTORIZACAO.AUTORIZADO,
          enviadoPor: item.enviado_por,
          dataAutorizacao: item.autorizado_em,
          dataEnvioPagamento: item.data_envio_pagamento
        };
      });
      
      return { data: autorizacoes, error: null };
    } catch (error) {
      console.error('Erro ao buscar autorizações:', error);
      return { data: null, error };
    }
  },

  // Autorizar uma conta
  async autorizarConta(chaveUnica, dadosConta, autorizadoPor) {
    try {
      const { data, error } = await supabase
        .from('contas_autorizacoes')
        .upsert({
          chave_unica: chaveUnica,
          cd_fornecedor: dadosConta.cd_fornecedor,
          nr_duplicata: dadosConta.nr_duplicata,
          cd_empresa: dadosConta.cd_empresa,
          nr_parcela: dadosConta.nr_parcela,
          autorizado_por: autorizadoPor,
          status: STATUS_AUTORIZACAO.AUTORIZADO,
          autorizado_em: new Date().toISOString()
        }, {
          onConflict: 'chave_unica'
        })
        .select();
      
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Erro ao autorizar conta:', error);
      return { data: null, error };
    }
  },

  // Enviar conta para pagamento
  async enviarParaPagamento(chaveUnica, enviadoPor) {
    try {
      const { data, error } = await supabase
        .from('contas_autorizacoes')
        .update({
          status: STATUS_AUTORIZACAO.ENVIADO_PAGAMENTO,
          enviado_por: enviadoPor,
          data_envio_pagamento: new Date().toISOString()
        })
        .eq('chave_unica', chaveUnica)
        .select();
      
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Erro ao enviar para pagamento:', error);
      return { data: null, error };
    }
  },

  // Remover status "enviado para pagamento"
  async removerEnviadoParaPagamento(chaveUnica) {
    try {
      const { data, error } = await supabase
        .from('contas_autorizacoes')
        .update({
          status: STATUS_AUTORIZACAO.AUTORIZADO,
          enviado_por: null,
          data_envio_pagamento: null
        })
        .eq('chave_unica', chaveUnica)
        .select();
      
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Erro ao remover enviado para pagamento:', error);
      return { data: null, error };
    }
  },

  // Remover autorização de uma conta
  async removerAutorizacao(chaveUnica) {
    try {
      const { error } = await supabase
        .from('contas_autorizacoes')
        .delete()
        .eq('chave_unica', chaveUnica);
      
      if (error) throw error;
      return { data: true, error: null };
    } catch (error) {
      console.error('Erro ao remover autorização:', error);
      return { data: null, error };
    }
  },

  // Autorizar múltiplas contas
  async autorizarMultiplasContas(contas, autorizadoPor) {
    try {
      const dadosParaInserir = contas.map(grupo => ({
        chave_unica: `${grupo.item.cd_fornecedor}|${grupo.item.nr_duplicata}|${grupo.item.cd_empresa}|${grupo.item.nr_parcela}`,
        cd_fornecedor: grupo.item.cd_fornecedor,
        nr_duplicata: grupo.item.nr_duplicata,
        cd_empresa: grupo.item.cd_empresa,
        nr_parcela: grupo.item.nr_parcela,
        autorizado_por: autorizadoPor,
        status: STATUS_AUTORIZACAO.AUTORIZADO,
        autorizado_em: new Date().toISOString()
      }));

      const { data, error } = await supabase
        .from('contas_autorizacoes')
        .upsert(dadosParaInserir, {
          onConflict: 'chave_unica'
        })
        .select();
      
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Erro ao autorizar múltiplas contas:', error);
      return { data: null, error };
    }
  },

  // Enviar múltiplas contas para pagamento
  async enviarMultiplasParaPagamento(chavesUnicas, enviadoPor) {
    try {
      const { data, error } = await supabase
        .from('contas_autorizacoes')
        .update({
          status: STATUS_AUTORIZACAO.ENVIADO_PAGAMENTO,
          enviado_por: enviadoPor,
          data_envio_pagamento: new Date().toISOString()
        })
        .in('chave_unica', chavesUnicas)
        .select();
      
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Erro ao enviar múltiplas contas para pagamento:', error);
      return { data: null, error };
    }
  },

  // Remover múltiplas contas enviadas para pagamento
  async removerMultiplasEnviadasParaPagamento(chavesUnicas) {
    try {
      const { data, error } = await supabase
        .from('contas_autorizacoes')
        .update({
          status: STATUS_AUTORIZACAO.AUTORIZADO,
          enviado_por: null,
          data_envio_pagamento: null
        })
        .in('chave_unica', chavesUnicas)
        .select();
      
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Erro ao remover múltiplas contas enviadas para pagamento:', error);
      return { data: null, error };
    }
  },

  // Remover múltiplas autorizações
  async removerMultiplasAutorizacoes(contas) {
    try {
      const chavesUnicas = contas.map(grupo => 
        `${grupo.item.cd_fornecedor}|${grupo.item.nr_duplicata}|${grupo.item.cd_empresa}|${grupo.item.nr_parcela}`
      );

      const { error } = await supabase
        .from('contas_autorizacoes')
        .delete()
        .in('chave_unica', chavesUnicas);
      
      if (error) throw error;
      return { data: true, error: null };
    } catch (error) {
      console.error('Erro ao remover múltiplas autorizações:', error);
      return { data: null, error };
    }
  },

  // Buscar autorizações por período
  async buscarAutorizacoesPorPeriodo(dataInicio, dataFim) {
    try {
      const { data, error } = await supabase
        .from('contas_autorizacoes')
        .select('*')
        .gte('autorizado_em', dataInicio)
        .lte('autorizado_em', dataFim)
        .order('autorizado_em', { ascending: false });
      
      if (error) throw error;
      
      const autorizacoes = {};
      data.forEach(item => {
        autorizacoes[item.chave_unica] = {
          autorizadoPor: item.autorizado_por,
          status: item.status || STATUS_AUTORIZACAO.AUTORIZADO,
          enviadoPor: item.enviado_por,
          dataAutorizacao: item.autorizado_em,
          dataEnvioPagamento: item.data_envio_pagamento
        };
      });
      
      return { data: autorizacoes, error: null };
    } catch (error) {
      console.error('Erro ao buscar autorizações por período:', error);
      return { data: null, error };
    }
  },

  // Buscar estatísticas de autorizações
  async buscarEstatisticasAutorizacoes() {
    try {
      const { data, error } = await supabase
        .from('contas_autorizacoes')
        .select('autorizado_por, status, autorizado_em')
        .order('autorizado_em', { ascending: false });
      
      if (error) throw error;
      
      // Agrupar por autorizador e status
      const estatisticas = {};
      data.forEach(item => {
        if (!estatisticas[item.autorizado_por]) {
          estatisticas[item.autorizado_por] = {
            total: 0,
            autorizados: 0,
            enviadosPagamento: 0
          };
        }
        estatisticas[item.autorizado_por].total++;
        
        if (item.status === STATUS_AUTORIZACAO.AUTORIZADO) {
          estatisticas[item.autorizado_por].autorizados++;
        } else if (item.status === STATUS_AUTORIZACAO.ENVIADO_PAGAMENTO) {
          estatisticas[item.autorizado_por].enviadosPagamento++;
        }
      });
      
      return { data: estatisticas, error: null };
    } catch (error) {
      console.error('Erro ao buscar estatísticas:', error);
      return { data: null, error };
    }
  }
};
