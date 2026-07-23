// Alerta por WhatsApp (uazapi / instância crosbybot) quando um lead BlueCard
// falha ao ser cadastrado no TOTVS — pra o responsável ajustar o cadastro e
// reprocessar na automação.
import axios from 'axios';
import { getPool } from './uazapiSync.js';

const UAZ_BASE = process.env.UAZAPI_BASE_URL || '';
// Instância de envio (mesma usada nos alertas do forecast). "crosbybot" = o bot Crosby.
const ALERT_INSTANCE = process.env.UAZAPI_ALERT_INSTANCE || 'crosbybot';
// Número que recebe o alerta (Rodolfo). Configurável por env.
const ALERT_PHONE = process.env.BLUECARD_ALERT_PHONE || '5584996211158';

function normalizeBrPhone(s) {
  const d = String(s || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('55')) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

async function getInstanceToken() {
  const pool = getPool();
  let r = await pool.query(
    `SELECT name, token, status FROM instances
      WHERE LOWER(name) = LOWER($1)
      ORDER BY (status = 'connected') DESC LIMIT 1`,
    [ALERT_INSTANCE],
  );
  if (r.rows[0]?.token) return r.rows[0];
  r = await pool.query(
    `SELECT name, token, status FROM instances
      WHERE LOWER(name) LIKE '%' || LOWER($1) || '%'
      ORDER BY (status = 'connected') DESC LIMIT 1`,
    [ALERT_INSTANCE],
  );
  return r.rows[0] || null;
}

async function enviarWhatsapp(number, text) {
  const sender = await getInstanceToken();
  if (!sender?.token) throw new Error(`Instância "${ALERT_INSTANCE}" não encontrada`);
  try {
    await axios.post(
      `${UAZ_BASE}/send/text`,
      { number, text },
      { headers: { token: sender.token, 'Content-Type': 'application/json' }, timeout: 30000 },
    );
  } catch (err) {
    // Alguns deploys do uazapi usam /sendText
    if (err.response?.status === 404) {
      await axios.post(
        `${UAZ_BASE}/sendText`,
        { number, text },
        { headers: { token: sender.token, 'Content-Type': 'application/json' }, timeout: 30000 },
      );
    } else throw err;
  }
}

function fmtCpf(s) {
  const d = String(s || '').replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  return s || '—';
}

// Dispara o alerta (fire-and-forget — nunca lança pra não travar o cadastro).
export async function alertarErroCadastroBluecard(lead, erro) {
  try {
    if (!UAZ_BASE) return;
    const number = normalizeBrPhone(ALERT_PHONE);
    if (!number) return;
    const texto =
      `⚠️ *BlueCard — cliente não cadastrado no TOTVS*\n\n` +
      `👤 *${lead?.nome || 'Sem nome'}*\n` +
      `🪪 CPF: ${fmtCpf(lead?.cpf)}\n` +
      (lead?.whatsapp ? `📱 WhatsApp: ${lead.whatsapp}\n` : '') +
      `\n❌ *Motivo:* ${erro || 'erro desconhecido'}\n\n` +
      `Ajuste o cadastro do cliente e reprocesse na automação para cadastrar novamente.`;
    await enviarWhatsapp(number, texto);
    console.log(`📲 [bluecard/alerta] enviado a ${number} — lead "${lead?.nome}"`);
  } catch (e) {
    console.warn('[bluecard/alerta] falha ao enviar WhatsApp:', e.message);
  }
}
