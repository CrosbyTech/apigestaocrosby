import React, { useState, useRef, useEffect } from 'react';

const FiltroCentroCusto = ({
  centrosCustoSelecionados = [],
  onSelectCentrosCusto,
  dadosCentroCusto = [],
}) => {
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef(null);

  // Filtrar centros de custo baseado no termo de busca
  const centrosCustoFiltrados = dadosCentroCusto.filter(
    (centroCusto) =>
      String(centroCusto.cd_ccusto)
        .toLowerCase()
        .includes(searchTerm.toLowerCase()) ||
      String(centroCusto.ds_ccusto)
        .toLowerCase()
        .includes(searchTerm.toLowerCase()),
  );

  const handleToggleCentroCusto = (centroCustoObj) => {
    let novosSelecionados;
    if (
      centrosCustoSelecionados.some(
        (centro) => centro.cd_ccusto === centroCustoObj.cd_ccusto,
      )
    ) {
      novosSelecionados = centrosCustoSelecionados.filter(
        (centro) => centro.cd_ccusto !== centroCustoObj.cd_ccusto,
      );
    } else {
      novosSelecionados = [...centrosCustoSelecionados, centroCustoObj];
    }
    if (onSelectCentrosCusto) onSelectCentrosCusto(novosSelecionados);
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
        Centro de Custo
      </label>

      {/* Botão do dropdown */}
      <button
        type="button"
        onClick={() => setShowDropdown(!showDropdown)}
        disabled={dadosCentroCusto.length === 0}
        className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-left flex items-center justify-between disabled:opacity-50 disabled:cursor-not-allowed text-xs"
      >
        <span className="truncate">
          {dadosCentroCusto.length === 0
            ? 'Nenhum centro de custo disponível'
            : centrosCustoSelecionados.length === 0
              ? 'Selecione os centros de custo'
              : `${centrosCustoSelecionados.length} centro(s) selecionado(s)`}
        </span>
        {dadosCentroCusto.length === 0 ? (
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
            className={`w-4 h-4 transition-transform ${showDropdown ? 'rotate-180' : ''}`}
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
        <div className="w-full absolute top-full left-0 right-0 z-50 bg-white border border-gray-300 rounded-lg shadow-lg mt-1 max-h-100 overflow-hidden">
          {/* Campo de busca */}
          <div className="p-3 border-b border-gray-200">
            <input
              type="text"
              placeholder="Buscar centro de custo..."
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
                if (onSelectCentrosCusto)
                  onSelectCentrosCusto([...dadosCentroCusto]);
              }}
              className="text-xs px-2 py-1 bg-[#000638] text-white rounded hover:bg-[#fe0000] transition-colors"
            >
              Selecionar Todos
            </button>
            <button
              type="button"
              onClick={() => {
                if (onSelectCentrosCusto) onSelectCentrosCusto([]);
              }}
              className="text-xs px-2 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
            >
              Limpar
            </button>
          </div>

          {/* Lista de centros de custo */}
          <div className="w-full max-h-48 overflow-y-auto">
            {dadosCentroCusto.length === 0 ? (
              <div className="p-3 text-gray-500 text-sm text-center">
                Nenhum centro de custo disponível
              </div>
            ) : centrosCustoFiltrados.length === 0 ? (
              <div className="p-3 text-gray-500 text-sm text-center">
                Nenhum centro de custo encontrado
              </div>
            ) : (
              centrosCustoFiltrados.map((centroCusto) => {
                const isSelected = centrosCustoSelecionados.some(
                  (centro) => centro.cd_ccusto === centroCusto.cd_ccusto,
                );
                return (
                  <div
                    key={centroCusto.cd_ccusto}
                    className={`px-2 py-2 hover:bg-gray-50 cursor-pointer flex items-start mb-1 ${
                      isSelected ? 'bg-blue-50' : ''
                    }`}
                    onClick={() => handleToggleCentroCusto(centroCusto)}
                  >
                    <div className="flex flex-col flex-1">
                      <span className="text-xs font-medium text-gray-900">
                        {centroCusto.cd_ccusto} - {centroCusto.ds_ccusto}
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

export default FiltroCentroCusto;
