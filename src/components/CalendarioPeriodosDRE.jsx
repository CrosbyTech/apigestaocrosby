import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Calendar, Check, X } from '@phosphor-icons/react';

const CalendarioPeriodosDRE = ({ onPeriodosChange, periodosIniciais = [] }) => {
  const anoAtual = new Date().getFullYear();
  const [anoSelecionado, setAnoSelecionado] = useState(anoAtual);
  const [mesesSelecionados, setMesesSelecionados] = useState(new Set());
  const [modoSelecao, setModoSelecao] = useState('multiplo'); // 'multiplo', 'unico', 'ano'

  const meses = [
    { numero: 1, nome: 'Janeiro', sigla: 'JAN' },
    { numero: 2, nome: 'Fevereiro', sigla: 'FEV' },
    { numero: 3, nome: 'Março', sigla: 'MAR' },
    { numero: 4, nome: 'Abril', sigla: 'ABR' },
    { numero: 5, nome: 'Maio', sigla: 'MAI' },
    { numero: 6, nome: 'Junho', sigla: 'JUN' },
    { numero: 7, nome: 'Julho', sigla: 'JUL' },
    { numero: 8, nome: 'Agosto', sigla: 'AGO' },
    { numero: 9, nome: 'Setembro', sigla: 'SET' },
    { numero: 10, nome: 'Outubro', sigla: 'OUT' },
    { numero: 11, nome: 'Novembro', sigla: 'NOV' },
    { numero: 12, nome: 'Dezembro', sigla: 'DEZ' },
  ];

  // Obter primeiro e último dia do mês
  const getDatasDoMes = (ano, mes) => {
    const primeiroDia = new Date(ano, mes - 1, 1).toISOString().split('T')[0];
    const ultimoDia = new Date(ano, mes, 0).toISOString().split('T')[0];
    return { dt_inicio: primeiroDia, dt_fim: ultimoDia };
  };

  // Obter datas do ano completo
  const getDatasDoAno = (ano) => {
    const primeiroDia = new Date(ano, 0, 1).toISOString().split('T')[0];
    const ultimoDia = new Date(ano, 11, 31).toISOString().split('T')[0];
    return { dt_inicio: primeiroDia, dt_fim: ultimoDia };
  };

  // Toggle de seleção de mês
  const toggleMes = (numeroMes) => {
    if (modoSelecao === 'unico') {
      // Modo único: só permite 1 mês selecionado
      const novoSet = new Set([numeroMes]);
      setMesesSelecionados(novoSet);
    } else if (modoSelecao === 'multiplo') {
      // Modo múltiplo: permite vários meses
      const novoSet = new Set(mesesSelecionados);
      if (novoSet.has(numeroMes)) {
        novoSet.delete(numeroMes);
      } else {
        novoSet.add(numeroMes);
      }
      setMesesSelecionados(novoSet);
    }
  };

  // Selecionar ano completo
  const selecionarAnoCompleto = () => {
    if (modoSelecao === 'ano' && mesesSelecionados.size === 12) {
      // Desselecionar tudo
      setMesesSelecionados(new Set());
    } else {
      // Selecionar todos os meses
      const todosOsMeses = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      setMesesSelecionados(todosOsMeses);
      setModoSelecao('ano');
    }
  };

  // Limpar seleção
  const limparSelecao = () => {
    setMesesSelecionados(new Set());
  };

  // Gerar períodos baseado na seleção
  const periodosGerados = useMemo(() => {
    if (mesesSelecionados.size === 0) {
      return [];
    }

    const mesesOrdenados = Array.from(mesesSelecionados).sort((a, b) => a - b);

    if (modoSelecao === 'ano' && mesesSelecionados.size === 12) {
      // Modo ano: retorna 1 período com o ano completo
      const datas = getDatasDoAno(anoSelecionado);
      return [
        {
          id: 1,
          dt_inicio: datas.dt_inicio,
          dt_fim: datas.dt_fim,
          filtroMensal: 'ANO',
          empresas: [1, 2, 3, 4, 5],
          label: `Ano ${anoSelecionado}`,
        },
      ];
    } else {
      // Modo único ou múltiplo: retorna 1 período por mês
      return mesesOrdenados.map((numeroMes, index) => {
        const mes = meses.find((m) => m.numero === numeroMes);
        const datas = getDatasDoMes(anoSelecionado, numeroMes);
        return {
          id: index + 1,
          dt_inicio: datas.dt_inicio,
          dt_fim: datas.dt_fim,
          filtroMensal: mes.sigla,
          empresas: [1, 2, 3, 4, 5],
          label: `${mes.nome}/${anoSelecionado}`,
        };
      });
    }
  }, [mesesSelecionados, anoSelecionado, modoSelecao, meses]);

  // Ref para armazenar o valor anterior serializado
  const prevPeriodosRef = useRef('');

  // Atualizar períodos automaticamente quando há mudanças reais
  useEffect(() => {
    // Serializar para comparação (evita comparar referências de objetos)
    const currentSerialized = JSON.stringify(periodosGerados);

    // Só chamar onPeriodosChange se houve mudança real
    if (currentSerialized !== prevPeriodosRef.current) {
      prevPeriodosRef.current = currentSerialized;
      onPeriodosChange(periodosGerados);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodosGerados]); // Apenas periodosGerados como dependência

  const infoSelecao = useMemo(() => {
    if (mesesSelecionados.size === 0) {
      return 'Nenhum período selecionado';
    }

    if (modoSelecao === 'ano' && mesesSelecionados.size === 12) {
      return `Ano completo de ${anoSelecionado}`;
    }

    if (mesesSelecionados.size === 1) {
      const mes = meses.find(
        (m) => m.numero === Array.from(mesesSelecionados)[0],
      );
      return `${mes.nome}/${anoSelecionado}`;
    }

    return `${mesesSelecionados.size} meses selecionados`;
  }, [mesesSelecionados, anoSelecionado, modoSelecao, meses]);

  return (
    <div className="bg-white rounded-lg shadow-sm p-6">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Calendar className="w-6 h-6 text-[#000638]" weight="duotone" />
          <h3 className="text-lg font-semibold text-gray-900">
            Selecionar Períodos
          </h3>
        </div>

        {/* Seletor de Ano */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAnoSelecionado((prev) => prev - 1)}
            className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            ←
          </button>
          <span className="font-semibold text-lg px-4">{anoSelecionado}</span>
          <button
            onClick={() => setAnoSelecionado((prev) => prev + 1)}
            className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            →
          </button>
        </div>
      </div>
      {/* Modos de Seleção */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setModoSelecao('unico')}
          className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
            modoSelecao === 'unico'
              ? 'bg-[#000638] text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Mês Único
        </button>
        <button
          onClick={() => setModoSelecao('multiplo')}
          className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
            modoSelecao === 'multiplo'
              ? 'bg-[#000638] text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Múltiplos Meses
        </button>
        <button
          onClick={selecionarAnoCompleto}
          className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
            modoSelecao === 'ano' && mesesSelecionados.size === 12
              ? 'bg-[#000638] text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Ano Completo
        </button>
      </div>
      {/* Grid de Meses */}
      <div className="grid xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-12 lg:grid-cols-12 gap-3 mb-4">
        {meses.map((mes) => {
          const selecionado = mesesSelecionados.has(mes.numero);

          return (
            <button
              key={mes.numero}
              onClick={() => toggleMes(mes.numero)}
              className={`
                 rounded-lg border-2 transition-all duration-200
                ${
                  selecionado
                    ? 'border-[#000638] bg-[#000638] text-white shadow-md'
                    : 'border-gray-200 bg-white text-gray-700 hover:border-[#000638] hover:bg-gray-50'
                }
              `}
            >
              <div className="flex flex-col items-center gap-1">
                <span className="text-xs font-medium">{mes.sigla}</span>
                <span className="text-[10px] opacity-80">{mes.nome}</span>
              </div>

              {selecionado && (
                <div className="absolute top-1 right-1">
                  <Check size={14} weight="bold" />
                </div>
              )}
            </button>
          );
        })}
      </div>
      {/* Info e Ações */}
      <div className="flex items-center justify-between pt-4 border-t border-gray-200">
        <button
          onClick={limparSelecao}
          disabled={mesesSelecionados.size === 0}
          className="px-3 py-1.5 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <X size={16} />
          Limpar Seleção
        </button>
      </div>
    </div>
  );
};

export default CalendarioPeriodosDRE;
