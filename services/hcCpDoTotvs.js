// =============================================================================
// CONSULTA DO CONTAS A PAGAR (antiga) → HEADCOACH.
// Pedido do Yago (25/11/2026): o botão "Enviar para Pagamento" da Consulta antiga
// passa a CRIAR a duplicata no Contas a Pagar do HeadCoach (em aberto, com a marca
// TOTVS) e a mandá-la para a Liberação de Pagamento do HeadCoach — não mais para a
// Liberação antiga.
//
//   • a duplicata nasce com origem "totvs" e origem_ref = empresa|fornecedor|
//     duplicata|parcela do TOTVS (a mesma chave da importação dos pagos): enviar de
//     novo não duplica, e a importação dos pagos reconhece que ela já está aqui;
//   • se a duplicata já existe no HeadCoach (por essa chave ou pelo mesmo número de
//     documento do fornecedor na empresa), só é liberada;
//   • a que já está paga ou já está na Liberação fica de fora, com o motivo.
// Nada é gravado no TOTVS.
// =============================================================================
import crypto from 'node:crypto';
import supabase from '../config/supabase.js';
import { CpError, empresasPermitidas } from './hcContasPagar.js';
import { liberarTitulos } from './hcCpLiberacao.js';
import { chaveTotvs, linhaAbertaDoTituloTotvs, numerarDuplicatas } from '../utils/hcCpTotvs.js';

const quem = (user) => user?.name || user?.email || null;
async function q(promessa) {
  const { data, error } = await promessa;
  if (error) throw new CpError(`Banco de dados: ${error.message}`, 'DB_ERROR', 500);
  return data;
}
async function todas(montar) {
  const out = [];
  for (let de = 0; ; de += 1000) {
    const lote = await q(montar().range(de, de + 999));
    out.push(...(lote || []));
    if (!lote || lote.length < 1000) break;
  }
  return out;
}

/**
 * b: { itens: [linha da Consulta antiga: cd_empresa, cd_fornecedor, nm_fornecedor, nr_duplicata, nr_parcela,
 *      nr_portador, cd_despesaitem, ds_despesaitem, cd_ccusto, ds_ccusto, dt_emissao, dt_vencimento, vl_duplicata, …] }
 * @returns {{ criadas, jaExistiam, liberadas, ignoradas: [{ rotulo, motivo }] }}
 */
