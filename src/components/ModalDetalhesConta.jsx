import React, { useState, useEffect } from 'react';
import { X, Receipt, Calendar, User, Building, FileText, CurrencyDollar, Info, Spinner } from '@phosphor-icons/react';
import { API_BASE_URL } from '../config/constants';

const ModalDetalhesConta = ({ conta, isOpen, onClose }) => {
  const [observacoes, setObservacoes] = useState([]);
  const [loadingObservacoes, setLoadingObservacoes] = useState(false);
  const [erroObservacoes, setErroObservacoes] = useState('');

  // Buscar observações quando o modal abrir
  useEffect(() => {
    if (isOpen && conta) {
      buscarObservacoes();
    }
  }, [isOpen, conta]);

  const buscarObservacoes = async () => {
    console.log('🔍 Buscando observações para:', conta);
    
    if (!conta?.cd_fornecedor || !conta?.nr_duplicata || !conta?.cd_empresa || !conta?.nr_parcela) {
      console.log('❌ Dados insuficientes:', { 
        cd_fornecedor: conta?.cd_fornecedor, 
        nr_duplicata: conta?.nr_duplicata,
        cd_empresa: conta?.cd_empresa,
        nr_parcela: conta?.nr_parcela
      });
      setObservacoes([]);
      return;
    }

    setLoadingObservacoes(true);
    setErroObservacoes('');

    try {
      const url = `${API_BASE_URL}/api/financial/observacao?cd_fornecedor=${encodeURIComponent(conta.cd_fornecedor)}&nr_duplicata=${encodeURIComponent(conta.nr_duplicata)}&cd_empresa=${encodeURIComponent(conta.cd_empresa)}&nr_parcela=${encodeURIComponent(conta.nr_parcela)}`;
      console.log('🌐 URL da API:', url);
      
      const response = await fetch(url);
      console.log('📡 Response status:', response.status);
      
      if (!response.ok) {
        throw new Error(`Erro HTTP: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('📊 Dados recebidos:', data);
      
      if (data.success && data.data && data.data.data) {
        console.log('✅ Observações encontradas:', data.data.data.length);
        setObservacoes(data.data.data);
      } else if (data.success && data.data && Array.isArray(data.data)) {
        console.log('✅ Observações encontradas (formato direto):', data.data.length);
        setObservacoes(data.data);
      } else {
        console.log('⚠️ Nenhuma observação encontrada');
        setObservacoes([]);
      }
    } catch (error) {
      console.error('❌ Erro ao buscar observações:', error);
      setErroObservacoes('Erro ao carregar observações');
      setObservacoes([]);
    } finally {
      setLoadingObservacoes(false);
    }
  };

  if (!isOpen || !conta) return null;

  const formatarData = (data) => {
    if (!data) return 'Não informado';
    if (data.includes('T')) {
      return new Date(data).toLocaleDateString('pt-BR');
    }
    return data;
  };

  const formatarMoeda = (valor) => {
    return parseFloat(valor || 0).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'A': return 'text-green-600 bg-green-100';
      case 'P': return 'text-blue-600 bg-blue-100';
      case 'V': return 'text-yellow-600 bg-yellow-100';
      case 'C': return 'text-red-600 bg-red-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case 'A': return 'Aberto';
      case 'P': return 'Pago';
      case 'V': return 'Vencido';
      case 'C': return 'Cancelado';
      default: return status || 'Não informado';
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="bg-[#000638] text-white p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Receipt size={24} />
            <h2 className="text-lg font-bold">Detalhes da Conta</h2>
          </div>
          <button
            onClick={onClose}
            className="text-white hover:text-gray-300 transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* Informações Principais */}
            <div className="space-y-4">
              <div className="bg-blue-50 p-4 rounded-lg">
                <h3 className="font-bold text-blue-800 mb-3 flex items-center gap-2">
                  <CurrencyDollar size={20} />
                  Informações Financeiras
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-600">Valor da Duplicata:</span>
                    <span className="font-bold text-green-600">{formatarMoeda(conta.vl_duplicata)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-600">Valor Pago:</span>
                    <span className="font-bold text-blue-600">{formatarMoeda(conta.vl_pago)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-600">Juros:</span>
                    <span className="font-bold text-red-600">{formatarMoeda(conta.vl_juros)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-600">Acréscimo:</span>
                    <span className="font-bold text-orange-600">{formatarMoeda(conta.vl_acrescimo)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-600">Desconto:</span>
                    <span className="font-bold text-green-600">{formatarMoeda(conta.vl_desconto)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-600">Rateio:</span>
                    <span className="font-bold text-purple-600">{formatarMoeda(conta.vl_rateio)}</span>
                  </div>
                </div>
              </div>

              {/* Datas */}
              <div className="bg-green-50 p-4 rounded-lg">
                <h3 className="font-bold text-green-800 mb-3 flex items-center gap-2">
                  <Calendar size={20} />
                  Datas Importantes
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-600">Data de Emissão:</span>
                    <span className="font-bold">{formatarData(conta.dt_emissao)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-600">Data de Entrada:</span>
                    <span className="font-bold">{formatarData(conta.dt_entrada)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-600">Data de Vencimento:</span>
                    <span className="font-bold text-red-600">{formatarData(conta.dt_vencimento)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-600">Data de Liquidação:</span>
                    <span className="font-bold">{formatarData(conta.dt_liq)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Informações da Empresa e Fornecedor */}
            <div className="space-y-4">
              {/* Fornecedor */}
              <div className="bg-purple-50 p-4 rounded-lg">
                <h3 className="font-bold text-purple-800 mb-3 flex items-center gap-2">
                  <User size={20} />
                  Informações do Fornecedor
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-600">Código:</span>
                    <span className="font-bold">{conta.cd_fornecedor || 'Não informado'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-600">Nome:</span>
                    <span className="font-bold text-right max-w-48 truncate" title={conta.nm_fornecedor}>
                      {conta.nm_fornecedor || 'Não informado'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-600">Duplicata:</span>
                    <span className="font-bold">{conta.nr_duplicata || 'Não informado'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-600">Parcela:</span>
                    <span className="font-bold">{conta.nr_parcela || 'Não informado'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-600">Aceite:</span>
                    <span className="font-bold">{conta.in_aceite || 'Não informado'}</span>
                  </div>
                </div>
              </div>

              {/* Empresa e Centro de Custo */}
              <div className="bg-orange-50 p-4 rounded-lg">
                <h3 className="font-bold text-orange-800 mb-3 flex items-center gap-2">
                  <Building size={20} />
                  Empresa e Centro de Custo
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-600">Empresa:</span>
                    <span className="font-bold">{conta.cd_empresa || 'Não informado'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-600">Portador:</span>
                    <span className="font-bold">{conta.nr_portador || 'Não informado'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-600">Despesa:</span>
                    <span className="font-bold text-right max-w-48 truncate" title={conta.ds_despesaitem}>
                      {conta.ds_despesaitem || 'Não informado'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-600">Centro de Custo:</span>
                    <span className="font-bold text-right max-w-48 truncate" title={conta.ds_ccusto}>
                      {conta.ds_ccusto || 'Não informado'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Status */}
              <div className="bg-gray-50 p-4 rounded-lg">
                <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
                  <Info size={20} />
                  Status da Conta
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-600">Situação:</span>
                    <span className={`px-2 py-1 rounded text-xs font-bold ${getStatusColor(conta.tp_situacao)}`}>
                      {getStatusText(conta.tp_situacao)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-600">Estágio:</span>
                    <span className="font-bold">{conta.tp_estagio || 'Não informado'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-600">Previsão:</span>
                    <span className="font-bold">{conta.tp_previsaoreal || 'Não informado'}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

                     {/* Observações */}
           <div className="mt-6 bg-yellow-50 p-4 rounded-lg">
                            <div className="flex items-center justify-between mb-3">
                 <h3 className="font-bold text-yellow-800 flex items-center gap-2">
                   <FileText size={20} />
                   Observações da Duplicata
                 </h3>
                 <button
                   onClick={buscarObservacoes}
                   disabled={loadingObservacoes}
                   className="text-xs bg-yellow-600 text-white px-2 py-1 rounded hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                   title="Recarregar observações"
                 >
                   {loadingObservacoes ? <Spinner size={12} className="animate-spin" /> : '↻'}
                 </button>
               </div>
               
                               {/* Informações da consulta */}
                <div className="mb-3 text-xs text-gray-600 bg-yellow-100 p-2 rounded">
                  <div className="font-medium mb-1">Consultando:</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><span className="font-medium">Fornecedor:</span> {conta.cd_fornecedor}</div>
                    <div><span className="font-medium">Duplicata:</span> {conta.nr_duplicata}</div>
                    <div><span className="font-medium">Empresa:</span> {conta.cd_empresa}</div>
                    <div><span className="font-medium">Parcela:</span> {conta.nr_parcela}</div>
                  </div>
                </div>
             
             {loadingObservacoes ? (
               <div className="flex items-center justify-center py-4">
                 <Spinner size={20} className="animate-spin text-yellow-600" />
                 <span className="ml-2 text-sm text-gray-600">Carregando observações...</span>
               </div>
             ) : erroObservacoes ? (
               <div className="bg-red-50 p-3 rounded border border-red-200">
                 <p className="text-sm text-red-700">{erroObservacoes}</p>
               </div>
             ) : observacoes.length > 0 ? (
               <div className="space-y-3">
                 <div className="text-xs text-gray-500 mb-2">
                   {observacoes.length} observação{observacoes.length !== 1 ? 'ões' : ''} encontrada{observacoes.length !== 1 ? 's' : ''}
                 </div>
                                   {observacoes.map((obs, index) => (
                    <div key={index} className="bg-white p-3 rounded border border-yellow-200">
                      <div className="flex items-start justify-between mb-1">
                        <span className="text-xs text-gray-500 font-medium">Observação #{index + 1}</span>
                        <span className="text-xs text-gray-400">
                          Cadastrada em: {formatarData(obs.dt_cadastro)}
                        </span>
                      </div>
                      <p className="text-sm text-gray-700 whitespace-pre-wrap">
                        {obs.ds_observacao}
                      </p>
                    </div>
                  ))}
               </div>
             ) : (
               <div className="bg-white p-3 rounded border border-yellow-200">
                 <p className="text-sm text-gray-500 italic">
                   Nenhuma observação encontrada para esta duplicata.
                 </p>
               </div>
             )}
           </div>

           {/* Observação da Conta (se existir) */}
           {conta.ds_observacao && (
             <div className="mt-4 bg-blue-50 p-4 rounded-lg">
               <h3 className="font-bold text-blue-800 mb-3 flex items-center gap-2">
                 <FileText size={20} />
                 Observação da Conta
               </h3>
               <div className="bg-white p-3 rounded border border-blue-200">
                 <p className="text-sm text-gray-700 whitespace-pre-wrap">
                   {conta.ds_observacao}
                 </p>
               </div>
             </div>
           )}
        </div>

        {/* Footer */}
        <div className="bg-gray-50 px-6 py-3 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-[#000638] text-white rounded-md hover:bg-[#000638]/90 transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};

export default ModalDetalhesConta;
