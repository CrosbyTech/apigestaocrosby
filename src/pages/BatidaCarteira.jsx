import React, { useEffect, useState, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import FiltroEmpresa from '../components/FiltroEmpresa';
import FiltroCliente from '../components/FiltroCliente';
import PageTitle from '../components/ui/PageTitle';
import { TotvsURL } from '../config/constants';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/cards';
import {
  Wallet,
  Funnel,
  Spinner,
  CaretUp,
  CaretDown,
  CaretUpDown,
  Calendar,
  UploadSimple,
  X,
  Bank,
  File,
  CheckCircle,
  WarningCircle,
  CheckSquare,
  XSquare,
  DownloadSimple,
  CurrencyCircleDollar,
  Coins,
  ArrowsOutSimple,
  ArrowsInSimple,
} from '@phosphor-icons/react';

const BatidaCarteira = () => {
  const [dados, setDados] = useState([]);
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [loading, setLoading] = useState(false);
  const [dadosCarregados, setDadosCarregados] = useState(false);
  const [status, setStatus] = useState('Todos');
  const [situacao, setSituacao] = useState('NORMAIS');
  const [empresasSelecionadas, setEmpresasSelecionadas] = useState([]);

  // Estados para paginação
  const [paginaAtual, setPaginaAtual] = useState(1);
  const [itensPorPagina] = useState(50);

  // Estados para ordenação
  const [ordenacao, setOrdenacao] = useState({ campo: null, direcao: 'asc' });
  const [ordenacaoImportados, setOrdenacaoImportados] = useState({
    campo: null,
    direcao: 'asc',
  });

  // Estados para filtros adicionais
  const [filtroFatura, setFiltroFatura] = useState('');
  const [filtroPortador, setFiltroPortador] = useState('');
  const [filtroCobranca, setFiltroCobranca] = useState('TODOS');

  // Estados para os filtros de seleção múltipla
  const [clientesSelecionados, setClientesSelecionados] = useState([]);
  const [dadosClientes, setDadosClientes] = useState([]);

  // Estados para modal de importação
  const [modalImportarAberto, setModalImportarAberto] = useState(false);
  const [bancoSelecionado, setBancoSelecionado] = useState('');
  const [arquivosSelecionados, setArquivosSelecionados] = useState([]); // Array para múltiplos arquivos
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadResultado, setUploadResultado] = useState(null);
  const [dadosImportados, setDadosImportados] = useState([]);
  const [bancoImportado, setBancoImportado] = useState(''); // Persiste após fechar modal

  // Estado para modal de detalhes dos cards
  const [modalDetalheAberto, setModalDetalheAberto] = useState(null); // null, 'batidos', 'soSistema', 'soArquivo', 'divergentes'

  // Estados para baixa de títulos (settle)
  const [selectedForSettle, setSelectedForSettle] = useState(new Set());
  const [settleLoading, setSettleLoading] = useState(false);
  const [expandPagoSoArquivo, setExpandPagoSoArquivo] = useState(false);
  const [filtroBaixaArquivo, setFiltroBaixaArquivo] = useState('TODOS'); // TODOS, SACADO, LIQUIDACAO, CEDENTE, DEBITADO

  // Bancos para importação de arquivo bancário
  const bancos = [
    { codigo: 'BRADESCO', nome: 'Bradesco' },
    { codigo: 'SANTANDER', nome: 'Santander' },
    { codigo: 'BB', nome: 'Banco do Brasil' },
    { codigo: 'CEF', nome: 'Caixa Econômica Federal' },
    { codigo: 'ITAU', nome: 'Itaú' },
    { codigo: 'SICREDI', nome: 'Sicredi' },
    { codigo: 'UNICRED', nome: 'Unicred' },
    { codigo: 'DAYCOVAL', nome: 'Daycoval' },
    { codigo: 'CONFIANCA', nome: 'Confiança' },
  ];

  // Opções para importar dados do sistema (quando API está indisponível)
  const fontesSystem = [
    { codigo: 'SISTEMA_CONFIANCA', nome: 'Sistema - Confiança (CSV)' },
    { codigo: 'SISTEMA_SICREDI', nome: 'Sistema - Sicredi (CSV)' },
  ];

  const BaseURL = 'https://apigestaocrosby-bw2v.onrender.com/api/financial/';

  // Helpers de data
  const parseDateNoTZ = (isoDate) => {
    if (!isoDate) return null;
    try {
      const [datePart] = String(isoDate).split('T');
      const [y, m, d] = datePart.split('-').map((n) => parseInt(n, 10));
      if (!y || !m || !d) return null;
      return new Date(y, m - 1, d);
    } catch {
      return null;
    }
  };

  const formatDateBR = (isoDate) => {
    const d = parseDateNoTZ(isoDate);
    if (!d) return '--';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = String(d.getFullYear());
    return `${dd}/${mm}/${yyyy}`;
  };

  // Função para converter tipo de cobrança
  const converterTipoCobranca = (numero) => {
    const tipos = {
      0: 'Não Cobrança',
      1: 'Simples',
      2: 'Descontada',
    };
    return tipos[numero] || '--';
  };

  // Função para formatar CPF/CNPJ
  const formatCpfCnpj = (valor) => {
    if (!valor) return '--';
    const numeros = String(valor).replace(/\D/g, '');
    if (numeros.length === 11) {
      // CPF: 000.000.000-00
      return numeros.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    } else if (numeros.length === 14) {
      // CNPJ: 00.000.000/0000-00
      return numeros.replace(
        /(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,
        '$1.$2.$3/$4-$5',
      );
    }
    return valor;
  };

  // Função para converter tipo de documento
  const converterTipoDocumento = (numero) => {
    const tiposDocumento = {
      1: 'Fatura',
      2: 'Duplicata',
      3: 'Nota Promissória',
      4: 'Cheque',
      5: 'Recibo',
      6: 'Carnê',
      7: 'Boleto',
      8: 'Contrato',
      9: 'Transferência',
      10: 'Dinheiro',
      11: 'Cartão Crédito',
      12: 'Cartão Débito',
      13: 'PIX',
      14: 'Depósito',
      15: 'Outros',
    };
    return tiposDocumento[numero] || `Tipo ${numero}`;
  };

  // Função para ordenação
  const handleSort = useCallback((campo) => {
    setOrdenacao((prev) => ({
      campo,
      direcao: prev.campo === campo && prev.direcao === 'asc' ? 'desc' : 'asc',
    }));
  }, []);

  // Função para ícone de ordenação
  const getSortIcon = useCallback(
    (campo) => {
      if (ordenacao.campo !== campo) {
        return <CaretUpDown size={12} className="opacity-50" />;
      }
      return ordenacao.direcao === 'asc' ? (
        <CaretUp size={12} />
      ) : (
        <CaretDown size={12} />
      );
    },
    [ordenacao],
  );

  // Função para ordenação dos dados importados
  const handleSortImportados = useCallback((campo) => {
    setOrdenacaoImportados((prev) => ({
      campo,
      direcao: prev.campo === campo && prev.direcao === 'asc' ? 'desc' : 'asc',
    }));
  }, []);

  // Função para ícone de ordenação dos dados importados
  const getSortIconImportados = useCallback(
    (campo) => {
      if (ordenacaoImportados.campo !== campo) {
        return <CaretUpDown size={12} className="opacity-50" />;
      }
      return ordenacaoImportados.direcao === 'asc' ? (
        <CaretUp size={12} />
      ) : (
        <CaretDown size={12} />
      );
    },
    [ordenacaoImportados],
  );

  // Definir data inicial
  useEffect(() => {
    const hoje = new Date();
    const primeiroDia = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    const ultimoDia = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);

    const formatarData = (data) => {
      const ano = data.getFullYear();
      const mes = String(data.getMonth() + 1).padStart(2, '0');
      const dia = String(data.getDate()).padStart(2, '0');
      return `${ano}-${mes}-${dia}`;
    };

    setDataInicio(formatarData(primeiroDia));
    setDataFim(formatarData(ultimoDia));
  }, []);

  // Função para buscar informações de pessoas (nomes) via API TOTVS
  const buscarInfoPessoas = async (codigosPessoa) => {
    if (!codigosPessoa || codigosPessoa.length === 0) return {};

    try {
      const codigosUnicos = [
        ...new Set(
          codigosPessoa
            .filter(Boolean)
            .map(Number)
            .filter((c) => c > 0),
        ),
      ];
      console.log(
        `👥 Buscando dados de ${codigosUnicos.length} clientes via TOTVS...`,
      );

      const response = await fetch(`${TotvsURL}persons/batch-lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personCodes: codigosUnicos }),
      });

      if (!response.ok) {
        console.warn('Erro ao buscar dados de pessoas:', response.status);
        return {};
      }

      const data = await response.json();
      const pessoasMap = data?.data || data || {};

      const infoPessoasObj = {};
      for (const [code, pessoa] of Object.entries(pessoasMap)) {
        infoPessoasObj[String(code).trim()] = {
          cd_pessoa: code,
          nm_pessoa: pessoa.name || '',
          nm_fantasia: pessoa.fantasyName || '',
          nr_telefone: pessoa.phone || '',
        };
      }

      console.log(
        `✅ ${Object.keys(infoPessoasObj).length} clientes encontrados via TOTVS`,
      );
      return infoPessoasObj;
    } catch (err) {
      console.error('Erro ao buscar informações de pessoas:', err);
      return {};
    }
  };

  const buscarDados = async (inicio = dataInicio, fim = dataFim) => {
    if (!inicio || !fim) return;

    if (empresasSelecionadas.length === 0) {
      alert('Selecione pelo menos uma empresa para consultar!');
      return;
    }

    setLoading(true);
    setPaginaAtual(1);
    try {
      // Construir query params para a rota TOTVS otimizada
      const params = new URLSearchParams();
      params.append('dt_inicio', inicio);
      params.append('dt_fim', fim);
      params.append('modo', 'vencimento');

      // Filtro de status
      if (status && status !== 'Todos') {
        params.append('status', status);
      }

      // Filtro de situação
      if (situacao && situacao !== 'TODAS') {
        if (situacao === 'NORMAIS') {
          params.append('situacao', '1');
        } else if (situacao === 'CANCELADAS') {
          params.append('situacao', '3');
        }
      }

      // Filtro de cobrança
      if (filtroCobranca && filtroCobranca !== 'TODOS') {
        let cobrancaParam = filtroCobranca;
        if (filtroCobranca === 'NÃO ESTÁ EM COBRANÇA') {
          cobrancaParam = '0';
        } else if (filtroCobranca === 'SIMPLES') {
          cobrancaParam = '1';
        } else if (filtroCobranca === 'DESCONTADA') {
          cobrancaParam = '2';
        }
        params.append('tp_cobranca', cobrancaParam);
      }

      // Filtro de clientes
      if (clientesSelecionados.length > 0) {
        const clientesIds = clientesSelecionados
          .map((c) => c.cd_cliente)
          .join(',');
        params.append('cd_cliente', clientesIds);
      }

      // Forma de pagamento fixo em 1 - FATURA
      params.append('tp_documento', '1');

      // Filtro de fatura
      if (filtroFatura && filtroFatura.trim() !== '') {
        params.append('nr_fatura', filtroFatura.trim());
      }

      // Filtro de portador
      if (filtroPortador && filtroPortador.trim() !== '') {
        const portadores = filtroPortador
          .split(',')
          .map((p) => p.trim())
          .filter((p) => p !== '');
        params.append('cd_portador', portadores.join(','));
      }

      // Filtro de empresas selecionadas (branchCodes)
      if (empresasSelecionadas.length > 0) {
        const branchCodes = empresasSelecionadas
          .map((e) => e.cd_empresa)
          .join(',');
        params.append('branches', branchCodes);
      }

      const url = `${TotvsURL}accounts-receivable/filter?${params.toString()}`;
      console.log('🔍 Buscando batida de carteira via TOTVS:', url);

      const res = await fetch(url);

      if (!res.ok) {
        const errorData = await res.json();
        console.error('❌ Erro da API TOTVS:', errorData);
        throw new Error(errorData.message || `HTTP ${res.status}`);
      }

      const result = await res.json();
      console.log('✅ Resposta TOTVS:', result);

      let todosOsDados = result.data?.items || [];

      // A rota já mapeia para formato legacy (cd_empresa, cd_cliente, etc.)
      // Adicionar nr_portador como alias de cd_portador para compatibilidade
      todosOsDados = todosOsDados.map((item) => ({
        ...item,
        nr_portador: item.cd_portador || item.nm_portador || '',
      }));

      console.log(`📊 Total de dados TOTVS: ${todosOsDados.length}`);

      // Buscar nomes dos clientes via batch-lookup
      const codigosClientes = [
        ...new Set(todosOsDados.map((item) => item.cd_cliente).filter(Boolean)),
      ];

      if (codigosClientes.length > 0) {
        const info = await buscarInfoPessoas(codigosClientes);
        if (info && Object.keys(info).length > 0) {
          console.log(
            `👤 ${Object.keys(info).length} nomes de clientes carregados`,
          );
          todosOsDados = todosOsDados.map((item) => {
            const key = String(item.cd_cliente).trim();
            const pessoa = info[key];
            if (pessoa) {
              return {
                ...item,
                nm_cliente: pessoa.nm_pessoa || item.nm_cliente,
                nm_fantasia: pessoa.nm_fantasia || '',
              };
            }
            return item;
          });
        }
      }

      setDados(todosOsDados);
      setDadosCarregados(true);

      // Extrair dados únicos de clientes
      const clientesUnicos = [
        ...new Set(
          todosOsDados.map((item) =>
            JSON.stringify({
              cd_cliente: item.cd_cliente?.toString(),
              nm_cliente: item.nm_cliente,
            }),
          ),
        ),
      ]
        .map((str) => JSON.parse(str))
        .filter((cliente) => cliente.cd_cliente && cliente.nm_cliente);
      setDadosClientes(clientesUnicos);
    } catch (err) {
      console.error('❌ Erro ao buscar dados:', err);
      alert(`Erro ao buscar dados: ${err.message}`);
      setDados([]);
      setDadosCarregados(false);
    } finally {
      setLoading(false);
    }
  };

  const handleFiltrar = (e) => {
    e.preventDefault();
    buscarDados();
  };

  const handleSelectEmpresas = (empresas) => {
    setEmpresasSelecionadas(empresas);
  };

  const handleSelectClientes = (clientes) => {
    setClientesSelecionados([...clientes]);
  };

  // Função para fazer upload do arquivo bancário (suporta múltiplos arquivos)
  const handleUploadArquivo = async () => {
    if (!bancoSelecionado) {
      alert('Selecione um banco!');
      return;
    }
    if (arquivosSelecionados.length === 0) {
      alert('Selecione pelo menos um arquivo!');
      return;
    }

    setUploadLoading(true);
    setUploadResultado(null);

    try {
      // Processar cada arquivo e combinar os resultados
      let todosRegistros = [];
      let totalRegistros = 0;
      let valorTotalPago = 0;
      let valorTotalOriginal = 0;
      const arquivosProcessados = [];
      const erros = [];

      for (const arquivo of arquivosSelecionados) {
        const formData = new FormData();
        formData.append('arquivo', arquivo);
        formData.append('banco', bancoSelecionado);

        const response = await fetch(`${BaseURL}batida-carteira/upload`, {
          method: 'POST',
          body: formData,
        });

        const data = await response.json();

        if (response.ok && data.success !== false) {
          const registros = data.data?.registros || data.registros || [];
          const stats = data.data?.stats || data.stats || {};

          todosRegistros = [...todosRegistros, ...registros];
          totalRegistros += stats.totalRegistros || registros.length;
          valorTotalPago += stats.valorTotalPago || 0;
          valorTotalOriginal += stats.valorTotalOriginal || 0;

          arquivosProcessados.push({
            arquivo: arquivo.name,
            success: true,
            registros: registros.length,
            tipoArquivo: stats.tipoArquivo || 'DESCONHECIDO',
          });
        } else {
          erros.push({
            arquivo: arquivo.name,
            erro: data.message || data.error || 'Erro ao processar arquivo',
          });
        }
      }

      if (todosRegistros.length > 0) {
        setUploadResultado({
          success: true,
          message: `${arquivosProcessados.length} arquivo(s) processado(s) com sucesso!`,
          stats: {
            totalRegistros,
            valorTotalPago,
            valorTotalOriginal,
            arquivosProcessados,
            erros: erros.length > 0 ? erros : null,
          },
        });

        // Se é importação do SISTEMA (CSV exportado), colocar nos dados do sistema
        if (bancoSelecionado.startsWith('SISTEMA_')) {
          setDados(todosRegistros);
          setDadosCarregados(true);
          // Extrair o banco real (SISTEMA_CONFIANCA -> CONFIANCA)
          const bancoReal = bancoSelecionado.replace('SISTEMA_', '');
          setBancoImportado(bancoReal);
        } else {
          // Importação normal do arquivo do banco
          setDadosImportados(todosRegistros);
          setBancoImportado(bancoSelecionado);
        }
      } else {
        setUploadResultado({
          success: false,
          message:
            erros.length > 0
              ? `Erro ao processar arquivos: ${erros.map((e) => e.erro).join(', ')}`
              : 'Nenhum registro encontrado nos arquivos',
        });
      }
    } catch (error) {
      console.error('Erro no upload:', error);
      setUploadResultado({
        success: false,
        message: 'Erro ao enviar arquivos. Verifique sua conexão.',
      });
    } finally {
      setUploadLoading(false);
    }
  };

  // Função para fechar o modal e limpar estados
  const fecharModalImportar = () => {
    setModalImportarAberto(false);
    setBancoSelecionado('');
    setArquivosSelecionados([]);
    setUploadResultado(null);
  };

  // Função para normalizar CPF/CNPJ (remover caracteres especiais e identificar corretamente)
  const normalizarCpfCnpj = (valor) => {
    if (!valor) return '';
    // Remove todos os caracteres não numéricos
    let numeros = String(valor).replace(/\D/g, '');

    // Se tiver 14 dígitos e os 3 primeiros forem zeros, pode ser um CPF com zeros à esquerda
    // CPF: 11 dígitos, CNPJ: 14 dígitos
    if (numeros.length === 14) {
      // Verifica se é um CPF disfarçado de CNPJ (3 zeros à esquerda + 11 dígitos de CPF)
      if (numeros.startsWith('000')) {
        // Remove os 3 zeros à esquerda para ficar como CPF de 11 dígitos
        numeros = numeros.substring(3);
      }
    }

    // Padronizar: CPF sempre com 11 dígitos, CNPJ sempre com 14 dígitos
    if (numeros.length <= 11) {
      // É um CPF - padroniza para 11 dígitos
      numeros = numeros.padStart(11, '0');
    } else if (numeros.length <= 14) {
      // É um CNPJ - padroniza para 14 dígitos
      numeros = numeros.padStart(14, '0');
    }

    return numeros;
  };

  // Função para normalizar data (formato YYYY-MM-DD)
  const normalizarData = (data) => {
    if (!data) return '';
    const d = parseDateNoTZ(data);
    if (!d) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      '0',
    )}-${String(d.getDate()).padStart(2, '0')}`;
  };

  // Função para normalizar valor (arredondar para 2 casas decimais)
  const normalizarValor = (valor) => {
    return (parseFloat(valor) || 0).toFixed(2);
  };

  // Criar chave de comparação
  const criarChaveComparacao = (cpfcnpj, valor, dataVencimento) => {
    return `${normalizarCpfCnpj(cpfcnpj)}|${normalizarValor(
      valor,
    )}|${normalizarData(dataVencimento)}`;
  };

  // Normalizar nome do cliente para comparação (remove acentos, números, caracteres especiais)
  const normalizarNomeCliente = (nome) => {
    if (!nome) return '';
    return String(nome)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove acentos
      .toUpperCase()
      .replace(/[0-9]/g, '') // Remove números
      .replace(/[^A-Z\s]/g, '') // Remove tudo que não for letra ou espaço (remove &, -, ., etc)
      .replace(/\s+/g, ' ') // Múltiplos espaços vira um só
      .trim();
  };

  // Comparar valores com tolerância (para Santander que tem diferença de ~R$ 1,00)
  // Retorna true se a diferença entre os valores for menor ou igual à tolerância
  const valoresProximos = (valor1, valor2, tolerancia = 1.5) => {
    const v1 = parseFloat(valor1) || 0;
    const v2 = parseFloat(valor2) || 0;
    return Math.abs(v1 - v2) <= tolerancia;
  };

  // Criar chave de comparação para SANTANDER (por valor + vencimento + nome)
  // O nome é apenas para referência, a comparação real usa "contém"
  const criarChaveComparacaoSantander = (
    valor,
    dataVencimento,
    nomeCliente,
  ) => {
    const nomeNorm = normalizarNomeCliente(nomeCliente);
    return `SANT|${normalizarValor(valor)}|${normalizarData(dataVencimento)}|${nomeNorm}`;
  };

  // Verificar se nome do sistema CONTÉM o nome do arquivo (Santander)
  // O arquivo tem nome cortado, então verificamos se o nome completo do sistema contém o nome do arquivo
  const nomeClienteContem = (nomeSistema, nomeArquivo) => {
    if (!nomeSistema || !nomeArquivo) return false;
    const sistNorm = normalizarNomeCliente(nomeSistema);
    const arqNorm = normalizarNomeCliente(nomeArquivo);
    // Verifica se o nome do sistema contém o nome do arquivo (que pode estar cortado)
    return sistNorm.includes(arqNorm) || arqNorm.includes(sistNorm);
  };

  // Criar chave de comparação para BB (por fatura + parcela)
  // O Banco do Brasil fornece "Nro beneficiário" no formato "fatura/parcela"
  // que mapeia diretamente para nr_fat/nr_parcela do sistema TOTVS
  const criarChaveFaturaParcela = (fatura, parcela) => {
    const fat = String(fatura || '').replace(/^0+/, '') || '0';
    const par = String(parcela || '').replace(/^0+/, '') || '1';
    return `BB_FAT|${fat}|${par}`;
  };

  // Lista de exceções específicas para títulos EFIGENIA MARIA NOGUE
  // Esses títulos têm datas diferentes no sistema (05/12) e arquivo (30/12)
  // mas devem ser considerados como batidos
  const excecoesEfigenia = useMemo(() => {
    const cpfcnpj = '45512784000175';
    const valores = [
      1431.96, 1069.01, 791.06, 1575.18, 2675.51, 1955.13, 4242.06, 2401.81,
      1069.01, 1922.83, 2571.38, 703.93,
    ];
    // Criar mapa de valor -> data do arquivo (30/12/2025)
    const mapa = new Map();
    valores.forEach((val) => {
      const chaveValor = `${normalizarCpfCnpj(cpfcnpj)}|${normalizarValor(val)}`;
      mapa.set(chaveValor, '2025-12-30');
    });
    return mapa;
  }, []);

  // Função para verificar se item é exceção
  const verificarExcecao = useCallback(
    (cpfcnpj, valor) => {
      const chaveValor = `${normalizarCpfCnpj(cpfcnpj)}|${normalizarValor(valor)}`;
      return excecoesEfigenia.get(chaveValor);
    },
    [excecoesEfigenia],
  );

  // Set de chaves dos dados importados para comparação rápida
  const chavesImportados = useMemo(() => {
    const set = new Set();
    dadosImportados.forEach((item) => {
      // Chave padrão (CPF/CNPJ + Valor + Data)
      const chave = criarChaveComparacao(
        item.nr_cpfcnpj,
        item.vl_original,
        item.dt_vencimento,
      );
      set.add(chave);

      // Para SANTANDER: adicionar chave alternativa por valor + vencimento + nome
      if (bancoImportado === 'SANTANDER') {
        const chaveSantander = criarChaveComparacaoSantander(
          item.vl_original,
          item.dt_vencimento,
          item.nm_cliente,
        );
        set.add(chaveSantander);
      }

      // Para BB: adicionar chave por fatura + parcela
      if (bancoImportado === 'BB') {
        const chaveBB = criarChaveFaturaParcela(
          item.nr_fatura,
          item.nr_parcela,
        );
        set.add(chaveBB);
      }
    });
    return set;
  }, [dadosImportados, bancoImportado]);

  // Mapa otimizado para SICREDI/SANTANDER: indexa por data+valor para busca O(1)
  // Chave: "data|valorArredondado", Valor: array de {item, nomeNormalizado}
  const mapaImportadosPorDataValor = useMemo(() => {
    if (bancoImportado !== 'SICREDI' && bancoImportado !== 'SANTANDER') {
      return new Map();
    }
    const mapa = new Map();
    dadosImportados.forEach((item) => {
      const data = normalizarData(item.dt_vencimento);
      const valor = parseFloat(item.vl_original) || 0;
      // Criar chaves para valores próximos (tolerância de 1.5)
      const valoresChave = [
        Math.floor(valor),
        Math.ceil(valor),
        Math.round(valor),
      ];
      const nomeNorm = normalizarNomeCliente(item.nm_cliente);

      valoresChave.forEach((v) => {
        const chave = `${data}|${v}`;
        if (!mapa.has(chave)) {
          mapa.set(chave, []);
        }
        // Evitar duplicatas
        const arr = mapa.get(chave);
        if (!arr.some((x) => x.item === item)) {
          arr.push({ item, nomeNorm });
        }
      });
    });
    return mapa;
  }, [dadosImportados, bancoImportado]);

  // Set de chaves dos dados do sistema para comparação rápida
  const chavesSistema = useMemo(() => {
    const set = new Set();
    dados.forEach((item) => {
      // Adicionar 0.98 ao valor da fatura do sistema para comparar
      const valorComTaxa = parseFloat(item.vl_fatura || 0) + 0.98;

      // Chave padrão (CPF/CNPJ + Valor + Data)
      const chave = criarChaveComparacao(
        item.nr_cpfcnpj,
        valorComTaxa,
        item.dt_vencimento,
      );
      set.add(chave);

      // Para SANTANDER: adicionar chave alternativa por valor + vencimento + nome
      if (bancoImportado === 'SANTANDER') {
        const chaveSantander = criarChaveComparacaoSantander(
          valorComTaxa,
          item.dt_vencimento,
          item.nm_cliente,
        );
        set.add(chaveSantander);
      }

      // Para BB: adicionar chave por fatura + parcela
      if (bancoImportado === 'BB') {
        const chaveBB = criarChaveFaturaParcela(item.nr_fat, item.nr_parcela);
        set.add(chaveBB);
      }
    });
    return set;
  }, [dados, bancoImportado]);

  // Função para verificar se item do sistema bate com importados (incluindo exceções)
  const verificarItemSistemaBate = useCallback(
    (item) => {
      const valorComTaxa = parseFloat(item.vl_fatura || 0) + 0.98;
      const chave = criarChaveComparacao(
        item.nr_cpfcnpj,
        valorComTaxa,
        item.dt_vencimento,
      );

      // Verificar batida normal
      if (chavesImportados.has(chave)) return true;

      // Para BB: verificar por fatura + parcela (identificador único)
      if (bancoImportado === 'BB') {
        const chaveBB = criarChaveFaturaParcela(item.nr_fat, item.nr_parcela);
        if (chavesImportados.has(chaveBB)) return true;
      }

      // Para SANTANDER: verificar por valor + vencimento + nome (contém) - OTIMIZADO
      if (bancoImportado === 'SANTANDER') {
        const dataSist = normalizarData(item.dt_vencimento);
        const nomeSistNorm = normalizarNomeCliente(item.nm_cliente);
        // Buscar no mapa por data+valor (O(1) em vez de O(n))
        const chavesMapa = [
          `${dataSist}|${Math.floor(valorComTaxa)}`,
          `${dataSist}|${Math.ceil(valorComTaxa)}`,
          `${dataSist}|${Math.round(valorComTaxa)}`,
        ];
        for (const chaveMapa of chavesMapa) {
          const candidatos = mapaImportadosPorDataValor.get(chaveMapa);
          if (candidatos) {
            const bate = candidatos.some(({ item: itemArq, nomeNorm }) => {
              const valorArquivo = parseFloat(itemArq.vl_original) || 0;
              if (!valoresProximos(valorArquivo, valorComTaxa)) return false;
              // Verificar se nome do sistema contém nome do arquivo
              return (
                nomeSistNorm.includes(nomeNorm) ||
                nomeNorm.includes(nomeSistNorm.substring(0, 15))
              );
            });
            if (bate) return true;
          }
        }
      }

      // Para SICREDI: verificar por nome + valor (com tolerância) + vencimento - OTIMIZADO
      if (bancoImportado === 'SICREDI') {
        const dataSist = normalizarData(item.dt_vencimento);
        const nomeSistNorm = normalizarNomeCliente(item.nm_cliente);
        // Buscar no mapa por data+valor (O(1) em vez de O(n))
        const chavesMapa = [
          `${dataSist}|${Math.floor(valorComTaxa)}`,
          `${dataSist}|${Math.ceil(valorComTaxa)}`,
          `${dataSist}|${Math.round(valorComTaxa)}`,
        ];
        for (const chaveMapa of chavesMapa) {
          const candidatos = mapaImportadosPorDataValor.get(chaveMapa);
          if (candidatos) {
            const bate = candidatos.some(({ item: itemArq, nomeNorm }) => {
              const valorArquivo = parseFloat(itemArq.vl_original) || 0;
              if (!valoresProximos(valorArquivo, valorComTaxa)) return false;
              // Verificar se nome do sistema contém nome do arquivo
              return (
                nomeSistNorm.includes(nomeNorm) ||
                nomeNorm.includes(nomeSistNorm.substring(0, 15))
              );
            });
            if (bate) return true;
          }
        }
      }

      // Verificar exceção (EFIGENIA)
      const dataExcecao = verificarExcecao(item.nr_cpfcnpj, valorComTaxa);
      if (dataExcecao) {
        // Criar chave com a data do arquivo (30/12) ao invés da data do sistema
        const chaveExcecao = criarChaveComparacao(
          item.nr_cpfcnpj,
          valorComTaxa,
          dataExcecao,
        );
        return chavesImportados.has(chaveExcecao);
      }

      return false;
    },
    [
      chavesImportados,
      verificarExcecao,
      bancoImportado,
      mapaImportadosPorDataValor,
    ],
  );

  // Mapa otimizado dos dados do SISTEMA indexado por data+valor para busca O(1)
  const mapaSistemaPorDataValor = useMemo(() => {
    if (bancoImportado !== 'SICREDI' && bancoImportado !== 'SANTANDER') {
      return new Map();
    }
    const mapa = new Map();
    dados.forEach((item) => {
      const data = normalizarData(item.dt_vencimento);
      const valor = parseFloat(item.vl_fatura || 0);
      const valoresChave = [
        Math.floor(valor),
        Math.ceil(valor),
        Math.round(valor),
      ];
      const nomeNorm = normalizarNomeCliente(item.nm_cliente);

      valoresChave.forEach((v) => {
        const chave = `${data}|${v}`;
        if (!mapa.has(chave)) {
          mapa.set(chave, []);
        }
        const arr = mapa.get(chave);
        if (!arr.some((x) => x.item === item)) {
          arr.push({ item, nomeNorm });
        }
      });
    });
    return mapa;
  }, [dados, bancoImportado]);

  // Função para verificar se item do arquivo bate com sistema (incluindo exceções)
  const verificarItemArquivoBate = useCallback(
    (item) => {
      const chave = criarChaveComparacao(
        item.nr_cpfcnpj,
        item.vl_original,
        item.dt_vencimento,
      );

      // Verificar batida normal
      if (chavesSistema.has(chave)) return true;

      // Para BB: verificar por fatura + parcela (identificador único)
      if (bancoImportado === 'BB') {
        const chaveBB = criarChaveFaturaParcela(
          item.nr_fatura,
          item.nr_parcela,
        );
        if (chavesSistema.has(chaveBB)) return true;
      }

      // Para SANTANDER/SICREDI: verificar por valor + vencimento + nome (OTIMIZADO)
      if (bancoImportado === 'SANTANDER' || bancoImportado === 'SICREDI') {
        const dataArq = normalizarData(item.dt_vencimento);
        const valorArquivo = parseFloat(item.vl_original) || 0;
        const nomeArqNorm = normalizarNomeCliente(item.nm_cliente);
        // Buscar no mapa por data+valor (O(1) em vez de O(n))
        const chavesMapa = [
          `${dataArq}|${Math.floor(valorArquivo)}`,
          `${dataArq}|${Math.ceil(valorArquivo)}`,
          `${dataArq}|${Math.round(valorArquivo)}`,
        ];
        for (const chaveMapa of chavesMapa) {
          const candidatos = mapaSistemaPorDataValor.get(chaveMapa);
          if (candidatos) {
            const bate = candidatos.some(({ item: itemSist, nomeNorm }) => {
              const valorSistema = parseFloat(itemSist.vl_fatura || 0);
              if (!valoresProximos(valorSistema, valorArquivo)) return false;
              // Verificar se nome do sistema contém nome do arquivo
              return (
                nomeNorm.includes(nomeArqNorm) ||
                nomeArqNorm.includes(nomeNorm.substring(0, 15))
              );
            });
            if (bate) return true;
          }
        }
      }

      // Verificar exceção (EFIGENIA) - se o item está na lista de exceções
      const dataExcecao = verificarExcecao(item.nr_cpfcnpj, item.vl_original);
      if (dataExcecao && normalizarData(item.dt_vencimento) === '2025-12-30') {
        // Esse item do arquivo é uma exceção, verificar se existe no sistema com outra data
        // Procurar no dados do sistema por CPF/CNPJ e valor
        return dados.some((itemSistema) => {
          const valorSistema = parseFloat(itemSistema.vl_fatura || 0) + 0.98;
          return (
            normalizarCpfCnpj(itemSistema.nr_cpfcnpj) ===
              normalizarCpfCnpj(item.nr_cpfcnpj) &&
            normalizarValor(valorSistema) === normalizarValor(item.vl_original)
          );
        });
      }

      return false;
    },
    [
      chavesSistema,
      verificarExcecao,
      dados,
      bancoImportado,
      mapaSistemaPorDataValor,
    ],
  );

  // Dados ordenados com batidos primeiro e alinhados
  const dadosOrdenados = useMemo(() => {
    if (dadosImportados.length === 0) {
      // Sem dados importados, ordenação normal
      if (!ordenacao.campo) return dados;
      return [...dados].sort((a, b) => {
        let valorA = a[ordenacao.campo];
        let valorB = b[ordenacao.campo];
        if (
          ordenacao.campo === 'dt_vencimento' ||
          ordenacao.campo === 'dt_emissao'
        ) {
          valorA = parseDateNoTZ(valorA)?.getTime() || 0;
          valorB = parseDateNoTZ(valorB)?.getTime() || 0;
        }
        if (ordenacao.campo === 'vl_fatura' || ordenacao.campo === 'nr_fat') {
          valorA = parseFloat(valorA) || 0;
          valorB = parseFloat(valorB) || 0;
        }
        if (valorA < valorB) return ordenacao.direcao === 'asc' ? -1 : 1;
        if (valorA > valorB) return ordenacao.direcao === 'asc' ? 1 : -1;
        return 0;
      });
    }

    // Separar batidos e não batidos
    const batidos = [];
    const naoBatidos = [];

    dados.forEach((item) => {
      const valorComTaxa = parseFloat(item.vl_fatura || 0) + 0.98;
      const chave = criarChaveComparacao(
        item.nr_cpfcnpj,
        valorComTaxa,
        item.dt_vencimento,
      );
      if (verificarItemSistemaBate(item)) {
        batidos.push({ ...item, _chaveComparacao: chave });
      } else {
        naoBatidos.push(item);
      }
    });

    // Ordenar batidos pela chave de comparação para alinhar com importados
    batidos.sort((a, b) =>
      a._chaveComparacao.localeCompare(b._chaveComparacao),
    );

    // Retornar batidos primeiro, depois não batidos
    return [...batidos, ...naoBatidos];
  }, [dados, dadosImportados, chavesImportados, ordenacao]);

  // Dados importados ordenados com batidos primeiro e alinhados
  const dadosImportadosOrdenados = useMemo(() => {
    if (dados.length === 0) {
      // Sem dados do sistema, ordenação normal
      if (!ordenacaoImportados.campo) return dadosImportados;
      return [...dadosImportados].sort((a, b) => {
        let valorA = a[ordenacaoImportados.campo];
        let valorB = b[ordenacaoImportados.campo];
        if (
          ordenacaoImportados.campo === 'dt_vencimento' ||
          ordenacaoImportados.campo === 'dt_pagamento'
        ) {
          valorA = parseDateNoTZ(valorA)?.getTime() || 0;
          valorB = parseDateNoTZ(valorB)?.getTime() || 0;
        }
        if (
          ordenacaoImportados.campo === 'vl_original' ||
          ordenacaoImportados.campo === 'vl_pago' ||
          ordenacaoImportados.campo === 'nr_fatura'
        ) {
          valorA = parseFloat(valorA) || 0;
          valorB = parseFloat(valorB) || 0;
        }
        if (valorA < valorB)
          return ordenacaoImportados.direcao === 'asc' ? -1 : 1;
        if (valorA > valorB)
          return ordenacaoImportados.direcao === 'asc' ? 1 : -1;
        return 0;
      });
    }

    // Separar batidos e não batidos
    const batidos = [];
    const naoBatidos = [];

    dadosImportados.forEach((item) => {
      const chave = criarChaveComparacao(
        item.nr_cpfcnpj,
        item.vl_original,
        item.dt_vencimento,
      );
      if (verificarItemArquivoBate(item)) {
        batidos.push({ ...item, _chaveComparacao: chave });
      } else {
        naoBatidos.push(item);
      }
    });

    // Ordenar batidos pela chave de comparação para alinhar com sistema
    batidos.sort((a, b) =>
      a._chaveComparacao.localeCompare(b._chaveComparacao),
    );

    // Retornar batidos primeiro, depois não batidos
    return [...batidos, ...naoBatidos];
  }, [
    dadosImportados,
    dados,
    chavesSistema,
    ordenacaoImportados,
    verificarItemArquivoBate,
  ]);

  // Função para verificar se item do sistema está nos importados
  const itemSistemaEncontrado = useCallback(
    (item) => {
      return verificarItemSistemaBate(item);
    },
    [verificarItemSistemaBate],
  );

  // Função para verificar se item importado está no sistema
  const itemImportadoEncontrado = useCallback(
    (item) => {
      return verificarItemArquivoBate(item);
    },
    [verificarItemArquivoBate],
  );

  // Calcular totais para os cards
  const totaisBatida = useMemo(() => {
    if (dadosImportados.length === 0 || dados.length === 0) {
      return {
        batidosQtd: 0,
        batidosValor: 0,
        naoBatidosSistemaQtd: 0,
        naoBatidosSistemaValor: 0,
        naoBatidosImportadosQtd: 0,
        naoBatidosImportadosValor: 0,
      };
    }

    let batidosQtd = 0;
    let batidosValor = 0;
    let naoBatidosSistemaQtd = 0;
    let naoBatidosSistemaValor = 0;
    let naoBatidosImportadosQtd = 0;
    let naoBatidosImportadosValor = 0;

    // Verificar dados do sistema
    dados.forEach((item) => {
      const valorComTaxa = parseFloat(item.vl_fatura || 0) + 0.98;
      if (verificarItemSistemaBate(item)) {
        batidosQtd++;
        batidosValor += valorComTaxa;
      } else {
        naoBatidosSistemaQtd++;
        naoBatidosSistemaValor += valorComTaxa;
      }
    });

    // Verificar dados importados que não estão no sistema
    dadosImportados.forEach((item) => {
      if (!verificarItemArquivoBate(item)) {
        naoBatidosImportadosQtd++;
        naoBatidosImportadosValor += parseFloat(item.vl_original || 0);
      }
    });

    return {
      batidosQtd,
      batidosValor,
      naoBatidosSistemaQtd,
      naoBatidosSistemaValor,
      naoBatidosImportadosQtd,
      naoBatidosImportadosValor,
    };
  }, [
    dados,
    dadosImportados,
    verificarItemSistemaBate,
    verificarItemArquivoBate,
  ]);

  // Listas filtradas para os modais
  const listaBatidosSistema = useMemo(() => {
    return dados.filter((item) => verificarItemSistemaBate(item));
  }, [dados, verificarItemSistemaBate]);

  const listaNaoBatidosSistema = useMemo(() => {
    return dados.filter((item) => !verificarItemSistemaBate(item));
  }, [dados, verificarItemSistemaBate]);

  const listaNaoBatidosImportados = useMemo(() => {
    return dadosImportados.filter((item) => !verificarItemArquivoBate(item));
  }, [dadosImportados, verificarItemArquivoBate]);

  // Mapa para buscar dados do arquivo importado por chave (para pegar liquidação nos batidos)
  const mapaImportadosPorChave = useMemo(() => {
    const mapa = new Map();
    dadosImportados.forEach((item) => {
      const chave = criarChaveComparacao(
        item.nr_cpfcnpj,
        item.vl_original,
        item.dt_vencimento,
      );
      mapa.set(chave, item);

      // Para SANTANDER: adicionar também pela chave valor|vencimento|nome
      if (bancoImportado === 'SANTANDER') {
        const chaveSantander = criarChaveComparacaoSantander(
          item.vl_original,
          item.dt_vencimento,
          item.nm_cliente,
        );
        mapa.set(chaveSantander, item);
      }

      // Para BB: adicionar também pela chave fatura|parcela
      if (bancoImportado === 'BB') {
        const chaveBB = criarChaveFaturaParcela(
          item.nr_fatura,
          item.nr_parcela,
        );
        mapa.set(chaveBB, item);
      }

      // Para exceções EFIGENIA, adicionar também pela chave CPF|Valor (sem data)
      const dataExcecao = verificarExcecao(item.nr_cpfcnpj, item.vl_original);
      if (dataExcecao) {
        const chaveSimples = `${normalizarCpfCnpj(item.nr_cpfcnpj)}|${normalizarValor(item.vl_original)}`;
        mapa.set(chaveSimples, item);
      }
    });
    return mapa;
  }, [dadosImportados, verificarExcecao, bancoImportado]);

  // Função para buscar item do arquivo correspondente ao item do sistema
  const buscarItemImportadoCorrespondente = useCallback(
    (itemSistema) => {
      const valorComTaxa = parseFloat(itemSistema.vl_fatura || 0) + 0.98;
      const chave = criarChaveComparacao(
        itemSistema.nr_cpfcnpj,
        valorComTaxa,
        itemSistema.dt_vencimento,
      );

      // Busca normal
      let resultado = mapaImportadosPorChave.get(chave);
      if (resultado) return resultado;

      // Para BB: buscar por fatura + parcela
      if (bancoImportado === 'BB') {
        const chaveBB = criarChaveFaturaParcela(
          itemSistema.nr_fat,
          itemSistema.nr_parcela,
        );
        resultado = mapaImportadosPorChave.get(chaveBB);
        if (resultado) return resultado;
      }

      // Para SANTANDER/SICREDI: buscar por valor + vencimento + nome (OTIMIZADO)
      if (bancoImportado === 'SANTANDER' || bancoImportado === 'SICREDI') {
        const valorSistema = parseFloat(itemSistema.vl_fatura || 0);
        const dataSist = normalizarData(itemSistema.dt_vencimento);
        const nomeSistNorm = normalizarNomeCliente(itemSistema.nm_cliente);
        // Buscar no mapa por data+valor
        const chavesMapa = [
          `${dataSist}|${Math.floor(valorSistema)}`,
          `${dataSist}|${Math.ceil(valorSistema)}`,
          `${dataSist}|${Math.round(valorSistema)}`,
        ];
        for (const chaveMapa of chavesMapa) {
          const candidatos = mapaImportadosPorDataValor.get(chaveMapa);
          if (candidatos) {
            const encontrado = candidatos.find(
              ({ item: itemArq, nomeNorm }) => {
                const valorArquivo = parseFloat(itemArq.vl_original) || 0;
                if (!valoresProximos(valorSistema, valorArquivo)) return false;
                return (
                  nomeSistNorm.includes(nomeNorm) ||
                  nomeNorm.includes(nomeSistNorm.substring(0, 15))
                );
              },
            );
            if (encontrado) return encontrado.item;
          }
        }
      }

      // Busca por exceção (EFIGENIA) - usando chave simples CPF|Valor
      const dataExcecao = verificarExcecao(
        itemSistema.nr_cpfcnpj,
        valorComTaxa,
      );
      if (dataExcecao) {
        const chaveSimples = `${normalizarCpfCnpj(itemSistema.nr_cpfcnpj)}|${normalizarValor(valorComTaxa)}`;
        resultado = mapaImportadosPorChave.get(chaveSimples);
      }

      return resultado;
    },
    [
      mapaImportadosPorChave,
      verificarExcecao,
      bancoImportado,
      mapaImportadosPorDataValor,
    ],
  );

  // Lista de registros com baixa "PGTO DE TITULO EFETUADO P/CEDENTE" ou "TITULO DEBITADO EM OPERACAO" (somente CONFIANCA)
  const listaPgtoCedente = useMemo(() => {
    if (bancoImportado !== 'CONFIANCA') return [];
    return dadosImportados.filter((item) => {
      const baixa = (item.descricao_baixa || '').toUpperCase();
      return (
        baixa.includes('PGTO DE TITULO EFETUADO P/CEDENTE') ||
        baixa.includes('TITULO DEBITADO EM OPERACAO')
      );
    });
  }, [dadosImportados, bancoImportado]);

  // Totais para o card PGTO Cedente
  const totaisPgtoCedente = useMemo(() => {
    const qtd = listaPgtoCedente.length;
    const valor = listaPgtoCedente.reduce(
      (acc, item) => acc + parseFloat(item.vl_original || 0),
      0,
    );
    const batidosQtd = listaPgtoCedente.filter((item) => {
      const chave = criarChaveComparacao(
        item.nr_cpfcnpj,
        item.vl_original,
        item.dt_vencimento,
      );
      return chavesSistema.has(chave);
    }).length;
    const naoBatidosQtd = qtd - batidosQtd;
    return { qtd, valor, batidosQtd, naoBatidosQtd };
  }, [listaPgtoCedente, chavesSistema]);

  // Lista de faturas PAGAS - batidas que possuem valor pago em ambas tabelas (sistema e arquivo)
  const listaPagos = useMemo(() => {
    return listaBatidosSistema.filter((itemSistema) => {
      // Verificar se o sistema tem valor pago
      const vlPagoSistema = parseFloat(itemSistema.vl_pago || 0);
      if (vlPagoSistema <= 0) return false;

      // Buscar o item correspondente no arquivo importado
      const itemArquivo = buscarItemImportadoCorrespondente(itemSistema);

      // Verificar se o arquivo também tem valor pago
      if (!itemArquivo) return false;
      const vlPagoArquivo = parseFloat(itemArquivo.vl_pago || 0);
      return vlPagoArquivo > 0;
    });
  }, [listaBatidosSistema, buscarItemImportadoCorrespondente]);

  // Totais para o card PAGOS
  const totaisPagos = useMemo(() => {
    const qtd = listaPagos.length;
    const valorSistema = listaPagos.reduce(
      (acc, item) => acc + parseFloat(item.vl_pago || 0),
      0,
    );
    const valorArquivo = listaPagos.reduce((acc, itemSistema) => {
      const itemArquivo = buscarItemImportadoCorrespondente(itemSistema);
      return acc + parseFloat(itemArquivo?.vl_pago || 0);
    }, 0);
    return { qtd, valorSistema, valorArquivo };
  }, [listaPagos, buscarItemImportadoCorrespondente]);

  // Lista de faturas pagas SOMENTE no Sistema (batidas, mas sem pagamento no arquivo)
  const listaPagosSoSistema = useMemo(() => {
    return listaBatidosSistema.filter((itemSistema) => {
      const vlPagoSistema = parseFloat(itemSistema.vl_pago || 0);
      if (vlPagoSistema <= 0) return false;

      const itemArquivo = buscarItemImportadoCorrespondente(itemSistema);

      if (!itemArquivo) return false;
      const vlPagoArquivo = parseFloat(itemArquivo.vl_pago || 0);
      return vlPagoArquivo <= 0; // Pago no sistema, mas NÃO no arquivo
    });
  }, [listaBatidosSistema, buscarItemImportadoCorrespondente]);

  // Lista de faturas pagas SOMENTE no Arquivo (batidas, mas sem pagamento no sistema)
  const listaPagosSoArquivo = useMemo(() => {
    return listaBatidosSistema.filter((itemSistema) => {
      const vlPagoSistema = parseFloat(itemSistema.vl_pago || 0);

      const itemArquivo = buscarItemImportadoCorrespondente(itemSistema);

      if (!itemArquivo) return false;
      const vlPagoArquivo = parseFloat(itemArquivo.vl_pago || 0);
      return vlPagoSistema <= 0 && vlPagoArquivo > 0; // NÃO pago no sistema, mas pago no arquivo
    });
  }, [listaBatidosSistema, buscarItemImportadoCorrespondente]);

  // Função para exportar dados para Excel
  const exportarParaExcel = useCallback(() => {
    if (!modalDetalheAberto) return;

    const dataAtual = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const nomeBanco = bancoImportado || 'SemBanco';

    const nomesCard = {
      batidos: 'FaturasBatidas',
      soSistema: 'SoNoSistema',
      soArquivo: 'SoNoArquivo',
      divergentes: 'TotalDivergentes',
      pgtoCedente: 'PgtoCedente',
      pagos: 'FaturasPagas',
    };
    const nomeCard = nomesCard[modalDetalheAberto];
    const nomeArquivo = `${nomeBanco}-${dataAtual}-${nomeCard}.xlsx`;

    const workbook = XLSX.utils.book_new();

    // Preparar dados do sistema (batidos ou só no sistema)
    if (
      modalDetalheAberto === 'batidos' ||
      modalDetalheAberto === 'soSistema' ||
      modalDetalheAberto === 'divergentes'
    ) {
      const listaSistema =
        modalDetalheAberto === 'batidos'
          ? listaBatidosSistema
          : listaNaoBatidosSistema;
      const dadosSistema = listaSistema.map((item) => {
        const itemImportado = buscarItemImportadoCorrespondente(item);
        return {
          Cód: item.cd_cliente || '',
          Fatura: item.nr_fat || '',
          Cliente: item.nm_cliente || '',
          'CPF/CNPJ': item.nr_cpfcnpj || '',
          Valor: parseFloat(item.vl_fatura || 0) + 0.98,
          Vencimento: formatDateBR(item.dt_vencimento),
          Empresa: item.cd_empresa || '',
          'Vl.Pago': parseFloat(item.vl_pago || 0),
          'Dt.Liq': formatDateBR(item.dt_liquidacao),
          Portador: item.nr_portador || '',
          ...(modalDetalheAberto === 'batidos' && {
            Liquidação: formatDateBR(itemImportado?.dt_pagamento),
          }),
        };
      });
      const wsSistema = XLSX.utils.json_to_sheet(dadosSistema);
      XLSX.utils.book_append_sheet(
        workbook,
        wsSistema,
        modalDetalheAberto === 'divergentes' ? 'Só no Sistema' : 'Dados',
      );
    }

    // Preparar dados do arquivo (só no arquivo ou divergentes)
    if (
      modalDetalheAberto === 'soArquivo' ||
      modalDetalheAberto === 'divergentes'
    ) {
      const dadosArquivo = listaNaoBatidosImportados.map((item) => ({
        'Nosso Número': item.nosso_numero || '',
        Cliente: item.nm_cliente || '',
        'CPF/CNPJ': item.nr_cpfcnpj || '',
        Valor: parseFloat(item.vl_original || 0),
        'Vl.Pago': parseFloat(item.vl_pago || 0),
        Vencimento: formatDateBR(item.dt_vencimento),
        BAIXA: item.descricao_baixa || '',
        Liquidação: formatDateBR(item.dt_pagamento),
      }));
      const wsArquivo = XLSX.utils.json_to_sheet(dadosArquivo);
      XLSX.utils.book_append_sheet(
        workbook,
        wsArquivo,
        modalDetalheAberto === 'divergentes' ? 'Só no Arquivo' : 'Dados',
      );
    }

    // Preparar dados do modal PGTO Cedente (somente CONFIANCA)
    if (modalDetalheAberto === 'pgtoCedente') {
      const dadosPgtoCedente = listaPgtoCedente.map((item) => {
        const chave = criarChaveComparacao(
          item.nr_cpfcnpj,
          item.vl_original,
          item.dt_vencimento,
        );
        const batido = chavesSistema.has(chave);
        return {
          Status: batido ? 'BATIDO' : 'NÃO BATIDO',
          'Nosso Número': item.nosso_numero || '',
          Cliente: item.nm_cliente || '',
          'CPF/CNPJ': item.nr_cpfcnpj || '',
          Valor: parseFloat(item.vl_original || 0),
          'Vl.Pago': parseFloat(item.vl_pago || 0),
          Vencimento: formatDateBR(item.dt_vencimento),
          BAIXA: item.descricao_baixa || '',
          Liquidação: formatDateBR(item.dt_pagamento),
        };
      });
      const wsPgtoCedente = XLSX.utils.json_to_sheet(dadosPgtoCedente);
      XLSX.utils.book_append_sheet(workbook, wsPgtoCedente, 'Dados');
    }

    // Preparar dados do modal PAGOS
    if (modalDetalheAberto === 'pagos') {
      // Aba 1: Pagos em AMBOS
      const dadosPagos = listaPagos.map((itemSistema) => {
        const itemArquivo = buscarItemImportadoCorrespondente(itemSistema);
        return {
          Cód: itemSistema.cd_cliente || '',
          Fatura: itemSistema.nr_fat || '',
          Cliente: itemSistema.nm_cliente || '',
          'CPF/CNPJ': itemSistema.nr_cpfcnpj || '',
          'Valor Fatura': parseFloat(itemSistema.vl_fatura || 0) + 0.98,
          'Vl.Pago Sistema': parseFloat(itemSistema.vl_pago || 0),
          'Vl.Pago Arquivo': parseFloat(itemArquivo?.vl_pago || 0),
          Vencimento: formatDateBR(itemSistema.dt_vencimento),
          'Dt.Liq Sistema': formatDateBR(itemSistema.dt_pagamento),
          'Dt.Liq Arquivo': formatDateBR(itemArquivo?.dt_pagamento),
        };
      });
      const wsPagos = XLSX.utils.json_to_sheet(dadosPagos);
      XLSX.utils.book_append_sheet(workbook, wsPagos, 'Pagos Ambos');

      // Aba 2: Pagos SOMENTE no Sistema
      if (listaPagosSoSistema.length > 0) {
        const dadosSoSistema = listaPagosSoSistema.map((itemSistema) => ({
          Cód: itemSistema.cd_cliente || '',
          Fatura: itemSistema.nr_fat || '',
          Cliente: itemSistema.nm_cliente || '',
          'CPF/CNPJ': itemSistema.nr_cpfcnpj || '',
          'Valor Fatura': parseFloat(itemSistema.vl_fatura || 0) + 0.98,
          'Vl.Pago Sistema': parseFloat(itemSistema.vl_pago || 0),
          'Vl.Pago Arquivo': 0,
          Vencimento: formatDateBR(itemSistema.dt_vencimento),
          'Dt.Liq Sistema': formatDateBR(itemSistema.dt_pagamento),
        }));
        const wsSoSistema = XLSX.utils.json_to_sheet(dadosSoSistema);
        XLSX.utils.book_append_sheet(workbook, wsSoSistema, 'Só Sistema');
      }

      // Aba 3: Pagos SOMENTE no Arquivo
      if (listaPagosSoArquivo.length > 0) {
        const dadosSoArquivo = listaPagosSoArquivo.map((itemSistema) => {
          const itemArquivo = buscarItemImportadoCorrespondente(itemSistema);
          return {
            Cód: itemSistema.cd_cliente || '',
            Fatura: itemSistema.nr_fat || '',
            Cliente: itemSistema.nm_cliente || '',
            'CPF/CNPJ': itemSistema.nr_cpfcnpj || '',
            'Valor Fatura': parseFloat(itemSistema.vl_fatura || 0) + 0.98,
            'Vl.Pago Sistema': 0,
            'Vl.Pago Arquivo': parseFloat(itemArquivo?.vl_pago || 0),
            Vencimento: formatDateBR(itemSistema.dt_vencimento),
            'Dt.Liq Arquivo': formatDateBR(itemArquivo?.dt_pagamento),
          };
        });
        const wsSoArquivo = XLSX.utils.json_to_sheet(dadosSoArquivo);
        XLSX.utils.book_append_sheet(workbook, wsSoArquivo, 'Só Arquivo');
      }
    }

    const excelBuffer = XLSX.write(workbook, {
      bookType: 'xlsx',
      type: 'array',
    });
    const blob = new Blob([excelBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    saveAs(blob, nomeArquivo);
  }, [
    modalDetalheAberto,
    bancoImportado,
    listaBatidosSistema,
    listaNaoBatidosSistema,
    listaNaoBatidosImportados,
    listaPgtoCedente,
    listaPagos,
    listaPagosSoSistema,
    listaPagosSoArquivo,
    chavesSistema,
    formatDateBR,
    buscarItemImportadoCorrespondente,
  ]);

  // Paginação
  const totalPaginas = Math.ceil(dadosOrdenados.length / itensPorPagina);
  const dadosPaginados = dadosOrdenados.slice(
    (paginaAtual - 1) * itensPorPagina,
    paginaAtual * itensPorPagina,
  );

  // ==========================================
  // FUNÇÕES DE BAIXA DE TÍTULOS (SETTLE)
  // ==========================================

  // Verifica se um item é elegível para baixa (LIQUIDAÇÃO DE COBRANÇA ou PAGO PELO SACADO)
  const isElegivelParaBaixa = useCallback(
    (itemSistema) => {
      const itemArquivo = buscarItemImportadoCorrespondente(itemSistema);
      const baixaArq = (itemArquivo?.descricao_baixa || '').toUpperCase();
      if (baixaArq.includes('SACADO')) return true;
      if (baixaArq.includes('LIQUIDAC') || baixaArq.includes('LIQUIDAÇ'))
        return true;
      return false;
    },
    [buscarItemImportadoCorrespondente],
  );

  // Gera uma chave única para identificar o item na seleção
  const getSettleKey = (itemSistema) =>
    `${itemSistema.cd_empresa || ''}_${itemSistema.cd_cliente || ''}_${itemSistema.nr_fat || ''}_${itemSistema.nr_parcela || ''}`;

  // Toggle de seleção individual
  const toggleSettleItem = (itemSistema) => {
    const key = getSettleKey(itemSistema);
    setSelectedForSettle((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Selecionar/desselecionar todos os elegíveis (respeitando filtro ativo)
  const toggleSelectAllSettle = () => {
    const filtrados = listaPagosSoArquivo.filter((itemSistema) => {
      if (filtroBaixaArquivo === 'TODOS') return true;
      const arq = buscarItemImportadoCorrespondente(itemSistema);
      const desc = (arq?.descricao_baixa || '').toUpperCase();
      if (filtroBaixaArquivo === 'SACADO') return desc.includes('SACADO');
      if (filtroBaixaArquivo === 'LIQUIDACAO')
        return desc.includes('LIQUIDAC') || desc.includes('LIQUIDAÇ');
      if (filtroBaixaArquivo === 'ELEGIVEIS')
        return (
          desc.includes('SACADO') ||
          desc.includes('LIQUIDAC') ||
          desc.includes('LIQUIDAÇ')
        );
      return true;
    });
    const elegiveis = filtrados.filter(isElegivelParaBaixa);
    const keys = elegiveis.map(getSettleKey);
    const allSelected =
      keys.length > 0 && keys.every((k) => selectedForSettle.has(k));
    if (allSelected) {
      // Desselecionar apenas os do filtro ativo
      setSelectedForSettle((prev) => {
        const next = new Set(prev);
        for (const k of keys) next.delete(k);
        return next;
      });
    } else {
      setSelectedForSettle((prev) => {
        const next = new Set(prev);
        for (const k of keys) next.add(k);
        return next;
      });
    }
  };

  // Efetuar baixa dos títulos selecionados
  const handleSettleInvoices = async () => {
    if (selectedForSettle.size === 0) return;

    const itensSelecionados = listaPagosSoArquivo.filter((item) =>
      selectedForSettle.has(getSettleKey(item)),
    );

    if (itensSelecionados.length === 0) return;

    const confirmar = window.confirm(
      `Deseja efetuar a baixa de ${itensSelecionados.length} título(s) no TOTVS?\n\nEssa ação não pode ser desfeita.`,
    );
    if (!confirmar) return;

    setSettleLoading(true);
    try {
      const items = itensSelecionados.map((item) => {
        // Usar vl_fatura do sistema (valor real no TOTVS), NÃO vl_pago do arquivo
        // O arquivo inclui taxa de +0.98 que não faz parte do valor da fatura no TOTVS
        const paidValue = parseFloat(item.vl_fatura || 0);
        // Data de pagamento/liquidação do arquivo
        const itemArquivo = buscarItemImportadoCorrespondente(item);
        const settlementDate = itemArquivo?.dt_pagamento || null;
        return {
          branchCode: item.cd_empresa,
          customerCode: item.cd_cliente,
          receivableCode: item.nr_fat,
          installmentCode: item.nr_parcela,
          paidValue,
          settlementDate,
        };
      });

      console.log('📋 Payload de baixa:', JSON.stringify({ items }, null, 2));

      const response = await fetch(`${TotvsURL}invoices-settle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });

      const result = await response.json();
      console.log('📋 Resposta da baixa:', JSON.stringify(result, null, 2));

      if (result.success) {
        alert(`✅ ${result.message}`);
        setSelectedForSettle(new Set());
      } else {
        // Mostrar detalhes completos do erro (incluindo detalhes do TOTVS)
        const erroMsg = result.errors
          ?.map((e) => {
            let msg = `Fatura ${e.receivableCode}: ${e.error}`;
            if (e.details) {
              msg += `\nDetalhes TOTVS: ${JSON.stringify(e.details)}`;
            }
            if (e.payloadSent) {
              msg += `\nPayload: ${JSON.stringify(e.payloadSent)}`;
            }
            return msg;
          })
          .join('\n\n');
        alert(
          `⚠️ ${result.message}\n\n${result.successCount} baixas com sucesso, ${result.errorCount} erros.${erroMsg ? '\n\nErros:\n' + erroMsg : ''}`,
        );
        // Remover da seleção os que foram com sucesso
        if (result.results?.length > 0) {
          const successKeys = new Set(
            result.results.map(
              (r) =>
                `${r.branchCode}_${r.customerCode || ''}_${r.receivableCode}_${r.installmentCode}`,
            ),
          );
          setSelectedForSettle((prev) => {
            const next = new Set(prev);
            for (const key of successKeys) {
              next.delete(key);
            }
            return next;
          });
        }
      }
    } catch (error) {
      console.error('Erro ao efetuar baixa:', error);
      alert(`❌ Erro ao efetuar baixa: ${error.message}`);
    } finally {
      setSettleLoading(false);
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto flex flex-col items-stretch justify-start py-3 px-2">
      <div className="flex justify-between items-start mb-2">
        <PageTitle
          title="Batida de Carteira"
          subtitle="Acompanhe e gerencie a batida de carteira"
          icon={Wallet}
          iconColor="text-emerald-600"
        />
        <div className="flex gap-2">
          {dadosImportados.length > 0 && (
            <button
              onClick={() => {
                setDadosImportados([]);
                setBancoImportado('');
              }}
              className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors text-sm font-bold shadow-md"
            >
              <X size={18} weight="bold" />
              Limpar Importação
            </button>
          )}
          <button
            onClick={() => setModalImportarAberto(true)}
            className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 transition-colors text-sm font-bold shadow-md"
          >
            <UploadSimple size={18} weight="bold" />
            Importar Arquivo
          </button>
        </div>
      </div>

      {/* Modal de Importação */}
      {modalImportarAberto && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            {/* Header do Modal */}
            <div className="flex justify-between items-center p-4 border-b bg-[#000638] text-white rounded-t-lg">
              <div className="flex items-center gap-2">
                <Bank size={24} weight="bold" />
                <h2 className="text-lg font-bold">Importar Arquivo Bancário</h2>
              </div>
              <button
                onClick={fecharModalImportar}
                className="hover:bg-white/20 p-1 rounded transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            {/* Conteúdo do Modal */}
            <div className="p-4 space-y-4">
              {/* Seleção do Banco/Fonte */}
              <div>
                <label className="block text-sm font-semibold text-[#000638] mb-2">
                  Selecione a Fonte de Dados
                </label>
                <select
                  value={bancoSelecionado}
                  onChange={(e) => setBancoSelecionado(e.target.value)}
                  className="w-full border border-[#000638]/30 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638]"
                >
                  <option value="">Selecione uma opção...</option>
                  <optgroup label="📁 Arquivo do Banco">
                    {bancos.map((banco) => (
                      <option key={banco.codigo} value={banco.codigo}>
                        {banco.nome}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="💾 Dados do Sistema (Offline)">
                    {fontesSystem.map((fonte) => (
                      <option key={fonte.codigo} value={fonte.codigo}>
                        {fonte.nome}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>

              {/* Aviso para importação do sistema */}
              {bancoSelecionado.startsWith('SISTEMA_') && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                  <strong>⚠️ Modo Offline:</strong> Você está importando dados
                  do <strong>SISTEMA</strong> via CSV. Esses dados substituirão
                  os dados que normalmente viriam da API. Depois, importe o
                  arquivo do banco para fazer a batida.
                </div>
              )}

              {/* Dica para Confiança */}
              {bancoSelecionado === 'CONFIANCA' && (
                <div className="bg-cyan-50 border border-cyan-200 rounded-lg p-3 text-xs text-cyan-800">
                  <strong>💡 Dica:</strong> Você pode selecionar múltiplos
                  arquivos ao mesmo tempo (ex: TituloLiquidado.csv e
                  TituloAberto.csv). Segure{' '}
                  <kbd className="px-1 py-0.5 bg-cyan-200 rounded">Ctrl</kbd> e
                  clique nos arquivos desejados.
                </div>
              )}

              {/* Upload de Arquivo */}
              <div>
                <label className="block text-sm font-semibold text-[#000638] mb-2">
                  Selecione o(s) Arquivo(s) (CSV ou Excel)
                </label>
                <div className="border-2 border-dashed border-[#000638]/30 rounded-lg p-4 text-center hover:border-[#000638]/50 transition-colors">
                  <input
                    type="file"
                    accept=".csv,.xls,.xlsx,.txt"
                    multiple
                    onChange={(e) =>
                      setArquivosSelecionados(Array.from(e.target.files))
                    }
                    className="hidden"
                    id="arquivo-upload"
                  />
                  <label
                    htmlFor="arquivo-upload"
                    className="cursor-pointer flex flex-col items-center gap-2"
                  >
                    <File size={40} className="text-[#000638]/50" />
                    {arquivosSelecionados.length > 0 ? (
                      <div className="text-sm text-[#000638]">
                        <span className="font-bold">
                          {arquivosSelecionados.length} arquivo(s)
                          selecionado(s):
                        </span>
                        <ul className="mt-1 text-xs text-gray-600">
                          {arquivosSelecionados.map((arq, idx) => (
                            <li
                              key={idx}
                              className="flex items-center gap-1 justify-center"
                            >
                              <CheckCircle
                                size={12}
                                className="text-green-600"
                              />
                              {arq.name}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <span className="text-sm text-gray-500">
                        Clique para selecionar arquivo(s)
                        <br />
                        <span className="text-xs">
                          (Segure Ctrl para múltiplos)
                        </span>
                      </span>
                    )}
                  </label>
                </div>
              </div>

              {/* Resultado do Upload */}
              {uploadResultado && (
                <div
                  className={`p-4 rounded-lg ${
                    uploadResultado.success
                      ? 'bg-green-50 border border-green-200'
                      : 'bg-red-50 border border-red-200'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    {uploadResultado.success ? (
                      <CheckCircle
                        size={24}
                        className="text-green-600"
                        weight="fill"
                      />
                    ) : (
                      <WarningCircle
                        size={24}
                        className="text-red-600"
                        weight="fill"
                      />
                    )}
                    <span
                      className={`font-semibold ${
                        uploadResultado.success
                          ? 'text-green-700'
                          : 'text-red-700'
                      }`}
                    >
                      {uploadResultado.success ? 'Sucesso!' : 'Erro!'}
                    </span>
                  </div>
                  <p
                    className={`text-sm ${
                      uploadResultado.success
                        ? 'text-green-600'
                        : 'text-red-600'
                    }`}
                  >
                    {uploadResultado.message}
                  </p>
                  {uploadResultado.success && uploadResultado.stats && (
                    <div className="mt-3 space-y-2">
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="bg-white p-2 rounded">
                          <span className="text-gray-500">
                            Total Registros:
                          </span>
                          <span className="font-bold text-[#000638] ml-1">
                            {uploadResultado.stats.totalRegistros}
                          </span>
                        </div>
                        <div className="bg-white p-2 rounded">
                          <span className="text-gray-500">Valor Total:</span>
                          <span className="font-bold text-[#000638] ml-1">
                            {(
                              uploadResultado.stats.valorTotalPago ||
                              uploadResultado.stats.valorTotalOriginal ||
                              0
                            ).toLocaleString('pt-BR', {
                              style: 'currency',
                              currency: 'BRL',
                            })}
                          </span>
                        </div>
                      </div>
                      {/* Detalhes por arquivo */}
                      {uploadResultado.stats.arquivosProcessados && (
                        <div className="bg-white p-2 rounded text-xs">
                          <span className="text-gray-500 font-semibold">
                            Arquivos processados:
                          </span>
                          <ul className="mt-1 space-y-1">
                            {uploadResultado.stats.arquivosProcessados.map(
                              (arq, idx) => (
                                <li
                                  key={idx}
                                  className="flex items-center gap-2"
                                >
                                  <CheckCircle
                                    size={12}
                                    className="text-green-600"
                                  />
                                  <span className="font-medium">
                                    {arq.arquivo}
                                  </span>
                                  <span className="text-gray-400">|</span>
                                  <span className="text-gray-600">
                                    {arq.registros} registros
                                  </span>
                                  {arq.tipoArquivo &&
                                    arq.tipoArquivo !== 'DESCONHECIDO' && (
                                      <>
                                        <span className="text-gray-400">|</span>
                                        <span
                                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                            arq.tipoArquivo === 'LIQUIDADO'
                                              ? 'bg-green-100 text-green-700'
                                              : arq.tipoArquivo === 'ABERTO'
                                                ? 'bg-orange-100 text-orange-700'
                                                : 'bg-gray-100 text-gray-700'
                                          }`}
                                        >
                                          {arq.tipoArquivo}
                                        </span>
                                      </>
                                    )}
                                </li>
                              ),
                            )}
                          </ul>
                        </div>
                      )}
                      {/* Erros se houver */}
                      {uploadResultado.stats.erros &&
                        uploadResultado.stats.erros.length > 0 && (
                          <div className="bg-red-50 p-2 rounded text-xs border border-red-200">
                            <span className="text-red-600 font-semibold">
                              Erros:
                            </span>
                            <ul className="mt-1 space-y-1">
                              {uploadResultado.stats.erros.map((err, idx) => (
                                <li
                                  key={idx}
                                  className="flex items-center gap-2 text-red-600"
                                >
                                  <WarningCircle size={12} />
                                  <span>
                                    {err.arquivo}: {err.erro}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer do Modal */}
            <div className="flex justify-end gap-2 p-4 border-t bg-gray-50 rounded-b-lg">
              <button
                onClick={fecharModalImportar}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleUploadArquivo}
                disabled={
                  uploadLoading ||
                  !bancoSelecionado ||
                  arquivosSelecionados.length === 0
                }
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {uploadLoading ? (
                  <>
                    <Spinner size={16} className="animate-spin" />
                    Processando...
                  </>
                ) : (
                  <>
                    <UploadSimple size={16} />
                    {arquivosSelecionados.length > 1
                      ? `Processar ${arquivosSelecionados.length} Arquivos`
                      : 'Processar Arquivo'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Formulário de Filtros */}
      <div className="mb-4">
        <form
          onSubmit={handleFiltrar}
          className="flex flex-col bg-white p-3 rounded-lg shadow-md w-full max-w-4xl mx-auto border border-[#000638]/10"
        >
          <div className="mb-2">
            <span className="text-lg font-bold text-[#000638] flex items-center gap-1">
              <Funnel size={18} weight="bold" />
              Filtros
            </span>
            <span className="text-xs text-gray-500 mt-1">
              Selecione o período e empresa para análise
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 mb-3">
            <div className="lg:col-span-2">
              <FiltroEmpresa
                empresasSelecionadas={empresasSelecionadas}
                onSelectEmpresas={handleSelectEmpresas}
                apenasEmpresa101={true}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Data Início
              </label>
              <input
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] placeholder:text-gray-400 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Data Fim
              </label>
              <input
                type="date"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] placeholder:text-gray-400 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
              >
                <option value="Todos">TODOS</option>
                <option value="Em Aberto">EM ABERTO</option>
                <option value="Pago">PAGO</option>
                <option value="Vencido">VENCIDO</option>
                <option value="A Vencer">A VENCER</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2 mb-3">
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Situação
              </label>
              <select
                value={situacao}
                onChange={(e) => setSituacao(e.target.value)}
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
              >
                <option value="NORMAIS">NORMAIS</option>
                <option value="CANCELADAS">CANCELADAS</option>
                <option value="TODAS">TODAS</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Cobrança
              </label>
              <select
                value={filtroCobranca}
                onChange={(e) => setFiltroCobranca(e.target.value)}
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
              >
                <option value="TODOS">TODOS</option>
                <option value="DESCONTADA">DESCONTADA</option>
                <option value="NÃO ESTÁ EM COBRANÇA">
                  NÃO ESTÁ EM COBRANÇA
                </option>
                <option value="SIMPLES">SIMPLES</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Fatura
              </label>
              <input
                type="text"
                value={filtroFatura}
                onChange={(e) => setFiltroFatura(e.target.value)}
                placeholder="Buscar fatura..."
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] placeholder:text-gray-400 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Portador
              </label>
              <input
                type="text"
                value={filtroPortador}
                onChange={(e) => setFiltroPortador(e.target.value)}
                placeholder="Ex: 422, 1098, 1020..."
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] placeholder:text-gray-400 text-xs"
              />
            </div>
            <div className="lg:col-span-1">
              <FiltroCliente
                clientesSelecionados={clientesSelecionados}
                onSelectClientes={handleSelectClientes}
                dadosClientes={dadosClientes}
              />
            </div>
            <div className="lg:col-span-1">
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Forma Pagamento
              </label>
              <input
                type="text"
                value="1 - FATURA"
                disabled
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full bg-gray-100 text-[#000638] text-xs cursor-not-allowed"
              />
            </div>
            <div className="flex items-center">
              <button
                type="submit"
                className="flex items-center gap-1 bg-[#000638] text-white px-3 py-1 rounded-lg hover:bg-[#fe0000] disabled:opacity-50 disabled:cursor-not-allowed transition-colors h-7 text-xs font-bold shadow-md tracking-wide uppercase"
                disabled={loading || !dataInicio || !dataFim}
              >
                {loading ? (
                  <>
                    <Spinner size={10} className="animate-spin" />
                    <span></span>
                  </>
                ) : (
                  <>
                    <Calendar size={10} />
                    <span>Buscar</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Cards de Resumo da Batida */}
      {dadosImportados.length > 0 && dados.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4 max-w-5xl mx-auto">
          {/* Card Batidos (Encontrados nas duas tabelas) */}
          <button
            onClick={() => setModalDetalheAberto('batidos')}
            className="text-left w-full"
          >
            <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white border-l-4 border-l-green-500 cursor-pointer">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <CheckSquare
                    size={16}
                    className="text-green-600"
                    weight="fill"
                  />
                  <CardTitle className="text-xs font-bold text-green-700">
                    Faturas Batidas
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-3 pb-3">
                <div className="text-lg font-extrabold text-green-600 mb-0.5">
                  {totaisBatida.batidosQtd} registros
                </div>
                <div className="text-sm font-bold text-green-700">
                  {totaisBatida.batidosValor.toLocaleString('pt-BR', {
                    style: 'currency',
                    currency: 'BRL',
                  })}
                </div>
                <CardDescription className="text-xs text-gray-500 mt-1">
                  Presentes em ambas tabelas
                </CardDescription>
              </CardContent>
            </Card>
          </button>

          {/* Card Não Batidos Sistema (Tem no sistema mas não tem no banco) */}
          <button
            onClick={() => setModalDetalheAberto('soSistema')}
            className="text-left w-full"
          >
            <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white border-l-4 border-l-red-500 cursor-pointer">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <XSquare size={16} className="text-red-600" weight="fill" />
                  <CardTitle className="text-xs font-bold text-red-700">
                    Só no Sistema
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-3 pb-3">
                <div className="text-lg font-extrabold text-red-600 mb-0.5">
                  {totaisBatida.naoBatidosSistemaQtd} registros
                </div>
                <div className="text-sm font-bold text-red-700">
                  {totaisBatida.naoBatidosSistemaValor.toLocaleString('pt-BR', {
                    style: 'currency',
                    currency: 'BRL',
                  })}
                </div>
                <CardDescription className="text-xs text-gray-500 mt-1">
                  Não encontrados no arquivo
                </CardDescription>
              </CardContent>
            </Card>
          </button>

          {/* Card Não Batidos Importados (Tem no banco mas não tem no sistema) */}
          <button
            onClick={() => setModalDetalheAberto('soArquivo')}
            className="text-left w-full"
          >
            <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white border-l-4 border-l-orange-500 cursor-pointer">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <XSquare
                    size={16}
                    className="text-orange-600"
                    weight="fill"
                  />
                  <CardTitle className="text-xs font-bold text-orange-700">
                    Só no Arquivo
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-3 pb-3">
                <div className="text-lg font-extrabold text-orange-600 mb-0.5">
                  {totaisBatida.naoBatidosImportadosQtd} registros
                </div>
                <div className="text-sm font-bold text-orange-700">
                  {totaisBatida.naoBatidosImportadosValor.toLocaleString(
                    'pt-BR',
                    {
                      style: 'currency',
                      currency: 'BRL',
                    },
                  )}
                </div>
                <CardDescription className="text-xs text-gray-500 mt-1">
                  Não encontrados no sistema
                </CardDescription>
              </CardContent>
            </Card>
          </button>

          {/* Card Total Não Batidos */}
          <button
            onClick={() => setModalDetalheAberto('divergentes')}
            className="text-left w-full"
          >
            <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white border-l-4 border-l-purple-500 cursor-pointer">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <WarningCircle
                    size={16}
                    className="text-purple-600"
                    weight="fill"
                  />
                  <CardTitle className="text-xs font-bold text-purple-700">
                    Total Divergentes
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-3 pb-3">
                <div className="text-lg font-extrabold text-purple-600 mb-0.5">
                  {totaisBatida.naoBatidosSistemaQtd +
                    totaisBatida.naoBatidosImportadosQtd}{' '}
                  registros
                </div>
                <div className="text-sm font-bold text-purple-700">
                  {(
                    totaisBatida.naoBatidosSistemaValor +
                    totaisBatida.naoBatidosImportadosValor
                  ).toLocaleString('pt-BR', {
                    style: 'currency',
                    currency: 'BRL',
                  })}
                </div>
                <CardDescription className="text-xs text-gray-500 mt-1">
                  Soma das divergências
                </CardDescription>
              </CardContent>
            </Card>
          </button>

          {/* Card PGTO Cedente - Somente para CONFIANCA */}
          {bancoImportado === 'CONFIANCA' && listaPgtoCedente.length > 0 && (
            <button
              onClick={() => setModalDetalheAberto('pgtoCedente')}
              className="text-left w-full"
            >
              <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white border-l-4 border-l-cyan-500 cursor-pointer">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <CurrencyCircleDollar
                      size={16}
                      className="text-cyan-600"
                      weight="fill"
                    />
                    <CardTitle className="text-xs font-bold text-cyan-700">
                      PGTO Cedente
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 px-3 pb-3">
                  <div className="text-lg font-extrabold text-cyan-600 mb-0.5">
                    {totaisPgtoCedente.qtd} registros
                  </div>
                  <div className="text-sm font-bold text-cyan-700">
                    {totaisPgtoCedente.valor.toLocaleString('pt-BR', {
                      style: 'currency',
                      currency: 'BRL',
                    })}
                  </div>
                  <CardDescription className="text-xs text-gray-500 mt-1">
                    <span className="text-green-600 font-bold">
                      {totaisPgtoCedente.batidosQtd} batidos
                    </span>
                    {' / '}
                    <span className="text-gray-600 font-bold">
                      {totaisPgtoCedente.naoBatidosQtd} não batidos
                    </span>
                  </CardDescription>
                </CardContent>
              </Card>
            </button>
          )}

          {/* Card PAGOS - Faturas batidas com valor pago em ambas tabelas */}
          {(listaPagos.length > 0 ||
            listaPagosSoSistema.length > 0 ||
            listaPagosSoArquivo.length > 0) && (
            <button
              onClick={() => setModalDetalheAberto('pagos')}
              className="text-left w-full"
            >
              <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white border-l-4 border-l-blue-500 cursor-pointer">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <Coins size={16} className="text-blue-600" weight="fill" />
                    <CardTitle className="text-xs font-bold text-blue-700">
                      TÍTULOS PAGOS
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 px-3 pb-3">
                  <div className="text-lg font-extrabold text-blue-600 mb-1">
                    {listaPagos.length +
                      listaPagosSoSistema.length +
                      listaPagosSoArquivo.length}{' '}
                    registros
                  </div>
                  <div className="text-[10px] space-y-0.5">
                    <div className="flex justify-between items-center">
                      <span className="text-green-700 font-bold">
                        Em Ambos:
                      </span>
                      <span className="text-green-700 font-extrabold">
                        {listaPagos.length}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-amber-700 font-bold">
                        Só no TOTVS:
                      </span>
                      <span className="text-amber-700 font-extrabold">
                        {listaPagosSoSistema.length}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-rose-700 font-bold">
                        Só no Arquivo:
                      </span>
                      <span className="text-rose-700 font-extrabold">
                        {listaPagosSoArquivo.length}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </button>
          )}
        </div>
      )}

      {/* Modal de Detalhes dos Cards */}
      {modalDetalheAberto && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl mx-4 max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header do Modal */}
            <div
              className={`flex justify-between items-center p-4 border-b text-white rounded-t-lg ${
                modalDetalheAberto === 'batidos'
                  ? 'bg-green-600'
                  : modalDetalheAberto === 'soSistema'
                    ? 'bg-red-600'
                    : modalDetalheAberto === 'soArquivo'
                      ? 'bg-orange-600'
                      : modalDetalheAberto === 'pgtoCedente'
                        ? 'bg-cyan-600'
                        : modalDetalheAberto === 'pagos'
                          ? 'bg-blue-600'
                          : 'bg-purple-600'
              }`}
            >
              <div className="flex items-center gap-2">
                {modalDetalheAberto === 'batidos' && (
                  <CheckSquare size={24} weight="bold" />
                )}
                {modalDetalheAberto === 'soSistema' && (
                  <XSquare size={24} weight="bold" />
                )}
                {modalDetalheAberto === 'soArquivo' && (
                  <XSquare size={24} weight="bold" />
                )}
                {modalDetalheAberto === 'divergentes' && (
                  <WarningCircle size={24} weight="bold" />
                )}
                {modalDetalheAberto === 'pgtoCedente' && (
                  <CurrencyCircleDollar size={24} weight="bold" />
                )}
                {modalDetalheAberto === 'pagos' && (
                  <Coins size={24} weight="bold" />
                )}
                <h2 className="text-lg font-bold">
                  {modalDetalheAberto === 'batidos' && 'Faturas Batidas'}
                  {modalDetalheAberto === 'soSistema' && 'Só no Sistema'}
                  {modalDetalheAberto === 'soArquivo' && 'Só no Arquivo'}
                  {modalDetalheAberto === 'divergentes' && 'Total Divergentes'}
                  {modalDetalheAberto === 'pgtoCedente' &&
                    'PGTO Cedente / Título Debitado'}
                  {modalDetalheAberto === 'pagos' &&
                    'Faturas Pagas (Sistema + Arquivo)'}
                </h2>
              </div>
              <button
                onClick={() => setModalDetalheAberto(null)}
                className="hover:bg-white/20 p-1 rounded transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            {/* Conteúdo do Modal */}
            <div className="p-4 overflow-y-auto flex-1">
              {/* Tabela Sistema (Batidos ou Só no Sistema ou Divergentes) */}
              {(modalDetalheAberto === 'batidos' ||
                modalDetalheAberto === 'soSistema' ||
                modalDetalheAberto === 'divergentes') && (
                <div className="mb-4">
                  {modalDetalheAberto === 'divergentes' && (
                    <h3 className="text-sm font-bold text-red-700 mb-2 flex items-center gap-2">
                      <XSquare
                        size={16}
                        weight="fill"
                        className="text-red-600"
                      />
                      Só no Sistema ({listaNaoBatidosSistema.length} registros)
                    </h3>
                  )}
                  <div className="overflow-x-auto max-h-[300px] overflow-y-auto bg-gray-50 rounded-lg border">
                    <table className="min-w-full text-[10px]">
                      <thead
                        className={`text-white sticky top-0 ${
                          modalDetalheAberto === 'batidos'
                            ? 'bg-green-600'
                            : modalDetalheAberto === 'soSistema'
                              ? 'bg-red-600'
                              : 'bg-red-600'
                        }`}
                      >
                        <tr>
                          <th className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">
                            Cód
                          </th>
                          <th className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">
                            Fatura
                          </th>
                          <th className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">
                            Cliente
                          </th>
                          <th className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">
                            CPF/CNPJ
                          </th>
                          <th className="px-2 py-1.5 text-right font-semibold whitespace-nowrap">
                            Valor
                          </th>
                          <th className="px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                            Vencimento
                          </th>
                          <th className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">
                            Empresa
                          </th>
                          {(modalDetalheAberto === 'soSistema' ||
                            modalDetalheAberto === 'divergentes') && (
                            <>
                              <th className="px-2 py-1.5 text-right font-semibold whitespace-nowrap">
                                Vl.Pago
                              </th>
                              <th className="px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                                Dt.Liq
                              </th>
                              <th className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">
                                Portador
                              </th>
                            </>
                          )}
                          {modalDetalheAberto === 'batidos' && (
                            <th className="px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                              Liquidação
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {(modalDetalheAberto === 'batidos'
                          ? listaBatidosSistema
                          : listaNaoBatidosSistema
                        ).map((item, idx) => (
                          <tr key={idx} className="border-b hover:bg-gray-100">
                            <td className="px-2 py-1 whitespace-nowrap font-medium">
                              {item.cd_cliente || '--'}
                            </td>
                            <td className="px-2 py-1 whitespace-nowrap">
                              {item.nr_fat || '--'}
                            </td>
                            <td className="px-2 py-1 whitespace-nowrap">
                              {item.nm_cliente || '--'}
                            </td>
                            <td className="px-2 py-1 whitespace-nowrap">
                              {formatCpfCnpj(item.nr_cpfcnpj)}
                            </td>
                            <td className="px-2 py-1 text-right whitespace-nowrap font-bold">
                              {(
                                parseFloat(item.vl_fatura || 0) + 0.98
                              ).toLocaleString('pt-BR', {
                                style: 'currency',
                                currency: 'BRL',
                              })}
                            </td>
                            <td className="px-2 py-1 text-center whitespace-nowrap">
                              {formatDateBR(item.dt_vencimento)}
                            </td>
                            <td className="px-2 py-1 whitespace-nowrap">
                              {item.cd_empresa || '--'}
                            </td>
                            {(modalDetalheAberto === 'soSistema' ||
                              modalDetalheAberto === 'divergentes') && (
                              <>
                                <td className="px-2 py-1 text-right whitespace-nowrap font-bold text-emerald-700">
                                  {item.vl_pago
                                    ? parseFloat(item.vl_pago).toLocaleString(
                                        'pt-BR',
                                        {
                                          style: 'currency',
                                          currency: 'BRL',
                                        },
                                      )
                                    : '--'}
                                </td>
                                <td className="px-2 py-1 text-center whitespace-nowrap">
                                  {formatDateBR(item.dt_liquidacao)}
                                </td>
                                <td className="px-2 py-1 whitespace-nowrap">
                                  {item.nr_portador || '--'}
                                </td>
                              </>
                            )}
                            {modalDetalheAberto === 'batidos' && (
                              <td className="px-2 py-1 text-center whitespace-nowrap text-emerald-700 font-semibold">
                                {formatDateBR(
                                  buscarItemImportadoCorrespondente(item)
                                    ?.dt_pagamento,
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Tabela Arquivo (Só no Arquivo ou Divergentes) */}
              {(modalDetalheAberto === 'soArquivo' ||
                modalDetalheAberto === 'divergentes') && (
                <div>
                  {modalDetalheAberto === 'divergentes' && (
                    <h3 className="text-sm font-bold text-orange-700 mb-2 flex items-center gap-2 mt-4">
                      <XSquare
                        size={16}
                        weight="fill"
                        className="text-orange-600"
                      />
                      Só no Arquivo ({listaNaoBatidosImportados.length}{' '}
                      registros)
                    </h3>
                  )}
                  <div className="overflow-x-auto max-h-[300px] overflow-y-auto bg-gray-50 rounded-lg border">
                    <table className="min-w-full text-[10px]">
                      <thead
                        className={`text-white sticky top-0 ${
                          modalDetalheAberto === 'soArquivo'
                            ? 'bg-orange-600'
                            : 'bg-orange-600'
                        }`}
                      >
                        <tr>
                          <th className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">
                            Nosso Número
                          </th>
                          <th className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">
                            Cliente
                          </th>
                          <th className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">
                            CPF/CNPJ
                          </th>
                          <th className="px-2 py-1.5 text-right font-semibold whitespace-nowrap">
                            Valor
                          </th>
                          <th className="px-2 py-1.5 text-right font-semibold whitespace-nowrap">
                            Vl.Pago
                          </th>
                          <th className="px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                            Vencimento
                          </th>
                          <th className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">
                            BAIXA
                          </th>
                          <th className="px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                            Liquidação
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {listaNaoBatidosImportados.map((item, idx) => (
                          <tr key={idx} className="border-b hover:bg-gray-100">
                            <td className="px-2 py-1 whitespace-nowrap">
                              {item.nosso_numero || '--'}
                            </td>
                            <td className="px-2 py-1 whitespace-nowrap">
                              {item.nm_cliente || '--'}
                            </td>
                            <td className="px-2 py-1 whitespace-nowrap">
                              {formatCpfCnpj(item.nr_cpfcnpj)}
                            </td>
                            <td className="px-2 py-1 text-right whitespace-nowrap font-bold">
                              {parseFloat(item.vl_original || 0).toLocaleString(
                                'pt-BR',
                                { style: 'currency', currency: 'BRL' },
                              )}
                            </td>
                            <td className="px-2 py-1 text-right whitespace-nowrap font-bold text-emerald-700">
                              {parseFloat(item.vl_pago || 0).toLocaleString(
                                'pt-BR',
                                { style: 'currency', currency: 'BRL' },
                              )}
                            </td>
                            <td className="px-2 py-1 text-center whitespace-nowrap">
                              {formatDateBR(item.dt_vencimento)}
                            </td>
                            <td className="px-2 py-1 whitespace-nowrap">
                              {item.descricao_baixa || '--'}
                            </td>
                            <td className="px-2 py-1 text-center whitespace-nowrap">
                              {formatDateBR(item.dt_pagamento)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Tabela PGTO Cedente (somente CONFIANCA) */}
              {modalDetalheAberto === 'pgtoCedente' && (
                <div>
                  <div className="overflow-x-auto max-h-[400px] overflow-y-auto bg-gray-50 rounded-lg border">
                    <table className="min-w-full text-[10px]">
                      <thead className="bg-cyan-600 text-white sticky top-0">
                        <tr>
                          <th className="px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                            Status
                          </th>
                          <th className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">
                            Nosso Número
                          </th>
                          <th className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">
                            Cliente
                          </th>
                          <th className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">
                            CPF/CNPJ
                          </th>
                          <th className="px-2 py-1.5 text-right font-semibold whitespace-nowrap">
                            Valor
                          </th>
                          <th className="px-2 py-1.5 text-right font-semibold whitespace-nowrap">
                            Vl.Pago
                          </th>
                          <th className="px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                            Vencimento
                          </th>
                          <th className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">
                            BAIXA
                          </th>
                          <th className="px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                            Liquidação
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {listaPgtoCedente.map((item, idx) => {
                          const chave = criarChaveComparacao(
                            item.nr_cpfcnpj,
                            item.vl_original,
                            item.dt_vencimento,
                          );
                          const batido = chavesSistema.has(chave);
                          return (
                            <tr
                              key={idx}
                              className={`border-b ${
                                batido
                                  ? 'bg-green-100 hover:bg-green-200'
                                  : 'bg-white hover:bg-gray-100'
                              }`}
                            >
                              <td className="px-2 py-1 text-center whitespace-nowrap">
                                {batido ? (
                                  <span className="inline-flex items-center gap-1 text-green-700 font-bold">
                                    <CheckCircle size={14} weight="fill" />
                                    Batido
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-gray-500 font-medium">
                                    <XSquare size={14} weight="fill" />
                                    Não Batido
                                  </span>
                                )}
                              </td>
                              <td className="px-2 py-1 whitespace-nowrap">
                                {item.nosso_numero || '--'}
                              </td>
                              <td className="px-2 py-1 whitespace-nowrap">
                                {item.nm_cliente || '--'}
                              </td>
                              <td className="px-2 py-1 whitespace-nowrap">
                                {formatCpfCnpj(item.nr_cpfcnpj)}
                              </td>
                              <td className="px-2 py-1 text-right whitespace-nowrap font-bold">
                                {parseFloat(
                                  item.vl_original || 0,
                                ).toLocaleString('pt-BR', {
                                  style: 'currency',
                                  currency: 'BRL',
                                })}
                              </td>
                              <td className="px-2 py-1 text-right whitespace-nowrap font-bold text-emerald-700">
                                {parseFloat(item.vl_pago || 0).toLocaleString(
                                  'pt-BR',
                                  { style: 'currency', currency: 'BRL' },
                                )}
                              </td>
                              <td className="px-2 py-1 text-center whitespace-nowrap">
                                {formatDateBR(item.dt_vencimento)}
                              </td>
                              <td className="px-2 py-1 whitespace-nowrap">
                                {item.descricao_baixa || '--'}
                              </td>
                              <td className="px-2 py-1 text-center whitespace-nowrap">
                                {formatDateBR(item.dt_pagamento)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Tabela PAGOS - Faturas pagas em ambas tabelas */}
              {modalDetalheAberto === 'pagos' && (
                <div>
                  {/* Seção: Pagos em AMBOS os canais */}
                  <h3 className="text-sm font-bold text-blue-700 mb-2 flex items-center gap-2">
                    <CheckCircle
                      size={16}
                      weight="fill"
                      className="text-blue-600"
                    />
                    Pago em Ambos - Sistema e Arquivo ({listaPagos.length}{' '}
                    registros)
                  </h3>
                  <div className="overflow-x-auto max-h-[300px] overflow-y-auto bg-gray-50 rounded-lg border">
                    <table className="min-w-full text-[10px]">
                      <thead className="bg-blue-600 text-white sticky top-0">
                        <tr>
                          <th className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">
                            Cód
                          </th>
                          <th className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">
                            Fatura
                          </th>
                          <th className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">
                            Cliente
                          </th>
                          <th className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">
                            CPF/CNPJ
                          </th>
                          <th className="px-2 py-1.5 text-right font-semibold whitespace-nowrap">
                            Valor Fatura
                          </th>
                          <th className="px-2 py-1.5 text-right font-semibold whitespace-nowrap">
                            Vl.Pago Sistema
                          </th>
                          <th className="px-2 py-1.5 text-right font-semibold whitespace-nowrap">
                            Vl.Pago Arquivo
                          </th>
                          <th className="px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                            Vencimento
                          </th>
                          <th className="px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                            Dt.Liq Sistema
                          </th>
                          <th className="px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                            Dt.Liq Arquivo
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {listaPagos.map((itemSistema, idx) => {
                          const itemArquivo =
                            buscarItemImportadoCorrespondente(itemSistema);
                          return (
                            <tr
                              key={idx}
                              className="border-b bg-white hover:bg-blue-50"
                            >
                              <td className="px-2 py-1 whitespace-nowrap">
                                {itemSistema.cd_cliente || '--'}
                              </td>
                              <td className="px-2 py-1 whitespace-nowrap">
                                {itemSistema.nr_fat || '--'}
                              </td>
                              <td className="px-2 py-1 whitespace-nowrap">
                                {itemSistema.nm_cliente || '--'}
                              </td>
                              <td className="px-2 py-1 whitespace-nowrap">
                                {formatCpfCnpj(itemSistema.nr_cpfcnpj)}
                              </td>
                              <td className="px-2 py-1 text-right whitespace-nowrap font-bold">
                                {parseFloat(
                                  itemSistema.vl_fatura || 0,
                                ).toLocaleString('pt-BR', {
                                  style: 'currency',
                                  currency: 'BRL',
                                })}
                              </td>
                              <td className="px-2 py-1 text-right whitespace-nowrap font-bold text-blue-700">
                                {parseFloat(
                                  itemSistema.vl_pago || 0,
                                ).toLocaleString('pt-BR', {
                                  style: 'currency',
                                  currency: 'BRL',
                                })}
                              </td>
                              <td className="px-2 py-1 text-right whitespace-nowrap font-bold text-blue-700">
                                {parseFloat(
                                  itemArquivo?.vl_pago || 0,
                                ).toLocaleString('pt-BR', {
                                  style: 'currency',
                                  currency: 'BRL',
                                })}
                              </td>
                              <td className="px-2 py-1 text-center whitespace-nowrap">
                                {formatDateBR(itemSistema.dt_vencimento)}
                              </td>
                              <td className="px-2 py-1 text-center whitespace-nowrap">
                                {formatDateBR(itemSistema.dt_pagamento)}
                              </td>
                              <td className="px-2 py-1 text-center whitespace-nowrap">
                                {formatDateBR(itemArquivo?.dt_pagamento)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Tabela: Pagos SOMENTE no Sistema */}
                  {listaPagosSoSistema.length > 0 && (
                    <>
                      <h3 className="text-sm font-bold text-amber-700 mb-2 mt-4 flex items-center gap-2">
                        <WarningCircle
                          size={16}
                          weight="fill"
                          className="text-amber-600"
                        />
                        Pago só no Sistema ({listaPagosSoSistema.length}{' '}
                        registros)
                      </h3>
                      <div className="overflow-x-auto max-h-[250px] overflow-y-auto bg-amber-50 rounded-lg border border-amber-200">
                        <table className="min-w-full text-[10px]">
                          <thead className="bg-amber-500 text-white sticky top-0">
                            <tr>
                              <th className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">
                                Cód
                              </th>
                              <th className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">
                                Fatura
                              </th>
                              <th className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">
                                Cliente
                              </th>
                              <th className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">
                                CPF/CNPJ
                              </th>
                              <th className="px-2 py-1.5 text-right font-semibold whitespace-nowrap">
                                Valor Fatura
                              </th>
                              <th className="px-2 py-1.5 text-right font-semibold whitespace-nowrap">
                                Vl.Pago Sistema
                              </th>
                              <th className="px-2 py-1.5 text-right font-semibold whitespace-nowrap">
                                Vl.Pago Arquivo
                              </th>
                              <th className="px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                                Vencimento
                              </th>
                              <th className="px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                                Dt.Liq Sistema
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {listaPagosSoSistema.map((itemSistema, idx) => {
                              const itemArquivo =
                                buscarItemImportadoCorrespondente(itemSistema);
                              return (
                                <tr
                                  key={idx}
                                  className="border-b bg-white hover:bg-amber-100"
                                >
                                  <td className="px-2 py-1 whitespace-nowrap">
                                    {itemSistema.cd_cliente || '--'}
                                  </td>
                                  <td className="px-2 py-1 whitespace-nowrap">
                                    {itemSistema.nr_fat || '--'}
                                  </td>
                                  <td className="px-2 py-1 whitespace-nowrap">
                                    {itemSistema.nm_cliente || '--'}
                                  </td>
                                  <td className="px-2 py-1 whitespace-nowrap">
                                    {formatCpfCnpj(itemSistema.nr_cpfcnpj)}
                                  </td>
                                  <td className="px-2 py-1 text-right whitespace-nowrap font-bold">
                                    {parseFloat(
                                      itemSistema.vl_fatura || 0,
                                    ).toLocaleString('pt-BR', {
                                      style: 'currency',
                                      currency: 'BRL',
                                    })}
                                  </td>
                                  <td className="px-2 py-1 text-right whitespace-nowrap font-bold text-amber-700">
                                    {parseFloat(
                                      itemSistema.vl_pago || 0,
                                    ).toLocaleString('pt-BR', {
                                      style: 'currency',
                                      currency: 'BRL',
                                    })}
                                  </td>
                                  <td className="px-2 py-1 text-right whitespace-nowrap font-bold text-gray-400">
                                    --
                                  </td>
                                  <td className="px-2 py-1 text-center whitespace-nowrap">
                                    {formatDateBR(itemSistema.dt_vencimento)}
                                  </td>
                                  <td className="px-2 py-1 text-center whitespace-nowrap">
                                    {formatDateBR(itemSistema.dt_pagamento)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}

                  {/* Tabela: Pagos SOMENTE no Arquivo */}
                  {listaPagosSoArquivo.length > 0 && (
                    <>
                      <div className="flex items-center justify-between mt-4 mb-2 flex-wrap gap-2">
                        <h3 className="text-sm font-bold text-rose-700 flex items-center gap-2">
                          <WarningCircle
                            size={16}
                            weight="fill"
                            className="text-rose-600"
                          />
                          Pago só no Arquivo ({listaPagosSoArquivo.length}{' '}
                          registros)
                        </h3>
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* Filtro por tipo de baixa */}
                          <div className="flex items-center gap-1 bg-white border border-rose-200 rounded-lg px-1 py-0.5">
                            <Funnel size={12} className="text-rose-500 ml-1" />
                            {[
                              { value: 'TODOS', label: 'Todos' },
                              { value: 'SACADO', label: 'Sacado' },
                              { value: 'LIQUIDACAO', label: 'Liquidação' },
                              { value: 'ELEGIVEIS', label: 'Elegíveis' },
                            ].map((opt) => (
                              <button
                                key={opt.value}
                                onClick={() => setFiltroBaixaArquivo(opt.value)}
                                className={`px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${
                                  filtroBaixaArquivo === opt.value
                                    ? 'bg-[#000638] text-white'
                                    : 'text-gray-600 hover:bg-rose-100'
                                }`}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                          {/* Botão expandir/recolher */}
                          <button
                            onClick={() =>
                              setExpandPagoSoArquivo((prev) => !prev)
                            }
                            className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold text-rose-700 bg-white border border-rose-200 rounded-lg hover:bg-rose-100 transition-colors"
                            title={
                              expandPagoSoArquivo
                                ? 'Recolher tabela'
                                : 'Expandir tabela'
                            }
                          >
                            {expandPagoSoArquivo ? (
                              <ArrowsInSimple size={13} weight="bold" />
                            ) : (
                              <ArrowsOutSimple size={13} weight="bold" />
                            )}
                            {expandPagoSoArquivo ? 'Recolher' : 'Expandir'}
                          </button>
                          {/* Botão de baixa */}
                          {selectedForSettle.size > 0 && (
                            <button
                              onClick={handleSettleInvoices}
                              disabled={settleLoading}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-[#000638] hover:bg-[#fe0000] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {settleLoading ? (
                                <>
                                  <Spinner size={14} className="animate-spin" />
                                  Processando...
                                </>
                              ) : (
                                <>
                                  <CheckCircle size={14} weight="bold" />
                                  Efetuar Baixa ({selectedForSettle.size})
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                      <div
                        className={`overflow-x-auto ${expandPagoSoArquivo ? 'max-h-[80vh]' : 'max-h-[250px]'} overflow-y-auto bg-rose-50 rounded-lg border border-rose-200 transition-all duration-300`}
                      >
                        <table className="min-w-full text-[10px]">
                          <thead className="bg-rose-500 text-white sticky top-0">
                            <tr>
                              <th className="px-2 py-1.5 text-center font-semibold whitespace-nowrap w-8">
                                <input
                                  type="checkbox"
                                  className="accent-white cursor-pointer"
                                  checked={(() => {
                                    const filtrados =
                                      listaPagosSoArquivo.filter((it) => {
                                        if (filtroBaixaArquivo === 'TODOS')
                                          return true;
                                        const arq =
                                          buscarItemImportadoCorrespondente(it);
                                        const desc = (
                                          arq?.descricao_baixa || ''
                                        ).toUpperCase();
                                        if (filtroBaixaArquivo === 'SACADO')
                                          return desc.includes('SACADO');
                                        if (filtroBaixaArquivo === 'LIQUIDACAO')
                                          return (
                                            desc.includes('LIQUIDAC') ||
                                            desc.includes('LIQUIDAÇ')
                                          );
                                        if (filtroBaixaArquivo === 'ELEGIVEIS')
                                          return (
                                            desc.includes('SACADO') ||
                                            desc.includes('LIQUIDAC') ||
                                            desc.includes('LIQUIDAÇ')
                                          );
                                        return true;
                                      });
                                    const elegiveis =
                                      filtrados.filter(isElegivelParaBaixa);
                                    return (
                                      elegiveis.length > 0 &&
                                      elegiveis.every((item) =>
                                        selectedForSettle.has(
                                          getSettleKey(item),
                                        ),
                                      )
                                    );
                                  })()}
                                  onChange={toggleSelectAllSettle}
                                  title="Selecionar todos elegíveis para baixa"
                                />
                              </th>
                              <th className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">
                                Cód
                              </th>
                              <th className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">
                                Fatura
                              </th>
                              <th className="px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                                Parcela
                              </th>
                              <th className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">
                                Cliente
                              </th>
                              <th className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">
                                CPF/CNPJ
                              </th>
                              <th className="px-2 py-1.5 text-right font-semibold whitespace-nowrap">
                                Valor Fatura
                              </th>
                              <th className="px-2 py-1.5 text-right font-semibold whitespace-nowrap">
                                Vl.Pago Sistema
                              </th>
                              <th className="px-2 py-1.5 text-right font-semibold whitespace-nowrap">
                                Vl.Pago Arquivo
                              </th>
                              <th className="px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                                Vencimento
                              </th>
                              <th className="px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                                Dt.Liq Arquivo
                              </th>
                              <th className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">
                                Tipo Baixa
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {listaPagosSoArquivo
                              .filter((itemSistema) => {
                                if (filtroBaixaArquivo === 'TODOS') return true;
                                const arq =
                                  buscarItemImportadoCorrespondente(
                                    itemSistema,
                                  );
                                const desc = (
                                  arq?.descricao_baixa || ''
                                ).toUpperCase();
                                if (filtroBaixaArquivo === 'SACADO')
                                  return desc.includes('SACADO');
                                if (filtroBaixaArquivo === 'LIQUIDACAO')
                                  return (
                                    desc.includes('LIQUIDAC') ||
                                    desc.includes('LIQUIDAÇ')
                                  );
                                if (filtroBaixaArquivo === 'ELEGIVEIS')
                                  return (
                                    desc.includes('SACADO') ||
                                    desc.includes('LIQUIDAC') ||
                                    desc.includes('LIQUIDAÇ')
                                  );
                                return true;
                              })
                              .map((itemSistema, idx) => {
                                const itemArquivo =
                                  buscarItemImportadoCorrespondente(
                                    itemSistema,
                                  );
                                const baixaArq = (
                                  itemArquivo?.descricao_baixa || ''
                                ).toUpperCase();
                                let tipoBaixa =
                                  itemArquivo?.descricao_baixa || '--';
                                let tipoBaixaCor = 'text-gray-600';
                                if (baixaArq.includes('CEDENTE')) {
                                  tipoBaixa = 'PAGO PELO CEDENTE';
                                  tipoBaixaCor = 'text-amber-700';
                                } else if (baixaArq.includes('SACADO')) {
                                  tipoBaixa = 'PAGO PELO SACADO';
                                  tipoBaixaCor = 'text-blue-700';
                                } else if (baixaArq.includes('DEBITADO')) {
                                  tipoBaixa = 'TÍTULO DEBITADO EM OPERAÇÃO';
                                  tipoBaixaCor = 'text-rose-700';
                                } else if (
                                  baixaArq.includes('LIQUIDAC') ||
                                  baixaArq.includes('LIQUIDAÇ')
                                ) {
                                  tipoBaixa = 'LIQUIDAÇÃO DE COBRANÇA';
                                  tipoBaixaCor = 'text-green-700';
                                }
                                const elegivel =
                                  baixaArq.includes('SACADO') ||
                                  baixaArq.includes('LIQUIDAC') ||
                                  baixaArq.includes('LIQUIDAÇ');
                                const settleKey = getSettleKey(itemSistema);
                                const isSelected =
                                  selectedForSettle.has(settleKey);
                                return (
                                  <tr
                                    key={idx}
                                    className={`border-b hover:bg-rose-100 ${isSelected ? 'bg-green-50' : 'bg-white'}`}
                                  >
                                    <td className="px-2 py-1 text-center whitespace-nowrap">
                                      {elegivel ? (
                                        <input
                                          type="checkbox"
                                          className="accent-[#000638] cursor-pointer"
                                          checked={isSelected}
                                          onChange={() =>
                                            toggleSettleItem(itemSistema)
                                          }
                                          title="Selecionar para baixa"
                                        />
                                      ) : (
                                        <span
                                          className="text-gray-300"
                                          title="Tipo de baixa não elegível"
                                        >
                                          —
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-2 py-1 whitespace-nowrap">
                                      {itemSistema.cd_cliente || '--'}
                                    </td>
                                    <td className="px-2 py-1 whitespace-nowrap">
                                      {itemSistema.nr_fat || '--'}
                                    </td>
                                    <td className="px-2 py-1 text-center whitespace-nowrap">
                                      {itemArquivo?.nr_parcela ||
                                        itemSistema.nr_parcela ||
                                        '--'}
                                    </td>
                                    <td className="px-2 py-1 whitespace-nowrap">
                                      {itemSistema.nm_cliente || '--'}
                                    </td>
                                    <td className="px-2 py-1 whitespace-nowrap">
                                      {formatCpfCnpj(itemSistema.nr_cpfcnpj)}
                                    </td>
                                    <td className="px-2 py-1 text-right whitespace-nowrap font-bold">
                                      {parseFloat(
                                        itemSistema.vl_fatura || 0,
                                      ).toLocaleString('pt-BR', {
                                        style: 'currency',
                                        currency: 'BRL',
                                      })}
                                    </td>
                                    <td className="px-2 py-1 text-right whitespace-nowrap font-bold text-gray-400">
                                      --
                                    </td>
                                    <td className="px-2 py-1 text-right whitespace-nowrap font-bold text-rose-700">
                                      {parseFloat(
                                        itemArquivo?.vl_pago || 0,
                                      ).toLocaleString('pt-BR', {
                                        style: 'currency',
                                        currency: 'BRL',
                                      })}
                                    </td>
                                    <td className="px-2 py-1 text-center whitespace-nowrap">
                                      {formatDateBR(itemSistema.dt_vencimento)}
                                    </td>
                                    <td className="px-2 py-1 text-center whitespace-nowrap">
                                      {formatDateBR(itemArquivo?.dt_pagamento)}
                                    </td>
                                    <td
                                      className={`px-2 py-1 whitespace-nowrap font-semibold ${tipoBaixaCor}`}
                                    >
                                      {tipoBaixa}
                                    </td>
                                  </tr>
                                );
                              })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Resumo */}
              <div
                className={`mt-4 p-3 rounded-lg ${
                  modalDetalheAberto === 'batidos'
                    ? 'bg-green-50 border border-green-200'
                    : modalDetalheAberto === 'soSistema'
                      ? 'bg-red-50 border border-red-200'
                      : modalDetalheAberto === 'soArquivo'
                        ? 'bg-orange-50 border border-orange-200'
                        : modalDetalheAberto === 'pgtoCedente'
                          ? 'bg-cyan-50 border border-cyan-200'
                          : modalDetalheAberto === 'pagos'
                            ? 'bg-blue-50 border border-blue-200'
                            : 'bg-purple-50 border border-purple-200'
                }`}
              >
                <div className="flex justify-between items-center">
                  <span className="font-bold text-sm">Total:</span>
                  <span
                    className={`font-extrabold text-lg ${
                      modalDetalheAberto === 'batidos'
                        ? 'text-green-600'
                        : modalDetalheAberto === 'soSistema'
                          ? 'text-red-600'
                          : modalDetalheAberto === 'soArquivo'
                            ? 'text-orange-600'
                            : modalDetalheAberto === 'pgtoCedente'
                              ? 'text-cyan-600'
                              : modalDetalheAberto === 'pagos'
                                ? 'text-blue-600'
                                : 'text-purple-600'
                    }`}
                  >
                    {modalDetalheAberto === 'batidos' &&
                      `${
                        listaBatidosSistema.length
                      } registros - ${totaisBatida.batidosValor.toLocaleString(
                        'pt-BR',
                        { style: 'currency', currency: 'BRL' },
                      )}`}
                    {modalDetalheAberto === 'soSistema' &&
                      `${
                        listaNaoBatidosSistema.length
                      } registros - ${totaisBatida.naoBatidosSistemaValor.toLocaleString(
                        'pt-BR',
                        { style: 'currency', currency: 'BRL' },
                      )}`}
                    {modalDetalheAberto === 'soArquivo' &&
                      `${
                        listaNaoBatidosImportados.length
                      } registros - ${totaisBatida.naoBatidosImportadosValor.toLocaleString(
                        'pt-BR',
                        { style: 'currency', currency: 'BRL' },
                      )}`}
                    {modalDetalheAberto === 'divergentes' &&
                      `${
                        listaNaoBatidosSistema.length +
                        listaNaoBatidosImportados.length
                      } registros - ${(
                        totaisBatida.naoBatidosSistemaValor +
                        totaisBatida.naoBatidosImportadosValor
                      ).toLocaleString('pt-BR', {
                        style: 'currency',
                        currency: 'BRL',
                      })}`}
                    {modalDetalheAberto === 'pgtoCedente' &&
                      `${
                        totaisPgtoCedente.qtd
                      } registros - ${totaisPgtoCedente.valor.toLocaleString(
                        'pt-BR',
                        { style: 'currency', currency: 'BRL' },
                      )} (${totaisPgtoCedente.batidosQtd} batidos / ${
                        totaisPgtoCedente.naoBatidosQtd
                      } não batidos)`}
                    {modalDetalheAberto === 'pagos' && (
                      <div className="flex flex-col text-right text-sm">
                        <span className="text-blue-600">
                          Ambos: {totaisPagos.qtd} reg - Sis:{' '}
                          {totaisPagos.valorSistema.toLocaleString('pt-BR', {
                            style: 'currency',
                            currency: 'BRL',
                          })}{' '}
                          / Arq:{' '}
                          {totaisPagos.valorArquivo.toLocaleString('pt-BR', {
                            style: 'currency',
                            currency: 'BRL',
                          })}
                        </span>
                        {listaPagosSoSistema.length > 0 && (
                          <span className="text-amber-600 text-xs">
                            Só Sistema: {listaPagosSoSistema.length} reg -{' '}
                            {listaPagosSoSistema
                              .reduce(
                                (acc, i) => acc + parseFloat(i.vl_pago || 0),
                                0,
                              )
                              .toLocaleString('pt-BR', {
                                style: 'currency',
                                currency: 'BRL',
                              })}
                          </span>
                        )}
                        {listaPagosSoArquivo.length > 0 && (
                          <span className="text-rose-600 text-xs">
                            Só Arquivo: {listaPagosSoArquivo.length} reg -{' '}
                            {listaPagosSoArquivo
                              .reduce((acc, i) => {
                                const itemArq =
                                  buscarItemImportadoCorrespondente(i);
                                return acc + parseFloat(itemArq?.vl_pago || 0);
                              }, 0)
                              .toLocaleString('pt-BR', {
                                style: 'currency',
                                currency: 'BRL',
                              })}
                          </span>
                        )}
                      </div>
                    )}
                  </span>
                </div>
              </div>
            </div>

            {/* Footer do Modal */}
            <div className="p-4 border-t bg-gray-50 flex justify-between">
              <button
                onClick={() => exportarParaExcel()}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-bold text-sm"
              >
                <DownloadSimple size={18} weight="bold" />
                Baixar Excel
              </button>
              <button
                onClick={() => setModalDetalheAberto(null)}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors font-bold text-sm"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Container das Tabelas - Layout lado a lado quando há dados importados */}
      <div
        className={`grid gap-4 ${
          dadosImportados.length > 0
            ? 'grid-cols-1 lg:grid-cols-2'
            : 'grid-cols-1'
        }`}
      >
        {/* Tabela Contas a Receber (Sistema) */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-3 h-3 rounded-full bg-[#000638]"></div>
            <h3 className="text-sm font-bold text-[#000638]">
              Contas a Receber (Sistema)
            </h3>
          </div>
          {loading ? (
            <div className="flex justify-center items-center py-20 bg-white rounded-lg shadow-sm">
              <Spinner className="animate-spin text-emerald-600" size={48} />
            </div>
          ) : dadosCarregados && dados.length > 0 ? (
            <div className="bg-white rounded-lg shadow-sm overflow-hidden">
              <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                <table className="min-w-full text-[10px]">
                  <thead className="bg-[#000638] text-white sticky top-0">
                    <tr>
                      <th
                        className="px-1 py-1 text-left cursor-pointer hover:bg-[#001050] whitespace-nowrap"
                        onClick={() => handleSort('cd_cliente')}
                      >
                        <div className="flex items-center gap-1">
                          Cód {getSortIcon('cd_cliente')}
                        </div>
                      </th>
                      <th
                        className="px-1 py-1 text-left cursor-pointer hover:bg-[#001050] whitespace-nowrap"
                        onClick={() => handleSort('nm_cliente')}
                      >
                        <div className="flex items-center gap-1">
                          Cliente {getSortIcon('nm_cliente')}
                        </div>
                      </th>
                      <th
                        className="px-1 py-1 text-left cursor-pointer hover:bg-[#001050] whitespace-nowrap"
                        onClick={() => handleSort('nr_cpfcnpj')}
                      >
                        <div className="flex items-center gap-1">
                          CPF/CNPJ {getSortIcon('nr_cpfcnpj')}
                        </div>
                      </th>
                      <th
                        className="px-1 py-1 text-left cursor-pointer hover:bg-[#001050] whitespace-nowrap"
                        onClick={() => handleSort('nr_fat')}
                      >
                        <div className="flex items-center gap-1">
                          Fatura {getSortIcon('nr_fat')}
                        </div>
                      </th>
                      <th
                        className="px-1 py-1 text-left cursor-pointer hover:bg-[#001050] whitespace-nowrap"
                        onClick={() => handleSort('dt_vencimento')}
                      >
                        <div className="flex items-center gap-1">
                          Venc. {getSortIcon('dt_vencimento')}
                        </div>
                      </th>
                      <th
                        className="px-1 py-1 text-right cursor-pointer hover:bg-[#001050] whitespace-nowrap"
                        onClick={() => handleSort('vl_fatura')}
                      >
                        <div className="flex items-center justify-end gap-1">
                          Valor {getSortIcon('vl_fatura')}
                        </div>
                      </th>
                      <th
                        className="px-1 py-1 text-right cursor-pointer hover:bg-[#001050] whitespace-nowrap"
                        onClick={() => handleSort('vl_pago')}
                      >
                        <div className="flex items-center justify-end gap-1">
                          Vl.Pago {getSortIcon('vl_pago')}
                        </div>
                      </th>
                      <th
                        className="px-1 py-1 text-left cursor-pointer hover:bg-[#001050] whitespace-nowrap"
                        onClick={() => handleSort('dt_liquidacao')}
                      >
                        <div className="flex items-center gap-1">
                          Dt.Liq {getSortIcon('dt_liquidacao')}
                        </div>
                      </th>
                      <th
                        className="px-1 py-1 text-left cursor-pointer hover:bg-[#001050] whitespace-nowrap"
                        onClick={() => handleSort('nr_portador')}
                      >
                        <div className="flex items-center gap-1">
                          Portador {getSortIcon('nr_portador')}
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {dadosOrdenados.map((item, index) => {
                      const encontrado =
                        dadosImportados.length > 0 &&
                        itemSistemaEncontrado(item);
                      return (
                        <tr
                          key={`${item.cd_cliente}-${item.nr_fat}-${index}`}
                          className={`border-b ${
                            encontrado
                              ? 'bg-emerald-300 hover:bg-emerald-400'
                              : index % 2 === 0
                                ? 'bg-white hover:bg-gray-50'
                                : 'bg-gray-50 hover:bg-gray-100'
                          }`}
                        >
                          <td
                            className={`px-1 py-0.5 font-medium whitespace-nowrap ${
                              encontrado
                                ? 'text-emerald-900 font-bold'
                                : 'text-gray-900'
                            }`}
                          >
                            {item.cd_cliente}
                          </td>
                          <td
                            className={`px-1 py-0.5 whitespace-nowrap ${
                              encontrado
                                ? 'text-emerald-900 font-semibold'
                                : 'text-gray-700'
                            }`}
                          >
                            {item.nm_cliente || '--'}
                          </td>
                          <td
                            className={`px-1 py-0.5 whitespace-nowrap ${
                              encontrado
                                ? 'text-emerald-900 font-semibold'
                                : 'text-gray-700'
                            }`}
                          >
                            {formatCpfCnpj(item.nr_cpfcnpj)}
                          </td>
                          <td
                            className={`px-1 py-0.5 whitespace-nowrap ${
                              encontrado
                                ? 'text-emerald-900 font-semibold'
                                : 'text-gray-700'
                            }`}
                          >
                            {item.nr_fat || '--'}
                          </td>
                          <td
                            className={`px-1 py-0.5 whitespace-nowrap ${
                              encontrado
                                ? 'text-emerald-900 font-semibold'
                                : 'text-gray-700'
                            }`}
                          >
                            {formatDateBR(item.dt_vencimento)}
                          </td>
                          <td
                            className={`px-1 py-0.5 text-right font-medium whitespace-nowrap ${
                              encontrado
                                ? 'text-emerald-900 font-bold'
                                : 'text-gray-900'
                            }`}
                          >
                            {(
                              parseFloat(item.vl_fatura || 0) + 0.98
                            ).toLocaleString('pt-BR', {
                              style: 'currency',
                              currency: 'BRL',
                            })}
                          </td>
                          <td
                            className={`px-1 py-0.5 text-right font-medium whitespace-nowrap ${
                              encontrado
                                ? 'text-emerald-900 font-bold'
                                : 'text-emerald-700'
                            }`}
                          >
                            {item.vl_pago
                              ? parseFloat(item.vl_pago).toLocaleString(
                                  'pt-BR',
                                  {
                                    style: 'currency',
                                    currency: 'BRL',
                                  },
                                )
                              : '--'}
                          </td>
                          <td
                            className={`px-1 py-0.5 whitespace-nowrap ${
                              encontrado
                                ? 'text-emerald-900 font-semibold'
                                : 'text-gray-700'
                            }`}
                          >
                            {formatDateBR(item.dt_liquidacao)}
                          </td>
                          <td
                            className={`px-1 py-0.5 whitespace-nowrap ${
                              encontrado
                                ? 'text-emerald-900 font-semibold'
                                : 'text-gray-700'
                            }`}
                          >
                            {item.nr_portador || '--'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : dadosCarregados ? (
            <div className="bg-white rounded-lg shadow-sm p-8 text-center text-gray-500">
              Nenhum registro encontrado.
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow-sm p-8 text-center text-gray-500">
              Selecione os filtros e clique em "Buscar".
            </div>
          )}
        </div>

        {/* Tabela Dados Importados (Banco) */}
        {dadosImportados.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-3 h-3 rounded-full bg-emerald-600"></div>
              <h3 className="text-sm font-bold text-emerald-700">
                Dados Importados ({bancoSelecionado || 'Banco'}) -{' '}
                {dadosImportados.length} registros
              </h3>
            </div>
            <div className="bg-white rounded-lg shadow-sm overflow-hidden border-2 border-emerald-200">
              <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                <table className="min-w-full text-[10px]">
                  <thead className="bg-emerald-600 text-white sticky top-0">
                    <tr>
                      <th
                        className="px-1 py-1 text-left cursor-pointer hover:bg-emerald-700 whitespace-nowrap"
                        onClick={() => handleSortImportados('nr_cpfcnpj')}
                      >
                        <div className="flex items-center gap-1">
                          CPF/CNPJ {getSortIconImportados('nr_cpfcnpj')}
                        </div>
                      </th>
                      <th
                        className="px-1 py-1 text-left cursor-pointer hover:bg-emerald-700 whitespace-nowrap"
                        onClick={() => handleSortImportados('nm_cliente')}
                      >
                        <div className="flex items-center gap-1">
                          Cliente {getSortIconImportados('nm_cliente')}
                        </div>
                      </th>
                      <th
                        className="px-1 py-1 text-left cursor-pointer hover:bg-emerald-700 whitespace-nowrap"
                        onClick={() => handleSortImportados('nr_fatura')}
                      >
                        <div className="flex items-center gap-1">
                          Nº Doc {getSortIconImportados('nr_fatura')}
                        </div>
                      </th>
                      <th
                        className="px-1 py-1 text-left cursor-pointer hover:bg-emerald-700 whitespace-nowrap"
                        onClick={() => handleSortImportados('dt_vencimento')}
                      >
                        <div className="flex items-center gap-1">
                          Venc. {getSortIconImportados('dt_vencimento')}
                        </div>
                      </th>
                      <th
                        className="px-1 py-1 text-right cursor-pointer hover:bg-emerald-700 whitespace-nowrap"
                        onClick={() => handleSortImportados('vl_original')}
                      >
                        <div className="flex items-center justify-end gap-1">
                          Vl.Orig {getSortIconImportados('vl_original')}
                        </div>
                      </th>
                      <th
                        className="px-1 py-1 text-right cursor-pointer hover:bg-emerald-700 whitespace-nowrap"
                        onClick={() => handleSortImportados('vl_pago')}
                      >
                        <div className="flex items-center justify-end gap-1">
                          Vl.Pago {getSortIconImportados('vl_pago')}
                        </div>
                      </th>
                      <th
                        className="px-1 py-1 text-left cursor-pointer hover:bg-emerald-700 whitespace-nowrap"
                        onClick={() => handleSortImportados('descricao_baixa')}
                      >
                        <div className="flex items-center gap-1">
                          BAIXA {getSortIconImportados('descricao_baixa')}
                        </div>
                      </th>
                      <th
                        className="px-1 py-1 text-left cursor-pointer hover:bg-emerald-700 whitespace-nowrap"
                        onClick={() => handleSortImportados('dt_pagamento')}
                      >
                        <div className="flex items-center gap-1">
                          Dt.Pag {getSortIconImportados('dt_pagamento')}
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {dadosImportadosOrdenados.map((item, index) => {
                      const encontrado =
                        dados.length > 0 && itemImportadoEncontrado(item);
                      return (
                        <tr
                          key={`imp-${item.titu_id || index}-${index}`}
                          className={`border-b ${
                            encontrado
                              ? 'bg-emerald-300 hover:bg-emerald-400'
                              : index % 2 === 0
                                ? 'bg-white hover:bg-emerald-50'
                                : 'bg-gray-50 hover:bg-emerald-50'
                          }`}
                        >
                          <td
                            className={`px-1 py-0.5 whitespace-nowrap ${
                              encontrado
                                ? 'text-emerald-900 font-semibold'
                                : 'text-gray-700'
                            }`}
                          >
                            {formatCpfCnpj(item.nr_cpfcnpj)}
                          </td>
                          <td
                            className={`px-1 py-0.5 whitespace-nowrap ${
                              encontrado
                                ? 'text-emerald-900 font-semibold'
                                : 'text-gray-700'
                            }`}
                          >
                            {item.nm_cliente || '--'}
                          </td>
                          <td
                            className={`px-1 py-0.5 whitespace-nowrap ${
                              encontrado
                                ? 'text-emerald-900 font-semibold'
                                : 'text-gray-700'
                            }`}
                          >
                            {item.nr_fatura || '--'}
                          </td>
                          <td
                            className={`px-1 py-0.5 whitespace-nowrap ${
                              encontrado
                                ? 'text-emerald-900 font-semibold'
                                : 'text-gray-700'
                            }`}
                          >
                            {formatDateBR(item.dt_vencimento)}
                          </td>
                          <td
                            className={`px-1 py-0.5 text-right font-medium whitespace-nowrap ${
                              encontrado
                                ? 'text-emerald-900 font-bold'
                                : 'text-gray-900'
                            }`}
                          >
                            {(item.vl_original || 0).toLocaleString('pt-BR', {
                              style: 'currency',
                              currency: 'BRL',
                            })}
                          </td>
                          <td
                            className={`px-1 py-0.5 text-right font-medium whitespace-nowrap ${
                              encontrado
                                ? 'text-emerald-900 font-bold'
                                : 'text-emerald-700'
                            }`}
                          >
                            {(item.vl_pago || 0).toLocaleString('pt-BR', {
                              style: 'currency',
                              currency: 'BRL',
                            })}
                          </td>
                          <td
                            className={`px-1 py-0.5 whitespace-nowrap ${
                              encontrado ? 'text-green-800' : 'text-gray-700'
                            }`}
                          >
                            {item.descricao_baixa || '--'}
                          </td>
                          <td
                            className={`px-1 py-0.5 whitespace-nowrap ${
                              encontrado ? 'text-green-800' : 'text-gray-700'
                            }`}
                          >
                            {formatDateBR(item.dt_pagamento)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* Totais dos dados importados */}
              <div className="px-4 py-3 border-t bg-emerald-50 flex justify-between text-xs">
                <span className="font-medium text-emerald-700">
                  Total Original:{' '}
                  {dadosImportados
                    .reduce((sum, i) => sum + (i.vl_original || 0), 0)
                    .toLocaleString('pt-BR', {
                      style: 'currency',
                      currency: 'BRL',
                    })}
                </span>
                <span className="font-bold text-emerald-700">
                  Total Pago:{' '}
                  {dadosImportados
                    .reduce((sum, i) => sum + (i.vl_pago || 0), 0)
                    .toLocaleString('pt-BR', {
                      style: 'currency',
                      currency: 'BRL',
                    })}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BatidaCarteira;
