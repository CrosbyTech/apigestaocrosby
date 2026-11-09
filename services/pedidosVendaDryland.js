// ============================================================================
// PEDIDOS DE VENDA DO DRYLAND → HeadCoach
//
// O pedido nasce no Dryland (site / vendedor) e é separado em
// dryland-missao-separacao.vercel.app/separar. Ao confirmar, o Dryland abre o
// pedido de venda no TOTVS (número em lv_separacao.totvs). Aqui guardamos o
// PEDIDO DO DRYLAND (ref: RV###, VJ###, MT###, PE###, FR###, TR###…) — é ele
// que fica quando o TOTVS sair.
//
// Fonte: RPC lv_sep_listar do Supabase do Dryland (chave ANON pública, a mesma
// do site), uma linha por peça. Agrupamos por ref e gravamos em
// pedidos_venda_dryland (cabeçalho) e pedidos_venda_dryland_itens (peças).
// Nada é apagado: o que sai do Dryland ganha sumiu_do_dryland_em.
// ============================================================================
import supabase from '../config/supabase.js';

const DRYLAND_URL = process.env.DRYLAND_SUPABASE_URL || 'https://umhczriycvtagjqjnrzm.supabase.co';
const DRYLAND_KEY =
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

  return { pedidos: cabecalhos.length, pecas: itens.length, sumiram: sumiram.length, itensSumiram: itensSumiram.length };
}
