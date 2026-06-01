// Audita franquia Maio/2026 PUXANDO DIRETO DO TOTVS (não Supabase).
// 1) Lista todas NFs Output em todas filiais + ops franquia conhecidas + adj.
// 2) Soma por op, mostra qual op não tá no config.
// 3) Lista NFs do Recife Mall (29541) — pra ver se as 3 do oficial batem.
import 'dotenv/config';
import axios from 'axios';
import { getToken } from '../utils/totvsTokenManager.js';
import { TOTVS_BASE_URL, httpsAgent, getBranchCodes } from '../totvsrouter/totvsHelper.js';

const DMIN = '2026-05-01', DMAX = '2026-05-31';
const FRANQUIA_OPS = [7234, 7240, 7802, 9124, 7259];
// Ops adjacentes a checar (1° pedido franquia provavelmente está aqui)
const OPS_CHECK = [7234, 7235, 7236, 7237, 7238, 7239, 7240, 7241, 7242, 7243, 7244, 7245, 7246, 7247, 7248, 7249, 7250, 7251, 7252, 7253, 7254, 7255, 7256, 7257, 7258, 7259, 7260, 7261, 7262, 7263, 7264, 7265, 7266, 7267, 7268, 7269, 7802, 9124];

const tk = await getToken();
const branchCodeList = await getBranchCodes(tk.access_token);
console.log(`Branches TOTVS: ${branchCodeList.length}`);

// Coleta todas as NFs Output para essas ops em maio
const porOp = {};
const porRecife = []; // NFs de Recife Mall (29541)

for (let page = 1; page <= 50; page++) {
  let resp;
  try {
    resp = await axios.post(
      `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`,
      {
        filter: {
          branchCodeList,
          operationCodeList: OPS_CHECK,
          operationType: 'Output',
          startIssueDate: `${DMIN}T00:00:00`,
          endIssueDate: `${DMAX}T23:59:59`,
        },
        expand: '',
        page, pageSize: 100,
      },
      { headers: { Authorization: `Bearer ${tk.access_token}` }, httpsAgent, timeout: 60000 },
    );
  } catch (err) {
    console.log(`pág ${page} erro: ${err.message}`);
    break;
  }
  const items = resp.data?.items || [];
  if (!items.length) break;
  for (const nf of items) {
    if (nf.invoiceStatus === 'Canceled' || nf.invoiceStatus === 'Deleted') continue;
    const op = Number(nf.operationCode);
    const val = Number(nf.totalValue || 0);
    if (!porOp[op]) porOp[op] = { nome: nf.operationName, total: 0, qtd: 0 };
    porOp[op].total += val;
    porOp[op].qtd++;
    if (Number(nf.personCode) === 29541) {
      porRecife.push({
        branch: nf.branchCode, code: nf.invoiceCode, op, date: nf.issueDate?.slice(0,10), val,
      });
    }
  }
  if (items.length < 100) break;
}

console.log('\n📊 NFs por op (maio/2026, all branches):');
console.log('  ' + 'OP'.padEnd(8) + 'NFs'.padEnd(6) + 'Total'.padStart(14) + '  Nome' + '   IN-CONFIG?');
const sorted = Object.entries(porOp).sort((a, b) => b[1].total - a[1].total);
let totalFranquiaConfigured = 0;
let totalOutras = 0;
for (const [op, v] of sorted) {
  const inConfig = FRANQUIA_OPS.includes(Number(op));
  console.log(`  ${String(op).padEnd(8)}${String(v.qtd).padEnd(6)}R$ ${v.total.toFixed(2).padStart(11)}  ${(v.nome||'').slice(0,40)}  ${inConfig ? '✓' : '←ADICIONAR?'}`);
  if (inConfig) totalFranquiaConfigured += v.total;
  else totalOutras += v.total;
}
console.log(`\n  SOMA ops já no config: R$ ${totalFranquiaConfigured.toFixed(2)}`);
console.log(`  SOMA ops fora do config: R$ ${totalOutras.toFixed(2)}`);

console.log('\n🎯 NFs de Recife Mall (personCode 29541, todas as ops):');
let totRecife = 0;
for (const nf of porRecife) {
  console.log(`  br=${nf.branch} op=${nf.op} ${nf.date} R$ ${nf.val.toFixed(2)} (nf ${nf.code})`);
  totRecife += nf.val;
}
console.log(`  TOTAL Recife: R$ ${totRecife.toFixed(2)} (${porRecife.length} NFs)`);
