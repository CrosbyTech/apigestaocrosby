import express from 'express';
import axios from 'axios';
import https from 'https';
import { PDFDocument } from 'pdf-lib';
import {
  client,
  MessageMedia,
  getQRCode,
  isReady,
  getStatus,
} from '../config/whatsapp.js';
import supabase from '../config/supabase.js';
import { logger } from '../utils/errorHandler.js';
import { getToken } from '../utils/totvsTokenManager.js';

const router = express.Router();

// ==========================================
// TOTVS config (reutilizado do totvs.routes)
// ==========================================
const TOTVS_BASE_URL =
  process.env.TOTVS_BASE_URL || 'https://www30.bhan.com.br:9443/api/totvsmoda';

const httpsAgentNF = new https.Agent({
  keepAlive: true,
  maxSockets: 10,
  rejectUnauthorized: false,
});

// ==========================================
// Registro de solicitações de NF pendentes
// Map<chatId, { personCode, branchCodeList, issueDates, razaoSocial, valor, telefone, nomeCliente, status }>
// status: 'pending' | 'processing' | 'done'
// ==========================================
const pendingNFRequests = new Map();

// ==========================================
// Listener de mensagens recebidas — dispara envio de NFs
// ==========================================
client.on('message', async (msg) => {
  try {
    const body = (msg.body || '').trim();
    if (body !== '1') return;

    const chatId = msg.from;
    const pending = pendingNFRequests.get(chatId);
    if (!pending || pending.status !== 'pending') return;

    // Marcar como processing para não aceitar cliques duplicados
    pending.status = 'processing';
    pendingNFRequests.set(chatId, pending);

    logger.info(`📬 Cliente ${chatId} solicitou NFs (respondeu "1")`);

    // Enviar mensagem de carregamento
    await client.sendMessage(
      chatId,
      '⏳ *Carregando suas notas fiscais...*\n\nEsse processo pode levar alguns instantes. Você receberá os documentos assim que estiverem prontos.',
    );

    // 1) Buscar NFs únicas na TOTVS
    const nfList = await buscarNFsUnicas(pending);

    if (nfList.length === 0) {
      await client.sendMessage(
        chatId,
        '📭 Não foram encontradas notas fiscais eletrônicas para os títulos em aberto. Entre em contato para mais informações.',
      );
      pending.status = 'done';
      return;
    }

    logger.info(`🔍 ${nfList.length} NFs únicas encontradas para ${chatId}`);

    // 2) Processar e salvar cada DANFE no Supabase, uma por uma
    const savedFiles = [];
    for (let i = 0; i < nfList.length; i++) {
      const nf = nfList[i];
      try {
        const danfeBase64 = await gerarDanfeIndividual(nf);
        if (!danfeBase64) {
          logger.warn(`⚠️ DANFE não gerada para NF ${nf.invoiceCode || i + 1}`);
          continue;
        }

        const nfFileName = `nf_${pending.nomeCliente}_${nf.invoiceCode || i + 1}.pdf`;
        const storagePath = `notificacoes/${nfFileName}`;
        const pdfBuffer = Buffer.from(danfeBase64, 'base64');

        const { error: uploadErr } = await supabase.storage
          .from('clientes-confianca')
          .upload(storagePath, pdfBuffer, {
            contentType: 'application/pdf',
            upsert: true,
          });

        if (uploadErr) {
          logger.warn(`⚠️ Erro upload NF ${nfFileName}: ${uploadErr.message}`);
          continue;
        }

        savedFiles.push({
          fileName: nfFileName,
          storagePath,
          invoiceCode: nf.invoiceCode,
        });
        logger.info(`💾 NF ${i + 1}/${nfList.length} salva: ${nfFileName}`);
      } catch (nfErr) {
        logger.warn(`⚠️ Erro processando NF ${i + 1}: ${nfErr.message}`);
      }
    }

    if (savedFiles.length === 0) {
      await client.sendMessage(
        chatId,
        '📭 Não foi possível gerar as notas fiscais. Entre em contato para mais informações.',
      );
      pending.status = 'done';
      return;
    }

    // 3) Baixar todas as NFs do Supabase e mesclar em um único PDF
    const mergedPdf = await PDFDocument.create();
    let mergedCount = 0;

    for (const file of savedFiles) {
      try {
        const { data: fileData, error: dlErr } = await supabase.storage
          .from('clientes-confianca')
          .download(file.storagePath);

        if (dlErr || !fileData) {
          logger.warn(`⚠️ Erro ao baixar ${file.fileName}: ${dlErr?.message}`);
          continue;
        }

        const buffer = Buffer.from(await fileData.arrayBuffer());
        const srcDoc = await PDFDocument.load(buffer);
        const pages = await mergedPdf.copyPages(
          srcDoc,
          srcDoc.getPageIndices(),
        );
        pages.forEach((page) => mergedPdf.addPage(page));
        mergedCount++;
        logger.info(
          `📎 NF ${file.invoiceCode || mergedCount} adicionada ao PDF consolidado`,
        );
      } catch (mergeErr) {
        logger.warn(
          `⚠️ Erro ao mesclar NF ${file.fileName}: ${mergeErr.message}`,
        );
      }
    }

    if (mergedCount === 0) {
      await client.sendMessage(
        chatId,
        '📭 Não foi possível gerar o arquivo consolidado das notas fiscais. Entre em contato para mais informações.',
      );
      pending.status = 'done';
      return;
    }

    // Salvar PDF consolidado no Supabase
    const mergedBytes = await mergedPdf.save();
    const mergedFileName = `nfs_consolidado_${pending.nomeCliente}.pdf`;
    const mergedPath = `notificacoes/${mergedFileName}`;

    const { error: mergedUploadErr } = await supabase.storage
      .from('clientes-confianca')
      .upload(mergedPath, Buffer.from(mergedBytes), {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (mergedUploadErr) {
      logger.error(
        `❌ Erro ao salvar PDF consolidado: ${mergedUploadErr.message}`,
      );
      await client.sendMessage(
        chatId,
        '❌ Erro ao preparar o arquivo consolidado. Tente novamente respondendo *1*.',
      );
      pending.status = 'pending';
      return;
    }

    logger.info(
      `💾 PDF consolidado salvo: ${mergedFileName} (${mergedCount} NFs, ${mergedBytes.length} bytes)`,
    );

    // 4) Baixar o consolidado e enviar via WhatsApp
    const { data: consolidadoData, error: consolidadoDlErr } =
      await supabase.storage.from('clientes-confianca').download(mergedPath);

    if (consolidadoDlErr || !consolidadoData) {
      logger.error(
        `❌ Erro ao baixar PDF consolidado: ${consolidadoDlErr?.message}`,
      );
      pending.status = 'pending';
      return;
    }

    const consolidadoBuffer = Buffer.from(await consolidadoData.arrayBuffer());
    const consolidadoBase64 = consolidadoBuffer.toString('base64');
    const media = new MessageMedia(
      'application/pdf',
      consolidadoBase64,
      mergedFileName,
    );

    const caption =
      `📄 *NOTAS FISCAIS (DANFEs)*\n\n` +
      `Seguem as Notas Fiscais referentes aos títulos em aberto de *${pending.razaoSocial}*.\n` +
      `Total: *${mergedCount} nota(s) fiscal(is)* em um único arquivo.\n` +
      `Valor em aberto: *${pending.valor}*`;

    await client.sendMessage(chatId, media, { caption });

    logger.info(
      `✅ PDF consolidado com ${mergedCount} NFs enviado para ${chatId}`,
    );
    pending.status = 'done';
  } catch (err) {
    logger.error(`Erro no listener de NF: ${err.message}`);
    try {
      const chatId = msg.from;
      const pending = pendingNFRequests.get(chatId);
      if (pending) {
        await client.sendMessage(
          chatId,
          '❌ Houve um erro ao processar suas notas fiscais. Tente novamente respondendo *1*.',
        );
        pending.status = 'pending';
      }
    } catch (_) {
      /* silenciar */
    }
  }
});

// ==========================================
// Função: buscar NFs únicas de um cliente na TOTVS
// ==========================================
async function buscarNFsUnicas(data) {
  const { personCode, branchCodeList, issueDates } = data;

  const tokenData = await getToken();
  if (!tokenData?.access_token) throw new Error('Token TOTVS indisponível');
  let token = tokenData.access_token;

  const dates = issueDates.map((d) => new Date(d)).filter((d) => !isNaN(d));
  if (dates.length === 0) return [];

  const branches = (branchCodeList || []).filter((c) => c >= 1 && c <= 99);
  const invoicesEndpoint = `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`;

  // Para cada data de emissão, criar range de ±3 dias
  const ranges = dates.map((d) => {
    const start = new Date(d);
    start.setDate(start.getDate() - 3);
    const end = new Date(d);
    end.setDate(end.getDate() + 3);
    return { start, end };
  });

  // Ordenar e mesclar ranges sobrepostos
  ranges.sort((a, b) => a.start - b.start);
  const mergedRanges = [
    { start: new Date(ranges[0].start), end: new Date(ranges[0].end) },
  ];
  for (let i = 1; i < ranges.length; i++) {
    const last = mergedRanges[mergedRanges.length - 1];
    if (ranges[i].start <= last.end) {
      if (ranges[i].end > last.end) last.end = new Date(ranges[i].end);
    } else {
      mergedRanges.push({
        start: new Date(ranges[i].start),
        end: new Date(ranges[i].end),
      });
    }
  }

  logger.info(
    `📅 ${issueDates.length} datas de emissão → ${mergedRanges.length} range(s) de busca (±3 dias cada)`,
  );

  const allItems = [];
  for (const range of mergedRanges) {
    const body = {
      filter: {
        branchCodeList: branches,
        personCodeList: [parseInt(personCode)],
        eletronicInvoiceStatusList: ['Authorized'],
        startIssueDate: `${range.start.toISOString().slice(0, 10)}T00:00:00`,
        endIssueDate: `${range.end.toISOString().slice(0, 10)}T23:59:59`,
        change: {},
      },
      page: 1,
      pageSize: 100,
      expand: 'person',
    };

    logger.info(
      `🔎 Buscando NFs de ${body.filter.startIssueDate.slice(0, 10)} a ${body.filter.endIssueDate.slice(0, 10)}`,
    );

    const doReq = async (t) =>
      axios.post(invoicesEndpoint, body, {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${t}`,
        },
        timeout: 30000,
        httpsAgent: httpsAgentNF,
      });

    let resp;
    try {
      resp = await doReq(token);
    } catch (err) {
      if (err.response?.status === 401) {
        token = (await getToken(true))?.access_token;
        resp = await doReq(token);
      } else throw err;
    }
    allItems.push(...(resp?.data?.items || []));
  }

  // Deduplicar por accessKey
  const uniqueNFs = [];
  const seenKeys = new Set();
  for (const nf of allItems) {
    const key = nf?.eletronic?.accessKey;
    if (key && !seenKeys.has(key)) {
      seenKeys.add(key);
      uniqueNFs.push(nf);
    }
  }

  return uniqueNFs;
}

// ==========================================
// Função: gerar DANFE individual (retorna base64 ou null)
// ==========================================
async function gerarDanfeIndividual(nf) {
  const tokenData = await getToken();
  if (!tokenData?.access_token) throw new Error('Token TOTVS indisponível');
  let token = tokenData.access_token;

  const accessKey = nf?.eletronic?.accessKey;
  if (!accessKey) return null;

  // 1) xml-contents
  const xmlEndpoint = `${TOTVS_BASE_URL}/fiscal/v2/xml-contents/${encodeURIComponent(accessKey)}`;
  const doXml = async (t) =>
    axios.get(xmlEndpoint, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${t}` },
      timeout: 30000,
      httpsAgent: httpsAgentNF,
    });

  let xmlResp;
  try {
    xmlResp = await doXml(token);
  } catch (err) {
    if (err.response?.status === 401) {
      token = (await getToken(true))?.access_token;
      xmlResp = await doXml(token);
    } else throw err;
  }

  const mainInvoiceXml =
    xmlResp?.data?.mainInvoiceXml || xmlResp?.data?.data?.mainInvoiceXml;
  if (!mainInvoiceXml) return null;

  // 2) danfe-search
  const danfeEndpoint = `${TOTVS_BASE_URL}/fiscal/v2/danfe-search`;
  const doDanfe = async (t) =>
    axios.post(
      danfeEndpoint,
      { mainInvoiceXml, nfeDocumentType: 'NFeNormal' },
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${t}`,
        },
        timeout: 30000,
        httpsAgent: httpsAgentNF,
      },
    );

  let danfeResp;
  try {
    danfeResp = await doDanfe(token);
  } catch (err) {
    if (err.response?.status === 401) {
      token = (await getToken(true))?.access_token;
      danfeResp = await doDanfe(token);
    } else throw err;
  }

  return danfeResp?.data?.danfePdfBase64 || null;
}

// GET /api/whatsapp/status — status do client
router.get('/status', (req, res) => {
  res.json({
    status: getStatus(),
    ready: isReady(),
  });
});

// GET /api/whatsapp/qr — QR code como imagem base64
router.get('/qr', (req, res) => {
  const qr = getQRCode();
  if (!qr) {
    const status = getStatus();
    if (status === 'ready') {
      return res.json({ message: 'WhatsApp já está conectado', status });
    }
    return res
      .status(404)
      .json({ message: 'QR Code não disponível ainda', status });
  }
  // Retorna HTML com a imagem do QR para fácil escaneamento
  if (req.query.format === 'json') {
    return res.json({ qr });
  }
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>WhatsApp QR - Crosby</title>
    <meta http-equiv="refresh" content="10">
    <style>body{display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#1a1a2e;font-family:sans-serif;color:white;flex-direction:column}
    img{border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.3)}
    h2{margin-bottom:20px}p{color:#aaa;margin-top:16px;font-size:14px}</style>
    </head>
    <body>
      <h2>Escaneie o QR Code com o WhatsApp</h2>
      <img src="${qr}" alt="QR Code" width="300" />
      <p>Esta página atualiza automaticamente a cada 10 segundos</p>
    </body>
    </html>
  `);
});

// POST /api/whatsapp/send-document — enviar DOCX como anexo
router.post('/send-document', async (req, res) => {
  try {
    const { telefone, nomeArquivo, mensagem } = req.body;

    if (!telefone || !nomeArquivo) {
      return res
        .status(400)
        .json({ error: 'telefone e nomeArquivo são obrigatórios' });
    }

    if (!isReady()) {
      return res.status(503).json({
        error: 'WhatsApp não está conectado',
        status: getStatus(),
        fallback: true,
      });
    }

    // Validar nome do arquivo
    if (!/^[a-zA-Z0-9_\-\.]+$/.test(nomeArquivo)) {
      return res.status(400).json({ error: 'Nome de arquivo inválido' });
    }

    // Buscar arquivo do Supabase Storage
    const storagePath = `notificacoes/${nomeArquivo}`;
    logger.info(`📥 Buscando arquivo: ${storagePath}`);
    const { data, error } = await supabase.storage
      .from('clientes-confianca')
      .download(storagePath);

    if (error || !data) {
      logger.error(
        `Erro ao baixar arquivo do Supabase: ${error?.message || 'sem data'}`,
      );
      return res
        .status(404)
        .json({ error: 'Arquivo não encontrado no storage', fallback: true });
    }

    // Converter para base64 para MessageMedia
    const buffer = Buffer.from(await data.arrayBuffer());
    const base64 = buffer.toString('base64');

    // Detectar MIME type pelo nome do arquivo
    const mimeTypes = {
      '.pdf': 'application/pdf',
      '.docx':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.doc': 'application/msword',
    };
    const ext = (nomeArquivo.match(/\.[^.]+$/) || ['.pdf'])[0].toLowerCase();
    const mimeType = mimeTypes[ext] || 'application/octet-stream';

    const media = new MessageMedia(mimeType, base64, nomeArquivo);

    // Formatar telefone: 55 + DDD + número (sem caracteres especiais)
    let telefoneLimpo = telefone.replace(/\D/g, '');
    // Se já começa com 55 e tem 12-13 dígitos (55 + DDD + número), não duplicar
    if (telefoneLimpo.startsWith('55') && telefoneLimpo.length >= 12) {
      // Já tem código do país
    } else {
      telefoneLimpo = `55${telefoneLimpo}`;
    }

    // Usar getNumberId para resolver o WID correto (evita erro "No LID for user")
    const numberId = await client.getNumberId(telefoneLimpo);
    if (!numberId) {
      logger.warn(`⚠️ Número ${telefoneLimpo} não registrado no WhatsApp`);
      return res.status(400).json({
        error: `Número ${telefoneLimpo} não possui WhatsApp`,
        fallback: true,
      });
    }
    const chatId = numberId._serialized;

    logger.info(`📞 Enviando para chatId: ${chatId}, arquivo: ${nomeArquivo}`);

    // Enviar documento com caption
    await client.sendMessage(chatId, media, {
      caption: mensagem || '',
    });

    logger.info(
      `📤 Documento enviado via WhatsApp para ${chatId}: ${nomeArquivo}`,
    );

    res.json({
      success: true,
      message: 'Documento enviado com sucesso via WhatsApp',
      destinatario: chatId,
    });
  } catch (error) {
    const errMsg = error?.message || error?.toString() || JSON.stringify(error);
    logger.error(`Erro ao enviar documento WhatsApp: ${errMsg}`);
    if (error?.stack) logger.error(error.stack);
    res.status(500).json({
      error: 'Erro ao enviar documento',
      details: errMsg,
      fallback: true,
    });
  }
});

// POST /api/whatsapp/register-nf-request — registra solicitação de NF pendente
router.post('/register-nf-request', async (req, res) => {
  try {
    const {
      telefone,
      personCode,
      branchCodeList,
      issueDates,
      razaoSocial,
      valor,
      nomeCliente,
    } = req.body;

    if (
      !telefone ||
      !personCode ||
      !Array.isArray(issueDates) ||
      issueDates.length === 0
    ) {
      return res.status(400).json({ error: 'Dados incompletos' });
    }

    if (!isReady()) {
      return res
        .status(503)
        .json({ error: 'WhatsApp não conectado', fallback: true });
    }

    // Resolver chatId
    let telefoneLimpo = telefone.replace(/\D/g, '');
    if (!telefoneLimpo.startsWith('55') || telefoneLimpo.length < 12) {
      telefoneLimpo = `55${telefoneLimpo}`;
    }

    const numberId = await client.getNumberId(telefoneLimpo);
    if (!numberId) {
      return res
        .status(400)
        .json({ error: `Número ${telefoneLimpo} não possui WhatsApp` });
    }
    const chatId = numberId._serialized;

    // Registrar solicitação pendente
    pendingNFRequests.set(chatId, {
      personCode,
      branchCodeList,
      issueDates,
      razaoSocial,
      valor,
      nomeCliente,
      telefone: telefoneLimpo,
      status: 'pending',
      createdAt: Date.now(),
    });

    logger.info(
      `📋 NF request registrado para ${chatId} (personCode=${personCode}, ${issueDates.length} datas)`,
    );

    // Enviar mensagem convidando o cliente a solicitar NFs
    const msgConvite =
      `📄 *NOTAS FISCAIS DISPONÍVEIS*\n\n` +
      `Se desejar receber as Notas Fiscais (DANFEs) referentes aos títulos mencionados na Notificação Extrajudicial, ` +
      `responda esta mensagem com o número *1*.\n\n` +
      `⚠️ _O envio pode levar alguns instantes dependendo da quantidade de notas._`;

    await client.sendMessage(chatId, msgConvite);

    logger.info(`📨 Convite de NF enviado para ${chatId}`);

    res.json({
      success: true,
      message: 'Solicitação registrada e convite enviado',
    });
  } catch (error) {
    logger.error(`Erro ao registrar NF request: ${error.message}`);
    res
      .status(500)
      .json({ error: 'Erro ao registrar solicitação', details: error.message });
  }
});

// Limpeza periódica de requests antigos (>24h)
setInterval(
  () => {
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    for (const [chatId, data] of pendingNFRequests.entries()) {
      if (now - data.createdAt > DAY) {
        pendingNFRequests.delete(chatId);
      }
    }
  },
  60 * 60 * 1000,
); // a cada 1h

export default router;
