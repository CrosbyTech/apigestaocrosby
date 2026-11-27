// CONTAS FIXAS DAS LOJAS: cria as tabelas (migrations/contas_fixas_lojas.sql) e faz a carga inicial.
//   node scripts/migrar-contas-fixas-lojas.mjs            → mostra o que vai fazer (não grava a carga)
//   node scripts/migrar-contas-fixas-lojas.mjs aplicar    → cria as tabelas e grava a carga
// A carga não sobrescreve nada: loja que já existe fica como está, e "como pegar" só é preenchido
// onde ainda está vazio. Pode rodar de novo.
import 'dotenv/config';
import fs from 'node:fs';
import supabase from '../config/supabase.js';

const aplicar = process.argv.includes('aplicar');

// ─── as lojas da planilha (nome como o financeiro chama, tipo, shopping e centro de custo) ──
const LOJAS = [
  { cd: '1', nome: 'NATAL (MATRIZ)', tipo: 'matriz', cc: 10 },
  { cd: '2', nome: 'JOÃO PESSOA', tipo: 'loja_rua', cc: 2 },
  { cd: '5', nome: 'NOVA CRUZ', tipo: 'loja_rua', cc: 5 },
  { cd: '55', nome: 'PARNAMIRIM', tipo: 'loja_rua', cc: 16 },
  { cd: '65', nome: 'CANGUARETAMA', tipo: 'loja_rua', cc: 15 },
  { cd: '87', nome: 'CIDADE JARDIM', tipo: 'loja_shopping', cc: 41, shopping: 'Shopping Cidade Jardim' },
  { cd: '88', nome: 'SHOPPING GUARARAPES', tipo: 'loja_shopping', cc: 42, shopping: 'Shopping Guararapes' },
  { cd: '90', nome: 'AYRTON SENNA', tipo: 'loja_rua', cc: 37 },
  { cd: '93', nome: 'IMPERATRIZ', tipo: 'loja_rua', cc: 32 },
  { cd: '94', nome: 'SHOPPING PATOS', tipo: 'loja_shopping', cc: 33, shopping: 'Patos Shopping' },
  { cd: '95', nome: 'MIDWAY', tipo: 'loja_shopping', cc: 19, shopping: 'Midway Mall' },
  { cd: '97', nome: 'SHOPPING TERESINA', tipo: 'loja_shopping', cc: 31, shopping: 'Teresina Shopping' },
  { cd: '98', nome: 'SHOPPING RECIFE', tipo: 'loja_shopping', cc: 34, shopping: 'Shopping Recife' },
  { cd: '99', nome: 'BREJINHO', tipo: 'loja_rua', cc: 18 },
  // imóveis que não são empresa (já existiam no Controle de Filiais)
  { cd: 'TERRENO_PAINEL', nome: 'TERRENO PAINEL SOLAR', tipo: 'imovel', cidade: 'LAGOA NOVA', uf: 'RN', endereco: 'Sítio Ponta de Linha, 27 - Zona Rural' },
  { cd: 'CASA_ECOVILLE', nome: 'CASA ECOVILLE', tipo: 'imovel' },
  { cd: 'CASA_CROSBY', nome: 'CASA CROSBY', tipo: 'imovel' },
];

