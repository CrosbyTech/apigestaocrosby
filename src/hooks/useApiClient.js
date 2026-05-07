import { useCallback } from 'react';
import { API_BASE_URL } from '../config/constants';

// API Key vem da variável de ambiente do Vite
const API_KEY = import.meta.env.VITE_API_KEY || '';

// Headers padrão com autenticação API Key
const defaultHeaders = {
  'x-api-key': API_KEY,
};

const jsonHeaders = {
  'Content-Type': 'application/json',
  'x-api-key': API_KEY,
};

/**
 * Hook personalizado para fazer chamadas à API
 * Padroniza o tratamento de respostas da nova estrutura da API
 */
const useApiClient = () => {
  // Método auxiliar para requisições POST/PUT/DELETE
  const apiMutate = useCallback(
    async (
      endpoint,
      method = 'POST',
      body = null,
      params = {},
      options = {},
    ) => {
      const { timeout } = options;
      let controller;
      let timeoutId;
      try {
        // Construir URL com parâmetros (para GET em métodos DELETE)
        const url = new URL(endpoint, API_BASE_URL);
        Object.keys(params).forEach((key) => {
          const value = params[key];
          if (value !== null && value !== undefined && value !== '') {
            url.searchParams.append(key, value);
          }
        });

        console.log(`🌐 API ${method}:`, url.toString(), body ? { body } : '');

        const fetchOptions = {
          method,
          headers: jsonHeaders,
        };

        if (timeout) {
          controller = new AbortController();
          fetchOptions.signal = controller.signal;
          timeoutId = setTimeout(() => controller.abort(), timeout);
        }

        if (body && (method === 'POST' || method === 'PUT')) {
          fetchOptions.body = JSON.stringify(body);
        }

        const response = await fetch(url.toString(), fetchOptions);

        if (!response.ok) {
          let errorBody = null;
          try {
            errorBody = await response.json();
          } catch {}
          const message =
            (errorBody && (errorBody.message || errorBody.error)) ||
            response.statusText ||
            'Erro ao processar requisição';

          console.error(`❌ Erro ${method}:`, {
            status: response.status,
            message,
            errorBody,
          });

          throw new Error(message);
        }

        const result = await response.json();
        console.log(`✅ ${method} Response:`, result);

        return result;
      } catch (error) {
        if (error.name === 'AbortError') {
          throw new Error(
            'Requisição expirou (timeout). Tente com um período menor ou menos lojas.',
          );
        }
        console.error(`❌ Erro na API ${method}:`, error);
        throw error;
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    },
    [],
  );

  const apiCall = useCallback(async (endpoint, params = {}) => {
    try {
      // Construir URL com parâmetros
      const url = new URL(endpoint, API_BASE_URL);
      Object.keys(params).forEach((key) => {
        const value = params[key];
        if (value !== null && value !== undefined && value !== '') {
          if (Array.isArray(value)) {
            value.forEach((v) => url.searchParams.append(key, v));
          } else {
            url.searchParams.append(key, value);
          }
        }
      });

      console.log('🌐 API Call:', url.toString());

      const response = await fetch(url.toString(), {
        headers: defaultHeaders,
      });

      if (!response.ok) {
        let errorBody = null;
        try {
          errorBody = await response.json();
        } catch {}
        const message =
          (errorBody && (errorBody.message || errorBody.error)) ||
          response.statusText ||
          'Erro ao processar requisição';
        console.warn('⚠️ Resposta não OK da API:', {
          status: response.status,
          statusText: response.statusText,
          body: errorBody,
          url: url.toString(),
        });
        return {
          success: false,
          faturamentoBazar: (params) =>
            apiCall('/api/faturamento/fatbazar', params),
          total: 0,
          message,
          status: response.status,
          error: errorBody?.error || null,
        };
      }

      const result = await response.json();
      console.log('📦 API Response:', result);
      console.log('📊 API Response Analysis:', {
        type: typeof result,
        hasSuccess: 'success' in result,
        hasData: 'data' in result,
        dataType: typeof result.data,
        isDataArray: Array.isArray(result.data),
        keys: Object.keys(result),
      });

      // Verificar se a resposta está na estrutura da nova API
      if (result && typeof result === 'object') {
        // Nova estrutura da API com successResponse()
        if (result.success !== undefined) {
          // Verificar se data é um objeto com propriedade data aninhada (estrutura real da API)
          let actualData = [];

          if (result.data && typeof result.data === 'object') {
            if (Array.isArray(result.data.data)) {
              // Estrutura aninhada: { data: { data: [...] } }
              actualData = result.data.data;
              console.log('🔍 Detectada estrutura aninhada (data.data)');
            } else if (
              result.data.data &&
              typeof result.data.data === 'object'
            ) {
              // Estrutura de objeto aninhado: { data: { data: { varejo: {...}, ... } } }
              actualData = result.data.data;
              console.log(
                '🔍 Detectada estrutura de objeto aninhado (data.data como objeto)',
              );
            } else if (Array.isArray(result.data)) {
              // Estrutura direta: { data: [...] }
              actualData = result.data;
              console.log('🔍 Detectada estrutura direta (data)');
            } else if (
              result.data.groupedData &&
              Array.isArray(result.data.groupedData)
            ) {
              // Estrutura de franquias: { data: { groupedData: [...] } }
              // Extrair todas as transações dos grupos
              actualData = result.data.groupedData.reduce((acc, grupo) => {
                if (grupo.transactions && Array.isArray(grupo.transactions)) {
                  return acc.concat(grupo.transactions);
                }
                return acc;
              }, []);
              console.log(
                '🔍 Detectada estrutura de franquias (data.groupedData)',
              );
            } else if (
              typeof result.data === 'object' &&
              !Array.isArray(result.data)
            ) {
              // Estrutura de objeto direto: { data: { varejo: {...}, ... } }
              actualData = result.data;
              console.log('🔍 Detectada estrutura de objeto direto');
            }
          }

          console.log('✅ Processando resposta da nova API:', {
            originalDataType: typeof result.data,
            isNestedStructure:
              result.data &&
              typeof result.data === 'object' &&
              'data' in result.data,
            actualDataLength: actualData.length,
            isArray: Array.isArray(actualData),
            estrutura:
              result.data && typeof result.data === 'object'
                ? Object.keys(result.data)
                : 'N/A',
          });

          return {
            success: result.success,
            data: actualData,
            total: result.data?.total || result.total || actualData.length,
            limit: result.data?.limit || result.limit || 50,
            offset: result.data?.offset || result.offset || 0,
            hasMore: result.data?.hasMore || result.hasMore || false,
            message: result.message || '',
            filtros: result.data?.filtros || result.filtros || {},
            metadata: {
              count: result.data?.count || result.count,
              periodo: result.data?.periodo || result.periodo,
              empresas: result.data?.empresas || result.empresas,
              estatisticas:
                result.data?.estatisticas ||
                result.data?.totais ||
                result.data?.totals ||
                result.estatisticas ||
                result.totais ||
                result.totals,
              totals: result.data?.totals || result.totals,
              optimized: result.data?.optimized || result.optimized,
              queryType: result.data?.queryType || result.queryType,
              operacoes_permitidas:
                result.data?.operacoes_permitidas ||
                result.operacoes_permitidas,
              performance: result.data?.performance || result.performance,
              ...result,
            },
            // Campos específicos da nova rota de faturamento
            periodo: result.data?.periodo || result.periodo,
            empresas: result.data?.empresas || result.empresas,
            operacoes_permitidas:
              result.data?.operacoes_permitidas || result.operacoes_permitidas,
            totals: result.data?.totals || result.totals,
            optimized: result.data?.optimized || result.optimized,
            queryType: result.data?.queryType || result.queryType,
            performance: result.data?.performance || result.performance,
          };
        }

        // Estrutura antiga - compatibilidade
        if (result.data && Array.isArray(result.data)) {
          return {
            success: true,
            data: result.data,
            total: result.total || result.data.length,
            message: 'Dados obtidos com sucesso',
          };
        }

        if (result.rows && Array.isArray(result.rows)) {
          return {
            success: true,
            data: result.rows,
            total: result.total || result.rows.length,
            message: 'Dados obtidos com sucesso',
          };
        }

        // Se for um array direto
        if (Array.isArray(result)) {
          return {
            success: true,
            data: result,
            total: result.length,
            message: 'Dados obtidos com sucesso',
          };
        }
      }

      // Fallback para formatos não reconhecidos
      console.warn('⚠️ Formato de resposta não reconhecido:', result);
      return {
        success: false,
        data: [],
        total: 0,
        message: 'Formato de dados inesperado',
      };
    } catch (error) {
      console.error('❌ Erro na API:', error);
      throw error;
    }
  }, []);

  // Buscar transações por operação
  const transacoesPorOperacao = useCallback(async (params = {}) => {
    const url = new URL('/api/sales/transacoes-por-operacao', API_BASE_URL);
    Object.keys(params).forEach((key) => {
      const value = params[key];
      if (value !== null && value !== undefined && value !== '') {
        if (Array.isArray(value)) {
          value.forEach((v) => url.searchParams.append(key, v));
        } else {
          url.searchParams.append(key, value);
        }
      }
    });
    const response = await fetch(url.toString(), {
      headers: defaultHeaders,
    });
    if (!response.ok) throw new Error('Erro ao buscar transações da operação');
    return await response.json();
  }, []);

  // Buscar transações por número da transação
  const transacoesPorNr = useCallback(async (params = {}) => {
    const url = new URL('/api/sales/transacoes-por-nr', API_BASE_URL);
    Object.keys(params).forEach((key) => {
      const value = params[key];
      if (value !== null && value !== undefined && value !== '') {
        if (Array.isArray(value)) {
          value.forEach((v) => url.searchParams.append(key, v));
        } else {
          url.searchParams.append(key, value);
        }
      }
    });
    const response = await fetch(url.toString(), {
      headers: defaultHeaders,
    });
    if (!response.ok) throw new Error('Erro ao buscar itens da transação');
    return await response.json();
  }, []);

  // Métodos específicos para cada tipo de endpoint
  const financial = {
    extrato: (params) => apiCall('/api/financial/extrato', params),
    extratoTotvs: (params) => apiCall('/api/financial/extrato-totvs', params),

    /**
     * Processar extratos bancários de um banco específico
     * @param {string} banco - Nome do banco (bb, caixa, santander, itau, sicredi, bnb, unicred, bradesco)
     * @returns {Promise<Object>} Dados agrupados por conta com totais
     */
    extratosBanco: (banco) =>
      apiCall(`/api/financial/extratos/${banco.toLowerCase()}`),

    contasPagar: (params) => apiCall('/api/financial/contas-pagar', params),
    contasPagarEmissao: (params) =>
      apiCall('/api/financial/contas-pagar-emissao', params),
    contasReceber: (params) => apiCall('/api/financial/contas-receber', params),
    contasReceberEmissao: (params) =>
      apiCall('/api/financial/contas-receberemiss', params),
    fluxoCaixa: (params) => apiCall('/api/financial/fluxo-caixa', params),
    fluxocaixaSaida: (params) =>
      apiCall('/api/financial/fluxo-caixa-saida', params),
    nfManifestacao: (params) =>
      apiCall('/api/financial/nfmanifestacao', params),
    saldoConta: (params) => apiCall('/api/financial/saldo-conta', params),
    credevAdiantamento: (params) =>
      apiCall('/api/financial/credev-adiantamento', params),
    credevRevenda: (params) => apiCall('/api/financial/credev-revenda', params),
    credevVarejo: (params) => apiCall('/api/financial/credev-varejo', params),
    credevMtm: (params) => apiCall('/api/financial/credev-mtm', params),
    observacaoDuplicata: (params) =>
      apiCall('/api/financial/observacao', params),
    auditorCredev: (params) => apiCall('/api/financial/auditor-credev', params),
    fornecedor: (params) => apiCall('/api/financial/fornecedor', params),
    centrocusto: (params) => apiCall('/api/financial/centrocusto', params),
    despesa: (params) => apiCall('/api/financial/despesa', params),
    // 🆕 Nova rota para buscar TODAS as despesas (sem parâmetros obrigatórios)
    despesasTodas: (params = {}) =>
      apiCall('/api/financial/despesas-todas', params),
    inadimplentesMultimarcas: (params) =>
      apiCall('/api/financial/inadimplentes-multimarcas', params),
    // Nova rota para inadimplentes (franquias)
    inadimplentesFranquias: (params) =>
      apiCall('/api/financial/inadimplentes-franquias', params),
    // Nova rota para faturas a vencer (franquias)
    aVencerFranquias: () => apiCall('/api/financial/a-vencer-franquias'),
    // Nova rota para faturas a vencer de um cliente específico (franquias)
    faturasAVencerCliente: (cd_cliente) =>
      apiCall(`/api/financial/faturas-a-vencer-cliente/${cd_cliente}`),
    // Nova rota para faturas a vencer (multimarcas)
    aVencerMultimarcas: (params) =>
      apiCall('/api/financial/a-vencer-multimarcas', params),
    // Nova rota para faturas a vencer de um cliente específico (multimarcas)
    faturasAVencerClienteMultimarcas: (cd_cliente) =>
      apiCall(
        `/api/financial/faturas-a-vencer-cliente-multimarcas/${cd_cliente}`,
      ),
    inadimplentesRevenda: (params) =>
      apiCall('/api/financial/inadimplentes-revenda', params),
    // Telefone de clientes
    telefoneClientes: (cd_pessoa) =>
      apiCall(`/api/financial/telefone-clientes/${cd_pessoa}`),
    // Observações de faturas (obsfati)
    obsFati: (params) => apiCall('/api/financial/obsfati', params),
    // Extrato Cliente
    extratoCliente: (params) =>
      apiCall('/api/financial/extrato-cliente', params),
    // Fatura Extrato Cliente
    faturaExtCliente: (params) =>
      apiCall('/api/financial/fatura-ext-cliente', params),
    // Lançamento Extrato Adiantamento
    lancExtAdiant: (params) =>
      apiCall('/api/financial/lanc-ext-adiant', params),
    // Observações de Movimentação
    obsMov: (params) => apiCall('/api/financial/obs-mov', params),
    // Conta do Cliente (nr_ctapes)
    contaCliente: (params) => apiCall('/api/financial/conta-cliente', params),
    // Observações de Movimentação por Fatura
    obsMovFatura: (params) => apiCall('/api/financial/obs-mov-fatura', params),
    // Transação de Fatura CREDEV
    transacaoFaturaCredev: (params) =>
      apiCall('/api/financial/transacao-fatura-credev', params),

    // 🆕 CRUD Despesas Manuais DRE
    /**
     * Adicionar despesa manual ao DRE
     * @param {Object} despesa - Dados da despesa
     * @param {string} despesa.dt_inicio - Data início do período (YYYY-MM-DD)
     * @param {string} despesa.dt_fim - Data fim do período (YYYY-MM-DD)
     * @param {string} despesa.categoria_principal - 'OPERACIONAL' ou 'FINANCEIRA'
     * @param {number} despesa.cd_despesaitem - Código da despesa do TOTVS
     * @param {string} despesa.fornecedor - Nome do fornecedor (opcional)
     * @param {number} despesa.cd_fornecedor - Código do fornecedor (opcional)
     * @param {number} despesa.valor - Valor da despesa
     * @param {string} despesa.observacoes - Observações (opcional)
     * @returns {Promise<Object>} Resposta da API
     */
    adicionarDespesaManual: (despesa) =>
      apiMutate('/api/financial/despesas-manuais-dre', 'POST', despesa),

    /**
     * Listar despesas manuais do DRE
     * @param {Object} params - Filtros de busca
     * @param {string} params.dt_inicio - Data início (opcional)
     * @param {string} params.dt_fim - Data fim (opcional)
     * @param {string} params.categoria_principal - Categoria (opcional)
     * @param {boolean} params.ativo - Filtrar por ativo/inativo (opcional)
     * @returns {Promise<Object>} Lista de despesas
     */
    listarDespesasManuais: (params) =>
      apiCall('/api/financial/despesas-manuais-dre', params),

    /**
     * Editar despesa manual existente
     * @param {string} id - UUID da despesa
     * @param {Object} despesa - Dados atualizados da despesa
     * @returns {Promise<Object>} Resposta da API
     */
    editarDespesaManual: (id, despesa) =>
      apiMutate(`/api/financial/despesas-manuais-dre/${id}`, 'PUT', despesa),

    /**
     * Excluir (desativar) despesa manual
     * @param {string} id - UUID da despesa
     * @returns {Promise<Object>} Resposta da API
     */
    excluirDespesaManual: (id) =>
      apiMutate(`/api/financial/despesas-manuais-dre/${id}`, 'DELETE'),

    /**
     * Buscar dados de auditoria de conta
     * @returns {Promise<Object>} Movimentações de contas específicas
     */
    auditoriaConta: () => apiCall('/api/financial/auditoria-conta'),

    /**
     * Buscar auditoria de faturamento
     * @param {Object} params - Parâmetros de filtro
     * @param {string} params.cd_empresa - Código(s) da(s) empresa(s)
     * @param {string} params.dt_inicio - Data inicial
     * @param {string} params.dt_fim - Data final
     * @returns {Promise<Object>} Faturas com relacionamento de transações
     */
    auditoriaFaturamento: (params) =>
      apiCall('/api/financial/auditoria-faturamento', params),

    /**
     * Devoluções por transação (para MTM, REVENDA, FRANQUIAS)
     * Usa tp_situacao = 4 e cd_operacao específicos
     * @param {string} params.dt_inicio - Data inicial
     * @param {string} params.dt_fim - Data final
     * @returns {Promise<Object>} Devoluções calculadas por transação
     */
    devolucoesTransacao: (params) =>
      apiCall('/api/financial/devolucoes-transacao', params),

    /**
     * Impostos por transações (separados por canal) - Rota POST simples
     * @param {Object} body - { varejo: [nr_transacao], multimarcas: [...], franquias: [...], revenda: [...] }
     * @returns {Promise<Object>} { varejo: {icms, pis, cofins, total}, multimarcas: {...}, ... }
     */
    impostosPorTransacoes: (body) =>
      apiMutate('/api/financial/impostos-por-transacoes', 'POST', body),

    /**
     * CMV por transações (separados por canal) - Rota POST simples
     * @param {Object} body - { varejo: [nr_transacao], multimarcas: [...], franquias: [...], revenda: [...] }
     * @returns {Promise<Object>} { varejo: {cmv, produtosSaida, produtosEntrada}, multimarcas: {...}, ... }
     */
    cmvPorTransacoes: (body) =>
      apiMutate('/api/financial/cmv-por-transacoes', 'POST', body),

    /**
     * Classificação de clientes (MULTIMARCAS/REVENDA/OUTROS)
     */
    classificacaoClientes: (params) =>
      apiCall('/api/financial/classificacao-clientes', params),

    /**
     * Classificação de faturas (considera operação - VAREJO tem prioridade sobre REVENDA)
     * @param {Object} body - Objeto com array de faturas
     * @param {Array} body.faturas - Array com {cd_cliente, cd_operacao, cd_empresa}
     */
    classificacaoFaturas: (body) =>
      apiMutate('/api/financial/classificacao-faturas', 'POST', body),

    /**
     * Franquias de clientes (nm_fantasia like '%F%CROSBY%')
     * Usa POST para suportar muitos clientes (evita erro 431 de URL muito longa)
     */
    franquiasClientes: (body) =>
      apiMutate('/api/financial/franquias-clientes', 'POST', body),
  };

  const sales = {
    // Rotas de faturamento usando views materializadas (otimizadas)
    faturamentoVarejo: (params) =>
      apiCall('/api/faturamento/fat-varejo', params),
    faturamentoMtm: (params) =>
      apiCall('/api/faturamento/fat-multimarcas', params),
    // Novo: faturamento Bazar
    faturamentoBazar: (params) => apiCall('/api/faturamento/fatbazar', params),
    // Novo: faturamento Fatsellect
    faturamentoFatsellect: (params) =>
      apiCall('/api/faturamento/fatsellect', params),
    faturamentoFranquias: (params) =>
      apiCall('/api/faturamento/fat-franquias', params),
    faturamentoRevenda: (params) =>
      apiCall('/api/faturamento/fat-revenda', params),
    faturamentoConsolidado: (params) =>
      apiCall('/api/faturamento/consolidado', params),
    // Rotas antigas mantidas para compatibilidade (caso precisem ser usadas novamente)
    faturamentoVarejoOld: (params) =>
      apiCall('/api/faturamento/varejo', params),
    faturamentoMtmOld: (params) => apiCall('/api/faturamento/mtm', params),
    faturamentoFranquiasOld: (params) =>
      apiCall('/api/faturamento/franquias', params),
    faturamentoRevendaOld: (params) =>
      apiCall('/api/faturamento/revenda', params),

    // Rotas de CMV usando views materializadas (otimizadas)
    cmvVarejo: (params) => apiCall('/api/faturamento/cmv-varejo', params),
    cmvMultimarcas: (params) =>
      apiCall('/api/faturamento/cmv-multimarcas', params),
    cmvFranquias: (params) => apiCall('/api/faturamento/cmv-franquias', params),
    cmvRevenda: (params) => apiCall('/api/faturamento/cmv-revenda', params),

    // Rotas antigas mantidas para compatibilidade (deprecadas)
    faturamento: (params) => apiCall('/api/sales/faturamento', params),
    faturamentoFranquia: (params) =>
      apiCall('/api/sales/faturamento-franquia', params),
    receitaliquidaFaturamento: (params) =>
      apiCall('/api/sales/receitaliquida-faturamento', params),
    receitaliquidaFranquias: (params) =>
      apiCall('/api/sales/receitaliquida-franquias', params),
    receitaliquidaMtm: (params) =>
      apiCall('/api/sales/receitaliquida-mtm', params),
    receitaliquidaRevenda: (params) =>
      apiCall('/api/sales/receitaliquida-revenda', params),
    rankingVendedores: (params) =>
      apiCall('/api/sales/ranking-vendedores', params),
    vlimposto: (params) => apiCall('/api/sales/vlimposto', params),
    cmvtest: (params) => apiCall('/api/sales/cmvtest', params),
    cmv: (params) => apiCall('/api/sales/cmv', params),
    // Rotas antigas de CMV removidas (cmvvarejo, cmvfranquia, cmvmultimarcas, cmvrevenda)
    // Use as novas rotas com views materializadas: cmvVarejo, cmvFranquias, cmvMultimarcas, cmvRevenda
    // Nova rota consolidada DRE - substitui as 4 consultas CMV paralelas
    dreData: (params) => apiCall('/api/sales/dre-data', params),
    // Versão RAW: retorna a resposta bruta da API, sem processamento
    dreDataRaw: async (params) => {
      // Construir URL com parâmetros
      const url = new URL('/api/sales/dre-data', API_BASE_URL);
      Object.keys(params).forEach((key) => {
        const value = params[key];
        if (value !== null && value !== undefined && value !== '') {
          if (Array.isArray(value)) {
            value.forEach((v) => url.searchParams.append(key, v));
          } else {
            url.searchParams.append(key, value);
          }
        }
      });
      const response = await fetch(url.toString(), {
        headers: defaultHeaders,
      });
      if (!response.ok) {
        let errorBody = null;
        try {
          errorBody = await response.json();
        } catch {}
        throw new Error(
          (errorBody && (errorBody.message || errorBody.error)) ||
            response.statusText ||
            'Erro ao processar requisição',
        );
      }
      return await response.json();
    },
    // Rotas de cache DRE
    dreCacheClear: () => apiCall('/api/sales/dre-cache', {}, 'DELETE'),
    dreCacheStats: () => apiCall('/api/sales/dre-cache/stats'),
    // Nova rota de auditoria de transações (similar ao DADOSTOTVS.TXT)
    auditoriaTransacoes: async (params) => {
      // Fazer a chamada diretamente sem o processamento padrão do apiCall
      const url = new URL(`${API_BASE_URL}/api/sales/auditoria-transacoes`);
      Object.keys(params).forEach((key) => {
        const value = params[key];
        if (value !== null && value !== undefined && value !== '') {
          if (Array.isArray(value)) {
            value.forEach((v) => url.searchParams.append(key, v));
          } else {
            url.searchParams.append(key, value);
          }
        }
      });

      console.log('🌐 API Call auditoriaTransacoes:', url.toString());

      const response = await fetch(url.toString(), {
        headers: defaultHeaders,
      });
      if (!response.ok) {
        let errorBody = null;
        try {
          errorBody = await response.json();
        } catch {}
        throw new Error(
          (errorBody && (errorBody.message || errorBody.error)) ||
            response.statusText ||
            'Erro ao processar requisição',
        );
      }

      const result = await response.json();
      console.log('📦 Auditoria Response:', result);

      // Retornar a resposta original sem transformação
      return result;
    },
    // Rotas de impostos
    impostosPorCanal: (params) =>
      apiCall('/api/faturamento/impostos-por-canal', params),
    impostosDetalhados: (params) =>
      apiCall('/api/faturamento/impostos-detalhados', params),
    vlimposto: (params) => apiCall('/api/sales/vlimposto', params),
  };

  const company = {
    empresas: (params) => apiCall('/api/company/empresas', params),
    grupoEmpresas: (params) => apiCall('/api/company/grupo-empresas', params),
    faturamentoLojas: (params) =>
      apiCall('/api/company/faturamento-lojas', params),
    expedicao: (params) => apiCall('/api/company/expedicao', params),
    pcp: (params) => apiCall('/api/company/pcp', params),
  };

  const totvs = {
    /**
     * Busca movimentos fiscais raw na API TOTVS
     * @param {Object} body - { filter: { branchCodeList, startMovementDate, endMovementDate }, page, pageSize }
     */
    fiscalMovementSearch: (body) =>
      apiMutate('/api/totvs/fiscal-movement/search', 'POST', body),

    /**
     * Proxy para fiscal/v2/invoices/search da API TOTVS Moda.
     * Retorna dados brutos. Popula branchCodeList automaticamente se não informado.
     * @param {Object} body - { startDate: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD', branchCodeList?: number[] }
     */
    invoicesSearch: (body) =>
      apiMutate('/api/totvs/invoices/search', 'POST', body),

    /**
     * Busca contas a pagar via API TOTVS (accounts-payable/v2/duplicates/search)
     * @param {Object} body - {
     *   dt_inicio: string, dt_fim: string, branches: number[],
     *   modo?: 'vencimento'|'emissao'|'liquidacao',
     *   status?: 'Todos'|'Pago'|'Vencido'|'A Vencer'|'Em Aberto',
     *   situacao?: 'NORMAIS'|'CANCELADAS'|'TODAS',
     *   previsao?: 'TODOS'|'PREVISAO'|'REAL'|'CONSIGNADO',
     *   supplierCodeList?: number[], duplicateCodeList?: number[]
     * }
     */
    accountsPayableSearch: (body) =>
      apiMutate('/api/totvs/accounts-payable/search', 'POST', body),

    franchiseClients: (params) =>
      apiCall('/api/totvs/franchise-clients', params),

    /**
     * Busca ranking de produtos mais vendidos
     * @param {Object} body - { branchs: number[], datemin: string, datemax: string }
     */
    bestSellingProducts: (body) =>
      apiMutate('/api/totvs/best-selling-products', 'POST', body),

    /**
     * Consulta saldos de produtos
     * @param {Object} body - { filter, option: { balances: [{ branchCode, stockCodeList }] }, page, pageSize }
     */
    productBalances: (body) =>
      apiMutate('/api/totvs/product-balances', 'POST', body),

    /**
     * Busca produtos com expand (barCodes, classifications, etc.)
     * @param {Object} body - { filter, option: { branchInfoCode }, page, pageSize, expand }
     */
    productSearch: (body) =>
      apiMutate('/api/totvs/product-search', 'POST', body),

    /**
     * Faturamento total do painel de vendas (sale-panel/v2/totals/search)
     * @param {Object} body - { filtroempresa?: number[], datemin: string, datemax: string, operations?: number[], sellers?: number[] }
     */
    salePanelTotals: (body) =>
      apiMutate('/api/totvs/sale-panel/totals', 'POST', body),

    salePanelRankingFaturamento: (body) =>
      apiMutate('/api/totvs/sale-panel/ranking-faturamento', 'POST', body),

    salePanelSellers: (body) =>
      apiMutate('/api/totvs/sale-panel/sellers', 'POST', body),

    sellerPanelTopCustomers: (body) =>
      apiMutate(
        '/api/totvs/seller-panel/top-customers',
        'POST',
        body,
        {},
        { timeout: 600000 },
      ),

    sellerPanelTopCustomersTransactions: (body) =>
      apiMutate(
        '/api/totvs/seller-panel/top-customers/transactions',
        'POST',
        body,
        {},
        { timeout: 300000 },
      ),
  };

  const franchise = {
    franquiasCredev: (params) =>
      apiCall('/api/franchise/franquias-credev', params),
    meusPedidos: (params) => apiCall('/api/franchise/meuspedidos', params),
  };

  const utils = {
    health: () => apiCall('/api/utils/health'),
    stats: () => apiCall('/api/utils/stats'),
    autocompleteFantasia: (q) =>
      apiCall('/api/utils/autocomplete/nm_fantasia', { q }),
    autocompleteGrupoEmpresa: (q) =>
      apiCall('/api/utils/autocomplete/nm_grupoempresa', { q }),
    cadastroPessoa: (params) => apiCall('/api/utils/cadastropessoa', params),
    // Rota para ação cartões (acao-cartoes)
    acaoCartoes: (params) => apiCall('/api/utils/acao-cartoes', params),
  };

  return {
    apiCall,
    apiMutate,
    transacoesPorOperacao,
    transacoesPorNr,
    financial,
    sales,
    company,
    totvs,
    franchise,
    utils,
  };
};

export default useApiClient;
