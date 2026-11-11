// ---------------------------------------------------------------------------
// PDV Crosby — processo principal (Electron / Node)
//
// O app NÃO reimplementa o PDV: ele carrega o HeadCoach real (o build do Vite
// em ./web, gerado por `npm run build:web`) servido por um servidor HTTP
// interno em 127.0.0.1. Assim a tela é exatamente a do site, e o Electron só
// acrescenta o que o navegador não dá:
//  - porta serial do leitor RFID escolhida aqui (Web Serial precisa de um
//    seletor no processo principal — sem isso o requestPort() falha)
//  - popup de impressão (cupom NFC-e / DANFE) liberado como janela filha
//  - impressoras locais e config da máquina via IPC (window.pdv, preload.js)
//  - salvar documento (DANFE) em PDF direto na pasta escolhida
//
// Sem ./web (ninguém rodou o build) ele cai no protótipo em ./renderer.
// Em desenvolvimento, HEADCOACH_URL=http://localhost:3000 carrega o Vite dev.
// ---------------------------------------------------------------------------

const { app, BrowserWindow, ipcMain, shell, session, dialog } = require('electron');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const { pathToFileURL } = require('node:url');
const updater = require('./updater');

const WEB_DIR = path.join(__dirname, 'web');
const PROTO_INDEX = path.join(__dirname, 'renderer', 'index.html');
// Porta fixa: a origem (http://127.0.0.1:PORTA) é a chave do localStorage onde
// o Supabase guarda a sessão — se a porta mudasse, o caixa teria que logar de novo.
const PORTA_BASE = 47321;
// Home do HeadCoach: dentro do app ela mostra os atalhos do PDV (ver Home.jsx)
const ROTA_INICIAL = '/home';
// VID da Silicon Labs (CP2102N, o chip USB-serial do leitor .bat R9816)
const VID_CP210X = '10c4';

const CONFIG_PATH = path.join(app.getPath('userData'), 'pdv-config.json');
// Portal RFID (Chainway UR4) da matriz. Cada caixa troca em "Configurações dos
// Aparelhos". 192.168.99.202 é o IP de FÁBRICA do UR4 (versões antigas do app
// gravavam esse padrão) — tratado como "não configurado".
const PORTAL_IP_PADRAO = '192.168.0.202';
const PORTAL_IP_FABRICA = '192.168.99.202';

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {
      impressora: '',
      rfid: { host: PORTAL_IP_PADRAO, porta: 8888, modelo: 'Chainway UR4', portaSerial: '' },
      tef: { provedor: 'Stone', serie: '', conectado: false },
    };
  }
}

function saveConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

// ----------------------------- servidor do build ---------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function servirBuild(porta) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let pathname;
      try {
        pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      } catch {
        pathname = '/';
      }
      // nunca sai de WEB_DIR (path.normalize resolve os "..")
      const rel = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
      let arquivo = path.join(WEB_DIR, rel);
      if (!arquivo.startsWith(WEB_DIR)) arquivo = path.join(WEB_DIR, 'index.html');

      let stat = null;
      try {
        stat = fs.statSync(arquivo);
      } catch {
        /* não existe */
      }
      // SPA: rota do React Router (sem arquivo) -> index.html
      if (!stat || stat.isDirectory()) arquivo = path.join(WEB_DIR, 'index.html');

      const ext = path.extname(arquivo).toLowerCase();
      res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
      // assets do Vite têm hash no nome: cache longo; index.html nunca
      res.setHeader(
        'Cache-Control',
        ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
      );
      fs.createReadStream(arquivo)
        .on('error', () => {
          res.statusCode = 500;
          res.end();
        })
        .pipe(res);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE' && porta < PORTA_BASE + 10) {
        // porta ocupada por outro programa: tenta a seguinte (a sessão salva
        // fica na origem antiga — caso raro, o caixa loga de novo)
        resolve(servirBuild(porta + 1));
      } else reject(err);
    });
    server.listen(porta, '127.0.0.1', () => resolve(`http://127.0.0.1:${porta}`));
  });
}

