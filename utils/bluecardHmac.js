/**
 * HMAC da integração BlueCard (crediário Crosby) — mesmo esquema nas duas direções.
 *
 * Cabeçalhos:
 *   X-Cc-Key:       key id (identifica quem chama)
 *   X-Cc-Timestamp: epoch em segundos
 *   X-Cc-Signature: HMAC-SHA256(secret, "<timestamp>.<corpo-cru>") em hex
 *
 * Direções e segredos (variáveis de ambiente):
 *   BLUECARD_API_SECRET      — segredo DELES: assina o que NÓS enviamos ao BlueCard
 *                              (entregue pelo Felipe por canal privado, nunca commitar)
 *   BLUECARD_WEBHOOK_SECRET  — segredo NOSSO: verifica o que o BlueCard envia pra nós
 *                              (nós geramos e entregamos ao Felipe)
 *
 * Regras que custam horas se ignoradas (ver doc da integração):
 *   - assinar o corpo CRU em bytes (nunca re-serializar JSON)
 *   - em GET o corpo é string vazia → assina "<timestamp>."
 *   - janela de 5 minutos; 401 de timestamp = relógio fora de hora (NTP)
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const JANELA_SEGUNDOS = 300; // 5 minutos

export function assinar(secret, timestamp, corpoCru) {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${corpoCru}`)
    .digest('hex');
}

/**
 * Monta os headers assinados para uma chamada NOSSA ao BlueCard.
 * @param {string|Buffer} corpoCru corpo exato que será enviado ('' em GET)
 */
export function headersAssinados(corpoCru = '') {
  const secret = process.env.BLUECARD_API_SECRET;
  const keyId = process.env.BLUECARD_API_KEY;
  if (!secret || !keyId) {
    throw new Error(
      'BLUECARD_API_SECRET/BLUECARD_API_KEY não configurados no ambiente',
    );
  }
  const ts = Math.floor(Date.now() / 1000);
  return {
    'X-Cc-Key': keyId,
    'X-Cc-Timestamp': String(ts),
    'X-Cc-Signature': assinar(secret, ts, corpoCru),
  };
}

/**
 * Verifica a assinatura de uma chamada do BlueCard pra nós.
 * Usa req.rawBody (preenchido pelo verify do express.json no index.js).
 * Retorna { ok: true } ou { ok: false, motivo }.
 */
export function verificarAssinatura(req) {
  const secret = process.env.BLUECARD_WEBHOOK_SECRET;
  if (!secret) return { ok: false, motivo: 'BLUECARD_WEBHOOK_SECRET não configurado' };

  const ts = req.headers['x-cc-timestamp'];
  const sig = req.headers['x-cc-signature'];
  if (!ts || !sig) return { ok: false, motivo: 'cabeçalhos de assinatura ausentes' };

  const agora = Math.floor(Date.now() / 1000);
  if (Math.abs(agora - Number(ts)) > JANELA_SEGUNDOS) {
    return { ok: false, motivo: 'timestamp fora da janela de 5 minutos' };
  }

  // GET não tem corpo → string vazia. POST usa os bytes crus recebidos.
  const corpoCru = req.rawBody ? req.rawBody.toString('utf8') : '';
  const esperado = assinar(secret, ts, corpoCru);

  const a = Buffer.from(String(sig), 'utf8');
  const b = Buffer.from(esperado, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, motivo: 'assinatura não confere' };
  }
  return { ok: true };
}

/**
 * Middleware Express: rejeita com 401 no formato de erro combinado
 * ({ erro: { codigo, mensagem } }) se a assinatura não conferir.
 */
export function exigirAssinaturaBluecard(req, res, next) {
  const r = verificarAssinatura(req);
  if (!r.ok) {
    console.warn(
      `🔒 [bluecard] chamada rejeitada em ${req.method} ${req.originalUrl}: ${r.motivo}`,
    );
    return res.status(401).json({
      erro: { codigo: 'nao_autorizado', mensagem: r.motivo, detalhe: null },
    });
  }
  next();
}
