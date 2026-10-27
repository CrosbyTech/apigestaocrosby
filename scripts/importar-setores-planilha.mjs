// Importa a planilha de classificação por setor da Niziany (27/10/2026):
// colunas EMPRESA, DATA, Nº NFE, CNPJ, RAZAO SOCIAL, CHAVE, VALOR, CLASSIFICAÇÃO.
// Grava a memória fornecedor → setor (origem 'planilha', sem sobrescrever o
// que foi escolhido manualmente) e preenche o setor das notas sem setor.
// Uso: node scripts/importar-setores-planilha.mjs <arquivo.xlsx>
import 'dotenv/config';
import fs from 'fs';
import * as XLSX from 'xlsx';
import supabase from '../config/supabase.js';
import { aplicarSetorConhecido } from '../services/sefazDfe.js';

const arquivo = process.argv[2];
if (!arquivo || !fs.existsSync(arquivo)) {
  console.error('Informe o caminho da planilha .xlsx');
  process.exit(1);
}

const digitos = (v) => String(v ?? '').replace(/\D/g, '');
const semAcento = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toUpperCase();
const CANONICO = {
  FISCAL: 'Fiscal',
  DEVOLUCAO: 'Devolução',
  TRANSFERENCIA: 'Transferência',
  PATRIMONIO: 'Patrimônio',
  PRODUCAO: 'Produção',
};
const titulo = (s) =>
  String(s || '')
    .trim()
    .toLowerCase()
    .replace(/(^|\s)\S/g, (c) => c.toUpperCase());
const canonico = (s) => CANONICO[semAcento(s)] || titulo(s);

const wb = XLSX.read(fs.readFileSync(arquivo), { type: 'buffer' });
const rows = XLSX.utils
  .sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, blankrows: false, defval: null })
  .slice(1);

// CNPJ -> { nome, contagem por setor canônico }
const porCnpj = new Map();
let ignoradas = 0;
for (const r of rows) {
  const cnpj = digitos(r[3]);
  const setor = canonico(r[7]);
  if (cnpj.length !== 14 || !setor) {
    ignoradas++;
    continue;
  }
  if (!porCnpj.has(cnpj)) porCnpj.set(cnpj, { nome: String(r[4] || '').trim(), setores: {} });
  const e = porCnpj.get(cnpj);
  e.setores[setor] = (e.setores[setor] || 0) + 1;
}

// garante que todo setor da planilha existe na lista de setores
const setoresPlanilha = new Set();
for (const e of porCnpj.values()) Object.keys(e.setores).forEach((s) => setoresPlanilha.add(s));
for (const nome of setoresPlanilha) {
  const { error } = await supabase
    .from('sefaz_dfe_setores')
    .upsert({ nome, ativo: true }, { onConflict: 'nome', ignoreDuplicates: true });
  if (error) console.warn(`setor ${nome}: ${error.message}`);
}

// não sobrescreve escolha manual
const { data: manuais } = await supabase
  .from('sefaz_dfe_fornecedor_setor')
  .select('emitente_cnpj')
  .eq('origem', 'manual');
const protegidos = new Set((manuais || []).map((m) => m.emitente_cnpj));

const linhas = [];
let conflitos = 0;
for (const [cnpj, e] of porCnpj) {
  if (protegidos.has(cnpj)) continue;
  const ordenado = Object.entries(e.setores).sort((a, b) => b[1] - a[1]);
  if (ordenado.length > 1) conflitos++;
  linhas.push({
    emitente_cnpj: cnpj,
    setor: ordenado[0][0],
    origem: 'planilha',
    emitente_nome: e.nome || null,
    atualizado_em: new Date().toISOString(),
  });
}
if (linhas.length) {
  const { error } = await supabase
    .from('sefaz_dfe_fornecedor_setor')
    .upsert(linhas, { onConflict: 'emitente_cnpj' });
  if (error) throw error;
}

const preenchidas = await aplicarSetorConhecido(null);
console.log(
  JSON.stringify(
    {
      linhasPlanilha: rows.length,
      ignoradas,
      fornecedores: porCnpj.size,
      gravados: linhas.length,
      protegidosManual: protegidos.size,
      conflitosResolvidosPorMaioria: conflitos,
      setores: [...setoresPlanilha],
      notasPreenchidas: preenchidas,
    },
    null,
    2,
  ),
);
