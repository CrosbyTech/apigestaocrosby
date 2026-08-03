// MIGRAÇÃO (ago/2026): o projeto Supabase fiscal separado (wnjapaczjcvhumfikwwe)
// foi descontinuado. A tabela notas_fiscais agora vive no projeto principal.
// Este módulo passa a re-exportar o cliente principal, para que TODO o código
// que importa supabaseFiscal use o mesmo banco — sem depender das envs
// SUPABASE_FISCAL_URL/KEY (que apontavam para o projeto morto).
import supabase from './supabase.js';

const supabaseFiscal = supabase;

export default supabaseFiscal;
