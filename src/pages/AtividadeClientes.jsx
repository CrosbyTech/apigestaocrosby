import React, { useState, useMemo } from 'react';
import { API_BASE_URL } from '../config/constants';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/cards';
import PageTitle from '../components/ui/PageTitle';
import {
  MagnifyingGlass,
  FileArrowDown,
  Users,
  Warning,
  XCircle,
  CheckCircle,
  ShoppingBag,
  Storefront,
  Tag,
  Spinner,
} from '@phosphor-icons/react';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

const API_KEY = import.meta.env.VITE_API_KEY || '';
const jsonHeaders = {
  'Content-Type': 'application/json',
  'x-api-key': API_KEY,
};

// ===========================
// Regras de canal
// ===========================
const VAREJO_OPS_ARR = [
  545, 546, 9001, 9009, 510, 521, 511, 522, 9017, 9027, 1,
];
const VAREJO_OPS = new Set(VAREJO_OPS_ARR);
const VAREJO_EMPRESAS = [2, 5, 55, 65, 87, 88, 90, 93, 94, 95, 97, 98];
const VAREJO_EMPRESAS_SET = new Set(VAREJO_EMPRESAS);

const MULTIMARCAS_OPS_EXCLUSIVAS = new Set([200, 300]);
const REVENDA_OPS_EXCLUSIVAS = new Set([
  5202, 1407, 9120, 9121, 9113, 9111, 7806, 7809, 7236, 7242, 512,
]);
const B2B_OPS_ARR = [
  5102, 200, 300, 5202, 1407, 9120, 9121, 9113, 9111, 7806, 7809, 7236, 7242,
  512,
];
const EMPRESA_99 = 99;

const VENDEDORES_MULTIMARCAS = new Set([177, 65, 21, 26, 259, 69]);
const VENDEDORES_REVENDA = new Set([15, 161, 165, 102, 25, 251, 779]);

const NOMES_VENDEDORES = {
  15: 'Heyridan',
  161: 'Cleiton',
  165: 'Michel',
  241: 'Yago',
  25: 'Anderson',
  251: 'Filipe',
  779: 'Aldo',
  177: 'Walter',
  65: 'Renato',
  21: 'Rafael',
  26: 'David',
  259: 'Arthur',
  69: 'Thalis',
};

const VENDEDORES_POR_CANAL = {
  Multimarcas: [
    { id: 177, nome: 'Walter' },
    { id: 65, nome: 'Renato' },
    { id: 21, nome: 'Rafael' },
    { id: 26, nome: 'David' },
    { id: 259, nome: 'Arthur' },
    { id: 69, nome: 'Thalis' },
  ],
  Revenda: [
    { id: 15, nome: 'Heyridan' },
    { id: 161, nome: 'Cleiton' },
    { id: 165, nome: 'Michel' },
    { id: 241, nome: 'Yago' },
    { id: 25, nome: 'Anderson' },
    { id: 251, nome: 'Filipe' },
    { id: 779, nome: 'Aldo' },
  ],
};

// ===========================
// Helpers
// ===========================

// Extrai o código do vendedor: tenta múltiplos campos
function extrairVendedor(nf) {
  // 1. commissioning array (campo usado em B2B no TOTVS)
  const commissions = nf.commissioning ?? nf.commissions ?? [];
  if (Array.isArray(commissions) && commissions.length > 0) {
    const code = parseInt(
      commissions[0]?.personCode ?? commissions[0]?.sellerCode,
    );
    if (!isNaN(code)) return code;
  }
  // 2. sellerCode direto na NF
  if (nf.sellerCode != null) {
    const c = parseInt(nf.sellerCode);
    if (!isNaN(c)) return c;
  }
  // 3. userCode (PDV - menos confiável para B2B)
  return parseInt(nf.userCode);
}

