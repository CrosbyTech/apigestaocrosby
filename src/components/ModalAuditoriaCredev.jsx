import React, { useState, useEffect } from 'react';
import Modal from './ui/Modal';
import LoadingSpinner from './LoadingSpinner';
import useApiClient from '../hooks/useApiClient';
import { Calendar, CurrencyDollar, FileText, ArrowUp, ArrowDown, X } from '@phosphor-icons/react';

const ModalAuditoriaCredev = ({ isOpen, onClose, nrCtaPes, dataUltimoMovimento }) => {
  const apiClient = useApiClient();
  const [dadosAuditoria, setDadosAuditoria] = useState([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');
  const [filtros, setFiltros] = useState({});

  // Calcular datas para 90 dias anteriores à data atual
  const calcularDatas = () => {
    // Sempre usar a data atual como data fim
    const hoje = new Date();
    const dataFim = hoje.toISOString().split('T')[0];
    const dataInicio = new Date(hoje.getTime() - (90 * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];
    
    return { dataInicio, dataFim };
  };

  // Buscar dados de auditoria
  const buscarDadosAuditoria = async () => {
    if (!nrCtaPes) return;

    setLoading(true);
    setErro('');
    
    try {
      const { dataInicio, dataFim } = calcularDatas();
      
      console.log('🔍 Buscando dados de auditoria para conta:', nrCtaPes);
      console.log('📅 Período calculado:', dataInicio, 'a', dataFim);
      
      // Usar o useApiClient para fazer a chamada
      console.log('🌐 Chamando API auditor-credev...');
      
      // Tentar primeiro com useApiClient, se falhar, usar fetch direto
      let result;
      try {
        result = await apiClient.financial.auditorCredev({
          nr_ctapes: nrCtaPes,
          dt_movim_ini: dataInicio,
          dt_movim_fim: dataFim
        });
      } catch (apiError) {
        console.log('⚠️ Erro no useApiClient, tentando fetch direto...');
        
        // Fallback para fetch direto
        const response = await fetch(`/api/financial/auditor-credev?nr_ctapes=${nrCtaPes}&dt_movim_ini=${dataInicio}&dt_movim_fim=${dataFim}`);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const responseData = await response.json();
        result = {
          success: true,
          data: responseData.data,
          message: responseData.message
        };
      }

      console.log('📦 Resultado da API:', result);

      if (result.success) {
        // A API retorna os dados aninhados em result.data.data
        const dadosMovimentacoes = result.data?.data || result.data || [];
        const filtrosAplicados = result.data?.filtros || result.filtros || {};
        
        console.log('✅ Dados recebidos:', {
          movimentacoes: dadosMovimentacoes.length,
          filtros: filtrosAplicados
        });
        
        setDadosAuditoria(dadosMovimentacoes);
        setFiltros(filtrosAplicados);
      } else {
        throw new Error(result.message || 'Erro ao buscar dados de auditoria');
      }
    } catch (err) {
      console.error('❌ Erro ao buscar dados de auditoria:', err);
      
      // Tratamento específico para diferentes tipos de erro
      let mensagemErro = 'Erro ao carregar dados de auditoria do servidor.';
      
      if (err.message.includes('Unexpected token')) {
        mensagemErro = 'Erro no formato de resposta do servidor. Tente novamente.';
      } else if (err.message.includes('Failed to fetch')) {
        mensagemErro = 'Erro de conexão com o servidor. Verifique sua internet.';
      } else if (err.message.includes('HTTP')) {
        mensagemErro = `Erro do servidor: ${err.message}`;
      }
      
      setErro(mensagemErro);
      setDadosAuditoria([]);
    } finally {
      setLoading(false);
    }
  };

  // Buscar dados quando o modal abrir
  useEffect(() => {
    if (isOpen && nrCtaPes) {
      buscarDadosAuditoria();
    }
  }, [isOpen, nrCtaPes]);

  const formatarDataBR = (data) => {
    if (!data) return '-';
    const d = new Date(data);
    if (isNaN(d)) return '-';
    return d.toLocaleDateString('pt-BR');
  };

  const formatarMoeda = (valor) => {
    if (valor === null || valor === undefined) return '-';
    return Number(valor).toLocaleString('pt-BR', { 
      style: 'currency', 
      currency: 'BRL' 
    });
  };

  const getIconeOperacao = (tipo) => {
    if (tipo === 'C') return <ArrowUp size={16} className="text-green-600" />;
    if (tipo === 'D') return <ArrowDown size={16} className="text-red-600" />;
    return <FileText size={16} className="text-gray-600" />;
  };

  const getCorOperacao = (tipo) => {
    if (tipo === 'C') return 'text-green-600';
    if (tipo === 'D') return 'text-red-600';
    return 'text-gray-600';
  };

  const getTipoOperacao = (tipo) => {
    if (tipo === 'C') return 'Crédito';
    if (tipo === 'D') return 'Débito';
    return tipo || '-';
  };

  // Função para gerar o título do modal com período
  const getTituloModal = () => {
    if (filtros.dt_movim_ini && filtros.dt_movim_fim) {
      return `Auditoria CREDEV - Conta ${nrCtaPes} (Últimos 90 dias: ${formatarDataBR(filtros.dt_movim_ini)} a ${formatarDataBR(filtros.dt_movim_fim)})`;
    }
    return `Auditoria CREDEV - Conta ${nrCtaPes}`;
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
              title={getTituloModal()}
      size="6xl"
      className="max-h-[90vh] overflow-hidden"
    >
      <div className="p-6">
        {/* Filtros aplicados */}
        {filtros && Object.keys(filtros).length > 0 && (
          <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <h3 className="text-sm font-semibold text-blue-800 mb-2 flex items-center gap-2">
              <Calendar size={16} />
              Filtros Aplicados
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="font-medium text-blue-700">Conta:</span>
                <span className="ml-2 text-blue-600">{filtros.nr_ctapes}</span>
              </div>
              <div>
                <span className="font-medium text-blue-700">Data Início:</span>
                <span className="ml-2 text-blue-600">{formatarDataBR(filtros.dt_movim_ini)}</span>
              </div>
              <div>
                <span className="font-medium text-blue-700">Data Fim:</span>
                <span className="ml-2 text-blue-600">{formatarDataBR(filtros.dt_movim_fim)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-12">
            <LoadingSpinner size="lg" />
            <span className="mt-4 text-gray-600">Carregando dados de auditoria...</span>
          </div>
        )}

        {/* Erro */}
        {erro && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-2 text-red-800">
              <X size={20} />
              <span className="font-medium">Erro:</span>
              <span>{erro}</span>
            </div>
          </div>
        )}

        {/* Dados de auditoria */}
        {!loading && !erro && (
          <>
            {/* Resumo */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                             <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
                 <div className="flex items-center gap-2 text-gray-600 mb-2">
                   <FileText size={16} />
                   <span className="text-sm font-medium">Total de Movimentações</span>
                 </div>
                 <div className="text-2xl font-bold text-gray-900">{dadosAuditoria.length}</div>
               </div>
              
              <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
                <div className="flex items-center gap-2 text-green-600 mb-2">
                  <ArrowUp size={16} />
                  <span className="text-sm font-medium">Total Créditos</span>
                </div>
                <div className="text-2xl font-bold text-green-700">
                  {dadosAuditoria.filter(item => item.tp_operacao === 'C').length}
                </div>
              </div>
              
              <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
                <div className="flex items-center gap-2 text-red-600 mb-2">
                  <ArrowDown size={16} />
                  <span className="text-sm font-medium">Total Débitos</span>
                </div>
                <div className="text-2xl font-bold text-red-700">
                  {dadosAuditoria.filter(item => item.tp_operacao === 'D').length}
                </div>
              </div>
              
              <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
                <div className="flex items-center gap-2 text-blue-600 mb-2">
                  <CurrencyDollar size={16} />
                  <span className="text-sm font-medium">Saldo Período</span>
                </div>
                <div className="text-2xl font-bold text-blue-700">
                  {formatarMoeda(
                    dadosAuditoria.reduce((acc, item) => {
                      const valor = Number(item.vl_lancto) || 0;
                      return acc + (item.tp_operacao === 'C' ? valor : -valor);
                    }, 0)
                  )}
                </div>
              </div>
            </div>

            {/* Tabela de movimentações */}
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                             <div className="px-6 py-4 border-b border-gray-200">
                 <h3 className="text-lg font-semibold text-gray-900">Movimentações Financeiras</h3>
                 <p className="text-sm text-gray-600">Período: Últimos 90 dias ({formatarDataBR(filtros.dt_movim_ini)} a {formatarDataBR(filtros.dt_movim_fim)})</p>
               </div>
              
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Data Movimento
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Tipo
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Documento
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Descrição
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Valor
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Data Liquidação
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Operador
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Estorno
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {dadosAuditoria.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                          Nenhuma movimentação encontrada para o período selecionado
                        </td>
                      </tr>
                    ) : (
                      dadosAuditoria.map((item, index) => (
                        <tr key={index} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                            {formatarDataBR(item.dt_movim)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              {getIconeOperacao(item.tp_operacao)}
                              <span className={`font-medium ${getCorOperacao(item.tp_operacao)}`}>
                                {getTipoOperacao(item.tp_operacao)}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                            {item.ds_doc || '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900 max-w-xs truncate">
                            {item.ds_aux || '-'}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm font-medium">
                            <span className={getCorOperacao(item.tp_operacao)}>
                              {formatarMoeda(item.vl_lancto)}
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                            {formatarDataBR(item.dt_liq)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                            {item.nm_usuario || item.cd_operador || '-'}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {item.in_estorno === 'S' ? (
                              <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800">
                                Sim
                              </span>
                            ) : (
                              <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800">
                                Não
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};

export default ModalAuditoriaCredev;
