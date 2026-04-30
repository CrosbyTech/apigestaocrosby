import supabase from './config/supabase.js';

const go = async () => {
  const { data: acc } = await supabase.from('whatsapp_accounts').select('*').eq('id', 2).single();

  const start = Math.floor(new Date('2026-03-01').getTime() / 1000);
  const end = Math.floor(new Date('2026-04-06').getTime() / 1000);

  // Listar templates para pegar IDs
  const tplRes = await fetch(`https://graph.facebook.com/v22.0/${acc.waba_id}/message_templates?limit=200&fields=id,name,category`, {
    headers: { Authorization: `Bearer ${acc.access_token}` }
  });
  const tpls = await tplRes.json();
  const ids = (tpls.data || []).map(t => t.id);
  console.log('Total templates:', ids.length);

  // Query template_analytics com MONTHLY
  const templateIds = ids.map(id => `"${id}"`).join(',');
  const metricTypes = '["sent","delivered","read"]';
  const fields = `template_analytics.start(${start}).end(${end}).granularity(MONTHLY).metric_types(${metricTypes}).template_ids([${templateIds}])`;

  const aRes = await fetch(`https://graph.facebook.com/v22.0/${acc.waba_id}?fields=${encodeURIComponent(fields)}`, {
    headers: { Authorization: `Bearer ${acc.access_token}` }
  });
  const aData = await aRes.json();

  const allDp = (aData.template_analytics?.data || []).flatMap(d => d.data_points || []);
  const nonZero = allDp.filter(p => p.sent > 0 || p.delivered > 0);
  console.log('Total data_points:', allDp.length, 'Non-zero:', nonZero.length);

  if (nonZero.length > 0) {
    // Agrupar por template_id
    const byTpl = {};
    for (const p of nonZero) {
      if (!byTpl[p.template_id]) byTpl[p.template_id] = { sent: 0, delivered: 0, read: 0 };
      byTpl[p.template_id].sent += p.sent || 0;
      byTpl[p.template_id].delivered += p.delivered || 0;
      byTpl[p.template_id].read += p.read || 0;
    }
    const tplMap = {};
    for (const t of tpls.data || []) tplMap[t.id] = t;
    for (const [id, vals] of Object.entries(byTpl)) {
      const t = tplMap[id];
      console.log(`  ${t?.name || id} (${t?.category || '?'}): sent=${vals.sent} delivered=${vals.delivered} read=${vals.read}`);
    }
  } else {
    console.log('All zeros - template_analytics nao rastreia msgs enviadas via N8N');
  }
};

go().catch(console.error);
