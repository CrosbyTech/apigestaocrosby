import React, { useState, useRef, useEffect, useMemo } from 'react';

const FiltroClientes = ({
  clientes = [],
  selected = [],
  onChange = () => {},
  label = 'Nome do Cliente',
}) => {
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target))
        setShowDropdown(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggle = (cd) => {
    if (selected.includes(cd)) onChange(selected.filter((s) => s !== cd));
    else onChange([...selected, cd]);
  };

  const selecionarTodos = () => onChange(clientes.map((c) => c.cd_cliente));
  const limpar = () => onChange([]);

  const resumo = useMemo(() => {
    if (!selected || selected.length === 0) return 'Todos os clientes';
    if (selected.length === 1) {
      const found = clientes.find((c) => c.cd_cliente === selected[0]);
      return found ? found.nm_cliente : selected[0];
    }
    return `${selected.length} selecionados`;
  }, [selected, clientes]);

  return (
    <div ref={ref} className="relative">
      <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
        {label}
      </label>
      <button
        type="button"
        onClick={() => setShowDropdown((s) => !s)}
        className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-left flex items-center justify-between text-xs"
      >
        <span className="truncate">{resumo}</span>
        <span className="text-gray-500 text-xs">▾</span>
      </button>

      {showDropdown && (
        <div className="w-full absolute top-full left-0 right-0 z-50 bg-white border border-gray-300 rounded-lg shadow-lg mt-1 max-h-100 overflow-hidden">
          <div className="p-3 border-b border-gray-200">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar cliente"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#000638] text-sm"
            />
            <div className="p-3 border-b border-gray-200 bg-gray-50 flex gap-2">
              <button
                onClick={selecionarTodos}
                type="button"
                className="text-xs px-2 py-1 bg-[#000638] text-white rounded hover:bg-[#fe0000] transition-colors"
              >
                Selecionar todos
              </button>
              <button
                onClick={limpar}
                type="button"
                className="text-xs px-2 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
              >
                Limpar
              </button>
            </div>
          </div>
          <div className="w-full max-h-48 overflow-y-auto">
            {clientes
              .filter((cli) =>
                cli.nm_cliente.toLowerCase().includes(searchTerm.toLowerCase()),
              )
              .map((cli) => (
                <label
                  key={cli.cd_cliente}
                  className="px-2 py-2 hover:bg-gray-50 cursor-pointer flex items-start mb-1"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(cli.cd_cliente)}
                    onChange={() => toggle(cli.cd_cliente)}
                  />
                  <div className="flex flex-row w-full ml-2">
                    <span className="text-xs text-[#000638]">
                      {cli.nm_cliente}
                    </span>
                  </div>
                </label>
              ))}
            {clientes.filter((cli) =>
              cli.nm_cliente.toLowerCase().includes(searchTerm.toLowerCase()),
            ).length === 0 && (
              <div className="text-xs text-gray-500 p-2">
                Nenhum cliente encontrado
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default FiltroClientes;
