// ============================================================================
// /api/devolucao-rfid — Devolução RFID 100% no HeadCoach (Yago, 17/11/2026)
//
// A tela Devolução RFID não gera mais transação no TOTVS. O operador lê as
// peças, escolhe as notas de venda do cliente e encerra: o HeadCoach grava a
// transação, emite a NF-e de devolução e gera o CREDEV do cliente.
//
//   GET  /notas-venda?empresa=&cliente=&de=&ate=   notas de venda do cliente (TOTVS + HeadCoach)
//   POST /conferir   { empresa, clienteCode, itens[{ productCode, quantidade }], chaves[],
//                      avulsas?[{ productCode, chave, valorUnit }] }
//                    as peças lidas cabem nas notas escolhidas? valor de cada uma.
//                    avulsas = outra nota só para a peça que não coube (18/11/2026)
//   POST /encerrar   { empresa, empresaNome, cliente{code,nome,cpfCnpj}, vendedor{code,nome},
//                      operacao, itens[{ productCode, quantidade, epcs[] }], chaves[], avulsas?[],
//                      solicitacaoId?, observacao?, criadoPor? }
//                    grava a transação, emite a NF-e de devolução e gera o CREDEV
//
// Reemitir uma nota rejeitada e cancelar usam as rotas que já existem em
// /api/pdv-crosby (vendas/:id/emitir, vendas/:id/cancelar, cancelar-transacao):
// a devolução é uma pdv_vendas como as outras. Regras em services/devolucaoRfidHc.js.
// ============================================================================
import express from 'express';
import supabase from '../config/supabase.js';
import { asyncHandler, successResponse, errorResponse } from '../utils/errorHandler.js';
import { DevolucaoRfidError, OPERACOES_DEVOLUCAO, listarNotasDeVenda, conferirDevolucao, prepararTransacao } from '../services/devolucaoRfidHc.js';
import { FiscalError } from '../services/pdvFiscal.js';
import { caixaAbertoPara } from '../services/hcCaixa.js';
import { saldoDoCliente } from '../services/hcSaldosClientes.js';
import { emitirVendaPdv, registrarEpcs, carregarVenda } from './pdvCrosby.routes.js';

const router = express.Router();
const digitos = (v) => String(v || '').replace(/\D/g, '');

function responder(res, err) {
  if (err instanceof DevolucaoRfidError) return errorResponse(res, err.message, err.status, err.code, err.detalhes);
  if (err instanceof FiscalError) return errorResponse(res, err.message, 422, err.code);
  console.error('[devolução RFID]', err);
  return errorResponse(res, err?.message || 'Erro na devolução', 500, 'DEVOLUCAO_RFID');
}

router.get(
  '/operacoes',
  asyncHandler(async (_req, res) =>
    successResponse(
      res,
      Object.entries(OPERACOES_DEVOLUCAO).map(([code, label]) => ({ code: Number(code), label })),
      'Operações de devolução',
    ),
  ),
);

router.get(
  '/notas-venda',
  asyncHandler(async (req, res) => {
    try {
      const r = await listarNotasDeVenda({ empresa: req.query.empresa, cliente: req.query.cliente, de: req.query.de, ate: req.query.ate });
      return successResponse(res, r, `${r.notas.length} nota(s) de venda`);
    } catch (err) {
      return responder(res, err);
    }
  }),
);

router.post(
  '/conferir',
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    try {
      const r = await conferirDevolucao({ empresa: b.empresa, clienteCode: b.clienteCode, itens: b.itens, chaves: b.chaves, avulsas: b.avulsas });
      return successResponse(res, r, r.ok ? 'Peças conferidas nas notas escolhidas' : 'Há peça fora das notas escolhidas');
    } catch (err) {
      return responder(res, err);
    }
  }),
);

const encerrando = new Set(); // evita duplo clique no mesmo cliente/empresa

