// =============================================================================
// DEVOLUÇÕES DE MERCADORIA — serviço
// Solicitações abertas pelo cliente no link público /devolucao, com:
//   • validação do cliente no cadastro (pes_pessoa, sincronizado do TOTVS)
//   • vendedores: lista FIXA (equipe que atende devolução), sem consultar o TOTVS
//   • fotos no bucket público `devolucoes-mercadoria` (1 por peça)
//   • tipo "defeito" abre chamado no Dryland (setor Produção) e a solicitação
//     só libera a Devolução RFID quando o chamado é concluído (sincronizado
//     por job a cada 5 min e ao abrir a página)
//   • ligação com a transação de devolução gerada no TOTVS (Devolução RFID)
// =============================================================================
import axios from 'axios';
import supabase from '../config/supabase.js';
import { listarBranches } from './pdvFiscal.js';
import { criarNotificacaoSistema } from './notificacoesSistema.js';

export const BUCKET = 'devolucoes-mercadoria';
export const STATUS = ['aguardando_avaliacao', 'aguardando_devolucao', 'em_devolucao', 'concluida', 'cancelada'];
export const TIPOS = ['tradicional', 'defeito'];
const MAX_FOTOS = 40;
const MAX_FOTO_BYTES = 6 * 1024 * 1024;

// Supabase "Cérebro" do Dryland (mesma origem da rota /api/dryland)
const DRYLAND_URL = process.env.DRYLAND_SUPABASE_URL || 'https://umhczriycvtagjqjnrzm.supabase.co';
const DRYLAND_KEY =
  process.env.DRYLAND_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtaGN6cml5Y3Z0YWdqcWpucnptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2NTAyOTEsImV4cCI6MjA5MzIyNjI5MX0.SVWG6_7DZNv-Tz4AgRwQ1791lAEWgpcEv15k9rERlwI';
