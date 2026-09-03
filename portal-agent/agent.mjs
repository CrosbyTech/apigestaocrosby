// =============================================================================
// AGENTE DO PORTAL RFID (Chainway UR4) — Crosby
// Servicinho local, sem dependências (só Node.js): conecta no portal da SUA
// rede e serve a leitura para o HeadCoach (local ou produção) via
// http://127.0.0.1:7070. O IP do portal fica no config.json ao lado.
//
// Endpoints (mesmo contrato do backend /api/portal-rfid):
//   GET  /health              → { ok, portalHost }
//   POST /connect  {host?}    → liga o inventário (host opcional sobrepõe o config)
//   POST /disconnect          → desliga
//   GET  /status              → situação da conexão
//   GET  /tags                → { status, tags: [{epc, count, rssi, ant, ...}] }
//   POST /clear               → limpa a lista
// =============================================================================
import http from 'http';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Config ──────────────────────────────────────────────────────────────────
let config = { portalHost: '192.168.0.202', portalPort: 8888, listenPort: 7070 };
try {
  config = {
    ...config,
    ...JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')),
  };
} catch {
  console.log('config.json não encontrado — usando padrões');
}

// ─── Protocolo Chainway UR4 (A5 5A) ─────────────────────────────────────────
const REARM_INTERVAL_MS = 20000;
const RECONNECT_DELAY_MS = 3000;

function buildFrame(cmd, data = []) {
  const len = 8 + data.length; // frame inteiro, incluindo header A5 5A
  const body = [(len >> 8) & 0xff, len & 0xff, cmd, ...data];
  const xor = body.reduce((a, b) => a ^ b, 0);
  return Buffer.from([0xa5, 0x5a, ...body, xor, 0x0d, 0x0a]);
}
const START_FRAME = buildFrame(0x82, [0x27, 0x10]);
const STOP_FRAME = buildFrame(0x8c);

let socket = null;
let desired = false;
let hostCfg = config.portalHost;
let portCfg = config.portalPort;
let status = 'desconectado';
let lastError = '';
let rxBuf = Buffer.alloc(0);
let rearmTimer = null;
let reconnectTimer = null;
let totalReads = 0;
const tags = new Map();

function parseFrames() {
  for (;;) {
    const idx = rxBuf.indexOf(0xa5);
    if (idx < 0) {
      rxBuf = Buffer.alloc(0);
      return;
    }
    if (idx > 0) rxBuf = rxBuf.subarray(idx);
    if (rxBuf.length < 4 || rxBuf[1] !== 0x5a) {
      if (rxBuf.length >= 2 && rxBuf[1] !== 0x5a) {
        rxBuf = rxBuf.subarray(1);
        continue;
      }
      return;
    }
    const total = rxBuf.readUInt16BE(2);
    if (total < 8 || total > 512) {
      rxBuf = rxBuf.subarray(1);
      continue;
    }
    if (rxBuf.length < total) return;
    const frame = rxBuf.subarray(0, total);
    rxBuf = rxBuf.subarray(total);
    const cmd = frame[4];
    if (cmd === 0x83 && total >= 10) {
      const dataEnd = total - 3;
      const epcBytes = frame.subarray(7, dataEnd - 3);
      const rssiRaw = frame.readInt16BE(dataEnd - 3);
      const ant = frame[dataEnd - 1];
      const epc = epcBytes.toString('hex').toUpperCase();
      if (epc.length >= 8) {
        totalReads++;
        const now = Date.now();
        const cur = tags.get(epc);
        if (cur) {
          cur.count++;
          cur.lastSeen = now;
          cur.rssi = rssiRaw / 10;
          cur.ant = ant;
        } else {
          tags.set(epc, {
            epc,
            count: 1,
            firstSeen: now,
            lastSeen: now,
            rssi: rssiRaw / 10,
            ant,
          });
        }
      }
    }
  }
}

function cleanupTimers() {
  if (rearmTimer) clearInterval(rearmTimer);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  rearmTimer = null;
  reconnectTimer = null;
}

