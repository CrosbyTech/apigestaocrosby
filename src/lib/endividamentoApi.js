import { supabase } from './supabase';

const BUCKET_NAME = 'contratos-endividamento';

const centsToDecimal = (c) => (c ? Number(c) / 100 : null);
const decimalToCentsStr = (d) => (d === null || d === undefined ? '' : String(Math.round(Number(d) * 100)));
const digitsToInt = (v) => {
  const d = (v || '').replace(/\D/g, '');
  return d ? Number(d) : null;
};

function mapFormToDb(form, userId, anexoPath) {
  return {
    user_id: userId,
    instituicao: form.instituicao || null,
    razao_social_tomador: form.razaoSocialTomador || null,
    cnpj_tomador: form.cnpjTomador || null,
    ag: form.ag || null,
    cc: form.cc || null,
    linha_credito: form.linhaCredito || null,
    numero_contrato: form.numeroContrato || null,
    data_contratacao: form.dataContratacao || null,
    vencimento_final: form.vencimentoFinal || null,
    limite_aprovado: centsToDecimal(form.limiteAprovado),
    saldo_devedor_sem_juros: centsToDecimal(form.saldoDevedorSemJuros),
    saldo_devedor_com_juros: centsToDecimal(form.saldoDevedorComJuros),
    valor_mensal_pmt: centsToDecimal(form.valorMensalPMT),
    quantidade_pmt: digitsToInt(form.quantidadePMT),
    pmt_pagas: digitsToInt(form.pmtPagas),
    diferenca_pmt_vencer: centsToDecimal(form.diferencaPMTVencer),
    data_inicial_pagamento: form.dataInicialPagamento || null,
    taxa_juros_mes: form.taxaJurosMes ? Number(form.taxaJurosMes) : null,
    avalista: form.avalista || null,
    garantias: form.garantias || null,
    anexo_path: anexoPath || null,
  };
}

function mapDbToUi(row) {
  return {
    id: row.id,
    instituicao: row.instituicao || '',
    razaoSocialTomador: row.razao_social_tomador || '',
    cnpjTomador: row.cnpj_tomador || '',
    ag: row.ag || '',
    cc: row.cc || '',
    linhaCredito: row.linha_credito || '',
    numeroContrato: row.numero_contrato || '',
    dataContratacao: row.data_contratacao || '',
    vencimentoFinal: row.vencimento_final || '',
    limiteAprovado: decimalToCentsStr(row.limite_aprovado),
    saldoDevedorSemJuros: decimalToCentsStr(row.saldo_devedor_sem_juros),
    saldoDevedorComJuros: decimalToCentsStr(row.saldo_devedor_com_juros),
    valorMensalPMT: decimalToCentsStr(row.valor_mensal_pmt),
    quantidadePMT: row.quantidade_pmt != null ? String(row.quantidade_pmt) : '',
    pmtPagas: row.pmt_pagas != null ? String(row.pmt_pagas) : '',
    diferencaPMTVencer: decimalToCentsStr(row.diferenca_pmt_vencer),
    dataInicialPagamento: row.data_inicial_pagamento || '',
    taxaJurosMes: row.taxa_juros_mes != null ? String(row.taxa_juros_mes) : '',
    avalista: row.avalista || '',
    garantias: row.garantias || '',
    anexoContrato: row.anexo_path ? { name: row.anexo_path.split('/').pop() } : null,
  };
}

export async function uploadAnexoContrato(file) {
  if (!file) return null;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Usuário não autenticado');
  const uid = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
  const path = `${user.id}/${uid}_${file.name}`;
  const { error } = await supabase
    .storage
    .from(BUCKET_NAME)
    .upload(path, file, { upsert: false });
  if (error) {
    if (String(error.message || '').toLowerCase().includes('bucket') && String(error.message || '').toLowerCase().includes('not') && String(error.message || '').toLowerCase().includes('found')) {
      throw new Error(`Bucket "${BUCKET_NAME}" não encontrado. Crie o bucket no Storage do Supabase (privado) ou altere o nome no código.`);
    }
    throw error;
  }
  return path;
}

export async function createEndividamento(form, file) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Usuário não autenticado');
  const anexoPath = file ? await uploadAnexoContrato(file) : null;
  const payload = mapFormToDb(form, user.id, anexoPath);
  const { data, error } = await supabase
    .from('endividamentos')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return mapDbToUi(data);
}

export async function updateEndividamento(id, form, file) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Usuário não autenticado');
  const anexoPath = file ? await uploadAnexoContrato(file) : undefined;
  const payload = mapFormToDb(form, user.id, anexoPath);
  if (anexoPath === undefined) delete payload.anexo_path;
  const { data, error } = await supabase
    .from('endividamentos')
    .update(payload)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single();
  if (error) throw error;
  return mapDbToUi(data);
}

export async function deleteEndividamento(id) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Usuário não autenticado');

  // Busca o registro para obter o caminho do anexo
  const { data: row, error: fetchErr } = await supabase
    .from('endividamentos')
    .select('id, user_id, anexo_path')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();
  if (fetchErr) throw fetchErr;

  // Remove arquivo do Storage, se existir
  if (row?.anexo_path) {
    const { error: storageErr } = await supabase
      .storage
      .from(BUCKET_NAME)
      .remove([row.anexo_path]);
    if (storageErr) {
      // Não bloqueia exclusão do registro se falhar o storage, mas loga o erro
      console.warn('Falha ao remover anexo do bucket:', storageErr.message || storageErr);
    }
  }

  // Exclui o registro
  const { error } = await supabase
    .from('endividamentos')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) throw error;
  return true;
}

