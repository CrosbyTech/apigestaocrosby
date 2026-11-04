// ============================================================================
// PDV CROSBY — promoções próprias do HeadCoach
//
// Criadas na tela Preço Promocional (Excel) com "GERAR NO PDV CROSBY": cada
// item guarda o valor promocional. Não mexem no TOTVS — ao bipar o produto,
// o PDV Crosby recebe a promoção vigente junto com o preço e aplica a
// diferença como desconto, destacado como PROMOCIONAL.
// Tabelas: pdv_promocoes + pdv_promocao_itens (migrations/pdv_promocoes.sql).
// ============================================================================
import supabase from '../config/supabase.js';

export class PromocaoPdvError extends Error {
  constructor(message, code = 'PROMOCAO_PDV_ERROR', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const LOTE_UPSERT = 1000;
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;
const hojeBrasil = () =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Recife', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

export async function listarPromocoes({ somenteAtivas = false } = {}) {
  let q = supabase.from('pdv_promocoes').select('*, itens:pdv_promocao_itens(count)').order('criado_em', { ascending: false });
  if (somenteAtivas) q = q.eq('ativa', true).gte('fim', hojeBrasil());
  const { data, error } = await q;
  if (error) throw error;
  const hoje = hojeBrasil();
  return (data || []).map(({ itens, ...p }) => ({
    ...p,
    qtdItens: itens?.[0]?.count ?? 0,
    vigente: p.ativa && p.inicio <= hoje && p.fim >= hoje,
  }));
}

export async function criarPromocao(b = {}) {
  const nome = String(b.nome || '').trim().slice(0, 120);
  if (!nome) throw new PromocaoPdvError('Informe o nome da promoção', 'INVALID_PAYLOAD');
  if (!DATA_RE.test(b.inicio || '') || !DATA_RE.test(b.fim || '')) {
    throw new PromocaoPdvError('Informe o início e o fim (AAAA-MM-DD)', 'INVALID_PAYLOAD');
  }
  if (b.fim < b.inicio) throw new PromocaoPdvError('O fim é antes do início', 'INVALID_PAYLOAD');
  const empresas = Array.isArray(b.empresas)
    ? [...new Set(b.empresas.map((e) => parseInt(e, 10)).filter((e) => e > 0))]
    : null;
  const { data, error } = await supabase
    .from('pdv_promocoes')
    .insert({
      nome,
      empresas: empresas && empresas.length ? empresas : null,
      inicio: b.inicio,
      fim: b.fim,
      desconto_pct: Number.isFinite(Number(b.descontoPct)) ? Number(b.descontoPct) : null,
      criado_por: b.criadoPor ? String(b.criadoPor).slice(0, 120) : null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

// Grava (ou atualiza o valor de) itens da promoção. Item repetido em outra
// leva só troca o valor.
export async function salvarItens(promocaoId, itens) {
  const { data: promo, error: e1 } = await supabase.from('pdv_promocoes').select('id').eq('id', promocaoId).maybeSingle();
  if (e1) throw e1;
  if (!promo) throw new PromocaoPdvError('Promoção não encontrada', 'NOT_FOUND', 404);
  const linhas = [];
  const recusados = [];
  for (const i of Array.isArray(itens) ? itens : []) {
    const productCode = parseInt(i?.productCode, 10);
    const preco = round2(i?.precoPromocional);
    if (!(productCode > 0) || !(preco > 0)) {
      recusados.push({ productCode: i?.productCode ?? null, erro: 'Código ou valor promocional inválido' });
      continue;
    }
    linhas.push({
      promocao_id: promocaoId,
      product_code: productCode,
      sku: i.sku ? String(i.sku).slice(0, 60) : null,
      nome: i.nome ? String(i.nome).slice(0, 200) : null,
      preco_base: Number.isFinite(Number(i.precoBase)) ? round2(i.precoBase) : null,
      preco_promocional: preco,
    });
  }
  for (let k = 0; k < linhas.length; k += LOTE_UPSERT) {
    const { error } = await supabase
      .from('pdv_promocao_itens')
      .upsert(linhas.slice(k, k + LOTE_UPSERT), { onConflict: 'promocao_id,product_code' });
    if (error) throw error;
  }
  await supabase.from('pdv_promocoes').update({ atualizado_em: new Date().toISOString() }).eq('id', promocaoId);
  cacheVigentes.clear();
  return { gravados: linhas.map((l) => l.product_code), recusados };
}

export async function alterarPromocao(id, b = {}) {
  const patch = { atualizado_em: new Date().toISOString() };
  if (typeof b.ativa === 'boolean') patch.ativa = b.ativa;
  if (b.nome != null) patch.nome = String(b.nome).trim().slice(0, 120);
  if (b.fim != null) {
    if (!DATA_RE.test(b.fim)) throw new PromocaoPdvError('Fim inválido (AAAA-MM-DD)', 'INVALID_PAYLOAD');
    patch.fim = b.fim;
  }
  const { data, error } = await supabase.from('pdv_promocoes').update(patch).eq('id', id).select('*').maybeSingle();
  if (error) throw error;
  if (!data) throw new PromocaoPdvError('Promoção não encontrada', 'NOT_FOUND', 404);
  cacheVigentes.clear();
  return data;
}

// Promoção vigente do produto na empresa (a de menor valor, se houver mais de
// uma). Cache curto: o PDV consulta a cada peça bipada.
const cacheVigentes = new Map(); // `${productCode}` -> { em, linhas }
const CACHE_MS = 60 * 1000;

export async function promocaoVigente(productCode, empresa) {
  const code = parseInt(productCode, 10);
  if (!(code > 0)) return null;
  let c = cacheVigentes.get(code);
  if (!c || Date.now() - c.em > CACHE_MS) {
    const hoje = hojeBrasil();
    const { data, error } = await supabase
      .from('pdv_promocao_itens')
      .select('preco_promocional, preco_base, promocao:pdv_promocoes!inner(id, nome, empresas, inicio, fim, ativa)')
      .eq('product_code', code)
      .eq('promocao.ativa', true)
      .lte('promocao.inicio', hoje)
      .gte('promocao.fim', hoje);
    if (error) throw error;
    c = { em: Date.now(), linhas: data || [] };
    cacheVigentes.set(code, c);
    if (cacheVigentes.size > 20000) cacheVigentes.clear();
  }
  const emp = parseInt(empresa, 10);
  const valida = c.linhas
    .filter((l) => !l.promocao.empresas || l.promocao.empresas.includes(emp))
    .sort((a, b) => Number(a.preco_promocional) - Number(b.preco_promocional))[0];
  if (!valida) return null;
  return {
    promocaoId: valida.promocao.id,
    nome: valida.promocao.nome,
    fim: valida.promocao.fim,
    precoPromocional: Number(valida.preco_promocional),
    precoBase: valida.preco_base != null ? Number(valida.preco_base) : null,
  };
}
