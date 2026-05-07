import React from 'react';
import FiltroEmpresa from '../FiltroEmpresa';
import FiltroCentroCusto from '../FiltroCentroCusto';
import FiltroDespesas from '../FiltroDespesas';
import {
  Funnel,
  Calendar,
  Spinner,
  MagnifyingGlass,
  X,
} from '@phosphor-icons/react';

const FiltrosContasPagar = React.memo(
  ({
    modoData,
    setModoData,
    dataInicio,
    setDataInicio,
    dataFim,
    setDataFim,
    situacao,
    setSituacao,
    previsao,
    setPrevisao,
    duplicata,
    setDuplicata,
    empresasSelecionadas,
    handleSelectEmpresas,
    centrosCustoSelecionados,
    handleSelectCentrosCusto,
    despesasSelecionadas,
    handleSelectDespesas,
    dadosCentroCusto,
    dadosDespesa,
    loading,
    fornecedorBuscaSelecionado,
    tipoBuscaFornecedor,
    setTipoBuscaFornecedor,
    termoBuscaFornecedor,
    setTermoBuscaFornecedor,
    setFornecedorBuscaSelecionado,
    buscandoFornecedores,
    buscarFornecedor,
    limparFornecedorBusca,
    handleFiltrar,
    filtroPagamento,
    setFiltroPagamento,
    valorInicial,
    setValorInicial,
    valorFinal,
    setValorFinal,
  }) => {
    return (
      <div className="mb-4">
        <form
          onSubmit={handleFiltrar}
          className="flex flex-col bg-white p-3 rounded-lg shadow-lg w-full border border-[#000638]/10"
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

          {/* Linha 1: Empresas | Tipo Data | Data Início | Data Fim | Situação | Pagamento | Valor Inicial | Valor Final */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2 mb-2">
            <div className="col-span-2">
              <FiltroEmpresa
                empresasSelecionadas={empresasSelecionadas}
                onSelectEmpresas={handleSelectEmpresas}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Tipo de Data
              </label>
              <select
                value={modoData}
                onChange={(e) => setModoData(e.target.value)}
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
              >
                <option value="vencimento">VENCIMENTO</option>
                <option value="emissao">EMISSÃO</option>
                <option value="liquidacao">PAGAMENTO</option>
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
                Situação
              </label>
              <select
                value={situacao}
                onChange={(e) => setSituacao(e.target.value)}
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
              >
                <option value="TODAS">TODAS</option>
                <option value="N">NORMAL</option>
                <option value="C">CANCELADA</option>
                <option value="A">AGRUPADA</option>
                <option value="D">DEVOLVIDA</option>
                <option value="L">LIQUIDADA COMISSÃO</option>
                <option value="Q">QUEBRADA</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Pagamento
              </label>
              <select
                value={filtroPagamento}
                onChange={(e) => setFiltroPagamento(e.target.value)}
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
              >
                <option value="TODOS">TODOS</option>
                <option value="ABERTO">ABERTO</option>
                <option value="PAGO">PAGO</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Valor Inicial (R$)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={valorInicial}
                onChange={(e) => setValorInicial(e.target.value)}
                placeholder="0,00"
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] placeholder:text-gray-400 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Valor Final (R$)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={valorFinal}
                onChange={(e) => setValorFinal(e.target.value)}
                placeholder="0,00"
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] placeholder:text-gray-400 text-xs"
              />
            </div>
          </div>

          {/* Linha 2: Previsão | Fornecedor | Fantasia | Despesas | Duplicata | Centro de Custo | Botão */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Previsão
              </label>
              <select
                value={previsao}
                onChange={(e) => setPrevisao(e.target.value)}
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
              >
                <option value="TODOS">TODOS</option>
                <option value="PREVISÃO">PREVISÃO</option>
                <option value="REAL">REAL</option>
                <option value="CONSIGNADO">CONSIGNADO</option>
              </select>
            </div>
            {/* Tipo de busca de fornecedor */}
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Tp. Busca Fornecedor
              </label>
              <select
                value={tipoBuscaFornecedor}
                onChange={(e) => {
                  setTipoBuscaFornecedor(e.target.value);
                  setTermoBuscaFornecedor('');
                  if (fornecedorBuscaSelecionado)
                    setFornecedorBuscaSelecionado(null);
                }}
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] text-xs"
              >
                <option value="nome">Nome</option>
                <option value="fantasia">Nome Fantasia</option>
                <option value="cnpj_cpf">CNPJ / CPF</option>
                <option value="codigo">Código</option>
              </select>
            </div>
            {/* Campo de busca unificado */}
            <div className="relative">
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                {tipoBuscaFornecedor === 'nome' && 'Buscar por Nome'}
                {tipoBuscaFornecedor === 'fantasia' && 'Buscar por Fantasia'}
                {tipoBuscaFornecedor === 'cnpj_cpf' && 'Buscar por CNPJ/CPF'}
                {tipoBuscaFornecedor === 'codigo' && 'Buscar por Código'}
              </label>
              <div className="relative">
                <input
                  type={tipoBuscaFornecedor === 'codigo' ? 'number' : 'text'}
                  value={
                    fornecedorBuscaSelecionado
                      ? fornecedorBuscaSelecionado.nm_pessoa
                      : termoBuscaFornecedor
                  }
                  onChange={(e) => {
                    setTermoBuscaFornecedor(e.target.value);
                    if (fornecedorBuscaSelecionado)
                      setFornecedorBuscaSelecionado(null);
                  }}
                  onKeyDown={(e) =>
                    e.key === 'Enter' &&
                    (e.preventDefault(), buscarFornecedor())
                  }
                  placeholder={
                    tipoBuscaFornecedor === 'nome'
                      ? 'Nome do fornecedor...'
                      : tipoBuscaFornecedor === 'fantasia'
                        ? 'Nome fantasia...'
                        : tipoBuscaFornecedor === 'cnpj_cpf'
                          ? 'CPF ou CNPJ...'
                          : 'Código do fornecedor...'
                  }
                  className={`border border-[#000638]/30 rounded-lg px-2 py-1.5 pr-8 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] text-xs ${
                    fornecedorBuscaSelecionado
                      ? 'bg-blue-50 text-blue-800 font-medium'
                      : 'bg-[#f8f9fb] text-[#000638]'
                  }`}
                />
                {fornecedorBuscaSelecionado ? (
                  <button
                    type="button"
                    onClick={limparFornecedorBusca}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-red-500 hover:text-red-700"
                    title="Limpar fornecedor"
                  >
                    <X size={14} weight="bold" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={buscarFornecedor}
                    disabled={buscandoFornecedores}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#000638] hover:text-[#000638]/70 disabled:opacity-50"
                    title="Buscar fornecedor"
                  >
                    {buscandoFornecedores ? (
                      <Spinner size={14} className="animate-spin" />
                    ) : (
                      <MagnifyingGlass size={14} weight="bold" />
                    )}
                  </button>
                )}
              </div>
              {fornecedorBuscaSelecionado && (
                <p className="text-[10px] text-blue-600 mt-0.5 truncate">
                  Cód. {fornecedorBuscaSelecionado.cd_pessoa}
                  {fornecedorBuscaSelecionado.cpf
                    ? ` · ${fornecedorBuscaSelecionado.cpf}`
                    : ''}
                </p>
              )}
            </div>
            <div>
              <FiltroDespesas
                despesasSelecionadas={despesasSelecionadas}
                onSelectDespesas={handleSelectDespesas}
                dadosDespesa={dadosDespesa}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-0.5 text-[#000638]">
                Duplicata
              </label>
              <input
                type="text"
                value={duplicata}
                onChange={(e) => setDuplicata(e.target.value)}
                placeholder="Buscar duplicata..."
                className="border border-[#000638]/30 rounded-lg px-2 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-[#000638] bg-[#f8f9fb] text-[#000638] placeholder:text-gray-400 text-xs"
              />
            </div>
            <div>
              <FiltroCentroCusto
                centrosCustoSelecionados={centrosCustoSelecionados}
                onSelectCentrosCusto={handleSelectCentrosCusto}
                dadosCentroCusto={dadosCentroCusto}
              />
            </div>
            <div className="flex items-center gap-2 mt-1">
              <button
                type="submit"
                className="flex items-center gap-1 bg-[#000638] text-white px-3 py-1.5 rounded-lg hover:bg-[#fe0000] disabled:opacity-50 disabled:cursor-not-allowed transition-colors w-full justify-center text-xs font-bold shadow-md tracking-wide uppercase"
                disabled={loading || !dataInicio || !dataFim}
              >
                {loading ? (
                  <>
                    <Spinner size={10} className="animate-spin" />
                    <span>Buscando...</span>
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
    );
  },
);

FiltrosContasPagar.displayName = 'FiltrosContasPagar';

export default FiltrosContasPagar;
