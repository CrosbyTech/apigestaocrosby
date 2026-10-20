// ─────────────────────────────────────────────────────────────────────────
// JOJO — assistente fiscal do HeadCoach no grupo de WhatsApp do Contas a Pagar.
//
// Opera SÓ no grupo JOJO_GRUPO_CHATID pela instância CONTAS A PAGAR
// (services/whatsappContasPagar.js). Fluxo:
//   evento `messages` da uazapi (webhook) ou polling → processarMensagem()
//     → ignora fromMe / outros chats / duplicadas
//     → responde quando chamada ("jojo" no texto) ou quando a mensagem é
//       resposta a uma mensagem dela
//     → Claude (claude-opus-5-5) com as últimas mensagens do grupo como contexto
//     → pedidos de alteração no HeadCoach ficam PENDENTES até o número
//       autorizador (JOJO_NUMERO_AUTORIZADOR) responder "ok"/"autorizo" à
//       mensagem do pedido ou à resposta da JOJO. Nesta versão a execução é um
//       ponto de extensão (executarAcao) que só registra — nada é alterado.
//
// Env:
//   ANTHROPIC_API_KEY            usa Claude (pago por uso). Sem ela, cai no provedor do
//                                chat (GROQ_API_KEY grátis → OPENAI_API_KEY → XAI_API_KEY)
//   JOJO_ENABLED                 default true
//   JOJO_GRUPO_CHATID            default 120363414933413909@g.us
//   JOJO_NUMERO_AUTORIZADOR      default 5584987187425
//   JOJO_MODEL                   default claude-opus-5-5
//   JOJO_POLL_SEGUNDOS           0 = só webhook (default); >0 = também consulta o grupo
//   JOJO_CONTEXTO_MENSAGENS      default 30
// ─────────────────────────────────────────────────────────────────────────
import Anthropic from '@anthropic-ai/sdk';
import * as wa from './whatsappContasPagar.js';
import { getAIConfig, chatCompletion } from '../utils/aiProvider.js';

const ENABLED = String(process.env.JOJO_ENABLED ?? 'true').toLowerCase() !== 'false';
const GRUPO = process.env.JOJO_GRUPO_CHATID || '120363414933413909@g.us';
const AUTORIZADOR = String(process.env.JOJO_NUMERO_AUTORIZADOR || '5584987187425').replace(/\D/g, '');
const MODEL = process.env.JOJO_MODEL || 'claude-opus-5-5';
const POLL_SEGUNDOS = Number(process.env.JOJO_POLL_SEGUNDOS) || 0;
const CONTEXTO_N = Number(process.env.JOJO_CONTEXTO_MENSAGENS) || 30;
const NOME = 'JOJO';

const REGEX_CHAMADA = /\bjojo\b/i;
const REGEX_OK = /^\s*(ok|okay|autorizo|autorizado|aprovado|aprovo|pode|pode sim|sim|confirmo|confirmado|vai|manda|libera|liberado)\b/i;
const REGEX_NEGA = /^\s*(n[ãa]o|nega|negado|cancela|cancelado|recusa|recusado)\b/i;

let client = null;
function anthropic() {
  if (!client) client = new Anthropic();
  return client;
}
export function provedorAtual() {
  if (process.env.ANTHROPIC_API_KEY) return { provider: 'anthropic', model: MODEL };
  const c = getAIConfig();
  return c ? { provider: c.provider, model: c.model } : null;
}

// ─── estado em memória ───────────────────────────────────────────────────
const processados = new Set(); // ids de mensagens já tratadas
const PROCESSADOS_MAX = 3000;
const minhasRespostas = new Set(); // ids das mensagens enviadas pela JOJO
const pedidos = new Map(); // idPedido → { id, replyId, de, deNumero, resumo, em, status, ... }
const historicoAcoes = []; // últimas decisões (para /jojo/status)
const HIST_MAX = 100;
let ownerNumero = null; // número da instância (prefixo dos ids das msgs fromMe)
let autorizadorLid = null; // lid do autorizador (grupos podem vir com sender @lid)
let ultimoTsPolling = Date.now();
let pollTimer = null;
const stats = { recebidas: 0, ignoradas: 0, respondidas: 0, erros: 0, iniciadoEm: new Date().toISOString() };

