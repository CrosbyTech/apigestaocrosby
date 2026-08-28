// Importa o CSV de manifestações (export FISFP153/TOTVS) para sefaz_dfe_notas.
// Uso: node scripts/import-manifestacoes-csv.mjs "C:\caminho\MANIFESTACOES2026.CSV"
import fs from 'node:fs';
import supabase from '../config/supabase.js';
import { filialPorCodigo } from '../config/sefazFiliais.js';

const ARQUIVO = process.argv[2] || 'C:/Users/yagom/Desktop/MANIFESTACOES2026.CSV';

// Cód. empresa TOTVS → CNPJ da filial (de /api/totvs/branches)
const EMPRESA_CNPJ = {
  1: '17177680000116', 2: '17177680000205', 5: '33592092000103',
  11: '27728810000115', 55: '53661116000138', 65: '27728810000620',
  87: '27728810000972', 88: '27728810001006', 89: '27728810001197',
  90: '17177680001430', 91: '17177680001350', 92: '27728810000387',
  93: '17177680001279', 94: '17177680001198', 95: '27728810000549',
  96: '17177680000892', 97: '17177680000973', 98: '36569459000158',
  99: '17177680001007',
};

const MANIF_LABEL = {
  210200: 'Confirmação da Operação',
  210210: 'Ciência da Operação',
  210220: 'Desconhecimento da Operação',
  210240: 'Operação não Realizada',
};

const raw = fs.readFileSync(ARQUIVO, 'latin1');
const lines = raw.split(/\r?\n/).filter((l) => l.trim());

const registros = new Map(); // chave: cnpjDest|chave → registro
const stats = { total: 0, ok: 0, corrigidas: 0, puladas: 0, semEmpresa: {} };

for (let i = 1; i < lines.length; i++) {
  stats.total++;
  let c = lines[i].split(';');

  // Linhas com ';' extra dentro da razão social: funde as colunas excedentes
  if (c.length > 12) {
    const extra = c.length - 12;
    c = [
      ...c.slice(0, 4),
      c.slice(4, 5 + extra).join(';'),
      ...c.slice(5 + extra),
    ];
    stats.corrigidas++;
  }

  const [empresa, dtEmissao, chave, cnpjEmi, razao, nrNf, serie, nsu, op, sit, manif, valor] = c;

  const codEmpresa = parseInt(empresa);
  // O destinatario e a propria filial — e assim que a SEFAZ organiza a DFe,
  // e e o que permite bater o historico do TOTVS com o que vem da SEFAZ.
  const filial = filialPorCodigo(codEmpresa);
  const destinatario = filial?.cnpj || EMPRESA_CNPJ[codEmpresa] || null;

  if (!destinatario || !/^\d{44}$/.test(chave || '') || !['S', 'E'].includes(op)) {
    stats.puladas++;
    if (!destinatario && empresa)
      stats.semEmpresa[empresa] = (stats.semEmpresa[empresa] || 0) + 1;
    continue;
  }

  const [dd, mm, yyyy] = (dtEmissao || '').split('/');
  const dataIso =
    yyyy && mm && dd ? `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}` : null;
  const valorNum = parseFloat(
    String(valor || '0').replace(/\./g, '').replace(',', '.'),
  );

  const reg = {
    cnpj_destinatario: destinatario,
    empresa_codigo: codEmpresa,
    empresa_nome: filial?.nome || null,
    chave_acesso: chave,
    nsu: parseInt(nsu) || null,
    emitente_cnpj: (cnpjEmi || '').replace(/\D/g, '') || null,
    emitente_nome: (razao || '').trim() || null,
    data_emissao: dataIso,
    tipo_operacao: op === 'E' ? '0' : '1',
    valor_total: isNaN(valorNum) ? null : valorNum,
    situacao: sit === 'C' ? '2' : sit === 'D' ? '3' : '1',
    manifestacao: /^\d{6}$/.test(manif || '') ? manif : null,
    manifestacao_descricao: MANIF_LABEL[manif] || null,
    schema_origem: 'csv-fisfp153',
    atualizado_em: new Date().toISOString(),
  };

  const key = `${reg.cnpj_destinatario}|${reg.chave_acesso}`;
  const existente = registros.get(key);
  // Duplicata: prefere a linha que tem manifestação
  if (!existente || (reg.manifestacao && !existente.manifestacao)) {
    registros.set(key, reg);
  }
  stats.ok++;
}

const todos = [...registros.values()];
const comManif = todos.filter((r) => r.manifestacao);
// Sem manifestação: omite as colunas de manifestação para não sobrescrever
// valores que o sync da SEFAZ já tenha aplicado
const semManif = todos
  .filter((r) => !r.manifestacao)
  .map(({ manifestacao, manifestacao_descricao, ...resto }) => resto);

console.log(
  `Linhas: ${stats.total} | válidas: ${stats.ok} | corrigidas (; extra): ${stats.corrigidas} | puladas: ${stats.puladas}`,
);
if (Object.keys(stats.semEmpresa).length)
  console.log('Empresas sem mapeamento:', stats.semEmpresa);
console.log(
  `Únicas por chave: ${todos.length} (${comManif.length} com manifestação, ${semManif.length} sem)`,
);

const LOTE = 500;
let gravadas = 0;
for (const grupo of [comManif, semManif]) {
  for (let i = 0; i < grupo.length; i += LOTE) {
    const lote = grupo.slice(i, i + LOTE);
    const { error } = await supabase
      .from('sefaz_dfe_notas')
      .upsert(lote, { onConflict: 'cnpj_destinatario,chave_acesso' });
    if (error) {
      console.error(`ERRO no lote ${i}: ${error.message}`);
      process.exit(1);
    }
    gravadas += lote.length;
  }
}

console.log(`✅ ${gravadas} notas gravadas/atualizadas no Supabase`);

const porEmpresa = {};
for (const r of todos)
  porEmpresa[r.cnpj_destinatario] = (porEmpresa[r.cnpj_destinatario] || 0) + 1;
console.log('Por empresa:', JSON.stringify(porEmpresa, null, 1));
process.exit(0);
