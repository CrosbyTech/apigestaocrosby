/**
 * Job: chamados "Crédito Loja Virtual" do Dryland → crédito do cliente
 * Frequência: de 1 em 1 hora (minuto 7)
 *
 * Pedido do Yago em 23/11/2026: olhar a cada 1 h os chamados do FINANCEIRO que
 * começam com "Crédito Loja Virtual" (peça não encontrada na separação), gerar o
 * crédito do cliente automaticamente e fechar o chamado informando que foi gerado.
 *
 * O que faz e o que NÃO faz está em services/creditoLojaVirtualChamados.js:
 *  - gera o crédito da loja virtual (adiantamento do cliente na empresa 99),
 *    uma vez por chamado (referência "chamado #N");
 *  - responde no chamado e conclui;
 *  - chamado fora do padrão (texto diferente, conta que não fecha, cliente não
 *    encontrado) NÃO é tocado: fica aberto para o Financeiro e gera um aviso no
 *    sino do HeadCoach, uma vez só por chamado.
 *
 * Desligar sem deploy: CREDITO_LV_CHAMADOS_JOB=off no ambiente.
 * À mão: node scripts/creditos-loja-virtual-chamados.mjs [aplicar]
 */
import cron from 'node-cron';
import { processarChamadosCreditoLv } from '../services/creditoLojaVirtualChamados.js';
import { criarNotificacaoSistema } from '../services/notificacoesSistema.js';

const ROLES_NOTIFICACAO = ['user', 'admin', 'owner'];
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const jaAvisados = new Set(); // chamados não tratados já avisados (não repete a cada hora)
let rodando = false;

export async function rodarCreditoLvChamados() {
  if (rodando) return null;
  rodando = true;
  try {
    const r = await processarChamadosCreditoLv({ log: (m) => console.log(`✅ [credito-lv] ${m}`) });
    const feitos = [...r.gerados, ...r.jaTinham];
    if (r.gerados.length) {
      await criarNotificacaoSistema({
        tipo: 'DRYLAND_CREDITO_LV_GERADO',
        nivel: 'success',
        titulo: `${r.gerados.length} crédito(s) da Loja Virtual gerado(s) automaticamente (${brl(r.gerados.reduce((s, i) => s + i.valor, 0))})`,
        mensagem: r.gerados.map((i) => `#${i.numero} ${i.pedido} · ${i.clienteNome} · ${brl(i.valor)}`).join(' | ').slice(0, 900),
        roles: ROLES_NOTIFICACAO,
        dados: { gerados: r.gerados, jaTinham: r.jaTinham },
      });
    }
    const parados = [...r.pulados.map((p) => ({ ...p, porque: p.motivo })), ...r.erros.map((e) => ({ ...e, porque: e.erro }))].filter((p) => !jaAvisados.has(p.numero));
    if (parados.length) {
      for (const p of parados) jaAvisados.add(p.numero);
      await criarNotificacaoSistema({
        tipo: 'DRYLAND_CREDITO_LV_PENDENTE',
        nivel: 'warning',
        titulo: `${parados.length} chamado(s) "Crédito Loja Virtual" precisam de alguém do Financeiro`,
        mensagem: parados.map((p) => `#${p.numero}: ${p.porque}`).join(' | ').slice(0, 900),
        roles: ROLES_NOTIFICACAO,
        dados: { parados },
      });
    }
    if (feitos.length || r.pulados.length || r.erros.length) {
      console.log(`🧾 [credito-lv] ${r.gerados.length} gerado(s), ${r.jaTinham.length} já lançado(s) e concluído(s), ${r.pulados.length} fora do padrão, ${r.erros.length} erro(s)`);
      for (const e of r.erros) console.warn(`⚠️ [credito-lv] #${e.numero}: ${e.erro}`);
    }
    return r;
  } catch (e) {
    console.error(`❌ [credito-lv] falha no ciclo: ${e.message}`);
    return null;
  } finally {
    rodando = false;
  }
}

export function iniciarJobCreditoLvChamados() {
  if (String(process.env.CREDITO_LV_CHAMADOS_JOB || '').toLowerCase() === 'off') {
    console.log('⏸️ [credito-lv] desligado (CREDITO_LV_CHAMADOS_JOB=off)');
    return;
  }
  cron.schedule('7 * * * *', rodarCreditoLvChamados, { timezone: 'America/Sao_Paulo' });
  console.log('⏰ [credito-lv] Agendado de 1 em 1 hora · chamados "Crédito Loja Virtual" → crédito do cliente + chamado concluído');
}
