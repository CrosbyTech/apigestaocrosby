// ============================================================
// ENTRADA DE E-MAIL DAS DESPESAS FIXAS — /api/contas-fixas
//
//   POST /email-entrada   corpo = a mensagem crua (RFC 822), como a Cloudflare
//                         Email Routing entrega ao Email Worker do domínio.
//     cabeçalhos: x-email-secret (obrigatório), x-email-de, x-email-para
//
// Sem login: quem chama é o Email Worker, que se identifica pelo segredo
// CONTAS_FIXAS_EMAIL_SECRET (variável de ambiente; sem ela a rota fica fechada).
// A rota só guarda a mensagem — não lança nada no financeiro.
// ============================================================
import crypto from 'node:crypto';
import express from 'express';
import { receberEmail } from '../services/contasFixasEmail.js';

const router = express.Router();

function segredoConfere(recebido) {
  const esperado = String(process.env.CONTAS_FIXAS_EMAIL_SECRET || '');
  if (esperado.length < 24) return false; // sem segredo forte configurado, ninguém entra
  const a = crypto.createHash('sha256').update(String(recebido || '')).digest();
  const b = crypto.createHash('sha256').update(esperado).digest();
  return crypto.timingSafeEqual(a, b);
}

router.post('/email-entrada', express.raw({ type: () => true, limit: '25mb' }), async (req, res) => {
  if (!segredoConfere(req.get('x-email-secret'))) return res.status(401).json({ success: false, message: 'não autorizado' });
  const bruto = Buffer.isBuffer(req.body) ? req.body : req.rawBody;
  if (!bruto || !bruto.length) return res.status(400).json({ success: false, message: 'mensagem vazia' });
  try {
    const r = await receberEmail(bruto, { de: req.get('x-email-de'), para: req.get('x-email-para') });
    console.log(`📧 [contas fixas] e-mail ${r.nova ? 'recebido' : 'repetido'} #${r.id} de ${r.de || '?'}${r.codigo ? ' · com código' : ''}${r.anexos ? ` · ${r.anexos} anexo(s)` : ''}`);
    return res.json({ success: true, id: r.id, nova: r.nova });
  } catch (e) {
    console.error('📧 [contas fixas] falha ao guardar e-mail:', e.message);
    return res.status(500).json({ success: false, message: 'falha ao guardar a mensagem' });
  }
});

export default router;
