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
  X,
  Handshake,
  ArrowsLeftRight,
  PaperPlaneRight,
} from '@phosphor-icons/react';

export default function AnaliseRenegociacao() {
  const { user } = useAuth();
  const [renegociacoes, setRenegociacoes] = useState([]);
  const [loadingRenegociacoes, setLoadingRenegociacoes] = useState(false);
  const [empresasFiltro, setEmpresasFiltro] = useState([]);
  const [statusFiltro, setStatusFiltro] = useState('todos');
  const [idFiltro, setIdFiltro] = useState('');
  const [pagamentoFiltro, setPagamentoFiltro] = useState('todos');
  const [modalDetalhesAberto, setModalDetalhesAberto] = useState(false);
  const [renegociacaoSelecionada, setRenegociacaoSelecionada] = useState(null);
  const [processando, setProcessando] = useState(false);

  // Estados para contraproposta
  const [modalContrapropostaAberto, setModalContrapropostaAberto] =
    useState(false);
  const [valorContraproposta, setValorContraproposta] = useState('');
  const [formaPagamentoContraproposta, setFormaPagamentoContraproposta] =
    useState('');
  const [parcelasContraproposta, setParcelasContraproposta] = useState('');
  const [observacaoContraproposta, setObservacaoContraproposta] = useState('');

  const buscarRenegociacoes = async () => {
    setLoadingRenegociacoes(true);
    try {
      let query = supabase
        .from('solicitacoes_renegociacoes')
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
        console.error('Erro ao buscar renegociações:', error);
        alert('Erro ao carregar renegociações');
        return;
      }

      console.log('📋 Renegociações encontradas:', data);
      setRenegociacoes(data || []);
    } catch (error) {
      console.error('Erro ao buscar renegociações:', error);
    } finally {
      setLoadingRenegociacoes(false);
    }
  };

  useEffect(() => {
    buscarRenegociacoes();
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

  // Estatísticas calculadas
  const empresasUnicas = new Set(renegociacoes.map((r) => r.cd_empresa)).size;
  const valorTotal = renegociacoes.reduce(
    (sum, r) => sum + (parseFloat(r.vl_total) || 0),
    0,
  );
  const aprovadas = renegociacoes.filter((r) => r.status === 'APROVADO');
  const reprovadas = renegociacoes.filter((r) => r.status === 'REPROVADO');
  const emAnalise = renegociacoes.filter((r) => r.status === 'ANALISE');
  const valorAprovado = aprovadas.reduce(
    (sum, r) => sum + (parseFloat(r.vl_total) || 0),
    0,
  );
  const valorReprovado = reprovadas.reduce(
    (sum, r) => sum + (parseFloat(r.vl_total) || 0),
    0,
  );
  const valorEmAnalise = emAnalise.reduce(
    (sum, r) => sum + (parseFloat(r.vl_total) || 0),
    0,
  );

  const aprovarRenegociacao = async (id) => {
    if (!window.confirm('Tem certeza que deseja APROVAR esta renegociação?')) {
      return;
    }

    setProcessando(true);
    try {
      const { error } = await supabase
        .from('solicitacoes_renegociacoes')
        .update({
          status: 'APROVADO',
          dt_aprovacao: new Date().toISOString(),
          aprovado_por: user.id,
          user_aprovador: user.name || user.email,
          motivo_reprovacao: null,
        })
        .eq('id', id);

      if (error) {
        console.error('Erro ao aprovar:', error);
        alert('Erro ao aprovar renegociação');
        return;
      }

      alert('Renegociação aprovada com sucesso!');
      buscarRenegociacoes();
      setModalDetalhesAberto(false);
    } catch (error) {
      console.error('Erro ao aprovar:', error);
      alert('Erro ao processar aprovação');
    } finally {
      setProcessando(false);
    }
  };

  const reprovarRenegociacao = async (id) => {
    const motivo = prompt('Informe o motivo da reprovação:');
    if (!motivo || motivo.trim().length < 10) {
      alert('Por favor, informe um motivo válido (mínimo 10 caracteres)');
      return;
    }

    setProcessando(true);
    try {
      const { error } = await supabase
        .from('solicitacoes_renegociacoes')
        .update({
          status: 'REPROVADO',
          dt_aprovacao: new Date().toISOString(),
          aprovado_por: user.id,
          user_aprovador: user.name || user.email,
          motivo_reprovacao: motivo.trim(),
        })
        .eq('id', id);

      if (error) {
        console.error('Erro ao reprovar:', error);
        alert('Erro ao reprovar renegociação');
        return;
      }

      alert('Renegociação reprovada com sucesso!');
      buscarRenegociacoes();
      setModalDetalhesAberto(false);
    } catch (error) {
      console.error('Erro ao reprovar:', error);
      alert('Erro ao processar reprovação');
    } finally {
      setProcessando(false);
    }
  };

  // Funções para Contraproposta
  const abrirModalContraproposta = (renegociacao) => {
    setRenegociacaoSelecionada(renegociacao);
    setValorContraproposta(formatCurrency(renegociacao.vl_total));
    setFormaPagamentoContraproposta(renegociacao.forma_pagamento || '');
    setParcelasContraproposta(renegociacao.nr_parcelas?.toString() || '');
    setObservacaoContraproposta('');
    setModalContrapropostaAberto(true);
  };

  const formatCurrency = (value) => {
    if (!value) return '';
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    return numValue.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const handleValorContrapropostaChange = (e) => {
    let value = e.target.value.replace(/\D/g, '');
    value = (parseInt(value) / 100).toFixed(2);
    setValorContraproposta(formatCurrency(value));
  };

  const enviarContraproposta = async () => {
    if (
      !observacaoContraproposta.trim() ||
      observacaoContraproposta.trim().length < 10
    ) {
      alert('Por favor, informe uma observação válida (mínimo 10 caracteres)');
      return;
    }

    if (
      !valorContraproposta ||
      !formaPagamentoContraproposta ||
      !parcelasContraproposta
    ) {
      alert('Por favor, preencha todos os campos');
      return;
    }

    setProcessando(true);
    try {
      const valorNumerico = parseFloat(
        valorContraproposta.replace(/\./g, '').replace(',', '.'),
      );
      const parcelas = parseInt(parcelasContraproposta);
      const valorParcela = valorNumerico / parcelas;

      const contraproposta = {
        vl_total: valorNumerico,
        forma_pagamento: formaPagamentoContraproposta,
        nr_parcelas: parcelas,
        vl_parcela: valorParcela,
        observacao: observacaoContraproposta.trim(),
        dt_envio: new Date().toISOString(),
        enviado_por: user.id,
        user_aprovador: user.name || user.email,
      };

      // Buscar histórico atual
      const { data: renegociacaoAtual } = await supabase
        .from('solicitacoes_renegociacoes')
        .select('historico_negociacao')
        .eq('id', renegociacaoSelecionada.id)
        .single();

      const historicoAtual = renegociacaoAtual?.historico_negociacao || [];

      // Adicionar contraproposta ao histórico
      const novoHistorico = [
        ...historicoAtual,
        {
          tipo: 'CONTRAPROPOSTA',
          vl_total: valorNumerico,
          forma_pagamento: formaPagamentoContraproposta,
          nr_parcelas: parcelas,
          dt: new Date().toISOString(),
          user: user.name || user.email,
          observacao: observacaoContraproposta.trim(),
        },
      ];

      const { error } = await supabase
        .from('solicitacoes_renegociacoes')
        .update({
          status: 'CONTRAPROPOSTA',
          contraproposta: contraproposta,
          historico_negociacao: novoHistorico,
        })
        .eq('id', renegociacaoSelecionada.id);

      if (error) {
        console.error('Erro ao enviar contraproposta:', error);
        alert('Erro ao enviar contraproposta');
        return;
      }

      alert('Contraproposta enviada com sucesso!');
      buscarRenegociacoes();
      setModalContrapropostaAberto(false);
      setModalDetalhesAberto(false);
    } catch (error) {
      console.error('Erro ao enviar contraproposta:', error);
      alert('Erro ao processar contraproposta');
    } finally {
      setProcessando(false);
    }
  };

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <PageTitle
        title="Análise de Renegociações"
        subtitle="Gerencie e aprove solicitações de renegociação de dívidas"
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
        {renegociacoes.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-6 gap-2 mb-6 max-w-7xl mx-auto">
            {/* Card: Franquias */}
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
                  {renegociacoes.length}
                </div>
                <CardDescription className="text-xs text-gray-500">
                  {renegociacoes.length === 1 ? 'solicitação' : 'solicitações'}
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
                  {emAnalise.length} em análise
                </CardDescription>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Tabela de Renegociações */}
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          {loadingRenegociacoes ? (
            <div className="flex justify-center items-center p-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#000638]"></div>
            </div>
          ) : renegociacoes.length === 0 ? (
            <div className="text-center p-12">
              <Handshake size={48} className="mx-auto text-gray-300 mb-4" />
              <p className="text-gray-500 font-medium">
                Nenhuma renegociação encontrada
              </p>
              <p className="text-gray-400 text-sm mt-2">
                As solicitações de renegociação aparecerão aqui
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
                    <th className="px-4 py-3 text-center text-xs font-semibold uppercase">
                      Nº Faturas
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
                  {renegociacoes.map((renegociacao, index) => (
                    <tr
                      key={renegociacao.id}
                      className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                    >
                      <td className="px-4 py-3 text-sm text-gray-700">
                        <div className="flex items-center gap-2">
                          <CalendarBlank size={16} className="text-gray-400" />
                          {formatDate(renegociacao.dt_solicitacao)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 font-medium">
                        {renegociacao.nm_empresa ||
                          `Empresa ${renegociacao.cd_empresa}`}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {renegociacao.user_nome || renegociacao.user_email}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 text-center font-semibold">
                        {renegociacao.faturas_selecionadas?.length || 0}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 font-bold text-right">
                        {formatMoney(renegociacao.vl_total)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 capitalize">
                        {renegociacao.forma_pagamento}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 text-center">
                        {renegociacao.nr_parcelas
                          ? `${renegociacao.nr_parcelas}x`
                          : '-'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${
                            renegociacao.status === 'APROVADO'
                              ? 'bg-green-100 text-green-700'
                              : renegociacao.status === 'REPROVADO'
                              ? 'bg-red-100 text-red-700'
                              : renegociacao.status === 'CONTRAPROPOSTA'
                              ? 'bg-orange-100 text-orange-700'
                              : 'bg-yellow-100 text-yellow-700'
                          }`}
                        >
                          {renegociacao.status === 'ANALISE'
                            ? 'Em Análise'
                            : renegociacao.status === 'CONTRAPROPOSTA'
                            ? 'Contraproposta'
                            : renegociacao.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => {
                              setRenegociacaoSelecionada(renegociacao);
                              setModalDetalhesAberto(true);
                            }}
                            className="text-blue-600 hover:bg-blue-50 p-2 rounded-lg transition-colors"
                            title="Ver detalhes"
                          >
                            <Eye size={20} weight="bold" />
                          </button>
                          <button
                            onClick={() => aprovarRenegociacao(renegociacao.id)}
                            disabled={processando}
                            className="text-green-600 hover:bg-green-50 p-2 rounded-lg transition-colors disabled:opacity-50"
                            title="Aprovar"
                          >
                            <CheckCircle size={20} weight="bold" />
                          </button>
                          <button
                            onClick={() =>
                              reprovarRenegociacao(renegociacao.id)
                            }
                            disabled={processando}
                            className="text-red-600 hover:bg-red-50 p-2 rounded-lg transition-colors disabled:opacity-50"
                            title="Reprovar"
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
      {modalDetalhesAberto && renegociacaoSelecionada && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
            {/* Header do Modal */}
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                  <Handshake
                    size={20}
                    weight="bold"
                    className="text-blue-600"
                  />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-[#000638]">
                    Detalhes da Renegociação
                  </h2>
                  <p className="text-sm text-gray-500">
                    ID: {renegociacaoSelecionada.id.slice(0, 8)}...
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setModalDetalhesAberto(false);
                  setRenegociacaoSelecionada(null);
                }}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X size={24} weight="bold" />
              </button>
            </div>

            {/* Conteúdo do Modal */}
            <div className="p-6 space-y-6">
              {/* Status Badge */}
              <div className="flex items-center justify-center">
                <span
                  className={`inline-flex items-center px-6 py-2 rounded-full text-sm font-bold ${
                    renegociacaoSelecionada.status === 'APROVADO'
                      ? 'bg-green-100 text-green-700'
                      : renegociacaoSelecionada.status === 'REPROVADO'
                      ? 'bg-red-100 text-red-700'
                      : 'bg-yellow-100 text-yellow-700'
                  }`}
                >
                  {renegociacaoSelecionada.status === 'ANALISE'
                    ? '⏳ EM ANÁLISE'
                    : renegociacaoSelecionada.status === 'APROVADO'
                    ? '✅ APROVADO'
                    : '❌ REPROVADO'}
                </span>
              </div>

              {/* Informações Gerais */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="text-sm font-bold text-[#000638] mb-3 flex items-center gap-2">
                  <Receipt size={18} weight="bold" />
                  Informações Gerais
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Empresa</p>
                    <p className="text-sm font-semibold text-gray-900">
                      {renegociacaoSelecionada.nm_empresa ||
                        `Empresa ${renegociacaoSelecionada.cd_empresa}`}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">
                      Data da Solicitação
                    </p>
                    <p className="text-sm font-semibold text-gray-900">
                      {formatDate(renegociacaoSelecionada.dt_solicitacao)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Solicitante</p>
                    <p className="text-sm font-semibold text-gray-900">
                      {renegociacaoSelecionada.user_nome ||
                        renegociacaoSelecionada.user_email}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">
                      Forma de Pagamento
                    </p>
                    <p className="text-sm font-semibold text-gray-900 capitalize">
                      {renegociacaoSelecionada.forma_pagamento}
                    </p>
                  </div>
                </div>
              </div>

              {/* Valores */}
              <div className="bg-blue-50 rounded-lg p-4">
                <h3 className="text-sm font-bold text-[#000638] mb-3 flex items-center gap-2">
                  <CurrencyDollar size={18} weight="bold" />
                  Valores
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Valor Total</p>
                    <p className="text-lg font-bold text-green-600">
                      {formatMoney(renegociacaoSelecionada.vl_total)}
                    </p>
                  </div>
                  {renegociacaoSelecionada.nr_parcelas && (
                    <>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">
                          Número de Parcelas
                        </p>
                        <p className="text-lg font-bold text-gray-900">
                          {renegociacaoSelecionada.nr_parcelas}x
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">
                          Valor da Parcela
                        </p>
                        <p className="text-lg font-bold text-blue-600">
                          {formatMoney(renegociacaoSelecionada.vl_parcela)}
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Faturas Selecionadas */}
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                  <h3 className="text-sm font-bold text-[#000638] flex items-center gap-2">
                    <Receipt size={18} weight="bold" />
                    Faturas Selecionadas (
                    {renegociacaoSelecionada.faturas_selecionadas?.length || 0})
                  </h3>
                </div>
                <div className="overflow-x-auto max-h-64">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">
                          Status
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">
                          Nº Fatura
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">
                          Emissão
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">
                          Vencimento
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">
                          Valor
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {renegociacaoSelecionada.faturas_selecionadas?.map(
                        (fatura, idx) => (
                          <tr key={idx} className="hover:bg-gray-50">
                            <td className="px-3 py-2">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                                  fatura.status === 'VENCIDA'
                                    ? 'bg-red-100 text-red-700'
                                    : 'bg-yellow-100 text-yellow-700'
                                }`}
                              >
                                {fatura.status}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-gray-900">
                              {fatura.nr_fat || '-'}
                            </td>
                            <td className="px-3 py-2 text-gray-600">
                              {formatDate(fatura.dt_emissao)}
                            </td>
                            <td className="px-3 py-2 text-gray-600">
                              {formatDate(fatura.dt_vencimento)}
                            </td>
                            <td className="px-3 py-2 text-right font-semibold text-gray-900">
                              {formatMoney(fatura.vl_fatura)}
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Motivo */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="text-sm font-bold text-[#000638] mb-2">
                  Motivo da Renegociação
                </h3>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">
                  {renegociacaoSelecionada.motivo}
                </p>
              </div>

              {/* Informações de Aprovação/Reprovação */}
              {(renegociacaoSelecionada.status === 'APROVADO' ||
                renegociacaoSelecionada.status === 'REPROVADO') && (
                <div
                  className={`rounded-lg p-4 ${
                    renegociacaoSelecionada.status === 'APROVADO'
                      ? 'bg-green-50 border border-green-200'
                      : 'bg-red-50 border border-red-200'
                  }`}
                >
                  <h3 className="text-sm font-bold text-[#000638] mb-3">
                    Informações de{' '}
                    {renegociacaoSelecionada.status === 'APROVADO'
                      ? 'Aprovação'
                      : 'Reprovação'}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Data</p>
                      <p className="text-sm font-semibold text-gray-900">
                        {formatDate(renegociacaoSelecionada.dt_aprovacao)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Responsável</p>
                      <p className="text-sm font-semibold text-gray-900">
                        {renegociacaoSelecionada.user_aprovador || 'Sistema'}
                      </p>
                    </div>
                  </div>
                  {renegociacaoSelecionada.motivo_reprovacao && (
                    <div className="mt-3">
                      <p className="text-xs text-gray-500 mb-1">
                        Motivo da Reprovação
                      </p>
                      <p className="text-sm text-gray-700 bg-white p-3 rounded border border-red-200">
                        {renegociacaoSelecionada.motivo_reprovacao}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Botões de Ação */}
              <div className="flex gap-4 pt-4 border-t border-gray-200">
                <button
                  onClick={() =>
                    reprovarRenegociacao(renegociacaoSelecionada.id)
                  }
                  disabled={processando}
                  className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <XCircle size={20} weight="bold" />
                  Reprovar
                </button>
                <button
                  onClick={() =>
                    abrirModalContraproposta(renegociacaoSelecionada)
                  }
                  disabled={processando}
                  className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-orange-600 text-white rounded-lg font-semibold hover:bg-orange-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ArrowsLeftRight size={20} weight="bold" />
                  Contraproposta
                </button>
                <button
                  onClick={() =>
                    aprovarRenegociacao(renegociacaoSelecionada.id)
                  }
                  disabled={processando}
                  className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <CheckCircle size={20} weight="bold" />
                  Aprovar
                </button>
                <button
                  onClick={() => {
                    setModalDetalhesAberto(false);
                    setRenegociacaoSelecionada(null);
                  }}
                  className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300 transition-all"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Contraproposta */}
      {modalContrapropostaAberto && renegociacaoSelecionada && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="bg-gradient-to-r from-orange-600 to-orange-500 p-6 text-white sticky top-0 z-10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Handshake size={32} weight="bold" />
                  <div>
                    <h2 className="text-2xl font-bold">
                      Enviar Contraproposta
                    </h2>
                    <p className="text-orange-100 text-sm mt-1">
                      {renegociacaoSelecionada.nm_empresa ||
                        `Empresa ${renegociacaoSelecionada.cd_empresa}`}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setModalContrapropostaAberto(false)}
                  className="p-2 rounded-lg hover:bg-white hover:bg-opacity-20 transition-colors"
                >
                  <X size={24} weight="bold" />
                </button>
              </div>
            </div>

            {/* Conteúdo */}
            <div className="p-6 space-y-6">
              {/* Proposta Original */}
              <div className="bg-gray-50 rounded-lg p-4 border-2 border-gray-200">
                <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                  <Receipt size={18} weight="bold" />
                  Proposta Original
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Valor Total</p>
                    <p className="text-sm font-semibold text-gray-900">
                      {formatMoney(renegociacaoSelecionada.vl_total)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Pagamento</p>
                    <p className="text-sm font-semibold text-gray-900 capitalize">
                      {renegociacaoSelecionada.forma_pagamento}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Parcelas</p>
                    <p className="text-sm font-semibold text-gray-900">
                      {renegociacaoSelecionada.nr_parcelas}x
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Valor/Parcela</p>
                    <p className="text-sm font-semibold text-gray-900">
                      {formatMoney(
                        renegociacaoSelecionada.vl_total /
                          renegociacaoSelecionada.nr_parcelas,
                      )}
                    </p>
                  </div>
                </div>
              </div>

              {/* Nova Proposta */}
              <div>
                <h3 className="text-lg font-bold text-[#000638] mb-4 flex items-center gap-2">
                  <ArrowsLeftRight size={20} weight="bold" />
                  Nova Proposta
                </h3>

                <div className="space-y-4">
                  {/* Valor */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Valor Total <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={valorContraproposta}
                      onChange={handleValorContrapropostaChange}
                      placeholder="0,00"
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                  </div>

                  {/* Forma de Pagamento */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Forma de Pagamento <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={formaPagamentoContraproposta}
                      onChange={(e) =>
                        setFormaPagamentoContraproposta(e.target.value)
                      }
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent capitalize"
                    >
                      <option value="">Selecione...</option>
                      <option value="boleto">Boleto</option>
                      <option value="pix">PIX</option>
                      <option value="cartao">Cartão</option>
                    </select>
                  </div>

                  {/* Número de Parcelas */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Número de Parcelas <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      value={parcelasContraproposta}
                      onChange={(e) =>
                        setParcelasContraproposta(e.target.value)
                      }
                      min="1"
                      placeholder="Ex: 6"
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                  </div>

                  {/* Observação */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Observação/Justificativa{' '}
                      <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      value={observacaoContraproposta}
                      onChange={(e) =>
                        setObservacaoContraproposta(e.target.value)
                      }
                      rows={4}
                      placeholder="Explique os motivos da contraproposta..."
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent resize-none"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Mínimo 10 caracteres
                    </p>
                  </div>
                </div>
              </div>

              {/* Preview da Contraproposta */}
              {valorContraproposta &&
                formaPagamentoContraproposta &&
                parcelasContraproposta && (
                  <div className="bg-gradient-to-r from-orange-50 to-orange-100 rounded-lg p-4 border-2 border-orange-300">
                    <h3 className="text-sm font-bold text-orange-900 mb-3">
                      Preview da Contraproposta
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <p className="text-xs text-orange-700 mb-1">
                          Valor Total
                        </p>
                        <p className="text-sm font-semibold text-orange-900">
                          R$ {valorContraproposta}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-orange-700 mb-1">
                          Pagamento
                        </p>
                        <p className="text-sm font-semibold text-orange-900 capitalize">
                          {formaPagamentoContraproposta}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-orange-700 mb-1">Parcelas</p>
                        <p className="text-sm font-semibold text-orange-900">
                          {parcelasContraproposta}x
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-orange-700 mb-1">
                          Valor/Parcela
                        </p>
                        <p className="text-sm font-semibold text-orange-900">
                          {formatMoney(
                            parseFloat(
                              valorContraproposta
                                .replace(/\./g, '')
                                .replace(',', '.'),
                            ) / parseInt(parcelasContraproposta),
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

              {/* Botões */}
              <div className="flex gap-4 pt-4 border-t border-gray-200">
                <button
                  onClick={() => setModalContrapropostaAberto(false)}
                  className="flex-1 px-6 py-3 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300 transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={enviarContraproposta}
                  disabled={processando}
                  className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-orange-600 to-orange-500 text-white rounded-lg font-semibold hover:from-orange-700 hover:to-orange-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <PaperPlaneRight size={20} weight="bold" />
                  {processando ? 'Enviando...' : 'Enviar Contraproposta'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
