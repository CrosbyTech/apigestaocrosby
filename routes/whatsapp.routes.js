import express from 'express';
import axios from 'axios';
import https from 'https';
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
import { PDFDocument } from 'pdf-lib';

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

    // Processar NFs
    const result = await processarNFsCliente(pending);

    if (result.success) {
      // Enviar PDF diretamente via WhatsApp (sem upload ao Supabase)
      const nfNomeArquivo = `notas_fiscais_${pending.nomeCliente}.pdf`;
      const base64 = result.pdfBuffer.toString('base64');
      const media = new MessageMedia('application/pdf', base64, nfNomeArquivo);

      const captionNF =
        `📄 *NOTAS FISCAIS — DEMONSTRATIVO DE DÉBITO*\n\n` +
        `Seguem anexas as Notas Fiscais (DANFEs) referentes aos títulos em aberto de *${pending.razaoSocial}*, ` +
        `totalizando *${result.totalDanfes} nota(s) fiscal(is)*, que comprovam a origem do débito objeto da Notificação Extrajudicial.\n\n` +
        `Valor total em aberto: *${pending.valor}*`;

      await client.sendMessage(chatId, media, { caption: captionNF });

      logger.info(`📤 ${result.totalDanfes} NFs enviadas para ${chatId}`);
      pending.status = 'done';
    } else {
      await client.sendMessage(
        chatId,
        '📭 Não foram encontradas notas fiscais eletrônicas para os títulos em aberto. Entre em contato para mais informações.',
      );
      pending.status = 'done';
    }
  } catch (err) {
    logger.error(`Erro no listener de NF: ${err.message}`);
    // Tentar notificar o cliente
    try {
      const chatId = msg.from;
      const pending = pendingNFRequests.get(chatId);
      if (pending) {
        await client.sendMessage(
          chatId,
          '❌ Houve um erro ao processar suas notas fiscais. Tente novamente respondendo *1*.',
        );
        pending.status = 'pending'; // permite retry
      }
    } catch (_) {
      /* silenciar */
    }
  }
});

// ==========================================
// Função: processar NFs de um cliente via TOTVS
// ==========================================
async function processarNFsCliente(data) {
  const { personCode, branchCodeList, issueDates } = data;

  const tokenData = await getToken();
  if (!tokenData?.access_token) throw new Error('Token TOTVS indisponível');
  let token = tokenData.access_token;

  // Calcular range de datas
  const dates = issueDates.map((d) => new Date(d)).filter((d) => !isNaN(d));
  if (dates.length === 0) return { success: false };

  const minDate = new Date(Math.min(...dates));
  const maxDate = new Date(Math.max(...dates));
  minDate.setDate(minDate.getDate() - 3);
  maxDate.setDate(maxDate.getDate() + 3);

  const branches = (branchCodeList || []).filter((c) => c >= 1 && c <= 99);

  // invoices-search em chunks de 5 meses
  const invoicesEndpoint = `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`;
  const MAX_MONTHS = 5;
  const dateChunks = [];
  let chunkStart = new Date(minDate);
  while (chunkStart < maxDate) {
    const chunkEnd = new Date(chunkStart);
    chunkEnd.setMonth(chunkEnd.getMonth() + MAX_MONTHS);
    if (chunkEnd > maxDate) chunkEnd.setTime(maxDate.getTime());
    dateChunks.push({
      start: `${chunkStart.toISOString().slice(0, 10)}T00:00:00`,
      end: `${chunkEnd.toISOString().slice(0, 10)}T23:59:59`,
    });
    chunkStart = new Date(chunkEnd);
    chunkStart.setDate(chunkStart.getDate() + 1);
  }

  const allItems = [];
  for (const chunk of dateChunks) {
    const body = {
      filter: {
        branchCodeList: branches,
        personCodeList: [parseInt(personCode)],
        eletronicInvoiceStatusList: ['Authorized'],
        startIssueDate: chunk.start,
        endIssueDate: chunk.end,
        change: {},
      },
      page: 1,
      pageSize: 100,
      expand: 'person',
    };

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

  if (allItems.length === 0) return { success: false };

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

  // Gerar DANFEs (xml-contents → danfe-search)
  const CONCURRENCY = 3;
  const danfeBuffers = [];

  const processNF = async (nf) => {
    const accessKey = nf.eletronic.accessKey;

    // xml-contents
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

    // danfe-search
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

    const base64 = danfeResp?.data?.danfePdfBase64;
    if (!base64) return null;
    return Buffer.from(base64, 'base64');
  };

  for (let i = 0; i < uniqueNFs.length; i += CONCURRENCY) {
    const batch = uniqueNFs.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map(processNF));
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) danfeBuffers.push(r.value);
    }
  }

  if (danfeBuffers.length === 0) return { success: false };

  // Mesclar todos os PDFs com pdf-lib
  const mergedPdf = await PDFDocument.create();
  for (const buf of danfeBuffers) {
    const srcDoc = await PDFDocument.load(buf);
    const pages = await mergedPdf.copyPages(srcDoc, srcDoc.getPageIndices());
    pages.forEach((page) => mergedPdf.addPage(page));
  }
  const mergedBytes = await mergedPdf.save();

  return {
    success: true,
    pdfBuffer: Buffer.from(mergedBytes),
    totalDanfes: danfeBuffers.length,
  };
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
