// Rotas da integração Wix
//   POST /api/wix/webhook/cart-abandoned — recebe webhook do Wix Automations
import express from 'express';
import supabase from '../config/supabase.js';

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────
// POST /api/wix/webhook/cart-abandoned — recebe webhook do Wix Automations
// Wix dispara quando um carrinho é abandonado. Payload contém o checkout
// com cliente, items e total.
// CONFIGURAÇÃO NO WIX:
//   Dashboard → Automations → New Automation
//   Trigger: "Cart Abandoned"
//   Action: "Send HTTP Request"
//   URL: https://SEUDOMINIO/api/wix/webhook/cart-abandoned
//   Method: POST
//   Body: deixar Wix mandar o payload padrão
// ─────────────────────────────────────────────────────────────────────
router.post('/webhook/cart-abandoned', async (req, res) => {
  try {
    const b = req.body || {};
    // O shape do webhook do Wix Automations pode vir em vários formatos
    // dependendo do tipo de trigger. Cobrimos os principais.
    const checkout = b.checkout || b.cart || b.data?.checkout || b.data || b;
    const id =
      checkout?.id ||
      checkout?.checkoutId ||
      checkout?.cartId ||
      checkout?._id ||
      `${Date.now()}-${Math.random()}`;

    const buyer =
      checkout?.buyerInfo ||
      checkout?.buyerNote?.buyer ||
      checkout?.customer ||
      {};
    const billing = checkout?.billingInfo?.contactDetails || {};
    const totals = checkout?.priceSummary || checkout?.totals || {};

    const itens = (checkout?.lineItems || checkout?.items || []).map((li) => ({
      nome: li.productName?.original || li.productName?.translated || li.name || null,
      sku: li.physicalProperties?.sku || li.sku || null,
      qtd: Number(li.quantity || 1),
      preco_unit: Number(li.price?.amount || li.price || 0),
      imagem: typeof li.image === 'string' ? li.image : li.image?.url || null,
      cor:
        (li.descriptionLines || []).find((d) => d.lineType === 'COLOR')
          ?.colorInfo?.original || null,
      tamanho:
        (li.descriptionLines || []).find(
          (d) => d.lineType === 'PLAIN_TEXT' && /tamanho|size/i.test(d.name?.original || ''),
        )?.plainText?.original || null,
    }));

    const row = {
      wix_checkout_id: String(id),
      wix_cart_id: checkout?.cartId || null,
      cliente_email: buyer.email || billing.email || checkout?.buyerEmail || null,
      cliente_nome:
        [billing.firstName, billing.lastName].filter(Boolean).join(' ') ||
        buyer.firstName ||
        buyer.name ||
        null,
      cliente_telefone: billing.phone || buyer.phone || null,
      total: Number(totals.total?.amount || totals.total || checkout?.total || 0),
      moeda: checkout?.currency || 'BRL',
      itens_qty: itens.reduce((s, i) => s + (i.qtd || 0), 0),
      itens,
      ultima_atividade:
        checkout?.updatedDate || checkout?.lastActivityDate || new Date().toISOString(),
      criado_em: checkout?.createdDate || new Date().toISOString(),
      raw: b,
    };

    // Upsert por wix_checkout_id (mesma sessão pode disparar várias vezes)
    const { error } = await supabase
      .from('wix_carrinhos_abandonados')
      .upsert(row, { onConflict: 'wix_checkout_id' });
    if (error) {
      console.error('[wix-cart-abandoned] erro upsert:', error.message);
      return res.status(500).json({ error: error.message });
    }
    console.log(
      `[wix-cart-abandoned] ✓ recebido: ${row.cliente_email || '?'} · R$ ${row.total.toFixed(2)} · ${row.itens_qty} itens`,
    );
    return res.json({ ok: true });
  } catch (e) {
    console.error('[wix-cart-abandoned] erro:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

export default router;
