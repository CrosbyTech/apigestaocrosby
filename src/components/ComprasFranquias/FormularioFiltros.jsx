import React, { memo, useState, useCallback, useEffect } from 'react';
import { ArrowsClockwise, CurrencyDollar } from '@phosphor-icons/react';
import FiltroEmpresa from '../FiltroEmpresa';
import { THEME_COLORS, ERROR_MESSAGES } from '../../config/constants';

/**
 * Componente de formulário de filtros otimizado
 * Usa React.memo e callbacks para evitar re-renders desnecessários
 */
const FormularioFiltros = memo(({
  onSubmit,
  loading = false,
  erro = '',
  initialValues = {
    dt_inicio: '',
    dt_fim: '',
    empresasSelecionadas: []
  }
}) => {
  // Estados locais do formulário
  const [filtros, setFiltros] = useState(initialValues);

  // Preenche datas padrão do mês atual caso não venham definidas
  useEffect(() => {
    setFiltros(prev => {
      const today = new Date();
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
      const fmt = (d) => d.toISOString().split('T')[0];
      return {
        ...prev,
        dt_inicio: prev.dt_inicio || fmt(firstDay),
        dt_fim: prev.dt_fim || fmt(today)
      };
    });
  }, []);
  // Removido filtro de nome fantasia

  // Validação de data
  const validateDates = useCallback((dtInicio, dtFim) => {
    if (!dtInicio || !dtFim) return true; // Datas opcionais
    
    const inicio = new Date(dtInicio);
    const fim = new Date(dtFim);
    const hoje = new Date();
    
    // Verifica se as datas são válidas
    if (isNaN(inicio.getTime()) || isNaN(fim.getTime())) {
      return 'Datas inválidas';
    }
    
    // Verifica se data inicial é anterior à final
    if (inicio > fim) {
      return 'Data inicial deve ser anterior à data final';
    }
    
    // Verifica se as datas não são futuras
    if (inicio > hoje || fim > hoje) {
      return 'Datas não podem ser futuras';
    }
    
    return true;
  }, []);

  // Handler para mudança nos campos de data
  const handleDateChange = useCallback((field, value) => {
    setFiltros(prev => ({
      ...prev,
      [field]: value
    }));
  }, []);

  // Handler para mudança na seleção de empresas
  const handleEmpresasChange = useCallback((empresas) => {
    setFiltros(prev => ({
      ...prev,
      empresasSelecionadas: empresas
    }));
  }, []);

  // Handler para mudança na seleção de franquias
  // Removido filtro de nome fantasia

  // Handler do submit do formulário
  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    
    // Validação de empresas obrigatórias
    if (!filtros.empresasSelecionadas?.length) {
      return;
    }
    
    // Validação de datas
    const dateValidation = validateDates(filtros.dt_inicio, filtros.dt_fim);
    if (dateValidation !== true) {
      // Aqui você pode adicionar um toast ou outra notificação
      console.error(dateValidation);
      return;
    }
    
    // Chama callback do componente pai
    onSubmit?.({
      ...filtros
    });
  }, [filtros, validateDates, onSubmit]);

  // Função para resetar filtros
  const handleReset = useCallback(() => {
    setFiltros(initialValues);
    setNmFantasiaSelecionados([]);
  }, [initialValues]);

  return (
    <div className="mb-8">
      <form 
        onSubmit={handleSubmit} 
        className="flex flex-col bg-white p-6 md:p-8 rounded-2xl shadow-lg w-full max-w-6xl mx-auto border border-[#000638]/10"
        noValidate
      >
        {/* Cabeçalho do formulário */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <CurrencyDollar 
              size={22} 
              weight="bold" 
              style={{ color: THEME_COLORS.PRIMARY }}
              aria-hidden="true"
            />
            <span className="text-lg font-bold text-[#000638]">
              Filtros de Consulta
            </span>
          </div>
          <span className="text-sm text-gray-500">
            Selecione o período, as lojas e as franquias para consultar
          </span>
        </div>

        {/* Grid responsivo dos filtros */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 mb-6">
          {/* Filtro de Empresas - ocupa mais espaço */}
          <div className="lg:col-span-4">
            <FiltroEmpresa
              empresasSelecionadas={filtros.empresasSelecionadas}
              onSelectEmpresas={handleEmpresasChange}
              disabled={loading}
            />
          </div>

          {/* Removido filtro Nome Fantasia */}

          {/* Filtros de Data */}
          <div className="lg:col-span-2">
            <label className="block text-xs font-semibold mb-1 text-[#000638]">
              Data Inicial
            </label>
            <input 
              type="date" 
              name="dt_inicio" 
              value={filtros.dt_inicio} 
              onChange={(e) => handleDateChange('dt_inicio', e.target.value)}
              disabled={loading}
              className={`
                border border-[#000638]/30 rounded-lg px-3 py-2 w-full 
                focus:outline-none focus:ring-2 focus:ring-[#000638] 
                bg-[#f8f9fb] text-[#000638] 
                disabled:opacity-50 disabled:cursor-not-allowed
                transition-all duration-200
              `}
              aria-label="Data inicial para filtro"
            />
          </div>

          <div className="lg:col-span-2">
            <label className="block text-xs font-semibold mb-1 text-[#000638]">
              Data Final
            </label>
            <input 
              type="date" 
              name="dt_fim" 
              value={filtros.dt_fim} 
              onChange={(e) => handleDateChange('dt_fim', e.target.value)}
              disabled={loading}
              className={`
                border border-[#000638]/30 rounded-lg px-3 py-2 w-full 
                focus:outline-none focus:ring-2 focus:ring-[#000638] 
                bg-[#f8f9fb] text-[#000638] 
                disabled:opacity-50 disabled:cursor-not-allowed
                transition-all duration-200
              `}
              aria-label="Data final para filtro"
            />
          </div>
        </div>

        {/* Resumo das seleções em mobile */}
        <div className="block lg:hidden mb-4 p-3 bg-gray-50 rounded-lg text-sm">
          <div className="text-gray-600">
            <strong>Empresas:</strong> {filtros.empresasSelecionadas?.length || 0} selecionada(s)
          </div>
          {/* Removido resumo de franquias */}
        </div>

        {/* Botões de ação */}
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
          {/* Botão de reset */}
          <button 
            type="button"
            onClick={handleReset}
            disabled={loading}
            className={`
              text-gray-600 hover:text-gray-800 font-medium text-sm
              disabled:opacity-50 disabled:cursor-not-allowed
              transition-colors duration-200
            `}
          >
            Limpar Filtros
          </button>

          {/* Botão de submit */}
          <button 
            type="submit" 
            disabled={loading || !filtros.empresasSelecionadas?.length}
            className={`
              flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg 
              font-bold text-sm shadow-md tracking-wide uppercase
              transition-all duration-200 ease-in-out
              min-w-[140px] h-10
              ${loading || !filtros.empresasSelecionadas?.length
                ? 'bg-gray-400 cursor-not-allowed text-gray-200'
                : 'bg-[#000638] hover:bg-[#fe0000] text-white hover:shadow-lg transform hover:scale-105'
              }
            `}
            aria-label={loading ? 'Carregando dados' : 'Filtrar dados'}
          >
            {loading ? (
              <>
                <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                Carregando...
              </>
            ) : (
              <>
                <ArrowsClockwise size={18} weight="bold" /> 
                Filtrar
              </>
            )}
          </button>
        </div>
      </form>

      {/* Mensagens de erro */}
      {erro && (
        <div 
          className="mt-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-center"
          role="alert"
          aria-live="polite"
        >
          <div className="flex items-center justify-center gap-2">
            <span className="text-red-500">⚠️</span>
            <span className="font-medium">{erro}</span>
          </div>
        </div>
      )}

      {/* Validação de empresas em tempo real */}
      {!loading && !filtros.empresasSelecionadas?.length && (
        <div 
          className="mt-2 text-orange-600 text-sm text-center"
          role="status"
          aria-live="polite"
        >
          💡 {ERROR_MESSAGES.SELECT_COMPANY}
        </div>
      )}
    </div>
  );
});

FormularioFiltros.displayName = 'FormularioFiltros';

export default FormularioFiltros;