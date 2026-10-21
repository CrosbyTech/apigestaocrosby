// ─────────────────────────────────────────────────────────────────────────
// JOJO — job que LÊ o grupo do Contas a Pagar de 5 em 5 min, SEM IA externa.
//
// Sem LLM o agente não interpreta texto livre; ele reage por REGRAS:
//   1) Toda rodada, lê as mensagens novas do grupo (desde a última lida,
//      estado persistido em jojo_grupo_estado).
//   2) Se um número AUTORIZADO manda uma PLANILHA (.xlsx) de observações,
//      a JOJO roda o cruzamento (preview) e responde o resumo no grupo,
//      pedindo "SUBIR MM/AAAA" pra gravar. Nada é alterado ainda.
//   3) Se um número AUTORIZADO responde "SUBIR MM/AAAA", a JOJO importa as
//      observações daquela planilha para o período e responde o resultado.
//
// Tudo determinístico. Liga/desliga por env (desligado por padrão):
//   JOJO_GRUPO_JOB_ENABLED=true
//   JOJO_GRUPO_JOB_CRON=*/5 * * * *            (opcional)
//   JOJO_GRUPO_CHATID=120363414933413909@g.us  (herda do bot)
//   JOJO_NUMEROS_AUTORIZADOS=5584987187425,558496280021,558487057257
//   JOJO_IMPORT_CD_USUARIO=<uuid>              (dono das observações; senão resolve pelo e-mail do Yago)
// ─────────────────────────────────────────────────────────────────────────
import cron from 'node-cron';
import supabase from '../config/supabase.js';
import * as wa from '../services/whatsappContasPagar.js';
import * as obs from '../services/dreObservacoes.js';

const ENABLED = String(process.env.JOJO_GRUPO_JOB_ENABLED ?? 'false').toLowerCase() === 'true';
const CRON = process.env.JOJO_GRUPO_JOB_CRON || '*/5 * * * *';
const GRUPO = process.env.JOJO_GRUPO_CHATID || '120363414933413909@g.us';
const AUTORIZADOS = new Set(
  String(process.env.JOJO_NUMEROS_AUTORIZADOS || '5584987187425,558496280021,558487057257')
    .split(',')
    .map((s) => s.replace(/\D/g, ''))
    .filter(Boolean),
);
const EST_TABELA = 'jojo_grupo_estado';

let cdUsuarioImport = process.env.JOJO_IMPORT_CD_USUARIO || null;
let rodando = false;
let ultimaPlanilha = null; // { msgId, em } — última planilha vista de um autorizado

const soDigitos = (s) => String(s || '').split('@')[0].split(':')[0].replace(/\D/g, '');

// ─── estado persistido (última mensagem processada) ───────────────────────
async function garantirEstado() {
  const { error } = await supabase.from(EST_TABELA).select('chave').limit(1);
  if (!error) return;
  const ddl = `create table if not exists ${EST_TABELA} (chave text primary key, valor text, atualizado_em timestamptz not null default now());`;
  let r = await supabase.rpc('exec_sql', { query: ddl });
  if (r.error && /exec_sql\(query\)/.test(r.error.message || '')) await supabase.rpc('exec_sql', { sql: ddl });
}
async function lerUltimoTs() {
  const { data } = await supabase.from(EST_TABELA).select('valor').eq('chave', 'ultimo_ts').maybeSingle();
  return data?.valor ? Number(data.valor) : 0;
}
async function salvarUltimoTs(ts) {
  await supabase.from(EST_TABELA).upsert({ chave: 'ultimo_ts', valor: String(ts), atualizado_em: new Date().toISOString() }, { onConflict: 'chave' });
}

async function resolverCdUsuario() {
  if (cdUsuarioImport) return cdUsuarioImport;
  try {
    const { data } = await supabase.from('usuarios_view').select('id').ilike('email', 'trafegocrosby%').limit(1);
    if (data?.[0]?.id) cdUsuarioImport = data[0].id;
  } catch {
    /* ignora */
  }
  return cdUsuarioImport;
}

// ─── parsing de comandos (sem IA) ──────────────────────────────────────────
const MESES_EXT = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };
const normtxt = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Reconhece "subir 09/2026", "subir set/2026", "subir setembro 2026"
export function parseComandoSubir(texto) {
  const t = normtxt(texto).trim();
  if (!/\bsubir\b/.test(t)) return null;
  let mes = null;
  let ano = null;
  let m = t.match(/(\d{1,2})\s*[\/\-.]\s*(\d{4})/); // 09/2026
  if (m) {
    mes = Number(m[1]);
    ano = Number(m[2]);
  } else {
    m = t.match(/([a-z]{3,})\s*[\/\-.\s]\s*(\d{4})/); // setembro 2026 / set 2026
    if (m) {
      const chave = Object.keys(MESES_EXT).find((k) => k.startsWith(m[1].slice(0, 3)));
      if (chave) {
        mes = MESES_EXT[chave];
        ano = Number(m[2]);
      }
    }
  }
  if (!mes || !ano || mes < 1 || mes > 12) return { incompleto: true };
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return {
    mes,
    ano,
    dtInicio: `${ano}-${String(mes).padStart(2, '0')}-01`,
    dtFim: `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`,
  };
}

