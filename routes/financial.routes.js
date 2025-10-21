import express from "express";
import pool, {
  checkConnectionHealth,
} from "../config/database.js";
import {
  validateRequiredMiddleware,
  validateDateFormatMiddleware,
  validatePagination,
  sanitizeInputMiddleware,
} from "../middlewares/validation.middleware.js";
import {
  asyncHandler,
  successResponse,
  errorResponse,
} from "../utils/errorHandler.js";
import multer from "multer";
import { BankReturnParser } from "../utils/bankReturnParser.js";
import fs from "fs";
import path from "path";

const router = express.Router();

/**
 * @route GET /financial/health
 * @desc Verificar saúde da conexão com o banco
 * @access Public
 */
router.get(
  "/health",
  asyncHandler(async (req, res) => {
    const health = await checkConnectionHealth();

    if (health.healthy) {
      successResponse(res, health, "Conexão com banco de dados saudável");
    } else {
      errorResponse(
        res,
        "Problemas na conexão com banco de dados",
        503,
        "DB_CONNECTION_ERROR",
        health
      );
    }
  })
);

// Configuração do multer para upload de arquivos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = "./uploads";
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + "-" + uniqueSuffix + ".RET");
  },
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    // Aceitar arquivos .RET (maiúsculo e minúsculo) e arquivos de texto
    const fileName = file.originalname.toLowerCase();
    if (fileName.endsWith(".ret") || file.mimetype === "text/plain") {
      cb(null, true);
    } else {
      cb(new Error("Apenas arquivos .RET são permitidos"), false);
    }
  },
  // Removidos os limites de tamanho de arquivo
});

// Configuração para upload múltiplo
const uploadMultiple = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    // Aceitar arquivos .RET (maiúsculo e minúsculo) e arquivos de texto
    const fileName = file.originalname.toLowerCase();
    if (fileName.endsWith(".ret") || file.mimetype === "text/plain") {
      cb(null, true);
    } else {
      cb(new Error("Apenas arquivos .RET são permitidos"), false);
    }
  },
  // Removidos os limites de tamanho e quantidade de arquivos
}).array("files"); // Campo 'files' sem limite de quantidade

/**
 * @route GET /financial/extrato
 * @desc Buscar extrato bancário com filtros e paginação
 * @access Public
 * @query {cd_empresa, nr_ctapes, dt_movim_ini, dt_movim_fim, limit, offset}
 */
router.get(
  "/extrato",
  sanitizeInputMiddleware,
  validatePagination,
  asyncHandler(async (req, res) => {
    const { cd_empresa, nr_ctapes, dt_movim_ini, dt_movim_fim } = req.query;
    const limit = parseInt(req.query.limit, 10) || 50000000;
    const offset = parseInt(req.query.offset, 10) || 0;

    let baseQuery = " FROM fcc_extratbco fe WHERE 1=1";
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
        baseQuery += ` AND fe.nr_ctapes IN (${nr_ctapes_num
          .map(() => `$${idx++}`)
          .join(",")})`;
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

    successResponse(
      res,
      {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
        data: rows,
      },
      "Extrato bancário obtido com sucesso"
    );
  })
);

/**
 * @route GET /financial/extrato-totvs
 * @desc Buscar extrato TOTVS com filtros
 * @access Public
 * @query {nr_ctapes, dt_movim_ini, dt_movim_fim, limit, offset}
 */
