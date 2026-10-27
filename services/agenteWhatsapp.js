// ─────────────────────────────────────────────────────────────────────────
// Fábrica dos agentes de WhatsApp do HeadCoach (JOJO, BRUCE, ...).
//
// Cada agente opera SÓ no seu grupo, pela instância CONTAS A PAGAR
// (services/whatsappContasPagar.js). Fluxo comum:
//   evento `messages` da uazapi (webhook) ou polling → processarMensagem()
//     → ignora fromMe / outros chats / duplicadas
//     → responde quando chamado (nome no texto) ou quando a mensagem é
//       resposta a uma mensagem dele
//     → IA (Claude ou provedor do chat) com as últimas mensagens do grupo
//     → pedidos de alteração no HeadCoach ficam PENDENTES até o número
//       autorizador responder "ok"/"autorizo" à mensagem do pedido ou à
//       resposta do agente. executarAcao é ponto de extensão (v1 só registra).
//
// Env por agente (PREFIXO = JOJO, BRUCE, ...):
//   ANTHROPIC_API_KEY            usa Claude (pago por uso). Sem ela, cai no provedor do
//                                chat (GROQ_API_KEY grátis → OPENAI_API_KEY → XAI_API_KEY)
//   <PREFIXO>_ENABLED            default true
//   <PREFIXO>_GRUPO_CHATID       default definido pelo agente
//   <PREFIXO>_NUMERO_AUTORIZADOR default 5584987187425 (Yago)
//   <PREFIXO>_MODEL              default claude-opus-5-5
//   <PREFIXO>_POLL_SEGUNDOS      0 = só webhook (default); >0 = também consulta o grupo
//   <PREFIXO>_CONTEXTO_MENSAGENS default 30
// ─────────────────────────────────────────────────────────────────────────
import Anthropic from '@anthropic-ai/sdk';
import * as wa from './whatsappContasPagar.js';
import { getAIConfig, chatCompletion } from '../utils/aiProvider.js';

const REGEX_OK = /^\s*(ok|okay|autorizo|autorizado|aprovado|aprovo|pode|pode sim|sim|confirmo|confirmado|vai|manda|libera|liberado)\b/i;
const REGEX_NEGA = /^\s*(n[ãa]o|nega|negado|cancela|cancelado|recusa|recusado)\b/i;

let client = null;
function anthropic() {
  if (!client) client = new Anthropic();
  return client;
}

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

const soDigitos = (s) => String(s || '').split('@')[0].split(':')[0].replace(/\D/g, '');

function textoDe(m) {
  return String(m.text || m.content?.text || m.content?.extendedTextMessage?.text || m.caption || '').trim();
}
function numeroDoRemetente(m) {
  // sender_pn traz o telefone mesmo quando sender vem como @lid
  const pn = soDigitos(m.sender_pn);
  if (pn) return pn;
  const s = String(m.sender || '');
  if (s.endsWith('@s.whatsapp.net')) return soDigitos(s);
  return null;
}

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

/**
 * Cria um agente.
 * @param {object} cfg
 * @param {string} cfg.nome              nome exibido (JOJO, BRUCE)
 * @param {string} cfg.prefixoEnv        prefixo das variáveis de ambiente (JOJO, BRUCE)
 * @param {string} cfg.grupoDefault      chatid do grupo (fallback do env)
 * @param {string} cfg.system            prompt de sistema (papel do agente)
 * @param {RegExp} [cfg.regexChamada]    quando o agente é "chamado" (default: \bnome\b)
 * @param {string} [cfg.nomeAutorizador] como chamar o autorizador nas mensagens (default "Yago")
 * @param {string} [cfg.trackId]         track_id dos envios (default nome em minúsculas)
 */
