// Cruza as notas PENDENTES de escrituração (Manifestação do Destinatário)
// com os chamados ABERTOS do Dryland, para não abrir chamado em dobro.
// Pedido da Niziany (27/10/2026): cruzar por fornecedor, número da nota e valor.
//
// Fonte dos chamados: RPC chamado_listar (só assunto) + chamado_get (texto)
// para os candidatos — os automáticos do fluxo de Solicitação de Pagamento
// têm assunto "NOTA FISCAL (fornecedor) pendente de escrituração" e texto com
// "Fornecedor: NOME (CNPJ)", "Valor: R$ x" e "Solicitação HeadCoach: #uuid".
import supabase from '../config/supabase.js';
import { drylandRpc } from '../routes/drylandChamados.routes.js';

const digits = (v) => String(v || '').replace(/\D/g, '');
const semAcento = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase();
const TOKENS_IGNORAR = new Set([
  'LTDA', 'ME', 'EPP', 'EIRELI', 'SA', 'S/A', 'S.A', 'CIA', 'COMERCIO', 'COMERCIAL',
  'INDUSTRIA', 'INDUSTRIAL', 'DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'EM', 'PARA', 'COM',
  'SERVICOS', 'SERVICO', 'LTDA.', 'EMPRESA', 'FILIAL', 'MATRIZ',
]);
const tokensNome = (nome) =>
  semAcento(nome)
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !TOKENS_IGNORAR.has(t));

const STATUS_FECHADOS = new Set(['concluido', 'cancelado']);
const RE_ASSUNTO_NF = /nota\s*fiscal|escritura|\bnf\b|nf-?e\b|danfe|\bnfe\b/i;

const nfDaChave = (chave) =>
  chave && String(chave).length === 44 ? String(parseInt(String(chave).slice(25, 34), 10)) : null;

