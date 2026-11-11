import 'dotenv/config';
import { sincronizarTodas } from '../../services/conciliacaoPropagacao.js';
console.log(JSON.stringify(await sincronizarTodas({ de: '2024-01-01' })));
setTimeout(() => process.exit(0), 100);