router.get(
  "/extrato-totvs",
  sanitizeInputMiddleware,
  validatePagination,
  asyncHandler(async (req, res) => {
    const { nr_ctapes, dt_movim_ini, dt_movim_fim } = req.query;
    const limit = parseInt(req.query.limit, 10) || 50000000;
    const offset = parseInt(req.query.offset, 10) || 0;

    let baseQuery = " FROM fcc_mov fm WHERE fm.in_estorno = $1";
    const params = ["F"]; // Filtro fixo para não estornados
    let idx = 2;

    if (nr_ctapes) {
      let contas = Array.isArray(nr_ctapes) ? nr_ctapes : [nr_ctapes];
      if (contas.length > 1) {
        baseQuery += ` AND fm.nr_ctapes IN (${contas
          .map(() => `$${idx++}`)
          .join(",")})`;
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

    successResponse(
      res,
      {
        limit,
        offset,
        count: rows.length,
        data: rows,
      },
      "Extrato TOTVS obtido com sucesso"
    );
  })
);

/**
 * @route GET /financial/contas-pagar
 * @desc Buscar contas a pagar
 * @access Public
 * @query {dt_inicio, dt_fim, cd_empresa, limit, offset}
 */
router.get(
  "/contas-pagar",
  sanitizeInputMiddleware,
  validateRequiredMiddleware(["dt_inicio", "dt_fim", "cd_empresa"]),
  validateDateFormatMiddleware(["dt_inicio", "dt_fim"]),
  asyncHandler(async (req, res) => {
    const { dt_inicio, dt_fim, cd_empresa } = req.query;

    // Seguir o padrão de performance do fluxo de caixa: múltiplas empresas, sem paginação/COUNT
    let empresas = Array.isArray(cd_empresa) ? cd_empresa : [cd_empresa];
    let params = [dt_inicio, dt_fim, ...empresas];
    let empresaPlaceholders = empresas.map((_, idx) => `$${3 + idx}`).join(",");

    // Otimização baseada no número de empresas e período
    const isHeavyQuery =
      empresas.length > 10 ||
      new Date(dt_fim) - new Date(dt_inicio) > 30 * 24 * 60 * 60 * 1000; // 30 dias
    const isVeryHeavyQuery =
      empresas.length > 20 ||
      new Date(dt_fim) - new Date(dt_inicio) > 90 * 24 * 60 * 60 * 1000; // 90 dias

    const query = isVeryHeavyQuery
      ? `
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
        vfd.vl_rateio,
        fd.in_aceite,
        vfd.cd_despesaitem,
        fd.tp_previsaoreal,
        vfd.cd_ccusto
      FROM vr_fcp_duplicatai fd
      LEFT JOIN vr_fcp_despduplicatai vfd ON fd.nr_duplicata = vfd.nr_duplicata 
        AND fd.cd_empresa = vfd.cd_empresa 
        AND fd.cd_fornecedor = vfd.cd_fornecedor
      WHERE fd.dt_vencimento BETWEEN $1 AND $2
        AND fd.cd_empresa IN (${empresaPlaceholders})
      ORDER BY fd.dt_vencimento DESC
    `
      : `
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
        vfd.vl_rateio,
        fd.in_aceite,
        vfd.cd_despesaitem,
        fd.tp_previsaoreal,
        vfd.cd_ccusto
      FROM vr_fcp_duplicatai fd
      LEFT JOIN vr_fcp_despduplicatai vfd ON fd.nr_duplicata = vfd.nr_duplicata 
        AND fd.cd_empresa = vfd.cd_empresa 
        AND fd.cd_fornecedor = vfd.cd_fornecedor
      WHERE fd.dt_vencimento BETWEEN $1 AND $2
        AND fd.cd_empresa IN (${empresaPlaceholders})
      ORDER BY fd.dt_liq DESC
      
    `;

    const queryType = isVeryHeavyQuery
      ? "muito-pesada"
      : isHeavyQuery
      ? "pesada"
      : "completa";
    console.log(
      `🔍 Contas-pagar: ${empresas.length} empresas, período: ${dt_inicio} a ${dt_fim}, query: ${queryType}`
    );

    const { rows } = await pool.query(query, params);

    // Totais agregados (como no fluxo de caixa)
    const totals = rows.reduce(
      (acc, row) => {
        acc.totalDuplicata += parseFloat(row.vl_duplicata || 0);
        acc.totalPago += parseFloat(row.vl_pago || 0);
        acc.totalJuros += parseFloat(row.vl_juros || 0);
        acc.totalDesconto += parseFloat(row.vl_desconto || 0);
        return acc;
      },
      { totalDuplicata: 0, totalPago: 0, totalJuros: 0, totalDesconto: 0 }
    );

    successResponse(
      res,
      {
        periodo: { dt_inicio, dt_fim },
        empresas,
        totals,
        count: rows.length,
        optimized: isHeavyQuery || isVeryHeavyQuery,
        queryType: queryType,
        performance: {
          isHeavyQuery,
          isVeryHeavyQuery,
          diasPeriodo: Math.ceil(
            (new Date(dt_fim) - new Date(dt_inicio)) / (1000 * 60 * 60 * 24)
          ),
          limiteAplicado: "sem limite",
        },
        data: rows,
      },
      `Contas a pagar obtidas com sucesso (${queryType})`
    );
  })
);

/**
 * @route GET /financial/contas-pagar-emissao
 * @desc Buscar contas a pagar por data de emissão
 * @access Public
 * @query {dt_inicio, dt_fim, cd_empresa, limit, offset}
 */
router.get(
  "/contas-pagar-emissao",
  sanitizeInputMiddleware,
  validateRequiredMiddleware(["dt_inicio", "dt_fim", "cd_empresa"]),
  validateDateFormatMiddleware(["dt_inicio", "dt_fim"]),
  asyncHandler(async (req, res) => {
    const { dt_inicio, dt_fim, cd_empresa } = req.query;

    // Seguir o padrão de performance do fluxo de caixa: múltiplas empresas, sem paginação/COUNT
    let empresas = Array.isArray(cd_empresa) ? cd_empresa : [cd_empresa];
    let params = [dt_inicio, dt_fim, ...empresas];
    let empresaPlaceholders = empresas.map((_, idx) => `$${3 + idx}`).join(",");

    // Otimização baseada no número de empresas e período
    const isHeavyQuery =
      empresas.length > 10 ||
      new Date(dt_fim) - new Date(dt_inicio) > 30 * 24 * 60 * 60 * 1000; // 30 dias
    const isVeryHeavyQuery =
      empresas.length > 20 ||
      new Date(dt_fim) - new Date(dt_inicio) > 90 * 24 * 60 * 60 * 1000; // 90 dias

    const query = isVeryHeavyQuery
      ? `
      select
        fd.cd_empresa,
        fd.cd_fornecedor,
        fd.nr_duplicata,
        fd.nr_portador,
        fd.nr_parcela,
        vfd.vl_rateio,
        vfd.cd_ccusto,
        vfd.cd_despesaitem,
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
        fd.in_aceite,
        fd.tp_previsaoreal
      from
        vr_fcp_duplicatai fd
      left join vr_fcp_despduplicatai vfd on
        fd.nr_duplicata = vfd.nr_duplicata
        and fd.cd_empresa = vfd.cd_empresa
        and fd.cd_fornecedor = vfd.cd_fornecedor
        and fd.dt_emissao = vfd.dt_emissao
        and fd.nr_parcela = vfd.nr_parcela
      where
        fd.dt_emissao between $1 and $2
        and fd.cd_empresa in (${empresaPlaceholders})
        and fd.tp_situacao = 'N'
        and fd.tp_previsaoreal = 2
      group by
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
        fd.in_aceite,
        fd.tp_previsaoreal,
        vfd.vl_rateio,
        vfd.cd_ccusto,
        vfd.cd_despesaitem
    `
      : `
      select
        fd.cd_empresa,
        fd.cd_fornecedor,
        fd.nr_duplicata,
        fd.nr_portador,
        fd.nr_parcela,
        vfd.vl_rateio,
        vfd.cd_ccusto,
        vfd.cd_despesaitem,
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
        fd.in_aceite,
        fd.tp_previsaoreal
      from
        vr_fcp_duplicatai fd
      left join vr_fcp_despduplicatai vfd on
        fd.nr_duplicata = vfd.nr_duplicata
        and fd.cd_empresa = vfd.cd_empresa
        and fd.cd_fornecedor = vfd.cd_fornecedor
        and fd.dt_emissao = vfd.dt_emissao
        and fd.nr_parcela = vfd.nr_parcela
      where
        fd.dt_emissao between $1 and $2
        and fd.cd_empresa in (${empresaPlaceholders})
        and fd.tp_situacao = 'N'
        and fd.tp_previsaoreal = 2
      group by
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
        fd.in_aceite,
        fd.tp_previsaoreal,
        vfd.vl_rateio,
        vfd.cd_ccusto,
        vfd.cd_despesaitem
      
    `;

    const queryType = isVeryHeavyQuery
      ? "muito-pesada"
      : isHeavyQuery
      ? "pesada"
      : "completa";
    console.log(
      `🔍 Contas-pagar-emissao: ${empresas.length} empresas, período: ${dt_inicio} a ${dt_fim}, query: ${queryType}`
    );

    const { rows } = await pool.query(query, params);

    // Totais agregados (como no fluxo de caixa)
    const totals = rows.reduce(
      (acc, row) => {
        acc.totalDuplicata += parseFloat(row.vl_duplicata || 0);
        acc.totalPago += parseFloat(row.vl_pago || 0);
        acc.totalJuros += parseFloat(row.vl_juros || 0);
        acc.totalDesconto += parseFloat(row.vl_desconto || 0);
        return acc;
      },
      { totalDuplicata: 0, totalPago: 0, totalJuros: 0, totalDesconto: 0 }
    );

    successResponse(
      res,
      {
        periodo: { dt_inicio, dt_fim },
        empresas,
        totals,
        count: rows.length,
        optimized: isHeavyQuery || isVeryHeavyQuery,
        queryType: queryType,
        performance: {
          isHeavyQuery,
          isVeryHeavyQuery,
          diasPeriodo: Math.ceil(
            (new Date(dt_fim) - new Date(dt_inicio)) / (1000 * 60 * 60 * 24)
          ),
          limiteAplicado: "sem limite",
        },
        data: rows,
      },
      `Contas a pagar por data de emissão obtidas com sucesso (${queryType})`
    );
  })
);

/**
 * @route GET /financial/fluxocaixa-saida
 * @desc Buscar fluxo de caixa de saída (baseado na data de liquidação)
 * @access Public
 * @query {dt_inicio, dt_fim, cd_empresa, limit, offset}
 */
router.get(
  "/fluxocaixa-saida",
  sanitizeInputMiddleware,
  validateRequiredMiddleware(["dt_inicio", "dt_fim", "cd_empresa"]),
  validateDateFormatMiddleware(["dt_inicio", "dt_fim"]),
  asyncHandler(async (req, res) => {
    const { dt_inicio, dt_fim, cd_empresa } = req.query;

    // Seguir o padrão de performance do fluxo de caixa: múltiplas empresas, sem paginação/COUNT
    let empresas = Array.isArray(cd_empresa) ? cd_empresa : [cd_empresa];
    let params = [dt_inicio, dt_fim, ...empresas];
    let empresaPlaceholders = empresas.map((_, idx) => `$${3 + idx}`).join(",");

    // Otimização baseada no número de empresas e período
    const isHeavyQuery =
      empresas.length > 10 ||
      new Date(dt_fim) - new Date(dt_inicio) > 30 * 24 * 60 * 60 * 1000; // 30 dias
    const isVeryHeavyQuery =
      empresas.length > 20 ||
      new Date(dt_fim) - new Date(dt_inicio) > 90 * 24 * 60 * 60 * 1000; // 90 dias

    const query = isVeryHeavyQuery
      ? `
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
        vfd.vl_rateio,
        fd.in_aceite,
        vfd.cd_despesaitem,
        fd.tp_previsaoreal,
        vfd.cd_ccusto
      FROM vr_fcp_duplicatai fd
      LEFT JOIN vr_fcp_despduplicatai vfd ON fd.nr_duplicata = vfd.nr_duplicata 
        AND fd.cd_empresa = vfd.cd_empresa 
        AND fd.cd_fornecedor = vfd.cd_fornecedor
      WHERE fd.dt_liq BETWEEN $1 AND $2
        AND fd.cd_empresa IN (${empresaPlaceholders})
      ORDER BY fd.dt_liq DESC
      LIMIT 50000
    `
      : `
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
        vfd.vl_rateio,
        fd.in_aceite,
        vfd.cd_despesaitem,
        fd.tp_previsaoreal,
        vfd.cd_ccusto
      FROM vr_fcp_duplicatai fd
      LEFT JOIN vr_fcp_despduplicatai vfd ON fd.nr_duplicata = vfd.nr_duplicata 
        AND fd.cd_empresa = vfd.cd_empresa 
        AND fd.cd_fornecedor = vfd.cd_fornecedor
      WHERE fd.dt_liq BETWEEN $1 AND $2
        AND fd.cd_empresa IN (${empresaPlaceholders})
      ORDER BY fd.dt_liq DESC
      ${isHeavyQuery ? "LIMIT 100000" : ""}
    `;

    const queryType = isVeryHeavyQuery
      ? "muito-pesada"
      : isHeavyQuery
      ? "pesada"
      : "completa";
    console.log(
      `🔍 Fluxocaixa-saida: ${empresas.length} empresas, período: ${dt_inicio} a ${dt_fim}, query: ${queryType}`
    );

    const { rows } = await pool.query(query, params);

    // Totais agregados (como no fluxo de caixa)
    const totals = rows.reduce(
      (acc, row) => {
        acc.totalDuplicata += parseFloat(row.vl_duplicata || 0);
        acc.totalPago += parseFloat(row.vl_pago || 0);
        acc.totalJuros += parseFloat(row.vl_juros || 0);
        acc.totalDesconto += parseFloat(row.vl_desconto || 0);
        return acc;
      },
      { totalDuplicata: 0, totalPago: 0, totalJuros: 0, totalDesconto: 0 }
    );

    successResponse(
      res,
      {
        periodo: { dt_inicio, dt_fim },
        empresas,
        totals,
        count: rows.length,
        optimized: isHeavyQuery || isVeryHeavyQuery,
        queryType: queryType,
        performance: {
          isHeavyQuery,
          isVeryHeavyQuery,
          diasPeriodo: Math.ceil(
            (new Date(dt_fim) - new Date(dt_inicio)) / (1000 * 60 * 60 * 24)
          ),
          limiteAplicado: isVeryHeavyQuery
            ? 50000
            : isHeavyQuery
            ? 100000
            : "sem limite",
        },
        data: rows,
      },
      `Fluxo de caixa de saída obtido com sucesso (${queryType})`
    );
  })
);

/**
 * @route GET /financial/centrocusto
 * @desc Buscar descrições de centros de custo baseado nos códigos
 * @access Public
 * @query {cd_ccusto[]} - Array de códigos de centros de custo
 */
router.get(
  "/centrocusto",
  sanitizeInputMiddleware,
  validateRequiredMiddleware(["cd_ccusto"]),
  asyncHandler(async (req, res) => {
    const { cd_ccusto } = req.query;

    // Converter para array se for string única
    let centrosCusto = Array.isArray(cd_ccusto) ? cd_ccusto : [cd_ccusto];

    // Remover valores vazios ou nulos
    centrosCusto = centrosCusto.filter(
      (c) => c && c !== "" && c !== "null" && c !== "undefined"
    );

    if (centrosCusto.length === 0) {
      return errorResponse(
        res,
        "Pelo menos um código de centro de custo deve ser fornecido",
        400,
        "MISSING_PARAMETER"
      );
    }

    // Criar placeholders para a query
    let params = [...centrosCusto];
    let ccustoPlaceholders = centrosCusto
      .map((_, idx) => `$${idx + 1}`)
      .join(",");

    // Query simples para buscar descrições dos centros de custo
    const query = `
      SELECT 
        cd_ccusto,
        ds_ccusto
      FROM gec_ccusto 
      WHERE cd_ccusto IN (${ccustoPlaceholders})
      ORDER BY ds_ccusto
    `;

    console.log(
      `🔍 Centro-custo: buscando ${centrosCusto.length} centros de custo`
    );

    try {
      const { rows } = await pool.query(query, params);

      successResponse(
        res,
        {
          centros_custo_buscados: centrosCusto,
          centros_custo_encontrados: rows.length,
          data: rows,
        },
        "Descrições de centros de custo obtidas com sucesso"
      );
    } catch (error) {
      console.error("❌ Erro na query de centros de custo:", error);
      throw error;
    }
  })
);

/**
 * @route GET /financial/despesa
 * @desc Buscar descrições de itens de despesa baseado nos códigos
 * @access Public
 * @query {cd_despesaitem[]} - Array de códigos de itens de despesa
 */
router.get(
  "/despesa",
  sanitizeInputMiddleware,
  validateRequiredMiddleware(["cd_despesaitem"]),
  asyncHandler(async (req, res) => {
    const { cd_despesaitem } = req.query;

    // Converter para array se for string única
    let despesas = Array.isArray(cd_despesaitem)
      ? cd_despesaitem
      : [cd_despesaitem];

    // Remover valores vazios ou nulos
    despesas = despesas.filter(
      (d) => d && d !== "" && d !== "null" && d !== "undefined"
    );

    if (despesas.length === 0) {
      return errorResponse(
        res,
        "Pelo menos um código de item de despesa deve ser fornecido",
        400,
        "MISSING_PARAMETER"
      );
    }

    // Criar placeholders para a query
    let params = [...despesas];
    let despesaPlaceholders = despesas.map((_, idx) => `$${idx + 1}`).join(",");

    // Query simples para buscar descrições dos itens de despesa
    const query = `
      SELECT
        fd.cd_despesaitem,
        fd.ds_despesaitem
      FROM fcp_despesaitem fd
      WHERE fd.cd_despesaitem IN (${despesaPlaceholders})
      ORDER BY fd.ds_despesaitem
    `;

    console.log(`🔍 Despesa: buscando ${despesas.length} itens de despesa`);

    try {
      const { rows } = await pool.query(query, params);

      successResponse(
        res,
        {
          despesas_buscadas: despesas,
          despesas_encontradas: rows.length,
          data: rows,
        },
        "Descrições de itens de despesa obtidas com sucesso"
      );
    } catch (error) {
      console.error("❌ Erro na query de itens de despesa:", error);
      throw error;
    }
  })
);

/**
 * @route GET /financial/fornecedor
 * @desc Buscar nomes de fornecedores baseado nos códigos do contas a pagar
 * @access Public
 * @query {cd_fornecedor[]} - Array de códigos de fornecedores
 */
router.get(
  "/fornecedor",
  sanitizeInputMiddleware,
  validateRequiredMiddleware(["cd_fornecedor"]),
  asyncHandler(async (req, res) => {
    const { cd_fornecedor } = req.query;

    // Converter para array se for string única
    let fornecedores = Array.isArray(cd_fornecedor)
      ? cd_fornecedor
      : [cd_fornecedor];

    // Remover valores vazios ou nulos
    fornecedores = fornecedores.filter(
      (f) => f && f !== "" && f !== "null" && f !== "undefined"
    );

    if (fornecedores.length === 0) {
      return errorResponse(
        res,
        "Pelo menos um código de fornecedor deve ser fornecido",
        400,
        "MISSING_PARAMETER"
      );
    }

    // Criar placeholders para a query
    let params = [...fornecedores];
    let fornecedorPlaceholders = fornecedores
      .map((_, idx) => `$${idx + 1}`)
      .join(",");

    // Query simples para buscar nomes dos fornecedores
    const query = `
      SELECT 
        cd_fornecedor,
        nm_fornecedor
      FROM vr_pes_fornecedor 
      WHERE cd_fornecedor IN (${fornecedorPlaceholders})
      ORDER BY nm_fornecedor
    `;

    console.log(`🔍 Fornecedor: buscando ${fornecedores.length} fornecedores`);

    try {
      const { rows } = await pool.query(query, params);

      successResponse(
        res,
        {
          fornecedores_buscados: fornecedores,
          fornecedores_encontrados: rows.length,
          data: rows,
        },
        "Nomes de fornecedores obtidos com sucesso"
      );
    } catch (error) {
      console.error("❌ Erro na query de fornecedores:", error);
      throw error;
    }
  })
);

/**
 * @route GET /financial/contas-receber
 * @desc Buscar contas a receber
 * @access Public
 * @query {dt_inicio, dt_fim, cd_empresa, limit, offset}
 */
router.get(
  "/contas-receber",
  sanitizeInputMiddleware,
  validateRequiredMiddleware(["dt_inicio", "dt_fim", "cd_empresa"]),
  validateDateFormatMiddleware(["dt_inicio", "dt_fim"]),
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
      WHERE vff.dt_vencimento BETWEEN $1 AND $2
        AND vff.cd_empresa = $3
      ORDER BY vff.dt_vencimento DESC
      LIMIT $4 OFFSET $5
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM vr_fcr_faturai vff
      WHERE vff.dt_vencimento BETWEEN $1 AND $2
        AND vff.cd_empresa = $3
    `;

    const [resultado, totalResult] = await Promise.all([
      pool.query(query, [dt_inicio, dt_fim, cd_empresa, limit, offset]),
      pool.query(countQuery, [dt_inicio, dt_fim, cd_empresa]),
    ]);

    const total = parseInt(totalResult.rows[0].total, 10);

    successResponse(
      res,
      {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
        filtros: { dt_inicio, dt_fim, cd_empresa },
        data: resultado.rows,
      },
      "Contas a receber obtidas com sucesso"
    );
  })
);

/**
 * @route GET /financial/contas-receberemiss
 * @desc Buscar contas a receber por data de emissão
 * @access Public
 * @query {dt_inicio, dt_fim, cd_empresa, limit, offset}
 */
router.get(
  "/contas-receberemiss",
  sanitizeInputMiddleware,
  validateRequiredMiddleware(["dt_inicio", "dt_fim", "cd_empresa"]),
  validateDateFormatMiddleware(["dt_inicio", "dt_fim"]),
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
      pool.query(countQuery, [dt_inicio, dt_fim, cd_empresa]),
    ]);

    const total = parseInt(totalResult.rows[0].total, 10);

    successResponse(
      res,
      {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
        filtros: { dt_inicio, dt_fim, cd_empresa },
        data: resultado.rows,
      },
      "Contas a receber por emissão obtidas com sucesso"
    );
  })
);

/**
 * @route GET /financial/fluxocaixa-entradas
 * @desc Buscar fluxo de caixa de entradas (baseado na data de liquidação)
 * @access Public
 * @query {dt_inicio, dt_fim, cd_empresa, limit, offset}
 */
router.get(
  "/fluxocaixa-entradas",
  sanitizeInputMiddleware,
  validateRequiredMiddleware(["dt_inicio", "dt_fim", "cd_empresa"]),
  validateDateFormatMiddleware(["dt_inicio", "dt_fim"]),
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
      WHERE vff.dt_liq BETWEEN $1 AND $2
        AND vff.cd_empresa = $3
      ORDER BY vff.dt_liq DESC
      LIMIT $4 OFFSET $5
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM vr_fcr_faturai vff
      WHERE vff.dt_liq BETWEEN $1 AND $2
        AND vff.cd_empresa = $3
    `;

    const [resultado, totalResult] = await Promise.all([
      pool.query(query, [dt_inicio, dt_fim, cd_empresa, limit, offset]),
      pool.query(countQuery, [dt_inicio, dt_fim, cd_empresa]),
    ]);

    const total = parseInt(totalResult.rows[0].total, 10);

    successResponse(
      res,
      {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
        filtros: { dt_inicio, dt_fim, cd_empresa },
        data: resultado.rows,
      },
      "Fluxo de caixa de entradas obtido com sucesso"
    );
  })
);

