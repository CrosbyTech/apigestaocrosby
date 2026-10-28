/**
 * Ponte: Solicitações de Baixa do Dryland (link dos vendedores) → aba
 * Solicitações de Baixa do HeadCoach.
 *
 * Os vendedores mandam o comprovante por https://link.crosbyrevenda.com/baixa?k=…
 * (nome, loja, cliente, CPF/CNPJ, data do pagamento, valor, arquivo). Cada
 * envio cai no Supabase "Cérebro" do Dryland e aparece na tela de cobrança
 * de lá (aba "Solicitações de Baixas"). O João (Recuperação de Créditos)
 * pediu em 22/10/2026 pra centralizar tudo no HeadCoach.
 *
 * Como o Dryland protege essas funções por login da cobrança (cob_login →
 * token), este serviço precisa de um usuário dedicado:
 *   DRYLAND_COB_USUARIO + DRYLAND_COB_SENHA (Render). Sem eles, a ponte fica
 *   desligada e `status()` diz isso.
 *
 * Fluxo (job a cada 10 min + POST /api/dryland-baixas/sincronizar):
 *   1. cob_baixa_lista(p_dias) → solicitações 'nova' / 'em_analise'.
 *   2. Pra cada uma ainda não espelhada (ref_externa `dryland:baixa:<id>`):
 *      - acha o cliente no TOTVS (cd informado, senão CPF/CNPJ);
 *      - lista os títulos abertos dele e procura o(s) que somam o valor pago
 *        (1 título exato → esse; senão combinação dos mais antigos);
 *      - baixa o comprovante (cob_baixa_arquivo) pro bucket comprovantes_baixa;
 *      - abre 1 solicitação por título (ou 1 "a conferir", nr_fat 0, se não
 *        achou), origem 'dryland_link', comprovante anexado.
 *   3. Quando a solicitação vira 'processada' ou 'rejeitada' aqui, devolve o
 *      status pro Dryland (cob_baixa_status: baixada / recusada) — assim a
 *      tela de lá não fica com pendência fantasma.
 *
 * Controle em dryland_baixas_espelho (migrations/dryland_baixas_espelho.sql).
 * Não apaga nada em lugar nenhum.
 */
import axios from 'axios';
import supabase from '../config/supabase.js';
import { postTotvs } from './bluecardLimite.js';

const DRYLAND_URL = process.env.DRYLAND_SUPABASE_URL || 'https://umhczriycvtagjqjnrzm.supabase.co';
const DRYLAND_KEY =
  process.env.DRYLAND_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtaGN6cml5Y3Z0YWdqcWpucnptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2NTAyOTEsImV4cCI6MjA5MzIyNjI5MX0.SVWG6_7DZNv-Tz4AgRwQ1791lAEWgpcEv15k9rERlwI';
const COB_USUARIO = process.env.DRYLAND_COB_USUARIO || '';
const COB_SENHA = process.env.DRYLAND_COB_SENHA || '';

const ORIGEM = 'dryland_link';
const BUCKET = 'comprovantes_baixa';
const DIAS_PADRAO = Number(process.env.DRYLAND_BAIXAS_DIAS || 60);
const INTERVALO_MS = Number(process.env.DRYLAND_BAIXAS_INTERVALO_MIN || 10) * 60 * 1000;
const TOTVS_STATUS_NORMAL = 1;
const SOLICITANTE = { user_id: null, user_email: 'dryland@crosby.app' };

export function configurado() {
  return Boolean(COB_USUARIO && COB_SENHA);
}

async function rpc(fn, args = {}) {
  const { data } = await axios.post(`${DRYLAND_URL}/rest/v1/rpc/${fn}`, args, {
    headers: { 'Content-Type': 'application/json', apikey: DRYLAND_KEY, Authorization: `Bearer ${DRYLAND_KEY}` },
    timeout: 60000,
  });
  return data;
}

