import 'dotenv/config';
import { saidasPendentesComSugestao } from '../../services/tarifasConciliacao.js';
const t0 = Date.now();
const it = await saidasPendentesComSugestao({ de: '2026-10-01', ate: '2026-10-31' });
console.log('itens', it.length, 'tarifas', it.filter((i) => i.tarifa).length, 'ms', Date.now() - t0);
for (const i of it.filter((x) => !x.tarifa)) console.log((i.contraparte || i.descricao || '').slice(0, 32).padEnd(32), '|', String(i.valor).padStart(9), '|', i.sugestao.fornecedorCodigo || '-', (i.sugestao.fornecedorNome || '').slice(0, 28), '|', i.sugestao.despesaCodigo || '-', i.sugestao.despesaNome || '', '|', i.sugestao.fonte || '');
process.exit(0);
