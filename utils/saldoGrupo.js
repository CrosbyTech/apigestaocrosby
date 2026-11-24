// Regras puras do SALDO BANCÁRIO de hora em hora (pedido do Yago, 24/11/2026):
// o bot consulta o saldo a cada 1 h e o HeadCoach manda no grupo do contas a
// pagar de SEGUNDA A SEXTA, das 9h às 20h. Aqui ficam o horário e os textos;
// quem lê o banco e manda é services/saldosGrupoWhatsapp.js.

export const HORA_INICIO = 9;
export const HORA_FIM = 20; // a consulta das 20:00 ainda vai
export const DIAS_UTEIS = [1, 2, 3, 4, 5]; // seg a sex (0 = domingo)
const FUSO = 'America/Recife';

/** Dia da semana (0 = domingo) e hora (0–23) de um instante, no horário de Recife. */
export function diaEHora(instante = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: FUSO, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instante).map((x) => [x.type, x.value]));
  const dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { dia, hora: Number(p.hour), minuto: Number(p.minute) };
}

/** O saldo vai para o grupo agora? Segunda a sexta, das 9:00 às 20:59. */
export function dentroDoHorarioDoSaldo(instante = new Date()) {
  const { dia, hora } = diaEHora(instante);
  return DIAS_UTEIS.includes(dia) && hora >= HORA_INICIO && hora <= HORA_FIM;
}

/** Os horários cheios em que o bot consulta o saldo: "09:00" … "20:00". */
export function horariosDoSaldo(inicio = HORA_INICIO, fim = HORA_FIM) {
  const out = [];
  for (let h = inicio; h <= fim; h += 1) out.push(`${String(h).padStart(2, '0')}:00`);
  return out;
}

/** "24/11 às 14:02" no horário de Recife (— quando não há data). */
export function quandoFoi(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = Object.fromEntries(new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month} às ${p.hour}:${p.minute}`;
}

const fmt = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Texto do saldo (vai quando a imagem não sai). d = o que montarSaldos devolve. */
export function textoDoSaldo(d, { assinatura = '— Veveto' } = {}) {
  const linhas = [`*Saldo bancário*: ${fmt(d.total)}`];
  for (const b of d.bancos || []) linhas.push(`• ${b.banco}: ${fmt(b.valor)}`);
  if (d.antecipavel > 0) linhas.push(`• Stone para antecipar (já no total): ${fmt(d.antecipavel)}`);
  linhas.push(`Atualizado em ${quandoFoi(d.atualizadoEm)}`);
  linhas.push(`\n${assinatura}`);
  return linhas.join('\n');
}
