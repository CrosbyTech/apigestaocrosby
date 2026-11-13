// Modelos de acesso por setor (Yago, 13/11/2026): dá a cada usuário dos setores
// REVENDA / MULTIMARCAS, VAREJO e EXPEDIÇÃO (membros e gestor) as páginas do
// modelo do setor. Só ACRESCENTA: não tira nenhuma página que a pessoa já tem.
// Owner e admin ficam de fora (já veem tudo). A mesma lista está no front em
// gestaocrosby/src/config/modelosAcesso.js (botões do Gerenciador de Acessos).
// As empresas vêm da regra única utils/empresasUsuario.js (REVENDA, MULTIMARCAS
// e EXPEDIÇÃO = 99 e 990; VAREJO = a loja vinculada).
//   node scripts/aplicar-modelos-setores.mjs          → mostra o que vai fazer
//   node scripts/aplicar-modelos-setores.mjs aplicar  → grava
import supabase from '../config/supabase.js';

const BASE = ['/home', '/user-panel', '/headcoach/transacoes'];
const CAIXA = ['/headcoach/caixa/abertura', '/headcoach/caixa/contagem', '/headcoach/caixa/fechamento'];
const MODELOS = {
  revenda_multimarcas: {
    setores: ['REVENDA', 'MULTIMARCAS'],
    paginas: [
      ...BASE,
      '/headcoach/saldos-clientes',
      '/forecast-canal/multimarcas',
      '/crm-vendas',
      '/inadimplentes-multimarcas',
      '/minhas-solicitacoes-baixa',
      '/titulos-clientes',
      '/clientes-mtm',
      '/analise-credito-mtm',
      '/forecast-canal/revenda',
      '/inadimplentes-revenda',
      '/forecast-canal/franquias',
      '/ranking-compras-franquias',
      '/inadimplentes-franquias',
      '/estoque/expedicao-showroom',
    ],
  },
  varejo: {
    setores: ['VAREJO'],
    paginas: [...BASE, ...CAIXA, '/varejo/recebimento-mercadoria', '/balanco-rfid/arquivos', '/headcoach/estoque', '/tecnologia/pdv-crosby', '/ranking-faturamento'],
  },
  expedicao: {
    setores: ['EXPEDICAO'],
    paginas: [
      ...BASE,
      '/headcoach/saldos-clientes',
      ...CAIXA,
      '/expedicao/pedidos-venda',
      '/expedicao/faturamento',
      '/transferencias-mercadoria',
      '/expedicao/brejinho/pedidos',
      '/expedicao/brejinho/faturamento',
    ],
  },
};
const norm = (n) =>
  String(n || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toUpperCase();

const aplicar = process.argv.includes('aplicar');
const [{ data: setores, error: e1 }, { data: vinculos, error: e2 }] = await Promise.all([
  supabase.from('setores').select('id, nome, gestor_id'),
  supabase.from('setor_usuarios').select('setor_id, user_id'),
]);
if (e1 || e2) throw e1 || e2;
const usuarios = [];
for (let p = 1; p <= 30; p++) {
  const { data, error } = await supabase.auth.admin.listUsers({ page: p, perPage: 200 });
  if (error) throw error;
  usuarios.push(...data.users);
  if (data.users.length < 200) break;
}
const porId = new Map(usuarios.map((u) => [u.id, u]));

// usuário → páginas do(s) modelo(s) dos setores dele
const alvo = new Map();
for (const st of setores || []) {
  const modelos = Object.entries(MODELOS).filter(([, m]) => m.setores.includes(norm(st.nome)));
  if (!modelos.length) continue;
  const ids = [...(vinculos || []).filter((v) => v.setor_id === st.id).map((v) => v.user_id), ...(st.gestor_id ? [st.gestor_id] : [])];
  for (const id of ids) {
    if (!alvo.has(id)) alvo.set(id, { setores: new Set(), paginas: new Set() });
    const a = alvo.get(id);
    a.setores.add(st.nome);
    for (const [, m] of modelos) for (const pg of m.paginas) a.paginas.add(pg);
  }
}

let falhas = 0;
let usuariosMudados = 0;
let paginasNovas = 0;
for (const [id, a] of alvo) {
  const u = porId.get(id);
  const role = u?.user_metadata?.role || 'guest';
  if (!u) {
    console.log(`✗ ${id}: usuário não encontrado`);
    continue;
  }
  if (['owner', 'admin'].includes(role)) {
    console.log(`· ${u.email} (${role}) — owner/admin: já vê tudo, não mexo`);
    continue;
  }
  const { data: pags, error } = await supabase.from('user_page_permissions').select('page_path').eq('user_id', id);
  if (error) throw error;
  const tem = new Set((pags || []).map((p) => p.page_path));
  const novas = [...a.paginas].filter((p) => !tem.has(p));
  console.log(`${aplicar ? '→' : '·'} ${u.email} (${role}, ${[...a.setores].join('/')}): ${novas.length ? `+${novas.length} página(s): ${novas.join(' ')}` : 'já tem todas'}`);
  if (!novas.length) continue;
  usuariosMudados += 1;
  paginasNovas += novas.length;
  if (!aplicar) continue;
  const { error: e3 } = await supabase.from('user_page_permissions').insert(novas.map((page_path) => ({ user_id: id, page_path })));
  if (e3) {
    console.log(`   ✗ ${e3.message}`);
    falhas += 1;
  }
}
console.log(`\n${usuariosMudados} usuário(s) ganham ${paginasNovas} página(s) no total.`);
console.log(aplicar ? (falhas ? `TERMINOU COM ${falhas} ERRO(S)` : 'PRONTO: modelos aplicados.') : '(só mostrando — rode com "aplicar" para gravar)');
process.exit(0);
