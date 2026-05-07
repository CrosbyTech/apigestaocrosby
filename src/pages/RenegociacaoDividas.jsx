import React, { useState } from 'react';
import { useAuth } from '../components/AuthContext';
import FiltroEmpresa from '../components/FiltroEmpresa';
import { supabase } from '../lib/supabase';
import {
  Handshake,
  List,
  CreditCard,
  Receipt,
  CheckSquare,
  Square,
  PaperPlaneRight,
  CalendarBlank,
  CurrencyDollar,
  Warning,
  X,
  CheckCircle,
  Eye,
  Funnel,
} from '@phosphor-icons/react';

export default function RenegociacaoDividas() {
  const { user, empresasVinculadas } = useAuth();

  // Estados para abas
  const [abaAtiva, setAbaAtiva] = useState('solicitar'); // 'solicitar' ou 'minhas'

  // Estados do formulário
  const [empresasSelecionadas, setEmpresasSelecionadas] = useState([]);
  const [faturasDisponiveis, setFaturasDisponiveis] = useState([]);
  const [faturasSelecionadas, setFaturasSelecionadas] = useState([]);
  const [todasSelecionadas, setTodasSelecionadas] = useState(false);
  const [filtroStatusFaturas, setFiltroStatusFaturas] = useState('todas');
  const [ordenacao, setOrdenacao] = useState({ campo: null, direcao: 'asc' });
  const [formaPagamento, setFormaPagamento] = useState('');
  const [parcelas, setParcelas] = useState('1');
  const [motivo, setMotivo] = useState('');
  const [carregandoFaturas, setCarregandoFaturas] = useState(false);
  const [enviandoSolicitacao, setEnviandoSolicitacao] = useState(false);
  const [modalSucessoAberto, setModalSucessoAberto] = useState(false);

  // Estados para "Minhas Renegociações"
  const [renegociacoes, setRenegociacoes] = useState([]);
  const [loadingRenegociacoes, setLoadingRenegociacoes] = useState(false);
  const [empresasFiltro, setEmpresasFiltro] = useState([]);
  const [statusFiltro, setStatusFiltro] = useState('todos');

  // Estados para modal de detalhes
  const [modalDetalhesAberto, setModalDetalhesAberto] = useState(false);
  const [renegociacaoSelecionada, setRenegociacaoSelecionada] = useState(null);
  const [processandoAceite, setProcessandoAceite] = useState(false);

  const BaseURL = 'https://apigestaocrosby-bw2v.onrender.com/api/financial/';

  // Função para buscar faturas quando a empresa é selecionada
  const buscarFaturas = async (empresa) => {
    console.log('buscarFaturas chamado com empresa:', empresa);
    if (!empresa || !empresa.cd_pessoa) {
      setFaturasDisponiveis([]);
      return;
    }

    setCarregandoFaturas(true);
    try {
      // Usar cd_pessoa como cd_cliente na rota (mesmo que Portal de Títulos)
      const cdCliente = empresa.cd_pessoa;
      const url = `${BaseURL}contas-receber-cliente?cd_cliente=${cdCliente}&status=todos`;
      console.log('URL da requisição:', url);
      const res = await fetch(url);

      if (!res.ok) {
        console.error('Erro ao buscar faturas:', res.status);
        setFaturasDisponiveis([]);
        return;
      }

      const data = await res.json();
      console.log('Dados recebidos:', data);
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

      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);

      // Filtrar faturas vencidas e a vencer (não pagas)
      const faturasNaoPagas = dadosArray.filter((fatura) => {
        // REGRA: Se tem dt_liq (data de liquidação) preenchida, é SEMPRE considerado PAGO
        const temDataLiquidacao =
          fatura.dt_liq && fatura.dt_liq !== null && fatura.dt_liq !== '';

        if (temDataLiquidacao) {
          return false; // Não incluir faturas liquidadas
        }

        // Se não tem dt_liq, verificar se foi pago pelo valor
        const valorFaturado = parseFloat(fatura.vl_fatura) || 0;
        const valorPago = parseFloat(fatura.vl_pago) || 0;
        const estaPago = valorPago >= valorFaturado && valorFaturado > 0;

        return !estaPago; // Retornar apenas faturas não pagas
      });

      // Separar em vencidas e a vencer
      const faturasComStatus = faturasNaoPagas.map((fatura) => {
        const dtVencimento = new Date(fatura.dt_vencimento);
        dtVencimento.setHours(0, 0, 0, 0);
        const estaVencida = dtVencimento < hoje;

        return {
          ...fatura,
          status: estaVencida ? 'VENCIDA' : 'A VENCER',
        };
      });

      console.log('Faturas com status processadas:', faturasComStatus.length);
      setFaturasDisponiveis(faturasComStatus);
      setFaturasSelecionadas([]);
      setTodasSelecionadas(false);
    } catch (error) {
      console.error('Erro ao buscar faturas:', error);
      setFaturasDisponiveis([]);
    } finally {
      setCarregandoFaturas(false);
    }
  };

  // Quando a empresa é selecionada
  const handleEmpresaChange = (empresas) => {
    console.log('Empresas recebidas:', empresas);
    setEmpresasSelecionadas(empresas);
    if (empresas.length === 1) {
      // Passar o objeto empresa completo (precisa do cd_pessoa)
      buscarFaturas(empresas[0]);
    } else {
      setFaturasDisponiveis([]);
      setFaturasSelecionadas([]);
    }
  };

  // Selecionar/desselecionar uma fatura
  const toggleFatura = (fatura) => {
    const faturaExiste = faturasSelecionadas.some(
      (f) => f.nr_fat === fatura.nr_fat && f.nr_parcela === fatura.nr_parcela,
    );

    if (faturaExiste) {
      setFaturasSelecionadas(
        faturasSelecionadas.filter(
          (f) =>
            !(f.nr_fat === fatura.nr_fat && f.nr_parcela === fatura.nr_parcela),
        ),
      );
      setTodasSelecionadas(false);
    } else {
      setFaturasSelecionadas([...faturasSelecionadas, fatura]);
      if (faturasSelecionadas.length + 1 === faturasDisponiveis.length) {
        setTodasSelecionadas(true);
      }
    }
  };

  // Selecionar/desselecionar todas
  const toggleTodasFaturas = () => {
    if (todasSelecionadas) {
      setFaturasSelecionadas([]);
      setTodasSelecionadas(false);
    } else {
      setFaturasSelecionadas([...faturasDisponiveis]);
      setTodasSelecionadas(true);
    }
  };

  // Formatar valor monetário
  const formatMoney = (value) => {
    if (!value && value !== 0) return 'R$ 0,00';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  // Formatar data
  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('pt-BR');
  };

  // Calcular valor total selecionado
  const calcularValorTotal = () => {
    return faturasSelecionadas.reduce((total, fatura) => {
      return total + (parseFloat(fatura.vl_fatura) || 0);
    }, 0);
  };

  // Buscar renegociações do usuário
  const buscarRenegociacoes = async () => {
    setLoadingRenegociacoes(true);
    try {
      let query = supabase
        .from('solicitacoes_renegociacoes')
        .select('*')
        .order('dt_solicitacao', { ascending: false });

      // Filtrar por empresas vinculadas
      const empresasParaFiltrar =
        empresasFiltro.length > 0
          ? empresasFiltro.map((e) => String(e.cd_empresa || e))
          : empresasVinculadas.map((e) => String(e));

      if (empresasParaFiltrar.length > 0) {
        query = query.in('cd_empresa', empresasParaFiltrar);
      }

      // Filtrar por status
      if (statusFiltro !== 'todos') {
        query = query.eq('status', statusFiltro);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Erro ao buscar renegociações:', error);
        alert('Erro ao carregar renegociações');
        return;
      }

      setRenegociacoes(data || []);
    } catch (error) {
      console.error('Erro ao buscar renegociações:', error);
      alert('Erro ao carregar renegociações');
    } finally {
      setLoadingRenegociacoes(false);
    }
  };

  // Limpar formulário
  const limparFormulario = () => {
    setEmpresasSelecionadas([]);
    setFaturasDisponiveis([]);
    setFaturasSelecionadas([]);
    setTodasSelecionadas(false);
    setFormaPagamento('');
    setParcelas('1');
    setMotivo('');
  };

  // Enviar solicitação para o Supabase
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (empresasSelecionadas.length === 0) {
      alert('Por favor, selecione uma empresa.');
      return;
    }

    if (faturasSelecionadas.length === 0) {
      alert('Por favor, selecione ao menos uma fatura para renegociar.');
      return;
    }

    if (!formaPagamento) {
      alert('Por favor, selecione a forma de pagamento.');
      return;
    }

    if (
      (formaPagamento === 'boleto' || formaPagamento === 'credito') &&
      !parcelas
    ) {
      alert('Por favor, informe o número de parcelas.');
      return;
    }

    if (!motivo || motivo.trim().length < 10) {
      alert(
        'Por favor, informe o motivo da renegociação (mínimo 10 caracteres).',
      );
      return;
    }

    setEnviandoSolicitacao(true);

    try {
      const empresa = empresasSelecionadas[0];
      const valorTotal = calcularValorTotal();
      const valorParcela =
        formaPagamento === 'boleto' || formaPagamento === 'credito'
          ? valorTotal / parseInt(parcelas)
          : null;

      // Preparar dados para inserção
      const dadosRenegociacao = {
        cd_empresa: empresa.cd_empresa,
        nm_empresa:
          empresa.nm_grupoempresa ||
          empresa.nm_empresa ||
          `Empresa ${empresa.cd_empresa}`,
        cd_pessoa: empresa.cd_pessoa,
        faturas_selecionadas: faturasSelecionadas,
        vl_total: valorTotal,
        forma_pagamento: formaPagamento,
        nr_parcelas:
          formaPagamento === 'boleto' || formaPagamento === 'credito'
            ? parseInt(parcelas)
            : null,
        vl_parcela: valorParcela,
        motivo: motivo.trim(),
        user_id: user.id,
        user_email: user.email,
        user_nome: user.name || user.email,
        status: 'ANALISE',
      };

      console.log('Enviando solicitação para Supabase:', dadosRenegociacao);

      const { data, error } = await supabase
        .from('solicitacoes_renegociacoes')
        .insert([dadosRenegociacao])
        .select();

      if (error) {
        console.error('Erro ao salvar no Supabase:', error);
        alert(`Erro ao enviar solicitação: ${error.message}`);
        return;
      }

      console.log('Solicitação salva com sucesso:', data);

      // Mostrar modal de sucesso
      setModalSucessoAberto(true);
      limparFormulario();
    } catch (error) {
      console.error('Erro ao processar solicitação:', error);
      alert('Erro ao enviar solicitação. Tente novamente.');
    } finally {
      setEnviandoSolicitacao(false);
    }
  };

  return (
    <div className="p-4 md:p-6 lg:p-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-[#000638]">
          Renegociação de Dívidas
        </h1>
        <p className="text-gray-600 mt-2">
          Gerencie e renegocie as dívidas da sua franquia
        </p>
      </div>

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
            <Handshake size={20} weight="bold" />
            Solicitar Renegociação
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
            Minhas Renegociações
          </button>
        </div>
      </div>

      {/* Conteúdo das Abas */}
      {abaAtiva === 'solicitar' ? (
        // ABA: SOLICITAR RENEGOCIAÇÃO
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-bold text-[#000638] mb-6">
              Nova Solicitação de Renegociação
            </h2>

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Filtro de Empresa */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Empresa / Franquia <span className="text-red-500">*</span>
                </label>
                <FiltroEmpresa
                  empresasSelecionadas={empresasSelecionadas}
                  onSelectEmpresas={handleEmpresaChange}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Selecione apenas uma empresa para carregar as faturas
                </p>
              </div>

              {/* Tabela de Faturas */}
              {empresasSelecionadas.length === 1 && (
                <div className="max-h-96 border border-gray-200 rounded-lg overflow-auto">
                  <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                    <h3 className="font-semibold text-[#000638] flex items-center gap-2">
                      <Receipt size={20} />
                      Faturas Disponíveis para Renegociação
                    </h3>
                    {faturasDisponiveis.length > 0 && (
                      <div className="flex items-center gap-3">
                        <select
                          value={filtroStatusFaturas}
                          onChange={(e) =>
                            setFiltroStatusFaturas(e.target.value)
                          }
                          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#000638]"
                        >
                          <option value="todas">Todas</option>
                          <option value="VENCIDA">Vencidas</option>
                          <option value="A VENCER">A Vencer</option>
                        </select>
                        <button
                          type="button"
                          onClick={toggleTodasFaturas}
                          className="flex items-center gap-2 px-3 py-1.5 bg-[#000638] text-white text-sm rounded-lg hover:bg-[#fe0000] transition-colors"
                        >
                          {todasSelecionadas ? (
                            <>
                              <CheckSquare size={16} weight="fill" />
                              Desselecionar Todas
                            </>
                          ) : (
                            <>
                              <Square size={16} />
                              Selecionar Todas
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>

                  {carregandoFaturas ? (
                    <div className="p-8 text-center text-gray-500">
                      Carregando faturas...
                    </div>
                  ) : faturasDisponiveis.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">
                      Nenhuma fatura disponível para renegociação
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse">
                        <thead className="bg-[#000638] text-white text-sm uppercase tracking-wider">
                          <tr>
                            <th className="px-2 py-2 text-center">
                              <div className="flex items-center justify-center">
                                Selecionar
                              </div>
                            </th>
                            <th className="px-2 py-2 text-center">
                              <div className="flex items-center justify-center">
                                Status
                              </div>
                            </th>
                            <th className="px-2 py-2 text-center">
                              <div className="flex items-center justify-center">
                                Nº Fatura
                              </div>
                            </th>
                            <th className="px-2 py-2 text-center">
                              <button
                                onClick={() => {
                                  setOrdenacao({
                                    campo: 'dt_emissao',
                                    direcao:
                                      ordenacao.campo === 'dt_emissao' &&
                                      ordenacao.direcao === 'asc'
                                        ? 'desc'
                                        : 'asc',
                                  });
                                }}
                                className="flex items-center justify-center gap-1 hover:text-[#fe0000] transition-colors w-full"
                              >
                                Emissão
                                {ordenacao.campo === 'dt_emissao' && (
                                  <span>
                                    {ordenacao.direcao === 'asc' ? '↑' : '↓'}
                                  </span>
                                )}
                              </button>
                            </th>
                            <th className="px-2 py-2 text-center">
                              <button
                                onClick={() => {
                                  setOrdenacao({
                                    campo: 'dt_vencimento',
                                    direcao:
                                      ordenacao.campo === 'dt_vencimento' &&
                                      ordenacao.direcao === 'asc'
                                        ? 'desc'
                                        : 'asc',
                                  });
                                }}
                                className="flex items-center justify-center gap-1 hover:text-[#fe0000] transition-colors w-full"
                              >
                                Vencimento
                                {ordenacao.campo === 'dt_vencimento' && (
                                  <span>
                                    {ordenacao.direcao === 'asc' ? '↑' : '↓'}
                                  </span>
                                )}
                              </button>
                            </th>
                            <th className="px-2 py-2 text-center">
                              <button
                                onClick={() => {
                                  setOrdenacao({
                                    campo: 'vl_fatura',
                                    direcao:
                                      ordenacao.campo === 'vl_fatura' &&
                                      ordenacao.direcao === 'asc'
                                        ? 'desc'
                                        : 'asc',
                                  });
                                }}
                                className="flex items-center justify-center gap-1 hover:text-[#fe0000] transition-colors w-full"
                              >
                                Valor Fatura
                                {ordenacao.campo === 'vl_fatura' && (
                                  <span>
                                    {ordenacao.direcao === 'asc' ? '↑' : '↓'}
                                  </span>
                                )}
                              </button>
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white">
                          {faturasDisponiveis
                            .filter((fatura) =>
                              filtroStatusFaturas === 'todas'
                                ? true
                                : fatura.status === filtroStatusFaturas,
                            )
                            .sort((a, b) => {
                              if (!ordenacao.campo) return 0;

                              let valorA, valorB;

                              if (ordenacao.campo === 'vl_fatura') {
                                valorA = parseFloat(a[ordenacao.campo]) || 0;
                                valorB = parseFloat(b[ordenacao.campo]) || 0;
                              } else {
                                valorA = new Date(a[ordenacao.campo]);
                                valorB = new Date(b[ordenacao.campo]);
                              }

                              if (ordenacao.direcao === 'asc') {
                                return valorA > valorB
                                  ? 1
                                  : valorA < valorB
                                  ? -1
                                  : 0;
                              } else {
                                return valorA < valorB
                                  ? 1
                                  : valorA > valorB
                                  ? -1
                                  : 0;
                              }
                            })
                            .map((fatura) => {
                              const isSelected = faturasSelecionadas.some(
                                (f) =>
                                  f.nr_fat === fatura.nr_fat &&
                                  f.nr_parcela === fatura.nr_parcela,
                              );
                              return (
                                <tr
                                  key={`${fatura.nr_fat}-${fatura.nr_parcela}`}
                                  className={`text-sm transition-colors cursor-pointer hover:bg-gray-50 ${
                                    isSelected ? 'bg-blue-50' : ''
                                  }`}
                                  onClick={() => toggleFatura(fatura)}
                                >
                                  <td className="text-center px-2 py-2">
                                    {isSelected ? (
                                      <CheckSquare
                                        size={20}
                                        weight="fill"
                                        className="text-[#000638] mx-auto"
                                      />
                                    ) : (
                                      <Square
                                        size={20}
                                        className="text-gray-400 mx-auto"
                                      />
                                    )}
                                  </td>
                                  <td className="text-center px-2 py-2">
                                    <span
                                      className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold ${
                                        fatura.status === 'VENCIDA'
                                          ? 'bg-red-100 text-red-700'
                                          : 'bg-yellow-100 text-yellow-700'
                                      }`}
                                    >
                                      {fatura.status}
                                    </span>
                                  </td>
                                  <td className="text-center text-gray-900 px-2 py-2">
                                    {fatura.nr_fat || '--'}
                                  </td>
                                  <td className="text-center text-gray-900 px-2 py-2">
                                    {formatDate(fatura.dt_emissao)}
                                  </td>
                                  <td className="text-center text-gray-900 px-2 py-2">
                                    {formatDate(fatura.dt_vencimento)}
                                  </td>
                                  <td className="text-center font-semibold text-green-600 px-2 py-2">
                                    {formatMoney(fatura.vl_fatura)}
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Resumo das Seleções */}
                  {faturasSelecionadas.length > 0 && (
                    <div className="bg-blue-50 px-4 py-3 border-t border-blue-200">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-semibold text-[#000638]">
                          {faturasSelecionadas.length} fatura(s) selecionada(s)
                        </span>
                        <span className="font-bold text-[#000638] text-lg">
                          Total: {formatMoney(calcularValorTotal())}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Forma de Pagamento */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Forma de Pagamento <span className="text-red-500">*</span>
                </label>
                <div className="flex items-center gap-2">
                  <CreditCard size={20} className="text-[#000638]" />
                  <select
                    value={formaPagamento}
                    onChange={(e) => setFormaPagamento(e.target.value)}
                    className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#000638]/20 focus:border-[#000638] transition-colors text-sm"
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
              </div>

              {/* Número de Parcelas */}
              {(formaPagamento === 'boleto' ||
                formaPagamento === 'credito') && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Número de Parcelas <span className="text-red-500">*</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <CalendarBlank size={20} className="text-[#000638]" />
                    <select
                      value={parcelas}
                      onChange={(e) => setParcelas(e.target.value)}
                      className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#000638]/20 focus:border-[#000638] transition-colors text-sm"
                      required
                    >
                      <option value="1">1x</option>
                      <option value="2">2x</option>
                      <option value="3">3x</option>
                      <option value="4">4x</option>
                      <option value="5">5x</option>
                      <option value="6">6x</option>
                      <option value="7">7x</option>
                      <option value="8">8x</option>
                      <option value="9">9x</option>
                      <option value="10">10x</option>
                      <option value="11">11x</option>
                      <option value="12">12x</option>
                    </select>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Selecione o número de parcelas desejado
                  </p>

                  {/* Preview das Parcelas */}
                  {faturasSelecionadas.length > 0 && parcelas > 0 && (
                    <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                      <h4 className="text-sm font-semibold text-[#000638] mb-3 flex items-center gap-2">
                        <CurrencyDollar size={18} weight="bold" />
                        Preview do Parcelamento
                      </h4>
                      <div className="space-y-2">
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-gray-600">Valor Total:</span>
                          <span className="font-bold text-[#000638]">
                            {formatMoney(calcularValorTotal())}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-gray-600">
                            Número de Parcelas:
                          </span>
                          <span className="font-semibold text-gray-900">
                            {parcelas}x
                          </span>
                        </div>
                        <div className="h-px bg-blue-200 my-2"></div>
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-gray-600">
                            Valor de Cada Parcela:
                          </span>
                          <span className="font-bold text-green-600 text-lg">
                            {formatMoney(
                              calcularValorTotal() / parseInt(parcelas),
                            )}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Motivo da Renegociação */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Motivo da Renegociação <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={motivo}
                  onChange={(e) => {
                    if (e.target.value.length <= 500) {
                      setMotivo(e.target.value);
                    }
                  }}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#000638]/20 focus:border-[#000638] transition-colors text-sm resize-none"
                  rows="4"
                  placeholder="Descreva o motivo da renegociação..."
                  required
                  minLength={10}
                />
                <div className="flex justify-between items-center mt-1">
                  <p className="text-xs text-gray-500">Mínimo 10 caracteres</p>
                  <p className="text-xs text-gray-500">
                    {motivo.length}/500 caracteres
                  </p>
                </div>
              </div>

              {/* Botões */}
              <div className="flex gap-4 pt-4">
                <button
                  type="submit"
                  disabled={
                    faturasSelecionadas.length === 0 || enviandoSolicitacao
                  }
                  className={`flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-semibold transition-all ${
                    faturasSelecionadas.length === 0 || enviandoSolicitacao
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-[#000638] text-white hover:bg-[#fe0000] shadow-md hover:shadow-lg'
                  }`}
                >
                  {enviandoSolicitacao ? (
                    <>
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                      Enviando...
                    </>
                  ) : (
                    <>
                      <PaperPlaneRight size={20} />
                      Enviar Solicitação
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={limparFormulario}
                  disabled={enviandoSolicitacao}
                  className="px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Limpar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : (
        // ABA: MINHAS RENEGOCIAÇÕES
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
                  <option value="ANALISE">EM ANÁLISE</option>
                  <option value="APROVADO">APROVADOS</option>
                  <option value="REPROVADO">REPROVADOS</option>
                </select>
              </div>
              <div className="flex items-end">
                <button
                  onClick={buscarRenegociacoes}
                  disabled={loadingRenegociacoes}
                  className="flex items-center gap-1 bg-[#000638] text-white px-3 py-1 rounded-lg hover:bg-[#fe0000] disabled:opacity-50 disabled:cursor-not-allowed transition-colors h-7 text-xs font-bold shadow-md tracking-wide uppercase w-full justify-center"
                >
                  {loadingRenegociacoes ? (
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

          {/* Tabela de Renegociações */}
          <div className="bg-white rounded-lg shadow-md overflow-hidden">
            {loadingRenegociacoes ? (
              <div className="flex justify-center items-center p-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#000638]"></div>
              </div>
            ) : renegociacoes.length === 0 ? (
              <div className="text-center p-12">
                <List size={48} className="mx-auto text-gray-300 mb-4" />
                <p className="text-gray-500 font-medium">
                  Nenhuma renegociação encontrada
                </p>
                <p className="text-gray-400 text-sm mt-2">
                  Suas solicitações de renegociação aparecerão aqui
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
                      <th className="px-4 py-3 text-center text-xs font-semibold uppercase">
                        Nº Faturas
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase">
                        Valor Total
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
                            <CalendarBlank
                              size={16}
                              className="text-gray-400"
                            />
                            {formatDate(renegociacao.dt_solicitacao)}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 font-medium">
                          {renegociacao.nm_empresa ||
                            `Empresa ${renegociacao.cd_empresa}`}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 text-center font-semibold">
                          {renegociacao.faturas_selecionadas?.length || 0}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 font-bold text-right">
                          {renegociacao.status === 'APROVADO' &&
                          renegociacao.contraproposta
                            ? formatMoney(renegociacao.contraproposta.vl_total)
                            : formatMoney(renegociacao.vl_total)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 capitalize">
                          {renegociacao.status === 'APROVADO' &&
                          renegociacao.contraproposta
                            ? renegociacao.contraproposta.forma_pagamento
                            : renegociacao.forma_pagamento}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 text-center">
                          {renegociacao.status === 'APROVADO' &&
                          renegociacao.contraproposta
                            ? `${renegociacao.contraproposta.nr_parcelas}x`
                            : renegociacao.nr_parcelas
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
                          <button
                            onClick={() => {
                              setRenegociacaoSelecionada(renegociacao);
                              setModalDetalhesAberto(true);
                            }}
                            className="text-[#000638] hover:bg-gray-100 p-2 rounded-lg transition-colors"
                            title="Ver detalhes"
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

      {/* Modal de Sucesso */}
      {modalSucessoAberto && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-8 max-w-md w-full shadow-2xl">
            <div className="flex flex-col items-center text-center">
              {/* Ícone de Sucesso */}
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                <CheckCircle
                  size={40}
                  weight="fill"
                  className="text-green-600"
                />
              </div>

              {/* Título */}
              <h2 className="text-2xl font-bold text-[#000638] mb-2">
                Solicitação Enviada!
              </h2>

              {/* Mensagem */}
              <p className="text-gray-600 mb-6">
                Sua solicitação de renegociação foi enviada com sucesso e está{' '}
                <span className="font-semibold text-yellow-600">
                  em análise
                </span>
                .
              </p>

              {/* Status Badge */}
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-yellow-100 text-yellow-700 rounded-full text-sm font-semibold mb-6">
                <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></div>
                EM ANÁLISE
              </div>

              {/* Informações */}
              <div className="bg-blue-50 rounded-lg p-4 mb-6 w-full text-left">
                <p className="text-sm text-gray-700">
                  <strong>Próximos passos:</strong>
                </p>
                <ul className="text-sm text-gray-600 mt-2 space-y-1 list-disc list-inside">
                  <li>Nossa equipe analisará sua solicitação</li>
                  <li>Você receberá uma resposta em breve</li>
                  <li>Acompanhe o status em "Minhas Renegociações"</li>
                </ul>
              </div>

              {/* Botão Fechar */}
              <button
                onClick={() => setModalSucessoAberto(false)}
                className="w-full px-6 py-3 bg-[#000638] text-white rounded-lg font-semibold hover:bg-[#fe0000] transition-all"
              >
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Detalhes da Renegociação */}
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
                      : renegociacaoSelecionada.status === 'CONTRAPROPOSTA'
                      ? 'bg-orange-100 text-orange-700'
                      : 'bg-yellow-100 text-yellow-700'
                  }`}
                >
                  {renegociacaoSelecionada.status === 'ANALISE'
                    ? '⏳ EM ANÁLISE'
                    : renegociacaoSelecionada.status === 'APROVADO'
                    ? '✅ APROVADO'
                    : renegociacaoSelecionada.status === 'CONTRAPROPOSTA'
                    ? '🔄 CONTRAPROPOSTA'
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

              {/* Contraproposta Recebida */}
              {renegociacaoSelecionada.status === 'CONTRAPROPOSTA' &&
                renegociacaoSelecionada.contraproposta && (
                  <div className="bg-orange-50 border-2 border-orange-200 rounded-lg p-5">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 bg-orange-500 rounded-full flex items-center justify-center">
                        <Handshake
                          size={20}
                          weight="bold"
                          className="text-white"
                        />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-orange-900">
                          Contraproposta Recebida
                        </h3>
                        <p className="text-sm text-orange-700">
                          O financeiro enviou uma nova proposta
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                      <div className="bg-white rounded-lg p-3 border border-orange-200">
                        <p className="text-xs text-orange-700 mb-1">
                          Valor Total
                        </p>
                        <p className="text-lg font-bold text-orange-900">
                          {formatMoney(
                            renegociacaoSelecionada.contraproposta.vl_total,
                          )}
                        </p>
                      </div>
                      <div className="bg-white rounded-lg p-3 border border-orange-200">
                        <p className="text-xs text-orange-700 mb-1">
                          Forma de Pagamento
                        </p>
                        <p className="text-sm font-bold text-orange-900 capitalize">
                          {
                            renegociacaoSelecionada.contraproposta
                              .forma_pagamento
                          }
                        </p>
                      </div>
                      <div className="bg-white rounded-lg p-3 border border-orange-200">
                        <p className="text-xs text-orange-700 mb-1">Parcelas</p>
                        <p className="text-lg font-bold text-orange-900">
                          {renegociacaoSelecionada.contraproposta.nr_parcelas}x
                        </p>
                      </div>
                      <div className="bg-white rounded-lg p-3 border border-orange-200">
                        <p className="text-xs text-orange-700 mb-1">
                          Valor/Parcela
                        </p>
                        <p className="text-lg font-bold text-orange-900">
                          {formatMoney(
                            renegociacaoSelecionada.contraproposta.vl_parcela,
                          )}
                        </p>
                      </div>
                    </div>

                    {renegociacaoSelecionada.contraproposta.observacao && (
                      <div className="bg-white rounded-lg p-3 border border-orange-200 mb-4">
                        <p className="text-xs text-orange-700 mb-1 font-semibold">
                          Observação do Financeiro
                        </p>
                        <p className="text-sm text-gray-700">
                          {renegociacaoSelecionada.contraproposta.observacao}
                        </p>
                      </div>
                    )}

                    <div className="flex gap-3">
                      <button
                        onClick={async () => {
                          if (
                            !window.confirm(
                              'Tem certeza que deseja RECUSAR esta contraproposta?',
                            )
                          )
                            return;

                          setProcessandoAceite(true);
                          try {
                            const historicoAtual =
                              renegociacaoSelecionada.historico_negociacao ||
                              [];
                            const novoHistorico = [
                              ...historicoAtual,
                              {
                                tipo: 'RECUSA',
                                vl_total:
                                  renegociacaoSelecionada.contraproposta
                                    .vl_total,
                                forma_pagamento:
                                  renegociacaoSelecionada.contraproposta
                                    .forma_pagamento,
                                nr_parcelas:
                                  renegociacaoSelecionada.contraproposta
                                    .nr_parcelas,
                                dt: new Date().toISOString(),
                                user: user.name || user.email,
                                observacao:
                                  'Recusa da contraproposta pelo franqueado',
                              },
                            ];

                            const { error } = await supabase
                              .from('solicitacoes_renegociacoes')
                              .update({
                                status: 'REPROVADO',
                                historico_negociacao: novoHistorico,
                                dt_aprovacao: new Date().toISOString(),
                              })
                              .eq('id', renegociacaoSelecionada.id);

                            if (error) throw error;

                            alert('Contraproposta recusada com sucesso!');
                            setModalDetalhesAberto(false);
                            buscarRenegociacoes();
                          } catch (error) {
                            console.error('Erro ao recusar:', error);
                            alert('Erro ao processar recusa');
                          } finally {
                            setProcessandoAceite(false);
                          }
                        }}
                        disabled={processandoAceite}
                        className="flex-1 py-3 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        <X size={20} weight="bold" />
                        Recusar Contraproposta
                      </button>
                      <button
                        onClick={async () => {
                          if (
                            !window.confirm(
                              'Tem certeza que deseja ACEITAR esta contraproposta?',
                            )
                          )
                            return;

                          setProcessandoAceite(true);
                          try {
                            const historicoAtual =
                              renegociacaoSelecionada.historico_negociacao ||
                              [];
                            const novoHistorico = [
                              ...historicoAtual,
                              {
                                tipo: 'ACEITE',
                                vl_total:
                                  renegociacaoSelecionada.contraproposta
                                    .vl_total,
                                forma_pagamento:
                                  renegociacaoSelecionada.contraproposta
                                    .forma_pagamento,
                                nr_parcelas:
                                  renegociacaoSelecionada.contraproposta
                                    .nr_parcelas,
                                dt: new Date().toISOString(),
                                user: user.name || user.email,
                                observacao:
                                  'Aceite da contraproposta pelo franqueado',
                              },
                            ];

                            const { error } = await supabase
                              .from('solicitacoes_renegociacoes')
                              .update({
                                status: 'APROVADO',
                                historico_negociacao: novoHistorico,
                                dt_aprovacao: new Date().toISOString(),
                              })
                              .eq('id', renegociacaoSelecionada.id);

                            if (error) throw error;

                            alert('Contraproposta aceita com sucesso!');
                            setModalDetalhesAberto(false);
                            buscarRenegociacoes();
                          } catch (error) {
                            console.error('Erro ao aceitar:', error);
                            alert('Erro ao processar aceite');
                          } finally {
                            setProcessandoAceite(false);
                          }
                        }}
                        disabled={processandoAceite}
                        className="flex-1 py-3 bg-green-600 text-white rounded-lg font-bold hover:bg-green-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        <CheckCircle size={20} weight="bold" />
                        Aceitar Contraproposta
                      </button>
                    </div>
                  </div>
                )}

              {/* Histórico de Negociação */}
              {renegociacaoSelecionada.historico_negociacao &&
                renegociacaoSelecionada.historico_negociacao.length > 0 && (
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                      <h3 className="text-sm font-bold text-[#000638] flex items-center gap-2">
                        <List size={18} weight="bold" />
                        Histórico de Negociação
                      </h3>
                    </div>
                    <div className="divide-y divide-gray-200">
                      {renegociacaoSelecionada.historico_negociacao.map(
                        (item, idx) => (
                          <div key={idx} className="p-4 hover:bg-gray-50">
                            <div className="flex items-start gap-3">
                              <div
                                className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                                  item.tipo === 'SOLICITACAO'
                                    ? 'bg-blue-100'
                                    : item.tipo === 'CONTRAPROPOSTA'
                                    ? 'bg-orange-100'
                                    : item.tipo === 'ACEITE'
                                    ? 'bg-green-100'
                                    : 'bg-red-100'
                                }`}
                              >
                                {item.tipo === 'SOLICITACAO' ? (
                                  <PaperPlaneRight
                                    size={16}
                                    weight="bold"
                                    className="text-blue-600"
                                  />
                                ) : item.tipo === 'CONTRAPROPOSTA' ? (
                                  <Handshake
                                    size={16}
                                    weight="bold"
                                    className="text-orange-600"
                                  />
                                ) : item.tipo === 'ACEITE' ? (
                                  <CheckCircle
                                    size={16}
                                    weight="bold"
                                    className="text-green-600"
                                  />
                                ) : (
                                  <X
                                    size={16}
                                    weight="bold"
                                    className="text-red-600"
                                  />
                                )}
                              </div>
                              <div className="flex-1">
                                <div className="flex items-center justify-between mb-1">
                                  <span
                                    className={`text-xs font-bold px-2 py-0.5 rounded ${
                                      item.tipo === 'SOLICITACAO'
                                        ? 'bg-blue-100 text-blue-700'
                                        : item.tipo === 'CONTRAPROPOSTA'
                                        ? 'bg-orange-100 text-orange-700'
                                        : item.tipo === 'ACEITE'
                                        ? 'bg-green-100 text-green-700'
                                        : 'bg-red-100 text-red-700'
                                    }`}
                                  >
                                    {item.tipo === 'SOLICITACAO'
                                      ? 'Solicitação Inicial'
                                      : item.tipo === 'CONTRAPROPOSTA'
                                      ? 'Contraproposta'
                                      : item.tipo === 'ACEITE'
                                      ? 'Aceite'
                                      : 'Recusa'}
                                  </span>
                                  <span className="text-xs text-gray-500">
                                    {formatDate(item.dt)}
                                  </span>
                                </div>
                                <div className="grid grid-cols-3 gap-2 text-xs mb-2">
                                  <div>
                                    <span className="text-gray-500">
                                      Valor:
                                    </span>{' '}
                                    <span className="font-semibold text-gray-900">
                                      {formatMoney(item.vl_total)}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">
                                      Pagamento:
                                    </span>{' '}
                                    <span className="font-semibold text-gray-900 capitalize">
                                      {item.forma_pagamento}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">
                                      Parcelas:
                                    </span>{' '}
                                    <span className="font-semibold text-gray-900">
                                      {item.nr_parcelas}x
                                    </span>
                                  </div>
                                </div>
                                <div className="text-xs text-gray-600">
                                  <span className="font-semibold">
                                    {item.tipo === 'CONTRAPROPOSTA'
                                      ? 'Financeiro'
                                      : item.user}
                                    :
                                  </span>{' '}
                                  {item.observacao}
                                </div>
                              </div>
                            </div>
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                )}

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

              {/* Botão Fechar */}
              <div className="flex justify-end pt-4 border-t border-gray-200">
                <button
                  onClick={() => {
                    setModalDetalhesAberto(false);
                    setRenegociacaoSelecionada(null);
                  }}
                  className="px-6 py-2.5 bg-[#000638] text-white rounded-lg font-semibold hover:bg-[#fe0000] transition-all"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
