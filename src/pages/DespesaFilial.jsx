import React, { useEffect, useState, useCallback } from 'react';
import PageTitle from '../components/ui/PageTitle';
import {
  Buildings,
  IdentificationCard,
  Storefront,
  X,
  Lightning,
  Drop,
  WifiHigh,
  Phone,
  House,
  Waves,
  Buildings as BuildingsIcon,
  Spinner,
  Plus,
  Pencil,
  Trash,
  CaretDown,
  CaretRight,
  CheckCircle,
  Warning,
  FloppyDisk,
} from '@phosphor-icons/react';
import { API_BASE_URL } from '../config/constants';
import { supabase } from '../lib/supabase';

// Filiais CROSBY que devem aparecer na página (ordenadas por código)
const FILIAIS_CROSBY = [
  { cd: '1', nome: 'CROSBY MATRIZ' },
  { cd: '2', nome: 'FILIAL 2' },
  { cd: '5', nome: 'FILIAL 5' },
  { cd: '55', nome: 'FILIAL 55' },
  { cd: '65', nome: 'FILIAL 65' },
  { cd: '87', nome: 'FILIAL 87' },
  { cd: '88', nome: 'FILIAL 88' },
  { cd: '89', nome: 'FILIAL 89' },
  { cd: '90', nome: 'FILIAL 90' },
  { cd: '91', nome: 'FILIAL 91' },
  { cd: '92', nome: 'FILIAL 92' },
  { cd: '93', nome: 'FILIAL 93' },
  { cd: '94', nome: 'FILIAL 94' },
  { cd: '95', nome: 'CROSBY SHOPPING MIDWAY' },
  { cd: '96', nome: 'FILIAL 96' },
  { cd: '97', nome: 'FILIAL 97' },
  { cd: '98', nome: 'FILIAL 98' },
  { cd: '99', nome: 'CROSBY BREJINHO' },
  { cd: 'CASA_ECOVILLE', nome: 'CASA ECOVILLE', semTotvs: true },
  { cd: 'CASA_CROSBY', nome: 'CASA CROSBY', semTotvs: true },
  { cd: 'TERRENO_PAINEL', nome: 'TERRENO PAINEL SOLAR', semTotvs: true },
];