function classificarNF(nf) {
  const rawOpCode = nf.operationCode ?? nf.operatioCode;
  const opCode = parseInt(rawOpCode);
  const branchCode = parseInt(nf.branchCode);
  if (isNaN(branchCode)) return null;

  if (VAREJO_EMPRESAS_SET.has(branchCode)) {
    // Se operationCodeList foi passado, todo item já é da op certa; se não, filtra
    if (isNaN(opCode) || VAREJO_OPS.has(opCode)) {
      return { canal: 'Varejo', vendedor: null };
    }
    return null;
  }

  if (branchCode === EMPRESA_99) {
    const vendedorCode = extrairVendedor(nf);
    const vendedorNome = NOMES_VENDEDORES[vendedorCode] ?? null;

    if (!isNaN(opCode)) {
      if (MULTIMARCAS_OPS_EXCLUSIVAS.has(opCode)) {
        return { canal: 'Multimarcas', vendedor: vendedorNome };
      }
      if (REVENDA_OPS_EXCLUSIVAS.has(opCode)) {
        return { canal: 'Revenda', vendedor: vendedorNome };
      }
      if (opCode === 5102) {
        if (VENDEDORES_MULTIMARCAS.has(vendedorCode))
          return { canal: 'Multimarcas', vendedor: vendedorNome };
        if (VENDEDORES_REVENDA.has(vendedorCode))
          return { canal: 'Revenda', vendedor: vendedorNome };
        // op ambígua sem vendedor conhecido: classifica pelo nome da operação se disponível
        const opNome = (
          nf.operatioName ??
          nf.operationName ??
          ''
        ).toLowerCase();
        if (opNome.includes('revenda'))
          return { canal: 'Revenda', vendedor: vendedorNome };
        if (opNome.includes('multimarcas') || opNome.includes('multi'))
          return { canal: 'Multimarcas', vendedor: vendedorNome };
        return null;
      }
    } else {
      // Sem operationCode: tenta classificar pelo vendedor
      if (VENDEDORES_MULTIMARCAS.has(vendedorCode))
        return { canal: 'Multimarcas', vendedor: vendedorNome };
      if (VENDEDORES_REVENDA.has(vendedorCode))
        return { canal: 'Revenda', vendedor: vendedorNome };
    }
  }

  return null;
}

function diffDias(dateStr) {
  if (!dateStr) return 9999;
  const [y, m, d] = String(dateStr).split('T')[0].split('-').map(Number);
  const data = new Date(y, m - 1, d);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.floor((hoje - data) / 86400000);
}

function calcularStatus(dias) {
  if (dias < 45) return 'Ativo';
  if (dias < 60) return 'A Inativar';
  return 'Inativo';
}

function formatDateBR(iso) {
  if (!iso) return '--';
  try {
    const [y, m, d] = String(iso).split('T')[0].split('-').map(Number);
    return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
  } catch {
    return '--';
  }
}

