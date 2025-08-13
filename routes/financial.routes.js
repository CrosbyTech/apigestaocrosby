import express from 'express';
import pool from '../config/database.js';
import { validateRequired, validateDateFormat, validatePagination, sanitizeInput } from '../middlewares/validation.middleware.js';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';
import multer from 'multer';
import { BankReturnParser } from '../utils/bankReturnParser.js';
import fs from 'fs';
import path from 'path';

const router = express.Router();

// Configuração do multer para upload de arquivos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = './uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + '.RET');
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    // Aceitar arquivos .RET (maiúsculo e minúsculo) e arquivos de texto
    const fileName = file.originalname.toLowerCase();
    if (fileName.endsWith('.ret') || file.mimetype === 'text/plain') {
      cb(null, true);
    } else {
      cb(new Error('Apenas arquivos .RET são permitidos'), false);
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  }
});

// Configuração para upload múltiplo
const uploadMultiple = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    // Aceitar arquivos .RET (maiúsculo e minúsculo) e arquivos de texto
    const fileName = file.originalname.toLowerCase();
    if (fileName.endsWith('.ret') || file.mimetype === 'text/plain') {
      cb(null, true);
    } else {
      cb(new Error('Apenas arquivos .RET são permitidos'), false);
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB por arquivo
    files: 10 // Máximo 10 arquivos
  }
}).array('files', 10); // Campo 'files' com máximo 10 arquivos

/**
 * @route GET /financial/extrato
 * @desc Buscar extrato bancário com filtros e paginação
 * @access Public
 * @query {cd_empresa, nr_ctapes, dt_movim_ini, dt_movim_fim, limit, offset}
 */
router.get('/extrato',
  sanitizeInput,
  validatePagination,
  asyncHandler(async (req, res) => {
    const { cd_empresa, nr_ctapes, dt_movim_ini, dt_movim_fim } = req.query;
    const limit = parseInt(req.query.limit, 10) || 50000000;
    const offset = parseInt(req.query.offset, 10) || 0;

    let baseQuery = ' FROM fcc_extratbco fe WHERE 1=1';
    const params = [];
    let idx = 1;

    // Construir filtros dinamicamente
    if (cd_empresa) {
      baseQuery += ` AND fe.cd_empresa = $${idx++}`;
      params.push(cd_empresa);
    }

    if (nr_ctapes) {
      if (Array.isArray(nr_ctapes) && nr_ctapes.length > 0) {
        const nr_ctapes_num = nr_ctapes.map(Number);
        baseQuery += ` AND fe.nr_ctapes IN (${nr_ctapes_num.map(() => `$${idx++}`).join(',')})`;
        params.push(...nr_ctapes_num);
      } else {
        baseQuery += ` AND fe.nr_ctapes = $${idx++}`;
        params.push(Number(nr_ctapes));
      }
    }

    if (dt_movim_ini && dt_movim_fim) {
      baseQuery += ` AND fe.dt_lancto BETWEEN $${idx++} AND $${idx++}`;
      params.push(dt_movim_ini, dt_movim_fim);
    }

    // Query para total de registros
    const totalQuery = `SELECT COUNT(*) as total ${baseQuery}`;
    const totalResult = await pool.query(totalQuery, params);
    const total = parseInt(totalResult.rows[0].total, 10);

    // Query para dados paginados
    const dataQuery = `
      SELECT 
        fe.nr_ctapes, 
        fe.dt_lancto, 
        fe.ds_histbco, 
        fe.tp_operbco, 
        fe.vl_lancto, 
        fe.dt_conciliacao
      ${baseQuery}
      ORDER BY fe.dt_lancto DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `;
    
    const dataParams = [...params, limit, offset];
    const { rows } = await pool.query(dataQuery, dataParams);

    successResponse(res, {
      total,
      limit,
      offset,
      hasMore: (offset + limit) < total,
      data: rows
    }, 'Extrato bancário obtido com sucesso');
  })
);

/**
 * @route GET /financial/extrato-totvs
 * @desc Buscar extrato TOTVS com filtros
 * @access Public
 * @query {nr_ctapes, dt_movim_ini, dt_movim_fim, limit, offset}
 */
