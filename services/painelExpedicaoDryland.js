// ============================================================================
// PAINEL DA EXPEDIÇÃO (cópia da aba PAINEL do /frete do Dryland) — SÓ LEITURA
// Tela: Expedição → Pedido de Venda → visão "Painel". Lê ao vivo as mesmas RPCs
// que o Dryland usa no "Gestão à Vista — Expedição":
//   fila_fat_listar(p_canal null, p_limit 500)      cards da fila (os 500 mais recentes, igual ao Dryland)
//   fila_vigia_status()                               semáforo cadastro TOTVS + IE SEFAZ por card
//   showroom_recebimento_quadro(60 dias)              "na matriz × enviados" (lado showroom)
//   frete_varejo_saida(p_dias)                        varejo + transferências × checklist de saída
//   showroom_card_a_enviar()                          showroom/pedidos a enviar
//   duplicata_fila_listar(1000)                       lista completa das duplicatas do boleto
//   expedicao_rastreio_full(p_busca)                  consulta de expedição por transação/NF/cliente
//   functions/v1/rastreio-correios                    rastreio Correios ao vivo
// Nada aqui escreve no Dryland. As contas (KPIs, barras) são feitas na tela,
// com as mesmas regras do frete.html.
// ============================================================================
import { drylandRpc, DRYLAND_URL, DRYLAND_KEY, COMPROVANTE_URL } from './pedidosVendaDryland.js';

const CACHE_MS = 60 * 1000;
const cache = new Map(); // chave → { em, valor }

async function comCache(chave, fn, forcar = false) {
  const c = cache.get(chave);
  if (!forcar && c && Date.now() - c.em < CACHE_MS) return c.valor;
  const valor = await fn();
  cache.set(chave, { em: Date.now(), valor });
  return valor;
}

// Card sem o que a tela não usa (log, pagamento bruto da Pagar.me, chave da NF…):
// a fila crua tem ~2,5 MB para 500 cards.
const OBS_MAX = 600;
export function cardEnxuto(c) {
  if (!c) return c;
  const { log, criado_por, atualizado_por, ...resto } = c;
  const d = { ...(c.dados || {}) };
  delete d.pago_info;
  delete d.nf_chave;
  if (typeof d.obs === 'string' && d.obs.length > OBS_MAX) d.obs = `${d.obs.slice(0, OBS_MAX)}…`;
  return { ...resto, dados: d };
}

const lista = (v) => (Array.isArray(v) ? v : []);
const tentar = async (nome, fn, falhas) => {
  try {
    return await fn();
  } catch (e) {
    falhas.push(`${nome}: ${e.message}`);
    return null;
  }
};

// "na matriz × enviados 30d" — cards SITE FR… da fila + quadro do showroom (kpiMatriz do Dryland)
function contarMatriz(cards, quadro) {
  const ehSiteFR = (c) => c?.canal === 'franquias' && /^SITE FR/i.test(String(c.titulo || ''));
  const txDe = (t) => String(t || '').match(/\d{5,}/g) || [];
  const d30 = Date.now() - 30 * 864e5;
  const naM = new Set();
  const env = new Set();
  for (const c of cards.filter(ehSiteFR)) {
    const k = txDe(c.titulo).join('/') || c.id;
    if (/pronto na matriz/i.test(c.status || '')) naM.add(k);
    else if (/pedido enviado/i.test(c.status || '') && new Date(c.dados?.enviado_em || c.atualizado_em || c.criado_em || 0).getTime() > d30) env.add(k);
  }
  for (const x of quadro || []) {
    const k = String(x.titulo || x.id);
    if (x.coluna === 'recebido') naM.add(k);
    else if (x.coluna === 'enviado' && new Date(x.enviado_em || x.saiu_em || 0).getTime() > d30) env.add(k);
  }
  return { naMatriz: naM.size, enviados: env.size, comShowroom: quadro != null };
}

export async function montarPainel({ diasVarejo = 15, forcar = false } = {}) {
  const dias = [7, 15, 30, 60].includes(Number(diasVarejo)) ? Number(diasVarejo) : 15;
  return comCache(
    `painel:${dias}`,
    async () => {
      const falhas = [];
      const [fila, vigia, quadro, varejo, showroom] = await Promise.all([
        tentar('fila de faturamento', () => drylandRpc('fila_fat_listar', { p_canal: null, p_status: null, p_limit: 500 }), falhas),
        tentar('vigia', () => drylandRpc('fila_vigia_status', {}), falhas),
        tentar('quadro do showroom', () => drylandRpc('showroom_recebimento_quadro', { p_dias: 60, p_de: null, p_ate: null }), falhas),
        tentar('varejo + transferências', () => drylandRpc('frete_varejo_saida', { p_dias: dias }), falhas),
        tentar('showroom a enviar', () => drylandRpc('showroom_card_a_enviar', {}), falhas),
      ]);
      if (fila == null) throw new Error(`Não consegui ler o Painel do Dryland (${falhas.join(' · ')})`);
      const cards = lista(fila).map(cardEnxuto);
      const vig = {};
      for (const v of lista(vigia)) vig[v.fila_id] = v;
      return {
        atualizadoEm: new Date().toISOString(),
        cards,
        vigia: vig,
        vigiaOk: vigia != null,
        matriz: contarMatriz(cards, quadro == null ? null : lista(quadro)),
        varejoSaida: varejo == null ? null : lista(varejo),
        diasVarejo: dias,
        // null = quadro fora do ar (o Dryland some com o card em vez de mostrar 0)
        showroom: showroom == null ? null : lista(showroom),
        arquivoBase: COMPROVANTE_URL(''),
        falhas,
      };
    },
    forcar,
  );
}

// Busca de concluídos fora dos 500 cards do painel (buscaConcluidos do Dryland)
const CONCLUIDO = (s) => /faturamento conclu|pedido faturado|pedido enviado/i.test(s || '');
export async function buscarConcluidos(q) {
  const termo = String(q || '').trim();
  if (termo.length < 2) return [];
  const r = await drylandRpc('fila_fat_listar', { p_canal: null, p_status: null, p_limit: 300, p_busca: termo });
  return lista(r).filter((c) => CONCLUIDO(c.status)).map(cardEnxuto);
}

// Lista completa das duplicatas do boleto (duplicatasPendentes do Dryland)
export async function listarDuplicatas({ forcar = false } = {}) {
  return comCache('duplicatas', async () => lista(await drylandRpc('duplicata_fila_listar', { p_limit: 1000 })).map(cardEnxuto), forcar);
}

// Consulta de expedição — rastreio por transação / NF / cliente
export async function consultarExpedicao(q) {
  const termo = String(q || '').trim();
  if (!termo) return [];
  return lista(await drylandRpc('expedicao_rastreio_full', { p_limit: 60, p_busca: termo.toLowerCase() }));
}

// Rastreio Correios ao vivo (mesma função do Dryland)
export async function rastreioCorreios(codigo) {
  const cod = String(codigo || '').toUpperCase().replace(/\s/g, '');
  if (!/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(cod)) throw new Error('Código dos Correios inválido');
  const r = await fetch(`${DRYLAND_URL}/functions/v1/rastreio-correios`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${DRYLAND_KEY}`, apikey: DRYLAND_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: cod }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `Correios HTTP ${r.status}`);
  return j;
}