function formatBRL(v) {
  return Number(v || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function processarNFs(nfs) {
  // Debug: inspeciona os primeiros itens para checar campos
  if (nfs.length > 0) {
    const sample = nfs.slice(0, 3);
    console.log(
      '[AtividadeClientes] Amostra de NFs recebidas:',
      sample.map((n) => ({
        branchCode: n.branchCode,
        operationCode: n.operationCode,
        operatioName: n.operatioName,
        userCode: n.userCode,
        commissioning: n.commissioning,
        personCode: n.personCode,
      })),
    );
  }

  // Coleta todos os operationCodes distintos para diagnóstico
  const opCodesVisto = new Map();
  let semOpCode = 0;

  const map = new Map();
  for (const nf of nfs) {
    const rawOp = nf.operationCode ?? nf.operatioCode;
    if (rawOp == null) semOpCode++;
    else {
      const k = String(rawOp);
      opCodesVisto.set(k, (opCodesVisto.get(k) ?? 0) + 1);
    }

    const c = classificarNF(nf);
    if (!c || !nf.personCode) continue;
    const key = `${nf.personCode}|${c.canal}`;
    const issueDate = nf.issueDate ?? nf.invoiceDate ?? '';
    const valor = parseFloat(nf.totalValue) || 0;
    if (!map.has(key)) {
      map.set(key, {
        personCode: nf.personCode,
        personName: nf.personName ?? '--',
        canal: c.canal,
        vendedor: c.vendedor,
        ultimaCompra: issueDate,
        totalPeriodo: valor,
        qtdNFs: 1,
      });
    } else {
      const entry = map.get(key);
      entry.totalPeriodo += valor;
      entry.qtdNFs += 1;
      if (issueDate > entry.ultimaCompra) {
        entry.ultimaCompra = issueDate;
        entry.vendedor = c.vendedor ?? entry.vendedor;
      }
    }
  }

  if (nfs.length > 0) {
    console.log(
      `[AtividadeClientes] Classificação: ${nfs.length} NFs → ${map.size} clientes únicos | Sem operationCode: ${semOpCode} | Op codes distintos: ${[
        ...opCodesVisto.entries(),
      ]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([k, v]) => `${k}(${v})`)
        .join(', ')}`,
    );
  }

  return {
    clientes: [...map.values()].map((c) => ({
      ...c,
      diasSemCompra: diffDias(c.ultimaCompra),
      status: calcularStatus(diffDias(c.ultimaCompra)),
    })),
    debug: {
      totalNFs: nfs.length,
      totalClassificados: map.size,
      semOpCode,
      opCodes: [...opCodesVisto.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map(([k, v]) => `${k}(${v})`),
    },
  };
}

const ORDER_STATUS = { 'A Inativar': 0, Inativo: 1, Ativo: 2 };
function ordenarClientes(lista) {
  return [...lista].sort((a, b) => {
    const diff = ORDER_STATUS[a.status] - ORDER_STATUS[b.status];
    return diff !== 0 ? diff : b.diasSemCompra - a.diasSemCompra;
  });
}

// ===========================
// Sub-components
// ===========================
const StatusBadge = ({ status }) => {
  const cfg = {
    Ativo: 'bg-green-100 text-green-700 border-green-300',
    'A Inativar': 'bg-yellow-100 text-yellow-700 border-yellow-300',
    Inativo: 'bg-red-100 text-red-700 border-red-300',
  }[status];
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cfg}`}
    >
      {status}
    </span>
  );
};

const CanalBadge = ({ canal }) => {
  const cfg = {
    Varejo: 'bg-blue-100 text-blue-700',
    Multimarcas: 'bg-purple-100 text-purple-700',
    Revenda: 'bg-orange-100 text-orange-700',
  }[canal];
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${cfg}`}
    >
      {canal}
    </span>
  );
};

const DiasCell = ({ dias }) => (
  <span
    className={`font-bold ${dias >= 60 ? 'text-red-600' : dias >= 45 ? 'text-yellow-600' : 'text-green-600'}`}
  >
    {dias}
  </span>
);

function VendedorCard({ nome, clientes, selecionado, onClick }) {
  const ativo = clientes.filter((c) => c.status === 'Ativo').length;
  const aInativar = clientes.filter((c) => c.status === 'A Inativar').length;
  const inativo = clientes.filter((c) => c.status === 'Inativo').length;
  const total = clientes.length;
  return (
    <button
      onClick={onClick}
      className={`text-left p-3 rounded-xl border-2 transition-all ${
        selecionado
          ? 'border-[#000638] bg-[#000638]/5 shadow-md'
          : 'border-gray-200 bg-white hover:border-[#000638]/40 hover:shadow'
      }`}
    >
      <div className="font-semibold text-[#000638] text-sm mb-1">{nome}</div>
      <div className="text-xs text-gray-400 mb-2">
        {total} cliente{total !== 1 ? 's' : ''}
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {ativo > 0 && (
          <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-semibold">
            {ativo} ativo{ativo !== 1 ? 's' : ''}
          </span>
        )}
        {aInativar > 0 && (
          <span className="text-[10px] bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded font-semibold">
            {aInativar} a inativar
          </span>
        )}
        {inativo > 0 && (
          <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-semibold">
            {inativo} inativo{inativo !== 1 ? 's' : ''}
          </span>
        )}
      </div>
    </button>
  );
}