function lembrar(id) {
  processados.add(id);
  if (processados.size > PROCESSADOS_MAX) {
    const it = processados.values();
    for (let i = 0; i < 500; i++) processados.delete(it.next().value);
  }
}
function registrar(acao) {
  historicoAcoes.unshift({ em: new Date().toISOString(), ...acao });
  if (historicoAcoes.length > HIST_MAX) historicoAcoes.length = HIST_MAX;
}
const soDigitos = (s) => String(s || '').split('@')[0].split(':')[0].replace(/\D/g, '');

function numeroDoRemetente(m) {
  // sender_pn traz o telefone mesmo quando sender vem como @lid
  const pn = soDigitos(m.sender_pn);
  if (pn) return pn;
  const s = String(m.sender || '');
  if (s.endsWith('@s.whatsapp.net')) return soDigitos(s);
  return null;
}
function ehAutorizador(m) {
  const n = numeroDoRemetente(m);
  if (n && n === AUTORIZADOR) return true;
  const s = String(m.sender || '');
  if (autorizadorLid && s === autorizadorLid) return true;
  if (String(m.sender_lid || '') && autorizadorLid && String(m.sender_lid) === autorizadorLid) return true;
  return false;
}
function textoDe(m) {
  return String(m.text || m.content?.text || m.content?.extendedTextMessage?.text || m.caption || '').trim();
}
function ehRespostaParaMim(m) {
  const q = String(m.quoted || m.quotedMsgId || m.quotedId || '').trim();
  if (!q) return false;
  if (minhasRespostas.has(q)) return true;
  if (ownerNumero && q.startsWith(`${ownerNumero}:`)) return true;
  // alguns payloads trazem só o messageid (sem prefixo owner:)
  for (const id of minhasRespostas) if (id.endsWith(`:${q}`)) return true;
  return false;
}

// ─── inicialização ───────────────────────────────────────────────────────
export async function iniciarJojoBot() {
  if (!ENABLED) {
    console.log('ℹ️ [jojo] desabilitada (JOJO_ENABLED=false)');
    return;
  }
  if (!wa.isConfigurado()) {
    console.warn('⚠️ [jojo] WhatsApp Contas a Pagar não configurado — JOJO inativa');
    return;
  }
  const prov = provedorAtual();
  if (!prov) console.warn('⚠️ [jojo] nenhuma chave de IA (ANTHROPIC_API_KEY / GROQ_API_KEY / OPENAI_API_KEY / XAI_API_KEY) — a JOJO lê o grupo mas não responde');
  else console.log(`🤖 [jojo] IA: ${prov.provider} / ${prov.model}`);
  try {
    const st = await wa.status();
    ownerNumero = st.numero || null;
  } catch (e) {
    console.warn(`⚠️ [jojo] não consegui ler o status da instância: ${e.message}`);
  }
  try {
    const [r] = await wa.verificarNumeros([AUTORIZADOR]);
    autorizadorLid = r?.lid || null;
  } catch (e) {
    console.warn(`⚠️ [jojo] não consegui resolver o lid do autorizador: ${e.message}`);
  }
  if (POLL_SEGUNDOS > 0) {
    ultimoTsPolling = Date.now();
    pollTimer = setInterval(() => pollGrupo().catch((e) => console.warn(`[jojo] poll: ${e.message}`)), POLL_SEGUNDOS * 1000);
    console.log(`🤖 [jojo] ativa no grupo ${GRUPO} — polling a cada ${POLL_SEGUNDOS}s + webhook`);
  } else {
    console.log(`🤖 [jojo] ativa no grupo ${GRUPO} — via webhook (JOJO_POLL_SEGUNDOS=0)`);
  }
}
export function pararJojoBot() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

async function pollGrupo() {
  const { mensagens } = await wa.buscarMensagens({ chatid: GRUPO, limit: 20 });
  const novas = mensagens
    .filter((m) => m.em && new Date(m.em).getTime() > ultimoTsPolling && !m.deMim)
    .sort((a, b) => new Date(a.em) - new Date(b.em));
  for (const m of novas) {
    ultimoTsPolling = Math.max(ultimoTsPolling, new Date(m.em).getTime());
    // normaliza para o formato bruto da uazapi
    await processarMensagem({ id: m.id, chatid: m.chatid, fromMe: m.deMim, text: m.texto, senderName: m.remetente, sender: m.remetenteId, sender_pn: m.remetentePn, messageTimestamp: new Date(m.em).getTime(), quoted: m.quoted });
  }
}