/**
 * @route GET /financial/inadimplentes-multimarcas
 * @desc Buscar inadimplentes multimarcas com filtros de classificação
 * @access Public
 * @query {dt_inicio, dt_fim, dt_vencimento_ini, limit, offset}
 */
router.get(
  "/inadimplentes-multimarcas",
  sanitizeInputMiddleware,
  validateRequiredMiddleware(["dt_inicio", "dt_fim", "dt_vencimento_ini"]),
  validateDateFormatMiddleware(["dt_inicio", "dt_fim", "dt_vencimento_ini"]),
  validatePagination,
  asyncHandler(async (req, res) => {
    const { dt_inicio, dt_fim, dt_vencimento_ini } = req.query;
    const limit = parseInt(req.query.limit, 10) || 50000000;
    const offset = parseInt(req.query.offset, 10) || 0;

    const query = `
      SELECT
        DISTINCT vff.cd_cliente,
        vff.cd_empresa,
        vff.nm_cliente,
        pp.ds_siglaest,
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
      LEFT JOIN vr_pes_pessoaclas vpp ON vff.cd_cliente = vpp.cd_pessoa
      LEFT JOIN vr_pes_endereco pp ON vpp.cd_pessoa = pp.cd_pessoa
      WHERE vff.dt_emissao BETWEEN $1 AND $2
        AND vff.dt_vencimento > $3
        AND vff.dt_liq IS NULL
        AND vff.dt_cancelamento IS NULL
        AND vff.cd_empresa < 5999
        AND vff.vl_pago = 0
        AND (
          (vpp.cd_tipoclas = 20 AND vpp.cd_classificacao::integer = 2)
          OR (vpp.cd_tipoclas = 5 AND vpp.cd_classificacao::integer = 1)
        )
      ORDER BY vff.dt_emissao DESC
      LIMIT $4 OFFSET $5
    `;

    const countQuery = `
      SELECT COUNT(DISTINCT vff.cd_cliente) as total
      FROM vr_fcr_faturai vff
      LEFT JOIN vr_pes_pessoaclas vpp ON vff.cd_cliente = vpp.cd_pessoa
      LEFT JOIN vr_pes_endereco pp ON vpp.cd_pessoa = pp.cd_pessoa
      WHERE vff.dt_emissao BETWEEN $1 AND $2
        AND vff.dt_vencimento > $3
        AND vff.dt_liq IS NULL
        AND vff.dt_cancelamento IS NULL
        AND vff.cd_empresa < 5999
        AND vff.vl_pago = 0
        AND (
          (vpp.cd_tipoclas = 20 AND vpp.cd_classificacao::integer = 2)
          OR (vpp.cd_tipoclas = 5 AND vpp.cd_classificacao::integer = 1)
        )
    `;

    const [resultado, totalResult] = await Promise.all([
      pool.query(query, [dt_inicio, dt_fim, dt_vencimento_ini, limit, offset]),
      pool.query(countQuery, [dt_inicio, dt_fim, dt_vencimento_ini]),
    ]);

    const total = parseInt(totalResult.rows[0].total, 10);

    successResponse(
      res,
      {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
        filtros: { dt_inicio, dt_fim, dt_vencimento_ini },
        data: resultado.rows,
      },
      "Inadimplentes multimarcas obtidos com sucesso"
    );
  })
);


