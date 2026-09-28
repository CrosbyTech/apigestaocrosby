// ============================================================
// EXTRATO STONE — PDF/OFX do app da Stone → leitura + CNAB 240 para o TOTVS
//
// A Stone não expõe extrato bancário por API para clientes; o app exporta
// PDF ("Comprovante de Extrato") e OFX. Esta rota lê qualquer um dos dois,
// classifica cada lançamento (cartão, PIX, boleto, tarifa, pagamento…) e
// gera o CNAB 240 FEBRABAN de extrato para conciliação, que é o formato que
// o TOTVS importa (mesmo layout do arquivo do Sicredi).
//
//   PDF → utils/extratoStonePdf.js  (traz o TITULAR: nome, CNPJ, agência, conta)
//   OFX → utils/ofxParaCnab240.js   (não traz o titular; empresa é escolhida na tela)
//
// Endpoints (prefixo /api/extrato-stone):
//   GET  /empresas                → empresas do TOTVS (código, nome, CNPJ)
//   POST /ler       (multipart: arquivo)                  → extrato parseado + classificação
//   POST /converter (multipart: arquivo[, cnpj, empresa]) → extrato + CNAB (texto) + resumo
//   POST /converter?download=1                            → devolve o .txt direto
//   No PDF, cnpj/empresa são opcionais (vêm do próprio arquivo).
// ============================================================
import express from 'express';
import multer from 'multer';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';
import {
  parseOfx,
  gerarCnab240,
  classificarLancamento,
  decodificarOfx,
} from '../utils/ofxParaCnab240.js';
import { parseExtratoPdfStone } from '../utils/extratoStonePdf.js';
import { mapearFiliaisTotvsPorCnpj } from '../services/totvsCartoesStone.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(pdf|ofx|qfx|txt|xml)$/i.test(file.originalname || '');
    cb(ok ? null : new Error('Envie o PDF ("Comprovante de Extrato") ou o OFX exportado do app da Stone.'), ok);
  },
});

const uploadUnico = (campo) => (req, res, next) =>
  upload.single(campo)(req, res, (err) => {
    if (err) return errorResponse(res, err.message, 400, 'UPLOAD');
    if (!req.file) return errorResponse(res, 'Nenhum arquivo enviado (campo "arquivo").', 400);
    next();
  });

const ehPdf = (file) =>
  /\.pdf$/i.test(file.originalname || '') || file.buffer?.slice(0, 5).toString('latin1') === '%PDF-';

// Lê (PDF ou OFX), classifica e devolve estrutura pronta para a tela
async function lerExtrato(file) {
  const extrato = ehPdf(file)
    ? await parseExtratoPdfStone(file.buffer)
    : { origem: 'ofx', ...parseOfx(decodificarOfx(file.buffer)) };

  const lancamentos = extrato.lancamentos.map((l, i) => {
    const c = classificarLancamento(l);
    return {
      seq: i + 1,
      fitid: l.fitid,
      data: l.data,
      hora: l.hora && l.hora !== '000000' ? `${l.hora.slice(0, 2)}:${l.hora.slice(2, 4)}:${l.hora.slice(4, 6)}` : null,
      valor: l.valor,
      natureza: l.natureza,
      memo: l.memo,
      saldoApos: l.saldoApos ?? null,
      bancoContraparte: l.bancoContraparte ?? null,
      grupo: c.grupo,
      categoria: c.categoria,
      historico: c.historico,
      descricao: c.descricao,
      documento: c.documento,
      contraparte: c.contraparte,
      bandeira: c.bandeira || null,
      tipoCartao: c.tipoCartao || null,
    };
  });

  // agregados por grupo e por dia (para a tela)
  const porGrupo = {};
  const porDia = {};
  for (const l of lancamentos) {
    const g = (porGrupo[l.grupo] ??= { grupo: l.grupo, qtd: 0, creditos: 0, debitos: 0 });
    const d = (porDia[l.data] ??= { data: l.data, qtd: 0, creditos: 0, debitos: 0 });
    g.qtd += 1;
    d.qtd += 1;
    if (l.valor >= 0) {
      g.creditos = +(g.creditos + l.valor).toFixed(2);
      d.creditos = +(d.creditos + l.valor).toFixed(2);
    } else {
      g.debitos = +(g.debitos - l.valor).toFixed(2);
      d.debitos = +(d.debitos - l.valor).toFixed(2);
    }
  }
  let saldo = extrato.saldo.inicial ?? 0;
  const dias = Object.values(porDia)
    .sort((a, b) => (a.data < b.data ? -1 : 1))
    .map((d) => {
      saldo = +(saldo + d.creditos - d.debitos).toFixed(2);
      return { ...d, saldo };
    });

  return {
    origem: extrato.origem,
    banco: extrato.banco,
    conta: extrato.conta,
    moeda: extrato.moeda,
    periodo: extrato.periodo,
    saldo: extrato.saldo,
    titular: extrato.titular || null,
    conferencia: extrato.conferencia || null,
    avisos: extrato.avisos || [],
    paginas: extrato.paginas || null,
    qtd: lancamentos.length,
    porGrupo: Object.values(porGrupo).sort((a, b) => b.qtd - a.qtd),
    dias,
    lancamentos,
    _extratoBruto: extrato,
  };
}

