// BlueCard — leads capturados pela LP pública /lp/bluecard
//   POST /api/bluecard/leads (público, sem auth) — salva lead
import express from 'express';
import supabase from '../config/supabase.js';

const router = express.Router();

// Helper: validação mínima
function clean(s, max = 255) {
  if (s == null) return null;
  return String(s).trim().slice(0, max) || null;
}
function isEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
function cleanCPF(s) {
  return clean((s || '').replace(/\D/g, ''), 14);
}
function cleanPhone(s) {
  return clean((s || '').replace(/\D/g, ''), 20);
}

// Gera CVV único de 3 dígitos. Tenta até 5x se houver colisão (improvável).
// Retorna null se a coluna não existir no schema (não bloqueia o lead).
async function gerarCVVUnico() {
  for (let i = 0; i < 5; i++) {
    const cvv = String(Math.floor(Math.random() * 900) + 100); // 100-999
    const { data, error } = await supabase
      .from('bluecard_leads')
      .select('id')
      .eq('cvv', cvv)
      .limit(1);
    // Coluna não existe ainda — retorna sem gerar (migration pendente)
    if (error && /column .*cvv.* does not exist/i.test(error.message)) return null;
    if (error) {
      console.warn('[bluecard/cvv] check falhou:', error.message);
      return cvv; // erro inesperado: confia no random
    }
    if (!data || data.length === 0) return cvv;
  }
  // Improvável chegar aqui (1 em 900^5)
  return String(Math.floor(Math.random() * 900) + 100);
}

// ─────────────────────────────────────────────────────────────────────
// POST /api/bluecard/leads — submissão pública da LP
// ─────────────────────────────────────────────────────────────────────
router.post('/leads', async (req, res) => {
  try {
    const b = req.body || {};
    const nome = clean(b.nome);
    const whatsapp = cleanPhone(b.whatsapp);
    const email = clean(b.email, 255)?.toLowerCase();
    const cpf = cleanCPF(b.cpf);

    if (!nome) return res.status(400).json({ error: 'Nome obrigatório' });
    if (!whatsapp || whatsapp.length < 10) return res.status(400).json({ error: 'WhatsApp inválido' });
    if (!email || !isEmail(email)) return res.status(400).json({ error: 'Email inválido' });
    if (!cpf || cpf.length !== 11) return res.status(400).json({ error: 'CPF inválido (11 dígitos)' });

    const cvv = await gerarCVVUnico();
    const row = {
      nome,
      whatsapp,
      email,
      cpf,
      empresa: clean(b.empresa),
      instagram: clean(b.instagram, 100),
      data_nasc: clean(b.data_nasc, 20),
      cep: clean((b.cep || '').replace(/\D/g, ''), 8),
      endereco: clean(b.endereco, 500),
      numero: clean(b.numero, 20),
      complemento: clean(b.complemento, 200),
      // Quem indicou o lead (vem da LP /lp/bluecard/indicacao?indicado_por=NOME)
      indicado_por: clean(b.indicado_por, 100),
      origem: clean(b.origem) || 'lp_bluecard',
      ip:
        req.headers['x-forwarded-for']?.toString().split(',')[0].trim() ||
        req.socket?.remoteAddress ||
        null,
      user_agent: clean(req.headers['user-agent'], 500),
    };
    // Só adiciona cvv se a coluna existe no schema (gerarCVVUnico retorna null
    // quando migration ainda não rodou — evita erro de insert).
    if (cvv) row.cvv = cvv;

    let { data, error } = await supabase
      .from('bluecard_leads')
      .insert(row)
      .select('id, cvv')
      .single();
    // Fallback: se inserir falhou por causa da coluna cvv, tenta sem ela
    if (error && cvv && /column .*cvv.* does not exist/i.test(error.message)) {
      console.warn('[bluecard/leads POST] coluna cvv não existe, retry sem cvv');
      delete row.cvv;
      const retry = await supabase
        .from('bluecard_leads')
        .insert(row)
        .select('id')
        .single();
      data = retry.data;
      error = retry.error;
    }
    if (error) {
      console.error('[bluecard/leads POST] supabase:', error.message);
      return res.status(500).json({ error: 'Falha ao salvar' });
    }
    return res.status(201).json({ ok: true, id: data.id, cvv: data.cvv || cvv });
  } catch (e) {
    console.error('[bluecard/leads POST]', e);
    return res.status(500).json({ error: 'Erro interno' });
  }
});

export default router;
