import xlsx from 'xlsx';
import fs from 'fs';
const base = 'https://apigestaocrosby-bw2v.onrender.com';
const T = (p) => `${base}/api/totvs/${p}`;
const DT_INI = '2026-01-01', DT_FIM = '2026-11-30';

// ---- helpers iguais a aba ----
const mesKey = (d) => (d ? String(d).slice(0, 7) : null);
const mesDe = (d) => String(d || '').slice(0, 7);
const BLC_FORA = new Set([98, 980, 551]);
const filialBlueCard = (e) => { const n = parseInt(e, 10); return Number.isFinite(n) && n < 5999 && !BLC_FORA.has(n); };
const FORA_RECUP = new Set(['101-8445-45685-24','101-8445-45685-205','101-45209-12315-3','101-45209-12315-20','101-45209-84575-3','101-45209-84575-4','101-45209-84575-203','101-45209-123456-2','101-45209-123456-3','101-45209-123456-4','101-45209-123456-207']);
const FORA_VENC = new Set(['111-4824-734398-1']);
const chave = (i) => `${i.cd_empresa}-${i.cd_cliente}-${i.nr_fatura ?? i.nr_fat}-${i.nr_parcela}`;
const soFatura = (i) => i.tp_documento === 1 || i.tp_documento === '1';
const ehReneg = (i) => Number(i.tp_baixa) === 9;
const ehAbat = (i) => Number(i.tp_baixa) === 17;
const valeParaMeta = (i) => soFatura(i) && !ehReneg(i) && !ehAbat(i);
const pagoAntes = (i) => { const l = mesDe(i.dt_liq), v = mesDe(i.dt_vencimento); return !!l && !!v && l < v; };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function jget(url, tent = 5) {
  let ultErro;
  for (let t = 1; t <= tent; t++) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(150000) }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
    catch (e) { ultErro = e; process.stderr.write(`    retry ${t}/${tent} (${e.message})\n`); await sleep(4000 * t); }
  }
  throw ultErro;
}
async function listaCanal(rota) { const j = await jget(T(rota)); const raw = j.data; const lista = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : (raw?.codes || []).map((code) => ({ code })); return lista; }

async function arLotes(paramsBase, codigos) {
  const LOTE = 500, SIM = 4;
  const lotes = []; for (let i = 0; i < codigos.length; i += LOTE) lotes.push(codigos.slice(i, i + LOTE));
  const itens = [];
  for (let i = 0; i < lotes.length; i += SIM) {
    const grupo = lotes.slice(i, i + SIM);
    const res = await Promise.all(grupo.map(async (lote) => {
      const p = new URLSearchParams(paramsBase); p.set('cd_cliente', lote.join(','));
      const j = await jget(`${T('accounts-receivable/filter')}?${p.toString()}`);
      return j.data?.items || [];
    }));
    res.forEach((a) => itens.push(...a));
    process.stderr.write(`  lotes ${Math.min(i + SIM, lotes.length)}/${lotes.length}\n`);
  }
  return itens;
}

// ---- 1) canais ----
const fontes = [ ['FRQ','franchise-clients'], ['MTM','multibrand-clients'], ['REV','reseller-clients'], ['BLC','bluecred/clientes'] ];
const canalDoCliente = {};
for (const [canal, rota] of fontes) {
  try { const lista = await listaCanal(rota); for (const c of lista) { const k = String(c.code); if (!canalDoCliente[k]) canalDoCliente[k] = canal; } process.stderr.write(`canal ${canal}: ${lista.length}\n`); }
  catch (e) { process.stderr.write(`canal ${canal} FALHOU: ${e.message}\n`); }
}
const codigos = Object.keys(canalDoCliente);
process.stderr.write(`total clientes de canal: ${codigos.length}\n`);

// ---- 2) AR vencendo e pagos ----
process.stderr.write('buscando VENCENDO...\n');
const vencRaw = await arLotes({ dt_inicio: DT_INI, dt_fim: DT_FIM, modo: 'vencimento', situacao: '1', tp_documento: '1' }, codigos);
process.stderr.write('buscando PAGOS...\n');
const pagosRaw = await arLotes({ dt_inicio: DT_INI, dt_fim: DT_FIM, modo: 'pagamento', situacao: '1', status: 'Pago', tp_documento: '1' }, codigos);

