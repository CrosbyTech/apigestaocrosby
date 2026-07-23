// Cria o bucket privado 'curriculos' no Supabase Storage (currículos do Banco
// de Talentos). Idempotente — se já existir, não faz nada.
// Uso: node scripts/create-curriculos-bucket.mjs
import supabase from '../config/supabase.js';

const BUCKET = 'curriculos';

const { data: existentes, error: listErr } = await supabase.storage.listBuckets();
if (listErr) {
  console.error('❌ Erro ao listar buckets:', listErr.message);
  process.exit(1);
}

if ((existentes || []).some((b) => b.name === BUCKET)) {
  console.log(`✅ Bucket '${BUCKET}' já existe — nada a fazer.`);
  process.exit(0);
}

const { error } = await supabase.storage.createBucket(BUCKET, {
  public: false, // privado — download só via signed URL gerada pela API
  fileSizeLimit: '10MB',
  allowedMimeTypes: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
});
if (error) {
  console.error(`❌ Erro ao criar bucket '${BUCKET}':`, error.message);
  process.exit(1);
}
console.log(`✅ Bucket privado '${BUCKET}' criado com sucesso!`);
