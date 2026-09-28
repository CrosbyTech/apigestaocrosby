// ============================================================
// OFX (extrato Stone) → CNAB 240 FEBRABAN "Extrato para Conciliação Bancária"
//
// O TOTVS importa extrato bancário no layout FEBRABAN CNAB 240, lote de
// serviço 04 (Extrato p/ Conciliação), segmento E — o mesmo arquivo que o
// Sicredi entrega. A Stone só oferece OFX no app; este módulo converte.
//
// Referência de layout: arquivo real do Sicredi (versão arquivo 087 / lote
// 032) lido campo a campo em 25/09/2026. Posições abaixo são 1-based,
// inclusivas, como no manual FEBRABAN.
//
//   Header de arquivo (0) ─ banco, empresa, conta, geração, versão 087
//   Header de lote    (1) ─ operação E, serviço 04, forma 40, saldo inicial
//   Detalhe           (3) ─ segmento E: 1 lançamento por linha
//   Trailer de lote   (5) ─ saldo final, qtd registros, soma D e C
//   Trailer de arquivo(9) ─ qtd lotes / registros / contas
//
// Tudo ASCII maiúsculo, sem acento, 240 colunas, CRLF.
// ============================================================

// ─── util de texto/número ──────────────────────────────────────
export const semAcento = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ');

const A = (v, n) => semAcento(v).toUpperCase().slice(0, n).padEnd(n, ' '); // alfanumérico
const N = (v, n) => String(v ?? '').replace(/\D/g, '').slice(-n).padStart(n, '0'); // numérico
const V = (v, n = 18) => N(Math.round(Math.abs(Number(v) || 0) * 100), n); // valor 2 casas
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

