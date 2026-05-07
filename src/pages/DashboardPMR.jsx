import React, { memo, useEffect, useMemo, useState } from 'react';
import FiltroEmpresa from '../components/FiltroEmpresa';
import FiltroFormaPagamento from '../components/FiltroFormaPagamento';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/cards';
import PageTitle from '../components/ui/PageTitle';
import {
  Calendar,
  Clock,
  CurrencyDollar,
  Funnel,
  Receipt,
  Spinner,
} from '@phosphor-icons/react';
import { TotvsURL } from '../config/constants';

const tiposDocumento = {
  1: 'Fatura',
  2: 'Cheque',
  3: 'Dinheiro',
  4: 'Cartão Crédito',
  5: 'Cartão Débito',
  6: 'Nota Débito',
  7: 'TEF',
  8: 'Cheque TEF',
  9: 'Troco',
  10: 'Adiantamento',
  13: 'Vale',
  14: 'Nota Promissória',
  15: 'Cheque Garantido',
  16: 'TED/DOC',
  17: 'Pré-Autorização TEF',
  18: 'Cheque Presente',
  19: 'TEF/TECBAN',
  20: 'CREDEV',
  21: 'Cartão Próprio',
  22: 'TEF/HYPERCARD',
  23: 'Bônus Desconto',
  25: 'Voucher',
  26: 'PIX',
  27: 'PicPay',
  28: 'Ame',
  29: 'Mercado Pago',
  30: 'Marketplace',
  31: 'Outro Documento',
};

const formatCurrency = (value) =>
  (value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });

const EMPTY_SUMMARY = {
  saldoContasReceber: 0,
  vendasPrazo: 0,
  vendasPrazoDia: 0,
  pmrDias: 0,
  quantidadeTitulosAbertos: 0,
  quantidadeFaturas: 0,
  diasPeriodo: 0,
};

