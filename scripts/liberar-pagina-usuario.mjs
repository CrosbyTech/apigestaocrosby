// Libera uma página do HeadCoach para um usuário (linha em user_page_permissions).
//   node scripts/liberar-pagina-usuario.mjs <trecho do nome ou e-mail> <page_path>
// Ex.: node scripts/liberar-pagina-usuario.mjs wend /dr-ygor/extratos-bancarios
import 'dotenv/config';
import supabase from '../config/supabase.js';

const [, , quem, pagePath] = process.argv;
if (!quem || !pagePath) {
  console.error('uso: node scripts/liberar-pagina-usuario.mjs <nome|email> <page_path>');
  process.exit(1);
}
const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
if (error) throw error;
const alvo = data.users.filter((u) => new RegExp(quem, 'i').test(`${u.email} ${u.user_metadata?.name || ''}`));
if (alvo.length !== 1) {
  console.error('usuários encontrados:', alvo.map((u) => `${u.email} (${u.user_metadata?.name || ''})`));
  process.exit(1);
}
const u = alvo[0];
const { data: ja } = await supabase.from('user_page_permissions').select('id').eq('user_id', u.id).eq('page_path', pagePath).maybeSingle();
if (ja) {
  console.log(`já liberada: ${u.email} → ${pagePath}`);
} else {
  const { error: e2 } = await supabase.from('user_page_permissions').insert({ user_id: u.id, page_path: pagePath });
  if (e2) throw e2;
  console.log(`liberada: ${u.email} (${u.user_metadata?.name || ''}) → ${pagePath}`);
}