/** Abre sessão na cobrança do Dryland, roda `fn(token)` e fecha a sessão. */
async function comSessao(fn) {
  if (!configurado()) {
    throw Object.assign(
      new Error('Ponte Dryland desligada: defina DRYLAND_COB_USUARIO + DRYLAND_COB_SENHA no servidor.'),
      { status: 503 },
    );
  }
  const lg = await rpc('cob_login', { p_usuario: COB_USUARIO, p_senha: COB_SENHA });
  if (!lg || lg.ok !== true || !lg.token) {
    const motivo = (lg && (lg.erro || (lg.definir ? 'usuário sem senha definida' : null))) || 'login recusado';
    throw Object.assign(new Error(`login na cobrança do Dryland falhou (${motivo})`), { status: 502 });
  }
  try {
    return await fn(lg.token);
  } finally {
    rpc('cob_sair', { p_token: lg.token }).catch(() => {});
  }
}

const soDigitos = (v) => String(v || '').replace(/\D/g, '');
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const cents = (v) => Math.round((Number(v) || 0) * 100);
const dataISO = (v) => (String(v || '').match(/^\d{4}-\d{2}-\d{2}/) || [null])[0];

/** Solicitações do link, como o Dryland devolve (status nova/em_analise/baixada/recusada). */
export async function listarDryland({ dias = DIAS_PADRAO } = {}) {
  return comSessao(async (token) => {
    const r = await rpc('cob_baixa_lista', { p_token: token, p_dias: Number(dias) || DIAS_PADRAO });
    if (!r || r.ok === false) throw new Error(`cob_baixa_lista: ${r?.erro || 'sem retorno'}`);
    return { baixas: r.baixas || [], link_key: r.link_key || null };
  });
}

// ── TOTVS ──────────────────────────────────────────────────────────────────
async function buscarDocumentos(filter) {
  const itens = [];
  for (let page = 1; page <= 5; page++) {
    const resp = await postTotvs('/accounts-receivable/v2/documents/search', { filter, page, pageSize: 100, order: '-issueDate' });
    itens.push(...(resp.data?.items || []));
    if (page >= (resp.data?.totalPages || 1)) break;
  }
  return itens;
}

const mapTitulo = (t) => ({
  receivableCode: Number(t.receivableCode),
  installmentCode: Number(t.installmentCode ?? 1),
  branchCode: t.branchCode ?? null,
  customerCode: t.customerCode ?? null,
  customerName: t.customerName ?? null,
  valorCents: cents(t.installmentValue),
  vencimento: dataISO(t.expiredDate),
  emissao: dataISO(t.issueDate),
  cd_portador: t.bearerCode ?? null,
  nm_portador: t.bearerName ?? null,
  aberto: !t.paymentDate && !t.settlementDate,
});

/** Títulos normais (status 1) do cliente — por código ou por CPF/CNPJ. */
async function titulosDoCliente({ cd, cpf }) {
  const filter = { statusList: [TOTVS_STATUS_NORMAL] };
  if (cd) filter.customerCodeList = [Number(cd)];
  else if (cpf) filter.customerCpfCnpjList = [cpf];
  else return [];
  return (await buscarDocumentos(filter)).map(mapTitulo);
}

/**
 * Quais títulos abertos somam exatamente o valor pago.
 * 1) um título com o valor exato (o mais antigo); 2) combinação exata entre
 * os 12 vencidos/abertos mais antigos (busca exaustiva — 4096 combinações).
 */
function casarTitulos(abertos, valorCents) {
  const ordenados = abertos.slice().sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento)));
  const exato = ordenados.find((t) => t.valorCents === valorCents);
  if (exato) return { titulos: [exato], criterio: 'valor exato' };
  const base = ordenados.slice(0, 12);
  let melhor = null;
  for (let mask = 1; mask < 1 << base.length; mask++) {
    let soma = 0;
    const comb = [];
    for (let i = 0; i < base.length; i++) if (mask & (1 << i)) { soma += base[i].valorCents; comb.push(base[i]); }
    if (soma === valorCents && (!melhor || comb.length < melhor.length)) melhor = comb;
  }
  return melhor ? { titulos: melhor, criterio: `soma de ${melhor.length} títulos` } : null;
}

