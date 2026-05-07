import React, { useState, useEffect } from 'react';
import {
  X,
  CheckCircle,
  Circle,
  Calendar,
  Clock,
  User,
  Envelope,
} from '@phosphor-icons/react';
import { useNotices } from '../hooks/useNotices';

/**
 * Modal com detalhes completos do aviso e status de leitura dos destinatários
 */
const NoticeDetailsModal = ({ notice, onClose }) => {
  const { getNoticeRecipients, getNoticeStats } = useNotices();
  const [recipients, setRecipients] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // 'all', 'read', 'pending'

  useEffect(() => {
    loadData();
  }, [notice.id]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [recipientsResult, statsResult] = await Promise.all([
        getNoticeRecipients(notice.id),
        getNoticeStats(notice.id),
      ]);

      if (recipientsResult.success) {
        setRecipients(recipientsResult.data);
      }

      if (statsResult.success) {
        setStats(statsResult.data);
      }
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const filteredRecipients = recipients.filter((recipient) => {
    if (filter === 'read') return recipient.has_confirmed;
    if (filter === 'pending') return !recipient.has_confirmed;
    return true;
  });

  const readCount = recipients.filter((r) => r.has_confirmed).length;
  const pendingCount = recipients.filter((r) => !r.has_confirmed).length;
  const percentage =
    recipients.length > 0
      ? Math.round((readCount / recipients.length) * 100)
      : 0;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-[#000638] from-blue-600 to-indigo-600 p-6 text-white">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h2 className="text-2xl font-bold mb-2">{notice.title}</h2>
              <div className="flex items-center gap-4 text-sm text-blue-100">
                <div className="flex items-center gap-1">
                  <Calendar size={16} />
                  <span>Criado em {formatDate(notice.created_at)}</span>
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-white hover:bg-opacity-20 transition-colors"
            >
              <X size={24} weight="bold" />
            </button>
          </div>
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Coluna esquerda - Conteúdo */}
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900 mb-3">
                  Conteúdo do Aviso
                </h3>
                <div
                  className="prose prose-sm max-w-none p-4 bg-gray-50 rounded-lg border border-gray-200"
                  dangerouslySetInnerHTML={{ __html: notice.content }}
                />
              </div>

              {/* Estatísticas */}
              {stats && (
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg p-4 border border-blue-200">
                  <h4 className="font-bold text-gray-900 mb-3">Estatísticas</h4>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-700">
                        Total de destinatários
                      </span>
                      <span className="font-bold text-gray-900">
                        {stats.total_recipients}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-700">
                        Leituras confirmadas
                      </span>
                      <span className="font-bold text-green-600">
                        {stats.total_reads}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-700">
                        Leituras pendentes
                      </span>
                      <span className="font-bold text-orange-600">
                        {stats.pending_reads}
                      </span>
                    </div>

                    {/* Barra de progresso */}
                    <div>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-gray-700 font-medium">
                          Taxa de leitura
                        </span>
                        <span className="font-bold text-gray-900">
                          {percentage}%
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                        <div
                          className="bg-[#000638] from-green-500 to-emerald-500 h-3 transition-all duration-300"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Coluna direita - Destinatários */}
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900 mb-3">
                  Destinatários
                </h3>

                {/* Filtros */}
                <div className="flex gap-2 mb-4">
                  <button
                    onClick={() => setFilter('all')}
                    className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                      filter === 'all'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    Todos ({recipients.length})
                  </button>
                  <button
                    onClick={() => setFilter('read')}
                    className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                      filter === 'read'
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    Lidos ({readCount})
                  </button>
                  <button
                    onClick={() => setFilter('pending')}
                    className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                      filter === 'pending'
                        ? 'bg-orange-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    Pendentes ({pendingCount})
                  </button>
                </div>

                {/* Lista de destinatários */}
                {loading ? (
                  <div className="flex items-center justify-center h-64">
                    <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : filteredRecipients.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <Circle size={48} weight="thin" className="mx-auto mb-2" />
                    <p className="text-sm">Nenhum destinatário encontrado</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {filteredRecipients.map((recipient, index) => (
                      <div
                        key={index}
                        className={`p-3 rounded-lg border-2 transition-colors ${
                          recipient.has_confirmed
                            ? 'bg-green-50 border-green-200'
                            : 'bg-orange-50 border-orange-200'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          {/* Ícone de status */}
                          <div className="mt-0.5">
                            {recipient.has_confirmed ? (
                              <CheckCircle
                                size={24}
                                weight="fill"
                                className="text-green-500"
                              />
                            ) : (
                              <Circle
                                size={24}
                                weight="bold"
                                className="text-orange-500"
                              />
                            )}
                          </div>

                          {/* Informações do usuário */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <User size={14} className="text-gray-600" />
                              <p className="font-semibold text-gray-900 text-sm">
                                {recipient.name}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 mb-1">
                              <Envelope size={14} className="text-gray-600" />
                              <p className="text-xs text-gray-600 truncate">
                                {recipient.email}
                              </p>
                            </div>

                            {/* Role */}
                            <div className="mt-2">
                              <span className="inline-block px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-semibold rounded">
                                {recipient.role}
                              </span>
                            </div>

                            {/* Data de confirmação */}
                            {recipient.has_confirmed &&
                              recipient.confirmed_at && (
                                <div className="flex items-center gap-1 mt-2 text-xs text-green-700">
                                  <Clock size={12} />
                                  <span>
                                    Lido em {formatDate(recipient.confirmed_at)}
                                  </span>
                                </div>
                              )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 p-4 bg-gray-50">
          <button
            onClick={onClose}
            className="w-full py-2 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300 transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};

export default NoticeDetailsModal;