// ----------------------------- janela --------------------------------------
let mainWindow;
let origemApp = null; // ex.: http://127.0.0.1:47321

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#000638',
    show: false,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    title: 'PDV Crosby — HeadCoach',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  // o React Router e o próprio HeadCoach mudam o document.title; mantém o nosso
  mainWindow.on('page-title-updated', (e) => e.preventDefault());

  // window.open: o PDV abre um popup vazio ('') e depois escreve o cupom ou
  // navega para o blob: do DANFE — isso tem que virar uma janela filha.
  // Links http(s) externos (WhatsApp, Autentique, etc.) vão para o navegador.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (ehExterno(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        autoHideMenuBar: true,
        backgroundColor: '#ffffff',
        parent: mainWindow,
      },
    };
  });
  // navegação da própria janela para fora do app -> navegador do sistema
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (ehExterno(url)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  const devUrl = process.env.HEADCOACH_URL;
  if (devUrl) {
    origemApp = devUrl.replace(/\/$/, '');
    await mainWindow.loadURL(origemApp + ROTA_INICIAL);
  } else if (fs.existsSync(path.join(WEB_DIR, 'index.html'))) {
    origemApp = await servirBuild(PORTA_BASE);
    await mainWindow.loadURL(origemApp + ROTA_INICIAL);
  } else {
    // build do HeadCoach ausente: protótipo estático
    await mainWindow.loadFile(PROTO_INDEX);
  }
}

function ehExterno(url) {
  if (!url || url === 'about:blank' || url.startsWith('blob:') || url.startsWith('data:')) return false;
  if (!/^https?:/i.test(url)) return false;
  return !(origemApp && url.startsWith(origemApp));
}

// ----------------------------- Web Serial (leitor RFID) --------------------
// O hook useRfidReader chama navigator.serial.requestPort() sem filtro. No
// Chrome aparece um seletor; no Electron somos nós que escolhemos a porta:
//  1) a última porta que funcionou (salva na config, ex. "COM10")
//  2) senão, a primeira com chip CP210x (o do leitor)
//  3) senão, a primeira porta serial que existir
function configurarSerial(ses) {
  ses.on('select-serial-port', (event, portList, _webContents, callback) => {
    event.preventDefault();
    const cfg = loadConfig();
    const salva = cfg.rfid?.portaSerial;
    const escolhida =
      portList.find((p) => salva && p.portName === salva) ||
      portList.find((p) => String(p.vendorId || '').toLowerCase().replace(/^0x/, '') === VID_CP210X) ||
      portList[0];
    if (!escolhida) {
      callback(''); // requestPort() rejeita -> o hook trata como "cancelou"
      return;
    }
    if (escolhida.portName && escolhida.portName !== salva) {
      cfg.rfid = { ...(cfg.rfid || {}), portaSerial: escolhida.portName };
      saveConfig(cfg);
    }
    callback(escolhida.portId);
  });

  // Permissões que o PDV usa: serial (RFID), fullscreen (botão da tela),
  // clipboard e notificações. O resto continua negado.
  const PERMITIDAS = new Set([
    'serial',
    'fullscreen',
    'clipboard-read',
    'clipboard-sanitized-write',
    'notifications',
  ]);
  ses.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(PERMITIDAS.has(permission)),
  );
  ses.setPermissionCheckHandler((_wc, permission) => PERMITIDAS.has(permission));
  // getPorts() (reconexão automática do hook) enxerga as portas seriais
  ses.setDevicePermissionHandler((details) => details.deviceType === 'serial');
}

// ----------------------------- IPC: periféricos ----------------------------
// Impressoras locais — o HeadCoach pode usar window.pdv.* quando quiser
// imprimir direto na térmica sem a caixa de diálogo.
ipcMain.handle('perifericos:listarImpressoras', async () => {
  try {
    const printers = await mainWindow.webContents.getPrintersAsync();
    return printers.map((p) => ({
      nome: p.name,
      descricao: p.displayName || p.description || '',
      padrao: !!p.isDefault,
      status: p.status,
    }));
  } catch {
    return [];
  }
});

