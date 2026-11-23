// Lê de novo um e-mail guardado em contas_fixas_emails e, se for fatura de uma
// operadora conhecida, lança (não duplica o que já foi lançado).
// Uso, na raiz da API: node scripts/processar-email-contas-fixas.mjs <id> [<id> ...]
import 'dotenv/config';
import { processarEmail } from '../services/contasFixasEmailFaturas.js';

for (const id of process.argv.slice(2)) {
  try {
    const r = await processarEmail(id);
    console.log(`e-mail #${id}:`, r.ok ? `LANÇADO (${r.concessionaria})` : `não lançado — ${r.motivo}`);
    for (const f of r.faturas || []) console.log(`   fatura #${f.faturaId}${f.nova ? '' : ' (já existia)'} · empresa ${f.empresa} · R$ ${Number(f.valor).toFixed(2)} · venc ${f.vencimento} · Pix ${f.pix ? 'sim' : 'não'} · Contas a Pagar: ${f.cp?.criada ? `duplicata ${f.cp.titulo.duplicata}/${f.cp.titulo.parcela} (doc. fiscal ${f.cp.titulo.documento_fiscal})` : f.cp?.motivo}`);
  } catch (e) {
    console.log(`e-mail #${id}: erro — ${e.message}`);
  }
}
process.exit(0);
