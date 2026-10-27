// ─────────────────────────────────────────────────────────────────────────
// CAIXA — agente de saldos e programação de pagamentos no grupo
// "CONTAS A PAGAR CROSBY OFC". Atende o CEO Fábio Ferreira (+55 84 8782-0986).
//
// O que ele faz (núcleo em services/agenteWhatsapp.js):
//  - 3x ao dia o HeadCoach manda no grupo o print dos saldos + a programação
//    da semana (services/relatorioSaldosWhatsapp.js), marcando o Fábio;
//  - responde quando chamado ("caixa") ou em resposta a ele, com os saldos e a
//    programação atuais (contextoExtra);
//  - o Fábio (e o Yago) podem pedir para INCLUIR itens na programação
//    ("caixa, adiciona Fornecedor X 1.500 vence 30/10"): o pedido é executado
//    na hora (são autorizadores) → entra em PROVISÃO na Liberação de Pagamento
//    com dados_completos.origem = 'whatsapp_ceo'. Outras pessoas: fica
//    pendente até um autorizador responder "ok".
//
// Env: CAIXA_ENABLED, CAIXA_GRUPO_CHATID (ou CAIXA_GRUPO_NOME, default
//      "CONTAS A PAGAR CROSBY OFC"), CAIXA_NUMEROS_AUTORIZADORES (default
//      Fábio + Yago), CAIXA_MODEL, CAIXA_POLL_SEGUNDOS, CAIXA_CONTEXTO_MENSAGENS
// ─────────────────────────────────────────────────────────────────────────
import Anthropic from '@anthropic-ai/sdk';
import supabase from '../config/supabase.js';
import { criarAgente } from './agenteWhatsapp.js';
import { montarDados, textoProgramacao, enviarRelatorio } from './relatorioSaldosWhatsapp.js';
import { getAIConfig, chatCompletion } from '../utils/aiProvider.js';

const FABIO = '558487820986';
const YAGO = '5584987187425';
const fmt = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtData = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
const hojeBr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

const SYSTEM = `Você é o CAIXA, assistente financeiro da Crosby dentro do HeadCoach (sistema de gestão da empresa). Você atende no grupo de WhatsApp "CONTAS A PAGAR CROSBY OFC". Seu principal interlocutor é o Fábio Ferreira, CEO da Crosby; o Yago (tecnologia) também fala com você. Trate o Fábio por "Fábio".

Você recebe, antes de cada mensagem, os DADOS ATUAIS do HeadCoach: saldo bancário total e por banco, saldo de cada conta Stone (identificada pelo final do CNPJ, ex.: "Stone 0549") com o valor disponível para antecipar, saldos da Pagar.me (disponível e a receber) e a programação da semana (títulos em previsão na Liberação de Pagamento: fornecedor, valor, vencimento). Use SEMPRE esses dados para responder; nunca invente valores. Se perguntarem algo que não está nos dados, diga o que não tem.

Papel:
- Responder sobre saldos (total, por banco, por conta Stone, antecipação, Pagar.me) e sobre a programação de pagamentos da semana.
- Incluir itens na programação quando pedirem: "adiciona/inclui/coloca <fornecedor> <valor> [vence/para <data>]". Isso é uma ALTERAÇÃO no HeadCoach (pedido_alteracao=true) e o resumo_pedido deve repetir fornecedor, valor e vencimento exatamente como o pedido. Se faltar valor ou vencimento, pergunte antes (pedido_alteracao=false). Remover ou alterar itens também é alteração.
- Responder em português do Brasil, tom cordial e direto, como mensagem de WhatsApp: curto, sem markdown pesado (pode usar *negrito* e listas com "•"). Máximo ~1200 caracteres, salvo quando pedirem detalhe.

Regra de autorização: o Fábio e o Yago são os números autorizadores — pedidos deles são executados na hora pelo sistema. Pedidos de outras pessoas ficam pendentes até um deles responder "ok". Perguntas e consultas não são alterações (pedido_alteracao=false).

Você recebe o histórico recente do grupo e a mensagem atual. Responda apenas à mensagem atual.`;

