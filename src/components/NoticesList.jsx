import React, { useState, useEffect } from 'react';
import {
  MagnifyingGlass,
  Eye,
  Trash,
  PencilSimple,
  CheckCircle,
  Circle,
  Calendar,
  Users,
} from '@phosphor-icons/react';
import { useNotices } from '../hooks/useNotices';
import { Card, CardContent, CardHeader, CardTitle } from './ui/cards';
import NoticeDetailsModal from './NoticeDetailsModal';

/**
 * Lista de avisos criados com opções de visualização, edição e exclusão
 */
const NoticesList = ({ onEdit }) => {
  const { getAllNotices, deleteNotice, getNoticeStats } = useNotices();
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedNotice, setSelectedNotice] = useState(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [noticeStats, setNoticeStats] = useState({});
  const [loadingStats, setLoadingStats] = useState({});

  useEffect(() => {
    loadNotices();
  }, []);

  const loadNotices = async () => {
    setLoading(true);
    try {
      const result = await getAllNotices();
      if (result.success) {
        setNotices(result.data);
        // Carregar estatísticas de cada aviso
        result.data.forEach((notice) => {
          loadNoticeStats(notice.id);
        });
      }
    } catch (error) {
      console.error('Erro ao carregar avisos:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadNoticeStats = async (noticeId) => {
    setLoadingStats((prev) => ({ ...prev, [noticeId]: true }));
    try {
      const result = await getNoticeStats(noticeId);
      if (result.success) {
        setNoticeStats((prev) => ({ ...prev, [noticeId]: result.data }));
      }
    } catch (error) {
      console.error('Erro ao carregar estatísticas:', error);
    } finally {
      setLoadingStats((prev) => ({ ...prev, [noticeId]: false }));
    }
  };

  const handleDelete = async (noticeId) => {
    if (!confirm('Tem certeza que deseja excluir este aviso?')) return;

    try {
      const result = await deleteNotice(noticeId);
      if (result.success) {
        alert('Aviso excluído com sucesso!');
        loadNotices();
      } else {
        alert('Erro ao excluir aviso: ' + result.error);
      }
    } catch (error) {
      console.error('Erro ao excluir aviso:', error);
      alert('Erro ao excluir aviso. Tente novamente.');
    }
  };

  const handleViewDetails = (notice) => {
    setSelectedNotice(notice);
    setShowDetailsModal(true);
  };

  const filteredNotices = notices.filter(
    (notice) =>
      notice.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      notice.content.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getReadPercentage = (stats) => {
    if (!stats || stats.total_recipients === 0) return 0;
    return Math.round((stats.total_reads / stats.total_recipients) * 100);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl">Avisos Enviados</CardTitle>
            <button
              onClick={loadNotices}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-semibold"
            >
              Atualizar
            </button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Barra de pesquisa */}
          <div className="mb-6">
            <div className="relative">
              <MagnifyingGlass
                size={20}
                className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"
              />
              <input
                type="text"
                placeholder="Buscar por título ou conteúdo..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Lista de avisos */}
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filteredNotices.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Circle size={64} weight="thin" className="mx-auto mb-4" />
              <p className="text-lg font-semibold">
                {searchTerm
                  ? 'Nenhum aviso encontrado'
                  : 'Nenhum aviso criado ainda'}
              </p>
              <p className="text-sm mt-2">
                {searchTerm
                  ? 'Tente ajustar sua busca'
                  : 'Crie seu primeiro aviso na aba "Criar Aviso"'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredNotices.map((notice) => {
                const stats = noticeStats[notice.id];
                const percentage = getReadPercentage(stats);

                return (
                  <div
                    key={notice.id}
                    className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between gap-4">
                      {/* Informações do aviso */}
                      <div className="flex-1 min-w-0">
                        <h3 className="text-lg font-bold text-gray-900 mb-2">
                          {notice.title}
                        </h3>

                        {/* Preview do conteúdo */}
                        <div
                          className="text-sm text-gray-600 mb-3 line-clamp-2"
                          dangerouslySetInnerHTML={{
                            __html: notice.content.substring(0, 150) + '...',
                          }}
                        />

                        {/* Metadados */}
                        <div className="flex items-center gap-4 text-xs text-gray-500">
                          <div className="flex items-center gap-1">
                            <Calendar size={14} />
                            <span>{formatDate(notice.created_at)}</span>
                          </div>

                          {stats && (
                            <div className="flex items-center gap-1">
                              <Users size={14} />
                              <span>
                                {stats.total_recipients}{' '}
                                {stats.total_recipients === 1
                                  ? 'destinatário'
                                  : 'destinatários'}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Estatísticas de leitura */}
                        {stats && (
                          <div className="mt-3">
                            <div className="flex items-center justify-between text-sm mb-1">
                              <span className="text-gray-700 font-medium">
                                Taxa de leitura
                              </span>
                              <span className="font-bold text-gray-900">
                                {percentage}%
                              </span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                              <div
                                className="bg-[#000638] from-green-500 to-emerald-500 h-2 transition-all duration-300"
                                style={{ width: `${percentage}%` }}
                              />
                            </div>
                            <div className="flex items-center justify-between text-xs text-gray-500 mt-1">
                              <span>
                                {stats.total_reads} lido
                                {stats.total_reads !== 1 ? 's' : ''}
                              </span>
                              <span>
                                {stats.pending_reads} pendente
                                {stats.pending_reads !== 1 ? 's' : ''}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Ações */}
                      <div className="flex flex-col gap-2">
                        <button
                          onClick={() => handleViewDetails(notice)}
                          className="p-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
                          title="Ver detalhes"
                        >
                          <Eye size={20} weight="bold" />
                        </button>
                        {onEdit && (
                          <button
                            onClick={() => onEdit(notice)}
                            className="p-2 bg-gray-50 text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
                            title="Editar"
                          >
                            <PencilSimple size={20} weight="bold" />
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(notice.id)}
                          className="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors"
                          title="Excluir"
                        >
                          <Trash size={20} weight="bold" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Resumo */}
          {!loading && filteredNotices.length > 0 && (
            <div className="mt-6 p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-600">
                Mostrando <strong>{filteredNotices.length}</strong> de{' '}
                <strong>{notices.length}</strong> aviso
                {notices.length !== 1 ? 's' : ''}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal de detalhes */}
      {showDetailsModal && selectedNotice && (
        <NoticeDetailsModal
          notice={selectedNotice}
          onClose={() => {
            setShowDetailsModal(false);
            setSelectedNotice(null);
          }}
        />
      )}
    </>
  );
};

export default NoticesList;
