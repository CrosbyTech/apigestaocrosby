// ============================================================================
// PEDIDOS DE VENDA DO DRYLAND → HeadCoach
//
// O pedido nasce no Dryland (site / vendedor) e é separado em
// dryland-missao-separacao.vercel.app/separar. Ao confirmar, o Dryland abre o
// pedido de venda no TOTVS (número em lv_separacao.totvs). Aqui guardamos o
// PEDIDO DO DRYLAND (ref: RV###, VJ###, MT###, PE###, FR###, TR###…) — é ele
// que fica quando o TOTVS sair.
//
// Duas fontes do Supabase do Dryland (chave ANON pública, a mesma do site):
//  • fila_fat_listar — a FILA DE FATURAMENTO do Painel (/frete): um card por
//    venda de todos os canais, com pagamento, NSU/autorização, comprovantes,
//    NF e pedido TOTVS → pedidos_venda_fila. É a lista da tela.
//  • lv_sep_listar — a SEPARAÇÃO (/separar), uma linha por peça → agrupada por
//    ref em pedidos_venda_dryland (+ _itens). Liga com o card pelo
//    numero_pedido_site. Dá a situação aguardando / em separação / separado.
// Nada é apagado: o que sai do Dryland ganha sumiu_do_dryland_em. Pagamento
// registrado à mão e comprovante anexado no HeadCoach ficam em
// pedidos_venda_anexos (chave = id do card ou ref da separação).
// ============================================================================
import supabase from '../config/supabase.js';

export const DRYLAND_URL = process.env.DRYLAND_SUPABASE_URL || 'https://umhczriycvtagjqjnrzm.supabase.co';
export const DRYLAND_KEY =
  process.env.DRYLAND_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtaGN6cml5Y3Z0YWdqcWpucnptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2NTAyOTEsImV4cCI6MjA5MzIyNjI5MX0.SVWG6_7DZNv-Tz4AgRwQ1791lAEWgpcEv15k9rERlwI';

const CANAL_POR_TIPO = {
  'revenda-site': 'revenda',
  'varejo-site': 'varejo',
  'multimarca-site': 'multimarca',
  'franquia-site': 'franquia',
  transferencia: 'transferencia',
  brinde: 'brinde',
};
const NAO_VENDA = ['transferencia', 'brinde'];

