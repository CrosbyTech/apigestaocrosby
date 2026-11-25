// Regras puras (sem banco) da BAIXA AUTOMÁTICA da Liberação de Pagamento do
// HeadCoach: casar as liberações INCLUÍDAS NO BANCO com as saídas dos extratos
// (hoje e até 30 dias para trás — eram 7; o Yago pediu 30 em 25/11/2026). Pedido do Yago em 24/11/2026.
//
// Uma saída do extrato paga uma liberação quando:
//   • o valor é o mesmo (centavo a centavo) e
//   • é para o mesmo fornecedor — CPF/CNPJ igual, ou o nome batendo (a mesma
//     pontuação da conciliação dos aprovados, com os apelidos de concessionária).
// A baixa não tem estorno, então na dúvida NÃO casa: mais saídas possíveis do
// que liberações (em contas ou dias diferentes) fica para conferir à mão.
// Também casa UMA saída = SOMA exata de duas ou mais liberações do mesmo fornecedor.

export const DIAS_ATRAS = 30;
export const NOME_MIN = 0.6; // fração do nome do fornecedor que precisa aparecer na saída
const MAX_SOMA = 16; // liberações do mesmo fornecedor testadas na soma

const dig = (v) => String(v ?? '').replace(/\D+/g, '');
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const abs2 = (v) => round2(Math.abs(Number(v) || 0));
const centavos = (v) => Math.round(Math.abs(Number(v) || 0) * 100); // a comparação de valor é centavo a centavo, sem tolerância

