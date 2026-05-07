import React, { useState, useRef } from 'react';
import { API_BASE_URL } from '../config/constants';

const PAGE_SIZE = 100;
const MAX_PAGES_PER_TYPE = 5000;

export default function ClientesTotvs() {
  const [processando, setProcessando] = useState(false);
  const [lotes, setLotes] = useState([]);
  const [totalInseridos, setTotalInseridos] = useState(0);
  const [totalIgnorados, setTotalIgnorados] = useState(0);
  const [totalErros, setTotalErros] = useState(0);
  const [totalPF, setTotalPF] = useState(0);
  const [totalPJ, setTotalPJ] = useState(0);
  const [status, setStatus] = useState(null);
  const [personCode, setPersonCode] = useState('');
  const [ultimoLote, setUltimoLote] = useState([]);
  const [ignorados, setIgnorados] = useState([]);
  const [erros, setErros] = useState([]);
  const cancelRef = useRef(false);

  const saveBatch = async (clientes) => {
    const resp = await fetch(
      `${API_BASE_URL}/api/totvs/clientes/save-supabase`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientes }),
      },
    );
    return resp.json();
  };

  const fetchRawPage = async (type, page) => {
    const resp = await fetch(
      `${API_BASE_URL}/api/totvs/clientes/fetch-raw-page?type=${type}&page=${page}&pageSize=${PAGE_SIZE}`,
    );
    return resp.json();
  };

  const processarTipo = async (tipo, estado) => {
    let page = 1;
    let hasNext = true;

    while (hasNext && page <= MAX_PAGES_PER_TYPE) {
      if (cancelRef.current) break;

      setStatus({
        type: 'info',
        msg: `Buscando ${tipo} - página ${page}...`,
      });

      let fetchJson;
      try {
        fetchJson = await fetchRawPage(tipo, page);
      } catch (err) {
        estado.lotes.push({
          num: estado.loteNum++,
          tipo,
          page,
          count: 0,
          status: 'erro',
          error: err.message,
        });
        setLotes([...estado.lotes]);
        page++;
        continue;
      }

      if (!fetchJson.success) {
        estado.lotes.push({
          num: estado.loteNum++,
          tipo,
          page,
          count: 0,
          status: 'erro',
          error: fetchJson.message || 'Falha na busca',
        });
        setLotes([...estado.lotes]);
        hasNext = false;
        break;
      }

      const clientes = fetchJson.data?.clientes || [];
      hasNext = fetchJson.data?.hasNext || false;

      if (clientes.length === 0) {
        estado.lotes.push({
          num: estado.loteNum++,
          tipo,
          page,
          count: 0,
          status: 'vazio',
        });
        setLotes([...estado.lotes]);
        page++;
        continue;
      }

      setStatus({
        type: 'info',
        msg: `Salvando ${tipo} página ${page} (${clientes.length} clientes)...`,
      });

      let saveJson;
      try {
        saveJson = await saveBatch(clientes);
      } catch (err) {
        estado.lotes.push({
          num: estado.loteNum++,
          tipo,
          page,
          count: clientes.length,
          status: 'erro',
          error: err.message,
        });
        setLotes([...estado.lotes]);
        page++;
        continue;
      }

      const saveData = saveJson.data || {};
      const insertedNow = saveData.inserted || 0;
      const skippedNow = saveData.skipped || 0;
      const errorsNow = saveData.errors || 0;

      estado.totalInseridos += insertedNow;
      estado.totalIgnorados += skippedNow;
      estado.totalErros += errorsNow;
      if (tipo === 'PF') estado.totalPF += clientes.length;
      else estado.totalPJ += clientes.length;

      if (Array.isArray(saveData.skippedList)) {
        estado.ignorados.push(...saveData.skippedList);
      }
      if (Array.isArray(saveData.errorsList)) {
        estado.erros.push(...saveData.errorsList);
      }

      estado.lotes.push({
        num: estado.loteNum++,
        tipo,
        page,
        count: clientes.length,
        inserted: insertedNow,
        skipped: skippedNow,
        errors: errorsNow,
        status: saveJson.success ? 'enviado' : 'erro',
        duration: fetchJson.data?.duration,
        error: saveJson.success ? null : saveJson.message,
      });

      setLotes([...estado.lotes]);
      setUltimoLote(clientes);
      setTotalInseridos(estado.totalInseridos);
      setTotalIgnorados(estado.totalIgnorados);
      setTotalErros(estado.totalErros);
      setTotalPF(estado.totalPF);
      setTotalPJ(estado.totalPJ);
      setIgnorados([...estado.ignorados]);
      setErros([...estado.erros]);

      page++;
    }
  };

  const handleBuscarTodos = async () => {
    setProcessando(true);
    setLotes([]);
    setUltimoLote([]);
    setTotalInseridos(0);
    setTotalIgnorados(0);
    setTotalErros(0);
    setTotalPF(0);
    setTotalPJ(0);
    setIgnorados([]);
    setErros([]);
    setStatus(null);
    cancelRef.current = false;

    const estado = {
      lotes: [],
      loteNum: 1,
      totalInseridos: 0,
      totalIgnorados: 0,
      totalErros: 0,
      totalPF: 0,
      totalPJ: 0,
      ignorados: [],
      erros: [],
    };

    await processarTipo('PF', estado);
    if (!cancelRef.current) await processarTipo('PJ', estado);

    if (cancelRef.current) {
      setStatus({
        type: 'warning',
        msg: `Cancelado. Inseridos: ${estado.totalInseridos} | Já existiam: ${estado.totalIgnorados} | Erros: ${estado.totalErros}`,
      });
    } else {
      setStatus({
        type: 'success',
        msg: `Finalizado! PF: ${estado.totalPF} | PJ: ${estado.totalPJ} — Inseridos: ${estado.totalInseridos} | Já existiam: ${estado.totalIgnorados} | Erros: ${estado.totalErros}`,
      });
    }
    setProcessando(false);
  };

  const handleBuscarCodigo = async () => {
    if (!personCode.trim()) return;
    setProcessando(true);
    setLotes([]);
    setUltimoLote([]);
    setTotalInseridos(0);
    setTotalIgnorados(0);
    setTotalErros(0);
    setTotalPF(0);
    setTotalPJ(0);
    setIgnorados([]);
    setErros([]);
    setStatus(null);

    try {
      const params = new URLSearchParams();
      params.append('personCode', personCode.trim());

      const resp = await fetch(
        `${API_BASE_URL}/api/totvs/clientes/fetch-all?${params.toString()}`,
      );
      const json = await resp.json();

      if (json.success && json.data?.clientes?.length > 0) {
        const clientes = json.data.clientes;
        setUltimoLote(clientes);

        const saveJson = await saveBatch(clientes);
        const saveData = saveJson.data || {};

        setTotalInseridos(saveData.inserted || 0);
        setTotalIgnorados(saveData.skipped || 0);
        setTotalErros(saveData.errors || 0);
        setTotalPF(json.data.totalPF || 0);
        setTotalPJ(json.data.totalPJ || 0);
        setIgnorados(saveData.skippedList || []);
        setErros(saveData.errorsList || []);

        setLotes([
          {
            num: 1,
            tipo: 'BUSCA',
            page: personCode,
            count: clientes.length,
            inserted: saveData.inserted || 0,
            skipped: saveData.skipped || 0,
            errors: saveData.errors || 0,
            status: saveJson.success ? 'enviado' : 'erro',
            duration: json.data.duration || json.data.fetchDuration,
          },
        ]);
        setStatus({
          type: 'success',
          msg: `${clientes.length} cliente(s) — Inseridos: ${saveData.inserted || 0} | Já existiam: ${saveData.skipped || 0} | Erros: ${saveData.errors || 0}`,
        });
      } else {
        setStatus({
          type: 'error',
          msg: `Nenhum cliente encontrado com código ${personCode}`,
        });
      }
    } catch (err) {
      setStatus({ type: 'error', msg: `Erro: ${err.message}` });
    } finally {
      setProcessando(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Clientes TOTVS</h1>
        <p className="text-sm text-gray-500 mt-1">
          Busca paginada (PF + PJ) direto da TOTVS — clientes já existentes no
          Supabase são ignorados automaticamente
        </p>
      </div>

      {/* Controles */}
      <div className="flex flex-wrap items-end gap-4 mb-6">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">
            Ou código específico
          </label>
          <input
            type="text"
            value={personCode}
            onChange={(e) => setPersonCode(e.target.value)}
            placeholder="Ex: 180 ou 180,200"
            disabled={processando}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-48 disabled:opacity-50"
          />
        </div>

        {personCode.trim() ? (
          <button
            onClick={handleBuscarCodigo}
            disabled={processando}
            className={`px-6 py-3 rounded-lg font-semibold text-white transition-all ${
              processando
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700 active:scale-95'
            }`}
          >
            BUSCAR CÓDIGO
          </button>
        ) : (
          <button
            onClick={handleBuscarTodos}
            disabled={processando}
            className={`px-6 py-3 rounded-lg font-semibold text-white transition-all ${
              processando
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700 active:scale-95'
            }`}
          >
            {processando ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                Processando páginas...
              </span>
            ) : (
              'BUSCAR CLIENTES'
            )}
          </button>
        )}

        {processando && (
          <button
            onClick={() => {
              cancelRef.current = true;
            }}
            className="px-5 py-3 rounded-lg font-semibold text-white bg-red-600 hover:bg-red-700 active:scale-95 transition-all"
          >
            CANCELAR
          </button>
        )}
      </div>

      {/* Status */}
      {status && (
        <div
          className={`mb-4 p-4 rounded-lg text-sm font-medium ${
            status.type === 'success'
              ? 'bg-green-50 text-green-800 border border-green-200'
              : status.type === 'error'
                ? 'bg-red-50 text-red-800 border border-red-200'
                : status.type === 'warning'
                  ? 'bg-yellow-50 text-yellow-800 border border-yellow-200'
                  : 'bg-blue-50 text-blue-800 border border-blue-200'
          }`}
        >
          {status.msg}
        </div>
      )}

      {/* Resumo */}
      {(totalInseridos > 0 || totalIgnorados > 0 || totalErros > 0) && (
        <div className="flex gap-4 mb-6 flex-wrap">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 min-w-[180px]">
            <p className="text-xs font-semibold text-green-600 uppercase">
              Inseridos
            </p>
            <p className="text-2xl font-bold text-green-800 mt-1">
              {totalInseridos}
            </p>
            <p className="text-xs text-green-600 mt-1">
              PF: {totalPF} | PJ: {totalPJ}
            </p>
          </div>
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 min-w-[180px]">
            <p className="text-xs font-semibold text-yellow-700 uppercase">
              Já existiam
            </p>
            <p className="text-2xl font-bold text-yellow-800 mt-1">
              {totalIgnorados}
            </p>
            <p className="text-xs text-yellow-700 mt-1">
              Não reenviados ao Supabase
            </p>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 min-w-[180px]">
            <p className="text-xs font-semibold text-red-600 uppercase">
              Erros
            </p>
            <p className="text-2xl font-bold text-red-800 mt-1">{totalErros}</p>
            <p className="text-xs text-red-600 mt-1">Falhas ao inserir</p>
          </div>
        </div>
      )}

      {/* Log de lotes — estilo terminal */}
      {lotes.length > 0 && (
        <div className="mb-6 bg-gray-900 rounded-lg p-4 max-h-[350px] overflow-y-auto font-mono text-xs leading-relaxed">
          <p className="text-gray-500 mb-2">--- Log de envio por página ---</p>
          {lotes.map((lote) => (
            <div
              key={lote.num}
              className={`py-0.5 ${
                lote.status === 'enviado'
                  ? 'text-green-400'
                  : lote.status === 'vazio'
                    ? 'text-gray-600'
                    : 'text-red-400'
              }`}
            >
              {lote.status === 'enviado' &&
                `✅ [${lote.tipo}] Pág ${lote.page} — ${lote.count} clientes | inseridos:${lote.inserted} já existiam:${lote.skipped} erros:${lote.errors} (${lote.duration || ''})`}
              {lote.status === 'vazio' &&
                `⏭️ [${lote.tipo}] Pág ${lote.page} vazia`}
              {lote.status === 'erro' &&
                `❌ [${lote.tipo}] Pág ${lote.page}: ${lote.error || 'Falha'}`}
            </div>
          ))}
          {processando && (
            <div className="text-blue-400 animate-pulse mt-1">
              ⏳ Processando próxima página...
            </div>
          )}
        </div>
      )}

      {/* Lista de ignorados */}
      {ignorados.length > 0 && (
        <details className="mb-6 bg-yellow-50 border border-yellow-200 rounded-lg">
          <summary className="px-4 py-3 cursor-pointer font-semibold text-yellow-800">
            Clientes ignorados (já existem no Supabase): {ignorados.length}
          </summary>
          <div className="max-h-64 overflow-auto border-t border-yellow-200">
            <table className="w-full text-xs">
              <thead className="bg-yellow-100 sticky top-0">
                <tr>
                  <th className="px-2 py-1 text-left">Código</th>
                  <th className="px-2 py-1 text-left">Empresa</th>
                  <th className="px-2 py-1 text-left">Tipo</th>
                  <th className="px-2 py-1 text-left">Nome</th>
                  <th className="px-2 py-1 text-left">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {ignorados.slice(0, 500).map((s, i) => (
                  <tr key={i} className="border-t border-yellow-100">
                    <td className="px-2 py-1 font-mono">{s.code}</td>
                    <td className="px-2 py-1">{s.cd_empresacad}</td>
                    <td className="px-2 py-1">{s.tipo_pessoa || '—'}</td>
                    <td className="px-2 py-1">{s.nm_pessoa || '—'}</td>
                    <td className="px-2 py-1">{s.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {ignorados.length > 500 && (
              <p className="p-2 text-xs text-yellow-700">
                Exibindo 500 de {ignorados.length}
              </p>
            )}
          </div>
        </details>
      )}

      {/* Lista de erros */}
      {erros.length > 0 && (
        <details className="mb-6 bg-red-50 border border-red-200 rounded-lg">
          <summary className="px-4 py-3 cursor-pointer font-semibold text-red-800">
            Clientes com erro: {erros.length}
          </summary>
          <div className="max-h-64 overflow-auto border-t border-red-200">
            <table className="w-full text-xs">
              <thead className="bg-red-100 sticky top-0">
                <tr>
                  <th className="px-2 py-1 text-left">Código</th>
                  <th className="px-2 py-1 text-left">Empresa</th>
                  <th className="px-2 py-1 text-left">Tipo</th>
                  <th className="px-2 py-1 text-left">Nome</th>
                  <th className="px-2 py-1 text-left">Erro</th>
                </tr>
              </thead>
              <tbody>
                {erros.slice(0, 500).map((s, i) => (
                  <tr key={i} className="border-t border-red-100">
                    <td className="px-2 py-1 font-mono">{s.code}</td>
                    <td className="px-2 py-1">{s.cd_empresacad}</td>
                    <td className="px-2 py-1">{s.tipo_pessoa || '—'}</td>
                    <td className="px-2 py-1">{s.nm_pessoa || '—'}</td>
                    <td className="px-2 py-1 text-red-700">{s.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {/* Tabela do último lote */}
      {ultimoLote.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
            <p className="text-sm font-semibold text-gray-700">
              Última página carregada: {ultimoLote.length} clientes
            </p>
          </div>
          <div className="overflow-auto max-h-[40vh]">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">
                    Código
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">
                    Tipo
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">
                    Empresa
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">
                    Nome
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">
                    CPF/CNPJ
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">
                    Telefone
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">
                    Email
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">
                    UF
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">
                    Cliente
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {ultimoLote.map((c, idx) => (
                  <tr
                    key={`${c.cd_empresacad}-${c.code}-${idx}`}
                    className="hover:bg-gray-50"
                  >
                    <td className="px-3 py-2 text-gray-800 font-mono">
                      {c.code}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded ${
                          c.tipo_pessoa === 'PJ'
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}
                      >
                        {c.tipo_pessoa || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      {c.cd_empresacad}
                    </td>
                    <td className="px-3 py-2 text-gray-800 max-w-[250px] truncate">
                      {c.nm_pessoa || '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-600 font-mono text-xs">
                      {c.cpf || '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-600 text-xs">
                      {c.telefone || '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-600 text-xs max-w-[200px] truncate">
                      {c.email || '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-600 text-xs">
                      {c.uf || '—'}
                    </td>
                    <td className="px-3 py-2">
                      {c.is_customer ? (
                        <span className="text-green-600 text-xs font-semibold">
                          Sim
                        </span>
                      ) : (
                        <span className="text-gray-400 text-xs">Não</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`text-xs font-semibold ${
                          c.customer_status === 'Ativo' ||
                          c.person_status === 'Active'
                            ? 'text-green-600'
                            : 'text-red-500'
                        }`}
                      >
                        {c.customer_status || c.person_status || '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Estado vazio */}
      {!processando &&
        lotes.length === 0 &&
        ultimoLote.length === 0 &&
        !status && (
          <div className="text-center py-20 text-gray-400">
            <p className="text-lg">
              Clique em "BUSCAR CLIENTES" para trazer PF + PJ paginando direto
              da TOTVS
            </p>
            <p className="text-sm mt-2">
              Clientes que já existem no Supabase são ignorados e listados no
              log
            </p>
          </div>
        )}
    </div>
  );
}
