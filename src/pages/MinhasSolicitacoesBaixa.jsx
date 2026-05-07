import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../components/AuthContext';
import { supabaseAdmin } from '../lib/supabase';
import PageTitle from '../components/ui/PageTitle';
import Notification from '../components/ui/Notification';
import {
  Receipt,
  CheckCircle,
  XCircle,
  Clock,
  Eye,
  Spinner,
  ArrowClockwise,
  X,
  Image,
  FileText,
  Bank,
  MagnifyingGlassPlus,
  MagnifyingGlassMinus,
  ArrowsOut,
  CalendarBlank,
  Warning,
  UploadSimple,
  PencilSimple,
} from '@phosphor-icons/react';

const MinhasSolicitacoesBaixa = () => {
  const { user } = useAuth();
  const [solicitacoes, setSolicitacoes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState(null);
  const [filtroStatus, setFiltroStatus] = useState('TODOS');

  // Modal de comprovante
  const [modalComprovante, setModalComprovante] = useState(null);
  const [zoomImagem, setZoomImagem] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);

  // Correção de comprovante
  const [modalCorrecao, setModalCorrecao] = useState(null);
  const [novoComprovante, setNovoComprovante] = useState(null);
  const [enviandoCorrecao, setEnviandoCorrecao] = useState(false);

  const FORMAS_PAGAMENTO_LABELS = {
    confianca: 'Confiança',
    sicredi: 'Sicredi',
    conta_corrente: 'Conta Corrente',
    adiantamento: 'Adiantamento (PIX)',
    cartao_credito: 'Cartão de Créd.',
    cartao_debito: 'Cartão de Déb.',
    credev: 'CREDEV',
  };

  // Carregar solicitações do usuário logado
  const carregarSolicitacoes = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabaseAdmin
        .from('solicitacoes_baixa')
        .select('*')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setSolicitacoes(data || []);
    } catch (error) {
      console.error('Erro ao carregar solicitações:', error);
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
    if (user?.id) {
      carregarSolicitacoes();
    }
  }, [user?.id]);

  // Solicitações filtradas
  const solicitacoesFiltradas = useMemo(() => {
    if (filtroStatus === 'TODOS') return solicitacoes;
    return solicitacoes.filter((s) => s.status === filtroStatus);
  }, [solicitacoes, filtroStatus]);

  // Totais por status
  const totais = useMemo(() => {
    return {
      pendente: solicitacoes.filter((s) => s.status === 'pendente').length,
      aprovada: solicitacoes.filter((s) => s.status === 'aprovada').length,
      rejeitada: solicitacoes.filter((s) => s.status === 'rejeitada').length,
      processada: solicitacoes.filter((s) => s.status === 'processada').length,
      total: solicitacoes.length,
    };
  }, [solicitacoes]);

  const formatarMoeda = (valor) =>
    parseFloat(valor || 0).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });

  const formatarData = (data) => {
    if (!data) return '--';
    const str = String(data).split('T')[0];
    const [ano, mes, dia] = str.split('-');
    if (!ano || !mes || !dia) return '--';
    return `${dia}/${mes}/${ano}`;
  };

  const formatarDataHora = (data) => {
    if (!data) return '--';
    const d = new Date(data);
    if (isNaN(d.getTime())) return '--';
    return d.toLocaleString('pt-BR');
  };

  // Reenviar solicitação com novo comprovante
  const reenviarSolicitacao = async () => {
    if (!novoComprovante || !modalCorrecao) return;

    setEnviandoCorrecao(true);
    try {
      // Upload do novo comprovante
      const fileExt = novoComprovante.name.split('.').pop();
      const fileName = `${modalCorrecao.cd_empresa}_${modalCorrecao.cd_cliente}_${modalCorrecao.nr_fat}_${Date.now()}.${fileExt}`;
      const filePath = `comprovantes/${fileName}`;

      const { error: uploadError } = await supabaseAdmin.storage
        .from('comprovantes_baixa')
        .upload(filePath, novoComprovante, { upsert: false });

      if (uploadError)
        throw new Error(`Erro no upload: ${uploadError.message}`);

      const { data: urlData } = supabaseAdmin.storage
        .from('comprovantes_baixa')
        .getPublicUrl(filePath);

      const comprovanteUrl = urlData?.publicUrl;

      // Remover comprovante antigo do storage
      if (modalCorrecao.comprovante_path) {
        await supabaseAdmin.storage
          .from('comprovantes_baixa')
          .remove([modalCorrecao.comprovante_path]);
      }

      // Atualizar registro: novo comprovante, status pendente, limpar rejeição
      const { error: updateError } = await supabaseAdmin
        .from('solicitacoes_baixa')
        .update({
          comprovante_url: comprovanteUrl,
          comprovante_path: filePath,
          status: 'pendente',
          motivo_rejeicao: null,
          user_aprovador: null,
        })
        .eq('id', modalCorrecao.id);

      if (updateError) throw updateError;

      setNotification({
        type: 'success',
        message: 'Comprovante atualizado e solicitação reenviada com sucesso!',
      });
      setTimeout(() => setNotification(null), 4000);

      setModalCorrecao(null);
      setNovoComprovante(null);
      carregarSolicitacoes();
    } catch (error) {
      console.error('Erro ao reenviar solicitação:', error);
      setNotification({
        type: 'error',
        message: `Erro ao reenviar: ${error.message}`,
      });
      setTimeout(() => setNotification(null), 5000);
    } finally {
      setEnviandoCorrecao(false);
    }
  };

  const statusConfig = {
    pendente: {
      label: 'Pendente',
      color: 'bg-yellow-100 text-yellow-800',
      icon: Clock,
    },
    aprovada: {
      label: 'Aprovada',
      color: 'bg-blue-100 text-blue-800',
      icon: CheckCircle,
    },
    rejeitada: {
      label: 'Rejeitada',
      color: 'bg-red-100 text-red-800',
      icon: XCircle,
    },
    processada: {
      label: 'Processada',
      color: 'bg-green-100 text-green-800',
      icon: CheckCircle,
    },
  };

  return (
    <div className="w-full max-w-7xl mx-auto flex flex-col items-stretch justify-start py-3 px-2">
      <PageTitle
        title="Minhas Solicitações de Baixa"
        subtitle="Acompanhe o status das suas solicitações de baixa"
        icon={Receipt}
        iconColor="text-purple-600"
      />

      {/* Cards de resumo */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        {[
          {
            label: 'Total',
            value: totais.total,
            color: 'bg-gray-100 text-gray-800',
          },
          {
            label: 'Pendentes',
            value: totais.pendente,
            color: 'bg-yellow-100 text-yellow-800',
            filter: 'pendente',
          },
          {
            label: 'Aprovadas',
            value: totais.aprovada,
            color: 'bg-blue-100 text-blue-800',
            filter: 'aprovada',
          },
          {
            label: 'Rejeitadas',
            value: totais.rejeitada,
            color: 'bg-red-100 text-red-800',
            filter: 'rejeitada',
          },
          {
            label: 'Processadas',
            value: totais.processada,
            color: 'bg-green-100 text-green-800',
            filter: 'processada',
          },
        ].map((card) => (
          <button
            key={card.label}
            onClick={() => setFiltroStatus(card.filter || 'TODOS')}
            className={`p-3 rounded-xl border shadow-sm text-center transition-all hover:shadow-md ${
              filtroStatus === (card.filter || 'TODOS')
                ? 'ring-2 ring-[#000638]'
                : ''
            }`}
          >
            <p className="text-xs font-medium text-gray-500">{card.label}</p>
            <p
              className={`text-2xl font-extrabold mt-1 ${card.color.split(' ')[1]}`}
            >
              {card.value}
            </p>
          </button>
        ))}
      </div>

      {/* Barra de ações */}
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={carregarSolicitacoes}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-[#000638] bg-white border rounded-lg hover:bg-gray-50 transition-colors"
          >
            <ArrowClockwise size={14} weight="bold" />
            Atualizar
          </button>
        </div>
        <p className="text-xs text-gray-400">
          {solicitacoesFiltradas.length} solicitação(ões) encontrada(s)
        </p>
      </div>

      {/* Tabela */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Spinner size={32} className="animate-spin text-[#000638]" />
          <span className="ml-3 text-gray-500">Carregando solicitações...</span>
        </div>
      ) : solicitacoesFiltradas.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <Receipt size={48} className="mx-auto mb-3" />
          <p className="font-medium">Nenhuma solicitação encontrada</p>
          <p className="text-sm mt-1">
            {filtroStatus !== 'TODOS'
              ? 'Altere o filtro ou envie solicitações pela tela de Inadimplentes.'
              : 'Envie solicitações de baixa pela tela de Inadimplentes.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto bg-white rounded-xl border shadow-sm">
          <table className="min-w-full text-xs">
            <thead className="bg-[#000638] text-white sticky top-0">
              <tr>
                <th className="px-3 py-2.5 text-left font-semibold">Status</th>
                <th className="px-3 py-2.5 text-left font-semibold">Cliente</th>
                <th className="px-3 py-2.5 text-left font-semibold">Fatura</th>
                <th className="px-3 py-2.5 text-center font-semibold">
                  Parcela
                </th>
                <th className="px-3 py-2.5 text-right font-semibold">Valor</th>
                <th className="px-3 py-2.5 text-center font-semibold">
                  Vencimento
                </th>
                <th className="px-3 py-2.5 text-center font-semibold">
                  Dt. Pagamento
                </th>
                <th className="px-3 py-2.5 text-center font-semibold">
                  Forma Pgto.
                </th>
                <th className="px-3 py-2.5 text-left font-semibold">
                  Portador
                </th>
                <th className="px-3 py-2.5 text-center font-semibold">
                  Solicitado em
                </th>
                <th className="px-3 py-2.5 text-center font-semibold">
                  Comprovante
                </th>
                <th className="px-3 py-2.5 text-center font-semibold">
                  Detalhes
                </th>
                <th className="px-3 py-2.5 text-center font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody>
              {solicitacoesFiltradas.map((sol) => {
                const config =
                  statusConfig[sol.status] || statusConfig.pendente;
                const StatusIcon = config.icon;
                return (
                  <tr
                    key={sol.id}
                    className="border-b hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${config.color}`}
                      >
                        <StatusIcon size={12} weight="bold" />
                        {config.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="font-medium">
                        {sol.nm_cliente || '--'}
                      </div>
                      <div className="text-[10px] text-gray-400">
                        Cód: {sol.cd_cliente}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-semibold">{sol.nr_fat}</td>
                    <td className="px-3 py-2 text-center">{sol.nr_parcela}</td>
                    <td className="px-3 py-2 text-right font-bold text-red-600">
                      {formatarMoeda(sol.vl_fatura)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {formatarData(sol.dt_vencimento)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {sol.dt_pagamento ? (
                        <span className="inline-flex items-center gap-1 text-green-700 font-semibold">
                          <CalendarBlank size={12} />
                          {formatarData(sol.dt_pagamento)}
                        </span>
                      ) : (
                        <span className="text-gray-400">--</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {sol.forma_pagamento ? (
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            sol.forma_pagamento === 'confianca'
                              ? 'bg-blue-100 text-blue-800'
                              : sol.forma_pagamento === 'sicredi'
                                ? 'bg-green-100 text-green-800'
                                : sol.forma_pagamento === 'conta_corrente'
                                  ? 'bg-blue-100 text-blue-800'
                                  : sol.forma_pagamento === 'adiantamento'
                                    ? 'bg-purple-100 text-purple-800'
                                    : sol.forma_pagamento === 'cartao_credito'
                                      ? 'bg-yellow-100 text-yellow-800'
                                      : sol.forma_pagamento === 'cartao_debito'
                                        ? 'bg-orange-100 text-orange-800'
                                        : sol.forma_pagamento === 'credev'
                                          ? 'bg-indigo-100 text-indigo-800'
                                          : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {FORMAS_PAGAMENTO_LABELS[sol.forma_pagamento] ||
                            sol.forma_pagamento}
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-400">--</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className="bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded font-medium text-[10px]">
                        {sol.nm_portador || sol.cd_portador || '--'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center text-[10px]">
                      {formatarDataHora(sol.created_at)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {sol.comprovante_url && (
                        <button
                          onClick={() => setModalComprovante(sol)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold text-indigo-700 bg-indigo-50 rounded hover:bg-indigo-100 transition-colors"
                        >
                          <Eye size={12} />
                          Ver
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {sol.status === 'rejeitada' && sol.motivo_rejeicao ? (
                        <button
                          onClick={() => setModalComprovante(sol)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold text-red-700 bg-red-50 rounded hover:bg-red-100 transition-colors"
                          title={sol.motivo_rejeicao}
                        >
                          <Warning size={12} weight="bold" />
                          Ver motivo
                        </button>
                      ) : sol.observacao ? (
                        <button
                          onClick={() => setModalComprovante(sol)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold text-gray-600 bg-gray-50 rounded hover:bg-gray-100 transition-colors"
                          title={sol.observacao}
                        >
                          <Eye size={12} />
                          Obs.
                        </button>
                      ) : (
                        <span className="text-[10px] text-gray-400">--</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {sol.status === 'rejeitada' ? (
                        <button
                          onClick={() => {
                            setModalCorrecao(sol);
                            setNovoComprovante(null);
                          }}
                          className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold text-orange-700 bg-orange-50 rounded hover:bg-orange-100 transition-colors"
                          title="Corrigir comprovante e reenviar"
                        >
                          <PencilSimple size={12} weight="bold" />
                          Corrigir
                        </button>
                      ) : (
                        <span className="text-[10px] text-gray-400">--</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal de Comprovante / Detalhes */}
      {modalComprovante && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-[#000638] text-white p-4 rounded-t-xl flex justify-between items-center">
              <h3 className="text-lg font-bold">
                Detalhes - Fatura {modalComprovante.nr_fat}
              </h3>
              <button
                onClick={() => setModalComprovante(null)}
                className="text-white hover:text-red-300"
              >
                <X size={22} weight="bold" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div className="bg-gray-50 rounded-lg p-3 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-gray-500">Cliente:</span>{' '}
                  <span className="font-semibold">
                    {modalComprovante.nm_cliente}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Fatura:</span>{' '}
                  <span className="font-semibold">
                    {modalComprovante.nr_fat}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Valor:</span>{' '}
                  <span className="font-bold text-red-600">
                    {formatarMoeda(modalComprovante.vl_fatura)}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Portador:</span>{' '}
                  <span className="font-semibold">
                    {modalComprovante.nm_portador ||
                      modalComprovante.cd_portador ||
                      '--'}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Status:</span>{' '}
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      statusConfig[modalComprovante.status]?.color ||
                      'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {statusConfig[modalComprovante.status]?.label ||
                      modalComprovante.status}
                  </span>
                </div>
                {modalComprovante.forma_pagamento && (
                  <div>
                    <span className="text-gray-500">Forma Pgto.:</span>{' '}
                    <span className="font-semibold">
                      {FORMAS_PAGAMENTO_LABELS[
                        modalComprovante.forma_pagamento
                      ] || modalComprovante.forma_pagamento}
                    </span>
                  </div>
                )}
                {modalComprovante.observacao && (
                  <div className="col-span-2">
                    <span className="text-gray-500">Observação:</span>{' '}
                    <span className="font-medium">
                      {modalComprovante.observacao}
                    </span>
                  </div>
                )}
                {modalComprovante.motivo_rejeicao && (
                  <div className="col-span-2 bg-red-50 rounded-lg p-2 border border-red-200">
                    <span className="text-red-600 font-bold text-xs flex items-center gap-1">
                      <Warning size={14} weight="bold" />
                      Motivo da Rejeição:
                    </span>
                    <p className="font-medium text-red-700 mt-1 text-sm">
                      {modalComprovante.motivo_rejeicao}
                    </p>
                  </div>
                )}
              </div>

              {/* Botão Corrigir dentro do modal de detalhes */}
              {modalComprovante.status === 'rejeitada' && (
                <div className="flex justify-center">
                  <button
                    onClick={() => {
                      setModalCorrecao(modalComprovante);
                      setNovoComprovante(null);
                      setModalComprovante(null);
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-orange-500 rounded-lg hover:bg-orange-600 transition-colors"
                  >
                    <PencilSimple size={16} weight="bold" />
                    Corrigir Comprovante e Reenviar
                  </button>
                </div>
              )}

              {/* Comprovante */}
              {modalComprovante.comprovante_url && (
                <div className="flex justify-center">
                  {modalComprovante.comprovante_url?.match(
                    /\.(jpg|jpeg|png|gif|webp)/i,
                  ) ? (
                    <div className="space-y-3 w-full">
                      <div
                        className="relative cursor-pointer"
                        onClick={() => {
                          setZoomImagem(true);
                          setZoomLevel(1);
                        }}
                      >
                        <img
                          src={modalComprovante.comprovante_url}
                          alt="Comprovante"
                          className="max-w-full max-h-[55vh] rounded-lg shadow-lg mx-auto hover:opacity-90 transition-opacity"
                        />
                        <div className="absolute bottom-2 right-2 bg-black bg-opacity-60 text-white px-2 py-1 rounded-lg text-xs flex items-center gap-1">
                          <MagnifyingGlassPlus size={14} />
                          Clique para ampliar
                        </div>
                      </div>
                      <div className="flex justify-center">
                        <a
                          href={modalComprovante.comprovante_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-[#000638] bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                        >
                          <ArrowsOut size={14} />
                          Abrir em nova aba
                        </a>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <FileText
                        size={48}
                        className="mx-auto text-gray-400 mb-3"
                      />
                      <a
                        href={modalComprovante.comprovante_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-[#000638] rounded-lg hover:bg-[#fe0000] transition-colors"
                      >
                        <Eye size={16} />
                        Abrir Comprovante (PDF)
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal de Correção de Comprovante */}
      {modalCorrecao && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full">
            <div className="sticky top-0 bg-orange-500 text-white p-4 rounded-t-xl flex justify-between items-center">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <PencilSimple size={20} weight="bold" />
                Corrigir Comprovante
              </h3>
              <button
                onClick={() => {
                  setModalCorrecao(null);
                  setNovoComprovante(null);
                }}
                className="text-white hover:text-red-200"
                disabled={enviandoCorrecao}
              >
                <X size={22} weight="bold" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {/* Info da solicitação */}
              <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                <p>
                  <span className="text-gray-500">Cliente:</span>{' '}
                  <span className="font-semibold">
                    {modalCorrecao.nm_cliente}
                  </span>
                </p>
                <p>
                  <span className="text-gray-500">Fatura:</span>{' '}
                  <span className="font-semibold">{modalCorrecao.nr_fat}</span>{' '}
                  —{' '}
                  <span className="font-bold text-red-600">
                    {formatarMoeda(modalCorrecao.vl_fatura)}
                  </span>
                </p>
              </div>

              {/* Motivo da rejeição */}
              {modalCorrecao.motivo_rejeicao && (
                <div className="bg-red-50 rounded-lg p-3 border border-red-200">
                  <p className="text-red-600 font-bold text-xs flex items-center gap-1 mb-1">
                    <Warning size={14} weight="bold" />
                    Motivo da Rejeição:
                  </p>
                  <p className="text-red-700 font-medium text-sm">
                    {modalCorrecao.motivo_rejeicao}
                  </p>
                </div>
              )}

              {/* Comprovante atual */}
              <div>
                <p className="text-xs font-bold text-gray-500 mb-1">
                  Comprovante Atual:
                </p>
                {modalCorrecao.comprovante_url?.match(
                  /\.(jpg|jpeg|png|gif|webp)/i,
                ) ? (
                  <img
                    src={modalCorrecao.comprovante_url}
                    alt="Comprovante atual"
                    className="max-h-32 rounded-lg border shadow-sm mx-auto"
                  />
                ) : (
                  <a
                    href={modalCorrecao.comprovante_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline"
                  >
                    <FileText size={14} /> Ver comprovante atual (PDF)
                  </a>
                )}
              </div>

              {/* Upload novo comprovante */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Novo Comprovante <span className="text-red-500">*</span>
                </label>
                <label
                  className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed rounded-xl cursor-pointer hover:border-orange-400 hover:bg-orange-50 transition-colors
                  ${novoComprovante ? 'border-green-400 bg-green-50' : 'border-gray-300 bg-white'}"
                >
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    className="hidden"
                    onChange={(e) =>
                      setNovoComprovante(e.target.files[0] || null)
                    }
                    disabled={enviandoCorrecao}
                  />
                  {novoComprovante ? (
                    <div className="text-center">
                      <CheckCircle
                        size={28}
                        className="mx-auto text-green-500 mb-1"
                      />
                      <p className="text-xs font-bold text-green-700">
                        {novoComprovante.name}
                      </p>
                      <p className="text-[10px] text-gray-400">
                        {(novoComprovante.size / 1024).toFixed(1)} KB — Clique
                        para trocar
                      </p>
                    </div>
                  ) : (
                    <div className="text-center">
                      <UploadSimple
                        size={28}
                        className="mx-auto text-gray-400 mb-1"
                      />
                      <p className="text-xs font-medium text-gray-500">
                        Clique para selecionar o novo comprovante
                      </p>
                      <p className="text-[10px] text-gray-400">Imagem ou PDF</p>
                    </div>
                  )}
                </label>
              </div>

              {/* Botões */}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={() => {
                    setModalCorrecao(null);
                    setNovoComprovante(null);
                  }}
                  className="px-4 py-2 text-sm font-bold text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                  disabled={enviandoCorrecao}
                >
                  Cancelar
                </button>
                <button
                  onClick={reenviarSolicitacao}
                  disabled={!novoComprovante || enviandoCorrecao}
                  className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-bold text-white rounded-lg transition-colors ${
                    !novoComprovante || enviandoCorrecao
                      ? 'bg-gray-300 cursor-not-allowed'
                      : 'bg-orange-500 hover:bg-orange-600'
                  }`}
                >
                  {enviandoCorrecao ? (
                    <>
                      <Spinner size={16} className="animate-spin" /> Enviando...
                    </>
                  ) : (
                    <>
                      <UploadSimple size={16} weight="bold" /> Reenviar
                      Solicitação
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Overlay de Zoom da Imagem */}
      {zoomImagem && modalComprovante && (
        <div
          className="fixed inset-0 bg-black bg-opacity-90 flex flex-col items-center justify-center z-[60]"
          onClick={() => setZoomImagem(false)}
        >
          {/* Controles de zoom */}
          <div
            className="absolute top-4 right-4 flex items-center gap-2 z-[61]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setZoomLevel((z) => Math.max(0.5, z - 0.25))}
              className="bg-white bg-opacity-20 hover:bg-opacity-40 text-white p-2 rounded-lg transition-colors"
              title="Diminuir zoom"
            >
              <MagnifyingGlassMinus size={22} />
            </button>
            <span className="text-white text-sm font-bold min-w-[50px] text-center">
              {Math.round(zoomLevel * 100)}%
            </span>
            <button
              onClick={() => setZoomLevel((z) => Math.min(4, z + 0.25))}
              className="bg-white bg-opacity-20 hover:bg-opacity-40 text-white p-2 rounded-lg transition-colors"
              title="Aumentar zoom"
            >
              <MagnifyingGlassPlus size={22} />
            </button>
            <button
              onClick={() => setZoomLevel(1)}
              className="bg-white bg-opacity-20 hover:bg-opacity-40 text-white px-3 py-2 rounded-lg transition-colors text-sm font-bold"
              title="Resetar zoom"
            >
              100%
            </button>
            <button
              onClick={() => setZoomImagem(false)}
              className="bg-red-600 hover:bg-red-700 text-white p-2 rounded-lg transition-colors ml-2"
              title="Fechar"
            >
              <X size={22} weight="bold" />
            </button>
          </div>

          {/* Imagem com zoom */}
          <div
            className="overflow-auto max-w-full max-h-full p-4 cursor-grab active:cursor-grabbing"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '100vw', maxHeight: '100vh' }}
          >
            <img
              src={modalComprovante.comprovante_url}
              alt="Comprovante ampliado"
              className="transition-transform duration-200 ease-out"
              style={{
                transform: `scale(${zoomLevel})`,
                transformOrigin: 'center center',
                maxWidth: zoomLevel <= 1 ? '90vw' : 'none',
                maxHeight: zoomLevel <= 1 ? '85vh' : 'none',
              }}
              draggable={false}
            />
          </div>

          {/* Dica inferior */}
          <div className="absolute bottom-4 text-white text-xs bg-black bg-opacity-50 px-3 py-1.5 rounded-lg">
            Clique fora da imagem para fechar • Use os botões para ajustar o
            zoom
          </div>
        </div>
      )}

      {/* Notificação */}
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

export default MinhasSolicitacoesBaixa;