router.get('/extrato-totvs',
  sanitizeInput,
  validatePagination,
  asyncHandler(async (req, res) => {
    const { nr_ctapes, dt_movim_ini, dt_movim_fim } = req.query;
    const limit = parseInt(req.query.limit, 10) || 50000000;
    const offset = parseInt(req.query.offset, 10) || 0;

    let baseQuery = ' FROM fcc_mov fm WHERE fm.in_estorno = $1';
    const params = ['F']; // Filtro fixo para não estornados
    let idx = 2;

    if (nr_ctapes) {
      let contas = Array.isArray(nr_ctapes) ? nr_ctapes : [nr_ctapes];
      if (contas.length > 1) {
        baseQuery += ` AND fm.nr_ctapes IN (${contas.map(() => `$${idx++}`).join(',')})`;
        params.push(...contas);
      } else {
        baseQuery += ` AND fm.nr_ctapes = $${idx++}`;
        params.push(contas[0]);
      }
    }

    if (dt_movim_ini && dt_movim_fim) {
      baseQuery += ` AND fm.dt_movim BETWEEN $${idx++} AND $${idx++}`;
      params.push(dt_movim_ini, dt_movim_fim);
    }

    const dataQuery = `
      SELECT 
        fm.cd_empresa, 
        fm.nr_ctapes, 
        fm.dt_movim, 
        fm.ds_doc, 
        fm.dt_liq, 
        fm.in_estorno, 
        fm.tp_operacao, 
        fm.ds_aux, 
        fm.vl_lancto
      ${baseQuery}
      ORDER BY fm.dt_movim DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `;
    
    const dataParams = [...params, limit, offset];
    const { rows } = await pool.query(dataQuery, dataParams);

    successResponse(res, {
      limit,
      offset,
      count: rows.length,
      data: rows
    }, 'Extrato TOTVS obtido com sucesso');
  })
);

/**
 * @route GET /financial/contas-pagar
 * @desc Buscar contas a pagar
 * @access Public
 * @query {dt_inicio, dt_fim, cd_empresa}
 */
