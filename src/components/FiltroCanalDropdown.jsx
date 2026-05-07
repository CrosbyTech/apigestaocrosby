import React from 'react';

const canais = [
  { value: 'varejo', label: 'Varejo' },
  { value: 'mtm', label: 'Multimarcas' },
  { value: 'franquias', label: 'Franquias' },
  { value: 'revenda', label: 'Revenda' },
];

export default function FiltroCanalDropdown({
  canaisSelecionados,
  setCanaisSelecionados,
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="font-semibold text-[#000638]">Canal</label>
      <select
        multiple
        value={canaisSelecionados}
        onChange={(e) => {
          const options = Array.from(e.target.selectedOptions).map(
            (opt) => opt.value,
          );
          setCanaisSelecionados(options);
        }}
        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#000638] focus:border-transparent"
        style={{ minHeight: 80 }}
      >
        {canais.map((canal) => (
          <option key={canal.value} value={canal.value}>
            {canal.label}
          </option>
        ))}
      </select>
    </div>
  );
}
