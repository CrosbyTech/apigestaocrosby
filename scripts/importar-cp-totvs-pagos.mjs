// =============================================================================
// Importa para o HEADCOACH › CONTAS A PAGAR os títulos PAGOS do contas a pagar
// do TOTVS, com a marca "TOTVS" (origem = 'totvs'). Vê os mesmos dados da tela
// Contas a Pagar › Consulta: baixa do TOTVS, PAGO VIA CONCILIAÇÃO e PAGO na
// Liberação de Pagamento — só entra o que tem data de liquidação e valor pago > 0.
//
//   node scripts/importar-cp-totvs-pagos.mjs --mes=2026-11                  simula por vencimento no mês
//   node scripts/importar-cp-totvs-pagos.mjs --mes=2026-11 --por=pagamento  simula por data de pagamento no mês
//   node scripts/importar-cp-totvs-pagos.mjs --mes=2026-11 --por=ambos      só o que vence E foi pago no mês
//   ... --parcial=1:6455595                                                  empresa:duplicata do TOTVS paga EM PARTE: entra em aberto pelo que falta
//   ... --so=99:196412,1:65556                                               só esses títulos (empresa:duplicata do TOTVS)
//   ... --listar                                                             mostra todos os títulos, não só a amostra
//   ... --gravar                                                            grava (rodar de novo não duplica)
//   ... --com-bancos                                                        inclui as faturas de banco que a Consulta esconde
//
// Nada é alterado no TOTVS. No HeadCoach os títulos nascem pagos e não se apagam.
// =============================================================================
import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import supabase from '../config/supabase.js';
import financeiroRouter from '../totvsrouter/financeiro.js';
import { ocultoNaConsulta, pagamentoDoTitulo, pagoParaImportar, linhaDoTituloTotvs, numerarDuplicatas, chaveTotvs, rotuloDaVia, baixasDoTituloTotvs, faltaDoTotvs } from '../utils/hcCpTotvs.js';

const args = process.argv.slice(2);
const opt = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] || null;
const flag = (n) => args.includes(`--${n}`);
const MES = opt('mes');
const POR = opt('por') || 'vencimento';
if (!/^\d{4}-\d{2}$/.test(MES || '') || !['vencimento', 'pagamento', 'ambos'].includes(POR)) {
  console.log('uso: node scripts/importar-cp-totvs-pagos.mjs --mes=AAAA-MM [--por=vencimento|pagamento|ambos] [--gravar] [--com-bancos]');
  process.exit(1);
}
const DE = `${MES}-01`;
const ATE = new Date(Date.UTC(Number(MES.slice(0, 4)), Number(MES.slice(5, 7)), 0)).toISOString().slice(0, 10);
const noMes = (d) => Boolean(d) && d >= DE && d <= ATE;
const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// a mesma rota da tela, chamada aqui dentro (sem passar pela internet)
const app = express();
app.use(express.json({ limit: '50mb' }));
app.use('/api/totvs', financeiroRouter);
const srv = app.listen(0);
const URL = `http://127.0.0.1:${srv.address().port}/api/totvs/accounts-payable/search`;

async function consulta(corpo) {
  const r = await fetch(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ situacao: 'N', previsao: 'TODOS', filtroPagamento: 'TODOS', ...corpo }) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j) throw new Error(`consulta do contas a pagar: HTTP ${r.status} ${j?.message || ''}`);
  return Array.isArray(j.data) ? j.data : Array.isArray(j.data?.data) ? j.data.data : [];
}

