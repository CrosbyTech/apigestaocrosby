import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../components/AuthContext';
import { supabaseAdmin } from '../lib/supabase';
import PageTitle from '../components/ui/PageTitle';
import Notification from '../components/ui/Notification';
import {
  ClipboardText,
  CheckCircle,
  Clock,
  XCircle,
  ArrowClockwise,
  Spinner,
  Trash,
  X,
  ShoppingCart,
  Wrench,
  Eye,
  Link as LinkIcon,
  Copy,
  CheckSquare,
  PaperPlaneTilt,
} from '@phosphor-icons/react';

const STATUS_CONFIG = {
  pendente: {
    label: 'Pendente',
    color: 'bg-yellow-100 text-yellow-800',
    icon: Clock,
  },
  em_andamento: {
    label: 'Em andamento',
    color: 'bg-blue-100 text-blue-800',
    icon: PaperPlaneTilt,
  },
  concluida: {
    label: 'Concluída',
    color: 'bg-green-100 text-green-800',
    icon: CheckCircle,
  },
  cancelada: {
    label: 'Cancelada',
    color: 'bg-red-100 text-red-800',
    icon: XCircle,
  },
};

const TIPO_CONFIG = {
  compras: {
    label: 'Compras',
    icon: ShoppingCart,
    color: 'bg-blue-100 text-blue-800',
  },
  reparos: {
    label: 'Reparos',
    icon: Wrench,
    color: 'bg-orange-100 text-orange-800',
  },
};

const NIVEL_CONFIG = {
  leve: { label: 'Leve', color: 'bg-green-100 text-green-700' },
  medio: { label: 'Médio', color: 'bg-yellow-100 text-yellow-700' },
  alto: { label: 'Alto', color: 'bg-orange-100 text-orange-700' },
  urgente: { label: 'Urgente', color: 'bg-red-100 text-red-700' },
};

const formatarDataHora = (data) => {
  if (!data) return '--';
  const d = new Date(data);
  if (isNaN(d.getTime())) return '--';
  return d.toLocaleString('pt-BR');
};

const formatarData = (data) => {
  if (!data) return '--';
  const d = new Date(data);
  if (isNaN(d.getTime())) return '--';
  return d.toLocaleDateString('pt-BR');
};