function autorizado(m) {
  const n = soDigitos(m.remetentePn || m.sender_pn || m.remetenteId || m.sender);
  return n && AUTORIZADOS.has(n);
}

// ─── rodada ────────────────────────────────────────────────────────────────
async function responder(texto, replyid) {
  try {
    await wa.enviarTexto({ number: GRUPO, text: `${texto}\n\n— Jojo`, replyid, trackId: 'jojo-job' });
  } catch (e) {
    console.warn(`[jojo-job] falha ao responder: ${e.message}`);
  }
}

async function tratarPlanilha(m) {
  const r = await wa.baixarMidia(m.id, { base64: true });
  const ehXlsx =
    /sheet|excel|spreadsheet/i.test(r.mimetype || '') ||
    /\.(xlsx|xls|csv)$/i.test(m.nomeArquivo || '');
  if (!ehXlsx) return false;
  const buffer = r.base64 ? Buffer.from(r.base64, 'base64') : null;
  if (!buffer) return false;
  ultimaPlanilha = { msgId: m.id, em: m.em };
  const p = obs.preview(buffer);
  if (p.colunas_faltando?.length) {
    await responder(`📄 Recebi a planilha, mas faltam colunas pra casar com o HeadCoach: *${p.colunas_faltando.join(', ')}*. ${p.observacao}`, m.id);
    return true;
  }
  await responder(
    `📄 Planilha recebida: *${p.total_linhas}* lançamentos, *${p.prontas}* com observação pronta pra gravar (${p.sem_observacao} em branco).\n\nPra eu gravar no HeadCoach, responda *SUBIR MM/AAAA* (ex.: SUBIR 09/2026).`,
    m.id,
  );
  return true;
}

async function tratarSubir(m, cmd) {
  if (cmd.incompleto) {
    await responder('Pra gravar eu preciso do mês: responda *SUBIR MM/AAAA* (ex.: SUBIR 09/2026).', m.id);
    return;
  }
  if (!ultimaPlanilha) {
    await responder('Não tenho uma planilha recente aqui no grupo pra gravar. Me reenvia o arquivo e depois mande *SUBIR MM/AAAA*.', m.id);
    return;
  }
  const r = await wa.baixarMidia(ultimaPlanilha.msgId, { base64: true });
  const buffer = r.base64 ? Buffer.from(r.base64, 'base64') : null;
  if (!buffer) {
    await responder('Não consegui baixar a última planilha. Me reenvia, por favor.', m.id);
    return;
  }
  const cdUsuario = await resolverCdUsuario();
  if (!cdUsuario) {
    await responder('Não consegui identificar o usuário dono das observações no HeadCoach (configure JOJO_IMPORT_CD_USUARIO).', m.id);
    return;
  }
  const res = await obs.importar({ buffer, dtInicio: cmd.dtInicio, dtFim: cmd.dtFim, cdUsuario, por: 'jojo-job', substituir: false });
  await responder(
    `✅ Pronto! Gravei *${res.gravadas}* observações de ${String(cmd.mes).padStart(2, '0')}/${cmd.ano} nos lançamentos do HeadCoach` +
      `${res.puladas ? ` (${res.puladas} já existiam/puladas)` : ''}${res.erros ? ` · ${res.erros} erros` : ''}.`,
    m.id,
  );
}

async function rodar() {
  if (rodando) return;
  rodando = true;
  try {
    await garantirEstado();
    const ultimoTs = await lerUltimoTs();
    const { mensagens } = await wa.buscarMensagens({ chatid: GRUPO, limit: 30 });
    const novas = mensagens
      .filter((m) => m.em && new Date(m.em).getTime() > ultimoTs && !m.deMim)
      .sort((a, b) => new Date(a.em) - new Date(b.em));
    if (!novas.length) return;

    let maiorTs = ultimoTs;
    for (const m of novas) {
      maiorTs = Math.max(maiorTs, new Date(m.em).getTime());
      if (!autorizado(m)) continue; // sem IA: só age em comando de autorizado
      try {
        const cmd = parseComandoSubir(m.texto);
        if (cmd) {
          await tratarSubir(m, cmd);
        } else if ((m.tipo === 'DocumentMessage' || m.temMidia) && !/^image/i.test(m.tipo || '')) {
          await tratarPlanilha(m);
        }
      } catch (e) {
        console.warn(`[jojo-job] erro tratando msg ${m.id}: ${e.message}`);
      }
    }
    await salvarUltimoTs(maiorTs);
    console.log(`🤖 [jojo-job] ${novas.length} msg nova(s) processada(s)`);
  } catch (e) {
    console.warn(`[jojo-job] rodada falhou: ${e.message}`);
  } finally {
    rodando = false;
  }
}

export function iniciarJojoGrupoJob() {
  if (!ENABLED) {
    console.log('ℹ️ [jojo-job] desligado (JOJO_GRUPO_JOB_ENABLED != true)');
    return;
  }
  if (!wa.isConfigurado()) {
    console.warn('⚠️ [jojo-job] WhatsApp Contas a Pagar não configurado — job não inicia');
    return;
  }
  cron.schedule(CRON, rodar, { timezone: 'America/Sao_Paulo' });
  console.log(`🤖 [jojo-job] agendado (${CRON}) — lê o grupo ${GRUPO}; autorizados: ${[...AUTORIZADOS].join(', ')}`);
}
