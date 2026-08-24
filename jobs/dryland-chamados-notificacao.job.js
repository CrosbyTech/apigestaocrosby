/**
 * Job: Notificação de chamados novos do Dryland
 * Frequência: a cada 5 minutos
 *
 * Regra de negócio:
 *  - O Dryland guarda os chamados da rede no Supabase "Cérebro" (mesma RPC
 *    chamado_listar que a página /tecnologia/chamados-dryland usa).
 *  - A cada ciclo busca a lista e detecta os chamados CRIADOS depois da última
 *    verificação, nos setores vigiados (fiscal, tecnologia, financeiro).
 *  - Cada chamado novo vira uma notificação em `notificacoes_sistema`, que o
 *    sino do HeadCoach já lê e segmenta por papel.
 *  - Destinatários: Financeiro ('user'), Administrador ('admin') e
 *    Proprietário ('owner').
 *
 * Marca d'água (evita notificar duas vezes):
 *  - Guardada na própria `notificacoes_sistema`: na primeira execução após o
 *    boot, lê o `dados->>criado_em` da notificação mais recente do tipo
 *    DRYLAND_CHAMADO_NOVO e retoma dali. Sem histórico, começa de "agora" —
 *    ou seja, um servidor novo nunca dispara um lote de chamados antigos.
 */

import cron from 'node-cron';
import axios from 'axios';
import supabase from '../config/supabase.js';
import { criarNotificacaoSistema } from '../services/notificacoesSistema.js';

// Papéis que recebem: Financeiro ('user' no AuthContext), Admin e Proprietário
const ROLES_NOTIFICACAO = ['user', 'admin', 'owner'];

// Setores vigiados
const SETORES_VIGIADOS = ['fiscal', 'tecnologia', 'financeiro'];

const TIPO = 'DRYLAND_CHAMADO_NOVO';

// Supabase "Cérebro" do Dryland (mesma origem da rota /api/dryland)
const DRYLAND_URL =
  process.env.DRYLAND_SUPABASE_URL || 'https://umhczriycvtagjqjnrzm.supabase.co';
const DRYLAND_KEY =
  process.env.DRYLAND_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtaGN6cml5Y3Z0YWdqcWpucnptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2NTAyOTEsImV4cCI6MjA5MzIyNjI5MX0.SVWG6_7DZNv-Tz4AgRwQ1791lAEWgpcEv15k9rERlwI';

// Teto de notificações por ciclo: se algo estranho acontecer (marca d'água
// perdida, importação em massa no Dryland), não inunda o sino de todo mundo.
const MAX_POR_CICLO = 15;

const SETOR_LABEL = {
  fiscal: 'Fiscal',
  tecnologia: 'Tecnologia',
  financeiro: 'Financeiro',
};

let marcaDagua = null; // ISO string do criado_em mais recente já notificado
let JOB_EM_EXECUCAO = false;

async function listarChamados() {
  const { data } = await axios.post(
    `${DRYLAND_URL}/rest/v1/rpc/chamado_listar`,
    {},
    {
      headers: {
        'Content-Type': 'application/json',
        apikey: DRYLAND_KEY,
        Authorization: `Bearer ${DRYLAND_KEY}`,
      },
      timeout: 30000,
    },
  );
  return Array.isArray(data) ? data : [];
}

/**
 * Retoma a marca d'água de onde parou. Chamado só uma vez, no primeiro ciclo
 * depois do boot.
 */
