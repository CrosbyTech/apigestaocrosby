import { readFileSync, writeFileSync } from 'fs';

const file = 'C:/Users/teccr/gestaocrosby/src/pages/FaturamentoCanal.jsx';
let c = readFileSync(file, 'utf8');

// ── Comparativo: injetar card Credev depois dos 3 cards existentes ─────────
// Encontrar o ponto onde o .map() fecha — após o último ]; da linha dos cards
const compMarker = "sublabel: 'Real vs Acumulado',";
const compIdx = c.indexOf(compMarker);
console.log('compMarker idx:', compIdx);

if (compIdx < 0) { console.error('Marcador não encontrado'); process.exit(1); }

// Encontrar o ].map( após o compIdx
const mapCallIdx = c.indexOf('].map(', compIdx);
console.log('].map( idx:', mapCallIdx);

// Inserir 4º card antes do ].map(
const credevCard = `  ,{
                    label: 'Credev (Devolu\u00C3\u00A7\u00C3\u00B5es)',
                    sublabel: 'NFs de devolu\u00C3\u00A7\u00C3\u00A3o do per\u00C3\u00ADodo',
                    valor: comp.atual?.credev_total || 0,
                    prefix: '- R$',
                    color: comp.atual?.credev_total > 0 ? 'text-red-600' : 'text-gray-400',
                    bg: comp.atual?.credev_total > 0 ? 'bg-red-50' : undefined,
                  }\r\n                `;

const oldMap = c.substring(mapCallIdx - 20, mapCallIdx + 6);
console.log('oldMap snippet:', JSON.stringify(oldMap));

const newContent = c.substring(0, mapCallIdx) + credevCard + c.substring(mapCallIdx);
writeFileSync(file, newContent, 'utf8');
console.log('Done inserting Credev card!');
