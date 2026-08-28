// Rotas da Manifestação do Destinatário (SEFAZ Distribuição DFe)
// GET  /api/sefaz/dfe/empresas — CNPJs com certificado configurado
// GET  /api/sefaz/dfe/status   — controle de NSU por CNPJ
// GET  /api/sefaz/dfe/notas    — notas destinadas aos CNPJs (com filtros)
// POST /api/sefaz/dfe/sync     — dispara sincronização com a SEFAZ
import express from 'express';
import {
  asyncHandler,
  successResponse,
  errorResponse,
} from '../utils/errorHandler.js';
import supabase from '../config/supabase.js';
import {
  sincronizarTodos,
  listarEmpresas,
} from '../services/sefazDfe.js';

const router = express.Router();

router.get(
  '/empresas',
  asyncHandler(async (req, res) => {
    successResponse(res, listarEmpresas(), 'Empresas com certificado');
  }),
);

router.get(
  '/status',
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase
      .from('sefaz_dfe_controle')
      .select('*')
      .order('cnpj');
    if (error) return errorResponse(res, error.message, 500, 'SUPABASE_ERROR');
    successResponse(res, data || [], 'Status da sincronização');
  }),
);

router.get(
  '/notas',
  asyncHandler(async (req, res) => {
    const {
      cnpjs, // lista separada por vírgula
      empresas, // códigos de empresa/filial TOTVS, separados por vírgula
      startDate,
      endDate,
      tipoOperacao, // '0' ou '1'
      situacao, // '1', '2' ou '3'
      origem, // 'sefaz' ou 'totvs'
      limit,
    } = req.query;

    const maxTotal = Math.min(parseInt(limit) || 10000, 20000);
    // O PostgREST limita cada resposta a 1000 linhas — pagina com .range()
    const PAGINA = 1000;
    const todos = [];

    for (let offset = 0; offset < maxTotal; offset += PAGINA) {
      let query = supabase
        .from('sefaz_dfe_notas')
        .select(
          'cnpj_destinatario, empresa_codigo, empresa_nome, chave_acesso, nsu, emitente_cnpj, emitente_nome, data_emissao, tipo_operacao, valor_total, situacao, manifestacao, manifestacao_descricao, xml_completo, schema_origem, atualizado_em',
        )
        .order('data_emissao', { ascending: false })
        .range(offset, offset + PAGINA - 1);

      if (cnpjs) {
        const lista = String(cnpjs)
          .split(',')
          .map((c) => c.replace(/\D/g, ''))
          .filter(Boolean);
        if (lista.length > 0) query = query.in('cnpj_destinatario', lista);
      }
      if (empresas) {
        const codigos = String(empresas)
          .split(',')
          .map((c) => parseInt(c))
          .filter((c) => !isNaN(c));
        if (codigos.length > 0) query = query.in('empresa_codigo', codigos);
      }
      if (startDate) query = query.gte('data_emissao', `${startDate}T00:00:00`);
      if (endDate) query = query.lte('data_emissao', `${endDate}T23:59:59.999`);
      if (tipoOperacao) query = query.eq('tipo_operacao', tipoOperacao);
      if (situacao) query = query.eq('situacao', situacao);
      // Origem do registro: SEFAZ (resNFe/procNFe) ou TOTVS (CSV do FISFP153)
      if (origem === 'sefaz')
        query = query.in('schema_origem', ['resNFe', 'procNFe']);
      else if (origem === 'totvs')
        query = query.eq('schema_origem', 'csv-fisfp153');

      const { data, error } = await query;
      if (error)
        return errorResponse(res, error.message, 500, 'SUPABASE_ERROR');
      todos.push(...(data || []));
      if (!data || data.length < PAGINA) break;
    }

    successResponse(res, todos, `${todos.length} notas`);
  }),
);

router.post(
  '/sync',
  asyncHandler(async (req, res) => {
    const { cnpj, codigo } = req.body || {};
    const resultado = await sincronizarTodos({ cnpj, codigo });
    if (!resultado.ok)
      return errorResponse(res, resultado.erro, 400, 'SEFAZ_SYNC_ERROR');
    successResponse(res, resultado.resultados, 'Sincronização concluída');
  }),
);

export default router;
