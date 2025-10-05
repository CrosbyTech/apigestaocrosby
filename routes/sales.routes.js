import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useTransacoesOperacao } from '../hooks/useTransacoesOperacao';
import ModalTransacoesOperacao from '../components/ModalTransacoesOperacao';
import ModalDetalharTransacao from '../components/ModalDetalharTransacao';
import PageTitle from '../components/ui/PageTitle';
import useApiClient from '../hooks/useApiClient';
import LoadingSpinner from '../components/LoadingSpinner';
import FiltroEmpresa from '../components/FiltroEmpresa';
import {
  FileText,
  Funnel,
  CaretDown,
  CaretRight,
  TrendUp,
  TrendDown,
  CurrencyDollar,
  Receipt,
  Eye,
  Trash,
} from '@phosphor-icons/react';

const AuditoriaTransacoes = () => {
  // Cache para evitar consultas repetidas (similar ao DRE)
  const [auditoriaCache, setAuditoriaCache] = useState(new Map());
  const [lastCacheClean, setLastCacheClean] = useState(Date.now());
  const CACHE_TTL = 30 * 60 * 1000; // 30 minutos

  const api = useApiClient();
  const {
    abrirModal,
    fecharModal,
    modalAberto,
    loading: modalLoading,
    transacoes,
    operacao,
    erro: modalErro,
    detalharTransacao,
    fecharDetalhes,
    detalhesAberto,
    detalhesLoading,
    detalhesItens,
    detalhesErro,
  } = useTransacoesOperacao(api);

  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [erro, setErro] = useState('');
  const [dados, setDados] = useState(null);
  const [categoriasExpandidas, setCategoriasExpandidas] = useState(new Set());

  // Limpar cache expirado periodicamente (similar ao DRE)
  const cleanExpiredCache = useCallback(() => {
    const now = Date.now();
    const newCache = new Map();
    for (const [key, value] of auditoriaCache.entries()) {
      if (now - value.timestamp < CACHE_TTL) {
        newCache.set(key, value);
      }
    }
    setAuditoriaCache(newCache);
    setLastCacheClean(now);
  }, [auditoriaCache, CACHE_TTL]);

  // Limpar cache a cada 10 minutos ou quando necessário
  useEffect(() => {
    const now = Date.now();
    if (now - lastCacheClean > 10 * 60 * 1000) {
      cleanExpiredCache();
    }
  }, [cleanExpiredCache, lastCacheClean]);

  // Estados para filtros
  const [filtros, setFiltros] = useState({
    dt_inicio: '',
    dt_fim: '',
  });
  const [empresasSelecionadas, setEmpresasSelecionadas] = useState([]);

  // Inicializar datas padrão (último mês)
  useEffect(() => {
    const hoje = new Date();
    const primeiroDia = new Date(hoje.getFullYear(), hoje.getMonth(), 1)
      .toISOString()
      .split('T')[0];
    const ultimoDia = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0)
      .toISOString()
      .split('T')[0];
    setFiltros({ dt_inicio: primeiroDia, dt_fim: ultimoDia });
  }, []);

  const handleSelectEmpresas = (empresas) => {
    setEmpresasSelecionadas(empresas);
  };

  const toggleCategoria = (categoria) => {
    const novasExpandidas = new Set(categoriasExpandidas);
    if (novasExpandidas.has(categoria)) {
      novasExpandidas.delete(categoria);
    } else {
      novasExpandidas.add(categoria);
    }
    setCategoriasExpandidas(novasExpandidas);
  };

  const limparCache = () => {
    setAuditoriaCache(new Map());
    setLastCacheClean(Date.now());
    console.log('🗑️ Cache da auditoria limpo!');
  };

  const buscar = useCallback(async () => {
    if (!filtros.dt_inicio || !filtros.dt_fim) {
      setErro('Data início e data fim são obrigatórias');
      return;
    }

    // Criar chave do cache
    const empresasFiltradas = (empresasSelecionadas || [])
      .filter(
        (emp) =>
          emp &&
          emp.cd_empresa !== undefined &&
          emp.cd_empresa !== null &&
          emp.cd_empresa !== '',
      )
      .map((emp) => emp.cd_empresa);

    const cacheKey = `auditoria_${filtros.dt_inicio}_${
      filtros.dt_fim
    }_${JSON.stringify(empresasFiltradas)}`;

    // Verificar cache primeiro
    const cachedResult = auditoriaCache.get(cacheKey);
    if (cachedResult && Date.now() - cachedResult.timestamp < CACHE_TTL) {
      console.log(`📦 Usando dados do cache para ${cacheKey}`);
      setDados(cachedResult.data);
      if (cachedResult.data.categorias) {
        setCategoriasExpandidas(
          new Set(Object.keys(cachedResult.data.categorias)),
        );
      }
      return;
    }

    try {
      setLoading(true);
      setLoadingStatus('Buscando dados de auditoria (consulta otimizada)...');
      setErro('');

      const params = {
        dt_inicio: filtros.dt_inicio,
        dt_fim: filtros.dt_fim,
      };

      // Adicionar empresas se selecionadas
      if (empresasFiltradas.length > 0) {
        params.cd_empresa = empresasFiltradas;
      }

      console.log(
        '📊 Buscando auditoria de transações com parâmetros:',
        params,
      );

      const startTime = Date.now();
      const result = await api.sales.auditoriaTransacoes(params);
      const queryTime = Date.now() - startTime;

      console.log(`✅ Dados recebidos em ${queryTime}ms:`, result);

      if (result && result.success && result.data) {
        console.log('🎯 Definindo dados:', result.data);

        // Salvar no cache
        auditoriaCache.set(cacheKey, {
          data: result.data,
          timestamp: Date.now(),
        });
        setAuditoriaCache(new Map(auditoriaCache));

        setDados(result.data);

        // Expandir todas as categorias por padrão
        if (result.data.categorias) {
          setCategoriasExpandidas(new Set(Object.keys(result.data.categorias)));
        }
      } else {
        console.log('❌ Dados não encontrados ou formato inválido:', result);
        setErro('Nenhum dado encontrado ou formato de resposta inválido');
      }
    } catch (error) {
      console.error('❌ Erro ao buscar dados:', error);
      setErro(error.message || 'Erro ao buscar dados');
    } finally {
      setLoading(false);
      setLoadingStatus('');
    }
  }, [filtros, empresasSelecionadas, auditoriaCache, api.sales, CACHE_TTL]);

  const formatarMoeda = (valor) => {
    const valorNumerico = Number(valor) || 0;
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(valorNumerico);
  };

  const formatarNumero = (numero) => {
    const numeroValido = Number(numero) || 0;
    return new Intl.NumberFormat('pt-BR').format(numeroValido);
  };

  // Cores para diferentes tipos de operação
  const getCoresTipoOperacao = (tp_operacao) => {
    switch (tp_operacao) {
      case 'S': // Saída
        return 'text-red-600 bg-red-50';
      case 'E': // Entrada
        return 'text-green-600 bg-green-50';
      default:
        return 'text-gray-600 bg-gray-50';
    }
  };

  const getIconeTipoOperacao = (tp_operacao) => {
    switch (tp_operacao) {
      case 'S': // Saída
        return <TrendDown size={14} className="text-red-600" />;
      case 'E': // Entrada
        return <TrendUp size={14} className="text-green-600" />;
      default:
        return <Receipt size={14} className="text-gray-600" />;
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto p-4">
      <PageTitle
        title="Auditoria de Transações"
        subtitle="Consulta de dados da rota /auditoria-transacoes"
        icon={FileText}
        iconColor="text-blue-600"
      />

      {/* Filtros */}
      <div className="bg-white rounded-lg shadow p-4 mb-4 border border-gray-200">
        <div className="flex items-center gap-2 mb-3">
          <Funnel size={18} weight="bold" className="text-[#000638]" />
          <span className="text-lg font-bold text-[#000638]">Filtros</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
          <div className="lg:col-span-2">
            <FiltroEmpresa
              empresasSelecionadas={empresasSelecionadas}
              onSelectEmpresas={handleSelectEmpresas}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1 text-[#000638]">
              Data Início
            </label>
            <input
              type="date"
              value={filtros.dt_inicio}
              onChange={(e) =>
                setFiltros((f) => ({ ...f, dt_inicio: e.target.value }))
              }
              className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1 text-[#000638]">
              Data Fim
            </label>
            <input
              type="date"
              value={filtros.dt_fim}
              onChange={(e) =>
                setFiltros((f) => ({ ...f, dt_fim: e.target.value }))
              }
              className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={buscar}
            disabled={loading || !filtros.dt_inicio || !filtros.dt_fim}
            className="bg-[#000638] text-white text-xs px-4 py-2 rounded-lg hover:bg-[#fe0000] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
          >
            <Eye size={14} />
            Buscar
          </button>
          <button
            onClick={limparCache}
            disabled={loading}
            className="bg-gray-600 text-white text-xs px-4 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
            title="Limpar cache e forçar nova consulta"
          >
            <Trash size={14} />
            Limpar Cache
          </button>
        </div>
      </div>

      {/* Erro */}
      {erro && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
          <div className="flex items-center gap-2">
            <span className="text-red-500">⚠️</span>
            <span className="font-medium">{erro}</span>
          </div>
        </div>
      )}

      {/* Dados */}
      {dados && (
        <div className="space-y-4">
          {/* Resumo geral com card FATURAMENTO */}
          <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
            <div className="flex items-center gap-2 mb-3">
              <CurrencyDollar
                size={18}
                weight="bold"
                className="text-[#000638]"
              />
              <span className="text-lg font-bold text-[#000638]">
                Resumo Geral
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Card FATURAMENTO */}
              <div className="bg-blue-50 p-3 rounded-lg">
                <p className="text-xs text-blue-600 font-semibold">
                  Faturamento
                </p>
                {(() => {
                  // Soma VENDA + DEVOLUCAO VENDA
                  const venda = dados.categorias?.VENDA?.totais || {};
                  const devolucao =
                    dados.categorias?.['DEVOLUCAO VENDA']?.totais || {};
                  const totalLiquido =
                    (venda.valor_liquido || 0) - (devolucao.valor_liquido || 0);
                  return (
                    <div>
                      <div className="flex flex-col gap-1">
                        <span className="text-lg text-gray-600">
                          Valor Líquido:{' '}
                          <span className="font-bold text-blue-800">
                            {formatarMoeda(totalLiquido)}
                          </span>
                        </span>
                      </div>
                    </div>
                  );
                })()}
              </div>
              {/* Total Transações Geral */}
              <div className="bg-green-50 p-3 rounded-lg">
                <p className="text-xs text-green-600 font-semibold">
                  Total Transações
                </p>
                <p className="text-lg font-bold text-green-800">
                  {formatarNumero(dados.totais_gerais?.nr_transacoes)}
                </p>
              </div>
              {/* Valor Bruto Geral */}
              <div className="bg-purple-50 p-3 rounded-lg">
                <p className="text-xs text-purple-600 font-semibold">
                  Valor Bruto
                </p>
                {(() => {
                  // Soma todos os valores brutos de todas as categorias
                  const totalBruto = dados.categorias
                    ? Object.values(dados.categorias).reduce(
                        (acc, categoria) => {
                          return acc + (categoria.totais?.valor_bruto || 0);
                        },
                        0,
                      )
                    : 0;
                  return (
                    <p className="text-lg font-bold text-purple-800">
                      {formatarMoeda(totalBruto)}
                    </p>
                  );
                })()}
              </div>
              {/* Valor Líquido Geral */}
              <div className="bg-orange-50 p-3 rounded-lg">
                <p className="text-xs text-orange-600 font-semibold">
                  Valor Líquido
                </p>
                {(() => {
                  // Soma todos os valores líquidos de todas as categorias
                  const totalLiquido = dados.categorias
                    ? Object.values(dados.categorias).reduce(
                        (acc, categoria) => {
                          return acc + (categoria.totais?.valor_liquido || 0);
                        },
                        0,
                      )
                    : 0;
                  return (
                    <p className="text-lg font-bold text-orange-800">
                      {formatarMoeda(totalLiquido)}
                    </p>
                  );
                })()}
              </div>
            </div>
          </div>

          {/* Categorias */}
          {dados.categorias && Object.keys(dados.categorias).length > 0 && (
            <div className="space-y-3">
              {Object.entries(dados.categorias).map(
                ([categoria, dadosCategoria]) => (
                  <div
                    key={categoria}
                    className="bg-white rounded-lg shadow border border-gray-200"
                  >
                    {/* Header da categoria */}
                    <div
                      className="p-4 cursor-pointer hover:bg-gray-50 transition-colors border-b border-gray-200"
                      onClick={() => toggleCategoria(categoria)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {categoriasExpandidas.has(categoria) ? (
                            <CaretDown size={16} className="text-[#000638]" />
                          ) : (
                            <CaretRight size={16} className="text-[#000638]" />
                          )}
                          <h3 className="text-lg font-bold text-[#000638]">
                            {categoria}
                          </h3>
                        </div>
                        <div className="flex items-center gap-4 text-sm">
                          <span className="text-gray-600">
                            {formatarNumero(
                              dadosCategoria.totais?.nr_transacoes,
                            )}{' '}
                            transações
                          </span>
                          <span className="font-bold text-[#000638]">
                            {formatarMoeda(
                              dadosCategoria.totais?.valor_liquido,
                            )}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Conteúdo expandível */}
                    {categoriasExpandidas.has(categoria) && (
                      <div className="p-4">
                        {/* Totais da categoria */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 p-3 bg-gray-50 rounded-lg">
                          <div>
                            <p className="text-xs text-gray-600 font-semibold">
                              Transações
                            </p>
                            <p className="text-sm font-bold text-gray-800">
                              {formatarNumero(
                                dadosCategoria.totais?.nr_transacoes,
                              )}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-600 font-semibold">
                              Quantidade
                            </p>
                            <p className="text-sm font-bold text-gray-800">
                              {formatarNumero(
                                dadosCategoria.totais?.quantidade_total,
                              )}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-600 font-semibold">
                              Valor Bruto
                            </p>
                            <p className="text-sm font-bold text-gray-800">
                              {formatarMoeda(
                                dadosCategoria.totais?.valor_bruto,
                              )}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-600 font-semibold">
                              Valor Líquido
                            </p>
                            <p className="text-sm font-bold text-gray-800">
                              {formatarMoeda(
                                dadosCategoria.totais?.valor_liquido,
                              )}
                            </p>
                          </div>
                        </div>

                        {/* Operações */}
                        {dadosCategoria.operacoes &&
                          dadosCategoria.operacoes.length > 0 && (
                            <div className="space-y-2">
                              <h4 className="text-sm font-semibold text-gray-700 mb-2">
                                Operações:
                              </h4>
                              <div className="grid gap-2">
                                {dadosCategoria.operacoes.map(
                                  (operacao, index) => (
                                    <div
                                      key={`${operacao.cd_operacao}-${index}`}
                                      className="border border-gray-200 rounded-lg p-3 hover:bg-blue-50 transition-colors cursor-pointer"
                                      onClick={() =>
                                        abrirModal(operacao.cd_operacao, {
                                          dt_inicio: filtros.dt_inicio,
                                          dt_fim: filtros.dt_fim,
                                          cd_empresa: empresasSelecionadas.map(
                                            (e) => e.cd_empresa,
                                          ),
                                        })
                                      }
                                      title="Ver transações desta operação"
                                    >
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                          {getIconeTipoOperacao(
                                            operacao.tp_operacao,
                                          )}
                                          <span className="font-semibold text-gray-800">
                                            Operação {operacao.cd_operacao}
                                          </span>
                                          <span
                                            className={`px-2 py-1 rounded-full text-xs font-semibold ${getCoresTipoOperacao(
                                              operacao.tp_operacao,
                                            )}`}
                                          >
                                            {operacao.tp_operacao === 'S'
                                              ? 'Saída'
                                              : 'Entrada'}
                                          </span>
                                        </div>
                                        <div className="text-right">
                                          <p className="text-sm font-bold text-gray-800">
                                            {formatarMoeda(
                                              operacao.valor_liquido,
                                            )}
                                          </p>
                                        </div>
                                      </div>
                                      <div className="grid grid-cols-3 gap-4 mt-2 text-xs text-gray-600">
                                        <div>
                                          <span className="font-semibold">
                                            Transações:
                                          </span>{' '}
                                          {formatarNumero(
                                            operacao.nr_transacoes,
                                          )}
                                        </div>
                                        <div>
                                          <span className="font-semibold">
                                            Quantidade:
                                          </span>{' '}
                                          {formatarNumero(
                                            operacao.quantidade_total,
                                          )}
                                        </div>
                                        <div>
                                          <span className="font-semibold">
                                            Valor Bruto:
                                          </span>{' '}
                                          {formatarMoeda(operacao.valor_bruto)}
                                        </div>
                                      </div>
                                    </div>
                                  ),
                                )}
                              </div>
                            </div>
                          )}
                      </div>
                    )}
                  </div>
                ),
              )}
            </div>
          )}

          {/* Informações adicionais */}
          {dados.count !== undefined && (
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-sm text-gray-600">
                📊 Total de {formatarNumero(dados.count)} registros processados
              </p>
              {dados.estrutura_similar_dadostotvs && (
                <p className="text-xs text-gray-500 mt-1">
                  ✅ Estrutura compatível com DADOSTOTVS.TXT
                </p>
              )}
            </div>
          )}
          {/* Modal de transações por operação (agregado) */}
          <ModalTransacoesOperacao
            open={modalAberto}
            onClose={fecharModal}
            loading={loading}
            transacoes={transacoes}
            operacao={operacao}
            erro={erro}
            onDetalhar={(nr_transacao) =>
              detalharTransacao(nr_transacao, {
                dt_inicio: filtros.dt_inicio,
                dt_fim: filtros.dt_fim,
                cd_empresa: empresasSelecionadas.map((e) => e.cd_empresa),
              })
            }
          />

          <ModalDetalharTransacao
            open={detalhesAberto}
            onClose={fecharDetalhes}
            loading={detalhesLoading}
            itens={detalhesItens}
            erro={detalhesErro}
          />
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="bg-white rounded-lg shadow p-8 border border-gray-200">
          <div className="flex flex-col items-center justify-center">
            <LoadingSpinner size="lg" />
            <p className="text-gray-600 mt-2">
              {loadingStatus || 'Buscando dados da auditoria...'}
            </p>
            {loadingStatus && (
              <p className="text-xs text-gray-500 mt-1">
                Consulta otimizada com cache • Tempo estimado: 5-15s
              </p>
            )}
          </div>
        </div>
      )}

      {/* Estado vazio */}
      {!loading && !dados && !erro && (
        <div className="bg-white rounded-lg shadow p-8 border border-gray-200 text-center">
          <FileText size={48} className="text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-600 mb-2">
            Auditoria de Transações
          </h3>
          <p className="text-gray-500 mb-4">
            Selecione o período e as empresas para visualizar os dados da
            auditoria.
          </p>
          <p className="text-xs text-gray-400">
            Esta consulta utiliza a rota /auditoria-transacoes do backend
          </p>
        </div>
      )}
    </div>
  );
};

export default AuditoriaTransacoes;
