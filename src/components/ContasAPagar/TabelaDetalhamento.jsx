import React, { useState, useMemo, useRef, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import FilterDropdown from '../ui/FilterDropdown';
import {
  FunnelSimple,
  Spinner,
  CaretUp,
  CaretDown,
  FileArrowDown,
} from '@phosphor-icons/react';
import {
  formatarData,
  TABLE_CLASSES,
  TABLE_HEADER_CLASSES,
  getStickyColStyle,
} from './utils';

const REGISTROS_POR_PAGINA = 50;

const DESPESAS_VERMELHAS = new Set([
  'ALUGUEIS DE IMOVEIS',
  'AGUA E ESGOTO',
  'ENERGIA ELETRICA',
  'TELEFONE',
  'INTERNET',
]);

const DESPESAS_AMARELAS = new Set([
  'IMPOSTOS',
  'FGTS',
  'SALARIOS E ORDENADOS',
  'SOFTWARE E SISTEMA',
  'RESCISAO CONTRATO DE TRABALHO',
  'FERIAS',
  'SERVICOS PRESTADOS POR TERCEIROS',
]);

const getCorDespesa = (nome) => {
  const upper = (nome || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (DESPESAS_VERMELHAS.has(upper)) return 'red';
  if (DESPESAS_AMARELAS.has(upper)) return 'yellow';
  return null;
};

// Definição das colunas para evitar repetição
const COLUNAS = [
  { key: 'dt_vencimento', label: 'Vencimento', type: 'date' },
  { key: 'vl_duplicata', label: 'Valor', type: 'currency' },
  { key: 'cd_fornecedor', label: 'Fornecedor', type: 'text' },
  {
    key: 'nm_fornecedor',
    label: 'NM Fornecedor',
    type: 'text',
    truncate: true,
    maxW: 'max-w-32',
  },
  {
    key: 'ds_despesaitem',
    label: 'Despesa',
    type: 'text',
    truncate: true,
    maxW: 'max-w-48',
    minW: 'min-w-32',
  },
  {
    key: 'cd_ccusto',
    label: 'C CUSTO',
    type: 'text',
  },
  { key: 'cd_empresa', label: 'Empresa', type: 'empresa' },
  { key: 'nr_duplicata', label: 'Duplicata', type: 'text' },
  { key: 'nr_parcela', label: 'Parcela', type: 'text' },
  { key: 'nr_portador', label: 'Portador', type: 'text' },
  { key: 'dt_emissao', label: 'Emissão', type: 'date' },
  { key: 'dt_entrada', label: 'Entrada', type: 'date' },
  { key: 'dt_liq', label: 'Liquidação', type: 'date' },
  {
    key: 'tp_situacao_col',
    label: 'Situação',
    sortKey: 'tp_situacao',
    type: 'text',
    dataKey: 'tp_situacao',
  },
  { key: 'tp_estagio', label: 'Estágio', type: 'text' },
  { key: 'vl_juros', label: 'Juros', type: 'currency' },
  { key: 'vl_acrescimo', label: 'Acréscimo', type: 'currency' },
  { key: 'vl_desconto', label: 'Desconto', type: 'currency' },
  { key: 'vl_pago', label: 'Pago', type: 'currency' },
  { key: 'in_aceite', label: 'Aceite', type: 'text' },
  {
    key: 'perc_rateio',
    label: '% Rateio',
    type: 'percentage',
  },
  {
    key: 'vl_rateio',
    label: 'Vl Rateio',
    type: 'currency',
  },
  {
    key: 'ds_observacao',
    label: 'Observação',
    type: 'obs',
    noSort: true,
    noFilter: true,
  },
  { key: 'tp_previsaoreal', label: 'Previsão', type: 'text' },
];

const TabelaDetalhamento = React.memo(
  ({
    dadosOrdenadosParaCards,
    linhasSelecionadasAgrupadas,
    setLinhasSelecionadasAgrupadas,
    sortConfig,
    handleSort,
    columnFilters,
    openFilterDropdown,
    toggleFilterDropdown,
    handleApplyFilter,
    abrirModalDetalhes,
    exportarExcelDetalhamento,
    onEnviarPagamento,
    hasRole,
    filtroPagamento,
    setFiltroPagamento,
  }) => {
    const parentRef = useRef(null);
    const [filtroCor, setFiltroCor] = useState(new Set());

    const toggleFiltroCor = useCallback((cor) => {
      setFiltroCor((prev) => {
        const n = new Set(prev);
        n.has(cor) ? n.delete(cor) : n.add(cor);
        return n;
      });
    }, []);

    // Aplicar filtro PAGO/ABERTO/TODOS + filtro cor
    const dadosFiltradosPagamento = useMemo(() => {
      let filtrados = dadosOrdenadosParaCards;
      if (filtroPagamento && filtroPagamento !== 'TODOS') {
        filtrados = filtrados.filter((grupo) => {
          const contaPaga =
            grupo.item.dt_liq && grupo.item.dt_liq.trim() !== '';
          if (filtroPagamento === 'PAGO') return contaPaga;
          if (filtroPagamento === 'ABERTO') return !contaPaga;
          return true;
        });
      }
      if (filtroCor.size > 0) {
        filtrados = filtrados.filter((grupo) => {
          const cor = getCorDespesa(grupo.item.ds_despesaitem);
          return filtroCor.has(cor);
        });
      }
      return filtrados;
    }, [dadosOrdenadosParaCards, filtroPagamento, filtroCor]);

    // Dados para a tabela
    const paginacao = useMemo(
      () => ({
        dados: dadosFiltradosPagamento,
        totalRegistros: dadosFiltradosPagamento.length,
      }),
      [dadosFiltradosPagamento],
    );

    // Virtualizer para as linhas
    const rowVirtualizer = useVirtualizer({
      count: paginacao.dados.length,
      getScrollElement: () => parentRef.current,
      estimateSize: () => 36,
      overscan: 15,
    });

    const getSortIcon = useCallback(
      (key) => {
        if (sortConfig.key !== key) {
          return <CaretDown size={10} className="ml-1 opacity-50" />;
        }
        return sortConfig.direction === 'asc' ? (
          <CaretUp size={10} className="ml-1" />
        ) : (
          <CaretDown size={10} className="ml-1" />
        );
      },
      [sortConfig],
    );

    // Renderizar valor da célula
    const renderCellValue = useCallback((col, grupo) => {
      const item = grupo.item;
      const dataKey = col.dataKey || col.key;

      switch (col.type) {
        case 'status': {
          const contaPaga = item.dt_liq && item.dt_liq.trim() !== '';
          return contaPaga ? (
            <div className="flex items-center justify-center gap-1">
              <span className="w-2 h-2 bg-red-500 rounded-full" />
              <span className="text-red-700 font-semibold">PAGO</span>
              <span className="text-gray-600">em</span>
              <span className="text-red-600 font-medium">
                {formatarData(item.dt_liq)}
              </span>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-1">
              <span className="w-2 h-2 bg-gray-400 rounded-full" />
              <span className="text-gray-500 font-medium">NÃO AUTORIZADO</span>
            </div>
          );
        }
        case 'date':
          return formatarData(item[dataKey]);
        case 'currency':
          return parseFloat(item[dataKey] || 0).toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL',
          });
        case 'percentage':
          return parseFloat(item[dataKey] || 0) !== 0
            ? `${parseFloat(item[dataKey]).toFixed(2)}%`
            : '';
        case 'rateio':
          return grupo.rateios && grupo.rateios.length > 0
            ? grupo.rateios
                .map((r) => parseFloat(r || 0))
                .reduce((a, b) => a + b, 0)
                .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
            : '';
        case 'empresa':
          return item.nm_empresa
            ? `${item.cd_empresa} - ${item.nm_empresa}`
            : item.cd_empresa || '';
        case 'obs':
          return item.ds_observacao || '';
        default:
          return item[dataKey] || '';
      }
    }, []);

    // Selecionar/desselecionar todas
    const toggleSelectAll = useCallback(() => {
      const allVisible = paginacao.dados.length;
      const allSelected =
        linhasSelecionadasAgrupadas.size === allVisible && allVisible > 0;
      if (allSelected) {
        setLinhasSelecionadasAgrupadas(new Set());
      } else {
        const newSet = new Set();
        for (let i = 0; i < allVisible; i++) newSet.add(i);
        setLinhasSelecionadasAgrupadas(newSet);
      }
    }, [
      paginacao.dados.length,
      linhasSelecionadasAgrupadas.size,
      setLinhasSelecionadasAgrupadas,
    ]);

    const allSelected =
      linhasSelecionadasAgrupadas.size === paginacao.dados.length &&
      paginacao.dados.length > 0;

    // Itens de dados para as linhas mapeadas pelo virtualizer
    const itemsData = useMemo(
      () => paginacao.dados.map((grupo) => grupo.item),
      [paginacao.dados],
    );

    return (
      <div className="bg-white rounded-lg shadow-lg border border-[#000638]/10 w-full mb-3">
        <div className="p-3 border-b border-[#000638]/10">
          <h2 className="text-sm font-bold text-[#000638]">
            Detalhamento de Contas
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Registros consolidados por duplicata/parcela/fornecedor.{' '}
            {paginacao.totalRegistros} registros encontrados.
          </p>
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <button
              onClick={toggleSelectAll}
              className={`text-xs px-2 py-1 rounded transition-colors ${
                allSelected
                  ? 'bg-gray-500 text-white hover:bg-gray-600'
                  : 'bg-[#000638] text-white hover:bg-[#fe0000]'
              }`}
            >
              {allSelected ? 'Desmarcar todas' : 'Selecionar todas'}
            </button>
            <button
              onClick={exportarExcelDetalhamento}
              className="text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
            >
              Baixar Excel
            </button>
            {onEnviarPagamento && (
              <button
                onClick={onEnviarPagamento}
                disabled={linhasSelecionadasAgrupadas.size === 0}
                className="text-xs px-2 py-1 bg-[#000638] text-white rounded hover:bg-[#001060] disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-semibold"
                title="Enviar títulos selecionados para Liberação de Pagamento"
              >
                Enviar para Pagamento ({linhasSelecionadasAgrupadas.size})
              </button>
            )}
            {/* Filtro PAGO / ABERTO / TODOS */}
            <div className="flex items-center gap-1 ml-auto">
              <span className="text-xs text-gray-500 font-medium">Status:</span>
              {['TODOS', 'ABERTO', 'PAGO'].map((opt) => (
                <button
                  key={opt}
                  onClick={() => setFiltroPagamento(opt)}
                  className={`text-xs px-2 py-1 rounded transition-colors font-medium ${
                    filtroPagamento === opt
                      ? opt === 'PAGO'
                        ? 'bg-red-600 text-white'
                        : opt === 'ABERTO'
                          ? 'bg-blue-600 text-white'
                          : 'bg-[#000638] text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
            {/* Filtro por Cor de Despesa */}
            <div className="flex items-center gap-1 ml-2">
              <span className="text-xs text-gray-500 font-medium">Tipo:</span>
              <button
                onClick={() => setFiltroCor(new Set())}
                className={`text-xs px-2 py-1 rounded transition-colors font-medium ${
                  filtroCor.size === 0
                    ? 'bg-[#000638] text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                TODOS
              </button>
              <button
                onClick={() => toggleFiltroCor('red')}
                className={`text-xs px-2 py-1 rounded transition-colors font-medium flex items-center gap-1 ${
                  filtroCor.has('red')
                    ? 'bg-red-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                VERMELHO
              </button>
              <button
                onClick={() => toggleFiltroCor('yellow')}
                className={`text-xs px-2 py-1 rounded transition-colors font-medium flex items-center gap-1 ${
                  filtroCor.has('yellow')
                    ? 'bg-yellow-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />
                AMARELO
              </button>
            </div>
          </div>
        </div>

        {/* Tabela virtualizada */}
        <div className="p-3">
          <div
            ref={parentRef}
            className="overflow-auto"
            style={{ maxHeight: '70vh' }}
          >
            <table className={TABLE_CLASSES} style={{ tableLayout: 'auto' }}>
              <thead className={`${TABLE_HEADER_CLASSES} sticky top-0 z-30`}>
                <tr>
                  <th
                    className="px-1 py-1.5 text-center whitespace-nowrap text-[9px]"
                    style={getStickyColStyle(true)}
                  >
                    SEL
                  </th>
                  <th className="px-1 py-1.5 text-center whitespace-nowrap text-[9px]">
                    AÇÕES
                  </th>
                  {COLUNAS.map((col) => {
                    const sortKey = col.sortKey || col.key;
                    const filterKey = col.key;
                    return (
                      <th
                        key={col.key}
                        className={`px-1 py-1.5 text-center whitespace-nowrap text-[9px] ${
                          !col.noSort
                            ? 'cursor-pointer hover:bg-[#000638]/80 transition-colors'
                            : ''
                        }`}
                        onClick={
                          !col.noSort ? () => handleSort(sortKey) : undefined
                        }
                      >
                        <div className="flex items-center justify-center gap-1 relative">
                          {col.label} {!col.noSort && getSortIcon(sortKey)}
                          {!col.noFilter && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFilterDropdown(filterKey);
                              }}
                              className={`hover:text-gray-300 focus:outline-none ${
                                columnFilters[filterKey]
                                  ? 'text-yellow-400'
                                  : 'text-gray-400'
                              }`}
                              aria-label={`Filtrar por ${col.label}`}
                            >
                              <FunnelSimple size={10} />
                            </button>
                          )}
                          {openFilterDropdown === filterKey && (
                            <div className="absolute top-full left-0 z-50 mt-1">
                              <FilterDropdown
                                columnKey={filterKey}
                                columnTitle={col.label}
                                data={itemsData}
                                currentFilter={columnFilters[filterKey]}
                                onApplyFilter={handleApplyFilter}
                                onClose={() => toggleFilterDropdown(null)}
                              />
                            </div>
                          )}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const virtualItems = rowVirtualizer.getVirtualItems();
                  const paddingTop =
                    virtualItems.length > 0 ? virtualItems[0].start : 0;
                  const paddingBottom =
                    virtualItems.length > 0
                      ? rowVirtualizer.getTotalSize() -
                        virtualItems[virtualItems.length - 1].end
                      : 0;
                  const totalCols = COLUNAS.length + 2; // +2 for SEL and AÇÕES
                  return (
                    <>
                      {paddingTop > 0 && (
                        <tr>
                          <td
                            colSpan={totalCols}
                            style={{
                              height: `${paddingTop}px`,
                              padding: 0,
                              border: 'none',
                            }}
                          />
                        </tr>
                      )}
                      {virtualItems.map((virtualRow) => {
                        const index = virtualRow.index;
                        const grupo = paginacao.dados[index];
                        if (!grupo) return null;
                        const isSelected =
                          linhasSelecionadasAgrupadas.has(index);
                        const contaPaga =
                          grupo.item.dt_liq && grupo.item.dt_liq.trim() !== '';
                        const isEven = index % 2 === 0;
                        const corDespesa = getCorDespesa(
                          grupo.item.ds_despesaitem,
                        );

                        return (
                          <tr
                            key={virtualRow.key}
                            data-index={index}
                            ref={rowVirtualizer.measureElement}
                            className={`border-b transition-colors cursor-pointer ${
                              isSelected
                                ? 'bg-blue-100 hover:bg-blue-200'
                                : corDespesa === 'red'
                                  ? 'bg-red-50 hover:bg-red-100'
                                  : corDespesa === 'yellow'
                                    ? 'bg-yellow-50 hover:bg-yellow-100'
                                    : isEven
                                      ? 'bg-white hover:bg-gray-100'
                                      : 'bg-gray-50 hover:bg-gray-100'
                            } ${corDespesa === 'red' ? 'border-l-4 border-l-red-500' : corDespesa === 'yellow' ? 'border-l-4 border-l-yellow-400' : ''}`}
                            onClick={() => abrirModalDetalhes(grupo.item)}
                            title="Clique para ver detalhes da conta"
                          >
                            <td
                              className="px-1 py-1 text-center"
                              style={getStickyColStyle(
                                false,
                                isSelected,
                                isEven,
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  setLinhasSelecionadasAgrupadas((prev) => {
                                    const novoSet = new Set(prev);
                                    novoSet.has(index)
                                      ? novoSet.delete(index)
                                      : novoSet.add(index);
                                    return novoSet;
                                  });
                                }}
                                className="rounded w-3 h-3"
                                onClick={(e) => e.stopPropagation()}
                              />
                            </td>
                            <td className="px-1 py-1 text-center whitespace-nowrap">
                              {contaPaga ? (
                                <span className="inline-flex items-center gap-1 text-[10px]">
                                  <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                                  <span className="text-red-700 font-semibold">
                                    PAGO
                                  </span>
                                  <span className="text-gray-500">
                                    em {formatarData(grupo.item.dt_liq)}
                                  </span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px]">
                                  <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
                                  <span className="text-blue-700 font-semibold">
                                    ABERTO
                                  </span>
                                </span>
                              )}
                            </td>
                            {COLUNAS.map((col) => {
                              const cellClasses = [
                                'px-1 py-1 whitespace-nowrap text-[11px]',
                                col.type === 'currency' ? 'text-right' : '',
                                col.type === 'currency' &&
                                col.key === 'vl_duplicata'
                                  ? 'font-semibold text-green-700'
                                  : '',
                                col.truncate
                                  ? `text-left ${col.maxW || ''} ${col.minW || ''} truncate`
                                  : 'text-center',
                                col.type === 'obs'
                                  ? 'text-left max-w-40 truncate'
                                  : '',
                                col.type === 'rateio' ? 'text-right' : '',
                              ]
                                .filter(Boolean)
                                .join(' ');

                              const dataKey = col.dataKey || col.key;
                              const titleAttr = col.truncate
                                ? grupo.item[dataKey]
                                : col.type === 'obs'
                                  ? grupo.item.ds_observacao
                                  : col.type === 'rateio' &&
                                      grupo.rateios?.length > 0
                                    ? grupo.rateios.join(' | ')
                                    : undefined;

                              return (
                                <td
                                  key={col.key}
                                  className={cellClasses}
                                  title={titleAttr}
                                >
                                  {renderCellValue(col, grupo)}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                      {paddingBottom > 0 && (
                        <tr>
                          <td
                            colSpan={totalCols}
                            style={{
                              height: `${paddingBottom}px`,
                              padding: 0,
                              border: 'none',
                            }}
                          />
                        </tr>
                      )}
                    </>
                  );
                })()}
              </tbody>
            </table>
          </div>

          {/* Rodapé com info de seleção */}
          <div className="mt-3 text-xs text-gray-600 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-4">
              <div>
                Selecionadas:{' '}
                <span className="font-semibold">
                  {linhasSelecionadasAgrupadas.size}
                </span>
              </div>
              <div>
                Total de registros:{' '}
                <span className="font-semibold">
                  {paginacao.totalRegistros}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div>
                Valor selecionado:{' '}
                <span className="font-semibold text-green-700">
                  {Array.from(linhasSelecionadasAgrupadas)
                    .reduce(
                      (acc, idx) =>
                        acc +
                        parseFloat(
                          paginacao.dados[idx]?.item?.vl_duplicata || 0,
                        ),
                      0,
                    )
                    .toLocaleString('pt-BR', {
                      style: 'currency',
                      currency: 'BRL',
                    })}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  },
);

TabelaDetalhamento.displayName = 'TabelaDetalhamento';

export default TabelaDetalhamento;