const marcar = (i) => ({ ...i, canal: canalDoCliente[String(i.cd_cliente).trim()] || '' });
const filialOk = (i) => i.canal !== 'BLC' || filialBlueCard(i.cd_empresa);

const venc = vencRaw.map(marcar).filter((i) => valeParaMeta(i) && filialOk(i) && !pagoAntes(i) && !FORA_VENC.has(chave(i)));
const pagos = pagosRaw.map(marcar).filter((i) => valeParaMeta(i) && filialOk(i) && !FORA_RECUP.has(chave(i)));

// ---- 3) agregacao por mes ----
const meses = {};
const gm = (k) => (meses[k] ||= { mes: k, aVencer: 0, qtdVencer: 0, pago: 0, qtdPago: 0 });
let totVenc = 0, totPago = 0;
for (const i of venc) { const k = mesKey(i.dt_vencimento); if (!k) continue; const m = gm(k); const v = Number(i.vl_fatura) || 0; m.aVencer += v; m.qtdVencer++; totVenc += v; }
for (const i of pagos) { const k = mesKey(i.dt_liq); if (!k) continue; const m = gm(k); const v = Number(i.vl_pago) || Number(i.vl_fatura) || 0; m.pago += v; m.qtdPago++; totPago += v; }

console.log('TOTAL A VENCER:', totVenc.toFixed(2), '| TOTAL PAGO:', totPago.toFixed(2));
console.log('(alvo do Joao: 4.124.560,13 a vencer / 3.551.008,32 pago)');

// ---- 4) xlsx ----
const r2 = (n) => Math.round(n * 100) / 100;
const resumo = Object.values(meses).sort((a, b) => a.mes.localeCompare(b.mes)).map((m) => ({
  'Mês': m.mes, 'A Vencer (R$)': r2(m.aVencer), 'Qtd a vencer': m.qtdVencer,
  'Pago (R$)': r2(m.pago), 'Qtd pago': m.qtdPago,
  '% Pago/Vencido': m.aVencer > 0 ? r2((m.pago / m.aVencer) * 100) : 0,
}));
resumo.push({ 'Mês': 'TOTAL', 'A Vencer (R$)': r2(totVenc), 'Qtd a vencer': venc.length, 'Pago (R$)': r2(totPago), 'Qtd pago': pagos.length, '% Pago/Vencido': totVenc > 0 ? r2((totPago / totVenc) * 100) : 0 });

const detVenc = venc.map((i) => ({ 'Mês Venc': mesKey(i.dt_vencimento), Canal: i.canal, Empresa: i.cd_empresa, 'Cód Cliente': i.cd_cliente, Cliente: i.nm_cliente || '', Fatura: i.nr_fatura ?? i.nr_fat, Parcela: i.nr_parcela, Vencimento: String(i.dt_vencimento || '').slice(0, 10), 'Valor (R$)': r2(Number(i.vl_fatura) || 0) }))
  .sort((a, b) => (a['Mês Venc'] || '').localeCompare(b['Mês Venc'] || ''));
const detPago = pagos.map((i) => ({ 'Mês Pagto': mesKey(i.dt_liq), Canal: i.canal, Empresa: i.cd_empresa, 'Cód Cliente': i.cd_cliente, Cliente: i.nm_cliente || '', Fatura: i.nr_fatura ?? i.nr_fat, Parcela: i.nr_parcela, Vencimento: String(i.dt_vencimento || '').slice(0, 10), 'Data Pagamento': String(i.dt_liq || '').slice(0, 10), 'Valor Pago (R$)': r2(Number(i.vl_pago) || Number(i.vl_fatura) || 0) }))
  .sort((a, b) => (a['Data Pagamento'] || '').localeCompare(b['Data Pagamento'] || ''));

const wb = xlsx.utils.book_new();
xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(resumo), 'Resumo por mes');
xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(detPago), 'Pagos (detalhe)');
xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(detVenc), 'A vencer (detalhe)');
const out = 'C:/Users/yagom/AppData/Local/Temp/claude/af7426cb677bf6db/539e4dbd-9ec9-46b1-b1a7-6191caf26dc9/scratchpad/metas_inadimplencia.xlsx';
xlsx.writeFile(wb, out);
console.log('SALVO', out, '| venc', detVenc.length, 'pagos', detPago.length);
