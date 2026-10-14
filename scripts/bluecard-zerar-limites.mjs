/**
 * Dia de ligar o gatilho: zera o limite TOTVS (financeiro + comercial) dos
 * clientes BlueCard nas filiais participantes, para a trava valer para quem
 * já tinha limite gravado lá. NÃO toca em quem não é BlueCard.
 *
 * Quem é BlueCard aqui: CPFs com contrato assinado (bluecred_contratos) +
 * quem já comprou pelo app (API do BlueCard) + CPFs de um arquivo opcional
 * (um por linha) que o Felipe exportar do app — é a lista mais completa.
 *
 * Uso (na pasta apigestaocrosby):
 *   node --env-file=.env scripts/bluecard-zerar-limites.mjs                 # só mostra (dry-run)
 *   node --env-file=.env scripts/bluecard-zerar-limites.mjs --apply         # grava 0 em quem tem limite > 0
 *   node --env-file=.env scripts/bluecard-zerar-limites.mjs --apply --all   # grava 0 em todos (o comercial não é legível)
 *   ... --cpfs=clientes.txt   # soma CPFs do arquivo
 *   ... --filiais=90,65,87    # troca as filiais (default: BLUECARD_FILIAIS_BLUECARD ou as 12 do app)
 *
 * Observação: a API do TOTVS só devolve o limite FINANCEIRO (limitValue); o
 * comercial (saleLimitValue) não aparece em consulta nenhuma. Por isso o
 * --all existe: zera os dois campos em todo mundo da lista, sem olhar.
 */
import fs from 'node:fs';
import supabase from '../config/supabase.js';
import {
  buscarClientePorCpf,
  lerLimitesFinanceiros,
  definirLimiteTotvs,
} from '../services/bluecardLimite.js';
import { cpfsQueCompraramNoApp } from '../services/bluecardClient.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ALL = args.includes('--all');
const arqCpfs = (args.find((a) => a.startsWith('--cpfs=')) || '').slice(7);
const filiaisArg = (args.find((a) => a.startsWith('--filiais=')) || '').slice(10);
const FILIAIS = (filiaisArg || process.env.BLUECARD_FILIAIS_BLUECARD || '90,65,87,2,93,95,5,55,94,88,98,97')
  .split(',')
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => n > 0);

const so = (s) => String(s || '').replace(/\D/g, '');
const cpfs = new Set();

const { data: contratos } = await supabase.from('bluecred_contratos').select('cpf').limit(10000);
for (const c of contratos || []) if (so(c.cpf).length === 11) cpfs.add(so(c.cpf));
const nContratos = cpfs.size;

let nApp = 0;
try {
  for (const c of await cpfsQueCompraramNoApp()) if (so(c).length === 11 && !cpfs.has(so(c))) { cpfs.add(so(c)); nApp++; }
} catch (e) {
  console.warn('⚠️ API do BlueCard indisponível (compradores do app não entraram):', e.message);
}

let nArq = 0;
if (arqCpfs) {
  for (const linha of fs.readFileSync(arqCpfs, 'utf8').split(/\r?\n/)) {
    const c = so(linha);
    if (c.length === 11 && !cpfs.has(c)) { cpfs.add(c); nArq++; }
  }
}

console.log(`Clientes BlueCard: ${cpfs.size} (contratos ${nContratos}, app +${nApp}, arquivo +${nArq})`);
console.log(`Filiais: ${FILIAIS.join(',')} — modo: ${APPLY ? (ALL ? 'APPLY (todos)' : 'APPLY (só quem tem limite > 0)') : 'DRY-RUN'}`);

const { data: abertas } = await supabase.from('bluecard_liberacoes').select('cpf').eq('status', 'liberado');
const comJanela = new Set((abertas || []).map((a) => so(a.cpf)));

let semCadastro = 0, comLimite = 0, zerados = 0, falhas = 0, pulados = 0;
for (const cpf of cpfs) {
  if (comJanela.has(cpf)) { pulados++; console.log(`⏭️ ${cpf.slice(0, 3)}*** janela de limite aberta — não mexe`); continue; }
  let cli;
  try { cli = await buscarClientePorCpf(cpf); } catch (e) { falhas++; console.warn(`❌ ${cpf.slice(0, 3)}*** busca: ${e.message}`); continue; }
  if (!cli) { semCadastro++; continue; }

  let limites = {};
  try { limites = await lerLimitesFinanceiros(cli.code, FILIAIS); } catch { /* segue sem leitura */ }
  const comValor = Object.entries(limites).filter(([, v]) => Number(v) > 0);
  if (comValor.length) comLimite++;

  const precisa = ALL || comValor.length > 0;
  if (!precisa) continue;

  const resumo = comValor.map(([b, v]) => `${b}=R$${Number(v).toFixed(2)}`).join(' ') || '(financeiro 0; comercial não legível)';
  if (!APPLY) { console.log(`• ${cpf.slice(0, 3)}*** ${cli.name.split(' ')[0]} (${cli.code}) ${resumo}`); continue; }
  try {
    await definirLimiteTotvs({ cpf, nome: cli.name, valorReais: 0, branchCodes: FILIAIS });
    zerados++;
    console.log(`✅ ${cpf.slice(0, 3)}*** ${cli.name.split(' ')[0]} zerado em ${FILIAIS.length} filiais (${resumo})`);
  } catch (e) {
    falhas++;
    console.warn(`❌ ${cpf.slice(0, 3)}*** ${cli.name.split(' ')[0]}: ${e.message}`);
  }
}

console.log(`\nResumo: ${cpfs.size} CPFs · sem cadastro TOTVS ${semCadastro} · com limite financeiro > 0: ${comLimite} · zerados ${zerados} · falhas ${falhas} · pulados (janela aberta) ${pulados}`);
process.exit(0);
