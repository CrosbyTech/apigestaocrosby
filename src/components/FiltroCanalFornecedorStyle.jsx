import React, { useState, useRef, useEffect } from 'react';

const canais = [
  { value: 'varejo', label: 'Varejo' },
  { value: 'mtm', label: 'Multimarcas' },
  { value: 'franquias', label: 'Franquias' },
  { value: 'revenda', label: 'Revenda' },
];

export default function FiltroCanalFornecedorStyle({
  canaisSelecionados = [],
  onSelectCanais,
}) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef(null);

  // Filtrar canais pelo termo de busca
  const canaisFiltrados = canais.filter((canal) =>
    canal.label.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const handleToggleCanal = (canalObj) => {
    let novosSelecionados;
    if (canaisSelecionados.includes(canalObj.value)) {
      novosSelecionados = canaisSelecionados.filter(
        (c) => c !== canalObj.value,
      );
    } else {
      novosSelecionados = [...canaisSelecionados, canalObj.value];
    }
    if (onSelectCanais) onSelectCanais(novosSelecionados);
  };

  // Fechar dropdown ao clicar fora
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
      <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
        Canal
      </label>
      <button
        type="button"
        onClick={() => setShowDropdown(!showDropdown)}
        className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-left flex items-center justify-between text-xs"
      >
        <span className="truncate">
          {canaisSelecionados.length === 0
            ? 'Selecione os canais'
            : `${canaisSelecionados.length} canal(is) selecionado(s)`}
        </span>
        <svg
          className={`w-4 h-4 transition-transform ${
            showDropdown ? 'rotate-180' : ''
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>
      {showDropdown && (
        <div className="w-72 absolute top-full left-0 right-0 z-50 bg-white border border-gray-300 rounded-lg shadow-lg mt-1 max-h-100 overflow-hidden">
          <div className="p-3 border-b border-gray-200">
            <input
              type="text"
              placeholder="Buscar canal..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#000638] text-sm"
            />
          </div>
          <div className="p-3 border-b border-gray-200 bg-gray-50 flex gap-2">
            <button
              type="button"
              onClick={() => onSelectCanais(canais.map((c) => c.value))}
              className="text-xs px-2 py-1 bg-[#000638] text-white rounded hover:bg-[#fe0000] transition-colors"
            >
              Selecionar Todos
            </button>
            <button
              type="button"
              onClick={() => onSelectCanais([])}
              className="text-xs px-2 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
            >
              Limpar
            </button>
          </div>
          <div className="w-full max-h-48 overflow-y-auto">
            {canaisFiltrados.length === 0 ? (
              <div className="p-3 text-gray-500 text-sm text-center">
                Nenhum canal encontrado
              </div>
            ) : (
              canaisFiltrados.map((canal) => {
                const isSelected = canaisSelecionados.includes(canal.value);
                return (
                  <div
                    key={canal.value}
                    className={`px-2 py-2 hover:bg-gray-50 cursor-pointer flex items-start mb-1 ${
                      isSelected ? 'bg-blue-50' : ''
                    }`}
                    onClick={() => handleToggleCanal(canal)}
                  >
                    <div className="flex flex-col flex-1">
                      <span className="text-xs font-medium text-gray-900">
                        {canal.label}
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
}
