import 'dotenv/config';
import fs from 'fs';
import XLSX from 'xlsx';
import { saidasPendentesComSugestao } from '../../services/tarifasConciliacao.js';
const it = await saidasPendentesComSugestao({ de: '2026-10-01', ate: '2026-10-31' });
const rows = it.filter((i) => !i.tarifa).map((i) => ({
  Empresa: i.empresa, Banco: i.banco, Conta: i.conta, Data: i.data.split('-').reverse().join('/'), Histórico: i.descricao, Contraparte: i.contraparte || '', 'CPF/CNPJ': i.contraparteDoc || '', Valor: i.valor,
  'Cód. fornecedor (sugerido)': i.sugestao?.fornecedorCodigo || '', 'Fornecedor (sugerido)': i.sugestao?.fornecedorNome || '',
  'Cód. despesa (sugerida)': i.sugestao?.despesaCodigo || '', 'Despesa (sugerida)': i.sugestao?.despesaNome || '', 'Origem da sugestão': i.sugestao?.fonte || '',
  'Titia: despesa correta?': '', 'Titia: se não, qual código?': '',
}));
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet(rows);
ws['!cols'] = [22, 9, 14, 11, 34, 34, 16, 11, 12, 30, 12, 30, 30, 16, 18].map((w) => ({ wch: w }));
XLSX.utils.book_append_sheet(wb, ws, 'Saídas pendentes out-2026');
const out = 'tmp/Saidas_pendentes_out2026_despesas_para_validar.xlsx';
XLSX.writeFile(wb, out);
const com = rows.filter((r) => r['Cód. despesa (sugerida)']).length;
console.log(out, rows.length, 'com sugestão', com);
process.exit(0);