const DashboardPMR = memo(() => {
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [tipoBuscaData, setTipoBuscaData] = useState('vencimento');
  const [loading, setLoading] = useState(false);
  const [dadosCarregados, setDadosCarregados] = useState(false);
  const [empresasSelecionadas, setEmpresasSelecionadas] = useState([]);
  const [formasPagamentoSelecionadas, setFormasPagamentoSelecionadas] =
    useState([]);
  const [resumoPMR, setResumoPMR] = useState(EMPTY_SUMMARY);
  const [pmrPorFilial, setPmrPorFilial] = useState([]);

  const dadosFormasPagamento = useMemo(
    () =>
      Object.entries(tiposDocumento).map(([codigo, descricao]) => ({
        codigo,
        descricao,
      })),
    [],
  );

  useEffect(() => {
    const hoje = new Date();
    const primeiro = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    setDataInicio(primeiro.toISOString().split('T')[0]);
    setDataFim(hoje.toISOString().split('T')[0]);
  }, []);

  const buscarDados = async () => {
    if (!dataInicio || !dataFim) return;
    if (empresasSelecionadas.length === 0) {
      alert('Selecione pelo menos uma empresa para consultar!');
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('dt_inicio', dataInicio);
      params.append('dt_fim', dataFim);
      params.append('modo', tipoBuscaData);
      params.append('situacao', '1');

      if (formasPagamentoSelecionadas.length > 0) {
        params.append(
          'tp_documento',
          formasPagamentoSelecionadas.map((f) => f.codigo).join(','),
        );
      }

      params.append(
        'branches',
        empresasSelecionadas.map((empresa) => empresa.cd_empresa).join(','),
      );

      const response = await fetch(
        `${TotvsURL}accounts-receivable/pmr?${params.toString()}`,
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const result = await response.json();
      setResumoPMR(result.data?.summary || EMPTY_SUMMARY);
      setPmrPorFilial(result.data?.byBranch || []);
      setDadosCarregados(true);
    } catch (error) {
      console.error('Erro ao buscar dados do PMR:', error);
      setResumoPMR(EMPTY_SUMMARY);
      setPmrPorFilial([]);
      setDadosCarregados(true);
    } finally {
      setLoading(false);
    }
  };

  const pmrPorGrupo = useMemo(() => {
    const grupoMap = {};
    empresasSelecionadas.forEach((empresa) => {
      grupoMap[String(empresa.cd_empresa)] =
        empresa.nm_grupoempresa || `Empresa ${empresa.cd_empresa}`;
    });

    const acumulado = {};
    pmrPorFilial.forEach((item) => {
      const cdEmpresa = String(item.cd_empresa || '');
      const grupo = grupoMap[cdEmpresa] || `Empresa ${cdEmpresa || 'N/I'}`;

      if (!acumulado[grupo]) {
        acumulado[grupo] = {
          empresa: grupo,
          saldoContasReceber: 0,
          vendasPrazo: 0,
          quantidadeTitulosAbertos: 0,
          quantidadeFaturas: 0,
        };
      }

      acumulado[grupo].saldoContasReceber += Number(
        item.saldoContasReceber || 0,
      );
      acumulado[grupo].vendasPrazo += Number(item.vendasPrazo || 0);
      acumulado[grupo].quantidadeTitulosAbertos += Number(
        item.quantidadeTitulosAbertos || 0,
      );
      acumulado[grupo].quantidadeFaturas += Number(item.quantidadeFaturas || 0);
    });

    return Object.values(acumulado)
      .map((grupo) => {
        const vendasPrazoDia =
          resumoPMR.diasPeriodo > 0
            ? grupo.vendasPrazo / resumoPMR.diasPeriodo
            : 0;
        const pmrDias =
          vendasPrazoDia > 0 ? grupo.saldoContasReceber / vendasPrazoDia : 0;

        return {
          ...grupo,
          vendasPrazoDia,
          pmrDias,
        };
      })
      .sort((a, b) => b.saldoContasReceber - a.saldoContasReceber);
  }, [pmrPorFilial, empresasSelecionadas, resumoPMR.diasPeriodo]);

  return (
    <div className="w-full max-w-7xl mx-auto flex flex-col items-stretch justify-start py-3 px-2">
      <PageTitle
        title="Dashboard PMR"
        subtitle="Prazo Médio de Recebimento com base no saldo a receber e nas vendas a prazo do período"
        icon={Clock}
        iconColor="text-cyan-600"
      />

      <div className="mb-4">
        <div className="flex flex-col bg-white p-3 rounded-lg shadow-md w-full border border-[#000638]/10">
          <div className="mb-2">
            <span className="text-lg font-bold text-[#000638] flex items-center gap-1">
              <Funnel size={18} weight="bold" />
              Filtros
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2 ">
            <div>
              <FiltroEmpresa
                empresasSelecionadas={empresasSelecionadas}
                onSelectEmpresas={setEmpresasSelecionadas}
                apenasEmpresa101={true}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Tipo de Data
              </label>
              <select
                value={tipoBuscaData}
                onChange={(e) => setTipoBuscaData(e.target.value)}
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
              >
                <option value="vencimento">Vencimento</option>
                <option value="emissao">Emissão</option>
                <option value="pagamento">Pagamento</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Data Início
              </label>
              <input
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
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
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
              />
            </div>
            <div>
              <FiltroFormaPagamento
                formasPagamentoSelecionadas={formasPagamentoSelecionadas}
                onSelectFormasPagamento={setFormasPagamentoSelecionadas}
                dadosFormasPagamento={dadosFormasPagamento}
              />
            </div>
            <div>
              <button
                onClick={buscarDados}
                className="flex gap-1 bg-[#000638] text-white px-4 py-1.5 rounded-lg hover:bg-[#fe0000] disabled:opacity-50 disabled:cursor-not-allowed transition-colors h-8 text-xs font-bold shadow-md tracking-wide uppercase w-full justify-center mt-4"
                disabled={loading || !dataInicio || !dataFim}
              >
                {loading ? (
                  <>
                    <Spinner size={12} className="animate-spin" />
                    Carregando...
                  </>
                ) : (
                  <>
                    <Calendar size={12} />
                    Buscar
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {loading && (
        <div className="flex justify-center items-center py-16">
          <Spinner size={32} className="animate-spin text-[#000638]" />
          <span className="ml-3 text-gray-600">Carregando dados...</span>
        </div>
      )}

      {!loading && !dadosCarregados && (
        <div className="flex justify-center items-center py-16 text-gray-500 text-sm">
          Selecione o período e empresa, depois clique em "Buscar"
        </div>
      )}

      {!loading && dadosCarregados && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-6">
            <Card className="shadow-lg rounded-xl bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Receipt size={16} className="text-blue-600" />
                  <CardTitle className="text-xs font-bold text-blue-700">
                    Saldo Contas a Receber
                  </CardTitle>
                </div>
                <CardDescription className="text-xs text-gray-500">
                  Soma do saldo em aberto dos títulos filtrados
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0 px-3 pb-3">
                <div className="text-2xl font-extrabold text-[#000638]">
                  {formatCurrency(resumoPMR.saldoContasReceber)}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {resumoPMR.quantidadeTitulosAbertos.toLocaleString('pt-BR')}{' '}
                  título(s) em aberto
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-lg rounded-xl bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <CurrencyDollar size={16} className="text-emerald-600" />
                  <CardTitle className="text-xs font-bold text-emerald-700">
                    Vendas a Prazo
                  </CardTitle>
                </div>
                <CardDescription className="text-xs text-gray-500">
                  Considera somente títulos do tipo Fatura no período
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0 px-3 pb-3">
                <div className="text-2xl font-extrabold text-[#000638]">
                  {formatCurrency(resumoPMR.vendasPrazo)}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {resumoPMR.quantidadeFaturas.toLocaleString('pt-BR')}{' '}
                  fatura(s)
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-lg rounded-xl bg-white">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Calendar size={16} className="text-orange-600" />
                  <CardTitle className="text-xs font-bold text-orange-700">
                    Vendas a Prazo por Dia
                  </CardTitle>
                </div>
                <CardDescription className="text-xs text-gray-500">
                  Vendas a prazo divididas por {resumoPMR.diasPeriodo} dia(s)
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0 px-3 pb-3">
                <div className="text-2xl font-extrabold text-[#000638]">
                  {formatCurrency(resumoPMR.vendasPrazoDia)}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Base diária do período selecionado
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-lg rounded-xl bg-white border border-cyan-200">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Clock size={16} className="text-cyan-600" />
                  <CardTitle className="text-xs font-bold text-cyan-700">
                    PMR
                  </CardTitle>
                </div>
                <CardDescription className="text-xs text-gray-500">
                  PMR = Contas a Receber / Vendas a Prazo Diárias
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0 px-3 pb-3">
                <div className="text-2xl font-extrabold text-[#000638]">
                  {resumoPMR.pmrDias.toFixed(1).replace('.', ',')} dias
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Quanto tempo o caixa leva para retornar, em média
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="shadow-lg rounded-xl bg-white mb-6">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold text-[#000638]">
                Fórmula do PMR
              </CardTitle>
              <CardDescription className="text-xs text-gray-500">
                Prazo Médio de Recebimento baseado no saldo de contas a receber
                e nas vendas a prazo do mesmo período
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0 px-3 pb-3 text-sm text-gray-700 space-y-1">
              <div>
                PMR = (Contas a Receber / Vendas a Prazo) x Dias do Período
              </div>
              <div>PMR = Contas a Receber / Vendas a Prazo Diárias</div>
              <div className="text-xs text-gray-500 mt-2">
                Neste dashboard, vendas a prazo consideram títulos do tipo
                Fatura e contas a receber consideram apenas saldo aberto acima
                de 0,01.
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-lg rounded-xl bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold text-[#000638]">
                PMR por Grupo de Empresas
              </CardTitle>
              <CardDescription className="text-xs text-gray-500">
                Detalhamento do PMR com a mesma lógica do indicador geral
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0 px-3 pb-3">
              {pmrPorGrupo.length > 0 ? (
                <div className="overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2 font-semibold text-gray-700">
                          Grupo Empresa
                        </th>
                        <th className="text-right px-3 py-2 font-semibold text-gray-700">
                          Contas a Receber
                        </th>
                        <th className="text-right px-3 py-2 font-semibold text-gray-700">
                          Vendas a Prazo
                        </th>
                        <th className="text-right px-3 py-2 font-semibold text-gray-700">
                          Vendas/Dia
                        </th>
                        <th className="text-right px-3 py-2 font-semibold text-cyan-700">
                          PMR
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pmrPorGrupo.map((grupo, index) => (
                        <tr
                          key={`${grupo.empresa}-${index}`}
                          className="border-b border-gray-100 hover:bg-gray-50"
                        >
                          <td className="px-3 py-2 text-gray-800 font-medium">
                            {grupo.empresa}
                          </td>
                          <td className="text-right px-3 py-2 text-gray-700">
                            {formatCurrency(grupo.saldoContasReceber)}
                          </td>
                          <td className="text-right px-3 py-2 text-gray-700">
                            {formatCurrency(grupo.vendasPrazo)}
                          </td>
                          <td className="text-right px-3 py-2 text-gray-700">
                            {formatCurrency(grupo.vendasPrazoDia)}
                          </td>
                          <td className="text-right px-3 py-2 font-bold text-cyan-700 whitespace-nowrap">
                            {grupo.pmrDias.toFixed(1).replace('.', ',')} dias
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center text-gray-400 py-12 text-sm">
                  Nenhum dado encontrado para calcular o PMR
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
});

DashboardPMR.displayName = 'DashboardPMR';

export default DashboardPMR;
