import React, { useState } from 'react';
import useApiClient from '../hooks/useApiClient';
import LoadingSpinner from '../components/LoadingSpinner';
import FiltroEmpresa from '../components/FiltroEmpresa';
import PageTitle from '../components/ui/PageTitle';
import { TotvsURL } from '../config/constants';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/cards';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  MagnifyingGlass,
  Calendar,
  CurrencyDollar,
  DownloadSimple,
  Receipt,
  CircleNotch,
  IdentificationCard,
  Eye,
  X,
  FileArrowDown,
  CheckCircle,
  Funnel,
  CaretUp,
  CaretDown,
  User,
} from '@phosphor-icons/react';

const ExtratoCredito = () => {
  const apiClient = useApiClient();
  const [dados, setDados] = useState([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  // Estados dos filtros
  const [empresasSelecionadas, setEmpresasSelecionadas] = useState([]);
  const [filtroCliente, setFiltroCliente] = useState('');
  const [tipoDocFiltro, setTipoDocFiltro] = useState('TODOS');
  const [historicoFiltro, setHistoricoFiltro] = useState('TODOS');

  // Estados do modal de detalhes
  const [modalOpen, setModalOpen] = useState(false);
  const [detalhesLoading, setDetalhesLoading] = useState(false);
  const [detalhesFatura, setDetalhesFatura] = useState([]);
  const [itemSelecionado, setItemSelecionado] = useState(null);

  // Estados para observações da movimentação
  const [observacoes, setObservacoes] = useState([]);
  const [observacoesLoading, setObservacoesLoading] = useState(false);

  // Estados para produtos da transação
  const [produtosNF, setProdutosNF] = useState([]);
  const [produtosLoading, setProdutosLoading] = useState(false);
  const [produtosError, setProdutosError] = useState('');

  // Estados para DANFE
  const [danfeLoading, setDanfeLoading] = useState(false);
  const [danfeError, setDanfeError] = useState('');

  // Estados para Boleto
  const [boletoLoading, setBoletoLoading] = useState({}); // Agora é um objeto com loading por nr_fat
  const [boletoError, setBoletoError] = useState('');
  const [boletoBase64, setBoletoBase64] = useState('');
  const [faturaParaBoleto, setFaturaParaBoleto] = useState(null);

  // Estados para saldo de CREDEV e Adiantamento
  const [saldoCredev, setSaldoCredev] = useState(0);
  const [saldoAdiantamento, setSaldoAdiantamento] = useState(0);
  const [loadingSaldo, setLoadingSaldo] = useState(false);

  // Estados para ordenação
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });

  const FranchiseURL =
    'https://apigestaocrosby-bw2v.onrender.com/api/franchise/';

  // Constantes para os filtros
  const TIPOS_DOC = [
    { value: 'TODOS', label: 'Todos' },
    { value: '10', label: 'Adiantamento' },
    { value: '20', label: 'CREDEV' },
  ];

  const HISTORICOS = [
    { value: 'TODOS', label: 'Todos' },
    { value: 'TRANSF_EMP', label: 'TRANSF EMP' },
    { value: 'UTILIZACAO', label: 'UTILIZAÇÃO' },
    { value: 'LANCAMENTO', label: 'LANÇAMENTO' },
    { value: 'CANCEL_CREDEV', label: 'CANCEL CREDEV' },
  ];

  // Função para buscar saldo de CREDEV e Adiantamento
  const buscarSaldoCredito = async () => {
    // Precisa ter empresa OU cliente para buscar saldo
    if (empresasSelecionadas.length === 0 && !filtroCliente.trim()) return;

    setLoadingSaldo(true);
    try {
      console.log('💰 Buscando saldo de crédito...');

      const result = await apiClient.financial.credevAdiantamento();

      if (result.success && result.data) {
        // Montar lista de cd_pessoa para filtrar (empresas + cliente)
        const cdPessoasSelecionadas = [
          ...empresasSelecionadas.map((emp) => emp.cd_pessoa),
          ...(filtroCliente.trim() ? [filtroCliente.trim()] : []),
        ];

        const dadosFiltrados = result.data.filter((item) => {
          const cdPessoa = item.cd_pessoa || item.cd_cliente;
          return cdPessoasSelecionadas.includes(cdPessoa);
        });

        // Calcular saldo de CREDEV
        const totalCredev = dadosFiltrados
          .filter((item) => item.tp_documento === 'CREDEV')
          .reduce((acc, item) => {
            const saldo = parseFloat(item.vl_saldo) || 0;
            return acc + saldo;
          }, 0);

        // Calcular saldo de ADIANTAMENTO
        const totalAdiantamento = dadosFiltrados
          .filter((item) => item.tp_documento === 'ADIANTAMENTO')
          .reduce((acc, item) => {
            const saldo = parseFloat(item.vl_saldo) || 0;
            return acc + saldo;
          }, 0);

        console.log('✅ Saldo calculado:', {
          credev: totalCredev,
          adiantamento: totalAdiantamento,
          total: totalCredev + totalAdiantamento,
        });

        setSaldoCredev(totalCredev);
        setSaldoAdiantamento(totalAdiantamento);
      }
    } catch (error) {
      console.error('❌ Erro ao buscar saldo de crédito:', error);
      setSaldoCredev(0);
      setSaldoAdiantamento(0);
    } finally {
      setLoadingSaldo(false);
    }
  };

  // Função para buscar dados
  const buscarExtrato = async () => {
    // Validar: precisa ter empresa OU cliente
    if (empresasSelecionadas.length === 0 && !filtroCliente.trim()) {
      setErro(
        'Por favor, selecione pelo menos uma empresa ou informe um código de cliente',
      );
      return;
    }

    // Definir datas fixas: início 01/01/1990 e fim hoje
    const dataInicio = '1990-01-01';
    const dataFim = new Date().toISOString().split('T')[0];

    setLoading(true);
    setErro('');
    try {
      // Determinar quais cd_pessoa buscar
      let cdPessoasParaBuscar = [];

      // Se tem filtro de cliente, adiciona ele
      if (filtroCliente.trim()) {
        cdPessoasParaBuscar.push({
          cd_pessoa: filtroCliente.trim(),
          nome: 'Cliente: ' + filtroCliente.trim(),
        });
      }

      // Se tem empresas selecionadas, adiciona elas
      if (empresasSelecionadas.length > 0) {
        cdPessoasParaBuscar = [...cdPessoasParaBuscar, ...empresasSelecionadas];
      }

      // Buscar dados para todos os cd_pessoa (empresas e/ou cliente)
      const todasPromises = cdPessoasParaBuscar.map(async (item) => {
        console.log('🔍 Buscando extrato:', {
          cd_pessoa: item.cd_pessoa,
          dt_inicio: dataInicio,
          dt_fim: dataFim,
        });

        const result = await apiClient.financial.extratoCliente({
          cd_pessoa: item.cd_pessoa,
          dt_inicio: dataInicio,
          dt_fim: dataFim,
        });

        return result;
      });

      const resultados = await Promise.all(todasPromises);

      // Consolidar todos os resultados
      let todosOsDados = [];
      resultados.forEach((result) => {
        if (result.success) {
          // O useApiClient já processa a estrutura aninhada, então result.data já é o array
          const dadosExtrato = Array.isArray(result.data)
            ? result.data
            : result.data?.data || [];

          // Não filtrar nenhum código - mostrar todos
          const dadosFiltrados = dadosExtrato;

          todosOsDados = [...todosOsDados, ...dadosFiltrados];
        }
      });

      if (todosOsDados.length > 0) {
        // Ordenar por data de movimentação em ordem decrescente (mais recente primeiro)
        // Se datas iguais, débito (D) vem antes de crédito (C)
        // EXCETO: se for par CTA ORI/CTA DEST com mesmo valor, CTA ORI vem primeiro
        const dadosOrdenados = [...todosOsDados].sort((a, b) => {
          const dataA = new Date(a.dt_movim);
          const dataB = new Date(b.dt_movim);

          // Primeiro ordena por data (decrescente)
          if (dataB - dataA !== 0) {
            return dataB - dataA;
          }

          // Regra especial: se mesma data e mesmo valor, verificar se é par CTA ORI/CTA ORIG/CTA DEST
          if (a.vl_lancto === b.vl_lancto) {
            const isACtaOri =
              a.ds_aux?.startsWith('CTA ORI') ||
              a.ds_aux?.startsWith('CTA ORIG');
            const isACtaDest = a.ds_aux?.startsWith('CTA DEST');
            const isBCtaOri =
              b.ds_aux?.startsWith('CTA ORI') ||
              b.ds_aux?.startsWith('CTA ORIG');
            const isBCtaDest = b.ds_aux?.startsWith('CTA DEST');

            // Se A é CTA ORI/ORIG e B é CTA DEST, A vem primeiro
            if (isACtaOri && isBCtaDest) return -1;
            // Se A é CTA DEST e B é CTA ORI/ORIG, B vem primeiro
            if (isACtaDest && isBCtaOri) return 1;
          }

          // Se datas iguais, ordena por tipo de operação (D antes de C)
          if (a.tp_operacao === 'D' && b.tp_operacao === 'C') return -1;
          if (a.tp_operacao === 'C' && b.tp_operacao === 'D') return 1;

          return 0;
        });

        console.log('✅ Extrato consolidado recebido:', {
          total: dadosOrdenados.length,
          empresas: empresasSelecionadas.length,
          primeiroItem: dadosOrdenados[0],
        });
        setDados(dadosOrdenados);
      } else {
        setDados([]);
      }

      // Buscar saldo de crédito após buscar extrato
      await buscarSaldoCredito();
    } catch (err) {
      console.error('❌ Erro ao buscar extrato:', err);
      setErro('Erro ao carregar dados do servidor.');
      setDados([]);
    } finally {
      setLoading(false);
    }
  };

  const formatarDataBR = (data) => {
    if (!data) return '-';
    const d = new Date(data);
    if (isNaN(d)) return '-';

    // Ajustar para ignorar fuso horário e mostrar a data correta
    const dataLocal = new Date(d.getTime() + d.getTimezoneOffset() * 60000);
    return dataLocal.toLocaleDateString('pt-BR');
  };

  const formatarMoeda = (valor) => {
    if (valor === null || valor === undefined) return '-';
    return Number(valor).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
  };

  // Função para obter dados ordenados e filtrados
  const getSortedData = () => {
    let dadosFiltrados = [...dados];

    // Filtro por Tipo de Documento
    if (tipoDocFiltro !== 'TODOS') {
      dadosFiltrados = dadosFiltrados.filter(
        (item) => item.tp_documento === tipoDocFiltro,
      );
    }

    // Filtro por Código Histórico
    if (historicoFiltro !== 'TODOS') {
      dadosFiltrados = dadosFiltrados.filter((item) => {
        const cdHistorico = item.cd_historico;

        switch (historicoFiltro) {
          case 'TRANSF_EMP':
            return cdHistorico === '888' || cdHistorico === '889';
          case 'UTILIZACAO':
            return cdHistorico === '901';
          case 'LANCAMENTO':
            return (
              cdHistorico === '6' ||
              cdHistorico === '699' ||
              cdHistorico === '900' ||
              cdHistorico === '1075'
            );
          case 'CANCEL_CREDEV':
            return cdHistorico === '1144' || cdHistorico === '1250';
          default:
            return true;
        }
      });
    }

    // Ordenação
    if (!sortConfig.key) return dadosFiltrados;

    const sortedData = [...dadosFiltrados].sort((a, b) => {
      let aValue = a[sortConfig.key];
      let bValue = b[sortConfig.key];

      // Tratamento especial para valores nulos/undefined
      if (aValue === null || aValue === undefined) aValue = '';
      if (bValue === null || bValue === undefined) bValue = '';

      // Tratamento especial para datas
      if (sortConfig.key === 'dt_movim' || sortConfig.key === 'dt_liquidacao') {
        aValue = new Date(aValue).getTime() || 0;
        bValue = new Date(bValue).getTime() || 0;
      }
      // Tratamento especial para valores monetários
      else if (sortConfig.key === 'vl_lanc') {
        aValue = parseFloat(aValue) || 0;
        bValue = parseFloat(bValue) || 0;
      }
      // Tratamento para strings
      else if (typeof aValue === 'string') {
        aValue = aValue.toLowerCase();
        bValue = bValue.toLowerCase();
      }

      if (aValue < bValue) {
        return sortConfig.direction === 'asc' ? -1 : 1;
      }
      if (aValue > bValue) {
        return sortConfig.direction === 'asc' ? 1 : -1;
      }
      return 0;
    });

    return sortedData;
  };

  const dadosOrdenados = getSortedData();

  // Função para formatar ds_aux
  const formatarDsAux = (ds_aux, cd_historico) => {
    // Regras baseadas em cd_historico
    if (cd_historico === '900' || cd_historico === '1075') {
      return 'LANÇAMENTO DE CRÉDITO';
    }
    if (cd_historico === '901') {
      return 'UTILIZAÇÃO DE CRÉDITO';
    }

    if (!ds_aux) return '-';

    let texto = ds_aux;

    // Substituir CTA DEST, CTA ORI ou CTA ORIG por TRANSFERÊNCIA DE CRÉDITO
    if (
      texto.startsWith('CTA DEST') ||
      texto.startsWith('CTA ORI') ||
      texto.startsWith('CTA ORIG')
    ) {
      return 'TRANSFERÊNCIA DE CRÉD';
    }

    return texto;
  };

  // Calcular totalizadores com base nos dados filtrados
  const saldoTotal = dadosOrdenados.reduce(
    (acc, item) => acc + (Number(item.vl_lancto) || 0),
    0,
  );
  const totalDebito = dadosOrdenados
    .filter((item) => item.tp_operacao === 'D')
    .reduce((acc, item) => acc + (Number(item.vl_lancto) || 0), 0);
  const totalCredito = dadosOrdenados
    .filter((item) => item.tp_operacao === 'C')
    .reduce((acc, item) => acc + (Number(item.vl_lancto) || 0), 0);

  // Função auxiliar para formatar histórico
  // Função para exportar dados para Excel
  const handleExportExcel = () => {
    if (dados.length === 0) {
      alert('Não há dados para exportar!');
      return;
    }

    try {
      const dadosParaExportar = dados.map((item) => ({
        Data: formatarDataBR(item.dt_movim),
        'NR CTAPES': item.nr_ctapes || '',
        'Seq Mov': item.nr_seqmov || '',
        'Cod Histórico': item.cd_historico || '',
        Descrição: formatarDsAux(item.ds_aux, item.cd_historico),
        'Tipo Doc':
          item.tp_documento === '10'
            ? 'ADIANTAMENTO'
            : item.tp_documento === '20'
            ? 'CREDEV'
            : item.tp_documento || '',
        Operação: item.tp_operacao === 'D' ? 'Débito' : 'Crédito',
        'Valor Lançamento': Number(item.vl_lancto) || 0,
        'Data Liquidação': formatarDataBR(item.dt_liq),
        'Nome Fantasia': item.nm_fantasia || '',
        Empresa: item.cd_empresa || '',
      }));

      const ws = XLSX.utils.json_to_sheet(dadosParaExportar);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Extrato Cliente');

      const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const data = new Blob([excelBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

      const hoje = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
      const nomeArquivo = `extrato-credito-${hoje}.xlsx`;

      saveAs(data, nomeArquivo);

      console.log('✅ Excel exportado com sucesso:', nomeArquivo);
    } catch (error) {
      console.error('❌ Erro ao exportar Excel:', error);
      alert('Erro ao exportar arquivo Excel. Tente novamente.');
    }
  };

  // Função para exportar dados para PDF
  const handleExportPDF = () => {
    if (dadosOrdenados.length === 0) {
      alert('Não há dados para exportar!');
      return;
    }

    try {
      const doc = new jsPDF('l', 'mm', 'a4'); // landscape orientation

      // Título do documento
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('Extrato de Crédito', 14, 15);

      // Data de geração
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      const dataGeracao = new Date().toLocaleString('pt-BR');
      doc.text(`Gerado em: ${dataGeracao}`, 14, 22);

      // Informações de filtros aplicados
      let yPos = 28;
      if (empresasSelecionadas.length > 0) {
        const empresasNomes = empresasSelecionadas
          .map((e) => e.nm_fantasia)
          .join(', ');
        doc.text(`Empresas: ${empresasNomes}`, 14, yPos);
        yPos += 5;
      }
      if (tipoDocFiltro !== 'TODOS') {
        const tipoDocLabel =
          TIPOS_DOC.find((t) => t.value === tipoDocFiltro)?.label ||
          tipoDocFiltro;
        doc.text(`Tipo DOC: ${tipoDocLabel}`, 14, yPos);
        yPos += 5;
      }
      if (historicoFiltro !== 'TODOS') {
        const historicoLabel =
          HISTORICOS.find((h) => h.value === historicoFiltro)?.label ||
          historicoFiltro;
        doc.text(`Histórico: ${historicoLabel}`, 14, yPos);
        yPos += 5;
      }

      // Preparar dados para a tabela
      const tableData = dadosOrdenados.map((item) => [
        formatarDataBR(item.dt_movim),
        item.cd_empresa || '-',
        item.nr_ctapes || '-',
        item.nr_seqmov || '-',
        item.cd_historico || '-',
        formatarDsAux(item.ds_aux, item.cd_historico),
        item.tp_documento === '10'
          ? 'ADIANTAMENTO'
          : item.tp_documento === '20'
          ? 'CREDEV'
          : item.tp_documento || '-',
        item.tp_operacao === 'D' ? 'Débito' : 'Crédito',
        formatarMoeda(item.vl_lancto),
        formatarDataBR(item.dt_liq),
      ]);

      // Criar a tabela
      autoTable(doc, {
        startY: yPos + 5,
        head: [
          [
            'Data Movim',
            'Empresa',
            'Conta',
            'Seq Mov',
            'Cód Hist',
            'Descrição',
            'Tipo Doc',
            'Operação',
            'Valor',
            'Data Liq',
          ],
        ],
        body: tableData,
        styles: {
          fontSize: 8,
          cellPadding: 2,
        },
        headStyles: {
          fillColor: [0, 6, 56], // cor #000638
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          halign: 'center',
        },
        columnStyles: {
          0: { halign: 'center', cellWidth: 20 }, // Data Movim
          1: { halign: 'center', cellWidth: 15 }, // Empresa
          2: { halign: 'center', cellWidth: 15 }, // Conta
          3: { halign: 'center', cellWidth: 15 }, // Seq Mov
          4: { halign: 'center', cellWidth: 18 }, // Cód Hist
          5: { halign: 'left', cellWidth: 35 }, // Descrição
          6: { halign: 'left', cellWidth: 28 }, // Tipo Doc
          7: { halign: 'center', cellWidth: 20 }, // Operação
          8: { halign: 'right', cellWidth: 28 }, // Valor
          9: { halign: 'center', cellWidth: 20 }, // Data Liq
        },
        alternateRowStyles: {
          fillColor: [245, 245, 245],
        },
        margin: { top: 10 },
      });

      // Adicionar rodapé com totalizadores
      const finalY =
        doc.lastAutoTable?.finalY || doc.previousAutoTable?.finalY || yPos + 10;
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');

      // Criar duas colunas de informações
      const col1X = 14;
      const col2X = 150;

      // Coluna 1: Movimentações do período
      doc.text('MOVIMENTAÇÕES DO PERÍODO:', col1X, finalY + 10);
      doc.setFont('helvetica', 'normal');
      doc.text(
        `Total Débito: ${formatarMoeda(totalDebito)}`,
        col1X,
        finalY + 16,
      );
      doc.text(
        `Total Crédito: ${formatarMoeda(totalCredito)}`,
        col1X,
        finalY + 22,
      );
      doc.text(
        `Diferença: ${formatarMoeda(totalCredito - totalDebito)}`,
        col1X,
        finalY + 28,
      );
      doc.text(
        `Total de registros: ${dadosOrdenados.length}`,
        col1X,
        finalY + 34,
      );

      // Coluna 2: Saldos disponíveis
      doc.setFont('helvetica', 'bold');
      doc.text('SALDOS DISPONÍVEIS:', col2X, finalY + 10);
      doc.setFont('helvetica', 'normal');
      doc.text(
        `Saldo CREDEV: ${formatarMoeda(saldoCredev)}`,
        col2X,
        finalY + 16,
      );
      doc.text(
        `Saldo Adiantamento: ${formatarMoeda(saldoAdiantamento)}`,
        col2X,
        finalY + 22,
      );
      doc.setFont('helvetica', 'bold');
      doc.text(
        `Saldo Total: ${formatarMoeda(saldoCredev + saldoAdiantamento)}`,
        col2X,
        finalY + 28,
      );

      // Salvar o PDF
      const hoje = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
      const nomeArquivo = `extrato-credito-${hoje}.pdf`;
      doc.save(nomeArquivo);

      console.log('✅ PDF exportado com sucesso:', nomeArquivo);
    } catch (error) {
      console.error('❌ Erro ao exportar PDF:', error);
      alert('Erro ao exportar arquivo PDF. Tente novamente.');
    }
  };

  // Função para abrir modal e buscar detalhes
  const handleDetalhar = async (item) => {
    setItemSelecionado(item);
    setModalOpen(true);
    setDetalhesLoading(true);
    setDetalhesFatura([]);
    setObservacoes([]);

    // Buscar observações da movimentação
    if (item.nr_ctapes && item.nr_seqmov) {
      setObservacoesLoading(true);
      try {
        console.log('📝 Buscando observações da movimentação:', {
          nr_ctapes: item.nr_ctapes,
          nr_seqmov: item.nr_seqmov,
        });

        const obsResult = await apiClient.financial.obsMov({
          nr_ctapes: item.nr_ctapes,
          nr_seqmov: item.nr_seqmov,
        });

        if (obsResult.success) {
          const obs = Array.isArray(obsResult.data)
            ? obsResult.data
            : obsResult.data?.data || [];
          console.log('✅ Observações recebidas:', obs.length);
          setObservacoes(obs);
        } else {
          console.warn('⚠️ Nenhuma observação encontrada');
          setObservacoes([]);
        }
      } catch (error) {
        console.error('❌ Erro ao buscar observações:', error);
        setObservacoes([]);
      } finally {
        setObservacoesLoading(false);
      }
    }

    // Buscar produtos da transação se for lançamento de crédito CREDEV e tiver ds_doc
    const isLancamentoCredevCredito =
      item.tp_operacao === 'C' && item.tp_documento === '20';

    if (isLancamentoCredevCredito && item.ds_doc) {
      // Usar ds_doc como nr_transacao para buscar produtos
      const nrTransacao = parseInt(item.ds_doc);
      if (!isNaN(nrTransacao)) {
        console.log('🔍 Buscando produtos da transação CREDEV:', nrTransacao);
        await buscarProdutosNF(nrTransacao);
      }
    }

    try {
      // Verificar se é transferência entre empresas (códigos 888 ou 889)
      const isTransferenciaEmpresa =
        item.cd_historico === '888' || item.cd_historico === '889';

      if (isTransferenciaEmpresa) {
        // Para transferências entre empresas, não buscar detalhes
        // O modal mostrará apenas a mensagem
        setDetalhesFatura([]);
        setDetalhesLoading(false);
        return;
      }

      // Verificar se é operação de crédito (C) e tipo documento ADIANTAMENTO (10)
      const isCreditoAdiantamento =
        item.tp_operacao === 'C' && item.tp_documento === '10';

      // Verificar se é LANÇAMENTO CREDEV com data de liquidação
      const isLancamentoCredevComLiquidacao =
        item.tp_operacao === 'C' &&
        item.tp_documento === '20' &&
        item.dt_liq &&
        item.dt_liq !== null &&
        item.dt_liq !== '';

      if (isCreditoAdiantamento) {
        // Usar rota lanc-ext-adiant para crédito de adiantamento
        console.log('🔍 Buscando lançamentos de adiantamento:', {
          cd_cliente: item.cd_pessoa,
          dt_emissao: item.dt_movim.split('T')[0],
          cd_empresa: item.cd_empresa,
        });

        const result = await apiClient.financial.lancExtAdiant({
          cd_cliente: item.cd_pessoa,
          dt_emissao: item.dt_movim.split('T')[0],
          cd_empresa: item.cd_empresa,
        });

        if (result.success) {
          const detalhes = Array.isArray(result.data)
            ? result.data
            : result.data?.data || [];
          console.log(
            '✅ Lançamentos de adiantamento recebidos:',
            detalhes.length,
          );
          setDetalhesFatura(detalhes);
        } else {
          console.error('❌ Erro ao buscar lançamentos:', result.message);
          setDetalhesFatura([]);
        }
      } else if (isLancamentoCredevComLiquidacao) {
        // NOVA LÓGICA: Buscar transação através da tabela fgr_liqitemcr
        const dataLiquidacao = item.dt_liq.split('T')[0];
        console.log(
          '🔍 Buscando transação do lançamento CREDEV via fgr_liqitemcr:',
          {
            cd_pessoa: item.cd_pessoa,
            dt_liquidacao: dataLiquidacao,
            cd_empresa: item.cd_empresa,
            valor: item.vl_lancto,
          },
        );

        // Primeiro, buscar detalhes da fatura para obter o nr_fat
        const faturaResult = await apiClient.financial.faturaExtCliente({
          cd_cliente: item.cd_pessoa,
          vl_fatura: item.vl_lancto,
        });

        if (faturaResult.success) {
          const faturas = Array.isArray(faturaResult.data)
            ? faturaResult.data
            : faturaResult.data?.data || [];

          console.log('📋 Faturas encontradas:', faturas.length);

          if (faturas.length > 0) {
            // Pegar a primeira fatura
            const fatura = faturas[0];
            console.log('📄 Fatura selecionada:', {
              cd_cliente: fatura.cd_cliente,
              nr_fat: fatura.nr_fat,
              dt_movimfcc: dataLiquidacao,
            });

            // Buscar transação através da tabela fgr_liqitemcr
            const transacaoResult =
              await apiClient.financial.transacaoFaturaCredev({
                cd_cliente: fatura.cd_cliente,
                nr_fat: fatura.nr_fat,
                dt_movimfcc: dataLiquidacao,
              });

            if (
              transacaoResult.success &&
              transacaoResult.data &&
              transacaoResult.data.length > 0
            ) {
              const transacao = transacaoResult.data[0];
              console.log('🎯 Transação encontrada:', transacao);

              // Buscar produtos da transação
              if (transacao.nr_transacao) {
                await buscarProdutosNF(transacao.nr_transacao);
              }

              // Não precisa buscar detalhes de fatura, apenas mostrar os produtos
              setDetalhesFatura([]);
            } else {
              console.warn('⚠️ Nenhuma transação encontrada via fgr_liqitemcr');
              setDetalhesFatura([]);
            }
          } else {
            console.warn('⚠️ Nenhuma fatura encontrada para buscar transação');
            setDetalhesFatura([]);
          }
        } else {
          console.error('❌ Erro ao buscar fatura:', faturaResult.message);
          setDetalhesFatura([]);
        }
      } else {
        // Usar rota original fatura-ext-cliente para débito
        console.log('🔍 Buscando detalhes da fatura:', {
          cd_cliente: item.cd_pessoa,
          vl_fatura: item.vl_lancto,
        });

        const result = await apiClient.financial.faturaExtCliente({
          cd_cliente: item.cd_pessoa,
          vl_fatura: item.vl_lancto,
        });

        if (result.success) {
          const detalhes = Array.isArray(result.data)
            ? result.data
            : result.data?.data || [];
          console.log('✅ Detalhes da fatura recebidos:', detalhes.length);
          setDetalhesFatura(detalhes);
        } else {
          console.error('❌ Erro ao buscar detalhes:', result.message);
          setDetalhesFatura([]);
        }
      }
    } catch (error) {
      console.error('❌ Erro ao buscar detalhes:', error);
      setDetalhesFatura([]);
    } finally {
      setDetalhesLoading(false);
    }
  };

  // Função para fechar modal
  const handleCloseModal = () => {
    setModalOpen(false);
    setItemSelecionado(null);
    setDetalhesFatura([]);
    setProdutosNF([]);
    setObservacoes([]);
  };

  // Função para buscar produtos da nota fiscal
  const buscarProdutosNF = async (nr_transacao) => {
    try {
      setProdutosLoading(true);
      setProdutosError('');
      setProdutosNF([]);

      console.log('🔍 Buscando produtos da NF:', nr_transacao);

      const response = await fetch(
        `${FranchiseURL}detalhenf?nr_transacao=${nr_transacao}`,
      );

      if (!response.ok) {
        throw new Error('Erro ao buscar produtos da nota fiscal');
      }

      const data = await response.json();
      console.log('✅ Produtos da NF recebidos:', data);

      if (data.success && data.data && data.data.data) {
        setProdutosNF(data.data.data);
        console.log(`✅ ${data.data.data.length} produtos encontrados`);
      } else {
        setProdutosNF([]);
      }
    } catch (error) {
      console.error('❌ Erro ao buscar produtos:', error);
      setProdutosError(
        error.message || 'Erro ao buscar produtos da nota fiscal',
      );
      setProdutosNF([]);
    } finally {
      setProdutosLoading(false);
    }
  };

  // Função para gerar DANFE a partir da transação
  const gerarDanfeTransacao = async (detalhe) => {
    try {
      setDanfeLoading(true);
      setDanfeError('');

      console.log('🔍 Gerando DANFE da transação:', detalhe);

      const cd_pessoa = parseInt(itemSelecionado?.cd_pessoa) || 0;

      // Função auxiliar para tentar gerar DANFE
      const tentarGerarDanfe = async (
        cd_empresa,
        nr_transacao,
        dataTransacao,
        tipo,
      ) => {
        const payload = {
          filter: {
            branchCodeList: [cd_empresa],
            personCodeList: [cd_pessoa],
            transactionBranchCode: cd_empresa,
            transactionCode: nr_transacao,
            transactionDate: dataTransacao,
          },
        };

        console.log(`📤 Tentativa ${tipo} - Payload DANFE:`, payload);

        const response = await fetch(`${TotvsURL}danfe-from-invoice`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || 'Erro ao gerar DANFE');
        }

        const data = await response.json();
        console.log(`✅ DANFE recebida (${tipo}):`, data);

        let base64 = '';
        if (data.success && data.data) {
          base64 = data.data.danfePdfBase64 || data.data.base64 || '';
        } else if (data.danfePdfBase64) {
          base64 = data.danfePdfBase64;
        }

        if (!base64) {
          throw new Error('DANFE não retornada pela API');
        }

        return { base64, nr_transacao };
      };

      // Tentativa 1: Empresa DESTINO com NR_TRANSACAODEST
      let resultado = null;
      let erroDestino = null;

      if (
        detalhe.cd_empresadest &&
        detalhe.nr_transacaodest &&
        detalhe.dt_transacaodest
      ) {
        try {
          console.log('🔄 Tentativa 1: EMPRESA DESTINO + NR_TRANSACAODEST');
          const cd_empresadest = parseInt(detalhe.cd_empresadest);
          const nr_transacaodest = parseInt(detalhe.nr_transacaodest);
          const dataTransacaodest = detalhe.dt_transacaodest.split('T')[0];

          resultado = await tentarGerarDanfe(
            cd_empresadest,
            nr_transacaodest,
            dataTransacaodest,
            'DESTINO',
          );
        } catch (error) {
          erroDestino = error;
          console.warn('⚠️ Tentativa DESTINO falhou:', error.message);
        }
      }

      // Tentativa 2: Empresa ORIGEM com NR_TRANSACAOORI (se a primeira falhou)
      if (
        !resultado &&
        detalhe.cd_empresaori &&
        detalhe.nr_transacaoori &&
        detalhe.dt_transacaoori
      ) {
        try {
          console.log('🔄 Tentativa 2: EMPRESA ORIGEM + NR_TRANSACAOORI');
          const cd_empresaori = parseInt(detalhe.cd_empresaori);
          const nr_transacaoori = parseInt(detalhe.nr_transacaoori);
          const dataTransacaoori = detalhe.dt_transacaoori.split('T')[0];

          resultado = await tentarGerarDanfe(
            cd_empresaori,
            nr_transacaoori,
            dataTransacaoori,
            'ORIGEM',
          );
        } catch (error) {
          console.error('❌ Tentativa ORIGEM também falhou:', error.message);
          throw new Error(
            `Não foi possível gerar DANFE. Erro DESTINO: ${
              erroDestino?.message || 'N/A'
            }. Erro ORIGEM: ${error.message}`,
          );
        }
      }

      // Se não conseguiu por nenhum dos métodos
      if (!resultado) {
        throw new Error(
          erroDestino?.message ||
            'Dados da transação incompletos para gerar DANFE',
        );
      }

      // Abrir o PDF
      abrirPDFDanfe(resultado.base64, resultado.nr_transacao);
    } catch (error) {
      console.error('❌ Erro ao gerar DANFE:', error);
      setDanfeError(error.message || 'Erro ao gerar DANFE');
      alert(`Erro ao gerar DANFE: ${error.message}`);
    } finally {
      setDanfeLoading(false);
    }
  };

  // Função para abrir PDF da DANFE em nova aba
  const abrirPDFDanfe = (base64String, nrTransacao) => {
    try {
      const base64 = base64String.replace(/^data:application\/pdf;base64,/, '');
      const binaryString = window.atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);

      const newWindow = window.open(url, '_blank');

      if (newWindow) {
        console.log('✅ DANFE aberta em nova aba');
        setTimeout(() => {
          window.URL.revokeObjectURL(url);
        }, 1000);
      } else {
        console.warn('⚠️ Popup bloqueado, iniciando download...');
        const link = document.createElement('a');
        link.href = url;
        link.download = `danfe-transacao-${nrTransacao}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('❌ Erro ao abrir DANFE:', error);
      alert('Erro ao abrir a DANFE. Tente novamente.');
    }
  };

  // Função para buscar boleto bancário
  const buscarBoleto = async (fatura) => {
    if (!fatura) return;

    const faturaId = `${fatura.nr_fat}-${fatura.nr_parcela}`;

    try {
      // Ativar loading apenas para esta fatura específica
      setBoletoLoading((prev) => ({ ...prev, [faturaId]: true }));
      setBoletoError('');
      setBoletoBase64('');
      setFaturaParaBoleto(fatura);

      const payload = {
        branchCode: parseInt(itemSelecionado.cd_empresa) || 0,
        customerCode: itemSelecionado?.cd_pessoa || '',
        receivableCode: parseInt(fatura.nr_fat) || 0,
        installmentNumber: parseInt(fatura.nr_parcela) || 0,
      };

      console.log('🔍 Buscando boleto com os dados:', payload);

      const response = await fetch(`${TotvsURL}bank-slip`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Erro ao buscar boleto');
      }

      const data = await response.json();
      console.log('✅ Boleto recebido:', data);

      // O boleto pode vir em diferentes formatos
      let base64 = '';

      if (typeof data === 'string') {
        base64 = data;
      } else if (data.data && data.data.base64) {
        if (typeof data.data.base64 === 'string') {
          base64 = data.data.base64;
        } else if (data.data.base64.content) {
          base64 = data.data.base64.content;
        }
      } else if (data.data && typeof data.data === 'string') {
        base64 = data.data;
      } else if (data.base64) {
        if (typeof data.base64 === 'string') {
          base64 = data.base64;
        } else if (data.base64.content) {
          base64 = data.base64.content;
        }
      }

      if (base64 && typeof base64 === 'string') {
        setBoletoBase64(base64);
        console.log('✅ Base64 do boleto:', base64.substring(0, 100) + '...');
        console.log('📏 Tamanho do base64:', base64.length, 'caracteres');

        // Converter base64 para PDF e abrir em nova aba
        abrirPDF(base64, fatura);
      } else {
        console.error('❌ Formato de resposta inválido:', data);
        throw new Error('Formato de resposta inválido - base64 não encontrado');
      }
    } catch (error) {
      console.error('❌ Erro ao buscar boleto:', error);
      setBoletoError(error.message || 'Erro ao buscar boleto');
      alert(`Erro ao gerar boleto: ${error.message}`);
    } finally {
      // Desativar loading apenas para esta fatura específica
      setBoletoLoading((prev) => ({ ...prev, [faturaId]: false }));
    }
  };

  // Função para abrir PDF do boleto em nova aba
  const abrirPDF = (base64String, fatura) => {
    try {
      const base64 = base64String.replace(/^data:application\/pdf;base64,/, '');
      const binaryString = window.atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);

      const newWindow = window.open(url, '_blank');

      if (newWindow) {
        console.log('✅ Boleto aberto em nova aba');
        setTimeout(() => {
          window.URL.revokeObjectURL(url);
        }, 1000);
      } else {
        console.warn('⚠️ Popup bloqueado, iniciando download...');
        const link = document.createElement('a');
        link.href = url;
        link.download = `boleto-${fatura?.nr_fat || 'fatura'}-parcela-${
          fatura?.nr_parcela || '1'
        }.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('❌ Erro ao abrir boleto:', error);
      alert('Erro ao abrir o boleto. Tente novamente.');
    }
  };

  // Função para ordenar os dados
  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  return (
    <div className="w-full max-w-7xl mx-auto flex flex-col items-stretch justify-start py-3 px-2">
      <PageTitle
        title="Extrato de Crédito"
        subtitle="Consulte o extrato de crédito da sua franquia"
        icon={CurrencyDollar}
        iconColor="text-green-600"
      />

      {/* Formulário de Filtros */}
      <div className="mb-4">
        <div className="flex flex-col bg-white p-3 rounded-lg shadow-md w-full max-w-7xl mx-auto border border-[#000638]/10">
          <div className="mb-2">
            <span className="text-lg font-bold text-[#000638] flex items-center gap-1">
              <Funnel size={18} weight="bold" />
              Filtros
            </span>
            <span className="text-xs text-gray-500 mt-1">
              Selecione a empresa e período para consulta
            </span>
          </div>

          {erro && (
            <div className="mb-3 bg-red-100 border border-red-300 text-red-700 px-3 py-2 rounded-lg text-sm">
              {erro}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 mb-3">
            {/* Filtro de Empresa */}
            <div>
              <FiltroEmpresa
                empresasSelecionadas={empresasSelecionadas}
                onSelectEmpresas={setEmpresasSelecionadas}
              />
            </div>

            {/* Filtro de Cliente (CD Pessoa) */}
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                <span className="flex items-center gap-1">
                  <User size={12} weight="bold" />
                  Código Cliente
                </span>
              </label>
              <input
                type="text"
                value={filtroCliente}
                onChange={(e) => setFiltroCliente(e.target.value)}
                placeholder="Ex: 12345"
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs placeholder:text-gray-400"
              />
            </div>

            {/* Filtro Tipo DOC */}
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Tipo DOC
              </label>
              <select
                value={tipoDocFiltro}
                onChange={(e) => setTipoDocFiltro(e.target.value)}
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
              >
                {TIPOS_DOC.map((tipo) => (
                  <option key={tipo.value} value={tipo.value}>
                    {tipo.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Filtro Histórico */}
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Histórico
              </label>
              <select
                value={historicoFiltro}
                onChange={(e) => setHistoricoFiltro(e.target.value)}
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
              >
                {HISTORICOS.map((hist) => (
                  <option key={hist.value} value={hist.value}>
                    {hist.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Botão Buscar */}
            <div className="flex items-center">
              <label className="block text-xs font-semibold mb-0.5 text-transparent">
                Buscar
              </label>
              <button
                onClick={buscarExtrato}
                disabled={loading}
                className="flex items-center gap-1 bg-[#000638] text-white px-3 py-1 rounded-lg hover:bg-[#fe0000] disabled:opacity-50 disabled:cursor-not-allowed transition-colors h-7 text-xs font-bold shadow-md tracking-wide uppercase justcify-center"
              >
                <MagnifyingGlass
                  size={10}
                  weight="bold"
                  className={loading ? 'animate-pulse' : ''}
                />
                <span>Buscar</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Cards de Saldo de Crédito */}
      {(empresasSelecionadas.length > 0 || filtroCliente.trim()) && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-2 mb-6 max-w-7xl mx-auto">
          {/* Saldo CREDEV */}
          <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <CurrencyDollar size={14} className="text-blue-600" />
                <CardTitle className="text-xs font-bold text-blue-700">
                  Saldo CREDEV
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-2 pb-2">
              {loadingSaldo ? (
                <div className="text-xs text-gray-500">Carregando...</div>
              ) : (
                <>
                  <div className="text-sm font-extrabold text-blue-600 mb-0.5 break-words">
                    {formatarMoeda(saldoCredev)}
                  </div>
                  <CardDescription className="text-xs text-gray-500">
                    Saldo disponível em CREDEV
                  </CardDescription>
                </>
              )}
            </CardContent>
          </Card>

          {/* Saldo Adiantamento */}
          <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <CurrencyDollar size={14} className="text-purple-600" />
                <CardTitle className="text-xs font-bold text-purple-700">
                  Saldo Adiantamento
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-2 pb-2">
              {loadingSaldo ? (
                <div className="text-xs text-gray-500">Carregando...</div>
              ) : (
                <>
                  <div className="text-sm font-extrabold text-purple-600 mb-0.5 break-words">
                    {formatarMoeda(saldoAdiantamento)}
                  </div>
                  <CardDescription className="text-xs text-gray-500">
                    Saldo disponível em adiantamento
                  </CardDescription>
                </>
              )}
            </CardContent>
          </Card>

          {/* Saldo Total */}
          <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <CurrencyDollar size={14} className="text-green-600" />
                <CardTitle className="text-xs font-bold text-green-700">
                  Saldo Total
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-2 pb-2">
              {loadingSaldo ? (
                <div className="text-xs text-gray-500">Carregando...</div>
              ) : (
                <>
                  <div className="text-sm font-extrabold text-green-600 mb-0.5 break-words">
                    {formatarMoeda(saldoCredev + saldoAdiantamento)}
                  </div>
                  <CardDescription className="text-xs text-gray-500">
                    Saldo total de crédito
                  </CardDescription>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Cards de Movimentações do Extrato */}
      {dados.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-2 mb-6 max-w-7xl mx-auto">
          {/* Total Débito */}
          <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <CurrencyDollar size={14} className="text-red-600" />
                <CardTitle className="text-xs font-bold text-red-700">
                  Total Débito
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-2 pb-2">
              <div className="text-sm font-extrabold text-red-600 mb-0.5 break-words">
                {formatarMoeda(totalDebito)}
              </div>
              <CardDescription className="text-xs text-gray-500">
                Valor total debitado no período
              </CardDescription>
            </CardContent>
          </Card>

          {/* Total Crédito */}
          <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <CurrencyDollar size={14} className="text-green-600" />
                <CardTitle className="text-xs font-bold text-green-700">
                  Total Crédito
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-2 pb-2">
              <div className="text-sm font-extrabold text-green-600 mb-0.5 break-words">
                {formatarMoeda(totalCredito)}
              </div>
              <CardDescription className="text-xs text-gray-500">
                Valor total creditado no período
              </CardDescription>
            </CardContent>
          </Card>

          {/* Diferença (Saldo do Período) */}
          <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <CurrencyDollar size={14} className="text-orange-600" />
                <CardTitle className="text-xs font-bold text-orange-700">
                  Diferença
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-2 pb-2">
              <div
                className={`text-sm font-extrabold mb-0.5 break-words ${
                  totalCredito - totalDebito >= 0
                    ? 'text-green-600'
                    : 'text-red-600'
                }`}
              >
                {formatarMoeda(totalCredito - totalDebito)}
              </div>
              <CardDescription className="text-xs text-gray-500">
                Crédito - Débito do período
              </CardDescription>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabela */}
      <div className="bg-white rounded-lg shadow-md border border-[#000638]/10 max-w-7xl mx-auto w-full">
        <div className="p-3 border-b border-[#000638]/10 flex justify-between items-center">
          <h2 className="text-sm font-bold text-[#000638] font-barlow">
            Extrato de Crédito
          </h2>
          <div className="flex items-center gap-2">
            <div className="text-xs text-gray-600">
              {dados.length > 0
                ? `${dados.length} registros encontrados`
                : 'Nenhum dado carregado'}
            </div>
            {dados.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleExportExcel}
                  className="flex items-center gap-1 bg-green-600 text-white px-2 py-1 rounded-lg hover:bg-green-700 transition-colors font-medium text-xs"
                >
                  <FileArrowDown size={12} />
                  EXCEL
                </button>
                <button
                  onClick={handleExportPDF}
                  className="flex items-center gap-1 bg-red-600 text-white px-2 py-1 rounded-lg hover:bg-red-700 transition-colors font-medium text-xs"
                >
                  <FileArrowDown size={12} />
                  PDF
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="p-3">
          <div className="max-w-[350px] md:max-w-[700px] lg:max-w-[900px] xl:max-w-[1100px] 2xl:max-w-[1300px] mx-auto overflow-x-auto">
            <table className="border-collapse rounded-lg overflow-hidden shadow-lg extrato-table min-w-full">
              <thead className="bg-[#000638]">
                <tr>
                  <th
                    className="px-3 py-3 text-left text-xs font-medium text-white uppercase tracking-wider cursor-pointer hover:bg-[#000850] transition-colors"
                    onClick={() => handleSort('dt_movim')}
                  >
                    <div className="flex items-center gap-1">
                      Data Movim
                      {sortConfig.key === 'dt_movim' &&
                        (sortConfig.direction === 'asc' ? (
                          <CaretUp size={12} />
                        ) : (
                          <CaretDown size={12} />
                        ))}
                    </div>
                  </th>
                  <th
                    className="px-3 py-3 text-center text-xs font-medium text-white uppercase tracking-wider cursor-pointer hover:bg-[#000850] transition-colors"
                    onClick={() => handleSort('cd_empresa')}
                  >
                    <div className="flex items-center justify-center gap-1">
                      Empresa
                      {sortConfig.key === 'cd_empresa' &&
                        (sortConfig.direction === 'asc' ? (
                          <CaretUp size={12} />
                        ) : (
                          <CaretDown size={12} />
                        ))}
                    </div>
                  </th>
                  <th
                    className="px-3 py-3 text-center text-xs font-medium text-white uppercase tracking-wider cursor-pointer hover:bg-[#000850] transition-colors"
                    onClick={() => handleSort('nr_ctapes')}
                  >
                    <div className="flex items-center justify-center gap-1">
                      NR CTAPES
                      {sortConfig.key === 'nr_ctapes' &&
                        (sortConfig.direction === 'asc' ? (
                          <CaretUp size={12} />
                        ) : (
                          <CaretDown size={12} />
                        ))}
                    </div>
                  </th>
                  <th
                    className="px-3 py-3 text-center text-xs font-medium text-white uppercase tracking-wider cursor-pointer hover:bg-[#000850] transition-colors"
                    onClick={() => handleSort('nr_seqmov')}
                  >
                    <div className="flex items-center justify-center gap-1">
                      Seq Mov
                      {sortConfig.key === 'nr_seqmov' &&
                        (sortConfig.direction === 'asc' ? (
                          <CaretUp size={12} />
                        ) : (
                          <CaretDown size={12} />
                        ))}
                    </div>
                  </th>
                  <th
                    className="px-3 py-3 text-left text-xs font-medium text-white uppercase tracking-wider cursor-pointer hover:bg-[#000850] transition-colors"
                    onClick={() => handleSort('cd_historico')}
                  >
                    <div className="flex items-center gap-1">
                      Cód Histórico
                      {sortConfig.key === 'cd_historico' &&
                        (sortConfig.direction === 'asc' ? (
                          <CaretUp size={12} />
                        ) : (
                          <CaretDown size={12} />
                        ))}
                    </div>
                  </th>
                  <th
                    className="px-3 py-3 text-left text-xs font-medium text-white uppercase tracking-wider cursor-pointer hover:bg-[#000850] transition-colors"
                    onClick={() => handleSort('ds_aux')}
                  >
                    <div className="flex items-center gap-1">
                      Descrição
                      {sortConfig.key === 'ds_aux' &&
                        (sortConfig.direction === 'asc' ? (
                          <CaretUp size={12} />
                        ) : (
                          <CaretDown size={12} />
                        ))}
                    </div>
                  </th>
                  <th
                    className="px-3 py-3 text-left text-xs font-medium text-white uppercase tracking-wider cursor-pointer hover:bg-[#000850] transition-colors"
                    onClick={() => handleSort('tp_documento')}
                  >
                    <div className="flex items-center gap-1">
                      Tipo Doc
                      {sortConfig.key === 'tp_documento' &&
                        (sortConfig.direction === 'asc' ? (
                          <CaretUp size={12} />
                        ) : (
                          <CaretDown size={12} />
                        ))}
                    </div>
                  </th>
                  <th
                    className="px-3 py-3 text-center text-xs font-medium text-white uppercase tracking-wider cursor-pointer hover:bg-[#000850] transition-colors"
                    onClick={() => handleSort('tp_operacao')}
                  >
                    <div className="flex items-center justify-center gap-1">
                      Operação
                      {sortConfig.key === 'tp_operacao' &&
                        (sortConfig.direction === 'asc' ? (
                          <CaretUp size={12} />
                        ) : (
                          <CaretDown size={12} />
                        ))}
                    </div>
                  </th>
                  <th
                    className="px-3 py-3 text-right text-xs font-medium text-white uppercase tracking-wider cursor-pointer hover:bg-[#000850] transition-colors"
                    onClick={() => handleSort('vl_lanc')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      Valor Lançamento
                      {sortConfig.key === 'vl_lanc' &&
                        (sortConfig.direction === 'asc' ? (
                          <CaretUp size={12} />
                        ) : (
                          <CaretDown size={12} />
                        ))}
                    </div>
                  </th>
                  <th
                    className="px-3 py-3 text-right text-xs font-medium text-white uppercase tracking-wider cursor-pointer hover:bg-[#000850] transition-colors"
                    onClick={() => handleSort('dt_liquidacao')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      Data Liquidação
                      {sortConfig.key === 'dt_liquidacao' &&
                        (sortConfig.direction === 'asc' ? (
                          <CaretUp size={12} />
                        ) : (
                          <CaretDown size={12} />
                        ))}
                    </div>
                  </th>
                  <th className="px-3 py-3 text-center text-xs font-medium text-white uppercase tracking-wider">
                    Detalhe
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-12 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <LoadingSpinner size="lg" />
                        <span className="text-gray-500">
                          Carregando dados...
                        </span>
                      </div>
                    </td>
                  </tr>
                ) : dados.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-12 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <Receipt size={48} className="text-gray-400" />
                        <span className="text-gray-500 font-medium">
                          Nenhum registro encontrado
                        </span>
                        <span className="text-gray-400 text-sm">
                          Informe o código do cliente e o período para buscar
                        </span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  dadosOrdenados.map((item, index) => (
                    <tr
                      key={index}
                      className={`${
                        index % 2 === 0 ? 'bg-white' : 'bg-gray-100'
                      } hover:bg-blue-50 transition-all duration-200`}
                    >
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-900">
                        <div className="flex items-center gap-1">
                          <Calendar size={12} className="text-gray-400" />
                          {formatarDataBR(item.dt_movim)}
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-center text-gray-900">
                        {item.cd_empresa || '-'}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-center text-gray-900">
                        {item.nr_ctapes || '-'}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-center text-gray-900">
                        {item.nr_seqmov || '-'}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-center text-gray-900">
                        {item.cd_historico || '-'}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-900">
                        {formatarDsAux(item.ds_aux, item.cd_historico)}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-900">
                        {item.tp_documento === '10'
                          ? 'ADIANTAMENTO'
                          : item.tp_documento === '20'
                          ? 'CREDEV'
                          : item.tp_documento || '-'}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-center">
                        <span
                          className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            item.tp_operacao === 'D'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-green-100 text-green-800'
                          }`}
                        >
                          {item.tp_operacao === 'D' ? 'Débito' : 'Crédito'}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-right font-semibold">
                        <span
                          className={
                            item.tp_operacao === 'D'
                              ? 'text-red-600'
                              : 'text-green-600'
                          }
                        >
                          {formatarMoeda(item.vl_lancto)}
                        </span>
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-xs text-right font-semibold text-blue-600">
                        {formatarDataBR(item.dt_liq)}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-center">
                        <button
                          onClick={() => handleDetalhar(item)}
                          className="inline-flex items-center gap-1 bg-blue-600 text-white px-2 py-0.5 rounded-md hover:bg-blue-700 transition-colors text-xs font-medium"
                        >
                          <Eye size={12} weight="bold" />
                          Detalhar
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Modal de Detalhes */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header do Modal */}
            <div className="bg-[#000638] text-white px-6 py-4 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold">Detalhes da Fatura</h2>
                {itemSelecionado && (
                  <p className="text-sm text-gray-300 mt-1">
                    Valor: {formatarMoeda(itemSelecionado.vl_lancto)} | Data:{' '}
                    {formatarDataBR(itemSelecionado.dt_movim)}
                  </p>
                )}
              </div>
              <button
                onClick={handleCloseModal}
                className="text-white hover:bg-white/20 rounded-lg p-2 transition-colors"
              >
                <X size={24} weight="bold" />
              </button>
            </div>

            {/* Conteúdo do Modal */}
            <div className="flex-1 overflow-y-auto p-6">
              {/* Seção de Observações */}
              {observacoesLoading ? (
                <div className="mb-6 bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center gap-2">
                    <CircleNotch
                      size={20}
                      className="animate-spin text-blue-600"
                    />
                    <span className="text-sm text-gray-600">
                      Carregando observações...
                    </span>
                  </div>
                </div>
              ) : observacoes.length > 0 ? (
                <div className="mb-6 bg-blue-50 border-2 border-blue-200 rounded-lg p-4">
                  <h3 className="text-sm font-bold text-blue-900 mb-3 flex items-center gap-2">
                    <Receipt size={20} className="text-blue-600" />
                    Observações da Movimentação
                  </h3>
                  <div className="space-y-3">
                    {observacoes.map((obs, index) => (
                      <div
                        key={index}
                        className="bg-white rounded-lg p-3 border border-blue-200"
                      >
                        <p className="text-sm text-gray-800 mb-2">
                          {obs.ds_obs}
                        </p>
                        <div className="flex items-center gap-4 text-xs text-gray-500">
                          <span>
                            Data Cadastro: {formatarDataBR(obs.dt_cadastro)}
                          </span>
                          <span>
                            Data Movim: {formatarDataBR(obs.dt_movim)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Seção de Produtos da Transação */}
              {produtosLoading ? (
                <div className="mb-6 bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center gap-2">
                    <CircleNotch
                      size={20}
                      className="animate-spin text-green-600"
                    />
                    <span className="text-sm text-gray-600">
                      Carregando produtos da nota fiscal...
                    </span>
                  </div>
                </div>
              ) : produtosError ? (
                <div className="mb-6 bg-red-50 border-2 border-red-200 rounded-lg p-4">
                  <h3 className="text-sm font-bold text-red-900 mb-2">
                    Erro ao carregar produtos
                  </h3>
                  <p className="text-sm text-red-700">{produtosError}</p>
                </div>
              ) : produtosNF.length > 0 ? (
                <div className="mb-6 bg-green-50 border-2 border-green-200 rounded-lg p-4">
                  <h3 className="text-sm font-bold text-green-900 mb-3 flex items-center gap-2">
                    <Receipt size={20} className="text-green-600" />
                    Produtos da Nota Fiscal ({produtosNF.length} itens)
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-green-200">
                      <thead className="bg-green-100">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-green-800 uppercase">
                            Código
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-green-800 uppercase">
                            Descrição
                          </th>
                          <th className="px-3 py-2 text-center text-xs font-semibold text-green-800 uppercase">
                            Quantidade
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-green-800 uppercase">
                            Valor Unit.
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-green-800 uppercase">
                            Valor Total
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-green-100">
                        {produtosNF.map((produto, index) => (
                          <tr key={index} className="hover:bg-green-50">
                            <td className="px-3 py-2 text-sm text-gray-900">
                              {produto.cd_produto || '--'}
                            </td>
                            <td className="px-3 py-2 text-sm text-gray-900">
                              {produto.ds_produto || '--'}
                            </td>
                            <td className="px-3 py-2 text-sm text-center text-gray-900">
                              {parseFloat(produto.qnt || 0).toLocaleString(
                                'pt-BR',
                                {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                },
                              )}
                            </td>
                            <td className="px-3 py-2 text-sm text-right font-semibold text-gray-900">
                              {formatarMoeda(produto.vl_unitliquido)}
                            </td>
                            <td className="px-3 py-2 text-sm text-right font-bold text-green-700">
                              {formatarMoeda(produto.total)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-green-100">
                        <tr>
                          <td
                            colSpan="4"
                            className="px-3 py-2 text-sm font-bold text-right text-green-900"
                          >
                            Total:
                          </td>
                          <td className="px-3 py-2 text-sm font-bold text-right text-green-900">
                            {formatarMoeda(
                              produtosNF.reduce(
                                (acc, p) => acc + (parseFloat(p.total) || 0),
                                0,
                              ),
                            )}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              ) : null}

              {detalhesLoading ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <LoadingSpinner size="lg" />
                  <span className="text-gray-500 mt-4">
                    Carregando detalhes...
                  </span>
                </div>
              ) : itemSelecionado?.cd_historico === '888' ||
                itemSelecionado?.cd_historico === '889' ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <div className="bg-blue-50 border-2 border-blue-300 rounded-lg p-6 max-w-2xl">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="bg-blue-600 rounded-full p-3">
                        <Receipt
                          size={32}
                          className="text-white"
                          weight="bold"
                        />
                      </div>
                      <h3 className="text-xl font-bold text-blue-900">
                        Transferência Entre Empresas
                      </h3>
                    </div>
                    <p className="text-center text-blue-800 font-medium text-lg">
                      PROCESSO INTERNO DE TRANSFERÊNCIA DE SALDO ENTRE EMPRESAS
                    </p>
                  </div>
                </div>
              ) : detalhesFatura.length === 0 && produtosNF.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Receipt size={48} className="text-gray-400" />
                  <span className="text-gray-500 font-medium mt-4">
                    Nenhum detalhe encontrado
                  </span>
                </div>
              ) : detalhesFatura.length > 0 ? (
                <div className="overflow-x-auto">
                  {/* Verificar se é crédito de adiantamento */}
                  {itemSelecionado?.tp_operacao === 'C' &&
                  itemSelecionado?.tp_documento === '10' ? (
                    /* Tabela para Crédito de Adiantamento */
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase">
                            Valor Fatura
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase">
                            NR Fat
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase">
                            NR Parcela
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase">
                            Data Emissão
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase">
                            Data Vencimento
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase">
                            Data Liquidação
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase">
                            Valor Pago
                          </th>
                          <th className="px-3 py-2 text-center text-xs font-medium text-gray-700 uppercase">
                            Gerar Boleto
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {detalhesFatura.map((detalhe, index) => {
                          // Verificar se o boleto está pago (dt_liq E vl_pago preenchidos)
                          const temDataLiquidacao =
                            detalhe.dt_liq &&
                            detalhe.dt_liq !== null &&
                            detalhe.dt_liq !== '';
                          const temValorPago =
                            detalhe.vl_pago &&
                            detalhe.vl_pago !== null &&
                            parseFloat(detalhe.vl_pago) > 0;
                          const estaPago = temDataLiquidacao && temValorPago;

                          // ID único para esta fatura
                          const faturaId = `${detalhe.nr_fat}-${detalhe.nr_parcela}`;
                          const isLoadingBoleto =
                            boletoLoading[faturaId] || false;

                          return (
                            <tr key={index} className="hover:bg-gray-50">
                              <td className="px-3 py-2 text-sm text-gray-900">
                                {formatarMoeda(detalhe.vl_fatura)}
                              </td>
                              <td className="px-3 py-2 text-sm text-gray-900">
                                {detalhe.nr_fat || '-'}
                              </td>
                              <td className="px-3 py-2 text-sm text-gray-900">
                                {detalhe.nr_parcela || '-'}
                              </td>
                              <td className="px-3 py-2 text-sm text-gray-900">
                                {formatarDataBR(detalhe.dt_emissao)}
                              </td>
                              <td className="px-3 py-2 text-sm text-gray-900">
                                {formatarDataBR(detalhe.dt_vencimento)}
                              </td>
                              <td className="px-3 py-2 text-sm text-gray-900">
                                {formatarDataBR(detalhe.dt_liq)}
                              </td>
                              <td className="px-3 py-2 text-sm font-semibold text-green-600">
                                {formatarMoeda(detalhe.vl_pago)}
                              </td>
                              <td className="px-3 py-2 text-center">
                                {estaPago ? (
                                  <span className="inline-flex items-center gap-1 px-3 py-1.5 bg-green-100 text-green-700 text-xs font-semibold rounded-lg">
                                    <CheckCircle size={14} weight="bold" />
                                    PAGO
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => buscarBoleto(detalhe)}
                                    disabled={isLoadingBoleto}
                                    className="inline-flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                                    title="Gerar boleto bancário"
                                  >
                                    <FileArrowDown size={14} weight="bold" />
                                    {isLoadingBoleto
                                      ? 'Gerando...'
                                      : 'Gerar Boleto'}
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    /* Tabela para Débito com transações e botão Gerar NF */
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase">
                            Valor Fatura
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase">
                            NR Fat
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase">
                            NR Transação
                          </th>
                          <th className="px-3 py-2 text-center text-xs font-medium text-gray-700 uppercase">
                            Ações
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {detalhesFatura.map((detalhe, index) => (
                          <tr key={index} className="hover:bg-gray-50">
                            <td className="px-3 py-2 text-sm text-gray-900">
                              {formatarMoeda(detalhe.vl_fatura)}
                            </td>
                            <td className="px-3 py-2 text-sm text-gray-900">
                              {detalhe.nr_fat || '-'}
                            </td>
                            <td className="px-3 py-2 text-sm text-gray-900">
                              {detalhe.nr_transacao || '-'}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <button
                                onClick={() => gerarDanfeTransacao(detalhe)}
                                disabled={danfeLoading}
                                className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                                title="Gerar DANFE desta transação"
                              >
                                <FileArrowDown size={14} weight="bold" />
                                {danfeLoading ? 'Gerando...' : 'Gerar NF'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ) : null}
            </div>

            {/* Footer do Modal */}
            <div className="bg-gray-50 px-6 py-4 flex justify-end border-t border-gray-200">
              <button
                onClick={handleCloseModal}
                className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors font-medium"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExtratoCredito;
