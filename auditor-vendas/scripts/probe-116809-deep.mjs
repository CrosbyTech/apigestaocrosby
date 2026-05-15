// Busca TUDO sobre o cliente 116809 (J Silva dos Reis / MTM JUCELINO)
// em todos os sistemas: TOTVS (todos canais), Supabase, voucher, leads
import 'dotenv/config';
import axios from 'axios';
import https from 'node:https';
import supabase from './config/supabase.js';

const TOTVS_BASE_URL =
  process.env.TOTVS_BASE_URL || 'https://www30.bhan.com.br:9443/api/totvsmoda';
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

async function getToken() {
  const r = await axios.post(
    process.env.TOTVS_AUTH_ENDPOINT,
    new URLSearchParams({
      grant_type: 'password',
      client_id: process.env.TOTVS_CLIENT_ID,
      client_secret: process.env.TOTVS_CLIENT_SECRET,
      username: process.env.TOTVS_USERNAME,
      password: process.env.TOTVS_PASSWORD,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, httpsAgent },
  );
  return r.data.access_token;
}
const token = await getToken();

const PC = 116809;
const CNPJ = '59089641000107';

console.log(`🔍 INVESTIGAÇÃO PROFUNDA — PC ${PC}`);
console.log(`CNPJ: ${CNPJ}\n`);

// ───────────────────────────────────────────────────────────────────────
// 1) Supabase: tabela pes_pessoa
// ───────────────────────────────────────────────────────────────────────
console.log('═══ 1) pes_pessoa (Supabase) ═══');
const { data: pes, error: pesErr } = await supabase
  .from('pes_pessoa')
  .select('*')
  .eq('code', PC)
  .limit(1);
if (pesErr) console.log(`  ERR: ${pesErr.message}`);
else if (pes?.length > 0) {
  const p = pes[0];
  console.log(`  ✓ Encontrado em pes_pessoa:`);
  for (const k of Object.keys(p).sort()) {
    const v = p[k];
    if (v == null) continue;
    if (typeof v === 'object') {
      console.log(`    ${k}: ${JSON.stringify(v).slice(0, 200)}`);
    } else {
      console.log(`    ${k}: ${String(v).slice(0, 200)}`);
    }
  }
} else {
  console.log(`  ❌ NÃO está em pes_pessoa`);
}

// ───────────────────────────────────────────────────────────────────────
// 2) Supabase: tabelas relacionadas (notas_fiscais, voucher, etc)
// ───────────────────────────────────────────────────────────────────────
console.log('\n═══ 2) Outras tabelas Supabase com person_code ═══');
const tabelas = [
  'notas_fiscais',
  'voucher_usage',
  'voucher_aplicado',
  'crm_disputas',
  'crm_lead_generation_calls',
  'top_clientes',
];
for (const t of tabelas) {
  try {
    const { data, error, count } = await supabase
      .from(t)
      .select('*', { count: 'exact', head: false })
      .eq('person_code', PC)
      .limit(3);
    if (error) {
      if (
        !error.message.includes('does not exist') &&
        !error.message.includes('relation')
      ) {
        console.log(`  ${t}: ❌ ${error.message.slice(0, 80)}`);
      }
      continue;
    }
    if (data && data.length > 0) {
      console.log(`  ✓ ${t}: ${count} registros (mostrando 3):`);
      for (const r of data) {
        const keys = Object.keys(r).slice(0, 10);
        const summary = keys.map((k) => `${k}=${String(r[k]).slice(0, 30)}`).join(', ');
        console.log(`    ${summary}`);
      }
    } else {
      console.log(`  - ${t}: 0 registros`);
    }
  } catch (e) {
    console.log(`  ${t}: ERR ${e.message.slice(0, 80)}`);
  }
}

// ───────────────────────────────────────────────────────────────────────
// 3) TOTVS — NFs em TODOS os canais (não só multimarcas)
// ───────────────────────────────────────────────────────────────────────
console.log('\n═══ 3) TOTVS — NFs em todos os canais 2024-2026 ═══');
// Busca por mês em todas as ops
const ALL_OPS = [
  // multimarcas
  7235, 7241, 9127, 200,
  // varejo special ops
  1, 2, 55, 510, 511, 521, 522, 545, 546, 548, 1210,
  // franquia
  7234, 7240, 7802, 9124, 7259,
  // business
  7237, 7269, 7279, 7277,
  // showroom
  7254, 7007,
  // novidades
  7255,
  // bazar
  887,
  // revenda
  7236, 9122, 5102, 7242, 9061, 9001, 9121, 512,
];
const ALL_BRANCHS = [
  1, 2, 5, 6, 11, 50, 55, 65, 75, 85, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97,
  98, 99, 100, 101, 111, 200,
];

const fetchInv = async (page, dateMin, dateMax) => {
  try {
    const r = await axios.post(
      `${TOTVS_BASE_URL}/fiscal/v2/invoices/search`,
      {
        filter: {
          branchCodeList: ALL_BRANCHS,
          // SEM operationCodeList — pega TUDO
          operationType: 'Output',
          startIssueDate: `${dateMin}T00:00:00`,
          endIssueDate: `${dateMax}T23:59:59`,
        },
        page,
        pageSize: 100,
      },
      { headers: { Authorization: `Bearer ${token}` }, httpsAgent, timeout: 60000 },
    );
    return r.data;
  } catch (err) {
    return null;
  }
};

console.log('  (varredura por mês — pode demorar alguns minutos)');
let found = [];
for (let ano = 2024; ano <= 2026; ano++) {
  for (let mes = 1; mes <= 12; mes++) {
    if (ano === 2026 && mes > 5) break;
    const mm = String(mes).padStart(2, '0');
    const lastDay = new Date(ano, mes, 0).getDate();
    const dateMin = `${ano}-${mm}-01`;
    const dateMax = `${ano}-${mm}-${String(lastDay).padStart(2, '0')}`;
    const f1 = await fetchInv(1, dateMin, dateMax);
    if (!f1) continue;
    const totalP = f1?.totalPages || 0;
    const items = [...(f1?.items || [])];
    const rem = Array.from({ length: totalP - 1 }, (_, i) => i + 2);
    for (let i = 0; i < rem.length; i += 5) {
      const rs = await Promise.all(
        rem.slice(i, i + 5).map((p) => fetchInv(p, dateMin, dateMax)),
      );
      for (const r of rs) items.push(...(r?.items || []));
    }
    const match = items.filter((nf) => Number(nf.personCode) === PC);
    if (match.length > 0) {
      console.log(`  ${ano}-${mm}: ${match.length} NFs (de ${items.length} varridas)`);
      found.push(...match);
    }
  }
}

console.log(`\n  Total NFs encontradas (TODOS canais): ${found.length}`);
console.log('');
console.log('  Data       | Tx       | Status   | Br | Op   | Valor       | Cliente');
for (const nf of found.sort((a, b) => (a.issueDate < b.issueDate ? -1 : 1))) {
  console.log(
    `  ${nf.issueDate?.slice(0, 10) || '?'} | ${String(nf.transactionCode).padEnd(8)} | ${(nf.invoiceStatus || '').padEnd(8)} | ${String(nf.branchCode).padStart(2)} | ${String(nf.operationCode).padEnd(4)} | R$ ${Number(nf.totalValue || 0).toFixed(2).padStart(10)} | ${nf.personName?.slice(0, 40)}`,
  );
}