function connect() {
  cleanupTimers();
  status = 'conectando';
  rxBuf = Buffer.alloc(0);
  socket = new net.Socket();
  socket.setNoDelay(true);
  socket.connect(portCfg, hostCfg, () => {
    status = 'lendo';
    lastError = '';
    console.log(`[UR4] Conectado em ${hostCfg}:${portCfg}`);
    socket.write(START_FRAME);
    rearmTimer = setInterval(() => {
      try {
        socket.write(START_FRAME);
      } catch {
        /* handler de erro reconecta */
      }
    }, REARM_INTERVAL_MS);
  });
  socket.on('data', (d) => {
    rxBuf = Buffer.concat([rxBuf, d]);
    parseFrames();
  });
  const onDown = (why) => () => {
    cleanupTimers();
    if (socket) {
      socket.removeAllListeners();
      socket.destroy();
      socket = null;
    }
    if (desired) {
      status = 'reconectando';
      console.log(`[UR4] Caiu (${why}) — reconectando...`);
      reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
    } else {
      status = 'desconectado';
    }
  };
  socket.on('error', (e) => {
    lastError = e.message;
    onDown(e.message)();
  });
  socket.on('close', onDown('close'));
}

const getStatus = () => ({
  status,
  host: hostCfg,
  port: portCfg,
  lastError,
  tagsDistintas: tags.size,
  totalReads,
  agente: true,
});

// ─── Servidor HTTP local (com CORS p/ o HeadCoach) ───────────────────────────
const ok = (res, data, message = 'ok') => {
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify({ success: true, message, data }));
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }
  const url = req.url.split('?')[0];

  if (req.method === 'GET' && url === '/health') {
    return ok(res, { ok: true, portalHost: hostCfg, version: 1 });
  }
  if (req.method === 'GET' && url === '/status') {
    return ok(res, getStatus());
  }
  if (req.method === 'GET' && url === '/tags') {
    return ok(res, {
      status: getStatus(),
      tags: [...tags.values()].sort((a, b) => b.lastSeen - a.lastSeen),
    });
  }
  if (req.method === 'POST' && url === '/connect') {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      try {
        const j = body ? JSON.parse(body) : {};
        if (j.host && /^\d{1,3}(\.\d{1,3}){3}$/.test(j.host)) hostCfg = j.host;
        if (j.port) portCfg = parseInt(j.port, 10);
      } catch {
        /* body vazio */
      }
      desired = true;
      if (socket) {
        socket.removeAllListeners();
        socket.destroy();
        socket = null;
      }
      connect();
      ok(res, getStatus(), 'Portal ligado');
    });
    return;
  }
  if (req.method === 'POST' && url === '/disconnect') {
    desired = false;
    cleanupTimers();
    if (socket) {
      try {
        socket.write(STOP_FRAME);
      } catch {
        /* já caiu */
      }
      const s = socket;
      socket = null;
      setTimeout(() => {
        try {
          s.destroy();
        } catch {
          /* já destruído */
        }
      }, 300);
    }
    status = 'desconectado';
    return ok(res, getStatus(), 'Portal desligado');
  }
  if (req.method === 'POST' && url === '/clear') {
    tags.clear();
    totalReads = 0;
    return ok(res, getStatus(), 'Lista limpa');
  }

  res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
  res.end('{"success":false,"message":"rota desconhecida"}');
});

// Algumas máquinas têm faixas de porta reservadas pelo Windows (Hyper-V/WSL)
// que causam EACCES — tenta a porta do config e cai para as alternativas.
// A página do HeadCoach procura o agente nas mesmas portas.
const PORT_CANDIDATES = [
  ...new Set([config.listenPort, 7070, 7171, 27070]),
];

function tryListen(idx = 0) {
  if (idx >= PORT_CANDIDATES.length) {
    console.error('ERRO: nenhuma porta disponível', PORT_CANDIDATES);
    process.exit(1);
  }
  const porta = PORT_CANDIDATES[idx];
  server.once('error', (e) => {
    if (e.code === 'EACCES' || e.code === 'EADDRINUSE') {
      console.log(`porta ${porta} indisponível (${e.code}) — tentando a próxima...`);
      tryListen(idx + 1);
    } else {
      throw e;
    }
  });
  server.listen(porta, '127.0.0.1', () => {
    console.log('==============================================');
    console.log(' AGENTE DO PORTAL RFID — Crosby');
    console.log(` Escutando em http://127.0.0.1:${porta}`);
    console.log(` Portal configurado: ${hostCfg}:${portCfg}`);
    console.log(' (edite config.json para trocar o IP do portal)');
    console.log('==============================================');
  });
}
tryListen();
