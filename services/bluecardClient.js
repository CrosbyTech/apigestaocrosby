/**
 * Cliente HTTP assinado para a API do BlueCard (crediário Crosby).
 *
 * Endpoints do BlueCard que NÓS chamamos (doc "Integração completa", Parte 1):
 *   POST /api/v1/compras        — registrar venda ANTES de fechar no PDV
 *   GET  /api/v1/compras/{id}   — polling: cliente já aprovou? (usar pode_fechar_venda)
 *   POST /api/v1/faturas        — devolver os boletos gerados no TOTVS
 *   POST /api/v1/pagamentos     — avisar que o cliente pagou (devolve limite)
 *
 * Regras:
 *   - valores SEMPRE em centavos inteiros
 *   - Idempotency-Key (UUID) em todo POST — retry após timeout não duplica
 *   - corpo assinado CRU: serializa uma vez e envia exatamente esses bytes
 */
import axios from 'axios';
import { randomUUID } from 'node:crypto';
import { headersAssinados } from '../utils/bluecardHmac.js';

const BASE_URL =
  process.env.BLUECARD_BASE_URL || 'https://credit-crosby.vercel.app';

async function chamar(method, path, body = null, { idempotencyKey } = {}) {
  // Serializa UMA vez — a assinatura cobre exatamente estes bytes.
  const corpoCru = body != null ? JSON.stringify(body) : '';
  const headers = {
    ...headersAssinados(corpoCru),
    Accept: 'application/json',
  };
  if (body != null) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') {
    headers['Idempotency-Key'] = idempotencyKey || randomUUID();
  }

  try {
    const resp = await axios({
      method,
      url: `${BASE_URL}${path}`,
      // data como string pra axios não re-serializar (mudaria os bytes assinados)
      data: body != null ? corpoCru : undefined,
      headers,
      timeout: 30000,
    });
    return resp.data;
  } catch (error) {
    // Formato de erro estável do BlueCard: { erro: { codigo, mensagem, detalhe } }
    const erro = error.response?.data?.erro;
    if (erro) {
      const e = new Error(`[bluecard ${erro.codigo}] ${erro.mensagem}`);
      e.codigo = erro.codigo;
      e.detalhe = erro.detalhe;
      e.status = error.response.status;
      throw e;
    }
    throw error;
  }
}

/** Registrar a venda (ANTES de fechar no PDV). Valores em centavos. */
export function criarCompra(compra, idempotencyKey) {
  return chamar('POST', '/api/v1/compras', compra, { idempotencyKey });
}

/** Consultar aprovação — sem efeito colateral, pode fazer polling ~2s. */
export function consultarCompra(id) {
  return chamar('GET', `/api/v1/compras/${id}`);
}

/** Enviar os boletos gerados no TOTVS após fechar a venda. */
export function enviarFaturas(faturas, idempotencyKey) {
  return chamar('POST', '/api/v1/faturas', faturas, { idempotencyKey });
}

/**
 * Avisar que o cliente pagou um título — é o que devolve limite.
 * pagamento = { externo_id, pago_em, valor_pago_cents, meio }
 */
export function notificarPagamento(pagamento, idempotencyKey) {
  return chamar('POST', '/api/v1/pagamentos', pagamento, { idempotencyKey });
}
