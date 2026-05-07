import React, { useEffect, useRef, useState } from 'react';

const FiltroVendedor = ({ vendedoresSelecionados = [], onSelectVendedores, dadosVendedor = [] }) => {
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef(null);

  const vendedoresFiltrados = (dadosVendedor || []).filter((vend) => {
    const codigo = (vend.cd_vendedor || vend.id || '').toString().toLowerCase();
    const nome = (vend.nome_vendedor || vend.vendedor || vend.nm_vendedor || vend.nome || '').toLowerCase();
    const t = searchTerm.toLowerCase();
    return codigo.includes(t) || nome.includes(t);
  });

  const handleToggle = (vendedorObj) => {
    const vendId = vendedorObj.cd_vendedor || vendedorObj.id || (vendedorObj.nome_vendedor || vendedorObj.nome || vendedorObj.vendedor);
    let novos;
    if (vendedoresSelecionados.some((v) => (v.cd_vendedor || v.id || (v.nome_vendedor || v.nome || v.vendedor)) === vendId)) {
      novos = vendedoresSelecionados.filter((v) => (v.cd_vendedor || v.id || (v.nome_vendedor || v.nome || v.vendedor)) !== vendId);
    } else {
      novos = [...vendedoresSelecionados, vendedorObj];
    }
    if (onSelectVendedores) onSelectVendedores(novos);
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="flex flex-col relative" ref={dropdownRef}>
      <label className="block text-xs font-semibold mb-0.5 text-[#000638]">Vendedor</label>
      <button
        type="button"
        onClick={() => setShowDropdown(!showDropdown)}
        disabled={(dadosVendedor || []).length === 0}
        className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-left flex items-center justify-between disabled:opacity-50 disabled:cursor-not-allowed text-xs"
      >
        <span className="truncate">
          {dadosVendedor.length === 0
            ? 'Nenhum vendedor disponível'
            : vendedoresSelecionados.length === 0
              ? 'Selecione os vendedores'
              : `${vendedoresSelecionados.length} vendedor(es) selecionado(s)`}
        </span>
        <svg className={`w-4 h-4 transition-transform ${showDropdown ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {showDropdown && (
        <div className="w-72 absolute top-full left-0 right-0 z-50 bg-white border border-gray-300 rounded-lg shadow-lg mt-1 max-h-100 overflow-hidden">
          <div className="p-3 border-b border-gray-200">
            <input
              type="text"
              placeholder="Buscar vendedor..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#000638] text-sm"
            />
          </div>
          <div className="p-3 border-b border-gray-200 bg-gray-50 flex gap-2">
            <button
              type="button"
              onClick={() => onSelectVendedores && onSelectVendedores([...(dadosVendedor || [])])}
              className="text-xs px-2 py-1 bg-[#000638] text-white rounded hover:bg-[#fe0000] transition-colors"
            >
              Selecionar Todos
            </button>
            <button
              type="button"
              onClick={() => onSelectVendedores && onSelectVendedores([])}
              className="text-xs px-2 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
            >
              Limpar
            </button>
          </div>
          <div className="w-full max-h-48 overflow-y-auto">
            {dadosVendedor.length === 0 ? (
              <div className="p-3 text-gray-500 text-sm text-center">Nenhum vendedor disponível</div>
            ) : vendedoresFiltrados.length === 0 ? (
              <div className="p-3 text-gray-500 text-sm text-center">Nenhum vendedor encontrado</div>
            ) : (
              vendedoresFiltrados.map((vend) => {
                const vendId = vend.cd_vendedor || vend.id || (vend.nome_vendedor || vend.nome || vend.vendedor);
                const isSelected = vendedoresSelecionados.some((v) => (v.cd_vendedor || v.id || (v.nome_vendedor || v.nome || v.vendedor)) === vendId);
                const nome = vend.nome_vendedor || vend.vendedor || vend.nm_vendedor || vend.nome || 'Vendedor';
                return (
                  <div
                    key={vendId}
                    className={`px-2 py-2 hover:bg-gray-50 cursor-pointer flex items-start mb-1 ${isSelected ? 'bg-blue-50' : ''}`}
                    onClick={() => handleToggle(vend)}
                  >
                    <div className="flex flex-col flex-1">
                      <span className="text-xs font-medium text-gray-900">{nome}</span>
                    </div>
                    <input type="checkbox" checked={isSelected} readOnly className="rounded border-gray-300 text-[#000638] focus:ring-[#000638] mr-1 w-4 h-4" onClick={(e) => e.stopPropagation()} />
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

export default FiltroVendedor;


