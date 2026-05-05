import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://wnjapaczjcvhumfikwwe.supabase.co",process.env.SUPABASE_FISCAL_KEY);
const {data,error} = await sb.from("notas_fiscais").select("operation_code,total_value,items").eq("operation_type","Output").not("invoice_status","eq","Canceled").not("invoice_status","eq","Deleted").gte("issue_date","2026-04-01").lte("issue_date","2026-04-21").in("operation_code",[7235,7241]).limit(3);
if(error){console.error(error);process.exit(1);}
console.log("NFs encontradas:",data.length);
for(const nf of data){
  console.log(`\nop=${nf.operation_code} total=${nf.total_value}`);
  const itens = nf.items||[];
  for(const item of itens.slice(0,2)){
    const prods = item.products||[];
    for(const p of prods.slice(0,2)) console.log("  dealerCode=",p.dealerCode,"netValue=",p.netValue);
  }
}
