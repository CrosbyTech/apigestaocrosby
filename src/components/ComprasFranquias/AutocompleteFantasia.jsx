import React, { memo } from 'react';
import { useAutocompleteFranquias } from '../../hooks/useAutocompleteFranquias';

/**
 * Componente de autocomplete para nomes fantasia
 * Otimizado com React.memo para evitar re-renders desnecessários
 */
const AutocompleteFantasia = memo(({ 
  onSelectionChange,
  className = "",
  placeholder = "Digite o nome fantasia",
  disabled = false 
}) => {
  const {
    nmFantasia,
    sugestoes,
    showSugestoes,
    nmFantasiaSelecionados,
    loadingSugestoes,
    handleChangeNmFantasia,
    handleFocus,
    handleBlur,
    handleSugestaoToggle,
    handleRemoveSelecionado,
  } = useAutocompleteFranquias();

  // Notifica componente pai sobre mudanças na seleção
  React.useEffect(() => {
    onSelectionChange?.(nmFantasiaSelecionados);
  }, [nmFantasiaSelecionados, onSelectionChange]);

  return (
    <div className={`relative ${className}`}>
      {/* Label */}
      <label className="block text-xs font-semibold mb-1 text-[#000638]">
        Nome Fantasia
      </label>
      
      {/* Input principal */}
      <div className="relative">
        <input
          type="text"
          name="nm_fantasia"
          autoComplete="off"
          value={nmFantasia}
          onChange={handleChangeNmFantasia}
          onFocus={handleFocus}
          onBlur={handleBlur}
          disabled={disabled}
          className={`
            border border-[#000638]/30 rounded-lg px-3 py-2 w-full 
            focus:outline-none focus:ring-2 focus:ring-[#000638] 
            bg-[#f8f9fb] text-[#000638] placeholder:text-gray-400
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-all duration-200 ease-in-out
          `}
          placeholder={placeholder}
          aria-label="Campo de busca para nome fantasia"
          aria-expanded={showSugestoes}
          aria-haspopup="listbox"
          role="combobox"
        />
        
        {/* Indicador de loading */}
        {loadingSugestoes && (
          <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
            <div className="animate-spin h-4 w-4 border-2 border-[#000638] border-t-transparent rounded-full" />
          </div>
        )}
      </div>

      {/* Lista de sugestões */}
      {showSugestoes && sugestoes.length > 0 && (
        <div 
          className="absolute z-20 bg-white border border-gray-200 rounded-lg shadow-lg w-full max-h-40 overflow-y-auto mt-1"
          role="listbox"
          aria-label="Sugestões de nomes fantasia"
        >
          {sugestoes.map((sugestao, index) => (
            <div
              key={`${sugestao}-${index}`}
              className={`
                px-3 py-2 hover:bg-gray-100 cursor-pointer 
                flex items-center justify-between gap-2 
                select-none transition-colors duration-150
                ${nmFantasiaSelecionados.includes(sugestao) ? 'bg-blue-50' : ''}
              `}
              role="option"
              aria-selected={nmFantasiaSelecionados.includes(sugestao)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSugestaoToggle(sugestao)}
            >
              <span className="text-left w-full text-sm text-gray-700">
                {sugestao}
              </span>
              <input
                type="checkbox"
                checked={nmFantasiaSelecionados.includes(sugestao)}
                readOnly
                className="accent-[#000638] pointer-events-none"
                tabIndex={-1}
                aria-hidden="true"
              />
            </div>
          ))}
        </div>
      )}

      {/* Tags de itens selecionados */}
      {nmFantasiaSelecionados.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2" role="group" aria-label="Itens selecionados">
          {nmFantasiaSelecionados.map((nm, index) => (
            <span 
              key={`selected-${nm}-${index}`}
              className={`
                bg-[#000638] text-white px-3 py-1 rounded-full 
                flex items-center gap-2 text-sm
                transition-all duration-200 ease-in-out
                hover:bg-[#000638]/90
              `}
            >
              <span className="max-w-32 truncate" title={nm}>
                {nm}
              </span>
              <button 
                type="button" 
                className="text-white hover:text-red-300 transition-colors duration-150 font-bold text-lg leading-none"
                onClick={() => handleRemoveSelecionado(nm)}
                title={`Remover ${nm}`}
                aria-label={`Remover ${nm} da seleção`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      
      {/* Contador de seleções */}
      {nmFantasiaSelecionados.length > 0 && (
        <div className="text-xs text-gray-500 mt-1">
          {nmFantasiaSelecionados.length} franquia{nmFantasiaSelecionados.length > 1 ? 's' : ''} selecionada{nmFantasiaSelecionados.length > 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
});

AutocompleteFantasia.displayName = 'AutocompleteFantasia';

export default AutocompleteFantasia;