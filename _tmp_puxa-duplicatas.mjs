import 'dotenv/config';
import fs from 'fs';
import axios from 'axios';
import { getToken } from './utils/totvsTokenManager.js';
import { TOTVS_BASE_URL, getBranchesWithNames, httpsAgent } from './totvsrouter/totvsHelper.js';

const D = process.argv[2];
const ATE = '2026-07-31T23:59:59';
const { access_token: token } = await getToken();
const H = { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, httpsAgent, timeout: 60000 };
const branches = await getBranchesWithNames(token);
const branchName = Object.fromEntries(branches.map((b) => [b.code, b.name]));
const branchCodeList = branches.map((b) => b.code);
console.error('filiais:', branchCodeList.length);

// 1) duplicatas Normal com vencimento até julho (paginado)
const ep = `${TOTVS_BASE_URL}/accounts-payable/v2/duplicates/search`;
const filter = { branchCodeList, startExpiredDate: '2000-01-01T00:00:00', endExpiredDate: ATE, status: 'Normal' };
let page = 1, all = [], totalPages = 1;
do {
  const { data } = await axios.post(ep, { filter, page, pageSize: 100, order: 'dueDate' }, H);
  all.push(...(data.items || []));
  totalPages = data.totalPages || 1;
  if (page === 1) console.error('total registros Normal até julho:', data.count, 'páginas:', totalPages);
  page++;
} while (page <= totalPages);
const abertas = all.filter((i) => !i.settlementDate && !(i.paidValue > 0));
console.error('itens:', all.length, 'em aberto:', abertas.length);
fs.writeFileSync(`${D}/duplicatas-raw.json`, JSON.stringify(abertas));

// 2) nomes dos fornecedores
const codes = [...new Set(abertas.map((i) => i.supplierCode))];
const nomes = {};
const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, k) => a.slice(k * n, k * n + n));
for (const kind of ['legal-entities', 'individuals']) {
  for (const c of chunk(codes, 100)) {
    try {
      const { data } = await axios.post(`${TOTVS_BASE_URL}/person/v2/${kind}/search`, { filter: { personCodeList: c }, page: 1, pageSize: 100 }, H);
      for (const p of data.items || []) nomes[p.code] = { nome: p.name, fantasia: p.fantasyName || '', doc: p.cnpj || p.cpf || '' };
    } catch (e) { console.error('erro', kind, e.response?.status, JSON.stringify(e.response?.data)?.slice(0, 200)); }
  }
}
console.error('fornecedores distintos:', codes.length, 'com nome:', Object.keys(nomes).length);
fs.writeFileSync(`${D}/fornecedores-totvs.json`, JSON.stringify(nomes));
fs.writeFileSync(`${D}/branches.json`, JSON.stringify(branchName));
