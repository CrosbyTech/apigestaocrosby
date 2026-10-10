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
//   GET  /power               → potência de cada antena (dBm)
//   POST /power {potencia} | {antenas:[{ant,potencia}]} → grava a potência
//   GET  /beep                → { ligado } buzzer do portal
//   POST /beep {ligado}       → liga/desliga o apito do portal a cada leitura
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
    if (cmd !== 0x83) entregarResposta(cmd, frame.subarray(5, total - 3));
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

// ─── Potência das antenas (decifrado da API oficial Chainway, set/2026) ─────
//   0x10 definir: 02 + [antena, leitura u16BE, escrita u16BE]* (valor = dBm × 100)
//        resposta 0x11, data[0] = 1 quando aceito
//   0x12 ler (sem dados) → resposta 0x13: 1 byte + [antena, leitura, escrita]*
// O leitor só aceita esses comandos com o inventário PARADO; por isso a
// sessão de comando para a leitura, conversa e religa se estava lendo.
const POWER_MIN = 5;
const POWER_MAX = 30;
const CMD_TIMEOUT_MS = 3000;
let aguardando = null; // { cmd, resolve, reject, timer }
let emComando = false;

function entregarResposta(cmd, data) {
  if (!aguardando || aguardando.cmd !== cmd) return;
  clearTimeout(aguardando.timer);
  const { resolve } = aguardando;
  aguardando = null;
  resolve(Buffer.from(data));
}

function enviarComando(cmd, data, respCmd, timeoutMs = CMD_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    if (!socket) return reject(new Error('sem conexão com o portal'));
    if (aguardando) return reject(new Error('outro comando em andamento'));
    const timer = setTimeout(() => {
      aguardando = null;
      reject(new Error(`o portal não respondeu ao comando 0x${cmd.toString(16).toUpperCase()}`));
    }, timeoutMs);
    aguardando = { cmd: respCmd, resolve, reject, timer };
    try {
      socket.write(buildFrame(cmd, data));
    } catch (e) {
      clearTimeout(timer);
      aguardando = null;
      reject(e);
    }
  });
}

function conectarParaComando(timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const s = new net.Socket();
    s.setNoDelay(true);
    const t = setTimeout(() => {
      s.destroy();
      reject(new Error(`portal ${hostCfg}:${portCfg} não respondeu — confira se está ligado e na rede`));
    }, timeoutMs);
    s.once('error', (e) => {
      clearTimeout(t);
      reject(new Error(`não consegui conectar no portal ${hostCfg}:${portCfg} (${e.message})`));
    });
    s.connect(portCfg, hostCfg, () => {
      clearTimeout(t);
      s.removeAllListeners('error');
      s.on('error', () => {});
      s.on('data', (d) => {
        rxBuf = Buffer.concat([rxBuf, d]);
        parseFrames();
      });
      resolve(s);
    });
  });
}

// Roda `fn` com o leitor em modo comando e devolve o portal ao estado anterior
async function sessaoDeComando(fn) {
  if (emComando) throw new Error('já existe uma configuração em andamento');
  emComando = true;
  const estavaLendo = !!socket && status === 'lendo';
  let temporario = null;
  try {
    if (socket) {
      if (rearmTimer) clearInterval(rearmTimer);
      rearmTimer = null;
      await enviarComando(0x8c, [], 0x8d, 1500).catch(() => {});
      await new Promise((r) => setTimeout(r, 150));
    } else {
      rxBuf = Buffer.alloc(0);
      temporario = await conectarParaComando();
      socket = temporario;
      await enviarComando(0x8c, [], 0x8d, 1200).catch(() => {});
    }
    return await fn();
  } finally {
    if (temporario) {
      try {
        temporario.destroy();
      } catch {
        /* já fechado */
      }
      if (socket === temporario) socket = null;
    } else if (socket && estavaLendo) {
      try {
        socket.write(START_FRAME);
        rearmTimer = setInterval(() => {
          try {
            socket.write(START_FRAME);
          } catch {
            /* handler de erro reconecta */
          }
        }, REARM_INTERVAL_MS);
      } catch {
        /* a reconexão automática cuida */
      }
    }
    emComando = false;
  }
}

function interpretarPotencias(data) {
  const n = Math.floor((data.length - 1) / 5);
  const antenas = [];
  for (let k = 0; k < n; k++) {
    const o = 1 + k * 5;
    antenas.push({
      ant: data[o],
      leitura: data.readUInt16BE(o + 1) / 100,
      escrita: data.readUInt16BE(o + 3) / 100,
    });
  }
  return antenas.sort((a, b) => a.ant - b.ant);
}

