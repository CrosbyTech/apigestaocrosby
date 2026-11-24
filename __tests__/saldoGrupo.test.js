import { describe, it, expect } from '@jest/globals';
import { dentroDoHorarioDoSaldo, diaEHora, horariosDoSaldo, quandoFoi, textoDoSaldo, HORA_INICIO, HORA_FIM, DIAS_UTEIS } from '../utils/saldoGrupo.js';

// horário de Recife = UTC−3 (sem horário de verão)
const recife = (dia, hora, minuto = 0) => new Date(`${dia}T${String(hora + 3).padStart(2, '0')}:${String(minuto).padStart(2, '0')}:00Z`);

describe('quando o saldo vai para o grupo', () => {
  it('a regra é segunda a sexta, das 9h às 20h', () => {
    expect([HORA_INICIO, HORA_FIM]).toEqual([9, 20]);
    expect(DIAS_UTEIS).toEqual([1, 2, 3, 4, 5]);
  });

  it('dia útil dentro do horário: vai (24/11/2026 é terça)', () => {
    expect(diaEHora(recife('2026-11-24', 14, 2))).toEqual({ dia: 2, hora: 14, minuto: 2 });
    expect(dentroDoHorarioDoSaldo(recife('2026-11-24', 9))).toBe(true);
    expect(dentroDoHorarioDoSaldo(recife('2026-11-24', 14, 2))).toBe(true);
    expect(dentroDoHorarioDoSaldo(recife('2026-11-24', 20, 1))).toBe(true); // a consulta das 20:00 termina 20:01
    expect(dentroDoHorarioDoSaldo(recife('2026-11-24', 20, 59))).toBe(true);
  });

  it('antes das 9h e depois das 20h: não vai', () => {
    expect(dentroDoHorarioDoSaldo(recife('2026-11-24', 8, 59))).toBe(false);
    expect(dentroDoHorarioDoSaldo(new Date('2026-11-25T00:00:00Z'))).toBe(false); // 21:00 de terça em Recife
    expect(dentroDoHorarioDoSaldo(recife('2026-11-24', 7))).toBe(false);
  });

  it('sábado e domingo: não vai, mesmo no horário', () => {
    expect(dentroDoHorarioDoSaldo(recife('2026-11-28', 10))).toBe(false); // sábado
    expect(dentroDoHorarioDoSaldo(recife('2026-11-29', 10))).toBe(false); // domingo
    expect(dentroDoHorarioDoSaldo(recife('2026-11-30', 10))).toBe(true); // segunda
    expect(dentroDoHorarioDoSaldo(recife('2026-11-27', 20))).toBe(true); // sexta, 20h
  });

  it('o dia é o de Recife, não o UTC: 22h de sexta em Recife já é sábado em UTC', () => {
    const sexta22h = new Date('2026-11-28T01:00:00Z');
    expect(diaEHora(sexta22h)).toMatchObject({ dia: 5, hora: 22 });
    expect(dentroDoHorarioDoSaldo(sexta22h)).toBe(false); // fora pelo horário, não pelo dia
  });
});

describe('agenda e textos', () => {
  it('as consultas são nas horas cheias, das 9h às 20h (12 por dia)', () => {
    const h = horariosDoSaldo();
    expect(h).toHaveLength(12);
    expect(h[0]).toBe('09:00');
    expect(h[11]).toBe('20:00');
  });

  it('a hora da atualização sai no horário de Recife', () => {
    expect(quandoFoi('2026-11-24T18:29:45.023+00:00')).toBe('24/11 às 15:29');
    expect(quandoFoi('2026-11-25T01:05:00Z')).toBe('24/11 às 22:05'); // ainda é dia 24 em Recife
    expect(quandoFoi(null)).toBe('—');
    expect(quandoFoi('nada')).toBe('—');
  });

  it('o texto do saldo traz total, bancos e quando foi atualizado', () => {
    const t = textoDoSaldo({ total: 37890.09, antecipavel: 11605.91, atualizadoEm: '2026-11-24T18:29:45Z', bancos: [{ banco: 'STONE', valor: 34123.29 }, { banco: 'PAGARME', valor: 3766.8 }] });
    expect(t).toMatch(/Saldo bancário\*: R\$\s37\.890,09/);
    expect(t).toMatch(/STONE: R\$\s34\.123,29/);
    expect(t).toMatch(/PAGARME: R\$\s3\.766,80/);
    expect(t).toMatch(/antecipar \(já no total\): R\$\s11\.605,91/);
    expect(t).toMatch(/Atualizado em 24\/11 às 15:29/);
    expect(t.trim().endsWith('— Veveto')).toBe(true);
  });
});
