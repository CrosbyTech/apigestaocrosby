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
import { validarCPF, normalizarTelefone, validarCEP } from '../utils/docValidator.js';

// Single-flight: evita race condition se PATCH 'info_completas' for chamado
// 2x simultaneamente pro mesmo lead — cria 2 PFs duplicadas no TOTVS.
const TOTVS_SYNC_INFLIGHT = new Map(); // leadId → Promise

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

// ─────────────────────────────────────────────────────────────────────
// POST /api/bluecard/leads/importar — bulk import (admin)
// Recebe: { rows: [{ nome, whatsapp, email?, cpf?, empresa?, instagram?,
//                    data_nasc?, cep?, ... }, ...], status?: '1_msg_enviada' }
// Status default: '1_msg_enviada' (1ª Mensagem Enviada).
// Deduplica por CPF/whatsapp: se lead já existe, skip com report.
// Retorna: { inseridos, ignorados_duplicados, erros: [{ linha, motivo }] }
// ─────────────────────────────────────────────────────────────────────
router.post('/leads/importar', async (req, res) => {
  try {
    const b = req.body || {};
    const rows = Array.isArray(b.rows) ? b.rows : [];
    const statusPadrao = clean(b.status) || '1_msg_enviada';
    if (rows.length === 0) return res.status(400).json({ error: 'Nenhuma linha para importar' });
    if (rows.length > 2000) return res.status(400).json({ error: 'Máximo 2000 linhas por importação' });

    // 1) Levanta CPFs + whatsapps já cadastrados pra dedup
    const cpfsIn = rows.map((r) => cleanCPF(r.cpf)).filter(Boolean);
    const wppsIn = rows.map((r) => cleanPhone(r.whatsapp)).filter(Boolean);
    const cpfsExistentes = new Set();
    const wppsExistentes = new Set();
    if (cpfsIn.length > 0) {
      for (let i = 0; i < cpfsIn.length; i += 500) {
        const chunk = cpfsIn.slice(i, i + 500);
        const { data } = await supabase
          .from('bluecard_leads')
          .select('cpf')
          .in('cpf', chunk);
        for (const r of data || []) cpfsExistentes.add(r.cpf);
      }
    }
    if (wppsIn.length > 0) {
      for (let i = 0; i < wppsIn.length; i += 500) {
        const chunk = wppsIn.slice(i, i + 500);
        const { data } = await supabase
          .from('bluecard_leads')
          .select('whatsapp')
          .in('whatsapp', chunk);
        for (const r of data || []) wppsExistentes.add(r.whatsapp);
      }
    }

    // 2) Prepara rows válidas
    const toInsert = [];
    const erros = [];
    let ignoradosDuplicados = 0;
    let idx = 0;
    for (const r of rows) {
      idx += 1;
      const nome = clean(r.nome);
      const whatsapp = cleanPhone(r.whatsapp);
      const cpf = cleanCPF(r.cpf);
      const email = clean(r.email, 255)?.toLowerCase() || null;
      if (!nome) { erros.push({ linha: idx, motivo: 'nome vazio' }); continue; }
      if (!whatsapp || whatsapp.length < 10) { erros.push({ linha: idx, motivo: 'whatsapp inválido' }); continue; }
      // Dedup: existe ou já foi adicionado neste batch
      if (cpf && cpfsExistentes.has(cpf)) { ignoradosDuplicados += 1; continue; }
      if (whatsapp && wppsExistentes.has(whatsapp)) { ignoradosDuplicados += 1; continue; }
      if (cpf) cpfsExistentes.add(cpf);
      if (whatsapp) wppsExistentes.add(whatsapp);
      // Email é obrigatório na LP, mas na importação aceitamos vazio → placeholder
      const emailFinal = email && isEmail(email) ? email : `import-${Date.now()}-${idx}@bluecard.local`;
      const cvv = await gerarCVVUnico();
      const row = {
        nome,
        whatsapp,
        email: emailFinal,
        cpf: cpf || `IMPORT-${Date.now()}-${idx}`.slice(0, 14),
        empresa: clean(r.empresa),
        instagram: clean(r.instagram, 100),
        data_nasc: clean(r.data_nasc, 20),
        cidade: clean(r.cidade, 100),
        estado: clean(r.estado, 2)?.toUpperCase() || null,
        cep: clean((r.cep || '').replace(/\D/g, ''), 8),
        endereco: clean(r.endereco, 500),
        numero: clean(r.numero, 20),
        complemento: clean(r.complemento, 200),
        indicado_por: clean(r.indicado_por, 100),
        origem: clean(r.origem) || 'import',
        status: statusPadrao,
      };
      if (cvv) row.cvv = cvv;
      toInsert.push(row);
    }

    // 3) Insere em chunks de 100
    let inseridos = 0;
    for (let i = 0; i < toInsert.length; i += 100) {
      const chunk = toInsert.slice(i, i + 100);
      let { data, error } = await supabase.from('bluecard_leads').insert(chunk).select('id');
      // Retry sem cvv se coluna não existir
      if (error && /column .*cvv.* does not exist/i.test(error.message)) {
        for (const r of chunk) delete r.cvv;
        const retry = await supabase.from('bluecard_leads').insert(chunk).select('id');
        data = retry.data;
        error = retry.error;
      }
      // Retry sem cidade se coluna não existir (migration pendente)
      if (error && /column .*cidade.* does not exist/i.test(error.message)) {
        for (const r of chunk) delete r.cidade;
        const retry = await supabase.from('bluecard_leads').insert(chunk).select('id');
        data = retry.data;
        error = retry.error;
      }
      // Retry sem estado se coluna não existir (migration pendente)
      if (error && /column .*estado.* does not exist/i.test(error.message)) {
        for (const r of chunk) delete r.estado;
        const retry = await supabase.from('bluecard_leads').insert(chunk).select('id');
        data = retry.data;
        error = retry.error;
      }
      if (error) {
        console.error('[bluecard/importar] chunk falhou:', error.message);
        erros.push({ linha: `chunk ${i}-${i + chunk.length}`, motivo: error.message });
        continue;
      }
      inseridos += (data || []).length;
    }

    return res.json({
      ok: true,
      recebidos: rows.length,
      inseridos,
      ignorados_duplicados: ignoradosDuplicados,
      erros,
      status_aplicado: statusPadrao,
    });
  } catch (e) {
    console.error('[bluecard/importar]', e);
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
      `nome.ilike.%${safe}%,email.ilike.%${safe}%,cpf.ilike.%${safe}%,whatsapp.ilike.%${safe}%,empresa.ilike.%${safe}%,indicado_por.ilike.%${safe}%`,
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
  // Single-flight: se já tem chamada in-flight pro mesmo lead, aguarda ela
  if (TOTVS_SYNC_INFLIGHT.has(lead.id)) {
    return TOTVS_SYNC_INFLIGHT.get(lead.id);
  }
  const promise = (async () => {
    return await _cadastrarLeadNoTotvsInner(lead);
  })();
  TOTVS_SYNC_INFLIGHT.set(lead.id, promise);
  try {
    return await promise;
  } finally {
    TOTVS_SYNC_INFLIGHT.delete(lead.id);
  }
}

async function _cadastrarLeadNoTotvsInner(lead) {
  // Validação local de CPF (dígito verificador) — evita 400 confuso do TOTVS
  const cpfCheck = validarCPF(lead.cpf);
  if (!cpfCheck.ok) {
    return { ok: false, error: cpfCheck.error };
  }
  const cpf = cpfCheck.cpf;

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

  // 2) Cria PF nova no TOTVS via endpoint OFICIAL de customers
  // ⚠️ /person/v2/individuals (sem -customers) retorna 404 — NÃO é endpoint
  //     válido pra criar cliente PF. O correto é /individual-customers,
  //     mesma rota usada por src/pages/CadastrarCliente.jsx.
  const phoneCheck = normalizarTelefone(lead.whatsapp);
  const cepCheck = lead.cep ? validarCEP(lead.cep) : { ok: false };
  const branchInsertCode = Number(process.env.BLUECARD_BRANCH_INSERT_CODE || 1);
  // Classificação BlueCard no TOTVS:
  //   classificationTypeCode=55 → "TIPO CLIENTE VAREJO"
  //   classificationCode='1'    → "BLUE CARD" (code='8' é BlueCred — outro programa)
  // Configurável via env caso os códigos mudem (ex: BLUECARD_CLASSIFICATION_CODE='2')
  const classificationTypeCode = Number(
    process.env.BLUECARD_CLASSIFICATION_TYPE_CODE || 55,
  );
  const classificationCode = String(
    process.env.BLUECARD_CLASSIFICATION_CODE || '1',
  );
  const payload = {
    branchInsertCode,
    insertDate: new Date().toISOString(),
    name: lead.nome,
    cpf,
    classifications: [
      {
        classificationTypeCode,
        classificationCode,
      },
    ],
    emails: lead.email
      ? [{ typeCode: 1, email: lead.email, isDefault: true }]
      : undefined,
    phones: phoneCheck.ok
      ? [
          {
            typeCode: 1,
            number: phoneCheck.phone,
            isDefault: true,
          },
        ]
      : undefined,
    addresses:
      cepCheck.ok && lead.endereco
        ? [
            {
              addressType: 'Residential',
              sequence: 1,
              cep: cepCheck.cep,
              address: lead.endereco,
              number: Number(String(lead.numero || '').replace(/\D/g, '')) || undefined,
              complement: lead.complemento || undefined,
            },
          ]
        : undefined,
  };
  // Remove campos undefined pro JSON ficar limpo
  const stripUndef = (obj) => {
    if (Array.isArray(obj)) return obj.map(stripUndef);
    if (obj && typeof obj === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(obj)) {
        if (v === undefined || v === null) continue;
        out[k] = stripUndef(v);
      }
      return out;
    }
    return obj;
  };
  const cleanPayload = stripUndef(payload);

  // Retry até 3x em erros transitórios (5xx, timeout, ECONNRESET).
  // Erros 4xx NÃO retry (são problemas de dados, retry não resolve).
  const MAX_ATTEMPTS = 3;
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const r = await axios.post(
        `${TOTVS_BASE_URL}/person/v2/individual-customers`,
        cleanPayload,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          timeout: 60000,
        },
      );
      const personCode =
        r.data?.code ||
        r.data?.personCode ||
        r.data?.customerCode ||
        r.data?.id ||
        r.data?.data?.customerCode ||
        r.data?.data?.code;
      if (!personCode) {
        console.warn(
          '[bluecard/totvs] create OK mas sem personCode:',
          JSON.stringify(r.data).slice(0, 300),
        );
        return { ok: false, error: 'TOTVS criou mas não retornou personCode' };
      }
      return { ok: true, personCode: Number(personCode), created: true };
    } catch (e) {
      const status = e?.response?.status;
      const data = e?.response?.data;
      const dataMsg = Array.isArray(data) ? data[0]?.message : data?.message;
      const msg =
        dataMsg ||
        data?.title ||
        data?.detailedMessage ||
        data?.error ||
        e.message;
      lastError = String(msg).slice(0, 500);
      const isTransient = !status || status >= 500 || ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED'].includes(e.code);
      console.error(
        `[bluecard/totvs] create falhou (tentativa ${attempt}/${MAX_ATTEMPTS}) status=${status}: ${lastError}`,
      );
      if (!isTransient || attempt === MAX_ATTEMPTS) {
        return { ok: false, error: lastError };
      }
      // Backoff exponencial: 1s, 2s, 4s
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    }
  }
  return { ok: false, error: lastError };
}

