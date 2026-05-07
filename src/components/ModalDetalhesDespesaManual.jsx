import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Calendar,
  CurrencyDollar,
  FileText,
  Tag,
  PencilSimple,
  FloppyDisk,
  User,
  Eye,
  CaretDown,
  CaretRight,
  Note,
  Trash,
  ChatCircleText,
  PaperPlaneRight,
} from '@phosphor-icons/react';
import {
  editarDespesaManual,
  excluirDespesaManual,
} from '../services/despesasManuaisService';
import { salvarObservacaoDespesa } from '../services/observacoesDespesasService';
import { salvarObservacaoDespesaManual } from '../services/observacoesDespesasManuaisService';
import useApiClient from '../hooks/useApiClient';
import LoadingSpinner from './LoadingSpinner';
import { supabase } from '../lib/supabase';

const ModalDetalhesDespesaManual = ({
  modalDespManual,
  setModalDespManual,
  despesa,
  onSave,
  periodoAtual, // 🆕 Receber período atual para salvar observação
}) => {
  const api = useApiClient();
  const [modoEdicao, setModoEdicao] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [duplicatasExpandidas, setDuplicatasExpandidas] = useState(new Set());
  const [observacoesTotvs, setObservacoesTotvs] = useState({});
  const [loadingObservacoes, setLoadingObservacoes] = useState({});
  const [mostrarConfirmacaoExclusao, setMostrarConfirmacaoExclusao] =
    useState(false);
  const [excluindo, setExcluindo] = useState(false);

  // 🆕 Estados para o chat
  const [novaObservacao, setNovaObservacao] = useState('');
  const [salvandoObservacao, setSalvandoObservacao] = useState(false);
  const [observacoesRealtime, setObservacoesRealtime] = useState([]);
  const chatContainerRef = useRef(null);

  const [dadosEditados, setDadosEditados] = useState({
    nome: '',
    valor: 0,
    fornecedor: '',
    observacoes: '',
  });

  // 🆕 Detectar se é despesa manual ou TOTVS
  const isDespesaManual = despesa?._isDespesaManual || false;

  // 🆕 useEffect para inicializar observações e configurar real-time
  useEffect(() => {
    if (!despesa) return;

    // Inicializar com observações existentes
    const observacoesIniciais = despesa._observacoesHistorico || [];
    setObservacoesRealtime(observacoesIniciais);

    console.log(
      `🔄 Inicializando chat para ${
        isDespesaManual ? 'DESPESA MANUAL' : 'DESPESA TOTVS'
      }`,
    );
    console.log(
      `📊 ${observacoesIniciais.length} observações iniciais carregadas`,
    );

    // ⚠️ REAL-TIME APENAS PARA DESPESAS TOTVS
    if (isDespesaManual) {
      console.log('📝 Despesa manual: sem real-time (UPDATE simples)');
      return;
    }

    // 🟢 DESPESA TOTVS: Configurar real-time
    let channel;

    const primeiroTitulo =
      despesa._titulos && despesa._titulos.length > 0
        ? despesa._titulos[0]
        : null;

    const cd_empresa = despesa.cd_empresa || primeiroTitulo?.cd_empresa;
    const cd_despesaitem =
      despesa.cd_despesaitem || primeiroTitulo?.cd_despesaitem;
    const cd_fornecedor =
      despesa.cd_fornecedor || primeiroTitulo?.cd_fornecedor;
    const nr_duplicata =
      despesa.nr_duplicata || primeiroTitulo?.nr_duplicata || 'N/A';
    const nr_parcela = despesa.nr_parcela || primeiroTitulo?.nr_parcela || 0;

    if (!cd_empresa || !cd_fornecedor) {
      console.warn('⚠️ Dados insuficientes para configurar real-time TOTVS');
      return;
    }

    const filtro = `cd_empresa=eq.${cd_empresa},cd_despesaitem=eq.${cd_despesaitem},cd_fornecedor=eq.${cd_fornecedor},nr_duplicata=eq.${nr_duplicata},nr_parcela=eq.${nr_parcela}`;

    console.log('🟢 Configurando real-time TOTVS:', { filtro });

    channel = supabase
      .channel(
        `observacoes-totvs-${cd_empresa}-${cd_fornecedor}-${nr_duplicata}-${nr_parcela}`,
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'observacoes_despesas_totvs',
          filter: filtro,
        },
        async (payload) => {
          console.log(
            '✨ Nova observação TOTVS recebida via real-time:',
            payload,
          );

          // Buscar dados do usuário
          const { data: usuarioData } = await supabase
            .from('usuarios_view')
            .select('*')
            .eq('id', payload.new.cd_usuario)
            .single();

          const novaObservacaoCompleta = {
            ...payload.new,
            usuario: usuarioData || null,
          };

          // 🔥 EVITAR DUPLICAÇÃO: Verificar se já existe
          setObservacoesRealtime((prev) => {
            const jaExiste = prev.some(
              (obs) => obs.id === novaObservacaoCompleta.id,
            );
            if (jaExiste) {
              console.log(
                '⚠️ Observação já existe localmente, ignorando duplicação',
              );
              return prev;
            }
            console.log('✅ Adicionando observação via real-time');
            return [...prev, novaObservacaoCompleta];
          });

          // Scroll automático
          setTimeout(() => {
            if (chatContainerRef.current) {
              chatContainerRef.current.scrollTop =
                chatContainerRef.current.scrollHeight;
            }
          }, 100);
        },
      )
      .subscribe((status) => {
        console.log(`📡 Real-time TOTVS status: ${status}`);
        if (status === 'SUBSCRIBED') {
          console.log('✅ Real-time SUBSCRIBED! Canal ativo e escutando...');
          console.log('🔍 Filtro aplicado:', filtro);
        } else if (status === 'CHANNEL_ERROR') {
          console.error('❌ ERRO no canal de real-time!');
        } else if (status === 'TIMED_OUT') {
          console.error('⏱️ Timeout no real-time!');
        } else if (status === 'CLOSED') {
          console.warn('🔒 Canal de real-time fechado');
        }
      });

    // Cleanup
    return () => {
      if (channel) {
        console.log('🔌 Desconectando real-time...');
        supabase.removeChannel(channel);
      }
    };
  }, [despesa, isDespesaManual]);

  useEffect(() => {
    if (despesa) {
      console.log('📋 Despesa carregada no modal:', {
        ...despesa,
        isDespesaManual,
      });
      console.log(
        '🔍 Títulos encontrados:',
        despesa._titulos?.length || 0,
        despesa._titulos,
      );
      // Na tabela, 'fornecedor' é o nome principal da despesa
      setDadosEditados({
        nome: despesa.fornecedor || despesa.label || '',
        valor: Math.abs(despesa.valor || despesa.value || 0),
        fornecedor: despesa.fornecedor || '',
        observacoes: despesa.observacoes || despesa._observacaoTotvs || '',
      });
    }
  }, [despesa, isDespesaManual]);

  if (!despesa) return null;

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(Math.abs(value));
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  // 🆕 Função para adicionar observação TOTVS (com real-time)
  const handleAdicionarObservacaoTotvs = async () => {
    if (!novaObservacao.trim()) {
      setErro('Digite uma observação antes de enviar.');
      return;
    }

    if (!periodoAtual?.dt_inicio || !periodoAtual?.dt_fim) {
      setErro('Período atual não encontrado.');
      return;
    }

    try {
      setSalvandoObservacao(true);
      setErro('');

      const primeiroTitulo =
        despesa._titulos && despesa._titulos.length > 0
          ? despesa._titulos[0]
          : null;

      const dadosObservacao = {
        cd_empresa: despesa.cd_empresa || primeiroTitulo?.cd_empresa,
        cd_despesaitem:
          despesa.cd_despesaitem || primeiroTitulo?.cd_despesaitem,
        cd_fornecedor: despesa.cd_fornecedor || primeiroTitulo?.cd_fornecedor,
        nr_duplicata:
          despesa.nr_duplicata || primeiroTitulo?.nr_duplicata || 'N/A',
        nr_parcela: despesa.nr_parcela || primeiroTitulo?.nr_parcela || 0,
        observacao: novaObservacao.trim(),
        dt_inicio: periodoAtual.dt_inicio,
        dt_fim: periodoAtual.dt_fim,
      };

      console.log('💬 Salvando observação TOTVS:', dadosObservacao);

      const resultado = await salvarObservacaoDespesa(dadosObservacao);

      console.log('✅ Observação TOTVS salva:', resultado);

      // 🔥 ADICIONAR LOCALMENTE IMEDIATAMENTE (não esperar real-time)
      if (resultado.success && resultado.data) {
        const novaObservacaoLocal = {
          ...resultado.data,
          usuario: resultado.data.usuario || null,
        };

        setObservacoesRealtime((prev) => [...prev, novaObservacaoLocal]);

        // Scroll automático
        setTimeout(() => {
          if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop =
              chatContainerRef.current.scrollHeight;
          }
        }, 100);
      }

      setNovaObservacao('');
    } catch (error) {
      console.error('❌ Erro ao adicionar observação TOTVS:', error);
      setErro(
        error.message || 'Erro ao adicionar observação. Tente novamente.',
      );
    } finally {
      setSalvandoObservacao(false);
    }
  };

  // 🆕 Função para adicionar observação MANUAL (sem real-time)
  const handleAdicionarObservacaoManual = async () => {
    if (!novaObservacao.trim()) {
      setErro('Digite uma observação antes de enviar.');
      return;
    }

    const despesaId = despesa.id || despesa._idDespesaManual;
    if (!despesaId) {
      setErro('ID da despesa manual não encontrado.');
      return;
    }

    try {
      setSalvandoObservacao(true);
      setErro('');

      const dadosObservacao = {
        id: despesaId,
        observacao: novaObservacao.trim(),
      };

      console.log('💬 Salvando observação MANUAL:', dadosObservacao);

      const result = await salvarObservacaoDespesaManual(dadosObservacao);

      console.log('✅ Observação MANUAL salva');

      // Atualizar localmente (sem real-time)
      if (result.success && result.data) {
        setObservacoesRealtime([
          {
            id: result.data.id,
            observacao: result.data.observacoes,
            cd_usuario: result.data.cd_usuario,
            dt_alteracao: result.data.dt_alteracao,
            usuario: result.data.usuario,
            created_at: result.data.dt_alteracao,
          },
        ]);

        // Scroll automático
        setTimeout(() => {
          if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop =
              chatContainerRef.current.scrollHeight;
          }
        }, 100);
      }

      setNovaObservacao('');
    } catch (error) {
      console.error('❌ Erro ao adicionar observação MANUAL:', error);
      setErro(
        error.message || 'Erro ao adicionar observação. Tente novamente.',
      );
    } finally {
      setSalvandoObservacao(false);
    }
  };

  const handleInputChange = (field, value) => {
    setDadosEditados((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSalvar = async () => {
    try {
      setSalvando(true);
      setErro('');

      if (isDespesaManual) {
        // ============ DESPESA MANUAL: Edição completa ============
        const despesaId = despesa.id || despesa._idDespesaManual;

        if (!despesaId) {
          console.error('❌ Despesa manual sem ID:', despesa);
          throw new Error('ID da despesa manual não encontrado.');
        }

        console.log('💾 Salvando alterações da DESPESA MANUAL:', {
          id: despesaId,
          despesaCompleta: despesa,
          dados: dadosEditados,
        });

        // Preparar dados para envio (usar os nomes de campo corretos do banco)
        const dadosParaAtualizar = {
          fornecedor: dadosEditados.nome || dadosEditados.fornecedor,
          valor: dadosEditados.valor,
          observacoes: dadosEditados.observacoes || null,
        };

        // Chamar API para atualizar no Supabase
        const resultado = await editarDespesaManual(
          despesaId,
          dadosParaAtualizar,
        );

        console.log('✅ Despesa manual atualizada com sucesso:', resultado);
      } else {
        // ============ DESPESA TOTVS: Apenas salvar observação ============
        if (!periodoAtual?.dt_inicio || !periodoAtual?.dt_fim) {
          throw new Error('Período atual não encontrado.');
        }

        console.log('💾 Salvando OBSERVAÇÃO de despesa TOTVS:', {
          despesa,
          observacao: dadosEditados.observacoes,
          periodo: periodoAtual,
        });

        // Usar dados diretos da despesa (ou do primeiro título se for agregado)
        const primeiroTitulo =
          despesa._titulos && despesa._titulos.length > 0
            ? despesa._titulos[0]
            : null;

        const dadosObservacao = {
          cd_empresa: despesa.cd_empresa || primeiroTitulo?.cd_empresa,
          cd_despesaitem:
            despesa.cd_despesaitem || primeiroTitulo?.cd_despesaitem,
          cd_fornecedor: despesa.cd_fornecedor || primeiroTitulo?.cd_fornecedor,
          nr_duplicata:
            despesa.nr_duplicata || primeiroTitulo?.nr_duplicata || 'N/A',
          nr_parcela: despesa.nr_parcela || primeiroTitulo?.nr_parcela || 0,
          observacao: dadosEditados.observacoes,
          dt_inicio: periodoAtual.dt_inicio,
          dt_fim: periodoAtual.dt_fim,
        };

        console.log('📋 Dados da observação a serem salvos:', dadosObservacao);

        // Salvar observação
        const resultado = await salvarObservacaoDespesa(dadosObservacao);

        console.log('✅ Observação salva com sucesso:', resultado);

        // 🆕 Chamar callback com informações do usuário da observação
        if (onSave && resultado.data) {
          onSave({
            ...despesa,
            ...dadosEditados,
            value: -Math.abs(dadosEditados.valor),
            _observacaoTotvs: dadosEditados.observacoes,
            _usuarioObservacao: resultado.data.usuario,
            _dataObservacao: resultado.data.created_at,
            _dataAlteracaoObservacao: resultado.data.updated_at,
          });
        }
      }

      if (isDespesaManual) {
        // Para despesas manuais, chamar onSave aqui
        if (onSave) {
          onSave({
            ...despesa,
            ...dadosEditados,
            value: -Math.abs(dadosEditados.valor),
          });
        }
      }

      setModoEdicao(false);
      setModalDespManual(false);
    } catch (error) {
      console.error('❌ Erro ao salvar:', error);
      setErro(error.message || 'Erro ao salvar alterações. Tente novamente.');
    } finally {
      setSalvando(false);
    }
  };

  const handleCancelar = () => {
    // Restaurar dados originais
    setDadosEditados({
      nome: despesa.fornecedor || despesa.label || '',
      valor: Math.abs(despesa.valor || despesa.value || 0),
      fornecedor: despesa.fornecedor || '',
      observacoes: despesa.observacoes || despesa._observacaoTotvs || '',
    });
    setErro('');
    setModoEdicao(false);
  };

  // 🆕 Definir título baseado no tipo de despesa
  const getTitulo = () => {
    if (isDespesaManual) {
      return modoEdicao
        ? 'Editar Despesa Manual'
        : 'Detalhes da Despesa Manual';
    } else {
      return modoEdicao ? 'Adicionar Observação' : 'Detalhes da Despesa TOTVS';
    }
  };

  // 🆕 Função para alternar expansão de duplicatas
  const toggleDuplicata = (index) => {
    setDuplicatasExpandidas((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  };

  // 🆕 Função para buscar observação TOTVS de uma duplicata específica
  const buscarObservacaoTotvs = async (titulo, index) => {
    // Validar dados necessários
    if (
      !titulo.cd_empresa ||
      !titulo.cd_fornecedor ||
      !titulo.nr_duplicata ||
      titulo.nr_parcela === undefined
    ) {
      console.warn(
        '⚠️ Dados insuficientes para buscar observação TOTVS:',
        titulo,
      );
      return;
    }

    // Verificar se já está carregando
    if (loadingObservacoes[index]) {
      console.log('ℹ️ Já está carregando observação para índice:', index);
      return;
    }

    // Verificar se já tem observação carregada
    if (observacoesTotvs[index] !== undefined) {
      console.log('ℹ️ Observação já carregada para índice:', index);
      return;
    }

    setLoadingObservacoes((prev) => ({ ...prev, [index]: true }));

    try {
      console.log('🔍 Buscando observação TOTVS para duplicata:', {
        cd_empresa: titulo.cd_empresa,
        cd_fornecedor: titulo.cd_fornecedor,
        nr_duplicata: titulo.nr_duplicata,
        nr_parcela: titulo.nr_parcela,
      });

      // Fazer chamada para API
      const response = await api.financial.observacaoDuplicata({
        cd_empresa: titulo.cd_empresa,
        cd_fornecedor: titulo.cd_fornecedor,
        nr_duplicata: titulo.nr_duplicata,
        nr_parcela: titulo.nr_parcela,
      });

      console.log('📦 Resposta da API de observações:', response);

      // Extrair observação da resposta
      let observacao = '';
      if (response?.data?.ds_observacao) {
        observacao = response.data.ds_observacao;
      } else if (
        Array.isArray(response?.data) &&
        response.data.length > 0 &&
        response.data[0]?.ds_observacao
      ) {
        observacao = response.data[0].ds_observacao;
      }

      if (observacao && observacao.trim()) {
        console.log('✅ Observação TOTVS encontrada:', observacao);
        setObservacoesTotvs((prev) => ({
          ...prev,
          [index]: observacao.trim(),
        }));
      } else {
        console.log(
          'ℹ️ Nenhuma observação TOTVS encontrada para esta duplicata',
        );
        setObservacoesTotvs((prev) => ({ ...prev, [index]: null }));
      }
    } catch (error) {
      console.error('❌ Erro ao buscar observação TOTVS:', error);
      setObservacoesTotvs((prev) => ({ ...prev, [index]: null }));
    } finally {
      setLoadingObservacoes((prev) => ({ ...prev, [index]: false }));
    }
  };

  // 🆕 Função para excluir despesa manual
  const handleExcluir = async () => {
    try {
      setExcluindo(true);
      setErro('');

      const despesaId = despesa.id || despesa._idDespesaManual;

      if (!despesaId) {
        console.error('❌ Despesa sem ID:', despesa);
        throw new Error('ID da despesa não encontrado.');
      }

      console.log('🗑️ Excluindo despesa manual:', despesaId);

      // Chamar serviço de exclusão (desativa a despesa)
      const resultado = await excluirDespesaManual(despesaId);

      console.log('✅ Despesa excluída com sucesso:', resultado);

      // Chamar callback de sucesso (recarregar dados)
      if (onSave) {
        onSave({ ...despesa, ativo: false });
      }

      // Fechar modal
      setModalDespManual(false);
    } catch (error) {
      console.error('❌ Erro ao excluir despesa:', error);
      setErro(error.message || 'Erro ao excluir despesa. Tente novamente.');
      setMostrarConfirmacaoExclusao(false);
    } finally {
      setExcluindo(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-[#000638] to-[#000856] text-white px-6 py-4 rounded-t-lg flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isDespesaManual ? (
              <FileText size={24} weight="bold" />
            ) : (
              <Eye size={24} weight="bold" />
            )}
            <h2 className="text-xl font-bold">{getTitulo()}</h2>
          </div>
          <div className="flex items-center gap-2">
            {!modoEdicao && (
              <>
                <button
                  onClick={() => setModoEdicao(true)}
                  className="hover:bg-white/20 rounded-full p-2 transition-colors"
                  title="Editar"
                >
                  <PencilSimple size={24} weight="bold" />
                </button>
                {/* 🆕 Botão de Exclusão - Apenas para despesas manuais */}
                {isDespesaManual && (
                  <button
                    onClick={() => setMostrarConfirmacaoExclusao(true)}
                    className="hover:bg-red-500/20 rounded-full p-2 transition-colors"
                    title="Excluir despesa"
                  >
                    <Trash size={24} weight="bold" />
                  </button>
                )}
              </>
            )}
            <button
              onClick={() => {
                setModoEdicao(false);
                setModalDespManual(false);
              }}
              className="hover:bg-white/20 rounded-full p-2 transition-colors"
              title="Fechar"
            >
              <X size={24} weight="bold" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Tipo de Despesa Badge */}
          <div className="flex items-center gap-2">
            <span
              className={`px-3 py-1 rounded-full text-xs font-bold ${
                isDespesaManual
                  ? 'bg-blue-100 text-blue-800'
                  : 'bg-purple-100 text-purple-800'
              }`}
            >
              {isDespesaManual ? '✏️ DESPESA MANUAL' : '📊 DESPESA TOTVS'}
            </span>
          </div>

          {/* Título/Label */}
          <div className="border-b border-gray-200 pb-4">
            <label className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2 block">
              Descrição / Nome da Despesa
            </label>
            {modoEdicao && isDespesaManual ? (
              <input
                type="text"
                value={dadosEditados.nome}
                onChange={(e) => handleInputChange('nome', e.target.value)}
                className="w-full text-2xl font-bold text-gray-900 border-2 border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:border-[#000638] transition-colors"
                placeholder="Nome da despesa"
              />
            ) : (
              <h3 className="text-2xl font-bold text-gray-900">
                {despesa.fornecedor || despesa.label}
              </h3>
            )}
          </div>

          {/* Detalhes em Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Valor */}
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
              <div className="flex items-center gap-2 mb-2">
                <CurrencyDollar
                  size={20}
                  weight="bold"
                  className="text-[#000638]"
                />
                <label className="text-sm font-semibold text-gray-600">
                  Valor
                </label>
              </div>
              {modoEdicao && isDespesaManual ? (
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold text-red-600">R$</span>
                  <input
                    type="number"
                    step="0.01"
                    value={dadosEditados.valor}
                    onChange={(e) =>
                      handleInputChange(
                        'valor',
                        parseFloat(e.target.value) || 0,
                      )
                    }
                    className="w-full text-xl font-bold text-red-600 border-2 border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-[#000638] transition-colors"
                    placeholder="0.00"
                  />
                </div>
              ) : (
                <p
                  className={`text-2xl font-bold ${
                    (despesa.valor || despesa.value) >= 0
                      ? 'text-green-600'
                      : 'text-red-600'
                  }`}
                >
                  {(despesa.valor || despesa.value) < 0 && '-'}
                  {formatCurrency(despesa.valor || despesa.value)}
                </p>
              )}
            </div>

            {/* ID */}
            {despesa.id && (
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <div className="flex items-center gap-2 mb-2">
                  <Tag size={20} weight="bold" className="text-[#000638]" />
                  <label className="text-sm font-semibold text-gray-600">
                    ID
                  </label>
                </div>
                <p className="text-xl font-mono text-gray-900">{despesa.id}</p>
              </div>
            )}

            {/* Data de Emissão */}
            {despesa.dt_emissao && (
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <div className="flex items-center gap-2 mb-2">
                  <Calendar
                    size={20}
                    weight="bold"
                    className="text-[#000638]"
                  />
                  <label className="text-sm font-semibold text-gray-600">
                    Data de Emissão
                  </label>
                </div>
                <p className="text-lg text-gray-900">
                  {formatDate(despesa.dt_emissao)}
                </p>
              </div>
            )}

            {/* Data de Vencimento */}
            {despesa.dt_vencimento && (
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <div className="flex items-center gap-2 mb-2">
                  <Calendar
                    size={20}
                    weight="bold"
                    className="text-[#000638]"
                  />
                  <label className="text-sm font-semibold text-gray-600">
                    Data de Vencimento
                  </label>
                </div>
                <p className="text-lg text-gray-900">
                  {formatDate(despesa.dt_vencimento)}
                </p>
              </div>
            )}
          </div>

          {/* 🆕 Seção: Duplicatas Detalhadas - Somente para despesas TOTVS com múltiplas duplicatas */}
          {!isDespesaManual &&
            despesa._titulos &&
            despesa._titulos.length > 0 && (
              <div className="border-t border-gray-200 pt-4">
                <h4 className="text-sm font-bold text-gray-700 mb-3 uppercase tracking-wider flex items-center gap-2">
                  <FileText
                    size={18}
                    weight="bold"
                    className="text-[#000638]"
                  />
                  Duplicatas Detalhadas ({despesa._titulos.length})
                </h4>
                <div className="space-y-2">
                  {despesa._titulos.map((titulo, index) => {
                    const isExpanded = duplicatasExpandidas.has(index);
                    const duplicataId = `${titulo.nr_duplicata}-${titulo.nr_parcela}`;

                    return (
                      <div
                        key={index}
                        className="border border-gray-300 rounded-lg overflow-hidden"
                      >
                        {/* Header da Duplicata - Sempre visível */}
                        <div className="w-full bg-gradient-to-r from-blue-50 to-blue-100 px-4 py-3 flex items-center justify-between">
                          <div className="flex items-center gap-3 flex-1">
                            {/* Botão de expandir/colapsar */}
                            <button
                              onClick={() => toggleDuplicata(index)}
                              className="p-1 hover:bg-blue-200 rounded transition-colors"
                              title={isExpanded ? 'Recolher' : 'Expandir'}
                            >
                              {isExpanded ? (
                                <CaretDown
                                  size={20}
                                  weight="bold"
                                  className="text-[#000638]"
                                />
                              ) : (
                                <CaretRight
                                  size={20}
                                  weight="bold"
                                  className="text-[#000638]"
                                />
                              )}
                            </button>

                            {/* 🆕 Botão de Observação TOTVS */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                buscarObservacaoTotvs(titulo, index);
                              }}
                              className={`p-1.5 rounded transition-colors ${
                                observacoesTotvs[index]
                                  ? 'bg-blue-500 hover:bg-blue-600 text-white'
                                  : 'bg-white hover:bg-blue-200 text-gray-600 border border-gray-300'
                              }`}
                              disabled={loadingObservacoes[index]}
                              title={
                                observacoesTotvs[index]
                                  ? 'Ver observação TOTVS'
                                  : loadingObservacoes[index]
                                  ? 'Carregando...'
                                  : 'Buscar observação TOTVS'
                              }
                            >
                              {loadingObservacoes[index] ? (
                                <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
                              ) : (
                                <Note
                                  size={16}
                                  weight={
                                    observacoesTotvs[index] ? 'fill' : 'regular'
                                  }
                                />
                              )}
                            </button>

                            {/* Informações da duplicata */}
                            <div className="flex-1">
                              <p className="text-sm font-bold text-gray-900">
                                Duplicata {titulo.nr_duplicata} - Parcela{' '}
                                {titulo.nr_parcela}
                              </p>
                              <p className="text-xs text-gray-600">
                                Empresa: {titulo.cd_empresa}
                              </p>
                            </div>
                          </div>

                          <div className="text-right ml-3">
                            <p className="text-base font-bold text-[#000638]">
                              {formatCurrency(titulo.vl_duplicata)}
                            </p>
                            {titulo.vl_pago > 0 && (
                              <p className="text-xs text-green-600 font-semibold">
                                Pago: {formatCurrency(titulo.vl_pago)}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* 🆕 Exibir Observação TOTVS se existir */}
                        {observacoesTotvs[index] && (
                          <div className="mx-3 mt-2 p-3 bg-blue-50 border-l-4 border-blue-500 rounded-r">
                            <div className="flex items-start gap-2">
                              <Note
                                size={18}
                                weight="fill"
                                className="text-blue-600 mt-0.5 flex-shrink-0"
                              />
                              <div className="flex-1">
                                <p className="text-xs font-semibold text-blue-900 mb-1">
                                  📋 Observação TOTVS
                                </p>
                                <p className="text-sm text-blue-800 whitespace-pre-wrap">
                                  {observacoesTotvs[index]}
                                </p>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Mensagem quando não há observação */}
                        {observacoesTotvs[index] === null && (
                          <div className="mx-3 mt-2 p-2 bg-gray-50 border-l-4 border-gray-300 rounded-r">
                            <p className="text-xs text-gray-500 italic">
                              ℹ️ Nenhuma observação TOTVS encontrada para esta
                              duplicata
                            </p>
                          </div>
                        )}

                        {/* Detalhes da Duplicata - Expansível */}
                        {isExpanded && (
                          <div className="bg-white p-4 border-t border-gray-200">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                              {/* Datas */}
                              {titulo.dt_emissao && (
                                <div className="bg-gray-50 rounded p-2 border border-gray-200">
                                  <label className="text-xs font-semibold text-gray-500 block mb-1">
                                    Emissão
                                  </label>
                                  <p className="text-sm text-gray-900">
                                    {formatDate(titulo.dt_emissao)}
                                  </p>
                                </div>
                              )}
                              {titulo.dt_vencimento && (
                                <div className="bg-gray-50 rounded p-2 border border-gray-200">
                                  <label className="text-xs font-semibold text-gray-500 block mb-1">
                                    Vencimento
                                  </label>
                                  <p className="text-sm text-gray-900">
                                    {formatDate(titulo.dt_vencimento)}
                                  </p>
                                </div>
                              )}
                              {titulo.dt_entrada && (
                                <div className="bg-gray-50 rounded p-2 border border-gray-200">
                                  <label className="text-xs font-semibold text-gray-500 block mb-1">
                                    Entrada
                                  </label>
                                  <p className="text-sm text-gray-900">
                                    {formatDate(titulo.dt_entrada)}
                                  </p>
                                </div>
                              )}
                              {titulo.dt_liq && (
                                <div className="bg-gray-50 rounded p-2 border border-gray-200">
                                  <label className="text-xs font-semibold text-gray-500 block mb-1">
                                    Liquidação
                                  </label>
                                  <p className="text-sm text-gray-900">
                                    {formatDate(titulo.dt_liq)}
                                  </p>
                                </div>
                              )}

                              {/* Valores Financeiros */}
                              {titulo.vl_rateio > 0 && (
                                <div className="bg-blue-50 rounded p-2 border border-blue-200">
                                  <label className="text-xs font-semibold text-blue-700 block mb-1">
                                    Rateio
                                  </label>
                                  <p className="text-sm font-bold text-blue-900">
                                    {formatCurrency(titulo.vl_rateio)}
                                  </p>
                                </div>
                              )}
                              {titulo.vl_juros > 0 && (
                                <div className="bg-red-50 rounded p-2 border border-red-200">
                                  <label className="text-xs font-semibold text-red-700 block mb-1">
                                    Juros
                                  </label>
                                  <p className="text-sm font-bold text-red-900">
                                    {formatCurrency(titulo.vl_juros)}
                                  </p>
                                </div>
                              )}
                              {titulo.vl_acrescimo > 0 && (
                                <div className="bg-red-50 rounded p-2 border border-red-200">
                                  <label className="text-xs font-semibold text-red-700 block mb-1">
                                    Acréscimo
                                  </label>
                                  <p className="text-sm font-bold text-red-900">
                                    {formatCurrency(titulo.vl_acrescimo)}
                                  </p>
                                </div>
                              )}
                              {titulo.vl_desconto > 0 && (
                                <div className="bg-green-50 rounded p-2 border border-green-200">
                                  <label className="text-xs font-semibold text-green-700 block mb-1">
                                    Desconto
                                  </label>
                                  <p className="text-sm font-bold text-green-900">
                                    {formatCurrency(titulo.vl_desconto)}
                                  </p>
                                </div>
                              )}

                              {/* Identificadores */}
                              {titulo.cd_ccusto && (
                                <div className="bg-gray-50 rounded p-2 border border-gray-200">
                                  <label className="text-xs font-semibold text-gray-500 block mb-1">
                                    Centro de Custo
                                  </label>
                                  <p className="text-sm text-gray-900">
                                    {titulo.cd_ccusto}
                                  </p>
                                </div>
                              )}
                              {titulo.nr_portador && (
                                <div className="bg-gray-50 rounded p-2 border border-gray-200">
                                  <label className="text-xs font-semibold text-gray-500 block mb-1">
                                    Portador
                                  </label>
                                  <p className="text-sm text-gray-900">
                                    {titulo.nr_portador}
                                  </p>
                                </div>
                              )}

                              {/* Status */}
                              {titulo.tp_situacao && (
                                <div className="bg-purple-50 rounded p-2 border border-purple-200">
                                  <label className="text-xs font-semibold text-purple-700 block mb-1">
                                    Situação
                                  </label>
                                  <p className="text-sm text-purple-900">
                                    {titulo.tp_situacao}
                                  </p>
                                </div>
                              )}
                              {titulo.tp_estagio && (
                                <div className="bg-purple-50 rounded p-2 border border-purple-200">
                                  <label className="text-xs font-semibold text-purple-700 block mb-1">
                                    Estágio
                                  </label>
                                  <p className="text-sm text-purple-900">
                                    {titulo.tp_estagio}
                                  </p>
                                </div>
                              )}
                            </div>

                            {/* Observação específica desta duplicata */}
                            {titulo._observacao && (
                              <div className="mt-3 bg-yellow-50 rounded p-3 border border-yellow-200">
                                <label className="text-xs font-semibold text-yellow-800 block mb-1">
                                  📝 Observação
                                </label>
                                <p className="text-sm text-yellow-900">
                                  {titulo._observacao}
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

          {/* 🆕 Seção: Chat de Observações */}
          <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
            <div className="flex items-center gap-2 mb-3">
              <ChatCircleText
                size={20}
                weight="bold"
                className="text-blue-900"
              />
              <label className="text-sm font-semibold text-blue-900 uppercase tracking-wider">
                {isDespesaManual ? 'Observação' : 'Chat de Observações'}
              </label>
              {!isDespesaManual && observacoesRealtime.length > 0 && (
                <span className="ml-auto bg-blue-600 text-white text-xs px-2 py-1 rounded-full">
                  {observacoesRealtime.length}
                </span>
              )}
            </div>

            {/* Container do Chat */}
            <div
              ref={chatContainerRef}
              className="bg-white rounded-lg border border-blue-200 p-3 mb-3 max-h-64 overflow-y-auto space-y-3"
            >
              {observacoesRealtime.length === 0 ? (
                <div className="text-center text-gray-400 py-8">
                  <ChatCircleText
                    size={48}
                    weight="light"
                    className="mx-auto mb-2 opacity-50"
                  />
                  <p className="text-sm">
                    {isDespesaManual
                      ? 'Sem observações'
                      : 'Nenhuma mensagem ainda. Seja o primeiro a comentar!'}
                  </p>
                </div>
              ) : (
                observacoesRealtime.map((obs, index) => {
                  const nomeUsuario =
                    obs.usuario?.name ||
                    obs.usuario?.nome_completo ||
                    obs.usuario?.email?.split('@')[0] ||
                    'Usuário';
                  const dataHora = obs.created_at
                    ? new Date(obs.created_at).toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : obs.dt_alteracao
                    ? new Date(obs.dt_alteracao).toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '';

                  return (
                    <div
                      key={obs.id || index}
                      className="bg-gray-50 rounded-lg p-3 border border-gray-200"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-8 h-8 rounded-full bg-[#000638] flex items-center justify-center text-white text-sm font-bold">
                          {nomeUsuario.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-gray-900">
                            {nomeUsuario}
                          </p>
                          {dataHora && (
                            <p className="text-xs text-gray-500">{dataHora}</p>
                          )}
                        </div>
                      </div>
                      <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                        {obs.observacao}
                      </p>
                    </div>
                  );
                })
              )}
            </div>

            {/* Input para nova observação */}
            <div className="flex gap-2">
              <textarea
                value={novaObservacao}
                onChange={(e) => setNovaObservacao(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (isDespesaManual) {
                      handleAdicionarObservacaoManual();
                    } else {
                      handleAdicionarObservacaoTotvs();
                    }
                  }
                }}
                rows={2}
                className="flex-1 text-sm text-gray-700 border-2 border-blue-300 rounded-lg px-3 py-2 focus:outline-none focus:border-[#000638] transition-colors resize-none"
                placeholder={
                  isDespesaManual
                    ? 'Adicione uma observação...'
                    : 'Digite sua mensagem... (Enter para enviar, Shift+Enter para quebrar linha)'
                }
                disabled={salvandoObservacao}
              />
              <button
                onClick={
                  isDespesaManual
                    ? handleAdicionarObservacaoManual
                    : handleAdicionarObservacaoTotvs
                }
                disabled={salvandoObservacao || !novaObservacao.trim()}
                className="bg-[#000638] text-white px-4 py-2 rounded-lg hover:bg-[#000856] transition-colors font-semibold shadow-md flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed self-end"
              >
                {salvandoObservacao ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <PaperPlaneRight size={20} weight="bold" />
                )}
              </button>
            </div>
          </div>

          {/* 🆕 Seção: Informações de Auditoria */}
          {(despesa.usuario || despesa._usuarioObservacao) && (
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
              <div className="flex items-center gap-2 mb-3">
                <User size={18} weight="bold" className="text-[#000638]" />
                <label className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
                  Informações de Auditoria
                </label>
              </div>
              <div className="space-y-2 text-sm text-gray-600">
                {/* Informações de despesa manual */}
                {isDespesaManual && despesa.usuario && (
                  <>
                    <p>
                      <span className="font-semibold">Criado por:</span>{' '}
                      {despesa.usuario.raw_user_meta_data?.full_name ||
                        despesa.usuario.email ||
                        'Usuário desconhecido'}
                      {despesa.dt_cadastro && (
                        <span className="text-gray-500">
                          {' '}
                          em{' '}
                          {new Date(despesa.dt_cadastro).toLocaleString(
                            'pt-BR',
                            {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            },
                          )}
                        </span>
                      )}
                    </p>
                    {despesa.dt_alteracao &&
                      despesa.dt_alteracao !== despesa.dt_cadastro && (
                        <p>
                          <span className="font-semibold">
                            Última alteração:
                          </span>{' '}
                          {despesa.usuario.raw_user_meta_data?.full_name ||
                            despesa.usuario.email ||
                            'Usuário desconhecido'}
                          <span className="text-gray-500">
                            {' '}
                            em{' '}
                            {new Date(despesa.dt_alteracao).toLocaleString(
                              'pt-BR',
                              {
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              },
                            )}
                          </span>
                        </p>
                      )}
                  </>
                )}

                {/* Informações de observação TOTVS */}
                {!isDespesaManual && despesa._usuarioObservacao && (
                  <>
                    <p>
                      <span className="font-semibold">
                        Observação criada por:
                      </span>{' '}
                      {despesa._usuarioObservacao.raw_user_meta_data
                        ?.full_name ||
                        despesa._usuarioObservacao.email ||
                        'Usuário desconhecido'}
                      {despesa._dataObservacao && (
                        <span className="text-gray-500">
                          {' '}
                          em{' '}
                          {new Date(despesa._dataObservacao).toLocaleString(
                            'pt-BR',
                            {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            },
                          )}
                        </span>
                      )}
                    </p>
                    {despesa._dataAlteracaoObservacao &&
                      despesa._dataAlteracaoObservacao !==
                        despesa._dataObservacao && (
                        <p>
                          <span className="font-semibold">
                            Última alteração da observação:
                          </span>{' '}
                          {despesa._usuarioObservacao.raw_user_meta_data
                            ?.full_name ||
                            despesa._usuarioObservacao.email ||
                            'Usuário desconhecido'}
                          <span className="text-gray-500">
                            {' '}
                            em{' '}
                            {new Date(
                              despesa._dataAlteracaoObservacao,
                            ).toLocaleString('pt-BR', {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </p>
                      )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* Detalhes Adicionais - Somente para despesas TOTVS SEM detalhamento de duplicatas */}
          {!isDespesaManual &&
            (!despesa._titulos || despesa._titulos.length === 0) && (
              <>
                {/* Seção: Identificação */}
                <div className="border-t border-gray-200 pt-4">
                  <h4 className="text-sm font-bold text-gray-700 mb-3 uppercase tracking-wider">
                    📋 Identificação
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {despesa.cd_empresa && (
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                        <label className="text-xs font-semibold text-gray-500 mb-1 block">
                          Empresa
                        </label>
                        <p className="text-sm font-medium text-gray-900">
                          {despesa.cd_empresa}
                        </p>
                      </div>
                    )}
                    {despesa.cd_despesaitem && (
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                        <label className="text-xs font-semibold text-gray-500 mb-1 block">
                          Item Despesa
                        </label>
                        <p className="text-sm font-medium text-gray-900">
                          {despesa.cd_despesaitem}
                        </p>
                      </div>
                    )}
                    {despesa.cd_fornecedor && (
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                        <label className="text-xs font-semibold text-gray-500 mb-1 block">
                          Cód. Fornecedor
                        </label>
                        <p className="text-sm font-medium text-gray-900">
                          {despesa.cd_fornecedor}
                        </p>
                      </div>
                    )}
                    {despesa.cd_ccusto && (
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                        <label className="text-xs font-semibold text-gray-500 mb-1 block">
                          Centro de Custo
                        </label>
                        <p className="text-sm font-medium text-gray-900">
                          {despesa.cd_ccusto}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Seção: Documento */}
                <div className="border-t border-gray-200 pt-4">
                  <h4 className="text-sm font-bold text-gray-700 mb-3 uppercase tracking-wider">
                    📄 Documento
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {despesa.nr_duplicata && (
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                        <label className="text-xs font-semibold text-gray-500 mb-1 block">
                          Nº Duplicata
                        </label>
                        <p className="text-sm font-medium text-gray-900">
                          {despesa.nr_duplicata}
                        </p>
                      </div>
                    )}
                    {despesa.nr_parcela !== undefined && (
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                        <label className="text-xs font-semibold text-gray-500 mb-1 block">
                          Nº Parcela
                        </label>
                        <p className="text-sm font-medium text-gray-900">
                          {despesa.nr_parcela}
                        </p>
                      </div>
                    )}
                    {despesa.nr_portador && (
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                        <label className="text-xs font-semibold text-gray-500 mb-1 block">
                          Nº Portador
                        </label>
                        <p className="text-sm font-medium text-gray-900">
                          {despesa.nr_portador}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Seção: Datas */}
                <div className="border-t border-gray-200 pt-4">
                  <h4 className="text-sm font-bold text-gray-700 mb-3 uppercase tracking-wider">
                    📅 Datas
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {despesa.dt_entrada && (
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                        <label className="text-xs font-semibold text-gray-500 mb-1 block">
                          Data Entrada
                        </label>
                        <p className="text-sm font-medium text-gray-900">
                          {formatDate(despesa.dt_entrada)}
                        </p>
                      </div>
                    )}
                    {despesa.dt_liq && (
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                        <label className="text-xs font-semibold text-gray-500 mb-1 block">
                          Data Liquidação
                        </label>
                        <p className="text-sm font-medium text-gray-900">
                          {formatDate(despesa.dt_liq)}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Seção: Valores Financeiros */}
                <div className="border-t border-gray-200 pt-4">
                  <h4 className="text-sm font-bold text-gray-700 mb-3 uppercase tracking-wider">
                    💰 Valores Financeiros
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {despesa.vl_duplicata !== undefined && (
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                        <label className="text-xs font-semibold text-gray-500 mb-1 block">
                          Valor Duplicata
                        </label>
                        <p className="text-sm font-bold text-gray-900">
                          {formatCurrency(despesa.vl_duplicata)}
                        </p>
                      </div>
                    )}
                    {despesa.vl_rateio !== undefined && (
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                        <label className="text-xs font-semibold text-gray-500 mb-1 block">
                          Valor Rateio
                        </label>
                        <p className="text-sm font-bold text-gray-900">
                          {formatCurrency(despesa.vl_rateio)}
                        </p>
                      </div>
                    )}
                    {despesa.vl_pago !== undefined && (
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                        <label className="text-xs font-semibold text-gray-500 mb-1 block">
                          Valor Pago
                        </label>
                        <p className="text-sm font-bold text-green-600">
                          {formatCurrency(despesa.vl_pago)}
                        </p>
                      </div>
                    )}
                    {despesa.vl_juros !== undefined &&
                      despesa.vl_juros !== 0 && (
                        <div className="bg-red-50 rounded-lg p-3 border border-red-200">
                          <label className="text-xs font-semibold text-red-700 mb-1 block">
                            Juros
                          </label>
                          <p className="text-sm font-bold text-red-600">
                            {formatCurrency(despesa.vl_juros)}
                          </p>
                        </div>
                      )}
                    {despesa.vl_acrescimo !== undefined &&
                      despesa.vl_acrescimo !== 0 && (
                        <div className="bg-red-50 rounded-lg p-3 border border-red-200">
                          <label className="text-xs font-semibold text-red-700 mb-1 block">
                            Acréscimo
                          </label>
                          <p className="text-sm font-bold text-red-600">
                            {formatCurrency(despesa.vl_acrescimo)}
                          </p>
                        </div>
                      )}
                    {despesa.vl_desconto !== undefined &&
                      despesa.vl_desconto !== 0 && (
                        <div className="bg-green-50 rounded-lg p-3 border border-green-200">
                          <label className="text-xs font-semibold text-green-700 mb-1 block">
                            Desconto
                          </label>
                          <p className="text-sm font-bold text-green-600">
                            {formatCurrency(despesa.vl_desconto)}
                          </p>
                        </div>
                      )}
                  </div>
                </div>

                {/* Seção: Status */}
                <div className="border-t border-gray-200 pt-4">
                  <h4 className="text-sm font-bold text-gray-700 mb-3 uppercase tracking-wider">
                    ✅ Status
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {despesa.tp_situacao && (
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                        <label className="text-xs font-semibold text-gray-500 mb-1 block">
                          Situação
                        </label>
                        <p className="text-sm font-medium text-gray-900">
                          {despesa.tp_situacao === 'N'
                            ? 'Normal'
                            : despesa.tp_situacao}
                        </p>
                      </div>
                    )}
                    {despesa.tp_estagio && (
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                        <label className="text-xs font-semibold text-gray-500 mb-1 block">
                          Estágio
                        </label>
                        <p className="text-sm font-medium text-gray-900">
                          {despesa.tp_estagio}
                        </p>
                      </div>
                    )}
                    {despesa.tp_previsaoreal && (
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                        <label className="text-xs font-semibold text-gray-500 mb-1 block">
                          Previsão/Real
                        </label>
                        <p className="text-sm font-medium text-gray-900">
                          {despesa.tp_previsaoreal === '2'
                            ? 'Real'
                            : despesa.tp_previsaoreal}
                        </p>
                      </div>
                    )}
                    {despesa.in_aceite !== undefined &&
                      despesa.in_aceite !== null && (
                        <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                          <label className="text-xs font-semibold text-gray-500 mb-1 block">
                            Aceite
                          </label>
                          <p className="text-sm font-medium text-gray-900">
                            {despesa.in_aceite || 'Não informado'}
                          </p>
                        </div>
                      )}
                  </div>
                </div>
              </>
            )}
        </div>

        {/* Mensagem de Erro */}
        {erro && (
          <div className="mx-6 mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-700">{erro}</p>
          </div>
        )}

        {/* Footer */}
        <div className="bg-gray-50 px-6 py-4 rounded-b-lg flex justify-between items-center border-t border-gray-200">
          {salvando ? (
            <div className="w-full flex items-center justify-center py-2">
              <LoadingSpinner size="sm" text="Salvando alterações..." />
            </div>
          ) : modoEdicao ? (
            <>
              <button
                onClick={handleCancelar}
                className="bg-gray-400 text-white px-6 py-2.5 rounded-lg hover:bg-gray-500 transition-colors font-semibold shadow-md flex items-center gap-2"
                disabled={salvando}
              >
                <X size={20} weight="bold" />
                Cancelar
              </button>
              <button
                onClick={handleSalvar}
                className="bg-green-600 text-white px-6 py-2.5 rounded-lg hover:bg-green-700 transition-colors font-semibold shadow-md flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={salvando}
              >
                <FloppyDisk size={20} weight="bold" />
                Salvar Alterações
              </button>
            </>
          ) : (
            <button
              onClick={() => setModalDespManual(false)}
              className="bg-[#000638] text-white px-6 py-2.5 rounded-lg hover:bg-[#000856] transition-colors font-semibold shadow-md flex items-center gap-2 ml-auto"
            >
              <X size={20} weight="bold" />
              Fechar
            </button>
          )}
        </div>
      </div>

      {/* 🆕 Modal de Confirmação de Exclusão */}
      {mostrarConfirmacaoExclusao && (
        <div className="fixed inset-0 z-[60] bg-black bg-opacity-70 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-2xl max-w-md w-full">
            {/* Header do Modal de Confirmação */}
            <div className="bg-red-600 text-white px-6 py-4 rounded-t-lg flex items-center gap-3">
              <Trash size={24} weight="bold" />
              <h3 className="text-lg font-bold">Confirmar Exclusão</h3>
            </div>

            {/* Conteúdo */}
            <div className="p-6">
              <p className="text-gray-700 mb-4">
                Tem certeza que deseja excluir esta despesa manual?
              </p>
              <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-4">
                <div className="flex items-start gap-2">
                  <span className="text-yellow-600 text-xl">⚠️</span>
                  <div>
                    <p className="text-sm font-semibold text-yellow-800 mb-1">
                      Atenção
                    </p>
                    <p className="text-sm text-yellow-700">
                      A despesa será desativada e não aparecerá mais nos
                      relatórios. Esta ação pode ser revertida reativando a
                      despesa.
                    </p>
                  </div>
                </div>
              </div>

              {/* Informações da Despesa */}
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 mb-4">
                <p className="text-sm text-gray-600 mb-1">Despesa:</p>
                <p className="font-bold text-gray-900 mb-2">
                  {despesa.fornecedor || despesa.label}
                </p>
                <p className="text-sm text-gray-600 mb-1">Valor:</p>
                <p className="font-bold text-red-600">
                  {formatCurrency(despesa.valor || despesa.value)}
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="bg-gray-50 px-6 py-4 rounded-b-lg flex justify-end gap-3">
              <button
                onClick={() => setMostrarConfirmacaoExclusao(false)}
                className="bg-gray-400 text-white px-6 py-2.5 rounded-lg hover:bg-gray-500 transition-colors font-semibold shadow-md flex items-center gap-2"
                disabled={excluindo}
              >
                <X size={20} weight="bold" />
                Cancelar
              </button>
              <button
                onClick={handleExcluir}
                className="bg-red-600 text-white px-6 py-2.5 rounded-lg hover:bg-red-700 transition-colors font-semibold shadow-md flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={excluindo}
              >
                {excluindo ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Excluindo...
                  </>
                ) : (
                  <>
                    <Trash size={20} weight="bold" />
                    Confirmar Exclusão
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ModalDetalhesDespesaManual;
