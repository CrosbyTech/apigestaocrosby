// Libera uma página do HeadCoach para a Niziany (user_page_permissions).
// Uso: node scripts/liberar-pagina-niziany.mjs /fiscal/escrituracao-por-empresa
import 'dotenv/config';
import supabase from '../config/supabase.js';

// No Git Bash, um argumento que começa com "/" vira "C:/Program Files/Git/..."
// (conversão de caminho do MSYS). Rode com MSYS_NO_PATHCONV=1 ou deixe que
// a normalização abaixo tire o prefixo.
const bruto = String(process.argv[2] || '').replace(/\\/g, '/');
const pagePath = bruto.replace(/^[A-Za-z]:\/(Program Files\/)?Git/i, '');
if (!pagePath || !pagePath.startsWith('/')) {
  console.error(
    'Informe o page_path. Ex.: node scripts/liberar-pagina-niziany.mjs /fiscal/minha-pagina',
  );
  process.exit(1);
}

const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
if (error) throw error;
const alvo = data.users.filter((u) => {
  const nome = `${u.user_metadata?.name || ''} ${u.user_metadata?.full_name || ''} ${u.email || ''}`.toLowerCase();
  return nome.includes('nizian');
});
if (alvo.length === 0) {
  console.error('Usuário da Niziany não encontrado');
  process.exit(2);
}
for (const u of alvo) {
  const { data: ja } = await supabase
    .from('user_page_permissions')
    .select('id')
    .eq('user_id', u.id)
    .eq('page_path', pagePath)
    .limit(1);
  if (ja && ja.length) {
    console.log(`já liberada: ${u.email} → ${pagePath}`);
    continue;
  }
  const { error: e2 } = await supabase
    .from('user_page_permissions')
    .insert({ user_id: u.id, page_path: pagePath });
  if (e2) throw e2;
  console.log(`liberada: ${u.email} → ${pagePath}`);
}