// "20260925082353" ou "20260925082353[-3:BRT]" → { iso:'2026-09-25', ddmmaaaa:'25092026', hora:'082353' }
export function parseDataOfx(s) {
  const d = String(s || '').replace(/\[.*$/, '').trim();
  if (d.length < 8) return null;
  return {
    iso: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
    ddmmaaaa: `${d.slice(6, 8)}${d.slice(4, 6)}${d.slice(0, 4)}`,
    hora: d.length >= 14 ? d.slice(8, 14) : '000000',
  };
}
const isoParaDdmmaaaa = (iso) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;
const addDiasIso = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// Stone declara CHARSET:1252 mas grava UTF-8. Decodifica como UTF-8 e, se
// aparecer caractere inválido (U+FFFD), refaz como latin1.
export function decodificarOfx(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const utf8 = b.toString('utf8');
  return utf8.includes('�') ? b.toString('latin1') : utf8;
}

// ─── parser OFX (SGML 1.x e XML 2.x) ───────────────────────────
// Não usa lib: o OFX da Stone é SGML sem tags de fechamento em campos
// simples. Estratégia: regex por bloco <STMTTRN>…</STMTTRN> e por campo.
const campo = (bloco, tag) => {
  const m = bloco.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i'));
  return m ? m[1].trim() : null;
};

export function parseOfx(texto) {
  const t = String(texto || '');
  if (!/<OFX>/i.test(t)) throw new Error('Arquivo não parece ser OFX (sem tag <OFX>).');

  const bankAcct = (t.match(/<BANKACCTFROM>([\s\S]*?)<\/BANKACCTFROM>/i) || [])[1] || '';
  const tranList = (t.match(/<BANKTRANLIST>([\s\S]*?)<\/BANKTRANLIST>/i) || [])[1] || t;
  const ledger = (t.match(/<LEDGERBAL>([\s\S]*?)<\/LEDGERBAL>/i) || [])[1] || '';
  const fi = (t.match(/<FI>([\s\S]*?)<\/FI>/i) || [])[1] || '';

  const contaBruta = campo(bankAcct, 'ACCTID') || '';
  const [contaNum, contaDv] = contaBruta.includes('-')
    ? contaBruta.split('-').map((x) => soDigitos(x))
    : [soDigitos(contaBruta).slice(0, -1), soDigitos(contaBruta).slice(-1)];

  const lancamentos = [];
  const re = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  let m;
  while ((m = re.exec(tranList))) {
    const b = m[1];
    const valor = round2(Number(campo(b, 'TRNAMT')?.replace(',', '.')));
    if (!Number.isFinite(valor)) continue;
    const dt = parseDataOfx(campo(b, 'DTPOSTED'));
    lancamentos.push({
      fitid: campo(b, 'FITID'),
      tipoOfx: (campo(b, 'TRNTYPE') || '').toUpperCase(),
      data: dt?.iso || null,
      hora: dt?.hora || null,
      valor,
      natureza: valor < 0 ? 'D' : 'C',
      memo: campo(b, 'MEMO') || campo(b, 'NAME') || '',
      checknum: campo(b, 'CHECKNUM'),
    });
  }
  // OFX da Stone vem do mais recente para o mais antigo; CNAB é cronológico
  lancamentos.sort((a, b) => (a.data + a.hora < b.data + b.hora ? -1 : 1));

  const saldoFinal = ledger ? round2(Number(campo(ledger, 'BALAMT'))) : null;
  const dtSaldo = parseDataOfx(campo(ledger, 'DTASOF'));
  const dtStart = parseDataOfx(campo(tranList, 'DTSTART'));
  const dtEnd = parseDataOfx(campo(tranList, 'DTEND'));

  const totalCred = round2(lancamentos.filter((l) => l.valor > 0).reduce((s, l) => s + l.valor, 0));
  const totalDeb = round2(lancamentos.filter((l) => l.valor < 0).reduce((s, l) => s - l.valor, 0));
  const saldoInicial = saldoFinal != null ? round2(saldoFinal - totalCred + totalDeb) : null;

  const primeiroDia = lancamentos[0]?.data || dtStart?.iso || null;
  const ultimoDia = lancamentos.at(-1)?.data || null;

  return {
    banco: {
      codigo: N(campo(bankAcct, 'BANKID') || campo(fi, 'FID') || '', 3),
      nome: campo(fi, 'ORG') || null,
    },
    conta: {
      agencia: soDigitos(campo(bankAcct, 'BRANCHID') || ''),
      numero: contaNum,
      dv: contaDv,
      tipo: campo(bankAcct, 'ACCTTYPE') || null,
    },
    moeda: (t.match(/<CURDEF>([A-Z]{3})/i) || [])[1] || 'BRL',
    periodo: {
      inicio: dtStart?.iso || primeiroDia,
      // DTEND da Stone é o dia seguinte 00:00 → fim real é o dia anterior
      fim: dtEnd ? addDiasIso(dtEnd.iso, -1) : ultimoDia,
      primeiroLancamento: primeiroDia,
      ultimoLancamento: ultimoDia,
    },
    saldo: {
      final: saldoFinal,
      finalEm: dtSaldo ? addDiasIso(dtSaldo.iso, dtSaldo.hora === '000000' ? -1 : 0) : ultimoDia,
      inicial: saldoInicial,
      totalCreditos: totalCred,
      totalDebitos: totalDeb,
    },
    lancamentos,
  };
}

// ─── classificação do histórico (MEMO da Stone) ────────────────
// Categoria FEBRABAN (pos 170-172) e código de histórico (173-176) seguem
// os que o Sicredi usa, para o TOTVS tratar igual: 205 cartão, 209 PIX
// recebido, 120 PIX pago, 105 tarifa, 202 cobrança.
const BANDEIRA_ABREV = {
  MASTERCARD: 'MASTERCARD',
  MAESTRO: 'MAESTRO',
  VISA: 'VISA',
  'VISA ELECTRON': 'VISA ELECTRON',
  ELO: 'ELO',
  AMEX: 'AMEX',
  HIPERCARD: 'HIPERCARD',
  ANTECIPACAO: 'ANTECIPACAO',
};

export function classificarLancamento(l) {
  const memo = semAcento(l.memo).trim();
  const up = memo.toUpperCase();
  const deb = l.valor < 0;

  // "Recebimento vendas - Mastercard | Crédito"
  let m = up.match(/^RECEBIMENTO VENDAS\s*-\s*([A-Z ]+?)\s*(?:\|\s*(CREDITO|DEBITO))?$/);
  if (m) {
    const band = BANDEIRA_ABREV[m[1].trim()] || m[1].trim();
    const tipo = (m[2] || 'CREDITO') === 'CREDITO' ? 'CRED' : 'DEB';
    const antecip = band === 'ANTECIPACAO';
    return {
      grupo: antecip ? 'antecipacao' : 'cartao',
      categoria: '205',
      historico: antecip ? '0AN1' : tipo === 'CRED' ? '0CR1' : '0CD1',
      descricao: `VENDAS ${band} ${tipo}`,
      documento: `STONE ${band} ${tipo}`,
      contraparte: null,
      bandeira: band,
      tipoCartao: tipo === 'CRED' ? 'Crédito' : 'Débito',
    };
  }

  // Boleto Stone (cobrança emitida pela conta): "Depósito por boleto",
  // "NOME - Recebimento | Boleto" e a tarifa por boleto liquidado
  if (/^TARIFA DO BOLETO$/.test(up)) {
    return { grupo: 'tarifa', categoria: '105', historico: '0TB1', descricao: 'TARIFA BOLETO STONE', documento: 'TARIFA BOLETO', contraparte: null };
  }
  if (/^DEPOSITO POR BOLETO$/.test(up)) {
    return { grupo: 'boleto', categoria: '202', historico: '0BL1', descricao: 'DEPOSITO POR BOLETO', documento: 'BOLETO', contraparte: null };
  }
  m = up.match(/^(.*?)\s*-\s*RECEBIMENTO\s*\|\s*BOLETO$/);
  if (m) {
    return { grupo: 'boleto', categoria: '202', historico: '0BL2', descricao: 'LIQ BOLETO STONE', documento: `${'BOLETO'.padEnd(10)}${m[1].trim()}`, contraparte: m[1].trim() };
  }

  // "NOME - Transferência | Pix"  /  "NOME - Devolução | Pix"  /  "NOME - Pix | Maquininha"
  m = up.match(/^(.*?)\s*-\s*(TRANSFERENCIA|DEVOLUCAO)\s*\|\s*PIX$/);
  if (m) {
    const nome = m[1].trim();
    const devol = m[2] === 'DEVOLUCAO';
    return {
      grupo: 'pix',
      categoria: deb ? '120' : '209',
      historico: devol ? (deb ? '0DV2' : '0DV1') : deb ? '0DX1' : '0CX1',
      descricao: devol ? (deb ? 'DEVOLUCAO PIX ENVIADA' : 'DEVOLUCAO PIX RECEBIDA') : deb ? 'PAGAMENTO PIX' : 'RECEBIMENTO PIX',
      documento: `${(deb ? 'PIX_DEB' : 'PIX_CRED').padEnd(10)}${nome}`,
      contraparte: nome,
    };
  }
  m = up.match(/^(.*?)\s*-\s*PIX\s*\|\s*MAQUININHA$/);
  if (m) {
    return {
      grupo: 'pix',
      categoria: '209',
      historico: '0CX2',
      descricao: 'PIX MAQUININHA',
      documento: `${'PIX_POS'.padEnd(10)}${m[1].trim()}`,
      contraparte: m[1].trim(),
    };
  }

  // "NOME - Pagamento"  (boleto / conta paga pela Stone)
  m = up.match(/^(.*?)\s*-\s*PAGAMENTO$/);
  if (m) {
    return {
      grupo: 'pagamento',
      categoria: '112',
      historico: '0PG1',
      descricao: 'PAGAMENTO',
      documento: `${'PAGTO'.padEnd(10)}${m[1].trim()}`,
      contraparte: m[1].trim(),
    };
  }

  // "Mensalidade - Maquininha Stone", tarifas
  if (/MENSALIDADE|TARIFA|ALUGUEL/.test(up)) {
    return {
      grupo: 'tarifa',
      categoria: '105',
      historico: '0TF1',
      descricao: up.includes('MAQUININHA') ? 'TARIFA MAQUININHA STONE' : 'TARIFA',
      documento: memo,
      contraparte: null,
    };
  }

  // "NOME - Transferência | TED" e afins
  m = up.match(/^(.*?)\s*-\s*TRANSFERENCIA\s*\|\s*(TED|DOC)$/);
  if (m) {
    return {
      grupo: 'transferencia',
      categoria: deb ? '120' : '209',
      historico: deb ? '0TD1' : '0TC1',
      descricao: `${m[2]} ${deb ? 'ENVIADA' : 'RECEBIDA'}`,
      documento: `${m[2].padEnd(10)}${m[1].trim()}`,
      contraparte: m[1].trim(),
    };
  }

  // fallback: mantém o memo
  return {
    grupo: 'outros',
    categoria: deb ? '120' : '209',
    historico: deb ? '0OD1' : '0OC1',
    descricao: memo,
    documento: memo,
    contraparte: null,
  };
}

// ─── gerador CNAB 240 ──────────────────────────────────────────
/**
 * @param extrato  resultado de parseOfx()
 * @param opts     { cnpj, empresa, nomeBanco, agora?: Date, sequencia?: number,
 *                   bancoCodigo?, agencia?, conta?, contaDv? }  (conta vem do OFX)
 */
export function gerarCnab240(extrato, opts = {}) {
  const cnpj = soDigitos(opts.cnpj);
  if (cnpj.length !== 14) throw new Error('Informe o CNPJ (14 dígitos) da empresa titular da conta.');
  if (!opts.empresa) throw new Error('Informe o nome da empresa titular da conta.');

  const banco = N(opts.bancoCodigo || extrato.banco.codigo || '197', 3);
  const nomeBanco = opts.nomeBanco || 'STONE PAGAMENTOS';
  const agencia = N(opts.agencia ?? extrato.conta.agencia, 5);
  const conta = N(opts.conta ?? extrato.conta.numero, 12);
  const contaDv = A(opts.contaDv ?? extrato.conta.dv, 1);
  const agora = opts.agora || new Date();
  const dataGer = `${String(agora.getDate()).padStart(2, '0')}${String(agora.getMonth() + 1).padStart(2, '0')}${agora.getFullYear()}`;
  const horaGer = `${String(agora.getHours()).padStart(2, '0')}${String(agora.getMinutes()).padStart(2, '0')}${String(agora.getSeconds()).padStart(2, '0')}`;
  const seq = N(opts.sequencia ?? Number(`${agora.getFullYear() % 100}${String(agora.getMonth() + 1).padStart(2, '0')}${String(agora.getDate()).padStart(2, '0')}`) % 1000000, 6);
  const lote = '0001';

  // bloco comum "empresa/conta" (pos 18-102) usado em header, lote e detalhe
  const blocoConta =
    '2' + // 18 tipo inscrição (2 = CNPJ)
    N(cnpj, 14) + // 19-32
    A('', 20) + // 33-52 convênio
    agencia + // 53-57
    A('', 1) + // 58 dv agência
    conta + // 59-70
    contaDv + // 71
    A('', 1) + // 72 dv ag/conta
    A(opts.empresa, 30); // 73-102

  const linhas = [];

  // ── Header de arquivo
  linhas.push(
    banco + '0000' + '0' + A('', 9) + blocoConta +
      A(nomeBanco, 30) + // 103-132
      A('', 10) + // 133-142
      '2' + // 143 código remessa/retorno (2 = retorno)
      dataGer + horaGer + seq + // 144-163
      '087' + // 164-166 versão layout arquivo
      A('', 5) + // 167-171 densidade
      A('', 20) + A('', 20) + A('', 29), // 172-240
  );

  // ── Header de lote
  const saldoIni = extrato.saldo.inicial ?? 0;
  const dataSaldoIni = isoParaDdmmaaaa(addDiasIso(extrato.periodo.inicio, -1));
  linhas.push(
    banco + lote + '1' + 'E' + '04' + '40' + '032' + A('', 1) + blocoConta +
      A('', 40) + // 103-142
      dataSaldoIni + // 143-150
      V(saldoIni) + // 151-168
      (saldoIni < 0 ? 'D' : 'C') + // 169 situação
      'P' + // 170 status (P = parcial, como o Sicredi)
      A(extrato.moeda || 'BRL', 3) + // 171-173
      N(seq.slice(-5), 5) + // 174-178 sequência do extrato
      A('', 62), // 179-240
  );

  // ── Detalhes (segmento E)
  let somaD = 0;
  let somaC = 0;
  const detalhes = extrato.lancamentos.map((l, i) => {
    const c = classificarLancamento(l);
    if (l.valor < 0) somaD += -l.valor;
    else somaC += l.valor;
    const dataL = isoParaDdmmaaaa(l.data);
    l._classificacao = c;
    return (
      banco + lote + '3' + N(i + 1, 5) + 'E' + A('', 3) + blocoConta +
      A('', 6) + // 103-108
      'DPV' + // 109-111 natureza (depósito à vista)
      '01' + // 112-113 tipo complemento
      A(conta.replace(/^0+/, ''), 20) + // 114-133 complemento (conta)
      'N' + // 134 isento CPMF
      dataL + dataL + // 135-142 contábil, 143-150 lançamento
      V(l.valor) + // 151-168
      l.natureza + // 169 D/C
      N(c.categoria, 3) + // 170-172 categoria
      A(c.historico, 4) + // 173-176 código histórico (do banco)
      A(c.descricao, 25) + // 177-201 descrição histórico
      A(c.documento, 39) // 202-240 número do documento
    );
  });
  linhas.push(...detalhes);

  // ── Trailer de lote
  const saldoFim = extrato.saldo.final ?? round2(saldoIni + somaC - somaD);
  const dataSaldoFim = isoParaDdmmaaaa(extrato.saldo.finalEm || extrato.periodo.fim);
  const qtdRegLote = detalhes.length + 2;
  linhas.push(
    banco + lote + '5' + A('', 9) +
      blocoConta.slice(0, 55) + // 18-72 inscrição/convênio/agência/conta (sem nome)
      A('', 16) + // 73-88 CNAB
      V(0) + V(0) + V(0) + // 89-142 bloqueado >24h, limite, bloqueado ≤24h
      dataSaldoFim + // 143-150
      V(saldoFim) + // 151-168
      (saldoFim < 0 ? 'D' : 'C') + 'P' + // 169-170
      N(qtdRegLote, 6) + // 171-176
      V(somaD) + V(somaC) + // 177-212
      A('', 28), // 213-240
  );

  // ── Trailer de arquivo
  linhas.push(banco + '9999' + '9' + A('', 9) + N(1, 6) + N(linhas.length + 1, 6) + N(1, 6) + A('', 205));

  // segurança: todas com 240 colunas
  const ruins = linhas.map((ln, i) => [i + 1, ln.length]).filter(([, n]) => n !== 240);
  if (ruins.length) throw new Error(`Linhas fora de 240 colunas: ${JSON.stringify(ruins.slice(0, 5))}`);

  return {
    conteudo: linhas.join('\r\n') + '\r\n',
    linhas,
    resumo: {
      banco,
      agencia,
      conta: `${conta.replace(/^0+/, '')}-${contaDv.trim()}`,
      cnpj,
      empresa: opts.empresa,
      periodo: extrato.periodo,
      saldoInicial: round2(saldoIni),
      saldoFinal: round2(saldoFim),
      totalCreditos: round2(somaC),
      totalDebitos: round2(somaD),
      qtdLancamentos: detalhes.length,
      qtdRegistros: linhas.length,
      sequencia: seq,
    },
  };
}

export default { parseOfx, gerarCnab240, classificarLancamento, decodificarOfx };
