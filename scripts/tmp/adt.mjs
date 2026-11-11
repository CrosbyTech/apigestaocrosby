import 'dotenv/config';
import { listarAdiantamentos } from '../../services/adiantamentosFornecedor.js';
console.log(await listarAdiantamentos({}));
process.exit(0);
