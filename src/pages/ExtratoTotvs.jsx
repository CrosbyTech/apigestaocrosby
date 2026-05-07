import React, { useState, useRef, useMemo } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../components/ui/cards';
import PageTitle from '../components/ui/PageTitle';
import {
  UploadSimple,
  FileText,
  Trash,
  DownloadSimple,
  CaretUp,
  CaretDown,
  ArrowsClockwise,
  Bank,
  CurrencyDollar,
  TrendUp,
  TrendDown,
  Receipt,
  X,
  CaretLeft,
  CaretRight,
  Check,
  Plus,
} from '@phosphor-icons/react';

const parseBRNumber = (str) => {
  if (!str) return 0;
  const cleaned = str.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  return parseFloat(cleaned) || 0;
};

const ExtratoTotvs = () => {
  const fileInputRef = useRef(null);
  const docDropdownRef = useRef(null);

  // Dados
  const [dados, setDados] = useState([]);
  const [loading, setLoading] = useState(false);
  const [arquivosImportados, setArquivosImportados] = useState([]);

  // Filtros
  const [filtroConta, setFiltroConta] = useState('');
  const [filtroDataInicio, setFiltroDataInicio] = useState('');
  const [filtroDataFim, setFiltroDataFim] = useState('');
  const [filtroHistoricos, setFiltroHistoricos] = useState([]);
  const [filtroConciliado, setFiltroConciliado] = useState('');
  const [filtroDocumento, setFiltroDocumento] = useState('');
  const [showDocDropdown, setShowDocDropdown] = useState(false);

  // Ordenação
  const [sortField, setSortField] = useState('');
  const [sortDirection, setSortDirection] = useState('asc');

  // Paginação
  const [paginaAtual, setPaginaAtual] = useState(1);
  const itensPorPagina = 50;

  const parseCSV = (text) => {
    const lines = text.split('\n').filter((line) => line.trim());
    if (lines.length < 3) return [];

    // Linha 1: NR_CONTA;20001
    const firstLine = lines[0].split(';');
    const nrConta = firstLine[1]?.trim() || '';

    // Linha 2: header - pular
    // Linhas 3+: dados
    const rows = [];
    for (let i = 2; i < lines.length; i++) {
      const line = lines[i].trim();
      // Pular linhas TOTAL DIA e TOTAL GERAL
      if (line.startsWith('TOTAL DIA') || line.startsWith('TOTAL GERAL'))
        continue;

      const cols = line.split(';');
      // Precisa ter pelo menos a data no primeiro campo
      if (!cols[0]?.trim() || cols.length < 10) continue;

      const dtMov = cols[0]?.trim() || '';
      // Pular linhas que não começam com data (dd/mm/yyyy)
      if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dtMov)) continue;

      rows.push({
        conta: nrConta,
        dtMovimento: dtMov,
        codOperacao: cols[1]?.trim() || '',
        operacao: cols[2]?.trim() || '',
        histAuxiliar: cols[3]?.trim() || '',
        conciliado: cols[4]?.trim() || '',
        especie: cols[5]?.trim() || '',
        nrDocumento: cols[6]?.trim() || '',
        credito: cols[7]?.trim() || '',
        debito: cols[8]?.trim() || '',
        saldo: cols[9]?.trim() || '',
        saldoConciliado: cols[10]?.trim().replace('"', '') || '',
      });
    }
    return rows;
  };

  const parseDate = (dateStr) => {
    if (!dateStr) return null;
    const parts = dateStr.split('/');
    if (parts.length !== 3) return null;
    return new Date(parts[2], parts[1] - 1, parts[0]);
  };

  const handleImportarArquivo = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setLoading(true);

    try {
      let allRows = [...dados];
      const novosArquivos = [...arquivosImportados];

      for (const file of files) {
        const text = await file.text();
        const parsed = parseCSV(text);
        allRows = [...allRows, ...parsed];
        novosArquivos.push(file.name);
      }

      setDados(allRows);
      setArquivosImportados(novosArquivos);
      setPaginaAtual(1);
    } catch (err) {
      console.error('Erro ao importar arquivo:', err);
      alert('Erro ao ler o arquivo. Verifique o formato CSV.');
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const limparDados = () => {
    setDados([]);
    setArquivosImportados([]);
    setFiltroConta('');
    setFiltroDataInicio('');
    setFiltroDataFim('');
    setFiltroHistoricos([]);
    setFiltroConciliado('');
    setFiltroDocumento('');
    setPaginaAtual(1);
  };

  const limparFiltros = () => {
    setFiltroConta('');
    setFiltroDataInicio('');
    setFiltroDataFim('');
    setFiltroHistoricos([]);
    setFiltroConciliado('');
    setFiltroDocumento('');
    setPaginaAtual(1);
  };

  // Extrair valores únicos para selects
  const contasUnicas = useMemo(
    () => [...new Set(dados.map((d) => d.conta))].sort(),
    [dados],
  );

  const historicosUnicos = useMemo(
    () =>
      [...new Set(dados.map((d) => d.codOperacao).filter(Boolean))].sort(
        (a, b) => Number(a) - Number(b),
      ),
    [dados],
  );

  const toggleHistorico = (cod) => {
    setFiltroHistoricos((prev) =>
      prev.includes(cod) ? prev.filter((c) => c !== cod) : [...prev, cod],
    );
    setPaginaAtual(1);
  };

  const selecionarTodosHistoricos = () => {
    setFiltroHistoricos([...historicosUnicos]);
    setPaginaAtual(1);
  };

  const limparHistoricos = () => {
    setFiltroHistoricos([]);
    setPaginaAtual(1);
  };

  // Filtrar dados
  const dadosFiltrados = useMemo(() => {
    let resultado = [...dados];

    if (filtroConta) {
      resultado = resultado.filter((d) => d.conta === filtroConta);
    }

    if (filtroDataInicio) {
      const dtInicio = new Date(filtroDataInicio + 'T00:00:00');
      resultado = resultado.filter((d) => {
        const dt = parseDate(d.dtMovimento);
        return dt && dt >= dtInicio;
      });
    }

    if (filtroDataFim) {
      const dtFim = new Date(filtroDataFim + 'T23:59:59');
      resultado = resultado.filter((d) => {
        const dt = parseDate(d.dtMovimento);
        return dt && dt <= dtFim;
      });
    }

    if (filtroHistoricos.length > 0) {
      resultado = resultado.filter((d) =>
        filtroHistoricos.includes(d.codOperacao),
      );
    }

    if (filtroConciliado) {
      resultado = resultado.filter((d) => d.conciliado === filtroConciliado);
    }

    if (filtroDocumento) {
      resultado = resultado.filter((d) =>
        d.nrDocumento.toLowerCase().includes(filtroDocumento.toLowerCase()),
      );
    }

    // Ordenação
    if (sortField) {
      resultado.sort((a, b) => {
        let valA = a[sortField] || '';
        let valB = b[sortField] || '';

        if (
          sortField === 'credito' ||
          sortField === 'debito' ||
          sortField === 'saldo'
        ) {
          valA = parseBRNumber(valA);
          valB = parseBRNumber(valB);
        } else if (sortField === 'dtMovimento') {
          const dA = parseDate(valA);
          const dB = parseDate(valB);
          valA = dA ? dA.getTime() : 0;
          valB = dB ? dB.getTime() : 0;
        }

        if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return resultado;
  }, [
    dados,
    filtroConta,
    filtroDataInicio,
    filtroDataFim,
    filtroHistoricos,
    filtroConciliado,
    filtroDocumento,
    sortField,
    sortDirection,
  ]);

  // Paginação
  const totalPaginas = Math.ceil(dadosFiltrados.length / itensPorPagina);
  const dadosPaginados = dadosFiltrados.slice(
    (paginaAtual - 1) * itensPorPagina,
    paginaAtual * itensPorPagina,
  );

  // Totais
  const totalCredito = useMemo(() => {
    return dadosFiltrados.reduce((acc, d) => acc + parseBRNumber(d.credito), 0);
  }, [dadosFiltrados]);

  const totalDebito = useMemo(() => {
    return dadosFiltrados.reduce((acc, d) => acc + parseBRNumber(d.debito), 0);
  }, [dadosFiltrados]);

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const SortIcon = ({ field }) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc' ? (
      <CaretUp size={12} className="inline ml-0.5" />
    ) : (
      <CaretDown size={12} className="inline ml-0.5" />
    );
  };

  const exportarExcel = async () => {
    const XLSX = await import('xlsx');
    const dadosExport = dadosFiltrados.map((d) => ({
      Conta: d.conta,
      'Dt. Movimento': d.dtMovimento,
      'Cód. Oper.': d.codOperacao,
      Operação: d.operacao,
      'Hist. Auxiliar': d.histAuxiliar,
      Conciliado: d.conciliado,
      Espécie: d.especie,
      'Nr. Documento': d.nrDocumento,
      Crédito: d.credito,
      Débito: d.debito,
      Saldo: d.saldo,
      'Saldo Concil.': d.saldoConciliado,
    }));

    const ws = XLSX.utils.json_to_sheet(dadosExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Extrato TOTVS');
    XLSX.writeFile(wb, 'extrato-totvs.xlsx');
  };

  // Fechar dropdown ao clicar fora
  React.useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        docDropdownRef.current &&
        !docDropdownRef.current.contains(e.target)
      ) {
        setShowDocDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <PageTitle
        title="Extrato TOTVS"
        subtitle="Importe extratos CSV e visualize movimentações financeiras"
        icon={Bank}
        iconColor="text-teal-600"
      />

      {/* Upload + Ações */}
      <Card className="shadow-lg rounded-xl bg-white">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.CSV"
              multiple
              onChange={handleImportarArquivo}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-[#000638] text-white text-sm font-bold rounded-lg hover:bg-[#000638]/90 transition-colors shadow-sm"
            >
              {dados.length > 0 ? (
                <Plus size={18} />
              ) : (
                <UploadSimple size={18} />
              )}
              {loading
                ? 'Importando...'
                : dados.length > 0
                  ? 'Adicionar CSV'
                  : 'Importar CSV'}
            </button>

            {arquivosImportados.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {arquivosImportados.map((nome, i) => (
                  <span
                    key={i}
                    className="flex items-center gap-1 text-xs text-gray-500 bg-gray-50 px-2 py-1 rounded-lg"
                  >
                    <FileText size={14} className="text-gray-400" />
                    {nome}
                  </span>
                ))}
                <span className="text-xs font-semibold text-gray-700 bg-blue-50 px-2 py-1 rounded-lg">
                  {dados.length} registros
                </span>
              </div>
            )}

            {dados.length > 0 && (
              <>
                <button
                  onClick={exportarExcel}
                  className="flex items-center gap-1.5 px-3 py-2 bg-green-600 text-white text-xs font-bold rounded-lg hover:bg-green-700 transition-colors"
                >
                  <DownloadSimple size={16} />
                  Excel
                </button>
                <button
                  onClick={limparDados}
                  className="flex items-center gap-1.5 px-3 py-2 bg-red-600 text-white text-xs font-bold rounded-lg hover:bg-red-700 transition-colors"
                >
                  <Trash size={16} />
                  Limpar
                </button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Cards de resumo */}
      {dados.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="shadow-lg rounded-xl bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Receipt size={18} className="text-blue-600" />
                <CardTitle className="text-sm font-bold text-blue-700">
                  Total Registros
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-4 pb-4">
              <div className="text-2xl font-extrabold text-blue-600">
                {dadosFiltrados.length}
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-lg rounded-xl bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <TrendUp size={18} className="text-green-600" />
                <CardTitle className="text-sm font-bold text-green-700">
                  Total Crédito
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-4 pb-4">
              <div className="text-2xl font-extrabold text-green-600">
                {formatCurrency(totalCredito)}
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-lg rounded-xl bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <TrendDown size={18} className="text-red-600" />
                <CardTitle className="text-sm font-bold text-red-700">
                  Total Débito
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-4 pb-4">
              <div className="text-2xl font-extrabold text-red-600">
                {formatCurrency(totalDebito)}
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-lg rounded-xl bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <CurrencyDollar
                  size={18}
                  className={
                    totalCredito - totalDebito >= 0
                      ? 'text-green-600'
                      : 'text-red-600'
                  }
                />
                <CardTitle
                  className={`text-sm font-bold ${totalCredito - totalDebito >= 0 ? 'text-green-700' : 'text-red-700'}`}
                >
                  Saldo
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-4 pb-4">
              <div
                className={`text-2xl font-extrabold ${totalCredito - totalDebito >= 0 ? 'text-green-600' : 'text-red-600'}`}
              >
                {formatCurrency(totalCredito - totalDebito)}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Barra de Filtros */}
      {dados.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border border-gray-200 rounded-xl text-sm bg-white shadow-sm">
          {/* Conta */}
          <select
            value={filtroConta}
            onChange={(e) => {
              setFiltroConta(e.target.value);
              setPaginaAtual(1);
            }}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs font-bold bg-white text-gray-700 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">Todas as Contas</option>
            {contasUnicas.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          {/* Data De */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-500 font-medium">De:</span>
            <input
              type="date"
              value={filtroDataInicio}
              onChange={(e) => {
                setFiltroDataInicio(e.target.value);
                setPaginaAtual(1);
              }}
              className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Data Até */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-500 font-medium">Até:</span>
            <input
              type="date"
              value={filtroDataFim}
              onChange={(e) => {
                setFiltroDataFim(e.target.value);
                setPaginaAtual(1);
              }}
              className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Cód. Operação multi-select dropdown */}
          <div className="relative" ref={docDropdownRef}>
            <button
              onClick={() => setShowDocDropdown((prev) => !prev)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border transition-colors ${
                filtroHistoricos.length > 0
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
              }`}
            >
              <FileText size={14} />
              Cód. Oper.
              {filtroHistoricos.length > 0 && (
                <span className="bg-white/20 px-1.5 py-0.5 rounded-full text-[10px]">
                  {filtroHistoricos.length}
                </span>
              )}
            </button>

            {showDocDropdown && (
              <div className="absolute z-50 top-full mt-1 left-0 w-56 bg-white border border-gray-200 rounded-xl shadow-xl py-2">
                <div className="flex items-center justify-between px-3 pb-2 border-b border-gray-100">
                  <span className="text-xs font-bold text-gray-700">
                    Cód. Operação
                  </span>
                  <div className="flex gap-1">
                    <button
                      onClick={selecionarTodosHistoricos}
                      className="text-[10px] text-blue-600 hover:underline font-semibold"
                    >
                      Todos
                    </button>
                    <span className="text-gray-300">|</span>
                    <button
                      onClick={limparHistoricos}
                      className="text-[10px] text-red-500 hover:underline font-semibold"
                    >
                      Limpar
                    </button>
                  </div>
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {historicosUnicos.map((cod) => (
                    <button
                      key={cod}
                      onClick={() => toggleHistorico(cod)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50 transition-colors"
                    >
                      <div
                        className={`w-4 h-4 rounded border flex items-center justify-center ${
                          filtroHistoricos.includes(cod)
                            ? 'bg-blue-600 border-blue-600'
                            : 'border-gray-300'
                        }`}
                      >
                        {filtroHistoricos.includes(cod) && (
                          <Check
                            size={10}
                            className="text-white"
                            weight="bold"
                          />
                        )}
                      </div>
                      <span className="text-gray-700 font-medium">{cod}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Tags dos históricos selecionados */}
          {filtroHistoricos.length > 0 && filtroHistoricos.length <= 5 && (
            <div className="flex flex-wrap gap-1">
              {filtroHistoricos.map((cod) => (
                <span
                  key={cod}
                  onClick={() => toggleHistorico(cod)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-[10px] font-bold cursor-pointer hover:bg-blue-200"
                >
                  {cod}
                  <X size={10} />
                </span>
              ))}
            </div>
          )}

          {/* Documento */}
          <input
            type="text"
            value={filtroDocumento}
            onChange={(e) => {
              setFiltroDocumento(e.target.value);
              setPaginaAtual(1);
            }}
            placeholder="Nr. Documento"
            className="w-32 px-3 py-1.5 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />

          {/* Conciliado toggle */}
          <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
            {['', 'Sim', 'Não'].map((op) => (
              <button
                key={op}
                onClick={() => {
                  setFiltroConciliado(op);
                  setPaginaAtual(1);
                }}
                className={`px-2.5 py-1.5 text-xs font-bold rounded-md transition-colors ${
                  filtroConciliado === op
                    ? 'bg-[#000638] text-white shadow'
                    : 'text-gray-600 hover:bg-gray-200'
                }`}
              >
                {op === '' ? 'Todos' : op}
              </button>
            ))}
          </div>

          {/* Limpar filtros */}
          <button
            onClick={limparFiltros}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors ml-auto"
          >
            <ArrowsClockwise size={14} />
            Limpar
          </button>

          <span className="text-xs text-gray-400 font-medium">
            {dadosFiltrados.length} de {dados.length}
          </span>
        </div>
      )}

      {/* Tabela */}
      {dados.length > 0 && (
        <Card className="shadow-lg rounded-xl bg-white overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gradient-to-r from-gray-50 to-gray-100 border-b border-gray-200">
                    {[
                      { key: 'conta', label: 'Conta', align: 'left' },
                      { key: 'dtMovimento', label: 'Dt. Mov.', align: 'left' },
                      {
                        key: 'codOperacao',
                        label: 'Cód. Oper.',
                        align: 'left',
                      },
                      { key: null, label: 'Operação', align: 'left' },
                      { key: null, label: 'Hist. Auxiliar', align: 'left' },
                      { key: null, label: 'Concil.', align: 'center' },
                      { key: null, label: 'Espécie', align: 'left' },
                      { key: null, label: 'Nr. Doc', align: 'left' },
                      { key: 'credito', label: 'Crédito', align: 'right' },
                      { key: 'debito', label: 'Débito', align: 'right' },
                      { key: 'saldo', label: 'Saldo', align: 'right' },
                    ].map((col, i) => (
                      <th
                        key={i}
                        className={`text-${col.align} px-3 py-2.5 font-bold text-[11px] uppercase tracking-wider text-gray-600 ${col.key ? 'cursor-pointer hover:bg-gray-200/50 select-none' : ''}`}
                        onClick={
                          col.key ? () => handleSort(col.key) : undefined
                        }
                      >
                        {col.label}
                        {col.key && <SortIcon field={col.key} />}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {dadosPaginados.map((item, idx) => {
                    const hasCredito = parseBRNumber(item.credito) > 0;
                    const hasDebito = parseBRNumber(item.debito) > 0;

                    return (
                      <tr
                        key={idx}
                        className="hover:bg-blue-50/40 transition-colors"
                      >
                        <td className="px-3 py-2 font-semibold text-gray-800">
                          {item.conta}
                        </td>
                        <td className="px-3 py-2 text-gray-600">
                          {item.dtMovimento}
                        </td>
                        <td className="px-3 py-2 text-gray-600 font-medium">
                          {item.codOperacao}
                        </td>
                        <td
                          className="px-3 py-2 text-gray-600 max-w-[200px] truncate"
                          title={item.operacao}
                        >
                          {item.operacao}
                        </td>
                        <td
                          className="px-3 py-2 text-gray-500 max-w-[180px] truncate"
                          title={item.histAuxiliar}
                        >
                          {item.histAuxiliar}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {item.conciliado && (
                            <span
                              className={`inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                                item.conciliado === 'Sim'
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-yellow-100 text-yellow-700'
                              }`}
                            >
                              {item.conciliado}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-500 text-[11px]">
                          {item.especie}
                        </td>
                        <td className="px-3 py-2 text-gray-600">
                          {item.nrDocumento}
                        </td>
                        <td className="px-3 py-2 text-right font-bold text-green-600">
                          {item.credito || ''}
                        </td>
                        <td className="px-3 py-2 text-right font-bold text-red-600">
                          {item.debito || ''}
                        </td>
                        <td
                          className={`px-3 py-2 text-right font-bold ${parseBRNumber(item.saldo) >= 0 ? 'text-gray-800' : 'text-red-600'}`}
                        >
                          {item.saldo}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Paginação */}
            {totalPaginas > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50/50">
                <span className="text-xs text-gray-500">
                  Página{' '}
                  <span className="font-bold text-gray-700">{paginaAtual}</span>{' '}
                  de{' '}
                  <span className="font-bold text-gray-700">
                    {totalPaginas}
                  </span>
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => setPaginaAtual(1)}
                    disabled={paginaAtual === 1}
                    className="px-2 py-1 text-xs font-bold text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-40 transition-colors"
                  >
                    Início
                  </button>
                  <button
                    onClick={() => setPaginaAtual((p) => Math.max(1, p - 1))}
                    disabled={paginaAtual === 1}
                    className="px-2 py-1 text-xs font-bold text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-40 transition-colors"
                  >
                    <CaretLeft size={14} />
                  </button>
                  <button
                    onClick={() =>
                      setPaginaAtual((p) => Math.min(totalPaginas, p + 1))
                    }
                    disabled={paginaAtual === totalPaginas}
                    className="px-2 py-1 text-xs font-bold text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-40 transition-colors"
                  >
                    <CaretRight size={14} />
                  </button>
                  <button
                    onClick={() => setPaginaAtual(totalPaginas)}
                    disabled={paginaAtual === totalPaginas}
                    className="px-2 py-1 text-xs font-bold text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-40 transition-colors"
                  >
                    Fim
                  </button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Estado vazio */}
      {dados.length === 0 && !loading && (
        <Card className="shadow-lg rounded-xl bg-white">
          <CardContent className="py-20 text-center">
            <div className="p-4 rounded-full bg-gradient-to-br from-teal-50 to-teal-100 w-fit mx-auto mb-4 shadow-sm">
              <Bank size={40} weight="light" className="text-teal-400" />
            </div>
            <h3 className="text-lg font-bold text-gray-600 mb-1">
              Nenhum extrato importado
            </h3>
            <p className="text-sm text-gray-400">
              Clique em "Importar CSV" para carregar um ou mais extratos TOTVS
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default ExtratoTotvs;