// ─────────────────────────────────────────────────────────────────────
router.patch('/leads/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'id inválido' });

  // Whitelist de campos editáveis. Inclui dados pessoais (nome, contatos,
  // endereço) pra permitir corrigir typos antes do sync TOTVS.
  const allowed = [
    'status',
    'observacao',
    'contatado_em',
    'convertido_em',
    'totvs_person_code',
    'totvs_synced_at',
    'totvs_sync_error',
    // Dados do lead (editáveis pelo admin)
    'nome',
    'whatsapp',
    'email',
    'cpf',
    'empresa',
    'instagram',
    'data_nasc',
    'cep',
    'endereco',
    'numero',
    'complemento',
    'indicado_por',
    'cvv',
  ];
  const patch = {};
  for (const k of allowed) {
    if (k in req.body) {
      let val = req.body[k];
      // Normalização leve por campo
      if (typeof val === 'string') val = val.trim() || null;
      // CPF/whatsapp/CEP: só dígitos
      if (['cpf', 'whatsapp', 'cep'].includes(k) && typeof val === 'string') {
        val = val.replace(/\D/g, '') || null;
      }
      // Email lowercase
      if (k === 'email' && typeof val === 'string') {
        val = val.toLowerCase();
      }
      patch[k] = val;
    }
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
