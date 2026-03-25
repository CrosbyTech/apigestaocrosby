import express from 'express';
import {
  client,
  MessageMedia,
  getQRCode,
  isReady,
  getStatus,
} from '../config/whatsapp.js';
import supabase from '../config/supabase.js';
import { logger } from '../utils/errorHandler.js';

const router = express.Router();

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

export default router;