// ─── dados vivos para a IA ───────────────────────────────────────────────
async function contextoExtra() {
  const d = await montarDados();
  const linhas = [];
  linhas.push(`Saldo bancário total: ${fmt(d.total)} (capturado ${d.capturadoEm ? new Date(d.capturadoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'sem data'})`);
  linhas.push(`Por banco: ${d.bancos.map((b) => `${b.banco} ${fmt(b.valor)}`).join(' · ')}`);
  if (d.stone.length) linhas.push(`Contas Stone: ${d.stone.map((s) => `${s.rotulo} (${s.titular || ''}) ${fmt(s.saldo)}${s.antecipavel > 0 ? ` [antecipável ${fmt(s.antecipavel)}]` : ''}`).join(' · ')}`);
  if (d.antecipavel > 0) linhas.push(`Total disponível para antecipar na Stone: ${fmt(d.antecipavel)}`);
  if (d.pagarme.length) linhas.push(`Pagar.me: ${d.pagarme.map((p) => `${p.rotulo} disponível ${fmt(p.saldo)}, a receber ${fmt(p.aReceber)}`).join(' · ')}`);
  linhas.push(`Programação da semana ${fmtData(d.semana.de)} a ${fmtData(d.semana.ate)} (${d.programacao.length} títulos, ${fmt(d.totalProgramacao)}):`);
  for (const p of d.programacao.slice(0, 60)) linhas.push(`  - ${fmtData(p.vencimento)} · ${p.fornecedor} · ${fmt(p.valor)}${p.empresa ? ` · ${p.empresa}` : ''}${p.origem === 'whatsapp_ceo' ? ' · (incluído pelo WhatsApp)' : ''}`);
  linhas.push(`Hoje é ${fmtData(hojeBr())}.`);
  return linhas.join('\n');
}

// ─── extração estruturada do pedido ──────────────────────────────────────
const SCHEMA_ITENS = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: {
      acao: { type: 'string', enum: ['adicionar', 'remover', 'outro'] },
      itens: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            fornecedor: { type: 'string' },
            valor: { type: 'number', description: 'valor em reais, ex.: 1500.00' },
            vencimento: { type: ['string', 'null'], description: 'data AAAA-MM-DD ou null' },
            observacao: { type: ['string', 'null'] },
          },
          required: ['fornecedor', 'valor', 'vencimento', 'observacao'],
          additionalProperties: false,
        },
      },
    },
    required: ['acao', 'itens'],
    additionalProperties: false,
  },
};

async function extrairItens(texto) {
  const hoje = hojeBr();
  const system = `Extraia de um pedido de WhatsApp os itens de pagamento a incluir (ou remover) na programação da semana. Hoje é ${hoje} (America/Sao_Paulo). Datas: "30/10" → ${hoje.slice(0, 4)}-10-30; "amanhã", "sexta" etc. → calcule a partir de hoje; sem data → null. Valores em reais (1.500,00 → 1500). Se o texto não pede inclusão/remoção, acao = "outro" e itens = [].`;
  if (!process.env.ANTHROPIC_API_KEY) {
    if (!getAIConfig()) throw new Error('nenhuma chave de IA configurada');
    const r = await chatCompletion({ system: `${system}\nResponda SOMENTE com JSON {"acao": "adicionar|remover|outro", "itens": [{"fornecedor","valor","vencimento","observacao"}]}.`, user: texto, json: true, maxTokens: 800 });
    const m = String(r.texto || '').match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : { acao: 'outro', itens: [] };
  }
  const c = new Anthropic();
  const base = { model: process.env.CAIXA_MODEL || 'claude-sonnet-5-5', max_tokens: 1000, system, messages: [{ role: 'user', content: texto }], output_config: { effort: 'low', format: SCHEMA_ITENS } };
  let resp;
  try {
    resp = await c.messages.create(base);
  } catch (e) {
    if (e instanceof Anthropic.BadRequestError) resp = await c.messages.create({ ...base, output_config: undefined });
    else throw e;
  }
  const txt = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const m = txt.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : { acao: 'outro', itens: [] };
}

