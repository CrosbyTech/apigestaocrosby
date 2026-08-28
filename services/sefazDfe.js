// Sincronização com o web service NFeDistribuicaoDFe da SEFAZ (Ambiente Nacional).
// Consulta incremental por NSU dos documentos fiscais destinados aos CNPJs próprios
// e persiste no Supabase (tabelas sefaz_dfe_notas / sefaz_dfe_controle).
import { DistribuicaoDFe } from 'node-mde';
import supabase from '../config/supabase.js';
import { carregarCertificados } from '../config/sefazCerts.js';

const TP_AMB = process.env.SEFAZ_TP_AMB || '1'; // 1 = produção
// A SEFAZ bloqueia por ~1h em caso de consumo indevido (cStat 656)
const BLOQUEIO_MS = 65 * 60 * 1000;
// Intervalo mínimo entre consultas do mesmo CNPJ sem NSU pendente.
// A Distribuição DFe não aceita filtro por data: ela entrega o que veio depois
// do último NSU. Quem limita o consumo é o intervalo entre as chamadas — e
// insistir com o mesmo NSU sem novidade é justamente o que gera o 656.
// Por isso o intervalo é adaptativo: 1h quando houve movimento na última
// consulta, 3h quando a SEFAZ respondeu 137 (nada novo).
const INTERVALO_MIN_MS = 61 * 60 * 1000;
const INTERVALO_OCIOSO_MS = 3 * 60 * 60 * 1000 + 60 * 1000;
const MAX_LOOPS = 200; // 200 × 50 docs = 10.000 docs por sync — mais que suficiente

const somenteDigitos = (v) => String(v || '').replace(/\D/g, '');
const num = (v) => {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
};

// Extrai um campo que pode vir como string ou objeto { _: valor } do parser XML
const val = (v) => {
  if (v == null) return null;
  if (typeof v === 'object') return v._ ?? v.value ?? null;
  return v;
};

function parseDoc(doc, cnpjDest) {
  const json = doc.json || {};
  const nsu = parseInt(doc.nsu) || null;

  if (json.resNFe) {
    const r = json.resNFe;
    return {
      tipo: 'nota',
      registro: {
        cnpj_destinatario: cnpjDest,
        chave_acesso: val(r.chNFe),
        nsu,
        emitente_cnpj: val(r.CNPJ) || val(r.CPF),
        emitente_nome: val(r.xNome),
        emitente_ie: val(r.IE),
        data_emissao: val(r.dhEmi),
        tipo_operacao: val(r.tpNF),
        valor_total: num(val(r.vNF)),
        situacao: val(r.cSitNFe),
        schema_origem: 'resNFe',
        xml_completo: false,
      },
    };
  }

  if (json.nfeProc) {
    const inf = json.nfeProc.NFe?.infNFe || {};
    const prot = json.nfeProc.protNFe?.infProt || {};
    const chave =
      val(prot.chNFe) || String(inf.$?.Id || inf.Id || '').replace(/^NFe/, '');
    return {
      tipo: 'nota',
      registro: {
        cnpj_destinatario: cnpjDest,
        chave_acesso: chave,
        nsu,
        emitente_cnpj: val(inf.emit?.CNPJ) || val(inf.emit?.CPF),
        emitente_nome: val(inf.emit?.xNome),
        emitente_ie: val(inf.emit?.IE),
        data_emissao: val(inf.ide?.dhEmi) || val(inf.ide?.dEmi),
        tipo_operacao: val(inf.ide?.tpNF),
        valor_total: num(val(inf.total?.ICMSTot?.vNF)),
        situacao: '1',
        schema_origem: 'procNFe',
        xml_completo: true,
        xml: doc.xml,
      },
    };
  }

  if (json.resEvento) {
    const r = json.resEvento;
    return {
      tipo: 'evento',
      evento: {
        chave: val(r.chNFe),
        tpEvento: val(r.tpEvento),
        descricao: val(r.xEvento),
        nsu,
      },
    };
  }

  if (json.procEventoNFe) {
    const inf = json.procEventoNFe.evento?.infEvento || {};
    return {
      tipo: 'evento',
      evento: {
        chave: val(inf.chNFe),
        tpEvento: val(inf.tpEvento),
        descricao: val(inf.detEvento?.descEvento),
        nsu,
      },
    };
  }

  return null;
}

