// =============================================================================
// HEADCOACH › FINANCEIRO › LIBERAÇÃO DE PAGAMENTO — BAIXA AUTOMÁTICA.
// Botão da aba INCLUÍDOS NO BANCO (pedido do Yago, 24/11/2026): confere nos
// extratos de hoje e até 30 dias para trás se as duplicatas incluídas saíram de
// fato e, onde saiu, grava a baixa e leva a liberação para PAGOS.
//
//   • Extratos = fluxo_caixa_lancamentos (o mesmo extrato da Conciliação: Stone,
//     Pagar.me e o que mais estiver importado), só saídas, sem transferência
//     entre contas e sem as que já foram conciliadas com outra coisa.
//   • As regras de casamento estão em utils/hcCpBaixaAutomatica.js (valor igual
//     + mesmo fornecedor; na dúvida não casa).
//   • A baixa não tem estorno, por isso é em dois passos: sem "confirmar" só
//     devolve o que achou (nada é gravado); com "confirmar", a senha e as
//     liberações que o usuário viu, grava. Data do pagamento = a do extrato;
//     banco = a conta de onde saiu.
//   • A saída usada fica conciliada no extrato (origem MANUAL, automática), para
//     não pagar outra duplicata nem aparecer como pendente na Conciliação.
// Nada vai ao TOTVS.
// =============================================================================
import supabase from '../config/supabase.js';
import { CpError, conferirSenha, rotuloDuplicata } from './hcContasPagar.js';
import { incluidasDoUsuario, pagarUmaLiberacao } from './hcCpLiberacao.js';
import { nomeScore, puxarTudo } from './conciliacaoAprovados.js';
import { atribuirChaves, salvarConciliacao } from './fluxoCaixaConciliacao.js';
import { casarIncluidos, janelaDosExtratos, bancoDaConta, contraparteDaSaida, DIAS_ATRAS } from '../utils/hcCpBaixaAutomatica.js';

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const hojeBrasil = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Recife' }).format(new Date());
const quem = (user) => user?.name || user?.email || null;

/** Saídas dos extratos no período, já sem as transferências entre contas, e quais delas já pagaram outra coisa. */
async function saidasDosExtratos({ de, ate }) {
  const { data: contas, error } = await supabase.from('fluxo_caixa_contas').select('id, banco, apelido, titular_cnpj, escopo');
  if (error) throw new CpError(`Banco de dados: ${error.message}`, 'DB_ERROR', 500);
  const doGrupo = (contas || []).filter((c) => (c.escopo || 'crosby') === 'crosby'); // os extratos do Dr Ygor são de outro escopo
  const contaPorId = new Map(doGrupo.map((c) => [c.id, c]));
  const ids = doGrupo.map((c) => c.id);
  if (!ids.length) return { saidas: [], usadas: new Set(), contaPorId, ultimaSaida: null };
  let todas;
  let conc;
  try {
    [todas, conc] = await Promise.all([
      puxarTudo('fluxo_caixa_lancamentos', 'id,conta_id,data,valor,seq,contraparte_nome,contraparte_doc,memo,descricao,transferencia_id', (q) => q.in('conta_id', ids).lt('valor', 0).gte('data', de).lte('data', ate)),
      puxarTudo('fluxo_caixa_conciliacoes', 'id,chave,conta_id,data,valor', (q) => q.gte('data', de).lte('data', ate)),
    ]);
  } catch (e) {
    throw new CpError(`Não consegui ler os extratos: ${e.message}`, 'DB_ERROR', 500);
  }
  // a chave considera todas as saídas do dia (inclusive transferências), como a Conciliação grava
  atribuirChaves(todas);
  const chaves = new Set(conc.map((c) => c.chave));
  const usadas = new Set(todas.filter((l) => chaves.has(l.chave)).map((l) => l.id));
  // reforço: o extrato é reimportado e o texto pode mudar (a chave muda) — a conciliação
  // sem chave igual ainda consome uma saída da mesma conta, dia e valor
  const lugar = (x) => `${x.conta_id}|${x.data}|${round2(x.valor).toFixed(2)}`;
  const presentes = new Set(todas.map((l) => l.chave));
  const sobrando = new Map();
  for (const c of conc) if (!presentes.has(c.chave)) sobrando.set(lugar(c), (sobrando.get(lugar(c)) || 0) + 1);
  for (const l of todas) {
    const k = lugar(l);
    if (!usadas.has(l.id) && (sobrando.get(k) || 0) > 0) {
      usadas.add(l.id);
      sobrando.set(k, sobrando.get(k) - 1);
    }
  }
  const ultimaSaida = todas.reduce((m, l) => (l.data > m ? l.data : m), '') || null;
  return { saidas: todas.filter((l) => !l.transferencia_id), usadas, contaPorId, ultimaSaida };
}

const daTela = (lib) => ({ id: lib.id, tituloId: lib.titulo_id, empresa: lib.titulo.empresa, fornecedor: lib.titulo.fornecedor_nome, rotulo: rotuloDuplicata(lib.titulo), vencimento: String(lib.titulo.vencimento).slice(0, 10), valor: Number(lib.valor) });