/**
 * @route GET /financial/inadimplentes-multimarcas
 * @desc Buscar inadimplentes multimarcas com filtros de classificação
 * @access Public
 * @query {dt_inicio, dt_fim, dt_vencimento_ini, limit, offset}
 */
router.get(
  "/inadimplentes-revenda",
  sanitizeInputMiddleware,
  validateRequiredMiddleware(["dt_inicio", "dt_fim", "dt_vencimento_ini"]),
  validateDateFormatMiddleware(["dt_inicio", "dt_fim", "dt_vencimento_ini"]),
  validatePagination,
  asyncHandler(async (req, res) => {
    const { dt_inicio, dt_fim, dt_vencimento_ini } = req.query;
    const limit = parseInt(req.query.limit, 10) || 10000; // Reduzido de 50M para 10K
    const offset = parseInt(req.query.offset, 10) || 0;

    // Validação adicional para evitar períodos muito longos
    const inicioDate = new Date(dt_inicio);
    const fimDate = new Date(dt_fim);
    const diffDays = (fimDate - inicioDate) / (1000 * 60 * 60 * 24);
    
    if (diffDays > 365) {
      return errorResponse(
        res,
        "Período muito longo. Máximo permitido: 365 dias",
        400,
        "PERIOD_TOO_LONG"
      );
    }

    const query = `
      SELECT
        DISTINCT vff.cd_cliente,
        vff.cd_empresa,
        vff.nm_cliente,
        pp.ds_siglaest,
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
      LEFT JOIN vr_pes_pessoaclas vpp ON vff.cd_cliente = vpp.cd_pessoa
      LEFT JOIN vr_pes_endereco pp ON vpp.cd_pessoa = pp.cd_pessoa
      WHERE vff.dt_emissao BETWEEN $1 AND $2
        AND vff.dt_vencimento > $3
        AND vff.dt_liq IS NULL
        AND vff.dt_cancelamento IS NULL
        AND vff.cd_empresa < 5999
        AND vff.vl_pago = 0
        AND (
          (vpp.cd_tipoclas = 20 AND vpp.cd_classificacao::integer = 3)
          OR (vpp.cd_tipoclas = 7 AND vpp.cd_classificacao::integer = 1)
        )
      ORDER BY vff.dt_emissao DESC
      LIMIT $4 OFFSET $5
    `;

    const countQuery = `
      SELECT COUNT(DISTINCT vff.cd_cliente) as total
      FROM vr_fcr_faturai vff
      LEFT JOIN vr_pes_pessoaclas vpp ON vff.cd_cliente = vpp.cd_pessoa
      LEFT JOIN vr_pes_endereco pp ON vpp.cd_pessoa = pp.cd_pessoa
      WHERE vff.dt_emissao BETWEEN $1 AND $2
        AND vff.dt_vencimento > $3
        AND vff.dt_liq IS NULL
        AND vff.dt_cancelamento IS NULL
        AND vff.vl_pago = 0
        AND (
          (vpp.cd_tipoclas = 20 AND vpp.cd_classificacao::integer = 3)
          OR (vpp.cd_tipoclas = 7 AND vpp.cd_classificacao::integer = 1)
        )
    `;

    const [resultado, totalResult] = await Promise.all([
      pool.query(query, [dt_inicio, dt_fim, dt_vencimento_ini, limit, offset]),
      pool.query(countQuery, [dt_inicio, dt_fim, dt_vencimento_ini]),
    ]);

    const total = parseInt(totalResult.rows[0].total, 10);

    successResponse(
      res,
      {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
        filtros: { dt_inicio, dt_fim, dt_vencimento_ini },
        data: resultado.rows,
      },
      "Inadimplentes revenda obtidos com sucesso"
    );
  })
);