// ─── como pegar cada conta (o que já se sabe em 26/11/2026) ──────────────────
const sem = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
function comoPegar(d) {
  const f = sem(d.nm_fornecedor);
  const obs = sem(d.observacao);
  const t = d.tipo_despesa;
  if (t === 'AGUA_MINERAL') return ['sob_demanda', 'Compra de galões conforme a loja pede (sem fatura mensal). Contato e Pix do fornecedor na observação.'];
  if (/ENERGETICA DO RIO GRANDE|COSERN/.test(f)) {
    if (String(d.cd_filial) === 'TERRENO_PAINEL') return ['nao_definido', 'Conta da Cosern do terreno: ainda não capturada (o robô da Cosern pode pegar pelo código do cliente da observação).'];
    return ['robo_whatsapp', 'Robô do WhatsApp da Cosern (84 3215-6001): pega a 2ª via em PDF com o Pix pelo código do cliente e lança no Contas a Pagar HeadCoach. Quando o robô não acha fatura em aberto, rodar de novo mais perto do vencimento.'];
  }
  if (/ENERGISA/.test(f)) return ['robo_whatsapp', 'Robô do WhatsApp da Energisa (Gisa, 83 99135-5540): uma fatura por sala (são 6), com boleto e Pix, lançadas no Contas a Pagar HeadCoach.'];
  if (/EQUATORIAL/.test(f)) return ['robo_whatsapp', 'Robô do WhatsApp da Equatorial (Clara, 98 2055-0116): pega a conta do mês pela conta contrato, com PDF e Pix, e lança no Contas a Pagar HeadCoach.'];
  if (/AGUAS E ESGOTOS DO RIO GRANDE|CAERN/.test(f)) return ['robo_whatsapp', 'Robô do WhatsApp da CAERN (Caren, 84 98118-8400): pega a 2ª via em PDF com o Pix pela matrícula e lança no Contas a Pagar HeadCoach.'];
  if (/ESGOTOS DA PARAIBA|CAGEPA/.test(f)) return ['robo_whatsapp', 'Robô do WhatsApp da Cagepa (EVA, 83 98198-4495): pega a conta detalhada em PDF e o Pix pela matrícula e lança no Contas a Pagar HeadCoach.'];
  if (/SERVICO AUTONOMO DE AGUA|SAAE/.test(f)) return ['fora_do_controle', 'Sem canal oficial (autarquia municipal). O pessoal da expedição de Brejinho pega a conta e envia.'];
  if (/ALARES|CABO SERVICOES/.test(f)) return ['email_automatico', 'A fatura digital da Alares chega no e-mail de Patrimônio com o PDF; encaminhada para contas-fixas@crosbytech.com.br, o HeadCoach lê o boleto e lança sozinho no Contas a Pagar.'];
  if (/LANSERVI/.test(f)) return ['email_automatico', 'O lembrete de pagamento da Lanservi chega no e-mail do financeiro com o carnê em PDF; encaminhado para contas-fixas@crosbytech.com.br, o HeadCoach lança o boleto sozinho.'];
  if (/CLARO/.test(f)) return ['site', t === 'TELEFONE' ? 'Fatura no site da Claro com o login da empresa. Ainda sem captura automática.' : 'Boleto no site da Claro com o login da empresa (dados na observação). Ainda sem captura automática.'];
  if (/TELEFONICA/.test(f)) return ['nao_definido', 'Ainda sem site e login para pegar as faturas.'];
  if (/INFORWAY/.test(f)) return ['email', 'O boleto chega no e-mail de Patrimônio; também dá para pedir no WhatsApp da Inforway com o CNPJ da loja. Ainda sem captura automática.'];
  if (/BRISANET/.test(f)) return ['site', 'Aplicativo da Brisanet, e-mail da loja de Patos ou WhatsApp da Brisanet. Ainda sem captura automática.'];
  if (/INNOTECH/.test(f)) return ['email', 'A fatura chega no e-mail de Patrimônio. Ainda sem captura automática.'];
  if (t === 'ALUGUEL' || t === 'CONDOMINIO') {
    if (sem(d.forma_pagamento) === 'PIX') return ['pix_direto', 'Sem boleto: Pix direto ao locador no dia do vencimento. Confirmar a chave antes de enviar (ver observação).'];
    if (/WHATSAPP/.test(obs)) return ['whatsapp', 'O boleto chega no WhatsApp de Patrimônio (ver observação).'];
    if (/VENDEDOR/.test(obs)) return ['loja_envia', 'A loja envia o boleto (ver observação).'];
    return ['boleto', 'Boleto enviado pelo locador (ver observação).'];
  }
  if (/WHATSAPP/.test(obs)) return ['whatsapp', 'Pedir pelo WhatsApp do fornecedor (ver observação).'];
  if (/EMAIL|E-MAIL/.test(obs)) return ['email', 'Chega por e-mail (ver observação).'];
  if (/SITE/.test(obs)) return ['site', 'Pegar no site do fornecedor (ver observação).'];
  return ['nao_definido', null];
}
// anotações de célula que já estavam na planilha de 23/11/2026
const ANOTACOES = [
  { cd: '88', tipo: 'CONDOMINIO', obs: 'O boleto do shopping (Condomínio do Shopping Guararapes) está lançado como aluguel.' },
  { cd: '95', tipo: 'CONDOMINIO', obs: 'O boleto do Midway vem rateado: parte aluguel, parte condomínio.' },
];

// ─── 1) tabelas ──────────────────────────────────────────────────────────────
const sql = fs.readFileSync(new URL('../migrations/contas_fixas_lojas.sql', import.meta.url), 'utf8');
// tira os comentários (linha inteira e fim de linha) ANTES de dividir: um ';' dentro de comentário quebraria o comando ao meio
const comandos = sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n').split(';').map((c) => c.trim()).filter(Boolean);
if (aplicar) {
  for (const c of comandos) {
    const { data, error } = await supabase.rpc('exec_sql', { query: c });
    // a função devolve o texto do erro em `data` quando o comando falha (não vem em `error`)
    const falha = error?.message || (typeof data === 'string' && /^error/i.test(data.trim()) ? data : null);
    console.log(falha ? `ERRO ${falha}` : 'ok  ', c.replace(/\s+/g, ' ').slice(0, 100));
    if (falha) process.exit(1);
  }
  await supabase.rpc('exec_sql', { query: "notify pgrst, 'reload schema'" });
  await new Promise((ok) => setTimeout(ok, 3000));
} else {
  console.log(`(simulação) ${comandos.length} comando(s) de criação das tabelas — rode com "aplicar" para gravar`);
}

