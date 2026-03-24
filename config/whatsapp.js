import pkg from 'whatsapp-web.js';
const { Client, RemoteAuth, MessageMedia } = pkg;
import puppeteer from 'puppeteer';
import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';
import fs from 'fs';
import SupabaseSessionStore from '../utils/supabaseSessionStore.js';
import { logger } from '../utils/errorHandler.js';

const store = new SupabaseSessionStore();

let qrCodeData = null;
let clientReady = false;
let clientStatus = 'initializing'; // initializing | qr_needed | ready | disconnected | auth_failure

// Detectar Chrome no sistema
const getChromePath = () => {
  // 1. Variável de ambiente (set por start.sh no Render)
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
    if (fs.existsSync(envPath)) return envPath;
  }

  // 2. Usar o caminho resolvido pelo próprio puppeteer (mais confiável)
  try {
    const resolved = puppeteer.executablePath();
    if (resolved && fs.existsSync(resolved)) {
      logger.info(`Chrome via puppeteer.executablePath(): ${resolved}`);
      return resolved;
    }
  } catch (err) {
    logger.warn(`puppeteer.executablePath() falhou: ${err.message}`);
  }

  // 3. Fallback: caminhos manuais do sistema
  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ];

  for (const p of paths) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      continue;
    }
  }
  return undefined;
};

const chromePath = getChromePath();

const puppeteerOptions = {
  headless: true,
  ...(chromePath && { executablePath: chromePath }),
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--disable-gpu',
    '--single-process',
  ],
};

const client = new Client({
  authStrategy: new RemoteAuth({
    store,
    backupSyncIntervalMs: 300000, // Backup a cada 5 minutos
    clientId: 'crosby-notificacao',
  }),
  puppeteer: puppeteerOptions,
});

// === Eventos ===

client.on('qr', async (qr) => {
  clientStatus = 'qr_needed';
  clientReady = false;

  // Exibe no terminal
  qrcodeTerminal.generate(qr, { small: true });
  logger.info('📱 QR Code gerado — escaneie com o WhatsApp');

  // Salva como base64 para endpoint HTTP
  try {
    qrCodeData = await QRCode.toDataURL(qr);
  } catch (err) {
    logger.error('Erro ao gerar QR base64:', err.message);
  }
});

client.on('ready', () => {
  clientReady = true;
  clientStatus = 'ready';
  qrCodeData = null;
  logger.info('✅ WhatsApp client pronto e conectado!');
});

client.on('authenticated', () => {
  logger.info('🔐 WhatsApp autenticado com sucesso');
});

client.on('auth_failure', (msg) => {
  clientReady = false;
  clientStatus = 'auth_failure';
  logger.error('❌ Falha na autenticação WhatsApp:', msg);
});

client.on('disconnected', (reason) => {
  clientReady = false;
  clientStatus = 'disconnected';
  logger.warn('⚠️ WhatsApp desconectado:', reason);

  // Tentar reconectar após 10 segundos
  setTimeout(() => {
    logger.info('🔄 Tentando reconectar WhatsApp...');
    client.initialize().catch((err) => {
      logger.error('Erro ao reconectar WhatsApp:', err.message);
    });
  }, 10000);
});

client.on('remote_session_saved', () => {
  logger.info('💾 Sessão WhatsApp salva remotamente (Supabase)');
});

// === Exports ===

const getQRCode = () => qrCodeData;
const isReady = () => clientReady;
const getStatus = () => clientStatus;

const initializeWhatsApp = async () => {
  try {
    logger.info('🚀 Inicializando WhatsApp client...');
    const execPath = getChromePath();
    logger.info(`Chromium path: ${execPath || 'bundled puppeteer'}`);
    await client.initialize();
  } catch (err) {
    logger.error(`Erro ao inicializar WhatsApp: ${err.message || err}`);
    logger.error(err.stack || 'sem stack trace');
    clientStatus = 'disconnected';
  }
};

export {
  client,
  MessageMedia,
  getQRCode,
  isReady,
  getStatus,
  initializeWhatsApp,
};
