// Provedor de IA "OpenAI-compatible" já usado pelo chat (routes/chat.routes.js):
// ordem de prioridade Groq (grátis) → OpenAI → xAI. Compartilhado com a JOJO.
export function getAIConfig() {
  if (process.env.GROQ_API_KEY) {
    return {
      provider: 'groq',
      apiKey: process.env.GROQ_API_KEY,
      apiUrl: 'https://api.groq.com/openai/v1/chat/completions',
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      provider: 'openai',
      apiKey: process.env.OPENAI_API_KEY,
      apiUrl: 'https://api.openai.com/v1/chat/completions',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    };
  }
  if (process.env.XAI_API_KEY) {
    return {
      provider: 'xai',
      apiKey: process.env.XAI_API_KEY,
      apiUrl: 'https://api.x.ai/v1/chat/completions',
      model: process.env.XAI_MODEL || 'grok-4-latest',
    };
  }
  return null;
}

// Chat completion simples (sem streaming). Retorna o texto da primeira escolha.
export async function chatCompletion({ system, user, json = false, maxTokens = 2048, temperature = 0.3 }) {
  const cfg = getAIConfig();
  if (!cfg) throw new Error('Nenhum provedor de IA configurado (GROQ_API_KEY / OPENAI_API_KEY / XAI_API_KEY)');
  const body = {
    model: cfg.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature,
    max_tokens: maxTokens,
  };
  if (json) body.response_format = { type: 'json_object' };
  const r = await fetch(cfg.apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${cfg.provider} HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const data = await r.json();
  return { texto: data?.choices?.[0]?.message?.content || '', modelo: `${cfg.provider}/${cfg.model}`, usage: data?.usage || null };
}