async function lerPotencia() {
  return sessaoDeComando(async () => {
    const data = await enviarComando(0x12, [], 0x13);
    return { antenas: interpretarPotencias(data), min: POWER_MIN, max: POWER_MAX };
  });
}

// Buzzer do portal (API Java, classe j do UR4): cmd 0xA1 [07, on] → 0xA2 [01];
// estado: 0xA1 [08] → 0xA2 [08, estado]
async function lerBuzzer() {
  const data = await enviarComando(0xa1, [0x08], 0xa2);
  if (data[0] !== 0x08) throw new Error('resposta inesperada do portal ao ler o buzzer');
  return { ligado: data[1] !== 0 };
}
async function definirBuzzer(ligado) {
  return sessaoDeComando(async () => {
    const resp = await enviarComando(0xa1, [0x07, ligado ? 0x01 : 0x00], 0xa2);
    if (resp[0] !== 0x01) throw new Error(`o portal recusou a configuração do buzzer (código ${resp[0]})`);
    return lerBuzzer().catch(() => ({ ligado: !!ligado }));
  });
}

// antenas: [{ ant: 1..n, potencia: dBm }] — grava leitura e escrita iguais
async function definirPotencia(antenas) {
  const lista = (antenas || [])
    .map((a) => ({ ant: parseInt(a.ant, 10), potencia: Number(a.potencia) }))
    .filter((a) => Number.isInteger(a.ant) && a.ant >= 1 && a.ant <= 16);
  if (!lista.length) throw new Error('informe ao menos uma antena');
  for (const a of lista) {
    if (!(a.potencia >= POWER_MIN && a.potencia <= POWER_MAX)) {
      throw new Error(`potência da antena ${a.ant} fora da faixa (${POWER_MIN} a ${POWER_MAX} dBm)`);
    }
  }
  return sessaoDeComando(async () => {
    const data = [0x02];
    for (const a of lista) {
      const v = Math.round(a.potencia * 100);
      data.push(a.ant, (v >> 8) & 0xff, v & 0xff, (v >> 8) & 0xff, v & 0xff);
    }
    const resp = await enviarComando(0x10, data, 0x11);
    if (resp[0] !== 0x01) {
      throw new Error(`o portal recusou a potência (código ${resp[0]})`);
    }
    // confere lendo de volta o que ficou gravado
    const atual = await enviarComando(0x12, [], 0x13);
    return { antenas: interpretarPotencias(atual), min: POWER_MIN, max: POWER_MAX };
  });
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

const falha = (res, message, code = 502) => {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify({ success: false, message }));
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      // Chrome Private Network Access: obrigatório para página HTTPS
      // (headcoach em produção) poder falar com 127.0.0.1
      'Access-Control-Allow-Private-Network': 'true',
      'Access-Control-Allow-Local-Network': 'true',
    });
    return res.end();
  }
  const url = req.url.split('?')[0];

  if (req.method === 'GET' && url === '/health') {
    return ok(res, { ok: true, portalHost: hostCfg, version: 3, recursos: ['power', 'beep'] });
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
  if (req.method === 'GET' && url === '/beep') {
    try {
      return ok(res, await sessaoDeComando(lerBuzzer), 'Buzzer do portal');
    } catch (e) {
      return falha(res, e.message);
    }
  }
  if (req.method === 'POST' && url === '/beep') {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', async () => {
      try {
        const j = body ? JSON.parse(body) : {};
        const r = await definirBuzzer(!!j.ligado);
        console.log(`[UR4] Buzzer ${r.ligado ? 'ligado' : 'desligado'}`);
        ok(res, r, r.ligado ? 'Buzzer ligado' : 'Buzzer desligado');
      } catch (e) {
        falha(res, e.message);
      }
    });
    return undefined;
  }
  if (req.method === 'GET' && url === '/power') {
    try {
      return ok(res, await lerPotencia(), 'Potência do portal');
    } catch (e) {
      return falha(res, e.message);
    }
  }
  if (req.method === 'POST' && url === '/power') {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', async () => {
      try {
        const j = body ? JSON.parse(body) : {};
        let antenas = Array.isArray(j.antenas) ? j.antenas : null;
        if (!antenas && j.potencia != null) {
          // mesma potência em todas: descobre quantas antenas o portal tem
          const atual = await lerPotencia();
          const base = atual.antenas.length ? atual.antenas : [1, 2, 3, 4].map((ant) => ({ ant }));
          antenas = base.map((a) => ({ ant: a.ant, potencia: j.potencia }));
        }
        const r = await definirPotencia(antenas);
        console.log(`[UR4] Potência gravada: ${r.antenas.map((a) => `ant${a.ant}=${a.leitura}dBm`).join(' ')}`);
        ok(res, r, 'Potência gravada');
      } catch (e) {
        falha(res, e.message);
      }
    });
    return;
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