/**
 * @route GET /financial/inadimplentes-franquias
 * @desc Buscar inadimplentes de franquias CROSBY
 * @access Public
 * @query {dt_inicio, dt_fim, limit, offset}
 */
router.get(
  "/inadimplentes-franquias",
  sanitizeInputMiddleware,
  validateRequiredMiddleware(["dt_inicio", "dt_fim"]),
  validateDateFormatMiddleware(["dt_inicio", "dt_fim"]),
  validatePagination,
  asyncHandler(async (req, res) => {
    const { dt_inicio, dt_fim } = req.query;
    const limit = parseInt(req.query.limit, 10) || 50000000;
    const offset = parseInt(req.query.offset, 10) || 0;

    const query = `
      SELECT
        vff.cd_cliente,
        vff.cd_empresa,
        vff.nr_fat,
        vff.nm_cliente,
        pp.nm_fantasia,
        pp.ds_uf,
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
      LEFT JOIN vr_pes_pessoaclas vpp ON vff.cd_cliente = vpp.cd_pessoa
      LEFT JOIN pes_pesjuridica pp ON vpp.cd_pessoa = pp.cd_pessoa
      WHERE vff.dt_emissao BETWEEN $1 AND $2
        AND vff.dt_vencimento < CURRENT_DATE
        AND vff.dt_liq IS NULL
        AND vff.dt_cancelamento IS NULL
        AND vff.cd_empresa < 5999
        AND vff.vl_pago = 0
        AND pp.nm_fantasia LIKE '%F%CROSBY%'
      GROUP BY
        vff.cd_cliente,
        vff.cd_empresa,
        vff.nr_fat,
        vff.nm_cliente,
        pp.nm_fantasia,
        pp.ds_uf,
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
      ORDER BY vff.dt_emissao DESC
      LIMIT $3 OFFSET $4
    `;

    const countQuery = `
      SELECT COUNT(DISTINCT vff.cd_cliente) as total
      FROM vr_fcr_faturai vff
      LEFT JOIN vr_pes_pessoaclas vpp ON vff.cd_cliente = vpp.cd_pessoa
      LEFT JOIN pes_pesjuridica pp ON vpp.cd_pessoa = pp.cd_pessoa
      WHERE vff.dt_emissao BETWEEN $1 AND $2
        AND vff.dt_vencimento < CURRENT_DATE
        AND vff.dt_liq IS NULL
        AND vff.dt_cancelamento IS NULL
        AND vff.cd_empresa < 5999
        AND vff.vl_pago = 0
        AND pp.nm_fantasia LIKE '%F%CROSBY%'
    `;

    const [resultado, totalResult] = await Promise.all([
      pool.query(query, [dt_inicio, dt_fim, limit, offset]),
      pool.query(countQuery, [dt_inicio, dt_fim]),
    ]);

    const total = parseInt(totalResult.rows[0].total, 10);

    successResponse(
      res,
      {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
        filtros: { dt_inicio, dt_fim },
        data: resultado.rows,
      },
      "Inadimplentes de franquias obtidos com sucesso"
    );
  })
);