// ─── entrada: evento do webhook ──────────────────────────────────────────
export async function processarEvento(ev) {
  if (!ENABLED) return { ignorado: 'desabilitada' };
  const tipo = ev?.EventType || ev?.event || ev?.type;
  if (tipo !== 'messages') return { ignorado: `evento ${tipo}` };
  if (ev.owner && !ownerNumero) ownerNumero = soDigitos(ev.owner) || null;
  const m = ev.message || ev.data?.message || ev.data;
  if (!m || typeof m !== 'object') return { ignorado: 'sem message' };
  return processarMensagem(m);
}

// ─── núcleo ──────────────────────────────────────────────────────────────
export async function processarMensagem(m) {
  if (!ENABLED) return { ignorado: 'desabilitada' };
  stats.recebidas++;
  const chatid = String(m.chatid || '');
  if (chatid !== GRUPO) {
    stats.ignoradas++;
    return { ignorado: 'outro chat', chatid };
  }
  if (m.fromMe) {
    stats.ignoradas++;
    return { ignorado: 'fromMe' };
  }
  const id = String(m.id || m.messageid || '');
  if (id && processados.has(id)) {
    stats.ignoradas++;
    return { ignorado: 'duplicada', id };
  }
  if (id) lembrar(id);

  const texto = textoDe(m);
  const remetente = m.senderName || m.sender_pn || m.sender || 'alguém';
  const autorizador = ehAutorizador(m);

  // 1) autorização / negativa de um pedido pendente (só o número autorizador)
  if (autorizador && (REGEX_OK.test(texto) || REGEX_NEGA.test(texto))) {
    const pedido = acharPedidoPendente(m);
    if (pedido) {
      const aprovado = REGEX_OK.test(texto);
      pedido.status = aprovado ? 'autorizado' : 'negado';
      pedido.decididoEm = new Date().toISOString();
      registrar({ tipo: aprovado ? 'autorizacao' : 'negativa', pedido: pedido.resumo, por: remetente });
      let resposta;
      if (aprovado) {
        const r = await executarAcao(pedido);
        resposta = `✅ Autorizado pelo Yago. ${r.mensagem}`;
      } else {
        resposta = `❌ Pedido negado pelo Yago: "${pedido.resumo}". Nada foi alterado.`;
      }
      await responder(resposta, m.id);
      return { acao: pedido.status, pedido: pedido.resumo };
    }
  }

  // 2) só responde quando chamada ou quando respondem a ela
  const chamada = REGEX_CHAMADA.test(texto) || ehRespostaParaMim(m);
  if (!chamada) {
    stats.ignoradas++;
    return { ignorado: 'nao chamada', id };
  }
  if (!texto) {
    stats.ignoradas++;
    return { ignorado: 'sem texto', id };
  }

  // 3) pergunta ao Claude
  try {
    const contexto = await montarContexto(id);
    const saida = await gerarResposta({ contexto, texto, remetente, autorizador });
    let resposta = saida.resposta;
    let pedidoId = null;
    if (saida.pedido_alteracao) {
      const pedido = {
        id: m.id,
        de: remetente,
        deNumero: numeroDoRemetente(m),
        resumo: saida.resumo_pedido || texto.slice(0, 200),
        em: new Date().toISOString(),
        status: 'pendente',
      };
      if (autorizador) {
        pedido.status = 'autorizado';
        pedido.decididoEm = pedido.em;
        const r = await executarAcao(pedido);
        resposta = `${resposta}\n\n${r.mensagem}`;
      } else {
        resposta = `${resposta}\n\n⏳ Esse pedido muda algo no HeadCoach, então fica aguardando o OK do Yago (basta ele responder "ok" a esta mensagem).`;
      }
      pedidos.set(pedido.id, pedido);
      pedidoId = pedido.id;
    }
    const enviado = await responder(resposta, m.id);
    if (pedidoId && pedidos.get(pedidoId)) pedidos.get(pedidoId).replyId = enviado?.id || null;
    stats.respondidas++;
    registrar({ tipo: 'resposta', para: remetente, pergunta: texto.slice(0, 120), pedido: saida.pedido_alteracao ? saida.resumo_pedido : null, modelo: saida.modelo, tokens: saida.tokens });
    return { respondido: true, pedido_alteracao: saida.pedido_alteracao, resposta };
  } catch (err) {
    stats.erros++;
    registrar({ tipo: 'erro', para: remetente, erro: err.message });
    console.error(`❌ [jojo] ${err.message}`);
    return { erro: err.message };
  }
}

