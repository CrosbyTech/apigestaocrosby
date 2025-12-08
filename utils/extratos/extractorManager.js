import path from 'path';
import { processBBExtracts } from './bbExtractor.js';
import { processCaixaExtracts } from './caixaExtractor.js';
import { processSantanderExtracts } from './santanderExtractor.js';
import { processItauExtracts } from './itauExtractor.js';
import { processSicrediExtracts } from './sicrediExtractor.js';
import { processBNBExtracts } from './bnbExtractor.js';
import { processUnicredExtracts } from './unicredExtractor.js';
import { processBradescoExtracts } from './bradescoExtractor.js';

/**
 * Mapeia o nome do banco para a função de processamento correspondente
 */
const EXTRACTORS_MAP = {
  bb: processBBExtracts,
  caixa: processCaixaExtracts,
  santander: processSantanderExtracts,
  itau: processItauExtracts,
  sicredi: processSicrediExtracts,
  bnb: processBNBExtracts,
  unicred: processUnicredExtracts,
  bradesco: processBradescoExtracts,
};

/**
 * Normaliza valores monetários de string para número
 * @param {string} value - Valor no formato "1.234,56" ou "-1.234,56"
 * @returns {number}
 */
function normalizeMoneyToNumber(value) {
  if (typeof value === 'number') return value;
  if (!value) return 0;

  const cleaned = value
    .toString()
    .replace(/R\$\s?/i, '')
    .replace(/\s+/g, '')
    .replace(/\./g, '')
    .replace(',', '.');

  return parseFloat(cleaned) || 0;
}

/**
 * Normaliza estrutura de transação para formato padrão
 * Bradesco/Unicred usam {data, descricao, valor, saldo}
 * Outros bancos usam {date, history, value, saldo, type}
 */
function normalizeTransaction(tx) {
  // Se já está no formato padrão
  if (tx.date && tx.history) {
    return {
      date: tx.date,
      history: tx.history || '',
      value: normalizeMoneyToNumber(tx.value),
      saldo: tx.saldo ? normalizeMoneyToNumber(tx.saldo) : null,
      type:
        tx.type ||
        (normalizeMoneyToNumber(tx.value) < 0 ? 'DEBITO' : 'CREDITO'),
      raw: tx.raw || '',
    };
  }

  // Se está no formato Bradesco/Unicred
  if (tx.data && tx.descricao !== undefined) {
    return {
      date: tx.data,
      history: tx.descricao || '',
      value: normalizeMoneyToNumber(tx.valor),
      saldo: tx.saldo ? normalizeMoneyToNumber(tx.saldo) : null,
      type: normalizeMoneyToNumber(tx.valor) < 0 ? 'DEBITO' : 'CREDITO',
      raw: tx.linha || '',
    };
  }

  // Fallback - retorna como está
  return tx;
}

/**
 * Extrai o nome da conta do caminho do arquivo
 * Ex: "C:/path/EXTRATO NOVEMBRO/BB/BB CROSBY.pdf" -> "CROSBY"
 * Ex: "C:/path/EXTRATO NOVEMBRO/SANTANDER/SANTANDER JP.pdf" -> "JP"
 */
function extractAccountName(filePath) {
  const filename = path.basename(filePath, '.pdf');

  // Remove o nome do banco do início do arquivo
  const bancos = [
    'BB',
    'CAIXA',
    'SANTANDER',
    'ITAU',
    'SICREDI',
    'BNB',
    'UNICRED',
    'BRADESCO',
  ];
  let accountName = filename;

  for (const banco of bancos) {
    if (filename.toUpperCase().startsWith(banco)) {
      accountName = filename.substring(banco.length).trim();
      break;
    }
  }

  return accountName || filename;
}

/**
 * Agrupa resultados de extração por conta bancária
 * Calcula totais de crédito e débito para cada conta
 */
export function groupByAccount(results) {
  const accounts = {};

  for (const result of results) {
    const accountName = extractAccountName(result.file);

    if (!accounts[accountName]) {
      accounts[accountName] = {
        account: accountName,
        file: result.file,
        transactions: [],
        totalCredito: 0,
        totalDebito: 0,
        quantidadeTransacoes: 0,
      };
    }

    // Normaliza e adiciona transações
    const normalizedTransactions =
      result.transactions.map(normalizeTransaction);
    accounts[accountName].transactions.push(...normalizedTransactions);

    // Calcula totais
    for (const tx of normalizedTransactions) {
      if (tx.type === 'CREDITO') {
        accounts[accountName].totalCredito += Math.abs(tx.value);
      } else if (tx.type === 'DEBITO') {
        accounts[accountName].totalDebito += Math.abs(tx.value);
      }
    }

    accounts[accountName].quantidadeTransacoes =
      accounts[accountName].transactions.length;
  }

  // Converte objeto em array
  return Object.values(accounts);
}

/**
 * Calcula totais consolidados de todas as contas
 */
export function calculateConsolidated(accountsArray) {
  const consolidated = {
    totalCredito: 0,
    totalDebito: 0,
    saldoLiquido: 0,
    totalTransacoes: 0,
    totalContas: accountsArray.length,
  };

  for (const account of accountsArray) {
    consolidated.totalCredito += account.totalCredito;
    consolidated.totalDebito += account.totalDebito;
    consolidated.totalTransacoes += account.quantidadeTransacoes;
  }

  consolidated.saldoLiquido =
    consolidated.totalCredito - consolidated.totalDebito;

  return consolidated;
}

/**
 * Processa extratos de um banco específico
 * @param {string} banco - Nome do banco (bb, caixa, santander, etc.)
 * @returns {Promise<Object>} - Dados agrupados por conta com totais
 */
export async function processExtractsByBank(banco) {
  const bancoLower = banco.toLowerCase();
  const extractorFunction = EXTRACTORS_MAP[bancoLower];

  if (!extractorFunction) {
    throw new Error(
      `Banco não suportado: ${banco}. Bancos disponíveis: ${Object.keys(
        EXTRACTORS_MAP,
      ).join(', ')}`,
    );
  }

  try {
    // Executa o extractor do banco
    const results = await extractorFunction();

    // Agrupa por conta
    const accounts = groupByAccount(results);

    // Calcula totais consolidados
    const consolidated = calculateConsolidated(accounts);

    return {
      banco: banco.toUpperCase(),
      accounts,
      consolidated,
      processedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`Erro ao processar extratos do banco ${banco}:`, error);
    throw error;
  }
}

/**
 * Lista todos os bancos disponíveis
 */
export function getAvailableBanks() {
  return Object.keys(EXTRACTORS_MAP).map((key) => key.toUpperCase());
}
