// =============================================================================
// Bridge do portal RFID Chainway UR4 (TCP, protocolo A5 5A)
// Mantém conexão persistente com o leitor, inicia o inventário e acumula as
// tags lidas em memória para o frontend consultar via polling.
//
// Protocolo (decifrado em 02/09/2026 — ver memória portal-rfid-ur4):
//   Frame: A5 5A + len u16BE (do len até 0D 0A) + cmd + data + XOR(len..data) + 0D 0A
//   0x82 start inventory (data 27 10) → stream de 0x83 (tag)
//   0x83 tag: PC(2) + EPC(n) + RSSI(2, int16/10 dBm) + ANT(1)
//   0x8C stop → ACK 0x8D
// =============================================================================
import net from 'net';

const START_INVENTORY_DATA = [0x27, 0x10]; // contagem de leituras por ciclo
const REARM_INTERVAL_MS = 20000; // reenvia o start p/ manter o inventário vivo
const RECONNECT_DELAY_MS = 3000;

function buildFrame(cmd, data = []) {
  // O campo len conta o FRAME INTEIRO, incluindo o header A5 5A:
  // header(2)+len(2)+cmd(1)+data+xor(1)+0D0A(2) — start 0x82 c/ 2 bytes = 0x0A
  const len = 8 + data.length;
  const body = [(len >> 8) & 0xff, len & 0xff, cmd, ...data];
  const xor = body.reduce((a, b) => a ^ b, 0);
  return Buffer.from([0xa5, 0x5a, ...body, xor, 0x0d, 0x0a]);
}

const START_FRAME = buildFrame(0x82, START_INVENTORY_DATA);
const STOP_FRAME = buildFrame(0x8c);

// ─── Estado do singleton ─────────────────────────────────────────────────────
let socket = null;
let desired = false; // usuário quer o portal ligado
let hostCfg = process.env.UR4_HOST || '192.168.0.202';
let portCfg = parseInt(process.env.UR4_PORT || '8888', 10);
let status = 'desconectado'; // desconectado | conectando | lendo | reconectando
let lastError = '';
let rxBuf = Buffer.alloc(0);
let rearmTimer = null;
let reconnectTimer = null;
let totalReads = 0;

// epc → { epc, count, firstSeen, lastSeen, rssi, ant }
const tags = new Map();

function parseFrames() {
  // Procura frames A5 5A ... 0D 0A no buffer acumulado
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
      return; // aguarda mais bytes
    }
    const len = rxBuf.readUInt16BE(2); // tamanho do frame inteiro (com header)
    const total = len;
    if (total < 8 || total > 512) {
      // tamanho absurdo = desalinhamento — avança 1 byte e realinha
      rxBuf = rxBuf.subarray(1);
      continue;
    }
    if (rxBuf.length < total) return; // frame incompleto
    const frame = rxBuf.subarray(0, total);
    rxBuf = rxBuf.subarray(total);

    const cmd = frame[4];
    if (cmd === 0x83 && len >= 10) {
      // PC(2) + EPC + RSSI(2) + ANT(1) entre offset 5 e checksum
      const dataEnd = total - 3; // antes de xor + 0D 0A
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
    console.log(`📡 [UR4] Conectado em ${hostCfg}:${portCfg} — iniciando inventário`);
    socket.write(START_FRAME);
    rearmTimer = setInterval(() => {
      try {
        socket.write(START_FRAME);
      } catch {
        /* socket caiu — o handler de error/close reconecta */
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
      console.log(`⚠️ [UR4] Conexão caiu (${why}) — reconectando em ${RECONNECT_DELAY_MS / 1000}s`);
      reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
    } else {
      status = 'desconectado';
    }
  };
  socket.on('error', (e) => {
    lastError = e.message;
    onDown(`erro: ${e.message}`)();
  });
  socket.on('close', onDown('close'));
}

export function startPortal({ host, port } = {}) {
  if (host) hostCfg = host;
  if (port) portCfg = parseInt(port, 10);
  desired = true;
  if (socket) {
    socket.removeAllListeners();
    socket.destroy();
    socket = null;
  }
  connect();
  return getPortalStatus();
}

export function stopPortal() {
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
  return getPortalStatus();
}

export function getPortalStatus() {
  return {
    status,
    host: hostCfg,
    port: portCfg,
    lastError,
    tagsDistintas: tags.size,
    totalReads,
  };
}

export function getPortalTags() {
  return [...tags.values()].sort((a, b) => b.lastSeen - a.lastSeen);
}

export function clearPortalTags() {
  tags.clear();
  totalReads = 0;
}