async function aplicarEvento(cnpjDest, evento) {
  if (!evento.chave || !evento.tpEvento) return;
  const patch = { atualizado_em: new Date().toISOString() };

  // 2102xx = manifestação do destinatário; 110111 = cancelamento
  if (String(evento.tpEvento).startsWith('2102')) {
    patch.manifestacao = evento.tpEvento;
    patch.manifestacao_descricao = evento.descricao;
  } else if (evento.tpEvento === '110111') {
    patch.situacao = '2';
  } else {
    return;
  }

  await supabase
    .from('sefaz_dfe_notas')
    .update(patch)
    .eq('cnpj_destinatario', cnpjDest)
    .eq('chave_acesso', evento.chave);
}

async function getControle(cnpj) {
  const { data } = await supabase
    .from('sefaz_dfe_controle')
    .select('*')
    .eq('cnpj', cnpj)
    .maybeSingle();
  return data;
}

async function salvarControle(cnpj, patch) {
  await supabase
    .from('sefaz_dfe_controle')
    .upsert(
      { cnpj, ...patch, atualizado_em: new Date().toISOString() },
      { onConflict: 'cnpj' },
    );
}

export async function sincronizarCertificado(cert) {
  const cnpj = somenteDigitos(cert.cnpj);
  const inicio = Date.now();
  const resultado = {
    cnpj,
    descricao: cert.descricao,
    novosDocs: 0,
    eventos: 0,
    erro: null,
  };

  const controle = await getControle(cnpj);
  if (controle?.bloqueado_ate && new Date(controle.bloqueado_ate) > new Date()) {
    const ate = new Date(controle.bloqueado_ate).toLocaleTimeString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
    });
    resultado.erro = `Bloqueado pela SEFAZ (consumo indevido) — libera às ${ate}`;
    return resultado;
  }

  // Regra anti-abuso da SEFAZ: re-consultar com o mesmo ultNSU sem novidade
  // gera 656. Só permite nova consulta se passou o intervalo mínimo OU se
  // ainda há NSUs pendentes para baixar (drenar a fila em sequência é
  // permitido, o NSU avança a cada chamada).
  const temPendencia =
    BigInt(controle?.max_nsu || 0) > BigInt(controle?.ult_nsu || 0);
  const intervaloMs =
    controle?.ultimo_cstat === '137' ? INTERVALO_OCIOSO_MS : INTERVALO_MIN_MS;
  if (controle?.ultima_consulta && !temPendencia) {
    const decorridoMs = Date.now() - new Date(controle.ultima_consulta).getTime();
    if (decorridoMs < intervaloMs) {
      const liberaEm = new Date(
        new Date(controle.ultima_consulta).getTime() + intervaloMs,
      ).toLocaleTimeString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        minute: '2-digit',
      });
      const janela = Math.round(intervaloMs / 3600000);
      resultado.erro = `Sem novidade na SEFAZ — próxima consulta às ${liberaEm} (intervalo de ${janela}h)`;
      return resultado;
    }
  }

  let ultNSU = BigInt(controle?.ult_nsu || 0);

  const distribuicao = new DistribuicaoDFe({
    pfx: cert.pfx,
    passphrase: cert.senha,
    cnpj,
    cUFAutor: cert.cUF,
    tpAmb: TP_AMB,
  });

  try {
    for (let loop = 0; loop < MAX_LOOPS; loop++) {
      const consulta = await distribuicao.consultaUltNSU(
        ultNSU.toString().padStart(15, '0'),
      );

      if (consulta.error) throw new Error(consulta.error);
      const d = consulta.data || {};
      const cStat = String(d.cStat || '');

      await salvarControle(cnpj, {
        descricao: cert.descricao,
        ultima_consulta: new Date().toISOString(),
        ultimo_cstat: cStat,
        ultimo_xmotivo: d.xMotivo || '',
        // resposta válida = não há mais pausa pendente
        ...(cStat === '656' ? {} : { bloqueado_ate: null }),
      });

      if (cStat === '656') {
        await salvarControle(cnpj, {
          bloqueado_ate: new Date(Date.now() + BLOQUEIO_MS).toISOString(),
        });
        resultado.erro = 'SEFAZ retornou 656 (consumo indevido) — pausa de 1h';
        break;
      }

      if (cStat === '137') {
        // Nenhum documento novo
        ultNSU = BigInt(d.ultNSU || ultNSU);
        await salvarControle(cnpj, {
          ult_nsu: ultNSU.toString(),
          max_nsu: (d.maxNSU || ultNSU).toString(),
        });
        break;
      }

      if (cStat !== '138') {
        resultado.erro = `SEFAZ cStat ${cStat}: ${d.xMotivo || 'sem detalhe'}`;
        break;
      }

      // cStat 138 — documentos localizados
      const docs = Array.isArray(d.docZip) ? d.docZip : [];
      // Dedup por chave dentro do lote: a mesma NF pode vir como resNFe e
      // procNFe no mesmo lote, e o upsert não aceita a mesma linha 2x.
      // O XML completo (procNFe) tem prioridade; empate → maior NSU vence.
      const notasPorChave = new Map();
      const eventos = [];

      for (const doc of docs) {
        try {
          const parsed = parseDoc(doc, cnpj);
          if (!parsed) continue;
          if (parsed.tipo === 'nota' && parsed.registro.chave_acesso) {
            const registro = {
              ...parsed.registro,
              empresa_codigo: cert.empresaCodigo || null,
              atualizado_em: new Date().toISOString(),
            };
            const chave = registro.chave_acesso;
            const existente = notasPorChave.get(chave);
            const substituir =
              !existente ||
              (registro.xml_completo && !existente.xml_completo) ||
              (registro.xml_completo === existente.xml_completo &&
                (registro.nsu || 0) >= (existente.nsu || 0));
            if (substituir) notasPorChave.set(chave, registro);
          } else if (parsed.tipo === 'evento') {
            eventos.push(parsed.evento);
          }
        } catch (e) {
          console.warn(`⚠️ [SefazDFe] Falha ao parsear NSU ${doc.nsu}: ${e.message}`);
        }
      }

      const notas = [...notasPorChave.values()];
      if (notas.length > 0) {
        const { error } = await supabase
          .from('sefaz_dfe_notas')
          .upsert(notas, { onConflict: 'cnpj_destinatario,chave_acesso' });
        if (error) throw new Error(`Supabase upsert: ${error.message}`);
        resultado.novosDocs += notas.length;
      }

      for (const ev of eventos) {
        await aplicarEvento(cnpj, ev);
        resultado.eventos++;
      }

      ultNSU = BigInt(d.ultNSU || ultNSU);
      await salvarControle(cnpj, {
        ult_nsu: ultNSU.toString(),
        max_nsu: (d.maxNSU || ultNSU).toString(),
      });

      if (BigInt(d.ultNSU || 0) >= BigInt(d.maxNSU || 0)) break;

      // Pequena pausa entre lotes para não estressar o serviço
      await new Promise((r) => setTimeout(r, 800));
    }
  } catch (e) {
    resultado.erro = e.message;
  }

  console.log(
    `${resultado.erro ? '⚠️' : '✅'} [SefazDFe] ${cert.descricao} (${cnpj}): ` +
      `${resultado.novosDocs} notas, ${resultado.eventos} eventos em ${Date.now() - inicio}ms` +
      `${resultado.erro ? ` | erro: ${resultado.erro}` : ''}`,
  );
  return resultado;
}

export async function sincronizarTodos({ cnpj = null } = {}) {
  const certs = carregarCertificados();
  const alvo = cnpj
    ? certs.filter((c) => somenteDigitos(c.cnpj) === somenteDigitos(cnpj))
    : certs;

  if (alvo.length === 0) {
    return {
      ok: false,
      erro: 'Nenhum certificado configurado (verifique certs/certificados.json e as senhas)',
      resultados: [],
    };
  }

  const resultados = [];
  for (const cert of alvo) {
    resultados.push(await sincronizarCertificado(cert));
  }
  return { ok: true, resultados };
}

export function listarEmpresas() {
  const certs = carregarCertificados();
  return certs.map((c) => ({
    cnpj: somenteDigitos(c.cnpj),
    descricao: c.descricao,
    razaoSocial: c.razaoSocial,
    empresaCodigo: c.empresaCodigo || null,
    validade: c.validade,
  }));
}