ipcMain.handle('perifericos:imprimirCupom', async (_e, { impressora, html }) => {
  return new Promise((resolve) => {
    const win = new BrowserWindow({ show: false });
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    win.webContents.once('did-finish-load', () => {
      win.webContents.print(
        { silent: true, deviceName: impressora || undefined, printBackground: true },
        (ok, motivo) => {
          win.close();
          resolve({ ok, motivo: motivo || null });
        },
      );
    });
  });
});

// ------------------------- salvar documento em PDF -------------------------
// A impressão do Electron não oferece "Salvar como PDF". Aqui o HTML do DANFE é
// carregado numa janela escondida, vira PDF (com o CSS de impressão dele) e o
// caixa escolhe a pasta no "Salvar como". O nome já vem pronto da tela
// ("NF <número> - <cliente>") e a última pasta usada fica lembrada na máquina.
ipcMain.handle('documentos:salvarPdf', async (_e, { html, nome } = {}) => {
  if (!html) return { ok: false, erro: 'Documento vazio' };
  const limpo =
    String(nome || 'documento')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'documento';
  const cfg = loadConfig();
  const pasta = cfg.pastaPdf && fs.existsSync(cfg.pastaPdf) ? cfg.pastaPdf : app.getPath('documents');
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Salvar em PDF',
    defaultPath: path.join(pasta, `${limpo}.pdf`),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return { ok: false, cancelado: true };
  const tmp = path.join(os.tmpdir(), `pdv-doc-${Date.now()}.html`);
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false } });
  try {
    fs.writeFileSync(tmp, html, 'utf8');
    await win.loadFile(tmp);
    const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4', preferCSSPageSize: true });
    fs.writeFileSync(filePath, pdf);
    saveConfig({ ...cfg, pastaPdf: path.dirname(filePath) });
    return { ok: true, caminho: filePath };
  } catch (e) {
    return { ok: false, erro: e.message };
  } finally {
    win.destroy();
    fs.unlink(tmp, () => {});
  }
});

// ------------------------ portal RFID (Chainway UR4) -----------------------
// O app roda o MESMO agente do kit portal-agent (../portal-agent/agent.mjs)
// dentro do processo principal: abre http://127.0.0.1:7070 (ou 7171/27070),
// que é onde as telas RFID do HeadCoach procuram o portal (utils/portalApi.js).
// Assim o portal funciona no app — e também no navegador deste computador
// enquanto o app estiver aberto — sem instalar Node.js nem o kit.
let agentePortal = null;
const PORTAS_AGENTE = [7070, 7171, 27070];
const IP_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

function caminhoAgente() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'portal-agent', 'agent.mjs')
    : path.join(__dirname, '..', 'portal-agent', 'agent.mjs');
}

// Algum agente já responde nesta máquina? (kit instalado ou outra instância)
function agenteJaRodando() {
  return Promise.all(
    PORTAS_AGENTE.map(
      (porta) =>
        new Promise((resolve) => {
          const req = http.get({ host: '127.0.0.1', port: porta, path: '/health', timeout: 800 }, (res) => {
            res.resume();
            resolve(res.statusCode === 200 ? porta : null);
          });
          req.on('error', () => resolve(null));
          req.on('timeout', () => {
            req.destroy();
            resolve(null);
          });
        }),
    ),
  ).then((l) => l.find(Boolean) || null);
}

function ipConfigurado(rfid) {
  const ip = String(rfid?.host || '').trim();
  return IP_RE.test(ip) && ip !== PORTAL_IP_FABRICA ? ip : null;
}

