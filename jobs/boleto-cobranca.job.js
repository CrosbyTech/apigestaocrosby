/**
 * Job: Envio automático de boletos por WhatsApp (UAzapi) — Automação Financeiro #1
 *
 * O QUE FAZ
 *   Consulta o Contas a Receber (TOTVS), seleciona FATURAS (documentType=1)
 *   NORMAIS e em aberto que vencem em D-3 (3 dias) ou D-0 (hoje), gera o PDF
 *   do boleto e envia ao cliente via WhatsApp (instância dedicada na UAzapi),
 *   com valor, emissão, vencimento e linha digitável. Se o título já estiver
 *   pago ou cancelado no momento do envio, o disparo é PULADO.
 *
 * ANTI-BANIMENTO
 *   Os disparos NÃO saem todos de uma vez. O planner enfileira cada cliente
 *   com um `scheduled_at` espaçado 2–3 min, e o worker envia no máximo 1 a cada
 *   ~2 min (MIN_GAP_MS), inclusive em recuperação após restart do servidor.
 *
 * ARQUITETURA (resiliente a restart do Render)
 *   • planejarEnvios()  — cron 09:00 seg-sex: monta a fila do dia (idempotente).
 *   • processarFila()   — cron a cada minuto (09h–21h): drena 1 item por vez.
 *   Estado 100% na tabela Supabase `automacao_boleto_envios` (ver migration).
 *
 * CONFIG (.env / Render)
 *   BOLETO_COBRANCA_ENABLED   = 'true' para ativar (default 'false')
 *   UAZAPI_BASE_URL           = host da UAzapi (ex.: https://xxx.uazapi.com)
 *   UAZAPI_COBRANCA_INSTANCE  = nome da instância dedicada (default 'cobranca')
 *   BOLETO_COBRANCA_REMETENTE = assinatura da mensagem (default 'Grupo Crosby')
 *   BOLETO_COBRANCA_TZ        = timezone (default 'America/Sao_Paulo')
 *   INTERNAL_API_BASE_URL     = base interna do backend (default http://localhost:PORT)
 */
import cron from 'node-cron';
import axios from 'axios';
import supabase from '../config/supabase.js';
import { getPool } from '../services/uazapiSync.js';

// ─── Config ──────────────────────────────────────────────────────────────────
const UAZ_BASE = process.env.UAZAPI_BASE_URL || '';
const INSTANCE = process.env.UAZAPI_COBRANCA_INSTANCE || 'cobranca';
const ENABLED =
  String(process.env.BOLETO_COBRANCA_ENABLED || 'false').toLowerCase() ===
  'true';
const REMETENTE = process.env.BOLETO_COBRANCA_REMETENTE || 'Grupo Crosby';
const TZ = process.env.BOLETO_COBRANCA_TZ || 'America/Sao_Paulo';
// TRAVA DE TESTE: se definido, TODOS os envios são redirecionados para este
// número (com o PDF e o texto reais do cliente), em vez do telefone real.
// Deixe VAZIO em produção para enviar aos clientes de verdade.
const TEST_PHONE = process.env.BOLETO_COBRANCA_TEST_PHONE || '';
const INTERNAL_API_BASE =
  process.env.INTERNAL_API_BASE_URL ||
  `http://localhost:${process.env.PORT || 4100}`;

const TABLE = 'automacao_boleto_envios';
const MIN_GAP_MS = 120_000; // 2 min mínimo entre 2 envios (anti-ban)
const GAP_MIN_S = 120; // espaçamento do agendamento: 2 min
const GAP_MAX_S = 180; // até 3 min
const MAX_TENTATIVAS = 3;
const RETRY_DELAY_MS = 5 * 60_000; // reagenda 5 min em caso de erro de envio

