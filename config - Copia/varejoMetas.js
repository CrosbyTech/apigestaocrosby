// Mapeamento de filiais varejo + metas mensais/semanais (B2C abr/2026).
// Tiers: BRONZE (3%) · PRATA (4%) · OURO (5%) · DIAMANTE (6%).

export const VAREJO_BRANCHES = {
  2: { code: 2, short: 'JPA', name: 'JOÃO PESSOA' },
  5: { code: 5, short: 'NVC', name: 'NOVA CRUZ' },
  55: { code: 55, short: 'PRN', name: 'PARNAMIRIM' },
  65: { code: 65, short: 'CGT', name: 'CANGUARETAMA' },
  87: { code: 87, short: 'CJD', name: 'CIDADE JARDIM' },
  88: { code: 88, short: 'GUA', name: 'GUARARAPES' },
  90: { code: 90, short: 'AYT', name: 'AYRTON SENNA' },
  93: { code: 93, short: 'IMP', name: 'IMPERATRIZ' },
  94: { code: 94, short: 'PTS', name: 'PATOS' },
  95: { code: 95, short: 'MID', name: 'MIDWAY' },
  97: { code: 97, short: 'TER', name: 'TERESINA' },
  98: { code: 98, short: 'RCF', name: 'RECIFE' },
};

// Lista de codes na ordem de exibição (Midway primeiro como no PDF)
export const VAREJO_BRANCH_CODES = [
  95, 2, 5, 55, 97, 93, 94, 90, 98, 65, 88, 87,
];

// Op codes de venda B2C (varejo).
// NOTA: op_code=1 é Vale Troca (credev) — fica em CREDEV_OP_CODES, não aqui.
export const VAREJO_OP_CODES = [
  545, 546, 548, 9033, 9001, 9009, 510, 521, 511, 522, 9017, 9027,
];

// Helpers para metas — campos: bronze/prata/ouro/diamante
const M = (b, p, o, d) => ({ bronze: b, prata: p, ouro: o, diamante: d });

// ── Meta mensal abr/2026 ──
const META_MENSAL_2026_04 = {
  95: M(120000, 144000, 180000, 240000),
  2: M(39000, 46800, 58500, 78000),
  5: M(10000, 12000, 15000, 20000),
  55: M(14000, 16800, 21000, 28000),
  97: M(42000, 50400, 63000, 84000),
  93: M(18000, 21600, 27000, 36000),
  94: M(32000, 38400, 48000, 64000),
  90: M(25000, 30000, 37500, 50000),
  98: M(50000, 60000, 75000, 100000),
  65: M(13000, 15600, 19500, 26000),
  88: M(42000, 50400, 63000, 84000),
  87: M(32000, 38400, 48000, 64000),
};

