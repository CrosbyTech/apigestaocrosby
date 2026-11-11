import 'dotenv/config';
import supabase from '../../config/supabase.js';
import { postTotvs } from '../../services/bluecardLimite.js';
const { data } = await supabase.from('accounts_payable_commands').select('id,sucesso,payload,resposta,criado_em,origem_tabela').eq('origem_tabela', 'conciliacao-tarifas').order('id', { ascending: false }).limit(5);
for (const c of data || []) console.log(c.id, c.sucesso, c.criado_em, c.payload?.supplierCpfCnpj, c.payload?.branchCnpj, c.payload?.installments?.[0]?.duplicateValue, JSON.stringify(c.resposta).slice(0, 200));
for (const [path, f] of [['/person/v2/individuals/search', 'cpfList'], ['/person/v2/legal-entities/search', 'cnpjList']]) {
  const r = await postTotvs(path, { filter: { [f]: ['53593588404'] }, page: 1, pageSize: 2 }).catch((e) => ({ data: { erro: e.message } }));
  console.log(path, JSON.stringify(r.data?.items?.map((x) => ({ code: x.code, name: x.name, cpf: x.cpf, isSupplier: x.isSupplier, types: x.personTypes || x.customerType })) || r.data).slice(0, 400));
}
const { data: s } = await supabase.from('accounts_payable_duplicates_v').select('supplier_code,supplier_name,supplier_cpf_cnpj').ilike('supplier_name', '%ANTONIO PAULINO%').limit(5);
console.log('no CP do TOTVS:', s);
process.exit(0);