// Extrai do texto do chamado o que serve para casar com a nota
function extrair(ch) {
  const texto = `${ch.assunto || ''}\n${ch.texto || ''}`;
  const cnpjs = [...texto.matchAll(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\b\d{14}\b/g)].map((m) => digits(m[0]));
  const valores = [...texto.matchAll(/R\$\s*([\d.]+,\d{2})/g)].map((m) =>
    parseFloat(m[1].replace(/\./g, '').replace(',', '.')),
  );
  // "NF 1234", "NF-e nº 1234", "nota fiscal 1234", "NFE: 1234"
  const nfs = [...texto.matchAll(/(?:nota\s*fiscal|nf-?e?|nfe)\s*(?:n[º°.o]?\s*)?[:#]?\s*(\d{1,9})\b/gi)].map((m) =>
    String(parseInt(m[1], 10)),
  );
  const sol = (texto.match(/Solicitação HeadCoach:\s*#([0-9a-f-]{36})/i) || [])[1] || null;
  const nomeAssunto = (String(ch.assunto || '').match(/NOTA FISCAL \(([^)]+)\)/i) || [])[1] || '';
  return {
    cnpjs: [...new Set(cnpjs)],
    valores: [...new Set(valores)],
    nfs: [...new Set(nfs)],
    sol,
    nomeAssunto,
    textoNorm: semAcento(texto),
  };
}

let cache = { em: 0, itens: [] };
const CACHE_MS = 5 * 60 * 1000;

// Chamados abertos que falam de nota fiscal, já com o texto e os campos extraídos
export async function chamadosAbertosDeNota({ forcar = false } = {}) {
  if (!forcar && Date.now() - cache.em < CACHE_MS && cache.itens.length) return cache.itens;
  const lista = await drylandRpc('chamado_listar', {});
  // Abertos + concluídos recentes (45 dias), para a Niziany acompanhar o
  // retorno pela própria tela de Pendentes; cancelados ficam fora.
  const limite = Date.now() - 45 * 86400000;
  const abertos = (Array.isArray(lista) ? lista : []).filter((c) => {
    if (!RE_ASSUNTO_NF.test(c.assunto || '')) return false;
    const st = String(c.status);
    if (st === 'cancelado') return false;
    if (st === 'concluido') return new Date(c.criado_em || 0).getTime() >= limite;
    return true;
  });
  const itens = [];
  for (const c of abertos) {
    let texto = '';
    try {
      const det = await drylandRpc('chamado_get', { p_id: c.id });
      const ch = (Array.isArray(det) ? det[0] : det)?.chamado || {};
      texto = ch.texto || '';
    } catch (e) {
      console.warn(`⚠️ [SefazChamados] chamado_get ${c.id}: ${e.message}`);
    }
    const base = { ...c, texto };
    itens.push({
      id: c.id,
      numero: c.numero,
      setor: c.setor,
      status: c.status,
      assunto: c.assunto,
      loja_cd: c.loja_cd,
      loja_nome: c.loja_nome,
      criado_em: c.criado_em,
      responsavel_nome: c.responsavel_nome || null,
      ...extrair(base),
    });
  }
  cache = { em: Date.now(), itens };
  return itens;
}

// Casa uma nota com um chamado. Devolve o motivo ou null.
function casar(nota, ch) {
  const cnpj = digits(nota.emitente_cnpj);
  const valor = parseFloat(nota.valor_total) || 0;
  const nf = nfDaChave(nota.chave_acesso);
  const cnpjOk = !!cnpj && ch.cnpjs.includes(cnpj);
  let nomeOk = false;
  if (!cnpjOk) {
    const toks = tokensNome(nota.emitente_nome);
    const alvo = ch.textoNorm;
    const achados = toks.filter((t) => alvo.includes(t));
    nomeOk = toks.length > 0 && achados.length >= Math.min(2, toks.length);
  }
  if (!cnpjOk && !nomeOk) return null;
  const valorOk = ch.valores.some((v) => Math.abs(v - valor) <= 0.01);
  const nfOk = !!nf && ch.nfs.includes(nf);
  if (!valorOk && !nfOk) return null;
  const partes = [cnpjOk ? 'CNPJ' : 'nome do fornecedor', nfOk ? `NF ${nf}` : null, valorOk ? 'valor' : null].filter(Boolean);
  return partes.join(' + ');
}

// Para as notas pendentes (ou as informadas), devolve { porNota: { id: [chamados] }, resumo }
export async function cruzarNotasComChamados({ notas = null, forcar = false } = {}) {
  let lista = notas;
  if (!lista) {
    lista = [];
    for (let off = 0; off < 50000; off += 1000) {
      const { data, error } = await supabase
        .from('sefaz_dfe_notas')
        .select('id, chave_acesso, emitente_cnpj, emitente_nome, valor_total')
        .eq('situacao', '1')
        .eq('tipo_operacao', '1')
        .or('escriturada.is.null,escriturada.eq.false')
        .is('status_manual', null)
        .range(off, off + 999);
      if (error) throw new Error(`Supabase: ${error.message}`);
      lista = lista.concat(data || []);
      if (!data || data.length < 1000) break;
    }
  }
  const chamados = await chamadosAbertosDeNota({ forcar });
  const porNota = {};
  let notasComChamado = 0;
  for (const n of lista) {
    const hits = [];
    for (const ch of chamados) {
      const motivo = casar(n, ch);
      if (motivo) {
        hits.push({
          id: ch.id,
          numero: ch.numero,
          setor: ch.setor,
          status: ch.status,
          assunto: ch.assunto,
          loja_nome: ch.loja_nome,
          criado_em: ch.criado_em,
          responsavel_nome: ch.responsavel_nome,
          motivo,
        });
      }
    }
    if (hits.length) {
      hits.sort((a, b) => (b.id || 0) - (a.id || 0));
      porNota[n.id] = hits;
      notasComChamado++;
    }
  }
  return {
    porNota,
    resumo: {
      notasAvaliadas: lista.length,
      notasComChamado,
      chamadosAbertosDeNota: chamados.length,
      atualizadoEm: new Date(cache.em || Date.now()).toISOString(),
    },
  };
}

export default { chamadosAbertosDeNota, cruzarNotasComChamados };