export async function enviarDoTotvsParaLiberacao(user, b = {}) {
  const { codes } = await empresasPermitidas(user); // só o financeiro, e só das empresas dele
  const itens = (Array.isArray(b.itens) ? b.itens : []).filter((i) => i && typeof i === 'object');
  if (!itens.length) throw new CpError('Selecione ao menos um título');
  if (itens.length > 500) throw new CpError('No máximo 500 títulos por envio');
  const permitidas = new Set(codes);
  const por = quem(user);
  const ignoradas = [];
  const rotuloDe = (i) => `${String(i.nm_fornecedor || i.cd_fornecedor || '').slice(0, 40)} ${i.nr_duplicata}${i.nr_parcela ? `/${i.nr_parcela}` : ''}`;

  const [portadores, centros, despesas] = await Promise.all([
    todas(() => supabase.from('erp_portadores').select('code, descricao').order('code')),
    todas(() => supabase.from('hc_cp_centros_custo').select('code, nome').order('code')),
    todas(() => supabase.from('hc_cp_despesas').select('code, nome').order('code')),
  ]);
  const nomes = { portador: new Map(portadores.map((p) => [p.code, p.descricao])), centro: new Map(centros.map((c) => [c.code, c.nome])), despesa: new Map(despesas.map((d) => [d.code, d.nome])) };

  // linhas candidatas (uma por chave do TOTVS)
  const vistas = new Set();
  const candidatas = [];
  for (const item of itens) {
    const ref = chaveTotvs(item);
    if (vistas.has(ref)) continue;
    vistas.add(ref);
    if (!permitidas.has(Number(item.cd_empresa))) {
      ignoradas.push({ rotulo: rotuloDe(item), motivo: `você não tem acesso à empresa ${item.cd_empresa}` });
      continue;
    }
    const linha = linhaAbertaDoTituloTotvs(item, nomes, { por });
    if (!linha) {
      ignoradas.push({ rotulo: rotuloDe(item), motivo: 'sem valor, vencimento ou fornecedor' });
      continue;
    }
    candidatas.push(linha);
  }
  if (!candidatas.length) return { criadas: 0, jaExistiam: 0, liberadas: 0, ignoradas };

  // o que os fornecedores envolvidos já têm no HeadCoach
  const fornecedores = [...new Set(candidatas.map((l) => l.fornecedor_code))];
  const existentes = [];
  for (let i = 0; i < fornecedores.length; i += 200) existentes.push(...(await todas(() => supabase.from('hc_cp_titulos').select('id, empresa, fornecedor_code, duplicata, parcela, documento_fiscal, origem, origem_ref, situacao').in('fornecedor_code', fornecedores.slice(i, i + 200)).order('id'))));
  const vivos = existentes.filter((e) => e.situacao !== 'cancelado');
  const jaTem = (l) => vivos.find((e) => e.origem === 'totvs' && e.origem_ref === l.origem_ref) || vivos.find((e) => Number(e.empresa) === l.empresa && Number(e.fornecedor_code) === l.fornecedor_code && String(e.documento_fiscal || '') === l.documento_fiscal && Number(e.parcela) === l.parcela);

  const ids = [];
  const novas = [];
  let jaExistiam = 0;
  for (const l of candidatas) {
    const e = jaTem(l);
    if (!e) novas.push(l);
    else if (e.situacao === 'pago') ignoradas.push({ rotulo: `${l.fornecedor_nome.slice(0, 40)} ${l.documento_fiscal}/${l.parcela}`, motivo: 'já está paga no Contas a Pagar HeadCoach' });
    else {
      jaExistiam += 1;
      ids.push(e.id);
    }
  }

  // cria as que faltam
  let criadas = 0;
  if (novas.length) {
    // CPF/CNPJ do fornecedor (a Consulta antiga nem sempre traz): vem da cópia do cadastro
    const semDoc = [...new Set(novas.filter((l) => !l.fornecedor_cpf_cnpj).map((l) => l.fornecedor_code))];
    if (semDoc.length) {
      const pessoas = await q(supabase.from('erp_pessoas').select('code, cpf_cnpj').in('code', semDoc));
      const doc = new Map((pessoas || []).map((p) => [Number(p.code), String(p.cpf_cnpj || '').replace(/\D/g, '') || null]));
      for (const l of novas) if (!l.fornecedor_cpf_cnpj) l.fornecedor_cpf_cnpj = doc.get(l.fornecedor_code) || null;
    }
    const { linhas, conflitos } = numerarDuplicatas(novas, existentes);
    for (const c of conflitos || []) ignoradas.push({ rotulo: `${String(c.fornecedor_nome || '').slice(0, 40)} ${c.documento_fiscal}/${c.parcela}`, motivo: 'essa parcela já existe nessa duplicata no HeadCoach' });
    if (linhas.length) {
      // despesas que ainda não existem no plano do HeadCoach (a duplicata aponta para elas)
      const despesasNovas = [...new Map(linhas.flatMap((l) => l.rateio || []).filter((r) => !nomes.despesa.has(r.despesa_code)).map((r) => [r.despesa_code, r.despesa_nome])).entries()];
      if (despesasNovas.length) await q(supabase.from('hc_cp_despesas').upsert(despesasNovas.map(([code, nome]) => ({ code, nome: nome || `DESPESA ${code}` })), { onConflict: 'code', ignoreDuplicates: true }));
      const lotes = new Map();
      const prontas = linhas.map((l) => {
        const g = `${l.empresa}|${l.fornecedor_code}|${l.documento_fiscal}`;
        if (!lotes.has(g)) lotes.set(g, crypto.randomUUID());
        return { ...l, lote: lotes.get(g) };
      });
      const gravadas = await q(supabase.from('hc_cp_titulos').insert(prontas).select('id'));
      criadas = (gravadas || []).length;
      ids.push(...(gravadas || []).map((t) => t.id));
    }
  }

  // manda para a Liberação de Pagamento do HeadCoach
  let liberadas = 0;
  if (ids.length) {
    const r = await liberarTitulos(user, { ids });
    liberadas = r.liberadas;
    ignoradas.push(...(r.ignoradas || []).map((i) => ({ rotulo: i.rotulo, motivo: i.motivo })));
  }
  console.log(`📥 [consulta antiga → HeadCoach] ${criadas} duplicata(s) criada(s), ${jaExistiam} já existiam, ${liberadas} liberada(s) para pagamento · ${por}`);
  return { criadas, jaExistiam, liberadas, ignoradas };
}

export default { enviarDoTotvsParaLiberacao };
