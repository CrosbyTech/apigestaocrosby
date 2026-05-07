import React, { useEffect, useState, useMemo, useCallback } from 'react';
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
  Article,
  Funnel,
  MagnifyingGlass,
  FileArrowDown,
  CaretLeft,
  CaretRight,
  CaretUp,
  CaretDown,
  CaretUpDown,
  FloppyDisk,
  CheckCircle,
} from '@phosphor-icons/react';
import FiltroEmpresa from '../components/FiltroEmpresa';

const API_KEY = import.meta.env.VITE_API_KEY || '';

const jsonHeaders = {
  'Content-Type': 'application/json',
  'x-api-key': API_KEY,
};

const formatDateBR = (isoDate) => {
  if (!isoDate) return '--';
  try {
    const [datePart] = String(isoDate).split('T');
    const [y, m, d] = datePart.split('-').map(Number);
    if (!y || !m || !d) return '--';
    return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
  } catch {
    return '--';
  }
};

const formatCurrency = (value) => {
  if (value == null || value === '') return '--';
  return Number(value).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
};

const ConsultaNFs = () => {
  const [filiaisSelecionadas, setFiliaisSelecionadas] = useState([]);
  const [periodo, setPeriodo] = useState({ dt_inicio: '', dt_fim: '' });
  const [dados, setDados] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dadosCarregados, setDadosCarregados] = useState(false);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [salvoInfo, setSalvoInfo] = useState(null); // { saved, total }
  const [progressoSalvo, setProgressoSalvo] = useState(null); // { lote, totalLotes }

  // Paginação
  const [paginaAtual, setPaginaAtual] = useState(1);
  const ITENS_POR_PAGINA = 25;

  // Ordenação
  const [ordenacao, setOrdenacao] = useState({ campo: null, direcao: 'asc' });

  // Filtro de operação (local, aplicado após busca)
  const [operacaoSelecionada, setOperacaoSelecionada] = useState('');

  // Progresso de busca (SSE — mês a mês)
  const [progressoBusca, setProgressoBusca] = useState(null);

  // Período padrão: mês atual
  useEffect(() => {
    const hoje = new Date();
    const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1)
      .toISOString()
      .split('T')[0];
    const fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0)
      .toISOString()
      .split('T')[0];
    setPeriodo({ dt_inicio: inicio, dt_fim: fim });
  }, []);

  const buscarDados = async () => {
    if (!periodo.dt_inicio || !periodo.dt_fim) {
      setErro('Selecione o período inicial e final.');
      return;
    }
    if (filiaisSelecionadas.length === 0) {
      setErro('Selecione pelo menos uma filial.');
      return;
    }
    setErro('');
    setLoading(true);
    setPaginaAtual(1);
    setDados([]);
    setDadosCarregados(false);
    setSalvoInfo(null);
    setProgressoBusca(null);

    const codigos = filiaisSelecionadas
      .map((f) =>
        typeof f === 'object'
          ? parseInt(f.cd_empresa ?? f.branchCode ?? f.code)
          : parseInt(f),
      )
      .filter((n) => !isNaN(n));

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15 * 60 * 1000);

      const res = await fetch(`${API_BASE_URL}/api/totvs/fiscal-nf-search`, {
        method: 'POST',
        headers: jsonHeaders,
        signal: controller.signal,
        body: JSON.stringify({
          branchCodeList: codigos,
          startIssueDate: `${periodo.dt_inicio}T00:00:00`,
          endIssueDate: `${periodo.dt_fim}T23:59:59`,
          expand: 'items',
          pageSize: 100,
          order: 'issueDate:desc',
        }),
      });

      clearTimeout(timeoutId);

      const result = await res.json();
      if (!result.success) {
        setErro(result.message || 'Erro ao buscar notas fiscais.');
        return;
      }
      const items = result.data?.items ?? result.data?.data ?? [];
      setDados(items);
      setDadosCarregados(true);
    } catch (err) {
      if (err.name === 'AbortError') {
        setErro('Tempo limite excedido. Tente um período menor.');
      } else {
        console.error('Erro ao buscar NFs:', err);
        setErro('Não foi possível conectar à API.');
      }
    } finally {
      setLoading(false);
      setProgressoBusca(null);
    }
  };

  const handleSort = useCallback((campo) => {
    setOrdenacao((prev) => ({
      campo,
      direcao: prev.campo === campo && prev.direcao === 'asc' ? 'desc' : 'asc',
    }));
    setPaginaAtual(1);
  }, []);

  const getSortIcon = (campo) => {
    if (ordenacao.campo !== campo)
      return <CaretUpDown size={12} className="opacity-40" />;
    return ordenacao.direcao === 'asc' ? (
      <CaretUp size={12} />
    ) : (
      <CaretDown size={12} />
    );
  };

  // Extrair lista de operações únicas dos dados
  const operacoesDisponiveis = useMemo(() => {
    const ops = new Set();
    dados.forEach((d) => {
      const op = d.operatioName ?? d.operationName;
      if (op) ops.add(op);
    });
    return [...ops].sort();
  }, [dados]);

  // Filtrar dados por operação selecionada
  const dadosFiltrados = useMemo(() => {
    if (!operacaoSelecionada) return dados;
    return dados.filter(
      (d) => (d.operatioName ?? d.operationName) === operacaoSelecionada,
    );
  }, [dados, operacaoSelecionada]);

  const dadosOrdenados = useMemo(() => {
    if (!ordenacao.campo) return dadosFiltrados;
    return [...dadosFiltrados].sort((a, b) => {
      let vA = a[ordenacao.campo];
      let vB = b[ordenacao.campo];
      const numCols = [
        'totalValue',
        'productValue',
        'branchCode',
        'personCode',
        'invoiceCode',
      ];
      if (numCols.includes(ordenacao.campo)) {
        vA = parseFloat(vA) || 0;
        vB = parseFloat(vB) || 0;
      } else if (typeof vA === 'string') {
        vA = vA.toLowerCase();
        vB = (vB || '').toLowerCase();
      }
      if (vA < vB) return ordenacao.direcao === 'asc' ? -1 : 1;
      if (vA > vB) return ordenacao.direcao === 'asc' ? 1 : -1;
      return 0;
    });
  }, [dadosFiltrados, ordenacao]);

  const totalPages = Math.ceil(dadosOrdenados.length / ITENS_POR_PAGINA);
  const dadosPaginados = useMemo(() => {
    const start = (paginaAtual - 1) * ITENS_POR_PAGINA;
    return dadosOrdenados.slice(start, start + ITENS_POR_PAGINA);
  }, [dadosOrdenados, paginaAtual]);

  const totalValor = useMemo(
    () =>
      dadosFiltrados.reduce(
        (acc, d) => acc + (parseFloat(d.totalValue) || 0),
        0,
      ),
    [dadosFiltrados],
  );

  const handleSalvarBanco = async () => {
    if (dados.length === 0) return;
    setSalvando(true);
    setSalvoInfo(null);
    setProgressoSalvo(null);
    setErro('');
    try {
      const BATCH_SIZE = 500;
      let totalSaved = 0;
      let totalDuplicatesRemoved = 0;
      const totalLotes = Math.ceil(dados.length / BATCH_SIZE);

      for (let i = 0; i < dados.length; i += BATCH_SIZE) {
        const loteAtual = Math.floor(i / BATCH_SIZE) + 1;
        setProgressoSalvo({ lote: loteAtual, totalLotes });

        const batch = dados.slice(i, i + BATCH_SIZE);
        const res = await fetch(`${API_BASE_URL}/api/totvs/fiscal-nf-save`, {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify({ items: batch }),
        });
        const result = await res.json();
        if (!result.success) {
          setErro(result.message || `Erro ao salvar lote ${loteAtual}.`);
          return;
        }
        totalSaved += result.data?.saved ?? batch.length;
        totalDuplicatesRemoved += result.data?.duplicatesRemoved ?? 0;
      }

      setSalvoInfo({
        saved: totalSaved,
        total: dados.length,
        duplicatesRemoved: totalDuplicatesRemoved,
      });
    } catch (err) {
      console.error('Erro ao salvar NFs:', err);
      setErro('Não foi possível conectar à API para salvar.');
    } finally {
      setSalvando(false);
      setProgressoSalvo(null);
    }
  };

  const handleExportExcel = useCallback(async () => {
    if (dados.length === 0) return;
    const [{ default: XLSX }, { saveAs }] = await Promise.all([
      import('xlsx'),
      import('file-saver'),
    ]);
    const rows = dados.map((d) => ({
      Filial: d.branchCode ?? '',
      CNPJ: d.branchCnpj ?? '',
      'Data Emissão': formatDateBR(d.issueDate ?? d.invoiceDate),
      'Nº NF': d.invoiceCode ?? '',
      Série: d.serialCode ?? '',
      'Nº Transação': d.transactionCode ?? '',
      'Cód. Pessoa': d.personCode ?? '',
      Cliente: d.personName ?? '',
      Operação: d.operatioName ?? d.operationName ?? '',
      Status: d.invoiceStatus ?? '',
      'Valor Total': d.totalValue ?? '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'NFs');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(
      new Blob([buf], { type: 'application/octet-stream' }),
      'consulta_nfs.xlsx',
    );
  }, [dados]);

  const colunas = [
    { key: 'branchCode', label: 'Filial' },
    { key: 'issueDate', label: 'Data Emissão' },
    { key: 'invoiceCode', label: 'Nº NF' },
    { key: 'serialCode', label: 'Série' },
    { key: 'transactionCode', label: 'Transação' },
    { key: 'personCode', label: 'Cód. Pessoa' },
    { key: 'personName', label: 'Cliente / Fornecedor' },
    { key: 'operatioName', label: 'Operação' },
    { key: 'invoiceStatus', label: 'Status' },
    { key: 'totalValue', label: 'Valor Total' },
  ];

  return (
    <div className="w-full max-w-7xl mx-auto p-4">
      <PageTitle
        icon={Article}
        title="Consulta de Notas Fiscais"
        subtitle="Busca por filial e período — todas as operações"
      />

      {/* Filtros */}
      <Card className="shadow-lg rounded-xl bg-white mb-6">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <MagnifyingGlass size={18} className="text-[#000638]" />
            <CardTitle className="text-sm font-bold text-[#000638]">
              Filtros
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="pt-0 px-4 pb-4">
          <CardDescription className="text-xs text-gray-500 mb-4">
            Selecione as empresas, período e clique em &quot;Buscar&quot;
          </CardDescription>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <div className="lg:col-span-2">
              <FiltroEmpresa
                empresasSelecionadas={filiaisSelecionadas}
                onSelectEmpresas={setFiliaisSelecionadas}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Data Início
              </label>
              <input
                type="date"
                value={periodo.dt_inicio}
                onChange={(e) =>
                  setPeriodo((p) => ({ ...p, dt_inicio: e.target.value }))
                }
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Data Fim
              </label>
              <input
                type="date"
                value={periodo.dt_fim}
                onChange={(e) =>
                  setPeriodo((p) => ({ ...p, dt_fim: e.target.value }))
                }
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
              />
            </div>
            {dadosCarregados && operacoesDisponiveis.length > 0 && (
              <div className="lg:col-span-2">
                <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                  Operação
                </label>
                <select
                  value={operacaoSelecionada}
                  onChange={(e) => {
                    setOperacaoSelecionada(e.target.value);
                    setPaginaAtual(1);
                  }}
                  className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
                >
                  <option value="">Todas as operações ({dados.length})</option>
                  {operacoesDisponiveis.map((op) => (
                    <option key={op} value={op}>
                      {op}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-4">
            <button
              onClick={buscarDados}
              disabled={loading}
              className="flex gap-1 items-center bg-[#000638] text-white px-4 py-1.5 rounded-lg hover:bg-[#fe0000] disabled:opacity-50 disabled:cursor-not-allowed transition-colors h-8 text-xs font-bold shadow-md tracking-wide uppercase"
            >
              {loading ? (
                <span className="w-3 h-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <Funnel size={14} />
              )}
              {loading
                ? progressoBusca
                  ? `Mês ${progressoBusca.atual}/${progressoBusca.total}`
                  : 'Buscando...'
                : 'Buscar'}
            </button>
            {progressoBusca && (
              <span className="text-xs text-[#000638] font-medium animate-pulse">
                Buscando {progressoBusca.mes}... ({progressoBusca.atual}/
                {progressoBusca.total})
                {dados.length > 0 &&
                  ` — ${dados.length.toLocaleString('pt-BR')} notas`}
              </span>
            )}
            {dadosCarregados && dados.length > 0 && (
              <>
                <button
                  onClick={handleExportExcel}
                  className="flex items-center gap-1 border border-[#000638]/30 text-[#000638] px-4 py-1.5 rounded-lg text-xs font-bold hover:bg-[#000638]/5 transition-colors h-8"
                >
                  <FileArrowDown size={14} />
                  Exportar Excel
                </button>
                <button
                  onClick={handleSalvarBanco}
                  disabled={salvando}
                  className="flex items-center gap-1 border border-[#000638]/30 text-[#000638] px-4 py-1.5 rounded-lg text-xs font-bold hover:bg-[#000638]/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors h-8"
                >
                  {salvando ? (
                    <span className="w-3 h-3 animate-spin rounded-full border-2 border-[#000638] border-t-transparent" />
                  ) : (
                    <FloppyDisk size={14} />
                  )}
                  {salvando
                    ? progressoSalvo
                      ? `Lote ${progressoSalvo.lote}/${progressoSalvo.totalLotes}...`
                      : 'Salvando...'
                    : 'Salvar no Banco'}
                </button>
                {salvando && progressoSalvo && (
                  <span className="text-xs text-[#000638] font-medium">
                    {Math.round(
                      (progressoSalvo.lote / progressoSalvo.totalLotes) * 100,
                    )}
                    % concluído
                  </span>
                )}
                {salvoInfo && (
                  <span className="flex items-center gap-1 text-xs text-green-700 font-medium">
                    <CheckCircle size={14} weight="fill" />
                    {salvoInfo.saved.toLocaleString('pt-BR')} salvas
                    {salvoInfo.duplicatesRemoved > 0 && (
                      <span className="text-gray-500 font-normal">
                        ({salvoInfo.duplicatesRemoved.toLocaleString('pt-BR')}{' '}
                        já existiam)
                      </span>
                    )}
                  </span>
                )}
              </>
            )}
          </div>

          {erro && (
            <p className="text-xs text-red-600 font-medium mt-2">{erro}</p>
          )}
        </CardContent>
      </Card>

      {/* Resultado */}
      {(dadosCarregados || dados.length > 0) && (
        <Card className="shadow-lg rounded-xl bg-white">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm font-bold text-[#000638]">
              <span>
                {dadosFiltrados.length} nota
                {dadosFiltrados.length !== 1 ? 's' : ''} encontrada
                {dadosFiltrados.length !== 1 ? 's' : ''}
                {operacaoSelecionada && ` (filtro: ${operacaoSelecionada})`}
              </span>
              <span className="text-blue-800 font-bold text-base">
                Total: {formatCurrency(totalValor)}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="extrato-table w-full text-xs">
                <thead>
                  <tr>
                    {colunas.map((col) => (
                      <th
                        key={col.key}
                        onClick={() => handleSort(col.key)}
                        className="cursor-pointer select-none whitespace-nowrap px-3 py-2 text-left"
                      >
                        <span className="flex items-center gap-1">
                          {col.label} {getSortIcon(col.key)}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dadosPaginados.length === 0 ? (
                    <tr>
                      <td
                        colSpan={colunas.length}
                        className="text-center py-8 text-gray-400"
                      >
                        Nenhuma nota fiscal encontrada para os filtros
                        selecionados.
                      </td>
                    </tr>
                  ) : (
                    dadosPaginados.map((nf, idx) => (
                      <tr key={`${nf.transactionCode ?? idx}-${idx}`}>
                        <td className="px-3 py-1.5">{nf.branchCode ?? '--'}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          {formatDateBR(nf.issueDate ?? nf.invoiceDate)}
                        </td>
                        <td className="px-3 py-1.5">
                          {nf.invoiceCode ?? '--'}
                        </td>
                        <td className="px-3 py-1.5">{nf.serialCode ?? '--'}</td>
                        <td className="px-3 py-1.5">
                          {nf.transactionCode ?? '--'}
                        </td>
                        <td className="px-3 py-1.5">{nf.personCode ?? '--'}</td>
                        <td
                          className="px-3 py-1.5 max-w-[200px] truncate"
                          title={nf.personName}
                        >
                          {nf.personName ?? '--'}
                        </td>
                        <td
                          className="px-3 py-1.5 max-w-[160px] truncate"
                          title={nf.operatioName ?? nf.operationName}
                        >
                          {nf.operatioName ?? nf.operationName ?? '--'}
                        </td>
                        <td className="px-3 py-1.5">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                              nf.invoiceStatus === 'Authorized'
                                ? 'bg-green-100 text-green-700'
                                : nf.invoiceStatus === 'Canceled'
                                  ? 'bg-red-100 text-red-600'
                                  : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {nf.invoiceStatus ?? '--'}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-right font-medium">
                          {formatCurrency(nf.totalValue)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Paginação */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t text-xs text-gray-600">
                <span>
                  Página {paginaAtual} de {totalPages} — {dados.length}{' '}
                  registros
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPaginaAtual((p) => Math.max(1, p - 1))}
                    disabled={paginaAtual === 1}
                    className="p-1 rounded border border-gray-300 hover:bg-gray-100 disabled:opacity-40"
                  >
                    <CaretLeft size={14} />
                  </button>
                  <button
                    onClick={() =>
                      setPaginaAtual((p) => Math.min(totalPages, p + 1))
                    }
                    disabled={paginaAtual === totalPages}
                    className="p-1 rounded border border-gray-300 hover:bg-gray-100 disabled:opacity-40"
                  >
                    <CaretRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <style>{`
        .extrato-table { border-collapse: collapse; width: 100%; }
        .extrato-table th, .extrato-table td { padding: 6px 8px !important; border-right: 1px solid #f3f4f6; font-size: 12px; line-height: 1.4; }
        .extrato-table th:last-child, .extrato-table td:last-child { border-right: none; }
        .extrato-table th { background-color: #000638; color: white; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 0.05em; }
        .extrato-table tbody tr:nth-child(odd) { background-color: white; }
        .extrato-table tbody tr:nth-child(even) { background-color: #f9fafb; }
        .extrato-table tbody tr:hover { background-color: #f3f4f6; }
      `}</style>
    </div>
  );
};

export default ConsultaNFs;
