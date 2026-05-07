import React from 'react';
import ModalDetalhesConta from '../ModalDetalhesConta';
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import {
  formatarData,
  getStatusFromData,
  getStatusColor,
  getStatusIcon,
} from './utils';
import {
  CheckCircle,
  Warning,
  Clock,
  ArrowUp,
  ArrowDown,
} from '@phosphor-icons/react';

const StatusIcon = ({ status }) => {
  const color = getStatusIcon(status);
  const size = 14;
  switch (color) {
    case 'green':
      return <CheckCircle size={size} className="text-green-600" />;
    case 'red':
      return <Warning size={size} className="text-red-600" />;
    case 'yellow':
      return <Clock size={size} className="text-yellow-600" />;
    case 'blue':
      return <ArrowUp size={size} className="text-blue-600" />;
    default:
      return <ArrowDown size={size} className="text-gray-600" />;
  }
};

const ModaisContasPagar = React.memo(
  ({
    // Modal observações
    modalAberto,
    dadosModal,
    fecharModal,
    // Modal card
    modalCardAberto,
    tipoCardSelecionado,
    dadosCardModal,
    fecharModalCard,
    getTituloModal,
    // Modal busca fornecedor
    modalBuscaFornecedorAberto,
    setModalBuscaFornecedorAberto,
    fornecedoresEncontrados,
    selecionarFornecedorBusca,
    // Modal detalhes
    modalDetalhes,
    fecharModalDetalhes,
  }) => {
    const fmt = (v) =>
      parseFloat(v || 0).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      });

    return (
      <>
        {/* Modal Observações */}
        {modalAberto && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg max-w-2xl w-full max-h-[80vh] flex flex-col">
              <div className="bg-[#000638] text-white p-3 rounded-t-lg">
                <h2 className="text-sm font-bold">Observações</h2>
                <p className="text-xs opacity-90 mt-1">
                  Detalhes das observações para a conta selecionada
                </p>
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                {dadosModal?.observacoes?.length > 0 ? (
                  <div className="space-y-3">
                    {dadosModal.observacoes.map((obs, i) => (
                      <div
                        key={i}
                        className="bg-gray-50 p-4 rounded-lg border border-gray-200"
                      >
                        <p className="text-gray-800 text-sm leading-relaxed">
                          {obs}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <p className="text-lg font-medium">
                      Nenhuma observação encontrada
                    </p>
                  </div>
                )}
              </div>
              <div className="bg-gray-50 px-6 py-4 flex justify-end">
                <button
                  onClick={fecharModal}
                  className="bg-[#000638] text-white px-6 py-2 rounded-lg hover:bg-[#fe0000] transition-colors font-medium"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Card Details */}
        {modalCardAberto && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg max-w-6xl w-full max-h-[90vh] flex flex-col">
              <div className="bg-[#000638] text-white p-3 rounded-t-lg">
                <h2 className="text-sm font-bold">
                  {getTituloModal(tipoCardSelecionado)}
                </h2>
                <p className="text-xs opacity-90 mt-1">
                  {dadosCardModal.length} registro
                  {dadosCardModal.length !== 1 ? 's' : ''} encontrado
                  {dadosCardModal.length !== 1 ? 's' : ''}
                </p>
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                {dadosCardModal.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="px-2 py-2 text-left font-medium text-gray-700">
                            Vencimento
                          </th>
                          <th className="px-2 py-2 text-right font-medium text-gray-700">
                            Valor
                          </th>
                          <th className="px-2 py-2 text-center font-medium text-gray-700">
                            Fornecedor
                          </th>
                          <th className="px-2 py-2 text-left font-medium text-gray-700">
                            Despesa
                          </th>
                          <th className="px-2 py-2 text-center font-medium text-gray-700">
                            Duplicata
                          </th>
                          <th className="px-2 py-2 text-center font-medium text-gray-700">
                            Status
                          </th>
                          <th className="px-2 py-2 text-center font-medium text-gray-700">
                            Previsão
                          </th>
                          {tipoCardSelecionado === 'descontos' && (
                            <th className="px-2 py-2 text-right font-medium text-gray-700">
                              Desconto
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {dadosCardModal.map((item, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-2 py-2 text-sm text-gray-900">
                              {formatarData(item.dt_vencimento)}
                            </td>
                            <td className="px-2 py-2 text-sm text-right font-medium text-green-600">
                              {fmt(item.vl_duplicata)}
                            </td>
                            <td className="px-2 py-2 text-sm text-center text-gray-900">
                              {item.nm_fornecedor || ''}
                            </td>
                            <td className="px-2 py-2 text-sm text-gray-900">
                              {item.ds_despesaitem || ''}
                            </td>
                            <td className="px-2 py-2 text-sm text-center text-gray-900">
                              {item.nr_duplicata || ''}
                            </td>
                            <td className="px-2 py-2 text-center">
                              <span
                                className={`inline-flex items-center px-0.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(getStatusFromData(item))}`}
                              >
                                <StatusIcon status={getStatusFromData(item)} />
                                <span className="ml-1">
                                  {getStatusFromData(item)}
                                </span>
                              </span>
                            </td>
                            <td className="px-2 py-2 text-center text-gray-900">
                              {item.tp_previsaoreal || ''}
                            </td>
                            {tipoCardSelecionado === 'descontos' && (
                              <td className="px-2 py-2 text-sm text-right font-medium text-emerald-600">
                                {fmt(item.vl_desconto)}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <p className="text-lg font-medium">
                      Nenhum registro encontrado
                    </p>
                  </div>
                )}
              </div>
              <div className="bg-gray-50 px-6 py-4 flex justify-end">
                <button
                  onClick={fecharModalCard}
                  className="bg-[#000638] text-white px-6 py-2 rounded-lg hover:bg-[#fe0000] transition-colors font-medium"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Busca Fornecedores */}
        {modalBuscaFornecedorAberto && (
          <div
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4"
            style={{ zIndex: 99998 }}
            onClick={() => setModalBuscaFornecedorAberto(false)}
          >
            <div
              className="bg-white rounded-lg p-6 max-w-4xl w-full max-h-[80vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-[#000638] flex items-center gap-2">
                  <MagnifyingGlass size={20} weight="bold" />
                  Fornecedores Encontrados
                </h2>
                <button
                  onClick={() => setModalBuscaFornecedorAberto(false)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <X size={20} weight="bold" />
                </button>
              </div>
              <p className="text-sm text-gray-600 mb-3">
                {fornecedoresEncontrados.length} fornecedor(es) encontrado(s)
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#000638] text-white">
                      <th className="px-3 py-2 text-left rounded-tl-lg">
                        Código
                      </th>
                      <th className="px-3 py-2 text-left">Nome</th>
                      <th className="px-3 py-2 text-left">Nome Fantasia</th>
                      <th className="px-3 py-2 text-left">CPF / CNPJ</th>
                      <th className="px-3 py-2 text-center rounded-tr-lg">
                        Ação
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {fornecedoresEncontrados.map((f, i) => (
                      <tr
                        key={f.cd_pessoa || i}
                        className={`border-b hover:bg-blue-50 cursor-pointer ${i % 2 === 0 ? 'bg-gray-50' : 'bg-white'}`}
                        onClick={() => selecionarFornecedorBusca(f)}
                      >
                        <td className="px-3 py-2 font-mono text-xs">
                          {f.cd_pessoa}
                        </td>
                        <td className="px-3 py-2">{f.nm_pessoa}</td>
                        <td className="px-3 py-2 text-gray-600">
                          {f.nm_fantasia || '--'}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-gray-600">
                          {f.cpf || '--'}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              selecionarFornecedorBusca(f);
                            }}
                            className="bg-[#000638] text-white px-3 py-1 rounded text-xs hover:bg-[#000638]/80 transition-colors"
                          >
                            Selecionar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end mt-4">
                <button
                  onClick={() => setModalBuscaFornecedorAberto(false)}
                  className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300 transition-colors text-sm"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Detalhes da Conta */}
        <ModalDetalhesConta
          conta={modalDetalhes.conta}
          isOpen={modalDetalhes.isOpen}
          onClose={fecharModalDetalhes}
        />
      </>
    );
  },
);

ModaisContasPagar.displayName = 'ModaisContasPagar';

export default ModaisContasPagar;