// ─── ação real: incluir / remover em PROVISÃO ────────────────────────────
async function executarAcao(pedido) {
  const texto = `${pedido.resumo || ''}`;
  let ext;
  try {
    ext = await extrairItens(texto);
  } catch (e) {
    return { mensagem: `Não consegui interpretar o pedido (${e.message}). Me manda assim: "caixa, adiciona <fornecedor> <valor> vence <dd/mm>".` };
  }
  const itens = Array.isArray(ext.itens) ? ext.itens.filter((i) => i && i.fornecedor && Number(i.valor) > 0) : [];
  if (ext.acao === 'remover') {
    const feitos = [];
    for (const it of itens) {
      const { data } = await supabase
        .from('pagamentos_liberacao')
        .select('id,nm_fornecedor,vl_duplicata,dt_vencimento,dados_completos')
        .eq('status', 'PROVISAO')
        .ilike('nm_fornecedor', `%${it.fornecedor}%`)
        .order('dt_vencimento')
        .limit(5);
      const alvo = (data || []).find((p) => p.dados_completos?.origem === 'whatsapp_ceo' && Math.abs(Number(p.vl_duplicata) - Number(it.valor)) < 0.011) || (data || []).find((p) => p.dados_completos?.origem === 'whatsapp_ceo');
      if (!alvo) {
        feitos.push(`• ${it.fornecedor}: não achei um item incluído pelo WhatsApp com esse nome — itens da provisão automática eu não removo, peça ao financeiro.`);
        continue;
      }
      const { error } = await supabase.from('pagamentos_liberacao').update({ status: 'CANCELADO', cancelado_por: `${pedido.de} (WhatsApp)`, cancelado_em: new Date().toISOString() }).eq('id', alvo.id);
      feitos.push(error ? `• ${it.fornecedor}: erro ao remover (${error.message})` : `• ${alvo.nm_fornecedor} — ${fmt(alvo.vl_duplicata)} (${fmtData(alvo.dt_vencimento)}): removido`);
    }
    pedido.executadoEm = new Date().toISOString();
    return { mensagem: feitos.length ? `Programação atualizada:\n${feitos.join('\n')}` : 'Não identifiquei qual item remover.' };
  }
  if (ext.acao !== 'adicionar' || !itens.length) {
    return { mensagem: 'Não identifiquei fornecedor e valor para incluir. Me manda assim: "caixa, adiciona <fornecedor> <valor> vence <dd/mm>".' };
  }
  const feitos = [];
  const agora = new Date().toISOString();
  for (const it of itens) {
    const venc = it.vencimento && /^\d{4}-\d{2}-\d{2}$/.test(it.vencimento) ? it.vencimento : hojeBr();
    const row = {
      status: 'PROVISAO',
      nm_fornecedor: String(it.fornecedor).trim().slice(0, 120).toUpperCase(),
      vl_duplicata: Math.round(Number(it.valor) * 100) / 100,
      dt_vencimento: venc,
      dt_emissao: hojeBr(),
      nr_duplicata: `WA-${Date.now().toString(36).toUpperCase()}`,
      nm_empresa: 'CROSBY',
      observacao: it.observacao ? String(it.observacao).slice(0, 300) : `Incluído pelo ${pedido.de} no WhatsApp (grupo CONTAS A PAGAR CROSBY OFC)`,
      enviado_por: `${pedido.de} (WhatsApp)`,
      enviado_em: agora,
      dados_completos: { origem: 'whatsapp_ceo', incluido_por_ia: true, solicitante: pedido.de, numero: pedido.deNumero || null, mensagem: texto.slice(0, 500), em: agora },
    };
    const { data, error } = await supabase.from('pagamentos_liberacao').insert(row).select('id').single();
    feitos.push(error ? `• ${row.nm_fornecedor}: erro (${error.message})` : `• ${row.nm_fornecedor} — ${fmt(row.vl_duplicata)} · vence ${fmtData(venc)}${it.vencimento ? '' : ' (sem data no pedido: coloquei hoje)'}`);
    if (!error) console.log(`[caixa] PROVISÃO incluída ${data.id}: ${row.nm_fornecedor} ${row.vl_duplicata} ${venc}`);
  }
  pedido.executadoEm = new Date().toISOString();
  return { mensagem: `Incluído na programação (Liberação de Pagamento → previsão):\n${feitos.join('\n')}` };
}

export const caixa = criarAgente({
  nome: 'CAIXA',
  prefixoEnv: 'CAIXA',
  grupoDefault: null,
  grupoNome: 'CONTAS A PAGAR CROSBY OFC',
  autorizadores: [FABIO, YAGO],
  nomeAutorizador: 'o Fábio ou o Yago',
  regexChamada: /\bcaixa\b/i,
  trackId: 'caixa',
  system: SYSTEM,
  contextoExtra,
});
caixa.executarAcao = executarAcao;

export const iniciarCaixaBot = caixa.iniciar;
export const pararCaixaBot = caixa.parar;
export const processarEvento = caixa.processarEvento;
export const processarMensagem = caixa.processarMensagem;
export const gerarResposta = caixa.gerarResposta;
export const statusCaixa = caixa.status;
export const provedorAtual = caixa.provedorAtual;
export { enviarRelatorio, textoProgramacao };