// ── comprovante ────────────────────────────────────────────────────────────
async function guardarComprovante(token, b) {
  const r = await rpc('cob_baixa_arquivo', { p_token: token, p_id: Number(b.id) });
  if (!r || r.ok === false || !r.b64) return { url: '', path: '', nome: b.arquivo || null };
  const ext = (String(r.nome || b.arquivo || '').match(/\.[a-z0-9]{2,5}$/i) || [''])[0].toLowerCase();
  const path = `dryland/${b.id}${ext || ''}`;
  const buf = Buffer.from(r.b64, 'base64');
  const { error } = await supabase.storage.from(BUCKET).upload(path, buf, { contentType: r.mime || 'application/octet-stream', upsert: true });
  if (error) {
    console.warn(`⚠️ [dryland/baixas] comprovante ${b.id}: ${error.message}`);
    return { url: '', path: '', nome: r.nome || b.arquivo || null };
  }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data?.publicUrl || '', path, nome: r.nome || b.arquivo || null };
}

// ── espelho ────────────────────────────────────────────────────────────────
async function espelhoExistente(ids) {
  const mapa = {};
  for (let i = 0; i < ids.length; i += 500) {
    const { data, error } = await supabase.from('dryland_baixas_espelho').select('*').in('dryland_id', ids.slice(i, i + 500));
    if (error) throw new Error(`dryland_baixas_espelho: ${error.message} (rode migrations/dryland_baixas_espelho.sql)`);
    for (const e of data || []) mapa[e.dryland_id] = e;
  }
  return mapa;
}

async function inserirSolicitacao(row) {
  const { data, error } = await supabase.from('solicitacoes_baixa').insert(row).select('id').single();
  if (!error) return { r: 'inserida', id: data?.id };
  if (error.code === '23505') return { r: 'ja_existia' };
  throw new Error(`solicitacoes_baixa: ${error.message}`);
}

/**
 * Traz pro HeadCoach as solicitações novas do link. Idempotente (ref_externa
 * única + tabela de espelho). Devolve um resumo.
 */
