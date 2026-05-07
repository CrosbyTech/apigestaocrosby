import React, { useState, useEffect, useRef } from 'react';
import PageTitle from '../components/ui/PageTitle';
import { supabase } from '../lib/supabase';
import { useAuth } from '../components/AuthContext';
import {
  Robot,
  ChatText,
  Image,
  VideoCamera,
  FileXls,
  Table,
  Eye,
  X,
  PaperPlaneTilt,
  Info,
  ListBullets,
  CloudArrowUp,
  Plus,
  BracketsCurly,
  Lightning,
  TextB,
  TextItalic,
  TextStrikethrough,
  Code,
  ChartBar,
  Calendar,
  CurrencyDollar,
  Checks,
  EnvelopeOpen,
  Link,
  Phone,
  Trash,
  HandTap,
  DownloadSimple,
  Database,
  Buildings,
  Users,
  CaretDown,
  CaretUp,
  MagnifyingGlass,
  Funnel,
  CheckCircle,
} from '@phosphor-icons/react';

import WhatsAppReports from '../components/whatsapp-official/WhatsAppReports';

// --- IMPORT DO NOVO GRÁFICO ---
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

const CrosbyTemplateManager = () => {
  const { user } = useAuth();

  // ==========================================
  // CONFIGURAÇÕES 
  // ==========================================
  const API_BASE = import.meta.env.VITE_API_URL || '';

  const COTACAO_DOLAR = 5.8;

  // ==========================================
  // ESTADOS GERAIS
  // ==========================================
  const [activeTab, setActiveTab] = useState('create');
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState('');

  // ==========================================
  // ESTADOS: ABA DE CRIAÇÃO DE TEMPLATES
  // ==========================================
  const [templateName, setTemplateName] = useState('');
  const [category, setCategory] = useState('MARKETING'); // ESTADO DA CATEGORIA AQUI
  const [language, setLanguage] = useState('pt_BR');
  const [headerType, setHeaderType] = useState('NONE');
  const [headerFile, setHeaderFile] = useState(null);
  const [headerPreviewUrl, setHeaderPreviewUrl] = useState(null);
  const [bodyText, setBodyText] = useState('');
  const [variableExamples, setVariableExamples] = useState({});
  const [buttons, setButtons] = useState([]);
  const [isCreating, setIsCreating] = useState(false);
  const [creationFeedback, setCreationFeedback] = useState(null);

  // ==========================================
  // ESTADOS: ABA DE DISPARO
  // ==========================================
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendMethod, setSendMethod] = useState('CSV');
  const [csvFile, setCsvFile] = useState(null);

  // ==========================================
  // ESTADOS: INTEGRAÇÃO TOTVS
  // ==========================================
  const [totvsOperationsList, setTotvsOperationsList] = useState([]);
  const [totvsOperationId, setTotvsOperationId] = useState('');
  const [totvsStartDate, setTotvsStartDate] = useState('');
  const [totvsEndDate, setTotvsEndDate] = useState('');
  const [totvsCompanies, setTotvsCompanies] = useState([]);
  const [totvsContacts, setTotvsContacts] = useState(null);
  const [ticketMedio, setTicketMedio] = useState(0);
  const [isFetchingTotvs, setIsFetchingTotvs] = useState(false);

  // ESTADO DO MODAL DE CONTATOS
  const [showContactsModal, setShowContactsModal] = useState(false);

  // Estados da Lista de Empresas
  const [companiesList, setCompaniesList] = useState([]);
  const [isCompanyDropdownOpen, setIsCompanyDropdownOpen] = useState(false);
  const [companySearchTerm, setCompanySearchTerm] = useState('');
  const dropdownRef = useRef(null);

  // ==========================================
  // ESTADOS: ABA DE RESULTADOS
  // ==========================================
  const [selectedResultTemplate, setSelectedResultTemplate] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [analyticsData, setAnalyticsData] = useState(null);
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(false);

  // ==========================================
  // EFEITOS (USE_EFFECT)
  // ==========================================
  useEffect(() => {
    const fetchData = async () => {
      const { data: accountsData } = await supabase
        .from('whatsapp_accounts')
        .select('*');
      if (accountsData && accountsData.length > 0) {
        setAccounts(accountsData);
        setSelectedAccount(accountsData[0].waba_id);
      }

      const { data: operacoesData, error: opError } = await supabase
        .from('totvs_operacoes')
        .select('*')
        .order('nome');
      if (operacoesData && operacoesData.length > 0) {
        setTotvsOperationsList(operacoesData);
        setTotvsOperationId(operacoesData[0].id);
      } else if (opError) {
        console.error('Erro ao buscar operações no Supabase:', opError);
      }
    };
    fetchData();
  }, []);

  useEffect(() => {
    if (headerFile) {
      const url = URL.createObjectURL(headerFile);
      setHeaderPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setHeaderPreviewUrl(null);
    }
  }, [headerFile]);

  useEffect(() => {
    if ((activeTab === 'send' || activeTab === 'results') && selectedAccount && accounts.length > 0) {
      fetchTemplates();
    }
  }, [selectedAccount, activeTab, accounts]);

  const fetchTemplates = async () => {
    setIsLoadingTemplates(true);
    try {
      // Buscar account id interno pelo waba_id
      const account = accounts.find((a) => a.waba_id === selectedAccount);
      if (!account) { setTemplates([]); return; }

      const response = await fetch(`${API_BASE}/api/meta/templates/${account.id}`);
      const result = await response.json();
      const list = result.data || result;
      if (Array.isArray(list)) setTemplates(list);
      else setTemplates([]);
    } catch (error) {
      console.error('Erro ao listar templates', error);
      setTemplates([]);
    } finally {
      setIsLoadingTemplates(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'send' && sendMethod === 'TOTVS') {
      fetchCompaniesList();
    }
  }, [activeTab, sendMethod]);

  const fetchCompaniesList = async () => {
    if (companiesList.length > 0) return;
    try {
      const response = await fetch(`${API_BASE}/api/meta/totvs-branches`);
      const result = await response.json();
      const list = result.data || result;

      if (Array.isArray(list)) {
        setCompaniesList(list);
      } else {
        throw new Error('Formato inesperado');
      }
    } catch (error) {
      console.error('Erro ao buscar empresas:', error);
      alert('Falha ao buscar as empresas.');
    }
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsCompanyDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ==========================================
  // FUNÇÕES DE UTILITÁRIOS
  // ==========================================
  const applyQuickDateFilter = (type) => {
    const today = new Date();
    let start = new Date();
    let end = new Date();

    if (type === 'ativos') {
      start.setDate(today.getDate() - 60);
    } else if (type === 'inativos') {
      start.setDate(today.getDate() - 365);
      end.setDate(today.getDate() - 61);
    } else if (type === '6meses') {
      start.setMonth(today.getMonth() - 6);
    } else if (type === '1ano') {
      start.setFullYear(today.getFullYear() - 1);
    }

    setTotvsStartDate(start.toISOString().split('T')[0]);
    setTotvsEndDate(end.toISOString().split('T')[0]);
  };

  const renderFormattedText = (rawText) => {
    if (!rawText) return { __html: '' };
    let processed = rawText
      .replace(/{{[0-9]+}}/g, (m) =>
        variableExamples[m] ? `[${variableExamples[m]}]` : m,
      )
      .replace(/\*(.*?)\*/g, '<strong>$1</strong>')
      .replace(/_(.*?)_/g, '<em>$1</em>')
      .replace(/~(.*?)~/g, '<del>$1</del>')
      .replace(
        /```(.*?)```/g,
        '<code class="bg-gray-100 px-1 rounded font-mono">$1</code>',
      );
    return { __html: processed.replace(/\n/g, '<br/>') };
  };

  const applyFormatting = (tag) => {
    const input = document.getElementById('bodyTextArea');
    if (!input) return;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const selectedText = bodyText.substring(start, end);
    let sym =
      tag === 'BOLD'
        ? '*'
        : tag === 'ITALIC'
          ? '_'
          : tag === 'STRIKE'
            ? '~'
            : '```';
    const newText =
      bodyText.substring(0, start) +
      sym +
      selectedText +
      sym +
      bodyText.substring(end);
    setBodyText(newText);
    setTimeout(() => {
      input.focus();
      input.setSelectionRange(start + sym.length, end + sym.length);
    }, 0);
  };

  const handleAddVariable = () => {
    const matches = bodyText.match(/{{[0-9]+}}/g) || [];
    const variableString = `{{${matches.length + 1}}}`;
    const input = document.getElementById('bodyTextArea');
    if (input) {
      const start = input.selectionStart;
      setBodyText(
        bodyText.substring(0, start) +
          variableString +
          bodyText.substring(start),
      );
    } else {
      setBodyText((prev) => prev + variableString);
    }
  };

  const handleAddButton = (type) => {
    if (!type) return;
    if (buttons.length >= 10) return alert('O limite máximo é de 10 botões.');
    const newBtn = { type, text: '' };
    if (type === 'URL') newBtn.url = '';
    if (type === 'PHONE_NUMBER') newBtn.phone_number = '';
    setButtons([...buttons, newBtn]);
  };

  const handleUpdateButton = (index, field, value) => {
    const updated = [...buttons];
    updated[index][field] = value;
    setButtons(updated);
  };

  const handleRemoveButton = (index) => {
    const updated = [...buttons];
    updated.splice(index, 1);
    setButtons(updated);
  };

  // ==========================================
  // FUNÇÕES DE AÇÃO PRINCIPAIS
  // ==========================================

  // AÇÃO: CRIAR TEMPLATE NA META
  const handleCreateTemplate = async () => {
    if (!selectedAccount || !templateName || !bodyText)
      return alert('Preencha os campos obrigatórios (Nome e Texto).');

    for (const btn of buttons) {
      if (!btn.text) return alert('Todos os botões precisam de um texto.');
      if (btn.type === 'URL' && !btn.url)
        return alert('Preencha o link do botão Site.');
      if (btn.type === 'PHONE_NUMBER' && !btn.phone_number)
        return alert('Preencha o número do botão de Ligação.');
    }

    setIsCreating(true);
    setCreationFeedback(null);

    try {
      const vars = bodyText.match(/{{[0-9]+}}/g) || [];
      const componentsArray = [
        {
          type: 'BODY',
          text: bodyText,
          example:
            vars.length > 0
              ? {
                  body_text: [
                    vars.map((v) => variableExamples[v] || 'Exemplo'),
                  ],
                }
              : undefined,
        },
      ];

      if (buttons.length > 0) {
        componentsArray.push({
          type: 'BUTTONS',
          buttons: buttons.map((b) => {
            if (b.type === 'QUICK_REPLY')
              return { type: 'QUICK_REPLY', text: b.text };
            if (b.type === 'URL')
              return { type: 'URL', text: b.text, url: b.url };
            if (b.type === 'PHONE_NUMBER')
              return {
                type: 'PHONE_NUMBER',
                text: b.text,
                phone_number: b.phone_number,
              };
            return b;
          }),
        });
      }

      // Payload dinâmico enviando a categoria selecionada e allow_category_change
      const account = accounts.find((a) => a.waba_id === selectedAccount);
      if (!account) return alert('Conta não encontrada.');

      const payload = {
        name: templateName,
        category: category,
        language,
        components: componentsArray,
        allow_category_change: true,
      };

      const response = await fetch(`${API_BASE}/api/meta/templates/${account.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      setCreationFeedback({
        type: 'success',
        message: 'Template criado com sucesso!',
        status: result.meta_status || 'PENDING',
      });

      setTemplateName('');
      setBodyText('');
      setButtons([]);

      setTimeout(() => {
        setCreationFeedback(null);
        setActiveTab('send');
      }, 4000);
    } catch (e) {
      setCreationFeedback({
        type: 'error',
        message: 'Falha ao criar o template. Verifique o console.',
      });
    } finally {
      setIsCreating(false);
    }
  };

  // AÇÃO: MANIPULAÇÃO DE CSV
  const handleCsvUpload = (e) => {
    const file = e.target.files[0];
    if (file) setCsvFile(file);
  };

  const handleDownloadCsvTemplate = () => {
    let headers = ['telefone'];
    let sampleRow = ['5511999999999'];

    if (selectedTemplate) {
      const comps =
        selectedTemplate.components || selectedTemplate.json?.components || [];
      const bodyComp = comps.find((c) => c.type === 'BODY');
      if (bodyComp && bodyComp.text) {
        const matches = bodyComp.text.match(/{{[0-9]+}}/g);
        if (matches) {
          const uniqueVars = [...new Set(matches)];
          uniqueVars.forEach((_, i) => {
            headers.push(`variavel_${i + 1}`);
            sampleRow.push(`exemplo_${i + 1}`);
          });
        }
      }
    } else {
      headers.push('variavel_1', 'variavel_2');
      sampleRow.push('exemplo_1', 'exemplo_2');
    }

    const csvContent = `${headers.join(',')}\n${sampleRow.join(',')}`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute(
      'download',
      selectedTemplate
        ? `modelo_${selectedTemplate.name || selectedTemplate.json?.name}.csv`
        : 'modelo_crosby.csv',
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // AÇÕES: FILTROS DE EMPRESAS (TOTVS)
  const filteredCompanies = companiesList.filter((c) =>
    `${c.id} - ${c.nome}`
      .toLowerCase()
      .includes(companySearchTerm.toLowerCase()),
  );

  const handleToggleCompany = (companyId) => {
    setTotvsCompanies((prev) =>
      prev.includes(companyId)
        ? prev.filter((id) => id !== companyId)
        : [...prev, companyId],
    );
  };

  const handleSelectAllCompanies = () =>
    setTotvsCompanies(filteredCompanies.map((c) => c.id));
  const handleSelectFiliais = () =>
    setTotvsCompanies(
      filteredCompanies
        .filter((c) => parseInt(c.id, 10) <= 5999)
        .map((c) => c.id),
    );
  const handleSelectFranquias = () =>
    setTotvsCompanies(
      filteredCompanies
        .filter((c) => parseInt(c.id, 10) >= 6000)
        .map((c) => c.id),
    );
  const handleClearCompanies = () => setTotvsCompanies([]);

  // ==========================================
  // AÇÃO: BUSCAR CONTATOS DO TOTVS
  // ==========================================
  const handleFetchTotvs = async () => {
    const operacaoSelecionada = totvsOperationsList.find(
      (op) => op.id === totvsOperationId,
    );

    const isRevenda = operacaoSelecionada?.nome
      ?.toLowerCase()
      .includes('revenda');

    let empresasParaEnviar = totvsCompanies;

    if (isRevenda) {
      empresasParaEnviar = companiesList
        .filter((c) => parseInt(c.id, 10) <= 5999)
        .map((c) => parseInt(c.id, 10));
    } else {
      if (totvsCompanies.length === 0) {
        return alert('Selecione pelo menos uma empresa.');
      }
    }

    if (!totvsStartDate || !totvsEndDate) return alert('Selecione o período.');

    setIsFetchingTotvs(true);
    setTotvsContacts(null);
    setTicketMedio(0);

    try {
      const response = await fetch(`${API_BASE}/api/meta/totvs-contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operacao: operacaoSelecionada,
          data_inicio: totvsStartDate,
          data_fim: totvsEndDate,
          empresas: empresasParaEnviar,
        }),
      });

      const result = await response.json();

      const list = result.data?.data || result.data || [];
      const valorDoTicket = result.data?.ticketMedio || result.ticketMedio || 0;

      if (list.length > 0) {
        setTotvsContacts(list);
        setTicketMedio(valorDoTicket);
        alert(`${list.length} contatos carregados com sucesso!`);
      } else {
        alert('Nenhum contato retornado pelo TOTVS para estes filtros.');
      }
    } catch (e) {
      alert('Erro ao buscar contatos no TOTVS.');
    } finally {
      setIsFetchingTotvs(false);
    }
  };

  // AÇÃO: INICIAR DISPARO DE CAMPANHA
  const handleSendCampaign = async () => {
    if (!selectedTemplate) return alert('Selecione um modelo de mensagem.');

    if (sendMethod === 'CRM26') {
      return alert('A integração com o CRM 26 ainda não foi configurada.');
    }

    setIsSending(true);

    const sendCampaign = async (rows) => {
      const payload = {
        waba_id: selectedAccount,
        template_name: selectedTemplate.name || selectedTemplate.json?.name,
        language: selectedTemplate.language || selectedTemplate.json?.language,
        contacts_csv: rows,
        origem: sendMethod,
      };

      try {
        const response = await fetch(`${API_BASE}/api/meta/campaign-dispatch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err.message || 'Erro ao disparar campanha');
        }

        alert('Disparo iniciado com sucesso!');
        setCsvFile(null);
        setTotvsContacts(null);
        setTicketMedio(0);
      } catch (e) {
        alert('Erro ao iniciar disparo: ' + e.message);
      } finally {
        setIsSending(false);
      }
    };

    if (sendMethod === 'CSV') {
      if (!csvFile) {
        setIsSending(false);
        return alert('Selecione o arquivo da planilha (.csv ou .xls).');
      }
      const reader = new FileReader();
      reader.onload = async (e) => {
        const rows = e.target.result.split('\n').filter((l) => l.trim());
        await sendCampaign(rows);
      };
      reader.readAsText(csvFile);
    } else {
      if (!totvsContacts || totvsContacts.length === 0) {
        setIsSending(false);
        return alert('Você precisa buscar os contatos no TOTVS primeiro.');
      }
      await sendCampaign(totvsContacts);
    }
  };

  // AÇÃO: BUSCAR RESULTADOS (ANALYTICS)
  const handleFetchAnalytics = async () => {
    if (!selectedAccount || !selectedResultTemplate || !startDate || !endDate) {
      return alert(
        '⚠️ Atenção: Você precisa selecionar a Conta, o Modelo, a Data Inicial e a Data Final!',
      );
    }

    const startDt = new Date(startDate + 'T00:00:00');
    const endDt = new Date(endDate + 'T23:59:59');

    if (startDt.getTime() > endDt.getTime()) {
      return alert(
        '⚠️ Erro: A Data Inicial não pode ser maior que a Data Final!',
      );
    }

    let startTs = Math.floor(startDt.getTime() / 1000);
    let endTs = Math.floor(endDt.getTime() / 1000);

    const nowTs = Math.floor(Date.now() / 1000);
    if (endTs > nowTs) {
      endTs = nowTs;
    }

    setIsLoadingAnalytics(true);
    setAnalyticsData(null);

    const payload = {
      waba_id: selectedAccount,
      template_name: selectedResultTemplate,
      start: startTs,
      end: endTs,
    };

    try {
      const response = await fetch(`${API_BASE}/api/meta/template-results`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      setAnalyticsData(result);
    } catch (error) {
      console.error('Erro no fetch de resultados:', error);
      alert('Erro ao buscar os resultados da Meta.');
    } finally {
      setIsLoadingAnalytics(false);
    }
  };

  const getFilterUI = () => {
    const selectedOp = totvsOperationsList.find(
      (op) => op.id === totvsOperationId,
    );
    const opName = selectedOp?.nome?.toLowerCase() || '';

    if (opName.includes('revenda')) {
      return {
        labelStart: 'Última Compra (Início)',
        labelEnd: 'Última Compra (Fim)',
        isRevenda: true,
        quickFilters: (
          <div className="flex gap-2">
            <button
              onClick={() => applyQuickDateFilter('ativos')}
              className="px-3 py-1.5 bg-green-50 text-green-700 border border-green-200 rounded text-[10px] font-bold hover:bg-green-100 transition-all flex items-center gap-1"
            >
              <Funnel size={12} /> Ativos (60d)
            </button>
            <button
              onClick={() => applyQuickDateFilter('inativos')}
              className="px-3 py-1.5 bg-red-50 text-red-700 border border-red-200 rounded text-[10px] font-bold hover:bg-red-100 transition-all flex items-center gap-1"
            >
              <Funnel size={12} /> Inativos (1 ano)
            </button>
          </div>
        ),
      };
    }

    if (opName.includes('varejo')) {
      return {
        labelStart: 'Data de Cadastro (Início)',
        labelEnd: 'Data de Cadastro (Fim)',
        isRevenda: false,
        quickFilters: (
          <div className="flex gap-2">
            <button
              onClick={() => applyQuickDateFilter('6meses')}
              className="px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded text-[10px] font-bold hover:bg-blue-100 transition-all flex items-center gap-1"
            >
              <Funnel size={12} /> Últimos 6 meses
            </button>
            <button
              onClick={() => applyQuickDateFilter('1ano')}
              className="px-3 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded text-[10px] font-bold hover:bg-indigo-100 transition-all flex items-center gap-1"
            >
              <Funnel size={12} /> Último 1 ano
            </button>
          </div>
        ),
      };
    }

    return {
      labelStart: 'Período (Início)',
      labelEnd: 'Período (Fim)',
      isRevenda: false,
      quickFilters: null,
    };
  };

  const dynamicUI = getFilterUI();

  return (
    <div className="w-full min-h-screen bg-gray-50 p-6 relative">
      <div className="max-w-6xl mx-auto">
        <PageTitle
          title="Crosby Manager"
          subtitle="Central de Mensagens Oficiais"
          icon={Robot}
          iconColor="text-indigo-600"
        />

        {/* ================= TOPO DE NAVEGAÇÃO ================= */}
        <div className="bg-white p-4 rounded-xl shadow-sm mt-6 mb-6 flex flex-col md:flex-row items-center justify-between gap-4 border border-gray-100">
          <div className="flex items-center gap-4">
            <label className="text-xs font-bold text-gray-400 uppercase">
              Conta WhatsApp:
            </label>
            <select
              value={selectedAccount}
              onChange={(e) => setSelectedAccount(e.target.value)}
              className="p-2 border border-indigo-100 bg-indigo-50 rounded-lg text-sm text-indigo-700 font-bold min-w-[200px] outline-none"
            >
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.waba_id}>
                  {acc.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex bg-gray-100 p-1 rounded-xl">
            <button
              onClick={() => setActiveTab('send')}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'send' ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Disparar
            </button>
            <button
              onClick={() => setActiveTab('create')}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'create' ? 'bg-white shadow-sm text-green-600' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Criar Template
            </button>
            <button
              onClick={() => setActiveTab('results')}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'results' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Resultados
            </button>
            <button
              onClick={() => setActiveTab('relatorios')}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'relatorios' ? 'bg-white shadow-sm text-purple-600' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Relatórios
            </button>
          </div>
        </div>

        {/* ================= ABA: CRIAR TEMPLATE ================= */}
        {activeTab === 'create' && (
          <div className="grid grid-cols-12 gap-6 animate-in fade-in duration-300">
            {/* CONFIGURAÇÕES E BOTÕES (Esquerda) */}
            <div className="col-span-12 lg:col-span-4 flex flex-col gap-6">
              <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
                <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2 text-sm">
                  <Info size={18} className="text-green-600" /> Dados do Modelo
                </h3>
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-bold text-gray-400 uppercase">
                      Nome (ID)
                    </label>
                    <input
                      type="text"
                      value={templateName}
                      onChange={(e) =>
                        setTemplateName(
                          e.target.value
                            .toLowerCase()
                            .replace(/[^a-z0-9_]/g, '_'),
                        )
                      }
                      className="w-full mt-1 p-2 border border-gray-200 rounded-lg text-sm outline-none"
                    />
                  </div>

                  {/* NOVO CAMPO: CATEGORIA META ADICIONADO AQUI */}
                  <div>
                    <label className="text-[10px] font-bold text-gray-400 uppercase">
                      Categoria Meta
                    </label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="w-full mt-1 p-2 border border-gray-200 rounded-lg text-sm bg-white outline-none cursor-pointer"
                    >
                      <option value="MARKETING">
                        Marketing (Promoções e Vendas)
                      </option>
                      <option value="UTILITY">
                        Utilidade (Avisos e Cobranças)
                      </option>
                      <option value="AUTHENTICATION">
                        Autenticação (Senhas)
                      </option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-gray-400 uppercase">
                      Cabeçalho (Mídia)
                    </label>
                    <div className="flex gap-1 mt-1 mb-2">
                      {['NONE', 'IMAGE', 'VIDEO', 'DOCUMENT'].map((t) => (
                        <button
                          key={t}
                          onClick={() => setHeaderType(t)}
                          className={`px-2 py-1 text-[9px] font-bold rounded border ${headerType === t ? 'bg-green-100 border-green-500 text-green-700' : 'bg-gray-50'}`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                    {headerType !== 'NONE' && (
                      <input
                        type="file"
                        onChange={(e) => setHeaderFile(e.target.files[0])}
                        className="text-xs text-gray-500 w-full"
                      />
                    )}
                  </div>
                </div>
              </div>

              <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-gray-800 flex items-center gap-2 text-sm">
                    <HandTap size={18} className="text-green-600" /> Botões
                  </h3>
                  <select
                    onChange={(e) => {
                      handleAddButton(e.target.value);
                      e.target.value = '';
                    }}
                    className="p-1 border border-gray-200 rounded text-xs font-bold text-gray-600 outline-none bg-gray-50 cursor-pointer"
                  >
                    <option value="">+ Adicionar botão</option>
                    <option value="QUICK_REPLY">Personalizado</option>
                    <option value="URL">Acessar o site</option>
                    <option value="PHONE_NUMBER">Ligar no WhatsApp</option>
                  </select>
                </div>
                <div className="space-y-3">
                  {buttons.length === 0 && (
                    <p className="text-xs text-gray-400 text-center py-2">
                      Nenhum botão adicionado.
                    </p>
                  )}
                  {buttons.map((btn, index) => (
                    <div
                      key={index}
                      className="p-3 border border-gray-100 bg-gray-50 rounded-lg relative"
                    >
                      <button
                        onClick={() => handleRemoveButton(index)}
                        className="absolute top-2 right-2 text-gray-400 hover:text-red-500"
                      >
                        <Trash size={16} />
                      </button>
                      <div className="flex items-center gap-2 mb-2">
                        {btn.type === 'QUICK_REPLY' && (
                          <HandTap size={14} className="text-blue-500" />
                        )}
                        {btn.type === 'URL' && (
                          <Link size={14} className="text-blue-500" />
                        )}
                        {btn.type === 'PHONE_NUMBER' && (
                          <Phone size={14} className="text-blue-500" />
                        )}
                        <span className="text-[10px] font-bold text-gray-500 uppercase">
                          {btn.type === 'QUICK_REPLY'
                            ? 'Resposta Rápida'
                            : btn.type === 'URL'
                              ? 'Acessar Site'
                              : 'Ligar'}
                        </span>
                      </div>
                      <input
                        type="text"
                        placeholder="Texto (Ex: Saiba mais)"
                        value={btn.text}
                        onChange={(e) =>
                          handleUpdateButton(index, 'text', e.target.value)
                        }
                        className="w-full p-2 border border-gray-200 rounded text-xs mb-2 outline-none"
                        maxLength={25}
                      />
                      {btn.type === 'URL' && (
                        <input
                          type="text"
                          placeholder="URL (Ex: [https://site.com](https://site.com))"
                          value={btn.url || ''}
                          onChange={(e) =>
                            handleUpdateButton(index, 'url', e.target.value)
                          }
                          className="w-full p-2 border border-gray-200 rounded text-xs outline-none"
                        />
                      )}
                      {btn.type === 'PHONE_NUMBER' && (
                        <input
                          type="text"
                          placeholder="Número (Ex: +5511999999999)"
                          value={btn.phone_number || ''}
                          onChange={(e) =>
                            handleUpdateButton(
                              index,
                              'phone_number',
                              e.target.value,
                            )
                          }
                          className="w-full p-2 border border-gray-200 rounded text-xs outline-none"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* EDITOR (Meio) */}
            <div className="col-span-12 lg:col-span-4 flex flex-col">
              <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200 flex-1 flex flex-col relative">
                <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2 text-sm">
                  <ChatText size={18} className="text-green-600" /> Editor de
                  Texto
                </h3>
                <div className="flex items-center gap-2 mb-2 p-1.5 bg-gray-50 rounded-t-lg border-b border-gray-100">
                  <button
                    onClick={() => applyFormatting('BOLD')}
                    className="p-1 hover:bg-white rounded shadow-sm text-gray-600"
                  >
                    <TextB size={18} weight="bold" />
                  </button>
                  <button
                    onClick={() => applyFormatting('ITALIC')}
                    className="p-1 hover:bg-white rounded shadow-sm text-gray-600"
                  >
                    <TextItalic size={18} />
                  </button>
                  <button
                    onClick={() => applyFormatting('STRIKE')}
                    className="p-1 hover:bg-white rounded shadow-sm text-gray-600"
                  >
                    <TextStrikethrough size={18} />
                  </button>
                  <button
                    onClick={() => applyFormatting('MONO')}
                    className="p-1 hover:bg-white rounded shadow-sm text-gray-600"
                  >
                    <Code size={18} />
                  </button>
                  <button
                    onClick={handleAddVariable}
                    className="ml-auto px-2 py-1 bg-indigo-50 text-indigo-600 rounded text-[10px] font-bold"
                  >
                    Variável
                  </button>
                </div>
                <textarea
                  id="bodyTextArea"
                  value={bodyText}
                  onChange={(e) => setBodyText(e.target.value)}
                  className="w-full flex-1 p-3 border border-t-0 rounded-b-lg text-sm resize-none focus:bg-white outline-none min-h-[200px]"
                />
                {bodyText.match(/{{[0-9]+}}/g) && (
                  <div className="mt-4 bg-yellow-50 p-3 rounded-lg border border-yellow-200 space-y-2">
                    <p className="text-[10px] font-bold text-yellow-700 uppercase flex items-center gap-1">
                      <Lightning size={12} weight="fill" /> Exemplos Meta:
                    </p>
                    {bodyText.match(/{{[0-9]+}}/g).map((v) => (
                      <div key={v} className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-gray-400 w-6">
                          {v}
                        </span>
                        <input
                          type="text"
                          placeholder="Ex: Maria"
                          value={variableExamples[v] || ''}
                          onChange={(e) =>
                            setVariableExamples({
                              ...variableExamples,
                              [v]: e.target.value,
                            })
                          }
                          className="flex-1 p-1 border border-yellow-200 rounded text-xs outline-none"
                        />
                      </div>
                    ))}
                  </div>
                )}

                {/* FEEDBACK DE CRIAÇÃO (CAIXA VERDE OU VERMELHA) */}
                {creationFeedback && (
                  <div
                    className={`mt-4 p-3 rounded-xl border flex items-center justify-between text-sm font-bold animate-in slide-in-from-bottom-2 ${creationFeedback.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}
                  >
                    <div className="flex items-center gap-2">
                      <CheckCircle size={18} weight="bold" />
                      {creationFeedback.message}
                    </div>
                    {creationFeedback.status && (
                      <span className="bg-white px-2 py-1 rounded-md text-[10px] uppercase border shadow-sm tracking-wider">
                        {creationFeedback.status}
                      </span>
                    )}
                  </div>
                )}

                <button
                  onClick={handleCreateTemplate}
                  disabled={isCreating}
                  className="w-full mt-4 py-4 rounded-xl font-bold text-white bg-green-600 hover:bg-green-700 shadow-md transition-all flex items-center justify-center gap-2"
                >
                  {isCreating ? 'Enviando para a Meta...' : 'Criar Template'}
                </button>
              </div>
            </div>

            {/* PREVIEW (Direita) */}
            <div className="col-span-12 lg:col-span-4 hidden lg:block">
              <div className="bg-[#e5ddd5] p-6 rounded-xl shadow-inner border border-gray-200 h-full flex flex-col items-center">
                <div className="w-full max-w-[300px]">
                  <div className="bg-white p-2 rounded-lg rounded-tr-none shadow-sm mt-4 overflow-hidden relative">
                    {headerType !== 'NONE' && (
                      <div className="bg-gray-50 rounded-lg mb-2 min-h-[100px] flex items-center justify-center border border-gray-100">
                        {headerType === 'IMAGE' && headerPreviewUrl ? (
                          <img
                            src={headerPreviewUrl}
                            className="w-full h-32 object-cover rounded"
                            alt="Preview"
                          />
                        ) : (
                          <span className="text-[10px] text-gray-300 font-bold uppercase tracking-widest">
                            {headerType}
                          </span>
                        )}
                      </div>
                    )}
                    <div
                      className="px-2 py-1 text-[13px] text-gray-800 leading-relaxed font-sans"
                      dangerouslySetInnerHTML={renderFormattedText(bodyText)}
                    />
                    <span className="text-[10px] text-gray-400 float-right mt-1">
                      12:00
                    </span>
                  </div>
                  {buttons.length > 0 && (
                    <div className="mt-1 flex flex-col gap-1">
                      {buttons.map((btn, i) => (
                        <div
                          key={i}
                          className="bg-white text-[#00a884] text-center text-[13px] font-semibold py-2.5 px-4 rounded-lg shadow-sm border border-gray-100 flex items-center justify-center gap-2 cursor-default"
                        >
                          {btn.type === 'URL' && <Link size={16} />}
                          {btn.type === 'PHONE_NUMBER' && <Phone size={16} />}
                          {btn.type === 'QUICK_REPLY' && <HandTap size={16} />}
                          {btn.text || 'Texto do botão'}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================= ABA: DISPARAR ================= */}
        {activeTab === 'send' && (
          <div className="grid grid-cols-12 gap-6 animate-in fade-in duration-300">
            {/* 1. SELEÇÃO DE TEMPLATE */}
            <div className="col-span-12 lg:col-span-5 bg-white p-6 rounded-xl border border-gray-200 shadow-sm h-max">
              <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2 text-sm">
                <ListBullets size={18} className="text-indigo-600" /> 1.
                Escolher Modelo
              </h3>
              <select
                onChange={(e) =>
                  setSelectedTemplate(
                    templates.find(
                      (t) => (t.name || t.json?.name) === e.target.value,
                    ),
                  )
                }
                className="w-full p-3 border border-gray-200 rounded-xl text-sm mb-4 bg-gray-50 outline-none"
              >
                <option value="">-- Selecione um Modelo --</option>
                {templates.map((t, i) => (
                  <option key={i} value={t.name || t.json?.name}>
                    {(t.name || t.json?.name || '').toUpperCase()}
                  </option>
                ))}
              </select>
              {selectedTemplate && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mt-4">
                  {(() => {
                    const comps =
                      selectedTemplate.components ||
                      selectedTemplate.json?.components ||
                      [];
                    const h = comps.find((c) => c.type === 'HEADER');
                    const b = comps.find((c) => c.type === 'BODY');
                    const buttonsComp = comps.find((c) => c.type === 'BUTTONS');

                    const url =
                      h?.example?.header_handle?.[0] ||
                      h?.example?.header_url?.[0];

                    return (
                      <>
                        {h?.format === 'IMAGE' && url && (
                          <img
                            src={url}
                            className="w-full h-32 object-cover border-b"
                          />
                        )}
                        <div
                          className="p-4 text-sm leading-relaxed"
                          dangerouslySetInnerHTML={renderFormattedText(b?.text)}
                        />

                        {buttonsComp && buttonsComp.buttons?.length > 0 && (
                          <div className="px-4 pb-4 flex flex-col gap-1.5">
                            {buttonsComp.buttons.map((btn, i) => (
                              <div
                                key={i}
                                className="bg-white text-[#00a884] text-center text-[13px] font-semibold py-2 px-4 rounded-lg shadow-sm border border-gray-100 flex items-center justify-center gap-2 cursor-default"
                              >
                                {btn.type === 'URL' && <Link size={16} />}
                                {btn.type === 'PHONE_NUMBER' && (
                                  <Phone size={16} />
                                )}
                                {btn.type === 'QUICK_REPLY' && (
                                  <HandTap size={16} />
                                )}
                                {btn.text}
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* 2. ORIGEM DOS CONTATOS E FILTROS */}
            <div className="col-span-12 lg:col-span-7 bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex flex-col h-max">
              <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2 text-sm">
                <Users size={18} className="text-indigo-600" /> 2. Origem dos
                Contatos
              </h3>

              {/* TABS: CSV (Planilha), TOTVS ou CRM 26 */}
              <div className="flex flex-wrap bg-gray-50 p-1 rounded-lg mb-6 w-fit border border-gray-100 gap-1">
                <button
                  onClick={() => setSendMethod('CSV')}
                  className={`px-4 py-2 rounded-md text-xs font-bold transition-all flex items-center gap-2 ${sendMethod === 'CSV' ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  <Table size={16} /> Planilha (.xls/.csv)
                </button>
                <button
                  onClick={() => setSendMethod('TOTVS')}
                  className={`px-4 py-2 rounded-md text-xs font-bold transition-all flex items-center gap-2 ${sendMethod === 'TOTVS' ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  <Database size={16} /> TOTVS
                </button>
                <button
                  onClick={() => setSendMethod('CRM26')}
                  className={`px-4 py-2 rounded-md text-xs font-bold transition-all flex items-center gap-2 ${sendMethod === 'CRM26' ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  <Users size={16} /> CRM 26
                </button>
              </div>

              {/* CONTEÚDO: CRM 26 */}
              {sendMethod === 'CRM26' && (
                <div className="flex-1 flex flex-col items-center justify-center p-8 bg-gray-50 rounded-xl border border-dashed border-gray-200 min-h-[150px] animate-in fade-in duration-300">
                  <Users
                    size={48}
                    className="text-indigo-200 mb-3"
                    weight="fill"
                  />
                  <span className="font-bold text-gray-600 text-sm text-center">
                    Integração com CRM 26
                  </span>
                  <span className="text-xs text-gray-400 mt-2 text-center max-w-xs">
                    Em breve você poderá puxar seus leads e clientes diretamente
                    do CRM 26.
                  </span>
                </div>
              )}

              {/* CONTEÚDO: CSV / PLANILHA */}
              {sendMethod === 'CSV' && (
                <div className="flex-1 flex flex-col animate-in fade-in duration-300">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-gray-500 font-medium">
                      Faça o upload da sua planilha formatada.
                    </span>
                    <button
                      onClick={handleDownloadCsvTemplate}
                      className="text-[10px] font-bold text-green-600 bg-green-50 px-3 py-1.5 rounded-lg hover:bg-green-100 flex items-center gap-1 transition-all border border-green-100"
                    >
                      <DownloadSimple size={14} /> Baixar Modelo
                    </button>
                  </div>
                  <input
                    type="file"
                    id="csv"
                    className="hidden"
                    accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
                    onChange={handleCsvUpload}
                  />
                  <label
                    htmlFor="csv"
                    className="flex-1 border-2 border-dashed border-gray-200 rounded-xl flex flex-col items-center justify-center p-8 cursor-pointer hover:bg-gray-100 transition-all min-h-[150px] bg-gray-50"
                  >
                    <FileXls
                      size={40}
                      className={`mb-2 ${csvFile ? 'text-green-500' : 'text-gray-400'}`}
                      weight={csvFile ? 'fill' : 'regular'}
                    />
                    <span className="font-bold text-gray-700 text-sm">
                      {csvFile
                        ? csvFile.name
                        : 'Clique para selecionar a Planilha'}
                    </span>
                    {!csvFile && (
                      <span className="text-xs text-gray-400 mt-1">
                        .csv ou .xls
                      </span>
                    )}
                  </label>
                </div>
              )}

              {/* CONTEÚDO: TOTVS */}
              {sendMethod === 'TOTVS' && (
                <div className="flex flex-col animate-in fade-in duration-300 bg-gray-50 p-4 rounded-xl border border-gray-100">
                  <div className="flex flex-col md:flex-row items-end gap-4 mb-4">
                    <div className="flex-1 w-full">
                      <label className="text-[10px] font-bold text-gray-400 uppercase mb-2 block">
                        Operação Comercial
                      </label>
                      <select
                        value={totvsOperationId}
                        onChange={(e) => setTotvsOperationId(e.target.value)}
                        className="w-full p-2.5 border border-gray-200 rounded-lg text-sm bg-white outline-none"
                      >
                        {totvsOperationsList.length === 0 && (
                          <option value="">Carregando...</option>
                        )}
                        {totvsOperationsList.map((op) => (
                          <option key={op.id} value={op.id}>
                            {op.nome}
                          </option>
                        ))}
                      </select>
                    </div>
                    {dynamicUI.quickFilters && (
                      <div className="pb-1">{dynamicUI.quickFilters}</div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                    <div
                      className={
                        dynamicUI.isRevenda ? 'md:col-span-6' : 'md:col-span-3'
                      }
                    >
                      <label
                        className="text-[10px] font-bold text-gray-400 uppercase mb-2 block truncate"
                        title={dynamicUI.labelStart}
                      >
                        {dynamicUI.labelStart}
                      </label>
                      <input
                        type="date"
                        value={totvsStartDate}
                        onChange={(e) => setTotvsStartDate(e.target.value)}
                        className="w-full p-2 border border-gray-200 rounded-lg text-sm bg-white outline-none"
                      />
                    </div>
                    <div
                      className={
                        dynamicUI.isRevenda ? 'md:col-span-6' : 'md:col-span-3'
                      }
                    >
                      <label
                        className="text-[10px] font-bold text-gray-400 uppercase mb-2 block truncate"
                        title={dynamicUI.labelEnd}
                      >
                        {dynamicUI.labelEnd}
                      </label>
                      <input
                        type="date"
                        value={totvsEndDate}
                        onChange={(e) => setTotvsEndDate(e.target.value)}
                        className="w-full p-2 border border-gray-200 rounded-lg text-sm bg-white outline-none"
                      />
                    </div>

                    {!dynamicUI.isRevenda && (
                      <div className="md:col-span-6 relative" ref={dropdownRef}>
                        <label className="text-[10px] font-bold text-gray-400 uppercase mb-2 block">
                          Empresas (Filiais)
                        </label>
                        <div
                          onClick={() =>
                            setIsCompanyDropdownOpen(!isCompanyDropdownOpen)
                          }
                          className="w-full p-2.5 border border-gray-200 rounded-lg text-sm bg-white cursor-pointer flex justify-between items-center select-none"
                        >
                          <span className="font-medium text-gray-700 truncate">
                            {totvsCompanies.length === 0
                              ? 'Todas as Empresas'
                              : `${totvsCompanies.length} selecionada(s)`}
                          </span>
                          {isCompanyDropdownOpen ? (
                            <CaretUp size={16} className="text-gray-400" />
                          ) : (
                            <CaretDown size={16} className="text-gray-400" />
                          )}
                        </div>

                        {isCompanyDropdownOpen && (
                          <div className="absolute top-[100%] left-0 w-full mt-2 bg-white border border-gray-200 shadow-xl rounded-lg z-50 flex flex-col overflow-hidden">
                            <div className="p-3 border-b border-gray-100 relative">
                              <MagnifyingGlass
                                size={16}
                                className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-400"
                              />
                              <input
                                type="text"
                                placeholder="Buscar empresa..."
                                value={companySearchTerm}
                                onChange={(e) =>
                                  setCompanySearchTerm(e.target.value)
                                }
                                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded text-sm outline-none focus:border-indigo-500"
                              />
                            </div>

                            <div className="p-3 border-b border-gray-100 flex flex-wrap gap-2">
                              <button
                                onClick={handleSelectAllCompanies}
                                className="px-3 py-1.5 bg-[#001b3b] text-white text-xs font-bold rounded hover:opacity-90"
                              >
                                Todas
                              </button>
                              <button
                                onClick={handleSelectFiliais}
                                className="px-3 py-1.5 bg-blue-500 text-white text-xs font-bold rounded hover:opacity-90"
                              >
                                Filiais
                              </button>
                              <button
                                onClick={handleSelectFranquias}
                                className="px-3 py-1.5 bg-green-500 text-white text-xs font-bold rounded hover:opacity-90"
                              >
                                Franquias
                              </button>
                              <button
                                onClick={handleClearCompanies}
                                className="px-3 py-1.5 bg-gray-500 text-white text-xs font-bold rounded hover:opacity-90"
                              >
                                Limpar
                              </button>
                            </div>

                            <div className="max-h-56 overflow-y-auto p-1">
                              {filteredCompanies.length === 0 ? (
                                <p className="text-center text-xs text-gray-400 py-4">
                                  Nenhuma empresa encontrada.
                                </p>
                              ) : (
                                filteredCompanies.map((comp) => (
                                  <label
                                    key={comp.id}
                                    className="flex items-center justify-between p-2.5 hover:bg-gray-50 cursor-pointer border-b border-gray-50 last:border-0 rounded"
                                  >
                                    <span className="text-xs font-bold text-gray-700">
                                      {comp.id} - {comp.nome}
                                    </span>
                                    <input
                                      type="checkbox"
                                      checked={totvsCompanies.includes(comp.id)}
                                      onChange={() =>
                                        handleToggleCompany(comp.id)
                                      }
                                      className="w-4 h-4 accent-red-600 rounded"
                                    />
                                  </label>
                                ))
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="mt-6 flex items-center justify-between bg-white p-3 rounded-lg border border-gray-200">
                    <div className="flex flex-col">
                      <span className="text-[10px] text-gray-400 font-bold uppercase">
                        Status de Busca
                      </span>
                      <div className="text-sm font-bold text-gray-800 flex items-center gap-2">
                        <span>
                          {totvsContacts
                            ? `${totvsContacts.length} Contatos Carregados`
                            : 'Aguardando ação...'}
                        </span>

                        {totvsContacts && totvsContacts.length > 0 && (
                          <button
                            onClick={() => setShowContactsModal(true)}
                            className="text-[10px] bg-indigo-50 border border-indigo-100 text-indigo-600 px-2 py-1 rounded hover:bg-indigo-100 flex items-center gap-1 transition-all ml-2"
                          >
                            <Eye size={14} weight="bold" /> Ver Lista
                          </button>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={handleFetchTotvs}
                      disabled={isFetchingTotvs}
                      className={`px-6 py-2 rounded-lg text-xs font-bold text-white shadow-sm transition-all ${isFetchingTotvs ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'}`}
                    >
                      {isFetchingTotvs
                        ? 'Consultando API...'
                        : 'Buscar Contatos'}
                    </button>
                  </div>
                </div>
              )}

              {/* === CARD DE PREVISÃO DE CUSTO E RESUMO === */}
              {selectedTemplate && totvsContacts && sendMethod === 'TOTVS' && (
                <div className="mt-4 bg-gradient-to-r from-blue-50 to-indigo-50 p-5 rounded-xl border border-indigo-100 flex flex-col md:flex-row items-center justify-between gap-4 shadow-inner">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-indigo-400 uppercase">
                      Previsão da Campanha
                    </span>
                    <span className="text-xl font-black text-indigo-900">
                      {totvsContacts.length} Clientes
                    </span>
                    <span className="text-[10px] font-bold text-gray-500 uppercase mt-2">
                      Ticket Médio (Estimado)
                    </span>
                    <span className="text-sm font-bold text-gray-700">
                      R${' '}
                      {Number(ticketMedio || 0).toLocaleString('pt-BR', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </div>

                  <div className="flex flex-col items-end text-right border-l border-indigo-200 pl-4">
                    <span className="text-[10px] font-bold text-indigo-400 uppercase">
                      Categoria Meta
                    </span>
                    <span className="text-xs font-bold text-indigo-700 mb-2">
                      {selectedTemplate.category === 'UTILITY'
                        ? 'Utilidade (US$ 0,01/msg)'
                        : 'Marketing (US$ 0,06/msg)'}
                    </span>
                    <span className="text-[10px] font-bold text-indigo-400 uppercase">
                      Custo Total Estimado
                    </span>

                    {(() => {
                      const custoUSD =
                        (selectedTemplate.category === 'UTILITY'
                          ? 0.01
                          : 0.06) * totvsContacts.length;
                      const custoBRL = custoUSD * COTACAO_DOLAR;
                      return (
                        <>
                          <span className="text-2xl font-black text-indigo-900">
                            US${' '}
                            {custoUSD.toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </span>
                          <span className="text-[10px] font-bold text-gray-500 bg-white px-2 py-0.5 rounded-full border border-indigo-100 shadow-sm mt-1">
                            ~ R${' '}
                            {custoBRL.toLocaleString('pt-BR', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </span>
                        </>
                      );
                    })()}
                  </div>
                </div>
              )}

              <button
                onClick={handleSendCampaign}
                disabled={
                  isSending ||
                  (sendMethod !== 'CRM26' && !csvFile && !totvsContacts) ||
                  !selectedTemplate
                }
                className={`w-full mt-6 py-4 rounded-xl font-bold text-white shadow-lg transition-all ${isSending || sendMethod === 'CRM26' ? 'bg-gray-300' : 'bg-indigo-600 hover:bg-indigo-700'}`}
              >
                {isSending ? 'Processando Disparo...' : 'Iniciar Disparo'}
              </button>
            </div>
          </div>
        )}

        {/* ================= ABA: RESULTADOS ================= */}
        {activeTab === 'results' && (
          <div className="animate-in fade-in duration-300">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 mb-6 grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="flex flex-col">
                <label className="text-xs font-bold text-gray-400 uppercase mb-2 flex items-center gap-1">
                  <ListBullets size={14} /> Modelo de Template
                </label>
                <select
                  value={selectedResultTemplate}
                  onChange={(e) => setSelectedResultTemplate(e.target.value)}
                  className="w-full h-11 px-3 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:border-blue-500"
                >
                  <option value="">-- Selecione o Modelo --</option>
                  {templates.map((t, i) => (
                    <option key={i} value={t.name || t.json?.name}>
                      {(t.name || t.json?.name || '').toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col">
                <label className="text-xs font-bold text-gray-400 uppercase mb-2 flex items-center gap-1">
                  <Calendar size={14} /> Data Inicial
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full h-11 px-3 border border-gray-200 rounded-lg text-sm outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex flex-col">
                <label className="text-xs font-bold text-gray-400 uppercase mb-2 flex items-center gap-1">
                  <Calendar size={14} /> Data Final
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full h-11 px-3 border border-gray-200 rounded-lg text-sm outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex flex-col">
                <label className="text-xs font-bold uppercase mb-2 flex items-center gap-1 invisible select-none">
                  Ação
                </label>
                <button
                  onClick={handleFetchAnalytics}
                  disabled={isLoadingAnalytics}
                  className={`w-full h-11 rounded-lg font-bold text-white shadow-md transition-all flex items-center justify-center ${isLoadingAnalytics ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'}`}
                >
                  {isLoadingAnalytics ? 'Buscando...' : 'Buscar Resultados'}
                </button>
              </div>
            </div>

            {analyticsData && (
              <div className="grid grid-cols-12 gap-6 items-start">
                <div className="col-span-12 lg:col-span-4">
                  <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 h-full">
                    <h3 className="text-sm font-bold text-gray-800 mb-4">
                      Seu modelo
                    </h3>
                    <div className="bg-[#e5ddd5] p-4 rounded-xl flex flex-col items-center">
                      <div className="w-full max-w-[280px]">
                        {(() => {
                          const resultTemplateObj = templates.find(
                            (t) =>
                              (t.name || t.json?.name) ===
                              selectedResultTemplate,
                          );
                          if (!resultTemplateObj)
                            return (
                              <p className="text-xs text-center text-gray-500">
                                Selecione um modelo.
                              </p>
                            );
                          const comps =
                            resultTemplateObj.components ||
                            resultTemplateObj.json?.components ||
                            [];
                          const headerComp = comps.find(
                            (c) => c.type === 'HEADER',
                          );
                          const bodyComp = comps.find((c) => c.type === 'BODY');
                          const buttonsComp = comps.find(
                            (c) => c.type === 'BUTTONS',
                          );
                          const headerUrl =
                            headerComp?.example?.header_handle?.[0] ||
                            headerComp?.example?.header_url?.[0];

                          return (
                            <>
                              <div className="bg-white p-2 rounded-lg rounded-tr-none shadow-sm overflow-hidden relative">
                                {headerComp?.format === 'IMAGE' &&
                                  headerUrl && (
                                    <img
                                      src={headerUrl}
                                      className="w-full h-32 object-cover rounded mb-2"
                                      alt="Header"
                                    />
                                  )}
                                <div
                                  className="px-2 py-1 text-[13px] text-gray-800 leading-relaxed font-sans"
                                  dangerouslySetInnerHTML={renderFormattedText(
                                    bodyComp?.text,
                                  )}
                                />
                                <span className="text-[10px] text-gray-400 float-right mt-1">
                                  Agora
                                </span>
                              </div>
                              {buttonsComp &&
                                buttonsComp.buttons?.length > 0 && (
                                  <div className="mt-1 flex flex-col gap-1">
                                    {buttonsComp.buttons.map((btn, i) => (
                                      <div
                                        key={i}
                                        className="bg-white text-[#00a884] text-center text-[13px] font-semibold py-2.5 px-4 rounded-lg shadow-sm border border-gray-100 flex items-center justify-center gap-2"
                                      >
                                        {btn.type === 'URL' && (
                                          <Link size={16} />
                                        )}
                                        {btn.type === 'PHONE_NUMBER' && (
                                          <Phone size={16} />
                                        )}
                                        {btn.type === 'QUICK_REPLY' && (
                                          <HandTap size={16} />
                                        )}
                                        {btn.text}
                                      </div>
                                    ))}
                                  </div>
                                )}
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="col-span-12 lg:col-span-8 flex flex-col gap-4">
                  {(() => {
                    const totalEnviadas = analyticsData.enviadas || 0;
                    const totalUSD = analyticsData.totalUSD || 0;
                    const totalBRL = analyticsData.totalBRL || 0;

                    const cpmUSD =
                      totalEnviadas > 0 ? totalUSD / totalEnviadas : 0;
                    const cpmBRL =
                      totalEnviadas > 0 ? totalBRL / totalEnviadas : 0;

                    return (
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200 col-span-2 lg:col-span-1 flex flex-col justify-center">
                          <span className="text-[10px] font-bold text-gray-500 uppercase flex items-center gap-1 mb-1">
                            Custo Total (USD){' '}
                            <Info size={14} className="text-gray-400" />
                          </span>
                          <span className="text-2xl font-black text-gray-800">
                            US${' '}
                            {Number(totalUSD).toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </span>
                        </div>
                        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200 col-span-2 lg:col-span-1 flex flex-col justify-center">
                          <span className="text-[10px] font-bold text-gray-500 uppercase flex items-center gap-1 mb-1">
                            Valor Convertido (BRL){' '}
                            <Info size={14} className="text-gray-400" />
                          </span>
                          <span className="text-2xl font-black text-green-600">
                            R${' '}
                            {Number(totalBRL).toLocaleString('pt-BR', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </span>
                        </div>

                        <div className="bg-blue-50 p-5 rounded-xl border border-blue-100 col-span-2 lg:col-span-1 flex flex-col justify-center">
                          <span className="text-[10px] font-bold text-blue-600 uppercase mb-1">
                            Custo/Msg (U$)
                          </span>
                          <span className="text-xl font-bold text-blue-800">
                            US${' '}
                            {cpmUSD.toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </span>
                        </div>
                        <div className="bg-emerald-50 p-5 rounded-xl border border-emerald-100 col-span-2 lg:col-span-1 flex flex-col justify-center">
                          <span className="text-[10px] font-bold text-emerald-600 uppercase mb-1">
                            Custo/Msg (R$)
                          </span>
                          <span className="text-xl font-bold text-emerald-800">
                            R${' '}
                            {cpmBRL.toLocaleString('pt-BR', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </span>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                        Desempenho <Info size={14} className="text-gray-400" />
                      </h3>
                    </div>

                    <div className="grid grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
                      <div className="border border-gray-200 p-4 rounded-lg flex flex-col items-center">
                        <span className="text-[10px] font-bold text-gray-500 uppercase mb-1">
                          Enviadas
                        </span>
                        <span className="text-xl font-black text-gray-800">
                          {analyticsData.enviadas || '0'}
                        </span>
                      </div>
                      <div className="border border-gray-200 p-4 rounded-lg flex flex-col items-center">
                        <span className="text-[10px] font-bold text-gray-500 uppercase mb-1">
                          Entregues
                        </span>
                        <span className="text-xl font-black text-gray-800">
                          {analyticsData.entregues || '0'}
                        </span>
                      </div>
                      <div className="border border-gray-200 p-4 rounded-lg flex flex-col items-center">
                        <span className="text-[10px] font-bold text-gray-500 uppercase mb-1">
                          Lidas
                        </span>
                        <span className="text-xl font-black text-gray-800">
                          {analyticsData.lidas || '0'}
                        </span>
                      </div>
                      <div className="border border-gray-200 p-4 rounded-lg hidden lg:flex flex-col items-center">
                        <span className="text-[10px] font-bold text-gray-500 uppercase mb-1">
                          Respostas API
                        </span>
                        <span className="text-xl font-black text-gray-800">
                          {analyticsData.respostas || '0'}
                        </span>
                      </div>
                    </div>

                    <div className="w-full h-72 bg-gray-50 border border-gray-100 rounded-lg p-4">
                      {!analyticsData.grafico ||
                      analyticsData.grafico.length === 0 ? (
                        <div className="w-full h-full flex flex-col items-center justify-center text-gray-400">
                          <ChartBar
                            size={48}
                            className="mb-2 text-gray-300"
                            weight="light"
                          />
                          <span className="text-sm font-bold">
                            Nenhum dado diário para exibir.
                          </span>
                        </div>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={analyticsData.grafico}
                            margin={{ top: 20, right: 30, left: 0, bottom: 5 }}
                          >
                            <CartesianGrid
                              strokeDasharray="3 3"
                              vertical={false}
                              stroke="#e5e7eb"
                            />
                            <XAxis
                              dataKey="label"
                              tick={{ fontSize: 11, fill: '#6b7280' }}
                              axisLine={false}
                              tickLine={false}
                            />
                            <YAxis
                              tick={{ fontSize: 11, fill: '#6b7280' }}
                              axisLine={false}
                              tickLine={false}
                            />
                            <Tooltip
                              cursor={{ fill: '#f3f4f6' }}
                              contentStyle={{
                                borderRadius: '8px',
                                border: '1px solid #e5e7eb',
                                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                              }}
                              labelStyle={{
                                fontWeight: 'bold',
                                color: '#374151',
                                marginBottom: '5px',
                              }}
                            />
                            <Legend
                              wrapperStyle={{
                                fontSize: 12,
                                paddingTop: '10px',
                              }}
                              iconType="circle"
                            />
                            <Bar
                              dataKey="enviadas"
                              name="Enviadas"
                              fill="#60a5fa"
                              radius={[4, 4, 0, 0]}
                              maxBarSize={40}
                            />
                            <Bar
                              dataKey="entregues"
                              name="Entregues"
                              fill="#34d399"
                              radius={[4, 4, 0, 0]}
                              maxBarSize={40}
                            />
                            <Bar
                              dataKey="lidas"
                              name="Lidas"
                              fill="#818cf8"
                              radius={[4, 4, 0, 0]}
                              maxBarSize={40}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ================= MODAL DE LISTA DE CONTATOS ================= */}
      {showContactsModal && totvsContacts && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-gray-50">
              <h3 className="font-bold text-gray-800 flex items-center gap-2">
                <Users size={20} className="text-indigo-600" />
                Lista de Contatos ({totvsContacts.length})
              </h3>
              <button
                onClick={() => setShowContactsModal(false)}
                className="p-1 hover:bg-gray-200 rounded-full text-gray-500 transition-all"
              >
                <X size={20} weight="bold" />
              </button>
            </div>

            <div className="overflow-y-auto p-4 flex-1 bg-white">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b-2 border-gray-100 text-[10px] uppercase text-gray-400">
                    <th className="pb-3 px-2 font-bold">Cód. Cliente</th>
                    <th className="pb-3 px-2 font-bold">Nome</th>
                    <th className="pb-3 px-2 font-bold">CPF / CNPJ</th>
                    <th className="pb-3 px-2 font-bold">WhatsApp</th>
                  </tr>
                </thead>
                <tbody>
                  {totvsContacts.map((c, i) => (
                    <tr
                      key={i}
                      className="border-b border-gray-50 hover:bg-gray-50 text-xs text-gray-700 transition-colors"
                    >
                      <td className="py-3 px-2 font-mono text-gray-500">
                        {c.cd_pessoa || c.code}
                      </td>
                      <td className="py-3 px-2 font-semibold text-gray-800 uppercase">
                        {c.name || c.nome}
                      </td>
                      <td className="py-3 px-2">{c.cpf_cnpj || c.cpf}</td>
                      <td className="py-3 px-2 font-medium text-green-600">
                        {c.nr_telefone || c.phones}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end">
              <button
                onClick={() => setShowContactsModal(false)}
                className="px-6 py-2 bg-gray-800 text-white text-xs font-bold rounded-lg hover:bg-gray-700 transition-all shadow-sm"
              >
                Fechar Tabela
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= ABA: RELATÓRIOS ================= */}
      {activeTab === 'relatorios' && (
        <div className="animate-in fade-in duration-300">
          <WhatsAppReports
            accounts={accounts}
            activeAccount={accounts.find(a => a.waba_id === selectedAccount)}
          />
        </div>
      )}
    </div>
  );
};

export default CrosbyTemplateManager;
