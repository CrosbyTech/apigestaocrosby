import React, { useState, useEffect } from 'react';
import PageTitle from '../components/ui/PageTitle';
import FiltroEmpresa from '../components/FiltroEmpresa';
import { supabase } from '../lib/supabase';
import { useAuth } from '../components/AuthContext';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/cards';
import {
  CheckCircle,
  XCircle,
  Eye,
  Funnel,
  CalendarBlank,
  CurrencyDollar,
  User,
  Receipt,
  Spinner,
  Handshake,
  ArrowsLeftRight,
  X,
  PaperPlaneRight,
} from '@phosphor-icons/react';

export default function AnaliseCredito() {
  const { user } = useAuth();
  const [solicitacoes, setSolicitacoes] = useState([]);
  const [loadingSolicitacoes, setLoadingSolicitacoes] = useState(false);
  const [empresasFiltro, setEmpresasFiltro] = useState([]);
  const [statusFiltro, setStatusFiltro] = useState('todos');
  const [idFiltro, setIdFiltro] = useState('');
  const [pagamentoFiltro, setPagamentoFiltro] = useState('todos');
  const [modalDetalhesAberto, setModalDetalhesAberto] = useState(false);
  const [solicitacaoSelecionada, setSolicitacaoSelecionada] = useState(null);
  const [processando, setProcessando] = useState(false);

  // Estados para contraproposta
  const [modalContrapropostaAberto, setModalContrapropostaAberto] =
    useState(false);
  const [valorContraproposta, setValorContraproposta] = useState('');
  const [formaPagamentoContraproposta, setFormaPagamentoContraproposta] =
    useState('');
  const [parcelasContraproposta, setParcelasContraproposta] = useState('1');
  const [observacaoContraproposta, setObservacaoContraproposta] = useState('');

  const buscarSolicitacoes = async () => {
    setLoadingSolicitacoes(true);
    try {
      let query = supabase
        .from('solicitacoes_credito')
        .select('*')
        .order('dt_solicitacao', { ascending: false });

      // Aplicar filtro de empresa se houver
      if (empresasFiltro.length > 0) {
        const empresasCodigos = empresasFiltro.map((e) => String(e.cd_empresa));
        query = query.in('cd_empresa', empresasCodigos);
      }

      // Aplicar filtro de status se não for 'todos'
      if (statusFiltro !== 'todos') {
        query = query.eq('status', statusFiltro);
      }

      // Aplicar filtro de ID se houver
      if (idFiltro.trim()) {
        query = query.ilike('id', `%${idFiltro.trim()}%`);
      }

      // Aplicar filtro de forma de pagamento se não for 'todos'
      if (pagamentoFiltro !== 'todos') {
        query = query.eq('forma_pagamento', pagamentoFiltro);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Erro ao buscar solicitações:', error);
        alert('Erro ao carregar solicitações');
        return;
      }

      console.log('📋 Solicitações encontradas:', data);
      setSolicitacoes(data || []);
    } catch (error) {
      console.error('Erro ao buscar solicitações:', error);
    } finally {
      setLoadingSolicitacoes(false);
    }
  };

  useEffect(() => {
    buscarSolicitacoes();
  }, [empresasFiltro, statusFiltro, idFiltro, pagamentoFiltro]);

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatMoney = (value) => {
    if (!value) return 'R$ 0,00';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const abrirDetalhes = (solicitacao) => {
    setSolicitacaoSelecionada(solicitacao);
    setModalDetalhesAberto(true);
  };

  const aprovarSolicitacao = async (id) => {
    if (!window.confirm('Deseja realmente APROVAR esta solicitação?')) {
      return;
    }

    setProcessando(true);
    try {
      const { error } = await supabase
        .from('solicitacoes_credito')
        .update({
          status: 'APROVADO',
          dt_aprovacao: new Date().toISOString(),
          aprovado_por: user?.id,
          user_aprovador: user?.name || user?.email,
          motivo_reprovacao: null,
        })
        .eq('id', id);

      if (error) {
        console.error('Erro ao aprovar solicitação:', error);
        alert('Erro ao aprovar solicitação');
        return;
      }

      alert('Solicitação aprovada com sucesso!');
      buscarSolicitacoes(); // Recarregar lista
      setModalDetalhesAberto(false);
    } catch (error) {
      console.error('Erro ao aprovar:', error);
      alert('Erro ao processar aprovação');
    } finally {
      setProcessando(false);
    }
  };

  const reprovarSolicitacao = async (id) => {
    const motivo = window.prompt(
      'Informe o motivo da reprovação (obrigatório):',
    );

    if (!motivo || motivo.trim() === '') {
      alert('Motivo da reprovação é obrigatório');
      return;
    }

    setProcessando(true);
    try {
      const { error } = await supabase
        .from('solicitacoes_credito')
        .update({
          status: 'REPROVADO',
          dt_aprovacao: new Date().toISOString(),
          aprovado_por: user?.id,
          user_aprovador: user?.name || user?.email,
          motivo_reprovacao: motivo.trim(),
        })
        .eq('id', id);

      if (error) {
        console.error('Erro ao reprovar solicitação:', error);
        alert('Erro ao reprovar solicitação');
        return;
      }

      alert('Solicitação reprovada!');
      buscarSolicitacoes(); // Recarregar lista
      setModalDetalhesAberto(false);
    } catch (error) {
      console.error('Erro ao reprovar:', error);
      alert('Erro ao processar reprovação');
    } finally {
      setProcessando(false);
    }
  };

  const abrirModalContraproposta = (solicitacao) => {
    setSolicitacaoSelecionada(solicitacao);
    setValorContraproposta(solicitacao.vl_credito.toString());
    setFormaPagamentoContraproposta(solicitacao.forma_pagamento);
    setParcelasContraproposta(solicitacao.nr_parcelas?.toString() || '1');
    setObservacaoContraproposta('');
    setModalContrapropostaAberto(true);
  };

  const enviarContraproposta = async () => {
    if (!solicitacaoSelecionada) return;

    // Validações
    if (!valorContraproposta || parseFloat(valorContraproposta) <= 0) {
      alert('Informe um valor válido para a contraproposta');
      return;
    }

    if (!formaPagamentoContraproposta) {
      alert('Selecione uma forma de pagamento');
      return;
    }

    if (
      !observacaoContraproposta.trim() ||
      observacaoContraproposta.trim().length < 10
    ) {
      alert(
        'Informe uma observação para a contraproposta (mínimo 10 caracteres)',
      );
      return;
    }

    setProcessando(true);
    try {
      const valorFloat = parseFloat(valorContraproposta);
      const nrParcelas = ['boleto', 'credito'].includes(
        formaPagamentoContraproposta,
      )
        ? parseInt(parcelasContraproposta)
        : 1;
      const valorParcela = valorFloat / nrParcelas;

      const contraproposta = {
        vl_credito: valorFloat,
        forma_pagamento: formaPagamentoContraproposta,
        nr_parcelas: nrParcelas,
        vl_parcela: valorParcela,
        observacao: observacaoContraproposta.trim(),
        dt_envio: new Date().toISOString(),
        enviado_por: user?.id,
        user_aprovador: user?.name || user?.email,
      };

      // Adicionar ao histórico
      const historicoAtual = solicitacaoSelecionada.historico_negociacao || [];
      const novoHistorico = [
        ...historicoAtual,
        {
          tipo: 'CONTRAPROPOSTA',
          vl_credito: valorFloat,
          forma_pagamento: formaPagamentoContraproposta,
          nr_parcelas: nrParcelas,
          dt: new Date().toISOString(),
          user: user?.name || user?.email,
          observacao: observacaoContraproposta.trim(),
        },
      ];

      const { error } = await supabase
        .from('solicitacoes_credito')
        .update({
          status: 'CONTRAPROPOSTA',
          contraproposta: contraproposta,
          historico_negociacao: novoHistorico,
        })
        .eq('id', solicitacaoSelecionada.id);

      if (error) {
        console.error('Erro ao enviar contraproposta:', error);
        alert('Erro ao enviar contraproposta');
        return;
      }

      alert(
        'Contraproposta enviada com sucesso! O franqueado será notificado.',
      );
      buscarSolicitacoes();
      setModalContrapropostaAberto(false);
      setModalDetalhesAberto(false);

      // Limpar campos
      setValorContraproposta('');
      setFormaPagamentoContraproposta('');
      setParcelasContraproposta('1');
      setObservacaoContraproposta('');
    } catch (error) {
      console.error('Erro ao enviar contraproposta:', error);
      alert('Erro ao processar contraproposta');
    } finally {
      setProcessando(false);
    }
  };

  const formatCurrency = (value) => {
    const number = parseFloat(value.replace(/\D/g, '')) / 100;
    return number.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const handleValorContrapropostaChange = (e) => {
    const formatted = formatCurrency(e.target.value);
    setValorContraproposta(formatted);
  };

  // Calcular estatísticas
  const empresasUnicas = [...new Set(solicitacoes.map((s) => s.cd_empresa))]
    .length;
  const valorTotal = solicitacoes.reduce(
    (sum, s) => sum + (s.vl_credito || 0),
    0,
  );

  // Calcular por status
  const aprovadas = solicitacoes.filter((s) => s.status === 'APROVADO');
  const reprovadas = solicitacoes.filter((s) => s.status === 'REPROVADO');
  const emAnalise = solicitacoes.filter((s) => s.status === 'ANALISE');

  const valorAprovado = aprovadas.reduce(
    (sum, s) => sum + (s.vl_credito || 0),
    0,
  );
  const valorReprovado = reprovadas.reduce(
    (sum, s) => sum + (s.vl_credito || 0),
    0,
  );
  const valorEmAnalise = emAnalise.reduce(
    (sum, s) => sum + (s.vl_credito || 0),
    0,
  );

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <PageTitle
        title="Análise de Crédito"
        subtitle="Gerencie e analise as solicitações de crédito das franquias"
      />

      <div className="max-w-7xl mx-auto">
        {/* Filtros */}
        <div className="flex flex-col bg-white p-3 rounded-lg shadow-md border border-[#000638]/10 mb-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {/* Filtro Empresa */}
            <div>
              <FiltroEmpresa
                empresasSelecionadas={empresasFiltro}
                onSelectEmpresas={setEmpresasFiltro}
              />
            </div>

            {/* Filtro Status */}
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Status
              </label>
              <select
                value={statusFiltro}
                onChange={(e) => setStatusFiltro(e.target.value)}
                className="w-full px-2 py-1.5 text-xs border border-[#000638]/30 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638]"
              >
                <option value="todos">TODOS</option>
                <option value="ANALISE">EM ANÁLISE</option>
                <option value="CONTRAPROPOSTA">CONTRAPROPOSTA</option>
                <option value="APROVADO">APROVADO</option>
                <option value="REPROVADO">REPROVADO</option>
              </select>
            </div>

            {/* Filtro ID */}
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                ID da Solicitação
              </label>
              <input
                type="text"
                value={idFiltro}
                onChange={(e) => setIdFiltro(e.target.value)}
                placeholder="Digite o ID..."
                className="w-full px-2 py-1.5 text-xs border border-[#000638]/30 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638]"
              />
            </div>

            {/* Filtro Forma de Pagamento */}
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Forma de Pagamento
              </label>
              <select
                value={pagamentoFiltro}
                onChange={(e) => setPagamentoFiltro(e.target.value)}
                className="w-full px-2 py-1.5 text-xs border border-[#000638]/30 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638]"
              >
                <option value="todos">TODOS</option>
                <option value="boleto">BOLETO</option>
                <option value="credito">CRÉDITO</option>
                <option value="debito">DÉBITO</option>
                <option value="dinheiro">DINHEIRO</option>
                <option value="pix">PIX</option>
              </select>
            </div>
          </div>
        </div>

        {/* Cards de Estatísticas */}
        {solicitacoes.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-6 gap-2 mb-6 max-w-7xl mx-auto">
            {/* Card: Franquias que Solicitaram */}
            <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <User size={14} className="text-blue-600" />
                  <CardTitle className="text-xs font-bold text-blue-700">
                    Franquias
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-2 pb-2">
                <div className="text-sm font-extrabold text-blue-600 mb-0.5 break-words">
                  {empresasUnicas}
                </div>
                <CardDescription className="text-xs text-gray-500">
                  {empresasUnicas === 1
                    ? 'franquia solicitou'
                    : 'franquias solicitaram'}
                </CardDescription>
              </CardContent>
            </Card>

            {/* Card: Valor Total */}
            <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <CurrencyDollar size={14} className="text-green-600" />
                  <CardTitle className="text-xs font-bold text-green-700">
                    Valor Total
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-2 pb-2">
                <div className="text-sm font-extrabold text-green-600 mb-0.5 break-words">
                  {formatMoney(valorTotal)}
                </div>
                <CardDescription className="text-xs text-gray-500">
                  Valor total solicitado
                </CardDescription>
              </CardContent>
            </Card>

            {/* Card: Total de Solicitações */}
            <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Receipt size={14} className="text-purple-600" />
                  <CardTitle className="text-xs font-bold text-purple-700">
                    Solicitações
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-2 pb-2">
                <div className="text-sm font-extrabold text-purple-600 mb-0.5 break-words">
                  {solicitacoes.length}
                </div>
                <CardDescription className="text-xs text-gray-500">
                  {solicitacoes.length === 1
                    ? 'solicitação total'
                    : 'solicitações totais'}
                </CardDescription>
              </CardContent>
            </Card>

            {/* Card: Aprovados */}
            <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <CheckCircle size={14} className="text-emerald-600" />
                  <CardTitle className="text-xs font-bold text-emerald-700">
                    Aprovados
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-2 pb-2">
                <div className="text-sm font-extrabold text-emerald-600 mb-0.5 break-words">
                  {formatMoney(valorAprovado)}
                </div>
                <CardDescription className="text-xs text-gray-500">
                  {aprovadas.length}{' '}
                  {aprovadas.length === 1 ? 'aprovada' : 'aprovadas'}
                </CardDescription>
              </CardContent>
            </Card>

            {/* Card: Reprovados */}
            <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <XCircle size={14} className="text-red-600" />
                  <CardTitle className="text-xs font-bold text-red-700">
                    Reprovados
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-2 pb-2">
                <div className="text-sm font-extrabold text-red-600 mb-0.5 break-words">
                  {formatMoney(valorReprovado)}
                </div>
                <CardDescription className="text-xs text-gray-500">
                  {reprovadas.length}{' '}
                  {reprovadas.length === 1 ? 'reprovada' : 'reprovadas'}
                </CardDescription>
              </CardContent>
            </Card>

            {/* Card: Em Análise */}
            <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Spinner size={14} className="text-yellow-600" />
                  <CardTitle className="text-xs font-bold text-yellow-700">
                    Em Análise
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-2 pb-2">
                <div className="text-sm font-extrabold text-yellow-600 mb-0.5 break-words">
                  {formatMoney(valorEmAnalise)}
                </div>
                <CardDescription className="text-xs text-gray-500">
                  {emAnalise.length}{' '}
                  {emAnalise.length === 1 ? 'em análise' : 'em análise'}
                </CardDescription>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Tabela de Solicitações */}
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          {loadingSolicitacoes ? (
            <div className="flex justify-center items-center p-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#000638]"></div>
            </div>
          ) : solicitacoes.length === 0 ? (
            <div className="text-center p-12">
              <Receipt size={48} className="mx-auto text-gray-300 mb-4" />
              <p className="text-gray-500 font-medium">
                Nenhuma solicitação encontrada
              </p>
              <p className="text-gray-400 text-sm mt-2">
                As solicitações de crédito aparecerão aqui
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-[#000638] text-white">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase">
                      Data
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase">
                      Franquia
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase">
                      Solicitante
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase">
                      Valor
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase">
                      Pagamento
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold uppercase">
                      Parcelas
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold uppercase">
                      Status
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold uppercase">
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {solicitacoes.map((solicitacao, index) => (
                    <tr
                      key={solicitacao.id}
                      className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                    >
                      <td className="px-4 py-3 text-sm text-gray-700">
                        <div className="flex items-center gap-2">
                          <CalendarBlank size={16} className="text-gray-400" />
                          {formatDate(solicitacao.dt_solicitacao)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 font-medium">
                        <div>
                          {solicitacao.nm_empresa ||
                            `Empresa ${solicitacao.cd_empresa}`}
                        </div>
                        <div className="text-xs text-gray-500">
                          Cód: {solicitacao.cd_empresa}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        <div className="flex items-center gap-2">
                          <User size={16} className="text-gray-400" />
                          <div>
                            <div className="font-medium">
                              {solicitacao.user_nome || 'N/A'}
                            </div>
                            <div className="text-xs text-gray-500">
                              {solicitacao.user_email}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 font-bold text-right">
                        {formatMoney(solicitacao.vl_credito)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 capitalize">
                        {solicitacao.forma_pagamento}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 text-center">
                        {solicitacao.nr_parcelas}x
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${
                            solicitacao.status === 'APROVADO'
                              ? 'bg-green-100 text-green-700'
                              : solicitacao.status === 'REPROVADO'
                              ? 'bg-red-100 text-red-700'
                              : solicitacao.status === 'CONTRAPROPOSTA'
                              ? 'bg-orange-100 text-orange-700'
                              : 'bg-yellow-100 text-yellow-700'
                          }`}
                        >
                          {solicitacao.status === 'ANALISE'
                            ? 'Em Análise'
                            : solicitacao.status === 'CONTRAPROPOSTA'
                            ? 'Contraproposta'
                            : solicitacao.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => abrirDetalhes(solicitacao)}
                            className="text-[#000638] hover:bg-gray-100 p-2 rounded-lg transition-colors"
                            title="Ver detalhes"
                          >
                            <Eye size={20} weight="bold" />
                          </button>
                          <button
                            onClick={() => aprovarSolicitacao(solicitacao.id)}
                            className="text-green-600 hover:bg-green-50 p-2 rounded-lg transition-colors"
                            title="Aprovar"
                            disabled={processando}
                          >
                            <CheckCircle size={20} weight="bold" />
                          </button>
                          <button
                            onClick={() => reprovarSolicitacao(solicitacao.id)}
                            className="text-red-600 hover:bg-red-50 p-2 rounded-lg transition-colors"
                            title="Reprovar"
                            disabled={processando}
                          >
                            <XCircle size={20} weight="bold" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Modal de Detalhes */}
      {modalDetalhesAberto && solicitacaoSelecionada && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="sticky top-0 bg-[#000638] text-white p-6 rounded-t-lg">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold">Detalhes da Solicitação</h3>
                <button
                  onClick={() => setModalDetalhesAberto(false)}
                  className="text-white hover:text-gray-300 transition-colors"
                >
                  <XCircle size={28} weight="bold" />
                </button>
              </div>
              <p className="text-sm text-gray-300 mt-1">
                ID: {solicitacaoSelecionada.id}
              </p>
            </div>

            {/* Conteúdo */}
            <div className="p-6 space-y-6">
              {/* Informações Principais */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h4 className="text-sm font-semibold text-gray-500 mb-1">
                    Franquia
                  </h4>
                  <p className="text-lg font-bold text-[#000638]">
                    {solicitacaoSelecionada.nm_empresa ||
                      `Empresa ${solicitacaoSelecionada.cd_empresa}`}
                  </p>
                  <p className="text-sm text-gray-600">
                    Código: {solicitacaoSelecionada.cd_empresa}
                  </p>
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-gray-500 mb-1">
                    Solicitante
                  </h4>
                  <p className="text-lg font-medium text-gray-700">
                    {solicitacaoSelecionada.user_nome || 'N/A'}
                  </p>
                  <p className="text-sm text-gray-600">
                    {solicitacaoSelecionada.user_email}
                  </p>
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-gray-500 mb-1">
                    Valor Solicitado
                  </h4>
                  <p className="text-2xl font-bold text-green-600">
                    {formatMoney(solicitacaoSelecionada.vl_credito)}
                  </p>
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-gray-500 mb-1">
                    Data da Solicitação
                  </h4>
                  <p className="text-lg font-medium text-gray-700">
                    {formatDate(solicitacaoSelecionada.dt_solicitacao)}
                  </p>
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-gray-500 mb-1">
                    Forma de Pagamento
                  </h4>
                  <p className="text-lg font-medium text-gray-700 capitalize">
                    {solicitacaoSelecionada.forma_pagamento}
                  </p>
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-gray-500 mb-1">
                    Parcelamento
                  </h4>
                  <p className="text-lg font-medium text-gray-700">
                    {solicitacaoSelecionada.nr_parcelas}x
                  </p>
                </div>
              </div>

              {/* Motivo */}
              <div>
                <h4 className="text-sm font-semibold text-gray-500 mb-2">
                  Motivo da Solicitação
                </h4>
                <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                  <p className="text-gray-700 whitespace-pre-wrap">
                    {solicitacaoSelecionada.motivo}
                  </p>
                </div>
              </div>

              {/* Títulos Vencidos */}
              {solicitacaoSelecionada.titulos_vencidos &&
                solicitacaoSelecionada.titulos_vencidos.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-red-600 mb-2">
                      ⚠️ Títulos Vencidos (
                      {solicitacaoSelecionada.titulos_vencidos.length})
                    </h4>
                    <div className="bg-red-50 p-4 rounded-lg border border-red-200 max-h-60 overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-red-200">
                            <th className="text-left pb-2">Nº Fatura</th>
                            <th className="text-left pb-2">Vencimento</th>
                            <th className="text-right pb-2">Valor</th>
                          </tr>
                        </thead>
                        <tbody>
                          {solicitacaoSelecionada.titulos_vencidos.map(
                            (titulo, idx) => (
                              <tr key={idx} className="border-b border-red-100">
                                <td className="py-2">
                                  {titulo.nr_fat}/{titulo.nr_parcela}
                                </td>
                                <td className="py-2">
                                  {new Date(
                                    titulo.dt_vencimento,
                                  ).toLocaleDateString('pt-BR')}
                                </td>
                                <td className="text-right py-2 font-medium">
                                  {formatMoney(titulo.vl_fatura)}
                                </td>
                              </tr>
                            ),
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

              {/* Títulos a Vencer */}
              {solicitacaoSelecionada.titulos_a_vencer &&
                solicitacaoSelecionada.titulos_a_vencer.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-blue-600 mb-2">
                      📅 Títulos a Vencer (
                      {solicitacaoSelecionada.titulos_a_vencer.length})
                    </h4>
                    <div className="bg-blue-50 p-4 rounded-lg border border-blue-200 max-h-60 overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-blue-200">
                            <th className="text-left pb-2">Nº Fatura</th>
                            <th className="text-left pb-2">Vencimento</th>
                            <th className="text-right pb-2">Valor</th>
                          </tr>
                        </thead>
                        <tbody>
                          {solicitacaoSelecionada.titulos_a_vencer.map(
                            (titulo, idx) => (
                              <tr
                                key={idx}
                                className="border-b border-blue-100"
                              >
                                <td className="py-2">
                                  {titulo.nr_fat}/{titulo.nr_parcela}
                                </td>
                                <td className="py-2">
                                  {new Date(
                                    titulo.dt_vencimento,
                                  ).toLocaleDateString('pt-BR')}
                                </td>
                                <td className="text-right py-2 font-medium">
                                  {formatMoney(titulo.vl_fatura)}
                                </td>
                              </tr>
                            ),
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

              {/* Status e Motivo de Reprovação */}
              {solicitacaoSelecionada.status === 'REPROVADO' &&
                solicitacaoSelecionada.motivo_reprovacao && (
                  <div>
                    <h4 className="text-sm font-semibold text-red-600 mb-2">
                      Motivo da Reprovação
                    </h4>
                    <div className="bg-red-50 p-4 rounded-lg border border-red-200">
                      <p className="text-gray-700">
                        {solicitacaoSelecionada.motivo_reprovacao}
                      </p>
                    </div>
                  </div>
                )}
            </div>

            {/* Footer - Ações */}
            <div className="sticky bottom-0 bg-gray-50 p-6 rounded-b-lg border-t border-gray-200">
              <div className="flex justify-between items-center">
                <div className="flex flex-col gap-2">
                  <span
                    className={`inline-flex items-center px-4 py-2 rounded-full text-sm font-semibold ${
                      solicitacaoSelecionada.status === 'APROVADO'
                        ? 'bg-green-100 text-green-700'
                        : solicitacaoSelecionada.status === 'REPROVADO'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-yellow-100 text-yellow-700'
                    }`}
                  >
                    Status:{' '}
                    {solicitacaoSelecionada.status === 'ANALISE'
                      ? 'Em Análise'
                      : solicitacaoSelecionada.status}
                  </span>
                  {solicitacaoSelecionada.user_aprovador && (
                    <p className="text-xs text-gray-600">
                      <strong>Analisado por:</strong>{' '}
                      {solicitacaoSelecionada.user_aprovador}
                    </p>
                  )}
                  {solicitacaoSelecionada.dt_aprovacao && (
                    <p className="text-xs text-gray-600">
                      <strong>Data da análise:</strong>{' '}
                      {formatDate(solicitacaoSelecionada.dt_aprovacao)}
                    </p>
                  )}
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() =>
                      reprovarSolicitacao(solicitacaoSelecionada.id)
                    }
                    disabled={processando}
                    className="flex items-center gap-2 px-6 py-3 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <XCircle size={20} weight="bold" />
                    Reprovar
                  </button>
                  <button
                    onClick={() =>
                      abrirModalContraproposta(solicitacaoSelecionada)
                    }
                    disabled={processando}
                    className="flex items-center gap-2 px-6 py-3 bg-orange-600 text-white font-semibold rounded-lg hover:bg-orange-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ArrowsLeftRight size={20} weight="bold" />
                    Contraproposta
                  </button>
                  <button
                    onClick={() =>
                      aprovarSolicitacao(solicitacaoSelecionada.id)
                    }
                    disabled={processando}
                    className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <CheckCircle size={20} weight="bold" />
                    Aprovar
                  </button>
                  <button
                    onClick={() => setModalDetalhesAberto(false)}
                    className="px-6 py-3 bg-gray-200 text-gray-700 font-semibold rounded-lg hover:bg-gray-300 transition-colors"
                  >
                    Fechar
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Contraproposta */}
      {modalContrapropostaAberto && solicitacaoSelecionada && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
            {/* Header do Modal */}
            <div className="sticky top-0 bg-gradient-to-r from-orange-600 to-orange-700 px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center">
                  <Handshake
                    size={20}
                    weight="bold"
                    className="text-orange-600"
                  />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">
                    Enviar Contraproposta
                  </h2>
                  <p className="text-sm text-orange-100">
                    {solicitacaoSelecionada.nm_empresa}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setModalContrapropostaAberto(false)}
                className="text-white hover:bg-white/20 transition-colors p-2 rounded-lg"
              >
                <X size={24} weight="bold" />
              </button>
            </div>

            {/* Conteúdo do Modal */}
            <div className="p-6 space-y-6">
              {/* Proposta Original */}
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <h3 className="text-sm font-bold text-[#000638] mb-3 flex items-center gap-2">
                  <Receipt size={18} weight="bold" />
                  Proposta Original
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Valor</p>
                    <p className="text-sm font-bold text-gray-900">
                      {formatMoney(solicitacaoSelecionada.vl_credito)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Pagamento</p>
                    <p className="text-sm font-semibold text-gray-900 capitalize">
                      {solicitacaoSelecionada.forma_pagamento}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Parcelas</p>
                    <p className="text-sm font-semibold text-gray-900">
                      {solicitacaoSelecionada.nr_parcelas}x
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Valor/Parcela</p>
                    <p className="text-sm font-semibold text-gray-900">
                      {formatMoney(
                        solicitacaoSelecionada.vl_credito /
                          solicitacaoSelecionada.nr_parcelas,
                      )}
                    </p>
                  </div>
                </div>
              </div>

              {/* Formulário de Contraproposta */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-4">
                  <ArrowsLeftRight
                    size={20}
                    className="text-orange-600"
                    weight="bold"
                  />
                  <h3 className="text-lg font-bold text-[#000638]">
                    Nova Proposta
                  </h3>
                </div>

                {/* Valor da Contraproposta */}
                <div>
                  <label className="block text-sm font-semibold mb-2 text-[#000638]">
                    Valor do Crédito <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <CurrencyDollar size={20} className="text-gray-400" />
                    </div>
                    <input
                      type="text"
                      value={valorContraproposta}
                      onChange={handleValorContrapropostaChange}
                      placeholder="0,00"
                      className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-600 bg-[#f8f9fb] text-[#000638]"
                      required
                    />
                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                      <span className="text-gray-500 text-sm">R$</span>
                    </div>
                  </div>
                </div>

                {/* Forma de Pagamento */}
                <div>
                  <label className="block text-sm font-semibold mb-2 text-[#000638]">
                    Forma de Pagamento <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={formaPagamentoContraproposta}
                    onChange={(e) =>
                      setFormaPagamentoContraproposta(e.target.value)
                    }
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-600 bg-[#f8f9fb] text-[#000638]"
                    required
                  >
                    <option value="">Selecione...</option>
                    <option value="boleto">Boleto</option>
                    <option value="credito">Crédito</option>
                    <option value="debito">Débito</option>
                    <option value="dinheiro">Dinheiro</option>
                    <option value="pix">PIX</option>
                  </select>
                </div>

                {/* Parcelamento */}
                {['boleto', 'credito'].includes(
                  formaPagamentoContraproposta,
                ) && (
                  <div>
                    <label className="block text-sm font-semibold mb-2 text-[#000638]">
                      Parcelamento <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={parcelasContraproposta}
                      onChange={(e) =>
                        setParcelasContraproposta(e.target.value)
                      }
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-600 bg-[#f8f9fb] text-[#000638]"
                      required
                    >
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
                        <option key={n} value={n}>
                          {n}x
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Preview */}
                {valorContraproposta && formaPagamentoContraproposta && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <h4 className="text-sm font-bold text-blue-900 mb-3">
                      Preview da Contraproposta
                    </h4>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <p className="text-xs text-blue-700 mb-1">
                          Valor Total
                        </p>
                        <p className="text-lg font-bold text-blue-900">
                          {formatMoney(
                            parseFloat(
                              valorContraproposta
                                .replace(/\./g, '')
                                .replace(',', '.'),
                            ),
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-blue-700 mb-1">Parcelas</p>
                        <p className="text-lg font-bold text-blue-900">
                          {['boleto', 'credito'].includes(
                            formaPagamentoContraproposta,
                          )
                            ? `${parcelasContraproposta}x`
                            : '1x'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-blue-700 mb-1">
                          Valor/Parcela
                        </p>
                        <p className="text-lg font-bold text-blue-900">
                          {formatMoney(
                            parseFloat(
                              valorContraproposta
                                .replace(/\./g, '')
                                .replace(',', '.'),
                            ) /
                              (['boleto', 'credito'].includes(
                                formaPagamentoContraproposta,
                              )
                                ? parseInt(parcelasContraproposta)
                                : 1),
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Observação */}
                <div>
                  <label className="block text-sm font-semibold mb-2 text-[#000638]">
                    Observação / Justificativa{' '}
                    <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={observacaoContraproposta}
                    onChange={(e) =>
                      setObservacaoContraproposta(e.target.value)
                    }
                    maxLength={500}
                    rows={4}
                    placeholder="Explique o motivo da contraproposta e os benefícios para o franqueado..."
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-600 bg-[#f8f9fb] text-[#000638] resize-none"
                    required
                  />
                  <div className="flex justify-between items-center mt-1">
                    <p className="text-xs text-gray-500">
                      Mínimo 10 caracteres
                    </p>
                    <p className="text-xs text-gray-500">
                      {observacaoContraproposta.length}/500
                    </p>
                  </div>
                </div>
              </div>

              {/* Informativo */}
              <div className="bg-orange-50 border-l-4 border-orange-400 p-4 rounded-r-lg">
                <div className="flex items-start">
                  <div className="flex-shrink-0">
                    <svg
                      className="h-5 w-5 text-orange-400"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <p className="text-sm text-orange-800">
                      O franqueado receberá uma notificação e poderá aceitar ou
                      recusar esta contraproposta. Se aceita, a solicitação será
                      automaticamente aprovada.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer - Ações */}
            <div className="sticky bottom-0 bg-gray-50 px-6 py-4 rounded-b-lg border-t border-gray-200">
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setModalContrapropostaAberto(false)}
                  disabled={processando}
                  className="px-6 py-3 bg-gray-200 text-gray-700 font-semibold rounded-lg hover:bg-gray-300 transition-colors disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={enviarContraproposta}
                  disabled={processando}
                  className="flex items-center gap-2 px-6 py-3 bg-orange-600 text-white font-semibold rounded-lg hover:bg-orange-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {processando ? (
                    <>
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                      Enviando...
                    </>
                  ) : (
                    <>
                      <PaperPlaneRight size={20} weight="bold" />
                      Enviar Contraproposta
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
