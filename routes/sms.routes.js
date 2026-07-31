// ============================================================
// SMS — DisparoPro (https://apihttp.disparopro.com.br)
// Proxy de envio de SMS usado pelo Call Center de cobrança.
// A chave fica em DISPAROPRO_TOKEN (env) — nunca no frontend.
//
// Endpoints DisparoPro (verificados):
//   POST /mt       → envia lote de mensagens [{numero, servico, mensagem, ...}]
//   GET  /balance  → saldo disponivel { detail: { saldo: "50,35" } }
//
// TRAVAS ANTI-SPAM (evitam bloqueio do remetente na operadora).
// Ficam aqui, e não na tela, para valerem mesmo com vários operadores
// disparando ao mesmo tempo ou com duplo-clique:
//   1. Janela de 8h às 20h, dias úteis (America/Sao_Paulo)
//   2. Teto de 3 SMS por número por dia
//   3. Cooldown de 3 dias por número — exceto prioridade URGENTE
// O log fica em sms_enviados (ver database/schema-call-center.sql).
// ============================================================
import express from 'express';
import axios from 'axios';
import supabase from '../config/supabase.js';
import {
  asyncHandler,
  successResponse,
  errorResponse,
} from '../utils/errorHandler.js';

const router = express.Router();

const DISPAROPRO_BASE = 'https://apihttp.disparopro.com.br';
// Lido por chamada (não no load do módulo): o dotenv só roda quando
// config/supabase.js é importado, e esta rota não depende dele.
const getToken = () => process.env.DISPAROPRO_TOKEN || '';

// Limite de segurança por requisição (evita disparo em massa acidental)
const MAX_LOTE = 50;
// Teto rígido de 1 SMS: acima de 160 a operadora concatena em partes e cobra
// cada parte como um SMS. A mensagem é recusada em vez de virar 2 créditos.
const MAX_CHARS = 160;

// ── Travas anti-spam ───────────────────────────────────────────────
const TETO_DIARIO = 3; // SMS por número por dia
const COOLDOWN_DIAS = 3; // dias sem novo SMS (URGENTE ignora)
const HORA_INICIO = 8;
const HORA_FIM = 20; // exclusivo: 20h já está fora
const TZ = 'America/Sao_Paulo';

const authHeaders = () => ({
  Authorization: `Bearer ${getToken()}`,
  'Content-Type': 'application/json',
});