export async function espelharSolicitacoes({ dias = DIAS_PADRAO } = {}) {
  const resumo = { lidas: 0, novas: 0, ja_espelhadas: 0, abertas: 0, a_conferir: 0, erros: [] };
  await comSessao(async (token) => {
    const r = await rpc('cob_baixa_lista', { p_token: token, p_dias: Number(dias) || DIAS_PADRAO });
    if (!r || r.ok === false) throw new Error(`cob_baixa_lista: ${r?.erro || 'sem retorno'}`);
    const todas = r.baixas || [];
    resumo.lidas = todas.length;
    const pendentes = todas.filter((b) => ['nova', 'em_analise'].includes(String(b.status || '')));
    const existentes = await espelhoExistente(pendentes.map((b) => Number(b.id)));

    for (const b of pendentes) {
      if (existentes[Number(b.id)]) { resumo.ja_espelhadas++; continue; }
      try {
        const cpf = soDigitos(b.cliente_cpf);
        const valorCents = cents(b.valor);
        const titulos = await titulosDoCliente({ cd: b.cd ? Number(b.cd) : null, cpf });
        const abertos = titulos.filter((t) => t.aberto);
        const cliente = titulos[0] ? { code: titulos[0].customerCode, name: titulos[0].customerName } : null;
        const achado = valorCents > 0 ? casarTitulos(abertos, valorCents) : null;
        const comp = await guardarComprovante(token, b);
        const dtPag = dataISO(b.data_pagamento) || dataISO(b.em) || new Date().toISOString().slice(0, 10);
        const quem = [b.solicitante, b.loja].filter(Boolean).join(' · ');
        const refBase = `dryland:baixa:${b.id}`;
        const cabec = [
          `Pedido pelo link de baixa do Dryland (#${b.id}) por ${quem || '?'} em ${String(b.em || '').slice(0, 16).replace('T', ' ')}.`,
          `Cliente informado: ${b.cliente_nome || '?'}${cpf ? ` CPF/CNPJ ${cpf}` : ''}${b.cd ? ` cód. ${b.cd}` : ''}. Valor pago ${r2(b.valor).toFixed(2)} em ${dtPag}.`,
          b.obs ? `Obs.: ${b.obs}` : null,
        ].filter(Boolean);

        const filialFallback = titulos.slice().sort((x, y) => String(y.emissao).localeCompare(String(x.emissao)))[0]?.branchCode ?? 0;
        const base = {
          nm_cliente: cliente?.name || b.nome_totvs || b.cliente_nome || '',
          comprovante_url: comp.url || '',
          comprovante_path: comp.path || '',
          anexo_url: comp.url || null,
          anexo_path: comp.path || null,
          anexo_nome: comp.nome || null,
          status: 'pendente',
          ...SOLICITANTE,
          user_nome: `Dryland · ${quem || 'link de baixa'}`,
          dt_pagamento: dtPag,
          forma_pagamento: null,
          dados_cartao: null,
          origem: ORIGEM,
        };

        const linhas = achado
          ? achado.titulos.map((t, i) => ({
              ...base,
              cd_empresa: t.branchCode ?? filialFallback,
              cd_cliente: t.customerCode ?? cliente?.code ?? (b.cd ? Number(b.cd) : null),
              nr_fat: t.receivableCode,
              nr_parcela: t.installmentCode,
              vl_fatura: r2(t.valorCents / 100),
              vl_juros: 0,
              dt_vencimento: t.vencimento,
              dt_emissao: t.emissao,
              cd_portador: t.cd_portador,
              nm_portador: t.nm_portador,
              observacao: [...cabec, `Título TOTVS ${t.receivableCode}-${t.installmentCode} localizado por ${achado.criterio}${achado.titulos.length > 1 ? ` (${i + 1}/${achado.titulos.length})` : ''}.`, `[${refBase}:${t.receivableCode}-${t.installmentCode}]`].join(' '),
              ref_externa: `${refBase}:${t.receivableCode}-${t.installmentCode}`,
            }))
          : [{
              ...base,
              cd_empresa: filialFallback,
              cd_cliente: cliente?.code ?? (b.cd ? Number(b.cd) : null),
              nr_fat: 0,
              nr_parcela: 1,
              vl_fatura: r2(b.valor),
              vl_juros: 0,
              dt_vencimento: null,
              dt_emissao: null,
              cd_portador: null,
              nm_portador: null,
              observacao: [...cabec, `⚠️ TÍTULO NÃO LOCALIZADO NO TOTVS${cliente ? ` (cliente ${cliente.code} tem ${abertos.length} título(s) aberto(s), nenhum/combinação bate com o valor)` : ' — cliente não encontrado pelo código/CPF'}. Conferir manualmente.`, `[${refBase}]`].join(' '),
              ref_externa: refBase,
            }];

        const ids = [];
        for (const row of linhas) {
          const ins = await inserirSolicitacao(row);
          if (ins.id) ids.push(ins.id);
        }
        await supabase.from('dryland_baixas_espelho').upsert({
          dryland_id: Number(b.id),
          ref_externa: refBase,
          status_dryland: b.status,
          solicitante: quem || null,
          cliente_nome: b.cliente_nome || null,
          valor: r2(b.valor),
          data_pagamento: dtPag,
          comprovante_url: comp.url || null,
          titulos: achado ? achado.titulos.map((t) => `${t.receivableCode}-${t.installmentCode}`) : [],
          solicitacoes_ids: ids,
          atualizado_em: new Date().toISOString(),
        }, { onConflict: 'dryland_id' });
        resumo.novas++;
        if (achado) resumo.abertas += linhas.length; else resumo.a_conferir++;
      } catch (e) {
        resumo.erros.push({ id: b.id, erro: e.message });
        console.warn(`⚠️ [dryland/baixas] #${b.id}: ${e.message}`);
      }
    }
  });
  return resumo;
}

/**
 * Devolve pro Dryland o que aconteceu aqui: todas as solicitações de um pedido
 * 'processada' → baixada; alguma 'rejeitada' (e nenhuma pendente) → recusada.
 */