router.post(
  '/encerrar',
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const empresa = parseInt(b.empresa, 10);
    const clienteCode = parseInt(b.cliente?.code, 10);
    if (!empresa || !clienteCode) return errorResponse(res, 'Informe a empresa e o cliente', 400, 'INVALID_PAYLOAD');
    const trava = `${empresa}|${clienteCode}`;
    if (encerrando.has(trava)) return errorResponse(res, 'Já existe uma devolução deste cliente sendo encerrada: aguarde', 409, 'EM_ANDAMENTO');
    encerrando.add(trava);
    let venda = null;
    try {
      const prep = await prepararTransacao({
        empresa,
        cliente: { code: clienteCode },
        vendedor: b.vendedor,
        operacao: b.operacao,
        itens: b.itens,
        chaves: b.chaves,
        avulsas: b.avulsas,
        solicitacaoId: b.solicitacaoId || null,
      });
      // entra no caixa da empresa se houver um aberto (devolução não é venda: não exige caixa)
      const caixa = await caixaAbertoPara(empresa).catch(() => null);
      const cabecalho = {
        empresa,
        empresa_cnpj: b.empresaCnpj ? digitos(b.empresaCnpj) : null,
        empresa_nome: b.empresaNome || null,
        tipo_venda: 'troca', // entrada sem pagamento: gera CREDEV na autorização
        operacao: prep.plano.operacao,
        cliente_code: clienteCode,
        cliente_nome: b.cliente?.nome || b.cliente?.name || prep.conferencia.cliente?.nome || null,
        cliente_cpf_cnpj: digitos(b.cliente?.cpfCnpj) || prep.conferencia.cliente?.doc || null,
        vendedor_code: Number(b.vendedor.code),
        vendedor_nome: b.vendedor.nome || b.vendedor.name || null,
        qtd_pecas: prep.qtd,
        subtotal: prep.subtotal,
        desconto: prep.desconto,
        cashback_usado: 0,
        total: prep.total,
        status: 'registrada',
        nf_referenciada: prep.conferencia.chavesUsadas.join(','),
        observacao: b.observacao || null,
        criado_por: b.criadoPor || null,
        origem: 'devolucao',
        canal: 'devolucao',
        numero_site: prep.plano.solicitacaoId ? `DEV-${prep.plano.solicitacaoId}` : null,
        pedido_info: { devolucaoRfid: prep.plano },
        ...(caixa ? { caixa_id: caixa.id } : {}),
      };
      const { data: nova, error } = await supabase.from('pdv_vendas').insert(cabecalho).select().single();
      if (error) return errorResponse(res, error.message, 500, 'DB_ERROR');
      venda = nova;
      const { data: itensGravados, error: e1 } = await supabase
        .from('pdv_venda_itens')
        .insert(prep.itens.map((i) => ({ ...i, venda_id: venda.id })))
        .select();
      const { error: e2 } = await supabase.from('pdv_venda_pagamentos').insert({ venda_id: venda.id, forma: 'vale_troca', valor: prep.total, parcelas: 1 });
      if (e1 || e2) {
        await supabase.from('pdv_venda_pagamentos').delete().eq('venda_id', venda.id);
        await supabase.from('pdv_venda_itens').delete().eq('venda_id', venda.id);
        await supabase.from('pdv_vendas').delete().eq('id', venda.id);
        return errorResponse(res, (e1 || e2).message, 500, 'DB_ERROR');
      }
      await registrarEpcs({ venda, itens: itensGravados || [], tipo: 'devolucao' });
      console.log(`↩️ [devolução RFID] transação ${venda.id}: empresa ${empresa}, cliente ${clienteCode}, ${prep.qtd} pç, R$ ${prep.total.toFixed(2)}, notas ${prep.plano.notas.map((n) => n.numero).join(', ')}`);

      // emite a NF-e de devolução (autorizada → o CREDEV do cliente é gerado na hora)
      let emissao;
      try {
        emissao = await emitirVendaPdv(venda.id);
      } catch (err) {
        const atual = await carregarVenda(venda.id);
        return successResponse(
          res,
          { venda: atual, nota: atual?.notas?.[0] || null, autorizada: false, erroEmissao: err.message, credev: null, avisos: prep.conferencia.avisos },
          `Transação ${venda.id} gravada, mas a NF-e não saiu: ${err.message}`,
          201,
        );
      }
      const autorizada = emissao.status === 200;
      let credev = null;
      if (autorizada) {
        const s = await saldoDoCliente(clienteCode, empresa).catch(() => null);
        credev = { gerado: prep.total, saldo: s?.credev ?? null };
      }
      return successResponse(
        res,
        { venda: emissao.dados.venda, nota: emissao.dados.nota, emitente: emissao.dados.emitente || null, autorizada, erroEmissao: autorizada ? null : emissao.mensagem, credev, avisos: prep.conferencia.avisos },
        autorizada ? `Devolução encerrada: NF-e ${emissao.dados.nota?.numero}/${emissao.dados.nota?.serie} autorizada` : emissao.mensagem,
        201,
      );
    } catch (err) {
      return responder(res, err);
    } finally {
      encerrando.delete(trava);
    }
  }),
);

export default router;