/**
 * @route GET /financial/credev-adiantamento
 * @desc Buscar saldos de adiantamentos e crediários
 * @access Public
 */
router.get(
  "/credev-adiantamento",
  sanitizeInputMiddleware,
  asyncHandler(async (req, res) => {
    const query = `
      select
        b.cd_empresa,
        b.nr_ctapes,
        b.cd_pessoa,
        pp.nm_fantasia,
        b.ds_titular,
        case
          a.tp_documento
          when 10 then 'ADIANTAMENTO'
          when 20 then 'CREDEV'
          else a.tp_documento::text
        end as tp_documento,
        SUM(case
            when a.tp_operacao = 'C' then coalesce(a.vl_lancto, 0)
            else -coalesce(a.vl_lancto, 0)
          end) as vl_saldo,
        MAX(case when a.tp_operacao = 'C' then a.dt_movim end) as dt_ultimocredito
      from
        vr_fcc_ctapes b
      join vr_fcc_mov a
        on
        a.nr_ctapes = b.nr_ctapes
      join pes_pesjuridica pp on
        b.cd_pessoa = pp.cd_pessoa
      where
        a.in_estorno = 'F'
        and a.dt_movim <= now()
        and b.tp_manutencao = 2
        and pp.nm_fantasia like 'F%-%CROSBY%'
      group by
        b.cd_empresa,
        b.nr_ctapes,
        b.cd_pessoa,
        b.ds_titular,
        a.tp_documento,
        pp.nm_fantasia
      having
        SUM(case
            when a.tp_operacao = 'C' then coalesce(a.vl_lancto, 0)
            else -coalesce(a.vl_lancto, 0)
          end) > 0
      order by
        vl_saldo desc
    `;

    const { rows } = await pool.query(query);

    successResponse(
      res,
      {
        count: rows.length,
        data: rows,
      },
      "Adiantamentos e crediários obtidos com sucesso"
    );
  })
);

/**
 * @route GET /financial/credev-revenda
 * @desc Buscar saldos de crediários de revenda
 * @access Public
 */
router.get(
  "/credev-revenda",
  sanitizeInputMiddleware,
  asyncHandler(async (req, res) => {
    const query = `
      select
        b.cd_empresa,
        b.nr_ctapes,
        b.cd_pessoa,
        pp.nm_pessoa,
        case
          a.tp_documento
          when 10 then 'ADIANTAMENTO'
          when 20 then 'CREDEV'
          else a.tp_documento::text
        end as tp_documento,
        SUM(case
            when a.tp_operacao = 'C' then coalesce(a.vl_lancto, 0)
            else -coalesce(a.vl_lancto, 0)
          end) as vl_saldo,
        MAX(case when a.tp_operacao = 'C' then a.dt_movim end) as dt_ultimocredito
      from
        vr_fcc_ctapes b
      join vr_fcc_mov a
        on
        a.nr_ctapes = b.nr_ctapes
      join pes_pessoa pp on
        b.cd_pessoa = pp.cd_pessoa
      left join vr_pes_pessoaclas pc on
        pc.cd_pessoa = b.cd_pessoa
      where
        a.in_estorno = 'F'
        and a.dt_movim <= now()
        and b.tp_manutencao = 2
        and pc.cd_tipoclas = 20
        and pc.cd_classificacao::integer = 3
      group by
        b.cd_empresa,
        b.nr_ctapes,
        b.cd_pessoa,
        b.ds_titular,
        a.tp_documento,
        pp.nm_pessoa
      having
        SUM(case
            when a.tp_operacao = 'C' then coalesce(a.vl_lancto, 0)
            else -coalesce(a.vl_lancto, 0)
          end) > 0
      order by
        vl_saldo desc
    `;

    const { rows } = await pool.query(query);

    successResponse(
      res,
      {
        count: rows.length,
        data: rows,
      },
      "Crediários de revenda obtidos com sucesso"
    );
  })
);

/**
 * @route GET /financial/credev-varejo
 * @desc Buscar saldos de crediários de varejo
 * @access Public
 */
router.get(
  "/credev-varejo",
  sanitizeInputMiddleware,
  asyncHandler(async (req, res) => {
    const query = `
      select
        b.cd_pessoa,
        b.cd_empresa,
        b.nr_ctapes,
        pp.nm_pessoa,
        case
          a.tp_documento
          when 10 then 'ADIANTAMENTO'
          when 20 then 'CREDEV'
          else a.tp_documento::text
        end as tp_documento,
        SUM(case
            when a.tp_operacao = 'C' then coalesce(a.vl_lancto, 0)
            else -coalesce(a.vl_lancto, 0)
          end) as vl_saldo,
        MAX(case when a.tp_operacao = 'C' then a.dt_movim end) as dt_ultimocredito
      from
        vr_fcc_ctapes b
      join vr_fcc_mov a
        on
        a.nr_ctapes = b.nr_ctapes
      join pes_pessoa pp on
        b.cd_pessoa = pp.cd_pessoa
      join pes_pessoaclas pc on
        pp.cd_pessoa = pc.cd_pessoa
      where
        a.in_estorno = 'F'
        and a.dt_movim <= now()
        and b.tp_manutencao = 2
        and b.cd_empresa in (2, 5, 55, 65, 90, 91, 92, 93, 94, 95, 96, 97)
        and (
        (pc.cd_tipoclas = 20
        and pc.cd_classificacao::integer = 1)
        or (pc.cd_tipoclas = 55))
      group by
        b.cd_empresa,
        b.nr_ctapes,
        b.cd_pessoa,
        b.ds_titular,
        a.tp_documento,
        pp.nm_pessoa
      having
        SUM(case
            when a.tp_operacao = 'C' then coalesce(a.vl_lancto, 0)
            else -coalesce(a.vl_lancto, 0)
          end) > 0
      order by
        vl_saldo desc
    `;

    const { rows } = await pool.query(query);

    successResponse(
      res,
      {
        count: rows.length,
        data: rows,
      },
      "Crediários de varejo obtidos com sucesso"
    );
  })
);