// ─── 2) lojas ────────────────────────────────────────────────────────────────
const codigos = LOJAS.map((l) => Number(l.cd)).filter((n) => n > 0);
const { data: empresas, error: e1 } = await supabase.from('erp_empresas').select('code, descricao, fantasia, person_name, cnpj, ie, uf, cidade, endereco, grupo').in('code', codigos);
if (e1) { console.log('ERRO ao ler as empresas:', e1.message); process.exit(1); }
let jaTem = new Set();
if (aplicar) {
  const { data, error } = await supabase.from('contas_fixas_lojas').select('cd_filial');
  if (error) { console.log('ERRO: a tabela contas_fixas_lojas não ficou visível:', error.message); process.exit(1); }
  jaTem = new Set((data || []).map((x) => String(x.cd_filial)));
}
const novas = [];
LOJAS.forEach((l, i) => {
  if (jaTem.has(l.cd)) return;
  const e = (empresas || []).find((x) => String(x.code) === l.cd);
  const end = e?.endereco || {};
  novas.push({
    cd_filial: l.cd,
    empresa: e ? Number(e.code) : null,
    nome: l.nome,
    tipo: l.tipo,
    razao_social: e?.person_name || null,
    nome_fantasia: e?.fantasia || e?.descricao || null,
    cnpj: e?.cnpj || null,
    inscricao_estadual: e?.ie || null,
    grupo: e?.grupo || null,
    endereco: e ? [[end.publicPlace, end.address].filter(Boolean).join(' '), end.addressNumber, end.complement].filter((x) => x != null && String(x).trim() !== '').join(', ') || null : l.endereco || null,
    bairro: end.neighborhood || null,
    cidade: e?.cidade || l.cidade || null,
    uf: e?.uf || l.uf || null,
    cep: end.cep || null,
    shopping: l.shopping || null,
    centro_custo_code: l.cc ?? null,
    ordem: (i + 1) * 10,
    atualizado_por: 'carga inicial (26/11/2026)',
  });
});
console.log(`\nlojas a cadastrar: ${novas.length} (já existiam ${jaTem.size})`);
for (const n of novas) console.log(`  ${String(n.cd_filial).padEnd(15)} ${n.nome.padEnd(22)} ${n.tipo.padEnd(14)} cc ${String(n.centro_custo_code ?? '-').padEnd(3)} ${n.cidade || ''}${n.uf ? '/' + n.uf : ''} · ${n.endereco || ''}`);
if (aplicar && novas.length) {
  const { error } = await supabase.from('contas_fixas_lojas').insert(novas);
  console.log(error ? `ERRO ao gravar as lojas: ${error.message}` : `  → ${novas.length} loja(s) gravada(s)`);
  if (error) process.exit(1);
}

// ─── 3) como pegar cada despesa já cadastrada ────────────────────────────────
const { data: desp, error: e2 } = await supabase.from('despesas_fixas_filial').select('*').limit(5000);
if (e2) { console.log('ERRO ao ler as despesas:', e2.message); process.exit(1); }
const faltam = (desp || []).filter((d) => !d.como_pegar_canal);
console.log(`\ndespesas no cadastro: ${desp.length} · sem "como pegar": ${faltam.length}`);
const resumo = {};
for (const d of faltam.sort((a, b) => String(a.tipo_despesa).localeCompare(b.tipo_despesa) || String(a.cd_filial).localeCompare(String(b.cd_filial), 'pt', { numeric: true }))) {
  const [canal, txt] = comoPegar(d);
  resumo[canal] = (resumo[canal] || 0) + 1;
  console.log(`  ${d.tipo_despesa.padEnd(12)} loja ${String(d.cd_filial).padEnd(15)} ${String(d.nm_fornecedor).slice(0, 28).padEnd(28)} → ${canal}`);
  if (aplicar) {
    const { error } = await supabase.from('despesas_fixas_filial').update({ como_pegar_canal: canal, como_pegar: txt }).eq('id', d.id);
    if (error) { console.log('    ERRO:', error.message); process.exit(1); }
  }
}
console.log('  por canal:', JSON.stringify(resumo));

// ─── 4) anotações ────────────────────────────────────────────────────────────
if (aplicar) {
  const { data: an } = await supabase.from('contas_fixas_anotacoes').select('cd_filial, tipo_despesa');
  const tem = new Set((an || []).map((a) => `${a.cd_filial}|${a.tipo_despesa}`));
  const novasAn = ANOTACOES.filter((a) => !tem.has(`${a.cd}|${a.tipo}`)).map((a) => ({ cd_filial: a.cd, tipo_despesa: a.tipo, nao_se_aplica: false, observacao: a.obs, atualizado_por: 'carga inicial (26/11/2026)' }));
  if (novasAn.length) {
    const { error } = await supabase.from('contas_fixas_anotacoes').insert(novasAn);
    console.log(error ? `ERRO nas anotações: ${error.message}` : `\n${novasAn.length} anotação(ões) gravada(s)`);
  }
}
console.log(aplicar ? '\nPRONTO.' : '\n(simulação: nada foi gravado)');
process.exit(0);