const DRYLAND_BUCKET = 'missao-nfs';
// Chamada interna à própria API (rota /api/dryland). Local: mesma porta do
// servidor (4100 por padrão); no Render: URL externa do serviço.
const INTERNAL_API_BASE =
  process.env.API_BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 4100}`;
const DRYLAND_SETOR = 'producao';

const digits = (v) => String(v || '').replace(/\D/g, '');
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

export class DevolucaoError extends Error {
  constructor(message, code = 'DEVOLUCAO_ERROR', status = 400, details = null) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

// ─── Dryland ─────────────────────────────────────────────────────────────────
const drylandHeaders = {
  'Content-Type': 'application/json',
  apikey: DRYLAND_KEY,
  Authorization: `Bearer ${DRYLAND_KEY}`,
};

async function rpc(fn, args = {}) {
  const { data } = await axios.post(`${DRYLAND_URL}/rest/v1/rpc/${fn}`, args, {
    headers: drylandHeaders,
    timeout: 30000,
  });
  return data;
}

export async function listarChamadosDryland() {
  const data = await rpc('chamado_listar', {});
  return Array.isArray(data) ? data : [];
}

export async function buscarChamadoDryland(id) {
  const data = await rpc('chamado_get', { p_id: Number(id) });
  return data?.chamado || data || null;
}

// Abre o chamado de avaliação da devolução com defeito para a Produção.
// Usa a rota interna /api/dryland/chamados para aproveitar a regra de
// responsável automático que já existe lá.
async function abrirChamadoDefeito(dev, fotos) {
  const linhasFotos = fotos.map((f) => `Peça ${f.peca}: ${f.url}`);
  const texto = [
    `Cliente: ${dev.cliente_nome || '--'} (${dev.cliente_cpf_cnpj})`,
    `Código do cliente: ${dev.cliente_code}`,
    `Empresa do cliente: ${dev.cliente_empresa ?? '--'}${dev.cliente_empresa_nome ? ` - ${dev.cliente_empresa_nome}` : ''}`,
    `Vendedor: ${dev.vendedor_nome || dev.vendedor_code || '--'}`,
    `Tipo: PEÇAS COM DEFEITO`,
    `Quantidade de peças: ${dev.qtd_pecas}`,
    dev.cliente_telefone ? `Telefone: ${dev.cliente_telefone}` : null,
    dev.observacao ? `Observação do cliente: ${dev.observacao}` : null,
    `Solicitação HeadCoach: DEV-${dev.id} (Devoluções de Mercadoria)`,
    '',
    'Ao concluir este chamado, a solicitação libera automaticamente a Devolução RFID no HeadCoach.',
    linhasFotos.length ? '' : null,
    linhasFotos.length ? 'Fotos (1 por peça):' : null,
    ...linhasFotos,
  ]
    .filter((l) => l !== null)
    .join('\n');

  const resp = await axios.post(
    `${INTERNAL_API_BASE}/api/dryland/chamados`,
    {
      loja_cd: dev.cliente_empresa ?? 0,
      loja_nome: dev.cliente_empresa_nome || 'CROSBY',
      assunto: `DEVOLUÇÃO DE MERCADORIA (${dev.cliente_nome || dev.cliente_cpf_cnpj})`,
      texto,
      setor: DRYLAND_SETOR,
      direcao: 'adm',
      por: 'devolucao-publica',
    },
    { timeout: 45000, validateStatus: () => true },
  );
  const json = resp.data || {};
  const chamado = json.data;
  if (resp.status >= 400 || json.success === false || !chamado?.id) {
    throw new DevolucaoError(json.message || `Falha ao abrir chamado no Dryland (HTTP ${resp.status})`, 'DRYLAND_ERROR', 502, json);
  }
  let numero = chamado.numero ?? null;
  if (numero == null) {
    try {
      const det = await buscarChamadoDryland(chamado.id);
      numero = det?.numero ?? null;
    } catch {
      /* número é só informativo */
    }
  }
  return { id: chamado.id, numero };
}

// Anexa as fotos no chamado (best-effort: se falhar, os links já estão no texto)
async function anexarFotosNoChamado(chamadoId, fotos) {
  let ok = 0;
  for (const f of fotos.slice(0, 12)) {
    try {
      const { data: blob } = await supabase.storage.from(BUCKET).download(f.path);
      if (!blob) continue;
      const buf = Buffer.from(await blob.arrayBuffer());
      const path = `chamado-${chamadoId}-${Date.now()}-p${f.peca}.jpg`;
      await axios.post(`${DRYLAND_URL}/storage/v1/object/${DRYLAND_BUCKET}/${path}`, buf, {
        headers: { apikey: DRYLAND_KEY, Authorization: `Bearer ${DRYLAND_KEY}`, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' },
        maxBodyLength: Infinity,
        timeout: 60000,
      });
      const r = await rpc('chamado_anexo_add', { p_id: chamadoId, p_path: path, p_por: 'devolucao-publica' });
      if (r && r.ok) ok++;
    } catch (e) {
      console.warn(`⚠️ [Devoluções] anexo da peça ${f.peca} não subiu no chamado ${chamadoId}: ${e.message}`);
    }
  }
  return ok;
}

// ─── Cliente e vendedores ────────────────────────────────────────────────────
export async function buscarClientePorDocumento(doc) {
  const d = digits(doc);
  if (d.length !== 11 && d.length !== 14) {
    throw new DevolucaoError('Informe um CPF (11 dígitos) ou CNPJ (14 dígitos)', 'DOC_INVALIDO');
  }
  const { data, error } = await supabase
    .from('pes_pessoa')
    .select('code, nm_pessoa, fantasy_name, cpf, tipo_pessoa, cd_empresacad, is_customer, customer_status, telefone, email')
    .eq('cpf', d)
    .order('is_customer', { ascending: false })
    .limit(5);
  if (error) throw new DevolucaoError(`Erro ao consultar o cadastro: ${error.message}`, 'DB_ERROR', 500);
  const cli = (data || []).find((c) => c.is_customer) || data?.[0];
  if (!cli) {
    throw new DevolucaoError('CPF/CNPJ não encontrado no cadastro da Crosby. Fale com o seu vendedor.', 'CLIENTE_NAO_CADASTRADO', 404);
  }
  let empresaNome = null;
  try {
    const b = (await listarBranches()).find((x) => x.code === Number(cli.cd_empresacad));
    empresaNome = b?.fantasyName || b?.description || b?.branchGroupName || null;
  } catch {
    /* nome da empresa é só informativo */
  }
  return {
    code: cli.code,
    nome: cli.nm_pessoa,
    fantasia: cli.fantasy_name || null,
    cpfCnpj: cli.cpf,
    tipo: cli.tipo_pessoa || (d.length === 14 ? 'PJ' : 'PF'),
    empresa: cli.cd_empresacad ?? null,
    empresaNome,
    telefone: cli.telefone || null,
    email: cli.email || null,
  };
}

// Vendedores do formulário público: lista fixa definida pela Crosby (não vem
// do TOTVS). O `code` é o código do vendedor no TOTVS, usado só para a
// Devolução RFID já abrir com o vendedor selecionado — ajuste aqui se mudar.
export const VENDEDORES_FIXOS = [
  { code: 241, name: 'YAGO' },
  { code: 161, name: 'CLEYTON' },
  { code: 165, name: 'MICHEL' },
  { code: 26, name: 'DAVID' },
  { code: 21, name: 'RAFAEL' },
  { code: 259, name: 'ARTHUR' },
  { code: 40, name: 'JHEMYSON' },
];

export async function listarVendedores() {
  return VENDEDORES_FIXOS;
}

// ─── Storage ─────────────────────────────────────────────────────────────────
let bucketOk = false;
async function garantirBucket() {
  if (bucketOk) return;
  const { data } = await supabase.storage.getBucket(BUCKET);
  if (!data) {
    const { error } = await supabase.storage.createBucket(BUCKET, { public: true, fileSizeLimit: MAX_FOTO_BYTES });
    if (error && !/already exists/i.test(error.message)) {
      throw new DevolucaoError(`Não consegui criar o bucket ${BUCKET}: ${error.message}`, 'STORAGE_ERROR', 500);
    }
  }
  bucketOk = true;
}

function decodificarBase64(b64) {
  const m = String(b64 || '').match(/^data:([^;]+);base64,(.*)$/s);
  const contentType = m ? m[1] : 'image/jpeg';
  const buf = Buffer.from(m ? m[2] : String(b64 || ''), 'base64');
  return { buf, contentType };
}

async function subirFotos(devolucaoId, fotos) {
  await garantirBucket();
  const saida = [];
  for (const [i, f] of fotos.entries()) {
    const { buf, contentType } = decodificarBase64(f.base64);
    if (!buf.length) continue;
    if (buf.length > MAX_FOTO_BYTES) {
      throw new DevolucaoError(`Foto da peça ${f.peca ?? i + 1} passa de ${Math.round(MAX_FOTO_BYTES / 1024 / 1024)} MB`, 'FOTO_GRANDE', 413);
    }
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    const path = `dev-${devolucaoId}/peca-${String(f.peca ?? i + 1).padStart(2, '0')}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, buf, { contentType, upsert: false });
    if (error) throw new DevolucaoError(`Falha ao guardar a foto da peça ${f.peca ?? i + 1}: ${error.message}`, 'STORAGE_ERROR', 500);
    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    saida.push({ peca: Number(f.peca ?? i + 1), path, url: pub.publicUrl, tamanho: buf.length, nome: f.nome || null });
  }
  return saida;
}

