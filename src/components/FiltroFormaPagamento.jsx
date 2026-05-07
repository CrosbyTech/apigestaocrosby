import React, { useState, useRef, useEffect } from 'react';

const FiltroFormaPagamento = ({ formasPagamentoSelecionadas = [], onSelectFormasPagamento, dadosFormasPagamento = [] }) => {
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef(null);

  // Filtrar formas de pagamento baseado no termo de busca
  const formasPagamentoFiltradas = dadosFormasPagamento.filter(forma =>
    forma.codigo?.toString().toLowerCase().includes(searchTerm.toLowerCase()) ||
    forma.descricao?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleToggleFormaPagamento = (formaObj) => {
    let novosSelecionados;
    if (formasPagamentoSelecionadas.some(forma => forma.codigo?.toString() === formaObj.codigo?.toString())) {
      novosSelecionados = formasPagamentoSelecionadas.filter(forma => forma.codigo?.toString() !== formaObj.codigo?.toString());
    } else {
      novosSelecionados = [...formasPagamentoSelecionadas, formaObj];
    }
    if (onSelectFormasPagamento) onSelectFormasPagamento(novosSelecionados);
  };

  // Fechar dropdown quando clicar fora
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <div className="flex flex-col relative" ref={dropdownRef}>
      <label className="block text-xs font-semibold mb-0.5 text-[#000638]">Forma de Pagamento</label>
      
      {/* Botão do dropdown */}
      <button
        type="button"
        onClick={() => setShowDropdown(!showDropdown)}
        disabled={dadosFormasPagamento.length === 0}
        className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-left flex items-center justify-between disabled:opacity-50 disabled:cursor-not-allowed text-xs"
      >
        <span className="truncate">
          {dadosFormasPagamento.length === 0 
            ? 'Nenhuma forma de pagamento disponível' 
            : formasPagamentoSelecionadas.length === 0 
              ? 'Selecione as formas de pagamento' 
              : `${formasPagamentoSelecionadas.length} forma(s) selecionada(s)`
          }
        </span>
        {dadosFormasPagamento.length === 0 ? (
          <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        ) : (
          <svg 
            className={`w-4 h-4 transition-transform ${showDropdown ? 'rotate-180' : ''}`} 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {/* Dropdown */}
      {showDropdown && (
        <div className="w-60 absolute top-full left-0 right-0 z-50 bg-white border border-gray-300 rounded-lg shadow-lg mt-1 max-h-100 overflow-hidden">
          {/* Campo de busca */}
          <div className="p-3 border-b border-gray-200">
            <input
              type="text"
              placeholder="Buscar forma de pagamento..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#000638] text-sm"
            />
          </div>

          {/* Botões de ação */}
          <div className="p-3 border-b border-gray-200 bg-gray-50 flex gap-2">
            <button
              type="button"
              onClick={() => {
                if (onSelectFormasPagamento) onSelectFormasPagamento([...dadosFormasPagamento]);
              }}
              className="text-xs px-2 py-1 bg-[#000638] text-white rounded hover:bg-[#fe0000] transition-colors"
            >
              Selecionar Todos
            </button>
            <button
              type="button"
              onClick={() => {
                if (onSelectFormasPagamento) onSelectFormasPagamento([]);
              }}
              className="text-xs px-2 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
            >
              Limpar
            </button>
          </div>

          {/* Lista de formas de pagamento */}
          <div className="w-full max-h-48 overflow-y-auto">
            {dadosFormasPagamento.length === 0 ? (
              <div className="p-3 text-gray-500 text-sm text-center">
                Nenhuma forma de pagamento disponível
              </div>
            ) : formasPagamentoFiltradas.length === 0 ? (
              <div className="p-3 text-gray-500 text-sm text-center">
                Nenhuma forma de pagamento encontrada
              </div>
            ) : (
              formasPagamentoFiltradas.map((forma) => {
                const isSelected = formasPagamentoSelecionadas.some(fp => fp.codigo?.toString() === forma.codigo?.toString());
                return (
                  <div
                    key={`forma-${forma.codigo}`}
                    className={`px-2 py-2 hover:bg-gray-50 cursor-pointer flex items-start mb-1 ${
                      isSelected ? 'bg-blue-50' : ''
                    }`}
                    onClick={() => handleToggleFormaPagamento(forma)}
                  >
                    <div className="flex flex-row w-full">
                      <span className="text-xs font-medium text-gray-900 truncate whitespace-nowrap">
                        {(forma.codigo + ' - ' + (forma.descricao || '')).replace(/\s+/g, ' ').trim()}
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      readOnly
                      className="rounded border-gray-300 text-[#000638] focus:ring-[#000638] mr-1 w-4 h-4"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default FiltroFormaPagamento;
