/**
 * Job: copia NFs de `notas_fiscais` (Supabase Fiscal) → `faturamento_transacao_historico`.
 *
 * Como NÃO compromete o TOTVS:
 *   - Lê SÓ do Supabase (notas_fiscais já tem os dados, populados pelo
 *     faturamento-diario.job.js que roda às 01:30 BRT)
 *   - Zero chamada ao TOTVS aqui
 *
 * Cron: 00:00 e 12:00 BRT, todos os dias
 *   - 00:00: pega o que veio durante o dia anterior + ressincronizações
 *   - 12:00: pega o que veio depois do TOTVS sync (01:30)
 *
 * Estratégia:
 *   - Default: processa últimos 30 dias (cobre re-sincronizações tardias do TOTVS)
 *   - Primeira execução: vai processar tudo de uma vez (pode demorar minutos)
 *   - Execuções seguintes: ~rápidas, só insere o que mudou (dedup via nf_uid)
 *   - Filtra: só operationType='Output' (vendas) e invoice_status != 'Canceled'/'Deleted'
 *   - Mapeia operation_code → canal via OP_SEGMENTO_MAP local
 *   - Person.cpfCnpj e demais campos vão pra cidade_uf/fone quando disponíveis
 */
import cron from 'node-cron';
import supabase from '../config/supabase.js';
import supabaseFiscal from '../config/supabaseFiscal.js';
import { getToken } from '../utils/totvsTokenManager.js';
import { getBranchesWithNames } from '../totvsrouter/totvsHelper.js';

// Mapping completo (mesmo que crm.routes.js usa pro fat-seg).
const OP_SEGMENTO_MAP = {
  // Varejo (B2C)
  510: 'varejo', 511: 'varejo', 521: 'varejo', 522: 'varejo',
  545: 'varejo', 546: 'varejo', 548: 'varejo',
  9009: 'varejo', 9017: 'varejo', 9027: 'varejo', 9033: 'varejo',
  9400: 'varejo', 9401: 'varejo', 9420: 'varejo', 9067: 'varejo', 9404: 'varejo',
  5919: 'varejo', // adicionada em 2026-06
  // Revendedor
  7236: 'revenda', 9122: 'revenda', 5102: 'revenda', 5202: 'revenda',
  7242: 'revenda', 9061: 'revenda', 9001: 'revenda', 9121: 'revenda',
  1407: 'revenda', 7806: 'revenda', 7809: 'revenda', 512: 'revenda',
  // Franquia
  7234: 'franquia', 7240: 'franquia', 7802: 'franquia', 9124: 'franquia', 7259: 'franquia',
  // Multimarcas
  7235: 'multimarcas', 7241: 'multimarcas', 9127: 'multimarcas',
  // Bazar
  887: 'bazar',
  // Business
  7237: 'business', 7269: 'business', 7279: 'business', 7277: 'business',
  // Showroom (entra como canal próprio agora — antes ia pra "outros")
  7254: 'showroom', 7007: 'showroom',
  // Novidades Franquia (entra como canal próprio agora)
  7255: 'novidadesfranquia',
};

// Ricardo Eletro: filiais dedicadas (11, 111).
// Ops B2C/marketplace que TOTVS reconhece como venda RE oficial.
// Mesmo conjunto que CANAL_CONFIG.ricardoeletro.operations no crm.routes.js.
// NFs de filial 11/111 com outras ops (ex: 7273 — venda atacado interna Blue House)
// NÃO entram em RE — caem em null (transferência interna, ignorada).
const RE_BRANCH_CODES = new Set([11, 111]);
const RE_OPS = new Set([
  512, 5102, 7236, 200, 510, 521, 545, 548,
  7237, 7269, 7277, 7279,
]);

// Inbound David/Rafael: classificado pelo dominantDealer (vendedor predominante)
const INBOUND_DAVID_DEALERS = new Set([26, 69]);
const INBOUND_RAFAEL_DEALER = 21;