async function lerDryland() {
  const linhas = [];
  for (let offset = 0; offset < 200000; offset += 1000) {
    const r = await fetch(`${DRYLAND_URL}/rest/v1/rpc/lv_sep_listar?limit=1000&offset=${offset}`, {
      method: 'POST',
      headers: { apikey: DRYLAND_KEY, Authorization: `Bearer ${DRYLAND_KEY}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!r.ok) throw new Error(`Dryland lv_sep_listar HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const pg = await r.json();
    linhas.push(...(pg || []));
    if (!pg || pg.length < 1000) break;
  }
  return linhas;
}

// "Pedido site revenda pago (boleto_faturado) - vendedor 161 Cleiton Duarte · ATENCAO…"
function lerObs(obs) {
  const o = String(obs || '');
  const pag = o.match(/pago \(([^)]+)\)/i);
  const vend = o.match(/vendedor\s+(\d+)\s+([^|·•\n]+?)(?:\s*[|·•]|\s+-\s|$)/i);
  return {
    pagamento: pag ? pag[1].trim().toLowerCase() : null,
    vendedor_code: vend ? Number(vend[1]) : null,
    vendedor_nome: vend ? vend[2].trim() : null,
  };
}

const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

export async function sincronizarPedidosDryland() {
  const separacao = await sincronizarSeparacao();
  const fila = await sincronizarFila();
  return { ...separacao, fila };
}

async function sincronizarSeparacao() {
  const linhas = await lerDryland();
  const agora = new Date().toISOString();
  const porRef = new Map();
  for (const l of linhas) {
    if (!l.ref) continue;
    if (!porRef.has(l.ref)) porRef.set(l.ref, []);
    porRef.get(l.ref).push(l);
  }

  // estado anterior (para separado_em e para marcar o que sumiu)
  const anteriores = new Map();
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase
      .from('pedidos_venda_dryland')
      .select('ref, status, separado_em, sumiu_do_dryland_em')
      .order('ref')
      .range(de, de + 999);
    if (error) throw error;
    for (const p of data || []) anteriores.set(p.ref, p);
    if (!data || data.length < 1000) break;
  }

  const cabecalhos = [];
  const itens = [];
  for (const [ref, ls] of porRef) {
    // a 1ª linha com obs de pedido (algumas linhas trazem só avisos de troca)
    const base = ls.find((x) => /pedido site|transfer/i.test(x.obs || '')) || ls[0];
    const { pagamento, vendedor_code, vendedor_nome } = lerObs(base.obs);
    const canal = CANAL_POR_TIPO[base.tipo] || base.tipo || null;
    const pecas = ls.reduce((s, x) => s + Number(x.qtd || 0), 0);
    const separadas = ls.reduce((s, x) => s + Math.min(Number(x.separado || 0), Number(x.qtd || 0)), 0);
    const valor = ls.reduce((s, x) => s + (x.preco != null ? Number(x.preco) * Number(x.qtd || 0) : 0), 0);
    const status = pecas > 0 && separadas >= pecas ? 'separado' : separadas > 0 ? 'em_separacao' : 'aguardando';
    const ant = anteriores.get(ref);
    const totvs = [...new Set(ls.map((x) => x.totvs).filter((t) => t != null).map(Number))].sort((a, b) => a - b);
    const criado = ls.map((x) => x.criado_em).filter(Boolean).sort()[0] || null;
    cabecalhos.push({
      ref,
      tipo: base.tipo || null,
      canal,
      eh_venda: !NAO_VENDA.includes(canal),
      cliente: base.cliente || null,
      vendedor_code,
      vendedor_nome,
      pagamento,
      obs: base.obs || null,
      criado_em: criado,
      qtd_itens: ls.length,
      qtd_pecas: pecas,
      qtd_separada: separadas,
      valor_total: Math.round(valor * 100) / 100,
      status,
      totvs_pedidos: totvs,
      separado_em: status === 'separado' ? ant?.separado_em || agora : null,
      sumiu_do_dryland_em: null,
      sincronizado_em: agora,
    });
    for (const x of ls) {
      itens.push({
        dryland_id: x.id,
        ref,
        cod: x.cod != null ? String(x.cod) : null,
        descricao: x.descricao || null,
        cor: x.cor || null,
        tamanho: x.tamanho || null,
        qtd: Number(x.qtd || 0),
        separado: Number(x.separado || 0),
        preco: x.preco != null ? Number(x.preco) : null,
        estoque: x.estoque || null,
        totvs: x.totvs != null ? Number(x.totvs) : null,
        troca_pendente: x.troca_pendente ?? null,
        marcado_em: x.marcado_em || null,
        obs: x.obs || null,
        criado_em: x.criado_em || null,
        sumiu_do_dryland_em: null,
        sincronizado_em: agora,
      });
    }
  }

  for (const lote of chunk(cabecalhos, 500)) {
    const { error } = await supabase.from('pedidos_venda_dryland').upsert(lote, { onConflict: 'ref' });
    if (error) throw error;
  }
  for (const lote of chunk(itens, 1000)) {
    const { error } = await supabase.from('pedidos_venda_dryland_itens').upsert(lote, { onConflict: 'dryland_id' });
    if (error) throw error;
  }

  // o que não veio mais do Dryland: marca (não apaga)
  const sumiram = [...anteriores.values()].filter((p) => !porRef.has(p.ref) && !p.sumiu_do_dryland_em).map((p) => p.ref);
  for (const lote of chunk(sumiram, 200)) {
    await supabase.from('pedidos_venda_dryland').update({ sumiu_do_dryland_em: agora }).in('ref', lote);
  }
  const idsAgora = new Set(itens.map((i) => i.dryland_id));
  const idsAntes = [];
  for (let de = 0; ; de += 1000) {
    const { data } = await supabase
      .from('pedidos_venda_dryland_itens')
      .select('dryland_id')
      .is('sumiu_do_dryland_em', null)
      .order('dryland_id')
      .range(de, de + 999);
    idsAntes.push(...(data || []).map((d) => d.dryland_id));
    if (!data || data.length < 1000) break;
  }
  const itensSumiram = idsAntes.filter((id) => !idsAgora.has(id));
  for (const lote of chunk(itensSumiram, 500)) {
    await supabase.from('pedidos_venda_dryland_itens').update({ sumiu_do_dryland_em: agora }).in('dryland_id', lote);
  }

  const pagamentos = await capturarPagamentos().catch((e) => {
    console.log(`⚠️ [pedidos-venda] pagamentos do Dryland indisponíveis: ${e.message}`);
    return 0;
  });

  return { pedidos: cabecalhos.length, pecas: itens.length, sumiram: sumiram.length, itensSumiram: itensSumiram.length, pagamentos };
}

// Pagamento do pedido (Pagar.me, via Dryland). O Dryland só mostra o pedido
// enquanto ele está "pago e ainda sem pedido no TOTVS" (RPC
// loja_revenda_pagos_sem_totvs) — o job roda a cada 5 min e guarda nessa
// janela. O que já foi guardado não é apagado quando some de lá.
async function capturarPagamentos() {
  const r = await fetch(`${DRYLAND_URL}/rest/v1/rpc/loja_revenda_pagos_sem_totvs`, {
    method: 'POST',
    headers: { apikey: DRYLAND_KEY, Authorization: `Bearer ${DRYLAND_KEY}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const pagos = (await r.json()) || [];
  const agora = new Date().toISOString();
  let gravados = 0;
  for (const p of pagos) {
    if (!p.numero) continue;
    const num = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
    const patch = {
      pagamento_info: { metodo: p.metodo || null, ...(p.pago_info || {}) },
      pagamento_capturado_em: agora,
      total_pago: num(p.total_pago ?? p.total),
      frete: num(p.frete),
      credev_usado: num(p.credev_usado),
      cliente_doc: p.doc || null,
      cliente_telefone: p.telefone || null,
    };
    if (p.metodo) patch.pagamento = String(p.metodo).toLowerCase();
    const { data, error } = await supabase.from('pedidos_venda_dryland').update(patch).eq('ref', p.numero).select('ref');
    if (error) throw error;
    gravados += (data || []).length;
  }
  return gravados;
}

// ─── Fila de faturamento (Painel do /frete) ──────────────────────────────────
// Chamada de leitura a uma RPC do Dryland (chave anon, a mesma do bundle do Dryland)
export async function drylandRpc(fn, body = {}) {
  const r = await fetch(`${DRYLAND_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: DRYLAND_KEY, Authorization: `Bearer ${DRYLAND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error(`Dryland ${fn} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

export const CANAIS_FILA = ['varejo', 'revenda', 'franquias', 'mtm'];
export const COMPROVANTE_URL = (path) => `${DRYLAND_URL}/storage/v1/object/public/missao-nfs/${path}`;

const texto = (v) => (v == null || v === '' ? null : String(v).trim() || null);
const numero = (v) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
// NSU/autorização "0" = não informado
const codigo = (v) => {
  const t = texto(v);
  return t && !/^0+$/.test(t) ? t : null;
};

async function lerFila(canal) {
  const r = await fetch(`${DRYLAND_URL}/rest/v1/rpc/fila_fat_listar`, {
    method: 'POST',
    headers: { apikey: DRYLAND_KEY, Authorization: `Bearer ${DRYLAND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_canal: canal, p_status: null, p_limit: 5000 }),
  });
  if (!r.ok) throw new Error(`Dryland fila_fat_listar ${canal} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()) || [];
}

export async function sincronizarFila() {
  const agora = new Date().toISOString();
  const cards = [];
  for (const canal of CANAIS_FILA) cards.push(...(await lerFila(canal)));
  const linhas = cards.map((c) => {
    const d = c.dados || {};
    const forma = texto(d.forma_pagamento);
    return {
      id: c.id,
      canal: c.canal || null,
      titulo: c.titulo || null,
      status: c.status || null,
      numero_site: texto(d.numero_pedido_site),
      pedido_totvs: texto(d.pedido_totvs),
      transacao: texto(d.transacao),
      eh_venda: !/TRANSFER/i.test(forma || '') && !/^TRANSFER/i.test(c.titulo || ''),
      cliente: texto(d.nome_cliente),
      cliente_codigo: texto(d.codigo_cliente),
      cliente_doc: texto(d.cnpj_cliente) || texto(d.doc),
      cliente_telefone: texto(d.telefone) || texto(d.whats_cliente),
      tipo_cliente: texto(d.tipo_cliente),
      vendedor: texto(d.vendedor),
      vendedor_code: texto(d.cod_vendedor),
      loja: texto(d.loja) || texto(d.loja_retirada),
      forma_pagamento: forma,
      parcelamento: texto(d.parcelamento),
      valor_pedido: numero(d.valor_pedido),
      valor_frete: numero(d.valor_frete),
      desconto: numero(d.desconto),
      total_pecas: numero(d.total_pecas),
      cartao_nsu: codigo(d.cartao_nsu) || codigo(d.pago_info?.nsu),
      cartao_autorizacao: codigo(d.cartao_autorizacao) || codigo(d.pago_info?.autorizacao),
      cartao_bandeira: texto(d.cartao_bandeira) || texto(d.pago_info?.bandeira),
      cartao_final: texto(d.cartao_final) || texto(d.pago_info?.cartao_final),
      pix_e2e: texto(d.pix_e2e) || texto(d.pago_info?.end_to_end_id),
      pagarme_charge: texto(d.pagarme_charge) || texto(d.pago_info?.charge_id),
      nf_numero: texto(d.nf_numero),
      nf_serie: texto(d.nf_serie),
      nf_chave: texto(d.nf_chave),
      comprovantes: Array.isArray(c.comprovantes) ? c.comprovantes.filter(Boolean) : [],
      dados: d,
      criado_em: c.criado_em || null,
      atualizado_em: c.atualizado_em || null,
      criado_por: c.criado_por || null,
      atualizado_por: c.atualizado_por || null,
      sumiu_do_dryland_em: null,
      sincronizado_em: agora,
    };
  });
  for (const lote of chunk(linhas, 300)) {
    const { error } = await supabase.from('pedidos_venda_fila').upsert(lote, { onConflict: 'id' });
    if (error) throw error;
  }
  // o que saiu da fila do Dryland: marca, não apaga. A fila devolve no máximo
  // 500 cards por canal (os mais novos): card antigo que "sai" por causa desse
  // corte não é marcado — só os que sumiram de dentro da janela que veio.
  const vistos = new Set(linhas.map((l) => l.id));
  const maisAntigo = {};
  for (const l of linhas) if (l.criado_em && (!maisAntigo[l.canal] || l.criado_em < maisAntigo[l.canal])) maisAntigo[l.canal] = l.criado_em;
  let sumiram = 0;
  for (const canal of CANAIS_FILA) {
    if (!maisAntigo[canal]) continue;
    const { data } = await supabase
      .from('pedidos_venda_fila')
      .select('id')
      .eq('canal', canal)
      .is('sumiu_do_dryland_em', null)
      .gte('criado_em', maisAntigo[canal])
      .limit(5000);
    const ids = (data || []).map((x) => x.id).filter((id) => !vistos.has(id));
    for (const lote of chunk(ids, 200)) {
      await supabase.from('pedidos_venda_fila').update({ sumiu_do_dryland_em: agora }).in('id', lote);
    }
    sumiram += ids.length;
  }
  return { cards: linhas.length, sumiram };
}

// Registro manual do pagamento (dinheiro, débito, ou o que não veio do site).
// chave = id do card da fila ou ref do pedido da separação.
export async function registrarPagamentoManual(chave, b = {}) {
  const FORMAS = ['pix', 'dinheiro', 'credito', 'debito', 'boleto', 'credev', 'outro'];
  const forma = String(b.forma || '').toLowerCase();
  if (!FORMAS.includes(forma)) throw new Error('Forma de pagamento inválida');
  const manual = {
    forma,
    nsu: b.nsu ? String(b.nsu).trim().slice(0, 40) : null,
    autorizacao: b.autorizacao ? String(b.autorizacao).trim().slice(0, 40) : null,
    obs: b.obs ? String(b.obs).trim().slice(0, 300) : null,
    por: b.por ? String(b.por).slice(0, 120) : null,
    em: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('pedidos_venda_anexos')
    .upsert({ chave, pagamento_manual: manual, atualizado_em: new Date().toISOString() }, { onConflict: 'chave' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Comprovante (foto/PDF) anexado no HeadCoach: bucket público pedidos-venda-comprovantes
const BUCKET = 'pedidos-venda-comprovantes';
export async function salvarComprovante(chave, { base64, nome, tipo }) {
  if (!base64) throw new Error('Arquivo vazio');
  const conteudo = Buffer.from(String(base64).replace(/^data:[^,]+,/, ''), 'base64');
  if (conteudo.length > 10 * 1024 * 1024) throw new Error('Arquivo maior que 10 MB');
  const ext = (String(nome || '').match(/\.([a-z0-9]{2,5})$/i)?.[1] || (/pdf/i.test(tipo) ? 'pdf' : 'jpg')).toLowerCase();
  const path = `${String(chave).replace(/[^A-Za-z0-9-]/g, '_')}/${Date.now()}.${ext}`;
  let up = await supabase.storage.from(BUCKET).upload(path, conteudo, { contentType: tipo || 'application/octet-stream', upsert: true });
  if (up.error && /not found|does not exist/i.test(up.error.message)) {
    await supabase.storage.createBucket(BUCKET, { public: true });
    up = await supabase.storage.from(BUCKET).upload(path, conteudo, { contentType: tipo || 'application/octet-stream', upsert: true });
  }
  if (up.error) throw up.error;
  const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  const agora = new Date().toISOString();
  const { data, error } = await supabase
    .from('pedidos_venda_anexos')
    .upsert({ chave, comprovante_url: url, comprovante_nome: nome || path, comprovante_em: agora, atualizado_em: agora }, { onConflict: 'chave' })
    .select()
    .single();
  if (error) throw error;
  return data;
}
