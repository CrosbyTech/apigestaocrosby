/**
 * Constantes de configuração da aplicação
 * Centraliza URLs, configurações e valores padrão
 */

// URLs da API
// Override opcional via .env(.local): VITE_API_BASE_URL=http://localhost:4001
// Em DEV sem override: usa window.location.origin (Vite proxy de /api → localhost:4001).
// Em PROD sem override: usa o backend público no Render.
export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV
    ? window.location.origin
    : 'https://apigestaocrosby-bw2v.onrender.com');

// Base das rotas TOTVS — sempre termina com "/" para uso como prefixo
// (ex: `${TotvsURL}persons/individuals/batch-lookup`)
export const TotvsURL = `${API_BASE_URL}/api/totvs/`;

// Endpoints específicos - Nova estrutura de API
export const API_ENDPOINTS = {
  // Financial
  EXTRATO: '/api/financial/extrato',

  CONTAS_PAGAR: '/api/financial/contas-pagar',
  CONTAS_RECEBER: '/api/financial/contas-receber',

  // Sales
  FATURAMENTO: '/api/sales/faturamento',
  FATURAMENTO_FRANQUIA: '/api/sales/faturamento-franquia',
  FATURAMENTO_MTM: '/api/sales/faturamento-mtm',
  FATURAMENTO_REVENDA: '/api/sales/faturamento-revenda',
  RANKING_VENDEDORES: '/api/sales/ranking-vendedores',

  // Company
  EMPRESAS: '/api/company/empresas',
  GRUPO_EMPRESA: '/api/company/grupo-empresas',
  FATURAMENTO_LOJAS: '/api/company/faturamento-lojas',
  EXPEDICAO: '/api/company/expedicao',
  PCP: '/api/company/pcp',

  // Franchise
  CONSULTA_FATURA: '/api/franchise/consulta-fatura',

  FRANQUIAS_CREDEV: '/api/franchise/franquias-credev',

  // Utils
  AUTOCOMPLETE_FANTASIA: '/api/utils/autocomplete/nm_fantasia',
  AUTOCOMPLETE_GRUPOEMPRESA: '/api/utils/autocomplete/nm_grupoempresa',
  CADASTRO_PESSOA: '/api/utils/cadastropessoa',
  HEALTH: '/api/utils/health',
  STATS: '/api/utils/stats',
  DOCS: '/api/docs',
};

// Configurações de UI
export const UI_CONFIG = {
  DEBOUNCE_DELAY: 300, // ms
  MAX_SELECTIONS: 5,
  ITEMS_PER_PAGE: 50,
  ANIMATION_DURATION: 200, // ms
};

// Configurações de validação
export const VALIDATION_CONFIG = {
  MAX_INPUT_LENGTH: 100,
  MIN_SEARCH_LENGTH: 1,
  DATE_FORMAT: 'YYYY-MM-DD',
};

// Cores do tema
export const THEME_COLORS = {
  PRIMARY: '#000638',
  DANGER: '#fe0000',
  SUCCESS: '#22c55e',
  WARNING: '#f59e0b',
  INFO: '#3b82f6',
  SECONDARY: '#6b7280',
};

// Breakpoints responsivos (seguindo Tailwind CSS)
export const BREAKPOINTS = {
  SM: '640px',
  MD: '768px',
  LG: '1024px',
  XL: '1280px',
  '2XL': '1536px',
};

// Mensagens de erro padrão
export const ERROR_MESSAGES = {
  NETWORK_ERROR: 'Erro de conexão. Verifique sua internet e tente novamente.',
  SERVER_ERROR:
    'Erro interno do servidor. Tente novamente em alguns instantes.',
  VALIDATION_ERROR: 'Dados inválidos. Verifique os campos e tente novamente.',
  NO_DATA: 'Nenhum dado encontrado para os filtros selecionados.',
  REQUIRED_FIELD: 'Este campo é obrigatório.',
  SELECT_COMPANY: 'Selecione pelo menos uma empresa para consultar.',
};

// Configurações de performance
export const PERFORMANCE_CONFIG = {
  LAZY_LOAD_THRESHOLD: '100px',
  CACHE_DURATION: 5 * 60 * 1000, // 5 minutos em ms
  MAX_CONCURRENT_REQUESTS: 3,
};

// Regex para sanitização
export const SANITIZATION_PATTERNS = {
  XSS_CHARS: /[<>]/g,
  SQL_INJECTION: /['";\\]/g,
  WHITESPACE: /\s+/g,
};

// Configurações de usuários e roles
export const USER_ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MANAGER: 'manager',
  USER: 'user',
  GUEST: 'guest',
  VENDEDOR: 'vendedor',
  FRANQUIAS: 'franquias',
};

export const USER_ROLE_LABELS = {
  [USER_ROLES.OWNER]: 'Proprietário',
  [USER_ROLES.ADMIN]: 'Administrador',
  [USER_ROLES.MANAGER]: 'Gerente',
  [USER_ROLES.USER]: 'Financeiro',
  [USER_ROLES.GUEST]: 'Padrão',
  [USER_ROLES.VENDEDOR]: 'Vendedor',
  [USER_ROLES.FRANQUIAS]: 'Franquias',
};

export const USER_ROLE_COLORS = {
  [USER_ROLES.OWNER]: 'bg-purple-100 text-purple-800',
  [USER_ROLES.ADMIN]: 'bg-red-100 text-red-800',
  [USER_ROLES.MANAGER]: 'bg-orange-100 text-orange-800',
  [USER_ROLES.USER]: 'bg-green-100 text-green-800',
  [USER_ROLES.GUEST]: 'bg-gray-100 text-gray-800',
  [USER_ROLES.VENDEDOR]: 'bg-emerald-100 text-emerald-800',
  [USER_ROLES.FRANQUIAS]: 'bg-blue-100 text-blue-800',
};