/**
 * b: { confirmar?: boolean, ids?: number[] (liberações que o usuário viu e confirmou), senha? }
 * Sem confirmar → { simulacao: true, periodo, incluidas, casadas: [...], semSaida: [...] } (nada gravado).
 * Com confirmar → { pagas, valorPago, baixadas: [...], ignoradas: [...] }.
 */
export async function baixaAutomatica(user, b = {}) {
  const confirmar = b.confirmar === true || b.confirmar === 'true';
  const incluidas = await incluidasDoUsuario(user); // confere o acesso (financeiro + empresas)
  const hoje = hojeBrasil();
  const periodo = janelaDosExtratos(hoje);
  const porId = new Map(incluidas.map((l) => [l.id, l]));
  const { saidas, usadas, contaPorId, ultimaSaida } = incluidas.length ? await saidasDosExtratos(periodo) : { saidas: [], usadas: new Set(), contaPorId: new Map(), ultimaSaida: null };
  const { casadas, semSaida } = casarIncluidos(incluidas, saidas, { pontuar: nomeScore, usadas });

  const achados = casadas.map((c) => {
    const conta = contaPorId.get(c.saida.conta_id);
    return {
      tipo: c.tipo,
      liberacoes: c.liberacoes.map((id) => daTela(porId.get(id))),
      valor: round2(Math.abs(Number(c.saida.valor))),
      data: c.saida.data,
      banco: bancoDaConta(conta),
      conta: conta?.apelido || null,
      contraparte: contraparteDaSaida(c.saida).slice(0, 120),
      porDocumento: c.pontos >= 2,
      lancamentoId: c.saida.id,
    };
  });
  const base = { periodo: { ...periodo, dias: DIAS_ATRAS, ultimaSaida }, incluidas: incluidas.length };
  if (!confirmar) return { simulacao: true, ...base, casadas: achados, semSaida: semSaida.map((x) => ({ ...daTela(porId.get(x.id)), motivo: x.motivo })) };

  // ── grava: só o que o usuário viu na conferência, e só o que continua casando agora ──
  const confirmadas = new Set((Array.isArray(b.ids) ? b.ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0));
  if (!confirmadas.size) throw new CpError('Nenhuma duplicata foi confirmada para a baixa');
  await conferirSenha(user?.email, b.senha);
  const por = quem(user);
  let pagas = 0;
  let valorPago = 0;
  const baixadas = [];
  const ignoradas = [];
  for (const a of achados) {
    if (!a.liberacoes.every((l) => confirmadas.has(l.id))) continue;
    const pagasDaSaida = [];
    for (const l of a.liberacoes) {
      const rotulo = `${l.fornecedor} ${l.rotulo}`;
      try {
        const r = await pagarUmaLiberacao(porId.get(l.id), { data: a.data, banco: a.banco, por, porId: user?.id || null, observacao: `baixa automática pelo extrato (${a.conta || a.banco} · ${a.contraparte})` });
        pagas += 1;
        valorPago = round2(valorPago + r.pago);
        pagasDaSaida.push(l);
        baixadas.push({ ...l, data: a.data, banco: a.banco, valorPago: r.pago });
      } catch (e) {
        if (!(e instanceof CpError) || e.status === 500) throw e;
        ignoradas.push({ id: l.id, rotulo, motivo: e.message });
      }
    }
    // marca a saída como conciliada no extrato (não derruba a baixa se falhar)
    if (pagasDaSaida.length) {
      try {
        await salvarConciliacao({
          lancamentoId: a.lancamentoId,
          origem: 'MANUAL',
          referencia: { destino: 'contas-pagar-headcoach', nome: pagasDaSaida[0].fornecedor, valor: a.valor, liberacoes: pagasDaSaida.map((l) => ({ liberacaoId: l.id, tituloId: l.tituloId, duplicata: l.rotulo, empresa: l.empresa, valor: l.valor })) },
          justificativa: `Contas a Pagar HeadCoach · ${pagasDaSaida[0].fornecedor} · duplicata ${pagasDaSaida.map((l) => l.rotulo).join(' + ')} (baixa automática da Liberação de Pagamento)`,
          usuario: por,
          automatico: true,
        });
      } catch (e) {
        console.warn(`[baixa automática] a saída ${a.lancamentoId} não ficou conciliada no extrato: ${e.message}`);
      }
    }
  }
  // confirmadas que não casam mais (o extrato mudou ou alguém pagou antes)
  const casando = new Set(achados.flatMap((a) => a.liberacoes.map((l) => l.id)));
  for (const id of confirmadas) {
    if (casando.has(id)) continue;
    const l = porId.get(id);
    ignoradas.push({ id, rotulo: l ? `${l.titulo.fornecedor_nome} ${rotuloDuplicata(l.titulo)}` : `#${id}`, motivo: l ? 'a saída não está mais disponível no extrato' : 'não está mais em Incluídos' });
  }
  if (pagas) console.log(`🏦 [liberação de pagamento] baixa automática: ${pagas} duplicata(s) · R$ ${valorPago.toFixed(2)} · extratos ${periodo.de} a ${periodo.ate} · ${por}`);
  return { ...base, pagas, valorPago, baixadas, ignoradas };
}