export async function listEndividamentos() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Usuário não autenticado');
  const { data, error } = await supabase
    .from('endividamentos')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapDbToUi);
}

export async function deleteAllEndividamentos() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Usuário não autenticado');
  // Remove todos os registros do usuário atual
  const { error } = await supabase
    .from('endividamentos')
    .delete()
    .eq('user_id', user.id);
  if (error) throw error;
  return true;
}

// -------- Importação de Excel (frontend) --------
function excelDate(v) {
  if (typeof v === 'number') {
    const epoch = new Date(Math.round((v - 25569) * 86400 * 1000));
    return epoch.toISOString().slice(0, 10);
  }
  const parts = String(v).trim().replace(/\./g, '/').replace(/-/g, '/').split('/');
  if (parts.length === 3) {
    const [p1, p2, p3] = parts.map((x) => x.padStart(2, '0'));
    const yyyy = p3.length === 4 ? p3 : (p1.length === 4 ? p1 : p3);
    const mm = p2.length === 2 ? p2 : '01';
    const dd = p1.length === 2 ? p1 : '01';
    return `${yyyy}-${mm}-${dd}`;
  }
  const d = new Date(v);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function normalizeKey(k) {
  return String(k || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function mapExcelRowToDb(row, userId) {
  // cria um dicionário com chaves normalizadas
  const dict = {};
  Object.keys(row || {}).forEach((k) => {
    dict[normalizeKey(k)] = row[k];
  });
  const get = (...keys) => {
    for (const k of keys) {
      const nk = normalizeKey(k);
      if (dict[nk] !== undefined && dict[nk] !== null && dict[nk] !== '') return dict[nk];
    }
    return null;
  };

  const money = (val) => {
    if (val === undefined || val === null || val === '') return null;
    if (typeof val === 'number') return val; // já é número decimal
    const s = String(val).trim();
    // remove R$ e espaços
    let t = s.replace(/R\$\s?/gi, '');
    // se tem vírgula, assume formato BR: milhar com ponto e decimal com vírgula
    if (t.includes(',')) {
      t = t.replace(/\./g, '').replace(',', '.');
    }
    const num = Number(t);
    if (Number.isNaN(num)) return null;
    return num;
  };
  const toInt = (val) => {
    if (val === undefined || val === null || val === '') return null;
    if (typeof val === 'number') return Math.trunc(val);
    const n = Number(String(val).replace(/\D/g, ''));
    return Number.isNaN(n) ? null : n;
  };

  const instituicao = get('instituição', 'instituicao');
  const razao = get('razão social - tomador', 'razão social  - tomador', 'razao social - tomador');
  const numeroContrato = get('número do contrato', 'numero do contrato');

  return {
    user_id: userId,
    instituicao: instituicao || null,
    razao_social_tomador: razao || null,
    cnpj_tomador: get('cnpj tomador') || null,
    ag: get('ag') || null,
    cc: get('cc') || null,
    linha_credito: get('linha de crédito', 'linha de credito') || null,
    numero_contrato: numeroContrato || null,
    data_contratacao: get('data da contratação') ? excelDate(get('data da contratação')) : null,
    vencimento_final: get('vencimento final da operação') ? excelDate(get('vencimento final da operação')) : null,
    limite_aprovado: money(get('limites aprovados/ valor do contrato')),
    saldo_devedor_sem_juros: money(get('saldo devedor nominal s/ juros')),
    saldo_devedor_com_juros: money(get('saldo devedor total c/ juros')),
    valor_mensal_pmt: money(get('valor mensal pmt')),
    quantidade_pmt: toInt(get('quantidade pmt')),
    pmt_pagas: toInt(get('quantas já pagamos pmt paga')),
    diferenca_pmt_vencer: money(get('diferença pmt a vencer')),
    data_inicial_pagamento: get('data inicial de pagamento') ? excelDate(get('data inicial de pagamento')) : null,
    taxa_juros_mes: get('taxa juros % a.m') != null ? Number(String(get('taxa juros % a.m')).replace(',', '.')) : null,
    avalista: get('avalista') || null,
    garantias: get('garantias') || null,
    anexo_path: null
  };
}

export async function importEndividamentosFromExcel(file) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Usuário não autenticado');

  const xlsx = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const wb = xlsx.read(buffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(ws, { defval: null });

  // mapeia e valida obrigatórios
  const payloadAll = rows.map((r) => mapExcelRowToDb(r, user.id));
  const payload = payloadAll.filter((p) => p.instituicao && p.razao_social_tomador);

  const chunkSize = 300;
  let inserted = 0;
  for (let i = 0; i < payload.length; i += chunkSize) {
    const chunk = payload.slice(i, i + chunkSize);
    const { error, count } = await supabase
      .from('endividamentos')
      .insert(chunk, { count: 'exact' });
    if (error) throw error;
    inserted += count || chunk.length;
  }
  return inserted;
}