// ──────────────────────────────────────────────────────────────
router.get(
  '/empresas',
  asyncHandler(async (req, res) => {
    try {
      const mapa = await mapearFiliaisTotvsPorCnpj();
      const empresas = [];
      for (const [cnpj, lista] of mapa) {
        for (const f of lista) empresas.push({ cnpj, codigo: f.code, nome: f.nome });
      }
      empresas.sort((a, b) => a.codigo - b.codigo);
      return successResponse(res, empresas);
    } catch (e) {
      return errorResponse(res, `TOTVS indisponível: ${e.message}`, 503, 'TOTVS');
    }
  }),
);

router.post(
  '/ler',
  uploadUnico('arquivo'),
  asyncHandler(async (req, res) => {
    try {
      const { _extratoBruto, ...extrato } = await lerExtrato(req.file);
      return successResponse(res, { arquivo: req.file.originalname, ...extrato });
    } catch (e) {
      return errorResponse(res, e.message, 422, 'ARQUIVO_INVALIDO');
    }
  }),
);

router.post(
  '/converter',
  uploadUnico('arquivo'),
  asyncHandler(async (req, res) => {
    const { cnpj, empresa, nomeBanco, sequencia } = req.body || {};
    let lido;
    try {
      lido = await lerExtrato(req.file);
    } catch (e) {
      return errorResponse(res, e.message, 422, 'ARQUIVO_INVALIDO');
    }
    // PDF traz o titular; a tela pode sobrescrever (ex.: nome como está no TOTVS)
    const cnpjFinal = cnpj || lido.titular?.cnpj;
    const empresaFinal = empresa || lido.titular?.nome;
    let cnab;
    try {
      cnab = gerarCnab240(lido._extratoBruto, {
        cnpj: cnpjFinal,
        empresa: empresaFinal,
        nomeBanco: nomeBanco || undefined,
        sequencia: sequencia ? Number(sequencia) : undefined,
      });
    } catch (e) {
      return errorResponse(res, e.message, 400, 'CNAB');
    }

    const nomeArquivo = `EXTRATO_STONE_${cnab.resumo.conta.replace(/\D/g, '')}_${lido.periodo.inicio.replace(/-/g, '')}_${lido.periodo.fim.replace(/-/g, '')}.txt`;

    if (req.query.download === '1') {
      res.setHeader('Content-Type', 'text/plain; charset=latin1');
      res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
      return res.send(Buffer.from(cnab.conteudo, 'latin1'));
    }

    const { _extratoBruto, ...extrato } = lido;
    return successResponse(res, {
      arquivo: req.file.originalname,
      ...extrato,
      cnab: { nomeArquivo, conteudo: cnab.conteudo, resumo: cnab.resumo, linhas: cnab.linhas.length },
    });
  }),
);

export default router;