/**
 * @route GET /financial/credev-mtm
 * @desc Buscar saldos de crediários de MTM
 * @access Public
 */
router.get(
  "/credev-mtm",
  sanitizeInputMiddleware,
  asyncHandler(async (req, res) => {
    const query = `
      select
        b.cd_empresa,
        b.nr_ctapes,
        b.cd_pessoa,
        pp.nm_pessoa,
        case
          a.tp_documento
          when 10 then 'ADIANTAMENTO'
          when 20 then 'CREDEV'
          else a.tp_documento::text
        end as tp_documento,
        SUM(case
            when a.tp_operacao = 'C' then coalesce(a.vl_lancto, 0)
            else -coalesce(a.vl_lancto, 0)
          end) as vl_saldo,
        MAX(case when a.tp_operacao = 'C' then a.dt_movim end) as dt_ultimocredito
      from
        vr_fcc_ctapes b
      join vr_fcc_mov a
        on
        a.nr_ctapes = b.nr_ctapes
      join pes_pessoa pp on
        b.cd_pessoa = pp.cd_pessoa
      left join vr_pes_pessoaclas pc on
        pc.cd_pessoa = b.cd_pessoa
      where
        a.in_estorno = 'F'
        and a.dt_movim <= now()
        and b.tp_manutencao = 2
        and pc.cd_tipoclas = 20
        and pc.cd_classificacao::integer = 2
      group by
        b.cd_empresa,
        b.nr_ctapes,
        b.cd_pessoa,
        b.ds_titular,
        a.tp_documento,
        pp.nm_pessoa
      having
        SUM(case
            when a.tp_operacao = 'C' then coalesce(a.vl_lancto, 0)
            else -coalesce(a.vl_lancto, 0)
          end) > 0
      order by
        vl_saldo desc
    `;

    const { rows } = await pool.query(query);

    successResponse(
      res,
      {
        count: rows.length,
        data: rows,
      },
      "Crediários de MTM obtidos com sucesso"
    );
  })
);

/**
 * @route GET /financial/nfmanifestacao
 * @desc Buscar notas fiscais de manifestação
 * @access Public
 * @query {dt_inicio, dt_fim, cd_empresa, limit, offset}
 */
router.get(
  "/nfmanifestacao",
  sanitizeInputMiddleware,
  validateRequiredMiddleware(["dt_inicio", "dt_fim", "cd_empresa"]),
  validateDateFormatMiddleware(["dt_inicio", "dt_fim"]),
  validatePagination,
  asyncHandler(async (req, res) => {
    const { dt_inicio, dt_fim, cd_empresa } = req.query;
    const limit = parseInt(req.query.limit, 10) || 50000000;
    const offset = parseInt(req.query.offset, 10) || 0;

    // Construir query dinamicamente para suportar múltiplas empresas
    let baseQuery =
      " FROM fis_nfmanifestacao fn WHERE fn.dt_emissao BETWEEN $1 AND $2";
    const params = [dt_inicio, dt_fim];
    let idx = 3;

    if (cd_empresa) {
      if (Array.isArray(cd_empresa) && cd_empresa.length > 0) {
        const cd_empresa_num = cd_empresa.map(Number);
        baseQuery += ` AND fn.cd_empresa IN (${cd_empresa_num
          .map(() => `$${idx++}`)
          .join(",")})`;
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
      pool.query(countQuery, params),
    ]);

    const total = parseInt(totalResult.rows[0].total, 10);

    successResponse(
      res,
      {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
        filtros: { dt_inicio, dt_fim, cd_empresa },
        data: resultado.rows,
      },
      "Notas fiscais de manifestação obtidas com sucesso"
    );
  })
);

/**
 * @route GET /financial/observacao
 * @desc Buscar observações de duplicatas
 * @access Public
 * @query {cd_fornecedor, nr_duplicata, cd_empresa, nr_parcela}
 */
router.get(
  "/observacao",
  sanitizeInputMiddleware,
  validateRequiredMiddleware([
    "cd_fornecedor",
    "nr_duplicata",
    "cd_empresa",
    "nr_parcela",
  ]),
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

    const { rows } = await pool.query(query, [
      cd_fornecedor,
      nr_duplicata,
      cd_empresa,
      nr_parcela,
    ]);

    successResponse(
      res,
      {
        filtros: { cd_fornecedor, nr_duplicata, cd_empresa, nr_parcela },
        count: rows.length,
        data: rows,
      },
      "Observações obtidas com sucesso"
    );
  })
);

/**
 * @route POST /financial/upload-retorno
 * @desc Upload e processamento de arquivo de retorno bancário
 * @access Public
 * @body {file} - Arquivo .RET do banco
 */
router.post(
  "/upload-retorno",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return errorResponse(
        res,
        "Nenhum arquivo foi enviado",
        400,
        "NO_FILE_UPLOADED"
      );
    }

    try {
      // Ler o arquivo
      const fileContent = fs.readFileSync(req.file.path, "utf8");

      // Processar o arquivo
      const parser = new BankReturnParser();
      const result = parser.parseFile(fileContent);

      // Adicionar informações do arquivo
      result.arquivo.nomeOriginal = req.file.originalname;
      result.arquivo.tamanho = req.file.size;
      result.arquivo.dataUpload = new Date().toISOString();

      // Limpar arquivo temporário
      fs.unlinkSync(req.file.path);

      successResponse(res, result, "Arquivo de retorno processado com sucesso");
    } catch (error) {
      // Limpar arquivo em caso de erro
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }

      return errorResponse(
        res,
        `Erro ao processar arquivo: ${error.message}`,
        400,
        "FILE_PROCESSING_ERROR"
      );
    }
  })
);

/**
 * @route POST /financial/upload-retorno-multiplo
 * @desc Upload e processamento de múltiplos arquivos de retorno bancário
 * @access Public
 * @body {files[]} - Array de arquivos .RET do banco (quantidade ilimitada)
 */
