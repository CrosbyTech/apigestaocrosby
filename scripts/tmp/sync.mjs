import 'dotenv/config';
import { sincronizarTodas } from '../../services/conciliacaoPropagacao.js';
const t0 = Date.now();
const r = await sincronizarTodas({ de: '2026-01-01' });
console.log(JSON.stringify(r), 'ms', Date.now() - t0);
process.exit(0);