router.get('/contas-pagar',
  sanitizeInput,
  validateDateFormat(['dt_inicio', 'dt_fim']),
  asyncHandler(async (req, res) => {
    const { dt_inicio, dt_fim, cd_empresa } = req.query;
    
    if (!cd_empresa) {
      return errorResponse(res, 'Parâmetro cd_empresa é obrigatório', 400, 'MISSING_PARAMETER');
    }

    // Seguir exatamente o mesmo padrão da rota /fluxo-caixa - UMA ÚNICA QUERY
    let empresas = Array.isArray(cd_empresa) ? cd_empresa : [cd_empresa];
    let params = [dt_inicio, dt_fim, ...empresas];
    let empresaPlaceholders = empresas.map((_, idx) => `$${3 + idx}`).join(',');

    // Para muitas empresas (>20), otimizar mantendo JOINs essenciais
    const isHeavyQuery = empresas.length > 20;
    
    const query = isHeavyQuery ? `
      SELECT
        fd.cd_empresa,
        fd.cd_fornecedor,
        fd.nr_duplicata,
        fd.nr_portador,
        fd.nr_parcela,
        fd.dt_emissao,
        fd.dt_vencimento,
        fd.dt_entrada,
        fd.dt_liq,
        fd.tp_situacao,
        fd.tp_estagio,
        fd.vl_duplicata,
        fd.vl_juros,
        fd.vl_acrescimo,
        fd.vl_desconto,
        fd.vl_pago,
        fd.vl_rateio,
        fd.in_aceite,
        fd.cd_despesaitem,
        fdi.ds_despesaitem,
        vpf.nm_fornecedor,
        fd.cd_ccusto,
        gc.ds_ccusto
      FROM vr_fcp_despduplicatai fd
      LEFT JOIN fcp_despesaitem fdi ON fd.cd_despesaitem = fdi.cd_despesaitem
      LEFT JOIN vr_pes_fornecedor vpf ON fd.cd_fornecedor = vpf.cd_fornecedor
      LEFT JOIN gec_ccusto gc ON fd.cd_ccusto = gc.cd_ccusto
      WHERE fd.dt_vencimento BETWEEN $1 AND $2
        AND fd.cd_empresa IN (${empresaPlaceholders})
      ORDER BY fd.dt_vencimento DESC
      LIMIT 10000000000
    ` : `
             SELECT
         fd.cd_empresa,
         fd.cd_fornecedor,
         fd.nr_duplicata,
         fd.nr_portador,
         fd.nr_parcela,
         fd.dt_emissao,
         fd.dt_vencimento,
         fd.dt_entrada,
         fd.dt_liq,
         fd.tp_situacao,
         fd.tp_estagio,
         fd.vl_duplicata,
         fd.vl_juros,
         fd.vl_acrescimo,
         fd.vl_desconto,
         fd.vl_pago,
         fd.vl_rateio,
         fd.in_aceite,
         fd.cd_despesaitem,
         fdi.ds_despesaitem,
         vpf.nm_fornecedor,
         fd.cd_ccusto,
         gc.ds_ccusto,
	       fd.tp_previsaoreal
       FROM vr_fcp_despduplicatai fd
       LEFT JOIN fcp_despesaitem fdi ON fd.cd_despesaitem = fdi.cd_despesaitem
       LEFT JOIN vr_pes_fornecedor vpf ON fd.cd_fornecedor = vpf.cd_fornecedor
       LEFT JOIN gec_ccusto gc ON fd.cd_ccusto = gc.cd_ccusto
       WHERE fd.dt_vencimento BETWEEN $1 AND $2
         AND fd.cd_empresa IN (${empresaPlaceholders})
       ORDER BY fd.dt_vencimento DESC
    `;

    console.log(`🔍 Contas-pagar: ${empresas.length} empresas, query ${isHeavyQuery ? 'otimizada' : 'completa'}`);
    
    // Para queries pesadas, usar timeout específico
    const queryOptions = isHeavyQuery ? {
      text: query,
      values: params,
      // Para queries pesadas, não usar timeout (herda do pool)
    } : query;

    const { rows } = await pool.query(queryOptions, isHeavyQuery ? undefined : params);

    // Calcular totais (igual ao fluxo-caixa)
    const totals = rows.reduce((acc, row) => {
      acc.totalDuplicata += parseFloat(row.vl_duplicata || 0);
      acc.totalPago += parseFloat(row.vl_pago || 0);
      acc.totalJuros += parseFloat(row.vl_juros || 0);
      acc.totalDesconto += parseFloat(row.vl_desconto || 0);
      return acc;
    }, { totalDuplicata: 0, totalPago: 0, totalJuros: 0, totalDesconto: 0 });

    successResponse(res, {
      periodo: { dt_inicio, dt_fim },
      empresas,
      totals,
      count: rows.length,
      optimized: isHeavyQuery,
      queryType: isHeavyQuery ? 'joins-essenciais-otimizado' : 'completo-com-todos-joins',
      data: rows
    }, `Contas a pagar obtidas com sucesso (${isHeavyQuery ? 'otimizado' : 'completo'})`);
  })
);

/**
 * @route GET /financial/fluxo-caixa
 * @desc Buscar fluxo de caixa (baseado na data de liquidação)
 * @access Publicgit
 * @query {dt_inicio, dt_fim, cd_empresa}
 */
