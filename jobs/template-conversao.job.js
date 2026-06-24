/**
 * Job: Conversão de templates → vendas
 * Cruza template_disparos.person_code com notas_fiscais (issue_date >= sent_at)
 * pra preencher: comprou, data_compra, valor_compra, nfs_apos_disparo.
 *
 * Janela de atribuição: 30 dias após o disparo (configurável).
 *
 * Cron: a cada hora — varre disparos com status=sent e ainda sem conversão calculada.
 * Manual: POST /api/forecast/sync-template-conversao
 */
import cron from 'node-cron';
import supabase from '../config/supabase.js';
import supabaseFiscal from '../config/supabaseFiscal.js';

const JANELA_DIAS = 30; // atribui vendas dentro de 30 dias após o disparo
let CONVERSAO_IN_PROGRESS = false;

export async function executarConversaoTemplate() {
  if (CONVERSAO_IN_PROGRESS) {
    console.log('⏭️ [template-conversao] já rodando, pulado');
    return { ok: false, skipped: true };
  }
  CONVERSAO_IN_PROGRESS = true;
  const t0 = Date.now();
  try {
    // Busca disparos elegíveis: status sent, com person_code, ainda não convertidos
    // (comprou=false) e sent_at não tão antigo que janela já expirou e não vale atualizar
    const limiteAntigo = new Date(Date.now() - 90 * 86400000).toISOString();
    const { data: disparos, error: dErr } = await supabase
      .from('template_disparos')
      .select('id, person_code, sent_at, campaign_id')
      .eq('status', 'sent')
      .eq('comprou', false)
      .not('person_code', 'is', null)
      .gte('sent_at', limiteAntigo)
      .limit(5000);

    if (dErr) {
      console.error(`[template-conversao] erro busca: ${dErr.message}`);
      return { ok: false, erro: dErr.message };
    }
    if (!disparos?.length) {
      console.log('[template-conversao] 0 disparos pra processar');
      return { ok: true, processados: 0, convertidos: 0 };
    }

    console.log(`🔄 [template-conversao] processando ${disparos.length} disparos`);

    // Agrupa por person_code pra reduzir queries
    const porPessoa = new Map(); // person_code → [{id, sent_at}]
    for (const d of disparos) {
      const pc = Number(d.person_code);
      if (!porPessoa.has(pc)) porPessoa.set(pc, []);
      porPessoa.get(pc).push({ id: d.id, sent_at: d.sent_at });
    }
    const personCodes = [...porPessoa.keys()];

    // Busca NFs em chunks de 500 person_codes
    const CHUNK = 500;
    let convertidos = 0;
    const updates = []; // { id, comprou, data_compra, valor_compra, nfs_apos_disparo }

    for (let i = 0; i < personCodes.length; i += CHUNK) {
      const batch = personCodes.slice(i, i + CHUNK);

      const { data: nfs, error: nfErr } = await supabaseFiscal
        .from('notas_fiscais')
        .select('person_code, total_value, issue_date, operation_type, invoice_status')
        .in('person_code', batch);
      if (nfErr) {
        console.warn(`[template-conversao] NFs chunk ${i}: ${nfErr.message}`);
        continue;
      }

      // Filtra Output válidas
      const nfsValidas = (nfs || []).filter(
        (n) => n.operation_type === 'Output'
          && n.invoice_status !== 'Canceled'
          && n.invoice_status !== 'Deleted',
      );

      // Index por person_code
      const nfsPorPessoa = new Map();
      for (const nf of nfsValidas) {
        const pc = Number(nf.person_code);
        if (!nfsPorPessoa.has(pc)) nfsPorPessoa.set(pc, []);
        nfsPorPessoa.get(pc).push(nf);
      }

      // Pra cada disparo, verifica NFs dentro da janela [sent_at, sent_at + 30d]
      for (const pc of batch) {
        const disparosDaPessoa = porPessoa.get(pc) || [];
        const nfsDaPessoa = nfsPorPessoa.get(pc) || [];
        if (nfsDaPessoa.length === 0) continue;

        for (const disp of disparosDaPessoa) {
          const sentDate = new Date(disp.sent_at);
          const fimJanela = new Date(sentDate.getTime() + JANELA_DIAS * 86400000);
          const nfsNaJanela = nfsDaPessoa.filter((nf) => {
            const dt = new Date(`${nf.issue_date}T00:00:00Z`);
            return dt >= sentDate && dt <= fimJanela;
          });
          if (nfsNaJanela.length === 0) continue;

          // Soma + 1ª data
          const valorCompra = nfsNaJanela.reduce(
            (s, n) => s + Number(n.total_value || 0), 0,
          );
          const primeiraCompra = nfsNaJanela
            .map((n) => n.issue_date).sort()[0];

          updates.push({
            id: disp.id,
            comprou: true,
            data_compra: primeiraCompra,
            valor_compra: Math.round(valorCompra * 100) / 100,
            nfs_apos_disparo: nfsNaJanela.length,
          });
          convertidos++;
        }
      }
    }

    // Aplica updates em lotes
    if (updates.length > 0) {
      const UPD_BATCH = 200;
      for (let i = 0; i < updates.length; i += UPD_BATCH) {
        const slice = updates.slice(i, i + UPD_BATCH);
        await Promise.all(slice.map((u) =>
          supabase.from('template_disparos').update({
            comprou: u.comprou,
            data_compra: u.data_compra,
            valor_compra: u.valor_compra,
            nfs_apos_disparo: u.nfs_apos_disparo,
          }).eq('id', u.id),
        ));
      }
    }

    const dur = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`✅ [template-conversao] ${disparos.length} processados, ${convertidos} converteram em ${dur}s`);
    return { ok: true, processados: disparos.length, convertidos };
  } catch (e) {
    console.error(`[template-conversao] erro: ${e.message}`);
    return { ok: false, erro: e.message };
  } finally {
    CONVERSAO_IN_PROGRESS = false;
  }
}

export function iniciarJobConversaoTemplate() {
  // A cada hora, no minuto 15 (depois do sync NFs das 02h/09h/12h/15h/18h/21h)
  cron.schedule('15 * * * *', () => {
    executarConversaoTemplate().catch((e) =>
      console.warn(`[template-conversao cron] ${e.message}`),
    );
  }, { timezone: 'America/Sao_Paulo' });
  console.log('⏰ [template-conversao] agendado a cada 1h (min 15) BRT');
}
