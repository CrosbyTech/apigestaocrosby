// Alerta/conversa por WhatsApp (uazapi / instância crosbybot) do fluxo BlueCard:
//  - avisa o responsável quando um lead falha ao cadastrar no TOTVS;
//  - recebe a correção dele (webhook) e responde o resultado.
import axios from 'axios';
import { getPool } from './uazapiSync.js';

const UAZ_BASE = process.env.UAZAPI_BASE_URL || '';
// Instância de envio (mesma dos alertas do forecast). "crosbybot" = o bot Crosby.
const ALERT_INSTANCE = process.env.UAZAPI_ALERT_INSTANCE || 'crosbybot';
// Número que recebe/opera os alertas (Rodolfo). Configurável por env.
export const ALERT_PHONE = process.env.BLUECARD_ALERT_PHONE || '5584996211158';

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

// Envia texto pela instância crosbybot. Lança se falhar (o chamador decide).
export async function enviarWhatsappBluecard(text, phone = ALERT_PHONE) {
  if (!UAZ_BASE) throw new Error('UAZAPI_BASE_URL não configurado');
  const number = normalizeBrPhone(phone);
  if (!number) throw new Error('Telefone inválido');
  const sender = await getInstanceToken();
  if (!sender?.token) throw new Error(`Instância "${ALERT_INSTANCE}" não encontrada`);
  try {
    await axios.post(
      `${UAZ_BASE}/send/text`,
      { number, text },
      { headers: { token: sender.token, 'Content-Type': 'application/json' }, timeout: 30000 },
    );
  } catch (err) {
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

// Sugere qual campo corrigir conforme a mensagem de erro do TOTVS.
function campoSugerido(erro) {
  const e = String(erro || '').toLowerCase();
  if (/\bcep\b/.test(e)) return 'cep';
  if (/endere|address/.test(e)) return 'endereco';
  if (/cpf/.test(e)) return 'cpf';
  if (/email|e-mail/.test(e)) return 'email';
  if (/nome|name/.test(e)) return 'nome';
  return 'cep';
}

// Alerta de falha de cadastro (fire-and-forget — nunca lança).
export async function alertarErroCadastroBluecard(lead, erro) {
  try {
    const campo = campoSugerido(erro);
    const texto =
      `⚠️ *BlueCard — cliente não cadastrado no TOTVS*\n\n` +
      `🆔 Lead *#${lead?.id}*\n` +
      `👤 *${lead?.nome || 'Sem nome'}*\n` +
      `🪪 CPF: ${fmtCpf(lead?.cpf)}\n` +
      (lead?.whatsapp ? `📱 WhatsApp: ${lead.whatsapp}\n` : '') +
      `\n❌ *Motivo:* ${erro || 'erro desconhecido'}\n\n` +
      `Para corrigir e recadastrar, responda:\n` +
      `*#${lead?.id} ${campo} <valor novo>*\n` +
      `Ex.: *#${lead?.id} ${campo} ${campo === 'cep' ? '58510000' : '...'}*\n\n` +
      `Campos: cep, endereco, numero, complemento, cidade, estado, nome, cpf, email, whatsapp, data_nasc.`;
    await enviarWhatsappBluecard(texto);
    console.log(`📲 [bluecard/alerta] enviado — lead #${lead?.id} "${lead?.nome}"`);
  } catch (e) {
    console.warn('[bluecard/alerta] falha ao enviar WhatsApp:', e.message);
  }
}
