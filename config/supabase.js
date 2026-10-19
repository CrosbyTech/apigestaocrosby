import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// URL e service_role key SÓ por env (SUPABASE_URL / SUPABASE_SERVICE_KEY).
// A chave que ficava hardcoded aqui foi removida do código: está no .env
// (local) e no painel do Render (produção). Rotacionar no painel do Supabase.
const supabaseUrl = process.env.SUPABASE_URL || 'https://dorztqiunewggydvkjnf.supabase.co';
let supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseServiceKey) {
  console.error('❌ SUPABASE_SERVICE_KEY ausente no ambiente — o backend não consegue acessar o Supabase.');
  // placeholder só para o módulo carregar (testes/CI); toda chamada vai falhar com 401
  supabaseServiceKey = 'missing-service-key';
}

// Cliente admin para operações server-side (upsert, insert, etc.)
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  db: {
    schema: 'public',
  },
});

export default supabase;
