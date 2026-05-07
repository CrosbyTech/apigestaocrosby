// ═══════════════════════════════════════════════════════════════════════════
// CRM de Vendas — Constantes e Mapeamentos
// ═══════════════════════════════════════════════════════════════════════════

// Módulos disponíveis
export const MODULOS = [
  { key: 'multimarcas', label: 'Multimarcas', icon: '🏪' },
  { key: 'inbound_david', label: 'MTM Inbound David', icon: '🎯' },
  { key: 'inbound_rafael', label: 'MTM Inbound Rafael', icon: '🎯' },
  { key: 'revenda', label: 'Revenda', icon: '📦' },
  { key: 'business', label: 'Business', icon: '💼' },
  { key: 'franquia', label: 'Franquia', icon: '🏢' },
  { key: 'showroom', label: 'Showroom', icon: '🖥️' },
  { key: 'novidadesfranquia', label: 'Novidades Franquia', icon: '⭐' },
  { key: 'varejo', label: 'Varejo', icon: '🛍' },
  { key: 'bazar', label: 'Bazar', icon: '🏷️' },
];

// Tabs principais (Painel Geral é um modo "global" — botão separado fora das tabs)
export const TABS = [
  { key: 'abertura', label: 'CRM Abertura' },
  { key: 'carteira', label: 'CRM Carteira' },
  { key: 'lead-gen', label: 'Lead Generation' },
  { key: 'performance', label: 'Performance' },
  { key: 'contato', label: 'Último Contato' },
  { key: 'turno', label: 'Turno' },
  { key: 'conversao', label: 'Conversão' },
  { key: 'analytics', label: 'Analytics' },
];

// Sub-tabs do CRM Abertura
export const SUB_TABS = [
  { key: 'funil', label: 'Funil' },
  { key: 'roubar', label: 'Roubar Leads' },
  { key: 'canal', label: 'Canal Errado?' },
];

// Instâncias de times (closers que compartilham)
export const INST_TEAMS = {
  atc1136: ['atc1136', 'atc2318'],
  atc2318: ['atc1136', 'atc2318'],
};

// Mapeamento canal → tipos ERP aceitos
export const CANAL_TIPO_MAP = {
  Revenda: ['REVENDEDOR'],
  Multimarcas: ['MULTIMARCA', 'MULTIMARCAS'],
  'Multimarcas Inbound': ['MULTIMARCA', 'MULTIMARCAS'],
  Business: ['BUSINESS', 'B2B'],
  Franquia: ['FRANQUIA', 'FRANQUEADO'],
  Varejo: ['VAREJO', 'OUTROS'],
};

// Mapeamento vendedor ERP → canal
export const VENDOR_CANAL_MAP = {
  'CLEYTON F': 'revenda',
  'FELIPE PB': 'revenda',
  'WALTER MULTIMARCAS': 'multimarcas',
  'MARCIO SILVERIO': 'business',
  JHEMYSON: 'franquia',
};

// Códigos TOTVS dos vendedores por módulo (para filtrar CarteiraView)
// Multimarcas: Walter(177), Renato(65), Arthur(259) — David(26)/Thalis(69) → inbound_david, Rafael(21) → inbound_rafael
// Revenda BR99: Cleiton(161), Heyridan(15), Yago(241), Michel(165), Anderson(25), Aldo(779)
// Revenda BR2 (JPA): Jucelino(288), Felipe(251), (131)
export const VENDEDORES_POR_MODULO = {
  multimarcas: new Set([177, 65, 259]),
  inbound_david: new Set([26, 69]),
  inbound_rafael: new Set([21]),
  revenda: new Set([161, 15, 241, 165, 25, 779, 288, 251, 131]),
  varejo: null, // usa filtro por operação
  business: null, // sem filtro por código (pequeno volume)
  franquia: null, // sem filtro por código (pequeno volume)
  showroom: null, // usa filtro por operação
  novidadesfranquia: null, // usa filtro por operação
  bazar: null, // usa filtro por operação (op 887)
};

// Códigos de operação TOTVS válidos por módulo (para filtrar faturamento)
export const OPERATIONS_POR_MODULO = {
  // Revendedor
  revenda: [7236, 9122, 5102, 7242],
  // Multimarcas
  multimarcas: [7235, 7241],
  // MTM Inbound
  inbound_david: [7235, 7241],
  inbound_rafael: [7235, 7241],
  // Franquia
  franquia: [7234, 7240, 7802],
  // Showroom
  showroom: [7254, 7007],
  // Novidades Franquia
  novidadesfranquia: [7255],
  // Business
  business: [7237, 7269, 7279, 7277],
  // Varejo: NFC-e + NF-e varejo + não presencial
  varejo: [510, 545, 546, 521, 522, 548],
  // Bazar: operação específica de defeitos 20%
  bazar: [887],
};

// Mapeamento código vendedor TOTVS → nome da instância Evolution (WhatsApp)
// Usado para cruzar oportunidades do ClickUp com o vendedor responsável
export const VENDEDOR_CODE_TO_INST = {
  // Revenda
  25: 'anderson',
  161: 'atc2318', // Cleiton
  165: 'michel',
  241: 'yago',
  251: 'felipepb',
  779: 'baatacado', // Aldo
  15: 'atc1136', // Heyridan
  // Multimarcas
  177: 'walter',
  65: 'renato',
  21: 'rafael',
  26: 'david',
  259: 'arthur',
  69: 'thalis',
};

