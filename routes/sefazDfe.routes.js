// Rotas da Manifestação do Destinatário (SEFAZ Distribuição DFe)
// GET  /api/sefaz/dfe/empresas — CNPJs com certificado configurado
// GET  /api/sefaz/dfe/status   — controle de NSU por CNPJ
// GET  /api/sefaz/dfe/notas    — notas destinadas aos CNPJs (com filtros)
// POST /api/sefaz/dfe/sync     — dispara sincronização com a SEFAZ
import express from 'express';
import multer from 'multer';
import {
  asyncHandler,
  successResponse,
  errorResponse,
} from '../utils/errorHandler.js';
import supabase from '../config/supabase.js';
import {
  sincronizarTodos,
  listarEmpresas,
  aplicarSetorConhecido,
  obterXmlNota,
} from '../services/sefazDfe.js';
import { importarEscrituradas } from '../services/sefazEscrituracao.js';

const router = express.Router();

// CSV de manifestacoes do TOTVS fica so em memoria
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

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
      escrituracao, // 'escriturada' ou 'pendente'
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
          'id, setor, status_manual, outros_justificativa, outros_em, outros_por, cnpj_destinatario, empresa_codigo, empresa_nome, escriturada, nr_fatura, dt_fatura, chave_acesso, nsu, emitente_cnpj, emitente_nome, data_emissao, tipo_operacao, valor_total, situacao, manifestacao, manifestacao_descricao, xml_completo, schema_origem, atualizado_em',
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
      // Nao se escritura nota cancelada (2), denegada (3) nem de entrada
      // (tpNF 0): elas ficam fora dos dois lados da escrituracao.
      if (escrituracao === 'escriturada') {
        query = query
          .eq('escriturada', true)
          .eq('situacao', '1')
          .eq('tipo_operacao', '1');
      } else if (escrituracao === 'pendente') {
        query = query
          .or('escriturada.is.null,escriturada.eq.false')
          .or('status_manual.is.null,status_manual.neq.outros')
          .eq('situacao', '1')
          .eq('tipo_operacao', '1');
      } else if (escrituracao === 'outros') {
        // tiradas de pendentes com justificativa (Niziany, 27/10/2026)
        query = query.eq('status_manual', 'outros');
      }
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

// ─── Setor responsável pela nota (Niziany, 27/10/2026) ───
// Tabela sefaz_dfe_setores (migrations/sefaz_dfe_setores.sql); a nota guarda
// o nome do setor em sefaz_dfe_notas.setor.
router.get(
  '/setores',
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase
      .from('sefaz_dfe_setores')
      .select('id, nome, ordem')
      .eq('ativo', true)
      .order('ordem')
      .order('nome');
    if (error) return errorResponse(res, error.message, 500, 'SUPABASE_ERROR');
    successResponse(res, data || [], 'Setores');
  }),
);

router.post(
  '/setores',
  asyncHandler(async (req, res) => {
    const nome = String(req.body?.nome || '').trim();
    if (!nome) return errorResponse(res, 'Informe o nome do setor', 400, 'NOME_AUSENTE');
    if (nome.length > 60) return errorResponse(res, 'Nome do setor muito longo', 400, 'NOME_LONGO');
    const { data, error } = await supabase
      .from('sefaz_dfe_setores')
      .upsert({ nome, ativo: true }, { onConflict: 'nome' })
      .select('id, nome, ordem')
      .single();
    if (error) return errorResponse(res, error.message, 500, 'SUPABASE_ERROR');
    successResponse(res, data, 'Setor salvo');
  }),
);

