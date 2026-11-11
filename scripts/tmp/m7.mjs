import 'dotenv/config';
import { saidasPendentes } from '../../services/tarifasConciliacao.js';
const it = await saidasPendentes({ de: '2026-09-30', ate: '2026-11-01' });
console.log('saidas pend', it.length);
const fs = await import('fs');
fs.writeFileSync('scripts/tmp/saidas_pend_apos.json', JSON.stringify(it.map(i=>({id:i.id,data:i.data,valor:i.valor,conta:i.conta,desc:i.descricao,cp:i.contraparte}))));
process.exit(0);