// Op 7279 é COMPARTILHADA entre canais — a classificação real depende do dealer.
// Gestor definiu (2026-06): dealer 40=franquia · 20=business · 161/241/165=revenda
// Demais dealers em op 7279 caem em revenda (fallback seguro).
const OP_7279_DEALER_CANAL = new Map([
  [40, 'franquia'],
  [20, 'business'],
  [161, 'revenda'],
  [241, 'revenda'],
  [165, 'revenda'],
]);
function resolveCanal7279(dealer) {
  if (dealer == null) return 'revenda';
  return OP_7279_DEALER_CANAL.get(Number(dealer)) || 'revenda';
}

// Extrai o dealerCode predominante dos items da NF (cada item.products[] tem dealerCode).
// Retorna o dealer com mais produtos. Null se não conseguir.
function getDominantDealer(nf) {
  const items = Array.isArray(nf?.items) ? nf.items : [];
  if (items.length === 0) return null;
  const cnt = new Map();
  for (const it of items) {
    const products = Array.isArray(it?.products) ? it.products : [];
    for (const p of products) {
      const dc = p?.dealerCode ?? p?.sellerCode;
      if (dc == null) continue;
      const n = Number(dc);
      if (!Number.isFinite(n)) continue;
      cnt.set(n, (cnt.get(n) || 0) + 1);
    }
  }
  if (cnt.size === 0) return null;
  let best = null, max = 0;
  for (const [k, v] of cnt.entries()) {
    if (v > max) { max = v; best = k; }
  }
  return best;
}

function mapNfToTransacao(nf, personCanalMap = null, branchNameMap = null) {
  const operation_code = nf.operation_code != null ? Number(nf.operation_code) : null;
  const branchCode = nf.branch_code != null ? Number(nf.branch_code) : null;
  const isDevolucao = String(nf.operation_type || '').toLowerCase() === 'input';

  // Classificação (mesma ordem do fat-seg do crm.routes.js):
  //   1) Ricardo Eletro: filiais 11 ou 111 (prioridade total)
  //   2) Op 7279 → classificação especial por dealer (gestor 2026-06)
  //   3) Inbound David: dominantDealer ∈ {26, 69}
  //   4) Inbound Rafael: dominantDealer === 21
  //   5) OP_SEGMENTO_MAP[operation_code]
  //   6) (devoluções) lookup canal predominante do cliente
  //   7) null → transferência interna, NÃO contabiliza
  let canal = null;
  let dealer = null;
  if (
    branchCode != null &&
    RE_BRANCH_CODES.has(branchCode) &&
    // Só conta como RE se a op for venda B2C reconhecida OU for devolução.
    // NFs de op fora da lista (ex: 7273 — venda atacado Blue House) não viram RE.
    (RE_OPS.has(operation_code) || isDevolucao)
  ) {
    canal = 'ricardoeletro';
  } else if (operation_code === 7279) {
    dealer = getDominantDealer(nf);
    canal = resolveCanal7279(dealer);
  } else {
    dealer = getDominantDealer(nf);
    if (dealer != null && INBOUND_DAVID_DEALERS.has(dealer)) {
      canal = 'inbound_david';
    } else if (dealer === INBOUND_RAFAEL_DEALER) {
      canal = 'inbound_rafael';
    }
  }
  if (!canal) canal = OP_SEGMENTO_MAP[operation_code];
  if (!canal && isDevolucao && personCanalMap && nf.person_code != null) {
    canal = personCanalMap.get(Number(nf.person_code));
    // PROTEÇÃO: Ricardo Eletro só vale pra branches 11/111. Se o fallback
    // sugeriu RE mas a NF não é dessas filiais, descarta (vira null →
    // ignorada como transferência interna). Evita devoluções de qualquer
    // filial caírem em RE só porque o cliente tem histórico em RE.
    if (canal === 'ricardoeletro' && !RE_BRANCH_CODES.has(branchCode)) {
      canal = null;
    }
  }
  if (!canal) return null;

  const person = nf.person || {};
  const cidade =
    person.city || person.cityName || person.address?.cityName || null;
  const uf =
    person.uf || person.state || person.address?.stateCode || person.address?.uf || null;
  const cidade_uf = cidade && uf ? `${cidade} - ${uf}` : (cidade || uf || null);
  const fone =
    person.phoneNumber || person.phone || person.cellPhone || person.address?.phone || null;
  const tipo_cliente =
    person.classification || person.customerType || person.personType || null;

  const valor = Number(nf.total_value || 0);

  // chave única (mesma usada no upsert do notas_fiscais)
  const nf_uid = [
    nf.branch_code, nf.transaction_code, nf.invoice_code,
    nf.issue_date, valor,
  ].join('|');

  // Output (venda) → vl_fat=valor, credev=0, total=+valor
  // Input  (devolução/troca) → vl_fat=0, credev=valor, total=−valor
  // Soma por canal: SUM(vl_fat) − SUM(credev) = SUM(total) = líquido
  const vl_fat = isDevolucao ? 0 : valor;
  const credev = isDevolucao ? valor : 0;
  const total = isDevolucao ? -valor : valor;

  const loja = (branchNameMap && branchCode != null) ? (branchNameMap.get(branchCode) || null) : null;

  return {
    nf_uid,
    loja,
    branch_code: branchCode,
    invoice_code: nf.invoice_code || null,
    operation_code,
    data_transacao: nf.issue_date,
    cod_cliente: nf.person_code != null ? Number(nf.person_code) : null,
    cliente_nome: nf.person_name || null,
    tipo_cliente,
    canal,
    dt_cadastro: person.registrationDate || person.createdAt || null,
    vl_fat,
    credev,
    total,
    cidade_uf,
    fone,
    observacao: nf.observation_nf || (isDevolucao ? '[DEVOLUÇÃO]' : null),
    origem: 'totvs-sync',
    atualizado_em: new Date().toISOString(),
  };
}

