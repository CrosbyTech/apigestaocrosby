import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Check,
  Calendar,
  CurrencyDollar,
  User,
  FileText,
} from '@phosphor-icons/react';
import { getCategoriaPorCodigo } from '../config/categoriasDespesas';
import useApiClient from '../hooks/useApiClient';
import { adicionarDespesaManual } from '../services/despesasManuaisService';
import { useAuth } from './AuthContext';

const ModalAdicionarDespesaManual = ({
  isOpen,
  onClose,
  onSuccess,
  periodosSelecionados = [],
}) => {
  const api = useApiClient();
  const { user } = useAuth();

  // Estados do formulário
  const [tipoDespesa, setTipoDespesa] = useState('OPERACIONAL');
  const [codigoDespesa, setCodigoDespesa] = useState('');
  const [buscaDespesa, setBuscaDespesa] = useState(''); // 🆕 Campo de busca
  const [mostrarSugestoes, setMostrarSugestoes] = useState(false); // 🆕 Controle de dropdown
  const [fornecedor, setFornecedor] = useState('');
  const [codigoFornecedor, setCodigoFornecedor] = useState(null);
  const [valor, setValor] = useState('');
  const [observacoes, setObservacoes] = useState('');
  const [periodoSelecionado, setPeriodoSelecionado] = useState(null);

  // Estados de busca
  const [despesasDisponiveis, setDespesasDisponiveis] = useState([]);
  const [despesasAgrupadas, setDespesasAgrupadas] = useState({});
  const [fornecedoresDisponiveis, setFornecedoresDisponiveis] = useState([]);
  const [loadingDespesas, setLoadingDespesas] = useState(false);
  const [loadingFornecedores, setLoadingFornecedores] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  // 🔄 Buscar todas as despesas ao abrir o modal
  useEffect(() => {
    if (isOpen) {
      buscarDespesas();
    }
  }, [isOpen]);

  // 🔄 Reagrupar despesas quando mudar o tipo ou as despesas carregadas
  useEffect(() => {
    if (despesasDisponiveis.length > 0) {
      agruparDespesasPorCategoria();
    }
  }, [despesasDisponiveis]); // 🆕 Removido tipoDespesa das dependências

  // Inicializar período se houver apenas um
  useEffect(() => {
    if (isOpen && periodosSelecionados.length === 1 && !periodoSelecionado) {
      setPeriodoSelecionado(periodosSelecionados[0]);
    }
  }, [isOpen, periodosSelecionados, periodoSelecionado]);

  // 🆕 Fechar sugestões ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        mostrarSugestoes &&
        !event.target.closest('.autocomplete-container')
      ) {
        setMostrarSugestoes(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [mostrarSugestoes]);

  // 🔍 Buscar todas as despesas do backend
  const buscarDespesas = async () => {
    setLoadingDespesas(true);
    try {
      const response = await api.financial.despesasTodas();
      console.log('✅ Despesas carregadas:', response.data?.length || 0);
      setDespesasDisponiveis(response.data || []);
    } catch (error) {
      console.error('❌ Erro ao buscar despesas:', error);
      setDespesasDisponiveis([]);
    } finally {
      setLoadingDespesas(false);
    }
  };

  // 📊 Agrupar despesas por categoria (TODAS, sem filtro de tipo)
  const agruparDespesasPorCategoria = () => {
    const grupos = {};

    despesasDisponiveis.forEach((despesa) => {
      const codigo = despesa.cd_despesaitem;

      // 🆕 Não filtrar mais por tipo - mostrar TODAS as despesas
      // Obter categoria
      const categoria = getCategoriaPorCodigo(codigo);

      if (!grupos[categoria]) {
        grupos[categoria] = [];
      }

      grupos[categoria].push(despesa);
    });

    // Ordenar despesas dentro de cada grupo por código
    Object.keys(grupos).forEach((categoria) => {
      grupos[categoria].sort((a, b) => a.cd_despesaitem - b.cd_despesaitem);
    });

    setDespesasAgrupadas(grupos);
  };

  // Formatar valor para moeda brasileira
  const formatarValor = (valorString) => {
    // Remove tudo que não é dígito
    let numeros = valorString.replace(/\D/g, '');

    if (!numeros) return '';

    // Converte para número e divide por 100
    const numero = parseInt(numeros) / 100;

    // Formata para moeda brasileira
    return numero.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const handleValorChange = (e) => {
    const valorFormatado = formatarValor(e.target.value);
    setValor(valorFormatado);
  };

  // Converter valor formatado para número
  const valorNumerico = useMemo(() => {
    if (!valor) return 0;
    return parseFloat(valor.replace(/\./g, '').replace(',', '.'));
  }, [valor]);

  // 🆕 Filtrar despesas por busca
  const despesasFiltradas = useMemo(() => {
    if (!buscaDespesa.trim()) {
      return [];
    }

    const termoBusca = buscaDespesa.toLowerCase();
    const todasDespesas = [];

    // Juntar todas as despesas de todas as categorias
    Object.values(despesasAgrupadas).forEach((despesas) => {
      todasDespesas.push(...despesas);
    });

    // Filtrar por código ou descrição
    return todasDespesas
      .filter((despesa) => {
        const codigo = despesa.cd_despesaitem.toString();
        const descricao = despesa.ds_despesaitem.toLowerCase();

        return codigo.includes(termoBusca) || descricao.includes(termoBusca);
      })
      .slice(0, 50); // Limitar a 50 resultados para performance
  }, [buscaDespesa, despesasAgrupadas]);

  // 🆕 Selecionar despesa do autocomplete
  const selecionarDespesa = (despesa) => {
    setCodigoDespesa(despesa.cd_despesaitem.toString());
    setBuscaDespesa(`${despesa.cd_despesaitem} - ${despesa.ds_despesaitem}`);
    setMostrarSugestoes(false);

    // Definir automaticamente o tipo baseado no código
    const codigo = despesa.cd_despesaitem;
    if (codigo >= 7000 && codigo <= 7999) {
      setTipoDespesa('FINANCEIRA');
    } else {
      setTipoDespesa('OPERACIONAL');
    }
  };

  // 💾 Salvar despesa manual
  const handleSubmit = async (e) => {
    e.preventDefault();
    setErro('');

    // Validações
    if (!periodoSelecionado) {
      setErro('Selecione um período');
      return;
    }

    if (!codigoDespesa) {
      setErro('Selecione uma despesa');
      return;
    }

    if (valorNumerico <= 0) {
      setErro('Informe um valor válido maior que zero');
      return;
    }

    setSalvando(true);

    try {
      const despesaManual = {
        dt_inicio: periodoSelecionado.dt_inicio,
        dt_fim: periodoSelecionado.dt_fim,
        categoria_principal: tipoDespesa,
        cd_despesaitem: parseInt(codigoDespesa),
        fornecedor: fornecedor || null,
        cd_fornecedor: codigoFornecedor || null,
        valor: valorNumerico,
        observacoes: observacoes || null,
        cd_usuario: user?.cd_pessoa || null, // ID do usuário logado
      };

      console.log('💾 Salvando despesa manual no Supabase:', despesaManual);

      await adicionarDespesaManual(despesaManual);

      console.log('✅ Despesa salva com sucesso no Supabase!');

      // Limpar formulário
      limparFormulario();

      // Chamar callback de sucesso
      if (onSuccess) {
        onSuccess();
      }

      // Fechar modal
      onClose();
    } catch (error) {
      console.error('❌ Erro ao salvar despesa manual:', error);
      setErro(error.message || 'Erro ao salvar despesa. Tente novamente.');
    } finally {
      setSalvando(false);
    }
  };

  const limparFormulario = () => {
    setTipoDespesa('OPERACIONAL');
    setCodigoDespesa('');
    setFornecedor('');
    setCodigoFornecedor(null);
    setValor('');
    setObservacoes('');
    setPeriodoSelecionado(
      periodosSelecionados.length === 1 ? periodosSelecionados[0] : null,
    );
    setErro('');
  };

  const handleClose = () => {
    limparFormulario();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Cabeçalho */}
        <div className="sticky top-0 bg-[#000638] text-white px-6 py-4 flex items-center justify-between rounded-t-lg">
          <div className="flex items-center gap-3">
            <FileText className="w-6 h-6" weight="duotone" />
            <div>
              <h2 className="text-xl font-bold">Adicionar Despesa Manual</h2>
              <p className="text-sm text-gray-200 mt-0.5">
                Cadastre despesas que não estão no sistema principal
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="text-white hover:bg-white/20 p-2 rounded-lg transition-colors"
            type="button"
          >
            <X size={24} />
          </button>
        </div>

        {/* Conteúdo */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Erro Global */}
          {erro && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
              <X size={20} className="text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{erro}</p>
            </div>
          )}

          {/* 1️⃣ Período */}
          <div>
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
              <Calendar size={18} weight="duotone" />
              Período *
            </label>
            <select
              className="w-full border-2 border-gray-300 rounded-lg px-4 py-2.5 focus:border-[#000638] focus:ring-2 focus:ring-[#000638]/20 outline-none transition-all"
              value={periodoSelecionado?.id || ''}
              onChange={(e) => {
                const periodo = periodosSelecionados.find(
                  (p) => p.id === parseInt(e.target.value),
                );
                setPeriodoSelecionado(periodo);
              }}
              required
            >
              <option value="">Selecione o período</option>
              {periodosSelecionados.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label || `${p.dt_inicio} até ${p.dt_fim}`}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Escolha o período ao qual a despesa se refere
            </p>
          </div>

          {/* 2️⃣ Descrição da Despesa - AUTOCOMPLETE */}
          <div className="autocomplete-container">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Descrição da Despesa *
            </label>
            {loadingDespesas ? (
              <div className=" w-full border-2 border-gray-300 rounded-lg px-4 py-2.5 flex items-center justify-center text-gray-500">
                <span className="animate-pulse">Carregando despesas...</span>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  className=" w-full border-2 border-gray-300 rounded-lg px-4 py-2.5 focus:border-[#000638] focus:ring-2 focus:ring-[#000638]/20 outline-none transition-all"
                  value={buscaDespesa}
                  onChange={(e) => {
                    setBuscaDespesa(e.target.value);
                    setMostrarSugestoes(true);
                    if (!e.target.value.trim()) {
                      setCodigoDespesa('');
                    }
                  }}
                  onFocus={() => buscaDespesa && setMostrarSugestoes(true)}
                  placeholder="Digite o código ou nome da despesa..."
                  required
                />

                {/* Dropdown de Sugestões */}
                {mostrarSugestoes && despesasFiltradas.length > 0 && (
                  <div className="bg-white absolute z-10 w-96 mt-1 border-2 border-gray-300 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                    {despesasFiltradas.map((despesa) => {
                      const codigo = despesa.cd_despesaitem;
                      const isSelecionado = codigoDespesa === codigo.toString();

                      return (
                        <button
                          key={despesa.cd_despesaitem}
                          type="button"
                          onClick={() => selecionarDespesa(despesa)}
                          className={`w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors border-b border-gray-100 last:border-b-0 ${
                            isSelecionado ? 'bg-blue-100' : ''
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <span className="font-semibold text-gray-900">
                                {codigo}
                              </span>
                              <span className="text-gray-600 ml-2">
                                - {despesa.ds_despesaitem}
                              </span>
                            </div>
                            <span className="text-xs px-2 py-1 rounded bg-gray-200 text-gray-700">
                              {getCategoriaPorCodigo(codigo)}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Mensagem quando não encontrar */}
                {mostrarSugestoes &&
                  buscaDespesa.trim() &&
                  despesasFiltradas.length === 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border-2 border-gray-300 rounded-lg shadow-lg p-4 text-center text-gray-500">
                      Nenhuma despesa encontrada para "{buscaDespesa}"
                    </div>
                  )}
              </>
            )}
            <p className="text-xs text-gray-500 mt-1">
              Digite para buscar em todas as despesas disponíveis
              {codigoDespesa && (
                <span className="text-blue-600 font-medium ml-2">
                  ✓ Selecionado: Código {codigoDespesa}
                </span>
              )}
            </p>
          </div>

          {/* 3️⃣ Fornecedor */}
          <div>
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
              <User size={18} weight="duotone" />
              Fornecedor *
            </label>
            <input
              type="text"
              className="w-full border-2 border-gray-300 rounded-lg px-4 py-2.5 focus:border-[#000638] focus:ring-2 focus:ring-[#000638]/20 outline-none transition-all"
              value={fornecedor}
              onChange={(e) => setFornecedor(e.target.value)}
              placeholder="Nome do fornecedor"
              maxLength={200}
              required
            />
            <p className="text-xs text-gray-500 mt-1">
              Digite o nome do fornecedor relacionado a esta despesa
            </p>
          </div>

          {/* 4️⃣ Código do Fornecedor */}
          <div>
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
              Código do Fornecedor (opcional)
            </label>
            <input
              type="number"
              className="w-full border-2 border-gray-300 rounded-lg px-4 py-2.5 focus:border-[#000638] focus:ring-2 focus:ring-[#000638]/20 outline-none transition-all"
              value={codigoFornecedor || ''}
              onChange={(e) =>
                setCodigoFornecedor(
                  e.target.value ? parseInt(e.target.value) : null,
                )
              }
              placeholder="Ex: 1234"
              min="1"
            />
            <p className="text-xs text-gray-500 mt-1">
              Código do fornecedor no sistema TOTVS (se aplicável)
            </p>
          </div>

          {/* 5️⃣ Valor */}
          <div>
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
              <CurrencyDollar size={18} weight="duotone" />
              Valor *
            </label>
            <div className="">
              <input
                type="text"
                className="w-full border-2 border-gray-300 rounded-lg pl-4 pr-4 py-2.5 focus:border-[#000638] focus:ring-2 focus:ring-[#000638]/20 outline-none transition-all text-lg font-semibold"
                value={valor}
                onChange={handleValorChange}
                placeholder="R$ 0,00"
                required
              />
            </div>
            {valorNumerico > 0 && (
              <>
                <span className=" left-4 top-1/2 -translate-y-1/2 text-gray-500 font-medium">
                  R$
                </span>
                <p className="text-xs text-green-600 mt-1">
                  ✓ Valor: R${' '}
                  {valorNumerico.toLocaleString('pt-BR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </p>
              </>
            )}
          </div>

          {/* 6️⃣ Observações */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Observações
            </label>
            <textarea
              className="w-full border-2 border-gray-300 rounded-lg px-4 py-2.5 focus:border-[#000638] focus:ring-2 focus:ring-[#000638]/20 outline-none transition-all resize-none"
              rows="3"
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              placeholder="Informações adicionais sobre esta despesa (opcional)"
              maxLength={500}
            />
            <p className="text-xs text-gray-500 mt-1">
              {observacoes.length}/500 caracteres
            </p>
          </div>

          {/* Resumo */}
          {periodoSelecionado && codigoDespesa && valorNumerico > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm font-semibold text-blue-900 mb-2">
                📋 Resumo da Despesa
              </p>
              <div className="space-y-1 text-sm text-blue-800">
                <p>
                  <strong>Período:</strong>{' '}
                  {periodoSelecionado.label ||
                    `${periodoSelecionado.dt_inicio} até ${periodoSelecionado.dt_fim}`}
                </p>
                <p>
                  <strong>Tipo:</strong> {tipoDespesa}
                </p>
                <p>
                  <strong>Código:</strong> {codigoDespesa}
                </p>
                {fornecedor && (
                  <p>
                    <strong>Fornecedor:</strong> {fornecedor}
                  </p>
                )}
                <p className="text-lg font-bold text-blue-900 pt-1">
                  <strong>Valor:</strong> R${' '}
                  {valorNumerico.toLocaleString('pt-BR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </p>
              </div>
            </div>
          )}

          {/* Botões */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button
              type="button"
              onClick={handleClose}
              className="px-6 py-2.5 border-2 border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
              disabled={salvando}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-6 py-2.5 bg-[#000638] text-white rounded-lg hover:bg-[#000856] transition-colors font-semibold shadow-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={
                salvando ||
                !periodoSelecionado ||
                !codigoDespesa ||
                valorNumerico <= 0
              }
            >
              {salvando ? (
                <>
                  <span className="animate-spin">⏳</span>
                  <span>Salvando...</span>
                </>
              ) : (
                <>
                  <Check size={20} weight="bold" />
                  <span>Salvar Despesa</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ModalAdicionarDespesaManual;