router.get('/fluxo-caixa',
  sanitizeInput,
  validateDateFormat(['dt_inicio', 'dt_fim']),
  asyncHandler(async (req, res) => {
    const { dt_inicio, dt_fim, cd_empresa } = req.query;
    
    if (!cd_empresa) {
      return errorResponse(res, 'Parâmetro cd_empresa é obrigatório', 400, 'MISSING_PARAMETER');
    }

    // Seguir exatamente o mesmo padrão da rota /faturamento - UMA ÚNICA QUERY
    let empresas = Array.isArray(cd_empresa) ? cd_empresa : [cd_empresa];
    let params = [dt_inicio, dt_fim, ...empresas];
    let empresaPlaceholders = empresas.map((_, idx) => `$${3 + idx}`).join(',');

    // Para muitas empresas (>20), otimizar mantendo JOINs essenciais
    const isHeavyQuery = empresas.length > 20;
    
    const query = isHeavyQuery ? `
      SELECT
        fd.cd_empresa,
        fd.cd_fornecedor,
        fd.nr_duplicata,
        fd.nr_portador,
        fd.nr_parcela,
        fd.dt_emissao,
        fd.dt_vencimento,
        fd.dt_entrada,
        fd.dt_liq,
        fd.tp_situacao,
        fd.tp_estagio,
        fd.vl_duplicata,
        fd.vl_juros,
        fd.vl_acrescimo,
        fd.vl_desconto,
        fd.vl_pago,
        fd.vl_rateio,
        fd.in_aceite,
        fd.cd_despesaitem,
        fdi.ds_despesaitem,
        vpf.nm_fornecedor,
        fd.cd_ccusto,
        gc.ds_ccusto
      FROM vr_fcp_despduplicatai fd
      LEFT JOIN fcp_despesaitem fdi ON fd.cd_despesaitem = fdi.cd_despesaitem
      LEFT JOIN vr_pes_fornecedor vpf ON fd.cd_fornecedor = vpf.cd_fornecedor
      LEFT JOIN gec_ccusto gc ON fd.cd_ccusto = gc.cd_ccusto
      WHERE fd.dt_liq BETWEEN $1 AND $2
        AND fd.cd_empresa IN (${empresaPlaceholders})
      ORDER BY fd.dt_liq DESC
      LIMIT 10000000000
    ` : `
             SELECT
         fd.cd_empresa,
         fd.cd_fornecedor,
         fd.nr_duplicata,
         fd.nr_portador,
         fd.nr_parcela,
         fd.dt_emissao,
         fd.dt_vencimento,
         fd.dt_entrada,
         fd.dt_liq,
         fd.tp_situacao,
         fd.tp_estagio,
         fd.vl_duplicata,
         fd.vl_juros,
         fd.vl_acrescimo,
         fd.vl_desconto,
         fd.vl_pago,
         fd.vl_rateio,
         fd.in_aceite,
         fd.cd_despesaitem,
         fdi.ds_despesaitem,
         vpf.nm_fornecedor,
         fd.cd_ccusto,
         gc.ds_ccusto
       FROM vr_fcp_despduplicatai fd
       LEFT JOIN fcp_despesaitem fdi ON fd.cd_despesaitem = fdi.cd_despesaitem
       LEFT JOIN vr_pes_fornecedor vpf ON fd.cd_fornecedor = vpf.cd_fornecedor
       LEFT JOIN gec_ccusto gc ON fd.cd_ccusto = gc.cd_ccusto
       WHERE fd.dt_liq BETWEEN $1 AND $2
         AND fd.cd_empresa IN (${empresaPlaceholders})
       ORDER BY fd.dt_liq DESC
    `;

    console.log(`🔍 Fluxo-caixa: ${empresas.length} empresas, query ${isHeavyQuery ? 'otimizada' : 'completa'}`);
    
    // Para queries pesadas, usar timeout específico
    const queryOptions = isHeavyQuery ? {
      text: query,
      values: params,
      // Para queries pesadas, não usar timeout (herda do pool)
    } : query;

    const { rows } = await pool.query(queryOptions, isHeavyQuery ? undefined : params);

    // Calcular totais (igual ao faturamento)
    const totals = rows.reduce((acc, row) => {
      acc.totalDuplicata += parseFloat(row.vl_duplicata || 0);
      acc.totalPago += parseFloat(row.vl_pago || 0);
      acc.totalJuros += parseFloat(row.vl_juros || 0);
      acc.totalDesconto += parseFloat(row.vl_desconto || 0);
      return acc;
    }, { totalDuplicata: 0, totalPago: 0, totalJuros: 0, totalDesconto: 0 });

    successResponse(res, {
      periodo: { dt_inicio, dt_fim },
      empresas,
      totals,
      count: rows.length,
      optimized: isHeavyQuery,
      queryType: isHeavyQuery ? 'joins-essenciais-otimizado' : 'completo-com-todos-joins',
      data: rows
    }, `Fluxo de caixa obtido com sucesso (${isHeavyQuery ? 'otimizado' : 'completo'})`);
  })
);