const fmtCNPJ = (cnpj) => {
  if (!cnpj) return '—';
  const digits = String(cnpj).replace(/\D/g, '');
  if (digits.length !== 14) return cnpj;
  return digits.replace(
    /(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,
    '$1.$2.$3/$4-$5',
  );
};

// Skeleton de carregamento
const CardSkeleton = () => (
  <div className="bg-white rounded-xl shadow border border-gray-200 p-5 animate-pulse">
    <div className="flex items-center gap-3 mb-4">
      <div className="w-10 h-10 rounded-full bg-gray-200" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3 bg-gray-200 rounded w-1/4" />
        <div className="h-4 bg-gray-200 rounded w-2/3" />
      </div>
    </div>
    <div className="space-y-3 pt-3 border-t border-gray-100">
      <div className="h-3 bg-gray-200 rounded w-full" />
      <div className="h-3 bg-gray-200 rounded w-4/5" />
    </div>
  </div>
);

// ─── Configuração das despesas fixas ─────────────────────────────
const DESPESAS_FIXAS = [
  {
    key: 'energia',
    label: 'Energia',
    icon: Lightning,
    color: 'text-yellow-600',
    bg: 'bg-yellow-50',
    border: 'border-yellow-200',
    match: (ds) => /energia\s*el[eé]trica/i.test(ds),
  },
  {
    key: 'agua',
    label: 'Água',
    icon: Drop,
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    match: (ds) => /[áa]gua/i.test(ds),
  },
  {
    key: 'internet',
    label: 'Internet',
    icon: WifiHigh,
    color: 'text-purple-600',
    bg: 'bg-purple-50',
    border: 'border-purple-200',
    match: (ds) => /internet/i.test(ds),
  },
  {
    key: 'telefone',
    label: 'Telefone',
    icon: Phone,
    color: 'text-green-600',
    bg: 'bg-green-50',
    border: 'border-green-200',
    match: (ds) => /telefone/i.test(ds),
  },
  {
    key: 'aluguel',
    label: 'Aluguel',
    icon: House,
    color: 'text-red-600',
    bg: 'bg-red-50',
    border: 'border-red-200',
    match: (ds) => /aluguel|alugu[eé]is/i.test(ds),
  },
  {
    key: 'agua_mineral',
    label: 'Água Mineral',
    icon: Waves,
    color: 'text-cyan-600',
    bg: 'bg-cyan-50',
    border: 'border-cyan-200',
    match: (ds) => /[áa]gua\s*mineral/i.test(ds),
  },
  {
    key: 'condominio',
    label: 'Condomínio',
    icon: BuildingsIcon,
    color: 'text-orange-600',
    bg: 'bg-orange-50',
    border: 'border-orange-200',
    match: (ds) => /condom[ií]nio/i.test(ds),
  },
];

// ─── Formulário inline para adicionar / editar fornecedor ────────
const FORMAS_PGTO = [
  'PIX',
  'BOLETO',
  'DÉBITO AUTOMÁTICO',
  'TRANSFERÊNCIA',
  'CARTÃO DE CRÉDITO',
  'DINHEIRO',
  'OUTRO',
];

const FORM_EMPTY = {
  cd_fornecedor: '',
  nm_fornecedor: '',
  tipo_despesa: '',
  vencimento: '',
  forma_pagamento: '',
  observacao: '',
};

const FornecedorForm = ({
  cdFilial,
  tipoDespesa,
  initial,
  onSaved,
  onCancel,
}) => {
  const [form, setForm] = useState(
    initial
      ? { ...initial }
      : { ...FORM_EMPTY, tipo_despesa: tipoDespesa, cd_filial: cdFilial },
  );
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState(null);

  const set = (field) => (e) =>
    setForm((p) => ({ ...p, [field]: e.target.value }));

  const salvar = async () => {
    if (!form.nm_fornecedor.trim()) {
      setErro('Nome do fornecedor é obrigatório.');
      return;
    }
    setSaving(true);
    setErro(null);
    try {
      const payload = {
        cd_filial: cdFilial,
        cd_fornecedor: form.cd_fornecedor.trim() || null,
        nm_fornecedor: form.nm_fornecedor.trim(),
        tipo_despesa: tipoDespesa,
        vencimento: form.vencimento.trim() || null,
        forma_pagamento: form.forma_pagamento || null,
        observacao: form.observacao.trim() || null,
      };
      if (initial?.id) {
        const { error } = await supabase
          .from('despesas_fixas_filial')
          .update(payload)
          .eq('id', initial.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('despesas_fixas_filial')
          .insert(payload);
        if (error) throw error;
      }
      onSaved();
    } catch (err) {
      setErro(err.message || 'Erro ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mt-2 space-y-2">
      {erro && (
        <div className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
          <Warning size={13} />
          {erro}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-0.5">
            Código Fornecedor
          </label>
          <input
            value={form.cd_fornecedor}
            onChange={set('cd_fornecedor')}
            placeholder="Ex: 001"
            className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#000638]"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-0.5">
            Nome Fornecedor *
          </label>
          <input
            value={form.nm_fornecedor}
            onChange={set('nm_fornecedor')}
            placeholder="Nome do fornecedor"
            className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#000638]"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-0.5">
            Vencimento (dia)
          </label>
          <input
            value={form.vencimento}
            onChange={set('vencimento')}
            placeholder="Ex: 10"
            maxLength={2}
            className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#000638]"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-0.5">
            Forma de Pagamento
          </label>
          <select
            value={form.forma_pagamento}
            onChange={set('forma_pagamento')}
            className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#000638] bg-white"
          >
            <option value="">Selecione...</option>
            {FORMAS_PGTO.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-[10px] font-bold text-gray-500 uppercase mb-0.5">
          Observação
        </label>
        <textarea
          value={form.observacao}
          onChange={set('observacao')}
          rows={2}
          placeholder="Observações adicionais..."
          className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#000638] resize-none"
        />
      </div>
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded transition-colors"
        >
          Cancelar
        </button>
        <button
          onClick={salvar}
          disabled={saving}
          className="flex items-center gap-1 bg-[#000638] hover:bg-[#001060] disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded transition-colors"
        >
          {saving ? (
            <Spinner size={12} className="animate-spin" />
          ) : (
            <FloppyDisk size={12} weight="bold" />
          )}
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </div>
  );
};

// ─── Linha de fornecedor cadastrado ──────────────────────────────
const FornecedorRow = ({ item, onEdit, onDelete }) => (
  <div className="flex items-start gap-2 px-3 py-2 bg-white border border-gray-100 rounded-lg text-xs group">
    <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-0.5">
      <div>
        <span className="text-gray-400 text-[10px]">Código: </span>
        <span className="font-medium text-gray-700">
          {item.cd_fornecedor || '—'}
        </span>
      </div>
      <div className="sm:col-span-2">
        <span className="text-gray-400 text-[10px]">Fornecedor: </span>
        <span className="font-semibold text-gray-800">
          {item.nm_fornecedor}
        </span>
      </div>
      <div>
        <span className="text-gray-400 text-[10px]">Vencimento: </span>
        <span className="text-gray-700">dia {item.vencimento || '—'}</span>
      </div>
      <div>
        <span className="text-gray-400 text-[10px]">Pagamento: </span>
        <span className="text-gray-700">{item.forma_pagamento || '—'}</span>
      </div>
      {item.observacao && (
        <div className="sm:col-span-3">
          <span className="text-gray-400 text-[10px]">Obs: </span>
          <span className="text-gray-600 italic">{item.observacao}</span>
        </div>
      )}
    </div>
    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
      <button
        onClick={() => onEdit(item)}
        className="text-[#000638]/60 hover:text-[#000638] p-1 rounded transition-colors"
        title="Editar"
      >
        <Pencil size={13} weight="bold" />
      </button>
      <button
        onClick={() => onDelete(item.id)}
        className="text-red-400 hover:text-red-600 p-1 rounded transition-colors"
        title="Excluir"
      >
        <Trash size={13} weight="bold" />
      </button>
    </div>
  </div>
);

// ─── Nó da árvore (categoria de despesa) ─────────────────────────
const CategoriaNode = ({ cat, cdFilial, fornecedores, onRefresh }) => {
  const [aberto, setAberto] = useState(false);
  const [adicionando, setAdicionando] = useState(false);
  const [editando, setEditando] = useState(null); // item sendo editado
  const [excluindo, setExcluindo] = useState(null);

  const Icon = cat.icon;
  const itens = fornecedores.filter(
    (f) => f.tipo_despesa === cat.key.toUpperCase(),
  );

  const handleDelete = async (id) => {
    if (!window.confirm('Confirmar exclusão?')) return;
    setExcluindo(id);
    await supabase.from('despesas_fixas_filial').delete().eq('id', id);
    setExcluindo(null);
    onRefresh();
  };

  return (
    <div className={`rounded-xl border ${cat.border} overflow-hidden`}>
      {/* Header clicável */}
      <button
        onClick={() => {
          setAberto((v) => !v);
          setAdicionando(false);
          setEditando(null);
        }}
        className={`w-full flex items-center gap-2 px-4 py-2.5 ${cat.bg} hover:brightness-95 transition-all`}
      >
        {aberto ? (
          <CaretDown size={14} weight="bold" className={cat.color} />
        ) : (
          <CaretRight size={14} weight="bold" className={cat.color} />
        )}
        <Icon size={16} weight="bold" className={cat.color} />
        <span
          className={`text-xs font-bold ${cat.color} uppercase tracking-wide flex-1 text-left`}
        >
          {cat.label}
        </span>
        <span className="text-[10px] text-gray-500 mr-1">
          {itens.length} fornecedor{itens.length !== 1 ? 'es' : ''}
        </span>
      </button>

      {/* Conteúdo expandido */}
      {aberto && (
        <div className="p-3 space-y-2 bg-white">
          {itens.length === 0 && !adicionando && (
            <p className="text-xs text-gray-400 italic py-1">
              Nenhum fornecedor cadastrado.
            </p>
          )}

          {itens.map((item) =>
            editando?.id === item.id ? (
              <FornecedorForm
                key={item.id}
                cdFilial={cdFilial}
                tipoDespesa={cat.key.toUpperCase()}
                initial={editando}
                onSaved={() => {
                  setEditando(null);
                  onRefresh();
                }}
                onCancel={() => setEditando(null)}
              />
            ) : (
              <FornecedorRow
                key={item.id}
                item={item}
                onEdit={setEditando}
                onDelete={excluindo === item.id ? () => {} : handleDelete}
              />
            ),
          )}

          {adicionando && (
            <FornecedorForm
              cdFilial={cdFilial}
              tipoDespesa={cat.key.toUpperCase()}
              initial={null}
              onSaved={() => {
                setAdicionando(false);
                onRefresh();
              }}
              onCancel={() => setAdicionando(false)}
            />
          )}

          {!adicionando && !editando && (
            <button
              onClick={() => setAdicionando(true)}
              className={`flex items-center gap-1.5 text-xs font-semibold ${cat.color} hover:underline mt-1`}
            >
              <Plus size={13} weight="bold" />
              Adicionar fornecedor
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Modal de Despesas Fixas ──────────────────────────────────────
const ModalDespesas = ({ filial, onClose }) => {
  const [loadingForn, setLoadingForn] = useState(true);
  const [fornecedores, setFornecedores] = useState([]);

  const carregarFornecedores = useCallback(async () => {
    setLoadingForn(true);
    const { data, error } = await supabase
      .from('despesas_fixas_filial')
      .select('*')
      .eq('cd_filial', filial.cd)
      .order('tipo_despesa')
      .order('nm_fornecedor');
    if (!error) setFornecedores(data || []);
    setLoadingForn(false);
  }, [filial.cd]);

  useEffect(() => {
    carregarFornecedores();
  }, [carregarFornecedores]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 p-5 border-b border-gray-200 bg-[#000638] rounded-t-2xl">
          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
            <Storefront size={20} weight="bold" className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-bold text-white/70 uppercase tracking-wide">
              FILIAL {filial.cd} — Despesas Fixas
            </div>
            <h2 className="text-sm font-bold text-white truncate">
              {filial.grupoEmpresa || filial.nome}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-white/70 hover:text-white transition-colors flex-shrink-0"
          >
            <X size={20} weight="bold" />
          </button>
        </div>

        {/* Infos da loja */}
        <div className="px-5 py-2.5 bg-gray-50 border-b border-gray-200 flex flex-wrap gap-4 text-xs">
          <div>
            <span className="font-semibold text-gray-400 uppercase tracking-wide text-[10px]">
              Razão Social{' '}
            </span>
            <span className="text-gray-800 font-medium">
              {filial.razaoSocial || '—'}
            </span>
          </div>
          <div>
            <span className="font-semibold text-gray-400 uppercase tracking-wide text-[10px]">
              CNPJ{' '}
            </span>
            <span className="text-gray-800 font-mono">
              {fmtCNPJ(filial.cnpj)}
            </span>
          </div>
        </div>

        {/* Tree view */}
        <div className="flex-1 overflow-y-auto p-4">
          {loadingForn ? (
            <div className="flex items-center justify-center py-10 text-gray-400">
              <Spinner size={24} className="animate-spin mr-2" />
              <span className="text-sm">Carregando...</span>
            </div>
          ) : (
            <div className="space-y-2">
              {DESPESAS_FIXAS.map((cat) => (
                <CategoriaNode
                  key={cat.key}
                  cat={cat}
                  cdFilial={filial.cd}
                  fornecedores={fornecedores}
                  onRefresh={carregarFornecedores}
                />
              ))}
            </div>
          )}

          <div className="mt-4 flex items-center gap-1.5 text-[10px] text-gray-400">
            <CheckCircle size={12} />
            Os dados são salvos automaticamente no banco de dados.
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Card de filial (clicável) ────────────────────────────────────
const FilialCard = ({ filial, onClick }) => {
  const { cd, nome, cnpj, razaoSocial, fantasyName, grupoEmpresa, status } =
    filial;

  return (
    <button
      onClick={() => onClick(filial)}
      className="bg-white rounded-xl shadow border border-gray-200 hover:shadow-md hover:border-[#000638]/40 transition-all text-left w-full group"
    >
      {/* Cabeçalho do card */}
      <div className="flex items-center gap-3 p-5 border-b border-gray-100">
        <div className="w-11 h-11 rounded-full bg-[#000638] flex items-center justify-center flex-shrink-0 group-hover:bg-[#001060] transition-colors">
          <Storefront size={22} weight="bold" className="text-white" />
        </div>
        <div className="min-w-0">
          <span className="inline-block text-[10px] font-bold text-[#000638] bg-blue-50 border border-[#000638]/20 px-2 py-0.5 rounded-full mb-1">
            {status === 'manual' ? 'IMÓVEL' : `FILIAL ${cd}`}
          </span>
          <h3 className="text-sm font-bold text-[#000638] truncate">
            {grupoEmpresa || nome}
          </h3>
        </div>
        {status === 'ok' && (
          <span className="ml-auto text-[10px] font-semibold text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full flex-shrink-0">
            Ativo
          </span>
        )}
        {status === 'manual' && (
          <span className="ml-auto text-[10px] font-semibold text-orange-700 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-full flex-shrink-0">
            Manual
          </span>
        )}
      </div>

      {/* Dados */}
      <div className="p-5 space-y-3">
        {/* Razão Social */}
        <div className="flex items-start gap-2">
          <IdentificationCard
            size={16}
            className="text-[#000638]/60 mt-0.5 flex-shrink-0"
          />
          <div>
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">
              Razão Social
            </p>
            <p className="text-xs font-medium text-gray-800 leading-snug">
              {razaoSocial || '—'}
            </p>
            {fantasyName && fantasyName !== razaoSocial && (
              <p className="text-[10px] text-gray-500 mt-0.5">
                Nome fantasia: {fantasyName}
              </p>
            )}
          </div>
        </div>

        {/* CNPJ */}
        <div className="flex items-start gap-2">
          <Buildings
            size={16}
            className="text-[#000638]/60 mt-0.5 flex-shrink-0"
          />
          <div>
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">
              CNPJ
            </p>
            <p className="text-xs font-mono font-medium text-gray-800">
              {fmtCNPJ(cnpj)}
            </p>
          </div>
        </div>

        {/* Indicador de clique */}
        <div className="pt-1 border-t border-gray-100 flex items-center gap-1 text-[10px] text-gray-400 group-hover:text-[#000638] transition-colors">
          <Lightning size={11} />
          Clique para ver despesas fixas
        </div>
      </div>
    </button>
  );
};

const DespesaFilial = () => {
  const [filiais, setFiliais] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);
  const [filialSelecionada, setFilialSelecionada] = useState(null);

  useEffect(() => {
    const buscar = async () => {
      setLoading(true);
      setErro(null);
      try {
        const response = await fetch(`${API_BASE_URL}/api/totvs/branches`);
        if (!response.ok) throw new Error(`Erro HTTP ${response.status}`);
        const result = await response.json();

        let empresasArray = [];
        if (result.success && result.data) {
          if (result.data.data && Array.isArray(result.data.data)) {
            empresasArray = result.data.data;
          } else if (Array.isArray(result.data)) {
            empresasArray = result.data;
          }
        }

        // Montar as filiais cruzando com os dados da API
        const dados = FILIAIS_CROSBY.map((filial) => {
          if (filial.semTotvs) {
            return {
              cd: filial.cd,
              nome: filial.nome,
              cnpj: null,
              razaoSocial: null,
              fantasyName: null,
              grupoEmpresa: null,
              status: 'manual',
            };
          }
          const apiItem = empresasArray.find(
            (e) => String(e.cd_empresa) === String(filial.cd),
          );
          return {
            cd: filial.cd,
            nome: filial.nome,
            cnpj: apiItem?.cnpj ?? null,
            razaoSocial: apiItem?.personName ?? null,
            fantasyName: apiItem?.fantasyName ?? null,
            grupoEmpresa: apiItem?.nm_grupoempresa ?? null,
            status: apiItem ? 'ok' : 'sem-dados',
          };
        });

        setFiliais(dados);
      } catch (err) {
        setErro(err.message || 'Erro ao carregar dados das filiais.');
      } finally {
        setLoading(false);
      }
    };

    buscar();
  }, []);

  return (
    <div className="p-4 sm:p-6 bg-gray-50 min-h-screen">
      <PageTitle
        title="Controle de Filiais"
        subtitle="Visão consolidada das filiais CROSBY com dados cadastrais"
        icon={Buildings}
      />

      {erro && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          {erro}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading
          ? FILIAIS_CROSBY.map((f) => <CardSkeleton key={f.cd} />)
          : filiais.map((f) => (
              <FilialCard
                key={f.cd}
                filial={f}
                onClick={setFilialSelecionada}
              />
            ))}
      </div>

      {filialSelecionada && (
        <ModalDespesas
          filial={filialSelecionada}
          onClose={() => setFilialSelecionada(null)}
        />
      )}
    </div>
  );
};

export default DespesaFilial;
