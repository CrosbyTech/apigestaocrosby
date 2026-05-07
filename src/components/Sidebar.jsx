import React, { useState, useCallback, memo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import {
  UserGear,
  X,
  Money,
  Receipt,
  FileText,
  Calendar,
  ChartLineUp,
  CheckCircle,
  Megaphone,
  Storefront,
  Buildings,
  TrendUp,
  Trophy,
  Users,
  ShoppingCart,
  CaretDown,
  CaretRight,
  Folder,
  Shield,
  House,
  Bank,
  Eye,
  ChartBar,
  Target,
  IdentificationCard,
  CurrencyDollar,
  SquaresFour,
  SpotifyLogo,
  Article,
  ClipboardText,
  Handshake,
  Wallet,
  Clock,
  Package,
  Ticket,
  WhatsappLogo,
} from '@phosphor-icons/react';

// Componentes de ícones modernos
const ChevronIcon = ({ open }) =>
  open ? (
    <CaretDown
      size={16}
      className="ml-auto transition-transform duration-200"
    />
  ) : (
    <CaretRight
      size={16}
      className="ml-auto transition-transform duration-200"
    />
  );

const financeiro = [
  {
    name: 'Contas a Pagar',
    href: '#',
    icon: Money,
    color: 'text-red-600',
    roles: ['owner', 'admin', 'manager', 'user'],
    children: [
      {
        name: 'Consulta',
        href: '/contas-a-pagar',
        icon: Calendar,
        color: 'text-red-600',
        roles: ['owner', 'admin', 'manager', 'user'],
      },
      {
        name: 'Empréstimos',
        href: '/emprestimos',
        icon: Bank,
        color: 'text-red-600',
        roles: ['owner', 'admin', 'manager', 'user'],
      },
      {
        name: 'Controle de Filiais',
        href: '/despesa-filial',
        icon: Buildings,
        color: 'text-red-600',
        roles: ['owner', 'admin', 'manager', 'user'],
      },
      {
        name: 'Liberação de Pagamento',
        href: '/liberacao-pagamento',
        icon: CheckCircle,
        color: 'text-red-600',
        roles: ['owner', 'admin', 'manager', 'user'],
      },
    ],
  },
  {
    name: 'Contas a Receber',
    href: '#',
    icon: Receipt,
    color: 'text-green-600',
    roles: ['owner', 'admin', 'manager', 'user'],
    children: [
      {
        name: 'Consulta',
        href: '/contas-a-receber',
        icon: Calendar,
        color: 'text-green-600',
        roles: ['owner', 'admin', 'manager', 'user'],
      },
      {
        name: 'Dashboard',
        href: '/dash-contas-a-receber',
        icon: ChartBar,
        color: 'text-green-600',
        roles: ['owner', 'admin', 'manager', 'user'],
      },
      {
        name: 'Dashboard Inadimplência',
        href: '/dash-inadimplencia',
        icon: ChartBar,
        color: 'text-red-600',
        roles: ['owner', 'admin', 'manager', 'user'],
      },
      {
        name: 'Dashboard PMR',
        href: '/pmr',
        icon: Clock,
        color: 'text-cyan-600',
        roles: ['owner', 'admin', 'manager', 'user'],
      },
    ],
  },
  {
    name: 'Batida de Carteira',
    href: '/batida-carteira',
    icon: Wallet,
    color: 'text-emerald-600',
    roles: ['owner', 'admin', 'manager', 'user'],
  },
  {
    name: 'Solicitação de Baixa',
    href: '/solicitacao-baixa',
    icon: Receipt,
    color: 'text-indigo-600',
    roles: ['owner', 'admin', 'manager', 'user'],
  },
  {
    name: 'Análise de Crédito',
    href: '/analise-credito',
    icon: ClipboardText,
    color: 'text-purple-600',
    roles: ['owner', 'admin', 'manager'],
  },
  {
    name: 'Análise de Renegociações',
    href: '/analise-renegociacao',
    icon: Handshake,
    color: 'text-orange-600',
    roles: ['owner', 'admin', 'manager'],
  },
  {
    name: 'DRE',
    href: '/dre',
    icon: ChartBar,
    color: 'text-purple-600',
    roles: ['owner', 'admin', 'manager', 'user'],
  },
  {
    name: 'Extrato TOTVS',
    href: '/extrato-totvs',
    icon: Bank,
    color: 'text-teal-600',
    roles: ['owner', 'admin', 'manager', 'user'],
  },
];

const faturamento = [
  {
    name: 'CMV Consolidado',
    href: '/cmv-consolidado',
    icon: FileText,
    color: 'text-indigo-600',
  },
  {
    name: 'CMV Multimarcas',
    href: '/cmv-multimarcas',
    icon: FileText,
    color: 'text-indigo-600',
  },
  {
    name: 'CMV Revenda',
    href: '/cmv-revenda',
    icon: FileText,
    color: 'text-indigo-600',
  },
  {
    name: 'CMV Franquia',
    href: '/cmv-franquia',
    icon: FileText,
    color: 'text-indigo-600',
  },
  {
    name: 'CMV Varejo',
    href: '/cmv-varejo',
    icon: FileText,
    color: 'text-indigo-600',
  },
];

const estoqueItems = [
  {
    name: 'Consulta de Estoque',
    href: '/estoque',
    icon: Package,
    color: 'text-teal-600',
  },
];

const painelVendasItems = [
  {
    name: 'Painel de Vendas',
    href: '/painel-vendas',
    icon: ShoppingCart,
    color: 'text-blue-600',
  },
  {
    name: 'CRM de Vendas',
    href: '/crm-vendas',
    icon: Storefront,
    color: 'text-emerald-600',
  },
  {
    name: 'Forecast',
    href: '/faturamento-canal',
    icon: ChartBar,
    color: 'text-violet-600',
  },
  {
    name: 'Faturamento TOTVS',
    href: '/totvs',
    icon: ChartBar,
    color: 'text-blue-600',
  },
  {
    name: 'Catálogo Virtual',
    href: '/catalogo-admin',
    icon: Storefront,
    color: 'text-indigo-600',
  },
];

const varejo = [
  {
    name: 'Dashboard Varejo',
    href: '/dashboard-varejo',
    icon: ChartLineUp,
    color: 'text-indigo-600',
  },
  {
    name: 'Metas Varejo',
    href: '/metas-varejo',
    icon: Target,
    color: 'text-orange-600',
  },
  {
    name: 'CREDEV VAREJO',
    href: '/credev-varejo',
    icon: Buildings,
    color: 'text-green-600',
  },
  {
    name: 'Top Clientes',
    href: '/top-clientes',
    icon: Trophy,
    color: 'text-amber-600',
  },
  {
    name: 'Documento Bluecred',
    href: '/documento-bluecred',
    icon: FileText,
    color: 'text-blue-600',
  },
  {
    name: 'Clientes Bluecred',
    href: '/clientes-bluecred',
    icon: ClipboardText,
    color: 'text-blue-700',
  },
];

const multimarcas = [
  {
    name: 'Dashboard Multimarcas',
    href: '/dashboard-multimarcas',
    icon: ChartLineUp,
    color: 'text-indigo-600',
  },
  {
    name: 'CREDEV MULTIMARCAS',
    href: '/credev-multimarcas',
    icon: Buildings,
    color: 'text-purple-600',
  },
  {
    name: 'Inadimplentes Multimarcas',
    href: '/inadimplentes-multimarcas',
    icon: ChartBar,
    color: 'text-purple-600',
  },
  {
    name: 'Minhas Solicit. Baixa',
    href: '/minhas-solicitacoes-baixa',
    icon: ClipboardText,
    color: 'text-indigo-600',
  },
  {
    name: 'Portal de Títulos MTM',
    href: '/titulos-clientes',
    icon: Receipt,
    color: 'text-blue-600',
  },
  {
    name: 'Clientes MTM',
    href: '/clientes-mtm',
    icon: Users,
    color: 'text-purple-600',
  },
];

const revenda = [
  {
    name: 'Dashboard Revenda',
    href: '/dashboard-revenda',
    icon: ChartLineUp,
    color: 'text-indigo-600',
  },
  {
    name: 'CREDEV REVENDA',
    href: '/credev-revenda',
    icon: Buildings,
    color: 'text-blue-600',
  },
  {
    name: 'Inadimplentes Revenda',
    href: '/inadimplentes-revenda',
    icon: ChartBar,
    color: 'text-purple-600',
  },
];

const franquias = [
  {
    name: 'Dashboard Franquias',
    href: '/dashboard-franquias',
    icon: ChartLineUp,
    color: 'text-indigo-600',
  },
  {
    name: 'Compras Franquias',
    href: '/compras-franquias',
    icon: ShoppingCart,
    color: 'text-emerald-600',
  },
  { name: 'CREDEV', href: '/credev', icon: Buildings, color: 'text-blue-600' },
  {
    name: 'Crédito Franquia',
    href: '/credito-franquia',
    icon: Wallet,
    color: 'text-emerald-600',
  },
  {
    name: 'Inadimplentes Franquias',
    href: '/inadimplentes-franquias',
    icon: ChartBar,
    color: 'text-purple-600',
  },
  {
    name: 'Minhas Solicit. Baixa',
    href: '/minhas-solicitacoes-baixa',
    icon: ClipboardText,
    color: 'text-indigo-600',
  },
];

const confianca = [
  {
    name: 'Fatura',
    href: '/faturas-clientes-antecipacao',
    icon: Receipt,
    color: 'text-amber-600',
  },
  {
    name: 'Notas Fiscais',
    href: '/nf-clientes-antecipacao',
    icon: Article,
    color: 'text-amber-600',
  },
  {
    name: 'Comprovantes',
    href: '/comprovantes-antecipacao',
    icon: CheckCircle,
    color: 'text-amber-600',
  },
  {
    name: 'Clientes',
    href: '/clientes-antecipacao',
    icon: Users,
    color: 'text-amber-600',
  },
  {
    name: 'Licitação de Títulos',
    href: '/licitacao-titulos',
    icon: Wallet,
    color: 'text-amber-600',
  },
  {
    name: 'Solicitações de Remessa',
    href: '/solicitacoes-remessa',
    icon: Wallet,
    color: 'text-amber-600',
  },
  {
    name: 'Minhas Remessas',
    href: '/minhas-remessas',
    icon: Wallet,
    color: 'text-amber-600',
  },
];

const clientesItems = [
  {
    name: 'Consulta Cliente',
    href: '/consulta-cliente',
    icon: IdentificationCard,
    color: 'text-blue-600',
  },
  {
    name: 'Clientes TOTVS',
    href: '/clientes-totvs',
    icon: Users,
    color: 'text-indigo-600',
  },
  {
    name: 'Créditos Clientes',
    href: '/creditos-clientes',
    icon: Wallet,
    color: 'text-emerald-600',
  },
  {
    name: 'Top Clientes',
    href: '/top-clientes',
    icon: Trophy,
    color: 'text-amber-600',
  },
];

const adminItems = [
  {
    name: 'Painel Admin',
    href: '/painel-admin',
    icon: UserGear,
    color: 'text-red-600',
  },
  {
    name: 'Gerenciador de Dashboards',
    href: '/gerenciador-dashboards',
    icon: SquaresFour,
    color: 'text-blue-600',
  },
  {
    name: 'Gerenciador de Acessos',
    href: '/gerenciador-acessos',
    icon: Shield,
    color: 'text-purple-600',
  },
  {
    name: 'Gerenciador de Avisos',
    href: '/gerenciador-avisos',
    icon: Megaphone,
    color: 'text-orange-600',
  },
  {
    name: 'API Claude',
    href: '/api-claude',
    icon: Article,
    color: 'text-indigo-600',
  },
  {
    name: 'Crosby Manage',
    href: '/crosby-manage',
    icon: WhatsappLogo,
    color: 'text-emerald-600',
  },
];

const minhaFranquiaItem = {
  name: 'Minha Franquia',
  href: '#',
  icon: Folder,
  color: 'text-amber-600',
  children: [
    {
      name: 'Portal de Títulos',
      href: '/contas-pagar-franquias',
      icon: Receipt,
      color: 'text-red-600',
    },
    {
      name: 'Vouchers',
      href: '/voucher-usage',
      icon: Ticket,
      color: 'text-purple-600',
    },
    {
      name: 'Extrato de Crédito',
      href: '/extrato-credito',
      icon: CurrencyDollar,
      color: 'text-green-600',
    },
    {
      name: 'Solicitação de Crédito',
      href: '/solicitacao-credito',
      icon: CurrencyDollar,
      color: 'text-green-600',
    },
    {
      name: 'Renegociação de Dívidas',
      href: '/renegociacao-dividas',
      icon: Handshake,
      color: 'text-orange-600',
    },
    {
      name: 'Notas Fiscais',
      href: '/notas-fiscais',
      icon: Article,
      color: 'text-blue-600',
    },
    {
      name: 'Consulta NFs',
      href: '/consulta-nfs',
      icon: Article,
      color: 'text-indigo-600',
    },
  ],
};

const recuperacaoCredito = [
  {
    name: 'Recuperação de Crédito',
    href: '/recuperacao-credito',
    icon: Handshake,
    color: 'text-red-600',
  },
  {
    name: 'Dashboard Inadimplência',
    href: '/dash-inadimplencia',
    icon: ChartBar,
    color: 'text-red-600',
  },
  {
    name: 'Inadimplência Multimarcas',
    href: '/inadimplentes-multimarcas',
    icon: Buildings,
    color: 'text-purple-600',
  },
  {
    name: 'Inadimplência Franquias',
    href: '/inadimplentes-franquias',
    icon: Users,
    color: 'text-amber-600',
  },
];

const getRoleLabel = (role) => {
  const roleConfig = {
    admin: 'Administrador',
    manager: 'Gerente',
    user: 'Financeiro',
    guest: 'Padrão',
    owner: 'Proprietário',
    vendedor: 'Vendedor',
  };
  return roleConfig[role] || role;
};

// ======================== COMPONENTES EXTRAÍDOS ========================

const MenuItem = memo(
  ({ item, isActive, level = 0, hasAccessToPage, pathname, onNavigate }) => {
    const [open, setOpen] = useState(false);
    const IconComponent = item.icon;
    const paddingLeft = level === 0 ? 'pl-3' : 'pl-6';

    // Se tem filhos, só mostra se pelo menos um filho for acessível
    if (item.children && Array.isArray(item.children)) {
      const hasAnyVisibleChild = item.children.some(
        (child) => child.href === '#' || hasAccessToPage(child.href),
      );
      if (!hasAnyVisibleChild) return null;
    }

    const canSee = item.href === '#' || hasAccessToPage(item.href);
    if (!canSee) return null;

    if (item.children && Array.isArray(item.children)) {
      return (
        <div className={`${paddingLeft}`}>
          <button
            onClick={() => setOpen((prev) => !prev)}
            className={`
            w-full flex items-center gap-2 pr-3 py-2 
            text-xs font-semibold rounded-lg transition-all duration-200 font-barlow
            ${
              open
                ? 'bg-gray-100 text-gray-900'
                : 'text-gray-700 hover:bg-gray-200 hover:text-gray-900'
            }
          `}
          >
            <IconComponent size={14} className="text-gray-500" />
            <span>{item.name}</span>
            <ChevronIcon open={open} />
          </button>
          {open && (
            <div className="mt-1 space-y-1">
              {item.children.map((child) => (
                <MenuItem
                  key={`${item.name}-${child.name}`}
                  item={child}
                  isActive={pathname === child.href}
                  level={level + 1}
                  hasAccessToPage={hasAccessToPage}
                  pathname={pathname}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          )}
        </div>
      );
    }

    return (
      <button
        onClick={() => onNavigate(item.href, item.external)}
        className={`
        w-full flex items-center gap-2 ${paddingLeft} pr-3 py-2 
        text-xs font-medium rounded-lg transition-all duration-200 font-barlow
        ${
          isActive
            ? 'bg-gradient-to-r from-blue-50 to-blue-100 text-blue-700 border-r-2 border-blue-600'
            : 'text-gray-700 hover:bg-gray-200 hover:text-gray-900'
        }
      `}
      >
        {IconComponent && (
          <IconComponent
            size={14}
            weight={isActive ? 'fill' : 'regular'}
            className="text-gray-500"
          />
        )}
        <span className={`${isActive ? 'font-semibold' : ''}`}>
          {item.name}
        </span>
        {item.external && (
          <svg
            className="ml-auto w-4 h-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
            />
          </svg>
        )}
      </button>
    );
  },
);
MenuItem.displayName = 'MenuItem';

const MenuSection = memo(
  ({
    title,
    items,
    isOpen,
    onToggle,
    icon: SectionIcon,
    color = 'text-gray-600',
    hasAccessToPage,
    pathname,
    onNavigate,
  }) => {
    const hasVisibleItems = items.some((item) => {
      if (item.children && Array.isArray(item.children)) {
        return item.children.some((child) => hasAccessToPage(child.href));
      }
      return item.href === '#' || hasAccessToPage(item.href);
    });

    if (!hasVisibleItems) return null;

    return (
      <div className="mb-2">
        <button
          onClick={onToggle}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg transition-all duration-200 hover:bg-gray-200 group font-barlow"
        >
          <SectionIcon size={14} className="text-gray-500" />
          <span className="flex-1 text-left text-gray-800">{title}</span>
          <ChevronIcon open={isOpen} />
        </button>

        {isOpen && (
          <div className="mt-2 space-y-1 animate-in slide-in-from-top-2 duration-200">
            {items.map((item) => (
              <MenuItem
                key={item.name}
                item={item}
                isActive={pathname === item.href}
                level={1}
                hasAccessToPage={hasAccessToPage}
                pathname={pathname}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        )}
      </div>
    );
  },
);
MenuSection.displayName = 'MenuSection';

// ======================== SIDEBAR PRINCIPAL ========================

const Sidebar = ({ isOpen, onClose, onToggle }) => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user } = useAuth();
  const [openSection, setOpenSection] = useState(null);

  const handleSectionToggle = useCallback((section) => {
    setOpenSection((prev) => (prev === section ? null : section));
  }, []);

  const handleNavigation = useCallback(
    (href, external = false) => {
      onClose();
      if (external) {
        window.open(href, '_blank');
      } else {
        navigate(href);
      }
    },
    [onClose, navigate],
  );

  const hasAccessToPage = useCallback(
    (href) => {
      if (!user) return false;
      if (user.allowedPages === '*') return true;
      if (user.allowedPages && Array.isArray(user.allowedPages)) {
        return user.allowedPages.includes(href);
      }
      return false;
    },
    [user?.allowedPages],
  );

  if (!user) return null;

  const menuProps = { hasAccessToPage, pathname, onNavigate: handleNavigation };

  const sidebarContent = (
    <div className="w-60 h-full bg-white shadow-xl border-r border-gray-200 flex flex-col">
      {/* Header com logo e close button */}
      <div className="h-16 px-4 border-b border-gray-100 flex justify-between items-center bg-gradient-to-r from-blue-50 to-white">
        <div className="flex items-center gap-3">
          <img src="/crosbyazul.png" alt="Logo Crosby" className="h-8 w-auto" />
        </div>
        <button
          onClick={onClose}
          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <X size={20} />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-4 space-y-3 overflow-y-auto overflow-x-hidden">
        {/* Home */}
        <MenuItem
          {...menuProps}
          item={{
            name: 'Home',
            href: '/home',
            icon: House,
            color: 'text-blue-600',
          }}
          isActive={pathname === '/home'}
        />

        {/* Crosby Bot */}
        <MenuItem
          {...menuProps}
          item={{
            name: 'Crosby Bot',
            href: '/crosby-bot',
            icon: Megaphone,
            color: 'text-indigo-600',
          }}
          isActive={pathname === '/crosby-bot'}
        />

        {/* BI EXTERNO */}
        <MenuItem
          {...menuProps}
          item={{
            name: 'Estoque e Showroom',
            href: '/bi-externo',
            icon: ChartLineUp,
            color: 'text-indigo-600',
          }}
          isActive={pathname === '/bi-externo'}
        />

        {/* BI EXTERNO */}
        <MenuItem
          {...menuProps}
          item={{
            name: 'BIs Externo',
            href: '/dashboard',
            icon: ChartLineUp,
            color: 'text-indigo-600',
          }}
          isActive={pathname === '/dashboard'}
        />

        {/* Seção Financeiro */}
        <MenuSection
          {...menuProps}
          title="Financeiro"
          items={financeiro}
          isOpen={openSection === 'financeiro'}
          onToggle={() => handleSectionToggle('financeiro')}
          icon={Money}
          color="text-emerald-600"
        />

        {/* Seção CMV */}
        <MenuSection
          {...menuProps}
          title="CMV"
          items={faturamento}
          isOpen={openSection === 'faturamento'}
          onToggle={() => handleSectionToggle('faturamento')}
          icon={ChartLineUp}
          color="text-blue-600"
        />

        {/* Seção Painel de Vendas */}
        <MenuSection
          {...menuProps}
          title="Painel de Vendas"
          items={painelVendasItems}
          isOpen={openSection === 'painelVendas'}
          onToggle={() => handleSectionToggle('painelVendas')}
          icon={ShoppingCart}
          color="text-blue-600"
        />

        {/* Seção Estoque */}
        <MenuSection
          {...menuProps}
          title="Estoque"
          items={estoqueItems}
          isOpen={openSection === 'estoque'}
          onToggle={() => handleSectionToggle('estoque')}
          icon={Package}
          color="text-teal-600"
        />

        {/* Seção Varejo */}
        <MenuSection
          {...menuProps}
          title="Varejo"
          items={varejo}
          isOpen={openSection === 'varejo'}
          onToggle={() => handleSectionToggle('varejo')}
          icon={Storefront}
          color="text-green-600"
        />

        {/* Seção Multimarcas */}
        <MenuSection
          {...menuProps}
          title="Multimarcas"
          items={multimarcas}
          isOpen={openSection === 'multimarcas'}
          onToggle={() => handleSectionToggle('multimarcas')}
          icon={Buildings}
          color="text-purple-600"
        />

        {/* Seção Revenda */}
        <MenuSection
          {...menuProps}
          title="Revenda"
          items={revenda}
          isOpen={openSection === 'revenda'}
          onToggle={() => handleSectionToggle('revenda')}
          icon={TrendUp}
          color="text-blue-600"
        />

        {/* Seção Franquias */}
        <MenuSection
          {...menuProps}
          title="Franquias"
          items={franquias}
          isOpen={openSection === 'franquias'}
          onToggle={() => handleSectionToggle('franquias')}
          icon={Users}
          color="text-amber-600"
        />

        {/* Seção Recuperação de Crédito */}
        <MenuSection
          {...menuProps}
          title="Recuperação de Crédito"
          items={recuperacaoCredito}
          isOpen={openSection === 'recuperacaoCredito'}
          onToggle={() => handleSectionToggle('recuperacaoCredito')}
          icon={ChartBar}
          color="text-red-600"
        />

        {/* Seção Antecipações */}
        <MenuSection
          {...menuProps}
          title="Antecipações"
          items={confianca}
          isOpen={openSection === 'confianca'}
          onToggle={() => handleSectionToggle('confianca')}
          icon={Bank}
          color="text-amber-600"
        />

        {/* Minha Franquia (pasta) */}
        <MenuItem {...menuProps} item={minhaFranquiaItem} isActive={false} />

        {/* VIGIA - item independente */}
        <MenuItem
          {...menuProps}
          item={{
            name: 'Vigia',
            href: 'https://vigia.crosbytech.com.br/',
            icon: Eye,
            color: 'text-blue-600',
            external: true,
          }}
          isActive={false}
        />

        <MenuItem
          {...menuProps}
          item={{
            name: 'Playlist Loja',
            href: 'https://open.spotify.com/playlist/0luIH9EeXQsM1EVLEe10Co?si=PVAUen1xTNq_65EcEFuHSw&pi=rle4YjINSti0l&nd=1&dlsi=514142e8d84b44b8',
            icon: SpotifyLogo,
            color: 'text-blue-600',
            external: true,
          }}
          isActive={false}
        />

        {/* Seção Clientes */}
        <MenuSection
          {...menuProps}
          title="Clientes"
          items={clientesItems}
          isOpen={openSection === 'clientes'}
          onToggle={() => handleSectionToggle('clientes')}
          icon={IdentificationCard}
          color="text-blue-600"
        />

        {/* Widgets */}
        <MenuItem
          {...menuProps}
          item={{
            name: 'Meus Widgets',
            href: '/widgets',
            icon: SquaresFour,
            color: 'text-indigo-600',
          }}
          isActive={pathname === '/widgets'}
        />

        {/* Ranking Faturamento */}
        {hasAccessToPage('/ranking-faturamento') && (
          <div className="pt-4 border-t border-gray-100">
            <MenuItem
              {...menuProps}
              item={{
                name: 'Ranking Faturamento',
                href: '/ranking-faturamento',
                icon: Trophy,
                color: 'text-yellow-600',
              }}
              isActive={pathname === '/ranking-faturamento'}
            />
          </div>
        )}

        {/* Seção Administrativa */}
        <div className="pt-6 border-t border-gray-200">
          <MenuSection
            {...menuProps}
            title="Administração"
            items={adminItems}
            isOpen={openSection === 'admin'}
            onToggle={() => handleSectionToggle('admin')}
            icon={Shield}
            color="text-red-600"
          />
        </div>
      </nav>

      {/* Footer com info do usuário */}
      <div className="p-4 border-t border-gray-100 bg-gray-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
            <UserGear size={16} className="text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-gray-900 truncate font-barlow">
              {user.email}
            </p>
            <p className="text-xs text-gray-500 font-barlow">
              {getRoleLabel(user.role)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div className="fixed inset-0 z-50 lg:hidden animate-in fade-in duration-500">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-all duration-500 ease-in-out"
            onClick={onClose}
          />
          <div className="fixed inset-y-0 left-0 z-50 transform transition-all duration-500 ease-in-out animate-in slide-in-from-left">
            {sidebarContent}
          </div>
        </div>
      )}

      {/* Desktop sidebar - sempre visível em lg+ */}
      <div
        className={`hidden lg:block lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 transform transition-all duration-500 ease-in-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {sidebarContent}
      </div>
    </>
  );
};

export default Sidebar;
