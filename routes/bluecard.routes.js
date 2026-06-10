// BlueCard — leads capturados pela LP pública /lp/bluecard
//   POST /api/bluecard/leads        (público, sem auth) — salva lead
//   GET  /api/bluecard/leads        (admin) — lista leads com filtros
//   PATCH /api/bluecard/leads/:id   (admin) — atualiza status/observação
//                                  → automação: cadastra no TOTVS quando
//                                    status='info_completas'
//   DELETE /api/bluecard/leads/:id  (admin) — remove lead
//   POST /api/bluecard/leads/:id/sync-totvs (admin) — força sync TOTVS manual
import express from 'express';
import axios from 'axios';
import supabase from '../config/supabase.js';
import { getToken } from '../utils/totvsTokenManager.js';

const TOTVS_BASE_URL =
  process.env.TOTVS_BASE_URL || 'https://apitotvsmoda.bhan.com.br/api/totvsmoda';

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
      origem: clean(b.origem) || 'lp_bluecard',
      ip:
        req.headers['x-forwarded-for']?.toString().split(',')[0].trim() ||
        req.socket?.remoteAddress ||
        null,
      user_agent: clean(req.headers['user-agent'], 500),
    };

    const { data, error } = await supabase
      .from('bluecard_leads')
      .insert(row)
      .select('id')
      .single();
    if (error) {
      console.error('[bluecard/leads POST] supabase:', error.message);
      return res.status(500).json({ error: 'Falha ao salvar' });
    }
    return res.status(201).json({ ok: true, id: data.id });
  } catch (e) {
    console.error('[bluecard/leads POST]', e);
    return res.status(500).json({ error: 'Erro interno' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/bluecard/leads — listagem (admin)
//   query: ?status=novo|contatado|qualificado|convertido|descartado
//          ?busca=texto    (nome, email, cpf, whatsapp)
//          ?limit=50&offset=0
// ─────────────────────────────────────────────────────────────────────
router.get('/leads', async (req, res) => {
  const status = req.query.status;
  const busca = String(req.query.busca || '').trim();
  const limit = Math.min(parseInt(req.query.limit || '100', 10) || 100, 500);
  const offset = parseInt(req.query.offset || '0', 10) || 0;

  let q = supabase
    .from('bluecard_leads')
    .select('*', { count: 'exact' })
    .order('criado_em', { ascending: false })
    .range(offset, offset + limit - 1);
  if (status) q = q.eq('status', status);
  if (busca) {
    const safe = busca.replace(/[%_]/g, '');
    q = q.or(
      `nome.ilike.%${safe}%,email.ilike.%${safe}%,cpf.ilike.%${safe}%,whatsapp.ilike.%${safe}%,empresa.ilike.%${safe}%`,
    );
  }
  const { data, error, count } = await q;
  if (error) {
    console.error('[bluecard/leads GET]', error.message);
    return res.status(500).json({ error: error.message });
  }
  return res.json({ ok: true, leads: data || [], total: count || 0 });
});

// ─────────────────────────────────────────────────────────────────────
// PATCH /api/bluecard/leads/:id — atualiza status/observação
// ─────────────────────────────────────────────────────────────────────
// Helper: cadastra um lead como PF (individual) no TOTVS Moda.
//   - Não bloqueia o PATCH se falhar; salva o erro em totvs_sync_error.
//   - Idempotente: se já tem totvs_person_code, retorna sem chamar TOTVS.
//   - Faz busca por CPF antes de criar, pra evitar duplicidade.
// ─────────────────────────────────────────────────────────────────────
async function cadastrarLeadNoTotvs(lead) {
  if (lead.totvs_person_code) {
    return { ok: true, personCode: lead.totvs_person_code, alreadySynced: true };
  }
  const cpf = String(lead.cpf || '').replace(/\D/g, '');
  if (cpf.length !== 11) {
    return { ok: false, error: 'CPF inválido (precisa 11 dígitos)' };
  }

  const tk = await getToken();
  const accessToken = tk?.access_token;
  if (!accessToken) {
    return { ok: false, error: 'Token TOTVS indisponível' };
  }

  // 1) Busca por CPF — se já existe, reaproveita o personCode
  try {
    const searchRes = await axios.post(
      `${TOTVS_BASE_URL}/person/v2/individuals/search`,
      { filter: { cpfList: [cpf] }, page: 1, pageSize: 5 },
      { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 30000 },
    );
    const found = searchRes.data?.items?.[0];
    if (found?.code) {
      return { ok: true, personCode: Number(found.code), existed: true };
    }
  } catch (e) {
    console.warn('[bluecard/totvs] search CPF falhou:', e?.response?.data?.message || e.message);
  }

  // 2) Cria PF nova no TOTVS
  const phone = String(lead.whatsapp || '').replace(/\D/g, '');
  const payload = {
    name: lead.nome,
    cpf,
    isCustomer: true,
    emails: lead.email ? [{ email: lead.email, isMain: true, typeEmail: 'Personal' }] : undefined,
    phones: phone
      ? [
          {
            number: phone.length > 2 ? phone.slice(2) : phone,
            connectionType: 'Phone',
            typePhone: 'Cellphone',
            ddd: phone.length > 2 ? phone.slice(0, 2) : null,
            isMain: true,
            isWhatsApp: true,
          },
        ]
      : undefined,
    addresses:
      lead.cep && lead.endereco
        ? [
            {
              zipCode: String(lead.cep || '').replace(/\D/g, ''),
              street: lead.endereco,
              number: lead.numero || 'S/N',
              complement: lead.complemento || null,
              isMain: true,
              typeAddress: 'Personal',
            },
          ]
        : undefined,
    note: `Lead BlueCard #${lead.id} · Instagram: ${lead.instagram || '—'} · Empresa: ${lead.empresa || '—'}`,
  };
  // Remove campos undefined pro JSON ficar limpo
  Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

  try {
    const r = await axios.post(`${TOTVS_BASE_URL}/person/v2/individuals`, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    });
    const personCode =
      r.data?.code || r.data?.personCode || r.data?.id || r.data?.items?.[0]?.code;
    if (!personCode) {
      console.warn('[bluecard/totvs] create OK mas sem personCode:', JSON.stringify(r.data).slice(0, 300));
      return { ok: false, error: 'TOTVS criou mas não retornou personCode' };
    }
    return { ok: true, personCode: Number(personCode), created: true };
  } catch (e) {
    const msg = e?.response?.data?.message || e?.response?.data?.title || e.message;
    console.error('[bluecard/totvs] create falhou:', msg, e?.response?.data);
    return { ok: false, error: String(msg).slice(0, 500) };
  }
}

// ─────────────────────────────────────────────────────────────────────
router.patch('/leads/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'id inválido' });

  const allowed = [
    'status',
    'observacao',
    'contatado_em',
    'convertido_em',
    'totvs_person_code',
    'totvs_synced_at',
    'totvs_sync_error',
  ];
  const patch = {};
  for (const k of allowed) {
    if (k in req.body) patch[k] = req.body[k];
  }
  // Auto-stamps em status críticos do pipeline ClickUp
  const STATUS_CONTATO = ['1_msg_enviada', 'info_completas']; // primeiros contatos
  const STATUS_CONVERSAO = ['credito_utilizado', 'revisado']; // conversão final
  if (req.body.status && STATUS_CONTATO.includes(req.body.status) && !patch.contatado_em) {
    patch.contatado_em = new Date().toISOString();
  }
  if (req.body.status && STATUS_CONVERSAO.includes(req.body.status) && !patch.convertido_em) {
    patch.convertido_em = new Date().toISOString();
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'Nenhum campo válido' });
  }
  const { data, error } = await supabase
    .from('bluecard_leads')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });

  // 🔹 Automação TOTVS: se o status virou 'info_completas' e ainda não tem
  // personCode, cadastra a pessoa no TOTVS e salva o código. NÃO bloqueia
  // a resposta — atualiza em background pra UI continuar fluida.
  let totvsResult = null;
  if (
    req.body.status === 'info_completas' &&
    !data.totvs_person_code
  ) {
    totvsResult = await cadastrarLeadNoTotvs(data);
    const upd = totvsResult.ok
      ? {
          totvs_person_code: totvsResult.personCode,
          totvs_synced_at: new Date().toISOString(),
          totvs_sync_error: null,
        }
      : {
          totvs_sync_error: totvsResult.error,
          totvs_synced_at: new Date().toISOString(),
        };
    const r2 = await supabase
      .from('bluecard_leads')
      .update(upd)
      .eq('id', id)
      .select()
      .single();
    if (!r2.error && r2.data) return res.json({ ok: true, lead: r2.data, totvs: totvsResult });
  }
  return res.json({ ok: true, lead: data, totvs: totvsResult });
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/bluecard/leads/:id/sync-totvs — força sync manual com TOTVS
//   (útil pra retry quando a automação falha)
// ─────────────────────────────────────────────────────────────────────
router.post('/leads/:id/sync-totvs', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'id inválido' });
  const { data: lead, error: e1 } = await supabase
    .from('bluecard_leads')
    .select('*')
    .eq('id', id)
    .single();
  if (e1 || !lead) return res.status(404).json({ error: 'lead não encontrado' });
  const r = await cadastrarLeadNoTotvs(lead);
  const upd = r.ok
    ? {
        totvs_person_code: r.personCode,
        totvs_synced_at: new Date().toISOString(),
        totvs_sync_error: null,
      }
    : {
        totvs_sync_error: r.error,
        totvs_synced_at: new Date().toISOString(),
      };
  const r2 = await supabase
    .from('bluecard_leads')
    .update(upd)
    .eq('id', id)
    .select()
    .single();
  return res.json({ ok: r.ok, lead: r2.data, totvs: r });
});

// ─────────────────────────────────────────────────────────────────────
// DELETE /api/bluecard/leads/:id
// ─────────────────────────────────────────────────────────────────────
router.delete('/leads/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'id inválido' });
  const { error } = await supabase.from('bluecard_leads').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true });
});

export default router;