function TabelaClientes({ lista, mostrarCanal = false }) {
  const [paginaAtual, setPaginaAtual] = useState(1);
  const ITENS = 50;
  const totalPages = Math.ceil(lista.length / ITENS);
  const paginados = lista.slice((paginaAtual - 1) * ITENS, paginaAtual * ITENS);

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-[#000638] text-white">
              {mostrarCanal && (
                <th className="px-3 py-2 text-left whitespace-nowrap">Canal</th>
              )}
              <th className="px-3 py-2 text-left whitespace-nowrap">Cod.</th>
              <th className="px-3 py-2 text-left whitespace-nowrap">Cliente</th>
              <th className="px-3 py-2 text-left whitespace-nowrap">
                Vendedor
              </th>
              <th className="px-3 py-2 text-center whitespace-nowrap">
                Ultima Compra
              </th>
              <th className="px-3 py-2 text-center whitespace-nowrap">Dias</th>
              <th className="px-3 py-2 text-center whitespace-nowrap">
                Status
              </th>
              <th className="px-3 py-2 text-right whitespace-nowrap">
                Total Periodo
              </th>
              <th className="px-3 py-2 text-center whitespace-nowrap">NFs</th>
            </tr>
          </thead>
          <tbody>
            {paginados.map((c, i) => (
              <tr
                key={`${c.personCode}-${c.canal}`}
                className={
                  i % 2 === 0
                    ? 'bg-white hover:bg-gray-50'
                    : 'bg-gray-50 hover:bg-gray-100'
                }
              >
                {mostrarCanal && (
                  <td className="px-3 py-2">
                    <CanalBadge canal={c.canal} />
                  </td>
                )}
                <td className="px-3 py-2 text-gray-500 font-mono">
                  {c.personCode}
                </td>
                <td className="px-3 py-2 font-medium text-gray-800 max-w-[200px] truncate">
                  {c.personName}
                </td>
                <td className="px-3 py-2 text-gray-600">
                  {c.vendedor ?? <span className="text-gray-300">--</span>}
                </td>
                <td className="px-3 py-2 text-center text-gray-600">
                  {formatDateBR(c.ultimaCompra)}
                </td>
                <td className="px-3 py-2 text-center">
                  <DiasCell dias={c.diasSemCompra} />
                </td>
                <td className="px-3 py-2 text-center">
                  <StatusBadge status={c.status} />
                </td>
                <td className="px-3 py-2 text-right font-medium text-gray-700">
                  {formatBRL(c.totalPeriodo)}
                </td>
                <td className="px-3 py-2 text-center text-gray-500">
                  {c.qtdNFs}
                </td>
              </tr>
            ))}
            {paginados.length === 0 && (
              <tr>
                <td
                  colSpan={mostrarCanal ? 9 : 8}
                  className="px-3 py-8 text-center text-gray-400"
                >
                  Nenhum cliente encontrado
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
          <span className="text-xs text-gray-400">
            Pagina {paginaAtual} de {totalPages} - {lista.length} registros
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPaginaAtual((p) => Math.max(p - 1, 1))}
              disabled={paginaAtual === 1}
              className="px-3 py-1 rounded text-xs bg-[#000638]/10 text-[#000638] hover:bg-[#000638]/20 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Anterior
            </button>
            <button
              onClick={() => setPaginaAtual((p) => Math.min(p + 1, totalPages))}
              disabled={paginaAtual === totalPages}
              className="px-3 py-1 rounded text-xs bg-[#000638]/10 text-[#000638] hover:bg-[#000638]/20 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Proximo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ===========================
// Pagina principal
// ===========================
const TABS = [
  { id: 'geral', label: 'Geral', icon: Users },
  { id: 'varejo', label: 'Varejo', icon: Storefront },
  { id: 'multimarcas', label: 'Multimarcas', icon: ShoppingBag },
  { id: 'revenda', label: 'Revenda', icon: Tag },
];

const AtividadeClientes = () => {
  const hoje = new Date();
  const defaultFim = hoje.toISOString().split('T')[0];
  const defaultInicio = new Date(
    hoje.getFullYear(),
    hoje.getMonth() - 6,
    hoje.getDate(),
  )
    .toISOString()
    .split('T')[0];

  const [dtInicio, setDtInicio] = useState(defaultInicio);
  const [dtFim, setDtFim] = useState(defaultFim);
  const [clientes, setClientes] = useState([]);
  const [progresso, setProgresso] = useState({ varejo: 'idle', b2b: 'idle' });
  const [erro, setErro] = useState('');
  const [debugInfo, setDebugInfo] = useState(null);

  const [abaAtiva, setAbaAtiva] = useState('geral');
  const [vendedorFiltro, setVendedorFiltro] = useState(null);

  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('Todos');

  const loading = progresso.varejo === 'loading' || progresso.b2b === 'loading';

  const buscarDados = async () => {
    if (!dtInicio || !dtFim) {
      setErro('Selecione o periodo.');
      return;
    }
    setErro('');
    setClientes([]);
    setDebugInfo(null);
    setBusca('');
    setFiltroStatus('Todos');
    setVendedorFiltro(null);
    setAbaAtiva('geral');
    setProgresso({ varejo: 'loading', b2b: 'loading' });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20 * 60 * 1000);

    const fetchCanal = async (branchList, opList) => {
      const res = await fetch(`${API_BASE_URL}/api/totvs/fiscal-nf-search`, {
        method: 'POST',
        headers: jsonHeaders,
        signal: controller.signal,
        body: JSON.stringify({
          branchCodeList: branchList,
          operationCodeList: opList,
          startIssueDate: `${dtInicio}T00:00:00`,
          endIssueDate: `${dtFim}T23:59:59`,
          pageSize: 100,
          order: 'issueDate:desc',
          fetchAll: true,
        }),
      });
      const result = await res.json();
      if (!result.success) throw new Error(result.message || 'Erro na API');
      return result.data?.items ?? result.data?.data ?? [];
    };

    try {
      const [nfsVarejo, nfsB2B] = await Promise.all([
        fetchCanal(VAREJO_EMPRESAS, VAREJO_OPS_ARR)
          .then((items) => {
            setProgresso((p) => ({ ...p, varejo: 'done' }));
            return items;
          })
          .catch((err) => {
            setProgresso((p) => ({ ...p, varejo: 'error' }));
            throw err;
          }),
        fetchCanal([EMPRESA_99], B2B_OPS_ARR)
          .then((items) => {
            setProgresso((p) => ({ ...p, b2b: 'done' }));
            return items;
          })
          .catch((err) => {
            setProgresso((p) => ({ ...p, b2b: 'error' }));
            throw err;
          }),
      ]);

      clearTimeout(timeoutId);
      const { clientes: clientesProcessados, debug } = processarNFs([
        ...nfsVarejo,
        ...nfsB2B,
      ]);
      setDebugInfo({ ...debug, varejo: nfsVarejo.length, b2b: nfsB2B.length });
      const lista = ordenarClientes(clientesProcessados);
      setClientes(lista);
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        setErro('Tempo limite excedido. Tente um periodo menor.');
      } else {
        console.error('Erro ao buscar atividade de clientes:', err);
        setErro('Nao foi possivel conectar a API.');
      }
      setProgresso({ varejo: 'idle', b2b: 'idle' });
    }
  };

  const porCanal = useMemo(
    () => ({
      Varejo: clientes.filter((c) => c.canal === 'Varejo'),
      Multimarcas: clientes.filter((c) => c.canal === 'Multimarcas'),
      Revenda: clientes.filter((c) => c.canal === 'Revenda'),
    }),
    [clientes],
  );

  const resumo = useMemo(() => {
    const r = { total: 0, ativo: 0, aInativar: 0, inativo: 0 };
    for (const c of clientes) {
      r.total++;
      if (c.status === 'Ativo') r.ativo++;
      else if (c.status === 'A Inativar') r.aInativar++;
      else r.inativo++;
    }
    return r;
  }, [clientes]);

  const clientesGeral = useMemo(() => {
    return clientes.filter((c) => {
      if (filtroStatus !== 'Todos' && c.status !== filtroStatus) return false;
      if (busca) {
        const q = busca.toLowerCase();
        if (
          !String(c.personCode).includes(q) &&
          !c.personName.toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [clientes, filtroStatus, busca]);

  const clientesB2BFiltrados = useMemo(() => {
    const canal = abaAtiva === 'multimarcas' ? 'Multimarcas' : 'Revenda';
    const lista = porCanal[canal] ?? [];
    if (!vendedorFiltro) return lista;
    if (vendedorFiltro === '__sem__') return lista.filter((c) => !c.vendedor);
    return lista.filter((c) => c.vendedor === vendedorFiltro);
  }, [abaAtiva, porCanal, vendedorFiltro]);

  const handleExport = () => {
    const fonte =
      abaAtiva === 'geral'
        ? clientesGeral
        : abaAtiva === 'varejo'
          ? porCanal.Varejo
          : clientesB2BFiltrados;
    if (fonte.length === 0) return;
    const rows = fonte.map((c) => ({
      Canal: c.canal,
      'Cod. Cliente': c.personCode,
      'Nome Cliente': c.personName,
      Vendedor: c.vendedor ?? '--',
      'Ultima Compra': formatDateBR(c.ultimaCompra),
      'Dias sem Compra': c.diasSemCompra,
      Status: c.status,
      'Total no Periodo': c.totalPeriodo,
      'Qtd NFs': c.qtdNFs,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Atividade Clientes');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(
      new Blob([buf], { type: 'application/octet-stream' }),
      'atividade_clientes.xlsx',
    );
  };

  const handleAba = (id) => {
    setAbaAtiva(id);
    setVendedorFiltro(null);
  };

  const hasData = clientes.length > 0;

  return (
    <div className="w-full max-w-7xl mx-auto p-4 space-y-4">
      <PageTitle title="Atividade de Clientes por Canal" />

      <Card className="shadow-lg rounded-xl">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <MagnifyingGlass
              size={22}
              weight="bold"
              className="text-[#000638]"
            />
            <div>
              <CardTitle className="text-[#000638] text-lg">
                Buscar Atividade
              </CardTitle>
              <CardDescription>
                Classifica clientes por canal com base nas operacoes de venda.
                Varejo e Empresa 99 sao buscados em paralelo.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">
                Data Inicio
              </label>
              <input
                type="date"
                value={dtInicio}
                onChange={(e) => setDtInicio(e.target.value)}
                className="w-full border border-[#000638]/30 rounded-lg bg-[#f8f9fb] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#000638]/20"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">
                Data Fim
              </label>
              <input
                type="date"
                value={dtFim}
                onChange={(e) => setDtFim(e.target.value)}
                className="w-full border border-[#000638]/30 rounded-lg bg-[#f8f9fb] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#000638]/20"
              />
            </div>
            <div className="flex items-end gap-2">
              <button
                onClick={buscarDados}
                disabled={loading}
                className="flex-1 bg-[#000638] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#fe0000] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Buscando...' : 'Buscar'}
              </button>
              {hasData && (
                <button
                  onClick={handleExport}
                  title="Exportar Excel"
                  className="bg-green-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition-colors flex items-center gap-1"
                >
                  <FileArrowDown size={16} weight="bold" />
                </button>
              )}
            </div>
          </div>

          {erro && <p className="text-red-600 text-sm mt-2">{erro}</p>}

          {(loading ||
            (progresso.varejo !== 'idle' && progresso.varejo !== 'idle')) && (
            <div className="mt-3 flex flex-wrap gap-3">
              {[
                { key: 'varejo', label: 'Varejo (12 empresas)', color: 'blue' },
                {
                  key: 'b2b',
                  label: 'Multimarcas / Revenda (Emp. 99)',
                  color: 'purple',
                },
              ].map(({ key, label, color }) => {
                const st = progresso[key];
                if (st === 'idle') return null;
                const base =
                  color === 'blue'
                    ? {
                        loading: 'text-blue-600 border-blue-200 bg-blue-50',
                        done: 'text-blue-700 border-blue-300 bg-blue-100',
                        error: 'text-red-600 border-red-200 bg-red-50',
                      }
                    : {
                        loading:
                          'text-purple-600 border-purple-200 bg-purple-50',
                        done: 'text-purple-700 border-purple-300 bg-purple-100',
                        error: 'text-red-600 border-red-200 bg-red-50',
                      };
                const cls =
                  base[st] ?? 'text-gray-400 border-gray-200 bg-gray-50';
                return (
                  <div
                    key={key}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium ${cls}`}
                  >
                    {st === 'loading' && (
                      <Spinner size={12} className="animate-spin" />
                    )}
                    {st === 'done' && <CheckCircle size={12} weight="fill" />}
                    {st === 'error' && <XCircle size={12} weight="fill" />}
                    {label}
                    {st === 'loading' && ' — buscando...'}
                    {st === 'done' && ' — concluido'}
                    {st === 'error' && ' — erro'}
                  </div>
                );
              })}
            </div>
          )}
          {debugInfo && !loading && (
            <div className="mt-3 p-3 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-500 font-mono space-y-1">
              <div className="font-semibold text-gray-600">
                Diagnostico da ultima busca
              </div>
              <div>
                NFs recebidas:{' '}
                <span className="text-gray-800">{debugInfo.totalNFs}</span> (
                {debugInfo.varejo} varejo + {debugInfo.b2b} B2B) &rarr;{' '}
                <span className="text-[#000638] font-semibold">
                  {debugInfo.totalClassificados} clientes classificados
                </span>
              </div>
              {debugInfo.semOpCode > 0 && (
                <div className="text-yellow-600">
                  Atencao: {debugInfo.semOpCode} NFs sem operationCode
                  (ignoradas na classificacao de empresa 99)
                </div>
              )}
              {debugInfo.opCodes?.length > 0 && (
                <div className="text-gray-400 break-all">
                  Op codes: {debugInfo.opCodes.join(', ')}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {!hasData && !loading && !erro && (
        <div className="text-center py-16 text-gray-400 text-sm">
          <Users size={40} className="mx-auto mb-2 opacity-30" />
          Selecione um periodo e clique em{' '}
          <strong className="text-gray-500">Buscar</strong>
        </div>
      )}

      {hasData && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="rounded-xl">
              <CardContent className="p-4 flex items-center gap-3">
                <Users size={28} weight="duotone" className="text-[#000638]" />
                <div>
                  <div className="text-2xl font-bold text-[#000638]">
                    {resumo.total}
                  </div>
                  <div className="text-xs text-gray-500">Total Clientes</div>
                </div>
              </CardContent>
            </Card>
            <Card className="rounded-xl border-green-200">
              <CardContent className="p-4 flex items-center gap-3">
                <CheckCircle
                  size={28}
                  weight="duotone"
                  className="text-green-500"
                />
                <div>
                  <div className="text-2xl font-bold text-green-600">
                    {resumo.ativo}
                  </div>
                  <div className="text-xs text-gray-500">
                    Ativos <span className="text-gray-400">(&lt; 45d)</span>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="rounded-xl border-yellow-200">
              <CardContent className="p-4 flex items-center gap-3">
                <Warning
                  size={28}
                  weight="duotone"
                  className="text-yellow-500"
                />
                <div>
                  <div className="text-2xl font-bold text-yellow-600">
                    {resumo.aInativar}
                  </div>
                  <div className="text-xs text-gray-500">
                    A Inativar <span className="text-gray-400">(45-60d)</span>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="rounded-xl border-red-200">
              <CardContent className="p-4 flex items-center gap-3">
                <XCircle size={28} weight="duotone" className="text-red-500" />
                <div>
                  <div className="text-2xl font-bold text-red-600">
                    {resumo.inativo}
                  </div>
                  <div className="text-xs text-gray-500">
                    Inativos <span className="text-gray-400">(&gt; 60d)</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="flex gap-1 border-b border-gray-200">
            {TABS.map(({ id, label, icon: Icon }) => {
              const count =
                id === 'geral'
                  ? resumo.total
                  : id === 'varejo'
                    ? porCanal.Varejo.length
                    : id === 'multimarcas'
                      ? porCanal.Multimarcas.length
                      : porCanal.Revenda.length;
              return (
                <button
                  key={id}
                  onClick={() => handleAba(id)}
                  className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                    abaAtiva === id
                      ? 'border-[#000638] text-[#000638]'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <Icon
                    size={15}
                    weight={abaAtiva === id ? 'bold' : 'regular'}
                  />
                  {label}
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded-full ${
                      abaAtiva === id
                        ? 'bg-[#000638] text-white'
                        : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {abaAtiva === 'geral' && (
            <Card className="shadow-lg rounded-xl">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <input
                    type="text"
                    placeholder="Buscar por nome ou codigo..."
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    className="border border-[#000638]/30 rounded-lg bg-[#f8f9fb] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#000638]/20 w-60"
                  />
                  <select
                    value={filtroStatus}
                    onChange={(e) => setFiltroStatus(e.target.value)}
                    className="border border-[#000638]/30 rounded-lg bg-[#f8f9fb] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#000638]/20"
                  >
                    <option>Todos</option>
                    <option>Ativo</option>
                    <option>A Inativar</option>
                    <option>Inativo</option>
                  </select>
                  <span className="text-xs text-gray-400 ml-auto">
                    {clientesGeral.length} registros
                  </span>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <TabelaClientes lista={clientesGeral} mostrarCanal />
              </CardContent>
            </Card>
          )}

          {abaAtiva === 'varejo' && (
            <Card className="shadow-lg rounded-xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-[#000638] flex items-center gap-2">
                  <Storefront size={16} weight="bold" />
                  Clientes Varejo - {porCanal.Varejo.length} registro
                  {porCanal.Varejo.length !== 1 ? 's' : ''}
                </CardTitle>
                <CardDescription className="text-xs">
                  Empresas: 2, 5, 55, 65, 87, 88, 90, 93, 94, 95, 97, 98
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <TabelaClientes lista={porCanal.Varejo} />
              </CardContent>
            </Card>
          )}

          {(abaAtiva === 'multimarcas' || abaAtiva === 'revenda') &&
            (() => {
              const canalNome =
                abaAtiva === 'multimarcas' ? 'Multimarcas' : 'Revenda';
              const Icon = abaAtiva === 'multimarcas' ? ShoppingBag : Tag;
              const vendedores = VENDEDORES_POR_CANAL[canalNome];
              const listaCanal = porCanal[canalNome];
              const semVendedor = listaCanal.filter((c) => !c.vendedor);
              return (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 px-1">
                      Vendedores - clique para filtrar
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2">
                      {vendedores.map(({ nome }) => {
                        const clientesVendedor = listaCanal.filter(
                          (c) => c.vendedor === nome,
                        );
                        return (
                          <VendedorCard
                            key={nome}
                            nome={nome}
                            clientes={clientesVendedor}
                            selecionado={vendedorFiltro === nome}
                            onClick={() =>
                              setVendedorFiltro(
                                vendedorFiltro === nome ? null : nome,
                              )
                            }
                          />
                        );
                      })}
                      {semVendedor.length > 0 && (
                        <VendedorCard
                          key="__sem__"
                          nome="Sem vendedor"
                          clientes={semVendedor}
                          selecionado={vendedorFiltro === '__sem__'}
                          onClick={() =>
                            setVendedorFiltro(
                              vendedorFiltro === '__sem__' ? null : '__sem__',
                            )
                          }
                        />
                      )}
                    </div>
                    {vendedorFiltro && (
                      <button
                        onClick={() => setVendedorFiltro(null)}
                        className="mt-2 text-xs text-[#000638] hover:underline"
                      >
                        x Limpar filtro de vendedor
                      </button>
                    )}
                  </div>

                  <Card className="shadow-lg rounded-xl">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-[#000638] flex items-center gap-2">
                        <Icon size={16} weight="bold" />
                        {canalNome}
                        {vendedorFiltro
                          ? ` - ${vendedorFiltro === '__sem__' ? 'Sem vendedor' : vendedorFiltro}`
                          : ' - Todos os vendedores'}
                        <span className="text-gray-400 font-normal ml-1">
                          ({clientesB2BFiltrados.length} registros)
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <TabelaClientes lista={clientesB2BFiltrados} />
                    </CardContent>
                  </Card>
                </div>
              );
            })()}
        </>
      )}
    </div>
  );
};

export default AtividadeClientes;
