import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../components/AuthContext';
import { supabase } from '../lib/supabase';
import ClientePerfilModal from '../components/ClientePerfilModal';
import PageTitle from '../components/ui/PageTitle';
import {
  Spinner,
  MagnifyingGlass,
  CheckCircle,
  XCircle,
  MinusCircle,
  CaretUp,
  CaretDown,
  CaretUpDown,
  CaretLeft,
  CaretRight,
  FileArrowDown,
  Eye,
  InstagramLogo,
  Camera,
  FileText,
} from '@phosphor-icons/react';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { TotvsURL } from '../config/constants';

const ClientesMTM = () => {
  const { user } = useAuth();
  const [clientes, setClientes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');
  const [statusPerfis, setStatusPerfis] = useState({});
  const [statusLoading, setStatusLoading] = useState(false);

  // Busca
  const [termoBusca, setTermoBusca] = useState('');

  // Paginação
  const [paginaAtual, setPaginaAtual] = useState(1);
  const [itensPorPagina] = useState(25);

  // Ordenação
  const [ordenacao, setOrdenacao] = useState({ campo: 'name', direcao: 'asc' });

  // Filtro de status
  const [filtroStatus, setFiltroStatus] = useState('todos');

  // Modal perfil
  const [perfilModalAberto, setPerfilModalAberto] = useState(false);
  const [clientePerfilData, setClientePerfilData] = useState(null);

  // Buscar clientes multimarcas
  useEffect(() => {
    buscarClientes();
  }, []);

  const buscarClientes = async () => {
    setLoading(true);
    setErro('');
    try {
      const response = await fetch(`${TotvsURL}multibrand-clients`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      const lista = result.data || [];
      setClientes(lista);

      // Buscar status dos perfis no Supabase
      if (lista.length > 0) {
        await verificarStatusPerfis(lista.map((c) => c.code));
      }
    } catch (error) {
      console.error('Erro ao buscar clientes MTM:', error);
      setErro('Erro ao carregar clientes multimarcas');
    } finally {
      setLoading(false);
    }
  };

  const verificarStatusPerfis = async (codes) => {
    setStatusLoading(true);
    try {
      // Buscar perfis (instagram e foto)
      const { data: perfis } = await supabase
        .from('clientes_confianca_perfil')
        .select('person_code, instagram, foto_path')
        .in('person_code', codes);

      // Buscar documentos (agrupar por person_code)
      const { data: docs } = await supabase
        .from('clientes_confianca_documentos')
        .select('person_code')
        .in('person_code', codes);

      const perfisMap = {};
      (perfis || []).forEach((p) => {
        perfisMap[p.person_code] = {
          temInstagram: !!p.instagram && p.instagram.trim() !== '',
          temFoto: !!p.foto_path && p.foto_path.trim() !== '',
        };
      });

      const docsSet = new Set((docs || []).map((d) => d.person_code));

      const statusMap = {};
      codes.forEach((code) => {
        const perfil = perfisMap[code] || {
          temInstagram: false,
          temFoto: false,
        };
        const temDocumentos = docsSet.has(code);
        const completo = perfil.temInstagram && perfil.temFoto && temDocumentos;
        const parcial = perfil.temInstagram || perfil.temFoto || temDocumentos;
        statusMap[code] = {
          ...perfil,
          temDocumentos,
          completo,
          parcial,
        };
      });

      setStatusPerfis(statusMap);
    } catch (error) {
      console.error('Erro ao verificar status perfis:', error);
    } finally {
      setStatusLoading(false);
    }
  };

  // Ordenação
  const handleOrdenacao = (campo) => {
    setOrdenacao((prev) => ({
      campo,
      direcao: prev.campo === campo && prev.direcao === 'asc' ? 'desc' : 'asc',
    }));
  };

  const getIconeOrdenacao = (campo) => {
    if (ordenacao.campo !== campo)
      return <CaretUpDown size={12} className="opacity-50" />;
    return ordenacao.direcao === 'asc' ? (
      <CaretUp size={12} />
    ) : (
      <CaretDown size={12} />
    );
  };

  // Dados filtrados e ordenados
  const dadosFiltrados = useMemo(() => {
    let resultado = [...clientes];

    // Filtro de busca
    if (termoBusca.trim()) {
      const termo = termoBusca.toLowerCase();
      resultado = resultado.filter(
        (c) =>
          String(c.code).includes(termo) ||
          (c.name || '').toLowerCase().includes(termo) ||
          (c.fantasyName || '').toLowerCase().includes(termo) ||
          (c.cnpj || '').toLowerCase().includes(termo),
      );
    }

    // Filtro de status
    if (filtroStatus === 'completo') {
      resultado = resultado.filter((c) => statusPerfis[c.code]?.completo);
    } else if (filtroStatus === 'parcial') {
      resultado = resultado.filter(
        (c) => statusPerfis[c.code]?.parcial && !statusPerfis[c.code]?.completo,
      );
    } else if (filtroStatus === 'pendente') {
      resultado = resultado.filter((c) => !statusPerfis[c.code]?.parcial);
    }

    // Ordenação
    resultado.sort((a, b) => {
      let valA, valB;
      if (ordenacao.campo === 'code') {
        valA = a.code;
        valB = b.code;
      } else if (ordenacao.campo === 'status') {
        const sa = statusPerfis[a.code];
        const sb = statusPerfis[b.code];
        valA = sa?.completo ? 2 : sa?.parcial ? 1 : 0;
        valB = sb?.completo ? 2 : sb?.parcial ? 1 : 0;
      } else {
        valA = (a[ordenacao.campo] || '').toLowerCase();
        valB = (b[ordenacao.campo] || '').toLowerCase();
      }
      if (valA < valB) return ordenacao.direcao === 'asc' ? -1 : 1;
      if (valA > valB) return ordenacao.direcao === 'asc' ? 1 : -1;
      return 0;
    });

    return resultado;
  }, [clientes, termoBusca, filtroStatus, ordenacao, statusPerfis]);

  // Paginação
  const totalPaginas = Math.ceil(dadosFiltrados.length / itensPorPagina);
  const dadosPaginados = dadosFiltrados.slice(
    (paginaAtual - 1) * itensPorPagina,
    paginaAtual * itensPorPagina,
  );

  useEffect(() => {
    setPaginaAtual(1);
  }, [termoBusca, filtroStatus]);

  const getPaginasVisiveis = () => {
    const paginas = [];
    if (totalPaginas <= 7) {
      for (let i = 1; i <= totalPaginas; i++) paginas.push(i);
    } else {
      paginas.push(1);
      if (paginaAtual > 3) paginas.push('...');
      const inicio = Math.max(2, paginaAtual - 1);
      const fim = Math.min(totalPaginas - 1, paginaAtual + 1);
      for (let i = inicio; i <= fim; i++) paginas.push(i);
      if (paginaAtual < totalPaginas - 2) paginas.push('...');
      paginas.push(totalPaginas);
    }
    return paginas;
  };

  // Modal
  const abrirPerfilCliente = (cliente) => {
    setClientePerfilData({
      code: cliente.code,
      nome: cliente.name,
      cnpj: cliente.cnpj,
    });
    setPerfilModalAberto(true);
  };

  // Ao fechar o modal, recarregar status (caso tenha sido editado)
  const fecharPerfilModal = () => {
    setPerfilModalAberto(false);
    if (clientes.length > 0) {
      verificarStatusPerfis(clientes.map((c) => c.code));
    }
  };

  // Exportar Excel
  const exportarExcel = () => {
    const dados = dadosFiltrados.map((c) => {
      const st = statusPerfis[c.code];
      return {
        Código: c.code,
        Nome: c.name || '',
        'Nome Fantasia': c.fantasyName || '',
        CNPJ: c.cnpj || '',
        Instagram: st?.temInstagram ? 'Sim' : 'Não',
        Foto: st?.temFoto ? 'Sim' : 'Não',
        Documentos: st?.temDocumentos ? 'Sim' : 'Não',
        Status: st?.completo
          ? 'Completo'
          : st?.parcial
            ? 'Parcial'
            : 'Pendente',
      };
    });
    const ws = XLSX.utils.json_to_sheet(dados);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Clientes MTM');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(
      new Blob([buf]),
      `clientes_mtm_${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
  };

  // Contadores
  const totalCompleto = clientes.filter(
    (c) => statusPerfis[c.code]?.completo,
  ).length;
  const totalParcial = clientes.filter(
    (c) => statusPerfis[c.code]?.parcial && !statusPerfis[c.code]?.completo,
  ).length;
  const totalPendente = clientes.filter(
    (c) => !statusPerfis[c.code]?.parcial,
  ).length;

  const StatusBadge = ({ code }) => {
    const st = statusPerfis[code];
    if (statusLoading)
      return <Spinner size={14} className="animate-spin text-gray-400" />;
    if (!st || (!st.temInstagram && !st.temFoto && !st.temDocumentos)) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-50 text-red-600 border border-red-200">
          <XCircle size={12} weight="fill" /> Pendente
        </span>
      );
    }
    if (st.completo) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-50 text-green-600 border border-green-200">
          <CheckCircle size={12} weight="fill" /> Completo
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-600 border border-amber-200">
        <MinusCircle size={12} weight="fill" /> Parcial
      </span>
    );
  };

  const StatusDetalhe = ({ code }) => {
    const st = statusPerfis[code];
    if (statusLoading || !st) return null;
    return (
      <div className="flex items-center gap-2">
        <span
          title="Instagram"
          className={st.temInstagram ? 'text-pink-500' : 'text-gray-300'}
        >
          <InstagramLogo
            size={14}
            weight={st.temInstagram ? 'fill' : 'regular'}
          />
        </span>
        <span
          title="Foto"
          className={st.temFoto ? 'text-blue-500' : 'text-gray-300'}
        >
          <Camera size={14} weight={st.temFoto ? 'fill' : 'regular'} />
        </span>
        <span
          title="Documentos"
          className={st.temDocumentos ? 'text-purple-500' : 'text-gray-300'}
        >
          <FileText size={14} weight={st.temDocumentos ? 'fill' : 'regular'} />
        </span>
      </div>
    );
  };

  return (
    <div className="w-full max-w-7xl mx-auto flex flex-col items-stretch justify-start py-3 px-2">
      <PageTitle
        title="Clientes MTM"
        subtitle="Clientes Multimarcas — status de cadastro do perfil"
      />

      {/* Cards de resumo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 text-center">
          <p className="text-2xl font-bold text-[#000638]">{clientes.length}</p>
          <p className="text-[10px] text-gray-400 uppercase tracking-wider mt-1">
            Total Clientes
          </p>
        </div>
        <div
          className={`bg-white rounded-xl shadow-sm border border-gray-200 p-4 text-center cursor-pointer transition-all ${filtroStatus === 'completo' ? 'ring-2 ring-green-500' : 'hover:border-green-300'}`}
          onClick={() =>
            setFiltroStatus(filtroStatus === 'completo' ? 'todos' : 'completo')
          }
        >
          <p className="text-2xl font-bold text-green-600">{totalCompleto}</p>
          <p className="text-[10px] text-gray-400 uppercase tracking-wider mt-1">
            Completo
          </p>
        </div>
        <div
          className={`bg-white rounded-xl shadow-sm border border-gray-200 p-4 text-center cursor-pointer transition-all ${filtroStatus === 'parcial' ? 'ring-2 ring-amber-500' : 'hover:border-amber-300'}`}
          onClick={() =>
            setFiltroStatus(filtroStatus === 'parcial' ? 'todos' : 'parcial')
          }
        >
          <p className="text-2xl font-bold text-amber-600">{totalParcial}</p>
          <p className="text-[10px] text-gray-400 uppercase tracking-wider mt-1">
            Parcial
          </p>
        </div>
        <div
          className={`bg-white rounded-xl shadow-sm border border-gray-200 p-4 text-center cursor-pointer transition-all ${filtroStatus === 'pendente' ? 'ring-2 ring-red-500' : 'hover:border-red-300'}`}
          onClick={() =>
            setFiltroStatus(filtroStatus === 'pendente' ? 'todos' : 'pendente')
          }
        >
          <p className="text-2xl font-bold text-red-600">{totalPendente}</p>
          <p className="text-[10px] text-gray-400 uppercase tracking-wider mt-1">
            Pendente
          </p>
        </div>
      </div>

      {/* Barra de busca + exportar */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 mb-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="relative flex-1">
          <MagnifyingGlass
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            type="text"
            value={termoBusca}
            onChange={(e) => setTermoBusca(e.target.value)}
            placeholder="Buscar por código, nome, fantasia ou CNPJ..."
            className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#000638] bg-gray-50"
          />
        </div>
        <button
          onClick={exportarExcel}
          disabled={dadosFiltrados.length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
        >
          <FileArrowDown size={16} weight="bold" /> Exportar Excel
        </button>
      </div>

      {/* Erro */}
      {erro && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
          <p className="text-sm text-red-600">{erro}</p>
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-16 flex flex-col items-center justify-center gap-3">
          <Spinner size={40} className="animate-spin text-[#000638]" />
          <p className="text-sm text-gray-500">
            Carregando clientes multimarcas...
          </p>
        </div>
      ) : clientes.length > 0 ? (
        <>
          {/* Info de resultados */}
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-gray-500">
              {dadosFiltrados.length} cliente
              {dadosFiltrados.length !== 1 ? 's' : ''} encontrado
              {dadosFiltrados.length !== 1 ? 's' : ''}
              {filtroStatus !== 'todos' && ` (filtro: ${filtroStatus})`}
            </p>
          </div>

          {/* Tabela */}
          <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#000638] text-white text-[11px] uppercase tracking-wider">
                  <th
                    className="text-left px-3 py-2.5 cursor-pointer select-none hover:bg-[#000638]/80"
                    onClick={() => handleOrdenacao('code')}
                  >
                    <div className="flex items-center gap-1">
                      Código {getIconeOrdenacao('code')}
                    </div>
                  </th>
                  <th
                    className="text-left px-3 py-2.5 cursor-pointer select-none hover:bg-[#000638]/80"
                    onClick={() => handleOrdenacao('name')}
                  >
                    <div className="flex items-center gap-1">
                      Nome {getIconeOrdenacao('name')}
                    </div>
                  </th>
                  <th
                    className="text-left px-3 py-2.5 cursor-pointer select-none hover:bg-[#000638]/80"
                    onClick={() => handleOrdenacao('fantasyName')}
                  >
                    <div className="flex items-center gap-1">
                      Nome Fantasia {getIconeOrdenacao('fantasyName')}
                    </div>
                  </th>
                  <th
                    className="text-center px-3 py-2.5 cursor-pointer select-none hover:bg-[#000638]/80"
                    onClick={() => handleOrdenacao('status')}
                  >
                    <div className="flex items-center justify-center gap-1">
                      Status {getIconeOrdenacao('status')}
                    </div>
                  </th>
                  <th className="text-center px-3 py-2.5">Detalhes</th>
                  <th className="text-center px-3 py-2.5">Ação</th>
                </tr>
              </thead>
              <tbody>
                {dadosPaginados.map((cliente, index) => (
                  <tr
                    key={cliente.code}
                    className={`border-b border-gray-100 transition-colors hover:bg-blue-50/30 ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}
                  >
                    <td className="px-3 py-2 text-gray-700 font-mono text-xs">
                      {cliente.code}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => abrirPerfilCliente(cliente)}
                        className="text-blue-600 hover:text-blue-800 hover:underline font-medium text-left text-sm"
                        title="Ver perfil dos clientes"
                      >
                        {cliente.name || '--'}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-gray-600 text-sm">
                      {cliente.fantasyName || '--'}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <StatusBadge code={cliente.code} />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <StatusDetalhe code={cliente.code} />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => abrirPerfilCliente(cliente)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#000638] text-white text-[10px] font-semibold rounded-lg hover:bg-[#000638]/80 transition-colors"
                      >
                        <Eye size={12} /> Ver Perfil
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Paginação */}
          {totalPaginas > 1 && (
            <div className="flex items-center justify-center gap-1 mt-4">
              <button
                onClick={() => setPaginaAtual((p) => Math.max(1, p - 1))}
                disabled={paginaAtual === 1}
                className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <CaretLeft size={16} />
              </button>
              {getPaginasVisiveis().map((pagina, idx) =>
                pagina === '...' ? (
                  <span
                    key={`dots-${idx}`}
                    className="px-2 text-gray-400 text-xs"
                  >
                    ...
                  </span>
                ) : (
                  <button
                    key={pagina}
                    onClick={() => setPaginaAtual(pagina)}
                    className={`min-w-[32px] h-8 rounded-lg text-xs font-medium transition-colors ${
                      paginaAtual === pagina
                        ? 'bg-[#000638] text-white'
                        : 'hover:bg-gray-100 text-gray-700'
                    }`}
                  >
                    {pagina}
                  </button>
                ),
              )}
              <button
                onClick={() =>
                  setPaginaAtual((p) => Math.min(totalPaginas, p + 1))
                }
                disabled={paginaAtual === totalPaginas}
                className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <CaretRight size={16} />
              </button>
            </div>
          )}
        </>
      ) : (
        !erro && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-16 text-center text-gray-400">
            <p className="text-sm">Nenhum cliente multimarcas encontrado</p>
          </div>
        )
      )}

      {/* Modal Perfil */}
      <ClientePerfilModal
        isOpen={perfilModalAberto}
        onClose={fecharPerfilModal}
        clienteCode={clientePerfilData?.code}
        clienteNome={clientePerfilData?.nome}
        clienteCnpj={clientePerfilData?.cnpj}
      />
    </div>
  );
};

export default ClientesMTM;
