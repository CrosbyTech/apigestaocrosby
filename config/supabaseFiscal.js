import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl =
  process.env.SUPABASE_FISCAL_URL || 'https://wnjapaczjcvhumfikwwe.supabase.co';
const supabaseKey = process.env.SUPABASE_FISCAL_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    'Erro: SUPABASE_FISCAL_URL ou SUPABASE_FISCAL_KEY não estão definidos',
  );
}

// Cliente para o banco fiscal (segundo projeto Supabase)
const supabaseFiscal = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  db: {
    schema: 'public',
  },
});

export default supabaseFiscal;
