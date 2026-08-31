// Sincronização com o web service NFeDistribuicaoDFe da SEFAZ (Ambiente Nacional).
// Consulta incremental por NSU dos documentos fiscais destinados aos CNPJs próprios
// e persiste no Supabase (tabelas sefaz_dfe_notas / sefaz_dfe_controle).
import { DistribuicaoDFe } from 'node-mde';
import supabase from '../config/supabase.js';
import { carregarCertificados } from '../config/sefazCerts.js';
import { FILIAIS, filialPorCnpj } from '../config/sefazFiliais.js';

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
    const destReal = somenteDigitos(val(inf.dest?.CNPJ)) || null;
    const destCpf = somenteDigitos(val(inf.dest?.CPF)) || null;
    // Destinatario e um CPF: venda ao consumidor de uma loja do grupo, que
    // so chegou aqui porque um CNPJ nosso esta no <autXML>. Nao e nota
    // "emitida para mim" — descarta e manda apagar resumo antigo da chave.
    if (!destReal && destCpf) {
      return { tipo: 'venda_consumidor', chave };
    }
    return {
      tipo: 'nota',
      registro: {
        cnpj_destinatario: destReal || cnpjDest,
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

let temColunaNome = null;
async function colunaEmpresaNomeExiste() {
  if (temColunaNome !== null) return temColunaNome;
  const { error } = await supabase
    .from('sefaz_dfe_notas')
    .select('empresa_nome')
    .limit(1);
  temColunaNome = !error;
  if (!temColunaNome)
    console.warn(
      '⚠️ [SefazDFe] coluna empresa_nome ausente — gravando só o código da filial (rode migrations/sefaz_dfe_empresa_nome.sql)',
    );
  return temColunaNome;
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

export async function sincronizarFilial(filial, cert) {
  const cnpj = somenteDigitos(filial.cnpj);
  const inicio = Date.now();
  const resultado = {
    cnpj,
    codigo: filial.codigo,
    descricao: `${filial.codigo} - ${filial.nome}`,
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
        descricao: `${filial.codigo} - ${filial.nome}`,
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
        // Nenhum documento NESTE TRECHO. Quando ha um vao de NSUs expirados,
        // a SEFAZ responde 137 e avanca o ponteiro ~100 por vez — parar aqui
        // deixaria a filial travada bem antes do fim da fila. So encerramos
        // quando chegamos ao maxNSU ou quando o ponteiro para de andar.
        const anterior = ultNSU;
        ultNSU = BigInt(d.ultNSU || ultNSU);
        const maxNSU = BigInt(d.maxNSU || 0);
        await salvarControle(cnpj, {
          ult_nsu: ultNSU.toString(),
          max_nsu: (maxNSU || ultNSU).toString(),
        });
        if (ultNSU <= anterior || ultNSU >= maxNSU) break;
        await new Promise((r) => setTimeout(r, 1200));
        continue;
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
            // A filial e a do destinatario de fato, nao a do CNPJ consultado
            // Se o destinatario nao e uma filial nossa, a nota chegou por
            // <autXML>: ficamos com o registro, mas sem dono no grupo.
            const filialReal = filialPorCnpj(parsed.registro.cnpj_destinatario);
            const registro = {
              ...parsed.registro,
              empresa_codigo: filialReal ? filialReal.codigo : null,
              empresa_nome: filialReal ? filialReal.nome : null,
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
          } else if (parsed.tipo === 'venda_consumidor') {
            // Apaga o resumo que possa ter entrado antes com esta chave
            // (o resNFe nao traz o destinatario, entao ele e gravado no
            // fluxo consultado ate o XML completo revelar que e consumidor)
            notasPorChave.delete(parsed.chave);
            await supabase
              .from('sefaz_dfe_notas')
              .delete()
              .eq('chave_acesso', parsed.chave);
            resultado.descartadasConsumidor =
              (resultado.descartadasConsumidor || 0) + 1;
          } else if (parsed.tipo === 'evento') {
            eventos.push(parsed.evento);
          }
        } catch (e) {
          console.warn(`⚠️ [SefazDFe] Falha ao parsear NSU ${doc.nsu}: ${e.message}`);
        }
      }

      let notas = [...notasPorChave.values()];
      if (!(await colunaEmpresaNomeExiste())) {
        notas = notas.map(({ empresa_nome, ...resto }) => resto);
      }
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

      // Pausa entre lotes; um pouco maior na carga inicial, que encadeia
      // muitas chamadas seguidas para o mesmo CNPJ
      await new Promise((r) => setTimeout(r, loop > 3 ? 1500 : 800));
    }
  } catch (e) {
    resultado.erro = e.message;
  }

  console.log(
    `${resultado.erro ? '⚠️' : '✅'} [SefazDFe] ${resultado.descricao} (${cnpj}): ` +
      `${resultado.novosDocs} notas, ${resultado.eventos} eventos em ${Date.now() - inicio}ms` +
      `${resultado.erro ? ` | erro: ${resultado.erro}` : ''}`,
  );
  return resultado;
}

// O certificado A1 da matriz vale para qualquer CNPJ da mesma raiz
function certificadoDaFilial(filial, certs) {
  return (
    certs.find((c) => c.arquivo === filial.cert) ||
    certs.find(
      (c) => somenteDigitos(c.cnpj).slice(0, 8) === filial.cnpj.slice(0, 8),
    ) ||
    null
  );
}

export async function sincronizarTodos({ cnpj = null, codigo = null } = {}) {
  const certs = carregarCertificados();
  if (certs.length === 0) {
    return {
      ok: false,
      erro: 'Nenhum certificado configurado (verifique SEFAZ_CERTIFICADOS ou certs/certificados.json)',
      resultados: [],
    };
  }

  let alvo = FILIAIS;
  if (cnpj) alvo = alvo.filter((f) => f.cnpj === somenteDigitos(cnpj));
  if (codigo) alvo = alvo.filter((f) => f.codigo === parseInt(codigo));

  const resultados = [];
  for (const filial of alvo) {
    const cert = certificadoDaFilial(filial, certs);
    if (!cert) {
      resultados.push({
        cnpj: filial.cnpj,
        codigo: filial.codigo,
        descricao: `${filial.codigo} - ${filial.nome}`,
        novosDocs: 0,
        eventos: 0,
        erro: 'Sem certificado para a raiz deste CNPJ',
      });
      continue;
    }
    resultados.push(await sincronizarFilial(filial, cert));
    // Respiro entre filiais — drenar 20 CNPJs em rajada e o que mais se
    // parece com abuso do ponto de vista da SEFAZ
    if (alvo.length > 1) await new Promise((r) => setTimeout(r, 2500));
  }
  return { ok: true, resultados };
}

// Filiais consultadas na SEFAZ, com o dado do cadastro do TOTVS
export function listarEmpresas() {
  const certs = carregarCertificados();
  return FILIAIS.map((f) => ({
    cnpj: f.cnpj,
    codigo: f.codigo,
    nome: f.nome,
    descricao: `${f.codigo} - ${f.nome}`,
    temCertificado: !!certificadoDaFilial(f, certs),
  }));
}
