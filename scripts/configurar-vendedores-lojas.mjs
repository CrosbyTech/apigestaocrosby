// Vendedores das lojas: cada um só com a PRÓPRIA empresa no HeadCoach e com as
// páginas do PDV, Transações, Transferências, Caixa e Recebimento/Estoque
// liberadas (pedido do Yago em 13/11/2026). Só ACRESCENTA: não tira nenhuma
// página que o vendedor já tinha. A empresa vinculada passa a ser só a da loja.
//   node scripts/configurar-vendedores-lojas.mjs          → mostra o que vai fazer
//   node scripts/configurar-vendedores-lojas.mjs aplicar  → grava
import supabase from '../config/supabase.js';

const VENDEDORES = {
  // 87 - CIDADE JARDIM
  'grasiellysouza@timecrosby.com': 87,
  'yasminsolano@timecrosby.com': 87,
  // 2 - JOÃO PESSOA
  'ayararibeiro@timecrosby.com': 2,
  // 95 - MIDWAY
  'arthurleite@timecrosby.com': 95,
  'manuellicelestino@timecrosby.com': 95, // Manuelli (a lista trazia manuelli.sc@hotmail.com, que não tem conta)
  // 90 - AYRTON SENNA
  'leidemedeiros@timecrosby.com': 90,
  'leticialopes@timecrosby.com': 90,
  // 55 - PARNAMIRIM
  'deborabarbosa@timecrosby.com': 55,
  // 5 - NOVA CRUZ
  'emanuellysilva@timecrosby.com': 5,
  // 65 - CANGUARETAMA
  'jucelirvendascanguaretama@timecrosby.com': 65,
};

const PAGINAS = [
  '/home', // tela inicial do app do PDV (atalhos do caixa)
  '/tecnologia/pdv-crosby',
  '/headcoach/transacoes',
  '/transferencias-mercadoria',
  '/headcoach/caixa/abertura',
  '/headcoach/caixa/contagem',
  '/headcoach/caixa/fechamento',
  '/varejo/recebimento-mercadoria', // recebimento + aba Estoque
];

const aplicar = process.argv.includes('aplicar');
const usuarios = [];
for (let p = 1; p <= 30; p++) {
  const { data, error } = await supabase.auth.admin.listUsers({ page: p, perPage: 200 });
  if (error) throw error;
  usuarios.push(...data.users);
  if (data.users.length < 200) break;
}

let falhas = 0;
for (const [email, empresa] of Object.entries(VENDEDORES)) {
  const u = usuarios.find((x) => String(x.email || '').toLowerCase() === email);
  if (!u) {
    console.log(`✗ ${email}: usuário não encontrado`);
    falhas += 1;
    continue;
  }
  const [{ data: pags }, { data: comps }] = await Promise.all([
    supabase.from('user_page_permissions').select('page_path').eq('user_id', u.id),
    supabase.from('user_companies').select('cd_empresa').eq('user_id', u.id),
  ]);
  const tem = new Set((pags || []).map((p) => p.page_path));
  const novas = PAGINAS.filter((p) => !tem.has(p));
  const atuais = (comps || []).map((c) => Number(c.cd_empresa));
  const empresaOk = atuais.length === 1 && atuais[0] === empresa;
  console.log(`${aplicar ? '→' : '·'} ${email} (${u.user_metadata?.name || '-'}, ${u.user_metadata?.role || 'guest'}): empresa [${atuais.join(',') || 'nenhuma'}] → [${empresa}] · páginas novas: ${novas.join(' ') || 'nenhuma'}`);
  if (!aplicar) continue;
  if (!empresaOk) {
    const { error: e1 } = await supabase.from('user_companies').delete().eq('user_id', u.id);
    const { error: e2 } = e1 ? { error: e1 } : await supabase.from('user_companies').insert({ user_id: u.id, cd_empresa: empresa });
    if (e2) {
      console.log(`   ✗ empresa: ${e2.message}`);
      falhas += 1;
    }
  }
  if (novas.length) {
    const { error: e3 } = await supabase.from('user_page_permissions').insert(novas.map((page_path) => ({ user_id: u.id, page_path })));
    if (e3) {
      console.log(`   ✗ páginas: ${e3.message}`);
      falhas += 1;
    }
  }
}
console.log(aplicar ? (falhas ? `\nTERMINOU COM ${falhas} ERRO(S)` : '\nPRONTO: vendedores configurados.') : '\n(só mostrando — rode com "aplicar" para gravar)');
process.exit(0);
