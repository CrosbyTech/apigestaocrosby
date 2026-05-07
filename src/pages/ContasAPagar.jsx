import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useAuth } from '../components/AuthContext';
import useApiClient from '../hooks/useApiClient';
import { API_BASE_URL } from '../config/constants';
import { supabase } from '../lib/supabase';
import PageTitle from '../components/ui/PageTitle';
import {
  Receipt,
  ChatCircleDots,
  CaretUp,
  CaretDown,
} from '@phosphor-icons/react';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import ChatContasPagar from '../components/ChatIA/ChatContasPagar';

import {
  FiltrosContasPagar,
  CardsResumo,
  TabelaDetalhamento,
  DespesasPorCategoria,
  ModaisContasPagar,
  criarDataSemFusoHorario,
  formatarData,
  getStatusFromData,
  aplicarFiltroMensal,
  agruparDadosIdenticos,
} from '../components/ContasAPagar';

const ContasAPagar = (props) => {
  const { user, hasRole } = useAuth?.() || { user: null, hasRole: () => false };
  const apiClient = useApiClient();
  const isEmissao = !!props?.__modoEmissao;
  const [modoData, setModoData] = useState(
    isEmissao ? 'emissao' : 'vencimento',
  );
  const blockedCostCenters = useMemo(
    () =>
      (props?.__blockedCostCenters || []).map((n) =>
        typeof n === 'string' ? parseInt(n, 10) : Number(n),
      ),
    [props?.__blockedCostCenters],
  );
  const despesasFixas = props?.__despesasFixas || null;

  // ─── Estados Principais ───
  const [dados, setDados] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dadosCarregados, setDadosCarregados] = useState(false);
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [situacao, setSituacao] = useState('N');
  const [previsao, setPrevisao] = useState('TODOS');
  const [duplicata, setDuplicata] = useState('');

  // ─── Estados de Filtro ───
  const [empresasSelecionadas, setEmpresasSelecionadas] = useState([]);
  const [centrosCustoSelecionados, setCentrosCustoSelecionados] = useState([]);
  const [despesasSelecionadas, setDespesasSelecionadas] = useState([]);
  const [dadosCentroCusto, setDadosCentroCusto] = useState([]);
  const [dadosDespesa, setDadosDespesa] = useState([]);
  const [filtroMensal, setFiltroMensal] = useState('ANO');
  const [filtroDia, setFiltroDia] = useState(null);

  // ─── Estados de Busca de Fornecedor ───
  const [tipoBuscaFornecedor, setTipoBuscaFornecedor] = useState('nome');
  const [termoBuscaFornecedor, setTermoBuscaFornecedor] = useState('');
  const [fornecedoresEncontrados, setFornecedoresEncontrados] = useState([]);
  const [modalBuscaFornecedorAberto, setModalBuscaFornecedorAberto] =
    useState(false);
  const [buscandoFornecedores, setBuscandoFornecedores] = useState(false);
  const [fornecedorBuscaSelecionado, setFornecedorBuscaSelecionado] =
    useState(null);

  // ─── Estados de Seleção ───
  const [linhasSelecionadas, setLinhasSelecionadas] = useState(new Set());
  const [linhasSelecionadasAgrupadas, setLinhasSelecionadasAgrupadas] =
    useState(new Set());

  // ─── Estados de Ordenação e Filtros de Coluna ───
  const [sortConfig, setSortConfig] = useState({
    key: 'dt_vencimento',
    direction: 'asc',
  });
  const [columnFilters, setColumnFilters] = useState({});
  const [openFilterDropdown, setOpenFilterDropdown] = useState(null);

  // ─── Estados de Modal ───
  const [modalAberto, setModalAberto] = useState(false);
  const [dadosModal, setDadosModal] = useState(null);
  const [modalDetalhes, setModalDetalhes] = useState({
    isOpen: false,
    conta: null,
  });
  const [modalCardAberto, setModalCardAberto] = useState(false);
  const [tipoCardSelecionado, setTipoCardSelecionado] = useState('');
  const [dadosCardModal, setDadosCardModal] = useState([]);
  const [planoOpen, setPlanoOpen] = useState(true);

  // ─── Estado Filtro Pagamento ───
  const [filtroPagamento, setFiltroPagamento] = useState('TODOS');
  const [valorInicial, setValorInicial] = useState('');
  const [valorFinal, setValorFinal] = useState('');

  // ─── Estado Chat IA ───
  const [chatIAAberto, setChatIAAberto] = useState(false);

  // ─── Datas padrão (mês atual) ───
  useEffect(() => {
    const hoje = new Date();
    const primeiroDia = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    const ultimoDia = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
    setDataInicio(primeiroDia.toISOString().split('T')[0]);
    setDataFim(ultimoDia.toISOString().split('T')[0]);
  }, []);

  // Limpar seleções ao mudar dados ou filtros
  useEffect(() => {
    setLinhasSelecionadas(new Set());
    setLinhasSelecionadasAgrupadas(new Set());
  }, [dados, filtroMensal]);

  useEffect(() => {
    setFiltroDia(null);
  }, [filtroMensal]);

  // ─── Dados Derivados Memoizados ───
  const dadosComFiltroMensal = useMemo(
    () => aplicarFiltroMensal(dados, filtroMensal, filtroDia),
    [dados, filtroMensal, filtroDia],
  );

  const dadosAgrupadosParaCards = useMemo(
    () => agruparDadosIdenticos(dadosComFiltroMensal),
    [dadosComFiltroMensal],
  );

  // Função de ordenação memoizada
  const sortDadosAgrupados = useCallback(
    (dadosAgr) => {
      if (!dadosAgr || dadosAgr.length === 0) return dadosAgr;
      return [...dadosAgr].sort((a, b) => {
        let aValue, bValue;
        const key = sortConfig.key;

        // Datas
        if (
          ['dt_emissao', 'dt_vencimento', 'dt_entrada', 'dt_liq'].includes(key)
        ) {
          aValue = a.item?.[key]
            ? criarDataSemFusoHorario(a.item[key])
            : new Date(0);
          bValue = b.item?.[key]
            ? criarDataSemFusoHorario(b.item[key])
            : new Date(0);
        }
        // Valores numéricos
        else if (
          [
            'vl_duplicata',
            'vl_juros',
            'vl_acrescimo',
            'vl_desconto',
            'vl_pago',
          ].includes(key)
        ) {
          aValue = parseFloat(a.item?.[key]) || 0;
          bValue = parseFloat(b.item?.[key]) || 0;
        }
        // Parcela (int)
        else if (key === 'nr_parcela') {
          aValue = parseInt(a.item?.nr_parcela) || 0;
          bValue = parseInt(b.item?.nr_parcela) || 0;
        }
        // Strings
        else {
          aValue = (a.item?.[key] || '').toString().toLowerCase();
          bValue = (b.item?.[key] || '').toString().toLowerCase();
        }

        if (sortConfig.direction === 'asc') {
          return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
        }
        return aValue < bValue ? 1 : aValue > bValue ? -1 : 0;
      });
    },
    [sortConfig],
  );

  // Filtros de coluna memoizados
  const aplicarFiltrosColuna = useCallback(
    (dadosOriginais) => {
      if (!dadosOriginais || dadosOriginais.length === 0) return [];
      if (Object.keys(columnFilters).length === 0) return dadosOriginais;

      return dadosOriginais.filter((grupo) => {
        const item = grupo.item;
        for (const [columnKey, filterConfig] of Object.entries(columnFilters)) {
          if (!filterConfig) continue;
          const valorItem = String(item[columnKey] || '');
          if (filterConfig.searchTerm?.trim()) {
            if (
              !valorItem
                .toLowerCase()
                .includes(filterConfig.searchTerm.toLowerCase())
            )
              return false;
          }
          if (filterConfig.selected?.length > 0) {
            if (!filterConfig.selected.includes(valorItem)) return false;
          }
        }
        return true;
      });
    },
    [columnFilters],
  );

  // Pipeline completo de dados para tabela e cards
  const dadosOrdenadosParaCards = useMemo(() => {
    const ordenados = sortDadosAgrupados(dadosAgrupadosParaCards);
    return aplicarFiltrosColuna(ordenados);
  }, [dadosAgrupadosParaCards, sortDadosAgrupados, aplicarFiltrosColuna]);

  // Cálculos de cards memoizados para o ChatIA
  const resumoCards = useMemo(() => {
    let totalContas = dadosOrdenadosParaCards.length;
    let totalValor = 0;
    let contasVencidas = 0;
    let contasPagas = 0;
    let valorPago = 0;

    for (const grupo of dadosOrdenadosParaCards) {
      const vl = parseFloat(grupo.item.vl_duplicata || 0);
      totalValor += vl;
      const status = getStatusFromData(grupo.item);
      if (status === 'Vencido') contasVencidas++;
      if (status === 'Pago') {
        contasPagas++;
        valorPago += parseFloat(grupo.item.vl_pago || 0);
      }
    }

    return {
      totalContas,
      valorTotal: totalValor,
      contasVencidas,
      contasPagas,
      valorPago,
      faltaPagar: totalValor - valorPago,
    };
  }, [dadosOrdenadosParaCards]);

  // ─── Handlers ───
  const handleSort = useCallback((key) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  }, []);

  const getSortIcon = useCallback(
    (key) => {
      if (sortConfig.key !== key)
        return <CaretDown size={10} className="ml-1 opacity-50" />;
      return sortConfig.direction === 'asc' ? (
        <CaretUp size={10} className="ml-1" />
      ) : (
        <CaretDown size={10} className="ml-1" />
      );
    },
    [sortConfig],
  );

  const obterDiasDoMes = useCallback((mes) => {
    const meses = {
      JAN: 31,
      FEV: 28,
      MAR: 31,
      ABR: 30,
      MAI: 31,
      JUN: 30,
      JUL: 31,
      AGO: 31,
      SET: 30,
      OUT: 31,
      NOV: 30,
      DEZ: 31,
    };
    return meses[mes] || 0;
  }, []);

  const handleFiltroMensalChange = useCallback((novoFiltro) => {
    setFiltroMensal(novoFiltro);
    setFiltroDia(null);
  }, []);

  const handleSelectEmpresas = useCallback(
    (empresas) => setEmpresasSelecionadas([...empresas]),
    [],
  );
  const handleSelectCentrosCusto = useCallback(
    (cc) => setCentrosCustoSelecionados([...cc]),
    [],
  );
  const handleSelectDespesas = useCallback(
    (d) => setDespesasSelecionadas([...d]),
    [],
  );

  const toggleFilterDropdown = useCallback((colKey) => {
    setOpenFilterDropdown((prev) => (prev === colKey ? null : colKey));
  }, []);

  const handleApplyFilter = useCallback((columnKey, filterConfig) => {
    setColumnFilters((prev) => {
      if (filterConfig) return { ...prev, [columnKey]: filterConfig };
      const ns = { ...prev };
      delete ns[columnKey];
      return ns;
    });
    setOpenFilterDropdown(null);
  }, []);

  const toggleLinhaSelecionada = useCallback((index) => {
    setLinhasSelecionadas((prev) => {
      const n = new Set(prev);
      n.has(index) ? n.delete(index) : n.add(index);
      return n;
    });
  }, []);

  // ─── Modais ───
  const abrirModalDetalhes = useCallback(
    (conta) => setModalDetalhes({ isOpen: true, conta }),
    [],
  );
  const fecharModalDetalhes = useCallback(
    () => setModalDetalhes({ isOpen: false, conta: null }),
    [],
  );
  const fecharModal = useCallback(() => {
    setModalAberto(false);
    setDadosModal(null);
  }, []);
  const fecharModalCard = useCallback(() => {
    setModalCardAberto(false);
    setTipoCardSelecionado('');
    setDadosCardModal([]);
  }, []);

  const getTituloModal = useCallback((tipo) => {
    const map = {
      vencidas: 'Contas Vencidas',
      aVencer: 'Contas a Vencer',
      proximasVencer: 'Próximas a Vencer',
      pagas: 'Contas Pagas',
      faltaPagar: 'Falta Pagar',
      descontos: 'Descontos Ganhos',
    };
    return map[tipo] || 'Detalhes';
  }, []);

  const abrirModalCard = useCallback(
    (tipo) => {
      let filtrados = [];
      switch (tipo) {
        case 'vencidas':
          filtrados = dadosOrdenadosParaCards
            .filter((g) => getStatusFromData(g.item) === 'Vencido')
            .map((g) => g.item);
          break;
        case 'aVencer':
          filtrados = dadosOrdenadosParaCards
            .filter((g) => getStatusFromData(g.item) === 'A Vencer')
            .map((g) => g.item);
          break;
        case 'proximasVencer':
          filtrados = dadosOrdenadosParaCards
            .filter((g) => getStatusFromData(g.item) === 'Próxima a Vencer')
            .map((g) => g.item);
          break;
        case 'pagas':
          filtrados = dadosOrdenadosParaCards
            .filter((g) => getStatusFromData(g.item) === 'Pago')
            .map((g) => g.item);
          break;
        case 'faltaPagar':
          filtrados = dadosOrdenadosParaCards
            .filter((g) => getStatusFromData(g.item) !== 'Pago')
            .map((g) => g.item);
          break;
        case 'descontos':
          filtrados = dadosOrdenadosParaCards
            .filter((g) => parseFloat(g.item.vl_desconto || 0) > 0)
            .map((g) => g.item);
          break;
        default:
          filtrados = [];
      }
      setDadosCardModal(filtrados);
      setTipoCardSelecionado(tipo);
      setModalCardAberto(true);
    },
    [dadosOrdenadosParaCards],
  );

  // ─── Busca de fornecedor ───
  const buscarFornecedor = useCallback(async () => {
    const termo = termoBuscaFornecedor.trim();
    if (!termo) {
      alert('Digite um valor para buscar!');
      return;
    }

    // Busca por código: aplica direto sem chamar API
    if (tipoBuscaFornecedor === 'codigo') {
      const code = parseInt(termo, 10);
      if (isNaN(code) || code <= 0) {
        alert('Código inválido. Digite um número inteiro positivo.');
        return;
      }
      setFornecedorBuscaSelecionado({
        cd_pessoa: code,
        nm_pessoa: `Fornecedor Cód. ${code}`,
      });
      return;
    }

    setBuscandoFornecedores(true);
    try {
      let queryParam = '';
      if (tipoBuscaFornecedor === 'nome')
        queryParam = `nome=${encodeURIComponent(termo)}`;
      else if (tipoBuscaFornecedor === 'fantasia')
        queryParam = `fantasia=${encodeURIComponent(termo)}`;
      else if (tipoBuscaFornecedor === 'cnpj_cpf')
        queryParam = `cnpj=${encodeURIComponent(termo.replace(/\D/g, ''))}`;

      const response = await fetch(
        `${API_BASE_URL}/api/totvs/clientes/search-name?${queryParam}`,
      );
      if (!response.ok) throw new Error('Erro ao buscar fornecedores');
      const data = await response.json();

      let fornecedores = [];
      if (data.success && data.data?.clientes) {
        fornecedores = data.data.clientes.map((f) => ({
          cd_pessoa: f.code,
          nm_pessoa: f.nm_pessoa,
          nm_fantasia: f.fantasy_name || null,
          cpf: f.cpf || null,
          tipo_pessoa: f.tipo_pessoa || null,
        }));
      }

      if (fornecedores.length === 0) {
        alert('Nenhum fornecedor encontrado com os critérios informados.');
      } else if (
        fornecedores.length === 1 &&
        tipoBuscaFornecedor === 'cnpj_cpf'
      ) {
        // Auto-seleciona quando resultado único por CNPJ/CPF
        setFornecedorBuscaSelecionado(fornecedores[0]);
      } else {
        setFornecedoresEncontrados(fornecedores);
        setModalBuscaFornecedorAberto(true);
      }
    } catch {
      alert('Erro ao buscar fornecedor. Tente novamente.');
    } finally {
      setBuscandoFornecedores(false);
    }
  }, [tipoBuscaFornecedor, termoBuscaFornecedor]);

  const selecionarFornecedorBusca = useCallback((fornecedor) => {
    setFornecedorBuscaSelecionado(fornecedor);
    setModalBuscaFornecedorAberto(false);
  }, []);

  const limparFornecedorBusca = useCallback(() => {
    setFornecedorBuscaSelecionado(null);
    setTermoBuscaFornecedor('');
  }, []);

  // ─── Enviar títulos selecionados para Liberação de Pagamento ───
  const enviarParaPagamento = useCallback(async () => {
    if (linhasSelecionadasAgrupadas.size === 0) {
      alert('Selecione pelo menos um título para enviar.');
      return;
    }

    // Coletar itens selecionados, filtrando só os que estão em aberto (não pagos)
    const itensSelecionados = [];
    const idsInvalidos = [];
    linhasSelecionadasAgrupadas.forEach((idx) => {
      const grupo = dadosOrdenadosParaCards[idx];
      if (!grupo) return;
      const status = getStatusFromData(grupo.item);
      if (status === 'Pago') {
        idsInvalidos.push(idx);
      } else {
        itensSelecionados.push(grupo.item);
      }
    });

    if (itensSelecionados.length === 0) {
      alert(
        'Os títulos selecionados já estão pagos. Selecione apenas títulos em aberto.',
      );
      return;
    }

    if (idsInvalidos.length > 0) {
      const continuar = window.confirm(
        `${idsInvalidos.length} título(s) já pago(s) serão ignorados. Enviar os ${itensSelecionados.length} em aberto?`,
      );
      if (!continuar) return;
    } else if (
      !window.confirm(
        `Enviar ${itensSelecionados.length} título(s) para Liberação de Pagamento?`,
      )
    ) {
      return;
    }

    const toDate = (d) => {
      if (!d) return null;
      const s = String(d).split('T')[0];
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
    };

    const registros = itensSelecionados.map((item) => ({
      cd_empresa: item.cd_empresa ? parseInt(item.cd_empresa) : null,
      nm_empresa: item.nm_empresa || null,
      nr_duplicata: item.nr_duplicata ? String(item.nr_duplicata) : null,
      nr_parcela: item.nr_parcela ? String(item.nr_parcela) : null,
      nr_portador: item.nr_portador ? String(item.nr_portador) : null,
      cd_fornecedor: item.cd_fornecedor ? String(item.cd_fornecedor) : null,
      nm_fornecedor: item.nm_fornecedor || null,
      cd_despesaitem: item.cd_despesaitem ? String(item.cd_despesaitem) : null,
      ds_despesaitem: item.ds_despesaitem || null,
      cd_ccusto: item.cd_ccusto ? String(item.cd_ccusto) : null,
      dt_emissao: toDate(item.dt_emissao),
      dt_vencimento: toDate(item.dt_vencimento),
      vl_duplicata: parseFloat(item.vl_duplicata || 0),
      status: 'PENDENTE',
      enviado_por: user?.email || null,
      dados_completos: item,
    }));

    try {
      // Verificar duplicatas já enviadas (mesma nr_duplicata + cd_empresa + status não cancelado)
      const chaves = registros
        .filter((r) => r.nr_duplicata && r.cd_empresa)
        .map((r) => ({
          nr_duplicata: r.nr_duplicata,
          cd_empresa: r.cd_empresa,
          nr_parcela: r.nr_parcela,
          cd_fornecedor: r.cd_fornecedor,
        }));

      if (chaves.length > 0) {
        const { data: jaExistentes } = await supabase
          .from('pagamentos_liberacao')
          .select('nr_duplicata, cd_empresa, nr_parcela, status,cd_fornecedor')
          .in(
            'nr_duplicata',
            chaves.map((c) => c.nr_duplicata),
          )
          .not('status', 'eq', 'CANCELADO');

        if (jaExistentes && jaExistentes.length > 0) {
          const conflitos = jaExistentes.filter((ex) =>
            chaves.some(
              (c) =>
                c.nr_duplicata === ex.nr_duplicata &&
                c.cd_fornecedor === ex.cd_fornecedor &&
                c.cd_empresa === ex.cd_empresa &&
                (c.nr_parcela || null) === (ex.nr_parcela || null),
            ),
          );

          if (conflitos.length > 0) {
            const msgs = conflitos
              .map(
                (c) =>
                  `Fornecedor ${c.cd_fornecedor} • Duplicata ${c.nr_duplicata}${c.nr_parcela ? `/${c.nr_parcela}` : ''} — já enviada (${c.status})`,
              )
              .join('\n');
            alert(
              `⚠️ Envio bloqueado!\n\nAs seguintes duplicatas já foram enviadas para Liberação de Pagamento:\n\n${msgs}\n\nDesmarque-as e tente novamente.`,
            );
            return;
          }
        }
      }

      const { error } = await supabase
        .from('pagamentos_liberacao')
        .insert(registros);
      if (error) throw error;
      alert(
        `${registros.length} título(s) enviado(s) com sucesso para Liberação de Pagamento!`,
      );
      setLinhasSelecionadasAgrupadas(new Set());
    } catch (err) {
      alert('Erro ao enviar para pagamento: ' + (err.message || err));
    }
  }, [linhasSelecionadasAgrupadas, dadosOrdenadosParaCards, user]);

  // ─── Exportar Excel ───
  const exportarExcelDetalhamento = useCallback(() => {
    if (!dadosOrdenadosParaCards || dadosOrdenadosParaCards.length === 0) {
      alert('Nenhum dado para exportar');
      return;
    }
    const dadosParaExportar = dadosOrdenadosParaCards.map((grupo) => {
      return {
        Vencimento: formatarData(grupo.item.dt_vencimento),
        Valor: parseFloat(grupo.item.vl_duplicata || 0),
        Fornecedor: grupo.item.cd_fornecedor || '',
        'Nome Fornecedor': grupo.item.nm_fornecedor || '',
        'Cód Despesa': grupo.item.cd_despesaitem || '',
        Despesa: grupo.item.ds_despesaitem || '',
        'Cód C.Custo': grupo.item.cd_ccusto || '',
        'Centro de Custo': grupo.item.ds_ccusto || '',
        '% Rateio': parseFloat(grupo.item.perc_rateio || 0),
        'Vl Rateio': parseFloat(grupo.item.vl_rateio || 0),
        Empresa: grupo.item.cd_empresa || '',
        Duplicata: grupo.item.nr_duplicata || '',
        Parcela: grupo.item.nr_parcela || '',
        Portador: grupo.item.nr_portador || '',
        Emissão: formatarData(grupo.item.dt_emissao),
        Entrada: formatarData(grupo.item.dt_entrada),
        Liquidação: formatarData(grupo.item.dt_liq),
        Situação: grupo.item.tp_situacao || '',
        Estágio: grupo.item.tp_estagio || '',
        Juros: parseFloat(grupo.item.vl_juros || 0),
        Acréscimo: parseFloat(grupo.item.vl_acrescimo || 0),
        Desconto: parseFloat(grupo.item.vl_desconto || 0),
        Pago: parseFloat(grupo.item.vl_pago || 0),
        Aceite: grupo.item.in_aceite || '',
        Observação: grupo.item.ds_observacao || '',
        Previsão: grupo.item.tp_previsaoreal || '',
      };
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(dadosParaExportar);
    ws['!cols'] = [
      { wch: 12 },
      { wch: 14 },
      { wch: 12 },
      { wch: 28 },
      { wch: 10 },
      { wch: 28 },
      { wch: 10 },
      { wch: 24 },
      { wch: 10 },
      { wch: 14 },
      { wch: 10 },
      { wch: 12 },
      { wch: 8 },
      { wch: 10 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 10 },
      { wch: 10 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 10 },
      { wch: 30 },
      { wch: 10 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Detalhamento');
    const fileName = `detalhamento_contas_${new Date().toISOString().split('T')[0]}.xlsx`;
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(
      new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      fileName,
    );
  }, [dadosOrdenadosParaCards]);

  // ─── Busca de Dados (API TOTVS) ───
  const buscarDados = async (inicio = dataInicio, fim = dataFim) => {
    if (!inicio || !fim) return;
    if (empresasSelecionadas.length === 0) {
      alert('Selecione pelo menos uma empresa para consultar!');
      return;
    }

    setLoading(true);
    try {
      const codigosEmpresas = empresasSelecionadas
        .filter((e) => e.cd_empresa)
        .map((e) => parseInt(e.cd_empresa));

      const payload = {
        dt_inicio: inicio,
        dt_fim: fim,
        branches: codigosEmpresas,
        modo: modoData,
        situacao: situacao || 'N',
        previsao: previsao === 'PREVISÃO' ? 'PREVISAO' : previsao || 'TODOS',
        filtroPagamento,
        ...(valorInicial !== '' && { valorInicial: parseFloat(valorInicial) }),
        ...(valorFinal !== '' && { valorFinal: parseFloat(valorFinal) }),
      };

      if (fornecedorBuscaSelecionado) {
        payload.supplierCodeList = [
          parseInt(fornecedorBuscaSelecionado.cd_pessoa),
        ];
      }
      if (duplicata?.trim()) {
        payload.duplicateCodeList = [parseInt(duplicata.trim())].filter(
          (d) => !isNaN(d),
        );
      }

      const result = await apiClient.totvs.accountsPayableSearch(payload);

      let dadosArray = [];
      if (result && typeof result === 'object') {
        if (Array.isArray(result.data)) dadosArray = result.data;
        else if (result.data && Array.isArray(result.data.data))
          dadosArray = result.data.data;
        else if (result.metadata && Array.isArray(result.metadata.data))
          dadosArray = result.metadata.data;
      }

      // Mapa de código empresa → nome
      const empresaMap = {};
      empresasSelecionadas.forEach((e) => {
        if (e.cd_empresa) {
          empresaMap[String(e.cd_empresa)] =
            e.nm_grupoempresa || e.fantasyName || e.description || '';
        }
      });

      const dadosProcessados = dadosArray.map((item) => ({
        ...item,
        ds_observacao: item.ds_observacao || '',
        in_aceite: item.in_aceite || '',
        vl_rateio: item.vl_rateio || 0,
        perc_rateio: item.perc_rateio || 0,
        tp_aceite: item.in_aceite || '',
        ds_ccusto: item.cd_ccusto ? '----' : '',
        nm_fornecedor: item.nm_fornecedor || '',
        ds_despesaitem: item.ds_despesaitem || '',
        cd_despesaitem: item.cd_despesaitem || '',
        cd_ccusto: item.cd_ccusto || '',
        nm_empresa: empresaMap[String(item.cd_empresa)] || '',
      }));

      // Filtros de Centro de Custo
      let filtrados = dadosProcessados;
      if (centrosCustoSelecionados.length > 0) {
        const ccsFiltro = centrosCustoSelecionados.map((c) =>
          String(c.cd_ccusto),
        );
        filtrados = filtrados.filter((item) =>
          ccsFiltro.includes(String(item.cd_ccusto)),
        );
      }

      // Filtros de Despesas
      if (despesasSelecionadas.length > 0) {
        const despsFiltro = despesasSelecionadas.map((d) =>
          String(d.cd_despesaitem),
        );
        filtrados = filtrados.filter((item) =>
          despsFiltro.includes(String(item.cd_despesaitem)),
        );
      }

      // Bloqueio de centros de custo (via props)
      if (blockedCostCenters?.length > 0) {
        filtrados = filtrados.filter((item) => {
          const cc = Number(
            typeof item.cd_ccusto === 'string'
              ? parseInt(item.cd_ccusto, 10)
              : item.cd_ccusto,
          );
          return !blockedCostCenters.includes(cc);
        });
      }

      // Filtro de despesas fixas (via props)
      if (despesasFixas?.length > 0) {
        filtrados = filtrados.filter((item) =>
          despesasFixas.includes(parseInt(item.cd_despesaitem) || 0),
        );
      }

      setDados(filtrados);

      // Extrair despesas e centros de custo únicos para filtros
      const despesasUnicas = [];
      const despCodigosVistos = new Set();
      const ccUnicos = [];
      const ccCodigosVistos = new Set();

      filtrados.forEach((item) => {
        if (
          item.cd_despesaitem &&
          !despCodigosVistos.has(item.cd_despesaitem)
        ) {
          despCodigosVistos.add(item.cd_despesaitem);
          despesasUnicas.push({
            cd_despesaitem: item.cd_despesaitem,
            ds_despesaitem: item.ds_despesaitem || '',
          });
        }
        if (item.cd_ccusto && !ccCodigosVistos.has(item.cd_ccusto)) {
          ccCodigosVistos.add(item.cd_ccusto);
          ccUnicos.push({
            cd_ccusto: item.cd_ccusto,
            ds_ccusto: item.ds_ccusto || '----',
          });
        }
      });

      setDadosDespesa(despesasUnicas);
      setDadosCentroCusto(ccUnicos);
      setDadosCarregados(true);
    } catch (err) {
      setDados([]);
      setDadosCarregados(false);
    } finally {
      setLoading(false);
    }
  };

  // Fix: handleFiltrar precisa chamar buscarDados atual
  const handleFiltrarFn = useCallback(
    (e) => {
      e.preventDefault();
      buscarDados();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      dataInicio,
      dataFim,
      empresasSelecionadas,
      situacao,
      previsao,
      fornecedorBuscaSelecionado,
      duplicata,
      centrosCustoSelecionados,
      despesasSelecionadas,
      blockedCostCenters,
      despesasFixas,
      modoData,
      filtroPagamento,
      valorInicial,
      valorFinal,
    ],
  );

  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col items-stretch justify-start py-3 px-2">
      <PageTitle
        title="Contas a Pagar"
        subtitle="Gerencie e acompanhe todas as contas a pagar da empresa"
        icon={Receipt}
        iconColor="text-red-600"
      />

      {/* Filtros */}
      <FiltrosContasPagar
        modoData={modoData}
        setModoData={setModoData}
        dataInicio={dataInicio}
        setDataInicio={setDataInicio}
        dataFim={dataFim}
        setDataFim={setDataFim}
        situacao={situacao}
        setSituacao={setSituacao}
        previsao={previsao}
        setPrevisao={setPrevisao}
        duplicata={duplicata}
        setDuplicata={setDuplicata}
        empresasSelecionadas={empresasSelecionadas}
        handleSelectEmpresas={handleSelectEmpresas}
        centrosCustoSelecionados={centrosCustoSelecionados}
        handleSelectCentrosCusto={handleSelectCentrosCusto}
        despesasSelecionadas={despesasSelecionadas}
        handleSelectDespesas={handleSelectDespesas}
        dadosCentroCusto={dadosCentroCusto}
        dadosDespesa={dadosDespesa}
        loading={loading}
        fornecedorBuscaSelecionado={fornecedorBuscaSelecionado}
        tipoBuscaFornecedor={tipoBuscaFornecedor}
        setTipoBuscaFornecedor={setTipoBuscaFornecedor}
        termoBuscaFornecedor={termoBuscaFornecedor}
        setTermoBuscaFornecedor={setTermoBuscaFornecedor}
        setFornecedorBuscaSelecionado={setFornecedorBuscaSelecionado}
        buscandoFornecedores={buscandoFornecedores}
        buscarFornecedor={buscarFornecedor}
        limparFornecedorBusca={limparFornecedorBusca}
        handleFiltrar={handleFiltrarFn}
        filtroPagamento={filtroPagamento}
        setFiltroPagamento={setFiltroPagamento}
        valorInicial={valorInicial}
        setValorInicial={setValorInicial}
        valorFinal={valorFinal}
        setValorFinal={setValorFinal}
      />

      {/* Cards de Resumo */}
      <CardsResumo
        dadosOrdenadosParaCards={dadosOrdenadosParaCards}
        loading={loading}
        abrirModalCard={abrirModalCard}
      />

      {/* Conteúdo principal */}
      <div className="flex flex-col gap-3 justify-center bg-white rounded-lg shadow-lg border border-[#000638]/10">
        <div className="p-3">
          {loading ? (
            <div className="flex justify-center items-center py-12">
              <div className="flex items-center gap-1">
                <span className="animate-spin text-blue-600 text-lg">⟳</span>
                <span className="text-sm text-gray-600">
                  Carregando dados...
                </span>
              </div>
            </div>
          ) : !dadosCarregados ? (
            <div className="flex justify-center items-center py-12">
              <div className="text-center">
                <div className="text-gray-500 text-sm mb-0.5">
                  Clique em "Buscar Dados" para carregar as informações
                </div>
                <div className="text-gray-400 text-xs">
                  Selecione o período e empresa desejados
                </div>
              </div>
            </div>
          ) : dados.length === 0 ? (
            <div className="flex justify-center items-center py-12">
              <div className="text-center">
                <div className="text-gray-500 text-sm mb-0.5">
                  Nenhum dado encontrado
                </div>
                <div className="text-gray-400 text-xs">
                  Verifique o período selecionado ou tente novamente
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Plano de Contas */}
              <div className="bg-white rounded-lg shadow-lg border border-[#000638]/10 w-full mb-3">
                <button
                  className="w-full p-3 flex items-center justify-between"
                  onClick={() => setPlanoOpen(!planoOpen)}
                >
                  <h2 className="text-sm font-bold text-[#000638]">
                    Plano de Contas
                  </h2>
                  <span className="text-xs text-gray-500">
                    {planoOpen ? 'Ocultar' : 'Mostrar'}
                  </span>
                </button>
                {planoOpen && (
                  <div className="p-3 border-t border-[#000638]/10">
                    <DespesasPorCategoria
                      dados={dadosComFiltroMensal}
                      totalContas={dadosComFiltroMensal.length}
                      linhasSelecionadas={linhasSelecionadas}
                      toggleLinhaSelecionada={toggleLinhaSelecionada}
                      filtroMensal={filtroMensal}
                      setFiltroMensal={setFiltroMensal}
                      dadosOriginais={dados}
                      filtroDia={filtroDia}
                      setFiltroDia={setFiltroDia}
                      handleFiltroMensalChange={handleFiltroMensalChange}
                      obterDiasDoMes={obterDiasDoMes}
                      abrirModalDetalhes={abrirModalDetalhes}
                      getSortIcon={getSortIcon}
                      handleSort={handleSort}
                    />
                  </div>
                )}
              </div>

              {/* Tabela Detalhamento */}
              <TabelaDetalhamento
                dadosOrdenadosParaCards={dadosOrdenadosParaCards}
                linhasSelecionadasAgrupadas={linhasSelecionadasAgrupadas}
                setLinhasSelecionadasAgrupadas={setLinhasSelecionadasAgrupadas}
                sortConfig={sortConfig}
                handleSort={handleSort}
                columnFilters={columnFilters}
                openFilterDropdown={openFilterDropdown}
                toggleFilterDropdown={toggleFilterDropdown}
                handleApplyFilter={handleApplyFilter}
                abrirModalDetalhes={abrirModalDetalhes}
                exportarExcelDetalhamento={exportarExcelDetalhamento}
                onEnviarPagamento={enviarParaPagamento}
                hasRole={hasRole}
                filtroPagamento={filtroPagamento}
                setFiltroPagamento={setFiltroPagamento}
              />
            </>
          )}
        </div>
      </div>

      {/* Modais */}
      <ModaisContasPagar
        modalAberto={modalAberto}
        dadosModal={dadosModal}
        fecharModal={fecharModal}
        modalCardAberto={modalCardAberto}
        tipoCardSelecionado={tipoCardSelecionado}
        dadosCardModal={dadosCardModal}
        fecharModalCard={fecharModalCard}
        getTituloModal={getTituloModal}
        modalBuscaFornecedorAberto={modalBuscaFornecedorAberto}
        setModalBuscaFornecedorAberto={setModalBuscaFornecedorAberto}
        fornecedoresEncontrados={fornecedoresEncontrados}
        selecionarFornecedorBusca={selecionarFornecedorBusca}
        modalDetalhes={modalDetalhes}
        fecharModalDetalhes={fecharModalDetalhes}
      />

      {/* Botão Chat IA */}
      {!chatIAAberto && dadosCarregados && dados.length > 0 && (
        <button
          onClick={() => setChatIAAberto(true)}
          className="fixed bottom-6 right-6 bg-[#000638] text-white p-4 rounded-full shadow-2xl hover:bg-[#fe0000] transition-all duration-300 z-50 group"
          title="Abrir Assistente IA"
        >
          <ChatCircleDots size={28} weight="fill" />
          <span className="absolute -top-10 right-0 bg-gray-900 text-white text-xs px-3 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
            Assistente IA
          </span>
        </button>
      )}

      {/* Chat IA */}
      {chatIAAberto && (
        <ChatContasPagar
          dadosContas={dados}
          resumo={resumoCards}
          filtrosAtivos={`Período: ${dataInicio} a ${dataFim} | Situação: ${situacao}`}
          onClose={() => setChatIAAberto(false)}
        />
      )}
    </div>
  );
};

export default ContasAPagar;
