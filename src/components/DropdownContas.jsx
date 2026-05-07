import React, { useRef, useState, useEffect } from 'react';
import { ArrowsClockwise } from '@phosphor-icons/react';

const DropdownContas = ({
  contas = [],
  contasSelecionadas = [],
  setContasSelecionadas,
  label = 'Conta',
  minWidth = 400,
  maxWidth = 600,
}) => {
  const dropdownRef = useRef(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleContaCheckbox = (numero) => {
    setContasSelecionadas((prev) => {
      const jaSelecionado = prev.includes(numero);
      return jaSelecionado
        ? prev.filter((n) => n !== numero)
        : [...prev, numero];
    });
  };

  // Função para selecionar/desmarcar todas as contas
  const toggleTodas = () => {
    const numerosTodas = contas.map(c => c.numero);
    const todasSelecionadas = numerosTodas.every(n => contasSelecionadas.includes(n)) && numerosTodas.length > 0;
    setContasSelecionadas(todasSelecionadas ? [] : numerosTodas);
  };

  // Função para selecionar/desmarcar todas de um grupo
  const toggleGrupo = (grupo) => {
    let filtro = '';
    if (grupo === 'CROSBY') filtro = 'CROSBY';
    if (grupo === 'FABIO') filtro = 'FABIO';
    if (grupo === 'IRMÃOS CR') filtro = 'IRMÃOS CR';
    if (grupo === 'FLAVIO') filtro = 'FLAVIO';
    const contasDoGrupo = contas.filter(c => c.nome.includes(filtro)).map(c => c.numero);
    const todasSelecionadas = contasDoGrupo.every(n => contasSelecionadas.includes(n));
    setContasSelecionadas((prev) => {
      if (todasSelecionadas) {
        // Desmarca todas do grupo
        return prev.filter(n => !contasDoGrupo.includes(n));
      } else {
        // Marca todas do grupo (sem duplicar)
        return Array.from(new Set([...prev, ...contasDoGrupo]));
      }
    });
  };

  return (
    <div className="flex flex-col w-full">
      <label className="block text-sm font-medium  text-[#000638]"></label>
      <div className="relative w-full" ref={dropdownRef}>
        <button
          type="button"
          className="!bg-[#f8f9fb] !text-[#000638] !placeholder:text-gray-400 !px-3 !py-2 !w-full !rounded-lg !border !border-[#000638]/30 focus:!outline-none focus:!ring-2 focus:!ring-[#000638] !h-[42px] !text-sm !overflow-hidden !whitespace-nowrap"
          onClick={() => setDropdownOpen((open) => !open)}
        >
          <span className="block truncate">
            {contasSelecionadas.length === 0
              ? 'Selecione as contas'
              : `${contasSelecionadas.length} conta(s) selecionada(s)`}
          </span>
        </button>
        {dropdownOpen && (
          <div
            className={`absolute z-10 bg-white border rounded shadow max-h-80 overflow-y-auto mt-1 min-w-[${minWidth}px] max-w-[${maxWidth}px] w-full`}
          >
            {/* Checkboxes de grupo */}
            <div className="flex flex-col gap-1 px-4 pt-3 pb-2 border-b">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox"
                  checked={contas.length > 0 && contas.every(c=>contasSelecionadas.includes(c.numero))}
                  onChange={toggleTodas}
                  className="w-4 h-4 accent-gray-500"
                />
                <span className="text-xs font-semibold text-gray-700">Todas as contas</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox"
                  checked={contas.filter(c=>c.nome.includes('CROSBY')).every(c=>contasSelecionadas.includes(c.numero)) && contas.filter(c=>c.nome.includes('CROSBY')).length > 0}
                  onChange={()=>toggleGrupo('CROSBY')}
                  className="w-4 h-4 accent-blue-600"
                />
                <span className="text-xs font-semibold text-blue-700">Todas CROSBY</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox"
                  checked={contas.filter(c=>c.nome.includes('FABIO')).every(c=>contasSelecionadas.includes(c.numero)) && contas.filter(c=>c.nome.includes('FABIO')).length > 0}
                  onChange={()=>toggleGrupo('FABIO')}
                  className="w-4 h-4 accent-yellow-500"
                />
                <span className="text-xs font-semibold text-yellow-700">Todas FABIO</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox"
                  checked={contas.filter(c=>c.nome.includes('IRMÃOS CR')).every(c=>contasSelecionadas.includes(c.numero)) && contas.filter(c=>c.nome.includes('IRMÃOS CR')).length > 0}
                  onChange={()=>toggleGrupo('IRMÃOS CR')}
                  className="w-4 h-4 accent-orange-500"
                />
                <span className="text-xs font-semibold text-orange-700">Todas IRMÃOS CR</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox"
                  checked={contas.filter(c=>c.nome.includes('FLAVIO')).every(c=>contasSelecionadas.includes(c.numero)) && contas.filter(c=>c.nome.includes('FLAVIO')).length > 0}
                  onChange={()=>toggleGrupo('FLAVIO')}
                  className="w-4 h-4 accent-green-500"
                />
                <span className="text-xs font-semibold text-green-700">Todas FLAVIO</span>
              </label>
            </div>
            {/* Lista de contas individuais */}
            {contas.map((conta) => (
              <label
                key={conta.numero}
                className="flex flex-row items-center gap-4 w-full px-4 py-2 cursor-pointer hover:bg-gray-100 whitespace-nowrap"
              >
                <input
                  type="checkbox"
                  checked={contasSelecionadas.includes(conta.numero)}
                  onChange={() => handleContaCheckbox(conta.numero)}
                  className="w-5 h-5 accent-blue-600"
                />
                <span className="truncate text-base">{conta.numero} - {conta.nome}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default DropdownContas; 