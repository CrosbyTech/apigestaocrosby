// ---------------------------------------------------------------------------
// Atualização automática (electron-updater, provider "generic").
//
// Ao abrir, o app lê `latest.yml` na URL de `build.publish` (package.json),
// compara com a própria versão e, se houver uma mais nova, baixa o Setup em
// segundo plano (diferencial via .blockmap quando o servidor aceita Range).
// Quando termina, pergunta ao caixa: "Atualizar agora" (fecha e instala) ou
// "Depois" (instala sozinho quando o app for fechado). A instalação é
// silenciosa (/S) e o app reabre em seguida. Nada disso roda em
// `npm start` (app não empacotado) — só no .exe instalado.
//
// Log: %APPDATA%/pdv-crosby-electron/logs/main.log
// Testar com outro servidor: PDV_UPDATE_URL=http://127.0.0.1:8099 "PDV Crosby.exe"
// ---------------------------------------------------------------------------
const { app, dialog, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

const INTERVALO_RECHECAGEM_MS = 6 * 60 * 60 * 1000; // caixa fica aberto o dia todo

let janela = null;
let perguntando = false;
let estado = { status: 'ocioso', versao: null, progresso: null, erro: null };

function emitir(novo) {
  estado = { ...estado, ...novo };
  if (janela && !janela.isDestroyed()) janela.webContents.send('atualizacao:status', estado);
}

async function perguntarInstalar(info) {
  if (perguntando) return;
  perguntando = true;
  try {
    const { response } = await dialog.showMessageBox(janela, {
      type: 'info',
      title: 'Atualização do PDV Crosby',
      message: `A versão ${info.version} foi baixada.`,
      detail:
        `Você está na ${app.getVersion()}. O app fecha, instala a nova versão e abre de novo ` +
        '(login e configurações da máquina são preservados).\n\n' +
        'Se escolher "Depois", a atualização é instalada quando o PDV for fechado.',
      buttons: ['Atualizar agora', 'Depois'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (response === 0) {
      log.info('[updater] caixa aceitou: quitAndInstall');
      setImmediate(() => autoUpdater.quitAndInstall(true, true));
    } else {
      log.info('[updater] caixa adiou: instala ao fechar o app');
    }
  } finally {
    perguntando = false;
  }
}

function configurar(mainWindow) {
  janela = mainWindow;

  log.transports.file.level = 'info';
  log.transports.file.maxSize = 2 * 1024 * 1024;
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // Instalador sem assinatura digital: não há publisherName para conferir.
  autoUpdater.verifyUpdateCodeSignature = false;

  if (process.env.PDV_UPDATE_URL) {
    autoUpdater.setFeedURL({ provider: 'generic', url: process.env.PDV_UPDATE_URL });
    log.info('[updater] feed sobrescrito por PDV_UPDATE_URL =', process.env.PDV_UPDATE_URL);
  }

  autoUpdater.on('checking-for-update', () => emitir({ status: 'verificando', erro: null }));
  autoUpdater.on('update-not-available', () => emitir({ status: 'atualizado' }));
  autoUpdater.on('update-available', (info) =>
    emitir({ status: 'baixando', versao: info.version, progresso: 0 }),
  );
  autoUpdater.on('download-progress', (p) =>
    emitir({ status: 'baixando', progresso: Math.round(p.percent) }),
  );
  autoUpdater.on('update-downloaded', (info) => {
    emitir({ status: 'pronto', versao: info.version, progresso: 100 });
    perguntarInstalar(info);
  });
  autoUpdater.on('error', (err) => {
    // sem internet / servidor fora: só registra, o caixa continua na versão atual
    log.warn('[updater] erro:', err?.message || err);
    emitir({ status: 'erro', erro: err?.message || String(err) });
  });

  ipcMain.handle('atualizacao:estado', () => ({ ...estado, versaoAtual: app.getVersion() }));
  ipcMain.handle('atualizacao:verificar', () => verificar());
  ipcMain.handle('atualizacao:instalar', () => {
    if (estado.status !== 'pronto') return false;
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return true;
  });
}

async function verificar() {
  if (!app.isPackaged && !process.env.PDV_UPDATE_URL) {
    log.info('[updater] app não empacotado: verificação ignorada');
    return null;
  }
  try {
    const r = await autoUpdater.checkForUpdates();
    return r?.updateInfo?.version || null;
  } catch (err) {
    // já tratado no evento 'error'
    return null;
  }
}

function iniciar(mainWindow) {
  configurar(mainWindow);
  verificar();
  setInterval(verificar, INTERVALO_RECHECAGEM_MS).unref();
}

module.exports = { iniciar, verificar };
