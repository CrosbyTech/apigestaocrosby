import React from 'react';
import Modal from './ui/Modal';
import LoadingSpinner from './LoadingSpinner';

const ModalTransacoesOperacao = ({
  open,
  onClose,
  loading,
  transacoes,
  operacao,
  onDetalhar,
}) => {
  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={`Transações da Operação ${operacao}`}
      size="4xl"
    >
      <div className="p-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-8">
            <LoadingSpinner size="lg" />
            <span className="mt-2 text-gray-600">Carregando transações...</span>
          </div>
        ) : (
          <>
            {!transacoes ||
            (Array.isArray(transacoes) && transacoes.length === 0) ? (
              <div className="text-center text-gray-500 py-8">
                Nenhuma transação encontrada para esta operação.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Cd Empresa
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Data da Transação
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Nr. Transação
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Soma Valor Unit Líquido
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Soma Valor Unit Bruto
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Ações
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {
                      // Normalizar para array: API pode retornar { transacoes: [...] } ou array direto
                      (() => {
                        const transacoesArray = Array.isArray(transacoes)
                          ? transacoes
                          : transacoes && transacoes.transacoes
                          ? transacoes.transacoes
                          : [];

                        return transacoesArray.map((t, idx) => (
                          <tr key={idx}>
                            <td className="px-4 py-2 text-sm text-gray-900">
                              {t.cd_empresa}
                            </td>
                            <td className="px-4 py-2 text-sm text-gray-700">
                              {t.dt_transacao
                                ? new Date(t.dt_transacao).toLocaleDateString(
                                    'pt-BR',
                                  )
                                : '-'}
                            </td>
                            <td className="px-4 py-2 text-sm text-gray-900">
                              <div className="flex items-center gap-2">
                                <span>{t.nr_transacao}</span>
                                {t.nr_itens && Number(t.nr_itens) > 1 && (
                                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                                    {Number(t.nr_itens)} itens
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-2 text-sm text-green-700 font-semibold">
                              {Number(
                                t.vl_unitliquido_total || 0,
                              ).toLocaleString('pt-BR', {
                                style: 'currency',
                                currency: 'BRL',
                              })}
                            </td>
                            <td className="px-4 py-2 text-sm text-gray-700">
                              {Number(t.vl_unitbruto_total || 0).toLocaleString(
                                'pt-BR',
                                {
                                  style: 'currency',
                                  currency: 'BRL',
                                },
                              )}
                            </td>
                            <td className="px-4 py-2 text-sm text-gray-700">
                              <button
                                className="text-xs bg-blue-600 text-white px-2 py-1 rounded-lg hover:bg-blue-700"
                                onClick={() =>
                                  onDetalhar && onDetalhar(t.nr_transacao)
                                }
                              >
                                DETALHAR TRANSAÇÃO
                              </button>
                            </td>
                          </tr>
                        ));
                      })()
                    }
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};

export default ModalTransacoesOperacao;
