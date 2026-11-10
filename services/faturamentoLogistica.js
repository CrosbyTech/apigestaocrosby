// ============================================================================
// MINUTA DO FATURAMENTO DA EXPEDIÇÃO — o HeadCoach PEDE a minuta ao robô do
// Dryland (decisão do Yago, 10/11/2026), do mesmo jeito que o botão da tela
// /frete: grava no card da fila `minuta_solicitada` (correios | latam | azul).
// Quem chama Correios / LATAM / Azul são os robôs de lá (faturamento_watcher,
// _latam_eminuta_watcher, _azul_awb_watcher), a cada 5–10 min. Eles pegam a
// chave da nota no card (nf_chave) e o XML em /api/totvs/xml-contents/<chave>,
// que para nota emitida pelo HeadCoach é servido daqui mesmo.
// O resultado volta no próprio card (etiqueta_path, correios_objeto, latam_awb,
// azul_awb, …_erro) e o HeadCoach só lê.
// BEE, Baraúnas e taxistas não têm minuta em lugar nenhum.
// ============================================================================
import supabase from '../config/supabase.js';
import { agoraDryland, ehCardDaFila, editarCardDryland, lerCardDryland, lerCardsDryland, urlArquivoDryland, esquecerCacheCards } from './drylandCard.js';
import { gravarNotaNoCard, temBoleto, duplicatasDasVendas } from './faturamentoDuplicata.js';