const SolicitacoesCrosby = () => {
  const { user } = useAuth();
  const [solicitacoes, setSolicitacoes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState(null);

  const [filtroStatus, setFiltroStatus] = useState('TODOS');
  const [filtroTipo, setFiltroTipo] = useState('TODOS');
  const [filtroDataInicio, setFiltroDataInicio] = useState('');
  const [filtroDataFim, setFiltroDataFim] = useState('');

  const [modalDetalhe, setModalDetalhe] = useState(null);
  const [linkCopiado, setLinkCopiado] = useState(false);

  const formularioUrl = `${window.location.origin}/formulario-solicitacoes`;

  const carregarSolicitacoes = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabaseAdmin
        .from('solicitacoes_crosby')
        .select('*')
        .order('data_solicitacao', { ascending: false });
      if (error) throw error;
      setSolicitacoes(data || []);
    } catch (err) {
      console.error('Erro ao carregar solicitações:', err);
      setNotification({
        type: 'error',
        message: 'Erro ao carregar solicitações.',
      });
      setTimeout(() => setNotification(null), 3000);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarSolicitacoes();
  }, []);

  const solicitacoesFiltradas = useMemo(() => {
    let lista = solicitacoes;
    if (filtroStatus !== 'TODOS') {
      lista = lista.filter((s) => s.status === filtroStatus);
    }
    if (filtroTipo !== 'TODOS') {
      lista = lista.filter((s) => s.tipo_solicitacao === filtroTipo);
    }
    if (filtroDataInicio) {
      const inicio = new Date(filtroDataInicio + 'T00:00:00');
      lista = lista.filter((s) => new Date(s.data_solicitacao) >= inicio);
    }
    if (filtroDataFim) {
      const fim = new Date(filtroDataFim + 'T23:59:59');
      lista = lista.filter((s) => new Date(s.data_solicitacao) <= fim);
    }
    return lista;
  }, [solicitacoes, filtroStatus, filtroTipo, filtroDataInicio, filtroDataFim]);

  const totais = useMemo(
    () => ({
      total: solicitacoes.length,
      pendente: solicitacoes.filter((s) => s.status === 'pendente').length,
      em_andamento: solicitacoes.filter((s) => s.status === 'em_andamento')
        .length,
      concluida: solicitacoes.filter((s) => s.status === 'concluida').length,
      cancelada: solicitacoes.filter((s) => s.status === 'cancelada').length,
    }),
    [solicitacoes],
  );

  const atualizarStatus = async (sol, novoStatus) => {
    try {
      const updates = { status: novoStatus };
      if (novoStatus === 'concluida') {
        updates.data_conclusao = new Date().toISOString();
        updates.concluido_por = user?.id || null;
        updates.concluido_por_nome =
          user?.user_metadata?.nome || user?.email || null;
      } else {
        // Reabrir / cancelar / em andamento → limpa conclusão
        updates.data_conclusao = null;
        updates.concluido_por = null;
        updates.concluido_por_nome = null;
      }
      const { error } = await supabaseAdmin
        .from('solicitacoes_crosby')
        .update(updates)
        .eq('id', sol.id);
      if (error) throw error;
      await carregarSolicitacoes();
      setModalDetalhe(null);
      setNotification({
        type: 'success',
        message: `Status atualizado para "${STATUS_CONFIG[novoStatus]?.label}".`,
      });
      setTimeout(() => setNotification(null), 3000);
    } catch (err) {
      console.error('Erro ao atualizar status:', err);
      setNotification({
        type: 'error',
        message: 'Erro ao atualizar status.',
      });
      setTimeout(() => setNotification(null), 3000);
    }
  };

  const excluirSolicitacao = async (sol) => {
    if (
      !window.confirm(
        `Excluir solicitação de ${sol.solicitante} (${sol.nm_empresa || sol.cd_empresa})?`,
      )
    )
      return;
    try {
      const { error } = await supabaseAdmin
        .from('solicitacoes_crosby')
        .delete()
        .eq('id', sol.id);
      if (error) throw error;
      await carregarSolicitacoes();
      setModalDetalhe(null);
      setNotification({ type: 'success', message: 'Solicitação excluída.' });
      setTimeout(() => setNotification(null), 3000);
    } catch (err) {
      console.error('Erro ao excluir:', err);
      setNotification({ type: 'error', message: 'Erro ao excluir.' });
      setTimeout(() => setNotification(null), 3000);
    }
  };

  const copiarLink = async () => {
    try {
      await navigator.clipboard.writeText(formularioUrl);
      setLinkCopiado(true);
      setTimeout(() => setLinkCopiado(false), 2000);
    } catch (err) {
      console.error('Erro ao copiar link:', err);
    }
  };

  const limparFiltros = () => {
    setFiltroStatus('TODOS');
    setFiltroTipo('TODOS');
    setFiltroDataInicio('');
    setFiltroDataFim('');
  };

  return (
    <div className="w-full max-w-7xl mx-auto flex flex-col items-stretch justify-start py-3 px-2">
      <PageTitle
        title="Solicitações Crosby"
        subtitle="Gerencie as solicitações de compras e reparos enviadas pelas lojas"
        icon={ClipboardText}
        iconColor="text-[#000638]"
      />

      {/* Link público do formulário */}
      <div className="mb-4 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-3 flex flex-wrap items-center gap-2">
        <LinkIcon size={18} weight="bold" className="text-[#000638]" />
        <div className="flex-1 min-w-[200px]">
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
            Link público do formulário
          </p>
          <code className="text-xs text-[#000638] break-all">
            {formularioUrl}
          </code>
        </div>
        <button
          onClick={copiarLink}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-[#000638] hover:bg-[#fe0000] rounded-lg transition-colors"
        >
          {linkCopiado ? (
            <>
              <CheckSquare size={14} weight="bold" />
              Copiado!
            </>
          ) : (
            <>
              <Copy size={14} weight="bold" />
              Copiar link
            </>
          )}
        </button>
      </div>

      {/* Cards de resumo */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        {[
          {
            label: 'Total',
            value: totais.total,
            color: 'text-gray-800',
            filter: 'TODOS',
          },
          {
            label: 'Pendentes',
            value: totais.pendente,
            color: 'text-yellow-700',
            filter: 'pendente',
          },
          {
            label: 'Em andamento',
            value: totais.em_andamento,
            color: 'text-blue-700',
            filter: 'em_andamento',
          },
          {
            label: 'Concluídas',
            value: totais.concluida,
            color: 'text-green-700',
            filter: 'concluida',
          },
          {
            label: 'Canceladas',
            value: totais.cancelada,
            color: 'text-red-700',
            filter: 'cancelada',
          },
        ].map((card) => (
          <button
            key={card.label}
            onClick={() => setFiltroStatus(card.filter)}
            className={`p-3 rounded-xl border bg-white shadow-sm text-center transition-all hover:shadow-md ${
              filtroStatus === card.filter ? 'ring-2 ring-[#000638]' : ''
            }`}
          >
            <p className="text-xs font-medium text-gray-500">{card.label}</p>
            <p className={`text-2xl font-extrabold mt-1 ${card.color}`}>
              {card.value}
            </p>
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div className="bg-white border rounded-xl p-3 mb-3 flex flex-wrap items-end gap-3">
        <div className="flex flex-col">
          <label className="text-[10px] font-bold text-gray-500 uppercase mb-0.5">
            Tipo
          </label>
          <select
            value={filtroTipo}
            onChange={(e) => setFiltroTipo(e.target.value)}
            className="border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#000638] min-w-[120px]"
          >
            <option value="TODOS">Todos</option>
            <option value="compras">Compras</option>
            <option value="reparos">Reparos</option>
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-[10px] font-bold text-gray-500 uppercase mb-0.5">
            Status
          </label>
          <select
            value={filtroStatus}
            onChange={(e) => setFiltroStatus(e.target.value)}
            className="border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#000638] min-w-[140px]"
          >
            <option value="TODOS">Todos</option>
            <option value="pendente">Pendente</option>
            <option value="em_andamento">Em andamento</option>
            <option value="concluida">Concluída</option>
            <option value="cancelada">Cancelada</option>
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-[10px] font-bold text-gray-500 uppercase mb-0.5">
            Data início
          </label>
          <input
            type="date"
            value={filtroDataInicio}
            onChange={(e) => setFiltroDataInicio(e.target.value)}
            className="border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#000638]"
          />
        </div>
        <div className="flex flex-col">
          <label className="text-[10px] font-bold text-gray-500 uppercase mb-0.5">
            Data fim
          </label>
          <input
            type="date"
            value={filtroDataFim}
            onChange={(e) => setFiltroDataFim(e.target.value)}
            className="border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#000638]"
          />
        </div>
        <button
          onClick={limparFiltros}
          className="px-3 py-1.5 text-xs font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
        >
          Limpar
        </button>
        <button
          onClick={carregarSolicitacoes}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-[#000638] bg-white border rounded-lg hover:bg-gray-50 transition-colors"
        >
          <ArrowClockwise size={14} weight="bold" />
          Atualizar
        </button>
        <span className="ml-auto text-xs text-gray-500">
          {solicitacoesFiltradas.length} de {solicitacoes.length}
        </span>
      </div>

      {/* Tabela */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Spinner size={32} className="animate-spin text-[#000638]" />
          <span className="ml-3 text-gray-500">Carregando solicitações...</span>
        </div>
      ) : solicitacoesFiltradas.length === 0 ? (
        <div className="text-center py-20 text-gray-400 bg-white rounded-xl border">
          <ClipboardText size={48} className="mx-auto mb-3" />
          <p className="font-medium">Nenhuma solicitação encontrada</p>
          <p className="text-sm mt-1">
            Compartilhe o link público para receber novas solicitações.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto bg-white rounded-xl border shadow-sm">
          <table className="min-w-full text-xs">
            <thead className="bg-[#000638] text-white sticky top-0">
              <tr>
                <th className="px-3 py-2.5 text-left font-semibold">Status</th>
                <th className="px-3 py-2.5 text-left font-semibold">Tipo</th>
                <th className="px-3 py-2.5 text-left font-semibold">Loja</th>
                <th className="px-3 py-2.5 text-left font-semibold">
                  Solicitante
                </th>
                <th className="px-3 py-2.5 text-center font-semibold">
                  Urgência
                </th>
                <th className="px-3 py-2.5 text-left font-semibold">
                  Descrição
                </th>
                <th className="px-3 py-2.5 text-center font-semibold">
                  Data Solicitação
                </th>
                <th className="px-3 py-2.5 text-center font-semibold">
                  Data Conclusão
                </th>
                <th className="px-3 py-2.5 text-center font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody>
              {solicitacoesFiltradas.map((sol) => {
                const statusCfg =
                  STATUS_CONFIG[sol.status] || STATUS_CONFIG.pendente;
                const StatusIcon = statusCfg.icon;
                const tipoCfg =
                  TIPO_CONFIG[sol.tipo_solicitacao] || TIPO_CONFIG.compras;
                const TipoIcon = tipoCfg.icon;
                const nivelCfg =
                  NIVEL_CONFIG[sol.nivel_urgencia] || NIVEL_CONFIG.leve;
                return (
                  <tr
                    key={sol.id}
                    className="border-b hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${statusCfg.color}`}
                      >
                        <StatusIcon size={12} weight="bold" />
                        {statusCfg.label}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${tipoCfg.color}`}
                      >
                        <TipoIcon size={12} weight="bold" />
                        {tipoCfg.label}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">
                        {sol.nm_empresa || '--'}
                      </div>
                      <div className="text-[10px] text-gray-400">
                        Cód: {sol.cd_empresa}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-medium">{sol.solicitante}</td>
                    <td className="px-3 py-2 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${nivelCfg.color}`}
                      >
                        {nivelCfg.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 max-w-[260px]">
                      <p className="truncate" title={sol.descricao}>
                        {sol.descricao}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-center text-[10px]">
                      {formatarDataHora(sol.data_solicitacao)}
                    </td>
                    <td className="px-3 py-2 text-center text-[10px]">
                      {sol.data_conclusao ? (
                        <div>
                          <div className="text-green-700 font-semibold">
                            {formatarDataHora(sol.data_conclusao)}
                          </div>
                          {sol.concluido_por_nome && (
                            <div className="text-gray-400">
                              por {sol.concluido_por_nome}
                            </div>
                          )}
                        </div>
                      ) : (
                        '--'
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => setModalDetalhe(sol)}
                          className="p-1 text-[#000638] hover:bg-blue-50 rounded transition-colors"
                          title="Ver detalhes / alterar status"
                        >
                          <Eye size={16} weight="bold" />
                        </button>
                        {sol.status !== 'concluida' && (
                          <button
                            onClick={() => atualizarStatus(sol, 'concluida')}
                            className="p-1 text-green-600 hover:bg-green-50 rounded transition-colors"
                            title="Marcar como concluída"
                          >
                            <CheckCircle size={16} weight="bold" />
                          </button>
                        )}
                        <button
                          onClick={() => excluirSolicitacao(sol)}
                          className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                          title="Excluir"
                        >
                          <Trash size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal de detalhes */}
      {modalDetalhe && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-[#000638] text-white p-4 rounded-t-xl flex justify-between items-center">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <ClipboardText size={20} weight="bold" />
                Detalhes da Solicitação
              </h3>
              <button
                onClick={() => setModalDetalhe(null)}
                className="text-white hover:text-red-300"
              >
                <X size={22} weight="bold" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-[10px] uppercase font-bold text-gray-500">
                    Loja
                  </p>
                  <p className="font-semibold">
                    {modalDetalhe.cd_empresa} -{' '}
                    {modalDetalhe.nm_empresa || '--'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-gray-500">
                    Solicitante
                  </p>
                  <p className="font-semibold">{modalDetalhe.solicitante}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-gray-500">
                    Tipo
                  </p>
                  <p className="font-semibold capitalize">
                    {TIPO_CONFIG[modalDetalhe.tipo_solicitacao]?.label}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-gray-500">
                    Urgência
                  </p>
                  <span
                    className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${NIVEL_CONFIG[modalDetalhe.nivel_urgencia]?.color}`}
                  >
                    {NIVEL_CONFIG[modalDetalhe.nivel_urgencia]?.label}
                  </span>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-gray-500">
                    Data da solicitação
                  </p>
                  <p className="font-semibold">
                    {formatarDataHora(modalDetalhe.data_solicitacao)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-gray-500">
                    Data de conclusão
                  </p>
                  <p className="font-semibold">
                    {modalDetalhe.data_conclusao
                      ? formatarDataHora(modalDetalhe.data_conclusao)
                      : '--'}
                  </p>
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-[10px] uppercase font-bold text-gray-500 mb-1">
                  Descrição
                </p>
                <p className="text-sm whitespace-pre-wrap">
                  {modalDetalhe.descricao}
                </p>
              </div>

              {modalDetalhe.observacao && (
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-[10px] uppercase font-bold text-gray-500 mb-1">
                    Observação do solicitante
                  </p>
                  <p className="text-sm whitespace-pre-wrap">
                    {modalDetalhe.observacao}
                  </p>
                </div>
              )}

              {modalDetalhe.concluido_por_nome && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
                  <p className="text-[10px] uppercase font-bold text-green-700 mb-0.5">
                    Concluída por
                  </p>
                  <p className="font-semibold text-green-800">
                    {modalDetalhe.concluido_por_nome} ·{' '}
                    {formatarData(modalDetalhe.data_conclusao)}
                  </p>
                </div>
              )}

              <div className="border-t pt-4">
                <p className="text-[10px] uppercase font-bold text-gray-500 mb-2">
                  Alterar status
                </p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
                    const Icon = cfg.icon;
                    const ativo = modalDetalhe.status === key;
                    return (
                      <button
                        key={key}
                        onClick={() => atualizarStatus(modalDetalhe, key)}
                        disabled={ativo}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                          ativo
                            ? `${cfg.color} ring-2 ring-offset-1 cursor-default`
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        <Icon size={14} weight="bold" />
                        {cfg.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {notification && (
        <Notification
          type={notification.type}
          message={notification.message}
          onClose={() => setNotification(null)}
        />
      )}
    </div>
  );
};

export default SolicitacoesCrosby;