/**
 * @route GET /financial/contas-receber
 * @desc Buscar contas a receber
 * @access Public
 * @query {dt_inicio, dt_fim, cd_empresa, limit, offset}
 */
router.get('/contas-receber',
  sanitizeInput,
  validateRequired(['dt_inicio', 'dt_fim', 'cd_empresa']),
  validateDateFormat(['dt_inicio', 'dt_fim']),
  validatePagination,
  asyncHandler(async (req, res) => {
    const { dt_inicio, dt_fim, cd_empresa } = req.query;
    const limit = parseInt(req.query.limit, 10) || 50000000;
    const offset = parseInt(req.query.offset, 10) || 0;

    const query = `
      SELECT
        vff.cd_empresa,
        vff.cd_cliente,
        vff.nm_cliente,
        vff.nr_parcela,
        vff.dt_emissao,
        vff.dt_vencimento,
        vff.dt_cancelamento,
        vff.dt_liq,
        vff.tp_cobranca,
        vff.tp_documento,
        vff.tp_faturamento,
        vff.tp_inclusao,
        vff.tp_baixa,
        vff.tp_situacao,
        vff.vl_fatura,
        vff.vl_original,
        vff.vl_abatimento,
        vff.vl_pago,
        vff.vl_desconto,
        vff.vl_liquido,
        vff.vl_acrescimo,
        vff.vl_multa,
        vff.nr_portador,
        vff.vl_renegociacao,
        vff.vl_corrigido,
        vff.vl_juros,
        vff.pr_juromes,
        vff.pr_multa
      FROM vr_fcr_faturai vff
      WHERE vff.dt_emissao BETWEEN $1 AND $2
        AND vff.cd_empresa = $3
      ORDER BY vff.dt_emissao DESC
      LIMIT $4 OFFSET $5
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM vr_fcr_faturai vff
      WHERE vff.dt_emissao BETWEEN $1 AND $2
        AND vff.cd_empresa = $3
    `;

    const [resultado, totalResult] = await Promise.all([
      pool.query(query, [dt_inicio, dt_fim, cd_empresa, limit, offset]),
      pool.query(countQuery, [dt_inicio, dt_fim, cd_empresa])
    ]);

    const total = parseInt(totalResult.rows[0].total, 10);

    successResponse(res, {
      total,
      limit,
      offset,
      hasMore: (offset + limit) < total,
      filtros: { dt_inicio, dt_fim, cd_empresa },
      data: resultado.rows
    }, 'Contas a receber obtidas com sucesso');
  })
);

/**
 * @route GET /financial/nfmanifestacao
 * @desc Buscar notas fiscais de manifestação
 * @access Public
 * @query {dt_inicio, dt_fim, cd_empresa, limit, offset}
 */
router.get('/nfmanifestacao',
  sanitizeInput,
  validateRequired(['dt_inicio', 'dt_fim', 'cd_empresa']),
  validateDateFormat(['dt_inicio', 'dt_fim']),
  validatePagination,
  asyncHandler(async (req, res) => {
    const { dt_inicio, dt_fim, cd_empresa } = req.query;
    const limit = parseInt(req.query.limit, 10) || 50000000;
    const offset = parseInt(req.query.offset, 10) || 0;

    // Construir query dinamicamente para suportar múltiplas empresas
    let baseQuery = ' FROM fis_nfmanifestacao fn WHERE fn.dt_emissao BETWEEN $1 AND $2';
    const params = [dt_inicio, dt_fim];
    let idx = 3;

    if (cd_empresa) {
      if (Array.isArray(cd_empresa) && cd_empresa.length > 0) {
        const cd_empresa_num = cd_empresa.map(Number);
        baseQuery += ` AND fn.cd_empresa IN (${cd_empresa_num.map(() => `$${idx++}`).join(',')})`;
        params.push(...cd_empresa_num);
      } else {
        baseQuery += ` AND fn.cd_empresa = $${idx++}`;
        params.push(Number(cd_empresa));
      }
    }

    const query = `
      SELECT
        fn.cd_empresa,
        fn.nr_nf,
        fn.cd_serie,
        fn.nr_nsu,
        fn.ds_chaveacesso,
        fn.nr_cnpjemi,
        fn.nm_razaosocial,
        fn.vl_totalnota,
        fn.tp_situacaoman,
        fn.dt_emissao,
        fn.tp_situacao,
        fn.tp_operacao,
        fn.cd_operador,
        fn.tp_moddctofiscal,
        fn.nr_fatura,
        fn.dt_fatura,
        fn.dt_cadastro
      ${baseQuery}
      ORDER BY fn.dt_emissao DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `;

    const countQuery = `SELECT COUNT(*) as total ${baseQuery}`;

    const dataParams = [...params, limit, offset];
    const [resultado, totalResult] = await Promise.all([
      pool.query(query, dataParams),
      pool.query(countQuery, params)
    ]);

    const total = parseInt(totalResult.rows[0].total, 10);

    successResponse(res, {
      total,
      limit,
      offset,
      hasMore: (offset + limit) < total,
      filtros: { dt_inicio, dt_fim, cd_empresa },
      data: resultado.rows
    }, 'Notas fiscais de manifestação obtidas com sucesso');
  })
);

