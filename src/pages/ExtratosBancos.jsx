import React, { useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/cards';
import Button from '../components/ui/Button';
import {
  Bank,
  CurrencyCircleDollar,
  TrendUp,
  TrendDown,
  CaretDown,
  CaretUp,
  Spinner,
  CalendarBlank,
} from '@phosphor-icons/react';
import useApiClient from '../hooks/useApiClient';
import LoadingSpinner from '../components/ui/LoadingSpinner';

const BANCOS = [
  { codigo: 'bb', nome: 'Banco do Brasil', cor: 'bg-yellow-500' },
  { codigo: 'caixa', nome: 'Caixa Econômica', cor: 'bg-blue-600' },
  { codigo: 'santander', nome: 'Santander', cor: 'bg-red-600' },
  { codigo: 'itau', nome: 'Itaú', cor: 'bg-orange-500' },
  { codigo: 'sicredi', nome: 'Sicredi', cor: 'bg-green-600' },
  { codigo: 'bnb', nome: 'BNB', cor: 'bg-orange-600' },
  { codigo: 'unicred', nome: 'Unicred', cor: 'bg-green-700' },
  { codigo: 'bradesco', nome: 'Bradesco', cor: 'bg-red-700' },
];

const ExtratosBancos = () => {
  const apiClient = useApiClient();
  const [bancoSelecionado, setBancoSelecionado] = useState(null);
  const [dadosExtratos, setDadosExtratos] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [contasExpandidas, setContasExpandidas] = useState({});

  const handleSelecionarBanco = async (banco) => {
    setBancoSelecionado(banco);
    setDadosExtratos(null);
    setError('');
    setIsLoading(true);
    setContasExpandidas({});

    try {
      console.log(`🏦 Carregando extratos do banco: ${banco.nome}`);
      const response = await apiClient.financial.extratosBanco(banco.codigo);

      if (response.success) {
        setDadosExtratos(response.data);
        console.log('✅ Extratos carregados:', response.data);
      } else {
        setError(response.message || 'Erro ao carregar extratos');
      }
    } catch (err) {
      console.error('❌ Erro ao carregar extratos:', err);
      setError(err.message || 'Erro ao processar extratos do banco');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleConta = (accountName) => {
    setContasExpandidas((prev) => ({
      ...prev,
      [accountName]: !prev[accountName],
    }));
  };

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const formatDate = (dateStr) => {
    // Formatos possíveis: "01/11/2024" ou "2024-11-01"
    if (dateStr.includes('/')) {
      return dateStr; // Já está no formato brasileiro
    }

    // Converter de ISO para brasileiro
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  };

  return (
    <div className="w-full max-w-7xl mx-auto py-8 px-4">
      <h1 className="text-3xl font-bold text-gray-900 font-barlow mb-8">
        Extrato Bancos
      </h1>

      {/* Grid de Botões dos Bancos */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bank size={24} />
            Selecione o Banco
          </CardTitle>
          <CardDescription>
            Escolha um banco para visualizar os extratos processados
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {BANCOS.map((banco) => (
              <Button
                key={banco.codigo}
                onClick={() => handleSelecionarBanco(banco)}
                variant={
                  bancoSelecionado?.codigo === banco.codigo
                    ? 'default'
                    : 'outline'
                }
                className={`h-20 flex flex-col items-center justify-center gap-2 ${
                  bancoSelecionado?.codigo === banco.codigo
                    ? banco.cor + ' text-white hover:opacity-90'
                    : ''
                }`}
              >
                <Bank size={24} weight="fill" />
                <span className="font-semibold text-sm">{banco.nome}</span>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Loading State */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center py-12">
          <Spinner size={48} className="animate-spin text-blue-600 mb-4" />
          <p className="text-gray-600">
            Processando extratos do {bancoSelecionado?.nome}...
          </p>
          <p className="text-sm text-gray-500 mt-2">
            Isso pode levar alguns segundos
          </p>
        </div>
      )}

      {/* Error State */}
      {error && !isLoading && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3 text-red-700">
              <Bank size={24} />
              <div>
                <p className="font-semibold">Erro ao carregar extratos</p>
                <p className="text-sm">{error}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Dados dos Extratos */}
      {dadosExtratos && !isLoading && (
        <>
          {/* Card Consolidado */}
          <Card className="mb-8 border-2 border-blue-200 bg-blue-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-blue-900">
                <CurrencyCircleDollar size={28} weight="fill" />
                Total Geral - {dadosExtratos.banco}
              </CardTitle>
              <CardDescription className="text-blue-700">
                Consolidado de todas as contas •{' '}
                {dadosExtratos.consolidated.totalContas} conta(s) •{' '}
                {dadosExtratos.consolidated.totalTransacoes} transações
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white rounded-lg p-4 shadow-sm">
                  <div className="flex items-center gap-2 text-green-600 mb-2">
                    <TrendUp size={20} weight="bold" />
                    <span className="text-sm font-medium">Total Créditos</span>
                  </div>
                  <p className="text-2xl font-bold text-green-700">
                    {formatCurrency(dadosExtratos.consolidated.totalCredito)}
                  </p>
                </div>

                <div className="bg-white rounded-lg p-4 shadow-sm">
                  <div className="flex items-center gap-2 text-red-600 mb-2">
                    <TrendDown size={20} weight="bold" />
                    <span className="text-sm font-medium">Total Débitos</span>
                  </div>
                  <p className="text-2xl font-bold text-red-700">
                    {formatCurrency(dadosExtratos.consolidated.totalDebito)}
                  </p>
                </div>

                <div className="bg-white rounded-lg p-4 shadow-sm">
                  <div className="flex items-center gap-2 text-blue-600 mb-2">
                    <CurrencyCircleDollar size={20} weight="bold" />
                    <span className="text-sm font-medium">Saldo Líquido</span>
                  </div>
                  <p
                    className={`text-2xl font-bold ${
                      dadosExtratos.consolidated.saldoLiquido >= 0
                        ? 'text-green-700'
                        : 'text-red-700'
                    }`}
                  >
                    {formatCurrency(dadosExtratos.consolidated.saldoLiquido)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Cards por Conta */}
          <div className="space-y-6">
            {dadosExtratos.accounts.map((account) => (
              <Card key={account.account} className="border-gray-200">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Bank size={24} />
                        Conta: {account.account}
                      </CardTitle>
                      <CardDescription>
                        {account.quantidadeTransacoes} transações encontradas
                      </CardDescription>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleConta(account.account)}
                      className="flex items-center gap-2"
                    >
                      {contasExpandidas[account.account] ? (
                        <>
                          <CaretUp size={16} />
                          Ocultar
                        </>
                      ) : (
                        <>
                          <CaretDown size={16} />
                          Ver Detalhes
                        </>
                      )}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {/* Resumo da Conta */}
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="bg-green-50 rounded-lg p-4 border border-green-200">
                      <div className="flex items-center gap-2 text-green-700 mb-1">
                        <TrendUp size={18} weight="bold" />
                        <span className="text-sm font-medium">Créditos</span>
                      </div>
                      <p className="text-xl font-bold text-green-800">
                        {formatCurrency(account.totalCredito)}
                      </p>
                    </div>

                    <div className="bg-red-50 rounded-lg p-4 border border-red-200">
                      <div className="flex items-center gap-2 text-red-700 mb-1">
                        <TrendDown size={18} weight="bold" />
                        <span className="text-sm font-medium">Débitos</span>
                      </div>
                      <p className="text-xl font-bold text-red-800">
                        {formatCurrency(account.totalDebito)}
                      </p>
                    </div>
                  </div>

                  {/* Tabela de Transações (Expansível) */}
                  {contasExpandidas[account.account] && (
                    <div className="border rounded-lg overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-100 border-b">
                            <tr>
                              <th className="text-left p-3 font-semibold text-gray-700">
                                <div className="flex items-center gap-2">
                                  <CalendarBlank size={16} />
                                  Data
                                </div>
                              </th>
                              <th className="text-left p-3 font-semibold text-gray-700">
                                Histórico
                              </th>
                              <th className="text-center p-3 font-semibold text-gray-700">
                                Tipo
                              </th>
                              <th className="text-right p-3 font-semibold text-gray-700">
                                Valor
                              </th>
                              <th className="text-right p-3 font-semibold text-gray-700">
                                Saldo
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {account.transactions
                              .slice(0, 100)
                              .map((tx, idx) => (
                                <tr key={idx} className="hover:bg-gray-50">
                                  <td className="p-3 whitespace-nowrap">
                                    {formatDate(tx.date)}
                                  </td>
                                  <td className="p-3">
                                    <span
                                      className="line-clamp-2"
                                      title={tx.history}
                                    >
                                      {tx.history}
                                    </span>
                                  </td>
                                  <td className="p-3 text-center">
                                    <span
                                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${
                                        tx.type === 'CREDITO'
                                          ? 'bg-green-100 text-green-700'
                                          : 'bg-red-100 text-red-700'
                                      }`}
                                    >
                                      {tx.type === 'CREDITO' ? (
                                        <TrendUp size={12} weight="bold" />
                                      ) : (
                                        <TrendDown size={12} weight="bold" />
                                      )}
                                      {tx.type}
                                    </span>
                                  </td>
                                  <td
                                    className={`p-3 text-right font-semibold ${
                                      tx.type === 'CREDITO'
                                        ? 'text-green-700'
                                        : 'text-red-700'
                                    }`}
                                  >
                                    {formatCurrency(Math.abs(tx.value))}
                                  </td>
                                  <td className="p-3 text-right text-gray-600">
                                    {tx.saldo ? formatCurrency(tx.saldo) : '-'}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                      {account.transactions.length > 100 && (
                        <div className="bg-gray-50 p-3 text-center text-sm text-gray-600">
                          Mostrando 100 de {account.transactions.length}{' '}
                          transações
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Empty State */}
      {!bancoSelecionado && !isLoading && (
        <Card className="border-dashed border-2">
          <CardContent className="pt-12 pb-12">
            <div className="flex flex-col items-center justify-center text-gray-400">
              <Bank size={64} weight="thin" />
              <p className="mt-4 text-lg font-medium">
                Selecione um banco acima
              </p>
              <p className="text-sm">
                Os extratos serão processados e exibidos aqui
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default ExtratosBancos;