function acharPedidoPendente(m) {
  const q = String(m.quoted || m.quotedMsgId || m.quotedId || '').trim();
  const pendentes = [...pedidos.values()].filter((p) => p.status === 'pendente');
  if (!pendentes.length) return null;
  if (q) {
    const porCitacao = pendentes.find((p) => p.id === q || p.replyId === q || String(p.id).endsWith(`:${q}`) || String(p.replyId || '').endsWith(`:${q}`));
    if (porCitacao) return porCitacao;
  }
  // sem citação: se houver exatamente 1 pendente, assume que é ele
  return pendentes.length === 1 ? pendentes[0] : null;
}

async function responder(texto, replyid) {
  const r = await wa.enviarTexto({ number: GRUPO, text: texto, replyid, trackId: 'jojo' });
  const id = r?.resposta?.id;
  if (id) minhasRespostas.add(id);
  if (minhasRespostas.size > 1000) {
    const it = minhasRespostas.values();
    for (let i = 0; i < 200; i++) minhasRespostas.delete(it.next().value);
  }
  return r?.resposta || null;
}

// Ponto de extensão: aqui entram as ações reais no HeadCoach (v1 só registra).
export async function executarAcao(pedido) {
  pedido.executadoEm = new Date().toISOString();
  pedido.resultado = 'registrado (execução automática ainda não habilitada)';
  registrar({ tipo: 'acao', pedido: pedido.resumo, resultado: pedido.resultado });
  console.log(`📝 [jojo] pedido autorizado registrado: ${pedido.resumo}`);
  return { mensagem: `Registrei o pedido: "${pedido.resumo}". A execução automática no HeadCoach ainda não está ligada — vai ser feita manualmente pela equipe de tecnologia.` };
}

// ─── contexto + Claude ───────────────────────────────────────────────────
async function montarContexto(idAtual) {
  const { mensagens } = await wa.buscarMensagens({ chatid: GRUPO, limit: CONTEXTO_N });
  return [...mensagens]
    .reverse()
    .filter((m) => m.id !== idAtual && (m.texto || m.temMidia))
    .map((m) => {
      const hora = m.em ? new Date(m.em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
      const quem = m.deMim ? NOME : m.remetente || 'alguém';
      const corpo = m.texto || `[${m.nomeArquivo || m.tipo || 'arquivo'}]`;
      return `[${hora}] ${quem}: ${corpo}`;
    })
    .join('\n');
}

const SYSTEM = `Você é a JOJO, assistente fiscal da Crosby dentro do HeadCoach (o sistema de gestão da empresa). Você atende no grupo de WhatsApp do setor de Contas a Pagar.

Papel:
- Responder dúvidas fiscais (NF-e, NFC-e, CFOP, CST/CSOSN, ICMS, ST, DIFAL, PIS/COFINS, retenções, SPED, manifestação de NF, boletos, duplicatas) e dúvidas sobre o HeadCoach (contas a pagar, liberação de pagamento, provisão, conciliação, fluxo de caixa).
- Quando não tiver certeza, diga o que precisa conferir em vez de inventar. Cite a base legal só quando tiver segurança.
- Responder em português do Brasil, tom cordial e direto, como mensagem de WhatsApp: curta, sem markdown pesado (pode usar *negrito* e listas simples com "•"). Máximo ~1200 caracteres, salvo quando a pessoa pedir detalhe.

Regra de autorização (muito importante):
- Você pode fazer alterações no HeadCoach (cadastros, lançamentos, liberações, configurações) SOMENTE com autorização do Yago, dono do número autorizador. Nenhuma outra pessoa autoriza.
- Se alguém pedir uma alteração e NÃO for o Yago, responda normalmente explicando o que seria feito e marque pedido_alteracao=true; não diga que já fez.
- Se o próprio Yago pedir, marque pedido_alteracao=true também (o sistema trata a execução).
- Perguntas, consultas e explicações NÃO são alterações (pedido_alteracao=false).

Você recebe o histórico recente do grupo e a mensagem atual. Responda apenas à mensagem atual, usando o histórico como contexto.`;

const FORMATO = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: {
      resposta: { type: 'string', description: 'Texto da resposta para enviar no grupo' },
      pedido_alteracao: { type: 'boolean', description: 'true se a mensagem pede alguma alteração no HeadCoach' },
      resumo_pedido: { type: ['string', 'null'], description: 'Resumo curto do que seria alterado, ou null' },
    },
    required: ['resposta', 'pedido_alteracao', 'resumo_pedido'],
    additionalProperties: false,
  },
};