async function carregarMarcaDagua() {
  try {
    const { data, error } = await supabase
      .from('notificacoes_sistema')
      .select('dados')
      .eq('tipo', TIPO)
      .order('dt_criacao', { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    const ultimo = data?.[0]?.dados?.criado_em;
    if (ultimo) {
      console.log(`⏰ [dryland-chamados] retomando do último notificado: ${ultimo}`);
      return ultimo;
    }
  } catch (e) {
    console.error('[dryland-chamados] não consegui ler a marca d\'água:', e.message);
  }
  // sem histórico: começa de agora pra não notificar chamado antigo
  const agora = new Date().toISOString();
  console.log(`⏰ [dryland-chamados] sem histórico — vigiando a partir de ${agora}`);
  return agora;
}

function textoDoChamado(c) {
  const setor = SETOR_LABEL[c.setor] || c.setor;
  const partes = [`Setor ${setor}`];
  if (c.loja_nome) partes.push(c.loja_nome);
  if (c.aberto_por) partes.push(`aberto por ${c.aberto_por}`);
  if (c.responsavel_nome) partes.push(`responsável ${c.responsavel_nome}`);
  return partes.join(' · ');
}

export async function verificarChamadosNovos() {
  if (marcaDagua === null) marcaDagua = await carregarMarcaDagua();

  const lista = await listarChamados();
  const novos = lista
    .filter((c) => SETORES_VIGIADOS.includes(c.setor))
    .filter((c) => c.criado_em && c.criado_em > marcaDagua)
    .sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em)));

  if (novos.length === 0) return { novos: 0, notificados: 0 };

  // avança a marca d'água considerando TUDO que foi detectado, mesmo o que for
  // cortado pelo teto — senão o excedente reapareceria a cada ciclo
  const maiorCriadoEm = novos[novos.length - 1].criado_em;

  const aNotificar = novos.slice(0, MAX_POR_CICLO);
  const cortados = novos.length - aNotificar.length;

  let notificados = 0;
  for (const c of aNotificar) {
    const ok = await criarNotificacaoSistema({
      tipo: TIPO,
      nivel: c.urgente ? 'warning' : 'info',
      titulo: `Chamado #${c.numero} — ${SETOR_LABEL[c.setor] || c.setor}`,
      mensagem: `${c.assunto || 'sem assunto'} · ${textoDoChamado(c)}`,
      roles: ROLES_NOTIFICACAO,
      dados: {
        chamado_id: c.id,
        numero: c.numero,
        setor: c.setor,
        assunto: c.assunto,
        loja_nome: c.loja_nome,
        loja_cd: c.loja_cd,
        aberto_por: c.aberto_por,
        responsavel_nome: c.responsavel_nome,
        direcao: c.direcao,
        prazo: c.prazo,
        criado_em: c.criado_em,
      },
    });
    if (ok) notificados++;
  }

  if (cortados > 0) {
    console.warn(
      `⚠️ [dryland-chamados] ${cortados} chamado(s) acima do teto de ${MAX_POR_CICLO} não viraram notificação (marca d'água avançou mesmo assim).`,
    );
    await criarNotificacaoSistema({
      tipo: TIPO,
      nivel: 'warning',
      titulo: `Mais ${cortados} chamado(s) novos no Dryland`,
      mensagem: `Chegaram ${novos.length} chamados de uma vez. Os ${MAX_POR_CICLO} primeiros viraram notificação; abra a tela de Chamados Dryland para ver o restante.`,
      roles: ROLES_NOTIFICACAO,
      // sem chamado_id: é um resumo, não um chamado específico.
      // criado_em entra para a marca d'água não regredir.
      dados: { resumo: true, total: novos.length, criado_em: maiorCriadoEm },
    });
  }

  marcaDagua = maiorCriadoEm;
  console.log(
    `⏰ [dryland-chamados] ${notificados} notificação(ões) criada(s) · marca d'água: ${marcaDagua}`,
  );
  return { novos: novos.length, notificados };
}

async function rodar() {
  if (JOB_EM_EXECUCAO) {
    console.log('[dryland-chamados] ciclo anterior ainda rodando — pulando.');
    return;
  }
  JOB_EM_EXECUCAO = true;
  try {
    await verificarChamadosNovos();
  } catch (e) {
    // erro aqui nunca pode derrubar o processo: é só um ciclo perdido,
    // o próximo tenta de novo a partir da mesma marca d'água
    console.error('[dryland-chamados] falha no ciclo:', e.message);
  } finally {
    JOB_EM_EXECUCAO = false;
  }
}

export function iniciarJobDrylandChamados() {
  // a cada 5 minutos
  cron.schedule('*/5 * * * *', rodar, { timezone: 'America/Sao_Paulo' });
  console.log(
    `⏰ [dryland-chamados] Agendado a cada 5min · setores: ${SETORES_VIGIADOS.join(', ')} · papéis: ${ROLES_NOTIFICACAO.join(', ')}`,
  );
}
