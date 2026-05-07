import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../components/AuthContext';
import { supabase, supabaseAdmin } from '../lib/supabase';
import PageTitle from '../components/ui/PageTitle';
import Notification from '../components/ui/Notification';
import { TotvsURL } from '../config/constants';
import {
  Receipt,
  CheckCircle,
  XCircle,
  Clock,
  Funnel,
  Eye,
  Spinner,
  ArrowClockwise,
  Trash,
  X,
  Image,
  FileText,
  CaretUp,
  CaretDown,
  Bank,
  MagnifyingGlassPlus,
  MagnifyingGlassMinus,
  ArrowsOut,
  CalendarBlank,
  PencilSimple,
} from '@phosphor-icons/react';

const SolicitacaoBaixa = () => {
  const { user } = useAuth();
  const [solicitacoes, setSolicitacoes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState(null);
  const [filtroStatus, setFiltroStatus] = useState('pendente');
  const [filtroPortador, setFiltroPortador] = useState('TODOS');
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [processingBaixa, setProcessingBaixa] = useState(false);

  // Modal de comprovante
  const [modalComprovante, setModalComprovante] = useState(null);
  const [zoomImagem, setZoomImagem] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);

  // Modal de rejeição
  const [modalRejeicao, setModalRejeicao] = useState(null);
  const [motivoRejeicao, setMotivoRejeicao] = useState('');

  // Edição inline de data de pagamento
  const [editandoData, setEditandoData] = useState(null); // id da solicitação em edição

  // Edição inline de forma de pagamento
  const [editandoFormaPgto, setEditandoFormaPgto] = useState(null);

  // Modal de seleção de forma de pagamento para processamento
  const [modalPagamentoAberto, setModalPagamentoAberto] = useState(false);
  const [formaPagamentoProcessamento, setFormaPagamentoProcessamento] =
    useState('');
  const [bancoSelecionado, setBancoSelecionado] = useState(null);
  const [dadosCartaoProcessamento, setDadosCartaoProcessamento] = useState({
    bandeira: '',
    autorizacao: '',
    nsu: '',
  });

  const FORMAS_PAGAMENTO = [
    {
      id: 'confianca',
      label: 'Confiança',
      paidType: 4,
      bank: { bankNumber: 422, agencyNumber: 1610, account: '005818984' },
    },
    {
      id: 'sicredi',
      label: 'Sicredi',
      paidType: 4,
      bank: { bankNumber: 748, agencyNumber: 2207, account: '367338' },
    },
    { id: 'adiantamento', label: 'Adiantamento (PIX TOTVS)', paidType: 3 },
    { id: 'cartao_credito', label: 'Cartão de Crédito', paidType: 1 },
    { id: 'cartao_debito', label: 'Cartão de Débito', paidType: 2 },
    { id: 'credev', label: 'CREDEV', paidType: 5 },
  ];

  const FORMAS_PAGAMENTO_LABELS = {
    confianca: 'Confiança',
    sicredi: 'Sicredi',
    conta_corrente: 'Conta Corrente',
    adiantamento: 'Adiantamento (PIX)',
    cartao_credito: 'Cartão de Créd.',
    cartao_debito: 'Cartão de Déb.',
    credev: 'CREDEV',
  };

  // Carregar solicitações
  const carregarSolicitacoes = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabaseAdmin
        .from('solicitacoes_baixa')
        .select('*')
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
    carregarSolicitacoes();
  }, []);

  // Lista de portadores únicos
  const portadoresUnicos = useMemo(() => {
    const map = {};
    solicitacoes.forEach((s) => {
      if (s.cd_portador || s.nm_portador) {
        const key = s.cd_portador || s.nm_portador;
        map[key] = s.nm_portador || `Portador ${s.cd_portador}`;
      }
    });
    return Object.entries(map).sort((a, b) => a[1].localeCompare(b[1]));
  }, [solicitacoes]);

  // Solicitações filtradas
  const solicitacoesFiltradas = useMemo(() => {
    let lista = solicitacoes;
    if (filtroStatus !== 'TODOS') {
      lista = lista.filter((s) => s.status === filtroStatus);
    }
    if (filtroPortador !== 'TODOS') {
      lista = lista.filter(
        (s) =>
          String(s.cd_portador) === filtroPortador ||
          s.nm_portador === filtroPortador,
      );
    }
    return lista;
  }, [solicitacoes, filtroStatus, filtroPortador]);

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

  // Valor total selecionado
  const valorTotalSelecionado = useMemo(() => {
    return solicitacoesFiltradas
      .filter((s) => selectedItems.has(s.id))
      .reduce((acc, s) => acc + (parseFloat(s.vl_fatura) || 0), 0);
  }, [solicitacoesFiltradas, selectedItems]);

  // Selecionar/desselecionar item
  const toggleItem = (id) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Selecionar todos filtrados
  const toggleSelectAll = () => {
    const ids = solicitacoesFiltradas.map((s) => s.id);
    const allSelected =
      ids.length > 0 && ids.every((id) => selectedItems.has(id));
    if (allSelected) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(ids));
    }
  };

  // Aprovar solicitação
  const aprovarSolicitacao = async (id) => {
    try {
      const { error } = await supabaseAdmin
        .from('solicitacoes_baixa')
        .update({ status: 'aprovada' })
        .eq('id', id);

      if (error) throw error;
      await carregarSolicitacoes();
      setNotification({ type: 'success', message: 'Solicitação aprovada!' });
      setTimeout(() => setNotification(null), 3000);
    } catch (error) {
      console.error('Erro ao aprovar:', error);
      setNotification({
        type: 'error',
        message: 'Erro ao aprovar solicitação.',
      });
      setTimeout(() => setNotification(null), 3000);
    }
  };

  // Rejeitar solicitação
  const rejeitarSolicitacao = async () => {
    if (!modalRejeicao) return;
    try {
      const { error } = await supabaseAdmin
        .from('solicitacoes_baixa')
        .update({
          status: 'rejeitada',
          motivo_rejeicao: motivoRejeicao || 'Sem motivo informado',
        })
        .eq('id', modalRejeicao.id);

      if (error) throw error;
      setModalRejeicao(null);
      setMotivoRejeicao('');
      await carregarSolicitacoes();
      setNotification({ type: 'success', message: 'Solicitação rejeitada.' });
      setTimeout(() => setNotification(null), 3000);
    } catch (error) {
      console.error('Erro ao rejeitar:', error);
      setNotification({
        type: 'error',
        message: 'Erro ao rejeitar solicitação.',
      });
      setTimeout(() => setNotification(null), 3000);
    }
  };

  // Reprocessar solicitação individual (volta status para aprovada)
  const reprocessarSolicitacao = async (sol) => {
    if (
      !window.confirm(
        `Reprocessar fatura ${sol.nr_fat} do cliente ${sol.nm_cliente || sol.cd_cliente}?\n\nA solicitação voltará ao status "Aprovada" para ser processada novamente.`,
      )
    )
      return;
    try {
      const { error } = await supabaseAdmin
        .from('solicitacoes_baixa')
        .update({
          status: 'aprovada',
          processado_por: null,
          processado_em: null,
          forma_pagamento: null,
        })
        .eq('id', sol.id);

      if (error) throw error;
      await carregarSolicitacoes();
      setNotification({
        type: 'success',
        message: `Fatura ${sol.nr_fat} disponível para reprocessamento!`,
      });
      setTimeout(() => setNotification(null), 3000);
    } catch (error) {
      console.error('Erro ao reprocessar:', error);
      setNotification({
        type: 'error',
        message: 'Erro ao reprocessar solicitação.',
      });
      setTimeout(() => setNotification(null), 3000);
    }
  };

  // Reprocessar em lote (volta status das processadas selecionadas para aprovada)
  const reprocessarLote = async () => {
    const selecionadas = solicitacoesFiltradas.filter(
      (s) => selectedItems.has(s.id) && s.status === 'processada',
    );
    if (selecionadas.length === 0) {
      setNotification({
        type: 'error',
        message: 'Nenhuma solicitação processada selecionada.',
      });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    if (
      !window.confirm(
        `Reprocessar ${selecionadas.length} fatura(s)?\n\nElas voltarão ao status "Aprovada" para serem processadas novamente.`,
      )
    )
      return;

    setProcessingBaixa(true);
    let successCount = 0;

    try {
      for (const sol of selecionadas) {
        const { error } = await supabaseAdmin
          .from('solicitacoes_baixa')
          .update({
            status: 'aprovada',
            processado_por: null,
            processado_em: null,
            forma_pagamento: null,
          })
          .eq('id', sol.id);

        if (!error) successCount++;
      }

      await carregarSolicitacoes();
      setSelectedItems(new Set());
      setNotification({
        type: 'success',
        message: `${successCount} fatura(s) disponíveis para reprocessamento!`,
      });
      setTimeout(() => setNotification(null), 4000);
    } catch (error) {
      console.error('Erro ao reprocessar em lote:', error);
      setNotification({
        type: 'error',
        message: `Erro ao reprocessar: ${error.message}`,
      });
      setTimeout(() => setNotification(null), 5000);
    } finally {
      setProcessingBaixa(false);
    }
  };

  // Excluir solicitação
  const excluirSolicitacao = async (sol) => {
    if (!window.confirm(`Excluir solicitação da fatura ${sol.nr_fat}?`)) return;
    try {
      // Deletar arquivo do storage
      if (sol.comprovante_path) {
        await supabaseAdmin.storage
          .from('comprovantes_baixa')
          .remove([sol.comprovante_path]);
      }
      const { error } = await supabaseAdmin
        .from('solicitacoes_baixa')
        .delete()
        .eq('id', sol.id);
      if (error) throw error;
      await carregarSolicitacoes();
      setSelectedItems((prev) => {
        const next = new Set(prev);
        next.delete(sol.id);
        return next;
      });
      setNotification({ type: 'success', message: 'Solicitação excluída.' });
      setTimeout(() => setNotification(null), 3000);
    } catch (error) {
      console.error('Erro ao excluir:', error);
      setNotification({ type: 'error', message: 'Erro ao excluir.' });
      setTimeout(() => setNotification(null), 3000);
    }
  };

  // Processar baixa em lote via TOTVS
  const processarBaixaLote = async () => {
    const selecionadas = solicitacoesFiltradas.filter((s) =>
      selectedItems.has(s.id),
    );
    if (selecionadas.length === 0) return;

    const pendentes = selecionadas.filter(
      (s) => s.status === 'pendente' || s.status === 'aprovada',
    );
    if (pendentes.length === 0) {
      setNotification({
        type: 'error',
        message: 'Nenhuma solicitação pendente/aprovada selecionada.',
      });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    // Abrir modal de seleção de forma de pagamento
    setFormaPagamentoProcessamento('');
    setBancoSelecionado(null);
    setDadosCartaoProcessamento({ bandeira: '', autorizacao: '', nsu: '' });
    setModalPagamentoAberto(true);
  };

  // Confirmar processamento após selecionar forma de pagamento
  const confirmarProcessamento = async () => {
    if (!formaPagamentoProcessamento) {
      setNotification({
        type: 'error',
        message: 'Selecione a forma de pagamento.',
      });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    if (
      (formaPagamentoProcessamento === 'cartao_credito' ||
        formaPagamentoProcessamento === 'cartao_debito') &&
      (!dadosCartaoProcessamento.bandeira ||
        !dadosCartaoProcessamento.autorizacao ||
        !dadosCartaoProcessamento.nsu)
    ) {
      setNotification({
        type: 'error',
        message: 'Preencha todos os dados do cartão.',
      });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    const selecionadas = solicitacoesFiltradas.filter((s) =>
      selectedItems.has(s.id),
    );
    const pendentes = selecionadas.filter(
      (s) => s.status === 'pendente' || s.status === 'aprovada',
    );

    const formaSelecionada = FORMAS_PAGAMENTO.find(
      (f) => f.id === formaPagamentoProcessamento,
    );
    const formaLabel = formaSelecionada?.label || formaPagamentoProcessamento;
    setModalPagamentoAberto(false);

    if (
      !window.confirm(
        `Processar baixa de ${pendentes.length} fatura(s) no TOTVS?\n\nForma: ${formaLabel}\nValor total: ${valorTotalSelecionado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}\n\nEssa ação não pode ser desfeita.`,
      )
    )
      return;

    setProcessingBaixa(true);
    let successCount = 0;
    let errorCount = 0;

    try {
      const items = pendentes.map((s) => ({
        branchCode: s.cd_empresa,
        customerCode: s.cd_cliente,
        receivableCode: s.nr_fat,
        installmentCode: s.nr_parcela || 1,
        paidValue: parseFloat(s.vl_fatura) || 0,
        settlementDate: s.dt_pagamento || null,
      }));

      const response = await fetch(`${TotvsURL}invoices-settle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items,
          paidType: formaSelecionada?.paidType || 4,
          bank: formaSelecionada?.bank
            ? {
                bankNumber: formaSelecionada.bank.bankNumber,
                agencyNumber: formaSelecionada.bank.agencyNumber,
                account: formaSelecionada.bank.account,
              }
            : undefined,
          dadosCartao:
            formaPagamentoProcessamento === 'cartao_credito' ||
            formaPagamentoProcessamento === 'cartao_debito'
              ? dadosCartaoProcessamento
              : undefined,
        }),
      });

      const result = await response.json();

      // Atualizar status no Supabase baseado nos resultados
      if (result.results) {
        const jaProcessados = new Set();
        for (const r of result.results) {
          const sol = pendentes.find(
            (s) =>
              !jaProcessados.has(s.id) &&
              String(s.nr_fat) === String(r.receivableCode) &&
              String(s.cd_empresa) === String(r.branchCode) &&
              String(s.nr_parcela || 1) === String(r.installmentCode || 1),
          );
          if (sol) {
            jaProcessados.add(sol.id);
            await supabaseAdmin
              .from('solicitacoes_baixa')
              .update({
                status: 'processada',
                processado_por: user?.id || null,
                processado_em: new Date().toISOString(),
                forma_pagamento: formaPagamentoProcessamento || null,
              })
              .eq('id', sol.id);
            successCount++;
          }
        }
      }

      if (result.errors) {
        errorCount = result.errors.length;
      }

      await carregarSolicitacoes();
      setSelectedItems(new Set());

      if (errorCount === 0) {
        setNotification({
          type: 'success',
          message: `${successCount} baixa(s) processada(s) com sucesso!`,
        });
      } else {
        // Montar mensagem detalhada com erros traduzidos por fatura
        const detalhesErros = (result.errors || [])
          .map((err) => {
            const msgs =
              err.errorMessages && err.errorMessages.length > 0
                ? err.errorMessages.join('; ')
                : 'Erro desconhecido';
            return `Fatura ${err.receivableCode}: ${msgs}`;
          })
          .join('\n');

        setNotification({
          type: 'error',
          message: `${successCount} sucesso, ${errorCount} erro(s):\n${detalhesErros}`,
        });
      }
      setTimeout(() => setNotification(null), 8000);
    } catch (error) {
      console.error('Erro ao processar baixa em lote:', error);
      setNotification({ type: 'error', message: `Erro: ${error.message}` });
      setTimeout(() => setNotification(null), 5000);
    } finally {
      setProcessingBaixa(false);
    }
  };

  const formatarMoeda = (valor) =>
    parseFloat(valor || 0).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });

  const formatarData = (data) => {
    if (!data) return '--';
    // Evitar problema de timezone: parsear partes da string diretamente
    const str = String(data).split('T')[0]; // pegar só "YYYY-MM-DD"
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
        title="Solicitação de Baixa"
        subtitle="Gerencie solicitações de baixa de faturas"
        icon={Receipt}
        iconColor="text-indigo-600"
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
        <div className="flex items-center gap-2 flex-wrap">
          {/* Filtro por portador */}
          <div className="flex items-center gap-1 bg-white border rounded-lg px-2 py-1">
            <Bank size={14} className="text-gray-500" />
            <select
              value={filtroPortador}
              onChange={(e) => setFiltroPortador(e.target.value)}
              className="text-xs border-none bg-transparent focus:ring-0 pr-6"
            >
              <option value="TODOS">Todos Portadores</option>
              {portadoresUnicos.map(([key, name]) => (
                <option key={key} value={key}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={carregarSolicitacoes}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-[#000638] bg-white border rounded-lg hover:bg-gray-50 transition-colors"
          >
            <ArrowClockwise size={14} weight="bold" />
            Atualizar
          </button>
        </div>

        <div className="flex items-center gap-2">
          {selectedItems.size > 0 && (
            <span className="text-xs text-gray-500">
              {selectedItems.size} selecionada(s) —{' '}
              {formatarMoeda(valorTotalSelecionado)}
            </span>
          )}
          {selectedItems.size > 0 && filtroStatus !== 'processada' && (
            <button
              onClick={processarBaixaLote}
              disabled={processingBaixa}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-[#000638] hover:bg-[#fe0000] rounded-lg transition-colors disabled:opacity-50"
            >
              {processingBaixa ? (
                <>
                  <Spinner size={14} className="animate-spin" />
                  Processando...
                </>
              ) : (
                <>
                  <CheckCircle size={14} weight="bold" />
                  Processar Baixa ({selectedItems.size})
                </>
              )}
            </button>
          )}
          {selectedItems.size > 0 && filtroStatus === 'processada' && (
            <button
              onClick={reprocessarLote}
              disabled={processingBaixa}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-orange-500 hover:bg-orange-600 rounded-lg transition-colors disabled:opacity-50"
            >
              {processingBaixa ? (
                <>
                  <Spinner size={14} className="animate-spin" />
                  Reprocessando...
                </>
              ) : (
                <>
                  <ArrowClockwise size={14} weight="bold" />
                  Reprocessar ({selectedItems.size})
                </>
              )}
            </button>
          )}
        </div>
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
            Altere os filtros ou envie solicitações pela tela de Inadimplentes.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto bg-white rounded-xl border shadow-sm">
          <table className="min-w-full text-xs">
            <thead className="bg-[#000638] text-white sticky top-0">
              <tr>
                <th className="px-3 py-2.5 text-center w-8">
                  <input
                    type="checkbox"
                    className="accent-white cursor-pointer"
                    checked={
                      solicitacoesFiltradas.length > 0 &&
                      solicitacoesFiltradas.every((s) =>
                        selectedItems.has(s.id),
                      )
                    }
                    onChange={toggleSelectAll}
                  />
                </th>
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
                <th className="px-3 py-2.5 text-left font-semibold">
                  Solicitante
                </th>
                <th className="px-3 py-2.5 text-center font-semibold">Data</th>
                <th className="px-3 py-2.5 text-center font-semibold">
                  Comprovante
                </th>
                <th className="px-3 py-2.5 text-center font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody>
              {solicitacoesFiltradas.map((sol) => {
                const config =
                  statusConfig[sol.status] || statusConfig.pendente;
                const StatusIcon = config.icon;
                const isSelected = selectedItems.has(sol.id);
                return (
                  <tr
                    key={sol.id}
                    className={`border-b hover:bg-gray-50 transition-colors ${isSelected ? 'bg-blue-50' : ''}`}
                  >
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        className="accent-[#000638] cursor-pointer"
                        checked={isSelected}
                        onChange={() => toggleItem(sol.id)}
                      />
                    </td>
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
                      {editandoData === sol.id ? (
                        <input
                          type="date"
                          autoFocus
                          defaultValue={
                            sol.dt_pagamento
                              ? sol.dt_pagamento.split('T')[0]
                              : ''
                          }
                          max={new Date().toISOString().split('T')[0]}
                          className="border border-[#000638] rounded px-1.5 py-0.5 text-xs w-[120px] focus:ring-2 focus:ring-[#000638] focus:outline-none"
                          onBlur={async (e) => {
                            const novaData = e.target.value;
                            setEditandoData(null);
                            if (
                              novaData ===
                              (sol.dt_pagamento
                                ? sol.dt_pagamento.split('T')[0]
                                : '')
                            )
                              return;
                            try {
                              const { error } = await supabaseAdmin
                                .from('solicitacoes_baixa')
                                .update({ dt_pagamento: novaData || null })
                                .eq('id', sol.id);
                              if (error) throw error;
                              setSolicitacoes((prev) =>
                                prev.map((s) =>
                                  s.id === sol.id
                                    ? { ...s, dt_pagamento: novaData || null }
                                    : s,
                                ),
                              );
                              setNotification({
                                type: 'success',
                                message: `Data de pagamento ${novaData ? 'atualizada' : 'removida'}!`,
                              });
                              setTimeout(() => setNotification(null), 2000);
                            } catch (err) {
                              console.error('Erro ao atualizar data:', err);
                              setNotification({
                                type: 'error',
                                message: 'Erro ao salvar data.',
                              });
                              setTimeout(() => setNotification(null), 3000);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.target.blur();
                            if (e.key === 'Escape') setEditandoData(null);
                          }}
                        />
                      ) : (
                        <button
                          onClick={() => setEditandoData(sol.id)}
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold transition-colors ${
                            sol.dt_pagamento
                              ? 'text-green-700 hover:bg-green-50'
                              : 'text-orange-500 bg-orange-50 hover:bg-orange-100'
                          }`}
                          title="Clique para editar a data de pagamento"
                        >
                          {sol.dt_pagamento ? (
                            <>
                              <CalendarBlank size={12} />
                              {formatarData(sol.dt_pagamento)}
                              <PencilSimple size={10} className="opacity-50" />
                            </>
                          ) : (
                            <>
                              <CalendarBlank size={12} />
                              Definir
                            </>
                          )}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {editandoFormaPgto === sol.id ? (
                        <select
                          autoFocus
                          defaultValue={sol.forma_pagamento || ''}
                          className="border border-[#000638] rounded px-1 py-0.5 text-[10px] font-bold w-[110px] focus:ring-2 focus:ring-[#000638] focus:outline-none"
                          onBlur={async (e) => {
                            const novaForma = e.target.value;
                            setEditandoFormaPgto(null);
                            if (novaForma === (sol.forma_pagamento || ''))
                              return;
                            try {
                              const { error } = await supabaseAdmin
                                .from('solicitacoes_baixa')
                                .update({ forma_pagamento: novaForma || null })
                                .eq('id', sol.id);
                              if (error) throw error;
                              setSolicitacoes((prev) =>
                                prev.map((s) =>
                                  s.id === sol.id
                                    ? {
                                        ...s,
                                        forma_pagamento: novaForma || null,
                                      }
                                    : s,
                                ),
                              );
                              setNotification({
                                type: 'success',
                                message: `Forma de pagamento ${novaForma ? 'atualizada' : 'removida'}!`,
                              });
                              setTimeout(() => setNotification(null), 2000);
                            } catch (err) {
                              console.error(
                                'Erro ao atualizar forma pgto:',
                                err,
                              );
                              setNotification({
                                type: 'error',
                                message: 'Erro ao salvar forma de pagamento.',
                              });
                              setTimeout(() => setNotification(null), 3000);
                            }
                          }}
                          onChange={(e) => {
                            e.target.blur();
                          }}
                        >
                          <option value="">Selecione...</option>
                          {Object.entries(FORMAS_PAGAMENTO_LABELS).map(
                            ([key, label]) => (
                              <option key={key} value={key}>
                                {label}
                              </option>
                            ),
                          )}
                        </select>
                      ) : sol.forma_pagamento ? (
                        <button
                          onClick={() =>
                            sol.status === 'processada'
                              ? setEditandoFormaPgto(sol.id)
                              : null
                          }
                          className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${
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
                          } ${sol.status === 'processada' ? 'cursor-pointer hover:opacity-80' : ''}`}
                          title={
                            sol.status === 'processada'
                              ? 'Clique para alterar'
                              : ''
                          }
                        >
                          {FORMAS_PAGAMENTO_LABELS[sol.forma_pagamento] ||
                            sol.forma_pagamento}
                          {sol.status === 'processada' && (
                            <PencilSimple size={9} className="opacity-50" />
                          )}
                        </button>
                      ) : sol.status === 'processada' ? (
                        <button
                          onClick={() => setEditandoFormaPgto(sol.id)}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold text-orange-500 bg-orange-50 hover:bg-orange-100 cursor-pointer transition-colors"
                          title="Definir forma de pagamento"
                        >
                          <PencilSimple size={10} />
                          Definir
                        </button>
                      ) : (
                        <span className="text-[10px] text-gray-400">--</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className="bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded font-medium text-[10px]">
                        {sol.nm_portador || sol.cd_portador || '--'}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="font-medium">{sol.user_nome || '--'}</div>
                      <div className="text-[10px] text-gray-400">
                        {sol.user_email}
                      </div>
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
                      <div className="flex items-center justify-center gap-1">
                        {sol.status === 'pendente' && (
                          <>
                            <button
                              onClick={() => aprovarSolicitacao(sol.id)}
                              className="p-1 text-green-600 hover:bg-green-50 rounded transition-colors"
                              title="Aprovar"
                            >
                              <CheckCircle size={16} weight="bold" />
                            </button>
                            <button
                              onClick={() => {
                                setModalRejeicao(sol);
                                setMotivoRejeicao('');
                              }}
                              className="p-1 text-red-600 hover:bg-red-50 rounded transition-colors"
                              title="Rejeitar"
                            >
                              <XCircle size={16} weight="bold" />
                            </button>
                          </>
                        )}
                        {sol.status === 'processada' && (
                          <button
                            onClick={() => reprocessarSolicitacao(sol)}
                            className="p-1 text-orange-500 hover:bg-orange-50 rounded transition-colors"
                            title="Reprocessar"
                          >
                            <ArrowClockwise size={16} weight="bold" />
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

      {/* Observação se houver */}
      {solicitacoesFiltradas.some((s) => s.observacao) && (
        <div className="mt-3 text-xs text-gray-400">
          * Algumas solicitações possuem observações. Clique no comprovante para
          ver detalhes.
        </div>
      )}

      {/* Modal de Comprovante */}
      {modalComprovante && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-[#000638] text-white p-4 rounded-t-xl flex justify-between items-center">
              <h3 className="text-lg font-bold">
                Comprovante - Fatura {modalComprovante.nr_fat}
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
                {modalComprovante.observacao && (
                  <div className="col-span-2">
                    <span className="text-gray-500">Observação:</span>{' '}
                    <span className="font-medium">
                      {modalComprovante.observacao}
                    </span>
                  </div>
                )}
                {modalComprovante.motivo_rejeicao && (
                  <div className="col-span-2">
                    <span className="text-red-500 font-bold">
                      Motivo rejeição:
                    </span>{' '}
                    <span className="font-medium text-red-700">
                      {modalComprovante.motivo_rejeicao}
                    </span>
                  </div>
                )}
              </div>
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

      {/* Modal de Seleção de Forma de Pagamento */}
      {modalPagamentoAberto && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="bg-[#000638] text-white p-4 rounded-t-xl flex justify-between items-center">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <Bank size={20} weight="bold" />
                Forma de Pagamento
              </h3>
              <button
                onClick={() => {
                  setModalPagamentoAberto(false);
                  setFormaPagamentoProcessamento('');
                  setBancoSelecionado(null);
                  setDadosCartaoProcessamento({
                    bandeira: '',
                    autorizacao: '',
                    nsu: '',
                  });
                }}
                className="text-white hover:text-red-300"
              >
                <X size={22} weight="bold" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-600">
                Selecione a forma de pagamento para processar a baixa no TOTVS:
              </p>

              {/* Seleção da forma de pagamento */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">
                  Forma de Pagamento *
                </label>
                <select
                  value={formaPagamentoProcessamento}
                  onChange={(e) => {
                    setFormaPagamentoProcessamento(e.target.value);
                    setBancoSelecionado(null);
                    setDadosCartaoProcessamento({
                      bandeira: '',
                      autorizacao: '',
                      nsu: '',
                    });
                  }}
                  className="w-full border-2 rounded-lg px-3 py-2.5 text-sm font-semibold focus:ring-2 focus:ring-[#000638] focus:border-transparent"
                >
                  <option value="">Selecione...</option>
                  {FORMAS_PAGAMENTO.map((fp) => (
                    <option key={fp.id} value={fp.id}>
                      {fp.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Confiança / Sicredi info */}
              {(formaPagamentoProcessamento === 'confianca' ||
                formaPagamentoProcessamento === 'sicredi') && (
                <div
                  className={`${formaPagamentoProcessamento === 'confianca' ? 'bg-blue-50 border-blue-200' : 'bg-green-50 border-green-200'} border rounded-lg p-4`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Bank
                      size={18}
                      weight="bold"
                      className={
                        formaPagamentoProcessamento === 'confianca'
                          ? 'text-blue-700'
                          : 'text-green-700'
                      }
                    />
                    <p
                      className={`text-sm font-bold ${formaPagamentoProcessamento === 'confianca' ? 'text-blue-800' : 'text-green-800'}`}
                    >
                      {
                        FORMAS_PAGAMENTO.find(
                          (f) => f.id === formaPagamentoProcessamento,
                        )?.label
                      }
                    </p>
                  </div>
                  <div className="text-xs space-y-0.5 text-gray-600">
                    <p>
                      Banco:{' '}
                      <strong>
                        {
                          FORMAS_PAGAMENTO.find(
                            (f) => f.id === formaPagamentoProcessamento,
                          )?.bank?.bankNumber
                        }
                      </strong>
                    </p>
                    <p>
                      Agência:{' '}
                      <strong>
                        {
                          FORMAS_PAGAMENTO.find(
                            (f) => f.id === formaPagamentoProcessamento,
                          )?.bank?.agencyNumber
                        }
                      </strong>
                    </p>
                    <p>
                      Conta:{' '}
                      <strong>
                        {
                          FORMAS_PAGAMENTO.find(
                            (f) => f.id === formaPagamentoProcessamento,
                          )?.bank?.account
                        }
                      </strong>
                    </p>
                  </div>
                </div>
              )}

              {/* Adiantamento → PIX TOTVS */}
              {formaPagamentoProcessamento === 'adiantamento' && (
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 text-center">
                  <p className="text-sm font-bold text-purple-800">PIX TOTVS</p>
                  <p className="text-xs text-purple-600 mt-1">
                    O pagamento será registrado como adiantamento via PIX no
                    TOTVS.
                  </p>
                </div>
              )}

              {/* Cartão → Dados do cartão */}
              {(formaPagamentoProcessamento === 'cartao_credito' ||
                formaPagamentoProcessamento === 'cartao_debito') && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 space-y-3">
                  <p className="text-xs font-bold text-yellow-800">
                    Dados do{' '}
                    {formaPagamentoProcessamento === 'cartao_credito'
                      ? 'Cartão de Crédito'
                      : 'Cartão de Débito'}
                  </p>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-0.5">
                      Bandeira *
                    </label>
                    <input
                      type="text"
                      value={dadosCartaoProcessamento.bandeira}
                      onChange={(e) =>
                        setDadosCartaoProcessamento((prev) => ({
                          ...prev,
                          bandeira: e.target.value,
                        }))
                      }
                      placeholder="Ex: Visa, Mastercard, Elo..."
                      className="w-full border rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-[#000638]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-0.5">
                        Nº Autorização *
                      </label>
                      <input
                        type="text"
                        value={dadosCartaoProcessamento.autorizacao}
                        onChange={(e) =>
                          setDadosCartaoProcessamento((prev) => ({
                            ...prev,
                            autorizacao: e.target.value,
                          }))
                        }
                        placeholder="Nº autorização"
                        className="w-full border rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-[#000638]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-0.5">
                        NSU *
                      </label>
                      <input
                        type="text"
                        value={dadosCartaoProcessamento.nsu}
                        onChange={(e) =>
                          setDadosCartaoProcessamento((prev) => ({
                            ...prev,
                            nsu: e.target.value,
                          }))
                        }
                        placeholder="NSU"
                        className="w-full border rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-[#000638]"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* CREDEV */}
              {formaPagamentoProcessamento === 'credev' && (
                <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 text-center">
                  <p className="text-sm font-bold text-indigo-800">CREDEV</p>
                  <p className="text-xs text-indigo-600 mt-1">
                    O pagamento será registrado como CREDEV no TOTVS.
                  </p>
                </div>
              )}

              {/* Resumo */}
              {formaPagamentoProcessamento && (
                <div className="bg-gray-50 rounded-lg p-3 text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Forma:</span>
                    <span className="font-bold">
                      {
                        FORMAS_PAGAMENTO.find(
                          (f) => f.id === formaPagamentoProcessamento,
                        )?.label
                      }
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Faturas:</span>
                    <span className="font-semibold">{selectedItems.size}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Valor total:</span>
                    <span className="font-bold text-red-600">
                      {formatarMoeda(valorTotalSelecionado)}
                    </span>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => {
                    setModalPagamentoAberto(false);
                    setFormaPagamentoProcessamento('');
                    setBancoSelecionado(null);
                    setDadosCartaoProcessamento({
                      bandeira: '',
                      autorizacao: '',
                      nsu: '',
                    });
                  }}
                  className="px-4 py-2 text-sm font-bold text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmarProcessamento}
                  disabled={
                    !formaPagamentoProcessamento ||
                    ((formaPagamentoProcessamento === 'cartao_credito' ||
                      formaPagamentoProcessamento === 'cartao_debito') &&
                      (!dadosCartaoProcessamento.bandeira ||
                        !dadosCartaoProcessamento.autorizacao ||
                        !dadosCartaoProcessamento.nsu))
                  }
                  className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-[#000638] rounded-lg hover:bg-[#fe0000] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <CheckCircle size={16} weight="bold" />
                  Confirmar e Processar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Rejeição */}
      {modalRejeicao && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full">
            <div className="bg-red-600 text-white p-4 rounded-t-xl flex justify-between items-center">
              <h3 className="text-lg font-bold">Rejeitar Solicitação</h3>
              <button
                onClick={() => setModalRejeicao(null)}
                className="text-white hover:text-red-200"
              >
                <X size={22} weight="bold" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-600">
                Rejeitar baixa da fatura <strong>{modalRejeicao.nr_fat}</strong>{' '}
                do cliente <strong>{modalRejeicao.nm_cliente}</strong>?
              </p>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">
                  Motivo da rejeição
                </label>
                <textarea
                  value={motivoRejeicao}
                  onChange={(e) => setMotivoRejeicao(e.target.value)}
                  placeholder="Informe o motivo..."
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500"
                  rows={3}
                />
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setModalRejeicao(null)}
                  className="px-4 py-2 text-sm font-bold text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
                >
                  Cancelar
                </button>
                <button
                  onClick={rejeitarSolicitacao}
                  className="px-4 py-2 text-sm font-bold text-white bg-red-600 rounded-lg hover:bg-red-700"
                >
                  Confirmar Rejeição
                </button>
              </div>
            </div>
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

export default SolicitacaoBaixa;
