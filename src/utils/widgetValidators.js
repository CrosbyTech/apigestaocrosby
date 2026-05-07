// Operadores disponíveis para filtros SQL
export const OPERATORS = {
  EQUAL: { value: '=', label: 'Igual a', symbol: '=' },
  NOT_EQUAL: { value: '<>', label: 'Diferente de', symbol: '≠' },
  GREATER: { value: '>', label: 'Maior que', symbol: '>' },
  GREATER_EQUAL: { value: '>=', label: 'Maior ou igual', symbol: '≥' },
  LESS: { value: '<', label: 'Menor que', symbol: '<' },
  LESS_EQUAL: { value: '<=', label: 'Menor ou igual', symbol: '≤' },
  LIKE: { value: 'LIKE', label: 'Contém', symbol: '~' },
  NOT_LIKE: { value: 'NOT LIKE', label: 'Não contém', symbol: '≁' },
  BETWEEN: { value: 'BETWEEN', label: 'Entre', symbol: '⇔' },
  IN: { value: 'IN', label: 'Em (lista)', symbol: '∈' },
  IS_NULL: { value: 'IS NULL', label: 'É nulo', symbol: '∅' },
  IS_NOT_NULL: { value: 'IS NOT NULL', label: 'Não é nulo', symbol: '∃' },
};

// Lista de operadores como array para fácil iteração
export const OPERATORS_LIST = Object.values(OPERATORS);

// Funções de agregação disponíveis
export const AGGREGATION_FUNCTIONS = {
  SUM: { value: 'SUM', label: 'Soma' },
  COUNT: { value: 'COUNT', label: 'Contar' },
  AVG: { value: 'AVG', label: 'Média' },
  MIN: { value: 'MIN', label: 'Mínimo' },
  MAX: { value: 'MAX', label: 'Máximo' },
};

export const AGGREGATION_FUNCTIONS_LIST = Object.values(AGGREGATION_FUNCTIONS);

// Tipos de visualização de widget
export const WIDGET_TYPES = {
  TABLE: { value: 'table', label: 'Tabela', icon: '📊' },
  BAR_CHART: { value: 'bar', label: 'Gráfico de Barras', icon: '📊' },
  PIE_CHART: { value: 'pie', label: 'Gráfico de Pizza', icon: '🥧' },
  LINE_CHART: { value: 'line', label: 'Gráfico de Linha', icon: '📈' },
};

export const WIDGET_TYPES_LIST = Object.values(WIDGET_TYPES);

/**
 * Valida se o operador requer um valor
 * @param {string} operator - O operador a validar
 * @returns {boolean}
 */
export const operatorRequiresValue = (operator) => {
  return ![OPERATORS.IS_NULL.value, OPERATORS.IS_NOT_NULL.value].includes(
    operator,
  );
};

/**
 * Valida se o operador requer dois valores (BETWEEN)
 * @param {string} operator - O operador a validar
 * @returns {boolean}
 */
export const operatorRequiresTwoValues = (operator) => {
  return operator === OPERATORS.BETWEEN.value;
};

/**
 * Valida se o operador aceita múltiplos valores (IN)
 * @param {string} operator - O operador a validar
 * @returns {boolean}
 */
export const operatorAcceptsMultipleValues = (operator) => {
  return operator === OPERATORS.IN.value;
};

/**
 * Formata um filtro para exibição legível
 * @param {object} filter - O filtro a formatar
 * @returns {string}
 */
export const formatFilterForDisplay = (filter) => {
  const operator = OPERATORS_LIST.find((op) => op.value === filter.operator);

  if (!operator) return '';

  if (filter.operator === OPERATORS.BETWEEN.value) {
    return `${filter.column} ${operator.label} ${filter.value} e ${filter.value2}`;
  }

  if (filter.operator === OPERATORS.IN.value) {
    return `${filter.column} ${operator.label} (${filter.values.join(', ')})`;
  }

  if (
    [OPERATORS.IS_NULL.value, OPERATORS.IS_NOT_NULL.value].includes(
      filter.operator,
    )
  ) {
    return `${filter.column} ${operator.label}`;
  }

  return `${filter.column} ${operator.symbol} ${filter.value}`;
};

/**
 * Valida se um filtro está completo
 * @param {object} filter - O filtro a validar
 * @returns {object} { valid: boolean, error: string }
 */
export const validateFilter = (filter) => {
  if (!filter.column) {
    return { valid: false, error: 'Selecione uma coluna' };
  }

  if (!filter.operator) {
    return { valid: false, error: 'Selecione um operador' };
  }

  if (operatorRequiresValue(filter.operator)) {
    if (operatorRequiresTwoValues(filter.operator)) {
      if (!filter.value || !filter.value2) {
        return {
          valid: false,
          error: 'Preencha ambos os valores para BETWEEN',
        };
      }
    } else if (operatorAcceptsMultipleValues(filter.operator)) {
      if (!filter.values || filter.values.length === 0) {
        return { valid: false, error: 'Adicione pelo menos um valor' };
      }
    } else {
      if (!filter.value && filter.value !== 0) {
        return { valid: false, error: 'Preencha o valor do filtro' };
      }
    }
  }

  return { valid: true, error: null };
};

/**
 * Gera a cláusula WHERE SQL a partir dos filtros (apenas para visualização)
 * @param {array} filters - Array de filtros
 * @returns {string}
 */
export const generateWhereClause = (filters) => {
  if (!filters || filters.length === 0) return '';

  const clauses = filters.map((filter) => {
    if (filter.operator === OPERATORS.BETWEEN.value) {
      return `${filter.column} BETWEEN '${filter.value}' AND '${filter.value2}'`;
    }

    if (filter.operator === OPERATORS.IN.value) {
      const values = filter.values.map((v) => `'${v}'`).join(', ');
      return `${filter.column} IN (${values})`;
    }

    if (
      [OPERATORS.IS_NULL.value, OPERATORS.IS_NOT_NULL.value].includes(
        filter.operator,
      )
    ) {
      return `${filter.column} ${filter.operator}`;
    }

    if (
      filter.operator === OPERATORS.LIKE.value ||
      filter.operator === OPERATORS.NOT_LIKE.value
    ) {
      return `${filter.column} ${filter.operator} '%${filter.value}%'`;
    }

    return `${filter.column} ${filter.operator} '${filter.value}'`;
  });

  return clauses.join(' AND ');
};
