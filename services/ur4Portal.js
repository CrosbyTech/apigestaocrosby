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
//   0x10 definir potência / 0x12 ler potência (ver bloco de potência abaixo)
//   0xA1 configuração geral → resposta 0xA2: data [07, 1|0] liga/desliga o buzzer, [08] lê o estado
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
    if (cmd !== 0x83) entregarResposta(cmd, frame.subarray(5, total - 3));
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

// ─── Buzzer (apito do próprio portal a cada leitura) ─────────────────────────
// Fonte: API Java oficial, classe j (UR4): getBeepSendData → cmd 0xA1 data [0x07, on]
// (resposta 0xA2, data[0] = 1 quando aceito); estado: 0xA1 [0x08] → 0xA2 [0x08, estado]
async function lerBuzzer() {
  const data = await enviarComando(0xa1, [0x08], 0xa2);
  if (data[0] !== 0x08) throw new Error('resposta inesperada do portal ao ler o buzzer');
  return { ligado: data[1] !== 0 };
}

export async function getPortalBeep() {
  return sessaoDeComando(lerBuzzer);
}

export async function setPortalBeep(ligado) {
  return sessaoDeComando(async () => {
    const resp = await enviarComando(0xa1, [0x07, ligado ? 0x01 : 0x00], 0xa2);
    if (resp[0] !== 0x01) throw new Error(`o portal recusou a configuração do buzzer (código ${resp[0]})`);
    console.log(`🔇 [UR4] Buzzer do portal ${ligado ? 'ligado' : 'desligado'}`);
    return lerBuzzer().catch(() => ({ ligado: !!ligado }));
  });
}

export async function getPortalPower() {
  return lerPotencia();
}

// { potencia } aplica a todas as antenas; { antenas:[{ant,potencia}] } por antena
export async function setPortalPower({ potencia, antenas } = {}) {
  let lista = Array.isArray(antenas) ? antenas : null;
  if (!lista && potencia != null) {
    const atual = await lerPotencia();
    const base = atual.antenas.length ? atual.antenas : [1, 2, 3, 4].map((ant) => ({ ant }));
    lista = base.map((a) => ({ ant: a.ant, potencia }));
  }
  const r = await definirPotencia(lista);
  console.log(`📡 [UR4] Potência gravada: ${r.antenas.map((a) => `ant${a.ant}=${a.leitura}dBm`).join(' ')}`);
  return r;
}

export function getPortalTags() {
  return [...tags.values()].sort((a, b) => b.lastSeen - a.lastSeen);
}

export function clearPortalTags() {
  tags.clear();
  totalReads = 0;
}