// Normaliza para o formato aceito pela DisparoPro: 55 + DDD + numero (só dígitos)
function normalizarNumero(s) {
  const d = String(s || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return null; // tamanho inválido — melhor recusar do que disparar errado
}

// Data/hora corrente no fuso de Brasília (BRT = UTC-3, sem horário de verão
// desde 2019 — por isso o offset fixo é seguro aqui).
function agoraBrt() {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(new Date());
  const get = (t) => partes.find((p) => p.type === t)?.value;
  return {
    data: `${get('year')}-${get('month')}-${get('day')}`,
    hora: parseInt(get('hour'), 10),
    diaSemana: get('weekday'), // 'Mon'...'Sun'
  };
}

function foraDaJanela() {
  const { hora, diaSemana } = agoraBrt();
  if (['Sat', 'Sun'].includes(diaSemana)) {
    return 'Envio de SMS bloqueado em fins de semana (janela: seg a sex, 8h-20h)';
  }
  if (hora < HORA_INICIO || hora >= HORA_FIM) {
    return `Envio de SMS bloqueado fora do horário comercial (janela: 8h-20h, agora são ${hora}h)`;
  }
  return null;
}

/**
 * Consulta o histórico recente para aplicar teto diário e cooldown.
 * @param {string[]} numeros
 * @returns {Map<string, { hoje: number, ultimoEnvio: Date|null }>}
 */
async function historicoRecente(numeros) {
  const mapa = new Map(numeros.map((n) => [n, { hoje: 0, ultimoEnvio: null }]));
  if (numeros.length === 0) return mapa;

  const { data: hojeBrt } = agoraBrt();
  const inicioDoDia = new Date(`${hojeBrt}T00:00:00-03:00`);
  // Janela suficiente para as duas travas
  const desde = new Date(
    Math.min(
      inicioDoDia.getTime(),
      Date.now() - COOLDOWN_DIAS * 24 * 60 * 60 * 1000,
    ),
  );

  const { data, error } = await supabase
    .from('sms_enviados')
    .select('numero, enviado_em')
    .in('numero', numeros)
    .gte('enviado_em', desde.toISOString());

  if (error) {
    // Sem histórico não dá para garantir as travas — melhor recusar o disparo
    // do que arriscar o bloqueio do remetente na operadora.
    throw new Error(
      `Não foi possível verificar o histórico de SMS (${error.message}). ` +
        'Confira se a tabela sms_enviados existe (database/schema-call-center.sql).',
    );
  }

  (data || []).forEach((row) => {
    const reg = mapa.get(String(row.numero));
    if (!reg) return;
    const quando = new Date(row.enviado_em);
    if (quando >= inicioDoDia) reg.hoje += 1;
    if (!reg.ultimoEnvio || quando > reg.ultimoEnvio) reg.ultimoEnvio = quando;
  });

  return mapa;
}

/**
 * GET /api/sms/saldo
 * Saldo disponível na conta DisparoPro
 */
router.get(
  '/saldo',
  asyncHandler(async (req, res) => {
    if (!getToken()) {
      return errorResponse(res, 'DISPAROPRO_TOKEN não configurado', 503, 'SMS_NOT_CONFIGURED');
    }
    const { data } = await axios.get(`${DISPAROPRO_BASE}/balance`, {
      headers: authHeaders(),
      timeout: 15000,
    });
    return successResponse(res, {
      saldo: data?.detail?.saldo ?? null,
      janela: { aberta: !foraDaJanela(), motivo: foraDaJanela() },
    });
  }),
);

/**
 * POST /api/sms/enviar
 * Body: { mensagens: [{ numero, mensagem, prioridade?, cd_cliente?, parceiro_id? }] }
 * Aplica janela de horário, teto diário e cooldown antes de chamar a DisparoPro.
 */
router.post(
  '/enviar',
  asyncHandler(async (req, res) => {
    if (!getToken()) {
      return errorResponse(res, 'DISPAROPRO_TOKEN não configurado', 503, 'SMS_NOT_CONFIGURED');
    }

    // ── TRAVA 1: janela de horário ──
    const motivoJanela = foraDaJanela();
    if (motivoJanela) {
      return errorResponse(res, motivoJanela, 403, 'FORA_DA_JANELA');
    }

    const { mensagens } = req.body || {};
    if (!Array.isArray(mensagens) || mensagens.length === 0) {
      return errorResponse(res, 'Informe mensagens: [{ numero, mensagem }]', 400, 'VALIDATION_ERROR');
    }
    if (mensagens.length > MAX_LOTE) {
      return errorResponse(res, `Máximo de ${MAX_LOTE} mensagens por requisição`, 400, 'VALIDATION_ERROR');
    }

    const invalidas = [];
    const candidatas = [];

    mensagens.forEach((m, i) => {
      const numero = normalizarNumero(m.numero);
      const texto = String(m.mensagem || '').trim();
      if (!numero) {
        invalidas.push({ indice: i, numero: m.numero, motivo: 'Número inválido' });
        return;
      }
      if (!texto) {
        invalidas.push({ indice: i, numero: m.numero, motivo: 'Mensagem vazia' });
        return;
      }
      if (texto.length > MAX_CHARS) {
        invalidas.push({
          indice: i,
          numero: m.numero,
          motivo: `Mensagem com ${texto.length} caracteres (máx. ${MAX_CHARS})`,
        });
        return;
      }
      candidatas.push({
        numero,
        texto,
        prioridade: m.prioridade === 'URGENTE' ? 'URGENTE' : 'NORMAL',
        cd_cliente: m.cd_cliente != null ? String(m.cd_cliente) : null,
        parceiro_id: m.parceiro_id,
        indice: i,
      });
    });

    // ── TRAVAS 2 e 3: teto diário e cooldown ──
    const numerosUnicos = [...new Set(candidatas.map((c) => c.numero))];
    const historico = await historicoRecente(numerosUnicos);

    const bloqueadas = [];
    const aprovadas = [];
    // Conta o que já foi aprovado NESTA requisição para o teto não ser furado
    // por um lote que sozinho passe de 3 mensagens para o mesmo número.
    const usadosNoLote = new Map();

    for (const c of candidatas) {
      const reg = historico.get(c.numero) || { hoje: 0, ultimoEnvio: null };
      const jaNoLote = usadosNoLote.get(c.numero) || 0;

      if (reg.hoje + jaNoLote >= TETO_DIARIO) {
        bloqueadas.push({
          indice: c.indice,
          numero: c.numero,
          cd_cliente: c.cd_cliente,
          motivo: `Teto de ${TETO_DIARIO} SMS por dia já atingido para este número`,
          trava: 'TETO_DIARIO',
        });
        continue;
      }

      // URGENTE (boleto vencendo hoje/amanhã) ignora o cooldown de propósito:
      // senão um lembrete de 2 dias atrás impediria justamente a mensagem mais
      // importante. O teto diário continua valendo para ela.
      if (c.prioridade !== 'URGENTE' && reg.ultimoEnvio) {
        const diasDesde =
          (Date.now() - reg.ultimoEnvio.getTime()) / (24 * 60 * 60 * 1000);
        if (diasDesde < COOLDOWN_DIAS) {
          bloqueadas.push({
            indice: c.indice,
            numero: c.numero,
            cd_cliente: c.cd_cliente,
            motivo: `Cooldown de ${COOLDOWN_DIAS} dias — último SMS há ${Math.floor(diasDesde)} dia(s)`,
            trava: 'COOLDOWN',
          });
          continue;
        }
      }

      usadosNoLote.set(c.numero, jaNoLote + 1);
      aprovadas.push(c);
    }

    if (aprovadas.length === 0) {
      return errorResponse(
        res,
        'Nenhuma mensagem liberada pelas travas anti-spam',
        409,
        'BLOQUEADO_ANTISPAM',
        { bloqueadas, invalidas },
      );
    }

    const payload = aprovadas.map((c) => ({
      numero: c.numero,
      servico: 'short',
      mensagem: c.texto,
      ...(c.parceiro_id ? { parceiro_id: String(c.parceiro_id) } : {}),
      codificacao: '0',
    }));

    console.log(
      `📨 SMS DisparoPro: ${payload.length} aprovada(s), ${bloqueadas.length} bloqueada(s) por trava, ${invalidas.length} inválida(s)`,
    );

    const { data } = await axios.post(`${DISPAROPRO_BASE}/mt`, payload, {
      headers: authHeaders(),
      timeout: 30000,
      // A DisparoPro responde 200 até para conteúdo rejeitado — o detalhe vem por item
      validateStatus: (s) => s < 500,
    });

    const detalhe = Array.isArray(data?.detail) ? data.detail : [];
    // 02 = aceito/enviado, 03 = entregue; qualquer outro código é falha
    const aceito = (d) => ['02', '03'].includes(String(d.codigo_status));
    const aceitos = detalhe.filter(aceito);
    const rejeitados = detalhe.filter((d) => !aceito(d));

    // Registra só o que a operadora aceitou — rejeitado não consome o teto.
    // Cada aprovada é casada com a resposta do seu número, na ordem de envio.
    const porNumero = new Map();
    detalhe.forEach((d) => {
      const n = String(d.numero);
      if (!porNumero.has(n)) porNumero.set(n, []);
      porNumero.get(n).push(d);
    });
    const consumo = new Map();
    const paraLogar = [];
    aprovadas.forEach((c) => {
      const fila = porNumero.get(c.numero) || [];
      const idx = consumo.get(c.numero) || 0;
      consumo.set(c.numero, idx + 1);
      const det = fila[idx];
      if (det && aceito(det)) {
        paraLogar.push({
          numero: c.numero,
          cd_cliente: c.cd_cliente,
          prioridade: c.prioridade,
          mensagem: c.texto,
          codigo_status: String(det.codigo_status),
          enviado_em: new Date().toISOString(),
        });
      }
    });

    if (paraLogar.length > 0) {
      const { error: logErro } = await supabase
        .from('sms_enviados')
        .insert(paraLogar);
      if (logErro) {
        // Não derruba a resposta: o SMS já saiu. Mas avisa alto, porque sem o
        // log as travas do próximo disparo ficam cegas.
        console.error(
          '⚠️ SMS enviado mas NÃO registrado em sms_enviados:',
          logErro.message,
        );
      }
    }

    console.log(
      `📨 SMS DisparoPro: ${aceitos.length} aceito(s), ${rejeitados.length} rejeitado(s) pela operadora`,
    );

    return successResponse(res, {
      enviados: aceitos.length,
      rejeitados,
      bloqueadas,
      invalidas,
      detalhe,
    });
  }),
);

export default router;