// Mapeamento vendedor ERP → instância WhatsApp
export const VENDOR_INST_MAP = {
  'ANDERSON MEDEIROS': 'anderson',
  'CLEYTON F': 'atc2318',
  'WALTER MULTIMARCAS': 'walter',
  'MARCIO SILVERIO': 'marcio',
};

// Mapeamento vendedor ERP → nome no ClickUp
export const VENDOR_CLICKUP_MAP = {
  'ANDERSON MEDEIROS': 'Anderson',
  'CLEYTON F': 'Cleiton',
};

// Info dos closers (instância + telefone)
export const CLOSER_INFO = {
  Anderson: { inst: 'anderson', fone: '84991221sjt' },
  Rafael: { inst: 'rafael', fone: '84991850238' },
  Walter: { inst: 'walter', fone: '84991689950' },
  David: { inst: 'david', fone: '84998193498' },
  Thalis: { inst: 'thalis', fone: '' },
  Renato: { inst: 'renato', fone: '84987622585' },
  Arthur: { inst: 'arthur', fone: '84981140498' },
};

// Instância → canal
export const INST_CANAL_MAP = {
  prosp: 'todos',
  anderson: 'revenda',
  walter: 'multimarcas',
  marcio: 'business',
  // Lojas Varejo
  midway: 'varejo',
  cidadejardim: 'varejo',
  ayrtonsenna: 'varejo',
  canguartema: 'varejo',
  novacruz: 'varejo',
  parnamirim: 'varejo',
  recife: 'varejo',
  teresina: 'varejo',
  imperatriz: 'varejo',
  guararapes: 'varejo',
  patos: 'varejo',
  joaopessoa: 'varejo',
};

// Todas as instâncias WhatsApp
export const ALL_INSTANCES = [
  { name: 'prosp', label: 'Jason (Prosp)' },
  { name: 'anderson', label: 'Anderson' },
  { name: 'rafael', label: 'Rafael' },
  { name: 'david', label: 'David' },
  { name: 'walter', label: 'Walter' },
  { name: 'yago', label: 'Yago' },
  { name: 'renato', label: 'Renato' },
  { name: 'arthur', label: 'Arthur' },
  { name: 'marcio', label: 'Marcio' },
  { name: 'atc2318', label: 'Cleiton' },
  { name: 'atc1136', label: 'Heyridan' },
  { name: 'felipepb', label: 'Felipe PB' },
  { name: 'michel', label: 'Michel' },
  { name: 'jucelino', label: 'Juscelino' },
  { name: 'baatacado', label: 'Aldo' },
  // Lojas (Varejo)
  { name: 'midway', label: 'Loja Midway' },
  { name: 'cidadejardim', label: 'Loja Cidade Jardim' },
  { name: 'shoppingcidadejardim', label: 'Loja Cidade Jardim (Shopping)' },
  { name: 'ayrtonsenna', label: 'Loja Ayrton Senna' },
  { name: 'canguartema', label: 'Loja Canguaretama' },
  { name: 'novacruz', label: 'Loja Nova Cruz' },
  { name: 'parnamirim', label: 'Loja Parnamirim' },
  { name: 'recife', label: 'Loja Recife' },
  { name: 'teresina', label: 'Loja Teresina' },
  { name: 'imperatriz', label: 'Loja Imperatriz' },
  { name: 'guararapes', label: 'Loja Guararapes' },
  { name: 'patos', label: 'Loja Patos' },
  { name: 'joaopessoa', label: 'Loja João Pessoa' },
];

// Cores para os cards
export const COLORS = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#f97316',
  '#14b8a6',
  '#6366f1',
  '#84cc16',
  '#e11d48',
];

// Regras de inatividade (em dias)
export const INATIVIDADE_REGRAS = {
  revenda: { alerta: 60, limite: 90 },
  multimarcas: { alerta: 180, limite: 210 },
  varejo: { alerta: 180, limite: 210 },
  business: { alerta: 90, limite: 120 },
  franquia: { alerta: 60, limite: 90 },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

export function cleanPhone(tel) {
  return (tel || '').replace(/\D/g, '');
}

export function formatPhone(tel) {
  const c = cleanPhone(tel);
  if (c.length === 13)
    return c.replace(/(\d{2})(\d{2})(\d{5})(\d{4})/, '+$1 ($2) $3-$4');
  if (c.length === 11) return c.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  return tel || '—';
}

export function getContactStatus(tel, closerInst, phoneStatus) {
  const clean = cleanPhone(tel);
  if (!clean) return 'pendente';
  const ps = phoneStatus[clean];
  if (!ps || ps.closer === 0) return 'pendente';
  const validInsts = INST_TEAMS[closerInst] || [closerInst];
  if (
    closerInst &&
    ps.instances &&
    ps.instances.some((i) => validInsts.includes(i))
  )
    return 'contatado';
  return 'outro';
}

export function instLabel(name) {
  const found = ALL_INSTANCES.find((i) => i.name === name);
  return found ? found.label : name;
}
