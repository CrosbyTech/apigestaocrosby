import React from 'react';
import Modal from './ui/Modal';
import LoadingSpinner from './LoadingSpinner';

const ModalDetalharTransacao = ({ open, onClose, loading, itens, erro }) => {
  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={`Detalhes da Transação`}
      size="4xl"
    >
      <div className="p-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-8">
            <LoadingSpinner size="lg" />
            <span className="mt-2 text-gray-600">Carregando itens...</span>
          </div>
        ) : erro ? (
          <div className="text-center text-red-600">{erro}</div>
        ) : !itens || itens.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            Nenhum item encontrado para esta transação.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    cd_pessoa
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    nm_pessoa
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    cd_nivel
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    ds_nivel
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    Valor Unit Líquido
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    Valor Unit Bruto
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    Quantidade
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {itens.map((t, idx) => (
                  <tr key={idx}>
                    <td className="px-4 py-2 text-sm text-gray-900">
                      {t.cd_pessoa}
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-700">
                      {t.nm_pessoa}
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-700">
                      {t.cd_nivel}
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-700">
                      {t.ds_nivel}
                    </td>
                    <td className="px-4 py-2 text-sm text-green-700 font-semibold">
                      {Number(t.vl_unitliquido || 0).toLocaleString('pt-BR', {
                        style: 'currency',
                        currency: 'BRL',
                      })}
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-700">
                      {Number(t.vl_unitbruto || 0).toLocaleString('pt-BR', {
                        style: 'currency',
                        currency: 'BRL',
                      })}
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-700">
                      {t.qt_faturado}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default ModalDetalharTransacao;