export function criarAgente(cfg) {
  const NOME = cfg.nome;
  const P = cfg.prefixoEnv;
  const env = (k, d) => process.env[`${P}_${k}`] ?? d;
  const ENABLED = String(env('ENABLED', 'true')).toLowerCase() !== 'false';
  let GRUPO = env('GRUPO_CHATID', cfg.grupoDefault) || null; // pode ser resolvido pelo nome (cfg.grupoNome) no iniciar()
  const GRUPO_NOME = env('GRUPO_NOME', cfg.grupoNome) || null;
  // um ou mais números que autorizam alterações (env NUMEROS_AUTORIZADORES "a,b" ou NUMERO_AUTORIZADOR)
  const AUTORIZADORES = new Set(
    String(env('NUMEROS_AUTORIZADORES', env('NUMERO_AUTORIZADOR', (cfg.autorizadores || ['5584987187425']).join(','))))
      .split(',')
      .map((x) => x.replace(/\D/g, ''))
      .filter(Boolean),
  );
  const AUTORIZADOR = [...AUTORIZADORES][0];
  const MODEL = env('MODEL', 'claude-opus-5-5');
  const POLL_SEGUNDOS = Number(env('POLL_SEGUNDOS', cfg.pollSegundosDefault ?? 0)) || 0;
  const CONTEXTO_N = Number(env('CONTEXTO_MENSAGENS')) || 30;
  const NOME_AUT = cfg.nomeAutorizador || 'Yago';
  const TRACK_ID = cfg.trackId || NOME.toLowerCase();
  const REGEX_CHAMADA = cfg.regexChamada || new RegExp(`\\b${NOME.toLowerCase()}\\b`, 'i');
  const SYSTEM = cfg.system;
  const tag = `[${NOME.toLowerCase()}]`;

  function provedorAtual() {
    if (process.env.ANTHROPIC_API_KEY) return { provider: 'anthropic', model: MODEL };
    const c = getAIConfig();
    return c ? { provider: c.provider, model: c.model } : null;
  }

  // ─── estado em memória ─────────────────────────────────────────────────
  const processados = new Set(); // ids de mensagens já tratadas
  const PROCESSADOS_MAX = 3000;
  const minhasRespostas = new Set(); // ids das mensagens enviadas pelo agente
  const pedidos = new Map(); // idPedido → { id, replyId, de, deNumero, resumo, em, status, ... }
  const historicoAcoes = []; // últimas decisões (para /status)
  const HIST_MAX = 100;
  let ownerNumero = null; // número da instância (prefixo dos ids das msgs fromMe)
  let autorizadorLid = null; // lid do 1º autorizador (compat)
  const autorizadoresLid = new Set(); // lids de todos os autorizadores (grupos podem vir com sender @lid)
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
  function ehAutorizador(m) {
    const n = numeroDoRemetente(m);
    if (n && AUTORIZADORES.has(n)) return true;
    const s = String(m.sender || '');
    if (s && autorizadoresLid.has(s)) return true;
    const sl = String(m.sender_lid || '');
    if (sl && autorizadoresLid.has(sl)) return true;
    return false;
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

  // ─── inicialização ─────────────────────────────────────────────────────
  async function iniciar() {
    if (!ENABLED) {
      console.log(`ℹ️ ${tag} desabilitado (${P}_ENABLED=false)`);
      return;
    }
    if (!wa.isConfigurado()) {
      console.warn(`⚠️ ${tag} WhatsApp Contas a Pagar não configurado — ${NOME} inativo`);
      return;
    }
    const prov = provedorAtual();
    if (!prov) console.warn(`⚠️ ${tag} nenhuma chave de IA (ANTHROPIC_API_KEY / GROQ_API_KEY / OPENAI_API_KEY / XAI_API_KEY) — ${NOME} lê o grupo mas não responde`);
    else console.log(`🤖 ${tag} IA: ${prov.provider} / ${prov.model}`);
    try {
      const st = await wa.status();
      ownerNumero = st.numero || null;
    } catch (e) {
      console.warn(`⚠️ ${tag} não consegui ler o status da instância: ${e.message}`);
    }
    try {
      const rs = await wa.verificarNumeros([...AUTORIZADORES]);
      for (const r of rs || []) if (r?.lid) autorizadoresLid.add(String(r.lid));
      autorizadorLid = rs?.[0]?.lid || null;
    } catch (e) {
      console.warn(`⚠️ ${tag} não consegui resolver o lid do autorizador: ${e.message}`);
    }
    // grupo pelo nome (quando não há chatid fixo)
    if (!GRUPO && GRUPO_NOME) {
      try {
        const g = await wa.acharGrupoPorNome(GRUPO_NOME);
        if (g?.id) {
          GRUPO = g.id;
          agente.grupo = GRUPO;
          console.log(`🤖 ${tag} grupo "${g.nome}" → ${GRUPO}`);
        } else console.warn(`⚠️ ${tag} grupo "${GRUPO_NOME}" não encontrado na instância — ${NOME} inativo até encontrar`);
      } catch (e) {
        console.warn(`⚠️ ${tag} não consegui listar os grupos: ${e.message}`);
      }
    }
    if (POLL_SEGUNDOS > 0) {
      ultimoTsPolling = Date.now();
      pollTimer = setInterval(() => pollGrupo().catch((e) => console.warn(`${tag} poll: ${e.message}`)), POLL_SEGUNDOS * 1000);
      console.log(`🤖 ${tag} ativo no grupo ${GRUPO} — polling a cada ${POLL_SEGUNDOS}s + webhook`);
    } else {
      console.log(`🤖 ${tag} ativo no grupo ${GRUPO} — via webhook (${P}_POLL_SEGUNDOS=0)`);
    }
  }
  function parar() {
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

  // ─── entrada: evento do webhook ────────────────────────────────────────
  async function processarEvento(ev) {
    if (!ENABLED) return { ignorado: 'desabilitado' };
    const tipo = ev?.EventType || ev?.event || ev?.type;
    if (tipo !== 'messages') return { ignorado: `evento ${tipo}` };
    if (ev.owner && !ownerNumero) ownerNumero = soDigitos(ev.owner) || null;
    const m = ev.message || ev.data?.message || ev.data;
    if (!m || typeof m !== 'object') return { ignorado: 'sem message' };
    return processarMensagem(m);
  }

  // ─── núcleo ────────────────────────────────────────────────────────────
  async function processarMensagem(m) {
    if (!ENABLED) return { ignorado: 'desabilitado' };
    stats.recebidas++;
    const chatid = String(m.chatid || '');
    if (!GRUPO || chatid !== GRUPO) {
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
          const r = await agente.executarAcao(pedido);
          resposta = `✅ Autorizado pelo ${NOME_AUT}. ${r.mensagem}`;
        } else {
          resposta = `❌ Pedido negado pelo ${NOME_AUT}: "${pedido.resumo}". Nada foi alterado.`;
        }
        await responder(resposta, m.id);
        return { acao: pedido.status, pedido: pedido.resumo };
      }
    }

    // 2) só responde quando chamado ou quando respondem a ele
    const chamada = REGEX_CHAMADA.test(texto) || ehRespostaParaMim(m);
    if (!chamada) {
      stats.ignoradas++;
      return { ignorado: 'nao chamado', id };
    }
    if (!texto) {
      stats.ignoradas++;
      return { ignorado: 'sem texto', id };
    }

    // 3) pergunta à IA
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
          const r = await agente.executarAcao(pedido);
          resposta = `${resposta}\n\n${r.mensagem}`;
        } else {
          resposta = `${resposta}\n\n⏳ Esse pedido muda algo no HeadCoach, então fica aguardando o OK do ${NOME_AUT} (basta ele responder "ok" a esta mensagem).`;
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
      console.error(`❌ ${tag} ${err.message}`);
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
    const r = await wa.enviarTexto({ number: GRUPO, text: texto, replyid, trackId: TRACK_ID });
    const id = r?.resposta?.id;
    if (id) minhasRespostas.add(id);
    if (minhasRespostas.size > 1000) {
      const it = minhasRespostas.values();
      for (let i = 0; i < 200; i++) minhasRespostas.delete(it.next().value);
    }
    return r?.resposta || null;
  }

  // Envio avulso no grupo (saudação, avisos) — fica marcado como mensagem do agente.
  async function enviarNoGrupo(texto) {
    return responder(texto, undefined);
  }

  // Ponto de extensão: aqui entram as ações reais no HeadCoach (v1 só registra).
  async function executarAcaoPadrao(pedido) {
    pedido.executadoEm = new Date().toISOString();
    pedido.resultado = 'registrado (execução automática ainda não habilitada)';
    registrar({ tipo: 'acao', pedido: pedido.resumo, resultado: pedido.resultado });
    console.log(`📝 ${tag} pedido autorizado registrado: ${pedido.resumo}`);
    return { mensagem: `Registrei o pedido: "${pedido.resumo}". A execução automática no HeadCoach ainda não está ligada — vai ser feita manualmente pela equipe de tecnologia.` };
  }

  // ─── contexto + IA ─────────────────────────────────────────────────────
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

  async function gerarResposta({ contexto, texto, remetente, autorizador }) {
    // dados vivos do HeadCoach que o agente pode citar (ex.: saldos do dia) — cfg.contextoExtra()
    let extra = '';
    if (typeof cfg.contextoExtra === 'function') {
      try {
        extra = (await cfg.contextoExtra()) || '';
      } catch (e) {
        extra = `(não consegui carregar os dados do HeadCoach: ${e.message})`;
      }
    }
    const user = `${extra ? `Dados atuais do HeadCoach:\n${extra}\n\n` : ''}Histórico recente do grupo (mais antigo → mais novo):\n${contexto || '(vazio)'}\n\nMensagem atual de ${remetente}${autorizador ? ` (é ${NOME_AUT}, número autorizador)` : ''}:\n${texto}`;

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

  // ─── status para a rota ────────────────────────────────────────────────
  function status() {
    return {
      nome: NOME,
      ativo: ENABLED && wa.isConfigurado(),
      ativa: ENABLED && wa.isConfigurado(), // compat (JOJO)
      ia: provedorAtual(),
      grupo: GRUPO,
      grupoNome: GRUPO_NOME,
      autorizador: AUTORIZADOR,
      autorizadores: [...AUTORIZADORES],
      autorizadorLid,
      ownerNumero,
      polling: POLL_SEGUNDOS,
      stats,
      pedidos: [...pedidos.values()].sort((a, b) => (a.em < b.em ? 1 : -1)).slice(0, 50),
      historico: historicoAcoes.slice(0, 50),
    };
  }

  const agente = {
    nome: NOME,
    grupo: GRUPO,
    iniciar,
    parar,
    processarEvento,
    processarMensagem,
    gerarResposta,
    enviarNoGrupo,
    status,
    provedorAtual,
    // substituível: agente.executarAcao = async (pedido) => ({ mensagem })
    executarAcao: executarAcaoPadrao,
  };
  return agente;
}
