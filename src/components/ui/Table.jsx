import React, { memo, useState, useMemo, useCallback } from 'react';
import { CaretUp, CaretDown, CaretUpDown } from '@phosphor-icons/react';
import LoadingSpinner from '../LoadingSpinner';

/**
 * Componente Table reutilizável com sort, paginação e responsividade
 * Implementa acessibilidade e performance otimizada
 */
const Table = memo(({
  data = [],
  columns = [],
  loading = false,
  error = null,
  sortable = true,
  pagination = false,
  pageSize = 10,
  currentPage = 1,
  onPageChange,
  onSort,
  className = '',
  containerClassName = '',
  emptyMessage = 'Nenhum dado encontrado',
  rowKey = 'id',
  onRowClick,
  selectedRows = [],
  onRowSelect,
  stickyHeader = false,
  responsive = true,
  ...props
}) => {
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });

  // Dados ordenados
  const sortedData = useMemo(() => {
    if (!sortConfig.key || !sortable) return data;

    return [...data].sort((a, b) => {
      const aValue = a[sortConfig.key];
      const bValue = b[sortConfig.key];

      if (aValue === null || aValue === undefined) return 1;
      if (bValue === null || bValue === undefined) return -1;

      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return sortConfig.direction === 'asc' ? aValue - bValue : bValue - aValue;
      }

      const aString = String(aValue).toLowerCase();
      const bString = String(bValue).toLowerCase();

      if (sortConfig.direction === 'asc') {
        return aString < bString ? -1 : aString > bString ? 1 : 0;
      } else {
        return aString > bString ? -1 : aString < bString ? 1 : 0;
      }
    });
  }, [data, sortConfig, sortable]);

  // Dados paginados
  const paginatedData = useMemo(() => {
    if (!pagination) return sortedData;
    
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    return sortedData.slice(start, end);
  }, [sortedData, pagination, currentPage, pageSize]);

  // Handler para ordenação
  const handleSort = useCallback((key) => {
    if (!sortable) return;

    setSortConfig(prevConfig => {
      const direction = 
        prevConfig.key === key && prevConfig.direction === 'asc' 
          ? 'desc' 
          : 'asc';
      
      const newConfig = { key, direction };
      onSort?.(newConfig);
      return newConfig;
    });
  }, [sortable, onSort]);

  // Handler para seleção de linha
  const handleRowSelect = useCallback((rowData, isSelected) => {
    if (!onRowSelect) return;

    const rowId = rowData[rowKey];
    let newSelectedRows;

    if (isSelected) {
      newSelectedRows = [...selectedRows, rowId];
    } else {
      newSelectedRows = selectedRows.filter(id => id !== rowId);
    }

    onRowSelect(newSelectedRows, rowData);
  }, [onRowSelect, selectedRows, rowKey]);

  // Handler para selecionar todas
  const handleSelectAll = useCallback((isSelected) => {
    if (!onRowSelect) return;

    if (isSelected) {
      const allIds = paginatedData.map(row => row[rowKey]);
      onRowSelect([...selectedRows, ...allIds.filter(id => !selectedRows.includes(id))]);
    } else {
      const currentPageIds = paginatedData.map(row => row[rowKey]);
      onRowSelect(selectedRows.filter(id => !currentPageIds.includes(id)));
    }
  }, [onRowSelect, paginatedData, selectedRows, rowKey]);

  // Ícone de ordenação
  const getSortIcon = useCallback((columnKey) => {
    if (!sortable) return null;
    
    if (sortConfig.key === columnKey) {
      return sortConfig.direction === 'asc' 
        ? <CaretUp size={16} /> 
        : <CaretDown size={16} />;
    }
    return <CaretUpDown size={16} className="opacity-50" />;
  }, [sortConfig, sortable]);

  // Verifica se todas as linhas estão selecionadas
  const isAllSelected = useMemo(() => {
    if (!onRowSelect || paginatedData.length === 0) return false;
    return paginatedData.every(row => selectedRows.includes(row[rowKey]));
  }, [onRowSelect, paginatedData, selectedRows, rowKey]);

  // Verifica se algumas linhas estão selecionadas
  const isSomeSelected = useMemo(() => {
    if (!onRowSelect || paginatedData.length === 0) return false;
    return paginatedData.some(row => selectedRows.includes(row[rowKey])) && !isAllSelected;
  }, [onRowSelect, paginatedData, selectedRows, rowKey, isAllSelected]);

  // Classes do container
  const containerClasses = `
    ${responsive ? 'overflow-x-auto' : ''}
    rounded-lg border border-gray-200 bg-white shadow-sm
    ${containerClassName}
  `;

  // Classes da tabela
  const tableClasses = `
    min-w-full divide-y divide-gray-200
    ${className}
  `;

  // Classes do header
  const headerClasses = `
    bg-gray-50 
    ${stickyHeader ? 'sticky top-0 z-10' : ''}
  `;

  // Renderiza estado de loading
  if (loading) {
    return (
      <div className={containerClasses}>
        <div className="flex items-center justify-center py-12">
          <LoadingSpinner size="lg" text="Carregando dados..." />
        </div>
      </div>
    );
  }

  // Renderiza estado de erro
  if (error) {
    return (
      <div className={containerClasses}>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="text-red-500 text-6xl mb-4">⚠️</div>
          <div className="text-red-600 font-medium mb-2">Erro ao carregar dados</div>
          <div className="text-gray-500 text-sm">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={containerClasses}>
      <table className={tableClasses} {...props}>
        {/* Header */}
        <thead className={headerClasses}>
          <tr>
            {/* Checkbox para selecionar todos */}
            {onRowSelect && (
              <th className="px-4 py-3 text-left">
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  ref={input => {
                    if (input) input.indeterminate = isSomeSelected;
                  }}
                  onChange={(e) => handleSelectAll(e.target.checked)}
                  className="rounded border-gray-300 text-[#000638] focus:ring-[#000638]"
                  aria-label="Selecionar todas as linhas"
                />
              </th>
            )}

            {/* Colunas */}
            {columns.map((column) => (
              <th
                key={column.key}
                className={`
                  px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider overflow-visible text-nowrap
                  ${column.sortable !== false && sortable && !column.headerRender ? 'cursor-pointer hover:bg-gray-100' : ''}
                  ${column.className || ''}
                `}
                onClick={column.headerRender ? undefined : () => column.sortable !== false && handleSort(column.key)}
                aria-sort={
                  sortConfig.key === column.key 
                    ? sortConfig.direction === 'asc' ? 'ascending' : 'descending'
                    : 'none'
                }
              >
                {column.headerRender ? column.headerRender({ column, sortConfig, handleSort, getSortIcon }) : (
                  <div className="flex items-center space-x-1 text-nowrap">
                    <span>{column.title}</span>
                    {column.sortable !== false && getSortIcon(column.key)}
                  </div>
                )}
              </th>
            ))}
          </tr>
        </thead>

        {/* Body */}
        <tbody className="bg-white divide-y divide-gray-200">
          {paginatedData.length === 0 ? (
            <tr>
              <td 
                colSpan={columns.length + (onRowSelect ? 1 : 0)} 
                className="px-4 py-12 text-center text-gray-500"
              >
                <div className="flex flex-col items-center">
                  <div className="text-4xl mb-4">📊</div>
                  <div>{emptyMessage}</div>
                </div>
              </td>
            </tr>
          ) : (
            paginatedData.map((row, index) => {
              const isSelected = selectedRows.includes(row[rowKey]);
              
              return (
                <tr
                  key={row[rowKey] || index}
                  className={`
                    transition-colors duration-150
                    ${isSelected ? 'bg-blue-50' : index % 2 === 0 ? 'bg-white hover:bg-gray-100' : 'bg-gray-100 hover:bg-gray-200'}
                    ${onRowClick ? 'cursor-pointer' : ''}
                  `}
                  onClick={() => onRowClick?.(row, index)}
                >
                  {/* Checkbox para seleção */}
                  {onRowSelect && (
                    <td className="px-4 py-3 text-nowrap">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          e.stopPropagation();
                          handleRowSelect(row, e.target.checked);
                        }}
                        className="rounded border-gray-300 text-[#000638] focus:ring-[#000638]"
                        aria-label={`Selecionar linha ${index + 1}`}
                      />
                    </td>
                  )}

                  {/* Células */}
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={`
                        px-4 py-3 text-sm text-gray-900 text-nowrap
                        ${column.cellClassName || ''}
                      `}
                    >
                      {column.render 
                        ? column.render(row[column.key], row, index)
                        : row[column.key]
                      }
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      {/* Informações de paginação */}
      {pagination && paginatedData.length > 0 && (
        <div className="px-4 py-3 border-t border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-700">
              Mostrando {((currentPage - 1) * pageSize) + 1} a{' '}
              {Math.min(currentPage * pageSize, sortedData.length)} de{' '}
              {sortedData.length} registros
            </div>
            
            {onPageChange && (
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => onPageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="px-3 py-1 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Anterior
                </button>
                <span className="text-sm">
                  Página {currentPage} de {Math.ceil(sortedData.length / pageSize)}
                </span>
                <button
                  onClick={() => onPageChange(currentPage + 1)}
                  disabled={currentPage === Math.ceil(sortedData.length / pageSize)}
                  className="px-3 py-1 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Próxima
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

Table.displayName = 'Table';

export default Table;