export class MinutaError extends Error {
  constructor(message, code = 'MINUTA_ERROR', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const TIPOS = ['correios', 'latam', 'azul'];
const num = (v) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
};

// O que a tela mostra da minuta, lido do card do Dryland
export function minutaDoCard(card) {
  const d = card?.dados || {};
  if (!card) return null;
  return {
    transportadora: d.transportadora || null,
    solicitada: d.minuta_solicitada || null,
    servicoCorreios: d.envio_correios || null,
    // Correios
    etiquetaUrl: urlArquivoDryland(d.etiqueta_path),
    correiosObjeto: d.correios_objeto || null,
    etiquetaErro: d.etiqueta_erro || null,
    // LATAM
    latamAwb: d.latam_awb || null,
    latamErro: d.latam_erro || null,
    latamSemEntrega: !!d.latam_sem_entrega,
    // Azul
    azulAwb: d.azul_awb || null,
    azulPdfUrl: urlArquivoDryland(d.azul_pdf_path),
    azulErro: d.azul_erro || null,
    // rastreio
    rastreioStatus: d.rastreio_status || null,
    rastreioEvento: d.rastreio_evento || null,
    entregue: !!d.rastreio_entregue,
    // nota no card e trava da duplicata, como o Dryland vê
    nfNoCard: d.nf_chave || null,
    nfNumeroNoCard: d.nf_numero || null,
    nfDoHeadcoach: !!d.nf_headcoach,
    duplicataDoHeadcoach: !!d.duplicata_headcoach,
    duplicataAssinadaEm: d.duplicata_assinada_em || null,
    dimensoes: { altura: d.altura || null, largura: d.largura || null, comprimento: d.comprimento || null },
    statusCard: card.status || null,
  };
}

/** Pede a minuta ao robô do Dryland. */
export async function pedirMinuta(vendaId, { tipo, servico, altura, largura, comprimento, por = null } = {}) {
  const t = String(tipo || '').toLowerCase();
  if (!TIPOS.includes(t)) throw new MinutaError('Minuta só existe para Correios, LATAM e Azul');
  const { data: venda } = await supabase.from('pdv_vendas').select('*').eq('id', vendaId).maybeSingle();
  if (!venda) throw new MinutaError('Venda não encontrada', 'NOT_FOUND', 404);
  const [{ data: notas }, { data: pagamentos }, { data: fat }] = await Promise.all([
    supabase.from('pdv_notas_fiscais').select('id, numero, serie, chave, status').eq('venda_id', vendaId).order('id', { ascending: false }),
    supabase.from('pdv_venda_pagamentos').select('forma, valor').eq('venda_id', vendaId),
    supabase.from('pedidos_venda_faturamentos').select('id, chave, numero_site').eq('venda_id', vendaId).maybeSingle(),
  ]);
  const nota = (notas || []).find((n) => n.status === 'autorizada');
  if (!nota) throw new MinutaError('A NF-e desta venda não está autorizada', 'SEM_NOTA');
  if (String(nota.chave || '').replace(/\D/g, '').length !== 44) throw new MinutaError('A nota está sem a chave de 44 dígitos', 'SEM_CHAVE');
  if (!fat?.chave || !ehCardDaFila(fat.chave)) throw new MinutaError('Este pedido não tem card na fila de faturamento do Dryland, que é por onde o robô emite a minuta', 'SEM_CARD');
  const card = await lerCardDryland(fat.chave, { forcar: true });
  if (!card) throw new MinutaError('Não achei o card deste pedido na fila do Dryland', 'SEM_CARD');
  const d = card.dados || {};
  if (d.nf_chave && String(d.nf_chave) !== String(nota.chave) && !d.nf_headcoach) {
    throw new MinutaError(`O card do Dryland já tem a NF ${d.nf_numero || '?'}, emitida fora do HeadCoach — este pedido já tinha sido faturado. Não peço minuta com duas notas no mesmo pedido.`, 'NOTA_DIFERENTE', 409);
  }

  // mesma trava da tela /frete: boleto só sai com a duplicata assinada
  if (temBoleto(venda, pagamentos)) {
    const dup = (await duplicatasDasVendas([vendaId])).get(vendaId);
    if (dup?.status !== 'assinada' && !d.duplicata_assinada_em) {
      throw new MinutaError('Pagamento em boleto: a minuta só é liberada depois que o cliente assinar a duplicata', 'DUPLICATA_PENDENTE');
    }
  }
  if (t === 'correios' && d.etiqueta_path) throw new MinutaError(`Este pedido já tem etiqueta dos Correios (${d.correios_objeto || 'emitida'})`, 'JA_EMITIDA');
  if (t === 'latam' && d.latam_awb) throw new MinutaError(`Este pedido já tem minuta da LATAM (AWB ${d.latam_awb})`, 'JA_EMITIDA');
  if (t === 'azul' && d.azul_awb) throw new MinutaError(`Este pedido já tem minuta da Azul (AWB ${d.azul_awb})`, 'JA_EMITIDA');

  const quem = `HeadCoach${por ? ` (${por})` : ''}`;
  // a nota precisa estar no card: é pela nf_chave que o robô acha o XML
  if (String(d.nf_chave || '') !== String(nota.chave)) await gravarNotaNoCard({ venda, nota, fat }, {}, quem);

  const pedido = { minuta_solicitada: t, minuta_solicitada_em: agoraDryland() };
  if (t === 'correios') {
    const s = String(servico || '').toUpperCase();
    if (!['PAC', 'SEDEX'].includes(s)) throw new MinutaError('Escolha PAC ou SEDEX');
    Object.assign(pedido, { envio_correios: s, etiqueta_erro: null });
  }
  if (t === 'latam') {
    const dims = { altura: num(altura) || num(d.altura), largura: num(largura) || num(d.largura), comprimento: num(comprimento) || num(d.comprimento) };
    if (!dims.altura || !dims.largura || !dims.comprimento) throw new MinutaError('A LATAM exige altura, largura e comprimento da caixa (cm)', 'SEM_DIMENSOES');
    Object.assign(pedido, { latam_erro: null, altura: String(dims.altura), largura: String(dims.largura), comprimento: String(dims.comprimento) });
  }
  if (t === 'azul') Object.assign(pedido, { azul_erro: null });

  await editarCardDryland(fat.chave, pedido, quem);
  esquecerCacheCards();
  console.log(`📦 [minuta] venda ${vendaId} NF ${nota.numero}: minuta ${t}${pedido.envio_correios ? ` ${pedido.envio_correios}` : ''} pedida ao robô do Dryland por ${quem}`);
  return { pedida: true, tipo: t, servico: pedido.envio_correios || null };
}

/** Minuta (lida do card do Dryland) e duplicata de cada faturamento da lista. */
export async function logisticaDosFaturamentos(lista) {
  const vendaIds = lista.map((f) => f.venda_id).filter(Boolean);
  const [dups, cards] = await Promise.all([
    duplicatasDasVendas(vendaIds).catch(() => new Map()),
    lista.some((f) => ehCardDaFila(f.chave)) ? lerCardsDryland().catch(() => null) : Promise.resolve([]),
  ]);
  const cardPor = new Map((cards || []).map((c) => [c.id, c]));
  return lista.map((f) => {
    const card = cardPor.get(f.chave) || null;
    return {
      ...f,
      temCard: ehCardDaFila(f.chave),
      drylandIndisponivel: cards === null,
      minuta: minutaDoCard(card),
      duplicata: dups.get(f.venda_id) || null,
    };
  });
}