export async function devolverStatus() {
  const resumo = { baixadas: 0, recusadas: 0, erros: [] };
  const { data: espelhos, error } = await supabase
    .from('dryland_baixas_espelho')
    .select('*')
    .is('status_enviado', null)
    .limit(200);
  if (error) throw new Error(`dryland_baixas_espelho: ${error.message}`);
  if (!espelhos?.length) return resumo;

  const refs = espelhos.map((e) => e.ref_externa);
  const { data: sols } = await supabase
    .from('solicitacoes_baixa')
    .select('id, ref_externa, status, processado_por, processado_em, motivo_rejeicao, user_nome')
    .eq('origem', ORIGEM)
    .or(refs.map((r) => `ref_externa.like.${r}%`).join(','));

  const paraEnviar = [];
  for (const e of espelhos) {
    const minhas = (sols || []).filter((s) => s.ref_externa === e.ref_externa || String(s.ref_externa || '').startsWith(`${e.ref_externa}:`));
    if (!minhas.length) continue;
    const pendente = minhas.some((s) => ['pendente', 'aprovada'].includes(s.status));
    if (pendente) continue;
    if (minhas.every((s) => s.status === 'processada')) {
      paraEnviar.push({ e, status: 'baixada', obs: `Baixada no HeadCoach${minhas[0].processado_por ? ` por ${minhas[0].processado_por}` : ''} em ${String(minhas[0].processado_em || '').slice(0, 10)}. Títulos: ${(e.titulos || []).join(', ') || '-'}.` });
    } else if (minhas.some((s) => s.status === 'rejeitada')) {
      const m = minhas.find((s) => s.status === 'rejeitada');
      paraEnviar.push({ e, status: 'recusada', obs: `Recusada no HeadCoach: ${m.motivo_rejeicao || 'sem motivo informado'}.` });
    }
  }
  if (!paraEnviar.length) return resumo;

  await comSessao(async (token) => {
    for (const { e, status, obs } of paraEnviar) {
      try {
        const r = await rpc('cob_baixa_status', { p_token: token, p_id: Number(e.dryland_id), p_status: status, p_obs: obs });
        if (r && r.ok === false) throw new Error(r.erro || 'recusado');
        await supabase.from('dryland_baixas_espelho').update({ status_enviado: status, status_enviado_em: new Date().toISOString(), atualizado_em: new Date().toISOString() }).eq('dryland_id', e.dryland_id);
        if (status === 'baixada') resumo.baixadas++; else resumo.recusadas++;
      } catch (err) {
        resumo.erros.push({ id: e.dryland_id, erro: err.message });
      }
    }
  });
  return resumo;
}

// ── job ────────────────────────────────────────────────────────────────────
let ultima = { em: null, espelho: null, retorno: null, erro: null };
let rodando = false;

export async function sincronizar({ dias } = {}) {
  if (rodando) return { ok: false, motivo: 'já está rodando', ultima };
  rodando = true;
  try {
    const espelho = await espelharSolicitacoes({ dias });
    const retorno = await devolverStatus();
    ultima = { em: new Date().toISOString(), espelho, retorno, erro: null };
    if (espelho.novas || retorno.baixadas || retorno.recusadas) {
      console.log(`🟢 [dryland/baixas] ${espelho.novas} nova(s) (${espelho.abertas} título(s), ${espelho.a_conferir} a conferir) · devolvidas: ${retorno.baixadas} baixada(s), ${retorno.recusadas} recusada(s)`);
    }
    return { ok: true, ...ultima };
  } catch (e) {
    ultima = { em: new Date().toISOString(), espelho: null, retorno: null, erro: e.message };
    console.warn(`⚠️ [dryland/baixas] ${e.message}`);
    return { ok: false, ...ultima };
  } finally {
    rodando = false;
  }
}

export async function status() {
  const { count } = await supabase.from('dryland_baixas_espelho').select('*', { count: 'exact', head: true });
  const { count: pendentesRetorno } = await supabase.from('dryland_baixas_espelho').select('*', { count: 'exact', head: true }).is('status_enviado', null);
  return { configurado: configurado(), intervalo_min: INTERVALO_MS / 60000, dias: DIAS_PADRAO, espelhadas: count ?? 0, aguardando_retorno: pendentesRetorno ?? 0, ultima };
}

export function iniciarJobDrylandBaixas() {
  if (!configurado()) {
    console.log('ℹ️ [dryland/baixas] ponte desligada (sem DRYLAND_COB_USUARIO/SENHA)');
    return;
  }
  setTimeout(() => sincronizar().catch(() => {}), 60 * 1000);
  setInterval(() => sincronizar().catch(() => {}), INTERVALO_MS);
  console.log(`🟢 [dryland/baixas] job ligado: a cada ${INTERVALO_MS / 60000} min`);
}

// Reaproveitado por outras rotas (ex.: Forecast DRE / folha do Dryland) para
// não duplicar a URL/chave do Dryland.
export { DRYLAND_URL, DRYLAND_KEY };