/**
 * @route GET /financial/observacao
 * @desc Buscar observações de duplicatas
 * @access Public
 * @query {cd_fornecedor, nr_duplicata, cd_empresa, nr_parcela}
 */
router.get('/observacao',
  sanitizeInput,
  validateRequired(['cd_fornecedor', 'nr_duplicata', 'cd_empresa', 'nr_parcela']),
  asyncHandler(async (req, res) => {
    const { cd_fornecedor, nr_duplicata, cd_empresa, nr_parcela } = req.query;

    const query = `
      SELECT
        od.cd_fornecedor,
        od.nr_duplicata,
        od.dt_cadastro,
        od.cd_empresa,
        od.nr_parcela,
        od.ds_observacao
      FROM obs_dupi od
      WHERE od.cd_fornecedor = $1
        AND od.nr_duplicata = $2
        AND od.cd_empresa = $3
        AND od.nr_parcela = $4
    `;

    const { rows } = await pool.query(query, [cd_fornecedor, nr_duplicata, cd_empresa, nr_parcela]);

    successResponse(res, {
      filtros: { cd_fornecedor, nr_duplicata, cd_empresa, nr_parcela },
      count: rows.length,
      data: rows
    }, 'Observações obtidas com sucesso');
  })
);

/**
 * @route POST /financial/upload-retorno
 * @desc Upload e processamento de arquivo de retorno bancário
 * @access Public
 * @body {file} - Arquivo .RET do banco
 */
router.post('/upload-retorno',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return errorResponse(res, 'Nenhum arquivo foi enviado', 400, 'NO_FILE_UPLOADED');
    }

    try {
      // Ler o arquivo
      const fileContent = fs.readFileSync(req.file.path, 'utf8');
      
      // Processar o arquivo
      const parser = new BankReturnParser();
      const result = parser.parseFile(fileContent);
      
      // Adicionar informações do arquivo
      result.arquivo.nomeOriginal = req.file.originalname;
      result.arquivo.tamanho = req.file.size;
      result.arquivo.dataUpload = new Date().toISOString();
      
      // Limpar arquivo temporário
      fs.unlinkSync(req.file.path);
      
      successResponse(res, result, 'Arquivo de retorno processado com sucesso');
      
    } catch (error) {
      // Limpar arquivo em caso de erro
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      
      return errorResponse(res, `Erro ao processar arquivo: ${error.message}`, 400, 'FILE_PROCESSING_ERROR');
    }
  })
);

/**
 * @route POST /financial/upload-retorno-multiplo
 * @desc Upload e processamento de múltiplos arquivos de retorno bancário
 * @access Public
 * @body {files[]} - Array de arquivos .RET do banco (máximo 10)
 */