/**
 * Sincroniza NFs do range [datemin, datemax] de notas_fiscais → faturamento_transacao_historico.
 * Retorna { ok, dias_processados, inseridos, ignorados, erros }.
 */
export async function executarSyncTransacao({ datemin, datemax } = {}) {
  const hoje = new Date();
  const trintaDias = new Date();
  trintaDias.setDate(trintaDias.getDate() - 30);
  // Default: D-30 → hoje (janela larga pra pegar ressincronizações tardias)
  datemin = datemin || trintaDias.toISOString().slice(0, 10);
  datemax = datemax || hoje.toISOString().slice(0, 10);

  console.log(`\n📥 [transacao-historico-sync] ${datemin} → ${datemax}`);

  let inseridos = 0, atualizados = 0, ignorados = 0, totalLidos = 0;
  const PAGE = 1000;
  let lastError = null;

  // Pré-carrega lista oficial de filiais Crosby (1 chamada TOTVS, leve).
  // Filtra NFs que vieram de branch_codes desconhecidos / não-filial.
  // Preenche o campo `loja` com o nome real da filial.
  const branchNameMap = new Map();
  try {
    const tk = await getToken();
    if (tk?.access_token) {
      const branches = await getBranchesWithNames(tk.access_token);
      for (const b of branches || []) {
        if (b?.code != null && b?.name) {
          branchNameMap.set(Number(b.code), b.name);
        }
      }
      console.log(`[transacao-historico-sync] ${branchNameMap.size} filiais carregadas do TOTVS`);
    } else {
      console.warn('[transacao-historico-sync] token TOTVS indisponível — sem filtro de filiais');
    }
  } catch (e) {
    console.warn('[transacao-historico-sync] getBranchesWithNames falhou:', e.message);
  }

  // Pré-carrega mapping person_code → canal predominante (das vendas).
  // Pra devoluções (Input) que não tem op code mapeado, classifica pelo
  // canal que o cliente mais compra. Evita despejar tudo em "outros".
  const personCanalMap = new Map();
  try {
    console.log('[transacao-historico-sync] construindo personCanalMap…');
    const PAGE_PCM = 1000;
    const stats = new Map(); // person_code → {canal: count}
    for (let from = 0; ; from += PAGE_PCM) {
      const { data, error } = await supabase
        .from('faturamento_transacao_historico')
        .select('cod_cliente, canal')
        .neq('canal', 'outros')
        .gt('total', 0)
        .range(from, from + PAGE_PCM - 1);
      if (error) break;
      if (!data || data.length === 0) break;
      for (const r of data) {
        if (r.cod_cliente == null) continue;
        const key = Number(r.cod_cliente);
        if (!stats.has(key)) stats.set(key, {});
        const m = stats.get(key);
        m[r.canal] = (m[r.canal] || 0) + 1;
      }
      if (data.length < PAGE_PCM) break;
    }
    // Pra cada cliente, escolhe canal predominante
    for (const [pc, m] of stats.entries()) {
      const best = Object.entries(m).sort((a, b) => b[1] - a[1])[0];
      if (best) personCanalMap.set(pc, best[0]);
    }
    console.log(`[transacao-historico-sync] personCanalMap pronto: ${personCanalMap.size} clientes`);
  } catch (e) {
    console.warn('[transacao-historico-sync] personCanalMap falhou (continuando sem):', e.message);
  }

  try {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabaseFiscal
        .from('notas_fiscais')
        .select(
          'branch_code, transaction_code, invoice_code, issue_date, total_value, operation_code, operation_type, invoice_status, person_code, person_name, person, observation_nf, items',
        )
        .gte('issue_date', datemin)
        .lte('issue_date', datemax)
        .order('issue_date', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) { lastError = error.message; break; }
      if (!data || data.length === 0) break;
      totalLidos += data.length;

      // Filtra: vendas (Output) E devoluções (Input), excluindo canceladas.
      // Devoluções viram credev nas linhas (com total negativo).
      // SÓ inclui NFs de filiais oficiais Crosby (branchNameMap) com
      // branch_code entre 1 e 5999 (exclui franquias 6XXX que são empresas
      // independentes — elas têm outro tratamento no Forecast).
      const validas = data.filter((nf) => {
        const tipo = String(nf.operation_type || '').toLowerCase();
        if (tipo && tipo !== 'output' && tipo !== 'input') return false;
        const status = String(nf.invoice_status || '').toLowerCase();
        if (status === 'canceled' || status === 'deleted') return false;
        if (!nf.issue_date) return false;
        const bc = nf.branch_code != null ? Number(nf.branch_code) : null;
        if (bc == null || bc < 1 || bc > 5999) return false;
        if (branchNameMap.size > 0 && !branchNameMap.has(bc)) return false;
        return true;
      });
      ignorados += data.length - validas.length;

      const rows = validas
        .map((nf) => mapNfToTransacao(nf, personCanalMap, branchNameMap))
        .filter((r) => r && r.nf_uid && r.data_transacao);

      // Upsert em chunks de 500 com onConflict=nf_uid
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const { error: upErr } = await supabase
          .from('faturamento_transacao_historico')
          .upsert(chunk, { onConflict: 'nf_uid' });
        if (upErr) {
          console.warn(`[transacao-historico-sync] upsert falhou: ${upErr.message}`);
          lastError = upErr.message;
        } else {
          inseridos += chunk.length;
        }
      }

      if (data.length < PAGE) break;
    }
  } catch (e) {
    lastError = e.message;
  }

  const result = {
    ok: !lastError,
    datemin, datemax,
    lidos_notas_fiscais: totalLidos,
    inseridos_ou_atualizados: inseridos,
    ignorados,
    erro: lastError,
  };
  console.log(`✅ [transacao-historico-sync] lidos=${totalLidos} inseridos=${inseridos} ignorados=${ignorados}${lastError ? ` erro=${lastError}` : ''}`);
  return result;
}

let agendado = false;
export function iniciarTransacaoHistoricoSync() {
  if (agendado) return;
  agendado = true;
  // 2× ao dia: meia-noite e meio-dia (BRT)
  //   - 00:00: captura tudo do dia anterior + ressincronizações
  //   - 12:00: pega o que entrou depois do faturamento-diario (01:30)
  cron.schedule(
    '0 0,12 * * *',
    async () => {
      const horaInicio = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      console.log(`⏰ [transacao-historico-sync] cron disparado ${horaInicio}`);
      try {
        await executarSyncTransacao();
      } catch (e) {
        console.error('[transacao-historico-sync] cron falhou:', e.message);
      }
    },
    { timezone: 'America/Sao_Paulo' },
  );
  console.log(
    '[transacao-historico-sync] cron agendado: 00:00 e 12:00 BRT (D-30 → hoje)',
  );
}