router.post(
  "/upload-retorno-multiplo",
  (req, res, next) => {
    uploadMultiple(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        return errorResponse(
          res,
          `Erro no upload: ${err.message}`,
          400,
          "UPLOAD_ERROR"
        );
      } else if (err) {
        return errorResponse(
          res,
          `Erro no upload: ${err.message}`,
          400,
          "UPLOAD_ERROR"
        );
      }
      next();
    });
  },
  asyncHandler(async (req, res) => {
    if (!req.files || req.files.length === 0) {
      return errorResponse(
        res,
        "Nenhum arquivo foi enviado",
        400,
        "NO_FILES_UPLOADED"
      );
    }

    const resultados = [];
    const arquivosProcessados = [];
    const arquivosComErro = [];

    console.log(`📁 Processando ${req.files.length} arquivos...`);

    for (const file of req.files) {
      try {
        console.log(`📄 Processando arquivo: ${file.originalname}`);

        // Ler o arquivo
        const fileContent = fs.readFileSync(file.path, "utf8");

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
        console.log(
          `❌ Erro ao processar arquivo ${file.originalname}: ${error.message}`
        );

        arquivosComErro.push({
          nome: file.originalname,
          erro: error.message,
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

    successResponse(
      res,
      {
        resumo: {
          totalArquivos,
          sucessos,
          erros,
          saldoTotal: saldoTotal,
          saldoTotalFormatado: saldoTotal.toLocaleString("pt-BR", {
            style: "currency",
            currency: "BRL",
          }),
        },
        arquivosProcessados,
        arquivosComErro,
        resultados: resultados.map((result) => ({
          banco: result.banco,
          agencia: result.agencia,
          conta: result.conta,
          dataGeracao: result.dataGeracao,
          horaGeracao: result.horaGeracao,
          saldoAtual: result.saldoAtual,
          saldoFormatado: result.saldoFormatado,
          arquivo: result.arquivo,
        })),
      },
      `Processamento concluído: ${sucessos} sucessos, ${erros} erros`
    );
  })
);

/**
 * @route GET /financial/saldo-conta
 * @desc Buscar saldo de conta bancária
 * @access Public
 * @query {nr_ctapes, dt_inicio, dt_fim}
 */
router.get(
  "/saldo-conta",
  sanitizeInputMiddleware,
  validateRequiredMiddleware(["nr_ctapes", "dt_inicio", "dt_fim"]),
  validateDateFormatMiddleware(["dt_inicio", "dt_fim"]),
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

    successResponse(
      res,
      {
        filtros: { nr_ctapes, dt_inicio, dt_fim },
        saldo: parseFloat(saldo),
        data: rows[0],
      },
      "Saldo de conta obtido com sucesso"
    );
  })
);

/**
 * @route GET /financial/infopessoa
 * @desc Buscar informações de pessoas com endereços
 * @access Public
 * @query {cd_pessoa} - Array de códigos de pessoa
 */
router.get(
  "/infopessoa",
  sanitizeInputMiddleware,
  validateRequiredMiddleware(["cd_pessoa"]),
  asyncHandler(async (req, res) => {
    const { cd_pessoa } = req.query;

    // Converter para array se for string única
    let codigosPessoa = Array.isArray(cd_pessoa) ? cd_pessoa : [cd_pessoa];

    // Validar se há códigos de pessoa
    if (codigosPessoa.length === 0) {
      return errorResponse(
        res,
        "Pelo menos um código de pessoa deve ser fornecido",
        400,
        "MISSING_PERSON_CODE"
      );
    }

    // Construir placeholders para a query IN
    const placeholders = codigosPessoa
      .map((_, index) => `$${index + 1}`)
      .join(",");

    const query = `
      SELECT
        pp.cd_pessoa,
        pe.nm_pessoa,
        pp.nr_cpfcnpj,
        pe.nm_logradouro,
        pe.nr_logradouro,
        pe.nr_caixapostal,
        pe.ds_referencia,
        pe.ds_complemento,
        pe.ds_bairro,
        pe.ds_siglalograd,
        pe.nm_municipio,
        pe.ds_siglaest,
        pe.nm_pais,
        pj.nm_fantasia
      FROM
        pes_pessoa pp
      LEFT JOIN vr_pes_endereco pe ON
        pp.cd_pessoa = pe.cd_pessoa
      LEFT JOIN pes_pesjuridica pj ON pp.cd_pessoa = pj.cd_pessoa
      WHERE pp.cd_pessoa IN (${placeholders})
    `;

    const { rows } = await pool.query(query, codigosPessoa);

    successResponse(
      res,
      {
        filtros: { cd_pessoa: codigosPessoa },
        count: rows.length,
        data: rows,
      },
      "Informações de pessoas obtidas com sucesso"
    );
  })
);

/**
 * @route GET /financial/auditor-credev
 * @desc Buscar movimentações financeiras para auditoria de crédito e débito
 * @access Public
 * @query {nr_ctapes, dt_movim_ini, dt_movim_fim}
 */
router.get(
  "/auditor-credev",
  sanitizeInputMiddleware,
  validateRequiredMiddleware(["nr_ctapes", "dt_movim_ini", "dt_movim_fim"]),
  validateDateFormatMiddleware(["dt_movim_ini", "dt_movim_fim"]),
  asyncHandler(async (req, res) => {
    const { nr_ctapes, dt_movim_ini, dt_movim_fim } = req.query;

    const query = `
      SELECT
        fm.cd_empresa,
        fm.nr_ctapes,
        fm.dt_movim,
        fm.ds_doc,
        fm.dt_liq,
        fm.in_estorno,
        fm.tp_operacao,
        fm.ds_aux,
        fm.vl_lancto,
        fm.dt_movim,
        fm.cd_operador,
        au.nm_usuario
      FROM
        fcc_mov fm
      LEFT JOIN adm_usuario au ON fm.cd_operador = au.cd_usuario
      WHERE
        fm.nr_ctapes = $1
        AND fm.dt_movim BETWEEN $2 AND $3
      ORDER BY fm.dt_movim DESC, fm.nr_ctapes
    `;

    const { rows } = await pool.query(query, [
      nr_ctapes,
      dt_movim_ini,
      dt_movim_fim,
    ]);

    successResponse(
      res,
      {
        filtros: { nr_ctapes, dt_movim_ini, dt_movim_fim },
        count: rows.length,
        data: rows,
      },
      "Dados de auditoria de crédito e débito obtidos com sucesso"
    );
  })
);

/**
 * @route GET /financial/obsfati
 * @desc Buscar observações das faturas
 * @access Public
 * @query {cd_cliente, nr_fat}
 */
router.get(
  "/obsfati",
  sanitizeInputMiddleware,
  asyncHandler(async (req, res) => {
    const { cd_cliente, nr_fat } = req.query;

    // Validar parâmetros obrigatórios
    if (!cd_cliente) {
      return errorResponse(
        res,
        "O parâmetro cd_cliente é obrigatório",
        400,
        "MISSING_PARAMETER"
      );
    }

    if (!nr_fat) {
      return errorResponse(
        res,
        "O parâmetro nr_fat é obrigatório",
        400,
        "MISSING_PARAMETER"
      );
    }

    const query = `
      SELECT
        t.nr_fat,
        t.ds_observacao
      FROM
        obs_fati t
      WHERE
        t.cd_cliente = $1
        AND t.nr_fat = $2
      GROUP BY
        t.nr_fat,
        t.ds_observacao
    `;

    const { rows } = await pool.query(query, [cd_cliente, nr_fat]);

    successResponse(
      res,
      {
        cd_cliente,
        nr_fat,
        count: rows.length,
        data: rows,
      },
      "Observações das faturas obtidas com sucesso"
    );
  })
);

export default router;