async function todas(montar) {
  const out = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await montar().range(de, de + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}
async function emLotes(lista, tamanho, fn) {
  const out = [];
  for (let i = 0; i < lista.length; i += tamanho) out.push(...(await fn(lista.slice(i, i + tamanho))));
  return out;
}

try {
  const empresas = (await todas(() => supabase.from('erp_empresas').select('code').order('code'))).map((e) => e.code);
  console.log(`▶ pagos do contas a pagar · ${MES} · por ${POR} · ${empresas.length} empresas${flag('gravar') ? ' · GRAVANDO' : ' · simulação'}`);

  // 1) títulos do TOTVS no período
  let itens = [];
  if (POR !== 'pagamento') itens = await consulta({ dt_inicio: DE, dt_fim: ATE, branches: empresas, modo: 'vencimento' });
  else {
    // baixados no TOTVS no mês + os pagos no mês pela conciliação ou pela Liberação (buscados pelo número)
    itens = await consulta({ dt_inicio: DE, dt_fim: ATE, branches: empresas, modo: 'liquidacao' });
    const conc = await todas(() => supabase.from('contas_pagar_pagos_conciliacao').select('nr_duplicata').gte('dt_pagamento', DE).lte('dt_pagamento', ATE).order('id'));
    const lib = await todas(() => supabase.from('pagamentos_liberacao').select('nr_duplicata').eq('status', 'PAGO').gte('dt_pagamento', DE).lte('dt_pagamento', ATE).order('id'));
    const numeros = [...new Set([...conc, ...lib].map((x) => Number(x.nr_duplicata)).filter((n) => Number.isInteger(n) && n > 0 && n <= 2147483647))];
    const extras = await emLotes(numeros, 80, (lote) => consulta({ dt_inicio: '2024-01-01', dt_fim: '2028-12-31', branches: empresas, modo: 'vencimento', duplicateCodeList: lote }));
    const vistos = new Set(itens.map(chaveTotvs));
    for (const e of extras) if (!vistos.has(chaveTotvs(e))) { vistos.add(chaveTotvs(e)); itens.push(e); }
  }
  console.log(`títulos lidos do contas a pagar: ${itens.length}`);

  // 2) o que a Consulta esconde
  const ocultos = itens.filter(ocultoNaConsulta);
  if (!flag('com-bancos')) itens = itens.filter((i) => !ocultoNaConsulta(i));

  // 3) pagos via conciliação e via Liberação
  const numeros = [...new Set(itens.map((i) => String(i.nr_duplicata)).filter(Boolean))];
  const conciliacoes = await emLotes(numeros, 200, async (lote) => {
    const { data, error } = await supabase.from('contas_pagar_pagos_conciliacao').select('nr_duplicata, cd_empresa, nr_parcela, cd_fornecedor, dt_pagamento, vl_pago, banco').in('nr_duplicata', lote);
    if (error) throw new Error(error.message);
    return data || [];
  });
  const liberacoes = await emLotes(numeros, 200, async (lote) => {
    const { data, error } = await supabase.from('pagamentos_liberacao').select('nr_duplicata, cd_empresa, nr_parcela, cd_fornecedor, vl_duplicata, vl_real, dt_pagamento, pago_em, banco_pagamento, forma_pagamento').eq('status', 'PAGO').in('nr_duplicata', lote);
    if (error) throw new Error(error.message);
    return data || [];
  });
  const concPorNumero = new Map();
  for (const c of conciliacoes) concPorNumero.set(String(c.nr_duplicata), [...(concPorNumero.get(String(c.nr_duplicata)) || []), c]);
  const libPorNumero = new Map();
  for (const l of liberacoes) libPorNumero.set(String(l.nr_duplicata), [...(libPorNumero.get(String(l.nr_duplicata)) || []), l]);

  // 4) quem está pago, com data de liquidação e valor pago
  const pagos = [];
  let semValorOuData = 0;
  for (const item of itens) {
    const pg = pagamentoDoTitulo(item, { conciliacoes: concPorNumero.get(String(item.nr_duplicata)), liberacoes: libPorNumero.get(String(item.nr_duplicata)) });
    if (!pg) continue;
    if (!pagoParaImportar(pg)) { semValorOuData += 1; continue; }
    if (POR !== 'vencimento' && !noMes(pg.data)) continue;
    pagos.push({ item, pg });
  }

  // 5) nomes e o que já existe no HeadCoach
  const [portadores, centros, despesas, existentes] = await Promise.all([
    todas(() => supabase.from('erp_portadores').select('code, descricao').order('code')),
    todas(() => supabase.from('hc_cp_centros_custo').select('code, nome').order('code')),
    todas(() => supabase.from('hc_cp_despesas').select('code, nome').order('code')),
    todas(() => supabase.from('hc_cp_titulos').select('id, empresa, fornecedor_code, fornecedor_nome, duplicata, parcela, documento_fiscal, origem, origem_ref, situacao, valor, vencimento, data_pagamento, valor_pago').order('id')),
  ]);
  const nomes = { portador: new Map(portadores.map((p) => [p.code, p.descricao])), centro: new Map(centros.map((c) => [c.code, c.nome])), despesa: new Map(despesas.map((d) => [d.code, d.nome])) };
  const jaImportados = new Set(existentes.filter((e) => e.origem === 'totvs').map((e) => e.origem_ref));

  // --parcial=1:6455595 → essas duplicatas foram pagas em parte (o resto continua em aberto)
  const parciais = new Set((opt('parcial') || '').split(',').map((x) => x.trim()).filter(Boolean));
  const novas = [];
  const semDados = [];
  let repetidos = 0;
  let dobrados = 0;
  for (const { item, pg } of pagos) {
    if (jaImportados.has(chaveTotvs(item))) { repetidos += 1; continue; }
    if (novas.some((n) => n.origem_ref === chaveTotvs(item))) { dobrados += 1; continue; }
    const linha = linhaDoTituloTotvs(item, pg, nomes, { parcial: parciais.has(`${item.cd_empresa}:${item.nr_duplicata}`) });
    if (linha) novas.push({ ...linha, _via: pg.via, _pg: pg, _falta: faltaDoTotvs(item, pg) });
    else semDados.push(item);
  }
  // importados antes que hoje aparecem diferentes na Consulta (conciliação desfeita ou refeita depois)
  const hojePagos = new Map(pagos.map(({ item, pg }) => [chaveTotvs(item), pg]));
  const lidos = new Set(itens.map(chaveTotvs));
  const mudaram = existentes.filter((e) => e.origem === 'totvs' && lidos.has(e.origem_ref)).map((e) => ({ e, pg: hojePagos.get(e.origem_ref) })).filter(({ e, pg }) => !pg || pg.data !== String(e.data_pagamento).slice(0, 10) || Math.abs(pg.valorPago - Number(e.valor_pago)) > 0.005);
  console.log(`
importados antes que hoje aparecem diferentes: ${mudaram.length}`);
  if (POR === 'pagamento') for (const e of existentes.filter((x) => x.origem === 'totvs' && noMes(String(x.data_pagamento).slice(0, 10)) && !lidos.has(x.origem_ref))) console.log(`   NÃO VEIO na consulta de hoje: emp ${e.empresa} · ${e.fornecedor_nome.slice(0, 28)} · ${e.duplicata}/${e.parcela} (TOTVS ${e.documento_fiscal}) · pago ${String(e.data_pagamento).slice(0, 10)} R$ ${brl(e.valor_pago)}`);
  for (const { e, pg } of mudaram) console.log(`   MUDOU emp ${e.empresa} · ${e.fornecedor_nome.slice(0, 28)} · ${e.duplicata}/${e.parcela} (TOTVS ${e.documento_fiscal}) · gravado: pago ${String(e.data_pagamento).slice(0, 10)} R$ ${brl(e.valor_pago)} · hoje: ${pg ? `pago ${pg.data} R$ ${brl(pg.valorPago)} (${pg.via})` : 'não aparece como pago neste recorte'}`);

  // --so=99:196412,1:65556 → só esses títulos (empresa:duplicata do TOTVS)
  const so = opt('so') ? new Set(opt('so').split(',').map((x) => x.trim())) : null;
  const escolhidas = so ? novas.filter((n) => so.has(`${n.empresa}:${n.documento_fiscal}`)) : novas;
  if (so) console.log(`\n--so: ${escolhidas.length} de ${so.size} pedidos encontrados${escolhidas.length !== so.size ? ` · NÃO achei: ${[...so].filter((x) => !escolhidas.some((n) => `${n.empresa}:${n.documento_fiscal}` === x)).join(', ')}` : ''}`);
  const { linhas, conflitos } = numerarDuplicatas(escolhidas, existentes);

  // 6) resumo
  const soma = (l, campo) => l.reduce((s, x) => s + Number(x[campo] || 0), 0);
  console.log(`\nfora por ser fatura de banco/empréstimo que a Consulta esconde: ${ocultos.length}${flag('com-bancos') ? ' (incluídas por --com-bancos)' : ''}`);
  console.log(`pagos sem data de liquidação ou com valor pago zero (ficam de fora): ${semValorOuData}`);
  console.log(`já importados antes: ${repetidos} · repetidos na própria consulta: ${dobrados} · sem valor/vencimento/fornecedor: ${semDados.length} · parcela já existente no HeadCoach: ${conflitos.length}`);
  console.log(`\nA IMPORTAR: ${linhas.length} títulos · valor R$ ${brl(soma(linhas, 'valor'))} · pago R$ ${brl(soma(linhas, 'valor_pago'))}`);
  for (const via of ['TOTVS', 'CONCILIACAO', 'LIBERACAO']) {
    const l = linhas.filter((x) => x._via === via);
    console.log(`   pago via ${rotuloDaVia(via).padEnd(24)} ${String(l.length).padStart(5)} títulos · R$ ${brl(soma(l, 'valor_pago'))}`);
  }
  const porEmpresa = new Map();
  for (const l of linhas) porEmpresa.set(l.empresa, (porEmpresa.get(l.empresa) || 0) + 1);
  console.log(`   empresas: ${[...porEmpresa].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([e, n]) => `${e} (${n})`).join(' · ')}${porEmpresa.size > 14 ? ` · +${porEmpresa.size - 14}` : ''}`);
  const datas = linhas.map((l) => l.data_pagamento).sort();
  console.log(`   pagamentos de ${datas[0] || '-'} a ${datas.at(-1) || '-'} · vencimentos de ${linhas.map((l) => l.vencimento).sort()[0] || '-'} a ${linhas.map((l) => l.vencimento).sort().at(-1) || '-'}`);
  const semDespesa = linhas.filter((l) => !l.despesa_code).length;
  const despesasNovas = [...new Map(linhas.flatMap((l) => l.rateio || []).filter((r) => !nomes.despesa.has(r.despesa_code)).map((r) => [r.despesa_code, r.despesa_nome])).entries()];
  console.log(`   sem despesa: ${semDespesa} · despesas que ainda não existem no HeadCoach: ${despesasNovas.length}${despesasNovas.length ? ` (${despesasNovas.slice(0, 8).map(([c, n]) => `${c} ${n}`).join(', ')}${despesasNovas.length > 8 ? '…' : ''})` : ''}`);
  // parcelas que os bots já lançaram e que podem ser a mesma conta (mesmo fornecedor, valor e vencimento)
  const doHc = existentes.filter((e) => e.origem !== 'totvs' && e.situacao !== 'cancelado');
  const parecidas = linhas.filter((l) => doHc.some((e) => Number(e.fornecedor_code) === l.fornecedor_code && Math.abs(Number(e.valor) - l.valor) < 0.005 && String(e.vencimento).slice(0, 10) === l.vencimento));
  console.log(`   possíveis repetições de conta já lançada pelos bots (mesmo fornecedor, valor e vencimento): ${parecidas.length}${parecidas.length ? ` → ${parecidas.slice(0, 6).map((l) => `${l.fornecedor_nome.slice(0, 22)} R$ ${brl(l.valor)} venc ${l.vencimento}`).join(' | ')}` : ''}`);
  const pagoAMenos = linhas.filter((l) => l._falta > 0.005);
  console.log(`   pagos a menos que o valor: ${pagoAMenos.length}${pagoAMenos.length ? ` → ${pagoAMenos.map((l) => `${l.fornecedor_nome.slice(0, 22)} ${l.empresa}:${l.documento_fiscal} falta R$ ${brl(l._falta)} (${l.situacao === 'aberto' ? 'PARCIAL, fica em aberto' : 'entra como paga'})`).join(' | ')}` : ''}`);
  console.log('\namostra:');
  for (const l of flag('listar') ? [...linhas].sort((a, b) => b.valor_pago - a.valor_pago) : linhas.slice(0, 6)) console.log(`   emp ${l.empresa} · ${l.fornecedor_nome.slice(0, 30)} · dup ${l.duplicata}/${l.parcela} (TOTVS ${l.documento_fiscal}) · venc ${l.vencimento} · R$ ${brl(l.valor)} · pago ${l.data_pagamento} R$ ${brl(l.valor_pago)} · ${l._via}${l.situacao === 'aberto' ? ` · PARCIAL falta R$ ${brl(l._falta)}${l._pg.partes ? ` (${l._pg.partes.length} pagamentos)` : ''}` : ''} · ${l.despesa_code || '-'} ${String(l.despesa_nome || '').slice(0, 22)} · cc ${l.centro_custo_code || '-'}`);

  if (flag('gravar') && linhas.length) {
    // despesas que faltam no plano do HeadCoach (o título aponta para elas)
    if (despesasNovas.length) {
      const { error } = await supabase.from('hc_cp_despesas').upsert(despesasNovas.map(([code, nome]) => ({ code, nome: nome || `DESPESA ${code}` })), { onConflict: 'code', ignoreDuplicates: true });
      if (error) throw new Error(`despesas: ${error.message}`);
    }
    // um lote por duplicata do TOTVS (as parcelas ficam juntas)
    const lotes = new Map();
    const pgDaRef = new Map(linhas.map((l) => [l.origem_ref, l._pg]));
    const prontas = linhas.map(({ _via, _pg, _falta, ...l }) => {
      const g = `${l.empresa}|${l.fornecedor_code}|${l.documento_fiscal}`;
      if (!lotes.has(g)) lotes.set(g, crypto.randomUUID());
      return { ...l, lote: lotes.get(g), baixado_em: `${l.data_pagamento}T12:00:00-03:00` };
    });
    let gravados = 0;
    for (let i = 0; i < prontas.length; i += 200) {
      const { data, error } = await supabase.from('hc_cp_titulos').insert(prontas.slice(i, i + 200)).select('id, origem_ref, data_pagamento, valor, juros, multa, desconto, valor_pago, forma_pagamento, conta_pagamento, baixado_por');
      if (error) throw new Error(`títulos (lote ${i / 200 + 1}): ${error.message} — gravados até aqui: ${gravados}`);
      const { error: e2 } = await supabase.from('hc_cp_baixas').insert(data.flatMap((t) => baixasDoTituloTotvs(t, pgDaRef.get(t.origem_ref)).map((b) => ({ titulo_id: t.id, ...b }))));
      if (e2) throw new Error(`baixas (lote ${i / 200 + 1}): ${e2.message}`);
      gravados += data.length;
    }
    console.log(`\n✅ GRAVADOS: ${gravados} títulos com a marca TOTVS`);
  } else if (!flag('gravar')) console.log('\n(simulação: nada foi gravado)');
} catch (e) {
  console.log(`❌ ${e.message}`);
  process.exitCode = 1;
} finally {
  srv.close();
  setTimeout(() => process.exit(process.exitCode || 0), 300);
}