export function addDias(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Extratos conferidos: de (hoje − 7) até hoje. */
export const janelaDosExtratos = (hoje, dias = DIAS_ATRAS) => ({ de: addDias(hoje, -dias), ate: hoje });

/** O banco como a Liberação escreve: "STONE 0549" (final do CNPJ da conta), "PAGARME", "MENTORE"; os outros pelo apelido da conta. */
export function bancoDaConta(conta) {
  if (!conta) return null;
  const banco = String(conta.banco || '').toUpperCase();
  const cnpj = dig(conta.titular_cnpj);
  if (banco === 'STONE') return cnpj.length >= 4 ? `STONE ${cnpj.slice(-4)}` : 'STONE';
  if (banco === 'PAGARME' || banco === 'MENTORE') return banco;
  return (
    String(conta.apelido || banco)
      .toUpperCase()
      .slice(0, 120) || null
  );
}

/** "Transferência | Pix", "Pagamento Pix"…: o tipo da operação no lugar do nome (o leitor do extrato às vezes troca os dois). */
const NOME_GENERICO = /^(transfer[eê]ncia|pix|pagamento|ted|doc)\b/i;

/** Para quem foi a saída, como aparece no extrato (o memo, quando o nome guardado é só o tipo da operação). */
export function contraparteDaSaida(l) {
  const nome = String(l?.contraparte_nome || '').trim();
  const memo = String(l?.memo || '').trim();
  if (nome && !NOME_GENERICO.test(nome)) return nome;
  return memo || nome || String(l?.descricao || '').trim();
}

/** Quanto a saída "é" do fornecedor da duplicata: 2 = CPF/CNPJ igual; senão a pontuação do nome (0 a 1). */
export function pontosDaSaida(titulo, l, pontuar) {
  const doc = dig(titulo?.fornecedor_cpf_cnpj);
  if (doc.length >= 11 && dig(l?.contraparte_doc) === doc) return 2;
  // o nome é procurado no nome guardado E no memo: vale o que bater melhor
  const nome = titulo?.fornecedor_nome || '';
  return Math.max(...[l?.contraparte_nome, l?.memo].filter((t) => String(t || '').trim()).map((t) => Number(pontuar(nome, t)) || 0), 0);
}

const porVencimento = (a, b) => String(a.titulo?.vencimento || '').localeCompare(String(b.titulo?.vencimento || '')) || a.id - b.id;
const porData = (a, b) => String(a.data).localeCompare(String(b.data)) || (a.seq ?? 0) - (b.seq ?? 0) || a.id - b.id;
const mesmoLugar = (saidas) => saidas.every((l) => l.conta_id === saidas[0].conta_id && l.data === saidas[0].data);

/**
 * Casa as liberações incluídas com as saídas dos extratos.
 * @param liberacoes [{ id, valor, titulo: { fornecedor_code, fornecedor_nome, fornecedor_cpf_cnpj, vencimento } }]
 * @param saidas     [{ id, conta_id, data, valor (negativo), contraparte_nome, contraparte_doc, memo }] — já sem as transferências entre contas
 * @param opcoes     { pontuar(nomeFornecedor, textoDoExtrato) → 0..1, usadas: Set de ids de saídas que já pagaram outra coisa }
 * @returns {{ casadas: [{ tipo: 'individual'|'soma', liberacoes: [id], saida, pontos }], semSaida: [{ id, motivo }] }}
 */
export function casarIncluidos(liberacoes, saidas, { pontuar, usadas = new Set() } = {}) {
  if (typeof pontuar !== 'function') throw new Error('casarIncluidos precisa da função que pontua o nome');
  const libs = [...(liberacoes || [])].filter((l) => l?.titulo && centavos(l.valor) > 0).sort(porVencimento);
  const livres = (saidas || []).filter((l) => Number(l.valor) < 0 && !usadas.has(l.id)).sort(porData);
  const tomadas = new Set();
  const casadas = [];
  const motivo = new Map(); // liberação → por que não casou
  const feitas = new Set();
  const doFornecedor = (titulo, l) => pontosDaSaida(titulo, l, pontuar);

  // ── 1) uma saída = uma liberação (as de mesmo fornecedor e mesmo valor são tratadas juntas) ──
  const grupos = new Map();
  for (const l of libs) {
    const k = `${l.titulo.fornecedor_code}|${abs2(l.valor).toFixed(2)}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(l);
  }
  for (const grupo of grupos.values()) {
    const V = centavos(grupo[0].valor);
    const doValor = livres.filter((l) => !tomadas.has(l.id) && centavos(l.valor) === V);
    const cand = doValor.map((l) => ({ l, pontos: doFornecedor(grupo[0].titulo, l) })).filter((x) => x.pontos >= NOME_MIN);
    if (!cand.length) {
      // sem saída do fornecedor nesse valor: guarda a pista para o usuário (outra pessoa recebeu o mesmo valor?)
      const outra = doValor[0];
      for (const lib of grupo) motivo.set(lib.id, outra ? `há saída de mesmo valor em ${outra.data}, mas para "${contraparteDaSaida(outra).slice(0, 60)}"` : null);
      continue;
    }
    // mais saídas do que liberações, em contas ou dias diferentes: não dá para saber qual é a desta duplicata
    if (cand.length > grupo.length && !mesmoLugar(cand.map((x) => x.l))) {
      for (const lib of grupo) motivo.set(lib.id, `${cand.length} saídas possíveis nos extratos (${cand.map((x) => x.l.data).join(', ')}): confira e pague à mão`);
      continue;
    }
    // menos saídas do que duplicatas iguais: as mais antigas levam; as outras ficam com o motivo certo
    if (cand.length < grupo.length) for (const lib of grupo.slice(cand.length)) motivo.set(lib.id, `só ${cand.length === 1 ? 'há 1 saída' : `há ${cand.length} saídas`} deste valor nos extratos para ${grupo.length} duplicatas iguais deste fornecedor`);
    cand.slice(0, grupo.length).forEach((x, i) => {
      const lib = grupo[i];
      tomadas.add(x.l.id);
      feitas.add(lib.id);
      casadas.push({ tipo: 'individual', liberacoes: [lib.id], saida: x.l, pontos: x.pontos });
    });
  }

  // ── 2) uma saída = soma exata de 2+ liberações do mesmo fornecedor ──
  const porFornecedor = new Map();
  for (const l of libs) {
    if (feitas.has(l.id)) continue;
    const k = String(l.titulo.fornecedor_code);
    if (!porFornecedor.has(k)) porFornecedor.set(k, []);
    porFornecedor.get(k).push(l);
  }
  for (const todas of porFornecedor.values()) {
    if (todas.length < 2 || todas.length > MAX_SOMA) continue;
    const cand = livres.filter((l) => !tomadas.has(l.id) && doFornecedor(todas[0].titulo, l) >= NOME_MIN);
    for (const l of cand) {
      const resto = todas.filter((x) => !feitas.has(x.id));
      if (resto.length < 2) break;
      const alvo = centavos(l.valor);
      const vals = resto.map((x) => centavos(x.valor));
      const achados = new Map(); // combinação de valores → primeira máscara
      for (let mask = 1; mask < 1 << resto.length; mask += 1) {
        let soma = 0;
        let n = 0;
        const usados = [];
        for (let i = 0; i < resto.length; i += 1)
          if (mask & (1 << i)) {
            soma += vals[i];
            n += 1;
            usados.push(vals[i]);
          }
        if (n >= 2 && soma === alvo) {
          const k = usados.sort((a, b) => a - b).join('+');
          if (!achados.has(k)) achados.set(k, mask);
        }
      }
      if (achados.size !== 1) continue; // nenhuma combinação, ou mais de uma diferente: não dá para saber
      const mask = [...achados.values()][0];
      const sel = resto.filter((_, i) => mask & (1 << i));
      tomadas.add(l.id);
      for (const x of sel) feitas.add(x.id);
      casadas.push({ tipo: 'soma', liberacoes: sel.map((x) => x.id), saida: l, pontos: doFornecedor(todas[0].titulo, l) });
    }
  }

  const semSaida = libs.filter((l) => !feitas.has(l.id)).map((l) => ({ id: l.id, motivo: motivo.get(l.id) || 'nenhuma saída deste valor para o fornecedor nos extratos do período' }));
  return { casadas, semSaida };
}
