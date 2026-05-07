import React from 'react';

const canais = [
  { value: 'VAREJO', label: 'Varejo' },
  { value: 'MULTIMARCAS', label: 'Multimarcas' },
  { value: 'REVENDA', label: 'Revenda' },
  { value: 'FRANQUIAS', label: 'Franquias' },
];

export default function FiltroCanal({
  canaisSelecionados,
  setCanaisSelecionados,
}) {
  const handleChange = (canal) => {
    if (canaisSelecionados.includes(canal)) {
      setCanaisSelecionados(canaisSelecionados.filter((c) => c !== canal));
    } else {
      setCanaisSelecionados([...canaisSelecionados, canal]);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="font-semibold text-[#000638]">Canal</label>
      <div className="flex flex-wrap gap-2">
        {canais.map((canal) => (
          <button
            key={canal.value}
            type="button"
            className={`px-3 py-1 rounded-full border transition-colors duration-150 text-sm font-medium ${
              canaisSelecionados.includes(canal.value)
                ? 'bg-[#000638] text-white border-[#000638]'
                : 'bg-white text-[#000638] border-gray-300'
            }`}
            onClick={() => handleChange(canal.value)}
          >
            {canal.label}
          </button>
        ))}
      </div>
    </div>
  );
}
