import React, { useState, useMemo, useEffect, useCallback } from 'react';
import PageTitle from '../components/ui/PageTitle';
import useApiClient from '../hooks/useApiClient';
import LoadingSpinner from '../components/LoadingSpinner';
import CalendarioPeriodosDRE from '../components/CalendarioPeriodosDRE';
import ModalAdicionarDespesaManual from '../components/ModalAdicionarDespesaManual';
import { listarDespesasManuais } from '../services/despesasManuaisService';
import { buscarObservacoesPeriodo } from '../services/observacoesDespesasService';
import { buscarObservacoesMultiplasDespesas } from '../services/observacoesDespesasManuaisService'; // 🆕 Importar service de observações manuais
import {
  CaretDown,
  CaretRight,
  Dot,
  TrendUp,
  TrendDown,
  CurrencyDollar,
  Folder,
  FileText,
  Funnel,
  Plus,
} from '@phosphor-icons/react';
import { getCategoriaPorCodigo } from '../config/categoriasDespesas';
import ModalDetalhesDespesaManual from '../components/ModalDetalhesDespesaManual';

const DRE = () => {
  const api = useApiClient();
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [error, setError] = useState('');
  const [vendasBrutas, setVendasBrutas] = useState(0);
  const [devolucoes, setDevolucoes] = useState(0);
  const [descontos, setDescontos] = useState(0);
  const [totalDeducoes, setTotalDeducoes] = useState(0);
  const [cmv, setCmv] = useState(0);
  const [receitaLiquida, setReceitaLiquida] = useState(0);
  const [lucroBruto, setLucroBruto] = useState(0);
  const [modalDespManual, setModalDespManual] = useState(false);
  const [despesaSelecionada, setDespesaSelecionada] = useState(null);

  // Estados para totais por canal
  const [totaisVarejo, setTotaisVarejo] = useState({
    totalBruto: 0,
    totalDevolucoes: 0,
    totalCMV: 0,
    totalLiquido: 0,
    totalDescontos: 0,
  });
  const [totaisMultimarcas, setTotaisMultimarcas] = useState({
    totalBruto: 0,
    totalDevolucoes: 0,
    totalCMV: 0,
    totalLiquido: 0,
    totalDescontos: 0,
  });
  const [totaisFranquias, setTotaisFranquias] = useState({
    totalBruto: 0,
    totalDevolucoes: 0,
    totalCMV: 0,
    totalLiquido: 0,
    totalDescontos: 0,
  });
  const [totaisRevenda, setTotaisRevenda] = useState({
    totalBruto: 0,
    totalDevolucoes: 0,
    totalCMV: 0,
    totalLiquido: 0,
    totalDescontos: 0,
  });
  // Despesas Operacionais (Contas a Pagar - Emissão)
  const [planoDespesasNodes, setPlanoDespesasNodes] = useState([]);
  const [planoDespesasTotal, setPlanoDespesasTotal] = useState(0);
  // Despesas Financeiras separadas do plano de despesas
  const [planoDespesasFinanceirasNodes, setPlanoDespesasFinanceirasNodes] =
    useState([]);
  const [planoDespesasFinanceirasTotal, setPlanoDespesasFinanceirasTotal] =
    useState(0);

  // Despesas do Período 2
  const [planoDespesasNodesPeriodo2, setPlanoDespesasNodesPeriodo2] = useState(
    [],
  );
  const [
    planoDespesasFinanceirasNodesPeriodo2,
    setPlanoDespesasFinanceirasNodesPeriodo2,
  ] = useState([]);

  // Lista de despesas (cd_despesaitem) a serem excluídas do cálculo/visualização
  const [despesasExcluidas, setDespesasExcluidas] = useState(
    new Set([
      117, 124, 270, 271, 272, 5006, 5007, 5013, 5014, 11006, 11008, 11004,
      11003, 11009, 11009, 11007, 11005, 11001, 14000, 13000,
    ]),
  );

  // Utilitário: verifica se um código de despesa deve ser excluído
  const shouldExcluirDespesa = (cd) => {
    const n = Number(cd);
    if (Number.isNaN(n)) return false;
    return despesasExcluidas.has(n);
  };

  // API simples para gerenciar exclusões (pode ser chamada de outras partes da app)
  const excluirDespesaPorCodigo = (codigos) => {
    setDespesasExcluidas((prev) => {
      const next = new Set(prev);
      (Array.isArray(codigos) ? codigos : [codigos]).forEach((c) => {
        const n = Number(c);
        if (!Number.isNaN(n)) next.add(n);
      });
      return next;
    });
  };

  const definirDespesasExcluidas = (lista) => {
    const next = new Set(
      (lista || []).map((c) => Number(c)).filter((n) => !Number.isNaN(n)),
    );
    setDespesasExcluidas(next);
  };

  const limparDespesasExcluidas = () => setDespesasExcluidas(new Set());

  // Estados para impostos reais
  const [icms, setIcms] = useState(0);
  const [pis, setPis] = useState(0);
  const [cofins, setCofins] = useState(0);
  const [totalImpostos, setTotalImpostos] = useState(0);

  // Estados para impostos por canal
  const [impostosVarejo, setImpostosVarejo] = useState({
    icms: 0,
    pis: 0,
    cofins: 0,
  });
  const [impostosMultimarcas, setImpostosMultimarcas] = useState({
    icms: 0,
    pis: 0,
    cofins: 0,
  });
  const [impostosFranquias, setImpostosFranquias] = useState({
    icms: 0,
    pis: 0,
    cofins: 0,
  });
  const [impostosRevenda, setImpostosRevenda] = useState({
    icms: 0,
    pis: 0,
    cofins: 0,
  });

  // Estados para receitas líquidas por canal
  const [receitaLiquidaVarejo, setReceitaLiquidaVarejo] = useState(0);
  const [receitaLiquidaMultimarcas, setReceitaLiquidaMultimarcas] = useState(0);
  const [receitaLiquidaFranquias, setReceitaLiquidaFranquias] = useState(0);
  const [receitaLiquidaRevenda, setReceitaLiquidaRevenda] = useState(0);

  // Estados para CMV por canal
  const [cmvVarejo, setCmvVarejo] = useState(0);
  const [cmvMultimarcas, setCmvMultimarcas] = useState(0);
  const [cmvFranquias, setCmvFranquias] = useState(0);
  const [cmvRevenda, setCmvRevenda] = useState(0);

  // Estados para lucro bruto por canal
  const [lucroBrutoVarejo, setLucroBrutoVarejo] = useState(0);
  const [lucroBrutoMultimarcas, setLucroBrutoMultimarcas] = useState(0);
  const [lucroBrutoFranquias, setLucroBrutoFranquias] = useState(0);
  const [lucroBrutoRevenda, setLucroBrutoRevenda] = useState(0);

  // Sistema de múltiplos períodos
  const [periodos, setPeriodos] = useState([
    {
      id: 1,
      dt_inicio: '',
      dt_fim: '',
      filtroMensal: 'ANO',
      empresas: [1, 2, 3, 4, 5],
    },
  ]);

  // Dados de cada período (array de objetos com dados DRE)
  const [dadosPeriodos, setDadosPeriodos] = useState([]);

  // Manter compatibilidade com código existente (período principal = primeiro da lista)
  const periodo = periodos[0] || {
    dt_inicio: '',
    dt_fim: '',
    empresas: [1, 2, 3, 4, 5],
  };
  const setPeriodo = (updater) => {
    setPeriodos((prev) => {
      const newPeriodos = [...prev];
      newPeriodos[0] =
        typeof updater === 'function' ? updater(newPeriodos[0]) : updater;
      return newPeriodos;
    });
  };
  const [filtroMensal, setFiltroMensal] = useState('ANO');
  const [filtroMensalComparacao, setFiltroMensalComparacao] = useState('ANO');

  // Estados para análise horizontal/vertical
  const [tipoAnalise, setTipoAnalise] = useState('vertical'); // 'vertical' ou 'horizontal'

  // Estado para controlar modal de despesas manuais
  const [modalDespesaManualAberto, setModalDespesaManualAberto] =
    useState(false);

  // Manter compatibilidade (periodoComparacao = segundo período)
  const periodoComparacao = periodos[1] || { dt_inicio: '', dt_fim: '' };
  const setPeriodoComparacao = (updater) => {
    setPeriodos((prev) => {
      const newPeriodos = [...prev];
      if (newPeriodos.length < 2) {
        newPeriodos.push({
          id: 2,
          dt_inicio: '',
          dt_fim: '',
          filtroMensal: 'ANO',
          empresas: [1, 2, 3, 4, 5],
        });
      }
      newPeriodos[1] =
        typeof updater === 'function' ? updater(newPeriodos[1]) : updater;
      return newPeriodos;
    });
  };

  // Estados para dados do período de comparação (Período 2)
  const [dadosPeriodo2, setDadosPeriodo2] = useState({
    vendasBrutas: 0,
    devolucoes: 0,
    descontos: 0,
    totalDeducoes: 0,
    cmv: 0,
    receitaLiquida: 0,
    lucroBruto: 0,
    icms: 0,
    pis: 0,
    cofins: 0,
    totalImpostos: 0,
    planoDespesasTotal: 0,
    planoDespesasFinanceirasTotal: 0,
    // Dados por canal
    totaisVarejo: {
      totalBruto: 0,
      totalDevolucoes: 0,
      totalCMV: 0,
      totalLiquido: 0,
      totalDescontos: 0,
    },
    totaisMultimarcas: {
      totalBruto: 0,
      totalDevolucoes: 0,
      totalCMV: 0,
      totalLiquido: 0,
      totalDescontos: 0,
    },
    totaisFranquias: {
      totalBruto: 0,
      totalDevolucoes: 0,
      totalCMV: 0,
      totalLiquido: 0,
      totalDescontos: 0,
    },
    totaisRevenda: {
      totalBruto: 0,
      totalDevolucoes: 0,
      totalCMV: 0,
      totalLiquido: 0,
      totalDescontos: 0,
    },
    impostosVarejo: { icms: 0, pis: 0, cofins: 0 },
    impostosMultimarcas: { icms: 0, pis: 0, cofins: 0 },
    impostosFranquias: { icms: 0, pis: 0, cofins: 0 },
    impostosRevenda: { icms: 0, pis: 0, cofins: 0 },
    receitaLiquidaVarejo: 0,
    receitaLiquidaMultimarcas: 0,
    receitaLiquidaFranquias: 0,
    receitaLiquidaRevenda: 0,
    cmvVarejo: 0,
    cmvMultimarcas: 0,
    cmvFranquias: 0,
    cmvRevenda: 0,
    lucroBrutoVarejo: 0,
    lucroBrutoMultimarcas: 0,
    lucroBrutoFranquias: 0,
    lucroBrutoRevenda: 0,
  });

  const obterDiasDoMes = (mesNumero, anoNumero) => {
    // Retorna o último dia do mês considerando ano bissexto
    return new Date(anoNumero, mesNumero, 0).getDate();
  };

  // Funções para gerenciar múltiplos períodos
  const adicionarPeriodo = () => {
    const novoId = Math.max(...periodos.map((p) => p.id), 0) + 1;
    setPeriodos((prev) => [
      ...prev,
      {
        id: novoId,
        dt_inicio: '',
        dt_fim: '',
        filtroMensal: 'ANO',
        empresas: [1, 2, 3, 4, 5],
      },
    ]);
  };

  const removerPeriodo = (id) => {
    if (periodos.length <= 1) {
      alert('É necessário ter pelo menos 1 período!');
      return;
    }
    setPeriodos((prev) => prev.filter((p) => p.id !== id));
    setDadosPeriodos((prev) => prev.filter((d) => d.periodoId !== id));
  };

  const atualizarPeriodo = (id, campo, valor) => {
    setPeriodos((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [campo]: valor } : p)),
    );
  };

  const handleFiltroMensalChange = (mesSigla, periodoId) => {
    if (mesSigla === 'ANO') {
      atualizarPeriodo(periodoId, 'filtroMensal', mesSigla);
      return;
    }

    const mesesMap = {
      JAN: 1,
      FEV: 2,
      MAR: 3,
      ABR: 4,
      MAI: 5,
      JUN: 6,
      JUL: 7,
      AGO: 8,
      SET: 9,
      OUT: 10,
      NOV: 11,
      DEZ: 12,
    };

    const mesNumero = mesesMap[mesSigla];
    if (!mesNumero) return;

    const periodoAtual = periodos.find((p) => p.id === periodoId);
    const anoBase = (() => {
      if (periodoAtual?.dt_inicio) {
        const [y] = periodoAtual.dt_inicio.split('-');
        const n = parseInt(y, 10);
        if (n > 1900) return n;
      }
      return new Date().getFullYear();
    })();

    const primeiroDia = `${anoBase}-${String(mesNumero).padStart(2, '0')}-01`;
    const ultimoDiaNum = obterDiasDoMes(mesNumero, anoBase);
    const ultimoDia = `${anoBase}-${String(mesNumero).padStart(
      2,
      '0',
    )}-${String(ultimoDiaNum).padStart(2, '0')}`;

    setPeriodos((prev) =>
      prev.map((p) =>
        p.id === periodoId
          ? {
              ...p,
              dt_inicio: primeiroDia,
              dt_fim: ultimoDia,
              filtroMensal: mesSigla,
            }
          : p,
      ),
    );
  };

  // Função de obter nome do mês a partir da sigla
  const obterNomeMesPorSigla = (sigla) => {
    const mesesMap = {
      ANO: 'Ano',
      JAN: 'Janeiro',
      FEV: 'Fevereiro',
      MAR: 'Março',
      ABR: 'Abril',
      MAI: 'Maio',
      JUN: 'Junho',
      JUL: 'Julho',
      AGO: 'Agosto',
      SET: 'Setembro',
      OUT: 'Outubro',
      NOV: 'Novembro',
      DEZ: 'Dezembro',
    };
    return mesesMap[sigla] || 'Período';
  };

  const [expandedNodes, setExpandedNodes] = useState({
    'vendas-bruta': true,
    'deducoes-vendas': true,
    'impostos-vendas': true,
    'receita-liquida': true,
    'lucro-bruto': true,
    'despesas-operacionais': true,
    'resultado-operacional': true,
    'outras-receitas-despesas': true,
    'despesas-financeiras': true,
    'lucro-antes-impostos': true,
    'impostos-lucro': true,
    'lucro-liquido': true,
  });

  // Estados para controle de expansão no estilo Contas a Pagar
  const [categoriasExpandidas, setCategoriasExpandidas] = useState(new Set());
  const [todosExpandidos, setTodosExpandidos] = useState(false);

  // Inicializar período padrão
  useEffect(() => {
    const hoje = new Date();
    const primeiroDia = new Date(hoje.getFullYear(), hoje.getMonth(), 1)
      .toISOString()
      .split('T')[0];
    const ultimoDia = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0)
      .toISOString()
      .split('T')[0];

    setPeriodo((prev) => ({
      ...prev,
      dt_inicio: primeiroDia,
      dt_fim: ultimoDia,
    }));
  }, []);

  // 🆕 Função helper para atualizar observação na árvore de despesas
  const atualizarObservacaoNaArvore = (nodes, despesaAtualizada) => {
    if (!nodes || !Array.isArray(nodes)) return nodes;

    return nodes.map((node) => {
      // Se encontrou o nó correspondente, atualizar
      if (
        node.id === despesaAtualizada.id ||
        (node.cd_empresa === despesaAtualizada.cd_empresa &&
          node.cd_despesaitem === despesaAtualizada.cd_despesaitem &&
          node.cd_fornecedor === despesaAtualizada.cd_fornecedor &&
          node.nr_duplicata === despesaAtualizada.nr_duplicata &&
          node.nr_parcela === despesaAtualizada.nr_parcela)
      ) {
        return {
          ...node,
          _observacaoTotvs:
            despesaAtualizada._observacaoTotvs || despesaAtualizada.observacoes,
          _temObservacao: !!(
            despesaAtualizada._observacaoTotvs || despesaAtualizada.observacoes
          ),
          observacoes: despesaAtualizada.observacoes,
          // 🆕 Atualizar informações do usuário da observação
          _usuarioObservacao: despesaAtualizada._usuarioObservacao,
          _dataObservacao: despesaAtualizada._dataObservacao,
          _dataAlteracaoObservacao: despesaAtualizada._dataAlteracaoObservacao,
        };
      }

      // Recursivamente atualizar filhos
      if (node.children && node.children.length > 0) {
        return {
          ...node,
          children: atualizarObservacaoNaArvore(
            node.children,
            despesaAtualizada,
          ),
        };
      }

      return node;
    });
  };

  // Função auxiliar para buscar impostos em lotes (evita erro 431 - URL muito longa)
  const buscarImpostosEmLotes = async (transacoes, tamanhoDosLotes = 300) => {
    if (!transacoes || transacoes.length === 0) {
      return { success: true, data: { data: [] } };
    }

    console.log(
      `📦 Dividindo ${transacoes.length} transações em lotes de até ${tamanhoDosLotes}`,
    );

    // Dividir em lotes
    const lotes = [];
    for (let i = 0; i < transacoes.length; i += tamanhoDosLotes) {
      lotes.push(transacoes.slice(i, i + tamanhoDosLotes));
    }

    console.log(`🔄 Total de ${lotes.length} lotes para processar`);

    // Buscar todos os lotes em paralelo com Promise.allSettled para resiliência
    const resultadosLotes = await Promise.allSettled(
      lotes.map(async (lote, index) => {
        console.log(
          `🔄 Buscando lote ${index + 1}/${lotes.length} com ${
            lote.length
          } transações`,
        );
        const resultado = await api.sales.vlimposto({ nr_transacao: lote });
        console.log(`🔍 DEBUG ESTRUTURA LOTE ${index + 1}:`, {
          success: resultado?.success,
          hasData: !!resultado?.data,
          dataType: typeof resultado?.data,
          isArray: Array.isArray(resultado?.data),
          dataLength: Array.isArray(resultado?.data)
            ? resultado.data.length
            : 'n/a',
          firstItem: Array.isArray(resultado?.data)
            ? resultado.data[0]
            : resultado?.data,
        });
        console.log(`✅ Lote ${index + 1} concluído`);
        return resultado;
      }),
    );

    // Combinar resultados de todos os lotes bem-sucedidos
    const todosImpostos = resultadosLotes.reduce((acc, resultado, index) => {
      if (resultado.status === 'fulfilled' && resultado.value?.success) {
        // O useApiClient já desaninha data.data, então os dados estão direto em .data
        const impostos = Array.isArray(resultado.value.data)
          ? resultado.value.data
          : resultado.value.data?.data || [];
        console.log(
          `📦 Lote ${index + 1}: ${impostos.length} impostos encontrados`,
        );
        return [...acc, ...impostos];
      } else {
        console.error(
          `❌ Lote ${index + 1} falhou:`,
          resultado.reason || resultado,
        );
        return acc;
      }
    }, []);

    const lotesComSucesso = resultadosLotes.filter(
      (r) => r.status === 'fulfilled',
    ).length;
    console.log(
      `📊 Resumo: ${lotesComSucesso}/${lotes.length} lotes com sucesso, ${todosImpostos.length} impostos combinados`,
    );

    // Retornar no mesmo formato que a API original
    // O useApiClient vai processar isso e retornar apenas .data
    return {
      success: true,
      data: todosImpostos, // Array direto, não aninhado
    };
  };

  // Função para buscar dados de um único período
  const buscarDadosPeriodo = async (periodo, periodoIndex, totalPeriodos) => {
    const statusPrefix =
      totalPeriodos > 1 ? `[${periodoIndex + 1}/${totalPeriodos}] ` : '';

    try {
      // ============================================
      // NOVA LÓGICA: Usar Auditoria de Faturamento
      // (igual à página AuditoriaFaturamento.jsx)
      // ============================================

      // Lista de empresas para buscar faturas
      const empresasFaturamento = [
        2, 5, 55, 65, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 100, 200, 108,
        500, 550, 650, 890, 891, 910, 920, 930, 940, 950, 960, 970, 990, 6156,
        6157, 6114, 6115,
      ];

      // Códigos de operação para VAREJO
      const codigosVarejo = [
        1, 2, 510, 511, 1511, 521, 1521, 522, 960, 9001, 9009, 9027, 8750, 9017,
        9400, 9401, 9402, 9403, 9404, 9005, 545, 546, 555, 548, 1210, 9405,
        1205, 1101, 9061,
      ];

      // Parâmetros para as rotas de CMV (mantidos para compatibilidade)
      const empresasFixas = [
        91, 2, 5, 6, 7, 11, 11, 12, 13, 14, 15, 16, 31, 55, 65, 75, 85, 90, 91,
        92, 93, 94, 95, 96, 97, 99,
      ];
      const empresasVarejo = [
        2, 5, 11, 12, 13, 14, 15, 16, 55, 65, 90, 91, 92, 93, 94, 95, 96, 97,
        200, 500, 550, 650, 890, 910, 920, 930, 940, 950, 960, 970,
      ];

      // ============================================
      // BUSCAR FATURAS (Auditoria de Faturamento)
      // ============================================
      setLoadingStatus(`${statusPrefix}Buscando faturas...`);

      const paramsFaturas = {
        cd_empresa: empresasFaturamento.join(','),
        dt_inicio: periodo.dt_inicio,
        dt_fim: periodo.dt_fim,
      };

      const responseFaturas =
        await api.financial.auditoriaFaturamento(paramsFaturas);

      let dadosFaturas = [];
      if (responseFaturas?.data && Array.isArray(responseFaturas.data)) {
        dadosFaturas = responseFaturas.data;
      } else if (Array.isArray(responseFaturas)) {
        dadosFaturas = responseFaturas;
      }

      console.log(`📊 Total de faturas encontradas: ${dadosFaturas.length}`);

      // ============================================
      // BUSCAR CLASSIFICAÇÕES DE CLIENTES
      // ============================================
      setLoadingStatus(`${statusPrefix}Buscando classificações...`);

      let classificacoesFaturas = {};
      let classificacoesClientes = {};
      let franquiasClientes = {};

      if (dadosFaturas.length > 0) {
        // Preparar faturas para a rota de classificação
        const faturasParaClassificar = dadosFaturas.map((item) => ({
          cd_cliente: item.cd_cliente,
          cd_operacao: item.cd_operacao,
          cd_empresa: item.cd_empresa,
        }));

        try {
          const responseClassificacao =
            await api.financial.classificacaoFaturas({
              faturas: faturasParaClassificar,
            });

          if (responseClassificacao?.data) {
            Object.entries(responseClassificacao.data).forEach(
              ([chave, valor]) => {
                classificacoesFaturas[chave] = valor.tipo;
                const clienteAtual = classificacoesClientes[valor.cd_cliente];
                if (
                  !clienteAtual ||
                  valor.tipo === 'MULTIMARCAS' ||
                  (valor.tipo === 'REVENDA' && clienteAtual !== 'MULTIMARCAS')
                ) {
                  classificacoesClientes[valor.cd_cliente] = valor.tipo;
                }
              },
            );
          }
        } catch (err) {
          console.warn('⚠️ Erro ao buscar classificações:', err);
        }

        // Buscar franquias
        try {
          const clientesUnicos = [
            ...new Set(dadosFaturas.map((f) => f.cd_cliente)),
          ];
          const responseFranquias = await api.financial.franquiasClientes({
            cd_clientes: clientesUnicos, // Array de clientes (POST suporta muitos clientes)
          });

          // A resposta é um objeto { cd_cliente: true/false }
          // Salvar diretamente como na AuditoriaFaturamento.jsx
          if (
            responseFranquias?.data &&
            typeof responseFranquias.data === 'object'
          ) {
            franquiasClientes = responseFranquias.data;
          }

          // Contar quantos são franquias
          const qtdFranquias = Object.values(franquiasClientes).filter(
            (v) => v === true,
          ).length;
          console.log(
            `📊 Franquias identificadas: ${qtdFranquias} de ${clientesUnicos.length} clientes`,
          );
        } catch (err) {
          console.warn('⚠️ Erro ao buscar franquias:', err);
        }
      }

      console.log(
        `📊 Classificações carregadas: ${Object.keys(classificacoesFaturas).length} faturas`,
      );
      console.log(
        `📊 Franquias carregadas: ${Object.keys(franquiasClientes).length} clientes`,
      );

      // ============================================
      // CLASSIFICAR FATURAS POR CANAL
      // ============================================
      setLoadingStatus(`${statusPrefix}Classificando por canal...`);

      // Função auxiliar para classificar uma fatura
      const classificarFatura = (row) => {
        const cdOperacao = Number(row.cd_operacao);
        const cdCliente = String(row.cd_cliente); // Converter para string para comparação
        const chaveFatura = `${row.cd_cliente}-${row.cd_operacao}-${row.cd_empresa}`;
        const tipoFatura = classificacoesFaturas[chaveFatura];

        // Verificar se é franquia (prioridade máxima)
        // Verificar tanto como string quanto como número
        if (
          franquiasClientes[cdCliente] === true ||
          franquiasClientes[row.cd_cliente] === true
        ) {
          return 'FRANQUIAS';
        }

        // Verificar se é VAREJO (por código de operação)
        if (codigosVarejo.includes(cdOperacao)) {
          return 'VAREJO';
        }

        // Verificar classificação por fatura/cliente
        if (
          tipoFatura === 'MULTIMARCAS' ||
          classificacoesClientes[cdCliente] === 'MULTIMARCAS' ||
          classificacoesClientes[row.cd_cliente] === 'MULTIMARCAS'
        ) {
          return 'MULTIMARCAS';
        }

        if (
          tipoFatura === 'REVENDA' ||
          classificacoesClientes[cdCliente] === 'REVENDA' ||
          classificacoesClientes[row.cd_cliente] === 'REVENDA'
        ) {
          return 'REVENDA';
        }

        // Default: OUTROS (será ignorado nos cálculos principais)
        return 'OUTROS';
      };

      // Classificar todas as faturas e calcular totais
      const faturasVarejo = [];
      const faturasMultimarcas = [];
      const faturasFranquias = [];
      const faturasRevenda = [];
      const faturasOutros = [];

      dadosFaturas.forEach((fatura) => {
        const canal = classificarFatura(fatura);
        switch (canal) {
          case 'VAREJO':
            faturasVarejo.push(fatura);
            break;
          case 'MULTIMARCAS':
            faturasMultimarcas.push(fatura);
            break;
          case 'FRANQUIAS':
            faturasFranquias.push(fatura);
            break;
          case 'REVENDA':
            faturasRevenda.push(fatura);
            break;
          default:
            faturasOutros.push(fatura);
        }
      });

      console.log(
        `📊 Faturas por canal: VAREJO=${faturasVarejo.length}, MTM=${faturasMultimarcas.length}, FRANQ=${faturasFranquias.length}, REV=${faturasRevenda.length}, OUTROS=${faturasOutros.length}`,
      );

      // ============================================
      // CALCULAR TOTAIS POR CANAL
      // Usando valores das TRANSAÇÕES (não das faturas)
      // DEVOLUÇÕES:
      //   - VAREJO: tp_documento = 20 (CREDEV por fatura)
      //   - MTM/REVENDA/FRANQUIAS: via API devolucoesTransacao
      // ============================================

      // Função para calcular totais do canal
      // calcularDevolucoesFatura = true apenas para VAREJO
      const calcularTotaisCanal = (
        faturas,
        calcularDevolucoesFatura = false,
      ) => {
        // Agrupar por nr_transacao para evitar duplicação
        // (múltiplas faturas podem apontar para a mesma transação)
        const transacoesUnicas = new Map();
        let totalDevolucoesLiquido = 0;
        let countDevolucoes = 0;

        faturas.forEach((fat) => {
          const nrTransacao = fat.nr_transacao;
          const tpDocumento = Number(fat.tp_documento);

          // Devoluções por fatura (tp_documento = 20) - APENAS VAREJO
          if (calcularDevolucoesFatura && tpDocumento === 20) {
            const valorDevolucao = Math.abs(parseFloat(fat.vl_fatura) || 0);
            totalDevolucoesLiquido += valorDevolucao;
            countDevolucoes++;
          }

          // Para transações únicas, pegar os valores brutos e descontos
          if (nrTransacao && !transacoesUnicas.has(nrTransacao)) {
            transacoesUnicas.set(nrTransacao, {
              vl_bruto: parseFloat(fat.vl_bruto_transacao) || 0,
              vl_desconto: parseFloat(fat.vl_desconto_transacao) || 0,
              vl_liquido: parseFloat(fat.vl_transacao) || 0,
            });
          }
        });

        // Log de debug para devoluções
        if (countDevolucoes > 0) {
          console.log(
            `🔄 Devoluções por fatura encontradas: ${countDevolucoes} faturas, total: ${totalDevolucoesLiquido}`,
          );
        }

        // Somar valores das transações únicas
        let totalBruto = 0;
        let totalDescontos = 0;
        let totalLiquido = 0;

        transacoesUnicas.forEach((trans) => {
          totalBruto += trans.vl_bruto;
          totalDescontos += trans.vl_desconto;
          totalLiquido += trans.vl_liquido;
        });

        return {
          totalBruto, // Receita Bruta (antes de descontos)
          totalDescontos, // Descontos concedidos
          totalLiquido, // Valor líquido da transação
          totalDevolucoes: totalDevolucoesLiquido, // Devoluções (CREDEV) - apenas para VAREJO
          transacoesCount: transacoesUnicas.size,
        };
      };

      // VAREJO: calcular devoluções por fatura (tp_documento = 20)
      let totaisVarejo = calcularTotaisCanal(faturasVarejo, true);
      // MTM, FRANQUIAS, REVENDA: NÃO calcular devoluções por fatura aqui
      let totaisMultimarcas = calcularTotaisCanal(faturasMultimarcas, false);
      let totaisFranquias = calcularTotaisCanal(faturasFranquias, false);
      let totaisRevenda = calcularTotaisCanal(faturasRevenda, false);

      // ============================================
      // BUSCAR DEVOLUÇÕES POR TRANSAÇÃO (MTM, REVENDA, FRANQUIAS)
      // Usa tp_situacao = 4 e cd_operacao específicos
      // ============================================
      setLoadingStatus(`${statusPrefix}Buscando devoluções por transação...`);

      try {
        const devolucoesTransacaoResponse =
          await api.financial.devolucoesTransacao({
            dt_inicio: periodo.dt_inicio,
            dt_fim: periodo.dt_fim,
          });

        if (
          devolucoesTransacaoResponse?.success &&
          devolucoesTransacaoResponse?.data?.devolucoes
        ) {
          const devolucoesArr = devolucoesTransacaoResponse.data.devolucoes;

          console.log(
            `📦 Devoluções por transação: ${devolucoesArr.length} registros encontrados`,
          );

          // Classificar devoluções por canal usando franquiasClientes e classificacoesClientes
          let devMtm = 0;
          let devFranquias = 0;
          let devRevenda = 0;

          devolucoesArr.forEach((dev) => {
            const cdCliente = String(dev.cd_cliente);
            const valor = Math.abs(parseFloat(dev.vl_transacao) || 0);

            // Verificar se é franquia
            if (
              franquiasClientes[cdCliente] === true ||
              franquiasClientes[dev.cd_cliente] === true
            ) {
              devFranquias += valor;
            }
            // Verificar se é MULTIMARCAS
            else if (
              classificacoesClientes[cdCliente] === 'MULTIMARCAS' ||
              classificacoesClientes[dev.cd_cliente] === 'MULTIMARCAS'
            ) {
              devMtm += valor;
            }
            // Verificar se é REVENDA
            else if (
              classificacoesClientes[cdCliente] === 'REVENDA' ||
              classificacoesClientes[dev.cd_cliente] === 'REVENDA'
            ) {
              devRevenda += valor;
            }
            // Default: considerar como REVENDA (operações B2B)
            else {
              devRevenda += valor;
            }
          });

          // Adicionar devoluções aos totais
          totaisMultimarcas.totalDevolucoes = devMtm;
          totaisFranquias.totalDevolucoes = devFranquias;
          totaisRevenda.totalDevolucoes = devRevenda;

          console.log(
            `📊 Devoluções classificadas: MTM=${devMtm}, FRANQ=${devFranquias}, REV=${devRevenda}`,
          );
        }
      } catch (error) {
        console.warn('⚠️ Erro ao buscar devoluções por transação:', error);
        // Continuar com devoluções zeradas para esses canais
      }

      console.log(`📊 Totais calculados (das transações):`, {
        varejo: {
          bruto: totaisVarejo.totalBruto,
          desconto: totaisVarejo.totalDescontos,
          devolucoes: totaisVarejo.totalDevolucoes,
          trans: totaisVarejo.transacoesCount,
        },
        multimarcas: {
          bruto: totaisMultimarcas.totalBruto,
          desconto: totaisMultimarcas.totalDescontos,
          devolucoes: totaisMultimarcas.totalDevolucoes,
          trans: totaisMultimarcas.transacoesCount,
        },
        franquias: {
          bruto: totaisFranquias.totalBruto,
          desconto: totaisFranquias.totalDescontos,
          devolucoes: totaisFranquias.totalDevolucoes,
          trans: totaisFranquias.transacoesCount,
        },
        revenda: {
          bruto: totaisRevenda.totalBruto,
          desconto: totaisRevenda.totalDescontos,
          devolucoes: totaisRevenda.totalDevolucoes,
          trans: totaisRevenda.transacoesCount,
        },
      });

      // ============================================
      // BUSCAR CMV (usando transações por canal)
      // ============================================
      setLoadingStatus(`${statusPrefix}Buscando CMV...`);

      // Coletar transações únicas de cada canal para o CMV
      const transacoesVarejoCMV = [
        ...new Set(
          faturasVarejo
            .map((item) => item.nr_transacao)
            .filter((t) => t !== null && t !== undefined && t !== ''),
        ),
      ];

      const transacoesMultimarcasCMV = [
        ...new Set(
          faturasMultimarcas
            .map((item) => item.nr_transacao)
            .filter((t) => t !== null && t !== undefined && t !== ''),
        ),
      ];

      const transacoesFranquiasCMV = [
        ...new Set(
          faturasFranquias
            .map((item) => item.nr_transacao)
            .filter((t) => t !== null && t !== undefined && t !== ''),
        ),
      ];

      const transacoesRevendaCMV = [
        ...new Set(
          faturasRevenda
            .map((item) => item.nr_transacao)
            .filter((t) => t !== null && t !== undefined && t !== ''),
        ),
      ];

      console.log('📊 Transações para CMV:', {
        varejo: transacoesVarejoCMV.length,
        multimarcas: transacoesMultimarcasCMV.length,
        franquias: transacoesFranquiasCMV.length,
        revenda: transacoesRevendaCMV.length,
      });

      // Chamada única à nova rota de CMV
      const respostaCMV = await api.financial.cmvPorTransacoes({
        varejo: transacoesVarejoCMV,
        multimarcas: transacoesMultimarcasCMV,
        franquias: transacoesFranquiasCMV,
        revenda: transacoesRevendaCMV,
      });

      let dadosCMVVarejo = { cmv: 0, produtosSaida: 0, produtosEntrada: 0 };
      let dadosCMVMultimarcas = {
        cmv: 0,
        produtosSaida: 0,
        produtosEntrada: 0,
      };
      let dadosCMVFranquias = { cmv: 0, produtosSaida: 0, produtosEntrada: 0 };
      let dadosCMVRevenda = { cmv: 0, produtosSaida: 0, produtosEntrada: 0 };

      if (respostaCMV?.success && respostaCMV?.data) {
        dadosCMVVarejo = respostaCMV.data?.varejo || {
          cmv: 0,
          produtosSaida: 0,
          produtosEntrada: 0,
        };
        dadosCMVMultimarcas = respostaCMV.data?.multimarcas || {
          cmv: 0,
          produtosSaida: 0,
          produtosEntrada: 0,
        };
        dadosCMVFranquias = respostaCMV.data?.franquias || {
          cmv: 0,
          produtosSaida: 0,
          produtosEntrada: 0,
        };
        dadosCMVRevenda = respostaCMV.data?.revenda || {
          cmv: 0,
          produtosSaida: 0,
          produtosEntrada: 0,
        };
        console.log('✅ CMV recebido:', respostaCMV.data);
      } else {
        console.warn('⚠️ Resposta de CMV sem success');
      }

      setLoadingStatus(`${statusPrefix}Processando dados...`);

      // Adicionar CMV aos totais por canal
      totaisVarejo.totalCMV = dadosCMVVarejo.cmv;
      totaisMultimarcas.totalCMV = dadosCMVMultimarcas.cmv;
      totaisFranquias.totalCMV = dadosCMVFranquias.cmv;
      totaisRevenda.totalCMV = dadosCMVRevenda.cmv;

      // Calcular totais gerais
      const totalVendasBrutas =
        totaisVarejo.totalBruto +
        totaisMultimarcas.totalBruto +
        totaisFranquias.totalBruto +
        totaisRevenda.totalBruto;

      const totalDevolucoesLiquidas =
        totaisVarejo.totalDevolucoes +
        totaisMultimarcas.totalDevolucoes +
        totaisFranquias.totalDevolucoes +
        totaisRevenda.totalDevolucoes;

      const totalDescontos =
        totaisVarejo.totalDescontos +
        totaisMultimarcas.totalDescontos +
        totaisFranquias.totalDescontos +
        totaisRevenda.totalDescontos;

      const totalCMV =
        dadosCMVVarejo.cmv +
        dadosCMVMultimarcas.cmv +
        dadosCMVFranquias.cmv +
        dadosCMVRevenda.cmv;

      console.log(
        `📊 Totais gerais: VendasBrutas=${totalVendasBrutas}, Descontos=${totalDescontos}, Devoluções=${totalDevolucoesLiquidas}, CMV=${totalCMV}`,
      );

      // ============================================
      // BUSCAR IMPOSTOS (Rota POST simples)
      // ============================================
      setLoadingStatus(`${statusPrefix}Buscando impostos...`);
      let impostosData = null;
      try {
        // Coletar transações únicas de cada canal
        const transacoesVarejo = [
          ...new Set(
            faturasVarejo
              .map((item) => item.nr_transacao)
              .filter((t) => t !== null && t !== undefined && t !== ''),
          ),
        ];

        const transacoesMultimarcas = [
          ...new Set(
            faturasMultimarcas
              .map((item) => item.nr_transacao)
              .filter((t) => t !== null && t !== undefined && t !== ''),
          ),
        ];

        const transacoesFranquias = [
          ...new Set(
            faturasFranquias
              .map((item) => item.nr_transacao)
              .filter((t) => t !== null && t !== undefined && t !== ''),
          ),
        ];

        const transacoesRevenda = [
          ...new Set(
            faturasRevenda
              .map((item) => item.nr_transacao)
              .filter((t) => t !== null && t !== undefined && t !== ''),
          ),
        ];

        console.log('📊 Transações para impostos:', {
          varejo: transacoesVarejo.length,
          multimarcas: transacoesMultimarcas.length,
          franquias: transacoesFranquias.length,
          revenda: transacoesRevenda.length,
        });

        // Chamada única à rota POST simplificada
        const respostaImpostos = await api.financial.impostosPorTransacoes({
          varejo: transacoesVarejo,
          multimarcas: transacoesMultimarcas,
          franquias: transacoesFranquias,
          revenda: transacoesRevenda,
        });

        if (respostaImpostos?.success) {
          impostosData = respostaImpostos.data;
          console.log('✅ Impostos recebidos:', impostosData);
        } else {
          console.warn('⚠️ Resposta de impostos sem success');
          impostosData = {
            varejo: { icms: 0, pis: 0, cofins: 0, total: 0 },
            multimarcas: { icms: 0, pis: 0, cofins: 0, total: 0 },
            franquias: { icms: 0, pis: 0, cofins: 0, total: 0 },
            revenda: { icms: 0, pis: 0, cofins: 0, total: 0 },
          };
        }
      } catch (error) {
        console.error('⚠️ Erro ao buscar impostos:', error);
        impostosData = {
          varejo: { icms: 0, pis: 0, cofins: 0 },
          multimarcas: { icms: 0, pis: 0, cofins: 0 },
          franquias: { icms: 0, pis: 0, cofins: 0 },
          revenda: { icms: 0, pis: 0, cofins: 0 },
        };
      }

      // Processar impostos por canal
      const impostosVarejoData = {
        icms: impostosData?.varejo?.icms || 0,
        pis: impostosData?.varejo?.pis || 0,
        cofins: impostosData?.varejo?.cofins || 0,
      };

      const impostosMultimarcasData = {
        icms: impostosData?.multimarcas?.icms || 0,
        pis: impostosData?.multimarcas?.pis || 0,
        cofins: impostosData?.multimarcas?.cofins || 0,
      };

      const impostosFranquiasData = {
        icms: impostosData?.franquias?.icms || 0,
        pis: impostosData?.franquias?.pis || 0,
        cofins: impostosData?.franquias?.cofins || 0,
      };

      const impostosRevendaData = {
        icms: impostosData?.revenda?.icms || 0,
        pis: impostosData?.revenda?.pis || 0,
        cofins: impostosData?.revenda?.cofins || 0,
      };

      // Totais de impostos
      const icmsReal =
        impostosVarejoData.icms +
        impostosMultimarcasData.icms +
        impostosFranquiasData.icms +
        impostosRevendaData.icms;
      const pisReal =
        impostosVarejoData.pis +
        impostosMultimarcasData.pis +
        impostosFranquiasData.pis +
        impostosRevendaData.pis;
      const cofinsReal =
        impostosVarejoData.cofins +
        impostosMultimarcasData.cofins +
        impostosFranquiasData.cofins +
        impostosRevendaData.cofins;
      const totalImpostosReal = icmsReal + pisReal + cofinsReal;

      // Cálculos finais
      const totalDeducoesCalculado =
        totalDevolucoesLiquidas + Math.abs(totalDescontos) + totalImpostosReal;

      const receitaLiquidaCalculada =
        totalVendasBrutas - totalDeducoesCalculado;
      const lucroBrutoCalculado = receitaLiquidaCalculada - totalCMV;

      // Calcular por canal
      const receitaLiquidaVarejoCalc =
        totaisVarejo.totalBruto -
        (totaisVarejo.totalDevolucoes +
          Math.abs(totaisVarejo.totalDescontos) +
          impostosVarejoData.icms +
          impostosVarejoData.pis +
          impostosVarejoData.cofins);

      const receitaLiquidaMultimarcasCalc =
        totaisMultimarcas.totalBruto -
        (totaisMultimarcas.totalDevolucoes +
          Math.abs(totaisMultimarcas.totalDescontos) +
          impostosMultimarcasData.icms +
          impostosMultimarcasData.pis +
          impostosMultimarcasData.cofins);

      const receitaLiquidaFranquiasCalc =
        totaisFranquias.totalBruto -
        (totaisFranquias.totalDevolucoes +
          Math.abs(totaisFranquias.totalDescontos) +
          impostosFranquiasData.icms +
          impostosFranquiasData.pis +
          impostosFranquiasData.cofins);

      const receitaLiquidaRevendaCalc =
        totaisRevenda.totalBruto -
        (totaisRevenda.totalDevolucoes +
          Math.abs(totaisRevenda.totalDescontos) +
          impostosRevendaData.icms +
          impostosRevendaData.pis +
          impostosRevendaData.cofins);

      const cmvVarejoCalc = totaisVarejo.totalCMV;
      const cmvMultimarcasCalc = totaisMultimarcas.totalCMV;
      const cmvFranquiasCalc = totaisFranquias.totalCMV;
      const cmvRevendaCalc = totaisRevenda.totalCMV;

      const lucroBrutoVarejoCalc = receitaLiquidaVarejoCalc - cmvVarejoCalc;
      const lucroBrutoMultimarcasCalc =
        receitaLiquidaMultimarcasCalc - cmvMultimarcasCalc;
      const lucroBrutoFranquiasCalc =
        receitaLiquidaFranquiasCalc - cmvFranquiasCalc;
      const lucroBrutoRevendaCalc = receitaLiquidaRevendaCalc - cmvRevendaCalc;

      // Buscar despesas (Contas a Pagar)
      setLoadingStatus(`${statusPrefix}Buscando despesas...`);
      const todasEmpresasCodigos = [
        1, 2, 5, 6, 7, 11, 11, 12, 13, 14, 15, 16, 31, 55, 65, 75, 85, 90, 91,
        92, 93, 94, 95, 96, 97, 99, 100, 101, 111, 200, 311, 500, 550, 600, 650,
        700, 750, 850, 890, 910, 920, 930, 940, 950, 960, 970, 990,
      ];

      const paramsCP = {
        dt_inicio: periodo.dt_inicio,
        dt_fim: periodo.dt_fim,
        cd_empresa: todasEmpresasCodigos,
      };

      const contasPagar = await api.financial.contasPagarEmissao(paramsCP);

      let dadosCP = [];
      if (Array.isArray(contasPagar?.data)) {
        dadosCP = contasPagar.data;
      } else if (
        contasPagar?.data?.data &&
        Array.isArray(contasPagar.data.data)
      ) {
        dadosCP = contasPagar.data.data;
      } else if (Array.isArray(contasPagar?.rows)) {
        dadosCP = contasPagar.rows;
      } else if (
        contasPagar?.data?.rows &&
        Array.isArray(contasPagar.data.rows)
      ) {
        dadosCP = contasPagar.data.rows;
      }

      // 🆕 Buscar despesas manuais do Supabase
      setLoadingStatus(`${statusPrefix}Buscando despesas manuais...`);
      let despesasManuais = [];
      try {
        const responseDespesasManuais = await listarDespesasManuais({
          dt_inicio: periodo.dt_inicio,
          dt_fim: periodo.dt_fim,
          ativo: true, // Apenas despesas ativas
        });

        if (responseDespesasManuais?.success && responseDespesasManuais?.data) {
          despesasManuais = responseDespesasManuais.data;
          console.log(
            `✅ ${despesasManuais.length} despesas manuais encontradas para o período`,
          );
        }
      } catch (error) {
        console.warn(
          '⚠️ Erro ao buscar despesas manuais (continuando sem elas):',
          error,
        );
      }

      // 🆕 Buscar observações de despesas TOTVS
      setLoadingStatus(`${statusPrefix}Buscando observações de despesas...`);
      let observacoesTotvs = [];
      try {
        observacoesTotvs = await buscarObservacoesPeriodo(
          periodo.dt_inicio,
          periodo.dt_fim,
        );
        console.log(
          `✅ ${observacoesTotvs.length} observações TOTVS encontradas para o período`,
        );
      } catch (error) {
        console.warn(
          '⚠️ Erro ao buscar observações TOTVS (continuando sem elas):',
          error,
        );
      }

      // 🆕 Buscar observações de despesas manuais
      let observacoesManuaisMap = new Map();
      if (despesasManuais.length > 0) {
        try {
          const idsDespesas = despesasManuais.map((dm) => dm.id);
          const resultado =
            await buscarObservacoesMultiplasDespesas(idsDespesas);
          observacoesManuaisMap = resultado.data || new Map();
          console.log(
            `✅ Observações de ${observacoesManuaisMap.size} despesas manuais carregadas`,
          );
        } catch (error) {
          console.warn(
            '⚠️ Erro ao buscar observações de despesas manuais (continuando sem elas):',
            error,
          );
        }
      }

      // Criar mapa de observações para busca rápida
      // 🆕 Agora armazena um ARRAY de observações por chave (histórico completo)
      const observacoesMap = new Map();
      observacoesTotvs.forEach((obs) => {
        const chave = `${obs.cd_empresa}-${obs.cd_despesaitem}-${obs.cd_fornecedor}-${obs.nr_duplicata}-${obs.nr_parcela}`;

        // Se já existe, adiciona ao array. Se não, cria um novo array
        if (!observacoesMap.has(chave)) {
          observacoesMap.set(chave, []);
        }

        observacoesMap.get(chave).push({
          id: obs.id,
          observacao: obs.observacao,
          usuario: obs.usuario,
          created_at: obs.created_at,
          updated_at: obs.updated_at,
        });
      });

      console.log(
        `📋 Mapa de observações criado com ${observacoesMap.size} chaves únicas`,
      );

      // Mesclar despesas manuais com dadosCP (conversão para formato compatível)
      const despesasManuaisConvertidas = despesasManuais.map((dm) => {
        // Buscar histórico de observações desta despesa manual
        const observacoesHistorico = observacoesManuaisMap.get(dm.id) || [];
        const ultimaObservacao =
          observacoesHistorico.length > 0
            ? observacoesHistorico[observacoesHistorico.length - 1].observacao
            : dm.observacoes || '';

        return {
          cd_despesaitem: dm.cd_despesaitem,
          vl_duplicata: dm.valor,
          vl_rateio: 0,
          cd_ccusto: null,
          ds_despesaitem: `${dm.fornecedor || 'Manual'}`, // Fornecedor como identificador
          cd_fornecedor: dm.cd_fornecedor,
          fornecedor: dm.fornecedor,
          observacoes: ultimaObservacao, // Última observação para compatibilidade
          _isDespesaManual: true, // Flag para identificação visual
          _idDespesaManual: dm.id, // UUID para edição/exclusão
          _dtCadastro: dm.dt_cadastro,
          _dtAlteracao: dm.dt_alteracao,
          _usuario: dm.usuario, // 🆕 Informações do usuário
          _observacoesHistorico: observacoesHistorico, // 🆕 Array completo de observações (chat)
          _temObservacao: observacoesHistorico.length > 0, // 🆕 Indicador visual
        };
      });

      // Adicionar despesas manuais ao array de dados
      dadosCP = [...dadosCP, ...despesasManuaisConvertidas];

      if (despesasManuaisConvertidas.length > 0) {
        console.log(`📊 Total de registros após merge: ${dadosCP.length}`);
      }

      // Processar despesas (versão simplificada - apenas totais)
      let totalOperacionais = 0;
      let totalFinanceiros = 0;

      for (const item of dadosCP) {
        const ccustoRaw =
          item.cd_ccusto ??
          item.ccusto ??
          item.cd_centrocusto ??
          item.centrocusto ??
          item.cc_custo ??
          item.centro_custo ??
          item.cd_ccusto_padrao;
        const ccustoNum = Number(ccustoRaw);
        if (!Number.isNaN(ccustoNum) && ccustoNum === 999) continue;

        const codigoDespesa = Number(item.cd_despesaitem) || 0;
        if (shouldExcluirDespesa(codigoDespesa)) continue;

        const valorRateio = parseFloat(item.vl_rateio || 0) || 0;
        const valorDuplicata = parseFloat(item.vl_duplicata || 0) || 0;
        const valor = valorRateio !== 0 ? valorRateio : valorDuplicata;

        const isFinanceiro = codigoDespesa >= 7000 && codigoDespesa <= 7999;

        if (isFinanceiro) {
          totalFinanceiros += Math.abs(valor);
        } else {
          totalOperacionais += Math.abs(valor);
        }
      }

      // Processar nodes de despesas (estrutura completa para renderização)
      const [
        planoDespesasNodesProcessado,
        planoDespesasFinanceirasNodesProcessado,
      ] = await processarDespesasCompleto(dadosCP, periodo, observacoesMap);

      // Retornar objeto com todos os dados do período
      return {
        periodoId: periodo.id,
        periodo: periodo,
        vendasBrutas: totalVendasBrutas,
        devolucoes: totalDevolucoesLiquidas,
        descontos: totalDescontos,
        totalDeducoes: totalDeducoesCalculado,
        cmv: totalCMV,
        receitaLiquida: receitaLiquidaCalculada,
        lucroBruto: lucroBrutoCalculado,
        icms: icmsReal,
        pis: pisReal,
        cofins: cofinsReal,
        totalImpostos: totalImpostosReal,
        planoDespesasTotal: totalOperacionais,
        planoDespesasFinanceirasTotal: totalFinanceiros,
        planoDespesasNodes: planoDespesasNodesProcessado,
        planoDespesasFinanceirasNodes: planoDespesasFinanceirasNodesProcessado,
        totaisVarejo,
        totaisMultimarcas,
        totaisFranquias,
        totaisRevenda,
        impostosVarejo: impostosVarejoData,
        impostosMultimarcas: impostosMultimarcasData,
        impostosFranquias: impostosFranquiasData,
        impostosRevenda: impostosRevendaData,
        receitaLiquidaVarejo: receitaLiquidaVarejoCalc,
        receitaLiquidaMultimarcas: receitaLiquidaMultimarcasCalc,
        receitaLiquidaFranquias: receitaLiquidaFranquiasCalc,
        receitaLiquidaRevenda: receitaLiquidaRevendaCalc,
        cmvVarejo: cmvVarejoCalc,
        cmvMultimarcas: cmvMultimarcasCalc,
        cmvFranquias: cmvFranquiasCalc,
        cmvRevenda: cmvRevendaCalc,
        lucroBrutoVarejo: lucroBrutoVarejoCalc,
        lucroBrutoMultimarcas: lucroBrutoMultimarcasCalc,
        lucroBrutoFranquias: lucroBrutoFranquiasCalc,
        lucroBrutoRevenda: lucroBrutoRevendaCalc,
      };
    } catch (err) {
      console.error(
        `Erro ao buscar dados do período ${periodoIndex + 1}:`,
        err,
      );
      throw err;
    }
  };

  // Função auxiliar para processar despesas com estrutura completa
  const processarDespesasCompleto = async (
    dadosCP,
    periodo,
    observacoesMap,
  ) => {
    try {
      // Buscar nomes das despesas e fornecedores
      const codigosDespesas = Array.from(
        new Set(
          (dadosCP || [])
            .map((x) => x.cd_despesaitem)
            .filter(Boolean)
            .filter((cd) => !shouldExcluirDespesa(cd)),
        ),
      );
      const codigosFornecedores = Array.from(
        new Set((dadosCP || []).map((x) => x.cd_fornecedor).filter(Boolean)),
      );

      let despesaMap = new Map();
      let fornecedorMap = new Map();

      try {
        const [despesasResp, fornecedoresResp] = await Promise.all([
          api.financial.despesa({ cd_despesaitem: codigosDespesas }),
          api.financial.fornecedor({ cd_fornecedor: codigosFornecedores }),
        ]);

        const despesasData = Array.isArray(despesasResp?.data)
          ? despesasResp.data
          : Array.isArray(despesasResp)
            ? despesasResp
            : [];
        const fornecedoresData = Array.isArray(fornecedoresResp?.data)
          ? fornecedoresResp.data
          : Array.isArray(fornecedoresResp)
            ? fornecedoresResp
            : [];

        // Converter códigos para números para garantir compatibilidade
        despesaMap = new Map(
          despesasData
            .filter((d) => d && d.cd_despesaitem !== undefined)
            .map((d) => [Number(d.cd_despesaitem), d]),
        );
        fornecedorMap = new Map(
          fornecedoresData
            .filter((f) => f && f.cd_fornecedor !== undefined)
            .map((f) => [Number(f.cd_fornecedor), f]),
        );

        console.log(`📋 DespesaMap carregado com ${despesaMap.size} itens`);
        console.log(
          `📋 FornecedorMap carregado com ${fornecedorMap.size} itens`,
        );

        // Verificar se códigos de despesas manuais estão no mapa
        const codigosDespesasManuais = Array.from(
          new Set(
            (dadosCP || [])
              .filter((item) => item._isDespesaManual)
              .map((item) => item.cd_despesaitem),
          ),
        );

        if (codigosDespesasManuais.length > 0) {
          console.log(
            '🔍 Códigos de despesas manuais:',
            codigosDespesasManuais,
          );
          codigosDespesasManuais.forEach((codigo) => {
            if (despesaMap.has(codigo)) {
              console.log(
                `✅ Código ${codigo} encontrado:`,
                despesaMap.get(codigo).ds_despesaitem,
              );
            } else {
              console.warn(`⚠️ Código ${codigo} NÃO encontrado no despesaMap`);
            }
          });
        }
      } catch (errMaps) {
        console.warn(
          'Falha ao enriquecer nomes de despesa/fornecedor:',
          errMaps,
        );
      }

      // Função de categoria por faixa de código
      const getCategoriaByCodigo = (codigo) => {
        if (codigo >= 1000 && codigo <= 1999) {
          return 'CUSTO DAS MERCADORIAS VENDIDAS';
        } else if (codigo >= 2000 && codigo <= 2999) {
          return 'DESPESAS OPERACIONAIS';
        } else if (codigo >= 3000 && codigo <= 3999) {
          return 'DESPESAS COM PESSOAL';
        } else if (codigo >= 4001 && codigo <= 4999) {
          return 'ALUGUÉIS E ARRENDAMENTOS';
        } else if (codigo >= 5000 && codigo <= 5999) {
          return 'IMPOSTOS, TAXAS E CONTRIBUIÇÕES';
        } else if (codigo >= 6000 && codigo <= 6999) {
          return 'DESPESAS GERAIS';
        } else if (codigo >= 7000 && codigo <= 7999) {
          return 'DESPESAS FINANCEIRAS';
        } else if (codigo >= 8000 && codigo <= 8999) {
          return 'OUTRAS DESPESAS OPERACIONAIS';
        } else if (codigo >= 9000 && codigo <= 9999) {
          return 'DESPESAS C/ VENDAS';
        } else {
          return 'SEM CLASSIFICAÇÃO';
        }
      };

      const gruposMap = new Map();
      const gruposFinanceirosMap = new Map();

      for (const item of dadosCP) {
        const ccustoRaw =
          item.cd_ccusto ??
          item.ccusto ??
          item.cd_centrocusto ??
          item.centrocusto ??
          item.cc_custo ??
          item.centro_custo ??
          item.cd_ccusto_padrao;
        const ccustoNum = Number(ccustoRaw);
        if (!Number.isNaN(ccustoNum) && ccustoNum === 999) continue;

        const codigoDespesa = Number(item.cd_despesaitem) || 0;
        if (shouldExcluirDespesa(codigoDespesa)) continue;

        const valorRateio = parseFloat(item.vl_rateio || 0) || 0;
        const valorDuplicata = parseFloat(item.vl_duplicata || 0) || 0;
        const valor = valorRateio !== 0 ? valorRateio : valorDuplicata;

        const isFinanceiro = codigoDespesa >= 7000 && codigoDespesa <= 7999;

        let chaveGrupo = isFinanceiro
          ? 'DESPESAS FINANCEIRAS'
          : getCategoriaPorCodigo(codigoDespesa) ||
            getCategoriaByCodigo(codigoDespesa);

        const isGrupoFinanceiro = chaveGrupo === 'DESPESAS FINANCEIRAS';
        const grupoAtual = isGrupoFinanceiro ? gruposFinanceirosMap : gruposMap;

        if (!grupoAtual.has(chaveGrupo)) {
          grupoAtual.set(chaveGrupo, {
            id: `grp-${chaveGrupo}`,
            label: chaveGrupo,
            description: '',
            value: 0,
            type: 'despesa',
            children: [],
            _despesas: new Map(),
          });
        }

        const grupo = grupoAtual.get(chaveGrupo);
        grupo.value += -valor;

        // Para despesas manuais, sempre usar a descrição do código, não o fornecedor
        // 🔧 CONVERTER PARA NÚMERO para buscar no Map
        const descricaoDespesa = despesaMap.get(
          Number(item.cd_despesaitem),
        )?.ds_despesaitem;
        const nomeDespesa = (
          descricaoDespesa ||
          item.nm_despesaitem ||
          item.ds_despesaitem ||
          `CÓDIGO ${codigoDespesa}`
        )
          .toString()
          .trim();

        // Log para debug de despesas manuais
        if (item._isDespesaManual) {
          console.log('🔍 Processando despesa manual:', {
            nivel3_cd_despesaitem: codigoDespesa,
            nivel3_descricaoEncontrada: descricaoDespesa,
            nivel3_labelFinal: nomeDespesa,
            nivel4_fornecedor: item.fornecedor,
          });
        }

        if (!grupo._despesas.has(nomeDespesa)) {
          grupo._despesas.set(nomeDespesa, {
            id: `desp-${chaveGrupo}-${nomeDespesa}`,
            label: nomeDespesa,
            description: `Código: ${codigoDespesa}`,
            value: 0,
            type: 'despesa',
            children: [],
            _forn: new Map(),
            _fornCount: 0,
            cd_despesaitem: codigoDespesa, // Preservar código para referência
          });
        }

        const despesa = grupo._despesas.get(nomeDespesa);

        // 🔧 CONVERTER PARA NÚMERO para buscar no Map
        const fornInfo = fornecedorMap.get(Number(item.cd_fornecedor));
        const nmFornecedor = (
          fornInfo?.nm_fornecedor ||
          item.nm_fornecedor ||
          item.fornecedor || // 🆕 Campo de despesa manual
          item.cd_fornecedor ||
          'Fornecedor'
        ).toString();
        const fornKey = String(item.cd_fornecedor || nmFornecedor);

        if (!despesa._forn.has(fornKey)) {
          const descricaoFornecedor = item._isDespesaManual
            ? [
                '✏️ MANUAL',
                `Cadastro: ${new Date(item._dtCadastro).toLocaleDateString(
                  'pt-BR',
                )}`,
              ]
                .filter(Boolean)
                .join(' | ')
            : [
                `Empresa: ${item.cd_empresa || '-'}`,
                `Fornecedor: ${item.cd_fornecedor || '-'}`,
              ]
                .filter(Boolean)
                .join(' | ');

          despesa._forn.set(fornKey, {
            id: item._idDespesaManual || `forn-${fornKey}`,
            label: nmFornecedor,
            description: descricaoFornecedor,
            value: 0,
            type: 'despesa',
            children: [],
            _isDespesaManual: item._isDespesaManual || false,
            _idDespesaManual: item._idDespesaManual,
            _titulos: [], // 🆕 Array para armazenar todas as duplicatas individuais
            nome: item.fornecedor || nmFornecedor,
            valor: 0,
            fornecedor: item.fornecedor,
            observacoes: item.observacoes,
            cd_despesaitem: item.cd_despesaitem,
            cd_fornecedor: item.cd_fornecedor,
            // 🆕 Informações do usuário (despesas manuais)
            usuario: item._usuario,
            dt_cadastro: item._dtCadastro,
            dt_alteracao: item._dtAlteracao,
          });
          despesa._fornCount += 1;
        }

        const fornecedor = despesa._forn.get(fornKey);

        // 🆕 Buscar observações TOTVS para este título específico (ARRAY de histórico)
        let observacoesArray = [];
        let observacaoTotvs = '';
        if (!item._isDespesaManual) {
          const chaveObs = `${item.cd_empresa}-${item.cd_despesaitem}-${
            item.cd_fornecedor
          }-${item.nr_duplicata || 'N/A'}-${item.nr_parcela || 0}`;

          observacoesArray = observacoesMap.get(chaveObs) || [];
          // Para exibição rápida, mostra a última observação
          observacaoTotvs =
            observacoesArray.length > 0
              ? observacoesArray[observacoesArray.length - 1].observacao
              : '';
        }

        // 🆕 Adicionar cada duplicata individual ao array de títulos
        fornecedor._titulos.push({
          // Identificação
          cd_empresa: item.cd_empresa,
          cd_despesaitem: item.cd_despesaitem,
          cd_fornecedor: item.cd_fornecedor,
          cd_ccusto: item.cd_ccusto,
          // Documento
          nr_duplicata: item.nr_duplicata,
          nr_parcela: item.nr_parcela,
          nr_portador: item.nr_portador,
          // Datas
          dt_emissao: item.dt_emissao,
          dt_vencimento: item.dt_vencimento,
          dt_entrada: item.dt_entrada,
          dt_liq: item.dt_liq,
          // Valores Financeiros
          vl_duplicata: item.vl_duplicata,
          vl_rateio: item.vl_rateio,
          vl_pago: item.vl_pago,
          vl_juros: item.vl_juros,
          vl_acrescimo: item.vl_acrescimo,
          vl_desconto: item.vl_desconto,
          valor: Math.abs(valor), // Valor individual do título
          // Status
          tp_situacao: item.tp_situacao,
          tp_estagio: item.tp_estagio,
          tp_previsaoreal: item.tp_previsaoreal,
          in_aceite: item.in_aceite,
          // 🆕 Observações (histórico completo)
          _observacoesHistorico: observacoesArray,
          _observacaoTotvs: observacaoTotvs, // Última observação para exibição rápida
          _temObservacao: observacoesArray.length > 0 || !!item.observacoes,
        });

        // 🆕 Verificar se algum título tem observação para marcar o fornecedor
        if (observacoesArray.length > 0 || item.observacoes) {
          fornecedor._temObservacao = true;
          fornecedor._observacaoTotvs =
            fornecedor._observacaoTotvs || observacaoTotvs;

          // 🆕 Adicionar informações da ÚLTIMA observação ao fornecedor
          if (observacoesArray.length > 0 && !fornecedor._usuarioObservacao) {
            const ultimaObs = observacoesArray[observacoesArray.length - 1];
            fornecedor._usuarioObservacao = ultimaObs.usuario;
            fornecedor._dataObservacao = ultimaObs.created_at;
            fornecedor._dataAlteracaoObservacao = ultimaObs.updated_at;
            fornecedor._observacoesHistorico = observacoesArray; // 🆕 Histórico completo
          }
        }

        fornecedor.value += -valor;
        fornecedor.valor = (fornecedor.valor || 0) + Math.abs(valor);
        despesa.value += -valor;
      }

      // Converter Maps para arrays de nodes - OPERACIONAIS
      const nodesOperacionais = Array.from(gruposMap.values()).map((g) => {
        const despesasArr = Array.from(g._despesas.values()).map((d) => {
          d.description = `${d._fornCount} fornecedor(es) | Total: ${Number(
            Math.abs(d.value),
          ).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`;
          d.children = Array.from(d._forn.values()).sort(
            (a, b) => Math.abs(b.value) - Math.abs(a.value),
          );
          delete d._forn;
          delete d._fornCount;
          return d;
        });
        despesasArr.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
        g.children = despesasArr;
        delete g._despesas;
        return g;
      });
      nodesOperacionais.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

      // Converter Maps para arrays de nodes - FINANCEIRAS
      const nodesFinanceiras = Array.from(gruposFinanceirosMap.values()).map(
        (g) => {
          const despesasArr = Array.from(g._despesas.values()).map((d) => {
            d.description = `${d._fornCount} fornecedor(es) | Total: ${Number(
              Math.abs(d.value),
            ).toLocaleString('pt-BR', {
              style: 'currency',
              currency: 'BRL',
            })}`;
            d.children = Array.from(d._forn.values()).sort(
              (a, b) => Math.abs(b.value) - Math.abs(a.value),
            );
            delete d._forn;
            delete d._fornCount;
            return d;
          });
          despesasArr.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
          g.children = despesasArr;
          delete g._despesas;
          return g;
        },
      );
      nodesFinanceiras.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

      return [nodesOperacionais, nodesFinanceiras];
    } catch (error) {
      console.error('Erro ao processar despesas completo:', error);
      return [[], []];
    }
  };

  // Função principal para buscar todos os períodos
  const buscarVendasBrutas = useCallback(async () => {
    // Validar se há pelo menos 1 período com datas
    const periodosValidos = periodos.filter((p) => p.dt_inicio && p.dt_fim);
    if (periodosValidos.length === 0) {
      setError('Preencha pelo menos um período com datas de início e fim.');
      return;
    }

    setLoading(true);
    setError('');
    setDadosPeriodos([]); // Limpar dados anteriores

    try {
      console.log(
        `🚀 Iniciando busca de ${periodosValidos.length} período(s)...`,
      );

      // Buscar dados de todos os períodos válidos
      const resultados = [];

      for (let i = 0; i < periodosValidos.length; i++) {
        const periodoAtual = periodosValidos[i];
        console.log(
          `📊 Processando período ${i + 1}/${periodosValidos.length}:`,
          periodoAtual,
        );

        const dadosPeriodo = await buscarDadosPeriodo(
          periodoAtual,
          i,
          periodosValidos.length,
        );
        resultados.push(dadosPeriodo);
      }

      // Armazenar todos os resultados em dadosPeriodos
      setDadosPeriodos(resultados);

      // Atualizar estados principais com dados do primeiro período (compatibilidade)
      if (resultados.length > 0) {
        const primeiroPeriodo = resultados[0];

        setVendasBrutas(primeiroPeriodo.vendasBrutas);
        setDevolucoes(primeiroPeriodo.devolucoes);
        setDescontos(primeiroPeriodo.descontos);
        setTotalDeducoes(primeiroPeriodo.totalDeducoes);
        setCmv(primeiroPeriodo.cmv);
        setReceitaLiquida(primeiroPeriodo.receitaLiquida);
        setLucroBruto(primeiroPeriodo.lucroBruto);
        setIcms(primeiroPeriodo.icms);
        setPis(primeiroPeriodo.pis);
        setCofins(primeiroPeriodo.cofins);
        setTotalImpostos(primeiroPeriodo.totalImpostos);

        setPlanoDespesasTotal(primeiroPeriodo.planoDespesasTotal);
        setPlanoDespesasFinanceirasTotal(
          primeiroPeriodo.planoDespesasFinanceirasTotal,
        );
        setPlanoDespesasNodes(primeiroPeriodo.planoDespesasNodes);
        setPlanoDespesasFinanceirasNodes(
          primeiroPeriodo.planoDespesasFinanceirasNodes,
        );

        setTotaisVarejo(primeiroPeriodo.totaisVarejo);
        setTotaisMultimarcas(primeiroPeriodo.totaisMultimarcas);
        setTotaisFranquias(primeiroPeriodo.totaisFranquias);
        setTotaisRevenda(primeiroPeriodo.totaisRevenda);

        setImpostosVarejo(primeiroPeriodo.impostosVarejo);
        setImpostosMultimarcas(primeiroPeriodo.impostosMultimarcas);
        setImpostosFranquias(primeiroPeriodo.impostosFranquias);
        setImpostosRevenda(primeiroPeriodo.impostosRevenda);

        setReceitaLiquidaVarejo(primeiroPeriodo.receitaLiquidaVarejo);
        setReceitaLiquidaMultimarcas(primeiroPeriodo.receitaLiquidaMultimarcas);
        setReceitaLiquidaFranquias(primeiroPeriodo.receitaLiquidaFranquias);
        setReceitaLiquidaRevenda(primeiroPeriodo.receitaLiquidaRevenda);

        setCmvVarejo(primeiroPeriodo.cmvVarejo);
        setCmvMultimarcas(primeiroPeriodo.cmvMultimarcas);
        setCmvFranquias(primeiroPeriodo.cmvFranquias);
        setCmvRevenda(primeiroPeriodo.cmvRevenda);

        setLucroBrutoVarejo(primeiroPeriodo.lucroBrutoVarejo);
        setLucroBrutoMultimarcas(primeiroPeriodo.lucroBrutoMultimarcas);
        setLucroBrutoFranquias(primeiroPeriodo.lucroBrutoFranquias);
        setLucroBrutoRevenda(primeiroPeriodo.lucroBrutoRevenda);
      }

      // Se há segundo período, atualizar dadosPeriodo2 (compatibilidade)
      if (resultados.length > 1) {
        const segundoPeriodo = resultados[1];

        setDadosPeriodo2({
          vendasBrutas: segundoPeriodo.vendasBrutas,
          devolucoes: segundoPeriodo.devolucoes,
          descontos: segundoPeriodo.descontos,
          totalDeducoes: segundoPeriodo.totalDeducoes,
          cmv: segundoPeriodo.cmv,
          receitaLiquida: segundoPeriodo.receitaLiquida,
          lucroBruto: segundoPeriodo.lucroBruto,
          icms: segundoPeriodo.icms,
          pis: segundoPeriodo.pis,
          cofins: segundoPeriodo.cofins,
          totalImpostos: segundoPeriodo.totalImpostos,
          planoDespesasTotal: segundoPeriodo.planoDespesasTotal,
          planoDespesasFinanceirasTotal:
            segundoPeriodo.planoDespesasFinanceirasTotal,
          totaisVarejo: segundoPeriodo.totaisVarejo,
          totaisMultimarcas: segundoPeriodo.totaisMultimarcas,
          totaisFranquias: segundoPeriodo.totaisFranquias,
          totaisRevenda: segundoPeriodo.totaisRevenda,
          impostosVarejo: segundoPeriodo.impostosVarejo,
          impostosMultimarcas: segundoPeriodo.impostosMultimarcas,
          impostosFranquias: segundoPeriodo.impostosFranquias,
          impostosRevenda: segundoPeriodo.impostosRevenda,
          receitaLiquidaVarejo: segundoPeriodo.receitaLiquidaVarejo,
          receitaLiquidaMultimarcas: segundoPeriodo.receitaLiquidaMultimarcas,
          receitaLiquidaFranquias: segundoPeriodo.receitaLiquidaFranquias,
          receitaLiquidaRevenda: segundoPeriodo.receitaLiquidaRevenda,
          cmvVarejo: segundoPeriodo.cmvVarejo,
          cmvMultimarcas: segundoPeriodo.cmvMultimarcas,
          cmvFranquias: segundoPeriodo.cmvFranquias,
          cmvRevenda: segundoPeriodo.cmvRevenda,
          lucroBrutoVarejo: segundoPeriodo.lucroBrutoVarejo,
          lucroBrutoMultimarcas: segundoPeriodo.lucroBrutoMultimarcas,
          lucroBrutoFranquias: segundoPeriodo.lucroBrutoFranquias,
          lucroBrutoRevenda: segundoPeriodo.lucroBrutoRevenda,
        });

        setPlanoDespesasNodesPeriodo2(segundoPeriodo.planoDespesasNodes);
        setPlanoDespesasFinanceirasNodesPeriodo2(
          segundoPeriodo.planoDespesasFinanceirasNodes,
        );
      }

      console.log(
        `✅ Busca concluída! ${resultados.length} período(s) processado(s).`,
      );

      // ================= CÓDIGO LEGADO COMENTADO =================
      // O código abaixo foi substituído pela nova implementação acima
      // que itera sobre todos os períodos dinamicamente.
      // Mantido comentado temporariamente para referência.

      /*
      // [CÓDIGO ANTIGO - NÃO MAIS UTILIZADO]
      const paramsFaturamento = {
        dataInicio: periodo.dt_inicio,
        dataFim: periodo.dt_fim,
      };

      // Parâmetros para as rotas de CMV (mantidas para calcular CMV)
      const empresasFixas = [
        91, 2, 5, 6, 7, 11, 11, 12, 13, 14, 15, 16, 31, 55, 65, 75, 85, 90, 91,
        92, 93, 94, 95, 96, 97, 99,
      ];
      const empresasVarejo = [
        2, 5, 11, 12, 13, 14, 15, 16, 55, 65, 90, 91, 92, 93, 94, 95, 96, 97,
        200, 500, 550, 650, 890, 910, 920, 930, 940, 950, 960, 970,
      ];

      const paramsCMVVarejo = {
        dataInicio: periodo.dt_inicio,
        dataFim: periodo.dt_fim,
        cd_grupoempresa: empresasVarejo,
      };

      const paramsCMVMultimarcas = {
        dataInicio: periodo.dt_inicio,
        dataFim: periodo.dt_fim,
        cd_grupoempresa: empresasFixas,
      };

      const paramsCMVFranquias = {
        dataInicio: periodo.dt_inicio,
        dataFim: periodo.dt_fim,
        cd_grupoempresa: empresasFixas,
      };

      const paramsCMVRevenda = {
        dataInicio: periodo.dt_inicio,
        dataFim: periodo.dt_fim,
        cd_grupoempresa: empresasFixas,
      };

      // Buscar dados de FATURAMENTO (Receitas) das 4 rotas materializadas
      setLoadingStatus('Buscando dados de faturamento do Varejo...');
      const faturamentoVarejo = await api.sales.faturamentoVarejo(
        paramsFaturamento,
      );

      setLoadingStatus('Buscando dados de faturamento do Multimarcas...');
      const faturamentoMultimarcas = await api.sales.faturamentoMtm(
        paramsFaturamento,
      );

      setLoadingStatus('Buscando dados de faturamento das Franquias...');
      const faturamentoFranquias = await api.sales.faturamentoFranquias(
        paramsFaturamento,
      );

      setLoadingStatus('Buscando dados de faturamento da Revenda...');
      const faturamentoRevenda = await api.sales.faturamentoRevenda(
        paramsFaturamento,
      );

      // Buscar dados de CMV das 4 rotas materializadas (para calcular CMV)
      setLoadingStatus('Buscando CMV do Varejo...');
      const cmvVarejo = await api.sales.cmvVarejo(paramsCMVVarejo);

      setLoadingStatus('Buscando CMV do Multimarcas...');
      const cmvMultimarcas = await api.sales.cmvMultimarcas(
        paramsCMVMultimarcas,
      );

      setLoadingStatus('Buscando CMV das Franquias...');
      const cmvFranquias = await api.sales.cmvFranquias(paramsCMVFranquias);

      setLoadingStatus('Buscando CMV da Revenda...');
      const cmvRevenda = await api.sales.cmvRevenda(paramsCMVRevenda);

      setLoadingStatus('Processando dados...');

      // Calcular dados de faturamento usando views materializadas
      // Estrutura das views: valor_sem_desconto, valor_com_desconto,
      //                      valor_sem_desconto_saida, valor_sem_desconto_entrada,
      //                      valor_com_desconto_saida, valor_com_desconto_entrada
      const calcularDadosFaturamento = (responseFaturamento) => {
        if (!responseFaturamento?.success || !responseFaturamento?.data)
          return {
            receitaBruta: 0, // valor_sem_desconto (SOMA TOTAL)
            devolucoesBrutas: 0, // valor_sem_desconto_entrada
            receitaLiquida: 0, // valor_com_desconto
            devolucoesLiquidas: 0, // valor_com_desconto_entrada
            descontos: 0, // valor_sem_desconto - valor_com_desconto
          };

        const data = Array.isArray(responseFaturamento.data)
          ? responseFaturamento.data
          : [];

        let receitaBruta = 0;
        let devolucoesBrutas = 0;
        let receitaLiquida = 0;
        let devolucoesLiquidas = 0;

        for (const row of data) {
          // RECEITAS BRUTAS = apenas a coluna VALOR_SEM_DESCONTO (soma total)
          receitaBruta += parseFloat(row?.valor_sem_desconto_saida || 0);

          // Outros valores da view materializada
          devolucoesBrutas += parseFloat(row?.valor_sem_desconto_entrada || 0);
          receitaLiquida += parseFloat(row?.valor_com_desconto || 0);
          devolucoesLiquidas += parseFloat(
            row?.valor_com_desconto_entrada || 0,
          );
        }

        // Descontos = Receita Bruta - Receita Líquida (direto da diferença das colunas)
        const descontos = receitaBruta - receitaLiquida;

        return {
          receitaBruta,
          devolucoesBrutas,
          receitaLiquida,
          devolucoesLiquidas,
          descontos,
        };
      };

      // Calcular CMV usando views materializadas de CMV
      // CUSTO DE MERCADORIA VENDIDA = somatório apenas da coluna CMV
      const calcularCMV = (responseCMV) => {
        if (!responseCMV?.success || !responseCMV?.data)
          return {
            cmv: 0,
            produtosSaida: 0,
            produtosEntrada: 0,
          };

        const data = Array.isArray(responseCMV.data) ? responseCMV.data : [];

        let cmvTotal = 0;
        let produtosSaida = 0;
        let produtosEntrada = 0;

        for (const row of data) {
          // CMV Total = somatório da coluna 'cmv' das views materializadas
          cmvTotal += parseFloat(row?.cmv || 0);
          produtosSaida += parseFloat(row?.produtos_saida || 0);
          produtosEntrada += parseFloat(row?.produtos_entrada || 0);
        }

        return {
          cmv: cmvTotal,
          produtosSaida,
          produtosEntrada,
        };
      };

      // Calcular dados de faturamento por canal
      const dadosFaturamentoVarejo =
        calcularDadosFaturamento(faturamentoVarejo);
      const dadosFaturamentoMultimarcas = calcularDadosFaturamento(
        faturamentoMultimarcas,
      );
      const dadosFaturamentoFranquias =
        calcularDadosFaturamento(faturamentoFranquias);
      const dadosFaturamentoRevenda =
        calcularDadosFaturamento(faturamentoRevenda);

      // Calcular CMV por canal
      const dadosCMVVarejo = calcularCMV(cmvVarejo);
      const dadosCMVMultimarcas = calcularCMV(cmvMultimarcas);
      const dadosCMVFranquias = calcularCMV(cmvFranquias);
      const dadosCMVRevenda = calcularCMV(cmvRevenda);

      // ========== RECEITAS BRUTAS ==========
      // Receita Bruta = Soma das saídas sem desconto de todos os canais
      const totalReceitaBruta =
        dadosFaturamentoVarejo.receitaBruta +
        dadosFaturamentoMultimarcas.receitaBruta +
        dadosFaturamentoFranquias.receitaBruta +
        dadosFaturamentoRevenda.receitaBruta;

      // Vendas Brutas (para DRE) = Receita Bruta (saídas sem desconto)
      const totalVendasBrutas = totalReceitaBruta;

      // ========== DEDUÇÕES SOBRE VENDAS ==========

      // 1) DEVOLUÇÕES = Soma das devoluções líquidas (com desconto já aplicado)
      const totalDevolucoesLiquidas =
        dadosFaturamentoVarejo.devolucoesLiquidas +
        dadosFaturamentoMultimarcas.devolucoesLiquidas +
        dadosFaturamentoFranquias.devolucoesLiquidas +
        dadosFaturamentoRevenda.devolucoesLiquidas;

      // 2) DESCONTOS CONCEDIDOS = Soma dos descontos de todos os canais
      const totalDescontos =
        dadosFaturamentoVarejo.descontos +
        dadosFaturamentoMultimarcas.descontos +
        dadosFaturamentoFranquias.descontos +
        dadosFaturamentoRevenda.descontos;

      // Receita Líquida (antes dos impostos) = Soma das saídas com desconto
      const totalReceitaLiquidaSemImpostos =
        dadosFaturamentoVarejo.receitaLiquida +
        dadosFaturamentoMultimarcas.receitaLiquida +
        dadosFaturamentoFranquias.receitaLiquida +
        dadosFaturamentoRevenda.receitaLiquida;

      // ========== CMV ==========
      // CUSTO DE MERCADORIA VENDIDA = somatório da coluna 'cmv' das views materializadas
      // Rotas utilizadas: cmv-varejo, cmv-multimarcas, cmv-franquias, cmv-revenda
      const totalCMV =
        dadosCMVVarejo.cmv +
        dadosCMVMultimarcas.cmv +
        dadosCMVFranquias.cmv +
        dadosCMVRevenda.cmv;

      // Criar estrutura de totais por canal para compatibilidade com o resto do código
      const totaisVarejo = {
        totalBruto: dadosFaturamentoVarejo.receitaBruta,
        totalDevolucoes: dadosFaturamentoVarejo.devolucoesLiquidas,
        totalLiquido: dadosFaturamentoVarejo.receitaLiquida,
        totalCMV: dadosCMVVarejo.cmv,
        totalDescontos: dadosFaturamentoVarejo.descontos,
      };

      const totaisMultimarcas = {
        totalBruto: dadosFaturamentoMultimarcas.receitaBruta,
        totalDevolucoes: dadosFaturamentoMultimarcas.devolucoesLiquidas,
        totalLiquido: dadosFaturamentoMultimarcas.receitaLiquida,
        totalCMV: dadosCMVMultimarcas.cmv,
        totalDescontos: dadosFaturamentoMultimarcas.descontos,
      };

      const totaisFranquias = {
        totalBruto: dadosFaturamentoFranquias.receitaBruta,
        totalDevolucoes: dadosFaturamentoFranquias.devolucoesLiquidas,
        totalLiquido: dadosFaturamentoFranquias.receitaLiquida,
        totalCMV: dadosCMVFranquias.cmv,
        totalDescontos: dadosFaturamentoFranquias.descontos,
      };

      const totaisRevenda = {
        totalBruto: dadosFaturamentoRevenda.receitaBruta,
        totalDevolucoes: dadosFaturamentoRevenda.devolucoesLiquidas,
        totalLiquido: dadosFaturamentoRevenda.receitaLiquida,
        totalCMV: dadosCMVRevenda.cmv,
        totalDescontos: dadosFaturamentoRevenda.descontos,
      };

      // ========== BUSCAR IMPOSTOS ==========
      setLoadingStatus('Buscando impostos por canal...');

      let impostosData = null;
      try {
        // Coletar transações únicas de cada canal
        const transacoesVarejo = [...new Set((faturamentoVarejo?.data || [])
          .map(item => item.nr_transacao)
          .filter(Boolean))];
        
        const transacoesMultimarcas = [...new Set((faturamentoMultimarcas?.data || [])
          .map(item => item.nr_transacao)
          .filter(Boolean))];
        
        const transacoesFranquias = [...new Set((faturamentoFranquias?.data || [])
          .map(item => item.nr_transacao)
          .filter(Boolean))];
        
        const transacoesRevenda = [...new Set((faturamentoRevenda?.data || [])
          .map(item => item.nr_transacao)
          .filter(Boolean))];

        console.log('📊 Transações para impostos:', {
          varejo: transacoesVarejo.length,
          multimarcas: transacoesMultimarcas.length,
          franquias: transacoesFranquias.length,
          revenda: transacoesRevenda.length,
        });

        // Chamada única à rota POST simplificada
        const respostaImpostos = await api.financial.impostosPorTransacoes({
          varejo: transacoesVarejo,
          multimarcas: transacoesMultimarcas,
          franquias: transacoesFranquias,
          revenda: transacoesRevenda,
        });

        if (respostaImpostos?.success) {
          impostosData = respostaImpostos.data;
          console.log('✅ Impostos recebidos:', impostosData);
        } else {
          console.warn('⚠️ Resposta de impostos sem success');
          impostosData = {
            varejo: { icms: 0, pis: 0, cofins: 0, total: 0 },
            multimarcas: { icms: 0, pis: 0, cofins: 0, total: 0 },
            franquias: { icms: 0, pis: 0, cofins: 0, total: 0 },
            revenda: { icms: 0, pis: 0, cofins: 0, total: 0 },
          };
        }

      } catch (error) {
        console.error(
          '⚠️ Erro ao buscar impostos, usando valores zerados:',
          error,
        );
        impostosData = {
          varejo: { icms: 0, pis: 0, cofins: 0 },
          multimarcas: { icms: 0, pis: 0, cofins: 0 },
          franquias: { icms: 0, pis: 0, cofins: 0 },
          revenda: { icms: 0, pis: 0, cofins: 0 },
        };
      }

      // Processar impostos por canal (a API retorna impostos separados por tipo)
      const impostosVarejoData = {
        icms: impostosData?.varejo?.icms || 0,
        pis: impostosData?.varejo?.pis || 0,
        cofins: impostosData?.varejo?.cofins || 0,
      };

      const impostosMultimarcasData = {
        icms: impostosData?.multimarcas?.icms || 0,
        pis: impostosData?.multimarcas?.pis || 0,
        cofins: impostosData?.multimarcas?.cofins || 0,
      };

      const impostosFranquiasData = {
        icms: impostosData?.franquias?.icms || 0,
        pis: impostosData?.franquias?.pis || 0,
        cofins: impostosData?.franquias?.cofins || 0,
      };

      const impostosRevendaData = {
        icms: impostosData?.revenda?.icms || 0,
        pis: impostosData?.revenda?.pis || 0,
        cofins: impostosData?.revenda?.cofins || 0,
      };

      // Atualizar estados com impostos por canal
      setImpostosVarejo(impostosVarejoData);
      setImpostosMultimarcas(impostosMultimarcasData);
      setImpostosFranquias(impostosFranquiasData);
      setImpostosRevenda(impostosRevendaData);

      // Totais gerais
      const icmsReal =
        impostosVarejoData.icms +
        impostosMultimarcasData.icms +
        impostosFranquiasData.icms +
        impostosRevendaData.icms;
      const pisReal =
        impostosVarejoData.pis +
        impostosMultimarcasData.pis +
        impostosFranquiasData.pis +
        impostosRevendaData.pis;
      const cofinsReal =
        impostosVarejoData.cofins +
        impostosMultimarcasData.cofins +
        impostosFranquiasData.cofins +
        impostosRevendaData.cofins;
      const totalImpostosReal = icmsReal + pisReal + cofinsReal;

      // ========== CÁLCULO FINAL DA DRE ==========

      // Total das Deduções = Devoluções Líquidas + Descontos Concedidos + Impostos
      // IMPORTANTE: totalDescontos já vem NEGATIVO da API, então usamos Math.abs() para somar corretamente
      const totalDeducoesCalculado =
        totalDevolucoesLiquidas + Math.abs(totalDescontos) + totalImpostosReal;

      // 🔍 DEBUG: Verificar cálculo final da DRE
      console.log('📊 CÁLCULO FINAL DA DRE:', {
        vendasBrutas: totalVendasBrutas,
        devolucoes: totalDevolucoesLiquidas,
        descontosNegativos: totalDescontos,
        descontosAbsolutos: Math.abs(totalDescontos),
        impostos: totalImpostosReal,
        totalDeducoes: totalDeducoesCalculado,
        formula: `${totalDevolucoesLiquidas.toFixed(2)} + ${Math.abs(
          totalDescontos,
        ).toFixed(2)} + ${totalImpostosReal.toFixed(
          2,
        )} = ${totalDeducoesCalculado.toFixed(2)}`,
        receitaLiquida: totalVendasBrutas - totalDeducoesCalculado,
        cmv: totalCMV,
      });

      // Receita Líquida = Vendas Brutas - Deduções
      const receitaLiquidaCalculada =
        totalVendasBrutas - totalDeducoesCalculado;

      // Lucro Bruto = Receita Líquida - CMV
      const lucroBrutoCalculado = receitaLiquidaCalculada - totalCMV;

      // ================= CÁLCULOS POR CANAL =================

      // Calcular receitas líquidas por canal
      // Receita Líquida = Receita Bruta - (Devoluções + Descontos + Impostos)
      // IMPORTANTE: descontos já vêm NEGATIVOS, então usamos Math.abs()
      const receitaLiquidaVarejoCalc =
        totaisVarejo.totalBruto -
        (totaisVarejo.totalDevolucoes +
          Math.abs(totaisVarejo.totalDescontos) +
          impostosVarejoData.icms +
          impostosVarejoData.pis +
          impostosVarejoData.cofins);

      const receitaLiquidaMultimarcasCalc =
        totaisMultimarcas.totalBruto -
        (totaisMultimarcas.totalDevolucoes +
          Math.abs(totaisMultimarcas.totalDescontos) +
          impostosMultimarcasData.icms +
          impostosMultimarcasData.pis +
          impostosMultimarcasData.cofins);

      const receitaLiquidaFranquiasCalc =
        totaisFranquias.totalBruto -
        (totaisFranquias.totalDevolucoes +
          Math.abs(totaisFranquias.totalDescontos) +
          impostosFranquiasData.icms +
          impostosFranquiasData.pis +
          impostosFranquiasData.cofins);

      const receitaLiquidaRevendaCalc =
        totaisRevenda.totalBruto -
        (totaisRevenda.totalDevolucoes +
          Math.abs(totaisRevenda.totalDescontos) +
          impostosRevendaData.icms +
          impostosRevendaData.pis +
          impostosRevendaData.cofins);

      // CMV por canal (já calculado)
      const cmvVarejoCalc = totaisVarejo.totalCMV;
      const cmvMultimarcasCalc = totaisMultimarcas.totalCMV;
      const cmvFranquiasCalc = totaisFranquias.totalCMV;
      const cmvRevendaCalc = totaisRevenda.totalCMV;

      // Calcular lucro bruto por canal: RECEITA LÍQUIDA - CMV
      const lucroBrutoVarejoCalc = receitaLiquidaVarejoCalc - cmvVarejoCalc;
      const lucroBrutoMultimarcasCalc =
        receitaLiquidaMultimarcasCalc - cmvMultimarcasCalc;
      const lucroBrutoFranquiasCalc =
        receitaLiquidaFranquiasCalc - cmvFranquiasCalc;
      const lucroBrutoRevendaCalc = receitaLiquidaRevendaCalc - cmvRevendaCalc;

      // Atualizar estados com valores por canal
      setReceitaLiquidaVarejo(receitaLiquidaVarejoCalc);
      setReceitaLiquidaMultimarcas(receitaLiquidaMultimarcasCalc);
      setReceitaLiquidaFranquias(receitaLiquidaFranquiasCalc);
      setReceitaLiquidaRevenda(receitaLiquidaRevendaCalc);

      setCmvVarejo(cmvVarejoCalc);
      setCmvMultimarcas(cmvMultimarcasCalc);
      setCmvFranquias(cmvFranquiasCalc);
      setCmvRevenda(cmvRevendaCalc);

      setLucroBrutoVarejo(lucroBrutoVarejoCalc);
      setLucroBrutoMultimarcas(lucroBrutoMultimarcasCalc);
      setLucroBrutoFranquias(lucroBrutoFranquiasCalc);
      setLucroBrutoRevenda(lucroBrutoRevendaCalc);

      setVendasBrutas(totalVendasBrutas);
      setDevolucoes(totalDevolucoesLiquidas);
      setDescontos(totalDescontos);
      setTotalDeducoes(totalDeducoesCalculado);

      // Salvar totais por canal nos estados
      setTotaisVarejo(totaisVarejo);
      setTotaisMultimarcas(totaisMultimarcas);
      setTotaisFranquias(totaisFranquias);
      setTotaisRevenda(totaisRevenda);
      setCmv(totalCMV);
      setReceitaLiquida(receitaLiquidaCalculada);
      setLucroBruto(lucroBrutoCalculado);

      // Estados dos impostos reais
      setIcms(icmsReal);
      setPis(pisReal);
      setCofins(cofinsReal);
      setTotalImpostos(totalImpostosReal);

      // ================= BUSCAR DADOS DO PERÍODO 2 (opcional - se preenchido) =================
      if (periodoComparacao.dt_inicio && periodoComparacao.dt_fim) {
        setLoadingStatus('Buscando dados do Período 2 de comparação...');

        // Buscar faturamento do Período 2
        const paramsFaturamentoPeriodo2 = {
          dataInicio: periodoComparacao.dt_inicio,
          dataFim: periodoComparacao.dt_fim,
        };

        const [
          faturamentoVarejoPeriodo2,
          faturamentoMultimarcasPeriodo2,
          faturamentoFranquiasPeriodo2,
          faturamentoRevendaPeriodo2,
        ] = await Promise.all([
          api.sales.faturamentoVarejo(paramsFaturamentoPeriodo2),
          api.sales.faturamentoMtm(paramsFaturamentoPeriodo2),
          api.sales.faturamentoFranquias(paramsFaturamentoPeriodo2),
          api.sales.faturamentoRevenda(paramsFaturamentoPeriodo2),
        ]);

        // Buscar CMV do Período 2
        const paramsCMVPeriodo2Varejo = {
          dataInicio: periodoComparacao.dt_inicio,
          dataFim: periodoComparacao.dt_fim,
          cd_grupoempresa: empresasVarejo,
        };

        const paramsCMVPeriodo2Fixas = {
          dataInicio: periodoComparacao.dt_inicio,
          dataFim: periodoComparacao.dt_fim,
          cd_grupoempresa: empresasFixas,
        };

        const [
          cmvVarejoPeriodo2,
          cmvMultimarcasPeriodo2,
          cmvFranquiasPeriodo2,
          cmvRevendaPeriodo2,
        ] = await Promise.all([
          api.sales.cmvVarejo(paramsCMVPeriodo2Varejo),
          api.sales.cmvMultimarcas(paramsCMVPeriodo2Fixas),
          api.sales.cmvFranquias(paramsCMVPeriodo2Fixas),
          api.sales.cmvRevenda(paramsCMVPeriodo2Fixas),
        ]);

        // Processar dados do Período 2 (mesma lógica do Período 1)
        const dadosFaturamentoVarejoPeriodo2 = calcularDadosFaturamento(
          faturamentoVarejoPeriodo2,
        );
        const dadosFaturamentoMultimarcasPeriodo2 = calcularDadosFaturamento(
          faturamentoMultimarcasPeriodo2,
        );
        const dadosFaturamentoFranquiasPeriodo2 = calcularDadosFaturamento(
          faturamentoFranquiasPeriodo2,
        );
        const dadosFaturamentoRevendaPeriodo2 = calcularDadosFaturamento(
          faturamentoRevendaPeriodo2,
        );

        const dadosCMVVarejoPeriodo2 = calcularCMV(cmvVarejoPeriodo2);
        const dadosCMVMultimarcasPeriodo2 = calcularCMV(cmvMultimarcasPeriodo2);
        const dadosCMVFranquiasPeriodo2 = calcularCMV(cmvFranquiasPeriodo2);
        const dadosCMVRevendaPeriodo2 = calcularCMV(cmvRevendaPeriodo2);

        const totalReceitaBrutaPeriodo2 =
          dadosFaturamentoVarejoPeriodo2.receitaBruta +
          dadosFaturamentoMultimarcasPeriodo2.receitaBruta +
          dadosFaturamentoFranquiasPeriodo2.receitaBruta +
          dadosFaturamentoRevendaPeriodo2.receitaBruta;

        const totalVendasBrutasPeriodo2 = totalReceitaBrutaPeriodo2;

        const totalDevolucoesLiquidasPeriodo2 =
          dadosFaturamentoVarejoPeriodo2.devolucoesLiquidas +
          dadosFaturamentoMultimarcasPeriodo2.devolucoesLiquidas +
          dadosFaturamentoFranquiasPeriodo2.devolucoesLiquidas +
          dadosFaturamentoRevendaPeriodo2.devolucoesLiquidas;

        const totalDescontosPeriodo2 =
          dadosFaturamentoVarejoPeriodo2.descontos +
          dadosFaturamentoMultimarcasPeriodo2.descontos +
          dadosFaturamentoFranquiasPeriodo2.descontos +
          dadosFaturamentoRevendaPeriodo2.descontos;

        const totalCMVPeriodo2 =
          dadosCMVVarejoPeriodo2.cmv +
          dadosCMVMultimarcasPeriodo2.cmv +
          dadosCMVFranquiasPeriodo2.cmv +
          dadosCMVRevendaPeriodo2.cmv;

        // Criar estrutura de totais por canal para Período 2
        const totaisVarejoPeriodo2 = {
          totalBruto: dadosFaturamentoVarejoPeriodo2.receitaBruta,
          totalDevolucoes: dadosFaturamentoVarejoPeriodo2.devolucoesLiquidas,
          totalLiquido: dadosFaturamentoVarejoPeriodo2.receitaLiquida,
          totalCMV: dadosCMVVarejoPeriodo2.cmv,
          totalDescontos: dadosFaturamentoVarejoPeriodo2.descontos,
        };

        const totaisMultimarcasPeriodo2 = {
          totalBruto: dadosFaturamentoMultimarcasPeriodo2.receitaBruta,
          totalDevolucoes:
            dadosFaturamentoMultimarcasPeriodo2.devolucoesLiquidas,
          totalLiquido: dadosFaturamentoMultimarcasPeriodo2.receitaLiquida,
          totalCMV: dadosCMVMultimarcasPeriodo2.cmv,
          totalDescontos: dadosFaturamentoMultimarcasPeriodo2.descontos,
        };

        const totaisFranquiasPeriodo2 = {
          totalBruto: dadosFaturamentoFranquiasPeriodo2.receitaBruta,
          totalDevolucoes: dadosFaturamentoFranquiasPeriodo2.devolucoesLiquidas,
          totalLiquido: dadosFaturamentoFranquiasPeriodo2.receitaLiquida,
          totalCMV: dadosCMVFranquiasPeriodo2.cmv,
          totalDescontos: dadosFaturamentoFranquiasPeriodo2.descontos,
        };

        const totaisRevendaPeriodo2 = {
          totalBruto: dadosFaturamentoRevendaPeriodo2.receitaBruta,
          totalDevolucoes: dadosFaturamentoRevendaPeriodo2.devolucoesLiquidas,
          totalLiquido: dadosFaturamentoRevendaPeriodo2.receitaLiquida,
          totalCMV: dadosCMVRevendaPeriodo2.cmv,
          totalDescontos: dadosFaturamentoRevendaPeriodo2.descontos,
        };

        // ========== BUSCAR IMPOSTOS PERÍODO 2 ==========
        let impostosDataPeriodo2 = null;
        try {
          // Coletar transações únicas de cada canal do Período 2
          const transacoesVarejoPeriodo2 = [...new Set((faturamentoVarejoPeriodo2?.data || [])
            .map(item => item.nr_transacao)
            .filter(Boolean))];
          
          const transacoesMultimarcasPeriodo2 = [...new Set((faturamentoMultimarcasPeriodo2?.data || [])
            .map(item => item.nr_transacao)
            .filter(Boolean))];
          
          const transacoesFranquiasPeriodo2 = [...new Set((faturamentoFranquiasPeriodo2?.data || [])
            .map(item => item.nr_transacao)
            .filter(Boolean))];
          
          const transacoesRevendaPeriodo2 = [...new Set((faturamentoRevendaPeriodo2?.data || [])
            .map(item => item.nr_transacao)
            .filter(Boolean))];

          console.log('📊 Transações Período 2 para impostos:', {
            varejo: transacoesVarejoPeriodo2.length,
            multimarcas: transacoesMultimarcasPeriodo2.length,
            franquias: transacoesFranquiasPeriodo2.length,
            revenda: transacoesRevendaPeriodo2.length,
          });

          // Chamada única à rota POST simplificada
          const respostaImpostosPer2 = await api.financial.impostosPorTransacoes({
            varejo: transacoesVarejoPeriodo2,
            multimarcas: transacoesMultimarcasPeriodo2,
            franquias: transacoesFranquiasPeriodo2,
            revenda: transacoesRevendaPeriodo2,
          });

          if (respostaImpostosPer2?.success) {
            impostosDataPeriodo2 = respostaImpostosPer2.data;
            console.log('✅ Impostos Período 2 recebidos:', impostosDataPeriodo2);
          } else {
            console.warn('⚠️ Resposta de impostos Período 2 sem success');
            impostosDataPeriodo2 = {
              varejo: { icms: 0, pis: 0, cofins: 0, total: 0 },
              multimarcas: { icms: 0, pis: 0, cofins: 0, total: 0 },
              franquias: { icms: 0, pis: 0, cofins: 0, total: 0 },
              revenda: { icms: 0, pis: 0, cofins: 0, total: 0 },
            };
          }

        } catch (error) {
          console.error('⚠️ Erro ao buscar impostos Período 2:', error);
          impostosDataPeriodo2 = {
            varejo: { icms: 0, pis: 0, cofins: 0 },
            multimarcas: { icms: 0, pis: 0, cofins: 0 },
            franquias: { icms: 0, pis: 0, cofins: 0 },
            revenda: { icms: 0, pis: 0, cofins: 0 },
          };
        }

        const impostosVarejoPeriodo2 = {
          icms: impostosDataPeriodo2?.varejo?.icms || 0,
          pis: impostosDataPeriodo2?.varejo?.pis || 0,
          cofins: impostosDataPeriodo2?.varejo?.cofins || 0,
        };

        const impostosMultimarcasPeriodo2 = {
          icms: impostosDataPeriodo2?.multimarcas?.icms || 0,
          pis: impostosDataPeriodo2?.multimarcas?.pis || 0,
          cofins: impostosDataPeriodo2?.multimarcas?.cofins || 0,
        };

        const impostosFranquiasPeriodo2 = {
          icms: impostosDataPeriodo2?.franquias?.icms || 0,
          pis: impostosDataPeriodo2?.franquias?.pis || 0,
          cofins: impostosDataPeriodo2?.franquias?.cofins || 0,
        };

        const impostosRevendaPeriodo2 = {
          icms: impostosDataPeriodo2?.revenda?.icms || 0,
          pis: impostosDataPeriodo2?.revenda?.pis || 0,
          cofins: impostosDataPeriodo2?.revenda?.cofins || 0,
        };

        const icmsRealPeriodo2 =
          impostosVarejoPeriodo2.icms +
          impostosMultimarcasPeriodo2.icms +
          impostosFranquiasPeriodo2.icms +
          impostosRevendaPeriodo2.icms;

        const pisRealPeriodo2 =
          impostosVarejoPeriodo2.pis +
          impostosMultimarcasPeriodo2.pis +
          impostosFranquiasPeriodo2.pis +
          impostosRevendaPeriodo2.pis;

        const cofinsRealPeriodo2 =
          impostosVarejoPeriodo2.cofins +
          impostosMultimarcasPeriodo2.cofins +
          impostosFranquiasPeriodo2.cofins +
          impostosRevendaPeriodo2.cofins;

        const totalImpostosRealPeriodo2 =
          icmsRealPeriodo2 + pisRealPeriodo2 + cofinsRealPeriodo2;

        // IMPORTANTE: totalDescontosPeriodo2 já vem NEGATIVO, então usamos Math.abs()
        const totalDeducoesCalculadoPeriodo2 =
          totalDevolucoesLiquidasPeriodo2 +
          Math.abs(totalDescontosPeriodo2) +
          totalImpostosRealPeriodo2;

        const receitaLiquidaCalculadaPeriodo2 =
          totalVendasBrutasPeriodo2 - totalDeducoesCalculadoPeriodo2;
        const lucroBrutoCalculadoPeriodo2 =
          receitaLiquidaCalculadaPeriodo2 - totalCMVPeriodo2;

        // Calcular receitas líquidas por canal para Período 2
        // IMPORTANTE: descontos já vêm NEGATIVOS, então usamos Math.abs()
        const receitaLiquidaVarejoPeriodo2 =
          totaisVarejoPeriodo2.totalBruto -
          (totaisVarejoPeriodo2.totalDevolucoes +
            Math.abs(totaisVarejoPeriodo2.totalDescontos) +
            impostosVarejoPeriodo2.icms +
            impostosVarejoPeriodo2.pis +
            impostosVarejoPeriodo2.cofins);

        const receitaLiquidaMultimarcasPeriodo2 =
          totaisMultimarcasPeriodo2.totalBruto -
          (totaisMultimarcasPeriodo2.totalDevolucoes +
            Math.abs(totaisMultimarcasPeriodo2.totalDescontos) +
            impostosMultimarcasPeriodo2.icms +
            impostosMultimarcasPeriodo2.pis +
            impostosMultimarcasPeriodo2.cofins);

        const receitaLiquidaFranquiasPeriodo2 =
          totaisFranquiasPeriodo2.totalBruto -
          (totaisFranquiasPeriodo2.totalDevolucoes +
            Math.abs(totaisFranquiasPeriodo2.totalDescontos) +
            impostosFranquiasPeriodo2.icms +
            impostosFranquiasPeriodo2.pis +
            impostosFranquiasPeriodo2.cofins);

        const receitaLiquidaRevendaPeriodo2 =
          totaisRevendaPeriodo2.totalBruto -
          (totaisRevendaPeriodo2.totalDevolucoes +
            Math.abs(totaisRevendaPeriodo2.totalDescontos) +
            impostosRevendaPeriodo2.icms +
            impostosRevendaPeriodo2.pis +
            impostosRevendaPeriodo2.cofins);

        // Lucro bruto por canal para Período 2
        const lucroBrutoVarejoPeriodo2 =
          receitaLiquidaVarejoPeriodo2 - totaisVarejoPeriodo2.totalCMV;
        const lucroBrutoMultimarcasPeriodo2 =
          receitaLiquidaMultimarcasPeriodo2 -
          totaisMultimarcasPeriodo2.totalCMV;
        const lucroBrutoFranquiasPeriodo2 =
          receitaLiquidaFranquiasPeriodo2 - totaisFranquiasPeriodo2.totalCMV;
        const lucroBrutoRevendaPeriodo2 =
          receitaLiquidaRevendaPeriodo2 - totaisRevendaPeriodo2.totalCMV;

        // Buscar despesas do Período 2
        const todasEmpresasCodigos = [
          1, 2, 5, 6, 7, 11, 11, 12, 13, 14, 15, 16, 31, 55, 65, 75, 85, 90, 91,
          92, 93, 94, 95, 96, 97, 99, 100, 101, 111, 200, 311, 500, 550, 600,
          650, 700, 750, 850, 890, 910, 920, 930, 940, 950, 960, 970, 990,
        ];

        const paramsCPPeriodo2 = {
          dt_inicio: periodoComparacao.dt_inicio,
          dt_fim: periodoComparacao.dt_fim,
          cd_empresa: todasEmpresasCodigos,
        };

        const contasPagarPeriodo2 = await api.financial.contasPagarEmissao(
          paramsCPPeriodo2,
        );

        let dadosCPPeriodo2 = [];
        if (Array.isArray(contasPagarPeriodo2?.data)) {
          dadosCPPeriodo2 = contasPagarPeriodo2.data;
        } else if (
          contasPagarPeriodo2?.data?.data &&
          Array.isArray(contasPagarPeriodo2.data.data)
        ) {
          dadosCPPeriodo2 = contasPagarPeriodo2.data.data;
        } else if (Array.isArray(contasPagarPeriodo2?.rows)) {
          dadosCPPeriodo2 = contasPagarPeriodo2.rows;
        } else if (
          contasPagarPeriodo2?.data?.rows &&
          Array.isArray(contasPagarPeriodo2.data.rows)
        ) {
          dadosCPPeriodo2 = contasPagarPeriodo2.data.rows;
        }

        let totalOperacionaisPeriodo2 = 0;
        let totalFinanceirosPeriodo2 = 0;

        // ========== CRIAR ESTRUTURA DE NODES PARA PERÍODO 2 ==========
        console.log('🚀 INICIANDO PROCESSAMENTO PERÍODO 2:', {
          qtdRegistros: dadosCPPeriodo2.length,
        });

        // Enriquecer com nomes de despesas e fornecedores do Período 2
        const codigosDespesasPeriodo2 = Array.from(
          new Set(
            (dadosCPPeriodo2 || [])
              .map((x) => x.cd_despesaitem)
              .filter(Boolean)
              .filter((cd) => !shouldExcluirDespesa(cd)),
          ),
        );
        const codigosFornecedoresPeriodo2 = Array.from(
          new Set(
            (dadosCPPeriodo2 || []).map((x) => x.cd_fornecedor).filter(Boolean),
          ),
        );

        let despesaMapPeriodo2 = new Map();
        let fornecedorMapPeriodo2 = new Map();
        try {
          const [despesasRespPeriodo2, fornecedoresRespPeriodo2] =
            await Promise.all([
              api.financial.despesa({
                cd_despesaitem: codigosDespesasPeriodo2,
              }),
              api.financial.fornecedor({
                cd_fornecedor: codigosFornecedoresPeriodo2,
              }),
            ]);

          const despesasDataPeriodo2 = Array.isArray(despesasRespPeriodo2?.data)
            ? despesasRespPeriodo2.data
            : Array.isArray(despesasRespPeriodo2)
            ? despesasRespPeriodo2
            : [];
          const fornecedoresDataPeriodo2 = Array.isArray(
            fornecedoresRespPeriodo2?.data,
          )
            ? fornecedoresRespPeriodo2.data
            : Array.isArray(fornecedoresRespPeriodo2)
            ? fornecedoresRespPeriodo2
            : [];

          despesaMapPeriodo2 = new Map(
            despesasDataPeriodo2
              .filter((d) => d && d.cd_despesaitem !== undefined)
              .map((d) => [d.cd_despesaitem, d]),
          );
          fornecedorMapPeriodo2 = new Map(
            fornecedoresDataPeriodo2
              .filter((f) => f && f.cd_fornecedor !== undefined)
              .map((f) => [f.cd_fornecedor, f]),
          );

          console.log('📋 DADOS PERÍODO 2 CARREGADOS:', {
            despesas: {
              qtdCodigos: codigosDespesasPeriodo2.length,
              qtdEncontradas: despesaMapPeriodo2.size,
            },
            fornecedores: {
              qtdCodigos: codigosFornecedoresPeriodo2.length,
              qtdEncontrados: fornecedorMapPeriodo2.size,
            },
          });
        } catch (errMapsPeriodo2) {
          console.warn(
            'Falha ao enriquecer nomes de despesa/fornecedor do Período 2:',
            errMapsPeriodo2,
          );
        }

        // Função de categoria por faixa de código (igual Período 1)
        const getCategoriaByCodigo = (codigo) => {
          if (codigo >= 1000 && codigo <= 1999) {
            return 'CUSTO DAS MERCADORIAS VENDIDAS';
          } else if (codigo >= 2000 && codigo <= 2999) {
            return 'DESPESAS OPERACIONAIS';
          } else if (codigo >= 3000 && codigo <= 3999) {
            return 'DESPESAS COM PESSOAL';
          } else if (codigo >= 4001 && codigo <= 4999) {
            return 'ALUGUÉIS E ARRENDAMENTOS';
          } else if (codigo >= 5000 && codigo <= 5999) {
            return 'IMPOSTOS, TAXAS E CONTRIBUIÇÕES';
          } else if (codigo >= 6000 && codigo <= 6999) {
            return 'DESPESAS GERAIS';
          } else if (codigo >= 7000 && codigo <= 7999) {
            return 'DESPESAS FINANCEIRAS';
          } else if (codigo >= 8000 && codigo <= 8999) {
            return 'OUTRAS DESPESAS OPERACIONAIS';
          } else if (codigo >= 9000 && codigo <= 9999) {
            return 'DESPESAS C/ VENDAS';
          } else {
            return 'SEM CLASSIFICAÇÃO';
          }
        };

        const gruposMapPeriodo2 = new Map();
        const gruposFinanceirosMapPeriodo2 = new Map();

        for (const item of dadosCPPeriodo2) {
          const ccustoRaw =
            item.cd_ccusto ??
            item.ccusto ??
            item.cd_centrocusto ??
            item.centrocusto ??
            item.cc_custo ??
            item.centro_custo ??
            item.cd_ccusto_padrao;
          const ccustoNum = Number(ccustoRaw);
          if (!Number.isNaN(ccustoNum) && ccustoNum === 999) continue;

          const codigoDespesa = Number(item.cd_despesaitem) || 0;
          if (shouldExcluirDespesa(codigoDespesa)) continue;

          const valorRateio = parseFloat(item.vl_rateio || 0) || 0;
          const valorDuplicata = parseFloat(item.vl_duplicata || 0) || 0;
          const valor = valorRateio !== 0 ? valorRateio : valorDuplicata;

          // Determinar se é operacional ou financeiro
          const isFinanceiro = codigoDespesa >= 7000 && codigoDespesa <= 7999;

          if (isFinanceiro) {
            totalFinanceirosPeriodo2 += Math.abs(valor);
          } else {
            totalOperacionaisPeriodo2 += Math.abs(valor);
          }

          // Obter classificação COM FALLBACK para faixa de códigos
          // Se for financeiro (7000-7999), FORÇAR categoria "DESPESAS FINANCEIRAS"
          let chaveGrupo = isFinanceiro
            ? 'DESPESAS FINANCEIRAS'
            : getCategoriaPorCodigo(codigoDespesa) ||
              getCategoriaByCodigo(codigoDespesa);

          // Se a classificação resultou em "DESPESAS FINANCEIRAS",
          // garantir que vai para o grupo financeiro independente do código
          const isGrupoFinanceiro = chaveGrupo === 'DESPESAS FINANCEIRAS';

          const grupoAtual = isGrupoFinanceiro
            ? gruposFinanceirosMapPeriodo2
            : gruposMapPeriodo2;

          // Atualizar totais baseado no grupo real
          if (isGrupoFinanceiro && !isFinanceiro) {
            // Corrigir totais se mudou de operacional para financeiro
            totalOperacionaisPeriodo2 -= Math.abs(valor);
            totalFinanceirosPeriodo2 += Math.abs(valor);
          }

          // Criar grupo de despesas
          if (!grupoAtual.has(chaveGrupo)) {
            grupoAtual.set(chaveGrupo, {
              id: `grp-p2-${chaveGrupo}`,
              label: chaveGrupo,
              description: '',
              value: 0,
              type: 'despesa',
              children: [],
              _despesas: new Map(),
            });
          }

          const grupo = grupoAtual.get(chaveGrupo);
          grupo.value += -valor;

          // Buscar nome da despesa no mapa (igual Período 1)
          // 🔧 CONVERTER PARA NÚMERO para buscar no Map
          const nomeDespesa = (
            despesaMapPeriodo2.get(Number(item.cd_despesaitem))
              ?.ds_despesaitem ||
            item.nm_despesaitem ||
            item.ds_despesaitem ||
            `CÓDIGO ${codigoDespesa}`
          )
            .toString()
            .trim();

          if (!grupo._despesas.has(nomeDespesa)) {
            grupo._despesas.set(nomeDespesa, {
              id: `desp-p2-${chaveGrupo}-${nomeDespesa}`,
              label: nomeDespesa,
              description: `Código: ${codigoDespesa}`,
              value: 0,
              type: 'despesa',
              children: [],
              _forn: new Map(),
              _fornCount: 0,
            });
          }

          const despesa = grupo._despesas.get(nomeDespesa);

          // Adicionar camada de fornecedores (igual Período 1)
          // 🔧 CONVERTER PARA NÚMERO para buscar no Map
          const fornInfo = fornecedorMapPeriodo2.get(
            Number(item.cd_fornecedor),
          );
          const nmFornecedor = (
            fornInfo?.nm_fornecedor ||
            item.nm_fornecedor ||
            item.cd_fornecedor ||
            'Fornecedor'
          ).toString();
          const fornKey = String(item.cd_fornecedor || nmFornecedor);

          if (!despesa._forn.has(fornKey)) {
            despesa._forn.set(fornKey, {
              id: `forn-p2-${fornKey}`,
              label: nmFornecedor,
              description: [
                `Empresa: ${item.cd_empresa || '-'}`,
                `Fornecedor: ${item.cd_fornecedor || '-'}`,
              ].join(' | '),
              value: 0,
              type: 'despesa',
              children: [],
            });
            despesa._fornCount += 1;
          }

          const fornecedor = despesa._forn.get(fornKey);
          fornecedor.value += -valor;

          despesa.value += -valor;
        }

        console.log('🔵 PERÍODO 2 - Grupos criados:', {
          operacionais: gruposMapPeriodo2.size,
          financeiros: gruposFinanceirosMapPeriodo2.size,
        });

        // Converter Maps para arrays de nodes - OPERACIONAIS PERÍODO 2
        const nodesPeriodo2 = Array.from(gruposMapPeriodo2.values()).map(
          (g) => {
            const despesasArr = Array.from(g._despesas.values()).map((d) => {
              // Materializar fornecedores (igual Período 1)
              d.description = `${d._fornCount} fornecedor(es) | Total: ${Number(
                Math.abs(d.value),
              ).toLocaleString('pt-BR', {
                style: 'currency',
                currency: 'BRL',
              })}`;
              d.children = Array.from(d._forn.values()).sort(
                (a, b) => Math.abs(b.value) - Math.abs(a.value),
              );
              delete d._forn;
              delete d._fornCount;
              return d;
            });
            despesasArr.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
            g.children = despesasArr;
            delete g._despesas;
            return g;
          },
        );
        nodesPeriodo2.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
        setPlanoDespesasNodesPeriodo2(nodesPeriodo2);

        // Converter Maps para arrays de nodes - FINANCEIRAS PERÍODO 2
        const nodesFinanceirasPeriodo2 = Array.from(
          gruposFinanceirosMapPeriodo2.values(),
        ).map((g) => {
          const despesasArr = Array.from(g._despesas.values()).map((d) => {
            // Materializar fornecedores (igual Período 1)
            d.description = `${d._fornCount} fornecedor(es) | Total: ${Number(
              Math.abs(d.value),
            ).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`;
            d.children = Array.from(d._forn.values()).sort(
              (a, b) => Math.abs(b.value) - Math.abs(a.value),
            );
            delete d._forn;
            delete d._fornCount;
            return d;
          });
          despesasArr.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
          g.children = despesasArr;
          delete g._despesas;
          return g;
        });
        nodesFinanceirasPeriodo2.sort(
          (a, b) => Math.abs(b.value) - Math.abs(a.value),
        );
        setPlanoDespesasFinanceirasNodesPeriodo2(nodesFinanceirasPeriodo2);

        console.log('✅ PERÍODO 2 - Nodes criados:', {
          operacionais: nodesPeriodo2.length,
          financeiras: nodesFinanceirasPeriodo2.length,
        });

        // Salvar dados do Período 2
        setDadosPeriodo2({
          vendasBrutas: totalVendasBrutasPeriodo2,
          devolucoes: totalDevolucoesLiquidasPeriodo2,
          descontos: totalDescontosPeriodo2,
          totalDeducoes: totalDeducoesCalculadoPeriodo2,
          cmv: totalCMVPeriodo2,
          receitaLiquida: receitaLiquidaCalculadaPeriodo2,
          lucroBruto: lucroBrutoCalculadoPeriodo2,
          icms: icmsRealPeriodo2,
          pis: pisRealPeriodo2,
          cofins: cofinsRealPeriodo2,
          totalImpostos: totalImpostosRealPeriodo2,
          planoDespesasTotal: totalOperacionaisPeriodo2,
          planoDespesasFinanceirasTotal: totalFinanceirosPeriodo2,
          // Dados por canal
          totaisVarejo: totaisVarejoPeriodo2,
          totaisMultimarcas: totaisMultimarcasPeriodo2,
          totaisFranquias: totaisFranquiasPeriodo2,
          totaisRevenda: totaisRevendaPeriodo2,
          impostosVarejo: impostosVarejoPeriodo2,
          impostosMultimarcas: impostosMultimarcasPeriodo2,
          impostosFranquias: impostosFranquiasPeriodo2,
          impostosRevenda: impostosRevendaPeriodo2,
          receitaLiquidaVarejo: receitaLiquidaVarejoPeriodo2,
          receitaLiquidaMultimarcas: receitaLiquidaMultimarcasPeriodo2,
          receitaLiquidaFranquias: receitaLiquidaFranquiasPeriodo2,
          receitaLiquidaRevenda: receitaLiquidaRevendaPeriodo2,
          cmvVarejo: totaisVarejoPeriodo2.totalCMV,
          cmvMultimarcas: totaisMultimarcasPeriodo2.totalCMV,
          cmvFranquias: totaisFranquiasPeriodo2.totalCMV,
          cmvRevenda: totaisRevendaPeriodo2.totalCMV,
          lucroBrutoVarejo: lucroBrutoVarejoPeriodo2,
          lucroBrutoMultimarcas: lucroBrutoMultimarcasPeriodo2,
          lucroBrutoFranquias: lucroBrutoFranquiasPeriodo2,
          lucroBrutoRevenda: lucroBrutoRevendaPeriodo2,
        });
      }

      // ================= Plano de Contas (Contas a Pagar - Emissão) =================
      try {
        setLoadingStatus('Buscando Contas a Pagar (Emissão)...');
        // Usar exatamente as mesmas empresas do Varejo
        const todasEmpresasCodigos = [
          1, 2, 5, 6, 7, 11, 12, 13, 14, 15, 16, 31, 55, 65, 75, 85, 90, 91, 92,
          93, 94, 95, 96, 97, 99, 100, 101, 111, 200, 311, 500, 550, 600, 650,
          700, 750, 850, 890, 910, 920, 930, 940, 950, 960, 970, 990,
        ];

        const paramsCP = {
          dt_inicio: periodo.dt_inicio,
          dt_fim: periodo.dt_fim,
          cd_empresa: todasEmpresasCodigos,
        };
        const contasPagar = await api.financial.contasPagarEmissao(paramsCP);

        // Buscar nomes das despesas e fornecedores
        setLoadingStatus('Buscando nomes das despesas e fornecedores...');

        // Normalizar formatos possíveis da resposta
        let dadosCP = [];
        if (Array.isArray(contasPagar?.data)) {
          dadosCP = contasPagar.data;
        } else if (
          contasPagar?.data?.data &&
          Array.isArray(contasPagar.data.data)
        ) {
          dadosCP = contasPagar.data.data;
        } else if (Array.isArray(contasPagar?.rows)) {
          dadosCP = contasPagar.rows;
        } else if (
          contasPagar?.data?.rows &&
          Array.isArray(contasPagar.data.rows)
        ) {
          dadosCP = contasPagar.data.rows;
        }

        // Função de categoria por faixa de código (igual Contas a Pagar)
        const getCategoriaByCodigo = (codigo) => {
          if (codigo >= 1000 && codigo <= 1999) {
            return 'CUSTO DAS MERCADORIAS VENDIDAS';
          } else if (codigo >= 2000 && codigo <= 2999) {
            return 'DESPESAS OPERACIONAIS';
          } else if (codigo >= 3000 && codigo <= 3999) {
            return 'DESPESAS COM PESSOAL';
          } else if (codigo >= 4001 && codigo <= 4999) {
            return 'ALUGUÉIS E ARRENDAMENTOS';
          } else if (codigo >= 5000 && codigo <= 5999) {
            return 'IMPOSTOS, TAXAS E CONTRIBUIÇÕES';
          } else if (codigo >= 6000 && codigo <= 6999) {
            return 'DESPESAS GERAIS';
          } else if (codigo >= 7000 && codigo <= 7999) {
            return 'DESPESAS FINANCEIRAS';
          } else if (codigo >= 8000 && codigo <= 8999) {
            return 'OUTRAS DESPESAS OPERACIONAIS';
          } else if (codigo >= 9000 && codigo <= 9999) {
            return 'DESPESAS C/ VENDAS';
          } else {
            return 'SEM CLASSIFICAÇÃO';
          }
        };

        // Buscar nomes para despesas e fornecedores e agrupar: Categoria -> Despesa -> Fornecedor
        const codigosDespesas = Array.from(
          new Set(
            (dadosCP || [])
              .map((x) => x.cd_despesaitem)
              .filter(Boolean)
              .filter((cd) => !shouldExcluirDespesa(cd)),
          ),
        );
        const codigosFornecedores = Array.from(
          new Set((dadosCP || []).map((x) => x.cd_fornecedor).filter(Boolean)),
        );

        let despesaMap = new Map();
        let fornecedorMap = new Map();
        try {
          const [despesasResp, fornecedoresResp] = await Promise.all([
            api.financial.despesa({ cd_despesaitem: codigosDespesas }),
            api.financial.fornecedor({ cd_fornecedor: codigosFornecedores }),
          ]);
          const despesasData = Array.isArray(despesasResp?.data)
            ? despesasResp.data
            : Array.isArray(despesasResp)
            ? despesasResp
            : [];
          const fornecedoresData = Array.isArray(fornecedoresResp?.data)
            ? fornecedoresResp.data
            : Array.isArray(fornecedoresResp)
            ? fornecedoresResp
            : [];
          despesaMap = new Map(
            despesasData
              .filter((d) => d && d.cd_despesaitem !== undefined)
              .map((d) => [d.cd_despesaitem, d]),
          );
          fornecedorMap = new Map(
            fornecedoresData
              .filter((f) => f && f.cd_fornecedor !== undefined)
              .map((f) => [f.cd_fornecedor, f]),
          );
        } catch (errMaps) {
          console.warn(
            'Falha ao enriquecer nomes de despesa/fornecedor:',
            errMaps,
          );
        }

        const gruposMap = new Map();
        let totalGeral = 0;

        // Contadores para análise de problemas
        const problemasAnalise = {
          semClassificacao: [],
          semDespesa: [],
          codigosDespesaInvalidos: [],
          codigosFornecedorInvalidos: [],
        };

        // Logs de diagnóstico para divergências reportadas
        try {
          const debugRegistroChave = {
            cd_empresa: '1',
            cd_fornecedor: '31124',
            nr_duplicata: '854',
            nr_parcela: '3',
            cd_despesaitem: '6031',
          };
          const itensChave = (dadosCP || []).filter(
            (x) =>
              String(x.cd_empresa) === debugRegistroChave.cd_empresa &&
              String(x.cd_fornecedor) === debugRegistroChave.cd_fornecedor &&
              String(x.nr_duplicata) === debugRegistroChave.nr_duplicata &&
              String(x.nr_parcela) === debugRegistroChave.nr_parcela &&
              String(x.cd_despesaitem) === debugRegistroChave.cd_despesaitem,
          );
          const somaChave = itensChave.reduce((acc, x) => {
            const vr = parseFloat(x.vl_rateio || 0) || 0;
            const vd = parseFloat(x.vl_duplicata || 0) || 0;
            const valor = vr !== 0 ? vr : vd;
            return acc + valor;
          }, 0);
          const itensCod6031 = (dadosCP || []).filter(
            (x) => String(x.cd_despesaitem) === '6031',
          );
          const soma6031 = itensCod6031.reduce((acc, x) => {
            const vr = parseFloat(x.vl_rateio || 0) || 0;
            const vd = parseFloat(x.vl_duplicata || 0) || 0;
            const valor = vr !== 0 ? vr : vd;
            return acc + valor;
          }, 0);
          // Quebras por empresa, fornecedor e por duplicata/parcela
          const somaPorEmpresaFornecedor = {};
          const somaPorDuplicataParcela = {};
          for (const x of itensCod6031) {
            const vr = parseFloat(x.vl_rateio || 0) || 0;
            const vd = parseFloat(x.vl_duplicata || 0) || 0;
            const valor = vr !== 0 ? vr : vd;
            const kEF = `${String(x.cd_empresa)}|${String(x.cd_fornecedor)}`;
            const kDP = `${String(x.nr_duplicata)}|${String(x.nr_parcela)}`;
            somaPorEmpresaFornecedor[kEF] =
              (somaPorEmpresaFornecedor[kEF] || 0) + valor;
            somaPorDuplicataParcela[kDP] =
              (somaPorDuplicataParcela[kDP] || 0) + valor;
          }
          const tabelaEF = Object.entries(somaPorEmpresaFornecedor)
            .map(([k, v]) => {
              const [empresa, fornecedor] = k.split('|');
              return { empresa, fornecedor, total: v };
            })
            .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
          const tabelaDP = Object.entries(somaPorDuplicataParcela)
            .map(([k, v]) => {
              const [duplicata, parcela] = k.split('|');
              return { duplicata, parcela, total: v };
            })
            .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
        } catch (e) {
          console.warn('Falha ao gerar logs de diagnóstico DRE:', e);
        }

        for (const item of dadosCP) {
          // Removido: não alteramos a lista durante o processamento

          // Bloquear itens com centro de custo 999
          const ccustoRaw =
            item.cd_ccusto ??
            item.ccusto ??
            item.cd_centrocusto ??
            item.centrocusto ??
            item.cc_custo ??
            item.centro_custo ??
            item.cd_ccusto_padrao;
          const ccustoNum = Number(ccustoRaw);
          if (!Number.isNaN(ccustoNum) && ccustoNum === 999) {
            // Ignorar este lançamento
            continue;
          }
          // Ignorar itens por código de despesa configurado
          const codigoDespesa = Number(item.cd_despesaitem) || 0;
          if (shouldExcluirDespesa(codigoDespesa)) {
            continue;
          }
          const valorRateio = parseFloat(item.vl_rateio || 0) || 0;
          const valorDuplicata = parseFloat(item.vl_duplicata || 0) || 0;
          const valor = valorRateio !== 0 ? valorRateio : valorDuplicata;
          totalGeral += valor;

          // Verificar se é despesa financeira (7000-7999)
          const isFinanceiro = codigoDespesa >= 7000 && codigoDespesa <= 7999;

          const categoriaExcecao = getCategoriaPorCodigo(codigoDespesa);
          // Se for financeiro (7000-7999), FORÇAR categoria "DESPESAS FINANCEIRAS"
          const chaveGrupo = isFinanceiro
            ? 'DESPESAS FINANCEIRAS'
            : categoriaExcecao || getCategoriaByCodigo(codigoDespesa);

          // Analisar problemas de classificação
          if (chaveGrupo === 'SEM CLASSIFICAÇÃO') {
            problemasAnalise.semClassificacao.push({
              cd_despesaitem: item.cd_despesaitem,
              cd_fornecedor: item.cd_fornecedor,
              nr_duplicata: item.nr_duplicata,
              valor: valor,
              motivo: `Código ${codigoDespesa} não está em nenhuma faixa (1000-1999, 2000-2999, etc.) nem nas exceções`,
            });
          }

          // Verificar se código de despesa é inválido
          if (
            !item.cd_despesaitem ||
            item.cd_despesaitem === '' ||
            item.cd_despesaitem === null
          ) {
            problemasAnalise.codigosDespesaInvalidos.push({
              cd_fornecedor: item.cd_fornecedor,
              nr_duplicata: item.nr_duplicata,
              valor: valor,
              motivo: 'cd_despesaitem está vazio, null ou undefined',
            });
          }
          if (!gruposMap.has(chaveGrupo)) {
            gruposMap.set(chaveGrupo, {
              id: `grp-${chaveGrupo}`,
              label: chaveGrupo,
              description: '',
              value: 0,
              type: 'despesa',
              children: [],
              _despesas: new Map(),
            });
          }
          const grupo = gruposMap.get(chaveGrupo);

          // 🔧 CONVERTER PARA NÚMERO para buscar no Map
          const nomeDespesa = (
            despesaMap.get(Number(item.cd_despesaitem))?.ds_despesaitem ||
            item.ds_despesaitem ||
            'SEM DESPESA'
          )
            .toString()
            .trim();

          // Analisar problemas de nome de despesa
          if (nomeDespesa === 'SEM DESPESA') {
            problemasAnalise.semDespesa.push({
              cd_despesaitem: item.cd_despesaitem,
              cd_fornecedor: item.cd_fornecedor,
              nr_duplicata: item.nr_duplicata,
              valor: valor,
              motivo: `Código ${item.cd_despesaitem} não encontrado na API /despesa nem tem ds_despesaitem no item original`,
              temNaAPI: despesaMap.has(Number(item.cd_despesaitem)),
              temNoItem: !!item.ds_despesaitem,
            });
          }
          if (!grupo._despesas.has(nomeDespesa)) {
            grupo._despesas.set(nomeDespesa, {
              id: `desp-${chaveGrupo}-${nomeDespesa}`,
              label: nomeDespesa,
              description: '',
              value: 0,
              type: 'despesa',
              children: [],
              _forn: new Map(),
              _fornCount: 0,
            });
          }
          const nodoDespesa = grupo._despesas.get(nomeDespesa);

          // 🔧 CONVERTER PARA NÚMERO para buscar no Map
          const fornInfo = fornecedorMap.get(Number(item.cd_fornecedor));
          const nmFornecedor = (
            fornInfo?.nm_fornecedor ||
            item.nm_fornecedor ||
            item.cd_fornecedor ||
            'Fornecedor'
          ).toString();
          const fornKey = String(item.cd_fornecedor || nmFornecedor);
          if (!nodoDespesa._forn.has(fornKey)) {
            nodoDespesa._forn.set(fornKey, {
              id: `forn-${fornKey}`,
              label: nmFornecedor,
              description: [
                `Empresa: ${item.cd_empresa || '-'}`,
                `Fornecedor: ${item.cd_fornecedor || '-'}`,
              ].join(' | '),
              value: 0,
              type: 'despesa',
              children: [],
            });
            nodoDespesa._fornCount += 1;
          }
          const nodoFornecedor = nodoDespesa._forn.get(fornKey);
          nodoFornecedor.value += -valor;

          nodoDespesa.value += -valor;
          grupo.value += -valor;
        }

        // Materializar árvores e ordenar
        const grupos = Array.from(gruposMap.values()).map((g) => {
          const despesasArr = Array.from(g._despesas.values()).map((d) => {
            d.description = `${d._fornCount} fornecedor(es) | Total: ${Number(
              Math.abs(d.value),
            ).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`;
            d.children = Array.from(d._forn.values()).sort(
              (a, b) => Math.abs(b.value) - Math.abs(a.value),
            );
            return d;
          });
          despesasArr.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
          g.children = despesasArr;
          delete g._despesas;
          return g;
        });
        grupos.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

        // Separar DESPESAS FINANCEIRAS do restante
        const gruposFinanceiros = grupos.filter(
          (g) => g.label === 'DESPESAS FINANCEIRAS',
        );
        const gruposOperacionais = grupos.filter(
          (g) => g.label !== 'DESPESAS FINANCEIRAS',
        );

        // Totais positivos (valores de grupos são negativos)
        const totalOperacionais = gruposOperacionais.reduce(
          (acc, g) => acc + Math.abs(g.value),
          0,
        );
        const totalFinanceiros = gruposFinanceiros.reduce(
          (acc, g) => acc + Math.abs(g.value),
          0,
        );

        setPlanoDespesasNodes(gruposOperacionais);
        setPlanoDespesasTotal(totalOperacionais);
        setPlanoDespesasFinanceirasNodes(gruposFinanceiros);
        setPlanoDespesasFinanceirasTotal(totalFinanceiros);
      } catch (error) {
        console.error(
          'Erro ao buscar/gerar Plano de Contas (AP Emissão):',
          error,
        );
        setPlanoDespesasNodes([]);
        setPlanoDespesasTotal(0);
      }
      */
      // ================= FIM DO CÓDIGO LEGADO =================
    } catch (err) {
      console.error('Erro ao buscar vendas brutas:', err);
      setError(`Erro ao carregar dados: ${err.message || 'Erro desconhecido'}`);
    } finally {
      setLoading(false);
      setLoadingStatus('');
    }
  }, [api, periodos, shouldExcluirDespesa]);

  // Remover busca automática - só buscar quando clicar no botão

  // Funções auxiliares de formatação
  const formatCurrency = (value) => {
    const formatted = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(Math.abs(value));

    return value < 0 ? `-${formatted}` : formatted;
  };

  // Função auxiliar para converter filtro mensal em nome do mês
  const obterNomeMes = (filtroMensal) => {
    const mesesMap = {
      ANO: 'Ano',
      JAN: 'Janeiro',
      FEV: 'Fevereiro',
      MAR: 'Março',
      ABR: 'Abril',
      MAI: 'Maio',
      JUN: 'Junho',
      JUL: 'Julho',
      AGO: 'Agosto',
      SET: 'Setembro',
      OUT: 'Outubro',
      NOV: 'Novembro',
      DEZ: 'Dezembro',
    };
    return mesesMap[filtroMensal] || 'Período';
  };

  // Função auxiliar para calcular porcentagem
  const calcularPorcentagem = (valor, total) => {
    if (total === 0) return 0;
    return Math.abs((valor / total) * 100);
  };

  // Função auxiliar para calcular variação percentual entre dois períodos
  const calcularVariacao = (valorAtual, valorAnterior) => {
    // Se o valor anterior é zero, considerar como crescimento infinito se atual > 0
    if (valorAnterior === 0) {
      if (valorAtual > 0) return { percentual: 100, tipo: 'aumento' };
      if (valorAtual < 0) return { percentual: 100, tipo: 'queda' };
      return { percentual: 0, tipo: 'neutro' };
    }

    // Calcular variação percentual: ((Atual - Anterior) / |Anterior|) * 100
    const variacao =
      ((valorAtual - valorAnterior) / Math.abs(valorAnterior)) * 100;

    return {
      percentual: Math.abs(variacao).toFixed(1),
      tipo: variacao > 0 ? 'aumento' : variacao < 0 ? 'queda' : 'neutro',
    };
  };

  // Função auxiliar para gerar estrutura DRE com base em dados específicos
  const gerarEstruturaDRE = useCallback(
    (dados, nodesOperacionais = null, nodesFinanceiras = null) => {
      const {
        vendasBrutas: vb,
        devolucoes: dev,
        descontos: desc,
        totalDeducoes: td,
        cmv: cmvVal,
        receitaLiquida: rl,
        lucroBruto: lb,
        icms: icmsVal,
        pis: pisVal,
        cofins: cofinsVal,
        totalImpostos: ti,
        planoDespesasTotal: pdt,
        planoDespesasFinanceirasTotal: pdft,
        totaisVarejo: tv,
        totaisMultimarcas: tm,
        totaisFranquias: tf,
        totaisRevenda: tr,
        impostosVarejo: iv,
        impostosMultimarcas: im,
        impostosFranquias: ifrq,
        impostosRevenda: ir,
        receitaLiquidaVarejo: rlv,
        receitaLiquidaMultimarcas: rlm,
        receitaLiquidaFranquias: rlf,
        receitaLiquidaRevenda: rlr,
        cmvVarejo: cv,
        cmvMultimarcas: cmtm,
        cmvFranquias: cf,
        cmvRevenda: cr,
        lucroBrutoVarejo: lbv,
        lucroBrutoMultimarcas: lbm,
        lucroBrutoFranquias: lbf,
        lucroBrutoRevenda: lbr,
      } = dados;

      // 🔍 DEBUG: Log dos nodes recebidos
      console.log('📦 CRIANDO NODOS DE DESPESAS:', {
        qtdOperacionais: nodesOperacionais?.length || 0,
        qtdFinanceiras: nodesFinanceiras?.length || 0,
        primeirosOperacionais: nodesOperacionais?.slice(0, 3).map((n) => ({
          label: n.label,
          value: n.value,
          qtdChildren: n.children?.length || 0,
        })),
      });

      // Despesas Operacionais
      const despesasOperacionaisNode = {
        id: 'despesas-operacionais',
        label: 'Despesas Operacionais',
        description:
          'Linhas de Contas a Pagar (Emissão), para classificação posterior.',
        value: -pdt,
        type: 'despesa',
        children: nodesOperacionais || [],
      };

      // Despesas Financeiras
      const despesasFinanceirasNode = {
        id: 'despesas-financeiras',
        label: 'Despesas Financeiras',
        description: 'Encargos, juros e demais despesas financeiras.',
        value: -pdft,
        type: 'despesa',
        children: nodesFinanceiras || [],
      };

      return [
        {
          id: 'vendas-bruta',
          label: 'Receitas Brutas',
          description: 'Quanto você vendeu no período (sem tirar nada ainda).',
          value: vb,
          type: 'receita',
          children: [
            {
              id: 'varejo',
              label: 'Varejo',
              description: 'Vendas do canal Varejo',
              value: tv.totalBruto,
              type: 'receita',
              porcentagem: calcularPorcentagem(tv.totalBruto, vb).toFixed(1),
            },
            {
              id: 'multimarcas',
              label: 'Multimarcas',
              description: 'Vendas do canal Multimarcas',
              value: tm.totalBruto,
              type: 'receita',
              porcentagem: calcularPorcentagem(tm.totalBruto, vb).toFixed(1),
            },
            {
              id: 'revenda',
              label: 'Revenda',
              description: 'Vendas do canal Revenda',
              value: tr.totalBruto,
              type: 'receita',
              porcentagem: calcularPorcentagem(tr.totalBruto, vb).toFixed(1),
            },
            {
              id: 'franquias',
              label: 'Franquias',
              description: 'Vendas do canal Franquias',
              value: tf.totalBruto,
              type: 'receita',
              porcentagem: calcularPorcentagem(tf.totalBruto, vb).toFixed(1),
            },
          ],
        },
        {
          id: 'deducoes-vendas',
          label: 'Deduções sobre Vendas',
          description:
            'Devoluções, descontos concedidos e impostos sobre vendas.',
          value: (function () {
            // 🔍 DEBUG: Calcular deduções
            const valorCalculado = -(dev + Math.abs(desc) + ti);
            console.log('📊 CÁLCULO DEDUÇÕES SOBRE VENDAS:', {
              devolucoes: dev,
              descontos: desc,
              descontosAbsoluto: Math.abs(desc),
              impostos: ti,
              somaAntiga: dev + desc + ti,
              somaNova: dev + Math.abs(desc) + ti,
              valorFinalAntigo: -(dev + desc + ti),
              valorFinalNovo: valorCalculado,
            });
            return valorCalculado;
          })(),
          type: 'deducao',
          children: [
            {
              id: 'devolucoes',
              label: 'Devoluções',
              description: 'Clientes devolveram mercadorias',
              value: -dev,
              type: 'deducao',
              children: [
                {
                  id: 'devolucoes-varejo',
                  label: 'Varejo',
                  description: 'Devoluções do canal Varejo',
                  value: -tv.totalDevolucoes,
                  type: 'deducao',
                  porcentagem: calcularPorcentagem(
                    tv.totalDevolucoes,
                    dev,
                  ).toFixed(1),
                },
                {
                  id: 'devolucoes-multimarcas',
                  label: 'Multimarcas',
                  description: 'Devoluções do canal Multimarcas',
                  value: -tm.totalDevolucoes,
                  type: 'deducao',
                  porcentagem: calcularPorcentagem(
                    tm.totalDevolucoes,
                    dev,
                  ).toFixed(1),
                },
                {
                  id: 'devolucoes-revenda',
                  label: 'Revenda',
                  description: 'Devoluções do canal Revenda',
                  value: -tr.totalDevolucoes,
                  type: 'deducao',
                  porcentagem: calcularPorcentagem(
                    tr.totalDevolucoes,
                    dev,
                  ).toFixed(1),
                },
                {
                  id: 'devolucoes-franquias',
                  label: 'Franquias',
                  description: 'Devoluções do canal Franquias',
                  value: -tf.totalDevolucoes,
                  type: 'deducao',
                  porcentagem: calcularPorcentagem(
                    tf.totalDevolucoes,
                    dev,
                  ).toFixed(1),
                },
              ],
            },
            {
              id: 'descontos',
              label: 'Descontos Concedidos',
              description: 'Descontos dados aos clientes',
              value: -(
                Math.abs(tv.totalDescontos) +
                Math.abs(tm.totalDescontos) +
                Math.abs(tr.totalDescontos) +
                Math.abs(tf.totalDescontos)
              ),
              type: 'deducao',
              children: (function () {
                // 🔍 DEBUG: Valores dos descontos na criação da estrutura
                console.log('📊 CRIAÇÃO ESTRUTURA - DESCONTOS (CORRIGIDO):', {
                  descontoVarejo: tv.totalDescontos,
                  descontoMultimarcas: tm.totalDescontos,
                  descontoRevenda: tr.totalDescontos,
                  descontoFranquias: tf.totalDescontos,
                  totalDescontos:
                    tv.totalDescontos +
                    tm.totalDescontos +
                    tr.totalDescontos +
                    tf.totalDescontos,
                  observacao:
                    'Descontos são deduções - devem aparecer negativos (vermelho)',
                });

                return [
                  {
                    id: 'descontos-varejo',
                    label: 'Varejo',
                    description: 'Descontos do canal Varejo',
                    value: -Math.abs(tv.totalDescontos),
                    type: 'deducao',
                    porcentagem: calcularPorcentagem(
                      Math.abs(tv.totalDescontos),
                      Math.abs(desc),
                    ).toFixed(1),
                  },
                  {
                    id: 'descontos-multimarcas',
                    label: 'Multimarcas',
                    description: 'Descontos do canal Multimarcas',
                    value: -Math.abs(tm.totalDescontos),
                    type: 'deducao',
                    porcentagem: calcularPorcentagem(
                      Math.abs(tm.totalDescontos),
                      Math.abs(desc),
                    ).toFixed(1),
                  },
                  {
                    id: 'descontos-revenda',
                    label: 'Revenda',
                    description: 'Descontos do canal Revenda',
                    value: -Math.abs(tr.totalDescontos),
                    type: 'deducao',
                    porcentagem: calcularPorcentagem(
                      Math.abs(tr.totalDescontos),
                      Math.abs(desc),
                    ).toFixed(1),
                  },
                  {
                    id: 'descontos-franquias',
                    label: 'Franquias',
                    description: 'Descontos do canal Franquias',
                    value: -Math.abs(tf.totalDescontos),
                    type: 'deducao',
                    porcentagem: calcularPorcentagem(
                      Math.abs(tf.totalDescontos),
                      Math.abs(desc),
                    ).toFixed(1),
                  },
                ];
              })(),
            },
            {
              id: 'impostos-vendas',
              label: 'Impostos sobre Vendas',
              description: 'ICMS, PIS, COFINS e outros impostos sobre vendas.',
              value: -ti,
              type: 'deducao',
              children: [
                {
                  id: 'impostos-varejo',
                  label: 'Varejo',
                  description: 'Impostos do canal Varejo',
                  value: -(iv.icms + iv.pis + iv.cofins),
                  type: 'deducao',
                  porcentagem: calcularPorcentagem(
                    iv.icms + iv.pis + iv.cofins,
                    ti,
                  ).toFixed(1),
                  children: [
                    {
                      id: 'icms-varejo',
                      label: 'ICMS',
                      description: 'ICMS do canal Varejo',
                      value: -iv.icms,
                      type: 'deducao',
                    },
                    {
                      id: 'pis-varejo',
                      label: 'PIS',
                      description: 'PIS do canal Varejo',
                      value: -iv.pis,
                      type: 'deducao',
                    },
                    {
                      id: 'cofins-varejo',
                      label: 'COFINS',
                      description: 'COFINS do canal Varejo',
                      value: -iv.cofins,
                      type: 'deducao',
                    },
                  ],
                },
                {
                  id: 'impostos-multimarcas',
                  label: 'Multimarcas',
                  description: 'Impostos do canal Multimarcas',
                  value: -(im.icms + im.pis + im.cofins),
                  type: 'deducao',
                  porcentagem: calcularPorcentagem(
                    im.icms + im.pis + im.cofins,
                    ti,
                  ).toFixed(1),
                  children: [
                    {
                      id: 'icms-multimarcas',
                      label: 'ICMS',
                      description: 'ICMS do canal Multimarcas',
                      value: -im.icms,
                      type: 'deducao',
                    },
                    {
                      id: 'pis-multimarcas',
                      label: 'PIS',
                      description: 'PIS do canal Multimarcas',
                      value: -im.pis,
                      type: 'deducao',
                    },
                    {
                      id: 'cofins-multimarcas',
                      label: 'COFINS',
                      description: 'COFINS do canal Multimarcas',
                      value: -im.cofins,
                      type: 'deducao',
                    },
                  ],
                },
                {
                  id: 'impostos-revenda',
                  label: 'Revenda',
                  description: 'Impostos do canal Revenda',
                  value: -(ir.icms + ir.pis + ir.cofins),
                  type: 'deducao',
                  porcentagem: calcularPorcentagem(
                    ir.icms + ir.pis + ir.cofins,
                    ti,
                  ).toFixed(1),
                  children: [
                    {
                      id: 'icms-revenda',
                      label: 'ICMS',
                      description: 'ICMS do canal Revenda',
                      value: -ir.icms,
                      type: 'deducao',
                    },
                    {
                      id: 'pis-revenda',
                      label: 'PIS',
                      description: 'PIS do canal Revenda',
                      value: -ir.pis,
                      type: 'deducao',
                    },
                    {
                      id: 'cofins-revenda',
                      label: 'COFINS',
                      description: 'COFINS do canal Revenda',
                      value: -ir.cofins,
                      type: 'deducao',
                    },
                  ],
                },
                {
                  id: 'impostos-franquias',
                  label: 'Franquias',
                  description: 'Impostos do canal Franquias',
                  value: -(ifrq.icms + ifrq.pis + ifrq.cofins),
                  type: 'deducao',
                  porcentagem: calcularPorcentagem(
                    ifrq.icms + ifrq.pis + ifrq.cofins,
                    ti,
                  ).toFixed(1),
                  children: [
                    {
                      id: 'icms-franquias',
                      label: 'ICMS',
                      description: 'ICMS do canal Franquias',
                      value: -ifrq.icms,
                      type: 'deducao',
                    },
                    {
                      id: 'pis-franquias',
                      label: 'PIS',
                      description: 'PIS do canal Franquias',
                      value: -ifrq.pis,
                      type: 'deducao',
                    },
                    {
                      id: 'cofins-franquias',
                      label: 'COFINS',
                      description: 'COFINS do canal Franquias',
                      value: -ifrq.cofins,
                      type: 'deducao',
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          id: 'receita-liquida',
          label: 'Receita Líquida de Vendas',
          description: 'É o que realmente ficou das vendas.',
          value: rl,
          type: 'resultado',
          children: [
            {
              id: 'receita-liquida-varejo',
              label: 'Varejo',
              description: 'Receita líquida do canal Varejo',
              value: rlv,
              type: 'resultado',
              porcentagem: calcularPorcentagem(rlv, rl).toFixed(1),
            },
            {
              id: 'receita-liquida-multimarcas',
              label: 'Multimarcas',
              description: 'Receita líquida do canal Multimarcas',
              value: rlm,
              type: 'resultado',
              porcentagem: calcularPorcentagem(rlm, rl).toFixed(1),
            },
            {
              id: 'receita-liquida-revenda',
              label: 'Revenda',
              description: 'Receita líquida do canal Revenda',
              value: rlr,
              type: 'resultado',
              porcentagem: calcularPorcentagem(rlr, rl).toFixed(1),
            },
            {
              id: 'receita-liquida-franquias',
              label: 'Franquias',
              description: 'Receita líquida do canal Franquias',
              value: rlf,
              type: 'resultado',
              porcentagem: calcularPorcentagem(rlf, rl).toFixed(1),
            },
          ],
        },
        {
          id: 'cmv',
          label: 'Custos da Mercadoria Vendida (CMV)',
          description: 'Quanto custou comprar ou produzir o que você vendeu.',
          value: -cmvVal,
          porcentagem: (() => {
            const base = rl;
            return base > 0 ? ((cmvVal / base) * 100).toFixed(2) : '0.00';
          })(),
          type: 'custo',
          children: [
            {
              id: 'cmv-varejo',
              label: 'Varejo',
              description: 'CMV do canal Varejo',
              value: -cv,
              type: 'custo',
              porcentagem: (() => {
                const receitaMaisImpostos = rlv;
                return receitaMaisImpostos > 0
                  ? ((cv / receitaMaisImpostos) * 100).toFixed(2)
                  : '0.00';
              })(),
            },
            {
              id: 'cmv-multimarcas',
              label: 'Multimarcas',
              description: 'CMV do canal Multimarcas',
              value: -cmtm,
              type: 'custo',
              porcentagem: (() => {
                const receitaMaisImpostos = rlm;
                return receitaMaisImpostos > 0
                  ? ((cmtm / receitaMaisImpostos) * 100).toFixed(2)
                  : '0.00';
              })(),
            },
            {
              id: 'cmv-revenda',
              label: 'Revenda',
              description: 'CMV do canal Revenda',
              value: -cr,
              type: 'custo',
              porcentagem: (() => {
                const receitaMaisImpostos = rlr;
                return receitaMaisImpostos > 0
                  ? ((cr / receitaMaisImpostos) * 100).toFixed(2)
                  : '0.00';
              })(),
            },
            {
              id: 'cmv-franquias',
              label: 'Franquias',
              description: 'CMV do canal Franquias',
              value: -cf,
              type: 'custo',
              porcentagem: (() => {
                const receitaMaisImpostos = rlf;
                return receitaMaisImpostos > 0
                  ? ((cf / receitaMaisImpostos) * 100).toFixed(2)
                  : '0.00';
              })(),
            },
          ],
        },
        {
          id: 'lucro-bruto',
          label: 'Lucro Bruto',
          description: 'Receita Líquida – CMV',
          value: lb,
          type: 'resultado',
          children: [
            {
              id: 'lucro-bruto-varejo',
              label: 'Varejo',
              description: 'Lucro bruto do canal Varejo',
              value: lbv,
              type: 'resultado',
              porcentagem: calcularPorcentagem(lbv, lb).toFixed(1),
            },
            {
              id: 'lucro-bruto-multimarcas',
              label: 'Multimarcas',
              description: 'Lucro bruto do canal Multimarcas',
              value: lbm,
              type: 'resultado',
              porcentagem: calcularPorcentagem(lbm, lb).toFixed(1),
            },
            {
              id: 'lucro-bruto-revenda',
              label: 'Revenda',
              description: 'Lucro bruto do canal Revenda',
              value: lbr,
              type: 'resultado',
              porcentagem: calcularPorcentagem(lbr, lb).toFixed(1),
            },
            {
              id: 'lucro-bruto-franquias',
              label: 'Franquias',
              description: 'Lucro bruto do canal Franquias',
              value: lbf,
              type: 'resultado',
              porcentagem: calcularPorcentagem(lbf, lb).toFixed(1),
            },
          ],
        },
        despesasOperacionaisNode,
        {
          id: 'resultado-operacional',
          label: 'Resultado Operacional',
          description: 'Lucro Bruto - Despesas Operacionais',
          value: lb - pdt,
          type: 'resultado',
          children: [],
        },
        despesasFinanceirasNode,
        {
          id: 'lucro-antes-impostos',
          label: 'Lucro Antes do IR/CSLL',
          description: 'Resultado antes dos impostos sobre o lucro.',
          value: lb - pdt - pdft,
          type: 'resultado',
          children: [],
        },
        {
          id: 'impostos-lucro',
          label: 'Impostos sobre o Lucro (IR/CSLL)',
          description: 'Se a empresa paga esse tipo de imposto.',
          value: 0,
          type: 'imposto',
          children: [
            {
              id: 'irpj',
              label: 'IRPJ',
              description: 'Imposto de Renda Pessoa Jurídica',
              value: 0,
              type: 'imposto',
            },
            {
              id: 'csll',
              label: 'CSLL',
              description: 'Contribuição Social sobre o Lucro Líquido',
              value: 0,
              type: 'imposto',
            },
          ],
        },
        {
          id: 'lucro-liquido',
          label: 'Lucro Líquido do Exercício',
          description:
            'Resultado Operacional - Despesas Financeiras - Impostos sobre o Lucro',
          value: lb - pdt - pdft - 0,
          type: 'resultado-final',
          children: [],
        },
      ];
    },
    [],
  );

  // Dados do DRE com vendas brutas reais (Período 1)
  const dreData = useMemo(() => {
    const estruturaDRE = gerarEstruturaDRE(
      {
        vendasBrutas,
        devolucoes,
        descontos,
        totalDeducoes,
        cmv,
        receitaLiquida,
        lucroBruto,
        icms,
        pis,
        cofins,
        totalImpostos,
        planoDespesasTotal,
        planoDespesasFinanceirasTotal,
        totaisVarejo,
        totaisMultimarcas,
        totaisFranquias,
        totaisRevenda,
        impostosVarejo,
        impostosMultimarcas,
        impostosFranquias,
        impostosRevenda,
        receitaLiquidaVarejo,
        receitaLiquidaMultimarcas,
        receitaLiquidaFranquias,
        receitaLiquidaRevenda,
        cmvVarejo,
        cmvMultimarcas,
        cmvFranquias,
        cmvRevenda,
        lucroBrutoVarejo,
        lucroBrutoMultimarcas,
        lucroBrutoFranquias,
        lucroBrutoRevenda,
      },
      planoDespesasNodes,
      planoDespesasFinanceirasNodes,
    );

    return estruturaDRE;
  }, [
    vendasBrutas,
    devolucoes,
    descontos,
    totalDeducoes,
    cmv,
    receitaLiquida,
    lucroBruto,
    icms,
    pis,
    cofins,
    totalImpostos,
    planoDespesasTotal,
    planoDespesasNodes,
    planoDespesasFinanceirasNodes,
    totaisVarejo,
    totaisMultimarcas,
    totaisFranquias,
    totaisRevenda,
    impostosVarejo,
    impostosMultimarcas,
    impostosFranquias,
    impostosRevenda,
    receitaLiquidaVarejo,
    receitaLiquidaMultimarcas,
    receitaLiquidaFranquias,
    receitaLiquidaRevenda,
    cmvVarejo,
    cmvMultimarcas,
    cmvFranquias,
    cmvRevenda,
    lucroBrutoVarejo,
    lucroBrutoMultimarcas,
    lucroBrutoFranquias,
    lucroBrutoRevenda,
    planoDespesasFinanceirasTotal,
  ]);

  // DRE do Período 2 (quando há comparação)
  const drePeriodo2Data = useMemo(() => {
    if (!dadosPeriodo2.vendasBrutas) {
      return [];
    }

    return gerarEstruturaDRE(
      dadosPeriodo2,
      planoDespesasNodesPeriodo2,
      planoDespesasFinanceirasNodesPeriodo2,
    );
  }, [
    dadosPeriodo2,
    gerarEstruturaDRE,
    planoDespesasNodesPeriodo2,
    planoDespesasFinanceirasNodesPeriodo2,
  ]);

  // Função para mesclar nodes de despesas dos dois períodos
  const mesclarNodes = useCallback((nodes1, nodes2) => {
    const nodesMap = new Map();

    // Adicionar nodes do Período 1
    for (const node of nodes1) {
      const chave = node.label || node.nome || node.id;
      nodesMap.set(chave, { ...node });
    }

    // Mesclar com nodes do Período 2
    for (const node of nodes2) {
      const chave = node.label || node.nome || node.id;
      if (nodesMap.has(chave)) {
        const existing = nodesMap.get(chave);
        existing.value = (existing.value || 0) + (node.value || 0);
        existing.valor = (existing.valor || 0) + (node.valor || 0);

        // Mesclar children
        if (node.children && existing.children) {
          const childrenMap = new Map();
          for (const child of existing.children) {
            const childChave = child.label || child.nome || child.id;
            childrenMap.set(childChave, { ...child });
          }
          for (const child of node.children) {
            const childChave = child.label || child.nome || child.id;
            if (childrenMap.has(childChave)) {
              const existingChild = childrenMap.get(childChave);
              existingChild.value =
                (existingChild.value || 0) + (child.value || 0);
              existingChild.valor =
                (existingChild.valor || 0) + (child.valor || 0);

              // Mesclar sub-children (contas)
              if (child.children && existingChild.children) {
                const subChildrenMap = new Map();
                for (const subChild of existingChild.children) {
                  const subChave =
                    subChild.label || subChild.nome || subChild.id;
                  subChildrenMap.set(subChave, { ...subChild });
                }
                for (const subChild of child.children) {
                  const subChave =
                    subChild.label || subChild.nome || subChild.id;
                  if (subChildrenMap.has(subChave)) {
                    const existing = subChildrenMap.get(subChave);
                    existing.value =
                      (existing.value || 0) + (subChild.value || 0);
                    existing.valor =
                      (existing.valor || 0) + (subChild.valor || 0);
                  } else {
                    subChildrenMap.set(subChave, { ...subChild });
                  }
                }
                existingChild.children = Array.from(
                  subChildrenMap.values(),
                ).sort(
                  (a, b) =>
                    Math.abs(b.valor || b.value || 0) -
                    Math.abs(a.valor || a.value || 0),
                );
              }
            } else {
              childrenMap.set(childChave, { ...child });
            }
          }
          existing.children = Array.from(childrenMap.values()).sort(
            (a, b) =>
              Math.abs(b.valor || b.value || 0) -
              Math.abs(a.valor || a.value || 0),
          );
        }
      } else {
        nodesMap.set(chave, { ...node });
      }
    }

    return Array.from(nodesMap.values()).sort(
      (a, b) =>
        Math.abs(b.valor || b.value || 0) - Math.abs(a.valor || a.value || 0),
    );
  }, []);

  // DRE Consolidado (soma dos dois períodos)
  const dreConsolidadoData = useMemo(() => {
    if (!dadosPeriodo2.vendasBrutas) {
      return [];
    }

    // Função auxiliar para somar objetos recursivamente
    const somarObjetos = (obj1, obj2) => {
      const resultado = {};
      for (const key in obj1) {
        if (
          typeof obj1[key] === 'object' &&
          !Array.isArray(obj1[key]) &&
          obj1[key] !== null
        ) {
          resultado[key] = somarObjetos(obj1[key], obj2[key] || {});
        } else {
          resultado[key] = (obj1[key] || 0) + (obj2[key] || 0);
        }
      }
      return resultado;
    };

    const dadosConsolidados = {
      vendasBrutas: vendasBrutas + dadosPeriodo2.vendasBrutas,
      devolucoes: devolucoes + dadosPeriodo2.devolucoes,
      descontos: descontos + dadosPeriodo2.descontos,
      totalDeducoes: totalDeducoes + dadosPeriodo2.totalDeducoes,
      cmv: cmv + dadosPeriodo2.cmv,
      receitaLiquida: receitaLiquida + dadosPeriodo2.receitaLiquida,
      lucroBruto: lucroBruto + dadosPeriodo2.lucroBruto,
      icms: icms + dadosPeriodo2.icms,
      pis: pis + dadosPeriodo2.pis,
      cofins: cofins + dadosPeriodo2.cofins,
      totalImpostos: totalImpostos + dadosPeriodo2.totalImpostos,
      planoDespesasTotal: planoDespesasTotal + dadosPeriodo2.planoDespesasTotal,
      planoDespesasFinanceirasTotal:
        planoDespesasFinanceirasTotal +
        dadosPeriodo2.planoDespesasFinanceirasTotal,
      totaisVarejo: somarObjetos(
        totaisVarejo,
        dadosPeriodo2.totaisVarejo || {},
      ),
      totaisMultimarcas: somarObjetos(
        totaisMultimarcas,
        dadosPeriodo2.totaisMultimarcas || {},
      ),
      totaisFranquias: somarObjetos(
        totaisFranquias,
        dadosPeriodo2.totaisFranquias || {},
      ),
      totaisRevenda: somarObjetos(
        totaisRevenda,
        dadosPeriodo2.totaisRevenda || {},
      ),
      impostosVarejo: somarObjetos(
        impostosVarejo,
        dadosPeriodo2.impostosVarejo || {},
      ),
      impostosMultimarcas: somarObjetos(
        impostosMultimarcas,
        dadosPeriodo2.impostosMultimarcas || {},
      ),
      impostosFranquias: somarObjetos(
        impostosFranquias,
        dadosPeriodo2.impostosFranquias || {},
      ),
      impostosRevenda: somarObjetos(
        impostosRevenda,
        dadosPeriodo2.impostosRevenda || {},
      ),
      receitaLiquidaVarejo:
        receitaLiquidaVarejo + (dadosPeriodo2.receitaLiquidaVarejo || 0),
      receitaLiquidaMultimarcas:
        receitaLiquidaMultimarcas +
        (dadosPeriodo2.receitaLiquidaMultimarcas || 0),
      receitaLiquidaFranquias:
        receitaLiquidaFranquias + (dadosPeriodo2.receitaLiquidaFranquias || 0),
      receitaLiquidaRevenda:
        receitaLiquidaRevenda + (dadosPeriodo2.receitaLiquidaRevenda || 0),
      cmvVarejo: cmvVarejo + (dadosPeriodo2.cmvVarejo || 0),
      cmvMultimarcas: cmvMultimarcas + (dadosPeriodo2.cmvMultimarcas || 0),
      cmvFranquias: cmvFranquias + (dadosPeriodo2.cmvFranquias || 0),
      cmvRevenda: cmvRevenda + (dadosPeriodo2.cmvRevenda || 0),
      lucroBrutoVarejo:
        lucroBrutoVarejo + (dadosPeriodo2.lucroBrutoVarejo || 0),
      lucroBrutoMultimarcas:
        lucroBrutoMultimarcas + (dadosPeriodo2.lucroBrutoMultimarcas || 0),
      lucroBrutoFranquias:
        lucroBrutoFranquias + (dadosPeriodo2.lucroBrutoFranquias || 0),
      lucroBrutoRevenda:
        lucroBrutoRevenda + (dadosPeriodo2.lucroBrutoRevenda || 0),
    };

    // Mesclar nodes de despesas
    const nodesOpConsolidados = mesclarNodes(
      planoDespesasNodes,
      planoDespesasNodesPeriodo2,
    );
    const nodesFinConsolidados = mesclarNodes(
      planoDespesasFinanceirasNodes,
      planoDespesasFinanceirasNodesPeriodo2,
    );

    return gerarEstruturaDRE(
      dadosConsolidados,
      nodesOpConsolidados,
      nodesFinConsolidados,
    );
  }, [
    tipoAnalise,
    vendasBrutas,
    devolucoes,
    descontos,
    totalDeducoes,
    cmv,
    receitaLiquida,
    lucroBruto,
    icms,
    pis,
    cofins,
    totalImpostos,
    planoDespesasTotal,
    planoDespesasFinanceirasTotal,
    totaisVarejo,
    totaisMultimarcas,
    totaisFranquias,
    totaisRevenda,
    impostosVarejo,
    impostosMultimarcas,
    impostosFranquias,
    impostosRevenda,
    receitaLiquidaVarejo,
    receitaLiquidaMultimarcas,
    receitaLiquidaFranquias,
    receitaLiquidaRevenda,
    cmvVarejo,
    cmvMultimarcas,
    cmvFranquias,
    cmvRevenda,
    lucroBrutoVarejo,
    lucroBrutoMultimarcas,
    lucroBrutoFranquias,
    lucroBrutoRevenda,
    dadosPeriodo2,
    gerarEstruturaDRE,
    mesclarNodes,
    planoDespesasNodes,
    planoDespesasNodesPeriodo2,
    planoDespesasFinanceirasNodes,
    planoDespesasFinanceirasNodesPeriodo2,
  ]);

  // 🆕 Gerar estruturas DRE para todos os períodos dinamicamente
  const dreDataTodosPeriodos = useMemo(() => {
    if (!dadosPeriodos || dadosPeriodos.length === 0) {
      return [];
    }

    console.log(
      `🎨 Gerando estruturas DRE para ${dadosPeriodos.length} período(s)...`,
    );

    return dadosPeriodos.map((dados, index) => {
      const estrutura = gerarEstruturaDRE(
        {
          vendasBrutas: dados.vendasBrutas,
          devolucoes: dados.devolucoes,
          descontos: dados.descontos,
          totalDeducoes: dados.totalDeducoes,
          cmv: dados.cmv,
          receitaLiquida: dados.receitaLiquida,
          lucroBruto: dados.lucroBruto,
          icms: dados.icms,
          pis: dados.pis,
          cofins: dados.cofins,
          totalImpostos: dados.totalImpostos,
          planoDespesasTotal: dados.planoDespesasTotal,
          planoDespesasFinanceirasTotal: dados.planoDespesasFinanceirasTotal,
          totaisVarejo: dados.totaisVarejo,
          totaisMultimarcas: dados.totaisMultimarcas,
          totaisFranquias: dados.totaisFranquias,
          totaisRevenda: dados.totaisRevenda,
          impostosVarejo: dados.impostosVarejo,
          impostosMultimarcas: dados.impostosMultimarcas,
          impostosFranquias: dados.impostosFranquias,
          impostosRevenda: dados.impostosRevenda,
          receitaLiquidaVarejo: dados.receitaLiquidaVarejo,
          receitaLiquidaMultimarcas: dados.receitaLiquidaMultimarcas,
          receitaLiquidaFranquias: dados.receitaLiquidaFranquias,
          receitaLiquidaRevenda: dados.receitaLiquidaRevenda,
          cmvVarejo: dados.cmvVarejo,
          cmvMultimarcas: dados.cmvMultimarcas,
          cmvFranquias: dados.cmvFranquias,
          cmvRevenda: dados.cmvRevenda,
          lucroBrutoVarejo: dados.lucroBrutoVarejo,
          lucroBrutoMultimarcas: dados.lucroBrutoMultimarcas,
          lucroBrutoFranquias: dados.lucroBrutoFranquias,
          lucroBrutoRevenda: dados.lucroBrutoRevenda,
        },
        dados.planoDespesasNodes || [],
        dados.planoDespesasFinanceirasNodes || [],
      );

      return {
        periodoId: dados.periodoId,
        periodo: dados.periodo,
        estrutura: estrutura,
      };
    });
  }, [dadosPeriodos, gerarEstruturaDRE]);

  const toggleNode = (nodeId) => {
    setExpandedNodes((prev) => ({
      ...prev,
      [nodeId]: !prev[nodeId],
    }));
  };

  // Funções de controle de expansão no estilo Contas a Pagar
  const toggleCategoria = (categoriaNome) => {
    console.log('🔄 TOGGLE CATEGORIA:', {
      categoria: categoriaNome,
      jaExpandida: categoriasExpandidas.has(categoriaNome),
      acao: categoriasExpandidas.has(categoriaNome) ? 'FECHAR' : 'ABRIR',
    });

    const novaSet = new Set(categoriasExpandidas);
    if (novaSet.has(categoriaNome)) {
      novaSet.delete(categoriaNome);
    } else {
      novaSet.add(categoriaNome);
    }

    console.log('✅ NOVO STATE:', Array.from(novaSet));
    setCategoriasExpandidas(novaSet);
  };

  const toggleTodosTopicos = () => {
    if (todosExpandidos) {
      setCategoriasExpandidas(new Set());
    } else {
      const todasCategorias = new Set();
      // Seções de resultado que não devem ser expansíveis
      const resultadoSections = [
        'Receitas Brutas',
        'Receita Líquida de Vendas',
        'Lucro Bruto',
        'Resultado Operacional',
        'Lucro Antes do IR/CSLL',
        'Lucro Líquido do Exercício',
      ];

      // Função auxiliar para adicionar categorias com prefixo de coluna
      const adicionarCategorias = (dados, prefixo = 'main') => {
        dados.forEach((item) => {
          // Só adiciona se não for uma seção de resultado
          if (!resultadoSections.includes(item.label)) {
            todasCategorias.add(`${prefixo}|${item.label}`);
            if (item.children) {
              item.children.forEach((child) => {
                // Adiciona o subitem como chave composta
                todasCategorias.add(`${prefixo}|${item.label}|${child.label}`);
                // Se o subitem tem children, adiciona eles também
                if (child.children) {
                  child.children.forEach((grandchild) => {
                    todasCategorias.add(
                      `${prefixo}|${item.label}|${child.label}|${grandchild.label}`,
                    );
                  });
                }
              });
            }
          }
        });
      };

      // Adicionar categorias de todas as colunas
      if (tipoAnalise === 'horizontal') {
        adicionarCategorias(dreData, `📅 ${obterNomeMes(filtroMensal)}`);
        if (drePeriodo2Data.length > 0) {
          adicionarCategorias(
            drePeriodo2Data,
            `📅 ${obterNomeMes(filtroMensalComparacao)}`,
          );
        }
        if (dreConsolidadoData.length > 0) {
          adicionarCategorias(dreConsolidadoData, '📊 Consolidado');
        }
      } else {
        adicionarCategorias(dreData, 'main');
      }

      setCategoriasExpandidas(todasCategorias);
    }
    setTodosExpandidos(!todosExpandidos);
  };

  const getValueColor = (value, type) => {
    if (type === 'resultado-final') {
      return value >= 0 ? 'text-green-600' : 'text-red-600';
    }
    if (type === 'resultado') {
      return value >= 0 ? 'text-[]' : 'text-red-600';
    }
    return value < 0 ? 'text-red-500' : 'text-green-600';
  };

  // Função para gerar lista de meses
  const gerarMeses = () => {
    const meses = [
      { value: '01', label: 'Jan' },
      { value: '02', label: 'Fev' },
      { value: '03', label: 'Mar' },
      { value: '04', label: 'Abr' },
      { value: '05', label: 'Mai' },
      { value: '06', label: 'Jun' },
      { value: '07', label: 'Jul' },
      { value: '08', label: 'Ago' },
      { value: '09', label: 'Set' },
      { value: '10', label: 'Out' },
      { value: '11', label: 'Nov' },
      { value: '12', label: 'Dez' },
    ];
    return meses;
  };

  // Função auxiliar para extrair porcentagem do label
  const extrairPorcentagemDoLabel = (label) => {
    const match = label.match(/(\d+\.?\d*)%$/);
    return match ? match[1] : '';
  };

  // Função auxiliar para renderizar valor com porcentagem
  // Função auxiliar para determinar se deve inverter cores baseado no tipo de item
  const deveInverterCores = (item, parentItem = null) => {
    // Lista de IDs que devem ter cores invertidas (maior = verde, menor = vermelho)
    const idsComCoresInvertidas = [
      'vendas-bruta', // Receitas Brutas
      'receita-liquida', // Receita Líquida de Vendas
      'lucro-bruto', // Lucro Bruto
    ];

    // Verificar se o item atual está na lista
    if (item && idsComCoresInvertidas.includes(item.id)) {
      return true;
    }

    // Verificar se o pai está na lista (para filhos herdarem a regra)
    if (parentItem && idsComCoresInvertidas.includes(parentItem.id)) {
      return true;
    }

    // Para CMV e Deduções, não inverter (menor = verde, maior = vermelho)
    return false;
  };

  // Função auxiliar para determinar a cor do badge baseado na hierarquia
  const obterCorPorHierarquia = (
    porcentagemNum,
    siblings = [],
    inverterCores = false,
  ) => {
    // Se não houver irmãos para comparar, usar cor neutra
    if (!siblings || siblings.length === 0) {
      return 'bg-blue-100 text-blue-700 border-blue-200';
    }

    // Extrair todas as porcentagens dos irmãos (incluindo o item atual)
    const porcentagens = siblings
      .map((sibling) => {
        const pct =
          sibling.porcentagem !== undefined && sibling.porcentagem !== null
            ? parseFloat(sibling.porcentagem)
            : null;
        return pct;
      })
      .filter((p) => p !== null && !isNaN(p))
      .sort((a, b) => b - a); // Ordenar do maior para o menor

    // Se houver menos de 2 itens, usar cor neutra
    if (porcentagens.length < 2) {
      return 'bg-blue-100 text-blue-700 border-blue-200';
    }

    // Encontrar a posição do item atual
    const posicao = porcentagens.indexOf(porcentagemNum);

    if (posicao === -1) {
      return 'bg-gray-100 text-gray-700 border-gray-200';
    }

    // Definir cores baseado na hierarquia
    const totalItens = porcentagens.length;
    let corMaior, corSegundo, corPenultimo, corMenor;

    if (inverterCores) {
      // Para RECEITAS e LUCROS: Maior é melhor
      // VERDE (maior) → AZUL (segundo) → AMARELO (penúltimo) → VERMELHO (menor)
      corMaior = 'bg-green-100 text-green-700 border-green-200';
      corSegundo = 'bg-blue-100 text-blue-700 border-blue-200';
      corPenultimo = 'bg-yellow-100 text-yellow-700 border-yellow-200';
      corMenor = 'bg-red-100 text-red-700 border-red-200';
    } else {
      // Para CUSTOS e DEDUÇÕES: Menor é melhor
      // VERMELHO (maior) → AMARELO (segundo) → AZUL (penúltimo) → VERDE (menor)
      corMaior = 'bg-red-100 text-red-700 border-red-200';
      corSegundo = 'bg-yellow-100 text-yellow-700 border-yellow-200';
      corPenultimo = 'bg-blue-100 text-blue-700 border-blue-200';
      corMenor = 'bg-green-100 text-green-700 border-green-200';
    }

    if (totalItens === 2) {
      // Se houver apenas 2 itens: maior e menor
      return posicao === 0 ? corMaior : corMenor;
    } else if (totalItens === 3) {
      // Se houver 3 itens: maior, médio, menor
      if (posicao === 0) return corMaior;
      if (posicao === 1) return corSegundo; // Usa cor do segundo como médio
      return corMenor;
    } else {
      // Se houver 4+ itens: maior, segundo, penúltimo, menor
      if (posicao === 0) {
        // Maior
        return corMaior;
      } else if (posicao === totalItens - 1) {
        // Menor
        return corMenor;
      } else if (posicao === 1 || posicao <= Math.floor(totalItens * 0.33)) {
        // Segundo maior ou terço superior
        return corSegundo;
      } else {
        // Entre o médio e o menor (penúltimo)
        return corPenultimo;
      }
    }
  };

  const renderizarValorComPorcentagem = (
    value,
    item,
    mostrarPorcentagem = true,
    siblings = [],
    inverterCores = false,
  ) => {
    const porcentagem =
      item.porcentagem !== undefined && item.porcentagem !== null
        ? item.porcentagem
        : extrairPorcentagemDoLabel(item.label);

    // 🔍 DEBUG: Rastreamento de DESCONTOS CONCEDIDOS
    if (item.label && item.label.toLowerCase().includes('desconto')) {
      console.log('🔍 DEBUG DESCONTOS CONCEDIDOS:', {
        label: item.label,
        id: item.id,
        valueOriginal: value,
        valueType: typeof value,
        isNegative: value < 0,
        isPositive: value > 0,
        isZero: value === 0,
        item: item,
      });
    }

    // Só mostra porcentagem se mostrarPorcentagem for true E porcentagem existir
    if (
      mostrarPorcentagem &&
      porcentagem !== '' &&
      porcentagem !== undefined &&
      porcentagem !== null
    ) {
      const porcentagemNum = parseFloat(porcentagem);
      const badgeColor = obterCorPorHierarquia(
        porcentagemNum,
        siblings,
        inverterCores,
      );

      // Determinar cor do texto baseado no valor
      // Valores negativos (deduções, custos, despesas) = Vermelho
      // Valores positivos (receitas, lucros) = Verde
      const valorCorTexto = value < 0 ? 'text-red-600' : 'text-green-600';

      // 🔍 DEBUG: Verificar cor aplicada aos descontos
      if (item.label && item.label.toLowerCase().includes('desconto')) {
        console.log('🎨 COR APLICADA AO DESCONTO:', {
          label: item.label,
          value: value,
          corEscolhida: valorCorTexto,
          condicao:
            value < 0
              ? 'NEGATIVO (deveria ser vermelho)'
              : 'POSITIVO (deveria ser verde)',
        });
      }

      return (
        <div className="flex items-center gap-2.5">
          <span className={`font-semibold ${valorCorTexto}`}>
            {formatCurrency(Math.abs(value))}
          </span>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${badgeColor}`}
          >
            {porcentagem}%
          </span>
        </div>
      );
    }

    // Determinar cor do texto baseado no valor (sem porcentagem)
    const valorCorTexto = value < 0 ? 'text-red-600' : 'text-green-600';

    // 🔍 DEBUG: Verificar cor sem porcentagem
    if (item.label && item.label.toLowerCase().includes('desconto')) {
      console.log('🎨 COR SEM PORCENTAGEM - DESCONTO:', {
        label: item.label,
        value: value,
        corEscolhida: valorCorTexto,
      });
    }

    return (
      <span className={`font-semibold ${valorCorTexto}`}>
        {formatCurrency(Math.abs(value))}
      </span>
    );
  };

  // Função auxiliar para renderizar badge de variação (análise horizontal)
  const renderizarBadgeVariacao = (item, dadosPeriodo1, dadosPeriodo2) => {
    if (!dadosPeriodo1 || !dadosPeriodo2) return null;

    // Mapear IDs para buscar valores correspondentes
    const getValorPorId = (dados, id) => {
      const mapeamento = {
        'vendas-bruta': dados.vendasBrutas,
        'deducoes-vendas': -(
          dados.devolucoes +
          dados.descontos +
          dados.totalImpostos
        ),
        'receita-liquida': dados.receitaLiquida,
        cmv: dados.cmv,
        'lucro-bruto': dados.lucroBruto,
        'despesas-operacionais': dados.planoDespesasTotal,
        'resultado-operacional': dados.lucroBruto - dados.planoDespesasTotal,
        'despesas-financeiras': dados.planoDespesasFinanceirasTotal,
        'lucro-antes-impostos':
          dados.lucroBruto -
          dados.planoDespesasTotal -
          dados.planoDespesasFinanceirasTotal,
        'impostos-lucro': 0,
        'lucro-liquido':
          dados.lucroBruto -
          dados.planoDespesasTotal -
          dados.planoDespesasFinanceirasTotal,
      };
      return mapeamento[id] || null;
    };

    const valorPeriodo1 = getValorPorId(dadosPeriodo1, item.id);
    const valorPeriodo2 = getValorPorId(dadosPeriodo2, item.id);

    if (valorPeriodo1 === null || valorPeriodo2 === null) return null;

    const { percentual, tipo } = calcularVariacao(valorPeriodo2, valorPeriodo1);

    if (tipo === 'neutro') return null;

    // Definir cor e ícone baseado no tipo de variação
    const badgeClasses =
      tipo === 'aumento'
        ? 'bg-green-100 text-green-700 border-green-200'
        : 'bg-red-100 text-red-700 border-red-200';

    const simbolo = tipo === 'aumento' ? '↑' : '↓';

    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border ${badgeClasses} ml-2`}
      >
        <span>{simbolo}</span>
        <span>{percentual}%</span>
      </span>
    );
  };

  // Função auxiliar para renderizar uma tree view DRE
  const renderDRETreeView = useCallback(
    (
      dreDataToRender,
      tituloColuna = null,
      mostrarPorcentagem = true,
      mostrarVariacao = false,
      periodo1Dados = null,
      periodo2Dados = null,
    ) => {
      if (!dreDataToRender || dreDataToRender.length === 0) return null;

      console.log('🎨 RENDERIZANDO COLUNA:', {
        coluna: tituloColuna || 'main',
        qtdModulos: dreDataToRender.length,
      });

      return (
        <div className="space-y-2 flex items-center flex-col w-full max-w-md px-2">
          {tituloColuna && (
            <div className="bg-[#000638] to-indigo-600 text-white px-3 py-2 rounded-lg w-full text-center mb-2">
              <h3 className="text-xs font-bold">{tituloColuna}</h3>
            </div>
          )}

          {/* Módulos da DRE */}
          {dreDataToRender.map((modulo, moduloIndex) => {
            const chaveModulo = `${tituloColuna || 'main'}|${modulo.label}`;
            const isModuloExpanded = categoriasExpandidas.has(chaveModulo);
            const resultadoSections = [];
            const isResultadoSection = resultadoSections.includes(modulo.label);

            // 🔍 DEBUG: Log para despesas operacionais
            if (modulo.label === 'Despesas Operacionais') {
              console.log('🔍 DEBUG DESPESAS OPERACIONAIS:', {
                coluna: tituloColuna || 'main',
                chaveModulo: chaveModulo,
                isExpanded: isModuloExpanded,
                hasChildren: !!modulo.children,
                qtdChildren: modulo.children?.length || 0,
                primeirosChildren: modulo.children
                  ?.slice(0, 3)
                  .map((c) => c.label),
                categoriasExpandidas: Array.from(categoriasExpandidas),
              });
            }

            return (
              <div
                key={`modulo-${moduloIndex}-${modulo.id}-${
                  tituloColuna || 'main'
                }`}
                className={`w-full ${
                  isResultadoSection
                    ? 'bg-blue-50 rounded-lg'
                    : 'border border-gray-200 rounded-lg overflow-hidden'
                }`}
              >
                {/* Cabeçalho do módulo principal */}
                <div
                  className={`${
                    isResultadoSection
                      ? 'bg-blue-50 cursor-default'
                      : 'bg-gray-50 hover:bg-gray-100 cursor-pointer'
                  } transition-colors px-2 py-1.5 flex items-center justify-between`}
                  onClick={
                    isResultadoSection
                      ? undefined
                      : () => {
                          console.log('🖱️ CLIQUE NO MÓDULO:', {
                            modulo: modulo.label,
                            coluna: tituloColuna || 'main',
                            chaveModulo: chaveModulo,
                          });
                          toggleCategoria(chaveModulo);
                        }
                  }
                >
                  <div className="flex items-center space-x-2">
                    {!isResultadoSection &&
                      (isModuloExpanded ? (
                        <CaretDown size={10} className="text-gray-600" />
                      ) : (
                        <CaretRight size={10} className="text-gray-600" />
                      ))}
                    <div>
                      <h3 className="font-medium text-xs text-gray-800">
                        {modulo.label}
                      </h3>
                      <div className="flex gap-96 items-center justify-between space-x-32 text-xs text-gray-600">
                        {renderizarValorComPorcentagem(
                          modulo.value,
                          modulo,
                          mostrarPorcentagem,
                          dreDataToRender,
                          deveInverterCores(modulo),
                        )}
                        {mostrarVariacao &&
                          renderizarBadgeVariacao(
                            modulo,
                            periodo1Dados,
                            periodo2Dados,
                          )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Sub-itens do módulo */}
                {isModuloExpanded &&
                  (() => {
                    console.log('👀 VERIFICANDO CHILDREN DO MÓDULO:', {
                      modulo: modulo.label,
                      coluna: tituloColuna || 'main',
                      isExpanded: isModuloExpanded,
                      hasChildren: !!modulo.children,
                      qtdChildren: modulo.children?.length || 0,
                      children: modulo.children
                        ?.map((c) => c.label)
                        .slice(0, 5),
                    });
                    return true;
                  })() &&
                  modulo.children &&
                  modulo.children.length > 0 && (
                    <div className="bg-white border-t border-gray-100">
                      {modulo.children.map((subitem, subitemIndex) => {
                        const chaveSubitem = `${tituloColuna || 'main'}|${
                          modulo.label
                        }|${subitem.label}`;
                        const isSubitemExpanded =
                          categoriasExpandidas.has(chaveSubitem);
                        const hasSubitemChildren =
                          subitem.children && subitem.children.length > 0;

                        return (
                          <div
                            key={`subitem-${moduloIndex}-${subitemIndex}-${
                              subitem.id
                            }-${tituloColuna || 'main'}`}
                            className="border-b border-gray-100 last:border-b-0"
                          >
                            {/* Cabeçalho do sub-item */}
                            <div
                              className={`bg-gray-25 hover:bg-gray-50 transition-colors px-4 py-1.5 flex items-center justify-between ${
                                hasSubitemChildren
                                  ? 'cursor-pointer'
                                  : 'cursor-default'
                              }`}
                              onClick={
                                hasSubitemChildren
                                  ? () => toggleCategoria(chaveSubitem)
                                  : undefined
                              }
                            >
                              <div className="flex items-center space-x-2">
                                {hasSubitemChildren &&
                                  (isSubitemExpanded ? (
                                    <CaretDown
                                      size={10}
                                      className="text-gray-500"
                                    />
                                  ) : (
                                    <CaretRight
                                      size={10}
                                      className="text-gray-500"
                                    />
                                  ))}
                                <div>
                                  <h4 className="font-medium text-xs text-gray-700">
                                    {subitem.label}
                                  </h4>
                                  <div className="flex items-center space-x-3 text-xs text-gray-500">
                                    {renderizarValorComPorcentagem(
                                      subitem.value,
                                      subitem,
                                      mostrarPorcentagem,
                                      modulo.children,
                                      deveInverterCores(subitem, modulo),
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Sub-sub-itens (3º nível) */}
                            {isSubitemExpanded &&
                              subitem.children &&
                              subitem.children.length > 0 && (
                                <div className="bg-white border-t border-gray-50">
                                  {subitem.children.map(
                                    (subsubitem, subsubitemIndex) => {
                                      const chaveSubsubitem = `${
                                        tituloColuna || 'main'
                                      }|${modulo.label}|${subitem.label}|${
                                        subsubitem.label
                                      }`;
                                      const isSubsubitemExpanded =
                                        categoriasExpandidas.has(
                                          chaveSubsubitem,
                                        );
                                      const hasSubsubitemChildren =
                                        subsubitem.children &&
                                        subsubitem.children.length > 0;

                                      return (
                                        <div
                                          key={`subsubitem-${moduloIndex}-${subitemIndex}-${subsubitemIndex}-${
                                            subsubitem.id
                                          }-${tituloColuna || 'main'}`}
                                          className="border-b border-gray-50 last:border-b-0"
                                        >
                                          <div
                                            className={`bg-gray-25 hover:bg-gray-50 transition-colors px-6 py-1.5 flex items-center justify-between ${
                                              hasSubsubitemChildren
                                                ? 'cursor-pointer'
                                                : 'cursor-default'
                                            }`}
                                            onClick={
                                              hasSubsubitemChildren
                                                ? () =>
                                                    toggleCategoria(
                                                      chaveSubsubitem,
                                                    )
                                                : undefined
                                            }
                                          >
                                            <div className="flex items-center space-x-2">
                                              {hasSubsubitemChildren &&
                                                (isSubsubitemExpanded ? (
                                                  <CaretDown
                                                    size={10}
                                                    className="text-gray-400"
                                                  />
                                                ) : (
                                                  <CaretRight
                                                    size={10}
                                                    className="text-gray-400"
                                                  />
                                                ))}
                                              <div>
                                                <h5
                                                  className={` font-medium text-xs ${
                                                    subsubitem._isDespesaManual
                                                      ? 'text-blue-700'
                                                      : 'text-gray-600'
                                                  }`}
                                                >
                                                  {subsubitem._isDespesaManual &&
                                                    '✏️ '}
                                                  {subsubitem.label}
                                                </h5>
                                                <div className="flex items-center space-x-3 text-xs text-gray-400">
                                                  {subsubitem.description && (
                                                    <span
                                                      className={
                                                        subsubitem._isDespesaManual
                                                          ? 'text-blue-500 font-medium'
                                                          : 'text-gray-400'
                                                      }
                                                    >
                                                      {subsubitem.description}
                                                    </span>
                                                  )}
                                                  {renderizarValorComPorcentagem(
                                                    subsubitem.value,
                                                    subsubitem,
                                                    mostrarPorcentagem,
                                                    subitem.children,
                                                    deveInverterCores(
                                                      subsubitem,
                                                      subitem,
                                                    ),
                                                  )}
                                                </div>
                                              </div>
                                            </div>
                                          </div>

                                          {/* Sub-sub-sub-itens (4º nível - se existirem) */}
                                          {isSubsubitemExpanded &&
                                            subsubitem.children &&
                                            subsubitem.children.length > 0 && (
                                              <div className="bg-white border-t border-gray-50">
                                                {subsubitem.children.map(
                                                  (
                                                    subsubsubitem,
                                                    subsubsubitemIndex,
                                                  ) => (
                                                    <div
                                                      key={`subsubsubitem-${moduloIndex}-${subitemIndex}-${subsubitemIndex}-${subsubsubitemIndex}-${
                                                        subsubsubitem.id
                                                      }-${
                                                        tituloColuna || 'main'
                                                      }`}
                                                      className="border-b border-gray-50 last:border-b-0 cursor-pointer"
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        console.log(
                                                          '🔍 Despesa clicada:',
                                                          subsubsubitem,
                                                        );
                                                        setDespesaSelecionada(
                                                          subsubsubitem,
                                                        );
                                                        setModalDespManual(
                                                          true,
                                                        );
                                                      }}
                                                    >
                                                      <div className="bg-gray-25 hover:bg-gray-100 cursor-pointer transition-colors px-8 py-1.5 flex items-center justify-between">
                                                        <div className="flex items-center space-x-2">
                                                          {/* Indicador de observação */}
                                                          {subsubsubitem._temObservacao && (
                                                            <div
                                                              className="w-2 h-2 bg-red-500 rounded-full flex-shrink-0"
                                                              title="Tem observação"
                                                            />
                                                          )}
                                                          <div>
                                                            <h6 className="font-medium text-xs text-gray-500">
                                                              {
                                                                subsubsubitem.label
                                                              }
                                                            </h6>
                                                            <div className="flex items-center space-x-3 text-xs text-gray-300">
                                                              {subsubsubitem.description && (
                                                                <span className="text-gray-400">
                                                                  {
                                                                    subsubsubitem.description
                                                                  }
                                                                </span>
                                                              )}
                                                              <span
                                                                className={`font-medium ${
                                                                  subsubsubitem.value >=
                                                                  0
                                                                    ? 'text-green-300'
                                                                    : 'text-red-300'
                                                                }`}
                                                              >
                                                                {formatCurrency(
                                                                  Math.abs(
                                                                    subsubsubitem.value,
                                                                  ),
                                                                )}
                                                              </span>
                                                            </div>
                                                          </div>
                                                        </div>
                                                      </div>
                                                    </div>
                                                  ),
                                                )}
                                              </div>
                                            )}
                                        </div>
                                      );
                                    },
                                  )}
                                </div>
                              )}
                          </div>
                        );
                      })}
                    </div>
                  )}
              </div>
            );
          })}
        </div>
      );
    },
    [
      categoriasExpandidas,
      toggleCategoria,
      formatCurrency,
      renderizarValorComPorcentagem,
      renderizarBadgeVariacao,
      deveInverterCores,
      obterCorPorHierarquia,
      calcularPorcentagem,
      calcularVariacao,
    ],
  );

  const getIcon = (type, value) => {
    if (type === 'resultado-final') {
      return value >= 0 ? (
        <TrendUp className="w-2 h-2" />
      ) : (
        <TrendDown className="w-2 h-2" />
      );
    }
    if (type === 'resultado') {
      return value >= 0 ? (
        <Dot className="w-2 h-2" />
      ) : (
        <Dot className="w-2 h-2" />
      );
    }
    if (value < 0) {
      return <Dot className="w-2 h-2" />;
    }
    return <Dot className="w-2 h-2" />;
  };

  const getFolderIcon = (type) => {
    switch (type) {
      case 'receita':
        return <CurrencyDollar className="w-4 h-4 text-green-600" />;
      case 'deducao':
        return <Dot className="w-4 h-4 text-red-500" />;
      case 'custo':
        return <Dot className="w-4 h-4 text-orange-500" />;
      case 'despesa':
        return <Dot className="w-4 h-4 text-red-600" />;
      case 'imposto':
        return <Dot className="w-4 h-4 text-purple-600" />;
      case 'resultado':
        return <Dot className="w-4 h-4 text-[]" />;
      case 'resultado-final':
        return <TrendUp className="w-4 h-4 text-green-600" />;
      default:
        return <FileText className="w-4 h-4 text-gray-500" />;
    }
  };

  const renderTreeItem = (
    item,
    level = 0,
    isLastInSection = false,
    isEven = true,
  ) => {
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expandedNodes[item.id];
    const isLeaf = !hasChildren;

    if (isLeaf) {
      return (
        <div
          key={item.id}
          className="ms-3 ps-3 relative before:absolute before:top-0 before:start-0 before:w-0.5 before:-ms-px before:h-full before:bg-gray-100"
        >
          <div
            className={`hs-accordion-selectable hs-accordion-selected:bg-gray-100 px-2 rounded-md cursor-pointer hover:bg-gray-100/50 transition-colors ${
              isEven ? 'bg-gray-50/30' : 'bg-white'
            }`}
            role="treeitem"
          >
            <div className="flex items-center gap-x-3 py-1">
              {getFolderIcon(item.type)}
              <div className="grow flex items-center justify-between">
                <div>
                  <span className="text-sm text-gray-800 font-medium">
                    {item.label}
                  </span>
                  <p className="text-xs text-gray-600 mt-0.5">
                    {item.description}
                  </p>
                </div>
                <span
                  className={`text-sm font-semibold ${getValueColor(
                    item.value,
                    item.type,
                  )}`}
                >
                  {formatCurrency(item.value)}
                </span>
              </div>
            </div>
          </div>
          {/* Divider after leaf items */}
          {isLastInSection && (
            <div className="border-b border-gray-200 my-2"></div>
          )}
        </div>
      );
    }

    return (
      <div
        key={item.id}
        className={`hs-accordion ${isExpanded ? 'active' : ''}`}
        role="treeitem"
        aria-expanded={isExpanded}
      >
        {/* Accordion Heading */}
        <div className="hs-accordion-heading py-0.5 flex items-center gap-x-0.5 w-full">
          <button
            className="hs-accordion-toggle size-6 flex justify-center items-center hover:bg-gray-100 rounded-md focus:outline-hidden focus:bg-gray-100 disabled:opacity-50 disabled:pointer-events-none"
            aria-expanded={isExpanded}
            aria-controls={`dre-${item.id}`}
            onClick={() => toggleNode(item.id)}
          >
            <svg
              className="size-4 text-gray-800"
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14"></path>
              <path
                className={isExpanded ? 'hidden' : 'block'}
                d="M12 5v14"
              ></path>
            </svg>
          </button>

          <div
            className={`grow hs-accordion-selectable hs-accordion-selected:bg-gray-100 px-1.5 rounded-md cursor-pointer hover:bg-gray-100/40 transition-colors ${
              isEven ? 'bg-gray-50/20' : 'bg-white'
            }`}
          >
            <div className="flex items-center gap-x-3">
              {getFolderIcon(item.type)}
              <div className="grow flex items-center justify-between">
                <div>
                  <span className="text-sm text-gray-800 font-medium">
                    {item.label}
                  </span>
                  <p className="text-xs text-gray-600 mt-0.5">
                    {item.description}
                  </p>
                </div>
                <span
                  className={`text-sm font-semibold ${getValueColor(
                    item.value,
                    item.type,
                  )}`}
                >
                  {formatCurrency(item.value)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Accordion Content */}
        <div
          id={`dre-${item.id}`}
          className={`hs-accordion-content w-full overflow-hidden transition-[height] duration-300 ${
            isExpanded ? '' : 'hidden'
          }`}
          role="group"
          aria-labelledby={`dre-${item.id}`}
        >
          <div className="hs-accordion-group ps-7 relative before:absolute before:top-0 before:start-3 before:w-0.5 before:-ms-px before:h-full before:bg-gray-100">
            {item.children.map((child, index) =>
              renderTreeItem(
                child,
                level + 1,
                index === item.children.length - 1,
                (index + 1) % 2 === 0,
              ),
            )}
          </div>
          {/* Divider after accordion items */}
          {isLastInSection && (
            <div className="border-b border-gray-200 my-2"></div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="p-6">
      <PageTitle
        title="DRE - Demonstrativo de Resultado do Exercício"
        subtitle="Análise detalhada dos resultados financeiros do período"
        icon={TrendUp}
      />

      {/* Novo Componente de Calendário */}
      <div className="">
        <CalendarioPeriodosDRE
          onPeriodosChange={(novosPeriodos) => {
            console.log('📅 Períodos selecionados:', novosPeriodos);
            setPeriodos(novosPeriodos);
          }}
          periodosIniciais={periodos}
        />
        {/* Seletor de Tipo de Análise */}
        <div className="bg-white p-4 mb-4 border-b-2 border-l-2 border-r-2 border-gray-200 ">
          <label className="block text-sm font-semibold mb-3 text-gray-800">
            Tipo de Análise
          </label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="tipoAnalise"
                value="vertical"
                checked={tipoAnalise === 'vertical'}
                onChange={(e) => setTipoAnalise(e.target.value)}
                className="w-4 h-4 text-[#000638]"
              />
              <span className="text-sm font-medium">Análise Vertical</span>
              <span className="text-xs text-gray-500">
                (Mostra % de cada item)
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="tipoAnalise"
                value="horizontal"
                checked={tipoAnalise === 'horizontal'}
                onChange={(e) => setTipoAnalise(e.target.value)}
                className="w-4 h-4 text-[#000638]"
              />
              <span className="text-sm font-medium">Análise Horizontal</span>
              <span className="text-xs text-gray-500">
                (Mostra variação entre períodos)
              </span>
            </label>
          </div>
        </div>
      </div>

      {/* Botões de ação */}
      <div className="flex items-center justify-center gap-4 mb-4">
        <button
          className="bg-[#000638] text-white text-sm px-8 py-3 rounded-lg hover:bg-[#000856] transition-colors font-semibold shadow-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={buscarVendasBrutas}
          disabled={loading || periodos.length === 0}
        >
          <>
            <span>🔍</span>
            <span>Buscar Dados</span>
          </>
        </button>

        <button
          className="bg-blue-600 text-white text-sm px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors font-semibold shadow-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={() => setModalDespesaManualAberto(true)}
          disabled={loading || periodos.length === 0}
          title="Adicionar despesa manual ao DRE"
        >
          <Plus size={20} weight="bold" />
          <span>Adicionar Despesa Manual</span>
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Tree View */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            Demonstrativo de Resultado do Exercício
          </h2>
        </div>

        {/* Card de Comparação para Análise Horizontal */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <LoadingSpinner
              size="lg"
              text={loadingStatus || 'Carregando dados do DRE...'}
            />
            {loadingStatus && (
              <div className="mt-4 w-full max-w-md">
                <div className="bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-[] h-2 rounded-full transition-all duration-300"
                    style={{
                      width: loadingStatus.includes('Varejo')
                        ? '20%'
                        : loadingStatus.includes('Multimarcas')
                          ? '40%'
                          : loadingStatus.includes('Franquia')
                            ? '60%'
                            : loadingStatus.includes('Revenda')
                              ? '80%'
                              : loadingStatus.includes('impostos')
                                ? '95%'
                                : loadingStatus.includes('Processando')
                                  ? '100%'
                                  : '0%',
                    }}
                  ></div>
                </div>
                <div className="text-center mt-2 text-sm text-gray-600">
                  {loadingStatus.includes('Varejo') && '1/5 - Varejo'}
                  {loadingStatus.includes('Multimarcas') && '2/5 - Multimarcas'}
                  {loadingStatus.includes('Franquia') && '3/5 - Franquia'}
                  {loadingStatus.includes('Revenda') && '4/5 - Revenda'}
                  {loadingStatus.includes('impostos') && '5/5 - Impostos'}
                  {loadingStatus.includes('Processando') && 'Finalizando...'}
                </div>
              </div>
            )}
          </div>
        ) : vendasBrutas > 0 ? (
          <>
            {/* Botões de ação */}
            <div className="flex justify-center items-center px-4 py-2">
              <button
                onClick={toggleTodosTopicos}
                className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded transition-colors flex items-center gap-1"
                title={
                  todosExpandidos
                    ? 'Colapsar todos os tópicos'
                    : 'Expandir todos os tópicos'
                }
              >
                {todosExpandidos ? (
                  <>
                    <span>−</span>
                    <span>Colapsar tudo</span>
                  </>
                ) : (
                  <>
                    <span>+</span>
                    <span>Expandir tudo</span>
                  </>
                )}
              </button>
            </div>

            {/* DRE Tree Views - Renderização Dinâmica de N Períodos */}
            {dreDataTodosPeriodos.length > 0 ? (
              <div className="flex gap-4 px-4 overflow-x-auto">
                {dreDataTodosPeriodos.map((periodoData, index) => {
                  const periodo = periodoData.periodo;
                  const estruturaDRE = periodoData.estrutura;

                  // Gerar título da coluna baseado nas datas do período
                  const dtInicio = periodo.dt_inicio
                    ? new Date(periodo.dt_inicio + 'T00:00:00')
                    : null;
                  const dtFim = periodo.dt_fim
                    ? new Date(periodo.dt_fim + 'T00:00:00')
                    : null;

                  let tituloColuna = `Período ${index + 1}`;
                  if (dtInicio && dtFim) {
                    const mesInicio = dtInicio.toLocaleDateString('pt-BR', {
                      month: 'short',
                      year: 'numeric',
                    });
                    const mesFim = dtFim.toLocaleDateString('pt-BR', {
                      month: 'short',
                      year: 'numeric',
                    });

                    if (mesInicio === mesFim) {
                      tituloColuna = `📅 ${mesInicio}`;
                    } else {
                      tituloColuna = `📅 ${mesInicio} - ${mesFim}`;
                    }
                  }

                  // Análise vertical: mostrar porcentagem
                  // Análise horizontal: mostrar variação em relação ao período anterior
                  const mostrarPorcentagem = tipoAnalise === 'vertical';
                  const mostrarVariacao =
                    tipoAnalise === 'horizontal' && index > 0;

                  const periodoAnteriorDados =
                    index > 0 ? dadosPeriodos[index - 1] : null;
                  const periodoAtualDados = dadosPeriodos[index];

                  return (
                    <div key={`periodo-${periodoData.periodoId}-${index}`}>
                      {renderDRETreeView(
                        estruturaDRE,
                        tituloColuna,
                        mostrarPorcentagem,
                        mostrarVariacao,
                        periodoAnteriorDados,
                        periodoAtualDados,
                      )}
                    </div>
                  );
                })}
              </div>
            ) : // Fallback para o modo antigo (compatibilidade)
            tipoAnalise === 'vertical' ? (
              drePeriodo2Data.length > 0 ? (
                <div className="flex gap-4 px-4 overflow-x-auto">
                  {renderDRETreeView(
                    dreData,
                    `📅 ${obterNomeMes(filtroMensal)}`,
                    true,
                    false,
                  )}
                  {renderDRETreeView(
                    drePeriodo2Data,
                    `📅 ${obterNomeMes(filtroMensalComparacao)}`,
                    true,
                    false,
                  )}
                  {renderDRETreeView(
                    dreConsolidadoData,
                    '📊 Consolidado',
                    true,
                    false,
                  )}
                </div>
              ) : (
                renderDRETreeView(dreData, null, true, false)
              )
            ) : (
              <div className="flex gap-4 px-4 overflow-x-auto">
                {renderDRETreeView(
                  dreData,
                  `📅 ${obterNomeMes(filtroMensal)}`,
                  false,
                  false,
                )}
                {renderDRETreeView(
                  drePeriodo2Data,
                  `📅 ${obterNomeMes(filtroMensalComparacao)}`,
                  false,
                  true,
                  {
                    vendasBrutas,
                    devolucoes,
                    descontos,
                    totalImpostos,
                    receitaLiquida,
                    cmv,
                    lucroBruto,
                    planoDespesasTotal,
                    planoDespesasFinanceirasTotal,
                  },
                  dadosPeriodo2,
                )}
                {renderDRETreeView(
                  dreConsolidadoData,
                  '📊 Consolidado',
                  false,
                  false,
                )}
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 px-4">
            <div className="text-center">
              <TrendUp className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Nenhum dado carregado
              </h3>
            </div>
          </div>
        )}
      </div>

      {/* Modal de Adicionar Despesa Manual */}
      <ModalAdicionarDespesaManual
        isOpen={modalDespesaManualAberto}
        onClose={() => setModalDespesaManualAberto(false)}
        onSuccess={() => {
          console.log('✅ Despesa manual adicionada! Recarregando dados...');
          // Recarregar os dados do DRE após adicionar despesa
          if (
            periodos.length > 0 &&
            periodos[0].dt_inicio &&
            periodos[0].dt_fim
          ) {
            buscarVendasBrutas();
          }
        }}
        periodosSelecionados={periodos.filter((p) => p.dt_inicio && p.dt_fim)}
      />

      {/* Modal Detalhes Despesa Manual/TOTVS */}
      {modalDespManual && despesaSelecionada && (
        <ModalDetalhesDespesaManual
          modalDespManual={modalDespManual}
          setModalDespManual={setModalDespManual}
          despesa={despesaSelecionada}
          periodoAtual={periodo} // 🆕 Passar período atual para salvar observações
          onSave={async (despesaAtualizada) => {
            console.log('💾 Despesa/Observação atualizada:', despesaAtualizada);

            // 🚀 OTIMIZAÇÃO: Só recarregar o necessário
            if (
              despesaAtualizada._isDespesaManual ||
              despesaAtualizada.ativo === false
            ) {
              // Para despesas manuais (criar/editar/excluir): recarregar dados silenciosamente
              console.log(
                '🔄 Recarregando dados em background (despesa manual)...',
              );

              // Recarregar sem mostrar loading full screen
              buscarVendasBrutas()
                .then(() => {
                  console.log('✅ Dados atualizados com sucesso');
                })
                .catch((error) => {
                  console.error('❌ Erro ao atualizar dados:', error);
                });
            } else {
              // Para observações TOTVS: apenas atualizar o objeto no estado local
              console.log(
                '📝 Atualizando apenas observação no estado local...',
              );

              // Atualizar a despesa selecionada com a nova observação
              setDespesaSelecionada((prev) => ({
                ...prev,
                ...despesaAtualizada,
              }));

              // Atualizar nos dados dos períodos se existir
              setDadosPeriodos((prev) =>
                prev.map((p) => {
                  if (p.periodoId === periodo.id) {
                    return {
                      ...p,
                      despesasOperacionais: atualizarObservacaoNaArvore(
                        p.despesasOperacionais,
                        despesaAtualizada,
                      ),
                      despesasFinanceiras: atualizarObservacaoNaArvore(
                        p.despesasFinanceiras,
                        despesaAtualizada,
                      ),
                    };
                  }
                  return p;
                }),
              );

              console.log('✅ Observação atualizada localmente (sem reload)');
            }
          }}
        />
      )}
    </div>
  );
};

export default DRE;
