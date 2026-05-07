import React, { useMemo, useState, useEffect } from 'react';
import PageTitle from '../components/ui/PageTitle';
import {
  ChartLineUp,
  Receipt,
  MagnifyingGlass,
  CircleNotch,
} from '@phosphor-icons/react';
import useApiClient from '../hooks/useApiClient';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '../components/ui/cards';
import LoadingSpinner from '../components/LoadingSpinner';
import Notification from '../components/ui/Notification';
import FiltroEmpresa from '../components/FiltroEmpresa';

const CMVMultimarcas = () => {
  const api = useApiClient();

  // Datas padrão: últimos 30 dias
  const formatDate = (d) => d.toISOString().slice(0, 10);
  const today = useMemo(() => new Date(), []);
  const sevenDaysAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d;
  }, []);

  const [dtInicio, setDtInicio] = useState(formatDate(sevenDaysAgo));
  const [dtFim, setDtFim] = useState(formatDate(today));
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');
  const [dados, setDados] = useState([]);
  const [notification, setNotification] = useState(null);

  // Filtros adicionais (igual à página de análise de transações)
  const [filtroGrupo, setFiltroGrupo] = useState('');
  const [filtroNomeGrupo, setFiltroNomeGrupo] = useState('');
  const [filtroTransacao, setFiltroTransacao] = useState('');
  const [empresasSelecionadas, setEmpresasSelecionadas] = useState([]);
  const [tipoTransacao, setTipoTransacao] = useState('todos');
  const ITEMS_PER_PAGE = 30;
  const [page, setPage] = useState(1);

  const formatDateBr = (value) => {
    if (!value) return 'N/A';
    try {
      const d = new Date(value);
      if (isNaN(d.getTime())) {
        // Tenta tratar string no formato YYYY-MM-DD
        const s = String(value).slice(0, 10);
        const [y, m, day] = s.split('-');
        if (y && m && day)
          return `${day.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
        return s;
      }
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      return `${dd}/${mm}/${yyyy}`;
    } catch {
      return String(value);
    }
  };

  const formatUnit = (value) => {
    if (value === null || value === undefined || value === '') return 0;
    const s = String(value).trim();
    // Normaliza: vírgula como ponto
    const normalized = s.replace(/,/g, '.');
    // Se houver ponto decimal, ignora tudo após o ponto
    const integerPart = normalized.split('.')[0];
    // Remove quaisquer separadores não numéricos restantes
    const digitsOnly = integerPart.replace(/[^0-9-]/g, '');
    if (digitsOnly === '' || digitsOnly === '-' || digitsOnly === '+') return 0;
    const n = parseInt(digitsOnly, 10);
    if (!isNaN(n)) return n;
    // Fallback seguro
    const f = parseFloat(normalized);
    return isNaN(f) ? 0 : Math.trunc(f);
  };

  const empresasMultimarcas = [
    2, 5, 11, 12, 13, 14, 15, 16, 55, 65, 90, 91, 92, 93, 94, 95, 96, 97, 98,
    200, 500, 550, 650, 890, 910, 920, 930, 940, 950, 960, 970, 980,
  ];

  const buscar = async () => {
    setErro('');
    if (!dtInicio || !dtFim) {
      setErro('Informe data inicial e final.');
      return;
    }
    if (new Date(dtInicio) > new Date(dtFim)) {
      setErro('Data inicial não pode ser maior que a final.');
      return;
    }
    setLoading(true);
    setDados([]);
    try {
      const selecionadas = empresasSelecionadas.map((e) => e.cd_empresa);
      const params = {
        dataInicio: dtInicio,
        dataFim: dtFim,
        cd_grupoempresa:
          selecionadas && selecionadas.length > 0
            ? selecionadas
            : empresasMultimarcas,
      };
      const resp = await api.sales.cmvMultimarcas(params);
      if (resp.success) {
        const lista = Array.isArray(resp?.data?.data)
          ? resp.data.data
          : Array.isArray(resp?.data)
          ? resp.data
          : [];
        setDados(lista);
        if (lista.length === 0) {
          setNotification({
            type: 'info',
            message: 'Nenhum registro encontrado',
          });
          setTimeout(() => setNotification(null), 3000);
        }
      } else {
        setErro(
          resp.message || 'Falha ao carregar dados. Tente reduzir o período.',
        );
      }
    } catch (e) {
      setErro('Erro ao buscar dados. Tente reduzir o período.');
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const colunas = useMemo(() => {
    if (!dados || dados.length === 0) return [];
    return Object.keys(dados[0]);
  }, [dados]);

  // Carregar dados iniciais automaticamente
  useEffect(() => {
    buscar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filtragem (igual à análise de transações)
  const dadosFiltrados = useMemo(() => {
    return (dados || []).filter((item) => {
      const grupoMatch =
        !filtroGrupo ||
        (item.cd_grupoempresa &&
          String(item.cd_grupoempresa)
            .toLowerCase()
            .includes(filtroGrupo.toLowerCase()));
      const nomeGrupoMatch =
        !filtroNomeGrupo ||
        (item.nm_grupoempresa &&
          String(item.nm_grupoempresa)
            .toLowerCase()
            .includes(filtroNomeGrupo.toLowerCase()));
      const transacaoMatch =
        !filtroTransacao ||
        (item.nr_transacao &&
          String(item.nr_transacao)
            .toLowerCase()
            .includes(filtroTransacao.toLowerCase()));
      const tipoMatch =
        tipoTransacao === 'todos'
          ? true
          : tipoTransacao === 'saida'
          ? formatUnit(item.produtos_saida) > 0
          : formatUnit(item.produtos_entrada) > 0;
      const empresasMatch =
        empresasSelecionadas.length === 0 ||
        empresasSelecionadas.some(
          (e) =>
            String(e.cd_empresa) ===
            String(item.cd_grupoempresa ?? item.cd_empresa),
        );
      return (
        grupoMatch &&
        nomeGrupoMatch &&
        transacaoMatch &&
        tipoMatch &&
        empresasMatch
      );
    });
  }, [
    dados,
    filtroGrupo,
    filtroNomeGrupo,
    filtroTransacao,
    tipoTransacao,
    empresasSelecionadas,
  ]);

  const totalRegistros = dadosFiltrados.length;
  const {
    totalEntradaProdutos,
    totalSaidaProdutos,
    totalEntradaValor,
    totalSaidaValor,
    totalCMV,
  } = useMemo(() => {
    let entradaProdutos = 0;
    let saidaProdutos = 0;
    let entradaValor = 0;
    let saidaValor = 0;
    dadosFiltrados.forEach((it) => {
      const prodEnt = formatUnit(it.produtos_entrada);
      const prodSai = formatUnit(it.produtos_saida);
      const cmvVal = parseFloat(it.cmv) || 0;
      if (prodSai > 0) {
        saidaProdutos += prodSai;
        saidaValor += cmvVal;
      }
      if (prodEnt > 0) {
        entradaProdutos += prodEnt;
        entradaValor += cmvVal;
      }
    });
    return {
      totalEntradaProdutos: entradaProdutos,
      totalSaidaProdutos: saidaProdutos,
      totalEntradaValor: entradaValor,
      totalSaidaValor: saidaValor,
      totalCMV: saidaValor - entradaValor,
    };
  }, [dadosFiltrados]);
  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(totalRegistros / ITEMS_PER_PAGE)),
    [totalRegistros],
  );
  const pageData = useMemo(() => {
    const start = (page - 1) * ITEMS_PER_PAGE;
    return dadosFiltrados.slice(start, start + ITEMS_PER_PAGE);
  }, [dadosFiltrados, page]);

  // Resetar para primeira página quando filtros ou dados mudarem
  useEffect(() => {
    setPage(1);
  }, [
    filtroGrupo,
    filtroNomeGrupo,
    filtroTransacao,
    tipoTransacao,
    empresasSelecionadas.length,
    dtInicio,
    dtFim,
    dados.length,
  ]);

  return (
    <div className="w-full max-w-7xl mx-auto p-4">
      <PageTitle
        title="CMV Multimarcas"
        subtitle="Consulta do CMV do canal Multimarcas"
        icon={ChartLineUp}
        iconColor="text-indigo-600"
      />

      {/* Filtros - mesmo visual da Análise de Transação */}
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
            Configure os filtros para consulta do CMV Multimarcas
            {(filtroGrupo || filtroNomeGrupo || filtroTransacao) && (
              <span className="ml-2 text-blue-600 font-semibold">
                ({dadosFiltrados.length} de {dados.length} registros)
              </span>
            )}
          </CardDescription>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
            <div className="lg:col-span-2">
              <FiltroEmpresa
                empresasSelecionadas={empresasSelecionadas}
                onSelectEmpresas={setEmpresasSelecionadas}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Data Início
              </label>
              <input
                type="date"
                value={dtInicio}
                onChange={(e) => setDtInicio(e.target.value)}
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] placeholder:text-gray-400 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Data Fim
              </label>
              <input
                type="date"
                value={dtFim}
                onChange={(e) => setDtFim(e.target.value)}
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] placeholder:text-gray-400 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Código do Grupo
              </label>
              <input
                type="text"
                placeholder="Código do grupo..."
                value={filtroGrupo}
                onChange={(e) => setFiltroGrupo(e.target.value)}
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] placeholder:text-gray-400 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Nome do Grupo
              </label>
              <input
                type="text"
                placeholder="Nome do grupo..."
                value={filtroNomeGrupo}
                onChange={(e) => setFiltroNomeGrupo(e.target.value)}
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] placeholder:text-gray-400 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Número da Transação
              </label>
              <input
                type="text"
                placeholder="Número da transação..."
                value={filtroTransacao}
                onChange={(e) => setFiltroTransacao(e.target.value)}
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] placeholder:text-gray-400 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Tipo de Transação
              </label>
              <select
                value={tipoTransacao}
                onChange={(e) => setTipoTransacao(e.target.value)}
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
              >
                <option value="todos">Todos</option>
                <option value="saida">Saída</option>
                <option value="entrada">Entrada</option>
              </select>
            </div>
            <div className="flex items-end">
              <button
                onClick={buscar}
                disabled={
                  loading ||
                  !dtInicio ||
                  !dtFim ||
                  new Date(dtInicio) > new Date(dtFim)
                }
                className="flex items-center gap-2 bg-[#000638] text-white px-4 py-2 rounded-lg hover:bg-[#fe0000] disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors w-full justify-center"
              >
                {loading ? (
                  <>
                    <CircleNotch size={16} className="animate-spin" />
                    Carregando...
                  </>
                ) : (
                  <>
                    <MagnifyingGlass size={16} />
                    Buscar
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Botão limpar filtros */}
          <div className="mt-4 flex justify-end">
            <button
              onClick={() => {
                setFiltroGrupo('');
                setFiltroNomeGrupo('');
                setFiltroTransacao('');
                setTipoTransacao('todos');
                setEmpresasSelecionadas([]);
              }}
              className="flex items-center gap-2 bg-gray-500 text-white px-3 py-1.5 rounded-lg hover:bg-gray-600 font-medium transition-colors text-xs"
            >
              <MagnifyingGlass size={14} />
              Limpar Filtros
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Cards de Resumo */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Receipt size={18} className="text-blue-600" />
              <CardTitle className="text-sm font-bold text-blue-700">
                Total de Registros
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-0 px-4 pb-4">
            <div className="text-base font-extrabold text-blue-600 mb-0.5">
              {totalRegistros}
            </div>
            <CardDescription className="text-xs text-gray-500">
              Registros encontrados
            </CardDescription>
          </CardContent>
        </Card>

        <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Receipt size={18} className="text-green-600" />
              <CardTitle className="text-sm font-bold text-green-700">
                Total CMV (Saída - Entrada)
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-0 px-4 pb-4">
            <div className="text-base font-extrabold text-green-600 mb-0.5">
              {new Intl.NumberFormat('pt-BR', {
                style: 'currency',
                currency: 'BRL',
              }).format(totalCMV)}
            </div>
            <CardDescription className="text-xs text-gray-500">
              Diferença entre valores de saída e entrada
            </CardDescription>
          </CardContent>
        </Card>

        <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Receipt size={18} className="text-orange-600" />
              <CardTitle className="text-sm font-bold text-orange-700">
                Total Entrada (valor e produtos)
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-0 px-4 pb-4">
            <div className="text-base font-extrabold text-orange-600 mb-0.5">
              {new Intl.NumberFormat('pt-BR', {
                style: 'currency',
                currency: 'BRL',
              }).format(totalEntradaValor)}
            </div>
            <CardDescription className="text-xs text-gray-500">
              Produtos: {totalEntradaProdutos}
            </CardDescription>
          </CardContent>
        </Card>

        <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Receipt size={18} className="text-emerald-600" />
              <CardTitle className="text-sm font-bold text-emerald-700">
                Total Saída (valor e produtos)
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-0 px-4 pb-4">
            <div className="text-base font-extrabold text-emerald-600 mb-0.5">
              {new Intl.NumberFormat('pt-BR', {
                style: 'currency',
                currency: 'BRL',
              }).format(totalSaidaValor)}
            </div>
            <CardDescription className="text-xs text-gray-500">
              Produtos: {totalSaidaProdutos}
            </CardDescription>
          </CardContent>
        </Card>
      </div>

      {/* Tabela - mesmo estilo da Análise de Transação */}
      <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Receipt size={18} className="text-[#000638]" />
            <CardTitle className="text-sm font-bold text-[#000638]">
              Lista de Registros
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="pt-0 px-4 pb-4">
          <CardDescription className="text-xs text-gray-500 mb-4">
            Detalhes de todos os registros de CMV Multimarcas
          </CardDescription>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <LoadingSpinner size="md" text="Carregando registros..." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                  <tr>
                    <th className="px-4 py-3">Código Empresa</th>
                    <th className="px-4 py-3">Nome Empresa</th>
                    <th className="px-4 py-3">Data</th>
                    <th className="px-4 py-3">Número da Transação</th>
                    <th className="px-4 py-3">CMV</th>
                    <th className="px-4 py-3">Produtos Saída</th>
                    <th className="px-4 py-3">Produtos Entrada</th>
                  </tr>
                </thead>
                <tbody>
                  {dadosFiltrados.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-4 py-8 text-center text-gray-500"
                      >
                        {dados.length === 0
                          ? 'Nenhum registro encontrado'
                          : 'Nenhum registro corresponde aos filtros aplicados'}
                      </td>
                    </tr>
                  ) : (
                    pageData.map((row, index) => (
                      <tr
                        key={index}
                        className="bg-white border-b hover:bg-blue-50 transition-colors"
                      >
                        <td className="px-4 py-3 font-medium text-gray-900">
                          <span className="bg-purple-100 text-purple-800 text-xs font-medium px-2 py-1 rounded">
                            {row.cd_grupoempresa ?? row.cd_empresa ?? 'N/A'}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900">
                          <span className="bg-indigo-100 text-indigo-800 text-xs font-medium px-2 py-1 rounded">
                            {row.nm_grupoempresa || 'N/A'}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {formatDateBr(row.dt_transacao)}
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900">
                          <span className="bg-blue-100 text-blue-800 text-xs font-medium px-2 py-1 rounded">
                            {row.nr_transacao || 'N/A'}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-medium text-green-600">
                          {new Intl.NumberFormat('pt-BR', {
                            style: 'currency',
                            currency: 'BRL',
                          }).format(row.cmv || 0)}
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {formatUnit(row.produtos_saida)}
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {formatUnit(row.produtos_entrada)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 px-2">
                <div className="text-xs text-gray-600">
                  {totalRegistros === 0
                    ? 'Nenhum registro'
                    : (() => {
                        const start = (page - 1) * ITEMS_PER_PAGE + 1;
                        const end = Math.min(
                          page * ITEMS_PER_PAGE,
                          totalRegistros,
                        );
                        return `Mostrando ${start}-${end} de ${totalRegistros}`;
                      })()}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1.5 rounded border border-gray-300 text-sm disabled:opacity-50 hover:bg-gray-50"
                  >
                    Anterior
                  </button>
                  <span className="text-xs text-gray-700">
                    Página {page} de {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="px-3 py-1.5 rounded border border-gray-300 text-sm disabled:opacity-50 hover:bg-gray-50"
                  >
                    Próxima
                  </button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Notificação */}
      {notification && (
        <Notification
          type={notification.type}
          message={notification.message}
          onClose={() => setNotification(null)}
        />
      )}
    </div>
  );
};

export default CMVMultimarcas;
