import React, { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/cards';
import PageTitle from '../components/ui/PageTitle';
import { TotvsURL } from '../config/constants';
import {
  MagnifyingGlass,
  User,
  Buildings,
  MapPin,
  Phone,
  Envelope,
  IdentificationCard,
  Star,
  CaretDown,
  CaretUp,
  Spinner,
  Warning,
  CheckCircle,
  Funnel,
  CurrencyDollar,
  Receipt,
  ChartBar,
  Truck,
  Info,
} from '@phosphor-icons/react';

const ConsultaCliente = () => {
  const [personCode, setPersonCode] = useState('');
  const [fantasyName, setFantasyName] = useState('');
  const [phoneSearch, setPhoneSearch] = useState('');
  const [searchType, setSearchType] = useState('code'); // 'code', 'name' ou 'phone'
  const [personType, setPersonType] = useState('pj'); // 'pj' ou 'pf'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [cliente, setCliente] = useState(null);
  const [clientesList, setClientesList] = useState([]); // Lista para busca por nome
  const [dadosCarregados, setDadosCarregados] = useState(false);

  // Busca rápida por nome no Supabase (pes_pessoa)
  const [buscaNome, setBuscaNome] = useState('');
  const [buscaFantasia, setBuscaFantasia] = useState('');
  const [buscandoSupabase, setBuscandoSupabase] = useState(false);
  const [resultadosSupabase, setResultadosSupabase] = useState([]);
  const [modalSupabaseAberto, setModalSupabaseAberto] = useState(false);
  const [clienteSupabaseSelecionado, setClienteSupabaseSelecionado] =
    useState(null);
  const [expandedSections, setExpandedSections] = useState({
    info: true,
    addresses: true,
    phones: true,
    emails: true,
    contacts: false,
    classifications: false,
    statistics: false,
    preferences: false,
    observations: false,
  });

  // CSS customizado para consistência com ContasPagarFranquias
  useEffect(() => {
    const styleElement = document.createElement('style');
    styleElement.textContent = `
      .info-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
      }
      @media (min-width: 768px) {
        .info-grid {
          grid-template-columns: repeat(3, 1fr);
        }
      }
      @media (min-width: 1024px) {
        .info-grid {
          grid-template-columns: repeat(4, 1fr);
        }
      }
      .section-card {
        background: white;
        border-radius: 8px;
        border: 1px solid rgba(0, 6, 56, 0.1);
        overflow: hidden;
      }
      .section-header {
        background: #000638;
        color: white;
        padding: 10px 16px;
        font-weight: 600;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        transition: background-color 0.2s;
      }
      .section-header:hover {
        background: rgba(0, 6, 56, 0.9);
      }
      .section-content {
        padding: 16px;
      }
      .info-item {
        padding: 8px 12px;
        background: #f8f9fb;
        border-radius: 6px;
        border: 1px solid rgba(0, 6, 56, 0.05);
      }
      .info-label {
        font-size: 10px;
        font-weight: 600;
        color: #6b7280;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 2px;
      }
      .info-value {
        font-size: 13px;
        color: #000638;
        font-weight: 500;
      }
      .info-value.highlight {
        color: #2563eb;
        font-weight: 700;
      }
      .contact-card {
        background: #f8f9fb;
        border: 1px solid rgba(0, 6, 56, 0.1);
        border-radius: 8px;
        padding: 12px;
      }
    `;
    document.head.appendChild(styleElement);

    return () => {
      document.head.removeChild(styleElement);
    };
  }, []);

  // Buscar cliente pelo nome/fantasia na tabela pes_pessoa do Supabase
  const buscarClienteSupabase = async () => {
    const nome = buscaNome.trim();
    const fantasia = buscaFantasia.trim();
    if (!nome && !fantasia) return;
    setBuscandoSupabase(true);
    setResultadosSupabase([]);
    try {
      const params = new URLSearchParams();
      if (nome) params.append('nome', nome);
      if (fantasia) params.append('fantasia', fantasia);
      const resp = await fetch(
        `${TotvsURL}clientes/search-name?${params.toString()}`,
      );
      const json = await resp.json();
      if (json.success && json.data?.clientes?.length > 0) {
        setResultadosSupabase(json.data.clientes);
        setModalSupabaseAberto(true);
      } else {
        setError('Nenhum cliente encontrado com esse nome');
      }
    } catch (err) {
      setError(`Erro na busca: ${err.message}`);
    } finally {
      setBuscandoSupabase(false);
    }
  };

  const selecionarClienteSupabase = (cli) => {
    setClienteSupabaseSelecionado(cli);
    setPersonCode(String(cli.code));
    setSearchType('code');
    setPersonType(cli.tipo_pessoa === 'PF' ? 'pf' : 'pj');
    setModalSupabaseAberto(false);
  };

  const toggleSection = (section) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const handleSearch = async (e) => {
    e.preventDefault();

    if (searchType === 'code' && !personCode.trim()) {
      setError('Digite o código do cliente');
      return;
    }

    if (
      searchType === 'name' &&
      (!fantasyName.trim() || fantasyName.trim().length < 2)
    ) {
      setError('Digite pelo menos 2 caracteres do nome');
      return;
    }

    if (searchType === 'phone') {
      const cleanPhone = phoneSearch.replace(/\D/g, '');
      if (cleanPhone.length < 8) {
        setError('Digite pelo menos 8 dígitos do telefone');
        return;
      }
    }

    try {
      setLoading(true);
      setError('');
      setCliente(null);
      setClientesList([]);

      if (searchType === 'code') {
        // Busca por código - escolhe rota baseado no tipo de pessoa
        const endpoint =
          personType === 'pj'
            ? `${TotvsURL}legal-entity/search`
            : `${TotvsURL}individual/search`;

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            personCode: parseInt(personCode, 10),
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || 'Erro ao consultar cliente');
        }

        const data = await response.json();
        console.log('✅ Dados do cliente recebidos:', data);

        if (data.data?.items && data.data.items.length > 0) {
          setCliente(data.data.items[0]);
          setDadosCarregados(true);
        } else if (data.items && data.items.length > 0) {
          setCliente(data.items[0]);
          setDadosCarregados(true);
        } else {
          setError('Cliente não encontrado');
          setDadosCarregados(false);
        }
      } else if (searchType === 'phone') {
        // Busca por telefone
        const cleanPhone = phoneSearch.replace(/\D/g, '');
        const endpoint =
          personType === 'pj'
            ? `${TotvsURL}legal-entity/search-by-phone`
            : `${TotvsURL}individual/search-by-phone`;

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ phoneNumber: cleanPhone }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || 'Erro ao buscar por telefone');
        }

        const data = await response.json();
        console.log('✅ Clientes encontrados por telefone:', data);

        const items = data.data?.items || data.items || [];
        if (items.length === 1) {
          setCliente(items[0]);
          setDadosCarregados(true);
        } else if (items.length > 1) {
          setClientesList(items);
          setDadosCarregados(true);
        } else {
          setError('Nenhum cliente encontrado com esse telefone');
          setDadosCarregados(false);
        }
      } else {
        // Busca por nome - escolhe rota baseado no tipo de pessoa
        const endpoint =
          personType === 'pj'
            ? `${TotvsURL}legal-entity/search-by-name`
            : `${TotvsURL}individual/search-by-name`;

        const bodyParam =
          personType === 'pj'
            ? { fantasyName: fantasyName.trim() }
            : { name: fantasyName.trim() };

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(bodyParam),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || 'Erro ao buscar clientes');
        }

        const data = await response.json();
        console.log('✅ Clientes encontrados:', data);

        const items = data.data?.items || data.items || [];
        if (items.length > 0) {
          setClientesList(items);
          setDadosCarregados(true);
        } else {
          setError('Nenhum cliente encontrado com esse nome');
          setDadosCarregados(false);
        }
      }
    } catch (err) {
      console.error('❌ Erro ao consultar cliente:', err);
      setError(err.message || 'Erro ao consultar cliente');
      setDadosCarregados(false);
    } finally {
      setLoading(false);
    }
  };

  const selectCliente = (selectedCliente) => {
    setCliente(selectedCliente);
    setClientesList([]);
  };

  const formatCNPJ = (cnpj) => {
    if (!cnpj) return '-';
    const cleaned = cnpj.replace(/\D/g, '');
    if (cleaned.length !== 14) return cnpj;
    return cleaned.replace(
      /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
      '$1.$2.$3/$4-$5',
    );
  };

  const formatCPF = (cpf) => {
    if (!cpf) return '-';
    const cleaned = cpf.replace(/\D/g, '');
    if (cleaned.length !== 11) return cpf;
    return cleaned.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  };

  const formatDocument = (doc) => {
    if (!doc) return '-';
    const cleaned = doc.replace(/\D/g, '');
    if (cleaned.length === 11) return formatCPF(doc);
    if (cleaned.length === 14) return formatCNPJ(doc);
    return doc;
  };

  const formatPhone = (phone) => {
    if (!phone) return '-';
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 11) {
      return cleaned.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
    }
    if (cleaned.length === 10) {
      return cleaned.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
    }
    return phone;
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('pt-BR');
    } catch {
      return dateStr;
    }
  };

  const formatCurrency = (value) => {
    if (value === null || value === undefined) return '-';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const SectionHeader = ({
    title,
    icon: Icon,
    section,
    badge,
    defaultOpen = true,
  }) => (
    <div onClick={() => toggleSection(section)} className="section-header">
      <Icon size={16} weight="bold" />
      <span className="flex-1">{title}</span>
      {badge !== undefined && (
        <span className="px-2 py-0.5 text-xs bg-white/20 rounded-full">
          {badge}
        </span>
      )}
      {expandedSections[section] ? (
        <CaretUp size={14} />
      ) : (
        <CaretDown size={14} />
      )}
    </div>
  );

  const InfoItem = ({ label, value, highlight = false }) => (
    <div className="info-item">
      <div className="info-label">{label}</div>
      <div className={`info-value ${highlight ? 'highlight' : ''}`}>
        {value || '-'}
      </div>
    </div>
  );

  const StatusBadge = ({ isActive, label }) => (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${
        isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
      }`}
    >
      {isActive ? (
        <CheckCircle size={12} weight="fill" />
      ) : (
        <Warning size={12} weight="fill" />
      )}
      {label}
    </span>
  );

  return (
    <div className="w-full max-w-7xl mx-auto flex flex-col items-stretch justify-start py-3 px-2">
      <PageTitle
        title="Consulta de Cliente"
        subtitle="Consulte informações detalhadas de clientes do TOTVS"
        icon={User}
        iconColor="text-blue-600"
      />

      {/* Formulário de Filtros */}
      <div className="mb-4">
        <form
          onSubmit={handleSearch}
          className="flex flex-col bg-white p-3 rounded-lg shadow-md w-full max-w-7xl mx-auto border border-[#000638]/10"
        >
          <div className="mb-2">
            <span className="text-lg font-bold text-[#000638] flex items-center gap-1">
              <Funnel size={18} weight="bold" />
              Filtros
            </span>
            <span className="text-xs text-gray-500 mt-1">
              Busque por código ou nome
            </span>
          </div>

          {/* Busca rápida por nome no Supabase */}
          <div className="mb-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                  Nome da Pessoa
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={buscaNome}
                    onChange={(e) => setBuscaNome(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === 'Enter' &&
                      (e.preventDefault(), buscarClienteSupabase())
                    }
                    placeholder="Ex: João Silva"
                    className="border border-[#000638]/30 rounded-lg px-2 py-1.5 pr-8 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
                  />
                  <button
                    type="button"
                    onClick={buscarClienteSupabase}
                    disabled={buscandoSupabase}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#000638]/60 hover:text-[#fe0000] disabled:opacity-50 transition-colors"
                    title="Buscar cliente por nome"
                  >
                    {buscandoSupabase ? (
                      <Spinner size={14} className="animate-spin" />
                    ) : (
                      <MagnifyingGlass size={14} weight="bold" />
                    )}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                  Nome Fantasia
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={buscaFantasia}
                    onChange={(e) => setBuscaFantasia(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === 'Enter' &&
                      (e.preventDefault(), buscarClienteSupabase())
                    }
                    placeholder="Ex: Loja Centro"
                    className="border border-[#000638]/30 rounded-lg px-2 py-1.5 pr-8 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
                  />
                  <button
                    type="button"
                    onClick={buscarClienteSupabase}
                    disabled={buscandoSupabase}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#000638]/60 hover:text-[#fe0000] disabled:opacity-50 transition-colors"
                    title="Buscar cliente por nome fantasia"
                  >
                    {buscandoSupabase ? (
                      <Spinner size={14} className="animate-spin" />
                    ) : (
                      <MagnifyingGlass size={14} weight="bold" />
                    )}
                  </button>
                </div>
              </div>
            </div>
            {clienteSupabaseSelecionado && (
              <p className="text-xs text-green-700 mt-1 font-medium">
                Cliente selecionado: {clienteSupabaseSelecionado.code} —{' '}
                {clienteSupabaseSelecionado.nm_pessoa}
                {clienteSupabaseSelecionado.fantasy_name
                  ? ` (${clienteSupabaseSelecionado.fantasy_name})`
                  : ''}
              </p>
            )}
          </div>

          {/* Radio buttons para tipo de pessoa */}
          <div className="flex items-center gap-4 mb-3 p-2 bg-[#f8f9fb] rounded-lg">
            <span className="text-xs font-semibold text-[#000638]">Tipo:</span>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="personType"
                value="pj"
                checked={personType === 'pj'}
                onChange={(e) => {
                  setPersonType(e.target.value);
                  setClientesList([]);
                  setCliente(null);
                  setDadosCarregados(false);
                }}
                className="w-3.5 h-3.5 text-[#000638] focus:ring-[#000638]"
              />
              <span className="text-xs text-[#000638] font-medium">
                Pessoa Jurídica (CNPJ)
              </span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="personType"
                value="pf"
                checked={personType === 'pf'}
                onChange={(e) => {
                  setPersonType(e.target.value);
                  setClientesList([]);
                  setCliente(null);
                  setDadosCarregados(false);
                }}
                className="w-3.5 h-3.5 text-[#000638] focus:ring-[#000638]"
              />
              <span className="text-xs text-[#000638] font-medium">
                Pessoa Física (CPF)
              </span>
            </label>
          </div>

          {/* Toggle de tipo de busca */}
          <div className="flex gap-2 mb-3">
            <button
              type="button"
              onClick={() => {
                setSearchType('code');
                setClientesList([]);
                setCliente(null);
                setDadosCarregados(false);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                searchType === 'code'
                  ? 'bg-[#000638] text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Por Código
            </button>
            <button
              type="button"
              onClick={() => {
                setSearchType('name');
                setClientesList([]);
                setCliente(null);
                setDadosCarregados(false);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                searchType === 'name'
                  ? 'bg-[#000638] text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Por Nome {personType === 'pj' ? 'Fantasia' : ''}
            </button>
            <button
              type="button"
              onClick={() => {
                setSearchType('phone');
                setClientesList([]);
                setCliente(null);
                setDadosCarregados(false);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1 ${
                searchType === 'phone'
                  ? 'bg-[#000638] text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <Phone size={12} weight="bold" />
              Por Telefone
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-3">
            {searchType === 'code' ? (
              <div>
                <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                  Código do Cliente
                </label>
                <input
                  type="number"
                  value={personCode}
                  onChange={(e) => setPersonCode(e.target.value)}
                  placeholder="Ex: 12345"
                  className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
                />
              </div>
            ) : searchType === 'phone' ? (
              <div>
                <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                  Telefone
                </label>
                <input
                  type="text"
                  value={phoneSearch}
                  onChange={(e) => setPhoneSearch(e.target.value)}
                  placeholder="Ex: 85999991234"
                  className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
                />
                <span className="text-[10px] text-gray-400 mt-0.5 block">
                  Apenas números, mín. 8 dígitos
                </span>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                  {personType === 'pj' ? 'Nome Fantasia' : 'Nome'}
                </label>
                <input
                  type="text"
                  value={fantasyName}
                  onChange={(e) => setFantasyName(e.target.value)}
                  placeholder={
                    personType === 'pj' ? 'Ex: LOJA CENTRO' : 'Ex: JOÃO SILVA'
                  }
                  className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
                />
              </div>
            )}
            <div className="flex items-end">
              <button
                type="submit"
                className="flex items-center gap-1 bg-[#000638] text-white px-3 py-1 rounded-lg hover:bg-[#fe0000] disabled:opacity-50 disabled:cursor-not-allowed transition-colors h-7 text-xs font-bold shadow-md tracking-wide uppercase"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Spinner size={10} className="animate-spin" />
                    <span>Consultando...</span>
                  </>
                ) : (
                  <>
                    <MagnifyingGlass size={10} />
                    <span>Consultar</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="p-2 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700 text-xs">
              <Warning size={14} weight="fill" />
              {error}
            </div>
          )}
        </form>
      </div>

      {/* Modal de resultados Supabase (busca rápida por nome) */}
      {modalSupabaseAberto && resultadosSupabase.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl border border-[#000638]/15 w-[95vw] max-w-5xl max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#000638]/10 bg-[#f8f9fb]">
              <h3 className="text-sm font-bold text-[#000638] flex items-center gap-2">
                <MagnifyingGlass size={16} weight="bold" />
                Clientes Encontrados no Supabase
                <span className="ml-2 px-2 py-0.5 bg-[#000638] text-white text-xs rounded-full">
                  {resultadosSupabase.length}
                </span>
              </h3>
              <button
                type="button"
                onClick={() => setModalSupabaseAberto(false)}
                className="text-gray-400 hover:text-[#fe0000] text-lg font-bold px-2"
                title="Fechar"
              >
                ✕
              </button>
            </div>
            <div className="overflow-auto flex-1 p-2">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-[#000638] text-white">
                    <th className="px-2 py-1.5 text-left rounded-tl-lg">
                      Código
                    </th>
                    <th className="px-2 py-1.5 text-left">Tipo</th>
                    <th className="px-2 py-1.5 text-left">Nome</th>
                    <th className="px-2 py-1.5 text-left">Nome Fantasia</th>
                    <th className="px-2 py-1.5 text-left">CPF/CNPJ</th>
                    <th className="px-2 py-1.5 text-left">Telefone</th>
                    <th className="px-2 py-1.5 text-left">Email</th>
                    <th className="px-2 py-1.5 text-center rounded-tr-lg">
                      Ação
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {resultadosSupabase.map((cli, idx) => (
                    <tr
                      key={cli.code + '-' + idx}
                      className="border-b border-gray-100 hover:bg-blue-50/60 transition-colors"
                    >
                      <td className="px-2 py-1.5 font-mono font-bold text-[#000638]">
                        {cli.code}
                      </td>
                      <td className="px-2 py-1.5">{cli.tipo_pessoa || '—'}</td>
                      <td className="px-2 py-1.5 font-medium">
                        {cli.nm_pessoa || '—'}
                      </td>
                      <td className="px-2 py-1.5">{cli.fantasy_name || '—'}</td>
                      <td className="px-2 py-1.5 font-mono">
                        {cli.cpf || '—'}
                      </td>
                      <td className="px-2 py-1.5">{cli.telefone || '—'}</td>
                      <td className="px-2 py-1.5">{cli.email || '—'}</td>
                      <td className="px-2 py-1.5 text-center">
                        <button
                          type="button"
                          onClick={() => selecionarClienteSupabase(cli)}
                          className="bg-[#000638] hover:bg-[#fe0000] text-white text-xs px-3 py-1 rounded-lg font-semibold transition-colors"
                        >
                          Selecionar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Lista de Clientes Encontrados (busca por nome) */}
      {clientesList.length > 0 && !cliente && (
        <div className="mb-4 bg-white rounded-lg shadow-md border border-[#000638]/10 max-w-7xl mx-auto w-full">
          <div className="p-3 border-b border-[#000638]/10">
            <h2 className="text-sm font-bold text-[#000638] flex items-center gap-2">
              <Buildings size={16} weight="duotone" />
              Clientes Encontrados
              <span className="ml-2 px-2 py-0.5 bg-[#000638] text-white text-xs rounded-full">
                {clientesList.length}
              </span>
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              Clique em um cliente para ver os detalhes
            </p>
          </div>
          <div className="p-3 max-h-96 overflow-y-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {clientesList.map((item, idx) => (
                <div
                  key={idx}
                  onClick={() => selectCliente(item)}
                  className="p-3 bg-[#f8f9fb] border border-[#000638]/10 rounded-lg cursor-pointer hover:bg-[#000638]/5 hover:border-[#000638]/30 transition-all"
                >
                  <div className="flex items-start gap-2">
                    <div className="w-8 h-8 bg-[#000638]/10 rounded-full flex items-center justify-center flex-shrink-0">
                      <Buildings
                        size={16}
                        className="text-[#000638]"
                        weight="duotone"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-[#000638] truncate">
                        {item.fantasyName || item.name || 'Sem nome'}
                      </p>
                      {item.name &&
                        item.fantasyName &&
                        item.name !== item.fantasyName && (
                          <p className="text-xs text-gray-500 truncate">
                            {item.name}
                          </p>
                        )}
                      <p className="text-xs text-gray-600 mt-1">
                        Código:{' '}
                        <span className="font-semibold">{item.code}</span>
                      </p>
                      {(item.cnpj || item.cpf) && (
                        <p className="text-xs text-gray-500">
                          {item.cnpj
                            ? formatCNPJ(item.cnpj)
                            : formatCPF(item.cpf)}
                        </p>
                      )}
                      <div className="mt-1">
                        <span
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${
                            item.isInactive
                              ? 'bg-red-100 text-red-700'
                              : 'bg-green-100 text-green-700'
                          }`}
                        >
                          {item.isInactive ? 'Inativo' : 'Ativo'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Botão Voltar para Lista */}
      {cliente && clientesList.length === 0 && searchType === 'name' && (
        <div className="mb-2 max-w-7xl mx-auto w-full">
          <button
            type="button"
            onClick={() => {
              setCliente(null);
              handleSearch({ preventDefault: () => {} });
            }}
            className="text-xs text-[#000638] hover:text-[#fe0000] flex items-center gap-1"
          >
            <CaretDown size={12} className="rotate-90" />
            Voltar para lista de resultados
          </button>
        </div>
      )}

      {/* Container Principal de Resultados */}
      {(clientesList.length === 0 || cliente) && (
        <div className="bg-white rounded-lg shadow-md border border-[#000638]/10 max-w-7xl mx-auto w-full">
          <div className="p-3 border-b border-[#000638]/10 flex justify-between items-center">
            <h2 className="text-sm font-bold text-[#000638] font-barlow flex items-center gap-2">
              <Buildings size={16} weight="duotone" />
              Dados do Cliente
            </h2>
            <div className="text-xs text-gray-600">
              {dadosCarregados && cliente
                ? `${cliente.name || cliente.fantasyName || 'Cliente encontrado'}`
                : 'Nenhum cliente consultado'}
            </div>
          </div>

          <div className="p-3">
            {loading ? (
              <div className="flex justify-center items-center py-12">
                <div className="flex items-center gap-3">
                  <Spinner size={18} className="animate-spin text-blue-600" />
                  <span className="text-sm text-gray-600">
                    Consultando cliente...
                  </span>
                </div>
              </div>
            ) : !dadosCarregados ? (
              <div className="flex justify-center items-center py-12">
                <div className="text-center">
                  <User
                    size={48}
                    className="mx-auto mb-4 text-gray-300"
                    weight="duotone"
                  />
                  <div className="text-gray-500 text-sm mb-2">
                    Clique em "Consultar" para carregar as informações
                  </div>
                  <div className="text-gray-400 text-xs">
                    {searchType === 'code'
                      ? 'Digite o código do cliente no campo acima'
                      : 'Digite o nome fantasia no campo acima'}
                  </div>
                </div>
              </div>
            ) : !cliente ? (
              <div className="flex justify-center items-center py-12">
                <div className="text-center">
                  <Warning
                    size={48}
                    className="mx-auto mb-4 text-yellow-500"
                    weight="duotone"
                  />
                  <div className="text-gray-500 text-sm mb-2">
                    Cliente não encontrado
                  </div>
                  <div className="text-gray-400 text-xs">
                    Verifique o código digitado e tente novamente
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Header do Cliente */}
                <div className="p-4 bg-white rounded-lg border border-[#000638]/10">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 bg-[#000638]/10 rounded-full flex items-center justify-center">
                        <Buildings
                          size={28}
                          weight="duotone"
                          className="text-[#000638]"
                        />
                      </div>
                      <div>
                        <h2 className="text-lg font-bold text-[#000638]">
                          {cliente.name || cliente.fantasyName || 'Cliente'}
                        </h2>
                        {cliente.fantasyName &&
                          cliente.name !== cliente.fantasyName && (
                            <p className="text-sm text-gray-600">
                              {cliente.fantasyName}
                            </p>
                          )}
                        <p className="text-sm text-gray-600 flex items-center gap-1">
                          <IdentificationCard size={14} />
                          {cliente.cnpj
                            ? formatCNPJ(cliente.cnpj)
                            : formatCPF(cliente.cpf)}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge
                        isActive={!cliente.isInactive}
                        label={cliente.isInactive ? 'Inativo' : 'Ativo'}
                      />
                      {cliente.isCustomer && (
                        <StatusBadge isActive={true} label="Cliente" />
                      )}
                      {cliente.isSupplier && (
                        <StatusBadge isActive={true} label="Fornecedor" />
                      )}
                      {cliente.isRepresentative && (
                        <StatusBadge isActive={true} label="Representante" />
                      )}
                    </div>
                  </div>
                </div>

                {/* Informações Gerais */}
                <div className="section-card">
                  <SectionHeader
                    title="Informações Gerais"
                    icon={Info}
                    section="info"
                  />
                  {expandedSections.info && (
                    <div className="section-content">
                      <div className="info-grid">
                        <InfoItem
                          label="Código"
                          value={cliente.code}
                          highlight
                        />
                        <InfoItem
                          label={cliente.cnpj ? 'CNPJ' : 'CPF'}
                          value={
                            cliente.cnpj
                              ? formatCNPJ(cliente.cnpj)
                              : formatCPF(cliente.cpf)
                          }
                        />
                        <InfoItem label="UF" value={cliente.uf} />
                        <InfoItem
                          label="Inscrição Estadual"
                          value={cliente.numberStateRegistration}
                        />
                        <InfoItem
                          label="Data Cadastro"
                          value={formatDate(cliente.insertDate)}
                        />
                        <InfoItem
                          label="Faturamento Mensal"
                          value={formatCurrency(cliente.monthlyInvoicing)}
                        />
                        <InfoItem
                          label="Capital Social"
                          value={formatCurrency(cliente.shareCapital)}
                        />
                        <InfoItem
                          label="Status Cliente"
                          value={cliente.customerStatus}
                        />
                        {cliente.status && (
                          <InfoItem label="Situação" value={cliente.status} />
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Endereços */}
                {cliente.addresses && cliente.addresses.length > 0 && (
                  <div className="section-card">
                    <SectionHeader
                      title="Endereços"
                      icon={MapPin}
                      section="addresses"
                      badge={cliente.addresses.length}
                    />
                    {expandedSections.addresses && (
                      <div className="section-content">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {cliente.addresses.map((addr, idx) => (
                            <div key={idx} className="contact-card">
                              <div className="flex items-center gap-2 mb-2">
                                <MapPin
                                  size={16}
                                  className="text-[#000638]"
                                  weight="duotone"
                                />
                                <span className="px-2 py-0.5 text-xs bg-[#000638] text-white rounded font-semibold">
                                  {addr.addressType || 'Endereço'}
                                </span>
                              </div>
                              <p className="text-sm text-[#000638] font-medium">
                                {addr.publicPlace} {addr.address},{' '}
                                {addr.addressNumber}
                                {addr.complement && ` - ${addr.complement}`}
                              </p>
                              <p className="text-xs text-gray-600">
                                {addr.neighborhood} - {addr.cityName}/
                                {addr.stateAbbreviation}
                              </p>
                              <p className="text-xs text-gray-600">
                                CEP: {addr.cep}
                              </p>
                              {addr.reference && (
                                <p className="text-xs text-gray-400 mt-1">
                                  Ref: {addr.reference}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Telefones */}
                {cliente.phones && cliente.phones.length > 0 && (
                  <div className="section-card">
                    <SectionHeader
                      title="Telefones"
                      icon={Phone}
                      section="phones"
                      badge={cliente.phones.length}
                    />
                    {expandedSections.phones && (
                      <div className="section-content">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                          {cliente.phones.map((phone, idx) => (
                            <div
                              key={idx}
                              className="contact-card flex items-center gap-3"
                            >
                              <div className="w-10 h-10 bg-[#000638]/10 rounded-full flex items-center justify-center">
                                <Phone
                                  size={18}
                                  className="text-[#000638]"
                                  weight="duotone"
                                />
                              </div>
                              <div>
                                <p className="text-sm font-semibold text-[#000638]">
                                  {formatPhone(phone.number)}
                                </p>
                                <p className="text-xs text-gray-500">
                                  {phone.typeName || 'Telefone'}
                                  {phone.isDefault && (
                                    <span className="ml-2 text-green-600 font-semibold">
                                      ★ Principal
                                    </span>
                                  )}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* E-mails */}
                {cliente.emails && cliente.emails.length > 0 && (
                  <div className="section-card">
                    <SectionHeader
                      title="E-mails"
                      icon={Envelope}
                      section="emails"
                      badge={cliente.emails.length}
                    />
                    {expandedSections.emails && (
                      <div className="section-content">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {cliente.emails.map((email, idx) => (
                            <div
                              key={idx}
                              className="contact-card flex items-center gap-3"
                            >
                              <div className="w-10 h-10 bg-[#000638]/10 rounded-full flex items-center justify-center">
                                <Envelope
                                  size={18}
                                  className="text-[#000638]"
                                  weight="duotone"
                                />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-[#000638] truncate">
                                  {email.email}
                                </p>
                                <p className="text-xs text-gray-500">
                                  {email.typeName || 'E-mail'}
                                  {email.isDefault && (
                                    <span className="ml-2 text-green-600 font-semibold">
                                      ★ Principal
                                    </span>
                                  )}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Contatos */}
                {cliente.contacts && cliente.contacts.length > 0 && (
                  <div className="section-card">
                    <SectionHeader
                      title="Contatos"
                      icon={User}
                      section="contacts"
                      badge={cliente.contacts.length}
                    />
                    {expandedSections.contacts && (
                      <div className="section-content">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {cliente.contacts.map((contact, idx) => (
                            <div key={idx} className="contact-card">
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <div className="w-8 h-8 bg-[#000638] rounded-full flex items-center justify-center">
                                    <User
                                      size={14}
                                      className="text-white"
                                      weight="bold"
                                    />
                                  </div>
                                  <span className="font-semibold text-[#000638]">
                                    {contact.name}
                                  </span>
                                </div>
                                {contact.isDefault && (
                                  <span className="text-xs text-green-600 font-semibold">
                                    ★ Principal
                                  </span>
                                )}
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 pl-10">
                                {contact.function && (
                                  <p>
                                    <span className="font-semibold">
                                      Cargo:
                                    </span>{' '}
                                    {contact.function}
                                  </p>
                                )}
                                {contact.phoneNumber && (
                                  <p>
                                    <span className="font-semibold">Tel:</span>{' '}
                                    {formatPhone(contact.phoneNumber)}
                                  </p>
                                )}
                                {contact.cellNumber && (
                                  <p>
                                    <span className="font-semibold">Cel:</span>{' '}
                                    {formatPhone(contact.cellNumber)}
                                  </p>
                                )}
                                {contact.email && (
                                  <p className="col-span-2">
                                    <span className="font-semibold">
                                      E-mail:
                                    </span>{' '}
                                    {contact.email}
                                  </p>
                                )}
                                {contact.birthDate && (
                                  <p>
                                    <span className="font-semibold">
                                      Aniversário:
                                    </span>{' '}
                                    {formatDate(contact.birthDate)}
                                  </p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Classificações */}
                {cliente.classifications &&
                  cliente.classifications.length > 0 && (
                    <div className="section-card">
                      <SectionHeader
                        title="Classificações"
                        icon={Star}
                        section="classifications"
                        badge={cliente.classifications.length}
                      />
                      {expandedSections.classifications && (
                        <div className="section-content">
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                            {cliente.classifications.map((classif, idx) => (
                              <div key={idx} className="contact-card">
                                <p className="text-sm font-semibold text-[#000638]">
                                  {classif.name}
                                </p>
                                <p className="text-xs text-gray-500">
                                  {classif.typeName} (Cód: {classif.code})
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                {/* Estatísticas */}
                {cliente.statistics && cliente.statistics.length > 0 && (
                  <div className="section-card">
                    <SectionHeader
                      title="Estatísticas"
                      icon={ChartBar}
                      section="statistics"
                      badge={cliente.statistics.length}
                    />
                    {expandedSections.statistics && (
                      <div className="section-content space-y-4">
                        {cliente.statistics.map((stat, idx) => (
                          <div
                            key={idx}
                            className="p-4 bg-[#f8f9fb] rounded-lg border border-[#000638]/10"
                          >
                            <div className="text-sm font-bold text-[#000638] mb-3 flex items-center gap-2">
                              <Buildings size={14} weight="duotone" />
                              Filial: {stat.branchCode}
                            </div>
                            <div className="info-grid">
                              <InfoItem
                                label="Atraso Médio (dias)"
                                value={stat.averageDelay}
                              />
                              <InfoItem
                                label="Atraso Máximo (dias)"
                                value={stat.maximumDelay}
                              />
                              <InfoItem
                                label="Cheques Devolvidos"
                                value={stat.returnedCheck}
                              />
                              <InfoItem
                                label="Parcelas Pagas"
                                value={stat.installmentPaid}
                              />
                              <InfoItem
                                label="Qtd. Compras"
                                value={stat.purchaseQuantity}
                              />
                              <InfoItem
                                label="Maior Débito"
                                value={formatCurrency(stat.higherDebt)}
                              />
                              <InfoItem
                                label="Limite"
                                value={formatCurrency(stat.limitValue)}
                                highlight
                              />
                              <InfoItem
                                label="Maior Compra"
                                value={formatCurrency(stat.biggestPurchase)}
                              />
                              <InfoItem
                                label="Primeira Compra"
                                value={formatDate(stat.firstPurchaseDate)}
                              />
                              <InfoItem
                                label="Última Compra"
                                value={formatDate(stat.lastPurchaseDate)}
                              />
                              <InfoItem
                                label="Total Compras"
                                value={formatCurrency(stat.totalPurchase)}
                                highlight
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Preferências */}
                {cliente.preferences && (
                  <div className="section-card">
                    <SectionHeader
                      title="Preferências"
                      icon={Truck}
                      section="preferences"
                    />
                    {expandedSections.preferences && (
                      <div className="section-content">
                        <div className="info-grid">
                          <InfoItem
                            label="Condição de Pagamento"
                            value={
                              cliente.preferences.paymentConditionDescription ||
                              cliente.preferences.paymentConditionCode
                            }
                          />
                          <InfoItem
                            label="Transportadora"
                            value={
                              cliente.preferences.shippingCompanyName ||
                              cliente.preferences.shippingCompanyCode
                            }
                          />
                          <InfoItem
                            label="Tipo de Frete"
                            value={
                              cliente.preferences.freightType !== 'NotInformed'
                                ? cliente.preferences.freightType
                                : '-'
                            }
                          />
                          <InfoItem
                            label="Prazo Médio Máximo"
                            value={cliente.preferences.maximumAverageTerm}
                          />
                          <InfoItem
                            label="Tabela de Preço"
                            value={
                              cliente.preferences.priceTableDescription ||
                              cliente.preferences.priceTableCode
                            }
                          />
                          <InfoItem
                            label="Prioridade do Pedido"
                            value={cliente.preferences.orderPriority}
                          />
                          <InfoItem
                            label="Portador"
                            value={
                              cliente.preferences.bearerName ||
                              cliente.preferences.bearerCode
                            }
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Observações */}
                {((cliente.observations && cliente.observations.length > 0) ||
                  (cliente.customerObservations &&
                    cliente.customerObservations.length > 0)) && (
                  <div className="section-card">
                    <SectionHeader
                      title="Observações"
                      icon={IdentificationCard}
                      section="observations"
                      badge={
                        (cliente.observations?.length || 0) +
                        (cliente.customerObservations?.length || 0)
                      }
                    />
                    {expandedSections.observations && (
                      <div className="section-content space-y-2">
                        {cliente.observations?.map((obs, idx) => (
                          <div
                            key={`obs-${idx}`}
                            className="p-3 bg-yellow-50 rounded-lg border border-yellow-200"
                          >
                            <p className="text-sm text-[#000638]">
                              {obs.observation}
                            </p>
                          </div>
                        ))}
                        {cliente.customerObservations?.map((obs, idx) => (
                          <div
                            key={`cobs-${idx}`}
                            className="p-3 bg-blue-50 rounded-lg border border-blue-200"
                          >
                            <p className="text-sm text-[#000638]">
                              {obs.observation}
                            </p>
                            {obs.LastChangeDate && (
                              <p className="text-xs text-gray-500 mt-1">
                                Última alteração:{' '}
                                {formatDate(obs.LastChangeDate)}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ConsultaCliente;