router.post('/upload-retorno-multiplo',
  (req, res, next) => {
    uploadMultiple(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_COUNT') {
          return errorResponse(res, 'Máximo de 10 arquivos permitidos', 400, 'TOO_MANY_FILES');
        }
        if (err.code === 'LIMIT_FILE_SIZE') {
          return errorResponse(res, 'Arquivo muito grande (máximo 10MB)', 400, 'FILE_TOO_LARGE');
        }
        return errorResponse(res, `Erro no upload: ${err.message}`, 400, 'UPLOAD_ERROR');
      } else if (err) {
        return errorResponse(res, `Erro no upload: ${err.message}`, 400, 'UPLOAD_ERROR');
      }
      next();
    });
  },
  asyncHandler(async (req, res) => {
    if (!req.files || req.files.length === 0) {
      return errorResponse(res, 'Nenhum arquivo foi enviado', 400, 'NO_FILES_UPLOADED');
    }

    const resultados = [];
    const arquivosProcessados = [];
    const arquivosComErro = [];

    console.log(`📁 Processando ${req.files.length} arquivos...`);

    for (const file of req.files) {
      try {
        console.log(`📄 Processando arquivo: ${file.originalname}`);
        
        // Ler o arquivo
        const fileContent = fs.readFileSync(file.path, 'utf8');
        
        // Processar o arquivo
        const parser = new BankReturnParser();
        const result = parser.parseFile(fileContent);
        
        // Adicionar informações do arquivo
        result.arquivo.nomeOriginal = file.originalname;
        result.arquivo.tamanho = file.size;
        result.arquivo.dataUpload = new Date().toISOString();
        
        resultados.push(result);
        arquivosProcessados.push(file.originalname);
        
        // Limpar arquivo temporário
        fs.unlinkSync(file.path);
        
        console.log(`✅ Arquivo processado com sucesso: ${file.originalname}`);
        
      } catch (error) {
        console.log(`❌ Erro ao processar arquivo ${file.originalname}: ${error.message}`);
        
        arquivosComErro.push({
          nome: file.originalname,
          erro: error.message
        });
        
        // Limpar arquivo em caso de erro
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      }
    }

    // Calcular resumo
    const totalArquivos = req.files.length;
    const sucessos = arquivosProcessados.length;
    const erros = arquivosComErro.length;
    
    // Calcular saldo total (soma de todos os saldos)
    const saldoTotal = resultados.reduce((total, result) => {
      return total + (result.saldoAtual || 0);
    }, 0);

    successResponse(res, {
      resumo: {
        totalArquivos,
        sucessos,
        erros,
        saldoTotal: saldoTotal,
        saldoTotalFormatado: saldoTotal.toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL'
        })
      },
      arquivosProcessados,
      arquivosComErro,
      resultados: resultados.map(result => ({
        banco: result.banco,
        agencia: result.agencia,
        conta: result.conta,
        saldoAtual: result.saldoAtual,
        saldoFormatado: result.saldoFormatado,
        arquivo: result.arquivo
      }))
    }, `Processamento concluído: ${sucessos} sucessos, ${erros} erros`);
  })
);

/**
 * @route GET /financial/saldo-conta
 * @desc Buscar saldo de conta bancária
 * @access Public
 * @query {nr_ctapes, dt_inicio, dt_fim}
 */
router.get('/saldo-conta',
  sanitizeInput,
  validateRequired(['nr_ctapes', 'dt_inicio', 'dt_fim']),
  validateDateFormat(['dt_inicio', 'dt_fim']),
  asyncHandler(async (req, res) => {
    const { nr_ctapes, dt_inicio, dt_fim } = req.query;

    const query = `
      SELECT
        SUM(
          CASE
            WHEN fm.TP_OPERACAO = 'C' THEN fm.vl_lancto
            WHEN fm.TP_OPERACAO = 'D' THEN -fm.vl_lancto
            ELSE 0
          END
        ) as SALDO
      FROM vr_fcc_mov fm
      WHERE fm.nr_ctapes = $1
        AND fm.dt_movim BETWEEN $2 AND $3
    `;

    const { rows } = await pool.query(query, [nr_ctapes, dt_inicio, dt_fim]);

    const saldo = rows[0]?.saldo || 0;

    successResponse(res, {
      filtros: { nr_ctapes, dt_inicio, dt_fim },
      saldo: parseFloat(saldo),
      data: rows[0]
    }, 'Saldo de conta obtido com sucesso');
  })
);

export default router;