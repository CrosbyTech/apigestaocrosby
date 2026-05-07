import React, { useState } from 'react';
import PageTitle from '../components/ui/PageTitle';
import FiltroEmpresa from '../components/FiltroEmpresa';
import { supabase } from '../lib/supabase';
import { useAuth } from '../components/AuthContext';
import {
  CurrencyDollar,
  CreditCard,
  PaperPlaneRight,
  Warning,
  X,
  CheckCircle,
  List,
  Funnel,
  Eye,
  CalendarBlank,
  Receipt,
  ArrowsLeftRight,
  XCircle,
} from '@phosphor-icons/react';

export default function SolicitacaoCredito() {
  const { user, empresasVinculadas } = useAuth();
  const [empresasSelecionadas, setEmpresasSelecionadas] = useState([]);
  const [valorCredito, setValorCredito] = useState('');
  const [formaPagamento, setFormaPagamento] = useState('');
  const [parcelas, setParcelas] = useState('1');
  const [motivo, setMotivo] = useState('');
  const [modalAlertaAberto, setModalAlertaAberto] = useState(false);
  const [verificandoFaturas, setVerificandoFaturas] = useState(false);
  const [faturasVencidas, setFaturasVencidas] = useState([]);
  const [enviandoSolicitacao, setEnviandoSolicitacao] = useState(false);
  const [modalSucessoAberto, setModalSucessoAberto] = useState(false);
  const [statusSolicitacao, setStatusSolicitacao] = useState('');

  // Estados para abas e listagem
  const [abaAtiva, setAbaAtiva] = useState('solicitar'); // 'solicitar' ou 'minhas'
  const [solicitacoes, setSolicitacoes] = useState([]);
  const [loadingSolicitacoes, setLoadingSolicitacoes] = useState(false);
  const [empresasFiltro, setEmpresasFiltro] = useState([]);
  const [statusFiltro, setStatusFiltro] = useState('todos');

  // Novos estados para modal de detalhes e aceite/recusa de contraproposta
  const [modalDetalhesAberto, setModalDetalhesAberto] = useState(false);
  const [solicitacaoSelecionada, setSolicitacaoSelecionada] = useState(null);
  const [processandoAceite, setProcessandoAceite] = useState(false);

  const BaseURL = 'https://apigestaocrosby-bw2v.onrender.com/api/financial/';

  const verificarFaturasVencidas = async (cdCliente) => {
    try {
      const res = await fetch(
        `${BaseURL}contas-receber-cliente?cd_cliente=${cdCliente}&status=todos`,
      );

      if (!res.ok) {
        console.error('Erro ao buscar faturas:', res.status);
        return false;
      }

      const data = await res.json();
      let dadosArray = [];

      if (Array.isArray(data)) {
        dadosArray = data;
      } else if (data && typeof data === 'object') {
        if (data.data && Array.isArray(data.data)) {
          dadosArray = data.data;
        } else if (
          data.data &&
          data.data.data &&
          Array.isArray(data.data.data)
        ) {
          dadosArray = data.data.data;
        }
      }

      if (dadosArray.length === 0) {
        return false;
      }

      // Verificar se há faturas vencidas
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);

      const faturasVencidas = dadosArray.filter((fatura) => {
        const dtVencimento = new Date(fatura.dt_vencimento);
        dtVencimento.setHours(0, 0, 0, 0);

        // Verificar se a fatura está vencida
        const estaVencida = dtVencimento < hoje;

        // REGRA: Se tem dt_liq (data de liquidação) preenchida, é SEMPRE considerado PAGO
        const temDataLiquidacao =
          fatura.dt_liq && fatura.dt_liq !== null && fatura.dt_liq !== '';

        if (temDataLiquidacao) {
          return false; // Não incluir nas faturas vencidas se já foi liquidada
        }

        // Se não tem dt_liq, verificar se foi pago pelo valor
        const valorFaturado = parseFloat(fatura.vl_fatura) || 0;
        const valorPago = parseFloat(fatura.vl_pago) || 0;
        const estaPago = valorPago >= valorFaturado && valorFaturado > 0;

        // REGRA: Ignorar faturas de até R$ 0,01 (1 centavo)
        if (valorFaturado <= 0.01) {
          return false; // Não incluir faturas irrelevantes
        }

        // Retorna apenas faturas vencidas que NÃO foram pagas
        return estaVencida && !estaPago;
      });

      return faturasVencidas;
    } catch (error) {
      console.error('Erro ao verificar faturas:', error);
      return [];
    }
  };

  const buscarTitulosAVencer = async (cdCliente) => {
    try {
      const res = await fetch(
        `${BaseURL}contas-receber-cliente?cd_cliente=${cdCliente}&status=todos`,
      );

      if (!res.ok) {
        console.error('Erro ao buscar títulos:', res.status);
        return [];
      }

      const data = await res.json();
      let dadosArray = [];

      if (Array.isArray(data)) {
        dadosArray = data;
      } else if (data && typeof data === 'object') {
        if (data.data && Array.isArray(data.data)) {
          dadosArray = data.data;
        } else if (
          data.data &&
          data.data.data &&
          Array.isArray(data.data.data)
        ) {
          dadosArray = data.data.data;
        }
      }

      if (dadosArray.length === 0) {
        return [];
      }

      // Buscar títulos a vencer (futuros e não pagos)
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);

      const titulosAVencer = dadosArray.filter((fatura) => {
        const dtVencimento = new Date(fatura.dt_vencimento);
        dtVencimento.setHours(0, 0, 0, 0);

        // Verificar se a fatura está com vencimento futuro
        const estaFuturo = dtVencimento >= hoje;

        // REGRA: Se tem dt_liq (data de liquidação) preenchida, é SEMPRE considerado PAGO
        const temDataLiquidacao =
          fatura.dt_liq && fatura.dt_liq !== null && fatura.dt_liq !== '';

        if (temDataLiquidacao) {
          return false; // Não incluir nos títulos a vencer se já foi liquidada
        }

        // Se não tem dt_liq, verificar se foi pago pelo valor
        const valorFaturado = parseFloat(fatura.vl_fatura) || 0;
        const valorPago = parseFloat(fatura.vl_pago) || 0;
        const estaPago = valorPago >= valorFaturado && valorFaturado > 0;

        // Retorna apenas faturas futuras que NÃO foram pagas
        return estaFuturo && !estaPago;
      });

      return titulosAVencer;
    } catch (error) {
      console.error('Erro ao buscar títulos a vencer:', error);
      return [];
    }
  };

  const buscarSolicitacoes = async () => {
    if (!user?.id) {
      alert('Usuário não autenticado. Faça login novamente.');
      return;
    }

    setLoadingSolicitacoes(true);
    try {
      // Determinar quais empresas buscar
      let empresasParaBuscar = [];

      if (empresasFiltro.length > 0) {
        // Se há filtro aplicado, usar apenas essas empresas
        empresasParaBuscar = empresasFiltro.map((e) => String(e.cd_empresa));
      } else if (empresasVinculadas && empresasVinculadas.length > 0) {
        // Se não há filtro, buscar por todas as empresas vinculadas ao usuário
        empresasParaBuscar = empresasVinculadas.map((emp) => String(emp));
      }

      if (empresasParaBuscar.length === 0) {
        alert(
          'Você não possui empresas vinculadas. Entre em contato com o administrador.',
        );
        setSolicitacoes([]);
        setLoadingSolicitacoes(false);
        return;
      }

      let query = supabase
        .from('solicitacoes_credito')
        .select('*')
        .in('cd_empresa', empresasParaBuscar)
        .order('dt_solicitacao', { ascending: false });

      // Aplicar filtro de status se não for 'todos'
      if (statusFiltro !== 'todos') {
        query = query.eq('status', statusFiltro);
      }

      const { data, error } = await query;

      if (error) {
        alert(`Erro ao carregar solicitações: ${error.message}`);
        return;
      }

      setSolicitacoes(data || []);
    } catch (error) {
      alert(`Erro inesperado: ${error.message}`);
    } finally {
      setLoadingSolicitacoes(false);
    }
  };

  // Não buscar automaticamente, apenas quando o usuário clicar no botão
  // React.useEffect(() => {
  //   if (abaAtiva === 'minhas' && empresasVinculadas) {
  //     buscarSolicitacoes();
  //   }
  // }, [abaAtiva, empresasFiltro, statusFiltro, user?.id, empresasVinculadas]);

  const formasPagamento = [
    { value: 'boleto', label: 'Boleto' },
    { value: 'credito', label: 'Crédito' },
    { value: 'debito', label: 'Débito' },
    { value: 'dinheiro', label: 'Dinheiro' },
    { value: 'pix', label: 'PIX' },
  ];

  const opcoesParcelamento = [
    { value: '1', label: '1x' },
    { value: '2', label: '2x' },
    { value: '3', label: '3x' },
    { value: '4', label: '4x' },
    { value: '5', label: '5x' },
    { value: '6', label: '6x' },
    { value: '7', label: '7x' },
    { value: '8', label: '8x' },
    { value: '9', label: '9x' },
    { value: '10', label: '10x' },
    { value: '11', label: '11x' },
    { value: '12', label: '12x' },
  ];

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Validações
    if (empresasSelecionadas.length === 0) {
      alert('Selecione uma empresa');
      return;
    }

    if (!valorCredito || parseFloat(valorCredito) <= 0) {
      alert('Informe um valor válido');
      return;
    }

    if (!formaPagamento) {
      alert('Selecione uma forma de pagamento');
      return;
    }

    if (!motivo.trim()) {
      alert('Informe o motivo da solicitação');
      return;
    }

    try {
      // Verificar faturas vencidas e a vencer
      setVerificandoFaturas(true);
      const cdCliente = empresasSelecionadas[0].cd_pessoa;
      const vencidas = await verificarFaturasVencidas(cdCliente);
      const aVencer = await buscarTitulosAVencer(cdCliente);
      setVerificandoFaturas(false);

      // Se tem vencidas, mostrar modal mas AINDA VAI SALVAR
      const temVencidas = vencidas.length > 0;
      if (temVencidas) {
        setFaturasVencidas(vencidas);
        setModalAlertaAberto(true);
      }

      // Preparar dados para o Supabase
      setEnviandoSolicitacao(true);
      const empresa = empresasSelecionadas[0];

      const dadosSolicitacao = {
        cd_empresa: empresa.cd_empresa,
        nm_empresa: empresa.nm_grupoempresa || `Empresa ${empresa.cd_empresa}`,
        cd_pessoa: empresa.cd_pessoa,
        vl_credito: parseFloat(
          valorCredito.replace(/\./g, '').replace(',', '.'),
        ),
        forma_pagamento: formaPagamento,
        nr_parcelas: ['boleto', 'credito'].includes(formaPagamento)
          ? parseInt(parcelas)
          : 1,
        motivo: motivo.trim(),
        titulos_vencidos: vencidas,
        titulos_a_vencer: aVencer,
        user_id: user?.id || null,
        user_email: user?.email || null,
        user_nome: user?.name || user?.email || null,
        status: temVencidas ? 'REPROVADO' : 'ANALISE',
        dt_solicitacao: new Date().toISOString(),
      };

      // Salvar no Supabase
      const { data, error } = await supabase
        .from('solicitacoes_credito')
        .insert([dadosSolicitacao])
        .select();

      setEnviandoSolicitacao(false);

      if (error) {
        console.error('Erro ao salvar solicitação:', error);
        alert('Erro ao enviar solicitação. Tente novamente.');
        return;
      }

      // Definir status e abrir modal de sucesso
      setStatusSolicitacao(temVencidas ? 'REPROVADO' : 'ANALISE');
      setModalSucessoAberto(true);

      // Limpar formulário
      setEmpresasSelecionadas([]);
      setValorCredito('');
      setFormaPagamento('');
      setParcelas('1');
      setMotivo('');
    } catch (error) {
      console.error('Erro no handleSubmit:', error);
      setVerificandoFaturas(false);
      setEnviandoSolicitacao(false);
      alert('Erro ao processar solicitação. Tente novamente.');
    }
  };

  const formatCurrency = (value) => {
    const number = parseFloat(value.replace(/\D/g, '')) / 100;
    return number.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const handleValorChange = (e) => {
    const formatted = formatCurrency(e.target.value);
    setValorCredito(formatted);
  };

  const mostrarParcelamento = ['boleto', 'credito'].includes(formaPagamento);

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

  const abrirModalDetalhes = (solicitacao) => {
    setSolicitacaoSelecionada(solicitacao);
    setModalDetalhesAberto(true);
  };

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <PageTitle
        title="Solicitação de Crédito"
        subtitle="Solicite crédito para sua franquia"
      />

      {/* Navegação por Abas */}
      <div className="max-w-6xl mx-auto mb-6">
        <div className="bg-white rounded-lg shadow-md p-2 flex gap-2">
          <button
            onClick={() => setAbaAtiva('solicitar')}
            className={`flex items-center gap-2 px-6 py-3 rounded-lg font-semibold transition-all ${
              abaAtiva === 'solicitar'
                ? 'bg-[#000638] text-white shadow-md'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <CurrencyDollar size={20} weight="bold" />
            Solicitar Crédito
          </button>
          <button
            onClick={() => setAbaAtiva('minhas')}
            className={`flex items-center gap-2 px-6 py-3 rounded-lg font-semibold transition-all ${
              abaAtiva === 'minhas'
                ? 'bg-[#000638] text-white shadow-md'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <List size={20} weight="bold" />
            Minhas Solicitações
          </button>
        </div>
      </div>

      {/* Conteúdo da Aba Solicitar */}
      {abaAtiva === 'solicitar' && (
        <div className="max-w-4xl mx-auto">
          <form
            onSubmit={handleSubmit}
            className="bg-white rounded-lg shadow-md p-6 space-y-6"
          >
            {/* Empresa */}
            <div>
              <label className="block text-sm font-semibold mb-2 text-[#000638]">
                Empresa / Franquia <span className="text-red-500">*</span>
              </label>
              <FiltroEmpresa
                empresasSelecionadas={empresasSelecionadas}
                onSelectEmpresas={setEmpresasSelecionadas}
              />
              {empresasSelecionadas.length === 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  Selecione a franquia para a qual deseja solicitar crédito
                </p>
              )}
            </div>

            {/* Valor do Crédito */}
            <div>
              <label
                htmlFor="valorCredito"
                className="block text-sm font-semibold mb-2 text-[#000638]"
              >
                Valor do Crédito <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <CurrencyDollar size={20} className="text-gray-400" />
                </div>
                <input
                  type="text"
                  id="valorCredito"
                  value={valorCredito}
                  onChange={handleValorChange}
                  placeholder="0,00"
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638]"
                  required
                />
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                  <span className="text-gray-500 text-sm">R$</span>
                </div>
              </div>
            </div>

            {/* Forma de Pagamento */}
            <div>
              <label
                htmlFor="formaPagamento"
                className="block text-sm font-semibold mb-2 text-[#000638]"
              >
                Forma de Pagamento <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <CreditCard size={20} className="text-gray-400" />
                </div>
                <select
                  id="formaPagamento"
                  value={formaPagamento}
                  onChange={(e) => setFormaPagamento(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] appearance-none cursor-pointer"
                  required
                >
                  <option value="">Selecione...</option>
                  {formasPagamento.map((forma) => (
                    <option key={forma.value} value={forma.value}>
                      {forma.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Parcelamento (condicional) */}
            {mostrarParcelamento && (
              <div>
                <label
                  htmlFor="parcelas"
                  className="block text-sm font-semibold mb-2 text-[#000638]"
                >
                  Parcelamento <span className="text-red-500">*</span>
                </label>
                <select
                  id="parcelas"
                  value={parcelas}
                  onChange={(e) => setParcelas(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] appearance-none cursor-pointer"
                  required
                >
                  {opcoesParcelamento.map((opcao) => (
                    <option key={opcao.value} value={opcao.value}>
                      {opcao.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Motivo */}
            <div>
              <label
                htmlFor="motivo"
                className="block text-sm font-semibold mb-2 text-[#000638]"
              >
                Motivo da Solicitação <span className="text-red-500">*</span>
              </label>
              <textarea
                id="motivo"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                maxLength={500}
                rows={5}
                placeholder="Descreva o motivo da solicitação de crédito..."
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] resize-none"
                required
              />
              <div className="flex justify-between items-center mt-1">
                <p className="text-xs text-gray-500">
                  Descreva detalhadamente o motivo da solicitação
                </p>
                <p className="text-xs text-gray-500">
                  {motivo.length}/500 caracteres
                </p>
              </div>
            </div>

            {/* Botão de Envio */}
            <div className="flex justify-end pt-4">
              <button
                type="submit"
                disabled={verificandoFaturas || enviandoSolicitacao}
                className="flex items-center gap-2 px-6 py-3 bg-[#000638] text-white font-semibold rounded-lg hover:bg-[#000638]/90 focus:outline-none focus:ring-2 focus:ring-[#000638] focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {verificandoFaturas ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    Verificando pendências...
                  </>
                ) : enviandoSolicitacao ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    Enviando solicitação...
                  </>
                ) : (
                  <>
                    <PaperPlaneRight size={20} weight="bold" />
                    Enviar Solicitação
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Informações adicionais */}
          <div className="mt-6 bg-blue-50 border-l-4 border-blue-400 p-4 rounded-lg">
            <div className="flex items-start">
              <div className="flex-shrink-0">
                <svg
                  className="h-5 w-5 text-blue-400"
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
                <p className="text-sm text-blue-800">
                  Sua solicitação será analisada pela equipe financeira e você
                  receberá um retorno em até 48 horas úteis.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Conteúdo da Aba Minhas Solicitações */}
      {abaAtiva === 'minhas' && (
        <div className="max-w-6xl mx-auto">
          {/* Filtros */}
          <div className="flex flex-col bg-white p-3 rounded-lg shadow-md w-full max-w-7xl mx-auto border border-[#000638]/10 mb-6">
            <div className="mb-2">
              <span className="text-lg font-bold text-[#000638] flex items-center gap-1">
                <Funnel size={18} weight="bold" />
                Filtros
              </span>
              <span className="text-xs text-gray-500 mt-1">
                Selecione a empresa e status para análise
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-3">
              <div className="lg:col-span-1">
                <FiltroEmpresa
                  empresasSelecionadas={empresasFiltro}
                  onSelectEmpresas={setEmpresasFiltro}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                  Status
                </label>
                <select
                  value={statusFiltro}
                  onChange={(e) => setStatusFiltro(e.target.value)}
                  className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
                >
                  <option value="todos">TODOS</option>
                  <option value="ANALISE">APROVAÇÃO PENDENTE</option>
                  <option value="APROVADO">APROVADOS</option>
                  <option value="REPROVADO">REPROVADOS</option>
                </select>
              </div>
              <div className="flex items-end">
                <button
                  onClick={buscarSolicitacoes}
                  disabled={loadingSolicitacoes}
                  className="flex items-center gap-1 bg-[#000638] text-white px-3 py-1 rounded-lg hover:bg-[#fe0000] disabled:opacity-50 disabled:cursor-not-allowed transition-colors h-7 text-xs font-bold shadow-md tracking-wide uppercase w-full justify-center"
                >
                  {loadingSolicitacoes ? (
                    <>
                      <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
                      <span>Carregando...</span>
                    </>
                  ) : (
                    <>
                      <Receipt size={10} />
                      <span>Buscar</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Tabela de Solicitações */}
          <div className="bg-white rounded-lg shadow-md overflow-hidden">
            {loadingSolicitacoes ? (
              <div className="flex justify-center items-center p-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#000638]"></div>
              </div>
            ) : solicitacoes.length === 0 ? (
              <div className="text-center p-12">
                <List size={48} className="mx-auto text-gray-300 mb-4" />
                <p className="text-gray-500 font-medium">
                  Nenhuma solicitação encontrada
                </p>
                <p className="text-gray-400 text-sm mt-2">
                  Suas solicitações de crédito aparecerão aqui
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
                        Empresa
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
                            <CalendarBlank
                              size={16}
                              className="text-gray-400"
                            />
                            {formatDate(solicitacao.dt_solicitacao)}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 font-medium">
                          {solicitacao.nm_empresa ||
                            `Empresa ${solicitacao.cd_empresa}`}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 font-bold text-right">
                          {solicitacao.status === 'APROVADO' &&
                          solicitacao.contraproposta
                            ? formatMoney(solicitacao.contraproposta.vl_credito)
                            : formatMoney(solicitacao.vl_credito)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 capitalize">
                          {solicitacao.status === 'APROVADO' &&
                          solicitacao.contraproposta
                            ? solicitacao.contraproposta.forma_pagamento
                            : solicitacao.forma_pagamento}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 text-center">
                          {solicitacao.status === 'APROVADO' &&
                          solicitacao.contraproposta
                            ? `${solicitacao.contraproposta.nr_parcelas}x`
                            : `${solicitacao.nr_parcelas}x`}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${
                              solicitacao.status === 'APROVADO'
                                ? 'bg-green-100 text-green-700'
                                : solicitacao.status === 'REPROVADO'
                                ? 'bg-red-100 text-red-700'
                                : 'bg-yellow-100 text-yellow-700'
                            }`}
                          >
                            {solicitacao.status === 'ANALISE'
                              ? 'Em Análise'
                              : solicitacao.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            className="text-[#000638] hover:bg-gray-100 p-2 rounded-lg transition-colors"
                            title="Ver detalhes"
                            onClick={() => abrirModalDetalhes(solicitacao)}
                          >
                            <Eye size={20} weight="bold" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal de Alerta de Pendências */}
      {modalAlertaAberto && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="h-full overflow-auto bg-white rounded-lg shadow-xl max-w-md w-full">
            {/* Header do Modal */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100">
                  <Warning size={24} weight="bold" className="text-red-600" />
                </div>
                <h3 className="text-lg font-bold text-[#000638]">
                  Pendências Financeiras
                </h3>
              </div>
              <button
                onClick={() => setModalAlertaAberto(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X size={24} weight="bold" />
              </button>
            </div>

            {/* Conteúdo do Modal */}
            <div className="p-6">
              <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-4">
                <p className="text-sm text-gray-700 leading-relaxed">
                  Identificamos{' '}
                  <strong className="text-red-600">
                    {faturasVencidas.length}{' '}
                    {faturasVencidas.length === 1
                      ? 'pendência financeira vencida'
                      : 'pendências financeiras vencidas'}
                  </strong>{' '}
                  em seu cadastro.
                </p>
                <p className="text-sm text-gray-700 leading-relaxed mt-2">
                  Para prosseguir com a solicitação de crédito, é necessário
                  regularizar os débitos em aberto ou solicitar uma renegociação
                  junto ao departamento financeiro.
                </p>
              </div>

              {/* Tabela de Faturas Vencidas */}
              <div className="mb-4 h-full overflow-y-auto">
                <h4 className="text-sm font-semibold text-[#000638] mb-2">
                  Faturas em Atraso:
                </h4>
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="max-h-64 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-[#000638] text-white sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold">
                            Nº Fatura
                          </th>
                          <th className="px-3 py-2 text-left font-semibold">
                            Vencimento
                          </th>
                          <th className="px-3 py-2 text-right font-semibold">
                            Valor
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white">
                        {faturasVencidas.map((fatura, index) => {
                          const dtVenc = fatura.dt_vencimento
                            ? new Date(fatura.dt_vencimento).toLocaleDateString(
                                'pt-BR',
                              )
                            : '-';
                          const valor = fatura.vl_fatura
                            ? new Intl.NumberFormat('pt-BR', {
                                style: 'currency',
                                currency: 'BRL',
                              }).format(fatura.vl_fatura)
                            : 'R$ 0,00';
                          return (
                            <tr
                              key={index}
                              className={
                                index % 2 === 0 ? 'bg-gray-50' : 'bg-white'
                              }
                            >
                              <td className="px-3 py-2 text-gray-700">
                                {fatura.nr_fat || '-'}/
                                {fatura.nr_parcela || '-'}
                              </td>
                              <td className="px-3 py-2 text-gray-700">
                                {dtVenc}
                              </td>
                              <td className="px-3 py-2 text-right text-gray-700 font-medium">
                                {valor}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="bg-gray-100 border-t-2 border-[#000638]">
                        <tr>
                          <td
                            colSpan="2"
                            className="px-3 py-2 text-right font-semibold text-gray-700"
                          >
                            Total:
                          </td>
                          <td className="px-3 py-2 text-right font-bold text-[#000638]">
                            {new Intl.NumberFormat('pt-BR', {
                              style: 'currency',
                              currency: 'BRL',
                            }).format(
                              faturasVencidas.reduce(
                                (acc, f) => acc + (f.vl_fatura || 0),
                                0,
                              ),
                            )}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </div>

              <div className="bg-blue-50 border-l-4 border-blue-500 p-4">
                <p className="text-xs text-gray-600">
                  <strong>Como regularizar:</strong>
                  <br />• Acesse o <strong>Portal de Títulos</strong> para
                  efetuar o pagamento
                  <br />• Entre em contato com o financeiro para negociar os
                  débitos
                  <br />• Após a quitação, sua solicitação de crédito poderá ser
                  processada
                </p>
              </div>
            </div>

            {/* Footer do Modal */}
            <div className="flex justify-end gap-3 p-6 border-t border-gray-200">
              <button
                onClick={() => setModalAlertaAberto(false)}
                className="px-6 py-2 bg-[#000638] text-white font-semibold rounded-lg hover:bg-[#000638]/90 transition-colors"
              >
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Sucesso */}
      {modalSucessoAberto && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full animate-fadeIn">
            {/* Header do Modal */}
            <div className="relative p-8 text-center">
              {/* Ícone de Sucesso */}
              <div className="flex justify-center mb-4">
                <div className="relative">
                  <div className="absolute inset-0 bg-green-100 rounded-full animate-ping opacity-75"></div>
                  <div className="relative flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-green-400 to-green-600 shadow-lg">
                    <CheckCircle
                      size={48}
                      weight="bold"
                      className="text-white"
                    />
                  </div>
                </div>
              </div>

              {/* Título */}
              <h3 className="text-2xl font-bold text-[#000638] mb-2">
                Solicitação Enviada com Sucesso!
              </h3>

              {/* Status Badge */}
              <div className="flex justify-center mb-4">
                {statusSolicitacao === 'ANALISE' ? (
                  <div className="inline-flex items-center gap-2 px-4 py-2 bg-yellow-50 border-2 border-yellow-400 rounded-full">
                    <div className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse"></div>
                    <span className="text-sm font-bold text-yellow-700">
                      STATUS: EM ANÁLISE
                    </span>
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-2 px-4 py-2 bg-red-50 border-2 border-red-400 rounded-full">
                    <div className="w-2 h-2 bg-red-400 rounded-full"></div>
                    <span className="text-sm font-bold text-red-700">
                      STATUS: REPROVADO
                    </span>
                  </div>
                )}
              </div>

              {/* Mensagem */}
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-l-4 border-blue-500 p-4 rounded-r-lg mb-6">
                <p className="text-sm text-gray-700 leading-relaxed">
                  {statusSolicitacao === 'ANALISE' ? (
                    <>
                      <strong>
                        Sua solicitação foi registrada com sucesso!
                      </strong>
                      <br />
                      Nossa equipe financeira irá analisar seu pedido e você
                      receberá um retorno em breve.
                    </>
                  ) : (
                    <>
                      <strong>
                        Sua solicitação foi registrada, porém não pode ser
                        aprovada no momento.
                      </strong>
                      <br />
                      Foram identificadas pendências financeiras vencidas. Por
                      favor, regularize os débitos para solicitar crédito.
                      <br />
                      <div className="mt-5 inline-flex items-center gap-2 px-4 py-2 bg-yellow-50 border-2 border-yellow-400 rounded-full">
                        <strong className="">
                          AVISO: Caso apareçam pendências já quitadas em nosso
                          sistema, entre em contato com o setor financeiro pelo
                          Sults
                        </strong>
                      </div>
                    </>
                  )}
                </p>
              </div>

              {/* Informações Adicionais */}
              {statusSolicitacao === 'ANALISE' && (
                <div className="bg-white border border-gray-200 rounded-lg p-4 text-left">
                  <p className="text-xs text-gray-600">
                    <strong className="text-[#000638]">Próximos passos:</strong>
                    <br />
                    <span className="inline-block mt-2">
                      ✓ Análise de crédito será realizada
                    </span>
                    <br />
                    <span className="inline-block">
                      ✓ Você será notificado sobre a decisão
                    </span>
                    <br />
                    <span className="inline-block">
                      ✓ Prazo estimado: até 48 horas úteis
                    </span>
                  </p>
                </div>
              )}
            </div>

            {/* Footer do Modal */}
            <div className="flex justify-center gap-3 p-6 bg-gray-50 rounded-b-lg">
              <button
                onClick={() => setModalSucessoAberto(false)}
                className="px-8 py-3 bg-gradient-to-r from-[#000638] to-[#000850] text-white font-semibold rounded-lg hover:from-[#000850] hover:to-[#000638] transform hover:scale-105 transition-all duration-200 shadow-md"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Detalhes da Solicitação */}
      {modalDetalhesAberto && solicitacaoSelecionada && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
            {/* Header do Modal */}
            <div className="sticky top-0 bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center">
                  <Eye size={20} weight="bold" className="text-blue-600" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">
                    Detalhes da Solicitação
                  </h2>
                  <p className="text-sm text-blue-100">
                    {solicitacaoSelecionada.nm_empresa}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setModalDetalhesAberto(false)}
                className="text-white hover:bg-white/20 transition-colors p-2 rounded-lg"
              >
                <X size={24} weight="bold" />
              </button>
            </div>

            {/* Conteúdo do Modal */}
            <div className="p-6 space-y-6">
              {/* Informações Gerais */}
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 mb-4">
                <h3 className="text-sm font-bold text-[#000638] mb-3 flex items-center gap-2">
                  <Receipt size={18} weight="bold" />
                  Informações Gerais
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

              {/* Motivo */}
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 mb-4">
                <h3 className="text-sm font-bold text-[#000638] mb-2">
                  Motivo da Solicitação
                </h3>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">
                  {solicitacaoSelecionada.motivo}
                </p>
              </div>

              {/* Contraproposta Recebida */}
              {solicitacaoSelecionada.status === 'CONTRAPROPOSTA' &&
                solicitacaoSelecionada.contraproposta && (
                  <div className="bg-orange-50 rounded-lg p-4 border border-orange-200 mb-4">
                    <h3 className="text-sm font-bold text-orange-700 mb-3 flex items-center gap-2">
                      <ArrowsLeftRight size={18} weight="bold" />
                      Contraproposta Recebida
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <p className="text-xs text-orange-700 mb-1">Valor</p>
                        <p className="text-sm font-bold text-orange-900">
                          {formatMoney(
                            solicitacaoSelecionada.contraproposta.vl_credito,
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-orange-700 mb-1">
                          Pagamento
                        </p>
                        <p className="text-sm font-semibold text-orange-900 capitalize">
                          {
                            solicitacaoSelecionada.contraproposta
                              .forma_pagamento
                          }
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-orange-700 mb-1">Parcelas</p>
                        <p className="text-sm font-semibold text-orange-900">
                          {solicitacaoSelecionada.contraproposta.nr_parcelas}x
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-orange-700 mb-1">
                          Valor/Parcela
                        </p>
                        <p className="text-sm font-semibold text-orange-900">
                          {formatMoney(
                            solicitacaoSelecionada.contraproposta.vl_parcela,
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3">
                      <p className="text-xs text-orange-700 font-semibold">
                        Observação do Financeiro:
                      </p>
                      <p className="text-sm text-orange-900 whitespace-pre-wrap">
                        {solicitacaoSelecionada.contraproposta.observacao}
                      </p>
                    </div>
                    {/* Botões de Aceite/Recusa */}
                    <div className="flex gap-4 pt-4">
                      <button
                        onClick={async () => {
                          setProcessandoAceite(true);
                          try {
                            // Atualizar status para APROVADO e adicionar ao histórico
                            const historicoAtual =
                              solicitacaoSelecionada.historico_negociacao || [];
                            const novoHistorico = [
                              ...historicoAtual,
                              {
                                tipo: 'ACEITE',
                                vl_credito:
                                  solicitacaoSelecionada.contraproposta
                                    .vl_credito,
                                forma_pagamento:
                                  solicitacaoSelecionada.contraproposta
                                    .forma_pagamento,
                                nr_parcelas:
                                  solicitacaoSelecionada.contraproposta
                                    .nr_parcelas,
                                dt: new Date().toISOString(),
                                user: user?.name || user?.email,
                                observacao:
                                  'Aceite da contraproposta pelo franqueado',
                              },
                            ];
                            const { error } = await supabase
                              .from('solicitacoes_credito')
                              .update({
                                status: 'APROVADO',
                                historico_negociacao: novoHistorico,
                                dt_aprovacao: new Date().toISOString(),
                              })
                              .eq('id', solicitacaoSelecionada.id);
                            if (error) {
                              alert('Erro ao aceitar contraproposta');
                            } else {
                              alert(
                                'Contraproposta aceita! Solicitação aprovada.',
                              );
                              setModalDetalhesAberto(false);
                              buscarSolicitacoes();
                            }
                          } catch (err) {
                            alert('Erro ao processar aceite.');
                          } finally {
                            setProcessandoAceite(false);
                          }
                        }}
                        disabled={processandoAceite}
                        className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <CheckCircle size={20} weight="bold" />
                        Aceitar Contraproposta
                      </button>
                      <button
                        onClick={async () => {
                          setProcessandoAceite(true);
                          try {
                            // Atualizar status para REPROVADO e adicionar ao histórico
                            const historicoAtual =
                              solicitacaoSelecionada.historico_negociacao || [];
                            const novoHistorico = [
                              ...historicoAtual,
                              {
                                tipo: 'RECUSA',
                                vl_credito:
                                  solicitacaoSelecionada.contraproposta
                                    .vl_credito,
                                forma_pagamento:
                                  solicitacaoSelecionada.contraproposta
                                    .forma_pagamento,
                                nr_parcelas:
                                  solicitacaoSelecionada.contraproposta
                                    .nr_parcelas,
                                dt: new Date().toISOString(),
                                user: user?.name || user?.email,
                                observacao:
                                  'Recusa da contraproposta pelo franqueado',
                              },
                            ];
                            const { error } = await supabase
                              .from('solicitacoes_credito')
                              .update({
                                status: 'REPROVADO',
                                historico_negociacao: novoHistorico,
                                dt_aprovacao: new Date().toISOString(),
                              })
                              .eq('id', solicitacaoSelecionada.id);
                            if (error) {
                              alert('Erro ao recusar contraproposta');
                            } else {
                              alert(
                                'Contraproposta recusada! Solicitação reprovada.',
                              );
                              setModalDetalhesAberto(false);
                              buscarSolicitacoes();
                            }
                          } catch (err) {
                            alert('Erro ao processar recusa.');
                          } finally {
                            setProcessandoAceite(false);
                          }
                        }}
                        disabled={processandoAceite}
                        className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <XCircle size={20} weight="bold" />
                        Recusar Contraproposta
                      </button>
                    </div>
                  </div>
                )}

              {/* Histórico de Negociação */}
              {solicitacaoSelecionada.historico_negociacao &&
                solicitacaoSelecionada.historico_negociacao.length > 0 && (
                  <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 mb-4">
                    <h3 className="text-sm font-bold text-[#000638] mb-2">
                      Histórico de Negociação
                    </h3>
                    <ul className="text-xs text-gray-700 space-y-1">
                      {solicitacaoSelecionada.historico_negociacao.map(
                        (h, idx) => (
                          <li key={idx}>
                            <span className="font-bold text-[#000638]">
                              {h.tipo}:
                            </span>{' '}
                            {h.vl_credito ? formatMoney(h.vl_credito) : ''}{' '}
                            {h.forma_pagamento
                              ? `em ${h.nr_parcelas}x (${h.forma_pagamento})`
                              : ''}{' '}
                            -{' '}
                            {h.tipo === 'CONTRAPROPOSTA'
                              ? 'Financeiro'
                              : h.user}{' '}
                            -{' '}
                            {h.dt ? new Date(h.dt).toLocaleString('pt-BR') : ''}{' '}
                            {h.observacao ? `- ${h.observacao}` : ''}
                          </li>
                        ),
                      )}
                    </ul>
                  </div>
                )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
