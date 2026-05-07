import React, { useEffect, useMemo, useState, useCallback } from 'react';
import FiltroEmpresa from '../components/FiltroEmpresa';
import FiltroCliente from '../components/FiltroCliente';
import FiltroFormaPagamento from '../components/FiltroFormaPagamento';
import FiltroNomeFantasia from '../components/FiltroNomeFantasia';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/cards';
import PageTitle from '../components/ui/PageTitle';
import { Calendar, Clock, Funnel, Spinner } from '@phosphor-icons/react';

const PMR = () => {
  const [dados, setDados] = useState([]);
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [loading, setLoading] = useState(false);
  const [dadosCarregados, setDadosCarregados] = useState(false);
  const [status, setStatus] = useState('Todos');
  const [situacao, setSituacao] = useState('NORMAIS');
  const [empresasSelecionadas, setEmpresasSelecionadas] = useState([]);

  // filtros adicionais (iguais a ContasAReceber)
  const [filtroFatura, setFiltroFatura] = useState('');
  const [filtroPortador, setFiltroPortador] = useState('');
  const [filtroCobranca, setFiltroCobranca] = useState('TODOS');
  const [filtroTipoCliente, setFiltroTipoCliente] = useState('TODOS');
  const [clientesSelecionados, setClientesSelecionados] = useState([]);
  const [formasPagamentoSelecionadas, setFormasPagamentoSelecionadas] = useState([]);
  const [nomesFantasiaSelecionados, setNomesFantasiaSelecionados] = useState([]);
  const [dadosClientes, setDadosClientes] = useState([]);
  const [dadosFormasPagamento, setDadosFormasPagamento] = useState([]);
  const [dadosNomesFantasia, setDadosNomesFantasia] = useState([]);
  const [infoPessoas, setInfoPessoas] = useState({});

  const BaseURL = 'https://apigestaocrosby-bw2v.onrender.com/api/financial/';

  const parseDateNoTZ = (isoDate) => {
    if (!isoDate) return null;
    try {
      const [datePart] = String(isoDate).split('T');
      const [y, m, d] = datePart.split('-').map(n => parseInt(n, 10));
      if (!y || !m || !d) return null;
      return new Date(y, m - 1, d);
    } catch {
      return null;
    }
  };

  useEffect(() => {
    const hoje = new Date();
    const primeiroDia = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    const ultimoDia = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
    setDataInicio(primeiroDia.toISOString().split('T')[0]);
    setDataFim(ultimoDia.toISOString().split('T')[0]);
  }, []);

  const buscarInfoPessoas = async (codigosPessoa) => {
    if (!codigosPessoa || codigosPessoa.length === 0) return {};
    try {
      const codigosUnicos = [...new Set(codigosPessoa.filter(Boolean))];
      const CHUNK_SIZE = 50;
      const chunks = [];
      for (let i = 0; i < codigosUnicos.length; i += CHUNK_SIZE) {
        chunks.push(codigosUnicos.slice(i, i + CHUNK_SIZE));
      }
      const results = await Promise.all(chunks.map(async (chunk) => {
        const queryParams = chunk.map(codigo => `cd_pessoa=${encodeURIComponent(codigo)}`).join('&');
        const url = `${BaseURL}infopessoa?${queryParams}`;
        try {
          const res = await fetch(url);
          if (!res.ok) return [];
          const data = await res.json();
          if (data?.data?.data && Array.isArray(data.data.data)) return data.data.data;
          if (Array.isArray(data?.data)) return data.data;
          if (Array.isArray(data)) return data;
          return [];
        } catch {
          return [];
        }
      }));
      const infoPessoasObj = {};
      results.flat().forEach((pessoa) => {
        if (pessoa && pessoa.cd_pessoa != null) {
          const key = String(pessoa.cd_pessoa).trim();
          infoPessoasObj[key] = pessoa;
        }
      });
      return infoPessoasObj;
    } catch {
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
    try {
      const resultados = await Promise.all(empresasSelecionadas.map(async (empresa) => {
        try {
          const res = await fetch(`${BaseURL}contas-receberemiss?dt_inicio=${inicio}&dt_fim=${fim}&cd_empresa=${empresa.cd_empresa}`);
          if (!res.ok) return [];
          const data = await res.json();
          let dadosArray = [];
          if (Array.isArray(data)) dadosArray = data;
          else if (data?.dados && Array.isArray(data.dados)) dadosArray = data.dados;
          else if (data?.data && Array.isArray(data.data)) dadosArray = data.data;
          else if (data?.data?.data && Array.isArray(data.data.data)) dadosArray = data.data.data;
          else if (data?.result && Array.isArray(data.result)) dadosArray = data.result;
          else if (data?.contas && Array.isArray(data.contas)) dadosArray = data.contas;
          else dadosArray = Object.values(data || {});
          return dadosArray.filter(item => item && typeof item === 'object');
        } catch {
          return [];
        }
      }));

      const todosOsDados = resultados.flat();
      const codigosClientes = [...new Set(todosOsDados.map(item => item.cd_cliente).filter(Boolean))];
      const infoPessoasData = await buscarInfoPessoas(codigosClientes);
      setInfoPessoas(infoPessoasData);

      const nomesFantasiaUnicos = Object.entries(infoPessoasData)
        .filter(([key, pessoa]) => pessoa.nm_fantasia)
        .map(([key, pessoa]) => ({ cd_cliente: key, nm_fantasia: pessoa.nm_fantasia }))
        .filter((item, index, self) => index === self.findIndex(t => t.nm_fantasia === item.nm_fantasia));
      setDadosNomesFantasia(nomesFantasiaUnicos);

      setDados(todosOsDados);
      setDadosCarregados(true);

      const clientesUnicos = [...new Set(todosOsDados.map(item => JSON.stringify({
        cd_cliente: item.cd_cliente?.toString(),
        nm_cliente: item.nm_cliente
      })))].map(str => JSON.parse(str)).filter(cliente => cliente.cd_cliente && cliente.nm_cliente);
      setDadosClientes(clientesUnicos);

      const formasPagamentoUnicas = [...new Set(todosOsDados.map(item => JSON.stringify({
        codigo: item.tp_documento?.toString(),
        descricao: converterTipoDocumento(item.tp_documento)
      })))].map(str => JSON.parse(str)).filter(forma => forma.codigo && forma.descricao);
      setDadosFormasPagamento(formasPagamentoUnicas);

    } catch (err) {
      setDados([]);
      setDadosCarregados(false);
    } finally {
      setLoading(false);
    }
  };

  const converterTipoDocumento = (numero) => {
    const tiposDocumento = {
      '1': 'Fatura', '2': 'Cheque', '3': 'Dinheiro', '4': 'Cartão crédito', '5': 'Cartão débito',
      '6': 'Nota débito', '7': 'TEF', '8': 'Cheque TEF', '9': 'Troco', '10': 'Adiantamento (saída cx.)',
      '11': 'Desconto financeiro', '12': 'DOFNI', '13': 'Vale', '14': 'Nota promissória', '15': 'Cheque garantido',
      '16': 'TED/DOC', '17': 'Pré-Autorização TEF', '18': 'Cheque presente', '19': 'TEF/TECBAN - BANRISUL',
      '20': 'CREDEV', '21': 'Cartão próprio', '22': 'TEF/HYPERCARD', '23': 'Bônus desconto', '25': 'Voucher',
      '26': 'PIX', '27': 'PicPay', '28': 'Ame', '29': 'Mercado Pago', '30': 'Marketplace', '31': 'Outro documento'
    };
    return tiposDocumento[numero] || numero || 'Não informado';
  };

  // filtros por situação/status e adicionais, espelhando ContasAReceber
  const filtrarDadosPorSituacao = useCallback((lista) => {
    if (!lista || lista.length === 0) return [];
    switch (situacao) {
      case 'NORMAIS':
        return lista.filter(item => !item.dt_cancelamento);
      case 'CANCELADAS':
        return lista.filter(item => item.dt_cancelamento);
      case 'TODAS':
      default:
        return lista;
    }
  }, [situacao]);

  const filtrarDadosPorStatus = useCallback((lista) => {
    if (!lista || lista.length === 0) return [];
    switch (status) {
      case 'Pago':
        return lista.filter(item => parseFloat(item.vl_pago) > 0);
      case 'Vencido': {
        return lista.filter(item => {
          const dv = parseDateNoTZ(item.dt_vencimento);
          const hoje = new Date(); hoje.setHours(0,0,0,0);
          return dv && dv < hoje;
        });
      }
      case 'A Vencer': {
        return lista.filter(item => {
          const dv = parseDateNoTZ(item.dt_vencimento);
          const hoje = new Date(); hoje.setHours(0,0,0,0);
          return !dv || dv >= hoje;
        });
      }
      case 'Todos':
      default:
        return lista;
    }
  }, [status]);

  const dadosFiltrados = useMemo(() => {
    let lista = filtrarDadosPorSituacao(dados);
    lista = filtrarDadosPorStatus(lista);
    // filtros adicionais
    lista = lista.filter((item) => {
      if (clientesSelecionados.length > 0) {
        const cdCliente = item.cd_cliente?.toString();
        const isSelected = clientesSelecionados.some(c => c.cd_cliente?.toString() === cdCliente);
        if (!isSelected) return false;
      }
      if (filtroFatura) {
        const nrFatura = item.nr_fatura || '';
        if (!nrFatura.toString().toLowerCase().includes(filtroFatura.toLowerCase())) return false;
      }
      if (filtroPortador) {
        const nrPortador = item.nr_portador || '';
        if (!nrPortador.toString().toLowerCase().includes(filtroPortador.toLowerCase())) return false;
      }
      if (formasPagamentoSelecionadas.length > 0) {
        const tpDocumento = item.tp_documento?.toString();
        const isSelected = formasPagamentoSelecionadas.some(forma => forma.codigo?.toString() === tpDocumento);
        if (!isSelected) return false;
      }
      if (nomesFantasiaSelecionados.length > 0) {
        if (infoPessoas && Object.keys(infoPessoas).length > 0) {
          const key = String(item.cd_cliente || '').trim();
          const fantasia = infoPessoas[key]?.nm_fantasia;
          const isSelected = nomesFantasiaSelecionados.some(nome => nome.nm_fantasia === fantasia);
          if (!isSelected) return false;
        }
      }
      if (filtroCobranca !== 'TODOS') {
        const tipo = item.tp_cobranca;
        if (filtroCobranca === 'DESCONTADA' && tipo !== '2') return false;
        if (filtroCobranca === 'NÃO ESTÁ EM COBRANÇA' && tipo !== '0') return false;
        if (filtroCobranca === 'SIMPLES' && tipo !== '1') return false;
      }
      if (filtroTipoCliente !== 'TODOS') {
        if (infoPessoas && Object.keys(infoPessoas).length > 0) {
          const key = String(item.cd_cliente || '').trim();
          const fantasia = (infoPessoas[key]?.nm_fantasia || '').toUpperCase();
          const ehFranquia = fantasia.includes(' - CROSBY');
          if (filtroTipoCliente === 'FRANQUIAS' && !ehFranquia) return false;
          if (filtroTipoCliente === 'OUTROS' && ehFranquia) return false;
        }
      }
      return true;
    });
    return lista;
  }, [dados, filtrarDadosPorSituacao, filtrarDadosPorStatus, clientesSelecionados, filtroFatura, filtroPortador, formasPagamentoSelecionadas, nomesFantasiaSelecionados, filtroCobranca, filtroTipoCliente, infoPessoas]);

  // Cálculo do PMCR (média ponderada): diferença em dias entre emissão e liquidação (ou hoje se não pago), ponderado por valor
  const pmcrDias = useMemo(() => {
    if (!dadosFiltrados || dadosFiltrados.length === 0) return 0;
    let somaPonderadaDias = 0;
    let somaPesos = 0;
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    dadosFiltrados.forEach((item) => {
      const emissao = parseDateNoTZ(item.dt_emissao);
      const liquidacao = item.dt_liq ? parseDateNoTZ(item.dt_liq) : hoje;
      if (!emissao) return;
      const dias = Math.max(0, Math.floor((liquidacao - emissao) / (1000 * 60 * 60 * 24)));
      const valorBase = parseFloat(item.vl_fatura) || 0;
      if (valorBase > 0) {
        somaPonderadaDias += dias * valorBase;
        somaPesos += valorBase;
      }
    });
    if (somaPesos === 0) return 0;
    return somaPonderadaDias / somaPesos;
  }, [dadosFiltrados]);

  // Cálculo do PMR por forma de pagamento
  const pmrPorFormaPagamento = useMemo(() => {
    if (!dadosFiltrados || dadosFiltrados.length === 0) return [];
    
    const formasPagamento = {};
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    
    dadosFiltrados.forEach((item) => {
      const tipoDocumento = item.tp_documento?.toString();
      const formaPagamento = converterTipoDocumento(tipoDocumento);
      
      if (!formasPagamento[formaPagamento]) {
        formasPagamento[formaPagamento] = {
          nome: formaPagamento,
          somaPonderadaDias: 0,
          somaPesos: 0,
          quantidade: 0
        };
      }
      
      const emissao = parseDateNoTZ(item.dt_emissao);
      const liquidacao = item.dt_liq ? parseDateNoTZ(item.dt_liq) : hoje;
      
      if (!emissao) return;
      
      const dias = Math.max(0, Math.floor((liquidacao - emissao) / (1000 * 60 * 60 * 24)));
      const valorBase = parseFloat(item.vl_fatura) || 0;
      
      if (valorBase > 0) {
        formasPagamento[formaPagamento].somaPonderadaDias += dias * valorBase;
        formasPagamento[formaPagamento].somaPesos += valorBase;
        formasPagamento[formaPagamento].quantidade += 1;
      }
    });
    
    return Object.values(formasPagamento)
      .filter(forma => forma.somaPesos > 0)
      .map(forma => ({
        ...forma,
        pmrDias: forma.somaPesos > 0 ? forma.somaPonderadaDias / forma.somaPesos : 0
      }))
      .sort((a, b) => b.somaPesos - a.somaPesos); // Ordenar por valor total
  }, [dadosFiltrados]);

  // Cálculo das faturas pagas em mais de 15 dias e menos de 15 dias com PMR
  const faturasPagasPorPrazo = useMemo(() => {
    if (!dadosFiltrados || dadosFiltrados.length === 0) return { 
      mais15Dias: 0, 
      menos15Dias: 0, 
      valorMais15Dias: 0, 
      valorMenos15Dias: 0,
      pmrMais15Dias: 0,
      pmrMenos15Dias: 0
    };
    
    let mais15Dias = 0;
    let menos15Dias = 0;
    let valorMais15Dias = 0;
    let valorMenos15Dias = 0;
    let somaPonderadaMais15Dias = 0;
    let somaPonderadaMenos15Dias = 0;
    
    dadosFiltrados.forEach((item) => {
      // Só considera itens que foram pagos (tem data de liquidação)
      if (!item.dt_liq) return;
      
      const emissao = parseDateNoTZ(item.dt_emissao);
      const liquidacao = parseDateNoTZ(item.dt_liq);
      
      if (!emissao || !liquidacao) return;
      
      const dias = Math.floor((liquidacao - emissao) / (1000 * 60 * 60 * 24));
      const valor = parseFloat(item.vl_fatura) || 0;
      
      if (valor > 0) {
        if (dias > 15) {
          mais15Dias += 1;
          valorMais15Dias += valor;
          somaPonderadaMais15Dias += dias * valor;
        } else if (dias <= 15) {
          menos15Dias += 1;
          valorMenos15Dias += valor;
          somaPonderadaMenos15Dias += dias * valor;
        }
      }
    });
    
    const pmrMais15Dias = valorMais15Dias > 0 ? somaPonderadaMais15Dias / valorMais15Dias : 0;
    const pmrMenos15Dias = valorMenos15Dias > 0 ? somaPonderadaMenos15Dias / valorMenos15Dias : 0;
    
    return { 
      mais15Dias, 
      menos15Dias, 
      valorMais15Dias, 
      valorMenos15Dias,
      pmrMais15Dias,
      pmrMenos15Dias
    };
  }, [dadosFiltrados]);

  const handleFiltrar = (e) => {
    e.preventDefault();
    buscarDados();
  };

  return (
    <div className="w-full max-w-6xl mx-auto flex flex-col items-stretch justify-start py-8 px-4">
      <PageTitle 
        title="PMR - Prazo Médio de Recebimento"
        subtitle="Análise do prazo médio de recebimento baseado nos dados de contas a receber"
        icon={Clock}
        iconColor="text-green-600"
      />

      {/* Formulário de Filtros */}
      <div className="mb-4">
        <form onSubmit={handleFiltrar} className="flex flex-col bg-white p-3 rounded-lg shadow-md w-full max-w-4xl mx-auto border border-[#000638]/10">
          <div className="mb-2">
            <span className="text-lg font-bold text-[#000638] flex items-center gap-1">
              <Funnel size={18} weight="bold" />
              Filtros
            </span>
            <span className="text-xs text-gray-500 mt-1">Selecione o período e empresa para análise</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 mb-3">
            <div className="lg:col-span-2">
              <FiltroEmpresa
                empresasSelecionadas={empresasSelecionadas}
                onSelectEmpresas={setEmpresasSelecionadas}
                apenasEmpresa101={true}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">Data Início</label>
              <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] placeholder:text-gray-400 text-xs" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">Data Fim</label>
              <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] placeholder:text-gray-400 text-xs" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs">
                <option value="Todos">TODOS</option>
                <option value="Pago">PAGO</option>
                <option value="Vencido">VENCIDO</option>
                <option value="A Vencer">A VENCER</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2 mb-3">
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">Situação</label>
              <select value={situacao} onChange={(e) => setSituacao(e.target.value)} className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs">
                <option value="NORMAIS">NORMAIS</option>
                <option value="CANCELADAS">CANCELADAS</option>
                <option value="TODAS">TODAS</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">Cobrança</label>
              <select value={filtroCobranca} onChange={(e) => setFiltroCobranca(e.target.value)} className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs">
                <option value="TODOS">TODOS</option>
                <option value="DESCONTADA">DESCONTADA</option>
                <option value="NÃO ESTÁ EM COBRANÇA">NÃO ESTÁ EM COBRANÇA</option>
                <option value="SIMPLES">SIMPLES</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">Tipo Cliente</label>
              <select value={filtroTipoCliente} onChange={(e) => setFiltroTipoCliente(e.target.value)} className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs">
                <option value="TODOS">TODOS</option>
                <option value="FRANQUIAS">FRANQUIAS</option>
                <option value="OUTROS">OUTROS</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">Fatura</label>
              <input type="text" value={filtroFatura} onChange={(e) => setFiltroFatura(e.target.value)} placeholder="Buscar fatura..." className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] placeholder:text-gray-400 text-xs" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">Portador</label>
              <input type="text" value={filtroPortador} onChange={(e) => setFiltroPortador(e.target.value)} placeholder="Buscar portador..." className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] placeholder:text-gray-400 text-xs" />
            </div>
            <div className="lg:col-span-1">
              <FiltroCliente clientesSelecionados={clientesSelecionados} onSelectClientes={setClientesSelecionados} dadosClientes={dadosClientes} />
            </div>
            <div className="lg:col-3">
              <FiltroFormaPagamento formasPagamentoSelecionadas={formasPagamentoSelecionadas} onSelectFormasPagamento={setFormasPagamentoSelecionadas} dadosFormasPagamento={dadosFormasPagamento} />
            </div>
            <div className="lg:col-span-3">
              <FiltroNomeFantasia nomesFantasiaSelecionados={nomesFantasiaSelecionados} onSelectNomesFantasia={setNomesFantasiaSelecionados} dadosNomesFantasia={dadosNomesFantasia} />
            </div>
            <div className="flex items-end">
              <button type="submit" className="flex items-center gap-1 bg-[#000638] text-white px-3 py-1 rounded-lg hover:bg-[#fe0000] disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors h-7 text-xs font-bold shadow-md tracking-wide uppercase" disabled={loading || !dataInicio || !dataFim}>
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

      {/* Cards principais: PMCR */}
      {dadosCarregados && (
        <div className="mb-8">
          {/* Card PMR Geral */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6 max-w-7xl mx-auto">
            <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Clock size={18} className="text-green-700" />
                  <CardTitle className="text-sm font-bold text-green-700">Prazo Médio de Recebimento</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-4 pb-4">
                <div className="text-3xl font-extrabold text-green-700 mb-1 break-words">
                  {loading ? <Spinner size={24} className="animate-spin text-green-700" /> : `${pmcrDias.toFixed(1)} dias`}
                </div>
                <CardDescription className="text-xs text-gray-500">Média ponderada por valor entre emissão e recebimento</CardDescription>
              </CardContent>
            </Card>

            {/* Faturas Pagas em Mais de 15 Dias */}
            <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Clock size={18} className="text-red-600" />
                  <CardTitle className="text-sm font-bold text-red-700">Faturas Pagas a + de 15 Dias</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-4 pb-4">
                <div className="text-2xl font-extrabold text-red-600 mb-1 break-words">
                  {loading ? <Spinner size={24} className="animate-spin text-red-600" /> : `${faturasPagasPorPrazo.pmrMais15Dias.toFixed(1)} dias`}
                </div>
                <div className="text-sm font-medium text-red-500 mb-1">
                  {loading ? '...' : `${faturasPagasPorPrazo.mais15Dias} faturas • R$ ${faturasPagasPorPrazo.valorMais15Dias.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                </div>
                <CardDescription className="text-xs text-gray-500">PMR das faturas pagas após 15 dias da emissão</CardDescription>
              </CardContent>
            </Card>

            {/* Faturas Pagas em Menos de 15 Dias */}
            <Card className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Clock size={18} className="text-green-600" />
                  <CardTitle className="text-sm font-bold text-green-700">Faturas Pagas a - de 15 Dias</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-4 pb-4">
                <div className="text-2xl font-extrabold text-green-600 mb-1 break-words">
                  {loading ? <Spinner size={24} className="animate-spin text-green-600" /> : `${faturasPagasPorPrazo.pmrMenos15Dias.toFixed(1)} dias`}
                </div>
                <div className="text-sm font-medium text-green-500 mb-1">
                  {loading ? '...' : `${faturasPagasPorPrazo.menos15Dias} faturas • R$ ${faturasPagasPorPrazo.valorMenos15Dias.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                </div>
                <CardDescription className="text-xs text-gray-500">PMR das faturas pagas em até 15 dias da emissão</CardDescription>
              </CardContent>
            </Card>
          </div>

          {/* Cards PMR por Forma de Pagamento */}
          {pmrPorFormaPagamento.length > 0 && (
            <div className="max-w-7xl mx-auto">
              <h3 className="text-lg font-bold text-[#000638] mb-4 text-center">PMR por Forma de Pagamento</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {pmrPorFormaPagamento.map((forma, index) => (
                  <Card key={index} className="shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-1 rounded-xl bg-white">
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2">
                        <Clock size={14} className="text-blue-600" />
                        <CardTitle className="text-xs font-bold text-blue-700 truncate" title={forma.nome}>
                          {forma.nome}
                        </CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0 px-2 pb-2">
                      <div className="text-sm font-extrabold text-blue-600 mb-0.5 break-words">
                        {loading ? <Spinner size={18} className="animate-spin text-blue-600" /> : `${forma.pmrDias.toFixed(1)} dias`}
                      </div>
                      <CardDescription className="text-xs text-gray-500">
                        {forma.quantidade} transação{forma.quantidade !== 1 ? 'ões' : ''} • R$ {forma.somaPesos.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </CardDescription>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PMR;