// ── Metas semanais abr/2026 ──
const META_SEMANAL_2026_04 = [
  {
    inicio: '2026-03-30',
    fim: '2026-04-05',
    label: '30/03 – 05/04',
    metas: {
      95: M(19200, 23040, 28800, 38400),
      2: M(6240, 7488, 9360, 12480),
      5: M(1600, 1920, 2400, 3200),
      55: M(2240, 2688, 3360, 4480),
      97: M(6720, 8064, 10080, 13440),
      93: M(2880, 3456, 4320, 5760),
      94: M(5120, 6144, 7680, 10240),
      90: M(4000, 4800, 6000, 8000),
      98: M(8000, 9600, 12000, 16000),
      65: M(2080, 2496, 3120, 4160),
      88: M(6720, 8064, 10080, 13440),
      87: M(5120, 6144, 7680, 10240),
    },
  },
  {
    inicio: '2026-04-06',
    fim: '2026-04-12',
    label: '06/04 – 12/04',
    metas: {
      95: M(21600, 25920, 32400, 43200),
      2: M(7020, 8424, 10530, 14040),
      5: M(1800, 2160, 2700, 3600),
      55: M(2520, 3024, 3780, 5040),
      97: M(7560, 9072, 11340, 15120),
      93: M(3240, 3888, 4860, 6480),
      94: M(5760, 6912, 8640, 11520),
      90: M(4500, 5400, 6750, 9000),
      98: M(9000, 10800, 13500, 18000),
      65: M(2340, 2808, 3510, 4680),
      88: M(7560, 9072, 11340, 15120),
      87: M(5760, 6912, 8640, 11520),
    },
  },
  {
    inicio: '2026-04-13',
    fim: '2026-04-19',
    label: '13/04 – 19/04',
    metas: {
      95: M(30000, 36000, 45000, 60000),
      2: M(9750, 11700, 14625, 19500),
      5: M(2500, 3000, 3750, 5000),
      55: M(3500, 4200, 5250, 7000),
      97: M(10500, 12600, 15750, 21000),
      93: M(4500, 5400, 6750, 9000),
      94: M(8000, 9600, 12000, 16000),
      90: M(6250, 7500, 9375, 12500),
      98: M(12500, 15000, 18750, 25000),
      65: M(3250, 3900, 4875, 6500),
      88: M(10500, 12600, 15750, 21000),
      87: M(8000, 9600, 12000, 16000),
    },
  },
  {
    inicio: '2026-04-20',
    fim: '2026-04-26',
    label: '20/04 – 26/04',
    metas: {
      95: M(25200, 30240, 37800, 50400),
      2: M(8190, 9828, 12285, 16380),
      5: M(2100, 2520, 3150, 4200),
      55: M(2940, 3528, 4410, 5880),
      97: M(8820, 10584, 13230, 17640),
      93: M(3780, 4536, 5670, 7560),
      94: M(6720, 8064, 10080, 13440),
      90: M(5250, 6300, 7875, 10500),
      98: M(10500, 12600, 15750, 21000),
      65: M(2730, 3276, 4095, 5460),
      88: M(8820, 10584, 13230, 17640),
      87: M(6720, 8064, 10080, 13440),
    },
  },
  {
    inicio: '2026-04-27',
    fim: '2026-05-03',
    label: '27/04 – 03/05',
    metas: {
      95: M(24000, 28800, 36000, 48000),
      2: M(7800, 9360, 11700, 15600),
      5: M(2000, 2400, 3000, 4000),
      55: M(2800, 3360, 4200, 5600),
      97: M(8400, 10080, 12600, 16800),
      93: M(3600, 4320, 5400, 7200),
      94: M(6400, 7680, 9600, 12800),
      90: M(5000, 6000, 7500, 10000),
      98: M(10000, 12000, 15000, 20000),
      65: M(2600, 3120, 3900, 5200),
      88: M(8400, 10080, 12600, 16800),
      87: M(6400, 7680, 9600, 12800),
    },
  },
];

// ── Lookup de metas ──
// Retorna a meta mensal de um YYYY-MM
export function getMetaMensal(yyyymm) {
  if (yyyymm === '2026-04') return META_MENSAL_2026_04;
  return null;
}

// Retorna a meta semanal cuja janela contém a maior parte do range
// (ou a primeira semana que sobrepõe). datemin/datemax: 'YYYY-MM-DD'.
export function getMetaSemanal(datemin, datemax) {
  if (!datemin || !datemax) return null;
  // Match exato pela data de início
  const exact = META_SEMANAL_2026_04.find((w) => w.inicio === datemin);
  if (exact) return exact;
  // Match por sobreposição
  const overlap = META_SEMANAL_2026_04.find(
    (w) => w.inicio <= datemax && w.fim >= datemin,
  );
  return overlap || null;
}

// Retorna metas somadas para um intervalo arbitrário (mensal calc):
// soma todas as semanas que sobrepõem o range. Use pra "período".
export function getMetaPeriodo(datemin, datemax) {
  if (!datemin || !datemax) return null;
  const sum = {};
  let count = 0;
  for (const w of META_SEMANAL_2026_04) {
    if (w.inicio <= datemax && w.fim >= datemin) {
      count += 1;
      for (const [code, m] of Object.entries(w.metas)) {
        if (!sum[code]) sum[code] = M(0, 0, 0, 0);
        sum[code].bronze += m.bronze;
        sum[code].prata += m.prata;
        sum[code].ouro += m.ouro;
        sum[code].diamante += m.diamante;
      }
    }
  }
  return count > 0 ? sum : null;
}