async function iniciarAgentePortal() {
  const ja = await agenteJaRodando();
  if (ja) {
    console.log(`[portal] agente já rodando nesta máquina (porta ${ja}) — o app usa esse`);
    return;
  }
  try {
    process.env.PORTAL_AGENT_EMBUTIDO = '1';
    process.env.PORTAL_AGENT_CONFIG = path.join(app.getPath('userData'), 'portal-rfid.json');
    agentePortal = await import(pathToFileURL(caminhoAgente()).href);
    const rfid = loadConfig().rfid;
    const ip = ipConfigurado(rfid);
    if (ip) agentePortal.definirPortal(ip, rfid.porta);
    console.log('[portal] agente embutido iniciado:', agentePortal.situacaoAgente());
  } catch (e) {
    agentePortal = null;
    console.error('[portal] agente embutido não subiu:', e);
  }
}

// O UR4 aceita UMA conexão TCP por vez: o teste só abre e fecha o socket.
function testarTcp(host, porta, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port: porta });
    const fim = (ok, motivo) => {
      s.removeAllListeners();
      s.destroy();
      resolve({ ok, motivo });
    };
    s.setTimeout(timeoutMs, () => fim(false, 'sem resposta (tempo esgotado)'));
    s.once('connect', () => fim(true));
    s.once('error', (e) => fim(false, e.code || e.message));
  });
}

ipcMain.handle('perifericos:rfidConectar', async (_e, cfg) => {
  const host = String(cfg?.host || '').trim();
  const porta = parseInt(cfg?.porta, 10) || 8888;
  if (!IP_RE.test(host)) return { ok: false, mensagem: 'Informe o IP do portal (ex.: 192.168.0.202)', leituras: [] };
  // portal já lendo por este agente → não abre outra conexão (ele aceita uma só)
  const sit = agentePortal?.situacaoAgente?.();
  if (sit && sit.host === host && sit.status === 'lendo') {
    return { ok: true, mensagem: `Portal ${host}:${porta} lendo agora (${sit.tagsDistintas} etiqueta(s)).`, leituras: [] };
  }
  const t = await testarTcp(host, porta);
  if (!t.ok) {
    return {
      ok: false,
      mensagem: `O portal não respondeu em ${host}:${porta} (${t.motivo}). Confira se ele está ligado, no mesmo Wi-Fi/rede deste computador e com este IP.`,
      leituras: [],
    };
  }
  if (agentePortal) agentePortal.definirPortal(host, porta);
  return {
    ok: true,
    mensagem: agentePortal
      ? `Portal respondeu em ${host}:${porta}. Pronto: use LIGAR PORTAL nas telas Orçamento RFID e Devolução RFID.`
      : `Portal respondeu em ${host}:${porta}. Atenção: o agente do kit já roda neste PC — troque o IP no config.json dele.`,
    leituras: [],
  };
});

ipcMain.handle('perifericos:tefConectar', async (_e, cfg) => {
  await new Promise((r) => setTimeout(r, 900));
  return {
    ok: true,
    provedor: (cfg && cfg.provedor) || 'Stone',
    mensagem: `Pinpad ${(cfg && cfg.provedor) || 'Stone'} pronto (modo demonstração)`,
  };
});

ipcMain.handle('perifericos:tefPagar', async (_e, { valor }) => {
  await new Promise((r) => setTimeout(r, 1500));
  return {
    aprovado: true,
    nsu: String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
    autorizacao: String(Math.floor(Math.random() * 1e6)).padStart(6, '0'),
    bandeira: 'VISA',
    valor,
  };
});

ipcMain.handle('config:ler', async () => loadConfig());
ipcMain.handle('config:salvar', async (_e, cfg) => {
  const ok = saveConfig(cfg);
  const ip = ipConfigurado(cfg?.rfid);
  if (ok && ip && agentePortal) {
    try {
      agentePortal.definirPortal(ip, cfg.rfid.porta);
    } catch (e) {
      console.error('[portal] IP não aplicado:', e.message);
    }
  }
  return { ok };
});

// ----------------------------- ciclo de vida -------------------------------
app.whenReady().then(async () => {
  configurarSerial(session.defaultSession);
  await iniciarAgentePortal();
  await createWindow();
  // verifica/baixa versão nova em segundo plano (só no app instalado)
  updater.iniciar(mainWindow);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
