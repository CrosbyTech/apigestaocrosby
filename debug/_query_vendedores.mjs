import { createClient } from "@supabase/supabase-js";
const sb = createClient(
  "https://dorztqiunewggydvkjnf.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRvcnp0cWl1bmV3Z2d5ZHZram5mIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NzA3MTI4OCwiZXhwIjoyMDYyNjQ3Mjg4fQ.sk6z1v-MKAjiQK-IfIvPvxI-GdRyH_Biaj5a-8_Ksy8"
);
const { data, error } = await sb.from("v_vendedores_integracao").select("totvs_id, nome_vendedor, modulo, ativo");
if(error){console.error(error);process.exit(1);}
console.log("Total:", data.length);
for(const r of data.sort((a,b)=>(a.modulo||"z").localeCompare(b.modulo||"z"))){
  console.log(` [${r.totvs_id}] ${r.nome_vendedor} | modulo=${r.modulo} | ativo=${r.ativo}`);
}