// ─── Helpers de data (fuso BRT) ──────────────────────────────────────────────
function ymd(d = new Date()) {
  // 'en-CA' formata como YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
function addDays(ymdStr, n) {
  const [y, m, d] = ymdStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ─── Helpers de formatação ───────────────────────────────────────────────────
function formatBRL(v) {
  const n = Number(v || 0);
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function formatDateBR(ymdOrIso) {
  if (!ymdOrIso) return '-';
  const s = String(ymdOrIso).slice(0, 10);
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return s;
  return `${d}/${m}/${y}`;
}
function normalizeBrPhone(s) {
  const d = String(s || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('55')) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

// ─── Mensagem enviada ao cliente ─────────────────────────────────────────────
function montarMensagem(row) {
  const primeiroNome = String(row.nome_cliente || 'Cliente').split(/\s+/)[0];
  const venceTxt = row.tipo === 'D-3' ? 'vence em 3 dias' : 'vence hoje';
  return [
    `Olá, ${primeiroNome}! 👋`,
    `Lembrete da sua fatura junto ao ${REMETENTE}.`,
    ``,
    `📄 Fatura: ${row.nr_fatura}`,
    `📅 Emissão: ${formatDateBR(row.dt_emissao)}`,
    `⏰ Vencimento: ${formatDateBR(row.dt_vencimento)} (${venceTxt})`,
    `💰 Valor: ${formatBRL(row.vl_fatura)}`,
    ``,
    `Segue o boleto em anexo. Pague pela linha digitável:`,
    `${row.linha_digitavel || '(disponível no PDF em anexo)'}`,
    ``,
    `✅ Se já efetuou o pagamento, por favor desconsidere esta mensagem.`,
  ].join('\n');
}

// ─── UAzapi: resolver instância e enviar documento (PDF) ─────────────────────
async function resolverInstancia() {
  const pool = getPool();
  let r = await pool.query(
    `SELECT id, name, token, status FROM instances
      WHERE LOWER(name) = LOWER($1)
      ORDER BY (status = 'connected') DESC
      LIMIT 1`,
    [INSTANCE],
  );
  if (r.rows[0]?.token) return r.rows[0];
  r = await pool.query(
    `SELECT id, name, token, status FROM instances
      WHERE LOWER(name) LIKE '%' || LOWER($1) || '%'
      ORDER BY (status = 'connected') DESC
      LIMIT 1`,
    [INSTANCE],
  );
  return r.rows[0] || null;
}

/**
 * Envia um documento (PDF em base64) via UAzapi. Tenta múltiplos formatos de
 * payload por compatibilidade entre versões da API (igual ao envio de imagem
 * já existente em forecast.routes.js).
 */
async function enviarDocumentoUazapi({
  phone,
  pdfBase64,
  fileName,
  caption,
  token,
}) {
  if (!UAZ_BASE) throw new Error('UAZAPI_BASE_URL não configurado');
  const number = normalizeBrPhone(phone);
  if (!number) throw new Error('Telefone inválido');
  const cleanB64 = String(pdfBase64 || '').replace(
    /^data:application\/pdf;base64,/,
    '',
  );
  if (!cleanB64) throw new Error('PDF vazio');

  const tries = [
    {
      url: `${UAZ_BASE}/send/media`,
      body: {
        number,
        type: 'document',
        file: cleanB64,
        docName: fileName,
        text: caption,
      },
    },
    {
      url: `${UAZ_BASE}/send/media`,
      body: {
        number,
        mediatype: 'document',
        file: `data:application/pdf;base64,${cleanB64}`,
        fileName,
        caption,
      },
    },
    {
      url: `${UAZ_BASE}/sendDocument`,
      body: { number, document: cleanB64, fileName, caption },
    },
  ];

  let lastErr;
  for (const t of tries) {
    try {
      await axios.post(t.url, t.body, {
        headers: { token, 'Content-Type': 'application/json' },
        timeout: 60_000,
        maxBodyLength: 50 * 1024 * 1024,
        maxContentLength: 50 * 1024 * 1024,
      });
      return { number, endpoint: t.url };
    } catch (err) {
      lastErr = err;
      if (err.response?.status === 404 || err.response?.status === 400) continue;
      throw err;
    }
  }
  throw lastErr || new Error('Nenhum endpoint UAzapi aceitou o documento');
}

// ─── Chamadas internas TOTVS ─────────────────────────────────────────────────
async function buscarFaturas({ dtInicio, dtFim, cdCliente, nrFatura } = {}) {
  const params = {
    dt_inicio: dtInicio,
    dt_fim: dtFim,
    modo: 'vencimento',
  };
  if (cdCliente) params.cd_cliente = cdCliente;
  if (nrFatura) params.nr_fatura = nrFatura;
  const resp = await axios.get(
    `${INTERNAL_API_BASE}/api/totvs/accounts-receivable/filter`,
    { params, timeout: 120_000 },
  );
  return resp.data?.data?.items || [];
}

async function buscarTelefones(codigos) {
  if (!codigos.length) return {};
  const resp = await axios.post(
    `${INTERNAL_API_BASE}/api/totvs/persons/batch-lookup`,
    { personCodes: codigos },
    { timeout: 60_000 },
  );
  return resp.data?.data || {};
}

async function gerarPdfBoleto(row) {
  const resp = await axios.post(
    `${INTERNAL_API_BASE}/api/totvs/bank-slip`,
    {
      branchCode: row.cd_empresa,
      customerCode: row.cd_cliente,
      receivableCode: row.nr_fatura,
      installmentNumber: row.nr_parcela,
    },
    { timeout: 0 }, // geração do boleto no TOTVS é lenta (fala com banco/CNAB)
  );
  return resp.data?.data?.base64 || null;
}

// ─── Classificação de status de uma fatura ───────────────────────────────────
function estaPaga(item) {
  const pago = Number(item.vl_pago || 0) > 0.01;
  const temLiq = !!item.dt_liq;
  return pago || temLiq;
}
function estaCancelada(item) {
  // tp_situacao: 1=Normal, 2=Devolvido, 3=Cancelado, 4=Quebrada
  return Number(item.tp_situacao) === 3;
}
function ehFatura(item) {
  return Number(item.tp_documento) === 1;
}

// Seleciona faturas elegíveis: só FATURAS (documentType=1), não pagas, não
// canceladas, e que vencem exatamente em D-0 (hoje) ou D-3 (alvoD3).
function filtrarElegiveis(faturas, hoje, alvoD3) {
  const out = [];
  for (const f of faturas) {
    if (!ehFatura(f)) continue;
    if (estaPaga(f) || estaCancelada(f)) continue;
    const venc = String(f.dt_vencimento || '').slice(0, 10);
    let tipo = null;
    if (venc === hoje) tipo = 'D-0';
    else if (venc === alvoD3) tipo = 'D-3';
    else continue;
    out.push({ f, tipo });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// PLANNER — monta a fila do dia (idempotente via UNIQUE)
// ─────────────────────────────────────────────────────────────────────────────
export async function planejarEnvios({ dryRun = false } = {}) {
  const hoje = ymd();
  const alvoD3 = addDays(hoje, 3);
  const t0 = Date.now();
  console.log(
    `📋 [boleto-cobranca] Planejando envios — hoje=${hoje}, D-3=${alvoD3}${dryRun ? ' (DRY RUN)' : ''}`,
  );

  // Busca faturas que vencem de hoje até D+3
  let faturas;
  try {
    faturas = await buscarFaturas({ dtInicio: hoje, dtFim: alvoD3 });
  } catch (err) {
    console.error(
      `❌ [boleto-cobranca] Falha ao buscar faturas: ${err.message}`,
    );
    return { ok: false, error: err.message };
  }

  // Filtra: só FATURAS (documentType=1), não pagas, não canceladas, e que
  // vencem exatamente em D-0 ou D-3.
  const selecionados = filtrarElegiveis(faturas, hoje, alvoD3);

  // Telefones (em lote) — nomes reais + celular
  const codigos = [...new Set(selecionados.map((s) => s.f.cd_cliente))];
  let pessoas = {};
  try {
    pessoas = await buscarTelefones(codigos);
  } catch (err) {
    console.warn(
      `⚠️ [boleto-cobranca] batch-lookup falhou: ${err.message} — seguindo sem telefone`,
    );
  }

  // Monta as linhas, com agendamento espaçado (2–3 min entre cada)
  let cursor = Date.now();
  const rows = selecionados.map(({ f, tipo }) => {
    const pessoa = pessoas[f.cd_cliente] || {};
    const telefone = normalizeBrPhone(pessoa.phone);
    // Em modo teste, mesmo sem telefone do cliente o item entra na fila
    // (o destino será o número de teste).
    const temDestino = !!telefone || !!TEST_PHONE;
    cursor += randInt(GAP_MIN_S, GAP_MAX_S) * 1000;
    return {
      data_ref: hoje,
      tipo,
      cd_empresa: f.cd_empresa,
      cd_cliente: f.cd_cliente,
      nome_cliente: pessoa.name || pessoa.fantasyName || f.nm_cliente || null,
      telefone,
      nr_fatura: String(f.nr_fatura ?? f.nr_fat ?? ''),
      nr_parcela: String(f.nr_parcela ?? ''),
      vl_fatura: Number(f.vl_fatura || 0),
      dt_emissao: f.dt_emissao ? String(f.dt_emissao).slice(0, 10) : null,
      dt_vencimento: f.dt_vencimento
        ? String(f.dt_vencimento).slice(0, 10)
        : null,
      linha_digitavel: f.linha_digitavel || null,
      status: temDestino ? 'pendente' : 'pulado_sem_telefone',
      erro: temDestino ? null : 'Cliente sem telefone cadastrado no TOTVS',
      scheduled_at: temDestino ? new Date(cursor).toISOString() : null,
    };
  });

  const resumo = {
    ok: true,
    hoje,
    total_faturas: faturas.length,
    selecionados: rows.length,
    d0: rows.filter((r) => r.tipo === 'D-0').length,
    d3: rows.filter((r) => r.tipo === 'D-3').length,
    sem_telefone: rows.filter((r) => r.status === 'pulado_sem_telefone').length,
    modo_teste: !!TEST_PHONE,
    test_phone: TEST_PHONE ? normalizeBrPhone(TEST_PHONE) : null,
    dryRun,
  };

  if (dryRun) {
    console.log(`🔎 [boleto-cobranca] DRY RUN:`, resumo);
    return { ...resumo, preview: rows.slice(0, 50) };
  }

  if (rows.length) {
    // upsert idempotente: se já existir a linha (mesmo dia/tipo/fatura), ignora
    const { error } = await supabase
      .from(TABLE)
      .upsert(rows, { onConflict: 'data_ref,tipo,cd_empresa,cd_cliente,nr_fatura,nr_parcela', ignoreDuplicates: true });
    if (error) {
      console.error(`❌ [boleto-cobranca] Erro ao inserir fila: ${error.message}`);
      return { ok: false, error: error.message, resumo };
    }
  }

  console.log(
    `✅ [boleto-cobranca] Fila planejada em ${Date.now() - t0}ms:`,
    resumo,
  );
  return resumo;
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTE PONTUAL — envia UM boleto agora para o número de teste (sem fila)
// Exige BOLETO_COBRANCA_TEST_PHONE definido (nunca contata cliente real).
// Não depende de BOLETO_COBRANCA_ENABLED — é um gatilho manual explícito.
// ─────────────────────────────────────────────────────────────────────────────
export async function enviarBoletoTeste() {
  if (!TEST_PHONE) {
    return {
      ok: false,
      error:
        'BOLETO_COBRANCA_TEST_PHONE não está definido. Defina o número de teste no Render antes de testar (evita enviar a clientes reais).',
    };
  }
  const destino = normalizeBrPhone(TEST_PHONE);
  if (!destino) {
    return { ok: false, error: `Número de teste inválido: "${TEST_PHONE}"` };
  }

  const hoje = ymd();
  const alvoD3 = addDays(hoje, 3);

  let faturas;
  try {
    faturas = await buscarFaturas({ dtInicio: hoje, dtFim: alvoD3 });
  } catch (err) {
    return { ok: false, error: `Falha ao buscar faturas: ${err.message}` };
  }

  const elegiveis = filtrarElegiveis(faturas, hoje, alvoD3);
  if (!elegiveis.length) {
    return { ok: false, error: 'Nenhuma fatura elegível (D-0 ou D-3) hoje.' };
  }

  // Pega a primeira fatura elegível como amostra
  const { f, tipo } = elegiveis[0];

  // Nome real do cliente (o telefone dele é ignorado — vai pro número de teste)
  let pessoa = {};
  try {
    const pessoas = await buscarTelefones([f.cd_cliente]);
    pessoa = pessoas[f.cd_cliente] || {};
  } catch {
    /* nome é opcional para o teste */
  }

  const row = {
    tipo,
    cd_empresa: f.cd_empresa,
    cd_cliente: f.cd_cliente,
    nome_cliente: pessoa.name || pessoa.fantasyName || f.nm_cliente || 'Cliente',
    nr_fatura: String(f.nr_fatura ?? f.nr_fat ?? ''),
    nr_parcela: String(f.nr_parcela ?? ''),
    vl_fatura: Number(f.vl_fatura || 0),
    dt_emissao: f.dt_emissao ? String(f.dt_emissao).slice(0, 10) : null,
    dt_vencimento: f.dt_vencimento ? String(f.dt_vencimento).slice(0, 10) : null,
    linha_digitavel: f.linha_digitavel || null,
  };

  // Instância dedicada — resolvida da tabela `instances` (Postgres UAZAPI_DB_*)
  let sender;
  try {
    sender = await resolverInstancia();
  } catch (err) {
    return {
      ok: false,
      error: `Falha ao consultar a tabela "instances" no banco da UAzapi. Confira as vars UAZAPI_DB_HOST/PORT/USER/PASSWORD/NAME no .env. Detalhe: ${err.message}`,
    };
  }
  if (!sender) {
    return {
      ok: false,
      error: `Instância "${INSTANCE}" não existe na tabela "instances". Rode POST /api/uazapi-sync/run para sincronizar, e confira UAZAPI_COBRANCA_INSTANCE.`,
    };
  }
  if (!sender.token) {
    return {
      ok: false,
      error: `Instância "${INSTANCE}" encontrada (status: ${sender.status || 'desconhecido'}) mas SEM token. Reconecte-a na UAzapi e rode o sync novamente.`,
    };
  }

  // PDF do boleto
  let pdfBase64;
  try {
    pdfBase64 = await gerarPdfBoleto(row);
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    return { ok: false, error: `Erro ao gerar boleto no TOTVS: ${msg}` };
  }
  if (!pdfBase64) {
    return { ok: false, error: 'PDF do boleto veio vazio do TOTVS.' };
  }

  // Envio
  const caption = montarMensagem(row);
  try {
    await enviarDocumentoUazapi({
      phone: destino,
      pdfBase64,
      fileName: `boleto-TESTE-${row.nr_fatura}-${row.nr_parcela}.pdf`,
      caption,
      token: sender.token,
    });
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    return { ok: false, error: `Erro no envio UAzapi: ${msg}` };
  }

  console.log(
    `🧪 [boleto-cobranca] TESTE enviado → ${destino} (amostra: ${row.nome_cliente}, fatura ${row.nr_fatura}/${row.nr_parcela})`,
  );
  return {
    ok: true,
    destino,
    instancia: sender.name,
    amostra: {
      cliente: row.nome_cliente,
      fatura: `${row.nr_fatura}/${row.nr_parcela}`,
      tipo: row.tipo,
      valor: row.vl_fatura,
      vencimento: row.dt_vencimento,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// WORKER — processa 1 item por tick, respeitando o gap mínimo
// ─────────────────────────────────────────────────────────────────────────────
let processando = false;

export async function processarFila() {
  if (!ENABLED) return;
  if (processando) return; // evita sobreposição de ticks
  processando = true;
  try {
    const hoje = ymd();

    // Guard anti-ban: se enviamos algo há menos de MIN_GAP_MS, espera.
    const { data: ultimos } = await supabase
      .from(TABLE)
      .select('enviado_em')
      .eq('status', 'enviado')
      .not('enviado_em', 'is', null)
      .order('enviado_em', { ascending: false })
      .limit(1);
    const ultimoEnvio = ultimos?.[0]?.enviado_em
      ? new Date(ultimos[0].enviado_em).getTime()
      : 0;
    if (Date.now() - ultimoEnvio < MIN_GAP_MS) return;

    // Próxima pendente já vencida (scheduled_at <= agora)
    const { data: pend, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('status', 'pendente')
      .lte('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(1);
    if (error) {
      console.error(`❌ [boleto-cobranca] Erro ao buscar fila: ${error.message}`);
      return;
    }
    const row = pend?.[0];
    if (!row) return;

    await processarUm(row, hoje);
  } catch (err) {
    console.error(`❌ [boleto-cobranca] worker: ${err.message}`);
  } finally {
    processando = false;
  }
}

async function marcar(id, patch) {
  await supabase
    .from(TABLE)
    .update({ ...patch, atualizado_em: new Date().toISOString() })
    .eq('id', id);
}

async function processarUm(row, hoje) {
  // 1) RE-CHECK no TOTVS: pago? cancelado? ainda existe?
  try {
    const venc = row.dt_vencimento || hoje;
    const itens = await buscarFaturas({
      dtInicio: venc,
      dtFim: venc,
      cdCliente: row.cd_cliente,
      nrFatura: row.nr_fatura,
    });
    const atual = itens.find(
      (i) => String(i.nr_parcela ?? '') === String(row.nr_parcela ?? ''),
    );
    if (!atual) {
      // Não veio no filtro Normal → provavelmente cancelada/removida
      await marcar(row.id, {
        status: 'pulado_cancelado',
        erro: 'Fatura não encontrada no re-check (possível cancelamento)',
      });
      console.log(`⏭️ [boleto-cobranca] #${row.id} pulado (não encontrada)`);
      return;
    }
    if (estaCancelada(atual)) {
      await marcar(row.id, { status: 'pulado_cancelado' });
      console.log(`⏭️ [boleto-cobranca] #${row.id} pulado (cancelada)`);
      return;
    }
    if (estaPaga(atual)) {
      await marcar(row.id, { status: 'pulado_pago' });
      console.log(`⏭️ [boleto-cobranca] #${row.id} pulado (já paga)`);
      return;
    }
  } catch (err) {
    console.warn(
      `⚠️ [boleto-cobranca] #${row.id} re-check falhou: ${err.message} — seguindo com envio`,
    );
  }

  // Destino: em modo teste, redireciona tudo para o número de teste.
  const destino = TEST_PHONE ? normalizeBrPhone(TEST_PHONE) : row.telefone;
  if (!destino) {
    await marcar(row.id, {
      status: 'pulado_sem_telefone',
      erro: 'Sem telefone',
    });
    return;
  }

  // 2) Resolver instância (uma vez por envio)
  let sender;
  try {
    sender = await resolverInstancia();
  } catch (err) {
    await falharOuReagendar(row, `Erro ao resolver instância: ${err.message}`);
    return;
  }
  if (!sender?.token) {
    await falharOuReagendar(
      row,
      `Instância "${INSTANCE}" não encontrada/conectada (rode o sync UAzapi)`,
    );
    return;
  }

  // 3) Gerar PDF do boleto
  let pdfBase64;
  try {
    pdfBase64 = await gerarPdfBoleto(row);
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    // TOTVS costuma recusar boleto de título já pago
    if (/pag|liquid|baix/i.test(String(msg))) {
      await marcar(row.id, { status: 'pulado_pago', erro: msg });
      return;
    }
    await falharOuReagendar(row, `Erro ao gerar boleto: ${msg}`);
    return;
  }
  if (!pdfBase64) {
    await falharOuReagendar(row, 'PDF do boleto veio vazio do TOTVS');
    return;
  }

  // 4) Enviar via UAzapi
  const caption = montarMensagem(row);
  try {
    await enviarDocumentoUazapi({
      phone: destino,
      pdfBase64,
      fileName: `boleto-${row.nr_fatura}-${row.nr_parcela}.pdf`,
      caption,
      token: sender.token,
    });
    await marcar(row.id, {
      status: 'enviado',
      enviado_em: new Date().toISOString(),
      conteudo_enviado: caption,
      redirecionado_para: TEST_PHONE ? destino : null,
      erro: null,
    });
    console.log(
      `✅ [boleto-cobranca] #${row.id} enviado → ${row.nome_cliente} ` +
        (TEST_PHONE
          ? `[TESTE → ${destino}] (cliente real: ${row.telefone || 'sem telefone'})`
          : `(${destino})`),
    );
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    await falharOuReagendar(row, `Erro no envio UAzapi: ${msg}`);
  }
}

async function falharOuReagendar(row, mensagem) {
  const tentativas = (row.tentativas || 0) + 1;
  if (tentativas >= MAX_TENTATIVAS) {
    await marcar(row.id, { status: 'falha', erro: mensagem, tentativas });
    console.error(
      `❌ [boleto-cobranca] #${row.id} FALHA definitiva (${tentativas}x): ${mensagem}`,
    );
  } else {
    await marcar(row.id, {
      status: 'pendente',
      erro: mensagem,
      tentativas,
      scheduled_at: new Date(Date.now() + RETRY_DELAY_MS).toISOString(),
    });
    console.warn(
      `🔁 [boleto-cobranca] #${row.id} reagendado (${tentativas}/${MAX_TENTATIVAS}): ${mensagem}`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENDAMENTO
// ─────────────────────────────────────────────────────────────────────────────
export function iniciarJobBoletoCobranca() {
  if (!ENABLED) {
    console.log(
      'ℹ️ [boleto-cobranca] Job DESATIVADO. Defina BOLETO_COBRANCA_ENABLED=true no .env para ativar.',
    );
    return null;
  }
  // Planner: 09:00 seg-sex
  cron.schedule('0 9 * * 1-5', () => planejarEnvios({}), { timezone: TZ });
  // Worker: a cada minuto das 09h às 21h, seg-sex (drena a fila espaçadamente)
  cron.schedule('* 9-21 * * 1-5', () => processarFila(), { timezone: TZ });
  console.log(
    `⏰ [boleto-cobranca] Agendado — planner 09:00 seg-sex, worker a cada min (09h–21h). Instância: "${INSTANCE}"`,
  );
  if (TEST_PHONE) {
    console.warn(
      `🧪 [boleto-cobranca] MODO TESTE ATIVO — todos os envios vão para ${normalizeBrPhone(TEST_PHONE)} (nenhum cliente real será contatado). Remova BOLETO_COBRANCA_TEST_PHONE para ir ao ar.`,
    );
  }
  return true;
}
