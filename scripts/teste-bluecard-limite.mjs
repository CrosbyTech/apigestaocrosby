// Teste controlado da automação de limite BlueCard (pedido pelo Yago,
// 2026-08-12, no CPF DELE: 06537964474).
//
// PASSO 1: sobe o limite para R$ 150,00 em todas as filiais da regra
//          (Ranking de Faturamento tipo FILIAL) — valida o array limits
//          com múltiplas branches.
// PASSO 2: zera o limite nas mesmas filiais — valida que o TOTVS aceita 0
//          (o estado de descanso do cliente crediário).
//
// Uso: node scripts/teste-bluecard-limite.mjs
import 'dotenv/config';
import {
  definirLimiteTotvs,
  listarBranchesLimite,
} from '../services/bluecardLimite.js';

const CPF = '06537964474';
const NOME = 'YAGO MATIAS';

const branches = await listarBranchesLimite();
console.log(`branches da regra FILIAL: ${branches.length}`);

try {
  const r1 = await definirLimiteTotvs({
    cpf: CPF,
    nome: NOME,
    valorReais: 150,
    branchCodes: branches,
  });
  console.log('PASSO 1 OK (limite R$150 em todas):', JSON.stringify(r1));
} catch (e) {
  console.error(
    'PASSO 1 FALHOU:',
    e.response?.status,
    JSON.stringify(e.response?.data)?.slice(0, 800) || e.message,
  );
  process.exit(1);
}

try {
  const r2 = await definirLimiteTotvs({
    cpf: CPF,
    nome: NOME,
    valorReais: 0,
    branchCodes: branches,
  });
  console.log('PASSO 2 OK (zerado em todas):', JSON.stringify(r2));
} catch (e) {
  console.error(
    '⚠️ PASSO 2 FALHOU — O LIMITE FICOU EM R$150, zerar manualmente:',
    e.response?.status,
    JSON.stringify(e.response?.data)?.slice(0, 800) || e.message,
  );
  process.exit(1);
}

console.log('TESTE COMPLETO OK — TOTVS aceitou múltiplas branches e valor 0');