router.patch(
  '/notas/:id/setor',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id) return errorResponse(res, 'id da nota ausente', 400, 'ID_INVALIDO');
    const setor = req.body?.setor ? String(req.body.setor).trim() : null;
    const { data, error } = await supabase
      .from('sefaz_dfe_notas')
      .update({ setor })
      .eq('id', id)
      .select('id, setor, emitente_cnpj, emitente_nome')
      .single();
    if (error) return errorResponse(res, error.message, 500, 'SUPABASE_ERROR');
    // Aprende o setor do fornecedor e preenche as outras notas dele que
    // ainda estão sem setor (Niziany, 27/10/2026). Limpar o setor de uma
    // nota não apaga a memória do fornecedor.
    let propagadas = 0;
    if (setor && data?.emitente_cnpj) {
      const { error: e2 } = await supabase.from('sefaz_dfe_fornecedor_setor').upsert(
        {
          emitente_cnpj: data.emitente_cnpj,
          setor,
          origem: 'manual',
          emitente_nome: data.emitente_nome || null,
          atualizado_em: new Date().toISOString(),
        },
        { onConflict: 'emitente_cnpj' },
      );
      if (e2) console.warn(`⚠️ [SefazDFe] memória fornecedor_setor: ${e2.message}`);
      else {
        try {
          propagadas = await aplicarSetorConhecido([data.emitente_cnpj]);
        } catch (e) {
          console.warn(`⚠️ [SefazDFe] propagar setor: ${e.message}`);
        }
      }
    }
    successResponse(res, { ...data, propagadas }, 'Setor da nota atualizado');
  }),
);

// "Outros": tira a nota de Pendentes sem contar como escriturada, sempre com
// justificativa (Niziany, 27/10/2026). { justificativa, usuario } marca;
// { desfazer: true } volta para pendente. Nunca apaga a nota.
router.patch(
  '/notas/:id/outros',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id) return errorResponse(res, 'id da nota ausente', 400, 'ID_INVALIDO');
    const { desfazer, justificativa, usuario } = req.body || {};
    const { data: nota, error: e0 } = await supabase
      .from('sefaz_dfe_notas')
      .select('id, escriturada, status_manual')
      .eq('id', id)
      .maybeSingle();
    if (e0) return errorResponse(res, e0.message, 500, 'SUPABASE_ERROR');
    if (!nota) return errorResponse(res, 'Nota não encontrada', 404, 'NAO_ENCONTRADA');

    let patch;
    if (desfazer) {
      patch = { status_manual: null, outros_justificativa: null, outros_em: null, outros_por: null };
    } else {
      const just = String(justificativa || '').trim();
      if (just.length < 10) {
        return errorResponse(res, 'Escreva uma justificativa com pelo menos 10 caracteres', 400, 'JUSTIFICATIVA_CURTA');
      }
      if (nota.escriturada) {
        return errorResponse(res, 'Esta nota já está escriturada no TOTVS', 400, 'JA_ESCRITURADA');
      }
      patch = {
        status_manual: 'outros',
        outros_justificativa: just.slice(0, 500),
        outros_em: new Date().toISOString(),
        outros_por: String(usuario || '').trim().slice(0, 120) || null,
      };
    }
    const { data, error } = await supabase
      .from('sefaz_dfe_notas')
      .update({ ...patch, atualizado_em: new Date().toISOString() })
      .eq('id', id)
      .select('id, status_manual, outros_justificativa, outros_em, outros_por')
      .single();
    if (error) return errorResponse(res, error.message, 500, 'SUPABASE_ERROR');
    successResponse(res, data, desfazer ? 'Nota voltou para pendentes' : 'Nota movida para Outros');
  }),
);

// XML completo da nota (para o DANFE no front). Busca na SEFAZ por chave
// quando a nota só veio como resumo.
router.get(
  '/notas/:id/xml',
  asyncHandler(async (req, res) => {
    const r = await obterXmlNota(String(req.params.id || '').trim());
    if (!r.ok) return errorResponse(res, r.erro, r.status || 400, 'XML_INDISPONIVEL');
    successResponse(res, { chave: r.chave, xml: r.xml, baixadoAgora: r.baixadoAgora, ciencia: r.ciencia || null }, 'XML da nota');
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

// Importa o export de manifestacoes do TOTVS e marca o que ja foi escriturado
router.post(
  '/importar-escrituradas',
  upload.single('arquivo'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return errorResponse(res, 'Envie o arquivo no campo "arquivo"', 400, 'ARQUIVO_AUSENTE');
    }
    // CSV (;) ou Excel (.xlsx/.xls) — a deteccao e pelo conteudo
    const r = await importarEscrituradas(req.file.buffer, req.file.originalname);
    if (!r.ok) return errorResponse(res, r.erro, 400, 'CSV_INVALIDO');
    successResponse(res, r.resumo, 'Escrituracao atualizada');
  }),
);

export default router;
