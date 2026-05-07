import React, { useState, useRef, useEffect } from 'react';

const FiltroLoja = ({
  lojasSelecionadas = [],
  onSelectLojas,
  dadosLoja = [],
  tipoLoja = 'Todos',
}) => {
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef(null);

  // Filtrar lojas baseado no tipo e termo de busca
  const lojasFiltradas = dadosLoja.filter((loja) => {
    // Filtro por tipo de loja
    if (tipoLoja !== 'Todos') {
      const nomeFantasia =
        loja.nome_fantasia?.toUpperCase() || loja.nm_loja?.toUpperCase() || '';

      if (tipoLoja === 'Franquias') {
        // Considerar franquia se o nome contém "F0" (padrão de código de franquia)
        const isFranquia = nomeFantasia.includes('F0');
        return isFranquia;
      }

      if (tipoLoja === 'Proprias') {
        // Considerar própria se o nome NÃO contém "F0"
        const isFranquia =
          nomeFantasia.includes('-') || nomeFantasia.includes('- CROSBY');
        return !isFranquia;
      }
    }

    // Filtro por termo de busca
    return (
      loja.cd_loja
        ?.toString()
        .toLowerCase()
        .includes(searchTerm.toLowerCase()) ||
      loja.nm_loja?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      loja.nome_fantasia?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  const handleToggleLoja = (lojaObj) => {
    let novosSelecionados;
    const lojaId = lojaObj.cd_loja || lojaObj.id;
    if (
      lojasSelecionadas.some((loja) => (loja.cd_loja || loja.id) === lojaId)
    ) {
      novosSelecionados = lojasSelecionadas.filter(
        (loja) => (loja.cd_loja || loja.id) !== lojaId,
      );
    } else {
      novosSelecionados = [...lojasSelecionadas, lojaObj];
    }
    if (onSelectLojas) onSelectLojas(novosSelecionados);
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
      <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
        Loja
      </label>

      {/* Botão do dropdown */}
      <button
        type="button"
        onClick={() => setShowDropdown(!showDropdown)}
        disabled={dadosLoja.length === 0}
        className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-left flex items-center justify-between disabled:opacity-50 disabled:cursor-not-allowed text-xs"
      >
        <span className="truncate">
          {dadosLoja.length === 0
            ? 'Nenhuma loja disponível'
            : lojasSelecionadas.length === 0
            ? 'Selecione as lojas'
            : `${lojasSelecionadas.length} loja(s) selecionada(s)`}
        </span>
        {dadosLoja.length === 0 ? (
          <svg
            className="w-4 h-4 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
            />
          </svg>
        ) : (
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
        )}
      </button>

      {/* Dropdown */}
      {showDropdown && (
        <div className="w-72 absolute top-full left-0 right-0 z-50 bg-white border border-gray-300 rounded-lg shadow-lg mt-1 max-h-100 overflow-hidden">
          {/* Campo de busca */}
          <div className="p-3 border-b border-gray-200">
            <input
              type="text"
              placeholder="Buscar loja..."
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
                if (onSelectLojas) onSelectLojas([...lojasFiltradas]);
              }}
              className="text-xs px-2 py-1 bg-[#000638] text-white rounded hover:bg-[#fe0000] transition-colors"
            >
              Selecionar {tipoLoja !== 'Todos' ? 'Filtradas' : 'Todas'}
            </button>
            <button
              type="button"
              onClick={() => {
                if (onSelectLojas) onSelectLojas([]);
              }}
              className="text-xs px-2 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
            >
              Limpar
            </button>
          </div>

          {/* Lista de lojas */}
          <div className="w-full max-h-48 overflow-y-auto">
            {dadosLoja.length === 0 ? (
              <div className="p-3 text-gray-500 text-sm text-center">
                Nenhuma loja disponível
              </div>
            ) : lojasFiltradas.length === 0 ? (
              <div className="p-3 text-gray-500 text-sm text-center">
                Nenhuma loja encontrada
              </div>
            ) : (
              lojasFiltradas.map((loja) => {
                const lojaId = loja.cd_loja || loja.id;
                const isSelected = lojasSelecionadas.some(
                  (lojaSel) => (lojaSel.cd_loja || lojaSel.id) === lojaId,
                );
                return (
                  <div
                    key={lojaId}
                    className={`px-2 py-2 hover:bg-gray-50 cursor-pointer flex items-start mb-1 ${
                      isSelected ? 'bg-blue-50' : ''
                    }`}
                    onClick={() => handleToggleLoja(loja)}
                  >
                    <div className="flex flex-col flex-1">
                      <span className="text-xs font-medium text-gray-900">
                        {loja.cd_loja || loja.id} -{' '}
                        {loja.nome_fantasia || loja.nm_loja || 'Loja'}
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

export default FiltroLoja;
