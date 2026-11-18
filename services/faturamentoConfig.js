// ============================================================================
// CONFIGURAÇÕES DO FATURAMENTO que o admin/owner muda pela tela (Yago, 18/11/2026)
// Tabela faturamento_config (migrations/faturamento_config.sql).
//
// TROCA DE PRODUTOS — troca de peça na conferência do faturamento (a que falta
// sai, a que sobra entra pelo mesmo valor do pedido). Antes era uma data fixa
// no código, que o Yago pedia para mudar a cada vez; agora o admin ou o owner
// marca "liberada" e escolhe até que dia vale. Vale enquanto liberada = true e
// hoje <= ate. Sem linha na tabela, fica bloqueada.
// ============================================================================
import supabase from '../config/supabase.js';

const CHAVE_TROCA = 'troca_produtos';
const hojeBrasil = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Recife' }).format(new Date());
const ehData = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(new Date(`${s}T12:00:00Z`).getTime());
const fmtBr = (iso) => String(iso || '').slice(0, 10).split('-').reverse().join('/');

export class ConfigFaturamentoError extends Error {
  constructor(message, code = 'CONFIG_FATURAMENTO', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
const semTabela = (error) => /faturamento_config.* does not exist|faturamento_config.* in the schema cache/i.test(String(error?.message || ''));

let cache = { em: 0, linha: null };
const TTL = 20 * 1000;

function montar(linha) {
  const v = linha?.valor || {};
  const ate = ehData(v.ate) ? String(v.ate) : null;
  const liberada = v.liberada === true && !!ate;
  const hoje = hojeBrasil();
  return {
    liberada,
    ate,
    // é o que vale de verdade: liberada e ainda dentro do prazo
    vigente: liberada && hoje <= ate,
    vencida: liberada && hoje > ate,
    hoje,
    atualizadoPor: linha?.atualizado_por || null,
    atualizadoEm: linha?.atualizado_em || null,
  };
}

/** Situação da troca de produtos no faturamento: { liberada, ate, vigente, vencida, … } */
export async function lerTrocaProdutos({ forcar = false } = {}) {
  if (!forcar && Date.now() - cache.em < TTL) return montar(cache.linha);
  const { data, error } = await supabase.from('faturamento_config').select('*').eq('chave', CHAVE_TROCA).maybeSingle();
  if (error) {
    // sem a tabela (migration pendente) a troca fica bloqueada, como sem configuração
    if (semTabela(error)) return { ...montar(null), semTabela: true };
    throw new ConfigFaturamentoError(`Configuração do faturamento: ${error.message}`, 'DB_ERROR', 500);
  }
  cache = { em: Date.now(), linha: data || null };
  return montar(cache.linha);
}

/** Mensagem para quem tenta trocar com a troca bloqueada. */
export function motivoTrocaBloqueada(t) {
  if (t.vencida) return `A troca de peças no faturamento só foi liberada até ${fmtBr(t.ate)}. Um admin ou owner pode liberar de novo na tela do Faturamento.`;
  return 'A troca de peças no faturamento não está liberada. Um admin ou owner pode liberar na tela do Faturamento.';
}

/** Admin/owner marca a troca como liberada (com a data final) ou bloqueia. */
export async function salvarTrocaProdutos(user, b = {}) {
  if (!['owner', 'admin'].includes(user?.role)) throw new ConfigFaturamentoError('Só admin ou owner libera a troca de produtos', 'SEM_PERMISSAO', 403);
  const liberada = b.liberada === true || b.liberada === 'true';
  const ate = b.ate ? String(b.ate).slice(0, 10) : null;
  if (liberada) {
    if (!ehData(ate)) throw new ConfigFaturamentoError('Informe até que dia a troca fica liberada');
    if (ate < hojeBrasil()) throw new ConfigFaturamentoError('A data final já passou: escolha hoje ou um dia adiante');
  }
  const por = user.name || user.email || null;
  // bloqueando, guarda a última data só como registro
  const valor = { liberada, ate: ehData(ate) ? ate : null };
  const linha = { chave: CHAVE_TROCA, valor, atualizado_por: por, atualizado_em: new Date().toISOString() };
  const { data, error } = await supabase.from('faturamento_config').upsert(linha, { onConflict: 'chave' }).select().single();
  if (error) {
    if (semTabela(error)) throw new ConfigFaturamentoError('Falta criar a tabela faturamento_config no banco (migrations/faturamento_config.sql)', 'MIGRATION_PENDING', 503);
    throw new ConfigFaturamentoError(error.message, 'DB_ERROR', 500);
  }
  await supabase.from('faturamento_config_historico').insert({ chave: CHAVE_TROCA, valor, por }).then(
    () => null,
    () => null,
  );
  cache = { em: Date.now(), linha: data };
  console.log(`🔁 [Faturamento] troca de produtos ${liberada ? `LIBERADA até ${fmtBr(ate)}` : 'BLOQUEADA'} por ${por}`);
  return montar(data);
}