// ─── Solicitação ─────────────────────────────────────────────────────────────
export async function criarSolicitacao(body, { ip = null, origem = 'publico', criadoPor = null } = {}) {
  const tipo = String(body.tipo || '').toLowerCase();
  if (!TIPOS.includes(tipo)) throw new DevolucaoError('Tipo de devolução inválido (tradicional | defeito)', 'TIPO_INVALIDO');
  const qtd = parseInt(body.qtdPecas, 10);
  if (!Number.isInteger(qtd) || qtd < 1 || qtd > 500) throw new DevolucaoError('Quantidade de peças inválida', 'QTD_INVALIDA');
  const fotos = Array.isArray(body.fotos) ? body.fotos.filter((f) => f && f.base64) : [];
  if (fotos.length > MAX_FOTOS) throw new DevolucaoError(`No máximo ${MAX_FOTOS} fotos por solicitação`, 'FOTOS_DEMAIS');
  if (tipo === 'defeito' && fotos.length === 0) {
    throw new DevolucaoError('Devolução por defeito exige pelo menos uma foto da peça', 'FOTO_OBRIGATORIA');
  }

  const cliente = await buscarClientePorDocumento(body.cpfCnpj);

  // Só aceita vendedor da lista fixa (o formulário público não digita nome livre)
  const vendedorCode = parseInt(body.vendedorCode, 10) || null;
  const vendedorFixo = VENDEDORES_FIXOS.find((v) => v.code === vendedorCode);
  if (!vendedorFixo) throw new DevolucaoError('Escolha o vendedor', 'VENDEDOR_OBRIGATORIO');
  const vendedorNome = vendedorFixo.name;

  const registro = {
    origem,
    cliente_code: cliente.code,
    cliente_nome: cliente.nome,
    cliente_cpf_cnpj: cliente.cpfCnpj,
    cliente_tipo: cliente.tipo,
    cliente_empresa: cliente.empresa,
    cliente_empresa_nome: cliente.empresaNome,
    cliente_telefone: digits(body.telefone) || cliente.telefone || null,
    cliente_email: body.email || cliente.email || null,
    vendedor_code: vendedorCode,
    vendedor_nome: vendedorNome,
    tipo,
    qtd_pecas: qtd,
    observacao: body.observacao ? String(body.observacao).slice(0, 2000) : null,
    fotos: [],
    status: tipo === 'defeito' ? 'aguardando_avaliacao' : 'aguardando_devolucao',
    criado_por: criadoPor,
    ip_origem: ip,
  };
  const { data: dev, error } = await supabase.from('devolucoes_mercadoria').insert(registro).select().single();
  if (error) {
    if (/relation .*devolucoes_mercadoria.* does not exist/i.test(error.message)) {
      throw new DevolucaoError('Tabela devolucoes_mercadoria não existe — rode migrations/devolucoes_mercadoria.sql', 'MIGRATION_PENDING', 503);
    }
    throw new DevolucaoError(`Falha ao gravar a solicitação: ${error.message}`, 'DB_ERROR', 500);
  }

  // Fotos: se falhar, apaga a solicitação para o cliente tentar de novo
  let fotosSalvas = [];
  try {
    fotosSalvas = await subirFotos(dev.id, fotos);
    if (fotosSalvas.length) {
      await supabase.from('devolucoes_mercadoria').update({ fotos: fotosSalvas }).eq('id', dev.id);
    }
  } catch (e) {
    await supabase.from('devolucoes_mercadoria').delete().eq('id', dev.id);
    throw e;
  }

  // Defeito → chamado para a Produção avaliar
  let chamado = null;
  let avisoChamado = null;
  if (tipo === 'defeito') {
    try {
      chamado = await abrirChamadoDefeito({ ...dev, fotos: fotosSalvas }, fotosSalvas);
      await supabase
        .from('devolucoes_mercadoria')
        .update({ chamado_dryland_id: chamado.id, chamado_dryland_numero: chamado.numero, chamado_aberto_em: new Date().toISOString(), chamado_status: 'aberto' })
        .eq('id', dev.id);
      anexarFotosNoChamado(chamado.id, fotosSalvas).catch(() => {});
    } catch (e) {
      // A solicitação fica registrada; o chamado pode ser aberto depois pela tela
      avisoChamado = e.message;
      console.error(`❌ [Devoluções] DEV-${dev.id}: chamado não aberto: ${e.message}`);
    }
  }

  criarNotificacaoSistema({
    tipo: 'DEVOLUCAO_MERCADORIA_NOVA',
    nivel: tipo === 'defeito' ? 'warning' : 'info',
    titulo: `Devolução DEV-${dev.id} · ${cliente.nome}`,
    mensagem: `${qtd} peça(s) · ${tipo === 'defeito' ? 'peças com defeito (chamado para a Produção)' : 'devolução tradicional'}${vendedorNome ? ` · vendedor ${vendedorNome}` : ''}`,
    dados: { devolucao_id: dev.id, tipo, cliente_code: cliente.code, chamado_id: chamado?.id ?? null },
    roles: ['owner', 'admin', 'user'],
  }).catch(() => {});

  console.log(`📦 [Devoluções] DEV-${dev.id} ${tipo} · cliente ${cliente.code} ${cliente.nome} · ${qtd} pç · ${fotosSalvas.length} foto(s)${chamado ? ` · chamado Dryland #${chamado.numero ?? chamado.id}` : ''}`);
  return { ...dev, fotos: fotosSalvas, chamado, avisoChamado, protocolo: `DEV-${dev.id}` };
}

// Reabre o chamado de uma devolução com defeito que ficou sem chamado
export async function abrirChamadoPendente(id) {
  const { data: dev } = await supabase.from('devolucoes_mercadoria').select('*').eq('id', id).maybeSingle();
  if (!dev) throw new DevolucaoError('Solicitação não encontrada', 'NOT_FOUND', 404);
  if (dev.tipo !== 'defeito') throw new DevolucaoError('Só devolução por defeito abre chamado', 'TIPO_INVALIDO');
  if (dev.chamado_dryland_id) return { id: dev.chamado_dryland_id, numero: dev.chamado_dryland_numero, jaExistia: true };
  const chamado = await abrirChamadoDefeito(dev, dev.fotos || []);
  await supabase
    .from('devolucoes_mercadoria')
    .update({ chamado_dryland_id: chamado.id, chamado_dryland_numero: chamado.numero, chamado_aberto_em: new Date().toISOString(), chamado_status: 'aberto', status: 'aguardando_avaliacao' })
    .eq('id', id);
  anexarFotosNoChamado(chamado.id, dev.fotos || []).catch(() => {});
  return chamado;
}

// ─── Sincronização com o Dryland ─────────────────────────────────────────────
// Chamado concluído → solicitação liberada para a Devolução RFID.
// Chamado cancelado → solicitação cancelada.
export async function sincronizarChamados({ ids = null } = {}) {
  let q = supabase
    .from('devolucoes_mercadoria')
    .select('id, cliente_nome, chamado_dryland_id, chamado_status, status')
    .not('chamado_dryland_id', 'is', null)
    .in('status', ['aguardando_avaliacao']);
  if (ids?.length) q = q.in('id', ids);
  const { data: pendentes, error } = await q;
  if (error) throw new DevolucaoError(error.message, 'DB_ERROR', 500);
  if (!pendentes?.length) return { verificadas: 0, liberadas: [], canceladas: [], atualizadas: [] };

  const lista = await listarChamadosDryland();
  const porId = new Map(lista.map((c) => [Number(c.id), c]));
  const liberadas = [];
  const canceladas = [];
  const atualizadas = [];

  for (const dev of pendentes) {
    const c = porId.get(Number(dev.chamado_dryland_id));
    if (!c) continue;
    const patch = {};
    if (c.status && c.status !== dev.chamado_status) patch.chamado_status = c.status;
    if (c.numero != null) patch.chamado_dryland_numero = c.numero;

    if (c.status === 'concluido') {
      let avaliacao = null;
      try {
        const det = await buscarChamadoDryland(dev.chamado_dryland_id);
        const msgs = [...(det?.mensagens || [])].reverse();
        avaliacao = msgs.find((m) => m.lado === 'setor' && m.texto)?.texto || det?.comentario || det?.resolucao || null;
      } catch {
        /* sem detalhe */
      }
      Object.assign(patch, {
        status: 'aguardando_devolucao',
        chamado_concluido_em: c.concluido_em || c.atualizado_em || new Date().toISOString(),
        avaliacao_producao: avaliacao,
      });
      liberadas.push(dev.id);
      criarNotificacaoSistema({
        tipo: 'DEVOLUCAO_MERCADORIA_AVALIADA',
        nivel: 'info',
        titulo: `Devolução DEV-${dev.id} avaliada pela Produção`,
        mensagem: `${dev.cliente_nome || 'Cliente'} · chamado #${c.numero ?? c.id} concluído — pronta para a Devolução RFID`,
        dados: { devolucao_id: dev.id, chamado_id: c.id },
        roles: ['owner', 'admin', 'user'],
      }).catch(() => {});
    } else if (c.status === 'cancelado') {
      Object.assign(patch, { status: 'cancelada', motivo_cancelamento: `Chamado #${c.numero ?? c.id} cancelado no Dryland` });
      canceladas.push(dev.id);
    }

    if (Object.keys(patch).length) {
      await supabase.from('devolucoes_mercadoria').update(patch).eq('id', dev.id);
      atualizadas.push(dev.id);
    }
  }
  if (liberadas.length || canceladas.length) {
    console.log(`🔄 [Devoluções] sync: ${liberadas.length} liberada(s), ${canceladas.length} cancelada(s)`);
  }
  return { verificadas: pendentes.length, liberadas, canceladas, atualizadas };
}

// ─── Transação de devolução (Devolução RFID → TOTVS) ─────────────────────────
export async function registrarTransacao(id, dados, por = null) {
  const { data: dev } = await supabase.from('devolucoes_mercadoria').select('id, status').eq('id', id).maybeSingle();
  if (!dev) throw new DevolucaoError('Solicitação não encontrada', 'NOT_FOUND', 404);
  const statusTrx = dados.status != null ? Number(dados.status) : null;
  const patch = {
    transacao_branch: parseInt(dados.branchCode, 10) || null,
    transacao_code: dados.transactionCode ? Number(dados.transactionCode) : null,
    transacao_date: dados.transactionDate ? String(dados.transactionDate).slice(0, 10) : null,
    transacao_total: dados.total != null ? round2(dados.total) : null,
    transacao_operacao: dados.operacao != null ? parseInt(dados.operacao, 10) : null,
    transacao_qtd_epcs: dados.qtdEpcs != null ? parseInt(dados.qtdEpcs, 10) : null,
    transacao_status: statusTrx,
    transacao_por: por,
  };
  if (!patch.transacao_em && dados.transactionCode) patch.transacao_em = new Date().toISOString();
  if (statusTrx === 4) {
    patch.status = 'concluida';
    patch.transacao_atendida_em = new Date().toISOString();
  } else if (statusTrx === 6) {
    // caixa cancelou: volta para a fila da Devolução RFID
    patch.status = 'aguardando_devolucao';
  } else if (dev.status !== 'concluida' && dev.status !== 'cancelada') {
    patch.status = 'em_devolucao';
  }
  const { data, error } = await supabase.from('devolucoes_mercadoria').update(patch).eq('id', id).select().single();
  if (error) throw new DevolucaoError(error.message, 'DB_ERROR', 500);
  return data;
}
