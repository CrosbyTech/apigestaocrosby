// ============================================================================
// CARD DA FILA DE FATURAMENTO DO DRYLAND (missao_sep.fila_fat) — leitura e as
// POUCAS gravações que o Yago liberou em 10/11/2026 para o faturamento feito no
// HeadCoach conversar com os robôs do Dryland:
//   • a nota emitida aqui (nf_numero / nf_serie / nf_chave…), que é o que os
//     robôs de minuta leem;
//   • o pedido de minuta (minuta_solicitada = correios | latam | azul), igual
//     ao botão da tela /frete — quem chama a transportadora é o robô de lá;
//   • a situação da duplicata enviada pelo HeadCoach (duplicata_link, _doc,
//     _enviada_em, _assinada_em…), para o Painel do frete liberar o envio e o
//     robô de lá cuidar dos lembretes sem mandar outra duplicata.
// Nada além desses campos é gravado. A RPC fila_fat_editar faz merge no JSON
// `dados` do card e registra `p_por` no histórico dele.
// ============================================================================
import { drylandRpc, DRYLAND_URL } from './pedidosVendaDryland.js';

// Campos que o HeadCoach pode gravar no card (qualquer outro é recusado aqui)
const CAMPOS_LIBERADOS = new Set([
  // nota emitida pelo HeadCoach
  'nf_numero', 'nf_serie', 'nf_chave', 'nf_cliente', 'nf_emitida', 'totvs_atendida_em', 'nf_headcoach', 'headcoach_venda',
  // pedido de minuta (o robô do Dryland emite)
  'minuta_solicitada', 'minuta_solicitada_em', 'envio_correios', 'etiqueta_erro', 'latam_erro', 'azul_erro', 'altura', 'largura', 'comprimento', 'peso', 'volumes',
  // duplicata enviada pelo HeadCoach
  'duplicata_link', 'duplicata_doc', 'duplicata_enviada_em', 'duplicata_zap', 'duplicata_chip', 'duplicata_erro', 'duplicata_erro_em',
  'duplicata_assinada_em', 'duplicata_assinada_detectada_em', 'duplicata_assinada_url', 'duplicata_headcoach',
]);

// O robô do Dryland é Python e lê as datas com datetime.fromisoformat: grava no
// mesmo formato do datetime.now().isoformat() dele — hora de Brasília, sem fuso.
export const agoraDryland = (quando = new Date()) => `${new Date(quando.getTime() - 3 * 3600 * 1000).toISOString().replace('Z', '')}000`;

// A chave do faturamento é o id (uuid) do card quando o pedido veio da fila
export const ehCardDaFila = (chave) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(chave || ''));

export const urlArquivoDryland = (path) => (path ? `${DRYLAND_URL}/storage/v1/object/public/missao-nfs/${String(path).replace(/^\/+/, '')}` : null);

export async function editarCardDryland(cardId, dados, por = 'HeadCoach') {
  if (!ehCardDaFila(cardId)) throw new Error('Este pedido não tem card na fila de faturamento do Dryland');
  const fora = Object.keys(dados || {}).filter((k) => !CAMPOS_LIBERADOS.has(k));
  if (fora.length) throw new Error(`Campo(s) não liberado(s) para gravar no card do Dryland: ${fora.join(', ')}`);
  return drylandRpc('fila_fat_editar', { p_id: cardId, p_dados: dados, p_por: String(por || 'HeadCoach').slice(0, 80) });
}

// Cards ao vivo (a fila devolve os mais novos); cache curto para a tela
let cache = { em: 0, cards: null };
export async function lerCardsDryland({ forcar = false } = {}) {
  if (!forcar && cache.cards && Date.now() - cache.em < 20 * 1000) return cache.cards;
  const l = await drylandRpc('fila_fat_listar', { p_canal: null, p_status: null, p_limit: 500 });
  cache = { em: Date.now(), cards: Array.isArray(l) ? l : [] };
  return cache.cards;
}
export async function lerCardDryland(cardId, { forcar = false } = {}) {
  if (!ehCardDaFila(cardId)) return null;
  return (await lerCardsDryland({ forcar })).find((c) => c.id === cardId) || null;
}
export const esquecerCacheCards = () => {
  cache = { em: 0, cards: null };
};
