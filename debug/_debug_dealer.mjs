import supabaseFiscal from './config/supabaseFiscal.js';

async function main() {
  // Query first 5000 NFs and build dealer map (same as step 3.5)
  const dealerMap = new Map();
  let offset = 0;
  const PAGE = 1000;
  let hasMore = true;
  let totalRows = 0;

  while (hasMore) {
    const { data: nfRows, error: nfErr } = await supabaseFiscal
      .from('notas_fiscais')
      .select('person_code, issue_date, items')
      .eq('operation_type', 'Output')
      .not('invoice_status', 'eq', 'Canceled')
      .not('invoice_status', 'eq', 'Deleted')
      .gte('issue_date', '2025-05-01')
      .lte('issue_date', '2026-04-20')
      .range(offset, offset + PAGE - 1);
    if (nfErr || !nfRows || nfRows.length === 0) {
      console.log('Query stopped at offset', offset, nfErr?.message);
      break;
    }
    totalRows += nfRows.length;
    for (const nf of nfRows) {
      const key = `${nf.person_code}::${nf.issue_date}`;
      if (dealerMap.has(key)) continue;
      for (const item of (nf.items || [])) {
        const prods = item.products?.length > 0 ? item.products : [item];
        for (const p of prods) {
          const dc = parseInt(p.dealerCode);
          if (dc && !isNaN(dc)) {
            dealerMap.set(key, dc);
            break;
          }
        }
        if (dealerMap.has(key)) break;
      }
    }
    hasMore = nfRows.length === PAGE;
    offset += PAGE;
    if (offset > 50000) break; // limit
  }

  console.log(`NFs fetched: ${totalRows}`);
  console.log(`dealerMap size: ${dealerMap.size}`);

  // Show all unique dealer codes
  const allDealerCodes = new Set(dealerMap.values());
  console.log(`Unique dealerCodes:`, [...allDealerCodes].sort((a,b)=>a-b));

  // Check for multimarcas sellers
  const multimarcas = [21, 26, 65, 69, 177, 259];
  for (const code of multimarcas) {
    const entries = [];
    for (const [k, v] of dealerMap) {
      if (v === code) entries.push(k);
    }
    console.log(`\ndealerCode ${code}: ${entries.length} NFs`);
    if (entries.length > 0 && entries.length <= 5) {
      entries.forEach(e => console.log(`  ${e}`));
    } else if (entries.length > 5) {
      entries.slice(0, 3).forEach(e => console.log(`  ${e}`));
      console.log(`  ... e mais ${entries.length - 3}`);
    }
  }

  // Show 5 sample keys from dealerMap
  console.log('\nSample keys from dealerMap:');
  let i = 0;
  for (const [k, v] of dealerMap) {
    console.log(`  "${k}" → ${v}`);
    if (++i >= 5) break;
  }
}

main().catch(console.error);
