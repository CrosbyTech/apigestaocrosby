/**
 * Retorno dos boletos Pagar.me — a cada INTERVALO consulta os boletos
 * pendentes e baixa no TOTVS os que foram pagos (services/pagarmeBoletos.js).
 *
 * Desligar: PAGARME_BOLETO_RETORNO_ENABLED=false
 * Intervalo: PAGARME_BOLETO_RETORNO_MINUTOS (padrão 30)
 */
import { sincronizarRetorno } from '../services/pagarmeBoletos.js';

const ENABLED =
  String(process.env.PAGARME_BOLETO_RETORNO_ENABLED || 'true').toLowerCase() !== 'false';
const MINUTOS = Math.max(5, Number(process.env.PAGARME_BOLETO_RETORNO_MINUTOS) || 30);

let rodando = false;

async function rodar() {
  if (rodando) return;
  rodando = true;
  try {
    const r = await sincronizarRetorno();
    if (r.tabelaAusente) return;
    if (r.pagos || r.cancelados || r.baixados || r.errosBaixa) {
      console.log(
        `🧾 [retorno-boleto] ${r.consultados} consultado(s): ${r.pagos} pago(s), ${r.cancelados} cancelado(s), ` +
          `${r.baixados} baixa(s) no TOTVS, ${r.errosBaixa} erro(s) de baixa`,
      );
    }
  } catch (e) {
    console.error('❌ [retorno-boleto] job:', e.message);
  } finally {
    rodando = false;
  }
}

export function iniciarJobPagarmeBoletosRetorno() {
  if (!ENABLED) {
    console.log('⏸️ [retorno-boleto] job desligado (PAGARME_BOLETO_RETORNO_ENABLED=false)');
    return;
  }
  setTimeout(rodar, 2 * 60000);
  setInterval(rodar, MINUTOS * 60000);
  console.log(`🧾 [retorno-boleto] job ativo — a cada ${MINUTOS} min`);
}