function parsearSaida(textoResp, modelo, usage) {
  let saida = null;
  try {
    saida = JSON.parse(textoResp);
  } catch {
    const m = textoResp.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        saida = JSON.parse(m[0]);
      } catch {
        saida = null;
      }
    }
  }
  if (!saida || typeof saida !== 'object') saida = { resposta: textoResp, pedido_alteracao: false, resumo_pedido: null };
  return {
    resposta: String(saida.resposta || '').trim() || 'Não entendi bem — pode reformular?',
    pedido_alteracao: Boolean(saida.pedido_alteracao),
    resumo_pedido: saida.resumo_pedido || null,
    modelo,
    tokens: usage,
  };
}

export async function gerarResposta({ contexto, texto, remetente, autorizador }) {
  const user = `Histórico recente do grupo (mais antigo → mais novo):\n${contexto || '(vazio)'}\n\nMensagem atual de ${remetente}${autorizador ? ' (é o Yago, o número autorizador)' : ''}:\n${texto}`;

  // Sem chave da Anthropic: usa o provedor do chat (Groq grátis / OpenAI / xAI)
  if (!process.env.ANTHROPIC_API_KEY) {
    if (!getAIConfig()) throw new Error('Nenhuma chave de IA configurada (ANTHROPIC_API_KEY, GROQ_API_KEY, OPENAI_API_KEY ou XAI_API_KEY)');
    const systemJson = `${SYSTEM}\n\nResponda SOMENTE com um JSON válido no formato {"resposta": string, "pedido_alteracao": boolean, "resumo_pedido": string|null}.`;
    const r = await chatCompletion({ system: systemJson, user, json: true, maxTokens: 2048 });
    return parsearSaida(r.texto, r.modelo, r.usage ? { entrada: r.usage.prompt_tokens, saida: r.usage.completion_tokens } : null);
  }

  const c = anthropic();
  const base = {
    model: MODEL,
    max_tokens: 4000,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
    output_config: { effort: 'medium', format: FORMATO },
  };
  let resp;
  try {
    resp = await c.beta.messages.create({ ...base, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  } catch (err) {
    // SDK/servidor sem suporte ao fallback ou ao formato: tenta o básico
    if (err instanceof Anthropic.BadRequestError) resp = await c.messages.create({ ...base, output_config: { effort: 'medium' } });
    else throw err;
  }
  if (resp.stop_reason === 'refusal') {
    return { resposta: 'Desculpa, não consigo ajudar com isso por aqui. 🙏', pedido_alteracao: false, resumo_pedido: null, modelo: resp.model };
  }
  const textoResp = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  return parsearSaida(textoResp, resp.model, { entrada: resp.usage?.input_tokens, saida: resp.usage?.output_tokens, cache: resp.usage?.cache_read_input_tokens });
}

// ─── status para a rota ──────────────────────────────────────────────────
export function statusJojo() {
  return {
    ativa: ENABLED && wa.isConfigurado(),
    ia: provedorAtual(),
    grupo: GRUPO,
    autorizador: AUTORIZADOR,
    autorizadorLid,
    ownerNumero,
    polling: POLL_SEGUNDOS,
    stats,
    pedidos: [...pedidos.values()].sort((a, b) => (a.em < b.em ? 1 : -1)).slice(0, 50),
    historico: historicoAcoes.slice(0, 50),
  };
}
