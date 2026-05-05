import { createClient } from "@supabase/supabase-js";
const supabase = createClient("https://wnjapaczjcvhumfikwwe.supabase.co",process.env.SUPABASE_FISCAL_KEY);
const datemin = "2026-04-01", datemax = "2026-04-21";
let allData = [], offset = 0;
while(true){
  const {data,error} = await supabase.from("notas_fiscais").select("total_value,operation_name,operation_code").eq("operation_type","Output").not("invoice_status","eq","Canceled").not("invoice_status","eq","Deleted").gte("issue_date",datemin).lte("issue_date",datemax).range(offset,offset+999);
  if(error){console.error(error);process.exit(1);}
  allData=allData.concat(data);
  if(data.length<1000)break;
  offset+=1000;
}
const opsConhecidas = new Set([510,545,7235,7236,7234,7241,7242,7243,5102,5202,9120,9121,9113,9111,7806,7809,1407,512]);
const byOp={};
for(const r of allData){
  const key=`[${r.operation_code}] ${r.operation_name||""}`;
  if(!byOp[key])byOp[key]={code:r.operation_code,count:0,total:0};
  byOp[key].count++;byOp[key].total+=parseFloat(r.total_value)||0;
}
const sorted=Object.entries(byOp).sort((a,b)=>b[1].total-a[1].total);
let tIn=0,tOut=0;
console.log("\n=== JA no filtro ===");
for(const [k,v] of sorted){if(opsConhecidas.has(v.code)){tIn+=v.total;console.log(` ${k}: R$ ${v.total.toLocaleString("pt-BR",{minimumFractionDigits:2})}`);}}
console.log(`SUBTOTAL: R$ ${tIn.toLocaleString("pt-BR",{minimumFractionDigits:2})}`);
console.log("\n=== FORA do filtro (valor > 0) ===");
for(const [k,v] of sorted){if(!opsConhecidas.has(v.code)&&v.total>0){tOut+=v.total;console.log(` ${k}: R$ ${v.total.toLocaleString("pt-BR",{minimumFractionDigits:2})}`);}}
console.log(`SUBTOTAL: R$ ${tOut.toLocaleString("pt-BR",{minimumFractionDigits:2})}`);
console.log(`\nTOTAL GERAL: R$ ${(tIn+tOut).toLocaleString("pt-BR",{minimumFractionDigits:2})}`);
